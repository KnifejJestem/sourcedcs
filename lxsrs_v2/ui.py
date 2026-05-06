from __future__ import annotations

import curses
from dataclasses import dataclass
import logging
import time
from typing import TYPE_CHECKING

from .audio import AudioDevice
from .pulse import PulseSink
from .models import MAX_RADIOS

if TYPE_CHECKING:
    from .client import SRSClient


LOG = logging.getLogger(__name__)


@dataclass
class RadioRow:
    slot: int
    freq_mhz: float
    modulation: str
    tx: bool


class CursesUI:
    def __init__(self, client: "SRSClient") -> None:
        self.client = client
        self.selected_slot = 0
        self.scroll_offset = 0
        self.device_scroll_offset = 0
        self.device_mode: str | None = None
        self.device_selection = 0
        self._last_test_at = 0.0
        self._last_p_at = 0.0
        self._status = "Ready"

    def run(self) -> None:
        try:
            curses.wrapper(self._main)
        except Exception:
            # If curses crashes, we still want the client to be able to shutdown gracefully
            # though this is a bit of a last resort
            LOG.exception("Curses UI crashed")
            self.client.request_shutdown()

    def _main(self, stdscr) -> None:  # type: ignore[no-untyped-def]
        curses.curs_set(0)
        stdscr.timeout(100)
        stdscr.keypad(True)
        while not self.client.stop_requested:
            try:
                snapshot = self.client.get_ui_snapshot()
                if self.device_mode is None:
                    self.selected_slot = min(self.selected_slot, max(0, len(snapshot["rows"]) - 1))
                self._draw(stdscr, snapshot)
                key = stdscr.getch()
                
                # Handle momentary PTT for 'p' key via auto-repeat heartbeat
                if snapshot["ptt"] and self.client.ptt_mode == "ui":
                    if time.monotonic() - self._last_p_at > 0.6:
                        self.client.transmit_ptt_up()
                        self._status = "PTT released"

                if key == -1: # timeout or no key
                    continue
                if key in (ord("q"), 27):
                    self.client.request_shutdown()
                    return
                self._handle_key(key, snapshot, stdscr)
            except Exception:
                LOG.exception("Error in UI loop")
                self._status = "UI Error: Check log"
                time.sleep(0.1)

    def _draw(self, stdscr, snapshot: dict) -> None:  # type: ignore[no-untyped-def]
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        if self.device_mode is not None:
            self._draw_device_picker(stdscr, snapshot, height, width)
            stdscr.refresh()
            return
        rows: list[RadioRow] = snapshot["rows"]
        table_start = 6
        visible_rows = max(1, height - table_start - 1)
        self._adjust_scroll(len(rows), visible_rows)
        stdscr.addstr(0, 0, "lxsrs_v2 UI")
        stdscr.addstr(1, 0, f"UDP: {'ready' if snapshot['udp_ready'] else 'waiting'}   PTT: {'on' if snapshot['ptt'] else 'off'}")
        stdscr.addstr(2, 0, "Arrows: move  Enter: set TX  +/-: tune  e: exact freq  a: add  d: disable  m: mod  p: hold to talk  i/o: devices  []/{}: volume  q: quit"[: max(0, width - 1)])
        stdscr.addstr(3, 0, f"Mic: {self._device_label(snapshot['mic_device'])} ({snapshot['input_volume']:.1f}x)   Spk: {self._sink_label(snapshot['speaker_sink'])} ({snapshot['output_volume']:.1f}x)"[: max(0, width - 1)])
        status = snapshot.get("status_message") or self._status
        stdscr.addstr(4, 0, f"Status: {status}"[: max(0, width - 1)])
        stdscr.addstr(5, 0, "Slot  TX  Mod   Freq MHz")
        visible = rows[self.scroll_offset:self.scroll_offset + visible_rows]
        for visible_idx, row in enumerate(visible):
            idx = self.scroll_offset + visible_idx
            line = table_start + visible_idx
            if line >= height - 1:
                break
            prefix = ">" if idx == self.selected_slot else " "
            tx = "*" if row.tx else " "
            stdscr.addstr(line, 0, f"{prefix} {row.slot + 1:>2}   {tx}  {row.modulation:<9} {row.freq_mhz:>8.3f}"[: max(0, width - 1)])
        stdscr.refresh()

    def _handle_key(self, key: int, snapshot: dict, stdscr) -> None:  # type: ignore[no-untyped-def]
        if self.device_mode is not None:
            self._handle_device_key(key)
            return
        rows: list[RadioRow] = snapshot["rows"]
        if key == curses.KEY_UP:
            self.selected_slot = max(0, self.selected_slot - 1)
        elif key == curses.KEY_DOWN:
            self.selected_slot = min(max(0, len(rows) - 1), self.selected_slot + 1)
        elif key in (10, 13):
            self.client.set_tx_slot(self.selected_slot)
            self._status = f"TX slot set to {self.selected_slot + 1}"
        elif key == ord("+"):
            self.client.adjust_frequency(self.selected_slot, 0.025)
            self._status = f"Slot {self.selected_slot + 1} tuned up"
        elif key == ord("-"):
            self.client.adjust_frequency(self.selected_slot, -0.025)
            self._status = f"Slot {self.selected_slot + 1} tuned down"
        elif key == ord("a"):
            slot = self.client.add_radio()
            self.selected_slot = slot
            self._status = f"Added radio slot {slot + 1}"
        elif key == ord("d"):
            self.client.disable_radio(self.selected_slot)
            self._status = f"Disabled slot {self.selected_slot + 1}"
        elif key == ord("m"):
            self.client.cycle_modulation(self.selected_slot)
            self._status = f"Changed modulation on slot {self.selected_slot + 1}"
        elif key == ord("p"):
            self._last_p_at = time.monotonic()
            if not snapshot["ptt"]:
                self.client.transmit_ptt_down()
                self._status = "PTT active (hold)"
            # Ensure ptt_up logic is bypassed immediately when p is pressed
            return
        elif key == ord("e"):
            value = self._prompt_frequency(stdscr)
            if value is not None:
                self.client.set_frequency(self.selected_slot, value)
                self._status = f"Slot {self.selected_slot + 1} set to {value:.3f}"
        elif key == ord("i"):
            self._open_device_picker("input")
        elif key == ord("o"):
            self._open_device_picker("output")
        elif key == ord("["):
            self.client.set_input_volume(snapshot["input_volume"] - 0.1)
        elif key == ord("]"):
            self.client.set_input_volume(snapshot["input_volume"] + 0.1)
        elif key == ord("{"):
            self.client.set_output_volume(snapshot["output_volume"] - 0.1)
        elif key == ord("}"):
            self.client.set_output_volume(snapshot["output_volume"] + 0.1)

    def _prompt_frequency(self, stdscr) -> float | None:  # type: ignore[no-untyped-def]
        curses.echo()
        curses.curs_set(1)
        # Disable timeout for getstr to avoid it returning immediately
        old_timeout = stdscr.getmaxyx()[0] # dummy
        stdscr.timeout(-1)
        try:
            height, width = stdscr.getmaxyx()
            prompt_row = max(0, height - 1)
            prompt = "Enter frequency in MHz: "
            input_col = min(len(prompt), max(0, width - 2))
            input_width = max(1, width - input_col - 1)
            stdscr.move(prompt_row, 0)
            stdscr.clrtoeol()
            stdscr.addstr(prompt_row, 0, prompt[: max(0, width - 1)])
            value = stdscr.getstr(prompt_row, input_col, input_width).decode("utf-8").strip()
            if not value:
                return None
            return float(value)
        except ValueError:
            self._status = "Invalid frequency"
            return None
        except curses.error:
            self._status = "Terminal too small for frequency prompt"
            return None
        finally:
            stdscr.timeout(100) # Restore timeout
            curses.noecho()
            curses.curs_set(0)

    def _adjust_scroll(self, total_rows: int, visible_rows: int) -> None:
        if total_rows <= visible_rows:
            self.scroll_offset = 0
            return
        if self.selected_slot < self.scroll_offset:
            self.scroll_offset = self.selected_slot
        elif self.selected_slot >= self.scroll_offset + visible_rows:
            self.scroll_offset = self.selected_slot - visible_rows + 1

    def _open_device_picker(self, mode: str) -> None:
        self.device_mode = mode
        self.device_selection = 0
        self.device_scroll_offset = 0
        self._status = f"Selecting {mode} device"

    def _draw_device_picker(self, stdscr, snapshot: dict, height: int, width: int) -> None:  # type: ignore[no-untyped-def]
        devices = self._filtered_devices()
        title = "Input Devices" if self.device_mode == "input" else "Output Devices"
        stdscr.addstr(0, 0, title)
        help_line = "Arrows: move  Enter: select  Esc/q: back"
        if self.device_mode == "input":
            help_line = "Arrows: move  Enter: select  t: test  Esc/q: back"
        if self.device_mode == "output":
            help_line = "Arrows: move  Enter: select  t: test  Esc/q: back"
        stdscr.addstr(1, 0, help_line[: max(0, width - 1)])
        current = snapshot["mic_device"] if self.device_mode == "input" else snapshot["speaker_sink"]
        current_label = self._device_label(current) if self.device_mode == "input" else self._sink_label(current)
        stdscr.addstr(2, 0, f"> highlighted   * active   Current: {current_label}"[: max(0, width - 1)])
        visible_rows = max(1, height - 4)
        self._adjust_device_scroll(len(devices), visible_rows)
        visible = devices[self.device_scroll_offset:self.device_scroll_offset + visible_rows]
        for visible_idx, device in enumerate(visible):
            idx = self.device_scroll_offset + visible_idx
            marker = ">" if idx == self.device_selection else " "
            if self.device_mode == "input":
                current_marker = "*" if current == device.index else " "
                unusable = " !unusable" if device.index >= 0 and not device.usable_input else ""
                label_index = "df" if device.index < 0 else f"{device.index:>2}"
                label = f"{marker} {current_marker} [{label_index}] {device.name} ({int(device.default_samplerate)} Hz){unusable}"
            else:
                current_marker = "*" if current == device.name else " "
                label = f"{marker} {current_marker} {device.name} [{device.state}]"
            stdscr.addstr(4 + visible_idx, 0, label[: max(0, width - 1)])

    def _filtered_devices(self) -> list[AudioDevice] | list[PulseSink]:
        if self.device_mode == "input":
            devices = self.client.list_audio_devices()
            return [device for device in devices if device.max_input_channels > 0]
        return self.client.list_output_sinks()

    def _adjust_device_scroll(self, total_rows: int, visible_rows: int) -> None:
        if total_rows <= visible_rows:
            self.device_scroll_offset = 0
            return
        if self.device_selection < self.device_scroll_offset:
            self.device_scroll_offset = self.device_selection
        elif self.device_selection >= self.device_scroll_offset + visible_rows:
            self.device_scroll_offset = self.device_selection - visible_rows + 1

    def _device_label(self, device: int | None) -> str:
        if device is None:
            return "default"
        return str(device)

    def _sink_label(self, sink_name: str | None) -> str:
        if sink_name is None:
            return "default"
        return sink_name

    def _handle_device_key(self, key: int) -> None:
        devices = self._filtered_devices()
        if key in (27, ord("q")):
            self.device_mode = None
            self._status = "Ready"
            return
        if not devices:
            self.device_mode = None
            self._status = "No matching audio devices found"
            return
        if key == curses.KEY_UP:
            self.device_selection = max(0, self.device_selection - 1)
        elif key == curses.KEY_DOWN:
            self.device_selection = min(len(devices) - 1, self.device_selection + 1)
        elif key in (10, 13):
            selected = devices[self.device_selection]
            if self.device_mode == "input":
                self.client.set_mic_device(selected.index)
                self._status = f"Mic device set to {selected.index}"
            else:
                self.client.set_speaker_sink(selected.name)
                self._status = f"Speaker sink set to {selected.name}"
            self.device_mode = None
        elif key == ord("t") and self.device_mode == "input":
            if self._test_debounced():
                return
            highlighted = devices[self.device_selection]
            if highlighted.index >= 0 and not highlighted.usable_input:
                self._status = f"Mic {highlighted.index} is not usable; try default or another device"
                return
            self.client.test_mic_device(highlighted.index)
            name = "default" if highlighted.index < 0 else str(highlighted.index)
            self._status = f"Tested highlighted mic {name}"
        elif key == ord("t") and self.device_mode == "output":
            if self._test_debounced():
                return
            highlighted = devices[self.device_selection]
            self.client.test_speaker_sink(highlighted.name)
            self._status = f"Played test tone on highlighted sink"

    def _test_debounced(self) -> bool:
        now = time.monotonic()
        if now - self._last_test_at < 0.4:
            return True
        self._last_test_at = now
        return False
