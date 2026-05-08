'use strict';
require('dotenv').config();
const http = require('http');
const fs   = require('fs');
const path = require('path');

const GrpcClient = require('./src/grpc-client');
const SrsClient  = require('./src/srs-client');
const TrackStore = require('./src/tracks');
const WsServer   = require('./src/ws-server');

const PUBLIC_DIR       = path.join(__dirname, 'public');
const DATA_DIR         = path.join(__dirname, 'data');
const SRS_RADIO_API    = parseInt(process.env.SRS_RADIO_API_PORT) || 5003;

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
  // ── SRS radio API proxy → lxsrs_v2 HTTP API ──────────────────────────────
  if (req.url.startsWith('/srs-api/')) {
    const upstreamPath = req.url.slice('/srs-api'.length);
    const opts = {
      hostname: '127.0.0.1',
      port: SRS_RADIO_API,
      path: upstreamPath,
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers['content-length'] ? { 'Content-Length': req.headers['content-length'] } : {}),
      },
    };
    const upstream = http.request(opts, (upRes) => {
      res.writeHead(upRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      upRes.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(503);
      res.end(JSON.stringify({ error: 'SRS radio API unavailable' }));
    });
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }
    if (req.method === 'POST') req.pipe(upstream);
    else upstream.end();
    return;
  }

  // ── ATIS TTS transmit ─────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/atis-transmit') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      let opts;
      try { opts = JSON.parse(body); } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
      grpcClient.transmitAtis(opts)
        .then(r => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, duration_ms: r && r.duration_ms }));
        })
        .catch(err => {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
    });
    return;
  }

  // ── SRS debug: list connected clients + frequencies ──────────────────────
  if (req.url === '/api/srs-clients') {
    grpcClient.getSrsClients()
      .then(data => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      })
      .catch(err => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // ── Airport weather API ───────────────────────────────────────────────────
  if (req.url.startsWith('/api/apt-weather')) {
    const qs  = new URL(req.url, 'http://x').searchParams;
    const lat = parseFloat(qs.get('lat'));
    const lon = parseFloat(qs.get('lon'));
    const alt = parseFloat(qs.get('alt')) || 0;
    if (isNaN(lat) || isNaN(lon)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'lat/lon required' }));
    }
    grpcClient.getAptWeather(lat, lon, alt)
      .then(data => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      })
      .catch(err => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // ── Flight plan lookup (proxy to sourcedcs-web) ──────────────────────────
  if (req.url.startsWith('/api/fpl/')) {
    const callsign = decodeURIComponent(req.url.slice('/api/fpl/'.length).split('?')[0]).toUpperCase().trim();
    const webUrl   = (process.env.SOURCEDCS_WEB_URL || '').replace(/\/$/, '');
    if (!webUrl || !callsign) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'not found' }));
    }
    const target = new URL('/api/fpl1801/by-callsign/' + encodeURIComponent(callsign), webUrl);
    const mod    = target.protocol === 'https:' ? require('https') : http;
    const preq   = mod.get(target.href, pres => {
      const chunks = [];
      pres.on('data', c => chunks.push(c));
      pres.on('end', () => {
        res.writeHead(pres.statusCode, { 'Content-Type': 'application/json' });
        res.end(Buffer.concat(chunks));
      });
    });
    preq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream error' }));
    });
    return;
  }

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

grpcClient.on('weather', (data) => {
  wsServer.setWeather(data);
  wsServer.broadcastWeather();
});

grpcClient.on('game-time', (datetime) => {
  wsServer.setGameTime(datetime);
  wsServer.broadcastGameTime();
});

// ── SRS → ws ─────────────────────────────────────────────────────────────

srsClient.on('status', (state) => {
  wsServer.setSrsStatus(state);
  wsServer.broadcastStatus();
});

// ── Stale track reaper ────────────────────────────────────────────────────
// Evicts units not heard from in 12 s (handles players logging out on the
// ground where DCS never emits a 'gone' event for the slot).
setInterval(() => {
  const n = store.expireStale();
  if (n > 0) console.log(`[crc] expired ${n} stale track(s)`);
}, 5000);

// ── Start ─────────────────────────────────────────────────────────────────
// Delta broadcasts are now driven by per-client timers inside WsServer,
// using the active view's sweepRate. No global interval needed.

const port = parseInt(process.env.WS_PORT) || 3100;
httpServer.listen(port, () => {
  console.log(`[crc] http://localhost:${port}`);
});

grpcClient.connect();
srsClient.connect();
