/* ════════════════════════════════════════════════════════════
   ASACS LINK — GCI Dashboard client
   Handles: login → auth → WebSocket → raw data display
════════════════════════════════════════════════════════════ */

'use strict';

// ── Session storage keys ─────────────────────────────────────
const KEY_COALITION = 'asacs-coalition';

// ── State ────────────────────────────────────────────────────
let _ws          = null;
let _coalition   = null;
let _units       = [];
let _mission     = null;
let _lastUpdateTs = null;
let _clockInterval = null;

// ── DOM refs ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Helpers ──────────────────────────────────────────────────
function toast(msg, ms) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms || 2500);
}

function fmtCoord(v, digits) {
  if (v == null) return '—';
  return Number(v).toFixed(digits || 4);
}

function fmtBullseye(obj) {
  if (!obj || (obj.x == null && obj.y == null)) return '—';
  return `${fmtCoord(obj.x, 0)} / ${fmtCoord(obj.y, 0)}`;
}

function coalitionName(id) {
  if (id === 0) return 'NEUTRAL';
  if (id === 1) return 'RED';
  if (id === 2) return 'BLUE';
  return String(id);
}

function padZ(n) { return String(n).padStart(2, '0'); }

function fmtZulu(secs) {
  if (secs == null) return '—';
  const h = Math.floor(secs / 3600) % 24;
  const m = Math.floor(secs / 60) % 60;
  const s = Math.floor(secs) % 60;
  return `${padZ(h)}:${padZ(m)}:${padZ(s)}Z`;
}

function relClass(rel) {
  if (!rel) return '';
  return 'rel-' + rel.toLowerCase();
}

// ── Login ────────────────────────────────────────────────────
document.getElementById('passwordInput').addEventListener('keydown', e => {
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
    // Clear the password field immediately — we only need the one-time token
    $('passwordInput').value = '';
    sessionStorage.setItem(KEY_COALITION, coalition);
    $('login-screen').style.display = 'none';
    $('app').classList.add('visible');
    initApp(token, coalition);

  } catch (ex) {
    err.textContent = 'SERVER UNREACHABLE';
  }
}

function logout() {
  sessionStorage.removeItem(KEY_COALITION);
  if (_ws) { _ws.close(); _ws = null; }
  clearInterval(_clockInterval);
  _units   = [];
  _mission = null;
  $('app').classList.remove('visible');
  $('login-screen').style.display = '';
  $('passwordInput').value = '';
  $('loginError').textContent = '';
  setStatus('offline');
}

// ── App init ─────────────────────────────────────────────────
function initApp(token, coalition) {
  _coalition = coalition;

  // Coalition badge
  const badge = $('coalitionBadge');
  badge.textContent = coalition.toUpperCase();
  badge.className   = 'coalition-badge ' + coalition.toLowerCase();

  connectWs(token);

  // Clock: update mission elapsed time every second
  _clockInterval = setInterval(tickClock, 1000);
}

// ── WebSocket ─────────────────────────────────────────────────
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
    try { msg = JSON.parse(e.data); } catch { console.warn('[ASACS] Failed to parse message:', e.data); return; }
    handleMessage(msg);
  });

  ws.addEventListener('close', ev => {
    console.debug(`[ASACS] WebSocket closed: code=${ev.code} reason=${ev.reason}`);
    setStatus('offline');
    if (ev.code !== 4001 && ev.code !== 1000) {
      toast('CONNECTION LOST — RECONNECTING IN 5s');
      setTimeout(() => {
        // Re-authenticate before reconnecting
        reauth();
      }, 5000);
    }
  });

  ws.addEventListener('error', (err) => {
    console.error('[ASACS] WebSocket error:', err);
    setStatus('error');
  });
}

async function reauth() {
  // Show login screen so the user can re-enter credentials.
  // We intentionally do not cache or reuse the password.
  logout();
  toast('SESSION EXPIRED — PLEASE LOG IN AGAIN', 4000);
}

// ── Message handling ──────────────────────────────────────────
function handleMessage(msg) {
  console.debug('[ASACS] Message received:', msg.type, msg);
  switch (msg.type) {
    case 'snapshot':
    case 'update':
      console.debug(`[ASACS] ${msg.type}: ${(msg.units || []).length} unit(s), ts=${msg.ts}`);
      _units       = msg.units || [];
      _lastUpdateTs = msg.ts || Date.now();
      renderUnits();
      updateStats();
      break;

    case 'mission':
      console.debug('[ASACS] Mission data received:', msg.data);
      _mission = msg.data || null;
      renderMission();
      updateStats();
      break;

    case 'sim_stop':
      console.debug('[ASACS] sim_stop received — clearing state');
      _units   = [];
      _mission = null;
      renderUnits();
      renderMission();
      updateStats();
      toast('SIMULATION STOPPED');
      break;

    default:
      // Forward unknown types to console only
      console.debug('[ASACS] Unknown message type:', msg);
  }
}

// ── Status indicator ──────────────────────────────────────────
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

// ── Stats bar ─────────────────────────────────────────────────
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
  // DCS simulation time is not available from the server alone;
  // display the mission start time as reference
  $('statMissionTime').textContent = fmtZulu(_mission.startTime);
}

// ── Mission strip ─────────────────────────────────────────────
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

// ── Unit table ────────────────────────────────────────────────
function renderUnits() {
  const tbody = $('unitTableBody');

  if (!_units || _units.length === 0) {
    console.debug('[ASACS] renderUnits: no tracks to display');
    tbody.innerHTML = '<tr><td colspan="14" class="empty-state">NO TRACKS</td></tr>';
    return;
  }

  console.debug(`[ASACS] renderUnits: rendering ${_units.length} track(s)`);

  // Sort: friendly first, then hostile, then neutral; within group by id
  const order = { friendly: 0, admin: 0, hostile: 1, neutral: 2 };
  const sorted = [..._units].sort((a, b) => {
    const ra = order[a._rel] ?? 3;
    const rb = order[b._rel] ?? 3;
    if (ra !== rb) return ra - rb;
    return (a.id || 0) - (b.id || 0);
  });

  const rows = sorted.map(u => {
    const rel  = u._rel || '';
    const rc   = relClass(rel);
    const iff  = u.iffResolved == null ? '—' : (u.iffResolved ? 'YES' : 'NO');
    const iffC = u.iffResolved ? 'rel-friendly' : (u.iffResolved === false ? 'rel-hostile' : '');

    return `<tr>
      <td class="${rc}">${rel.toUpperCase() || '—'}</td>
      <td>${esc(u.id)}</td>
      <td>${esc(u.typeName || u.type || '—')}</td>
      <td>${esc(u.category || '—')}</td>
      <td>${esc(coalitionName(u.coalition))}</td>
      <td>${fmtCoord(u.lat)}</td>
      <td>${fmtCoord(u.lon)}</td>
      <td>${u.alt != null ? u.alt : '—'}</td>
      <td>${u.spd != null ? u.spd : '—'}</td>
      <td>${u.hdg != null ? u.hdg : '—'}</td>
      <td>${u.squawk != null ? u.squawk : '—'}</td>
      <td class="${iffC}">${iff}</td>
      <td>${esc(u.groupName || '—')}</td>
      <td>${esc(u.pilotName || '—')}</td>
    </tr>`;
  });

  tbody.innerHTML = rows.join('');
}

function esc(v) {
  if (v == null) return '—';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
