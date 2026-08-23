'use strict';

// crc-desktop release manifest parsing + upload auth, pulled out of
// server.js so it can be unit tested as pure functions without requiring
// server.js (which has side effects on load -- reading env-derived config,
// creating data directories, etc).

const crypto = require('crypto');

/* Minimal reader for electron-builder's latest.yml/latest-linux.yml — both
   are a small, flat, known schema (version/path/sha512/size/releaseDate at
   the top level, plus a `files` array with the same per-file fields), so a
   couple of regexes cover it without pulling in a YAML dependency this repo
   doesn't otherwise need. Takes the raw file content directly (not a path)
   so it's trivial to unit test. */
function parseReleaseManifest(raw) {
  if (raw == null) return null;
  // `size` only appears nested under the `files:` list entries, not at the
  // top level, so this intentionally doesn't anchor to line-start like
  // version/path do.
  // `.+` (not `\S+`) for path — electron-builder's Windows installer
  // filenames contain spaces (e.g. "CRC Setup 1.0.7.exe"), which a
  // whitespace-delimited match would truncate at the first space. This
  // exact bug shipped once already: /api/releases/latest returned
  // "/downloads/CRC" instead of the real installer.
  const version = (raw.match(/^version:\s*(\S+)/m) || [])[1];
  const file     = (raw.match(/^path:\s*(.+?)\r?$/m) || [])[1];
  const size     = (raw.match(/\bsize:\s*(\d+)/) || [])[1];
  if (!version || !file) return null;
  return { version, url: '/downloads/' + encodeURIComponent(file), size: size ? parseInt(size, 10) : null };
}

/* Constant-time bearer-token check for POST /api/releases/upload (crc-desktop
   release CI has no interactive Casdoor session, so this is a separate
   shared-secret check rather than requireAuth/requireAdmin). Returns false
   (never throws) for an empty/unset expectedToken, an empty provided token,
   or a length mismatch -- crypto.timingSafeEqual throws on unequal-length
   buffers, which a naive direct call would need to guard anyway. */
function checkReleaseUploadToken(providedToken, expectedToken) {
  if (!expectedToken) return false;
  const expected = Buffer.from(expectedToken);
  const actual   = Buffer.from(providedToken || '');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = { parseReleaseManifest, checkReleaseUploadToken };
