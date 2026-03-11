"""Tests for miztoyaml.parse — Group, Drawing, and bullseye parsing."""

import pytest

from tools.miztoyaml.parse import (
    parse_bullseye,
    parse_drawings,
    parse_groups,
    parse_units,
    _strip_dcs_suffix,
    _group_outer_name,
)


class TestStripDcsSuffix:
    def test_normal(self):
        assert _strip_dcs_suffix("EFTA07-4-1") == "EFTA07"

    def test_no_suffix(self):
        assert _strip_dcs_suffix("Aleppo SA-3") == "Aleppo SA-3"

    def test_only_suffix(self):
        assert _strip_dcs_suffix("A-1-1") == "A"

    def test_complex_name(self):
        assert _strip_dcs_suffix("Aleppo SA-3 2-1-1") == "Aleppo SA-3 2"


class TestGroupOuterName:
    def test_simple(self):
        text = '["name"] = "MyGroup"'
        assert _group_outer_name(text) == "MyGroup"

    def test_strips_route_and_units(self):
        text = '''
            ["route"] = { ["name"] = "WP1" },
            ["units"] = { ["name"] = "Unit1" },
            ["name"] = "GroupName"
        '''
        assert _group_outer_name(text) == "GroupName"

    def test_no_name(self):
        assert _group_outer_name("some other text") is None


class TestParseUnits:
    def _make_unit_block(self, units):
        parts = []
        for i, (utype, x, y) in enumerate(units, 1):
            parts.append(f'[{i}] = {{ ["type"] = "{utype}", ["x"] = {x}, ["y"] = {y} }}')
        return ", ".join(parts)

    def test_basic(self):
        block = self._make_unit_block([("T-72B", 100, 200)])
        result = parse_units(block, "Syria")
        assert len(result) == 1
        assert result[0].type == "T-72B"

    def test_multiple_units(self):
        block = self._make_unit_block([("T-72B", 100, 200), ("ZIL-131", 300, 400)])
        result = parse_units(block, "Syria")
        assert len(result) == 2

    def test_missing_type(self):
        block = '[1] = { ["x"] = 100, ["y"] = 200 }'
        result = parse_units(block, "Syria")
        assert len(result) == 0

    def test_missing_xy(self):
        block = '[1] = { ["type"] = "T-72B" }'
        result = parse_units(block, "Syria")
        assert len(result) == 0


class TestParseGroups:
    def _make_coalition_block(self, groups):
        """Build a minimal coalition block with vehicle groups."""
        parts = []
        for i, (name, x, y) in enumerate(groups, 1):
            parts.append(f'''
                [{i}] = {{
                    ["name"] = "{name}",
                    ["x"] = {x},
                    ["y"] = {y},
                    ["units"] = {{
                        [1] = {{ ["type"] = "T-72B", ["x"] = {x}, ["y"] = {y} }}
                    }}
                }}
            ''')
        group_block = ", ".join(parts)
        return f'''
            ["country"] = {{
                [1] = {{
                    ["vehicle"] = {{
                        ["group"] = {{ {group_block} }}
                    }}
                }}
            }}
        '''

    def test_basic(self):
        block = self._make_coalition_block([("TestGroup-1-1", 100, 200)])
        result = parse_groups(block, "Syria")
        assert len(result) == 1
        assert result[0].name == "TestGroup"

    def test_empty_coalition(self):
        assert parse_groups("", "Syria") == []

    def test_multiple_groups(self):
        block = self._make_coalition_block([
            ("G1-1-1", 100, 200),
            ("G2-1-1", 300, 400),
        ])
        result = parse_groups(block, "Syria")
        assert len(result) == 2

    def test_no_country_block(self):
        assert parse_groups('["something"] = {}', "Syria") == []


class TestParseDrawings:
    def _make_mission_with_drawing(self, name, pmode, extra=""):
        return f'''
        ["drawings"] = {{
            ["layers"] = {{
                [1] = {{
                    ["name"] = "Common",
                    ["objects"] = {{
                        [1] = {{
                            ["primitiveType"] = "Polygon",
                            ["name"] = "{name}",
                            ["polygonMode"] = "{pmode}",
                            ["mapX"] = 1000,
                            ["mapY"] = 2000,
                            {extra}
                        }}
                    }}
                }}
            }}
        }}
        '''

    def test_circle(self):
        text = self._make_mission_with_drawing("Zone", "circle", '["radius"] = 5000')
        result = parse_drawings(text)
        assert len(result) == 1
        assert result[0].polygon_mode == "circle"
        assert result[0].radius_m == 5000

    def test_rect(self):
        text = self._make_mission_with_drawing("Box", "rect",
                                                '["width"] = 10000, ["height"] = 5000')
        result = parse_drawings(text)
        assert len(result) == 1
        assert result[0].polygon_mode == "rect"

    def test_no_drawings(self):
        assert parse_drawings("no drawings here") == []

    def test_non_polygon_skipped(self):
        text = '''
        ["drawings"] = {
            ["layers"] = {
                [1] = {
                    ["name"] = "Common",
                    ["objects"] = {
                        [1] = {
                            ["primitiveType"] = "Line",
                            ["name"] = "Route",
                            ["mapX"] = 0, ["mapY"] = 0
                        }
                    }
                }
            }
        }
        '''
        assert parse_drawings(text) == []

    def test_no_common_layer(self):
        text = '''
        ["drawings"] = {
            ["layers"] = {
                [1] = {
                    ["name"] = "Other",
                    ["objects"] = {}
                }
            }
        }
        '''
        assert parse_drawings(text) == []

    def test_free_polygon(self):
        text = self._make_mission_with_drawing("Poly", "free", '''
            ["points"] = {
                [1] = { ["x"] = 0, ["y"] = 0 },
                [2] = { ["x"] = 100, ["y"] = 0 },
                [3] = { ["x"] = 100, ["y"] = 100 },
                [4] = { ["x"] = 0, ["y"] = 100 }
            }
        ''')
        result = parse_drawings(text)
        assert len(result) == 1
        assert result[0].polygon_mode == "free"
        assert len(result[0].rel_points) >= 3


class TestParseBullseye:
    def test_found(self):
        block = '["bullseye"] = { ["x"] = 1000, ["y"] = 2000 }'
        result = parse_bullseye(block, "Syria")
        assert result is not None
        assert "N" in result or "S" in result

    def test_not_found(self):
        assert parse_bullseye("no bullseye", "Syria") is None

    def test_no_xy(self):
        block = '["bullseye"] = { }'
        assert parse_bullseye(block, "Syria") is None
