import { test } from 'node:test';
import assert from 'node:assert/strict';
import CollaborativeStore from '../src/collab-store.js';

test('assignTrackNumber is idempotent for the same track', () => {
  const store = new CollaborativeStore();
  const tn1 = store.getOrAssignTrackNumber('100');
  const tn2 = store.getOrAssignTrackNumber('100');
  assert.equal(tn1, tn2);
});

test('assignTrackNumber never collides across tracks', () => {
  const store = new CollaborativeStore();
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const tn = store.getOrAssignTrackNumber(String(i));
    assert.ok(!seen.has(tn), `collision on ${tn}`);
    seen.add(tn);
  }
});

test('declare / clearDeclare round-trip and drop empty entries', () => {
  const store = new CollaborativeStore();
  store.declare('7', 'hostile', 'Alice');
  assert.equal(store.get('7').iff.state, 'hostile');
  assert.equal(store.get('7').iff.by, 'Alice');

  store.clearDeclare('7');
  assert.equal(store.get('7'), null, 'entry should be dropped once all fields are empty');
});

test('declare rejects an invalid IFF state', () => {
  const store = new CollaborativeStore();
  store.declare('7', 'not-a-real-state', 'Alice');
  assert.equal(store.get('7'), null);
});

test('rename trims/uppercases and clearing an empty rename clears it', () => {
  const store = new CollaborativeStore();
  store.rename('9', '  enfield 1  ', 'Bob');
  assert.equal(store.get('9').rename.value, 'ENFIELD 1');
  store.rename('9', '', 'Bob'); // empty rename == clear
  assert.equal(store.get('9'), null);
});

test('evictStale removes entries for tracks no longer active, keeps active ones', () => {
  const store = new CollaborativeStore();
  store.declare('1', 'hostile', 'Alice');
  store.declare('2', 'bandit', 'Alice');
  const evicted = store.evictStale(new Set(['1'])); // only '1' still active
  assert.equal(evicted, 1);
  assert.ok(store.get('1'));
  assert.equal(store.get('2'), null);
});

test('clear() flushes every entry and logs gone events', () => {
  const store = new CollaborativeStore();
  store.declare('1', 'hostile', 'Alice');
  store.declare('2', 'bandit', 'Bob');
  const seqBefore = store.currentSeq;
  store.clear();
  assert.equal(store.getAll().length, 0);
  const delta = store.getDeltaSince(seqBefore);
  assert.deepEqual(delta.goneIds.sort(), ['1', '2']);
});

test('getDeltaSince only reports entries changed after the given seq', () => {
  const store = new CollaborativeStore();
  store.declare('1', 'hostile', 'Alice');
  const seq1 = store.currentSeq;
  store.declare('2', 'bandit', 'Bob');
  const delta = store.getDeltaSince(seq1);
  assert.deepEqual(delta.updatedIds, ['2']);
});
