// ═══════════════════════════════════════════════════════════
// map-draw-zones.js — Engagement zones, ACO airspaces
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Engagement zones (drawn first, behind routes and markers) ──
// Returns { group: SVGElement, threatCol: string }
function drawEngagementZones(ctx, points) {
  const threatCol = ctx.movie ? '#ff4444' : '#c0392b';
  const engZoneG = svgEl('g');
  points.filter(p => p.kind === 'threat' && p.engagementRange).forEach(p => {
    const circ = svgEl('circle');
    circ.setAttribute('cx', ctx.bx(p.lon).toFixed(1));
    circ.setAttribute('cy', ctx.by(p.lat).toFixed(1));
    circ.setAttribute('r', ctx.nmToSvg(p.engagementRange).toFixed(1));
    circ.setAttribute('fill', ctx.movie ? 'rgba(255,68,68,0.08)' : 'rgba(192,57,43,0.07)');
    circ.setAttribute('stroke', threatCol);
    circ.setAttribute('stroke-width', '1.5');
    circ.setAttribute('stroke-dasharray', '6,3');
    circ.setAttribute('vector-effect', 'non-scaling-stroke');
    circ.setAttribute('pointer-events', 'none');
    engZoneG.appendChild(circ);
  });
  return { group: engZoneG, threatCol: threatCol };
}

// ── ACO airspace zones (orbits, ROZ, restricted zones, etc.) ──
// Returns { group: SVGElement, colors: object, defaultCol: string }
function drawAirspaces(ctx, airspaces, showPopup) {
  const airspaceColors = {
    ROZ:   ctx.movie ? '#ffb347' : '#c07c2b',
    ORBIT: ctx.movie ? '#4fc3f7' : '#1a3a6b',
    MEZ:   ctx.movie ? '#c084fc' : '#4a1a6b',
    NFZ:   ctx.movie ? '#ff4444' : '#9b1c1c',
    TRA:   ctx.movie ? '#ffb020' : '#7c5000',
    ANCHOR:ctx.movie ? '#00e5ff' : '#006680',
  };
  const defaultAirspaceCol = ctx.movie ? '#6aaa7a' : '#5a6a60';
  const airspaceG = svgEl('g');

  airspaces.forEach(a => {
    const col = airspaceColors[(a.type || '').toUpperCase()] || defaultAirspaceCol;
    if (a.shape === 'circle') {
      const fillOpacity = ctx.movie ? 0.08 : 0.07;
      // Semi-transparent fill circle
      const fillCirc = svgEl('circle');
      fillCirc.setAttribute('cx', ctx.bx(a.lon).toFixed(1));
      fillCirc.setAttribute('cy', ctx.by(a.lat).toFixed(1));
      fillCirc.setAttribute('r', ctx.nmToSvg(a.radiusNm || 5).toFixed(1));
      fillCirc.setAttribute('fill', col);
      fillCirc.setAttribute('opacity', String(fillOpacity));
      fillCirc.style.cursor = 'pointer';
      fillCirc.addEventListener('click', e => { e.stopPropagation(); showPopup(a); });
      airspaceG.appendChild(fillCirc);
      // Stroke-only circle on top
      const circ = svgEl('circle');
      circ.setAttribute('cx', ctx.bx(a.lon).toFixed(1));
      circ.setAttribute('cy', ctx.by(a.lat).toFixed(1));
      circ.setAttribute('r', ctx.nmToSvg(a.radiusNm || 5).toFixed(1));
      circ.setAttribute('fill', 'none');
      circ.setAttribute('stroke', col);
      circ.setAttribute('stroke-width', '1.8');
      circ.setAttribute('stroke-dasharray', '8,4');
      circ.setAttribute('vector-effect', 'non-scaling-stroke');
      circ.style.cursor = 'pointer';
      circ.addEventListener('click', e => { e.stopPropagation(); showPopup(a); });
      airspaceG.appendChild(circ);
      // Label at center
      const lblG = svgEl('g');
      const lblX = ctx.bx(a.lon).toFixed(1);
      const lblY = ctx.by(a.lat).toFixed(1);
      lblG.setAttribute('transform', `translate(${lblX},${lblY})`);
      lblG._baseX = lblX; lblG._baseY = lblY;
      const lbl = svgEl('text');
      lbl.setAttribute('x', 0);
      lbl.setAttribute('y', 0);
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('dominant-baseline', 'central');
      lbl.setAttribute('font-size', '8');
      lbl.setAttribute('font-family', 'IBM Plex Mono,monospace');
      lbl.setAttribute('font-weight', '600');
      lbl.setAttribute('fill', col);
      lbl.setAttribute('opacity', '0.8');
      lbl.setAttribute('pointer-events', 'none');
      lbl.textContent = `${a.name || '?'} (${(a.type || '?').toUpperCase()})`;
      lblG.appendChild(lbl);
      ctx.constantSizeMarkers.push(lblG);
      airspaceG.appendChild(lblG);
    } else if (a.shape === 'polygon' && a.boundary) {
      const fillOpacity = ctx.movie ? 0.08 : 0.07;
      const pathD = a.boundary.map((pt, i) =>
        `${i ? 'L' : 'M'}${ctx.bx(pt.lon).toFixed(1)},${ctx.by(pt.lat).toFixed(1)}`).join(' ') + ' Z';
      const fill = svgEl('path');
      fill.setAttribute('d', pathD);
      fill.setAttribute('fill', col);
      fill.setAttribute('opacity', String(fillOpacity));
      fill.style.cursor = 'pointer';
      fill.addEventListener('click', e => { e.stopPropagation(); showPopup(a); });
      airspaceG.appendChild(fill);
      const stroke = svgEl('path');
      stroke.setAttribute('d', pathD);
      stroke.setAttribute('fill', 'none');
      stroke.setAttribute('stroke', col);
      stroke.setAttribute('stroke-width', '1.8');
      stroke.setAttribute('stroke-dasharray', '8,4');
      stroke.setAttribute('vector-effect', 'non-scaling-stroke');
      stroke.style.cursor = 'pointer';
      stroke.addEventListener('click', e => { e.stopPropagation(); showPopup(a); });
      airspaceG.appendChild(stroke);
      // Label at centroid
      const cx = a.boundary.reduce((s, pt) => s + ctx.bx(pt.lon), 0) / a.boundary.length;
      const cy = a.boundary.reduce((s, pt) => s + ctx.by(pt.lat), 0) / a.boundary.length;
      const lblG = svgEl('g');
      const lblX = cx.toFixed(1), lblY = cy.toFixed(1);
      lblG.setAttribute('transform', `translate(${lblX},${lblY})`);
      lblG._baseX = lblX; lblG._baseY = lblY;
      const lbl = svgEl('text');
      lbl.setAttribute('x', 0);
      lbl.setAttribute('y', 0);
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('dominant-baseline', 'central');
      lbl.setAttribute('font-size', '8');
      lbl.setAttribute('font-family', 'IBM Plex Mono,monospace');
      lbl.setAttribute('font-weight', '600');
      lbl.setAttribute('fill', col);
      lbl.setAttribute('opacity', '0.8');
      lbl.setAttribute('pointer-events', 'none');
      lbl.textContent = `${a.name || '?'} (${(a.type || '?').toUpperCase()})`;
      lblG.appendChild(lbl);
      ctx.constantSizeMarkers.push(lblG);
      airspaceG.appendChild(lblG);
    } else if (a.shape === 'anchor' && a.anchorPt) {
      // Racetrack/anchor pattern — outline only with direction arrow
      const rPts = generateRacetrack(a.anchorPt.lat, a.anchorPt.lon,
        a.headingDeg || 0, a.legLengthNm || 10, (a.legLengthNm || 10) / 4, a.direction === 'ccw');
      const pathD = rPts.map((pt, i) =>
        `${i ? 'L' : 'M'}${ctx.bx(pt.lon).toFixed(1)},${ctx.by(pt.lat).toFixed(1)}`).join(' ') + ' Z';
      const outline = svgEl('path');
      outline.setAttribute('d', pathD);
      outline.setAttribute('fill', 'none');
      outline.setAttribute('stroke', col);
      outline.setAttribute('stroke-width', '2');
      outline.setAttribute('vector-effect', 'non-scaling-stroke');
      outline.style.cursor = 'pointer';
      outline.addEventListener('click', e => { e.stopPropagation(); showPopup(a); });
      airspaceG.appendChild(outline);
      // Direction arrow on the hot leg midpoint
      const headRad = (a.headingDeg || 0) * Math.PI / 180;
      const cosLat = Math.cos(a.anchorPt.lat * Math.PI / 180);
      const halfLen = (a.legLengthNm || 10) / 2;
      const midLat = a.anchorPt.lat + Math.cos(headRad) * halfLen / 60;
      const midLon = a.anchorPt.lon + Math.sin(headRad) * halfLen / (60 * cosLat);
      const amx = ctx.bx(midLon).toFixed(1), amy = ctx.by(midLat).toFixed(1);
      const arrowG = svgEl('g');
      arrowG.setAttribute('transform', `translate(${amx},${amy})`);
      arrowG._baseX = amx; arrowG._baseY = amy;
      // Arrow points in the heading direction; in SVG: dx=sin(h), dy=-cos(h)
      const adx = Math.sin(headRad), ady = -Math.cos(headRad);
      const arrSize = 6;
      const perpX = -ady, perpY = adx; // perpendicular
      const arrowPath = svgEl('polygon');
      arrowPath.setAttribute('points',
        `${(adx*arrSize).toFixed(1)},${(ady*arrSize).toFixed(1)} ` +
        `${(-adx*arrSize + perpX*arrSize*0.5).toFixed(1)},${(-ady*arrSize + perpY*arrSize*0.5).toFixed(1)} ` +
        `${(-adx*arrSize - perpX*arrSize*0.5).toFixed(1)},${(-ady*arrSize - perpY*arrSize*0.5).toFixed(1)}`);
      arrowPath.setAttribute('fill', col);
      arrowPath.setAttribute('opacity', '0.9');
      arrowG.appendChild(arrowPath);
      ctx.constantSizeMarkers.push(arrowG);
      airspaceG.appendChild(arrowG);
      // Label at anchor point
      const lblG = svgEl('g');
      const lblX = ctx.bx(a.anchorPt.lon).toFixed(1);
      const lblY = (ctx.by(a.anchorPt.lat) - 5).toFixed(1);
      lblG.setAttribute('transform', `translate(${lblX},${lblY})`);
      lblG._baseX = lblX; lblG._baseY = lblY;
      const lbl = svgEl('text');
      lbl.setAttribute('x', 0);
      lbl.setAttribute('y', 0);
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('font-size', '8');
      lbl.setAttribute('font-family', 'IBM Plex Mono,monospace');
      lbl.setAttribute('font-weight', '600');
      lbl.setAttribute('fill', col);
      lbl.setAttribute('opacity', '0.8');
      lbl.setAttribute('pointer-events', 'none');
      lbl.textContent = `${a.name || '?'} (${(a.type || '?').toUpperCase()} ${a.direction === 'ccw' ? 'CCW' : 'CW'})`;
      lblG.appendChild(lbl);
      ctx.constantSizeMarkers.push(lblG);
      airspaceG.appendChild(lblG);
    }
  });

  return { group: airspaceG, colors: airspaceColors, defaultCol: defaultAirspaceCol };
}

// ── Racetrack generator ──────────────────────────────────
// Returns an array of {lat,lon} points forming a closed racetrack
// (two parallel legs connected by semicircular turns).
function generateRacetrack(anchorLat, anchorLon, headingDeg, legLengthNm, turnRadiusNm, isCCW) {
  const headRad = headingDeg * Math.PI / 180;
  const cosLat = Math.cos(anchorLat * Math.PI / 180);
  const nmToLat = 1 / 60;
  const nmToLon = 1 / (60 * cosLat);

  function localToGeo(x, y) {
    return {
      lat: anchorLat + (x * Math.cos(headRad) - y * Math.sin(headRad)) * nmToLat,
      lon: anchorLon + (x * Math.sin(headRad) + y * Math.cos(headRad)) * nmToLon,
    };
  }

  const L = legLengthNm;
  const R = turnRadiusNm;
  const s = isCCW ? -1 : 1; // CW → right (+y), CCW → left (-y)
  const N = 16; // arc segments per semicircle
  const pts = [];

  // Hot leg: from anchor (0,0) to (L,0) in local heading-aligned frame
  pts.push(localToGeo(0, 0));
  pts.push(localToGeo(L, 0));

  // Turn 1: semicircular arc at end of hot leg, center at (L, R*s)
  // Sweeps from heading side (-s*π/2) through perpendicular to return side
  for (let i = 1; i <= N; i++) {
    const a = -s * Math.PI / 2 + Math.PI * i / N;
    pts.push(localToGeo(L + R * Math.cos(a), s * R + R * Math.sin(a)));
  }

  // Return leg: from (L, 2R*s) to (0, 2R*s)
  pts.push(localToGeo(0, 2 * R * s));

  // Turn 2: semicircular arc at start of hot leg, center at (0, R*s)
  // Sweeps from return side (s*π/2) back to anchor completing the loop
  for (let i = 1; i <= N; i++) {
    const a = s * (Math.PI / 2 + Math.PI * i / N);
    pts.push(localToGeo(R * Math.cos(a), s * R + R * Math.sin(a)));
  }

  return pts;
}
