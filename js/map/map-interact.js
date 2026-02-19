// ═══════════════════════════════════════════════════════════
// map-interact.js — Pan/zoom/drag event handling for the MAP
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Interaction setup ──────────────────────────────────────
// Attaches wheel, mouse, and touch event listeners to the SVG.
// state is a mutable object {tx, ty, sc} shared with drawMap.
// applyTransform and clamp are callbacks provided by drawMap.
function setupInteraction(svg, W, H, MIN_SC, MAX_SC, state, applyTransform, clamp) {
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width * W;
    const my = (e.clientY - rect.top) / rect.height * H;
    const factor = e.deltaY < 0 ? 1.18 : 1/1.18;
    const ns = Math.max(MIN_SC, Math.min(MAX_SC, state.sc * factor));
    state.tx = mx - (mx - state.tx) * (ns/state.sc);
    state.ty = my - (my - state.ty) * (ns/state.sc);
    state.sc = ns;
    clamp(); applyTransform();
  }, {passive: false});

  let drag = null;
  svg.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    drag = {ox: e.clientX, oy: e.clientY, tx: state.tx, ty: state.ty};
    svg.style.cursor = 'grabbing'; e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const rect = svg.getBoundingClientRect();
    const sr = W / rect.width;
    state.tx = drag.tx + (e.clientX - drag.ox) * sr;
    state.ty = drag.ty + (e.clientY - drag.oy) * sr;
    clamp(); applyTransform();
  });
  window.addEventListener('mouseup', () => { drag = null; svg.style.cursor = 'grab'; });

  let lastT = null;
  svg.addEventListener('touchstart', e => { e.preventDefault(); lastT = e.touches; }, {passive: false});
  svg.addEventListener('touchmove', e => {
    e.preventDefault(); if (!lastT) return;
    const rect = svg.getBoundingClientRect(), sr = W / rect.width;
    if (e.touches.length === 1 && lastT.length === 1) {
      state.tx += (e.touches[0].clientX - lastT[0].clientX) * sr;
      state.ty += (e.touches[0].clientY - lastT[0].clientY) * sr;
      clamp(); applyTransform();
    } else if (e.touches.length === 2 && lastT.length === 2) {
      const d0 = Math.hypot(lastT[0].clientX - lastT[1].clientX, lastT[0].clientY - lastT[1].clientY);
      const d1 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const mx = ((e.touches[0].clientX + e.touches[1].clientX)/2 - rect.left) / rect.width * W;
      const my = ((e.touches[0].clientY + e.touches[1].clientY)/2 - rect.top) / rect.height * H;
      const ns = Math.max(MIN_SC, Math.min(MAX_SC, state.sc * d1 / Math.max(d0, 1)));
      state.tx = mx - (mx - state.tx) * (ns/state.sc);
      state.ty = my - (my - state.ty) * (ns/state.sc);
      state.sc = ns;
      clamp(); applyTransform();
    }
    lastT = e.touches;
  }, {passive: false});
  svg.addEventListener('touchend', () => { lastT = null; });
}
