'use strict';

const STALE_MS = 12000; // remove tracks not updated within this window

class TrackStore {
  constructor() {
    this._tracks   = new Map(); // id → track
    this._lastSeen = new Map(); // id → Date.now()
    this._log      = [];        // [{seq, type:'update'|'gone', id, track?}]
    this._seq      = 0;
  }

  // Remove tracks whose last update is older than STALE_MS.
  // Returns the number of tracks expired.
  expireStale() {
    const cutoff = Date.now() - STALE_MS;
    let count = 0;
    for (const [id, ts] of this._lastSeen) {
      if (ts < cutoff) {
        this.remove(id);
        count++;
      }
    }
    return count;
  }

  update(unitData, transponder) {
    const track = {
      id:        unitData.id,
      callsign:  unitData.callsign,
      coalition: unitData.coalition,
      type:      unitData.type,
      lat:       unitData.lat,
      lon:       unitData.lon,
      alt:       unitData.alt,
      heading:   unitData.heading || 0,
      player:    unitData.player,
      category:  unitData.category,
    };

    if (transponder) {
      if (transponder.squawk       !== undefined) track.squawk       = transponder.squawk;
      if (transponder.squawkStatus !== undefined) track.squawkStatus = transponder.squawkStatus;
      if (transponder.mode4        !== undefined) track.mode4        = transponder.mode4;
    }

    this._tracks.set(unitData.id, track);
    this._lastSeen.set(unitData.id, Date.now());
    this._log.push({ seq: ++this._seq, type: 'update', id: unitData.id, track });
    this._pruneLog();
  }

  remove(id) {
    if (!this._tracks.has(id)) return;
    this._tracks.delete(id);
    this._lastSeen.delete(id);
    this._log.push({ seq: ++this._seq, type: 'gone', id });
    this._pruneLog();
  }

  // Called on mission reload — flush all tracks as gone
  clear() {
    for (const id of this._tracks.keys()) {
      this._log.push({ seq: ++this._seq, type: 'gone', id });
    }
    this._tracks.clear();
    this._lastSeen.clear();
    this._pruneLog();
  }

  getAll() { return [...this._tracks.values()]; }

  // Added for crc-sync's ws-hub.js, which needs to join CollaborativeStore
  // deltas (string ids) back against raw tracks (id type as emitted by
  // grpc-client.js) — not present in the original crc-desktop version.
  get(id) {
    return this._tracks.get(id) || this._tracks.get(Number(id)) || this._tracks.get(String(id)) || null;
  }

  get currentSeq() { return this._seq; }

  // Returns { updated: Track[], gone: string[], seq: number }
  // All changes that occurred after `afterSeq`.
  getDeltaSince(afterSeq) {
    // Collect log entries newer than afterSeq (log is append-only, oldest first)
    const entries = [];
    for (let i = this._log.length - 1; i >= 0; i--) {
      if (this._log[i].seq <= afterSeq) break;
      entries.unshift(this._log[i]);
    }

    // Collapse per-id: only the last event per id matters
    const byId = new Map();
    for (const e of entries) byId.set(e.id, e);

    const updated = [], gone = [];
    for (const e of byId.values()) {
      if (e.type === 'update' && this._tracks.has(e.id)) {
        updated.push(this._tracks.get(e.id)); // always use latest version
      } else if (e.type === 'gone' && !this._tracks.has(e.id)) {
        gone.push(e.id);
      }
    }
    return { updated, gone, seq: this._seq };
  }

  // Keep only the last 1000 log entries (oldest first)
  _pruneLog() {
    if (this._log.length > 2000) this._log.splice(0, this._log.length - 1000);
  }
}

module.exports = TrackStore;
