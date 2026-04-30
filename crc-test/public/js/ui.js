'use strict';

// ── Topbar display elements ────────────────────────────────────────────────

const $refDisplay = document.getElementById('ref-display');
const $aptDisplay = document.getElementById('apt-display');

function updateRefDisplay() {
  if (!selectedRef) {
    $refDisplay.textContent = 'REF: NONE';
    $refDisplay.classList.remove('active');
  } else {
    const t = tracks.get(selectedRef);
    $refDisplay.textContent = t ? `REF: ${resolveCallsign(t)}` : 'REF: NONE';
    $refDisplay.classList.toggle('active', !!t);
    if (!t) selectedRef = null;
  }
  if (mapReady) {
    map.getSource('range-ring').setData(buildRangeRing());
    map.getSource('ref-dot').setData(buildRefDot());
  }
}

function updateAptDisplay() {
  if (!selectedApt) {
    $aptDisplay.textContent = 'APT: NONE';
    $aptDisplay.classList.remove('active');
  } else {
    $aptDisplay.textContent = `APT: ${selectedApt.icao || selectedApt.name}`;
    $aptDisplay.classList.add('active');
  }
  if (mapReady) {
    map.getSource('range-ring').setData(buildRangeRing());
  }
}

// Show REF selector in CRC view, APT selector in airport/approach view.
function updateViewUI() {
  const isCrc      = activeView === 'crc';
  const isAirport  = activeView === 'airport';
  const isApproach = activeView === 'approach';
  const $refSep    = document.getElementById('ref-sep');
  const $aptSep    = document.getElementById('apt-sep');
  const $rwySep    = document.getElementById('rwy-sep');
  const $rwyRow    = document.getElementById('rwy-row');
  const $appPanel  = document.getElementById('approach-panel');

  $refDisplay.style.display = isCrc      ? '' : 'none';
  $refSep.style.display     = isCrc      ? '' : 'none';
  $aptDisplay.style.display = (isAirport || isApproach) ? '' : 'none';
  $aptSep.style.display     = (isAirport || isApproach) ? '' : 'none';
  $rwySep.style.display     = isApproach ? '' : 'none';
  $rwyRow.style.display     = isApproach ? '' : 'none';
  if ($appPanel) $appPanel.classList.toggle('open', isApproach);
}

// ── Status UI ─────────────────────────────────────────────────────────────

const $dotGrpc  = document.getElementById('dot-grpc');
const $dotSrs   = document.getElementById('dot-srs');
const $lblGrpc  = document.getElementById('lbl-grpc');
const $discOver = document.getElementById('disc-overlay');
const $stale    = document.getElementById('stale-banner');

function updateStatusUI() {
  $dotGrpc.className   = 'dot ' + grpcStatus;
  $dotSrs.className    = 'dot ' + srsStatus;
  $lblGrpc.textContent = grpcStatus === 'connected' ? 'GRPC' : grpcStatus.toUpperCase();
  $discOver.classList.toggle('visible', grpcStatus === 'disconnected');
}

function checkStale() {
  const isStale  = grpcStatus === 'reconnecting'
    && lastUpdateMs != null
    && Date.now() - lastUpdateMs > STALE_MS;
  const wasStale = $stale.classList.contains('visible');
  $stale.classList.toggle('visible', isStale);
  if (isStale !== wasStale) updateMap();
}

// ── Bullseye cursor BRA ────────────────────────────────────────────────────

const $cursorBra = document.getElementById('cursor-bra');

function updateBullseyeCursor(e) {
  if (!missionData || !missionData.bullseye) return;
  const be = missionData.bullseye.blue || missionData.bullseye.red;
  if (!be) { $cursorBra.classList.remove('visible'); return; }

  const rect   = map.getCanvas().getBoundingClientRect();
  const cursor = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
  const distNm = haversineM(be.lat, be.lon, cursor.lat, cursor.lng) / 1852;
  const hdg    = Math.round(bearingDeg(be.lat, be.lon, cursor.lat, cursor.lng));

  $cursorBra.textContent = `${hdg.toString().padStart(3, '0')}/${Math.round(distNm).toString().padStart(3, '0')}`;
  $cursorBra.style.color = settings.braColor;
  $cursorBra.classList.add('visible');

  const offX = 14, offY = 14;
  const nearRight = e.clientX + offX + 80 > window.innerWidth;
  $cursorBra.style.left = (nearRight ? e.clientX - 80 : e.clientX + offX) + 'px';
  $cursorBra.style.top  = (e.clientY + offY) + 'px';
}

// ── Measure line ──────────────────────────────────────────────────────────

function updateMeasureLine(lng1, lat1, lng2, lat2) {
  if (!mapReady) return;
  const distNm  = Math.round(haversineM(lat1, lng1, lat2, lng2) / 1852);
  const bearing = Math.round(bearingDeg(lat1, lng1, lat2, lng2)) % 360;
  const label   = `${distNm.toString().padStart(3,'0')} / ${bearing.toString().padStart(3,'0')}`;
  map.getSource('measure').setData({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[lng1, lat1], [lng2, lat2]] }, properties: { kind: 'line' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [(lng1+lng2)/2, (lat1+lat2)/2] }, properties: { kind: 'label', label } },
    ],
  });
}

// ── Settings panel ────────────────────────────────────────────────────────

function initSettings() {
  const panel   = document.getElementById('settings-panel');
  const btnOpen = document.getElementById('btn-settings');

  btnOpen.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== btnOpen) panel.classList.remove('open');
  });

  const els = {
    pplEnabled:  document.getElementById('set-ppl-enabled'),
    pplDuration: document.getElementById('set-ppl-duration'),
    pplVal:      document.getElementById('set-ppl-val'),
    trailEn:     document.getElementById('set-trail-enabled'),
    trailLength: document.getElementById('set-trail-length'),
    trailLenVal: document.getElementById('set-trail-length-val'),
    aiEn:        document.getElementById('set-ai-enabled'),
    shipsEn:     document.getElementById('set-ships-enabled'),
    braColor:    document.getElementById('set-bra-color'),
    scale:       document.getElementById('set-scale'),
    scaleVal:    document.getElementById('set-scale-val'),
    lightMode:   document.getElementById('set-light-mode'),
  };

  els.pplEnabled.checked = settings.pplEnabled;
  els.pplDuration.value  = settings.pplDuration;
  els.pplVal.textContent = settings.pplDuration + 's';
  els.trailEn.checked       = settings.trailEnabled;
  els.trailLength.value     = settings.trailLength;
  els.trailLenVal.textContent = settings.trailLength;
  els.aiEn.checked       = settings.aiEnabled;
  els.shipsEn.checked    = settings.shipsEnabled;
  els.braColor.value     = settings.braColor;
  els.scale.value        = settings.scale;
  els.scaleVal.textContent = parseFloat(settings.scale).toFixed(1) + '×';
  els.lightMode.checked  = settings.lightMode;
  applyLightMode();

  const persist = (key, val) => { settings[key] = val; saveSettings(); updateMap(); };

  els.pplEnabled.addEventListener('change', () => persist('pplEnabled',  els.pplEnabled.checked));
  els.pplDuration.addEventListener('input', () => {
    settings.pplDuration = parseInt(els.pplDuration.value);
    els.pplVal.textContent = settings.pplDuration + 's';
    saveSettings(); updateMap();
  });
  els.trailEn.addEventListener('change', () => persist('trailEnabled', els.trailEn.checked));
  els.trailLength.addEventListener('input', () => {
    settings.trailLength = parseInt(els.trailLength.value);
    els.trailLenVal.textContent = settings.trailLength;
    saveSettings(); updateMap();
  });
  els.aiEn.addEventListener('change',    () => persist('aiEnabled',    els.aiEn.checked));
  els.shipsEn.addEventListener('change', () => persist('shipsEnabled', els.shipsEn.checked));
  els.braColor.addEventListener('input', () => persist('braColor',     els.braColor.value));
  els.scale.addEventListener('input', () => {
    settings.scale = parseFloat(els.scale.value);
    els.scaleVal.textContent = settings.scale.toFixed(1) + '×';
    saveSettings();
    applyScale();
  });
  els.lightMode.addEventListener('change', () => {
    settings.lightMode = els.lightMode.checked;
    saveSettings();
    applyLightMode();
  });
}

function applyLightMode() {
  document.body.classList.toggle('light', !!settings.lightMode);
  applyMapTheme();
}

// ── View selector ─────────────────────────────────────────────────────────

function initViewSelector() {
  const selector = document.getElementById('view-selector');
  const dropdown = document.getElementById('view-dropdown');
  const label    = document.getElementById('view-label');

  function openDropdown() {
    const rect = selector.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.classList.add('open');
  }

  selector.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.contains('open') ? dropdown.classList.remove('open') : openDropdown();
  });
  document.addEventListener('click', () => dropdown.classList.remove('open'));

  dropdown.addEventListener('click', (e) => {
    const opt = e.target.closest('.view-option');
    if (!opt) return;
    const viewId = opt.dataset.view;
    if (!viewId || viewId === activeView) { dropdown.classList.remove('open'); return; }

    dropdown.querySelectorAll('.view-option').forEach(el => el.classList.remove('active'));
    opt.classList.add('active');
    activeView = viewId;
    label.textContent = viewId.toUpperCase();

    _sweepPeriodMs = (window.VIEW_REGISTRY[viewId] || {}).sweepRate || 5000;
    _sweepStartMs  = Date.now();

    selectedRef = null;
    selectedApt = null;
    updateRefDisplay();
    updateAptDisplay();
    updateViewUI();

    sendSelectView(viewId, {});
    dropdown.classList.remove('open');

    if (viewId === 'airport' || viewId === 'approach') {
      setTimeout(() => openAptDropdown(), 80);
    }
  });
}

// ── Reference selector ────────────────────────────────────────────────────

function populateRefDropdown($dd) {
  $dd.innerHTML = '';

  const noneEl = document.createElement('div');
  noneEl.className   = 'ref-option none-opt' + (!selectedRef ? ' active' : '');
  noneEl.dataset.ref = '';
  noneEl.textContent = 'NONE';
  $dd.appendChild(noneEl);

  // All airborne tracks; players first, then AI, sorted by callsign within each group
  const all     = [...tracks.values()].filter(t => t.category === 1 || t.category === 2);
  const players = all.filter(t =>  t.player).sort((a, b) => a.callsign.localeCompare(b.callsign));
  const ai      = all.filter(t => !t.player).sort((a, b) => a.callsign.localeCompare(b.callsign));

  if (all.length === 0) {
    const empty = document.createElement('div');
    empty.className   = 'ref-option disabled';
    empty.textContent = 'NO TRACKS';
    $dd.appendChild(empty);
    return;
  }

  const addTrack = (t) => {
    const el = document.createElement('div');
    el.className   = 'ref-option' + (selectedRef === t.id ? ' active' : '');
    el.dataset.ref = t.id;
    el.innerHTML   =
      `<span>${resolveCallsign(t)}${t.player ? ` <span class="ref-opt-badge">PLR</span>` : ''}</span>` +
      `<span class="ref-opt-type">${t.type || ''}</span>`;
    $dd.appendChild(el);
  };

  players.forEach(addTrack);
  ai.forEach(addTrack);
}

function initRefSelector() {
  const $dd = document.getElementById('ref-dropdown');

  $refDisplay.addEventListener('click', (e) => {
    e.stopPropagation();
    if ($dd.classList.contains('open')) { $dd.classList.remove('open'); return; }
    populateRefDropdown($dd);
    const rect = $refDisplay.getBoundingClientRect();
    $dd.style.left = rect.left + 'px';
    $dd.classList.add('open');
  });

  document.addEventListener('click', () => $dd.classList.remove('open'));

  $dd.addEventListener('click', (e) => {
    e.stopPropagation();
    const opt = e.target.closest('.ref-option');
    if (!opt || opt.classList.contains('disabled')) return;
    selectedRef = opt.dataset.ref || null; // empty string → null
    $dd.classList.remove('open');
    updateRefDisplay();
    updateMap();
  });
}

// ── Airport selector ──────────────────────────────────────────────────────

const HELIPAD_PATTERN = /helipad|farp|fob|H/i;

function populateAptDropdown($dd) {
  const $list  = document.getElementById('apt-list');
  const search = (document.getElementById('apt-search') || {}).value || '';
  const term   = search.trim().toLowerCase();
  $list.innerHTML = '';

  const airports = (missionData && missionData.airports) || [];
  const sorted   = [...airports]
    .filter(a => a.lat && a.lon && !HELIPAD_PATTERN.test(a.name))
    .sort((a, b) => (a.icao || a.name).localeCompare(b.icao || b.name))
    .filter(a => {
      if (!term) return true;
      return (a.icao  || '').toLowerCase().includes(term)
          || (a.name  || '').toLowerCase().includes(term);
    });

  if (sorted.length === 0) {
    const el = document.createElement('div');
    el.className   = 'apt-option';
    el.style.color = '#2a4a2a';
    el.textContent = term ? 'NO MATCH' : 'NO AIRPORTS';
    $list.appendChild(el);
    return;
  }

  for (const a of sorted) {
    const el       = document.createElement('div');
    const isActive = selectedApt && selectedApt.name === a.name;
    el.className   = 'apt-option' + (isActive ? ' active' : '');
    el.innerHTML   =
      `<span>${a.icao || a.name}</span>` +
      `<span class="apt-opt-name">${a.icao ? a.name : ''}</span>`;
    el.addEventListener('click', () => {
      selectedApt = a;
      $dd.classList.remove('open');
      updateAptDisplay();
      const view   = activeView === 'approach' ? 'approach' : 'airport';
      const params = { lat: a.lat, lon: a.lon, elev: a.elev || 0, name: a.name };
      if (activeView === 'approach' && approachRwyCourse != null) params.rwyCourse = approachRwyCourse;
      sendSelectView(view, params);
      updateMap();
    });
    $list.appendChild(el);
  }
}

function openAptDropdown() {
  const $dd     = document.getElementById('apt-dropdown');
  const $search = document.getElementById('apt-search');
  $search.value = '';
  populateAptDropdown($dd);
  const rect = $aptDisplay.getBoundingClientRect();
  $dd.style.left = rect.left + 'px';
  $dd.classList.add('open');
  // Focus search after transition settles
  setTimeout(() => $search.focus(), 30);
}

function initAptSelector() {
  const $dd     = document.getElementById('apt-dropdown');
  const $search = document.getElementById('apt-search');

  $aptDisplay.addEventListener('click', (e) => {
    e.stopPropagation();
    if ($dd.classList.contains('open')) { $dd.classList.remove('open'); return; }
    openAptDropdown();
  });
  document.addEventListener('click', () => $dd.classList.remove('open'));

  // Live search filtering — stop propagation so the document click doesn't close
  $search.addEventListener('input', () => populateAptDropdown($dd));
  $search.addEventListener('click', e => e.stopPropagation());
}

// ── Approach panel ────────────────────────────────────────────────────────

function updateApproachPanel() {
  const $tbl = document.getElementById('approach-ac-table');
  if (!$tbl) return;

  const players = [...tracks.values()]
    .filter(t => t.player && checkInRange(t))
    .sort((a, b) => resolveCallsign(a).localeCompare(resolveCallsign(b)));

  // Collect ids of currently rendered rows so we can add/remove incrementally
  const rendered = new Set([...$tbl.querySelectorAll('tr[data-id]')].map(r => r.dataset.id));
  const current  = new Set(players.map(t => t.id));

  // Remove rows for tracks no longer on scope
  for (const id of rendered) {
    if (!current.has(id)) $tbl.querySelector(`tr[data-id="${id}"]`)?.remove();
  }

  for (const t of players) {
    const cs  = resolveCallsign(t).slice(0, 7).padEnd(7);
    const alt = t.alt != null ? Math.round(t.alt / 0.3048 / 100) * 100 : '---';
    const sqwk = t.squawk || '----';

    if (rendered.has(t.id)) {
      // Update live fields only (not user-entered inputs)
      const row = $tbl.querySelector(`tr[data-id="${t.id}"]`);
      if (row) {
        row.querySelector('.app-col-cs').textContent  = cs;
        row.querySelector('.app-col-sqwk').textContent = sqwk;
        row.querySelector('.app-col-alt').textContent  = alt;
      }
      continue;
    }

    // Build new row
    if (!approachData.has(t.id)) approachData.set(t.id, { atis: false, app: '', ldg: '', wpt: '' });
    const d = approachData.get(t.id);

    const row = document.createElement('tr');
    row.dataset.id = t.id;

    function td(content, cls) {
      const cell = document.createElement('td');
      cell.className = cls || '';
      if (typeof content === 'string') cell.textContent = content;
      else cell.appendChild(content);
      return cell;
    }

    function makeInput(field, maxLen, placeholder) {
      const inp = document.createElement('input');
      inp.type        = 'text';
      inp.className   = 'app-inp';
      inp.value       = d[field];
      inp.maxLength   = maxLen;
      inp.placeholder = placeholder || '';
      inp.addEventListener('input',   () => { d[field] = inp.value.toUpperCase(); inp.value = d[field]; });
      inp.addEventListener('click',   e  => e.stopPropagation());
      inp.addEventListener('keydown', e  => { if (e.key === 'Escape') inp.blur(); });
      return inp;
    }

    // ATIS toggle cell
    const atisBtn = document.createElement('button');
    atisBtn.className   = 'app-atis-btn' + (d.atis ? ' on' : '');
    atisBtn.textContent = d.atis ? 'Y' : 'N';
    atisBtn.addEventListener('click', e => {
      e.stopPropagation();
      d.atis = !d.atis;
      atisBtn.textContent = d.atis ? 'Y' : 'N';
      atisBtn.classList.toggle('on', d.atis);
    });

    row.appendChild(td(cs,   'app-col-cs'));
    row.appendChild(td(sqwk, 'app-col-sqwk'));
    row.appendChild(td(String(alt), 'app-col-alt'));
    row.appendChild(td(atisBtn));
    row.appendChild(td(makeInput('app', 6, 'ILS')));
    row.appendChild(td(makeInput('ldg', 6, 'FULL')));
    row.appendChild(td(makeInput('wpt', 5, 'Romeo')));

    $tbl.appendChild(row);
  }
}

function initApproachPanel() {
  const $rwyInput = document.getElementById('rwy-input');
  if (!$rwyInput) return;

  $rwyInput.addEventListener('input', () => {
    const val = parseInt($rwyInput.value, 10);
    approachRwyCourse = (!isNaN(val) && val >= 0 && val <= 360) ? val % 360 : null;
    if (selectedApt && approachRwyCourse != null) {
      sendSelectView('approach', { lat: selectedApt.lat, lon: selectedApt.lon, elev: selectedApt.elev || 0, rwyCourse: approachRwyCourse });
    }
    updateMap();
  });
  $rwyInput.addEventListener('click', e => e.stopPropagation());
}

// ── Squawk → callsign mapping panel ──────────────────────────────────────

function renderSquawkMapList(listEl) {
  listEl.innerHTML = '';
  const map = settings.squawkMap || {};
  const keys = Object.keys(map).sort((a, b) => Number(a) - Number(b));
  if (keys.length === 0) {
    const empty = document.createElement('div');
    empty.className   = 'sqmap-empty';
    empty.textContent = 'No mappings defined.';
    listEl.appendChild(empty);
    return;
  }
  for (const code of keys) {
    const row = document.createElement('div');
    row.className = 'sqmap-row';
    row.innerHTML =
      `<span class="sqmap-code">${code}</span>` +
      `<span class="sqmap-arrow">→</span>` +
      `<span class="sqmap-name">${map[code]}</span>` +
      `<button class="sqmap-del" data-code="${code}">×</button>`;
    row.querySelector('.sqmap-del').addEventListener('click', () => {
      delete settings.squawkMap[code];
      saveSettings();
      renderSquawkMapList(listEl);
      updateMap();
    });
    listEl.appendChild(row);
  }
}

function initCallsPanel() {
  const btn   = document.getElementById('btn-calls');
  const panel = document.getElementById('calls-panel');
  const list  = document.getElementById('sqmap-list');
  const inp   = document.getElementById('sqmap-code-input');
  const inpN  = document.getElementById('sqmap-name-input');
  const addBtn = document.getElementById('sqmap-add');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel.classList.toggle('open');
    if (open) renderSquawkMapList(list);
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== btn) panel.classList.remove('open');
  });

  addBtn.addEventListener('click', () => {
    const code = inp.value.trim().replace(/\D/g, '');
    const name = inpN.value.trim().toUpperCase();
    if (!code || !name) return;
    if (!settings.squawkMap) settings.squawkMap = {};
    settings.squawkMap[code] = name;
    saveSettings();
    inp.value  = '';
    inpN.value = '';
    renderSquawkMapList(list);
    updateMap();
  });

  // Allow Enter key in inputs to trigger add
  [inp, inpN].forEach(el => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  }));
}
