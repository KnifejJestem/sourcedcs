"""Tests for miztoyaml.dtc — DTC parsing + SPINS markdown parser."""

import json

import pytest

from tools.miztoyaml.dtc import (
    build_comms_from_dtc,
    parse_dtc_file,
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
