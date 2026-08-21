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

/* ── State ──────────────────────────────────────────────── */
var _tree               = null;   /* last-saved-from-server document { version, tree } */
var _treeIndex          = null;   /* skillsCore.buildIndex(_tree) — used for pilot detail (published data only) */
var _treeEditor          = null;  /* working copy mutated by the GUI editor */
var _treeEditorIndex     = null;  /* skillsCore.buildIndex(_treeEditor), rebuilt after structural mutations */
var _outlineExpanded     = {};    /* { [moduleId]: bool } outline expand state */
var _outlineSelectedId   = null;
var _outlineSquadronFilter = null; /* squadron id, or null = ALL SQUADRONS — session-only, filters the outline + scopes import */
var _pendingImportTarget   = null; /* 'whole' | 'root' | { nodeId } — set right before triggering the shared hidden file input */
var _allGrades          = {};     /* { [sub]: { [gradingItemId]: gradeRec } } */
var _pilots             = {};     /* { [sub]: { sub, name, callsign, registered_at } } */
var _requests            = [];
var _squadrons          = [];     /* squadron list from /api/squadrons */
var _pilotSquadrons     = {};     /* { [sub]: squadronId | null } — server-resolved (auto+override) */
var _members            = [];     /* full Discord roster from /api/members — the squadron-management source of truth */
var _activeSub          = null;
var _gradeSelectedId    = null;   /* selected node id in the pilot-grading outline (right panel target) */
var _gradeOutlineExpanded = {};   /* { [moduleId]: bool } expand state for the grading outline — default: root expanded, deeper collapsed */
var _sqGroupCollapsed   = {};     /* { [squadronId|'__unassigned']: bool } collapse state for pilot list groups */
var _currentUserSub     = null;   /* JWT sub of the logged-in admin */

/* ── Bootstrap ──────────────────────────────────────────── */
function jwtSub(token) {
  try {
    var parts   = token.split('.');
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub || null;
  } catch (e) { return null; }
}

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
    _currentUserSub = jwtSub(tok);
  } else {
    if (btn) { btn.textContent = 'LOGIN'; btn.onclick = loginWithCasdoor; }
  }

  if (!tok || !isSkillAdminRole(tok)) {
    document.getElementById('accessDenied').style.display = '';
    return;
  }

  document.getElementById('adminPanel').style.display = '';

  var saveBtn  = document.getElementById('treeSaveBtn');
  var resetBtn = document.getElementById('treeResetBtn');
  if (saveBtn)  saveBtn.addEventListener('click', saveSkillTree);
  if (resetBtn) resetBtn.addEventListener('click', initTreeEditor);

  var importBtn  = document.getElementById('treeImportBtn');
  var exportBtn  = document.getElementById('treeExportBtn');
  var importFile = document.getElementById('treeImportFile');
  if (importBtn)  importBtn.addEventListener('click', function () { triggerImport('whole'); });
  if (exportBtn)  exportBtn.addEventListener('click', function () { exportJSON(_treeEditor, 'skill-tree.json'); });
  if (importFile) importFile.addEventListener('change', handleImportFileChange);

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
    fetch('/api/skill-pilots-squadrons', { headers: headers }).then(function (r) { return r.json(); }).catch(function () { return {}; }),
    fetch('/api/members', { headers: headers }).then(function (r) { return r.json(); }).catch(function () { return []; }),
  ]).then(function (results) {
    _tree              = results[0];
    _treeIndex         = skillsCore.buildIndex(_tree);
    _allGrades         = results[1] || {};
    _pilots            = results[2] || {};
    _requests          = Array.isArray(results[3]) ? results[3] : [];
    _squadrons         = Array.isArray(results[4]) ? results[4] : [];
    _pilotSquadrons    = (results[5] && typeof results[5] === 'object') ? results[5] : {};
    _members           = Array.isArray(results[6]) ? results[6] : [];

    renderGradingQueue();
    renderPilotList();
    initTreeEditor();
  }).catch(function (err) {
    console.error('[skills-admin] load failed:', err);
    showToast('Failed to load admin data', true);
  });
}

/* ── Score helpers ──────────────────────────────────────── */
function pilotOverallScore(sub) {
  if (!_treeIndex) return 0;
  return skillsCore.overallScore(_treeIndex, pilotSquadron(sub), _allGrades[sub] || {});
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
        '<span class="req-queue-callsign">' + esc(resolvedCallsign(req.pilot_id, req.pilot_callsign || req.pilot_name)) + '</span>' +
      '</div>' +
      moduleHtml +
      claimedByHtml +
      '<div class="req-queue-time">' + esc(time) + discordOk + '</div>';
    row.appendChild(infoDiv);

    var actDiv = document.createElement('div');
    actDiv.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex-shrink:0';

    if (req.status === 'open') {
      var claimBtn = document.createElement('button');
      claimBtn.className = 'btn-sm btn-sm-blue';
      claimBtn.textContent = 'CLAIM';
      (function (id) { claimBtn.addEventListener('click', function () { claimRequest(id); }); })(req.id);
      actDiv.appendChild(claimBtn);
    }

    if (req.status === 'claimed' && req.claimed_by === _currentUserSub) {
      var unclaimBtn = document.createElement('button');
      unclaimBtn.className = 'btn-sm';
      unclaimBtn.textContent = 'UNCLAIM';
      (function (id) { unclaimBtn.addEventListener('click', function () { unclaimRequest(id); }); })(req.id);
      actDiv.appendChild(unclaimBtn);
    }

    var viewBtn = document.createElement('button');
    viewBtn.className = 'btn-sm';
    viewBtn.textContent = 'VIEW';
    (function (pid, mid) {
      viewBtn.addEventListener('click', function () {
        selectPilot(pid);
        if (mid && _treeIndex.modules[mid]) {
          expandGradePathTo(mid);
          _gradeSelectedId = mid;
          renderGradeOutline();
          renderGradeDetail();
        }
      });
    })(req.pilot_id, req.module_id);
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
function rowGroupKey(sqId) {
  var known = sqId && _squadrons.some(function (s) { return s.id === sqId; });
  return known ? sqId : '__unassigned';
}
function pilotGroupKey(sub) { return rowGroupKey(pilotSquadron(sub)); }

function buildPilotRows() {
  var rows = [];
  var subToRow = {};

  Object.keys(_pilots).forEach(function (sub) {
    var row = {
      key: sub, sub: sub, callsign: resolvedCallsign(sub),
      groupKey: pilotGroupKey(sub), registered: true,
    };
    rows.push(row);
    subToRow[sub] = row;
  });

  _members.forEach(function (m) {
    if (m.active === false) return;
    if (m.linkedPilot) {
      var existing = subToRow[m.linkedPilot.sub];
      if (existing) return;
      rows.push({
        key: m.linkedPilot.sub, sub: m.linkedPilot.sub,
        callsign: m.linkedPilot.callsign || m.callsign, groupKey: rowGroupKey(m.squadron), registered: true,
      });
      return;
    }
    rows.push({
      key: 'm:' + m.id, sub: null, memberId: m.id,
      callsign: m.callsign || m.username || m.id, groupKey: rowGroupKey(m.squadron), registered: false,
    });
  });

  return rows;
}

function renderPilotList() {
  var el   = document.getElementById('pilotList');
  var rows = buildPilotRows();

  if (!rows.length) {
    el.innerHTML = '<div class="skills-empty" style="padding:12px 16px;font-size:9px">No members found.</div>';
    return;
  }

  var groups     = _squadrons.map(function (sq) {
    return { key: sq.id, name: (sq.designator + ' ' + sq.name).toUpperCase(), rows: [] };
  });
  var groupByKey = {};
  groups.forEach(function (g) { groupByKey[g.key] = g; });
  var unassigned = { key: '__unassigned', name: 'UNASSIGNED', rows: [] };

  rows.forEach(function (row) {
    var group = groupByKey[row.groupKey] || unassigned;
    group.rows.push(row);
  });

  groups = groups.filter(function (g) { return g.rows.length; });
  if (unassigned.rows.length) groups.push(unassigned);

  groups.forEach(function (g) {
    g.rows.sort(function (a, b) {
      var ca = a.callsign.toLowerCase();
      var cb = b.callsign.toLowerCase();
      return ca < cb ? -1 : (ca > cb ? 1 : 0);
    });
  });

  el.innerHTML = '';
  groups.forEach(function (g) {
    if (!Object.prototype.hasOwnProperty.call(_sqGroupCollapsed, g.key)) {
      _sqGroupCollapsed[g.key] = true;
    }
    var collapsed = !!_sqGroupCollapsed[g.key];

    var groupHdr = document.createElement('div');
    groupHdr.className = 'skill-list-cat-header';
    groupHdr.style.cursor = 'pointer';
    groupHdr.innerHTML =
      '<span class="slc-toggle">' + (collapsed ? '▶' : '▼') + '</span>' +
      '<span class="slc-name">' + esc(g.name) + '</span>' +
      '<span class="slc-count">' + g.rows.length + '</span>';
    (function (key) {
      groupHdr.addEventListener('click', function () {
        _sqGroupCollapsed[key] = !_sqGroupCollapsed[key];
        renderPilotList();
      });
    })(g.key);
    el.appendChild(groupHdr);

    if (collapsed) return;

    g.rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'pilot-row' + (r.key === _activeSub ? ' active' : '') + (r.registered ? '' : ' pilot-row--unregistered');
      row.setAttribute('data-sub', r.key);
      var scoreHtml = r.registered
        ? '<span class="pilot-row-score">' + Math.round(pilotOverallScore(r.sub) * 100) + '%</span>'
        : '<span class="pilot-row-score pilot-row-squadron--none" title="Hasn\'t logged into the training page yet">—</span>';
      row.innerHTML = '<span class="pilot-row-callsign">' + esc(r.callsign) + '</span>' + scoreHtml;
      if (r.registered) {
        (function (s) { row.addEventListener('click', function () { selectPilot(s); }); })(r.sub);
      } else {
        (function (id) { row.addEventListener('click', function () { selectGhostMember(id); }); })(r.memberId);
      }
      el.appendChild(row);
    });
  });
}

/* ── Identity resolution ────────────────────────────────────── */
function memberForSub(sub) {
  return _members.find(function (m) { return m.linkedPilot && m.linkedPilot.sub === sub; }) || null;
}
function resolvedCallsign(sub, fallback) {
  var m = memberForSub(sub);
  if (m && m.callsign) return m.callsign;
  var p = _pilots[sub];
  if (p && (p.callsign || p.name)) return p.callsign || p.name;
  return fallback || sub;
}

/* ── Squadron helpers ───────────────────────────────────────── */
function pilotSquadron(sub) {
  return _pilotSquadrons[sub] || null;
}

function squadronDisplayName(sqId) {
  if (!sqId) return null;
  var sq = _squadrons.find(function (s) { return s.id === sqId; });
  return sq ? (sq.designator + ' ' + sq.name) : sqId;
}

function visibleRootModulesForPilot(sub) {
  if (!_treeIndex) return [];
  return skillsCore.visibleRootModules(_treeIndex, pilotSquadron(sub));
}

/* ── Pilot detail ───────────────────────────────────────── */
function selectPilot(sub) {
  if (_activeSub !== sub) {
    /* Switching pilots — start the grading outline fresh. A same-pilot
       re-render (e.g. right after saveGrade/clearGrade) must NOT reset
       these, or the detail panel would collapse back to empty every time
       an admin saves a grade. */
    _gradeSelectedId = null;
    _gradeOutlineExpanded = {};
  }
  _activeSub = sub;

  var groupKey = pilotGroupKey(sub);
  if (_sqGroupCollapsed[groupKey]) {
    _sqGroupCollapsed[groupKey] = false;
    renderPilotList();
  } else {
    document.querySelectorAll('.pilot-row').forEach(function (r) {
      r.classList.toggle('active', r.getAttribute('data-sub') === sub);
    });
  }

  var pilot    = _pilots[sub] || { sub: sub, name: sub, callsign: sub };
  var callsign = resolvedCallsign(sub);
  var grades   = _allGrades[sub] || {};
  var score    = Math.round(pilotOverallScore(sub) * 100);
  var sqId     = pilotSquadron(sub);
  var sqName   = squadronDisplayName(sqId);
  var el       = document.getElementById('pilotDetail');
  el.innerHTML = '';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:24px;padding-bottom:12px;border-bottom:1px solid var(--border)';

  var callsignSpan = document.createElement('span');
  callsignSpan.style.cssText = 'font-family:Orbitron,monospace;font-weight:900;font-size:16px;letter-spacing:3px';
  callsignSpan.textContent = callsign;

  var nameSpan = document.createElement('span');
  nameSpan.style.cssText = 'font-size:10px;color:var(--text-3)';
  nameSpan.textContent = pilot.name || '';

  var sqBadge = document.createElement('span');
  sqBadge.className = sqName ? 'pilot-detail-squadron' : 'pilot-detail-squadron pilot-detail-squadron--none';
  sqBadge.textContent = sqName || 'NO SQUADRON';

  var scoreSpan = document.createElement('span');
  scoreSpan.style.cssText = 'font-family:Orbitron,monospace;font-weight:700;font-size:20px;color:var(--green);margin-left:auto';
  scoreSpan.textContent = score + '%';

  var delPilotBtn = document.createElement('button');
  delPilotBtn.className   = 'btn-sm btn-sm-danger';
  delPilotBtn.textContent = 'DELETE PILOT';
  delPilotBtn.title       = 'Permanently remove this pilot and all their grades';
  (function (s, cs) {
    delPilotBtn.addEventListener('click', function () { deletePilot(s, cs); });
  })(sub, callsign);

  hdr.appendChild(callsignSpan);
  hdr.appendChild(nameSpan);
  hdr.appendChild(sqBadge);
  hdr.appendChild(scoreSpan);
  hdr.appendChild(delPilotBtn);
  el.appendChild(hdr);

  var sqOverrideRow = document.createElement('div');
  sqOverrideRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:8px 10px;background:var(--surface-2,rgba(255,255,255,.04));border:1px solid var(--border);border-radius:3px';
  sqOverrideRow.innerHTML =
    '<span style="font-size:9px;letter-spacing:1px;color:var(--text-3)">SQUADRON</span>' +
    '<span style="font-size:10px;flex:1">' + esc(sqName || 'unassigned') + '</span>' +
    '<a class="btn-sm" href="wing-admin.html">MANAGE ON WING ADMIN &rarr;</a>';
  el.appendChild(sqOverrideRow);

  var layout = document.createElement('div');
  layout.className = 'grade-editor-layout';
  var outlinePane = document.createElement('div');
  outlinePane.className = 'grade-outline-pane';
  outlinePane.id = 'gradeOutline';
  var detailPane = document.createElement('div');
  detailPane.className = 'grade-detail-pane';
  detailPane.id = 'gradeDetail';
  layout.appendChild(outlinePane);
  layout.appendChild(detailPane);
  el.appendChild(layout);

  renderGradeOutline();
  renderGradeDetail();
}

function refreshActiveDetail() {
  if (!_activeSub) return;
  if (_pilots[_activeSub]) selectPilot(_activeSub);
  else if (_activeSub.indexOf('m:') === 0) selectGhostMember(_activeSub.slice(2));
}

function selectGhostMember(memberId) {
  var key = 'm:' + memberId;
  _activeSub = key;

  var member  = _members.find(function (m) { return m.id === memberId; }) || {};
  var groupKey = rowGroupKey(member.squadron);
  if (_sqGroupCollapsed[groupKey]) {
    _sqGroupCollapsed[groupKey] = false;
    renderPilotList();
  } else {
    document.querySelectorAll('.pilot-row').forEach(function (r) {
      r.classList.toggle('active', r.getAttribute('data-sub') === key);
    });
  }

  var sqName = squadronDisplayName(member.squadron);
  var el = document.getElementById('pilotDetail');
  el.innerHTML =
    '<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:24px;padding-bottom:12px;border-bottom:1px solid var(--border)">' +
      '<span style="font-family:Orbitron,monospace;font-weight:900;font-size:16px;letter-spacing:3px">' + esc(member.callsign || memberId) + '</span>' +
      '<span style="font-size:10px;color:var(--text-3)">' + esc(member.globalName || '') + '</span>' +
      '<span class="' + (sqName ? 'pilot-detail-squadron' : 'pilot-detail-squadron pilot-detail-squadron--none') + '">' + esc(sqName || 'NO SQUADRON') + '</span>' +
    '</div>' +
    '<p class="skills-empty">This member hasn\'t logged into the Training page yet — there are no skill grades to show. ' +
    'Once they log in and visit /skills.html at least once, they\'ll appear here as a gradable pilot record.</p>';
}

/* ══════════════════════════════════════════════════════════
   Pilot grading — indented outline (left) + detail panel (right).
   Only the SELECTED module's grading controls (select/save/clear/notes)
   render at any time, instead of every module in the whole tree at once —
   that was the density problem with the old boxes-in-boxes card grid.
   Mirrors the tree structure editor's outline/detail split for visual
   consistency (.outline-row/.outline-toggle/.tree-breadcrumb), but reads
   from the published _treeIndex (not the unsaved _treeEditor draft). */
function gradeNodeExpanded(node, depth) {
  if (Object.prototype.hasOwnProperty.call(_gradeOutlineExpanded, node.id)) return _gradeOutlineExpanded[node.id];
  return depth === 0;
}

function expandGradePathTo(id) {
  var cur = _treeIndex.parentOf[id];
  while (cur) {
    _gradeOutlineExpanded[cur] = true;
    cur = _treeIndex.parentOf[cur];
  }
}

/* Compact right-aligned status chip for one outline row: module-count
   fraction for anything with sub-modules, else a grade letter (single item)
   or an items-passed fraction (multi item). */
function gradeOutlineChip(node, grades) {
  var hasSub = node.subModules && node.subModules.length;
  if (hasSub) {
    var total     = skillsCore.countModules(node);
    var completed = skillsCore.countCompletedModules(_treeIndex, node, grades);
    return '<span class="grade-chip-frac">' + completed + '/' + total + '</span>';
  }
  var items = node.gradingItems || [];
  if (items.length === 1) {
    var rec = grades[items[0].id];
    return rec
      ? '<span class="grade-chip grade-' + rec.grade + '">' + esc(rec.grade) + '</span>'
      : '<span class="grade-chip grade-chip-empty">—</span>';
  }
  if (items.length > 1) {
    var done = items.filter(function (it) {
      var r = grades[it.id];
      return r && skillsCore.gradeValue(r.grade) >= skillsCore.gradeValue(it.min_pass_grade);
    }).length;
    return '<span class="grade-chip-frac">' + done + '/' + items.length + '</span>';
  }
  return '';
}

function renderGradeOutline() {
  var el = document.getElementById('gradeOutline');
  if (!el || !_activeSub) return;
  el.innerHTML = '';

  var grades = _allGrades[_activeSub] || {};
  var list = document.createElement('div');
  list.className = 'tree-outline-list';
  visibleRootModulesForPilot(_activeSub).forEach(function (root) {
    list.appendChild(buildGradeOutlineRow(root, 0, grades));
  });
  el.appendChild(list);
}

function buildGradeOutlineRow(node, depth, grades) {
  var wrap = document.createElement('div');

  var state = skillsCore.moduleState(_treeIndex, node.id, grades);
  var row = document.createElement('div');
  row.className = 'pilot-row outline-row grade-outline-row state-' + state + (node.id === _gradeSelectedId ? ' active' : '');
  row.style.paddingLeft = (10 + depth * 16) + 'px';
  row.setAttribute('data-node-id', node.id);

  var hasChildren = !!(node.subModules && node.subModules.length);
  var expanded    = gradeNodeExpanded(node, depth);

  var toggle = document.createElement('span');
  toggle.className   = 'outline-toggle';
  toggle.textContent = hasChildren ? (expanded ? '▼' : '▶') : '·';
  if (hasChildren) {
    (function (id) {
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        _gradeOutlineExpanded[id] = !expanded;
        renderGradeOutline();
      });
    })(node.id);
  }

  var icon = document.createElement('span');
  icon.className = 'grade-outline-icon';
  var ICONS = { locked: '—', 'not-started': '○', 'in-progress': '◑', completed: '✓' };
  icon.textContent = ICONS[state] || '○';

  var label = document.createElement('span');
  label.className   = 'outline-row-label';
  label.textContent = node.title || '(untitled)';

  var chip = document.createElement('span');
  chip.innerHTML = gradeOutlineChip(node, grades);

  row.appendChild(toggle);
  row.appendChild(icon);
  row.appendChild(label);
  row.appendChild(chip);

  (function (id) { row.addEventListener('click', function () { selectGradeNode(id); }); })(node.id);
  wrap.appendChild(row);

  if (hasChildren && expanded) {
    node.subModules.forEach(function (child) {
      wrap.appendChild(buildGradeOutlineRow(child, depth + 1, grades));
    });
  }

  return wrap;
}

function selectGradeNode(id) {
  _gradeSelectedId = id;
  document.querySelectorAll('#gradeOutline .outline-row').forEach(function (r) {
    r.classList.toggle('active', r.getAttribute('data-node-id') === id);
  });
  renderGradeDetail();
}

function renderGradeDetail() {
  var el = document.getElementById('gradeDetail');
  if (!el) return;
  el.innerHTML = '';
  if (!_activeSub) return;

  var node = _gradeSelectedId ? _treeIndex.modules[_gradeSelectedId] : null;
  if (!node) {
    _gradeSelectedId = null;
    el.innerHTML = '<p class="skills-empty">Select a module on the left to view or grade it.</p>';
    return;
  }

  var grades = _allGrades[_activeSub] || {};
  var state  = skillsCore.moduleState(_treeIndex, node.id, grades);
  var BADGE_CLASS = {
    'locked':      'badge-locked',
    'not-started': 'badge-not-started',
    'in-progress': 'badge-in-progress',
    'completed':   'badge-completed',
  };

  var crumb = document.createElement('div');
  crumb.className = 'tree-breadcrumb';
  crumb.textContent = skillsCore.breadcrumb(_treeIndex, node.id).join(' › ');
  el.appendChild(crumb);

  var hdr = document.createElement('div');
  hdr.className = 'grade-detail-hdr';
  hdr.innerHTML =
    '<span class="grade-detail-title">' + esc(node.title) + '</span>' +
    '<span class="skill-mod-badge ' + (BADGE_CLASS[state] || 'badge-not-started') + '">' +
      state.replace('-', ' ').toUpperCase() +
    '</span>';
  el.appendChild(hdr);

  if (node.description) {
    var desc = document.createElement('div');
    desc.className = 'skill-mod-desc';
    desc.style.marginBottom = '10px';
    desc.textContent = node.description;
    el.appendChild(desc);
  }

  if (node.requirements && node.requirements.length) {
    var reqDiv = document.createElement('div');
    reqDiv.className = 'slm-prereqs';
    reqDiv.style.marginBottom = '10px';
    var parts = node.requirements.map(function (r) {
      var target = _treeIndex.modules[r.module_id];
      var eg     = skillsCore.effectiveModuleGrade(_treeIndex, r.module_id, grades);
      var met    = skillsCore.gradeValue(eg) >= skillsCore.gradeValue(r.min_grade);
      return (target ? target.title : r.module_id) + ' (' + (r.min_grade || 'G') + '+)' + (met ? ' ✓' : ' ✗');
    });
    reqDiv.textContent = 'Requires: ' + parts.join(', ');
    el.appendChild(reqDiv);
  }

  var items = node.gradingItems || [];
  if (items.length) {
    var itemsWrap = document.createElement('div');
    itemsWrap.className = 'grade-items-wrap';
    items.forEach(function (item) {
      itemsWrap.appendChild(buildGradeItemControls(item, grades, _activeSub, items.length > 1));
    });
    el.appendChild(itemsWrap);
  }

  if (node.subModules && node.subModules.length) {
    var kidsWrap = document.createElement('div');
    kidsWrap.className = 'tree-editor-subsection';
    var kidsLbl = document.createElement('span');
    kidsLbl.className   = 'tree-field-label';
    kidsLbl.textContent = 'SUB-MODULES';
    kidsWrap.appendChild(kidsLbl);
    node.subModules.forEach(function (child) {
      var row = document.createElement('div');
      row.className = 'tree-prereq-row';
      var btn = document.createElement('button');
      btn.className = 'btn-sm';
      btn.style.cssText = 'flex:1;text-align:left';
      btn.innerHTML = esc(child.title || '(untitled)') + ' ' + gradeOutlineChip(child, grades);
      (function (id) { btn.addEventListener('click', function () { selectGradeNode(id); }); })(child.id);
      row.appendChild(btn);
      kidsWrap.appendChild(row);
    });
    el.appendChild(kidsWrap);
  }
}

function buildGradeItemControls(item, grades, sub, showLabel) {
  var gradeRec = grades[item.id] || null;

  var wrap = document.createElement('div');
  wrap.className = 'grade-item-card';

  if (showLabel) {
    var lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:9px;letter-spacing:1px;color:var(--text-3);margin-bottom:5px';
    lbl.textContent = item.label || item.id;
    wrap.appendChild(lbl);
  }

  if (gradeRec) {
    var gradedAt = gradeRec.graded_at ? new Date(gradeRec.graded_at).toLocaleDateString() : '';
    var infoDiv = document.createElement('div');
    infoDiv.className = 'skill-mod-grade';
    infoDiv.innerHTML =
      '<span class="skill-mod-grade-val grade-' + gradeRec.grade + '">' + esc(gradeRec.grade) + '</span>' +
      ' <span style="font-size:9px;color:var(--text-2)">' + esc(skillsCore.GRADE_NAMES[gradeRec.grade] || '') + '</span>' +
      '<div class="skill-mod-grade-meta">' +
        (gradeRec.graded_by ? esc(gradeRec.graded_by) + '<br>' : '') + esc(gradedAt) +
      '</div>';
    wrap.appendChild(infoDiv);
    if (gradeRec.notes) {
      var notesDiv = document.createElement('div');
      notesDiv.className = 'skill-mod-grade-notes';
      notesDiv.textContent = gradeRec.notes;
      wrap.appendChild(notesDiv);
    }
  }

  var row1 = document.createElement('div');
  row1.style.cssText = 'display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:6px';

  var sel = document.createElement('select');
  sel.className = 'grade-select';
  var opts = '<option value="">— GRADE —</option>';
  ['U', 'F', 'G', 'E'].forEach(function (g) {
    var selected = (gradeRec && gradeRec.grade === g) ? ' selected' : '';
    opts += '<option value="' + g + '"' + selected + '>' + g + ' · ' + skillsCore.GRADE_NAMES[g] + '</option>';
  });
  sel.innerHTML = opts;

  var saveBtn = document.createElement('button');
  saveBtn.className   = 'btn-save-grade';
  saveBtn.textContent = 'SAVE';
  (function (s, iid, selEl) {
    saveBtn.addEventListener('click', function () {
      if (!selEl.value) { showToast('Select a grade first', true); return; }
      var notesEl = selEl.parentElement.parentElement.querySelector('.grade-notes-input');
      saveGrade(s, iid, selEl.value, notesEl ? notesEl.value : '');
    });
  })(sub, item.id, sel);

  var clearBtn = document.createElement('button');
  clearBtn.className   = 'btn-clear-grade';
  clearBtn.textContent = 'CLEAR';
  clearBtn.style.display = gradeRec ? '' : 'none';
  (function (s, iid) {
    clearBtn.addEventListener('click', function () { clearGrade(s, iid); });
  })(sub, item.id);

  row1.appendChild(sel);
  row1.appendChild(saveBtn);
  row1.appendChild(clearBtn);

  var row2 = document.createElement('div');
  row2.style.marginTop = '5px';
  var notesInput = document.createElement('input');
  notesInput.className   = 'grade-notes-input';
  notesInput.type        = 'text';
  notesInput.placeholder = 'Comment / grade justification (optional)';
  notesInput.value       = gradeRec ? (gradeRec.notes || '') : '';
  notesInput.style.width = '100%';
  notesInput.style.boxSizing = 'border-box';
  row2.appendChild(notesInput);

  wrap.appendChild(row1);
  wrap.appendChild(row2);
  return wrap;
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
function saveGrade(sub, itemId, grade, notes) {
  var tok = getToken();
  fetch('/api/skill-grades/' + encodeURIComponent(sub) + '/' + encodeURIComponent(itemId), {
    method:  'PUT',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ grade: grade, notes: notes }),
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function (gradeRec) {
    if (!_allGrades[sub]) _allGrades[sub] = {};
    _allGrades[sub][itemId] = gradeRec;
    var parentModuleId = (_treeIndex.itemOwner[itemId]) || itemId;
    _requests = _requests.filter(function (r) {
      return !(r.pilot_id === sub && (r.module_id === parentModuleId || !r.module_id));
    });
    renderPilotList();
    renderGradingQueue();
    selectPilot(sub);
    showToast('Grade saved');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

function clearGrade(sub, itemId) {
  var tok = getToken();
  fetch('/api/skill-grades/' + encodeURIComponent(sub) + '/' + encodeURIComponent(itemId), {
    method:  'DELETE',
    headers: { 'Authorization': 'Bearer ' + tok },
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function () {
    if (_allGrades[sub]) delete _allGrades[sub][itemId];
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

/* ══════════════════════════════════════════════════════════
   Skill tree editor — indented outline (left) + detail panel (right)
══════════════════════════════════════════════════════════ */

function initTreeEditor() {
  _treeEditor = JSON.parse(JSON.stringify(_tree || { version: 2, tree: [] }));
  rebuildTreeEditorIndex();
  if (_outlineSelectedId && !_treeEditorIndex.modules[_outlineSelectedId]) _outlineSelectedId = null;
  renderTreeOutline();
  renderTreeDetail();
}

function rebuildTreeEditorIndex() {
  _treeEditorIndex = skillsCore.buildIndex(_treeEditor);
}

/* ── Outline (left pane) ─────────────────────────────────── */
/* skillsCore.moduleVisibleToSquadron treats a falsy squadronId as "pilot has
   no squadron" and hides restricted nodes — the opposite of what "ALL
   SQUADRONS" needs here, so this is only ever called when a filter is
   actually active; with no filter every node is shown unconditionally. */
function outlineNodeVisible(node) {
  if (!_outlineSquadronFilter) return true;
  return skillsCore.moduleVisibleToSquadron(_treeEditorIndex, node.id, _outlineSquadronFilter);
}

/* Suffix appended to every IMPORT JSON button's label so the squadron
   scoping driven by the outline's filter (see forceSquadronScope) is never
   silently active — it always says on the button what it's about to do. */
function importScopeSuffix() {
  return _outlineSquadronFilter ? (' → ' + squadronShortName(_outlineSquadronFilter)) : '';
}

function renderTreeOutline() {
  var el = document.getElementById('treeOutline');
  if (!el) return;
  el.innerHTML = '';

  var filterRow = document.createElement('div');
  filterRow.className = 'tree-outline-filter-row';
  var filterLbl = document.createElement('span');
  filterLbl.className   = 'tree-field-label';
  filterLbl.textContent = 'SQUADRON';
  var filterSel = document.createElement('select');
  filterSel.className = 'grade-select';
  filterSel.style.flex = '1';
  var allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'ALL SQUADRONS';
  if (!_outlineSquadronFilter) allOpt.selected = true;
  filterSel.appendChild(allOpt);
  _squadrons.forEach(function (sq) {
    var opt = document.createElement('option');
    opt.value = sq.id;
    opt.textContent = sq.designator + ' ' + sq.name;
    if (_outlineSquadronFilter === sq.id) opt.selected = true;
    filterSel.appendChild(opt);
  });
  filterSel.addEventListener('change', function () {
    _outlineSquadronFilter = this.value || null;
    if (_outlineSelectedId && !outlineNodeVisible(_treeEditorIndex.modules[_outlineSelectedId] || {})) {
      _outlineSelectedId = null;
    }
    renderTreeOutline();
    renderTreeDetail();
  });
  filterRow.appendChild(filterLbl);
  filterRow.appendChild(filterSel);
  el.appendChild(filterRow);

  var filterHint = document.createElement('div');
  filterHint.className = 'tree-inherited-note tree-outline-filter-hint';
  filterHint.textContent = _outlineSquadronFilter
    ? ('IMPORT JSON below is scoped to ' + squadronShortName(_outlineSquadronFilter) + ' while this filter is active — uploaded modules are forced into it.')
    : 'This also scopes IMPORT JSON and new root modules — pick a squadron here first to import for it.';
  el.appendChild(filterHint);

  var list = document.createElement('div');
  list.className = 'tree-outline-list';
  (_treeEditor.tree || []).forEach(function (node) {
    if (!outlineNodeVisible(node)) return;
    list.appendChild(buildOutlineRow(node, 0));
  });
  el.appendChild(list);

  var btnRow = document.createElement('div');
  btnRow.className = 'tree-outline-btn-row';
  var addBtn = document.createElement('button');
  addBtn.className   = 'btn-sm btn-sm-blue';
  addBtn.textContent = '+ ADD ROOT MODULE';
  addBtn.addEventListener('click', addRootModule);
  var importRootBtn = document.createElement('button');
  importRootBtn.className   = 'btn-sm';
  importRootBtn.textContent = '+ IMPORT JSON AS ROOT' + importScopeSuffix();
  importRootBtn.addEventListener('click', function () { triggerImport('root'); });
  btnRow.appendChild(addBtn);
  btnRow.appendChild(importRootBtn);
  el.appendChild(btnRow);

  var wholeImportBtn = document.getElementById('treeImportBtn');
  if (wholeImportBtn) wholeImportBtn.textContent = 'IMPORT JSON' + importScopeSuffix();
}

function buildOutlineRow(node, depth) {
  var wrap = document.createElement('div');

  var row = document.createElement('div');
  row.className = 'pilot-row outline-row' + (node.id === _outlineSelectedId ? ' active' : '');
  row.style.paddingLeft = (10 + depth * 16) + 'px';
  row.setAttribute('data-node-id', node.id);

  var hasChildren = !!(node.subModules && node.subModules.length);
  var expanded    = !!_outlineExpanded[node.id];

  var toggle = document.createElement('span');
  toggle.className   = 'outline-toggle';
  toggle.textContent = hasChildren ? (expanded ? '▼' : '▶') : '·';
  if (hasChildren) {
    (function (id) {
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        _outlineExpanded[id] = !_outlineExpanded[id];
        renderTreeOutline();
      });
    })(node.id);
  }

  var label = document.createElement('span');
  label.className   = 'outline-row-label';
  label.textContent = node.title || '(untitled)';

  var badge = document.createElement('span');
  badge.className = 'outline-badge';
  var itemCount = (node.gradingItems || []).length;
  badge.textContent = hasChildren ? (skillsCore.countModules(node) + ' MOD') : (itemCount > 1 ? itemCount + ' ITEMS' : '');

  var sqBadge = document.createElement('span');
  if (node.squadrons && node.squadrons.length) {
    sqBadge.className = 'outline-badge outline-badge-sq';
    sqBadge.textContent = node.squadrons.length + ' SQ';
    sqBadge.title = node.squadrons.join(', ');
  }

  row.appendChild(toggle);
  row.appendChild(label);
  if (badge.textContent) row.appendChild(badge);
  if (sqBadge.textContent) row.appendChild(sqBadge);

  (function (id) { row.addEventListener('click', function () { selectNode(id); }); })(node.id);

  wrap.appendChild(row);

  if (hasChildren && expanded) {
    node.subModules.forEach(function (child) {
      if (!outlineNodeVisible(child)) return;
      wrap.appendChild(buildOutlineRow(child, depth + 1));
    });
  }

  return wrap;
}

function selectNode(id) {
  _outlineSelectedId = id;
  document.querySelectorAll('#treeOutline .outline-row').forEach(function (r) {
    r.classList.toggle('active', r.getAttribute('data-node-id') === id);
  });
  renderTreeDetail();
}

function patchOutlineLabel(id, title) {
  var rows = document.querySelectorAll('#treeOutline .outline-row');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('data-node-id') === id) {
      var lbl = rows[i].querySelector('.outline-row-label');
      if (lbl) lbl.textContent = title || '(untitled)';
      break;
    }
  }
}

/* ── Detail panel (right pane) ───────────────────────────── */
function renderTreeDetail() {
  var el = document.getElementById('treeDetail');
  if (!el) return;
  el.innerHTML = '';

  var node = _outlineSelectedId ? _treeEditorIndex.modules[_outlineSelectedId] : null;
  if (!node) {
    _outlineSelectedId = null;
    el.innerHTML = '<p class="skills-empty">Select a module on the left, or add a root module to get started.</p>';
    return;
  }

  var crumb = document.createElement('div');
  crumb.className = 'tree-breadcrumb';
  crumb.textContent = skillsCore.breadcrumb(_treeEditorIndex, node.id).join(' › ');
  el.appendChild(crumb);

  var titleInput = document.createElement('input');
  titleInput.className   = 'tree-input tree-detail-title-input';
  titleInput.placeholder = 'Module title';
  titleInput.value       = node.title || '';
  titleInput.addEventListener('input', function () {
    node.title = this.value;
    patchOutlineLabel(node.id, node.title);
  });
  el.appendChild(titleInput);

  el.appendChild(buildIdRow(node, 'module-id', function (oldId, newId) {
    if (node.gradingItems && node.gradingItems.length === 1 && node.gradingItems[0].id === oldId) {
      node.gradingItems[0].id = newId;
    }
    Object.keys(_treeEditorIndex.modules).forEach(function (mid) {
      var m = _treeEditorIndex.modules[mid];
      (m.requirements || []).forEach(function (r) { if (r.module_id === oldId) r.module_id = newId; });
    });
  }));

  var descRow = document.createElement('div');
  descRow.className = 'tree-desc-row';
  var descLabel = document.createElement('span');
  descLabel.className = 'tree-field-label'; descLabel.textContent = 'DESCRIPTION';
  var descTA = document.createElement('textarea');
  descTA.className   = 'tree-textarea';
  descTA.placeholder = 'What must the pilot demonstrate?';
  descTA.value       = node.description || '';
  descTA.addEventListener('input', function () { node.description = this.value; });
  descRow.appendChild(descLabel); descRow.appendChild(descTA);
  el.appendChild(descRow);

  el.appendChild(buildSquadronRow(node));
  el.appendChild(buildSubModulesSection(node));
  el.appendChild(buildGradingItemsSection(node));
  el.appendChild(buildRequirementsSection(node));
  el.appendChild(buildNodeControlsRow(node));
}

/* Shared ID row builder. `onIdChanged(oldId, newId)` fires only when the id
   is actually committed (on blur/change, not per keystroke) and lets the
   caller fix up anything that referenced the old id (the module's own
   single grading item, other modules' requirements). */
function buildIdRow(obj, placeholder, onIdChanged) {
  var row = document.createElement('div');
  row.className = 'tree-id-row';
  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label'; lbl.textContent = 'ID';
  var inp = document.createElement('input');
  inp.className = 'tree-input tree-id-input';
  inp.placeholder = placeholder || 'id';
  inp.value = obj.id || '';
  inp.addEventListener('change', function () {
    var newId = this.value.trim();
    var oldId = obj.id;
    if (!newId || newId === oldId) { this.value = oldId; return; }
    if (_treeEditorIndex.modules[newId] || _treeEditorIndex.itemOwner[newId]) {
      showToast('That id is already in use', true);
      this.value = oldId;
      return;
    }
    if (typeof onIdChanged === 'function') onIdChanged(oldId, newId);
    obj.id = newId;
    rebuildTreeEditorIndex();
    renderTreeOutline();
    renderTreeDetail();
  });
  row.appendChild(lbl); row.appendChild(inp);
  return row;
}

/* Squadron visibility selector — options are constrained to the nearest
   restricting ancestor's set (a child can only narrow, never broaden). */
function squadronNoteText(node, ancestorRestriction) {
  if (!_squadrons.length) return '(no squadrons configured)';
  if (!node.squadrons || !node.squadrons.length) {
    return ancestorRestriction
      ? '(inherited from parent: ' + ancestorRestriction.map(squadronShortName).join(', ') + ')'
      : '(none checked = ALL squadrons)';
  }
  return '';
}

function buildSquadronRow(node) {
  var row = document.createElement('div');
  row.className = 'tree-id-row';
  row.style.cssText = 'flex-wrap:wrap;gap:6px;align-items:flex-start';

  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label';
  lbl.textContent = 'VISIBLE TO';
  row.appendChild(lbl);

  var ancestorRestriction = skillsCore.ancestorSquadronRestriction(_treeEditorIndex, node.id);
  var allowedSquadrons = ancestorRestriction
    ? _squadrons.filter(function (sq) { return ancestorRestriction.indexOf(sq.id) !== -1; })
    : _squadrons;

  /* Kept in the DOM permanently (id'd, text toggled in place rather than
     the element being added/removed) — checking a box used to trigger a
     full renderTreeDetail(), which tore this row down and rebuilt it with
     the note gone, shifting the checkboxes up right as you tried to click
     the next one ("the list collapses"). Updating text in place avoids any
     layout shift while multi-selecting. */
  var note = document.createElement('span');
  note.className = 'tree-inherited-note';
  note.id = 'treeSquadronNote';
  note.textContent = squadronNoteText(node, ancestorRestriction);
  row.appendChild(note);

  if (allowedSquadrons.length) {
    var checksWrap = document.createElement('div');
    checksWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;width:100%';

    allowedSquadrons.forEach(function (sq) {
      var label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:9px;cursor:pointer;user-select:none';

      var cb  = document.createElement('input');
      cb.type = 'checkbox';
      cb.value   = sq.id;
      cb.checked = !!(node.squadrons && node.squadrons.indexOf(sq.id) !== -1);

      (function (sqId, checkbox) {
        checkbox.addEventListener('change', function () {
          if (!node.squadrons) node.squadrons = [];
          if (checkbox.checked) {
            if (node.squadrons.indexOf(sqId) === -1) node.squadrons.push(sqId);
          } else {
            node.squadrons = node.squadrons.filter(function (id) { return id !== sqId; });
          }
          if (!node.squadrons.length) delete node.squadrons;

          var noteEl = document.getElementById('treeSquadronNote');
          if (noteEl) noteEl.textContent = squadronNoteText(node, ancestorRestriction);
          renderTreeOutline(); /* cheap — just labels/badges, no focus to lose */
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
function squadronShortName(sqId) {
  var sq = _squadrons.find(function (s) { return s.id === sqId; });
  return sq ? (sq.designator || sq.name) : sqId;
}

function buildSubModulesSection(node) {
  var section = document.createElement('div');
  section.className = 'tree-editor-subsection';

  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label'; lbl.textContent = 'SUB-MODULES';
  var addBtn = document.createElement('button');
  addBtn.className = 'btn-sm'; addBtn.textContent = '+ ADD SUB-MODULE';
  (function (n) { addBtn.addEventListener('click', function () { addSubModule(n); }); })(node);
  topRow.appendChild(lbl); topRow.appendChild(addBtn);
  section.appendChild(topRow);

  var kids = node.subModules || [];
  if (!kids.length) {
    var none = document.createElement('span');
    none.style.cssText = 'font-size:9px;color:var(--text-3)';
    none.textContent   = 'None';
    section.appendChild(none);
    return section;
  }

  kids.forEach(function (child, ci) {
    var row = document.createElement('div');
    row.className = 'tree-prereq-row';

    var titleBtn = document.createElement('button');
    titleBtn.className = 'btn-sm';
    titleBtn.style.cssText = 'flex:1;text-align:left';
    titleBtn.textContent = child.title || '(untitled)';
    (function (id) { titleBtn.addEventListener('click', function () { selectNode(id); }); })(child.id);

    var upBtn = document.createElement('button');
    upBtn.className = 'btn-sm'; upBtn.textContent = '↑'; upBtn.disabled = ci === 0;
    (function (n, i) { upBtn.addEventListener('click', function () { moveSiblingUp(n, i); }); })(node, ci);

    var dnBtn = document.createElement('button');
    dnBtn.className = 'btn-sm'; dnBtn.textContent = '↓'; dnBtn.disabled = ci === kids.length - 1;
    (function (n, i) { dnBtn.addEventListener('click', function () { moveSiblingDown(n, i); }); })(node, ci);

    var delBtn = document.createElement('button');
    delBtn.className = 'btn-sm btn-sm-danger'; delBtn.textContent = '×';
    (function (n, i, title) {
      delBtn.addEventListener('click', function () {
        if (confirm('Remove "' + (title || 'unnamed') + '" and everything nested under it?')) removeChildNode(n, i);
      });
    })(node, ci, child.title);

    row.appendChild(titleBtn); row.appendChild(upBtn); row.appendChild(dnBtn); row.appendChild(delBtn);
    section.appendChild(row);
  });

  return section;
}

function buildGradingItemsSection(node) {
  var section = document.createElement('div');
  section.className = 'tree-editor-subsection';

  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label'; lbl.textContent = 'GRADING ITEMS';
  topRow.appendChild(lbl);
  section.appendChild(topRow);

  var items = node.gradingItems || [];

  if (items.length <= 1) {
    var single = items[0];
    if (!single) {
      var addSingleBtn = document.createElement('button');
      addSingleBtn.className = 'btn-sm';
      addSingleBtn.textContent = '+ ADD GRADING ITEM';
      (function (n) { addSingleBtn.addEventListener('click', function () { addFirstGradingItem(n); }); })(node);
      section.appendChild(addSingleBtn);
      return section;
    }

    var passRow = document.createElement('div');
    passRow.className = 'tree-id-row';
    var passLabel = document.createElement('span');
    passLabel.className = 'tree-field-label'; passLabel.textContent = 'PASS';
    var gradeSel = document.createElement('select');
    gradeSel.className = 'grade-select';
    ['U', 'F', 'G', 'E'].forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g; opt.textContent = g;
      if ((single.min_pass_grade || 'G') === g) opt.selected = true;
      gradeSel.appendChild(opt);
    });
    gradeSel.addEventListener('change', function () { single.min_pass_grade = this.value; });
    passRow.appendChild(passLabel); passRow.appendChild(gradeSel);
    section.appendChild(passRow);

    var splitBtn = document.createElement('button');
    splitBtn.className = 'btn-sm';
    splitBtn.style.cssText = 'margin-top:6px';
    splitBtn.textContent = '+ SPLIT INTO MULTIPLE ITEMS';
    (function (n) { splitBtn.addEventListener('click', function () { splitIntoMultipleItems(n); }); })(node);
    section.appendChild(splitBtn);
    return section;
  }

  items.forEach(function (item, ii) {
    var row = document.createElement('div');
    row.className = 'tree-prereq-row';

    var labelInput = document.createElement('input');
    labelInput.className   = 'tree-input';
    labelInput.style.flex  = '1';
    labelInput.placeholder = 'Item label (e.g. Level 1)';
    labelInput.value       = item.label || '';
    labelInput.addEventListener('input', function () { item.label = this.value; });

    var gradeSel = document.createElement('select');
    gradeSel.className = 'grade-select';
    ['U', 'F', 'G', 'E'].forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g; opt.textContent = g + ' PASS';
      if ((item.min_pass_grade || 'G') === g) opt.selected = true;
      gradeSel.appendChild(opt);
    });
    gradeSel.addEventListener('change', function () { item.min_pass_grade = this.value; });

    var delBtn = document.createElement('button');
    delBtn.className = 'btn-sm btn-sm-danger'; delBtn.textContent = '×';
    (function (n, i) {
      delBtn.addEventListener('click', function () {
        if (confirm('Remove this grading item? Any recorded pilot grades under it will be orphaned.')) removeGradingItem(n, i);
      });
    })(node, ii);

    row.appendChild(labelInput); row.appendChild(gradeSel); row.appendChild(delBtn);
    section.appendChild(row);
  });

  var addBtn = document.createElement('button');
  addBtn.className = 'btn-sm';
  addBtn.style.cssText = 'margin-top:6px';
  addBtn.textContent = '+ ADD GRADING ITEM';
  (function (n) { addBtn.addEventListener('click', function () { addGradingItem(n); }); })(node);
  section.appendChild(addBtn);

  return section;
}

function buildRequirementsSection(node) {
  var section = document.createElement('div');
  section.className = 'tree-prereq-section';

  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:8px';
  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label'; lbl.textContent = 'REQUIREMENTS';
  var addBtn = document.createElement('button');
  addBtn.className = 'btn-sm'; addBtn.textContent = '+ ADD';
  (function (n) { addBtn.addEventListener('click', function () { addRequirement(n); }); })(node);
  topRow.appendChild(lbl); topRow.appendChild(addBtn);
  section.appendChild(topRow);

  var reqs = node.requirements || [];
  var availModules = Object.keys(_treeEditorIndex.modules)
    .filter(function (id) { return id !== node.id; })
    .map(function (id) { return _treeEditorIndex.modules[id]; });

  if (!reqs.length) {
    var none = document.createElement('span');
    none.style.cssText = 'font-size:9px;color:var(--text-3);margin-top:4px;display:block';
    none.textContent   = 'None';
    section.appendChild(none);
  } else {
    reqs.forEach(function (req, ri) {
      section.appendChild(buildRequirementRow(node, req, ri, availModules));
    });
  }

  return section;
}

function buildRequirementRow(node, req, ri, availModules) {
  var row = document.createElement('div');
  row.className = 'tree-prereq-row';

  var modSel = document.createElement('select');
  modSel.className = 'grade-select';
  modSel.style.flex = '1';
  if (!availModules.length) {
    var noOpt = document.createElement('option');
    noOpt.value = ''; noOpt.textContent = '(no other modules yet)';
    modSel.appendChild(noOpt);
  } else {
    availModules.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = skillsCore.breadcrumb(_treeEditorIndex, m.id).join(' › ');
      if (req.module_id === m.id) opt.selected = true;
      modSel.appendChild(opt);
    });
  }
  modSel.addEventListener('change', function () {
    var newTarget = this.value;
    var candidate = JSON.parse(JSON.stringify(_treeEditor));
    var idxCand   = skillsCore.buildIndex(candidate);
    idxCand.modules[node.id].requirements[ri].module_id = newTarget;
    if (skillsCore.detectRequirementCycle(idxCand)) {
      showToast('That would create a circular requirement', true);
      this.value = req.module_id;
      return;
    }
    req.module_id = newTarget;
  });

  var gradeSel = document.createElement('select');
  gradeSel.className = 'grade-select';
  ['U', 'F', 'G', 'E'].forEach(function (g) {
    var opt = document.createElement('option');
    opt.value = g; opt.textContent = g + '+';
    if ((req.min_grade || 'G') === g) opt.selected = true;
    gradeSel.appendChild(opt);
  });
  gradeSel.addEventListener('change', function () { req.min_grade = this.value; });

  var delBtn = document.createElement('button');
  delBtn.className = 'btn-sm btn-sm-danger'; delBtn.textContent = '×';
  (function (n, i) { delBtn.addEventListener('click', function () { removeRequirement(n, i); }); })(node, ri);

  row.appendChild(modSel); row.appendChild(gradeSel); row.appendChild(delBtn);
  return row;
}

function buildNodeControlsRow(node) {
  var wrap = document.createElement('div');
  wrap.className = 'tree-node-controls';

  var parentId  = _treeEditorIndex.parentOf[node.id];
  var parentObj = parentId ? _treeEditorIndex.modules[parentId] : null;
  var siblings  = siblingsArrayOf(parentObj);
  var idx       = siblings.findIndex(function (n) { return n.id === node.id; });

  var upBtn = document.createElement('button');
  upBtn.className = 'btn-sm'; upBtn.textContent = '↑ MOVE UP'; upBtn.disabled = idx <= 0;
  upBtn.addEventListener('click', function () { moveSiblingUp(parentObj, idx); });

  var dnBtn = document.createElement('button');
  dnBtn.className = 'btn-sm'; dnBtn.textContent = 'MOVE DOWN ↓'; dnBtn.disabled = (idx === -1 || idx >= siblings.length - 1);
  dnBtn.addEventListener('click', function () { moveSiblingDown(parentObj, idx); });

  var importBtn = document.createElement('button');
  importBtn.className   = 'btn-sm';
  importBtn.textContent = 'IMPORT JSON HERE' + importScopeSuffix();
  (function (n) { importBtn.addEventListener('click', function () { triggerImport({ nodeId: n.id }); }); })(node);

  var exportBtn = document.createElement('button');
  exportBtn.className   = 'btn-sm';
  exportBtn.textContent = 'EXPORT SUBTREE';
  (function (n) { exportBtn.addEventListener('click', function () { exportJSON(n, n.id + '.json'); }); })(node);

  var delBtn = document.createElement('button');
  delBtn.className = 'btn-sm btn-sm-danger';
  delBtn.textContent = 'DELETE MODULE';
  delBtn.style.marginLeft = 'auto';
  delBtn.addEventListener('click', function () {
    if (confirm('Remove "' + (node.title || 'unnamed') + '" and everything nested under it?')) {
      removeChildNode(parentObj, idx);
    }
  });

  wrap.appendChild(upBtn); wrap.appendChild(dnBtn);
  wrap.appendChild(importBtn); wrap.appendChild(exportBtn);
  wrap.appendChild(delBtn);
  return wrap;
}

/* ── Tree mutation helpers ───────────────────────────────── */
function siblingsArrayOf(parentNode) {
  return parentNode ? (parentNode.subModules = parentNode.subModules || []) : (_treeEditor.tree = _treeEditor.tree || []);
}

function newModuleStub(id) {
  return { id: id, title: '', description: '', requirements: [], subModules: [], gradingItems: [{ id: id, label: '', min_pass_grade: 'G' }] };
}

function addRootModule() {
  var id = 'mod-' + Date.now();
  (_treeEditor.tree = _treeEditor.tree || []).push(newModuleStub(id));
  rebuildTreeEditorIndex();
  _outlineSelectedId = id;
  renderTreeOutline();
  renderTreeDetail();
}

function addSubModule(parentNode) {
  var id = 'mod-' + Date.now();
  (parentNode.subModules = parentNode.subModules || []).push(newModuleStub(id));
  _outlineExpanded[parentNode.id] = true;
  rebuildTreeEditorIndex();
  _outlineSelectedId = id;
  renderTreeOutline();
  renderTreeDetail();
}

function removeChildNode(parentNode, index) {
  var arr = siblingsArrayOf(parentNode);
  var removedId = arr[index] && arr[index].id;
  arr.splice(index, 1);
  if (_outlineSelectedId === removedId) _outlineSelectedId = parentNode ? parentNode.id : null;
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
}

function moveSiblingUp(parentNode, index) {
  var arr = siblingsArrayOf(parentNode);
  if (index < 1) return;
  var t = arr[index - 1]; arr[index - 1] = arr[index]; arr[index] = t;
  renderTreeOutline();
  renderTreeDetail();
}
function moveSiblingDown(parentNode, index) {
  var arr = siblingsArrayOf(parentNode);
  if (index < 0 || index >= arr.length - 1) return;
  var t = arr[index + 1]; arr[index + 1] = arr[index]; arr[index] = t;
  renderTreeOutline();
  renderTreeDetail();
}

function addFirstGradingItem(node) {
  node.gradingItems = [{ id: node.id, label: '', min_pass_grade: 'G' }];
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
}

function splitIntoMultipleItems(node) {
  if (!confirm('Splitting into multiple items changes this module\'s grading-item id(s). Any grade already recorded under the old id will be orphaned. Continue?')) return;
  var old = (node.gradingItems && node.gradingItems[0]) || { min_pass_grade: 'G' };
  var id1 = skillsCore.gradingItemId(node.id, 'level-1', _treeEditorIndex);
  var id2 = skillsCore.gradingItemId(node.id, 'level-2', _treeEditorIndex);
  node.gradingItems = [
    { id: id1, label: 'Level 1', min_pass_grade: old.min_pass_grade || 'G' },
    { id: id2, label: 'Level 2', min_pass_grade: 'G' },
  ];
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
}

function addGradingItem(node) {
  var label = 'Item ' + ((node.gradingItems || []).length + 1);
  var id    = skillsCore.gradingItemId(node.id, label, _treeEditorIndex);
  (node.gradingItems = node.gradingItems || []).push({ id: id, label: label, min_pass_grade: 'G' });
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
}

function removeGradingItem(node, ii) {
  node.gradingItems.splice(ii, 1);
  if (node.gradingItems.length === 1 && node.gradingItems[0].id !== node.id) {
    showToast('Only one grading item left — collapsed back to a single grade (old grades under it are orphaned)', true);
    node.gradingItems[0] = { id: node.id, label: '', min_pass_grade: node.gradingItems[0].min_pass_grade };
  }
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
}

function addRequirement(node) {
  var candidates = Object.keys(_treeEditorIndex.modules).filter(function (id) { return id !== node.id; });
  if (!candidates.length) { showToast('No other modules exist yet to require', true); return; }
  var existing = (node.requirements || []).map(function (r) { return r.module_id; });
  var first    = candidates.find(function (id) { return existing.indexOf(id) === -1; }) || candidates[0];
  (node.requirements = node.requirements || []).push({ module_id: first, min_grade: 'G' });
  renderTreeDetail();
}
function removeRequirement(node, ri) {
  node.requirements.splice(ri, 1);
  renderTreeDetail();
}

/* ── JSON import / export ────────────────────────────────── */
/* Forces every top-level node in `nodes` to belong to exactly `squadronId`,
   stripping any explicit `squadrons` from all of their descendants so those
   simply inherit the one restriction — trivially satisfies the subset-of-
   ancestor validation rule with no per-node reconciliation. Mutates and
   returns `nodes`. */
function forceSquadronScope(nodes, squadronId) {
  function stripDeep(n) {
    delete n.squadrons;
    (n.subModules || []).forEach(stripDeep);
  }
  nodes.forEach(function (n) {
    (n.subModules || []).forEach(stripDeep);
    n.squadrons = [squadronId];
  });
  return nodes;
}

function exportJSON(data, filename) {
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* `target` is 'whole', 'root', or { nodeId } — stashed until the shared
   hidden file input's change event fires. */
function triggerImport(target) {
  _pendingImportTarget = target;
  var input = document.getElementById('treeImportFile');
  if (input) { input.value = ''; input.click(); }
}

function handleImportFileChange(e) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  var target = _pendingImportTarget;
  _pendingImportTarget = null;

  var reader = new FileReader();
  reader.onload = function () {
    var parsed;
    try { parsed = JSON.parse(reader.result); } catch (err) { showToast('Invalid JSON: ' + err.message, true); return; }

    if (target === 'whole') {
      importWholeTree(parsed);
    } else if (target === 'root') {
      importSubtreeUnder(null, parsed);
    } else if (target && target.nodeId) {
      var node = _treeEditorIndex.modules[target.nodeId];
      if (!node) { showToast('Target module no longer exists', true); return; }
      importSubtreeUnder(node, parsed);
    }
  };
  reader.onerror = function () { showToast('Failed to read file', true); };
  reader.readAsText(file);
}

/* Whole-document import. With no squadron filter active this REPLACES the
   entire working draft (bulk-authoring the whole curriculum externally).
   With a squadron filter active it stops being destructive: the uploaded
   document's root modules are forced to that squadron and merged in as new
   roots alongside whatever's already there, leaving other squadrons' — and
   general — content untouched. */
function importWholeTree(parsed) {
  if (!_outlineSquadronFilter) {
    var err = skillsCore.validateTree(parsed);
    if (err) { showToast(err, true); return; }
    if (_treeEditor.tree && _treeEditor.tree.length) {
      if (!confirm('This will replace the entire current working draft (' + _treeEditor.tree.length + ' root module(s)). Continue?')) return;
    }
    _treeEditor = parsed;
    rebuildTreeEditorIndex();
    _outlineSelectedId = null;
    renderTreeOutline();
    renderTreeDetail();
    var total = (_treeEditor.tree || []).reduce(function (s, n) { return s + skillsCore.countModules(n); }, 0);
    showToast('Imported tree (' + total + ' module(s))');
    return;
  }

  if (!parsed || !Array.isArray(parsed.tree)) {
    showToast('Expected a { version, tree: [...] } document', true);
    return;
  }
  var nodes = JSON.parse(JSON.stringify(parsed.tree));
  forceSquadronScope(nodes, _outlineSquadronFilter);

  var candidate = JSON.parse(JSON.stringify(_treeEditor));
  candidate.tree = candidate.tree || [];
  nodes.forEach(function (n) { candidate.tree.push(n); });

  var mergeErr = skillsCore.validateTree(candidate);
  if (mergeErr) { showToast(mergeErr, true); return; }

  _treeEditor = candidate;
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
  var count = nodes.reduce(function (s, n) { return s + skillsCore.countModules(n); }, 0);
  showToast('Imported ' + count + ' module(s) for ' + squadronShortName(_outlineSquadronFilter));
}

/* Additive import: inserts the parsed module(s) as new sub-modules of
   `node` (or as new root modules when `node` is null). Any id collision
   against the existing tree is a hard rejection (surfaced via
   skillsCore.validateTree's duplicate-id check) — no silent overwrite. */
function importSubtreeUnder(node, parsedJson) {
  var nodes;
  if (Array.isArray(parsedJson)) {
    nodes = parsedJson;
  } else if (parsedJson && typeof parsedJson === 'object' && parsedJson.id) {
    nodes = [parsedJson];
  } else {
    showToast('Expected a module object or an array of modules', true);
    return;
  }
  nodes = JSON.parse(JSON.stringify(nodes));
  if (_outlineSquadronFilter) forceSquadronScope(nodes, _outlineSquadronFilter);

  var candidate = JSON.parse(JSON.stringify(_treeEditor));
  var targetArr;
  if (node) {
    var candNode = skillsCore.buildIndex(candidate).modules[node.id];
    if (!candNode) { showToast('Target module no longer exists', true); return; }
    candNode.subModules = candNode.subModules || [];
    targetArr = candNode.subModules;
  } else {
    candidate.tree = candidate.tree || [];
    targetArr = candidate.tree;
  }
  nodes.forEach(function (n) { targetArr.push(n); });

  var err = skillsCore.validateTree(candidate);
  if (err) { showToast(err, true); return; }

  _treeEditor = candidate;
  rebuildTreeEditorIndex();
  if (node) _outlineExpanded[node.id] = true;
  renderTreeOutline();
  renderTreeDetail();
  var count = nodes.reduce(function (s, n) { return s + skillsCore.countModules(n); }, 0);
  showToast('Imported ' + count + ' module(s)' + (node ? ' into ' + (node.title || node.id) : ' as new root'));
}

function saveSkillTree() {
  var msg = document.getElementById('treeEditorMsg');

  var err = skillsCore.validateTree(_treeEditor);
  if (err) {
    if (msg) { msg.textContent = 'Error: ' + err; msg.className = 'tree-editor-msg err'; }
    showToast(err, true);
    return;
  }

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
    _treeIndex  = skillsCore.buildIndex(_tree);
    _treeEditor = JSON.parse(JSON.stringify(_tree));
    rebuildTreeEditorIndex();
    renderTreeOutline();
    renderTreeDetail();
    if (msg) { msg.textContent = 'Saved.'; msg.className = 'tree-editor-msg ok'; }
    refreshActiveDetail();
    renderPilotList();
    showToast('Skill tree saved');
  }).catch(function (err2) {
    if (msg) { msg.textContent = 'Error: ' + err2.message; msg.className = 'tree-editor-msg err'; }
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
