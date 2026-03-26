// ═══════════════════════════════════════════════════════════
// editor-spins.js — SPINS section editor (structured)
//
// Replaces raw YAML entry editing with a structured list of
// typed entry rows (HDG / KV / BULLET / TEXT).
//
// Special section handling:
//   C1.1 / TACTICAL CONTROL — auto-populated from registry
//     control_agencies; agency can be changed in edit mode.
//   C1.3 / PACKAGE LEAD     — callsign dropdown from ATO missions.
//   C5 / EXECUTION          — auto-adds a heading + OBJECTIVE +
//     DESIRED EFFECTS row for each mission so nothing is forgotten.
//   C3 / IFF                — auto-builds the IFF table with one row
//     per mission (mode 3, sequential squawk codes) when no table exists.
//   C4 / C7-C11             — preset picker: select from built-in
//     presets or edit entries individually.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Built-in presets for sections that support them ───────────
var SPINS_PRESETS = {
  roe: [
    {
      label: 'Standard (PID / BVR / SFC / CIV)',
      entries: [
        { heading: 'C4.1 — PID' },
        { value: 'PID required prior to weapons release on air contacts unless hostile act is demonstrated.' },
        { bullet: 'PID on surface targets not designated by ATO required' },
        { label: 'PID SOURCES', value: 'NCTR / radar profile, Correlated track from CRC/AWACS, Visual ID (VID)' },
        { bullet: 'Unidentified aircraft departing known mixed-use or adversary-controlled bases are automatically hostile' },
        { heading: 'C4.2 — BVR' },
        { value: 'NOTE: BVR weapons authorised only after PID or declaration by controlling agency.' },
        { bullet: 'Weapons free against aircraft declared HOSTILE or demonstrating hostile act' },
        { bullet: 'Aircraft operating third-party deconfliction agreements require higher authority clearance unless self-defence' },
        { heading: 'C4.3 — SFC ATTACK' },
        { bullet: 'Weapons release authorized only on assigned ATO targets' },
        { bullet: 'Collateral damage estimate 3 delegated; higher requires CAOC approval' },
        { heading: 'C4.4 — Civilian Traffic' },
        { value: 'NO FACTOR' },
      ],
    },
    {
      label: 'Weapons Free',
      entries: [
        { value: 'WEAPONS FREE — No PID required against declared hostile contacts.' },
        { bullet: 'All hostile contacts may be engaged at pilot discretion' },
        { bullet: 'Rules of engagement card in effect — verify IFF before BVR' },
      ],
    },
    {
      label: 'Defensive Only',
      entries: [
        { value: 'WEAPONS TIGHT — Engage only when fired upon or imminent hostile act demonstrated.' },
        { bullet: 'BVR engagement requires explicit ATC clearance' },
        { bullet: 'SFC attack requires CAOC authorization' },
        { bullet: 'Civilian traffic in area — heightened ROE awareness required' },
      ],
    },
  ],

  lost_comms: [
    {
      label: 'Standard (AWACS / Package / Intraflight)',
      entries: [
        { heading: 'C7.1 — Loss of AWACS' },
        { bullet: 'Default to package commander control' },
        { bullet: 'Abort mission if communication cannot be restored within 5 minutes' },
        { heading: 'C7.2 — Loss of Package Comms' },
        { bullet: 'Continue mission if task and ROE remain clear' },
        { bullet: 'Abort in case of degraded situation awareness' },
        { heading: 'C7.3 — Loss of Intraflight Comms' },
        { bullet: 'Continue assigned task' },
        { bullet: 'Reestablish communication post target if feasible' },
        { bullet: 'Abort mission if communication cannot be reestablished' },
      ],
    },
    {
      label: 'Abort on Any Loss',
      entries: [
        { bullet: 'Loss of any communication link is grounds for mission abort' },
        { bullet: 'RTB to home base and await new tasking' },
        { bullet: 'Declare MAYDAY on Guard if safety of flight is compromised' },
      ],
    },
  ],

  abort_criteria: [
    {
      label: 'Standard',
      entries: [
        { bullet: 'Target PID cannot be confirmed' },
        { bullet: 'Collateral damage risk exceeds authorization' },
        { bullet: 'Fuel state prevents safe recovery' },
        { bullet: 'Supporting mission unsuccessful and threat unacceptable' },
        { bullet: 'Major technical faults' },
      ],
    },
    {
      label: 'Extended',
      entries: [
        { bullet: 'Target PID cannot be confirmed' },
        { bullet: 'Collateral damage risk exceeds authorization' },
        { bullet: 'Fuel state prevents safe recovery' },
        { bullet: 'Supporting mission unsuccessful and threat unacceptable' },
        { bullet: 'Major technical faults' },
        { bullet: 'Weather below minimums at recovery base' },
        { bullet: 'IFF / SIF failure — cannot confirm coalition status' },
        { bullet: 'Loss of all data-link / navigation systems' },
      ],
    },
  ],

  sar: [
    { label: 'Not Simulated', entries: [{ value: 'NOT SIMULATED' }] },
    {
      label: 'Standard CSAR',
      entries: [
        { label: 'SAR FREQUENCY', value: '282.800 MHz (Guard)' },
        { bullet: 'All coalition assets participate in SAR on declaration' },
        { bullet: 'Emergency beacons monitored on Guard continuously' },
        { bullet: 'CSAR authority: Package Commander or designate' },
      ],
    },
  ],

  authentication: [
    {
      label: 'Daily Table',
      entries: [{ label: 'AUTHENTICATION', value: 'Daily authentication table per COMSEC' }],
    },
    {
      label: 'Not Required',
      entries: [{ value: 'AUTHENTICATION NOT REQUIRED FOR THIS EXERCISE' }],
    },
    {
      label: 'Challenge / Reply',
      entries: [
        { label: 'AUTHENTICATION', value: 'Challenge / Reply per daily COMSEC card' },
        { bullet: 'Challenge on first contact with unknown aircraft' },
        { bullet: 'Failure to authenticate: treat as hostile pending PID' },
      ],
    },
  ],

  safety: [
    {
      label: 'Standard',
      entries: [
        { label: 'MINIMUM SEPARATION', value: '3NM / 1000ft between coalition aircraft outside tactical formation' },
      ],
    },
    {
      label: 'Extended',
      entries: [
        { label: 'MINIMUM SEPARATION', value: '3NM / 1000ft between coalition aircraft outside tactical formation' },
        { bullet: 'No supersonic flight below FL250 without authorization' },
        { bullet: 'Night / IMC — increase separation to 5NM / 2000ft' },
        { bullet: 'Jettison ordnance only in designated areas' },
      ],
    },
  ],
};

// ── Detect the preset category for a section title ───────────
// Returns a key into SPINS_PRESETS, or null if no presets apply.
function _spinsPresetCategory(title) {
  var t = (title || '').toLowerCase();
  if (/c4\b|rules of engagement|roe/i.test(t))   return 'roe';
  if (/c7\b|lost comms/i.test(t))                return 'lost_comms';
  if (/c8\b|abort crit/i.test(t))                return 'abort_criteria';
  if (/c9\b|search.*rescue|sar/i.test(t))        return 'sar';
  if (/c10\b|authentication/i.test(t))           return 'authentication';
  if (/c11\b|safety/i.test(t))                   return 'safety';
  return null;
}

// ── Detect whether the title matches a known structural section ──
function _spinsIsTacticalControl(title) {
  return /c1\.1\b|tactical control/i.test(title || '');
}
function _spinsIsPackageLead(title) {
  return /c1\.3\b|package lead/i.test(title || '');
}

// ── Open SPINS list editor ────────────────────────────────────
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

    // ── Initialize from ATO button ────────────────────────────
    var initRow = el('div', 'ef-ap-row');
    var initBtn = el('button', 'ef-btn ef-btn-add', '\u21ba GENERATE STANDARD SECTIONS FROM ATO');
    initBtn.title = 'Auto-populate all standard SPINS sections (C1, C3, C4, C5, C7\u2013C11) from the loaded ATO data. Existing sections will be replaced.';
    initBtn.addEventListener('click', function () {
      if (sections.length > 0 &&
          !confirm('Replace all current sections with auto-generated standard sections?')) {
        return;
      }
      var generated = _initializeSpinsFromAto();
      sections.length = 0;
      generated.forEach(function (s) { sections.push(s); });
      _renderSpinsSectionsList(listEl, sections);
    });
    initRow.appendChild(initBtn);
    body.appendChild(initRow);

    editorSectionTitle(body, 'SECTIONS');
    var listEl = el('div', 'ef-list-items');
    _renderSpinsSectionsList(listEl, body._spinsSections);
    body.appendChild(listEl);

    var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD SECTION');
    addBtn.addEventListener('click', function () {
      body._spinsSections.push({ title: 'NEW SECTION', entries: [] });
      _renderSpinsSectionsList(listEl, body._spinsSections);
    });
    body.appendChild(addBtn);
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

// ── Edit a single SPINS section ──────────────────────────────
function _editSpinsSection(sections, index) {
  var sec = sections[index];

  openEditorDialog('EDIT SPINS SECTION', function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO SPINS');
    backBtn.addEventListener('click', function () {
      _collectSpinsSection(sections, index);
      openSpinsEditor();
    });
    body.appendChild(backBtn);

    var fTitle = editorField(body, 'Title', sec.title, { placeholder: 'e.g. C5 — EXECUTION' });
    var fNote  = editorField(body, 'Note',  sec.note,  { placeholder: 'Optional section note' });

    var isExecution = /c5\b|execution/i.test(sec.title || '');
    var isIff       = /c3\b|iff\b/i.test(sec.title || '');
    var isTactical  = _spinsIsTacticalControl(sec.title);
    var isPkgLead   = _spinsIsPackageLead(sec.title);
    var presetCat   = _spinsPresetCategory(sec.title);

    // ── Section-type hints ────────────────────────────────────
    if (isTactical) {
      var hint = el('div', 'ef-hint', '\u21b3 Tactical Control is auto-populated from registry control agencies. Use the button below to refresh from the current registry.');
      body.appendChild(hint);
      var refreshBtn = el('button', 'ef-btn ef-btn-sm', '\u21ba REFRESH FROM REGISTRY');
      refreshBtn.addEventListener('click', function () {
        body._spinsEntries = _buildTacticalControlEntries();
        _renderSpinsEntriesList(entriesListEl, body._spinsEntries);
      });
      body.appendChild(refreshBtn);
    }

    if (isPkgLead) {
      _buildPackageLeadPicker(body, sec.entries || []);
    }

    // ── Preset picker (C4, C7–C11) ───────────────────────────
    if (presetCat) {
      _buildPresetPickerRow(body, presetCat, function (entries) {
        body._spinsEntries = entries;
        _renderSpinsEntriesList(entriesListEl, body._spinsEntries);
      });
    }

    // ── Entries ───────────────────────────────────────────────
    editorSectionTitle(body, 'ENTRIES');
    var entries = (sec.entries || []).map(function (e) { return Object.assign({}, e); });
    body._spinsEntries = entries;

    if (isExecution) {
      var hint = el('div', 'ef-hint', '\u21b3 Missing missions are auto-added below. Fill in OBJECTIVE and DESIRED EFFECTS for each.');
      body.appendChild(hint);
      _ensureMissionHeadings(entries);
    }

    var entriesListEl = el('div', 'ef-list-items');
    _renderSpinsEntriesList(entriesListEl, entries);
    body.appendChild(entriesListEl);

    // Add-entry type buttons
    var addRow = el('div', 'ef-add-entry-row');
    [
      ['+ HEADING',   function () { return { heading: '' }; }],
      ['+ LABEL/VAL', function () { return { label: '', value: '' }; }],
      ['+ BULLET',    function () { return { bullet: '' }; }],
      ['+ TEXT',      function () { return { value: '' }; }],
    ].forEach(function (pair) {
      var btn = el('button', 'ef-btn ef-btn-sm ef-btn-add', pair[0]);
      btn.addEventListener('click', function () {
        entries.push(pair[1]());
        _renderSpinsEntriesList(entriesListEl, entries);
      });
      addRow.appendChild(btn);
    });
    body.appendChild(addRow);

    // ── Table (optional) ──────────────────────────────────────
    editorSectionTitle(body, 'TABLE (OPTIONAL)');
    var tableData = sec.table ? JSON.parse(JSON.stringify(sec.table)) : null;
    if (isIff && !tableData) {
      tableData = _buildMissionIffTable();
    }
    _buildSpinsTableEditor(body, tableData);

    body._spinsSecFields = { title: fTitle, note: fNote };
    body._spinsSections  = sections;
    body._spinsSecIndex  = index;
  }, function () {
    _collectSpinsSection(sections, index);
    editorReRender('spins');
  });
}

// ── Build the preset picker row for preset-enabled sections ──
// onApply(entries) is called when the user clicks APPLY PRESET.
function _buildPresetPickerRow(body, presetCat, onApply) {
  var presets = SPINS_PRESETS[presetCat] || [];
  if (!presets.length) return;

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
    var idx = parseInt(sel.value, 10);
    var preset = presets[idx];
    if (!preset) return;
    var copied = preset.entries.map(function (e) { return Object.assign({}, e); });
    onApply(copied);
  });
  row.appendChild(applyBtn);

  body.insertBefore(row, body.querySelector('.ef-section-title'));
  body.insertBefore(el('div', 'ef-hint', '\u21b3 Apply a built-in preset to replace the entries below, or edit them manually.'), row);
}

// ── Build Package Lead picker row ─────────────────────────────
// Shows a dropdown of ATO mission callsigns and writes the chosen
// callsign into the entries list when the user clicks ASSIGN.
function _buildPackageLeadPicker(body, currentEntries) {
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];
  if (!missions.length) return;

  var hint = el('div', 'ef-hint', '\u21b3 Select the package lead from the active ATO missions.');
  body.appendChild(hint);

  var row = el('div', 'ef-ap-row');

  var sel = document.createElement('select');
  sel.className = 'ef-input';
  var blankOpt = document.createElement('option');
  blankOpt.value = '';
  blankOpt.textContent = '— select callsign —';
  sel.appendChild(blankOpt);
  missions.forEach(function (m) {
    var cs = m.callsign || '';
    if (!cs) return;
    var opt = document.createElement('option');
    opt.value = cs;
    opt.textContent = cs;
    var kv = currentEntries.find(function (e) { return e.label === 'PACKAGE LEAD'; });
    if (kv && kv.value === cs) opt.selected = true;
    sel.appendChild(opt);
  });
  row.appendChild(sel);

  var assignBtn = el('button', 'ef-btn ef-btn-sm', 'ASSIGN');
  assignBtn.addEventListener('click', function () {
    var cs = sel.value;
    if (!cs) return;
    // Find or create PACKAGE LEAD entry
    var kv = currentEntries.find(function (e) { return e.label === 'PACKAGE LEAD'; });
    if (kv) {
      kv.value = cs;
    } else {
      currentEntries.push({ label: 'PACKAGE LEAD', value: cs });
    }
    // Re-render entries list if it already exists on the body
    var listEl = body.querySelector('.ef-list-items');
    if (listEl) _renderSpinsEntriesList(listEl, currentEntries);
  });
  row.appendChild(assignBtn);
  body.appendChild(row);
}

// ── Build Tactical Control entries from registry ─────────────
function _buildTacticalControlEntries() {
  var entries = [{ heading: 'C1.1 — Tactical Control' }];
  var agencies = (STATE.pkg && STATE.pkg.registry && STATE.pkg.registry.control_agencies) || {};
  var agencyList = Object.values(agencies);
  if (agencyList.length > 0) {
    agencyList.forEach(function (ag) {
      var callsign = ag.callsign || '';
      var freq     = ag.primary_freq_mhz || '';
      var role     = (ag.type || 'AWACS').toUpperCase();
      var label    = 'PRIMARY ' + role;
      var value    = callsign + (freq ? ' / ' + freq + ' MHz' : '');
      entries.push({ label: label, value: value });
    });
  } else {
    entries.push({ label: 'PRIMARY AWACS', value: '' });
  }
  return entries;
}

// ── Auto-generate all standard SPINS sections from ATO data ──
function _initializeSpinsFromAto() {
  var sections = [];
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];

  // ── C1 — COMMAND & CONTROL ─────────────────────────────────
  var c1Entries = _buildTacticalControlEntries();
  // C1.3 — Package Lead (empty, user fills via editor)
  c1Entries.push({ heading: 'C1.3 — Package Lead' });
  c1Entries.push({ label: 'PACKAGE LEAD', value: '' });
  sections.push({ title: 'C1 — COMMAND & CONTROL', entries: c1Entries });

  // ── C3 — IFF / SIF ─────────────────────────────────────────
  var iffTable = _buildMissionIffTable();
  var c3 = {
    title: 'C3 — IFF / SIF',
    note:  'Squawk assigned Mode 3 code. Mode 4 mandatory.',
  };
  if (iffTable) c3.table = iffTable;
  sections.push(c3);

  // ── C4 — RULES OF ENGAGEMENT ───────────────────────────────
  sections.push({
    title:   'C4 — RULES OF ENGAGEMENT',
    entries: SPINS_PRESETS.roe[0].entries.map(function (e) { return Object.assign({}, e); }),
  });

  // ── C5 — EXECUTION ─────────────────────────────────────────
  var c5Entries = [];
  _ensureMissionHeadings(c5Entries);
  sections.push({ title: 'C5 — EXECUTION', entries: c5Entries });

  // ── C7 — LOST COMMS ────────────────────────────────────────
  sections.push({
    title:   'C7 — LOST COMMS',
    entries: SPINS_PRESETS.lost_comms[0].entries.map(function (e) { return Object.assign({}, e); }),
  });

  // ── C8 — ABORT CRITERIA ────────────────────────────────────
  sections.push({
    title:   'C8 — ABORT CRITERIA',
    entries: SPINS_PRESETS.abort_criteria[0].entries.map(function (e) { return Object.assign({}, e); }),
  });

  // ── C9 — SEARCH AND RESCUE ─────────────────────────────────
  sections.push({
    title:   'C9 — SEARCH AND RESCUE',
    entries: SPINS_PRESETS.sar[0].entries.map(function (e) { return Object.assign({}, e); }),
  });

  // ── C10 — AUTHENTICATION ───────────────────────────────────
  sections.push({
    title:   'C10 — AUTHENTICATION',
    entries: SPINS_PRESETS.authentication[0].entries.map(function (e) { return Object.assign({}, e); }),
  });

  // ── C11 — SAFETY ───────────────────────────────────────────
  sections.push({
    title:   'C11 — SAFETY',
    entries: SPINS_PRESETS.safety[0].entries.map(function (e) { return Object.assign({}, e); }),
  });

  return sections;
}

// ── Collect section form → save to in-memory array and STATE ─
function _collectSpinsSection(sections, index) {
  var body = document.getElementById('editorBody');
  if (!body || !body._spinsSecFields) return;
  var sec = sections[index];
  sec.title   = body._spinsSecFields.title.value || '';
  sec.note    = body._spinsSecFields.note.value || undefined;
  sec.entries = body._spinsEntries || [];
  if (body._spinsTableEnabled && body._spinsTableHeaders) {
    sec.table = {
      headers: body._spinsTableHeaders,
      rows:    body._spinsTableRows || [],
    };
  } else {
    delete sec.table;
  }
  // Persist to STATE so navigation doesn't lose edits
  editorEnsureSection('spins').sections = sections;
}

// ── Render the structured entries list ────────────────────────
function _renderSpinsEntriesList(container, entries) {
  container.innerHTML = '';
  entries.forEach(function (entry, i) {
    var row = el('div', 'ef-entry-row');

    if (entry.heading != null) {
      row.appendChild(el('span', 'ef-entry-type', 'HDG'));
      var inp = el('input', 'ef-input ef-input-sm');
      inp.placeholder = 'Heading text';
      inp.value = String(entry.heading);
      (function (e) { inp.addEventListener('input', function () { e.heading = this.value; }); })(entry);
      row.appendChild(inp);
    } else if (entry.label != null) {
      row.appendChild(el('span', 'ef-entry-type', 'KV'));
      var lInp = el('input', 'ef-input ef-input-sm');
      lInp.placeholder = 'Label';
      lInp.value = entry.label || '';
      (function (e) { lInp.addEventListener('input', function () { e.label = this.value; }); })(entry);
      row.appendChild(lInp);
      var vInp = el('input', 'ef-input ef-input-sm');
      vInp.placeholder = 'Value';
      vInp.value = entry.value != null ? String(entry.value) : '';
      (function (e) { vInp.addEventListener('input', function () { e.value = this.value; }); })(entry);
      row.appendChild(vInp);
    } else if (entry.bullet != null) {
      row.appendChild(el('span', 'ef-entry-type', '\u2022'));
      var inp = el('input', 'ef-input ef-input-sm');
      inp.placeholder = 'Bullet text';
      inp.value = String(entry.bullet);
      (function (e) { inp.addEventListener('input', function () { e.bullet = this.value; }); })(entry);
      row.appendChild(inp);
    } else {
      row.appendChild(el('span', 'ef-entry-type', 'TXT'));
      var inp = el('input', 'ef-input ef-input-sm');
      inp.placeholder = 'Text';
      inp.value = entry.value != null ? String(entry.value) : '';
      (function (e) { inp.addEventListener('input', function () { e.value = this.value; }); })(entry);
      row.appendChild(inp);
    }

    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '\u2715');
    (function (idx) {
      delBtn.addEventListener('click', function () {
        entries.splice(idx, 1);
        _renderSpinsEntriesList(container, entries);
      });
    })(i);
    row.appendChild(delBtn);

    container.appendChild(row);
  });
}

// ── Auto-populate C5 (EXECUTION) with per-mission headings ───
function _ensureMissionHeadings(entries) {
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];
  if (!missions.length) return;

  var existingHeadings = entries
    .filter(function (e) { return e.heading != null; })
    .map(function (e) { return String(e.heading || ''); });

  missions.forEach(function (m) {
    var msnNum   = (m.mission_number || '').replace(/^MSN/i, '');
    var callsign = m.callsign || '';
    var msnType  = m.mission_type || '';
    var prefix   = msnNum ? 'C5.' + msnNum + ' \u2014 ' : '';
    var headingText = prefix + callsign + (msnType ? ' (' + msnType + ')' : '');
    if (!headingText.trim()) return;

    var exists = existingHeadings.some(function (h) {
      return callsign ? h.indexOf(callsign) >= 0 : h === headingText;
    });
    if (!exists) {
      entries.push({ heading: headingText });
      entries.push({ label: 'OBJECTIVE',       value: '' });
      entries.push({ label: 'DESIRED EFFECTS', value: '' });
    }
  });
}

// ── Auto-build IFF table from mission list ────────────────────
// Squawk codes are generated sequentially: 4701, 4711, 4721, …
function _buildMissionIffTable() {
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];
  if (!missions.length) return null;
  var rows = missions.map(function (m, i) {
    var msn    = (m.mission_number || '').replace(/^MSN/i, '');
    var squawk = String(4701 + i * 10);
    return [msn, '3', squawk];
  });
  return { headers: ['MSN', 'MODE', 'CODE'], rows: rows };
}

// ── Structured table editor ───────────────────────────────────
function _buildSpinsTableEditor(body, tableData) {
  var headers = tableData ? tableData.headers.slice()                           : ['COL1', 'COL2'];
  var rows    = tableData ? tableData.rows.map(function (r) { return r.slice(); }) : [];

  body._spinsTableEnabled = !!tableData;
  body._spinsTableHeaders = headers;
  body._spinsTableRows    = rows;

  // Enable checkbox
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

  // Header inputs
  editorSectionTitle(tableForm, 'TABLE HEADERS');
  var hdrRow = el('div', 'ef-ap-row');
  _buildTableHeaderInputs(hdrRow, headers, rows, tableForm, body);
  tableForm.appendChild(hdrRow);

  // Data rows
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

// ── Build header input row (called on initial build and after adding a column) ──
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
    // Re-render rows to add new cell column
    var rowsEl = tableForm.querySelector('.ef-list-items');
    if (rowsEl) _renderSpinsTableRows(rowsEl, headers, rows);
  });
  hdrRow.appendChild(addColBtn);
}

// ── Render table data rows ────────────────────────────────────
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
