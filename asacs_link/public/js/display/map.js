/* ════════════════════════════════════════════════════════════
   display/map.js — MFD mode Mapbox GL JS tactical map

   Renders live contacts using four dedicated GeoJSON sources
   and Mapbox GL layers:

     contacts       → circle  — coalition-coloured blip
     contact-heads  → line    — heading tick (~20 screen px)
     contact-trails → line    — position history trail
     contact-labels → symbol  — callsign / FL / knots tag

   FeatureCollections are produced by AsacsBuilder (builder.js)
   and pushed to the map sources from a requestAnimationFrame
   render loop.  A position history ring buffer (last 30 fixes)
   is maintained here in the display layer so that the server-
   side simulation logic stays unmodified.

   Exposes a single global: AsacsMap

   Future expansion points (marked with TODO):
     - Click popup for unit detail
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
  let _rafId   = null;   // pending requestAnimationFrame id

  // Position history ring buffer: String(contactId) → [[lon, lat], …]
  // Oldest position first; capped at HISTORY_MAX entries per contact.
  const _history = new Map();

  /** Maximum position entries kept per contact. Must match HISTORY_MAX in builder.js. */
  const HISTORY_MAX = 30;

  // Mapbox source / layer IDs (match the spec table exactly)
  const SRC_BLIPS  = 'contacts';
  const SRC_HEADS  = 'contact-heads';
  const SRC_TRAILS = 'contact-trails';
  const SRC_LABELS = 'contact-labels';

  const LAYER_TRAILS = 'contact-trails-layer';
  const LAYER_BLIPS  = 'contacts-layer';
  const LAYER_HEADS  = 'contact-heads-layer';
  const LAYER_LABELS = 'contact-labels-layer';

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
      _ready = true;
      _initSources();
      _initLayers();
      // Flush any units that arrived before the map was ready
      _scheduleRender();
    });

    // TODO: Click handler for unit detail popup
    // TODO: Bullseye ring overlay on cursor position
  }

  /**
   * Accept a new batch of coalition-filtered units from the server.
   * Updates the contact store and the position history ring buffer,
   * then schedules a render frame.
   * @param {object[]} units
   */
  function updateUnits(units) {
    _units = units || [];
    _updateHistory(_units);
    _scheduleRender();
  }

  /**
   * Update mission metadata.
   * @param {object|null} mission
   */
  function updateMission(mission) {
    _mission = mission;
    // TODO: Bullseye marker overlay
    // TODO: Centre map on theatre
  }

  /** Trigger a map resize when switching back to MFD mode. */
  function resize() {
    if (_map) _map.resize();
  }

  // ── Position history ring buffer ──────────────────────────────

  /**
   * Append the current position of each contact to its history trail.
   * Positions are stored as GeoJSON [lon, lat] pairs (oldest first).
   * Contacts that disappear between updates have their history cleared.
   *
   * @param {object[]} units  Current contact array
   */
  function _updateHistory(units) {
    const currentIds = new Set();

    for (const u of units) {
      if (u.lat == null || u.lon == null) continue;

      const id  = String(u.id);
      currentIds.add(id);

      let trail = _history.get(id);
      if (!trail) { trail = []; _history.set(id, trail); }

      const pos  = [u.lon, u.lat];
      const last = trail[trail.length - 1];

      // Only append when position has changed to avoid duplicate entries
      if (!last || last[0] !== pos[0] || last[1] !== pos[1]) {
        trail.push(pos);
        if (trail.length > HISTORY_MAX) trail.shift();
      }
    }

    // Remove history for contacts that are no longer in the picture
    for (const id of _history.keys()) {
      if (!currentIds.has(id)) _history.delete(id);
    }
  }

  // ── Render loop ───────────────────────────────────────────────

  /**
   * Schedule a render on the next animation frame.
   * If a frame is already queued this is a no-op.
   */
  function _scheduleRender() {
    if (_rafId !== null) return;
    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      try { _doRender(); } catch (e) { console.error('[AsacsMap] render error:', e); }
    });
  }

  /**
   * Rebuild all four FeatureCollections and push them to the map sources.
   * Called from within a requestAnimationFrame callback.
   */
  function _doRender() {
    if (!_ready || !_map) return;

    // AsacsBuilder is loaded as a <script type="module"> — it sets
    // window.AsacsBuilder when the module executes.  By the time the
    // first WebSocket update arrives it will always be available.
    if (typeof AsacsBuilder === 'undefined') return;

    const zoom     = _map.getZoom();
    const blipSrc  = _map.getSource(SRC_BLIPS);
    const headSrc  = _map.getSource(SRC_HEADS);
    const trailSrc = _map.getSource(SRC_TRAILS);
    const lblSrc   = _map.getSource(SRC_LABELS);

    if (blipSrc)  blipSrc.setData(AsacsBuilder.buildBlips(_units));
    if (headSrc)  headSrc.setData(AsacsBuilder.buildHeadingTicks(_units, zoom));
    if (trailSrc) trailSrc.setData(AsacsBuilder.buildTrails(_units, _history));
    if (lblSrc)   lblSrc.setData(AsacsBuilder.buildLabels(_units));
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

  function _initSources() {
    const empty = { type: 'FeatureCollection', features: [] };
    if (!_map.getSource(SRC_BLIPS))  _map.addSource(SRC_BLIPS,  { type: 'geojson', data: empty });
    if (!_map.getSource(SRC_HEADS))  _map.addSource(SRC_HEADS,  { type: 'geojson', data: empty });
    if (!_map.getSource(SRC_TRAILS)) _map.addSource(SRC_TRAILS, { type: 'geojson', data: empty });
    if (!_map.getSource(SRC_LABELS)) _map.addSource(SRC_LABELS, { type: 'geojson', data: empty });
  }

  function _initLayers() {
    // 1. Trails — drawn first so blips appear on top of their own history
    _map.addLayer({
      id:     LAYER_TRAILS,
      type:   'line',
      source: SRC_TRAILS,
      paint: {
        'line-color':   ['get', 'colour'],
        'line-width':   1,
        'line-opacity': 0.35,
      },
    });

    // 2. Blips (circles) — coalition-coloured; primaries are smaller + dimmer
    _map.addLayer({
      id:     LAYER_BLIPS,
      type:   'circle',
      source: SRC_BLIPS,
      paint: {
        'circle-color':          ['get', 'colour'],
        'circle-radius':         ['case', ['==', ['get', 'isPrimary'], 1], 4, 7],
        'circle-opacity':        ['case', ['==', ['get', 'isPrimary'], 1], 0.6, 0.9],
        'circle-stroke-width':   1.5,
        'circle-stroke-color':   '#000000',
        'circle-stroke-opacity': 0.3,
      },
    });

    // 3. Heading ticks — drawn after blips so ticks visually extend from the blip
    _map.addLayer({
      id:     LAYER_HEADS,
      type:   'line',
      source: SRC_HEADS,
      paint: {
        'line-color':   ['get', 'colour'],
        'line-width':   1.5,
        'line-opacity': 0.85,
      },
    });

    // 4. Data tags — offset top-right; allow overlap since contacts can be dense
    _map.addLayer({
      id:     LAYER_LABELS,
      type:   'symbol',
      source: SRC_LABELS,
      layout: {
        'text-field':         ['get', 'label'],
        'text-font':          ['DIN Offc Pro Regular', 'Arial Unicode MS Regular'],
        'text-size':          10,
        'text-offset':        [1, -1],
        'text-anchor':        'bottom-left',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color':      '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1.5,
      },
    });

    // TODO: Bullseye ring layer
    // TODO: Weather overlay layer
    // TODO: Frag-order route layer
    // TODO: ACM zone fill + outline layers
  }

  return { init, updateUnits, updateMission, resize };
})();
