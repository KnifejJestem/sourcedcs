"""Tests for miztoyaml.parse_flights — flight, carrier, and weather parsing."""

import pytest

from tools.miztoyaml.parse_flights import (
    parse_flights_and_carriers,
    parse_weather,
    _parse_callsign,
    _parse_waypoints,
    _project_position,
)


class TestParseCallsign:
    def test_with_name(self):
        block = '["name"] = "Viper"'
        assert _parse_callsign(block) == "Viper"

    def test_no_name(self):
        assert _parse_callsign('["other"] = "x"') == ""

    def test_none(self):
        assert _parse_callsign(None) == ""


class TestProjectPosition:
    def test_zero_speed(self):
        x, y = _project_position(0, 0, 100, 0, 0, 4)
        assert x == 0
        assert y == 0

    def test_same_position(self):
        x, y = _project_position(10, 20, 10, 20, 100, 4)
        assert x == 10
        assert y == 20

    def test_basic_projection(self):
        x, y = _project_position(0, 0, 1000, 0, 100, 1)
        assert x > 0  # moved north
        assert y == pytest.approx(0, abs=1)


class TestParseWaypoints:
    def _make_route(self, waypoints):
        parts = []
        for i, (name, x, y, typ) in enumerate(waypoints, 1):
            name_str = f'["name"] = "{name}",' if name else ''
            parts.append(f'''
                [{i}] = {{
                    {name_str}
                    ["x"] = {x},
                    ["y"] = {y},
                    ["type"] = "{typ}",
                    ["alt"] = 5000
                }}
            ''')
        return '["points"] = { ' + ", ".join(parts) + " }"

    def test_basic(self):
        route = self._make_route([("WP1", 100, 200, "Turning Point")])
        result = _parse_waypoints(route, "Syria")
        assert len(result) == 1
        assert result[0].name == "WP1"

    def test_empty(self):
        assert _parse_waypoints("", "Syria") == []

    def test_alt_conversion(self):
        route = self._make_route([("WP1", 0, 0, "Turning Point")])
        result = _parse_waypoints(route, "Syria")
        assert result[0].alt_ft is not None
        # 5000m ≈ 16404ft
        assert 16000 < result[0].alt_ft < 17000

    def test_airdrome_id(self):
        route = '["points"] = { [1] = { ["x"] = 0, ["y"] = 0, ["type"] = "TakeOffParking", ["airdromeId"] = 16, ["alt"] = 0 } }'
        result = _parse_waypoints(route, "Syria")
        assert result[0].airdrome_id == 16


class TestParseFlightsAndCarriers:
    def _make_coalition(self, plane_groups=None, ship_groups=None):
        parts = []
        if plane_groups:
            group_parts = []
            for i, (name, task, ac_type, freq) in enumerate(plane_groups, 1):
                group_parts.append(f'''
                    [{i}] = {{
                        ["name"] = "{name}",
                        ["task"] = "{task}",
                        ["frequency"] = {freq},
                        ["units"] = {{
                            [1] = {{
                                ["type"] = "{ac_type}",
                                ["skill"] = "Client",
                                ["onboard_num"] = "101",
                                ["callsign"] = {{ ["name"] = "{name}" }},
                                ["payload"] = {{ ["pylons"] = {{ }} }}
                            }}
                        }},
                        ["route"] = {{
                            ["points"] = {{
                                [1] = {{ ["x"] = 0, ["y"] = 0, ["type"] = "TakeOffParking",
                                         ["airdromeId"] = 16, ["alt"] = 0 }},
                                [2] = {{ ["x"] = 100000, ["y"] = 100000, ["type"] = "Turning Point",
                                         ["alt"] = 7000 }}
                            }}
                        }}
                    }}
                ''')
            parts.append(f'''
                ["plane"] = {{
                    ["group"] = {{ {", ".join(group_parts)} }}
                }}
            ''')
        if ship_groups:
            group_parts = []
            for i, (name, utype, unit_id) in enumerate(ship_groups, 1):
                group_parts.append(f'''
                    [{i}] = {{
                        ["name"] = "{name}",
                        ["units"] = {{
                            [1] = {{
                                ["type"] = "{utype}",
                                ["name"] = "{name}",
                                ["unitId"] = {unit_id},
                                ["x"] = 0,
                                ["y"] = 0
                            }}
                        }},
                        ["route"] = {{
                            ["points"] = {{
                                [1] = {{ ["x"] = 0, ["y"] = 0, ["type"] = "Turning Point",
                                         ["alt"] = 0, ["speed"] = 10 }},
                                [2] = {{ ["x"] = 10000, ["y"] = 10000, ["type"] = "Turning Point",
                                         ["alt"] = 0, ["speed"] = 10 }}
                            }}
                        }}
                    }}
                ''')
            parts.append(f'''
                ["ship"] = {{
                    ["group"] = {{ {", ".join(group_parts)} }}
                }}
            ''')
        country_content = ", ".join(parts)
        return f'''
            ["country"] = {{
                [1] = {{ {country_content} }}
            }}
        '''

    def test_single_flight(self):
        block = self._make_coalition(
            plane_groups=[("VIPER-1", "CAP", "F-16C_50", 251000000)]
        )
        flights, carriers = parse_flights_and_carriers(block, "Syria")
        assert len(flights) == 1
        assert flights[0].name == "VIPER-1"
        assert flights[0].task == "CAP"

    def test_carrier_extraction(self):
        block = self._make_coalition(
            ship_groups=[("TRUMAN", "CVN_75", 42)]
        )
        flights, carriers = parse_flights_and_carriers(block, "Syria")
        assert len(carriers) == 1
        assert carriers[0].type == "CVN_75"

    def test_non_carrier_ship_skipped(self):
        block = self._make_coalition(
            ship_groups=[("DESTROYER", "OLIVER_HAZARD_PERRY", 99)]
        )
        _, carriers = parse_flights_and_carriers(block, "Syria")
        assert len(carriers) == 0

    def test_empty_coalition(self):
        flights, carriers = parse_flights_and_carriers("", "Syria")
        assert flights == []
        assert carriers == []

    def test_tanker_detected(self):
        block = self._make_coalition(
            plane_groups=[("SHELL-1", "Refueling", "KC-135", 280000000)]
        )
        flights, _ = parse_flights_and_carriers(block, "Syria")
        assert flights[0].is_tanker is True

    def test_awacs_detected(self):
        block = self._make_coalition(
            plane_groups=[("MAGIC-1", "AWACS", "E-3A", 260000000)]
        )
        flights, _ = parse_flights_and_carriers(block, "Syria")
        assert flights[0].is_awacs is True

    def test_frequency_conversion(self):
        block = self._make_coalition(
            plane_groups=[("TEST-1", "CAP", "F-16C_50", 251000000)]
        )
        flights, _ = parse_flights_and_carriers(block, "Syria")
        assert flights[0].freq_mhz == pytest.approx(251.0)


class TestParseWeather:
    def test_no_weather(self):
        metar, notes = parse_weather("no weather block", 15)
        assert "METAR" in metar
        assert "150000Z" in metar

    def test_basic_weather(self):
        text = '''
        ["weather"] = {
            ["atGround"] = { ["speed"] = 5, ["dir"] = 180 },
            ["clouds"] = { ["base"] = 2000, ["density"] = 3 },
            ["visibility"] = { ["distance"] = 80000 },
            ["fog"] = { ["visibility"] = 0 },
            ["enable_fog"] = false,
            ["enable_dust"] = false,
            ["qnh"] = 760,
            ["season"] = { ["temperature"] = 20 }
        }
        '''
        metar, notes = parse_weather(text, 10)
        assert "METAR" in metar
        assert "100000Z" in metar

    def test_fog_visibility(self):
        text = '''
        ["weather"] = {
            ["atGround"] = { ["speed"] = 0, ["dir"] = 0 },
            ["clouds"] = { ["base"] = 0, ["density"] = 0 },
            ["visibility"] = { ["distance"] = 80000 },
            ["fog"] = { ["visibility"] = 500 },
            ["enable_fog"] = true,
            ["enable_dust"] = false,
            ["qnh"] = 760,
            ["season"] = { ["temperature"] = 15 }
        }
        '''
        metar, notes = parse_weather(text, 1)
        assert "500" in metar
        assert "Fog" in notes

    def test_clear_weather(self):
        text = '''
        ["weather"] = {
            ["atGround"] = { ["speed"] = 0, ["dir"] = 0 },
            ["clouds"] = { ["base"] = 0, ["density"] = 0 },
            ["visibility"] = { ["distance"] = 80000 },
            ["fog"] = { ["visibility"] = 0 },
            ["enable_fog"] = false,
            ["enable_dust"] = false,
            ["qnh"] = 760,
            ["season"] = { ["temperature"] = 15 }
        }
        '''
        metar, notes = parse_weather(text, 1)
        assert "SKC" in metar
        assert "Clear" in notes
