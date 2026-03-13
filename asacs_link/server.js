/**
 * DCS GCI Server
 * Receives unit data from DCS Lua hook via UDP,
 * filters by coalition/realism rules, and distributes
 * to authenticated WebSocket clients at 2 Hz.
 */

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createSocket } from 'dgram';
import { readFileSync, existsSync, statSync } from 'fs';
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

// Last raw UDP packet received from DCS — stored before any processing so that
// GET /api/raw can surface it for pipeline diagnostics.
let _lastRawPkt   = null;
let _lastRawPktTs = null;

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
  // Used to verify the DCS → UDP → state pipeline independently of the
  // WebSocket realism layer.  Do not expose this to untrusted networks.
  if (req.method === 'GET' && req.url === '/api/raw') {
    const units = [...state.getAllUnits().values()].map(({ _lastSeen, ...u }) => u);
    const lastPkt = _lastRawPkt ? {
      ts:        _lastRawPktTs,
      ageMs:     Date.now() - _lastRawPktTs,
      type:      _lastRawPkt.type,
      unitCount: Array.isArray(_lastRawPkt.units) ? _lastRawPkt.units.length : null,
      units:     _lastRawPkt.units ?? null,
    } : null;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ storeCount: state.unitCount(), units, lastPkt }));
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

// ─── UDP Listener (DCS → Server) ─────────────────────────────────────────────

const udp = createSocket('udp4');

udp.on('message', (msg) => {
  try {
    const packet = JSON.parse(msg.toString('utf8'));
    handleDcsPacket(packet);
  } catch (err) {
    console.warn('[UDP] Bad packet:', err.message);
  }
});

udp.on('error', (err) => {
  console.error('[UDP] Error:', err.message);
});

udp.bind(config.udpPort, config.udpHost, () => {
  console.log(`[UDP] Listening for DCS data on ${config.udpHost}:${config.udpPort}`);
});

function handleDcsPacket(packet) {
  switch (packet.type) {
    case 'units': {
      const incomingCount = Array.isArray(packet.units) ? packet.units.length : 0;
      // Snapshot the raw packet before any processing for /api/raw diagnostics
      _lastRawPkt   = packet;
      _lastRawPktTs = Date.now();
      logv(`[UDP] Received units packet: ${incomingCount} unit(s) from DCS`);
      if (incomingCount === 0) {
        logv('[UDP] WARNING: units packet contained 0 units — DCS may have no world objects');
      }
      state.updateUnits(packet.units);
      logv(`[UDP] State updated: ${state.unitCount()} unit(s) now in store`);
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
