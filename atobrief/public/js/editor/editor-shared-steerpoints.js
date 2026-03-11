// ═══════════════════════════════════════════════════════════
// editor-shared-steerpoints.js — Shared Steerpoints CRUD editor
//
// Allows adding, editing, and deleting shared steerpoints from
// the ATO.  Each shared steerpoint records:
//   - id          Unique identifier (auto-generated if omitted)
//   - type        Waypoint type (e.g. 'marshal', 'ip', 'ep')
//   - name        Optional display name suffix
//   - coords      Geographic position (with map-picker support)
//   - altitude_ft Holding altitude in feet (optional)
//   - flights     List of callsigns that use this steerpoint
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Open the shared steerpoints list dialog ──────────────────
function openSharedSteerpointsEditor() {
  openEditorDialog('SHARED STEER POINTS', function (body) {
    _renderSspList(body);
  }, function () {
    // Individual items save directly; this is a no-op.
  });
}

// ── Render the list of shared steerpoints ────────────────────
function _renderSspList(body) {
  body.innerHTML = '';
  var ato = editorEnsureSection('ato');
  var ssps = ato.shared_steerpoints || [];

  editorSectionTitle(body, 'SHARED STEER POINTS (' + ssps.length + ')');

  var listEl = el('div', 'ef-list-items');
  ssps.forEach(function (ssp, i) {
    var typeLabel = (ssp.type || '').toUpperCase();
    var label = [typeLabel, ssp.name].filter(Boolean).join(' ') || ssp.id || 'STEER PT ' + (i + 1);
    var flightsLabel = ssp.flights && ssp.flights.length ? ' — ' + ssp.flights.join(', ') : '';
    editorItemRow(listEl, label + flightsLabel,
      function () { _editSsp(i); },
      function () { _deleteSsp(i); }
    );
  });
  body.appendChild(listEl);

  var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD SHARED STEER PT');
  addBtn.addEventListener('click', function () { _addSsp(); });
  body.appendChild(addBtn);
}

// ── Edit an existing shared steerpoint ──────────────────────
function _editSsp(index) {
  var ato = editorEnsureSection('ato');
  if (!ato.shared_steerpoints) ato.shared_steerpoints = [];
  var ssp = ato.shared_steerpoints[index];
  if (!ssp) return;

  var title = 'EDIT SHARED STEER PT — ' + (ssp.name || ssp.id || '#' + index);
  _openSspForm(title, ssp, function (updated) {
    ato.shared_steerpoints[index] = updated;
    editorReRender();
    openSharedSteerpointsEditor();
  });
}

// ── Add a new shared steerpoint ─────────────────────────────
function _addSsp() {
  _openSspForm('ADD SHARED STEER PT', {}, function (updated) {
    var ato = editorEnsureSection('ato');
    if (!ato.shared_steerpoints) ato.shared_steerpoints = [];
    ato.shared_steerpoints.push(updated);
    editorReRender();
    openSharedSteerpointsEditor();
  });
}

// ── Delete a shared steerpoint ───────────────────────────────
function _deleteSsp(index) {
  var ato = editorEnsureSection('ato');
  if (!ato.shared_steerpoints) return;
  var ssp = ato.shared_steerpoints[index];
  var label = ssp.name || ssp.id || '#' + index;
  if (!confirm('Delete shared steer point ' + label + '?')) return;

  var sspId = ssp.id;

  ato.shared_steerpoints.splice(index, 1);

  // Remove steerpoint references from all missions
  if (sspId) {
    (ato.missions || []).forEach(function (m) {
      if (!m.steer_points) return;
      m.steer_points = m.steer_points.filter(function (sp) {
        return !(sp && sp.shared_steerpoint_id === sspId);
      });
    });
  }

  editorReRender();
  openSharedSteerpointsEditor();
}

// ── Build and open the SSP add/edit form ─────────────────────
function _openSspForm(title, ssp, onSave) {
  openEditorDialog(title, function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO SHARED PTS');
    backBtn.addEventListener('click', function () { openSharedSteerpointsEditor(); });
    body.appendChild(backBtn);

    var fId     = editorField(body, 'ID', ssp.id || '', { placeholder: 'e.g. SSP-1 (auto-generated if empty)' });
    var fType   = editorField(body, 'Type', ssp.type || '', {
      type: 'select',
      options: [
        { value: '', label: '— select type —' },
        { value: 'marshal', label: 'MARSHAL' },
        { value: 'ip',      label: 'IP' },
        { value: 'ep',      label: 'EP' },
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

    editorSectionTitle(body, 'FLIGHTS (one per line)');
    var flightsArea = document.createElement('textarea');
    flightsArea.className = 'ef-input ef-textarea';
    flightsArea.rows = 4;
    flightsArea.placeholder = 'FALCON5\nVIPER1';
    flightsArea.value = (ssp.flights || []).join('\n');
    body.appendChild(flightsArea);

    body._sspFields = { id: fId, type: fType, name: fName, coords: fCoords, alt: fAlt, flights: flightsArea };
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

  // Build updated SSP object
  var updated = Object.assign({}, orig);

  // ID: use existing or generate a unique one
  var idVal = (f.id.value || '').trim();
  if (!idVal) {
    // Auto-generate from type + name, or fallback to timestamp
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

  // Parse flights from the textarea (one callsign per line)
  var flightsRaw = f.flights.value || '';
  var flights = flightsRaw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  updated.flights = flights.length ? flights : undefined;

  onSave(updated);
}
