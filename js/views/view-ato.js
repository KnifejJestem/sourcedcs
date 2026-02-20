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
  // Each call to section() returns an HTML string for one intel-section block.
  function section(...items) {
    return `
      <div class="intel-section">
        ${items.map(([lbl, val, cls]) => `
          <div class="intel-item">
            <span class="intel-lbl">${lbl}</span>
            <span class="intel-val${cls ? ' ' + cls : ''}">${val || '—'}</span>
          </div>`).join('')}
      </div>`;
  }

  const sections = [
    section(
      ['IRL START',    ato.irl_start || '—'],
      ['INGAME START', ato.ingame_start_local || '—', 'ingame'],
    ),
    section(
      ['PFREQ', gc.primary_freq_mhz ? gc.primary_freq_mhz + ' MHz' : '—', 'freq'],
    ),
    section(
      ['AWACS / GCI', gc.controlling_unit || '—'],
      ['PLATFORM',    gc.aircraft_type    || '—'],
    ),
  ];
  if (gc.bullseye) {
    sections.push(section(
      ['BULLSEYE', gc.bullseye.name   || '—'],
      ['COORDS',   gc.bullseye.coords || '—', 'coords'],
    ));
  }

  document.getElementById('intel-row').innerHTML = sections.join('');
}

// ── Mission cards ─────────────────────────────────────────────
function renderMissionCards(missions) {
  const row = document.getElementById('cards-row');
  row.innerHTML = '';

  missions.forEach((m, i) => {
    const tk = typeKey(m.mission_type);

    const card = html`
      <div class="mission-card card-${tk}">
        <div class="card-top">
          <div>
            <div class="card-callsign">${m.callsign || '—'}</div>
            <div class="card-msn">${m.mission_number || ''}</div>
          </div>
          <div class="card-type-badge type-${tk}">${m.mission_type || '?'}</div>
        </div>
        <div class="card-body">
          <div class="card-row">
            <span class="ck">ACFT</span>
            <span class="cv acft">${m.aircraft ? m.aircraft.count + '× ' + m.aircraft.type : '?'}</span>
          </div>
          <div class="card-row">
            <span class="ck">TARGET</span>
            <span class="cv">${m.target?.location || '—'}</span>
          </div>
          <div class="card-row">
            <span class="ck">WINDOW</span>
            <span class="cv time">${fmtZ(m.target?.not_earlier_than)} → ${fmtZ(m.target?.not_later_than)}</span>
          </div>
          ${m.control?.primary_freq_mhz ? `
          <div class="card-row">
            <span class="ck">PFREQ</span>
            <span class="cv freq">${m.control.primary_freq_mhz} MHz</span>
          </div>` : ''}
          ${m.refuel ? `
          <div class="card-row">
            <span class="ck">TANKER</span>
            <span class="cv tanker">${m.refuel.tanker_callsign} ${m.refuel.altitude}</span>
          </div>` : ''}
        </div>
      </div>`;

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

  // Tick header — build as a string array so we can join into one innerHTML call
  // rather than calling html() once per tick (no event listeners needed on ticks).
  const ticks = [];
  for (let t = minT; t <= maxT; t += STEP) {
    ticks.push(`<div class="tl-tick" style="width:${(STEP / span * TW).toFixed(2)}px">${hh(t)}${mm(t)}Z</div>`);
  }
  canvas.insertAdjacentHTML('beforeend', `<div class="tl-ticks">${ticks.join('')}</div>`);

  // Mission rows
  missions.forEach((m, i) => {
    const color = typeColor(m.mission_type);
    const row   = el('div', 'tl-row');

    // Label
    row.appendChild(html`
      <div class="tl-label">
        <div class="tl-label-callsign" style="color:${color}">${m.callsign || '—'}</div>
        <div class="tl-label-type">${m.mission_type || ''} · ${m.mission_number || ''}</div>
      </div>`);

    // Track
    const track = el('div', 'tl-track');
    track.style.width = TW + 'px';

    // Grid lines — insertAdjacentHTML per tick (no event listeners needed).
    for (let t = minT; t <= maxT; t += STEP) {
      track.insertAdjacentHTML('beforeend',
        `<div class="tl-grid-line" style="left:${((t - minT) / span * 100).toFixed(3)}%"></div>`);
    }

    // Mission bar
    const net = toMins(m.target?.not_earlier_than);
    const nlt = toMins(m.target?.not_later_than);
    if (net != null && nlt != null) {
      const bar = html`
        <div class="tl-bar"
             style="background:${color};left:${((net-minT)/span*100).toFixed(3)}%;width:${Math.max(2,(nlt-net)/span*100).toFixed(3)}%"
             title="${m.callsign} · ${fmtZ(m.target.not_earlier_than)} – ${fmtZ(m.target.not_later_than)}"
        >${m.callsign || ''}</div>`;
      bar.addEventListener('click', () => selectMission(i));
      track.appendChild(bar);
    }

    // Refuel bar (hatched)
    const rnet = toMins(m.refuel?.not_earlier_than);
    const rnlt = toMins(m.refuel?.not_later_than);
    if (rnet != null && rnlt != null) {
      track.insertAdjacentHTML('beforeend', `
        <div class="tl-bar refuel"
             style="left:${((rnet-minT)/span*100).toFixed(3)}%;width:${Math.max(2,(rnlt-rnet)/span*100).toFixed(3)}%"
             title="${m.refuel?.tanker_callsign} ${m.refuel?.altitude} · ${fmtZ(m.refuel?.not_earlier_than)} – ${fmtZ(m.refuel?.not_later_than)}"></div>`);
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
    parent.appendChild(html`
      <div class="detail-field">
        <div class="dk">${k}</div>
        <div class="dv${cls ? ' ' + cls : ''}">${v}</div>
      </div>`);
  }

  function timePair(parent, label, net, nlt) {
    parent.appendChild(html`
      <div class="detail-field">
        <div class="dk">${label}</div>
        <div class="time-pair">
          <div class="time-box">
            <div class="time-box-lbl">NET</div>
            <div class="time-box-val">${fmtZ(net)}</div>
          </div>
          <div class="time-arr">→</div>
          <div class="time-box">
            <div class="time-box-lbl">NLT</div>
            <div class="time-box-val">${fmtZ(nlt)}</div>
          </div>
        </div>
      </div>`);
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
        if (p && typeof p === 'object') {
          const ref = p._resolved_target;
          let text = [p.name, p.coords].filter(Boolean).join(' — ');
          if (p.elevation) text += ` · ${p.elevation}`;
          const entry = el('div', 'dmpi-entry', text);

          if (ref) {
            const badge = el('span', 'target-type-badge', ref.type);
            entry.prepend(badge);

            if (ref.type === 'SAM' || ref.type === 'EWR') {
              const samInfo = [];
              if (ref.engagement_range_nm) samInfo.push(`ER: ${ref.engagement_range_nm}nm`);
              if (ref.max_alt_ft) samInfo.push(`Max Alt: ${ref.max_alt_ft}ft`);
              if (samInfo.length) {
                entry.appendChild(el('div', 'sam-info', samInfo.join(' · ')));
              }
            }
          }

          f.appendChild(entry);
        } else {
          f.appendChild(el('div', 'dmpi-entry', p));
        }
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
