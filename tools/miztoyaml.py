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
                angle_deg=lua_num(ob, 'angle'),
            ))

        elif pmode == 'free':
            pts_block = lua_get_block(ob, 'points')
            rel_points: list[tuple[float, float]] = []
            if pts_block:
                # Collect points sorted by their Lua index, skip zero padding
                raw: list[tuple[int, float, float]] = []
                for idx, pb in lua_iter_array(pts_block):
                    xy = lua_xy(pb)
                    if xy and not (abs(xy[0]) < 1 and abs(xy[1]) < 1):
                        raw.append((idx, xy[0], xy[1]))
                # Sort by index to preserve intended vertex order, deduplicate
                seen: set[tuple[float, float]] = set()
                for _idx, rx, ry in sorted(raw):
                    pt = (round(rx, 1), round(ry, 1))
                    if pt not in seen:
                        seen.add(pt)
                        rel_points.append((rx, ry))

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
            acm["type"]     = "ORBIT"
            acm["geometry"] = {
                "center":    dms(olat, olon),
                "width_nm":  round(d.width_m  / 1852.0, 1),
                "height_nm": round(d.height_m / 1852.0, 1),
            }
            if d.angle_deg is not None:
                acm["geometry"]["angle_deg"] = round(d.angle_deg, 1)

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


def build_doc(*, mission_name, mission_date, theatre,
              year, month, targets, ref_pts, acms, metar, wx_notes) -> dict:
    return {
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
            "targets":          targets  or None,
            "reference_points": ref_pts  or None,
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
                "bullseye":  ref_pts.get("BULLSEYE", {}).get("coords"),
            },
            "airfields": None,
            "carriers":  None,
            "missions":  None,
        },

        "aco": {
            "id":                  f"ACO-{year}-{month:02d}",
            "timezone":            "UTC",
            "distributing_agency": "AUTO-EXTRACTED",
            "acms":                acms or None,
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
            "source":    Path(mission_name).name,
            "theatre":   theatre,
            "targets":   len(targets),
            "acm_zones": len(acms),
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

    # ACO drawings
    print("[+] Parsing drawings…")
    drawings = parse_drawings(mission_text)
    acms = build_acms(drawings, theatre)
    print(f"[+] {len(acms)} ACMs")

    # Weather
    metar, wx_notes = parse_weather(mission_text, day)
    print(f"[+] {metar}")

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