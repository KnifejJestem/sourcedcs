'use strict';

// ── Map initialisation ────────────────────────────────────────────────────
// Sets up all MapLibre sources, layers, and event handlers.

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: '/crc-scope-style.json',
    center: [35.4258, 37.0021],
    zoom: 7,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  map.on('load', () => {
    initIcons();

    // ── Radar debug overlay ──────────────────────────────────────────────
    // Sweep lines / cone edges for active radars (debug mode only).
    map.addSource('radar-debug', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'radar-debug-lines', type: 'line', source: 'radar-debug',
      paint: {
        'line-color':   ['get', 'color'],
        'line-opacity': ['coalesce', ['get', 'opacity'], 0.7],
        'line-width':   1,
        'line-dasharray': [4, 3],
      },
    });

    // ── Range rings ──────────────────────────────────────────────────────
    map.addSource('range-ring', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'range-ring-line', type: 'line', source: 'range-ring',
      filter: ['==', ['get', 'ring'], 'range'],
      paint: { 'line-color': '#8aaa6a', 'line-opacity': 0.4, 'line-width': 1, 'line-dasharray': [8, 6] },
    });
    map.addLayer({
      id: 'ground-ring-line', type: 'line', source: 'range-ring',
      filter: ['==', ['get', 'ring'], 'ground'],
      paint: { 'line-color': '#8aaa6a', 'line-opacity': 0.22, 'line-width': 1, 'line-dasharray': [3, 4] },
    });

    // ── Mission drawings ─────────────────────────────────────────────────
    // Rendered below all track data so they serve as background reference.
    map.addSource('drawings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Polygon fills (closed shapes: rects, circles, etc.)
    map.addLayer({
      id: 'drawing-fills', type: 'fill', source: 'drawings',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color':   ['get', 'fillColor'],
        'fill-opacity': 1,
      },
    });
    // Outlines for all drawing features
    map.addLayer({
      id: 'drawing-lines', type: 'line', source: 'drawings',
      paint: {
        'line-color':   ['get', 'color'],
        'line-width':   1.2,
        'line-opacity': 0.85,
      },
    });

    // ── Nav/waypoints ─────────────────────────────────────────────────────
    map.addSource('navpoints', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'navpt-icons', type: 'symbol', source: 'navpoints',
      layout: {
        'icon-image':            'navpt',
        'icon-allow-overlap':    true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': 0.85 },
    });
    map.addLayer({
      id: 'navpt-labels', type: 'symbol', source: 'navpoints',
      layout: {
        'text-field':            ['get', 'name'],
        'text-font':             ['Roboto Regular', 'Noto Sans Regular'],
        'text-size':             9,
        'text-anchor':           'top',
        'text-offset':           [0, 0.7],
        'text-allow-overlap':    false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color':   '#3a5a3a',
        'text-opacity': 0.9,
      },
    });

    // ── Selection ring around reference track ────────────────────────────
    map.addSource('ref-dot', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'ref-dot-ring', type: 'circle', source: 'ref-dot',
      paint: {
        'circle-radius': 10, 'circle-color': 'transparent',
        'circle-stroke-color': '#8aaa6a', 'circle-stroke-width': 1.5,
        'circle-opacity': 0, 'circle-stroke-opacity': 0.85,
      },
    });

    // ── Airport labels ───────────────────────────────────────────────────
    map.addSource('airports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'airport-labels', type: 'symbol', source: 'airports',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Roboto Regular', 'Noto Sans Regular'],
        'text-size': 9, 'text-anchor': 'top', 'text-offset': [0, 0.4],
        'text-allow-overlap': false,
      },
      paint: { 'text-color': '#3a5a3a', 'text-halo-color': '#000', 'text-halo-width': 1 },
    });

    // ── Bullseye symbols ─────────────────────────────────────────────────
    map.addSource('bullseye', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'bullseye-icons', type: 'symbol', source: 'bullseye',
      layout: {
        'icon-image': ['match', ['get', 'coalition'], 'blue', 'be-blue', 'red', 'be-red', 'be-blue'],
        'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 1,
      },
      paint: { 'icon-opacity': 0.8 },
    });

    // ── Trail dots ───────────────────────────────────────────────────────
    map.addSource('trails', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'trail-dots', type: 'circle', source: 'trails',
      paint: { 'circle-radius': 1.5, 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'opacity'], 'circle-stroke-width': 0 },
    });

    // ── PPL dashed lines ─────────────────────────────────────────────────
    map.addSource('ppl', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'ppl-lines', type: 'line', source: 'ppl',
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.45, 'line-width': 1, 'line-dasharray': [5, 4] },
    });

    // ── Approach vector ───────────────────────────────────────────────────
    map.addSource('approach-vec', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'approach-vec-line', type: 'line', source: 'approach-vec',
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-width': 1.5, 'line-dasharray': [8, 4] },
    });

    // ── Measure line ─────────────────────────────────────────────────────
    map.addSource('measure', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'measure-line', type: 'line', source: 'measure',
      filter: ['==', ['get', 'kind'], 'line'],
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.7, 'line-width': 1, 'line-dasharray': [6, 4] },
    });
    map.addLayer({
      id: 'measure-label', type: 'symbol', source: 'measure',
      filter: ['==', ['get', 'kind'], 'label'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Roboto Regular', 'Noto Sans Regular'],
        'text-size': 11, 'text-anchor': 'center',
        'text-allow-overlap': true, 'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5, 'text-opacity': 0.9 },
    });

    // ── Leader lines ─────────────────────────────────────────────────────
    map.addSource('leaders', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'leader-lines', type: 'line', source: 'leaders',
      paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'opacity'], 'line-width': 0.75 },
    });

    // ── Track icons ──────────────────────────────────────────────────────
    map.addSource('units', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'unit-squares', type: 'symbol', source: 'units',
      layout: {
        'icon-image': [
          'case',
          ['==', ['get', 'category'], 3],
          ['match', ['get', 'coalition'], 1,'gnd-neutral', 2,'gnd-red', 3,'gnd-blue', 'gnd-neutral'],
          ['==', ['get', 'category'], 4],
          ['match', ['get', 'coalition'], 1,'ship-neutral', 2,'ship-red', 3,'ship-blue', 'ship-neutral'],
          ['get', 'onGround'],
          ['match', ['get', 'coalition'], 1,'ac-neutral', 2,'ac-red', 3,'ac-blue', 'ac-neutral'],
          ['match', ['get', 'coalition'], 1,'sq-neutral', 2,'sq-red', 3,'sq-blue', 'sq-neutral'],
        ],
        'icon-rotate':             ['case', ['get', 'onGround'], ['get', 'heading'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap':      true,
        'icon-ignore-placement':   true,
        'icon-size':               1,
      },
      paint: { 'icon-opacity': ['get', 'opacity'] },
    });

    // ── Emergency blinking square — rendered over the track icon ─────────
    // Uses the units source (which has emergency + emergencyColor properties).
    // Opacity is toggled globally via setPaintProperty() on each 500 ms pulse tick;
    // no per-frame source rebuild required.
    map.addLayer({
      id: 'unit-emerg-square', type: 'symbol', source: 'units',
      filter: ['!=', ['get', 'emergency'], ''],
      layout: {
        'icon-image': ['match', ['get', 'emergency'],
          'gen',    'emerg-gen',
          'radio',  'emerg-radio',
          'hijack', 'emerg-hijack',
          'emerg-gen',
        ],
        'icon-allow-overlap':    true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': 0.9 },
    });

    // ── Labels ───────────────────────────────────────────────────────────
    // text-offset is data-driven: default labels use TEXT_OFFSET_EM (em-based,
    // pixel-stable); dragged labels are placed at their geographic position
    // with offset [0,0] so they stay in the same map location across zoom levels.
    map.addSource('labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    // Single label layer — no emergency text halo; emergency is shown via the
    // blinking square icon layer above.
    map.addLayer({
      id: 'unit-labels', type: 'symbol', source: 'labels',
      layout: {
        'text-field': ['format',
          ['get', 'callsign'], {},
          // Add '\n' after callsign only when there's something on subsequent lines
          ['case', ['any', ['!=', ['get', 'infoLine'], ''], ['!=', ['get', 'sqTag'], '']], '\n', ''], {},
          ['get', 'infoLine'], {},
          // Add '\n' between info and sqTag only when both are present
          ['case', ['all', ['!=', ['get', 'infoLine'], ''], ['!=', ['get', 'sqTag'], '']], '\n', ''], {},
          ['get', 'sqTag'], {'text-color': ['get', 'sqColor']},
        ],
        'text-font': ['Roboto Regular', 'Noto Sans Regular'],
        'text-size': TEXT_SIZE_PX, 'text-anchor': 'center', 'text-justify': 'left',
        'text-offset': ['get', 'textOffset'],
        'text-allow-overlap': true, 'text-ignore-placement': true,
      },
      paint: {
        'text-color':   ['get', 'color'],
        'text-opacity': ['get', 'opacity'],
      },
    });

    // ── Cursor ───────────────────────────────────────────────────────────
    map.getCanvas().style.cursor = 'crosshair';

    // ── Label drag ────────────────────────────────────────────────────────
    // Labels are dragged to geographic positions (zoom-stable after drop).
    map.on('mouseenter', 'unit-labels', () => {
      if (!_drag) map.getCanvas().style.cursor = 'grab';
    });
    map.on('mouseleave', 'unit-labels', () => {
      if (!_drag) map.getCanvas().style.cursor = 'crosshair';
    });

    map.on('mousedown', 'unit-labels', (e) => {
      if (e.originalEvent.button !== 0) return;
      e.preventDefault();

      const id    = String(e.features[0].properties.id);
      const track = tracks.get(id);
      if (!track) return;

      // Compute the label's current relative offset from the track [dLat, dLon]
      let startRelLat, startRelLon;
      const relOff = labelOffsets.get(id);
      if (relOff) {
        [startRelLat, startRelLon] = relOff;
      } else {
        // Default position: convert em pixel offset to a geo delta at current zoom
        const iconPx   = map.project([track.lon, track.lat]);
        const labelPx  = [
          iconPx.x + TEXT_OFFSET_EM[0] * getTextSizePx(),
          iconPx.y + TEXT_OFFSET_EM[1] * getTextSizePx(),
        ];
        const labelGeo = map.unproject(labelPx);
        startRelLat    = labelGeo.lat - track.lat;
        startRelLon    = labelGeo.lng - track.lon;
      }

      const startMouse = map.unproject([e.point.x, e.point.y]);
      _drag = { id, startMouseLat: startMouse.lat, startMouseLon: startMouse.lng, startRelLat, startRelLon };
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
    });

    // ── Left-click on ground vehicle or ship → label popup ───────────────
    map.on('click', 'unit-squares', (e) => {
      const feat = e.features && e.features[0];
      if (!feat) return;
      const cat = feat.properties.category;
      if (cat !== 3 && cat !== 4) return;
      e.preventDefault();
      showGroundLabelPopup(String(feat.properties.id), e.originalEvent.clientX, e.originalEvent.clientY);
    });

    // ── Combined mousemove: BRA + label drag + measure line ───────────────
    map.getCanvas().addEventListener('mousemove', (e) => {
      updateBullseyeCursor(e);

      if (_drag) {
        const rect  = map.getCanvas().getBoundingClientRect();
        const mouse = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        const dLat  = mouse.lat - _drag.startMouseLat;
        const dLon  = mouse.lng - _drag.startMouseLon;
        // Store relative offset [dLat, dLon] from track position so the label follows the track
        labelOffsets.set(_drag.id, [_drag.startRelLat + dLat, _drag.startRelLon + dLon]);
        updateMap();
      }

      if (_measure) {
        const rect  = map.getCanvas().getBoundingClientRect();
        const point = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        updateMeasureLine(_measure.startLng, _measure.startLat, point.lng, point.lat);
      }
    });

    map.getCanvas().addEventListener('mouseup', () => {
      if (!_drag) return;
      _drag = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = 'crosshair';
    });

    // ── Right-click measure line ─────────────────────────────────────────
    map.getCanvas().addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      e.preventDefault();
      const rect   = map.getCanvas().getBoundingClientRect();
      const point  = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      _measure = { startLng: point.lng, startLat: point.lat };
      map.dragPan.disable();
    });

    map.getCanvas().addEventListener('contextmenu', (e) => e.preventDefault());

    map.getCanvas().addEventListener('mouseup', (e) => {
      if (e.button !== 2 || !_measure) return;
      _measure = null;
      map.dragPan.enable();
      map.getSource('measure').setData({ type: 'FeatureCollection', features: [] });
    });

    mapReady = true;
    applyScale();
    applyMapTheme();
    if (missionData) {
      map.getSource('airports').setData(buildAirports());
      map.getSource('bullseye').setData(buildBullseye());
      map.getSource('navpoints').setData(buildNavpoints());
      map.getSource('drawings').setData(buildDrawings());
    }
  });
}

// ── Map theme ─────────────────────────────────────────────────────────────
// Switches base-layer colors between dark (radar scope) and light without
// reloading the style (which would destroy all custom GeoJSON layers).

function applyMapTheme() {
  if (!mapReady) return;
  const light = settings.lightMode;

  // Background (land)
  map.setPaintProperty('Background', 'background-color', light ? '#f4f3f0' : '#141414');

  // Water — in dark mode use a distinct dark blue-grey so land/water are easy to tell apart
  map.setPaintProperty('Water', 'fill-color', light ? '#c0d8e8' : '#07111a');

  // Rivers
  map.setPaintProperty('River', 'line-color', light ? '#a0c0d8' : '#0f0f0f');

  // Country borders
  map.setPaintProperty('Country border', 'line-color', light ? '#9a9690' : '#2a2a2a');

  // Airport zone fill
  map.setPaintProperty('Airport zone', 'fill-color', light ? '#e8e6e2' : '#111111');

  // Aeroway lines (runway / taxiway)
  map.setPaintProperty('Aeroway', 'line-color', light
    ? ['match', ['get', 'class'], 'runway', '#8a9a8a', 'taxiway', '#aabaa8', '#9aaa98']
    : ['match', ['get', 'class'], 'runway', '#4a5a4a', 'taxiway', '#2a3a2a', '#1a2a1a']);

  // Text labels — halo flips so text stays readable
  const labelPaint = light
    ? { color: '#3a3a3a', halo: '#ffffff' }
    : { color: '#5a6a5a', halo: '#000000' };

  map.setPaintProperty('Taxiway labels', 'text-color',      labelPaint.color);
  map.setPaintProperty('Taxiway labels', 'text-halo-color', labelPaint.halo);
  map.setPaintProperty('Airport gate',  'text-color',      labelPaint.color);
  map.setPaintProperty('Airport gate',  'text-halo-color', labelPaint.halo);

  const placePaint = light
    ? { color: '#2a2a2a', halo: '#ffffff' }
    : { color: '#404040', halo: '#000000' };

  map.setPaintProperty('Country labels',  'text-color',      placePaint.color);
  map.setPaintProperty('Country labels',  'text-halo-color', placePaint.halo);

  // Airport labels — halo only needed in dark mode for contrast
  map.setPaintProperty('airport-labels', 'text-halo-width', light ? 0 : 1);
  map.setPaintProperty('airport-labels', 'text-halo-color', light ? '#ffffff' : '#000000');

  // Measure line + label
  const measureColor = light ? '#333333' : '#ffffff';
  map.setPaintProperty('measure-line',  'line-color',  measureColor);
  map.setPaintProperty('measure-label', 'text-color',  measureColor);
  map.setPaintProperty('measure-label', 'text-halo-color', light ? '#ffffff' : '#000000');
  map.setPaintProperty('measure-label', 'text-halo-width', light ? 0 : 1.5);
  // Rebuild drawings so line color (white vs dark) updates
  if (missionData) map.getSource('drawings').setData(buildDrawings());
  // Re-register coalition icons with theme-correct colors
  updateIcons(light);
}
