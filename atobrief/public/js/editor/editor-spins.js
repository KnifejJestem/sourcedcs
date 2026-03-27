// ═══════════════════════════════════════════════════════════
// editor-spins.js — SPINS section editor
//
// Data model: sections store content as a `markdown` string
// (plus an optional `table` object for structured data).
// No more `entries` arrays.
//
// Section editors:
//   C1 / COMMAND & CONTROL — structured: registry agency list
//     (read-only, refreshable) + mission callsign dropdown for
//     package lead.  Saves content as markdown.
//   C3 / IFF               — table editor only; IFF squawk
//     codes are randomised on auto-build.
//   All other sections     — plain markdown textarea with an
//     optional preset picker (C4, C7–C11).
//
// Preset data lives in spins-presets.json and is loaded once
// at startup into window.SPINS_PRESETS by app.js.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Section type detectors ────────────────────────────────
function _spinsIsCommandControl(title) {
  return /\bc1\b|command.*control/i.test(title || '');
}
function _spinsIsIff(title) {
  return /\bc3\b|iff\b/i.test(title || '');
}
function _spinsPresetCategory(title) {
  if (/\bc4\b|rules of engagement|roe/i.test(title))    return 'roe';
  if (/\bc7\b|lost comms/i.test(title))                 return 'lost_comms';
  if (/\bc8\b|abort crit/i.test(title))                 return 'abort_criteria';
  if (/\bc9\b|search.*rescue|sar/i.test(title))         return 'sar';
  if (/\bc10\b|authentication/i.test(title))            return 'authentication';
  if (/\bc11\b|safety/i.test(title))                    return 'safety';
  return null;
}

// ── Convert preset entries array → markdown string ────────
function _entriesToMarkdown(entries) {
  return (entries || []).map(function (e) {
    if (e.heading != null) return '## ' + e.heading;
    if (e.label != null)   return '**' + e.label + '**: ' + (e.value != null ? e.value : '');
    if (e.bullet != null)  return '- ' + e.bullet;
    if (e.value != null)   return String(e.value);
    return '';
  }).filter(function (l) { return l !== ''; }).join('\n');
}

// ── Random valid octal Mode-3 squawk, no emergency codes ──
// exclude: Set<string> of already-used codes
function _randomSquawkCode(exclude) {
  var forbidden = new Set(['7500', '7600', '7700']);
  var code;
  do {
    code = '';
    for (var i = 0; i < 4; i++) code += String(Math.floor(Math.random() * 8));
  } while (forbidden.has(code) || exclude.has(code));
  return code;
}

// ── Open SPINS list editor ────────────────────────────────
function openSpinsEditor() {
  var sp = editorEnsureSection('spins');

  openEditorDialog('EDIT SPINS', function (body) {
    editorSectionTitle(body, 'HEADER');
    var fOp  = editorField(body, 'Operation',     sp.operation);
    var fVer = editorField(body, 'Version',        sp.version);
    var fCls = editorField(body, 'Classification', sp.classification);

    body._spinsHeader = { op: fOp, ver: fVer, cls: fCls };

    var sections = (sp.sections || []).map(function (s) { return Object.assign({}, s); });
    body._spinsSections = sections;

    editorSectionTitle(body, 'SECTIONS');
    var listEl = el('div', 'ef-list-items');
    _renderSpinsSectionsList(listEl, body._spinsSections);
    body.appendChild(listEl);
  }, function () {
    var body = document.getElementById('editorBody');
    var h = body._spinsHeader;
    var sp = editorEnsureSection('spins');
    sp.operation      = h.op.value || undefined;
    sp.version        = h.ver.value || undefined;
    sp.classification = h.cls.value || undefined;
    sp.sections       = body._spinsSections;
    editorReRender('spins');
  });
}

function _renderSpinsSectionsList(container, sections) {
  container.innerHTML = '';
  sections.forEach(function (sec, i) {
    var label = sec.title || 'Section ' + (i + 1);
    editorItemRow(container, label,
      function () { _editSpinsSection(sections, i); },
      function () {
        sections.splice(i, 1);
        _renderSpinsSectionsList(container, sections);
      }
    );
  });
}

// ── Edit a single SPINS section ──────────────────────────
function _editSpinsSection(sections, index) {
  var sec = sections[index];
  var isC1        = _spinsIsCommandControl(sec.title);
  var isIff       = _spinsIsIff(sec.title);
  var presetCat   = _spinsPresetCategory(sec.title);

  openEditorDialog('EDIT SPINS SECTION', function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO SPINS');
    backBtn.addEventListener('click', function () {
      _collectSpinsSection(sections, index);
      openSpinsEditor();
    });
    body.appendChild(backBtn);

    var fTitle = editorField(body, 'Title', sec.title,
      { placeholder: 'e.g. C5 — EXECUTION', disabled: true });
    var fNote  = editorField(body, 'Note',  sec.note,
      { placeholder: 'Optional section note' });

    if (isC1) {
      // ── C1 — registry agencies + package lead dropdown ──
      _buildC1SectionEditor(body, sec);
    } else if (isIff) {
      // ── C3 — table editor only ──────────────────────────
      var tableData = sec.table ? JSON.parse(JSON.stringify(sec.table)) : null;
      if (!tableData) tableData = _buildMissionIffTable();
      _buildSpinsTableEditor(body, tableData);
    } else {
      // ── All other sections — markdown textarea ───────────
      if (presetCat) {
        _buildPresetPickerRow(body, presetCat);
      }
      _buildMarkdownEditor(body, sec);
    }

    body._spinsSecFields = { title: fTitle, note: fNote };
    body._spinsSections  = sections;
    body._spinsSecIndex  = index;
  }, function () {
    _collectSpinsSection(sections, index);
    editorReRender('spins');
  });
}

// ── Collect section fields → save to in-memory array ─────
function _collectSpinsSection(sections, index) {
  var body = document.getElementById('editorBody');
  if (!body || !body._spinsSecFields) return;
  var sec = sections[index];
  sec.title = body._spinsSecFields.title.value || '';
  sec.note  = body._spinsSecFields.note.value  || undefined;

  if (body._spinsC1Mode) {
    sec.markdown = _generateC1Markdown(body);
  } else if (body._spinsMarkdownArea) {
    sec.markdown = body._spinsMarkdownArea.value;
  }

  if (body._spinsTableEnabled && body._spinsTableHeaders) {
    sec.table = {
      headers: body._spinsTableHeaders,
      rows:    body._spinsTableRows || [],
    };
  } else if (!body._spinsTableEnabled) {
    delete sec.table;
  }

  editorEnsureSection('spins').sections = sections;
}

// ── C1 structured editor ─────────────────────────────────
// Shows registry agencies (readonly, refreshable) and a
// package lead dropdown.  Saves as markdown on collect.
function _buildC1SectionEditor(body, sec) {
  body._spinsC1Mode = true;

  // Tactical control block
  editorSectionTitle(body, 'TACTICAL CONTROL');
  var hint = el('div', 'ef-hint',
    '\u21b3 Populated from registry control agencies. ' +
    'Add agencies in the Registry editor to update this list.');
  body.appendChild(hint);

  var agenciesEl = el('div', 'ef-list-items');
  body._spinsC1AgenciesEl = agenciesEl;
  _renderC1Agencies(agenciesEl);
  body.appendChild(agenciesEl);

  var refreshBtn = el('button', 'ef-btn ef-btn-sm', '\u21ba REFRESH FROM REGISTRY');
  refreshBtn.addEventListener('click', function () {
    _renderC1Agencies(agenciesEl);
  });
  body.appendChild(refreshBtn);

  // Package lead block
  editorSectionTitle(body, 'PACKAGE LEAD');
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];

  // Parse current package lead from existing markdown
  var currentLead = '';
  var m = (sec.markdown || '').match(/\*\*PACKAGE LEAD\*\*:\s*(\S.*)/);
  if (m) currentLead = m[1].trim();

  var pkgRow = el('div', 'ef-ap-row');
  var pkgSel = document.createElement('select');
  pkgSel.className = 'ef-input';
  var blankOpt = document.createElement('option');
  blankOpt.value = '';
  blankOpt.textContent = '\u2014 select callsign \u2014';
  pkgSel.appendChild(blankOpt);
  missions.forEach(function (msn) {
    var cs = msn.callsign || '';
    if (!cs) return;
    var opt = document.createElement('option');
    opt.value = cs;
    opt.textContent = cs + (msn.mission_type ? ' (' + msn.mission_type + ')' : '');
    if (cs === currentLead) opt.selected = true;
    pkgSel.appendChild(opt);
  });
  if (!missions.length) {
    pkgSel.disabled = true;
    var noMsnHint = el('div', 'ef-hint', 'No ATO missions loaded.');
    body.appendChild(noMsnHint);
  }
  pkgRow.appendChild(pkgSel);
  body.appendChild(pkgRow);
  body._spinsC1PkgLeadSel = pkgSel;
}

function _renderC1Agencies(container) {
  container.innerHTML = '';
  var agencies = (STATE.pkg && STATE.pkg.registry &&
                  STATE.pkg.registry.control_agencies) || {};
  var agencyList = Object.values(agencies);
  if (!agencyList.length) {
    container.appendChild(el('div', 'ef-hint', 'No control agencies in registry.'));
    return;
  }
  agencyList.forEach(function (ag) {
    var callsign = ag.callsign || '';
    var freq     = ag.primary_freq_mhz || '';
    var role     = (ag.type || 'AWACS').toUpperCase();
    var value    = callsign + (freq ? ' / ' + freq + ' MHz' : '');
    var row = el('div', 'ef-ap-row');
    var badge = el('span', 'ef-entry-type', role);
    var lbl   = document.createElement('span');
    lbl.style.flex = '1';
    lbl.style.fontFamily = 'var(--font-mono)';
    lbl.style.fontSize   = '11px';
    lbl.textContent = value;
    row.appendChild(badge);
    row.appendChild(lbl);
    container.appendChild(row);
  });
}

function _generateC1Markdown(body) {
  var lines = ['## C1.1 \u2014 Tactical Control'];
  var agencies = (STATE.pkg && STATE.pkg.registry &&
                  STATE.pkg.registry.control_agencies) || {};
  var agencyList = Object.values(agencies);
  if (agencyList.length) {
    agencyList.forEach(function (ag) {
      var callsign = ag.callsign || '';
      var freq     = ag.primary_freq_mhz || '';
      var role     = (ag.type || 'AWACS').toUpperCase();
      var value    = callsign + (freq ? ' / ' + freq + ' MHz' : '');
      lines.push('**PRIMARY ' + role + '**: ' + value);
    });
  } else {
    lines.push('**PRIMARY AWACS**: ');
  }
  lines.push('');
  lines.push('## C1.3 \u2014 Package Lead');
  var lead = body._spinsC1PkgLeadSel ? body._spinsC1PkgLeadSel.value : '';
  lines.push('**PACKAGE LEAD**: ' + lead);
  return lines.join('\n');
}

// ── Markdown textarea editor ──────────────────────────────
function _buildMarkdownEditor(body, sec) {
  editorSectionTitle(body, 'CONTENT');
  var md = sec.markdown != null ? sec.markdown : '';
  var ta = document.createElement('textarea');
  ta.className = 'ef-input ef-textarea ef-markdown-area';
  ta.value = md;
  body.appendChild(ta);
  body._spinsMarkdownArea = ta;
}

// ── Preset picker (inserts markdown into textarea) ────────
function _buildPresetPickerRow(body, presetCat) {
  var presets = SPINS_PRESETS[presetCat] || [];
  if (!presets.length) return;

  var hint = el('div', 'ef-hint',
    '\u21b3 Apply a built-in preset or edit the content freely below.');
  body.appendChild(hint);

  var row = el('div', 'ef-ap-row');
  row.style.marginBottom = '6px';

  var sel = document.createElement('select');
  sel.className = 'ef-input';
  presets.forEach(function (p, i) {
    var opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p.label;
    sel.appendChild(opt);
  });
  row.appendChild(sel);

  var applyBtn = el('button', 'ef-btn ef-btn-sm', 'APPLY PRESET');
  applyBtn.addEventListener('click', function () {
    var preset = presets[parseInt(sel.value, 10)];
    if (!preset) return;
    // Find the markdown textarea (rendered after this row)
    var ta = body.querySelector('.ef-markdown-area');
    if (ta) ta.value = _entriesToMarkdown(preset.entries);
  });
  row.appendChild(applyBtn);
  body.appendChild(row);
}

// ── Auto-generate all standard SPINS sections from ATO ───
function _initializeSpinsFromAto() {
  var sections = [];
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];

  // C1 — COMMAND & CONTROL
  var c1Lines = ['## C1.1 \u2014 Tactical Control'];
  var agencies = (STATE.pkg && STATE.pkg.registry &&
                  STATE.pkg.registry.control_agencies) || {};
  var agencyList = Object.values(agencies);
  if (agencyList.length) {
    agencyList.forEach(function (ag) {
      var callsign = ag.callsign || '';
      var freq     = ag.primary_freq_mhz || '';
      var role     = (ag.type || 'AWACS').toUpperCase();
      c1Lines.push('**PRIMARY ' + role + '**: ' +
        callsign + (freq ? ' / ' + freq + ' MHz' : ''));
    });
  } else {
    c1Lines.push('**PRIMARY AWACS**: ');
  }
  c1Lines.push('', '## C1.3 \u2014 Package Lead', '**PACKAGE LEAD**: ');
  sections.push({ title: 'C1 \u2014 COMMAND & CONTROL',
                  markdown: c1Lines.join('\n') });

  // C3 — IFF / SIF
  var iffTable = _buildMissionIffTable();
  var c3 = { title: 'C3 \u2014 IFF / SIF',
              note:  'Squawk assigned Mode 3 code. Mode 4 mandatory.' };
  if (iffTable) c3.table = iffTable;
  sections.push(c3);

  // C4 — RULES OF ENGAGEMENT
  sections.push({
    title:    'C4 \u2014 RULES OF ENGAGEMENT',
    markdown: _entriesToMarkdown(SPINS_PRESETS.roe[0].entries),
  });

  // C5 — EXECUTION
  var c5Blocks = missions.map(function (msn) {
    var num  = (msn.mission_number || '').replace(/^MSN/i, '');
    var cs   = msn.callsign || '';
    var type = msn.mission_type || '';
    var prefix  = num ? 'C5.' + num + ' \u2014 ' : '';
    var heading = prefix + cs + (type ? ' (' + type + ')' : '');
    if (!heading.trim()) return null;
    return '## ' + heading + '\n**OBJECTIVE**: \n**DESIRED EFFECTS**: ';
  }).filter(Boolean);
  sections.push({ title: 'C5 \u2014 EXECUTION',
                  markdown: c5Blocks.join('\n\n') });

  // C7 — LOST COMMS
  sections.push({
    title:    'C7 \u2014 LOST COMMS',
    markdown: _entriesToMarkdown(SPINS_PRESETS.lost_comms[0].entries),
  });

  // C8 — ABORT CRITERIA
  sections.push({
    title:    'C8 \u2014 ABORT CRITERIA',
    markdown: _entriesToMarkdown(SPINS_PRESETS.abort_criteria[0].entries),
  });

  // C9 — SEARCH AND RESCUE
  sections.push({
    title:    'C9 \u2014 SEARCH AND RESCUE',
    markdown: _entriesToMarkdown(SPINS_PRESETS.sar[0].entries),
  });

  // C10 — AUTHENTICATION
  sections.push({
    title:    'C10 \u2014 AUTHENTICATION',
    markdown: _entriesToMarkdown(SPINS_PRESETS.authentication[0].entries),
  });

  // C11 — SAFETY
  sections.push({
    title:    'C11 \u2014 SAFETY',
    markdown: _entriesToMarkdown(SPINS_PRESETS.safety[0].entries),
  });

  return sections;
}

// ── Auto-build IFF table with randomised squawk codes ─────
function _buildMissionIffTable() {
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];
  if (!missions.length) return null;
  var used = new Set();
  var rows = missions.map(function (msn) {
    var num    = (msn.mission_number || '').replace(/^MSN/i, '');
    var squawk = _randomSquawkCode(used);
    used.add(squawk);
    return [num, '3', squawk];
  });
  return { headers: ['MSN', 'MODE', 'CODE'], rows: rows };
}

// ── Structured table editor ───────────────────────────────
function _buildSpinsTableEditor(body, tableData) {
  var headers = tableData ? tableData.headers.slice()
                          : ['COL1', 'COL2'];
  var rows    = tableData ? tableData.rows.map(function (r) { return r.slice(); })
                          : [];

  body._spinsTableEnabled = !!tableData;
  body._spinsTableHeaders = headers;
  body._spinsTableRows    = rows;

  var checkRow = el('div', 'ef-ap-row');
  var enableChk = document.createElement('input');
  enableChk.type = 'checkbox';
  enableChk.checked = !!tableData;
  var lbl = el('label', 'ef-hint');
  lbl.textContent = '\u00a0Include table in this section';
  checkRow.appendChild(enableChk);
  checkRow.appendChild(lbl);
  body.appendChild(checkRow);

  var tableForm = el('div', 'ef-table-form');
  tableForm.style.display = tableData ? '' : 'none';
  enableChk.addEventListener('change', function () {
    body._spinsTableEnabled = this.checked;
    tableForm.style.display = this.checked ? '' : 'none';
  });

  editorSectionTitle(tableForm, 'TABLE HEADERS');
  var hdrRow = el('div', 'ef-ap-row');
  _buildTableHeaderInputs(hdrRow, headers, rows, tableForm, body);
  tableForm.appendChild(hdrRow);

  editorSectionTitle(tableForm, 'TABLE ROWS');
  var rowsEl = el('div', 'ef-list-items');
  _renderSpinsTableRows(rowsEl, headers, rows);
  tableForm.appendChild(rowsEl);

  var addRowBtn = el('button', 'ef-btn ef-btn-add', '+ ROW');
  addRowBtn.addEventListener('click', function () {
    rows.push(headers.map(function () { return ''; }));
    _renderSpinsTableRows(rowsEl, headers, rows);
  });
  tableForm.appendChild(addRowBtn);

  body.appendChild(tableForm);
}

function _buildTableHeaderInputs(hdrRow, headers, rows, tableForm, body) {
  hdrRow.innerHTML = '';
  headers.forEach(function (h, hi) {
    var inp = el('input', 'ef-input ef-input-sm');
    inp.value = h;
    inp.placeholder = 'Col ' + (hi + 1);
    (function (idx) {
      inp.addEventListener('input', function () { headers[idx] = this.value; });
    })(hi);
    hdrRow.appendChild(inp);
  });
  var addColBtn = el('button', 'ef-btn ef-btn-sm', '+ COL');
  addColBtn.addEventListener('click', function () {
    headers.push('');
    rows.forEach(function (r) { r.push(''); });
    _buildTableHeaderInputs(hdrRow, headers, rows, tableForm, body);
    var rowsEl = tableForm.querySelector('.ef-list-items');
    if (rowsEl) _renderSpinsTableRows(rowsEl, headers, rows);
  });
  hdrRow.appendChild(addColBtn);
}

function _renderSpinsTableRows(container, headers, rows) {
  container.innerHTML = '';
  rows.forEach(function (row, ri) {
    var rowEl = el('div', 'ef-ap-row');
    headers.forEach(function (h, ci) {
      var inp = el('input', 'ef-input ef-input-sm');
      inp.placeholder = h || ('Col ' + (ci + 1));
      inp.value = row[ci] != null ? String(row[ci]) : '';
      (function (r, idx) {
        inp.addEventListener('input', function () { r[idx] = this.value; });
      })(row, ci);
      rowEl.appendChild(inp);
    });
    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '\u2715');
    (function (idx) {
      delBtn.addEventListener('click', function () {
        rows.splice(idx, 1);
        _renderSpinsTableRows(container, headers, rows);
      });
    })(ri);
    rowEl.appendChild(delBtn);
    container.appendChild(rowEl);
  });
}
