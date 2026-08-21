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
var _treeIndex   = null;   /* skillsCore.buildIndex(_tree) */
var _grades      = {};     /* { [gradingItemId]: gradeRec } for the logged-in pilot */
var _requests    = [];
var _mySub       = null;
var _mySquadron  = null;  /* squadron ID from roster, or null */
var _openMods    = {};  /* { [moduleId]: bool } — expanded detail rows */
var _openCats    = {};  /* { [moduleId]: bool } — collapsed group sections (true = collapsed) */

/* ── Bootstrap ──────────────────────────────────────────── */
(function () {
  var tok  = getToken();
  var user = getUser();
  var btn  = document.getElementById('loginBtn');

  if (tok && user) {
    if (btn) {
      btn.textContent = (user.name || 'USER').toUpperCase() + ' ⏻';
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
    _treeIndex = skillsCore.buildIndex(_tree);
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
  var pct = Math.round(skillsCore.overallScore(_treeIndex, _mySquadron, _grades) * 100);
  document.getElementById('overallScore').textContent = pct + '%';

  var catsEl = document.getElementById('scoreCats');
  catsEl.innerHTML = '';
  skillsCore.visibleRootModules(_treeIndex, _mySquadron).forEach(function (root) {
    var total = skillsCore.countVisibleModules(_treeIndex, root, _mySquadron);
    var done  = skillsCore.countVisibleCompletedModules(_treeIndex, root, _mySquadron, _grades);
    var score = Math.round((total ? done / total : 0) * 100);

    var div = document.createElement('div');
    div.className = 'score-cat';
    div.innerHTML =
      '<div class="score-cat-name">' + esc(root.title) + '</div>' +
      '<div class="score-cat-bar"><div class="score-cat-fill" style="width:' + score + '%"></div></div>' +
      '<div class="score-cat-pct">' + done + '/' + total + ' &nbsp; ' + score + '%</div>';
    catsEl.appendChild(div);
  });
}

/* ── List view ──────────────────────────────────────────── */
function renderTree() {
  var el = document.getElementById('skillsTree');
  el.innerHTML = '';
  skillsCore.visibleRootModules(_treeIndex, _mySquadron).forEach(function (root) {
    el.appendChild(buildModuleSection(root));
  });
}

/* A module with sub-modules renders as a collapsible group section (with a
   recursive completed/total progress bar, free at every layer since there's
   no weighting); a module without sub-modules renders as a single gradable
   row. A module can carry both (mixed) — its own grading items render as a
   row first, then its sub-modules recurse. */
function buildModuleSection(node) {
  var hasSub = node.subModules && node.subModules.length;
  if (!hasSub) {
    var wrap = document.createElement('div');
    wrap.className = 'skill-list-modules';
    appendModRow(wrap, node);
    return wrap;
  }

  var collapsed = !!_openCats[node.id];
  var total     = skillsCore.countModules(node);
  var completed = skillsCore.countCompletedModules(_treeIndex, node, _grades);
  var score     = Math.round((total ? completed / total : 0) * 100);

  var section = document.createElement('div');
  section.className = 'skill-list-category';

  var hdr = document.createElement('div');
  hdr.className = 'skill-list-cat-header';
  hdr.setAttribute('role', 'button');
  hdr.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  hdr.innerHTML =
    '<span class="slc-toggle">' + (collapsed ? '▶' : '▼') + '</span>' +
    '<span class="slc-name">' + esc(node.title) + '</span>' +
    '<span class="slc-count">' + completed + ' / ' + total + ' PASSED</span>' +
    '<div class="slc-bar"><div class="slc-bar-fill" style="width:' + score + '%"></div></div>' +
    '<span class="slc-pct">' + score + '%</span>';
  (function (id) {
    hdr.addEventListener('click', function () {
      _openCats[id] = !_openCats[id];
      render();
    });
  })(node.id);
  section.appendChild(hdr);

  if (!collapsed) {
    var modList = document.createElement('div');
    modList.className = 'skill-list-modules';
    if (node.gradingItems && node.gradingItems.length) {
      appendModRow(modList, node);
    }
    section.appendChild(modList);
    node.subModules.forEach(function (child) {
      section.appendChild(buildModuleSection(child));
    });
  }

  return section;
}

function appendModRow(container, node) {
  var state = skillsCore.moduleState(_treeIndex, node.id, _grades);
  var items = node.gradingItems || [];
  var isOpen = !!_openMods[node.id];

  var row = document.createElement('div');
  row.className = 'skill-list-mod-row state-' + state;

  var icon = document.createElement('span');
  icon.className = 'slm-icon';
  var ICONS = { locked: '—', 'not-started': '○', 'in-progress': '◑', completed: '✓' };
  icon.textContent = ICONS[state] || '○';

  var title = document.createElement('span');
  title.className   = 'slm-title';
  title.textContent = node.title;

  row.appendChild(icon);
  row.appendChild(title);

  if (items.length === 1) {
    var gradeRec = _grades[items[0].id] || null;
    if (gradeRec) {
      var gBadge = document.createElement('span');
      gBadge.className   = 'slm-grade-badge grade-' + gradeRec.grade;
      gBadge.textContent = gradeRec.grade;
      var gName = document.createElement('span');
      gName.className   = 'slm-grade-name';
      gName.textContent = skillsCore.GRADE_NAMES[gradeRec.grade] || '';
      row.appendChild(gBadge);
      row.appendChild(gName);
    } else {
      var noGrade = document.createElement('span');
      noGrade.className = 'slm-grade-name';
      noGrade.textContent = (state === 'locked') ? 'Prerequisites not met' : (state === 'not-started' ? 'Not started' : 'In progress');
      row.appendChild(noGrade);
    }
  } else if (items.length > 1) {
    var doneCount = items.filter(function (it) {
      var rec = _grades[it.id];
      return rec && skillsCore.gradeValue(rec.grade) >= skillsCore.gradeValue(it.min_pass_grade);
    }).length;
    var summary = document.createElement('span');
    summary.className   = 'slm-grade-name';
    summary.textContent = doneCount + ' / ' + items.length + ' items passed';
    row.appendChild(summary);
  }

  var chevron = document.createElement('span');
  chevron.className   = 'slm-chevron';
  chevron.textContent = isOpen ? '▲' : '▼';
  row.appendChild(chevron);

  (function (mid) {
    row.addEventListener('click', function () {
      _openMods[mid] = !_openMods[mid];
      render();
    });
  })(node.id);

  container.appendChild(row);

  if (!isOpen) return;

  var detail = document.createElement('div');
  detail.className = 'skill-list-mod-detail';

  if (node.description) {
    var desc = document.createElement('p');
    desc.className   = 'slm-desc';
    desc.textContent = node.description;
    detail.appendChild(desc);
  }

  items.forEach(function (item) {
    var rec = _grades[item.id] || null;
    var labelPart = (items.length > 1) ? ((item.label || item.id) + ' — ') : '';

    var req = document.createElement('div');
    req.className   = 'slm-prereqs';
    req.textContent = labelPart + 'Pass requirement: ' + (item.min_pass_grade || 'G') + ' — ' + (skillsCore.GRADE_NAMES[item.min_pass_grade] || '');
    detail.appendChild(req);

    if (rec) {
      var g = document.createElement('div');
      g.className   = 'slm-prereqs';
      g.textContent = labelPart + 'Current grade: ' + rec.grade + (rec.notes ? ' — "' + rec.notes + '"' : '');
      detail.appendChild(g);
    }
  });

  if (node.requirements && node.requirements.length) {
    var preDiv = document.createElement('div');
    preDiv.className = 'slm-prereqs';
    var preParts = node.requirements.map(function (r) {
      var target = _treeIndex.modules[r.module_id];
      return (target ? target.title : r.module_id) + ' (' + (r.min_grade || 'G') + '+)';
    });
    preDiv.textContent = 'Requires: ' + preParts.join(', ');
    detail.appendChild(preDiv);
  }

  if (state === 'locked') {
    container.appendChild(detail);
    return;
  }

  var latestGradedAt = null, latestGradedBy = null;
  items.forEach(function (it) {
    var rec = _grades[it.id];
    if (rec && rec.graded_at) latestGradedAt = rec.graded_at;
    if (rec && rec.graded_by) latestGradedBy = rec.graded_by;
  });
  if (latestGradedBy || latestGradedAt) {
    var gradedBy = document.createElement('div');
    gradedBy.className = 'slm-graded-by';
    var dStr = latestGradedAt ? ' on ' + new Date(latestGradedAt).toLocaleDateString() : '';
    gradedBy.textContent = 'Graded by ' + (latestGradedBy || '—') + dStr;
    detail.appendChild(gradedBy);
  }

  var actDiv = document.createElement('div');
  actDiv.style.marginTop = '10px';

  var myOpenReq = _requests.find(function (r) {
    return r.pilot_id === _mySub && (r.status === 'open' || r.status === 'claimed');
  }) || null;
  var isThisModuleReq = myOpenReq && (!myOpenReq.module_id || myOpenReq.module_id === node.id);
  var allTop = items.length && items.every(function (it) {
    var rec = _grades[it.id];
    return rec && rec.grade === 'E';
  });

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
  } else if (items.length && !allTop) {
    var reqBtn = document.createElement('button');
    reqBtn.className   = 'btn-request-grading';
    reqBtn.textContent = 'REQUEST GRADING';
    (function (mid, mtitle) {
      reqBtn.addEventListener('click', function () { requestGrading(mid, mtitle); });
    })(node.id, node.title);
    actDiv.appendChild(reqBtn);
  }

  detail.appendChild(actDiv);
  container.appendChild(detail);
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
