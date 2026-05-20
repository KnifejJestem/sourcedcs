'use strict';

// ── IFF state constants ────────────────────────────────────────────────────

const IFF_STATES = ['friendly', 'neutral', 'bogey', 'bandit', 'hostile'];

// Fallback colors — real values come from settings.col* at runtime.
const IFF_COLOR_DEFAULTS = {
  friendly: '#4488cc',
  bogey:    '#ccaa00',
  neutral:  '#888888',
  bandit:   '#cc6600',
  hostile:  '#cc2222',
};

// ── User coalition ────────────────────────────────────────────────────────
// 3 = BLUE (default), 2 = RED. Flips who is "own" vs "enemy".

let userCoalition = 3;

function loadUserCoalition() {
  try {
    const v = parseInt(localStorage.getItem('crc-desktop-user-coalition'), 10);
    if (v === 2 || v === 3) userCoalition = v;
  } catch (_) {}
}

function saveUserCoalition() {
  localStorage.setItem('crc-desktop-user-coalition', String(userCoalition));
}

function toggleUserCoalition() {
  userCoalition = userCoalition === 3 ? 2 : 3;
  saveUserCoalition();
}

function getUserCoalition() { return userCoalition; }

// ── Manual IFF overrides ──────────────────────────────────────────────────
// Map<trackId (string), IFF state> — persisted across sessions.

const iffOverrides = new Map();

function loadIffOverrides() {
  try {
    const raw = localStorage.getItem('crc-desktop-iff-overrides');
    if (!raw) return;
    for (const [id, state] of Object.entries(JSON.parse(raw))) {
      if (IFF_STATES.includes(state)) iffOverrides.set(id, state);
    }
  } catch (_) {}
}

function saveIffOverrides() {
  const obj = {};
  for (const [id, state] of iffOverrides) obj[id] = state;
  localStorage.setItem('crc-desktop-iff-overrides', JSON.stringify(obj));
}

function setIffOverride(id, state) {
  if (!IFF_STATES.includes(state)) return;
  iffOverrides.set(String(id), state);
  saveIffOverrides();
}

function clearIffOverride(id) {
  iffOverrides.delete(String(id));
  saveIffOverrides();
}

function clearAllIffOverrides() {
  iffOverrides.clear();
  localStorage.removeItem('crc-desktop-iff-overrides');
}

// ── Transponder check ─────────────────────────────────────────────────────
// Active = squawk is a finite number in the valid 4-digit range 0–7777.

function isTransponderActive(track) {
  if (track.squawk == null) return false;
  const sq = Number(track.squawk);
  return Number.isFinite(sq) && sq >= 0 && sq <= 7777;
}

// ── Auto IFF computation ──────────────────────────────────────────────────

function computeAutoIff(track) {
  const own   = userCoalition;
  const enemy = own === 3 ? 2 : 3;

  if (track.coalition === own) {
    if (!track.player)              return 'friendly'; // AI = always friendly
    if (isTransponderActive(track)) return 'friendly'; // player + transponder
    // player, no active transponder
    return checkOnGround(track) ? 'friendly' : 'bogey';
  }

  if (track.coalition === enemy) {
    return checkOnGround(track) ? 'invisible' : 'bogey';
  }

  // Coalition 1 (neutral) or unknown
  return 'neutral';
}

// Returns the effective IFF state: manual override first, then auto.
function getIff(track) {
  const override = iffOverrides.get(String(track.id));
  if (override) return override;
  return computeAutoIff(track);
}

// CSS colour for an IFF state — reads live from settings so colour picker
// changes take effect immediately without a page reload.
function iffColor(state) {
  // settings is defined in app.js; safe to read here because iffColor is
  // only ever called at runtime (never at parse time).
  const col = {
    friendly: (typeof settings !== 'undefined' && settings.colFriendly) || IFF_COLOR_DEFAULTS.friendly,
    bogey:    (typeof settings !== 'undefined' && settings.colBogey)    || IFF_COLOR_DEFAULTS.bogey,
    neutral:  (typeof settings !== 'undefined' && settings.colNeutral)  || IFF_COLOR_DEFAULTS.neutral,
    bandit:   (typeof settings !== 'undefined' && settings.colBandit)   || IFF_COLOR_DEFAULTS.bandit,
    hostile:  (typeof settings !== 'undefined' && settings.colHostile)  || IFF_COLOR_DEFAULTS.hostile,
  };
  return col[state] || '#888888';
}
