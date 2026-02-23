#!/usr/bin/env python3
"""
miz_to_yaml.py — DCS .miz mission file -> ATO brief package YAML extractor

Usage:
    python3 miz_to_yaml.py <mission.miz> [--coalition blue|red] [--output out.yaml]

Coordinate conversion uses the exact Transverse Mercator projection constants
from pydcs (matching the Rust reference implementation in projections.rs).

Extracted data:
  registry.targets : major SAMs (SA-2/3/5/6/10/11/17, HAWK, PATRIOT) from the
                     opposing coalition.  Aim points = every launcher + radar unit
                     (support vehicles omitted).  TGT-prefixed groups also included.
  registry.reference_points : coalition bullseye
  aco.acms  : airspace zones from Common drawing layer (polygons / circles / rects)
  weather   : synthesised METAR from DCS weather parameters
  header    : mission name, date, theatre
"""

import argparse
import math
import re
import zipfile
from pathlib import Path

import yaml


# ---------------------------------------------------------------------------
# Transverse Mercator projection constants (from pydcs / projections.rs)
# ---------------------------------------------------------------------------

TM_PARAMS = {
    "PersianGulf":    dict(lon0=57,   fe=75756.0,      fn=-2894933.0,   k0=0.9996),
    "Falklands":      dict(lon0=-57,  fe=147640.0,     fn=5815417.0,    k0=0.9996),
    "Caucasus":       dict(lon0=33,   fe=-99517.0,     fn=-4998115.0,   k0=0.9996),
    "MarianaIslands": dict(lon0=147,  fe=238418.0,     fn=-1491840.0,   k0=0.9996),
    "Nevada":         dict(lon0=-117, fe=-193996.81,   fn=-4410028.064, k0=0.9996),
    "Normandy":       dict(lon0=-3,   fe=-195526.0,    fn=-5484813.0,   k0=0.9996),
    "Syria":          dict(lon0=39,   fe=282801.0,     fn=-3879866.0,   k0=0.9996),
    "SinaiMap":       dict(lon0=33,   fe=169222.0,     fn=-3325313.0,   k0=0.9996),
}

# WGS84 ellipsoid
_A   = 6378137.0
_F   = 1 / 298.257223563
_E2  = 2 * _F - _F ** 2
_EP2 = _E2 / (1 - _E2)


def dcs_to_wgs84(x_dcs: float, y_dcs: float, theatre: str) -> tuple:
    """
    Convert DCS Cartesian coords to WGS84 (lat_deg, lon_deg).

    DCS:  x = north axis (m),  y = east axis (m)
    TM:   easting = y_dcs,     northing = x_dcs
    """
    p  = TM_PARAMS.get(theatre, TM_PARAMS["Syria"])
    lon0 = math.radians(p["lon0"])
    fe, fn, k0 = p["fe"], p["fn"], p["k0"]

    E = y_dcs - fe   # TM easting
    N = x_dcs - fn   # TM northing

    e1  = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))
    M   = N / k0
    mu  = M / (_A * (1 - _E2/4 - 3*_E2**2/64 - 5*_E2**3/256))

    phi1 = (mu
            + (3*e1/2    - 27*e1**3/32)    * math.sin(2*mu)
            + (21*e1**2/16 - 55*e1**4/32) * math.sin(4*mu)
            + (151*e1**3/96)               * math.sin(6*mu)
            + (1097*e1**4/512)             * math.sin(8*mu))

    sp1 = math.sin(phi1)
    tp1 = math.tan(phi1)
    cp1 = math.cos(phi1)
    N1  = _A / math.sqrt(1 - _E2 * sp1**2)
    T1  = tp1**2
    C1  = _EP2 * cp1**2
    R1  = _A * (1 - _E2) / (1 - _E2 * sp1**2)**1.5
    D   = E / (N1 * k0)

    lat = phi1 - (N1 * tp1 / R1) * (
          D**2/2
        - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*_EP2)                          * D**4/24
        + (61 + 90*T1 + 298*C1 + 45*T1**2 - 252*_EP2 - 3*C1**2)          * D**6/720)

    lon = lon0 + (
          D
        - (1 + 2*T1 + C1)                                                 * D**3/6
        + (5 - 2*C1 + 28*T1 - 3*C1**2 + 8*_EP2 + 24*T1**2)               * D**5/120
    ) / cp1

    return math.degrees(lat), math.degrees(lon)


def wgs84_to_dms(lat: float, lon: float) -> str:
    """Format decimal lat/lon -> DMS string e.g. N36*10'48\" E037*13'40\"."""
    def fmt(deg, pos, neg):
        ch = pos if deg >= 0 else neg
        d  = abs(deg)
        dd = int(d)
        mm = int((d - dd) * 60)
        ss = round((d - dd - mm / 60) * 3600)
        if ss == 60: ss, mm = 0, mm + 1
        if mm == 60: mm, dd = 0, dd + 1
        return f"{ch}{dd:02d}\u00b0{mm:02d}'{ss:02d}\""
    return f"{fmt(lat,'N','S')} {fmt(lon,'E','W')}"


# ---------------------------------------------------------------------------
# SAM system definitions  — only MAJOR systems kept as targets
# ---------------------------------------------------------------------------

# Each entry:
#   (display_name,
#    detect_substrings,   <- any unit type matching these flags this as the system
#    range_nm, max_alt_ft,
#    launcher_substrings, <- unit types that are aim-point worthy launchers
#    radar_substrings)    <- unit types that are aim-point worthy radars
SAM_SYSTEMS = [
    ("SA-5 Gammon / S-200",
     ["S-200_Launcher", "RPC_5N62V", "RLS_19J6"],
     100, 80000,
     ["S-200_Launcher"],
     ["RPC_5N62V", "RLS_19J6"]),

    ("SA-10 Grumble / S-300",
     ["5P85", "5N63", "64N6E", "30N6"],
     60, 90000,
     ["5P85"],
     ["5N63", "64N6E", "30N6"]),

    ("SA-17 Grizzly / Buk-M2",
     ["9A317", "9S36"],
     20, 50000,
     ["9A317"],
     ["9S36"]),

    ("SA-11 Gadfly / Buk-M1",
     ["9A310M1", "9S18M1"],
     16, 46000,
     ["9A310M1"],
     ["9S18M1"]),

    ("PATRIOT",
     ["Patriot ln", "Patriot str", "Patriot EPP"],
     60, 80000,
     ["Patriot ln"],
     ["Patriot str", "Patriot EPP"]),

    ("HAWK",
     ["Hawk ln", "Hawk tr", "Hawk sr", "Hawk cwar", "Hawk pcp"],
     25, 45000,
     ["Hawk ln"],
     ["Hawk tr", "Hawk sr", "Hawk cwar", "Hawk pcp"]),

    ("SA-2 Guideline / S-75",
     ["SNR_75V", "S_75M_Volhov"],
     28, 60000,
     ["S_75M_Volhov"],
     ["SNR_75V"]),

    ("SA-3 Neva / S-125",
     ["snr s-125", "5p73 s-125", "p-19 s-125"],
     15, 45000,
     ["5p73 s-125"],
     ["snr s-125", "p-19 s-125"]),

    ("SA-6 Gainful / Kub",
     ["Kub 1S91", "Kub 2P25"],
     15, 40000,
     ["Kub 2P25"],
     ["Kub 1S91"]),
]

# Explicitly excluded systems — SHORAD / MANPADS / AAA
EXCLUDED_DETECT = [
    "2S6", "Tunguska",              # SA-19 Grisom
    "Tor_", "TOR-M1", "HQ-7_LN",   # SA-15 Gauntlet
    "Osa_9A33", "Osa_9M33",        # SA-8 Gecko
    "Strela-1 m", "9P31",          # SA-9 Gaskin
    "9P35M2",                       # SA-13 Gopher
    "Igla", "Strela-2", "Mistral", # MANPADS
    "ZU-23", "ZSU-57", "ZSU-23-4",# AAA
]

# Support vehicle substrings — never become aim points
SUPPORT_SUBSTRINGS = [
    "ZIL-131", "ZiL-131", "GAZ-66", "Ural-375", "Ural-4320",
    "ATZ-10", "APA-80", "KUNG", "PBU", "Truck",
    "Turning Point",  # route waypoints sometimes leak in
]


def _match_any(ut: str, substrings: list) -> bool:
    ut_l = ut.lower()
    return any(s.lower() in ut_l for s in substrings)


def classify_unit(unit_type: str) -> str:
    """Return 'launcher', 'radar', 'support', or None."""
    if _match_any(unit_type, SUPPORT_SUBSTRINGS):
        return "support"
    for _, _, _, _, launchers, radars in SAM_SYSTEMS:
        if _match_any(unit_type, launchers):
            return "launcher"
        if _match_any(unit_type, radars):
            return "radar"
    return None


def identify_sam_system(unit_types: list) -> tuple | None:
    """
    Return (system_name, range_nm, max_alt_ft) for the highest-priority
    major system present in the group, or None.
    Groups that only contain excluded types are skipped.
    """
    # Check if the group contains ONLY excluded / support / unknown types
    has_major = any(
        _match_any(ut, subs)
        for ut in unit_types
        for _, subs, _, _, _, _ in SAM_SYSTEMS
    )
    if not has_major:
        return None

    # Return first (highest-priority) matching system
    for name, subs, rng, alt, _ln, _rd in SAM_SYSTEMS:
        if any(_match_any(ut, subs) for ut in unit_types):
            return name, rng, alt
    return None


# ---------------------------------------------------------------------------
# Lua / MIZ parsing
# ---------------------------------------------------------------------------

def load_miz(miz_path: str) -> tuple:
    with zipfile.ZipFile(miz_path, "r") as z:
        mission = z.read("mission").decode("utf-8", errors="replace")
        theatre = z.read("theatre").decode().strip() if "theatre" in z.namelist() else "Syria"
    return mission, theatre


def re_val(pattern: str, text: str, group: int = 1):
    m = re.search(pattern, text, re.DOTALL)
    return m.group(group) if m else None


def parse_units_in_block(unit_zone: str, theatre: str) -> list:
    """Parse individual unit records out of the units sub-block."""
    units = []
    ub_list = re.split(r'\[\d+\] = \n\s*\{', unit_zone)
    for ub in ub_list[1:]:
        ut = re_val(r'\["type"\] = "([^"]+)"', ub)
        ux = re_val(r'\["x"\] = ([0-9eE.+\-]+)', ub)
        uy = re_val(r'\["y"\] = ([0-9eE.+\-]+)', ub)
        un = re_val(r'\["name"\] = "([^"]+)"', ub)
        if ut and ux and uy:
            ux, uy = float(ux), float(uy)
            ulat, ulon = dcs_to_wgs84(ux, uy, theatre)
            units.append({
                "type": ut,
                "name": un or "",
                "x": ux, "y": uy,
                "lat": ulat, "lon": ulon,
                "role": classify_unit(ut),
            })
    return units


def parse_groups_in_section(section: str, theatre: str) -> list:
    """
    Parse every ground group from a coalition Lua section.
    Returns list of dicts: {name, x, y, lat, lon, units:[...]}
    """
    groups = []
    blocks = re.split(r'(?=\["groupId"\])', section)

    for block in blocks[1:]:
        if not re_val(r'\["groupId"\] = (\d+)', block):
            continue

        # Units sub-block
        units_end = block.find('}, -- end of ["units"]')
        unit_zone = block[:units_end] if units_end > 0 else block[:5000]
        parsed_units = parse_units_in_block(unit_zone, theatre)

        # Group name + position (after units close)
        after = block[units_end:] if units_end > 0 else block
        gname = re_val(r'\["name"\] = "([^"]+)"', after) or \
                re_val(r'\["name"\] = "([^"]+)"', block)
        if not gname or re.search(r'-\d+-\d+$', gname):
            continue   # skip unit-level name patterns

        gx = re_val(r'\["x"\] = ([0-9eE.+\-]+)', after) or \
             re_val(r'\["x"\] = ([0-9eE.+\-]+)', block)
        gy = re_val(r'\["y"\] = ([0-9eE.+\-]+)', after) or \
             re_val(r'\["y"\] = ([0-9eE.+\-]+)', block)
        if not gx or not gy:
            continue

        gx, gy = float(gx), float(gy)
        glat, glon = dcs_to_wgs84(gx, gy, theatre)
        groups.append({"name": gname, "x": gx, "y": gy,
                       "lat": glat, "lon": glon, "units": parsed_units})
    return groups


def build_aim_points(group: dict, key: str) -> list:
    """
    Build aim-point list from launcher and radar units.
    Support and unclassified units are skipped.
    Deduplicates by rounded position.
    """
    aim_pts   = []
    ln_n, rd_n = 1, 1
    seen = set()

    for u in group["units"]:
        role = u["role"]
        if role not in ("launcher", "radar"):
            continue
        pos = (round(u["x"]), round(u["y"]))
        if pos in seen:
            continue
        seen.add(pos)

        if role == "launcher":
            ap_id   = f"{key}-LN{ln_n}"
            ap_name = f"Launcher {ln_n}"
            ln_n   += 1
        else:
            ap_id   = f"{key}-RD{rd_n}"
            ap_name = f"Radar {rd_n}"
            rd_n   += 1

        aim_pts.append({
            "id":     ap_id,
            "name":   ap_name,
            "coords": wgs84_to_dms(u["lat"], u["lon"]),
        })

    # Fallback: group centroid
    if not aim_pts:
        aim_pts.append({
            "id":     f"{key}-1",
            "name":   key,
            "coords": wgs84_to_dms(group["lat"], group["lon"]),
        })
    return aim_pts


# ---------------------------------------------------------------------------
# ACO extraction from Common drawing layer
# ---------------------------------------------------------------------------

def parse_drawings_common(content: str, theatre: str) -> list:
    """Extract ACM entries from the Common drawings layer."""
    acms = []

    cs = content.find('["name"] = "Common"')
    if cs < 0:
        return acms
    os_ = content.find('["objects"] =', cs)
    oe  = content.find('}, -- end of ["objects"]', os_)
    if oe < 0:
        return acms
    objects_text = content[os_:oe]

    obj_blocks = re.split(r'\[\d+\] = \n\s*\{', objects_text)
    n = 1

    for block in obj_blocks[1:]:
        ptype = re_val(r'\["primitiveType"\] = "([^"]+)"', block)
        name  = re_val(r'\["name"\] = "([^"]+)"', block)
        if not ptype or not name or ptype == "TextBox":
            continue

        mx = re_val(r'\["mapX"\] = ([0-9eE.+\-]+)', block)
        my = re_val(r'\["mapY"\] = ([0-9eE.+\-]+)', block)
        if not mx or not my:
            continue
        ox, oy = float(mx), float(my)
        olat, olon = dcs_to_wgs84(ox, oy, theatre)

        pmode = re_val(r'\["polygonMode"\] = "([^"]+)"', block) or "free"
        acm   = {"id": f"ACM-{n:03d}", "name": name,
                 "alt_lower": "SFC", "alt_upper": "FL999"}

        if pmode == "circle":
            r = re_val(r'\["radius"\] = ([0-9eE.+\-]+)', block)
            if r:
                acm["type"]     = "ROZ"
                acm["geometry"] = {"center":    wgs84_to_dms(olat, olon),
                                   "radius_nm": round(float(r) / 1852.0, 1)}

        elif pmode == "rect":
            w   = re_val(r'\["width"\] = ([0-9eE.+\-]+)', block)
            h   = re_val(r'\["height"\] = ([0-9eE.+\-]+)', block)
            ang = re_val(r'\["angle"\] = ([0-9eE.+\-]+)', block)
            if w and h:
                acm["type"]     = "ORBIT"
                acm["geometry"] = {
                    "center":    wgs84_to_dms(olat, olon),
                    "width_nm":  round(float(w) / 1852.0, 1),
                    "height_nm": round(float(h) / 1852.0, 1),
                }
                if ang:
                    acm["geometry"]["angle_deg"] = round(float(ang), 1)

        else:  # free polygon — build boundary from relative points
            pts_m = re.search(
                r'\["points"\] = \{(.*?)\}, -- end of \["points"\]', block, re.DOTALL)
            if pts_m:
                boundary = []
                for pb in re.split(r'\[\d+\] = \n\s*\{', pts_m.group(1))[1:]:
                    py = re_val(r'\["y"\] = ([0-9eE.+\-]+)', pb)
                    px = re_val(r'\["x"\] = ([0-9eE.+\-]+)', pb)
                    if py and px:
                        rx, ry = float(px), float(py)
                        if abs(rx) < 1 and abs(ry) < 1:
                            continue   # skip degenerate zero points
                        plat, plon = dcs_to_wgs84(ox + rx, oy + ry, theatre)
                        boundary.append(wgs84_to_dms(plat, plon))
                if len(boundary) >= 3:
                    acm["type"]     = "ROZ"
                    acm["geometry"] = {"boundary": boundary}

        if "geometry" in acm:
            acms.append(acm)
            n += 1

    return acms


# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------

def parse_weather(content: str, day: int) -> tuple:
    """Return (metar_string, notes_string)."""
    ws_m = re.search(r'\["weather"\] = \{(.*?)\}, -- end of \["weather"\]',
                     content, re.DOTALL)
    if not ws_m:
        return f"METAR XXXX {day:02d}0000Z 00000KT 9999 SKC 15/00 Q1013 NOSIG", "No weather data."
    ws = ws_m.group(1)

    wsp = float(re_val(r'\["atGround"\].*?\["speed"\] = ([0-9.]+)', ws) or 0)
    wdr = int(re_val(r'\["atGround"\].*?\["dir"\] = (\d+)', ws) or 0)
    tmp = float(re_val(r'\["temperature"\] = ([0-9.\-]+)', ws) or 15)
    qnh = round(float(re_val(r'\["qnh"\] = ([0-9.]+)', ws) or 760) * 1.33322)
    cb  = int(re_val(r'\["base"\] = (\d+)', ws) or 0)
    cd  = int(re_val(r'\["density"\] = (\d+)', ws) or 0)
    vis = int(re_val(r'\["distance"\] = (\d+)', ws) or 80000)
    fog_en  = "true" in (re_val(r'\["enable_fog"\] = (\w+)', ws) or "false")
    fog_vis = int(re_val(r'\["fog"\].*?\["visibility"\] = (\d+)', ws) or 0)
    dust_en = "true" in (re_val(r'\["enable_dust"\] = (\w+)', ws) or "false")

    wkt = round(wsp * 1.944)
    wstr = f"{wdr:03d}{wkt:02d}KT" if wkt else "00000KT"

    vis_str = str(min(fog_vis, 9999)) if (fog_en and fog_vis) else ("9999" if vis >= 9999 else str(vis))

    cbfl = round(cb * 3.28084 / 100)
    if cd == 0 or cb == 0:
        cld = "SKC"
    elif cd <= 2: cld = f"FEW{cbfl:03d}"
    elif cd <= 4: cld = f"SCT{cbfl:03d}"
    elif cd <= 7: cld = f"BKN{cbfl:03d}"
    else:         cld = f"OVC{cbfl:03d}"

    t_int = round(tmp)
    t_str = f"{t_int:02d}" if t_int >= 0 else f"M{abs(t_int):02d}"

    metar = f"METAR XXXX {day:02d}0000Z {wstr} {vis_str} {cld} {t_str}/00 Q{qnh} NOSIG"

    notes = []
    if cd > 0 and cb > 0: notes.append(f"Cloud base {cb*3.28:.0f}ft {cld}.")
    if fog_en and fog_vis: notes.append(f"Fog, visibility {fog_vis}m.")
    if dust_en:            notes.append("Dust/haze active.")
    if wkt > 15:           notes.append(f"Surface winds {wdr:03d}/{wkt}kt.")
    if not notes:          notes.append("Clear and unrestricted.")
    return metar, " ".join(notes)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def extract(miz_path: str, coalition: str = "blue") -> dict:
    opposing = "red" if coalition == "blue" else "blue"

    print(f"[+] Loading {miz_path}")
    content, theatre = load_miz(miz_path)
    print(f"[+] Theatre: {theatre}  |  Perspective: {coalition}  |  Targets from: {opposing}")

    dm = re.search(r'\["date"\].*?\["Year"\] = (\d+).*?\["Day"\] = (\d+).*?\["Month"\] = (\d+)',
                   content, re.DOTALL)
    year, day, month = (int(dm.group(1)), int(dm.group(2)), int(dm.group(3))) if dm else (2024, 1, 1)
    mission_date = f"{year}-{month:02d}-{day:02d}"
    mission_name = Path(miz_path).stem

    # -- Opposing coalition groups -> targets --
    opp_idx = content.rfind(f'["{opposing}"] =')
    opp_end = len(content)
    for marker in [f'["{coalition}"] =', '}, -- end of ["coalition"]']:
        idx = content.find(marker, opp_idx + 200)
        if 0 < idx < opp_end:
            opp_end = idx
    opp_section = content[opp_idx:opp_end]

    all_groups = parse_groups_in_section(opp_section, theatre)
    print(f"[+] Found {len(all_groups)} groups in {opposing} coalition")

    targets = {}
    seq = 1

    for g in all_groups:
        name, ut_list = g["name"], [u["type"] for u in g["units"]]

        # TGT-prefixed groups
        tgt_m = re.match(r'TGT\s+(\S+)\s*(.*)', name, re.IGNORECASE)
        if tgt_m:
            key = f"TGT-{seq}"; seq += 1
            targets[key] = {
                "name":   name,
                "type":   tgt_m.group(1).upper(),
                "coords": wgs84_to_dms(g["lat"], g["lon"]),
                "aim_points": build_aim_points(g, key),
            }
            print(f"  TGT : {key} — {name}")
            continue

        # Major SAMs
        sam = identify_sam_system(ut_list)
        if not sam:
            continue

        sam_name, rng, alt = sam
        key = f"SAM-{seq}"; seq += 1
        aim_pts = build_aim_points(g, key)

        targets[key] = {
            "name":                 f"{name} ({sam_name})",
            "type":                 "SAM",
            "coords":               wgs84_to_dms(g["lat"], g["lon"]),
            "engagement_range_nm":  rng,
            "max_alt_ft":           alt,
            "aim_points":           aim_pts,
        }
        print(f"  {key}: {name} -> {sam_name}  [{len(aim_pts)} aim pts]  {wgs84_to_dms(g['lat'], g['lon'])}")

    print(f"[+] {len(targets)} targets extracted")

    # -- Bullseye --
    ci = content.rfind(f'["{coalition}"] =')
    be_m = re.search(r'\["bullseye"\].*?\["y"\] = ([0-9eE.+\-]+).*?\["x"\] = ([0-9eE.+\-]+)',
                     content[ci:ci+2000], re.DOTALL)
    ref_pts = {}
    if be_m:
        blat, blon = dcs_to_wgs84(float(be_m.group(2)), float(be_m.group(1)), theatre)
        ref_pts["BULLSEYE"] = {"name": "BULLSEYE", "type": "bullseye",
                               "coords": wgs84_to_dms(blat, blon)}
        print(f"[+] {coalition.upper()} bullseye: {ref_pts['BULLSEYE']['coords']}")

    # -- ACO --
    acms = parse_drawings_common(content, theatre)
    print(f"[+] {len(acms)} ACM zones from Common layer")
    for a in acms:
        print(f"  {a['id']}: {a['name']} ({a.get('type','?')})")

    # -- Weather --
    metar, wx_notes = parse_weather(content, day)

    # -- Assemble — emit every top-level key; missing data becomes null --
    doc = {
        "schema_version": "1.0",

        "header": {
            "operation":      mission_name.upper().replace("_", " "),
            "ato_date":       mission_date,
            "classification": "UNCLAS",
        },

        "registry": {
            "callsigns":        None,
            "frequencies":      None,
            "airfields":        None,
            "carriers":         None,
            "tankers":          None,
            "targets":          targets if targets else None,
            "reference_points": ref_pts if ref_pts else None,
            "control_agencies": None,
        },

        "ato": {
            "irl_date":           mission_date,
            "irl_time_zulu":      None,
            "ingame_start_time":  None,
            "local_offset_hours": None,
            "ae_flags":           None,
            "global_control": {
                "agency_id": None,
                "bullseye":  ref_pts["BULLSEYE"]["coords"] if "BULLSEYE" in ref_pts else None,
            },
            "airfields": None,
            "carriers":  None,
            "missions":  None,
        },

        "aco": {
            "id":                  f"ACO-{year}-{month:02d}",
            "timezone":            "UTC",
            "distributing_agency": "AUTO-EXTRACTED",
            "acms":                acms if acms else None,
        },

        "spins": {
            "version":  "1.0",
            "sections": None,
        },

        "comms": {
            "wing_lead":   None,
            "uhf_presets": None,
            "vhf_presets": None,
        },

        "weather": {
            "issued":     mission_date,
            "valid_from": "0000Z",
            "valid_to":   "2359Z",
            "metars":     [metar],
            "mission_wx": [{"mission_ref": "ALL", "notes": wx_notes}],
        },

        "_meta": {
            "source":    Path(miz_path).name,
            "theatre":   theatre,
            "coalition": coalition,
            "targets":   len(targets),
            "acm_zones": len(acms),
        },
    }

    return doc


def main():
    ap = argparse.ArgumentParser(description="DCS .miz -> ATO brief YAML extractor")
    ap.add_argument("miz",             help="Path to .miz file")
    ap.add_argument("--coalition", "-c", default="blue", choices=["blue","red"])
    ap.add_argument("--output",    "-o", default=None)
    args = ap.parse_args()

    out = args.output or (Path(args.miz).stem + ".yaml")
    doc = extract(args.miz, args.coalition)

    with open(out, "w") as f:
        yaml.dump(doc, f, allow_unicode=True, sort_keys=False,
                  default_flow_style=False, width=120)
    print(f"\n[OK] Written -> {out}")


if __name__ == "__main__":
    main()