<?php
// Scraper-hardening performance settings (2026-08-29 incident remediation).
// No secrets here — this file is safe to commit, unlike LocalSettings.php
// itself (gitignored: infra/mediawiki/LocalSettings.php).
//
// This file is NOT auto-loaded by MediaWiki. It must be required from the
// end of the host's LocalSettings.php:
//
//   require_once '/var/www/html/LocalSettings.perf.php';
//
// See infra/RUNBOOK.md for why (load-order: MediaWiki assigns config
// defaults, then requires LocalSettings.php — anything set before that
// point, e.g. via php.ini auto_prepend_file, gets clobbered back to
// defaults by that assignment pass).

// Disables MediaWiki's expensive dynamic special pages (e.g. unpatrolled
// changes counts, some Special:RecentChanges variants) that do full table
// scans on every hit. Single highest-value MediaWiki-side setting for a
// scraper-driven DB-load incident.
$wgMiserMode = true;

// APCu ships enabled in the mediawiki:1.43 base image (verified: `php -m`
// lists apcu, default apc.shm_size=32M) — CACHE_ACCEL is safe to use as-is
// without any Dockerfile/php.ini change.
$wgMainCacheType   = CACHE_ACCEL;
$wgParserCacheType = CACHE_ACCEL;
