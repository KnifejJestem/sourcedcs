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
var _tree        = null;
var _grades      = {};
var _requests    = [];
var _mySub       = null;
var _mySquadron  = null;  /* squadron ID from roster, or null */
var _openMods    = {};  /* { [moduleId]: bool } — expanded detail rows */
var _openCats    = {};  /* { [catId]: bool } — collapsed categories (true = collapsed) */

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
    _mySub = jwtSub(tok);
    if (isSkillAdminRole(tok)) {
      var nav = document.getElementById('mainNav');
      if (nav && !nav.querySelector('.nav-link-admin')) {
        var adminLink = document.createElement('a');
        adminLink.className = 'nav-link nav-link-admin';
        adminLink.href      = 'skills-admin.html';
        adminLink.textContent = 'ADMIN';
        nav.appendChild(adminLink);
      }
    }
    loadAll(tok);
  } else {
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
    fetch('/api/my-squadron', { headers: headers }).then(function (r) { return r.json(); }).catch(function () { return { squadron: null }; }),
  ]).then(function (results) {
    _tree = results[0];
    var gradesMap = results[1];
    _grades      = (_mySub && gradesMap[_mySub]) ? gradesMap[_mySub] : {};
    _requests    = Array.isArray(results[2]) ? results[2] : [];
    _mySquadron  = (results[3] && results[3].squadron) ? results[3].squadron : null;
    render();
  }).catch(function (err) {
    console.error('[skills] load failed:', err);
    showToast('Failed to load skill data', true);
  });
}

/* ── Squadron filtering ─────────────────────────────────── */
/* Returns only the categories visible to the current pilot.
   A category with an empty/missing squadrons array is shown to everyone.
   A pilot with no squadron sees only those "all" categories. */
function visibleCategories() {
  if (!_tree || !_tree.categories) return [];
  return _tree.categories.filter(function (cat) {
    var sqs = cat.squadrons;
    if (!sqs || !sqs.length) return true;          /* visible to all */
    if (!_mySquadron) return false;                /* no squadron → only "all" cats */
    return sqs.indexOf(_mySquadron) !== -1;
  });
}

/* ── Module state (matches test/skill-logic.js) ─────────── */
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

/* ── Score (completion-based, matches test/skill-logic.js) ─ */
function categoryScore(cat) {
  var mods = cat.modules || [];
  if (!mods.length) return 0;
  var completed = mods.filter(function (m) { return moduleState(m) === 'completed'; }).length;
  return completed / mods.length;
}

function overallScore() {
  var cats = visibleCategories();
  if (!cats.length) return 0;
  /* Normalise by the sum of visible category weights (not always 100 when filtered) */
  var totalWeight = cats.reduce(function (s, c) { return s + (c.weight || 0); }, 0);
  if (!totalWeight) return 0;
  return cats.reduce(function (s, cat) {
    return s + (cat.weight || 0) * categoryScore(cat);
  }, 0) / totalWeight;
}

/* ── Render ─────────────────────────────────────────────── */
function render() {
  if (!_tree) return;
  renderScoreBar();
  renderTree();
  renderRequests();
  document.getElementById('scoreBar').style.display   = '';
  document.getElementById('skillsBody').style.display = '';
  document.getElementById('loginPrompt').style.display = 'none';
}

function renderScoreBar() {
  var pct = Math.round(overallScore() * 100);
  document.getElementById('overallScore').textContent = pct + '%';

  var catsEl = document.getElementById('scoreCats');
  catsEl.innerHTML = '';
  visibleCategories().forEach(function (cat) {
    var score = Math.round(categoryScore(cat) * 100);
    var mods  = cat.modules || [];
    var done  = mods.filter(function (m) { return moduleState(m) === 'completed'; }).length;

    var div = document.createElement('div');
    div.className = 'score-cat';
    div.innerHTML =
      '<div class="score-cat-name">' + esc(cat.name) +
        ' <span style="color:var(--text-3)">' + cat.weight + '%</span></div>' +
      '<div class="score-cat-bar"><div class="score-cat-fill" style="width:' + score + '%"></div></div>' +
      '<div class="score-cat-pct">' + done + '/' + mods.length + ' &nbsp; ' + score + '%</div>';
    catsEl.appendChild(div);
  });
}

/* ── List view ──────────────────────────────────────────── */
function renderTree() {
  var el = document.getElementById('skillsTree');
  el.innerHTML = '';

  var myOpenReq = _requests.find(function (r) {
    return r.pilot_id === _mySub && (r.status === 'open' || r.status === 'claimed');
  }) || null;

  visibleCategories().forEach(function (cat) {
    el.appendChild(buildCatSection(cat, myOpenReq));
  });
}

function buildCatSection(cat, myOpenReq) {
  var mods      = cat.modules || [];
  var done      = mods.filter(function (m) { return moduleState(m) === 'completed'; }).length;
  var score     = Math.round(categoryScore(cat) * 100);
  var collapsed = !!_openCats[cat.id];

  /* Flat id → title map for prereq display */
  var modTitleMap = {};
  (_tree.categories || []).forEach(function (c) {
    (c.modules || []).forEach(function (m) { modTitleMap[m.id] = m.title; });
  });

  var section = document.createElement('div');
  section.className = 'skill-list-category';

  /* Header row (click to collapse) */
  var hdr = document.createElement('div');
  hdr.className = 'skill-list-cat-header';
  hdr.setAttribute('role', 'button');
  hdr.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

  var toggle = document.createElement('span');
  toggle.className   = 'slc-toggle';
  toggle.textContent = collapsed ? '▶' : '▼';

  var name = document.createElement('span');
  name.className   = 'slc-name';
  name.textContent = cat.name;

  var count = document.createElement('span');
  count.className   = 'slc-count';
  count.textContent = done + ' / ' + mods.length + ' PASSED';

  var barWrap = document.createElement('div');
  barWrap.className = 'slc-bar';
  var barFill = document.createElement('div');
  barFill.className = 'slc-bar-fill';
  barFill.style.width = score + '%';
  barWrap.appendChild(barFill);

  var pct = document.createElement('span');
  pct.className   = 'slc-pct';
  pct.textContent = score + '%';

  hdr.appendChild(toggle);
  hdr.appendChild(name);
  hdr.appendChild(count);
  hdr.appendChild(barWrap);
  hdr.appendChild(pct);

  (function (catId) {
    hdr.addEventListener('click', function () {
      _openCats[catId] = !_openCats[catId];
      render();
    });
  })(cat.id);

  section.appendChild(hdr);

  /* Modules list */
  if (!collapsed) {
    var modList = document.createElement('div');
    modList.className = 'skill-list-modules';

    mods.forEach(function (mod) {
      var state    = moduleState(mod);
      var gradeRec = _grades[mod.id] || null;
      var isOpen   = !!_openMods[mod.id];

      /* ── Main row ── */
      var row = document.createElement('div');
      row.className = 'skill-list-mod-row state-' + state;

      /* Icon */
      var icon = document.createElement('span');
      icon.className = 'slm-icon';
      var ICONS = { locked: '—', 'not-started': '○', 'in-progress': '◑', completed: '✓' };
      icon.textContent = ICONS[state] || '○';

      /* Title */
      var title = document.createElement('span');
      title.className   = 'slm-title';
      title.textContent = mod.title;

      row.appendChild(icon);
      row.appendChild(title);

      /* Grade badge if graded */
      if (gradeRec) {
        var gBadge = document.createElement('span');
        gBadge.className   = 'slm-grade-badge grade-' + gradeRec.grade;
        gBadge.textContent = gradeRec.grade;
        var gName = document.createElement('span');
        gName.className   = 'slm-grade-name';
        gName.textContent = GRADE_NAMES[gradeRec.grade] || '';
        row.appendChild(gBadge);
        row.appendChild(gName);
      } else if (state !== 'locked') {
        var noGrade = document.createElement('span');
        noGrade.className   = 'slm-grade-name';
        noGrade.textContent = state === 'not-started' ? 'Not started' : 'In progress';
        row.appendChild(noGrade);
      }

      /* Expand toggle (not for locked modules) */
      if (state !== 'locked') {
        var chevron = document.createElement('span');
        chevron.className   = 'slm-chevron';
        chevron.textContent = isOpen ? '▲' : '▼';
        row.appendChild(chevron);

        (function (mid) {
          row.addEventListener('click', function () {
            _openMods[mid] = !_openMods[mid];
            render();
          });
        })(mod.id);
      }

      modList.appendChild(row);

      /* ── Detail panel ── */
      if (isOpen && state !== 'locked') {
        var detail = document.createElement('div');
        detail.className = 'skill-list-mod-detail';

        /* Description */
        if (mod.description) {
          var desc = document.createElement('p');
          desc.className   = 'slm-desc';
          desc.textContent = mod.description;
          detail.appendChild(desc);
        }

        /* Pass requirement */
        var req = document.createElement('div');
        req.className   = 'slm-prereqs';
        req.textContent = 'Pass requirement: ' + (mod.min_pass_grade || 'G') + ' — ' + (GRADE_NAMES[mod.min_pass_grade] || '');
        detail.appendChild(req);

        /* Prerequisites */
        if (mod.prerequisites && mod.prerequisites.length) {
          var preDiv = document.createElement('div');
          preDiv.className = 'slm-prereqs';
          var preParts = (mod.prerequisites || []).map(function (p) {
            return (modTitleMap[p.module_id] || p.module_id) + ' (' + (p.min_grade || 'G') + '+)';
          });
          preDiv.textContent = 'Requires: ' + preParts.join(', ');
          detail.appendChild(preDiv);
        }

        /* Grade record */
        if (gradeRec) {
          if (gradeRec.notes) {
            var notes = document.createElement('div');
            notes.className   = 'slm-notes';
            notes.textContent = 'Grader\'s comment: "' + gradeRec.notes + '"';
            detail.appendChild(notes);
          }
          var gradedBy = document.createElement('div');
          gradedBy.className = 'slm-graded-by';
          var dStr = gradeRec.graded_at ? ' on ' + new Date(gradeRec.graded_at).toLocaleDateString() : '';
          gradedBy.textContent = 'Graded by ' + (gradeRec.graded_by || '—') + dStr;
          detail.appendChild(gradedBy);
        }

        /* Action */
        var actDiv = document.createElement('div');
        actDiv.style.marginTop = '10px';

        /* Show the pending notice only on the module the request was filed for.
           If the request has no module_id (legacy), show it everywhere. */
        var isThisModuleReq = myOpenReq && (!myOpenReq.module_id || myOpenReq.module_id === mod.id);
        if (isThisModuleReq) {
          var pendingSpan = document.createElement('span');
          pendingSpan.className   = 'grading-pending-notice';
          pendingSpan.textContent = 'GRADING REQUEST ' + myOpenReq.status.toUpperCase();
          var cancelBtn = document.createElement('button');
          cancelBtn.className   = 'btn-cancel-request';
          cancelBtn.textContent = 'CANCEL REQUEST';
          cancelBtn.style.marginLeft = '10px';
          (function (id) { cancelBtn.addEventListener('click', function () { cancelRequest(id); }); })(myOpenReq.id);
          actDiv.appendChild(pendingSpan);
          actDiv.appendChild(cancelBtn);
        } else if (!gradeRec || gradeRec.grade !== 'E') {
          var reqBtn = document.createElement('button');
          reqBtn.className   = 'btn-request-grading';
          reqBtn.textContent = 'REQUEST GRADING';
          (function (mid, mtitle) {
            reqBtn.addEventListener('click', function () { requestGrading(mid, mtitle); });
          })(mod.id, mod.title);
          actDiv.appendChild(reqBtn);
        }

        detail.appendChild(actDiv);
        modList.appendChild(detail);
      }
    });

    section.appendChild(modList);
  }

  return section;
}

/* ── Requests section ───────────────────────────────────── */
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
    var date = req.requested_at ? new Date(req.requested_at).toLocaleDateString() : '';

    row.innerHTML =
      '<span class="request-status ' + (STATUS_CLASS[req.status] || 'req-closed') + '">' +
        esc(req.status.toUpperCase()) + '</span>' +
      '<span class="request-date">' + esc(date) + '</span>' +
      (req.status === 'claimed' && req.claimed_by_name
        ? '<span class="request-claim-info">Claimed by ' + esc(req.claimed_by_name) + '</span>'
        : '') +
      (!req.discord_message_id && (req.status === 'open' || req.status === 'claimed')
        ? '<span style="font-size:8px;color:var(--text-3)">(Discord not notified)</span>'
        : '');

    if (req.status === 'open') {
      var btn = document.createElement('button');
      btn.className   = 'btn-cancel-request';
      btn.textContent = 'CANCEL';
      (function (id) { btn.addEventListener('click', function () { cancelRequest(id); }); })(req.id);
      row.appendChild(btn);
    }
    list.appendChild(row);
  });
}

/* ── User actions ───────────────────────────────────────── */
function requestGrading(moduleId, moduleTitle) {
  var tok = getToken();
  if (!tok) { showToast('Please log in first', true); return; }

  fetch('/api/grading-requests', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ module_id: moduleId || null, module_title: moduleTitle || null }),
  }).then(function (r) {
    if (r.status === 409) { showToast('You already have an open grading request', true); return null; }
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function (req) {
    if (!req) return;
    _requests.push(req);
    showToast(req.discord_message_id
      ? 'Grading request submitted — instructors notified'
      : 'Grading request submitted (Discord notification skipped — check server config)');
    render();
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
  _toastTimer = setTimeout(function () { el.className = 'skills-toast'; }, 4000);
}
