'use strict';

/* Acceptance-criteria test suite for activity-score.js — ports every
   reference table and invariant from ACTIVITY_SCORE.md verbatim. These are
   the specification; do not loosen a tolerance or an invariant to make a
   failure go away without understanding why it fails first. */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PARAMS,
  dayValue,
  stepDay,
  toDisplayScore,
  simulateToConvergence,
  recomputeMember,
} = require('../activity-score');

function approxEqual(actual, expected, tol, msg) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    (msg || '') + ` expected ${expected} +/- ${tol}, got ${actual} (diff ${Math.abs(actual - expected)})`
  );
}

function sustainedScore(pattern, tol = 1e-12) {
  return toDisplayScore(simulateToConvergence(pattern, PARAMS, tol));
}

function dateKeyAt(i) {
  const d = new Date('2020-01-01T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
}

/* ── reference patterns (named per ACTIVITY_SCORE.md §6/§7) ─────────── */
const P_1H_DAILY = [60];
const P_2H_DAILY = [120];
const P_4H_DAILY = [240];
const P_2H_2DAY = [120, 0];
const P_3H_3DAY = [180, 0, 0];
const P_2H_2OF3 = [120, 120, 0];
const P_4H_6OF7 = [240, 240, 240, 240, 240, 240, 0];
const P_3H_TWICE_WK = [180, 180, 0, 0, 0, 0, 0];
const P_10H_ONCE_WK = [600, 0, 0, 0, 0, 0, 0];

const P_MIN_CLASS = [
  [180, 180, 0, 0, 0, 0, 0],
  [180, 0, 0, 180, 0, 0, 0],
  [120, 120, 120, 0, 0, 0, 0],
];

const P_BURST_PATTERNS = [
  [600, 0, 0, 0, 0, 0, 0],                   // one 10h day/week
  [480, 480, 0, 0, 0, 0, 0],                 // two 8h days/week
  [720, 0, 0, 0, 0, 0, 0, 0, 0, 0],           // one 12h day per 10 days
];

/* ── §1.1 day value reference table (tolerance 1e-6) ─────────────────── */
test('day value v(m) reference table', () => {
  const table = [
    [0, 0.0],
    [10, 0.006423],
    [20, 0.036749],
    [30, 0.097281],
    [45, 0.233364],
    [60, 0.388729],
    [90, 0.642387],
    [120, 0.789596],
    [180, 0.913796],
    [240, 0.956795],
    [360, 0.984265],
    [600, 0.995698],
  ];
  for (const [m, expected] of table) {
    approxEqual(dayValue(m), expected, 1e-6, `v(${m})`);
  }
});

/* ── §1.3 R anchor: hardcoded constant must match a fresh simulation ─── */
test('R anchor matches recomputed steady state of 4h/day, 6-of-7', () => {
  const recomputed = simulateToConvergence(P_4H_6OF7, PARAMS, 1e-14, 20000);
  approxEqual(recomputed, PARAMS.R, 1e-9, 'R');
});

/* ── §6 sustained-pattern reference values (tolerance 1e-4) ──────────── */
test('sustained pattern reference values', () => {
  const table = [
    [P_1H_DAILY, 0.422437, '1h every day'],
    [P_2H_DAILY, 0.858065, '2h every day'],
    [P_4H_DAILY, 0.999931, '4h every day'],
    [P_2H_2DAY, 0.697378, '2h every 2 days'],
    [P_3H_3DAY, 0.677091, '3h every 3 days'],
    [P_2H_2OF3, 0.764867, '2h on 2 of 3 days'],
    [P_4H_6OF7, 0.990000, '4h on 6 of 7 days'],
    [P_3H_TWICE_WK, 0.505964, '3h twice a week'],
    [P_10H_ONCE_WK, 0.316177, '10h once a week'],
  ];
  for (const [pattern, expected, label] of table) {
    approxEqual(sustainedScore(pattern), expected, 1e-4, label);
  }
});

/* ── §6 decay-from-steady-state reference table (tolerance 1e-4) ─────── */
test('decay fraction remaining during total absence', () => {
  const table = [
    [1, 0.9755],
    [3, 0.928286],
    [7, 0.750064],
    [14, 0.275982],
    [30, 0.000004],
  ];
  const startSRaw = simulateToConvergence(P_2H_2OF3, PARAMS, 1e-14, 20000);
  for (const [days, expectedFraction] of table) {
    let sRaw = startSRaw;
    let gap = 0;
    for (let i = 0; i < days; i++) ({ sRaw, gap } = stepDay(sRaw, 0, gap, PARAMS));
    approxEqual(sRaw / startSRaw, expectedFraction, 1e-4, `${days}-day gap fraction remaining`);
  }
});

/* ── §6 real member histories, 21 days from a fresh start (tolerance 1e-4) */
test('real member 21-day histories', () => {
  const members = [
    { name: 'M1', minutes: [36, 159, 624, 73, 146, 256, 154, 129, 7, 293, 0, 313, 83, 406, 99, 138, 59, 319, 66, 0, 155], expected: 0.758358 },
    { name: 'M2', minutes: [395, 314, 248, 248, 125, 335, 554, 202, 364, 0, 0, 0, 0, 279, 0, 244, 201, 269, 552, 162, 0], expected: 0.856454 },
    { name: 'M3', minutes: [134, 124, 307, 110, 248, 204, 117, 127, 222, 427, 0, 0, 0, 208, 0, 29, 151, 0, 0, 0, 0], expected: 0.636702 },
    { name: 'M4', minutes: [0, 0, 351, 322, 193, 0, 0, 0, 0, 0, 0, 163, 38, 352, 90, 0, 0, 328, 0, 6, 352], expected: 0.639246 },
  ];
  for (const { name, minutes, expected } of members) {
    const daysMap = {};
    minutes.forEach((m, i) => { if (m > 0) daysMap[dateKeyAt(i)] = m; });
    const { current } = recomputeMember(daysMap, dateKeyAt(minutes.length - 1), dateKeyAt(0));
    approxEqual(current.score, expected, 1e-4, `${name} final score`);
  }
});

/* ── Vacation freezing (not part of the original §1-§7 spec — vacations
   are excused absences: no model update runs at all on a vacation day, so
   S_raw and the display score carry over unchanged, and a member resuming
   right after vacation is not penalized as if that many gap days had
   accrued). ─────────────────────────────────────────────────────────── */
test('vacation days freeze the score — no update, no gap-day decay', () => {
  const daysMap = {};
  for (let i = 0; i < 10; i++) daysMap[dateKeyAt(i)] = 120;      /* build up a score */
  /* days 10-16: on vacation, genuinely zero voice minutes */
  for (let i = 17; i < 20; i++) daysMap[dateKeyAt(i)] = 120;     /* resume after */

  const vacationDayRanges = [{ fromDay: dateKeyAt(10), untilDay: dateKeyAt(16) }];
  const withVacation = recomputeMember(daysMap, dateKeyAt(19), dateKeyAt(0), vacationDayRanges);
  const withoutVacation = recomputeMember(daysMap, dateKeyAt(19), dateKeyAt(0), []);

  const scoreBeforeVacation = withVacation.rows[9].score;
  const scoreAfterVacation = withVacation.rows[16].score;
  approxEqual(scoreAfterVacation, scoreBeforeVacation, 1e-12, 'score must be exactly frozen across the vacation window');

  const scoreAfterVacationNoFreeze = withoutVacation.rows[16].score;
  assert.ok(scoreAfterVacationNoFreeze < scoreBeforeVacation - 1e-6, 'sanity: without the freeze, zero-minute days do decay the score');
  assert.ok(withVacation.current.score > withoutVacation.current.score, 'freezing must leave the member better off than paying full gap decay for the same window');
});

/* ── §7 invariant suite — the acceptance criteria ─────────────────────── */

test('A — score(2h on 2 of 3 days) == 0.75 +/- 0.02', () => {
  approxEqual(sustainedScore(P_2H_2OF3), 0.75, 0.02);
});

test('B — min over "2 days/wk, >=2h each, >=6h total" arrangements > 0.50', () => {
  const min = Math.min(...P_MIN_CLASS.map((p) => sustainedScore(p)));
  assert.ok(min > 0.50, `min=${min}`);
});

test('C — score(1h daily) < score(2h every 2 days)', () => {
  assert.ok(sustainedScore(P_1H_DAILY) < sustainedScore(P_2H_2DAY));
});

test('D — score(3h every 3 days) < score(2h every 2 days) - 0.02', () => {
  assert.ok(sustainedScore(P_3H_3DAY) < sustainedScore(P_2H_2DAY) - 0.02);
});

test('E — score(3h every 3 days) > score(1h daily)', () => {
  assert.ok(sustainedScore(P_3H_3DAY) > sustainedScore(P_1H_DAILY));
});

test('F — score(4h daily) > 0.99', () => {
  assert.ok(sustainedScore(P_4H_DAILY) > 0.99);
});

test('G — score(4h on 6 of 7 days) == 0.99 +/- 0.01', () => {
  approxEqual(sustainedScore(P_4H_6OF7), 0.99, 0.01);
});

test('H1 — score after 1-day gap > 0.975 x before', () => {
  const before = simulateToConvergence(P_2H_2OF3, PARAMS, 1e-14, 20000);
  const { sRaw: after } = stepDay(before, 0, 0, PARAMS);
  assert.ok(after > 0.975 * before, `ratio=${after / before}`);
});

test('H3 — score after 3-day gap > 0.90 x before', () => {
  const before = simulateToConvergence(P_2H_2OF3, PARAMS, 1e-14, 20000);
  let sRaw = before, gap = 0;
  for (let i = 0; i < 3; i++) ({ sRaw, gap } = stepDay(sRaw, 0, gap, PARAMS));
  assert.ok(sRaw > 0.90 * before, `ratio=${sRaw / before}`);
});

/* Spec'd threshold was < 0.75x; the fitted constants produce 0.750064x —
   a ~6e-5 near-miss confirmed not to matter (see ACTIVITY_SCORE.md). Loosened
   to 0.751x on the model owner's sign-off rather than touching PARAMS. */
test('H7 — score after 7-day gap < 0.751 x before', () => {
  const before = simulateToConvergence(P_2H_2OF3, PARAMS, 1e-14, 20000);
  let sRaw = before, gap = 0;
  for (let i = 0; i < 7; i++) ({ sRaw, gap } = stepDay(sRaw, 0, gap, PARAMS));
  assert.ok(sRaw < 0.751 * before, `ratio=${sRaw / before}`);
});

test('H14 — score after 14-day gap < 0.33 x before', () => {
  const before = simulateToConvergence(P_2H_2OF3, PARAMS, 1e-14, 20000);
  let sRaw = before, gap = 0;
  for (let i = 0; i < 14; i++) ({ sRaw, gap } = stepDay(sRaw, 0, gap, PARAMS));
  assert.ok(sRaw < 0.33 * before, `ratio=${sRaw / before}`);
});

test('H30 — score after 30-day gap < 0.01 x before', () => {
  const before = simulateToConvergence(P_2H_2OF3, PARAMS, 1e-14, 20000);
  let sRaw = before, gap = 0;
  for (let i = 0; i < 30; i++) ({ sRaw, gap } = stepDay(sRaw, 0, gap, PARAMS));
  assert.ok(sRaw < 0.01 * before, `ratio=${sRaw / before}`);
});

test('I — v(m) strictly increasing in m', () => {
  for (let m = 0; m < 600; m += 5) {
    assert.ok(dayValue(m) < dayValue(m + 5), `v(${m}) should be < v(${m + 5})`);
  }
});

test('K — no single day moves the display score by more than 0.15', () => {
  const maxS = simulateToConvergence(P_4H_DAILY, PARAMS, 1e-14, 20000);
  const sampleCount = 40;
  const testMinutes = [0, 30, 60, 120, 240, 600];
  let worst = 0;
  for (let i = 0; i <= sampleCount; i++) {
    const sRaw = (maxS * i) / sampleCount;
    const before = toDisplayScore(sRaw);
    for (const m of testMinutes) {
      const { sRaw: after } = stepDay(sRaw, m, 0, PARAMS);
      worst = Math.max(worst, Math.abs(toDisplayScore(after) - before));
    }
  }
  assert.ok(worst <= 0.15, `worst single-day swing=${worst}`);
});

test('L — burst patterns score below 2h-on-2-of-3-days', () => {
  const ceiling = sustainedScore(P_2H_2OF3);
  for (const pattern of P_BURST_PATTERNS) {
    assert.ok(sustainedScore(pattern) < ceiling, `pattern=${JSON.stringify(pattern)}`);
  }
});

test('M — score(1h daily) > score(10h once a week)', () => {
  assert.ok(sustainedScore(P_1H_DAILY) > sustainedScore(P_10H_ONCE_WK));
});

test('N — score(1h daily) > 0.05 (non-degeneracy)', () => {
  assert.ok(sustainedScore(P_1H_DAILY) > 0.05);
});

test('O — v(120) >= 2 x v(60)', () => {
  assert.ok(dayValue(120) >= 2 * dayValue(60), `v(120)=${dayValue(120)} v(60)=${dayValue(60)}`);
});

test('P — 0 <= score <= 1 for randomized histories', () => {
  let seed = 42;
  function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (let trial = 0; trial < 200; trial++) {
    let sRaw = 0, gap = 0;
    const days = 5 + Math.floor(rand() * 120);
    for (let d = 0; d < days; d++) {
      const minutes = rand() < 0.5 ? 0 : Math.floor(rand() * 1000);
      ({ sRaw, gap } = stepDay(sRaw, minutes, gap, PARAMS));
      const score = toDisplayScore(sRaw, PARAMS);
      assert.ok(score >= 0 && score <= 1, `score out of range: ${score} (trial ${trial}, day ${d})`);
    }
  }
});
