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
})();

/* ── Data loading ───────────────────────────────────────── */
function loadAll(tok) {
  var headers = { 'Authorization': 'Bearer ' + tok };
  Promise.all([
    fetch('/api/members',   { headers: headers }).then(function (r) { return r.json(); }),
    fetch('/api/squadrons').then(function (r) { return r.json(); }).catch(function () { return []; }),
    fetch('/api/role-labels', { headers: headers }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
  ]).then(function (results) {
    _members    = Array.isArray(results[0]) ? results[0] : [];
    _squadrons  = Array.isArray(results[1]) ? results[1] : [];
    _roleLabels = Array.isArray(results[2]) ? results[2] : [];
    populateSquadronFilter();
    renderSquadronsTable();
    renderTable();
  }).catch(function (err) {
    console.error('[squadron-admin] load failed:', err);
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
    if (_filter === '__unassigned') return !m.squadron;
    if (_filter === '__mismatch')   return !!m.nameMismatch;
    if (_filter === '__inactive')   return !m.active;
    if (_filter)                    return m.squadron === _filter;
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
  var active   = _members.filter(function (m) { return m.active; });
  var inactive = _members.length - active.length;
  var unassigned = active.filter(function (m) { return !m.squadron; }).length;
  var mismatches = _members.filter(function (m) { return m.nameMismatch; }).length;
  document.getElementById('memberSummary').textContent =
    active.length + ' active · ' + inactive + ' inactive · ' +
    unassigned + ' unassigned · ' + mismatches + ' name mismatch' + (mismatches === 1 ? '' : 'es');

  var list = filteredMembers();
  var tbody = document.getElementById('membersBody');

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-3)">No members match.</td></tr>';
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

    /* Website account / name mismatch */
    var tdWeb = document.createElement('td');
    if (m.linkedPilot) {
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
    }
    tr.appendChild(tdWeb);

    /* Status */
    var tdStatus = document.createElement('td');
    tdStatus.innerHTML = m.active
      ? '<span style="color:var(--green);font-size:9px;letter-spacing:1px">ACTIVE</span>'
      : '<span style="color:var(--red);font-size:9px;letter-spacing:1px">LEFT DISCORD</span>';
    tr.appendChild(tdStatus);

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

/* ── Squadron (wing) CRUD ───────────────────────────────── */
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

/* ── Toast ──────────────────────────────────────────────── */
function showToast(msg, isErr) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'skills-toast visible' + (isErr ? ' err' : '');
  setTimeout(function () { el.className = 'skills-toast'; }, 3000);
}
