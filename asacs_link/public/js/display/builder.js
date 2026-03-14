/* ════════════════════════════════════════════════════════════
   display/builder.js — GeoJSON FeatureCollection builders
   for the ASACS LINK tactical map.

   Converts the flat contact array (already coalition-filtered
   by the server) into four FeatureCollections consumed by the
   map render loop:

     buildBlips(contacts)              → Point   (circle layer)
     buildHeadingTicks(contacts, zoom) → Line    (heading tick)
     buildTrails(contacts, history)    → Line    (history trail)
     buildLabels(contacts)             → Point   (data tag)

   Also exports two geometry utility functions used by the
   measuring-line feature in map.js:

     bearingDeg(lat1, lon1, lat2, lon2) → great-circle bearing  0–360°
     distNm(lat1, lon1, lat2, lon2)     → great-circle distance in NM

   Designed with no DOM or Mapbox dependencies so that all
   functions can be imported and unit-tested in Node.js.

   Exposed as:
     • Named ES module exports  — for the Node.js test runner
     • window.AsacsBuilder.*   — for plain <script> consumers
       (map.js accesses this global from within its IIFE)
════════════════════════════════════════════════════════════ */
'use strict';

// ── Coalition colour palette ──────────────────────────────────
// These are the canonical tactical colours for the map.
// DCS coalition IDs: 0 = neutral, 1 = red, 2 = blue.
const COALITION_COLOUR = {
  blue:    '#4fc3f7',
  red:     '#ef5350',
  unknown: '#aaaaaa',
};
const COLN_BLUE = 2;
const COLN_RED  = 1;

// ── Hostile marker colours ────────────────────────────────────
// These colours are used for the ▲ triangle symbol layer in map.js.
// DCS declaration values: 'bandit' = confirmed enemy; 'bogey' / 'hostile' = unidentified bogey.
// Note: 'hostile' here refers to the *colour constant* for bogey/unidentified contacts,
// not to the 'hostile' declaration string itself (which is a DCS IFF result).
const COLOUR_BANDIT  = '#ff4444'; // red   — confirmed enemy (declaration === 'bandit')
const COLOUR_HOSTILE = '#ffb020'; // amber — unidentified bogey / hostile (all other enemy declarations)

/** Maximum position entries kept per contact in the history ring buffer. */
const HISTORY_MAX = 30;

/** Metres per degree of latitude (flat-earth). */
const METERS_PER_DEG_LAT = 111_320;

/** Feet per metre (exact to 5 s.f. — standard aviation conversion). */
const FEET_PER_METER = 3.28084;

/** Knots per metre-per-second (exact). */
const KNOTS_PER_MPS = 1.94384;

/** Metres per nautical mile (exact by definition). */
const METERS_PER_NM = 1852;

// ── Private helpers ───────────────────────────────────────────

/** Map a DCS coalition ID to a display colour string. */
function _coalitionColour(coalitionId) {
  if (coalitionId === COLN_BLUE) return COALITION_COLOUR.blue;
  if (coalitionId === COLN_RED)  return COALITION_COLOUR.red;
  return COALITION_COLOUR.unknown;
}

/**
 * Project (lat, lon) by distM metres in direction hdgDeg (true heading).
 * Returns a GeoJSON [lon, lat] coordinate pair.
 * Uses a flat-earth approximation — accurate enough for tactical ranges.
 *
 * @param {number} lat    Degrees north
 * @param {number} lon    Degrees east
 * @param {number} hdgDeg True heading (0 = north, 90 = east)
 * @param {number} distM  Distance in metres
 * @returns {[number, number]}
 */
function _project(lat, lon, hdgDeg, distM) {
  const hdgRad = hdgDeg * Math.PI / 180;
  const latRad = lat    * Math.PI / 180;
  const dLat = (distM * Math.cos(hdgRad)) / METERS_PER_DEG_LAT;
  const dLon = (distM * Math.sin(hdgRad)) / (METERS_PER_DEG_LAT * Math.cos(latRad));
  return [lon + dLon, lat + dLat];
}

/**
 * Calculate the great-circle initial bearing from point 1 to point 2.
 * Returns degrees in the range 0–360 (0 = north, 90 = east).
 *
 * @param {number} lat1  Start latitude in degrees
 * @param {number} lon1  Start longitude in degrees
 * @param {number} lat2  End latitude in degrees
 * @param {number} lon2  End longitude in degrees
 * @returns {number}  Bearing 0–360°
 */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const x  = Math.sin(Δλ) * Math.cos(φ2);
  const y  = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}

/**
 * Calculate the great-circle distance between two lat/lon positions
 * in nautical miles.  Uses the Haversine formula.
 * Earth radius = 6 371 000 m; 1 NM = 1 852 m (exact).
 *
 * @param {number} lat1  Start latitude in degrees
 * @param {number} lon1  Start longitude in degrees
 * @param {number} lat2  End latitude in degrees
 * @param {number} lon2  End longitude in degrees
 * @returns {number}  Distance in nautical miles
 */
function distNm(lat1, lon1, lat2, lon2) {
  const R  = 6_371_000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ / 2) ** 2 +
             Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / METERS_PER_NM;
}

// ── Builder functions ─────────────────────────────────────────

/**
 * Build the blip FeatureCollection (circle layer for friendly/neutral,
 * triangle symbol layer for hostile/bandit — filtered in the map layer).
 *
 * Each contact with a valid position becomes a Point feature.
 * The `declaration` property lets map layer filter expressions split
 * friendly circles from hostile triangles without a separate source.
 * `isPrimary` (1 or 0) distinguishes primary radar contacts from
 * datalink tracks (smaller, dimmer marker for primaries).
 *
 * @param {object[]} contacts  Coalition-filtered unit array from the server
 * @returns {object}  GeoJSON FeatureCollection
 */
function buildBlips(contacts) {
  const features = [];

  for (const c of contacts) {
    if (c.lat == null || c.lon == null) continue;

    const decl = c.declaration || '';

    features.push({
      type:     'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat, c.alt ?? 0] },
      properties: {
        id:          String(c.id),
        colour:      _coalitionColour(c.coalition),
        isPrimary:   c.contactType === 'primary' ? 1 : 0,
        declaration: decl,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Build the heading-tick FeatureCollection (line layer).
 *
 * Each contact with a known heading gets a short line projected forward
 * from its position.  The tick length is calculated in metres based on
 * the current map zoom so it always spans ~20 screen pixels regardless
 * of the zoom level:
 *
 *   metersPerPixel = 156543.03392 × cos(lat) / 2^zoom
 *   tickLengthM    = 20 × metersPerPixel
 *
 * @param {object[]} contacts  Coalition-filtered unit array
 * @param {number}   zoom      Current Mapbox map zoom level
 * @returns {object}  GeoJSON FeatureCollection
 */
function buildHeadingTicks(contacts, zoom) {
  const features = [];

  for (const c of contacts) {
    if (c.lat == null || c.lon == null || c.hdg == null) continue;

    const metersPerPixel =
      (156543.03392 * Math.cos(c.lat * Math.PI / 180)) /
      Math.pow(2, zoom);
    const tickM = 20 * metersPerPixel;
    const end   = _project(c.lat, c.lon, c.hdg, tickM);
    const alt   = c.alt ?? 0;

    features.push({
      type:     'Feature',
      geometry: { type: 'LineString', coordinates: [[c.lon, c.lat, alt], [end[0], end[1], alt]] },
      properties: {
        id:     String(c.id),
        colour: _coalitionColour(c.coalition),
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Build the trail FeatureCollection (line layer).
 *
 * Contacts with fewer than 2 history positions do not produce a trail
 * feature (a LineString requires ≥ 2 coordinates).
 *
 * @param {object[]} contacts  Coalition-filtered unit array
 * @param {Map<string, Array>} history  Ring buffers keyed by String(contact.id).
 *   Each value is an array of GeoJSON [lon, lat] pairs, oldest first.
 * @returns {object}  GeoJSON FeatureCollection
 */
function buildTrails(contacts, history) {
  const features = [];

  for (const c of contacts) {
    const trail = history.get(String(c.id));
    if (!trail || trail.length < 2) continue;

    features.push({
      type:     'Feature',
      geometry: { type: 'LineString', coordinates: trail.slice() },
      properties: {
        id:     String(c.id),
        colour: _coalitionColour(c.coalition),
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Build the label FeatureCollection (symbol layer).
 *
 * Each contact with a valid position gets a Point feature.  The label
 * text is formatted as up to three newline-separated lines:
 *   1. Callsign  (pilotName → groupName → String(id))
 *   2. Altitude  (flight levels: Math.round(altM × 3.28084 / 100))
 *   3. Speed     (GS in knots, rounded to nearest integer)
 *
 * Primary radar contacts carry no useful annotation so they receive an
 * empty label string; the symbol layer should omit empty labels.
 *
 * If an `offsets` map is provided, any unit ID present in it will have
 * its label placed at a position offset from the unit by [deltaLon, deltaLat]
 * degrees.  The label therefore moves with the unit, preserving the relative
 * declutter offset even as the unit moves.  Pass an empty Map or omit the
 * argument for default positioning (label placed at the unit's own position).
 *
 * @param {object[]} contacts  Coalition-filtered unit array
 * @param {Map<string, [number,number]>} [offsets]  Per-unit delta offsets [dLon, dLat] keyed by String(id)
 * @returns {object}  GeoJSON FeatureCollection
 */
function buildLabels(contacts, offsets) {
  const features = [];

  for (const c of contacts) {
    if (c.lat == null || c.lon == null) continue;

    let label = '';
    if (c.contactType !== 'primary') {
      const callsign = c.pilotName || c.groupName || String(c.id);
      const altLine  = c.alt != null
        ? `FL${Math.round(c.alt * FEET_PER_METER / 100)}`
        : '';
      const spdLine  = c.gs  != null
        ? `${c.gs}kt`
        : (c.spd != null ? `${Math.round(c.spd * KNOTS_PER_MPS)}kt` : '');
      label = [callsign, altLine, spdLine].filter(Boolean).join('\n');
    }

    // Apply relative delta offset when the user has dragged this label
    const delta = offsets && offsets.get(String(c.id));
    const lon = delta ? c.lon + delta[0] : c.lon;
    const lat = delta ? c.lat + delta[1] : c.lat;

    features.push({
      type:     'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat, c.alt ?? 0] },
      properties: {
        id:        String(c.id),
        label,
        hasOffset: delta ? 1 : 0,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Build the leader-line FeatureCollection (line layer).
 *
 * For every contact that has a dragged label (i.e. an entry in `offsets`),
 * produces a short LineString from the unit's actual position to the label's
 * geographic position (unit position + delta).  Contacts with no offset
 * produce no feature, keeping the layer empty until the operator declutters.
 *
 * @param {object[]} contacts  Coalition-filtered unit array
 * @param {Map<string, [number,number]>} offsets  Per-unit delta offsets [dLon, dLat]
 * @returns {object}  GeoJSON FeatureCollection
 */
function buildLeaderLines(contacts, offsets) {
  const features = [];

  if (!offsets || !offsets.size) return { type: 'FeatureCollection', features };

  for (const c of contacts) {
    if (c.lat == null || c.lon == null) continue;

    const delta = offsets.get(String(c.id));
    if (!delta) continue;

    const alt = c.alt ?? 0;
    features.push({
      type:     'Feature',
      geometry: {
        type:        'LineString',
        coordinates: [
          [c.lon,            c.lat,            alt],
          [c.lon + delta[0], c.lat + delta[1], alt],
        ],
      },
      properties: {
        id:     String(c.id),
        colour: _coalitionColour(c.coalition),
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

// ── Export ────────────────────────────────────────────────────

// Browser: expose as a named global accessible from plain <script> tags.
// This runs when the file is loaded as <script type="module">.
if (typeof window !== 'undefined') {
  window.AsacsBuilder = {
    buildBlips, buildHeadingTicks, buildTrails, buildLabels, buildLeaderLines,
    bearingDeg, distNm,
    HISTORY_MAX, COLOUR_BANDIT, COLOUR_HOSTILE,
  };
}

// Node.js / ESM: named exports for the test runner.
export {
  buildBlips, buildHeadingTicks, buildTrails, buildLabels, buildLeaderLines,
  bearingDeg, distNm,
  HISTORY_MAX, COLOUR_BANDIT, COLOUR_HOSTILE,
};
