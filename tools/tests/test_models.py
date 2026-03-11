"""Tests for miztoyaml.models — typed dataclasses."""

import pytest

from tools.miztoyaml.models import (
    Carrier,
    Drawing,
    Flight,
    FlightUnit,
    Group,
    Unit,
    Waypoint,
)


class TestUnit:
    def test_creation(self):
        u = Unit(type="T-72B", x=1.0, y=2.0, lat=36.0, lon=37.0, role="launcher")
        assert u.type == "T-72B"
        assert u.role == "launcher"

    def test_no_role(self):
        u = Unit(type="Truck", x=0, y=0, lat=0, lon=0, role=None)
        assert u.role is None


class TestGroup:
    def test_defaults(self):
        g = Group(name="test", x=0, y=0, lat=0, lon=0)
        assert g.units == []
        assert g.alt_ft is None

    def test_with_units(self):
        u = Unit(type="T-72B", x=0, y=0, lat=0, lon=0, role=None)
        g = Group(name="g1", x=0, y=0, lat=0, lon=0, units=[u])
        assert len(g.units) == 1


class TestFlightUnit:
    def test_creation(self):
        fu = FlightUnit(type="F-16C_50", callsign="Viper11",
                        onboard_num="101", skill="Client", loadout=[])
        assert fu.type == "F-16C_50"
        assert fu.dtc_cartridge is None

    def test_with_dtc(self):
        fu = FlightUnit(type="F-16C_50", callsign="Viper11",
                        onboard_num="101", skill="Client", loadout=[],
                        dtc_cartridge="MyDTC")
        assert fu.dtc_cartridge == "MyDTC"


class TestWaypoint:
    def test_defaults(self):
        wp = Waypoint(name="WP1", x=0, y=0, lat=0, lon=0,
                      typ="Turning Point", airdrome_id=None,
                      link_unit_id=None, is_orbit=False)
        assert wp.alt_ft is None
        assert wp.orbit_cw is None

    def test_orbit_params(self):
        wp = Waypoint(name="ANCHOR", x=0, y=0, lat=0, lon=0,
                      typ="Turning Point", airdrome_id=None,
                      link_unit_id=None, is_orbit=True,
                      orbit_alt_ft=20000, orbit_speed_kts=300,
                      orbit_cw=True)
        assert wp.orbit_alt_ft == 20000
        assert wp.orbit_cw is True


class TestFlight:
    def test_defaults(self):
        f = Flight(id="FLT-1", name="VIPER-1", task="CAP",
                   aircraft_type="F-16C_50", freq_mhz=251.0)
        assert f.units == []
        assert f.waypoints == []
        assert f.is_tanker is False
        assert f.is_awacs is False

    def test_tanker(self):
        f = Flight(id="FLT-2", name="SHELL-1", task="TANKER",
                   aircraft_type="KC-135", freq_mhz=280.0,
                   is_tanker=True)
        assert f.is_tanker is True


class TestCarrier:
    def test_creation(self):
        c = Carrier(id="CVN-1", type="CVN_75", name="TRUMAN",
                    unit_id=42, deploy_coords="N36°00'00\" E037°00'00\"",
                    recovery_coords="N36°10'00\" E037°10'00\"")
        assert c.type == "CVN_75"


class TestDrawing:
    def test_circle(self):
        d = Drawing(name="Zone", polygon_mode="circle",
                    origin_x=100, origin_y=200, radius_m=5000)
        assert d.radius_m == 5000

    def test_rect(self):
        d = Drawing(name="Box", polygon_mode="rect",
                    origin_x=0, origin_y=0,
                    width_m=10000, height_m=5000, angle_deg=45.0)
        assert d.angle_deg == 45.0

    def test_free(self):
        pts = [(0, 0), (100, 0), (100, 100)]
        d = Drawing(name="Poly", polygon_mode="free",
                    origin_x=0, origin_y=0, rel_points=pts)
        assert len(d.rel_points) == 3

    def test_defaults(self):
        d = Drawing(name="D", polygon_mode="circle", origin_x=0, origin_y=0)
        assert d.radius_m is None
        assert d.rel_points == []
