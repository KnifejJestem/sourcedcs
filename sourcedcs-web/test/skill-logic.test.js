'use strict';

/* Tests the real shared logic in public/js/skills-core.js (not a hand-copied
   duplicate — this used to be test/skill-logic.js, a manually-run script
   that re-implemented moduleState/scoring and could silently drift from the
   browser code; it's now wired into `npm test` and imports the actual
   module both skills.js and skills-admin.js load). */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIndex, moduleState, effectiveModuleGrade, overallScore,
  detectRequirementCycle, validateTree, effectiveSquadrons, moduleVisibleToSquadron,
  countModules, countCompletedModules,
} = require('../public/js/skills-core.js');

/* ── Test-tree builders ──────────────────────────────────── */
function item(id, minPass) { return { id, min_pass_grade: minPass || 'G' }; }
function leaf(id, opts) {
  opts = opts || {};
  return {
    id, title: opts.title || id, squadrons: opts.squadrons,
    requirements: opts.requirements || [],
    subModules: [],
    gradingItems: opts.items || [item(id, opts.minPass)],
  };
}
function group(id, subModules, opts) {
  opts = opts || {};
  return {
    id, title: opts.title || id, squadrons: opts.squadrons,
    requirements: opts.requirements || [],
    subModules: subModules || [],
    gradingItems: [],
  };
}
function doc(tree) { return { version: 2, tree: tree }; }
function graded(grade) { return { grade: grade }; }

/* ══════════════════════════════════════════════════════════
   Module state — single leaf module (matches today's behaviour 1:1)
══════════════════════════════════════════════════════════ */

test('module state: leaf', async (t) => {
  await t.test('no grade -> not-started', () => {
    const index = buildIndex(doc([leaf('a')]));
    assert.equal(moduleState(index, 'a', {}), 'not-started');
  });

  await t.test('grade meets min_pass_grade -> completed', () => {
    const index = buildIndex(doc([leaf('a', { minPass: 'G' })]));
    assert.equal(moduleState(index, 'a', { a: graded('G') }), 'completed');
  });

  await t.test('grade above min_pass_grade -> completed', () => {
    const index = buildIndex(doc([leaf('a', { minPass: 'G' })]));
    assert.equal(moduleState(index, 'a', { a: graded('E') }), 'completed');
  });

  await t.test('grade below min_pass_grade -> in-progress', () => {
    const index = buildIndex(doc([leaf('a', { minPass: 'G' })]));
    assert.equal(moduleState(index, 'a', { a: graded('F') }), 'in-progress');
  });

  await t.test('F min_pass_grade + F grade -> completed', () => {
    const index = buildIndex(doc([leaf('a', { minPass: 'F' })]));
    assert.equal(moduleState(index, 'a', { a: graded('F') }), 'completed');
  });
});

/* ══════════════════════════════════════════════════════════
   Requirements (formerly "prerequisites") — DAG, multi-source
══════════════════════════════════════════════════════════ */

test('requirements', async (t) => {
  await t.test('requirement met (exact min_grade) -> not locked', () => {
    const index = buildIndex(doc([
      leaf('a', { minPass: 'G' }),
      leaf('b', { requirements: [{ module_id: 'a', min_grade: 'G' }] }),
    ]));
    assert.equal(moduleState(index, 'b', { a: graded('G') }), 'not-started');
  });

  await t.test('requirement absent -> locked', () => {
    const index = buildIndex(doc([
      leaf('a'), leaf('b', { requirements: [{ module_id: 'a', min_grade: 'G' }] }),
    ]));
    assert.equal(moduleState(index, 'b', {}), 'locked');
  });

  await t.test('requirement below min_grade -> locked', () => {
    const index = buildIndex(doc([
      leaf('a'), leaf('b', { requirements: [{ module_id: 'a', min_grade: 'G' }] }),
    ]));
    assert.equal(moduleState(index, 'b', { a: graded('F') }), 'locked');
  });

  await t.test('module needs two upper (requirement) modules — both must pass', () => {
    const index = buildIndex(doc([
      leaf('a'), leaf('b'),
      leaf('c', { requirements: [{ module_id: 'a', min_grade: 'G' }, { module_id: 'b', min_grade: 'F' }] }),
    ]));
    assert.equal(moduleState(index, 'c', { a: graded('G'), b: graded('F') }), 'not-started');
    assert.equal(moduleState(index, 'c', { a: graded('G') }), 'locked'); // b missing
  });

  await t.test('requirement target with multiple grading items uses weakest-link grade', () => {
    const wingWork = leaf('wwe', { items: [item('wwe::l1', 'G'), item('wwe::l2', 'G'), item('wwe::l3', 'G')] });
    const index = buildIndex(doc([
      wingWork,
      leaf('next', { requirements: [{ module_id: 'wwe', min_grade: 'G' }] }),
    ]));
    const grades = { 'wwe::l1': graded('E'), 'wwe::l2': graded('E'), 'wwe::l3': graded('F') };
    assert.equal(effectiveModuleGrade(index, 'wwe', grades), 'F');
    assert.equal(moduleState(index, 'next', grades), 'locked'); // F < G
  });

  await t.test('detectRequirementCycle finds a circular requirement chain', () => {
    const indexBad = buildIndex(doc([
      leaf('a', { requirements: [{ module_id: 'c', min_grade: 'G' }] }),
      leaf('b', { requirements: [{ module_id: 'a', min_grade: 'G' }] }),
      leaf('c', { requirements: [{ module_id: 'b', min_grade: 'G' }] }),
    ]));
    const cycle = detectRequirementCycle(indexBad);
    assert.ok(cycle, 'expected a cycle to be detected');

    const indexOk = buildIndex(doc([
      leaf('a'), leaf('b', { requirements: [{ module_id: 'a', min_grade: 'G' }] }),
    ]));
    assert.equal(detectRequirementCycle(indexOk), null);
  });
});

/* ══════════════════════════════════════════════════════════
   Recursive composition — sub-modules AND grading items must ALL pass
══════════════════════════════════════════════════════════ */

test('recursive composition', async (t) => {
  await t.test('module with grading items passes only when every item passes', () => {
    const airfield = leaf('af', { items: [item('af::base', 'G'), item('af::down', 'G'), item('af::td', 'G')] });
    const index = buildIndex(doc([airfield]));
    assert.equal(moduleState(index, 'af', {}), 'not-started');
    assert.equal(
      moduleState(index, 'af', { 'af::base': graded('G'), 'af::down': graded('G') }),
      'in-progress'
    );
    assert.equal(
      moduleState(index, 'af', { 'af::base': graded('G'), 'af::down': graded('G'), 'af::td': graded('G') }),
      'completed'
    );
  });

  await t.test('deep nesting: UPT > Formation Flying > Fingertip > Wing Work Exercise', () => {
    const wwe = leaf('wwe', { items: [item('wwe::l1'), item('wwe::l2')] });
    const fingertip = group('fingertip', [wwe]);
    const formation  = group('formation', [fingertip]);
    const upt         = group('upt', [formation]);
    const index = buildIndex(doc([upt]));

    assert.equal(moduleState(index, 'wwe', {}), 'not-started');
    assert.equal(moduleState(index, 'fingertip', {}), 'not-started');

    const grades = { 'wwe::l1': graded('G'), 'wwe::l2': graded('G') };
    assert.equal(moduleState(index, 'wwe', grades), 'completed');
    assert.equal(moduleState(index, 'fingertip', grades), 'completed');
    assert.equal(moduleState(index, 'formation', grades), 'completed');
    assert.equal(moduleState(index, 'upt', grades), 'completed');
  });
});

/* ══════════════════════════════════════════════════════════
   Score — flat completed-modules / total-modules, every level counts
══════════════════════════════════════════════════════════ */

test('score', async (t) => {
  await t.test('counts every module at every depth, not grading items', () => {
    const wwe = leaf('wwe', { items: [item('wwe::l1'), item('wwe::l2'), item('wwe::l3')] });
    const tree = group('upt', [group('formation', [wwe]), leaf('nav')]);
    // modules: upt, formation, wwe, nav = 4 (grading items l1/l2/l3 do NOT count)
    assert.equal(countModules(tree), 4);
    const index = buildIndex(doc([tree]));
    assert.equal(countCompletedModules(index, tree, {}), 0);
  });

  await t.test('overallScore = completed/total, no weighting', () => {
    const a = leaf('a'); const b = leaf('b'); const c = leaf('c'); const d = leaf('d');
    const index = buildIndex(doc([a, b, c, d]));
    const score = overallScore(index, null, { a: graded('G'), b: graded('G') });
    assert.equal(score, 0.5);
  });

  await t.test('empty tree -> 0', () => {
    const index = buildIndex(doc([]));
    assert.equal(overallScore(index, null, {}), 0);
  });
});

/* ══════════════════════════════════════════════════════════
   Squadron scoping — inherited recursively downward, must not broaden
══════════════════════════════════════════════════════════ */

test('squadron scoping', async (t) => {
  await t.test('unrestricted root -> visible to everyone', () => {
    const index = buildIndex(doc([leaf('a')]));
    assert.equal(effectiveSquadrons(index, 'a'), null);
    assert.equal(moduleVisibleToSquadron(index, 'a', 'sqA'), true);
    assert.equal(moduleVisibleToSquadron(index, 'a', null), true);
  });

  await t.test('child inherits parent restriction when unset', () => {
    const child  = leaf('child');
    const parent = group('parent', [child], { squadrons: ['sqA'] });
    const index  = buildIndex(doc([parent]));
    assert.deepEqual(effectiveSquadrons(index, 'child'), ['sqA']);
    assert.equal(moduleVisibleToSquadron(index, 'child', 'sqA'), true);
    assert.equal(moduleVisibleToSquadron(index, 'child', 'sqB'), false);
  });

  await t.test('child can narrow further but validateTree rejects broadening', () => {
    const narrowChild  = leaf('narrow', { squadrons: ['sqA'] });
    const parentOk      = group('parent', [narrowChild], { squadrons: ['sqA', 'sqB'] });
    assert.equal(validateTree(doc([parentOk])), null);

    const broadChild = leaf('broad', { squadrons: ['sqA', 'sqC'] });
    const parentBad   = group('parent2', [broadChild], { squadrons: ['sqA'] });
    assert.ok(validateTree(doc([parentBad])));
  });

  await t.test('overallScore excludes modules invisible to the pilot squadron', () => {
    const sqOnly = leaf('sqOnly', { squadrons: ['sqA'] });
    const general = leaf('general');
    const index = buildIndex(doc([sqOnly, general]));
    assert.equal(overallScore(index, 'sqB', { general: graded('G') }), 1); // only 'general' visible & completed
  });
});

/* ══════════════════════════════════════════════════════════
   validateTree — structural rules
══════════════════════════════════════════════════════════ */

test('validateTree', async (t) => {
  await t.test('valid single-leaf tree passes', () => {
    assert.equal(validateTree(doc([leaf('a')])), null);
  });

  await t.test('rejects wrong document version/shape', () => {
    assert.ok(validateTree({ categories: [] }));
    assert.ok(validateTree(null));
  });

  await t.test('rejects duplicate ids', () => {
    assert.ok(validateTree(doc([leaf('a'), leaf('a')])));
  });

  await t.test('rejects a module with neither sub-modules nor grading items', () => {
    const empty = { id: 'x', title: 'x', subModules: [], gradingItems: [] };
    assert.ok(validateTree(doc([empty])));
  });

  await t.test('rejects single-item id that does not match module id', () => {
    const bad = { id: 'x', title: 'x', subModules: [], gradingItems: [item('y', 'G')] };
    assert.ok(validateTree(doc([bad])));
  });

  await t.test('rejects multi-item ids not prefixed with moduleId::', () => {
    const bad = { id: 'x', title: 'x', subModules: [], gradingItems: [item('x::a', 'G'), item('stray', 'G')] };
    assert.ok(validateTree(doc([bad])));
  });

  await t.test('rejects self-requirement and unknown requirement targets', () => {
    assert.ok(validateTree(doc([leaf('a', { requirements: [{ module_id: 'a', min_grade: 'G' }] })])));
    assert.ok(validateTree(doc([leaf('a', { requirements: [{ module_id: 'ghost', min_grade: 'G' }] })])));
  });

  await t.test('rejects a circular requirement chain', () => {
    const tree = doc([
      leaf('a', { requirements: [{ module_id: 'b', min_grade: 'G' }] }),
      leaf('b', { requirements: [{ module_id: 'a', min_grade: 'G' }] }),
    ]);
    assert.ok(validateTree(tree));
  });
});
