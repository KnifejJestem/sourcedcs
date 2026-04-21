// ═══════════════════════════════════════════════════════════
// editor-steerpoints.js — Registry Steerpoints CRUD editor
//
// Allows adding, editing, and deleting registry steerpoints.
// Each steerpoint records:
//   - id          Unique identifier (auto-generated if omitted)
//   - type        Waypoint type: 'marshal', 'ip', 'ep', 'wp'
//   - name        Optional display name suffix
//   - coords      Geographic position (with map-picker support)
//   - altitude_ft Holding altitude in feet (optional)
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Open the steerpoints list dialog ────────────────────────
function openSteerpointsEditor() {
  openEditorDialog('STEERPOINTS', function (body) {
    _renderSspList(body);
  }, function () {
    // Individual items save directly; this is a no-op.
  });
}

// ── Render the list of steerpoints ──────────────────────────
function _renderSspList(body) {
  body.innerHTML = '';
  var reg  = editorEnsureRegistry();
  var ssps = reg.steerpoints || [];

  editorSectionTitle(body, 'STEERPOINTS (' + ssps.length + ')');

  var listEl = el('div', 'ef-list-items');
  ssps.forEach(function (ssp, i) {
    var typeLabel = (ssp.type || '').toUpperCase();
    var label = [typeLabel, ssp.name].filter(Boolean).join(' ') || ssp.id || 'STEER PT ' + (i + 1);
    editorItemRow(listEl, label,
      function () { _editSsp(i); },
      function () { _deleteSsp(i); }
    );
  });
  body.appendChild(listEl);

  var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD STEER PT');
  addBtn.addEventListener('click', function () { _addSsp(); });
  body.appendChild(addBtn);
}

// ── Edit an existing steerpoint ─────────────────────────────
function _editSsp(index) {
  var reg = editorEnsureRegistry();
  if (!reg.steerpoints) reg.steerpoints = [];
  var ssp = reg.steerpoints[index];
  if (!ssp) return;

  var title = 'EDIT STEER PT — ' + (ssp.name || ssp.id || '#' + index);
  _openSspForm(title, ssp, function (updated) {
    reg.steerpoints[index] = updated;
    editorReRender();
    openSteerpointsEditor();
  });
}

// ── Add a new steerpoint ─────────────────────────────────────
function _addSsp() {
  _openSspForm('ADD STEER PT', {}, function (updated) {
    var reg = editorEnsureRegistry();
    if (!reg.steerpoints) reg.steerpoints = [];
    reg.steerpoints.push(updated);
    editorReRender();
    openSteerpointsEditor();
  });
}

// ── Delete a steerpoint ──────────────────────────────────────
function _deleteSsp(index) {
  var reg = editorEnsureRegistry();
  if (!reg.steerpoints) return;
  var ssp = reg.steerpoints[index];
  var label = ssp.name || ssp.id || '#' + index;
  if (!confirm('Delete steer point ' + label + '?')) return;

  var sspId = ssp.id;

  reg.steerpoints.splice(index, 1);

  // Remove steerpoint references from all missions
  if (sspId) {
    var ato = STATE.pkg && STATE.pkg.ato;
    (ato && ato.missions || []).forEach(function (m) {
      if (!m.steer_points) return;
      m.steer_points = m.steer_points.filter(function (sp) {
        return !(sp && sp.id === sspId);
      });
    });
  }

  editorReRender();
  openSteerpointsEditor();
}

// ── Build and open the steerpoint add/edit form ──────────────
function _openSspForm(title, ssp, onSave) {
  openEditorDialog(title, function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO STEERPOINTS');
    backBtn.addEventListener('click', function () { openSteerpointsEditor(); });
    body.appendChild(backBtn);

    var fId     = editorField(body, 'ID', ssp.id || '', { placeholder: 'e.g. SSP-1 (auto-generated if empty)' });
    var fType   = editorField(body, 'Type', ssp.type || '', {
      type: 'select',
      options: [
        { value: '', label: '— select type —' },
        { value: 'marshal', label: 'MARSHAL' },
        { value: 'ip',      label: 'IP' },
        { value: 'ep',      label: 'EP' },
        { value: 'wp',      label: 'WP (waypoint)' },
      ],
    });
    if (ssp.type) fType.value = ssp.type;
    var fName   = editorField(body, 'Name', ssp.name || '', { placeholder: 'e.g. WEST' });
    var fCoords = editorField(body, 'Coordinates', ssp.coords || '', {
      placeholder: "N24°30'00\" E055°30'00\"",
      coordPick: true,
    });
    var fAlt    = editorField(body, 'Altitude (ft)', ssp.altitude_ft != null ? ssp.altitude_ft : '', {
      type: 'number',
      placeholder: '25000',
    });

    body._sspFields = { id: fId, type: fType, name: fName, coords: fCoords, alt: fAlt };
    body._sspOnSave = onSave;
    body._sspOriginal = ssp;
  }, function () {
    _saveSspForm();
  });
}

// ── Collect form values and invoke save callback ─────────────
function _saveSspForm() {
  var body   = document.getElementById('editorBody');
  var f      = body._sspFields;
  var onSave = body._sspOnSave;
  var orig   = body._sspOriginal || {};
  if (!f || !onSave) return;

  var updated = Object.assign({}, orig);

  // ID: use existing or generate a unique one
  var idVal = (f.id.value || '').trim();
  if (!idVal) {
    var typePrefix = (f.type.value || 'ssp').toUpperCase();
    var namePart   = (f.name.value || '').trim().replace(/\s+/g, '-').toUpperCase();
    idVal = namePart ? typePrefix + '-' + namePart : typePrefix + '-' + Date.now();
  }
  updated.id = idVal;

  updated.type   = f.type.value   || undefined;
  updated.name   = f.name.value   || undefined;
  updated.coords = f.coords.value || undefined;

  var altRaw = f.alt.value;
  updated.altitude_ft = altRaw !== '' && altRaw != null ? parseFloat(altRaw) : undefined;

  onSave(updated);
}
