from __future__ import annotations

import logging
import struct
import threading
import wave
from pathlib import Path

from .pulse import PulseSimplePlayer

LOG = logging.getLogger(__name__)

# Mapping: sound_set name → (start_file, end_file)
TX_SOUNDS: dict[str, tuple[str, str]] = {
    "MIDS":                  ("MIDS_TX.wav",                    "MIDS_TX_END.wav"),
    "INTERCOM":              ("INTERCOM_TRANS_START.wav",       "INTERCOM_TRANS_END.wav"),
    "RADIO_TRANS":           ("RADIO_TRANS_START.wav",          "RADIO_TRANS_END.wav"),
    "RADIO_TRANS_ALTERNATE": ("RADIO_TRANS_START_ALTERNATE.wav","RADIO_TRANS_END_ALTERNATE.wav"),
    "RADIO_TRANS_APACHE":    ("RADIO_TRANS_START_APACHE.wav",   "RADIO_TRANS_END.wav"),
}
TX_SOUND_SETS = list(TX_SOUNDS.keys())

# Background noise file per modulation name
_NOISE_FILES: dict[str, str] = {
    "AM":       "UHF_NOISE.wav",
    "FM":       "FM_NOISE.wav",
    "INTERCOM": "VHF_NOISE.wav",
}
_NOISE_VOLUME  = 0.12  # background noise level (fraction of full scale)
_CHUNK_FRAMES  = 4800  # 100 ms chunks at 48 kHz


def _read_wav_s16le(path: Path) -> tuple[bytes, int, int]:
    """Return (pcm_s16le, samplerate, nchannels)."""
    with wave.open(str(path), "rb") as f:
        rate     = f.getframerate()
        channels = f.getnchannels()
        sampwidth = f.getsampwidth()
        raw = f.readframes(f.getnframes())
    if sampwidth != 2:
        raise ValueError(f"{path.name}: only 16-bit WAV supported, got {sampwidth*8}-bit")
    return raw, rate, channels


def _scale_s16le(pcm: bytes, volume: float) -> bytes:
    n = len(pcm) // 2
    samples = struct.unpack(f"<{n}h", pcm)
    scaled  = (max(-32768, min(32767, int(s * volume))) for s in samples)
    return struct.pack(f"<{n}h", *scaled)


def _to_mono_s16le(pcm: bytes, channels: int) -> bytes:
    """Mix down to mono by averaging channels."""
    if channels == 1:
        return pcm
    n = len(pcm) // (2 * channels)
    result = bytearray(n * 2)
    for i in range(n):
        total = 0
        for c in range(channels):
            idx = (i * channels + c) * 2
            sample = struct.unpack_from("<h", pcm, idx)[0]
            total += sample
        avg = max(-32768, min(32767, total // channels))
        struct.pack_into("<h", result, i * 2, avg)
    return bytes(result)


def _load_effect(path: Path) -> bytes:
    """Load WAV, convert to mono S16LE at 48 kHz. Returns raw PCM."""
    pcm, rate, channels = _read_wav_s16le(path)
    pcm = _to_mono_s16le(pcm, channels)
    if rate != 48000:
        from .audio import resample_pcm16_mono
        pcm = resample_pcm16_mono(pcm, src_rate=rate, dst_rate=48000)
    return pcm


class AudioEffects:
    """Plays TX click sounds and loops background radio noise via PulseAudio."""

    def __init__(self, effects_dir: Path, sink_name: str | None = None) -> None:
        self._dir        = effects_dir
        self._sink       = sink_name
        self._lock       = threading.Lock()
        self._noise_stop = threading.Event()
        self._noise_pause = threading.Event()
        self._noise_pause.set()   # set = allowed to play, clear = paused
        self._noise_thread: threading.Thread | None = None
        self._noise_mod: str | None = None

    def set_sink(self, sink_name: str | None) -> None:
        self._sink = sink_name

    # ── TX click sounds ──────────────────────────────────────────────────────

    def play_tx_start(self, sound_set: str) -> None:
        files = TX_SOUNDS.get(sound_set, TX_SOUNDS["RADIO_TRANS"])
        self._play_file_async(self._dir / files[0])

    def play_tx_end(self, sound_set: str) -> None:
        files = TX_SOUNDS.get(sound_set, TX_SOUNDS["RADIO_TRANS"])
        self._play_file_async(self._dir / files[1])

    def _play_file_async(self, path: Path) -> None:
        if not path.exists():
            return
        threading.Thread(target=self._play_file, args=(path,), daemon=True, name="srs-effect").start()

    def _play_file(self, path: Path) -> None:
        try:
            pcm = _load_effect(path)
        except Exception:
            LOG.warning("effects: failed to load %s", path.name)
            return
        player = PulseSimplePlayer(sink_name=self._sink, stream_name="SRS Effect")
        try:
            player.write(pcm)
            player.drain()
        except Exception:
            LOG.debug("effects: play error", exc_info=True)
        finally:
            player.close()

    # ── Background noise ─────────────────────────────────────────────────────

    def start_noise(self, modulation: str) -> None:
        """Start looping background noise for the given SRS modulation name."""
        noise_file = _NOISE_FILES.get(modulation)
        with self._lock:
            if self._noise_mod == modulation and self._noise_thread and self._noise_thread.is_alive():
                return
            self._stop_noise_locked()
            self._noise_mod = modulation
            if not noise_file:
                return
            path = self._dir / noise_file
            if not path.exists():
                return
            self._noise_stop.clear()
            self._noise_pause.set()
            self._noise_thread = threading.Thread(
                target=self._noise_loop, args=(path,), daemon=True, name="srs-noise"
            )
            self._noise_thread.start()

    def stop_noise(self) -> None:
        with self._lock:
            self._stop_noise_locked()

    def pause_noise(self) -> None:
        """Silence noise during TX (does not stop the thread)."""
        self._noise_pause.clear()

    def resume_noise(self) -> None:
        """Resume noise after TX."""
        self._noise_pause.set()

    def _stop_noise_locked(self) -> None:
        self._noise_stop.set()
        self._noise_pause.set()  # unblock loop so it can exit
        if self._noise_thread and self._noise_thread.is_alive():
            self._noise_thread.join(timeout=0.5)
        self._noise_thread = None
        self._noise_mod = None

    def _noise_loop(self, path: Path) -> None:
        try:
            pcm_full = _load_effect(path)
            pcm_full = _scale_s16le(pcm_full, _NOISE_VOLUME)
        except Exception:
            LOG.warning("effects: failed to load noise %s", path.name)
            return

        chunk_bytes = _CHUNK_FRAMES * 2  # S16LE mono
        total = len(pcm_full)
        player = PulseSimplePlayer(sink_name=self._sink, stream_name="SRS Noise")
        try:
            offset = 0
            while not self._noise_stop.is_set():
                if not self._noise_pause.wait(timeout=0.05):
                    continue  # paused — spin until resumed or stopped
                chunk = pcm_full[offset: offset + chunk_bytes]
                if len(chunk) < chunk_bytes:
                    # pad wrap-around at end of file
                    chunk = chunk + pcm_full[: chunk_bytes - len(chunk)]
                    offset = chunk_bytes - (total - offset)
                else:
                    offset += chunk_bytes
                if offset >= total:
                    offset = 0
                try:
                    player.write(chunk)
                except Exception:
                    break
        finally:
            player.close()

    def close(self) -> None:
        self.stop_noise()
