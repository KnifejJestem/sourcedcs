'use strict';

/* SOURCE activity score — see ACTIVITY_SCORE.md for the full model writeup,
   rationale, and data-handling rules (day boundary, densification, AFK
   handling). This module is pure: no fs access, no knowledge of Discord or
   the request/response cycle. Callers pass in a member's day-keyed voice
   minutes map and get back a recomputed score history.

   Every constant below is fitted against the invariant suite in
   test/activity-score.test.js. Do not adjust without re-validating that
   suite — the parameters sit on a knife-edge where several invariants meet
   (a ±3% perturbation is documented to break the suite in 120/120 trials). */

const PARAMS = Object.freeze({
  /* Day value v(m) = m^k / (m^k + T^k) — steep saturation curve between
     ~45 and ~150 minutes; a one-hour session is worth ~0.39, two hours ~0.79. */
  k: 2.561,
  T: 71.6,

  /* Below this many minutes a day counts as a gap day, not a low-value
     active day — the idle floor. A 19-minute appearance is absence. */
  ACTIVE_MIN: 20,

  /* Active-day EMA pull toward that day's value. */
  alpha: 0.1090,

  /* Gap-day multiplicative decay, banded by consecutive-gap-day count. */
  gapFactors: Object.freeze([
    { maxGap: 3, factor: 0.9755 },
    { maxGap: 7, factor: 0.9481 },
    { maxGap: 14, factor: 0.8669 },
    { maxGap: Infinity, factor: 0.502 },
  ]),

  /* Raw steady-state score of "4h/day, 6 of 7 days" — the display-scale
   anchor. Derived, hardcoded here; test/activity-score.test.js recomputes
   it by simulation and asserts it matches to 1e-9, so a change to alpha or
   the gap factors above that isn't matched by a recomputed R here fails
   the suite immediately. */
  R: 0.9110038085345449,

  /* Display score: linear rescale below the anchor (z = S_raw / R <= 1),
   bounded asymptote above it. Continuous and C1 at z = 1 (both branches
   have slope 0.99). */
  displaySlope: 0.99,
  overshootRate: 99,

  /* New members start at display score 0.50. */
  initialScore: 0.50,

  /* Score is provisional (not yet earned) until a member has this many
   days of history. */
  provisionalDays: 21,

  /* AFK handling: this hand-rolled Discord Gateway client tracks voice
   channel join/leave/move only — it has no visibility into Discord's
   speaking/PTT events (that requires an actual voice-server audio
   connection, which is out of scope for this client). Dropping
   non-transmit segments per §4 is therefore not implementable with the
   current data model; instead we cap qualifying minutes at this many
   per day, so idling overnight in a channel cannot inflate a day's value
   past what a legitimately long active session would earn. */
  afkCapMinutesPerDay: 600,

  /* Labels, evaluated in order — first match wins. Boundaries inclusive
   at the lower end. */
  labels: Object.freeze([
    { min: 0.50, label: 'active' },
    { min: 0.25, label: 'inactive' },
    { min: -Infinity, label: 'stale' },
  ]),
});

/* v(m): per-day value in [0, 1) for `minutes` qualifying voice minutes that
   day. Capped at afkCapMinutesPerDay before the curve is applied (see AFK
   handling note above). */
function dayValue(minutes, params = PARAMS) {
  if (!(minutes > 0)) return 0;
  const m = Math.min(minutes, params.afkCapMinutesPerDay);
  const mk = Math.pow(m, params.k);
  const Tk = Math.pow(params.T, params.k);
  return mk / (mk + Tk);
}

function gapFactor(g, params = PARAMS) {
  for (const band of params.gapFactors) {
    if (g <= band.maxGap) return band.factor;
  }
  return params.gapFactors[params.gapFactors.length - 1].factor;
}

/* One day's update to the running raw score. `minutes` is that day's
   qualifying voice minutes (0 for a day with no activity, including
   densified missing days — see recomputeMember). `gap` is the consecutive
   gap-day count immediately before today. Returns the new { sRaw, gap }. */
function stepDay(sRaw, minutes, gap, params = PARAMS) {
  if (minutes >= params.ACTIVE_MIN) {
    const v = dayValue(minutes, params);
    return { sRaw: sRaw + params.alpha * (v - sRaw), gap: 0 };
  }
  const nextGap = gap + 1;
  return { sRaw: sRaw * gapFactor(nextGap, params), gap: nextGap };
}

/* Raw -> display score. */
function toDisplayScore(sRaw, params = PARAMS) {
  const z = sRaw / params.R;
  if (z <= 1) return params.displaySlope * z;
  return 1 - 0.01 * Math.exp(-params.overshootRate * (z - 1));
}

/* Display score (raw float, NOT the rounded percentage) -> label. Never
   label off a rounded value — a 0.4996 score must stay "inactive". */
function labelForScore(score, params = PARAMS) {
  for (const band of params.labels) {
    if (score >= band.min) return band.label;
  }
  return params.labels[params.labels.length - 1].label;
}

/* Score as the rounded integer percentage shown in the UI (0.7649 -> 76).
   Storage/comparisons must keep the full float — only use this for display. */
function displayPercent(score) {
  return Math.round(score * 100);
}

function initialSRaw(params = PARAMS) {
  return (params.initialScore * params.R) / params.displaySlope;
}

/* Runs one full cycle of `pattern` (an array of daily minute values)
   repeatedly from S_raw = 0 until the score after a full cycle stops
   changing by more than `tol`, and returns that converged S_raw. Used both
   to derive/verify the R anchor and as a general "what does this pattern
   sustain" helper for tests and tooling. */
function simulateToConvergence(pattern, params = PARAMS, tol = 1e-12, maxCycles = 5000) {
  let sRaw = 0;
  let gap = 0;
  let prevCycleEnd = null;
  for (let cycle = 0; cycle < maxCycles; cycle++) {
    for (const minutes of pattern) {
      ({ sRaw, gap } = stepDay(sRaw, minutes, gap, params));
    }
    if (prevCycleEnd !== null && Math.abs(sRaw - prevCycleEnd) < tol) break;
    prevCycleEnd = sRaw;
  }
  return sRaw;
}

function nextDateKey(dateKey) {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* True if the day `dateKey` ('YYYY-MM-DD') falls inside any of
   `vacationDayRanges`, an array of { fromDay, untilDay } — both also
   'YYYY-MM-DD', already resolved by the caller into whatever day-boundary
   scheme produced dateKey (see discord-gateway.js's localDateKey). Plain
   string comparison is safe since 'YYYY-MM-DD' keys sort lexicographically
   in calendar order. */
function isVacationDay(dateKey, vacationDayRanges) {
  if (!Array.isArray(vacationDayRanges) || vacationDayRanges.length === 0) return false;
  return vacationDayRanges.some((r) => dateKey >= r.fromDay && dateKey <= r.untilDay);
}

/* Walks a (dense or sparse) { 'YYYY-MM-DD': minutes } map in chronological
   order from startDateKey through endDateKey inclusive, replaying the
   day-by-day model from a fresh initial S_raw. Missing keys are treated as
   zero-minute gap days (densification — §4: "the single most likely bug in
   the whole system" is skipping this). This always recomputes from
   scratch rather than resuming a stored S_raw ("recompute, don't
   accumulate" — a missed run can never corrupt a member's score).

   Vacation days (per vacationDayRanges) are frozen, not scored zero: no
   model update runs at all, so S_raw and the gap counter carry over
   unchanged — vacations must not affect the score in either direction,
   including not silently costing gap-day decay. */
function computeHistory(daysMap, startDateKey, endDateKey, vacationDayRanges = [], params = PARAMS) {
  const rows = [];
  let sRaw = initialSRaw(params);
  let gap = 0;
  let dayIndex = 0;
  for (let key = startDateKey; key <= endDateKey; key = nextDateKey(key)) {
    dayIndex++;
    if (isVacationDay(key, vacationDayRanges)) {
      const score = toDisplayScore(sRaw, params);
      rows.push({
        day: key,
        sRaw,
        score,
        label: labelForScore(score, params),
        provisional: dayIndex < params.provisionalDays,
        vacation: true,
      });
      continue;
    }
    const minutes = daysMap[key] || 0;
    ({ sRaw, gap } = stepDay(sRaw, minutes, gap, params));
    const score = toDisplayScore(sRaw, params);
    rows.push({
      day: key,
      sRaw,
      score,
      label: labelForScore(score, params),
      provisional: dayIndex < params.provisionalDays,
    });
  }
  return rows;
}

/* 7-day trend: score(today) - score(7 days ago), by row position (each row
   is exactly one calendar day). Returns null if there isn't yet 8 days of
   computed history to compare against. */
function sevenDayDelta(rows) {
  const idx = rows.length - 1 - 7;
  if (idx < 0) return null;
  return rows[rows.length - 1].score - rows[idx].score;
}

/* Top-level entry point: recomputes a member's full score history from
   their voice_day map, from `startDateKey` (the day the member became
   trackable — e.g. their roster-join date) through `todayKey`, both
   'YYYY-MM-DD' in whatever day-boundary scheme produced daysMap's keys
   (see discord-gateway.js's localDateKey).

   `startDateKey` matters: a member who joins and is silent for their first
   week must accrue gap-day decay for that week, not have their clock start
   only once they first appear. Pass null when no such "first tracked day"
   is known (the current deployment doesn't persist one per member) to fall
   back to the earliest key present in daysMap — this under-counts leading
   silence for anyone whose actual first day(s) of membership were inactive,
   since the source store only ever records days with nonzero minutes. See
   ACTIVITY_SCORE.md.

   `vacationDayRanges` — an array of { fromDay, untilDay } 'YYYY-MM-DD'
   pairs — marks days to freeze rather than score (see computeHistory).
   Pass [] (the default) if the member has no vacation entries.

   A member with no recorded days at all and no explicit startDateKey gets
   the fresh-member default rather than an empty walk. */
function recomputeMember(daysMap, todayKey, startDateKey, vacationDayRanges = [], params = PARAMS) {
  const keys = Object.keys(daysMap).sort();
  const inferredStart = keys.length ? keys[0] : null;
  const start = startDateKey || inferredStart;
  if (!start) {
    const sRaw = initialSRaw(params);
    const score = toDisplayScore(sRaw, params);
    return {
      rows: [],
      current: { day: todayKey, sRaw, score, label: labelForScore(score, params), provisional: true },
      delta7d: null,
    };
  }
  const clampedStart = start < todayKey ? start : todayKey;
  const rows = computeHistory(daysMap, clampedStart, todayKey, vacationDayRanges, params);
  return { rows, current: rows[rows.length - 1], delta7d: sevenDayDelta(rows) };
}

module.exports = {
  PARAMS,
  dayValue,
  gapFactor,
  stepDay,
  toDisplayScore,
  labelForScore,
  displayPercent,
  initialSRaw,
  simulateToConvergence,
  isVacationDay,
  computeHistory,
  sevenDayDelta,
  recomputeMember,
};
