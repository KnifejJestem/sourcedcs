'use strict';

// ── Geo / kinematic math ───────────────────────────────────────────────────
// Pure functions — no globals, no side effects.

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
  const p  = hist[hist.length - 2];
  const c  = hist[hist.length - 1];
  const dt = (c.timestamp - p.timestamp) / 1000;
  if (dt <= 0) return { heading: 0, speedMs: 0, speedKt: 0 };
  const dist = haversineM(p.lat, p.lon, c.lat, c.lon);
  return {
    heading: bearingDeg(p.lat, p.lon, c.lat, c.lon),
    speedMs: dist / dt,
    speedKt: (dist / dt) * 1.944,
  };
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
function squawkEmergency(squawk) {
  if (squawk == null) return null;
  return SQUAWK_EMERGENCY[squawk] || null;
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

// Resolves the display callsign for a track.
// If the track's squawk code has a user-defined mapping in squawkMap, that name is returned;
// otherwise the gRPC callsign is used.
function resolveCallsign(track) {
  if (track.squawk != null && settings.squawkMap) {
    const mapped = settings.squawkMap[String(track.squawk)];
    if (mapped) return mapped;
  }
  return track.callsign;
}

// Returns true when this track should be visible given the current view + reference.
// Airport view: server already filtered to 20 nm; always true here.
// CRC view: filtered to 200 nm from selectedRef if one is set.
function checkInRange(track) {
  if (activeView !== 'crc') return true;
  if (!selectedRef) return true;
  const ref = tracks.get(selectedRef);
  if (!ref) return true;
  return haversineM(ref.lat, ref.lon, track.lat, track.lon) <= CRC_RANGE_M;
}
