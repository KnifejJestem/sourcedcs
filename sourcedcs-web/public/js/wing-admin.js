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

function logout() {
  try { localStorage.removeItem('sdcs-token'); localStorage.removeItem('sdcs-user'); } catch (e) {}
  location.reload();
}

/* ── State ──────────────────────────────────────────────── */
var _members    = [];
var _squadrons  = [];
var _roleLabels = [];
var _pilots     = [];
var _search     = '';
var _filter     = '';

/* ── Bootstrap ──────────────────────────────────────────── */
(function () {
  var tok  = getToken();
  var user = null;
  try { user = JSON.parse(localStorage.getItem('sdcs-user') || 'null'); } catch (e) {}
  var btn  = document.getElementById('loginBtn');

  if (tok && user) {
    if (btn) {
      btn.textContent = (user.name || 'USER').toUpperCase() + ' ⏻';
      btn.title = 'Click to log out';
      btn.classList.add('login-btn--logout');
      btn.onclick = logout;
    }
  } else if (btn) {
    btn.textContent = 'LOGIN'; btn.onclick = loginWithCasdoor;
  }

  if (!tok || !isSkillAdminRole(tok)) {
    document.getElementById('accessDenied').style.display = '';
    return;
  }

  document.getElementById('adminPanel').style.display = '';
  loadAll(tok);

  /* Squadron entity CRUD and Discord role mapping are global config —
     keep them gated to strict admins, same as before this UI moved here. */
  if (isAdminRole(tok)) {
    document.getElementById('sqSection').style.display = '';
    document.getElementById('drSection').style.display = '';
    document.getElementById('sqAddBtn').addEventListener('click', function () { openSqModal(); });
    document.getElementById('drEditBtn').addEventListener('click', function () { openDiscordRolesModal(); });
  }

  document.getElementById('refreshBtn').addEventListener('click', function () { refreshFromDiscord(tok); });
  document.getElementById('memberSearch').addEventListener('input', function (e) {
    _search = e.target.value.toLowerCase().trim();
    renderTable();
  });
  document.getElementById('squadronFilter').addEventListener('change', function (e) {
    _filter = e.target.value;
    renderTable();
  });

  document.getElementById('activityMode').addEventListener('change', loadActivityOverview);
  document.getElementById('activityRange').addEventListener('change', loadActivityOverview);
  loadActivityOverview();
})();

/* ── Data loading ───────────────────────────────────────── */
function loadAll(tok) {
  var headers = { 'Authorization': 'Bearer ' + tok };
  Promise.all([
    fetch('/api/members',   { headers: headers }).then(function (r) { return r.json(); }),
    fetch('/api/squadrons').then(function (r) { return r.json(); }).catch(function () { return []; }),
    fetch('/api/role-labels', { headers: headers }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
    fetch('/api/skill-pilots', { headers: headers }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
  ]).then(function (results) {
    _members    = Array.isArray(results[0]) ? results[0] : [];
    _squadrons  = Array.isArray(results[1]) ? results[1] : [];
    _roleLabels = Array.isArray(results[2]) ? results[2] : [];
    _pilots     = Object.values(results[3] || {}).sort(function (a, b) {
      return (a.callsign || a.name || '').localeCompare(b.callsign || b.name || '');
    });
    populateSquadronFilter();
    renderSquadronsTable();
    renderTable();
  }).catch(function (err) {
    console.error('[wing-admin] load failed:', err);
    showToast('Failed to load member data', true);
  });
}

function refreshFromDiscord(tok) {
  var btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'REFRESHING…';
  fetch('/api/members/refresh', { method: 'POST', headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Refresh failed');
      showToast('Refreshed from Discord');
      loadAll(tok);
    })
    .catch(function (err) {
      showToast(err.message || 'Refresh failed', true);
    })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = 'REFRESH FROM DISCORD';
    });
}

/* ── Helpers ────────────────────────────────────────────── */
function squadronDisplayName(sqId) {
  if (!sqId) return null;
  var sq = _squadrons.find(function (s) { return s.id === sqId; });
  return sq ? (sq.designator + ' ' + sq.name) : sqId;
}

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ── Filtering ──────────────────────────────────────────── */
function filteredMembers() {
  return _members.filter(function (m) {
    if (_search) {
      var hay = (m.callsign + ' ' + m.username + ' ' + m.globalName + ' ' +
        (m.linkedPilot ? m.linkedPilot.name + ' ' + m.linkedPilot.callsign : '')).toLowerCase();
      if (hay.indexOf(_search) === -1) return false;
    }
    if (_filter === '__unassigned')    return !m.squadron;
    if (_filter === '__mismatch')      return !!m.nameMismatch;
    if (_filter === '__left_discord')  return m.status === 'LEFT_DISCORD';
    if (_filter === '__stale')         return m.status === 'STALE';
    if (_filter === '__inactive_score') return m.status === 'INACTIVE';
    if (_filter === '__on_vacation')   return m.status === 'ON_VACATION';
    if (_filter)                       return m.squadron === _filter;
    return true;
  });
}

function populateSquadronFilter() {
  var sel = document.getElementById('squadronFilter');
  var extraOpts = Array.prototype.slice.call(sel.querySelectorAll('option')).slice(0, 4);
  sel.innerHTML = '';
  extraOpts.forEach(function (o) { sel.appendChild(o); });
  _squadrons.forEach(function (sq) {
    var opt = document.createElement('option');
    opt.value = sq.id;
    opt.textContent = (sq.designator + ' ' + sq.name).toUpperCase();
    sel.appendChild(opt);
  });
}

/* ── Rendering ──────────────────────────────────────────── */
function renderTable() {
  var statusCounts = { ACTIVE: 0, INACTIVE: 0, STALE: 0, ON_VACATION: 0, LEFT_DISCORD: 0 };
  _members.forEach(function (m) { statusCounts[m.status] = (statusCounts[m.status] || 0) + 1; });
  var unassigned = _members.filter(function (m) { return m.active && !m.squadron; }).length;
  var mismatches = _members.filter(function (m) { return m.nameMismatch; }).length;
  document.getElementById('memberSummary').textContent =
    statusCounts.ACTIVE + ' active · ' + statusCounts.INACTIVE + ' inactive · ' +
    statusCounts.STALE + ' stale · ' + statusCounts.ON_VACATION + ' on vacation · ' +
    statusCounts.LEFT_DISCORD + ' left discord · ' +
    unassigned + ' unassigned · ' + mismatches + ' name mismatch' + (mismatches === 1 ? '' : 'es');

  var list = filteredMembers();
  var tbody = document.getElementById('membersBody');

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-3)">No members match.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  list.forEach(function (m) {
    var tr = document.createElement('tr');
    if (!m.active) tr.style.opacity = '.5';

    /* Callsign */
    var tdCallsign = document.createElement('td');
    tdCallsign.innerHTML = '<span class="callsign">' + esc(m.callsign || m.username || m.id) + '</span>';
    tr.appendChild(tdCallsign);

    /* Discord identity */
    var tdDiscord = document.createElement('td');
    tdDiscord.innerHTML =
      '<div>' + esc(m.globalName || m.username) + '</div>' +
      '<div style="font-size:9px;color:var(--text-3)">@' + esc(m.username) + '</div>';
    tr.appendChild(tdDiscord);

    /* Squadron assignment */
    var tdSq = document.createElement('td');
    var sqWrap = document.createElement('div');
    sqWrap.style.cssText = 'display:flex;align-items:center;gap:6px';

    var sqSel = document.createElement('select');
    sqSel.className = 'grade-select';
    var autoName = squadronDisplayName(m.autoSquadron);
    var autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = m.squadronOverride ? '(auto: ' + (autoName || 'none') + ')' : '(auto)';
    sqSel.appendChild(autoOpt);
    _squadrons.forEach(function (sq) {
      var opt = document.createElement('option');
      opt.value = sq.id;
      opt.textContent = sq.designator + ' ' + sq.name;
      if (m.squadronOverride === sq.id) opt.selected = true;
      sqSel.appendChild(opt);
    });

    var sqBtn = document.createElement('button');
    sqBtn.className = 'btn-sm btn-sm-blue';
    sqBtn.textContent = 'SET';
    sqBtn.title = 'Override automatic squadron assignment for this member';
    (function (member, selEl) {
      sqBtn.addEventListener('click', function () { setMemberSquadron(member.id, selEl.value); });
    })(m, sqSel);

    sqWrap.appendChild(sqSel);
    sqWrap.appendChild(sqBtn);
    tdSq.appendChild(sqWrap);

    var sqNote = document.createElement('div');
    sqNote.style.cssText = 'font-size:8px;color:var(--text-3);margin-top:3px';
    sqNote.textContent = m.squadronOverride
      ? 'OVERRIDE → ' + (squadronDisplayName(m.squadronOverride) || m.squadronOverride)
      : (m.squadron ? 'auto → ' + squadronDisplayName(m.squadron) : 'no squadron');
    tdSq.appendChild(sqNote);
    tr.appendChild(tdSq);

    /* Role assignment */
    var tdRole = document.createElement('td');
    var roleWrap = document.createElement('div');
    roleWrap.style.cssText = 'display:flex;align-items:center;gap:6px';

    var roleSel = document.createElement('select');
    roleSel.className = 'grade-select';
    var autoRoleOpt = document.createElement('option');
    autoRoleOpt.value = '';
    autoRoleOpt.textContent = m.roleOverride ? '(auto: ' + (m.autoRole || 'none') + ')' : '(auto)';
    roleSel.appendChild(autoRoleOpt);
    _roleLabels.forEach(function (label) {
      var opt = document.createElement('option');
      opt.value = label;
      opt.textContent = label;
      if (m.roleOverride === label) opt.selected = true;
      roleSel.appendChild(opt);
    });

    var roleBtn = document.createElement('button');
    roleBtn.className = 'btn-sm btn-sm-blue';
    roleBtn.textContent = 'SET';
    roleBtn.title = 'Override automatic role assignment for this member';
    (function (member, selEl) {
      roleBtn.addEventListener('click', function () { setMemberRole(member.id, selEl.value); });
    })(m, roleSel);

    roleWrap.appendChild(roleSel);
    roleWrap.appendChild(roleBtn);
    tdRole.appendChild(roleWrap);

    var roleNote = document.createElement('div');
    roleNote.style.cssText = 'font-size:8px;color:var(--text-3);margin-top:3px';
    roleNote.textContent = m.roleOverride
      ? 'OVERRIDE → ' + m.roleOverride
      : (m.role ? 'auto → ' + m.role : 'no role');
    tdRole.appendChild(roleNote);
    tr.appendChild(tdRole);

    /* Website account / name mismatch / manual Casdoor link */
    var tdWeb = document.createElement('td');
    if (m.linkedPilot && m.linkedPilot.manual) {
      var manualHtml = m.linkedPilot.pending
        ? '<div style="color:var(--text-3);font-size:9px">linked &middot; awaiting first login</div>'
        : '<div>' + esc(m.linkedPilot.callsign || m.linkedPilot.name) + '</div>' +
          '<div style="font-size:9px;color:var(--blue,#4af)">manually linked</div>';
      tdWeb.innerHTML = manualHtml;
      var unlinkBtn = document.createElement('button');
      unlinkBtn.className = 'btn-sm';
      unlinkBtn.style.marginTop = '4px';
      unlinkBtn.textContent = 'UNLINK';
      (function (member) {
        unlinkBtn.addEventListener('click', function () { unlinkPilotAccount(member); });
      })(m);
      tdWeb.appendChild(unlinkBtn);
    } else if (m.linkedPilot) {
      var webHtml = '<div>' + esc(m.linkedPilot.callsign || m.linkedPilot.name) + '</div>';
      if (m.nameMismatch) {
        webHtml += '<div style="font-size:9px;color:var(--amber)">website: "' + esc(m.linkedPilot.callsign) +
          '" ≠ discord: "' + esc(m.callsign) + '"</div>';
      }
      tdWeb.innerHTML = webHtml;
      if (m.nameMismatch) {
        var syncBtn = document.createElement('button');
        syncBtn.className = 'btn-sm';
        syncBtn.style.marginTop = '4px';
        syncBtn.textContent = 'SYNC TO DISCORD NAME';
        (function (member) {
          syncBtn.addEventListener('click', function () { syncPilotName(member); });
        })(m);
        tdWeb.appendChild(syncBtn);
      }
    } else {
      tdWeb.innerHTML = '<span style="color:var(--text-3);font-size:9px">not registered on website</span>';
      tdWeb.appendChild(buildLinkPicker(m));
    }
    tr.appendChild(tdWeb);

    /* Status: single merged field — LEFT_DISCORD (guild membership) and
       ON_VACATION (admin-marked) override the activity-score-derived
       label (ACTIVE/INACTIVE/STALE), computed server-side in
       computeMemberStatus(). */
    var tdStatus = document.createElement('td');
    tdStatus.innerHTML = buildStatusBadgeHtml(m.status);
    tr.appendChild(tdStatus);

    /* Activity score: percentage + 7-day trend, provisional flag for
       members under 21 days of history. The label itself is shown in
       STATUS above, so it isn't repeated here. */
    var tdScore = document.createElement('td');
    tdScore.innerHTML = buildScoreCellHtml(m);
    tr.appendChild(tdScore);

    /* Vacation: opens the vacation CRUD modal for this member */
    var tdVac = document.createElement('td');
    var vacCount = (m.vacations || []).length;
    var vacBtn = document.createElement('button');
    vacBtn.className = 'btn-sm';
    vacBtn.textContent = vacCount ? 'VACATION (' + vacCount + ')' : 'VACATION';
    (function (member) {
      vacBtn.addEventListener('click', function () { openVacationModal(member); });
    })(m);
    tdVac.appendChild(vacBtn);
    tr.appendChild(tdVac);

    /* Voice activity: last-online status + per-member heatmap */
    var tdVoice = document.createElement('td');
    var lastOnlineEl = document.createElement('div');
    lastOnlineEl.style.cssText = 'font-size:9px;margin-bottom:4px';
    if (m.inCall) {
      lastOnlineEl.innerHTML = '<span style="color:var(--green)">&#9679; IN CALL NOW</span>';
    } else {
      lastOnlineEl.innerHTML = '<span style="color:var(--text-3)">' + esc(formatRelativeTime(m.lastCallEnd)) + '</span>';
    }
    tdVoice.appendChild(lastOnlineEl);
    var hmBtn = document.createElement('button');
    hmBtn.className = 'btn-sm';
    hmBtn.textContent = 'HEATMAP';
    (function (member) {
      hmBtn.addEventListener('click', function () { openHeatmapModal(member); });
    })(m);
    tdVoice.appendChild(hmBtn);
    tr.appendChild(tdVoice);

    tbody.appendChild(tr);
  });
}

/* ── Actions ────────────────────────────────────────────── */
function setMemberSquadron(id, squadronId) {
  var tok = getToken();
  fetch('/api/members/' + encodeURIComponent(id) + '/squadron', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
    body: JSON.stringify({ squadron_id: squadronId || null }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to set squadron');
      var m = _members.find(function (x) { return x.id === id; });
      if (m) {
        m.squadronOverride = res.body.squadron_id;
        m.squadron = res.body.squadron;
      }
      renderTable();
      showToast(squadronId ? 'Squadron override set' : 'Squadron override cleared');
    })
    .catch(function (err) { showToast(err.message || 'Failed to set squadron', true); });
}

function setMemberRole(id, roleLabel) {
  var tok = getToken();
  fetch('/api/members/' + encodeURIComponent(id) + '/role', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
    body: JSON.stringify({ role: roleLabel || null }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to set role');
      var m = _members.find(function (x) { return x.id === id; });
      if (m) {
        m.roleOverride = res.body.role_override;
        m.role = res.body.role;
      }
      renderTable();
      showToast(roleLabel ? 'Role override set' : 'Role override cleared');
    })
    .catch(function (err) { showToast(err.message || 'Failed to set role', true); });
}

function syncPilotName(member) {
  var tok = getToken();
  fetch('/api/skill-pilots/' + encodeURIComponent(member.linkedPilot.sub) + '/name', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
    body: JSON.stringify({ callsign: member.callsign }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to sync name');
      member.linkedPilot.callsign = res.body.callsign;
      member.nameMismatch = false;
      renderTable();
      showToast('Website name synced to Discord');
    })
    .catch(function (err) { showToast(err.message || 'Failed to sync name', true); });
}

/* Builds a small "pick a Casdoor account + link" control for members whose
   website account couldn't be auto-matched (e.g. their Casdoor login name
   shares nothing with their Discord identity). Only accounts that have
   logged in at least once (present in the pilot registry) are selectable. */
function buildLinkPicker(member) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:4px';

  var sel = document.createElement('select');
  sel.className = 'grade-select';
  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = _pilots.length ? 'link Casdoor account…' : 'no logins yet';
  sel.appendChild(placeholder);
  _pilots.forEach(function (p) {
    var opt = document.createElement('option');
    opt.value = p.sub;
    opt.textContent = p.callsign || p.name || p.sub;
    sel.appendChild(opt);
  });

  var btn = document.createElement('button');
  btn.className = 'btn-sm btn-sm-blue';
  btn.textContent = 'LINK';
  btn.addEventListener('click', function () {
    if (!sel.value) return;
    linkPilotAccount(member.id, sel.value);
  });

  wrap.appendChild(sel);
  wrap.appendChild(btn);
  return wrap;
}

function linkPilotAccount(id, sub) {
  var tok = getToken();
  fetch('/api/members/' + encodeURIComponent(id) + '/casdoor-link', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
    body: JSON.stringify({ sub: sub }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to link account');
      var m = _members.find(function (x) { return x.id === id; });
      if (m) {
        m.linkedPilot  = res.body.linkedPilot;
        m.nameMismatch = false;
      }
      renderTable();
      showToast('Website account linked');
    })
    .catch(function (err) { showToast(err.message || 'Failed to link account', true); });
}

function unlinkPilotAccount(member) {
  var tok = getToken();
  fetch('/api/members/' + encodeURIComponent(member.id) + '/casdoor-link', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
    body: JSON.stringify({ sub: null }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to unlink account');
      var m = _members.find(function (x) { return x.id === member.id; });
      if (m) m.linkedPilot = null;
      renderTable();
      showToast('Website account unlinked');
    })
    .catch(function (err) { showToast(err.message || 'Failed to unlink account', true); });
}

/* ── Squadron CRUD ───────────────────────────────── */
function renderSquadronsTable() {
  var tbody = document.getElementById('squadronsBody');
  if (!tbody) return;
  if (!_squadrons.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-3)">No squadrons configured.</td></tr>';
    return;
  }
  tbody.innerHTML = _squadrons.map(function (sq) {
    return '<tr>' +
      '<td>' + esc(sq.id) + '</td>' +
      '<td>' + esc(sq.designator) + '</td>' +
      '<td>' + esc(sq.name) + '</td>' +
      '<td>' + esc(sq.airframe || '') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn-sm" data-sq-id="' + esc(sq.id) + '">EDIT</button> ' +
        '<button class="btn-sm btn-sm-danger" data-sq-id="' + esc(sq.id) + '">DELETE</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  Array.prototype.forEach.call(tbody.querySelectorAll('.btn-sm:not(.btn-sm-danger)'), function (btn) {
    btn.addEventListener('click', function () { openSqModal(btn.dataset.sqId); });
  });
  Array.prototype.forEach.call(tbody.querySelectorAll('.btn-sm-danger'), function (btn) {
    btn.addEventListener('click', function () { deleteSquadron(btn.dataset.sqId); });
  });
}

function openSqModal(id) {
  var overlay = document.getElementById('sqModalOverlay');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  document.getElementById('sqFormError').style.display = 'none';
  if (id) {
    var sq = _squadrons.find(function (s) { return s.id === id; });
    if (sq) {
      document.getElementById('sqModalTitle').textContent = '✎ EDIT SQUADRON';
      document.getElementById('sqEditId').value = sq.id;
      document.getElementById('sqId').value = sq.id;
      document.getElementById('sqId').disabled = true;
      document.getElementById('sqDesignator').value = sq.designator;
      document.getElementById('sqName').value = sq.name;
      document.getElementById('sqAirframe').value = sq.airframe || '';
      document.getElementById('sqTags').value = (sq.tags || []).join(', ');
      document.getElementById('sqShortDesc').value = sq.shortDesc || '';
      document.getElementById('sqFullDesc').value = sq.fullDesc || '';
      document.getElementById('sqImage').value = sq.image || '';
    }
  } else {
    document.getElementById('sqModalTitle').textContent = '⊕ ADD SQUADRON';
    document.getElementById('sqEditId').value = '';
    document.getElementById('sqId').disabled = false;
    document.getElementById('sqForm').reset();
  }
}
function closeSqModal() {
  document.getElementById('sqModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
}
function editSquadron(id) { openSqModal(id); }
function deleteSquadron(id) {
  if (!confirm('Delete this squadron? This cannot be undone.')) return;
  fetch('/api/squadrons/' + id, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + (getToken() || '') },
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to delete squadron');
      _squadrons = _squadrons.filter(function (s) { return s.id !== id; });
      populateSquadronFilter();
      renderSquadronsTable();
      renderTable();
      showToast('Squadron deleted');
    })
    .catch(function (err) { showToast(err.message || 'Failed to delete squadron', true); });
}
function submitSquadron(e) {
  e.preventDefault();
  var editId = document.getElementById('sqEditId').value;
  var data = {
    id:         document.getElementById('sqId').value.trim(),
    designator: document.getElementById('sqDesignator').value.trim(),
    name:       document.getElementById('sqName').value.trim(),
    airframe:   document.getElementById('sqAirframe').value.trim(),
    tags:       document.getElementById('sqTags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
    shortDesc:  document.getElementById('sqShortDesc').value.trim(),
    fullDesc:   document.getElementById('sqFullDesc').value.trim(),
    image:      document.getElementById('sqImage').value.trim(),
  };
  if (!data.id || !data.designator || !data.name) {
    document.getElementById('sqFormError').textContent = 'ID, designator and name are required.';
    document.getElementById('sqFormError').style.display = '';
    return;
  }
  var url    = editId ? '/api/squadrons/' + editId : '/api/squadrons';
  var method = editId ? 'PUT' : 'POST';
  fetch(url, {
    method: method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (getToken() || '') },
    body: JSON.stringify(data),
  }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      if (!res.ok) {
        document.getElementById('sqFormError').textContent = res.body.error;
        document.getElementById('sqFormError').style.display = '';
        return;
      }
      if (editId) {
        var idx = _squadrons.findIndex(function (s) { return s.id === editId; });
        if (idx !== -1) _squadrons[idx] = res.body;
      } else {
        _squadrons.push(res.body);
      }
      populateSquadronFilter();
      renderSquadronsTable();
      renderTable();
      closeSqModal();
      showToast(editId ? 'Squadron updated' : 'Squadron added');
    });
}
document.getElementById('sqModalOverlay').addEventListener('click', function (e) { if (e.target === this) closeSqModal(); });

/* ── Discord role mapping editor ────────────────────────── */
var drEntries = {}; /* working copy { roleName: { squadron, role } } */

function openDiscordRolesModal() {
  drEntries = {};
  document.getElementById('drAddError').style.display = 'none';
  document.getElementById('drSaveError').style.display = 'none';
  document.getElementById('drAddForm').reset();
  document.getElementById('drModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  fetch('/api/discord-roles', {
    headers: { 'Authorization': 'Bearer ' + (getToken() || '') },
  }).then(function (r) {
    if (!r.ok) throw new Error('Failed to load');
    return r.json();
  }).then(function (data) {
    for (var k in data) {
      if (k !== '_comment') drEntries[k] = { squadron: data[k].squadron || '', role: data[k].role || '' };
    }
    renderDrList();
  }).catch(function () {
    document.getElementById('drSaveError').textContent = 'Failed to load current mapping.';
    document.getElementById('drSaveError').style.display = '';
  });
}

function closeDiscordRolesModal() {
  document.getElementById('drModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

function renderDrList() {
  var container = document.getElementById('drList');
  var keys = Object.keys(drEntries);
  if (!keys.length) {
    container.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:8px 0">No role mappings configured. Add entries below.</div>';
    return;
  }
  container.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">DISCORD ROLE NAME</th>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">SQUADRON ID</th>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">ROLE LABEL</th>' +
    '<th style="padding:6px 8px;border-bottom:1px solid var(--border)"></th>' +
    '</tr></thead><tbody>' +
    keys.map(function (k) {
      var sq   = drEntries[k].squadron || '';
      var role = drEntries[k].role     || '';
      return '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + esc(k) + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + (sq   ? esc(sq)   : '<span style="color:var(--text-3)">—</span>') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + (role ? esc(role) : '<span style="color:var(--text-3)">—</span>') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap">' +
          '<button class="btn-sm btn-sm-danger" data-role-key="' + esc(k) + '" onclick="removeDrEntry(this.dataset.roleKey)">&#x2715;</button>' +
        '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

function removeDrEntry(roleName) {
  delete drEntries[roleName];
  renderDrList();
}

function addDiscordRoleEntry(e) {
  e.preventDefault();
  var errEl     = document.getElementById('drAddError');
  var roleName  = document.getElementById('drRoleName').value.trim();
  var squadron  = document.getElementById('drSquadron').value.trim();
  var roleLabel = document.getElementById('drRoleLabel').value.trim();
  if (!roleName) {
    errEl.textContent   = 'Discord role name is required.';
    errEl.style.display = '';
    return;
  }
  if (!squadron && !roleLabel) {
    errEl.textContent   = 'At least one of Squadron ID or Role Label is required.';
    errEl.style.display = '';
    return;
  }
  if (drEntries[roleName] !== undefined) {
    errEl.textContent   = 'A mapping for "' + roleName + '" already exists. Delete it first if you want to replace it.';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';
  drEntries[roleName] = { squadron: squadron, role: roleLabel };
  document.getElementById('drAddForm').reset();
  renderDrList();
}

function saveDiscordRoles() {
  var btn   = document.getElementById('drSaveBtn');
  var errEl = document.getElementById('drSaveError');
  var tok   = getToken();
  btn.disabled    = true;
  btn.textContent = 'SAVING...';
  errEl.style.display = 'none';
  fetch('/api/discord-roles', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
    body:    JSON.stringify(drEntries),
  }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      btn.disabled  = false;
      btn.innerHTML = '<span class="btn-icon">&#x2713;</span> SAVE MAPPING';
      if (!res.ok) {
        errEl.textContent   = res.body.error || 'Failed to save.';
        errEl.style.display = '';
        return;
      }
      closeDiscordRolesModal();
      showToast('Discord role mapping saved');
      /* The mapping change affects auto-squadron/auto-role assignment —
         reload members so the table reflects it immediately. */
      loadAll(tok);
    }).catch(function () {
      btn.disabled  = false;
      btn.innerHTML = '<span class="btn-icon">&#x2713;</span> SAVE MAPPING';
      errEl.textContent   = 'Network error — please try again.';
      errEl.style.display = '';
    });
}

document.getElementById('drModalOverlay').addEventListener('click', function (e) {
  if (e.target === this) closeDiscordRolesModal();
});

/* ── Voice activity: last-online, heatmap modal, overview chart ────────── */
var MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function formatRelativeTime(iso) {
  if (!iso) return 'never';
  var ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) ms = 0;
  var min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + 'm ago';
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  var day = Math.floor(hr / 24);
  if (day < 365) return day + 'd ago';
  return Math.floor(day / 365) + 'y ago';
}

/* ── Status / activity score display ────────────────────── */
var STATUS_LABEL = {
  ACTIVE:       ['ACTIVE',        'status-active'],
  INACTIVE:     ['INACTIVE',      'status-inactive'],
  STALE:        ['STALE',         'status-stale'],
  ON_VACATION:  ['ON VACATION',   'status-on-vacation'],
  LEFT_DISCORD: ['LEFT DISCORD',  'status-left-discord'],
};
var SCORE_LABEL_CLASS = { active: 'score-active', inactive: 'score-inactive', stale: 'score-stale' };

function buildStatusBadgeHtml(status) {
  var entry = STATUS_LABEL[status] || STATUS_LABEL.ACTIVE;
  return '<span class="status-badge ' + entry[1] + '">' + entry[0] + '</span>';
}

function buildScoreCellHtml(m) {
  if (m.activityScore == null) {
    return '<span style="color:var(--text-3);font-size:9px">&mdash;</span>';
  }
  var pct = Math.round(m.activityScore * 100);
  var labelClass = SCORE_LABEL_CLASS[m.activityLabel] || 'score-inactive';
  var html = '<span class="score-badge ' + labelClass + '">' + pct + '%</span>';
  html += trendHtml(m.activityDelta7d);
  if (m.activityProvisional) {
    html += '<div style="font-size:8px;color:var(--text-3);margin-top:2px">provisional &middot; &lt;21d history</div>';
  }
  return html;
}

function trendHtml(delta7d) {
  if (delta7d == null) return '';
  var deltaPct = Math.round(delta7d * 100);
  var up = deltaPct >= 0;
  return ' <span style="font-size:9px;color:' + (up ? 'var(--green)' : 'var(--red)') + '">' +
    (up ? '&#9650;' : '&#9660;') + (up ? '+' : '') + deltaPct + '</span>';
}

function levelForMinutes(minutes) {
  if (!minutes || minutes <= 0) return 0;
  if (minutes <= 30)  return 1;
  if (minutes <= 90)  return 2;
  if (minutes <= 180) return 3;
  return 4;
}

/* Shared tooltip: viewport-fixed positioning near the cursor, so it's never
   clipped by a scrolling ancestor (e.g. the heatmap's overflow-x:auto wrap —
   which per spec also forces overflow-y non-visible). */
function showTooltip(tooltipEl, evt, html) {
  tooltipEl.innerHTML = html;
  tooltipEl.style.display = '';
  tooltipEl.style.left = evt.clientX + 'px';
  tooltipEl.style.top  = evt.clientY + 'px';
}
function hideTooltip(tooltipEl) { tooltipEl.style.display = 'none'; }

/* ── Per-member heatmap modal ───────────────────────────── */
function openHeatmapModal(member) {
  document.getElementById('hmModalTitle').textContent = 'VOICE ACTIVITY — ' + (member.callsign || member.username || member.id).toUpperCase();
  document.getElementById('hmModalSub').textContent = 'Minutes spent in Discord voice channels, last 365 days.';
  document.getElementById('hmModalScore').innerHTML = member.activityScore == null
    ? '<span style="color:var(--text-3)">Status: &mdash; &middot; Activity score: &mdash;</span>'
    : 'Status: ' + buildStatusBadgeHtml(member.status) + ' &middot; Activity score: ' + buildScoreCellHtml(member);
  document.getElementById('hmSvg').innerHTML = '';
  document.getElementById('hmModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';

  fetch('/api/voice-activity/member/' + encodeURIComponent(member.id), {
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function (r) { return r.json(); })
    .then(function (body) { buildHeatmapSvg(body.days || {}); })
    .catch(function () { showToast('Failed to load activity heatmap', true); });
}
function closeHeatmapModal() {
  document.getElementById('hmModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
}
document.getElementById('hmModalOverlay').addEventListener('click', function (e) { if (e.target === this) closeHeatmapModal(); });

/* ── Vacation modal ──────────────────────────────────────── */
var _vacMember = null;

function openVacationModal(member) {
  _vacMember = member;
  document.getElementById('vacModalName').textContent = (member.callsign || member.username || member.id).toUpperCase();
  document.getElementById('vacAddError').style.display = 'none';
  var now = new Date();
  var plus7 = new Date(Date.now() + 7 * 86400000);
  document.getElementById('vacFrom').value = now.toISOString().slice(0, 10);
  document.getElementById('vacUntil').value = plus7.toISOString().slice(0, 10);
  renderVacList();
  document.getElementById('vacModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeVacationModal() {
  document.getElementById('vacModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
  _vacMember = null;
}
document.getElementById('vacModalOverlay').addEventListener('click', function (e) { if (e.target === this) closeVacationModal(); });

function renderVacList() {
  var container = document.getElementById('vacList');
  var list = (_vacMember && _vacMember.vacations) || [];
  if (!list.length) {
    container.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:8px 0">No vacation entries.</div>';
    return;
  }
  container.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">FROM</th>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">UNTIL</th>' +
    '<th style="padding:6px 8px;border-bottom:1px solid var(--border)"></th>' +
    '</tr></thead><tbody>' +
    list.map(function (v) {
      return '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border)"><input type="date" class="form-input" data-vac-id="' + esc(v.id) + '" data-field="from" value="' + esc(v.from.slice(0, 10)) + '"></td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border)"><input type="date" class="form-input" data-vac-id="' + esc(v.id) + '" data-field="until" value="' + esc(v.until.slice(0, 10)) + '"></td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap">' +
          '<button class="btn-sm" data-vac-save="' + esc(v.id) + '">SAVE</button> ' +
          '<button class="btn-sm btn-sm-danger" data-vac-del="' + esc(v.id) + '">&#x2715;</button>' +
        '</td></tr>';
    }).join('') + '</tbody></table>';
  Array.prototype.forEach.call(container.querySelectorAll('[data-vac-save]'), function (btn) {
    btn.addEventListener('click', function () { saveVacationEntry(btn.dataset.vacSave); });
  });
  Array.prototype.forEach.call(container.querySelectorAll('[data-vac-del]'), function (btn) {
    btn.addEventListener('click', function () { deleteVacationEntry(btn.dataset.vacDel); });
  });
}

function addVacationEntry(e) {
  e.preventDefault();
  var fromVal = document.getElementById('vacFrom').value;
  var untilVal = document.getElementById('vacUntil').value;
  var errEl = document.getElementById('vacAddError');
  if (!fromVal || !untilVal || new Date(untilVal) <= new Date(fromVal)) {
    errEl.textContent = '"Until" must be after "from".';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';
  fetch('/api/members/' + encodeURIComponent(_vacMember.id) + '/vacation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify({ from: new Date(fromVal).toISOString(), until: new Date(untilVal).toISOString() }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) { errEl.textContent = res.body.error || 'Failed to add vacation'; errEl.style.display = ''; return; }
      showToast('Vacation added');
      closeVacationModal();
      loadAll(getToken()); /* status/score depend on vacation state — reload rather than patch in place */
    })
    .catch(function () { errEl.textContent = 'Network error — please try again.'; errEl.style.display = ''; });
}

function saveVacationEntry(vacId) {
  var fromEl = document.querySelector('[data-vac-id="' + vacId + '"][data-field="from"]');
  var untilEl = document.querySelector('[data-vac-id="' + vacId + '"][data-field="until"]');
  if (!fromEl.value || !untilEl.value || new Date(untilEl.value) <= new Date(fromEl.value)) {
    showToast('"Until" must be after "from"', true);
    return;
  }
  fetch('/api/members/' + encodeURIComponent(_vacMember.id) + '/vacation/' + encodeURIComponent(vacId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify({ from: new Date(fromEl.value).toISOString(), until: new Date(untilEl.value).toISOString() }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) { showToast(res.body.error || 'Failed to update vacation', true); return; }
      showToast('Vacation updated');
      closeVacationModal();
      loadAll(getToken());
    })
    .catch(function () { showToast('Network error — please try again.', true); });
}

function deleteVacationEntry(vacId) {
  if (!confirm('Remove this vacation entry?')) return;
  fetch('/api/members/' + encodeURIComponent(_vacMember.id) + '/vacation/' + encodeURIComponent(vacId), {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) { showToast(res.body.error || 'Failed to remove vacation', true); return; }
      showToast('Vacation removed');
      closeVacationModal();
      loadAll(getToken());
    })
    .catch(function () { showToast('Network error — please try again.', true); });
}

/* GitHub-contributions-style grid: rows = day-of-week, columns = weeks,
   rolling 365 days ending today. Buckets are minutes-in-voice per day. */
function buildHeatmapSvg(daysMap) {
  var CELL = 11, GAP = 3, LEFT_PAD = 26, TOP_PAD = 16;

  var today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  var start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 364);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); /* snap back to Sunday */

  var days = [];
  var cursor = new Date(start);
  while (cursor <= today) {
    var key = cursor.toISOString().slice(0, 10);
    days.push({ date: new Date(cursor), key: key, minutes: daysMap[key] || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  var weeks  = Math.ceil(days.length / 7);
  var width  = LEFT_PAD + weeks * (CELL + GAP);
  var height = TOP_PAD + 7 * (CELL + GAP);

  var svg = document.getElementById('hmSvg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

  var markup = '';
  var lastMonth = -1;
  days.forEach(function (d, i) {
    var week = Math.floor(i / 7);
    var dow  = i % 7;
    var x = LEFT_PAD + week * (CELL + GAP);
    var y = TOP_PAD + dow * (CELL + GAP);
    var level = levelForMinutes(d.minutes);
    markup += '<rect x="' + x + '" y="' + y + '" width="' + CELL + '" height="' + CELL +
      '" rx="2" class="hm-level-' + level + '" data-date="' + d.key + '" data-minutes="' + d.minutes + '"></rect>';
    if (dow === 0 && d.date.getUTCMonth() !== lastMonth) {
      lastMonth = d.date.getUTCMonth();
      markup += '<text x="' + x + '" y="' + (TOP_PAD - 5) + '" class="hm-month-label">' + MONTH_NAMES[lastMonth] + '</text>';
    }
  });
  svg.innerHTML = markup;

  var tooltip = document.getElementById('hmTooltip');
  Array.prototype.forEach.call(svg.querySelectorAll('rect'), function (rect) {
    rect.addEventListener('mousemove', function (e) {
      var minutes = Number(rect.dataset.minutes) || 0;
      showTooltip(tooltip, e, '<b>' + rect.dataset.date + '</b><br>' + minutes + ' min in voice');
    });
    rect.addEventListener('mouseleave', function () { hideTooltip(tooltip); });
  });
}

/* ── Squadron-wide overview chart ───────────────────────── */
function loadActivityOverview() {
  var mode  = document.getElementById('activityMode').value;
  var range = document.getElementById('activityRange').value;
  fetch('/api/voice-activity/overview?mode=' + encodeURIComponent(mode) + '&range=' + encodeURIComponent(range), {
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function (r) { return r.json(); })
    .then(function (body) { renderActivityChart(body); })
    .catch(function () { showToast('Failed to load activity overview', true); });
}

function renderActivityChart(data) {
  var svg = document.getElementById('activityChart');
  var VB_W = 900, VB_H = 220;
  var PAD_L = 42, PAD_R = 12, PAD_T = 12, PAD_B = 28;
  var plotW = VB_W - PAD_L - PAD_R;
  var plotH = VB_H - PAD_T - PAD_B;

  var bars; /* [{ label, minutes }] */
  if (data.mode === 'hourly') {
    bars = data.buckets.map(function (minutes, hour) { return { label: String(hour), minutes: minutes }; });
  } else if (data.mode === 'weekly') {
    bars = data.weeks.map(function (w) { return { label: w.weekStart.slice(5), minutes: w.minutes }; });
  } else {
    bars = data.days.map(function (d) { return { label: d.date.slice(5), minutes: d.minutes }; });
  }

  var maxMinutes = bars.reduce(function (m, b) { return Math.max(m, b.minutes); }, 0) || 1;
  var n = bars.length || 1;
  var slot = plotW / n;
  var barW = Math.max(1, Math.min(slot * 0.7, 18));

  var markup = '';
  /* y-axis gridlines + labels (0, half, max — in hours for readability) */
  [0, 0.5, 1].forEach(function (frac) {
    var y = PAD_T + plotH * (1 - frac);
    markup += '<line x1="' + PAD_L + '" y1="' + y + '" x2="' + (VB_W - PAD_R) + '" y2="' + y + '" stroke="var(--border)" stroke-width="1"></line>';
    markup += '<text x="' + (PAD_L - 6) + '" y="' + (y + 3) + '" text-anchor="end" class="hm-axis-label">' + (Math.round(maxMinutes * frac / 6) / 10) + 'h</text>';
  });

  var labelEvery = Math.max(1, Math.ceil(n / 14));
  bars.forEach(function (b, i) {
    var x = PAD_L + i * slot + (slot - barW) / 2;
    var h = maxMinutes > 0 ? (b.minutes / maxMinutes) * plotH : 0;
    var y = PAD_T + plotH - h;
    markup += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + Math.max(h, 0) +
      '" rx="3" class="hm-bar" data-label="' + b.label + '" data-minutes="' + b.minutes + '"></rect>';
    if (i % labelEvery === 0) {
      markup += '<text x="' + (x + barW / 2) + '" y="' + (VB_H - 8) + '" text-anchor="middle" class="hm-axis-label">' + esc(b.label) + '</text>';
    }
  });

  svg.setAttribute('viewBox', '0 0 ' + VB_W + ' ' + VB_H);
  svg.innerHTML = markup;

  var tooltip = document.getElementById('activityTooltip');
  Array.prototype.forEach.call(svg.querySelectorAll('.hm-bar'), function (rect) {
    rect.addEventListener('mousemove', function (e) {
      var minutes = Number(rect.dataset.minutes) || 0;
      var unitLabel = data.mode === 'hourly' ? (rect.dataset.label + ':00') : rect.dataset.label;
      showTooltip(tooltip, e, '<b>' + esc(unitLabel) + '</b><br>' + minutes + ' min');
    });
    rect.addEventListener('mouseleave', function () { hideTooltip(tooltip); });
  });
}

/* ── Toast ──────────────────────────────────────────────── */
function showToast(msg, isErr) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'skills-toast visible' + (isErr ? ' err' : '');
  setTimeout(function () { el.className = 'skills-toast'; }, 3000);
}
