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

// ── Track numbers ─────────────────────────────────────────────────────────
// Auto-assigned TN##### identifiers for enemy-coalition tracks.
// Generated once per track ID and persisted so they stay stable across sessions.

const trackNumbers = new Map(); // trackId (string) → "TN#####"

function loadTrackNumbers() {
  try {
    const raw = localStorage.getItem('crc-desktop-track-numbers');
    if (!raw) return;
    for (const [id, tn] of Object.entries(JSON.parse(raw))) {
      if (tn && typeof tn === 'string') trackNumbers.set(id, tn);
    }
  } catch (_) {}
}

function saveTrackNumbers() {
  const obj = {};
  for (const [id, tn] of trackNumbers) obj[id] = tn;
  localStorage.setItem('crc-desktop-track-numbers', JSON.stringify(obj));
}

function clearAllTrackNumbers() {
  trackNumbers.clear();
  localStorage.removeItem('crc-desktop-track-numbers');
}

function getOrAssignTrackNumber(id) {
  const key = String(id);
  if (trackNumbers.has(key)) return trackNumbers.get(key);
  const used = new Set(trackNumbers.values());
  let tn;
  do { tn = 'TN' + String(Math.floor(10000 + Math.random() * 90000)); } while (used.has(tn));
  trackNumbers.set(key, tn);
  saveTrackNumbers();
  return tn;
}

// ── Track renames ─────────────────────────────────────────────────────────
// User-assigned custom callsigns, persisted across sessions.
// Lower priority than squawk→callsign mappings.

const trackRenames = new Map(); // trackId (string) → callsign string

function loadTrackRenames() {
  try {
    const raw = localStorage.getItem('crc-desktop-track-renames');
    if (!raw) return;
    for (const [id, name] of Object.entries(JSON.parse(raw))) {
      if (name && typeof name === 'string') trackRenames.set(id, name);
    }
  } catch (_) {}
}

function saveTrackRenames() {
  const obj = {};
  for (const [id, name] of trackRenames) obj[id] = name;
  localStorage.setItem('crc-desktop-track-renames', JSON.stringify(obj));
}

function setTrackRename(id, name) {
  const clean = (name || '').trim().toUpperCase();
  if (clean) trackRenames.set(String(id), clean);
  else       trackRenames.delete(String(id));
  saveTrackRenames();
}

function clearTrackRename(id) {
  trackRenames.delete(String(id));
  saveTrackRenames();
}

function clearAllTrackRenames() {
  trackRenames.clear();
  localStorage.removeItem('crc-desktop-track-renames');
}

// Resolves the display callsign for a track.
// Priority: squawkMap (exact) → squawkSeq (range) → custom rename → TN##### (enemy) → raw callsign
function resolveCallsign(track) {
  if (track.squawk != null) {
    const sq = Number(track.squawk);

    // Exact squawk→callsign mapping (highest priority)
    if (settings.squawkMap) {
      const mapped = settings.squawkMap[String(sq)];
      if (mapped) return mapped;
    }

    // Sequential range mapping
    if (settings.squawkSeq) {
      for (const [baseCode, baseName] of Object.entries(settings.squawkSeq)) {
        const base   = parseInt(baseCode, 10);
        const offset = sq - base;
        if (offset >= 0 && offset <= 98) {
          return baseName + (offset + 1);
        }
      }
    }
  }

  // User-assigned custom rename (lower priority than squawk mapping)
  const rename = trackRenames.get(String(track.id));
  if (rename) return rename;

  // Enemy-coalition tracks get a persistent random track number (TN#####)
  if (typeof userCoalition !== 'undefined'
      && track.coalition != null
      && track.coalition !== 1          // not neutral
      && track.coalition !== userCoalition) {
    return getOrAssignTrackNumber(track.id);
  }

  return track.callsign;
}
