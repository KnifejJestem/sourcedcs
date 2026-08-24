#!/usr/bin/env bash
# Approximates crc-desktop-release.yml locally, then actually launches the
# packaged AppImage — the one step neither `npm test` nor a bare
# `electron-builder` run exercises, and the exact class of gap that let
# v1.1.2 (lxsrs-setup.js missing from build.files) ship broken. Runs in an
# isolated git worktree so it never touches this checkout's real
# app/node_modules or ~/.config/crc-desktop/lxsrs-venv — those are real dev
# state, not something a "does a clean checkout work" check should disturb.
#
# Linux-only: verifies the AppImage leg. The Windows/NSIS leg is not checked
# here — CI remains the source of truth for that.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRC_DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ALIVE_CHECK_SECS=8

WORKDIR=""
APP_PID=""

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    git -C "$CRC_DESKTOP_DIR" worktree remove --force "$WORKDIR" 2>/dev/null || rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

echo "== release-check: crc-desktop =="

if [ -n "$(git -C "$CRC_DESKTOP_DIR" status --porcelain)" ]; then
  echo "WARNING: working tree has uncommitted changes — this check runs against HEAD, so they won't be included." >&2
fi

WORKDIR="$(mktemp -d)"
echo "-- checking out a clean HEAD into $WORKDIR"
git -C "$CRC_DESKTOP_DIR" worktree add --detach "$WORKDIR" HEAD >/dev/null

cd "$WORKDIR/crc-desktop"

echo "-- npm ci (root)"
npm ci

echo "-- npm ci (app/)"
(cd app && npm ci)

echo "-- npm test"
npm test

echo "-- electron-builder (linux AppImage)"
npm run pack:linux

APPIMAGE="$(ls dist/*.AppImage 2>/dev/null | head -n1 || true)"
if [ -z "$APPIMAGE" ]; then
  echo "FAIL: no AppImage produced in dist/" >&2
  exit 1
fi
chmod +x "$APPIMAGE"

LOGFILE="$WORKDIR/launch.log"

launch_appimage() {
  "$APPIMAGE" "$@" > "$LOGFILE" 2>&1 &
  APP_PID=$!
  sleep "$ALIVE_CHECK_SECS"
}

echo "-- launching $(basename "$APPIMAGE")"
launch_appimage

if ! kill -0 "$APP_PID" 2>/dev/null && grep -qi "sandbox" "$LOGFILE"; then
  echo "-- sandbox-related launch failure (common without a setuid chrome-sandbox helper on dev machines) — retrying with --no-sandbox for this local check only"
  launch_appimage --no-sandbox
fi

ALIVE=0
if kill -0 "$APP_PID" 2>/dev/null; then ALIVE=1; fi

# Narrow and specific on purpose: normal app output legitimately contains the
# substring "Error:" (e.g. a caught-and-logged "OSError:", or electron-updater's
# routine differential-download-fallback message) — matching on that alone
# flags healthy runs. These patterns are the actual signature of the app being
# non-functional (the v1.1.2 bug logged exactly "Cannot find module ...").
FATAL=0
if grep -Eq "Cannot find module|MODULE_NOT_FOUND|Uncaught Exception|Unhandled promise rejection" "$LOGFILE"; then FATAL=1; fi

if command -v wmctrl >/dev/null 2>&1; then
  sleep 1
  if wmctrl -l | grep -qi "CRC"; then
    echo "-- window detected (soft signal, wmctrl)"
  else
    echo "-- no matching window detected yet (soft signal only, wmctrl) — not a failure by itself"
  fi
fi

kill "$APP_PID" 2>/dev/null || true
wait "$APP_PID" 2>/dev/null || true
APP_PID=""

echo
echo "-- launch log ($LOGFILE):"
cat "$LOGFILE" || true
echo

echo "NOTE: this script does not verify the Windows/NSIS leg — CI remains the source of truth for that."

if [ "$ALIVE" -eq 1 ] && [ "$FATAL" -eq 0 ]; then
  echo "PASS: packaged AppImage launched and stayed alive with no fatal errors in the log."
  exit 0
else
  echo "FAIL: packaged AppImage crashed on launch or logged a fatal error (alive=$ALIVE fatal=$FATAL)." >&2
  exit 1
fi
