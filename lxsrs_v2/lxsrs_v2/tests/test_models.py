import pytest

from lxsrs_v2.models import (
    MAX_RADIOS,
    Client,
    LatLngPosition,
    Modulation,
    PlayerRadioInfo,
    Radio,
    Transponder,
    _clean_radio_label,
    default_radio_info,
    make_radio,
)


# ---------------------------------------------------------------------------
# _clean_radio_label
# ---------------------------------------------------------------------------

def test_clean_radio_label_alphanumeric_passthrough() -> None:
    assert _clean_radio_label("linux1") == "linux1"


def test_clean_radio_label_strips_special_chars() -> None:
    assert _clean_radio_label("hello world!") == "helloworld"


def test_clean_radio_label_empty_string() -> None:
    assert _clean_radio_label("") == ""


def test_clean_radio_label_none_equivalent() -> None:
    # `value or ""` branch — None-like empty input
    assert _clean_radio_label("") == ""


def test_clean_radio_label_truncates_to_32() -> None:
    long_name = "a" * 50
    result = _clean_radio_label(long_name)
    assert len(result) == 32


def test_clean_radio_label_strips_whitespace_before_clean() -> None:
    assert _clean_radio_label("  foo  ") == "foo"


def test_clean_radio_label_lowercases() -> None:
    assert _clean_radio_label("LINUX1") == "linux1"


# ---------------------------------------------------------------------------
# LatLngPosition
# ---------------------------------------------------------------------------

def test_latlng_defaults_are_zero() -> None:
    pos = LatLngPosition()
    d = pos.to_dict()
    assert d == {"lat": 0.0, "lng": 0.0, "alt": 0.0}


def test_latlng_rounds_to_5_decimal_places() -> None:
    pos = LatLngPosition(lat=1.123456789, lng=2.987654321, alt=100.1)
    d = pos.to_dict()
    assert d["lat"] == round(1.123456789, 5)
    assert d["lng"] == round(2.987654321, 5)


def test_latlng_zero_values_return_zero() -> None:
    pos = LatLngPosition(lat=0.0, lng=0.0, alt=0.0)
    d = pos.to_dict()
    assert d["lat"] == 0.0
    assert d["lng"] == 0.0
    assert d["alt"] == 0.0


# ---------------------------------------------------------------------------
# Radio
# ---------------------------------------------------------------------------

def test_radio_default_modulation_disabled() -> None:
    r = Radio()
    assert r.modulation == Modulation.DISABLED


def test_radio_to_dict_keys() -> None:
    r = Radio(freq=251_000_000.0, modulation=Modulation.AM, Name="test", Model="test")
    d = r.to_dict()
    for key in ("enc", "encKey", "freq", "modulation", "retransmit", "secFreq", "Model", "Name", "IntercomUnitId"):
        assert key in d


def test_radio_to_dict_modulation_is_int() -> None:
    r = Radio(modulation=Modulation.FM)
    assert isinstance(r.to_dict()["modulation"], int)
    assert r.to_dict()["modulation"] == int(Modulation.FM)


def test_radio_name_is_cleaned() -> None:
    r = Radio(Name="My Radio!", Model="My Model!")
    d = r.to_dict()
    assert d["Name"] == "myradio"
    assert d["Model"] == "mymodel"


# ---------------------------------------------------------------------------
# PlayerRadioInfo
# ---------------------------------------------------------------------------

def test_player_radio_info_default_has_max_radios() -> None:
    info = PlayerRadioInfo()
    assert len(info.radios) == MAX_RADIOS


def test_player_radio_info_to_dict_structure() -> None:
    info = PlayerRadioInfo(unit="TestUnit", unitId=99)
    d = info.to_dict()
    assert d["unit"] == "TestUnit"
    assert d["unitId"] == 99
    assert isinstance(d["radios"], list)
    assert len(d["radios"]) == MAX_RADIOS
    assert "ambient" in d
    assert "iff" in d


# ---------------------------------------------------------------------------
# default_radio_info
# ---------------------------------------------------------------------------

def test_default_radio_info_sets_first_freq() -> None:
    info = default_radio_info([251_000_000.0])
    assert info.radios[0].freq == 251_000_000.0
    assert info.radios[0].modulation == Modulation.AM


def test_default_radio_info_remaining_slots_disabled() -> None:
    info = default_radio_info([251_000_000.0])
    for radio in info.radios[1:]:
        assert radio.modulation == Modulation.DISABLED


def test_default_radio_info_empty_frequencies() -> None:
    info = default_radio_info([])
    assert len(info.radios) == MAX_RADIOS
    for radio in info.radios:
        assert radio.modulation == Modulation.DISABLED


def test_default_radio_info_multiple_frequencies() -> None:
    freqs = [251_000_000.0, 305_500_000.0, 243_000_000.0]
    info = default_radio_info(freqs)
    for i, freq in enumerate(freqs):
        assert info.radios[i].freq == freq
        assert info.radios[i].modulation == Modulation.AM
    for radio in info.radios[len(freqs):]:
        assert radio.modulation == Modulation.DISABLED


def test_default_radio_info_clips_to_max_radios() -> None:
    freqs = [float(i * 1_000_000) for i in range(1, MAX_RADIOS + 5)]
    info = default_radio_info(freqs)
    assert len(info.radios) == MAX_RADIOS


# ---------------------------------------------------------------------------
# make_radio
# ---------------------------------------------------------------------------

def test_make_radio_defaults() -> None:
    r = make_radio(251_000_000.0)
    assert r.freq == 251_000_000.0
    assert r.modulation == Modulation.AM
    assert r.secFreq == 1.0


def test_make_radio_custom_modulation() -> None:
    r = make_radio(305_000_000.0, modulation=Modulation.FM, name="test")
    assert r.modulation == Modulation.FM
    assert r.Name == "test"
    assert r.Model == "test"


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

def test_client_to_dict_contains_all_fields() -> None:
    c = Client(ClientGuid="a" * 22, Name="Pilot", Coalition=1)
    d = c.to_dict()
    for key in ("ClientGuid", "Name", "Coalition", "AllowRecord", "Seat", "LatLngPosition", "RadioInfo"):
        assert key in d


def test_client_default_name_fallback() -> None:
    c = Client(ClientGuid="a" * 22, Name="")
    d = c.to_dict()
    assert d["Name"] == "---"


def test_client_radio_info_none_serialises_as_null() -> None:
    c = Client(ClientGuid="a" * 22, Name="x", RadioInfo=None)
    d = c.to_dict()
    assert d["RadioInfo"] is None


def test_client_with_radio_info() -> None:
    radio_info = default_radio_info([251_000_000.0])
    c = Client(ClientGuid="a" * 22, Name="x", RadioInfo=radio_info)
    d = c.to_dict()
    assert d["RadioInfo"] is not None
    assert d["RadioInfo"]["radios"][0]["freq"] == 251_000_000.0


# ---------------------------------------------------------------------------
# Transponder
# ---------------------------------------------------------------------------

def test_transponder_to_dict_keys() -> None:
    t = Transponder()
    d = t.to_dict()
    for key in ("control", "expansion", "mic", "mode1", "mode2", "mode3", "mode4", "status"):
        assert key in d


# ---------------------------------------------------------------------------
# Modulation enum
# ---------------------------------------------------------------------------

def test_modulation_values() -> None:
    assert Modulation.AM == 0
    assert Modulation.FM == 1
    assert Modulation.INTERCOM == 2
    assert Modulation.DISABLED == 3
