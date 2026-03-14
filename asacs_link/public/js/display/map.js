/* ════════════════════════════════════════════════════════════
   display/map.js — Tactical map (CHART / TERRAIN display modes)

   Renders live contacts using seven GeoJSON sources / layers:

     contacts         → circle  — friendly / neutral blips
     contacts-hostile → symbol  — hostile / bandit triangles (▲)
     contact-heads    → line    — heading tick (~20 screen px)
     contact-trails   → line    — position history trail
     contact-leaders  → line    — leader line from unit to dragged label
     contact-labels   → symbol  — callsign / FL / knots tag
     measure-line     → line    — BRA measuring line (right-click hold)

   FeatureCollections are produced by AsacsBuilder (builder.js).
   Heading ticks are rebuilt only when zoom changes (they depend
   on zoom level); blips/trails/labels/leader-lines rebuild when
   data changes.  Drag/pan does not trigger unnecessary source updates.

   Draggable labels: click and drag any label to declutter the
   display.  Offsets are stored as [deltaLon, deltaLat] relative to
   the unit position, so the label tracks the unit as it moves and
   a leader line is drawn from the unit to the displaced label.
   Double-click resets the label to its default position.

   Measuring line: hold right mouse button and drag to draw a dashed
   yellow line showing the magnetic heading and slant range in NM.
   The start and end points snap to any nearby track or primary radar
   contact within 20 screen pixels.

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
  let _displayMode = 'chart';

  // Drag-label state
  let _dragLabel  = null;  // { id: String, startLngLat: {lng, lat} }

  // Measuring-line state
  let _measure        = null;   // active: { startLng, startLat, endLng, endLat }
  let _measureReadout = null;   // HTML overlay element showing heading / range
  let _measureInited  = false;  // guard: native canvas listeners added only once

  /** Screen-space snapping threshold in pixels for the measuring-line. */
  const SNAP_PIXELS = 20;

  const SRC_BLIPS   = 'contacts';
  const SRC_HOSTILE = 'contacts-hostile';
  const SRC_HEADS   = 'contact-heads';
  const SRC_TRAILS  = 'contact-trails';
  const SRC_LEADERS = 'contact-leaders';
  const SRC_LABELS  = 'contact-labels';
  const SRC_MEASURE = 'measure-line';

  const LAYER_TRAILS   = 'contact-trails-layer';
  const LAYER_BLIPS    = 'contacts-layer';
  const LAYER_HOSTILE  = 'contacts-hostile-layer';
  const LAYER_HEADS    = 'contact-heads-layer';
  const LAYER_LEADERS  = 'contact-leaders-layer';
  const LAYER_LABELS   = 'contact-labels-layer';
  const LAYER_MEASURE  = 'measure-line-layer';

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
   * Change the Mapbox base-map style (CHART / TERRAIN map modes).
   * Also accepts legacy aliases 'prof' (→ chart) and 'mfd' (→ terrain).
   * All custom sources and layers are re-added after the style loads.
   *
   * Safe to call before the map has fully loaded — the call is a no-op
   * in that case; _onLoad() picks up the stored preference via AsacsMapType.get().
   * @param {'chart'|'terrain'|'prof'|'mfd'} type
   */
  function setDisplayMode(type) {
    // Normalise to canonical names; accept legacy prof/mfd aliases
    const mode = (type === 'terrain' || type === 'mfd') ? 'terrain' : 'chart';
    if (!_map) return; // Map not initialised yet; _onLoad() will handle this
    if (mode === _displayMode && _ready) return; // Already on the right loaded style

    const style = mode === 'terrain'
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

      const blipSrc   = _map.getSource(SRC_BLIPS);
      const hostSrc   = _map.getSource(SRC_HOSTILE);
      const trailSrc  = _map.getSource(SRC_TRAILS);
      const leaderSrc = _map.getSource(SRC_LEADERS);
      const lblSrc    = _map.getSource(SRC_LABELS);

      if (blipSrc)   blipSrc.setData(AsacsBuilder.buildBlips(friendly));
      if (hostSrc)   hostSrc.setData(AsacsBuilder.buildBlips(hostile));
      if (trailSrc)  trailSrc.setData(AsacsBuilder.buildTrails(_units, _history));
      if (leaderSrc) leaderSrc.setData(AsacsBuilder.buildLeaderLines(_units, _labelOffsets));
      if (lblSrc)    lblSrc.setData(AsacsBuilder.buildLabels(_units, _labelOffsets));

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
    _initLabelDrag();
    _initMeasuringLine();
    // Apply any persisted settings (pitch, bearing, layer visibility etc.)
    if (typeof AsacsSettings !== 'undefined') {
      applySettings(AsacsSettings.get());
    }
    // If the stored map-type preference differs from the style that just loaded,
    // swap to the correct style (setDisplayMode re-inits sources/layers after load).
    const storedType = typeof AsacsMapType !== 'undefined' ? AsacsMapType.get() : 'chart';
    if (storedType !== _displayMode) {
      setDisplayMode(storedType);
      return; // style.load handler will call _initSources/_initLayers/_scheduleRender
    }
    // Already on the right style — init sources/layers and render.
    // addSrc/addLayer are idempotent so this is safe even if a concurrent
    // setDisplayMode style.load handler already ran (e.g. style swap mid-load).
    _initSources();
    _initLayers();
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
    addSrc(SRC_LEADERS, { type: 'geojson', data: empty });
    addSrc(SRC_LABELS,  { type: 'geojson', data: empty });
    addSrc(SRC_MEASURE, { type: 'geojson', data: empty });
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

    // 2. Leader lines — faint dashed lines from unit to displaced labels
    addLayer({
      id:     LAYER_LEADERS,
      type:   'line',
      source: SRC_LEADERS,
      paint: {
        'line-color':      ['get', 'colour'],
        'line-width':      1,
        'line-opacity':    0.45,
        'line-dasharray':  [2, 3],
      },
    });

    // 3. Friendly / neutral blips (circles)
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

    // 4. Hostile / bandit triangles (▲)
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

    // 5. Heading ticks — drawn after blips
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

    // 6. Measuring line — drawn above ticks, below labels
    addLayer({
      id:     LAYER_MEASURE,
      type:   'line',
      source: SRC_MEASURE,
      paint: {
        'line-color':    '#ffff00',
        'line-width':    2,
        'line-opacity':  0.9,
        'line-dasharray': [6, 3],
      },
    });

    // 7. Data tags — allow overlap; units can be dragged for decluttering
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
   * Offsets are stored as [deltaLon, deltaLat] relative to the unit position
   * so the label tracks the unit as it moves.  A leader line is drawn from
   * the unit to the displaced label by buildLeaderLines() in builder.js.
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

      const id = String(feature.properties.id);
      _dragLabel = {
        id,
        startLngLat: e.lngLat,
        // Accumulate from any previous drag so repeat drags add to the offset
        baseDelta: _labelOffsets.get(id) || [0, 0],
      };

      _map.dragPan.disable();
      canvas.style.cursor = 'grabbing';

      const onMove = (moveEvt) => {
        if (!_dragLabel) return;
        const dLng = moveEvt.lngLat.lng - _dragLabel.startLngLat.lng;
        const dLat = moveEvt.lngLat.lat - _dragLabel.startLngLat.lat;
        _labelOffsets.set(_dragLabel.id, [
          _dragLabel.baseDelta[0] + dLng,
          _dragLabel.baseDelta[1] + dLat,
        ]);
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

  // ── Measuring line ────────────────────────────────────────────

  /**
   * Find the nearest contact within SNAP_PIXELS of the given screen position.
   * Returns the contact object, or null if nothing is within the threshold.
   *
   * @param {number} screenX  Canvas X pixel (from e.offsetX)
   * @param {number} screenY  Canvas Y pixel (from e.offsetY)
   * @returns {object|null}
   */
  function _snapToContact(screenX, screenY) {
    let bestDist = SNAP_PIXELS;
    let best     = null;
    for (const u of _units) {
      if (u.lat == null || u.lon == null) continue;
      const pt = _map.project([u.lon, u.lat]);
      const d  = Math.hypot(pt.x - screenX, pt.y - screenY);
      if (d < bestDist) { bestDist = d; best = u; }
    }
    return best;
  }

  /**
   * Push the current measuring-line geometry to the Mapbox source and
   * refresh the readout overlay (bearing + distance).
   */
  function _updateMeasureLine() {
    if (!_measure || typeof AsacsBuilder === 'undefined') return;
    const { startLng, startLat, endLng, endLat } = _measure;

    const src = _map.getSource(SRC_MEASURE);
    if (src) {
      src.setData({
        type: 'FeatureCollection',
        features: [{
          type:     'Feature',
          geometry: { type: 'LineString', coordinates: [[startLng, startLat], [endLng, endLat]] },
          properties: {},
        }],
      });
    }

    const dist    = AsacsBuilder.distNm(startLat, startLng, endLat, endLng);
    const hdg     = dist < 0.005 ? 0 : AsacsBuilder.bearingDeg(startLat, startLng, endLat, endLng);
    const hdgStr  = Math.round(hdg).toString().padStart(3, '0');
    const distStr = dist.toFixed(1);
    if (_measureReadout) _measureReadout.textContent = `${hdgStr}°  ${distStr} NM`;
  }

  /**
   * Set up the measuring-line interaction (right-click hold).
   *
   * Right mouse button down starts the line at the click position (snapping
   * to any contact within SNAP_PIXELS).  Moving the mouse while the button
   * is held extends the line to the current cursor position (also snapping).
   * Releasing the right button clears the line.
   *
   * Native canvas events with capture:true are used so that the handler
   * intercepts the right-click before Mapbox's dragRotate handler, preventing
   * the map from rotating while measuring.  The browser context menu is also
   * suppressed over the canvas.
   *
   * Called once on initial map load (_onLoad); the _measureInited guard
   * prevents duplicate listeners if _onLoad runs more than once.
   */
  function _initMeasuringLine() {
    if (_measureInited) return;
    _measureInited = true;

    const canvas    = _map.getCanvas();
    const container = _map.getContainer();

    // HTML overlay for the heading / range readout
    _measureReadout = document.createElement('div');
    Object.assign(_measureReadout.style, {
      position:      'absolute',
      background:    'rgba(0,0,0,0.80)',
      color:         '#fff',
      padding:       '3px 8px',
      border:        '1px solid rgba(255,255,255,0.45)',
      borderRadius:  '3px',
      fontFamily:    '"DIN Offc Pro Regular", monospace, sans-serif',
      fontSize:      '12px',
      letterSpacing: '0.5px',
      pointerEvents: 'none',
      display:       'none',
      whiteSpace:    'nowrap',
      zIndex:        '10',
    });
    container.appendChild(_measureReadout);

    // Suppress the browser context menu over the map canvas
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Right mouse button press — start measuring.
    // Capture phase intercepts before Mapbox's dragRotate listener so the
    // map does not rotate while the measuring line is being drawn.
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      e.stopPropagation(); // prevent Mapbox dragRotate from starting

      const lngLat  = _map.unproject([e.offsetX, e.offsetY]);
      const snapped = _snapToContact(e.offsetX, e.offsetY);

      _measure = {
        startLng: snapped ? snapped.lon : lngLat.lng,
        startLat: snapped ? snapped.lat : lngLat.lat,
        endLng:   snapped ? snapped.lon : lngLat.lng,
        endLat:   snapped ? snapped.lat : lngLat.lat,
      };

      _measureReadout.style.display = 'block';
      _measureReadout.style.left    = `${e.offsetX + 15}px`;
      _measureReadout.style.top     = `${e.offsetY - 10}px`;
      _updateMeasureLine();
    }, true /* capture */);

    // Mouse move — extend the line to the current cursor while right button held
    canvas.addEventListener('mousemove', (e) => {
      if (!_measure) return;

      const lngLat  = _map.unproject([e.offsetX, e.offsetY]);
      const snapped = _snapToContact(e.offsetX, e.offsetY);
      _measure.endLng = snapped ? snapped.lon : lngLat.lng;
      _measure.endLat = snapped ? snapped.lat : lngLat.lat;

      _measureReadout.style.left = `${e.offsetX + 15}px`;
      _measureReadout.style.top  = `${e.offsetY - 10}px`;
      _updateMeasureLine();
    });

    // Right mouse button release — clear the measuring line
    canvas.addEventListener('mouseup', (e) => {
      if (e.button !== 2 || !_measure) return;
      _measure = null;
      _measureReadout.style.display = 'none';
      const src = _map.getSource(SRC_MEASURE);
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
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
    if (_map.getLayer(LAYER_TRAILS))  _map.setLayoutProperty(LAYER_TRAILS,  'visibility', trailVis);
    if (_map.getLayer(LAYER_LEADERS)) _map.setLayoutProperty(LAYER_LEADERS, 'visibility', labelVis);
    if (_map.getLayer(LAYER_LABELS))  _map.setLayoutProperty(LAYER_LABELS,  'visibility', labelVis);

    // Label size
    if (cfg.labelSize && _map.getLayer(LAYER_LABELS)) {
      _map.setLayoutProperty(LAYER_LABELS, 'text-size', cfg.labelSize);
    }
  }

  return { init, updateUnits, updateMission, resize, setDisplayMode, applySettings };
})();
