"""weapons — CLSID lookup, loadout condensing, and ATO loadout encoding."""

from __future__ import annotations

import re


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
