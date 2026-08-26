'use strict';

/* "What's new" system for the auto-updater.
 *
 * electron-builder auto-picks up build-assets/release-notes.md at build
 * time (package.json's build.directories.buildResources points there --
 * the default "build/" is repo-wide gitignored, see that config's comment)
 * and embeds its content into latest.yml/latest-linux.yml as UpdateInfo's
 * releaseNotes field (see app-builder-lib's getResource() convention).
 *
 * electron-updater's 'update-downloaded' event fires in the *old* process,
 * before restart -- there's no window left to show a "what's new" dialog
 * in once the new version is actually running. So we persist the notes to
 * a small file in userData at download time, then read+clear it on the
 * next launch once app.getVersion() confirms we're actually on that
 * version (kept Electron-free like lxsrs-setup.js, for unit testing
 * without a real Electron process).
 */

const fs = require('fs');

function normalizeReleaseNotes(releaseNotes) {
  if (releaseNotes == null) return null;
  if (typeof releaseNotes === 'string') {
    const trimmed = releaseNotes.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(releaseNotes)) {
    // electron-updater's ReleaseNoteInfo[] shape (one entry per version
    // skipped since the last install) -- join into one block.
    const joined = releaseNotes
      .map(entry => (entry && typeof entry.note === 'string' ? entry.note.trim() : ''))
      .filter(Boolean)
      .join('\n\n');
    return joined.length > 0 ? joined : null;
  }
  return null;
}

function writePendingPatchNotes(filePath, { version, notes }) {
  const normalized = normalizeReleaseNotes(notes);
  if (!version || !normalized) return;
  fs.writeFileSync(filePath, JSON.stringify({ version, notes: normalized }));
}

function readAndClearPendingPatchNotes(filePath, currentVersion) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  // Clear unconditionally: whether we're about to show these notes (version
  // matches) or they're stale (a second update landed, or the user
  // downgraded, before the app was ever relaunched), a leftover file must
  // never resurface on some unrelated future launch.
  try { fs.unlinkSync(filePath); } catch {}

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || parsed.version !== currentVersion || typeof parsed.notes !== 'string') return null;
  return parsed;
}

// Separate from the one-shot "pending" file above: this copy is never
// cleared, so a "what's new" button in the UI can re-show the last update's
// notes at any time instead of the controller having to catch the one-time
// dialog on the exact launch after an autoupdate lands.
function readLastPatchNotes(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed.version !== 'string' || typeof parsed.notes !== 'string') return null;
  return parsed;
}

module.exports = {
  normalizeReleaseNotes, writePendingPatchNotes, readAndClearPendingPatchNotes,
  readLastPatchNotes,
};
