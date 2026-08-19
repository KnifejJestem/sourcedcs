/* Headless engagement resolution: shooter + target aircraft configs (plain,
   user-facing units -- kt/ft/nm/deg, same shape as state.js's `state.shooter`
   / `state.target`) and up to two missiles in -> full 3D flight paths for
   both aircraft and both missiles out. No DOM, no globals -- everything an
   engagement needs is either a parameter or a pure import from aircraft.js /
   sim-engine.js, so this runs identically in a browser or plain Node.

   A missile's guidance only ever reads the DEFENDER's track (see
   sim-engine.js), never the firer's own post-launch path, which is what
   makes an engagement resolvable in a fixed sequence rather than needing to
   iterate to a fixed point:
     1. Baseline aircraft pair. Friendly's own launch trigger is found
        against this baseline and reused (not re-searched) through every
        later rebuild below -- paths before a trigger time are bit-for-bit
        identical across rebuilds, since a later trigger can only change
        what happens after it fires, never before, so the index found here
        stays exact.
     2. If the shooter's Crank is launch-triggered: its trigger time just IS
        the launch time found in step 1, no missile flight needed to know it
        (unlike Out's activation trigger below). Rebuild with it resolved,
        so Crank can never start before the missile that's supposed to
        still be pointed at Intercept actually leaves the rail.
     3. If the shooter's Out is activation-typed: run missile A against the
        crank-resolved pair to get its activation time, tA. Rebuild with the
        shooter's Out trigger resolved to tA too (target cfg unchanged --
        but its resulting PATH may already shift if it's cranking/
        intercepting off the shooter, which is correct mutual coupling).
     4. If return fire is armed: find its launch trigger and, same as step
        2, resolve the target's own launch-triggered Crank against it if
        needed, then run missile B against the shooter's track.
     5. If the target's Out is activation-typed: rebuild once more with both
        sides' triggers resolved -- the true mutually-consistent pair.
     6. Re-run the real, returned missile A and B (cheaply) against that
        final pair. */

import { KTS_TO_MS, FT_TO_M } from './constants.js';
import { buildEngagementPaths } from './aircraft.js';
import { simulateEngagement3D } from './sim-engine.js';

const DEG2RAD = Math.PI / 180;

// Converts a user-facing phase (kt/kt-s/deg/ft) into the SI/radian shape
// aircraft.js expects. accel/climbAngle are magnitudes (sign is aircraft.js's
// job, toward whatever the desired speed/altitude is); angleKey (if any) is
// signed and passed straight through in radians.
function toPhaseCfg(p, angleKey) {
  const cfg = {
    accel: Math.abs(p.accel) * KTS_TO_MS,
    desiredSpeed: p.desiredSpeed * KTS_TO_MS,
    climbAngle: Math.abs(p.climbAngle) * DEG2RAD,
    desiredAlt: p.desiredAlt * FT_TO_M
  };
  if (angleKey) cfg[angleKey] = p[angleKey] * DEG2RAD;
  return cfg;
}

// Shooter and target are fully symmetric aircraft configs except for their
// starting x -- the shooter always starts at x=0, the target at its own
// starting range from the shooter.
function buildAircraftCfg(acft, x0) {
  return {
    x0, y0: 0, z0: acft.alt0 * FT_TO_M, v0: acft.spd0 * KTS_TO_MS,
    intercept: toPhaseCfg(acft.intercept, 'offsetAngle'),
    crank: Object.assign(
      { enabled: acft.crank.enabled, triggerType: acft.crank.triggerType, triggerRange: acft.crank.triggerRange * 1852, triggerTime: null },
      toPhaseCfg(acft.crank, 'crankAngle')),
    out: Object.assign(
      { enabled: acft.out.enabled, triggerType: acft.out.triggerType, triggerRange: acft.out.triggerRange * 1852, triggerTime: null, turnRateDeg: acft.out.turnRate },
      toPhaseCfg(acft.out, null)),
    cold: toPhaseCfg(acft.cold, 'offsetAngle')
  };
}

function findTriggerIndex(paths, rangeM) {
  for (let i = 0; i < paths.shooter.length; i++) {
    const s = paths.shooter[i], t = paths.target[i];
    if (Math.hypot(t.x - s.x, t.y - s.y, t.z - s.z) <= rangeM) return i;
  }
  return -1;
}

// Launches `weapon` from `ownSamples[triggerIdx]`, guided against
// `otherSamples`. Launch speed is the firer's true 3D speed at that instant
// (own horizontal speed AND whatever it's currently climbing/diving at) --
// sim-engine.js combines v0 with launchPitch component-wise, so a launch
// speed that dropped the vertical component would understate it for any
// shooter that isn't level at the trigger instant.
function launchMissile(weapon, ownSamples, otherSamples, dt, triggerIdx) {
  const tTrig = triggerIdx * dt;
  const s0 = ownSamples[triggerIdx];
  const result = simulateEngagement3D(weapon, {
    launchPos: { x: s0.x, y: s0.y, z: s0.z }, launchPsi: s0.psi,
    launchPitch: Math.atan2(s0.vz, Math.hypot(s0.vx, s0.vy)),
    v0: Math.hypot(s0.vx, s0.vy, s0.vz),
    firerPath: { samples: ownSamples, dt },
    defenderPath: { samples: otherSamples, dt },
    worldT0: tTrig
  });
  return { result, tTrig };
}

/**
 * Resolves a full engagement: aircraft tracks, missile A (the shooter's own
 * shot), and (if armed) missile B (the target's return shot).
 *
 * @param {object} input
 * @param {object} input.shooter - aircraft config, same shape as state.js's
 *   `state.shooter` (alt0 ft, spd0 kt, intercept/crank/out/cold phases).
 * @param {object} input.target - same shape, plus `rng0` (nm, its starting
 *   range from the shooter).
 * @param {object|null} [input.missileA] - weapon object (see
 *   weapon-extract.js / data/weapons/*.json) the shooter fires, or null to
 *   skip missile A entirely.
 * @param {{enabled: boolean, triggerRange: number}} [input.fireA] - whether
 *   missile A launches, and the shooter-target range (nm) it launches at.
 * @param {object|null} [input.missileB] - weapon the target returns fire
 *   with, or null to skip missile B.
 * @param {{enabled: boolean, triggerRange: number}} [input.fireB] - same as
 *   fireA, for the target's return shot.
 * @param {number} [input.dt] - aircraft-path integration step, seconds.
 * @returns {{paths: object, resultA: object|null, resultB: object|null,
 *   triggerTimeA: number|null, triggerTimeB: number|null}}
 *   `paths` holds both aircraft's full 3D flight paths (paths.shooter /
 *   paths.target, arrays of {t,x,y,z,psi,v,vx,vy,vz}); resultA/resultB
 *   (when fired) hold each missile's flight path plus its summary (hit,
 *   miss distance, time of flight, etc. -- see sim-engine.js).
 */
export function runEngagement(input) {
  const {
    shooter, target,
    missileA = null, fireA = { enabled: false, triggerRange: 0 },
    missileB = null, fireB = { enabled: false, triggerRange: 0 },
    dt = 0.02
  } = input;

  const shooterCfg = buildAircraftCfg(shooter, 0);
  const targetCfg = buildAircraftCfg(target, target.rng0 * 1852);

  // The aircraft paths have to extend past whenever a trigger might actually
  // fire, not just past a missile's own flight time -- a launch that's
  // range-triggered (either side) can happen well after T+0 if the start
  // separation is large, and once a missile's own guidance needs a
  // defender-track sample beyond the precomputed window, it reads the
  // frozen last sample instead of the target's real position, quietly
  // corrupting the terminal intercept. Estimate the worst-case closing time
  // from the actual current separation and speeds, and size the window off
  // whichever missile (A or B) would need to keep flying longest.
  const closingSpeedMs = Math.max((shooter.spd0 + target.spd0) * KTS_TO_MS, 50);
  const timeToCloseS = (target.rng0 * 1852) / closingSpeedMs;
  const lifeTimeMax = Math.max(missileA ? missileA.lifeTime : 90, missileB ? missileB.lifeTime : 90);
  const duration = Math.max(timeToCloseS + lifeTimeMax + 15, 90);

  let paths = buildEngagementPaths(shooterCfg, targetCfg, { dt, duration });

  const triggerIdxA = (fireA.enabled && missileA) ? findTriggerIndex(paths, fireA.triggerRange * 1852) : -1;
  const tTrigA = triggerIdxA === -1 ? null : triggerIdxA * paths.dt;

  if (shooterCfg.crank.enabled && shooterCfg.crank.triggerType === 'launch') {
    shooterCfg.crank.triggerTime = tTrigA;
    paths = buildEngagementPaths(shooterCfg, targetCfg, { dt, duration });
  }

  let aInfo = triggerIdxA === -1 ? null : launchMissile(missileA, paths.shooter, paths.target, paths.dt, triggerIdxA);

  if (aInfo && shooterCfg.out.enabled && shooterCfg.out.triggerType === 'activation') {
    shooterCfg.out.triggerTime = aInfo.result.summary.seekerActiveEvent
      ? aInfo.result.summary.seekerActiveEvent.t + aInfo.tTrig // local -> world
      : null;
    paths = buildEngagementPaths(shooterCfg, targetCfg, { dt, duration });
  }

  let bInfo = null;
  const triggerIdxB = (fireB.enabled && missileB) ? findTriggerIndex(paths, fireB.triggerRange * 1852) : -1;
  const tTrigB = triggerIdxB === -1 ? null : triggerIdxB * paths.dt;

  if (targetCfg.crank.enabled && targetCfg.crank.triggerType === 'launch') {
    targetCfg.crank.triggerTime = tTrigB;
    paths = buildEngagementPaths(shooterCfg, targetCfg, { dt, duration });
  }

  if (triggerIdxB !== -1) bInfo = launchMissile(missileB, paths.target, paths.shooter, paths.dt, triggerIdxB);

  if (targetCfg.out.enabled && targetCfg.out.triggerType === 'activation') {
    targetCfg.out.triggerTime = (bInfo && bInfo.result.summary.seekerActiveEvent)
      ? bInfo.result.summary.seekerActiveEvent.t + bInfo.tTrig // local -> world
      : null;
    paths = buildEngagementPaths(shooterCfg, targetCfg, { dt, duration });
    if (bInfo) {
      const triggerIdx = Math.round(bInfo.tTrig / paths.dt);
      bInfo = launchMissile(missileB, paths.target, paths.shooter, paths.dt, triggerIdx);
    }
  }

  if (aInfo) aInfo = launchMissile(missileA, paths.shooter, paths.target, paths.dt, triggerIdxA);

  return {
    paths,
    resultA: aInfo ? aInfo.result : null,
    resultB: bInfo ? bInfo.result : null,
    triggerTimeA: tTrigA,
    triggerTimeB: tTrigB
  };
}
