'use strict';

// ── Topbar display elements ────────────────────────────────────────────────

const $aptDisplay = document.getElementById('apt-display');

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
  const $aptSep = document.getElementById('apt-sep');
  const $rwySep = document.getElementById('rwy-sep');
  const $rwyRow = document.getElementById('rwy-row');

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

  // ── Tab switching ─────────────────────────────────────────────────────
  panel.querySelectorAll('.stab').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
      panel.querySelectorAll('.stab-pane').forEach(p => { p.style.display = 'none'; });
      btn.classList.add('active');
      document.getElementById('stab-' + btn.dataset.pane).style.display = '';
    });
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
    magVar:         document.getElementById('set-mag-var'),
    radarDebug:     document.getElementById('set-radar-debug'),
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
  els.magVar.value       = settings.magVar;
  els.scale.value        = settings.scale;
  els.scaleVal.textContent = parseFloat(settings.scale).toFixed(1) + '×';
  els.lightMode.checked  = settings.lightMode;
  els.radarDebug.checked   = settings.radarDebug;
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

  // ── Colours tab ───────────────────────────────────────────────────────
  initColorSettings();
}

function initColorSettings() {
  // Each entry: [inputId, swatchId, settingsKey, defaultColor]
  const COLOR_DEFS = [
    ['col-friendly',    'sw-friendly',    'colFriendly',    '#4488cc'],
    ['col-bogey',       'sw-bogey',       'colBogey',       '#ccaa00'],
    ['col-neutral',     'sw-neutral',     'colNeutral',     '#888888'],
    ['col-bandit',      'sw-bandit',      'colBandit',      '#cc6600'],
    ['col-hostile',     'sw-hostile',     'colHostile',     '#cc2222'],
    ['col-emerg-gen',   'sw-emerg-gen',   'colEmergGen',    '#cc2222'],
    ['col-emerg-radio', 'sw-emerg-radio', 'colEmergRadio',  '#b8a000'],
    ['col-emerg-hijack','sw-emerg-hijack','colEmergHijack', '#cc6600'],
    ['col-bra',         'sw-bra',         'braColor',       '#4488cc'],
    ['col-range-ring',  'sw-range-ring',  'colRangeRing',   '#8aaa6a'],
    ['col-navpoint',    'sw-navpoint',    'colNavpoint',    '#3a5a3a'],
  ];

  for (const [inputId, swatchId, key, def] of COLOR_DEFS) {
    const inp    = document.getElementById(inputId);
    const swatch = document.getElementById(swatchId);
    if (!inp) continue;

    // Initialise input and swatch from current settings
    const cur = settings[key] || def;
    inp.value = cur;
    if (swatch) swatch.style.background = cur;

    inp.addEventListener('input', () => {
      settings[key] = inp.value;
      if (swatch) swatch.style.background = inp.value;
      saveSettings();
      // BRA cursor: update CSS color directly
      if (key === 'braColor') {
        const $bra = document.getElementById('cursor-bra');
        if ($bra) $bra.style.color = inp.value;
        updateMap();
        return;
      }
      applyColors();
    });
  }

  // Reset buttons — restore default, persist, refresh
  document.querySelectorAll('.col-reset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const def = btn.dataset.default;
      settings[key] = def;
      saveSettings();
      // Sync the matching input and swatch
      const def2 = COLOR_DEFS.find(d => d[2] === key);
      if (def2) {
        const inp    = document.getElementById(def2[0]);
        const swatch = document.getElementById(def2[1]);
        if (inp)    inp.value = def;
        if (swatch) swatch.style.background = def;
      }
      if (key === 'braColor') {
        const $bra = document.getElementById('cursor-bra');
        if ($bra) $bra.style.color = def;
        updateMap();
      } else {
        applyColors();
      }
    });
  });

  // ── Declutter tab ─────────────────────────────────────────────────────
  const $declutter  = document.getElementById('set-declutter');
  const $navDecl    = document.getElementById('set-nav-declutter');
  const $navDecl5   = document.getElementById('set-nav-declutter-5');
  const $aiEn       = document.getElementById('set-ai-enabled');
  const $shipsEn    = document.getElementById('set-ships-enabled');

  if ($declutter) {
    $declutter.checked = settings.declutter ?? true;
    $declutter.addEventListener('change', () => {
      settings.declutter = $declutter.checked;
      saveSettings();
      updateMap();
    });
  }

  if ($navDecl) {
    $navDecl.checked = settings.navDeclutter ?? true;
    $navDecl.addEventListener('change', () => {
      settings.navDeclutter = $navDecl.checked;
      saveSettings();
      if (mapReady && missionData) map.getSource('navpoints').setData(buildNavpoints());
    });
  }

  if ($navDecl5) {
    $navDecl5.checked = settings.navDeclutter5 ?? true;
    $navDecl5.addEventListener('change', () => {
      settings.navDeclutter5 = $navDecl5.checked;
      saveSettings();
      if (mapReady && missionData) map.getSource('navpoints').setData(buildNavpoints());
    });
  }

  if ($aiEn) {
    $aiEn.checked = settings.aiEnabled;
    $aiEn.addEventListener('change', () => { settings.aiEnabled = $aiEn.checked; saveSettings(); updateMap(); });
  }

  if ($shipsEn) {
    $shipsEn.checked = settings.shipsEnabled;
    $shipsEn.addEventListener('change', () => { settings.shipsEnabled = $shipsEn.checked; saveSettings(); updateMap(); });
  }
}

function applyLightMode() {
  document.body.classList.toggle('light', !!settings.lightMode);
  applyMapTheme();
}

// ── Radar selection panel ─────────────────────────────────────────────────
// Groups all available radars by type; user can toggle each on/off.
// New radars auto-enabled (opt-out model); disabled IDs saved to localStorage.

const TYPE_ORDER  = ['airport', 'approach', 'awacs', 'fighter', 'carrier'];
const TYPE_LABELS = { airport: 'AIRPORT', approach: 'APPROACH', awacs: 'AWACS', fighter: 'FIGHTER', carrier: 'CARRIER' };
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
  const $btn      = document.getElementById('btn-radars');
  const $panel    = document.getElementById('radars-panel');
  const $search   = document.getElementById('radar-search');
  const $dlToggle = document.getElementById('datalink-toggle');
  const $dlRow    = document.getElementById('datalink-row');
  if (!$btn || !$panel) return;

  // Initialise datalink toggle
  if ($dlToggle) {
    $dlToggle.checked = settings.datalink ?? false;
    if ($dlRow) $dlRow.classList.toggle('active', !!settings.datalink);
    $dlToggle.addEventListener('change', () => {
      settings.datalink = $dlToggle.checked;
      if ($dlRow) $dlRow.classList.toggle('active', $dlToggle.checked);
      saveSettings();
      updateTopbarUI();
      resetSweepState();
      updateMap();
      updateZoomLimits();
    });
  }

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
    _repositionTrackPanel();
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== btn) {
      panel.classList.remove('open');
      _repositionTrackPanel();
    }
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

// ── Track info panel ─────────────────────────────────────────────────────
// Left-clicking an aircraft track opens this persistent side panel.
// It shows live properties and integrates IFF + callsign override controls.

let _trackPanelId = null; // currently displayed track id (string), or null

function initTrackPanel() {
  const $panel   = document.getElementById('track-panel');
  const $calls   = document.getElementById('calls-panel');
  if (!$panel) return;

  // Close button
  document.getElementById('tp-close').addEventListener('click', () => closeTrackPanel());

  // IFF buttons
  const iffColors = () => ({
    friendly: settings.colFriendly || '#4488cc',
    bogey:    settings.colBogey    || '#ccaa00',
    neutral:  settings.colNeutral  || '#888888',
    bandit:   settings.colBandit   || '#cc6600',
    hostile:  settings.colHostile  || '#cc2222',
  });

  $panel.querySelectorAll('.tp-iff-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_trackPanelId == null) return;
      setIffOverride(_trackPanelId, btn.dataset.state);
      _refreshIffButtons();
      updateMap();
    });
  });

  document.getElementById('tp-iff-clr').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_trackPanelId == null) return;
    clearIffOverride(_trackPanelId);
    _refreshIffButtons();
    updateMap();
  });

  // Rename controls
  const $renameInput = document.getElementById('tp-rename-input');
  const commitRename = () => {
    if (_trackPanelId == null) return;
    setTrackRename(_trackPanelId, $renameInput.value);
    updateMap();
    _refreshCallsign();
  };
  document.getElementById('tp-rename-set').addEventListener('click', (e) => {
    e.stopPropagation(); commitRename();
  });
  document.getElementById('tp-rename-clr').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_trackPanelId == null) return;
    clearTrackRename(_trackPanelId);
    $renameInput.value = '';
    updateMap();
    _refreshCallsign();
  });
  $renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { closeTrackPanel(); }
  });
  $renameInput.addEventListener('click', e => e.stopPropagation());

  // Reposition when calls-panel transitions open/closed
  if ($calls) {
    const reposition = () => _repositionTrackPanel();
    $calls.addEventListener('transitionend', reposition);
    // Also watch toggle via MutationObserver for class changes
    new MutationObserver(reposition).observe($calls, { attributes: true, attributeFilter: ['class'] });
  }

  function _refreshIffButtons() {
    const cols     = iffColors();
    const override = iffOverrides.get(String(_trackPanelId));
    $panel.querySelectorAll('.tp-iff-btn').forEach(btn => {
      const col = cols[btn.dataset.state] || '#888888';
      btn.style.color       = col;
      btn.style.borderColor = col + '55';
      btn.classList.toggle('iff-active', btn.dataset.state === override);
    });
    // also update the iff state badge
    if (_trackPanelId != null) {
      const t = tracks.get(String(_trackPanelId));
      if (t) _refreshIffState(t);
    }
  }

  function _refreshCallsign() {
    if (_trackPanelId == null) return;
    const t = tracks.get(String(_trackPanelId));
    if (t) document.getElementById('tp-callsign').textContent = resolveCallsign(t);
  }

  // Expose so updateTrackPanel can call them
  initTrackPanel._refreshIffButtons = _refreshIffButtons;
}

function _refreshIffState(t) {
  const state  = getIff(t);
  const col    = iffColor(state);
  const $badge = document.getElementById('tp-iff-state');
  if (!$badge) return;
  $badge.innerHTML = '';
  const span = document.createElement('span');
  span.className   = 'tp-iff-state';
  span.textContent = state.toUpperCase();
  span.style.color       = col;
  span.style.borderColor = col + '55';
  $badge.appendChild(span);
}

function _repositionTrackPanel() {
  const $panel = document.getElementById('track-panel');
  const $calls = document.getElementById('calls-panel');
  if (!$panel) return;
  if ($calls && $calls.classList.contains('open')) {
    $panel.style.top = (32 + $calls.offsetHeight) + 'px';
  } else {
    $panel.style.top = '32px';
  }
}

function showTrackPanel(id) {
  const $panel = document.getElementById('track-panel');
  if (!$panel) return;
  _trackPanelId = String(id);
  _repositionTrackPanel();
  $panel.classList.add('open');
  updateTrackPanel();
}

function closeTrackPanel() {
  const $panel = document.getElementById('track-panel');
  if ($panel) $panel.classList.remove('open');
  _trackPanelId = null;
}

function updateTrackPanel() {
  if (_trackPanelId == null) return;
  const t = tracks.get(_trackPanelId);
  if (!t) return; // track faded out — leave panel open with last values

  const hist     = history.get(_trackPanelId) || [];
  const { heading, speedKt } = kinematics(hist);
  const fpm      = verticalFpm(hist);
  const altFt    = Math.round((t.alt || 0) * 3.281);
  const fl       = Math.round(altFt / 100);
  const spec     = aircraftTypes && aircraftTypes[t.type];

  // Header
  document.getElementById('tp-callsign').textContent = resolveCallsign(t);
  document.getElementById('tp-type').textContent     = (spec && spec.label) || t.type || '';

  // Properties
  document.getElementById('tp-alt').textContent  =
    `FL${String(fl).padStart(3,'0')}  (${altFt.toLocaleString()} ft)`;
  const vsSign = fpm >  50 ? '+' : fpm < -50 ? '' : '±';
  document.getElementById('tp-vs').textContent   =
    Math.abs(fpm) < 50 ? 'level' : `${vsSign}${Math.round(fpm)} fpm`;
  document.getElementById('tp-hdg').textContent  =
    `${String(Math.round(heading)).padStart(3,'0')}°`;
  document.getElementById('tp-spd').textContent  =
    `${Math.round(speedKt)} kt`;
  document.getElementById('tp-sqwk').textContent =
    t.squawk != null ? String(t.squawk).padStart(4,'0') : '—';

  // IFF state badge
  _refreshIffState(t);

  // IFF buttons
  if (initTrackPanel._refreshIffButtons) initTrackPanel._refreshIffButtons();

  // Rename input (only pre-fill if it's not focused)
  const $ri = document.getElementById('tp-rename-input');
  if ($ri && document.activeElement !== $ri) {
    $ri.value = trackRenames.get(_trackPanelId) || '';
  }
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
