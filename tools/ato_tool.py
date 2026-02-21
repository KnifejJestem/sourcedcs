#!/usr/bin/env python3
"""
ATO Tool - Air Tasking Order Parser & Generator
Converts USMTF-style ATO machine format <-> human-readable YAML

Usage:
    python ato_tool.py parse  input.ato  output.yaml
    python ato_tool.py build  input.yaml output.ato
    python ato_tool.py roundtrip input.ato
"""

import sys
import re
import yaml
from dataclasses import dataclass, field
from typing import Optional

# ---------------------------------------------------------------------------
# DATA STRUCTURES
# ---------------------------------------------------------------------------

@dataclass
class Bullseye:
    name: str       # e.g. "COYOTE"
    coords: str     # raw coord string e.g. N26deg51'19.09"E 56deg21'36.93"

@dataclass
class GlobalControl:
    primary_freq: Optional[str]   = None  # e.g. "260.0"
    modulation: Optional[str]     = None  # Preset notation: "U5" = UHF radio, preset 5
                                               #                 "V3" = VHF radio, preset 3
                                               #                 "HF" = HF radio
    unit: Optional[str]           = None  # controlling unit name e.g. "SCREWTOP"
    aircraft_type: Optional[str]  = None  # e.g. "E-3"
    bullseye: Optional[Bullseye]  = None

@dataclass
class Refuel:
    tanker_callsign: str          # e.g. "ARCO4"
    track: str                    # AR track identifier e.g. "AR394"
    altitude: str                 # e.g. "FL240"
    net: Optional[str] = None     # Not Earlier Than HHMM (Zulu, Z stripped)
    nlt: Optional[str] = None     # Not Later Than HHMM

@dataclass
class Aircraft:
    count: int
    type: str                     # e.g. "F16C", "AH64"
    loadout: Optional[str] = None # Weapons/config code e.g. "501+", "4GM114LX..."

@dataclass
class TargetLocation:
    location: str                           # e.g. "KHASAB", "KHASAB AFB"
    net: Optional[str] = None              # Not Earlier Than
    nlt: Optional[str] = None              # Not Later Than
    mission_type_override: Optional[str] = None  # e.g. "AIRDEF", "SILKWORMS"
    dmp_ids: list = field(default_factory=list)  # DMPIID coordinate strings
    altitude: Optional[str] = None         # e.g. "E73FT", "E 74FT"

@dataclass
class Control:
    primary_freq: Optional[str]   = None
    secondary_freq: Optional[str] = None
    name: Optional[str]           = None   # Net/controller name
    # Note: ATO uses compact preset notation e.g. PFREQ:260.0/U5
    #   U = UHF radio (225-400 MHz),  digit = preset channel number (1-20)
    #   V = VHF radio (108-174 MHz),  digit = preset channel number (1-20)
    #   Preset assignments are defined in comms.yaml

@dataclass
class Mission:
    # TASKUNIT line
    unit: str                           # e.g. "510vFS", "1 AAC"
    home_base: str                      # ICAO e.g. "OMAM"
    # MSNDAT line
    mission_number: Optional[str] = None   # e.g. "MSN3266", "AA7511"
    callsign: Optional[str]       = None   # e.g. "FALCON5"
    mission_type: Optional[str]   = None   # CAP / BAI / CAS / SEAD / etc.
    priority: Optional[str]       = None
    deploy_loc: Optional[str]     = None   # ICAO
    aar_loc: Optional[str]        = None   # ICAO
    # Sub-records
    aircraft: Optional[Aircraft]        = None
    target: Optional[TargetLocation]    = None
    control: Optional[Control]          = None
    refuel: Optional[Refuel]            = None
    bullseye: Optional[Bullseye]        = None

@dataclass
class ATO:
    # AE line: "AE:DD/MM/YYYY HHMMZ IRL 0000L INGAME"
    irl_date: str                        # e.g. "11/01/2026"  real-world date
    irl_time: str                        # e.g. "1900Z"       real-world start (Zulu)
    ingame_start_local: Optional[str] = None  # e.g. "0000L" in-game clock start
    extra_flags: list = field(default_factory=list)  # ["IRL","INGAME",...]
    global_control: Optional[GlobalControl] = None
    missions: list = field(default_factory=list)
    targets: list = field(default_factory=list)  # YAML-only target definitions

# ---------------------------------------------------------------------------
# KNOWN MISSION TYPES
# ---------------------------------------------------------------------------
MISSION_TYPES = {
    'CAP','BAI','CAS','SEAD','DEAD','OCA','DCA',
    'STRIKE','RECCE','ESCORT','REFUEL','CSAR','ABCCC',
    'TARCAP','SWEEP','FACP','VUL',
}

# ---------------------------------------------------------------------------
# PARSER
# ---------------------------------------------------------------------------

def parse_bullseye(value: str) -> Bullseye:
    parts = value.split('/')
    name, coords = '', ''
    coord_pat = re.compile(r'^[NS]\d')
    for i, p in enumerate(parts):
        p = p.strip()
        if p and p != '-' and not coord_pat.match(p):
            name = p
        elif coord_pat.match(p):
            coords = '/'.join(parts[i:]).strip()
            break
    return Bullseye(name=name, coords=coords)

def parse_tgtloc(value: str) -> TargetLocation:
    tgt = TargetLocation(location='')
    raw = value.strip()
    dmpids = re.findall(r'DMPIID:([^/]+(?:"[^/]*)?)', raw)
    dmpids = [d.strip().rstrip('-').strip() for d in dmpids]
    tgt.dmp_ids = [d for d in dmpids if d]
    clean = re.sub(r'/DMPIID:[^/]+(?:"[^/]*)?', '', raw)
    clean = re.sub(r'DMPIID:[^/]+(?:"[^/]*)?', '', clean)
    parts = clean.split('/')
    tgt.location = parts[0].strip()
    for p in parts[1:]:
        p = p.strip()
        if not p or p == '-':
            continue
        if p.startswith('NET:'):
            tgt.net = p[4:].rstrip('Z')
        elif p.startswith('NLT:'):
            tgt.nlt = p[4:].rstrip('Z')
        elif re.match(r'^[EW]\s*\d+FT', p):
            tgt.altitude = p
        elif p.upper() in MISSION_TYPES or p.upper() in ('AIRDEF', 'SILKWORMS'):
            tgt.mission_type_override = p
    return tgt

def parse_msnacft(value: str) -> Aircraft:
    parts = value.split('/')
    count = int(parts[0]) if parts[0].isdigit() else 1
    actype, loadout = '', ''
    for p in parts[1:]:
        p = p.strip()
        if p.startswith('ACTYP:'):
            actype = p[6:]
        elif p and p != '-':
            loadout = p
    return Aircraft(count=count, type=actype, loadout=loadout or None)

def parse_msndat(value: str) -> dict:
    parts = [p.strip() for p in value.split('/')]
    result = {}
    for p in parts:
        if p.startswith('DEPLOC:'):
            result['deploy_loc'] = p[7:]
        elif p.startswith('AARLOC:') or p.startswith('ARRLOC:'):
            result['aar_loc'] = p[7:]
        elif p.upper() in MISSION_TYPES:
            result['mission_type'] = p.upper()
    idx = 0
    while idx < len(parts) and parts[idx] in ('-', ''):
        idx += 1
    positional = [
        p for p in parts[idx:]
        if p and p != '-'
        and not p.startswith('DEPLOC:')
        and not p.startswith('AARLOC:')
        and not p.startswith('ARRLOC:')
        and p.upper() not in MISSION_TYPES
    ]
    if positional:
        result['mission_number'] = positional[0]
    if len(positional) > 1:
        result['callsign'] = positional[1]
    return result

def parse_control_line(value: str):
    c, mod = Control(), None
    for p in value.split('/'):
        p = p.strip()
        if p.startswith('PFREQ:'):
            c.primary_freq = p[6:]
        elif p.startswith('SFREQ:'):
            c.secondary_freq = p[6:]
        elif p.startswith('NAME:') or p.startswith('NAME '):
            c.name = p.split(':', 1)[-1].strip()
        elif re.match(r'^U\d$|^V\d?$|^HF$', p):
            mod = p
    return c, mod

def parse_refuel(value: str) -> Refuel:
    parts = value.split('/')
    net = nlt = None
    for p in parts:
        if p.startswith('NET:'): net = p[4:].rstrip('Z')
        elif p.startswith('NLT:'): nlt = p[4:].rstrip('Z')
    callsign = parts[0] if parts else ''
    track    = parts[1] if len(parts) > 1 else ''
    alt      = parts[2] if len(parts) > 2 else ''
    return Refuel(tanker_callsign=callsign, track=track, altitude=alt, net=net, nlt=nlt)

def parse_ae_line(ae_line: str):
    """
    AE:11/01/2026 1900Z IRL 0000L INGAME
    Returns (irl_date, irl_time, ingame_start_local, extra_flags)
    - irl_date:           DD/MM/YYYY
    - irl_time:           HHMMZ  (real-world Zulu start)
    - ingame_start_local: HHHL token (e.g. "0000L")
    - extra_flags:        remaining tokens (IRL, INGAME, etc.)
    """
    m = re.match(r'AE:(\d{2}/\d{2}/\d{4})\s+(\d{4}Z)\s*(.*)', ae_line)
    if not m:
        return ('', '', None, [])
    irl_date, irl_time = m.group(1), m.group(2)
    rest = m.group(3).split()
    ingame_local, extra_flags = None, []
    for token in rest:
        if re.match(r'^\d{4}L$', token):
            ingame_local = token
        else:
            extra_flags.append(token)
    return (irl_date, irl_time, ingame_local, extra_flags)

def parse_ato(text: str) -> ATO:
    lines = [l.rstrip() for l in text.splitlines()]
    ae_line = next((l for l in lines if l.startswith('AE:')), '')
    irl_date, irl_time, ingame_local, extra_flags = parse_ae_line(ae_line)
    ato = ATO(irl_date=irl_date, irl_time=irl_time,
              ingame_start_local=ingame_local, extra_flags=extra_flags)

    directives = [l.rstrip('/') for l in lines if l.rstrip('/')]

    gc = GlobalControl()
    in_global, missions, current = True, [], None
    i = 0
    while i < len(directives):
        line = directives[i]
        if line.startswith('TASKUNIT/'):
            in_global = False
            if current: missions.append(current)
            parts = line[9:].split('/')
            unit = parts[0].strip()
            home = parts[1].strip() if len(parts) > 1 else ''
            if home.startswith('ICAO:'): home = home[5:]
            current = Mission(unit=unit, home_base=home)
        elif line.startswith('MSNDAT/'):
            parsed = parse_msndat(line[7:])
            if in_global:
                parts = line[7:].split('/')
                for j, p in enumerate(parts):
                    if p == 'UNIT' and j+1 < len(parts): gc.unit = parts[j+1]
                    if re.match(r'^[A-Z]-\d|^E-3|^B-52', p): gc.aircraft_type = p
            elif current:
                current.mission_number = parsed.get('mission_number')
                current.callsign       = parsed.get('callsign')
                current.mission_type   = parsed.get('mission_type')
                current.deploy_loc     = parsed.get('deploy_loc')
                current.aar_loc        = parsed.get('aar_loc')
        elif line.startswith('MSNACFT/'):
            ac = parse_msnacft(line[8:])
            if current: current.aircraft = ac
        elif line.startswith('TGTLOC/'):
            body = line[7:]
            while i+1 < len(directives) and directives[i+1].startswith('DMPIID:'):
                i += 1; body += '/' + directives[i]
            if current: current.target = parse_tgtloc(body)
        elif line.startswith('CONTROL/'):
            ctrl, mod = parse_control_line(line[8:])
            if in_global:
                gc.primary_freq = ctrl.primary_freq
                if mod: gc.modulation = mod
                if ctrl.name: gc.unit = ctrl.name
            elif current: current.control = ctrl
        elif line.startswith('BULLSEYE/'):
            be = parse_bullseye(line[9:])
            if in_global: gc.bullseye = be
            elif current: current.bullseye = be
        elif line.startswith('REFUEL/'):
            ref = parse_refuel(line[7:])
            if current and current.refuel is None: current.refuel = ref
        i += 1

    if current: missions.append(current)
    ato.global_control = gc
    ato.missions = missions
    return ato

# ---------------------------------------------------------------------------
# YAML SERIALIZATION
# ---------------------------------------------------------------------------

def bullseye_to_dict(b): return {'name': b.name, 'coords': b.coords}

def gc_to_dict(gc):
    d = {'primary_freq_mhz': gc.primary_freq, 'modulation': gc.modulation,
         'controlling_unit': gc.unit, 'aircraft_type': gc.aircraft_type}
    if gc.bullseye: d['bullseye'] = bullseye_to_dict(gc.bullseye)
    return {k: v for k, v in d.items() if v is not None}

def aircraft_to_dict(ac):
    d = {'count': ac.count, 'type': ac.type}
    if ac.loadout: d['loadout'] = ac.loadout
    return d

def target_to_dict(tgt):
    d = {'location': tgt.location, 'not_earlier_than': tgt.net,
         'not_later_than': tgt.nlt, 'mission_type_override': tgt.mission_type_override,
         'altitude': tgt.altitude, 'aim_points': tgt.dmp_ids if tgt.dmp_ids else None}
    return {k: v for k, v in d.items() if v is not None}

def control_to_dict(c):
    d = {'primary_freq_mhz': c.primary_freq, 'secondary_freq_mhz': c.secondary_freq,
         'net_name': c.name}
    return {k: v for k, v in d.items() if v is not None}

def refuel_to_dict(r):
    d = {'tanker_callsign': r.tanker_callsign, 'ar_track': r.track,
         'altitude': r.altitude, 'not_earlier_than': r.net, 'not_later_than': r.nlt}
    return {k: v for k, v in d.items() if v is not None}

def mission_to_dict(m):
    d = {'unit': m.unit, 'home_base_icao': m.home_base,
         'mission_number': m.mission_number, 'callsign': m.callsign,
         'mission_type': m.mission_type,
         'deploy_location_icao': m.deploy_loc, 'aar_location_icao': m.aar_loc}
    if m.aircraft: d['aircraft'] = aircraft_to_dict(m.aircraft)
    if m.target:   d['target']   = target_to_dict(m.target)
    if m.control:  d['control']  = control_to_dict(m.control)
    if m.refuel:   d['refuel']   = refuel_to_dict(m.refuel)
    if m.bullseye: d['bullseye'] = bullseye_to_dict(m.bullseye)
    return {k: v for k, v in d.items() if v is not None}

def ato_to_yaml(ato: ATO) -> str:
    doc = {
        'schema_version': '1.0',
        'ato': {
            'irl_date': ato.irl_date,
            'irl_time_zulu': ato.irl_time,
            'ingame_start_time': ato.ingame_start_local,
            'ae_flags': ato.extra_flags,
            'global_control': gc_to_dict(ato.global_control) if ato.global_control else {},
            'missions': [mission_to_dict(m) for m in ato.missions],
        }
    }
    if ato.targets:
        doc['ato']['targets'] = ato.targets
    return yaml.dump(doc, allow_unicode=True, sort_keys=False, default_flow_style=False)

# ---------------------------------------------------------------------------
# BUILDER
# ---------------------------------------------------------------------------

def dict_to_bullseye(d): return Bullseye(name=d.get('name',''), coords=d.get('coords',''))
def dict_to_aircraft(d): return Aircraft(count=d.get('count',1), type=d.get('type',''), loadout=d.get('loadout'))
def dict_to_target(d): return TargetLocation(location=d.get('location',''), net=d.get('not_earlier_than'), nlt=d.get('not_later_than'), mission_type_override=d.get('mission_type_override'), altitude=d.get('altitude'), dmp_ids=d.get('aim_points') or [])
def dict_to_control(d): return Control(primary_freq=d.get('primary_freq_mhz'), secondary_freq=d.get('secondary_freq_mhz'), name=d.get('net_name'))
def dict_to_refuel(d):
    # tanker_id is a reference key; use tanker_callsign if available,
    # otherwise fall back to tanker_id as a display name.
    callsign = d.get('tanker_callsign', d.get('tanker_id', ''))
    return Refuel(tanker_callsign=callsign, track=d.get('ar_track',''), altitude=d.get('altitude',''), net=d.get('not_earlier_than'), nlt=d.get('not_later_than'))

def yaml_to_ato(text: str) -> ATO:
    raw = yaml.safe_load(text)
    doc = raw['ato']
    reg = raw.get('registry', {})

    # v1.0: resolve tanker references — check ato.tankers first, then registry.tankers
    tanker_map = {}
    for t in doc.get('tankers', []):
        if t.get('id'):
            tanker_map[t['id']] = t
    for tid, t in reg.get('tankers', {}).items():
        if tid not in tanker_map:
            tanker_map[tid] = t

    # v1.0: resolve target references from registry.targets
    target_map = {}
    for t in doc.get('targets', []):
        if t.get('id'):
            target_map[t['id']] = t
    for tid, t in reg.get('targets', {}).items():
        if tid not in target_map:
            target_map[tid] = {**t, 'id': tid}

    gc_d = doc.get('global_control', {})

    # Resolve control_agencies: resolve agency_id in global_control
    agency_map = reg.get('control_agencies', {})
    if gc_d.get('agency_id') and gc_d['agency_id'] in agency_map:
        ag = agency_map[gc_d['agency_id']]
        gc_d.setdefault('controlling_unit', ag.get('callsign', ''))
        gc_d.setdefault('aircraft_type', ag.get('platform', ''))
        gc_d.setdefault('primary_freq_mhz', ag.get('primary_freq_mhz', ''))

    # Resolve bullseye if it's a string reference to registry.reference_points
    bullseye_d = gc_d.get('bullseye')
    if isinstance(bullseye_d, str):
        ref_pts = reg.get('reference_points', {})
        rp = ref_pts.get(bullseye_d, {})
        bullseye_d = {'name': rp.get('name', bullseye_d), 'coords': rp.get('coords', '')}

    gc = GlobalControl(primary_freq=gc_d.get('primary_freq_mhz'), modulation=gc_d.get('modulation'),
                       unit=gc_d.get('controlling_unit'), aircraft_type=gc_d.get('aircraft_type'),
                       bullseye=dict_to_bullseye(bullseye_d) if bullseye_d else None)
    missions = []
    for md in doc.get('missions', []):
        refuel_d = md.get('refuel')
        if refuel_d and refuel_d.get('tanker_id') and refuel_d['tanker_id'] in tanker_map:
            t = tanker_map[refuel_d['tanker_id']]
            refuel_d.setdefault('tanker_callsign', t.get('callsign', ''))
            refuel_d.setdefault('ar_track', t.get('ar_track', ''))
            refuel_d.setdefault('altitude', t.get('altitude', ''))

        # Resolve control agency_id in mission control block
        ctrl_d = md.get('control')
        if ctrl_d and ctrl_d.get('agency_id') and ctrl_d['agency_id'] in agency_map:
            ag = agency_map[ctrl_d['agency_id']]
            ctrl_d.setdefault('primary_freq_mhz', ag.get('primary_freq_mhz', ''))
            ctrl_d.setdefault('secondary_freq_mhz', ag.get('secondary_freq_mhz', ''))
            ctrl_d.setdefault('net_name', ag.get('callsign', ''))

        # Resolve target_id: pull aim_points from the referenced registry target
        target_d = md.get('target')
        if target_d and target_d.get('target_id') and target_d['target_id'] in target_map:
            ref = target_map[target_d['target_id']]
            if not target_d.get('aim_points') and ref.get('aim_points'):
                # No explicit aim_points — pull all from the target
                target_d['aim_points'] = [
                    {'coords': ap.get('coords'), 'name': ap.get('name', ap.get('id', ''))}
                    for ap in ref['aim_points']
                ]
            elif target_d.get('aim_points') and ref.get('aim_points'):
                # Resolve aim_point_id references to specific aim_points
                ap_map = {ap['id']: ap for ap in ref['aim_points'] if ap.get('id')}
                resolved = []
                for ap in target_d['aim_points']:
                    if isinstance(ap, dict) and ap.get('aim_point_id') and ap['aim_point_id'] in ap_map:
                        src = ap_map[ap['aim_point_id']]
                        resolved.append({
                            'coords': ap.get('coords') or src.get('coords'),
                            'name': ap.get('name') or src.get('name', src.get('id', '')),
                        })
                    else:
                        resolved.append(ap)
                target_d['aim_points'] = resolved

        m = Mission(unit=md.get('unit',''), home_base=md.get('home_base_icao',''),
                    mission_number=md.get('mission_number'), callsign=md.get('callsign'),
                    mission_type=md.get('mission_type'), deploy_loc=md.get('deploy_location_icao'),
                    aar_loc=md.get('aar_location_icao'),
                    aircraft=dict_to_aircraft(md['aircraft']) if 'aircraft' in md else None,
                    target=dict_to_target(target_d)           if target_d   else None,
                    control=dict_to_control(md['control'])    if 'control'  in md else None,
                    refuel=dict_to_refuel(refuel_d)           if refuel_d   else None,
                    bullseye=dict_to_bullseye(md['bullseye']) if 'bullseye' in md else None)
        missions.append(m)

    # v1.0 uses ingame_start_time (Zulu); legacy uses ingame_start_local
    ingame = doc.get('ingame_start_time') or doc.get('ingame_start_local')

    # Collect targets list for the ATO object
    targets = doc.get('targets', [])
    if not targets:
        targets = [{**t, 'id': tid} for tid, t in reg.get('targets', {}).items()]

    return ATO(irl_date=doc.get('irl_date',''), irl_time=doc.get('irl_time_zulu',''),
               ingame_start_local=ingame, extra_flags=doc.get('ae_flags',[]),
               global_control=gc, missions=missions, targets=targets)

# ---------------------------------------------------------------------------
# SERIALIZER
# ---------------------------------------------------------------------------

def zt(val):
    if not val: return '-'
    s = str(val)
    return s if s.endswith('Z') else s + 'Z'

def fmt_bullseye(be): return f"BULLSEYE/-/{be.name}/-/{be.coords}//"

def ato_to_machine(ato: ATO) -> str:
    out = ["ATO", ""]
    # Rebuild AE line preserving flag order (IRL precedes ingame local token)
    ae_tokens = []
    for f in ato.extra_flags:
        ae_tokens.append(f)
        if f == 'IRL' and ato.ingame_start_local:
            ae_tokens.append(ato.ingame_start_local)
    if ato.ingame_start_local and ato.ingame_start_local not in ae_tokens:
        ae_tokens.append(ato.ingame_start_local)
    out.append(f"AE:{ato.irl_date} {ato.irl_time} {' '.join(ae_tokens)}")
    out.append("")
    gc = ato.global_control
    if gc:
        mod = gc.modulation or 'U5'
        out.append(f"CONTROL/-/PFREQ:{gc.primary_freq}/{mod}//")
        out.append(f"MSNDAT/-/UNIT/{gc.unit}/{gc.aircraft_type}//")
        if gc.bullseye: out.append(fmt_bullseye(gc.bullseye))
    out.append("")
    for m in ato.missions:
        out.append(f"TASKUNIT/{m.unit}/{m.home_base}//")
        msn = m.mission_number or '-'
        cs  = m.callsign or '-'
        mt  = m.mission_type or '-'
        dep = f"DEPLOC:{m.deploy_loc}" if m.deploy_loc else '-'
        aar = f"AARLOC:{m.aar_loc}"   if m.aar_loc    else '-'
        out.append(f"MSNDAT/-/{msn}/{cs}/{mt}/-/{dep}/{aar}//")
        if m.aircraft:
            ac = m.aircraft
            if ac.loadout: out.append(f"MSNACFT/{ac.count}/ACTYP:{ac.type}/{ac.loadout}//")
            else:          out.append(f"MSNACFT/{ac.count}/ACTYP:{ac.type}//")
        if m.target:
            tgt = m.target
            net_s = f"NET:{zt(tgt.net)}"
            nlt_s = f"NLT:{zt(tgt.nlt)}"
            mt2 = tgt.mission_type_override or '-'
            alt = f"/{tgt.altitude}" if tgt.altitude else ''
            dmp_s = '/' + '/'.join(f"DMPIID:{d}" for d in tgt.dmp_ids) if tgt.dmp_ids else '/-/-/-/-/-'
            out.append(f"TGTLOC/{tgt.location}/{net_s}/{nlt_s}/{mt2}/-{dmp_s}{alt}//")
        if m.control:
            c = m.control
            parts = []
            if c.primary_freq:   parts.append(f"PFREQ:{c.primary_freq}")
            if c.secondary_freq: parts.append(f"SFREQ:{c.secondary_freq}")
            if c.name:           parts.append(f"NAME:{c.name}")
            out.append(f"CONTROL/{'/'.join(parts)}//")
        if m.refuel:
            r = m.refuel
            tp = []
            if r.net: tp.append(f"NET:{zt(r.net)}")
            if r.nlt: tp.append(f"NLT:{zt(r.nlt)}")
            out.append(f"REFUEL/{r.tanker_callsign}/{r.track}/{r.altitude}/{'/'.join(tp)}//")
        if m.bullseye: out.append(fmt_bullseye(m.bullseye))
        out.append("")
    return '\n'.join(out)

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

HELP = """
ATO Tool — convert Air Tasking Orders between machine and human formats

Commands:
  parse  <input.ato>  [output.yaml]   Parse ATO text -> YAML
  build  <input.yaml> [output.ato]    Build YAML -> ATO machine text
  roundtrip <input.ato>               Parse then rebuild (sanity check)

AE Line semantics:
  AE:11/01/2026 1900Z IRL 0000L INGAME
  - 11/01/2026 1900Z  = real-world mission start (Zulu)  -> irl_date / irl_time_zulu
  - IRL               = flag, preserved as-is
  - 0000L             = in-game clock start (Local)       -> ingame_start_local
  - INGAME            = flag, preserved as-is
"""

def main():
    args = sys.argv[1:]
    if not args or args[0] in ('-h','--help'):
        print(HELP); return
    cmd = args[0]
    if cmd == 'parse':
        src = args[1] if len(args)>1 else None
        dst = args[2] if len(args)>2 else None
        if not src: print("Error: provide input .ato file"); return
        with open(src,'r',encoding='utf-8') as f: text=f.read()
        result = ato_to_yaml(parse_ato(text))
        if dst:
            with open(dst,'w',encoding='utf-8') as f: f.write(result)
            print(f"Written to {dst}")
        else: print(result)
    elif cmd == 'build':
        src = args[1] if len(args)>1 else None
        dst = args[2] if len(args)>2 else None
        if not src: print("Error: provide input .yaml file"); return
        with open(src,'r',encoding='utf-8') as f: text=f.read()
        result = ato_to_machine(yaml_to_ato(text))
        if dst:
            with open(dst,'w',encoding='utf-8') as f: f.write(result)
            print(f"Written to {dst}")
        else: print(result)
    elif cmd == 'roundtrip':
        src = args[1] if len(args)>1 else None
        if not src: print("Error: provide input .ato file"); return
        with open(src,'r',encoding='utf-8') as f: original=f.read()
        print("=== REBUILT ATO ===")
        print(ato_to_machine(parse_ato(original)))
    else:
        print(f"Unknown command: {cmd}"); print(HELP)

if __name__ == '__main__':
    main()
