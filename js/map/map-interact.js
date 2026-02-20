// ═══════════════════════════════════════════════════════════
// map-interact.js — Pan/zoom/drag event handling for the MAP
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Interaction setup ──────────────────────────────────────
// Attaches wheel, mouse, and touch event listeners to the SVG.
// state is a mutable object {tx, ty, sc} shared with drawMap.
// applyTransform and clamp are callbacks provided by drawMap.
function setupInteraction(svg, W, H, MIN_SC, MAX_SC, state, applyTransform, clamp) {

  // ── Mouse wheel / trackpad zoom ──────────────────────────
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const rect   = svg.getBoundingClientRect();
    const mx     = (e.clientX - rect.left) / rect.width  * W;
    const my     = (e.clientY - rect.top)  / rect.height * H;
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    const ns     = Math.max(MIN_SC, Math.min(MAX_SC, state.sc * factor));

    // Zoom towards the cursor — keep the point under the cursor stationary
    state.tx = mx - (mx - state.tx) * (ns / state.sc);
    state.ty = my - (my - state.ty) * (ns / state.sc);
    state.sc = ns;

    clamp();
    applyTransform();
  }, { passive: false });

  // ── Mouse drag ───────────────────────────────────────────
  let drag = null;

  svg.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    drag = { ox: e.clientX, oy: e.clientY, tx: state.tx, ty: state.ty };
    svg.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const rect = svg.getBoundingClientRect();
    const sr   = W / rect.width; // scale factor: CSS px → SVG units
    state.tx = drag.tx + (e.clientX - drag.ox) * sr;
    state.ty = drag.ty + (e.clientY - drag.oy) * sr;
    clamp();
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    drag = null;
    svg.style.cursor = 'grab';
  });

  // ── Touch (pan + pinch-to-zoom) ──────────────────────────
  let lastTouches = null;

  svg.addEventListener('touchstart', e => {
    e.preventDefault();
    lastTouches = e.touches;
  }, { passive: false });

  svg.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!lastTouches) return;

    const rect = svg.getBoundingClientRect();
    const sr   = W / rect.width;

    if (e.touches.length === 1 && lastTouches.length === 1) {
      // Single-finger pan
      state.tx += (e.touches[0].clientX - lastTouches[0].clientX) * sr;
      state.ty += (e.touches[0].clientY - lastTouches[0].clientY) * sr;
      clamp();
      applyTransform();

    } else if (e.touches.length === 2 && lastTouches.length === 2) {
      // Two-finger pinch-to-zoom, centred between the two fingers
      const prevDist = Math.hypot(
        lastTouches[0].clientX - lastTouches[1].clientX,
        lastTouches[0].clientY - lastTouches[1].clientY,
      );
      const newDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const mx   = (midX - rect.left) / rect.width  * W;
      const my   = (midY - rect.top)  / rect.height * H;
      const ns   = Math.max(MIN_SC, Math.min(MAX_SC, state.sc * newDist / Math.max(prevDist, 1)));

      state.tx = mx - (mx - state.tx) * (ns / state.sc);
      state.ty = my - (my - state.ty) * (ns / state.sc);
      state.sc = ns;

      clamp();
      applyTransform();
    }

    lastTouches = e.touches;
  }, { passive: false });

  svg.addEventListener('touchend', () => { lastTouches = null; });
}
