// ═══════════════════════════════════════════════════════════
// view-comms.js — Frequency preset table renderer
// ═══════════════════════════════════════════════════════════

'use strict';

function renderCOMMS(cm) {
  const div = document.getElementById('comms-content');
  div.innerHTML = '';

  if (!cm) {
    div.innerHTML = '<div class="empty-state">NO COMMS DATA</div>';
    return;
  }

  // Header
  const hdr = el('div', 'doc-header');
  [
    ['OPERATION', cm.operation],
    ['ATO DAY',   cm.ato_day],
    ['WING LEAD', cm.wing_lead],
    ['CLASS',     cm.classification],
  ].forEach(([lbl, val]) => {
    const it = el('div', 'doc-hitem');
    it.appendChild(el('div', 'doc-hlbl', lbl));
    it.appendChild(el('div', 'doc-hval', val || '—'));
    hdr.appendChild(it);
  });
  div.appendChild(hdr);

  const grid = el('div', 'comms-grid');

  function radioBlock(title, presets) {
    if (!presets) return;

    const block = el('div', 'radio-block');
    block.appendChild(el('div', 'radio-title', title));

    const tbl = el('table', 'doc-table');
    const th = tbl.createTHead().insertRow();
    ['CH', 'CALLSIGN', 'MHz', 'ROLE'].forEach(h => {
      const t = document.createElement('th');
      t.textContent = h;
      th.appendChild(t);
    });

    const tb = tbl.createTBody();

    // Presets can be keyed by integer or string — normalise
    Object.keys(presets).sort((a, b) => parseInt(a) - parseInt(b)).forEach(ch => {
      const p  = presets[ch];
      const tr = tb.insertRow();
      const isEmpty = !p.freq_mhz;
      if (isEmpty) tr.className = 'freq-empty';

      tr.insertCell().innerHTML = `<span class="freq-ch">${ch}</span>`;
      tr.insertCell().innerHTML = `<span class="freq-cs">${p.callsign || '—'}</span>`;
      tr.insertCell().innerHTML = p.freq_mhz
        ? `<span class="freq-mhz">${p.freq_mhz}</span>`
        : `<span style="color:var(--text-3)">—</span>`;
      tr.insertCell().innerHTML = `<span class="freq-role">${p.role || ''}</span>`;
    });

    block.appendChild(tbl);
    grid.appendChild(block);
  }

  radioBlock('RADIO 1 — UHF  (225–400 MHz)', cm.uhf_presets);
  radioBlock('RADIO 2 — VHF  (108–174 MHz)', cm.vhf_presets);
  div.appendChild(grid);
}
