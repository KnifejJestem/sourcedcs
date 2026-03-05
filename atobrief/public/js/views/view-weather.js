// ═══════════════════════════════════════════════════════════
// view-weather.js — Weather tab renderer
//
// Accepts raw METAR and TAF strings in the YAML:
//
//   weather:
//     metars:
//       - 'METAR OMAM 011850Z 31012G18KT 9999 FEW040 SCT080 28/08 Q1013 NOSIG'
//     tafs:
//       - 'TAF OMAM 011700Z 0120/0206 30010KT 9999 FEW040
//              BECMG 0122/0124 27008KT
//              TEMPO 0200/0202 TS BKN020 4000'
//     mission_wx:
//       - { mission_ref: MSN3266, notes: Clear at CAP. No impact. }
// ═══════════════════════════════════════════════════════════

'use strict';

// ─── Cloud coverage abbreviations ────────────────────────────
const WX_COVERAGE = {
  SKC: 'Sky Clear', CLR: 'Clear', NSC: 'No Significant Cloud',
  NCD: 'No Cloud Detected', FEW: 'Few', SCT: 'Scattered',
  BKN: 'Broken', OVC: 'Overcast', VV:  'Vertical Visibility',
};

// ─── Known compound / modified phenomenon tokens ─────────────
// Checked first; the generic decoder handles anything not listed.
const WX_COMPOUND = {
  'TSRA':   'Thunderstorm with Rain',
  '+TSRA':  'Heavy Thunderstorm with Rain',
  '-TSRA':  'Light Thunderstorm with Rain',
  'TSGR':   'Thunderstorm with Hail',
  'TSPL':   'Thunderstorm with Ice Pellets',
  'TSSN':   'Thunderstorm with Snow',
  'RASN':   'Rain and Snow',
  'SNRA':   'Snow and Rain',
  'FZRA':   'Freezing Rain',
  '+FZRA':  'Heavy Freezing Rain',
  '-FZRA':  'Light Freezing Rain',
  'FZDZ':   'Freezing Drizzle',
  '-FZDZ':  'Light Freezing Drizzle',
  'FZFG':   'Freezing Fog',
  'SHRA':   'Rain Showers',
  '+SHRA':  'Heavy Rain Showers',
  '-SHRA':  'Light Rain Showers',
  'SHSN':   'Snow Showers',
  '-SHSN':  'Light Snow Showers',
  '+SHSN':  'Heavy Snow Showers',
  'SHGR':   'Hail Showers',
  'SHGS':   'Small Hail Showers',
  'SHPL':   'Ice Pellet Showers',
  'SHPE':   'Ice Pellet Showers',
  'DRSN':   'Drifting Snow',
  'DRDU':   'Drifting Dust',
  'DRSA':   'Drifting Sand',
  'BLSN':   'Blowing Snow',
  '+BLSN':  'Heavy Blowing Snow',
  'BLDU':   'Blowing Dust',
  'BLSA':   'Blowing Sand',
  'BCFG':   'Patchy Fog',
  'MIFG':   'Shallow Fog',
  'PRFG':   'Partial Fog',
  'VCSH':   'Showers in Vicinity',
  'VCTS':   'Thunderstorm in Vicinity',
  'VCFG':   'Fog in Vicinity',
  'VCBLSN': 'Blowing Snow in Vicinity',
  'VCVA':   'Volcanic Ash in Vicinity',
  'VCDS':   'Duststorm in Vicinity',
  'VCSS':   'Sandstorm in Vicinity',
  '+RA':    'Heavy Rain',
  '-RA':    'Light Rain',
  '+SN':    'Heavy Snow',
  '-SN':    'Light Snow',
  '+DZ':    'Heavy Drizzle',
  '-DZ':    'Light Drizzle',
  '+SG':    'Heavy Snow Grains',
  '-SG':    'Light Snow Grains',
  '+GR':    'Heavy Hail',
  '-GR':    'Light Hail',
  '+SS':    'Heavy Sandstorm',
  '-SS':    'Light Sandstorm',
  '+DS':    'Heavy Duststorm',
  '-DS':    'Light Duststorm',
};

// ─── Simple phenomena (no prefix/descriptor) ─────────────────
const WX_SIMPLE = {
  DZ: 'Drizzle', RA: 'Rain', SN: 'Snow', SG: 'Snow Grains',
  IC: 'Ice Crystals', PL: 'Ice Pellets', GR: 'Hail', GS: 'Small Hail',
  UP: 'Unknown Precipitation',
  BR: 'Mist', FG: 'Fog', FU: 'Smoke', VA: 'Volcanic Ash',
  DU: 'Dust', SA: 'Sand', HZ: 'Haze', PY: 'Spray',
  PO: 'Dust/Sand Whirls', SQ: 'Squall', FC: 'Funnel Cloud',
  SS: 'Sandstorm', DS: 'Duststorm', TS: 'Thunderstorm',
};

// Descriptor prefixes used by the generic fallback in decodePhenomenon
const WX_DESCRIPTORS = { MI:'Shallow', PR:'Partial', BC:'Patches of',
  DR:'Low Drifting', BL:'Blowing', SH:'Showers of', FZ:'Freezing' };

// Decode one present-weather token to plain English.
// Compound lookup first, then a generic prefix-stripping fallback.
function decodePhenomenon(token) {
  const t = String(token).toUpperCase();
  if (WX_COMPOUND[t]) return WX_COMPOUND[t];
  if (WX_SIMPLE[t])   return WX_SIMPLE[t];

  // Generic fallback: strip intensity / VC prefixes then look up remainder
  let s = t;
  const parts = [];
  if (s[0] === '-') { parts.push('Light'); s = s.slice(1); }
  else if (s[0] === '+') { parts.push('Heavy'); s = s.slice(1); }

  if (s.startsWith('VC')) { s = s.slice(2); parts.push('in Vicinity'); }

  // Descriptor prefixes (SH/TS handled separately below)
  for (const [code, label] of Object.entries(WX_DESCRIPTORS)) {
    if (s.startsWith(code) && s.length > code.length) {
      parts.unshift(label);
      s = s.slice(code.length);
      break;
    }
  }
  // TS as descriptor ("thunderstorm with X")
  if (s.startsWith('TS') && s.length > 2) {
    parts.unshift('Thunderstorm with');
    s = s.slice(2);
  }

  const base = WX_SIMPLE[s];
  if (base) { parts.push(base); return parts.join(' '); }

  return token; // last resort: return original token
}

// ─── Wind token parser ────────────────────────────────────────
// Handles: DDDSSKTor DDDSSGSSGKT, VRBSSKTor 00000KT, MPS, KMH
function parseWind(token) {
  const m = token.match(/^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/);
  if (!m) return null;
  const factor = m[4] === 'MPS' ? 1.94384 : m[4] === 'KMH' ? 0.539957 : 1;
  const w = { speed_kt: Math.round(parseFloat(m[2]) * factor) };
  if (m[1] === 'VRB') w.variable = true;
  else w.direction_deg = parseInt(m[1]);
  if (m[3]) w.gust_kt = Math.round(parseFloat(m[3]) * factor);
  return w;
}

// Format a parsed wind object to plain English
function fmtWind(w) {
  if (!w) return '—';
  if (w.variable && !w.direction_deg && w.speed_kt === 0) return 'Calm';
  if (!w.variable && w.direction_deg === 0 && w.speed_kt === 0) return 'Calm';
  if (w.variable && !w.direction_deg) {
    return 'Variable at ' + w.speed_kt + ' kt';
  }
  const dir = String(w.direction_deg).padStart(3, '0') + '°';
  let s = dir + '  ' + w.speed_kt + ' kt';
  if (w.gust_kt) s += ' gusting ' + w.gust_kt + ' kt';
  if (w.variable_from != null) {
    s += '  (variable ' + w.variable_from + '°–' + w.variable_to + '°)';
  }
  return s;
}

// Parse a simple numeric fraction string like "1/4" or "3" — no eval
function parseFraction(s) {
  const m = s.match(/^(\d+)\/(\d+)$/);
  if (m) {
    const denom = parseInt(m[2]);
    return denom !== 0 ? parseInt(m[1]) / denom : 0;
  }
  return parseFloat(s) || 0;
}

// Format visibility to readable text
function fmtVisibility(m_val, sm_raw) {
  if (sm_raw != null) {
    const sm = parseFraction(String(sm_raw).replace(/SM$/, '').replace(/^M/, ''));
    const km = (sm * 1.609).toFixed(1);
    return sm_raw + '  (' + km + ' km)';
  }
  if (m_val == null) return '—';
  if (m_val >= 9999) return '≥10 km';
  if (m_val >= 1000) return (m_val / 1000).toFixed(1) + ' km  (' + m_val + ' m)';
  return m_val + ' m';
}

// Format a cloud layer object to plain English
function fmtCloud(c) {
  if (!c) return '—';
  const cov = WX_COVERAGE[c.coverage] || c.coverage;
  if (!c.base_ft && c.base_ft !== 0) return cov;
  let s = cov + ' at ' + c.base_ft + ' ft AGL';
  if (c.cb)  s += '  (Cumulonimbus)';
  if (c.tcu) s += '  (Towering Cumulus)';
  return s;
}

// Temperature string "M05" → -5, "12" → 12
function parseTempC(s) {
  if (!s) return null;
  return (s.startsWith('M') ? -1 : 1) * parseInt(s.replace('M', ''));
}

// Format a TAF validity period token "DDHH" → "Day DD  HH:00Z/L"
function fmtTAFPeriod(ddhh) {
  if (!ddhh || ddhh.length !== 4) return ddhh;
  const day  = parseInt(ddhh.slice(0, 2));
  const hour = parseInt(ddhh.slice(2));
  const suffix = STATE.display.timeMode;
  if (suffix === 'L') {
    const off = STATE.pkg?.ato?.local_offset_hours || 0;
    const localHour = hour + off;
    const dayAdj = localHour >= 24 ? 1 : localHour < 0 ? -1 : 0;
    const adjDay  = day + dayAdj;
    const adjHour = ((localHour % 24) + 24) % 24;
    return 'Day ' + String(adjDay).padStart(2, '0') + '  ' +
           String(adjHour).padStart(2, '0') + ':00L';
  }
  return 'Day ' + ddhh.slice(0, 2) + '  ' + ddhh.slice(2) + ':00Z';
}

// Format a TAF FM time token "DDHHmm" → "Day DD  HH:mmZ/L"
function fmtFMTime(ddhhnn) {
  if (!ddhhnn || ddhhnn.length !== 6) return ddhhnn;
  const day  = parseInt(ddhhnn.slice(0, 2));
  const hour = parseInt(ddhhnn.slice(2, 4));
  const min  = ddhhnn.slice(4);
  const suffix = STATE.display.timeMode;
  if (suffix === 'L') {
    const off = STATE.pkg?.ato?.local_offset_hours || 0;
    const localHour = hour + off;
    const dayAdj = localHour >= 24 ? 1 : localHour < 0 ? -1 : 0;
    const adjDay  = day + dayAdj;
    const adjHour = ((localHour % 24) + 24) % 24;
    return 'Day ' + String(adjDay).padStart(2, '0') + '  ' +
           String(adjHour).padStart(2, '0') + ':' + min + 'L';
  }
  return 'Day ' + ddhhnn.slice(0, 2) + '  ' +
         ddhhnn.slice(2, 4) + ':' + ddhhnn.slice(4) + 'Z';
}

// Format a change group type label — handles any PROBnn dynamically
function fmtChangeType(grp) {
  const typeLabels = { BECMG: 'Becoming', TEMPO: 'Temporary', FM: 'From' };
  const parts = [];
  if (grp.probability != null) parts.push(grp.probability + '% Probability');
  if (grp.type && grp.type !== 'PROB') {
    parts.push(typeLabels[grp.type] || grp.type);
  }
  return parts.join(' — ') || 'Change';
}

// ─── Shared weather condition token parser ────────────────────
// Present-weather token pattern (ICAO Annex 3).
// TS and SH appear in both the optional descriptor group and the phenomenon
// group intentionally: TS can be standalone ("Thunderstorm") or a descriptor
// ("TSRA" = "Thunderstorm with Rain"); similarly SH ("Showers") / "SHRA".
const WX_PAT = /^([-+])?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|VA|BR|FU|HZ|DU|SA|PY|PO|SQ|FC|SS|DS|TS|SH)+$/;
const CLOUD_PAT     = /^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/;
const NIL_CLOUD_PAT = /^(SKC|CLR|NSC|NCD)$/;

// Parse wind, visibility, phenomena, clouds from a token array slice.
// Returns the parsed fields and the index after the last consumed token.
function parseWxGroup(tokens, start) {
  const g = { phenomena: [], clouds: [] };
  let i = start;

  // Wind
  const w = tokens[i] && parseWind(tokens[i]);
  if (w) {
    g.wind = w; i++;
    // Variable direction range e.g. 280V340
    if (tokens[i] && /^\d{3}V\d{3}$/.test(tokens[i])) {
      g.wind.variable_from = parseInt(tokens[i].slice(0, 3));
      g.wind.variable_to   = parseInt(tokens[i].slice(4));
      i++;
    }
  }

  // CAVOK or visibility
  if (tokens[i] === 'CAVOK') {
    g.cavok = true; i++;
  } else if (tokens[i] && /^\d{4}$/.test(tokens[i])) {
    g.visibility_m = parseInt(tokens[i++]);
    if (tokens[i] && /^[NSEW]{1,2}$/.test(tokens[i])) i++; // direction qualifier
  } else if (tokens[i] && /SM$/.test(tokens[i])) {
    // US statute-mile visibility: 10SM, 1/4SM, M1/4SM
    const raw = tokens[i++];
    g.visibility_sm = raw;
    const num = raw.replace(/^M/, '').replace('SM', '');
    g.visibility_m = Math.round(parseFraction(num) * 1609.34);
  }

  // Skip RVR groups (R28L/1200FT, etc.)
  while (tokens[i] && /^R\d{2}[LCR]?\/./.test(tokens[i])) i++;

  // Present weather
  while (tokens[i] && WX_PAT.test(tokens[i])) g.phenomena.push(tokens[i++]);

  // Cloud layers / sky-clear conditions
  while (tokens[i]) {
    const cm = tokens[i].match(CLOUD_PAT);
    const nm = tokens[i].match(NIL_CLOUD_PAT);
    if (cm) {
      g.clouds.push({
        coverage: cm[1], base_ft: parseInt(cm[2]) * 100,
        cb: cm[3] === 'CB', tcu: cm[3] === 'TCU',
      });
      i++;
    } else if (nm) {
      g.clouds.push({ coverage: nm[1] });
      i++;
    } else {
      break;
    }
  }
  return { group: g, next: i };
}

// ─── Flight category ──────────────────────────────────────────
function flightCategory(clouds, visibility_m, cavok) {
  if (cavok) return { cat: 'VFR', label: 'VFR (CAVOK)', cls: 'wx-vfr' };
  const vis_sm = visibility_m != null ? visibility_m / 1609.34 : null;
  let ceilingFt = null;
  (clouds || []).forEach(c => {
    if ((c.coverage === 'BKN' || c.coverage === 'OVC' || c.coverage === 'VV') &&
        c.base_ft != null) {
      if (ceilingFt === null || c.base_ft < ceilingFt) ceilingFt = c.base_ft;
    }
  });
  if ((ceilingFt !== null && ceilingFt < 500)  || (vis_sm !== null && vis_sm < 1))
    return { cat: 'LIFR', label: 'Low IFR',     cls: 'wx-lifr' };
  if ((ceilingFt !== null && ceilingFt < 1000) || (vis_sm !== null && vis_sm < 3))
    return { cat: 'IFR',  label: 'IFR',         cls: 'wx-ifr'  };
  if ((ceilingFt !== null && ceilingFt < 3000) || (vis_sm !== null && vis_sm < 5))
    return { cat: 'MVFR', label: 'Marginal VFR', cls: 'wx-mvfr' };
  return { cat: 'VFR', label: 'VFR', cls: 'wx-vfr' };
}

// ─── METAR PARSER ─────────────────────────────────────────────
function parseMetar(raw) {
  const s = raw.trim().replace(/=\s*$/, '');
  const tokens = s.split(/\s+/);
  let i = 0;
  const r = { raw: s };

  // Optional type / modifier prefix
  if (tokens[i] === 'METAR' || tokens[i] === 'SPECI') i++;
  if (tokens[i] === 'COR'   || tokens[i] === 'AMD')   i++;

  // Station (4-letter ICAO)
  if (/^[A-Z]{4}$/.test(tokens[i])) r.station = tokens[i++];

  // Date/time: DDHHMMZ
  if (tokens[i] && /^\d{6}Z$/.test(tokens[i])) {
    const dt = tokens[i++];
    r.day  = dt.slice(0, 2);
    r.time = dt.slice(2, 4) + dt.slice(4, 6) + 'Z';
  }

  // AUTO / COR repeated
  if (tokens[i] === 'AUTO' || tokens[i] === 'COR' || tokens[i] === 'CORR') i++;

  const { group: wx, next: j } = parseWxGroup(tokens, i);
  i = j;
  Object.assign(r, wx);

  // Temperature / dewpoint: T/T or M01/M02
  if (tokens[i] && /^M?\d+\/M?\d+$/.test(tokens[i])) {
    const [t, d] = tokens[i++].split('/');
    r.temperature_c = parseTempC(t);
    r.dewpoint_c    = parseTempC(d);
  }

  // QNH: Q1013 (hPa) or A2992 (inHg × 100)
  if (tokens[i] && /^Q\d{4}$/.test(tokens[i])) {
    r.qnh_hpa = parseInt(tokens[i++].slice(1));
  } else if (tokens[i] && /^A\d{4}$/.test(tokens[i])) {
    const inhg = parseInt(tokens[i++].slice(1)) / 100;
    r.qnh_inhg = inhg;
    r.qnh_hpa  = Math.round(inhg * 33.8639);
  }

  // NOSIG / TREND indicator
  if (tokens[i] === 'NOSIG') { r.nosig = true; i++; }

  // US remarks section after RMK
  const rmk = tokens.indexOf('RMK', i);
  if (rmk !== -1) r.remarks = tokens.slice(rmk + 1).join(' ');

  return r;
}

// ─── TAF PARSER ───────────────────────────────────────────────
// Splits a TAF token array at change-group boundaries.
// PROBnn immediately followed by TEMPO/BECMG counts as ONE group.
function splitTAFGroups(tokens) {
  const breaks = [];
  for (let j = 0; j < tokens.length; j++) {
    if (/^PROB\d{2}$/.test(tokens[j])) {
      breaks.push(j);
    } else if (tokens[j] === 'BECMG' || tokens[j] === 'TEMPO') {
      // Skip if immediately after a PROBnn (same group)
      const prevBreak = breaks[breaks.length - 1];
      const afterProb = prevBreak != null &&
                        /^PROB\d{2}$/.test(tokens[prevBreak]) &&
                        prevBreak === j - 1;
      if (!afterProb) breaks.push(j);
    } else if (tokens[j] === 'FM') {
      breaks.push(j);
    }
  }
  const base = tokens.slice(0, breaks[0] ?? tokens.length);
  const groups = breaks.map((start, gi) =>
    tokens.slice(start, breaks[gi + 1] ?? tokens.length)
  );
  return { base, groups };
}

function parseTAFConditions(tokens) {
  return parseWxGroup(tokens, 0).group;
}

function parseTAFChangeGroup(tokens) {
  const grp = {};
  let i = 0;

  // PROBnn — probability (handles any value: PROB20, PROB30, PROB40…)
  if (/^PROB(\d{2})$/.test(tokens[i])) {
    grp.probability = parseInt(tokens[i].slice(4));
    i++;
  }

  // Change type keyword
  if (tokens[i] === 'BECMG' || tokens[i] === 'TEMPO') {
    grp.type = tokens[i++];
  } else if (tokens[i] === 'FM') {
    grp.type = 'FM'; i++;
    if (tokens[i] && /^\d{6}$/.test(tokens[i])) {
      grp.from = fmtFMTime(tokens[i++]);
    }
  } else if (!grp.probability) {
    // Unknown keyword — consume it and flag for display
    grp.type = tokens[i++] || 'UNKNOWN';
  }

  // Validity period DDHH/DDHH (for BECMG, TEMPO, PROBnn)
  if (tokens[i] && /^\d{4}\/\d{4}$/.test(tokens[i])) {
    const [from, to] = tokens[i++].split('/');
    grp.from = fmtTAFPeriod(from);
    grp.to   = fmtTAFPeriod(to);
  }

  // Weather conditions for this change group
  const { group: cond } = parseWxGroup(tokens, i);
  return Object.assign(grp, cond);
}

function parseTAF(raw) {
  // Normalize: join continuation lines, strip trailing =
  const s = raw.trim().replace(/\s+/g, ' ').replace(/=\s*$/, '');
  const tokens = s.split(' ');
  let i = 0;
  const r = { raw: s };

  if (tokens[i] === 'TAF') i++;
  if (tokens[i] === 'AMD' || tokens[i] === 'COR') { r.amend = tokens[i++]; }

  if (/^[A-Z]{4}$/.test(tokens[i])) r.station = tokens[i++];

  if (tokens[i] && /^\d{6}Z$/.test(tokens[i])) {
    const dt = tokens[i++];
    r.issued_day  = dt.slice(0, 2);
    r.issued_time = dt.slice(2, 4) + dt.slice(4, 6) + 'Z';
  }

  if (tokens[i] === 'NIL') return { ...r, nil: true };

  if (tokens[i] && /^\d{4}\/\d{4}$/.test(tokens[i])) {
    const [from, to] = tokens[i++].split('/');
    r.valid_from = fmtTAFPeriod(from);
    r.valid_to   = fmtTAFPeriod(to);
  }

  const { base, groups } = splitTAFGroups(tokens.slice(i));
  r.conditions = parseTAFConditions(base);
  r.changes    = groups.map(parseTAFChangeGroup);

  return r;
}

// ─── DOM BUILDERS ─────────────────────────────────────────────
function wxBlock(cls) {
  return el('div', cls);
}

// Build a weather data row and append to parent
function wxRow(parent, label, value, valueCls) {
  const row = el('div', 'wx-row');
  row.appendChild(el('span', 'wx-lbl', label));
  row.appendChild(el('span', valueCls ? 'wx-val ' + valueCls : 'wx-val', value));
  parent.appendChild(row);
}

// Append decoded weather condition rows (shared by METAR and TAF groups)
function appendConditionRows(grid, g) {
  if (g.wind)         wxRow(grid, 'Wind',         fmtWind(g.wind));
  if (g.cavok) {
    wxRow(grid, 'Visibility',   'CAVOK  (≥10 km, no significant cloud, no weather)');
  } else {
    if (g.visibility_m != null || g.visibility_sm != null) {
      wxRow(grid, 'Visibility',  fmtVisibility(g.visibility_m, g.visibility_sm));
    }
    if (g.phenomena.length > 0) {
      wxRow(grid, 'Present WX',
        g.phenomena.map(decodePhenomenon).join('  ·  '), 'wx-phenomena');
    }
    if (g.clouds.length > 0) {
      g.clouds.forEach((c, ci) =>
        wxRow(grid, ci === 0 ? 'Sky Condition' : '', fmtCloud(c)));
    }
  }
}

// ─── RENDER: one METAR ────────────────────────────────────────
function renderMetar(parent, raw) {
  const m = parseMetar(raw);
  const cat = flightCategory(m.clouds, m.visibility_m, m.cavok);

  const block = el('div', 'wx-obs-block');

  // Header: station · time · flight-category badge
  const hdr = el('div', 'wx-obs-header');
  hdr.appendChild(el('span', 'wx-station', m.station || '—'));
  if (m.day || m.time) {
    hdr.appendChild(el('span', 'wx-time',
      [(m.day ? 'Day ' + m.day : ''), fmtTime(m.time)].filter(Boolean).join('  ')));
  }
  const badge = el('span', 'wx-cat-badge ' + cat.cls, cat.cat);
  badge.title = cat.label;
  hdr.appendChild(badge);
  block.appendChild(hdr);

  // Raw string (monospace, small)
  const rawEl = el('div', 'wx-raw', m.raw);
  block.appendChild(rawEl);

  const grid = el('div', 'wx-grid');
  appendConditionRows(grid, m);

  // Temperature / dewpoint
  if (m.temperature_c != null || m.dewpoint_c != null) {
    const t = m.temperature_c != null ? m.temperature_c + '°C' : '—';
    const d = m.dewpoint_c    != null ? m.dewpoint_c    + '°C' : '—';
    wxRow(grid, 'Temp / Dew', t + '  /  ' + d);
  }

  // QNH
  if (m.qnh_hpa != null) {
    const inhg = m.qnh_inhg != null
      ? m.qnh_inhg.toFixed(2)
      : (m.qnh_hpa / 33.8639).toFixed(2);
    wxRow(grid, 'QNH', m.qnh_hpa + ' hPa  (' + inhg + ' inHg)');
  }

  // NOSIG
  if (m.nosig) wxRow(grid, 'Trend', 'NOSIG — No Significant Change');

  // US remarks
  if (m.remarks) wxRow(grid, 'Remarks', m.remarks, 'wx-remarks');

  block.appendChild(grid);
  parent.appendChild(block);
}

// ─── RENDER: one TAF ─────────────────────────────────────────
function renderTaf(parent, raw) {
  const t = parseTAF(raw);

  const block = el('div', 'wx-taf-block');

  // Header
  const hdr = el('div', 'wx-obs-header');
  hdr.appendChild(el('span', 'wx-station', t.station || '—'));
  if (t.issued_day || t.issued_time) {
    hdr.appendChild(el('span', 'wx-time',
      'Issued Day ' + (t.issued_day || '??') + '  ' + (fmtTime(t.issued_time) || '')));
  }
  if (t.valid_from || t.valid_to) {
    hdr.appendChild(el('span', 'wx-time',
      'Valid: ' + (t.valid_from || '—') + ' – ' + (t.valid_to || '—')));
  }
  if (t.amend) hdr.appendChild(el('span', 'wx-chg-type', t.amend));
  block.appendChild(hdr);

  // Raw string
  block.appendChild(el('div', 'wx-raw', t.raw));

  if (t.nil) {
    block.appendChild(el('div', 'wx-row', 'NIL — No forecast issued'));
    parent.appendChild(block);
    return;
  }

  // Base (prevailing) conditions
  const base = el('div', 'wx-taf-base');
  base.appendChild(el('div', 'wx-taf-base-lbl', 'PREVAILING CONDITIONS'));
  const baseGrid = el('div', 'wx-grid');
  appendConditionRows(baseGrid, t.conditions);
  base.appendChild(baseGrid);
  block.appendChild(base);

  // Change groups
  (t.changes || []).forEach(chg => {
    const grp = el('div', 'wx-chg-group');

    const ghdr = el('div', 'wx-chg-header');
    ghdr.appendChild(el('span', 'wx-chg-type', fmtChangeType(chg)));
    const period = [chg.from, chg.to].filter(Boolean).join(' – ');
    if (period) ghdr.appendChild(el('span', 'wx-chg-time', period));
    grp.appendChild(ghdr);

    const chgGrid = el('div', 'wx-grid wx-chg-grid');
    appendConditionRows(chgGrid, chg);
    grp.appendChild(chgGrid);

    block.appendChild(grp);
  });

  parent.appendChild(block);
}

// ─── MAIN RENDER ─────────────────────────────────────────────
function renderWEATHER(wx) {
  const div = document.getElementById('weather-content');
  div.innerHTML = '';

  if (!wx) {
    div.appendChild(el('div', 'empty-state',
      'NO WEATHER DATA — add a weather: section to your package.yaml'));
    return;
  }

  // Edit button (visible in edit mode)
  const editBtn = el('button', 'editor-btn', '✎ EDIT WEATHER');
  editBtn.addEventListener('click', openWeatherEditor);
  div.appendChild(editBtn);

  // Optional package-level header
  const hdrItems = [];
  if (wx.operation)  hdrItems.push(['OPERATION',  wx.operation]);
  if (wx.issued)     hdrItems.push(['ISSUED',      wx.issued]);
  if (wx.valid_from) hdrItems.push(['VALID FROM',  wx.valid_from]);
  if (wx.valid_to)   hdrItems.push(['VALID TO',    wx.valid_to]);
  if (hdrItems.length > 0) docHeader(div, hdrItems);

  // ── METARs ─────────────────────────────────────────────────
  const metars = wx.metars || [];
  if (metars.length > 0) {
    docSection(div, 'CURRENT CONDITIONS  (METAR)', s => {
      metars.forEach(raw => renderMetar(s, String(raw)));
    });
  }

  // ── TAFs ───────────────────────────────────────────────────
  const tafs = wx.tafs || [];
  if (tafs.length > 0) {
    docSection(div, 'FORECAST  (TAF)', s => {
      tafs.forEach(raw => renderTaf(s, String(raw)));
    });
  }

  // ── Mission-specific weather notes ─────────────────────────
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
