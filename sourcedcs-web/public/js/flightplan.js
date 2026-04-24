/* ── Theme ── */
function setTheme(t) {
  document.documentElement.classList.toggle('movie', t === 'movie');
  document.querySelectorAll('.theme-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.theme === t); });
  try { localStorage.setItem('sdcs-theme', t); } catch(e) {}
}
(function() { try { if (localStorage.getItem('sdcs-theme') === 'movie') setTheme('movie'); } catch(e) {} })();

/* ── External links ── */
(function() {
  function setLink(id, url) { var el = document.getElementById(id); if (el && url) el.href = url; }
  setLink('footerDiscordLink', typeof DISCORD_URL !== 'undefined' ? DISCORD_URL : null);
  setLink('footerWikiLink',   typeof WIKI_URL    !== 'undefined' ? WIKI_URL    : null);
  setLink('footerGithubLink', typeof GITHUB_URL  !== 'undefined' ? GITHUB_URL  : null);
})();

/* getToken, loginWithCasdoor, isAdminRole provided by /js/auth.js */

function getUser()  { try { return JSON.parse(localStorage.getItem('sdcs-user') || 'null'); } catch(e) { return null; } }
function logout() {
  try { localStorage.removeItem('sdcs-token'); localStorage.removeItem('sdcs-user'); } catch(e) {}
  location.reload();
}

var currentToken = getToken();

(function() {
  var user = getUser();
  var btn  = document.getElementById('loginBtn');
  if (btn) {
    if (user && currentToken) {
      btn.textContent = (user.name || 'USER').toUpperCase() + ' \u23FB';
      btn.title       = 'Click to log out';
      btn.classList.add('login-btn--logout');
      btn.onclick = logout;
    }
  }

  if (!currentToken) {
    document.getElementById('fpLoginPrompt').style.display = '';
  } else {
    document.getElementById('fpMain').style.display = '';
    fpAddLeg();
    fpAddCrew();
    fpLoadPlans();
  }
})();

/* ── Hamburger ── */
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

/* ════════════════════════════════════════════════════════════
   LEG MANAGEMENT
════════════════════════════════════════════════════════════ */
var fpLegCounter = 0;

function fpAddLeg() {
  fpLegCounter++;
  var id   = fpLegCounter;
  var tbody = document.getElementById('fpLegsTbody');
  var tr    = document.createElement('tr');
  tr.id = 'fpLeg-' + id;
  tr.innerHTML =
    '<td><select class="fp-cell" name="flightRules">' +
      '<option value="I">I — IFR</option>' +
      '<option value="V">V — VFR</option>' +
      '<option value="Y">Y — IFR→VFR</option>' +
      '<option value="Z">Z — VFR→IFR</option>' +
    '</select></td>' +
    '<td><input class="fp-cell" type="text" name="trueAirspeed" maxlength="6" placeholder="450" autocomplete="off"></td>' +
    '<td><input class="fp-cell fp-upper" type="text" name="departure" maxlength="4" placeholder="ICAO" autocomplete="off"></td>' +
    '<td><input class="fp-cell" type="text" name="departureTime" maxlength="4" placeholder="0600" autocomplete="off"></td>' +
    '<td><input class="fp-cell" type="text" name="altitude" maxlength="6" placeholder="FL200" autocomplete="off"></td>' +
    '<td><textarea class="fp-cell" name="route" rows="2" maxlength="500" placeholder="Route of flight..."></textarea></td>' +
    '<td><input class="fp-cell fp-upper" type="text" name="destination" maxlength="4" placeholder="ICAO" autocomplete="off"></td>' +
    '<td><input class="fp-cell" type="text" name="ete" maxlength="5" placeholder="1+30" autocomplete="off"></td>' +
    '<td><button class="fp-del-btn" onclick="fpRemoveLeg(' + id + ')" title="Remove leg">&times;</button></td>';
  tbody.appendChild(tr);
}

function fpRemoveLeg(id) {
  var row = document.getElementById('fpLeg-' + id);
  if (row) row.remove();
}

/* ════════════════════════════════════════════════════════════
   CREW MANAGEMENT
════════════════════════════════════════════════════════════ */
var fpCrewCounter = 0;

var FP_DUTY_POSITIONS = [
  'PILOT IN COMMAND', 'CP', 'CE', 'TO', 'N', 'CDR', 'PASSENGER', 'OTHER'
];

function fpAddCrew() {
  fpCrewCounter++;
  var id    = fpCrewCounter;
  var tbody = document.getElementById('fpCrewTbody');
  var tr    = document.createElement('tr');
  tr.id = 'fpCrew-' + id;
  var dutyOpts = FP_DUTY_POSITIONS.map(function(p) {
    return '<option value="' + p + '">' + p + '</option>';
  }).join('');
  tr.innerHTML =
    '<td><select class="fp-cell" name="dutyPosition">' + dutyOpts + '</select></td>' +
    '<td><input class="fp-cell fp-upper" type="text" name="nameInitials" maxlength="32" placeholder="SMITH, J.R." autocomplete="off"></td>' +
    '<td><input class="fp-cell fp-upper" type="text" name="rank" maxlength="8" placeholder="CPT" autocomplete="off"></td>' +
    '<td><input class="fp-cell" type="text" name="memberId" maxlength="32" placeholder="###-##-####" autocomplete="off"></td>' +
    '<td><input class="fp-cell fp-upper" type="text" name="orgStation" maxlength="64" placeholder="VIPER SQDN / UGKO" autocomplete="off"></td>' +
    '<td><button class="fp-del-btn" onclick="fpRemoveCrew(' + id + ')" title="Remove row">&times;</button></td>';
  tbody.appendChild(tr);
}

function fpRemoveCrew(id) {
  var row = document.getElementById('fpCrew-' + id);
  if (row) row.remove();
}

/* ════════════════════════════════════════════════════════════
   COLLECT FORM DATA
════════════════════════════════════════════════════════════ */
function fpCollect() {
  var errors = [];

  var date         = document.getElementById('fpDate').value.trim();
  var callSign     = document.getElementById('fpCallSign').value.trim().toUpperCase();
  var aircraftDesig = document.getElementById('fpAircraftDesig').value.trim().toUpperCase();
  var authority    = document.getElementById('fpAuthority').value.trim().toUpperCase();

  if (!date)         errors.push('Date (Field 1) is required.');
  if (!callSign)     errors.push('Aircraft Call Sign (Field 2) is required.');
  if (!aircraftDesig) errors.push('Aircraft Designation (Field 3) is required.');

  var legs = [];
  document.querySelectorAll('#fpLegsTbody tr').forEach(function(tr) {
    legs.push({
      flightRules:   (tr.querySelector('[name=flightRules]').value || 'I'),
      trueAirspeed:  tr.querySelector('[name=trueAirspeed]').value.trim(),
      departure:     tr.querySelector('[name=departure]').value.trim().toUpperCase(),
      departureTime: tr.querySelector('[name=departureTime]').value.trim(),
      altitude:      tr.querySelector('[name=altitude]').value.trim().toUpperCase(),
      route:         tr.querySelector('[name=route]').value.trim().toUpperCase(),
      destination:   tr.querySelector('[name=destination]').value.trim().toUpperCase(),
      ete:           tr.querySelector('[name=ete]').value.trim(),
    });
  });
  if (!legs.length) errors.push('At least one route leg is required.');

  var crew = [];
  document.querySelectorAll('#fpCrewTbody tr').forEach(function(tr) {
    crew.push({
      dutyPosition: tr.querySelector('[name=dutyPosition]').value.trim().toUpperCase(),
      nameInitials: tr.querySelector('[name=nameInitials]').value.trim().toUpperCase(),
      rank:         tr.querySelector('[name=rank]').value.trim().toUpperCase(),
      memberId:     tr.querySelector('[name=memberId]').value.trim(),
      orgStation:   tr.querySelector('[name=orgStation]').value.trim().toUpperCase(),
    });
  });

  var data = {
    date:          date,
    callSign:      callSign,
    aircraftDesig: aircraftDesig,
    authority:     authority,
    legs:          legs,
    remarks:       document.getElementById('fpRemarks').value.trim(),
    rankHonorCode: document.getElementById('fpRankHonor').value.trim().toUpperCase(),
    fuelOnBoard:   document.getElementById('fpFuel').value.trim(),
    alternateAirfield: document.getElementById('fpAlternate').value.trim().toUpperCase(),
    eteToAlternate: document.getElementById('fpEteAltn').value.trim(),
    notamsChecked: document.getElementById('fpNotams').checked,
    weatherBrief:  document.getElementById('fpWeather').value.trim().toUpperCase(),
    weightBalance: document.getElementById('fpWtBal').value.trim().toUpperCase(),
    aircraftSerial: document.getElementById('fpAcSerial').value.trim().toUpperCase(),
    crew:          crew,
  };

  return { data: data, errors: errors };
}

/* ════════════════════════════════════════════════════════════
   SUBMIT
════════════════════════════════════════════════════════════ */
function fpSubmit() {
  var errEl  = document.getElementById('fpError');
  var okEl   = document.getElementById('fpSuccess');
  var btn    = document.getElementById('fpSubmitBtn');

  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  var result = fpCollect();
  if (result.errors.length) {
    errEl.textContent   = result.errors.join(' ');
    errEl.style.display = '';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'SUBMITTING...';

  fetch('/api/flight-plans', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + (currentToken || ''),
    },
    body: JSON.stringify(result.data),
  })
  .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
  .then(function(res) {
    btn.disabled    = false;
    btn.textContent = 'SUBMIT FLIGHT PLAN';
    if (!res.ok) {
      errEl.textContent   = res.body.error || 'Submission failed.';
      errEl.style.display = '';
      return;
    }
    okEl.textContent   = 'Flight plan FP-' + res.body.id + ' submitted successfully.';
    okEl.style.display = '';
    fpLoadPlans();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  })
  .catch(function() {
    btn.disabled    = false;
    btn.textContent = 'SUBMIT FLIGHT PLAN';
    errEl.textContent   = 'Network error — please try again.';
    errEl.style.display = '';
  });
}

/* ════════════════════════════════════════════════════════════
   LOAD & RENDER SUBMITTED PLANS
════════════════════════════════════════════════════════════ */
var fpAllPlans = [];

function fpLoadPlans() {
  fetch('/api/flight-plans', {
    headers: { 'Authorization': 'Bearer ' + (currentToken || '') },
  })
  .then(function(r) { return r.json(); })
  .then(function(plans) {
    fpAllPlans = Array.isArray(plans) ? plans : [];
    fpRenderPlans();
  })
  .catch(function() { /* silently fail — not critical */ });
}

function fpRenderPlans() {
  var el = document.getElementById('fpPlansList');
  if (!el) return;
  if (!fpAllPlans.length) {
    el.innerHTML = '<div class="fp-plans-empty">No flight plans submitted yet.</div>';
    return;
  }
  var sorted = fpAllPlans.slice().sort(function(a, b) {
    return new Date(b.submittedAt) - new Date(a.submittedAt);
  });
  el.innerHTML = sorted.map(function(p) {
    var firstLeg = p.legs && p.legs[0];
    var lastLeg  = p.legs && p.legs[p.legs.length - 1];
    var route    = firstLeg ? (firstLeg.departure + ' &rarr; ' + lastLeg.destination) : '—';
    var status   = p.status || 'submitted';
    var dt       = p.submittedAt ? new Date(p.submittedAt) : null;
    var dateStr  = dt ? (dt.toISOString().slice(0,10)) : '—';
    return '<div class="fp-plan-card" onclick="fpOpenPlan(' + p.id + ')">' +
      '<div class="fp-plan-meta">' +
        '<div class="fp-plan-id">FP-' + p.id + ' &middot; ' + dateStr + ' Z</div>' +
        '<div class="fp-plan-callsign">' + esc(p.callSign || '—') + '</div>' +
        '<div class="fp-plan-route">' + route + '</div>' +
      '</div>' +
      '<span class="fp-plan-status fp-plan-status--' + esc(status) + '">' + esc(status.toUpperCase()) + '</span>' +
    '</div>';
  }).join('');
}

/* ════════════════════════════════════════════════════════════
   PLAN DETAIL
════════════════════════════════════════════════════════════ */
function fpOpenPlan(id) {
  var plan = fpAllPlans.find(function(p) { return p.id === id; });
  if (!plan) return;
  fpShowDetailOverlay(plan);
}

function fpShowDetailOverlay(plan) {
  var overlay = document.createElement('div');
  overlay.className = 'fp-detail-overlay';
  overlay.id = 'fpDetailOverlay';

  var isAdmin = isAdminRole(currentToken);
  overlay.innerHTML =
    '<div class="fp-detail-box">' +
      '<div class="fp-detail-header">' +
        '<div class="fp-detail-title">FLIGHT PLAN — FP-' + plan.id + ' &middot; ' + esc(plan.callSign || '—') + '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<button class="btn btn-ghost" style="font-size:9px;padding:4px 10px" onclick="fpPrintPlan(' + plan.id + ')">PRINT</button>' +
          '<button class="fp-detail-close" onclick="fpCloseDetail()">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div class="fp-detail-body">' +
        fpBuildDetailHTML(plan, isAdmin) +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) fpCloseDetail();
  });
}

function fpCloseDetail() {
  var el = document.getElementById('fpDetailOverlay');
  if (el) el.remove();
}

function fpBuildDetailHTML(plan, isAdmin) {
  var html = '';

  /* Header */
  html +=
    '<div class="fp-detail-section">' +
    '<div class="fp-detail-section-label">DOCUMENT HEADER</div>' +
    '<div class="fp-detail-grid">' +
      fpDvField('1. DATE', plan.date) +
      fpDvField('2. CALL SIGN', plan.callSign) +
      fpDvField('3. AIRCRAFT DESIG', plan.aircraftDesig) +
      fpDvField('AUTHORITY', plan.authority) +
    '</div></div>';

  /* Route legs */
  html += '<div class="fp-detail-section"><div class="fp-detail-section-label">ROUTE OF FLIGHT</div>';
  if (plan.legs && plan.legs.length) {
    html += '<div style="overflow-x:auto"><table class="fp-detail-table">' +
      '<thead><tr>' +
        '<th>4. TYPE</th><th>5. TAS (KT)</th><th>6. DEPARTURE</th>' +
        '<th>7. DEP TIME (Z)</th><th>8. ALT</th><th>9. ROUTE</th>' +
        '<th>10. DEST</th><th>11. ETE</th>' +
      '</tr></thead><tbody>';
    plan.legs.forEach(function(leg) {
      html += '<tr>' +
        '<td>' + esc(leg.flightRules)   + '</td>' +
        '<td>' + esc(leg.trueAirspeed)  + '</td>' +
        '<td>' + esc(leg.departure)     + '</td>' +
        '<td>' + esc(leg.departureTime) + '</td>' +
        '<td>' + esc(leg.altitude)      + '</td>' +
        '<td class="fp-detail-route">' + esc(leg.route) + '</td>' +
        '<td>' + esc(leg.destination)   + '</td>' +
        '<td>' + esc(leg.ete)           + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  } else {
    html += '<div class="fp-plans-empty">No legs recorded.</div>';
  }
  html += '</div>';

  /* Admin data */
  html +=
    '<div class="fp-detail-section">' +
    '<div class="fp-detail-section-label">ADMINISTRATIVE DATA</div>' +
    '<div class="fp-detail-grid">' +
      fpDvField('14. FUEL ON BD', plan.fuelOnBoard) +
      fpDvField('15. ALTN AIRFIELD', plan.alternateAirfield) +
      fpDvField('16. ETE TO ALTN', plan.eteToAlternate) +
      fpDvField('17. NOTAMS', plan.notamsChecked ? 'REVIEWED ✓' : '—') +
      fpDvField('18. WEATHER', plan.weatherBrief) +
      fpDvField('19. WT &amp; BALANCE', plan.weightBalance) +
    '</div>' +
    '<div class="fp-detail-grid" style="margin-top:8px">' +
      fpDvField('20. AIRCRAFT SERIAL / UNIT / STATION', plan.aircraftSerial) +
      fpDvField('13. RANK / HONOR CODE', plan.rankHonorCode) +
    '</div>';
  if (plan.remarks) {
    html += '<div class="fp-dv-field" style="margin-top:8px">' +
      '<div class="fp-dv-label">12. REMARKS</div>' +
      '<div class="fp-dv-val" style="white-space:pre-wrap">' + esc(plan.remarks) + '</div></div>';
  }
  html += '</div>';

  /* Crew manifest */
  if (plan.crew && plan.crew.length) {
    html += '<div class="fp-detail-section"><div class="fp-detail-section-label">CREW / PASSENGER MANIFEST</div>';
    html += '<table class="fp-detail-table"><thead><tr>' +
      '<th>DUTY</th><th>NAME</th><th>RANK</th><th>MEMBER ID</th><th>ORG / STATION</th>' +
    '</tr></thead><tbody>';
    plan.crew.forEach(function(c) {
      html += '<tr>' +
        '<td>' + esc(c.dutyPosition) + '</td>' +
        '<td>' + esc(c.nameInitials) + '</td>' +
        '<td>' + esc(c.rank)         + '</td>' +
        '<td>' + esc(c.memberId)     + '</td>' +
        '<td>' + esc(c.orgStation)   + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }

  /* Base Ops section — admin only */
  if (isAdmin) {
    var bo = plan.baseOps || {};
    html +=
      '<div class="fp-baseops-panel">' +
      '<div class="fp-baseops-label">BASE OPS — RESTRICTED ACCESS</div>' +
      '<div class="fp-panel-body">' +
        '<div class="fp-row">' +
          '<div class="fp-field" style="flex:2">' +
            '<label class="fp-label">21. SIGNATURE OF APPROVAL AUTHORITY</label>' +
            '<input class="fp-input fp-upper" id="bopsSig" type="text" maxlength="64" placeholder="SIGNATURE / NAME" value="' + esc(bo.approvalSignature || '') + '">' +
          '</div>' +
          '<div class="fp-field" style="flex:1">' +
            '<label class="fp-label">23. ACTUAL DEP TIME (Z)</label>' +
            '<input class="fp-input" id="bopsDepTime" type="text" maxlength="4" placeholder="0615" value="' + esc(bo.actualDepartureTime || '') + '">' +
          '</div>' +
          '<div class="fp-field fp-field--check" style="flex:1">' +
            '<label class="fp-label">22. CREW LIST</label>' +
            '<label class="fp-check-label"><input type="checkbox" id="bopsCrewList"' + (bo.crewListAttached ? ' checked' : '') + '> ATTACHED</label>' +
          '</div>' +
        '</div>' +
        '<div class="fp-row" style="justify-content:flex-end;margin-top:12px">' +
          '<button class="btn btn-primary" style="font-size:9px" onclick="fpSaveBaseOps(' + plan.id + ')">SAVE BASE OPS DATA</button>' +
        '</div>' +
      '</div></div>';
  }

  return html;
}

function fpDvField(label, value) {
  return '<div class="fp-dv-field">' +
    '<div class="fp-dv-label">' + label + '</div>' +
    '<div class="fp-dv-val">'   + esc(value || '—') + '</div>' +
  '</div>';
}

/* ════════════════════════════════════════════════════════════
   BASE OPS SAVE
════════════════════════════════════════════════════════════ */
function fpSaveBaseOps(planId) {
  var sig      = document.getElementById('bopsSig').value.trim().toUpperCase();
  var depTime  = document.getElementById('bopsDepTime').value.trim();
  var attached = document.getElementById('bopsCrewList').checked;

  fetch('/api/flight-plans/' + planId + '/baseops', {
    method:  'PATCH',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + (currentToken || ''),
    },
    body: JSON.stringify({
      approvalSignature:   sig,
      actualDepartureTime: depTime,
      crewListAttached:    attached,
    }),
  })
  .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
  .then(function(res) {
    if (!res.ok) { alert(res.body.error || 'Save failed.'); return; }
    /* Update local copy */
    var idx = fpAllPlans.findIndex(function(p) { return p.id === planId; });
    if (idx !== -1) fpAllPlans[idx] = res.body;
    fpCloseDetail();
    fpRenderPlans();
  })
  .catch(function() { alert('Network error — please try again.'); });
}

/* ════════════════════════════════════════════════════════════
   PRINT
════════════════════════════════════════════════════════════ */
function fpPrint() {
  var result = fpCollect();
  var data = result.data;
  /* Build a temporary plan object for printing */
  var plan = {
    id: 'DRAFT',
    submittedAt: new Date().toISOString(),
    baseOps: {},
    status: 'draft',
  };
  Object.assign(plan, data);
  fpRenderPrintView(plan);
  window.print();
}

function fpPrintPlan(id) {
  var plan = fpAllPlans.find(function(p) { return p.id === id; });
  if (!plan) return;
  fpCloseDetail();
  fpRenderPrintView(plan);
  window.print();
}

function fpRenderPrintView(plan) {
  var el = document.getElementById('fpPrintView');
  el.innerHTML = fpBuildPrintHTML(plan);
}

function fpBuildPrintHTML(plan) {
  var bo = plan.baseOps || {};
  var legs = plan.legs || [];
  var crew = plan.crew || [];

  var legsRows = legs.map(function(leg) {
    return '<tr>' +
      '<td>' + esc(leg.flightRules)   + '</td>' +
      '<td>' + esc(leg.trueAirspeed)  + '</td>' +
      '<td>' + esc(leg.departure)     + '</td>' +
      '<td>' + esc(leg.departureTime) + 'Z</td>' +
      '<td>' + esc(leg.altitude)      + '</td>' +
      '<td style="white-space:pre-wrap;max-width:220pt">' + esc(leg.route) + '</td>' +
      '<td>' + esc(leg.destination)   + '</td>' +
      '<td>' + esc(leg.ete)           + '</td>' +
    '</tr>';
  }).join('');

  var crewRows = crew.map(function(c) {
    return '<tr>' +
      '<td>' + esc(c.dutyPosition) + '</td>' +
      '<td>' + esc(c.nameInitials) + '</td>' +
      '<td>' + esc(c.rank)         + '</td>' +
      '<td>' + esc(c.memberId)     + '</td>' +
      '<td>' + esc(c.orgStation)   + '</td>' +
    '</tr>';
  }).join('');

  return '<div class="fp-print">' +
    '<div class="fp-print-form">' +

      /* Title */
      '<div class="fp-print-title-row">DD FORM 175 &mdash; MILITARY FLIGHT PLAN</div>' +
      '<div class="fp-print-sub-row">AUTHORITY: ' + esc(plan.authority || '10 USC 8012 AND EO 9397') + ' &nbsp;&nbsp; PRINCIPAL PURPOSE: TO AID IN ACCURATE IDENTIFICATION OF PERSONNEL</div>' +

      /* Header row */
      '<div class="fp-print-hdr">' +
        '<div class="fp-print-cell"><span class="fp-print-cell-lbl">1. DATE</span><span class="fp-print-cell-val">' + esc(plan.date || '') + '</span></div>' +
        '<div class="fp-print-cell"><span class="fp-print-cell-lbl">2. AIRCRAFT CALL SIGN</span><span class="fp-print-cell-val">' + esc(plan.callSign || '') + '</span></div>' +
        '<div class="fp-print-cell"><span class="fp-print-cell-lbl">3. AIRCRAFT DESG AND TO CODE</span><span class="fp-print-cell-val">' + esc(plan.aircraftDesig || '') + '</span></div>' +
        '<div class="fp-print-cell"><span class="fp-print-cell-lbl">FP ID</span><span class="fp-print-cell-val">FP-' + esc(String(plan.id)) + '</span></div>' +
      '</div>' +

      /* Legs table */
      '<table class="fp-print-legs-tbl">' +
        '<thead><tr>' +
          '<th>4. TYPE FLT PLAN</th>' +
          '<th>5. TRUE AIRSPEED (KT)</th>' +
          '<th>6. POINT OF DEPARTURE</th>' +
          '<th>7. PROPOSED DEP TIME (Z)</th>' +
          '<th>8. ALTITUDE</th>' +
          '<th>9. ROUTE OF FLIGHT</th>' +
          '<th>10. TO</th>' +
          '<th>11. ETE</th>' +
        '</tr></thead>' +
        '<tbody>' + (legsRows || '<tr><td colspan="8">&nbsp;</td></tr>') + '</tbody>' +
      '</table>' +

      /* Admin block */
      '<div class="fp-print-admin">' +
        '<div class="fp-print-admin-cell"><b style="font-size:6pt">12. REMARKS</b><br>' + esc(plan.remarks || '') + '</div>' +
        '<div class="fp-print-admin-cell"><b style="font-size:6pt">13. RANK/HONOR CODE</b><br>' + esc(plan.rankHonorCode || '') + '</div>' +
        '<div class="fp-print-admin-cell"><b style="font-size:6pt">14. FUEL ON BD</b><br>' + esc(plan.fuelOnBoard || '') + '</div>' +
        '<div class="fp-print-admin-cell"><b style="font-size:6pt">15. ALTN AIRFIELD</b><br>' + esc(plan.alternateAirfield || '') + '</div>' +
        '<div class="fp-print-admin-cell"><b style="font-size:6pt">16. ETE TO ALTN</b><br>' + esc(plan.eteToAlternate || '') + '</div>' +
      '</div>' +
      '<div class="fp-print-admin">' +
        '<div class="fp-print-admin-cell" style="grid-column:span 2"><b style="font-size:6pt">17. NOTAMS REVIEWED</b> &nbsp; ' + (plan.notamsChecked ? '&#x2713; YES' : '&#x25A1; NO') + '</div>' +
        '<div class="fp-print-admin-cell"><b style="font-size:6pt">18. WEATHER</b><br>' + esc(plan.weatherBrief || '') + '</div>' +
        '<div class="fp-print-admin-cell" style="grid-column:span 2"><b style="font-size:6pt">19. WT AND BALANCE</b><br>' + esc(plan.weightBalance || '') + '</div>' +
      '</div>' +
      '<div class="fp-print-admin-full"><b style="font-size:6pt">20. AIRCRAFT SERIAL NUMBER, UNIT, AND HOME STATION</b>&nbsp;&nbsp;' + esc(plan.aircraftSerial || '') + '</div>' +

      /* Crew table */
      (crewRows ? (
        '<table class="fp-print-crew-tbl">' +
          '<thead><tr><th>24. DUTY</th><th>25. NAME AND INITIALS</th><th>26. RANK</th><th>27. SSN / MEMBER ID</th><th>28. ORGANIZATION AND LOCATION</th></tr></thead>' +
          '<tbody>' + crewRows + '</tbody>' +
        '</table>'
      ) : '') +

      /* Base Ops signature block */
      '<div class="fp-print-baseops">' +
        '<div class="fp-print-baseops-cell">' +
          '<div style="font-size:6pt;margin-bottom:2pt">21. SIGNATURE OF APPROVAL AUTHORITY</div>' +
          '<div class="fp-print-sig-line"></div>' +
          '<div style="font-size:7pt">' + esc(bo.approvalSignature || '') + '</div>' +
        '</div>' +
        '<div class="fp-print-baseops-cell">' +
          '<div style="font-size:6pt;margin-bottom:2pt">23. ACTUAL DEP TIME (Z)</div>' +
          '<div style="font-size:10pt;font-weight:bold">' + esc(bo.actualDepartureTime || '') + '</div>' +
        '</div>' +
        '<div class="fp-print-baseops-cell">' +
          '<div style="font-size:6pt;margin-bottom:4pt">22. CREW/PASSENGER LIST</div>' +
          '<div style="font-size:8pt">' + (bo.crewListAttached ? '&#x2713; ATTACHED' : '&#x25A1; ATTACHED') + '</div>' +
        '</div>' +
      '</div>' +

    '</div></div>';
}

/* ════════════════════════════════════════════════════════════
   UTILITY
════════════════════════════════════════════════════════════ */
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
