# lxsrs_v2

Python prototype for a Linux-compatible DCS SimpleRadio Standalone client.

Current scope:

- Connects to an SRS server over TCP using newline-delimited JSON messages.
- Advertises one or more monitored radios in the same general shape as upstream SRS.
- Opens the UDP voice socket, performs the 22-byte GUID keepalive handshake, and decodes upstream SRS UDP voice packet framing.
- Logs client/radio updates and received voice packets.
- Supports optional local audio playback through PulseAudio/PipeWire.
- Supports minimal microphone transmit testing with push-to-talk.
- Includes an optional terminal UI for editing radios dynamically.

This is not yet a full desktop replacement for the Windows SRS client. It is a protocol-correct base for Linux development and testing.

## Run

```bash
python3 -m lxsrs_v2 --host server.sourcedcs.page --port 5002 --name lxsrs_v2 --freq 251.0 --freq 305.5
```

Enable experimental playback:

```bash
python3 -m lxsrs_v2 --host server.sourcedcs.page --port 5002 --name lxsrs_v2 --freq 251.0 --play-audio
```

Enable minimal transmit:

```bash
python3 -m lxsrs_v2 --host server.sourcedcs.page --port 5002 --name lxsrs_v2 --freq 251.0 --tx-freq 251.0
```

Default PTT mode is `stdin`: press `Enter` once to start transmitting and `Enter` again to stop.

For actual hold-to-talk, use:

```bash
python3 -m lxsrs_v2 --host server.sourcedcs.page --port 5002 --name lxsrs_v2 --freq 251.0 --tx-freq 251.0 --ptt-mode pynput
```

`pynput` mode uses right Ctrl as PTT and requires the `pynput` package.

Enable the terminal UI:

```bash
python3 -m lxsrs_v2 --host server.sourcedcs.page --port 5002 --name lxsrs_v2 --freq 251.0 --tx-freq 251.0 --ui
```

Choose devices from the CLI if needed:

```bash
python3 -m lxsrs_v2 --freq 251.0 --tx-freq 251.0 --ui --mic-device 2 --speaker-sink bluez_output.1C_6E_4C_9F_35_73.1
```

UI keys:

- `Up/Down`: select radio slot
- `Enter`: set selected slot as TX radio
- `+` / `-`: tune selected slot by `0.025 MHz`
- `e`: enter an exact frequency in MHz
- `a`: add/enable another radio slot
- `d`: disable the selected slot
- `m`: cycle modulation `AM -> FM -> INTERCOM -> DISABLED`
- `i`: open input-device picker
- `o`: open output-device picker
- `p`: toggle PTT
- `q`: quit

Device picker keys:

- `Up/Down`: select a device/sink
- `Enter`: apply the selected device/sink
- `t`: test the highlighted output sink
- `Esc` or `q`: close the picker

## Notes

- Frequencies on the CLI are in MHz.
- Frequencies sent to SRS are converted to Hz.
- Audio playback is optional so the client can still run in protocol-monitor mode on minimal Linux installs.
- TX currently sends AM, no encryption, on one selected frequency.
- Radio count is dynamic in the UI up to the SRS protocol limit of `11` radios.
- Input device changes in the UI reopen microphone capture on the new device.
- Output sink changes in the UI apply to subsequent playback and use PulseAudio/PipeWire sink names.
- TX dependencies are `opuslib`, `numpy`, and `sounddevice`. Playback uses `libpulse-simple`. `pynput` is optional for global hold-to-talk.
