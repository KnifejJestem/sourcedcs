/* ── Theme ── */
function setTheme(t) {
  document.documentElement.classList.toggle('movie', t === 'movie');
  document.querySelectorAll('.theme-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.theme === t); });
  try { localStorage.setItem('sdcs-theme', t); } catch(e) {}
}
(function() { try { if (localStorage.getItem('sdcs-theme') === 'movie') setTheme('movie'); } catch(e) {} })();

/* getToken and loginWithCasdoor are provided by /js/auth.js */
(function() {
  var token = getToken();
  var user = null;
  try { user = JSON.parse(localStorage.getItem('sdcs-user') || 'null'); } catch(e) {}
  if (!token) return;
  var name = (user && user.name) ? user.name.toUpperCase() : 'USER';
  var btn = document.getElementById('loginBtn');
  if (btn) {
    btn.textContent = name + ' \u23FB';
    btn.title = 'Click to log out';
    btn.classList.add('login-btn--logout');
    btn.onclick = function() { try { localStorage.removeItem('sdcs-token'); localStorage.removeItem('sdcs-user'); } catch(e) {} location.reload(); };
  }
})();

/* ── Hamburger menu ── */
(function() {
  var hamburger = document.getElementById('hamburgerBtn');
  var nav       = document.getElementById('mainNav');
  if (!hamburger || !nav) return;
  function closeNav() { nav.classList.remove('nav-open'); hamburger.classList.remove('open'); hamburger.setAttribute('aria-expanded','false'); }
  hamburger.addEventListener('click', function() {
    var open = nav.classList.toggle('nav-open');
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.querySelectorAll('.nav-link').forEach(function(link) { link.addEventListener('click', closeNav); });
})();

function escH(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

/* ── Load wing data ── */
(function() {
  var params = new URLSearchParams(window.location.search);
  var wingId = params.get('id');
  if (!wingId) { document.getElementById('wingHero').innerHTML = '<div style="color:var(--red)">No wing ID specified. <a href="/#subsquadrons" style="color:var(--text);text-decoration:underline">Back to wings</a></div>'; return; }

  Promise.all([
    fetch('/api/squadrons/' + encodeURIComponent(wingId)).then(function(r){return r.ok ? r.json() : null;}),
    fetch('/api/roster').then(function(r){return r.json();})
  ]).then(function(results) {
    var sq = results[0];
    var roster = results[1];
    if (!sq) {
      document.getElementById('wingHero').innerHTML = '<div style="color:var(--red)">Wing not found. <a href="/#subsquadrons" style="color:var(--text);text-decoration:underline">Back to wings</a></div>';
      return;
    }

    document.title = sq.designator + ' ' + sq.name + ' — SOURCE DCS';

    /* Hero */
    var tags = (sq.tags || []).map(function(t){return '<span class="subsq-tag">'+escH(t)+'</span>';}).join('');
    document.getElementById('wingHero').innerHTML =
      '<div class="subsq-designator" style="font-size:clamp(36px,8vw,72px);margin-bottom:8px">' + escH(sq.designator) + '</div>' +
      '<div class="subsq-name" style="font-size:clamp(14px,3vw,20px);margin-bottom:4px">' + escH(sq.name) + '</div>' +
      '<div class="subsq-airframe" style="margin-bottom:12px">' + escH(sq.airframe) + '</div>' +
      '<div class="subsq-role-tags" style="justify-content:center">' + tags + '</div>' +
      '<div style="margin-top:24px"><a class="btn btn-primary" href="/#join"><span class="btn-icon">&#x2295;</span> APPLY TO ' + escH(sq.designator) + '</a></div>';

    /* Detail */
    document.getElementById('wingDetail').innerHTML =
      '<p class="section-desc" style="margin-bottom:16px">' + escH(sq.fullDesc || sq.shortDesc) + '</p>' +
      '<a class="btn btn-secondary" href="/#subsquadrons">&larr; ALL WINGS</a>';

    /* Wing roster */
    var wingPilots = roster.filter(function(p) { return p.squadron === sq.id; });
    var tbody = document.getElementById('wingRosterBody');
    if (!wingPilots.length) {
      tbody.innerHTML = '<tr class="roster-open-row"><td colspan="5" class="roster-open-cell">NO PILOTS ASSIGNED YET \u2014 <a href="/#join">APPLY NOW \u2192</a></td></tr>';
    } else {
      tbody.innerHTML = wingPilots.map(function(p) {
        var badge = p.status === 'active' ? 'badge-active' : 'badge-inactive';
        return '<tr><td><span class="callsign">' + escH(p.callsign) + '</span></td><td>' + escH(p.rank) + '</td><td>' + escH(p.airframe) + '</td><td>' + escH(p.role) + '</td><td><span class="status-badge ' + badge + '">' + escH(p.status).toUpperCase() + '</span></td></tr>';
      }).join('') + '<tr class="roster-open-row"><td colspan="5" class="roster-open-cell">PILOT SLOTS OPEN \u2014 <a href="/#join">APPLY NOW \u2192</a></td></tr>';
    }
  }).catch(function() {
    document.getElementById('wingHero').innerHTML = '<div style="color:var(--red)">Error loading wing data.</div>';
  });
})();
