import { FT_TO_M, M_TO_FT, M_TO_NM } from './constants.js';
import { app, state, domain, declutter } from './state.js';
import { el } from './dom.js';

export const cvSide = document.getElementById('scope');
export const cvTop = document.getElementById('topScope');
const ctxSide = cvSide.getContext('2d');
const ctxTop = cvTop.getContext('2d');
const CSSv = getComputedStyle(document.documentElement);
const C = (n) => CSSv.getPropertyValue(n).trim();
const PAD = { l: 62, r: 26, t: 22, b: 44 };

// Sane hard caps so a corrupted or runaway domain value (NaN/Infinity from
// some edge case) can never produce an absurd axis label -- independent of
// also fixing whatever fed it a bad value in the first place.
const MAX_ALT_M = 150000 * FT_TO_M;
const MAX_RANGE_M = 200 * 1852;

function sizeCanvas(cv) {
  const rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(320, rect.width), hgt = Math.max(180, Math.round(w * 0.3));
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(hgt * dpr);
  cv.style.height = hgt + 'px';
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h: hgt };
}

// Side view: independent per-axis scaling (deliberately -- altitude and
// range are wildly different magnitudes, so it's already annotated with
// "vertical scale exaggerated" rather than trying to be to-scale).
export function pxSide(w, h) {
  const iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;
  const xMin = domain.xMin, xMax = domain.xMax, vMax = domain.yMax;
  return {
    X: (m) => PAD.l + ((m - xMin) / (xMax - xMin)) * iw,
    Y: (v) => PAD.t + ih - (v / vMax) * ih,
    invX: (px) => xMin + ((px - PAD.l) / iw) * (xMax - xMin),
    invY: (py) => ((PAD.t + ih - py) / ih) * vMax,
    iw, ih
  };
}

// Top-down view: a real map, so both axes MUST share one meters-per-pixel
// scale, or a genuinely circular turn renders as an ellipse. Uses the
// more restrictive of the two axis constraints and letterboxes the other.
function pxTop(w, h) {
  const iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;
  const neededX = Math.max(domain.xMax - domain.xMin, 1);
  const neededY = Math.max(domain.crossMax - domain.crossMin, 1);
  const scale = Math.min(iw / neededX, ih / neededY);
  const usedW = neededX * scale, usedH = neededY * scale;
  const offX = PAD.l + (iw - usedW) / 2;
  const offY = PAD.t + (ih - usedH) / 2;
  return {
    X: (m) => offX + (m - domain.xMin) * scale,
    Y: (v) => offY + usedH - (v - domain.crossMin) * scale,
    invX: (px) => domain.xMin + (px - offX) / scale,
    invY: (py) => domain.crossMin + (offY + usedH - py) / scale,
    iw, ih, scale
  };
}

function clampFinite(v, fallback, max) {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(v, -max), max);
}

function updateDomain() {
  let xMin = Math.min(-2 * 1852, 0), xMax = Math.max(8 * 1852, state.target ? state.target.rng0 * 1852 * 1.08 : 8 * 1852);
  let yMax = 14000 * FT_TO_M;
  let crossMax = 1852; // 1 nm minimum half-width so a flat shot isn't razor-thin

  const consider = (x, y, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    xMin = Math.min(xMin, x - Math.abs(x) * 0.06);
    xMax = Math.max(xMax, x + Math.abs(x) * 0.06);
    yMax = Math.max(yMax, z * 1.18);
    crossMax = Math.max(crossMax, Math.abs(y) * 1.15);
  };

  const ap = state.aircraftPaths;
  if (ap) {
    for (const track of [ap.shooter, ap.target]) {
      for (let i = 0; i < track.length; i += 15) consider(track[i].x, track[i].y, track[i].z);
    }
  }
  for (const res of [state.result, state.resultB]) {
    if (!res) continue;
    for (let i = 0; i < res.path.length; i += 5) consider(res.path[i].x, res.path[i].y, res.path[i].h);
  }

  domain.xMin = clampFinite(xMin, -2 * 1852, MAX_RANGE_M);
  domain.xMax = clampFinite(xMax, 30 * 1852, MAX_RANGE_M);
  if (domain.xMax <= domain.xMin) domain.xMax = domain.xMin + 8 * 1852;
  domain.yMax = clampFinite(Math.max(yMax, 14000 * FT_TO_M), 60000 * FT_TO_M, MAX_ALT_M);
  domain.crossMax = clampFinite(crossMax, 5 * 1852, MAX_RANGE_M);
  domain.crossMin = -domain.crossMax;
}

function drawChevron(g, cx, cy, deg, color, label) {
  g.save();
  g.translate(cx, cy);
  // Both views share the same vertical-axis flip (higher altitude / more
  // cross-range = smaller canvas y), which reverses rotation handedness
  // relative to canvas's native clockwise-positive convention -- so the
  // sign always needs negating, for either view.
  g.rotate(-deg * Math.PI / 180);
  g.fillStyle = color;
  g.beginPath(); g.moveTo(13, 0); g.lineTo(-7, 7); g.lineTo(-3, 0); g.lineTo(-7, -7);
  g.closePath(); g.fill();
  g.restore();
  if (label) {
    g.fillStyle = color;
    g.font = '600 10px ' + C('--font-mono');
    g.textAlign = 'center';
    g.fillText(label, cx, cy - 15);
  }
}

function drawSeekerEvent(g, p, ev, vKey, color, label, faint) {
  if (!ev) return;
  const mx = p.X(ev.x), my = p.Y(ev[vKey]);
  const tx = p.X(ev.tgtX), ty = p.Y(vKey === 'h' ? ev.tgtH : ev.tgtY);
  g.save();
  g.strokeStyle = color;
  g.globalAlpha = faint ? 0.42 : 0.9;
  g.lineWidth = 1.1;
  g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(mx, my); g.lineTo(tx, ty); g.stroke();
  g.setLineDash([]);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(mx, my - 4.5); g.lineTo(mx + 4.5, my); g.lineTo(mx, my + 4.5); g.lineTo(mx - 4.5, my);
  g.closePath(); g.fill();
  g.globalAlpha = 1;
  g.font = '600 9px ' + C('--font-mono');
  g.fillStyle = color;
  g.textAlign = 'center';
  g.fillText(label, (mx + tx) / 2, (my + ty) / 2 - 6);
  g.restore();
}

// Draws one missile's flight (powered/loft, coast, terminal-PN passes),
// 5s tick marks, and its hit/miss end marker. `vKey` selects which field
// of each path point is the vertical axis ('h' altitude for the side
// view, 'y' cross-range for the top view). Shared between missile A and
// B and between both views, since the phase logic is identical.
function drawMissilePath(g, p, res, vKey, reveal) {
  const path = res.path, targetPath = res.targetPath;
  const loftOffRange = res.summary.loftOffRange;
  if (path.length < 2) return;
  const upto = Math.max(2, Math.floor(path.length * reveal));

  for (let pass = 0; pass < 3; pass++) {
    g.beginPath();
    let open = false;
    for (let i = 1; i < upto; i++) {
      const a = path[i - 1], b = path[i];
      const tgt = targetPath[i - 1];
      const groundRange = tgt ? Math.hypot(tgt.x - a.x, tgt.y - a.y) : Infinity;
      const kind = (a.lofting || a.powered) ? 0 : (groundRange <= loftOffRange ? 2 : 1);
      if (kind !== pass) { open = false; continue; }
      if (!open) { g.moveTo(p.X(a.x), p.Y(a[vKey])); open = true; }
      g.lineTo(p.X(b.x), p.Y(b[vKey]));
    }
    g.strokeStyle = pass === 0 ? C('--cyan') : pass === 1 ? C('--cyan-dim') : C('--amber');
    g.lineWidth = pass === 0 ? 2.6 : 1.8;
    g.setLineDash(pass === 1 ? [5, 4] : []);
    g.stroke();
    g.setLineDash([]);
  }

  g.fillStyle = C('--ink');
  g.font = '400 9px ' + C('--font-mono');
  let nextTick = 5;
  for (let i = 1; i < upto; i++) {
    if (path[i].t - res.summary.worldT0 >= nextTick) {
      const s = path[i], xx = p.X(s.x), yy = p.Y(s[vKey]);
      g.beginPath(); g.arc(xx, yy, 2.1, 0, Math.PI * 2); g.fill();
      if (nextTick % 10 === 0) {
        g.textAlign = 'left'; g.fillStyle = C('--steel');
        g.fillText(nextTick + 's', xx + 5, yy - 4);
        g.fillStyle = C('--ink');
      }
      nextTick += 5;
    }
  }

  const last = path[upto - 1];
  if (reveal >= 1) {
    const mx = p.X(last.x), my = p.Y(last[vKey]);
    g.strokeStyle = res.summary.hit ? C('--green') : C('--red');
    g.lineWidth = 1.6;
    g.beginPath(); g.arc(mx, my, 8, 0, Math.PI * 2); g.stroke();
    if (res.summary.hit) {
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const ang = k * Math.PI / 4;
        g.moveTo(mx + Math.cos(ang) * 4, my + Math.sin(ang) * 4);
        g.lineTo(mx + Math.cos(ang) * 13, my + Math.sin(ang) * 13);
      }
      g.stroke();
    }
  } else {
    g.fillStyle = C('--ink');
    g.beginPath(); g.arc(p.X(last.x), p.Y(last[vKey]), 3, 0, Math.PI * 2); g.fill();
  }
}

// The aircraft samples are a fixed, generously long buffer (see
// aircraft.js), so "reveal fraction of the whole buffer" would barely
// show anything during the fire animation -- reveal only up to whichever
// missile flies longest, in sync with its own reveal. With Friendly fires
// off and Return fire off, neither missile exists to bound it -- fall back
// to the full precomputed aircraft duration so the flight paths still play
// out completely rather than freezing after a token second.
function aircraftRevealCount(ap) {
  const worldEnd = (res) => res ? res.summary.worldT0 + res.summary.t : 0;
  const bound = (!state.result && !state.resultB)
    ? (ap.shooter.length - 1) * ap.dt
    : Math.max(worldEnd(state.result), worldEnd(state.resultB), 1);
  return Math.max(2, Math.min(ap.shooter.length, Math.round((bound * state.reveal) / ap.dt)));
}

function drawAircraftTrack(g, p, samples, vKey, upto, color) {
  if (samples.length < 2) return;
  g.strokeStyle = color;
  g.setLineDash([2, 4]); g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(p.X(samples[0].x), p.Y(samples[0][vKey]));
  for (let i = 1; i < upto; i++) g.lineTo(p.X(samples[i].x), p.Y(samples[i][vKey]));
  g.stroke();
  g.setLineDash([]);
}

function drawManeuverMarkers(g, p, samples, dt, meta, vKey, label) {
  const findAt = (tt) => samples[Math.max(0, Math.min(samples.length - 1, Math.round(tt / dt)))];
  const mark = (tt, text) => {
    if (tt === null || tt === undefined) return;
    const pt = findAt(tt);
    const mx = p.X(pt.x), my = p.Y(pt[vKey]);
    g.fillStyle = C('--amber');
    g.beginPath(); g.arc(mx, my, 3, 0, Math.PI * 2); g.fill();
    g.font = '600 9px ' + C('--font-mono');
    g.fillStyle = C('--amber');
    g.textAlign = 'left';
    g.fillText(text, mx + 6, my + 3);
  };
  if (meta.crankEstablishedAt !== null) mark(meta.crankEstablishedAt, label + ' CRANK');
  if (meta.outTriggeredAt !== null) mark(meta.outTriggeredAt, label + ' OUT');
  if (meta.outEstablishedAt !== null) mark(meta.outEstablishedAt, label + ' COLD');
}

function drawAxes(g, w, h, p, uMin, uMax, vMin, vMax, vLabel, vTickFmt, vStep) {
  g.lineWidth = 1;
  g.font = '400 10px ' + C('--font-mono');
  g.fillStyle = C('--steel-dim');

  const vStart = Math.ceil(vMin / vStep) * vStep;
  for (let v = vStart; v <= vMax; v += vStep) {
    const y = p.Y(v);
    g.strokeStyle = v === 0 ? C('--slate-600') : 'rgba(38,54,74,0.55)';
    g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(w - PAD.r, y); g.stroke();
    g.textAlign = 'right';
    g.fillText(vTickFmt(v), PAD.l - 9, y + 3.5);
  }
  const nmMin = uMin * M_TO_NM, nmMax = uMax * M_TO_NM;
  const nmSpan = nmMax - nmMin;
  const nmStep = nmSpan > 55 ? 10 : (nmSpan > 26 ? 5 : 2);
  const nmStart = Math.ceil(nmMin / nmStep) * nmStep;
  for (let nm = nmStart; nm <= nmMax; nm += nmStep) {
    const x = p.X(nm * 1852);
    g.strokeStyle = 'rgba(38,54,74,0.55)';
    g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, p.Y(vMin)); g.stroke();
    g.textAlign = 'center';
    g.fillText(nm, x, p.Y(vMin) + 15);
  }
  g.textAlign = 'center';
  g.fillStyle = C('--steel');
  g.font = '500 10px ' + C('--font-mono');
  g.fillText('RANGE  NM', PAD.l + p.iw / 2, h - 8);
  g.save();
  g.translate(15, PAD.t + p.ih / 2); g.rotate(-Math.PI / 2);
  g.fillText(vLabel, 0, 0);
  g.restore();

  g.strokeStyle = C('--slate-600'); g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(PAD.l, p.Y(0)); g.lineTo(w - PAD.r, p.Y(0)); g.stroke();
}

function renderSide() {
  const { w, h } = sizeCanvas(cvSide);
  const p = pxSide(w, h);
  ctxSide.clearRect(0, 0, w, h);

  const kftStep = domain.yMax * M_TO_FT > 70000 ? 20000 : 10000;
  // Round -- v is a multiple of kftStep in principle, but the m<->ft round
  // trip leaves float noise (e.g. 9.999999999999998) that'd otherwise print.
  drawAxes(ctxSide, w, h, p, domain.xMin, domain.xMax, 0, domain.yMax, 'ALTITUDE  FT',
    (ft) => Math.round(ft * M_TO_FT / 1000) + 'k', kftStep * FT_TO_M);

  const ap = state.aircraftPaths;

  if (ap) {
    const uptoAp = aircraftRevealCount(ap);
    if (declutter.trackFriendly) drawAircraftTrack(ctxSide, p, ap.shooter, 'z', uptoAp, C('--cyan'));
    if (declutter.trackHostile) drawAircraftTrack(ctxSide, p, ap.target, 'z', uptoAp, C('--steel'));
    if (state.reveal >= 1) {
      if (declutter.maneuverFriendly) drawManeuverMarkers(ctxSide, p, ap.shooter, ap.dt, ap.shooterMeta, 'z', 'FRIENDLY');
      if (declutter.maneuverHostile) drawManeuverMarkers(ctxSide, p, ap.target, ap.dt, ap.targetMeta, 'z', 'HOSTILE');
    }
  }

  if (state.result && declutter.missileA) drawMissilePath(ctxSide, p, state.result, 'h', state.reveal);
  if (state.resultB && declutter.missileB) drawMissilePath(ctxSide, p, state.resultB, 'h', state.reveal);

  if (state.reveal >= 1 && state.result) {
    const sm = state.result.summary;
    if (declutter.seekerEvents) {
      drawSeekerEvent(ctxSide, p, sm.seekerFarEvent, 'h', C('--violet'),
        app.missile && app.missile.seekerFar !== null ? 'DETECT ' + (app.missile.seekerFar / 1000).toFixed(0) + 'km' : '', true);
      drawSeekerEvent(ctxSide, p, sm.seekerActiveEvent, 'h', C('--violet'),
        app.missile && app.missile.seekerActive !== null ? 'ACTIVE ' + (app.missile.seekerActive / 1000).toFixed(0) + 'km' : '', false);
    }
    if (declutter.firerTgtLine) drawFirerTgtLine(ctxSide, p, sm.seekerActiveEvent, 'h');
  }

  if (ap) {
    const s0 = ap.shooter[0], t0 = ap.target[0];
    // This view's horizontal axis is world X specifically (not total
    // horizontal speed), so the chevron angle has to be atan2(vz, vx) --
    // using signed vx, not Math.hypot(vx,vy) -- or an aircraft flying
    // right-to-left (any negative-vx case, e.g. a default target closing
    // on the shooter) would always draw nose-right regardless, since
    // hypot() throws away the sign that tells the two apart.
    const pitchDeg = (s) => Math.atan2(s.vz, s.vx) * 180 / Math.PI;
    if (declutter.trackFriendly) drawChevron(ctxSide, p.X(s0.x), p.Y(s0.z), pitchDeg(s0), C('--cyan'), 'FRIENDLY');
    if (declutter.trackHostile) drawChevron(ctxSide, p.X(t0.x), p.Y(t0.z), pitchDeg(t0), C('--red'), 'HOSTILE');
  }

  const exagg = (p.ih / domain.yMax) / (p.iw / (domain.xMax - domain.xMin));
  const note = 'Vertical scale exaggerated ×' + exagg.toFixed(1) + ' — the arc is much flatter than it looks.' +
    ' Drag either aircraft to reposition, or see the top-down view for true lateral separation.';
  el('scaleNote').textContent = note;
}

function renderTop() {
  const { w, h } = sizeCanvas(cvTop);
  const p = pxTop(w, h);
  ctxTop.clearRect(0, 0, w, h);

  const crossSpanNm = (domain.crossMax - domain.crossMin) * M_TO_NM;
  const crossNmStep = crossSpanNm > 20 ? 10 : 5;
  drawAxes(ctxTop, w, h, p, domain.xMin, domain.xMax, domain.crossMin, domain.crossMax, 'CROSS-RANGE  NM',
    (m) => (m * M_TO_NM).toFixed(0), crossNmStep * 1852);

  const ap = state.aircraftPaths;
  if (ap) {
    const uptoAp = aircraftRevealCount(ap);
    if (declutter.trackFriendly) drawAircraftTrack(ctxTop, p, ap.shooter, 'y', uptoAp, C('--cyan'));
    if (declutter.trackHostile) drawAircraftTrack(ctxTop, p, ap.target, 'y', uptoAp, C('--steel'));
    if (state.reveal >= 1) {
      if (declutter.maneuverFriendly) drawManeuverMarkers(ctxTop, p, ap.shooter, ap.dt, ap.shooterMeta, 'y', 'FRIENDLY');
      if (declutter.maneuverHostile) drawManeuverMarkers(ctxTop, p, ap.target, ap.dt, ap.targetMeta, 'y', 'HOSTILE');
    }
  }

  if (state.result && declutter.missileA) drawMissilePath(ctxTop, p, state.result, 'y', state.reveal);
  if (state.resultB && declutter.missileB) drawMissilePath(ctxTop, p, state.resultB, 'y', state.reveal);

  if (state.reveal >= 1 && state.result && declutter.firerTgtLine) {
    const sm = state.result.summary;
    drawFirerTgtLine(ctxTop, p, sm.seekerActiveEvent, 'y');
  }

  if (ap) {
    const s0 = ap.shooter[0], t0 = ap.target[0];
    if (declutter.trackFriendly) drawChevron(ctxTop, p.X(s0.x), p.Y(s0.y), s0.psi * 180 / Math.PI, C('--cyan'), 'FRIENDLY');
    if (declutter.trackHostile) drawChevron(ctxTop, p.X(t0.x), p.Y(t0.y), t0.psi * 180 / Math.PI, C('--red'), 'HOSTILE');
  }

  el('topScaleNote').textContent = 'Top-down: range vs. cross-range, to scale (1:1) — no altitude information.';
}

function drawFirerTgtLine(g, p, ev, vKey) {
  if (!ev) return;
  const sx = p.X(ev.firerX), sy = p.Y(vKey === 'h' ? ev.firerH : ev.firerY);
  const tx2 = p.X(ev.tgtX), ty2 = p.Y(vKey === 'h' ? ev.tgtH : ev.tgtY);
  g.save();
  g.strokeStyle = C('--green');
  g.lineWidth = 1.3;
  g.setLineDash([6, 3]);
  g.beginPath(); g.moveTo(sx, sy); g.lineTo(tx2, ty2); g.stroke();
  g.setLineDash([]);
  g.fillStyle = C('--green');
  g.beginPath(); g.arc(sx, sy, 3.5, 0, Math.PI * 2); g.fill();
  g.font = '600 10px ' + C('--font-mono');
  g.textAlign = 'center';
  g.fillText((ev.firerTgtRange * M_TO_NM).toFixed(1) + ' NM', (sx + tx2) / 2, (sy + ty2) / 2 - 8);
  g.restore();
}

export function render() {
  updateDomain();
  renderSide();
  renderTop();
}
