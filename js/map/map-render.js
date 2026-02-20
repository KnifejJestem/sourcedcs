// ═══════════════════════════════════════════════════════════
// map-render.js — SVG map drawing orchestrator (drawMap + mapLabel)
// ═══════════════════════════════════════════════════════════

'use strict';

// Refresh the currently open map popup after a display-mode change
// (coord format or time mode).  Set by drawMap; called from app.js.
let _refreshPopup = null;
function mapRefreshPopup() { if (_refreshPopup) _refreshPopup(); }

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

// ── Map layout constants ───────────────────────────────────────
const MAP_WIDTH  = 1400; // SVG viewBox width  (px)
const MAP_HEIGHT = 780;  // SVG viewBox height (px)

// ── Zoom limits ────────────────────────────────────────────────
const MIN_ZOOM = 1.0; // can't zoom out past the initial full-canvas fit
const MAX_ZOOM = 20;  // maximum magnification

// ── Bounding-box padding ───────────────────────────────────────
// Extra breathing room added around the data bbox so features aren't clipped.
const BBOX_PADDING_RATIO = 0.28; // fraction of the data span added on each side
const BBOX_MIN_SPAN      = 1.5;  // minimum bbox span in degrees (avoids degenerate bboxes)

// ── Pan clamp margin ───────────────────────────────────────────
// How far the content edge may move beyond the canvas boundary before clamping.
const PAN_MARGIN_RATIO = 0.1; // fraction of MAP_WIDTH

// ── Marker scale damping ───────────────────────────────────────
// Markers scale by 1/zoom^DAMPING — they shrink as you zoom in, but slowly.
const MARKER_SCALE_DAMPING = 0.8;

// Returns the coordinate grid step (degrees) appropriate for the given longitude span.
function gridStep(spanDeg) {
  if (spanDeg > 30) return 10;
  if (spanDeg > 15) return 5;
  if (spanDeg > 6)  return 2;
  return 1;
}

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

  const W = MAP_WIDTH;
  const H = MAP_HEIGHT;

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
      const degOffset = (a.radiusNm || DEFAULT_RADIUS_NM) / 60;
      expand({ lon: a.lon - degOffset, lat: a.lat - degOffset });
      expand({ lon: a.lon + degOffset, lat: a.lat + degOffset });
    } else if (a.shape === 'polygon' && a.boundary) {
      a.boundary.forEach(expand);
    } else if (a.shape === 'anchor' && a.anchorPt) {
      const legNm  = a.legLengthNm || DEFAULT_LEG_NM;
      const reach  = (legNm + legNm / 2) / 60;
      expand({ lon: a.anchorPt.lon - reach, lat: a.anchorPt.lat - reach });
      expand({ lon: a.anchorPt.lon + reach, lat: a.anchorPt.lat + reach });
    }
  });

  const lSpan = Math.max(maxLon - minLon, BBOX_MIN_SPAN);
  const aSpan = Math.max(maxLat - minLat, BBOX_MIN_SPAN);
  const lMarg = Math.max(lSpan * BBOX_PADDING_RATIO, BBOX_MIN_SPAN);
  const aMarg = Math.max(aSpan * BBOX_PADDING_RATIO, BBOX_MIN_SPAN);
  const vMinLon = minLon - lMarg, vMaxLon = maxLon + lMarg;
  const vMinLat = minLat - aMarg, vMaxLat = maxLat + aMarg;
  const vLon = vMaxLon - vMinLon, vLat = vMaxLat - vMinLat;

  // Base projection (zoom=1, pan=0,0) — fills canvas exactly
  const bx     = lon => (lon    - vMinLon) / vLon * W;
  const by     = lat => (vMaxLat - lat)    / vLat * H;
  const nmToSvg = nm  => nm / 60 / vLat * H;
  const step   = gridStep(vLon);

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
  const svg = makeSvgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: '100%' });
  svg.style.cssText = 'display:block;cursor:grab;touch-action:none;';

  // Clip path — hard edge so nothing drawn outside the canvas bounds is visible
  const clip = makeSvgEl('clipPath', { id: 'mvc' });
  clip.appendChild(makeSvgEl('rect', { x: 0, y: 0, width: W, height: H }));
  const defs = svgEl('defs');
  defs.appendChild(clip);
  svg.appendChild(defs);

  // Static sea background fills the entire canvas
  svg.appendChild(makeSvgEl('rect', { x: 0, y: 0, width: W, height: H, fill: C.sea }));

  // Clip wrapper — contains all map content
  const clipWrap = makeSvgEl('g', { 'clip-path': 'url(#mvc)' });
  svg.appendChild(clipWrap);

  // Inner content group — receives the pan/zoom transform
  const content = makeSvgEl('g', { id: 'map-content' });
  clipWrap.appendChild(content);

  // ── Draw layers ──────────────────────────────────────────
  content.appendChild(drawGrid(ctx));
  content.appendChild(drawLand(ctx, geoData));
  content.appendChild(drawCities(ctx, geoData));

  // ── Popup (needed by subsequent draw calls) ──────────────
  const { showPopup, refreshPopup } = createPopup(container);
  _refreshPopup = refreshPopup;

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

  function applyTransform() {
    content.setAttribute('transform',
      `translate(${state.tx.toFixed(2)},${state.ty.toFixed(2)}) scale(${state.sc.toFixed(5)})`);
    // Damped inverse scaling keeps markers readable as you zoom in
    const invSc = 1 / Math.pow(state.sc, MARKER_SCALE_DAMPING);
    constantSizeMarkers.forEach(m => {
      m.setAttribute('transform', `translate(${m._baseX},${m._baseY}) scale(${invSc.toFixed(5)})`);
    });
    gridLabels.redraw(state.tx, state.ty, state.sc);
  }

  function clamp() {
    // At sc=1 content fills exactly W×H. When zoomed in, allow panning but
    // prevent the far edge from moving more than PAN_MARGIN_RATIO inward.
    const margin = MAP_WIDTH * PAN_MARGIN_RATIO;
    state.tx = Math.min(state.tx,  margin);
    state.tx = Math.max(state.tx, -(MAP_WIDTH  * state.sc - MAP_WIDTH  + margin));
    state.ty = Math.min(state.ty,  margin);
    state.ty = Math.max(state.ty, -(MAP_HEIGHT * state.sc - MAP_HEIGHT + margin));
  }

  sidebar._resetBtn.addEventListener('click', () => {
    state.tx = 0; state.ty = 0; state.sc = 1;
    clamp();
    applyTransform();
  });

  setupInteraction(svg, MAP_WIDTH, MAP_HEIGHT, MIN_ZOOM, MAX_ZOOM, state, applyTransform, clamp);

  // Initial render
  applyTransform();
}

// ── Label helper ──────────────────────────────────────────
// Appends two optional text lines to a marker group.
// line1 is bold; line2 is secondary (faded, smaller).
function mapLabel(parent, line1, line2, color, offsetX) {
  [[line1, color, true, -11], [line2 || '', color + '80', false, 1]].forEach(([txt, col, bold, dy]) => {
    if (!txt) return;
    parent.appendChild(svgText(txt, {
      x: offsetX, y: dy,
      'font-size':   bold ? 9 : 7.5,
      'font-family': MONO_FONT,
      'font-weight': bold ? 700 : 400,
      fill: col,
    }));
  });
}
