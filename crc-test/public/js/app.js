'use strict';

// ── Constants ─────────────────────────────────────────────────────────────

const COALITION_COLOR       = { 1: '#888888', 2: '#cc4444', 3: '#4488cc' };
const LIGHT_COALITION_COLOR = { 1: '#505050', 2: '#cc0000', 3: '#004499' }; // higher contrast on light map
const GROUND_COLOR          = { 1: '#7a7a68', 2: '#aa6644', 3: '#557799' };
const HISTORY_MAX      = 10;
const FADE_DURATION_MS = 10000;
const STALE_MS         = 10000;
const MIN_SPD_KT_PPL   = 30;

const GROUND_RADIUS_M  = 5000;
const GROUND_AGL_M     = 50;

const CRC_RANGE_NM     = 200;
const CRC_RANGE_M      = CRC_RANGE_NM * 1852;

// Default label position and geometry constants (used by geojson.js + map-setup.js)
const TEXT_SIZE_PX      = 11;
const TEXT_OFFSET_EM    = [4.0, -0.5]; // em units [right, up] from icon
const LEADER_ICON_GAP   = 7;
const LABEL_HALF_W      = 30;
const LABEL_HALF_H      = 13;
const LABEL_EDGE_MARGIN = 2;

const SQUAWK_EMERGENCY = { 7700: 'gen', 7600: 'radio', 7500: 'hijack' };
const EMERGENCY_COLOR  = { gen: '#cc2222', radio: '#b8a000', hijack: '#cc6600' };

// Radar sweep
const SWEEP_BEAM_DEG  = 4;   // rotating beam width in degrees
const SWEEP_INTERVAL  = 50;  // ms between sweep ticks

// ── State ─────────────────────────────────────────────────────────────────

// latestFromServer: all track data as received from server (no filtering).
// tracks: tracks currently visible on scope (illuminated by at least one radar).
// lastSweepMs: when each track was last hit by a radar beam.
const latestFromServer = new Map(); // id → track (raw server data)
const tracks           = new Map(); // id → track (displayed)
const history          = new Map(); // id → [{lat, lon, alt, timestamp}, ...]
const labelOffsets     = new Map(); // id → [dLat, dLon] relative to track

// Per-radar sweep state
const radarSweepStart  = new Map(); // radarId → sweepStartMs
const noseScanLastMs   = new Map(); // radarId → lastScanMs (nose radars)
const lastSweepMs      = new Map(); // trackId → timestamp of last illumination
const zeroSpeedSinceMs = new Map(); // trackId → timestamp when 0-speed-airborne first detected

// User-assigned labels for ground vehicles (persists across view switches)
const groundLabels = new Map(); // trackId → string

// Static reference data loaded at startup
let aircraftTypes = {};
let airportsDb    = {};

let missionData      = null;
let weather          = { pressurePa: 101325, tempK: 288.15 }; // ISA defaults until server sends live data
let grpcStatus       = 'disconnected';
let noRadarsActive   = false; // true when all radars are disabled / none available
let srsStatus        = 'disconnected';
let lastUpdateMs     = null;
let mapReady         = false;
let map;
let _drag            = null;
let _measure         = null;
let _pulseBright     = true;
let selectedRef      = null; // string track id (reference)
let selectedApt      = null;
let _ws              = null;
let approachRwyCourse = null; // used for approach-vector line

// Radar selector — opt-in: only radars in this set are used for tracking.
// Default: all off.  User enables radars from the RADARS panel.
const enabledRadarIds = new Set();

// ── Static data ───────────────────────────────────────────────────────────

async function loadStaticData() {
  try {
    const [at, ap] = await Promise.all([
      fetch('/data/aircraft-types.json').then(r => r.json()),
      fetch('/data/airports.json').then(r => r.json()),
    ]);
    // Strip the _comment key
    // Remove comment keys so they don't appear in type lookups
    Object.keys(at).filter(k => k.startsWith('_comment')).forEach(k => delete at[k]);
    delete ap._comment;
    aircraftTypes = at;
    airportsDb    = ap;
    console.log(`[crc] loaded ${Object.keys(aircraftTypes).length} aircraft types, ${Object.keys(airportsDb).length} airports`);
  } catch (e) {
    console.warn('[crc] failed to load static data:', e);
  }
}

// ── Settings ──────────────────────────────────────────────────────────────

const DEFAULTS = {
  pplEnabled:    true,
  pplDuration:   60,
  trailEnabled:  true,
  trailLength:   10,
  aiEnabled:         true,
  shipsEnabled:      false,
  hideGroundUnits:   false,
  braColor:      '#4488cc',
  magVar:        0,
  radarDebug:    false,
  squawkMap:     {},
  squawkSeq:     {}, // sequential ranges: { "1101": "HAT1" } → 1101→HAT11, 1102→HAT12…
  scale:         1.0,
  lightMode:     false,
  fadeGraceMs:    10000, // ms at full brightness after last sweep before fading starts
  navDeclutter:    true,  // hide navpoints whose names contain digits
  navDeclutter5:   true,  // hide navpoints whose names are not exactly 5 letters
  trailIntervalMs: 5000, // minimum ms between trail dot recordings
  declutter:       true,  // auto-hide labels for sequential-squawk formation flights
  datalink:        false, // auto-include all friendly aircraft radars
  transitionAltFt: 18000, // ft — below this use QNH, at/above use standard (FL)
  gameTimeOffset:  0,     // hours — theater UTC offset subtracted to display Zulu
  aprtManualWx:    {},    // per-airport manually-entered vis/cloud data, keyed by ICAO
  aprtAtisFreq:    {},    // per-airport saved ATIS frequency, keyed by ICAO
  // ── Colours ───────────────────────────────────────────────────────────────
  colFriendly:    '#4488cc',
  colBogey:       '#ccaa00',
  colNeutral:     '#888888',
  colBandit:      '#cc6600',
  colHostile:     '#cc2222',
  colEmergGen:    '#cc2222',   // 7700 general emergency
  colEmergRadio:  '#b8a000',   // 7600 radio failure
  colEmergHijack: '#cc6600',   // 7500 hijack
  colRangeRing:   '#8aaa6a',
  colNavpoint:    '#3a5a3a',
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

// DCS altimeter model (reverse-engineered from flight test data).
// Atmosphere: full ISA piecewise (troposphere + isothermal stratosphere).
// Altimeter inversion: troposphere formula only, with empirical T_REF_ALT.
const ISA_T0 = 288.15, ISA_P0 = 101325, ISA_L = 0.0065;
const ISA_G = 9.80665, ISA_R = 287.05287;
const ISA_EXP = ISA_G / (ISA_R * ISA_L);   // G/(R*L) ≈ 5.2559
const ISA_INV = (ISA_R * ISA_L) / ISA_G;   // R*L/G ≈ 0.19026
const H_TROP = 11000.0;                     // m, tropopause
const T_REF_ALT = 288.97;                   // K, empirical DCS altimeter reference

function _pressureAtAlt(zM, seaPa, T0) {
  if (zM <= H_TROP) {
    return seaPa * Math.pow(1 - ISA_L * zM / T0, ISA_EXP);
  }
  const T_trop = T0 - ISA_L * H_TROP;
  const P_trop = seaPa * Math.pow(1 - ISA_L * H_TROP / T0, ISA_EXP);
  return P_trop * Math.exp(-ISA_G * (zM - H_TROP) / (ISA_R * T_trop));
}

function indicatedAltFt(trueAltM) {
  const { pressurePa, tempK } = weather;
  const trueAltFt = trueAltM / 0.3048;
  const taFt = settings.transitionAltFt ?? 18000;

  const P = _pressureAtAlt(trueAltM, pressurePa, tempK);
  if (trueAltFt >= taFt) {
    // FL: altimeter set to standard pressure (ISA_P0)
    return ((T_REF_ALT / ISA_L) * (1 - Math.pow(P / ISA_P0, ISA_INV))) / 0.3048;
  } else {
    // QNH: altimeter set to live sea-level pressure
    return ((T_REF_ALT / ISA_L) * (1 - Math.pow(P / pressurePa, ISA_INV))) / 0.3048;
  }
}

function loadEnabledRadars() {
  try {
    const raw = localStorage.getItem('crc-enabled-radars');
    if (raw) JSON.parse(raw).forEach(id => enabledRadarIds.add(id));
  } catch (_) {}
}

function saveEnabledRadars() {
  localStorage.setItem('crc-enabled-radars', JSON.stringify([...enabledRadarIds]));
}

// ── Scale helpers ─────────────────────────────────────────────────────────

function getScale()         { return settings.scale || 1.0; }
function getTextSizePx()    { return TEXT_SIZE_PX    * getScale(); }
function getLeaderIconGap() { return LEADER_ICON_GAP * getScale(); }
function getLabelHalfW()    { return LABEL_HALF_W    * getScale(); }
function getLabelHalfH()    { return LABEL_HALF_H    * getScale(); }

function applyScale() {
  if (!mapReady) return;
  const s = getScale();
  map.setLayoutProperty('unit-squares',      'icon-size',     s);
  map.setLayoutProperty('unit-emerg-square', 'icon-size',     s);
  map.setLayoutProperty('unit-labels',       'text-size',     getTextSizePx());
  map.setLayoutProperty('navpt-labels',      'text-size',     9 * s);
  map.setPaintProperty('trail-dots',         'circle-radius', 1.5 * s);
  map.setPaintProperty('leader-lines',       'line-width',    0.75 * s);
  map.setPaintProperty('ppl-lines',          'line-width',    s);
  updateMap();
}

// ── History management ────────────────────────────────────────────────────

function pushHistory(id, track) {
  if (!history.has(id)) history.set(id, []);
  const h        = history.get(id);
  const minGapMs = settings.trailIntervalMs ?? 5000;
  const now      = Date.now();
  // Drop the new point if the last stored dot is too recent
  if (h.length > 0 && now - h[h.length - 1].timestamp < minGapMs) return;
  h.push({ lat: track.lat, lon: track.lon, alt: track.alt, timestamp: now });
  const max = settings.trailLength ?? HISTORY_MAX;
  if (h.length > max) h.splice(0, h.length - max);
}

// ── Radar simulation ──────────────────────────────────────────────────────

const _HELIPAD_RE = /helipad|farp|fob/i;

// Cache for getAllRadars() — valid for one sweep interval (< SWEEP_INTERVAL ms).
// Avoids rebuilding the radar list on every call within the same tick.
let _allRadarsCache   = null;
let _allRadarsCacheMs = 0;

function invalidateRadarsCache() {
  _allRadarsCache = null;
}

// Returns every radar that could potentially be active (regardless of user toggle).
// type: 'airport' | 'approach' | 'awacs' | 'fighter' | 'carrier'
function getAllRadars() {
  const now = Date.now();
  if (_allRadarsCache && now - _allRadarsCacheMs < SWEEP_INTERVAL - 5) return _allRadarsCache;
  _allRadarsCache   = _buildAllRadars();
  _allRadarsCacheMs = now;
  return _allRadarsCache;
}

function _buildAllRadars() {
  const radars   = [];
  const airports = (missionData && missionData.airports) || [];

  for (const apt of airports) {
    if (!apt.lat || !apt.lon) continue;
    if (apt.name === 'H' || _HELIPAD_RE.test(apt.name)) continue;
    const aptLabel = apt.icao || apt.name;

    radars.push({
      id: `apt:${apt.name}`, type: 'airport', label: aptLabel,
      lat: apt.lat, lon: apt.lon, rangeM: 40 * 1852, sweepMs: 2000,
      seesGround: true, seesShips: false, noGroundAircraft: false,
      angleFromNose: 360, heading: 0,
    });

    radars.push({
      id: `app:${apt.name}`, type: 'approach', label: aptLabel + ' APP',
      lat: apt.lat, lon: apt.lon, rangeM: 80 * 1852, sweepMs: 3000,
      seesGround: false, seesShips: false, noGroundAircraft: true,
      angleFromNose: 360, heading: 0,
    });
  }

  for (const t of latestFromServer.values()) {
    if (t.category !== 1 && t.category !== 2) continue;
    const spec = aircraftTypes[t.type];
    if (!spec || !spec.radar) continue;
    const onGnd = checkOnGround(t);
    // 360° rotating dish → AWACS; forward-looking nose radar → fighter
    const radarType = spec.radar.angleFromNose === 360 ? 'awacs' : 'fighter';
    radars.push({
      id: `crc:${t.id}`, type: radarType, label: resolveCallsign(t),
      sublabel: spec.label || t.type,
      lat: t.lat, lon: t.lon,
      rangeM: spec.radar.rangeNm * 1852, sweepMs: spec.radar.sweepMs,
      seesGround: false, seesShips: true, noGroundAircraft: true,
      angleFromNose: spec.radar.angleFromNose, heading: t.heading || 0,
      onGround: onGnd,
      coalition: t.coalition,
    });
  }

  // Ship radars — all category-4 tracks get a radar entry.
  // Known types (in aircraft-types.json with carrierRadar) use their spec;
  // unknown ship types fall back to a generic 40 nm surface-search radar.
  const SHIP_RADAR_DEFAULT = { rangeNm: 40, sweepMs: 5000 };
  for (const t of latestFromServer.values()) {
    if (t.category !== 4) continue;
    const spec      = aircraftTypes[t.type];
    const radarSpec = (spec && spec.carrierRadar) || SHIP_RADAR_DEFAULT;
    radars.push({
      id: `carrier:${t.id}`, type: 'carrier',
      label:    resolveCallsign(t) || (spec && spec.label) || t.type,
      sublabel: (spec && spec.label) || t.type,
      lat: t.lat, lon: t.lon,
      rangeM: radarSpec.rangeNm * 1852, sweepMs: radarSpec.sweepMs,
      seesGround: false, seesShips: true, noGroundAircraft: true,
      angleFromNose: 360, heading: 0,
      onGround: false,
    });
  }

  return radars;
}

// Returns only the radars the user has explicitly enabled AND that are operational.
// When datalink is active, all friendly airborne aircraft radars are included automatically.
function getActiveRadars() {
  const all    = getAllRadars();
  const active = all.filter(r => enabledRadarIds.has(r.id) && !r.onGround);

  if (!settings.datalink) return active;

  // Datalink: auto-include every friendly coalition aircraft radar not already in the list
  const activeIds = new Set(active.map(r => r.id));
  for (const r of all) {
    if (activeIds.has(r.id)) continue;
    if (r.onGround) continue;
    if (r.type !== 'awacs' && r.type !== 'fighter') continue;
    if (r.coalition !== userCoalition) continue;
    active.push(r);
  }

  return active;
}

// Sweep simulation — runs every SWEEP_INTERVAL ms.
// For 360° radars: rotating beam illuminates each track as the beam passes over it.
// For nose radars: beam oscillates left→right→left within the cone (one pass = sweepMs).
setInterval(() => {
  const now    = Date.now();
  const radars = getActiveRadars();
  let   changed = false;

  // Per-tick on-ground cache: avoids repeating the airport-loop for each radar
  // that tests the same track. Only computed for cat 1/2 (the only ones checked).
  const onGroundCache = new Map();
  for (const [id, t] of latestFromServer) {
    if (t.category === 1 || t.category === 2) onGroundCache.set(id, checkOnGround(t));
  }

  for (const radar of radars) {
    if (radar.angleFromNose === 360) {
      if (!radarSweepStart.has(radar.id)) radarSweepStart.set(radar.id, now);
      const sweepAngle = ((now - radarSweepStart.get(radar.id)) % radar.sweepMs) / radar.sweepMs * 360;

      for (const [id, t] of latestFromServer) {
        if (t.category === 3 && !radar.seesGround) continue;
        if (t.category === 4 && !radar.seesShips) continue;
        if (radar.noGroundAircraft && (t.category === 1 || t.category === 2) && onGroundCache.get(id)) continue;
        const distM = haversineM(radar.lat, radar.lon, t.lat, t.lon);
        if (distM > radar.rangeM) continue;
        const bearing = bearingDeg(radar.lat, radar.lon, t.lat, t.lon);
        const diff = Math.abs(((bearing - sweepAngle + 540) % 360) - 180);
        if (diff > SWEEP_BEAM_DEG) continue;

        const prevSweep = lastSweepMs.get(id) || 0;
        tracks.set(id, t);
        lastSweepMs.set(id, now);
        if (now - prevSweep > 1000) pushHistory(id, t);
        changed = true;
      }

    } else {
      // Nose radar: oscillating beam sweeps left→right→left
      if (!radarSweepStart.has(radar.id)) radarSweepStart.set(radar.id, now);
      const halfAngle = radar.angleFromNose / 2;
      const cycleMs   = radar.sweepMs * 2;
      const phase     = ((now - radarSweepStart.get(radar.id)) % cycleMs) / cycleMs;
      const tNorm     = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      const beamAngle = (radar.heading - halfAngle + tNorm * radar.angleFromNose + 360) % 360;

      for (const [id, t] of latestFromServer) {
        if (t.category === 3 && !radar.seesGround) continue;
        if (t.category === 4 && !radar.seesShips) continue;
        if (radar.noGroundAircraft && (t.category === 1 || t.category === 2) && onGroundCache.get(id)) continue;
        const distM = haversineM(radar.lat, radar.lon, t.lat, t.lon);
        if (distM > radar.rangeM) continue;
        const bearing = bearingDeg(radar.lat, radar.lon, t.lat, t.lon);
        const diff = Math.abs(((bearing - beamAngle + 540) % 360) - 180);
        if (diff > SWEEP_BEAM_DEG) continue;

        const prevSweep = lastSweepMs.get(id) || 0;
        tracks.set(id, t);
        lastSweepMs.set(id, now);
        if (now - prevSweep > 1000) pushHistory(id, t);
        changed = true;
      }
    }
  }

  // "No radars active" overlay
  const newNoRadars = radars.length === 0;
  if (newNoRadars !== noRadarsActive) { noRadarsActive = newNoRadars; updateNoAwacsUI(); }

  // Zero-speed-airborne detection: track when each visible airborne track first hits 0 kt.
  // These tracks are faded out after the normal grace period even if the radar keeps sweeping them.
  for (const [id, t] of tracks) {
    if (t.category === 3 || t.category === 4) { zeroSpeedSinceMs.delete(id); continue; }
    if (onGroundCache.get(id)) { zeroSpeedSinceMs.delete(id); continue; }
    const hist = history.get(id) || [];
    const { speedKt } = kinematics(hist);
    if (speedKt < 1) {
      if (!zeroSpeedSinceMs.has(id)) zeroSpeedSinceMs.set(id, now);
    } else {
      zeroSpeedSinceMs.delete(id);
    }
  }

  // Remove expired (fully faded) tracks
  const totalTrackLifeMs = FADE_DURATION_MS + (settings.fadeGraceMs ?? 10000);
  for (const [id] of tracks) {
    const sinceLastSweep = now - (lastSweepMs.get(id) || 0);
    const zeroSince      = zeroSpeedSinceMs.get(id);
    const sinceZeroSpeed = zeroSince ? now - zeroSince : 0;
    if (sinceLastSweep > totalTrackLifeMs || sinceZeroSpeed > totalTrackLifeMs) {
      tracks.delete(id);
      lastSweepMs.delete(id);
      zeroSpeedSinceMs.delete(id);
      history.delete(id);
      labelOffsets.delete(id);
      if (id === selectedRef) { selectedRef = null; }
      changed = true;
    }
  }

  if (changed) {
    lastUpdateMs = now;
    updateMap();
  }

  // Radar debug overlay update (runs even when no track changed)
  if (settings.radarDebug && mapReady) {
    map.getSource('radar-debug').setData(buildRadarDebug(radars));
  }
}, SWEEP_INTERVAL);

// ── Track state ───────────────────────────────────────────────────────────

// Clear all sweep/display state — called on snapshot reload or view switch.
// latestFromServer is NOT cleared here; it holds raw server data.
function resetSweepState() {
  tracks.clear();
  lastSweepMs.clear();
  zeroSpeedSinceMs.clear();
  history.clear();
  labelOffsets.clear();
  radarSweepStart.clear();
  selectedRef = null;
  updateMap();
}

function applySnapshot(trackList) {
  latestFromServer.clear();
  invalidateRadarsCache();
  resetSweepState();
  for (const t of trackList) latestFromServer.set(t.id, t);
  lastUpdateMs = Date.now();
  updateMap();
  // Rebuild panel in case AWACS/carrier tracks changed the available radar list
  buildRadarPanelContent();
}

function applyDelta(updated, gone) {
  for (const id of gone) {
    latestFromServer.delete(id);
    // Displayed track stays in `tracks` and fades out naturally via lastSweepMs
  }
  for (const t of updated) {
    latestFromServer.set(t.id, t);
    // Do NOT update tracks here — position only updates when the radar beam hits the track.
  }
  invalidateRadarsCache();
}

// ── Zoom + pan limits ─────────────────────────────────────────────────────
// Computes the bounding rectangle of all active radar coverage areas (each
// radar treated as a square), then enforces that rectangle as the map bounds
// and sets minZoom so the full coverage area is always visible.
function updateZoomLimits() {
  if (!mapReady) return;
  const radars = getActiveRadars();

  if (radars.length === 0) {
    map.setMaxBounds(null);
    map.setMinZoom(2);
    return;
  }

  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  for (const r of radars) {
    const latDeg = r.rangeM / 111320;
    const lonDeg = r.rangeM / (111320 * Math.cos(r.lat * Math.PI / 180)) * 1.5;
    minLat = Math.min(minLat, r.lat - latDeg);
    maxLat = Math.max(maxLat, r.lat + latDeg);
    minLon = Math.min(minLon, r.lon - lonDeg);
    maxLon = Math.max(maxLon, r.lon + lonDeg);
  }

  // Aggressive: pad only 3% so the view is tightly constrained
  const padLat = (maxLat - minLat) * 0.03;
  const padLon = (maxLon - minLon) * 0.03;

  map.setMaxBounds([
    [minLon - padLon, minLat - padLat],
    [maxLon + padLon, maxLat + padLat],
  ]);

  // minZoom: just enough to see the full coverage rect at screen size
  const spanDeg = Math.max(maxLat - minLat, (maxLon - minLon) * 0.65);
  const minZoom = spanDeg > 12 ? 4 : spanDeg > 5 ? 5 : spanDeg > 2 ? 6 : 7;
  map.setMinZoom(minZoom);
}

// ── WebSocket ─────────────────────────────────────────────────────────────

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
      case 'weather':
        weather = { pressurePa: msg.pressurePa, tempK: msg.tempK };
        break;
      case 'game-time':
        updateGameTime(msg.datetime);
        break;
      case 'status':
        grpcStatus = msg.grpc;
        srsStatus  = msg.srs;
        updateStatusUI();
        updateMap();
        break;
      case 'init':
        missionData = msg;
        invalidateRadarsCache();
        if (mapReady) {
          map.getSource('airports').setData(buildAirports());
          map.getSource('bullseye').setData(buildBullseye());
          map.getSource('navpoints').setData(buildNavpoints());
          map.getSource('drawings').setData(buildDrawings());
        }
        // Rebuild radar panel so airport radars reflect the new mission
        buildRadarPanelContent();
        updateRadarBadge();
        // Refresh APRT panel airport list if panel is open
        refreshAprtAptList();
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
  if (grpcStatus !== 'connected') updateMap();
}, 500);

setInterval(() => {
  _pulseBright = !_pulseBright;
  let hasIdent = false, hasEmerg = false;
  for (const t of tracks.values()) {
    if (t.squawkStatus === 2)       hasIdent = true;
    if (squawkEmergency(t.squawk))  hasEmerg = true;
    if (hasIdent && hasEmerg) break;
  }
  if (hasIdent || hasEmerg) updateMap();
  if (mapReady) {
    map.setPaintProperty('unit-emerg-square', 'icon-opacity', _pulseBright ? 0.95 : 0.12);
  }
}, 500);

// ── Boot ──────────────────────────────────────────────────────────────────

loadSettings();
loadEnabledRadars();
loadUserCoalition();
loadIffOverrides();
loadTrackRenames();
loadTrackNumbers();
loadStaticData();
initMap();
initSettings();
initTrackPanel();
initCallsPanel();
initRadarPanel();
initAptSelector();
initRwyInput();
initCoalitionBtn();
initZuluClock();
initAprtPanel();
updateTopbarUI();
connect();

function initCoalitionBtn() {
  const $btn = document.getElementById('btn-coalition');
  if (!$btn) return;
  _updateCoalitionBtn($btn);
  $btn.addEventListener('click', () => {
    toggleUserCoalition();
    _updateCoalitionBtn($btn);
    updateMap();
  });
}

function _updateCoalitionBtn($btn) {
  const blue = getUserCoalition() === 3;
  $btn.textContent = blue ? 'BLUE' : 'RED';
  $btn.classList.toggle('coalition-red', !blue);
}
