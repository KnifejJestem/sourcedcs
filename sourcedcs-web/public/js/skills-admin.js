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
var _tree      = null;
var _allGrades = {};   /* { [sub]: { [moduleId]: gradeRec } } */
var _pilots    = {};   /* { [sub]: { sub, name, callsign, registered_at } } */
var _requests  = [];
var _activeSub = null;

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
    resetTreeEditor();
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
function resetTreeEditor() {
  var ta  = document.getElementById('treeEditorTA');
  var msg = document.getElementById('treeEditorMsg');
  if (ta)  ta.value = _tree ? JSON.stringify(_tree, null, 2) : '{}';
  if (msg) { msg.textContent = ''; msg.className = 'tree-editor-msg'; }
}

function saveSkillTree() {
  var ta  = document.getElementById('treeEditorTA');
  var msg = document.getElementById('treeEditorMsg');
  var parsed;
  try {
    parsed = JSON.parse(ta.value);
  } catch (e) {
    msg.textContent = 'Invalid JSON: ' + e.message;
    msg.className   = 'tree-editor-msg err';
    return;
  }

  var tok = getToken();
  fetch('/api/skill-tree', {
    method:  'PUT',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body:    JSON.stringify(parsed),
  }).then(function (r) {
    return r.json().then(function (body) { return { ok: r.ok, body: body }; });
  }).then(function (result) {
    if (!result.ok) {
      msg.textContent = 'Error: ' + (result.body.error || 'unknown');
      msg.className   = 'tree-editor-msg err';
      return;
    }
    _tree = result.body;
    msg.textContent = 'Saved.';
    msg.className   = 'tree-editor-msg ok';
    if (_activeSub) selectPilot(_activeSub);
    renderPilotList();
    showToast('Skill tree saved');
  }).catch(function (err) {
    msg.textContent = 'Error: ' + err.message;
    msg.className   = 'tree-editor-msg err';
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
