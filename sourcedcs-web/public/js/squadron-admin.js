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
var _members   = [];
var _squadrons = [];
var _search    = '';
var _filter    = '';

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
  ]).then(function (results) {
    _members   = Array.isArray(results[0]) ? results[0] : [];
    _squadrons = Array.isArray(results[1]) ? results[1] : [];
    populateSquadronFilter();
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
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-3)">No members match.</td></tr>';
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
      '<div style="font-size:9px;color:var(--text-3)">@' + esc(m.username) +
      (m.role ? ' &middot; ' + esc(m.role) : '') + '</div>';
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

/* ── Toast ──────────────────────────────────────────────── */
function showToast(msg, isErr) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'skills-toast visible' + (isErr ? ' err' : '');
  setTimeout(function () { el.className = 'skills-toast'; }, 3000);
}
