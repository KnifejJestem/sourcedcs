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
    div.appendChild(el('div', 'empty-state', 'NO SPINS DATA'));
    return;
  }

  // Edit button (visible in edit mode)
  const editBtn = el('button', 'editor-btn', '✎ EDIT SPINS');
  editBtn.addEventListener('click', openSpinsEditor);
  div.appendChild(editBtn);

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
        } else if (e.type === 'orbit_reference') {
          const target = currentBlock || s;
          const parts = [];
          if (e.coords) parts.push('ORBIT: ' + reformatCoordsInText(String(e.coords)));
          if (e.anchor) parts.push(e.anchor);
          if (e.bearing_deg != null) parts.push(e.bearing_deg + '°');
          if (e.distance_nm != null) parts.push(e.distance_nm + 'nm');
          const d = el('div', 'spins-sub', '• ' + parts.join(' '));
          if (e.style) d.style.color = `var(--${e.style})`;
          target.appendChild(d);
        } else {
          const target = currentBlock || s;

          if (e.label != null) {
            const valStr = e.value != null ? String(e.value) : null;
            kvRow(target, e.label,
              valStr != null ? reformatCoordsInText(valStr) : null,
              e.style || null);
          } else if (e.bullet != null) {
            const d = el('div', 'spins-sub', '• ' + reformatCoordsInText(String(e.bullet)));
            if (e.style === 'red' || e.style === 'blue') {
              d.style.color = `var(--${e.style})`;
            }
            target.appendChild(d);
          } else if (e.value != null) {
            target.appendChild(el('div', 'spins-mission-obj', reformatCoordsInText(String(e.value))));
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
              td.appendChild(el('span', cls[ci], String(cell ?? '—')));
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
