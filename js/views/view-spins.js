// ═══════════════════════════════════════════════════════════
// view-spins.js — SPINS tab renderer
//
// The SPINS YAML uses a flexible `sections` list so any
// C-section can be added, removed, or reordered without
// touching this file.  Each section has:
//   title   — displayed as the section heading
//   note    — (optional) single note line at the top
//   entries — (optional) list of typed display rows:
//               {label, value, style?}  → key-value row
//               {bullet, style?}        → bullet text
//               {heading}               → mission block header
//               {value}  (no label)     → plain objective text
//   table   — (optional) {headers, rows, cell_classes?}
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

  (sp.sections || []).forEach(sec => {
    docSection(div, sec.title, s => {

      if (sec.note) {
        s.appendChild(el('div', 'spins-sub', sec.note));
      }

      // Render entries.  When a {heading} entry is seen a
      // spins-mission-block is opened; subsequent entries
      // go inside that block until the next heading.
      let currentBlock = null;
      (sec.entries || []).forEach(e => {
        if (e.heading != null) {
          currentBlock = el('div', 'spins-mission-block');
          currentBlock.appendChild(el('div', 'spins-mission-id', e.heading));
          s.appendChild(currentBlock);
        } else {
          const target = currentBlock || s;

          if (e.label != null) {
            kvRow(target, e.label, e.value, e.style || null);
          } else if (e.bullet != null) {
            const d = el('div', 'spins-sub', '• ' + e.bullet);
            if (e.style) d.style.color = `var(--${e.style})`;
            target.appendChild(d);
          } else if (e.value != null) {
            target.appendChild(el('div', 'spins-mission-obj', e.value));
          }
        }
      });

      if (sec.table) {
        const cls = sec.table.cell_classes || [];
        const { table: tbl, tbody } = docTable(sec.table.headers);
        (sec.table.rows || []).forEach(row => {
          const tr = tbody.insertRow();
          row.forEach((cell, ci) => {
            const td = tr.insertCell();
            if (cls[ci]) {
              td.innerHTML = `<span class="${cls[ci]}">${cell ?? '—'}</span>`;
            } else {
              td.textContent = String(cell ?? '—');
            }
          });
        });
        s.appendChild(tbl);
      }
    });
  });
}
