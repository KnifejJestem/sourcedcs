# ASACS LINK — GCI Server

Node.js GCI server that reads DCS unit data, runs it through a simulation
engine, applies coalition-based filtering, and distributes processed tracks to
WebSocket clients at 2 Hz.  A built-in Mapbox GL JS map provides a live
tactical display in MFD mode, alongside the traditional PROF table view.

---

## Architecture

```
DCS (Export.lua / Hooks)
        │  file I/O (asacslink_*.json)
        ▼
  ┌─────────────┐
  │  File Poller │  polls DCS Saved Games folder at 2 Hz
  └──────┬──────┘
         │
         ▼
  ┌──────────────┐       ┌──────────────────────┐
  │  StateStore  │       │ TransponderReceiver   │
  │  (raw units) │       │  UDP :10712 (IFF)    │
  └──────┬───────┘       └──────────┬───────────┘
         │                          │
         └────────────┬─────────────┘
                      ▼
             ┌─────────────────┐
             │ SimulationEngine │  ← extension point for alt/hdg/LOS simulation
             └────────┬────────┘
                      │ processed units
                      ▼
             ┌─────────────────┐
             │  CoalitionFilter │  (filter.js)
             └────────┬────────┘
                      │ per-coalition view
                      ▼
             WebSocket clients
```

---

## How DCS data is collected

This server uses two complementary DCS scripting methods:

**1. Export.lua system** (`asacslink_export.lua`) — real-time unit telemetry  
DCS calls `Export.lua` every simulation frame. The export script runs at 2 Hz
via `LuaExportActivityNextEvent`, calls `LoGetWorldObjects()` to obtain live
position/coalition/identity data, and writes a JSON snapshot to the DCS Saved
Games folder.

**2. Server Hooks** (`asacslink_hook.lua` + `asacslink_events.lua`) — events  
Hook scripts receive mission-load, sim-stop, and player events.  They write
mission metadata and player events to separate JSON files.

---

## Directory Structure

```
asacs_link/
├── server.js                 — HTTP auth + WebSocket + file poller + routing
├── config.js                 — passwords, ports, realism rules
├── filter.js                 — coalition filtering logic
├── state.js                  — in-memory unit/mission state
├── simulation/
│   ├── engine.js             — Simulation Engine (raw → processed data)
│   └── transponder.js        — UDP IFF receiver (port 10712)
├── public/
│   ├── index.html
│   ├── css/app.css
│   └── js/
│       ├── app.js            — auth, WebSocket, message routing
│       └── display/
│           ├── mode.js       — PROF / MFD mode switcher
│           ├── table.js      — PROF mode table renderer
│           └── map.js        — MFD mode Mapbox GL JS map
└── dcs/
    ├── Export.lua            — ready-to-use Export.lua (or append dofile line)
    ├── asacslink_export.lua  — unit telemetry via LoGetWorldObjects()
    ├── asacslink_events.lua  — hook script: mission metadata + player events
    └── asacslink_hook.lua    — hook loader (placed in Scripts/Hooks/)
```

---

## Setup

### 1. Install & run the server

```bash
cd asacs_link
npm install
npm start
```

**Required:** Set `ASACS_DCS_FILES_PATH` to the DCS Saved Games folder:

```bash
# Windows (PowerShell)
$env:ASACS_DCS_FILES_PATH="C:\Users\you\Saved Games\DCS\"; npm start

# Linux / macOS
ASACS_DCS_FILES_PATH="/mnt/dcs_saved_games/" npm start
```

**Optional:** Enable the Mapbox tactical map (MFD mode) with a public token:

```bash
MAPBOX_TOKEN="pk.ey..." npm start
```

When `MAPBOX_TOKEN` is not set, MFD mode shows a "MAP UNAVAILABLE" message
and PROF mode (table view) remains fully functional.

**Optional:** Enable verbose diagnostics:

```bash
ASACS_VERBOSE=true npm start
```

### 2. Install DCS files

Copy files to your DCS Saved Games folder (`C:\Users\<you>\Saved Games\DCS`):

```
Scripts/Export.lua                              ← copy dcs/Export.lua, or append dofile line
Scripts/asacslink_export.lua                    ← unit telemetry via Export.lua
Scripts/Hooks/asacslink_hook.lua                ← hook loader for events
Mods/services/asacslink/lua/asacslink_events.lua  ← hook script for events
```

If you already have `Export.lua`, append only the `dofile` line at the bottom:

```lua
dofile(lfs.writedir()..'Scripts\\asacslink_export.lua')
```

`asacslink_export.lua` uses **callback chaining** — it coexists with Tacview
and DCS-BIOS without conflicts.

---

## DCS data files

| File | Written by | Contains |
|---|---|---|
| `asacslink_units.json`   | `asacslink_export.lua` every 0.5 s | Full unit snapshot |
| `asacslink_status.json`  | `asacslink_export.lua` on load/stop | `export_loaded`, `sim_stop` |
| `asacslink_mission.json` | `asacslink_events.lua` on mission load | Mission metadata |
| `asacslink_event.json`   | `asacslink_events.lua` on player events | Connect/disconnect/slot |

---

## Transponder / IFF Feed (UDP :10712)

Send SRS-compatible IFF packets to UDP port 10712 (configurable via
`ASACS_TRANSPONDER_PORT`).  The simulation engine matches squawk codes by
pilot name and attaches live Mode 3 to units before coalition filtering.

Expected UDP payload format:

```json
{
  "clients": [
    { "name": "Maverick", "iff": { "mode3": 1234, "status": "active" } }
  ]
}
```

---

## Display Modes

| Mode | Toggle | Description |
|---|---|---|
| **PROF** | Header toggle | Text table view — all tracks, IFF, coords |
| **MFD**  | Header toggle | Mapbox GL JS tactical map with unit markers |

The mode selection is persisted per browser session.

---

## Simulation Engine (`simulation/engine.js`)

The simulation engine is the hand-off point between raw DCS data and the
display.  It currently:

- Attaches live IFF data from the transponder receiver (matched by pilot name)

It is structured for easy expansion.  Stub methods exist for:

- **Indicated Altitude** — true ASL → indicated altitude using temperature + QNH
- **Magnetic Heading** — true heading → magnetic (theatre declination)
- Future: Line-of-Sight, transponder frequency simulation, mission time

---

## WebSocket Protocol

### Authenticate

```http
POST /auth
{ "password": "blue_pass" }
→ { "token": "<uuid>", "coalition": "blue" }
```

### Connect

```
ws://localhost:3000/?token=<uuid>
```

### Message types (server → client)

| Type | Description |
|---|---|
| `snapshot` | Full unit list on connect |
| `update`   | Full unit list every 500 ms |
| `mission`  | Mission metadata on connect + mission load |
| `sim_stop` | DCS mission ended — clear all tracks |

### Unit object (processed + filtered)

Friendly units carry full datalink fields; hostile/neutral contacts have type
scrubbed to `UNKNOWN`.  The `_sim` key carries simulation-derived fields:

```json
{
  "id": 12345, "coalition": 2,
  "lat": 43.1234, "lon": 41.5678, "alt": 7500,
  "spd": 220, "hdg": 270,
  "type": "F-15C", "typeName": "F-15C", "category": "Airplane",
  "squawk": 1234, "iffResolved": true,
  "pilotName": "Maverick", "groupName": "Enfield 1",
  "_rel": "friendly",
  "_sim": { "iffStatus": "active", "indicatedAlt": null, "magHdg": null }
}
```

---

## Health Check

```
GET /health → { "status": "ok", "clients": 3, "units": 47, ... }
GET /api/config → { "mapboxToken": "pk.ey..." }
GET /api/raw → unfiltered raw unit store (used by PROF raw dump panel)
```
