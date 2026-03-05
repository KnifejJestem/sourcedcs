'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ─── Data persistence ──────────────────────────────────── */
const DATA_DIR      = path.join(__dirname, 'data');
const EVENTS_FILE   = path.join(DATA_DIR, 'events.json');
const APPS_FILE     = path.join(DATA_DIR, 'applications.json');
const ROSTER_FILE   = path.join(DATA_DIR, 'roster.json');
const SQUADRONS_FILE = path.join(DATA_DIR, 'squadrons.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/* Seed events — used when no events.json exists yet */
const SEED_EVENTS = [
  {
    id: 1,
    name: 'OPERATION IRON SHIELD',
    type: 'campaign',
    status: 'planned',
    date: '2026-04-05T18:00:00Z',
    map: 'Syria',
    airframes: ['F/A-18C', 'F-16C'],
    description: 'Defensive counter-air campaign over northern Syria. Package includes CAP, SEAD, and tanker support. Full ATO briefing required.',
    slots: 8,
    filledSlots: 3
  },
  {
    id: 2,
    name: 'TRAINING SORTIE — BFM FUNDAMENTALS',
    type: 'training',
    status: 'planned',
    date: '2026-03-29T17:00:00Z',
    map: 'Persian Gulf',
    airframes: ['Any'],
    description: 'Basic fighter manoeuvres training session. All skill levels welcome. Instructor: NIKNAM.',
    slots: 6,
    filledSlots: 2
  },
  {
    id: 3,
    name: 'OPERATION DESERT HAMMER',
    type: 'strike',
    status: 'planned',
    date: '2026-04-12T19:00:00Z',
    map: 'Persian Gulf',
    airframes: ['F/A-18C'],
    description: 'Precision strike against hardened targets. SEAD support provided. SPINS package mandatory.',
    slots: 4,
    filledSlots: 1
  },
  {
    id: 4,
    name: 'CAUCASUS CAP EXERCISE',
    type: 'cap',
    status: 'planned',
    date: '2026-04-19T16:00:00Z',
    map: 'Caucasus',
    airframes: ['F-16C', 'F/A-18C'],
    description: 'Combat Air Patrol exercise with GCI integration. ASACS LINK will be used for live datalink.',
    slots: 4,
    filledSlots: 0
  },
  {
    id: 5,
    name: 'TRAINING SORTIE — ATO BRIEF WALKTHROUGH',
    type: 'training',
    status: 'complete',
    date: '2025-03-15T17:00:00Z',
    map: 'Caucasus',
    airframes: ['Any'],
    description: 'Introduction to the ATO Brief tool and SOURCE mission planning procedures.',
    slots: 8,
    filledSlots: 8
  }
];

let events = loadJSON(EVENTS_FILE, SEED_EVENTS.map(e => ({ ...e })));
let applications = loadJSON(APPS_FILE, []);
let nextEventId = events.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;

/* Seed roster */
const SEED_ROSTER = [
  { id: 1, callsign: 'NIKNAM', rank: 'SQ/LDR', airframe: 'F/A-18C · F-16C', role: 'Squadron Leader · Developer', status: 'active', squadron: 'vf1' }
];

/* Seed squadrons */
const SEED_SQUADRONS = [
  {
    id: 'vf1', designator: 'VF-1', name: 'WILDCATS', airframe: 'F/A-18C HORNET',
    tags: ['STRIKE', 'CAS', 'SEAD'],
    shortDesc: 'VF-1 specialises in precision strike, close air support, and suppression of enemy air defences. Pilots fly the F/A-18C Hornet in a multi-role capacity, often leading package strike elements in campaign operations.',
    fullDesc: 'VF-1 WILDCATS is SOURCE\'s premier strike wing. Operating the F/A-18C Hornet, VF-1 pilots train extensively in precision strike, close air support (CAS), and suppression/destruction of enemy air defences (SEAD/DEAD). The wing regularly leads package strike elements during campaign operations and is proficient in both day and night operations. VF-1 pilots are expected to maintain proficiency in carrier operations, CASE I/III recoveries, and multi-role mission planning.',
    image: ''
  },
  {
    id: 'va2', designator: 'VA-2', name: 'SPARTANS', airframe: 'F-16C VIPER',
    tags: ['CAP', 'SEAD', 'ESCORT'],
    shortDesc: 'VA-2 focuses on combat air patrol, fighter escort, and SEAD coordination. Pilots fly the F-16C Viper, providing air superiority and protecting strike packages in contested airspace.',
    fullDesc: 'VA-2 SPARTANS is SOURCE\'s air superiority and escort wing. Flying the F-16C Viper, VA-2 pilots specialise in combat air patrol (CAP), fighter escort, and SEAD coordination. The wing provides air superiority coverage for strike packages operating in contested airspace. VA-2 pilots train in BVR and WVR engagements, threat identification, and coordinated intercept procedures using ASACS GCI datalink.',
    image: ''
  }
];

let roster = loadJSON(ROSTER_FILE, SEED_ROSTER.map(r => ({ ...r })));
let squadrons = loadJSON(SQUADRONS_FILE, SEED_SQUADRONS.map(s => ({ ...s })));
let nextRosterId = roster.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;

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

/* ─── Body parsing ──────────────────────────────────────── */
app.use(express.json({ limit: '50kb' }));

/* ─── Auth helpers ──────────────────────────────────────── */
// Comma-separated list of admin usernames (case-insensitive)
const ADMIN_USERS = (process.env.ADMIN_USERS || 'niknam')
  .split(',').map(s => s.trim().toLowerCase());

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
  const name = (req.user?.name || req.user?.preferred_username || req.user?.sub || '').toLowerCase();
  if (!ADMIN_USERS.includes(name)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

/* ─── Static files ──────────────────────────────────────── */
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, {
  index:    'index.html',
  maxAge:   '1h',
  etag:     true,
  dotfiles: 'ignore',
}));

/* ─── API router ────────────────────────────────────────── */
const api = express.Router();

/* Health check */
api.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
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

  applications.push(application);
  saveJSON(APPS_FILE, applications);
  res.status(201).json({
    ok:      true,
    message: 'Application received! Join our Discord to get started:',
    discord: 'https://discord.gg/sourcedcs'
  });
});

/* Admin: list applications */
api.get('/applications', requireAuth, requireAdmin, (_req, res) => {
  res.json(applications);
});

/* ── Roster (public read, admin write) ── */
api.get('/roster', (_req, res) => {
  res.json(roster);
});

api.post('/roster', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const { callsign, rank, airframe, role, status, squadron } = req.body;
  if (!callsign) return res.status(400).json({ error: 'callsign is required' });
  const entry = {
    id:       nextRosterId++,
    callsign: String(callsign).trim().slice(0, 32),
    rank:     String(rank || '').trim().slice(0, 32),
    airframe: String(airframe || '').trim().slice(0, 64),
    role:     String(role || '').trim().slice(0, 64),
    status:   String(status || 'active').trim().slice(0, 16),
    squadron: String(squadron || '').trim().slice(0, 16),
  };
  roster.push(entry);
  saveJSON(ROSTER_FILE, roster);
  res.status(201).json(entry);
});

api.put('/roster/:id', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const idx = roster.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Pilot not found' });
  const { callsign, rank, airframe, role, status, squadron } = req.body;
  if (callsign !== undefined) roster[idx].callsign = String(callsign).trim().slice(0, 32);
  if (rank !== undefined)     roster[idx].rank     = String(rank).trim().slice(0, 32);
  if (airframe !== undefined) roster[idx].airframe = String(airframe).trim().slice(0, 64);
  if (role !== undefined)     roster[idx].role     = String(role).trim().slice(0, 64);
  if (status !== undefined)   roster[idx].status   = String(status).trim().slice(0, 16);
  if (squadron !== undefined) roster[idx].squadron = String(squadron).trim().slice(0, 16);
  saveJSON(ROSTER_FILE, roster);
  res.json(roster[idx]);
});

api.delete('/roster/:id', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const idx = roster.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Pilot not found' });
  roster.splice(idx, 1);
  saveJSON(ROSTER_FILE, roster);
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
    id:         String(id).trim().slice(0, 16),
    designator: String(designator).trim().slice(0, 16),
    name:       String(name).trim().slice(0, 32),
    airframe:   String(airframe || '').trim().slice(0, 64),
    tags:       Array.isArray(tags) ? tags.map(t => String(t).trim().slice(0, 16)) : [],
    shortDesc:  String(shortDesc || '').trim().slice(0, 500),
    fullDesc:   String(fullDesc || '').trim().slice(0, 2000),
    image:      String(image || '').trim().slice(0, 256),
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
  console.log(`[sourcedcs-website] listening on http://0.0.0.0:${PORT}`);
});
