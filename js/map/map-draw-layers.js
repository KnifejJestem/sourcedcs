// ═══════════════════════════════════════════════════════════
// map-draw-layers.js — Grid, land, and city drawing
// ═══════════════════════════════════════════════════════════

'use strict';

// ── City marker constants ─────────────────────────────────────
// Dot radius keyed by population tier (1 = small, 3 = major city).
const CITY_DOT_RADIUS    = { 3: 2.8, 2: 2.0, 1: 1.4 };
const CITY_DOT_OPACITY   = 0.6;
const CITY_LABEL_OPACITY = 0.7;
const CITY_FONT_MAJOR    = 7;  // px — population tier 3
const CITY_FONT_MINOR    = 6;  // px — population tier 1 and 2

// ── Tile background (TACTICAL / ELEVATION / SATELLITE modes) ──

// Tile provider URLs — all are free / open-access, no API key required.
const TILE_URLS = {
  tactical:  (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  elevation: (z, x, y) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
  satellite: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
};

// Attribution text displayed in the bottom-right corner of the map.
const TILE_ATTRIBUTION = {
  tactical:  '© OpenStreetMap contributors',
  elevation: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
  satellite: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
};

// Maximum tile zoom per provider (provider hard limits / practical detail caps).
const TILE_MAX_ZOOM = {
  tactical:  15, // OpenStreetMap goes up to z19; z15 already very detailed
  elevation: 12, // OpenTopoMap caps at z17; z12 is the sweet spot for topo
  satellite: 15, // ESRI World Imagery goes up to z23; z15 crisp satellite detail
};

// Convert geographic latitude to the web-mercator tile-Y index.
function _latToTileY(lat, z) {
  const latR = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  return Math.floor(
    (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * Math.pow(2, z)
  );
}

// Convert a tile-Y index back to geographic latitude (north edge of tile).
function _tileYToLat(ty, z) {
  const n = Math.PI - 2 * Math.PI * ty / Math.pow(2, z);
  return Math.atan(Math.sinh(n)) * 180 / Math.PI;
}

// Pick a tile zoom level for the given longitude span (degrees).
// maxZ caps the result so we don't exceed provider limits.
function _tileZoom(vLon, maxZ) {
  return Math.max(3, Math.min(maxZ ?? 15, Math.round(Math.log2(7.5 * 360 / vLon))));
}

// Returns a <g> containing SVG <image> elements for the tile background.
// effectiveVLon is the currently-visible longitude span (ctx.vLon / state.sc).
// Passing a smaller effectiveVLon selects a higher zoom level for more detail.
// tileBounds (optional) restricts which tiles are generated to the given
// geographic area — use this when zoomed in to avoid giant tile counts.
function drawTileBackground(ctx, mode, effectiveVLon, tileBounds) {
  const tileG = svgEl('g');
  const urlFn = TILE_URLS[mode];
  if (!urlFn) return tileG;

  const z   = _tileZoom(effectiveVLon ?? ctx.vLon, TILE_MAX_ZOOM[mode]);
  const pow = Math.pow(2, z);

  // Use provided bounds or fall back to the full base viewport.
  const bMinLon = tileBounds ? tileBounds.minLon : ctx.vMinLon;
  const bMaxLon = tileBounds ? tileBounds.maxLon : ctx.vMaxLon;
  const bMinLat = tileBounds ? tileBounds.minLat : ctx.vMinLat;
  const bMaxLat = tileBounds ? tileBounds.maxLat : ctx.vMaxLat;

  // Tile x range covering the viewport longitude span.
  // (+180 shifts from [-180,180] lon space to [0,360] for tile indexing.)
  const txMin = Math.max(0,       Math.floor((bMinLon + 180) / 360 * pow) - 1);
  const txMax = Math.min(pow - 1, Math.ceil( (bMaxLon + 180) / 360 * pow));

  // Tile y range — y increases southward in tile coords.
  const tyMin = Math.max(0,       _latToTileY(bMaxLat, z) - 1);
  const tyMax = Math.min(pow - 1, _latToTileY(bMinLat, z) + 1);

  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      // Tile geographic bounds.
      // Lon: tile x index maps linearly to [-180, 180] longitude range.
      const lon0 = tx       / pow * 360 - 180; // west edge
      const lon1 = (tx + 1) / pow * 360 - 180; // east edge
      const lat0 = _tileYToLat(ty,     z);      // north edge
      const lat1 = _tileYToLat(ty + 1, z);      // south edge

      // Map tile corners to SVG equirectangular coordinates.
      // Tiles use web-mercator so there is a small vertical distortion
      // (~5-15 % at mid-latitudes) — acceptable for a background layer.
      const svgX = ctx.bx(lon0);
      const svgY = ctx.by(lat0);
      const svgW = Math.max(0, ctx.bx(lon1) - svgX);
      const svgH = Math.max(0, ctx.by(lat1) - svgY);

      tileG.appendChild(makeSvgEl('image', {
        href:                urlFn(z, tx, ty),
        x:                   svgX.toFixed(1),
        y:                   svgY.toFixed(1),
        width:               svgW.toFixed(1),
        height:              svgH.toFixed(1),
        preserveAspectRatio: 'none',
      }));
    }
  }

  return tileG;
}

// ── Tile image cache + Canvas 2D renderer ────────────────
//
// Production mapping libraries (Leaflet, Mapbox GL) draw tiles onto a
// single <canvas> element and pan/zoom it via CSS transform — this keeps
// the compositor layer count at ONE regardless of how many tiles are
// loaded, eliminating the per-<image> composite cost that makes SVG tile
// layers slow.
//
// _tileImageCache stores live HTMLImageElement objects.  Tiles that were
// preloaded are already `img.complete` here, so drawTilesOnCanvas() can
// call drawImage() synchronously — no deferred promise needed.

// Persistent store of loaded HTMLImageElement objects.
// Key: the tile URL string.  Value: HTMLImageElement.
const _tileImageCache = new Map();

// Monotonically incrementing token — used to cancel stale onload callbacks
// when the canvas zoom level changes mid-render.
let _canvasDrawVersion = 0;

// Draw all tiles for a given effective viewport longitude span onto canvas2d.
// seaColor is drawn as background first so areas without a tile are not blank.
// Any tile whose Image isn't complete yet registers an onload handler that
// draws just that tile when it arrives (guarded by the draw-version token).
function drawTilesOnCanvas(canvas2d, ctx, mode, effectiveVLon, seaColor) {
  const urlFn = TILE_URLS[mode];
  if (!urlFn) return;

  const myVersion = ++_canvasDrawVersion;
  const z   = _tileZoom(effectiveVLon, TILE_MAX_ZOOM[mode]);
  const pow = Math.pow(2, z);

  const txMin = Math.max(0,       Math.floor((ctx.vMinLon + 180) / 360 * pow) - 1);
  const txMax = Math.min(pow - 1, Math.ceil( (ctx.vMaxLon + 180) / 360 * pow));
  const tyMin = Math.max(0,       _latToTileY(ctx.vMaxLat, z) - 1);
  const tyMax = Math.min(pow - 1, _latToTileY(ctx.vMinLat, z) + 1);

  // Background fill — visible only while tiles load (typically invisible after
  // preloading because all images are already complete).
  canvas2d.fillStyle = seaColor;
  canvas2d.fillRect(0, 0, ctx.W, ctx.H);

  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const url  = urlFn(z, tx, ty);
      let   img  = _tileImageCache.get(url);
      if (!img) {
        img = new Image();
        _tileImageCache.set(url, img);
        img.src = url;
      }

      // Tile SVG-unit position (same coordinate space as the canvas content)
      const lon0 = tx       / pow * 360 - 180;
      const lon1 = (tx + 1) / pow * 360 - 180;
      const lat0 = _tileYToLat(ty,     z);
      const lat1 = _tileYToLat(ty + 1, z);
      const x = ctx.bx(lon0);
      const y = ctx.by(lat0);
      const w = Math.max(0, ctx.bx(lon1) - x);
      const h = Math.max(0, ctx.by(lat1) - y);

      if (img.complete && img.naturalWidth > 0) {
        canvas2d.drawImage(img, x, y, w, h);
      } else {
        // Register onload so the tile paints as soon as it arrives.
        // The version check ensures stale callbacks from a previous zoom
        // level don't paint onto a canvas that has already been redrawn.
        const _x = x, _y = y, _w = w, _h = h;
        img.addEventListener('load', function handler() {
          img.removeEventListener('load', handler);
          if (_canvasDrawVersion === myVersion) canvas2d.drawImage(img, _x, _y, _w, _h);
        });
      }
    }
  }
}

// ── Tile preloader ────────────────────────────────────────
// Warms both the browser HTTP cache AND _tileImageCache for all zoom
// levels from z0 to TILE_MAX_ZOOM so that:
//   • The loading screen shows accurate progress (z0 tiles awaited).
//   • Any subsequent zoom is drawn from in-memory Image objects (instant).
//
// Coverage:
//   z0, z0+1, z0+2 — full base viewport (pan-safe at 1×–4× zoom)
//   z0+3 …         — centroid-scaled (~100 tiles each) for deeper zoom
//
// All zoom levels fire simultaneously — nothing waits for z0 to finish
// before starting the background levels.

// Tracks which (mode/z/tx/ty) combos are already in _tileImageCache so
// repeated renders don't create duplicate Image objects.
const _preloadedKeys = new Set();

function preloadTiles(ctx, mode, onProgress) {
  const urlFn = TILE_URLS[mode];
  if (!urlFn) return Promise.resolve();

  const maxZ   = TILE_MAX_ZOOM[mode];
  const z0     = _tileZoom(ctx.vLon, maxZ);
  const lonCtr = (ctx.vMinLon + ctx.vMaxLon) / 2;
  const latCtr = (ctx.vMinLat + ctx.vMaxLat) / 2;

  function tilesForZBounds(z, minLon, maxLon, minLat, maxLat) {
    const pow  = Math.pow(2, z);
    const txMn = Math.max(0,       Math.floor((minLon + 180) / 360 * pow) - 1);
    const txMx = Math.min(pow - 1, Math.ceil( (maxLon + 180) / 360 * pow));
    const tyMn = Math.max(0,       _latToTileY(maxLat, z) - 1);
    const tyMx = Math.min(pow - 1, _latToTileY(minLat, z) + 1);
    const urls = [];
    for (let tx = txMn; tx <= txMx; tx++) {
      for (let ty = tyMn; ty <= tyMx; ty++) {
        const key = `${mode}/${z}/${tx}/${ty}`;
        if (!_preloadedKeys.has(key)) {
          _preloadedKeys.add(key);
          urls.push(urlFn(z, tx, ty));
        }
      }
    }
    return urls;
  }

  const z0Urls = tilesForZBounds(z0, ctx.vMinLon, ctx.vMaxLon, ctx.vMinLat, ctx.vMaxLat);
  const bgUrls = [];
  for (let z = z0 + 1; z <= maxZ; z++) {
    const k = z - z0;
    if (k <= 2) {
      bgUrls.push(...tilesForZBounds(z, ctx.vMinLon, ctx.vMaxLon, ctx.vMinLat, ctx.vMaxLat));
    } else {
      const scale   = Math.pow(2, k);
      const halfLon = ctx.vLon / (2 * scale);
      const halfLat = ctx.vLat / (2 * scale);
      bgUrls.push(...tilesForZBounds(z,
        lonCtr - halfLon, lonCtr + halfLon, latCtr - halfLat, latCtr + halfLat));
    }
  }

  const z0Total  = z0Urls.length;
  let   z0Loaded = 0;

  // Load a URL: reuse an existing cache entry if available, otherwise create
  // a new Image, store it in _tileImageCache, and resolve when done.
  function loadOne(url, isZ0) {
    let img = _tileImageCache.get(url);
    if (!img) {
      img = new Image();
      _tileImageCache.set(url, img);
      img.src = url;
    }
    if (img.complete) {
      if (isZ0) { z0Loaded++; if (onProgress) onProgress(z0Loaded, z0Total); }
      return Promise.resolve();
    }
    return new Promise(resolve => {
      img.addEventListener('load',  function h() { img.removeEventListener('load',  h); img.removeEventListener('error', h); if (isZ0) { z0Loaded++; if (onProgress) onProgress(z0Loaded, z0Total); } resolve(); });
      img.addEventListener('error', function h() { img.removeEventListener('load',  h); img.removeEventListener('error', h); if (isZ0) { z0Loaded++; if (onProgress) onProgress(z0Loaded, z0Total); } resolve(); });
    });
  }

  // All levels start simultaneously.
  bgUrls.forEach(url => loadOne(url, false));
  const z0Promise = z0Total > 0
    ? Promise.all(z0Urls.map(url => loadOne(url, true)))
    : Promise.resolve();

  return z0Promise;
}

// ── Grid ─────────────────────────────────────────────────
// Returns the grid <g> element.
function drawGrid(ctx) {
  const gridG = svgEl('g');
  // Lines extend beyond canvas so they stay visible while panning.
  for (let lon = Math.floor(ctx.vMinLon / ctx.step) * ctx.step - ctx.step; lon <= ctx.vMaxLon + ctx.step; lon += ctx.step) {
    gridG.appendChild(makeSvgEl('line', {
      x1: ctx.bx(lon), y1: -ctx.H,
      x2: ctx.bx(lon), y2:  ctx.H * 2,
      stroke: ctx.C.grid, 'stroke-width': 0.5,
    }));
  }
  for (let lat = Math.floor(ctx.vMinLat / ctx.step) * ctx.step - ctx.step; lat <= ctx.vMaxLat + ctx.step; lat += ctx.step) {
    gridG.appendChild(makeSvgEl('line', {
      x1: -ctx.W,      y1: ctx.by(lat),
      x2:  ctx.W * 2,  y2: ctx.by(lat),
      stroke: ctx.C.grid, 'stroke-width': 0.5,
    }));
  }
  return gridG;
}

// ── Land ─────────────────────────────────────────────────
// Returns the land <g> element.
function drawLand(ctx, geoData) {
  const landG = svgEl('g');
  Object.values(geoData.countries).forEach(poly => {
    landG.appendChild(makeSvgEl('path', {
      d: poly.map((pt, i) =>
        `${i ? 'L' : 'M'}${ctx.bx(pt[0]).toFixed(1)},${ctx.by(pt[1]).toFixed(1)}`).join(' ') + ' Z',
      fill: ctx.C.land,
      stroke: ctx.C.border,
      'stroke-width': 0.8,
      'vector-effect': 'non-scaling-stroke',
    }));
  });
  return landG;
}

// ── Cities ───────────────────────────────────────────────
// Returns the cities <g> element.
function drawCities(ctx, geoData) {
  const cityG = svgEl('g');
  geoData.cities.forEach(city => {
    const major = city.pop === 3;
    const r     = CITY_DOT_RADIUS[city.pop] ?? CITY_DOT_RADIUS[1];
    const mx    = ctx.bx(city.lon).toFixed(1);
    const my    = ctx.by(city.lat).toFixed(1);
    const g     = makeSvgEl('g', { transform: `translate(${mx},${my})` });
    g._baseX = mx; g._baseY = my;

    g.appendChild(makeSvgEl('circle', {
      cx: 0, cy: 0, r,
      fill:    major ? ctx.C.cityMajor : ctx.C.cityDot,
      opacity: CITY_DOT_OPACITY,
    }));
    g.appendChild(svgText(city.n, {
      x: 3, y: -2,
      'font-size':   major ? CITY_FONT_MAJOR : CITY_FONT_MINOR,
      'font-family': MONO_FONT,
      'font-weight': major ? 600 : 400,
      fill:    major ? ctx.C.cityMajor : ctx.C.cityLbl,
      opacity: CITY_LABEL_OPACITY,
    }));

    ctx.constantSizeMarkers.push(g);
    cityG.appendChild(g);
  });
  return cityG;
}
