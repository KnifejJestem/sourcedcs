'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ─── Rate limiting ─────────────────────────────────────────
   Applied globally — protects all routes including the SPA
   fallback that reads from the file system.
─────────────────────────────────────────────────────────── */
const limiter = rateLimit({
  windowMs:          60 * 1000, // 1 minute
  max:               300,       // requests per window per IP
  standardHeaders:   'draft-7',
  legacyHeaders:     false,
});
app.use(limiter);

/* ─── Static files ──────────────────────────────────────────
   Serve everything in public/ (HTML, CSS, images).
   express.static sends correct MIME types and handles ETags /
   Last-Modified for browser caching automatically.
─────────────────────────────────────────────────────────── */
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, {
  index:    'index.html',
  maxAge:   '1h',
  etag:     true,
  dotfiles: 'ignore',
}));

/* ─── API routes ────────────────────────────────────────────
   Placeholder namespace — add real endpoints here as the
   squadron site grows (e.g. roster JSON, schedule CRUD, etc.)
─────────────────────────────────────────────────────────── */
const api = express.Router();

// Health-check used by Docker and uptime monitors
api.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.use('/api', api);

/* ─── SPA fallback ──────────────────────────────────────────
   Any unmatched GET returns index.html so client-side routing
   (if added later) works without 404s from nginx.
─────────────────────────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

/* ─── Start ─────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`[sourcedcs-website] listening on http://0.0.0.0:${PORT}`);
});
