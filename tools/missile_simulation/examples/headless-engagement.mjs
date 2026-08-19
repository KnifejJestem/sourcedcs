#!/usr/bin/env node
// Runs one engagement with no browser involved: reads the built-in AIM-120C
// weapon data straight off disk, defines a shooter/target setup as plain
// objects (same shape as state.js's state.shooter / state.target), and
// prints both aircraft's and both missiles' flight paths. Nothing here
// touches DOM, window, or fetch -- see public/js/engagement.js for the pure
// function this calls.
//
// Run:
//   node examples/headless-engagement.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { runEngagement } from '../public/js/engagement.js';
import { missileFromJson } from '../public/js/weapon-extract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const weaponJson = JSON.parse(
  readFileSync(path.join(__dirname, '../data/weapons/aim-120c.json'), 'utf8')
);
const missile = missileFromJson(weaponJson);

// Every phase carries all four fields even when this phase's angle
// convention doesn't use one of them -- see state.js for what each field
// means (accel/climbAngle are magnitudes; the angle field is signed,
// degrees here, converted to radians inside engagement.js).
function phase(desiredSpeed, desiredAlt, angleField, angleDeg) {
  return { accel: 0, desiredSpeed, climbAngle: 0, desiredAlt, [angleField]: angleDeg };
}

function aircraft(spd0, alt0) {
  return {
    alt0, spd0,
    intercept: phase(spd0, alt0, 'offsetAngle', 0),
    crank: Object.assign({ enabled: false, triggerType: 'launch', triggerRange: 20 }, phase(spd0, alt0, 'crankAngle', 60)),
    out: { enabled: false, triggerType: 'activation', triggerRange: 20, accel: 0, desiredSpeed: spd0, climbAngle: 0, desiredAlt: alt0, turnRate: 12 },
    cold: phase(spd0, alt0, 'offsetAngle', 0)
  };
}

const shooter = aircraft(500, 25000);
const target = Object.assign(aircraft(450, 25000), { rng0: 25 }); // nm, head-on

const engagement = runEngagement({
  shooter, target,
  missileA: missile, fireA: { enabled: true, triggerRange: 25 }, // launch at 25 nm
  missileB: null, fireB: { enabled: false, triggerRange: 0 }      // no return fire this run
});

console.log(`Shooter track: ${engagement.paths.shooter.length} samples over ${engagement.paths.duration.toFixed(1)}s`);
console.log(`Target track:  ${engagement.paths.target.length} samples over ${engagement.paths.duration.toFixed(1)}s`);
console.log(`Missile A launched at T+${engagement.triggerTimeA}s`);
console.log('Missile A summary:', engagement.resultA.summary);
console.log('Missile A path points:', engagement.resultA.path.length);
