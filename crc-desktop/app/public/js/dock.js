'use strict';

// ── Dockview bootstrap ────────────────────────────────────────────────────
// Owns the dockview grid that replaces individually hand-positioned
// `position:fixed` panels and their individual topbar/floating toggle
// buttons. Map is the one permanently-present panel (see REQUIRED_PANELS —
// it has no reopen affordance of any kind). Track Info, Radars (the
// radars-panel's internal id — see PANEL_TITLES for its current "PANELS"
// label), Settings, Airport, Squawk C/S, and Radio are all closable: Track
// Info reopens by clicking a track on the map (ensureTrackPanel), the
// Panels control via its own topbar button (wireRadarsPanelButton/
// toggleOrFocusPanel), and Settings/Airport/Squawk C/S/Radio via that
// control's own Panels section (wired in ui.js's initRadarPanel()) — which
// is why their old dedicated topbar/floating buttons (#btn-settings,
// #btn-calls, #btn-aprt) were removed rather than rewired, and the
// connection-settings ("SYNC") button moved into the Settings panel's
// Tools tab instead of floating above Radio's old fixed position.
//
// The UMD bundle's global is the literal (hyphenated) string "dockview-core",
// not a valid bare identifier, hence the bracket access below.
const DockviewCore = window['dockview-core'];

// Single source of truth for every panel's user-facing name. Every spot
// that displays a panel's name — its dockview tab title, its row label in
// the radars-panel's Panels section (ui.js's PANEL_CONTROL_ROWS), the
// topbar RADARS/PANELS button's own text — reads from here, so renaming a
// panel means changing exactly one string instead of hunting through both
// files and the static HTML and hoping none of the copies drift apart (this
// exact drift is what prompted consolidating it: the topbar button's label
// used to be hardcoded in index.html separately from the panel's own title
// here in dock.js). `map` has no entry — it uses dockview's own default
// (the tab shows its id) via createNoCloseTab, and nothing has asked for
// that to change.
const PANEL_TITLES = {
  track:    'TRACK INFO',
  radars:   'PANELS',
  settings: 'SETTINGS',
  airport:  'AIRPORT',
  calls:    'SQWK C/S',
  radio:    'RADIO',
};

const DOCK_LAYOUT_KEY = 'crc-desktop-dock-layout';

let dock = null;

function initDock() {
  const root = document.getElementById('dock-root');

  dock = new DockviewCore.DockviewComponent(root, {
    className: 'dockview-theme-abyss',
    createComponent(options) {
      switch (options.name) {
        case 'map':      return createMapPanel();
        case 'track':    return mountExistingPanel('track-panel', initTrackPanel);
        case 'calls':    return mountExistingPanel('calls-panel', initCallsPanel);
        case 'settings': return mountExistingPanel('settings-panel', initSettings);
        case 'airport':  return mountExistingPanel('aprt-panel', initAprtPanel);
        case 'radars':   return mountExistingPanel('radars-panel', initRadarPanel);
        case 'radio':    return mountExistingPanel('srs-radio-panel', null);
        default: throw new Error(`[dock] unknown panel component: ${options.name}`);
      }
    },
    createTabComponent(options) {
      switch (options.name) {
        case 'no-close': return createNoCloseTab();
        default: throw new Error(`[dock] unknown tab component: ${options.name}`);
      }
    },
  });

  loadDockLayout();
  wireRadarsPanelButton();

  let saveTimer = null;
  dock.api.onDidLayoutChange(() => {
    // IMPORTANT: never call addPanel()/removePanel() synchronously from
    // inside this callback. onDidLayoutChange can fire while dockview is
    // still mid-mutation — e.g. removing a group that just emptied out, or
    // partway through fromJSON() rebuilding a whole saved layout — and a
    // reentrant addPanel() call in that window previously froze the app:
    // dockview would still report the panel "missing" on the very next
    // change event that same synchronous mutation produced, so the re-add
    // fired again, and again, pegging the renderer in an infinite loop
    // (reproduced with 100% certainty by closing every left-group tab).
    // Deferring past the current synchronous call stack — and coalescing
    // bursts of change events into a single check — sidesteps this
    // entirely: by the time it runs, dockview's internal state has settled.
    scheduleEnsureRequiredPanels();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDockLayout, 400);
  });
}

// Panels with no dedicated reopen UI — always re-added if closed. Track Info
// deliberately is NOT here: it has its own reopen path (clicking a track on
// the map — see ensureTrackPanel/showTrackPanel), so it's free to stay
// closed like any other optional panel. Map is the one panel with no
// reopen affordance of any kind, so it alone gets force-restored.
//
// `options` may be a plain object or a function computing it at re-add
// time — needed here because the right place for Map to land depends on
// whether anything else is currently docked: with no position at all,
// dockview drops a re-added panel into whichever group happens to be
// active, which previously meant Map got merged as a tab into the left
// group instead of restored to its own column the moment it — and only
// it — was closed.
const REQUIRED_PANELS = [
  {
    id: 'map',
    options: () => {
      const anchor = dock.api.panels.map(p => p.id).find(id => id !== 'map');
      const base = { id: 'map', component: 'map', tabComponent: 'no-close' };
      return anchor
        ? { ...base, position: { referencePanel: anchor, direction: 'right' } }
        : base;
    },
  },
];

// Safe to call directly (synchronously adds whatever's missing) as long as
// the caller isn't itself running from inside an onDidLayoutChange callback
// — see scheduleEnsureRequiredPanels below for that case.
function addMissingRequiredPanels() {
  for (const { id, options } of REQUIRED_PANELS) {
    if (!dock.api.getPanel(id)) dock.addPanel(typeof options === 'function' ? options() : options);
  }
}

// Shared "where should this land" logic for every panel that belongs in the
// left auxiliary cluster (Track Info / Radars / Airport / Squawk C/S):
// rejoin whichever of them is already open, so a panel being (re)added
// tabs alongside its siblings instead of splitting off into its own column
// — which is what happens if you hand dockview a `position` referencing a
// panel that doesn't currently exist (it throws), or no position at all
// (it lands wherever the active group happens to be, sometimes merging
// into completely the wrong group — both reproduced firsthand while
// building this). `excludeId` leaves out the panel currently being placed.
const LEFT_CLUSTER = ['track', 'radars', 'airport', 'calls'];

function leftGroupAnchor(excludeId) {
  return LEFT_CLUSTER.filter(id => id !== excludeId).find(id => dock.api.getPanel(id));
}

// Track Info's reopen path: clicking a track on the map (showTrackPanel, in
// ui.js) calls this to get-or-create the panel before activating it, rather
// than relying on a permanent required-panel restore.
function ensureTrackPanel() {
  const existing = dock.api.getPanel('track');
  if (existing) return existing;
  const anchor = leftGroupAnchor('track');
  return dock.addPanel({
    id: 'track', component: 'track', title: PANEL_TITLES.track,
    position: anchor ? { referencePanel: anchor } : { referencePanel: 'map', direction: 'left' },
  });
}

let _ensureRequiredPanelsQueued = false;

function scheduleEnsureRequiredPanels() {
  if (_ensureRequiredPanelsQueued) return;
  _ensureRequiredPanelsQueued = true;
  setTimeout(() => {
    _ensureRequiredPanelsQueued = false;
    addMissingRequiredPanels();
  }, 0);
}

// The Radars/Panels control itself — reached only via the topbar button
// (see wireRadarsPanelButton/toggleOrFocusPanel below), not from any
// checkbox. (Internal id/component/DOM-id stay "radars" — only the
// user-facing name changed; renaming those too would touch a lot of
// references for zero user-visible benefit.)
function radarsPanelOptions() {
  const anchor = leftGroupAnchor('radars');
  return {
    id: 'radars', component: 'radars', title: PANEL_TITLES.radars,
    position: anchor ? { referencePanel: anchor } : { referencePanel: 'map', direction: 'left' },
  };
}

function wireRadarsPanelButton() {
  const btn = document.getElementById('btn-radars');
  if (!btn) return;
  const label = document.getElementById('btn-radars-label');
  if (label) label.textContent = PANEL_TITLES.radars;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOrFocusPanel('radars', radarsPanelOptions);
  });
}

// Click-to-toggle for a panel reached via a single topbar button (as
// opposed to the Panels-section checkboxes, which are plain on/off): opens
// it and focuses it if it's not the active tab, closes it if it already is
// — the same "click again to dismiss" feel the old fixed-position toggle
// button had.
function toggleOrFocusPanel(id, addOptionsFn) {
  const existing = dock.api.getPanel(id);
  if (existing) {
    if (dock.api.activePanel === existing) dock.api.removePanel(existing);
    else existing.api.setActive();
  } else {
    dock.addPanel(addOptionsFn()).api.setActive();
  }
}

// Optional panels toggled from the radars-panel's "Panels" section (see
// initRadarPanel() in ui.js) — off by default so the map keeps maximum
// space until the user actually asks for one. Airport is additionally
// driven by radar state (see notifyRadarToggled) — Settings/Squawk C/S have
// no radar tie and are purely manual. Future dockable panels (flight
// strips, PAR scope, marshal stack, LSO, chat) register here too.
const DOCKABLE_PANELS = {
  settings: () => ({
    id: 'settings', component: 'settings', title: PANEL_TITLES.settings,
    position: { referencePanel: 'map', direction: 'right' },
  }),
  airport: () => {
    const anchor = leftGroupAnchor('airport');
    return {
      id: 'airport', component: 'airport', title: PANEL_TITLES.airport,
      position: anchor ? { referencePanel: anchor } : { referencePanel: 'map', direction: 'left' },
    };
  },
  calls: () => {
    const anchor = leftGroupAnchor('calls');
    return {
      id: 'calls', component: 'calls', title: PANEL_TITLES.calls,
      position: anchor ? { referencePanel: anchor } : { referencePanel: 'map', direction: 'left' },
    };
  },
  // No referencePanel/referenceGroup at all — dockview interprets a bare
  // `direction` as relative to the whole grid (confirmed against its
  // source: it hits the "orthogonalize" branch rather than splitting a
  // single panel), which is what makes this a genuine full-width bottom
  // strip rather than just "below the map panel" specifically. Re-adding it
  // this way after a close also always lands back as a fresh full-width
  // strip, regardless of how the rest of the grid has been rearranged since.
  radio: () => ({
    id: 'radio', component: 'radio', title: PANEL_TITLES.radio,
    position: { direction: 'below' },
    initialHeight: 90,
  }),
};

function isDockPanelOpen(id) {
  return !!(dock && dock.api.getPanel(id));
}

// `preserveFocus`: dockview's addPanel() focuses whatever it just added by
// default — fine for a deliberate "open this" click (Panels checkbox/pin),
// but wrong for a panel opening as a *side effect* of something else (radar
// implication, see notifyRadarToggled): confirmed firsthand that enabling a
// radar mid-search yanked focus away from the Radars panel to the newly-
// opened Airport panel, hiding the very search the user was still using.
function toggleDockPanel(id, open, { preserveFocus } = {}) {
  const optionsFn = DOCKABLE_PANELS[id];
  if (!optionsFn) return;
  const existing = dock.api.getPanel(id);
  if (open) {
    if (!existing) {
      const previousActive = preserveFocus ? dock.api.activePanel : null;
      dock.addPanel(optionsFn());
      if (previousActive && dock.api.getPanel(previousActive.id)) previousActive.api.setActive();
    }
  } else if (existing) {
    dock.api.removePanel(existing);
  }
}

// ── Radar-driven panel visibility ───────────────────────────────────────
// Enabling a radar that implies a panel (currently just airport-type radars
// → the Airport panel) opens it automatically; disabling the last radar
// that implies it closes it again — unless the user has pinned it, which
// keeps it open regardless of radar state until explicitly unpinned.
// Settings/Squawk C/S have no radar tie and aren't affected by any of this.
const RADAR_TYPE_TO_PANEL = { airport: 'airport' };

const PINNED_PANELS_KEY = 'crc-desktop-pinned-panels';

function _loadPinnedPanels() {
  try {
    const raw = localStorage.getItem(PINNED_PANELS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

let _pinnedPanels = _loadPinnedPanels();

function isPanelPinned(id) {
  return !!_pinnedPanels[id];
}

function setPanelPinned(id, pinned) {
  _pinnedPanels[id] = pinned;
  try {
    localStorage.setItem(PINNED_PANELS_KEY, JSON.stringify(_pinnedPanels));
  } catch (_) {}
  // Clicking PIN happens from inside the radars-panel's Panels section —
  // preserve focus there too, same reasoning as notifyRadarToggled.
  if (pinned) toggleDockPanel(id, true, { preserveFocus: true });
  else if (!isPanelImplied(id)) toggleDockPanel(id, false);
}

// True if any currently-enabled radar implies this panel.
function isPanelImplied(panelId) {
  for (const r of getAllRadars()) {
    if (enabledRadarIds.has(r.id) && RADAR_TYPE_TO_PANEL[r.type] === panelId) return true;
  }
  return false;
}

// Called from ui.js whenever a radar's enabled state changes (both from the
// active-radars list and the add-radar search) — reacts only to this one
// radar's own transition, not a continuously-enforced invariant, so
// manually closing an implied-open panel afterward doesn't get fought the
// way Track Info's old permanent auto-restore did.
function notifyRadarToggled(radar, enabled) {
  const panelId = RADAR_TYPE_TO_PANEL[radar.type];
  if (!panelId) return;
  if (enabled) {
    toggleDockPanel(panelId, true, { preserveFocus: true });
  } else if (!isPanelImplied(panelId) && !isPanelPinned(panelId)) {
    toggleDockPanel(panelId, false);
  }
}

// ── Map panel ──────────────────────────────────────────────────────────────
// initMap() (map-setup.js) is handed this panel's own container element
// directly rather than looking one up by DOM id, since dockview's attach
// timing relative to init() isn't something to depend on (see layout() below).
//
// Like mountExistingPanel's _legacyPanelState, `started` and `element` are
// cached at module level, NOT per createComponent() call. The map's tab has
// no close button (see createNoCloseTab below) so there's no direct UI path
// to trigger this, but re-closing/reopening it by any other means would
// otherwise call createMapPanel() again, constructing a *second* MapLibre
// instance while the shared `mapReady` flag (map-setup.js) stays stuck at
// true from the first instance's already-completed load — every source
// lookup against the new, not-yet-loaded map then crashes with "Cannot read
// properties of undefined (reading 'setData')" the moment any periodic
// update fires. One persistent MapLibre instance for the app's lifetime
// avoids the whole class of problem.
let _mapPanelElement = null;
let _mapPanelStarted = false;

function createMapPanel() {
  if (!_mapPanelElement) {
    _mapPanelElement = document.createElement('div');
    _mapPanelElement.id = 'map';
  }

  return {
    element: _mapPanelElement,
    init() {},
    layout() {
      // MapLibre measures its container synchronously at construction time,
      // so it must already have real (attached, non-zero) layout dimensions
      // — init() fires before dockview has necessarily attached `element`
      // to the document, but layout(width, height) only fires once it
      // actually has a rendered box. Constructing lazily on the first
      // layout() call sidesteps relying on dockview's exact attach/init
      // ordering.
      if (!_mapPanelStarted) {
        _mapPanelStarted = true;
        initMap(_mapPanelElement);
        return;
      }
      if (typeof map !== 'undefined' && map && typeof map.resize === 'function') {
        map.resize();
      }
    },
  };
}

// Tab renderer for the map panel — identical to dockview's built-in default
// tab (same classes, so it's styled the same) minus the close-button action
// element, so there's no way to close the one panel with no reopen UI at
// all. Mirrors DefaultTab's own approach (title text + reacting to
// api.onDidTitleChange) rather than dockview's undocumented internals.
function createNoCloseTab() {
  const element = document.createElement('div');
  element.className = 'dv-default-tab';
  const content = document.createElement('div');
  content.className = 'dv-default-tab-content';
  element.appendChild(content);
  let titleChangeDisposable = null;
  return {
    element,
    init(params) {
      content.textContent = params.title || '';
      titleChangeDisposable = params.api.onDidTitleChange((event) => {
        content.textContent = event.title || '';
      });
    },
    dispose() {
      if (titleChangeDisposable) titleChangeDisposable.dispose();
    },
  };
}

// ── Legacy-panel adapter ───────────────────────────────────────────────────
// Wraps an existing static DOM subtree (still declared in index.html, still
// referenced internally via its own document.getElementById lookups) as a
// dockview panel, without rewriting any of that panel's internal logic.
//
// State is cached per domId in a module-level map, NOT per createComponent()
// call — this is load-bearing, not a micro-optimisation. dockview calls
// createComponent() again every time a panel is re-created (e.g. Track Info
// being closed and later reopened via ensureTrackPanel), and by then
// dockview has already detached the panel's original DOM node from the
// document — a fresh document.getElementById(domId) at that point returns
// null. Handing dockview `element: null` previously caused every re-add
// attempt to fail, and since each failed attempt still fired another
// layout-change event, the required-panel safety net kept rescheduling
// itself forever, pegging the renderer (reproduced reliably by closing
// every left-group tab back when Track Info was also force-restored).
// Caching the element the first time it's genuinely attached — and reusing
// that same (possibly since-detached, but still-alive-in-memory) reference
// on every later re-creation — sidesteps this entirely; re-appending an
// orphaned node is completely valid, it just can't be found by id anymore.
// The same cache also makes `initFn` genuinely run-once across
// close/reopen cycles, rather than re-wiring (and duplicating) its event
// listeners on every reopen.
const _legacyPanelState = new Map(); // domId -> { element, initialized, hooks }

function mountExistingPanel(domId, initFn) {
  let state = _legacyPanelState.get(domId);
  if (!state) {
    const element = document.getElementById(domId);
    if (!element) console.error(`[dock] no #${domId} element found in index.html — this panel will not render`);
    // See the .dock-unmounted rule (index.html): every legacy-adapter div
    // starts hidden in the static markup, since a panel dockview hasn't
    // been asked to create yet this session has nowhere to go and would
    // otherwise render inline wherever it happens to sit in the HTML source.
    if (element) element.classList.remove('dock-unmounted');
    state = { element, initialized: false, hooks: null };
    _legacyPanelState.set(domId, state);
  }
  return {
    element: state.element,
    init() {
      if (state.initialized) return;
      state.initialized = true;
      state.hooks = (initFn && initFn()) || null;
    },
    // Runs when dockview removes this panel (tab closed, checkbox
    // unchecked, etc). Panels whose init() wired up state that keeps
    // getting written to on a timer/broadcast regardless of visibility
    // (Track Info's _trackPanelId, updated by the periodic track-data tick)
    // need to clear that state here, or the next tick after close tries to
    // write into DOM that's no longer attached to the document and throws.
    dispose() {
      if (state.hooks && state.hooks.onClose) state.hooks.onClose();
    },
    onShow() {
      if (state.hooks && state.hooks.onShow) state.hooks.onShow();
    },
  };
}

// ── Layout persistence ─────────────────────────────────────────────────────

function buildDefaultDockLayout() {
  // Called directly during boot, before onDidLayoutChange is wired up (see
  // initDock()) — safe to add panels synchronously here. Track Info and
  // Radio are part of the default layout (nice to see on first launch,
  // matching what used to always be visible) even though neither is
  // force-restored later — ensureTrackPanel() and the checkbox in the
  // radars-panel's Panels section cover reopening them respectively.
  addMissingRequiredPanels();
  ensureTrackPanel();
  toggleDockPanel('radio', true);
  // Settings/Airport/Squawk C/S intentionally NOT added here — they start
  // closed; the user opts in via the radars-panel's Panels checkboxes.
}

function saveDockLayout() {
  try {
    localStorage.setItem(DOCK_LAYOUT_KEY, JSON.stringify(dock.toJSON()));
  } catch (err) {
    console.error('[dock] failed to save layout:', err.message);
  }
}

function loadDockLayout() {
  try {
    const raw = localStorage.getItem(DOCK_LAYOUT_KEY);
    if (raw) {
      dock.fromJSON(JSON.parse(raw));
      return;
    }
  } catch (err) {
    console.error('[dock] failed to restore saved layout, using default:', err.message);
  }
  buildDefaultDockLayout();
}
