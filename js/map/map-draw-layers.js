// ═══════════════════════════════════════════════════════════
// map-draw-layers.js — Grid, land, and city drawing
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Grid ─────────────────────────────────────────────────
// Returns the grid <g> element.
function drawGrid(ctx) {
  const gridG = svgEl('g');
  // Lines extend beyond canvas so they stay visible while panning
  for (let lon=Math.floor(ctx.vMinLon/ctx.step)*ctx.step-ctx.step; lon<=ctx.vMaxLon+ctx.step; lon+=ctx.step) {
    const x = ctx.bx(lon);
    const l = svgEl('line');
    l.setAttribute('x1',x); l.setAttribute('y1',-ctx.H);
    l.setAttribute('x2',x); l.setAttribute('y2',ctx.H*2);
    l.setAttribute('stroke',ctx.C.grid); l.setAttribute('stroke-width','0.5');
    gridG.appendChild(l);
  }
  for (let lat=Math.floor(ctx.vMinLat/ctx.step)*ctx.step-ctx.step; lat<=ctx.vMaxLat+ctx.step; lat+=ctx.step) {
    const y = ctx.by(lat);
    const l = svgEl('line');
    l.setAttribute('x1',-ctx.W); l.setAttribute('y1',y);
    l.setAttribute('x2',ctx.W*2); l.setAttribute('y2',y);
    l.setAttribute('stroke',ctx.C.grid); l.setAttribute('stroke-width','0.5');
    gridG.appendChild(l);
  }
  return gridG;
}

// ── Land ─────────────────────────────────────────────────
// Returns the land <g> element.
function drawLand(ctx, geoData) {
  const landG = svgEl('g');
  Object.values(geoData.countries).forEach(poly => {
    const path = svgEl('path');
    path.setAttribute('d', poly.map((pt,i)=>
      `${i?'L':'M'}${ctx.bx(pt[0]).toFixed(1)},${ctx.by(pt[1]).toFixed(1)}`).join(' ')+' Z');
    path.setAttribute('fill',ctx.C.land);
    path.setAttribute('stroke',ctx.C.border);
    path.setAttribute('stroke-width','0.8');
    landG.appendChild(path);
  });
  return landG;
}

// ── Cities ───────────────────────────────────────────────
// Returns the cities <g> element.
function drawCities(ctx, geoData) {
  const cityG = svgEl('g');
  geoData.cities.forEach(city => {
    const cx=ctx.bx(city.lon), cy=ctx.by(city.lat);
    const major=city.pop===3, r=major?2.8:city.pop===2?2:1.4;
    const circ=svgEl('circle');
    circ.setAttribute('cx',cx); circ.setAttribute('cy',cy); circ.setAttribute('r',r);
    circ.setAttribute('fill',major?ctx.C.cityMajor:ctx.C.cityDot); circ.setAttribute('opacity','0.6');
    cityG.appendChild(circ);
    const t=svgEl('text');
    t.setAttribute('x',cx+3); t.setAttribute('y',cy-2);
    t.setAttribute('font-size',major?'7':'6');
    t.setAttribute('font-family','IBM Plex Mono,monospace');
    t.setAttribute('font-weight',major?'600':'400');
    t.setAttribute('fill',major?ctx.C.cityMajor:ctx.C.cityLbl);
    t.setAttribute('opacity','0.7'); t.textContent=city.n;
    cityG.appendChild(t);
  });
  return cityG;
}
