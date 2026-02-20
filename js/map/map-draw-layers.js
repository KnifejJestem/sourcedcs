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
