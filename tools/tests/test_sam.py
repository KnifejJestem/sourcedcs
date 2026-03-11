"""Tests for miztoyaml.sam — SAM system definitions and unit classification."""

import pytest

from tools.miztoyaml.sam import SAM_SYSTEMS, SamSystem, identify_system, unit_role


class TestUnitRole:
    """unit_role() should classify DCS unit type strings."""

    def test_support_truck(self):
        assert unit_role("ZIL-131") == "support"

    def test_support_case_insensitive(self):
        assert unit_role("GAZ-66") == "support"

    def test_launcher(self):
        assert unit_role("5P85") == "launcher"

    def test_radar(self):
        assert unit_role("5N63") == "radar"

    def test_unknown(self):
        assert unit_role("SomeRandomUnit") is None

    def test_kub_launcher(self):
        assert unit_role("Kub 2P25") == "launcher"

    def test_kub_radar(self):
        assert unit_role("Kub 1S91") == "radar"

    def test_patriot_launcher(self):
        assert unit_role("Patriot ln") == "launcher"

    def test_patriot_radar(self):
        assert unit_role("Patriot str") == "radar"

    def test_support_takes_precedence(self):
        # Support types are checked first
        assert unit_role("Truck") == "support"

    def test_sa2_launcher(self):
        assert unit_role("S_75M_Volhov") == "launcher"

    def test_sa2_radar(self):
        assert unit_role("SNR_75V") == "radar"


class TestIdentifySystem:
    """identify_system() should detect SAM systems from unit type lists."""

    def test_sa10(self):
        sys = identify_system(["5P85", "5N63", "ZIL-131"])
        assert sys is not None
        assert sys.name == "SA-10 Grumble / S-300"

    def test_sa6_kub(self):
        sys = identify_system(["Kub 1S91", "Kub 2P25"])
        assert sys is not None
        assert sys.name == "SA-6 Gainful / Kub"

    def test_no_match(self):
        assert identify_system(["ZIL-131", "GAZ-66"]) is None

    def test_empty_list(self):
        assert identify_system([]) is None

    def test_patriot(self):
        sys = identify_system(["Patriot ln", "Patriot str"])
        assert sys is not None
        assert sys.name == "PATRIOT"

    def test_hawk(self):
        sys = identify_system(["Hawk ln", "Hawk tr"])
        assert sys is not None
        assert sys.name == "HAWK"

    def test_sa5(self):
        sys = identify_system(["S-200_Launcher", "RPC_5N62V"])
        assert sys is not None
        assert sys.name == "SA-5 Gammon / S-200"

    def test_first_match_wins(self):
        # If multiple systems match, the first (highest priority) wins
        sys = identify_system(["S-200_Launcher", "5P85"])
        assert sys is not None
        assert sys.name == "SA-5 Gammon / S-200"


class TestSamSystemDataclass:
    def test_frozen(self):
        sys = SAM_SYSTEMS[0]
        with pytest.raises(AttributeError):
            sys.name = "changed"  # type: ignore

    def test_all_systems_have_required_fields(self):
        for sys in SAM_SYSTEMS:
            assert sys.name
            assert sys.detect
            assert sys.range_nm > 0
            assert sys.max_alt_ft > 0
            assert sys.launchers
            assert sys.radars
