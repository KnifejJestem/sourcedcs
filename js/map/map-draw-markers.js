// ═══════════════════════════════════════════════════════════
// map-draw-markers.js — Shared markers + threat markers
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Shared markers (always visible: bullseye, airfields, carriers) ──
// Returns the shared markers <g> element.
function drawSharedMarkers(ctx, points, showPopup) {
  const sharedG = svgEl('g');

  points.filter(p => ['bullseye', 'airfield', 'carrier'].includes(p.kind)).forEach(p => {
    const mx = ctx.bx(p.lon).toFixed(1);
    const my = ctx.by(p.lat).toFixed(1);
    const g  = svgEl('g');
    g.setAttribute('transform', `translate(${mx},${my})`);
    g._baseX = mx; g._baseY = my;

    // Large transparent hit circle for reliable clicking (especially at zoom-in)
    g.appendChild(makeSvgEl('circle', { r: 18, fill: 'transparent', stroke: 'none' }));

    if (p.kind === 'bullseye') {
      const col = '#ffb020';
      [[-15, 0, 15, 0], [0, -15, 0, 15]].forEach(([x1, y1, x2, y2]) =>
        g.appendChild(makeSvgEl('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': 1.5 })));
      g.appendChild(makeSvgEl('circle', { r: 10, fill: 'none', stroke: col, 'stroke-width': 1.2, opacity: 0.5 }));
      g.appendChild(makeSvgEl('circle', { r:  3, fill: col }));
      mapLabel(g, p.label, '', col, 17);

    } else if (p.kind === 'airfield') {
      const col = ctx.C.af;
      [[-12, 0, 12, 0], [0, -7, 0, 7]].forEach(([x1, y1, x2, y2]) =>
        g.appendChild(makeSvgEl('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': 2.5, 'stroke-linecap': 'round' })));
      mapLabel(g, p.label, p.sub, col, 14);

    } else if (p.kind === 'carrier') {
      const col = ctx.C.cv;
      g.appendChild(makeSvgEl('circle', { r: 5, fill: 'none', stroke: col, 'stroke-width': 1.5 }));
      [[0, -5, 0, 5], [-5, 0, 5, 0], [0, 5, 0, 12], [-5, 12, 5, 12]].forEach(([x1, y1, x2, y2]) =>
        g.appendChild(makeSvgEl('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': 1.5 })));
      mapLabel(g, p.label, p.sub, col, 14);
    }

    g.style.cursor = 'pointer';
    g.addEventListener('click', e => { e.stopPropagation(); showPopup(p); });
    ctx.constantSizeMarkers.push(g);
    sharedG.appendChild(g);
  });

  return sharedG;
}

// ── Threat markers ──────────────────────────────────────
// Returns the threat markers <g> element.
function drawThreatMarkers(ctx, points, threatCol, showPopup) {
  const threatG = svgEl('g');

  points.filter(p => p.kind === 'threat').forEach(p => {
    const mx = ctx.bx(p.lon).toFixed(1);
    const my = ctx.by(p.lat).toFixed(1);
    const g  = svgEl('g');
    g.setAttribute('transform', `translate(${mx},${my})`);
    g._baseX = mx; g._baseY = my;
    g.style.cursor = 'pointer';

    g.appendChild(makeSvgEl('circle', { r: 18, fill: 'transparent', stroke: 'none' }));
    [[-7, -7, 7, 7], [7, -7, -7, 7]].forEach(([x1, y1, x2, y2]) =>
      g.appendChild(makeSvgEl('line', { x1, y1, x2, y2, stroke: threatCol, 'stroke-width': 2.5, 'stroke-linecap': 'round' })));
    g.appendChild(makeSvgEl('circle', { r: 5, fill: 'none', stroke: threatCol, 'stroke-width': 1.2 }));
    mapLabel(g, p.label, p.sub, threatCol, 9);

    g.addEventListener('click', e => { e.stopPropagation(); showPopup(p); });
    ctx.constantSizeMarkers.push(g);
    threatG.appendChild(g);
  });

  return threatG;
}
