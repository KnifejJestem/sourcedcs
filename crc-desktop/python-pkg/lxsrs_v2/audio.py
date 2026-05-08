from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import logging
import queue
import threading
import time
from typing import Deque

from .pulse import PulseSimplePlayer, PulseSimpleRecorder


LOG = logging.getLogger(__name__)
OPUS_MAX_FRAME_SIZE = 5760


@dataclass
class AudioDevice:
    index: int
    name: str
    max_input_channels: int
    max_output_channels: int
    default_samplerate: float
    usable_input: bool = True


class AudioSink:
    def play(self, opus_frame: bytes, volume: float = 1.0) -> None:
        raise NotImplementedError


class NullAudioSink(AudioSink):
    def __init__(self) -> None:
        self.frames = 0
        self.bytes = 0

    def play(self, opus_frame: bytes, volume: float = 1.0) -> None:
        self.frames += 1
        self.bytes += len(opus_frame)


class OptionalOpusPlaybackSink(AudioSink):
    def __init__(self, sink_name: str | None = None, volume: float = 1.0) -> None:
        try:
            import opuslib  # type: ignore
            import numpy as np  # type: ignore
        except ImportError as exc:
            raise RuntimeError("audio playback requires opuslib and numpy") from exc

        self._opuslib = opuslib
        self._np = np
        self._decoder = opuslib.Decoder(48000, 1)
        self._buffer: Deque["np.ndarray"] = deque(maxlen=100)
        self._player = PulseSimplePlayer(sink_name=sink_name)
        self._volume = volume

    def set_sink(self, sink_name: str | None) -> None:
        self._player.set_sink(sink_name)

    def set_volume(self, volume: float) -> None:
        self._volume = volume

    def play(self, opus_frame: bytes, volume: float = 1.0) -> None:
        try:
            pcm = self._decoder.decode(opus_frame, OPUS_MAX_FRAME_SIZE)
            samples = self._np.frombuffer(pcm, dtype=self._np.int16).astype(self._np.float32) / 32768.0
            combined = self._volume * volume
            if combined != 1.0:
                samples *= combined
            self._buffer.append(samples)
            pcm_scaled = (samples.clip(-1.0, 1.0) * 32767.0).astype(self._np.int16).tobytes()
            self._player.write(pcm_scaled)
        except Exception:
            LOG.exception("audio playback failed")


class MicrophoneCapture:
    def __init__(self, *, samplerate: int = 16000, block_duration_ms: int = 20, device: int | None = None, volume: float = 1.0) -> None:
        try:
            import numpy as np  # type: ignore
            import sounddevice as sd  # type: ignore
        except ImportError as exc:
            raise RuntimeError("microphone capture requires numpy and sounddevice") from exc

        self._np = np
        self._sd = sd
        self._target_samplerate = samplerate
        self._block_duration_ms = block_duration_ms
        self._device_samplerate = samplerate
        self._frames_per_block = samplerate * block_duration_ms // 1000
        self._device = device
        self._volume = volume
        self._queue: queue.Queue[bytes] = queue.Queue(maxsize=100)
        self._closed = threading.Event()
        self._stream = None
        self._filter_state = None

    def _resolve_input_config(self) -> tuple[int, int]:
        LOG.debug("Resolving input config for device %s", self._device)
        try:
            device_info = self._sd.query_devices(self._device, "input")
            LOG.debug("Device info for %s: %s", self._device, device_info)
        except Exception:
            LOG.exception("Failed to query device %s", self._device)
            # Fallback to defaults if query fails
            return self._target_samplerate, max(1, self._target_samplerate * self._block_duration_ms // 1000)

        default_samplerate = device_info.get("default_samplerate", self._target_samplerate)
        try:
            default_samplerate = int(round(float(default_samplerate)))
        except (ValueError, TypeError):
            default_samplerate = self._target_samplerate

        if default_samplerate <= 0:
            default_samplerate = self._target_samplerate
        
        # Ensure we use a reasonable sample rate if the device reports something weird
        # Common valid rates: 8000, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000
        if default_samplerate < 8000 or default_samplerate > 192000:
            LOG.warning("Device reported unusual samplerate %d, falling back to %d", default_samplerate, self._target_samplerate)
            default_samplerate = self._target_samplerate

        # Some devices (like some ALSA plugins) claim to support 48k but fail when opening.
        # If it's a known problematic common rate, we could proactively try to verify it,
        # but let's stick to catching the error and suppressing the loud PortAudio stderr.
        frames_per_block = max(1, int(default_samplerate * self._block_duration_ms // 1000))
        return default_samplerate, frames_per_block

    def _resample_to_target(self, indata) -> bytes:  # type: ignore[no-untyped-def]
        np = self._np
        mono = indata[:, 0].astype(np.float32)

        # Pre-emphasis: boost high frequencies for voice clarity (y[n] = x[n] - 0.97*x[n-1])
        # This compensates for the natural low-frequency roll-off of speech and improves
        # Opus compression efficiency. We track the last sample across blocks.
        last = getattr(self, "_pre_emphasis_last", 0.0)
        emphasized = np.empty_like(mono)
        emphasized[0] = mono[0] - 0.97 * last
        emphasized[1:] = mono[1:] - 0.97 * mono[:-1]
        self._pre_emphasis_last = float(mono[-1])
        mono = emphasized

        if self._device_samplerate == self._target_samplerate:
            samples = mono
        else:
            src_rate = self._device_samplerate
            dst_rate = self._target_samplerate

            try:
                from scipy.signal import resample_poly  # type: ignore
                from math import gcd
                g = gcd(dst_rate, src_rate)
                up, down = dst_rate // g, src_rate // g
                samples = resample_poly(mono, up, down).astype(np.float32)
                # Trim or pad to exact expected output length
                dst_len = max(1, dst_rate * self._block_duration_ms // 1000)
                if len(samples) > dst_len:
                    samples = samples[:dst_len]
                elif len(samples) < dst_len:
                    samples = np.pad(samples, (0, dst_len - len(samples)))
            except ImportError:
                # Fallback: Blackman-windowed sinc LPF + linear interpolation
                if src_rate > dst_rate:
                    cutoff = dst_rate / 2.0
                    nyq = src_rate / 2.0
                    normalized_cutoff = cutoff / nyq
                    N = 63
                    n = np.arange(N)
                    t = n - (N - 1) / 2.0
                    h = np.sinc(2 * normalized_cutoff * t) * (2 * normalized_cutoff)
                    h = h * np.blackman(N)
                    h = h / np.sum(h)
                    if self._filter_state is None:
                        self._filter_state = np.zeros(N - 1, dtype=np.float32)
                    padded = np.concatenate([self._filter_state, mono])
                    mono = np.convolve(padded, h, mode="valid").astype(np.float32)
                    self._filter_state = mono[-(N - 1):].copy()

                src_len = len(mono)
                dst_len = max(1, dst_rate * self._block_duration_ms // 1000)
                src_x = np.linspace(0.0, 1.0, num=src_len, endpoint=False)
                dst_x = np.linspace(0.0, 1.0, num=dst_len, endpoint=False)
                samples = np.interp(dst_x, src_x, mono).astype(np.float32)

        if self._volume != 1.0:
            samples = samples * self._volume

        return (np.clip(samples, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()

    def start(self) -> None:
        LOG.debug("MicrophoneCapture.start() called for device %s", self._device)
        try:
            self._device_samplerate, self._frames_per_block = self._resolve_input_config()
            LOG.debug("Resolved input config: samplerate=%d, frames_per_block=%d", self._device_samplerate, self._frames_per_block)

            def callback(indata, frames, time_info, status) -> None:  # type: ignore[no-untyped-def]
                if status:
                    LOG.debug("mic status: %s", status)
                pcm = self._resample_to_target(indata)
                try:
                    self._queue.put_nowait(pcm)
                except queue.Full:
                    LOG.warning("dropping microphone frame: queue full")

            LOG.debug("Initializing sounddevice.InputStream for device %s at %d Hz", self._device, self._device_samplerate)
            try:
                # We wrap this in a stderr suppression block because PortAudio's C-level
                # error logging is very loud and will go to our log file even if we catch
                # the Python exception.
                import os
                import sys

                class SuppressStderr:
                    def __enter__(self) -> None:
                        try:
                            self.old_stderr = os.dup(sys.stderr.fileno())
                            self.null_fd = os.open(os.devnull, os.O_WRONLY)
                            os.dup2(self.null_fd, sys.stderr.fileno())
                        except Exception:
                            self.old_stderr = None
                            self.null_fd = None

                    def __exit__(self, exc_type, exc_val, exc_tb) -> None:  # type: ignore[no-untyped-def]
                        if self.old_stderr is not None:
                            os.dup2(self.old_stderr, sys.stderr.fileno())
                            os.close(self.old_stderr)
                        if self.null_fd is not None:
                            os.close(self.null_fd)

                try:
                    with SuppressStderr():
                        self._stream = self._sd.InputStream(
                            samplerate=self._device_samplerate,
                            blocksize=self._frames_per_block,
                            channels=1,
                            dtype="float32",
                            callback=callback,
                            device=self._device,
                        )
                except Exception as e:
                    # If it failed, we'll check if it's a sample rate error
                    # PortAudioError might be wrapped or directly raised
                    err_msg = str(e)
                    if ("Invalid sample rate" in err_msg or "paInvalidSampleRate" in err_msg) and self._device_samplerate != self._target_samplerate:
                        LOG.info("Initial InputStream attempt failed with invalid sample rate %d, falling back to %d...", self._device_samplerate, self._target_samplerate)
                        # Fall through to retry logic below
                    else:
                        # Re-raise if it's not a sample rate error we can fix by falling back
                        raise

                if self._stream is None:
                    # If we fell through due to sample rate error
                    LOG.info("Retrying InputStream with target sample rate %d", self._target_samplerate)
                    self._device_samplerate = self._target_samplerate
                    self._frames_per_block = max(1, self._device_samplerate * self._block_duration_ms // 1000)
                    with SuppressStderr():
                        self._stream = self._sd.InputStream(
                            samplerate=self._device_samplerate,
                            blocksize=self._frames_per_block,
                            channels=1,
                            dtype="float32",
                            callback=callback,
                            device=self._device,
                        )
            except Exception:
                # Catch exceptions from the retry block or re-raised from first attempt
                raise

            if self._stream is not None:
                LOG.debug("Starting sounddevice.InputStream")
                self._stream.start()
                LOG.info(
                    "microphone input opened at %d Hz, resampling to %d Hz",
                    self._device_samplerate,
                    self._target_samplerate,
                )
        except Exception as e:
            err_msg = str(e)
            if "Device unavailable" in err_msg or "Device busy" in err_msg:
                # Use warning instead of exception to avoid loud stack trace for expected busy devices
                LOG.warning("Failed to start microphone capture: %s", err_msg)
            else:
                LOG.exception("Failed to start microphone capture for device %s", self._device)
            self._stream = None
            raise

    def read(self, timeout: float = 1.0) -> bytes | None:
        if self._closed.is_set():
            return None
        if self._stream is None:
            # Mic failed to start, return some silence to avoid starvation if callers expect data
            time.sleep(min(timeout, 0.02))
            return None
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def close(self) -> None:
        LOG.debug("Closing MicrophoneCapture for device %s", self._device)
        self._closed.set()
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
                LOG.debug("Microphone stream closed")
            except Exception:
                LOG.exception("Error closing microphone stream")
            finally:
                self._stream = None


class PulseMicrophoneCapture:
    """Microphone capture via PulseAudio/PipeWire — uses friendly source names.

    Applies the same pre-emphasis and volume scaling as MicrophoneCapture but
    avoids the PortAudio/ALSA layer entirely. PipeWire handles resampling
    internally so we receive the target sample rate directly.
    """

    def __init__(
        self,
        source_name: str | None = None,
        *,
        samplerate: int = 16000,
        block_duration_ms: int = 20,
        volume: float = 1.0,
    ) -> None:
        try:
            import numpy as np  # type: ignore
        except ImportError as exc:
            raise RuntimeError("PulseMicrophoneCapture requires numpy") from exc
        self._np = np
        self._source_name = source_name
        self._samplerate = samplerate
        self._block_duration_ms = block_duration_ms
        self._volume = volume
        self._recorder = PulseSimpleRecorder(
            source_name=source_name,
            samplerate=samplerate,
            channels=1,
        )
        self._pre_emphasis_last: float = 0.0

    def start(self) -> None:
        self._recorder.start()

    def read(self, timeout: float = 1.0) -> bytes | None:
        raw = self._recorder.read(timeout=timeout)
        if raw is None:
            return None
        return self._process(raw)

    def _process(self, raw: bytes) -> bytes:
        np = self._np
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

        # Pre-emphasis across block boundaries
        last = self._pre_emphasis_last
        emphasized = np.empty_like(samples)
        emphasized[0] = samples[0] - 0.97 * last
        emphasized[1:] = samples[1:] - 0.97 * samples[:-1]
        self._pre_emphasis_last = float(samples[-1])
        samples = emphasized

        if self._volume != 1.0:
            samples = samples * self._volume

        return (np.clip(samples, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()

    def drain(self) -> None:
        """Discard buffered frames — call on PTT press to avoid sending stale audio."""
        q = self._recorder._queue
        while not q.empty():
            try:
                q.get_nowait()
            except Exception:
                break

    def close(self) -> None:
        self._recorder.close()


def list_audio_devices() -> list[AudioDevice]:
    LOG.debug("list_audio_devices() called")
    try:
        import sounddevice as sd  # type: ignore
    except ImportError as exc:
        raise RuntimeError("audio device listing requires sounddevice") from exc

    devices = []
    try:
        raw_devices = sd.query_devices()
        LOG.debug("sd.query_devices() returned %d devices", len(raw_devices))
    except Exception:
        LOG.exception("Failed to query audio devices")
        return []

    for index, info in enumerate(raw_devices):
        max_input_channels = int(info.get("max_input_channels", 0))
        usable_input = max_input_channels > 0
        devices.append(
            AudioDevice(
                index=index,
                name=str(info.get("name", "Unknown")),
                max_input_channels=max_input_channels,
                max_output_channels=int(info.get("max_output_channels", 0)),
                default_samplerate=float(info.get("default_samplerate", 0)),
                usable_input=usable_input,
            )
        )
    return devices


def pcm16_mono_peak(pcm_s16le: bytes) -> float:
    try:
        import numpy as np  # type: ignore
    except ImportError as exc:
        raise RuntimeError("level calculation requires numpy") from exc
    if not pcm_s16le:
        return 0.0
    samples = np.frombuffer(pcm_s16le, dtype=np.int16).astype(np.float32) / 32768.0
    if samples.size == 0:
        return 0.0
    return float(np.max(np.abs(samples)))


def resample_pcm16_mono(pcm_s16le: bytes, *, src_rate: int, dst_rate: int) -> bytes:
    try:
        import numpy as np  # type: ignore
    except ImportError as exc:
        raise RuntimeError("resampling requires numpy") from exc
    if src_rate == dst_rate:
        return pcm_s16le
    samples = np.frombuffer(pcm_s16le, dtype=np.int16).astype(np.float32)
    if samples.size == 0:
        return b""

    try:
        from scipy.signal import resample_poly  # type: ignore
        from math import gcd
        g = gcd(dst_rate, src_rate)
        up, down = dst_rate // g, src_rate // g
        resampled = resample_poly(samples, up, down)
        return resampled.clip(-32768.0, 32767.0).astype(np.int16).tobytes()
    except ImportError:
        pass

    # Fallback: Blackman-windowed sinc LPF + linear interpolation
    if src_rate > dst_rate:
        cutoff = dst_rate / 2.0
        nyq = src_rate / 2.0
        normalized_cutoff = cutoff / nyq
        N = 63
        n = np.arange(N)
        t = n - (N - 1) / 2.0
        h = np.sinc(2 * normalized_cutoff * t) * (2 * normalized_cutoff)
        h = h * np.blackman(N)
        h = h / np.sum(h)
        samples = np.convolve(samples, h, mode="same")

    dst_len = max(1, int(round(samples.size * dst_rate / src_rate)))
    src_x = np.linspace(0.0, 1.0, num=samples.size, endpoint=False)
    dst_x = np.linspace(0.0, 1.0, num=dst_len, endpoint=False)
    resampled = np.interp(dst_x, src_x, samples)
    return resampled.clip(-32768.0, 32767.0).astype(np.int16).tobytes()
