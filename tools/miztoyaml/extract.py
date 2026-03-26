"""extract — top-level extract() function and CLI entry point."""

from __future__ import annotations

import argparse
import re
import zipfile
from pathlib import Path

import yaml

from .build_doc import build_doc
from .build_targets import build_acms, build_targets
from .dtc import load_dtc_files
from .log import log, setup_logging
from .lua import lua_get_block
from .parse import parse_bullseye, parse_drawings, parse_groups
from .parse_flights import parse_flights_and_carriers, parse_weather


def _parse_weather_txt(text: str) -> tuple[list[str], list[str]]:
    """
    Parse a weather.txt file for additional METAR and TAF strings.

    Lines starting with 'METAR' or 'SPECI' are collected as METARs.
    Lines starting with 'TAF' are collected as TAFs (multi-line TAFs should
    be joined into a single line).
    Other non-empty lines are ignored.
    """
    metars: list[str] = []
    tafs: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        upper = stripped.upper()
        if upper.startswith('METAR ') or upper.startswith('SPECI '):
            metars.append(stripped)
        elif upper.startswith('TAF '):
            tafs.append(stripped)
    return metars, tafs


def extract(miz_path: str, coalition: str = "blue") -> dict:
    opposing = "red" if coalition == "blue" else "blue"

    with zipfile.ZipFile(miz_path) as z:
        mission_text = z.read("mission").decode("utf-8", errors="replace")
        theatre = z.read("theatre").decode().strip() \
                  if "theatre" in z.namelist() else "Syria"
        dtcs = load_dtc_files(z)

    if dtcs:
        log.info("Found DTC files: %s", ", ".join(sorted(dtcs)))

    log.info("Theatre=%s  coalition=%s  targets_from=%s", theatre, coalition, opposing)

    # Date — extract Year/Day/Month independently (field order varies by miz version)
    year, day, month = 2024, 1, 1
    dm = re.search(r'\["date"\].*?\{([^}]*)\}', mission_text, re.DOTALL)
    if dm:
        date_block = dm.group(1)
        year_m  = re.search(r'\["Year"\]\s*=\s*(\d+)',  date_block)
        day_m   = re.search(r'\["Day"\]\s*=\s*(\d+)',   date_block)
        month_m = re.search(r'\["Month"\]\s*=\s*(\d+)', date_block)
        if year_m:  year  = int(year_m.group(1))
        if day_m:   day   = int(day_m.group(1))
        if month_m: month = int(month_m.group(1))
    mission_date = f"{year}-{month:02d}-{day:02d}"

    # Top-level mission start_time (seconds from midnight local time, 0–86399)
    sm = re.search(r'^\t\["start_time"\]\s*=\s*(\d+)', mission_text, re.MULTILINE)
    ingame_start_local = None
    if sm:
        total_seconds = int(sm.group(1)) % 86400  # clamp to 0–86399
        hh = total_seconds // 3600
        mm = (total_seconds % 3600) // 60
        ingame_start_local = f"{hh:02d}{mm:02d}"
        log.info("Mission start_time=%ss → %sL", sm.group(1), ingame_start_local)

    # Coalition blocks
    coal_block = lua_get_block(mission_text, 'coalition')
    if not coal_block:
        raise ValueError("No coalition block found")
    opp_block = lua_get_block(coal_block, opposing)
    own_block = lua_get_block(coal_block, coalition)

    # Targets
    log.info("Parsing %s groups…", opposing)
    opp_groups = parse_groups(opp_block or '', theatre)
    log.info("    %d groups", len(opp_groups))
    targets = build_targets(opp_groups)
    log.info("%d targets", len(targets))

    # Bullseye
    ref_pts: dict = {}
    if own_block:
        be = parse_bullseye(own_block, theatre)
        if be:
            ref_pts["BULLSEYE"] = {"name": "BULLSEYE", "type": "bullseye", "coords": be}
            log.info("Bullseye: %s", be)

    # Flights + carriers (own coalition)
    log.info("Parsing %s flights and carriers…", coalition)
    flights, carriers = parse_flights_and_carriers(own_block or '', theatre)
    log.info("    %d flights  |  %d carriers", len(flights), len(carriers))
    for f in flights:
        dtc_label = f"  dtc={f.dtc_cartridge}" if f.dtc_cartridge else ""
        log.debug("  %s: %r  task=%s  ac=%s  x%d  freq=%s%s",
                  f.id, f.name, f.task, f.aircraft_type, len(f.units), f.freq_mhz, dtc_label)
    for c in carriers:
        log.debug("  %s: %s  %s  %s", c.id, c.type, c.name, c.deploy_coords)

    # Summarise DTC comms coverage
    flights_with_dtc = [f for f in flights if f.dtc_cartridge and f.dtc_cartridge in dtcs]
    if flights_with_dtc:
        log.info("DTC comms available for %d flights: %s",
                 len(flights_with_dtc),
                 ", ".join(f"'{f.name}'→{f.dtc_cartridge}" for f in flights_with_dtc))
    elif dtcs:
        log.warning("No DTC cartridges matched to flights; available: %s", ", ".join(sorted(dtcs)))

    # Summarise DTC NAV_PTS (steerpoint) coverage
    flights_with_nav = [f for f in flights
                        if f.dtc_cartridge and dtcs.get(f.dtc_cartridge, {}).get('nav_pts')]
    if flights_with_nav:
        log.info("DTC NAV_PTS steerpoints loaded for %d flight(s): %s",
                 len(flights_with_nav),
                 ", ".join(f"'{f.name}'→{f.dtc_cartridge}" for f in flights_with_nav))

    # ACO drawings
    log.info("Parsing drawings…")
    drawings = parse_drawings(mission_text)
    acms = build_acms(drawings, theatre)
    log.info("%d ACMs", len(acms))

    # Weather
    metar, wx_notes = parse_weather(mission_text, day)
    log.info("%s", metar)

    # Additional weather from weather.txt — look in same directory as .miz file
    extra_metars: list[str] = []
    extra_tafs: list[str] = []
    wx_txt_path = Path(miz_path).parent / 'weather.txt'
    if wx_txt_path.exists():
        wx_text = wx_txt_path.read_text(encoding='utf-8', errors='replace')
        _metars, _tafs = _parse_weather_txt(wx_text)
        extra_metars = _metars
        extra_tafs = _tafs
        log.info("Loaded weather.txt: %d METARs, %d TAFs", len(extra_metars), len(extra_tafs))
    else:
        log.info("No weather.txt found at '%s' — using DCS weather only", wx_txt_path)

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
        ingame_start_local=ingame_start_local,
        extra_metars=extra_metars,
        extra_tafs=extra_tafs,
    )


def main():
    ap = argparse.ArgumentParser(description="DCS .miz → ATO brief YAML")
    ap.add_argument("miz")
    ap.add_argument("--coalition", "-c", default="blue", choices=["blue", "red"])
    ap.add_argument("--output",    "-o", default=None)
    ap.add_argument("--quiet",     "-q", action="store_true", default=False,
                    help="Suppress all informational output (default)")
    ap.add_argument("--debug",     "-d", action="store_true", default=False,
                    help="Show informational progress messages")
    ap.add_argument("--verbose",   "-v", action="store_true", default=False,
                    help="Show detailed diagnostic output")
    args = ap.parse_args()

    setup_logging(quiet=not (args.debug or args.verbose),
                  debug=args.debug, verbose=args.verbose)

    out = args.output or (Path(args.miz).stem + ".yaml")
    doc = extract(args.miz, args.coalition)

    with open(out, "w", encoding="utf-8") as f:
        yaml.dump(doc, f, allow_unicode=True, sort_keys=False,
                  default_flow_style=False, width=120)
    # Final success message always shown regardless of log level
    print(f"\n[OK] {out}")
