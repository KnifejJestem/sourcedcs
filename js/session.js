// ═══════════════════════════════════════════════════════════
// session.js — Client-side session & role management
// ═══════════════════════════════════════════════════════════
//
// Connects presenter ↔ presentee via Socket.io.
//
// Users can join a session either through URL parameters or
// through the Join Room dialog in the UI.
//
// URL parameters (still supported):
//   ?session=<id>                  → join as presentee (default)
//   ?session=<id>&role=presenter   → join as presenter
//   (no ?session)                  → standalone mode (shows dialog option)
//
// Presenter: every UI action (load package, switch tab, change
//   theme / display mode) is broadcast to all presentees.
//
// Presentee: the UI is read-only — file loading is disabled,
//   and all state is received from the presenter in real-time.

'use strict';

const SESSION = {
  socket:    null,
  role:      null,   // 'presenter' | 'presentee' | null (standalone)
  sessionId: null,
  connected: false,
  _syncing:  false,  // true while applying remote state
};

// Keep references to the original global functions for wrapping
const _origLoadPackage  = null;
const _origShowTab      = null;
const _origSetTheme     = null;
const _origSetTimeMode  = null;
const _origSetCoordMode = null;

// ── Dialog helpers (global, called from onclick in HTML) ─────
function openJoinDialog() {
  const d = document.getElementById('joinDialog');
  if (d) {
    d.style.display = 'flex';
    document.getElementById('joinError').textContent = '';
    document.getElementById('joinRoomId').focus();
  }
}

function closeJoinDialog() {
  const d = document.getElementById('joinDialog');
  if (d) d.style.display = 'none';
}

function selectJoinRole(role) {
  document.querySelectorAll('.dialog-role-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.role === role);
  });
  const pwRow = document.getElementById('joinPasswordRow');
  if (pwRow) pwRow.style.display = role === 'presenter' ? '' : 'none';
}

function submitJoinDialog() {
  const roomId   = (document.getElementById('joinRoomId').value || '').trim();
  const password = (document.getElementById('joinPassword').value || '');
  const roleBtn  = document.querySelector('.dialog-role-btn.active');
  const role     = roleBtn ? roleBtn.dataset.role : 'presentee';
  const errEl    = document.getElementById('joinError');

  if (!roomId) {
    errEl.textContent = 'Enter a Room ID';
    return;
  }

  errEl.textContent = '';
  joinSession(roomId, role, password);
}

// ── Core: connect socket and join a session ──────────────────
function joinSession(sessionId, role, password) {
  // If already in a session, disconnect first
  if (SESSION.socket) {
    SESSION.socket.disconnect();
    SESSION.socket = null;
    SESSION.connected = false;
  }

  SESSION.sessionId = sessionId;
  SESSION.role = role === 'presenter' ? 'presenter' : 'presentee';

  // Store originals before wrapping (only once)
  const _loadPackage  = window._origLoadPackage  || window.loadPackage;
  const _showTab      = window._origShowTab      || window.showTab;
  const _setTheme     = window._origSetTheme     || window.setTheme;
  const _setTimeMode  = window._origSetTimeMode  || window.setTimeMode;
  const _setCoordMode = window._origSetCoordMode || window.setCoordMode;

  // Save originals for potential re-join
  window._origLoadPackage  = _loadPackage;
  window._origShowTab      = _showTab;
  window._origSetTheme     = _setTheme;
  window._origSetTimeMode  = _setTimeMode;
  window._origSetCoordMode = _setCoordMode;

  // ── Wrap global functions for presenter sync ──────────────
  if (SESSION.role === 'presenter') {
    window.loadPackage = function (yamlText) {
      _loadPackage(yamlText);
      if (SESSION.connected && !SESSION._syncing) {
        SESSION.socket.emit('package-loaded', yamlText);
      }
    };

    window.showTab = function (name) {
      _showTab(name);
      if (SESSION.connected && !SESSION._syncing) {
        SESSION.socket.emit('tab-changed', name);
      }
    };

    window.setTheme = function (t) {
      _setTheme(t);
      if (SESSION.connected && !SESSION._syncing) {
        SESSION.socket.emit('theme-changed', t);
      }
    };

    window.setTimeMode = function (m) {
      _setTimeMode(m);
      if (SESSION.connected && !SESSION._syncing) {
        SESSION.socket.emit('display-changed', { timeMode: m });
      }
    };

    window.setCoordMode = function (m) {
      _setCoordMode(m);
      if (SESSION.connected && !SESSION._syncing) {
        SESSION.socket.emit('display-changed', { coordMode: m });
      }
    };
  } else {
    // Presentee: restore originals (don't broadcast)
    window.loadPackage  = _loadPackage;
    window.showTab      = _showTab;
    window.setTheme     = _setTheme;
    window.setTimeMode  = _setTimeMode;
    window.setCoordMode = _setCoordMode;
  }

  // ── Connect to server ─────────────────────────────────────
  SESSION.socket = io();

  SESSION.socket.on('connect', () => {
    SESSION.connected = true;
    SESSION.socket.emit('join', {
      sessionId: SESSION.sessionId,
      role:      SESSION.role,
      password:  password || '',
    });
  });

  // ── Join error (e.g. wrong password) ──────────────────────
  SESSION.socket.on('join-error', ({ message }) => {
    const errEl = document.getElementById('joinError');
    if (errEl) errEl.textContent = message || 'Failed to join';
    SESSION.socket.disconnect();
    SESSION.socket = null;
    SESSION.connected = false;
    SESSION.role = null;
    SESSION.sessionId = null;
    // Restore originals
    window.loadPackage  = _loadPackage;
    window.showTab      = _showTab;
    window.setTheme     = _setTheme;
    window.setTimeMode  = _setTimeMode;
    window.setCoordMode = _setCoordMode;
  });

  // ── Receive initial session state ──────────────────────────
  SESSION.socket.on('session-state', (state) => {
    // Close dialog on successful join
    closeJoinDialog();
    showSessionIndicator(SESSION.sessionId, SESSION.role);

    if (SESSION.role === 'presentee') {
      applyPresenteeUI();
      SESSION._syncing = true;
      if (state.theme)               _setTheme(state.theme);
      if (state.display?.timeMode)   _setTimeMode(state.display.timeMode);
      if (state.display?.coordMode)  _setCoordMode(state.display.coordMode);
      if (state.packageYaml)         _loadPackage(state.packageYaml);
      if (state.currentTab)          _showTab(state.currentTab);
      SESSION._syncing = false;
    }
  });

  // ── Live updates from presenter ────────────────────────────
  SESSION.socket.on('package-loaded', (yamlText) => {
    if (SESSION.role === 'presentee') {
      SESSION._syncing = true;
      _loadPackage(yamlText);
      SESSION._syncing = false;
    }
  });

  SESSION.socket.on('tab-changed', (tab) => {
    if (SESSION.role === 'presentee') {
      SESSION._syncing = true;
      _showTab(tab);
      SESSION._syncing = false;
    }
  });

  SESSION.socket.on('theme-changed', (theme) => {
    if (SESSION.role === 'presentee') {
      SESSION._syncing = true;
      _setTheme(theme);
      SESSION._syncing = false;
    }
  });

  SESSION.socket.on('display-changed', (display) => {
    if (SESSION.role === 'presentee') {
      SESSION._syncing = true;
      if (display.timeMode)  _setTimeMode(display.timeMode);
      if (display.coordMode) _setCoordMode(display.coordMode);
      SESSION._syncing = false;
    }
  });

  SESSION.socket.on('presenter-disconnected', () => {
    console.warn('[SESSION] Presenter disconnected');
  });

  SESSION.socket.on('disconnect', () => {
    SESSION.connected = false;
  });
}

// ── Auto-join from URL parameters (backwards compatible) ─────
(function initFromURL() {
  const params    = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');
  if (sessionId) {
    joinSession(sessionId, params.get('role') || 'presentee', '');
  }
})();

// ── UI helpers ───────────────────────────────────────────────
function applyPresenteeUI() {
  // Hide the LOAD PACKAGE button
  const loadBtn = document.querySelector('.load-btn');
  if (loadBtn) loadBtn.style.display = 'none';

  // Disable file input
  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.disabled = true;

  // Replace drop-zone content with a waiting message
  const dropZone = document.getElementById('dropZone');
  if (dropZone) {
    dropZone.innerHTML =
      '<div class="drop-icon">\u23F3</div>' +
      '<div class="drop-label">WAITING FOR PRESENTER</div>' +
      '<div class="drop-sub">The presenter will load the briefing package.</div>';
    dropZone.style.pointerEvents = 'none';
  }
}

function showSessionIndicator(sessionId, role) {
  // Remove existing indicator
  const existing = document.querySelector('.session-indicator');
  if (existing) existing.remove();

  const indicator = document.createElement('div');
  indicator.className = 'session-indicator role-' + role;
  indicator.textContent = role.toUpperCase() + ' \u2022 ' + sessionId;
  const headerRight = document.querySelector('.header-right');
  if (headerRight) headerRight.prepend(indicator);
}
