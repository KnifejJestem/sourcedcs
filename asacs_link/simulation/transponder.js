/**
 * simulation/transponder.js
 *
 * UDP receiver for SRS (or compatible) transponder IFF data.
 *
 * Protocol: clients broadcast JSON packets to UDP port 10712 (configurable).
 * Expected payload shape:
 *   { "clients": [ { "name": "Callsign", "iff": { "mode3": 7700, "status": "active" } }, … ] }
 *
 * The stored IFF map is keyed by client name (pilot callsign) so the
 * simulation engine can join it against unit pilot names.
 *
 * Future expansion points:
 *   - mode1 / mode2 / mode4 / mode5 fields
 *   - transponder frequency simulation (when SRS exposes it)
 *   - per-client connection tracking / stale entry expiry
 */

import { createSocket } from 'dgram';

/** How long (ms) an IFF entry is kept without a fresh packet before expiry. */
const IFF_STALE_MS = 30_000;

export class TransponderReceiver {
  /**
   * @param {number} port  UDP port to bind (default: 10712)
   * @param {function} [onData]  Optional callback invoked with (name, iffData) on each update
   */
  constructor(port = 10712, onData = null) {
    this._port   = port;
    this._onData = onData;

    /**
     * IFF data store keyed by client name.
     * Shape: Map<string, { mode3: number|null, status: string|null, _ts: number }>
     */
    this._data = new Map();

    this._socket = null;
  }

  /** Start listening for UDP packets. */
  start() {
    if (this._socket) return;

    this._socket = createSocket('udp4');

    this._socket.on('error', (err) => {
      console.error('[Transponder] UDP socket error:', err.message);
    });

    this._socket.on('message', (buf) => {
      let payload;
      try {
        payload = JSON.parse(buf.toString('utf8'));
      } catch {
        return; // silently drop malformed packets
      }

      const clients = Array.isArray(payload.clients) ? payload.clients : [];
      const now = Date.now();
      for (const client of clients) {
        const name = client.name;
        if (!name) continue;
        const iff = client.iff || {};
        const entry = {
          mode3:  iff.mode3  ?? null,
          status: iff.status ?? null,
          _ts:    now,
        };
        this._data.set(name, entry);
        if (this._onData) this._onData(name, entry);
      }
    });

    this._socket.bind(this._port, '0.0.0.0', () => {
      console.log(`[Transponder] UDP listener bound on port ${this._port}`);
    });

    // Periodically remove stale entries so the map doesn't grow unbounded.
    this._pruneInterval = setInterval(() => this._prune(), 60_000);
  }

  /** Stop the UDP listener and clear state. */
  stop() {
    if (this._pruneInterval) {
      clearInterval(this._pruneInterval);
      this._pruneInterval = null;
    }
    if (this._socket) {
      this._socket.close();
      this._socket = null;
    }
  }

  /**
   * Returns the IFF data for a given client name, or null if not found.
   * @param {string} name
   * @returns {{ mode3: number|null, status: string|null } | null}
   */
  getIff(name) {
    const entry = this._data.get(name);
    if (!entry) return null;
    const { _ts, ...iff } = entry; // eslint-disable-line no-unused-vars
    return iff;
  }

  /**
   * Returns a shallow copy of the entire IFF data map (name → iff).
   * Used by the simulation engine to annotate units in bulk.
   * @returns {Map<string, object>}
   */
  getAllIff() {
    return this._data;
  }

  _prune() {
    const cutoff = Date.now() - IFF_STALE_MS;
    for (const [name, entry] of this._data) {
      if (entry._ts < cutoff) this._data.delete(name);
    }
  }
}
