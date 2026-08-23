'use strict';

/* Tests the real logic in releases.js (not a hand-copied duplicate --
   server.js's readReleaseManifest/requireReleaseUpload are thin wrappers
   around these same two functions). parseReleaseManifest's `.+` path regex
   is a regression test for a bug that actually shipped: /api/releases/latest
   returned "/downloads/CRC" instead of the real Windows installer filename
   ("CRC Setup 1.0.7.exe"), because the original `\S+` regex truncated at
   the first space. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReleaseManifest, checkReleaseUploadToken } = require('../releases.js');

/* ══════════════════════════════════════════════════════════
   parseReleaseManifest
══════════════════════════════════════════════════════════ */

test('parseReleaseManifest: Linux AppImage manifest (no spaces in filename)', () => {
  const raw = `version: 1.0.7
files:
  - url: CRC-1.0.7.AppImage
    sha512: abc
    size: 186609463
    blockMapSize: 196427
path: CRC-1.0.7.AppImage
sha512: abc
releaseDate: '2026-08-23T14:49:28.749Z'
`;
  assert.deepEqual(parseReleaseManifest(raw), {
    version: '1.0.7',
    url: '/downloads/CRC-1.0.7.AppImage',
    size: 186609463,
  });
});

test('parseReleaseManifest: Windows installer filename with spaces is not truncated', () => {
  // Regression: this exact manifest shape shipped with a broken url
  // ("/downloads/CRC") before the path regex was fixed from \S+ to .+?.
  const raw = `version: 1.0.7
files:
  - url: CRC Setup 1.0.7.exe
    sha512: abc
    size: 103948417
path: CRC Setup 1.0.7.exe
sha512: abc
releaseDate: '2026-08-23T14:50:29.091Z'
`;
  const result = parseReleaseManifest(raw);
  assert.equal(result.url, '/downloads/' + encodeURIComponent('CRC Setup 1.0.7.exe'));
  assert.equal(result.url, '/downloads/CRC%20Setup%201.0.7.exe');
});

test('parseReleaseManifest: size comes from the nested files[] entry, not a top-level field', () => {
  // electron-builder's manifest never puts `size` at the top level (only
  // `path`/`sha512` are duplicated there) -- size only exists nested under
  // `files:`, so the size regex intentionally isn't anchored to line-start.
  const raw = `version: 2.0.0
files:
  - url: App.AppImage
    sha512: xyz
    size: 42
path: App.AppImage
sha512: xyz
releaseDate: '2026-01-01T00:00:00.000Z'
`;
  assert.equal(parseReleaseManifest(raw).size, 42);
});

test('parseReleaseManifest: returns null for missing version', () => {
  const raw = `path: App.AppImage\nsha512: xyz\n`;
  assert.equal(parseReleaseManifest(raw), null);
});

test('parseReleaseManifest: returns null for missing path', () => {
  const raw = `version: 1.0.0\nsha512: xyz\n`;
  assert.equal(parseReleaseManifest(raw), null);
});

test('parseReleaseManifest: returns null for null/empty input (e.g. file not found)', () => {
  assert.equal(parseReleaseManifest(null), null);
  assert.equal(parseReleaseManifest(undefined), null);
});

test('parseReleaseManifest: size is null when absent (still returns version/url)', () => {
  const raw = `version: 1.0.0\npath: App.AppImage\nsha512: xyz\n`;
  assert.deepEqual(parseReleaseManifest(raw), { version: '1.0.0', url: '/downloads/App.AppImage', size: null });
});

/* ══════════════════════════════════════════════════════════
   checkReleaseUploadToken
══════════════════════════════════════════════════════════ */

test('checkReleaseUploadToken: correct token matches', () => {
  assert.equal(checkReleaseUploadToken('secret123', 'secret123'), true);
});

test('checkReleaseUploadToken: wrong token does not match', () => {
  assert.equal(checkReleaseUploadToken('wrong', 'secret123'), false);
});

test('checkReleaseUploadToken: no expected token configured -> always false, never throws', () => {
  // RELEASE_UPLOAD_TOKEN defaults to '' when unset -- must fail closed,
  // not accidentally accept an empty-string "token".
  assert.equal(checkReleaseUploadToken('', ''), false);
  assert.equal(checkReleaseUploadToken('anything', ''), false);
});

test('checkReleaseUploadToken: missing/empty provided token does not match a real one', () => {
  assert.equal(checkReleaseUploadToken('', 'secret123'), false);
  assert.equal(checkReleaseUploadToken(undefined, 'secret123'), false);
});

test('checkReleaseUploadToken: length mismatch does not throw (crypto.timingSafeEqual would)', () => {
  assert.doesNotThrow(() => checkReleaseUploadToken('short', 'a-much-longer-secret-token'));
  assert.equal(checkReleaseUploadToken('short', 'a-much-longer-secret-token'), false);
});
