# Skill tree JSON format

The training curriculum (`data/skill-tree.json`) is a single recursive
**Module** type — no separate "category" concept. Read this before hand-
authoring JSON to import through the skill tree editor
(`skills-admin.html` → SKILL TREE EDITOR → IMPORT JSON), or before touching
`public/js/skills-core.js`, which is the single source of truth for all the
rules below (`validateTree`, `moduleState`, `effectiveSquadrons`, etc. —
both the browser pages and `server.js` call into it, so there's one
definition of these rules, not several).

## Document shape

```json
{
  "version": 2,
  "tree": [ /* array of root Modules */ ]
}
```

## Module

```json
{
  "id": "wwe",
  "title": "Wing Work Exercise",
  "description": "Optional free text.",
  "squadrons": ["sqA"],
  "requirements": [{ "module_id": "some-other-module", "min_grade": "G" }],
  "subModules": [ /* nested Modules */ ],
  "gradingItems": [ /* GradingItem[] */ ]
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique across the **entire** tree — module ids and grading-item ids share one namespace. |
| `title` | yes | Display name. |
| `description` | no | Free text shown to pilots and instructors. |
| `squadrons` | no | See **Squadron scoping** below. Omit entirely (don't set `[]`) to inherit. |
| `requirements` | no | See **Requirements** below. |
| `subModules` | yes (array, may be empty) | Nested Modules — this is what makes the tree arbitrarily deep, e.g. UPT → Formation Flying → Fingertip. |
| `gradingItems` | yes (array, may be empty) | The atomic gradable leaves belonging to *this* module. |

A Module needs **at least one** entry across `subModules`/`gradingItems` —
one with neither can never be marked passed. A Module is one of three
practical shapes:

- **Pure organizer** — `subModules` only, empty `gradingItems`. E.g. "UPT",
  "Formation Flying". Nothing to grade directly; it passes once everything
  nested under it passes.
- **Pure exercise** — `gradingItems` only, empty `subModules`. E.g. "Wing
  Work Exercise", "Airfield Patterns", or a simple single-grade module.
- **Mixed** (rare but allowed) — both non-empty: the module has its own
  direct grading criteria *and* further sub-modules underneath it.

## GradingItem

```json
{ "id": "wwe::l1", "label": "Level 1", "min_pass_grade": "G" }
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | See the id convention below — it's not free-form once there's more than one item. |
| `label` | no | Shown when a module has 2+ items (e.g. "Level 1", "Base", "Downwind"). Omit/empty for a single-item module — the UI just shows it as "the module's grade". |
| `min_pass_grade` | yes | One of `U`, `F`, `G`, `E`. |

**Id convention** (enforced by `validateTree`):

- A module with **exactly one** grading item — the common case, including
  every simple single-grade module — must give that item the **same id as
  the module itself** (`gradingItems: [{"id": "fund-001", ...}]` on module
  `fund-001`). This is what lets pilot grade records
  (`data/skill-grades.json[sub][itemId]`) stay a flat, simple lookup even
  though the tree is recursive.
- A module with **two or more** items must prefix every item id with the
  module's own id and `::`, e.g. `wwe::l1`, `wwe::l2`, `wwe::l3`, or
  `airfield-patterns::base` / `::downwind` / `::td`. The suffix after `::`
  is otherwise free-form.

## Pass / completion rules

A Module is **completed** once *every* one of its `subModules` is completed
**and** every one of its own `gradingItems` has a recorded grade at or
above that item's `min_pass_grade` — plain AND, no partial credit, no
weighting. A pilot's overall score is simply
`(# modules completed) / (# modules visible to them)`, counted recursively
at every depth of the tree (grading items themselves aren't counted, only
modules) — there is no `weight` field anywhere in this schema.

## Requirements

```json
"requirements": [{ "module_id": "airfield-theory", "min_grade": "G" }]
```

Separate from the `subModules` composition tree, `requirements` is a
**cross-cutting DAG**: a module can require any other module anywhere in
the tree (not just a sibling or ancestor) to be passed at a given grade
before it unlocks. A module can list more than one requirement — all of
them must be met. Requirement chains are validated **acyclic**
(`skillsCore.detectRequirementCycle`) — a circular requirement is rejected
on import/save, not silently tolerated.

For comparing a target module's grade against `min_grade`, the target's
**effective grade** is the *weakest* grade among all of its own grading
items and sub-modules' effective grades (recursively) — for a normal
single-item module this is just that one item's grade.

## Squadron scoping

```json
"squadrons": ["sqA", "sqB"]
```

- Omit `squadrons` entirely (don't set it to `[]`) to **inherit** the
  nearest ancestor's restriction. A root module with no `squadrons` is
  visible to every squadron.
- A child's own `squadrons` (if set) must be a **subset** of its nearest
  restricting ancestor's — a child can narrow visibility further, but can
  never broaden it back out. `validateTree` rejects a broader child.
- This inheritance is why importing a branch "for squadron X" only needs to
  set `squadrons: ["X"]` on the **top-level** node(s) being inserted —
  everything nested underneath just inherits it. The admin UI's
  squadron-scoped import does exactly this automatically (see below).

## Worked example

```json
{
  "version": 2,
  "tree": [
    {
      "id": "upt", "title": "UPT", "subModules": [
        {
          "id": "formation", "title": "Formation Flying", "subModules": [
            {
              "id": "fingertip", "title": "Fingertip", "subModules": [
                {
                  "id": "wwe", "title": "Wing Work Exercise", "subModules": [],
                  "gradingItems": [
                    { "id": "wwe::l1", "label": "Level 1", "min_pass_grade": "G" },
                    { "id": "wwe::l2", "label": "Level 2", "min_pass_grade": "G" },
                    { "id": "wwe::l3", "label": "Level 3", "min_pass_grade": "G" }
                  ]
                }
              ], "gradingItems": []
            }
          ], "gradingItems": []
        },
        {
          "id": "airfield-theory", "title": "Airfield Ops Theory",
          "subModules": [], "gradingItems": [{ "id": "airfield-theory", "min_pass_grade": "G" }]
        },
        {
          "id": "airfield-patterns", "title": "Airfield Patterns", "subModules": [],
          "requirements": [{ "module_id": "airfield-theory", "min_grade": "G" }],
          "gradingItems": [
            { "id": "airfield-patterns::base",     "label": "Base",     "min_pass_grade": "G" },
            { "id": "airfield-patterns::downwind", "label": "Downwind", "min_pass_grade": "G" },
            { "id": "airfield-patterns::td",       "label": "Touchdown","min_pass_grade": "G" }
          ]
        }
      ], "gradingItems": []
    }
  ]
}
```

`airfield-patterns` won't unlock until `airfield-theory` is passed (a
requirement, not composition) — that's the theory-gates-practice pattern.
`wwe` only counts as completed once all 3 levels are individually graded
`G` or better.

## Importing through the admin UI

The tree editor (outline pane's IMPORT JSON / EXPORT JSON, and each
module's IMPORT JSON HERE / EXPORT SUBTREE) reuses this exact format —
export is the fastest way to see a real, valid example to copy from.
Two import modes:

- **Whole-tree** (outline toolbar) — replaces the entire working draft with
  the uploaded document.
- **Per-module** (a module's IMPORT JSON HERE, or "+ IMPORT JSON AS ROOT")
  — additively inserts an uploaded module or array of modules as new
  sub-modules of the selected module (or as new roots).

### Importing for one squadron only

The **SQUADRON** dropdown at the top of the outline pane doubles as the
import scope selector — there's no separate control. **Pick the squadron
there first**, then use any IMPORT JSON button:

- Every IMPORT JSON button's label changes to show the active scope (e.g.
  "IMPORT JSON → 639 SQ") whenever a squadron is selected, and a note above
  the outline list says the same thing — if a button just says "IMPORT
  JSON" with no arrow, the dropdown is on ALL SQUADRONS and import behaves
  unscoped.
- With a squadron selected, **whole-tree import stops being destructive**:
  instead of replacing everything, the uploaded document's root modules are
  force-scoped to that squadron (any `squadrons` they declare themselves is
  stripped and overridden) and merged in as new roots, leaving every other
  squadron's — and general/shared — content untouched.
- Per-module import applies the same force-scoping to whatever you upload,
  on top of its normal additive behavior.
- Switch the dropdown back to **ALL SQUADRONS** for unscoped import/export
  and to see the whole tree in the outline again — the dropdown is also
  what filters which modules the outline shows.

Either way, any id already present anywhere in the tree causes the whole
import to be **rejected** with a "Duplicate id" error — nothing is ever
silently overwritten. Delete the conflicting module first (or rename the
id in your JSON) and re-import. Nothing is sent to the server until you
click SAVE TREE — import only loads into the local working draft, so you
can review it in the outline first.
