// ═══════════════════════════════════════════════════════════
// editor-missions-targets.js — Target sub-dialog + steer points
//
// Extracted from editor-missions.js to keep files under 400 lines.
// Contains: _msnNav state, _editTarget, _reopenMissionForm,
// _renderTargetsList, and _renderSteerPointsList.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Navigation state for target sub-dialog ───────────────────
// Holds the mission form snapshot so we can navigate back from
// the target editor without losing the rest of the form.
var _msnNav = null; // { title, m, onSave }

// ── Targets compact list renderer ────────────────────────────
function _renderTargetsList(listEl, targets, msnTitle, onSave) {
  listEl.innerHTML = '';
  targets.forEach(function (tgt, i) {
    var label = tgt.location || (tgt.target_id ? '\u2192 ' + tgt.target_id : 'TARGET ' + (i + 1));
    editorItemRow(listEl, label,
      function () { _editTarget(targets, i, msnTitle, onSave); },
      function () {
        targets.splice(i, 1);
        _renderTargetsList(listEl, targets, msnTitle, onSave);
      }
    );
  });
}

// ── Navigate back from target sub-dialog to mission form ─────
function _reopenMissionForm() {
  if (!_msnNav) return;
  var nav = _msnNav;
  _msnNav = null;
  _openMissionForm(nav.title, nav.m, nav.onSave);
}

// ── Target sub-dialog ────────────────────────────────────────
function _editTarget(targets, index, msnTitle, onSave) {
  // Snapshot the mission form before body gets cleared by openEditorDialog
  var draft = _collectMissionDraft();
  if (draft) {
    draft.targets = targets; // keep the live array so edits persist
    _msnNav = { title: msnTitle, m: draft, onSave: onSave };
  } else {
    _msnNav = { title: msnTitle, m: { targets: targets }, onSave: onSave };
  }

  var tgt = targets[index];
  var tgtOpts = _registryOptions('targets', function (id, t) { return id + (t.name ? ' \u2014 ' + t.name : ''); });

  openEditorDialog('EDIT TARGET ' + (index + 1), function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO MISSION');
    backBtn.addEventListener('click', function () {
      _reopenMissionForm();
    });
    body.appendChild(backBtn);

    function bind(input, key) {
      input.addEventListener('input', function () { tgt[key] = this.value || undefined; });
    }
    function bindSel(input, key) {
      input.addEventListener('change', function () { tgt[key] = this.value || undefined; });
    }

    bind(editorField(body, 'Location', tgt.location, { placeholder: 'e.g. KHASAB' }), 'location');
    bind(editorField(body, 'Altitude', tgt.altitude, { placeholder: 'e.g. E73FT' }), 'altitude');
    bindSel(editorField(body, 'Target', tgt.target_id, { type: 'select', options: tgtOpts }), 'target_id');
    bind(editorField(body, 'Mission Type Override', tgt.mission_type_override, { placeholder: 'e.g. AIRDEF' }), 'mission_type_override');
    bind(editorField(body, 'TOT NET', tgt.tot_net, { placeholder: '2046' }), 'tot_net');
    bind(editorField(body, 'TOT NLT', tgt.tot_nlt, { placeholder: '2111' }), 'tot_nlt');
    bind(editorField(body, 'TOS', tgt.tos, { placeholder: '2040' }), 'tos');
    bind(editorField(body, 'TOFFS', tgt.toffs, { placeholder: '2230' }), 'toffs');
  }, function () {
    // SAVE button: return to mission form after closeEditorDialog hides overlay
    setTimeout(_reopenMissionForm, 0);
  });
}

// ── Steer points list renderer ──────────────────────────────
function _renderSteerPointsList(container, steerPts) {
  container.innerHTML = '';
  steerPts.forEach(function (sp, i) {
    var row = el('div', 'ef-ap-row');

    var nameInput = el('input', 'ef-input ef-input-sm');
    nameInput.placeholder = 'Name (e.g. SP1)';
    nameInput.value = sp.name || '';
    (function (point) {
      nameInput.addEventListener('input', function () { point.name = this.value; });
    })(sp);
    row.appendChild(nameInput);

    var coordInput = el('input', 'ef-input ef-input-sm');
    coordInput.placeholder = "N24\u00b030'00\" E055\u00b030'00\"";
    coordInput.value = sp.coords || '';
    (function (point) {
      coordInput.addEventListener('input', function () { point.coords = this.value; });
    })(sp);
    row.appendChild(coordInput);

    var pickBtn = el('button', 'ef-btn ef-btn-sm ef-btn-pick', '📍');
    pickBtn.title = 'Pick from map';
    pickBtn.type = 'button';
    pickBtn.addEventListener('click', function () {
      _startCoordPick(coordInput);
    });
    row.appendChild(pickBtn);

    // Orbit toggle button
    var orbitBtn = el('button', 'ef-btn ef-btn-sm' + (sp.orbit ? ' ef-btn-orbit-active' : ''), '⟳');
    orbitBtn.title = 'Add/edit orbit pattern';
    orbitBtn.type = 'button';
    (function (point, idx) {
      orbitBtn.addEventListener('click', function () {
        if (!point.orbit) {
          point.orbit = { heading_deg: 0, leg_nm: 10, width_nm: 5, cw: true };
        } else {
          delete point.orbit;
        }
        _renderSteerPointsList(container, steerPts);
      });
    })(sp, i);
    row.appendChild(orbitBtn);

    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '\u2715');
    (function (idx) {
      delBtn.addEventListener('click', function () {
        steerPts.splice(idx, 1);
        _renderSteerPointsList(container, steerPts);
      });
    })(i);
    row.appendChild(delBtn);

    container.appendChild(row);

    // Orbit fields (shown when orbit is active)
    if (sp.orbit) {
      var orbitRow = el('div', 'ef-orbit-row');

      var hdgInput = el('input', 'ef-input ef-input-sm');
      hdgInput.placeholder = 'Hdg °';
      hdgInput.type = 'text';
      hdgInput.inputMode = 'decimal';
      hdgInput.value = sp.orbit.heading_deg != null ? sp.orbit.heading_deg : '';
      hdgInput.title = 'Orbit heading (degrees)';
      (function (orb) {
        hdgInput.addEventListener('input', function () {
          orb.heading_deg = this.value !== '' ? parseFloat(this.value) : 0;
        });
      })(sp.orbit);
      orbitRow.appendChild(_labelWrap('HDG°', hdgInput));

      var legInput = el('input', 'ef-input ef-input-sm');
      legInput.placeholder = 'Leg NM';
      legInput.type = 'text';
      legInput.inputMode = 'decimal';
      legInput.value = sp.orbit.leg_nm != null ? sp.orbit.leg_nm : '';
      legInput.title = 'Orbit leg length (NM)';
      (function (orb) {
        legInput.addEventListener('input', function () {
          orb.leg_nm = this.value !== '' ? parseFloat(this.value) : 10;
        });
      })(sp.orbit);
      orbitRow.appendChild(_labelWrap('LEG NM', legInput));

      var widthInput = el('input', 'ef-input ef-input-sm');
      widthInput.placeholder = 'Width NM';
      widthInput.type = 'text';
      widthInput.inputMode = 'decimal';
      widthInput.value = sp.orbit.width_nm != null ? sp.orbit.width_nm : '';
      widthInput.title = 'Orbit width (NM)';
      (function (orb) {
        widthInput.addEventListener('input', function () {
          orb.width_nm = this.value !== '' ? parseFloat(this.value) : 5;
        });
      })(sp.orbit);
      orbitRow.appendChild(_labelWrap('WIDTH', widthInput));

      var dirSelect = document.createElement('select');
      dirSelect.className = 'ef-input ef-input-sm';
      dirSelect.title = 'Orbit direction';
      var cwOpt = document.createElement('option');
      cwOpt.value = 'true'; cwOpt.textContent = 'CW';
      var ccwOpt = document.createElement('option');
      ccwOpt.value = 'false'; ccwOpt.textContent = 'CCW';
      dirSelect.appendChild(cwOpt);
      dirSelect.appendChild(ccwOpt);
      dirSelect.value = sp.orbit.cw === false ? 'false' : 'true';
      (function (orb) {
        dirSelect.addEventListener('change', function () {
          orb.cw = this.value === 'true';
        });
      })(sp.orbit);
      orbitRow.appendChild(_labelWrap('DIR', dirSelect));

      container.appendChild(orbitRow);
    }
  });
}

// Helper to wrap an input with a tiny label above it
function _labelWrap(labelText, inputEl) {
  var wrap = el('div', 'ef-orbit-field');
  var lbl = el('span', 'ef-orbit-label', labelText);
  wrap.appendChild(lbl);
  wrap.appendChild(inputEl);
  return wrap;
}
