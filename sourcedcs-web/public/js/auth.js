/* ── Shared auth utilities ──────────────────────────────── */

function getToken() { try { return localStorage.getItem('sdcs-token'); } catch(e) { return null; } }

function loginWithCasdoor() {
  try { localStorage.setItem('sdcs-return-url', window.location.href); } catch(e) {}
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

/* Returns true if the token grants booking-admin access (manage ranges &
   controller positions). Fixed allowlist, mirrors the server's
   BOOKING_ADMIN_ROLES in server.js. */
function isBookingAdminRole(token) {
  if (!token) return false;
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return false;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    var userRoles = payload.roles || [];
    var allowed = ['admin', 'squadronlead'];
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
