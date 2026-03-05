// ═══════════════════════════════════════════════════════════
// server.js — ATO BRIEF web server with session support
// ═══════════════════════════════════════════════════════════
//
// Usage:
//   npm start                         # starts on port 3000
//   PORT=8080 npm start               # custom port
//
// Roles:
//   Presenter  — loads packages, controls navigation for everyone
//   Presentee  — read-only view, synced with the presenter
//
// URL scheme:
//   http://localhost:3000/                                   → standalone (no sync)
//   http://localhost:3000/?session=<id>&role=presenter       → presenter
//   http://localhost:3000/?session=<id>                      → presentee (default)

'use strict';

const crypto  = require('crypto');
const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server } = require('socket.io');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ── Serve static front-end assets ────────────────────────────
// Only expose the directories the browser actually needs.
const PUBLIC = path.join(__dirname, 'public');
app.get('/',  (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.use('/css',  express.static(path.join(PUBLIC, 'css')));
app.use('/js',   express.static(path.join(PUBLIC, 'js')));
app.use('/data', express.static(path.join(__dirname, 'data')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'js-yaml', 'dist')));

// ── Session store ────────────────────────────────────────────
// Each session represents a briefing room that one presenter
// controls and many presentees observe.
//
// Structure:
//   sessions.get(sessionId) → {
//     presenterId:  socket.id | null,
//     packageYaml:  string    | null,   // raw YAML text
//     currentTab:   string,
//     theme:        string,
//     display:      { timeMode, coordMode },
//     members:      Map<socketId, { role }>,  // connected users
//   }
const sessions = new Map();

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      presenterId:     null,
      presenterPassword: null,  // set by the first presenter
      packageYaml:     null,
      currentTab:      'ato',
      theme:           'pro',
      display:         { timeMode: 'Z', coordMode: 'dm' },
      members:         new Map(),
    });
  }
  return sessions.get(sessionId);
}

// Build a presence summary for broadcast
function buildPresence(session) {
  let presenterCount = 0;
  let presenteeCount = 0;
  session.members.forEach(({ role }) => {
    if (role === 'presenter') presenterCount++;
    else presenteeCount++;
  });
  return { presenter: presenterCount, presentee: presenteeCount, total: presenterCount + presenteeCount };
}

// ── WebSocket handling ───────────────────────────────────────
io.on('connection', (socket) => {
  let currentSessionId = null;
  let currentRole      = null;

  // ── Join a session ─────────────────────────────────────────
  socket.on('join', ({ sessionId, role, password }) => {
    if (!sessionId || typeof sessionId !== 'string') return;

    const session = getOrCreateSession(sessionId);
    const wantedRole = role === 'presenter' ? 'presenter' : 'presentee';

    // ── Presenter password gate ─────────────────────────────
    if (wantedRole === 'presenter') {
      // Only one presenter at a time
      if (session.presenterId !== null) {
        const presenterSocket = io.sockets.sockets.get(session.presenterId);
        if (presenterSocket && presenterSocket.connected) {
          socket.emit('join-error', { message: 'Room already has an active presenter' });
          return;
        }
        // Previous presenter disconnected without cleanup — clear stale id
        session.presenterId = null;
      }

      const pw = typeof password === 'string' ? password : '';
      if (session.presenterPassword === null) {
        // First presenter sets the room password (stored hashed)
        session.presenterPassword = hashPassword(pw);
      } else if (!verifyPassword(pw, session.presenterPassword)) {
        socket.emit('join-error', { message: 'Wrong presenter password' });
        return;
      }
    }

    currentSessionId = sessionId;
    currentRole = wantedRole;
    socket.join(sessionId);

    if (currentRole === 'presenter') {
      session.presenterId = socket.id;
    }

    // Track this member in the session
    session.members.set(socket.id, { role: currentRole });

    // Send the current session state to the joining client
    socket.emit('session-state', {
      role:        currentRole,
      packageYaml: session.packageYaml,
      currentTab:  session.currentTab,
      theme:       session.theme,
      display:     session.display,
    });

    // Broadcast updated presence to all room members
    io.to(sessionId).emit('room-presence', buildPresence(session));
  });

  // ── Presenter: package loaded ──────────────────────────────
  socket.on('package-loaded', (yamlText) => {
    if (!currentSessionId || currentRole !== 'presenter') return;
    if (typeof yamlText !== 'string') return;

    const session = sessions.get(currentSessionId);
    if (!session || session.presenterId !== socket.id) return;

    session.packageYaml = yamlText;
    socket.to(currentSessionId).emit('package-loaded', yamlText);
  });

  // ── Presenter: tab changed ────────────────────────────────
  socket.on('tab-changed', (tab) => {
    if (!currentSessionId || currentRole !== 'presenter') return;
    if (typeof tab !== 'string') return;

    const session = sessions.get(currentSessionId);
    if (!session || session.presenterId !== socket.id) return;

    session.currentTab = tab;
    socket.to(currentSessionId).emit('tab-changed', tab);
  });

  // ── Presenter: theme changed ──────────────────────────────
  socket.on('theme-changed', (theme) => {
    if (!currentSessionId || currentRole !== 'presenter') return;
    if (typeof theme !== 'string') return;

    const session = sessions.get(currentSessionId);
    if (!session || session.presenterId !== socket.id) return;

    session.theme = theme;
    socket.to(currentSessionId).emit('theme-changed', theme);
  });

  // ── Presenter: display settings changed ───────────────────
  socket.on('display-changed', (display) => {
    if (!currentSessionId || currentRole !== 'presenter') return;
    if (!display || typeof display !== 'object') return;

    const session = sessions.get(currentSessionId);
    if (!session || session.presenterId !== socket.id) return;

    if (typeof display.timeMode  === 'string') session.display.timeMode  = display.timeMode;
    if (typeof display.coordMode === 'string') session.display.coordMode = display.coordMode;

    socket.to(currentSessionId).emit('display-changed', display);
  });

  // ── Disconnect ────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (currentSessionId) {
      const session = sessions.get(currentSessionId);
      if (session) {
        // Remove from member list
        session.members.delete(socket.id);

        if (currentRole === 'presenter' && session.presenterId === socket.id) {
          session.presenterId = null;
          io.to(currentSessionId).emit('presenter-disconnected');
        }

        // Broadcast updated presence to remaining members
        io.to(currentSessionId).emit('room-presence', buildPresence(session));
      }
    }
  });
});

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`ATO BRIEF server listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io, PORT };
