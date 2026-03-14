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

export class SimulationEngine {
  /**
   * @param {import('./transponder.js').TransponderReceiver} transponder
   */
  constructor(transponder) {
    this._transponder = transponder;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Process a Map of raw units from StateStore.
   *
   * Returns an array of processed unit objects.  Each object is a copy of the
   * raw unit with additional simulation fields attached under a `_sim` key so
   * that the display layer can distinguish DCS data from derived data.
   *
   * @param {Map<number|string, object>} rawUnits  From StateStore.getAllUnits()
   * @returns {object[]}  Processed units ready for coalition filtering + broadcast
   */
  process(rawUnits) {
    const result = [];

    for (const unit of rawUnits.values()) {
      const processed = { ...unit, _sim: {} };

      this._attachTransponderData(processed);
      this._simulateIndicatedAltitude(processed);
      this._simulateMagneticHeading(processed);
      // Future: this._simulateLineOfSight(processed);
      // Future: this._simulateTransponderFrequency(processed);

      result.push(processed);
    }

    return result;
  }

  // ── Simulation steps ───────────────────────────────────────────────────────

  /**
   * Step 1 — Transponder / IFF data.
   *
   * Matches a unit to live transponder data received from the SRS UDP feed
   * (port 10712) by pilot name.  On a match the IFF fields are merged directly
   * onto the unit so downstream coalition filtering can use them.
   */
  _attachTransponderData(unit) {
    if (!unit.pilotName) return;

    const iff = this._transponder.getIff(unit.pilotName);
    if (!iff) return;

    // Prefer live IFF mode3 over the derived pseudo-squawk when available.
    if (iff.mode3 != null) unit.squawk     = iff.mode3;
    if (iff.status != null) unit._sim.iffStatus = iff.status;
  }

  /**
   * Step 2 — Indicated Altitude (STUB).
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
   * Step 3 — Magnetic Heading (STUB).
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
