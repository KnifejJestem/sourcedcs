// ═══════════════════════════════════════════════════════════
// map-data.js — Collect plottable data from the ATO
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Collect all plottable data ─────────────────────────────
function collectData(ato) {
  const points = [];
  const routes = []; // [{msnKey, callsign, msnNumber, color, segments:[{from,to,style}]}]
  const missions = ato.missions || [];

  // Build a lookup: icao → {lat,lon} for airfields + carriers
  const locByIcao = {};
  (ato.airfields || []).forEach(af => {
    const p = parseCoord(af.coords);
    if (p && af.icao) locByIcao[af.icao.toUpperCase()] = p;
  });
  (ato.carriers || []).forEach(cv => {
    if (cv.deploy_coords && cv.callsign) {
      const p = parseCoord(cv.deploy_coords);
      if (p) locByIcao[cv.callsign.toUpperCase()] = p;
    }
  });

  // Bullseye
  const bs = ato.global_control?.bullseye;
  if (bs?.coords) {
    const p = parseCoord(bs.coords);
    if (p) points.push({ ...p, kind:'bullseye', label: bs.name || 'BULLSEYE', sub:'' });
  }

  // Per-mission data
  missions.forEach(m => {
    const color   = typeColor(m.mission_type);
    const callsign = m.callsign || '?';
    const msnNum   = m.mission_number || '';
    const msnKey   = msnNum || callsign;
    const route    = { msnKey, callsign, msnNum, color, pts: [] }; // ordered list of {lat,lon,kind}

    // Helper: resolve a location string — try as ICAO first, then coord parse
    const resolve = str => {
      if (!str) return null;
      const up = str.trim().toUpperCase();
      if (locByIcao[up]) return locByIcao[up];
      return parseCoord(str);
    };

    // 1. Deploy airfield / carrier
    const deployLoc = resolve(m.deploy_location_icao);
    if (deployLoc) route.pts.push({ ...deployLoc, kind:'route-node' });

    // 2. Steer points (en-route waypoints)
    (m.steer_points || []).forEach((sp, i) => {
      const raw = typeof sp === 'string' ? sp : sp.coords;
      const name = (typeof sp === 'object' && sp.name) ? sp.name : `SP${i+1}`;
      const p = parseCoord(raw);
      if (p) {
        route.pts.push({ ...p, kind:'route-node' });
        points.push({ ...p, kind:'steer',
          label: `${callsign}${msnNum ? ' · '+msnNum : ''}`,
          sub: name, color, msnType: m.mission_type, mission: m });
      }
    });

    // 3. Aim points (targets)
    (m.target?.aim_points || []).forEach((ap, i) => {
      const raw = typeof ap === 'string' ? ap : ap.coords;
      const name = (typeof ap === 'object' && ap.name) ? ap.name : `AIM ${i+1}`;
      const p = parseCoord(raw);
      if (p) {
        route.pts.push({ ...p, kind:'target-node' });
        points.push({ ...p, kind:'target',
          label: callsign, sub: name, color, msnType: m.mission_type, mission: m });
      }
    });

    // 4. Recovery airfield / carrier
    const recLoc = resolve(m.aar_location_icao) || resolve(m.deploy_location_icao);
    if (recLoc) route.pts.push({ ...recLoc, kind:'route-node' });

    if (route.pts.length >= 2) routes.push(route);
  });

  // Airfields
  (ato.airfields || []).forEach(af => {
    const p = parseCoord(af.coords);
    if (p) points.push({ ...p, kind:'airfield',
      label: af.icao || af.name || '?',
      sub: [af.role, af.elevation_ft != null ? af.elevation_ft+'ft' : null].filter(Boolean).join(' · ') });
  });

  // Carriers
  (ato.carriers || []).forEach(cv => {
    if (cv.deploy_coords) {
      const p = parseCoord(cv.deploy_coords);
      if (p) points.push({ ...p, kind:'carrier',
        label: cv.name || cv.callsign || 'CVN', sub: 'DEPLOY EST' });
    }
    if (cv.recovery_coords) {
      const p = parseCoord(cv.recovery_coords);
      if (p) points.push({ ...p, kind:'carrier',
        label: cv.name || cv.callsign || 'CVN', sub: 'RECOVERY EST' });
    }
  });

  return { points, routes };
}

// ── Coord parser ───────────────────────────────────────────
function parseCoord(str) {
  if (!str) return null;
  const re = /([NS])\s*(\d+)[°d][^\d]*(\d+(?:\.\d+)?)['\s]*(?:(\d+(?:\.\d+)?)["″\s]*)?\s*([EW])\s*(\d+)[°d][^\d]*(\d+(?:\.\d+)?)['\s]*(?:(\d+(?:\.\d+)?)["″]?)?/i;
  const m = str.match(re);
  if (!m) return null;
  const lat = (m[1]==='N'?1:-1)*(+m[2] + +m[3]/60 + +(m[4]||0)/3600);
  const lon = (m[5]==='E'?1:-1)*(+m[6] + +m[7]/60 + +(m[8]||0)/3600);
  return (isNaN(lat)||isNaN(lon)) ? null : { lat, lon };
}
