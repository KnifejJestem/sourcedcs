import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrack, computeAutoIff, resolveCallsign, checkOnGround } from '../src/resolve.js';

// Default server coalition is BLUE (3) unless CRCSYNC_COALITION=2 is set.

test('computeAutoIff: own-coalition AI unit is always friendly', () => {
  const track = { coalition: 3, player: null, squawk: null, category: 1, lat: 0, lon: 0, alt: 3000 };
  assert.equal(computeAutoIff(track, null), 'friendly');
});

test('computeAutoIff: own-coalition player with active transponder is friendly', () => {
  const track = { coalition: 3, player: 'Pilot', squawk: 1200, category: 1, lat: 0, lon: 0, alt: 3000 };
  assert.equal(computeAutoIff(track, null), 'friendly');
});

test('computeAutoIff: own-coalition player without transponder, airborne, is bogey', () => {
  const track = { coalition: 3, player: 'Pilot', squawk: null, category: 1, lat: 0, lon: 0, alt: 3000 };
  assert.equal(computeAutoIff(track, null), 'bogey');
});

test('computeAutoIff: enemy airborne is bogey, enemy on the ground is invisible', () => {
  // Note: checkOnGround's `if (!ap.lat || !ap.lon) continue` (ported verbatim
  // from the original geo.js) treats an airport at exactly lat/lon 0 as
  // falsy and skips it — a harmless pre-existing quirk since no real DCS
  // theater airport sits at 0,0. Using non-zero coordinates here to avoid it.
  const missionData = { airports: [{ lat: 36.0, lon: 35.0, elev: 0 }] };
  const airborne = { coalition: 2, player: 'Pilot', category: 1, lat: 10, lon: 10, alt: 3000 };
  assert.equal(computeAutoIff(airborne, missionData), 'bogey');

  const onGround = { coalition: 2, player: 'Pilot', category: 1, lat: 36.001, lon: 35.001, alt: 10 };
  assert.equal(computeAutoIff(onGround, missionData), 'invisible');
});

test('computeAutoIff: neutral coalition is always neutral', () => {
  const track = { coalition: 1, player: null, category: 1, lat: 0, lon: 0, alt: 3000 };
  assert.equal(computeAutoIff(track, null), 'neutral');
});

test('checkOnGround requires both proximity and low AGL', () => {
  const missionData = { airports: [{ lat: 36.0, lon: 35.0, elev: 500 }] };
  // close but too high above field elevation
  assert.equal(checkOnGround({ category: 1, lat: 36.001, lon: 35.001, alt: 5000 }, missionData), false);
  // close and low
  assert.equal(checkOnGround({ category: 1, lat: 36.001, lon: 35.001, alt: 520 }, missionData), true);
});

test('resolveCallsign: rename beats auto track-number assignment for enemy tracks', () => {
  const track = { id: '5', coalition: 2, callsign: 'Raw', squawk: null };
  const collabEntry = { rename: { value: 'BANDIT LEAD' } };
  const assign = () => { throw new Error('should not be called — rename takes priority'); };
  assert.equal(resolveCallsign(track, collabEntry, assign), 'BANDIT LEAD');
});

test('resolveCallsign: enemy track with no rename gets an auto track number', () => {
  const track = { id: '6', coalition: 2, callsign: 'Raw', squawk: null };
  const assign = (id) => `TN-${id}`;
  assert.equal(resolveCallsign(track, null, assign), 'TN-6');
});

test('resolveCallsign: own-coalition track falls through to raw callsign', () => {
  const track = { id: '7', coalition: 3, callsign: 'Enfield 1', squawk: null };
  const assign = () => { throw new Error('should not be called for own-coalition tracks'); };
  assert.equal(resolveCallsign(track, null, assign), 'Enfield 1');
});

test('resolveTrack merges telemetry + overlay into one resolved object', () => {
  const track = { id: '8', coalition: 2, callsign: 'Raw', squawk: null, player: 'X', category: 1, lat: 10, lon: 10, alt: 3000 };
  const collabEntry = { iff: { state: 'hostile' }, rename: { value: 'BOGEY 1' }, trackNumber: { value: 'TN12345' } };
  const resolved = resolveTrack(track, collabEntry, null, () => 'unused');
  assert.equal(resolved.iffState, 'hostile');
  assert.equal(resolved.callsign, 'BOGEY 1');
  assert.equal(resolved.trackNumber, 'TN12345');
  assert.equal(resolved.id, '8'); // original fields still present
});
