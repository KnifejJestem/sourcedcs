'use strict';
const { WebSocketServer, WebSocket } = require('ws');

const VERSION    = 2;
const TICK_MS    = 500; // delta broadcast rate per client

class WsServer {
  constructor() {
    this._wss         = null;
    this._store       = null;
    this._grpcStatus  = 'disconnected';
    this._srsStatus   = 'disconnected';
    this._missionData = null;
    this._missionId   = null; // changes on every mission-load
    this._weather     = null;
    this._gameTime    = null; // last known ISO datetime string
    this._onNeedInit  = null;
    this._sessions    = new Map(); // ws → session
    this._nextId      = 1;
  }

  attach(httpServer, store, onNeedInit) {
    this._store      = store;
    this._onNeedInit = onNeedInit || null;
    this._wss        = new WebSocketServer({ server: httpServer });
    this._wss.on('connection', (ws) => this._onConnect(ws));
    console.log('[ws] server attached');
  }

  setGrpcStatus(state)  { this._grpcStatus  = state; }
  setSrsStatus(state)   { this._srsStatus   = state; }
  setMissionData(data)  {
    this._missionData = data;
    this._missionId   = Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  setWeather(data)      { this._weather     = data; }
  setGameTime(dt)       { this._gameTime    = dt; }

  // ── Per-client lifecycle ─────────────────────────────────────────────────

  _onConnect(ws) {
    const session = { clientId: String(this._nextId++), lastSeq: this._store.currentSeq, timer: null };
    this._sessions.set(ws, session);

    ws.send(JSON.stringify(this._statusMsg()));

    if (this._missionData) {
      ws.send(JSON.stringify(this._initMsg()));
    } else if (this._onNeedInit) {
      this._onNeedInit();
    }

    if (this._weather) {
      ws.send(JSON.stringify(this._weatherMsg()));
    }

    if (this._gameTime) {
      ws.send(JSON.stringify(this._gameTimeMsg()));
    }

    // Full snapshot of ALL current tracks — client does all range/radar filtering
    ws.send(JSON.stringify({
      version: VERSION,
      type:    'snapshot',
      time:    Date.now() / 1000,
      tracks:  this._store.getAll(),
    }));

    session.timer = setInterval(() => this._tick(ws, session), TICK_MS);

    ws.on('message', () => {}); // client messages no longer used server-side
    ws.on('error',   () => {});
    ws.on('close',   () => {
      clearInterval(session.timer);
      this._sessions.delete(ws);
    });
  }

  // ── Per-client delta tick ────────────────────────────────────────────────

  _tick(ws, session) {
    if (ws.readyState !== WebSocket.OPEN) return;

    const { updated, gone, seq } = this._store.getDeltaSince(session.lastSeq);
    session.lastSeq = seq;

    if (updated.length === 0 && gone.length === 0) return;

    ws.send(JSON.stringify({
      version: VERSION,
      type:    'delta',
      time:    Date.now() / 1000,
      updated,
      gone,
    }));
  }

  // ── Broadcast helpers ────────────────────────────────────────────────────

  broadcastStatus() { this._broadcast(this._statusMsg()); }

  broadcastRadarLocks(locks) {
    this._broadcast({ version: VERSION, type: 'radar-locks', locks });
  }

  broadcastWeather() {
    if (this._weather) this._broadcast(this._weatherMsg());
  }

  broadcastGameTime() {
    if (this._gameTime) this._broadcast(this._gameTimeMsg());
  }

  broadcastInit() {
    if (!this._missionData) return;
    this._broadcast(this._initMsg());
  }

  _broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const client of this._wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  _statusMsg() {
    return { version: VERSION, type: 'status', grpc: this._grpcStatus, srs: this._srsStatus };
  }

  _weatherMsg() {
    return { version: VERSION, type: 'weather', pressurePa: this._weather.pressurePa, tempK: this._weather.tempK };
  }

  _gameTimeMsg() {
    return { version: VERSION, type: 'game-time', datetime: this._gameTime };
  }

  _initMsg() {
    return {
      version:    VERSION,
      type:       'init',
      missionId:  this._missionId,
      bullseye:   this._missionData.bullseye,
      airports:   this._missionData.airports,
      waypoints:  this._missionData.waypoints,
      drawings:   this._missionData.drawings,
    };
  }
}

module.exports = WsServer;
