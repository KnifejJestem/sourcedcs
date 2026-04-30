'use strict';
const { WebSocketServer, WebSocket } = require('ws');

const VERSION = 2;

// ── View registry ─────────────────────────────────────────────────────────
// To add a view: require() its module here and add it to the array.
const VIEW_REGISTRY = {};
for (const mod of [
  require('./views/crc'),
  require('./views/airport'),
  require('./views/approach'),
]) {
  VIEW_REGISTRY[mod.id] = mod;
}

const DEFAULT_VIEW = 'crc';

class WsServer {
  constructor() {
    this._wss         = null;
    this._store       = null;
    this._grpcStatus  = 'disconnected';
    this._srsStatus   = 'disconnected';
    this._missionData = null;
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
  setMissionData(data)  { this._missionData = data; }

  // ── Per-client lifecycle ─────────────────────────────────────────────────

  _onConnect(ws) {
    const session = {
      clientId: String(this._nextId++),
      view:     DEFAULT_VIEW,
      params:   {},
      lastSeq:  this._store.currentSeq,
      timer:    null,
    };
    this._sessions.set(ws, session);

    // 1. Status
    ws.send(JSON.stringify(this._statusMsg()));

    // 2. Init (mission data), if available — otherwise trigger a fetch
    if (this._missionData) {
      ws.send(JSON.stringify(this._initMsg()));
    } else if (this._onNeedInit) {
      this._onNeedInit();
    }

    // 3. Full snapshot of all current tracks for the default view
    const view = VIEW_REGISTRY[DEFAULT_VIEW];
    ws.send(JSON.stringify({
      version: VERSION,
      type:    'snapshot',
      time:    Date.now() / 1000,
      tracks:  view.filterTracks(this._store.getAll(), session.params),
    }));

    // 4. Start per-client delta timer
    this._startTimer(ws, session);

    ws.on('message', (raw) => {
      try { this._onMessage(ws, session, JSON.parse(raw)); } catch (_) {}
    });

    ws.on('error', () => {});
    ws.on('close', () => {
      this._stopTimer(session);
      this._sessions.delete(ws);
    });
  }

  _onMessage(ws, session, msg) {
    if (msg.type !== 'select_view') return;
    const viewId = msg.view;
    if (!VIEW_REGISTRY[viewId]) return;

    session.view    = viewId;
    session.params  = msg.params || {};
    session.lastSeq = this._store.currentSeq;

    // Send fresh init + snapshot scoped to the new view
    if (this._missionData) ws.send(JSON.stringify(this._initMsg()));
    const view = VIEW_REGISTRY[viewId];
    ws.send(JSON.stringify({
      version: VERSION,
      type:    'snapshot',
      time:    Date.now() / 1000,
      tracks:  view.filterTracks(this._store.getAll(), session.params),
    }));

    // Restart timer at the new view's sweep rate
    this._stopTimer(session);
    this._startTimer(ws, session);
  }

  // ── Per-client timer ─────────────────────────────────────────────────────

  _startTimer(ws, session) {
    const view = VIEW_REGISTRY[session.view] || VIEW_REGISTRY[DEFAULT_VIEW];
    const rate = view.sweepRate(session.params);
    session.timer = setInterval(() => this._tick(ws, session), rate);
  }

  _stopTimer(session) {
    if (session.timer) { clearInterval(session.timer); session.timer = null; }
  }

  _tick(ws, session) {
    if (ws.readyState !== WebSocket.OPEN) return;

    const view = VIEW_REGISTRY[session.view] || VIEW_REGISTRY[DEFAULT_VIEW];
    const { updated: raw, gone, seq } = this._store.getDeltaSince(session.lastSeq);
    session.lastSeq = seq;

    const updated = view.filterTracks(raw, session.params)
      .map(t => view.transformTrack(t, session.params));

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

  broadcastStatus() {
    this._broadcast(this._statusMsg());
  }

  broadcastInit() {
    if (!this._missionData) return;
    this._broadcast(this._initMsg());
  }

  // ── Message builders ─────────────────────────────────────────────────────

  _statusMsg() {
    return {
      version: VERSION,
      type:    'status',
      grpc:    this._grpcStatus,
      srs:     this._srsStatus,
    };
  }

  _initMsg() {
    return {
      version:   VERSION,
      type:      'init',
      bullseye:  this._missionData.bullseye,
      airports:  this._missionData.airports,
      waypoints: this._missionData.waypoints,
      drawings:  this._missionData.drawings,
    };
  }

  _broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const client of this._wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}

module.exports = WsServer;
