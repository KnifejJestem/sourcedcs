from __future__ import annotations

import json
import logging
import re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .client import SRSClient

LOG = logging.getLogger(__name__)

_SLOT_ROUTE = re.compile(r"^/api/radio/(\d+)/(freq|mod|tx|disable|volume)$")


class SrsApiServer:
    """Threaded HTTP control API for use by the CRC web frontend."""

    def __init__(self, client: "SRSClient", port: int = 5003) -> None:
        self._client = client
        self._port = port
        self._server: HTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        client = self._client

        class _Handler(BaseHTTPRequestHandler):
            def _cors(self) -> None:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")

            def _send_json(self, data: bytes, status: int = 200) -> None:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self._cors()
                self.end_headers()
                self.wfile.write(data)

            def do_OPTIONS(self) -> None:  # type: ignore[override]
                self.send_response(200)
                self._cors()
                self.end_headers()

            def do_GET(self) -> None:  # type: ignore[override]
                if self.path == "/api/state":
                    snap = client.get_ui_snapshot()
                    payload = {
                        "udp_ready": snap["udp_ready"],
                        "ptt": snap["ptt"],
                        "input_volume": snap["input_volume"],
                        "output_volume": snap["output_volume"],
                        "mic_source": snap["mic_device"],  # str | null — PA source name
                        "speaker_sink": snap["speaker_sink"],
                        "status": snap.get("status_message", ""),
                        "radio_volumes": snap.get("radio_volumes", []),
                        "sound_set": snap.get("sound_set", "RADIO_TRANS"),
                        "noise_enabled": snap.get("noise_enabled", True),
                        "radios": [
                            {
                                "slot": row.slot,
                                "freq_mhz": round(row.freq_mhz, 3),
                                "modulation": row.modulation,
                                "tx": row.tx,
                            }
                            for row in snap["rows"]
                        ],
                    }
                    self._send_json(json.dumps(payload).encode())
                elif self.path == "/api/devices":
                    inputs = [
                        {"name": s.name, "description": s.description, "state": s.state}
                        for s in client.list_input_sources()
                    ]
                    outputs = [
                        {"name": s.name, "description": s.description, "state": s.state}
                        for s in client.list_output_sinks()
                    ]
                    self._send_json(json.dumps({"inputs": inputs, "outputs": outputs}).encode())
                else:
                    self.send_error(404)

            def do_POST(self) -> None:  # type: ignore[override]
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length) if length else b""
                try:
                    body: dict = json.loads(raw) if raw else {}
                except Exception:
                    body = {}

                path = self.path
                try:
                    if path == "/api/ptt/start":
                        client.transmit_ptt_down()
                    elif path == "/api/ptt/stop":
                        client.transmit_ptt_up()
                    elif path == "/api/device/test-input":
                        import threading
                        threading.Thread(
                            target=client.test_mic_device,
                            args=(client.mic_source,),
                            daemon=True,
                            name="mic-test",
                        ).start()
                    elif path == "/api/radio/add":
                        client.add_radio()
                    elif path == "/api/volume/input":
                        client.set_input_volume(float(body["volume"]))
                    elif path == "/api/volume/output":
                        client.set_output_volume(float(body["volume"]))
                    elif path == "/api/device/input":
                        # value is null (default) or a PulseAudio source name string
                        client.set_mic_source(body.get("source") or None)
                    elif path == "/api/device/output":
                        client.set_speaker_sink(body.get("sink") or None)
                    elif path == "/api/settings/sound-set":
                        client.set_sound_set(body.get("sound_set", "RADIO_TRANS"))
                    elif path == "/api/settings/noise":
                        client.set_noise_enabled(bool(body.get("enabled", True)))
                    else:
                        m = _SLOT_ROUTE.match(path)
                        if not m:
                            self.send_error(404)
                            return
                        slot, action = int(m.group(1)), m.group(2)
                        if action == "freq":
                            client.set_frequency(slot, float(body["freq_mhz"]))
                        elif action == "mod":
                            client.cycle_modulation(slot)
                        elif action == "tx":
                            client.set_tx_slot(slot)
                        elif action == "disable":
                            client.disable_radio(slot)
                        elif action == "volume":
                            client.set_radio_volume(slot, float(body["volume"]))
                except Exception:
                    LOG.exception("API handler error on %s", path)
                    self._send_json(b'{"error":"internal"}', 500)
                    return

                self._send_json(b"{}")

            def log_message(self, fmt: str, *args: object) -> None:
                pass  # suppress per-request logs

        try:
            self._server = HTTPServer(("127.0.0.1", self._port), _Handler)
        except OSError:
            LOG.exception("Failed to bind SRS API server on port %d", self._port)
            return

        self._thread = threading.Thread(
            target=self._server.serve_forever,
            daemon=True,
            name="srs-api",
        )
        self._thread.start()
        LOG.info("SRS API server listening on http://127.0.0.1:%d", self._port)

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server = None
