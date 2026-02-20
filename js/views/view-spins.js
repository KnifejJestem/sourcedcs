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

  docHeader(div, [
    ['OPERATION', sp.operation],
    ['ATO DAY',   sp.ato_day],
    ['VERSION',   sp.version],
    ['CLASS',     sp.classification],
  ]);

  function sub(parent, text) {
    parent.appendChild(el('div', 'spins-sub', text));
  }

  // ── C1 — Command & Control ──────────────────────────────
  const c1 = sp.c1_command_control || {};
  docSection(div, 'C1 — COMMAND & CONTROL', s => {
    const tc = c1.tactical_control || {};
    if (tc.primary_awacs)
      kvRow(s, 'PRIMARY AWACS',
        `${tc.primary_awacs.callsign || '—'} / ${tc.primary_awacs.freq_mhz || '—'} MHz`, 'green');
    if (tc.secondary_awacs)
      kvRow(s, 'SECONDARY AWACS',
        `${tc.secondary_awacs.callsign || '—'} / ${tc.secondary_awacs.freq_mhz || '—'} MHz`);
    if (c1.airspace_control) kvRow(s, 'AIRSPACE CTRL', c1.airspace_control);
    if (c1.package_lead)     kvRow(s, 'PACKAGE LEAD',  c1.package_lead, 'amber');
    if (c1.strike_lead)      kvRow(s, 'STRIKE LEAD',   c1.strike_lead, 'amber');
  });

  // ── C3 — IFF ────────────────────────────────────────────
  const c3 = sp.c3_iff || {};
  docSection(div, 'C3 — IFF / SIF', s => {
    if (c3.note) sub(s, c3.note);
    const assignments = c3.assignments || [];
    if (assignments.length) {
      const { table: tbl, tbody } = docTable(['MSN', 'MODE', 'CODE']);
      assignments.forEach(a => {
        const tr = tbody.insertRow();
        tr.insertCell().textContent = a.mission;
        tr.insertCell().textContent = c3.mode || '3';
        tr.insertCell().innerHTML = `<span class="iff-code">${a.code || '—'}</span>`;
      });
      s.appendChild(tbl);
    }
  });

  // ── C4 — ROE ────────────────────────────────────────────
  const c4 = sp.c4_roe || {};
  docSection(div, 'C4 — RULES OF ENGAGEMENT', s => {
    if (c4.pid) {
      kvRow(s, 'PID REQUIRED', c4.pid.required ? 'YES — required before weapons release' : 'NO', 'red');
      (c4.pid.valid_sources || []).forEach(src => sub(s, '• ' + src));
      if (c4.pid.caveat) {
        const cv = el('div', 'spins-sub');
        cv.style.color = 'var(--amber)';
        cv.textContent = c4.pid.caveat;
        s.appendChild(cv);
      }
    }
    if (c4.bvr)
      kvRow(s, 'BVR', c4.bvr.authorized ? 'AUTHORIZED — after PID or controller declaration' : 'NOT AUTHORIZED', 'amber');
    if (c4.surface_attack) {
      kvRow(s, 'SFC ATTACK', c4.surface_attack.authorized_targets || '—');
      kvRow(s, 'DYNAMIC TGT', c4.surface_attack.dynamic_targeting || '—');
      if (c4.surface_attack.collateral_damage)
        kvRow(s, 'COLLATERAL DAM.', `Levels ${c4.surface_attack.collateral_damage.delegated_levels} delegated; higher → ${c4.surface_attack.collateral_damage.higher_requires}`);
    }
    if (c4.civilian_traffic) kvRow(s, 'CIVILIAN TRAFFIC', String(c4.civilian_traffic));
  });

  // ── C5 — Execution ──────────────────────────────────────
  const c5 = sp.c5_execution || [];
  docSection(div, 'C5 — EXECUTION OBJECTIVES', s => {
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
  docSection(div, 'C7 — LOST COMMS', s => {
    if (c7.loss_awacs) {
      kvRow(s, 'LOSS AWACS — ACTION', c7.loss_awacs.action || '—');
      kvRow(s, 'LOSS AWACS — ABORT',  c7.loss_awacs.abort_condition || '—', 'red');
    }
    if (c7.loss_package) {
      kvRow(s, 'LOSS PACKAGE — ACTION', c7.loss_package.action || '—');
      kvRow(s, 'LOSS PACKAGE — ABORT',  c7.loss_package.abort_condition || '—', 'red');
    }
    if (c7.loss_intraflight) {
      kvRow(s, 'LOSS INTRAFLIGHT', c7.loss_intraflight.action || '—');
      if (c7.loss_intraflight.abort_condition)
        kvRow(s, 'ABORT', c7.loss_intraflight.abort_condition, 'red');
    }
  });

  // ── C8 — Abort Criteria ─────────────────────────────────
  docSection(div, 'C8 — ABORT CRITERIA', s => {
    (sp.c8_abort_criteria || []).forEach(a => sub(s, '• ' + a));
  });

  // ── C9 — SAR ────────────────────────────────────────────
  if (sp.c9_sar) {
    docSection(div, 'C9 — SEARCH AND RESCUE', s => {
      kvRow(s, 'STATUS', sp.c9_sar.status || '—');
    });
  }

  // ── C11 — Safety ────────────────────────────────────────
  if (sp.c11_safety) {
    docSection(div, 'C11 — SAFETY', s => {
      kvRow(s, 'MIN SEPARATION', sp.c11_safety.minimum_separation || '—', 'amber');
    });
  }
}
