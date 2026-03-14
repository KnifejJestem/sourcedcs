/* ════════════════════════════════════════════════════════════
   display/map.js — Tactical map (PROF / MFD display modes)

   Renders live contacts using five GeoJSON sources / layers:

     contacts         → circle  — friendly / neutral blips
     contacts-hostile → symbol  — hostile / bandit triangles (▲)
     contact-heads    → line    — heading tick (~20 screen px)
     contact-trails   → line    — position history trail
     contact-labels   → symbol  — callsign / FL / knots tag

   FeatureCollections are produced by AsacsBuilder (builder.js).
   Heading ticks are rebuilt only when zoom changes (they depend
   on zoom level); blips/trails/labels rebuild when data changes.
   Drag/pan does not trigger unnecessary source updates.

   Draggable labels: click and drag any label to declutter the
   display.  Offsets are stored per unit ID and applied when
   building the labels FeatureCollection.

   Exposes a single global: AsacsMap
════════════════════════════════════════════════════════════ */
'use strict';

const AsacsMap = (() => {
  let _map       = null;
  let _token     = '';
  let _units     = [];
  let _mission   = null;
  let _ready     = false;
  let _rafId     = null;   // pending requestAnimationFrame id

  // Dirty flags — avoid redundant setData() calls
  let _dataDirty = false;  // blips / trails / labels need refresh
  let _zoomDirty = false;  // heading ticks need refresh (zoom changed)
  let _lastZoom  = null;   // last zoom level at which ticks were drawn

  // Position history ring buffer: String(contactId) → [[lon, lat, alt], …]
  // Oldest position first; capped at HISTORY_MAX entries per contact.
  const _history = new Map();

  // Label offsets for decluttering: String(contactId) → [lon, lat]
  // Dragged labels store their overridden geographic position here.
  const _labelOffsets = new Map();

  /** Maximum position entries kept per contact. Must match HISTORY_MAX in builder.js. */
  const HISTORY_MAX = 30;

  // Track current display mode explicitly to avoid fragile URL inspection
  let _displayMode = 'prof';

  // Drag-label state
  let _dragLabel  = null;  // { id: String, startLngLat: {lng, lat} }

  // Mapbox source / layer IDs
  const SRC_BLIPS   = 'contacts';
  const SRC_HOSTILE = 'contacts-hostile';
  const SRC_HEADS   = 'contact-heads';
  const SRC_TRAILS  = 'contact-trails';
  const SRC_LABELS  = 'contact-labels';

  const LAYER_TRAILS   = 'contact-trails-layer';
  const LAYER_BLIPS    = 'contacts-layer';
  const LAYER_HOSTILE  = 'contacts-hostile-layer';
  const LAYER_HEADS    = 'contact-heads-layer';
  const LAYER_LABELS   = 'contact-labels-layer';

  // Hostile / bandit declaration values
  const HOSTILE_DECLS = new Set(['bogey', 'bandit', 'hostile']);

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
      container:          containerId,
      style:              'mapbox://styles/mapbox/dark-v11',
      center:             [37, 37],
      zoom:               5,
      pitch:              0,
      attributionControl: false,
    });

    _map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
    _map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');

    _map.on('load', _onLoad);

    // Rebuild heading ticks on zoom change (they depend on zoom level)
    _map.on('zoom', () => {
      _zoomDirty = true;
      _scheduleRender();
    });

    // After pan/rotate finishes, flush any pending data updates
    _map.on('moveend', () => {
      if (_dataDirty || _zoomDirty) _scheduleRender();
    });
  }

  /**
   * Accept a new batch of coalition-filtered units from the server.
   * Marks data as dirty and schedules one render frame.  While the map
   * is being panned the render is deferred to the next moveend so that
   * Mapbox can animate the pan at full frame rate.
   * @param {object[]} units
   */
  function updateUnits(units) {
    _units = units || [];
    _updateHistory(_units);
    _dataDirty = true;
    // Only trigger an immediate render when the map is not being moved;
    // moveend will trigger it after pan/zoom gestures complete.
    if (!_map || !_map.isMoving()) _scheduleRender();
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

  /** Trigger a map resize when switching back to MFD/PROF mode. */
  function resize() {
    if (_map) _map.resize();
  }

  /**
   * Change the Mapbox base-map style (PROF / MFD visual modes).
   * All custom sources and layers are re-added after the style loads.
   * @param {'prof'|'mfd'} mode
   */
  function setDisplayMode(mode) {
    if (!_map || !_ready) return;
    if (mode === _displayMode) return; // already on the right style

    const style = mode === 'mfd'
      ? 'mapbox://styles/mapbox/satellite-streets-v12'
      : 'mapbox://styles/mapbox/dark-v11';

    _displayMode = mode;
    _ready = false;
    _map.setStyle(style);
    _map.once('style.load', () => {
      _ready = true;
      _initSources();
      _initLayers();
      _dataDirty = true;
      _zoomDirty = true;
      _scheduleRender();
    });
  }

  // ── Position history ring buffer ──────────────────────────────

  /**
   * Append the current position of each contact to its history trail.
   * Positions are stored as [lon, lat, alt] triples (oldest first).
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

      const alt = u.alt ?? 0;
      const pos = [u.lon, u.lat, alt];
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
   * Push pending FeatureCollection updates to the map sources.
   * Only the sources that actually need refreshing are updated:
   *   - blips / trails / labels: when _dataDirty
   *   - heading ticks: when _zoomDirty or zoom has changed
   */
  function _doRender() {
    if (!_ready || !_map) return;
    if (typeof AsacsBuilder === 'undefined') return;

    const zoom = _map.getZoom();

    if (_dataDirty) {
      _dataDirty = false;

      // Partition units in a single pass: friendly/neutral for circles, hostile/bandit for triangles
      const friendly = [];
      const hostile  = [];
      for (const u of _units) {
        if (HOSTILE_DECLS.has(u.declaration)) hostile.push(u);
        else friendly.push(u);
      }

      const blipSrc  = _map.getSource(SRC_BLIPS);
      const hostSrc  = _map.getSource(SRC_HOSTILE);
      const trailSrc = _map.getSource(SRC_TRAILS);
      const lblSrc   = _map.getSource(SRC_LABELS);

      if (blipSrc)  blipSrc.setData(AsacsBuilder.buildBlips(friendly));
      if (hostSrc)  hostSrc.setData(AsacsBuilder.buildBlips(hostile));
      if (trailSrc) trailSrc.setData(AsacsBuilder.buildTrails(_units, _history));
      if (lblSrc)   lblSrc.setData(AsacsBuilder.buildLabels(_units, _labelOffsets));

      // Heading ticks depend on zoom → mark as dirty too when data changes
      _zoomDirty = true;
    }

    if (_zoomDirty) {
      _zoomDirty = false;
      _lastZoom  = zoom;

      const headSrc = _map.getSource(SRC_HEADS);
      if (headSrc) headSrc.setData(AsacsBuilder.buildHeadingTicks(_units, zoom));
    }
  }

  // ── Internal ──────────────────────────────────────────────────

  function _onLoad() {
    _ready = true;
    _initSources();
    _initLayers();
    _initLabelDrag();
    // Apply any persisted settings (pitch, bearing, layer visibility etc.)
    if (typeof AsacsSettings !== 'undefined') {
      applySettings(AsacsSettings.get());
    }
    _dataDirty = true;
    _zoomDirty = true;
    _scheduleRender();
  }

  function _showNoToken(container) {
    container.innerHTML =
      `<div class="map-no-token">` +
      `<div class="map-no-token-icon">⊕</div>` +
      `<div class="map-no-token-title">MAP UNAVAILABLE</div>` +
      `<div class="map-no-token-sub">` +
      `Set <code>MAPBOX_TOKEN</code> in the server environment to enable the tactical map.<br>` +
      `TABLE mode (data view) is available via the display toggle above.` +
      `</div></div>`;
  }

  function _initSources() {
    const empty = { type: 'FeatureCollection', features: [] };
    const addSrc = (id, opts) => {
      if (!_map.getSource(id)) _map.addSource(id, opts);
    };
    addSrc(SRC_BLIPS,   { type: 'geojson', data: empty });
    addSrc(SRC_HOSTILE, { type: 'geojson', data: empty });
    addSrc(SRC_HEADS,   { type: 'geojson', data: empty });
    addSrc(SRC_TRAILS,  { type: 'geojson', data: empty });
    addSrc(SRC_LABELS,  { type: 'geojson', data: empty });
  }

  function _initLayers() {
    const addLayer = (spec) => {
      if (!_map.getLayer(spec.id)) _map.addLayer(spec);
    };

    // 1. Trails — drawn first so blips appear on top of their own history
    addLayer({
      id:     LAYER_TRAILS,
      type:   'line',
      source: SRC_TRAILS,
      paint: {
        'line-color':   ['get', 'colour'],
        'line-width':   1,
        'line-opacity': 0.35,
      },
    });

    // 2. Friendly / neutral blips (circles)
    addLayer({
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

    // 3. Hostile / bandit triangles (▲)
    //    Uses COLOUR_BANDIT (red) for confirmed enemy, COLOUR_HOSTILE (orange) for bogey.
    //    Both constants are exported from builder.js and available via window.AsacsBuilder.
    const colBandit  = (typeof AsacsBuilder !== 'undefined' && AsacsBuilder.COLOUR_BANDIT)  || '#ff4444';
    const colHostile = (typeof AsacsBuilder !== 'undefined' && AsacsBuilder.COLOUR_HOSTILE) || '#ffb020';
    addLayer({
      id:     LAYER_HOSTILE,
      type:   'symbol',
      source: SRC_HOSTILE,
      layout: {
        'text-field':         '▲',
        'text-font':          ['Arial Unicode MS Bold'],
        'text-size':          ['case', ['==', ['get', 'isPrimary'], 1], 14, 20],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': [
          'case',
          ['==', ['get', 'declaration'], 'bandit'], colBandit,
          colHostile,
        ],
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    });

    // 4. Heading ticks — drawn after blips
    addLayer({
      id:     LAYER_HEADS,
      type:   'line',
      source: SRC_HEADS,
      paint: {
        'line-color':   ['get', 'colour'],
        'line-width':   1.5,
        'line-opacity': 0.85,
      },
    });

    // 5. Data tags — allow overlap; units can be dragged for decluttering
    addLayer({
      id:     LAYER_LABELS,
      type:   'symbol',
      source: SRC_LABELS,
      layout: {
        'text-field':            ['get', 'label'],
        'text-font':             ['DIN Offc Pro Regular', 'Arial Unicode MS Regular'],
        'text-size':             10,
        'text-offset':           [1, -1],
        'text-anchor':           'bottom-left',
        'text-allow-overlap':    true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color':      '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1.5,
      },
    });
  }

  // ── Draggable labels ──────────────────────────────────────────

  /**
   * Allow users to click and drag data-tag labels to declutter the display.
   * Pressing Escape or double-clicking the label resets its position.
   */
  function _initLabelDrag() {
    const canvas = _map.getCanvas();

    _map.on('mousedown', LAYER_LABELS, (e) => {
      // Left-click only
      if (e.originalEvent.button !== 0) return;

      const feature = e.features && e.features[0];
      if (!feature) return;

      e.preventDefault();

      _dragLabel = {
        id:          feature.properties.id,
        startLngLat: e.lngLat,
        // TODO: save startOffset here if undo/redo is ever needed
      };

      _map.dragPan.disable();
      canvas.style.cursor = 'grabbing';

      const onMove = (moveEvt) => {
        if (!_dragLabel) return;
        _labelOffsets.set(_dragLabel.id, [moveEvt.lngLat.lng, moveEvt.lngLat.lat]);
        _dataDirty = true;
        _scheduleRender();
      };

      const onUp = () => {
        _dragLabel = null;
        _map.dragPan.enable();
        canvas.style.cursor = '';
        _map.off('mousemove', onMove);
        _map.off('mouseup',   onUp);
      };

      _map.on('mousemove', onMove);
      _map.on('mouseup',   onUp);
    });

    // Double-click resets the label to default position
    _map.on('dblclick', LAYER_LABELS, (e) => {
      const feature = e.features && e.features[0];
      if (!feature) return;
      e.preventDefault();
      _labelOffsets.delete(feature.properties.id);
      _dataDirty = true;
      _scheduleRender();
    });

    // Pointer cursor when hovering over a label
    _map.on('mouseenter', LAYER_LABELS, () => {
      _map.getCanvas().style.cursor = 'grab';
    });
    _map.on('mouseleave', LAYER_LABELS, () => {
      _map.getCanvas().style.cursor = '';
    });
  }

  /**
   * Apply operator settings from the settings panel.
   * Called by AsacsSettings.apply() after the user confirms changes.
   * @param {object} cfg  Settings object from AsacsSettings.get()
   */
  function applySettings(cfg) {
    if (!_map) return;

    // Camera
    _map.easeTo({
      pitch:   cfg.mapPitch   ?? 0,
      bearing: cfg.mapBearing ?? 0,
      duration: 400,
    });

    // Layer visibility
    const trailVis = cfg.showTrails ? 'visible' : 'none';
    const labelVis = cfg.showLabels ? 'visible' : 'none';
    if (_map.getLayer(LAYER_TRAILS)) _map.setLayoutProperty(LAYER_TRAILS, 'visibility', trailVis);
    if (_map.getLayer(LAYER_LABELS)) _map.setLayoutProperty(LAYER_LABELS, 'visibility', labelVis);

    // Label size
    if (cfg.labelSize && _map.getLayer(LAYER_LABELS)) {
      _map.setLayoutProperty(LAYER_LABELS, 'text-size', cfg.labelSize);
    }
  }

  return { init, updateUnits, updateMission, resize, setDisplayMode, applySettings };
})();
