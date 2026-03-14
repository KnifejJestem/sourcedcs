/* ════════════════════════════════════════════════════════════
   display/map.js — MFD mode Mapbox GL JS tactical map

   Renders simulation output on the live tactical map:

   Contact types (from simulation engine):
     track   — full data: transponder, altitude, bearing, speed, declaration
     primary — position only (lat/lon)

   Declaration → symbol:
     friendly → green circle
     neutral  → white square
     bogey    → gray  + (cross)
     bandit   → orange triangle
     hostile  → red triangle

   Every contact that has heading and speed data gets a velocity
   vector line showing its projected position in 30 seconds.

   Exposes a single global: AsacsMap

   Future expansion points (marked with TODO):
     - Click popup for track details
     - Bullseye ring overlay
     - Weather overlay
     - Frag-order route + ACM zone layers
════════════════════════════════════════════════════════════ */
'use strict';

const AsacsMap = (() => {
  let _map     = null;
  let _token   = '';
  let _units   = [];
  let _mission = null;
  let _ready   = false;

  // Mapbox source / layer IDs
  const SRC_CONTACTS = 'asacs-contacts';
  const SRC_VECTORS  = 'asacs-vectors';
  const LAYER_VEC    = 'asacs-vec';
  const LAYER_MRK    = 'asacs-markers';
  const LAYER_LBL    = 'asacs-labels';

  // ── Declaration colour palette ────────────────────────────────
  const DECL_COLOUR = {
    friendly: '#39ff7a',  // green
    neutral:  '#ffffff',  // white
    bogey:    '#888888',  // gray
    bandit:   '#ffb020',  // orange
    hostile:  '#ff4444',  // red
  };

  // ── SVG icon definitions per declaration ──────────────────────
  // Each icon is a 24×24 SVG rendered at the unit's position.
  // Primary radar contacts use a smaller 12×12 dot.

  function _svgCircle(c) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">` +
      `<circle cx="12" cy="12" r="9" fill="none" stroke="${c}" stroke-width="2.5"/>` +
      `</svg>`;
  }
  function _svgSquare(c) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">` +
      `<rect x="3" y="3" width="18" height="18" fill="none" stroke="${c}" stroke-width="2.5"/>` +
      `</svg>`;
  }
  function _svgPlus(c) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">` +
      `<line x1="12" y1="2" x2="12" y2="22" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>` +
      `<line x1="2"  y1="12" x2="22" y2="12" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>` +
      `</svg>`;
  }
  function _svgTriangle(c) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">` +
      `<polygon points="12,2 22,22 2,22" fill="${c}"/>` +
      `</svg>`;
  }
  function _svgDot(c) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12">` +
      `<circle cx="6" cy="6" r="4" fill="${c}" opacity="0.8"/>` +
      `</svg>`;
  }

  // Map declaration → [iconId, svgString]
  const SYMBOL_DEFS = [
    ['sym-friendly', _svgCircle(DECL_COLOUR.friendly)],
    ['sym-neutral',  _svgSquare(DECL_COLOUR.neutral)],
    ['sym-bogey',    _svgPlus(DECL_COLOUR.bogey)],
    ['sym-bandit',   _svgTriangle(DECL_COLOUR.bandit)],
    ['sym-hostile',  _svgTriangle(DECL_COLOUR.hostile)],
    ['sym-primary',  _svgDot(DECL_COLOUR.bogey)],
  ];

  // ── Public API ────────────────────────────────────────────────

  /**
   * Initialise the map.
   * @param {string} token  Mapbox GL JS access token (may be empty)
   * @param {string} containerId  DOM element id for the map container
   */
  function init(token, containerId = 'map-container') {
    _token = token;
    const container = document.getElementById(containerId);
    if (!container) return;

    if (typeof mapboxgl === 'undefined') {
      console.error('[AsacsMap] mapboxgl is not loaded — check CDN link in index.html');
      _showNoToken(container);
      return;
    }

    if (!token) {
      _showNoToken(container);
      return;
    }

    mapboxgl.accessToken = token;

    _map = new mapboxgl.Map({
      container: containerId,
      style:     'mapbox://styles/mapbox/dark-v11',
      center:    [37, 37],
      zoom:      5,
      attributionControl: false,
    });

    _map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
    _map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');

    _map.on('load', () => {
      _loadSymbolImages().then(() => {
        _ready = true;
        _initSources();
        _initLayers();
        // Flush any units that arrived before the map was ready
        if (_units.length > 0) updateUnits(_units);
        if (_mission)          updateMission(_mission);
      });
    });

    // TODO: Click handler for unit detail popup
    // TODO: Mouse drag for BRA line drawing
    // TODO: Bullseye ring overlay on cursor position
  }

  /**
   * Update contacts on the map.
   * Accepts the processed + coalition-filtered unit array from the server.
   * @param {object[]} units
   */
  function updateUnits(units) {
    _units = units || [];
    if (!_ready || !_map) return;

    const contactFeatures = [];
    const vectorFeatures  = [];

    for (const u of _units) {
      if (u.lat == null || u.lon == null) continue;

      // Determine symbol.  Primary contacts use the small dot icon.
      const decl   = u.declaration || 'bogey';
      const colour = DECL_COLOUR[decl] || DECL_COLOUR.bogey;
      const icon   = u.contactType === 'primary' ? 'sym-primary' : `sym-${decl}`;

      contactFeatures.push({
        type:     'Feature',
        geometry: { type: 'Point', coordinates: [u.lon, u.lat] },
        properties: {
          id:        u.id,
          decl,
          colour,
          icon,
          label:     _buildLabel(u),
          isPrimary: u.contactType === 'primary' ? 1 : 0,
        },
      });

      // Velocity vector: 30-second look-ahead line.
      // Only drawn when we have both heading and speed.
      if (u.hdg != null) {
        const speedMs = _toMs(u);
        if (speedMs > 0) {
          const end = _projectPos(u.lat, u.lon, u.hdg, speedMs);
          vectorFeatures.push({
            type:     'Feature',
            geometry: { type: 'LineString', coordinates: [[u.lon, u.lat], end] },
            properties: { colour },
          });
        }
      }
    }

    const contactSrc = _map.getSource(SRC_CONTACTS);
    const vectorSrc  = _map.getSource(SRC_VECTORS);
    if (contactSrc) contactSrc.setData({ type: 'FeatureCollection', features: contactFeatures });
    if (vectorSrc)  vectorSrc.setData({ type: 'FeatureCollection', features: vectorFeatures });
  }

  /**
   * Update mission metadata.
   * @param {object|null} mission
   */
  function updateMission(mission) {
    _mission = mission;
    if (!_ready || !_map || !mission) return;
    // TODO: Bullseye marker overlay
    // TODO: Centre map on theatre
  }

  /** Trigger a map resize when switching back to MFD mode. */
  function resize() {
    if (_map) _map.resize();
  }

  // ── Internal ──────────────────────────────────────────────────

  function _showNoToken(container) {
    container.innerHTML =
      `<div class="map-no-token">` +
      `<div class="map-no-token-icon">⊕</div>` +
      `<div class="map-no-token-title">MAP UNAVAILABLE</div>` +
      `<div class="map-no-token-sub">` +
      `Set <code>MAPBOX_TOKEN</code> in the server environment to enable the tactical map.<br>` +
      `PROF mode (table view) is available via the display toggle above.` +
      `</div></div>`;
  }

  /**
   * Load SVG icons into the Mapbox GL image registry.
   * Each SVG is converted via a Blob URL so the browser parses it correctly.
   * @returns {Promise<void>}
   */
  function _loadSymbolImages() {
    const pending = SYMBOL_DEFS.map(([id, svgStr]) => new Promise(resolve => {
      if (_map.hasImage(id)) { resolve(); return; }
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload = () => {
        try { _map.addImage(id, img); } catch { /* already added */ }
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      img.src = url;
    }));
    return Promise.all(pending);
  }

  function _initSources() {
    const empty = { type: 'FeatureCollection', features: [] };
    if (!_map.getSource(SRC_CONTACTS)) _map.addSource(SRC_CONTACTS, { type: 'geojson', data: empty });
    if (!_map.getSource(SRC_VECTORS))  _map.addSource(SRC_VECTORS,  { type: 'geojson', data: empty });
  }

  function _initLayers() {
    // Layer 1: velocity vectors — drawn below markers so icons sit on top
    _map.addLayer({
      id:     LAYER_VEC,
      type:   'line',
      source: SRC_VECTORS,
      paint: {
        'line-color':   ['get', 'colour'],
        'line-width':   1.5,
        'line-opacity': 0.65,
        'line-dasharray': [4, 2],
      },
    });

    // Layer 2: contact markers — each icon is picked by the 'icon' property
    _map.addLayer({
      id:     LAYER_MRK,
      type:   'symbol',
      source: SRC_CONTACTS,
      layout: {
        'icon-image':            ['get', 'icon'],
        'icon-allow-overlap':    true,
        'icon-ignore-placement': true,
        // Hide labels for primary contacts (they carry no useful annotation)
        'text-field': ['case', ['==', ['get', 'isPrimary'], 0], ['get', 'label'], ''],
        'text-font':  ['DIN Offc Pro Regular', 'Arial Unicode MS Regular'],
        'text-size':  10,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: {
        'text-color':      ['get', 'colour'],
        'text-halo-color': '#000',
        'text-halo-width': 1,
      },
    });

    // TODO: Click popup layer
    // TODO: Bullseye ring layer
    // TODO: Weather overlay layer
    // TODO: Frag-order route layer
    // TODO: ACM zone fill + outline layers
  }

  // ── Geometry helpers ──────────────────────────────────────────

  /** Approximate metres per degree of latitude (and longitude at the equator). */
  const METERS_PER_DEG_LAT = 111_320;

  /** Look-ahead window for velocity vectors, in seconds. */
  const VECTOR_LOOKAHEAD_SECS = 30;

  /**
   * Project a lat/lon position forward by speedMs metres/s in direction hdgDeg
   * over VECTOR_LOOKAHEAD_SECS seconds.
   *
   * Uses a flat-earth approximation (accurate enough for tactical ranges).
   *
   * @param {number} lat     Degrees north
   * @param {number} lon     Degrees east
   * @param {number} hdgDeg  True heading in degrees (0 = north, 90 = east)
   * @param {number} speedMs Speed in metres per second
   * @returns {[number, number]}  [lon, lat] GeoJSON coordinate
   */
  function _projectPos(lat, lon, hdgDeg, speedMs) {
    const distM  = speedMs * VECTOR_LOOKAHEAD_SECS;
    const hdgRad = hdgDeg  * Math.PI / 180;
    const latRad = lat     * Math.PI / 180;
    const dLat = (distM * Math.cos(hdgRad)) / METERS_PER_DEG_LAT;
    const dLon = (distM * Math.sin(hdgRad)) / (METERS_PER_DEG_LAT * Math.cos(latRad));
    return [lon + dLon, lat + dLat];
  }

  /**
   * Return the unit's speed in m/s, preferring the GS field (knots → m/s)
   * and falling back to the raw DCS spd field (already m/s).
   */
  function _toMs(u) {
    if (u.gs  != null) return u.gs  / 1.94384; // knots → m/s
    if (u.spd != null) return u.spd;            // raw DCS field (m/s)
    return 0;
  }

  // ── Label builder ─────────────────────────────────────────────

  function _buildLabel(u) {
    const parts = [];
    if (u.pilotName)    parts.push(u.pilotName);
    else if (u.groupName) parts.push(u.groupName);
    if (u.squawk != null) parts.push(`SQ:${String(u.squawk).padStart(4, '0')}`);
    if (u.alt    != null) parts.push(`${Math.round(u.alt)}m`);
    if (u.gs     != null) parts.push(`${u.gs}kt`);
    return parts.join('\n');
  }

  return { init, updateUnits, updateMission, resize };
})();
