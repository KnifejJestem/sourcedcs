from __future__ import annotations

import argparse
import math
import sys
import time


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Basic output-device tone test")
    parser.add_argument("--device", type=int, help="sounddevice output device index")
    parser.add_argument("--frequency", type=float, default=880.0, help="Tone frequency in Hz")
    parser.add_argument("--duration", type=float, default=1.0, help="Tone duration in seconds")
    parser.add_argument("--samplerate", type=int, default=48000, help="Requested sample rate")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        import numpy as np  # type: ignore
        import sounddevice as sd  # type: ignore
    except ImportError as exc:
        print(f"missing dependency: {exc}", file=sys.stderr)
        return 1

    try:
        info = sd.query_devices(args.device, "output")
    except Exception as exc:
        print(f"failed to query output device {args.device!r}: {exc}", file=sys.stderr)
        return 2

    samplerate = int(round(info["default_samplerate"])) or args.samplerate
    channels = max(1, min(2, int(info["max_output_channels"])))
    frames = max(1, int(args.duration * samplerate))

    timeline = np.arange(frames, dtype=np.float32) / float(samplerate)
    fade_frames = max(1, int(0.03 * samplerate))
    envelope = np.ones(frames, dtype=np.float32)
    ramp = np.linspace(0.0, 1.0, num=fade_frames, endpoint=True, dtype=np.float32)
    envelope[:fade_frames] = ramp
    envelope[-fade_frames:] = ramp[::-1]
    tone = 0.2 * envelope * np.sin(2.0 * math.pi * args.frequency * timeline)
    payload = tone.reshape(-1, 1)
    if channels > 1:
        payload = np.repeat(payload, channels, axis=1)

    print(f"playing {args.frequency:.1f} Hz for {args.duration:.2f}s on device={args.device} channels={channels} rate={samplerate}")
    stream = sd.OutputStream(
        samplerate=samplerate,
        device=args.device,
        channels=channels,
        dtype="float32",
        blocksize=0,
    )
    try:
        stream.start()
        stream.write(payload)
        time.sleep(0.05)
        stream.stop()
    except Exception as exc:
        print(f"playback failed: {exc}", file=sys.stderr)
        return 3
    finally:
        stream.close()

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
