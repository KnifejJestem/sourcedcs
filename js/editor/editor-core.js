// ═══════════════════════════════════════════════════════════
// editor-core.js — Editor framework: state, dialog, form helpers, export
//
// Provides the shared infrastructure for all section editors.
// Keeps editor logic isolated from the read-only view layer.
//
// Public API:
//   EDITOR              — editor state object
//   toggleEditMode()    — enable / disable edit mode
//   openEditorDialog()  — open the generic editor panel
//   closeEditorDialog() — close without saving
//   editorField()       — create a labelled form field
//   editorListBlock()   — create a collapsible list with add/remove
//   editorReRender()    — re-resolve registry + re-render all views
//   exportPackageYaml() — download current package as YAML
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Editor state ─────────────────────────────────────────────
const EDITOR = {
  active:   false,   // true when edit mode is on
  _onSave:  null,    // callback for current dialog
};

// ── Edit mode toggle ─────────────────────────────────────────
function toggleEditMode() {
  if (!STATE.pkg) return;
  EDITOR.active = !EDITOR.active;
  document.documentElement.classList.toggle('edit-mode', EDITOR.active);
  const btn = document.getElementById('editModeBtn');
  if (btn) btn.classList.toggle('active', EDITOR.active);
}

// ── Editor dialog ────────────────────────────────────────────
// Opens a full-panel dialog.  buildFn(body) populates the form;
// onSave() is called when the user clicks SAVE.
function openEditorDialog(title, buildFn, onSave) {
  const overlay = document.getElementById('editorOverlay');
  const titleEl = document.getElementById('editorTitle');
  const body    = document.getElementById('editorBody');
  if (!overlay || !body) return;

  titleEl.textContent = title;
  body.innerHTML = '';
  EDITOR._onSave = onSave;
  buildFn(body);
  overlay.style.display = 'flex';
}

function closeEditorDialog() {
  const overlay = document.getElementById('editorOverlay');
  if (overlay) overlay.style.display = 'none';
  EDITOR._onSave = null;
}

function saveEditorDialog() {
  if (typeof EDITOR._onSave === 'function') {
    EDITOR._onSave();
  }
  closeEditorDialog();
}

// ── Form field builders ──────────────────────────────────────
// Each returns the input/select element so callers can read .value.

// Text input field
function editorField(parent, label, value, opts) {
  opts = opts || {};
  const wrap = el('div', 'ef-group');
  wrap.appendChild(el('label', 'ef-label', label));

  let input;
  if (opts.type === 'textarea') {
    input = document.createElement('textarea');
    input.className = 'ef-input ef-textarea';
    input.rows = opts.rows || 3;
  } else if (opts.type === 'select') {
    input = document.createElement('select');
    input.className = 'ef-input';
    (opts.options || []).forEach(function (o) {
      const opt = document.createElement('option');
      if (typeof o === 'object') { opt.value = o.value; opt.textContent = o.label; }
      else { opt.value = o; opt.textContent = o; }
      input.appendChild(opt);
    });
  } else {
    input = document.createElement('input');
    input.type = opts.type || 'text';
    input.className = 'ef-input';
  }

  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (value != null) input.value = String(value);
  if (opts.disabled)  input.disabled = true;

  wrap.appendChild(input);
  if (opts.hint) wrap.appendChild(el('div', 'ef-hint', opts.hint));
  parent.appendChild(wrap);
  return input;
}

// Section divider inside the editor form
function editorSectionTitle(parent, title) {
  parent.appendChild(el('div', 'ef-section-title', title));
}

// A list block with header, items, and an ADD button.
// itemBuildFn(container, item, index) renders one item.
// Returns { container } so the caller can refresh.
function editorListBlock(parent, title, items, itemBuildFn, onAdd) {
  const block = el('div', 'ef-list-block');
  const hdr   = el('div', 'ef-list-header');
  hdr.appendChild(el('span', 'ef-list-title', title + ' (' + items.length + ')'));

  if (onAdd) {
    const addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD');
    addBtn.addEventListener('click', onAdd);
    hdr.appendChild(addBtn);
  }

  block.appendChild(hdr);

  const container = el('div', 'ef-list-items');
  items.forEach(function (item, i) {
    itemBuildFn(container, item, i);
  });
  block.appendChild(container);

  parent.appendChild(block);
  return { container: container };
}

// Inline item row with edit/delete buttons
function editorItemRow(parent, label, onEdit, onDelete) {
  const row = el('div', 'ef-item-row');
  row.appendChild(el('span', 'ef-item-label', label));
  const btns = el('div', 'ef-item-btns');

  if (onEdit) {
    const editBtn = el('button', 'ef-btn ef-btn-sm', 'EDIT');
    editBtn.addEventListener('click', onEdit);
    btns.appendChild(editBtn);
  }
  if (onDelete) {
    const delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', 'DEL');
    delBtn.addEventListener('click', onDelete);
    btns.appendChild(delBtn);
  }

  row.appendChild(btns);
  parent.appendChild(row);
}

// ── Re-render after edits ────────────────────────────────────
// Re-runs the full load pipeline so registry references are resolved,
// then re-renders all views.  Preserves the current tab and selection.
function editorReRender() {
  if (!STATE.pkg) return;

  var savedTab = STATE.currentTab;
  var savedIdx = STATE.selectedIdx;

  // Rebuild a clean source object from current pkg, stripping internal fields
  var source = editorCleanPkg(STATE.pkg);
  loadPackage_obj(source);

  STATE.selectedIdx = savedIdx;
  showTab(savedTab);

  // If presenter in a session, broadcast the updated package
  if (SESSION && SESSION.role === 'presenter' && SESSION.connected && SESSION.socket) {
    var yamlText = jsyaml.dump(source, { lineWidth: -1, noRefs: true });
    SESSION.socket.emit('package-loaded', yamlText);
  }
}

// ── Clean package for export ─────────────────────────────────
// Strips internal fields (prefixed with _) added during resolution.
function editorCleanPkg(pkg) {
  if (pkg == null || typeof pkg !== 'object') return pkg;
  if (Array.isArray(pkg)) return pkg.map(editorCleanPkg);

  var clean = {};
  Object.keys(pkg).forEach(function (k) {
    if (k.charAt(0) === '_') return;  // skip internal fields
    clean[k] = editorCleanPkg(pkg[k]);
  });
  return clean;
}

// ── Export as YAML ───────────────────────────────────────────
function exportPackageYaml() {
  if (!STATE.pkg) { alert('No package loaded'); return; }

  var clean    = editorCleanPkg(STATE.pkg);
  var yamlText = jsyaml.dump(clean, { lineWidth: -1, noRefs: true, sortKeys: false });
  var blob     = new Blob([yamlText], { type: 'text/yaml' });
  var url      = URL.createObjectURL(blob);

  var a = document.createElement('a');
  a.href     = url;
  a.download = 'package.yaml';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Ensure section exists ────────────────────────────────────
// Initialises a top-level section (ato, aco, spins, comms, weather)
// if it doesn't already exist.
function editorEnsureSection(key) {
  if (!STATE.pkg) STATE.pkg = {};
  if (!STATE.pkg[key]) STATE.pkg[key] = {};
  return STATE.pkg[key];
}

function editorEnsureRegistry() {
  if (!STATE.pkg) STATE.pkg = {};
  if (!STATE.pkg.registry) STATE.pkg.registry = {};
  return STATE.pkg.registry;
}
