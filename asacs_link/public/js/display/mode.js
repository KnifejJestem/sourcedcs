/* ════════════════════════════════════════════════════════════
   display/mode.js — PROF / MFD / TABLE mode switcher

   PROF and MFD are both map-centric views with different visual
   styles (analogous to light / dark mode):
     PROF  — dark tactical overlay, standard map
     MFD   — satellite imagery base, tactical overlay

   TABLE — debug/diagnostic view: raw data table
           useful for verifying the DCS → server data pipeline

   Exposes a single global: AsacsMode
════════════════════════════════════════════════════════════ */
'use strict';

const AsacsMode = (() => {
  const MODES = ['prof', 'mfd', 'table'];
  const KEY   = 'asacs-display-mode';

  let _current  = sessionStorage.getItem(KEY) || 'prof';
  let _onChange = null;

  function _applyMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Map container: visible for prof + mfd; hidden for table
    const mapEl   = document.getElementById('view-map');
    const tableEl = document.getElementById('view-table');

    if (mapEl)   mapEl.classList.toggle('hidden',  mode === 'table');
    if (tableEl) tableEl.classList.toggle('hidden', mode !== 'table');

    sessionStorage.setItem(KEY, mode);
    if (_onChange) _onChange(mode);

    // Tell the map which visual style to use
    if (mode !== 'table' && typeof AsacsMap !== 'undefined') {
      AsacsMap.setDisplayMode(mode);
    }
  }

  function setMode(mode) {
    if (!MODES.includes(mode)) return;
    _current = mode;
    _applyMode(mode);
  }

  function getMode() { return _current; }

  function onModeChange(fn) { _onChange = fn; }

  /** Must be called once the DOM is ready. */
  function init() {
    _applyMode(_current);
  }

  return { setMode, getMode, onModeChange, init };
})();
