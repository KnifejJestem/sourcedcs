// ═══════════════════════════════════════════════════════════
// view-aco.js — Airspace Control Order tab renderer
// ═══════════════════════════════════════════════════════════

'use strict';

function renderACO(aco) {
  const div = document.getElementById('aco-content');
  div.innerHTML = '';

  if (!aco) {
    div.innerHTML = '<div class="empty-state">NO ACO DATA</div>';
    return;
  }

  // Header
  const hdr = el('div', 'doc-header');
  [
    ['ACO ID',     aco.id],
    ['OPERATION',  aco.operation],
    ['ATO DAY',    aco.ato_day],
    ['TIMEZONE',   aco.timezone],
    ['CLASS',      aco.classification],
  ].forEach(([lbl, val]) => {
    const it = el('div', 'doc-hitem');
    it.appendChild(el('div', 'doc-hlbl', lbl));
    it.appendChild(el('div', 'doc-hval', val || '—'));
    hdr.appendChild(it);
  });
  div.appendChild(hdr);

  if (!aco.acms?.length) {
    div.innerHTML += '<div class="empty-state">NO ACMs DEFINED</div>';
    return;
  }

  // ACM table
  const tbl = el('table', 'doc-table');

  const thead = tbl.createTHead();
  const hr = thead.insertRow();
  ['NAME', 'TYPE', 'MISSIONS', 'ALTITUDE', 'WINDOW (Z)', 'CONTROL AGENCY', 'FREQ', 'NOTES'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  });

  const tbody = tbl.createTBody();
  aco.acms.forEach(acm => {
    const tr = tbody.insertRow();

    function td(content, style) {
      const c = tr.insertCell();
      if (typeof content === 'string') c.innerHTML = content;
      else c.appendChild(content);
      if (style) c.style.cssText = style;
    }

    const typeKey = (acm.type || 'OTHER').toUpperCase();
    td(`<strong>${acm.name || '—'}</strong>`);
    td(`<span class="acm-badge ${typeKey}">${typeKey}</span>`);
    td(`<span style="font-size:10px;color:var(--text-3)">${(acm.missions || []).join(', ') || '—'}</span>`);
    td(`<span style="font-size:11px">${acm.alt_lower || '?'} → ${acm.alt_upper || '?'}</span>`);
    td(`<span style="color:var(--amber);font-size:11px">${acm.time_from || '—'} – ${acm.time_to || '—'}</span>`);
    td(`<span style="color:var(--blue);font-size:11px">${acm.control_agency || '—'}</span>`);
    td(`<span style="color:var(--blue);font-size:11px">${acm.control_freq_mhz ? acm.control_freq_mhz + ' MHz' : '—'}</span>`);

    // Notes: geometry + freetext
    let notes = '';
    if (acm.center_coords) notes += acm.center_coords + (acm.radius_nm ? ` r=${acm.radius_nm}nm` : '');
    if (acm.boundary)      notes += `Polygon (${acm.boundary.length} pts)`;
    if (acm.notes)         notes += (notes ? ' | ' : '') + acm.notes;
    td(`<span style="font-size:9px;color:var(--text-3);font-style:italic">${notes || '—'}</span>`);
  });

  div.appendChild(tbl);
}
