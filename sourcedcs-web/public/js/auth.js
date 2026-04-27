/* ── Shared auth utilities ──────────────────────────────── */

function getToken() { try { return localStorage.getItem('sdcs-token'); } catch(e) { return null; } }

function loginWithCasdoor(customReturnUrl) {
  try { localStorage.setItem('sdcs-return-url', customReturnUrl || window.location.href); } catch(e) {}
  var ru = encodeURIComponent(window.location.origin + '/auth-callback.html');
  var st = Math.random().toString(36).slice(2);
  try { sessionStorage.setItem('sdcs-oauth-state', st); } catch(e) {}
  window.location.href = CASDOOR_ENDPOINT + '/login/oauth/authorize?client_id=' + CASDOOR_CLIENT_ID + '&redirect_uri=' + ru + '&response_type=code&scope=openid+profile&state=' + st;
}

/* Redirect to Casdoor signup page. Accepts an optional custom return URL so
   callers can direct the user to a specific page (e.g. with ?apply=1) after
   they complete registration. Falls back to the current page. */
function signupWithCasdoor(customReturnUrl) {
  try { localStorage.setItem('sdcs-return-url', customReturnUrl || window.location.href); } catch(e) {}
  var ru = encodeURIComponent(window.location.origin + '/auth-callback.html');
  var st = Math.random().toString(36).slice(2);
  try { sessionStorage.setItem('sdcs-oauth-state', st); } catch(e) {}
  window.location.href = CASDOOR_ENDPOINT + '/signup/oauth/authorize?client_id=' + CASDOOR_CLIENT_ID + '&redirect_uri=' + ru + '&response_type=code&scope=openid+profile&state=' + st;
}

/* Returns true if the given JWT contains an "admin" role in its roles claim.
   Casdoor encodes roles as an array of objects ({ name: '...' }) or strings. */
function isAdminRole(token) {
  if (!token) return false;
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return false;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    var roles = payload.roles || [];
    return Array.isArray(roles) && roles.some(function(r) {
      return (typeof r === 'string' ? r : (r && r.name) || '') === 'admin';
    });
  } catch(e) { return false; }
}

/* Returns true if the token grants skill-admin access.
   Allowed roles are configured in config.json and exposed to the client
   as window.SKILL_ADMIN_ROLES via /js/config.js. */
function isSkillAdminRole(token) {
  if (!token) return false;
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return false;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    var userRoles = payload.roles || [];
    var allowed = (typeof SKILL_ADMIN_ROLES !== 'undefined') ? SKILL_ADMIN_ROLES : ['admin'];
    return Array.isArray(userRoles) && userRoles.some(function(r) {
      return allowed.indexOf(typeof r === 'string' ? r : (r && r.name) || '') !== -1;
    });
  } catch(e) { return false; }
}

/* Returns true if the given JWT contains at least one role in its roles claim. */
function hasAnyRole(token) {
  if (!token) return false;
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return false;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    var roles = payload.roles || [];
    return Array.isArray(roles) && roles.length > 0;
  } catch(e) { return false; }
}


/* ── Brand Dropdown Toggle ── */
document.addEventListener('DOMContentLoaded', function() {
  var brandToggle = document.getElementById('brandToggle');
  var brandDropdown = document.getElementById('brandDropdown');
  if (!brandToggle || !brandDropdown) return;

  brandToggle.addEventListener('click', function(e) {
    e.stopPropagation();
    var isOpen = brandDropdown.classList.toggle('open');
    brandToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  document.addEventListener('click', function(e) {
    if (!brandDropdown.contains(e.target)) {
      brandDropdown.classList.remove('open');
      brandToggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Set brand menu links from config
  var setBrandLink = function(id, url) {
    var el = document.getElementById(id);
    if (el && url) el.href = url;
  };
  if (typeof ATO_URL     !== 'undefined') setBrandLink('navAtoLink', ATO_URL);
  if (typeof ASACS_URL   !== 'undefined') setBrandLink('navAsacsLink', ASACS_URL);
  if (typeof WIKI_URL    !== 'undefined') setBrandLink('navWikiLink', WIKI_URL);
  if (typeof OLYMPUS_URL !== 'undefined') setBrandLink('navOlympusLink', OLYMPUS_URL);

  // Add HUB link to main nav if logged in
  var token = getToken();
  if (token && hasAnyRole(token)) {
    var mainNav = document.getElementById('mainNav');
    if (mainNav && !document.querySelector('.nav-link[href="hub.html"]')) {
      var hubLink = document.createElement('a');
      hubLink.className = 'nav-link';
      hubLink.href = 'hub.html';
      hubLink.textContent = 'HUB';
      // Try to insert before JOIN, otherwise append
      var joinLink = Array.prototype.slice.call(mainNav.querySelectorAll('.nav-link')).find(function(el) {
        return el.getAttribute('href').indexOf('#join') !== -1;
      });
      if (joinLink) {
        mainNav.insertBefore(hubLink, joinLink);
      } else {
        mainNav.appendChild(hubLink);
      }
    }
  }
});
