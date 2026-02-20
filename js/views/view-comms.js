// ═══════════════════════════════════════════════════════════
// view-comms.js — Frequency preset table renderer
// ═══════════════════════════════════════════════════════════

'use strict';

function renderCOMMS(cm) {
  const div = document.getElementById('comms-content');
  div.innerHTML = '';

  if (!cm) {
    div.appendChild(el('div', 'empty-state', 'NO COMMS DATA'));
    return;
  }

  docHeader(div, [
    ['OPERATION', cm.operation],
    ['ATO DAY',   cm.ato_day],
    ['WING LEAD', cm.wing_lead],
    ['CLASS',     cm.classification],
  ]);

  const grid = el('div', 'comms-grid');

  function radioBlock(title, presets) {
    if (!presets) return;

    const block = el('div', 'radio-block');
    block.appendChild(el('div', 'radio-title', title));

    const { table: tbl, tbody } = docTable(['CH', 'CALLSIGN', 'MHz', 'ROLE']);

    // Presets can be keyed by integer or string — normalise and sort numerically
    Object.keys(presets).sort((a, b) => parseInt(a) - parseInt(b)).forEach(ch => {
      const p       = presets[ch];
      const tr      = tbody.insertRow();
      const isEmpty = !p.freq_mhz;
      if (isEmpty) tr.className = 'freq-empty';

      tr.insertCell().appendChild(el('span', 'freq-ch',   String(ch)));
      tr.insertCell().appendChild(el('span', 'freq-cs',   p.callsign || '—'));
      tr.insertCell().appendChild(el('span', p.freq_mhz ? 'freq-mhz' : 'text-dim',
        p.freq_mhz ? String(p.freq_mhz) : '—'));
      tr.insertCell().appendChild(el('span', 'freq-role', p.role || ''));
    });

    block.appendChild(tbl);
    grid.appendChild(block);
  }

  radioBlock('RADIO 1 — UHF  (225–400 MHz)', cm.uhf_presets);
  radioBlock('RADIO 2 — VHF  (108–174 MHz)', cm.vhf_presets);
  div.appendChild(grid);
}
