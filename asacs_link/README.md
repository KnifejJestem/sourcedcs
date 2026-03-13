# DCS GCI Server

Minimal Node.js server that receives unit data from DCS via UDP,
applies realism-based coalition filtering, and distributes to
WebSocket clients at 2 Hz.

---

## How DCS data is collected

This server uses two complementary DCS scripting methods:

**1. Export.lua system** (`mygci_export.lua`) — real-time unit telemetry  
DCS calls `Export.lua` every simulation frame. The export script uses
`LoGetWorldObjects()` to obtain live position, coalition, category, and
identity data for all units and sends them via UDP to this server.
This is the standard method used by tools like Tacview and DCS-BIOS.

**2. Server Hooks** (`mygci_hook.lua` + `myatc.lua`) — event monitoring  
Hook scripts in `Saved Games\DCS\Scripts\Hooks\` receive game events such
as mission load, simulation stop, and player connect/disconnect/slot-change.
Hook scripts run in the DCS GUI thread and have access to `net`, `DCS`, and
`lfs` APIs — but **not** mission-scripting APIs like `world.searchObjects`.

---

## Directory Structure

```
asacs_link/
├── server.js           — main server (HTTP auth + WebSocket + UDP listener)
├── config.js           — passwords, ports, realism rules
├── filter.js           — coalition filtering logic
├── state.js            — in-memory unit/mission state
├── package.json
└── dcs/
    ├── mygci_export.lua   — Export.lua script: unit telemetry via LoGetWorldObjects()
    ├── myatc.lua          — Hook script: mission metadata + player events
    └── mygci_hook.lua     — Hook loader (placed in Scripts/Hooks/)
```

---

## Setup

### 1. Install & run the server

```bash
cd asacs_link
npm install
npm start
```

To enable detailed pipeline diagnostics (highly recommended when troubleshooting missing tracks):

```bash
ASACS_VERBOSE=true npm start
```

With verbose mode the server logs every UDP units packet received from DCS,
the unit count stored in state, and the filtered count sent to each coalition.
On the DCS side, set `VERBOSE = true` at the top of `mygci_export.lua` (it is
`false` by default) to log `LoGetWorldObjects()` results and per-frame send
activity to the DCS log file.  In the browser, open the developer console
(F12) to see per-message diagnostics from the client-side JavaScript.

Edit `config.js` to change passwords and ports before deployment.

### 2. Install DCS files

Copy files to your DCS Saved Games folder (usually `C:\Users\<you>\Saved Games\DCS`):

```
Scripts/Export.lua                        ← add dofile() line (see below)
Scripts/mygci_export.lua                  ← unit telemetry via Export.lua
Scripts/Hooks/mygci_hook.lua              ← hook loader for events
Mods/services/MyGCI/lua/myatc.lua         ← hook script for events
```

#### Export.lua integration

Create `Scripts/Export.lua` if it does not exist, then add this line:

```lua
-- Note: lfs.writedir() returns a Windows path (DCS runs on Windows only)
dofile(lfs.writedir()..'Scripts\\mygci_export.lua')
```

If you already have an `Export.lua` (e.g., from Tacview or DCS-BIOS), append
the `dofile` line at the bottom.  `mygci_export.lua` uses **callback chaining**:
it saves any previously-defined `LuaExportStart`, `LuaExportStop`, and
`LuaExportAfterNextFrame` callbacks and calls them alongside its own, so it
coexists correctly with Tacview and other export scripts without conflicts.

Both scripts send UDP packets to `127.0.0.1:7788` by default.
If the server runs on a different machine, edit `SERVER_HOST` in both
`mygci_export.lua` and `myatc.lua`.

---

## WebSocket Protocol

### 1. Authenticate (HTTP POST)

```http
POST http://localhost:3000/auth
Content-Type: application/json

{ "password": "blue_pass" }
```

Response:
```json
{ "token": "uuid-here", "coalition": "blue" }
```

### 2. Connect WebSocket

```
ws://localhost:3000/?token=<uuid>
```

The token is one-time use and expires in 30 seconds.

---

## Message Types (Server → Client)

### `snapshot` — sent immediately on connect
Full current state of all visible units for your coalition.

```json
{
  "type": "snapshot",
  "ts": 1700000000000,
  "units": [ ...unit objects... ]
}
```

### `update` — sent every 500ms (2 Hz)
Same format as snapshot. Clients should replace their unit list.

```json
{
  "type": "update",
  "ts": 1700000000000,
  "units": [ ...unit objects... ]
}
```

### `mission` — sent on connect and on mission load
```json
{
  "type": "mission",
  "data": {
    "name": "Blue Flag - Caucasus",
    "theatre": "Caucasus",
    "startTime": 28800,
    "date": { "year": 2024, "month": 6, "day": 15 },
    "bullseye": {
      "blue": { "x": 0, "y": 0 },
      "red":  { "x": 0, "y": 0 }
    }
  }
}
```

### `sim_stop`
DCS mission ended. Clear all tracks.

---

## Unit Object Fields

### Friendly unit (full datalink)
```json
{
  "id":          12345,
  "coalition":   2,
  "lat":         43.1234,
  "lon":         41.5678,
  "alt":         7500,
  "spd":         220,
  "hdg":         270,
  "type":        "F-15C",
  "typeName":    "F-15C",
  "category":    "Airplane",
  "squawk":      1234,
  "iffResolved": true,
  "pilotName":   "Maverick",
  "groupName":   "Enfield 1",
  "_rel":        "friendly"
}
```

### Hostile radar contact (position/alt/squawk only)
```json
{
  "id":          99999,
  "coalition":   1,
  "lat":         44.1234,
  "lon":         42.5678,
  "alt":         6000,
  "type":        "UNKNOWN",
  "typeName":    "UNKNOWN",
  "category":    "Airplane",
  "squawk":      7700,
  "iffResolved": false,
  "_rel":        "hostile"
}
```

---

## Realism Model

| Data field | Friendly | Hostile | Neutral |
|---|---|---|---|
| Position | ✅ | ✅ (radar) | ✅ (radar) |
| Altitude | ✅ | ✅ (radar) | ✅ (radar) |
| Speed | ✅ datalink | ❌ | ❌ |
| Heading | ✅ datalink | ❌ | ❌ |
| Type/Name | ✅ datalink | ❌ UNKNOWN | ❌ UNKNOWN |
| Squawk | ✅ | ✅ Mode 3 | ✅ Mode 3 |
| Pilot name | ✅ | ❌ | ❌ |

---

## Health Check

```
GET http://localhost:3000/health
```

```json
{
  "status": "ok",
  "clients": 3,
  "units": 47,
  "mission": "Blue Flag - Caucasus",
  "uptime": 1234.5
}
```

---

## Extending with Weather

When you're ready to add weather, the DCS hook can extract it:

```lua
local weather = DCS.getCurrentMission().mission.weather
-- Fields: groundTurbulence, enable_fog, wind, turbulence,
--         season, type_weather, qnh, clouds, temperature, ...
```

Send it as a `weather` packet type — the server will forward it to all
clients on connect (same as mission data).
