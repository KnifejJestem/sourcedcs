"""Tests for miztoyaml.extract — end-to-end extraction and CLI logging."""

import io
import os
import zipfile

import pytest

from tools.miztoyaml.extract import _parse_weather_txt, extract
from tools.miztoyaml.log import log, setup_logging


# ── Weather txt parser ───────────────────────────────────────────────────────

class TestParseWeatherTxt:
    def test_metar(self):
        text = "METAR KHST 150000Z 18005KT 9999 SKC 20/10 Q1013 NOSIG\n"
        metars, tafs = _parse_weather_txt(text)
        assert len(metars) == 1
        assert "METAR" in metars[0]

    def test_speci(self):
        text = "SPECI KHST 150000Z 18005KT\n"
        metars, tafs = _parse_weather_txt(text)
        assert len(metars) == 1

    def test_taf(self):
        text = "TAF KHST 150000Z 1506/1606 18005KT 9999\n"
        metars, tafs = _parse_weather_txt(text)
        assert len(tafs) == 1

    def test_mixed(self):
        text = "METAR KHST 150000Z\nTAF KHST 150000Z\nsome random line\n"
        metars, tafs = _parse_weather_txt(text)
        assert len(metars) == 1
        assert len(tafs) == 1

    def test_empty(self):
        metars, tafs = _parse_weather_txt("")
        assert metars == []
        assert tafs == []

    def test_blank_lines_ignored(self):
        text = "\n\nMETAR XXXX\n\n"
        metars, tafs = _parse_weather_txt(text)
        assert len(metars) == 1


# ── Full extraction with a minimal .miz ──────────────────────────────────────

class TestExtract:
    @pytest.fixture
    def minimal_miz(self, tmp_path):
        """Create a minimal .miz archive with coalition blocks."""
        mission = '''
        ["date"] = {
            ["Year"] = 2024,
            ["Day"] = 15,
            ["Month"] = 6,
        },
        ["start_time"] = 32400,
        ["coalition"] = {
            ["blue"] = {
                ["country"] = {
                    [1] = {
                        ["plane"] = {
                            ["group"] = {
                                [1] = {
                                    ["name"] = "VIPER-1",
                                    ["task"] = "CAP",
                                    ["frequency"] = 251000000,
                                    ["units"] = {
                                        [1] = {
                                            ["type"] = "F-16C_50",
                                            ["skill"] = "Client",
                                            ["onboard_num"] = "101",
                                            ["callsign"] = { ["name"] = "VIPER" },
                                            ["payload"] = { ["pylons"] = { } }
                                        }
                                    },
                                    ["route"] = {
                                        ["points"] = {
                                            [1] = {
                                                ["x"] = 0, ["y"] = 0,
                                                ["type"] = "TakeOffParking",
                                                ["airdromeId"] = 16,
                                                ["alt"] = 0
                                            },
                                            [2] = {
                                                ["x"] = 100000, ["y"] = 100000,
                                                ["type"] = "Turning Point",
                                                ["alt"] = 7000,
                                                ["name"] = "WP1"
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                ["bullseye"] = { ["x"] = 50000, ["y"] = 50000 }
            },
            ["red"] = {
                ["country"] = {
                    [1] = {
                        ["vehicle"] = {
                            ["group"] = {
                                [1] = {
                                    ["name"] = "SA-10-1-1",
                                    ["x"] = 200000, ["y"] = 200000,
                                    ["units"] = {
                                        [1] = { ["type"] = "5P85", ["x"] = 200000, ["y"] = 200000 },
                                        [2] = { ["type"] = "5N63", ["x"] = 200100, ["y"] = 200100 }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        ["weather"] = {
            ["atGround"] = { ["speed"] = 5, ["dir"] = 180 },
            ["clouds"] = { ["base"] = 3000, ["density"] = 2 },
            ["visibility"] = { ["distance"] = 80000 },
            ["fog"] = { ["visibility"] = 0 },
            ["enable_fog"] = false,
            ["enable_dust"] = false,
            ["qnh"] = 760,
            ["season"] = { ["temperature"] = 22 }
        }
        '''
        miz_path = tmp_path / "test_mission.miz"
        with zipfile.ZipFile(miz_path, 'w') as z:
            z.writestr("mission", mission)
            z.writestr("theatre", "Syria")
        return str(miz_path)

    def test_basic_extraction(self, minimal_miz):
        setup_logging(debug=True)
        doc = extract(minimal_miz, "blue")
        assert doc["schema_version"] == "1.0"
        assert doc["header"]["ato_date"] == "2024-06-15"
        assert doc["ato"] is not None

    def test_targets_found(self, minimal_miz):
        setup_logging(debug=True)
        doc = extract(minimal_miz, "blue")
        targets = doc["registry"]["targets"]
        assert targets is not None
        assert len(targets) >= 1

    def test_flights_parsed(self, minimal_miz):
        setup_logging(debug=True)
        doc = extract(minimal_miz, "blue")
        missions = doc["ato"]["missions"]
        assert missions is not None
        assert len(missions) >= 1

    def test_bullseye_found(self, minimal_miz):
        setup_logging(debug=True)
        doc = extract(minimal_miz, "blue")
        ref_pts = doc["registry"]["reference_points"]
        assert ref_pts is not None
        assert any(rp["type"] == "bullseye" for rp in ref_pts)

    def test_weather(self, minimal_miz):
        setup_logging(debug=True)
        doc = extract(minimal_miz, "blue")
        assert "metars" in doc["weather"]
        assert len(doc["weather"]["metars"]) >= 1

    def test_quiet_mode_no_output(self, minimal_miz, capsys):
        setup_logging(quiet=True)
        doc = extract(minimal_miz, "blue")
        captured = capsys.readouterr()
        # In quiet mode, no print() output and no log output to stdout
        assert captured.out == ""

    def test_red_coalition(self, minimal_miz):
        setup_logging(debug=True)
        doc = extract(minimal_miz, "red")
        assert doc is not None

    def test_invalid_zip(self, tmp_path):
        bad = tmp_path / "bad.miz"
        bad.write_text("not a zip")
        with pytest.raises(Exception):
            extract(str(bad))

    def test_meta_section(self, minimal_miz):
        setup_logging(debug=True)
        doc = extract(minimal_miz, "blue")
        assert "_meta" in doc
        assert doc["_meta"]["theatre"] == "Syria"
