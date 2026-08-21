'use strict';

/* skills-core.js — shared tree/grade/scoring logic for the training system.
   Loaded as a plain <script> (no bundler in this repo) before skills.js /
   skills-admin.js, and also require()-able from server.js and the test
   suite via the module.exports tail at the bottom. Single source of truth
   for the recursive Module/GradingItem model — see
   docs/atobrief or the skills-admin redesign plan for the schema:

   ModuleNode = { id, title, description?, squadrons?,
                  requirements?: [{module_id, min_grade}],
                  subModules: ModuleNode[], gradingItems: GradingItem[] }
   GradingItem = { id, label?, min_pass_grade: 'U'|'F'|'G'|'E' }
   Document    = { version: 2, tree: ModuleNode[] } */

var GRADE_VALUES = { U: 0, F: 1, G: 2, E: 3 };
var GRADE_NAMES  = { U: 'Unsatisfactory', F: 'Fair', G: 'Good', E: 'Excellent' };
var VALID_GRADES = ['U', 'F', 'G', 'E'];

function gradeValue(g) { return (g != null && GRADE_VALUES[g] != null) ? GRADE_VALUES[g] : -1; }
function gradeFromValue(v) {
  for (var k in GRADE_VALUES) { if (GRADE_VALUES[k] === v) return k; }
  return null;
}

/* ── Tree indexing ──────────────────────────────────────── */
/* One recursive walk of the whole document, producing lookup maps used by
   everything else here. */
function buildIndex(doc) {
  var modules   = {};   /* id -> node */
  var parentOf  = {};   /* id -> parentId | null */
  var itemOwner = {};   /* gradingItemId -> moduleId */
  var roots     = (doc && Array.isArray(doc.tree)) ? doc.tree : [];

  function walk(node, parentId) {
    if (!node || !node.id) return;
    modules[node.id]  = node;
    parentOf[node.id] = parentId || null;
    (node.gradingItems || []).forEach(function (it) {
      if (it && it.id) itemOwner[it.id] = node.id;
    });
    (node.subModules || []).forEach(function (child) { walk(child, node.id); });
  }
  roots.forEach(function (r) { walk(r, null); });

  return { modules: modules, parentOf: parentOf, itemOwner: itemOwner, roots: roots };
}

function breadcrumb(index, id) {
  var parts = [];
  var cur   = id;
  var guard = 0;
  while (cur && index.modules[cur] && guard++ < 200) {
    parts.unshift(index.modules[cur].title || cur);
    cur = index.parentOf[cur];
  }
  return parts;
}

/* ── Squadron inheritance ───────────────────────────────── */
/* Effective visibility of a node: its own `squadrons` if set, else the
   nearest ancestor's, else null (= visible to everyone). */
function effectiveSquadrons(index, id) {
  var cur   = id;
  var guard = 0;
  while (cur && guard++ < 200) {
    var node = index.modules[cur];
    if (!node) return null;
    if (node.squadrons && node.squadrons.length) return node.squadrons;
    cur = index.parentOf[cur];
  }
  return null;
}

/* The restriction a NEW child of `parentId` would inherit — used by the
   editor to constrain which squadrons are selectable on a child. */
function ancestorSquadronRestriction(index, parentId) {
  if (!parentId) return null;
  return effectiveSquadrons(index, parentId);
}

function moduleVisibleToSquadron(index, id, squadronId) {
  var sqs = effectiveSquadrons(index, id);
  if (!sqs || !sqs.length) return true;
  if (!squadronId) return false;
  return sqs.indexOf(squadronId) !== -1;
}

/* ── Grade / pass-state resolution ──────────────────────── */
/* A module's "effective grade" is the weakest (minimum) grade among its own
   gradingItems and sub-modules' effective grades — used for requirement
   min_grade comparisons. For a single-item leaf module this is exactly
   that one item's grade (matches today's behaviour 1:1). Returns null if
   any descendant leaf is ungraded. */
function effectiveModuleGrade(index, moduleId, grades) {
  var node = index.modules[moduleId];
  if (!node) return null;
  var worst = null;

  (node.gradingItems || []).forEach(function (it) {
    var rec = grades[it.id];
    var v   = rec ? gradeValue(rec.grade) : -1;
    if (worst == null || v < worst) worst = v;
  });
  (node.subModules || []).forEach(function (sub) {
    var v = gradeValue(effectiveModuleGrade(index, sub.id, grades));
    if (worst == null || v < worst) worst = v;
  });

  if (worst == null || worst < 0) return null;
  return gradeFromValue(worst);
}

/* locked | not-started | in-progress | completed */
function moduleState(index, moduleId, grades) {
  var node = index.modules[moduleId];
  if (!node) return 'not-started';

  var reqs = node.requirements || [];
  for (var i = 0; i < reqs.length; i++) {
    var r = reqs[i];
    var g = effectiveModuleGrade(index, r.module_id, grades);
    if (gradeValue(g) < gradeValue(r.min_grade)) return 'locked';
  }

  var childStates = [];
  (node.gradingItems || []).forEach(function (it) {
    var rec = grades[it.id];
    if (!rec) { childStates.push('not-started'); return; }
    childStates.push(gradeValue(rec.grade) >= gradeValue(it.min_pass_grade) ? 'completed' : 'in-progress');
  });
  (node.subModules || []).forEach(function (sub) {
    childStates.push(moduleState(index, sub.id, grades));
  });

  if (!childStates.length) return 'not-started';
  if (childStates.every(function (s) { return s === 'completed'; })) return 'completed';
  if (childStates.some(function (s) { return s === 'locked'; })) return 'locked';
  if (childStates.every(function (s) { return s === 'not-started'; })) return 'not-started';
  return 'in-progress';
}

/* ── Counting / scoring ─────────────────────────────────── */
function countModules(node) {
  if (!node) return 0;
  var n = 1;
  (node.subModules || []).forEach(function (s) { n += countModules(s); });
  return n;
}
function countCompletedModules(index, node, grades) {
  if (!node) return 0;
  var n = (moduleState(index, node.id, grades) === 'completed') ? 1 : 0;
  (node.subModules || []).forEach(function (s) { n += countCompletedModules(index, s, grades); });
  return n;
}

/* Squadron-aware variants: a node invisible to the squadron is excluded
   entirely, and (by the enforced subset-of-parent invariant) so is its
   whole subtree, so we can skip recursing into it. */
function countVisibleModules(index, node, squadronId) {
  if (!node || !moduleVisibleToSquadron(index, node.id, squadronId)) return 0;
  var n = 1;
  (node.subModules || []).forEach(function (s) { n += countVisibleModules(index, s, squadronId); });
  return n;
}
function countVisibleCompletedModules(index, node, squadronId, grades) {
  if (!node || !moduleVisibleToSquadron(index, node.id, squadronId)) return 0;
  var n = (moduleState(index, node.id, grades) === 'completed') ? 1 : 0;
  (node.subModules || []).forEach(function (s) { n += countVisibleCompletedModules(index, s, squadronId, grades); });
  return n;
}

function visibleRootModules(index, squadronId) {
  return index.roots.filter(function (r) { return moduleVisibleToSquadron(index, r.id, squadronId); });
}

/* Flat overall score for one pilot: (# completed modules) / (# visible
   modules), counted recursively over every visible module at every depth.
   No weighting. */
function overallScore(index, squadronId, grades) {
  var roots = visibleRootModules(index, squadronId);
  var total = 0, completed = 0;
  roots.forEach(function (r) {
    total     += countVisibleModules(index, r, squadronId);
    completed += countVisibleCompletedModules(index, r, squadronId, grades);
  });
  return total ? (completed / total) : 0;
}

/* ── Requirement cycle detection ────────────────────────── */
/* DFS over the requirements-only edge graph (module --requires--> module).
   Returns the offending cycle as an array of ids, or null if acyclic. */
function detectRequirementCycle(index) {
  var WHITE = 0, GRAY = 1, BLACK = 2;
  var color = {};
  var stack = [];
  var ids   = Object.keys(index.modules);
  ids.forEach(function (id) { color[id] = WHITE; });

  function visit(id) {
    color[id] = GRAY;
    stack.push(id);
    var node = index.modules[id];
    var reqs = (node && node.requirements) || [];
    for (var i = 0; i < reqs.length; i++) {
      var next = reqs[i].module_id;
      if (!index.modules[next]) continue;
      if (color[next] === GRAY) {
        var start = stack.indexOf(next);
        return stack.slice(start).concat(next);
      }
      if (color[next] === WHITE) {
        var cyc = visit(next);
        if (cyc) return cyc;
      }
    }
    stack.pop();
    color[id] = BLACK;
    return null;
  }

  for (var j = 0; j < ids.length; j++) {
    if (color[ids[j]] === WHITE) {
      var cyc = visit(ids[j]);
      if (cyc) return cyc;
    }
  }
  return null;
}

/* ── Whole-document validation (shared by client pre-flight + server) ──── */
function validateTree(doc) {
  if (!doc || doc.version !== 2 || !Array.isArray(doc.tree)) {
    return 'Document must be { version: 2, tree: [...] }';
  }
  var seenIds = {};

  function checkNode(node, path, ancestorSquadrons) {
    if (!node || typeof node !== 'object') return 'Invalid node at ' + path;
    if (!node.id) return 'Missing id at ' + path;
    if (seenIds[node.id]) return 'Duplicate id "' + node.id + '"';
    seenIds[node.id] = true;
    if (!node.title) return 'Missing title at ' + path;

    var subModules   = Array.isArray(node.subModules)   ? node.subModules   : [];
    var gradingItems  = Array.isArray(node.gradingItems)  ? node.gradingItems  : [];
    if (!subModules.length && !gradingItems.length) {
      return 'Module "' + node.title + '" needs at least one sub-module or grading item';
    }

    var mySquadrons = (node.squadrons && node.squadrons.length) ? node.squadrons : null;
    if (mySquadrons && ancestorSquadrons) {
      var broader = mySquadrons.some(function (s) { return ancestorSquadrons.indexOf(s) === -1; });
      if (broader) return 'Squadron restriction on "' + node.title + '" is broader than its parent allows';
    }
    var effectiveForChildren = mySquadrons || ancestorSquadrons || null;

    if (gradingItems.length === 1) {
      if (gradingItems[0].id !== node.id) {
        return 'Single grading item on "' + node.title + '" must share the module\'s id';
      }
    } else if (gradingItems.length > 1) {
      var prefixOk = gradingItems.every(function (it) { return it.id && it.id.indexOf(node.id + '::') === 0; });
      if (!prefixOk) return 'Multi-item grading item ids on "' + node.title + '" must be prefixed "' + node.id + '::"';
    }
    for (var i = 0; i < gradingItems.length; i++) {
      var it = gradingItems[i];
      if (!it.id) return 'Grading item missing id on "' + node.title + '"';
      if (seenIds[it.id] && it.id !== node.id) return 'Duplicate id "' + it.id + '"';
      seenIds[it.id] = true;
      if (VALID_GRADES.indexOf(it.min_pass_grade) === -1) return 'Invalid min_pass_grade on grading item ' + it.id;
    }

    for (var j = 0; j < subModules.length; j++) {
      var err = checkNode(subModules[j], path + '/' + subModules[j].id, effectiveForChildren);
      if (err) return err;
    }
    return null;
  }

  for (var k = 0; k < doc.tree.length; k++) {
    var root = doc.tree[k];
    var err0 = checkNode(root, (root && root.id) || ('root[' + k + ']'), null);
    if (err0) return err0;
  }

  var index = buildIndex(doc);
  var moduleIds = Object.keys(index.modules);
  for (var m = 0; m < moduleIds.length; m++) {
    var node2 = index.modules[moduleIds[m]];
    var reqs  = node2.requirements || [];
    for (var r = 0; r < reqs.length; r++) {
      if (reqs[r].module_id === node2.id) return 'Module "' + node2.title + '" cannot require itself';
      if (!index.modules[reqs[r].module_id]) return 'Unknown requirement target "' + reqs[r].module_id + '"';
      if (VALID_GRADES.indexOf(reqs[r].min_grade) === -1) return 'Invalid min_grade in a requirement on "' + node2.title + '"';
    }
  }
  var cycle = detectRequirementCycle(index);
  if (cycle) return 'Circular requirement: ' + cycle.join(' -> ');

  return null; /* valid */
}

/* ── ID helpers ─────────────────────────────────────────── */
function slugify(str) {
  return (String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)) || 'item';
}
/* Builds a collision-free id for a new grading item under `moduleId`. */
function gradingItemId(moduleId, label, index) {
  var base = moduleId + '::' + slugify(label);
  var id   = base;
  var n    = 2;
  while (index && index.itemOwner && index.itemOwner[id] && index.itemOwner[id] !== moduleId) {
    id = base + '-' + (n++);
  }
  return id;
}

/* ── Export ──────────────────────────────────────────────
   Build a real `skillsCore` object — as a plain <script> in the browser
   this becomes an actual `window.skillsCore` global (what skills.js /
   skills-admin.js call into); in Node it doubles as module.exports so
   server.js and the test suite can require() it. Declaring the individual
   pieces as top-level function/var above and only wrapping them here (not
   assigning to `module.exports` directly) is what makes both work from the
   same file. */
var skillsCore = {
  GRADE_VALUES: GRADE_VALUES, GRADE_NAMES: GRADE_NAMES, VALID_GRADES: VALID_GRADES,
  gradeValue: gradeValue, gradeFromValue: gradeFromValue,
  buildIndex: buildIndex, breadcrumb: breadcrumb,
  effectiveSquadrons: effectiveSquadrons, ancestorSquadronRestriction: ancestorSquadronRestriction,
  moduleVisibleToSquadron: moduleVisibleToSquadron,
  effectiveModuleGrade: effectiveModuleGrade, moduleState: moduleState,
  countModules: countModules, countCompletedModules: countCompletedModules,
  countVisibleModules: countVisibleModules, countVisibleCompletedModules: countVisibleCompletedModules,
  visibleRootModules: visibleRootModules, overallScore: overallScore,
  detectRequirementCycle: detectRequirementCycle, validateTree: validateTree,
  slugify: slugify, gradingItemId: gradingItemId,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = skillsCore;
}
