'use strict';
require('dotenv').config();
const http = require('http');
const fs   = require('fs');
const path = require('path');

const GrpcClient = require('./src/grpc-client');
const SrsClient  = require('./src/srs-client');
const TrackStore = require('./src/tracks');
const WsServer   = require('./src/ws-server');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR   = path.join(__dirname, 'data');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.css':  'text/css',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// ── HTTP server (static files + WebSocket upgrade) ────────────────────────

const httpServer = http.createServer((req, res) => {
  // Serve static data files (aircraft-types.json, airports.json, icao.json …)
  if (req.url.startsWith('/data/')) {
    const dataPath = path.normalize(path.join(DATA_DIR, req.url.slice(6).split('?')[0]));
    if (!dataPath.startsWith(DATA_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    return fs.readFile(dataPath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
  }

  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));

  // Prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ct = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  });
});

// ── Core components ───────────────────────────────────────────────────────

const store      = new TrackStore();
const grpcClient = new GrpcClient();
const srsClient  = new SrsClient();
const wsServer   = new WsServer();

wsServer.attach(httpServer, store, () => grpcClient.triggerMissionFetch());

// ── gRPC → store + ws ─────────────────────────────────────────────────────

grpcClient.on('unit', (unitData) => {
  store.update(unitData, srsClient.getTransponder(unitData.player));
});

grpcClient.on('gone', (id) => {
  store.remove(id);
});

grpcClient.on('mission-load', (missionData) => {
  store.clear();
  wsServer.setMissionData(missionData);
  wsServer.broadcastInit();
  console.log(`[crc] mission init — ${missionData.airports.length} airports`);
});

grpcClient.on('status', (state) => {
  wsServer.setGrpcStatus(state);
  wsServer.broadcastStatus();
});

// ── SRS → ws ─────────────────────────────────────────────────────────────

srsClient.on('status', (state) => {
  wsServer.setSrsStatus(state);
  wsServer.broadcastStatus();
});

// ── Start ─────────────────────────────────────────────────────────────────
// Delta broadcasts are now driven by per-client timers inside WsServer,
// using the active view's sweepRate. No global interval needed.

const port = parseInt(process.env.WS_PORT) || 3100;
httpServer.listen(port, () => {
  console.log(`[crc] http://localhost:${port}`);
});

grpcClient.connect();
srsClient.connect();
