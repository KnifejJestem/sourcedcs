// ═══════════════════════════════════════════════════════════
// view-map.js  —  MAP tab
// Self-contained SVG tactical map. Pan (drag) + zoom (wheel/pinch).
// No external deps, no tile server.
// ═══════════════════════════════════════════════════════════

// ── Geo data: country outlines + city database ─────────────
const GEO_DATA = {"countries":{"Iran":[[44.0,39.5],[46.5,38.5],[48.0,38.4],[50.0,37.5],[53.0,37.0],[54.5,37.5],[55.5,37.2],[56.5,36.5],[58.0,35.5],[60.0,34.5],[61.0,33.0],[61.5,31.5],[60.5,30.0],[59.0,29.5],[57.5,29.0],[56.5,28.5],[56.5,27.5],[56.0,27.0],[55.0,26.5],[54.0,26.5],[53.0,26.5],[52.0,26.5],[51.0,26.5],[50.5,26.0],[49.5,26.5],[48.5,27.5],[48.0,28.5],[47.5,29.0],[47.0,30.0],[46.5,30.5],[46.5,31.5],[47.5,32.0],[47.8,33.5],[46.5,34.5],[45.5,35.5],[45.0,36.5],[44.0,37.5],[44.0,38.5],[44.0,39.5]],"Iraq":[[39.0,31.0],[40.0,31.5],[41.0,31.5],[42.0,31.0],[42.5,30.5],[43.5,29.5],[44.0,28.5],[45.0,29.0],[46.5,29.5],[47.0,30.0],[46.5,30.5],[46.5,31.5],[47.5,32.0],[47.8,33.5],[46.5,34.5],[45.5,35.5],[45.0,36.5],[44.0,37.5],[43.0,37.0],[42.0,37.0],[41.5,36.5],[41.0,36.0],[40.5,35.5],[40.0,35.0],[39.5,34.0],[39.0,33.5],[38.5,33.0],[39.0,32.0],[39.0,31.0]],"Syria":[[36.5,36.5],[37.0,36.5],[38.0,36.5],[38.5,36.0],[39.0,36.0],[40.0,36.0],[40.5,35.5],[40.5,34.5],[41.0,34.0],[41.5,34.0],[42.0,33.5],[42.5,33.0],[42.5,32.5],[38.5,33.0],[39.0,33.5],[39.5,34.0],[40.0,35.0],[40.5,35.5],[40.0,36.0],[39.0,36.0],[38.5,36.0],[38.0,36.5],[37.0,36.5],[36.5,36.5]],"Turkey":[[26.0,41.5],[27.5,41.0],[29.0,41.0],[31.0,41.5],[33.0,42.0],[35.5,42.0],[36.5,42.0],[38.0,37.0],[37.5,37.5],[36.5,36.5],[35.5,36.0],[36.0,35.5],[35.0,36.0],[34.5,36.5],[32.0,36.0],[32.0,36.0],[30.0,36.0],[29.0,36.5],[28.0,37.0],[27.0,37.5],[27.0,38.5],[26.5,39.5],[26.5,40.5],[26.0,41.5]],"Saudi Arabia":[[37.0,22.0],[38.5,18.5],[39.5,16.5],[43.0,12.5],[44.0,12.5],[48.0,14.5],[51.0,16.0],[53.5,18.0],[55.5,20.0],[57.0,22.0],[58.0,22.5],[59.0,23.5],[55.0,26.5],[51.0,26.5],[49.5,26.5],[49.0,25.0],[48.5,24.5],[48.0,24.0],[47.0,24.5],[45.0,24.5],[44.5,24.5],[43.5,24.5],[42.5,24.5],[42.0,24.5],[41.0,23.5],[40.0,23.0],[38.5,22.5],[37.5,22.0],[37.0,22.0]],"Yemen":[[44.0,12.5],[43.0,12.5],[42.5,12.0],[42.0,11.5],[41.5,11.0],[43.5,12.5],[45.0,11.5],[46.5,12.5],[47.5,12.0],[48.0,13.5],[49.0,14.5],[48.0,14.5],[44.0,12.5]],"Oman":[[55.0,26.5],[56.5,27.0],[57.0,26.5],[58.0,22.5],[57.0,22.0],[55.5,20.0],[54.5,19.5],[53.5,18.0],[52.0,17.5],[51.5,17.5],[51.0,17.0],[51.0,16.0],[53.5,18.0],[55.0,20.0],[55.0,22.0],[56.5,21.5],[58.5,23.0],[59.5,24.0],[59.0,23.5],[58.0,22.5],[57.5,22.0],[57.0,21.5],[56.5,21.0],[55.5,20.0],[55.0,26.5]],"UAE":[[51.0,26.5],[52.0,26.5],[55.0,26.5],[56.5,27.0],[57.0,26.5],[56.5,27.5],[56.0,27.8],[55.0,28.5],[55.0,29.0],[54.0,29.5],[51.0,26.5]],"Kuwait":[[46.5,29.5],[47.5,29.5],[48.5,29.5],[48.5,30.0],[47.5,30.0],[46.5,30.5],[46.5,29.5]],"Jordan":[[36.5,32.5],[37.5,32.5],[38.5,33.0],[39.0,33.5],[38.5,33.0],[37.5,32.5],[37.0,31.5],[36.5,31.0],[36.0,31.0],[35.5,31.5],[35.5,32.0],[36.0,32.5],[36.5,32.5]],"Israel/Palestine":[[35.0,33.0],[35.5,33.0],[36.0,32.5],[35.5,32.0],[35.5,31.5],[34.5,31.0],[34.5,31.5],[35.0,32.5],[35.0,33.0]],"Lebanon":[[35.0,33.0],[36.5,33.5],[36.5,34.5],[36.0,34.5],[35.5,33.5],[35.0,33.0]],"Egypt":[[25.0,22.0],[33.0,22.0],[34.0,22.5],[34.5,24.0],[35.5,27.0],[36.5,29.0],[37.0,30.5],[36.0,30.5],[35.0,30.0],[34.0,30.0],[33.5,31.0],[32.5,31.5],[32.0,31.0],[31.0,31.0],[30.0,31.0],[29.0,31.0],[28.5,31.0],[28.0,30.5],[27.0,30.0],[25.0,25.0],[25.0,22.0]],"Libya":[[9.5,29.5],[11.5,29.5],[12.5,30.0],[13.5,30.5],[15.0,30.0],[15.5,29.0],[16.0,28.5],[25.0,25.0],[25.0,22.0],[20.0,23.0],[14.0,22.0],[9.5,26.0],[9.5,29.5]],"Greece":[[20.0,38.0],[21.0,38.5],[22.0,38.5],[23.0,38.0],[24.0,38.5],[25.0,38.5],[26.5,41.5],[25.5,41.0],[24.0,41.0],[22.5,41.5],[21.0,41.0],[20.5,40.0],[20.0,39.5],[20.5,38.5],[20.0,38.0]],"Afghanistan":[[61.0,35.5],[62.5,35.5],[63.5,36.0],[64.5,36.5],[66.0,37.0],[67.5,37.5],[68.5,37.5],[69.5,37.5],[70.5,38.0],[71.5,38.5],[71.5,37.5],[71.0,36.5],[70.5,35.5],[69.5,34.5],[69.0,34.0],[68.5,33.5],[68.0,33.0],[67.5,32.5],[66.5,31.5],[65.5,30.0],[64.5,29.5],[63.5,29.5],[62.5,29.5],[61.5,29.5],[61.0,30.5],[61.0,31.5],[61.5,32.5],[61.0,33.5],[61.0,35.5]],"Pakistan":[[61.0,35.5],[62.5,35.5],[63.5,36.0],[64.5,36.5],[62.5,35.5],[61.5,32.5],[61.0,30.5],[61.5,29.5],[62.5,29.5],[64.5,29.5],[66.5,28.5],[68.5,27.5],[70.0,27.5],[70.5,28.5],[71.5,29.5],[72.5,30.5],[73.5,31.5],[74.0,32.5],[74.5,34.0],[74.5,36.0],[73.5,36.5],[72.5,37.0],[71.5,38.5],[71.5,38.5],[71.5,37.5],[71.0,36.5],[70.5,35.5],[69.5,34.5],[69.0,34.0],[68.0,33.0],[67.5,32.5],[66.5,31.5],[65.5,30.0],[64.5,29.5],[63.5,29.5],[61.5,29.5],[61.0,30.5],[61.0,35.5]]},"cities":[{"n":"Tehran","lat":35.7,"lon":51.4,"pop":3},{"n":"Baghdad","lat":33.3,"lon":44.4,"pop":3},{"n":"Damascus","lat":33.5,"lon":36.3,"pop":2},{"n":"Beirut","lat":33.9,"lon":35.5,"pop":2},{"n":"Amman","lat":31.9,"lon":35.9,"pop":2},{"n":"Jerusalem","lat":31.8,"lon":35.2,"pop":2},{"n":"Riyadh","lat":24.7,"lon":46.7,"pop":3},{"n":"Jeddah","lat":21.5,"lon":39.2,"pop":2},{"n":"Sanaa","lat":15.4,"lon":44.2,"pop":2},{"n":"Muscat","lat":23.6,"lon":58.6,"pop":2},{"n":"Dubai","lat":25.2,"lon":55.3,"pop":2},{"n":"Abu Dhabi","lat":24.5,"lon":54.4,"pop":2},{"n":"Doha","lat":25.3,"lon":51.5,"pop":2},{"n":"Kuwait City","lat":29.4,"lon":47.9,"pop":2},{"n":"Manama","lat":26.2,"lon":50.6,"pop":1},{"n":"Kabul","lat":34.5,"lon":69.2,"pop":2},{"n":"Islamabad","lat":33.7,"lon":73.1,"pop":2},{"n":"Karachi","lat":24.9,"lon":67.0,"pop":3},{"n":"Aden","lat":12.8,"lon":45.0,"pop":1},{"n":"Bandar Abbas","lat":27.2,"lon":56.3,"pop":2},{"n":"Khasab","lat":26.2,"lon":56.2,"pop":1},{"n":"Jask","lat":25.6,"lon":57.8,"pop":1},{"n":"Isfahan","lat":32.7,"lon":51.7,"pop":2},{"n":"Shiraz","lat":29.6,"lon":52.5,"pop":2},{"n":"Mosul","lat":36.3,"lon":43.1,"pop":2},{"n":"Basra","lat":30.5,"lon":47.8,"pop":2},{"n":"Aleppo","lat":36.2,"lon":37.2,"pop":2},{"n":"Ankara","lat":39.9,"lon":32.9,"pop":2},{"n":"Istanbul","lat":41.0,"lon":29.0,"pop":3},{"n":"Izmir","lat":38.4,"lon":27.1,"pop":2},{"n":"Cairo","lat":30.0,"lon":31.2,"pop":3},{"n":"Alexandria","lat":31.2,"lon":29.9,"pop":2},{"n":"Tripoli","lat":32.9,"lon":13.2,"pop":2},{"n":"Tunis","lat":36.8,"lon":10.2,"pop":2},{"n":"Athens","lat":37.9,"lon":23.7,"pop":2},{"n":"Nicosia","lat":35.2,"lon":33.4,"pop":1},{"n":"Naples","lat":40.8,"lon":14.3,"pop":2},{"n":"Rome","lat":41.9,"lon":12.5,"pop":2},{"n":"Incirlik AB","lat":37.0,"lon":35.4,"pop":1},{"n":"Djibouti","lat":11.6,"lon":43.1,"pop":1},{"n":"Al Dhafra","lat":24.2,"lon":54.5,"pop":1},{"n":"Al Udeid","lat":25.1,"lon":51.3,"pop":1},{"n":"Ali Al Salem","lat":29.5,"lon":47.5,"pop":1}]};

'use strict';

// ── Pan/zoom state ─────────────────────────────────────────
const MAP_VP = {
  // Base transform set by drawMap on first render, then user pans/zooms
  tx: 0, ty: 0, scale: 1,
  dragging: false, lastX: 0, lastY: 0,
  // Pinch
  lastDist: null,
  // SVG content group reference
  contentG: null,
  svgEl: null,
  // Reset function
  resetFn: null,
};

function renderMAP(ato) {
  const container = document.getElementById('map-container');
  container.innerHTML = '';

  const { points, routes } = collectData(ato);

  if (points.length === 0) {
    container.innerHTML = '<div class="map-no-coords">No coordinate data found in ATO.<br>Add <code>aim_points</code>, <code>steer_points</code>, or <code>airfields</code> to your YAML.</div>';
    return;
  }
  drawMap(container, points, routes);
}

// ── Collect all plottable data ─────────────────────────────
function collectData(ato) {
  const points = [];
  const routes = []; // [{msnKey, callsign, msnNumber, color, segments:[{from,to,style}]}]
  const missions = ato.missions || [];

  // Build a lookup: icao → {lat,lon} for airfields + carriers
  const locByIcao = {};
  (ato.airfields || []).forEach(af => {
    const p = parseCoord(af.coords);
    if (p && af.icao) locByIcao[af.icao.toUpperCase()] = p;
  });
  (ato.carriers || []).forEach(cv => {
    if (cv.deploy_coords && cv.callsign) {
      const p = parseCoord(cv.deploy_coords);
      if (p) locByIcao[cv.callsign.toUpperCase()] = p;
    }
  });

  // Bullseye
  const bs = ato.global_control?.bullseye;
  if (bs?.coords) {
    const p = parseCoord(bs.coords);
    if (p) points.push({ ...p, kind:'bullseye', label: bs.name || 'BULLSEYE', sub:'' });
  }

  // Per-mission data
  missions.forEach(m => {
    const color   = typeColor(m.mission_type);
    const callsign = m.callsign || '?';
    const msnNum   = m.mission_number || '';
    const msnKey   = msnNum || callsign;
    const route    = { msnKey, callsign, msnNum, color, pts: [] }; // ordered list of {lat,lon,kind}

    // Helper: resolve a location string — try as ICAO first, then coord parse
    const resolve = str => {
      if (!str) return null;
      const up = str.trim().toUpperCase();
      if (locByIcao[up]) return locByIcao[up];
      return parseCoord(str);
    };

    // 1. Deploy airfield / carrier
    const deployLoc = resolve(m.deploy_location_icao);
    if (deployLoc) route.pts.push({ ...deployLoc, kind:'route-node' });

    // 2. Steer points (en-route waypoints)
    (m.steer_points || []).forEach((sp, i) => {
      const raw = typeof sp === 'string' ? sp : sp.coords;
      const name = (typeof sp === 'object' && sp.name) ? sp.name : `SP${i+1}`;
      const p = parseCoord(raw);
      if (p) {
        route.pts.push({ ...p, kind:'route-node' });
        points.push({ ...p, kind:'steer',
          label: `${callsign}${msnNum ? ' · '+msnNum : ''}`,
          sub: name, color, msnType: m.mission_type, mission: m });
      }
    });

    // 3. Aim points (targets)
    (m.target?.aim_points || []).forEach((ap, i) => {
      const raw = typeof ap === 'string' ? ap : ap.coords;
      const name = (typeof ap === 'object' && ap.name) ? ap.name : `AIM ${i+1}`;
      const p = parseCoord(raw);
      if (p) {
        route.pts.push({ ...p, kind:'target-node' });
        points.push({ ...p, kind:'target',
          label: callsign, sub: name, color, msnType: m.mission_type, mission: m });
      }
    });

    // 4. Recovery airfield / carrier
    const recLoc = resolve(m.aar_location_icao) || resolve(m.deploy_location_icao);
    if (recLoc) route.pts.push({ ...recLoc, kind:'route-node' });

    if (route.pts.length >= 2) routes.push(route);
  });

  // Airfields
  (ato.airfields || []).forEach(af => {
    const p = parseCoord(af.coords);
    if (p) points.push({ ...p, kind:'airfield',
      label: af.icao || af.name || '?',
      sub: [af.role, af.elevation_ft != null ? af.elevation_ft+'ft' : null].filter(Boolean).join(' · ') });
  });

  // Carriers
  (ato.carriers || []).forEach(cv => {
    if (cv.deploy_coords) {
      const p = parseCoord(cv.deploy_coords);
      if (p) points.push({ ...p, kind:'carrier',
        label: cv.name || cv.callsign || 'CVN', sub: 'DEPLOY EST' });
    }
    if (cv.recovery_coords) {
      const p = parseCoord(cv.recovery_coords);
      if (p) points.push({ ...p, kind:'carrier',
        label: cv.name || cv.callsign || 'CVN', sub: 'RECOVERY EST' });
    }
  });

  return { points, routes };
}

// ── Coord parser ───────────────────────────────────────────
function parseCoord(str) {
  if (!str) return null;
  const re = /([NS])\s*(\d+)[°d][^\d]*(\d+(?:\.\d+)?)['\s]*(?:(\d+(?:\.\d+)?)["″\s]*)?\s*([EW])\s*(\d+)[°d][^\d]*(\d+(?:\.\d+)?)['\s]*(?:(\d+(?:\.\d+)?)["″]?)?/i;
  const m = str.match(re);
  if (!m) return null;
  const lat = (m[1]==='N'?1:-1)*(+m[2] + +m[3]/60 + +(m[4]||0)/3600);
  const lon = (m[5]==='E'?1:-1)*(+m[6] + +m[7]/60 + +(m[8]||0)/3600);
  return (isNaN(lat)||isNaN(lon)) ? null : { lat, lon };
}

function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }


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

function drawMap(container, points, routes) {
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

  // ── Bounding box of all data ──────────────────────────────
  let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity;
  const expand = p => {
    minLon=Math.min(minLon,p.lon); maxLon=Math.max(maxLon,p.lon);
    minLat=Math.min(minLat,p.lat); maxLat=Math.max(maxLat,p.lat);
  };
  points.forEach(expand);
  routes.forEach(r => r.pts.forEach(expand));

  const lSpan = Math.max(maxLon-minLon,1.5), aSpan = Math.max(maxLat-minLat,1.5);
  const lMarg = Math.max(lSpan*0.28,1.5),    aMarg = Math.max(aSpan*0.28,1.5);
  const vMinLon=minLon-lMarg, vMaxLon=maxLon+lMarg;
  const vMinLat=minLat-aMarg, vMaxLat=maxLat+aMarg;
  const vLon=vMaxLon-vMinLon, vLat=vMaxLat-vMinLat;

  // Base projection (zoom=1, pan=0,0) — fills canvas exactly
  const bx = lon => (lon-vMinLon)/vLon * W;
  const by = lat => (vMaxLat-lat)/vLat * H;

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

  // ── Grid ─────────────────────────────────────────────────
  const step = vLon>30?10:vLon>15?5:vLon>6?2:1;
  const gridG = svgEl('g');
  // Lines extend beyond canvas so they stay visible while panning
  for (let lon=Math.floor(vMinLon/step)*step-step; lon<=vMaxLon+step; lon+=step) {
    const x = bx(lon);
    const l = svgEl('line');
    l.setAttribute('x1',x); l.setAttribute('y1',-H);
    l.setAttribute('x2',x); l.setAttribute('y2',H*2);
    l.setAttribute('stroke',C.grid); l.setAttribute('stroke-width','0.5');
    gridG.appendChild(l);
  }
  for (let lat=Math.floor(vMinLat/step)*step-step; lat<=vMaxLat+step; lat+=step) {
    const y = by(lat);
    const l = svgEl('line');
    l.setAttribute('x1',-W); l.setAttribute('y1',y);
    l.setAttribute('x2',W*2); l.setAttribute('y2',y);
    l.setAttribute('stroke',C.grid); l.setAttribute('stroke-width','0.5');
    gridG.appendChild(l);
  }
  content.appendChild(gridG);

  // ── Land ─────────────────────────────────────────────────
  const landG = svgEl('g');
  Object.values(GEO_DATA.countries).forEach(poly => {
    const path = svgEl('path');
    path.setAttribute('d', poly.map((pt,i)=>
      `${i?'L':'M'}${bx(pt[0]).toFixed(1)},${by(pt[1]).toFixed(1)}`).join(' ')+' Z');
    path.setAttribute('fill',C.land);
    path.setAttribute('stroke',C.border);
    path.setAttribute('stroke-width','0.8');
    landG.appendChild(path);
  });
  content.appendChild(landG);

  // ── Cities ───────────────────────────────────────────────
  const cityG = svgEl('g');
  GEO_DATA.cities.forEach(city => {
    const cx=bx(city.lon), cy=by(city.lat);
    const major=city.pop===3, r=major?2.8:city.pop===2?2:1.4;
    const circ=svgEl('circle');
    circ.setAttribute('cx',cx); circ.setAttribute('cy',cy); circ.setAttribute('r',r);
    circ.setAttribute('fill',major?C.cityMajor:C.cityDot); circ.setAttribute('opacity','0.6');
    cityG.appendChild(circ);
    const t=svgEl('text');
    t.setAttribute('x',cx+3); t.setAttribute('y',cy-2);
    t.setAttribute('font-size',major?'7':'6');
    t.setAttribute('font-family','IBM Plex Mono,monospace');
    t.setAttribute('font-weight',major?'600':'400');
    t.setAttribute('fill',major?C.cityMajor:C.cityLbl);
    t.setAttribute('opacity','0.7'); t.textContent=city.n;
    cityG.appendChild(t);
  });
  content.appendChild(cityG);

  // ── Per-mission route groups (lines + markers together) ──
  // Each mission gets ONE <g data-msn="key"> so we can toggle opacity atomically
  const msnGroups = {}; // key → SVGElement

  routes.forEach(r => {
    const g = svgEl('g'); g.setAttribute('data-msn', r.msnKey);
    msnGroups[r.msnKey] = g;

    // Route lines
    for (let i=0; i<r.pts.length-1; i++) {
      const p0=r.pts[i], p1=r.pts[i+1];
      const toTgt = p1.kind==='target-node';
      const line=svgEl('line');
      line.setAttribute('x1',bx(p0.lon).toFixed(1)); line.setAttribute('y1',by(p0.lat).toFixed(1));
      line.setAttribute('x2',bx(p1.lon).toFixed(1)); line.setAttribute('y2',by(p1.lat).toFixed(1));
      line.setAttribute('stroke',r.color);
      line.setAttribute('stroke-width', toTgt?'2':'1.2');
      line.setAttribute('stroke-dasharray', toTgt?'6,3':'2,6');
      line.setAttribute('stroke-opacity','0.9');
      g.appendChild(line);
    }

    // Steer + target markers belonging to this mission
    points.filter(p=>(p.kind==='steer'||p.kind==='target') && p.mission?.mission_number===r.msnNum && p.mission?.callsign===r.callsign).forEach(p => {
      const mg=svgEl('g');
      mg.setAttribute('transform',`translate(${bx(p.lon).toFixed(1)},${by(p.lat).toFixed(1)})`);
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
      g.appendChild(mg);
    });

    content.appendChild(g);
  });

  // ── Shared markers (always visible: bullseye, airfields, carriers) ──
  const sharedG = svgEl('g');
  points.filter(p=>['bullseye','airfield','carrier'].includes(p.kind)).forEach(p => {
    const g=svgEl('g');
    g.setAttribute('transform',`translate(${bx(p.lon).toFixed(1)},${by(p.lat).toFixed(1)})`);

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
      const col=C.af;
      [[-12,0,12,0],[0,-7,0,7]].forEach(([x1,y1,x2,y2])=>{
        const l=svgEl('line'); l.setAttribute('x1',x1);l.setAttribute('y1',y1);
        l.setAttribute('x2',x2);l.setAttribute('y2',y2);
        l.setAttribute('stroke',col); l.setAttribute('stroke-width','2.5');
        l.setAttribute('stroke-linecap','round'); g.appendChild(l);
      });
      mapLabel(g, p.label, p.sub, col, 14);

    } else if (p.kind==='carrier') {
      const col=C.cv;
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
    sharedG.appendChild(g);
  });
  content.appendChild(sharedG);

  // ── Grid labels (in a separate overlay outside clip, anchored to screen edges) ──
  // Redrawn on every pan/zoom tick so they stay at canvas edges
  const lblOverlay = svgEl('g'); lblOverlay.setAttribute('pointer-events','none');
  svg.appendChild(lblOverlay);

  function redrawGridLabels(tx, ty, sc) {
    lblOverlay.innerHTML = '';
    const screenToWorld_lon = sx => vMinLon + (sx/sc - tx/sc) / W * vLon;
    const worldToScreen_x   = lon => (lon-vMinLon)/vLon * W * sc + tx;
    const worldToScreen_y   = lat => (vMaxLat-lat)/vLat * H * sc + ty;
    const visMinLon = screenToWorld_lon(0);
    const visMaxLon = screenToWorld_lon(W);

    for (let lon=Math.floor(visMinLon/step)*step; lon<=Math.ceil(visMaxLon/step)*step; lon+=step) {
      const sx = worldToScreen_x(lon);
      if (sx<20||sx>W-20) continue;
      const t=svgEl('text');
      t.setAttribute('x',sx); t.setAttribute('y',H-6);
      t.setAttribute('text-anchor','middle'); t.setAttribute('font-size','9');
      t.setAttribute('font-family','IBM Plex Mono,monospace');
      t.setAttribute('fill',C.gridLbl);
      t.textContent = lon>=0?`${lon}°E`:`${Math.abs(lon)}°W`;
      lblOverlay.appendChild(t);
    }
    // Lat labels on left edge
    const visMinLat = vMaxLat - (H/sc - ty/sc) / H * vLat;
    const visMaxLat = vMaxLat - (-ty/sc)        / H * vLat;
    for (let lat=Math.floor(visMinLat/step)*step; lat<=Math.ceil(visMaxLat/step)*step; lat+=step) {
      const sy = worldToScreen_y(lat);
      if (sy<10||sy>H-10) continue;
      const t=svgEl('text');
      t.setAttribute('x',8); t.setAttribute('y',sy+3);
      t.setAttribute('font-size','9');
      t.setAttribute('font-family','IBM Plex Mono,monospace');
      t.setAttribute('fill',C.gridLbl);
      t.textContent = lat>=0?`${lat}°N`:`${Math.abs(lat)}°S`;
      lblOverlay.appendChild(t);
    }
  }

  container.appendChild(svg);

  // ── Sidebar for route filtering ──────────────────────────
  const sidebar = el('div','map-sidebar');
  container.appendChild(sidebar);

  sidebar.appendChild(el('div','map-sidebar-title','ROUTES'));

  let highlighted = null; // null=all visible, key=solo

  function applyVisibility() {
    Object.entries(msnGroups).forEach(([key, g]) => {
      if (highlighted === null) {
        g.setAttribute('opacity','1');
      } else if (highlighted === key) {
        g.setAttribute('opacity','1');
      } else {
        g.setAttribute('opacity', String(C.dim));
      }
    });
    sidebar.querySelectorAll('.map-msn-btn').forEach(btn => {
      const k = btn.dataset.key;
      btn.classList.toggle('map-msn-active',  highlighted===k);
      btn.classList.toggle('map-msn-dimmed',  highlighted!==null && highlighted!==k);
    });
    sidebar.querySelector('.map-all-btn')?.classList.toggle('map-msn-active', highlighted===null);
  }

  routes.forEach(r => {
    const btn = el('button','map-msn-btn');
    btn.dataset.key = r.msnKey;
    const sw = el('span','map-msn-swatch'); sw.style.background = r.color;
    btn.appendChild(sw);
    btn.appendChild(el('span','map-msn-label', r.callsign+(r.msnNum?' · '+r.msnNum:'')));
    btn.addEventListener('click', () => {
      highlighted = (highlighted===r.msnKey) ? null : r.msnKey;
      applyVisibility();
    });
    sidebar.appendChild(btn);
  });

  const allBtn = el('button','map-msn-btn map-all-btn','◈ ALL');
  allBtn.classList.add('map-msn-active');
  allBtn.addEventListener('click',()=>{ highlighted=null; applyVisibility(); });
  sidebar.appendChild(allBtn);

  const sep = el('div','map-sidebar-sep');
  sidebar.appendChild(sep);

  // Legend
  sidebar.appendChild(el('div','map-sidebar-title','LEGEND'));
  const seenTypes=[...new Set(points.filter(p=>p.msnType).map(p=>p.msnType))];
  seenTypes.forEach(t=>{
    const row=el('div','map-legend-item');
    const dot=el('span','map-legend-dot'); dot.style.background=typeColor(t);
    row.appendChild(dot); row.appendChild(el('span','map-legend-lbl',t));
    sidebar.appendChild(row);
  });
  [
    [points.some(p=>p.kind==='bullseye'),'#ffb020','BULLSEYE'],
    [points.some(p=>p.kind==='airfield'),C.af,'AIRFIELD'],
    [points.some(p=>p.kind==='carrier'), C.cv,'CARRIER (EST)'],
  ].forEach(([show,col,lbl])=>{
    if (!show) return;
    const row=el('div','map-legend-item');
    const dot=el('span','map-legend-dot'); dot.style.background=col;
    row.appendChild(dot); row.appendChild(el('span','map-legend-lbl',lbl));
    sidebar.appendChild(row);
  });

  const resetBtn = el('button','map-msn-btn map-reset-btn','⊙ RESET VIEW');
  sidebar.appendChild(resetBtn);

  // ── Pan / Zoom ───────────────────────────────────────────
  let tx=0, ty=0, sc=1;
  const MIN_SC=1.0, MAX_SC=28;  // 1.0 = can't zoom out past initial fit

  function applyTransform() {
    content.setAttribute('transform',`translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${sc.toFixed(5)})`);
    redrawGridLabels(tx, ty, sc);
  }

  function clamp() {
    // Content at sc=1 fills exactly W×H. When zoomed in, allow panning
    // but never let the far edge come inward past a 10% margin.
    const margin = W * 0.1;
    tx = Math.min(tx,  margin);            // left edge can go at most margin right of 0
    tx = Math.max(tx, -(W*sc - W + margin)); // right edge stays in
    ty = Math.min(ty,  margin);
    ty = Math.max(ty, -(H*sc - H + margin));
  }

  resetBtn.addEventListener('click', ()=>{ tx=0; ty=0; sc=1; clamp(); applyTransform(); });

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const rect=svg.getBoundingClientRect();
    const mx=(e.clientX-rect.left)/rect.width*W;
    const my=(e.clientY-rect.top)/rect.height*H;
    const factor=e.deltaY<0?1.18:1/1.18;
    const ns=Math.max(MIN_SC,Math.min(MAX_SC,sc*factor));
    tx=mx-(mx-tx)*(ns/sc); ty=my-(my-ty)*(ns/sc); sc=ns;
    clamp(); applyTransform();
  },{passive:false});

  let drag=null;
  svg.addEventListener('mousedown',e=>{
    if(e.button!==0)return;
    drag={ox:e.clientX,oy:e.clientY,tx,ty};
    svg.style.cursor='grabbing'; e.preventDefault();
  });
  window.addEventListener('mousemove',e=>{
    if(!drag)return;
    const rect=svg.getBoundingClientRect();
    const sr=W/rect.width;
    tx=drag.tx+(e.clientX-drag.ox)*sr; ty=drag.ty+(e.clientY-drag.oy)*sr;
    clamp(); applyTransform();
  });
  window.addEventListener('mouseup',()=>{ drag=null; svg.style.cursor='grab'; });

  let lastT=null;
  svg.addEventListener('touchstart',e=>{ e.preventDefault(); lastT=e.touches; },{passive:false});
  svg.addEventListener('touchmove',e=>{
    e.preventDefault(); if(!lastT)return;
    const rect=svg.getBoundingClientRect(), sr=W/rect.width;
    if(e.touches.length===1&&lastT.length===1){
      tx+=(e.touches[0].clientX-lastT[0].clientX)*sr;
      ty+=(e.touches[0].clientY-lastT[0].clientY)*sr;
      clamp(); applyTransform();
    } else if(e.touches.length===2&&lastT.length===2){
      const d0=Math.hypot(lastT[0].clientX-lastT[1].clientX,lastT[0].clientY-lastT[1].clientY);
      const d1=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      const mx=((e.touches[0].clientX+e.touches[1].clientX)/2-rect.left)/rect.width*W;
      const my=((e.touches[0].clientY+e.touches[1].clientY)/2-rect.top)/rect.height*H;
      const ns=Math.max(MIN_SC,Math.min(MAX_SC,sc*d1/Math.max(d0,1)));
      tx=mx-(mx-tx)*(ns/sc); ty=my-(my-ty)*(ns/sc); sc=ns;
      clamp(); applyTransform();
    }
    lastT=e.touches;
  },{passive:false});
  svg.addEventListener('touchend',()=>{ lastT=null; });

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
