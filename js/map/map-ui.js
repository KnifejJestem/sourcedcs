// ═══════════════════════════════════════════════════════════
// map-ui.js — Grid label overlay, popup, sidebar/legend
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Popup ────────────────────────────────────────────────
// Creates the popup div and a showPopup(p) function that
// populates it. Returns { popup, showPopup }.
function createPopup(container) {
  const popup = el('div', 'map-popup');
  popup.style.display = 'none';
  container.appendChild(popup);

  function showPopup(p) {
    popup.innerHTML = '';
    const kindLabel = {
      steer:'WAYPOINT', target:'AIM POINT', threat:'THREAT',
      bullseye:'BULLSEYE', airfield:'AIRFIELD', carrier:'CARRIER',
      airspace:'AIRSPACE',
    }[p.kind] || p.kind.toUpperCase();
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
    } else if (p.kind === 'bullseye') {
      rows.push(['NAME', p.label]);
    } else if (p.kind === 'airfield') {
      rows.push(['ICAO', p.label]);
      if (p.sub) rows.push(['INFO', p.sub]);
      if (p.name) rows.push(['NAME', p.name]);
    } else if (p.kind === 'carrier') {
      rows.push(['NAME', p.label]);
      if (p.sub) rows.push(['STATUS', p.sub]);
      if (p.callsign) rows.push(['CALLSIGN', p.callsign]);
    } else if (p.kind === 'airspace') {
      rows.push(['NAME', p.name || '?']);
      rows.push(['TYPE', (p.type || '?').toUpperCase()]);
      if (p.altLower != null || p.altUpper != null) rows.push(['ALTITUDE', `${p.altLower != null ? p.altLower : '?'} → ${p.altUpper != null ? p.altUpper : '?'}`]);
      if (p.timeFrom != null || p.timeTo != null) rows.push(['WINDOW', `${p.timeFrom != null ? fmtTime(p.timeFrom) : '?'} – ${p.timeTo != null ? fmtTime(p.timeTo) : '?'}`]);
      if (p.agency) rows.push(['AGENCY', p.agency]);
      if (p.freq) rows.push(['FREQ', p.freq + ' MHz']);
      if (p.radiusNm) rows.push(['RADIUS', p.radiusNm + ' NM']);
      if (p.anchorPt) rows.push(['ANCHOR PT', fmtCoord(p.anchorPt.lat, p.anchorPt.lon)]);
      if (p.headingDeg != null) rows.push(['HOT LEG HDG', p.headingDeg + '°']);
      if (p.legLengthNm) rows.push(['LEG LENGTH', p.legLengthNm + ' NM']);
      if (p.direction) rows.push(['DIRECTION', p.direction.toUpperCase()]);
      if (p.boundary) rows.push(['BOUNDARY', p.boundary.map(pt => fmtCoord(pt.lat, pt.lon)).join(' → ')]);
      if (p.missions?.length) rows.push(['MISSIONS', p.missions.join(', ')]);
      if (p.notes) rows.push(['NOTES', p.notes]);
    }
    if (p.lat != null && p.lon != null) rows.push(['COORDS', fmtCoord(p.lat, p.lon)]);
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

  return { popup: popup, showPopup: showPopup };
}

// ── Grid label overlay ───────────────────────────────────
// Returns { overlay: SVGElement, redraw: function(tx,ty,sc) }
function createGridLabelOverlay(ctx) {
  const lblOverlay = svgEl('g'); lblOverlay.setAttribute('pointer-events','none');

  function redraw(tx, ty, sc) {
    lblOverlay.innerHTML = '';
    const screenToWorld_lon = sx => ctx.vMinLon + (sx/sc - tx/sc) / ctx.W * ctx.vLon;
    const worldToScreen_x   = lon => (lon-ctx.vMinLon)/ctx.vLon * ctx.W * sc + tx;
    const worldToScreen_y   = lat => (ctx.vMaxLat-lat)/ctx.vLat * ctx.H * sc + ty;
    const visMinLon = screenToWorld_lon(0);
    const visMaxLon = screenToWorld_lon(ctx.W);

    for (let lon=Math.floor(visMinLon/ctx.step)*ctx.step; lon<=Math.ceil(visMaxLon/ctx.step)*ctx.step; lon+=ctx.step) {
      const sx = worldToScreen_x(lon);
      if (sx<20||sx>ctx.W-20) continue;
      const t=svgEl('text');
      t.setAttribute('x',sx); t.setAttribute('y',ctx.H-6);
      t.setAttribute('text-anchor','middle'); t.setAttribute('font-size','9');
      t.setAttribute('font-family','IBM Plex Mono,monospace');
      t.setAttribute('fill',ctx.C.gridLbl);
      t.textContent = lon>=0?`${lon}°E`:`${Math.abs(lon)}°W`;
      lblOverlay.appendChild(t);
    }
    // Lat labels on left edge
    const visMinLat = ctx.vMaxLat - (ctx.H/sc - ty/sc) / ctx.H * ctx.vLat;
    const visMaxLat = ctx.vMaxLat - (-ty/sc)           / ctx.H * ctx.vLat;
    for (let lat=Math.floor(visMinLat/ctx.step)*ctx.step; lat<=Math.ceil(visMaxLat/ctx.step)*ctx.step; lat+=ctx.step) {
      const sy = worldToScreen_y(lat);
      if (sy<10||sy>ctx.H-10) continue;
      const t=svgEl('text');
      t.setAttribute('x',8); t.setAttribute('y',sy+3);
      t.setAttribute('font-size','9');
      t.setAttribute('font-family','IBM Plex Mono,monospace');
      t.setAttribute('fill',ctx.C.gridLbl);
      t.textContent = lat>=0?`${lat}°N`:`${Math.abs(lat)}°S`;
      lblOverlay.appendChild(t);
    }
  }

  return { overlay: lblOverlay, redraw: redraw };
}

// ── Sidebar / Legend ─────────────────────────────────────
// opts = {
//   routes, msnGroups, points, airspaces,
//   engZoneG, airspaceG, threatG,
//   C, threatCol, airspaceColors, defaultAirspaceCol,
// }
// Returns the sidebar HTMLElement with everything wired.
function createSidebar(opts) {
  const sidebar = el('div','map-sidebar');

  sidebar.appendChild(el('div','map-sidebar-title','ROUTES'));

  let highlighted = null; // null=all visible, '__none__'=all hidden, key=solo

  function applyVisibility() {
    Object.entries(opts.msnGroups).forEach(([key, g]) => {
      if (highlighted === null) {
        g.setAttribute('opacity','1');
        g.removeAttribute('pointer-events');
      } else if (highlighted === key) {
        g.setAttribute('opacity','1');
        g.removeAttribute('pointer-events');
      } else {
        g.setAttribute('opacity', String(opts.C.dim));
        g.setAttribute('pointer-events', 'none');
      }
    });
    sidebar.querySelectorAll('.map-msn-btn').forEach(btn => {
      const k = btn.dataset.key;
      if (!k) return;
      btn.classList.toggle('map-msn-active',  highlighted===k);
      btn.classList.toggle('map-msn-dimmed',  highlighted!==null && highlighted!==k);
    });
    sidebar.querySelector('.map-all-btn')?.classList.toggle('map-msn-active', highlighted===null);
    sidebar.querySelector('.map-none-btn')?.classList.toggle('map-msn-active', highlighted==='__none__');
  }

  opts.routes.forEach(r => {
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

  const noneBtn = el('button','map-msn-btn map-none-btn','◇ NONE');
  noneBtn.addEventListener('click',()=>{ highlighted='__none__'; applyVisibility(); });
  sidebar.appendChild(noneBtn);

  const sep = el('div','map-sidebar-sep');
  sidebar.appendChild(sep);

  // Overlays toggle (engagement zones + airspaces)
  const hasEngZones = opts.points.some(p => p.kind === 'threat' && p.engagementRange);
  const hasAirspaces = opts.airspaces.length > 0;
  if (hasEngZones || hasAirspaces) {
    sidebar.appendChild(el('div','map-sidebar-title','OVERLAYS'));
    if (hasEngZones) {
      let engVisible = true;
      const engBtn = el('button','map-msn-btn map-msn-active','◯ ENG ZONES');
      engBtn.addEventListener('click', () => {
        engVisible = !engVisible;
        opts.engZoneG.setAttribute('display', engVisible ? '' : 'none');
        if (opts.threatG) opts.threatG.setAttribute('display', engVisible ? '' : 'none');
        engBtn.classList.toggle('map-msn-active', engVisible);
      });
      sidebar.appendChild(engBtn);
    }
    if (hasAirspaces) {
      let airspaceVisible = true;
      const airspaceBtn = el('button','map-msn-btn map-msn-active','◯ AIRSPACES');
      airspaceBtn.addEventListener('click', () => {
        airspaceVisible = !airspaceVisible;
        opts.airspaceG.setAttribute('display', airspaceVisible ? '' : 'none');
        airspaceBtn.classList.toggle('map-msn-active', airspaceVisible);
      });
      sidebar.appendChild(airspaceBtn);
    }
    const sep2 = el('div','map-sidebar-sep');
    sidebar.appendChild(sep2);
  }

  // Legend
  sidebar.appendChild(el('div','map-sidebar-title','LEGEND'));
  const seenTypes=[...new Set(opts.points.filter(p=>p.msnType).map(p=>p.msnType))];
  seenTypes.forEach(t=>{
    const row=el('div','map-legend-item');
    const dot=el('span','map-legend-dot'); dot.style.background=typeColor(t);
    row.appendChild(dot); row.appendChild(el('span','map-legend-lbl',t));
    sidebar.appendChild(row);
  });
  [
    [opts.points.some(p=>p.kind==='bullseye'),'#ffb020','BULLSEYE'],
    [opts.points.some(p=>p.kind==='airfield'),opts.C.af,'AIRFIELD'],
    [opts.points.some(p=>p.kind==='carrier'), opts.C.cv,'CARRIER (EST)'],
    [opts.points.some(p=>p.kind==='threat'), opts.threatCol,'THREAT'],
    [hasEngZones, opts.threatCol,'ENG ZONE'],
  ].forEach(([show,col,lbl])=>{
    if (!show) return;
    const row=el('div','map-legend-item');
    const dot=el('span','map-legend-dot'); dot.style.background=col;
    row.appendChild(dot); row.appendChild(el('span','map-legend-lbl',lbl));
    sidebar.appendChild(row);
  });
  // Airspace legend entries
  const seenAirspaceTypes = [...new Set(opts.airspaces.map(a => (a.type || 'OTHER').toUpperCase()))];
  seenAirspaceTypes.forEach(t => {
    const col = opts.airspaceColors[t] || opts.defaultAirspaceCol;
    const row = el('div','map-legend-item');
    const dot = el('span','map-legend-dot'); dot.style.background = col;
    row.appendChild(dot); row.appendChild(el('span','map-legend-lbl', t));
    sidebar.appendChild(row);
  });

  const resetBtn = el('button','map-msn-btn map-reset-btn','⊙ RESET VIEW');
  sidebar.appendChild(resetBtn);

  // Expose the reset button so drawMap can wire it
  sidebar._resetBtn = resetBtn;

  return sidebar;
}
