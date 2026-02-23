"""
miztoyaml — DCS .miz → ATO brief package YAML

Package structure:
    lua            – brace-balanced Lua table helpers
    projection     – DCS Cartesian → WGS84 using TM constants
    sam            – SAM system definitions + unit classification
    weapons        – CLSID lookup, loadout condensing, ATO encoding
    dtc            – DTC file parsing + SPINS markdown parser
    models         – typed dataclasses for parsed objects
    parse          – Group, Drawing, bullseye parsing
    parse_flights  – Flight, Carrier, waypoint, weather parsing
    build_targets  – aim-point, target, and ACM building
    build_missions – airfield registry + mission list building
    build_doc      – final YAML document assembly
    extract        – top-level extract() + CLI entry point
"""

from .extract import extract, main

__all__ = ["extract", "main"]
