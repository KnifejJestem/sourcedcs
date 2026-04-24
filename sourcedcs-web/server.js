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
const DATA_DIR              = path.join(__dirname, 'data');
const EVENTS_FILE           = path.join(DATA_DIR, 'events.json');
const APPS_FILE             = path.join(DATA_DIR, 'applications.json');
const SQUADRONS_FILE        = path.join(DATA_DIR, 'squadrons.json');
const DISCORD_ROLES_FILE    = path.join(DATA_DIR, 'discord-roles.json');
const GALLERY_FILE          = path.join(DATA_DIR, 'gallery.json');
const HERO_FILE             = path.join(DATA_DIR, 'hero-image.json');
const SKILL_TREE_FILE       = path.join(DATA_DIR, 'skill-tree.json');
const SKILL_GRADES_FILE     = path.join(DATA_DIR, 'skill-grades.json');
const GRADING_REQS_FILE     = path.join(DATA_DIR, 'grading-requests.json');
const PILOT_REGISTRY_FILE   = path.join(DATA_DIR, 'pilot-registry.json');
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

const rawGallery = loadJSON(GALLERY_FILE, null);
let gallery = Array.isArray(rawGallery) ? rawGallery : DEFAULT_GALLERY;

/* Hero image — the single cinematic shot shown at the top of the main page */
const DEFAULT_HERO = { src: 'gallery/shot-01.svg', alt: 'Formation Flight — Dawn Patrol over Caucasus', caption: 'FORMATION FLIGHT · CAUCASUS THEATRE · DAWN PATROL' };
const rawHero = loadJSON(HERO_FILE, null);
let heroImage = (rawHero && typeof rawHero === 'object' && !Array.isArray(rawHero)) ? rawHero : DEFAULT_HERO;

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

/* Skill tracker */
let skillTree       = loadJSON(SKILL_TREE_FILE,     { categories: [] });
let skillGrades     = loadJSON(SKILL_GRADES_FILE,   {});
let gradingRequests = loadJSON(GRADING_REQS_FILE,   []);
let pilotRegistry   = loadJSON(PILOT_REGISTRY_FILE, {});
let nextGradingReqId = gradingRequests.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
const VALID_GRADES  = new Set(['U', 'F', 'G', 'E']);

/* Load discord role → squadron mapping (role names as keys) */
let discordRoles = loadJSON(DISCORD_ROLES_FILE, {});

/* ─── Discord bot config ────────────────────────────────── */
const DISCORD_BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN  || '';
const DISCORD_GUILD_ID   = process.env.DISCORD_GUILD_ID   || '';
const APPLY_CHANNEL_ID   = process.env.APPLY_CHANNEL_ID   || '';
const GRADING_CHANNEL_ID = process.env.GRADING_CHANNEL_ID || '';

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

/* PATCH a Discord message (edit in place) */
function discordPatch(apiPath, body) {
  const payload = JSON.stringify(body);
  console.debug('[discord] PATCH /api/v10' + apiPath);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      path:     '/api/v10' + apiPath,
      method:   'PATCH',
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
        console.debug('[discord] PATCH /api/v10' + apiPath + ' → HTTP ' + res.statusCode);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
        } else {
          reject(new Error('Discord API ' + res.statusCode + ': ' + raw.slice(0, 400)));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/* Build the Discord embed for a grading request (used for both POST and PATCH) */
function buildGradingEmbed(request) {
  const pilot   = request.pilot_callsign || request.pilot_name || request.pilot_id;
  const module  = request.module_title   || request.module_id  || '—';
  const claimed = request.status === 'claimed';

  const color  = claimed ? 0x57f287 : 0xf0a500; /* green if claimed, amber if open */
  const status = claimed
    ? '✅  Claimed by **' + (request.claimed_by_name || '—') + '**'
    : '🟡  Open — awaiting instructor';

  return {
    title:  '🎯 Grading Request',
    color,
    fields: [
      { name: 'Pilot',  value: pilot,  inline: true },
      { name: 'Module', value: module, inline: true },
      { name: 'Status', value: status, inline: false },
    ],
    timestamp: request.requested_at,
    footer:    { text: 'Request ID: ' + request.id },
  };
}

/* Post a new grading request to Discord; returns the Discord message ID or null */
async function sendGradingRequestToDiscord(request) {
  if (!DISCORD_BOT_TOKEN) {
    console.warn('[grading] DISCORD_BOT_TOKEN not set — cannot post grading request to Discord');
    return null;
  }
  if (!GRADING_CHANNEL_ID) {
    console.warn('[grading] GRADING_CHANNEL_ID not set — skipping Discord notification');
    return null;
  }
  const msg = await discordPost('/channels/' + GRADING_CHANNEL_ID + '/messages', { embeds: [buildGradingEmbed(request)] });
  console.debug('[grading] Request ' + request.id + ' posted to Discord channel ' + GRADING_CHANNEL_ID);
  return msg && msg.id ? msg.id : null;
}

/* DELETE a Discord message */
function discordDelete(apiPath) {
  console.debug('[discord] DELETE /api/v10' + apiPath);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      path:     '/api/v10' + apiPath,
      method:   'DELETE',
      headers: {
        'Authorization': 'Bot ' + DISCORD_BOT_TOKEN,
        'User-Agent':    'SourceDCS-Web/1.0 (https://github.com/NikNam3/sourcedcs)',
      },
    };
    const req = https.request(options, (res) => {
      res.resume(); /* drain */
      res.on('end', () => {
        console.debug('[discord] DELETE /api/v10' + apiPath + ' → HTTP ' + res.statusCode);
        if (res.statusCode === 204 || (res.statusCode >= 200 && res.statusCode < 300)) {
          resolve();
        } else {
          reject(new Error('Discord API DELETE ' + res.statusCode));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/* Edit an existing Discord message to reflect the current request state */
async function updateGradingRequestOnDiscord(request) {
  if (!DISCORD_BOT_TOKEN || !GRADING_CHANNEL_ID || !request.discord_message_id) return;
  await discordPatch(
    '/channels/' + GRADING_CHANNEL_ID + '/messages/' + request.discord_message_id,
    { embeds: [buildGradingEmbed(request)] }
  );
  console.debug('[grading] Request ' + request.id + ' Discord message updated');
}

/* ─── Rate limiting ─────────────────────────────────────── */
const limiter = rateLimit({
  windowMs:        60 * 1000,
  max:             300,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many requests — please try again later.' },
});
app.use(limiter);

const writeOpsLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             40,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many requests — please try again later.' },
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

/* ─── App config (config.json) ──────────────────────────── */
const appConfig       = loadJSON(path.join(__dirname, 'config.json'), {});
const SKILL_ADMIN_ROLES = Array.isArray(appConfig.skillAdminRoles) ? appConfig.skillAdminRoles : ['admin'];

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

function requireSkillAdmin(req, res, next) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const ok = roles.some(r => SKILL_ADMIN_ROLES.includes(typeof r === 'string' ? r : (r?.name || '')));
  if (!ok) return res.status(403).json({ error: 'Skill admin access required' });
  next();
}

/* ─── Dynamic config for client ─────────────────────────── */
/* Serves Casdoor connection settings as a JS file so the client reads
   them from environment variables rather than hardcoded values. */
app.get('/js/config.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(
    'var CASDOOR_CLIENT_ID   = ' + JSON.stringify(CASDOOR_CLIENT_ID)   + ';\n' +
    'var CASDOOR_ENDPOINT    = ' + JSON.stringify(CASDOOR_ENDPOINT)    + ';\n' +
    'var DISCORD_URL         = ' + JSON.stringify(DISCORD_URL)         + ';\n' +
    'var WIKI_URL            = ' + JSON.stringify(WIKI_URL)            + ';\n' +
    'var ATO_URL             = ' + JSON.stringify(ATO_URL)             + ';\n' +
    'var OLYMPUS_URL         = ' + JSON.stringify(OLYMPUS_URL)         + ';\n' +
    'var ASACS_URL           = ' + JSON.stringify(ASACS_URL)           + ';\n' +
    'var GITHUB_URL          = ' + JSON.stringify(GITHUB_URL)          + ';\n' +
    'var SKILL_ADMIN_ROLES   = ' + JSON.stringify(SKILL_ADMIN_ROLES)   + ';\n'
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

/* ─── Discord scheduled events sync ─────────────────────── */
/* Fetches guild scheduled events from Discord and merges them into the
   local events list. Completed events are logged with status 'complete'. */
let eventsSyncAt = 0;
const EVENTS_SYNC_TTL = 5 * 60 * 1000; /* 5 minutes */

function mapDiscordEventStatus(discordStatus) {
  /* Discord statuses: 1=SCHEDULED, 2=ACTIVE, 3=COMPLETED, 4=CANCELED */
  switch (discordStatus) {
    case 1: return 'planned';
    case 2: return 'active';
    case 3: return 'complete';
    case 4: return 'cancelled';
    default: return 'planned';
  }
}

async function syncDiscordScheduledEvents() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) return;
  try {
    const discordEvents = await discordRequest(
      '/guilds/' + DISCORD_GUILD_ID + '/scheduled-events'
    );
    if (!Array.isArray(discordEvents)) return;

    let changed = false;
    for (const de of discordEvents) {
      const discordId = 'discord-' + de.id;
      const status    = mapDiscordEventStatus(de.status);
      const idx       = events.findIndex(e => e.discordEventId === discordId);

      if (idx !== -1) {
        /* Update existing synced event */
        const existing = events[idx];
        if (existing.status !== status || existing.name !== de.name) {
          events[idx] = {
            ...existing,
            name:        de.name || existing.name,
            status:      status,
            date:        de.scheduled_start_time || existing.date,
            description: de.description || existing.description,
          };
          changed = true;
          console.debug('[events-sync] Updated event', discordId, '→', status);
        }
      } else {
        /* Create new event from Discord */
        const ev = {
          id:              nextEventId++,
          discordEventId:  discordId,
          name:            String(de.name || 'Discord Event').trim(),
          type:            'campaign',
          status:          status,
          date:            de.scheduled_start_time || new Date().toISOString(),
          map:             (de.entity_metadata && de.entity_metadata.location) || '',
          airframes:       [],
          description:     String(de.description || '').trim(),
          slots:           0,
          filledSlots:     0,
        };
        events.push(ev);
        changed = true;
        console.debug('[events-sync] Created event', discordId, ':', ev.name);
      }
    }

    if (changed) {
      saveJSON(EVENTS_FILE, events);
    }
    eventsSyncAt = Date.now();
    console.debug('[events-sync] Sync complete, ' + discordEvents.length + ' Discord event(s) processed');
  } catch (err) {
    console.error('[events-sync] Discord fetch failed:', err.message);
  }
}

api.get('/events', async (_req, res) => {
  /* Auto-sync from Discord scheduled events (cached) */
  if (Date.now() - eventsSyncAt > EVENTS_SYNC_TTL) {
    await syncDiscordScheduledEvents();
  }
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

/* Admin: force-refresh Discord scheduled events sync */
api.post('/events/sync', writeOpsLimiter, requireAuth, requireAdmin, async (_req, res) => {
  eventsSyncAt = 0;
  await syncDiscordScheduledEvents();
  res.json({ ok: true, message: 'Discord events synced.', count: events.length });
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
  try { saveJSON(GALLERY_FILE, gallery); } catch (err) {
    return res.status(500).json({ error: 'Failed to save gallery: ' + err.message });
  }
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
  try { saveJSON(GALLERY_FILE, gallery); } catch (err) {
    gallery.splice(idx, 0, removed); /* roll back in-memory change */
    return res.status(500).json({ error: 'Failed to save gallery: ' + err.message });
  }
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

/* ── Hero image (public read, admin write + image upload) ── */
const MAX_HERO_SRC_LEN  = 512;
const MAX_HERO_TEXT_LEN = 200;

api.get('/hero-image', (_req, res) => res.json(heroImage));

api.put('/hero-image', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected object' });
  }
  heroImage = {
    src:     sanitizeStr(req.body.src,     MAX_HERO_SRC_LEN),
    alt:     sanitizeStr(req.body.alt,     MAX_HERO_TEXT_LEN),
    caption: sanitizeStr(req.body.caption, MAX_HERO_TEXT_LEN),
  };
  try { saveJSON(HERO_FILE, heroImage); } catch (err) {
    return res.status(500).json({ error: 'Failed to save hero image: ' + err.message });
  }
  res.json(heroImage);
});

api.post('/hero-image/upload', writeOpsLimiter, requireAuth, requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });
  res.json({ src: '/gallery-uploads/' + req.file.filename });
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

/* ── My squadron (resolves the logged-in pilot's squadron from the roster) ── */
api.get('/my-squadron', requireAuth, async (req, res) => {
  const sub   = req.user.sub;
  const pilot = pilotRegistry[sub];
  if (!pilot || !pilot.callsign) return res.json({ squadron: null });

  /* Ensure roster is loaded (re-use the shared cache) */
  const now = Date.now();
  if (!rosterCache || (now - rosterCacheAt) > ROSTER_CACHE_TTL) {
    try {
      rosterCache   = await buildRosterFromDiscord();
      rosterCacheAt = now;
    } catch (err) {
      console.error('[my-squadron] roster fetch failed:', err.message);
      return res.json({ squadron: null });
    }
  }

  const callsign = pilot.callsign.toLowerCase();
  const entry    = rosterCache.find(p => p.callsign && p.callsign.toLowerCase() === callsign);
  res.json({ squadron: entry ? (entry.squadron || null) : null });
});

/* ── Skill Tree (public read, admin write) ── */
api.get('/skill-tree', (_req, res) => {
  res.json(skillTree);
});

api.put('/skill-tree', writeOpsLimiter, requireAuth, requireSkillAdmin, (req, res) => {
  const tree = req.body;
  if (!tree || !Array.isArray(tree.categories)) {
    return res.status(400).json({ error: 'categories array required' });
  }
  for (const cat of tree.categories) {
    if (!cat.id || !cat.name || typeof cat.weight !== 'number') {
      return res.status(400).json({ error: 'Each category requires id, name, and numeric weight' });
    }
    if (!Array.isArray(cat.modules)) {
      return res.status(400).json({ error: 'Each category requires a modules array' });
    }
    for (const mod of cat.modules) {
      if (!mod.id || !mod.title) {
        return res.status(400).json({ error: 'Each module requires id and title' });
      }
      if (mod.min_pass_grade && !VALID_GRADES.has(mod.min_pass_grade)) {
        return res.status(400).json({ error: 'Invalid min_pass_grade: ' + mod.min_pass_grade });
      }
    }
  }
  skillTree = tree;
  saveJSON(SKILL_TREE_FILE, skillTree);
  res.json(skillTree);
});

/* ── Skill Grades ── */
api.get('/skill-grades', requireAuth, (req, res) => {
  const sub   = req.user.sub;
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isAdm = roles.some(r => SKILL_ADMIN_ROLES.includes(typeof r === 'string' ? r : (r?.name || '')));

  /* Auto-register pilot on first access */
  if (sub && !pilotRegistry[sub]) {
    const rawName = req.user.name || req.user.preferred_username || req.user.sub || '';
    const callsign = parseCallsign(rawName) || rawName;
    pilotRegistry[sub] = { sub, name: rawName, callsign, registered_at: new Date().toISOString() };
    saveJSON(PILOT_REGISTRY_FILE, pilotRegistry);
  }

  if (isAdm) {
    res.json(skillGrades);
  } else {
    res.json({ [sub]: skillGrades[sub] || {} });
  }
});

api.get('/skill-grades/:pilotId', requireAuth, requireSkillAdmin, (req, res) => {
  res.json(skillGrades[req.params.pilotId] || {});
});

const MAX_GRADE_NOTES_LEN = 500;
api.put('/skill-grades/:pilotId/:moduleId', writeOpsLimiter, requireAuth, requireSkillAdmin, (req, res) => {
  const { pilotId, moduleId } = req.params;
  const { grade, notes } = req.body;

  if (!grade || !VALID_GRADES.has(grade)) {
    return res.status(400).json({ error: 'grade must be one of U, F, G, E' });
  }

  const graderSub  = req.user.sub;
  const graderName = req.user.name || req.user.preferred_username || graderSub || '';

  if (!skillGrades[pilotId]) skillGrades[pilotId] = {};
  skillGrades[pilotId][moduleId] = {
    grade,
    notes:     sanitizeStr(notes || '', MAX_GRADE_NOTES_LEN),
    graded_at: new Date().toISOString(),
    graded_by: graderName,
  };
  saveJSON(SKILL_GRADES_FILE, skillGrades);

  /* Auto-remove any open/claimed grading requests for this pilot+module */
  const removedReqs = [];
  gradingRequests = gradingRequests.filter(r => {
    if (r.pilot_id === pilotId && (r.module_id === moduleId || !r.module_id)) {
      removedReqs.push(r);
      return false;
    }
    return true;
  });
  if (removedReqs.length) {
    saveJSON(GRADING_REQS_FILE, gradingRequests);
    removedReqs.forEach(r => {
      if (r.discord_message_id && DISCORD_BOT_TOKEN && GRADING_CHANNEL_ID) {
        discordDelete('/channels/' + GRADING_CHANNEL_ID + '/messages/' + r.discord_message_id)
          .catch(err => console.error('[grading] Discord message delete failed:', err.message));
      }
    });
  }

  res.json(skillGrades[pilotId][moduleId]);
});

api.delete('/skill-grades/:pilotId/:moduleId', writeOpsLimiter, requireAuth, requireSkillAdmin, (req, res) => {
  const { pilotId, moduleId } = req.params;
  if (!skillGrades[pilotId] || !skillGrades[pilotId][moduleId]) {
    return res.status(404).json({ error: 'Grade not found' });
  }
  delete skillGrades[pilotId][moduleId];
  saveJSON(SKILL_GRADES_FILE, skillGrades);
  res.json({ ok: true });
});

/* ── Pilot Registry (admin read / delete) ── */
api.get('/skill-pilots', requireAuth, requireSkillAdmin, (_req, res) => {
  res.json(pilotRegistry);
});

api.delete('/skill-pilots/:sub', writeOpsLimiter, requireAuth, requireSkillAdmin, (req, res) => {
  const sub = req.params.sub;
  if (!pilotRegistry[sub]) return res.status(404).json({ error: 'Pilot not found' });

  delete pilotRegistry[sub];
  delete skillGrades[sub];

  const before = gradingRequests.length;
  gradingRequests = gradingRequests.filter(r => r.pilot_id !== sub);
  if (gradingRequests.length !== before) saveJSON(GRADING_REQS_FILE, gradingRequests);

  saveJSON(PILOT_REGISTRY_FILE, pilotRegistry);
  saveJSON(SKILL_GRADES_FILE,   skillGrades);

  res.json({ ok: true });
});

/* ── Grading Requests ── */
api.get('/grading-requests', requireAuth, (req, res) => {
  const sub   = req.user.sub;
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isAdm = roles.some(r => SKILL_ADMIN_ROLES.includes(typeof r === 'string' ? r : (r?.name || '')));
  if (isAdm) {
    res.json(gradingRequests);
  } else {
    res.json(gradingRequests.filter(r => r.pilot_id === sub));
  }
});

const MAX_PILOT_NAME_LEN     = 64;
const MAX_PILOT_CALLSIGN_LEN = 32;
const MAX_MODULE_TITLE_LEN   = 128;
api.post('/grading-requests', writeOpsLimiter, requireAuth, async (req, res) => {
  const sub = req.user.sub;
  if (!sub) return res.status(401).json({ error: 'User sub claim missing from token' });

  /* 409 if the pilot already has an open or claimed request */
  const existing = gradingRequests.find(r => r.pilot_id === sub && (r.status === 'open' || r.status === 'claimed'));
  if (existing) {
    return res.status(409).json({ error: 'You already have an open grading request (id ' + existing.id + ')' });
  }

  const rawName  = req.user.name || req.user.preferred_username || sub || '';
  const callsign = parseCallsign(rawName) || rawName;

  const moduleId    = sanitizeStr(req.body.module_id    || '', 64);
  const moduleTitle = sanitizeStr(req.body.module_title || '', MAX_MODULE_TITLE_LEN);

  const request = {
    id:              nextGradingReqId++,
    pilot_id:        sub,
    pilot_name:      sanitizeStr(rawName,    MAX_PILOT_NAME_LEN),
    pilot_callsign:  sanitizeStr(callsign,   MAX_PILOT_CALLSIGN_LEN),
    module_id:       moduleId    || null,
    module_title:    moduleTitle || null,
    requested_at:    new Date().toISOString(),
    status:          'open',
    claimed_by:      null,
    claimed_by_name: null,
    discord_message_id: null,
  };

  gradingRequests.push(request);
  saveJSON(GRADING_REQS_FILE, gradingRequests);

  /* Await Discord so the message ID is included in the 201 response */
  try {
    const msgId = await sendGradingRequestToDiscord(request);
    if (msgId) {
      request.discord_message_id = msgId;
      saveJSON(GRADING_REQS_FILE, gradingRequests);
    }
  } catch (err) {
    console.error('[grading] Discord post failed:', err.message);
  }

  res.status(201).json(request);
});

api.put('/grading-requests/:id/claim', writeOpsLimiter, requireAuth, requireSkillAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const idx = gradingRequests.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Grading request not found' });

  const graderSub  = req.user.sub;
  const graderName = req.user.name || req.user.preferred_username || graderSub || '';

  gradingRequests[idx] = {
    ...gradingRequests[idx],
    status:          'claimed',
    claimed_by:      graderSub,
    claimed_by_name: sanitizeStr(graderName, MAX_PILOT_NAME_LEN),
  };
  saveJSON(GRADING_REQS_FILE, gradingRequests);

  /* Update Discord message to show claimed state */
  updateGradingRequestOnDiscord(gradingRequests[idx]).catch(err => {
    console.error('[grading] Discord message update (claim) failed:', err.message);
  });

  res.json(gradingRequests[idx]);
});

api.put('/grading-requests/:id/unclaim', writeOpsLimiter, requireAuth, requireSkillAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const idx = gradingRequests.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Grading request not found' });
  if (gradingRequests[idx].status !== 'claimed') {
    return res.status(400).json({ error: 'Request is not currently claimed' });
  }

  gradingRequests[idx] = {
    ...gradingRequests[idx],
    status:          'open',
    claimed_by:      null,
    claimed_by_name: null,
  };
  saveJSON(GRADING_REQS_FILE, gradingRequests);

  /* Update Discord message to show open state again */
  updateGradingRequestOnDiscord(gradingRequests[idx]).catch(err => {
    console.error('[grading] Discord message update (unclaim) failed:', err.message);
  });

  res.json(gradingRequests[idx]);
});

api.delete('/grading-requests/:id', writeOpsLimiter, requireAuth, (req, res) => {
  const id    = Number(req.params.id);
  const sub   = req.user.sub;
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isAdm = roles.some(r => SKILL_ADMIN_ROLES.includes(typeof r === 'string' ? r : (r?.name || '')));

  const idx = gradingRequests.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Grading request not found' });

  const request = gradingRequests[idx];
  if (!isAdm && request.pilot_id !== sub) {
    return res.status(403).json({ error: 'You can only delete your own grading requests' });
  }

  const msgId   = request.discord_message_id;
  gradingRequests.splice(idx, 1);
  saveJSON(GRADING_REQS_FILE, gradingRequests);
  res.json({ ok: true });

  /* Delete the Discord message after responding */
  if (msgId && DISCORD_BOT_TOKEN && GRADING_CHANNEL_ID) {
    discordDelete('/channels/' + GRADING_CHANNEL_ID + '/messages/' + msgId).catch(err => {
      console.error('[grading] Discord message delete failed:', err.message);
    });
  }
});

app.use('/api', api);

/* ─── JSON error handler ─────────────────────────────── */
/* Catches errors passed via next(err) (e.g. from multer, body-parser,
   or any route handler) and returns a JSON response so the client
   can always call .json() on the response without a parse failure. */
// eslint-disable-next-line no-unused-vars
app.use(function jsonErrorHandler(err, req, res, _next) {
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  console.error('[error]', status, message);
  res.status(status).json({ error: message });
});

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
  console.log('  GRADING_CHANNEL_ID :', GRADING_CHANNEL_ID || 'NOT SET (grading requests will not post to Discord)');
});
