'use strict';

const R_EARTH = 6371000;

function haversineM(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const RANGE_M = 80 * 1852; // 80 nm

module.exports = {
  id: 'approach',

  filterTracks(tracks, params) {
    if (params.lat == null || params.lon == null) return [];
    return tracks.filter(t => {
      if (t.category === 3) return false; // no ground vehicles on approach scope
      return haversineM(params.lat, params.lon, t.lat, t.lon) <= RANGE_M;
    });
  },

  sweepRate: (_params) => 3000,

  transformTrack: (track, _params) => track,
};
