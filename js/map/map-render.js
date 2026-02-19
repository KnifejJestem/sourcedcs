// ═══════════════════════════════════════════════════════════
// map-render.js — SVG map drawing orchestrator (drawMap + mapLabel)
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Main draw ──────────────────────────────────────────────
// Architecture:
//   SVG
//     <rect> sea bg (static)
//     <g id="clip-wrapper" clip-path="url(#map-clip)">   ← clips to canvas
//       <g id="content" transform="translate/scale">      ← pans & zooms
//         grid, land, cities, per-mission route groups, markers
//     <g id="overlay">  ← grid labels at fixed positions (redrawn on pan)
//
// Per-mission <g data-msn> groups allow opacity toggling for route filter.
//
// Drawing helpers live in:
//   map-draw-layers.js  — drawGrid, drawLand, drawCities
//   map-draw-zones.js   — drawEngagementZones, drawAirspaces, generateRacetrack
//   map-draw-routes.js  — drawRoutes
//   map-draw-markers.js — drawSharedMarkers, drawThreatMarkers
//   map-ui.js           — fmtCoord, createPopup, createGridLabelOverlay, createSidebar

function drawMap(container, points, routes, geoData, airspaces) {
  airspaces = airspaces || [];
  const movie = STATE.theme === 'movie';
  const C = movie ? {
    sea:'#06111e', land:'#131f11', border:'#2a5438',
    grid:'rgba(57,255,122,0.06)', gridLbl:'rgba(57,255,122,0.35)',
    cityDot:'#b0e8c0', cityLbl:'#6a9878', cityMajor:'#d0f0e0',
    af:'#70c8ff', cv:'#ffd080', dim: 0.06,
  } : {
    sea:'#7aaec8', land:'#e8e0d0', border:'#8a7060',
    grid:'rgba(0,0,0,0.07)', gridLbl:'rgba(0,0,0,0.38)',
    cityDot:'#2a1a0a', cityLbl:'#5a4030', cityMajor:'#1a0800',
    af:'#1858c8', cv:'#8b4500', dim: 0.06,
  };

  const W = 1400, H = 780;

  // Markers that should stay constant size when zooming
  const constantSizeMarkers = [];

  // ── Bounding box of all data ──────────────────────────────
  let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity;
  const expand = p => {
    minLon=Math.min(minLon,p.lon); maxLon=Math.max(maxLon,p.lon);
    minLat=Math.min(minLat,p.lat); maxLat=Math.max(maxLat,p.lat);
  };
  points.forEach(expand);
  routes.forEach(r => r.pts.forEach(expand));
  airspaces.forEach(a => {
    if (a.shape === 'circle') {
      const degOffset = (a.radiusNm || 5) / 60;
      expand({ lon: a.lon - degOffset, lat: a.lat - degOffset });
      expand({ lon: a.lon + degOffset, lat: a.lat + degOffset });
    } else if (a.shape === 'polygon' && a.boundary) {
      a.boundary.forEach(expand);
    } else if (a.shape === 'anchor' && a.anchorPt) {
      const reach = ((a.legLengthNm || 10) + (a.legLengthNm || 10) / 2) / 60;
      expand({ lon: a.anchorPt.lon - reach, lat: a.anchorPt.lat - reach });
      expand({ lon: a.anchorPt.lon + reach, lat: a.anchorPt.lat + reach });
    }
  });

  const lSpan = Math.max(maxLon-minLon,1.5), aSpan = Math.max(maxLat-minLat,1.5);
  const lMarg = Math.max(lSpan*0.28,1.5),    aMarg = Math.max(aSpan*0.28,1.5);
  const vMinLon=minLon-lMarg, vMaxLon=maxLon+lMarg;
  const vMinLat=minLat-aMarg, vMaxLat=maxLat+aMarg;
  const vLon=vMaxLon-vMinLon, vLat=vMaxLat-vMinLat;

  // Base projection (zoom=1, pan=0,0) — fills canvas exactly
  const bx = lon => (lon-vMinLon)/vLon * W;
  const by = lat => (vMaxLat-lat)/vLat * H;
  const nmToSvg = nm => nm / 60 / vLat * H;
  const step = vLon>30?10:vLon>15?5:vLon>6?2:1;

  // ── Context object shared by all drawing helpers ──────────
  const ctx = {
    bx, by, nmToSvg,
    C, movie,
    W, H,
    step,
    vMinLon, vMaxLon, vMinLat, vMaxLat, vLon, vLat,
    constantSizeMarkers,
  };

  // ── SVG skeleton ──────────────────────────────────────────
  const svg = svgEl('svg');
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.setAttribute('width','100%'); svg.setAttribute('height','100%');
  svg.style.cssText = 'display:block;cursor:grab;touch-action:none;';

  const defs = svgEl('defs');
  const clip = svgEl('clipPath'); clip.setAttribute('id','mvc');
  const cr   = svgEl('rect');
  cr.setAttribute('x',0); cr.setAttribute('y',0);
  cr.setAttribute('width',W); cr.setAttribute('height',H);
  clip.appendChild(cr); defs.appendChild(clip);
  svg.appendChild(defs);

  // Static sea background
  const bg = svgEl('rect');
  bg.setAttribute('x',0);bg.setAttribute('y',0);
  bg.setAttribute('width',W);bg.setAttribute('height',H);
  bg.setAttribute('fill',C.sea); svg.appendChild(bg);

  // Clip wrapper — hard edge, nothing escapes
  const clipWrap = svgEl('g'); clipWrap.setAttribute('clip-path','url(#mvc)');
  svg.appendChild(clipWrap);

  // Inner content group — receives the pan/zoom transform
  const content = svgEl('g'); content.setAttribute('id','map-content');
  clipWrap.appendChild(content);

  // ── Draw layers ──────────────────────────────────────────
  content.appendChild(drawGrid(ctx));
  content.appendChild(drawLand(ctx, geoData));
  content.appendChild(drawCities(ctx, geoData));

  // ── Popup (needed by subsequent draw calls) ──────────────
  const { showPopup } = createPopup(container);

  // ── Zones ────────────────────────────────────────────────
  const engResult = drawEngagementZones(ctx, points);
  const engZoneG = engResult.group;
  const threatCol = engResult.threatCol;
  content.appendChild(engZoneG);

  const airResult = drawAirspaces(ctx, airspaces, showPopup);
  const airspaceG = airResult.group;
  content.appendChild(airspaceG);

  // ── Routes ───────────────────────────────────────────────
  const msnGroups = drawRoutes(ctx, routes, points, showPopup);
  Object.values(msnGroups).forEach(g => content.appendChild(g));

  // ── Markers ──────────────────────────────────────────────
  content.appendChild(drawSharedMarkers(ctx, points, showPopup));
  const threatG = drawThreatMarkers(ctx, points, threatCol, showPopup);
  content.appendChild(threatG);

  // ── Grid label overlay ───────────────────────────────────
  const gridLabels = createGridLabelOverlay(ctx);
  svg.appendChild(gridLabels.overlay);

  container.appendChild(svg);

  // Close popup when clicking the map background
  svg.addEventListener('click', () => {
    const popup = container.querySelector('.map-popup');
    if (popup) popup.style.display = 'none';
  });

  // ── Sidebar ──────────────────────────────────────────────
  const sidebar = createSidebar({
    routes, msnGroups, points, airspaces,
    engZoneG, airspaceG, threatG,
    C, threatCol,
    airspaceColors: airResult.colors,
    defaultAirspaceCol: airResult.defaultCol,
  });
  container.appendChild(sidebar);

  // ── Pan / Zoom ───────────────────────────────────────────
  const state = { tx: 0, ty: 0, sc: 1 };
  const MIN_SC = 1.0, MAX_SC = 20;  // 1.0 = can't zoom out past initial fit

  function applyTransform() {
    content.setAttribute('transform',`translate(${state.tx.toFixed(2)},${state.ty.toFixed(2)}) scale(${state.sc.toFixed(5)})`);
    // Apply damped inverse scaling to markers — they shrink with zoom but not as fast
    const invSc = 1 / Math.pow(state.sc, 0.8);
    constantSizeMarkers.forEach(m => {
      m.setAttribute('transform', `translate(${m._baseX},${m._baseY}) scale(${invSc.toFixed(5)})`);
    });
    gridLabels.redraw(state.tx, state.ty, state.sc);
  }

  function clamp() {
    // Content at sc=1 fills exactly W×H. When zoomed in, allow panning
    // but never let the far edge come inward past a 10% margin.
    const margin = W * 0.1;
    state.tx = Math.min(state.tx,  margin);            // left edge can go at most margin right of 0
    state.tx = Math.max(state.tx, -(W*state.sc - W + margin)); // right edge stays in
    state.ty = Math.min(state.ty,  margin);
    state.ty = Math.max(state.ty, -(H*state.sc - H + margin));
  }

  sidebar._resetBtn.addEventListener('click', () => { state.tx=0; state.ty=0; state.sc=1; clamp(); applyTransform(); });

  setupInteraction(svg, W, H, MIN_SC, MAX_SC, state, applyTransform, clamp);

  // Initial render
  applyTransform();
}

// ── Label helper ──────────────────────────────────────────
function mapLabel(parent, line1, line2, color, offsetX) {
  [[line1,color,true,-11],[line2||'',color+'80',false,1]].forEach(([txt,col,bold,dy])=>{
    if(!txt)return;
    const t=svgEl('text');
    t.setAttribute('x',offsetX); t.setAttribute('y',dy);
    t.setAttribute('font-size',bold?'9':'7.5');
    t.setAttribute('font-family','IBM Plex Mono,monospace');
    t.setAttribute('font-weight',bold?'700':'400');
    t.setAttribute('fill',col);
    t.textContent=txt;
    parent.appendChild(t);
  });
}
