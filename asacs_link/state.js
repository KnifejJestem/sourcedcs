/**
 * state.js
 *
 * In-memory state store for all DCS world data.
 * Units are stored by their DCS unit ID for O(1) updates.
 *
 * The DCS hook sends a full unit list each tick.
 * We do a diff-merge: add new, update existing, remove stale.
 */

const STALE_THRESHOLD_MS = 10_000; // remove units not seen for 10s

export class StateStore {
  constructor() {
    /** @type {Map<number|string, object>} */
    this._units = new Map();

    /** @type {object|null} */
    this._mission = null;
  }

  // ─── Units ──────────────────────────────────────────────────────────────────

  /**
   * Merges a batch of unit updates from the DCS hook.
   * Each unit must have at minimum: { id, lat, lon, coalition }
   *
   * @param {object[]} units
   */
  updateUnits(units) {
    const now = Date.now();
    const seenIds = new Set();

    for (const unit of units) {
      if (unit.id == null) continue;

      seenIds.add(unit.id);
      this._units.set(unit.id, {
        ...unit,
        _lastSeen: now,
      });
    }

    // Remove units that were not in this update and are stale
    for (const [id, unit] of this._units) {
      if (!seenIds.has(id) && now - unit._lastSeen > STALE_THRESHOLD_MS) {
        this._units.delete(id);
      }
    }
  }

  /**
   * Returns the raw units map (all coalitions, all fields).
   * @returns {Map<number|string, object>}
   */
  getAllUnits() {
    return this._units;
  }

  unitCount() {
    return this._units.size;
  }

  // ─── Mission ────────────────────────────────────────────────────────────────

  updateMission(data) {
    this._mission = data;
  }

  getMission() {
    return this._mission;
  }

  getMissionName() {
    return this._mission?.name ?? null;
  }

  // ─── Clear (sim stop) ───────────────────────────────────────────────────────

  clear() {
    this._units.clear();
    this._mission = null;
  }
}
