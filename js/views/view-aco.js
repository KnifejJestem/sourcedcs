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

  docHeader(div, [
    ['ACO ID',    aco.id],
    ['OPERATION', aco.operation],
    ['ATO DAY',   aco.ato_day],
    ['TIMEZONE',  aco.timezone],
    ['CLASS',     aco.classification],
  ]);

  if (!aco.acms?.length) {
    div.appendChild(el('div', 'empty-state', 'NO ACMs DEFINED'));
    return;
  }

  // ACM table
  const { table: tbl, tbody } = docTable(
    ['NAME', 'TYPE', 'GEOMETRY', 'MISSIONS', 'ALTITUDE', `WINDOW (${STATE.display.timeMode})`, 'CONTROL AGENCY', 'FREQ', 'NOTES']
  );

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

    // Geometry column — read shape-specific fields from geometry sub-key
    const geo_data = acm.geometry || {};
    let geo = '';
    if (geo_data.anchor_point) {
      geo += `<strong>ANCHOR:</strong> ${reformatCoordsInText(String(geo_data.anchor_point))}`;
      if (geo_data.heading_deg != null) geo += `<br>HDG: ${geo_data.heading_deg}°`;
      if (geo_data.leg_length_nm) geo += ` · LEG: ${geo_data.leg_length_nm} NM`;
      if (geo_data.direction) geo += ` · ${geo_data.direction.toUpperCase()}`;
    } else if (geo_data.center) {
      geo += `<strong>CENTER:</strong> ${reformatCoordsInText(String(geo_data.center))}`;
      if (geo_data.radius_nm) geo += `<br>RADIUS: ${geo_data.radius_nm} NM`;
    }
    if (geo_data.boundary?.length) {
      geo += (geo ? '<br>' : '') + `<strong>POLYGON:</strong> ${geo_data.boundary.length} pts`;
      geo_data.boundary.forEach((c, i) => { geo += `<br>&nbsp;&nbsp;${i + 1}. ${reformatCoordsInText(String(c))}`; });
    }
    td(`<span class="aco-geo">${geo || '—'}</span>`);

    td(`<span class="aco-msns">${(acm.missions || []).join(', ') || '—'}</span>`);
    td(`<span class="aco-alt">${acm.alt_lower || '?'} → ${acm.alt_upper || '?'}</span>`);
    td(`<span class="aco-time">${fmtTime(acm.time_from) || '—'} – ${fmtTime(acm.time_to) || '—'}</span>`);
    td(`<span class="aco-ctrl">${acm.control_agency || '—'}</span>`);
    td(`<span class="aco-ctrl">${acm.control_freq_mhz ? acm.control_freq_mhz + ' MHz' : '—'}</span>`);

    // Notes column
    td(`<span class="aco-note">${acm.notes || '—'}</span>`);
  });

  div.appendChild(tbl);
}
