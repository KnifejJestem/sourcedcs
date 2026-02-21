// ═══════════════════════════════════════════════════════════
// editor-registry.js — Registry CRUD editor
//
// Handles editing of all registry categories:
//   airfields, carriers, tankers, targets, reference_points,
//   control_agencies
//
// Each category follows the same pattern:
//   1. List items with edit/delete buttons
//   2. Open sub-dialog for add/edit with category-specific fields
//   3. Save → update STATE.pkg.registry → re-render
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Registry category definitions ────────────────────────────
// Maps category key → { label, fields[] }
// fields: { key, label, type?, placeholder?, hint? }
var REGISTRY_CATEGORIES = {
  airfields: {
    label: 'AIRFIELDS',
    idLabel: 'ICAO',
    fields: [
      { key: 'name',         label: 'Name',         placeholder: 'e.g. Al Dhafra AB' },
      { key: 'coords',       label: 'Coordinates',  placeholder: "N24°14'36\" E054°27'07\"" },
      { key: 'elevation_ft', label: 'Elevation (ft)', type: 'number' },
    ],
  },
  carriers: {
    label: 'CARRIERS',
    idLabel: 'ID',
    fields: [
      { key: 'name',            label: 'Name',            placeholder: 'e.g. USS ROOSEVELT' },
      { key: 'callsign',        label: 'Callsign',        placeholder: 'e.g. ROUGH RIDER' },
      { key: 'deploy_coords',   label: 'Deploy Coords',   placeholder: "N24°30'00\" E059°15'00\"" },
      { key: 'recovery_coords', label: 'Recovery Coords',  placeholder: "N24°45'00\" E059°30'00\"" },
    ],
  },
  tankers: {
    label: 'TANKERS',
    idLabel: 'ID',
    fields: [
      { key: 'callsign', label: 'Callsign',  placeholder: 'e.g. ARCO4' },
      { key: 'ar_track',  label: 'AR Track',  placeholder: 'e.g. AR394' },
      { key: 'altitude',  label: 'Altitude',  placeholder: 'e.g. FL240' },
    ],
  },
  targets: {
    label: 'TARGETS',
    idLabel: 'ID',
    fields: [
      { key: 'name',               label: 'Name',               placeholder: 'e.g. SA-2 Guideline' },
      { key: 'type',               label: 'Type',               placeholder: 'SAM / EWR / BUILDING' },
      { key: 'coords',             label: 'Coordinates',        placeholder: "N26°30'00\" E056°20'00\"" },
      { key: 'elevation',          label: 'Elevation',          placeholder: '150ft' },
      { key: 'engagement_range_nm', label: 'Engagement Range (NM)', type: 'number' },
      { key: 'max_alt_ft',         label: 'Max Altitude (ft)',  type: 'number' },
    ],
  },
  reference_points: {
    label: 'REFERENCE POINTS',
    idLabel: 'ID',
    fields: [
      { key: 'name',     label: 'Name',     placeholder: 'e.g. COYOTE' },
      { key: 'type',     label: 'Type',     placeholder: 'bullseye / marshal' },
      { key: 'coords',   label: 'Coordinates', placeholder: "N26°51'19\" E056°21'37\"" },
      { key: 'altitude', label: 'Altitude', placeholder: 'FL250' },
    ],
  },
  control_agencies: {
    label: 'CONTROL AGENCIES',
    idLabel: 'ID',
    fields: [
      { key: 'type',              label: 'Type',            placeholder: 'AWACS / CRC' },
      { key: 'callsign',          label: 'Callsign',        placeholder: 'e.g. SCREWTOP' },
      { key: 'platform',          label: 'Platform',        placeholder: 'e.g. E-3' },
      { key: 'primary_freq_mhz',  label: 'Primary Freq (MHz)',   placeholder: '260.0' },
      { key: 'secondary_freq_mhz', label: 'Secondary Freq (MHz)', placeholder: '134.0' },
    ],
  },
};

// ── Open the registry list dialog ────────────────────────────
function openRegistryEditor() {
  openEditorDialog('REGISTRY', function (body) {
    var reg = (STATE.pkg && STATE.pkg.registry) || {};

    Object.keys(REGISTRY_CATEGORIES).forEach(function (catKey) {
      var cat   = REGISTRY_CATEGORIES[catKey];
      var items = reg[catKey] || {};
      var ids   = Object.keys(items);

      editorListBlock(body, cat.label, ids, function (container, id) {
        var item  = items[id];
        var label = id + (item.name ? ' — ' + item.name : '');
        editorItemRow(container, label,
          function () { editRegistryItem(catKey, id); },
          function () { deleteRegistryItem(catKey, id); }
        );
      }, function () { addRegistryItem(catKey); });
    });
  }, function () {
    // no-op on save for list view — individual items save themselves
  });
}

// ── Edit a single registry item ──────────────────────────────
function editRegistryItem(catKey, id) {
  var cat = REGISTRY_CATEGORIES[catKey];
  var reg = editorEnsureRegistry();
  if (!reg[catKey]) reg[catKey] = {};
  var item = reg[catKey][id] || {};

  openEditorDialog('EDIT ' + cat.label.slice(0, -1) + ' — ' + id, function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO REGISTRY');
    backBtn.addEventListener('click', function () { openRegistryEditor(); });
    body.appendChild(backBtn);

    var fields = {};

    // ID field (read-only for existing items)
    editorField(body, cat.idLabel, id, { disabled: true, hint: 'ID cannot be changed' });

    cat.fields.forEach(function (f) {
      fields[f.key] = editorField(body, f.label, item[f.key] || '', {
        type:        f.type || 'text',
        placeholder: f.placeholder || '',
      });
    });

    // Target aim points sub-editor
    if (catKey === 'targets') {
      _buildAimPointsEditor(body, item);
    }

    // Store fields reference for save
    body._editorFields = fields;
    body._editId = id;
    body._editItem = item;
    body._catKey = catKey;
  }, function () {
    _saveRegistryItem(catKey);
  });
}

// ── Add a new registry item ──────────────────────────────────
function addRegistryItem(catKey) {
  var cat = REGISTRY_CATEGORIES[catKey];

  openEditorDialog('ADD ' + cat.label.slice(0, -1), function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO REGISTRY');
    backBtn.addEventListener('click', function () { openRegistryEditor(); });
    body.appendChild(backBtn);

    var fields = {};

    var idInput = editorField(body, cat.idLabel, '', {
      placeholder: 'Unique identifier',
      required: true,
    });

    cat.fields.forEach(function (f) {
      fields[f.key] = editorField(body, f.label, '', {
        type:        f.type || 'text',
        placeholder: f.placeholder || '',
      });
    });

    body._editorFields = fields;
    body._idInput = idInput;
    body._catKey = catKey;
    body._isNew = true;
  }, function () {
    _saveRegistryItem(catKey);
  });
}

// ── Delete a registry item ───────────────────────────────────
function deleteRegistryItem(catKey, id) {
  if (!confirm('Delete ' + id + '?')) return;

  var reg = editorEnsureRegistry();
  if (reg[catKey]) delete reg[catKey][id];

  // Cascade: remove all references to the deleted item in missions & global_control
  _cascadeRegistryDelete(catKey, id);

  editorReRender();
  openRegistryEditor(); // refresh list
}

// ── Cascade deletion: clear references to a deleted registry item ─
function _cascadeRegistryDelete(catKey, id) {
  var ato = STATE.pkg && STATE.pkg.ato;
  if (!ato) return;
  var missions = ato.missions || [];

  if (catKey === 'airfields') {
    missions.forEach(function (m) {
      if (m.home_base_icao === id)       m.home_base_icao = undefined;
      if (m.deploy_location_icao === id) m.deploy_location_icao = undefined;
      if (m.aar_location_icao === id)    m.aar_location_icao = undefined;
    });
  } else if (catKey === 'tankers') {
    missions.forEach(function (m) {
      if (m.refuel && m.refuel.tanker_id === id) delete m.refuel;
    });
  } else if (catKey === 'targets') {
    missions.forEach(function (m) {
      if (m.target && m.target.target_id === id) m.target.target_id = undefined;
    });
  } else if (catKey === 'control_agencies') {
    // Clear global_control reference
    var gc = ato.global_control;
    if (gc && gc.agency_id === id) {
      gc.agency_id = undefined;
      gc.controlling_unit = undefined;
      gc.aircraft_type = undefined;
      gc.primary_freq_mhz = undefined;
    }
    // Clear per-mission control references
    missions.forEach(function (m) {
      if (m.control && m.control.agency_id === id) delete m.control;
    });
  } else if (catKey === 'reference_points') {
    // Clear bullseye if it references the deleted point
    var gc2 = ato.global_control;
    if (gc2 && gc2.bullseye && typeof gc2.bullseye === 'object' && gc2.bullseye.name === id) {
      gc2.bullseye = undefined;
    }
  }
}

// ── Save registry item (shared by add/edit) ──────────────────
function _saveRegistryItem(catKey) {
  var body   = document.getElementById('editorBody');
  var fields = body._editorFields;
  var reg    = editorEnsureRegistry();
  if (!reg[catKey]) reg[catKey] = {};

  // Determine ID
  var id;
  if (body._isNew) {
    id = (body._idInput.value || '').trim();
    if (!id) { alert('ID is required'); return; }
    if (reg[catKey][id]) { alert('ID already exists'); return; }
  } else {
    id = body._editId;
  }

  // Build item from form fields
  var item = body._editItem ? Object.assign({}, body._editItem) : {};
  Object.keys(fields).forEach(function (k) {
    var val = fields[k].value;
    if (val === '' || val == null) {
      delete item[k];
    } else if (fields[k].type === 'number') {
      item[k] = parseFloat(val);
    } else {
      item[k] = val;
    }
  });

  // Save aim points for targets
  if (catKey === 'targets' && body._aimPoints) {
    item.aim_points = body._aimPoints;
  }

  reg[catKey][id] = item;
  editorReRender();
}

// ── Aim points sub-editor for targets ────────────────────────
function _buildAimPointsEditor(parent, targetItem) {
  var aimPoints = (targetItem.aim_points || []).map(function (ap) {
    return { id: ap.id || '', name: ap.name || '', coords: ap.coords || '' };
  });

  var body = document.getElementById('editorBody');
  body._aimPoints = aimPoints;

  editorSectionTitle(parent, 'AIM POINTS');

  var listEl = el('div', 'ef-list-items');
  _renderAimPointsList(listEl, aimPoints);
  parent.appendChild(listEl);

  var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD AIM POINT');
  addBtn.addEventListener('click', function () {
    aimPoints.push({ id: '', name: '', coords: '' });
    body._aimPoints = aimPoints;
    _renderAimPointsList(listEl, aimPoints);
  });
  parent.appendChild(addBtn);
}

function _renderAimPointsList(container, aimPoints) {
  container.innerHTML = '';
  aimPoints.forEach(function (ap, i) {
    var row = el('div', 'ef-ap-row');

    var idInput = el('input', 'ef-input ef-input-sm');
    idInput.placeholder = 'ID';
    idInput.value = ap.id || '';
    idInput.addEventListener('input', function () { ap.id = this.value; });

    var nameInput = el('input', 'ef-input ef-input-sm');
    nameInput.placeholder = 'Name';
    nameInput.value = ap.name || '';
    nameInput.addEventListener('input', function () { ap.name = this.value; });

    var coordInput = el('input', 'ef-input ef-input-sm');
    coordInput.placeholder = 'Coords';
    coordInput.value = ap.coords || '';
    coordInput.addEventListener('input', function () { ap.coords = this.value; });

    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '✕');
    delBtn.addEventListener('click', function () {
      aimPoints.splice(i, 1);
      _renderAimPointsList(container, aimPoints);
    });

    row.appendChild(idInput);
    row.appendChild(nameInput);
    row.appendChild(coordInput);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}
