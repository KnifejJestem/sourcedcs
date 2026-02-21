// ═══════════════════════════════════════════════════════════
// session.js — Client-side session & role management
// ═══════════════════════════════════════════════════════════
//
// Connects presenter ↔ presentee via Socket.io.
//
// URL parameters:
//   ?session=<id>                  → join as presentee (default)
//   ?session=<id>&role=presenter   → join as presenter
//   (no ?session)                  → standalone mode (original behaviour)
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

(function initSession() {
  const params    = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');

  // No session param → standalone mode, nothing to do
  if (!sessionId) return;

  SESSION.sessionId = sessionId;
  SESSION.role = params.get('role') === 'presenter' ? 'presenter' : 'presentee';

  // ── Wrap global functions to add sync behaviour ────────────
  // These are defined in app.js (loaded before this script).
  const _loadPackage  = window.loadPackage;
  const _showTab      = window.showTab;
  const _setTheme     = window.setTheme;
  const _setTimeMode  = window.setTimeMode;
  const _setCoordMode = window.setCoordMode;

  // Presenter overrides: broadcast actions to the session
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
  }

  // ── Presentee: disable package loading in the UI ───────────
  if (SESSION.role === 'presentee') {
    document.addEventListener('DOMContentLoaded', () => {
      applyPresenteeUI();
    });
  }

  // ── Connect to server ─────────────────────────────────────
  SESSION.socket = io();

  SESSION.socket.on('connect', () => {
    SESSION.connected = true;
    SESSION.socket.emit('join', {
      sessionId: SESSION.sessionId,
      role:      SESSION.role,
    });
  });

  // ── Receive initial session state ──────────────────────────
  SESSION.socket.on('session-state', (state) => {
    if (SESSION.role === 'presentee') {
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
})();

// ── UI adjustments for the presentee role ─────────────────────
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
