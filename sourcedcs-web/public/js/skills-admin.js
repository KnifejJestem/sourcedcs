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
var _tree           = null;
var _treeEditor     = null;  /* working copy mutated by the GUI editor */
var _allGrades      = {};    /* { [sub]: { [moduleId]: gradeRec } } */
var _pilots         = {};    /* { [sub]: { sub, name, callsign, registered_at } } */
var _requests       = [];
var _squadrons      = [];    /* squadron list from /api/squadrons */
var _activeSub      = null;
var _editorCollapsed = {};   /* { [catId]: bool } collapse state for tree editor */
var _detailCollapsed = {};   /* { [catId]: bool } collapse state for pilot detail */

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

  if (!tok || !isSkillAdminRole(tok)) {
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
    fetch('/api/squadrons').then(function (r) { return r.json(); }).catch(function () { return []; }),
  ]).then(function (results) {
    _tree      = results[0];
    _allGrades = results[1] || {};
    _pilots    = results[2] || {};
    _requests  = Array.isArray(results[3]) ? results[3] : [];
    _squadrons = Array.isArray(results[4]) ? results[4] : [];

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
  var grades      = _allGrades[sub] || {};
  var totalWeight = _tree.categories.reduce(function (s, c) { return s + (c.weight || 0); }, 0);
  if (!totalWeight) return 0;
  return _tree.categories.reduce(function (s, cat) {
    if (!cat.modules || !cat.modules.length) return s;
    var completed = cat.modules.filter(function (mod) {
      return moduleState(mod, grades) === 'completed';
    }).length;
    var catScore = completed / cat.modules.length;
    return s + (cat.weight || 0) * catScore;
  }, 0) / totalWeight;
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
    var discordOk = req.discord_message_id ? '' :
      '<span style="font-size:7px;color:var(--text-3);display:block">no discord</span>';

    /* Left: status + name + module + date stacked */
    var infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'flex:1;min-width:0';
    var claimedByHtml = (req.status === 'claimed' && req.claimed_by_name)
      ? '<div style="font-size:8px;color:var(--text-2);margin-top:2px">Claimed by ' + esc(req.claimed_by_name) + '</div>'
      : '';
    var moduleHtml = req.module_title
      ? '<div style="font-size:8px;color:var(--text-2);margin-top:1px">' + esc(req.module_title) + '</div>'
      : '';
    infoDiv.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px">' +
        '<span class="request-status ' + statusClass + '">' + esc(req.status.toUpperCase()) + '</span>' +
        '<span class="req-queue-callsign">' + esc(req.pilot_callsign || req.pilot_name || req.pilot_id) + '</span>' +
      '</div>' +
      moduleHtml +
      claimedByHtml +
      '<div class="req-queue-time">' + esc(time) + discordOk + '</div>';
    row.appendChild(infoDiv);

    /* Right: buttons stacked vertically */
    var actDiv = document.createElement('div');
    actDiv.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex-shrink:0';

    if (req.status === 'open') {
      var claimBtn = document.createElement('button');
      claimBtn.className = 'btn-sm btn-sm-blue';
      claimBtn.textContent = 'CLAIM';
      (function (id) { claimBtn.addEventListener('click', function () { claimRequest(id); }); })(req.id);
      actDiv.appendChild(claimBtn);
    }

    if (req.status === 'claimed') {
      var unclaimBtn = document.createElement('button');
      unclaimBtn.className = 'btn-sm';
      unclaimBtn.textContent = 'UNCLAIM';
      (function (id) { unclaimBtn.addEventListener('click', function () { unclaimRequest(id); }); })(req.id);
      actDiv.appendChild(unclaimBtn);
    }

    var viewBtn = document.createElement('button');
    viewBtn.className = 'btn-sm';
    viewBtn.textContent = 'VIEW';
    (function (pid) { viewBtn.addEventListener('click', function () { selectPilot(pid); }); })(req.pilot_id);
    actDiv.appendChild(viewBtn);

    var delBtn = document.createElement('button');
    delBtn.className = 'btn-sm btn-sm-danger';
    delBtn.textContent = 'DELETE';
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

  var callsignSpan = document.createElement('span');
  callsignSpan.style.cssText = 'font-family:Orbitron,monospace;font-weight:900;font-size:16px;letter-spacing:3px';
  callsignSpan.textContent = pilot.callsign || pilot.name || sub;

  var nameSpan = document.createElement('span');
  nameSpan.style.cssText = 'font-size:10px;color:var(--text-3)';
  nameSpan.textContent = pilot.name || '';

  var scoreSpan = document.createElement('span');
  scoreSpan.style.cssText = 'font-family:Orbitron,monospace;font-weight:700;font-size:20px;color:var(--green);margin-left:auto';
  scoreSpan.textContent = score + '%';

  var delPilotBtn = document.createElement('button');
  delPilotBtn.className   = 'btn-sm btn-sm-danger';
  delPilotBtn.textContent = 'DELETE PILOT';
  delPilotBtn.title       = 'Permanently remove this pilot and all their grades';
  (function (s, callsign) {
    delPilotBtn.addEventListener('click', function () { deletePilot(s, callsign); });
  })(sub, pilot.callsign || pilot.name || sub);

  hdr.appendChild(callsignSpan);
  hdr.appendChild(nameSpan);
  hdr.appendChild(scoreSpan);
  hdr.appendChild(delPilotBtn);
  el.appendChild(hdr);

  (_tree.categories || []).forEach(function (cat) {
    var catSection  = document.createElement('div');
    catSection.className = 'skill-list-category';
    var mods        = cat.modules || [];
    var completed   = mods.filter(function (m) { return moduleState(m, grades) === 'completed'; }).length;
    var score       = Math.round(completed / (mods.length || 1) * 100);
    var collapsed   = !!_detailCollapsed[cat.id];

    /* Collapsible header */
    var catHdr = document.createElement('div');
    catHdr.className = 'skill-list-cat-header';
    catHdr.style.cursor = 'pointer';
    catHdr.innerHTML =
      '<span class="slc-toggle">' + (collapsed ? '▶' : '▼') + '</span>' +
      '<span class="slc-name">' + esc(cat.name) + '</span>' +
      '<span class="slc-count">' + completed + ' / ' + mods.length + ' PASSED</span>' +
      '<div class="slc-bar"><div class="slc-bar-fill" style="width:' + score + '%"></div></div>' +
      '<span class="slc-pct">' + score + '%</span>';

    (function (catId) {
      catHdr.addEventListener('click', function () {
        _detailCollapsed[catId] = !_detailCollapsed[catId];
        selectPilot(sub);
      });
    })(cat.id);
    catSection.appendChild(catHdr);

    if (!collapsed) {
      var grid = document.createElement('div');
      grid.className = 'skill-modules';
      grid.style.cssText = 'padding:10px;gap:10px';
      mods.forEach(function (mod) {
        grid.appendChild(buildAdminModuleEl(mod, grades, sub));
      });
      catSection.appendChild(grid);
    }

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

  /* Grade controls — two rows to avoid overflow */
  var ctrlWrap = document.createElement('div');
  ctrlWrap.style.cssText = 'padding:6px 0 2px;display:flex;flex-direction:column;gap:5px;border-top:1px solid var(--border);margin-top:6px';

  /* Row 1: grade select + action buttons */
  var row1 = document.createElement('div');
  row1.style.cssText = 'display:flex;gap:5px;align-items:center;flex-wrap:wrap';

  var sel = document.createElement('select');
  sel.className = 'grade-select';
  var opts = '<option value="">— GRADE —</option>';
  ['U', 'F', 'G', 'E'].forEach(function (g) {
    var selected = (gradeRec && gradeRec.grade === g) ? ' selected' : '';
    opts += '<option value="' + g + '"' + selected + '>' + g + ' · ' + GRADE_NAMES[g] + '</option>';
  });
  sel.innerHTML = opts;

  var saveBtn = document.createElement('button');
  saveBtn.className   = 'btn-save-grade';
  saveBtn.textContent = 'SAVE';
  (function (s, mid, selEl) {
    saveBtn.addEventListener('click', function () {
      if (!selEl.value) { showToast('Select a grade first', true); return; }
      var notesEl = selEl.parentElement.parentElement.querySelector('.grade-notes-input');
      saveGrade(s, mid, selEl.value, notesEl ? notesEl.value : '');
    });
  })(sub, mod.id, sel);

  var clearBtn = document.createElement('button');
  clearBtn.className   = 'btn-clear-grade';
  clearBtn.textContent = 'CLEAR';
  clearBtn.style.display = gradeRec ? '' : 'none';
  (function (s, mid) {
    clearBtn.addEventListener('click', function () { clearGrade(s, mid); });
  })(sub, mod.id);

  row1.appendChild(sel);
  row1.appendChild(saveBtn);
  row1.appendChild(clearBtn);

  /* Row 2: notes input (full width) */
  var row2 = document.createElement('div');
  var notesInput = document.createElement('input');
  notesInput.className   = 'grade-notes-input';
  notesInput.type        = 'text';
  notesInput.placeholder = 'Comment / grade justification (optional)';
  notesInput.value       = gradeRec ? (gradeRec.notes || '') : '';
  notesInput.style.width = '100%';
  notesInput.style.boxSizing = 'border-box';
  row2.appendChild(notesInput);

  ctrlWrap.appendChild(row1);
  ctrlWrap.appendChild(row2);
  card.appendChild(ctrlWrap);
  return card;
}

/* ── Pilot delete ───────────────────────────────────────── */
function deletePilot(sub, callsign) {
  var confirm1 = confirm(
    'DELETE PILOT: ' + callsign + '\n\n' +
    'This will permanently remove the pilot and ALL their skill grades and grading requests.\n\n' +
    'This cannot be undone. Are you sure?'
  );
  if (!confirm1) return;

  var typed = prompt('Type the callsign "' + callsign + '" to confirm deletion:');
  if (typed === null) return;
  if (typed.trim() !== callsign) { showToast('Callsign did not match — pilot not deleted', true); return; }

  var tok = getToken();
  fetch('/api/skill-pilots/' + encodeURIComponent(sub), {
    method:  'DELETE',
    headers: { 'Authorization': 'Bearer ' + tok },
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function () {
    delete _pilots[sub];
    delete _allGrades[sub];
    _requests = _requests.filter(function (r) { return r.pilot_id !== sub; });
    _activeSub = null;
    document.getElementById('pilotDetail').innerHTML = '';
    renderPilotList();
    renderGradingQueue();
    showToast('Pilot deleted');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
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
    /* Remove any grading requests for this pilot+module (server already deleted them) */
    _requests = _requests.filter(function (r) {
      return !(r.pilot_id === sub && (r.module_id === moduleId || !r.module_id));
    });
    renderPilotList();
    renderGradingQueue();
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

function unclaimRequest(id) {
  var tok = getToken();
  fetch('/api/grading-requests/' + id + '/unclaim', {
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
    showToast('Request unclaimed');
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
  var allMods     = flatModules();

  /* Weight indicator */
  var weightBar = document.createElement('div');
  weightBar.className = 'tree-weight-bar';
  var wLabel = document.createElement('span');
  wLabel.className   = 'tree-field-label';
  wLabel.textContent = 'TOTAL WEIGHT';
  var wTotal = document.createElement('span');
  wTotal.className   = 'tree-weight-total ok';
  wTotal.textContent = totalWeight;
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
  var el    = document.querySelector('.tree-weight-total');
  if (el) { el.textContent = total; el.className = 'tree-weight-total ok'; }
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

  var collapseBtn = document.createElement('button');
  collapseBtn.className   = 'btn-sm';
  collapseBtn.title       = 'Collapse / expand';
  collapseBtn.textContent = _editorCollapsed[cat.id] ? '▶' : '▼';
  (function (catId) {
    collapseBtn.addEventListener('click', function () {
      _editorCollapsed[catId] = !_editorCollapsed[catId];
      renderTreeEditor();
    });
  })(cat.id);

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

  ctrlDiv.appendChild(collapseBtn); ctrlDiv.appendChild(upBtn); ctrlDiv.appendChild(dnBtn); ctrlDiv.appendChild(delBtn);
  hdr.appendChild(nameInput); hdr.appendChild(wLabel); hdr.appendChild(weightInput);
  hdr.appendChild(pct); hdr.appendChild(ctrlDiv);
  card.appendChild(hdr);

  /* ── Category ID row ── */
  card.appendChild(buildIdRow(cat, 'category-id'));

  /* ── Squadron visibility row ── */
  card.appendChild(buildSquadronRow(cat));

  /* ── Module list + add button (hidden when collapsed) ── */
  if (!_editorCollapsed[cat.id]) {
    var modList = document.createElement('div');
    modList.className = 'tree-mod-list';
    (cat.modules || []).forEach(function (mod, mi) {
      modList.appendChild(buildModCard(mod, mi, (cat.modules || []).length, ci, allMods));
    });
    card.appendChild(modList);

    var addModBtn = document.createElement('button');
    addModBtn.className   = 'btn-sm';
    addModBtn.textContent = '+ ADD MODULE';
    addModBtn.style.cssText = 'margin: 4px 10px 10px';
    (function (i) { addModBtn.addEventListener('click', function () { addModule(i); }); })(ci);
    card.appendChild(addModBtn);
  } else {
    var collapsedNote = document.createElement('div');
    collapsedNote.style.cssText = 'padding:6px 10px 8px;font-size:8px;color:var(--text-3)';
    collapsedNote.textContent   = (cat.modules || []).length + ' module(s) — click ▶ to expand';
    card.appendChild(collapsedNote);
  }

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

/* Squadron visibility selector for a category card */
function buildSquadronRow(cat) {
  if (!cat.squadrons) cat.squadrons = [];

  var row = document.createElement('div');
  row.className = 'tree-id-row';
  row.style.cssText = 'flex-wrap:wrap;gap:6px;align-items:flex-start';

  var lbl = document.createElement('span');
  lbl.className   = 'tree-field-label';
  lbl.textContent = 'VISIBLE TO';

  var note = document.createElement('span');
  note.style.cssText = 'font-size:9px;color:var(--text-3);flex-shrink:0';
  note.textContent   = _squadrons.length ? '(none checked = ALL squadrons)' : '(no squadrons configured)';

  row.appendChild(lbl);
  row.appendChild(note);

  if (_squadrons.length) {
    var checksWrap = document.createElement('div');
    checksWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;width:100%';

    _squadrons.forEach(function (sq) {
      var label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:9px;cursor:pointer;user-select:none';

      var cb  = document.createElement('input');
      cb.type = 'checkbox';
      cb.value   = sq.id;
      cb.checked = cat.squadrons.indexOf(sq.id) !== -1;

      (function (sqId, checkbox) {
        checkbox.addEventListener('change', function () {
          if (checkbox.checked) {
            if (cat.squadrons.indexOf(sqId) === -1) cat.squadrons.push(sqId);
          } else {
            cat.squadrons = cat.squadrons.filter(function (id) { return id !== sqId; });
          }
        });
      })(sq.id, cb);

      label.appendChild(cb);
      label.appendChild(document.createTextNode(sq.designator + ' ' + sq.name));
      checksWrap.appendChild(label);
    });

    row.appendChild(checksWrap);
  }

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
