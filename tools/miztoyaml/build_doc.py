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
    msn_start = 1000 + int(hashlib.md5(mission_name.encode()).hexdigest()[:4], 16) % 8000
    tanker_msn_start = msn_start + 500

    # Bullseye name references registry.reference_points (first bullseye entry)
    bullseye_key = next(
        (v["name"] for v in ref_pts.values() if v.get("type") == "bullseye"),
        list(ref_pts.keys())[0] if ref_pts else None,
    )

    airfields = build_airfields_registry(flights, carriers, theatre)

    # Build missions — also mutates ref_pts to add marshal points found in routes
    missions = build_missions(
        flights, msn_start, tanker_msn_start,
        targets, carriers, airfields, ref_pts) or None
    msn_numbers = [m["mission_number"] for m in missions] if missions else []

    ato_airfields = [{"icao": icao, "role": "deploy"} for icao in airfields] or None

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
            "reference_points": list(ref_pts.values()) or None,
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
