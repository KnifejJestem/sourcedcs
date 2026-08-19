import { FT_TO_M, M_TO_FT, KTS_TO_MS, M_TO_NM } from './constants.js';
import { app, state, reduceMotion, declutter } from './state.js';
import { el } from './dom.js';
import { motorThrust } from './missile-physics.js';
import { parseWeaponFile, missileFromJson } from './weapon-extract.js';
import { runEngagement } from './engagement.js';
import { render, pxSide, cvSide } from './scope-render.js';
import { PHASES, acftState, renderAcftPanel } from './panel.js';

// Both aircraft panels are generated from the same schema (see panel.js) --
// this has to run before any of the wiring below, since it's what creates
// the elements wirePhaseFields() etc. are about to look up by id.
el('acftPanels').innerHTML = renderAcftPanel('s') + renderAcftPanel('t');

// The friendly-hostile start separation is a property of the engagement,
// not of either aircraft's own table, so unlike every other field it's
// static markup in index.html rather than schema-generated -- its initial
// value still has to come from state rather than being hardcoded twice.
el('t_start_rng').value = state.target.rng0;

/* ---------------- built-in weapon ---------------- */

// The built-in AIM-120C lives in data/weapons/aim-120c.json rather than as a
// JS constant, so the sample weapon data is easy to find and edit without
// touching the simulator code. missileFromJson() (weapon-extract.js) does
// the JSON -> missile-object conversion, shared with the headless examples.
let builtinWeapon = null;

async function loadBuiltinWeapon() {
  const res = await fetch('data/weapons/aim-120c.json');
  return missileFromJson(await res.json());
}

/* ---------------- weapon plumbing ---------------- */

function refreshWeaponSelect() {
  for (const sel of [el('weaponSel'), el('returnFireWeaponSel')]) {
    const keep = sel.value;
    sel.innerHTML = '';
    app.weapons.forEach((m, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = m.name;
      sel.appendChild(o);
    });
    sel.value = keep && Number(keep) < app.weapons.length ? keep : String(app.weapons.indexOf(app.missile));
  }
}

function renderReport() {
  const missile = app.missile;
  el('loadedName').textContent = missile.name;
  const kv = el('reportKv');
  const nm = (v, d) => v === null || v === undefined ? '—' : v.toFixed(d === undefined ? 2 : d);
  const rows = [
    ['class', missile.className || '—'],
    ['mass', nm(missile.mass) + ' kg'],
    ['ref area', nm(missile.sRef, 4) + ' m²'],
    ['Cx0 entries', missile.cx0.length + ' @ ' + missile.machStep + ' Mach'],
    ['Mach_max', nm(missile.machMax, 2)],
    ['burn time', nm(missile.burnTime) + ' s'],
    ['fuel', nm(missile.fuel) + ' kg'],
    ['thrust (' + (motorThrust(missile), missile.__thrustSource === 'isp' ? 'from Isp' : missile.__thrustSource === 'mach_max_calibrated' ? 'Mach_max fallback' : 'none') + ')', Math.round(motorThrust(missile)).toLocaleString() + ' N'],
    ['v_min', nm(missile.vMin, 0) + ' m/s'],
    ['Life_Time', nm(missile.lifeTime, 0) + ' s'],
    ['loft angle', missile.loftOffRange === null ? 'no loft' : nm(missile.loftAngle * 180 / Math.PI, 1) + '°'],
    ['loft off', missile.loftOffRange === null ? '—' : (missile.loftOffRange / 1000).toFixed(1) + ' km'],
    ['g limit', nm(missile.gLoad, 0) + ' g'],
    ['Tc', nm(missile.tc, 3) + ' s'],
    ['Knav', nm(missile.knav, 1)],
    ['fuze radius', nm(missile.killRadius, 0) + ' m'],
    ['D_max', missile.seekerActive === null ? '—' : (missile.seekerActive / 1000).toFixed(1) + ' km'],
    ['sens_far_dist', missile.seekerFar === null ? '—' : (missile.seekerFar / 1000).toFixed(1) + ' km'],
    ['seeker delay', nm(missile.seekerDelay, 2) + ' s'],
    ['Range_max field', missile.rangeMaxField === null ? '—' : (missile.rangeMaxField / 1852).toFixed(1) + ' nm']
  ];
  kv.innerHTML = rows.map((r) =>
    '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('');

  const msgs = el('reportMsgs');
  msgs.innerHTML =
    (missile.warnings || []).map((w) => '<p class="msg">' + w + '</p>').join('') +
    (missile.notes || []).map((w) => '<p class="msg note">' + w + '</p>').join('');
}

function setMissile(m) {
  app.missile = m;
  state.result = null;
  refreshWeaponSelect();
  renderReport();
  syncLabels();
  fire();
}

function loadLuaSource(src, originLabel) {
  const box = el('parseMsgs');
  let found;
  try {
    found = parseWeaponFile(src);
  } catch (e) {
    box.innerHTML = '<p class="msg err">Could not read that file: ' + e.message + '</p>';
    return;
  }
  const usable = [], rejected = [];
  for (const f of found) {
    if (f.missile.error) rejected.push(f.label + ' — ' + f.missile.error);
    else usable.push(f.missile);
  }
  if (!usable.length) {
    box.innerHTML = '<p class="msg err">No simulatable weapon found in ' + originLabel +
      '. A weapon needs at least a mass, <code>fm.S</code> and an <code>fm.Cx0</code> drag table.</p>' +
      rejected.map((r) => '<p class="msg note">' + r + '</p>').join('');
    return;
  }
  for (const m of usable) {
    const dup = app.weapons.findIndex((w) => w.name === m.name && w !== builtinWeapon);
    if (dup >= 0) app.weapons.splice(dup, 1, m); else app.weapons.push(m);
  }
  box.innerHTML = '<p class="msg note">Loaded ' + usable.length + ' weapon' +
    (usable.length === 1 ? '' : 's') + ' from ' + originLabel + '.</p>' +
    rejected.map((r) => '<p class="msg note">Skipped ' + r + '</p>').join('');
  setMissile(usable[0]);
}

el('weaponSel').addEventListener('change', (e) => setMissile(app.weapons[parseInt(e.target.value, 10)]));
el('returnFireWeaponSel').addEventListener('change', (e) => {
  state.returnFireWeaponIdx = parseInt(e.target.value, 10);
  fire();
});

el('luaFile').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => loadLuaSource(String(fr.result), f.name);
  fr.onerror = () => {
    el('parseMsgs').innerHTML = '<p class="msg err">The file could not be read.</p>';
  };
  fr.readAsText(f);
  e.target.value = '';
});

el('pasteToggle').addEventListener('click', (e) => {
  const box = el('pasteBox');
  const open = box.hidden;
  box.hidden = !open;
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
el('parsePaste').addEventListener('click', () => {
  const txt = el('luaText').value.trim();
  if (!txt) {
    el('parseMsgs').innerHTML = '<p class="msg err">Paste a weapon table first.</p>';
    return;
  }
  loadLuaSource(txt, 'pasted text');
});

/* ---------------- phase field wiring ---------------- */

// PHASES (see panel.js) is the single schema both the markup and this
// wiring are generated from -- no second, hand-synced description here.
function wirePhaseFields(acftKey) {
  const acft = acftState(acftKey);
  for (const phase of PHASES) {
    const phaseObj = acft[phase.name];
    for (const f of phase.fields) {
      el(acftKey + '_' + phase.name + '_' + f.suffix).addEventListener('input', (e) => {
        phaseObj[f.key] = parseFloat(e.target.value);
        state.result = null;
        fire();
      });
    }
  }
}
wirePhaseFields('s');
wirePhaseFields('t');

function wireEnableCheckbox(id, phaseObj) {
  el(id).addEventListener('change', (e) => {
    phaseObj.enabled = e.target.checked;
    state.result = null;
    syncLabels(); fire();
  });
}
wireEnableCheckbox('s_crank_enabled', state.shooter.crank);
wireEnableCheckbox('s_out_enabled', state.shooter.out);
wireEnableCheckbox('t_crank_enabled', state.target.crank);
wireEnableCheckbox('t_out_enabled', state.target.out);

function wireTriggerTypeSeg(segId, phaseObj, rangeFieldId) {
  const seg = el(segId);
  seg.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      phaseObj.triggerType = btn.dataset.val;
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      el(rangeFieldId).hidden = btn.dataset.val !== 'range';
      state.result = null;
      syncLabels(); fire();
    });
  });
}
wireTriggerTypeSeg('s_out_triggerTypeSeg', state.shooter.out, 's_out_triggerRangeField');
wireTriggerTypeSeg('t_out_triggerTypeSeg', state.target.out, 't_out_triggerRangeField');
wireTriggerTypeSeg('s_crank_triggerTypeSeg', state.shooter.crank, 's_crank_triggerRangeField');
wireTriggerTypeSeg('t_crank_triggerTypeSeg', state.target.crank, 't_crank_triggerRangeField');

el('s_out_triggerRange').addEventListener('input', (e) => {
  state.shooter.out.triggerRange = parseFloat(e.target.value);
  state.result = null; fire();
});
el('t_out_triggerRange').addEventListener('input', (e) => {
  state.target.out.triggerRange = parseFloat(e.target.value);
  state.result = null; fire();
});
el('s_crank_triggerRange').addEventListener('input', (e) => {
  state.shooter.crank.triggerRange = parseFloat(e.target.value);
  state.result = null; fire();
});
el('t_crank_triggerRange').addEventListener('input', (e) => {
  state.target.crank.triggerRange = parseFloat(e.target.value);
  state.result = null; fire();
});

/* ---------------- presets ---------------- */

// A preset is a deep clone of one aircraft's full state (Start + all four
// phases), plus which weapon that side fires -- Friendly's is the loaded
// weapon (app.missile), Hostile's is its return-fire selection. The model
// is symmetric, so a shooter preset applies cleanly to the target and vice
// versa -- the one asymmetry (rng0 only exists on the target) just doesn't
// get touched when it's not there to touch.
function serializeAcft(acftKey) {
  const data = JSON.parse(JSON.stringify(acftState(acftKey)));
  const weapon = acftKey === 's' ? app.missile : app.weapons[state.returnFireWeaponIdx];
  data.weaponName = weapon ? weapon.name : null;
  return data;
}

// Mutates the aircraft's existing phase objects IN PLACE rather than
// replacing them -- wirePhaseFields()'s listeners closed over those exact
// object references when the page loaded, so swapping in a new object
// (e.g. `acft.intercept = data.intercept`) would leave them mutating an
// orphaned copy nobody reads from again. Object.assign onto the existing
// object preserves identity while still fully overwriting its fields.
// A weapon saved under a name that isn't currently loaded (e.g. a preset
// made with a .lua file this session hasn't loaded) is silently skipped --
// there's nothing to switch to, so the current weapon just stays put.
function applyPresetToAircraft(acftKey, data) {
  const acft = acftState(acftKey);
  if (typeof data.alt0 === 'number') acft.alt0 = data.alt0;
  if (typeof data.spd0 === 'number') acft.spd0 = data.spd0;
  if (acftKey === 't' && typeof data.rng0 === 'number') acft.rng0 = data.rng0;
  for (const phase of PHASES) {
    if (data[phase.name] && typeof data[phase.name] === 'object') Object.assign(acft[phase.name], data[phase.name]);
  }
  if (typeof data.weaponName === 'string') {
    const idx = app.weapons.findIndex((w) => w.name === data.weaponName);
    if (idx >= 0) {
      if (acftKey === 's') setMissile(app.weapons[idx]);
      else { state.returnFireWeaponIdx = idx; el('returnFireWeaponSel').value = String(idx); }
    }
  }
}

// Pushes current state back into every input's displayed value -- needed
// because, until presets existed, state only ever changed via direct
// interaction with the very input that displays it (which updates itself
// as a side effect of being dragged/typed into). Loading a preset changes
// state programmatically, so the inputs need an explicit refresh.
function refreshInputsFromState(acftKey) {
  const acft = acftState(acftKey);
  if (acftKey === 's') {
    el('s_start_alt').value = acft.alt0;
    el('s_start_spd').value = acft.spd0;
  } else {
    el('t_start_rng').value = acft.rng0;
    el('t_start_alt').value = acft.alt0;
    el('t_start_spd').value = acft.spd0;
  }
  for (const phase of PHASES) {
    const phaseObj = acft[phase.name];
    for (const f of phase.fields) {
      el(acftKey + '_' + phase.name + '_' + f.suffix).value = phaseObj[f.key];
    }
  }
  el(acftKey + '_crank_enabled').checked = acft.crank.enabled;
  el(acftKey + '_out_enabled').checked = acft.out.enabled;
  syncTriggerFields(acftKey, 'crank', acft.crank);
  syncTriggerFields(acftKey, 'out', acft.out);

  state.result = null;
  syncLabels(); fire();
}

// Pushes a maneuver's trigger config (type + range value) back into its
// row's controls -- shared by Crank and Out, both preset-load callers.
function syncTriggerFields(acftKey, phaseName, cfg) {
  const id = acftKey + '_' + phaseName;
  el(id + '_triggerRange').value = cfg.triggerRange;
  el(id + '_triggerTypeSeg').querySelectorAll('button')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === cfg.triggerType)));
}

async function fetchPresetList() {
  const res = await fetch('/api/presets');
  return res.ok ? res.json() : [];
}
async function fetchPreset(name) {
  const res = await fetch('/api/presets/' + encodeURIComponent(name));
  if (!res.ok) throw new Error('preset not found');
  return res.json();
}
async function savePresetToServer(name, data) {
  const res = await fetch('/api/presets/' + encodeURIComponent(name), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('save failed (' + res.status + ')');
}
async function deletePresetFromServer(name) {
  await fetch('/api/presets/' + encodeURIComponent(name), { method: 'DELETE' });
}

async function refreshPresetDropdown() {
  const names = await fetchPresetList();
  const sel = el('presetLoadSel');
  const keep = sel.value;
  sel.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = 'Load preset…';
  sel.appendChild(placeholder);
  names.forEach((n) => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    sel.appendChild(o);
  });
  sel.value = names.includes(keep) ? keep : '';
}

el('presetSaveBtn').addEventListener('click', async () => {
  const acftKey = el('presetAcftSel').value;
  const label = acftKey === 's' ? 'friendly' : 'hostile';
  const name = window.prompt('Save ' + label + '’s current settings as a preset named:');
  if (!name) return;
  try {
    await savePresetToServer(name, serializeAcft(acftKey));
    el('presetMsgs').innerHTML = '<p class="msg note">Saved “' + name + '” from the ' + label + '.</p>';
    await refreshPresetDropdown();
    el('presetLoadSel').value = name;
  } catch (e) {
    el('presetMsgs').innerHTML = '<p class="msg err">Could not save: ' + e.message + '</p>';
  }
});

// Picking a preset from the dropdown only selects it -- it doesn't touch
// the aircraft until Apply is clicked, so browsing presets (or fat-fingering
// the dropdown) can never silently overwrite the current setup.
el('presetApplyBtn').addEventListener('click', async () => {
  const name = el('presetLoadSel').value;
  if (!name) return;
  const acftKey = el('presetAcftSel').value;
  try {
    const data = await fetchPreset(name);
    applyPresetToAircraft(acftKey, data);
    refreshInputsFromState(acftKey);
    el('presetMsgs').innerHTML = '<p class="msg note">Loaded “' + name + '” onto the ' + (acftKey === 's' ? 'friendly' : 'hostile') + '.</p>';
  } catch (err) {
    el('presetMsgs').innerHTML = '<p class="msg err">Could not load: ' + err.message + '</p>';
  }
});

el('presetDeleteBtn').addEventListener('click', async () => {
  const name = el('presetLoadSel').value;
  if (!name) return;
  if (!window.confirm('Delete preset “' + name + '”?')) return;
  await deletePresetFromServer(name);
  el('presetMsgs').innerHTML = '<p class="msg note">Deleted “' + name + '”.</p>';
  await refreshPresetDropdown();
});

/* ---------------- Start fields ---------------- */

el('s_start_alt').addEventListener('input', (e) => {
  state.shooter.alt0 = parseFloat(e.target.value);
  state.result = null; fire();
});
el('s_start_spd').addEventListener('input', (e) => {
  state.shooter.spd0 = parseFloat(e.target.value);
  state.result = null; fire();
});
el('t_start_rng').addEventListener('input', (e) => {
  state.target.rng0 = parseFloat(e.target.value);
  state.result = null; fire();
});
el('t_start_alt').addEventListener('input', (e) => {
  state.target.alt0 = parseFloat(e.target.value);
  state.result = null; fire();
});
el('t_start_spd').addEventListener('input', (e) => {
  state.target.spd0 = parseFloat(e.target.value);
  state.result = null; fire();
});

/* ---------------- interaction (drag on the side view) ---------------- */
let drag = null;
function hitTest(mx, my) {
  const p = pxSide(cvSide.getBoundingClientRect().width, parseFloat(cvSide.style.height));
  const cands = [
    { id: 's', x: p.X(0), y: p.Y(state.shooter.alt0 * FT_TO_M) },
    { id: 't', x: p.X(state.target.rng0 * 1852), y: p.Y(state.target.alt0 * FT_TO_M) }
  ];
  for (const c of cands) if (Math.hypot(mx - c.x, my - c.y) < 22) return c.id;
  return null;
}
cvSide.addEventListener('pointerdown', (e) => {
  const r = cvSide.getBoundingClientRect();
  const id = hitTest(e.clientX - r.left, e.clientY - r.top);
  if (!id) return;
  drag = id;
  cvSide.classList.add('dragging');
  cvSide.setPointerCapture(e.pointerId);
});
cvSide.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const r = cvSide.getBoundingClientRect();
  const p = pxSide(r.width, parseFloat(cvSide.style.height));
  const altFt = Math.round(Math.max(1000, Math.min(55000, p.invY(e.clientY - r.top) * M_TO_FT)) / 100) * 100;
  if (drag === 's') { state.shooter.alt0 = altFt; el('s_start_alt').value = altFt; }
  else {
    state.target.alt0 = altFt; el('t_start_alt').value = altFt;
    const nm = Math.max(1, Math.min(70, Math.round(p.invX(e.clientX - r.left) * M_TO_NM * 10) / 10));
    state.target.rng0 = nm; el('t_start_rng').value = nm;
  }
  state.result = null;
  render();
});
['pointerup', 'pointercancel'].forEach((ev) =>
  cvSide.addEventListener(ev, () => { drag = null; cvSide.classList.remove('dragging'); }));

el('shooterFireEnabled').addEventListener('change', (e) => {
  state.shooterFireEnabled = e.target.checked;
  el('shooterFireTrigRange').disabled = !state.shooterFireEnabled;
  state.result = null;
  syncLabels(); fire();
});
el('shooterFireTrigRange').addEventListener('input', (e) => {
  state.shooterFireTrigRange = parseFloat(e.target.value);
  state.result = null; fire();
});
el('returnFireEnabled').addEventListener('change', (e) => {
  state.returnFireEnabled = e.target.checked;
  el('returnFireWeaponSel').disabled = !state.returnFireEnabled;
  el('returnFireTrigRange').disabled = !state.returnFireEnabled;
  el('readoutB').hidden = !state.returnFireEnabled;
  state.result = null;
  syncLabels(); fire();
});
el('returnFireTrigRange').addEventListener('input', (e) => {
  state.returnFireTrigRange = parseFloat(e.target.value);
  state.result = null; fire();
});

/* ---------------- label sync ---------------- */

// Every numeric field displays its own value directly (they're all plain
// number inputs), so this only has to sync the state that isn't reflected
// by the field the user just touched: which rows are enabled, which
// trigger-range field is visible, and the hints that depend on more than
// one toggle.
function setPhaseRowEnabled(acftKey, phaseName, enabled) {
  const phase = PHASES.find((p) => p.name === phaseName);
  for (const f of phase.fields) {
    el(acftKey + '_' + phaseName + '_' + f.suffix).disabled = !enabled;
  }
}

function syncLabels() {
  setPhaseRowEnabled('s', 'crank', state.shooter.crank.enabled);
  setPhaseRowEnabled('s', 'out', state.shooter.out.enabled);
  setPhaseRowEnabled('s', 'cold', state.shooter.out.enabled);
  setPhaseRowEnabled('t', 'crank', state.target.crank.enabled);
  setPhaseRowEnabled('t', 'out', state.target.out.enabled);
  setPhaseRowEnabled('t', 'cold', state.target.out.enabled);

  // A maneuver's trigger row is only useful once the maneuver itself is on.
  el('s_crank_triggerRow').hidden = !state.shooter.crank.enabled;
  el('t_crank_triggerRow').hidden = !state.target.crank.enabled;
  el('s_out_triggerRow').hidden = !state.shooter.out.enabled;
  el('t_out_triggerRow').hidden = !state.target.out.enabled;

  el('s_crank_triggerRangeField').hidden = state.shooter.crank.triggerType !== 'range';
  el('t_crank_triggerRangeField').hidden = state.target.crank.triggerType !== 'range';
  el('s_out_triggerRangeField').hidden = state.shooter.out.triggerType !== 'range';
  el('t_out_triggerRangeField').hidden = state.target.out.triggerType !== 'range';
}

/* ---------------- engagement building ---------------- */

function applyResultToUI(res, missile, suffix) {
  const s = res.summary;
  const tag = el('tag' + suffix);
  tag.textContent = s.hit ? 'Intercept' : 'Miss';
  tag.className = 'tag ' + (s.hit ? 'hit' : 'miss');
  let why = s.hit
    ? 'Fuzed inside ' + missile.killRadius + ' m at ' + (s.interceptSlant * M_TO_NM).toFixed(1) + ' nm from the launch point.'
    : 'No intercept — ' + s.reason + '. Closest approach ' +
      (s.minSlant > 1000 ? (s.minSlant / 1000).toFixed(1) + ' km' : Math.round(s.minSlant) + ' m') + '.';
  el('why' + suffix).textContent = why;

  const unit = (v, u) => v + '<span class="u">' + u + '</span>';
  el('oTof' + suffix).innerHTML = unit(s.t.toFixed(1), ' s');
  el('oClosure' + suffix).innerHTML = unit(Math.round(s.closure / KTS_TO_MS), ' kt');
  el('oIcpt' + suffix).innerHTML = s.hit ? unit((s.interceptSlant * M_TO_NM).toFixed(1), ' nm') : '—';
  el('oMiss' + suffix).innerHTML = s.minSlant > 1000
    ? unit((s.minSlant / 1000).toFixed(1), ' km') : unit(Math.round(s.minSlant), ' m');
  el('oApogee' + suffix).innerHTML = unit((s.apogee * M_TO_FT / 1000).toFixed(1), 'k ft');
  el('oTerm' + suffix).innerHTML = 'M' + s.finalMach.toFixed(2) +
    '<span class="u"> ' + Math.round(s.finalSpeed) + ' m/s</span>';

  const ev = s.seekerActiveEvent;
  el('oActive' + suffix).innerHTML = ev ? unit('T+' + ev.t.toFixed(1), ' s') : '—';
  el('oShooterTgt' + suffix).innerHTML = ev ? unit((ev.firerTgtRange * M_TO_NM).toFixed(1), ' nm') : '—';
  el('oSupport' + suffix).innerHTML = ev && s.hit
    ? unit(Math.round(100 * ev.t / s.t), '% of TOF') : '—';
}

// Thin adapter: gathers the two aircraft configs, the two weapons, and the
// fire-control settings out of `state`/`app` and hands them to
// engagement.js's runEngagement(), which knows nothing about either --
// that's what makes it runnable outside a browser. See engagement.js for
// the actual resolution algorithm (staged Crank/Out trigger rebuilds).
function resolveEngagement() {
  const bWeapon = app.weapons[state.returnFireWeaponIdx] || app.missile;
  const engagement = runEngagement({
    shooter: state.shooter, target: state.target,
    missileA: app.missile,
    fireA: { enabled: state.shooterFireEnabled, triggerRange: state.shooterFireTrigRange },
    missileB: bWeapon,
    fireB: { enabled: state.returnFireEnabled, triggerRange: state.returnFireTrigRange }
  });
  return Object.assign(engagement, { bWeapon });
}

// Recomputes and re-renders on every change -- there's no separate "Fire"
// action to trigger it, the scope is always showing the current setup.
function fire() {
  const engagement = resolveEngagement();
  state.aircraftPaths = engagement.paths;
  state.result = engagement.resultA;
  el('readoutA').hidden = !state.shooterFireEnabled;
  if (state.shooterFireEnabled) {
    if (engagement.resultA) {
      applyResultToUI(engagement.resultA, app.missile, '');
    } else {
      el('tag').textContent = '—'; el('tag').className = 'tag miss';
      el('why').textContent = 'Friendly–hostile range never reaches the trigger under this setup.';
    }
  }

  state.resultB = engagement.resultB;
  el('readoutB').hidden = !state.returnFireEnabled;
  if (state.returnFireEnabled) {
    if (engagement.resultB) {
      applyResultToUI(engagement.resultB, engagement.bWeapon, 'B');
    } else {
      el('tagB').textContent = '—'; el('tagB').className = 'tag miss';
      el('whyB').textContent = 'Friendly–hostile range never reaches the trigger under this setup.';
    }
  }

  if (reduceMotion) { state.reveal = 1; render(); return; }
  state.reveal = 0;
  const t0 = performance.now(), dur = 900;
  (function step(now) {
    state.reveal = Math.min(1, (now - t0) / dur);
    render();
    if (state.reveal < 1) requestAnimationFrame(step);
  })(t0);
}

window.addEventListener('resize', render);

// Legend doubles as the scope declutter UI -- each button's data-declutter
// key names a flag on the `declutter` state object (see scope-render.js for
// where each one gates a draw call). Session-only, so a reload always comes
// back with everything visible.
el('legend').querySelectorAll('.legend-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.declutter;
    declutter[key] = !declutter[key];
    btn.setAttribute('aria-pressed', String(declutter[key]));
    render();
  });
});

/* ---------------- init ---------------- */
(async function init() {
  refreshPresetDropdown();

  builtinWeapon = await loadBuiltinWeapon();
  app.weapons.push(builtinWeapon);
  app.missile = builtinWeapon;

  refreshWeaponSelect();
  renderReport();
  syncLabels();
  render();
  fire();
})();
