'use strict';

/* Rebuilds every member's activity-score history once per squadron-wide
   "day" (05:00 UTC, see discord-gateway.js's localDateKey), from
   data/voice-activity.json — the voice_day source of truth — and caches
   the result both in memory (for server.js's API routes) and on disk at
   data/activity-scores.json.

   Always a full recompute, never an incremental update to a stored S_raw
   (see ACTIVITY_SCORE.md §4, "recompute, don't accumulate") — a missed
   tick just means the next one recomputes the same history again, so
   nothing can corrupt a member's score across restarts or a skipped run. */

const fs = require('fs');
const path = require('path');
const activityScore = require('./activity-score');

let ACTIVITY_SCORES_FILE = null;
const cache = {}; /* memberId -> { rows, current, delta7d, updatedAt } */

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/* Rebuilds and persists the full store for `memberIds`. `getMemberDays(id)`
   must return that member's { 'YYYY-MM-DD': minutes } voice_day map. No
   `startDateKey` is available per member in this deployment (see the
   caveat on activity-score.js's recomputeMember), so this falls back to
   each member's earliest recorded voice day. */
function rebuildAll({ dataDir, memberIds, getMemberDays, todayKey }) {
  const store = {};
  for (const id of memberIds) {
    const days = getMemberDays(id) || {};
    const { rows, current, delta7d } = activityScore.recomputeMember(days, todayKey, null);
    store[id] = { rows, current, delta7d, updatedAt: new Date().toISOString() };
    cache[id] = store[id];
  }
  for (const id of Object.keys(cache)) {
    if (!store[id]) delete cache[id]; /* member no longer present — drop stale cache entry */
  }
  if (dataDir) saveJSON(path.join(dataDir, 'activity-scores.json'), store);
  return store;
}

/* Public accessor for server.js's API routes — mirrors discord-gateway.js's
   getMemberVoiceState/getMemberDays accessor style. Returns null if the
   member has never been through a rebuild yet (e.g. right after a fresh
   deploy, before the first tick has run). */
function getMemberScore(id) {
  const rec = cache[id];
  if (!rec) return null;
  return { current: rec.current, delta7d: rec.delta7d, updatedAt: rec.updatedAt };
}

/* Starts the once-per-day rebuild. Checks every `checkIntervalMs` (default
   15 min) whether the local-day key has changed since the last run, and
   reruns exactly once per day shortly after the 05:00 UTC boundary passes
   — the same "cheap interval poll, not a real cron" style discord-gateway.js
   already uses for its checkpoint/prune ticks. Runs once immediately at
   startup too, so scores are available right after a deploy rather than
   only after the first boundary crossing. */
function init({ dataDir, memberIds, getMemberDays, localDateKey, checkIntervalMs }) {
  ACTIVITY_SCORES_FILE = path.join(dataDir, 'activity-scores.json');
  const loaded = loadJSON(ACTIVITY_SCORES_FILE, null);
  if (loaded && typeof loaded === 'object') Object.assign(cache, loaded);

  let lastRunDay = null;
  function tick() {
    const todayKey = localDateKey(Date.now());
    if (todayKey === lastRunDay) return;
    lastRunDay = todayKey;
    try {
      rebuildAll({ dataDir, memberIds: memberIds(), getMemberDays, todayKey });
    } catch (err) {
      console.error('[activity-score] daily rebuild failed:', (err && err.stack) || err);
    }
  }
  tick();
  setInterval(tick, checkIntervalMs || 15 * 60 * 1000);
}

module.exports = { init, rebuildAll, getMemberScore };
