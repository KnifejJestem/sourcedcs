"""dtc — DCS Data Transfer Cartridge parsing + SPINS markdown parser."""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path


# ── DTC parsing ───────────────────────────────────────────────────────────────

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


def parse_dtc_nav_pts(content: bytes) -> list[dict]:
    """
    Parse NAV_PTS steerpoints from a DCS DTC JSON file.

    Supports two aircraft-specific layouts:
      - F-16: data.MPD.NAV_PTS  (each entry has a 'number' field)
      - F-18: data.WYPT.NAV_PTS (each entry has a 'wypt_num' field)

    Returns a list of nav point dicts, each containing:
      number (int), x (float), y (float), alt_m (float|None), note (str), type (str).

    Returns an empty list when NAV_PTS is absent (backwards compatible).
    """
    try:
        data = json.loads(content.decode('utf-8', errors='replace'))['data']
    except (json.JSONDecodeError, KeyError):
        return []
    # Try F-16 path first, then fall back to F-18 path
    nav_pts_raw = data.get('MPD', {}).get('NAV_PTS')
    if nav_pts_raw is None:
        nav_pts_raw = data.get('WYPT', {}).get('NAV_PTS', [])
    if not isinstance(nav_pts_raw, list):
        return []
    result = []
    for pt in nav_pts_raw:
        if not isinstance(pt, dict):
            continue
        x = pt.get('x')
        y = pt.get('y')
        if x is None or y is None:
            continue
        num_raw = pt.get('number') if pt.get('number') is not None else pt.get('wypt_num')
        result.append({
            'number': int(num_raw) if num_raw is not None else None,
            'x':      float(x),
            'y':      float(y),
            'alt_m':  float(pt['alt']) if pt.get('alt') is not None else None,
            'note':   pt.get('note', ''),
            'type':   pt.get('type', 'STPT'),
        })
    result.sort(key=lambda p: p.get('number') or 0)
    return result


def _line_point(pt: dict) -> dict:
    """Shared point shape for GEO_LINES / R-flagged reference-line entries."""
    return {
        'x':     float(pt['x']),
        'y':     float(pt['y']),
        'alt_m': float(pt['alt']) if pt.get('alt') is not None else None,
        'note':  pt.get('note', ''),
    }


def _parse_f16_routes(nav_pts: list) -> list[dict]:
    """
    Group F-16 MPD.NAV_PTS by R1-R3 flags into named routes.

    Each route's flown order is ascending 'number' within the group (F-16
    DTCs carry no separate ordering data for routes). Points with no Rn flag
    set are returned as a route=None group ('standalone' — not part of any
    named route, e.g. individual target-cue steerpoints).

    Route points use 'routeAltitude' (planned leg altitude) in preference to
    the static 'alt' (point/terrain elevation) when present, and carry
    'speed_kts' from the point's 'speed' field.
    """
    groups: dict[int | None, list[dict]] = {}
    for pt in nav_pts:
        if not isinstance(pt, dict) or pt.get('x') is None or pt.get('y') is None:
            continue
        rn = next((n for n in (1, 2, 3) if pt.get(f'R{n}')), None)
        alt = pt.get('routeAltitude') if rn is not None and pt.get('routeAltitude') is not None \
            else pt.get('alt')
        entry = {
            'number':    int(pt['number']) if pt.get('number') is not None else None,
            'x':         float(pt['x']),
            'y':         float(pt['y']),
            'alt_m':     float(alt) if alt is not None else None,
            'note':      pt.get('note', ''),
            'speed_kts': float(pt['speed']) if rn is not None and pt.get('speed') is not None else None,
        }
        groups.setdefault(rn, []).append(entry)

    result = []
    for rn in sorted(n for n in groups if n is not None):
        pts = sorted(groups[rn], key=lambda p: p['number'] or 0)
        result.append({'route': rn, 'points': pts})
    if None in groups:
        pts = sorted(groups[None], key=lambda p: p['number'] or 0)
        result.append({'route': None, 'points': pts})
    return result


def _parse_f18_routes(wypt: dict) -> list[dict]:
    """
    Build F-18 routes from WYPT.NAV_ROUTE, resolved against WYPT.NAV_PTS.

    Unlike F-16, the flown order is NOT ascending wypt_num — it is the
    insertion order of each NAV_ROUTE entry's STPT keys (DCS preserves this
    as JSON object order). Wypt_num references that don't resolve to a
    NAV_PTS entry are skipped (seen in the wild: stale/leftover route data
    referencing points that no longer exist in a customised DTC).

    Route points take 'alt'/'speed' from the NAV_ROUTE entry itself (planned
    leg altitude/speed), falling back to the NAV_PTS point's own 'alt'.
    Points never referenced by any route are returned as a route=None group.
    """
    nav_pts_raw = wypt.get('NAV_PTS')
    if not isinstance(nav_pts_raw, list):
        return []
    nav_by_num: dict[int, dict] = {}
    for p in nav_pts_raw:
        if isinstance(p, dict) and p.get('wypt_num') is not None \
                and p.get('x') is not None and p.get('y') is not None:
            nav_by_num[int(p['wypt_num'])] = p

    route_entries_raw = wypt.get('NAV_ROUTE')
    groups: list[tuple[int, list[dict]]] = []
    used: set[int] = set()
    if isinstance(route_entries_raw, list):
        for route_dict in route_entries_raw:
            if not isinstance(route_dict, dict) or not route_dict:
                continue
            items = [v for v in route_dict.values() if isinstance(v, dict)]
            if not items or items[0].get('route_num') is None:
                continue
            pts = []
            for item in items:
                wn = item.get('wypt_num')
                if wn is None:
                    continue
                wn = int(wn)
                src = nav_by_num.get(wn)
                if src is None:
                    continue
                alt = item.get('alt') if item.get('alt') is not None else src.get('alt')
                pts.append((wn, {
                    'number':    wn,
                    'x':         float(src['x']),
                    'y':         float(src['y']),
                    'alt_m':     float(alt) if alt is not None else None,
                    'note':      src.get('note', ''),
                    'speed_kts': float(item['speed']) if item.get('speed') is not None else None,
                }))
            # A route with fewer than 2 resolved points draws no line — fold
            # it into the standalone bucket instead of keeping a pointless tag
            # (this happens with stale/incomplete NAV_ROUTE data in the wild).
            if len(pts) >= 2:
                used.update(wn for wn, _ in pts)
                groups.append((int(items[0]['route_num']), [p for _, p in pts]))

    standalone = [
        {
            'number':    wn,
            'x':         float(p['x']),
            'y':         float(p['y']),
            'alt_m':     float(p['alt']) if p.get('alt') is not None else None,
            'note':      p.get('note', ''),
            'speed_kts': None,
        }
        for wn, p in sorted(nav_by_num.items()) if wn not in used
    ]

    result = [{'route': rn, 'points': pts} for rn, pts in sorted(groups, key=lambda g: g[0])]
    if standalone:
        result.append({'route': None, 'points': standalone})
    return result


def parse_dtc_routes(content: bytes) -> list[dict]:
    """
    Parse the navigation route(s) defined by a DCS DTC JSON file.

    A single DTC can define multiple named routes (F-16: NAV_PTS grouped by
    R1-R3; F-18: separate NAV_ROUTE entries by route_num) — each is flown as
    its own connected leg. Points not part of any named route are returned
    under a 'route': None group ('standalone').

    Returns a list of {'route': int|None, 'points': [pointdict, ...]},
    ordered by ascending route number with the standalone group (if any)
    last. Each pointdict has: number, x, y, alt_m, note, speed_kts (all
    optional except x/y/number).

    Returns an empty list when no route data is present (backwards compatible).
    """
    try:
        data = json.loads(content.decode('utf-8', errors='replace'))['data']
    except (json.JSONDecodeError, KeyError):
        return []
    mpd = data.get('MPD')
    if isinstance(mpd, dict) and isinstance(mpd.get('NAV_PTS'), list):
        return _parse_f16_routes(mpd['NAV_PTS'])
    wypt = data.get('WYPT')
    if isinstance(wypt, dict):
        return _parse_f18_routes(wypt)
    return []


def parse_dtc_lines(content: bytes) -> list[dict]:
    """
    Parse reference/planning polylines (e.g. FLOT, coordination lines) from a
    DCS DTC JSON file. These are NOT navigation routes — no speed/TOS data,
    purely geographic reference lines drawn on the HSD/TSD.

    F-16 uses a dedicated MPD.GEO_LINES point array (separate from NAV_PTS,
    grouped by L1-L4). F-18 has no such dedicated array — it reuses the real
    WYPT.NAV_PTS steerpoints, grouped by R1-R3 (a different meaning of R1-R3
    than F-16, which uses those flags on NAV_PTS for routes instead).

    Returns a list of {'line': int, 'points': [{x, y, alt_m, note}, ...]},
    one entry per non-empty line group (groups with fewer than 2 points are
    dropped — a single point can't form a line). Returns an empty list when
    no line data is present (backwards compatible).
    """
    try:
        data = json.loads(content.decode('utf-8', errors='replace'))['data']
    except (json.JSONDecodeError, KeyError):
        return []

    mpd = data.get('MPD')
    if isinstance(mpd, dict) and isinstance(mpd.get('GEO_LINES'), list):
        raw_pts, flag_prefix, flag_range, order_key = mpd['GEO_LINES'], 'L', (1, 2, 3, 4), 'number'
    else:
        wypt = data.get('WYPT')
        if isinstance(wypt, dict) and isinstance(wypt.get('NAV_PTS'), list):
            raw_pts, flag_prefix, flag_range, order_key = wypt['NAV_PTS'], 'R', (1, 2, 3), 'wypt_num'
        else:
            return []

    groups: dict[int, list[dict]] = {}
    for pt in raw_pts:
        if not isinstance(pt, dict) or pt.get('x') is None or pt.get('y') is None:
            continue
        ln = next((n for n in flag_range if pt.get(f'{flag_prefix}{n}')), None)
        if ln is None:
            continue
        groups.setdefault(ln, []).append(pt)

    result = []
    for ln in sorted(groups):
        ordered = sorted(groups[ln], key=lambda p: p.get(order_key) or 0)
        points = [_line_point(p) for p in ordered]
        if len(points) >= 2:
            result.append({'line': ln, 'points': points})
    return result


def load_dtc_files(z: zipfile.ZipFile) -> dict[str, dict]:
    """
    Load all DTC files from the miz archive.

    Returns {dtc_name: dtc_data} where dtc_data contains:
      - COMM1, COMM2, … keys: {channel_num: freq_mhz}  (passed to build_comms_from_dtc)
      - 'routes' key (optional): list of route groups from parse_dtc_routes
      - 'lines' key (optional): list of line groups from parse_dtc_lines

    DTC name is the stem of the file (e.g. 'Broomstick_F16').
    """
    dtcs: dict[str, dict] = {}
    for fname in z.namelist():
        if fname.startswith('DTC/') and fname.endswith('.dtc'):
            stem = Path(fname).stem
            content = z.read(fname)
            entry: dict = dict(parse_dtc_file(content))
            routes = parse_dtc_routes(content)
            if routes:
                entry['routes'] = routes
            lines = parse_dtc_lines(content)
            if lines:
                entry['lines'] = lines
            dtcs[stem] = entry
    return dtcs


def build_comms_from_dtc(dtc_channels: dict[str, dict[int, float]]) -> tuple[dict | None, dict | None]:
    """
    Classify DTC COMM channels into UHF (≥225 MHz) and VHF (<225 MHz) channel dicts.
    Returns (uhf_channels, vhf_channels) where each is {channel_num: freq_mhz} or None.
    Channels from COMM1 take priority; COMM2 fills in any gaps.
    Frequency metadata (callsign, role) lives in registry.frequencies.
    """
    uhf: dict[int, float] = {}
    vhf: dict[int, float] = {}
    for radio in ('COMM1', 'COMM2'):
        presets = dtc_channels.get(radio, {})
        for ch_num, freq in presets.items():
            if freq >= 225.0:
                if ch_num not in uhf:
                    uhf[ch_num] = freq
            else:
                if ch_num not in vhf:
                    vhf[ch_num] = freq
    return (dict(sorted(uhf.items())) or None,
            dict(sorted(vhf.items())) or None)


# ── SPINS markdown parser ─────────────────────────────────────────────────────

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

        # Sub-heading (### inside a ## section) → {heading} entry
        if line.startswith('### '):
            if in_table:
                flush_table()
            if current is not None:
                current.setdefault('entries', []).append({'heading': line[4:].strip()})
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
