"""weapons — CLSID lookup, loadout condensing, and ATO loadout encoding."""

from __future__ import annotations

import json
import re
import warnings
from pathlib import Path

# Load the comprehensive CLSID→name mapping from the data directory.
# Path: <repo_root>/data/weaponsdata.json (two levels up from tools/miztoyaml/)
_DATA_FILE = Path(__file__).parent.parent.parent / "data" / "weaponsdata.json"
try:
    with _DATA_FILE.open(encoding="utf-8") as _fh:
        _WEAPONSDATA: dict[str, str] = json.load(_fh)
except (OSError, json.JSONDecodeError) as _e:
    warnings.warn(f"weaponsdata.json could not be loaded ({_e}); CLSID resolution will be limited.", stacklevel=1)
    _WEAPONSDATA = {}


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
    "AWACS":        "AWACS",
}


def resolve_clsid(clsid: str) -> str:
    """Return a human-readable weapon name for a DCS CLSID string."""
    if clsid in _WEAPONSDATA:
        return _WEAPONSDATA[clsid]
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


# Weapon category table for ATO loadout encoding
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
