/* ── Theme ──────────────────────────────────────────────── */
(function() {
  try { if (localStorage.getItem('sdcs-theme') === 'movie') document.documentElement.classList.add('movie'); } catch(e) {}
})();

/* ── OAuth Implicit Flow callback handler ──────────────── */
(function() {
  var status = document.getElementById('cbStatus');
  var errEl  = document.getElementById('cbError');
  var spin   = document.getElementById('spinner');

  function fail(msg) {
    spin.style.display  = 'none';
    status.textContent  = 'AUTHENTICATION FAILED';
    errEl.style.display = '';
    errEl.textContent   = msg || 'An unknown error occurred. Please try again.';
  }

  /* Casdoor may return params as query string (?access_token=...) or as
     URL hash fragment (#access_token=...). Handle both. */
  var raw    = window.location.hash.slice(1) || window.location.search.slice(1);
  var params = {};
  raw.split('&').forEach(function(pair) {
    var parts = pair.split('=');
    if (parts.length === 2) params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
  });

  /* Validate state to prevent CSRF */
  var savedState = null;
  try { savedState = sessionStorage.getItem('sdcs-oauth-state'); } catch(e) {}
  if (savedState && params.state && params.state !== savedState) {
    fail('State mismatch — possible CSRF attack. Please log in again.');
    return;
  }
  try { sessionStorage.removeItem('sdcs-oauth-state'); } catch(e) {}

  if (params.error) {
    fail('Casdoor error: ' + (params.error_description || params.error));
    return;
  }

  var token = params.access_token;
  if (!token) {
    fail('No access token received. The login may have been cancelled or the client is misconfigured.');
    return;
  }

  /* Store token */
  try { localStorage.setItem('sdcs-token', token); } catch(e) {}

  /* Decode JWT payload (base64url) to get basic user info — no verification needed
     for display purposes; actual verification happens server-side. */
  try {
    var parts = token.split('.');
    if (parts.length !== 3) throw new Error('Not a valid JWT');
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    var user    = {
      name:  payload.name || payload.preferred_username || payload.sub || '',
      email: payload.email || ''
    };
    localStorage.setItem('sdcs-user', JSON.stringify(user));
  } catch(e) {
    /* Non-fatal — user info just won't show in header */
  }

  status.textContent = 'LOGGED IN — REDIRECTING...';
  var returnUrl = '/';
  try { returnUrl = localStorage.getItem('sdcs-return-url') || '/'; localStorage.removeItem('sdcs-return-url'); } catch(e) {}
  window.location.replace(returnUrl);
})();
