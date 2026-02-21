// ═══════════════════════════════════════════════════════════
// editor-sections.js — SPINS, COMMS, Weather editors
//
// Each section editor follows the same pattern as the registry
// and mission editors: open a dialog, build a form, save back
// to STATE.pkg, and re-render.
// ═══════════════════════════════════════════════════════════

'use strict';

// ═════════════════════════════════════════════════════════════
// SPINS EDITOR
// ═════════════════════════════════════════════════════════════

function openSpinsEditor() {
  var sp = editorEnsureSection('spins');

  openEditorDialog('EDIT SPINS', function (body) {
    // Header fields
    editorSectionTitle(body, 'HEADER');
    var fOp  = editorField(body, 'Operation',      sp.operation);
    var fDay = editorField(body, 'ATO Day',         sp.ato_day);
    var fVer = editorField(body, 'Version',         sp.version);
    var fCls = editorField(body, 'Classification',  sp.classification);

    body._spinsHeader = { op: fOp, day: fDay, ver: fVer, cls: fCls };

    // Sections list
    var sections = sp.sections || [];
    body._spinsSections = sections.map(function (s) { return Object.assign({}, s); });

    editorSectionTitle(body, 'SECTIONS');
    var listEl = el('div', 'ef-list-items');
    body._spinsListEl = listEl;
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
    sp.ato_day        = h.day.value || undefined;
    sp.version        = h.ver.value || undefined;
    sp.classification = h.cls.value || undefined;
    sp.sections       = body._spinsSections;
    editorReRender();
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

function _editSpinsSection(sections, index) {
  var sec = sections[index];

  openEditorDialog('EDIT SPINS SECTION', function (body) {
    var fTitle = editorField(body, 'Title', sec.title, { placeholder: 'e.g. C1 — COMMAND & CONTROL' });
    var fNote  = editorField(body, 'Note',  sec.note,  { placeholder: 'Optional note' });

    // Entries as raw YAML text for maximum flexibility
    editorSectionTitle(body, 'ENTRIES (YAML)');
    var entriesYaml = '';
    if (sec.entries && sec.entries.length) {
      entriesYaml = jsyaml.dump(sec.entries, { lineWidth: -1, noRefs: true });
    }
    var fEntries = editorField(body, 'Entries', entriesYaml, {
      type: 'textarea',
      rows: 12,
      hint: 'YAML list of entries. Each entry: {label, value, style?}, {bullet, style?}, {heading}, or {value}',
    });

    // Table as raw YAML
    var tableYaml = '';
    if (sec.table) {
      tableYaml = jsyaml.dump(sec.table, { lineWidth: -1, noRefs: true });
    }
    var fTable = editorField(body, 'Table (optional)', tableYaml, {
      type: 'textarea',
      rows: 6,
      hint: 'YAML object: {headers: [...], rows: [[...], ...], cell_classes?: [...]}',
    });

    body._spinsSecFields = { title: fTitle, note: fNote, entries: fEntries, table: fTable };
    body._spinsSections = sections;
    body._spinsSecIndex = index;
  }, function () {
    var body = document.getElementById('editorBody');
    var f = body._spinsSecFields;
    var sec = body._spinsSections[body._spinsSecIndex];

    sec.title = f.title.value || '';
    sec.note  = f.note.value || undefined;

    // Parse entries YAML
    try {
      var entries = f.entries.value.trim() ? jsyaml.load(f.entries.value) : [];
      sec.entries = Array.isArray(entries) ? entries : [];
    } catch (e) {
      alert('Entries YAML error: ' + e.message);
      return;
    }

    // Parse table YAML
    try {
      if (f.table.value.trim()) {
        sec.table = jsyaml.load(f.table.value);
      } else {
        delete sec.table;
      }
    } catch (e) {
      alert('Table YAML error: ' + e.message);
      return;
    }

    // Go back to SPINS list editor
    openSpinsEditor();
  });
}

// ═════════════════════════════════════════════════════════════
// COMMS EDITOR
// ═════════════════════════════════════════════════════════════

function openCommsEditor() {
  var cm = editorEnsureSection('comms');

  openEditorDialog('EDIT COMMS', function (body) {
    editorSectionTitle(body, 'HEADER');
    var fOp   = editorField(body, 'Operation',      cm.operation);
    var fDay  = editorField(body, 'ATO Day',         cm.ato_day);
    var fLead = editorField(body, 'Wing Lead',       cm.wing_lead);
    var fCls  = editorField(body, 'Classification',  cm.classification);

    body._commsHeader = { op: fOp, day: fDay, lead: fLead, cls: fCls };

    // UHF presets
    editorSectionTitle(body, 'UHF PRESETS');
    body._uhfFields = _buildPresetFields(body, cm.uhf_presets || {});

    // VHF presets
    editorSectionTitle(body, 'VHF PRESETS');
    body._vhfFields = _buildPresetFields(body, cm.vhf_presets || {});

  }, function () {
    var body = document.getElementById('editorBody');
    var h = body._commsHeader;
    var cm = editorEnsureSection('comms');
    cm.operation      = h.op.value || undefined;
    cm.ato_day        = h.day.value || undefined;
    cm.wing_lead      = h.lead.value || undefined;
    cm.classification = h.cls.value || undefined;
    cm.uhf_presets    = _collectPresets(body._uhfFields);
    cm.vhf_presets    = _collectPresets(body._vhfFields);
    editorReRender();
  });
}

function _buildPresetFields(parent, presets) {
  var fields = [];
  for (var ch = 1; ch <= 20; ch++) {
    var p = presets[ch] || {};
    var row = el('div', 'ef-preset-row');
    row.appendChild(el('span', 'ef-preset-ch', 'CH ' + String(ch).padStart(2, '0')));

    var fCs   = document.createElement('input');
    fCs.className = 'ef-input ef-input-sm';
    fCs.placeholder = 'Callsign';
    fCs.value = p.callsign || '';

    var fFreq = document.createElement('input');
    fFreq.className = 'ef-input ef-input-sm';
    fFreq.placeholder = 'MHz';
    fFreq.value = p.freq_mhz != null ? String(p.freq_mhz) : '';

    var fRole = document.createElement('input');
    fRole.className = 'ef-input ef-input-sm';
    fRole.placeholder = 'Role';
    fRole.value = p.role || '';

    row.appendChild(fCs);
    row.appendChild(fFreq);
    row.appendChild(fRole);
    parent.appendChild(row);

    fields.push({ ch: ch, cs: fCs, freq: fFreq, role: fRole });
  }
  return fields;
}

function _collectPresets(fields) {
  var presets = {};
  fields.forEach(function (f) {
    if (f.cs.value || f.freq.value) {
      var p = {};
      if (f.cs.value)   p.callsign = f.cs.value;
      if (f.freq.value) p.freq_mhz = parseFloat(f.freq.value) || f.freq.value;
      if (f.role.value) p.role = f.role.value;
      presets[f.ch] = p;
    }
  });
  return presets;
}

// ═════════════════════════════════════════════════════════════
// WEATHER EDITOR
// ═════════════════════════════════════════════════════════════

function openWeatherEditor() {
  var wx = editorEnsureSection('weather');

  openEditorDialog('EDIT WEATHER', function (body) {
    editorSectionTitle(body, 'HEADER');
    var fIssued = editorField(body, 'Issued',     wx.issued);
    var fFrom   = editorField(body, 'Valid From',  wx.valid_from,  { placeholder: '1800Z' });
    var fTo     = editorField(body, 'Valid To',    wx.valid_to,    { placeholder: '0600Z' });
    var fOp     = editorField(body, 'Operation',   wx.operation);

    body._wxHeader = { issued: fIssued, from: fFrom, to: fTo, op: fOp };

    // METARs
    editorSectionTitle(body, 'METARs');
    var metarsText = (wx.metars || []).join('\n');
    var fMetars = editorField(body, 'METARs', metarsText, {
      type: 'textarea',
      rows: 4,
      hint: 'One METAR per line',
    });

    // TAFs
    editorSectionTitle(body, 'TAFs');
    var tafsText = (wx.tafs || []).join('\n');
    var fTafs = editorField(body, 'TAFs', tafsText, {
      type: 'textarea',
      rows: 6,
      hint: 'One TAF per line (join continuation lines)',
    });

    // Mission weather notes
    editorSectionTitle(body, 'MISSION WEATHER NOTES');
    var msnWx = (wx.mission_wx || []).map(function (mw) { return Object.assign({}, mw); });
    body._msnWx = msnWx;

    var listEl = el('div', 'ef-list-items');
    body._wxListEl = listEl;
    _renderMsnWxList(listEl, msnWx);
    body.appendChild(listEl);

    var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD NOTE');
    addBtn.addEventListener('click', function () {
      msnWx.push({ mission_ref: '', notes: '' });
      _renderMsnWxList(listEl, msnWx);
    });
    body.appendChild(addBtn);

    body._wxFields = { metars: fMetars, tafs: fTafs };

  }, function () {
    var body = document.getElementById('editorBody');
    var h = body._wxHeader;
    var f = body._wxFields;
    var wx = editorEnsureSection('weather');

    wx.issued     = h.issued.value || undefined;
    wx.valid_from = h.from.value || undefined;
    wx.valid_to   = h.to.value || undefined;
    wx.operation  = h.op.value || undefined;

    // Parse METARs
    wx.metars = f.metars.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

    // Parse TAFs
    wx.tafs = f.tafs.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

    // Mission weather
    wx.mission_wx = body._msnWx.filter(function (mw) { return mw.mission_ref || mw.notes; });

    editorReRender();
  });
}

function _renderMsnWxList(container, msnWx) {
  container.innerHTML = '';
  msnWx.forEach(function (mw, i) {
    var row = el('div', 'ef-ap-row');

    var refInput = document.createElement('input');
    refInput.className = 'ef-input ef-input-sm';
    refInput.placeholder = 'Mission Ref';
    refInput.value = mw.mission_ref || '';
    refInput.addEventListener('input', function () { mw.mission_ref = this.value; });

    var noteInput = document.createElement('input');
    noteInput.className = 'ef-input';
    noteInput.placeholder = 'Notes';
    noteInput.value = mw.notes || '';
    noteInput.addEventListener('input', function () { mw.notes = this.value; });

    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '✕');
    delBtn.addEventListener('click', function () {
      msnWx.splice(i, 1);
      _renderMsnWxList(container, msnWx);
    });

    row.appendChild(refInput);
    row.appendChild(noteInput);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}
