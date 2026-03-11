"""Tests for miztoyaml.weapons — CLSID lookup, loadout condensing, ATO encoding."""

import pytest

from tools.miztoyaml.weapons import (
    CARRIER_TYPES,
    TASK_LABELS,
    condense_loadout,
    encode_loadout,
    resolve_clsid,
)


class TestResolveClsid:
    def test_known_clsid(self):
        # weaponsdata.json should have at least some entries
        # We can't test specific CLSIDs without the file, but test fallback
        result = resolve_clsid("{UNKNOWN-CLSID-HERE}")
        assert result == "UNKNOWN-CLSID-HERE"

    def test_braces_stripped(self):
        assert resolve_clsid("{XYZ}") == "XYZ"

    def test_no_braces(self):
        assert resolve_clsid("ABC") == "ABC"


class TestCondenseLoadout:
    def test_empty(self):
        assert condense_loadout([]) == []

    def test_fuel_tank_skipped(self):
        assert condense_loadout(["Fuel Tank"]) == []

    def test_ecm_pod_skipped(self):
        assert condense_loadout(["ECM Pod"]) == []

    def test_targeting_pod_skipped(self):
        assert condense_loadout(["Targeting Pod"]) == []

    def test_single_aim120(self):
        result = condense_loadout(["AIM-120C"])
        assert result == ["AIM-120C"]

    def test_multiple_aim120(self):
        result = condense_loadout(["AIM-120C", "AIM-120C"])
        assert result == ["2× AIM-120C"]

    def test_rack_format(self):
        result = condense_loadout(["LAU-88 with 3 x AGM-65D"])
        assert result == ["3× AGM-65D"]

    def test_mixed_loadout(self):
        result = condense_loadout([
            "AIM-120C", "AIM-120C",
            "AIM-9X", "AIM-9X",
            "GBU-38",
        ])
        assert "2× AIM-120C" in result
        assert "2× AIM-9X" in result
        assert "GBU-38" in result

    def test_unrecognized_skipped(self):
        result = condense_loadout(["SomeWeirdThing"])
        assert result == []

    def test_leading_count(self):
        result = condense_loadout(["2 x GBU-38"])
        assert result == ["2× GBU-38"]

    def test_litening_skipped(self):
        assert condense_loadout(["Litening II"]) == []

    def test_mk82(self):
        result = condense_loadout(["Mk-82", "Mk-82"])
        assert result == ["2× Mk-82"]

    def test_harm(self):
        result = condense_loadout(["AGM-88C HARM"])
        assert result == ["AGM-88C HARM"]


class TestEncodeLoadout:
    def test_empty(self):
        assert encode_loadout([], "CAP") == "000"

    def test_fox3_only(self):
        result = encode_loadout(["4× AIM-120C"], "CAP")
        assert result.startswith("40")

    def test_fox2_only(self):
        result = encode_loadout(["2× AIM-9X"], "CAP")
        assert result[2] == "2"

    def test_mixed_aa(self):
        result = encode_loadout(["4× AIM-120C", "2× AIM-9X"], "CAP")
        assert result.startswith("4")
        assert result[2] == "2"

    def test_agm_encoding(self):
        result = encode_loadout(["4× GBU-38"], "STRIKE")
        assert "X38" in result

    def test_gun_marker_cap(self):
        result = encode_loadout(["2× AIM-120C"], "CAP")
        assert "+" in result

    def test_no_gun_for_ferry(self):
        result = encode_loadout(["2× AIM-120C"], "FERRY")
        assert "+" not in result

    def test_capped_at_9(self):
        result = encode_loadout(["12× AIM-120C"], "CAP")
        assert result[0] == "9"

    def test_harm_encoding(self):
        result = encode_loadout(["2× AGM-88C HARM"], "SEAD")
        assert "X88C" in result


class TestCarrierTypes:
    def test_cvn_75(self):
        assert "CVN_75" in CARRIER_TYPES

    def test_tarawa(self):
        assert "LHA_Tarawa" in CARRIER_TYPES


class TestTaskLabels:
    def test_cap(self):
        assert TASK_LABELS["CAP"] == "CAP"

    def test_refueling(self):
        assert TASK_LABELS["Refueling"] == "TANKER"

    def test_awacs(self):
        assert TASK_LABELS["AWACS"] == "AWACS"

    def test_nothing(self):
        assert TASK_LABELS["Nothing"] == "FERRY"
