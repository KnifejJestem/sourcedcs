/* Shared, mutable application state. `app.missile` and `app.weapons` are
   populated once the built-in weapon has loaded (see main.js); `state` holds
   the rail's control values, `domain` the scope's current plot bounds.

   Each aircraft is a Start (position/altitude/speed, no heading -- see
   aircraft.js for why) plus four phases: Intercept (mandatory baseline),
   Crank (optional, own trigger -- defaults to "right after this aircraft's
   own missile launches"), Out (optional, own trigger), Cold (only
   meaningful once Out is enabled). All units here are user-facing
   (kt, ft, nm, deg); main.js's cfg builders convert to SI/radians. */

import { FT_TO_M } from './constants.js';

export const app = {
  missile: null,
  weapons: []
};

// Intercept/Crank/Cold all take an angle field named per their own UI
// label; Out has no user angle at all (it's always "point directly away",
// see aircraft.js), so it's built separately below rather than forced
// through this helper.
function phase(desiredSpeed, desiredAlt, angleField, angleDefault) {
  const p = { accel: 0, desiredSpeed, climbAngle: 0, desiredAlt };
  p[angleField] = angleDefault;
  return p;
}

// One factory for both aircraft -- they're fully symmetric except for their
// default speed and (target only) rng0, so there's nothing left to
// hand-duplicate between two separate object literals.
function makeAircraft(spd0) {
  return {
    alt0: 20000, spd0,
    intercept: phase(spd0, 20000, 'offsetAngle', 0),
    crank: Object.assign({ enabled: false, triggerType: 'launch', triggerRange: 20 }, phase(spd0, 20000, 'crankAngle', 60)),
    out: { enabled: false, triggerType: 'activation', triggerRange: 20, accel: 0, desiredSpeed: spd0, climbAngle: 0, desiredAlt: 20000, turnRate: 12 },
    cold: phase(spd0, 20000, 'offsetAngle', 0)
  };
}

export const state = {
  shooter: makeAircraft(500),
  target: Object.assign(makeAircraft(450), { rng0: 25 }),

  // Whether the shooter (friendly) launches its own missile A at all --
  // off lets you set up a return-fire-only engagement with nothing
  // incoming from the friendly side. When on, the shot fires once
  // shooter-target range closes to shooterFireTrigRange, same as return
  // fire's own trigger range -- not unconditionally at T+0.
  shooterFireEnabled: true, shooterFireTrigRange: 25,

  // Return fire: the target launches its own missile once shooter-target
  // range crosses returnFireTrigRange, using returnFireWeaponIdx from the
  // same `app.weapons` list as the shooter's weapon.
  returnFireEnabled: false, returnFireTrigRange: 25, returnFireWeaponIdx: 0,

  result: null, resultB: null, reveal: 1, aircraftPaths: null
};

// xMin/xMax size the range axis (shared by both views); yMax sizes the
// side view's altitude axis; crossMin/crossMax size the top-down view's
// cross-range axis. All grown from actual sampled tracks each render.
export const domain = {
  xMin: -2 * 1852, xMax: 30 * 1852, yMax: 60000 * FT_TO_M,
  crossMin: -5 * 1852, crossMax: 5 * 1852
};

export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Scope declutter: independent per-element visibility toggles (legend
// doubles as the toggle UI, see index.html). Session-only -- intentionally
// not persisted, so the scope always starts fully populated.
export const declutter = {
  missileA: true, missileB: true,
  seekerEvents: true, firerTgtLine: true,
  trackFriendly: true, trackHostile: true,
  maneuverFriendly: true, maneuverHostile: true
};
