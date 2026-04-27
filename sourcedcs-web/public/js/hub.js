/* ── Hub Logic ── */

/* setTheme and other shared utils are expected to be available or handled via common logic */
function setTheme(t) {
    document.documentElement.classList.toggle('movie', t === 'movie');
    document.querySelectorAll('.theme-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.theme === t); });
    try { localStorage.setItem('sdcs-theme', t); } catch(e) {}
}
(function() { try { if (localStorage.getItem('sdcs-theme') === 'movie') setTheme('movie'); } catch(e) {} })();

function logoutCasdoor() {
    try { localStorage.removeItem('sdcs-token'); localStorage.removeItem('sdcs-user'); } catch(e) {}
    window.location.href = '/';
}

(function() {
    function setLink(id, url) { var el = document.getElementById(id); if (el && url) el.href = url; }
    setLink('toolDiscordLink',  typeof DISCORD_URL  !== 'undefined' ? DISCORD_URL  : null);
    setLink('toolWikiLink',     typeof WIKI_URL     !== 'undefined' ? WIKI_URL     : null);
    setLink('toolAtoLink',      typeof ATO_URL      !== 'undefined' ? ATO_URL      : null);
    setLink('toolOlympusLink',  typeof OLYMPUS_URL  !== 'undefined' ? OLYMPUS_URL  : null);
    setLink('toolAsacsLink',    typeof ASACS_URL    !== 'undefined' ? ASACS_URL    : null);
    setLink('footerDiscordLink', typeof DISCORD_URL  !== 'undefined' ? DISCORD_URL  : null);
    setLink('footerWikiLink',   typeof WIKI_URL     !== 'undefined' ? WIKI_URL     : null);
    setLink('footerAtoLink',    typeof ATO_URL      !== 'undefined' ? ATO_URL      : null);
    setLink('footerGithubLink', typeof GITHUB_URL   !== 'undefined' ? GITHUB_URL   : null);

    var token = getToken();
    var user  = null;
    try { user = JSON.parse(localStorage.getItem('sdcs-user') || 'null'); } catch(e) {}

    var loginBtn = document.getElementById('loginBtn');
    var memberPortal = document.getElementById('memberPortal');
    var loginPrompt = document.getElementById('loginPrompt');
    var welcomeTxt = document.getElementById('memberWelcome');

    if (token) {
        var name = (user && user.name) ? user.name.toUpperCase() : 'PILOT';
        if (loginBtn) {
            loginBtn.textContent = name + ' \u23FB';
            loginBtn.classList.add('login-btn--logout');
            loginBtn.onclick = logoutCasdoor;
        }
        if (welcomeTxt) welcomeTxt.textContent = 'WELCOME BACK, ' + name;
        if (memberPortal) memberPortal.style.display = '';
        if (loginPrompt) loginPrompt.style.display = 'none';
    } else {
        if (memberPortal) memberPortal.style.display = 'none';
        if (loginPrompt) loginPrompt.style.display = '';
        if (welcomeTxt) welcomeTxt.textContent = 'MEMBER HUB';
    }
})();

/* ── Hamburger menu ── */
(function() {
    var hamburger = document.getElementById('hamburgerBtn');
    var nav       = document.getElementById('mainNav');
    if (!hamburger || !nav) return;
    function closeNav() {
        nav.classList.remove('nav-open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
    }
    hamburger.addEventListener('click', function() {
        var open = nav.classList.toggle('nav-open');
        hamburger.classList.toggle('open', open);
        hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('.nav-link').forEach(function(link) {
        link.addEventListener('click', closeNav);
    });
})();
