// ═══════════════════════════════════════════════════════════
// export-pdf.js — PDF export via browser print + export dialog
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Constants ─────────────────────────────────────────────────

// Delay (ms) before auto-triggering print — allows the print window to
// finish loading CSS and fonts before the print dialog appears.
const PDF_PRINT_DELAY_MS = 400;

// Maximum number of radio preset channels shown in the comms table.
const PDF_MAX_PRESET_CHANNELS = 20;

// ── Export dialog ─────────────────────────────────────────────

function openExportDialog() {
  if (!STATE.pkg) { alert('No package loaded'); return; }
  const overlay = document.getElementById('exportDialog');
  if (!overlay) return;
  _populateExportMissionSelect();
  // Reset to YAML format on open
  selectExportFormat('yaml');
  overlay.style.display = 'flex';
}

function closeExportDialog() {
  const overlay = document.getElementById('exportDialog');
  if (overlay) overlay.style.display = 'none';
}

function selectExportFormat(format) {
  document.querySelectorAll('#exportFormatToggle .dialog-role-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.format === format);
  });
  const pdfOpts = document.getElementById('exportPdfOptions');
  if (pdfOpts) pdfOpts.style.display = format === 'pdf' ? '' : 'none';
}

function _populateExportMissionSelect() {
  const sel = document.getElementById('exportMissionSelect');
  if (!sel) return;
  sel.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = '— ALL MISSIONS —';
  sel.appendChild(allOpt);
  const missions = STATE.pkg?.ato?.missions || [];
  missions.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = (m.callsign || '—') + (m.mission_number ? ' · ' + m.mission_number : '');
    sel.appendChild(opt);
  });
}

function submitExportDialog() {
  const activeBtn = document.querySelector('#exportFormatToggle .dialog-role-btn.active');
  const format = activeBtn ? activeBtn.dataset.format : 'yaml';

  if (format === 'yaml') {
    closeExportDialog();
    exportPackageYaml();
    return;
  }

  // PDF
  const sel    = document.getElementById('exportMissionSelect');
  const msnIdx = (sel && sel.value !== '') ? parseInt(sel.value) : -1;

  const sections = {
    map:      document.getElementById('exportChkMap')?.checked      !== false,
    comms:    document.getElementById('exportChkComms')?.checked    !== false,
    timeline: document.getElementById('exportChkTimeline')?.checked !== false,
    spins:    document.getElementById('exportChkSpins')?.checked    !== false,
  };

  closeExportDialog();
  exportPackagePDF(msnIdx, sections);
}

// ── PDF export ────────────────────────────────────────────────

function exportPackagePDF(msnIdx, sections) {
  if (!STATE.pkg) return;

  const missions = STATE.pkg.ato?.missions || [];
  const mission  = msnIdx >= 0 ? missions[msnIdx] : null;
  const msnKey   = mission ? (mission.mission_number || mission.callsign) : null;

  const op  = STATE.pkg.ato?.operation || STATE.pkg.header?.operation || 'ATO BRIEF';
  const day = STATE.pkg.header?.ato_date || STATE.pkg.ato?.ato_day || '';
  const title = [op, mission ? mission.callsign : null, day].filter(Boolean).join(' · ');

  const parts = [];

  if (sections.map)      parts.push(_buildMapSection(msnKey, mission));
  if (sections.comms)    parts.push(_buildCommsSection(mission));
  if (sections.timeline) parts.push(_buildTimelineSection());
  if (sections.spins)    parts.push(_buildSpinsSection());

  if (!parts.length) {
    alert('Select at least one section to export.');
    return;
  }

  _openPrintWindow(title, parts.join('\n'));
}

// ── Print window ──────────────────────────────────────────────

function _openPrintWindow(title, bodyHtml) {
  const win = window.open('', '_blank', 'width=960,height=700');
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this site to use PDF export.');
    return;
  }

  // Derive the base URL so CSS imports resolve correctly
  const cssBase = new URL('/css/app.css', window.location.href).href;

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${_escHtml(title)}</title>
<link rel="stylesheet" href="${cssBase}">
<style>
  body {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    padding: 24px 32px;
    background: #fff;
    color: #111;
    max-width: 960px;
    margin: 0 auto;
  }
  .pdf-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 3px;
    border-bottom: 2px solid #333;
    padding-bottom: 6px;
    margin-bottom: 20px;
  }
  .pdf-section {
    margin-bottom: 32px;
    page-break-inside: avoid;
  }
  .pdf-section-title {
    font-size: 10px;
    letter-spacing: 2px;
    font-weight: 700;
    border-bottom: 1px solid #ccc;
    padding-bottom: 4px;
    margin: 0 0 10px 0;
    text-transform: uppercase;
  }
  /* Map */
  .pdf-map svg { width: 100%; height: auto; display: block; }
  /* Comms */
  .pdf-comms-flight { margin-bottom: 20px; }
  .pdf-comms-cs {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    margin-bottom: 6px;
  }
  .pdf-freq-label {
    font-size: 9px;
    letter-spacing: 1px;
    color: #555;
    margin: 8px 0 3px;
  }
  table { border-collapse: collapse; width: 100%; font-size: 10px; margin-bottom: 4px; }
  th, td { border: 1px solid #ccc; padding: 3px 7px; text-align: left; }
  th { background: #eee; font-weight: 700; letter-spacing: 0.5px; }
  tr.freq-empty td { color: #bbb; }
  /* Timeline */
  .pdf-tl-wrap { overflow-x: auto; }
  .tl-canvas { display: block; }
  .tl-ticks {
    display: flex;
    height: 18px;
    border-bottom: 1px solid #ccc;
    margin-left: 140px;
    font-size: 8px;
    color: #888;
  }
  .tl-tick { flex: 1 0 0%; border-left: 1px solid #ddd; padding: 2px; white-space: nowrap; }
  .tl-row {
    display: flex;
    align-items: stretch;
    height: 28px;
    border-bottom: 1px solid #f0f0f0;
  }
  .tl-label {
    width: 140px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding-right: 8px;
    font-size: 9px;
  }
  .tl-label-callsign { font-weight: 700; font-size: 10px; }
  .tl-label-type { font-size: 8px; color: #888; }
  .tl-track {
    flex: 1;
    position: relative;
    border-left: 1px solid #ddd;
    overflow: hidden;
  }
  .tl-bar {
    position: absolute;
    top: 3px; bottom: 3px;
    border-radius: 2px;
    display: flex;
    align-items: center;
    padding: 0 3px;
    font-size: 7px;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
  }
  .tl-grid-line {
    position: absolute;
    top: 0; bottom: 0;
    width: 1px;
    background: #eee;
  }
  .tl-marker {
    position: absolute;
    top: 0; bottom: 0;
    width: 2px;
    background: currentColor;
  }
  .tl-marker.takeoff  { background: #1a7a40; }
  .tl-marker.recovery { background: #8b2000; }
  /* SPINS */
  .pdf-spins-sec { margin-bottom: 16px; }
  .pdf-spins-sec-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    border-bottom: 1px solid #ddd;
    padding-bottom: 3px;
    margin-bottom: 6px;
    text-transform: uppercase;
  }
  .pdf-spins-note { font-size: 10px; color: #555; margin-bottom: 4px; }
  .pdf-spins-kv { display: flex; gap: 12px; margin: 2px 0; font-size: 10px; }
  .pdf-spins-k { min-width: 100px; color: #666; flex-shrink: 0; }
  .pdf-spins-v { flex: 1; }
  .pdf-spins-bullet { font-size: 10px; margin: 2px 0 2px 12px; }
  .pdf-spins-heading { font-weight: 700; font-size: 10px; margin: 6px 0 2px; border-left: 3px solid #ccc; padding-left: 6px; }
  .pdf-spins-obj { font-size: 10px; margin: 2px 0; color: #333; }
  @media print {
    body { padding: 0; }
    .pdf-section { page-break-inside: avoid; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="pdf-title">${_escHtml(title)}</div>
${bodyHtml}
<script>window.onload = function() { setTimeout(function() { window.print(); }, ${PDF_PRINT_DELAY_MS}); };<\/script>
</body>
</html>`);
  win.document.close();
}

// ── Print window helper ───────────────────────────────────────
function _escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Map section ───────────────────────────────────────────────

function _buildMapSection(msnKey, mission) {
  const mapContainer = document.getElementById('map-container');
  const svg = mapContainer ? mapContainer.querySelector('svg') : null;

  if (!svg) {
    return `<div class="pdf-section">
<h2 class="pdf-section-title">MAP</h2>
<p>No map rendered — navigate to the MAP tab first so the chart can be captured.</p>
</div>`;
  }

  const svgClone = svg.cloneNode(true);

  // Remove popups and interactive overlays
  svgClone.querySelectorAll('.map-popup, .map-tile-attr').forEach(n => n.remove());

  // Remove cursor and pointer-events styles so it renders cleanly
  svgClone.removeAttribute('style');

  // Ensure a visible background — insert a white rect before the first child
  // so the map has a fallback background in tile modes (where the canvas isn't captured).
  const existingBg = svgClone.querySelector('rect:first-child');
  if (!existingBg || existingBg.getAttribute('clip-path')) {
    const ns  = 'http://www.w3.org/2000/svg';
    const bg  = document.createElementNS(ns, 'rect');
    const vb  = (svgClone.getAttribute('viewBox') || '0 0 1400 780').split(' ');
    bg.setAttribute('x', vb[0] || '0');
    bg.setAttribute('y', vb[1] || '0');
    bg.setAttribute('width',  vb[2] || '1400');
    bg.setAttribute('height', vb[3] || '780');
    bg.setAttribute('fill', '#c8dce8');
    svgClone.insertBefore(bg, svgClone.firstChild);
  }

  // Filter mission routes: dim groups that don't belong to the selected mission
  if (msnKey) {
    svgClone.querySelectorAll('[data-msn]').forEach(g => {
      if (g.getAttribute('data-msn') !== String(msnKey)) {
        g.setAttribute('opacity', '0.07');
      }
    });
  }

  const svgStr = new XMLSerializer().serializeToString(svgClone);

  const label = mission
    ? `MAP — ${mission.callsign}${mission.mission_number ? ' · ' + mission.mission_number : ''} ROUTE`
    : 'MAP — ALL ROUTES';

  return `<div class="pdf-section pdf-map">
<h2 class="pdf-section-title">${_escHtml(label)}</h2>
${svgStr}
</div>`;
}

// ── Comms section ─────────────────────────────────────────────

function _buildCommsSection(mission) {
  const comms = STATE.pkg?.comms;
  if (!comms) {
    return `<div class="pdf-section">
<h2 class="pdf-section-title">COMMS</h2>
<p>No comms data in this package.</p>
</div>`;
  }

  let html = '<div class="pdf-section">\n<h2 class="pdf-section-title">COMMS</h2>\n';

  if (Array.isArray(comms.flights) && comms.flights.length > 0) {
    let flights = comms.flights;

    // Filter to the selected mission's callsign when one is chosen
    if (mission && mission.callsign) {
      const cs = mission.callsign.trim().toUpperCase();
      const filtered = flights.filter(f =>
        (f.callsign || '').trim().toUpperCase() === cs ||
        (f.group    || '').trim().toUpperCase() === cs
      );
      if (filtered.length > 0) flights = filtered;
    }

    flights.forEach(flt => {
      html += `<div class="pdf-comms-flight">\n`;
      html += `<div class="pdf-comms-cs">${_escHtml(flt.callsign || flt.group || '—')}`;
      if (flt.group && flt.group !== flt.callsign) {
        html += ` — ${_escHtml(flt.group)}`;
      }
      if (flt.dtc_cartridge) html += ` &nbsp;·&nbsp; DTC: ${_escHtml(flt.dtc_cartridge)}`;
      html += `</div>\n`;
      html += _buildFreqTable('UHF (225–400 MHz)', flt.uhf_presets);
      html += _buildFreqTable('VHF (108–174 MHz)', flt.vhf_presets);
      html += `</div>\n`;
    });
  } else {
    // Legacy flat format — no per-flight filtering possible
    html += _buildFreqTable('UHF (225–400 MHz)', comms.uhf_presets);
    html += _buildFreqTable('VHF (108–174 MHz)', comms.vhf_presets);
  }

  html += '</div>';
  return html;
}

// ── Comms frequency table ─────────────────────────────────────
function _buildFreqTable(label, presets) {
  if (!presets) return '';
  let html = `<p class="pdf-freq-label">${_escHtml(label)}</p>\n`;
  html += '<table><thead><tr><th>CH</th><th>CALLSIGN</th><th>MHz</th><th>ROLE</th></tr></thead><tbody>\n';
  for (let ch = 1; ch <= PDF_MAX_PRESET_CHANNELS; ch++) {
    const key = Object.keys(presets).find(k => parseInt(k) === ch);
    const p   = key ? presets[key] : { callsign: 'SPARE', freq_mhz: null, role: null };
    const cls = !p.freq_mhz ? ' class="freq-empty"' : '';
    html += `<tr${cls}><td>${ch}</td><td>${_escHtml(p.callsign || '—')}</td><td>${_escHtml(String(p.freq_mhz ?? '—'))}</td><td>${_escHtml(p.role || '')}</td></tr>\n`;
  }
  html += '</tbody></table>\n';
  return html;
}

// ── Timeline section ──────────────────────────────────────────

function _buildTimelineSection() {
  const tlCanvas = document.getElementById('tl-canvas');
  if (!tlCanvas || !tlCanvas.children.length) {
    return `<div class="pdf-section">
<h2 class="pdf-section-title">TIMELINE — ALL MISSIONS</h2>
<p>No timeline data. Load a package with mission time data to see the timeline.</p>
</div>`;
  }

  const clone = tlCanvas.cloneNode(true);
  // Remove click handlers from bars (not needed in print)
  clone.querySelectorAll('.tl-bar, .tl-label').forEach(n => {
    n.removeAttribute('onclick');
  });

  return `<div class="pdf-section">
<h2 class="pdf-section-title">TIMELINE — ALL MISSIONS</h2>
<div class="pdf-tl-wrap">${clone.outerHTML}</div>
</div>`;
}

// ── SPINS section ─────────────────────────────────────────────

function _buildSpinsSection() {
  const spins = STATE.pkg?.spins;
  if (!spins) {
    return `<div class="pdf-section">
<h2 class="pdf-section-title">SPINS</h2>
<p>No SPINS data in this package.</p>
</div>`;
  }

  let html = '<div class="pdf-section">\n<h2 class="pdf-section-title">SPINS</h2>\n';

  (spins.sections || []).forEach(sec => {
    html += `<div class="pdf-spins-sec">\n`;
    html += `<div class="pdf-spins-sec-title">${_escHtml(sec.title || '')}</div>\n`;

    if (sec.note) {
      html += `<div class="pdf-spins-note">${_escHtml(sec.note)}</div>\n`;
    }

    (sec.entries || []).forEach(e => {
      if (e.heading != null) {
        html += `<div class="pdf-spins-heading">${_escHtml(String(e.heading))}</div>\n`;
      } else if (e.label != null) {
        html += `<div class="pdf-spins-kv"><span class="pdf-spins-k">${_escHtml(e.label)}</span><span class="pdf-spins-v">${_escHtml(String(e.value ?? ''))}</span></div>\n`;
      } else if (e.bullet != null) {
        html += `<div class="pdf-spins-bullet">• ${_escHtml(String(e.bullet))}</div>\n`;
      } else if (e.value != null) {
        html += `<div class="pdf-spins-obj">${_escHtml(String(e.value))}</div>\n`;
      }
    });

    if (sec.table) {
      html += '<table><thead><tr>';
      (sec.table.headers || []).forEach(h => {
        html += `<th>${_escHtml(String(h))}</th>`;
      });
      html += '</tr></thead><tbody>\n';
      (sec.table.rows || []).forEach(row => {
        html += '<tr>' + row.map(c => `<td>${_escHtml(String(c ?? '—'))}</td>`).join('') + '</tr>\n';
      });
      html += '</tbody></table>\n';
    }

    html += '</div>\n';
  });

  html += '</div>';
  return html;
}
