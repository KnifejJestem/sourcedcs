from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any
import re


MAX_RADIOS = 11


class MessageType(IntEnum):
    UPDATE = 0
    PING = 1
    SYNC = 2
    RADIO_UPDATE = 3
    SERVER_SETTINGS = 4
    CLIENT_DISCONNECT = 5
    VERSION_MISMATCH = 6
    EXTERNAL_AWACS_MODE_PASSWORD = 7
    EXTERNAL_AWACS_MODE_DISCONNECT = 8
    GATEWAY_CLIENT_FULL_UPDATE = 9
    GATEWAY_CLIENT_METADATA_UPDATE = 10
    GATEWAY_CLIENT_DISCONNECT = 11


class Modulation(IntEnum):
    AM = 0
    FM = 1
    INTERCOM = 2
    DISABLED = 3
    HAVEQUICK = 4
    SATCOM = 5
    MIDS = 6
    SINCGARS = 7


def _clean_radio_label(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]", "", (value or "").strip().lower())
    return cleaned[:32]


@dataclass
class LatLngPosition:
    lat: float = 0.0
    lng: float = 0.0
    alt: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {
            "lat": round(self.lat, 5) if self.lat else 0.0,
            "lng": round(self.lng, 5) if self.lng else 0.0,
            "alt": round(self.alt, 5) if self.alt else 0.0,
        }


@dataclass
class Ambient:
    vol: float = 0.0
    abType: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"vol": self.vol, "abType": self.abType}


@dataclass
class Transponder:
    control: int = 2
    expansion: bool = False
    mic: int = -1
    mode1: int = -1
    mode2: int = -1
    mode3: int = -1
    mode4: bool = False
    status: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "control": self.control,
            "expansion": self.expansion,
            "mic": self.mic,
            "mode1": self.mode1,
            "mode2": self.mode2,
            "mode3": self.mode3,
            "mode4": self.mode4,
            "status": self.status,
        }


@dataclass
class Radio:
    freq: float = 1.0
    modulation: Modulation = Modulation.DISABLED
    enc: bool = False
    encKey: int = 0
    retransmit: bool = False
    secFreq: float = 1.0
    Model: str = ""
    IntercomUnitId: int = 0
    Name: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "enc": self.enc,
            "encKey": self.encKey,
            "freq": self.freq,
            "modulation": int(self.modulation),
            "retransmit": self.retransmit,
            "secFreq": self.secFreq,
            "Model": _clean_radio_label(self.Model),
            "Name": _clean_radio_label(self.Name),
            "IntercomUnitId": self.IntercomUnitId,
        }


@dataclass
class PlayerRadioInfo:
    ambient: Ambient = field(default_factory=Ambient)
    iff: Transponder = field(default_factory=Transponder)
    radios: list[Radio] = field(default_factory=lambda: [Radio() for _ in range(MAX_RADIOS)])
    unit: str = ""
    unitId: int = 0
    selected: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "ambient": self.ambient.to_dict(),
            "iff": self.iff.to_dict(),
            "radios": [radio.to_dict() for radio in self.radios],
            "unit": self.unit,
            "unitId": self.unitId,
            "radioIndex": self.selected,
        }


@dataclass
class Client:
    ClientGuid: str
    Name: str
    Coalition: int = 0
    AllowRecord: bool = False
    Seat: int = 0
    RadioInfo: PlayerRadioInfo | None = None
    LatLngPosition: LatLngPosition = field(default_factory=LatLngPosition)
    Gateway: bool = False
    GatewayClient: bool = False
    DISEntityId: int = -1

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ClientGuid": self.ClientGuid,
            "Name": self.Name or "---",
            "Coalition": self.Coalition,
            "AllowRecord": self.AllowRecord,
            "Seat": self.Seat,
            "LatLngPosition": self.LatLngPosition.to_dict(),
            "Gateway": self.Gateway,
            "GatewayClient": self.GatewayClient,
            "DISEntityId": self.DISEntityId,
        }
        if self.RadioInfo is not None:
            payload["RadioInfo"] = self.RadioInfo.to_dict()
        else:
            payload["RadioInfo"] = None
        return payload


def default_radio_info(frequencies_hz: list[float], modulation: Modulation = Modulation.AM) -> PlayerRadioInfo:
    radios = [Radio() for _ in range(MAX_RADIOS)]
    for index, freq in enumerate(frequencies_hz[:MAX_RADIOS]):
        radios[index] = Radio(
            freq=freq,
            modulation=modulation,
            secFreq=1.0,
            Model=f"linux{index + 1}",
            Name=f"linux{index + 1}",
        )
    return PlayerRadioInfo(radios=radios)


def make_radio(freq_hz: float, *, modulation: Modulation = Modulation.AM, name: str = "linux") -> Radio:
    return Radio(
        freq=freq_hz,
        modulation=modulation,
        secFreq=1.0,
        Model=name,
        Name=name,
    )
