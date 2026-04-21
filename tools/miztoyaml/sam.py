"""sam — SAM system definitions and unit-role classification."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SamSystem:
    name: str
    short_name: str            # short NATO designation used as type key in YAML / sam_database.json
    detect: tuple[str, ...]    # presence of any → system identified
    range_nm: int
    max_alt_ft: int
    launchers: tuple[str, ...] # unit types → aim point (launcher)
    radars: tuple[str, ...]    # unit types → aim point (radar)


# Priority-ordered: first match wins when classifying a group
SAM_SYSTEMS: tuple[SamSystem, ...] = (
    SamSystem("SA-5 Gammon / S-200",
        short_name="SA-5",
        detect=("S-200_Launcher", "RPC_5N62V", "RLS_19J6"),
        range_nm=100, max_alt_ft=80000,
        launchers=("S-200_Launcher",),
        radars=("RPC_5N62V", "RLS_19J6")),

    SamSystem("SA-10 Grumble / S-300",
        short_name="SA-10",
        detect=("5P85", "5N63", "64N6E", "30N6"),
        range_nm=60, max_alt_ft=90000,
        launchers=("5P85",),
        radars=("5N63", "64N6E", "30N6")),

    SamSystem("SA-17 Grizzly / Buk-M2",
        short_name="SA-17",
        detect=("9A317", "9S36"),
        range_nm=20, max_alt_ft=50000,
        launchers=("9A317",),
        radars=("9S36",)),

    SamSystem("SA-11 Gadfly / Buk-M1",
        short_name="SA-11",
        detect=("9A310M1", "9S18M1"),
        range_nm=16, max_alt_ft=46000,
        launchers=("9A310M1",),
        radars=("9S18M1",)),

    SamSystem("PATRIOT",
        short_name="PATRIOT",
        detect=("Patriot ln", "Patriot str", "Patriot EPP"),
        range_nm=60, max_alt_ft=80000,
        launchers=("Patriot ln",),
        radars=("Patriot str", "Patriot EPP")),

    SamSystem("HAWK",
        short_name="HAWK",
        detect=("Hawk ln", "Hawk tr", "Hawk sr", "Hawk cwar", "Hawk pcp"),
        range_nm=25, max_alt_ft=45000,
        launchers=("Hawk ln",),
        radars=("Hawk tr", "Hawk sr", "Hawk cwar", "Hawk pcp")),

    SamSystem("SA-2 Guideline / S-75",
        short_name="SA-2",
        detect=("SNR_75V", "S_75M_Volhov"),
        range_nm=28, max_alt_ft=60000,
        launchers=("S_75M_Volhov",),
        radars=("SNR_75V",)),

    SamSystem("SA-3 Neva / S-125",
        short_name="SA-3",
        detect=("snr s-125", "5p73 s-125", "p-19 s-125"),
        range_nm=15, max_alt_ft=45000,
        launchers=("5p73 s-125",),
        radars=("snr s-125", "p-19 s-125")),

    SamSystem("SA-6 Gainful / Kub",
        short_name="SA-6",
        detect=("Kub 1S91", "Kub 2P25"),
        range_nm=15, max_alt_ft=40000,
        launchers=("Kub 2P25",),
        radars=("Kub 1S91",)),
)

_SUPPORT_TYPES = (
    "ZIL-131", "ZiL-131", "GAZ-66", "Ural-375", "Ural-4320",
    "ATZ-10", "APA-80", "KUNG", "PBU", "Truck",
)


def _contains(unit_type: str, substrings: tuple[str, ...]) -> bool:
    t = unit_type.lower()
    return any(s.lower() in t for s in substrings)


def unit_role(unit_type: str) -> str | None:
    """'launcher' | 'radar' | 'support' | None"""
    if _contains(unit_type, _SUPPORT_TYPES):
        return 'support'
    for sys in SAM_SYSTEMS:
        if _contains(unit_type, sys.launchers):
            return 'launcher'
        if _contains(unit_type, sys.radars):
            return 'radar'
    return None


def identify_system(unit_types: list[str]) -> SamSystem | None:
    for sys in SAM_SYSTEMS:
        if any(_contains(ut, sys.detect) for ut in unit_types):
            return sys
    return None
