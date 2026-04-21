# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

SOURCE DCS is an open-source monorepo for a virtual aviation squadron. It contains four independent services:

- **atobrief** — Tactical briefing web app (ATO packages, airspace, SPINS, real-time presenter/presentee sync)
- **sourcedcs-web** — Squadron public website (roster via Discord, events, applications, media)
- **asacs_link** — DCS GCI server (live unit telemetry, IFF, Mapbox GL display)
- **tools/miztoyaml** — Python CLI that converts DCS `.miz` mission files to ATO brief YAML

Infrastructure (Nginx, MariaDB, Casdoor OAuth, MediaWiki) lives in `infra/` as a Docker Compose stack.

## Commands

Each service is independent — there is no root-level build script.

### atobrief (Node.js, Express + Socket.IO, port 4000)
```bash
cd atobrief && npm install
PORT=4000 npm start
```

### sourcedcs-web (Node.js, Express, port 7000)
```bash
cd sourcedcs-web && npm install
PORT=7000 npm start
```

### asacs_link (Node.js ESM, port 3000)
```bash
cd asacs_link && npm install
ASACS_DCS_FILES_PATH="/path/to/DCS/SavedGames/" npm start
npm test   # runs builder unit tests
```

### miztoyaml (Python 3)
```bash
pip install pyyaml
python3 -m tools.miztoyaml mission.miz
python3 -m pytest tools/tests/ -v
```

### Full production stack
```bash
cp .env.example infra/.env   # fill in domains, tokens, secrets
cd infra && docker compose up -d
```

### Nix dev environment
```bash
nix develop          # enter dev shell with Node.js 22, Python 3, Docker
nix build .#atobrief # build a specific service
```

## Architecture

### atobrief

`server.js` is an Express server that also manages Socket.IO rooms for presenter/presentee session sync. The browser app is a vanilla-JS SPA (`public/index.html`).

Frontend structure under `public/js/`:
- `app.js` — core app logic, YAML package state
- `auth.js` — Casdoor OAuth flow
- `session.js` — Socket.IO session management (presenter broadcasts tab/scroll state to presentees)
- `editor/` — per-section YAML editors (ACO, COMMS, SPINS, etc.)
- `views/` — tab renderers (ATO, ACO, Weather, SPINS)
- `map/` — interactive SVG tactical map (routes, targets, airspace drawn from YAML data)
- `loadout.js` — decodes aircraft loadout CLSIDs

The presenter hashes their password with `crypto.scryptSync` + salt server-side; presentees join with a room code. Session state (current tab, scroll position) is broadcast to all presentees in real time.

YAML package schema is documented in `docs/atobrief/yaml-format.md` (six sections: `header`, `registry`, `ato`, `aco`, `spins`, `comms`, `weather`).

### sourcedcs-web

`server.js` is a single Express server handling:
- Discord bot integration — syncs roster/roles into a local JSON cache
- JSON-file persistence for events, applications, and squadron data (stored in a Docker volume)
- Multer file uploads (images, galleries)
- Casdoor OAuth token exchange

Client secret (`DISCORD_BOT_TOKEN`, `CASDOOR_CLIENT_SECRET`) never reaches the browser. `express-rate-limit` protects auth and upload endpoints.

### asacs_link

Real-time GCI server using a file-poll + WebSocket architecture:
1. `server.js` polls `asacslink_units.json` (written by DCS Lua export scripts at 2 Hz) from the DCS SavedGames path
2. `simulation/transponder.js` listens on UDP port 10712 for IFF/transponder packets from DCS clients
3. `simulation/engine.js` merges raw unit data with IFF state
4. `filter.js` applies coalition-based realism rules (enemy unit details are hidden)
5. Filtered state is broadcast over WebSocket at 2 Hz to browser clients

Browser clients show either a PROF table (`display/table`) or a full MFD Mapbox GL JS map (`display/map`).

DCS Lua scripts live in `asacs_link/dcs/`: `asacslink_export.lua` exports unit telemetry via `LoGetWorldObjects`, `asacslink_events.lua` captures mission metadata and player events.

### miztoyaml

A Python 3 package that unzips `.miz` files (ZIP archives containing Lua tables), parses the mission structure, and emits an ATO brief YAML package.

Key parsing challenge: DCS mission files are Lua tables, not JSON. `lua.py` provides brace-balanced extraction helpers; `parse.py` and `parse_flights.py` use regex + those helpers to walk the structure. Coordinate projection (DCS Cartesian → WGS84) is in `projection.py` using theater-specific Transverse Mercator constants.

Module responsibilities:
- `extract.py` — top-level orchestration and CLI
- `parse.py` / `parse_flights.py` — group, flight, carrier, waypoint, weather, drawing parsing
- `build_targets.py` — SAM sites, airspace, aim-points
- `build_missions.py` — airfield registry, mission list assembly
- `build_doc.py` — final YAML document assembly
- `weapons.py` — CLSID → weapon name lookup
- `dtc.py` — DTC file and SPINS markdown parsing
- `sam.py` — SAM threat definitions and classification

## Authentication

All services use [Casdoor](https://casdoor.org/) for OAuth 2.0. Configuration is documented in `CASDOOR_SETUP.md`. The OAuth code exchange happens server-side; client secrets are never sent to the browser.

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Used by |
|---|---|
| `CASDOOR_ENDPOINT` | atobrief, sourcedcs-web |
| `ATOBRIEF_CLIENT_ID` / `ATOBRIEF_CLIENT_SECRET` | atobrief |
| `DISCORD_BOT_TOKEN` | sourcedcs-web |
| `ASACS_DCS_FILES_PATH` | asacs_link |
| `MAPBOX_TOKEN` | asacs_link (optional, for MFD map) |
| `ASACS_VERBOSE=true` | asacs_link debug logging |