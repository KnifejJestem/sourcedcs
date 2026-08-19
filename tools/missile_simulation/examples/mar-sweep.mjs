#!/usr/bin/env node
// Minimum Abort Range (MAR) sweep: for a grid of Friendly (speed x, altitude
// y), finds the smallest range z at which Friendly must trigger its
// defensive OUT break to guarantee a Hostile missile misses, no matter the
// Hostile's speed/altitude or the range it chooses to fire from (as long as
// it fires before Friendly's own break, i.e. at range >= z).
//
// Engine role mapping (see public/js/engagement.js / state.js for the
// underlying shapes):
//   Friendly -> "shooter": never fires (fireA disabled); flies a constant
//     Intercept at (x, y) until its own OUT triggers at range z, then
//     climbs/turns per --out-* and finishes on --cold-*.
//   Hostile  -> "target": flies HOT (Intercept, offsetAngle 0) the whole
//     time -- Crank/Out are disabled because a missile's guidance only ever
//     reads the DEFENDER's (Friendly's) track, never the firer's own
//     post-launch path (see sim-engine.js), so Hostile's post-launch
//     maneuvering can never affect whether its shot hits. Only its launch
//     conditions matter: speed (x2), altitude (y2), and launch range (r).
//
// safe(x, y, z) is true iff NO (r, x2, y2) combination in the searched
// domain produces a hit; it's monotonic in z (a larger z can only shrink
// the set of in-scope Hostile shots and give Friendly's break more lead
// time against whichever remain), so z is found by binary search.
//
// Run `node examples/mar-sweep.mjs --help` for all options.

import { readFileSync, createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import { runEngagement } from '../public/js/engagement.js';
import { missileFromJson } from '../public/js/weapon-extract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HELP = `
Usage: node examples/mar-sweep.mjs [options]

Outer (Friendly) grid:
  --x-min <kt>            default 400
  --x-max <kt>             default 800
  --x-step <kt>            default 50
  --y-min <ft>             default 1000
  --y-max <ft>             default 45000
  --y-step <ft>            default 2000

Hostile search domain:
  --mirror-hostile         classic MAR: Hostile always flies at exactly
                            Friendly's own (x, y) instead of being searched
                            independently. Ignores --hostile-speed-*/
                            --hostile-alt-* (nothing left to configure).
                            Removes the biggest cost factor -- the hostile
                            speed x altitude grid, searched fresh on every r
                            and every binary-search step -- so this is by far
                            the fastest mode. Off by default (full search).
  --hostile-speed-min/max/step <kt>  ignored if --mirror-hostile is set
                            (default: mirrors the Friendly x/x-step above)
  --hostile-alt-min/max/step <ft>    ignored if --mirror-hostile is set
                            (default: mirrors the Friendly y/y-step above)
  --r-max <nm>             default 60 -- comfortably covers the built-in
                            AIM-120C's real reach even under a favorable
                            (fast/high) Hostile launch. Just a STARTING GUESS
                            though, not a hard limit -- if it isn't enough for
                            a given point, the search doubles it automatically
                            until it finds a genuinely safe ceiling, up to
                            --r-max-hard-cap. A safe z always exists
                            eventually (far enough out, no missile can
                            reach), so this only needs to be in the right
                            ballpark to avoid wasted doubling steps.
  --r-max-hard-cap <nm>    default 300 -- runaway-loop guard; hitting this
                            means something is actually wrong for that (x,y),
                            not just that --r-max needs to be bigger.
  --r-step <nm>            default 2

z (MAR) binary search:
  --z-min <nm>             default 1  (reported directly if already safe)
  --z-tol <nm>             default 0.5 (binary-search stop tolerance)

Friendly's defensive maneuver (values from the OUT/COLD phases):
  --out-turn-rate <deg/s>  default 12
  --out-alt <ft>           default 22000
  --out-clb <deg>          default 30
  --cold-alt <ft>          default 25000
  --cold-clb <deg>         default 3
  --cold-accel <kt/s>      default 10
  --cold-speed <kt>        default 580

Misc:
  --weapon <path>          default data/weapons/aim-120c.json (Hostile's missile)
  --out <path>             default ./mar-sweep-output.csv
  --workers <n>            default 1 (shards the outer x/y grid across worker_threads)
  --help                   show this message
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

// Inclusive [min, max] stepped by `step`, always landing exactly on max as
// the last point even when it doesn't evenly divide -- avoids float-drift
// loops and guarantees the requested bound is actually included.
function range(min, max, step) {
  if (max <= min) return [min];
  const n = Math.max(1, Math.round((max - min) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(i === n ? max : min + i * step);
  return out;
}

function aircraft(spd0, alt0) {
  return {
    alt0, spd0,
    intercept: { accel: 0, desiredSpeed: spd0, climbAngle: 0, desiredAlt: alt0, offsetAngle: 0 },
    crank: { enabled: false, triggerType: 'launch', triggerRange: 20, accel: 0, desiredSpeed: spd0, climbAngle: 0, desiredAlt: alt0, crankAngle: 60 },
    out: { enabled: false, triggerType: 'activation', triggerRange: 20, accel: 0, desiredSpeed: spd0, climbAngle: 0, desiredAlt: alt0, turnRate: 12 },
    cold: { accel: 0, desiredSpeed: spd0, climbAngle: 0, desiredAlt: alt0, offsetAngle: 0 }
  };
}

function buildFriendly(x, y, zCandidate, cfg) {
  const f = aircraft(x, y);
  f.out = {
    enabled: true, triggerType: 'range', triggerRange: zCandidate,
    accel: 0, desiredSpeed: x, climbAngle: cfg.outClb, desiredAlt: cfg.outAlt, turnRate: cfg.outTurnRate
  };
  f.cold = { accel: cfg.coldAccel, desiredSpeed: cfg.coldSpeed, climbAngle: cfg.coldClb, desiredAlt: cfg.coldAlt, offsetAngle: 0 };
  return f;
}

function buildHostile(x2, y2, r) {
  return Object.assign(aircraft(x2, y2), { rng0: r });
}

// True iff some (r, hostile speed, hostile altitude) combination in the
// searched domain scores a hit against Friendly breaking out at zCandidate.
// Hostile starts already at range r (rather than a padded max range coasting
// down to it) -- equivalent given neither aircraft does anything but hold
// straight-line Intercept before Hostile's own launch, and cheaper to
// simulate.
// rCeiling is an explicit parameter, not cfg.rMax directly -- solveMAR needs
// to be able to test ceilings *beyond* the configured --r-max when the
// starting guess turns out too small (see below), and every r-search this
// function does must stay consistent with whatever ceiling is currently
// being tested.
function hostileCanHit(x, y, zCandidate, rCeiling, missile, cfg) {
  if (zCandidate > rCeiling) return false; // no in-scope Hostile shot exists
  const friendly = buildFriendly(x, y, zCandidate, cfg);
  const rs = range(zCandidate, rCeiling, cfg.rStep);
  // --mirror-hostile: classic MAR -- Hostile always flies at exactly
  // Friendly's own (x, y) rather than being searched independently. Collapses
  // the hostile speed/altitude search from up to hostileSpeedSteps x
  // hostileAltSteps combinations down to 1, by far the biggest cost lever
  // (that grid is the innermost loop, multiplied across every r and every
  // binary-search iteration).
  const x2s = cfg.mirrorHostile ? [x] : range(cfg.hostileSpeedMin, cfg.hostileSpeedMax, cfg.hostileSpeedStep);
  const y2s = cfg.mirrorHostile ? [y] : range(cfg.hostileAltMin, cfg.hostileAltMax, cfg.hostileAltStep);
  for (const r of rs) {
    for (const x2 of x2s) {
      for (const y2 of y2s) {
        const engagement = runEngagement({
          shooter: friendly, target: buildHostile(x2, y2, r),
          missileA: null, fireA: { enabled: false, triggerRange: 0 },
          missileB: missile, fireB: { enabled: true, triggerRange: r }
        });
        if (engagement.resultB && engagement.resultB.summary.hit) return true;
      }
    }
  }
  return false;
}

function safe(x, y, zCandidate, rCeiling, missile, cfg) {
  return !hostileCanHit(x, y, zCandidate, rCeiling, missile, cfg);
}

// A safe z always exists in principle -- breaking out far enough that no
// Hostile launch condition in the searched domain can reach Friendly at all
// is trivially safe (hostileCanHit returns false once zCandidate exceeds
// whatever ceiling is being tested). --r-max is only a STARTING GUESS for
// that ceiling, not a hard limit: if breaking at the current ceiling still
// isn't safe, double it and try again, so the search always finds the true
// crossing point rather than giving up at an arbitrary bound. rMaxHardCap
// is purely a runaway-loop guard for a genuinely pathological (x,y) --
// hitting it is a real "investigate this point" signal, not a normal
// "widen --r-max" one.
function solveMAR(x, y, missile, cfg) {
  if (safe(x, y, cfg.zMin, cfg.rMax, missile, cfg)) return cfg.zMin;

  let ceiling = cfg.rMax;
  while (!safe(x, y, ceiling, ceiling, missile, cfg)) {
    if (ceiling >= cfg.rMaxHardCap) return NaN;
    ceiling = Math.min(ceiling * 2, cfg.rMaxHardCap);
  }

  let lo = cfg.zMin, hi = ceiling; // invariant: safe(lo) === false, safe(hi) === true
  while (hi - lo > cfg.zTol) {
    const mid = (lo + hi) / 2;
    if (safe(x, y, mid, ceiling, missile, cfg)) hi = mid; else lo = mid;
  }
  return hi;
}

function buildConfig(a) {
  const num = (name, def) => (a[name] !== undefined && a[name] !== true) ? Number(a[name]) : def;

  const xMin = num('x-min', 400), xMax = num('x-max', 800), xStep = num('x-step', 50);
  const yMin = num('y-min', 1000), yMax = num('y-max', 45000), yStep = num('y-step', 2000);

  const weaponPath = a.weapon && a.weapon !== true
    ? path.resolve(process.cwd(), a.weapon)
    : path.join(__dirname, '..', 'data', 'weapons', 'aim-120c.json');
  const weaponJson = JSON.parse(readFileSync(weaponPath, 'utf8'));

  return {
    weaponJson,
    xMin, xMax, xStep, yMin, yMax, yStep,
    // --mirror-hostile: classic MAR -- Hostile flies at exactly Friendly's
    // own (x, y) instead of being searched independently over a whole
    // speed/altitude grid. The hostile-speed/alt-* flags are ignored when
    // this is set (nothing left to configure -- Hostile just mirrors x, y).
    mirrorHostile: !!a['mirror-hostile'],
    hostileSpeedMin: num('hostile-speed-min', xMin),
    hostileSpeedMax: num('hostile-speed-max', xMax),
    hostileSpeedStep: num('hostile-speed-step', xStep),
    hostileAltMin: num('hostile-alt-min', yMin),
    hostileAltMax: num('hostile-alt-max', yMax),
    hostileAltStep: num('hostile-alt-step', yStep),
    // 60nm default: comfortably covers the AIM-120C's real practical reach
    // even under favorable (high speed/altitude) Hostile launch conditions
    // -- confirmed empirically (a slow/low Friendly case that needed z ~
    // 33nm, just past the weapon's own nominal ~33nm Range_max field). Only
    // a starting guess either way; solveMAR expands past it automatically
    // if it's still not enough for a given point (see below).
    rMax: num('r-max', 60),
    rMaxHardCap: num('r-max-hard-cap', 300),
    rStep: num('r-step', 2),
    zMin: num('z-min', 1),
    zTol: num('z-tol', 0.5),
    outTurnRate: num('out-turn-rate', 12),
    outAlt: num('out-alt', 22000),
    outClb: num('out-clb', 30),
    coldAlt: num('cold-alt', 25000),
    coldClb: num('cold-clb', 3),
    coldAccel: num('cold-accel', 10),
    coldSpeed: num('cold-speed', 580),
    outPath: a.out && a.out !== true ? path.resolve(process.cwd(), a.out) : path.join(process.cwd(), 'mar-sweep-output.csv'),
    workers: num('workers', 1)
  };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { console.log(HELP); return; }

  const cfg = buildConfig(a);
  const xs = range(cfg.xMin, cfg.xMax, cfg.xStep);
  const ys = range(cfg.yMin, cfg.yMax, cfg.yStep);
  const points = [];
  for (const x of xs) for (const y of ys) points.push([x, y]);

  console.error(`MAR sweep: ${points.length} grid points (${xs.length} x-values x ${ys.length} y-values), ${cfg.workers} worker(s)`);
  console.error(JSON.stringify({ ...cfg, weaponJson: `<${cfg.weaponJson.name}>` }, null, 2));

  const outStream = createWriteStream(cfg.outPath);
  outStream.write('x_kt,y_ft,z_nm\n');

  const nWorkers = Math.max(1, Math.min(cfg.workers, points.length));
  const chunks = Array.from({ length: nWorkers }, () => []);
  points.forEach((p, i) => chunks[i % nWorkers].push(p));

  let completed = 0;
  const t0 = Date.now();

  await Promise.all(chunks.map((chunk, idx) => new Promise((resolve, reject) => {
    if (chunk.length === 0) return resolve();
    const worker = new Worker(new URL(import.meta.url), { workerData: { cfg, points: chunk } });
    worker.on('message', (msg) => {
      completed++;
      const zStr = Number.isNaN(msg.z) ? '' : msg.z.toFixed(2);
      outStream.write(`${msg.x},${msg.y},${zStr}\n`);
      console.error(`[${completed}/${points.length}] x=${msg.x}kt y=${msg.y}ft -> z=${zStr || 'NONE'}${zStr ? 'nm' : ''} (${msg.ms}ms, worker#${idx})`);
    });
    worker.on('error', reject);
    worker.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker #${idx} exited with code ${code}`)));
  })));

  outStream.end();
  console.error(`Done: ${completed}/${points.length} points in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${cfg.outPath}`);
}

function runWorker({ cfg, points }) {
  const missile = missileFromJson(cfg.weaponJson);
  for (const [x, y] of points) {
    const t0 = Date.now();
    const z = solveMAR(x, y, missile, cfg);
    parentPort.postMessage({ x, y, z, ms: Date.now() - t0 });
  }
}

if (isMainThread) {
  await main();
} else {
  runWorker(workerData);
}
