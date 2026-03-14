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
 * Computes the tactical declaration for a unit.
 *
 * friendly → the unit is on our side (same coalition)
 * neutral  → the unit belongs to a neutral party
 * bandit   → confirmed hostile track (full radar data available)
 * bogey    → unidentified contact (hostile coalition but primary contact only,
 *             or relationship unknown)
 *
 * @param {string} relationship  'friendly'|'hostile'|'neutral'|'admin'
 * @param {string} contactType   'track'|'primary'
 * @returns {string}  declaration string
 */
function computeDeclaration(relationship, contactType) {
  switch (relationship) {
    case 'friendly': return 'friendly';
    case 'neutral':  return 'neutral';
    case 'hostile':
      // A hostile with full track data (position, alt, heading, speed) is a
      // confirmed bandit.  A position-only contact is an unidentified bogey.
      return contactType === 'track' ? 'bandit' : 'bogey';
    default: return 'bogey';
  }
}

/**
 * Compute declaration for an admin view based on unit coalition.
 * Admin sees everything from a neutral God's-eye perspective, so declarations
 * are assigned by coalition rather than by relationship.
 */
function computeAdminDeclaration(unitCoalition, contactType) {
  if (unitCoalition === COALITION_ID.blue)    return 'friendly';
  if (unitCoalition === COALITION_ID.neutral)  return 'neutral';
  if (unitCoalition === COALITION_ID.red)
    return contactType === 'track' ? 'bandit' : 'bogey';
  return 'bogey';
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
  const contactType = unit._sim?.contactType ?? 'primary';

  // Admin sees raw data plus all simulation-derived fields.
  if (relationship === 'admin') {
    return {
      ...unit,
      _rel:        'admin',
      contactType,
      declaration: computeAdminDeclaration(unit.coalition, contactType),
      gs:          unit._sim?.gs  ?? null,
      cas:         unit._sim?.cas ?? null,
    };
  }

  const rules = config.realism[relationship];
  if (!rules) return null;

  const out = {
    id:         unit.id,
    coalition:  unit.coalition,  // always include coalition ID
    _rel:       relationship,    // hint to client for coloring
    contactType,
    declaration: computeDeclaration(relationship, contactType),
  };

  if (rules.showPosition) {
    out.lat = unit.lat;
    out.lon = unit.lon;
  }

  if (rules.showAltitude) {
    out.alt = unit.alt; // meters ASL (true altitude for now)
  }

  if (rules.showSpeed) {
    out.spd = unit.spd; // m/s (raw DCS field, kept for PROF table back-compat)
    out.gs  = unit._sim?.gs  ?? null; // knots
    out.cas = unit._sim?.cas ?? null; // knots
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
