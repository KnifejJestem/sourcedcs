'use strict';

// CRC view — full theater picture, all tracks, 5-second sweep rate.
module.exports = {
  id: 'crc',

  // CRC shows all airborne tracks; ground units are irrelevant at theater scale.
  filterTracks: (tracks, _params) => tracks.filter(t => t.category !== 3),

  // 5-second sweep rate in milliseconds.
  sweepRate: (_params) => 5000,

  // No per-view track transformation needed for CRC.
  transformTrack: (track, _params) => track,
};
