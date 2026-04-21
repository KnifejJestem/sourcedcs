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
function jwtSub(token) {
  try {
    var parts = token.split('.');
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub || null;
  } catch (e) { return null; }
}

/* ── State ──────────────────────────────────────────────── */
var _tree     = null;
var _grades   = {};   /* { [moduleId]: { grade, notes, graded_at, graded_by } } */
var _requests = [];
var _mySub    = null;

/* ── Bootstrap ──────────────────────────────────────────── */
(function () {
  var tok  = getToken();
  var user = getUser();
  var btn  = document.getElementById('loginBtn');

  if (tok && user) {
    /* Logged in */
    if (btn) {
      btn.textContent = (user.name || 'USER').toUpperCase() + ' \u23FB';
      btn.title   = 'Click to log out';
      btn.classList.add('login-btn--logout');
      btn.onclick = logout;
    }
    _mySub = jwtSub(tok);
    loadAll(tok);
  } else {
    /* Not logged in */
    document.getElementById('loginPrompt').style.display = '';
    if (btn) { btn.textContent = 'LOGIN'; btn.onclick = loginWithCasdoor; }
  }
})();

/* ── Data loading ───────────────────────────────────────── */
function loadAll(tok) {
  var headers = { 'Authorization': 'Bearer ' + tok };

  Promise.all([
    fetch('/api/skill-tree').then(function (r) { return r.json(); }),
    fetch('/api/skill-grades', { headers: headers }).then(function (r) { return r.json(); }),
    fetch('/api/grading-requests', { headers: headers }).then(function (r) { return r.json(); }),
  ]).then(function (results) {
    _tree = results[0];

    var gradesMap = results[1];
    _grades = (_mySub && gradesMap[_mySub]) ? gradesMap[_mySub] : {};

    _requests = Array.isArray(results[2]) ? results[2] : [];

    render();
  }).catch(function (err) {
    console.error('[skills] load failed:', err);
    showToast('Failed to load skill data', true);
  });
}

/* ── Module state ───────────────────────────────────────── */
function gradeValue(g) { return (g != null && GRADE_VALUES[g] != null) ? GRADE_VALUES[g] : -1; }

function moduleState(mod) {
  var prereqs = mod.prerequisites || [];
  for (var i = 0; i < prereqs.length; i++) {
    var p  = prereqs[i];
    var gr = _grades[p.module_id] ? _grades[p.module_id].grade : null;
    if (gradeValue(gr) < gradeValue(p.min_grade)) return 'locked';
  }
  var myGrade = _grades[mod.id] ? _grades[mod.id].grade : null;
  if (myGrade == null) return 'not-started';
  if (gradeValue(myGrade) >= gradeValue(mod.min_pass_grade)) return 'completed';
  return 'in-progress';
}

/* ── Score computation ──────────────────────────────────── */
function categoryScore(cat) {
  if (!cat.modules || !cat.modules.length) return 0;
  var total = cat.modules.reduce(function (s, mod) {
    var g = _grades[mod.id] ? _grades[mod.id].grade : null;
    return s + (g != null ? (GRADE_VALUES[g] || 0) : 0);
  }, 0);
  return total / (cat.modules.length * 3);
}

function overallScore() {
  if (!_tree || !_tree.categories || !_tree.categories.length) return 0;
  return _tree.categories.reduce(function (s, cat) {
    return s + (cat.weight || 0) * categoryScore(cat);
  }, 0) / 100;
}

/* ── Render ─────────────────────────────────────────────── */
function render() {
  if (!_tree) return;

  renderScoreBar();

  var treeEl = document.getElementById('skillsTree');
  treeEl.innerHTML = '';
  (_tree.categories || []).forEach(function (cat) {
    treeEl.appendChild(buildCategoryEl(cat));
  });

  renderRequests();

  document.getElementById('scoreBar').style.display    = '';
  document.getElementById('skillsBody').style.display  = '';
  document.getElementById('loginPrompt').style.display = 'none';
}

function renderScoreBar() {
  var pct = Math.round(overallScore() * 100);
  document.getElementById('overallScore').textContent = pct + '%';

  var catsEl = document.getElementById('scoreCats');
  catsEl.innerHTML = '';
  (_tree.categories || []).forEach(function (cat) {
    var score = Math.round(categoryScore(cat) * 100);
    var div = document.createElement('div');
    div.className = 'score-cat';
    div.innerHTML =
      '<div class="score-cat-name">' + esc(cat.name) +
        ' <span style="color:var(--text-3)">' + cat.weight + '%</span></div>' +
      '<div class="score-cat-bar"><div class="score-cat-fill" style="width:' + score + '%"></div></div>' +
      '<div class="score-cat-pct">' + score + '%</div>';
    catsEl.appendChild(div);
  });
}

function buildCategoryEl(cat) {
  var section = document.createElement('div');
  section.className = 'skill-category';

  var header = document.createElement('div');
  header.className = 'skill-cat-header';
  header.innerHTML =
    '<span class="skill-cat-name">' + esc(cat.name) + '</span>' +
    '<span class="skill-cat-weight">Weight: ' + cat.weight + '%</span>';
  section.appendChild(header);

  var grid = document.createElement('div');
  grid.className = 'skill-modules';
  (cat.modules || []).forEach(function (mod) {
    grid.appendChild(buildModuleEl(mod));
  });
  section.appendChild(grid);
  return section;
}

function buildModuleEl(mod) {
  var state    = moduleState(mod);
  var gradeRec = _grades[mod.id] || null;
  var myOpenReq = _requests.find(function (r) {
    return r.pilot_id === _mySub && (r.status === 'open' || r.status === 'claimed');
  }) || null;

  var card = document.createElement('div');
  card.className = 'skill-module state-' + state;

  var BADGE_CLASS = {
    'locked':      'badge-locked',
    'not-started': 'badge-not-started',
    'in-progress': 'badge-in-progress',
    'completed':   'badge-completed',
  };
  var badgeClass = BADGE_CLASS[state] || 'badge-not-started';
  var badgeText  = state.replace('-', ' ').toUpperCase();

  /* Prerequisites */
  var prereqHtml = '';
  if (mod.prerequisites && mod.prerequisites.length) {
    var parts = (mod.prerequisites || []).map(function (p) {
      return p.module_id + ' (' + (p.min_grade || '?') + '+)';
    });
    prereqHtml = '<div class="skill-mod-prereqs">Requires: ' + esc(parts.join(', ')) + '</div>';
  }

  /* Grade block */
  var gradeHtml = '';
  if (gradeRec) {
    var gradeClass = 'grade-' + gradeRec.grade;
    var gradedAt   = gradeRec.graded_at ? new Date(gradeRec.graded_at).toLocaleDateString() : '';
    gradeHtml =
      '<div class="skill-mod-grade">' +
        '<div>' +
          '<span class="skill-mod-grade-val ' + gradeClass + '">' + esc(gradeRec.grade) + '</span>' +
          ' <span style="font-size:9px;color:var(--text-2)">' + esc(GRADE_NAMES[gradeRec.grade] || '') + '</span>' +
        '</div>' +
        '<div class="skill-mod-grade-meta">' +
          (gradeRec.graded_by ? esc(gradeRec.graded_by) + '<br>' : '') + esc(gradedAt) +
        '</div>' +
      '</div>';
    if (gradeRec.notes) {
      gradeHtml += '<div class="skill-mod-grade-notes">' + esc(gradeRec.notes) + '</div>';
    }
  }

  card.innerHTML =
    '<div class="skill-mod-top">' +
      '<div class="skill-mod-title">' + esc(mod.title) + '</div>' +
      '<div class="skill-mod-badge ' + badgeClass + '">' + badgeText + '</div>' +
    '</div>' +
    '<div class="skill-mod-desc">' + esc(mod.description || '') + '</div>' +
    prereqHtml +
    gradeHtml;

  /* Action area */
  if (state !== 'locked') {
    var actDiv = document.createElement('div');
    actDiv.className = 'skill-mod-actions';

    if (myOpenReq) {
      var pendingSpan = document.createElement('span');
      pendingSpan.className = 'grading-pending-notice';
      pendingSpan.textContent = 'GRADING REQUEST PENDING';
      actDiv.appendChild(pendingSpan);

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-cancel-request';
      cancelBtn.textContent = 'CANCEL';
      (function (reqId) {
        cancelBtn.addEventListener('click', function () { cancelRequest(reqId); });
      })(myOpenReq.id);
      actDiv.appendChild(cancelBtn);
    } else {
      var reqBtn = document.createElement('button');
      reqBtn.className = 'btn-request-grading';
      reqBtn.textContent = 'REQUEST GRADING';
      reqBtn.addEventListener('click', requestGrading);
      actDiv.appendChild(reqBtn);
    }
    card.appendChild(actDiv);
  }

  return card;
}

/* ── Grading requests ───────────────────────────────────── */
function renderRequests() {
  var myReqs  = _requests.filter(function (r) { return r.pilot_id === _mySub; });
  var section = document.getElementById('requestsSection');
  var list    = document.getElementById('requestsList');

  if (!myReqs.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = '';

  myReqs.slice().reverse().forEach(function (req) {
    var row = document.createElement('div');
    row.className = 'request-row';
    var STATUS_CLASS = { open: 'req-open', claimed: 'req-claimed', closed: 'req-closed' };
    var statusClass = STATUS_CLASS[req.status] || 'req-closed';
    var date        = req.requested_at ? new Date(req.requested_at).toLocaleDateString() : '';
    var claimInfo   = (req.status === 'claimed' && req.claimed_by_name)
      ? 'Claimed by ' + esc(req.claimed_by_name) : '';

    row.innerHTML =
      '<span class="request-status ' + statusClass + '">' + esc(req.status.toUpperCase()) + '</span>' +
      '<span class="request-date">' + esc(date) + '</span>' +
      (claimInfo ? '<span class="request-claim-info">' + claimInfo + '</span>' : '');

    if (req.status === 'open') {
      var btn = document.createElement('button');
      btn.className = 'btn-cancel-request';
      btn.textContent = 'CANCEL';
      (function (id) { btn.addEventListener('click', function () { cancelRequest(id); }); })(req.id);
      row.appendChild(btn);
    }
    list.appendChild(row);
  });
}

/* ── User actions ───────────────────────────────────────── */
function requestGrading() {
  var tok = getToken();
  if (!tok) { showToast('Please log in first', true); return; }

  fetch('/api/grading-requests', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body:    JSON.stringify({}),
  }).then(function (r) {
    if (r.status === 409) { showToast('You already have an open grading request', true); return null; }
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function (req) {
    if (!req) return;
    _requests.push(req);
    render();
    showToast('Grading request submitted');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

function cancelRequest(id) {
  var tok = getToken();
  if (!tok) return;

  fetch('/api/grading-requests/' + id, {
    method:  'DELETE',
    headers: { 'Authorization': 'Bearer ' + tok },
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function () {
    _requests = _requests.filter(function (r) { return r.id !== id; });
    render();
    showToast('Request cancelled');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
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
