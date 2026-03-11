"""Tests for miztoyaml.build_targets — target and ACM building."""

import pytest

from tools.miztoyaml.build_targets import build_acms, build_aim_points, build_targets
from tools.miztoyaml.models import Drawing, Group, Unit


class TestBuildAimPoints:
    def test_with_launchers(self):
        g = Group(name="SAM-1", x=100, y=200, lat=36.0, lon=37.0,
                  units=[
                      Unit(type="5P85", x=100, y=200, lat=36.0, lon=37.0, role="launcher"),
                      Unit(type="5N63", x=110, y=210, lat=36.001, lon=37.001, role="radar"),
                  ])
        pts = build_aim_points(g, "SAM-1")
        assert len(pts) == 2
        assert any("LN" in p["id"] for p in pts)
        assert any("RD" in p["id"] for p in pts)

    def test_no_launcher_or_radar(self):
        g = Group(name="G1", x=100, y=200, lat=36.0, lon=37.0,
                  units=[
                      Unit(type="ZIL-131", x=100, y=200, lat=36.0, lon=37.0, role="support"),
                  ])
        pts = build_aim_points(g, "G1")
        assert len(pts) == 1
        assert pts[0]["id"] == "G1-1"

    def test_dedup_same_position(self):
        g = Group(name="G1", x=100, y=200, lat=36.0, lon=37.0,
                  units=[
                      Unit(type="5P85", x=100, y=200, lat=36.0, lon=37.0, role="launcher"),
                      Unit(type="5P85", x=100, y=200, lat=36.0, lon=37.0, role="launcher"),
                  ])
        pts = build_aim_points(g, "G1")
        assert len(pts) == 1


class TestBuildTargets:
    def test_sam_detection(self):
        g = Group(name="SA-10 Battery", x=100, y=200, lat=36.0, lon=37.0,
                  units=[
                      Unit(type="5P85", x=100, y=200, lat=36.0, lon=37.0, role="launcher"),
                      Unit(type="5N63", x=110, y=210, lat=36.001, lon=37.001, role="radar"),
                  ])
        result = build_targets([g])
        assert len(result) == 1
        key = list(result.keys())[0]
        assert key.startswith("SAM-")
        assert result[key]["type"] == "SAM"

    def test_tgt_prefix(self):
        g = Group(name="TGT FACTORY", x=100, y=200, lat=36.0, lon=37.0, units=[])
        result = build_targets([g])
        assert len(result) == 1
        key = list(result.keys())[0]
        assert key.startswith("TGT-")
        assert result[key]["type"] == "FACTORY"

    def test_no_match(self):
        g = Group(name="Random", x=100, y=200, lat=36.0, lon=37.0,
                  units=[Unit(type="ZIL-131", x=100, y=200, lat=36.0, lon=37.0, role="support")])
        result = build_targets([g])
        assert len(result) == 0

    def test_empty(self):
        assert build_targets([]) == {}

    def test_elevation_included(self):
        g = Group(name="TGT BUNKER", x=0, y=0, lat=36.0, lon=37.0,
                  units=[], alt_ft=500)
        result = build_targets([g])
        key = list(result.keys())[0]
        assert result[key].get("elevation") == "500ft"


class TestBuildAcms:
    def test_circle_acm(self):
        d = Drawing(name="CAP Zone", polygon_mode="circle",
                    origin_x=1000, origin_y=2000, radius_m=10000)
        result = build_acms([d], "Syria")
        assert len(result) == 1
        assert result[0]["type"] == "ROZ"
        assert "radius_nm" in result[0]["geometry"]

    def test_rect_acm(self):
        d = Drawing(name="Orbit", polygon_mode="rect",
                    origin_x=1000, origin_y=2000,
                    width_m=20000, height_m=10000)
        result = build_acms([d], "Syria")
        assert len(result) == 1
        assert result[0]["type"] == "ORBIT"
        assert "boundary" in result[0]["geometry"]

    def test_free_acm(self):
        d = Drawing(name="ROZ", polygon_mode="free",
                    origin_x=1000, origin_y=2000,
                    rel_points=[(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
        result = build_acms([d], "Syria")
        assert len(result) == 1
        assert result[0]["type"] == "ROZ"

    def test_empty(self):
        assert build_acms([], "Syria") == []

    def test_circle_no_radius(self):
        d = Drawing(name="NoR", polygon_mode="circle",
                    origin_x=0, origin_y=0)
        result = build_acms([d], "Syria")
        assert len(result) == 0

    def test_sequential_ids(self):
        d1 = Drawing(name="Z1", polygon_mode="circle",
                     origin_x=0, origin_y=0, radius_m=5000)
        d2 = Drawing(name="Z2", polygon_mode="circle",
                     origin_x=100, origin_y=100, radius_m=3000)
        result = build_acms([d1, d2], "Syria")
        assert result[0]["id"] == "ACM-001"
        assert result[1]["id"] == "ACM-002"
