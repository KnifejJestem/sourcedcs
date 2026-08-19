/* ---- turn a parsed weapon table into the parameters the sim needs ---- */

import { parseLuaTables } from './lua-parser.js';

function num(v) { return typeof v === 'number' && isFinite(v) ? v : undefined; }
function pick() {
  for (let i = 0; i < arguments.length; i++) {
    const v = num(arguments[i]);
    if (v !== undefined) return v;
  }
  return undefined;
}
function numArray(v) {
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'number')) return v;
  if (v && Array.isArray(v.__array) && v.__array.every((x) => typeof x === 'number')) return v.__array;
  return undefined;
}

export function extractMissile(tbl, fallbackLabel) {
  const w = tbl || {};
  const fm = w.fm || {};
  // Some weapon packs name the guidance sub-table `ap` instead of
  // `autopilot` (observed in the AircraftWeaponPack R-27 family) --
  // check both rather than silently reading from an empty object.
  const ap = w.autopilot || w.ap || {};
  const boost = w.boost || {};
  const march = w.march || {};
  const sensor = w.sensor || {};
  const fuze = w.proximity_fuze || {};

  const warnings = [];
  const notes = [];

  const cx0 = numArray(fm.Cx0);
  const mass = pick(w.M, fm.mass);
  const sRef = pick(fm.S);

  const missing = [];
  if (!cx0) missing.push('fm.Cx0 (drag table)');
  if (mass === undefined) missing.push('M / fm.mass');
  if (sRef === undefined) missing.push('fm.S (reference area)');
  if (missing.length) {
    return { error: 'Cannot simulate this weapon: missing ' + missing.join(', ') + '.' };
  }

  const boostTime = pick(boost.work_time) || 0;
  const marchTime = pick(march.work_time) || 0;
  const burnTime = boostTime + marchTime;
  const fuel = (pick(boost.fuel_mass) || 0) + (pick(march.fuel_mass) || 0);

  // `impulse` is SPECIFIC impulse (Isp, seconds), not total impulse in N*s.
  // Thrust = Isp * g0 * mdot for each stage; if a stage is missing impulse
  // or work_time it's simply inert (as the AIM-120C's boost stage is).
  const G0 = 9.80665;
  const stages = [
    { isp: pick(boost.impulse) || 0, fuel: pick(boost.fuel_mass) || 0, workTime: boostTime },
    { isp: pick(march.impulse) || 0, fuel: pick(march.fuel_mass) || 0, workTime: marchTime }
  ];
  if (burnTime > 0 && stages.every((st) => st.isp === 0)) {
    notes.push('No usable impulse (Isp) field on either stage: motor thrust will be ' +
               'calibrated to reach Mach_max instead, since there is nothing to derive it from.');
  }

  let machMax = pick(w.Mach_max);
  if (machMax === undefined) {
    machMax = 4.0;
    warnings.push('No Mach_max: assumed 4.0 for the thrust calibration.');
  }

  let machStep = pick(fm.table_scale);
  if (machStep === undefined) {
    machStep = 0.2;
    notes.push('No fm.table_scale; assumed the Cx0 table steps every 0.2 Mach.');
  } else {
    notes.push('Cx0 table read at ' + machStep + ' Mach per entry (from fm.table_scale).');
  }

  // Whether this missile lofts AT ALL is a separate question from what
  // angle it uses. Some dialects (the R-27 family's `ap` table, observed
  // directly) have no loft-related fields anywhere and no top-level
  // `loft` flag either -- that's a real "this missile doesn't loft"
  // signal, not a naming gap, and shouldn't produce a "loft angle
  // assumed" warning for an angle that's never actually used.
  const loftFlag = pick(w.loft, ap.loft_active);
  const loftEnabled = loftFlag === 1;

  let loftAngle = 30 * Math.PI / 180;   // placeholder; irrelevant unless loftEnabled
  let loftOff;
  if (loftEnabled) {
    const loftSin = pick(ap.loft_sin);
    if (loftSin !== undefined && Math.abs(loftSin) <= 1) {
      loftAngle = Math.asin(loftSin);
    } else {
      warnings.push('Loft is enabled (loft=1) but no loft_sin field: loft angle assumed 30 deg.');
    }
    loftOff = pick(ap.loft_off_range);
    if (loftOff === undefined) {
      warnings.push('Loft is enabled (loft=1) but no loft_off_range field: loft has been ' +
        'disabled for this weapon rather than risk it climbing for the whole motor burn ' +
        'with nothing to hand off to terminal guidance.');
    }
  } else {
    notes.push('No loft flag (loft=1 / loft_active) found anywhere in the table: ' +
      'this weapon is modeled without a loft phase.');
  }
  const lofts = loftEnabled && loftOff !== undefined;

  let gLoad = pick(ap.gload_limit, w.Nr_max);
  if (gLoad === undefined) { gLoad = 30; warnings.push('No gload_limit: assumed 30 g.'); }

  let tc = pick(ap.Tc);
  if (tc === undefined) { tc = 0.06; warnings.push('No Tc field: assumed 0.06 s.'); }

  let knav = pick(ap.Knav, w.PN_gain);
  if (knav === undefined) { knav = 4; warnings.push('No Knav / PN_gain: assumed 4.'); }

  let vMin = pick(w.v_min);
  if (vMin === undefined) { vMin = 140; warnings.push('No v_min: assumed 140 m/s.'); }

  let lifeTime = pick(w.Life_Time);
  if (lifeTime === undefined) { lifeTime = 90; warnings.push('No Life_Time: assumed 90 s.'); }

  let killRadius = pick(fuze.radius, w.KillDistance);
  if (killRadius === undefined) { killRadius = 15; warnings.push('No fuze radius: assumed 15 m.'); }

  // Seeker ranges. Which field is "activation" is not documented, so both
  // candidates are surfaced rather than one being silently chosen.
  const seekerFar = pick(sensor.sens_far_dist);
  // active_radar_lock_dist, where present, is an unambiguous seeker-active
  // range -- confirmed against a real table where it and D_max badly
  // disagree (15 km vs 60 km); D_max there is clearly some other concept
  // (fire-control-solution range, matching the scale of Range_max, not a
  // seeker range). Prefer it; fall back to D_max only when it's absent.
  const seekerActive = pick(w.active_radar_lock_dist, w.D_max);
  const seekerActiveIsExact = pick(w.active_radar_lock_dist) !== undefined;
  const seekerDelay = pick(sensor.delay) || 0;
  if (seekerFar === undefined && seekerActive === undefined) {
    notes.push('No seeker range fields found, so no activation marker is drawn.');
  } else if (seekerActive !== undefined && !seekerActiveIsExact) {
    notes.push('Seeker-active range read from D_max (' + seekerActive +
      ' m) since no active_radar_lock_dist field was present -- D_max\'s exact ' +
      'meaning is not documented and may not be a seeker range for this weapon.');
  }

  if (burnTime <= 0) {
    warnings.push('No motor burn time found (boost/march work_time): the missile ' +
                  'will be simulated as unpowered.');
  }
  if (fuel <= 0 && burnTime > 0) {
    notes.push('Motor burn time present but zero fuel mass, so mass is held constant.');
  }

  const name = (typeof w.display_name === 'string' && w.display_name) ||
               (typeof w.user_name === 'string' && w.user_name) ||
               (typeof w.name === 'string' && w.name) ||
               fallbackLabel || 'unnamed weapon';

  return {
    name,
    className: typeof w.class_name === 'string' ? w.class_name : null,
    mass, sRef, cx0, machStep, machMax,
    vMin, lifeTime, burnTime, fuel, stages,
    loftAngle, loftOffRange: lofts ? loftOff : null,
    gLoad, tc, knav, killRadius,
    seekerFar: seekerFar === undefined ? null : seekerFar,
    seekerActive: seekerActive === undefined ? null : seekerActive,
    seekerDelay,
    rangeMaxField: pick(w.Range_max) || null,
    warnings, notes
  };
}

// Converts one of this app's own weapon JSON files (data/weapons/*.json --
// already SI/radian-shaped, unlike a raw DCS Lua table) into the same
// missile object shape extractMissile() produces, so both a built-in weapon
// and a parsed .lua one are interchangeable everywhere downstream. `loftSin`
// mirrors the DCS ap.loft_sin convention and is converted to radians here.
export function missileFromJson(d) {
  return {
    name: d.name,
    className: d.className,
    mass: d.mass, sRef: d.sRef,
    cx0: d.cx0, machStep: d.machStep, machMax: d.machMax,
    vMin: d.vMin, lifeTime: d.lifeTime, burnTime: d.burnTime, fuel: d.fuel,
    stages: d.stages,
    loftAngle: Math.asin(d.loftSin), loftOffRange: d.loftOffRange,
    gLoad: d.gLoad, tc: d.tc, knav: d.knav, killRadius: d.killRadius,
    seekerFar: d.seekerFar, seekerActive: d.seekerActive, seekerDelay: d.seekerDelay,
    rangeMaxField: d.rangeMaxField,
    warnings: [], notes: []
  };
}

export function looksLikeWeapon(t) {
  return !!(t && typeof t === 'object' && !Array.isArray(t) &&
            (t.fm || t.M !== undefined || t.Mach_max !== undefined));
}

/**
 * Some weapon packs wrap the real spec one (or more) levels deep --
 * observed in the wild as matching `client`/`server` sub-tables holding
 * near-identical copies of the same missile (client-side and server-side
 * authoritative values, occasionally diverging on balance-relevant
 * fields). A top-level-only check silently finds nothing for these files,
 * which is worse than an error: nothing signals that anything went wrong.
 * This walks into plain object sub-tables (not arrays, to avoid wasting
 * time on things like ModelData or shape_table_data) up to a shallow
 * depth looking for anything weapon-shaped, tagging each hit with the
 * key path that led to it.
 */
export function findWeaponTables(table, label, depth) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) return [];
  if (looksLikeWeapon(table)) return [{ label, table }];
  if (depth <= 0) return [];
  let hits = [];
  for (const key of Object.keys(table)) {
    if (key === '__array') continue;
    hits = hits.concat(findWeaponTables(table[key], label + '.' + key, depth - 1));
  }
  return hits;
}

// A small fingerprint of the fields the simulator actually depends on --
// used only to decide whether two sibling matches (e.g. .client vs
// .server) are genuinely the same weapon worth collapsing to one entry,
// not to assume any particular wrapper naming convention.
function weaponFingerprint(t) {
  const fm = t.fm || {}, boost = t.boost || {}, march = t.march || {};
  return JSON.stringify({
    M: t.M, Mach_max: t.Mach_max, Range_max: t.Range_max, D_max: t.D_max,
    fmS: fm.S, fmMass: fm.mass, cx0: fm.Cx0,
    boostImpulse: boost.impulse, boostFuel: boost.fuel_mass, boostWork: boost.work_time,
    marchImpulse: march.impulse, marchFuel: march.fuel_mass, marchWork: march.work_time
  });
}

export function parseWeaponFile(src) {
  const tables = parseLuaTables(src);
  let candidates = [];
  for (const { label, table } of tables) {
    candidates = candidates.concat(findWeaponTables(table, label, 3));
  }

  // Group by fingerprint so byte-identical sibling copies (client/server
  // duplication) collapse to a single entry instead of listing the same
  // missile twice; genuinely differing copies are kept separately and
  // flagged, since that divergence (e.g. a server-side balance tweak)
  // might matter to the person loading the file.
  const groups = new Map();
  for (const c of candidates) {
    const fp = weaponFingerprint(c.table);
    if (!groups.has(fp)) groups.set(fp, []);
    groups.get(fp).push(c);
  }

  const out = [];
  for (const group of groups.values()) {
    const first = group[0];
    const m = extractMissile(first.table, first.label);
    if (group.length > 1) {
      const others = group.slice(1).map((g) => g.label).join(', ');
      m.notes.push('Identical copy also found at: ' + others +
        ' -- shown once rather than listed twice.');
    }
    out.push({ label: first.label, missile: m });
  }

  // If entries share a display name but weren't byte-identical, that's a
  // genuine divergence worth surfacing rather than silently picking one.
  const byName = new Map();
  for (const { label, missile } of out) {
    if (!byName.has(missile.name)) byName.set(missile.name, []);
    byName.get(missile.name).push(label);
  }
  for (const { missile } of out) {
    const labels = byName.get(missile.name);
    if (labels.length > 1) {
      missile.warnings.push('Multiple non-identical copies of "' + missile.name +
        '" found in this file (' + labels.join(', ') +
        ') -- values differ between them (e.g. client vs server balance). ' +
        'This entry is only one of those copies.');
    }
  }

  return out;
}
