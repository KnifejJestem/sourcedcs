import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// resolve.js reads its config path once at module load, so the override env
// var must be set before the first import — this file gets its own isolated
// module registry (node:test runs each file in its own worker), so this
// never touches the real config/squawk-map.json or affects resolve.test.mjs.
const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'squawk-map-test-'));
const tmpFile = path.join(tmpDir, 'squawk-map.json');
fs.writeFileSync(tmpFile, JSON.stringify({ squawkMap: {}, squawkSeq: {} }));
process.env.CRCSYNC_SQUAWK_MAP_PATH = tmpFile;

const { getSquawkConfig, setSquawkMapping, deleteSquawkMapping, resolveCallsign } =
  await import('../src/resolve.js');

test('setSquawkMapping adds an exact mapping and persists it to disk', () => {
  assert.equal(setSquawkMapping('exact', '7001', 'enfield'), true);
  assert.equal(getSquawkConfig().squawkMap['7001'], 'ENFIELD');

  const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  assert.equal(onDisk.squawkMap['7001'], 'ENFIELD');
});

test('an exact mapping actually changes what resolveCallsign returns', () => {
  setSquawkMapping('exact', '7002', 'VIPER');
  const track = { id: '1', coalition: 3, callsign: 'Raw', squawk: 7002 };
  assert.equal(resolveCallsign(track, null, () => 'unused'), 'VIPER');
  deleteSquawkMapping('exact', '7002');
});

test('a seq mapping appends the offset within the block to the base name', () => {
  setSquawkMapping('seq', '5000', 'Ford');
  const first  = { id: '2', coalition: 3, callsign: 'Raw', squawk: 5000 };
  const third  = { id: '3', coalition: 3, callsign: 'Raw', squawk: 5002 };
  assert.equal(resolveCallsign(first, null, () => 'unused'), 'FORD1');
  assert.equal(resolveCallsign(third, null, () => 'unused'), 'FORD3');
  deleteSquawkMapping('seq', '5000');
});

test('deleteSquawkMapping removes the entry and persists the removal', () => {
  setSquawkMapping('exact', '7003', 'GHOST');
  assert.equal(deleteSquawkMapping('exact', '7003'), true);
  assert.equal(getSquawkConfig().squawkMap['7003'], undefined);

  const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  assert.equal(onDisk.squawkMap['7003'], undefined);
});

test('deleteSquawkMapping on a code that was never set returns false', () => {
  assert.equal(deleteSquawkMapping('exact', '9999'), false);
});

test('setSquawkMapping rejects an invalid kind, out-of-range code, or empty name', () => {
  assert.equal(setSquawkMapping('bogus', '1000', 'X'), false);
  assert.equal(setSquawkMapping('exact', '9999', 'X'), false); // > 7777
  assert.equal(setSquawkMapping('exact', '-1', 'X'), false);
  assert.equal(setSquawkMapping('exact', '1000', '   '), false);
});

test('getSquawkConfig returns a copy, not a live reference', () => {
  const cfg = getSquawkConfig();
  cfg.squawkMap['9000'] = 'INJECTED';
  assert.equal(getSquawkConfig().squawkMap['9000'], undefined);
});
