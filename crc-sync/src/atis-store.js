'use strict';

// Tracks which client "owns" an active ATIS transmit loop per frequency, so
// crc-sync (the single shared backend every controller's crc-desktop connects
// to) can reject a second client's loop on the same frequency instead of
// blindly forwarding both to SRS. Previously /api/atis-transmit was fully
// stateless — nothing here before this stopped multiple clients from
// double-transmitting, and stop() sends the first real cancel signal the
// server has ever received (before, "stop" only cleared a client-side timer).
//
// ownerId is a client-generated id (crc-desktop mints one per app session),
// not the Casdoor identity — ATIS transmit is a stateless REST POST, not a
// WS session, so there's no existing per-connection identity to key off.

class AtisStore {
  constructor(ttlMs = 8000) {
    this._byFreq = new Map(); // frequency -> { ownerId, startedAt, call }
    this._ttlMs  = ttlMs;
  }

  _isStale(entry) {
    return Date.now() - entry.startedAt > this._ttlMs;
  }

  // A loop may (re)start on a frequency if nobody else holds it, the same
  // owner already holds it (its own next 5s tick), or the holder went stale
  // (e.g. the process died mid-transmit without calling stop/finish).
  canStart(freq, ownerId) {
    const entry = this._byFreq.get(freq);
    if (!entry) return true;
    if (entry.ownerId === ownerId) return true;
    return this._isStale(entry);
  }

  start(freq, ownerId, call) {
    this._byFreq.set(freq, { ownerId, startedAt: Date.now(), call });
  }

  // Only clears the entry if it's still the same in-flight call — a settling
  // callback from a call that's already been superseded (e.g. a same-owner
  // retry raced ahead of it) must not clobber the newer entry.
  finish(freq, call) {
    const entry = this._byFreq.get(freq);
    if (entry && entry.call === call) this._byFreq.delete(freq);
  }

  // Only the owner that started a loop can stop it. Cancelling the in-flight
  // gRPC call at minimum stops crc-sync from waiting on/reporting it, even if
  // the DCS-SRS side can't be interrupted mid-playback.
  stop(freq, ownerId) {
    const entry = this._byFreq.get(freq);
    if (!entry || entry.ownerId !== ownerId) return false;
    if (entry.call && typeof entry.call.cancel === 'function') {
      try { entry.call.cancel(); } catch (_) { /* already settled */ }
    }
    this._byFreq.delete(freq);
    return true;
  }
}

module.exports = AtisStore;
