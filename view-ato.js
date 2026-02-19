// ═══════════════════════════════════════════════════════════
// view-ato.js — ATO tab: intel strip, mission cards, timeline
// ═══════════════════════════════════════════════════════════

'use strict';

function renderATO(ato) {
  const gc       = ato.global_control || {};
  const missions = ato.missions || [];

  renderIntelStrip(gc, ato);
  renderMissionCards(missions);
  renderTimeline(missions);
  closeDetail();
}

// ── Intel strip ───────────────────────────────────────────────
function renderIntelStrip(gc, ato) {
  const row = document.getElementById('intel-row');
  row.innerHTML = '';

  function section(...items) {
    const s = el('div', 'intel-section');
    items.forEach(([lbl, val, cls]) => {
      const item = el('div', 'intel-item');
      item.appendChild(el('span', 'intel-lbl', lbl));
      item.appendChild(el('span', 'intel-val' + (cls ? ' ' + cls : ''), val || '—'));
      s.appendChild(item);
    });
    row.appendChild(s);
  }

  section(
    ['IRL START',    `${ato.irl_date || '—'} ${ato.irl_time_zulu || ''}`],
    ['INGAME START', ato.ingame_start_local || '—', 'ingame'],
  );
  section(
    ['PFREQ', gc.primary_freq_mhz ? gc.primary_freq_mhz + ' MHz' : '—', 'freq'],
  );
  section(
    ['AWACS / GCI', gc.controlling_unit || '—'],
    ['PLATFORM',    gc.aircraft_type    || '—'],
  );
  if (gc.bullseye) {
    section(
      ['BULLSEYE', gc.bullseye.name   || '—'],
      ['COORDS',   gc.bullseye.coords || '—', 'coords'],
    );
  }
}

// ── Mission cards ─────────────────────────────────────────────
function renderMissionCards(missions) {
  const row = document.getElementById('cards-row');
  row.innerHTML = '';

  missions.forEach((m, i) => {
    const tk   = typeKey(m.mission_type);
    const card = el('div', `mission-card card-${tk}`);

    // Top strip
    const top  = el('div', 'card-top');
    const left = el('div');
    left.appendChild(el('div', 'card-callsign', m.callsign || '—'));
    left.appendChild(el('div', 'card-msn',      m.mission_number || ''));
    top.appendChild(left);
    top.appendChild(el('div', `card-type-badge type-${tk}`, m.mission_type || '?'));
    card.appendChild(top);

    // Body rows
    const body = el('div', 'card-body');
    function cr(k, v, c) {
      const r = el('div', 'card-row');
      r.appendChild(el('span', 'ck', k));
      r.appendChild(el('span', 'cv' + (c ? ' ' + c : ''), v));
      body.appendChild(r);
    }
    cr('ACFT',   (m.aircraft ? m.aircraft.count + '× ' + m.aircraft.type : '?'), 'acft');
    // Loadout chip — compact visual badge row
    if (m.aircraft?.loadout) {
      const chip = loadoutChip(m.aircraft.loadout);
      if (chip) {
        const r = el('div', 'card-row lo-chip-row'); r.appendChild(chip); body.appendChild(r);
      } else {
        cr('LOADOUT', m.aircraft.loadout, 'sm');
      }
    }
    cr('TARGET', m.target?.location || '—');
    cr('WINDOW', `${fmtZ(m.target?.not_earlier_than)} → ${fmtZ(m.target?.not_later_than)}`, 'time');
    if (m.control?.primary_freq_mhz)
      cr('PFREQ', m.control.primary_freq_mhz + ' MHz', 'freq');
    if (m.refuel)
      cr('TANKER', `${m.refuel.tanker_callsign} ${m.refuel.altitude}`, 'tanker');
    card.appendChild(body);

    card.addEventListener('click', () => selectMission(i));
    row.appendChild(card);
  });
}

// ── Timeline ──────────────────────────────────────────────────
function renderTimeline(missions) {
  const canvas = document.getElementById('tl-canvas');
  canvas.innerHTML = '';

  // Determine time range
  let minT = Infinity, maxT = -Infinity;
  missions.forEach(m => {
    [
      toMins(m.target?.not_earlier_than), toMins(m.target?.not_later_than),
      toMins(m.refuel?.not_earlier_than), toMins(m.refuel?.not_later_than),
    ].forEach(t => {
      if (t != null) { minT = Math.min(minT, t); maxT = Math.max(maxT, t); }
    });
  });

  if (!isFinite(minT)) {
    canvas.innerHTML = '<div class="empty-state">NO TIME DATA</div>';
    return;
  }

  const STEP = 15;
  minT = Math.floor((minT - 15) / STEP) * STEP;
  maxT = Math.ceil ((maxT + 15) / STEP) * STEP;
  const span = maxT - minT;
  const TW   = 800; // px — track width basis

  const hh = t => String(Math.floor(t / 60)).padStart(2, '0');
  const mm = t => String(t % 60).padStart(2, '0');

  document.getElementById('tl-range').textContent =
    `${hh(minT)}${mm(minT)}Z – ${hh(maxT)}${mm(maxT)}Z`;

  // Tick header
  const tickRow = el('div', 'tl-ticks');
  for (let t = minT; t <= maxT; t += STEP) {
    const tick = el('div', 'tl-tick', `${hh(t)}${mm(t)}Z`);
    tick.style.width = (STEP / span * TW) + 'px';
    tickRow.appendChild(tick);
  }
  canvas.appendChild(tickRow);

  // Mission rows
  missions.forEach((m, i) => {
    const color = typeColor(m.mission_type);
    const row   = el('div', 'tl-row');

    // Label
    const lbl = el('div', 'tl-label');
    const lcs = el('div', 'tl-label-callsign', m.callsign || '—');
    lcs.style.color = color;
    lbl.appendChild(lcs);
    lbl.appendChild(el('div', 'tl-label-type',
      `${m.mission_type || ''} · ${m.mission_number || ''}`));
    row.appendChild(lbl);

    // Track
    const track = el('div', 'tl-track');
    track.style.width = TW + 'px';

    // Grid lines
    for (let t = minT; t <= maxT; t += STEP) {
      const gl = el('div', 'tl-grid-line');
      gl.style.left = ((t - minT) / span * 100) + '%';
      track.appendChild(gl);
    }

    // Mission bar
    const net = toMins(m.target?.not_earlier_than);
    const nlt = toMins(m.target?.not_later_than);
    if (net != null && nlt != null) {
      const bar = el('div', 'tl-bar', m.callsign || '');
      bar.style.background = color;
      bar.style.left  = ((net - minT) / span * 100) + '%';
      bar.style.width = Math.max(2, (nlt - net) / span * 100) + '%';
      bar.title = `${m.callsign} · ${fmtZ(m.target.not_earlier_than)} – ${fmtZ(m.target.not_later_than)}`;
      bar.addEventListener('click', () => selectMission(i));
      track.appendChild(bar);
    }

    // Refuel bar (hatched, below the mission bar)
    const rnet = toMins(m.refuel?.not_earlier_than);
    const rnlt = toMins(m.refuel?.not_later_than);
    if (rnet != null && rnlt != null) {
      const rbar = el('div', 'tl-bar refuel');
      rbar.style.left  = ((rnet - minT) / span * 100) + '%';
      rbar.style.width = Math.max(2, (rnlt - rnet) / span * 100) + '%';
      rbar.title = `${m.refuel?.tanker_callsign} ${m.refuel?.altitude} · ${fmtZ(rnet)} – ${fmtZ(rnlt)}`;
      track.appendChild(rbar);
    }

    row.appendChild(track);
    canvas.appendChild(row);
  });
}

// ── Mission detail panel ──────────────────────────────────────
function selectMission(idx) {
  if (STATE.selectedIdx === idx) { closeDetail(); return; }
  STATE.selectedIdx = idx;

  document.querySelectorAll('.mission-card').forEach((c, i) =>
    c.classList.toggle('selected', i === idx));

  const m = STATE.pkg.ato.missions[idx];
  if (!m) return;

  const panel = document.getElementById('detail-panel');
  const inner = document.getElementById('detail-inner');
  panel.classList.add('open');
  inner.innerHTML = '';

  const color = typeColor(m.mission_type);

  function col(title, buildFn) {
    const c  = el('div', 'detail-col');
    const th = el('div', 'detail-section-title', title);
    if (title === 'IDENTIFICATION') {
      const cb = el('button', 'close-detail', '✕ CLOSE');
      cb.onclick = closeDetail;
      th.appendChild(cb);
    }
    c.appendChild(th);
    buildFn(c);
    inner.appendChild(c);
  }

  function df(parent, k, v, cls) {
    const f = el('div', 'detail-field');
    f.appendChild(el('div', 'dk', k));
    f.appendChild(el('div', 'dv' + (cls ? ' ' + cls : ''), v));
    parent.appendChild(f);
  }

  function timePair(parent, label, net, nlt) {
    const f  = el('div', 'detail-field');
    f.appendChild(el('div', 'dk', label));
    const tp = el('div', 'time-pair');
    const b1 = el('div', 'time-box');
    b1.appendChild(el('div', 'time-box-lbl', 'NET'));
    b1.appendChild(el('div', 'time-box-val', fmtZ(net)));
    const b2 = el('div', 'time-box');
    b2.appendChild(el('div', 'time-box-lbl', 'NLT'));
    b2.appendChild(el('div', 'time-box-val', fmtZ(nlt)));
    tp.appendChild(b1);
    tp.appendChild(el('div', 'time-arr', '→'));
    tp.appendChild(b2);
    f.appendChild(tp);
    parent.appendChild(f);
  }

  // COL 1 — Identification
  col('IDENTIFICATION', c => {
    const cs = el('div', 'dv big', m.callsign || '—');
    cs.style.color = color;
    const cf = el('div', 'detail-field');
    cf.appendChild(el('div', 'dk', 'CALLSIGN'));
    cf.appendChild(cs);
    c.appendChild(cf);

    df(c, 'MISSION NO', m.mission_number || '—', 'amber');
    df(c, 'TYPE', `${m.mission_type || '—'}${m.target?.mission_type_override ? ' / ' + m.target.mission_type_override : ''}`);
    df(c, 'UNIT', m.unit || '—');
    df(c, 'BASE → DEPLOY', `${m.home_base_icao || '?'} → ${m.deploy_location_icao || '?'}`, 'sm');
    df(c, 'AIRCRAFT', m.aircraft ? `${m.aircraft.count}× ${m.aircraft.type}` : '—');
    // Loadout visual widget
    if (m.aircraft?.loadout) {
      const lf = el('div', 'detail-field');
      lf.appendChild(el('div', 'dk', 'LOADOUT'));
      lf.appendChild(loadoutWidget(m.aircraft.loadout));
      c.appendChild(lf);
    } else {
      df(c, 'LOADOUT', '—', 'sm');
    }
  });

  // COL 2 — Target
  col('TARGET', c => {
    df(c, 'LOCATION', m.target?.location || '—', 'amber');
    df(c, 'ALTITUDE', m.target?.altitude || '—');
    timePair(c, 'TIME ON TARGET', m.target?.not_earlier_than, m.target?.not_later_than);

    const aim = m.target?.aim_points;
    if (aim?.length) {
      const f = el('div', 'detail-field');
      f.appendChild(el('div', 'dk', `AIM POINTS (${aim.length})`));
      aim.forEach(p => {
        const text = (p && typeof p === 'object')
          ? [p.name, p.coords].filter(Boolean).join(' — ')
          : p;
        f.appendChild(el('div', 'dmpi-entry', text));
      });
      c.appendChild(f);
    }
  });

  // COL 3 — Comms
  col('COMMS', c => {
    df(c, 'PRIMARY FREQ',
      m.control?.primary_freq_mhz ? m.control.primary_freq_mhz + ' MHz' : '—', 'freq');
    df(c, 'SECONDARY FREQ',
      m.control?.secondary_freq_mhz ? m.control.secondary_freq_mhz + ' MHz' : '—', 'freq');
    df(c, 'NET',          m.control?.net_name || '—');
    df(c, 'AAR LOCATION', m.aar_location_icao || '—');
  });

  // COL 4 — AAR / Refuel
  col('AAR / REFUEL', c => {
    if (!m.refuel) { df(c, 'STATUS', 'No AAR planned', 'sm'); return; }
    df(c, 'TANKER',   m.refuel.tanker_callsign || '—', 'amber');
    df(c, 'AR TRACK', m.refuel.ar_track || '—');
    df(c, 'ALTITUDE', m.refuel.altitude || '—');
    timePair(c, 'AAR WINDOW', m.refuel.not_earlier_than, m.refuel.not_later_than);
  });
}

function closeDetail() {
  STATE.selectedIdx = -1;
  document.getElementById('detail-panel').classList.remove('open');
  document.querySelectorAll('.mission-card').forEach(c => c.classList.remove('selected'));
}
