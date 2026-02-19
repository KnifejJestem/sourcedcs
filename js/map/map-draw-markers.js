// ═══════════════════════════════════════════════════════════
// map-draw-markers.js — Shared markers + threat markers
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Shared markers (always visible: bullseye, airfields, carriers) ──
// Returns the shared markers <g> element.
function drawSharedMarkers(ctx, points, showPopup) {
  const sharedG = svgEl('g');
  points.filter(p=>['bullseye','airfield','carrier'].includes(p.kind)).forEach(p => {
    const g=svgEl('g');
    const mx = ctx.bx(p.lon).toFixed(1), my = ctx.by(p.lat).toFixed(1);
    g.setAttribute('transform',`translate(${mx},${my})`);
    g._baseX = mx; g._baseY = my;

    if (p.kind==='bullseye') {
      const col='#ffb020';
      [[-15,0,15,0],[0,-15,0,15]].forEach(([x1,y1,x2,y2])=>{
        const l=svgEl('line'); l.setAttribute('x1',x1);l.setAttribute('y1',y1);
        l.setAttribute('x2',x2);l.setAttribute('y2',y2);
        l.setAttribute('stroke',col); l.setAttribute('stroke-width','1.5'); g.appendChild(l);
      });
      const ring=svgEl('circle'); ring.setAttribute('r','10');
      ring.setAttribute('fill','none'); ring.setAttribute('stroke',col);
      ring.setAttribute('stroke-width','1.2'); ring.setAttribute('opacity','0.5'); g.appendChild(ring);
      const cd=svgEl('circle'); cd.setAttribute('r','3'); cd.setAttribute('fill',col); g.appendChild(cd);
      mapLabel(g, p.label,'',col,17);

    } else if (p.kind==='airfield') {
      const col=ctx.C.af;
      [[-12,0,12,0],[0,-7,0,7]].forEach(([x1,y1,x2,y2])=>{
        const l=svgEl('line'); l.setAttribute('x1',x1);l.setAttribute('y1',y1);
        l.setAttribute('x2',x2);l.setAttribute('y2',y2);
        l.setAttribute('stroke',col); l.setAttribute('stroke-width','2.5');
        l.setAttribute('stroke-linecap','round'); g.appendChild(l);
      });
      mapLabel(g, p.label, p.sub, col, 14);

    } else if (p.kind==='carrier') {
      const col=ctx.C.cv;
      const cr=svgEl('circle'); cr.setAttribute('r','5');
      cr.setAttribute('fill','none'); cr.setAttribute('stroke',col);
      cr.setAttribute('stroke-width','1.5'); g.appendChild(cr);
      [[0,-5,0,5],[-5,0,5,0],[0,5,0,12],[-5,12,5,12]].forEach(([x1,y1,x2,y2])=>{
        const l=svgEl('line'); l.setAttribute('x1',x1);l.setAttribute('y1',y1);
        l.setAttribute('x2',x2);l.setAttribute('y2',y2);
        l.setAttribute('stroke',col); l.setAttribute('stroke-width','1.5'); g.appendChild(l);
      });
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
    const g = svgEl('g');
    const mx = ctx.bx(p.lon).toFixed(1), my = ctx.by(p.lat).toFixed(1);
    g.setAttribute('transform', `translate(${mx},${my})`);
    g._baseX = mx; g._baseY = my;
    g.style.cursor = 'pointer';
    [[-7,-7,7,7],[7,-7,-7,7]].forEach(([x1,y1,x2,y2]) => {
      const l = svgEl('line');
      l.setAttribute('x1',x1); l.setAttribute('y1',y1);
      l.setAttribute('x2',x2); l.setAttribute('y2',y2);
      l.setAttribute('stroke', threatCol); l.setAttribute('stroke-width','2.5');
      l.setAttribute('stroke-linecap','round'); g.appendChild(l);
    });
    const cd = svgEl('circle'); cd.setAttribute('r','5');
    cd.setAttribute('fill','none'); cd.setAttribute('stroke',threatCol);
    cd.setAttribute('stroke-width','1.2'); g.appendChild(cd);
    mapLabel(g, p.label, p.sub, threatCol, 9);
    g.addEventListener('click', e => { e.stopPropagation(); showPopup(p); });
    ctx.constantSizeMarkers.push(g);
    threatG.appendChild(g);
  });
  return threatG;
}
