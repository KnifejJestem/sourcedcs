// ═══════════════════════════════════════════════════════════
// map-main.js — MAP tab entry point + shared SVG helpers
//
// The helpers defined here are used throughout map-draw-*.js.
// They load last but are only called inside drawMap() which
// runs after all scripts are ready, so timing is not an issue.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── SVG element helpers ────────────────────────────────────

// Create an SVG element in the SVG namespace.
function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

// Set multiple SVG attributes at once.  Returns the element for chaining.
function svgSet(el, attrs) {
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}

// Create an SVG element and set its attributes in one call.
function makeSvgEl(tag, attrs) { return svgSet(svgEl(tag), attrs); }

// Create an SVG <text> element, set attributes, and set text content.
function svgText(text, attrs) {
  const t = makeSvgEl('text', attrs);
  t.textContent = text;
  return t;
}

async function renderMAP(ato) {
  const container = document.getElementById('map-container');
  container.innerHTML = '<div class="map-no-coords">Loading map data...</div>';

  const geoData = await loadGeoData();

  const aco = STATE.pkg?.aco || null;
  const { points, routes, airspaces } = collectData(ato, aco);

  if (points.length === 0 && airspaces.length === 0) {
    container.innerHTML = '<div class="map-no-coords">No coordinate data found in ATO.<br>Add <code>aim_points</code>, <code>steer_points</code>, or <code>airfields</code> to your YAML.</div>';
    return;
  }
  container.innerHTML = '';
  drawMap(container, points, routes, geoData, airspaces);
}
