// ═══════════════════════════════════════════════════════════
// view-spins.js — SPINS tab renderer
//
// Each section has:
//   title    — displayed as the section heading
//   note     — (optional) single note line at the top
//   markdown — (optional) free-form content rendered as markdown
//   table    — (optional) {headers, rows, cell_classes?}
//
// Markdown syntax recognised:
//   ## Heading text       → sub-heading block
//   - Bullet text         → bullet line
//   **Key**: Value        → key-value row
//   Plain text            → paragraph line
//   Blank line            → spacer
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Render markdown text into parent element ──────────────
function _spinsMarkdown(parent, text) {
  let block = null;
  (text || '').split('\n').forEach(line => {
    if (/^##\s/.test(line)) {
      block = el('div', 'spins-mission-block');
      block.appendChild(el('div', 'spins-mission-id', line.replace(/^##\s+/, '')));
      parent.appendChild(block);
    } else if (/^-\s/.test(line)) {
      const target = block || parent;
      target.appendChild(el('div', 'spins-sub', '• ' + line.replace(/^-\s+/, '')));
    } else {
      const kv = line.match(/^\*\*([^*]+)\*\*:\s*(.*)/);
      if (kv) {
        const target = block || parent;
        kvRow(target, kv[1], kv[2] || null);
      } else if (line.trim()) {
        const target = block || parent;
        target.appendChild(el('div', 'spins-mission-obj', reformatCoordsInText(line)));
      }
    }
  });
}

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

  // Generate-from-presets button (edit mode only, initializes empty spins)
  const genBtn = el('button', 'editor-btn', '⟳ GENERATE FROM PRESETS');
  genBtn.title = 'Auto-populate all standard SPINS sections from the loaded ATO data and default presets.';
  genBtn.addEventListener('click', function () {
    if ((sp.sections || []).length > 0 &&
        !confirm('Replace all current SPINS sections with auto-generated standard sections?')) {
      return;
    }
    const generated = _initializeSpinsFromAto();
    const spins = editorEnsureSection('spins');
    spins.sections = generated;
    editorReRender('spins');
  });
  div.appendChild(genBtn);

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

      if (sec.markdown) {
        _spinsMarkdown(s, sec.markdown);
      }

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
