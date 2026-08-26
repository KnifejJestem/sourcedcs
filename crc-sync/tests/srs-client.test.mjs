import { test } from 'node:test';
import assert from 'node:assert/strict';
import SrsClient from '../src/srs-client.js';

/* Exercises _applyClient/getTransponder directly, without ever calling
   .connect() -- no real TCP socket involved. */

function radioUpdate(name, mode3, status) {
  return { Name: name, RadioInfo: { IFF: { mode3, status } } };
}

test('ident latch holds squawkStatus=2 for a grace period after the pulse', () => {
  const c = new SrsClient();
  c._applyClient(radioUpdate('Pilot', 1234, 2));
  assert.equal(c.getTransponder('Pilot').squawkStatus, 2);
});

test('ident latch clears on its own once expired, even with no further SRS message', () => {
  // Regression: getTransponder is polled once per gRPC tick, far more often
  // than SRS pushes radio-state updates (event-driven, only on change). If
  // the ident pulse was the last message SRS ever sent for this client, the
  // flash must still clear after the grace period on read, not stay stuck
  // until the pilot recycles the transponder to force a new message.
  const c = new SrsClient();
  c._applyClient(radioUpdate('Pilot', 1234, 2));
  assert.equal(c.getTransponder('Pilot').squawkStatus, 2);

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6000; // past the 5s latch window
    assert.equal(c.getTransponder('Pilot').squawkStatus, 1);
    // And it stays cleared on a subsequent read.
    assert.equal(c.getTransponder('Pilot').squawkStatus, 1);
  } finally {
    Date.now = realNow;
  }
});

test('a repeated ident message keeps refreshing the latch instead of expiring mid-hold', () => {
  const c = new SrsClient();
  c._applyClient(radioUpdate('Pilot', 1234, 2));

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 4000; // still within the first latch window
    c._applyClient(radioUpdate('Pilot', 1234, 2)); // pilot still holding ident
    assert.equal(c.getTransponder('Pilot').squawkStatus, 2);

    Date.now = () => realNow() + 8000; // 4s past the *refreshed* latch, not the original
    assert.equal(c.getTransponder('Pilot').squawkStatus, 2);

    Date.now = () => realNow() + 9001; // now past the refreshed 5s window
    assert.equal(c.getTransponder('Pilot').squawkStatus, 1);
  } finally {
    Date.now = realNow;
  }
});

test('a normal (non-ident) status update is still latched to 2 within the grace period, but clears once it expires', () => {
  const c = new SrsClient();
  c._applyClient(radioUpdate('Pilot', 1234, 2));
  c._applyClient(radioUpdate('Pilot', 1234, 1)); // real status already back to normal
  assert.equal(c.getTransponder('Pilot').squawkStatus, 2, 'grace period keeps the flash visible briefly');

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6000;
    c._applyClient(radioUpdate('Pilot', 1234, 1));
    assert.equal(c.getTransponder('Pilot').squawkStatus, 1);
  } finally {
    Date.now = realNow;
  }
});

test('getTransponder for an unknown player returns null', () => {
  const c = new SrsClient();
  assert.equal(c.getTransponder('Nobody'), null);
});
