// ═══════════════════════════════════════════════════════════
// view-helpers.js — Shared rendering utilities for doc views
//
// These helpers eliminate boilerplate that was previously
// duplicated across view-aco.js, view-spins.js, view-comms.js.
// They rely on the global el() and html() helpers in app.js.
// ═══════════════════════════════════════════════════════════

'use strict';

// Build the standard doc-header strip and append it to parent.
// items: array of [label, value] pairs.
function docHeader(parent, items) {
  parent.appendChild(html`
    <div class="doc-header">
      ${items.map(([lbl, val]) => `
        <div class="doc-hitem">
          <div class="doc-hlbl">${lbl}</div>
          <div class="doc-hval">${val || '—'}</div>
        </div>`).join('')}
    </div>`);
}

// Build a doc-section with a title, pass the section element to
// buildFn so the caller can fill it, then append it to parent.
function docSection(parent, title, buildFn) {
  const s = html`<div class="doc-section"><div class="doc-section-title">${title}</div></div>`;
  buildFn(s);
  parent.appendChild(s);
}

// Build a key-value row and append it to parent.
// cls is an optional extra class on the value span (e.g. 'amber', 'red', 'green').
function kvRow(parent, key, value, cls) {
  parent.appendChild(html`
    <div class="kv-row">
      <span class="kv-key">${key}</span>
      <span class="kv-val${cls ? ' ' + cls : ''}">${value || '—'}</span>
    </div>`);
}

// Build a <table class="doc-table"> with the given column headers.
// Returns { table, tbody } so the caller can append <tr> rows to tbody.
function docTable(headers) {
  const tbl = el('table', 'doc-table');
  const tr  = tbl.createTHead().insertRow();
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    tr.appendChild(th);
  });
  return { table: tbl, tbody: tbl.createTBody() };
}
