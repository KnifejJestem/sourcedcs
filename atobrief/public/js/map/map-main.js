// ═══════════════════════════════════════════════════════════
// map-main.js — MAP tab entry point + shared SVG helpers
//
// The helpers defined here are used throughout map-draw-*.js.
// They load last but are only called inside drawMap() which
// runs after all scripts are ready, so timing is not an issue.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Shared style constants ─────────────────────────────────
// Single definition; imported implicitly by every map-draw-*.js file.
const MONO_FONT = 'IBM Plex Mono,monospace';

// ── SVG element helpers ────────────────────────────────────

// Create an SVG element in the SVG namespace.
function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

// Set multiple SVG attributes at once.  Returns the element for chaining.
function svgSet(el, attrs) {
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}

// Create an SVG element and set its attributes in one call.
function makeSvgEl(tag, attrs) { return svgSet(svgEl(tag), attrs); }

// Create an SVG <text> element, set attributes, and set text content.
function svgText(text, attrs) {
  const t = makeSvgEl('text', attrs);
  t.textContent = text;
  return t;
}

async function renderMAP(ato) {
  const container = document.getElementById('map-container');
  container.innerHTML = '';
  container.appendChild(el('div', 'map-no-coords', 'Loading map data…'));

  const geoData = await loadGeoData();

  const aco = STATE.pkg?.aco || null;
  const { points, routes, airspaces } = collectData(ato, aco);

  if (points.length === 0 && airspaces.length === 0) {
    container.innerHTML = '';
    container.appendChild(html`
      <div class="map-no-coords">
        No coordinate data found in ATO.<br>
        Add <code>aim_points</code>, <code>steer_points</code>, or <code>airfields</code> to your YAML.
      </div>`);
    return;
  }

  // ── Tile preload ──────────────────────────────────────────
  // For tile modes (non-chart), warm the browser cache for the initial
  // viewport tiles before rendering.  We show a loading overlay while
  // preloading; on subsequent renders the tiles are already cached so
  // preloadTiles() resolves almost instantly.
  const mapMode = STATE.mapUI?.mapMode || 'chart';
  if (mapMode !== 'chart') {
    // Build the same ctx geometry that drawMap() will use, so we can
    // compute the right tile list before the SVG is created.
    const tileCtx = _buildTileCtx(points, routes, airspaces);
    if (tileCtx) {
      container.innerHTML = '';

      // Show loading overlay
      const overlay = el('div', 'map-preload-overlay');
      overlay.innerHTML = `
        <div class="map-preload-spinner"></div>
        <div class="map-preload-label">LOADING MAP TILES…</div>
        <div class="map-preload-bar-wrap"><div class="map-preload-bar" id="map-preload-bar"></div></div>`;
      container.appendChild(overlay);

      // Real progress bar: updates as tiles actually load (all zoom levels).
      const bar = overlay.querySelector('#map-preload-bar');
      await preloadTiles(tileCtx, mapMode, (loaded, total) => {
        if (bar && total > 0) bar.style.width = Math.round(loaded / total * 100) + '%';
      });
      if (bar) bar.style.width = '100%';

      // Fade the overlay out while the map renders underneath.
      // The overlay is pointer-events:none so it doesn't block interaction.
      overlay.classList.add('map-preload-fadeout');
      overlay.addEventListener('animationend', () => overlay.remove(), { once: true });

      // Draw the map into the container now (overlay is still visible but fading).
      // Do NOT clear innerHTML — the overlay is still animating.
      drawMap(container, points, routes, geoData, airspaces);
      return; // skip the default drawMap call below
    }
  }

  container.innerHTML = '';
  drawMap(container, points, routes, geoData, airspaces);
}

// ── Tile ctx geometry builder ─────────────────────────────
// Replicates the bounding-box / projection arithmetic from drawMap() so
// preloadTiles() can compute the correct tile range before the SVG exists.
// NOTE: W and H must match MAP_WIDTH / MAP_HEIGHT in map-render.js.
function _buildTileCtx(points, routes, airspaces) {
  const W = 1400, H = 780; // must match MAP_WIDTH / MAP_HEIGHT in map-render.js
  const BBOX_PADDING_RATIO = 0.28;
  const BBOX_MIN_SPAN      = 1.5;

  let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity;
  const expand = p => {
    minLon=Math.min(minLon,p.lon); maxLon=Math.max(maxLon,p.lon);
    minLat=Math.min(minLat,p.lat); maxLat=Math.max(maxLat,p.lat);
  };
  points.forEach(expand);
  routes.forEach(r => r.pts.forEach(expand));
  airspaces.forEach(a => {
    if (a.shape === 'circle') {
      const d = (a.radiusNm || 20) / 60;
      expand({ lon: a.lon - d, lat: a.lat - d });
      expand({ lon: a.lon + d, lat: a.lat + d });
    } else if (a.shape === 'polygon' && a.boundary) {
      a.boundary.forEach(expand);
    } else if (a.shape === 'anchor' && a.anchorPt) {
      const r = ((a.legLengthNm || 20) * 1.5) / 60;
      expand({ lon: a.anchorPt.lon - r, lat: a.anchorPt.lat - r });
      expand({ lon: a.anchorPt.lon + r, lat: a.anchorPt.lat + r });
    }
  });
  if (!isFinite(minLon)) return null;

  const lSpan = Math.max(maxLon - minLon, BBOX_MIN_SPAN);
  const aSpan = Math.max(maxLat - minLat, BBOX_MIN_SPAN);
  const lMarg = Math.max(lSpan * BBOX_PADDING_RATIO, BBOX_MIN_SPAN);
  const aMarg = Math.max(aSpan * BBOX_PADDING_RATIO, BBOX_MIN_SPAN);
  let vMinLon = minLon - lMarg, vMaxLon = maxLon + lMarg;
  let vMinLat = minLat - aMarg, vMaxLat = maxLat + aMarg;
  let vLon    = vMaxLon - vMinLon, vLat = vMaxLat - vMinLat;

  if (vLon / vLat < W / H) {
    const extra = (vLat * (W / H) - vLon) / 2;
    vMinLon -= extra; vMaxLon += extra; vLon = vMaxLon - vMinLon;
  } else {
    const extra = (vLon / (W / H) - vLat) / 2;
    vMinLat -= extra; vMaxLat += extra; vLat = vMaxLat - vMinLat;
  }

  // bx/by: project lon/lat → SVG pixel coordinates (equirectangular).
  return { vMinLon, vMaxLon, vMinLat, vMaxLat, vLon, vLat, W, H,
           bx: lon => (lon - vMinLon) / vLon * W,
           by: lat => (vMaxLat - lat) / vLat * H };
}
