/* ════════════════════════════════════════════════════════════
   display/settings.js — User-configurable display settings

   Provides a settings panel (opened via the ⚙ header button)
   that lets the operator tweak map and display options without
   restarting the application.

   Settings are persisted to sessionStorage so they survive
   soft page reloads within a session.

   Exposes a single global: AsacsSettings
════════════════════════════════════════════════════════════ */
'use strict';

const AsacsSettings = (() => {
  const KEY = 'asacs-settings';

  // Default values
  const DEFAULTS = {
    mapPitch:    0,
    mapBearing:  0,
    showTrails:  1,
    showLabels:  1,
    labelSize:   10,
    updateRate:  2,
  };

  let _cfg = Object.assign({}, DEFAULTS);

  // ── Persistence ───────────────────────────────────────────

  function _load() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) _cfg = Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch { /* ignore */ }
  }

  function _save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(_cfg)); } catch { /* ignore */ }
  }

  // ── Panel control ─────────────────────────────────────────

  function open() {
    _syncInputs();
    document.getElementById('settingsOverlay').classList.add('open');
  }

  function close() {
    document.getElementById('settingsOverlay').classList.remove('open');
  }

  /** Close when clicking the backdrop (outside the panel). */
  function onOverlayClick(evt) {
    const panel = document.querySelector('.settings-panel');
    if (panel && !panel.contains(evt.target)) close();
  }

  // ── Apply ─────────────────────────────────────────────────

  function apply() {
    _readInputs();
    _save();
    if (typeof AsacsMap !== 'undefined') AsacsMap.applySettings(_cfg);
    close();
  }

  function _readInputs() {
    _cfg.mapPitch   = Number(document.getElementById('settingMapPitch').value);
    _cfg.mapBearing = Number(document.getElementById('settingMapBearing').value);
    _cfg.showTrails = Number(document.getElementById('settingShowTrails').value);
    _cfg.showLabels = Number(document.getElementById('settingShowLabels').value);
    _cfg.labelSize  = Number(document.getElementById('settingLabelSize').value);
    _cfg.updateRate = Number(document.getElementById('settingUpdateRate').value);
  }

  function _syncInputs() {
    document.getElementById('settingMapPitch').value   = _cfg.mapPitch;
    document.getElementById('settingMapBearing').value = _cfg.mapBearing;
    document.getElementById('settingShowTrails').value = _cfg.showTrails;
    document.getElementById('settingShowLabels').value = _cfg.showLabels;
    document.getElementById('settingLabelSize').value  = _cfg.labelSize;
    document.getElementById('settingUpdateRate').value = _cfg.updateRate;
  }

  function _applyToMap() {
    if (typeof AsacsMap !== 'undefined') AsacsMap.applySettings(_cfg);
  }
  function init() {
    _load();
    // Map may not be ready yet — settings are re-applied after map loads
    // via AsacsMap.applySettings() which is a no-op if map is not ready.
  }

  /** Read the current configuration (used by AsacsMap). */
  function get() {
    return Object.assign({}, _cfg);
  }

  return { open, close, onOverlayClick, apply, init, get };
})();
