// ═══════════════════════════════════════════════════════════
// map-render.js — SVG map drawing (drawMap + mapLabel)
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

function drawMap(container, points, routes, geoData) {
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
  Object.values(geoData.countries).forEach(poly => {
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
  geoData.cities.forEach(city => {
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

  // ── Engagement zones (drawn first, behind routes and markers) ──
  const threatCol = movie ? '#ff4444' : '#c0392b';
  const nmToSvg = nm => nm / 60 / vLat * H;
  const engZoneG = svgEl('g');
  points.filter(p => p.kind === 'threat' && p.engagementRange).forEach(p => {
    const circ = svgEl('circle');
    circ.setAttribute('cx', bx(p.lon).toFixed(1));
    circ.setAttribute('cy', by(p.lat).toFixed(1));
    circ.setAttribute('r', nmToSvg(p.engagementRange).toFixed(1));
    circ.setAttribute('fill', movie ? 'rgba(255,68,68,0.08)' : 'rgba(192,57,43,0.07)');
    circ.setAttribute('stroke', threatCol);
    circ.setAttribute('stroke-width', '1.5');
    circ.setAttribute('stroke-dasharray', '6,3');
    circ.setAttribute('pointer-events', 'none');
    engZoneG.appendChild(circ);
  });
  content.appendChild(engZoneG);

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
      mg.style.cursor = 'pointer';
      mg.addEventListener('click', e => { e.stopPropagation(); showPopup(p); });
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

  // ── Threat markers ──────────────────────────────────────
  const threatG = svgEl('g');
  points.filter(p => p.kind === 'threat').forEach(p => {
    const g = svgEl('g');
    g.setAttribute('transform', `translate(${bx(p.lon).toFixed(1)},${by(p.lat).toFixed(1)})`);
    g.style.cursor = 'pointer';
    [[-7,-7,7,7],[7,-7,-7,7]].forEach(([x1,y1,x2,y2]) => {
      const l = svgEl('line');
      l.setAttribute('x1',x1); l.setAttribute('y1',y1);
      l.setAttribute('x2',x2); l.setAttribute('y2',y2);
      l.setAttribute('stroke', threatCol); l.setAttribute('stroke-width','2.5');
      l.setAttribute('stroke-linecap','round'); g.appendChild(l);
    });
    const cd = svgEl('circle'); cd.setAttribute('r','5');
    cd.setAttribute('fill','none'); cd.setAttribute('stroke',threatCol);
    cd.setAttribute('stroke-width','1.2'); g.appendChild(cd);
    mapLabel(g, p.label, p.sub, threatCol, 9);
    g.addEventListener('click', e => { e.stopPropagation(); showPopup(p); });
    threatG.appendChild(g);
  });
  content.appendChild(threatG);

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

  // ── Info popup ──────────────────────────────────────────
  const popup = el('div', 'map-popup');
  popup.style.display = 'none';
  container.appendChild(popup);

  function fmtCoord(lat, lon) {
    const la = lat >= 0 ? `${lat.toFixed(4)}°N` : `${Math.abs(lat).toFixed(4)}°S`;
    const lo = lon >= 0 ? `${lon.toFixed(4)}°E` : `${Math.abs(lon).toFixed(4)}°W`;
    return `${la}  ${lo}`;
  }

  function showPopup(p) {
    popup.innerHTML = '';
    const kindLabel = {steer:'WAYPOINT', target:'AIM POINT', threat:'THREAT'}[p.kind] || p.kind.toUpperCase();
    popup.appendChild(el('div', 'mp-head', kindLabel));
    const rows = [];
    if (p.kind === 'steer') {
      rows.push(['NAME', p.sub]);
      rows.push(['MISSION', p.label]);
      if (p.msnType) rows.push(['TYPE', p.msnType]);
    } else if (p.kind === 'target') {
      rows.push(['NAME', p.sub]);
      rows.push(['MISSION', p.label]);
      if (p.msnType) rows.push(['TYPE', p.msnType]);
    } else if (p.kind === 'threat') {
      rows.push(['NAME', p.label]);
      if (p.threatType) rows.push(['TYPE', p.threatType]);
      if (p.engagementRange) rows.push(['ENG RANGE', `${p.engagementRange} NM`]);
      if (p.maxAlt) rows.push(['MAX ALT', `${p.maxAlt.toLocaleString()} FT`]);
    }
    rows.push(['COORDS', fmtCoord(p.lat, p.lon)]);
    rows.forEach(([k, v]) => {
      const row = el('div', 'mp-row');
      row.appendChild(el('span', 'mp-k', k));
      row.appendChild(el('span', 'mp-v', String(v)));
      popup.appendChild(row);
    });
    const closeBtn = el('button', 'mp-close', '×');
    closeBtn.addEventListener('click', () => { popup.style.display = 'none'; });
    popup.appendChild(closeBtn);
    popup.style.display = 'block';
  }

  // Close popup when clicking the map background
  svg.addEventListener('click', () => { popup.style.display = 'none'; });

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

  // Overlays toggle (engagement zones)
  const hasEngZones = points.some(p => p.kind === 'threat' && p.engagementRange);
  if (hasEngZones) {
    sidebar.appendChild(el('div','map-sidebar-title','OVERLAYS'));
    let engVisible = true;
    const engBtn = el('button','map-msn-btn map-msn-active','◯ ENG ZONES');
    engBtn.addEventListener('click', () => {
      engVisible = !engVisible;
      engZoneG.setAttribute('display', engVisible ? '' : 'none');
      engBtn.classList.toggle('map-msn-active', engVisible);
    });
    sidebar.appendChild(engBtn);
    const sep2 = el('div','map-sidebar-sep');
    sidebar.appendChild(sep2);
  }

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
    [points.some(p=>p.kind==='threat'), threatCol,'THREAT'],
    [hasEngZones, threatCol,'ENG ZONE'],
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
  const state = { tx: 0, ty: 0, sc: 1 };
  const MIN_SC = 1.0, MAX_SC = 28;  // 1.0 = can't zoom out past initial fit

  function applyTransform() {
    content.setAttribute('transform',`translate(${state.tx.toFixed(2)},${state.ty.toFixed(2)}) scale(${state.sc.toFixed(5)})`);
    redrawGridLabels(state.tx, state.ty, state.sc);
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

  resetBtn.addEventListener('click', () => { state.tx=0; state.ty=0; state.sc=1; clamp(); applyTransform(); });

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
