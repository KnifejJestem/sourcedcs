'use strict';

// Server-authoritative store for the collaborative overlay: IFF declarations,
// track-number assignments, and renames — the state that used to live in
// each crc-desktop client's localStorage (app/public/js/iff.js, geo.js).
// Modeled 1:1 on TrackStore's snapshot+delta-log shape (src/tracks.js) so
// both stores drive the same tick/broadcast code in ws-hub.js.
//
// Deliberately a flat bag of named optional sub-fields per track id, not a
// fixed tuple — a future points-store.js (separate store, separate id-space,
// for shared map annotations) can be added later without reshaping this one.

const { IFF_STATES } = require('./resolve');

class CollaborativeStore {
  constructor() {
    this._overlay = new Map(); // id (string) -> { id, iff, trackNumber, rename }
    this._log     = [];        // [{seq, type:'update'|'gone', id}]
    this._seq     = 0;
  }

  get currentSeq() { return this._seq; }

  get(id) { return this._overlay.get(String(id)) || null; }

  _entry(id) {
    const key = String(id);
    let e = this._overlay.get(key);
    if (!e) {
      e = { id: key, iff: null, trackNumber: null, rename: null };
      this._overlay.set(key, e);
    }
    return e;
  }

  _touch(id) {
    this._log.push({ seq: ++this._seq, type: 'update', id: String(id) });
    this._pruneLog();
  }

  // Drops an entry entirely once all three fields are empty, so evictStale
  // and snapshot/delta don't carry around empty husks forever.
  _dropIfEmpty(id) {
    const key = String(id);
    const e = this._overlay.get(key);
    if (e && !e.iff && !e.trackNumber && !e.rename) this._overlay.delete(key);
  }

  // ── IFF declaration ───────────────────────────────────────────────────────

  declare(id, state, by) {
    if (!IFF_STATES.includes(state)) return null;
    const e = this._entry(id);
    e.iff = { state, by: by || null, at: Date.now() };
    this._touch(id);
    return e;
  }

  clearDeclare(id) {
    const e = this._overlay.get(String(id));
    if (!e || !e.iff) return;
    e.iff = null;
    this._dropIfEmpty(id);
    this._touch(id);
  }

  // ── Rename ─────────────────────────────────────────────────────────────────

  rename(id, value, by) {
    const clean = String(value || '').trim().toUpperCase();
    if (!clean) return this.clearRename(id);
    const e = this._entry(id);
    e.rename = { value: clean, by: by || null, at: Date.now() };
    this._touch(id);
    return e;
  }

  clearRename(id) {
    const e = this._overlay.get(String(id));
    if (!e || !e.rename) return;
    e.rename = null;
    this._dropIfEmpty(id);
    this._touch(id);
  }

  // ── Track number ─────────────────────────────────────────────────────────
  // Server-authoritative and idempotent: a second call for the same track
  // just returns the number already assigned. Single-threaded event loop
  // makes this check-then-set atomic in practice — no locking needed, as
  // long as nothing awaits between the check and the set below.

  getOrAssignTrackNumber(id, by) {
    const existing = this._overlay.get(String(id));
    if (existing && existing.trackNumber) return existing.trackNumber.value;

    const used = new Set();
    for (const e of this._overlay.values()) {
      if (e.trackNumber) used.add(e.trackNumber.value);
    }
    let tn;
    do { tn = 'TN' + String(Math.floor(10000 + Math.random() * 90000)); } while (used.has(tn));

    const e = this._entry(id);
    e.trackNumber = { value: tn, by: by || null, at: Date.now() };
    this._touch(id);
    return tn;
  }

  // ── Mission reload ────────────────────────────────────────────────────────
  // Confirmed intentional behavior change from the original per-client code:
  // this wipes declarations/track-numbers/renames for the entire connected
  // squadron at once, not just one client's local state.

  clear() {
    for (const id of this._overlay.keys()) {
      this._log.push({ seq: ++this._seq, type: 'gone', id });
    }
    this._overlay.clear();
    this._pruneLog();
  }

  // ── Stale-track eviction ─────────────────────────────────────────────────
  // Called from the same tick as TrackStore's stale-reaper. Without this, a
  // declared/numbered/renamed track that despawns leaves its overlay entry
  // orphaned forever, and a later track that reuses the same DCS unit id
  // would silently inherit a stale declaration/number nobody set for it.

  evictStale(activeTrackIds) {
    let count = 0;
    for (const id of [...this._overlay.keys()]) {
      if (!activeTrackIds.has(id)) {
        this._overlay.delete(id);
        this._log.push({ seq: ++this._seq, type: 'gone', id });
        count++;
      }
    }
    if (count > 0) this._pruneLog();
    return count;
  }

  getAll() { return [...this._overlay.values()]; }

  // Returns { updatedIds: string[], goneIds: string[], seq } — ids only, not
  // full tracks, since resolving requires joining against TrackStore too;
  // ws-hub.js does that join.
  getDeltaSince(afterSeq) {
    const entries = [];
    for (let i = this._log.length - 1; i >= 0; i--) {
      if (this._log[i].seq <= afterSeq) break;
      entries.unshift(this._log[i]);
    }
    const byId = new Map();
    for (const e of entries) byId.set(e.id, e);

    const updatedIds = [], goneIds = [];
    for (const e of byId.values()) {
      if (e.type === 'update' && this._overlay.has(e.id)) updatedIds.push(e.id);
      else if (e.type === 'gone' && !this._overlay.has(e.id)) goneIds.push(e.id);
    }
    return { updatedIds, goneIds, seq: this._seq };
  }

  _pruneLog() {
    if (this._log.length > 2000) this._log.splice(0, this._log.length - 1000);
  }
}

module.exports = CollaborativeStore;
