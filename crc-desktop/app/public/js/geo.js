'use strict';

// ── Geo / kinematic math ───────────────────────────────────────────────────
// Pure functions — no globals, no side effects. Unchanged: these run
// per-track locally in every client (crc-desktop and the crc-sync web view
// alike) purely for trail/heading rendering, independent of the shared
// multiplayer state below.

function haversineM(lat1, lon1, lat2, lon2) {
  const R  = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const y  = Math.sin(Δλ) * Math.cos(φ2);
  const x  = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function projectPos(lat, lon, headingDeg, distM) {
  const R  = 6371000;
  const d  = distM / R;
  const θ  = headingDeg * Math.PI / 180;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lon * Math.PI / 180;
  const φ2 = Math.asin(Math.sin(φ1)*Math.cos(d) + Math.cos(φ1)*Math.sin(d)*Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ)*Math.sin(d)*Math.cos(φ1), Math.cos(d)-Math.sin(φ1)*Math.sin(φ2));
  return [φ2 * 180 / Math.PI, ((λ2 * 180 / Math.PI) + 540) % 360 - 180];
}

function kinematics(hist) {
  if (hist.length < 2) return { heading: 0, speedMs: 0, speedKt: 0 };

  // Heading: last two points — most recent direction.
  const p = hist[hist.length - 2];
  const c = hist[hist.length - 1];
  const heading = bearingDeg(p.lat, p.lon, c.lat, c.lon);

  // Speed: sum distance and time across ALL consecutive pairs.
  // Averaging over the full history window suppresses single-hop noise
  // that would otherwise cause ±400 kt spikes from a single bad position.
  let totalDist = 0, totalTime = 0;
  for (let i = 1; i < hist.length; i++) {
    totalDist += haversineM(hist[i-1].lat, hist[i-1].lon, hist[i].lat, hist[i].lon);
    totalTime += (hist[i].timestamp - hist[i-1].timestamp) / 1000;
  }
  if (totalTime <= 0) return { heading, speedMs: 0, speedKt: 0 };
  const speedMs = totalDist / totalTime;
  return { heading, speedMs, speedKt: speedMs * 1.944 };
}

function verticalFpm(hist) {
  if (hist.length < 2) return 0;
  const curr   = hist[hist.length - 1];
  const target = curr.timestamp - 5000;
  let ref = hist[0];
  for (let i = 1; i < hist.length - 1; i++) {
    if (hist[i].timestamp <= target) ref = hist[i];
  }
  const dtS = (curr.timestamp - ref.timestamp) / 1000;
  if (dtS <= 0) return 0;
  return (curr.alt - ref.alt) * 3.281 * 60 / dtS;
}

// Returns the emergency type string for a squawk code, or null.
// Coerces squawk to number so both "7700" (string) and 7700 (number) match.
function squawkEmergency(squawk) {
  if (squawk == null) return null;
  return SQUAWK_EMERGENCY[Number(squawk)] || null;
}

// Returns true if the track is on the ground:
// within GROUND_RADIUS_M of any airport AND below airport elevation + GROUND_AGL_M.
function checkOnGround(track) {
  if (!missionData || !missionData.airports) return false;
  if (track.category !== 1 && track.category !== 2) return false;
  for (const ap of missionData.airports) {
    if (!ap.lat || !ap.lon) continue;
    const distM = haversineM(track.lat, track.lon, ap.lat, ap.lon);
    if (distM < GROUND_RADIUS_M) {
      const agl = track.alt - (ap.elev || 0);
      if (agl < GROUND_AGL_M) return true;
    }
  }
  return false;
}

// ── Track numbers & renames ─────────────────────────────────────────────────
// Moved server-side (crc-sync's src/collab-store.js + resolve.js). Track
// numbers are no longer a manual client action either — crc-sync assigns
// TN##### automatically the moment an enemy track is first resolved for
// anyone, exactly like this file used to do locally on-demand, just now
// guaranteed identical for every viewer. These functions keep their
// original names/signatures — every call site in ui.js/geojson.js/app.js
// is unchanged.

// No-ops: state now arrives from crc-sync on every (re)connect, and crc-sync
// clears the shared overlay for everyone on mission-load — a client no
// longer loads/clears its own local copy.
function loadTrackNumbers() {}
function clearAllTrackNumbers() {}
function loadTrackRenames() {}
function clearAllTrackRenames() {}

function setTrackRename(id, name) {
  const clean = (name || '').trim().toUpperCase();
  if (clean) sendToSync({ type: 'rename', trackId: String(id), name: clean });
  else       sendToSync({ type: 'clearRename', trackId: String(id) });
}

function clearTrackRename(id) {
  sendToSync({ type: 'clearRename', trackId: String(id) });
}

// Resolves the display callsign for a track. crc-sync resolves this
// server-side (squawk map -> squawk range -> rename -> auto TN##### for
// enemy tracks -> raw callsign, see crc-sync/src/resolve.js, ported from
// what this function used to compute locally) and attaches the result
// directly as `callsign` on every track it sends.
function resolveCallsign(track) {
  return (track && track.callsign) || '';
}
