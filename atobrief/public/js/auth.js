/* ── Auth utilities ─────────────────────────────────────────── */

function getToken() {
  try { return localStorage.getItem('ato-token'); } catch(e) { return null; }
}

function loginWithCasdoor() {
  try { localStorage.setItem('ato-return-url', window.location.href); } catch(e) {}
  var ru = encodeURIComponent(window.location.origin + '/auth-callback.html');
  var stArr = new Uint8Array(16);
  try { window.crypto.getRandomValues(stArr); } catch(e) { stArr = new Uint8Array(16).map(function() { return Math.floor(Math.random() * 256); }); }
  var st = Array.from(stArr).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  try { sessionStorage.setItem('ato-oauth-state', st); } catch(e) {}
  window.location.href = CASDOOR_ENDPOINT + '/login/oauth/authorize?client_id=' + CASDOOR_CLIENT_ID + '&redirect_uri=' + ru + '&response_type=code&scope=openid+profile&state=' + st;
}

function logoutAto() {
  try { localStorage.removeItem('ato-token'); } catch(e) {}
  loginWithCasdoor();
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
