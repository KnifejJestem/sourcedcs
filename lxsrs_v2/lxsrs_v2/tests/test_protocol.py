import pytest

from lxsrs_v2.models import Client, MessageType, default_radio_info
from lxsrs_v2.protocol import VoicePacket, decode_network_message, encode_network_message, GUID_LENGTH, UDP_HEADER_STRUCT


# ---------------------------------------------------------------------------
# VoicePacket encode / decode
# ---------------------------------------------------------------------------

def _make_packet(**overrides) -> VoicePacket:
    defaults = dict(
        audio_part1=b"\x01\x02\x03",
        frequencies=[251_000_000.0, 305_500_000.0],
        modulations=[0, 1],
        encryptions=[0, 1],
        unit_id=42,
        packet_number=7,
        retransmission_count=0,
        transmission_guid=b"1234567890123456789012",
        client_guid=b"abcdefghijklmnopqrstuv"[:GUID_LENGTH],
    )
    defaults.update(overrides)
    return VoicePacket(**defaults)


def test_voice_packet_round_trip() -> None:
    pkt = _make_packet()
    decoded = VoicePacket.decode(pkt.encode())
    assert decoded.audio_part1 == b"\x01\x02\x03"
    assert decoded.frequencies == [251_000_000.0, 305_500_000.0]
    assert decoded.modulations == [0, 1]
    assert decoded.encryptions == [0, 1]
    assert decoded.unit_id == 42
    assert decoded.packet_number == 7
    assert decoded.retransmission_count == 0
    assert decoded.transmission_guid == b"1234567890123456789012"
    assert decoded.client_guid == b"abcdefghijklmnopqrstuv"[:GUID_LENGTH]


def test_voice_packet_empty_frequencies() -> None:
    pkt = _make_packet(frequencies=[], modulations=[], encryptions=[])
    decoded = VoicePacket.decode(pkt.encode())
    assert decoded.frequencies == []
    assert decoded.modulations == []
    assert decoded.audio_part1 == b"\x01\x02\x03"


def test_voice_packet_empty_audio() -> None:
    pkt = _make_packet(audio_part1=b"")
    decoded = VoicePacket.decode(pkt.encode())
    assert decoded.audio_part1 == b""


def test_voice_packet_include_audio_false() -> None:
    pkt = _make_packet(audio_part1=b"\xAA\xBB\xCC")
    decoded = VoicePacket.decode(pkt.encode(), include_audio=False)
    assert decoded.audio_part1 == b""
    # Other fields must still be intact
    assert decoded.unit_id == 42
    assert decoded.frequencies == [251_000_000.0, 305_500_000.0]


def test_voice_packet_packet_length_mismatch_raises() -> None:
    data = _make_packet().encode()
    truncated = data[:-1]  # strip last byte
    with pytest.raises(ValueError, match="packet length mismatch"):
        VoicePacket.decode(truncated)


def test_voice_packet_too_short_raises() -> None:
    with pytest.raises(ValueError, match="packet too short"):
        VoicePacket.decode(b"\x00\x01")  # far too short


def test_voice_packet_mismatched_list_lengths_raises_on_encode() -> None:
    pkt = _make_packet(frequencies=[1.0], modulations=[0, 1], encryptions=[0])
    with pytest.raises(ValueError):
        pkt.encode()


def test_voice_packet_large_packet_number() -> None:
    large = 2**63 - 1
    pkt = _make_packet(packet_number=large)
    decoded = VoicePacket.decode(pkt.encode())
    assert decoded.packet_number == large


# ---------------------------------------------------------------------------
# Network message encode / decode
# ---------------------------------------------------------------------------

def test_network_message_contains_radio_info() -> None:
    client = Client(ClientGuid="1234567890123456789012", Name="pytest", RadioInfo=default_radio_info([251_000_000.0]))
    payload = encode_network_message(MessageType.SYNC, client, "2.3.3.3")
    decoded = decode_network_message(payload)
    assert decoded["MsgType"] == MessageType.SYNC
    assert decoded["Client"]["RadioInfo"]["radios"][0]["freq"] == 251_000_000.0


def test_encode_produces_newline_terminated_bytes() -> None:
    client = Client(ClientGuid="a" * 22, Name="x")
    payload = encode_network_message(MessageType.PING, client, "2.3.3.3")
    assert isinstance(payload, bytes)
    assert payload.endswith(b"\n")


def test_decode_strips_leading_trailing_whitespace() -> None:
    raw = b'  {"MsgType": 1, "Client": {}}  \n'
    decoded = decode_network_message(raw)
    assert decoded["MsgType"] == 1


def test_decode_accepts_str_input() -> None:
    raw = '{"MsgType": 2}'
    decoded = decode_network_message(raw)
    assert decoded["MsgType"] == 2


def test_encode_decode_round_trip_sync() -> None:
    client = Client(ClientGuid="b" * 22, Name="roundtrip", Coalition=2)
    payload = encode_network_message(MessageType.SYNC, client, "2.3.3.3")
    decoded = decode_network_message(payload)
    assert decoded["Client"]["Name"] == "roundtrip"
    assert decoded["Client"]["Coalition"] == 2
    assert decoded["Version"] == "2.3.3.3"


def test_client_without_radio_info() -> None:
    client = Client(ClientGuid="c" * 22, Name="noradio", RadioInfo=None)
    payload = encode_network_message(MessageType.UPDATE, client, "2.3.3.3")
    decoded = decode_network_message(payload)
    assert decoded["Client"]["RadioInfo"] is None
