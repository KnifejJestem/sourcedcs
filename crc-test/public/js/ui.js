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

// Update topbar visibility based on active radar types.
function updateTopbarUI() {
  const active  = getActiveRadars();
  const hasCrc  = active.some(r => r.type === 'awacs' || r.type === 'carrier');
  const $refSep = document.getElementById('ref-sep');
  const $aptSep = document.getElementById('apt-sep');
  const $rwySep = document.getElementById('rwy-sep');
  const $rwyRow = document.getElementById('rwy-row');

  $refDisplay.style.display = hasCrc ? '' : 'none';
  $refSep.style.display     = hasCrc ? '' : 'none';

  $aptDisplay.style.display = '';
  $aptSep.style.display     = '';

  const hasAptSel = !!selectedApt;
  $rwySep.style.display = hasAptSel ? '' : 'none';
  $rwyRow.style.display = hasAptSel ? '' : 'none';
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

const $noAwacsOver = document.getElementById('no-awacs-overlay');
function updateNoAwacsUI() {
  $noAwacsOver.classList.toggle('visible', !!noRadarsActive);
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
  const hdg    = (Math.round(bearingDeg(be.lat, be.lon, cursor.lat, cursor.lng)) + (settings.magVar || 0) + 360) % 360;

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
  const bearing = (Math.round(bearingDeg(lat1, lng1, lat2, lng2)) + (settings.magVar || 0) + 360) % 360;
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
    pplEnabled:     document.getElementById('set-ppl-enabled'),
    pplDuration:    document.getElementById('set-ppl-duration'),
    pplVal:         document.getElementById('set-ppl-val'),
    trailEn:        document.getElementById('set-trail-enabled'),
    trailLength:    document.getElementById('set-trail-length'),
    trailLenVal:    document.getElementById('set-trail-length-val'),
    trailInterval:  document.getElementById('set-trail-interval'),
    trailIntervalVal: document.getElementById('set-trail-interval-val'),
    fadeGrace:      document.getElementById('set-fade-grace'),
    fadeGraceVal:   document.getElementById('set-fade-grace-val'),
    aiEn:           document.getElementById('set-ai-enabled'),
    shipsEn:        document.getElementById('set-ships-enabled'),
    braColor:       document.getElementById('set-bra-color'),
    magVar:         document.getElementById('set-mag-var'),
    radarDebug:     document.getElementById('set-radar-debug'),
    navDeclutter:   document.getElementById('set-nav-declutter'),
    scale:          document.getElementById('set-scale'),
    scaleVal:       document.getElementById('set-scale-val'),
    lightMode:      document.getElementById('set-light-mode'),
  };

  els.pplEnabled.checked = settings.pplEnabled;
  els.pplDuration.value  = settings.pplDuration;
  els.pplVal.textContent = settings.pplDuration + 's';
  els.trailEn.checked           = settings.trailEnabled;
  els.trailLength.value         = settings.trailLength;
  els.trailLenVal.textContent   = settings.trailLength;
  els.trailInterval.value       = settings.trailIntervalMs ?? 5000;
  els.trailIntervalVal.textContent = ((settings.trailIntervalMs ?? 5000) / 1000).toFixed(0) + 's';
  els.fadeGrace.value           = settings.fadeGraceMs ?? 10000;
  els.fadeGraceVal.textContent  = ((settings.fadeGraceMs ?? 10000) / 1000).toFixed(1) + 's';
  els.aiEn.checked       = settings.aiEnabled;
  els.shipsEn.checked    = settings.shipsEnabled;
  els.braColor.value     = settings.braColor;
  els.magVar.value       = settings.magVar;
  els.scale.value        = settings.scale;
  els.scaleVal.textContent = parseFloat(settings.scale).toFixed(1) + '×';
  els.lightMode.checked  = settings.lightMode;
  els.radarDebug.checked   = settings.radarDebug;
  els.navDeclutter.checked = settings.navDeclutter ?? true;
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
  els.trailInterval.addEventListener('input', () => {
    settings.trailIntervalMs = parseInt(els.trailInterval.value);
    els.trailIntervalVal.textContent = (settings.trailIntervalMs / 1000).toFixed(0) + 's';
    history.clear(); // reset trail so old close-together dots are dropped
    saveSettings(); updateMap();
  });
  els.fadeGrace.addEventListener('input', () => {
    settings.fadeGraceMs = parseInt(els.fadeGrace.value);
    els.fadeGraceVal.textContent = (settings.fadeGraceMs / 1000).toFixed(1) + 's';
    saveSettings(); updateMap();
  });
  els.aiEn.addEventListener('change',    () => persist('aiEnabled',    els.aiEn.checked));
  els.shipsEn.addEventListener('change', () => persist('shipsEnabled', els.shipsEn.checked));
  els.braColor.addEventListener('input', () => persist('braColor', els.braColor.value));
  els.magVar.addEventListener('input', () => persist('magVar', parseInt(els.magVar.value) || 0));
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
  els.radarDebug.addEventListener('change',   () => persist('radarDebug',   els.radarDebug.checked));
  els.navDeclutter.addEventListener('change', () => {
    persist('navDeclutter', els.navDeclutter.checked);
    if (mapReady && missionData) map.getSource('navpoints').setData(buildNavpoints());
  });
}

function applyLightMode() {
  document.body.classList.toggle('light', !!settings.lightMode);
  applyMapTheme();
}

// ── Radar selection panel ─────────────────────────────────────────────────
// Groups all available radars by type; user can toggle each on/off.
// New radars auto-enabled (opt-out model); disabled IDs saved to localStorage.

const TYPE_ORDER  = ['airport', 'approach', 'awacs', 'carrier'];
const TYPE_LABELS = { airport: 'AIRPORT', approach: 'APPROACH', awacs: 'AWACS', carrier: 'CARRIER' };
const TYPE_RANGE_LABEL = (r) => {
  const nm = Math.round(r.rangeM / 1852);
  return `${nm}nm`;
};

function buildRadarPanelContent(filter) {
  const $groups = document.getElementById('radar-groups');
  if (!$groups) return;

  const term  = (filter || '').trim().toLowerCase();
  const all   = getAllRadars();
  const byType = {};
  for (const r of all) {
    if (term && !r.label.toLowerCase().includes(term) &&
        !(r.sublabel || '').toLowerCase().includes(term)) continue;
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r);
  }
  for (const g of Object.values(byType)) {
    g.sort((a, b) => a.label.localeCompare(b.label));
  }

  $groups.innerHTML = '';

  for (const type of TYPE_ORDER) {
    const group = byType[type];
    if (!group || group.length === 0) continue;

    const $heading = document.createElement('div');
    $heading.className = 'radar-group-heading';
    $heading.textContent = TYPE_LABELS[type] || type.toUpperCase();
    $groups.appendChild($heading);

    for (const r of group) {
      const enabled  = enabledRadarIds.has(r.id);
      const isGnd    = !!r.onGround;

      const $row = document.createElement('div');
      $row.className = 'radar-row' + (enabled && !isGnd ? '' : ' disabled');

      const $check = document.createElement('input');
      $check.type      = 'checkbox';
      $check.checked   = enabled;
      $check.className = 'radar-check';
      $check.addEventListener('change', (e) => {
        e.stopPropagation();
        if ($check.checked) enabledRadarIds.add(r.id);
        else                enabledRadarIds.delete(r.id);
        saveEnabledRadars();
        $row.classList.toggle('disabled', !$check.checked || isGnd);
        updateTopbarUI();
        resetSweepState();
        updateMap();
        updateZoomLimits();
      });

      const $label = document.createElement('span');
      $label.className = 'radar-row-label';
      $label.textContent = r.label;

      const $range = document.createElement('span');
      $range.className = 'radar-row-range';
      $range.textContent = TYPE_RANGE_LABEL(r) + (isGnd ? ' GND' : '');
      if (isGnd) $range.style.color = '#886633';

      $row.appendChild($check);
      $row.appendChild($label);
      $row.appendChild($range);
      $groups.appendChild($row);
    }
  }

  if ($groups.childElementCount === 0) {
    const $empty = document.createElement('div');
    $empty.className = 'radar-empty';
    $empty.textContent = term ? 'No match.' : 'No radar sources available.';
    $groups.appendChild($empty);
  }
}

// Updates the RADARS button badge (number of active radars)
function updateRadarBadge() {
  const $badge = document.getElementById('radar-count-badge');
  if (!$badge) return;
  const n = getActiveRadars().length;
  $badge.textContent = n;
}

function initRadarPanel() {
  const $btn    = document.getElementById('btn-radars');
  const $panel  = document.getElementById('radars-panel');
  const $search = document.getElementById('radar-search');
  if (!$btn || !$panel) return;

  $btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !$panel.classList.contains('open');
    $panel.classList.toggle('open');
    if (opening) {
      if ($search) { $search.value = ''; setTimeout(() => $search.focus(), 60); }
      buildRadarPanelContent('');
    }
  });
  document.addEventListener('click', (e) => {
    if (!$panel.contains(e.target) && e.target !== $btn) $panel.classList.remove('open');
  });

  if ($search) {
    $search.addEventListener('input', () => buildRadarPanelContent($search.value));
    $search.addEventListener('click', e => e.stopPropagation());
  }
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

const HELIPAD_PATTERN = /helipad|farp|fob/i;

function populateAptDropdown($dd) {
  const $list  = document.getElementById('apt-list');
  const search = (document.getElementById('apt-search') || {}).value || '';
  const term   = search.trim().toLowerCase();
  $list.innerHTML = '';

  const airports = (missionData && missionData.airports) || [];
  const sorted   = [...airports]
    .filter(a => a.lat && a.lon && a.name !== 'H' && !HELIPAD_PATTERN.test(a.name))
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
      updateTopbarUI();
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

// ── Approach vector (runway course input) ─────────────────────────────────

function initRwyInput() {
  const $rwyInput = document.getElementById('rwy-input');
  if (!$rwyInput) return;

  $rwyInput.addEventListener('input', () => {
    const val = parseInt($rwyInput.value, 10);
    approachRwyCourse = (!isNaN(val) && val >= 0 && val <= 360) ? val % 360 : null;
    updateMap();
  });
  $rwyInput.addEventListener('click', e => e.stopPropagation());
}

// ── Squawk → callsign mapping panel ──────────────────────────────────────

function renderSquawkMapList(listEl, inp, inpN, seqToggle) {
  listEl.innerHTML = '';

  const exact = settings.squawkMap || {};
  const seq   = settings.squawkSeq || {};
  const allKeys  = Object.keys(exact).sort((a, b) => Number(a) - Number(b));
  const seqKeys  = Object.keys(seq).sort((a, b) => Number(a) - Number(b));

  if (allKeys.length === 0 && seqKeys.length === 0) {
    const empty = document.createElement('div');
    empty.className   = 'sqmap-empty';
    empty.textContent = 'No mappings defined.';
    listEl.appendChild(empty);
    return;
  }

  const makeRow = (code, displayName, isSeq) => {
    const row = document.createElement('div');
    row.className = 'sqmap-row';
    row.innerHTML =
      `<span class="sqmap-code">${code}</span>` +
      `<span class="sqmap-arrow">${isSeq ? '⇒' : '→'}</span>` +
      `<span class="sqmap-name">${displayName}${isSeq ? '<span class="sqmap-seq-badge"> SEQ</span>' : ''}</span>` +
      `<button class="sqmap-edit" data-code="${code}" data-seq="${isSeq}">✎</button>` +
      `<button class="sqmap-del"  data-code="${code}" data-seq="${isSeq}">×</button>`;

    row.querySelector('.sqmap-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSeq) delete settings.squawkSeq[code];
      else       delete settings.squawkMap[code];
      saveSettings();
      renderSquawkMapList(listEl, inp, inpN, seqToggle);
      updateMap();
    });

    row.querySelector('.sqmap-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      if (inp && inpN) {
        inp.value  = code;
        inpN.value = isSeq ? seq[code] : exact[code];
        if (seqToggle) seqToggle.checked = isSeq;
        inp.focus();
      }
      if (isSeq) delete settings.squawkSeq[code];
      else       delete settings.squawkMap[code];
      saveSettings();
      renderSquawkMapList(listEl, inp, inpN, seqToggle);
      updateMap();
    });

    return row;
  };

  for (const code of allKeys) listEl.appendChild(makeRow(code, exact[code], false));
  for (const code of seqKeys)  listEl.appendChild(makeRow(code, seq[code],  true));
}

function initCallsPanel() {
  const btn      = document.getElementById('btn-calls');
  const panel    = document.getElementById('calls-panel');
  const list     = document.getElementById('sqmap-list');
  const inp      = document.getElementById('sqmap-code-input');
  const inpN     = document.getElementById('sqmap-name-input');
  const addBtn   = document.getElementById('sqmap-add');
  const seqToggle = document.getElementById('sqmap-seq-toggle');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel.classList.toggle('open');
    if (open) renderSquawkMapList(list, inp, inpN, seqToggle);
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== btn) panel.classList.remove('open');
  });

  addBtn.addEventListener('click', () => {
    const raw  = inp.value.trim().replace(/\D/g, '');
    const code = String(Number(raw)); // normalise: "7700" → "7700", "07700" → "7700"
    const name = inpN.value.trim().toUpperCase();
    if (!code || code === 'NaN' || !name) return;

    if (seqToggle && seqToggle.checked) {
      if (!settings.squawkSeq) settings.squawkSeq = {};
      settings.squawkSeq[code] = name;
    } else {
      if (!settings.squawkMap) settings.squawkMap = {};
      settings.squawkMap[code] = name;
    }
    saveSettings();
    inp.value  = '';
    inpN.value = '';
    renderSquawkMapList(list, inp, inpN, seqToggle);
    updateMap();
  });

  // Allow Enter key in inputs to trigger add
  [inp, inpN].forEach(el => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  }));
}

// ── Ground vehicle label popup ────────────────────────────────────────────
// Left-clicking a ground vehicle icon opens a small floating input so the
// controller can assign a custom label.  The popup is dismissed on Enter,
// Escape, or clicking outside.

function showGroundLabelPopup(id, clientX, clientY) {
  const popup = document.getElementById('gnd-label-popup');
  const input = document.getElementById('gnd-label-input');
  if (!popup || !input) return;

  // Pre-fill with any existing label for this vehicle
  input.value = groundLabels.get(id) || '';

  // Position near the click, keeping it inside the viewport
  const popW = 160, popH = 36;
  let left = clientX + 10;
  let top  = clientY + 10;
  if (left + popW > window.innerWidth)  left = clientX - popW - 4;
  if (top  + popH > window.innerHeight) top  = clientY - popH - 4;

  popup.style.left    = left + 'px';
  popup.style.top     = top  + 'px';
  popup.style.display = 'block';
  input.focus();
  input.select();

  function commit() {
    const label = input.value.trim().toUpperCase();
    if (label) groundLabels.set(id, label);
    else       groundLabels.delete(id);
    close();
    updateMap();
  }

  function close() {
    popup.style.display = 'none';
    input.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onOutside, true);
  }

  function onKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { close(); }
  }

  function onOutside(e) {
    if (!popup.contains(e.target)) close();
  }

  input.addEventListener('keydown', onKey);
  // Delay attaching the outside-click listener so the current click event
  // that triggered the popup doesn't immediately dismiss it.
  setTimeout(() => document.addEventListener('click', onOutside, true), 0);
}
