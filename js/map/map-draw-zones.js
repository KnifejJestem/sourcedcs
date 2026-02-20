// ═══════════════════════════════════════════════════════════
// map-draw-zones.js — Engagement zones, ACO airspaces
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Private helpers ──────────────────────────────────────

// Add a centered text label to a constantSizeMarkers group at (x, y).
// opts.centralBaseline = true enables dominant-baseline:central (used for
// circle/polygon labels where x,y is the shape center).
function addMapLabel(ctx, parent, x, y, text, col, opts) {
  const g = svgEl('g');
  g.setAttribute('transform', `translate(${x},${y})`);
  g._baseX = x; g._baseY = y;
  const attrs = {
    x: 0, y: 0,
    'text-anchor':  'middle',
    'font-size':     8,
    'font-family':  'IBM Plex Mono,monospace',
    'font-weight':   600,
    fill:            col,
    opacity:         0.8,
    'pointer-events': 'none',
  };
  if (opts?.centralBaseline) attrs['dominant-baseline'] = 'central';
  g.appendChild(svgText(text, attrs));
  ctx.constantSizeMarkers.push(g);
  parent.appendChild(g);
}

// Create a clickable shape (path or circle) that calls clickFn() on click.
function makeClickable(el, clickFn) {
  el.style.cursor = 'pointer';
  el.addEventListener('click', e => { e.stopPropagation(); clickFn(); });
  return el;
}

// ── Circle airspace ──────────────────────────────────────
function drawCircleAirspace(ctx, a, col, parent, showPopup) {
  const opacity = ctx.movie ? 0.08 : 0.07;
  const cx = ctx.bx(a.lon).toFixed(1);
  const cy = ctx.by(a.lat).toFixed(1);
  const r  = ctx.nmToSvg(a.radiusNm || 5).toFixed(1);
  const open = () => showPopup(a);

  parent.appendChild(makeClickable(
    makeSvgEl('circle', { cx, cy, r, fill: col, opacity }),
    open,
  ));
  parent.appendChild(makeClickable(
    makeSvgEl('circle', {
      cx, cy, r,
      fill: 'none', stroke: col,
      'stroke-width': 1.8, 'stroke-dasharray': '8,4',
      'vector-effect': 'non-scaling-stroke',
    }),
    open,
  ));
  addMapLabel(ctx, parent, cx, cy,
    `${a.name || '?'} (${(a.type || '?').toUpperCase()})`, col,
    { centralBaseline: true });
}

// ── Polygon airspace ─────────────────────────────────────
function drawPolygonAirspace(ctx, a, col, parent, showPopup) {
  const opacity = ctx.movie ? 0.08 : 0.07;
  const d = a.boundary.map((pt, i) =>
    `${i ? 'L' : 'M'}${ctx.bx(pt.lon).toFixed(1)},${ctx.by(pt.lat).toFixed(1)}`).join(' ') + ' Z';
  const open = () => showPopup(a);

  parent.appendChild(makeClickable(makeSvgEl('path', { d, fill: col, opacity }), open));
  parent.appendChild(makeClickable(
    makeSvgEl('path', {
      d, fill: 'none', stroke: col,
      'stroke-width': 1.8, 'stroke-dasharray': '8,4',
      'vector-effect': 'non-scaling-stroke',
    }),
    open,
  ));
  // Label at polygon centroid
  const cx = (a.boundary.reduce((s, pt) => s + ctx.bx(pt.lon), 0) / a.boundary.length).toFixed(1);
  const cy = (a.boundary.reduce((s, pt) => s + ctx.by(pt.lat), 0) / a.boundary.length).toFixed(1);
  addMapLabel(ctx, parent, cx, cy,
    `${a.name || '?'} (${(a.type || '?').toUpperCase()})`, col,
    { centralBaseline: true });
}

// ── Anchor / racetrack airspace ──────────────────────────
function drawAnchorAirspace(ctx, a, col, parent, showPopup) {
  const rPts = generateRacetrack(
    a.anchorPt.lat, a.anchorPt.lon,
    a.headingDeg || 0, a.legLengthNm || 10,
    (a.legLengthNm || 10) / 4,
    a.direction === 'ccw',
  );
  const d = rPts.map((pt, i) =>
    `${i ? 'L' : 'M'}${ctx.bx(pt.lon).toFixed(1)},${ctx.by(pt.lat).toFixed(1)}`).join(' ') + ' Z';
  const opacity = ctx.movie ? 0.08 : 0.07;
  const open = () => showPopup(a);

  // Semi-transparent fill (makes the interior clickable, consistent with other shapes)
  parent.appendChild(makeClickable(makeSvgEl('path', { d, fill: col, opacity }), open));
  parent.appendChild(makeClickable(
    makeSvgEl('path', { d, fill: 'none', stroke: col, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }),
    open,
  ));

  // Direction arrow on the hot leg midpoint
  const headRad = (a.headingDeg || 0) * Math.PI / 180;
  const cosLat  = Math.cos(a.anchorPt.lat * Math.PI / 180);
  const halfLen  = (a.legLengthNm || 10) / 2;
  const midLat   = a.anchorPt.lat + Math.cos(headRad) * halfLen / 60;
  const midLon   = a.anchorPt.lon + Math.sin(headRad) * halfLen / (60 * cosLat);
  const amx = ctx.bx(midLon).toFixed(1);
  const amy = ctx.by(midLat).toFixed(1);

  const adx = Math.sin(headRad), ady = -Math.cos(headRad);
  const arrSize = 6, perpX = -ady, perpY = adx;
  const arrowG = svgEl('g');
  arrowG.setAttribute('transform', `translate(${amx},${amy})`);
  arrowG._baseX = amx; arrowG._baseY = amy;
  arrowG.appendChild(makeSvgEl('polygon', {
    points:
      `${(adx * arrSize).toFixed(1)},${(ady * arrSize).toFixed(1)} ` +
      `${(-adx * arrSize + perpX * arrSize * 0.5).toFixed(1)},${(-ady * arrSize + perpY * arrSize * 0.5).toFixed(1)} ` +
      `${(-adx * arrSize - perpX * arrSize * 0.5).toFixed(1)},${(-ady * arrSize - perpY * arrSize * 0.5).toFixed(1)}`,
    fill: col, opacity: 0.9,
  }));
  ctx.constantSizeMarkers.push(arrowG);
  parent.appendChild(arrowG);

  // Label above anchor point
  const lblX = ctx.bx(a.anchorPt.lon).toFixed(1);
  const lblY = (ctx.by(a.anchorPt.lat) - 5).toFixed(1);
  addMapLabel(ctx, parent, lblX, lblY,
    `${a.name || '?'} (${(a.type || '?').toUpperCase()} ${a.direction === 'ccw' ? 'CCW' : 'CW'})`, col);
}

// ── Engagement zones (drawn first, behind routes and markers) ──
// Returns { group: SVGElement, threatCol: string }
function drawEngagementZones(ctx, points) {
  const threatCol = ctx.movie ? '#ff4444' : '#c0392b';
  const fillColor = ctx.movie ? 'rgba(255,68,68,0.08)' : 'rgba(192,57,43,0.07)';
  const engZoneG  = svgEl('g');
  points.filter(p => p.kind === 'threat' && p.engagementRange).forEach(p => {
    engZoneG.appendChild(makeSvgEl('circle', {
      cx: ctx.bx(p.lon).toFixed(1),
      cy: ctx.by(p.lat).toFixed(1),
      r:  ctx.nmToSvg(p.engagementRange).toFixed(1),
      fill: fillColor, stroke: threatCol,
      'stroke-width': 1.5, 'stroke-dasharray': '6,3',
      'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none',
    }));
  });
  return { group: engZoneG, threatCol };
}

// ── ACO airspace measures (orbits, ROZ, restricted zones, etc.) ──
// Returns { group: SVGElement, colors: object, defaultCol: string }
function drawAirspaces(ctx, airspaces, showPopup) {
  const airspaceColors = {
    ROZ:    ctx.movie ? '#ffb347' : '#c07c2b',
    ORBIT:  ctx.movie ? '#4fc3f7' : '#1a3a6b',
    MEZ:    ctx.movie ? '#c084fc' : '#4a1a6b',
    NFZ:    ctx.movie ? '#ff4444' : '#9b1c1c',
    TRA:    ctx.movie ? '#ffb020' : '#7c5000',
    ANCHOR: ctx.movie ? '#00e5ff' : '#006680',
  };
  const defaultAirspaceCol = ctx.movie ? '#6aaa7a' : '#5a6a60';
  const airspaceG = svgEl('g');

  airspaces.forEach(a => {
    const col = airspaceColors[(a.type || '').toUpperCase()] || defaultAirspaceCol;
    if (a.shape === 'circle')                    drawCircleAirspace (ctx, a, col, airspaceG, showPopup);
    else if (a.shape === 'polygon' && a.boundary) drawPolygonAirspace(ctx, a, col, airspaceG, showPopup);
    else if (a.shape === 'anchor'  && a.anchorPt) drawAnchorAirspace (ctx, a, col, airspaceG, showPopup);
  });

  return { group: airspaceG, colors: airspaceColors, defaultCol: defaultAirspaceCol };
}

// ── Racetrack generator ──────────────────────────────────
// Returns an array of {lat,lon} points forming a closed racetrack
// (two parallel legs connected by semicircular turns).
function generateRacetrack(anchorLat, anchorLon, headingDeg, legLengthNm, turnRadiusNm, isCCW) {
  const headRad = headingDeg * Math.PI / 180;
  const cosLat  = Math.cos(anchorLat * Math.PI / 180);
  const nmToLat = 1 / 60;
  const nmToLon = 1 / (60 * cosLat);

  function localToGeo(x, y) {
    return {
      lat: anchorLat + (x * Math.cos(headRad) - y * Math.sin(headRad)) * nmToLat,
      lon: anchorLon + (x * Math.sin(headRad) + y * Math.cos(headRad)) * nmToLon,
    };
  }

  const L = legLengthNm, R = turnRadiusNm;
  const s = isCCW ? -1 : 1; // CW → right (+y), CCW → left (-y)
  const N = 16; // arc segments per semicircle
  const pts = [];

  // Hot leg: anchor (0,0) → (L,0)
  pts.push(localToGeo(0, 0));
  pts.push(localToGeo(L, 0));

  // Turn 1: semicircle at end of hot leg, center at (L, R*s)
  for (let i = 1; i <= N; i++) {
    const a = -s * Math.PI / 2 + Math.PI * i / N;
    pts.push(localToGeo(L + R * Math.cos(a), s * R + R * Math.sin(a)));
  }

  // Return leg: (L, 2R*s) → (0, 2R*s)
  pts.push(localToGeo(0, 2 * R * s));

  // Turn 2: semicircle at start of hot leg, center at (0, R*s)
  for (let i = 1; i <= N; i++) {
    const a = s * (Math.PI / 2 + Math.PI * i / N);
    pts.push(localToGeo(R * Math.cos(a), s * R + R * Math.sin(a)));
  }

  return pts;
}
