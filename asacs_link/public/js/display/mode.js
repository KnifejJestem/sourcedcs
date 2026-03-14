/* ════════════════════════════════════════════════════════════
   display/mode.js — PROF / MFD mode switcher

   PROF mode: text-table view (traditional GCI display)
   MFD  mode: map-centric view (Mapbox GL JS)

   Exposes a single global: AsacsMode
════════════════════════════════════════════════════════════ */
'use strict';

const AsacsMode = (() => {
  const MODES   = ['prof', 'mfd'];
  const KEY     = 'asacs-display-mode';

  let _current  = sessionStorage.getItem(KEY) || 'prof';
  let _onChange = null;

  function _applyMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    // Toggle top-level view containers
    const profEl = document.getElementById('view-prof');
    const mfdEl  = document.getElementById('view-mfd');
    if (profEl) profEl.classList.toggle('hidden', mode !== 'prof');
    if (mfdEl)  mfdEl.classList.toggle('hidden',  mode !== 'mfd');

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
