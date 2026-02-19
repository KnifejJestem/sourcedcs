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
  ['NAME', 'TYPE', 'GEOMETRY', 'MISSIONS', 'ALTITUDE', 'WINDOW (Z)', 'CONTROL AGENCY', 'FREQ', 'NOTES'].forEach(h => {
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

    // Geometry column — show shape-specific details
    let geo = '';
    if (acm.anchor_point) {
      geo += `<strong>ANCHOR:</strong> ${acm.anchor_point}`;
      if (acm.heading_deg != null) geo += `<br>HDG: ${acm.heading_deg}°`;
      if (acm.leg_length_nm) geo += ` · LEG: ${acm.leg_length_nm} NM`;
      if (acm.direction) geo += ` · ${acm.direction.toUpperCase()}`;
    } else if (acm.center_coords) {
      geo += `<strong>CENTER:</strong> ${acm.center_coords}`;
      if (acm.radius_nm) geo += `<br>RADIUS: ${acm.radius_nm} NM`;
    }
    if (acm.boundary?.length) {
      geo += (geo ? '<br>' : '') + `<strong>POLYGON:</strong> ${acm.boundary.length} pts`;
      acm.boundary.forEach((c, i) => { geo += `<br>&nbsp;&nbsp;${i + 1}. ${c}`; });
    }
    td(`<span style="font-size:9px;color:var(--text-3)">${geo || '—'}</span>`);

    td(`<span style="font-size:10px;color:var(--text-3)">${(acm.missions || []).join(', ') || '—'}</span>`);
    td(`<span style="font-size:11px">${acm.alt_lower || '?'} → ${acm.alt_upper || '?'}</span>`);
    td(`<span style="color:var(--amber);font-size:11px">${acm.time_from || '—'} – ${acm.time_to || '—'}</span>`);
    td(`<span style="color:var(--blue);font-size:11px">${acm.control_agency || '—'}</span>`);
    td(`<span style="color:var(--blue);font-size:11px">${acm.control_freq_mhz ? acm.control_freq_mhz + ' MHz' : '—'}</span>`);

    // Notes column
    td(`<span style="font-size:9px;color:var(--text-3);font-style:italic">${acm.notes || '—'}</span>`);
  });

  div.appendChild(tbl);
}
