'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const https     = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ─── Data persistence ──────────────────────────────────── */
const DATA_DIR           = path.join(__dirname, 'data');
const EVENTS_FILE        = path.join(DATA_DIR, 'events.json');
const APPS_FILE          = path.join(DATA_DIR, 'applications.json');
const SQUADRONS_FILE     = path.join(DATA_DIR, 'squadrons.json');
const DISCORD_ROLES_FILE = path.join(DATA_DIR, 'discord-roles.json');
const GALLERY_FILE       = path.join(DATA_DIR, 'gallery.json');
const UPLOADS_DIR        = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function sanitizeStr(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen);
}

/* Default gallery (used when gallery.json does not yet exist in the volume) */
const DEFAULT_GALLERY = [
  { src: 'gallery/shot-01.svg', alt: 'Formation Flight — Dawn Patrol over Caucasus', caption: 'FORMATION FLIGHT · CAUCASUS THEATRE · DAWN PATROL' },
  { src: 'gallery/shot-02.svg', alt: 'Night Operations — Overwatch over the Gulf',   caption: 'NIGHT OPERATIONS · PERSIAN GULF · OVERWATCH' },
  { src: 'gallery/shot-03.svg', alt: 'Dusk Intercept — Afterburner Run',              caption: 'DUSK INTERCEPT · COASTAL SWEEP · AFTERBURNER RUN' },
  { src: 'gallery/shot-04.svg', alt: 'CAS Mission — Mountain Valley Run',             caption: 'CAS MISSION · CAUCASUS WINTER · MOUNTAIN VALLEY RUN' },
  { src: 'gallery/shot-05.svg', alt: 'Carrier Approach — Case I Recovery',            caption: 'CARRIER APPROACH · PERSIAN GULF · CASE I RECOVERY' },
  { src: 'gallery/shot-06.svg', alt: 'Precision Strike — GBU-12 Delivery',            caption: 'PRECISION STRIKE · SYRIAN THEATRE · GBU-12 DELIVERY' },
];

let gallery = loadJSON(GALLERY_FILE, DEFAULT_GALLERY);

/* Multer — images land in the data volume (not in the Docker image) */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename:    (_req, file, cb) => {
      /* Use timestamp + random suffix; strip any path components from the extension */
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
    },
  }),
  limits:     { fileSize: 20 * 1024 * 1024 }, /* 20 MB */
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only JPEG, PNG, WebP or GIF files are allowed'), ok);
  },
});

let events = loadJSON(EVENTS_FILE, []);
let applications = loadJSON(APPS_FILE, []);
let nextEventId = events.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;

let squadrons = loadJSON(SQUADRONS_FILE, []);

/* Load discord role → squadron mapping (role names as keys) */
let discordRoles = loadJSON(DISCORD_ROLES_FILE, {});

/* ─── Discord bot config ────────────────────────────────── */
const DISCORD_BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN  || '';
const DISCORD_GUILD_ID   = process.env.DISCORD_GUILD_ID   || '';
const APPLY_CHANNEL_ID   = process.env.APPLY_CHANNEL_ID   || '';

/* Roster in-memory cache (populated from Discord) */
let rosterCache   = null;
let rosterCacheAt = 0;
const ROSTER_CACHE_TTL = 5 * 60 * 1000; /* 5 minutes */

/* ─── Discord REST helpers ──────────────────────────────── */
function discordRequest(apiPath) {
  console.debug('[discord] GET /api/v10' + apiPath);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      path:     '/api/v10' + apiPath,
      method:   'GET',
      headers: {
        'Authorization': 'Bot ' + DISCORD_BOT_TOKEN,
        'User-Agent':    'SourceDCS-Web/1.0 (https://github.com/NikNam3/sourcedcs)',
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        console.debug('[discord] GET /api/v10' + apiPath + ' → HTTP ' + res.statusCode);
        if (res.statusCode === 429) {
          const retry = res.headers['retry-after'];
          console.warn('[discord] Rate limited — retry-after: ' + retry + 's');
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(raw)); }
          catch (e) {
            console.error('[discord] Failed to parse JSON from GET /api/v10' + apiPath + ':', e.message, '| raw:', raw.slice(0, 200));
            reject(new Error('Discord: invalid JSON response'));
          }
        } else {
          const msg = 'Discord API ' + res.statusCode + ': ' + raw.slice(0, 200);
          console.error('[discord] Error on GET /api/v10' + apiPath + ':', msg);
          reject(new Error(msg));
        }
      });
    });
    req.on('error', (err) => {
      console.error('[discord] Network error on GET /api/v10' + apiPath + ':', err.message);
      reject(err);
    });
    req.end();
  });
}

/* POST to a Discord API endpoint (e.g. send a message to a channel) */
function discordPost(apiPath, body) {
  const payload = JSON.stringify(body);
  console.debug('[discord] POST /api/v10' + apiPath);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      path:     '/api/v10' + apiPath,
      method:   'POST',
      headers: {
        'Authorization':  'Bot ' + DISCORD_BOT_TOKEN,
        'User-Agent':     'SourceDCS-Web/1.0 (https://github.com/NikNam3/sourcedcs)',
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        console.debug('[discord] POST /api/v10' + apiPath + ' → HTTP ' + res.statusCode);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(raw)); }
          catch (e) {
            console.error('[discord] Failed to parse JSON from POST /api/v10' + apiPath + ':', e.message, '| raw:', raw.slice(0, 200));
            resolve({});
          }
        } else {
          const msg = 'Discord API ' + res.statusCode + ': ' + raw.slice(0, 400);
          console.error('[discord] Error on POST /api/v10' + apiPath + ':', msg);
          reject(new Error(msg));
        }
      });
    });
    req.on('error', (err) => {
      console.error('[discord] Network error on POST /api/v10' + apiPath + ':', err.message);
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

async function fetchAllGuildMembers(guildId) {
  const members = [];
  let after = '0';
  let page  = 0;
  console.debug('[roster] Fetching guild members for guild', guildId);
  for (;;) {
    page++;
    const batch = await discordRequest(
      '/guilds/' + guildId + '/members?limit=1000&after=' + after
    );
    console.debug('[roster] Page ' + page + ': received ' + batch.length + ' members (after=' + after + ')');
    members.push(...batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }
  console.debug('[roster] Total members fetched:', members.length);
  return members;
}

/**
 * Parse a Discord nickname in the format:  (foo) bar "CALLSIGN"
 * Returns the callsign from the quotes, or falls back to the bare display
 * name (the word after the parenthetical), or the whole nick as a last
 * resort.
 */
/* Matches: (prefix) displayName "CALLSIGN" — captures CALLSIGN */
const RE_FULL_FORMAT = /^\([^)]*\)\s+[^"]+?\s+"([^"]*)"/;
/* Matches: (prefix) displayName (optionally followed by "CALLSIGN") — captures displayName */
const RE_BARE_FORMAT = /^\([^)]*\)\s+([^"]+?)(?:\s+"[^"]*")?$/;

function parseCallsign(nick) {
  if (!nick) return '';
  /* Full format: (prefix) displayName "CALLSIGN" */
  const full = nick.match(RE_FULL_FORMAT);
  if (full) {
    const cs = full[1].trim();
    if (cs) return cs;
  }
  /* Callsign missing or empty — use the bare display name after (prefix) */
  const bare = nick.match(RE_BARE_FORMAT);
  if (bare) return bare[1];
  /* No parenthetical at all — use the whole nick */
  return nick.trim();
}

async function buildRosterFromDiscord() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
    console.warn('[roster] DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set — roster will be empty');
    return [];
  }

  console.debug('[roster] Starting roster build from Discord (guild=' + DISCORD_GUILD_ID + ')');

  /* Resolve role IDs → names */
  const guildRoles = await discordRequest('/guilds/' + DISCORD_GUILD_ID + '/roles');
  const roleIdToName = {};
  for (const r of guildRoles) roleIdToName[r.id] = r.name;
  console.debug('[roster] Guild has ' + guildRoles.length + ' roles; configured mapping covers ' + Object.keys(discordRoles).length + ' role name(s)');

  const members = await fetchAllGuildMembers(DISCORD_GUILD_ID);

  let matchedCount = 0;
  let skippedCount = 0;
  const roster = [];
  for (const member of members) {
    if (!member.user || member.user.bot) continue;

    /* Scan all of the member's Discord roles.
       One role may supply the squadron, another may supply the role label —
       or a single role may supply both (backward compatible). */
    let squadron  = '';
    let roleLabel = '';
    let anyMatch  = false;
    for (const roleId of (member.roles || [])) {
      const roleName = roleIdToName[roleId];
      const mapping  = roleName ? discordRoles[roleName] : null;
      if (!mapping) continue;
      anyMatch = true;
      if (!squadron  && mapping.squadron) squadron  = mapping.squadron;
      if (!roleLabel && mapping.role)     roleLabel = mapping.role;
      if (squadron && roleLabel) break; /* both resolved — no need to continue */
    }
    if (!anyMatch) { skippedCount++; continue; }
    matchedCount++;

    const nick     = member.nick || member.user.global_name || member.user.username || '';
    const callsign = parseCallsign(nick);

    roster.push({
      id:       member.user.id,
      callsign,
      role:     roleLabel,
      squadron,
    });
  }

  console.debug('[roster] Build complete — matched: ' + matchedCount + ', skipped (no role): ' + skippedCount + ', roster size: ' + roster.length);
  return roster;
}

/* Send a new application as a Discord embed to the configured channel */
async function sendApplicationToDiscord(application) {
  if (!DISCORD_BOT_TOKEN) {
    console.warn('[apply] DISCORD_BOT_TOKEN not set — cannot post application to Discord');
    return;
  }
  if (!APPLY_CHANNEL_ID) {
    console.warn('[apply] APPLY_CHANNEL_ID not set — cannot post application to Discord');
    return;
  }
  const embed = {
    title:  '📋 New Application',
    color:  0x00b0f4,
    fields: [
      { name: 'Callsign',       value: application.callsign      || '—', inline: true },
      { name: 'Discord',        value: application.discordHandle || '—', inline: true },
      { name: 'Age Group',      value: String(application.age)   || '—', inline: true },
      { name: 'Timezone',       value: application.timezone      || '—', inline: true },
      { name: 'Preferred Wing', value: application.subSquadron   || '—', inline: true },
      { name: 'Experience',     value: application.experience    || 'N/A', inline: false },
      { name: 'Modules',        value: application.modules       || 'N/A', inline: false },
    ],
    timestamp: application.submittedAt,
    footer:    { text: 'Application ID: ' + application.id },
  };
  await discordPost('/channels/' + APPLY_CHANNEL_ID + '/messages', { embeds: [embed] });
  console.debug('[apply] Application ' + application.id + ' posted to Discord channel ' + APPLY_CHANNEL_ID);
}

/* ─── Rate limiting ─────────────────────────────────────── */
const limiter = rateLimit({
  windowMs:        60 * 1000,
  max:             300,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
});
app.use(limiter);

const writeOpsLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             40,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
});

const applyLimiter = rateLimit({
  windowMs:        10 * 60 * 1000, // 10 min window
  max:             3,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many applications — please wait before trying again.' }
});

const authLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             20,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many auth requests — please wait before trying again.' }
});

/* ─── Body parsing ──────────────────────────────────────── */
app.use(express.json({ limit: '50kb' }));

/* ─── Casdoor config (read from env) ────────────────────── */
const CASDOOR_CLIENT_ID     = process.env.CASDOOR_CLIENT_ID;
const CASDOOR_CLIENT_SECRET = process.env.CASDOOR_CLIENT_SECRET;
const CASDOOR_ENDPOINT      = process.env.CASDOOR_ENDPOINT;

/* ─── External link config (read from env) ──────────────── */
const DISCORD_URL = process.env.DISCORD_URL  || 'https://discord.gg/sourcedcs';
const WIKI_URL    = process.env.WIKI_URL     || 'https://wiki.sourcedcs.page';
const ATO_URL     = process.env.ATO_URL      || 'https://ato.sourcedcs.page';
const OLYMPUS_URL = process.env.OLYMPUS_URL  || 'https://olympus.sourcedcs.page';
const ASACS_URL   = process.env.ASACS_URL    || 'https://asacs.sourcedcs.page';
const GITHUB_URL  = process.env.GITHUB_URL   || 'https://github.com/NikNam3/sourcedcs';

/* ─── Casdoor token exchange helper ────────────────────── */
/* Exchanges an authorization code for an access token by calling Casdoor's
   token endpoint server-side. The client_secret never leaves the server. */
function casdoorTokenExchange(code, redirectUri) {
  return new Promise((resolve, reject) => {
    if (!CASDOOR_ENDPOINT || !CASDOOR_CLIENT_ID || !CASDOOR_CLIENT_SECRET) {
      return reject(new Error('Casdoor is not configured (missing env vars)'));
    }
    const payload = JSON.stringify({
      grant_type:    'authorization_code',
      client_id:     CASDOOR_CLIENT_ID,
      client_secret: CASDOOR_CLIENT_SECRET,
      code,
      redirect_uri:  redirectUri,
    });
    let parsed;
    try { parsed = new URL(CASDOOR_ENDPOINT); } catch {
      return reject(new Error('CASDOOR_ENDPOINT is not a valid URL'));
    }
    const isHttps = parsed.protocol === 'https:';
    const mod     = isHttps ? require('https') : require('http');
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     '/api/login/oauth/access_token',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = mod.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Casdoor returned invalid JSON (HTTP ' + res.statusCode + '): ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/* ─── Auth helpers ──────────────────────────────────────── */
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const payload = decodeJWT(token);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  req.user = payload;
  next();
}

function requireAdmin(req, res, next) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isAdmin = roles.some(r =>
    (typeof r === 'string' ? r : (r?.name || '')) === 'admin'
  );
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

/* ─── Dynamic config for client ─────────────────────────── */
/* Serves Casdoor connection settings as a JS file so the client reads
   them from environment variables rather than hardcoded values. */
app.get('/js/config.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(
    'var CASDOOR_CLIENT_ID = ' + JSON.stringify(CASDOOR_CLIENT_ID) + ';\n' +
    'var CASDOOR_ENDPOINT  = ' + JSON.stringify(CASDOOR_ENDPOINT)  + ';\n' +
    'var DISCORD_URL = '       + JSON.stringify(DISCORD_URL)        + ';\n' +
    'var WIKI_URL    = '       + JSON.stringify(WIKI_URL)           + ';\n' +
    'var ATO_URL     = '       + JSON.stringify(ATO_URL)            + ';\n' +
    'var OLYMPUS_URL = '       + JSON.stringify(OLYMPUS_URL)        + ';\n' +
    'var ASACS_URL   = '       + JSON.stringify(ASACS_URL)          + ';\n' +
    'var GITHUB_URL  = '       + JSON.stringify(GITHUB_URL)         + ';\n'
  );
});

/* ─── Static files ──────────────────────────────────────── */
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, {
  index:    'index.html',
  maxAge:   '1h',
  etag:     true,
  dotfiles: 'ignore',
}));

/* Serve admin-uploaded gallery images from the data volume */
app.use('/gallery-uploads', express.static(UPLOADS_DIR, {
  maxAge:   '7d',
  etag:     true,
  dotfiles: 'ignore',
}));

/* ─── API router ────────────────────────────────────────── */
const api = express.Router();

/* Health check */
api.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

/* ── Auth: exchange authorization code for access token ── */
const MAX_AUTH_CODE_LEN    = 512;
const MAX_REDIRECT_URI_LEN = 512;
api.post('/auth/token', authLimiter, async (req, res) => {
  const { code, redirectUri } = req.body;
  if (!code || typeof code !== 'string' || code.length > MAX_AUTH_CODE_LEN) {
    return res.status(400).json({ error: 'Missing or invalid code' });
  }
  if (!redirectUri || typeof redirectUri !== 'string' || redirectUri.length > MAX_REDIRECT_URI_LEN) {
    return res.status(400).json({ error: 'Missing or invalid redirectUri' });
  }
  try {
    const tokenData = await casdoorTokenExchange(code, redirectUri);
    if (tokenData.error) {
      console.warn('[auth] Casdoor token exchange error:', tokenData.error, tokenData.error_description);
      return res.status(400).json({ error: tokenData.error_description || tokenData.error });
    }
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      console.warn('[auth] Casdoor response missing access_token:', JSON.stringify(tokenData).slice(0, 200));
      return res.status(502).json({ error: 'No access token returned by auth server' });
    }
    res.json({ access_token: accessToken });
  } catch (err) {
    console.error('[auth] Token exchange failed:', err.message);
    res.status(502).json({ error: 'Auth server unreachable or returned an error' });
  }
});

/* ── Events (public read, admin write) ── */
api.get('/events', (_req, res) => {
  res.json(events);
});

api.post('/events', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const { name, type, status, date, map, airframes, description, slots } = req.body;
  if (!name || !type || !date) {
    return res.status(400).json({ error: 'name, type and date are required' });
  }
  const ev = {
    id:          nextEventId++,
    name:        String(name).trim(),
    type,
    status:      status || 'planned',
    date,
    map:         map || '',
    airframes:   Array.isArray(airframes) ? airframes : [String(airframes || 'Any')],
    description: String(description || '').trim(),
    slots:       Number(slots) || 0,
    filledSlots: 0,
  };
  events.push(ev);
  saveJSON(EVENTS_FILE, events);
  res.status(201).json(ev);
});

api.put('/events/:id', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Event not found' });
  events[idx] = { ...events[idx], ...req.body, id };
  saveJSON(EVENTS_FILE, events);
  res.json(events[idx]);
});

api.delete('/events/:id', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Event not found' });
  events.splice(idx, 1);
  saveJSON(EVENTS_FILE, events);
  res.json({ ok: true });
});

/* ── Applications ── */
api.post('/apply', applyLimiter, (req, res) => {
  const { callsign, discordHandle, age, timezone, subSquadron, experience, modules } = req.body;
  if (!callsign || !discordHandle || !age || !timezone || !subSquadron) {
    return res.status(400).json({ error: 'Required fields are missing' });
  }
  if (typeof callsign !== 'string' || callsign.length > 32 || callsign.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid callsign' });
  }
  if (typeof discordHandle !== 'string' || discordHandle.length > 64) {
    return res.status(400).json({ error: 'Invalid Discord handle' });
  }

  const application = {
    id:            Date.now(),
    callsign:      callsign.trim(),
    discordHandle: discordHandle.trim(),
    age,
    timezone:      String(timezone).trim(),
    subSquadron,
    experience:    experience || '',
    modules:       typeof modules === 'string' ? modules.slice(0, 500) : '',
    submittedAt:   new Date().toISOString(),
    status:        'pending',
  };

  /* Send application to the configured Discord channel.
     Falls back to JSON storage if APPLY_CHANNEL_ID is not set or if posting fails. */
  if (APPLY_CHANNEL_ID) {
    sendApplicationToDiscord(application).catch(err => {
      console.error('[apply] Failed to post application to Discord:', err.message, '— falling back to JSON storage');
      applications.push(application);
      saveJSON(APPS_FILE, applications);
    });
  } else {
    applications.push(application);
    saveJSON(APPS_FILE, applications);
  }

  res.status(201).json({
    ok:      true,
    message: 'Application received! Join our Discord to get started:',
    discord: DISCORD_URL
  });
});

/* Admin: list applications */
api.get('/applications', requireAuth, requireAdmin, (_req, res) => {
  res.json(applications);
});

/* ── Roster (live from Discord) ── */
api.get('/roster', async (_req, res) => {
  const now = Date.now();
  if (!rosterCache || (now - rosterCacheAt) > ROSTER_CACHE_TTL) {
    console.debug('[roster] Cache miss — fetching from Discord');
    try {
      rosterCache   = await buildRosterFromDiscord();
      rosterCacheAt = now;
      console.debug('[roster] Cache updated, ' + rosterCache.length + ' entries');
    } catch (err) {
      console.error('[roster] Discord fetch failed:', err.message);
      console.error('[roster] Stack:', err.stack);
      if (!rosterCache) rosterCache = [];
    }
  } else {
    console.debug('[roster] Serving from cache (' + rosterCache.length + ' entries, age ' + Math.round((now - rosterCacheAt) / 1000) + 's)');
  }
  res.json(rosterCache);
});

/* Admin: force-refresh the roster cache */
api.post('/roster/refresh', writeOpsLimiter, requireAuth, requireAdmin, (_req, res) => {
  rosterCache   = null;
  rosterCacheAt = 0;
  res.json({ ok: true, message: 'Roster cache cleared — next GET will re-fetch from Discord.' });
});

/* ── Discord roles mapping (admin read/write) ── */
api.get('/discord-roles', requireAuth, requireAdmin, (_req, res) => {
  res.json(discordRoles);
});

const MAX_ROLE_NAME_LEN   = 100;
const MAX_SQUADRON_ID_LEN = 16;
const MAX_ROLE_LABEL_LEN  = 100;

api.put('/discord-roles', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const body = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }
  /* Validate and sanitize entries; strip the _comment key */
  const sanitized = {};
  for (const [roleName, mapping] of Object.entries(body)) {
    if (roleName === '_comment') continue;
    if (roleName.trim().length === 0) {
      return res.status(400).json({ error: 'Role name must not be empty or whitespace' });
    }
    if (typeof mapping !== 'object' || mapping === null) {
      return res.status(400).json({ error: 'Each mapping value must be an object with "squadron" and/or "role" fields' });
    }
    const hasSq   = mapping.squadron && String(mapping.squadron).trim().length > 0;
    const hasRole = mapping.role     && String(mapping.role).trim().length     > 0;
    if (!hasSq && !hasRole) {
      return res.status(400).json({ error: 'Each mapping must have at least one of "squadron" or "role" fields' });
    }
    const entry = {};
    if (hasSq)   entry.squadron = sanitizeStr(mapping.squadron, MAX_SQUADRON_ID_LEN);
    if (hasRole) entry.role     = sanitizeStr(mapping.role,     MAX_ROLE_LABEL_LEN);
    sanitized[sanitizeStr(roleName, MAX_ROLE_NAME_LEN)] = entry;
  }
  discordRoles = sanitized;
  saveJSON(DISCORD_ROLES_FILE, discordRoles);
  /* Bust the roster cache so the new mapping takes effect immediately */
  rosterCache   = null;
  rosterCacheAt = 0;
  res.json(discordRoles);
});

/* ── Gallery (public read, admin write + image upload) ── */
const MAX_GALLERY_SRC_LEN  = 512;
const MAX_GALLERY_TEXT_LEN = 200;
const MAX_GALLERY_ITEMS    = 100;

api.get('/gallery', (_req, res) => res.json(gallery));

api.put('/gallery', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' });
  if (req.body.length > MAX_GALLERY_ITEMS) return res.status(400).json({ error: 'Too many gallery items' });
  gallery = req.body.map(s => ({
    src:     sanitizeStr(s.src,     MAX_GALLERY_SRC_LEN),
    alt:     sanitizeStr(s.alt,     MAX_GALLERY_TEXT_LEN),
    caption: sanitizeStr(s.caption, MAX_GALLERY_TEXT_LEN),
  }));
  saveJSON(GALLERY_FILE, gallery);
  res.json(gallery);
});

api.post('/gallery/upload', writeOpsLimiter, requireAuth, requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });
  res.json({ src: '/gallery-uploads/' + req.file.filename });
});

api.delete('/gallery/:idx', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const idx = parseInt(req.params.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= gallery.length) {
    return res.status(400).json({ error: 'Invalid index' });
  }
  const [removed] = gallery.splice(idx, 1);
  saveJSON(GALLERY_FILE, gallery);
  /* Clean up uploaded file from the volume (ignore public static assets) */
  if (removed.src && removed.src.startsWith('/gallery-uploads/')) {
    const filename = path.basename(removed.src);
    /* Guard against path traversal */
    if (filename && !filename.includes('/') && !filename.includes('..')) {
      const filepath = path.join(UPLOADS_DIR, filename);
      try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch { /* ignore */ }
    }
  }
  res.json({ ok: true });
});

/* ── Squadrons (public read, admin write) ── */
api.get('/squadrons', (_req, res) => {
  res.json(squadrons);
});

api.get('/squadrons/:id', (req, res) => {
  const sq = squadrons.find(s => s.id === req.params.id);
  if (!sq) return res.status(404).json({ error: 'Squadron not found' });
  res.json(sq);
});

api.put('/squadrons/:id', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const idx = squadrons.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Squadron not found' });
  const allowed = ['designator', 'name', 'airframe', 'tags', 'shortDesc', 'fullDesc', 'image'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) squadrons[idx][key] = req.body[key];
  }
  saveJSON(SQUADRONS_FILE, squadrons);
  res.json(squadrons[idx]);
});

api.post('/squadrons', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const { id, designator, name, airframe, tags, shortDesc, fullDesc, image } = req.body;
  if (!id || !designator || !name) return res.status(400).json({ error: 'id, designator and name are required' });
  if (squadrons.find(s => s.id === id)) return res.status(409).json({ error: 'Squadron ID already exists' });
  const sq = {
    id:         sanitizeStr(id, 16),
    designator: sanitizeStr(designator, 16),
    name:       sanitizeStr(name, 32),
    airframe:   sanitizeStr(airframe, 64),
    tags:       Array.isArray(tags) ? tags.map(t => sanitizeStr(t, 16)) : [],
    shortDesc:  sanitizeStr(shortDesc, 500),
    fullDesc:   sanitizeStr(fullDesc, 2000),
    image:      sanitizeStr(image, 256),
  };
  squadrons.push(sq);
  saveJSON(SQUADRONS_FILE, squadrons);
  res.status(201).json(sq);
});

api.delete('/squadrons/:id', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const idx = squadrons.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Squadron not found' });
  squadrons.splice(idx, 1);
  saveJSON(SQUADRONS_FILE, squadrons);
  res.json({ ok: true });
});

app.use('/api', api);

/* ─── SPA fallback ──────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

/* ─── Start ─────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`[sourcedcs-web] listening on http://0.0.0.0:${PORT}`);
  console.log('[sourcedcs-web] Config:');
  console.log('  DISCORD_BOT_TOKEN  :', DISCORD_BOT_TOKEN  ? '*** (set)' : 'NOT SET');
  console.log('  DISCORD_GUILD_ID   :', DISCORD_GUILD_ID   || 'NOT SET');
  console.log('  APPLY_CHANNEL_ID   :', APPLY_CHANNEL_ID   || 'NOT SET (applications will be stored in JSON)');
});
