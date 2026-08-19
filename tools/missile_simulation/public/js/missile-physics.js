/* Drag, mass and motor-thrust helpers shared by the flyout simulation.
   All weapon-specific numbers are read from a missile parameter object
   (see weapon-extract.js) rather than hardcoded as constants, so any
   parsed DCS weapon table can be simulated. */

import { GRAVITY, FT_TO_M, KTS_TO_MS } from './constants.js';
import { isaAtmosphere } from './atmosphere.js';

export function cx0AtMach(M, mach) {
  const tbl = M.cx0;
  let idx = mach / M.machStep;
  idx = Math.max(0, Math.min(idx, tbl.length - 1));
  const i0 = Math.floor(idx), i1 = Math.min(i0 + 1, tbl.length - 1);
  const f = idx - i0;
  return tbl[i0] * (1 - f) + tbl[i1] * f;
}

export function massAt(M, t) {
  if (M.burnTime <= 0 || t >= M.burnTime) return M.mass - M.fuel;
  return M.mass - M.fuel * (t / M.burnTime);
}

export function burnoutSpeed(M, thrust, v0, h0) {
  const dt = 0.02;
  const { rho, a } = isaAtmosphere(h0);
  let v = v0, t = 0;
  while (t < M.burnTime) {
    const drag = cx0AtMach(M, a > 0 ? v / a : 0) * (0.5 * rho * v * v) * M.sRef;
    v += ((thrust - drag) / massAt(M, t)) * dt;
    t += dt;
  }
  return v;
}

/* Motor thrust: the table's `impulse` field is SPECIFIC impulse (Isp, in
   seconds) -- not total impulse in Newton-seconds, which was tried first
   and was wrong (it implied ~36 N average thrust, nothing for a 161 kg
   missile). The standard rocket relation is thrust = Isp * g0 * mdot, with
   mdot = fuel_mass / work_time for each stage. For the AIM-120C's march
   stage that gives ~18.1 kN (Isp 234 s, mdot 7.89 kg/s) -- the boost stage
   here has impulse = 0 and fuel_mass = 0, so it contributes nothing and all
   real thrust comes from march, same conclusion as before, now for a
   documented reason rather than a guess.

   Cross-check: independently solving for the thrust needed to reach the
   table's own Mach_max = 4 by burnout gives ~23.6 kN -- same order of
   magnitude as the Isp-derived 18.1 kN (23% apart), which is reassuring
   agreement between two unrelated methods. The Isp-derived burnout speed
   at a 20,000 ft / 500 kt launch comes out to Mach 3.25, a bit under
   Mach_max, which is plausible (a missile can keep accelerating slightly
   past burnout while diving before reaching its stated top speed later in
   flight).

   If a loaded weapon has an Isp field but no fuel/work_time to compute
   mdot, fall BACK to the Mach_max calibration (flagged in the report). */
export function thrustFromIsp(M) {
  let total = 0;
  for (const stage of (M.stages || [])) {
    if (stage.workTime > 0 && stage.isp > 0) {
      total += stage.isp * GRAVITY * (stage.fuel / stage.workTime);
    }
  }
  return total;
}

export function calibrateThrustToMachMax(M) {
  if (M.burnTime <= 0) return 0;
  const h0 = 20000 * FT_TO_M, v0 = 500 * KTS_TO_MS;
  const { a } = isaAtmosphere(h0);
  const targetV = M.machMax * a;
  let lo = 0, hi = 5e5;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (burnoutSpeed(M, mid, v0, h0) < targetV) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export function motorThrust(M) {
  if (M.__thrust !== undefined) return M.__thrust;
  const ispThrust = thrustFromIsp(M);
  if (ispThrust > 0) {
    M.__thrust = ispThrust;
    M.__thrustSource = 'isp';
  } else if (M.burnTime > 0) {
    M.__thrust = calibrateThrustToMachMax(M);
    M.__thrustSource = 'mach_max_calibrated';
  } else {
    M.__thrust = 0;
    M.__thrustSource = 'none';
  }
  return M.__thrust;
}
