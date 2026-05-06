from __future__ import annotations

from dataclasses import dataclass
import json
import struct
from typing import Any

from .models import Client, MessageType


GUID_LENGTH = 22
UDP_HEADER_STRUCT = struct.Struct("<HHH")
FREQUENCY_SEGMENT_STRUCT = struct.Struct("<dBB")
UDP_FIXED_STRUCT = struct.Struct("<IQB")


def encode_network_message(msg_type: MessageType, client: Client, version: str) -> bytes:
    payload = {
        "Client": client.to_dict(),
        "MsgType": int(msg_type),
        "Version": version,
    }
    return (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")


def decode_network_message(raw_line: bytes | str) -> dict[str, Any]:
    if isinstance(raw_line, bytes):
        raw_line = raw_line.decode("utf-8")
    return json.loads(raw_line)


@dataclass
class VoicePacket:
    audio_part1: bytes
    frequencies: list[float]
    modulations: list[int]
    encryptions: list[int]
    unit_id: int
    packet_number: int
    retransmission_count: int
    transmission_guid: bytes
    client_guid: bytes

    def encode(self) -> bytes:
        audio_len = len(self.audio_part1)
        frequency_blob = b"".join(
            FREQUENCY_SEGMENT_STRUCT.pack(freq, mod, enc)
            for freq, mod, enc in zip(self.frequencies, self.modulations, self.encryptions, strict=True)
        )
        fixed_blob = (
            UDP_FIXED_STRUCT.pack(self.unit_id, self.packet_number, self.retransmission_count)
            + self.transmission_guid
            + self.client_guid
        )
        packet_length = UDP_HEADER_STRUCT.size + audio_len + len(frequency_blob) + len(fixed_blob)
        return (
            UDP_HEADER_STRUCT.pack(packet_length, audio_len, len(frequency_blob))
            + self.audio_part1
            + frequency_blob
            + fixed_blob
        )

    @classmethod
    def decode(cls, data: bytes, *, include_audio: bool = True) -> "VoicePacket":
        if len(data) < UDP_HEADER_STRUCT.size:
            raise ValueError(f"packet too short: {len(data)} bytes, need at least {UDP_HEADER_STRUCT.size}")
        packet_length, audio_len, freq_len = UDP_HEADER_STRUCT.unpack_from(data, 0)
        if packet_length != len(data):
            raise ValueError(f"packet length mismatch: header={packet_length} actual={len(data)}")
        audio_part1 = data[UDP_HEADER_STRUCT.size:UDP_HEADER_STRUCT.size + audio_len] if include_audio else b""

        frequencies: list[float] = []
        modulations: list[int] = []
        encryptions: list[int] = []
        offset = UDP_HEADER_STRUCT.size + audio_len
        for _ in range(freq_len // FREQUENCY_SEGMENT_STRUCT.size):
            freq, mod, enc = FREQUENCY_SEGMENT_STRUCT.unpack_from(data, offset)
            frequencies.append(freq)
            modulations.append(mod)
            encryptions.append(enc)
            offset += FREQUENCY_SEGMENT_STRUCT.size

        unit_id, packet_number, retransmission_count = UDP_FIXED_STRUCT.unpack_from(data, offset)
        offset += UDP_FIXED_STRUCT.size
        transmission_guid = data[offset:offset + GUID_LENGTH]
        offset += GUID_LENGTH
        client_guid = data[offset:offset + GUID_LENGTH]
        return cls(
            audio_part1=audio_part1,
            frequencies=frequencies,
            modulations=modulations,
            encryptions=encryptions,
            unit_id=unit_id,
            packet_number=packet_number,
            retransmission_count=retransmission_count,
            transmission_guid=transmission_guid,
            client_guid=client_guid,
        )
