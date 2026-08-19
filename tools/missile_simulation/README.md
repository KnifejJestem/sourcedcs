# Missile Flyout Scope

A browser-based, 3D point-mass simulator for air-to-air missile engagements. Each aircraft flies a sequence of named **phases** — Start, Intercept, Crank, Out, Cold — set up as a table of speed/altitude/heading targets, fire, and see both missiles' ground tracks, time of flight, seeker-activation range, miss distance and intercept range plotted on a side (range/altitude) view and a to-scale top-down (range/cross-range) view.

Either aircraft can fly a **crank** (turn to hold the other aircraft at a fixed angle off its own nose, starting the instant after its own launch) and/or a full **out** maneuver (continuously turns to point directly away from the other aircraft, combinable with crank: crank right after launch, then break out once its trigger fires) — and the target can **fire back**, turning the setup into a genuine two-missile engagement.

It ships with a built-in AIM-120C model and can also load **any DCS weapon Lua table** (a `.lua` file, or pasted text) and simulate that instead — the physics, drag curve, motor thrust and guidance parameters are all read out of the table rather than hardcoded.

This is a modeling tool for envelope planning and intuition-building, not a replica of Eagle Dynamics' 6-DOF flight model. See **Known limitations** below and the caveats panel under the scope in the app itself.

## Running it

This is a static site with no build step — `server.js` just serves the folder over Express. It uses native ES modules (`import`/`export`) and `fetch()` to load the built-in weapon's data file, both of which browsers block under the `file://` protocol, so it needs to be served rather than opened by double-clicking `index.html`.

```bash
cd tools/missile_simulation
npm install
npm start                 # http://localhost:5050
PORT=8080 npm start       # custom port
```

Any other static file server (`python3 -m http.server`, `npx serve`, `php -S`, etc.) works just as well if you'd rather skip `npm install` — except for saving presets, which needs `server.js`'s own write endpoint and won't work under a bare static host.

## Folder structure

```
missile_simulation/
├── index.html                  entry point — markup only
├── examples/
│   └── headless-engagement.mjs runs one engagement from plain Node, no browser (see below)
├── public/
│   ├── css/
│   │   └── style.css           all styles
│   └── js/
│       ├── package.json        {"type":"module"} — lets plain Node import these files as ES modules
│       ├── constants.js        unit conversions, g
│       ├── atmosphere.js       ISA atmosphere model (density, speed of sound)
│       ├── missile-physics.js  drag lookup, mass-at-t, motor thrust from Isp
│       ├── aircraft.js         3D shooter/target flight-path co-simulation (Start/Intercept/Crank/Out/Cold phases)
│       ├── sim-engine.js       the 3D flyout integrator (simulateEngagement3D) + Rmax solver
│       ├── lua-parser.js       generic DCS-dialect Lua table-literal parser
│       ├── weapon-extract.js   turns a parsed Lua table (or one of this app's own weapon JSON files) into simulator parameters
│       ├── engagement.js       runEngagement() — resolves a full two-aircraft, two-missile engagement; pure, no DOM
│       ├── state.js            shared mutable app state (rail values, loaded weapon(s), aircraft paths)
│       ├── dom.js               tiny `el(id)` helper
│       ├── scope-render.js     canvas drawing for both views (side + top-down)
│       └── main.js             DOM wiring, weapon loading UI, fire/interaction logic — a thin adapter over engagement.js
└── data/
    ├── weapons/
    │   └── aim-120c.json       built-in weapon, fetched at startup
    ├── samples/
    │   └── sample-weapon.lua   synthetic weapon table for exercising the Lua loader
    └── presets/                saved aircraft setups (Start + phases), created on first run
```

## Running an engagement without a browser

`public/js/engagement.js` exports `runEngagement()`, the same function `main.js` calls when you hit any control in the UI — it takes a shooter config, a target config, and up to two missiles, and returns both aircraft's full 3D flight paths plus each missile's flyout (path + summary: hit/miss, time of flight, miss distance, seeker-activation event, etc.). It has no dependency on `window`, `document`, or `fetch`, so it runs identically under plain Node — useful for batch runs, envelope sweeps, or scripting an engagement outside the scope UI.

```bash
node examples/headless-engagement.mjs
```

That script shows the full pattern: load a weapon JSON file and turn it into a missile object with `missileFromJson()` (`weapon-extract.js`), build a shooter/target config (same shape as `state.js`'s `state.shooter`/`state.target` — Start + Intercept/Crank/Out/Cold phases, all user-facing units: kt/ft/nm/deg), and call `runEngagement()`. `public/js/package.json` (`{"type":"module"}`) is what lets a bare `node` invocation resolve these files' `import`/`export` syntax without a bundler.

`examples/mar-sweep.mjs` is a larger example built the same way: for a grid of Friendly (speed, altitude), it binary-searches (via repeated `runEngagement()` calls) for the smallest range at which Friendly must execute a defensive break to guarantee a Hostile missile misses, no matter the Hostile's speed/altitude/launch range. Every grid resolution and scenario parameter is a CLI flag (`--help` for the full list); it shards the outer grid across `worker_threads` via `--workers`, and streams results to a CSV as they complete. `examples/plot-mar.py` (`pip install matplotlib numpy pandas`) turns that CSV into a 3D surface plot and a 2D heatmap.

## How a shot is set up

Each aircraft (Shooter, Target — identical field sets, fully symmetric) is a **Start** state plus up to four **phases**, shown as one row per phase in that aircraft's table:

- **Start** (mandatory): position (target only — the shooter is always the origin), altitude, speed. No heading field — see below.
- **Intercept** (mandatory, always governs the launch instant itself, even if Crank is enabled): acceleration, desired speed, climb/descent angle, desired altitude, and an **offset angle** referenced from *pointing at* the other aircraft (0° = pure pursuit, +/− = lead/lag). A default all-zero Intercept reproduces "flies straight" for the shooter and "pursues"/hot for the target.
- **Crank** (optional, no trigger of its own — supersedes Intercept starting the instant *after* launch if enabled, never at the launch instant itself, so a shooter always fires still pointed per Intercept and only turns to crank once the missile is away): same fields, ending in a **crank angle** (same "pointing at" reference, positive-only — "to my own right," no left option, matching a real crank).
- **Out** (optional, independent of Crank): same fields, ending in a **turn rate** instead of an angle — this is the one phase *not* assumed at a fixed 3g. Always targets pointing directly *away* from the other aircraft, continuously (not a fixed arc computed once at the trigger instant — it keeps re-aiming at wherever the other aircraft actually is). Supersedes whichever of Intercept/Crank was running once its trigger fires: **Missile activation** (default — this aircraft's own missile no longer needs radar support to guide, so it breaks off; the target's version needs **Return fire** enabled, since otherwise there's no missile of its own to activate) or a plain **shooter–target range** threshold.
- **Cold** (only meaningful if Out is enabled): same fields, ending in an offset angle referenced from *pointing away* (0° = cold, ±90° = beam, 180° = hot) — takes over the instant Out's heading-hold first settles onto pointing away.

Acceleration and climb/descent angle are always magnitudes — every phase converges its own speed (toward its desired speed, at that acceleration) and altitude (toward its desired altitude, at that climb angle) and **holds once reached**, re-based from wherever the aircraft actually is the moment that phase takes over. There's no separate heading input anywhere: each aircraft's initial heading is derived so the bearing to the other aircraft's Start position already reads as its Intercept offset angle — always Intercept, even with Crank enabled, since the launch instant has to be flown per Intercept — a 0° offset with a co-planar setup starts with zero heading error, same as "straight" always meant, and hot/cold/beaming for either aircraft is just that phase's offset angle at 0°/180°/±90° rather than a separate convention.

- **Return fire**: lets the target fire its own missile (its own weapon selection) once shooter–target range crosses a trigger you set, independently guided against the shooter's own flight path.

Drag either aircraft's marker on the *side* view to reposition its Start altitude/range directly (initial setup is always planar — cross-range only emerges from a phase after launch), or use the table sliders. **Fire** runs the simulation; **Snap target to Rmax** binary-searches Start range for the maximum range that still produces an intercept for the shooter's missile under the current setup.

## Loading a custom weapon

Weapon > **Load .lua file** (or **Or paste table text**) accepts a DCS weapon definition table — a whole dumped Lua file, or just the table literal. The parser (`lua-parser.js`) handles the dialect these files actually use (nested tables, `["key"] = value`, positional items, `--` and `--[[ ]]` comments, the `<N>{...}` / `<table N>` serializer forms), and `weapon-extract.js` walks up to 3 levels deep looking for anything weapon-shaped (handling `client`/`server` wrapper tables, folding byte-identical copies into one entry and flagging genuine divergences).

A table needs at minimum a mass (`M` or `fm.mass`), `fm.S` (reference area) and an `fm.Cx0` drag table to be simulatable. Everything else that's missing gets a reasonable default, and every default or ambiguous field is listed under **Values in use** in the rail so you can see exactly what was assumed versus what came from the file. `data/samples/sample-weapon.lua` is a synthetic example that exercises several of these fallback paths (an alternate `ap` autopilot table name, no loft flag at all, a `D_max`-only seeker range, and a client/server duplicate wrapper).

Every weapon you load is added to both weapon dropdowns — the main one (the shooter's missile) and the **Return fire** one (the target's, if enabled) — so you can pit two different loaded weapons against each other.

## Known limitations

- Induced drag isn't modeled — the missile pays nothing for lift during the loft hold or terminal turn, so high-altitude/long-range numbers come out optimistic.
- Motor thrust is derived from the table's `impulse` (specific impulse, Isp) field; if a weapon has no usable Isp/fuel data, thrust is instead calibrated so the missile just reaches its own `Mach_max` at burnout, and this fallback is flagged in the report.
- Neither aircraft is reactive beyond its configured phases: Start/Intercept/Crank/Out/Cold are all pre-planned flight paths computed from the tables, not a live response to the missile(s) in flight (no notching, no chaff/flares).
- Every phase's heading-hold is a bang-bang controller (full-rate turn until the commanded angle is reached, then hold), not a smooth proportional one — expect a little chatter around the commanded angle rather than a perfectly steady hold. Speed and altitude convergence (acceleration, climb/descent angle) are linear ramps that clamp exactly at the desired value and hold, not overshoot-and-correct.
- An activation-triggered Out is resolved in a fixed sequence of extra simulation passes rather than a live check, since it depends on when a missile (this aircraft's own) goes active — a missile's guidance only ever depends on the aircraft it's chasing, never the firer's own post-launch path, which is what makes this resolvable without iterating to a fixed point. One accepted approximation: the shooter's own activation time is resolved against the target's *pre-break* path, so if the target's return-fire-triggered break somehow started before the shooter's missile activates, that wouldn't be reflected — not a realistic concern, since the target's own missile can't activate before it's even launched.
- Guidance is full 3D proportional navigation, decoupled into independent elevation and azimuth channels that share one g-limit budget — a deliberate, minimal generalization of the original single-plane model (verified to reduce to its exact numbers when cross-range is zero), not a genuine 6-DOF intercept geometry.
- The side (range/altitude) view deliberately does *not* scale its two axes equally (altitude and range are wildly different magnitudes, hence "vertical scale exaggerated"), so it understates true separation once either aircraft cranks or goes Out — the top-down view is the one to check for that, and it *is* rendered with both axes to the same scale, so a real circular turn looks circular. The top-down view, in turn, carries no altitude information.
- Which weapon-table field means "seeker goes active" isn't documented by ED; both plausible candidates (`D_max` and `sensor.sens_far_dist`) are shown, labeled by the field they came from rather than asserted as fact.
- Rmax is usually limited by the weapon's `Life_Time` self-destruct timer rather than by energy.
- Return fire launches along the firing aircraft's own current nose heading at the trigger instant — there's no off-boresight cueing modeled. A target that's currently facing away from the shooter (e.g. cold and not maneuvering) will "return fire" a shot that can't possibly hit, which is a realistic consequence of that assumption, not a bug.

Full detail on each of these lives in the caveats panel under the scope in the running app.

## Compact mode and presets

The toolbar between the scope views and the aircraft tables has two things:

- **Inputs: Sliders / Numbers** — switches every tunable field on the page between a range slider and a plain type-in number field (same min/max/step either way), for faster exact-value entry. The choice is remembered across reloads (`localStorage`).
- **Preset** — save the currently-selected aircraft's full settings (Start + all four phases) under a name, or load a previously-saved one onto either aircraft (the model is symmetric, so a Shooter preset applies cleanly to the Target and vice versa). Presets are real files under `data/presets/`, written by a small API in `server.js` — this is the one part of the app that needs a real server rather than a bare static host, since saving requires writing a file. Preset names are restricted to letters, numbers, spaces, `_` and `-`.