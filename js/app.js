// ═══════════════════════════════════════════════════════════
// app.js — State, routing, shared utilities
// ═══════════════════════════════════════════════════════════

'use strict';

// ── State ────────────────────────────────────────────────────
const STATE = {
  pkg:          null,   // loaded package object {ato, aco, spins, comms}
  selectedIdx:  -1,
  currentTab:   'ato',
  theme:        'pro',
};

// ── Shared helpers ───────────────────────────────────────────
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function toMins(v) {
  if (!v) return null;
  const s = String(v).replace('Z', '').padStart(4, '0');
  return parseInt(s.slice(0, 2)) * 60 + parseInt(s.slice(2, 4));
}

function fmtZ(v) {
  if (!v) return '—';
  return String(v).replace('Z', '').padStart(4, '0') + 'Z';
}

const KNOWN_TYPES = ['CAP', 'BAI', 'CAS', 'SEAD', 'STRIKE'];
function typeKey(t) {
  return KNOWN_TYPES.includes((t || '').toUpperCase()) ? t.toUpperCase() : 'OTHER';
}

const TYPE_COLORS_PRO = {
  CAP: '#1a5c2e', BAI: '#7c3500', CAS: '#003d6b',
  SEAD: '#4a1a6b', STRIKE: '#6b0f1a', OTHER: '#3d3400',
};
const TYPE_COLORS_MFD = {
  CAP: '#39ff7a', BAI: '#ff8c00', CAS: '#4fc3f7',
  SEAD: '#c084fc', STRIKE: '#ff4444', OTHER: '#ffb020',
};
function typeColor(t) {
  return (STATE.theme === 'movie' ? TYPE_COLORS_MFD : TYPE_COLORS_PRO)[typeKey(t)];
}

// ── Theme ────────────────────────────────────────────────────
function setTheme(t) {
  STATE.theme = t;
  const root = document.documentElement;
  if (t === 'movie') {
    root.classList.add('movie');
  } else {
    root.classList.remove('movie');
  }
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === t);
  });
  // Re-render views that use theme-dependent colors
  if (STATE.pkg) {
    if (STATE.pkg.ato) {
      renderATO(STATE.pkg.ato);
      renderMAP(STATE.pkg.ato);
    }
  }
}

// ── Tab routing ───────────────────────────────────────────────
function showTab(name) {
  STATE.currentTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === 'view-' + name);
  });
}

// ── Package loading ───────────────────────────────────────────
function loadPackage(yamlText) {
  let data;
  try {
    data = jsyaml.load(yamlText);
  } catch (e) {
    alert('YAML parse error: ' + e.message);
    return;
  }
  loadPackage_obj(data);
}

function loadPackage_obj(data) {
  // Accept a full package {ato, aco, spins, comms} — any subset is fine
  const pkg = {};
  if (data.ato)   pkg.ato   = data.ato;
  if (data.aco)   pkg.aco   = data.aco;
  if (data.spins) pkg.spins = data.spins;
  if (data.comms) pkg.comms = data.comms;

  if (!pkg.ato && !pkg.aco && !pkg.spins && !pkg.comms) {
    alert('Unrecognised file — expected top-level keys: ato, aco, spins, and/or comms');
    return;
  }

  STATE.pkg = pkg;

  // Resolve target references in aim_points
  if (pkg.ato?.targets && pkg.ato?.missions) {
    const tgtMap = {};
    pkg.ato.targets.forEach(t => { if (t.id) tgtMap[t.id] = t; });

    pkg.ato.missions.forEach(m => {
      (m.target?.aim_points || []).forEach((ap, i, arr) => {
        if (typeof ap === 'object' && ap.target_ref && tgtMap[ap.target_ref]) {
          const ref = tgtMap[ap.target_ref];
          if (!ap.coords)    ap.coords    = ref.coords;
          if (!ap.elevation) ap.elevation = ref.elevation;
          if (!ap.name)      ap.name      = ref.name || ref.id;
          ap._resolved_target = ref;  // full target metadata for the UI
          arr[i] = ap;
        }
      });
    });
  }

  STATE.selectedIdx = -1;

  // Show main content, hide upload screen
  document.getElementById('upload-screen').style.display = 'none';
  document.getElementById('main-content').style.display  = 'flex';

  // Populate compact header (IRL + Ingame in one place only)
  renderHeader(pkg.ato || null);

  // Enable/disable tabs
  ['ato', 'aco', 'spins', 'comms', 'map'].forEach(tab => {
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    const available = tab === 'map' ? !!pkg.ato : !!pkg[tab];
    if (btn) btn.disabled = !available;
  });

  // Render whatever we have
  if (pkg.ato)   renderATO(pkg.ato);
  if (pkg.aco)   renderACO(pkg.aco);
  if (pkg.spins) renderSPINS(pkg.spins);
  if (pkg.comms) renderCOMMS(pkg.comms);
  if (pkg.ato)   renderMAP(pkg.ato); // map uses ATO coordinate data

  // Navigate to first available tab
  const first = ['ato', 'aco', 'spins', 'comms'].find(t => pkg[t]);
  if (first) showTab(first);
}

// ── Header population ─────────────────────────────────────────
// Only shows high-level package info. IRL/Ingame times live in
// the ATO intel strip (view-ato.js) to avoid duplication.
function renderHeader(ato) {
  const meta = document.getElementById('header-meta');
  meta.innerHTML = '';

  if (!ato) return;

  function mb(label, value, cls) {
    const b = el('div', 'meta-block');
    b.appendChild(el('div', 'meta-label', label));
    const v = el('div', 'meta-value' + (cls ? ' ' + cls : ''), value);
    b.appendChild(v);
    meta.appendChild(b);
  }

  // Header shows: date, ingame start, AWACS — concise identifiers only
  // Full detail (freq, bullseye, etc.) is in the ATO intel strip
  mb('DATE',          ato.irl_date || '—');
  mb('INGAME START',  ato.ingame_start_local || '—', 'ingame');
  const unit = ato.global_control?.controlling_unit;
  if (unit) mb('AWACS / GCI', unit);
}

// ── File input wiring ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const dropZone  = document.getElementById('dropZone');

  fileInput.addEventListener('change', function () {
    const f = this.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = e => loadPackage(e.target.result);
    r.readAsText(f);
  });

  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) { const r = new FileReader(); r.onload = ev => loadPackage(ev.target.result); r.readAsText(f); }
  });
});
