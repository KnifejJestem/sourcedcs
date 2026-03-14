/* ════════════════════════════════════════════════════════════
   display/theme.js — UI theme and map-base-layer switchers

   AsacsTheme — toggles the CSS theme via the html.prof class
     MFD  (default) — dark military green-on-black (scanline FX)
     PROF           — light professional paper-like style

   AsacsMapType — changes the Mapbox base-map style
     CHART   (default) — dark vector map (Mapbox dark-v11)
     TERRAIN           — satellite imagery (satellite-streets-v12)

   Both choices persist to sessionStorage so they survive
   soft page reloads within a session.

   Exposes two globals: AsacsTheme, AsacsMapType
════════════════════════════════════════════════════════════ */
'use strict';

// ── UI Theme (PROF / MFD) ─────────────────────────────────────

const AsacsTheme = (() => {
  const KEY = 'asacs-ui-theme';

  let _current = sessionStorage.getItem(KEY) || 'mfd';

  function set(theme) {
    _current = theme;
    sessionStorage.setItem(KEY, theme);
    // Toggle the .prof class on <html> — CSS custom-property block
    // :root.prof overrides the default MFD dark-green tokens.
    document.documentElement.classList.toggle('prof', theme === 'prof');
    document.querySelectorAll('[data-theme]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
  }

  function get() { return _current; }

  /** Apply the stored (or default) theme, updating buttons and CSS class. */
  function init() { set(_current); }

  return { set, get, init };
})();

// ── Map Base Layer (CHART / TERRAIN) ─────────────────────────

const AsacsMapType = (() => {
  const KEY = 'asacs-map-type';

  let _current = sessionStorage.getItem(KEY) || 'chart';

  function set(type) {
    _current = type;
    sessionStorage.setItem(KEY, type);
    document.querySelectorAll('[data-maptype]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.maptype === type);
    });
    // Delegate to the map module which manages the Mapbox style swap
    if (typeof AsacsMap !== 'undefined') AsacsMap.setDisplayMode(type);
  }

  function get() { return _current; }

  /** Apply the stored (or default) map type, updating buttons and the map. */
  function init() { set(_current); }

  return { set, get, init };
})();
