// ═══════════════════════════════════════════════════════════
// view-weather.js — Weather tab renderer
//
// Renders the `weather:` section of a package.yaml file.
// The YAML format is inspired by METAR and TAF:
//
//   weather:
//     issued:     '2026-11-01 1800Z'
//     valid_from: '2026-11-01 2000Z'
//     valid_to:   '2026-11-02 0600Z'
//     observations: [ ... ]   # METAR-style per-station obs
//     forecasts:   [ ... ]    # TAF-style per-station forecast
//     mission_wx:  [ ... ]    # mission-specific notes
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Coverage abbreviation → human-readable description ───────
const WX_COVERAGE = {
  SKC: 'Sky Clear',
  CLR: 'Clear',
  NSC: 'No Significant Cloud',
  NCD: 'No Cloud Detected',
  FEW: 'Few',
  SCT: 'Scattered',
  BKN: 'Broken',
  OVC: 'Overcast',
  VV:  'Vertical Visibility',
};

// ── Weather phenomena codes → human-readable ─────────────────
const WX_PHENOMENA = {
  // Intensity / proximity prefix handled separately
  // Precipitation
  DZ:   'Drizzle',
  RA:   'Rain',
  SN:   'Snow',
  SG:   'Snow Grains',
  IC:   'Ice Crystals',
  PL:   'Ice Pellets',
  GR:   'Hail',
  GS:   'Small Hail',
  UP:   'Unknown Precipitation',
  // Obscuration
  FG:   'Fog',
  BR:   'Mist',
  HZ:   'Haze',
  DU:   'Dust',
  SA:   'Sand',
  VA:   'Volcanic Ash',
  PY:   'Spray',
  // Other
  SQ:   'Squall',
  PO:   'Dust/Sand Whirls',
  DS:   'Duststorm',
  SS:   'Sandstorm',
  FC:   'Funnel Cloud',
  TS:   'Thunderstorm',
  SH:   'Showers',
  FZ:   'Freezing',
  MI:   'Shallow',
  PR:   'Partial',
  BC:   'Patchy',
  DR:   'Drifting',
  BL:   'Blowing',
  TSRA: 'Thunderstorm with Rain',
  TSGR: 'Thunderstorm with Hail',
  RASN: 'Rain and Snow',
  FZRA: 'Freezing Rain',
  FZDZ: 'Freezing Drizzle',
  SHSN: 'Snow Showers',
  SHRA: 'Rain Showers',
};

// ── Change group type descriptions ────────────────────────────
const WX_CHANGE_TYPE = {
  BECMG:  'Becoming',
  TEMPO:  'Temporary',
  FM:     'From',
  PROB30: 'Probability 30%',
  PROB40: 'Probability 40%',
};

// ── Flight category based on ceiling and visibility ───────────
// Returns { cat, label, cls }
function flightCategory(clouds, visibility_m) {
  const vis_sm = visibility_m != null ? visibility_m / 1609.34 : null;

  // Find lowest broken/overcast ceiling
  let ceilingFt = null;
  if (Array.isArray(clouds)) {
    clouds.forEach(c => {
      if (c.coverage === 'BKN' || c.coverage === 'OVC' || c.coverage === 'VV') {
        if (ceilingFt === null || c.base_ft < ceilingFt) ceilingFt = c.base_ft;
      }
    });
  }

  // LIFR: ceiling < 500 ft or visibility < 1 SM
  if ((ceilingFt !== null && ceilingFt < 500) || (vis_sm !== null && vis_sm < 1)) {
    return { cat: 'LIFR', label: 'Low IFR', cls: 'wx-lifr' };
  }
  // IFR: ceiling < 1000 ft or visibility < 3 SM
  if ((ceilingFt !== null && ceilingFt < 1000) || (vis_sm !== null && vis_sm < 3)) {
    return { cat: 'IFR',  label: 'IFR',     cls: 'wx-ifr'  };
  }
  // MVFR: ceiling < 3000 ft or visibility < 5 SM
  if ((ceilingFt !== null && ceilingFt < 3000) || (vis_sm !== null && vis_sm < 5)) {
    return { cat: 'MVFR', label: 'Marginal VFR', cls: 'wx-mvfr' };
  }
  return { cat: 'VFR', label: 'VFR', cls: 'wx-vfr' };
}

// ── Decode a phenomenon code to readable text ─────────────────
function decodePhenomenon(code) {
  if (!code) return code;
  const s = String(code).toUpperCase();
  return WX_PHENOMENA[s] || s;
}

// ── Format visibility ─────────────────────────────────────────
function fmtVisibility(vis) {
  if (vis == null) return '—';
  if (String(vis).toUpperCase() === 'CAVOK') return 'CAVOK (≥10 km, no significant cloud, no WX)';
  if (String(vis).toUpperCase() === '9999')  return '≥10 km';
  const m = Number(vis);
  if (isNaN(m)) return String(vis);
  if (m >= 10000) return '≥10 km';
  if (m >= 1000)  return (m / 1000).toFixed(1) + ' km';
  return m + ' m';
}

// ── Format a cloud layer ──────────────────────────────────────
function fmtCloudLayer(c) {
  if (!c) return '—';
  const cov = WX_COVERAGE[String(c.coverage).toUpperCase()] || c.coverage;
  const base = c.base_ft != null ? String(c.base_ft) + ' ft' : '';
  const cb   = c.cb ? ' (Cumulonimbus)' : '';
  const tcu  = c.tcu ? ' (Towering Cu)' : '';
  return [cov, base, cb, tcu].filter(Boolean).join(' ');
}

// ── Format wind ───────────────────────────────────────────────
function fmtWind(w) {
  if (!w) return '—';
  if (w.variable && !w.direction_deg) {
    return 'Variable ' + (w.speed_kt != null ? w.speed_kt + ' kt' : '');
  }
  const dir  = w.direction_deg != null ? String(w.direction_deg).padStart(3, '0') + '°' : 'VRB';
  const spd  = w.speed_kt  != null ? w.speed_kt  + ' kt'   : '';
  const gust = w.gust_kt   != null ? ' gusting ' + w.gust_kt + ' kt' : '';
  const vrb  = w.variable ? ' (variable)' : '';
  return [dir, spd + gust + vrb].filter(Boolean).join(' / ');
}

// ── Render one METAR-style observation block ─────────────────
function renderObservation(parent, obs) {
  const cat = flightCategory(obs.clouds, obs.visibility_m);
  const block = el('div', 'wx-obs-block');

  // Header row: station + time + flight category badge
  const hdr = el('div', 'wx-obs-header');
  hdr.appendChild(el('span', 'wx-station', obs.station || '—'));
  if (obs.time) hdr.appendChild(el('span', 'wx-time', fmtTime(obs.time)));
  const badge = el('span', 'wx-cat-badge ' + cat.cls, cat.cat);
  badge.title = cat.label;
  hdr.appendChild(badge);
  block.appendChild(hdr);

  const grid = el('div', 'wx-grid');

  function wxRow(label, value, cls) {
    const row = el('div', 'wx-row');
    row.appendChild(el('span', 'wx-lbl', label));
    const val = el('span', cls ? 'wx-val ' + cls : 'wx-val', value);
    row.appendChild(val);
    grid.appendChild(row);
  }

  wxRow('Wind',        fmtWind(obs.wind));
  wxRow('Visibility',  fmtVisibility(obs.visibility_m));

  // Weather phenomena
  const phenomena = obs.phenomena || [];
  if (phenomena.length > 0) {
    wxRow('Present WX', phenomena.map(decodePhenomenon).join(' · '), 'wx-phenomena');
  }

  // Cloud layers
  if (obs.clouds && obs.clouds.length > 0) {
    obs.clouds.forEach((c, i) => {
      wxRow(i === 0 ? 'Sky Condition' : '', fmtCloudLayer(c));
    });
  } else if (String(obs.visibility_m).toUpperCase() === 'CAVOK') {
    wxRow('Sky Condition', 'CAVOK');
  }

  // Temperature / dewpoint
  if (obs.temperature_c != null || obs.dewpoint_c != null) {
    const tmp = obs.temperature_c != null ? obs.temperature_c + '°C' : '—';
    const dew = obs.dewpoint_c    != null ? obs.dewpoint_c    + '°C' : '—';
    wxRow('Temp / Dew', tmp + '  /  ' + dew);
  }

  // QNH
  if (obs.qnh_hpa != null) {
    const inhg = (obs.qnh_hpa / 33.8639).toFixed(2);
    wxRow('QNH', obs.qnh_hpa + ' hPa  (' + inhg + ' inHg)');
  }

  // Remarks / free text
  if (obs.remarks) {
    wxRow('Remarks', obs.remarks, 'wx-remarks');
  }

  block.appendChild(grid);
  parent.appendChild(block);
}

// ── Render one change group inside a TAF forecast ─────────────
function renderChangeGroup(parent, chg) {
  const grp = el('div', 'wx-chg-group');

  const typeLbl = WX_CHANGE_TYPE[String(chg.type || '').toUpperCase()] || chg.type || 'Change';
  const timeStr = [chg.from, chg.to].filter(Boolean).map(fmtTime).join(' – ');

  const hdr = el('div', 'wx-chg-header');
  hdr.appendChild(el('span', 'wx-chg-type', typeLbl));
  if (timeStr) hdr.appendChild(el('span', 'wx-chg-time', timeStr));
  grp.appendChild(hdr);

  const grid = el('div', 'wx-grid wx-chg-grid');

  function wxRow(label, value, cls) {
    const row = el('div', 'wx-row');
    row.appendChild(el('span', 'wx-lbl', label));
    row.appendChild(el('span', cls ? 'wx-val ' + cls : 'wx-val', value));
    grid.appendChild(row);
  }

  if (chg.wind)         wxRow('Wind',        fmtWind(chg.wind));
  if (chg.visibility_m) wxRow('Visibility',  fmtVisibility(chg.visibility_m));

  const phenomena = chg.phenomena || [];
  if (phenomena.length > 0) wxRow('Present WX', phenomena.map(decodePhenomenon).join(' · '), 'wx-phenomena');

  if (chg.clouds && chg.clouds.length > 0) {
    chg.clouds.forEach((c, i) => wxRow(i === 0 ? 'Sky' : '', fmtCloudLayer(c)));
  }

  if (chg.remarks) wxRow('Remarks', chg.remarks);

  grp.appendChild(grid);
  parent.appendChild(grp);
}

// ── Render one TAF-style forecast block ──────────────────────
function renderForecast(parent, taf) {
  const block = el('div', 'wx-taf-block');

  const hdr = el('div', 'wx-obs-header');
  hdr.appendChild(el('span', 'wx-station', taf.station || '—'));
  const issued   = taf.issued   ? 'Issued ' + fmtTime(taf.issued) : '';
  const validity = [taf.valid_from, taf.valid_to].filter(Boolean).map(fmtTime).join(' – ');
  if (issued)   hdr.appendChild(el('span', 'wx-time', issued));
  if (validity) hdr.appendChild(el('span', 'wx-time', 'Valid: ' + validity));
  block.appendChild(hdr);

  // Base conditions
  if (taf.conditions) {
    const base = el('div', 'wx-taf-base');
    base.appendChild(el('div', 'wx-taf-base-lbl', 'BASE CONDITIONS'));

    const grid = el('div', 'wx-grid');
    function wxRow(label, value, cls) {
      const row = el('div', 'wx-row');
      row.appendChild(el('span', 'wx-lbl', label));
      row.appendChild(el('span', cls ? 'wx-val ' + cls : 'wx-val', value));
      grid.appendChild(row);
    }

    const c = taf.conditions;
    if (c.wind)         wxRow('Wind',        fmtWind(c.wind));
    if (c.visibility_m) wxRow('Visibility',  fmtVisibility(c.visibility_m));
    const phenomena = c.phenomena || [];
    if (phenomena.length > 0) wxRow('Present WX', phenomena.map(decodePhenomenon).join(' · '), 'wx-phenomena');
    if (c.clouds && c.clouds.length > 0) {
      c.clouds.forEach((cl, i) => wxRow(i === 0 ? 'Sky' : '', fmtCloudLayer(cl)));
    }

    base.appendChild(grid);
    block.appendChild(base);
  }

  // Change groups (BECMG, TEMPO, FM…)
  if (taf.changes && taf.changes.length > 0) {
    taf.changes.forEach(chg => renderChangeGroup(block, chg));
  }

  parent.appendChild(block);
}

// ── Main render function ──────────────────────────────────────
function renderWEATHER(wx) {
  const div = document.getElementById('weather-content');
  div.innerHTML = '';

  if (!wx) {
    div.appendChild(el('div', 'empty-state', 'NO WEATHER DATA — add a weather: section to your package.yaml'));
    return;
  }

  // Package-level header
  const hdrItems = [];
  if (wx.issued)     hdrItems.push(['ISSUED',      wx.issued]);
  if (wx.valid_from) hdrItems.push(['VALID FROM',  wx.valid_from]);
  if (wx.valid_to)   hdrItems.push(['VALID TO',    wx.valid_to]);
  if (wx.operation)  hdrItems.push(['OPERATION',   wx.operation]);
  if (hdrItems.length > 0) docHeader(div, hdrItems);

  // ── METAR-style Observations ─────────────────────────────
  const obs = wx.observations || [];
  if (obs.length > 0) {
    docSection(div, 'CURRENT CONDITIONS (METAR)', s => {
      obs.forEach(o => renderObservation(s, o));
    });
  }

  // ── TAF-style Forecasts ───────────────────────────────────
  const forecasts = wx.forecasts || [];
  if (forecasts.length > 0) {
    docSection(div, 'FORECAST (TAF)', s => {
      forecasts.forEach(f => renderForecast(s, f));
    });
  }

  // ── Mission-specific weather notes ───────────────────────
  const msnWx = wx.mission_wx || [];
  if (msnWx.length > 0) {
    docSection(div, 'MISSION WEATHER NOTES', s => {
      msnWx.forEach(mw => {
        const row = el('div', 'wx-msn-row');
        row.appendChild(el('span', 'wx-msn-ref', mw.mission_ref || '—'));
        const note = el('span', 'wx-msn-note', mw.notes || '');
        if (mw.style) note.style.color = `var(--${mw.style})`;
        row.appendChild(note);
        s.appendChild(row);
      });
    });
  }
}
