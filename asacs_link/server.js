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
    send(ws, { type: 'mission', data: mission });
  }

  // Send a snapshot of current units immediately
  const snapshot = filterUnitsForCoalition(state.getAllUnits(), coalition);
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

setInterval(() => {
  if (clients.size === 0) return;

  const allUnits = state.getAllUnits();
  const ts = Date.now();

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
    case 'units':
      state.updateUnits(packet.units);
      break;
    case 'mission':
      state.updateMission(packet.data);
      console.log(`[DCS] Mission loaded: ${packet.data?.name}`);
      // Broadcast mission update to all clients
      for (const { ws } of clients.values()) {
        send(ws, { type: 'mission', data: packet.data });
      }
      break;
    case 'sim_stop':
      state.clear();
      for (const { ws } of clients.values()) {
        send(ws, { type: 'sim_stop' });
      }
      break;
    case 'player_connect':
    case 'player_disconnect':
    case 'slot_change':
      // Broadcast player events to admin clients only (for now)
      for (const { ws, coalition } of clients.values()) {
        if (coalition === 'admin') send(ws, packet);
      }
      break;
    default:
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
});
