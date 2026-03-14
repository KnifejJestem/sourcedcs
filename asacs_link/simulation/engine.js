/**
 * simulation/engine.js
 *
 * The ASACS LINK Simulation Engine.
 *
 * This module is the single hand-off point between raw DCS data and the
 * display layer.  It receives raw unit data (from DCS via file polling) and
 * supplemental data (IFF from the transponder receiver), runs any active
 * simulations, and returns a processed unit array that the server broadcasts
 * to WebSocket clients.
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 *
 *   DCS Files ──► StateStore ──► SimulationEngine.process() ──► broadcast
 *                                       ▲
 *                TransponderReceiver ───┘
 *
 * ── Simulation slots (future expansion) ─────────────────────────────────────
 *
 * Each slot below is a clearly labelled extension point.  Add the
 * implementation inside its function; the surrounding structure stays stable.
 *
 *   • Indicated Altitude  — true altitude → indicated altitude using temperature
 *                           and altimeter setting (ISA deviation / Kollsman)
 *   • Magnetic Heading    — true heading → magnetic heading using local
 *                           magnetic declination (e.g. WMM model)
 *   • Line-of-Sight       — radar/optical LOS check between units and GCI sites
 *   • Transponder Freq    — actual frequency simulation when SRS exposes it
 *   • Time                — mission-elapsed / Zulu time computations
 */

/** Number of valid 4-digit octal squawk codes (0000–7777 = 0–4095 decimal). */
const SQUAWK_MODULO = 4096;

/**
 * DCS unit category strings that represent ground-based units.
 * These are filtered out of the display picture — only aircraft and ships
 * are tracked by the GCI radar picture.
 */
const GROUND_CATEGORIES = new Set([
  'ground units',
  'ground',
  'structures',
  'static',
]);

/**
 * Compute the great-circle distance in metres between two lat/lon positions
 * using the Haversine formula.  Accurate to within ~0.3% for tactical ranges.
 *
 * @param {number} lat1  Degrees north
 * @param {number} lon1  Degrees east
 * @param {number} lat2  Degrees north
 * @param {number} lon2  Degrees east
 * @returns {number}  Distance in metres
 */
function _haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6_371_000; // Earth mean radius in metres
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class SimulationEngine {
  /**
   * @param {import('./transponder.js').TransponderReceiver} transponder
   */
  constructor(transponder) {
    this._transponder = transponder;

    /**
     * Previous position snapshot keyed by unit ID.
     * Used to derive groundspeed from successive position fixes.
     * @type {Map<number|string, {lat: number, lon: number, ts: number}>}
     */
    this._prevPositions = new Map();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Process a Map of raw units from StateStore.
   *
   * Returns an array of processed unit objects.  Each object is a copy of the
   * raw unit with additional simulation fields attached under a `_sim` key so
   * that the display layer can distinguish DCS data from derived data.
   *
   * Ground units and structures are excluded: the GCI radar picture only
   * shows airborne contacts and ships.
   *
   * @param {Map<number|string, object>} rawUnits  From StateStore.getAllUnits()
   * @returns {object[]}  Processed units ready for coalition filtering + broadcast
   */
  process(rawUnits) {
    const result = [];
    const activeIds = new Set();

    for (const unit of rawUnits.values()) {
      // Filter out ground units and structures — only aircraft and ships
      // are part of the GCI radar picture.
      const cat = (unit.category || '').toLowerCase().trim();
      if (GROUND_CATEGORIES.has(cat)) continue;

      activeIds.add(unit.id);
      const processed = { ...unit, _sim: {} };

      this._assignSquawk(processed);
      this._classifyContact(processed);
      this._computeSpeeds(processed);
      this._simulateIndicatedAltitude(processed);
      this._simulateMagneticHeading(processed);
      // Future: this._simulateLineOfSight(processed);
      // Future: this._simulateTransponderFrequency(processed);

      result.push(processed);
    }

    // Purge position history for units no longer in the picture
    for (const id of this._prevPositions.keys()) {
      if (!activeIds.has(id)) this._prevPositions.delete(id);
    }

    return result;
  }

  // ── Simulation steps ───────────────────────────────────────────────────────

  /**
   * Step 1 — Squawk / transponder assignment.
   *
   * For player-controlled units the squawk comes exclusively from the SRS
   * transponder feed (UDP port 10712).  If a pilot has no active SRS entry
   * the squawk is left unset.
   *
   * For AI units (no pilotName) the simulation generates a stable squawk
   * derived from the unit ID (id mod 4096) so every AI track carries a
   * deterministic, unique-enough code without requiring external input.
   */
  _assignSquawk(unit) {
    if (unit.pilotName) {
      // Player unit — source squawk exclusively from the SRS transponder feed.
      const iff = this._transponder.getIff(unit.pilotName);
      if (iff) {
        if (iff.mode3  != null) unit.squawk         = iff.mode3;
        if (iff.status != null) unit._sim.iffStatus = iff.status;
      }
      // No SRS entry → squawk remains unset; display layer treats it as absent.
    } else {
      // AI unit — generate a stable squawk from the unit ID.
      unit.squawk = unit.id % SQUAWK_MODULO;
    }
  }

  /**
   * Step 2 — Contact classification.
   *
   * Classifies each unit as a 'track' (full data: position, altitude, heading,
   * speed) or a 'primary' radar contact (position only — no further data).
   *
   * The actual simulation/sensor logic that decides what is visible will be
   * implemented later.  For now the rule is simple: if the raw DCS data
   * includes lat, lon, alt, hdg, and spd the unit becomes a track; otherwise
   * it is treated as a primary radar contact.
   */
  _classifyContact(unit) {
    const hasFullData =
      unit.lat != null && unit.lon != null &&
      unit.alt != null &&
      unit.hdg != null &&
      unit.spd != null;
    unit._sim.contactType = hasFullData ? 'track' : 'primary';
  }

  /**
   * Step 3 — Speed outputs: Ground Speed (GS) and Calibrated Airspeed (CAS).
   *
   * DCS does not reliably expose groundspeed, so GS is derived from successive
   * position fixes using the Haversine formula:
   *
   *   GS = distance(prev_pos, cur_pos) / time_elapsed
   *
   * On the first fix for a unit there is no previous position, so GS is null
   * until the next tick.  If position data is unavailable the raw DCS speed
   * field is used as a fallback (m/s → knots).
   *
   * CAS is a stub — proper CAS requires atmospheric data (temperature,
   * QNH/pressure altitude).  For now CAS = GS as a placeholder.
   *
   * Both values are emitted in knots so the display layer can show them
   * directly without unit conversion.
   */
  _computeSpeeds(unit) {
    const now = Date.now();

    if (unit.lat != null && unit.lon != null) {
      const prev = this._prevPositions.get(unit.id);

      if (prev) {
        const dtSec = (now - prev.ts) / 1000;
        // 100 ms minimum between fixes: DCS exports at ~10 Hz so consecutive
        // fixes are ≥100 ms apart under normal conditions.  This guard also
        // prevents division-by-near-zero from clock jitter on the first tick.
        if (dtSec >= 0.1) {
          const distM = _haversineMeters(prev.lat, prev.lon, unit.lat, unit.lon);
          const knots = (distM / dtSec) * 1.94384; // m/s → knots
          unit._sim.gs  = Math.round(knots);
          unit._sim.cas = Math.round(knots); // Stub: CAS = GS until atmosphere simulation is wired in
        }
      }

      // Update position history for the next tick
      this._prevPositions.set(unit.id, { lat: unit.lat, lon: unit.lon, ts: now });
    }

    // Fall back to raw DCS speed when no position-derived GS is available
    if (unit._sim.gs == null) {
      if (unit.spd != null) {
        const knots     = unit.spd * 1.94384;
        unit._sim.gs    = Math.round(knots);
        unit._sim.cas   = Math.round(knots);
      } else {
        unit._sim.gs  = null;
        unit._sim.cas = null;
      }
    }
  }

  /**
   * Step 4 — Indicated Altitude (STUB).
   *
   * TODO: Convert true altitude (ASL, metres) to indicated altitude using
   * local temperature and altimeter setting (Kollsman window / QNH).
   * Formula: ISA standard lapse rate correction + temperature deviation.
   *
   * Inputs to add: mission weather data (temperature, QNH per zone).
   * Output: unit._sim.indicatedAlt (feet or metres, TBD by display preference).
   */
  _simulateIndicatedAltitude(unit) {
    // Placeholder — passthrough until weather data is wired in.
    unit._sim.indicatedAlt = null;
  }

  /**
   * Step 5 — Magnetic Heading (STUB).
   *
   * TODO: Convert true heading (degrees) to magnetic heading by applying
   * the local magnetic declination.  Use a WMM or simplified lookup table
   * keyed by theatre (e.g. Caucasus ≈ 5°E, Syria ≈ 3°E).
   *
   * Inputs to add: theatre name from mission data.
   * Output: unit._sim.magHdg (degrees magnetic).
   */
  _simulateMagneticHeading(unit) {
    // Placeholder — passthrough until declination table is added.
    unit._sim.magHdg = null;
  }
}
