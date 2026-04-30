'use strict';

// ── Constants ─────────────────────────────────────────────────────────────

const COALITION_COLOR  = { 1: '#888888', 2: '#cc4444', 3: '#4488cc' };
const GROUND_COLOR     = { 1: '#7a7a68', 2: '#aa6644', 3: '#557799' };
const HISTORY_MAX      = 10;
const FADE_DURATION_MS = 10000;
const STALE_MS         = 10000;
const MIN_SPD_KT_PPL   = 30;

const GROUND_RADIUS_M  = 5000;
const GROUND_AGL_M     = 50;

const CRC_RANGE_NM     = 200;
const CRC_RANGE_M      = CRC_RANGE_NM * 1852;

// Default label position and geometry constants (used by geojson.js + map-setup.js)
const TEXT_SIZE_PX     = 11;
const TEXT_OFFSET_EM   = [4.0, -0.5]; // em units [right, up] from icon
const LEADER_ICON_GAP  = 7;
const LABEL_HALF_W     = 30;
const LABEL_HALF_H     = 13;
const LABEL_EDGE_MARGIN = 2;

const SQUAWK_EMERGENCY = { 7700: 'gen', 7600: 'radio', 7500: 'hijack' };
const EMERGENCY_COLOR  = { gen: '#cc2222', radio: '#b8a000', hijack: '#cc6600' };

// ── State ─────────────────────────────────────────────────────────────────

// Track IDs are normalised to strings on receipt so Map lookups are consistent
// regardless of whether the server sends them as numbers or strings.
const tracks       = new Map(); // id(string) → track
const history      = new Map(); // id → [{lat, lon, alt, timestamp}, ...]
const fading       = new Map(); // id → {track, lastHist, goneAt}
// labelOffsets stores dragged label positions as [lat, lon] geographic coordinates.
// Tracks with no entry use the default TEXT_OFFSET_EM via text-offset in the layer.
const labelOffsets = new Map(); // id → [lat, lon]

let missionData      = null;
let grpcStatus       = 'disconnected';
let srsStatus        = 'disconnected';
let lastUpdateMs     = null;
let mapReady         = false;
let map;
let _drag            = null;
let _measure         = null;
let _pulseBright     = true;
let selectedRef      = null; // string track id
let selectedApt      = null;
let _ws              = null;
let activeView       = 'crc';
let approachRwyCourse = null; // runway QFU in degrees (e.g. 230 for RWY 23)
// approachData stores per-track user-entered fields for the approach table.
// id → { atis: bool, app: string, ldg: string, wpt: string }
const approachData = new Map();

// ── Sweep clock ───────────────────────────────────────────────────────────
// Each track's visual update is deferred until the virtual rotating beam
// reaches that track's bearing — producing the classic radar sweep appearance.

let _sweepPeriodMs = 5000;
let _sweepStartMs  = Date.now();
const _pendingTimers = new Map();

function _currentSweepAngle() {
  return ((Date.now() - _sweepStartMs) % _sweepPeriodMs) / _sweepPeriodMs * 360;
}

function _radarCenter() {
  if (activeView === 'airport' && selectedApt) return selectedApt;
  if (activeView === 'crc' && selectedRef) {
    const ref = tracks.get(selectedRef);
    if (ref) return ref;
  }
  if (missionData && missionData.bullseye) {
    if (missionData.bullseye.blue) return missionData.bullseye.blue;
    if (missionData.bullseye.red)  return missionData.bullseye.red;
  }
  if (map) { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; }
  return { lat: 37, lon: 35 };
}

function _scheduleSweepUpdate(t) {
  if (_pendingTimers.has(t.id)) {
    clearTimeout(_pendingTimers.get(t.id));
    _pendingTimers.delete(t.id);
  }
  const center  = _radarCenter();
  const bearing = bearingDeg(center.lat, center.lon, t.lat, t.lon);
  const delta   = (bearing - _currentSweepAngle() + 360) % 360;
  const delay   = delta / 360 * _sweepPeriodMs;

  const handle = setTimeout(() => {
    _pendingTimers.delete(t.id);
    tracks.set(t.id, t);
    fading.delete(t.id);
    pushHistory(t.id, t);
    lastUpdateMs = Date.now();
    updateMap();
  }, delay);

  _pendingTimers.set(t.id, handle);
}

// ── Settings ──────────────────────────────────────────────────────────────

const DEFAULTS = {
  pplEnabled:    true,
  pplDuration:   60,
  trailEnabled:  true,
  trailLength:   10,
  aiEnabled:     true,
  shipsEnabled:  false,
  braColor:      '#4488cc',
  squawkMap:     {}, // squawk code (string) → display callsign
  scale:         1.0,
  lightMode:     false,
};

let settings = { ...DEFAULTS };

function loadSettings() {
  try {
    const raw = localStorage.getItem('crc-settings');
    if (raw) settings = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {}
}

function saveSettings() {
  localStorage.setItem('crc-settings', JSON.stringify(settings));
}

// ── Scale helpers ─────────────────────────────────────────────────────────
// All size constants are multiplied by the user-selected scale factor.

function getScale()              { return settings.scale || 1.0; }
function getTextSizePx()         { return TEXT_SIZE_PX         * getScale(); }
function getLeaderIconGap()      { return LEADER_ICON_GAP       * getScale(); }
function getLabelHalfW()         { return LABEL_HALF_W          * getScale(); }
function getLabelHalfH()         { return LABEL_HALF_H          * getScale(); }

// Apply scale to all MapLibre layer properties.
// Called on map load and whenever the scale setting changes.
function applyScale() {
  if (!mapReady) return;
  const s = getScale();
  map.setLayoutProperty('unit-squares',      'icon-size',    s);
  map.setLayoutProperty('unit-emerg-square', 'icon-size',    s);
  map.setLayoutProperty('unit-labels',       'text-size',    getTextSizePx());
  map.setLayoutProperty('navpt-labels',      'text-size',    9 * s);
  map.setPaintProperty('trail-dots',         'circle-radius', 1.5 * s);
  map.setPaintProperty('leader-lines',       'line-width',    0.75 * s);
  map.setPaintProperty('ppl-lines',          'line-width',    s);
  // Rebuild geometry that depends on pixel sizes (leader lines, labels)
  updateMap();
}

// ── History management ────────────────────────────────────────────────────

function pushHistory(id, track) {
  if (!history.has(id)) history.set(id, []);
  const h = history.get(id);
  h.push({ lat: track.lat, lon: track.lon, alt: track.alt, timestamp: Date.now() });
  const max = settings.trailLength ?? HISTORY_MAX;
  if (h.length > max) h.splice(0, h.length - max);
}

function cleanFading() {
  const now = Date.now();
  for (const [id, f] of fading) {
    if (now - f.goneAt >= FADE_DURATION_MS) {
      fading.delete(id);
      history.delete(id);
    }
  }
}

// ── Track state ───────────────────────────────────────────────────────────

function applySnapshot(trackList) {
  for (const handle of _pendingTimers.values()) clearTimeout(handle);
  _pendingTimers.clear();
  tracks.clear();
  fading.clear();
  for (const t of trackList) {
    tracks.set(t.id, t);
    pushHistory(t.id, t);
  }
  _sweepStartMs = Date.now();
  lastUpdateMs  = Date.now();
  updateMap();
}

function applyDelta(updated, gone) {
  for (const id of gone) {
    if (_pendingTimers.has(id)) {
      clearTimeout(_pendingTimers.get(id));
      _pendingTimers.delete(id);
    }
    const t = tracks.get(id);
    if (t) {
      const h = history.get(id);
      fading.set(id, { track: t, lastHist: h ? [...h] : [], goneAt: Date.now() });
      tracks.delete(id);
    }
    if (id === selectedRef) {
      selectedRef = null;
      updateRefDisplay();
    }
  }
  for (const t of updated) {
    _scheduleSweepUpdate(t);
  }
  if (gone.length > 0) {
    lastUpdateMs = Date.now();
    updateMap();
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────

function sendSelectView(viewId, params) {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ version: 2, type: 'select_view', view: viewId, params: params || {} }));
  }
}

// Normalise a track so its .id is always a string (server may send numbers).
function normaliseTrack(t) {
  return t.id === String(t.id) ? t : { ...t, id: String(t.id) };
}

function connect() {
  const ws = new WebSocket(`ws://${window.location.host}`);
  _ws = ws;

  ws.onopen = () => console.log('[ws] connected');

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }

    switch (msg.type) {
      case 'status':
        grpcStatus = msg.grpc;
        srsStatus  = msg.srs;
        updateStatusUI();
        updateMap();
        break;
      case 'init':
        missionData = msg;
        if (mapReady) {
          map.getSource('airports').setData(buildAirports());
          map.getSource('bullseye').setData(buildBullseye());
          map.getSource('navpoints').setData(buildNavpoints());
          map.getSource('drawings').setData(buildDrawings());
        }
        break;
      case 'snapshot':
        applySnapshot((msg.tracks || []).map(normaliseTrack));
        break;
      case 'delta':
        applyDelta(
          (msg.updated || []).map(normaliseTrack),
          (msg.gone    || []).map(id => String(id)),
        );
        break;
    }
  };

  ws.onclose = () => {
    if (_ws === ws) _ws = null;
    grpcStatus = 'disconnected';
    srsStatus  = 'disconnected';
    updateStatusUI();
    updateMap();
    setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();
}

// ── Periodic maintenance ──────────────────────────────────────────────────

setInterval(() => {
  checkStale();
  if (fading.size > 0 || grpcStatus !== 'connected') updateMap();
}, 500);

setInterval(() => {
  _pulseBright = !_pulseBright;
  let hasIdent = false, hasEmerg = false;
  for (const t of tracks.values()) {
    if (t.squawkStatus === 2)   hasIdent = true;
    if (squawkEmergency(t.squawk)) hasEmerg = true;
    if (hasIdent && hasEmerg) break;
  }
  // Ident: rebuild dots so the track icon opacity pulses
  if (hasIdent) updateMap();
  // Emergency: toggle the blinking square layer opacity without a full rebuild
  if (mapReady) {
    map.setPaintProperty('unit-emerg-square', 'icon-opacity', _pulseBright ? 0.95 : 0.12);
  }
}, 500);

// ── Boot ──────────────────────────────────────────────────────────────────

loadSettings();
initMap();
initSettings();
initCallsPanel();
initViewSelector();
initRefSelector();
initAptSelector();
initApproachPanel();
updateViewUI();
connect();
