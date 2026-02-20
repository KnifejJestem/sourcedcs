// ═══════════════════════════════════════════════════════════
// view-helpers.js — Shared rendering utilities for doc views
//
// These helpers eliminate boilerplate that was previously
// duplicated across view-aco.js, view-spins.js, view-comms.js.
// They rely on the global el() helper defined in app.js.
// ═══════════════════════════════════════════════════════════

'use strict';

// Build the standard doc-header strip and append it to parent.
// items: array of [label, value] pairs.
function docHeader(parent, items) {
  const hdr = el('div', 'doc-header');
  items.forEach(([lbl, val]) => {
    const it = el('div', 'doc-hitem');
    it.appendChild(el('div', 'doc-hlbl', lbl));
    it.appendChild(el('div', 'doc-hval', val || '—'));
    hdr.appendChild(it);
  });
  parent.appendChild(hdr);
}

// Build a doc-section with a title, pass the section element to
// buildFn so the caller can fill it, then append it to parent.
function docSection(parent, title, buildFn) {
  const s = el('div', 'doc-section');
  s.appendChild(el('div', 'doc-section-title', title));
  buildFn(s);
  parent.appendChild(s);
}

// Build a key-value row and append it to parent.
// cls is an optional extra class on the value span (e.g. 'amber', 'red', 'green').
function kvRow(parent, key, value, cls) {
  const r = el('div', 'kv-row');
  r.appendChild(el('span', 'kv-key', key));
  r.appendChild(el('span', 'kv-val' + (cls ? ' ' + cls : ''), value || '—'));
  parent.appendChild(r);
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
