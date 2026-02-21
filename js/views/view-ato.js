// ═══════════════════════════════════════════════════════════
// view-ato.js — ATO tab: intel strip, mission cards, timeline
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Timeline layout constants ──────────────────────────────────
const TIMELINE_STEP_MINS = 15;  // minutes between tick marks

function renderATO(ato) {
  const gc       = ato.global_control || {};
  const missions = ato.missions || [];
  const prevIdx  = STATE.selectedIdx;  // save before card rebuild clears old DOM

  renderIntelStrip(gc, ato);
  renderMissionCards(missions);
  renderTimeline(missions);

  // Re-open the detail panel for the previously selected mission (if any).
  // Reset selectedIdx to -1 first so selectMission doesn't treat it as a toggle.
  if (prevIdx >= 0) {
    STATE.selectedIdx = -1;
    selectMission(prevIdx);
  }
}

// ── Intel strip ───────────────────────────────────────────────
function renderIntelStrip(gc, ato) {
  // section() builds one intel-section element from an array of [lbl, val, cls?] tuples.
  // Returns a DOM element so the caller can append it directly (no innerHTML needed).
  function section(...items) {
    const div = el('div', 'intel-section');
    items.forEach(([lbl, val, cls]) => {
      div.appendChild(html`
        <div class="intel-item">
          <span class="intel-lbl">${lbl}</span>
          <span class="intel-val${cls ? ' ' + cls : ''}">${val || '—'}</span>
        </div>`);
    });
    return div;
  }

  const irl = [ato.irl_date, fmtTime(ato.irl_time_zulu)].filter(Boolean).join(' ') || '—';
  const ingame = fmtTime(localToZuluTime(ato.ingame_start_local)) || '—';
  const sections = [
    section(
      ['IRL START',    irl],
      ['INGAME START', ingame, 'ingame'],
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
    const bsParsed = parseCoord(gc.bullseye.coords);
    const bsCoords = bsParsed ? fmtCoord(bsParsed.lat, bsParsed.lon) : (gc.bullseye.coords || '—');
    sections.push(section(
      ['BULLSEYE', gc.bullseye.name || '—'],
      ['COORDS',   bsCoords, 'coords'],
    ));
  }

  const row = document.getElementById('intel-row');
  row.innerHTML = '';
  sections.forEach(s => row.appendChild(s));
}

// ── Mission cards ─────────────────────────────────────────────
function renderMissionCards(missions) {
  const row = document.getElementById('cards-row');
  row.innerHTML = '';

  missions.forEach((m, i) => {
    const tk = typeKey(m.mission_type);

    // Determine window label and times based on TOT/TOS availability
    const hasTOT = m.target?.tot_net || m.target?.tot_nlt;
    const hasTOS = m.target?.tos_net || m.target?.tos_nlt;
    let windowLabel, windowNet, windowNlt;
    if (hasTOT) {
      windowLabel = 'TOT';
      windowNet = m.target.tot_net;
      windowNlt = m.target.tot_nlt;
    } else if (hasTOS) {
      windowLabel = 'TOS';
      windowNet = m.target.tos_net;
      windowNlt = m.target.tos_nlt;
    } else {
      windowLabel = 'WINDOW';
      windowNet = m.target?.not_earlier_than;
      windowNlt = m.target?.not_later_than;
    }

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
            <span class="ck">${windowLabel}</span>
            <span class="cv time">${fmtTime(windowNet)} → ${fmtTime(windowNlt)}</span>
          </div>
          ${hasTOS && hasTOT ? `
          <div class="card-row">
            <span class="ck">TOS</span>
            <span class="cv time">${fmtTime(m.target.tos_net)} → ${fmtTime(m.target.tos_nlt)}</span>
          </div>` : ''}
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
      toMins(m.target?.tot_net), toMins(m.target?.tot_nlt),
      toMins(m.target?.tos_net), toMins(m.target?.tos_nlt),
      toMins(m.refuel?.not_earlier_than), toMins(m.refuel?.not_later_than),
    ].forEach(t => {
      if (t != null) { minT = Math.min(minT, t); maxT = Math.max(maxT, t); }
    });
  });

  if (!isFinite(minT)) {
    canvas.innerHTML = '';
    canvas.appendChild(el('div', 'empty-state', 'NO TIME DATA'));
    return;
  }

  const STEP = TIMELINE_STEP_MINS;
  minT = Math.floor((minT - STEP) / STEP) * STEP;
  maxT = Math.ceil ((maxT + STEP) / STEP) * STEP;
  const span = maxT - minT;
  const tickCount = Math.round(span / STEP) + 1;

  const hh = t => String(Math.floor(t / 60)).padStart(2, '0');
  const mm = t => String(t % 60).padStart(2, '0');

  const timeSuffix = STATE.display.timeMode;
  // Helper: display time label from raw minutes (applies local offset in L mode)
  function dispT(rawMins) {
    if (STATE.display.timeMode === 'L') {
      const off = (STATE.pkg?.ato?.local_offset_hours || 0) * 60;
      return wrapMins(rawMins + off);
    }
    return rawMins;
  }

  document.getElementById('tl-range').textContent =
    `${hh(dispT(minT))}${mm(dispT(minT))}${timeSuffix} – ${hh(dispT(maxT))}${mm(dispT(maxT))}${timeSuffix}`;

  // Update mode label in the static header bar
  const modeLabel = document.getElementById('tl-mode-label');
  if (modeLabel) modeLabel.textContent = `TIMELINE — ${timeSuffix === 'L' ? 'LOCAL' : 'ZULU'} · ▓ TOT/MISSION WINDOW · ░ TOS WINDOW · ▒ AAR WINDOW`;

  // Tick header — one element per tick (no event listeners needed on ticks,
  // but building them with el() avoids embedding HTML strings in JS).
  const ticksRow = el('div', 'tl-ticks');
  for (let t = minT; t <= maxT; t += STEP) {
    const tick = el('div', 'tl-tick', `${hh(dispT(t))}${mm(dispT(t))}${timeSuffix}`);
    tick.style.flex = '1 0 0%';
    ticksRow.appendChild(tick);
  }
  canvas.appendChild(ticksRow);

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

    // Grid lines — one per tick, positioned with CSS left %
    for (let t = minT; t <= maxT; t += STEP) {
      const line = el('div', 'tl-grid-line');
      line.style.left = `${((t - minT) / span * 100).toFixed(3)}%`;
      track.appendChild(line);
    }

    // Mission bars — support TOT/TOS or legacy not_earlier/later_than
    const hasTOT = m.target?.tot_net || m.target?.tot_nlt;
    const hasTOS = m.target?.tos_net || m.target?.tos_nlt;

    if (hasTOT || hasTOS) {
      // TOS bar (wider station window, shown as the main bar)
      if (hasTOS) {
        const tosNet = toMins(m.target.tos_net);
        const tosNlt = toMins(m.target.tos_nlt);
        if (tosNet != null && tosNlt != null) {
          const bar = html`
            <div class="tl-bar tos"
                 style="background:${color};left:${((tosNet-minT)/span*100).toFixed(3)}%;width:${Math.max(2,(tosNlt-tosNet)/span*100).toFixed(3)}%"
                 title="${m.callsign} TOS · ${fmtTime(m.target.tos_net)} – ${fmtTime(m.target.tos_nlt)}"
            >${m.callsign || ''}</div>`;
          bar.addEventListener('click', () => selectMission(i));
          track.appendChild(bar);
        }
      }
      // TOT bar (narrower target window, shown with brighter/distinct style)
      if (hasTOT) {
        const totNet = toMins(m.target.tot_net);
        const totNlt = toMins(m.target.tot_nlt);
        if (totNet != null && totNlt != null) {
          const bar = html`
            <div class="tl-bar tot"
                 style="background:${color};left:${((totNet-minT)/span*100).toFixed(3)}%;width:${Math.max(2,(totNlt-totNet)/span*100).toFixed(3)}%"
                 title="${m.callsign} TOT · ${fmtTime(m.target.tot_net)} – ${fmtTime(m.target.tot_nlt)}"
            >${hasTOS ? '' : (m.callsign || '')}</div>`;
          bar.addEventListener('click', () => selectMission(i));
          track.appendChild(bar);
        }
      }
    } else {
      // Legacy: single not_earlier/later_than window
      const net = toMins(m.target?.not_earlier_than);
      const nlt = toMins(m.target?.not_later_than);
      if (net != null && nlt != null) {
        const bar = html`
          <div class="tl-bar"
               style="background:${color};left:${((net-minT)/span*100).toFixed(3)}%;width:${Math.max(2,(nlt-net)/span*100).toFixed(3)}%"
               title="${m.callsign} · ${fmtTime(m.target.not_earlier_than)} – ${fmtTime(m.target.not_later_than)}"
          >${m.callsign || ''}</div>`;
        bar.addEventListener('click', () => selectMission(i));
        track.appendChild(bar);
      }
    }

    // Refuel bar (hatched)
    const rnet = toMins(m.refuel?.not_earlier_than);
    const rnlt = toMins(m.refuel?.not_later_than);
    if (rnet != null && rnlt != null) {
      const refuelBar = el('div', 'tl-bar refuel');
      refuelBar.style.left  = `${((rnet - minT) / span * 100).toFixed(3)}%`;
      refuelBar.style.width = `${Math.max(2, (rnlt - rnet) / span * 100).toFixed(3)}%`;
      refuelBar.title       = `${m.refuel?.tanker_callsign} ${m.refuel?.altitude} · ${fmtTime(m.refuel?.not_earlier_than)} – ${fmtTime(m.refuel?.not_later_than)}`;
      track.appendChild(refuelBar);
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
            <div class="time-box-val">${fmtTime(net)}</div>
          </div>
          <div class="time-arr">→</div>
          <div class="time-box">
            <div class="time-box-lbl">NLT</div>
            <div class="time-box-val">${fmtTime(nlt)}</div>
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

    // Show TOT and/or TOS when explicitly provided; fall back to legacy not_earlier/later_than
    const hasTOT = m.target?.tot_net || m.target?.tot_nlt;
    const hasTOS = m.target?.tos_net || m.target?.tos_nlt;
    if (hasTOT || hasTOS) {
      if (hasTOT) timePair(c, 'TIME ON TARGET (TOT)', m.target.tot_net, m.target.tot_nlt);
      if (hasTOS) timePair(c, 'TIME ON STATION (TOS)', m.target.tos_net, m.target.tos_nlt);
    } else {
      timePair(c, 'TIME ON TARGET', m.target?.not_earlier_than, m.target?.not_later_than);
    }

    const aim = m.target?.aim_points;
    if (aim?.length) {
      const f = el('div', 'detail-field');
      f.appendChild(el('div', 'dk', `AIM POINTS (${aim.length})`));
      aim.forEach(p => {
        if (p && typeof p === 'object') {
          const ref = p._resolved_target;
          // Reformat the stored coord string using the current coord display mode
          const parsed = parseCoord(p.coords);
          const coordStr = parsed ? fmtCoord(parsed.lat, parsed.lon) : (p.coords || '');
          let text = [p.name, coordStr].filter(Boolean).join(' — ');
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
