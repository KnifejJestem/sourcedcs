// ═══════════════════════════════════════════════════════════
// map-main.js — MAP tab entry point
// ═══════════════════════════════════════════════════════════

'use strict';

function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

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
