// ═══════════════════════════════════════════════════════════
// map-ui.js — Grid label overlay, popup, sidebar/legend
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Popup ────────────────────────────────────────────────
// Creates the popup div and a showPopup(p) / refreshPopup() pair.
// refreshPopup() re-renders the popup in-place after a display mode change
// (coord format, time mode) so the user doesn't have to click again.
// Returns { popup, showPopup, refreshPopup }.

// Human-readable heading for each point kind.
const KIND_LABELS = {
  steer:        'WAYPOINT',
  'steer-ref':  'WAYPOINT',
  target:       'AIM POINT',
  threat:       'THREAT',
  bullseye:     'BULLSEYE',
  airfield:     'AIRFIELD',
  carrier:      'CARRIER',
  airspace:     'AIRSPACE',
  marshal:      'MARSHAL POINT',
};

// ── Per-kind row builders ─────────────────────────────────
// Each function returns [[key, value], …] for its specific point kind.

// Format a mission entry {callsign, msnNum, time} as a single display string.
function fmtMsnEntry(entry) {
  const label = [entry.callsign, entry.msnNum].filter(Boolean).join(' · ');
  return `${label}  ${entry.time ? fmtTime(entry.time) : '—'}`;
}

function buildSteerTargetRows(p) {
  const rows = [['NAME', p.sub], ['MISSION', p.label]];
  if (p.msnType)          rows.push(['TYPE',     p.msnType]);
  if (p.altitude_ft != null) rows.push(['ALTITUDE', `${Math.round(p.altitude_ft).toLocaleString()} FT`]);
  return rows;
}

function buildThreatRows(p) {
  const rows = [['NAME', p.label]];
  if (p.threatType)      rows.push(['TYPE',      p.threatType]);
  if (p.elevation)       rows.push(['ELEVATION', p.elevation]);
  if (p.engagementRange) rows.push(['ENG RANGE', `${p.engagementRange} NM`]);
  if (p.maxAlt)          rows.push(['MAX ALT',   `${p.maxAlt.toLocaleString()} FT`]);
  return rows;
}

function buildAirfieldRows(p) {
  const rows = [['ICAO', p.label]];
  if (p.name)                rows.push(['NAME',      p.name]);
  if (p.role)                rows.push(['ROLE',      p.role.toUpperCase()]);
  if (p.elevation_ft != null) rows.push(['ELEVATION', `${p.elevation_ft} FT`]);
  if (p.runways?.length) {
    const rwys = Array.isArray(p.runways) ? p.runways.join(' / ') : String(p.runways);
    rows.push(['RUNWAYS', rwys]);
  }
  if (p.takeoffs?.length) {
    p.takeoffs.forEach(t => rows.push(['TAKEOFF', fmtMsnEntry(t)]));
  }
  return rows;
}

function buildCarrierRows(p) {
  const rows = [['NAME', p.label]];
  if (p.callsign) rows.push(['CALLSIGN', p.callsign]);
  if (p.sub)      rows.push(['STATUS',   p.sub]);
  if (p.takeoffs?.length) {
    p.takeoffs.forEach(t => rows.push(['TAKEOFF', fmtMsnEntry(t)]));
  }
  if (p.recoveries?.length) {
    p.recoveries.forEach(r => rows.push(['RECOVERY', fmtMsnEntry(r)]));
  }
  return rows;
}

function buildAirspaceRows(p) {
  const rows = [
    ['NAME', p.name || '?'],
    ['TYPE', (p.type || '?').toUpperCase()],
  ];
  if (p.altLower != null || p.altUpper != null) {
    const lo = p.altLower != null ? p.altLower : '?';
    const hi = p.altUpper != null ? p.altUpper : '?';
    rows.push(['ALTITUDE', `${lo} → ${hi}`]);
  }
  if (p.timeFrom != null || p.timeTo != null) {
    const tf = p.timeFrom != null ? fmtTime(p.timeFrom) : '?';
    const tt = p.timeTo   != null ? fmtTime(p.timeTo)   : '?';
    rows.push(['WINDOW', `${tf} – ${tt}`]);
  }
  if (p.agency)           rows.push(['AGENCY',      p.agency]);
  if (p.freq)             rows.push(['FREQ',         `${p.freq} MHz`]);
  if (p.radiusNm)         rows.push(['RADIUS',       `${p.radiusNm} NM`]);
  if (p.anchorPt)         rows.push(['ANCHOR PT',    fmtCoord(p.anchorPt.lat, p.anchorPt.lon)]);
  if (p.headingDeg != null) rows.push(['HOT LEG HDG', `${p.headingDeg}°`]);
  if (p.legLengthNm)      rows.push(['LEG LENGTH',   `${p.legLengthNm} NM`]);
  if (p.direction)        rows.push(['DIRECTION',    p.direction.toUpperCase()]);
  if (p.boundary?.length) rows.push(['BOUNDARY',
    p.boundary.map(pt => fmtCoord(pt.lat, pt.lon)).join(' → ')]);
  if (p.missions?.length) rows.push(['MISSIONS', p.missions.join(', ')]);
  if (p.notes)            rows.push(['NOTES',    p.notes]);
  return rows;
}

// Dispatch: returns the [[key, value], …] rows appropriate for any point kind.
function buildPopupRows(p) {
  if (p.kind === 'steer' || p.kind === 'steer-ref' || p.kind === 'target') return buildSteerTargetRows(p);
  if (p.kind === 'threat')   return buildThreatRows(p);
  if (p.kind === 'bullseye') return [['NAME', p.label]];
  if (p.kind === 'airfield') return buildAirfieldRows(p);
  if (p.kind === 'carrier')  return buildCarrierRows(p);
  if (p.kind === 'airspace') return buildAirspaceRows(p);
  if (p.kind === 'marshal') {
    const rows = [['NAME', p.label]];
    if (p.altitude) rows.push(['ALTITUDE', p.altitude]);
    if (p.time_on_station) rows.push(['ON STATION', fmtTime(p.time_on_station)]);
    if (p.time_off_station) rows.push(['OFF STATION', fmtTime(p.time_off_station)]);
    return rows;
  }
  return [];
}

function createPopup(container) {
  const popup = el('div', 'map-popup');
  popup.style.display = 'none';
  container.appendChild(popup);

  let lastPoint = null; // track so refreshPopup() can re-render on mode change

  function showPopup(p) {
    lastPoint = p;
    popup.innerHTML = '';

    popup.appendChild(el('div', 'mp-head', KIND_LABELS[p.kind] ?? p.kind.toUpperCase()));

    const rows = buildPopupRows(p);
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

  // Re-render the popup if it's currently visible — called after coord/time mode changes.
  function refreshPopup() {
    if (lastPoint && popup.style.display !== 'none') showPopup(lastPoint);
  }

  return { popup: popup, showPopup: showPopup, refreshPopup: refreshPopup };
}

// ── Grid label overlay ───────────────────────────────────
// Returns { overlay: SVGElement, redraw: function(tx,ty,sc) }
// Longitude labels run along the bottom edge; latitude labels along the left.
// Both are redrawn on every pan/zoom so they always reflect the visible range.
function createGridLabelOverlay(ctx) {
  const overlay = makeSvgEl('g', { 'pointer-events': 'none' });

  // Shared text attributes for all grid labels
  const LABEL_ATTRS = {
    'font-size':   9,
    'font-family': MONO_FONT,
    fill:          ctx.C.gridLbl,
  };

  function redraw(tx, ty, sc) {
    overlay.innerHTML = '';

    // Coordinate conversion helpers for the current pan/zoom state
    const screenToWorldLon = sx => ctx.vMinLon + (sx / sc - tx / sc) / ctx.W * ctx.vLon;
    const worldToScreenX   = lon => (lon - ctx.vMinLon) / ctx.vLon * ctx.W * sc + tx;
    const worldToScreenY   = lat => (ctx.vMaxLat - lat) / ctx.vLat * ctx.H * sc + ty;

    // Longitude labels along the bottom edge
    const visMinLon = screenToWorldLon(0);
    const visMaxLon = screenToWorldLon(ctx.W);
    const lonStart  = Math.floor(visMinLon / ctx.step) * ctx.step;
    const lonEnd    = Math.ceil (visMaxLon / ctx.step) * ctx.step;
    for (let lon = lonStart; lon <= lonEnd; lon += ctx.step) {
      const sx = worldToScreenX(lon);
      if (sx < 20 || sx > ctx.W - 20) continue;
      const label = lon >= 0 ? `${lon}°E` : `${Math.abs(lon)}°W`;
      overlay.appendChild(svgText(label, { ...LABEL_ATTRS, x: sx, y: ctx.H - 6, 'text-anchor': 'middle' }));
    }

    // Latitude labels along the left edge
    const visMinLat = ctx.vMaxLat - (ctx.H / sc - ty / sc) / ctx.H * ctx.vLat;
    const visMaxLat = ctx.vMaxLat - (-ty / sc)              / ctx.H * ctx.vLat;
    const latStart  = Math.floor(visMinLat / ctx.step) * ctx.step;
    const latEnd    = Math.ceil (visMaxLat / ctx.step) * ctx.step;
    for (let lat = latStart; lat <= latEnd; lat += ctx.step) {
      const sy = worldToScreenY(lat);
      if (sy < 10 || sy > ctx.H - 10) continue;
      const label = lat >= 0 ? `${lat}°N` : `${Math.abs(lat)}°S`;
      overlay.appendChild(svgText(label, { ...LABEL_ATTRS, x: 8, y: sy + 3 }));
    }
  }

  return { overlay, redraw };
}

// ── Sidebar / Legend ─────────────────────────────────────
// opts = {
//   routes, msnGroups, points, airspaces,
//   engZoneG, airspaceG, threatG,
//   C, threatCol, airspaceColors, defaultAirspaceCol,
// }
// Returns the sidebar HTMLElement with everything wired.
function createSidebar(opts) {
  const sidebar = el('div', 'map-sidebar');

  // ── Map mode selector ─────────────────────────────────────
  sidebar.appendChild(el('div', 'map-sidebar-title', 'MAP MODE'));

  const MAP_MODES = [
    { id: 'chart',     label: '⊞ CHART'     },
    { id: 'tactical',  label: '⊞ TACTICAL'  },
    { id: 'elevation', label: '⊞ ELEVATION' },
    { id: 'satellite', label: '⊞ SATELLITE' },
  ];
  const currentMode = STATE.mapUI?.mapMode || 'chart';
  MAP_MODES.forEach(({ id, label }) => {
    const btn = el('button', 'map-msn-btn map-mode-btn' + (currentMode === id ? ' map-msn-active' : ''), label);
    btn.addEventListener('click', () => {
      STATE.mapUI.mapMode = id;
      renderMAP(STATE.pkg.ato);
    });
    sidebar.appendChild(btn);
  });

  sidebar.appendChild(el('div', 'map-sidebar-sep'));
  sidebar.appendChild(el('div', 'map-sidebar-title', 'ROUTES'));

  // null = all visible, '__none__' = all hidden, key = solo highlight
  let highlighted = STATE.mapUI?.highlighted ?? null;

  function applyVisibility() {
    Object.entries(opts.msnGroups).forEach(([key, g]) => {
      const visible = highlighted === null || highlighted === key;
      g.setAttribute('opacity', visible ? '1' : String(opts.C.dim));
      if (visible) {
        g.removeAttribute('pointer-events');
      } else {
        g.setAttribute('pointer-events', 'none');
      }
    });
    sidebar.querySelectorAll('.map-msn-btn').forEach(btn => {
      const k = btn.dataset.key;
      if (!k) return;
      btn.classList.toggle('map-msn-active', highlighted === k);
      btn.classList.toggle('map-msn-dimmed', highlighted !== null && highlighted !== k);
    });
    sidebar.querySelector('.map-all-btn')?.classList.toggle('map-msn-active',   highlighted === null);
    sidebar.querySelector('.map-none-btn')?.classList.toggle('map-msn-active',  highlighted === '__none__');
    // Persist to centralized state
    STATE.mapUI.highlighted = highlighted;
  }

  opts.routes.forEach(r => {
    const btn = el('button', 'map-msn-btn');
    btn.dataset.key = r.msnKey;

    const swatch = el('span', 'map-msn-swatch');
    swatch.style.background = r.color;
    btn.appendChild(swatch);
    btn.appendChild(el('span', 'map-msn-label', r.callsign + (r.msnNum ? ' · ' + r.msnNum : '')));

    btn.addEventListener('click', () => {
      highlighted = (highlighted === r.msnKey) ? null : r.msnKey;
      applyVisibility();
    });
    sidebar.appendChild(btn);
  });

  const allBtn = el('button', 'map-msn-btn map-all-btn', '◈ ALL');
  allBtn.classList.add('map-msn-active');
  allBtn.addEventListener('click', () => { highlighted = null; applyVisibility(); });
  sidebar.appendChild(allBtn);

  const noneBtn = el('button', 'map-msn-btn map-none-btn', '◇ NONE');
  noneBtn.addEventListener('click', () => { highlighted = '__none__'; applyVisibility(); });
  sidebar.appendChild(noneBtn);

  sidebar.appendChild(el('div', 'map-sidebar-sep'));

  // Overlays toggle (engagement zones + airspaces + labels)
  const hasEngZones  = opts.points.some(p => p.kind === 'threat' && p.engagementRange);
  const hasAirspaces = opts.airspaces.length > 0;

  sidebar.appendChild(el('div', 'map-sidebar-title', 'OVERLAYS'));

  if (hasEngZones) {
    let engVisible = STATE.mapUI?.engVisible !== false;
    const engBtn = el('button', 'map-msn-btn' + (engVisible ? ' map-msn-active' : ''), '◯ ENG ZONES');
    engBtn.addEventListener('click', () => {
      engVisible = !engVisible;
      opts.engZoneG.setAttribute('display', engVisible ? '' : 'none');
      if (opts.threatG) opts.threatG.setAttribute('display', engVisible ? '' : 'none');
      engBtn.classList.toggle('map-msn-active', engVisible);
      STATE.mapUI.engVisible = engVisible;
    });
    // Apply initial visibility from saved state
    if (!engVisible) {
      opts.engZoneG.setAttribute('display', 'none');
      if (opts.threatG) opts.threatG.setAttribute('display', 'none');
    }
    sidebar.appendChild(engBtn);
  }

  if (hasAirspaces) {
    let airspaceVisible = STATE.mapUI?.airVisible !== false;
    const airspaceBtn = el('button', 'map-msn-btn' + (airspaceVisible ? ' map-msn-active' : ''), '◯ AIRSPACES');
    airspaceBtn.addEventListener('click', () => {
      airspaceVisible = !airspaceVisible;
      opts.airspaceG.setAttribute('display', airspaceVisible ? '' : 'none');
      airspaceBtn.classList.toggle('map-msn-active', airspaceVisible);
      STATE.mapUI.airVisible = airspaceVisible;
    });
    // Apply initial visibility from saved state
    if (!airspaceVisible) {
      opts.airspaceG.setAttribute('display', 'none');
    }
    sidebar.appendChild(airspaceBtn);
  }

  // Labels toggle — hide all marker / city / route text in the SVG
  {
    let labelsVisible = STATE.mapUI?.labelsVisible !== false;
    const labelsBtn = el('button', 'map-msn-btn' + (labelsVisible ? ' map-msn-active' : ''), '◯ LABELS');
    function _applyLabels(visible) {
      if (opts.svg) {
        opts.svg.querySelectorAll('text').forEach(t => t.setAttribute('display', visible ? '' : 'none'));
      }
    }
    labelsBtn.addEventListener('click', () => {
      labelsVisible = !labelsVisible;
      labelsBtn.classList.toggle('map-msn-active', labelsVisible);
      STATE.mapUI.labelsVisible = labelsVisible;
      _applyLabels(labelsVisible);
    });
    // Apply initial state
    if (!labelsVisible) _applyLabels(false);
    sidebar.appendChild(labelsBtn);
  }

  sidebar.appendChild(el('div', 'map-sidebar-sep'));

  // Legend — individually toggleable marker/zone types
  sidebar.appendChild(el('div', 'map-sidebar-title', 'LEGEND'));

  // Initialise hiddenLegend from saved state
  if (!STATE.mapUI.hiddenLegend) STATE.mapUI.hiddenLegend = {};

  // Helper: create a toggleable legend row that shows/hides SVG groups
  function addLegendToggle(color, label, toggleKey, toggleFn) {
    const hidden = !!STATE.mapUI.hiddenLegend[toggleKey];
    const btn = el('button', 'map-msn-btn map-legend-toggle' + (hidden ? ' map-msn-dimmed' : ''));
    const dot = el('span', 'map-legend-dot');
    dot.style.background = color;
    btn.appendChild(dot);
    btn.appendChild(el('span', 'map-legend-lbl', label));
    btn.addEventListener('click', () => {
      const nowHidden = !STATE.mapUI.hiddenLegend[toggleKey];
      STATE.mapUI.hiddenLegend[toggleKey] = nowHidden;
      btn.classList.toggle('map-msn-dimmed', nowHidden);
      toggleFn(!nowHidden);
    });
    // Apply initial state
    if (hidden) toggleFn(false);
    sidebar.appendChild(btn);
  }

  // Get the kind-groups from sharedMarkersG (set by drawSharedMarkers)
  const kindGroups = opts.sharedMarkersG?._kindGroups || {};

  // Mission type rows (only types that appear in the data)
  const seenMsnTypes = [...new Set(opts.points.filter(p => p.msnType).map(p => p.msnType))];
  seenMsnTypes.forEach(t => {
    addLegendToggle(typeColor(t), t, 'msntype_' + t, visible => {
      // Show/hide route groups of this mission type
      opts.routes.filter(r => {
        const matchPt = opts.points.find(p => p.mission?.callsign === r.callsign && p.mission?.mission_number === r.msnNum);
        return matchPt && matchPt.msnType === t;
      }).forEach(r => {
        const g = opts.msnGroups[r.msnKey];
        if (g) g.setAttribute('display', visible ? '' : 'none');
      });
    });
  });

  // Fixed marker types (shown only when present in the data)
  const markerTypes = [
    { check: opts.points.some(p => p.kind === 'bullseye'), color: '#ffb020',      label: 'BULLSEYE',      kind: 'bullseye' },
    { check: opts.points.some(p => p.kind === 'airfield'), color: opts.C.af,      label: 'AIRFIELD',      kind: 'airfield' },
    { check: opts.points.some(p => p.kind === 'carrier'),  color: opts.C.cv,      label: 'CARRIER (EST)', kind: 'carrier'  },
    { check: opts.points.some(p => p.kind === 'threat'),   color: opts.threatCol, label: 'THREAT',        kind: 'threat'   },
    { check: hasEngZones,                                   color: opts.threatCol, label: 'ENG ZONE',      kind: 'engzone'  },
    { check: opts.points.some(p => p.kind === 'marshal'),  color: '#7ec8e3',      label: 'MARSHAL PT',    kind: 'marshal'  },
  ];
  markerTypes.forEach(({ check, color, label, kind }) => {
    if (!check) return;
    addLegendToggle(color, label, 'marker_' + kind, visible => {
      if (kind === 'threat') {
        if (opts.threatG) opts.threatG.setAttribute('display', visible ? '' : 'none');
      } else if (kind === 'engzone') {
        opts.engZoneG.setAttribute('display', visible ? '' : 'none');
      } else {
        const kg = kindGroups[kind];
        if (kg) kg.setAttribute('display', visible ? '' : 'none');
      }
    });
  });

  // Airspace type rows (one per unique type seen in the data)
  const seenAirspaceTypes = [...new Set(opts.airspaces.map(a => (a.type || 'OTHER').toUpperCase()))];
  seenAirspaceTypes.forEach(t => {
    addLegendToggle(opts.airspaceColors[t] || opts.defaultAirspaceCol, t, 'airspace_' + t, visible => {
      // Find and toggle children of the airspace group matching this type
      const aG = opts.airspaceG;
      if (!aG) return;
      // Use CSS.escape to safely handle special characters in type names
      const safeType = CSS.escape(t);
      opts.airspaces.forEach((a, i) => {
        if ((a.type || 'OTHER').toUpperCase() !== t) return;
        aG.querySelectorAll(`[data-airspace-type="${safeType}"]`).forEach(el => {
          el.setAttribute('display', visible ? '' : 'none');
        });
      });
    });
  });

  // ── Smart Declutter ─────────────────────────────────────────
  // Auto-adjusts visibility based on zoom level to reduce visual clutter.
  // Low zoom:  hide labels + city dots, dim minor markers
  // Mid zoom:  show route labels, hide city names
  // High zoom: show everything
  sidebar.appendChild(el('div', 'map-sidebar-sep'));
  sidebar.appendChild(el('div', 'map-sidebar-title', 'DECLUTTER'));

  let smartDeclutter = STATE.mapUI?.smartDeclutter === true;
  const smartBtn = el('button', 'map-msn-btn' + (smartDeclutter ? ' map-msn-active' : ''), '◉ SMART DECLUTTER');
  smartBtn.title = 'Auto-hide labels and minor markers at low zoom levels';

  // Zoom thresholds — below these zoom levels, elements are hidden/dimmed
  const ZOOM_SHOW_ROUTE_LABELS = 5;  // steer point labels appear above this
  const ZOOM_SHOW_CITY_LABELS  = 3;  // city labels appear above this

  // Track previous declutter state to avoid redundant DOM operations
  let prevDeclutterLevel = -1;

  function applySmartDeclutter(sc) {
    if (!smartDeclutter) {
      if (prevDeclutterLevel !== -1) {
        // Restore everything when turning off smart declutter
        if (opts.svg) {
          opts.svg.querySelectorAll('[data-city-label]').forEach(t => t.setAttribute('display', ''));
          opts.svg.querySelectorAll('[data-route-label] text').forEach(t => t.setAttribute('display', ''));
        }
        prevDeclutterLevel = -1;
      }
      return;
    }

    // Determine current declutter level: 0 = max clutter reduction, 1 = medium, 2 = full detail
    let level = 2; // show everything
    if (sc < ZOOM_SHOW_CITY_LABELS)  level = 0; // hide city labels + route labels
    else if (sc < ZOOM_SHOW_ROUTE_LABELS) level = 1; // hide route labels only

    if (level === prevDeclutterLevel) return; // no change
    prevDeclutterLevel = level;

    if (opts.svg) {
      // City labels: hidden at low zoom
      opts.svg.querySelectorAll('[data-city-label]').forEach(t => {
        t.setAttribute('display', level >= 1 ? '' : 'none');
      });
      // Route/steer-point text labels: hidden at low and medium zoom
      // (circles/shapes remain visible — only the text is hidden)
      opts.svg.querySelectorAll('[data-route-label] text').forEach(t => {
        t.setAttribute('display', level >= 2 ? '' : 'none');
      });
    }
  }

  smartBtn.addEventListener('click', () => {
    smartDeclutter = !smartDeclutter;
    STATE.mapUI.smartDeclutter = smartDeclutter;
    smartBtn.classList.toggle('map-msn-active', smartDeclutter);
    prevDeclutterLevel = -1; // force re-evaluation
    // Will be applied on next applyTransform call; trigger it immediately
    if (sidebar._onDeclutter) sidebar._onDeclutter();
  });
  sidebar.appendChild(smartBtn);

  // Expose the declutter function so drawMap can call it on every zoom change
  sidebar._applySmartDeclutter = applySmartDeclutter;

  const measureBtn = el('button', 'map-msn-btn map-measure-btn', '⊕ MEASURE');
  sidebar.appendChild(measureBtn);

  const resetBtn = el('button', 'map-msn-btn map-reset-btn', '⊙ RESET VIEW');
  sidebar.appendChild(resetBtn);

  // Expose buttons so drawMap can wire them
  sidebar._measureBtn = measureBtn;
  sidebar._resetBtn = resetBtn;

  return sidebar;
}
