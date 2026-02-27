/**
 * filter.js
 *
 * Applies realism-based filtering to units before sending to a client.
 *
 * Rules:
 *   Friendly  → full datalink picture (all fields)
 *   Hostile   → position + altitude + squawk only, type = UNKNOWN
 *   Neutral   → position + altitude + squawk only, type = UNKNOWN
 *   Admin     → sees everything unfiltered (all coalitions, all fields)
 *
 * The coalition mapping in DCS:
 *   0 = Neutral
 *   1 = Red
 *   2 = Blue
 */

import config from './config.js';

const COALITION_ID = {
  neutral: 0,
  red:     1,
  blue:    2,
};

/**
 * Given a flat array of all units and a client coalition string,
 * returns a filtered + scrubbed array of unit objects.
 *
 * @param {Map<string|number, object>} unitsMap
 * @param {string} clientCoalition  'blue' | 'red' | 'neutral' | 'admin'
 * @returns {object[]}
 */
export function filterUnitsForCoalition(unitsMap, clientCoalition) {
  const result = [];

  for (const unit of unitsMap.values()) {
    const relationship = getRelationship(unit.coalition, clientCoalition);
    const scrubbed = scrubUnit(unit, relationship);
    if (scrubbed) result.push(scrubbed);
  }

  return result;
}

/**
 * Determines the relationship between a unit's coalition and the client.
 * @returns {'friendly' | 'hostile' | 'neutral' | 'admin'}
 */
function getRelationship(unitCoalitionId, clientCoalition) {
  if (clientCoalition === 'admin') return 'admin';

  const clientId = COALITION_ID[clientCoalition];

  if (unitCoalitionId === COALITION_ID.neutral) return 'neutral';
  if (unitCoalitionId === clientId)             return 'friendly';
  return 'hostile';
}

/**
 * Applies field-level scrubbing based on relationship rules.
 * Returns null if unit should be hidden entirely (future: radar coverage check).
 *
 * @param {object} unit        Raw unit from state
 * @param {string} relationship
 * @returns {object|null}
 */
function scrubUnit(unit, relationship) {
  // Admin sees raw data
  if (relationship === 'admin') {
    return { ...unit, _rel: 'admin' };
  }

  const rules = config.realism[relationship];
  if (!rules) return null;

  const out = {
    id:         unit.id,
    coalition:  unit.coalition,  // always include coalition ID
    _rel:       relationship,    // hint to client for coloring
  };

  if (rules.showPosition) {
    out.lat = unit.lat;
    out.lon = unit.lon;
  }

  if (rules.showAltitude) {
    out.alt = unit.alt; // meters ASL
  }

  if (rules.showSpeed) {
    out.spd = unit.spd; // m/s
  }

  if (rules.showHeading) {
    out.hdg = unit.hdg; // degrees true
  }

  if (rules.showType) {
    out.type     = unit.type;
    out.typeName = unit.typeName;
    out.category = unit.category; // Air / Ground / Sea / etc.
  } else {
    out.type     = 'UNKNOWN';
    out.typeName = 'UNKNOWN';
    out.category = unit.category; // Keep category (air vs ground is radar-visible)
  }

  if (rules.showSquawk) {
    out.squawk = unit.squawk ?? null;
  }

  out.iffResolved = rules.iffResolved;

  // Pilot name only for friendly — other pilots are anonymous in real datalink
  if (relationship === 'friendly') {
    out.pilotName = unit.pilotName ?? null;
    out.groupName = unit.groupName ?? null;
  }

  return out;
}
