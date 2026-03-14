/* ════════════════════════════════════════════════════════════
   display/map.js — MFD mode Mapbox GL JS map

   Manages the live tactical map displayed in MFD mode.
   Unit tracks are rendered as markers/layers with coalition-
   colour coding and heading arrows.

   Exposes a single global: AsacsMap

   Future expansion points (marked with TODO):
     - Weather overlays
     - Frag-order routes + ACM zones
     - BRA drag-line (mouse interaction)
     - Bullseye ring overlay
     - Various military symbols
════════════════════════════════════════════════════════════ */
'use strict';

const AsacsMap = (() => {
  let _map      = null;
  let _token    = '';
  let _units    = [];
  let _mission  = null;
  let _ready    = false;

  // Mapbox source / layer IDs
  const SRC_UNITS   = 'asacs-units';
  const LAYER_UNITS = 'asacs-units-circles';
  const LAYER_HDGS  = 'asacs-units-headings';
  const LAYER_LBLS  = 'asacs-units-labels';

  // ── Colour helpers ────────────────────────────────────────
  const COLOURS = {
    friendly: '#39ff7a',
    hostile:  '#ff4444',
    neutral:  '#4fc3f7',
    admin:    '#ffb020',
    unknown:  '#888888',
  };

  function relColour(rel) { return COLOURS[rel] || COLOURS.unknown; }

  // ── Public API ────────────────────────────────────────────

  /**
   * Initialise the map.
   * @param {string} token  Mapbox GL JS access token (may be empty)
   * @param {string} containerId  DOM element id for the map container
   */
  function init(token, containerId = 'map-container') {
    _token = token;
    const container = document.getElementById(containerId);
    if (!container) return;

    // Check for mapboxgl library first, before token check.
    if (typeof mapboxgl === 'undefined') {
      console.error('[AsacsMap] mapboxgl is not loaded — check CDN link in index.html');
      _showNoToken(container);
      return;
    }

    // If no token is provided, show a placeholder instead of a blank map.
    if (!token) {
      _showNoToken(container);
      return;
    }

    mapboxgl.accessToken = token;

    _map = new mapboxgl.Map({
      container: containerId,
      style:     'mapbox://styles/mapbox/dark-v11',
      center:    [37, 37],  // default: Syria/Caucasus area
      zoom:      5,
      attributionControl: false,
    });

    _map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
    _map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');

    _map.on('load', () => {
      _ready = true;
      _initSources();
      _initLayers();
      // Re-render any units that arrived before the map was ready
      if (_units.length > 0) updateUnits(_units);
      if (_mission)          updateMission(_mission);
    });

    // TODO: Add click handler for unit popups
    // TODO: Add mousedown + drag for BRA line drawing
    // TODO: Bullseye overlay on cursor position
  }

  /**
   * Update unit tracks on the map.
   * @param {object[]} units  Processed + coalition-filtered unit array
   */
  function updateUnits(units) {
    _units = units || [];
    if (!_ready || !_map) return;

    const features = _units.map(u => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [u.lon || 0, u.lat || 0] },
      properties: {
        id:       u.id,
        rel:      u._rel || 'unknown',
        colour:   relColour(u._rel),
        typeName: u.typeName || u.type || 'UNKNOWN',
        category: u.category || '',
        hdg:      u.hdg || 0,
        alt:      u.alt != null ? u.alt : null,
        spd:      u.spd != null ? u.spd : null,
        squawk:   u.squawk != null ? String(u.squawk) : '',
        pilot:    u.pilotName || '',
        group:    u.groupName || '',
        label:    _buildLabel(u),
      },
    }));

    const geoJson = { type: 'FeatureCollection', features };
    const src = _map.getSource(SRC_UNITS);
    if (src) src.setData(geoJson);
  }

  /**
   * Update mission metadata (used to re-centre the map on the theatre bullseye).
   * @param {object|null} mission
   */
  function updateMission(mission) {
    _mission = mission;
    if (!_ready || !_map || !mission) return;

    // TODO: Place bullseye marker for blue + red when coordinates are available
    // TODO: Adjust default map centre based on theatre name
  }

  /** Called when mode switches away from MFD — resize the map when switching back. */
  function resize() {
    if (_map) _map.resize();
  }

  // ── Internal ──────────────────────────────────────────────

  function _showNoToken(container) {
    container.innerHTML = `
      <div class="map-no-token">
        <div class="map-no-token-icon">⊕</div>
        <div class="map-no-token-title">MAP UNAVAILABLE</div>
        <div class="map-no-token-sub">
          Set <code>MAPBOX_TOKEN</code> in the server environment to enable the tactical map.<br>
          PROF mode (table view) is available via the display toggle above.
        </div>
      </div>`;
  }

  function _initSources() {
    if (_map.getSource(SRC_UNITS)) return;
    _map.addSource(SRC_UNITS, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }

  function _initLayers() {
    // Heading lines — rendered below circles so circles appear on top
    _map.addLayer({
      id:     LAYER_HDGS,
      type:   'line',
      source: SRC_UNITS,
      paint: {
        'line-color':   ['get', 'colour'],
        'line-width':   1.5,
        'line-opacity': 0.7,
      },
      // TODO: replace with actual heading offset geometry when symbol layer is added
    });

    // Unit circles
    _map.addLayer({
      id:     LAYER_UNITS,
      type:   'circle',
      source: SRC_UNITS,
      paint: {
        'circle-radius': [
          'match', ['get', 'category'],
          'Airplane', 5, 'Helicopter', 5,
          'Ground', 4,
          'Ship',   5,
          4,
        ],
        'circle-color':        ['get', 'colour'],
        'circle-opacity':      0.9,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#000',
      },
    });

    // Labels — callsign / type below each marker
    _map.addLayer({
      id:     LAYER_LBLS,
      type:   'symbol',
      source: SRC_UNITS,
      layout: {
        'text-field':  ['get', 'label'],
        'text-font':   ['DIN Offc Pro Regular', 'Arial Unicode MS Regular'],
        'text-size':   10,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
      },
      paint: {
        'text-color':      ['get', 'colour'],
        'text-halo-color': '#000',
        'text-halo-width': 1,
      },
    });

    // TODO: Click popup layer
    // TODO: BRA line layer
    // TODO: Bullseye ring layer
    // TODO: Weather overlay layer
    // TODO: Frag-order route layer
    // TODO: ACM zone fill + outline layers
  }

  function _buildLabel(u) {
    const parts = [];
    if (u.pilotName)  parts.push(u.pilotName);
    else if (u.groupName) parts.push(u.groupName);
    if (u.squawk != null) parts.push(`SQ:${u.squawk}`);
    return parts.join('\n');
  }

  return { init, updateUnits, updateMission, resize };
})();
