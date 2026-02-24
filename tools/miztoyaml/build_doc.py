"""build_doc — assemble the final YAML document dict from all parsed data."""

from __future__ import annotations

import re
from pathlib import Path

from .dtc import build_comms_from_dtc
from .models import Carrier, Flight
from .build_missions import (
    AIRDROME_IDS, CVN_NAMES,
    build_airfields_registry, build_missions,
)


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
    """Build a callsigns registry from the extracted flights (excluding AWACS)."""
    result: dict = {}
    for f in flights:
        if f.is_awacs:
            continue
        ac_base = f.aircraft_type.split('_')[0]
        ac_type = re.sub(r'[^A-Z0-9]', '', ac_base.upper())
        result[f.name] = {
            "type":  ac_type,
            "role":  f.task + " flight lead" if not f.is_tanker else f.task,
        }
    return result or None


def build_tankers_list(flights: list[Flight]) -> list[dict] | None:
    """
    Build a list of tanker entries for registry.tankers.
    Each entry has: callsign (group name), altitude_ft, speed_kts.
    """
    result = []
    for f in flights:
        if not f.is_tanker:
            continue
        # Grab orbit params from the first orbit steer point if available
        alt_ft: int | None = None
        speed_kts: int | None = None
        for wp in f.waypoints:
            if wp.is_orbit:
                alt_ft    = wp.orbit_alt_ft
                speed_kts = wp.orbit_speed_kts
                break
        entry: dict = {"callsign": f.name}
        if alt_ft    is not None: entry["altitude_ft"] = alt_ft
        if speed_kts is not None: entry["speed_kts"]   = speed_kts
        result.append(entry)
    return result or None


def build_control_agencies(flights: list[Flight]) -> dict | None:
    """
    Build registry.control_agencies from AWACS flights.
    Each entry is keyed by the group name (the mission callsign).
    """
    result: dict = {}
    for f in flights:
        if not f.is_awacs:
            continue
        ac_base  = f.aircraft_type.split('_')[0]
        platform = re.sub(r'[^A-Z0-9\-]', '', ac_base.upper())
        result[f.name] = {
            "type":              "AWACS",
            "callsign":          f.name,
            "platform":          platform,
            "primary_freq_mhz":  str(round(f.freq_mhz, 3)),
        }
    return result or None


def build_flight_comms(flights: list[Flight], dtcs: dict[str, dict]) -> list[dict] | None:
    """
    Build per-flight comms list.  Each entry has the flight group name,
    callsign (= group name), DTC cartridge name, and UHF/VHF preset dicts.
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
        entries.append({
            "group":         f.name,
            "callsign":      f.name,
            "dtc_cartridge": f.dtc_cartridge,
            "uhf_presets":   uhf,
            "vhf_presets":   vhf,
        })
    return entries or None


def build_doc(*, mission_name, mission_date, theatre,
              year, month, targets, ref_pts, acms, metar, wx_notes,
              flights, carriers, dtcs=None, spins_sections=None,
              ingame_start_local=None) -> dict:

    import hashlib

    # ── Theatre → local UTC offset (hours) ──────────────────────────────────
    # DCS uses fixed offsets regardless of daylight saving time.
    _THEATRE_OFFSET: dict[str, int] = {
        "Syria":          3,   # Damascus / Incirlik: UTC+3
        "PersianGulf":    4,   # UAE / Gulf Standard Time: UTC+4
        "Caucasus":       4,   # Tbilisi / Georgia: UTC+4
        "Nevada":        -8,   # Las Vegas (Pacific Standard Time): UTC-8
        "Normandy":       1,   # Western Europe (UTC+1, no DST applied)
        "MarianaIslands": 10,  # Chamorro Standard Time: UTC+10
        "Falklands":     -3,   # Argentina / Falklands: UTC-3
        "SinaiMap":       2,   # Egypt Standard Time: UTC+2
    }
    local_offset_hours = _THEATRE_OFFSET.get(theatre)
    if local_offset_hours is None and theatre:
        print(f"[!] Unknown theatre '{theatre}' — local_offset_hours will be None")
    msn_start = 1000 + int(hashlib.md5(mission_name.encode()).hexdigest()[:4], 16) % 8000
    tanker_msn_start = msn_start + 500

    # Bullseye name references registry.reference_points (first bullseye entry)
    bullseye_key = next(
        (v["name"] for v in ref_pts.values() if v.get("type") == "bullseye"),
        list(ref_pts.keys())[0] if ref_pts else None,
    )

    airfields = build_airfields_registry(flights, carriers, theatre)

    # Build missions — also mutates ref_pts to add marshal points found in routes.
    # AWACS flights are excluded from missions (handled by control_agencies).
    missions = build_missions(
        flights, msn_start, tanker_msn_start,
        targets, carriers, airfields, ref_pts) or None
    msn_numbers = [m["mission_number"] for m in missions] if missions else []

    ato_airfields = [{"icao": icao, "role": "deploy"} for icao in airfields] or None

    flight_comms = build_flight_comms(flights, dtcs or {})

    control_agencies = build_control_agencies(flights)
    # If there is exactly one AWACS, set it as the default global_control agency
    awacs_agency_id = next(iter(control_agencies or {}), None)

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
            "tankers":          build_tankers_list(flights),
            "targets":          targets   or None,
            "reference_points": list(ref_pts.values()) or None,
            "control_agencies": control_agencies,
        },

        "ato": {
            "irl_date":           mission_date,
            "irl_time_zulu":      None,
            "ingame_start_time":  None,
            "ingame_start_local": ingame_start_local,
            "local_offset_hours": local_offset_hours,
            "ae_flags":           ["IRL", "INGAME"],
            "global_control": {
                "agency_id": awacs_agency_id,
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
            "missions":    len([f for f in flights if not f.is_tanker and not f.is_awacs]),
            "tankers":     len([f for f in flights if f.is_tanker]),
            "awacs":       len([f for f in flights if f.is_awacs]),
            "airfields":   len(airfields),
        },
    }
