#!/usr/bin/env python3
"""
miz_to_yaml.py  —  DCS .miz → ATO brief package YAML

Usage:
    python3 miz_to_yaml.py <mission.miz> [--coalition blue|red] [-o output.yaml]

Modules (in order):
    lua        – brace-balanced Lua table helpers (no fragile regex splitting)
    projection – DCS Cartesian → WGS84 using pydcs TM constants
    sam        – SAM system definitions + unit classification
    parse      – reads mission Lua into typed Python objects
    build      – turns parsed objects into the output YAML dict
    main       – CLI
"""

from __future__ import annotations

import argparse
import json
import math
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import yaml


# ─────────────────────────────────────────────────────────────────────────────
# lua  —  brace-balanced helpers for Lua table text
# ─────────────────────────────────────────────────────────────────────────────

def lua_block_end(text: str, open_pos: int) -> int:
    """Return index of the '}' that closes the '{' at open_pos."""
    depth = 0
    for i in range(open_pos, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return i
    return len(text) - 1


def lua_get_block(text: str, key: str) -> str | None:
    """Return inner text of  ["key"] = { ... }  (brace-balanced)."""
    m = re.search(rf'\["{re.escape(key)}"\]\s*=\s*\{{', text)
    if not m:
        return None
    close = lua_block_end(text, m.end() - 1)
    return text[m.end() : close]


def lua_iter_array(text: str) -> Iterator[tuple[int, str]]:
    """
    Yield (index, inner_text) for every  [N] = { ... }  entry at the
    TOP level of text.  Nested arrays inside those blocks are skipped.
    """
    pattern = re.compile(r'\[(\d+)\]\s*=\s*\n?\s*\{')
    pos = 0
    while pos < len(text):
        m = pattern.search(text, pos)
        if not m:
            break
        open_pos = m.end() - 1
        close_pos = lua_block_end(text, open_pos)
        yield int(m.group(1)), text[open_pos + 1 : close_pos]
        pos = close_pos + 1


def lua_str(text: str, key: str) -> str | None:
    m = re.search(rf'\["{re.escape(key)}"\]\s*=\s*"([^"]*)"', text)
    return m.group(1) if m else None


def lua_num(text: str, key: str) -> float | None:
    m = re.search(rf'\["{re.escape(key)}"\]\s*=\s*([0-9eE.+\-]+)', text)
    return float(m.group(1)) if m else None


def lua_bool(text: str, key: str) -> bool:
    m = re.search(rf'\["{re.escape(key)}"\]\s*=\s*(true|false)', text)
    return m.group(1) == 'true' if m else False


def lua_xy(text: str) -> tuple[float, float] | None:
    x, y = lua_num(text, 'x'), lua_num(text, 'y')
    return (x, y) if (x is not None and y is not None) else None


# ─────────────────────────────────────────────────────────────────────────────
# projection  —  DCS (x=north, y=east) → WGS84 lat/lon
# ─────────────────────────────────────────────────────────────────────────────

# Transverse Mercator constants from pydcs / projections.rs
_TM: dict[str, dict] = {
    "PersianGulf":    dict(lon0= 57,  fe=  75756.0,    fn=-2894933.0,   k0=0.9996),
    "Falklands":      dict(lon0=-57,  fe= 147640.0,    fn= 5815417.0,   k0=0.9996),
    "Caucasus":       dict(lon0= 33,  fe= -99517.0,    fn=-4998115.0,   k0=0.9996),
    "MarianaIslands": dict(lon0=147,  fe= 238418.0,    fn=-1491840.0,   k0=0.9996),
    "Nevada":         dict(lon0=-117, fe=-193996.81,   fn=-4410028.064, k0=0.9996),
    "Normandy":       dict(lon0= -3,  fe=-195526.0,    fn=-5484813.0,   k0=0.9996),
    "Syria":          dict(lon0= 39,  fe= 282801.0,    fn=-3879866.0,   k0=0.9996),
    "SinaiMap":       dict(lon0= 33,  fe= 169222.0,    fn=-3325313.0,   k0=0.9996),
}

_A   = 6378137.0
_F   = 1 / 298.257223563
_E2  = 2 * _F - _F**2
_EP2 = _E2 / (1 - _E2)


def dcs_to_latlon(x: float, y: float, theatre: str) -> tuple[float, float]:
    p = _TM.get(theatre, _TM["Syria"])
    lon0, fe, fn, k0 = math.radians(p["lon0"]), p["fe"], p["fn"], p["k0"]

    E, N = y - fe, x - fn
    e1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))
    mu = (N / k0) / (_A * (1 - _E2/4 - 3*_E2**2/64 - 5*_E2**3/256))
    phi1 = (mu
        + (3*e1/2     - 27*e1**3/32)    * math.sin(2*mu)
        + (21*e1**2/16 - 55*e1**4/32)  * math.sin(4*mu)
        + (151*e1**3/96)                * math.sin(6*mu)
        + (1097*e1**4/512)              * math.sin(8*mu))

    sp = math.sin(phi1); tp = math.tan(phi1); cp = math.cos(phi1)
    N1 = _A / math.sqrt(1 - _E2*sp**2)
    T1 = tp**2; C1 = _EP2*cp**2
    R1 = _A*(1 - _E2) / (1 - _E2*sp**2)**1.5
    D  = E / (N1*k0)

    lat = phi1 - (N1*tp/R1) * (
          D**2/2
        - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*_EP2)                  * D**4/24
        + (61 + 90*T1 + 298*C1 + 45*T1**2 - 252*_EP2 - 3*C1**2)  * D**6/720)
    lon = lon0 + (
          D
        - (1 + 2*T1 + C1)                                         * D**3/6
        + (5 - 2*C1 + 28*T1 - 3*C1**2 + 8*_EP2 + 24*T1**2)       * D**5/120
    ) / cp

    return math.degrees(lat), math.degrees(lon)


def dms(lat: float, lon: float) -> str:
    """(lat, lon) → 'N36°09'23\" E037°16'55\"'"""
    def _fmt(deg, pos, neg):
        c = pos if deg >= 0 else neg
        d = abs(deg)
        dd, rem = divmod(d, 1)
        mm, rem = divmod(rem * 60, 1)
        ss = round(rem * 60)
        if ss == 60: ss, mm = 0, mm + 1
        if mm == 60: mm, dd = 0, dd + 1
        return f"{c}{int(dd):02d}\u00b0{int(mm):02d}'{ss:02d}\""
    return f"{_fmt(lat,'N','S')} {_fmt(lon,'E','W')}"


# ─────────────────────────────────────────────────────────────────────────────
# sam  —  major system definitions + unit role classification
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SamSystem:
    name: str
    detect: tuple[str, ...]    # presence of any → system identified
    range_nm: int
    max_alt_ft: int
    launchers: tuple[str, ...] # unit types → aim point (launcher)
    radars: tuple[str, ...]    # unit types → aim point (radar)


# Priority-ordered: first match wins when classifying a group
SAM_SYSTEMS: tuple[SamSystem, ...] = (
    SamSystem("SA-5 Gammon / S-200",
        detect=("S-200_Launcher", "RPC_5N62V", "RLS_19J6"),
        range_nm=100, max_alt_ft=80000,
        launchers=("S-200_Launcher",),
        radars=("RPC_5N62V", "RLS_19J6")),

    SamSystem("SA-10 Grumble / S-300",
        detect=("5P85", "5N63", "64N6E", "30N6"),
        range_nm=60, max_alt_ft=90000,
        launchers=("5P85",),
        radars=("5N63", "64N6E", "30N6")),

    SamSystem("SA-17 Grizzly / Buk-M2",
        detect=("9A317", "9S36"),
        range_nm=20, max_alt_ft=50000,
        launchers=("9A317",),
        radars=("9S36",)),

    SamSystem("SA-11 Gadfly / Buk-M1",
        detect=("9A310M1", "9S18M1"),
        range_nm=16, max_alt_ft=46000,
        launchers=("9A310M1",),
        radars=("9S18M1",)),

    SamSystem("PATRIOT",
        detect=("Patriot ln", "Patriot str", "Patriot EPP"),
        range_nm=60, max_alt_ft=80000,
        launchers=("Patriot ln",),
        radars=("Patriot str", "Patriot EPP")),

    SamSystem("HAWK",
        detect=("Hawk ln", "Hawk tr", "Hawk sr", "Hawk cwar", "Hawk pcp"),
        range_nm=25, max_alt_ft=45000,
        launchers=("Hawk ln",),
        radars=("Hawk tr", "Hawk sr", "Hawk cwar", "Hawk pcp")),

    SamSystem("SA-2 Guideline / S-75",
        detect=("SNR_75V", "S_75M_Volhov"),
        range_nm=28, max_alt_ft=60000,
        launchers=("S_75M_Volhov",),
        radars=("SNR_75V",)),

    SamSystem("SA-3 Neva / S-125",
        detect=("snr s-125", "5p73 s-125", "p-19 s-125"),
        range_nm=15, max_alt_ft=45000,
        launchers=("5p73 s-125",),
        radars=("snr s-125", "p-19 s-125")),

    SamSystem("SA-6 Gainful / Kub",
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


# ─────────────────────────────────────────────────────────────────────────────
# weapons  —  CLSID → human-readable name
# ─────────────────────────────────────────────────────────────────────────────

# Known DCS weapon / store CLSIDs.  Unknown CLSIDs are returned as-is (stripped
# of braces) so they still appear in the output rather than silently disappearing.
CLSID_NAMES: dict[str, str] = {
    # ── Air-to-Air ───────────────────────────────────────────────────────────
    # AIM-120 AMRAAM
    "{40EF17B7-F508-45de-8566-6FFECC0C1AB8}": "AIM-120C",
    "{A111396E-D3E8-4b9c-8AC9-2432489304D5}": "AIM-120B",
    "{F376DBEE-4CAE-41BA-ADD9-B2910AC95DEC}": "AIM-120C",
    "{B06DD79A-F55E-4740-8ECF-9ED1FF8F5CEB}": "AIM-120C-7",
    # AIM-9 Sidewinder
    "{E6A6262A-CA08-4B3D-B030-E1A993B98452}": "AIM-9M",
    "{E6A6262A-CA08-4B3D-B030-E1A993B98453}": "AIM-9X",
    "{5CE2FF2A-645A-4197-B48D-8720AC69394F}": "AIM-9X",
    "{6CEB49FC-DED8-4DED-B053-E1F033FF72D3}": "AIM-9X-2",
    # AIM-7 Sparrow
    "{8D399B27-BEFD-4020-A398-CA5579BCDBD1}": "AIM-7M",
    "{AB8B8299-F1CC-4359-89B5-2172E0CF4A5A}": "AIM-7F",
    # ── AGM — SEAD ───────────────────────────────────────────────────────────
    "{7A44FF09-57A9-4223-9480-249400A97B4B}": "AGM-88C HARM",
    "{0267FF4B-340A-4674-B4B3-FE7B84D6B24E}": "AGM-88B HARM",
    "{E8D4B10D-A846-42C5-A046-E3F74ED36B80}": "AGM-88 HARM",
    "{HAM_HARM}":                              "AGM-88 HARM",
    # ── AGM — Maverick ───────────────────────────────────────────────────────
    "{AGM_65D}": "AGM-65D", "{AGM_65E}": "AGM-65E", "{AGM_65F}": "AGM-65F",
    "{AGM_65G}": "AGM-65G", "{AGM_65H}": "AGM-65H", "{AGM_65K}": "AGM-65K",
    "{AGM_65L}": "AGM-65L", "{AGM_65R}": "AGM-65R",
    # ── AGM — Cruise / Stand-off ─────────────────────────────────────────────
    "{AGM_154A}": "AGM-154A JSOW", "{AGM_154C}": "AGM-154C JSOW",
    "{AGM_158}":  "AGM-158 JASSM",
    # ── GBU — Paveway laser-guided ───────────────────────────────────────────
    "{GBU-10}":  "GBU-10",   "{GBU_10}":  "GBU-10",
    "{GBU-12}":  "GBU-12",   "{GBU_12}":  "GBU-12",
    "{GBU-16}":  "GBU-16",   "{GBU_16}":  "GBU-16",
    "{GBU-24}":  "GBU-24",   "{GBU_24}":  "GBU-24",
    "{GBU-27}":  "GBU-27",
    "{GBU-28}":  "GBU-28",
    # ── GBU — JDAM GPS-guided ────────────────────────────────────────────────
    "{GBU-31}":       "GBU-31",  "{GBU_31}":       "GBU-31",
    "{GBU-31_V3B}":   "GBU-31",  "{GBU_31_V3B}":   "GBU-31",
    "{GBU-32_V2B}":   "GBU-32",  "{GBU_32_V2B}":   "GBU-32",
    "{GBU-38}":       "GBU-38",  "{GBU_38}":       "GBU-38",
    "{GBU-38_V1B}":   "GBU-38",  "{GBU_38_V1B}":   "GBU-38",
    "{GBU-54_V1B}":   "GBU-54",  "{GBU_54_V1B}":   "GBU-54",
    # ── GBU — Small Diameter Bomb ────────────────────────────────────────────
    "{GBU-39}":                        "GBU-39",
    "{GBU-39_B_WITH_FINS_UNIT_ASSEMBLY}": "GBU-39",
    # ── Unguided bombs ───────────────────────────────────────────────────────
    "{Mk_82}": "Mk-82",  "{Mk-82}": "Mk-82",  "{MK_82}": "Mk-82",
    "{Mk_82Y}": "Mk-82",
    "{Mk_83}": "Mk-83",  "{Mk-83}": "Mk-83",  "{MK_83}": "Mk-83",
    "{Mk_84}": "Mk-84",  "{Mk-84}": "Mk-84",  "{MK_84}": "Mk-84",
    # ── CBU cluster ──────────────────────────────────────────────────────────
    "{CBU_87}": "CBU-87",  "{CBU-87}": "CBU-87",
    "{CBU_97}": "CBU-97",  "{CBU-97}": "CBU-97",
    "{CBU_103}": "CBU-103", "{CBU-103}": "CBU-103",
    "{CBU_105}": "CBU-105", "{CBU-105}": "CBU-105",
    # ── Fuel tanks ───────────────────────────────────────────────────────────
    "{FPU_8A_FUEL_TANK}": "300gal Tank",
    "{Sullivan_TANK}":    "Fuel Tank",
    "{A_A_refuel_pod}":   "AAR Pod",
    # ── Pods / ECM ───────────────────────────────────────────────────────────
    "{AN_ASQ_213}":         "HTS Pod",
    "{AN_AAQ_28_LITENING}": "Litening Pod",
    "{AN_ASQ_228}":         "ATFLIR Pod",
    "ALQ_184_Long":         "ALQ-184 ECM",
    "ALQ_184":              "ALQ-184 ECM",
    "{AN_ALQ_131}":         "ALQ-131 ECM",
    # ── LAU racks (FA-18) ────────────────────────────────────────────────────
    "LAU-115_2*LAU-127_AIM-120C": "2× AIM-120C",
    "LAU-115C_with_AIM-7F":       "AIM-7F",
    "LAU-115_LAU-127_AIM-9M":     "AIM-9M",
    "LAU-115_LAU-127_AIM-9X":     "AIM-9X",
    "LAU-115_2*LAU-127_AIM-9X":   "2× AIM-9X",
}

# DCS ship types that are fixed-wing carriers
CARRIER_TYPES: frozenset[str] = frozenset({
    "CVN_71", "CVN_72", "CVN_73", "CVN_74", "CVN_75",
    "CVN_76", "CVN_77", "LHA_Tarawa", "Kuznetsov",
})

# DCS group task → mission type label
TASK_LABELS: dict[str, str] = {
    "CAP":          "CAP",
    "CAS":          "CAS",
    "SEAD":         "SEAD",
    "Strike":       "STRIKE",
    "Antiship Strike": "ANTISHIP",
    "Intercept":    "INTERCEPT",
    "Escort":       "ESCORT",
    "Refueling":    "TANKER",
    "AFAC":         "FAC(A)",
    "Reconnaissance": "RECCE",
    "Transport":    "TRANSPORT",
    "Ground Attack":"STRIKE",
    "Nothing":      "FERRY",
}


def resolve_clsid(clsid: str) -> str:
    """Return a human-readable weapon name for a DCS CLSID string."""
    if clsid in CLSID_NAMES:
        return CLSID_NAMES[clsid]
    # Strip braces for unknown CLSIDs so output stays readable
    return clsid.strip("{}")


def condense_loadout(weapons: list[str]) -> list[str]:
    """
    Collapse repeated weapon names into 'N× NAME' entries, drop tanks/pods.
    Weapons already containing '×' (pre-counted LAU racks) are expanded first
    so counts are summed correctly (e.g. two '2× AIM-120C' racks → '4× AIM-120C').
    """
    SKIP = {"300gal Tank", "Fuel Tank", "AAR Pod", "ALQ-184 ECM",
            "ALQ-131 ECM", "HTS Pod", "Litening Pod", "ATFLIR Pod"}
    counts: dict[str, int] = {}
    for w in weapons:
        if w in SKIP:
            continue
        # expand pre-counted entries like '2× AIM-120C'
        m = re.match(r'^(\d+)[×x]\s+(.+)$', w)
        if m:
            name, n = m.group(2), int(m.group(1))
        else:
            name, n = w, 1
        counts[name] = counts.get(name, 0) + n
    result = []
    for name, n in counts.items():
        result.append(f"{n}× {name}" if n > 1 else name)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# dtc  —  DCS Data Transfer Cartridge parsing
# ─────────────────────────────────────────────────────────────────────────────

def _dtc_freq(ch: dict) -> float | None:
    """Return frequency from a DTC channel dict (handles 'freq' and 'frequency' keys)."""
    f = ch.get('freq') or ch.get('frequency')
    return float(f) if f is not None else None


def _dtc_ch_num(key: str) -> int | None:
    """Return channel number from 'Channel_N' key, or None for non-numeric keys (C, G, M, S)."""
    m = re.match(r'^Channel_(\d+)$', key)
    return int(m.group(1)) if m else None


def parse_dtc_file(content: bytes) -> dict[str, dict[int, float]]:
    """
    Parse a DCS DTC JSON file.
    Returns {radio_key: {channel_num: freq_mhz}} for COMM1, COMM2, etc.
    Special non-numeric channels (GUARD, CUE, MAN) are skipped.
    """
    try:
        data = json.loads(content.decode('utf-8', errors='replace'))['data']
    except (json.JSONDecodeError, KeyError):
        return {}
    result: dict[str, dict[int, float]] = {}
    for radio_key, channels in data.get('COMM', {}).items():
        if not isinstance(channels, dict):
            continue
        presets: dict[int, float] = {}
        for ch_key, ch_val in channels.items():
            if not isinstance(ch_val, dict):
                continue
            n = _dtc_ch_num(ch_key)
            if n is None:
                continue
            freq = _dtc_freq(ch_val)
            if freq is not None:
                presets[n] = freq
        if presets:
            result[radio_key] = presets
    return result


def load_dtc_files(z: zipfile.ZipFile) -> dict[str, dict]:
    """
    Load all DTC files from the miz archive.
    Returns {dtc_name: {radio: {channel_num: freq_mhz}}}.
    DTC name is the stem of the file (e.g. 'Broomstick_F16').
    """
    dtcs: dict[str, dict] = {}
    for fname in z.namelist():
        if fname.startswith('DTC/') and fname.endswith('.dtc'):
            stem = Path(fname).stem
            dtcs[stem] = parse_dtc_file(z.read(fname))
    return dtcs


def build_comms_from_dtc(dtc_channels: dict[str, dict[int, float]]) -> tuple[dict | None, dict | None]:
    """
    Classify DTC COMM channels into UHF (≥225 MHz) and VHF (<225 MHz) preset dicts.
    Returns (uhf_presets, vhf_presets) where each is {channel_num: {freq_mhz: X}} or None.
    Channels from COMM1 take priority; COMM2 fills in any gaps.
    """
    uhf: dict[int, dict] = {}
    vhf: dict[int, dict] = {}
    for radio in ('COMM1', 'COMM2'):
        presets = dtc_channels.get(radio, {})
        for ch_num, freq in presets.items():
            if freq >= 225.0:
                if ch_num not in uhf:
                    uhf[ch_num] = {'callsign': None, 'freq_mhz': freq, 'role': None}
            else:
                if ch_num not in vhf:
                    vhf[ch_num] = {'callsign': None, 'freq_mhz': freq, 'role': None}
    return (dict(sorted(uhf.items())) or None,
            dict(sorted(vhf.items())) or None)


# ─────────────────────────────────────────────────────────────────────────────
# spins  —  parse a plain-text spins.md file into YAML sections
# ─────────────────────────────────────────────────────────────────────────────

def parse_spins_md(text: str) -> list[dict]:
    """
    Parse a spins.md file into the YAML spins sections format.

    Markdown format accepted:
      ## Section Title          → new section
      NOTE: text               → section-level note (first occurrence per section)
      LABEL: value text        → {label: LABEL, value: value text}
      - bullet text            → {bullet: bullet text}
      |h1|h2|...|  + |--|--|   → table block
      blank lines              → ignored
    """
    sections: list[dict] = []
    current: dict | None = None
    table_headers: list[str] | None = None
    table_rows: list[list[str]] = []
    in_table = False

    def flush_table():
        nonlocal table_headers, table_rows, in_table
        if table_headers and current is not None:
            current.setdefault('table', {
                'headers': table_headers,
                'rows': table_rows,
            })
        table_headers = None
        table_rows = []
        in_table = False

    for raw in text.splitlines():
        line = raw.strip()

        # Section heading
        if line.startswith('## '):
            if in_table:
                flush_table()
            if current is not None:
                sections.append(current)
            current = {'title': line[3:].strip(), 'entries': []}
            continue

        if current is None:
            continue

        # Table line
        if line.startswith('|'):
            cols = [c.strip() for c in line.strip('|').split('|')]
            # Separator row (e.g. |---|---|)
            if all(re.match(r'^[-:]+$', c) for c in cols if c):
                in_table = True
                continue
            if table_headers is None:
                table_headers = cols
            else:
                table_rows.append(cols)
            continue
        else:
            if in_table:
                flush_table()

        if not line:
            continue

        # Note line
        m_note = re.match(r'^NOTE:\s*(.*)', line, re.IGNORECASE)
        if m_note:
            current['note'] = m_note.group(1).strip()
            continue

        # Bullet line
        if line.startswith('- '):
            current['entries'].append({'bullet': line[2:].strip()})
            continue

        # Key: Value line (UPPERCASE key)
        m_kv = re.match(r'^([A-Z][A-Z0-9 /._-]+):\s*(.*)', line)
        if m_kv:
            current['entries'].append({'label': m_kv.group(1).strip(),
                                       'value': m_kv.group(2).strip()})
            continue

        # Plain value / objective line
        current['entries'].append({'value': line})

    if in_table:
        flush_table()
    if current is not None:
        sections.append(current)

    # Clean up: remove empty 'entries' lists
    for sec in sections:
        if not sec.get('entries'):
            sec.pop('entries', None)

    return sections or None


# ─────────────────────────────────────────────────────────────────────────────
# parse  —  Lua text → typed Python objects
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Unit:
    type: str
    x: float
    y: float
    lat: float
    lon: float
    role: str | None


@dataclass
class Group:
    name: str
    x: float
    y: float
    lat: float
    lon: float
    units: list[Unit] = field(default_factory=list)


@dataclass
class FlightUnit:
    type: str           # DCS aircraft type e.g. "F-16C_50"
    callsign: str       # e.g. "Viper11"
    onboard_num: str    # e.g. "101"
    skill: str          # Client / Excellent / High / etc.
    loadout: list[str]  # condensed weapon list
    dtc_cartridge: str | None = None  # DTC cartridge name e.g. "Broomstick_F16"


@dataclass
class Waypoint:
    name: str | None    # DCS waypoint name (may be None)
    x: float            # DCS north
    y: float            # DCS east
    lat: float
    lon: float
    typ: str            # DCS type: TakeOffParking, Turning Point, etc.
    airdrome_id: int | None    # set for TakeOff waypoints from airfields
    link_unit_id: int | None   # set for TakeOff from carriers (unit id)
    is_orbit: bool             # waypoint has an Orbit task (tanker track)


@dataclass
class Flight:
    id: str             # auto-assigned e.g. "FLT-1"
    name: str           # group name e.g. "SHADOW-1"
    task: str           # human label e.g. "CAP"
    aircraft_type: str  # from first unit
    freq_mhz: float
    units: list[FlightUnit] = field(default_factory=list)
    waypoints: list[Waypoint] = field(default_factory=list)
    is_tanker: bool = False
    dtc_cartridge: str | None = None  # primary DTC cartridge used by this flight


@dataclass
class Carrier:
    id: str             # e.g. "CVN-1"
    type: str           # "CVN_75"
    name: str           # group name
    unit_id: int        # DCS unitId (used to match takeoff linkUnit)
    deploy_coords: str  # DMS at mission start
    recovery_coords: str  # DMS projected 4h ahead


@dataclass
class Drawing:
    name: str
    polygon_mode: str        # 'circle' | 'rect' | 'free'
    origin_x: float          # mapX — absolute DCS coord
    origin_y: float          # mapY — absolute DCS coord
    # circle
    radius_m: float | None = None
    # rect
    width_m: float | None = None
    height_m: float | None = None
    angle_deg: float | None = None
    # free polygon — relative (x, y) offsets from origin, zero-stripped
    rel_points: list[tuple[float, float]] = field(default_factory=list)


def parse_units(units_block: str, theatre: str) -> list[Unit]:
    result = []
    for _i, ub in lua_iter_array(units_block):
        ut = lua_str(ub, 'type')
        xy = lua_xy(ub)
        if ut and xy:
            lat, lon = dcs_to_latlon(xy[0], xy[1], theatre)
            result.append(Unit(type=ut, x=xy[0], y=xy[1],
                               lat=lat, lon=lon, role=unit_role(ut)))
    return result


def _strip_dcs_suffix(name: str) -> str:
    """
    DCS appends '-routeIdx-waypointIdx' to every group name.
    Strip to recover the human-readable name.
    e.g. 'Aleppo SA-3 2-1-1' → 'Aleppo SA-3 2'
         'EFTA07-4-1'         → 'EFTA07'
    """
    return re.sub(r'-\d+-\d+$', '', name)


def _group_outer_name(gb: str) -> str | None:
    """
    Extract the group's own ["name"] field, ignoring nested sub-blocks.

    In DCS Lua, a plane group block contains 'route' (with waypoint names) and
    'units' (with unit names and callsign names) BEFORE the group-level name.
    A flat search picks up the wrong name; this function strips those sub-blocks
    first to ensure we only search the group's outer fields.
    """
    stripped = gb
    for key in ('route', 'units'):
        m = re.search(rf'\["{key}"\]\s*=\s*\{{', stripped)
        if m:
            close = lua_block_end(stripped, m.end() - 1)
            stripped = stripped[:m.start()] + stripped[close + 1:]
    return lua_str(stripped, 'name')


def parse_groups(coalition_block: str, theatre: str) -> list[Group]:
    """
    Parse all ground groups from a coalition block.
    Each raw DCS entry is an independent physical group.
    The '-routeIdx-waypointIdx' suffix is stripped for display only.
    """
    groups: list[Group] = []
    country_block = lua_get_block(coalition_block, 'country')
    if not country_block:
        return groups

    for _ci, country in lua_iter_array(country_block):
        for category in ('vehicle', 'static', 'helicopter', 'ship'):
            cat_block = lua_get_block(country, category)
            if not cat_block:
                continue
            grp_container = lua_get_block(cat_block, 'group')
            if not grp_container:
                continue
            for _gi, gb in lua_iter_array(grp_container):
                raw_name = lua_str(gb, 'name')
                if not raw_name:
                    continue
                name = _strip_dcs_suffix(raw_name)
                xy   = lua_xy(gb)
                if not xy:
                    continue
                lat, lon    = dcs_to_latlon(xy[0], xy[1], theatre)
                units_block = lua_get_block(gb, 'units')
                units       = parse_units(units_block, theatre) if units_block else []
                groups.append(Group(name=name, x=xy[0], y=xy[1],
                                    lat=lat, lon=lon, units=units))
    return groups


def parse_drawings(mission_text: str) -> list[Drawing]:
    drawings_block  = lua_get_block(mission_text, 'drawings')
    if not drawings_block:
        return []
    layers_block = lua_get_block(drawings_block, 'layers')
    if not layers_block:
        return []

    # Find the layer named "Common"
    common_block = None
    for _li, layer in lua_iter_array(layers_block):
        if lua_str(layer, 'name') == 'Common':
            common_block = layer
            break
    if not common_block:
        return []

    objects_block = lua_get_block(common_block, 'objects')
    if not objects_block:
        return []

    result: list[Drawing] = []
    for _oi, ob in lua_iter_array(objects_block):
        if lua_str(ob, 'primitiveType') != 'Polygon':
            continue
        name = lua_str(ob, 'name')
        if not name:
            continue

        pmode    = lua_str(ob, 'polygonMode') or 'free'
        origin_x = lua_num(ob, 'mapX') or 0.0
        origin_y = lua_num(ob, 'mapY') or 0.0

        if pmode == 'circle':
            result.append(Drawing(
                name=name, polygon_mode='circle',
                origin_x=origin_x, origin_y=origin_y,
                radius_m=lua_num(ob, 'radius'),
            ))

        elif pmode == 'rect':
            result.append(Drawing(
                name=name, polygon_mode='rect',
                origin_x=origin_x, origin_y=origin_y,
                width_m=lua_num(ob, 'width'),
                height_m=lua_num(ob, 'height'),
                angle_deg=lua_num(ob, 'angle') or 0.0,
            ))

        elif pmode == 'free':
            pts_block = lua_get_block(ob, 'points')
            rel_points: list[tuple[float, float]] = []
            if pts_block:
                # Collect all points sorted by Lua index.
                # In DCS, (0,0) means the mapX/mapY origin IS a real vertex —
                # it is NOT padding.  Multiple (0,0) entries are duplicates
                # of the same origin vertex; keep only one.
                # The last point is a polygon-close back to the first; drop it.
                raw: list[tuple[int, float, float]] = []
                for idx, pb in lua_iter_array(pts_block):
                    xy = lua_xy(pb)
                    if xy:
                        raw.append((idx, xy[0], xy[1]))
                raw.sort()

                seen: set[tuple[float, float]] = set()
                for _idx, rx, ry in raw:
                    pt = (round(rx, 1), round(ry, 1))
                    if pt not in seen:
                        seen.add(pt)
                        rel_points.append((rx, ry))

                # Drop trailing close-vertex if it duplicates the first
                if len(rel_points) >= 2:
                    first = (round(rel_points[0][0], 1), round(rel_points[0][1], 1))
                    last  = (round(rel_points[-1][0], 1), round(rel_points[-1][1], 1))
                    if first == last:
                        rel_points.pop()

            if len(rel_points) >= 3:
                result.append(Drawing(
                    name=name, polygon_mode='free',
                    origin_x=origin_x, origin_y=origin_y,
                    rel_points=rel_points,
                ))

    return result


def parse_bullseye(coalition_block: str, theatre: str) -> str | None:
    be = lua_get_block(coalition_block, 'bullseye')
    if not be:
        return None
    xy = lua_xy(be)
    if not xy:
        return None
    lat, lon = dcs_to_latlon(xy[0], xy[1], theatre)
    return dms(lat, lon)


def _parse_callsign(cs_block: str | None) -> str:
    """Extract callsign name from the callsign sub-block."""
    if not cs_block:
        return ""
    return lua_str(cs_block, 'name') or ""


def _project_position(x1: float, y1: float, x2: float, y2: float,
                      speed_ms: float, hours: float) -> tuple[float, float]:
    """Project a position along a track vector N hours ahead at given speed."""
    dx, dy = x2 - x1, y2 - y1
    dist = math.sqrt(dx*dx + dy*dy)
    if dist < 1:
        return x1, y1
    t = hours * 3600
    return x1 + (dx/dist)*speed_ms*t, y1 + (dy/dist)*speed_ms*t


def _parse_waypoints(route_block: str, theatre: str) -> list[Waypoint]:
    """Parse route.points into Waypoint objects."""
    points_block = lua_get_block(route_block, 'points')
    if not points_block:
        return []
    wpts: list[Waypoint] = []
    for _pi, pb in lua_iter_array(points_block):
        xy = lua_xy(pb)
        if not xy:
            continue
        typ        = lua_str(pb, 'type') or ''
        name       = lua_str(pb, 'name')
        airdrome   = lua_num(pb, 'airdromeId')
        link_unit  = lua_num(pb, 'linkUnit')
        # Detect orbit task (tanker track anchor)
        task_blk   = lua_get_block(pb, 'task')
        is_orbit   = bool(task_blk and 'Orbit' in task_blk)
        lat, lon   = dcs_to_latlon(xy[0], xy[1], theatre)
        wpts.append(Waypoint(
            name=name, x=xy[0], y=xy[1], lat=lat, lon=lon,
            typ=typ,
            airdrome_id=int(airdrome) if airdrome is not None else None,
            link_unit_id=int(link_unit) if link_unit is not None else None,
            is_orbit=is_orbit,
        ))
    return wpts


def parse_flights_and_carriers(
    coalition_block: str, theatre: str
) -> tuple[list[Flight], list[Carrier]]:
    """
    Walk all countries in a coalition block.
    - 'plane' groups  → Flight objects (with parsed waypoints)
    - 'ship' groups   → Carrier objects (with 4-hour projected recovery position)
    """
    flights: list[Flight]   = []
    carriers: list[Carrier] = []
    flt_seq = car_seq = 1

    country_block = lua_get_block(coalition_block, 'country')
    if not country_block:
        return flights, carriers

    for _ci, country in lua_iter_array(country_block):

        # ── Carriers ────────────────────────────────────────────
        ship_block = lua_get_block(country, 'ship')
        if ship_block:
            grp = lua_get_block(ship_block, 'group')
            if grp:
                for _gi, gb in lua_iter_array(grp):
                    gname  = lua_str(gb, 'name')
                    ub_blk = lua_get_block(gb, 'units')
                    if not ub_blk:
                        continue

                    # Collect carrier unit + route for projection
                    route  = lua_get_block(gb, 'route')
                    r_wpts = _parse_waypoints(route, theatre) if route else []

                    for _ui, ub in lua_iter_array(ub_blk):
                        utype   = lua_str(ub, 'type')
                        uname   = lua_str(ub, 'name')
                        unit_id = lua_num(ub, 'unitId')
                        if utype not in CARRIER_TYPES:
                            continue
                        xy = lua_xy(ub)
                        if not xy:
                            continue

                        deploy_lat, deploy_lon = dcs_to_latlon(xy[0], xy[1], theatre)
                        deploy_c = dms(deploy_lat, deploy_lon)

                        # Project 4h ahead from carrier unit position along route heading
                        recovery_c = deploy_c
                        pts_blk = lua_get_block(route, 'points') if route else None
                        if pts_blk and len(r_wpts) >= 2:
                            spd = 0.0
                            for _ri, rp in lua_iter_array(pts_blk):
                                s = lua_num(rp, 'speed')
                                if s and s > 0:
                                    spd = s
                                    break
                            # Project from carrier unit's actual xy toward second route wp
                            rx, ry = _project_position(
                                xy[0], xy[1],
                                r_wpts[1].x, r_wpts[1].y,
                                spd, 4.0)
                            rec_lat, rec_lon = dcs_to_latlon(rx, ry, theatre)
                            recovery_c = dms(rec_lat, rec_lon)

                        c_obj = Carrier(
                            id=f"CVN-{car_seq}",
                            type=utype,
                            name=uname or gname or utype,
                            unit_id=int(unit_id) if unit_id is not None else 0,
                            deploy_coords=deploy_c,
                            recovery_coords=recovery_c,
                        )
                        # Store raw DCS coords for proximity matching in _home_base
                        c_obj._x = xy[0]  # type: ignore[attr-defined]
                        c_obj._y = xy[1]  # type: ignore[attr-defined]
                        carriers.append(c_obj)
                        car_seq += 1

        # ── Flights ─────────────────────────────────────────────
        plane_block = lua_get_block(country, 'plane')
        if not plane_block:
            continue
        grp = lua_get_block(plane_block, 'group')
        if not grp:
            continue

        for _gi, gb in lua_iter_array(grp):
            raw_name = _group_outer_name(gb) or f"FLT-{flt_seq}"
            gname    = _strip_dcs_suffix(raw_name)
            task_raw = lua_str(gb, 'task') or 'Nothing'
            task     = TASK_LABELS.get(task_raw, task_raw.upper())
            freq_raw = lua_num(gb, 'frequency') or 0.0
            freq_mhz = freq_raw / 1e6 if freq_raw > 1e6 else freq_raw
            is_tanker = (task == 'TANKER')

            ub_blk = lua_get_block(gb, 'units')
            if not ub_blk:
                continue

            flight_units: list[FlightUnit] = []
            aircraft_type = ""

            for _ui, ub in lua_iter_array(ub_blk):
                utype   = lua_str(ub, 'type') or '?'
                skill   = lua_str(ub, 'skill') or ''
                onboard = lua_str(ub, 'onboard_num') or ''
                cs_blk  = lua_get_block(ub, 'callsign')
                cs      = _parse_callsign(cs_blk)
                if not aircraft_type:
                    aircraft_type = utype
                payload_blk = lua_get_block(ub, 'payload')
                pylons_blk  = lua_get_block(payload_blk, 'pylons') if payload_blk else None
                weapons_raw: list[str] = []
                if pylons_blk:
                    for _pi, pb in lua_iter_array(pylons_blk):
                        clsid = lua_str(pb, 'CLSID')
                        if clsid:
                            weapons_raw.append(resolve_clsid(clsid))
                # Extract DTC cartridge name from this unit's DTC block
                unit_dtc: str | None = None
                unit_dtc_blk = lua_get_block(ub, 'DTC')
                if unit_dtc_blk:
                    carts_blk = lua_get_block(unit_dtc_blk, 'Cartridges')
                    if carts_blk:
                        for _ci, cb in lua_iter_array(carts_blk):
                            n = lua_str(cb, 'name')
                            if n:
                                unit_dtc = n
                                break
                flight_units.append(FlightUnit(
                    type=utype, callsign=cs, onboard_num=onboard,
                    skill=skill, loadout=condense_loadout(weapons_raw),
                    dtc_cartridge=unit_dtc,
                ))

            if not flight_units:
                continue

            # Parse waypoints from route
            route  = lua_get_block(gb, 'route')
            wpts   = _parse_waypoints(route, theatre) if route else []

            # Primary DTC for this flight = first unit that has one
            flight_dtc = next((u.dtc_cartridge for u in flight_units if u.dtc_cartridge), None)

            flights.append(Flight(
                id=f"FLT-{flt_seq}",
                name=gname, task=task,
                aircraft_type=aircraft_type,
                freq_mhz=round(freq_mhz, 3),
                units=flight_units,
                waypoints=wpts,
                is_tanker=is_tanker,
                dtc_cartridge=flight_dtc,
            ))
            flt_seq += 1

    return flights, carriers


def parse_weather(mission_text: str, day: int) -> tuple[str, str]:
    wx = lua_get_block(mission_text, 'weather')
    if not wx:
        return f"METAR XXXX {day:02d}0000Z 00000KT 9999 SKC 15/00 Q1013 NOSIG", "No data."

    ground   = lua_get_block(wx, 'atGround')
    clouds   = lua_get_block(wx, 'clouds')
    vis_blk  = lua_get_block(wx, 'visibility')
    fog_blk  = lua_get_block(wx, 'fog')
    season   = lua_get_block(wx, 'season')

    wsp = lua_num(ground, 'speed')  if ground  else 0.0
    wdr = lua_num(ground, 'dir')    if ground  else 0.0
    tmp = lua_num(season, 'temperature') if season else 15.0
    cb  = lua_num(clouds, 'base')   if clouds  else 0.0
    cd  = lua_num(clouds, 'density') if clouds else 0.0
    vis = lua_num(vis_blk, 'distance') if vis_blk else 80000.0
    fog_vis = lua_num(fog_blk, 'visibility') if fog_blk else 0.0
    fog_on  = lua_bool(wx, 'enable_fog')
    dust_on = lua_bool(wx, 'enable_dust')
    qnh_hpa = round((lua_num(wx, 'qnh') or 760.0) * 1.33322)

    wkt   = round((wsp or 0) * 1.944)
    wdr_i = round(wdr or 0)
    t_i   = round(tmp or 15)

    wind_s = f"{wdr_i:03d}{wkt:02d}KT" if wkt else "00000KT"
    vis_s  = str(min(int(fog_vis), 9999)) if (fog_on and fog_vis) \
             else ("9999" if (vis or 0) >= 9999 else str(int(vis or 0)))

    cbfl = round((cb or 0) * 3.28084 / 100)
    if not cd or not cb or cd == 0 or cb == 0:
        cld_s = "SKC"
    elif cd <= 2:   cld_s = f"FEW{cbfl:03d}"
    elif cd <= 4:   cld_s = f"SCT{cbfl:03d}"
    elif cd <= 7:   cld_s = f"BKN{cbfl:03d}"
    else:           cld_s = f"OVC{cbfl:03d}"

    t_s   = f"{t_i:02d}" if t_i >= 0 else f"M{abs(t_i):02d}"
    metar = f"METAR XXXX {day:02d}0000Z {wind_s} {vis_s} {cld_s} {t_s}/00 Q{qnh_hpa} NOSIG"

    notes = []
    if cd and cb and cd > 0 and cb > 0:
        notes.append(f"Cloud base {int((cb or 0)*3.28)}ft {cld_s}.")
    if fog_on and fog_vis:
        notes.append(f"Fog visibility {int(fog_vis)}m.")
    if dust_on:
        notes.append("Dust/haze active.")
    if wkt > 15:
        notes.append(f"Surface winds {wdr_i:03d}/{wkt}kt.")
    if not notes:
        notes.append("Clear and unrestricted.")
    return metar, " ".join(notes)


# ─────────────────────────────────────────────────────────────────────────────
# build  —  parsed objects → output YAML dict
# ─────────────────────────────────────────────────────────────────────────────

def build_aim_points(group: Group, key: str) -> list[dict]:
    aim_pts: list[dict] = []
    seen: set[tuple[int,int]] = set()
    ln_n = rd_n = 1

    for u in group.units:
        if u.role not in ('launcher', 'radar'):
            continue
        pos = (round(u.x), round(u.y))
        if pos in seen:
            continue
        seen.add(pos)

        if u.role == 'launcher':
            aim_pts.append({"id": f"{key}-LN{ln_n}",
                            "name": f"Launcher {ln_n}",
                            "coords": dms(u.lat, u.lon)})
            ln_n += 1
        else:
            aim_pts.append({"id": f"{key}-RD{rd_n}",
                            "name": f"Radar {rd_n}",
                            "coords": dms(u.lat, u.lon)})
            rd_n += 1

    if not aim_pts:
        aim_pts.append({"id": f"{key}-1", "name": key,
                        "coords": dms(group.lat, group.lon)})
    return aim_pts


def build_targets(groups: list[Group]) -> dict:
    targets: dict = {}
    seq = 1

    for g in groups:
        # TGT-prefixed override
        m = re.match(r'TGT\s+(\S+)', g.name, re.IGNORECASE)
        if m:
            key = f"TGT-{seq}"; seq += 1
            targets[key] = {
                "name":       g.name,
                "type":       m.group(1).upper(),
                "coords":     dms(g.lat, g.lon),
                "aim_points": build_aim_points(g, key),
            }
            print(f"  TGT  {key}: {g.name}")
            continue

        sys = identify_system([u.type for u in g.units])
        if not sys:
            continue

        key = f"SAM-{seq}"; seq += 1
        aim_pts = build_aim_points(g, key)
        targets[key] = {
            "name":                f"{g.name} ({sys.name})",
            "type":                "SAM",
            "coords":              dms(g.lat, g.lon),
            "engagement_range_nm": sys.range_nm,
            "max_alt_ft":          sys.max_alt_ft,
            "aim_points":          aim_pts,
        }
        print(f"  {key}: {g.name} → {sys.name}  "
              f"[{len(aim_pts)} aim pts]  {dms(g.lat, g.lon)}")

    return targets


def _rect_boundary(cx: float, cy: float,
                   width_m: float, height_m: float,
                   angle_deg: float, theatre: str) -> list[str]:
    """
    Return 4 corner DMS strings for a DCS rect drawing.

    DCS rect axes:
      width  → local x-axis (east in unrotated map space)
      height → local y-axis (north in unrotated map space)
      angle  → CCW rotation in degrees

    DCS world axes:  x = north (metres),  y = east (metres)
    After rotation, local-x maps to DCS y (east), local-y maps to DCS x (north).
    """
    a = math.radians(-angle_deg)
    cos_a, sin_a = math.cos(a), math.sin(a)
    hw, hh = width_m / 2, height_m / 2

    # Corners in local (unrotated) space: (local_x, local_y)
    corners = [(hw, hh), (-hw, hh), (-hw, -hh), (hw, -hh)]
    result = []
    for lx, ly in corners:
        rx = lx * cos_a - ly * sin_a   # rotated local-x → DCS east
        ry = lx * sin_a + ly * cos_a   # rotated local-y → DCS north
        lat, lon = dcs_to_latlon(cx + ry, cy + rx, theatre)
        result.append(dms(lat, lon))
    return result


def build_acms(drawings: list[Drawing], theatre: str) -> list[dict]:
    acms: list[dict] = []
    n = 1

    for d in drawings:
        olat, olon = dcs_to_latlon(d.origin_x, d.origin_y, theatre)
        acm: dict = {
            "id":        f"ACM-{n:03d}",
            "name":      d.name,
            "alt_lower": "SFC",
            "alt_upper": "FL999",
        }

        if d.polygon_mode == 'circle':
            if d.radius_m is None:
                continue
            acm["type"]     = "ROZ"
            acm["geometry"] = {
                "center":    dms(olat, olon),
                "radius_nm": round(d.radius_m / 1852.0, 1),
            }

        elif d.polygon_mode == 'rect':
            if d.width_m is None or d.height_m is None:
                continue
            # Compute 4 corners from center + width/height + CCW rotation.
            # DCS convention: width = local x-axis (east), height = local y-axis (north).
            # Rotation is CCW in degrees.  DCS coord axes: x=north, y=east.
            boundary = _rect_boundary(
                d.origin_x, d.origin_y,
                d.width_m, d.height_m,
                d.angle_deg or 0.0,
                theatre,
            )
            acm["type"]     = "ORBIT"
            acm["geometry"] = {"boundary": boundary}

        elif d.polygon_mode == 'free':
            boundary = []
            for rel_x, rel_y in d.rel_points:
                lat, lon = dcs_to_latlon(d.origin_x + rel_x,
                                         d.origin_y + rel_y, theatre)
                boundary.append(dms(lat, lon))
            acm["type"]     = "ROZ"
            acm["geometry"] = {"boundary": boundary}

        acms.append(acm)
        print(f"  ACM-{n:03d}: {d.name}  ({d.polygon_mode})")
        n += 1

    return acms


# Loadout encoding ──────────────────────────────────────────────────────────

_WEAPON_CAT: dict[str, tuple[str, str | None]] = {
    # ── Air-to-Air ───────────────────────────────────────────────────────────
    "AIM-120C": ("fox3", None), "AIM-120C-7": ("fox3", None),
    "AIM-120B": ("fox3", None), "AIM-120":    ("fox3", None),
    "AIM-7M":   ("fox1", None), "AIM-7F":     ("fox1", None),
    "AIM-9M":   ("fox2", None), "AIM-9X":     ("fox2", None),
    "AIM-9X-2": ("fox2", None), "AIM-9L":     ("fox2", None),
    # ── AGM SEAD ─────────────────────────────────────────────────────────────
    "AGM-88C HARM": ("agm", "88"), "AGM-88B HARM": ("agm", "88"),
    "AGM-88 HARM":  ("agm", "88"),
    # ── AGM Maverick ─────────────────────────────────────────────────────────
    "AGM-65D": ("agm", "65"), "AGM-65E": ("agm", "65"), "AGM-65F": ("agm", "65"),
    "AGM-65G": ("agm", "65"), "AGM-65H": ("agm", "65"), "AGM-65K": ("agm", "65"),
    "AGM-65L": ("agm", "65"), "AGM-65R": ("agm", "65"),
    # ── AGM Stand-off ────────────────────────────────────────────────────────
    "AGM-154A JSOW": ("agm", "154"), "AGM-154C JSOW": ("agm", "154"),
    "AGM-158 JASSM": ("agm", "158"),
    # ── GBU Paveway ──────────────────────────────────────────────────────────
    "GBU-10": ("agm", "10"), "GBU-12": ("agm", "12"),
    "GBU-16": ("agm", "16"), "GBU-24": ("agm", "24"),
    "GBU-27": ("agm", "27"), "GBU-28": ("agm", "28"),
    # ── GBU JDAM ─────────────────────────────────────────────────────────────
    "GBU-31": ("agm", "31"), "GBU-32": ("agm", "32"),
    "GBU-38": ("agm", "38"), "GBU-39": ("agm", "39"),
    "GBU-54": ("agm", "54"),
    # ── Unguided ─────────────────────────────────────────────────────────────
    "Mk-82": ("agm", "82"), "Mk-83": ("agm", "83"), "Mk-84": ("agm", "84"),
    # ── CBU ──────────────────────────────────────────────────────────────────
    "CBU-87": ("agm", "87"), "CBU-97": ("agm", "97"),
    "CBU-103": ("agm", "103"), "CBU-105": ("agm", "105"),
}

# Tasks that have a gun
_GUN_TASKS = {"CAP", "CAS", "SEAD", "STRIKE", "ESCORT", "INTERCEPT", "FAC(A)"}


def encode_loadout(condensed: list[str], task: str) -> str:
    """Convert condensed weapon list to the compact AAA+NXccc loadout code."""
    fox3 = fox1 = fox2 = 0
    agm_groups: dict[str, int] = {}

    for entry in condensed:
        m = re.match(r'^(\d+)[×x]\s+(.+)$', entry)
        count, name = (int(m.group(1)), m.group(2)) if m else (1, entry)
        info = _WEAPON_CAT.get(name)
        if not info:
            continue
        cat, code = info
        if   cat == "fox3": fox3 += count
        elif cat == "fox1": fox1 += count
        elif cat == "fox2": fox2 += count
        elif cat == "agm" and code:
            agm_groups[code] = agm_groups.get(code, 0) + count

    aa  = f"{min(fox3,9)}{min(fox1,9)}{min(fox2,9)}"
    gun = "+" if (task in _GUN_TASKS and (fox3 or fox2 or agm_groups)) else ""
    agm = "".join(f"{n}X{c}" for c, n in agm_groups.items())
    return aa + gun + agm


# ─────────────────────────────────────────────────────────────────────────────
# Syria airfield ID → ICAO / name lookup
# ─────────────────────────────────────────────────────────────────────────────
AIRDROME_IDS: dict[int, dict] = {
    2:  {"icao": "OSAP", "name": "Aleppo International"},
    4:  {"icao": "OS78", "name": "Bassel Al-Assad International"},
    8:  {"icao": "OSDZ", "name": "Deir ez-Zor"},
    11: {"icao": "OSDI", "name": "Damascus International"},
    12: {"icao": "OSGH", "name": "Abu ad-Duhur"},
    13: {"icao": "OSLK", "name": "Khalkhalah"},
    14: {"icao": "OLBA", "name": "Beirut-Rafic Hariri International"},
    15: {"icao": "OLLB", "name": "Rayak"},
    16: {"icao": "LTAG", "name": "Incirlik AB"},
    17: {"icao": "LTAS", "name": "Adana Sakirpasa"},
    20: {"icao": "OSPR", "name": "Palmyra"},
    21: {"icao": "OSRK", "name": "Raqqa"},
    22: {"icao": "OSTR", "name": "Tabqa"},
    24: {"icao": "OSHMH","name": "Hama"},
    25: {"icao": "OSHM", "name": "Marj Ruhayyil"},
    27: {"icao": "OSHR", "name": "Jirah"},
    29: {"icao": "OSKL", "name": "Kuweires"},
    34: {"icao": "OSHL", "name": "Hatay"},
    35: {"icao": "LTAF", "name": "Adiyaman"},
    36: {"icao": "LTAT", "name": "Gaziantep"},
    40: {"icao": "OSQM", "name": "Qamishli"},
    # Persian Gulf
    100: {"icao": "OMAM", "name": "Al Dhafra AB"},
    104: {"icao": "OMDM", "name": "Al Minhad AB"},
    105: {"icao": "OMDB", "name": "Dubai International"},
    109: {"icao": "OMFJ", "name": "Fujairah International"},
    113: {"icao": "OIKB", "name": "Bandar Abbas International"},
    # Caucasus
    200: {"icao": "UG24", "name": "Batumi"},
    201: {"icao": "UGKO", "name": "Kutaisi"},
    203: {"icao": "URSS", "name": "Sochi"},
}

CVN_NAMES: dict[str, str] = {
    "CVN_71": "USS THEODORE ROOSEVELT",
    "CVN_72": "USS ABRAHAM LINCOLN",
    "CVN_73": "USS GEORGE WASHINGTON",
    "CVN_74": "USS JOHN C. STENNIS",
    "CVN_75": "USS HARRY S. TRUMAN",
    "CVN_76": "USS RONALD REAGAN",
    "CVN_77": "USS GEORGE H.W. BUSH",
    "LHA_Tarawa": "USS TARAWA",
    "Kuznetsov":  "ADMIRAL KUZNETSOV",
}

_NM_TO_M = 1852.0
_FT_TO_M = 0.3048


def _nm_between(x1: float, y1: float, x2: float, y2: float) -> float:
    """Approximate distance in NM between two DCS world-coords points."""
    dx, dy = x2 - x1, y2 - y1
    return math.sqrt(dx*dx + dy*dy) / _NM_TO_M


def build_airfields_registry(flights: list[Flight], carriers: list[Carrier],
                             theatre: str) -> dict[str, dict]:
    """
    Collect unique airfields from flight takeoff waypoints.
    Returns a mapping of ICAO → {name, coords}.
    Takeoffs from carriers are excluded (handled by the carriers block).
    """
    carrier_unit_ids = {c.unit_id for c in carriers}
    seen: dict[str, dict] = {}     # icao → entry

    for f in flights:
        for wp in f.waypoints:
            if wp.typ not in ('TakeOffParking', 'TakeOff', 'TakeOffParkingHot',
                               'TakeOffGround'):
                continue
            # Carrier takeoff — skip
            if wp.link_unit_id and wp.link_unit_id in carrier_unit_ids:
                continue
            if wp.airdrome_id is None:
                continue
            info = AIRDROME_IDS.get(wp.airdrome_id)
            if not info:
                # Unknown ID — generate a placeholder
                icao = f"AF{wp.airdrome_id}"
                info = {"icao": icao, "name": f"Airfield {wp.airdrome_id}"}
            icao = info["icao"]
            if icao not in seen:
                seen[icao] = {
                    "name":   info["name"],
                    "coords": dms(wp.lat, wp.lon),
                }
    return seen


def _shared_waypoint_key(wp: Waypoint, all_flights: list[Flight],
                         targets: dict) -> str | None:
    """
    If this waypoint is within 100ft (~30m) of another flight's waypoint
    (and has no name or the same name), return a shared name_ref.
    If it's within 500m of a target, return that target id.
    Always None for the takeoff and last-landing waypoints.
    """
    # 100ft in metres
    MERGE_M = 100 * _FT_TO_M      # ~30m
    TARGET_MERGE_M = 500           # 500m tolerance for aim-point proximity

    # Check proximity to targets
    for tgt_id, tgt in targets.items():
        aim_pts = tgt.get("aim_points", [])
        for ap in aim_pts:
            pass  # aim points already resolved to registry; skip — handled separately

    return None


def _classify_waypoints(flight: Flight,
                        all_flights: list[Flight],
                        targets: dict,
                        carriers: list[Carrier],
                        ref_pts: dict) -> list[dict]:
    """
    Convert a flight's Waypoint list to the steer_points schema list.

    Rules:
    - Index 0  (TakeOff): skip — captured as deploy_location_icao
    - Last wp  (landing/recovery): skip — captured as aar_location_icao
    - Name starts with "MARSHALL ": → marshal point in ref_pts (name_ref)
    - Within 30m of another flight's non-takeoff waypoint with same/no name:
        → same logical point; use shared name
    - Within 500m of a SAM aim-point: label as aim-point steer
    - Otherwise: plain steer point with coords
    """
    MERGE_M   = 100 * _FT_TO_M   # 100 ft in metres
    TARGET_M  = 500               # 500 m

    wpts = flight.waypoints
    if len(wpts) <= 2:
        return []

    # Inner waypoints: skip first (takeoff) and last (recovery/landing)
    inner = wpts[1:-1]

    # Build index of all OTHER flights' inner waypoints for proximity matching
    others: list[Waypoint] = []
    for other in all_flights:
        if other.id == flight.id:
            continue
        if len(other.waypoints) > 2:
            others.extend(other.waypoints[1:-1])

    # Build flat DMS → aim_point_id index across all targets.
    # Key is the DMS string; value is the specific aim_point id (e.g. "SAM-14-RD1").
    aim_by_dms: dict[str, str] = {}
    for tgt in targets.values():
        for ap in tgt.get("aim_points", []):
            ap_dms = ap.get("coords", "")
            ap_id  = ap.get("id", "")
            if ap_dms and ap_id:
                aim_by_dms[ap_dms] = ap_id

    result = []
    for wp in inner:
        wp_dms = dms(wp.lat, wp.lon)

        # Marshal point: name starts with "MARSHALL "
        if wp.name and wp.name.upper().startswith("MARSHALL "):
            marshal_name = wp.name.strip()
            if marshal_name not in ref_pts:
                ref_pts[marshal_name] = {
                    "name":   marshal_name,
                    "type":   "marshal",
                    "coords": wp_dms,
                }
            result.append({"name_ref": marshal_name, "name": marshal_name})
            continue

        # Proximity check against other flights' waypoints (shared logical point)
        shared_name = None
        for ow in others:
            dist = math.sqrt((wp.x - ow.x)**2 + (wp.y - ow.y)**2)
            if dist <= MERGE_M:
                wp_n = (wp.name or "").strip()
                ow_n = (ow.name or "").strip()
                if wp_n == ow_n or not wp_n or not ow_n:
                    shared_name = wp_n or ow_n or None
                    break

        # Aim-point match — use the specific aim_point id (e.g. "SAM-14-RD1")
        aim_point_id = aim_by_dms.get(wp_dms)

        entry: dict = {"coords": wp_dms}
        if wp.name:
            entry["name"] = wp.name
        if aim_point_id:
            entry["aim_point_id"] = aim_point_id   # specific aim point id per spec
        if shared_name is not None:
            entry["shared"] = True

        result.append(entry)

    return result


def _carrier_for_pos(x: float, y: float, carriers: list[Carrier]) -> 'Carrier | None':
    """Return the nearest carrier if within 100ft (~30.5m), else None."""
    PROX_M = 100 * _FT_TO_M   # 100 ft
    for c in carriers:
        # Parse DMS coords back to approximate metres for comparison.
        # Simpler: store raw DCS x,y on Carrier instead. For now we use a
        # generous threshold since carrier coords are in DMS and we have x,y here.
        # We store raw x,y in Carrier._x/_y via the route waypoints.
        if hasattr(c, '_x') and hasattr(c, '_y'):
            dist = math.sqrt((x - c._x)**2 + (y - c._y)**2)
            if dist <= PROX_M:
                return c
    return None


def _home_base(flight: Flight, airfields: dict[str, dict],
               carriers: list[Carrier]) -> tuple[str | None, str | None]:
    """
    Return (deploy_id, recovery_id) from first and last waypoints.
    Carrier detection uses two methods:
      1. linkUnit id matching the carrier unit id (DCS native)
      2. Proximity: takeoff within 100ft of carrier deploy position
    Recovery defaults to the same carrier/airfield as deploy.
    """
    carrier_unit_ids = {c.unit_id: c.id for c in carriers}
    # Build carrier proximity lookup by raw DCS x,y (stored as _x, _y)
    carrier_by_id = {c.id: c for c in carriers}

    def _resolve_carrier_from_wp(wp: Waypoint) -> str | None:
        # Method 1: explicit linkUnit
        if wp.link_unit_id and wp.link_unit_id in carrier_unit_ids:
            return carrier_unit_ids[wp.link_unit_id]
        # Method 2: proximity to carrier position (100ft)
        PROX_M = 100 * _FT_TO_M
        for c in carriers:
            if hasattr(c, '_x'):
                dist = math.sqrt((wp.x - c._x)**2 + (wp.y - c._y)**2)
                if dist <= PROX_M:
                    return c.id
        return None

    deploy = None
    if flight.waypoints:
        first = flight.waypoints[0]
        carrier_id = _resolve_carrier_from_wp(first)
        if carrier_id:
            deploy = carrier_id
        elif first.airdrome_id is not None:
            info = AIRDROME_IDS.get(first.airdrome_id)
            deploy = info["icao"] if info else f"AF{first.airdrome_id}"

    recovery = None
    if flight.waypoints:
        last = flight.waypoints[-1]
        n = (last.name or "").upper()
        carrier_id = _resolve_carrier_from_wp(last)
        if carrier_id:
            recovery = carrier_id
        elif "CVN" in n or "RECOVERY" in n or "CARRIER" in n:
            # Named recovery waypoint — match carrier id or name in label
            for c in carriers:
                if c.id in n or CVN_NAMES.get(c.type, "")[:6].upper() in n:
                    recovery = c.id
                    break
            if not recovery:
                recovery = carriers[0].id if carriers else None
        elif last.airdrome_id is not None:
            info = AIRDROME_IDS.get(last.airdrome_id)
            recovery = info["icao"] if info else f"AF{last.airdrome_id}"

    # If deploying from a carrier and no explicit recovery found, recover there too
    if deploy and deploy.startswith("CVN-") and not recovery:
        recovery = deploy

    # Final fallback: return to deploy base
    if not recovery and deploy:
        recovery = deploy

    return deploy, recovery


def _build_mission_targets(steer_pts: list[dict], targets: dict,
                           task: str) -> list[dict] | None:
    """
    Derive the mission targets: list from steer_points that have aim_point_id.

    Groups aim points by parent target (SAM-14-RD1 → SAM-14), then emits one
    targets entry per unique target_id with its specific aim_point list.

    For CAP/orbit missions this produces tos/toffs timing fields;
    for SEAD/STRIKE/BAI it produces tot_net/tot_nlt fields (both left null —
    timing is filled in by the mission planner).

    Returns None for tankers and missions with no aim-point hits.
    """
    if not steer_pts:
        return None

    # Collect aim_point_ids grouped by parent target, preserving route order
    seen_tgt: dict[str, list[str]] = {}   # target_id → [ap_id, ...]
    for sp in steer_pts:
        ap_id = sp.get('aim_point_id')
        if not ap_id:
            continue
        tgt_id = ap_id.rsplit('-', 1)[0]
        if tgt_id not in seen_tgt:
            seen_tgt[tgt_id] = []
        if ap_id not in seen_tgt[tgt_id]:
            seen_tgt[tgt_id].append(ap_id)

    if not seen_tgt:
        return None

    is_orbit = task in ('CAP', 'CAS', 'ESCORT', 'TANKER', 'FAC(A)')
    result = []
    for tgt_id, ap_ids in seen_tgt.items():
        tgt_info = targets.get(tgt_id, {})
        # Strip the "(SA-type)" suffix from the group name for a clean location label
        raw_name = tgt_info.get('name') or tgt_id
        location = re.sub(r'\s*\([^)]+\)\s*$', '', raw_name).strip() or tgt_id
        entry: dict = {
            "location":  location,
            "target_id": tgt_id,
        }
        if is_orbit:
            entry["tos"]   = None
            entry["toffs"] = None
        else:
            entry["tot_net"] = None
            entry["tot_nlt"] = None
        # Only list aim_points explicitly if we hit a subset (not all aim points)
        all_ap_ids = [ap['id'] for ap in tgt_info.get('aim_points', [])]
        if ap_ids and ap_ids != all_ap_ids:
            entry["aim_points"] = [{"aim_point_id": a} for a in ap_ids]
        result.append(entry)

    return result or None


def build_missions(flights: list[Flight], msn_start: int, tanker_msn_start: int,
                   targets: dict, carriers: list[Carrier],
                   airfields: dict[str, dict], ref_pts: dict) -> list[dict]:
    """
    Produce the ato.missions list. Steer points are extracted and classified.
    Tankers receive a separate mission number from tanker_msn_start.
    """
    missions = []
    strike_i = tanker_i = 0

    for f in flights:
        if f.is_tanker:
            msn_num = f"MSN{tanker_msn_start + tanker_i}"
            tanker_i += 1
        else:
            msn_num = f"MSN{msn_start + strike_i}"
            strike_i += 1

        callsign = f.units[0].callsign if f.units else f.name
        ac_base  = f.aircraft_type.split('_')[0]
        ac_type  = re.sub(r'[^A-Z0-9]', '', ac_base.upper())
        count    = len(f.units)
        loadout_str = encode_loadout(
            f.units[0].loadout if f.units else [], f.task)

        deploy, recovery = _home_base(f, airfields, carriers)

        # Build steer points — also mutates ref_pts to add any marshal points
        steer_pts = _classify_waypoints(f, flights, targets, carriers, ref_pts)

        # Build targets list from aim_point hits in the route
        msn_targets = None if f.is_tanker else             _build_mission_targets(steer_pts, targets, f.task)

        # Human-readable weapon list (e.g. ['5× AIM-120C', 'AIM-9M']) from the
        # first unit — representative of the whole flight when all carry the same
        # loadout. Companion to the compact ATO 'loadout' code (e.g. '603+').
        first_unit_weapons = f.units[0].loadout or None if f.units else None

        msn: dict = {
            "mission_number":       msn_num,
            "callsign":             callsign,
            "mission_type":         f.task,
            "unit":                 None,
            "home_base_icao":       deploy,
            "deploy_location_icao": deploy,
            "aar_location_icao":    recovery,
            "takeoff_time":         None,
            "recovery_time":        None,
            "aircraft": {
                "count":   count,
                "type":    ac_type,
                "loadout": loadout_str,   # compact ATO code e.g. "603+"
                "weapons": first_unit_weapons,  # human-readable names
            },
            "targets":         msn_targets,
            "control":         {"agency_id": None},
            "refuel":          None,
            "steer_points":    steer_pts or None,
            "dtc_cartridge":   f.dtc_cartridge,
        }

        missions.append(msn)
    return missions


def build_carriers_registry(carriers: list[Carrier]) -> dict:
    result = {}
    for c in carriers:
        result[c.id] = {
            "name":            CVN_NAMES.get(c.type, c.type),
            "callsign":        c.name,
            "deploy_coords":   c.deploy_coords,
            "recovery_coords": c.recovery_coords,
        }
    return result


def build_carriers_ato(carriers: list[Carrier]) -> list[dict]:
    return [{"id": c.id} for c in carriers]


def build_callsigns_registry(flights: list[Flight]) -> dict | None:
    """Build a callsigns registry from the extracted flights."""
    result: dict = {}
    for f in flights:
        lead_callsign = f.units[0].callsign if f.units else f.name
        ac_base = f.aircraft_type.split('_')[0]
        ac_type = re.sub(r'[^A-Z0-9]', '', ac_base.upper())
        result[lead_callsign] = {
            "group":  f.name,
            "type":   ac_type,
            "role":   f.task + " flight lead" if not f.is_tanker else f.task,
        }
    return result or None


def build_flight_comms(flights: list[Flight], dtcs: dict[str, dict]) -> list[dict] | None:
    """
    Build per-flight comms list.  Each entry has the flight group name,
    lead callsign, DTC cartridge name, and UHF/VHF preset dicts.
    Flights without a DTC (no DTC assigned or cartridge not found) are skipped.
    """
    entries = []
    for f in flights:
        if not f.dtc_cartridge:
            continue
        if f.dtc_cartridge not in dtcs:
            print(f"[!] Flight '{f.name}': DTC '{f.dtc_cartridge}' not found in archive — skipping comms")
            continue
        uhf, vhf = build_comms_from_dtc(dtcs[f.dtc_cartridge])
        lead_callsign = f.units[0].callsign if f.units else f.name
        entries.append({
            "group":         f.name,
            "callsign":      lead_callsign,
            "dtc_cartridge": f.dtc_cartridge,
            "uhf_presets":   uhf,
            "vhf_presets":   vhf,
        })
    return entries or None


def build_doc(*, mission_name, mission_date, theatre,
              year, month, targets, ref_pts, acms, metar, wx_notes,
              flights, carriers, dtcs=None, spins_sections=None) -> dict:

    import hashlib
    # Strike package MSN start — deterministic from filename
    msn_start = 1000 + int(hashlib.md5(mission_name.encode()).hexdigest()[:4], 16) % 8000
    # Supply/tanker package gets a separate block of numbers (+500)
    tanker_msn_start = msn_start + 500

    # Bullseye key references registry.reference_points
    bullseye_key = list(ref_pts.keys())[0] if ref_pts else None

    # Build airfields from flight takeoff waypoints (deduplicated)
    airfields = build_airfields_registry(flights, carriers, theatre)

    # Build missions — this also mutates ref_pts to add marshal points found in routes
    missions = build_missions(
        flights, msn_start, tanker_msn_start,
        targets, carriers, airfields, ref_pts) or None
    msn_numbers = [m["mission_number"] for m in missions] if missions else []

    # ATO airfields list — one entry per unique airfield referenced
    ato_airfields = [{"icao": icao, "role": "deploy"} for icao in airfields] or None

    # Per-flight comms from each flight's DTC cartridge
    flight_comms = build_flight_comms(flights, dtcs or {})

    return {
        "schema_version": "1.0",

        "header": {
            "operation":      mission_name.upper().replace("_", " "),
            "ato_date":       mission_date,
            "classification": "CLASSIFIED",
        },

        "registry": {
            "callsigns":        build_callsigns_registry(flights),
            "airfields":        airfields or None,
            "carriers":         build_carriers_registry(carriers) or None,
            "tankers":          None,
            "targets":          targets   or None,
            "reference_points": ref_pts   or None,
            "control_agencies": None,
        },

        "ato": {
            "irl_date":           mission_date,
            "irl_time_zulu":      None,
            "ingame_start_time":  None,
            "local_offset_hours": None,
            "ae_flags":           ["IRL", "INGAME"],
            "global_control": {
                "agency_id": None,
                "bullseye":  bullseye_key,
            },
            "airfields": ato_airfields,
            "carriers":  build_carriers_ato(carriers) or None,
            "missions":  missions,
        },

        "aco": {
            "id":                  f"ACO-{year}-{month:02d}",
            "timezone":            "UTC",
            "distributing_agency": "AUTO-EXTRACTED",
            "acms":                acms or None,
        },

        "spins": {
            "version":  "1.0",
            "sections": spins_sections,
        },

        # Comms are per-flight: each flight has its own DTC-derived preset table.
        # Flights without an assigned DTC cartridge are omitted.
        "comms": {
            "wing_lead": None,
            "flights":   flight_comms,
        },

        "weather": {
            "issued":     mission_date,
            "valid_from": "0000Z",
            "valid_to":   "2359Z",
            "metars":     [metar],
            "mission_wx": [{"mission_ref": msn, "notes": "No significant weather impact."}
                           for msn in msn_numbers] or None,
        },

        "_meta": {
            "source":      Path(mission_name).name,
            "theatre":     theatre,
            "targets":     len(targets),
            "acm_zones":   len(acms),
            "missions":    len([f for f in flights if not f.is_tanker]),
            "tankers":     len([f for f in flights if f.is_tanker]),
            "airfields":   len(airfields),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────

def extract(miz_path: str, coalition: str = "blue") -> dict:
    opposing = "red" if coalition == "blue" else "blue"

    with zipfile.ZipFile(miz_path) as z:
        mission_text = z.read("mission").decode("utf-8", errors="replace")
        theatre = z.read("theatre").decode().strip() \
                  if "theatre" in z.namelist() else "Syria"
        # Load all DTC files from the archive
        dtcs = load_dtc_files(z)

    if dtcs:
        print(f"[+] Found DTC files: {', '.join(sorted(dtcs))}")

    print(f"[+] Theatre={theatre}  coalition={coalition}  targets_from={opposing}")

    # Date
    dm = re.search(
        r'\["date"\].*?\["Year"\] = (\d+).*?\["Day"\] = (\d+).*?\["Month"\] = (\d+)',
        mission_text, re.DOTALL)
    year, day, month = (int(dm.group(1)), int(dm.group(2)), int(dm.group(3))) \
                       if dm else (2024, 1, 1)
    mission_date = f"{year}-{month:02d}-{day:02d}"

    # Coalition blocks
    coal_block = lua_get_block(mission_text, 'coalition')
    if not coal_block:
        raise ValueError("No coalition block found")
    opp_block = lua_get_block(coal_block, opposing)
    own_block = lua_get_block(coal_block, coalition)

    # Targets
    print(f"[+] Parsing {opposing} groups…")
    opp_groups = parse_groups(opp_block or '', theatre)
    print(f"    {len(opp_groups)} groups")
    targets = build_targets(opp_groups)
    print(f"[+] {len(targets)} targets")

    # Bullseye
    ref_pts: dict = {}
    if own_block:
        be = parse_bullseye(own_block, theatre)
        if be:
            ref_pts["BULLSEYE"] = {"name": "BULLSEYE", "type": "bullseye", "coords": be}
            print(f"[+] Bullseye: {be}")

    # Flights + carriers (own coalition)
    print(f"[+] Parsing {coalition} flights and carriers…")
    flights, carriers = parse_flights_and_carriers(own_block or '', theatre)
    print(f"    {len(flights)} flights  |  {len(carriers)} carriers")
    for f in flights:
        dtc_label = f"  dtc={f.dtc_cartridge}" if f.dtc_cartridge else ""
        print(f"  {f.id}: {f.name!r}  task={f.task}  ac={f.aircraft_type}  "
              f"x{len(f.units)}  freq={f.freq_mhz}{dtc_label}")
    for c in carriers:
        print(f"  {c.id}: {c.type}  {c.name}  {c.deploy_coords}")

    # Summarise DTC comms coverage
    flights_with_dtc = [f for f in flights if f.dtc_cartridge and f.dtc_cartridge in dtcs]
    if flights_with_dtc:
        print(f"[+] DTC comms available for {len(flights_with_dtc)} flights: "
              + ", ".join(f"'{f.name}'→{f.dtc_cartridge}" for f in flights_with_dtc))
    elif dtcs:
        print(f"[!] No DTC cartridges matched to flights; available: {', '.join(sorted(dtcs))}")

    # ACO drawings
    print("[+] Parsing drawings…")
    drawings = parse_drawings(mission_text)
    acms = build_acms(drawings, theatre)
    print(f"[+] {len(acms)} ACMs")

    # Weather
    metar, wx_notes = parse_weather(mission_text, day)
    print(f"[+] {metar}")

    # SPINS — look for spins.md in the same directory as the .miz file
    spins_sections = None
    spins_path = Path(miz_path).parent / 'spins.md'
    if spins_path.exists():
        spins_text = spins_path.read_text(encoding='utf-8', errors='replace')
        spins_sections = parse_spins_md(spins_text)
        print(f"[+] Loaded SPINS from '{spins_path.name}': {len(spins_sections or [])} sections")
    else:
        print(f"[i] No spins.md found at '{spins_path}' — spins will be empty")

    return build_doc(
        mission_name=Path(miz_path).stem,
        mission_date=mission_date,
        theatre=theatre,
        year=year, month=month,
        targets=targets,
        ref_pts=ref_pts,
        acms=acms,
        metar=metar,
        wx_notes=wx_notes,
        flights=flights,
        carriers=carriers,
        dtcs=dtcs,
        spins_sections=spins_sections,
    )


def main():
    ap = argparse.ArgumentParser(description="DCS .miz → ATO brief YAML")
    ap.add_argument("miz")
    ap.add_argument("--coalition", "-c", default="blue", choices=["blue", "red"])
    ap.add_argument("--output",    "-o", default=None)
    args = ap.parse_args()

    out = args.output or (Path(args.miz).stem + ".yaml")
    doc = extract(args.miz, args.coalition)

    with open(out, "w") as f:
        yaml.dump(doc, f, allow_unicode=True, sort_keys=False,
                  default_flow_style=False, width=120)
    print(f"\n[OK] {out}")


if __name__ == "__main__":
    main()