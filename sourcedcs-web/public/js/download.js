/* ── Theme ── */
function setTheme(t) {
  document.documentElement.classList.toggle('movie', t === 'movie');
  document.querySelectorAll('.theme-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.theme === t); });
  try { localStorage.setItem('sdcs-theme', t); } catch(e) {}
}
(function() { try { if (localStorage.getItem('sdcs-theme') === 'movie') setTheme('movie'); } catch(e) {} })();

/* ── Apply external links from config ── */
(function() {
  function setLink(id, url) { var el = document.getElementById(id); if (el && url) el.href = url; }
  setLink('footerDiscordLink', typeof DISCORD_URL !== 'undefined' ? DISCORD_URL : null);
  setLink('footerWikiLink',   typeof WIKI_URL    !== 'undefined' ? WIKI_URL    : null);
  setLink('footerGithubLink', typeof GITHUB_URL  !== 'undefined' ? GITHUB_URL  : null);
})();

/* getToken, loginWithCasdoor and isAdminRole are provided by /js/auth.js */
function getUser() { try { return JSON.parse(localStorage.getItem('sdcs-user') || 'null'); } catch(e) { return null; } }
function logout() {
  try { localStorage.removeItem('sdcs-token'); localStorage.removeItem('sdcs-user'); } catch(e) {}
  location.reload();
}
(function() {
  var user = getUser();
  var name = (user && user.name) ? user.name.toUpperCase() : 'USER';
  var btn = document.getElementById('loginBtn');
  if (user && btn) { btn.textContent = name + ' ⏻'; btn.title = 'Click to log out'; btn.classList.add('login-btn--logout'); btn.onclick = logout; }
})();

/* ── Releases ── */
function formatSize(bytes) {
  if (!bytes) return '';
  var mb = bytes / (1024 * 1024);
  return mb.toFixed(0) + ' MB';
}

function renderCard(cardEl, platform, release) {
  cardEl.classList.toggle('dl-unavailable', !release);
  var meta = cardEl.querySelector('[data-role="meta"]');
  var existingBtn = cardEl.querySelector('.btn');
  if (existingBtn) existingBtn.remove();

  if (!release) {
    meta.textContent = 'No release available yet';
    return;
  }

  meta.textContent = 'v' + release.version + (release.size ? ' · ' + formatSize(release.size) : '');
  var btn = document.createElement('a');
  btn.className = 'btn btn-primary';
  btn.href = release.url;
  btn.textContent = 'DOWNLOAD FOR ' + platform.toUpperCase();
  cardEl.appendChild(btn);
}

(function loadReleases() {
  var versionEl = document.getElementById('dlVersion');
  var cards = document.querySelectorAll('#dlCards .dl-card');
  var winCard   = cards[0];
  var linuxCard = cards[1];

  fetch('/api/releases/latest')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      renderCard(winCard, 'Windows', data.win);
      renderCard(linuxCard, 'Linux', data.linux);
      var current = (data.win && data.win.version) || (data.linux && data.linux.version);
      versionEl.innerHTML = current ? 'LATEST VERSION: <span>' + current + '</span>' : 'NO RELEASES PUBLISHED YET';
    })
    .catch(function() {
      versionEl.textContent = 'FAILED TO LOAD RELEASE INFO';
    });
})();
