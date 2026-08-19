// server.js — static file server for the Missile Flyout Scope, plus a
// small read/write API for saved aircraft presets.
//
// Usage:
//   npm start                # starts on port 5050
//   PORT=8080 npm start      # custom port
//
// This is otherwise a static site (index.html + public/css + public/js +
// data/) with no build step. It's served through Express rather than
// opened via file:// because the JS is split into native ES modules and
// fetches JSON (the built-in weapon, and now presets) — both of which
// browsers block under file://. The presets API is the one part of this
// app that needs a real server (writing files), so it won't work if this
// folder is served by a bare static host instead of `npm start`.

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 5050;

const PRESETS_DIR = path.join(__dirname, 'data', 'presets');
fs.mkdirSync(PRESETS_DIR, { recursive: true });

// Preset names become filenames, so they're checked against a strict
// allowlist before ever reaching a path -- no '.' or '/' can pass this,
// so a name like "../../etc/passwd" is simply not a valid name, rather
// than being blocked by trying to detect traversal after the fact.
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/;
function presetPath(name) {
  return NAME_RE.test(name) ? path.join(PRESETS_DIR, name + '.json') : null;
}

app.use(express.json({ limit: '256kb' }));
app.use(express.static(__dirname));

app.get('/api/presets', (req, res) => {
  const names = fs.readdirSync(PRESETS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
  res.json(names);
});

app.get('/api/presets/:name', (req, res) => {
  const file = presetPath(req.params.name);
  if (!file) return res.status(400).json({ error: 'invalid preset name' });
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.type('json').send(fs.readFileSync(file, 'utf8'));
});

app.post('/api/presets/:name', (req, res) => {
  const file = presetPath(req.params.name);
  if (!file) return res.status(400).json({ error: 'invalid preset name' });
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'invalid preset data' });
  fs.writeFileSync(file, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.delete('/api/presets/:name', (req, res) => {
  const file = presetPath(req.params.name);
  if (!file) return res.status(400).json({ error: 'invalid preset name' });
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Missile Flyout Scope running at http://localhost:${PORT}`);
});
