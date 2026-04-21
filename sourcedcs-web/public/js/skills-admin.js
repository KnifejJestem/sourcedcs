'use strict';

/* ── Theme ──────────────────────────────────────────────── */
function setTheme(t) {
  document.documentElement.classList.toggle('movie', t === 'movie');
  document.querySelectorAll('.theme-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.theme === t);
  });
  try { localStorage.setItem('sdcs-theme', t); } catch (e) {}
}
(function () {
  try { if (localStorage.getItem('sdcs-theme') === 'movie') setTheme('movie'); } catch (e) {}
})();

/* ── Grade constants ────────────────────────────────────── */
var GRADE_VALUES = { U: 0, F: 1, G: 2, E: 3 };
var GRADE_NAMES  = { U: 'Unsatisfactory', F: 'Fair', G: 'Good', E: 'Excellent' };

/* ── Auth helpers ───────────────────────────────────────── */
function getUser() {
  try { return JSON.parse(localStorage.getItem('sdcs-user') || 'null'); } catch (e) { return null; }
}
function logout() {
  try { localStorage.removeItem('sdcs-token'); localStorage.removeItem('sdcs-user'); } catch (e) {}
  location.reload();
}

/* ── State ──────────────────────────────────────────────── */
var _tree       = null;
var _treeEditor = null;  /* working copy mutated by the GUI editor */
var _allGrades  = {};    /* { [sub]: { [moduleId]: gradeRec } } */
var _pilots     = {};    /* { [sub]: { sub, name, callsign, registered_at } } */
var _requests   = [];
var _activeSub  = null;

/* ── Bootstrap ──────────────────────────────────────────── */
(function () {
  var tok  = getToken();
  var user = getUser();
  var btn  = document.getElementById('loginBtn');

  if (tok && user) {
    if (btn) {
      btn.textContent = (user.name || 'USER').toUpperCase() + ' \u23FB';
      btn.title = 'Click to log out';
      btn.classList.add('login-btn--logout');
      btn.onclick = logout;
    }
  } else {
    if (btn) { btn.textContent = 'LOGIN'; btn.onclick = loginWithCasdoor; }
  }

  if (!tok || !isAdminRole(tok)) {
    document.getElementById('accessDenied').style.display = '';
    return;
  }

  document.getElementById('adminPanel').style.display = '';
  loadAll(tok);
})();

/* ── Data loading ───────────────────────────────────────── */
function loadAll(tok) {
  var headers = { 'Authorization': 'Bearer ' + tok };

  Promise.all([
    fetch('/api/skill-tree').then(function (r) { return r.json(); }),
    fetch('/api/skill-grades', { headers: headers }).then(function (r) { return r.json(); }),
    fetch('/api/skill-pilots', { headers: headers }).then(function (r) { return r.json(); }),
    fetch('/api/grading-requests', { headers: headers }).then(function (r) { return r.json(); }),
  ]).then(function (results) {
    _tree      = results[0];
    _allGrades = results[1] || {};
    _pilots    = results[2] || {};
    _requests  = Array.isArray(results[3]) ? results[3] : [];

    renderGradingQueue();
    renderPilotList();
    initTreeEditor();
  }).catch(function (err) {
    console.error('[skills-admin] load failed:', err);
    showToast('Failed to load admin data', true);
  });
}

/* ── Score helpers ──────────────────────────────────────── */
function gradeValue(g) { return (g != null && GRADE_VALUES[g] != null) ? GRADE_VALUES[g] : -1; }

function moduleState(mod, grades) {
  var prereqs = mod.prerequisites || [];
  for (var i = 0; i < prereqs.length; i++) {
    var p  = prereqs[i];
    var gr = grades[p.module_id] ? grades[p.module_id].grade : null;
    if (gradeValue(gr) < gradeValue(p.min_grade)) return 'locked';
  }
  var myGrade = grades[mod.id] ? grades[mod.id].grade : null;
  if (myGrade == null) return 'not-started';
  if (gradeValue(myGrade) >= gradeValue(mod.min_pass_grade)) return 'completed';
  return 'in-progress';
}

function pilotOverallScore(sub) {
  if (!_tree || !_tree.categories) return 0;
  var grades = _allGrades[sub] || {};
  return _tree.categories.reduce(function (s, cat) {
    if (!cat.modules || !cat.modules.length) return s;
    var catScore = cat.modules.reduce(function (cs, mod) {
      var g = grades[mod.id] ? grades[mod.id].grade : null;
      return cs + (g != null ? (GRADE_VALUES[g] || 0) : 0);
    }, 0) / (cat.modules.length * 3);
    return s + (cat.weight || 0) * catScore;
  }, 0) / 100;
}

/* ── Grading queue ──────────────────────────────────────── */
function renderGradingQueue() {
  var el   = document.getElementById('gradingQueue');
  var open = _requests.filter(function (r) { return r.status === 'open' || r.status === 'claimed'; });

  if (!open.length) {
    el.innerHTML = '<div class="skills-empty" style="padding:12px 16px;font-size:9px">No open requests.</div>';
    return;
  }

  el.innerHTML = '';
  open.forEach(function (req) {
    var row = document.createElement('div');
    row.className = 'req-queue-row';
    var statusClass = req.status === 'claimed' ? 'req-claimed' : 'req-open';
    var time = req.requested_at ? new Date(req.requested_at).toLocaleDateString() : '';

    row.innerHTML =
      '<span class="request-status ' + statusClass + '">' + esc(req.status.toUpperCase()) + '</span>' +
      '<span class="req-queue-callsign">' + esc(req.pilot_callsign || req.pilot_name || req.pilot_id) + '</span>' +
      '<span class="req-queue-time">' + esc(time) + '</span>';

    var actDiv = document.createElement('div');
    actDiv.style.cssText = 'display:flex;gap:4px;flex-shrink:0';

    if (req.status === 'open') {
      var claimBtn = document.createElement('button');
      claimBtn.className = 'btn-sm btn-sm-blue';
      claimBtn.textContent = 'CLAIM';
      (function (id) { claimBtn.addEventListener('click', function () { claimRequest(id); }); })(req.id);
      actDiv.appendChild(claimBtn);
    }

    var viewBtn = document.createElement('button');
    viewBtn.className = 'btn-sm';
    viewBtn.textContent = 'VIEW';
    (function (pid) { viewBtn.addEventListener('click', function () { selectPilot(pid); }); })(req.pilot_id);
    actDiv.appendChild(viewBtn);

    var delBtn = document.createElement('button');
    delBtn.className = 'btn-sm btn-sm-danger';
    delBtn.textContent = 'X';
    (function (id) { delBtn.addEventListener('click', function () { deleteRequest(id); }); })(req.id);
    actDiv.appendChild(delBtn);

    row.appendChild(actDiv);
    el.appendChild(row);
  });
}

/* ── Pilot list ─────────────────────────────────────────── */
function renderPilotList() {
  var el   = document.getElementById('pilotList');
  var subs = Object.keys(_pilots);

  if (!subs.length) {
    el.innerHTML = '<div class="skills-empty" style="padding:12px 16px;font-size:9px">No pilots registered yet.</div>';
    return;
  }

  el.innerHTML = '';
  subs.forEach(function (sub) {
    var pilot = _pilots[sub];
    var score = Math.round(pilotOverallScore(sub) * 100);
    var row   = document.createElement('div');
    row.className = 'pilot-row' + (sub === _activeSub ? ' active' : '');
    row.setAttribute('data-sub', sub);
    row.innerHTML =
      '<span class="pilot-row-callsign">' + esc(pilot.callsign || pilot.name || sub) + '</span>' +
      '<span class="pilot-row-score">' + score + '%</span>';
    (function (s) { row.addEventListener('click', function () { selectPilot(s); }); })(sub);
    el.appendChild(row);
  });
}

/* ── Pilot detail ───────────────────────────────────────── */
function selectPilot(sub) {
  _activeSub = sub;

  document.querySelectorAll('.pilot-row').forEach(function (r) {
    r.classList.toggle('active', r.getAttribute('data-sub') === sub);
  });

  var pilot  = _pilots[sub] || { sub: sub, name: sub, callsign: sub };
  var grades = _allGrades[sub] || {};
  var score  = Math.round(pilotOverallScore(sub) * 100);
  var el     = document.getElementById('pilotDetail');
  el.innerHTML = '';

  /* Header */
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:baseline;gap:16px;margin-bottom:24px;padding-bottom:12px;border-bottom:1px solid var(--border)';
  hdr.innerHTML =
    '<span style="font-family:Orbitron,monospace;font-weight:900;font-size:16px;letter-spacing:3px">' +
      esc(pilot.callsign || pilot.name || sub) +
    '</span>' +
    '<span style="font-size:10px;color:var(--text-3)">' + esc(pilot.name || '') + '</span>' +
    '<span style="font-family:Orbitron,monospace;font-weight:700;font-size:20px;color:var(--green);margin-left:auto">' +
      score + '%' +
    '</span>';
  el.appendChild(hdr);

  (_tree.categories || []).forEach(function (cat) {
    var catSection = document.createElement('div');
    catSection.className = 'skill-category';

    var catHdr = document.createElement('div');
    catHdr.className = 'skill-cat-header';
    catHdr.innerHTML =
      '<span class="skill-cat-name">' + esc(cat.name) + '</span>' +
      '<span class="skill-cat-weight">Weight: ' + cat.weight + '%</span>';
    catSection.appendChild(catHdr);

    var grid = document.createElement('div');
    grid.className = 'skill-modules';
    (cat.modules || []).forEach(function (mod) {
      grid.appendChild(buildAdminModuleEl(mod, grades, sub));
    });
    catSection.appendChild(grid);
    el.appendChild(catSection);
  });
}

function buildAdminModuleEl(mod, grades, sub) {
  var state    = moduleState(mod, grades);
  var gradeRec = grades[mod.id] || null;

  var card = document.createElement('div');
  card.className = 'skill-module state-' + state;

  var BADGE_CLASS = {
    'locked':      'badge-locked',
    'not-started': 'badge-not-started',
    'in-progress': 'badge-in-progress',
    'completed':   'badge-completed',
  };

  /* Grade display */
  var gradeInfoHtml = '';
  if (gradeRec) {
    var gradedAt = gradeRec.graded_at ? new Date(gradeRec.graded_at).toLocaleDateString() : '';
    gradeInfoHtml =
      '<div class="skill-mod-grade">' +
        '<span class="skill-mod-grade-val grade-' + gradeRec.grade + '">' + esc(gradeRec.grade) + '</span>' +
        ' <span style="font-size:9px;color:var(--text-2)">' + esc(GRADE_NAMES[gradeRec.grade] || '') + '</span>' +
        '<div class="skill-mod-grade-meta">' +
          (gradeRec.graded_by ? esc(gradeRec.graded_by) + '<br>' : '') + esc(gradedAt) +
        '</div>' +
      '</div>';
    if (gradeRec.notes) {
      gradeInfoHtml += '<div class="skill-mod-grade-notes">' + esc(gradeRec.notes) + '</div>';
    }
  }

  card.innerHTML =
    '<div class="skill-mod-top">' +
      '<div class="skill-mod-title">' + esc(mod.title) + '</div>' +
      '<div class="skill-mod-badge ' + (BADGE_CLASS[state] || 'badge-not-started') + '">' +
        state.replace('-', ' ').toUpperCase() +
      '</div>' +
    '</div>' +
    '<div class="skill-mod-desc">' + esc(mod.description || '') + '</div>' +
    gradeInfoHtml;

  /* Grade controls */
  var controls = document.createElement('div');
  controls.className = 'admin-grade-row';

  var sel = document.createElement('select');
  sel.className = 'grade-select';
  var opts = '<option value="">—</option>';
  ['U', 'F', 'G', 'E'].forEach(function (g) {
    var selected = (gradeRec && gradeRec.grade === g) ? ' selected' : '';
    opts += '<option value="' + g + '"' + selected + '>' + g + ' — ' + GRADE_NAMES[g] + '</option>';
  });
  sel.innerHTML = opts;

  var notesInput = document.createElement('input');
  notesInput.className   = 'grade-notes-input';
  notesInput.type        = 'text';
  notesInput.placeholder = 'Notes (optional)';
  notesInput.value       = gradeRec ? (gradeRec.notes || '') : '';

  var saveBtn = document.createElement('button');
  saveBtn.className   = 'btn-save-grade';
  saveBtn.textContent = 'SAVE';
  (function (s, mid, selEl, notesEl) {
    saveBtn.addEventListener('click', function () {
      if (!selEl.value) { showToast('Select a grade first', true); return; }
      saveGrade(s, mid, selEl.value, notesEl.value);
    });
  })(sub, mod.id, sel, notesInput);

  var clearBtn = document.createElement('button');
  clearBtn.className   = 'btn-clear-grade';
  clearBtn.textContent = 'CLEAR';
  clearBtn.style.display = gradeRec ? '' : 'none';
  (function (s, mid) {
    clearBtn.addEventListener('click', function () { clearGrade(s, mid); });
  })(sub, mod.id);

  controls.appendChild(sel);
  controls.appendChild(notesInput);
  controls.appendChild(saveBtn);
  controls.appendChild(clearBtn);
  card.appendChild(controls);
  return card;
}

/* ── Grade API calls ────────────────────────────────────── */
function saveGrade(sub, moduleId, grade, notes) {
  var tok = getToken();
  fetch('/api/skill-grades/' + encodeURIComponent(sub) + '/' + encodeURIComponent(moduleId), {
    method:  'PUT',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ grade: grade, notes: notes }),
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function (gradeRec) {
    if (!_allGrades[sub]) _allGrades[sub] = {};
    _allGrades[sub][moduleId] = gradeRec;
    renderPilotList();
    selectPilot(sub);
    showToast('Grade saved');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

function clearGrade(sub, moduleId) {
  var tok = getToken();
  fetch('/api/skill-grades/' + encodeURIComponent(sub) + '/' + encodeURIComponent(moduleId), {
    method:  'DELETE',
    headers: { 'Authorization': 'Bearer ' + tok },
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function () {
    if (_allGrades[sub]) delete _allGrades[sub][moduleId];
    renderPilotList();
    selectPilot(sub);
    showToast('Grade cleared');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

/* ── Grading request actions ────────────────────────────── */
function claimRequest(id) {
  var tok = getToken();
  fetch('/api/grading-requests/' + id + '/claim', {
    method:  'PUT',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body:    JSON.stringify({}),
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function (updated) {
    var idx = _requests.findIndex(function (r) { return r.id === id; });
    if (idx !== -1) _requests[idx] = updated;
    renderGradingQueue();
    showToast('Request claimed');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

function deleteRequest(id) {
  if (!confirm('Delete this grading request?')) return;
  var tok = getToken();
  fetch('/api/grading-requests/' + id, {
    method:  'DELETE',
    headers: { 'Authorization': 'Bearer ' + tok },
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function () {
    _requests = _requests.filter(function (r) { return r.id !== id; });
    renderGradingQueue();
    showToast('Request deleted');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

/* ── Skill tree editor ──────────────────────────────────── */

function initTreeEditor() {
  _treeEditor = JSON.parse(JSON.stringify(_tree || { categories: [] }));
  renderTreeEditor();
}

/* Collect all modules flat across the tree (for prereq dropdowns) */
function flatModules() {
  var all = [];
  (_treeEditor.categories || []).forEach(function (cat) {
    (cat.modules || []).forEach(function (mod) {
      all.push({ id: mod.id, title: mod.title, catName: cat.name });
    });
  });
  return all;
}

function renderTreeEditor() {
  var el = document.getElementById('treeEditor');
  if (!el) return;
  el.innerHTML = '';

  var cats        = _treeEditor.categories || [];
  var totalWeight = cats.reduce(function (s, c) { return s + (Number(c.weight) || 0); }, 0);
  var weightOk    = Math.abs(totalWeight - 100) <= 0.01;
  var allMods     = flatModules();

  /* Weight indicator */
  var weightBar = document.createElement('div');
  weightBar.className = 'tree-weight-bar';
  var wLabel = document.createElement('span');
  wLabel.className   = 'tree-field-label';
  wLabel.textContent = 'TOTAL WEIGHT';
  var wTotal = document.createElement('span');
  wTotal.className   = 'tree-weight-total ' + (weightOk ? 'ok' : 'err');
  wTotal.textContent = totalWeight + ' / 100';
  weightBar.appendChild(wLabel);
  weightBar.appendChild(wTotal);
  el.appendChild(weightBar);

  /* Category cards */
  var catList = document.createElement('div');
  catList.className = 'tree-cat-list';
  cats.forEach(function (cat, ci) {
    catList.appendChild(buildCatCard(cat, ci, cats.length, allMods));
  });
  el.appendChild(catList);

  /* Add category button */
  var addCatBtn = document.createElement('button');
  addCatBtn.className   = 'btn-sm btn-sm-blue';
  addCatBtn.textContent = '+ ADD CATEGORY';
  addCatBtn.style.marginTop = '12px';
  addCatBtn.addEventListener('click', addCategory);
  el.appendChild(addCatBtn);

  /* Save / reset actions */
  var actions = document.createElement('div');
  actions.className = 'tree-editor-actions';

  var saveBtn = document.createElement('button');
  saveBtn.className   = 'btn-save-grade';
  saveBtn.textContent = 'SAVE TREE';
  saveBtn.addEventListener('click', saveSkillTree);

  var resetBtn = document.createElement('button');
  resetBtn.className   = 'btn-clear-grade';
  resetBtn.textContent = 'RESET';
  resetBtn.addEventListener('click', initTreeEditor);

  var msg = document.createElement('span');
  msg.className = 'tree-editor-msg';
  msg.id        = 'treeEditorMsg';

  actions.appendChild(saveBtn);
  actions.appendChild(resetBtn);
  actions.appendChild(msg);
  el.appendChild(actions);
}

function updateWeightBar() {
  var cats  = _treeEditor.categories || [];
  var total = cats.reduce(function (s, c) { return s + (Number(c.weight) || 0); }, 0);
  var ok    = Math.abs(total - 100) <= 0.01;
  var el    = document.querySelector('.tree-weight-total');
  if (el) { el.textContent = total + ' / 100'; el.className = 'tree-weight-total ' + (ok ? 'ok' : 'err'); }
}

function buildCatCard(cat, ci, totalCats, allMods) {
  var card = document.createElement('div');
  card.className = 'tree-cat-card';

  /* ── Header: name + weight + reorder/delete ── */
  var hdr = document.createElement('div');
  hdr.className = 'tree-cat-header';

  var nameInput = document.createElement('input');
  nameInput.className   = 'tree-input tree-cat-name-input';
  nameInput.placeholder = 'Category name';
  nameInput.value       = cat.name || '';
  nameInput.addEventListener('input', function () { cat.name = this.value; });

  var wLabel = document.createElement('span');
  wLabel.className   = 'tree-field-label';
  wLabel.textContent = 'WEIGHT';

  var weightInput = document.createElement('input');
  weightInput.className   = 'tree-input tree-weight-input';
  weightInput.type        = 'number';
  weightInput.min         = '0';
  weightInput.max         = '100';
  weightInput.placeholder = '0';
  weightInput.value       = cat.weight != null ? cat.weight : '';
  weightInput.addEventListener('input', function () {
    cat.weight = Number(this.value) || 0;
    updateWeightBar();
  });

  var pct = document.createElement('span');
  pct.style.cssText  = 'font-size:10px;color:var(--text-3)';
  pct.textContent    = '%';

  var ctrlDiv = document.createElement('div');
  ctrlDiv.style.cssText = 'display:flex;gap:4px;margin-left:auto;flex-shrink:0';

  var upBtn = document.createElement('button');
  upBtn.className   = 'btn-sm';
  upBtn.textContent = '↑';
  upBtn.disabled    = ci === 0;
  (function (i) { upBtn.addEventListener('click', function () { moveCategoryUp(i); }); })(ci);

  var dnBtn = document.createElement('button');
  dnBtn.className   = 'btn-sm';
  dnBtn.textContent = '↓';
  dnBtn.disabled    = ci === totalCats - 1;
  (function (i) { dnBtn.addEventListener('click', function () { moveCategoryDown(i); }); })(ci);

  var delBtn = document.createElement('button');
  delBtn.className   = 'btn-sm btn-sm-danger';
  delBtn.textContent = '×';
  (function (i, name) {
    delBtn.addEventListener('click', function () {
      if (confirm('Remove category "' + (name || 'unnamed') + '" and all its modules?')) removeCategory(i);
    });
  })(ci, cat.name);

  ctrlDiv.appendChild(upBtn); ctrlDiv.appendChild(dnBtn); ctrlDiv.appendChild(delBtn);
  hdr.appendChild(nameInput); hdr.appendChild(wLabel); hdr.appendChild(weightInput);
  hdr.appendChild(pct); hdr.appendChild(ctrlDiv);
  card.appendChild(hdr);

  /* ── Category ID row ── */
  card.appendChild(buildIdRow(cat, 'category-id'));

  /* ── Module list ── */
  var modList = document.createElement('div');
  modList.className = 'tree-mod-list';
  (cat.modules || []).forEach(function (mod, mi) {
    modList.appendChild(buildModCard(mod, mi, (cat.modules || []).length, ci, allMods));
  });
  card.appendChild(modList);

  /* ── Add module button ── */
  var addModBtn = document.createElement('button');
  addModBtn.className   = 'btn-sm';
  addModBtn.textContent = '+ ADD MODULE';
  addModBtn.style.cssText = 'margin: 4px 10px 10px';
  (function (i) { addModBtn.addEventListener('click', function () { addModule(i); }); })(ci);
  card.appendChild(addModBtn);

  return card;
}

function buildModCard(mod, mi, totalMods, ci, allMods) {
  var card = document.createElement('div');
  card.className = 'tree-mod-card';

  /* ── Module header: title + pass grade + reorder/delete ── */
  var hdr = document.createElement('div');
  hdr.className = 'tree-mod-header';

  var titleInput = document.createElement('input');
  titleInput.className   = 'tree-input tree-mod-title-input';
  titleInput.placeholder = 'Module title';
  titleInput.value       = mod.title || '';
  titleInput.addEventListener('input', function () { mod.title = this.value; });

  var passLabel = document.createElement('span');
  passLabel.className   = 'tree-field-label';
  passLabel.textContent = 'PASS';

  var gradeSel = document.createElement('select');
  gradeSel.className = 'grade-select';
  ['U', 'F', 'G', 'E'].forEach(function (g) {
    var opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    if ((mod.min_pass_grade || 'G') === g) opt.selected = true;
    gradeSel.appendChild(opt);
  });
  gradeSel.addEventListener('change', function () { mod.min_pass_grade = this.value; });

  var ctrlDiv = document.createElement('div');
  ctrlDiv.style.cssText = 'display:flex;gap:4px;margin-left:auto;flex-shrink:0';

  var upBtn = document.createElement('button');
  upBtn.className = 'btn-sm'; upBtn.textContent = '↑'; upBtn.disabled = mi === 0;
  (function (c, m) { upBtn.addEventListener('click', function () { moveModuleUp(c, m); }); })(ci, mi);

  var dnBtn = document.createElement('button');
  dnBtn.className = 'btn-sm'; dnBtn.textContent = '↓'; dnBtn.disabled = mi === totalMods - 1;
  (function (c, m) { dnBtn.addEventListener('click', function () { moveModuleDown(c, m); }); })(ci, mi);

  var delBtn = document.createElement('button');
  delBtn.className = 'btn-sm btn-sm-danger'; delBtn.textContent = '×';
  (function (c, m, title) {
    delBtn.addEventListener('click', function () {
      if (confirm('Remove module "' + (title || 'unnamed') + '"?')) removeModule(c, m);
    });
  })(ci, mi, mod.title);

  ctrlDiv.appendChild(upBtn); ctrlDiv.appendChild(dnBtn); ctrlDiv.appendChild(delBtn);
  hdr.appendChild(titleInput); hdr.appendChild(passLabel); hdr.appendChild(gradeSel); hdr.appendChild(ctrlDiv);
  card.appendChild(hdr);

  /* ── Module body ── */
  var body = document.createElement('div');
  body.className = 'tree-mod-body';

  /* ID */
  body.appendChild(buildIdRow(mod, 'module-id'));

  /* Description */
  var descRow = document.createElement('div');
  descRow.className = 'tree-desc-row';
  var descLabel = document.createElement('span');
  descLabel.className = 'tree-field-label'; descLabel.textContent = 'DESCRIPTION';
  var descTA = document.createElement('textarea');
  descTA.className   = 'tree-textarea';
  descTA.placeholder = 'What must the pilot demonstrate?';
  descTA.value       = mod.description || '';
  descTA.addEventListener('input', function () { mod.description = this.value; });
  descRow.appendChild(descLabel); descRow.appendChild(descTA);
  body.appendChild(descRow);

  /* Prerequisites */
  body.appendChild(buildPrereqSection(mod, ci, mi, allMods));

  card.appendChild(body);
  return card;
}

/* Shared ID row builder */
function buildIdRow(obj, placeholder) {
  var row = document.createElement('div');
  row.className = 'tree-id-row';
  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label'; lbl.textContent = 'ID';
  var inp = document.createElement('input');
  inp.className = 'tree-input tree-id-input';
  inp.placeholder = placeholder || 'id';
  inp.value = obj.id || '';
  inp.addEventListener('input', function () { obj.id = this.value; });
  row.appendChild(lbl); row.appendChild(inp);
  return row;
}

function buildPrereqSection(mod, ci, mi, allMods) {
  var section = document.createElement('div');
  section.className = 'tree-prereq-section';

  /* Label + add button on same row */
  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:8px';
  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label'; lbl.textContent = 'PREREQUISITES';
  var addBtn = document.createElement('button');
  addBtn.className = 'btn-sm'; addBtn.textContent = '+ ADD';
  (function (c, m) { addBtn.addEventListener('click', function () { addPrereq(c, m); }); })(ci, mi);
  topRow.appendChild(lbl); topRow.appendChild(addBtn);
  section.appendChild(topRow);

  /* One row per existing prereq */
  var prereqs  = mod.prerequisites || [];
  var availMods = allMods.filter(function (m) { return m.id !== mod.id; });

  if (!prereqs.length) {
    var none = document.createElement('span');
    none.style.cssText = 'font-size:9px;color:var(--text-3);margin-top:4px;display:block';
    none.textContent   = 'None';
    section.appendChild(none);
  } else {
    prereqs.forEach(function (prereq, pi) {
      section.appendChild(buildPrereqRow(prereq, pi, ci, mi, availMods));
    });
  }

  return section;
}

function buildPrereqRow(prereq, pi, ci, mi, availMods) {
  var row = document.createElement('div');
  row.className = 'tree-prereq-row';

  /* Module select */
  var modSel = document.createElement('select');
  modSel.className = 'grade-select';
  modSel.style.flex = '1';
  if (!availMods.length) {
    var noOpt = document.createElement('option');
    noOpt.value = ''; noOpt.textContent = '(no other modules yet)';
    modSel.appendChild(noOpt);
  } else {
    availMods.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = (m.title || m.id);
      if (prereq.module_id === m.id) opt.selected = true;
      modSel.appendChild(opt);
    });
  }
  modSel.addEventListener('change', function () { prereq.module_id = this.value; });

  /* Min grade select */
  var gradeSel = document.createElement('select');
  gradeSel.className = 'grade-select';
  ['U', 'F', 'G', 'E'].forEach(function (g) {
    var opt = document.createElement('option');
    opt.value = g; opt.textContent = g + '+';
    if ((prereq.min_grade || 'G') === g) opt.selected = true;
    gradeSel.appendChild(opt);
  });
  gradeSel.addEventListener('change', function () { prereq.min_grade = this.value; });

  var delBtn = document.createElement('button');
  delBtn.className = 'btn-sm btn-sm-danger'; delBtn.textContent = '×';
  (function (c, m, p) { delBtn.addEventListener('click', function () { removePrereq(c, m, p); }); })(ci, mi, pi);

  row.appendChild(modSel); row.appendChild(gradeSel); row.appendChild(delBtn);
  return row;
}

/* ── Tree mutation helpers (all re-render) ──────────────── */
function addCategory() {
  (_treeEditor.categories = _treeEditor.categories || []).push({
    id: 'cat-' + Date.now(), name: '', weight: 0, modules: [],
  });
  renderTreeEditor();
}
function removeCategory(ci) {
  _treeEditor.categories.splice(ci, 1);
  renderTreeEditor();
}
function moveCategoryUp(ci) {
  var a = _treeEditor.categories;
  if (ci < 1) return;
  var t = a[ci - 1]; a[ci - 1] = a[ci]; a[ci] = t;
  renderTreeEditor();
}
function moveCategoryDown(ci) {
  var a = _treeEditor.categories;
  if (ci >= a.length - 1) return;
  var t = a[ci + 1]; a[ci + 1] = a[ci]; a[ci] = t;
  renderTreeEditor();
}
function addModule(ci) {
  var cat = _treeEditor.categories[ci];
  if (!cat) return;
  (cat.modules = cat.modules || []).push({
    id: 'mod-' + Date.now(), title: '', description: '', min_pass_grade: 'G', prerequisites: [],
  });
  renderTreeEditor();
}
function removeModule(ci, mi) {
  _treeEditor.categories[ci].modules.splice(mi, 1);
  renderTreeEditor();
}
function moveModuleUp(ci, mi) {
  var a = _treeEditor.categories[ci].modules;
  if (mi < 1) return;
  var t = a[mi - 1]; a[mi - 1] = a[mi]; a[mi] = t;
  renderTreeEditor();
}
function moveModuleDown(ci, mi) {
  var a = _treeEditor.categories[ci].modules;
  if (mi >= a.length - 1) return;
  var t = a[mi + 1]; a[mi + 1] = a[mi]; a[mi] = t;
  renderTreeEditor();
}
function addPrereq(ci, mi) {
  var mod      = _treeEditor.categories[ci].modules[mi];
  var allIds   = flatModules().map(function (m) { return m.id; });
  var existing = (mod.prerequisites || []).map(function (p) { return p.module_id; });
  var first    = allIds.find(function (id) { return id !== mod.id && !existing.includes(id); }) || '';
  (mod.prerequisites = mod.prerequisites || []).push({ module_id: first, min_grade: 'G' });
  renderTreeEditor();
}
function removePrereq(ci, mi, pi) {
  _treeEditor.categories[ci].modules[mi].prerequisites.splice(pi, 1);
  renderTreeEditor();
}

function saveSkillTree() {
  var msg = document.getElementById('treeEditorMsg');

  var tok = getToken();
  fetch('/api/skill-tree', {
    method:  'PUT',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body:    JSON.stringify(_treeEditor),
  }).then(function (r) {
    return r.json().then(function (body) { return { ok: r.ok, body: body }; });
  }).then(function (result) {
    if (!result.ok) {
      if (msg) { msg.textContent = 'Error: ' + (result.body.error || 'unknown'); msg.className = 'tree-editor-msg err'; }
      return;
    }
    _tree       = result.body;
    _treeEditor = JSON.parse(JSON.stringify(_tree));
    renderTreeEditor();
    if (msg) { msg.textContent = 'Saved.'; msg.className = 'tree-editor-msg ok'; }
    if (_activeSub) selectPilot(_activeSub);
    renderPilotList();
    showToast('Skill tree saved');
  }).catch(function (err) {
    if (msg) { msg.textContent = 'Error: ' + err.message; msg.className = 'tree-editor-msg err'; }
  });
}

/* ── Helpers ────────────────────────────────────────────── */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var _toastTimer = null;
function showToast(msg, isErr) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'skills-toast visible' + (isErr ? ' err' : '');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { el.className = 'skills-toast'; }, 3000);
}
