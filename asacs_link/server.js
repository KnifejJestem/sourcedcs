/**
 * DCS GCI Server
 * Reads unit data from files written by the DCS Export.lua script,
 * filters by coalition/realism rules, and distributes
 * to authenticated WebSocket clients at 2 Hz.
 */

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import config from './config.js';
import { filterUnitsForCoalition } from './filter.js';
import { StateStore } from './state.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

// Verbose logging: set ASACS_VERBOSE=true in the environment to enable
// detailed per-packet diagnostics that trace the unit data pipeline.
const VERBOSE = process.env.ASACS_VERBOSE === 'true' || process.env.ASACS_VERBOSE === '1';

function logv(...args) {
  if (VERBOSE) console.log('[VERBOSE]', ...args);
}

// MIME types for static file serving
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

function serveStatic(req, res) {
  // Only allow GET/HEAD for static files
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  // Prevent path traversal
  const filePath = join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end(); return true;
  }

  let stat;
  try { stat = statSync(filePath); } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[Static]', err.code, filePath);
    return false;
  }
  if (!stat.isFile()) return false;

  const ext  = extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const data = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length });
  if (req.method === 'HEAD') { res.end(); return true; }
  res.end(data);
  return true;
}

// ─── State ────────────────────────────────────────────────────────────────────

const state = new StateStore();

// Last raw file packet read from DCS — stored before any processing so that
// GET /api/raw can surface it for pipeline diagnostics.
let _lastRawPkt   = null;
let _lastRawPktTs = null;

// Separate tracker for units packets (from mygci_export.lua via file polling).
// Kept distinct from the general _lastRawPkt so /api/raw can tell the user
// whether the Export.lua system is sending data independently of other packets.
let _lastUnitsPkt   = null;
let _lastUnitsPktTs = null;

// Tracks when mygci_export.lua wrote its startup status file, confirming that
// Export.lua loaded the script.  null means no status file seen yet.
let _exportLoadedTs = null;

// ─── HTTP + WebSocket Server ──────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  // Simple REST endpoint for auth — clients POST credentials, get a token back
  if (req.method === 'POST' && req.url === '/auth') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { password } = JSON.parse(body);
        const coalition = resolveCoalition(password);
        if (!coalition) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid password' }));
          return;
        }
        const token = randomUUID();
        pendingTokens.set(token, { coalition, expires: Date.now() + 30_000 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token, coalition }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: clients.size,
      units: state.unitCount(),
      mission: state.getMissionName(),
      uptime: process.uptime(),
    }));
    return;
  }

  // Raw diagnostic dump — bypasses all coalition filtering and auth.
  // Used to verify the DCS → file → state pipeline independently of the
  // WebSocket realism layer.  Do not expose this to untrusted networks.
  if (req.method === 'GET' && req.url === '/api/raw') {
    const units = [...state.getAllUnits().values()].map(({ _lastSeen, ...u }) => u);
    const lastPkt = _lastRawPkt ? {
      ts:        _lastRawPktTs,
      ageMs:     Date.now() - _lastRawPktTs,
      type:      _lastRawPkt.type,
      unitCount: Array.isArray(_lastRawPkt.units) ? _lastRawPkt.units.length : null,
    } : null;
    const lastUnitsPkt = _lastUnitsPkt ? {
      ts:        _lastUnitsPktTs,
      ageMs:     Date.now() - _lastUnitsPktTs,
      unitCount: Array.isArray(_lastUnitsPkt.units) ? _lastUnitsPkt.units.length : 0,
    } : null;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({
      storeCount: state.unitCount(),
      units,
      lastPkt,
      lastUnitsPkt,
      exportLoadedTs: _exportLoadedTs,
      exportLoadedAgeMs: _exportLoadedTs ? Date.now() - _exportLoadedTs : null,
    }));
    return;
  }

  // Static files (dashboard web UI)
  if (serveStatic(req, res)) return;

  res.writeHead(404);
  res.end();
});

// Token store: short-lived one-time tokens issued by /auth
const pendingTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of pendingTokens) {
    if (data.expires < now) pendingTokens.delete(token);
  }
}, 10_000);

// ─── Coalition Resolution ─────────────────────────────────────────────────────

function resolveCoalition(password) {
  if (password === config.passwords.blue)    return 'blue';
  if (password === config.passwords.red)     return 'red';
  if (password === config.passwords.neutral) return 'neutral';
  if (password === config.passwords.admin)   return 'admin'; // sees all
  return null;
}

// ─── WebSocket Clients ────────────────────────────────────────────────────────

/**
 * @type {Map<string, { ws: WebSocket, coalition: string, id: string }>}
 */
const clients = new Map();

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  // Expect ?token=<uuid> on the upgrade URL
  const url = new URL(req.url, `http://localhost`);
  const token = url.searchParams.get('token');

  const tokenData = pendingTokens.get(token);
  if (!token || !tokenData || tokenData.expires < Date.now()) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  pendingTokens.delete(token); // one-time use

  const clientId = randomUUID();
  const { coalition } = tokenData;
  clients.set(clientId, { ws, coalition, id: clientId });

  console.log(`[WS] Client connected: ${clientId} (${coalition}) — total: ${clients.size}`);

  // Send current mission data immediately on connect
  const mission = state.getMission();
  if (mission) {
    logv(`[WS] Sending mission data to ${clientId}: name="${mission.name}"`);
    send(ws, { type: 'mission', data: mission });
  } else {
    logv(`[WS] No mission data available yet for ${clientId}`);
  }

  // Send a snapshot of current units immediately
  const rawUnitCount = state.unitCount();
  const snapshot = filterUnitsForCoalition(state.getAllUnits(), coalition);
  logv(`[WS] Snapshot for ${clientId} (${coalition}): ${rawUnitCount} raw units → ${snapshot.length} after filter`);
  send(ws, { type: 'snapshot', units: snapshot, ts: Date.now() });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`[WS] Client disconnected: ${clientId} — total: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Client error ${clientId}:`, err.message);
    clients.delete(clientId);
  });
});

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ─── Broadcast Loop (2 Hz) ────────────────────────────────────────────────────

let _broadcastTick = 0;

setInterval(() => {
  // Poll DCS files first so the broadcast uses the freshest state.
  pollDcsFiles();

  if (clients.size === 0) return;

  const allUnits = state.getAllUnits();
  const ts = Date.now();
  _broadcastTick++;

  // Cache filtered views per coalition to avoid recomputing for each client
  const coalitionCache = new Map();

  for (const { ws, coalition } of clients.values()) {
    if (!coalitionCache.has(coalition)) {
      coalitionCache.set(coalition, filterUnitsForCoalition(allUnits, coalition));
    }
    send(ws, {
      type: 'update',
      units: coalitionCache.get(coalition),
      ts,
    });
  }

  // Log a summary every 10 ticks (~5 s) to avoid log spam
  if (VERBOSE && _broadcastTick % 10 === 0) {
    const summary = [...coalitionCache.entries()]
      .map(([c, u]) => `${c}:${u.length}`)
      .join(', ');
    logv(`[Broadcast] tick=${_broadcastTick} raw=${allUnits.size} filtered=[${summary}] clients=${clients.size}`);
  }
}, 500); // 2 Hz

// ─── File Poller (DCS → Server) ──────────────────────────────────────────────
// mygci_export.lua writes unit data and status events to files in the DCS
// Saved Games folder (configured via ASACS_DCS_FILES_PATH).  We poll those
// files on the broadcast interval rather than relying on a UDP socket, which
// is broken on DCS dedicated servers due to an incompatible lua-socket.dll.

const UNITS_FILE   = config.dcsFilesPath ? join(config.dcsFilesPath, 'mygci_units.json')   : null;
const STATUS_FILE  = config.dcsFilesPath ? join(config.dcsFilesPath, 'mygci_status.json')  : null;
const MISSION_FILE = config.dcsFilesPath ? join(config.dcsFilesPath, 'mygci_mission.json') : null;
const EVENT_FILE   = config.dcsFilesPath ? join(config.dcsFilesPath, 'mygci_event.json')   : null;

// Track last-seen state so we only process changes.
let _lastUnitsMtime         = 0;    // mtime of units file at last successful read
let _lastStatusFileContent  = '';   // raw content of status file at last successful read
let _lastMissionFileContent = '';   // raw content of mission file (from myatc.lua hook)
let _lastEventFileContent   = '';   // raw content of event file (from myatc.lua hook)

if (!config.dcsFilesPath) {
  console.warn('[FilePoller] ASACS_DCS_FILES_PATH is not set — DCS file polling disabled.');
  console.warn('[FilePoller] Set ASACS_DCS_FILES_PATH to the DCS Saved Games path, e.g.:');
  console.warn('[FilePoller]   ASACS_DCS_FILES_PATH="C:\\\\Users\\\\you\\\\Saved Games\\\\DCS\\\\" npm start');
} else {
  console.log(`[FilePoller] Watching for DCS data in: ${config.dcsFilesPath}`);
}

function pollDcsFiles() {
  if (!UNITS_FILE || !STATUS_FILE) return;

  // ── Units file (mygci_export.lua, 2 Hz) ──────────────────────────────────
  // Reread only when the file's mtime has advanced (i.e. Lua wrote a new snapshot).
  try {
    const stat = statSync(UNITS_FILE);
    if (stat.mtimeMs > _lastUnitsMtime) {
      _lastUnitsMtime = stat.mtimeMs;
      const content = readFileSync(UNITS_FILE, 'utf8');
      const packet  = JSON.parse(content);
      handleDcsPacket(packet);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') logv('[FilePoller] units file error:', err.message);
  }

  // ── Status file (mygci_export.lua: export_loaded, sim_stop) ──────────────
  // Compare raw content; the file is small (one event object) and changes
  // infrequently (on load and sim_stop), so string comparison is fine.
  try {
    const content = readFileSync(STATUS_FILE, 'utf8');
    if (content !== _lastStatusFileContent) {
      _lastStatusFileContent = content;
      const packet = JSON.parse(content);
      handleDcsPacket(packet);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') logv('[FilePoller] status file error:', err.message);
  }

  // ── Mission file (myatc.lua hook: written on onMissionLoadEnd) ────────────
  try {
    const content = readFileSync(MISSION_FILE, 'utf8');
    if (content !== _lastMissionFileContent) {
      _lastMissionFileContent = content;
      const packet = JSON.parse(content);
      handleDcsPacket(packet);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') logv('[FilePoller] mission file error:', err.message);
  }

  // ── Event file (myatc.lua hook: player events + sim_stop fallback) ────────
  try {
    const content = readFileSync(EVENT_FILE, 'utf8');
    if (content !== _lastEventFileContent) {
      _lastEventFileContent = content;
      const packet = JSON.parse(content);
      handleDcsPacket(packet);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') logv('[FilePoller] event file error:', err.message);
  }
}

function handleDcsPacket(packet) {
  // Capture every incoming packet for /api/raw diagnostics, regardless of type.
  // This lets users confirm whether ANY DCS system (hook or export) is sending
  // file data, even when no unit telemetry has arrived yet.
  _lastRawPkt   = packet;
  _lastRawPktTs = Date.now();

  switch (packet.type) {
    case 'units': {
      const incomingCount = Array.isArray(packet.units) ? packet.units.length : 0;
      // Also track units packets separately so /api/raw can distinguish
      // hook packets (mission/player events) from export packets (units).
      _lastUnitsPkt   = packet;
      _lastUnitsPktTs = Date.now();
      logv(`[FilePoller] Received units file: ${incomingCount} unit(s) from DCS`);
      if (incomingCount === 0) {
        logv('[FilePoller] WARNING: units file contained 0 units — DCS may have no world objects');
      }
      state.updateUnits(packet.units);
      logv(`[FilePoller] State updated: ${state.unitCount()} unit(s) now in store`);
      break;
    }
    case 'mission':
      state.updateMission(packet.data);
      console.log(`[DCS] Mission loaded: ${packet.data?.name}`);
      logv(`[DCS] Mission data: theatre="${packet.data?.theatre}" startTime=${packet.data?.startTime}`);
      // Broadcast mission update to all clients
      for (const { ws } of clients.values()) {
        send(ws, { type: 'mission', data: packet.data });
      }
      break;
    case 'sim_stop':
      console.log('[DCS] Simulation stopped — clearing state');
      state.clear();
      for (const { ws } of clients.values()) {
        send(ws, { type: 'sim_stop' });
      }
      break;
    case 'player_connect':
    case 'player_disconnect':
    case 'slot_change':
      logv(`[DCS] Player event: ${packet.type} id=${packet.id}`);
      // Broadcast player events to admin clients only (for now)
      for (const { ws, coalition } of clients.values()) {
        if (coalition === 'admin') send(ws, packet);
      }
      break;
    case 'export_loaded':
      _exportLoadedTs = Date.now();
      console.log('[DCS] mygci_export.lua confirmed loaded via Export.lua');
      break;
    default:
      logv(`[DCS] Unknown packet type: "${packet.type}"`);
      // Forward unknown packet types as-is to admin clients
      for (const { ws, coalition } of clients.values()) {
        if (coalition === 'admin') send(ws, packet);
      }
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(config.wsPort, () => {
  console.log(`[HTTP/WS] Server listening on port ${config.wsPort}`);
  console.log(`[INFO] Blue password:  ${config.passwords.blue}`);
  console.log(`[INFO] Red password:   ${config.passwords.red}`);
  console.log(`[INFO] Admin password: ${config.passwords.admin}`);
  if (VERBOSE) {
    console.log('[INFO] Verbose logging ENABLED (ASACS_VERBOSE=true)');
  } else {
    console.log('[INFO] Set ASACS_VERBOSE=true for detailed pipeline diagnostics');
  }
});
