/* ════════════════════════════════════════════════════════════
   display/mode.js — MAP / TABLE view switcher

   Controls which top-level view is visible:
     MAP   — the Mapbox tactical map (default)
     TABLE — debug/diagnostic view: raw data tables

   UI theme (PROF light / MFD dark) and map base layer
   (CHART vector / TERRAIN satellite) are controlled
   independently by AsacsTheme and AsacsMapType in theme.js.

   Exposes a single global: AsacsMode
════════════════════════════════════════════════════════════ */
'use strict';

const AsacsMode = (() => {
  const MODES = ['map', 'table'];
  const KEY   = 'asacs-view-mode';

  let _current  = sessionStorage.getItem(KEY) || 'map';
  let _onChange = null;

  function _applyMode(mode) {
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Map container: visible for map mode; hidden for table
    const mapEl   = document.getElementById('view-map');
    const tableEl = document.getElementById('view-table');

    if (mapEl)   mapEl.classList.toggle('hidden',  mode === 'table');
    if (tableEl) tableEl.classList.toggle('hidden', mode !== 'table');

    sessionStorage.setItem(KEY, mode);
    if (_onChange) _onChange(mode);
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
