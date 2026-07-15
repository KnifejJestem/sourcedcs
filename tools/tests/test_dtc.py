"""Tests for miztoyaml.dtc — DTC parsing + SPINS markdown parser."""

import json

import pytest

from tools.miztoyaml.dtc import (
    build_comms_from_dtc,
    parse_dtc_file,
    parse_dtc_lines,
    parse_dtc_nav_pts,
    parse_dtc_routes,
    parse_spins_md,
)


# ── DTC parsing ──────────────────────────────────────────────────────────────

class TestParseDtcFile:
    def _make_dtc(self, comm: dict) -> bytes:
        return json.dumps({"data": {"COMM": comm}}).encode()

    def test_single_radio(self):
        comm = {"COMM1": {"Channel_1": {"freq": 251.0}, "Channel_2": {"freq": 305.0}}}
        result = parse_dtc_file(self._make_dtc(comm))
        assert "COMM1" in result
        assert result["COMM1"][1] == 251.0
        assert result["COMM1"][2] == 305.0

    def test_two_radios(self):
        comm = {
            "COMM1": {"Channel_1": {"freq": 300.0}},
            "COMM2": {"Channel_1": {"freq": 130.0}},
        }
        result = parse_dtc_file(self._make_dtc(comm))
        assert len(result) == 2

    def test_special_channels_skipped(self):
        comm = {"COMM1": {"Channel_G": {"freq": 243.0}, "Channel_1": {"freq": 251.0}}}
        result = parse_dtc_file(self._make_dtc(comm))
        assert 1 in result["COMM1"]
        # 'G' channel should not appear as a numeric key
        assert all(isinstance(k, int) for k in result["COMM1"])

    def test_invalid_json(self):
        assert parse_dtc_file(b"not json") == {}

    def test_missing_data_key(self):
        assert parse_dtc_file(json.dumps({"other": {}}).encode()) == {}

    def test_empty_comm(self):
        assert parse_dtc_file(self._make_dtc({})) == {}

    def test_frequency_key_alias(self):
        comm = {"COMM1": {"Channel_5": {"frequency": 123.45}}}
        result = parse_dtc_file(self._make_dtc(comm))
        assert result["COMM1"][5] == pytest.approx(123.45)


class TestBuildCommsFromDtc:
    def test_uhf_vhf_split(self):
        channels = {
            "COMM1": {1: 251.0, 2: 130.0, 3: 305.0},
        }
        uhf, vhf = build_comms_from_dtc(channels)
        assert uhf is not None
        assert vhf is not None
        assert 1 in uhf
        assert 2 in vhf
        assert uhf[1] == 251.0
        assert vhf[2] == 130.0

    def test_all_uhf(self):
        channels = {"COMM1": {1: 300.0, 2: 350.0}}
        uhf, vhf = build_comms_from_dtc(channels)
        assert uhf is not None
        assert vhf is None

    def test_all_vhf(self):
        channels = {"COMM1": {1: 130.0, 2: 140.0}}
        uhf, vhf = build_comms_from_dtc(channels)
        assert uhf is None
        assert vhf is not None

    def test_comm1_priority(self):
        channels = {
            "COMM1": {1: 300.0},
            "COMM2": {1: 350.0},  # same channel — COMM1 wins
        }
        uhf, _ = build_comms_from_dtc(channels)
        assert uhf[1] == 300.0

    def test_empty(self):
        uhf, vhf = build_comms_from_dtc({})
        assert uhf is None
        assert vhf is None


class TestParseDtcNavPts:
    def _make_dtc_with_nav_pts(self, nav_pts: list) -> bytes:
        return json.dumps({"data": {"MPD": {"NAV_PTS": nav_pts}}}).encode()

    def test_basic(self):
        pts = [
            {"number": 1, "x": 22735.0, "y": 256990.0, "alt": 442.0, "note": "", "type": "STPT"},
            {"number": 2, "x": -7340.0, "y": 298859.0, "alt": 327.0, "note": "IP", "type": "STPT"},
        ]
        result = parse_dtc_nav_pts(self._make_dtc_with_nav_pts(pts))
        assert len(result) == 2
        assert result[0]["number"] == 1
        assert result[0]["x"] == pytest.approx(22735.0)
        assert result[0]["y"] == pytest.approx(256990.0)
        assert result[0]["alt_m"] == pytest.approx(442.0)
        assert result[0]["note"] == ""
        assert result[1]["note"] == "IP"

    def test_sorted_by_number(self):
        pts = [
            {"number": 3, "x": 1.0, "y": 1.0},
            {"number": 1, "x": 2.0, "y": 2.0},
            {"number": 2, "x": 3.0, "y": 3.0},
        ]
        result = parse_dtc_nav_pts(self._make_dtc_with_nav_pts(pts))
        assert [p["number"] for p in result] == [1, 2, 3]

    def test_no_nav_pts_returns_empty(self):
        content = json.dumps({"data": {"COMM": {}}}).encode()
        assert parse_dtc_nav_pts(content) == []

    def test_empty_nav_pts_list(self):
        result = parse_dtc_nav_pts(self._make_dtc_with_nav_pts([]))
        assert result == []

    def test_missing_xy_skipped(self):
        pts = [{"number": 1, "alt": 100.0, "note": ""}]  # no x/y
        result = parse_dtc_nav_pts(self._make_dtc_with_nav_pts(pts))
        assert result == []

    def test_no_alt_allowed(self):
        pts = [{"number": 1, "x": 100.0, "y": 200.0, "note": ""}]
        result = parse_dtc_nav_pts(self._make_dtc_with_nav_pts(pts))
        assert len(result) == 1
        assert result[0]["alt_m"] is None

    def test_invalid_json_returns_empty(self):
        assert parse_dtc_nav_pts(b"not json") == []

    def test_comms_ignored_without_mpd(self):
        content = json.dumps({"data": {"COMM": {"COMM1": {"Channel_1": {"freq": 251.0}}}}}).encode()
        assert parse_dtc_nav_pts(content) == []

    def _make_dtc_f18_nav_pts(self, nav_pts: list) -> bytes:
        """Build a DTC bytes payload using the F-18 WYPT.NAV_PTS layout."""
        return json.dumps({"data": {"WYPT": {"NAV_PTS": nav_pts}}}).encode()

    def test_f18_wypt_layout(self):
        """F-18 uses data.WYPT.NAV_PTS with wypt_num instead of number."""
        pts = [
            {"wypt_num": 1, "x": 8817.5, "y": 5608.1, "alt": 7620.0, "note": "", "altitudeType": 1},
            {"wypt_num": 2, "x": 34338.7, "y": 135444.3, "alt": 7620.0, "note": "", "altitudeType": 1},
        ]
        result = parse_dtc_nav_pts(self._make_dtc_f18_nav_pts(pts))
        assert len(result) == 2
        assert result[0]["number"] == 1
        assert result[0]["x"] == pytest.approx(8817.5)
        assert result[0]["y"] == pytest.approx(5608.1)
        assert result[0]["alt_m"] == pytest.approx(7620.0)
        assert result[1]["number"] == 2

    def test_f18_wypt_sorted_by_wypt_num(self):
        """Entries are sorted by wypt_num when that is the number field."""
        pts = [
            {"wypt_num": 3, "x": 1.0, "y": 1.0},
            {"wypt_num": 1, "x": 2.0, "y": 2.0},
            {"wypt_num": 2, "x": 3.0, "y": 3.0},
        ]
        result = parse_dtc_nav_pts(self._make_dtc_f18_nav_pts(pts))
        assert [p["number"] for p in result] == [1, 2, 3]

    def test_f18_wypt_type_defaults_to_stpt(self):
        """F-18 entries without a 'type' field default to 'STPT'."""
        pts = [{"wypt_num": 1, "x": 100.0, "y": 200.0}]
        result = parse_dtc_nav_pts(self._make_dtc_f18_nav_pts(pts))
        assert result[0]["type"] == "STPT"

    def test_f16_mpd_path_still_works(self):
        """Original F-16 MPD.NAV_PTS path continues to work after the fix."""
        content = json.dumps({
            "data": {"MPD": {"NAV_PTS": [
                {"number": 1, "x": 22735.0, "y": 256990.0, "alt": 442.0, "note": "", "type": "STPT"},
            ]}}
        }).encode()
        result = parse_dtc_nav_pts(content)
        assert len(result) == 1
        assert result[0]["number"] == 1
        assert result[0]["type"] == "STPT"


class TestParseDtcRoutes:
    def _f16_dtc(self, nav_pts: list) -> bytes:
        return json.dumps({"data": {"MPD": {"NAV_PTS": nav_pts}}}).encode()

    def _f18_dtc(self, nav_pts: list, nav_route: list) -> bytes:
        return json.dumps({"data": {"WYPT": {"NAV_PTS": nav_pts, "NAV_ROUTE": nav_route}}}).encode()

    def test_f16_single_route_ordered_by_number(self):
        pts = [
            {"number": 2, "x": 2.0, "y": 2.0, "alt": 100.0, "note": "B", "R1": True, "R2": False, "R3": False, "speed": 400.0},
            {"number": 1, "x": 1.0, "y": 1.0, "alt": 50.0,  "note": "A", "R1": True, "R2": False, "R3": False, "speed": 300.0},
        ]
        result = parse_dtc_routes(self._f16_dtc(pts))
        assert len(result) == 1
        assert result[0]["route"] == 1
        assert [p["note"] for p in result[0]["points"]] == ["A", "B"]
        assert result[0]["points"][0]["speed_kts"] == pytest.approx(300.0)

    def test_f16_multiple_routes_plus_standalone(self):
        pts = [
            {"number": 1, "x": 1.0, "y": 1.0, "alt": 10.0, "note": "R1PT", "R1": True,  "R2": False, "R3": False, "speed": 400.0},
            {"number": 2, "x": 2.0, "y": 2.0, "alt": 20.0, "note": "R2PT", "R1": False, "R2": True,  "R3": False, "speed": 400.0},
            {"number": 3, "x": 3.0, "y": 3.0, "alt": 30.0, "note": "LOOSE", "R1": False, "R2": False, "R3": False, "speed": 400.0},
        ]
        result = parse_dtc_routes(self._f16_dtc(pts))
        routes = {g["route"]: [p["note"] for p in g["points"]] for g in result}
        assert routes == {1: ["R1PT"], 2: ["R2PT"], None: ["LOOSE"]}
        # Standalone points never carry a route speed
        standalone = next(g for g in result if g["route"] is None)
        assert standalone["points"][0]["speed_kts"] is None

    def test_f16_route_altitude_preferred_over_static_alt(self):
        pts = [{"number": 1, "x": 1.0, "y": 1.0, "alt": 10.0, "routeAltitude": 3048.0,
                "note": "", "R1": True, "R2": False, "R3": False}]
        result = parse_dtc_routes(self._f16_dtc(pts))
        assert result[0]["points"][0]["alt_m"] == pytest.approx(3048.0)

    def test_f16_standalone_uses_static_alt(self):
        pts = [{"number": 1, "x": 1.0, "y": 1.0, "alt": 10.0, "routeAltitude": 3048.0,
                "note": "", "R1": False, "R2": False, "R3": False}]
        result = parse_dtc_routes(self._f16_dtc(pts))
        assert result[0]["points"][0]["alt_m"] == pytest.approx(10.0)

    def test_f18_route_order_is_not_sorted_by_wypt_num(self):
        nav_pts = [{"wypt_num": n, "x": float(n), "y": float(n), "alt": float(n), "note": f"P{n}"}
                   for n in (1, 6, 7, 10)]
        # NAV_ROUTE entries preserve JSON insertion order — not ascending wypt_num
        nav_route = [{
            "STPT1":  {"wypt_num": 1,  "route_num": 1, "speed": 400.0, "alt": 100.0},
            "STPT10": {"wypt_num": 10, "route_num": 1, "speed": 400.0, "alt": 100.0},
            "STPT6":  {"wypt_num": 6,  "route_num": 1, "speed": 400.0, "alt": 100.0},
            "STPT7":  {"wypt_num": 7,  "route_num": 1, "speed": 400.0, "alt": 100.0},
        }]
        result = parse_dtc_routes(self._f18_dtc(nav_pts, nav_route))
        assert len(result) == 1
        assert [p["number"] for p in result[0]["points"]] == [1, 10, 6, 7]

    def test_f18_stale_wypt_reference_skipped(self):
        nav_pts = [{"wypt_num": 1, "x": 1.0, "y": 1.0, "alt": 10.0, "note": ""}]
        nav_route = [{
            "STPT1": {"wypt_num": 1, "route_num": 1, "speed": 400.0, "alt": 100.0},
            "STPT2": {"wypt_num": 2, "route_num": 1, "speed": 400.0, "alt": 100.0},  # no matching NAV_PTS entry
        }]
        result = parse_dtc_routes(self._f18_dtc(nav_pts, nav_route))
        # Only 1 point resolves -> folds into standalone, not a 1-point "route"
        assert len(result) == 1
        assert result[0]["route"] is None
        assert result[0]["points"][0]["number"] == 1

    def test_f18_route_alt_speed_from_route_entry(self):
        nav_pts = [{"wypt_num": 1, "x": 1.0, "y": 1.0, "alt": 10.0, "note": ""},
                   {"wypt_num": 2, "x": 2.0, "y": 2.0, "alt": 20.0, "note": ""}]
        nav_route = [{
            "STPT1": {"wypt_num": 1, "route_num": 1, "speed": 463.0, "alt": 74.0},
            "STPT2": {"wypt_num": 2, "route_num": 1, "speed": 470.0, "alt": 84.0},
        }]
        result = parse_dtc_routes(self._f18_dtc(nav_pts, nav_route))
        pts = result[0]["points"]
        assert pts[0]["alt_m"] == pytest.approx(74.0)
        assert pts[0]["speed_kts"] == pytest.approx(463.0)

    def test_f18_unreferenced_navpts_are_standalone(self):
        nav_pts = [{"wypt_num": 1, "x": 1.0, "y": 1.0, "alt": 10.0, "note": "USED"},
                   {"wypt_num": 2, "x": 2.0, "y": 2.0, "alt": 20.0, "note": "UNUSED"}]
        nav_route = [{
            "STPT1": {"wypt_num": 1, "route_num": 1, "speed": 400.0, "alt": 100.0},
        }]
        result = parse_dtc_routes(self._f18_dtc(nav_pts, nav_route))
        # route 1's single point folds into standalone (no route with < 2 pts),
        # merged alongside wypt 2 which was never referenced by any route.
        assert len(result) == 1
        assert result[0]["route"] is None
        assert {p["note"] for p in result[0]["points"]} == {"USED", "UNUSED"}

    def test_no_route_data_returns_empty(self):
        content = json.dumps({"data": {"COMM": {}}}).encode()
        assert parse_dtc_routes(content) == []

    def test_invalid_json_returns_empty(self):
        assert parse_dtc_routes(b"not json") == []


class TestParseDtcLines:
    def _f16_dtc(self, geo_lines: list) -> bytes:
        return json.dumps({"data": {"MPD": {"GEO_LINES": geo_lines}}}).encode()

    def _f18_dtc(self, nav_pts: list) -> bytes:
        return json.dumps({"data": {"WYPT": {"NAV_PTS": nav_pts}}}).encode()

    def test_f16_geo_lines_grouped_by_flag(self):
        pts = [
            {"number": 1, "x": 1.0, "y": 1.0, "alt": 10.0, "note": "", "L1": True,  "L2": False, "L3": False, "L4": False},
            {"number": 2, "x": 2.0, "y": 2.0, "alt": 20.0, "note": "", "L1": True,  "L2": False, "L3": False, "L4": False},
            {"number": 3, "x": 3.0, "y": 3.0, "alt": 30.0, "note": "", "L1": False, "L2": True,  "L3": False, "L4": False},
        ]
        result = parse_dtc_lines(self._f16_dtc(pts))
        # L2 group has only 1 point -> dropped (can't form a line)
        assert len(result) == 1
        assert result[0]["line"] == 1
        assert len(result[0]["points"]) == 2

    def test_f16_geo_lines_ordered_by_number(self):
        pts = [
            {"number": 2, "x": 2.0, "y": 2.0, "L1": True, "L2": False, "L3": False, "L4": False},
            {"number": 1, "x": 1.0, "y": 1.0, "L1": True, "L2": False, "L3": False, "L4": False},
        ]
        result = parse_dtc_lines(self._f16_dtc(pts))
        assert [p["x"] for p in result[0]["points"]] == [1.0, 2.0]

    def test_f16_unflagged_points_excluded(self):
        pts = [{"number": 1, "x": 1.0, "y": 1.0, "L1": False, "L2": False, "L3": False, "L4": False}]
        assert parse_dtc_lines(self._f16_dtc(pts)) == []

    def test_f18_r_flags_on_real_waypoints(self):
        pts = [
            {"wypt_num": 1, "x": 1.0, "y": 1.0, "alt": 10.0, "note": "A", "R1": True,  "R2": False, "R3": False},
            {"wypt_num": 2, "x": 2.0, "y": 2.0, "alt": 20.0, "note": "B", "R1": True,  "R2": False, "R3": False},
            {"wypt_num": 3, "x": 3.0, "y": 3.0, "alt": 30.0, "note": "C", "R1": False, "R2": False, "R3": False},
        ]
        result = parse_dtc_lines(self._f18_dtc(pts))
        assert len(result) == 1
        assert result[0]["line"] == 1
        assert [p["note"] for p in result[0]["points"]] == ["A", "B"]

    def test_no_line_data_returns_empty(self):
        content = json.dumps({"data": {"COMM": {}}}).encode()
        assert parse_dtc_lines(content) == []

    def test_invalid_json_returns_empty(self):
        assert parse_dtc_lines(b"not json") == []


# ── SPINS markdown parser ────────────────────────────────────────────────────

class TestParseSpinsMd:
    def test_single_section(self):
        md = "## ROE\nLABEL: value text\n"
        result = parse_spins_md(md)
        assert result is not None
        assert len(result) == 1
        assert result[0]["title"] == "ROE"

    def test_multiple_sections(self):
        md = "## ROE\n- bullet one\n## COMMS\nFREQ: 251.0\n"
        result = parse_spins_md(md)
        assert len(result) == 2

    def test_bullet_entries(self):
        md = "## Info\n- first\n- second\n"
        result = parse_spins_md(md)
        entries = result[0]["entries"]
        assert len(entries) == 2
        assert entries[0]["bullet"] == "first"

    def test_kv_entries(self):
        md = "## Info\nFREQ: 251.0 MHz\n"
        result = parse_spins_md(md)
        entry = result[0]["entries"][0]
        assert entry["label"] == "FREQ"
        assert entry["value"] == "251.0 MHz"

    def test_note(self):
        md = "## ROE\nNOTE: weapons free\n"
        result = parse_spins_md(md)
        assert result[0]["note"] == "weapons free"

    def test_table(self):
        md = "## Data\n|Col1|Col2|\n|---|---|\n|A|B|\n|C|D|\n"
        result = parse_spins_md(md)
        tbl = result[0].get("table")
        assert tbl is not None
        assert tbl["headers"] == ["Col1", "Col2"]
        assert len(tbl["rows"]) == 2

    def test_empty_returns_none(self):
        assert parse_spins_md("") is None

    def test_no_sections_returns_none(self):
        assert parse_spins_md("just some text\n") is None

    def test_sub_heading(self):
        md = "## Section\n### SubTitle\n- item\n"
        result = parse_spins_md(md)
        entries = result[0]["entries"]
        assert entries[0]["heading"] == "SubTitle"

    def test_plain_value(self):
        md = "## Section\nsome plain text\n"
        result = parse_spins_md(md)
        entry = result[0]["entries"][0]
        assert entry["value"] == "some plain text"

    def test_blank_lines_ignored(self):
        md = "## Section\n\n- item\n\n"
        result = parse_spins_md(md)
        assert len(result[0]["entries"]) == 1

    def test_empty_entries_cleaned(self):
        md = "## EmptySection\n\n"
        result = parse_spins_md(md)
        assert "entries" not in result[0]
