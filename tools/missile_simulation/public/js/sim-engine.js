/* Point-mass missile flyout in 3D. All weapon-specific numbers live in a
   missile parameter object (see weapon-extract.js) rather than as
   constants, so any parsed DCS weapon table can be simulated.

   The missile chases a DEFENDER aircraft whose full 3D track has already
   been precomputed (see aircraft.js) -- this module only reads samples
   from it, it never drives the aircraft's own maneuvering. A separate
   FIRER track (the aircraft that launched this missile) is also read,
   purely to report how far apart the two AIRCRAFT are at seeker
   activation -- the same "launch-and-leave" stat the 2D version had,
   generalized to whichever jet actually fired this shot (the shooter for
   missile A, the target for a return shot). */

import { GRAVITY } from './constants.js';
import { isaAtmosphere } from './atmosphere.js';
import { cx0AtMach, massAt, motorThrust } from './missile-physics.js';
import { sampleAt } from './aircraft.js';

/**
 * PN guidance is decoupled into an elevation (pitch) channel and an
 * azimuth (yaw) channel, each using the exact same LOS-rate formula the
 * original 2D model used in its single plane -- elevation's "along" axis
 * is the ground-projected range (hypot of the x/y LOS components) paired
 * with altitude, azimuth's plane is the horizontal x/y LOS. This is a
 * deliberate, minimal generalization: with zero cross-range throughout
 * (the old 2D case), the elevation channel reduces to exactly the
 * original formulas and the azimuth channel goes to zero, which is how
 * this was cross-checked against the pre-3D numbers while building it.
 * The two channels' rate commands share a single g-limit budget, clamped
 * as a 2-vector (matching a real airframe: pulling max-g up and max-g
 * sideways at once isn't free), then each is smoothed through the same
 * Tc first-order lag the 2D model used for its one channel.
 */
export function simulateEngagement3D(M, opts) {
  const thrustFull = motorThrust(M);
  const dt = opts.dt || 0.01;
  const store = Math.max(1, Math.round((opts.storeEvery || 0.05) / dt));
  const worldT0 = opts.worldT0 || 0;

  let t = 0, x = opts.launchPos.x, y = opts.launchPos.y, z = opts.launchPos.z;
  let psi = opts.launchPsi, gamma = opts.launchPitch;
  let psiDot = 0, gammaDot = 0;
  let v = opts.v0;

  const defenderAt = (tt) => sampleAt(opts.defenderPath.samples, opts.defenderPath.dt, worldT0 + tt);
  const firerAt = (tt) => sampleAt(opts.firerPath.samples, opts.firerPath.dt, worldT0 + tt);

  const path = [];
  const targetPath = [];
  let hit = false, reason = 'unknown';
  let minSlant = Infinity, apogee = z, step = 0;
  let evActive = null, evFar = null;
  let closure = null;

  for (;;) {
    const { rho, a } = isaAtmosphere(z);
    const mach = a > 0 ? v / a : 0;
    const thrust = (M.burnTime > 0 && t < M.burnTime) ? thrustFull : 0;
    const mass = massAt(M, t);
    const drag = cx0AtMach(M, mach) * (0.5 * rho * v * v) * M.sRef;

    const tgt = defenderAt(t);
    const losX = tgt.x - x, losY = tgt.y - y, losH = tgt.z - z;
    const slant = Math.hypot(losX, losY, losH);
    minSlant = Math.min(minSlant, slant);
    apogee = Math.max(apogee, z);

    const firer = firerAt(t);
    const firerTgtRange = Math.hypot(tgt.x - firer.x, tgt.y - firer.y, tgt.z - firer.z);

    if (evFar === null && M.seekerFar !== null && slant <= M.seekerFar && t >= M.seekerDelay) {
      evFar = { t, x, y, h: z, tgtX: tgt.x, tgtY: tgt.y, tgtH: tgt.z, slant,
        firerX: firer.x, firerY: firer.y, firerH: firer.z, firerTgtRange };
    }
    if (evActive === null && M.seekerActive !== null && slant <= M.seekerActive && t >= M.seekerDelay) {
      evActive = { t, x, y, h: z, tgtX: tgt.x, tgtY: tgt.y, tgtH: tgt.z, slant,
        firerX: firer.x, firerY: firer.y, firerH: firer.z, firerTgtRange };
    }

    const rangeGround = Math.hypot(losX, losY);
    const lofting = M.loftOffRange !== null && M.burnTime > 0 &&
                    t < M.burnTime && rangeGround > M.loftOffRange;
    if (step % store === 0) {
      path.push({ t: worldT0 + t, x, y, h: z, v, mach, lofting, powered: thrust > 0 });
      targetPath.push({ t: worldT0 + t, x: tgt.x, y: tgt.y, h: tgt.z });
    }
    step++;

    const mxVx = v * Math.cos(gamma) * Math.cos(psi);
    const mxVy = v * Math.cos(gamma) * Math.sin(psi);
    const mxVh = v * Math.sin(gamma);
    const relVx = tgt.vx - mxVx, relVy = tgt.vy - mxVy, relVh = tgt.vz - mxVh;

    const relVsq = relVx * relVx + relVy * relVy + relVh * relVh;
    if (relVsq > 1e-9) {
      let s = -(losX * relVx + losY * relVy + losH * relVh) / relVsq;
      s = Math.max(0, Math.min(dt, s));
      const dMin = Math.hypot(losX + relVx * s, losY + relVy * s, losH + relVh * s);
      minSlant = Math.min(minSlant, dMin);
      if (dMin <= M.killRadius && t > 0.1) {
        hit = true; reason = 'intercept';
        t += s; x += mxVx * s; y += mxVy * s; z += mxVh * s;
        path.push({ t: worldT0 + t, x, y, h: z, v, mach, lofting, powered: thrust > 0 });
        break;
      }
    }

    if (v <= M.vMin) { reason = 'missile below minimum speed'; break; }
    if (t >= M.lifeTime) { reason = 'self-destruct timer expired'; break; }
    if (z <= 0 && t > 0.5) { reason = 'ground impact'; break; }
    // "Passed the target": generalizes the 2D model's `losX < 0` check by
    // projecting the LOS vector onto the missile's OWN current velocity
    // direction instead of assuming the world x-axis is the closing axis
    // -- needed now that yaw can rotate the missile off that axis.
    const losDotVel = losX * mxVx + losY * mxVy + losH * mxVh;
    if (losDotVel < 0 && slant > M.killRadius) { reason = 'passed the target'; break; }

    const maxTurnRate = (M.gLoad * GRAVITY) / Math.max(v, 1);

    // Elevation (pitch) sub-plane: "along" = ground-projected range, paired
    // with altitude -- identical formula shape to the original 2D model.
    const relVAlong = rangeGround > 1e-6 ? (losX * relVx + losY * relVy) / rangeGround : 0;
    const r2Elev = Math.max(rangeGround * rangeGround + losH * losH, 1e-6);
    const lambdaDotElev = (rangeGround * relVh - losH * relVAlong) / r2Elev;

    // Azimuth (yaw) sub-plane: the horizontal x/y LOS -- zero whenever the
    // engagement stays coplanar (today's case), exactly as it should.
    const r2Az = Math.max(losX * losX + losY * losY, 1e-6);
    const lambdaDotAz = (losX * relVy - losY * relVx) / r2Az;

    // vClosing is floored at zero for the same reason as the 2D model: PN
    // only means anything while range is shrinking.
    const vClosing = Math.max(-(losX * relVx + losY * relVy + losH * relVh) / Math.max(slant, 1e-6), 0);
    if (closure === null) closure = vClosing;

    let pitchCmd, yawCmd;
    if (lofting) {
      // Loft only overrides pitch, exactly as in the 2D model; yaw keeps
      // homing even through the boost/loft climb -- new in 3D, previously
      // undefined since 2D had no yaw axis at all.
      pitchCmd = (M.loftAngle - gamma) / M.tc;
      yawCmd = (M.knav * vClosing * lambdaDotAz) / Math.max(v, 1);
    } else {
      pitchCmd = (M.knav * vClosing * lambdaDotElev) / Math.max(v, 1);
      yawCmd = (M.knav * vClosing * lambdaDotAz) / Math.max(v, 1);
    }

    // Shared g-limit budget: clamp the (pitch,yaw) rate command as ONE
    // vector, not per-axis, since a real airframe can't pull max-g in two
    // planes simultaneously for free.
    const cmdMag = Math.hypot(pitchCmd, yawCmd);
    if (cmdMag > maxTurnRate) {
      const scale = maxTurnRate / cmdMag;
      pitchCmd *= scale; yawCmd *= scale;
    }

    gammaDot += (pitchCmd - gammaDot) * Math.min(dt / M.tc, 1);
    psiDot += (yawCmd - psiDot) * Math.min(dt / M.tc, 1);
    gamma += gammaDot * dt;
    psi += psiDot * dt;

    v = Math.max(v + ((thrust - drag) / mass - GRAVITY * Math.sin(gamma)) * dt, 0);
    x += v * Math.cos(gamma) * Math.cos(psi) * dt;
    y += v * Math.cos(gamma) * Math.sin(psi) * dt;
    z += v * Math.sin(gamma) * dt;
    t += dt;

    if (v <= 0) { reason = 'zero velocity'; break; }
  }

  const { a: aEnd } = isaAtmosphere(z);
  const finalTarget = defenderAt(t);
  return {
    path,
    targetPath,
    summary: {
      hit, reason, t, closure,
      missileGroundRange: Math.hypot(x - opts.launchPos.x, y - opts.launchPos.y),
      interceptSlant: hit ? Math.hypot(x - opts.launchPos.x, y - opts.launchPos.y, z - opts.launchPos.z) : null,
      finalAlt: z, finalSpeed: v,
      finalMach: aEnd > 0 ? v / aEnd : 0,
      minSlant, apogee,
      targetXAtEnd: finalTarget.x, targetYAtEnd: finalTarget.y, targetAltAtEnd: finalTarget.z,
      seekerActiveEvent: evActive,
      seekerFarEvent: evFar,
      thrust: thrustFull,
      loftOffRange: M.loftOffRange === null ? 0 : M.loftOffRange,
      worldT0
    }
  };
}
