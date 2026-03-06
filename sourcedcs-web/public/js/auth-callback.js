/* ── Theme ──────────────────────────────────────────────── */
(function() {
  try { if (localStorage.getItem('sdcs-theme') === 'movie') document.documentElement.classList.add('movie'); } catch(e) {}
})();

/* ── OAuth Authorization Code Flow callback handler ─────── */
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

  /* Casdoor returns the authorization code as a query string parameter */
  var params = {};
  window.location.search.slice(1).split('&').forEach(function(pair) {
    var idx = pair.indexOf('=');
    if (idx > 0) params[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1));
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

  var code = params.code;
  if (!code) {
    fail('No authorization code received. The login may have been cancelled or the client is misconfigured.');
    return;
  }

  /* Exchange the authorization code for an access token via the server.
     The client_secret is kept server-side and never exposed to the browser. */
  var redirectUri = window.location.origin + '/auth-callback.html';
  var fetchOk;
  fetch('/api/auth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ code: code, redirectUri: redirectUri }),
  })
  .then(function(r) { fetchOk = r.ok; return r.json(); })
  .then(function(data) {
    if (!fetchOk || !data.access_token) {
      fail(data.error || 'No access token received from server.');
      return;
    }

    var token = data.access_token;

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
  })
  .catch(function(err) {
    fail('Network error during login. Please try again. (' + (err.message || err) + ')');
  });
})();
