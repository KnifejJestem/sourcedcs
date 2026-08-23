'use strict';

// crc-sync client — Casdoor login (via a popup, main.js's
// setWindowOpenHandler allow-lists the Casdoor authorize URL) plus the
// outbound side of the /feed WebSocket connection app.js's connect() opens.
//
// iff.js/geo.js call sendToSync(msg) for declare/rename mutations; app.js's
// connect() calls getSyncFeedUrl() to get a ready-to-open wss:// URL (or
// null, meaning: not logged in yet, login gate is now showing, keep
// retrying on the existing reconnect timer).

const SYNC_TOKEN_KEY = 'crc-desktop-sync-token';

function getSyncToken() {
  try { return localStorage.getItem(SYNC_TOKEN_KEY); } catch (_) { return null; }
}

function clearSyncToken() {
  try { localStorage.removeItem(SYNC_TOKEN_KEY); } catch (_) {}
}

function openSyncLogin() {
  if (typeof CASDOOR_ENDPOINT === 'undefined' || !CASDOOR_ENDPOINT) {
    console.error('[sync] CASDOOR_ENDPOINT not configured — cannot log in');
    return;
  }
  const ru = encodeURIComponent(window.location.origin + '/auth-callback.html');
  const stArr = new Uint8Array(16);
  try { window.crypto.getRandomValues(stArr); } catch (_) {}
  const st = Array.from(stArr).map(b => b.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem('crc-desktop-oauth-state', st); } catch (_) {}
  const url = `${CASDOOR_ENDPOINT}/login/oauth/authorize?client_id=${CASDOOR_CLIENT_ID}` +
    `&redirect_uri=${ru}&response_type=code&scope=openid+profile&state=${st}&prompt=none`;
  window.open(url, 'crc-login', 'width=480,height=640');
}

// ── Login gate ───────────────────────────────────────────────────────────
// crc-sync is a required dependency (no offline/solo mode) — until a token
// is present, show a blocking overlay instead of a picture that will just
// never populate.

function showLoginGate() {
  if (document.getElementById('crc-login-gate')) return;
  const el = document.createElement('div');
  el.id = 'crc-login-gate';
  el.style.cssText = 'position:fixed;inset:0;background:#0a0e0a;color:#8aab8a;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;' +
    'z-index:99999;font-family:"Courier New",monospace;letter-spacing:1px;';
  el.innerHTML =
    '<div style="font-size:14px;letter-spacing:3px;color:#39ff7a;">CRC SYNC</div>' +
    '<div style="font-size:11px;letter-spacing:1.5px;">LOGIN REQUIRED TO CONNECT</div>' +
    '<button id="crc-login-btn" style="padding:10px 26px;background:#132313;color:#39ff7a;' +
    'border:1px solid #2a3a2a;cursor:pointer;font-family:inherit;letter-spacing:2px;font-size:12px;">LOG IN</button>';
  document.body.appendChild(el);
  document.getElementById('crc-login-btn').addEventListener('click', openSyncLogin);
}

function hideLoginGate() {
  const el = document.getElementById('crc-login-gate');
  if (el) el.remove();
}

// ── Ticket + feed URL ───────────────────────────────────────────────────
// The ticket request goes through this app's own local server (same
// origin), which forwards it to crc-sync server-to-server — the renderer
// itself only ever talks to crc-sync directly for the WebSocket, and
// cross-origin for the one-time OAuth code exchange in auth-callback.html.

async function fetchSyncTicket() {
  const token = getSyncToken();
  if (!token) return null;
  try {
    const res = await fetch('/api/ws-ticket', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ticket || null;
  } catch (_) {
    return null;
  }
}

async function getSyncFeedUrl() {
  const ticket = await fetchSyncTicket();
  if (!ticket) {
    showLoginGate();
    return null;
  }
  hideLoginGate();
  const base = (typeof CRC_SYNC_URL !== 'undefined' && CRC_SYNC_URL) || 'wss://asacs.sourcedcs.page';
  const wsBase = base.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  return `${wsBase}/feed?ticket=${encodeURIComponent(ticket)}`;
}

// ── Outbound mutation channel ───────────────────────────────────────────
// The actual WebSocket instance is owned by app.js's connect()/reconnect
// logic; it registers itself here so iff.js/geo.js can send through it
// without app.js exposing its module-scoped `_ws`.

let _syncSocket = null;
function _setSyncSocket(ws) { _syncSocket = ws; }
function sendToSync(msg) {
  if (_syncSocket && _syncSocket.readyState === WebSocket.OPEN) {
    _syncSocket.send(JSON.stringify(msg));
  }
}
