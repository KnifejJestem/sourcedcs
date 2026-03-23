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
    Parse NAV_PTS steerpoints from a DCS DTC JSON file (data.MPD.NAV_PTS).

    Returns a list of nav point dicts, each containing:
      number (int), x (float), y (float), alt_m (float|None), note (str), type (str).

    Returns an empty list when NAV_PTS is absent (backwards compatible).
    """
    try:
        data = json.loads(content.decode('utf-8', errors='replace'))['data']
    except (json.JSONDecodeError, KeyError):
        return []
    nav_pts_raw = data.get('MPD', {}).get('NAV_PTS', [])
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
        num_raw = pt.get('number')
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


def load_dtc_files(z: zipfile.ZipFile) -> dict[str, dict]:
    """
    Load all DTC files from the miz archive.

    Returns {dtc_name: dtc_data} where dtc_data contains:
      - COMM1, COMM2, … keys: {channel_num: freq_mhz}  (passed to build_comms_from_dtc)
      - 'nav_pts' key (optional): list of nav point dicts from parse_dtc_nav_pts

    DTC name is the stem of the file (e.g. 'Broomstick_F16').
    """
    dtcs: dict[str, dict] = {}
    for fname in z.namelist():
        if fname.startswith('DTC/') and fname.endswith('.dtc'):
            stem = Path(fname).stem
            content = z.read(fname)
            entry: dict = dict(parse_dtc_file(content))
            nav_pts = parse_dtc_nav_pts(content)
            if nav_pts:
                entry['nav_pts'] = nav_pts
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
