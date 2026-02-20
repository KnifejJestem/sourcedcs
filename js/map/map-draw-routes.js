// ═══════════════════════════════════════════════════════════
// map-draw-routes.js — Per-mission route groups (lines + markers)
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Per-mission route groups (lines + markers together) ──
// Each mission gets ONE <g data-msn="key"> so we can toggle opacity atomically.
// Returns msnGroups (object mapping msnKey → SVGElement).
function drawRoutes(ctx, routes, points, showPopup) {
  const msnGroups = {};

  routes.forEach(r => {
    const g = svgEl('g');
    g.setAttribute('data-msn', r.msnKey);
    msnGroups[r.msnKey] = g;

    // ── Route lines ──────────────────────────────────────
    for (let i = 0; i < r.pts.length - 1; i++) {
      const p0 = r.pts[i], p1 = r.pts[i + 1];
      const toTgt = p1.kind === 'target-node';
      g.appendChild(makeSvgEl('line', {
        x1: ctx.bx(p0.lon).toFixed(1), y1: ctx.by(p0.lat).toFixed(1),
        x2: ctx.bx(p1.lon).toFixed(1), y2: ctx.by(p1.lat).toFixed(1),
        stroke:              r.color,
        'stroke-width':      toTgt ? 2   : 1.2,
        'stroke-dasharray':  toTgt ? '6,3' : '2,6',
        'stroke-opacity':    0.9,
        'vector-effect':     'non-scaling-stroke',
      }));
    }

    // ── Steer + target markers ───────────────────────────
    points
      .filter(p => (p.kind === 'steer' || p.kind === 'target') &&
                   p.mission?.mission_number === r.msnNum &&
                   p.mission?.callsign       === r.callsign)
      .forEach(p => {
        const mx = ctx.bx(p.lon).toFixed(1);
        const my = ctx.by(p.lat).toFixed(1);
        const mg = svgEl('g');
        mg.setAttribute('transform', `translate(${mx},${my})`);
        mg._baseX = mx; mg._baseY = my;

        // Hit circle makes small markers easier to click
        mg.appendChild(makeSvgEl('circle', { r: 14, fill: 'transparent', stroke: 'none' }));

        if (p.kind === 'steer') {
          mg.appendChild(makeSvgEl('circle', { r: 4, fill: 'none', stroke: p.color, 'stroke-width': 1.2 }));
          mapLabel(mg, p.sub, p.label, p.color, 7);
        } else {
          mg.appendChild(makeSvgEl('polygon', { points: '0,-8 7,0 0,8 -7,0', fill: p.color + 'cc', stroke: p.color, 'stroke-width': 1.2 }));
          mg.appendChild(makeSvgEl('circle',  { r: 2, fill: '#fff', opacity: 0.9 }));
          mapLabel(mg, p.sub, p.label, p.color, 10);
        }

        mg.style.cursor = 'pointer';
        mg.addEventListener('click', e => { e.stopPropagation(); showPopup(p); });
        ctx.constantSizeMarkers.push(mg);
        g.appendChild(mg);
      });
  });

  return msnGroups;
}
