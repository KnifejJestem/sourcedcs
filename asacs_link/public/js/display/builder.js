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

   Designed with no DOM or Mapbox dependencies so that all
   four functions can be imported and unit-tested in Node.js.

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

/** Maximum position entries kept per contact in the history ring buffer. */
const HISTORY_MAX = 30;

/** Metres per degree of latitude (flat-earth). */
const METERS_PER_DEG_LAT = 111_320;

/** Feet per metre (exact to 5 s.f. — standard aviation conversion). */
const FEET_PER_METER = 3.28084;

/** Knots per metre-per-second (exact). */
const KNOTS_PER_MPS = 1.94384;

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

// ── Builder functions ─────────────────────────────────────────

/**
 * Build the blip FeatureCollection (circle layer).
 *
 * Each contact with a valid position becomes a Point feature.
 * Colour is determined by DCS coalition ID.
 * `isPrimary` (1 or 0) lets the Mapbox paint expression distinguish
 * primary radar contacts (smaller, dimmer) from datalink tracks.
 *
 * @param {object[]} contacts  Coalition-filtered unit array from the server
 * @returns {object}  GeoJSON FeatureCollection
 */
function buildBlips(contacts) {
  const features = [];

  for (const c of contacts) {
    if (c.lat == null || c.lon == null) continue;

    features.push({
      type:     'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: {
        id:        String(c.id),
        colour:    _coalitionColour(c.coalition),
        isPrimary: c.contactType === 'primary' ? 1 : 0,
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

    features.push({
      type:     'Feature',
      geometry: { type: 'LineString', coordinates: [[c.lon, c.lat], end] },
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
 * @param {object[]} contacts  Coalition-filtered unit array
 * @returns {object}  GeoJSON FeatureCollection
 */
function buildLabels(contacts) {
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

    features.push({
      type:     'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: {
        id:    String(c.id),
        label,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

// ── Export ────────────────────────────────────────────────────

// Browser: expose as a named global accessible from plain <script> tags.
// This runs when the file is loaded as <script type="module">.
if (typeof window !== 'undefined') {
  window.AsacsBuilder = { buildBlips, buildHeadingTicks, buildTrails, buildLabels, HISTORY_MAX };
}

// Node.js / ESM: named exports for the test runner.
export { buildBlips, buildHeadingTicks, buildTrails, buildLabels, HISTORY_MAX };
