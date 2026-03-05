// ═══════════════════════════════════════════════════════════
// map-state.js — Shared pan/zoom state for the MAP tab
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Pan/zoom state ─────────────────────────────────────────
const MAP_VP = {
  // Base transform set by drawMap on first render, then user pans/zooms
  tx: 0, ty: 0, scale: 1,
  dragging: false, lastX: 0, lastY: 0,
  // Pinch
  lastDist: null,
  // SVG content group reference
  contentG: null,
  svgEl: null,
  // Reset function
  resetFn: null,
};
