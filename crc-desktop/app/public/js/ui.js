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
  const bulls = getBullseye();
  const be = bulls.blue || bulls.red;
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
  const label   = `${bearing.toString().padStart(3,'0')} / ${distNm.toString().padStart(3,'0')}`;
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

  // ── Bullseye override ────────────────────────────────────────────────
  initBullseyeSettings();

  // ── Colours tab ───────────────────────────────────────────────────────
  initColorSettings();

  // ── Tools tab ─────────────────────────────────────────────────────────
  initToolsTab();
}

// ── Bullseye pick-on-map mode ────────────────────────────────────────────
// bullseyePickTarget (declared in app.js) holds 'blue' | 'red' | null while
// waiting for the next map click to set that side's override position.

const $pickBanner = document.getElementById('pick-banner');

function startBullseyePick(side) {
  bullseyePickTarget = side;
  document.querySelectorAll('[id^="set-be-"][id$="-pick"]').forEach(b => b.classList.remove('active-pick'));
  const $btn = document.getElementById(`set-be-${side}-pick`);
  if ($btn) { $btn.textContent = 'CLICK MAP…'; $btn.classList.add('active-pick'); }
  if ($pickBanner) {
    $pickBanner.textContent = `CLICK MAP TO SET ${side.toUpperCase()} BULLSEYE — ESC TO CANCEL`;
    $pickBanner.classList.add('visible');
  }
  // Close the panel so the map underneath is clickable.
  document.getElementById('settings-panel').classList.remove('open');
}

function cancelBullseyePick() {
  bullseyePickTarget = null;
  document.querySelectorAll('[id^="set-be-"][id$="-pick"]').forEach(b => {
    b.textContent = 'PICK ON MAP';
    b.classList.remove('active-pick');
  });
  if ($pickBanner) $pickBanner.classList.remove('visible');
}

// Called from map-setup.js when a map click lands while pick mode is active.
function applyBullseyePick(side, lat, lon) {
  settings.bullseyeOverride[side].enabled = true;
  settings.bullseyeOverride[side].lat = lat;
  settings.bullseyeOverride[side].lon = lon;
  const $en  = document.getElementById(`set-be-${side}-enabled`);
  const $lat = document.getElementById(`set-be-${side}-lat`);
  const $lon = document.getElementById(`set-be-${side}-lon`);
  if ($en)  $en.checked = true;
  if ($lat) $lat.value  = lat.toFixed(4);
  if ($lon) $lon.value  = lon.toFixed(4);
  saveSettings();
  if (mapReady) map.getSource('bullseye').setData(buildBullseye());
  cancelBullseyePick();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bullseyePickTarget) cancelBullseyePick();
});

// Manual per-coalition bullseye position override, editable from the
// settings panel. Falls back to the live mission bullseye when disabled.
function initBullseyeSettings() {
  for (const side of ['blue', 'red']) {
    const $en   = document.getElementById(`set-be-${side}-enabled`);
    const $lat  = document.getElementById(`set-be-${side}-lat`);
    const $lon  = document.getElementById(`set-be-${side}-lon`);
    const $use  = document.getElementById(`set-be-${side}-use-mission`);
    const $pick = document.getElementById(`set-be-${side}-pick`);
    if (!$en || !$lat || !$lon) continue;

    const ov = settings.bullseyeOverride[side];
    $en.checked = !!ov.enabled;
    $lat.value  = ov.lat  ?? '';
    $lon.value  = ov.lon  ?? '';

    const refreshBullseye = () => {
      saveSettings();
      if (mapReady) map.getSource('bullseye').setData(buildBullseye());
    };

    $en.addEventListener('change', () => {
      settings.bullseyeOverride[side].enabled = $en.checked;
      refreshBullseye();
    });
    $lat.addEventListener('input', () => {
      settings.bullseyeOverride[side].lat = $lat.value === '' ? null : parseFloat($lat.value);
      refreshBullseye();
    });
    $lon.addEventListener('input', () => {
      settings.bullseyeOverride[side].lon = $lon.value === '' ? null : parseFloat($lon.value);
      refreshBullseye();
    });

    if ($use) {
      $use.addEventListener('click', () => {
        const base = missionData && missionData.bullseye && missionData.bullseye[side];
        if (!base) return;
        $lat.value = base.lat;
        $lon.value = base.lon;
        settings.bullseyeOverride[side].lat = base.lat;
        settings.bullseyeOverride[side].lon = base.lon;
        refreshBullseye();
      });
    }

    if ($pick) {
      $pick.addEventListener('click', () => {
        if (bullseyePickTarget === side) { cancelBullseyePick(); return; }
        startBullseyePick(side);
      });
    }
  }
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
  const $aiEn            = document.getElementById('set-ai-enabled');
  const $shipsEn         = document.getElementById('set-ships-enabled');
  const $hideGroundUnits = document.getElementById('set-hide-ground-units');

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

  if ($hideGroundUnits) {
    $hideGroundUnits.checked = settings.hideGroundUnits ?? false;
    $hideGroundUnits.addEventListener('change', () => { settings.hideGroundUnits = $hideGroundUnits.checked; saveSettings(); updateMap(); });
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
  _trackPanelId    = null;
  _fplFetchCallsign = null;
  const $fplSec = document.getElementById('tp-fpl-section');
  if ($fplSec) $fplSec.style.display = 'none';
}

// Fetch and display the flight plan for the resolved callsign of the current track.
// Aborts silently if the panel is closed or a newer fetch has started.
let _fplFetchCallsign = null;

function _refreshTrackFpl(callsign) {
  const $section = document.getElementById('tp-fpl-section');
  const $msg     = document.getElementById('tp-fpl-msg');
  if (!$section || !$msg) return;

  if (!callsign) {
    $section.style.display = 'none';
    return;
  }

  _fplFetchCallsign = callsign;
  fetch('/api/fpl/' + encodeURIComponent(callsign))
    .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
    .then(({ ok, body }) => {
      if (_fplFetchCallsign !== callsign) return; // stale
      if (!ok || !body.fplMessage) {
        $section.style.display = 'none';
        return;
      }
      $msg.textContent       = body.fplMessage;
      $section.style.display = 'block';
    })
    .catch(() => {
      if (_fplFetchCallsign !== callsign) return;
      $section.style.display = 'none';
    });
}

function updateTrackPanel() {
  if (_trackPanelId == null) return;
  const t = tracks.get(_trackPanelId);
  if (!t) return; // track faded out — leave panel open with last values

  const hist     = history.get(_trackPanelId) || [];
  const { heading, speedKt } = kinematics(hist);
  const fpm      = verticalFpm(hist);
  const altFt    = Math.round(indicatedAltFt(t.alt || 0));
  const fl       = Math.round(altFt / 100);
  const spec     = aircraftTypes && aircraftTypes[t.type];

  // Header
  const cs = resolveCallsign(t);
  document.getElementById('tp-callsign').textContent = cs;
  document.getElementById('tp-type').textContent     = (spec && spec.label) || t.type || '';

  // Properties
  const taFt = settings.transitionAltFt ?? 18000;
  document.getElementById('tp-alt').textContent  = altFt >= taFt
    ? `FL${String(fl).padStart(3,'0')}`
    : altFt.toLocaleString();
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

  // Flight plan (fetched once per callsign change; compare uppercase to avoid case-drift stalls)
  if ((cs || '').toUpperCase() !== (_fplFetchCallsign || '').toUpperCase()) _refreshTrackFpl(cs);
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

// ── Tools tab: altitude calculator ────────────────────────────────────────

function initToolsTab() {
  const btnCalc = document.getElementById('tool-alt-calc');
  const result  = document.getElementById('tool-alt-result');

  // DCS altimeter constants (must mirror app.js)
  const _L = 0.0065, _G = 9.80665, _R = 287.05287;
  const _EXP = _G / (_R * _L);
  const _INV = (_R * _L) / _G;
  const _H_TROP = 11000.0;
  const _T_REF  = 288.97;
  const INHG_TO_PA = 3386.389;
  const FT_TO_M = 0.3048;

  function pressureAtAlt(zM, seaPa, T0) {
    if (zM <= _H_TROP) return seaPa * Math.pow(1 - _L * zM / T0, _EXP);
    const T_trop = T0 - _L * _H_TROP;
    const P_trop = seaPa * Math.pow(1 - _L * _H_TROP / T0, _EXP);
    return P_trop * Math.exp(-_G * (zM - _H_TROP) / (_R * T_trop));
  }

  // api altitude (ft) -> indicated altitude (ft) for given conditions
  function apiToIndicated(apiFt, seaPa, T0) {
    const P = pressureAtAlt(apiFt * FT_TO_M, seaPa, T0);
    return ((_T_REF / _L) * (1 - Math.pow(P / seaPa, _INV))) / FT_TO_M;
  }

  // bisect to find api altitude that yields the desired indicated altitude
  function indicatedToApi(indFt, seaPa, T0) {
    let lo = indFt - Math.max(2000, Math.abs(indFt) * 0.5);
    let hi = indFt + Math.max(2000, Math.abs(indFt) * 0.5);
    let fLo = apiToIndicated(lo, seaPa, T0) - indFt;
    let fHi = apiToIndicated(hi, seaPa, T0) - indFt;
    for (let i = 0; i < 20 && fLo * fHi > 0; i++) {
      lo -= 5000; hi += 5000;
      fLo = apiToIndicated(lo, seaPa, T0) - indFt;
      fHi = apiToIndicated(hi, seaPa, T0) - indFt;
    }
    for (let i = 0; i < 100; i++) {
      const mid = 0.5 * (lo + hi);
      const fMid = apiToIndicated(mid, seaPa, T0) - indFt;
      if (Math.abs(fMid) < 0.001) return mid;
      if (fLo * fMid <= 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
    }
    return 0.5 * (lo + hi);
  }

  function calculate() {
    const tempC = parseFloat(document.getElementById('tool-alt-temp').value);
    const qnhInhg = parseFloat(document.getElementById('tool-alt-qnh').value);
    const indFt = parseFloat(document.getElementById('tool-alt-ind').value);
    if (isNaN(tempC) || isNaN(qnhInhg) || isNaN(indFt)) {
      result.textContent = 'ERR';
      return;
    }
    const T0 = tempC + 273.15;
    const seaPa = qnhInhg * INHG_TO_PA;
    const apiFt = indicatedToApi(indFt, seaPa, T0);
    result.textContent = Math.round(apiFt).toLocaleString() + ' ft';
  }

  btnCalc.addEventListener('click', calculate);
  document.getElementById('tool-alt-ind').addEventListener('keydown', e => {
    if (e.key === 'Enter') calculate();
  });
}

// ── Airport weather panel ─────────────────────────────────────────────────
// Shown when the user left-clicks an airport label on the map.

function showAptWeatherPanel(label, lat, lon, elevM, clientX, clientY) {
  const panel = document.getElementById('apt-weather-panel');
  if (!panel) return;

  panel.innerHTML =
    `<div class="awp-header"><span class="awp-label">${label}</span>` +
    `<button class="awp-close" id="awp-close">✕</button></div>` +
    `<div class="awp-body" id="awp-body"><div class="awp-loading">FETCHING…</div></div>`;

  // Position near click, keep inside viewport
  const W = 170, H = 120;
  let left = clientX + 12;
  let top  = clientY + 12;
  if (left + W > window.innerWidth)  left = clientX - W - 4;
  if (top  + H > window.innerHeight) top  = clientY - H - 4;
  panel.style.left    = left + 'px';
  panel.style.top     = top  + 'px';
  panel.style.display = 'block';

  document.getElementById('awp-close').addEventListener('click', closeAptWeatherPanel);

  fetch(`/api/apt-weather?lat=${lat}&lon=${lon}&alt=${elevM}`)
    .then(r => r.json())
    .then(d => {
      const body = document.getElementById('awp-body');
      if (!body) return;
      if (d.error) {
        body.innerHTML = `<div class="awp-err">${d.error}</div>`;
        return;
      }
      const inhg  = (d.pressureHpa / 33.8639).toFixed(2);
      const windDir = String(d.windFrom).padStart(3, '0');
      body.innerHTML =
        `<div class="awp-row"><span class="awp-k">QNH</span><span class="awp-v">${d.pressureHpa} hPa / ${inhg} inHg</span></div>` +
        `<div class="awp-row"><span class="awp-k">TEMP</span><span class="awp-v">${d.tempC}°C</span></div>` +
        `<div class="awp-row"><span class="awp-k">WIND</span><span class="awp-v">${windDir}° @ ${d.windKt} kt</span></div>`;
    })
    .catch(() => {
      const body = document.getElementById('awp-body');
      if (body) body.innerHTML = '<div class="awp-err">UNAVAILABLE</div>';
    });
}

function closeAptWeatherPanel() {
  const panel = document.getElementById('apt-weather-panel');
  if (panel) panel.style.display = 'none';
}

// ── Zulu clock (DCS in-game time) ─────────────────────────────────────────
// Server pushes GetScenarioCurrentTime every 5 s as an ISO 8601 string.
// We anchor that to a local timestamp and advance the display in real-time
// between server updates.

let _gameTimeBaseMs  = null; // real Date.now() when the anchor was set
let _gameTimeBaseSec = null; // game seconds-of-day at the anchor

function updateGameTime(isoDatetime) {
  // Parse HH:MM:SS directly from the ISO string — avoids browser local/UTC
  // ambiguity with Date(). DCS returns theater local time, not UTC.
  const m = isoDatetime.match(/T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return;
  _gameTimeBaseMs  = Date.now();
  _gameTimeBaseSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
}

function initZuluClock() {
  const $el = document.getElementById('zulu-clock');
  if (!$el) return;
  setInterval(() => {
    if (_gameTimeBaseSec === null) {
      $el.textContent = '--:--:--Z';
      return;
    }
    const elapsed    = Math.floor((Date.now() - _gameTimeBaseMs) / 1000);
    const offsetSec  = (settings.gameTimeOffset || 0) * 3600;
    const total      = ((_gameTimeBaseSec + elapsed - offsetSec) % 86400 + 86400) % 86400;
    const hh = String(Math.floor(total / 3600)).padStart(2, '0');
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    $el.textContent = `${hh}:${mm}:${ss}Z`;
  }, 1000);
}

// ── APRT / Theater side panel ─────────────────────────────────────────────

let _aprtSelectedApt = null;

function _updateAprtRefCard() {
  const $card = document.getElementById('aprt-ref-card');
  if (!$card) return;

  const apt = _aprtSelectedApt;
  if (!apt) { $card.style.display = 'none'; return; }
  $card.style.display = 'block';

  const wx       = _aprtLastFetchedWx;
  const key      = apt.icao || apt.name;
  const manualWx = (settings.aprtManualWx && settings.aprtManualWx[key]) || {};

  // Header
  document.getElementById('aprt-ref-name').textContent = apt.name || apt.icao;
  const $icaoBadge = document.getElementById('aprt-ref-icao');
  if ($icaoBadge) $icaoBadge.textContent = (apt.icao && apt.name) ? apt.icao : '';

  // Weather (from gRPC)
  const $wind = document.getElementById('aprt-ref-wind');
  const $qnh  = document.getElementById('aprt-ref-qnh');
  const $temp = document.getElementById('aprt-ref-temp');
  if (wx) {
    const windDir = String(wx.windFrom).padStart(3, '0');
    const inhg    = (wx.pressureHpa / 33.8639).toFixed(2);
    if ($wind) { $wind.textContent = `${windDir}° @ ${wx.windKt} kt`; $wind.className = 'aprt-ref-v'; }
    if ($qnh)  { $qnh.textContent  = `${wx.pressureHpa} hPa  /  ${inhg} inHg`; $qnh.className = 'aprt-ref-v'; }
    if ($temp) { $temp.textContent = `${wx.tempC > 0 ? '+' : ''}${wx.tempC}°C`; $temp.className = 'aprt-ref-v'; }
  } else {
    if ($wind) { $wind.textContent = '—'; $wind.className = 'aprt-ref-v dim'; }
    if ($qnh)  { $qnh.textContent  = '—'; $qnh.className  = 'aprt-ref-v dim'; }
    if ($temp) { $temp.textContent = '—'; $temp.className = 'aprt-ref-v dim'; }
  }

  // VIS (manual)
  const $vis = document.getElementById('aprt-ref-vis');
  if ($vis) {
    const visVal = manualWx.vis !== '' && manualWx.vis != null ? manualWx.vis : null;
    $vis.textContent = visVal != null ? `${visVal} km` : '—';
    $vis.className   = visVal != null ? 'aprt-ref-v' : 'aprt-ref-v dim';
  }

  // Cloud layers (manual)
  const $cldRows = document.getElementById('aprt-ref-cld-rows');
  if ($cldRows) {
    const CLOUD_LABELS = { SKC:'SKC', FEW:'FEW', SCT:'SCT', BKN:'BKN', OVC:'OVC' };
    const clouds = (manualWx.clouds || []).filter(c => c.cover);
    if (clouds.length === 0) {
      $cldRows.innerHTML = '<div class="aprt-ref-row"><span class="aprt-ref-k">CLD</span><span class="aprt-ref-v dim">—</span></div>';
    } else {
      $cldRows.innerHTML = clouds.map((c, i) =>
        `<div class="aprt-ref-row"><span class="aprt-ref-k">${i === 0 ? 'CLD' : ''}</span>` +
        `<span class="aprt-ref-v">${CLOUD_LABELS[c.cover] || c.cover}${c.base ? ' ' + Number(c.base).toLocaleString() + ' ft' : ''}</span></div>`
      ).join('');
    }
  }

  // ATIS ops
  const rwyRaw  = ((document.getElementById('aprt-atis-rwy')  || {}).value || '').toUpperCase().trim();
  const info    = ((document.getElementById('aprt-atis-info') || {}).value || '').toUpperCase().charAt(0);
  const freq    = (document.getElementById('aprt-atis-freq')  || {}).value || '';
  const taFt    = settings.transitionAltFt ?? 18000;

  const $rwy  = document.getElementById('aprt-ref-rwy');
  const $info = document.getElementById('aprt-ref-info');
  const $freq = document.getElementById('aprt-ref-freq');
  const $ta   = document.getElementById('aprt-ref-ta');

  if ($rwy)  { $rwy.textContent  = rwyRaw || '—';  $rwy.className  = rwyRaw  ? 'aprt-ref-v' : 'aprt-ref-v dim'; }
  if ($info) { $info.textContent = info || '—'; $info.className = info ? 'aprt-ref-v' : 'aprt-ref-v dim'; }
  if ($freq) { $freq.textContent = freq   ? `${freq} MHz` : '—'; $freq.className = freq ? 'aprt-ref-v' : 'aprt-ref-v dim'; }
  if ($ta)   { $ta.textContent   = taFt ? `${taFt.toLocaleString()} ft` : '—'; $ta.className = 'aprt-ref-v'; }
}

function initAprtPanel() {
  const $btn    = document.getElementById('btn-aprt');
  const $panel  = document.getElementById('aprt-panel');
  const $close  = document.getElementById('aprt-close');
  const $search = document.getElementById('aprt-search');
  if (!$btn || !$panel) return;

  $btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !$panel.classList.contains('open');
    $panel.classList.toggle('open');
    $btn.classList.toggle('active', $panel.classList.contains('open'));
    if (opening) {
      if ($search) { $search.value = ''; setTimeout(() => $search.focus(), 40); }
      _renderAprtAptList('');
    }
  });

  if ($close) {
    $close.addEventListener('click', (e) => {
      e.stopPropagation();
      $panel.classList.remove('open');
      $btn.classList.remove('active');
    });
  }

  if ($search) {
    $search.addEventListener('input', () => _renderAprtAptList($search.value));
    $search.addEventListener('click', e => e.stopPropagation());
  }

  // Edit section toggle
  const $editToggle = document.getElementById('aprt-edit-toggle');
  const $editBody   = document.getElementById('aprt-edit-body');
  if ($editToggle && $editBody) {
    $editToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = $editBody.classList.toggle('open');
      $editToggle.classList.toggle('open', open);
    });
  }

  // Manual wx inputs — save on every change and refresh ref card
  ['aprt-wx-vis',
   'aprt-cld-1-cov', 'aprt-cld-1-base',
   'aprt-cld-2-cov', 'aprt-cld-2-base',
   'aprt-cld-3-cov', 'aprt-cld-3-base',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { _saveAprtManualWx(); _updateAprtRefCard(); });
  });

  // ATIS inputs that affect the ref card; freq also persisted per airport
  const $freqEl = document.getElementById('aprt-atis-freq');
  if ($freqEl) {
    $freqEl.addEventListener('input', () => {
      _updateAprtRefCard();
      if (_aprtSelectedApt) {
        const k = _aprtSelectedApt.icao || _aprtSelectedApt.name;
        if (!settings.aprtAtisFreq) settings.aprtAtisFreq = {};
        settings.aprtAtisFreq[k] = $freqEl.value;
        saveSettings();
      }
    });
  }
  ['aprt-atis-info', 'aprt-atis-rwy'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', _updateAprtRefCard);
  });

  // Theater settings
  const $transAlt   = document.getElementById('aprt-transition-alt');
  const $magVar     = document.getElementById('aprt-mag-var');
  const $timeOffset = document.getElementById('aprt-time-offset');

  if ($transAlt) {
    $transAlt.value = settings.transitionAltFt ?? 18000;
    $transAlt.addEventListener('change', () => {
      settings.transitionAltFt = parseInt($transAlt.value) || 18000;
      saveSettings(); updateMap(); _updateAprtRefCard();
    });
  }
  if ($magVar) {
    $magVar.value = settings.magVar ?? 0;
    $magVar.addEventListener('input', () => {
      settings.magVar = parseInt($magVar.value) || 0;
      saveSettings(); updateMap();
    });
  }
  if ($timeOffset) {
    $timeOffset.value = settings.gameTimeOffset ?? 0;
    $timeOffset.addEventListener('change', () => {
      settings.gameTimeOffset = parseInt($timeOffset.value) || 0;
      saveSettings();
    });
  }

  // ATIS BUILD button
  const $build = document.getElementById('aprt-atis-build');
  if ($build) {
    $build.addEventListener('click', (e) => {
      e.stopPropagation();
      _buildAtisText();
    });
  }

  // ATIS transmit — press to start looping, press again to stop
  let _atisLooping    = false;
  let _atisPauseTimer = null;

  const $tx     = document.getElementById('aprt-atis-tx');
  const $status = document.getElementById('aprt-atis-status');

  function _stopAtisLoop() {
    _atisLooping = false;
    clearTimeout(_atisPauseTimer);
    if ($tx) { $tx.textContent = 'TRANSMIT'; $tx.classList.remove('aprt-btn-active'); $tx.disabled = false; }
    if ($status) { $status.textContent = 'STOPPED'; $status.className = 'aprt-atis-status'; }
  }

  function _doAtisTransmit() {
    if (!_atisLooping) return;

    const freqMhz = parseFloat(document.getElementById('aprt-atis-freq').value);
    const text    = (document.getElementById('aprt-atis-text').value || '').trim();
    if (!freqMhz || !text) { _stopAtisLoop(); return; }

    const pos  = _aprtSelectedApt
      ? { lat: _aprtSelectedApt.lat, lon: _aprtSelectedApt.lon, alt: _aprtSelectedApt.elev || 0 }
      : { lat: 0, lon: 0, alt: 0 };
    const coal = getUserCoalition();

    if ($status) { $status.textContent = 'TRANSMITTING…'; $status.className = 'aprt-atis-status'; }

    fetch('/api/atis-transmit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ssml: text, frequency: Math.round(freqMhz * 1e6), coalition: coal, position: pos }),
    })
      .then(r => r.json())
      .then(d => {
        if (!_atisLooping) return;
        if (!d.ok) { _stopAtisLoop(); if ($status) { $status.textContent = d.error || 'Error'; $status.className = 'aprt-atis-status err'; } return; }
        if ($status) { $status.textContent = 'WAITING…'; $status.className = 'aprt-atis-status'; }
        _atisPauseTimer = setTimeout(_doAtisTransmit, 5000);
      })
      .catch(() => {
        if (_atisLooping) { _stopAtisLoop(); if ($status) { $status.textContent = 'UNAVAILABLE'; $status.className = 'aprt-atis-status err'; } }
      });
  }

  if ($tx) {
    $tx.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_atisLooping) { _stopAtisLoop(); return; }

      const freqMhz = parseFloat(document.getElementById('aprt-atis-freq').value);
      const text    = (document.getElementById('aprt-atis-text').value || '').trim();
      if (!freqMhz || !text) {
        if ($status) { $status.textContent = 'Freq and text required.'; $status.className = 'aprt-atis-status err'; }
        return;
      }

      _atisLooping = true;
      $tx.textContent = 'STOP';
      $tx.classList.add('aprt-btn-active');
      _doAtisTransmit();
    });
  }
}

function _renderAprtAptList(filter) {
  const $list = document.getElementById('aprt-apt-list');
  if (!$list) return;

  const term     = (filter || '').trim().toLowerCase();
  const airports = (missionData && missionData.airports) || [];
  const filtered = airports
    .filter(a => a.lat && a.lon && a.name !== 'H' && !/helipad|farp|fob/i.test(a.name))
    .sort((a, b) => (a.icao || a.name).localeCompare(b.icao || b.name))
    .filter(a => !term ||
      (a.icao || '').toLowerCase().includes(term) ||
      (a.name || '').toLowerCase().includes(term));

  $list.innerHTML = '';

  if (filtered.length === 0) {
    $list.innerHTML = '<div style="font-size:10px;color:var(--ui-text-dim);font-style:italic;padding:4px 14px">' +
      (term ? 'No match.' : 'No airports.') + '</div>';
    return;
  }

  for (const a of filtered) {
    const row      = document.createElement('div');
    const isActive = _aprtSelectedApt && _aprtSelectedApt.name === a.name;
    row.className  = 'aprt-apt-row' + (isActive ? ' active' : '');
    row.innerHTML  =
      `<span>${a.icao || a.name}</span>` +
      `<span class="aprt-apt-sub">${a.icao ? a.name : ''}</span>`;
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      _aprtSelectedApt = a;
      _renderAprtAptList(document.getElementById('aprt-search').value || '');
      // Restore saved ATIS freq for this airport
      const $f = document.getElementById('aprt-atis-freq');
      if ($f) {
        const savedFreq = (settings.aprtAtisFreq || {})[a.icao || a.name] || '';
        $f.value = savedFreq;
      }
      _fetchAndShowAprtWeather(a);
    });
    $list.appendChild(row);
  }
}

let _aprtLastFetchedWx = null; // cache of last successful weather fetch

function _fetchAndShowAprtWeather(apt) {
  _aprtLastFetchedWx = null;
  _loadAprtManualWx(apt);
  _updateAprtRefCard();

  fetch(`/api/apt-weather?lat=${apt.lat}&lon=${apt.lon}&alt=${apt.elev || 0}`)
    .then(r => r.json())
    .then(d => {
      if (!d.error) {
        _aprtLastFetchedWx = d;
        _updateAprtRefCard();
      }
    })
    .catch(() => {});
}

function _buildAtisText() {
  // ── TTS helpers ─────────────────────────────────────────────────────────
  const NATO = {
    A:'Alpha', B:'Bravo',   C:'Charlie', D:'Delta',   E:'Echo',    F:'Foxtrot',
    G:'Golf',  H:'Hotel',   I:'India',   J:'Juliet',  K:'Kilo',    L:'Lima',
    M:'Mike',  N:'November',O:'Oscar',   P:'Papa',    Q:'Quebec',  R:'Romeo',
    S:'Sierra',T:'Tango',   U:'Uniform', V:'Victor',  W:'Whiskey', X:'X-ray',
    Y:'Yankee',Z:'Zulu',
  };
  const CLOUD_WORDS = { SKC:'sky clear', FEW:'few', SCT:'scattered', BKN:'broken', OVC:'overcast' };
  const RWY_SUFFIX  = { L:'Left', R:'Right', C:'Center' };

  // Space every digit individually; replace decimal point with "decimal"
  const spellDigits = s =>
    String(s).replace(/\./g, '§').split('')
      .map(c => c === '§' ? 'decimal' : c)
      .join(' ').replace(/\s+/g, ' ').trim();

  // Handle negative numbers: "-5" → "minus 5"
  const spellNum = s => {
    const str = String(s);
    return str.startsWith('-') ? 'minus ' + spellDigits(str.slice(1)) : spellDigits(str);
  };

  // Runway: "28R" → "2 8 Right", "05" → "0 5"
  const spellRwy = s => {
    const m = String(s).toUpperCase().match(/^(\d{1,2})([LRC]?)$/);
    if (!m) return s;
    return spellDigits(m[1].padStart(2,'0')) + (RWY_SUFFIX[m[2]] ? ' ' + RWY_SUFFIX[m[2]] : '');
  };

  // ── Data ─────────────────────────────────────────────────────────────────
  const apt      = _aprtSelectedApt;
  const wx       = _aprtLastFetchedWx;
  const key      = apt ? (apt.icao || apt.name) : null;
  const manualWx = (key && settings.aprtManualWx && settings.aprtManualWx[key]) || {};

  const infoLetter = ((document.getElementById('aprt-atis-info')    || {}).value || 'A').toUpperCase().charAt(0);
  const rwyRaw     = ((document.getElementById('aprt-atis-rwy')     || {}).value || '').toUpperCase().trim();
  const comment    = ((document.getElementById('aprt-atis-comment') || {}).value || '').trim();
  const taFt       = settings.transitionAltFt ?? 18000;

  const aptName  = apt ? (apt.name || apt.icao) : 'THIS STATION';
  const windDir  = wx ? String(wx.windFrom).padStart(3, '0') : '000';
  const windKt   = wx ? wx.windKt   : 0;
  const tempC    = wx ? wx.tempC    : 0;
  const qnhHpa   = wx ? wx.pressureHpa : 1013;
  const qnhInhg  = (qnhHpa / 33.8639).toFixed(2);
  const visRaw   = manualWx.vis !== '' && manualWx.vis != null ? String(manualWx.vis) : '10';
  const vis      = spellDigits(visRaw) + ' kilometers';
  const taK      = Math.round(taFt / 1000);

  // ── TTS-ready values ──────────────────────────────────────────────────────
  const infoPhon    = NATO[infoLetter] || infoLetter;
  const rwySpelled  = rwyRaw  ? spellRwy(rwyRaw)            : '—';
  const taSpelled   = spellDigits(taK)  + ' thousand';
  const windDirSp   = spellDigits(windDir);
  const windKtSp    = spellNum(windKt);
  const tempSp      = spellNum(tempC);
  const qnhHpaSp    = spellDigits(qnhHpa);
  const qnhInhgSp   = spellDigits(qnhInhg);

  // Cloud layers
  const cloudLayers = (manualWx.clouds || []).filter(c => c.cover && c.base);
  const hasClouds   = cloudLayers.some(c => c.cover !== 'SKC');

  const cloudLines = hasClouds
    ? cloudLayers
        .filter(c => c.cover && c.cover !== 'SKC' && c.base)
        .map(c => {
          const word    = CLOUD_WORDS[c.cover] || c.cover.toLowerCase();
          const baseStr = Math.round(Number(c.base) / 100).toString().padStart(3, '0');
          return `Cloud base ${word} at ${spellDigits(baseStr)}.`;
        })
    : ['Sky clear.'];

  const lines = [
    `This is ${aptName} ATIS information ${infoPhon}.`,
    `Expect runway ${rwySpelled}.`,
    `Transition altitude ${taSpelled}.`,
    `Wind ${windDirSp} degrees, ${windKtSp} knots.`,
    `Visibility ${vis}.`,
    ...cloudLines,
    `Temperature ${tempSp} degrees.`,
    `Q N H ${qnhHpaSp} hectopascal or ${qnhInhgSp} inches.`,
    ...(comment ? [comment] : []),
    `Advise on initial contact you have information ${infoPhon}.`,
  ];

  const $text = document.getElementById('aprt-atis-text');
  if ($text) $text.value = lines.join('\n');
}

function _saveAprtManualWx() {
  if (!_aprtSelectedApt) return;
  const key = _aprtSelectedApt.icao || _aprtSelectedApt.name;
  if (!settings.aprtManualWx) settings.aprtManualWx = {};
  settings.aprtManualWx[key] = {
    vis: (document.getElementById('aprt-wx-vis') || {}).value || '',
    clouds: [1, 2, 3].map(i => ({
      cover: (document.getElementById(`aprt-cld-${i}-cov`) || {}).value || '',
      base:  (document.getElementById(`aprt-cld-${i}-base`) || {}).value || '',
    })),
  };
  saveSettings();
}

function _loadAprtManualWx(apt) {
  const key = apt.icao || apt.name;
  const wx  = (settings.aprtManualWx || {})[key] || {};
  const $vis = document.getElementById('aprt-wx-vis');
  if ($vis) $vis.value = wx.vis || '';
  (wx.clouds || []).forEach((c, i) => {
    const $cov  = document.getElementById(`aprt-cld-${i + 1}-cov`);
    const $base = document.getElementById(`aprt-cld-${i + 1}-base`);
    if ($cov)  $cov.value  = c.cover || '';
    if ($base) $base.value = c.base  || '';
  });
  // Clear layers not in saved data
  for (let i = (wx.clouds || []).length + 1; i <= 3; i++) {
    const $cov  = document.getElementById(`aprt-cld-${i}-cov`);
    const $base = document.getElementById(`aprt-cld-${i}-base`);
    if ($cov)  $cov.value  = '';
    if ($base) $base.value = '';
  }
}

// Called when airport list changes (new mission) while panel is open
function refreshAprtAptList() {
  const $panel = document.getElementById('aprt-panel');
  if (!$panel || !$panel.classList.contains('open')) return;
  _renderAprtAptList(document.getElementById('aprt-search').value || '');
}
