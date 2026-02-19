// ═══════════════════════════════════════════════════════════
// view-spins.js — SPINS tab renderer
// ═══════════════════════════════════════════════════════════

'use strict';

function renderSPINS(sp) {
  const div = document.getElementById('spins-content');
  div.innerHTML = '';

  if (!sp) {
    div.innerHTML = '<div class="empty-state">NO SPINS DATA</div>';
    return;
  }

  // Header
  const hdr = el('div', 'doc-header');
  [
    ['OPERATION',  sp.operation],
    ['ATO DAY',    sp.ato_day],
    ['VERSION',    sp.version],
    ['CLASS',      sp.classification],
  ].forEach(([lbl, val]) => {
    const it = el('div', 'doc-hitem');
    it.appendChild(el('div', 'doc-hlbl', lbl));
    it.appendChild(el('div', 'doc-hval', val || '—'));
    hdr.appendChild(it);
  });
  div.appendChild(hdr);

  // Helpers
  function section(title, buildFn) {
    const s = el('div', 'doc-section');
    s.appendChild(el('div', 'doc-section-title', title));
    buildFn(s);
    div.appendChild(s);
  }

  function kv(parent, key, value, cls) {
    const r = el('div', 'kv-row');
    r.appendChild(el('span', 'kv-key', key));
    r.appendChild(el('span', 'kv-val' + (cls ? ' ' + cls : ''), value || '—'));
    parent.appendChild(r);
  }

  function sub(parent, text) {
    parent.appendChild(el('div', 'spins-sub', text));
  }

  // ── C1 — Command & Control ──────────────────────────────
  const c1 = sp.c1_command_control || {};
  section('C1 — COMMAND & CONTROL', s => {
    const tc = c1.tactical_control || {};
    if (tc.primary_awacs)
      kv(s, 'PRIMARY AWACS',
        `${tc.primary_awacs.callsign || '—'} / ${tc.primary_awacs.freq_mhz || '—'} MHz`, 'green');
    if (tc.secondary_awacs)
      kv(s, 'SECONDARY AWACS',
        `${tc.secondary_awacs.callsign || '—'} / ${tc.secondary_awacs.freq_mhz || '—'} MHz`);
    if (c1.airspace_control) kv(s, 'AIRSPACE CTRL', c1.airspace_control);
    if (c1.package_lead)     kv(s, 'PACKAGE LEAD',  c1.package_lead, 'amber');
    if (c1.strike_lead)      kv(s, 'STRIKE LEAD',   c1.strike_lead, 'amber');
  });

  // ── C3 — IFF ────────────────────────────────────────────
  const c3 = sp.c3_iff || {};
  section('C3 — IFF / SIF', s => {
    if (c3.note) sub(s, c3.note);
    const assignments = c3.assignments || [];
    if (assignments.length) {
      const tbl = el('table', 'doc-table');
      const th = tbl.createTHead().insertRow();
      ['MSN', 'MODE', 'CODE'].forEach(h => {
        const t = document.createElement('th'); t.textContent = h; th.appendChild(t);
      });
      const tb = tbl.createTBody();
      assignments.forEach(a => {
        const tr = tb.insertRow();
        tr.insertCell().textContent = a.mission;
        tr.insertCell().textContent = c3.mode || '3';
        tr.insertCell().innerHTML = `<span class="iff-code">${a.code || '—'}</span>`;
      });
      s.appendChild(tbl);
    }
  });

  // ── C4 — ROE ────────────────────────────────────────────
  const c4 = sp.c4_roe || {};
  section('C4 — RULES OF ENGAGEMENT', s => {
    if (c4.pid) {
      kv(s, 'PID REQUIRED', c4.pid.required ? 'YES — required before weapons release' : 'NO', 'red');
      (c4.pid.valid_sources || []).forEach(src => sub(s, '• ' + src));
      if (c4.pid.caveat) {
        const cv = el('div', 'spins-sub');
        cv.style.color = 'var(--amber)';
        cv.textContent = c4.pid.caveat;
        s.appendChild(cv);
      }
    }
    if (c4.bvr)
      kv(s, 'BVR', c4.bvr.authorized ? 'AUTHORIZED — after PID or controller declaration' : 'NOT AUTHORIZED', 'amber');
    if (c4.surface_attack) {
      kv(s, 'SFC ATTACK', c4.surface_attack.authorized_targets || '—');
      kv(s, 'DYNAMIC TGT', c4.surface_attack.dynamic_targeting || '—');
      if (c4.surface_attack.collateral_damage)
        kv(s, 'COLLATERAL DAM.', `Levels ${c4.surface_attack.collateral_damage.delegated_levels} delegated; higher → ${c4.surface_attack.collateral_damage.higher_requires}`);
    }
    if (c4.civilian_traffic) kv(s, 'CIVILIAN TRAFFIC', String(c4.civilian_traffic));
  });

  // ── C5 — Execution ──────────────────────────────────────
  const c5 = sp.c5_execution || [];
  section('C5 — EXECUTION OBJECTIVES', s => {
    c5.forEach(e => {
      const blk = el('div', 'spins-mission-block');
      blk.appendChild(el('div', 'spins-mission-id', 'MSN ' + e.mission));
      if (e.objective)
        blk.appendChild(el('div', 'spins-mission-obj', e.objective));
      if (e.secondary_objective) {
        const sv = el('div', 'spins-sub');
        sv.textContent = 'Secondary: ' + e.secondary_objective;
        blk.appendChild(sv);
      }
      (e.priority_of_effort || []).forEach(p => blk.appendChild(el('div', 'spins-sub', p)));
      if (e.orbit) {
        const ov = el('div', 'spins-sub');
        ov.style.color = 'var(--blue)';
        ov.textContent = 'ORBIT: ' + e.orbit;
        blk.appendChild(ov);
      }
      if (e.targeting_range_nm) {
        blk.appendChild(el('div', 'spins-sub', `Targeting range: ${e.targeting_range_nm}nm`));
      }
      if (e.notes) blk.appendChild(el('div', 'spins-sub', e.notes));
      s.appendChild(blk);
    });
  });

  // ── C7 — Lost Comms ─────────────────────────────────────
  const c7 = sp.c7_lost_comms || {};
  section('C7 — LOST COMMS', s => {
    if (c7.loss_awacs) {
      kv(s, 'LOSS AWACS — ACTION', c7.loss_awacs.action || '—');
      kv(s, 'LOSS AWACS — ABORT',  c7.loss_awacs.abort_condition || '—', 'red');
    }
    if (c7.loss_package) {
      kv(s, 'LOSS PACKAGE — ACTION', c7.loss_package.action || '—');
      kv(s, 'LOSS PACKAGE — ABORT',  c7.loss_package.abort_condition || '—', 'red');
    }
    if (c7.loss_intraflight) {
      kv(s, 'LOSS INTRAFLIGHT', c7.loss_intraflight.action || '—');
      if (c7.loss_intraflight.abort_condition)
        kv(s, 'ABORT', c7.loss_intraflight.abort_condition, 'red');
    }
  });

  // ── C8 — Abort Criteria ─────────────────────────────────
  section('C8 — ABORT CRITERIA', s => {
    (sp.c8_abort_criteria || []).forEach(a => sub(s, '• ' + a));
  });

  // ── C9 — SAR ────────────────────────────────────────────
  if (sp.c9_sar) {
    section('C9 — SEARCH AND RESCUE', s => {
      kv(s, 'STATUS', sp.c9_sar.status || '—');
    });
  }

  // ── C11 — Safety ────────────────────────────────────────
  if (sp.c11_safety) {
    section('C11 — SAFETY', s => {
      kv(s, 'MIN SEPARATION', sp.c11_safety.minimum_separation || '—', 'amber');
    });
  }
}
