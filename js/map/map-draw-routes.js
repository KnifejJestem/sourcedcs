// ═══════════════════════════════════════════════════════════
// map-draw-routes.js — Per-mission route groups (lines + markers)
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Per-mission route groups (lines + markers together) ──
// Each mission gets ONE <g data-msn="key"> so we can toggle opacity atomically.
// Returns msnGroups (object mapping msnKey → SVGElement).
// IMPORTANT: the route groups must be added to a parent in drawMap, not here.
function drawRoutes(ctx, routes, points, showPopup) {
  const msnGroups = {}; // key → SVGElement

  routes.forEach(r => {
    const g = svgEl('g'); g.setAttribute('data-msn', r.msnKey);
    msnGroups[r.msnKey] = g;

    // Route lines
    for (let i=0; i<r.pts.length-1; i++) {
      const p0=r.pts[i], p1=r.pts[i+1];
      const toTgt = p1.kind==='target-node';
      const line=svgEl('line');
      line.setAttribute('x1',ctx.bx(p0.lon).toFixed(1)); line.setAttribute('y1',ctx.by(p0.lat).toFixed(1));
      line.setAttribute('x2',ctx.bx(p1.lon).toFixed(1)); line.setAttribute('y2',ctx.by(p1.lat).toFixed(1));
      line.setAttribute('stroke',r.color);
      line.setAttribute('stroke-width', toTgt?'2':'1.2');
      line.setAttribute('stroke-dasharray', toTgt?'6,3':'2,6');
      line.setAttribute('stroke-opacity','0.9');
      line.setAttribute('vector-effect','non-scaling-stroke');
      g.appendChild(line);
    }

    // Steer + target markers belonging to this mission
    points.filter(p=>(p.kind==='steer'||p.kind==='target') && p.mission?.mission_number===r.msnNum && p.mission?.callsign===r.callsign).forEach(p => {
      const mg=svgEl('g');
      const mx = ctx.bx(p.lon).toFixed(1), my = ctx.by(p.lat).toFixed(1);
      mg.setAttribute('transform',`translate(${mx},${my})`);
      mg._baseX = mx; mg._baseY = my;
      if (p.kind==='steer') {
        const col=p.color;
        const circ=svgEl('circle'); circ.setAttribute('r','4');
        circ.setAttribute('fill','none'); circ.setAttribute('stroke',col);
        circ.setAttribute('stroke-width','1.2'); mg.appendChild(circ);
        mapLabel(mg, p.sub, p.label, col, 7);
      } else {
        const col=p.color;
        const dia=svgEl('polygon'); dia.setAttribute('points','0,-8 7,0 0,8 -7,0');
        dia.setAttribute('fill',col+'cc'); dia.setAttribute('stroke',col);
        dia.setAttribute('stroke-width','1.2'); mg.appendChild(dia);
        const cd=svgEl('circle'); cd.setAttribute('r','2');
        cd.setAttribute('fill','#fff'); cd.setAttribute('opacity','0.9'); mg.appendChild(cd);
        mapLabel(mg, p.sub, p.label, col, 10);
      }
      mg.style.cursor = 'pointer';
      mg.addEventListener('click', e => { e.stopPropagation(); showPopup(p); });
      ctx.constantSizeMarkers.push(mg);
      g.appendChild(mg);
    });
  });

  return msnGroups;
}
