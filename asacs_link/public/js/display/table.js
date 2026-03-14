/* ════════════════════════════════════════════════════════════
   display/table.js — PROF mode table renderer

   Renders the unit track table and raw DCS dump panel.
   Exposes a single global: AsacsTable
════════════════════════════════════════════════════════════ */
'use strict';

const AsacsTable = (() => {

  // ── Helpers ──────────────────────────────────────────────
  function esc(v) {
    if (v == null) return '—';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtCoord(v, digits) {
    if (v == null) return '—';
    return Number(v).toFixed(digits || 4);
  }

  function coalitionName(id) {
    if (id === 0) return 'NEUTRAL';
    if (id === 1) return 'RED';
    if (id === 2) return 'BLUE';
    return String(id);
  }

  function relClass(rel) {
    if (!rel) return '';
    return 'rel-' + rel.toLowerCase();
  }

  // ── Filtered unit table (WebSocket data) ──────────────────
  function renderUnits(units) {
    const tbody = document.getElementById('unitTableBody');
    if (!tbody) return;

    if (!units || units.length === 0) {
      tbody.innerHTML = '<tr><td colspan="14" class="empty-state">NO TRACKS</td></tr>';
      return;
    }

    const order = { friendly: 0, admin: 0, hostile: 1, neutral: 2 };
    const sorted = [...units].sort((a, b) => {
      const ra = order[a._rel] ?? 3;
      const rb = order[b._rel] ?? 3;
      if (ra !== rb) return ra - rb;
      return (a.id || 0) - (b.id || 0);
    });

    const rows = sorted.map(u => {
      const rel  = u._rel || '';
      const rc   = relClass(rel);
      const iff  = u.iffResolved == null ? '—' : (u.iffResolved ? 'YES' : 'NO');
      const iffC = u.iffResolved ? 'rel-friendly' : (u.iffResolved === false ? 'rel-hostile' : '');

      // Show live IFF status from transponder if available
      const iffStatus = (u._sim && u._sim.iffStatus) ? ` (${u._sim.iffStatus})` : '';

      return `<tr>
        <td class="${rc}">${rel.toUpperCase() || '—'}</td>
        <td>${esc(u.id)}</td>
        <td>${esc(u.typeName || u.type || '—')}</td>
        <td>${esc(u.category || '—')}</td>
        <td>${esc(coalitionName(u.coalition))}</td>
        <td>${fmtCoord(u.lat)}</td>
        <td>${fmtCoord(u.lon)}</td>
        <td>${u.alt != null ? u.alt : '—'}</td>
        <td>${u.spd != null ? u.spd : '—'}</td>
        <td>${u.hdg != null ? u.hdg : '—'}</td>
        <td>${u.squawk != null ? u.squawk : '—'}</td>
        <td class="${iffC}">${iff}${esc(iffStatus)}</td>
        <td>${esc(u.groupName || '—')}</td>
        <td>${esc(u.pilotName || '—')}</td>
      </tr>`;
    });

    tbody.innerHTML = rows.join('');
  }

  // ── Raw DCS dump panel (polls /api/raw) ───────────────────
  function renderRaw(data) {
    const exportStatus = document.getElementById('rawExportStatus');
    const meta  = document.getElementById('rawMeta');
    const tbody = document.getElementById('rawTableBody');
    const count = document.getElementById('rawCount');

    if (!exportStatus || !tbody) return;

    const units = data.units || [];
    if (count) count.textContent = `${units.length} unit${units.length !== 1 ? 's' : ''} in store`;

    if (data.exportLoadedTs) {
      const ageSec = (data.exportLoadedAgeMs / 1000).toFixed(0);
      exportStatus.textContent = `Export script: LOADED (confirmed ${ageSec}s ago via status file)`;
      exportStatus.style.color = '';
    } else {
      exportStatus.textContent =
        'Export script: NOT LOADED — add dofile(lfs.writedir().."Scripts\\asacslink_export.lua") to Export.lua';
      exportStatus.style.color = 'var(--red, #f55)';
    }

    if (data.lastUnitsPkt) {
      const ageSec = (data.lastUnitsPkt.ageMs / 1000).toFixed(1);
      if (meta) meta.textContent =
        `Last units file: ${ageSec}s ago · ${data.lastUnitsPkt.unitCount} unit(s)`;
    } else if (data.lastPkt) {
      const ageSec = (data.lastPkt.ageMs / 1000).toFixed(1);
      if (meta) meta.textContent =
        `Last file read: ${ageSec}s ago (type="${data.lastPkt.type}") — no units file yet`;
    } else {
      if (meta) meta.textContent = 'No data file read from DCS yet';
    }

    if (units.length === 0) {
      tbody.innerHTML = '<tr><td colspan="13" class="empty-state">NO RAW DATA FROM DCS</td></tr>';
      return;
    }

    const rows = units.map(u => `<tr>
      <td>${esc(u.id)}</td>
      <td>${esc(u.unitName || '—')}</td>
      <td>${esc(u.typeName || u.type || '—')}</td>
      <td>${esc(u.category || '—')}</td>
      <td>${esc(u.coalition)}</td>
      <td>${fmtCoord(u.lat)}</td>
      <td>${fmtCoord(u.lon)}</td>
      <td>${u.alt != null ? u.alt : '—'}</td>
      <td>${u.spd != null ? u.spd : '—'}</td>
      <td>${u.hdg != null ? u.hdg : '—'}</td>
      <td>${u.squawk != null ? u.squawk : '—'}</td>
      <td>${esc(u.groupName || '—')}</td>
      <td>${esc(u.pilotName || '—')}</td>
    </tr>`);

    tbody.innerHTML = rows.join('');
  }

  return { renderUnits, renderRaw };
})();
