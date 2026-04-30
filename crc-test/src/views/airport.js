'use strict';

const R_EARTH = 6371000;

function haversineM(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const RANGE_M  = 20 * 1852; // 20 nm — radar coverage radius
const GROUND_M =  2 * 1852; //  2 nm — surface movement zone

module.exports = {
  id: 'airport',

  filterTracks(tracks, params) {
    if (params.lat == null || params.lon == null) return [];
    return tracks.filter(t => {
      const dist = haversineM(params.lat, params.lon, t.lat, t.lon);
      // Ground vehicles (category 3) only within the surface-movement zone
      if (t.category === 3) return dist <= GROUND_M;
      // All other categories within the full radar radius
      return dist <= RANGE_M;
    });
  },

  sweepRate: (_params) => 3000,

  transformTrack(track, params) {
    if (params.lat == null || params.lon == null) return track;
    const dist = haversineM(params.lat, params.lon, track.lat, track.lon);
    const elev = params.elev || 0;
    // Ground vehicles always get callsign-only labels.
    // Airborne aircraft on or near the ground within the surface-movement zone also get
    // callsign-only labels (< 50 m AGL).
    const isSurface = track.category === 3 ||
      (dist <= GROUND_M && (track.alt - elev) < 50);
    if (isSurface) return { ...track, _csOnly: true };
    return track;
  },
};
