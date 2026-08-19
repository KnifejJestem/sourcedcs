/* 3D aircraft flight-path model, shared by shooter and target.

   Every aircraft flies a sequence of named PHASES, each converging speed
   toward its own desired speed (via acceleration) and altitude toward its
   own desired altitude (via climb angle), holding both once reached --
   re-evaluated from whatever the aircraft actually is at, not a fixed
   time-based ramp, so a phase change never causes a discontinuity:

     - Intercept (mandatory, always governs T+0 -- the instant this
       aircraft's own missile leaves the rail, if it fires one, whether
       that's at T+0 or a later range-triggered launch): holds an offset
       angle referenced from POINTING AT the other aircraft (0 = pure
       pursuit, +/- = lead/lag).
     - Crank (optional): supersedes Intercept once ITS OWN trigger fires --
       either a range, or a pre-resolved "my own missile just launched"
       time (see main.js), which is the default and the reason this needs
       a trigger at all: a launch-triggered crank must NEVER be active at
       the launch instant itself (that's still Intercept, always -- see
       derivePsi0), only starting the step after, however long after T+0
       that launch actually happens to be. Holds a crank angle, same
       "pointing at" reference, conventionally large/positive ("to my own
       right").
     - Out (optional, independent of Crank): supersedes whichever of
       Intercept/Crank was running once its own trigger fires (range, or a
       pre-resolved "my own missile went active" time -- see main.js).
       Always targets pointing DIRECTLY AWAY from the other aircraft,
       continuously -- not a fixed arc computed once at the trigger
       instant, which is what makes this genuinely track "away from
       wherever the other aircraft currently is" rather than "180 degrees
       from wherever I happened to be heading when I broke out." Turn
       rate is the one phase-specific input that ISN'T assumed at 3g.
     - Cold (only meaningful if Out is enabled): takes over the instant
       Out's heading-hold first achieves its away-angle ("established").
       Holds an offset angle referenced from POINTING AWAY (0 = cold,
       +/-90 = beam, 180 = hot).

   All four hold their heading via the same bang-bang controller
   (headingHoldRate), just with a different commanded angle and turn-rate
   cap -- Out re-aiming continuously at the other aircraft's live position
   is exactly what makes it track "away," not a stale entry heading.

   Initial heading is DERIVED, not input: at t=0, each aircraft's psi is
   whatever makes the bearing to the other aircraft's Start position read
   as Intercept's offset angle -- ALWAYS Intercept, never Crank, even when
   Crank is enabled, since t=0 is the instant this aircraft's own missile
   (if any) leaves the rail, and that has to happen while still pointed
   per Intercept -- so a default (offset=0) head-on setup starts with zero
   heading error, same as flying "straight" used to mean, and hot/cold/
   beaming for either aircraft is just that same offset angle at 0/180/
   +-90 rather than a separate sign convention on speed. Crank (if
   enabled) takes over once its own trigger fires -- by default that's
   this aircraft's own launch instant, so the very next step after T+0
   only when this aircraft actually fires at T+0; otherwise Intercept
   keeps governing right up to whenever the real launch happens.

   Because either side can react to the OTHER's live position (Intercept,
   Crank, and Cold's heading-hold all do), the two tracks are co-simulated
   step by step, each step reading the other's state from the previous
   step (a standard two-body parallel update) -- they can't be independent
   closed-form functions. */

import { GRAVITY } from './constants.js';

const DEADBAND = 1 * Math.PI / 180;
const DEFAULT_TURN_G = 3; // every phase except Out assumes this level-turn g
const DEFAULT_DT = 0.02;
const DEFAULT_DURATION = 240; // s -- generous vs. any realistic Life_Time

function wrapPi(a) {
  a = a % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/* Bang-bang heading-hold controller shared by every phase. Drives the
   OTHER aircraft's bearing off MY nose toward commandedGimbal, turning at
   the full rate cap whenever the error exceeds a small deadband and
   holding level otherwise, since the assumed rate is a cap on a level
   turn, not a proportional gain.

   Sign note: turning my nose AWAY from where the other aircraft currently
   is makes it appear further toward the OPPOSITE side of my new heading.
   So closing a positive error (the other aircraft needs to read further
   to MY right) means turning left (decreasing psi), not right -- verified
   against the pursue/intercept case (commandedGimbal=0), where this same
   rule reduces to the intuitive "turn toward wherever the other aircraft
   is". */
function headingHoldRate(self, other, commandedGimbal, omegaMax) {
  const bearing = Math.atan2(other.y - self.y, other.x - self.x);
  const currentGimbal = wrapPi(bearing - self.psi);
  const error = wrapPi(commandedGimbal - currentGimbal);
  if (Math.abs(error) <= DEADBAND) return { rate: 0, error, currentGimbal };
  const rate = error > 0 ? -omegaMax : omegaMax;
  return { rate, error, currentGimbal };
}

function defaultOmegaMax(v) {
  return (DEFAULT_TURN_G * GRAVITY) / Math.max(v, 1);
}

// Converges v toward phaseCfg.desiredSpeed at phaseCfg.accel (a magnitude;
// direction is whichever way closes the gap), holding once reached.
// accel=0 legitimately means "never changes speed," regardless of
// desiredSpeed -- the same math handles both without special-casing.
function stepSpeed(v, phaseCfg, dt) {
  const diff = phaseCfg.desiredSpeed - v;
  if (Math.abs(diff) < 1e-6) return phaseCfg.desiredSpeed;
  const rate = Math.sign(diff) * phaseCfg.accel;
  if (rate === 0) return v;
  const nv = v + rate * dt;
  if ((phaseCfg.desiredSpeed - nv) * diff <= 0) return phaseCfg.desiredSpeed;
  return nv;
}

// Same convergence pattern for altitude, via climb/descent angle -- the
// fix for "crank/pursue climbs forever": once z reaches desiredAlt it
// holds there for the rest of the phase, instead of climbing without end.
function stepAltitude(z, v, phaseCfg, dt) {
  const diff = phaseCfg.desiredAlt - z;
  if (Math.abs(diff) < 1e-6) return phaseCfg.desiredAlt;
  const rate = Math.sign(diff) * v * Math.sin(phaseCfg.climbAngle);
  if (rate === 0) return z;
  const nz = z + rate * dt;
  if ((phaseCfg.desiredAlt - nz) * diff <= 0) return phaseCfg.desiredAlt;
  return nz;
}

function verticalRateNow(phaseCfg, v, z) {
  const diff = phaseCfg.desiredAlt - z;
  if (Math.abs(diff) < 1) return 0;
  return Math.sign(diff) * v * Math.sin(phaseCfg.climbAngle);
}

// Which phase governs this instant, and the commanded heading/turn-rate
// that goes with it. Mutates self.outTriggeredAt / outEstablishedAt /
// crankTriggeredAt / crankEstablishedAt as those events happen.
function determinePhase(self, cfg, t, range) {
  if (cfg.out.enabled) {
    if (self.outTriggeredAt === null) {
      const o = cfg.out;
      const fires = o.triggerType === 'activation'
        ? (o.triggerTime !== null && o.triggerTime !== undefined && t >= o.triggerTime)
        : (range <= o.triggerRange);
      if (fires) self.outTriggeredAt = t;
    }
    if (self.outTriggeredAt !== null) {
      if (self.outEstablishedAt !== null) {
        return { name: 'cold', phaseCfg: cfg.cold, commandedGimbal: Math.PI + cfg.cold.offsetAngle, omegaMax: defaultOmegaMax(self.v) };
      }
      return { name: 'out', phaseCfg: cfg.out, commandedGimbal: Math.PI, omegaMax: cfg.out.turnRateDeg * Math.PI / 180 };
    }
  }
  if (cfg.crank.enabled) {
    if (self.crankTriggeredAt === null) {
      const c = cfg.crank;
      const fires = c.triggerType === 'launch'
        ? (c.triggerTime !== null && c.triggerTime !== undefined && t >= c.triggerTime)
        : (range <= c.triggerRange);
      if (fires) self.crankTriggeredAt = t;
    }
    if (self.crankTriggeredAt !== null) {
      return { name: 'crank', phaseCfg: cfg.crank, commandedGimbal: cfg.crank.crankAngle, omegaMax: defaultOmegaMax(self.v) };
    }
  }
  return { name: 'intercept', phaseCfg: cfg.intercept, commandedGimbal: cfg.intercept.offsetAngle, omegaMax: defaultOmegaMax(self.v) };
}

// Start has no heading input: psi0 is whatever makes the bearing to the
// OTHER aircraft's Start position already read as this aircraft's own
// Intercept offset -- ALWAYS Intercept, even when Crank is enabled, since
// t=0 is this aircraft's own launch instant (if it fires one) -- zero
// initial heading error in the default (offset=0) case, exactly like
// flying "straight" used to mean.
function derivePsi0(selfCfg, otherCfg) {
  const bearing = Math.atan2(otherCfg.y0 - selfCfg.y0, otherCfg.x0 - selfCfg.x0);
  return wrapPi(bearing - selfCfg.intercept.offsetAngle);
}

function initState(cfg, psi0) {
  return {
    x: cfg.x0, y: cfg.y0 || 0, z: cfg.z0, psi: psi0, v: cfg.v0,
    outTriggeredAt: null, outEstablishedAt: null, crankTriggeredAt: null, crankEstablishedAt: null,
    lastPhaseCfg: cfg.intercept
  };
}

function advanceOneAircraft(self, cfg, otherPrev, dt, t, range) {
  const phase = determinePhase(self, cfg, t, range);
  const r = headingHoldRate(self, otherPrev, phase.commandedGimbal, phase.omegaMax);

  if (phase.name === 'crank' && self.crankEstablishedAt === null && Math.abs(r.error) <= DEADBAND) {
    self.crankEstablishedAt = t;
  }
  if (phase.name === 'out' && self.outEstablishedAt === null && Math.abs(r.error) <= DEADBAND) {
    self.outEstablishedAt = t;
  }

  self.psi += r.rate * dt;
  self.v = stepSpeed(self.v, phase.phaseCfg, dt);
  self.z = stepAltitude(self.z, self.v, phase.phaseCfg, dt);
  self.x += self.v * Math.cos(self.psi) * dt;
  self.y += self.v * Math.sin(self.psi) * dt;
  self.lastPhaseCfg = phase.phaseCfg;
}

function snapshot(t, s) {
  return {
    t, x: s.x, y: s.y, z: s.z, psi: s.psi, v: s.v,
    vx: s.v * Math.cos(s.psi), vy: s.v * Math.sin(s.psi),
    vz: verticalRateNow(s.lastPhaseCfg, s.v, s.z)
  };
}

export function buildEngagementPaths(shooterCfg, targetCfg, opts) {
  const dt = (opts && opts.dt) || DEFAULT_DT;
  const duration = (opts && opts.duration) || DEFAULT_DURATION;
  const steps = Math.ceil(duration / dt);

  const shooter = initState(shooterCfg, derivePsi0(shooterCfg, targetCfg));
  const target = initState(targetCfg, derivePsi0(targetCfg, shooterCfg));

  const shooterSamples = [snapshot(0, shooter)];
  const targetSamples = [snapshot(0, target)];

  for (let i = 1; i <= steps; i++) {
    const t = i * dt;
    const shooterPrev = { x: shooter.x, y: shooter.y, z: shooter.z, psi: shooter.psi };
    const targetPrev = { x: target.x, y: target.y, z: target.z, psi: target.psi };
    const range = Math.hypot(targetPrev.x - shooterPrev.x, targetPrev.y - shooterPrev.y, targetPrev.z - shooterPrev.z);

    advanceOneAircraft(shooter, shooterCfg, targetPrev, dt, t, range);
    advanceOneAircraft(target, targetCfg, shooterPrev, dt, t, range);

    shooterSamples.push(snapshot(t, shooter));
    targetSamples.push(snapshot(t, target));
  }

  return {
    dt, duration,
    shooter: shooterSamples,
    target: targetSamples,
    shooterMeta: { outTriggeredAt: shooter.outTriggeredAt, outEstablishedAt: shooter.outEstablishedAt, crankEstablishedAt: shooter.crankEstablishedAt },
    targetMeta: { outTriggeredAt: target.outTriggeredAt, outEstablishedAt: target.outEstablishedAt, crankEstablishedAt: target.crankEstablishedAt }
  };
}

// Linear interpolation between adjacent samples; clamps to the first/last
// sample outside the precomputed horizon rather than extrapolating, since
// nothing in this app asks for a time beyond DEFAULT_DURATION.
export function sampleAt(samples, dt, t) {
  if (t <= 0) return samples[0];
  const last = samples.length - 1;
  const fi = t / dt;
  if (fi >= last) return samples[last];
  const i0 = Math.floor(fi), i1 = i0 + 1, f = fi - i0;
  const a = samples[i0], b = samples[i1];
  return {
    t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f,
    psi: a.psi + wrapPi(b.psi - a.psi) * f, v: a.v + (b.v - a.v) * f,
    vx: a.vx + (b.vx - a.vx) * f, vy: a.vy + (b.vy - a.vy) * f, vz: a.vz + (b.vz - a.vz) * f
  };
}
