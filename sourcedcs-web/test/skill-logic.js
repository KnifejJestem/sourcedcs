'use strict';

/**
 * Tests for pilot skill tracker pure logic.
 *
 * Run with:  node test/skill-logic.js
 *
 * These functions are duplicated from the browser JS (skills.js /
 * skills-admin.js) because they run in a non-module browser context.
 * Keep the implementations in sync when the scoring rules change.
 */

const assert = require('assert');

/* ══════════════════════════════════════════════════════════
   Logic under test (mirrors skills.js / skills-admin.js)
══════════════════════════════════════════════════════════ */

const GRADE_VALUES = { U: 0, F: 1, G: 2, E: 3 };

function gradeValue(g) {
  return (g != null && GRADE_VALUES[g] != null) ? GRADE_VALUES[g] : -1;
}

/**
 * Returns the state of a module for a given grades map.
 * grades: { [moduleId]: { grade: 'U'|'F'|'G'|'E' } }
 */
function moduleState(mod, grades) {
  for (const prereq of (mod.prerequisites || [])) {
    const gr = grades[prereq.module_id] ? grades[prereq.module_id].grade : null;
    if (gradeValue(gr) < gradeValue(prereq.min_grade)) return 'locked';
  }
  const myGrade = grades[mod.id] ? grades[mod.id].grade : null;
  if (myGrade == null) return 'not-started';
  if (gradeValue(myGrade) >= gradeValue(mod.min_pass_grade)) return 'completed';
  return 'in-progress';
}

/**
 * Category score: fraction of modules in 'completed' state (0.0–1.0).
 * Locked modules count as not-completed (score 0).
 */
function categoryScore(cat, grades) {
  const mods = cat.modules || [];
  if (!mods.length) return 0;
  const completed = mods.filter(m => moduleState(m, grades) === 'completed').length;
  return completed / mods.length;
}

/**
 * Overall score: weighted sum of category scores / 100.
 */
function overallScore(tree, grades) {
  const cats = tree.categories || [];
  if (!cats.length) return 0;
  return cats.reduce((s, cat) => s + (cat.weight || 0) * categoryScore(cat, grades), 0) / 100;
}

/* ══════════════════════════════════════════════════════════
   Helpers
══════════════════════════════════════════════════════════ */

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS  ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL  ' + name);
    console.log('         → ' + e.message);
    failed++;
  }
}

function mod(id, minPass, prereqs) {
  return { id, min_pass_grade: minPass || 'G', prerequisites: prereqs || [] };
}

function graded(grade) { return { grade }; }

/* ══════════════════════════════════════════════════════════
   Module state
══════════════════════════════════════════════════════════ */

console.log('\nModule state');

test('no grade → not-started', () => {
  assert.strictEqual(moduleState(mod('a'), {}), 'not-started');
});

test('grade meets min_pass_grade → completed', () => {
  assert.strictEqual(moduleState(mod('a', 'G'), { a: graded('G') }), 'completed');
});

test('grade above min_pass_grade → completed', () => {
  assert.strictEqual(moduleState(mod('a', 'G'), { a: graded('E') }), 'completed');
});

test('grade below min_pass_grade → in-progress', () => {
  assert.strictEqual(moduleState(mod('a', 'G'), { a: graded('F') }), 'in-progress');
});

test('U grade on G-pass module → in-progress (not locked)', () => {
  assert.strictEqual(moduleState(mod('a', 'G'), { a: graded('U') }), 'in-progress');
});

/* ── F min_pass_grade (the reported bug) ── */

test('[BUG FIX] F min_pass_grade + F grade → completed, not in-progress', () => {
  assert.strictEqual(moduleState(mod('a', 'F'), { a: graded('F') }), 'completed');
});

test('F min_pass_grade + G grade → completed', () => {
  assert.strictEqual(moduleState(mod('a', 'F'), { a: graded('G') }), 'completed');
});

test('F min_pass_grade + U grade → in-progress', () => {
  assert.strictEqual(moduleState(mod('a', 'F'), { a: graded('U') }), 'in-progress');
});

/* ── Prerequisites ── */

test('prereq met (exact min_grade) → not locked', () => {
  const b = mod('b', 'G', [{ module_id: 'a', min_grade: 'G' }]);
  assert.strictEqual(moduleState(b, { a: graded('G') }), 'not-started');
});

test('prereq met (above min_grade) → not locked', () => {
  const b = mod('b', 'G', [{ module_id: 'a', min_grade: 'G' }]);
  assert.strictEqual(moduleState(b, { a: graded('E') }), 'not-started');
});

test('prereq absent → locked', () => {
  const b = mod('b', 'G', [{ module_id: 'a', min_grade: 'G' }]);
  assert.strictEqual(moduleState(b, {}), 'locked');
});

test('prereq below min_grade → locked', () => {
  const b = mod('b', 'G', [{ module_id: 'a', min_grade: 'G' }]);
  assert.strictEqual(moduleState(b, { a: graded('F') }), 'locked');
});

test('multiple prereqs: all met → not locked', () => {
  const c = mod('c', 'G', [{ module_id: 'a', min_grade: 'G' }, { module_id: 'b', min_grade: 'F' }]);
  assert.strictEqual(moduleState(c, { a: graded('G'), b: graded('F') }), 'not-started');
});

test('multiple prereqs: one unmet → locked', () => {
  const c = mod('c', 'G', [{ module_id: 'a', min_grade: 'G' }, { module_id: 'b', min_grade: 'F' }]);
  assert.strictEqual(moduleState(c, { a: graded('G') }), 'locked'); // b missing
});

/* ── Tree changes with existing grades (the reported concern) ── */

console.log('\nTree changes with existing grades');

test('pilot completed module; prereq added retroactively → now locked, grade preserved', () => {
  // Before: no prereqs, pilot passed
  const modBefore = mod('b', 'G', []);
  const grades    = { b: graded('G') };
  assert.strictEqual(moduleState(modBefore, grades), 'completed', 'should be completed before change');

  // After: admin adds prereq that pilot has not met
  const modAfter = mod('b', 'G', [{ module_id: 'a', min_grade: 'G' }]);
  assert.strictEqual(moduleState(modAfter, grades), 'locked', 'should be locked after prereq added');

  // Grade record is unchanged (grades object not mutated by moduleState)
  assert.ok(grades.b, 'grade record must still exist');
  assert.strictEqual(grades.b.grade, 'G', 'grade value must be preserved');
});

test('pilot locked out; prereq removed → now accessible', () => {
  const modBefore = mod('b', 'G', [{ module_id: 'a', min_grade: 'G' }]);
  const grades    = {};
  assert.strictEqual(moduleState(modBefore, grades), 'locked');

  const modAfter = mod('b', 'G', []);
  assert.strictEqual(moduleState(modAfter, grades), 'not-started');
});

test('prereq min_grade raised above pilot grade → now locked', () => {
  // Pilot has F on prereq 'a'; prereq min_grade was F, now raised to G
  const gradeSufficesOld = mod('b', 'G', [{ module_id: 'a', min_grade: 'F' }]);
  const grades           = { a: graded('F') };
  assert.strictEqual(moduleState(gradeSufficesOld, grades), 'not-started');

  const gradeTooLow = mod('b', 'G', [{ module_id: 'a', min_grade: 'G' }]);
  assert.strictEqual(moduleState(gradeTooLow, grades), 'locked');
});

test('module min_pass_grade lowered → previously in-progress becomes completed', () => {
  // Pilot has F on module 'a', min_pass was G → in-progress
  const higherBar = mod('a', 'G', []);
  const grades    = { a: graded('F') };
  assert.strictEqual(moduleState(higherBar, grades), 'in-progress');

  // Admin lowers bar to F → pilot now passes
  const lowerBar = mod('a', 'F', []);
  assert.strictEqual(moduleState(lowerBar, grades), 'completed');
});

/* ══════════════════════════════════════════════════════════
   Score calculation
══════════════════════════════════════════════════════════ */

console.log('\nScore calculation');

test('category: 0/3 completed → 0%', () => {
  const cat = { modules: [mod('a'), mod('b'), mod('c')] };
  assert.strictEqual(categoryScore(cat, {}), 0);
});

test('category: 2/3 completed → ~66.7%', () => {
  const cat    = { modules: [mod('a'), mod('b'), mod('c')] };
  const grades = { a: graded('G'), b: graded('G') };
  const score  = categoryScore(cat, grades);
  assert.ok(Math.abs(score - 2 / 3) < 0.001, 'expected ~0.667, got ' + score);
});

test('category: all completed → 100%', () => {
  const cat    = { modules: [mod('a'), mod('b')] };
  const grades = { a: graded('G'), b: graded('E') };
  assert.strictEqual(categoryScore(cat, grades), 1);
});

test('[BUG FIX] F min_pass + F grade → counts as completed in score', () => {
  const cat    = { modules: [mod('a', 'F'), mod('b', 'G')] };
  const grades = { a: graded('F') }; // a passes, b not started
  assert.strictEqual(categoryScore(cat, grades), 0.5); // 1/2 modules passed
});

test('locked module does not count as completed', () => {
  // 'b' has prereq 'a' unmet → locked → score is 0 even though b is graded
  const cat = {
    modules: [
      mod('a', 'G', []),
      mod('b', 'G', [{ module_id: 'a', min_grade: 'G' }]),
    ],
  };
  const grades = { b: graded('G') }; // b graded but a missing → b is locked
  assert.strictEqual(categoryScore(cat, grades), 0);
});

test('overall: all categories at 100% → overall 100%', () => {
  const tree = {
    categories: [
      { weight: 60, modules: [mod('a')] },
      { weight: 40, modules: [mod('b')] },
    ],
  };
  assert.strictEqual(overallScore(tree, { a: graded('G'), b: graded('G') }), 1.0);
});

test('overall: only first category complete, weight 60 → overall 60%', () => {
  const tree = {
    categories: [
      { weight: 60, modules: [mod('a')] },
      { weight: 40, modules: [mod('b')] },
    ],
  };
  const score = overallScore(tree, { a: graded('G') });
  assert.ok(Math.abs(score - 0.6) < 0.001, 'expected 0.6, got ' + score);
});

test('overall: empty tree → 0%', () => {
  assert.strictEqual(overallScore({ categories: [] }, {}), 0);
});

test('overall: partial completion across multiple categories', () => {
  const tree = {
    categories: [
      { weight: 25, modules: [mod('a'), mod('b')] },     // 1/2 = 50% → contributes 12.5%
      { weight: 30, modules: [mod('c'), mod('d'), mod('e')] }, // 3/3 = 100% → contributes 30%
      { weight: 25, modules: [mod('f')] },                // 0/1 = 0% → contributes 0%
      { weight: 20, modules: [mod('g')] },                // 1/1 = 100% → contributes 20%
    ],
  };
  const grades = { a: graded('G'), c: graded('E'), d: graded('G'), e: graded('G'), g: graded('G') };
  const score  = overallScore(tree, grades);
  const expected = (25 * 0.5 + 30 * 1 + 25 * 0 + 20 * 1) / 100; // 0.625
  assert.ok(Math.abs(score - expected) < 0.001, 'expected ' + expected + ', got ' + score);
});

/* ══════════════════════════════════════════════════════════
   Results
══════════════════════════════════════════════════════════ */

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed > 0) process.exit(1);
