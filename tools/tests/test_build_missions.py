"""Tests for miztoyaml.build_missions — mission building, steerpoint merging."""

import pytest

from tools.miztoyaml.build_missions import (
    AIRDROME_IDS,
    SPECIAL_WAYPOINT_TYPES,
    _ft_between_3d,
    _nm_between,
    _parse_dms_approx,
    _parse_special_waypoint,
    build_airfields_registry,
    build_missions,
    merge_shared_steerpoints,
)
from tools.miztoyaml.models import Carrier, Flight, FlightUnit, Waypoint


class TestNmBetween:
    def test_zero(self):
        assert _nm_between(0, 0, 0, 0) == 0.0

    def test_positive(self):
        # 1852m = 1 NM
        assert _nm_between(0, 0, 1852, 0) == pytest.approx(1.0)

    def test_diagonal(self):
        d = _nm_between(0, 0, 1852, 1852)
        assert d > 1.0


class TestFtBetween3d:
    def test_zero(self):
        assert _ft_between_3d(0, 0, 0, 0, 0, 0) == 0.0

    def test_altitude_only(self):
        result = _ft_between_3d(0, 0, 0, 0, 0, 1000)
        assert result == pytest.approx(1000.0)

    def test_null_altitudes(self):
        # None altitude defaults to 0
        result = _ft_between_3d(0, 0, None, 0, 0, None)
        assert result == 0.0


class TestParseSpecialWaypoint:
    def test_ip(self):
        assert _parse_special_waypoint("IP") == ("ip", None)

    def test_ip_with_name(self):
        assert _parse_special_waypoint("IP WEST") == ("ip", "WEST")

    def test_ep(self):
        assert _parse_special_waypoint("EP") == ("ep", None)

    def test_marshal(self):
        assert _parse_special_waypoint("MARSHAL") == ("marshal", None)

    def test_none(self):
        assert _parse_special_waypoint(None) == (None, None)

    def test_unknown(self):
        assert _parse_special_waypoint("WAYPOINT") == (None, None)

    def test_case_insensitive(self):
        assert _parse_special_waypoint("ip north") == ("ip", "NORTH")

    def test_empty(self):
        assert _parse_special_waypoint("") == (None, None)


class TestParseDmsApprox:
    def test_basic(self):
        coord = "N36°09'23\" E037°16'55\""
        lat, lon = _parse_dms_approx(coord)
        assert lat is not None
        assert lon is not None
        assert lat == pytest.approx(36.156, abs=0.01)
        assert lon == pytest.approx(37.282, abs=0.01)

    def test_south_west(self):
        coord = "S51°00'00\" W059°00'00\""
        lat, lon = _parse_dms_approx(coord)
        assert lat < 0
        assert lon < 0

    def test_invalid(self):
        lat, lon = _parse_dms_approx("garbage")
        assert lat is None
        assert lon is None


class TestBuildAirfieldsRegistry:
    def _make_flight(self, airdrome_id, link_unit_id=None):
        wp = Waypoint(name=None, x=0, y=0, lat=36.0, lon=37.0,
                      typ="TakeOffParking", airdrome_id=airdrome_id,
                      link_unit_id=link_unit_id, is_orbit=False)
        return Flight(id="FLT-1", name="TEST-1", task="CAP",
                      aircraft_type="F-16C_50", freq_mhz=251.0,
                      waypoints=[wp])

    def test_known_airfield(self):
        f = self._make_flight(16)  # Incirlik
        result = build_airfields_registry([f], [], "Syria")
        assert "LTAG" in result

    def test_unknown_airfield(self):
        f = self._make_flight(999)
        result = build_airfields_registry([f], [], "Syria")
        assert "AF999" in result

    def test_carrier_excluded(self):
        c = Carrier(id="CVN-1", type="CVN_75", name="TRUMAN",
                    unit_id=42, deploy_coords="", recovery_coords="")
        f = self._make_flight(None, link_unit_id=42)
        result = build_airfields_registry([f], [c], "Syria")
        assert len(result) == 0

    def test_empty(self):
        assert build_airfields_registry([], [], "Syria") == {}


class TestMergeSharedSteerpoints:
    def _make_sp(self, stype, x=0, y=0, alt=None, name=None):
        sp = {"coords": "N36°00'00\" E037°00'00\"", "special_type": stype,
              "_x": x, "_y": y}
        if alt is not None:
            sp["altitude_ft"] = alt
        if name is not None:
            sp["special_name"] = name
        return sp

    def test_merge_same_ip(self):
        flight_sps = {
            "VIPER-1": [self._make_sp("ip")],
            "VIPER-2": [self._make_sp("ip")],
        }
        shared, updated = merge_shared_steerpoints(flight_sps)
        assert len(shared) == 1
        assert shared[0]["id"] == "SSP-1"
        assert "VIPER-1" in shared[0]["flights"]
        assert "VIPER-2" in shared[0]["flights"]

    def test_no_merge_different_types(self):
        flight_sps = {
            "F1": [self._make_sp("ip")],
            "F2": [self._make_sp("ep")],
        }
        shared, _ = merge_shared_steerpoints(flight_sps)
        assert len(shared) == 0

    def test_no_merge_too_far(self):
        flight_sps = {
            "F1": [self._make_sp("ip", x=0, y=0)],
            "F2": [self._make_sp("ip", x=10000, y=10000)],
        }
        shared, _ = merge_shared_steerpoints(flight_sps)
        assert len(shared) == 0

    def test_single_flight_no_merge(self):
        flight_sps = {"F1": [self._make_sp("ip")]}
        shared, _ = merge_shared_steerpoints(flight_sps)
        assert len(shared) == 0

    def test_updated_sps_has_reference(self):
        flight_sps = {
            "F1": [self._make_sp("ip")],
            "F2": [self._make_sp("ip")],
        }
        shared, updated = merge_shared_steerpoints(flight_sps)
        assert "shared_steerpoint_id" in updated["F1"][0]
        assert updated["F1"][0]["shared_steerpoint_id"] == "SSP-1"

    def test_non_special_preserved(self):
        flight_sps = {
            "F1": [
                {"coords": "N36°00'00\" E037°00'00\"", "_x": 0, "_y": 0},
                self._make_sp("ip"),
            ],
            "F2": [self._make_sp("ip")],
        }
        shared, updated = merge_shared_steerpoints(flight_sps)
        assert len(updated["F1"]) == 2
        # First entry should not have shared_steerpoint_id
        assert "shared_steerpoint_id" not in updated["F1"][0]


class TestBuildMissions:
    def _make_flight(self, name, task="CAP", is_tanker=False, is_awacs=False):
        wp1 = Waypoint(name=None, x=0, y=0, lat=36.0, lon=37.0,
                       typ="TakeOffParking", airdrome_id=16,
                       link_unit_id=None, is_orbit=False)
        wp2 = Waypoint(name="WP1", x=100000, y=100000, lat=36.5, lon=37.5,
                       typ="Turning Point", airdrome_id=None,
                       link_unit_id=None, is_orbit=False, alt_ft=20000)
        fu = FlightUnit(type="F-16C_50", callsign=name,
                        onboard_num="101", skill="Client",
                        loadout=["AIM-120C", "AIM-120C", "AIM-9X", "AIM-9X"])
        return Flight(id="FLT-1", name=name, task=task,
                      aircraft_type="F-16C_50", freq_mhz=251.0,
                      units=[fu], waypoints=[wp1, wp2],
                      is_tanker=is_tanker, is_awacs=is_awacs)

    def test_basic(self):
        f = self._make_flight("VIPER-1")
        missions, shared = build_missions([f], 1000, {}, [], {"LTAG": {}}, {})
        assert len(missions) == 1
        assert missions[0]["callsign"] == "VIPER-1"

    def test_tanker_excluded(self):
        f = self._make_flight("SHELL-1", task="TANKER", is_tanker=True)
        missions, _ = build_missions([f], 1000, {}, [], {}, {})
        assert len(missions) == 0

    def test_awacs_excluded(self):
        f = self._make_flight("MAGIC-1", task="AWACS", is_awacs=True)
        missions, _ = build_missions([f], 1000, {}, [], {}, {})
        assert len(missions) == 0

    def test_mission_number_sequential(self):
        f1 = self._make_flight("A-1")
        f2 = self._make_flight("B-1")
        missions, _ = build_missions([f1, f2], 1000, {}, [], {"LTAG": {}}, {})
        assert missions[0]["mission_number"] == "MSN1000"
        assert missions[1]["mission_number"] == "MSN1001"

    def test_aircraft_info(self):
        f = self._make_flight("VIPER-1")
        missions, _ = build_missions([f], 1000, {}, [], {"LTAG": {}}, {})
        ac = missions[0]["aircraft"]
        assert ac["count"] == 1
        assert ac["type"] == "F16C"
