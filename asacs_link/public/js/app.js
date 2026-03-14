/* ════════════════════════════════════════════════════════════
   ASACS LINK — GCI Dashboard client
   Handles: login → auth → WebSocket → simulation data → display
════════════════════════════════════════════════════════════ */

'use strict';

// ── Session storage keys ─────────────────────────────────────
const KEY_COALITION = 'asacs-coalition';

// ── State ────────────────────────────────────────────────────
let _ws           = null;
let _coalition    = null;
let _units        = [];
let _mission      = null;
let _lastUpdateTs = null;
let _clockInterval = null;

// ── DOM helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Helpers ───────────────────────────────────────────────────
function toast(msg, ms) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms || 2500);
}

function fmtBullseye(obj) {
  if (!obj || (obj.x == null && obj.y == null)) return '—';
  return `${Number(obj.x).toFixed(0)} / ${Number(obj.y).toFixed(0)}`;
}

function padZ(n) { return String(n).padStart(2, '0'); }

function fmtZulu(secs) {
  if (secs == null) return '—';
  const h = Math.floor(secs / 3600) % 24;
  const m = Math.floor(secs / 60) % 60;
  const s = Math.floor(secs) % 60;
  return `${padZ(h)}:${padZ(m)}:${padZ(s)}Z`;
}

// ── Login ──────────────────────────────────────────────────────
$('passwordInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitLogin();
});

async function submitLogin() {
  const pw  = $('passwordInput').value.trim();
  const err = $('loginError');
  err.textContent = '';

  if (!pw) { err.textContent = 'PASSWORD REQUIRED'; return; }

  try {
    const res = await fetch('/auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password: pw }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      err.textContent = (body.error || 'AUTHENTICATION FAILED').toUpperCase();
      return;
    }

    const { token, coalition } = await res.json();
    $('passwordInput').value = '';
    sessionStorage.setItem(KEY_COALITION, coalition);
    $('login-screen').style.display = 'none';
    $('app').classList.add('visible');
    initApp(token, coalition);

  } catch {
    err.textContent = 'SERVER UNREACHABLE';
  }
}

function logout() {
  sessionStorage.removeItem(KEY_COALITION);
  if (_ws) { _ws.close(); _ws = null; }
  clearInterval(_clockInterval);
  stopRawPoll();
  _units   = [];
  _mission = null;
  $('app').classList.remove('visible');
  $('login-screen').style.display = '';
  $('passwordInput').value = '';
  $('loginError').textContent = '';
  setStatus('offline');
}

// ── App init ──────────────────────────────────────────────────
async function initApp(token, coalition) {
  _coalition = coalition;

  const badge = $('coalitionBadge');
  badge.textContent = coalition.toUpperCase();
  badge.className   = 'coalition-badge ' + coalition.toLowerCase();

  // Fetch public config (Mapbox token) then init the map
  let mapboxToken = '';
  try {
    const cfgRes = await fetch('/api/config');
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      mapboxToken = cfg.mapboxToken || '';
    }
  } catch { /* map will show no-token message */ }

  // Initialise display modules
  AsacsMode.onModeChange(mode => {
    if (mode === 'mfd') AsacsMap.resize();
  });
  AsacsMode.init();
  AsacsMap.init(mapboxToken, 'map-container');

  connectWs(token);

  _clockInterval = setInterval(tickClock, 1000);
  startRawPoll();
}

// ── WebSocket ──────────────────────────────────────────────────
function connectWs(token) {
  setStatus('connecting');

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url   = `${proto}//${location.host}/?token=${encodeURIComponent(token)}`;
  const ws    = new WebSocket(url);
  _ws = ws;

  ws.addEventListener('open', () => {
    console.debug('[ASACS] WebSocket connected');
    setStatus('connected');
  });

  ws.addEventListener('message', e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { console.warn('[ASACS] Failed to parse WS message'); return; }
    handleMessage(msg);
  });

  ws.addEventListener('close', ev => {
    console.debug(`[ASACS] WebSocket closed: code=${ev.code}`);
    setStatus('offline');
    if (ev.code !== 4001 && ev.code !== 1000) {
      toast('CONNECTION LOST — RECONNECTING IN 5s');
      setTimeout(reauth, 5000);
    }
  });

  ws.addEventListener('error', () => {
    setStatus('error');
  });
}

async function reauth() {
  logout();
  toast('SESSION EXPIRED — PLEASE LOG IN AGAIN', 4000);
}

// ── Message handling ───────────────────────────────────────────
// Units here are already processed by the simulation engine (server-side)
// and filtered by the coalition filter before being sent to this client.
function handleMessage(msg) {
  switch (msg.type) {
    case 'snapshot':
    case 'update':
      _units        = msg.units || [];
      _lastUpdateTs = msg.ts || Date.now();
      AsacsTable.renderUnits(_units);
      AsacsMap.updateUnits(_units);
      updateStats();
      break;

    case 'mission':
      _mission = msg.data || null;
      renderMission();
      AsacsMap.updateMission(_mission);
      updateStats();
      break;

    case 'sim_stop':
      _units   = [];
      _mission = null;
      AsacsTable.renderUnits(_units);
      AsacsMap.updateUnits(_units);
      renderMission();
      updateStats();
      toast('SIMULATION STOPPED');
      break;

    default:
      console.debug('[ASACS] Unknown message type:', msg.type);
  }
}

// ── Status indicator ───────────────────────────────────────────
function setStatus(state) {
  const dot   = $('statusDot');
  const label = $('statusLabel');
  dot.className = 'status-dot';
  switch (state) {
    case 'connected':
      dot.classList.add('connected');
      label.textContent = 'CONNECTED';
      break;
    case 'connecting':
      label.textContent = 'CONNECTING…';
      break;
    case 'error':
      dot.classList.add('error');
      label.textContent = 'ERROR';
      break;
    default:
      label.textContent = 'OFFLINE';
  }
}

// ── Stats bar ──────────────────────────────────────────────────
function updateStats() {
  $('statTracks').textContent = _units.length;
  $('statLastUpdate').textContent = _lastUpdateTs
    ? new Date(_lastUpdateTs).toISOString().slice(11, 19) + 'Z'
    : '—';
  $('trackCount').textContent = `${_units.length} unit${_units.length !== 1 ? 's' : ''}`;
}

function tickClock() {
  if (!_mission || _mission.startTime == null) {
    $('statMissionTime').textContent = '—';
    return;
  }
  $('statMissionTime').textContent = fmtZulu(_mission.startTime);
}

// ── Mission strip ──────────────────────────────────────────────
function renderMission() {
  const strip = $('missionStrip');
  if (!_mission) {
    strip.classList.remove('visible');
    $('hdrMeta').textContent = 'GCI TACTICAL DISPLAY';
    return;
  }
  strip.classList.add('visible');

  const d = _mission.date || {};
  const dateStr = (d.year && d.month && d.day)
    ? `${d.year}-${padZ(d.month)}-${padZ(d.day)}`
    : '—';

  $('msnName').textContent    = _mission.name    || '—';
  $('msnTheatre').textContent = _mission.theatre || '—';
  $('msnDate').textContent    = dateStr;
  $('msnBullBlue').textContent = fmtBullseye(_mission.bullseye && _mission.bullseye.blue);
  $('msnBullRed').textContent  = fmtBullseye(_mission.bullseye && _mission.bullseye.red);

  $('hdrMeta').textContent = (_mission.name || '') + (_mission.theatre ? '  ·  ' + _mission.theatre : '');
}

// ── Raw DCS dump (polls /api/raw) ──────────────────────────────
let _rawPollInterval = null;

function startRawPoll() {
  fetchRaw();
  _rawPollInterval = setInterval(fetchRaw, 2000);
}

function stopRawPoll() {
  clearInterval(_rawPollInterval);
  _rawPollInterval = null;
}

async function fetchRaw() {
  // Only poll when in PROF mode — raw panel is not shown in MFD mode
  if (AsacsMode.getMode() !== 'prof') return;
  try {
    const res = await fetch('/api/raw');
    if (!res.ok) return;
    const data = await res.json();
    AsacsTable.renderRaw(data);
  } catch { /* silent */ }
}
