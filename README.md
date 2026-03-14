# SOURCE DCS

Open-source tooling and infrastructure for the SOURCE virtual aviation squadron. This monorepo contains the squadron website, a tactical briefing application, a DCS datalink/GCI server, and a Python converter that turns raw DCS mission files into brief packages.

---

## Repository Layout

```
sourcedcs-web/    Squadron website — Node.js / Express
atobrief/         Tactical briefing app — Node.js / Express + Socket.IO
asacs_link/       DCS GCI datalink server — Node.js / Express + WebSocket
tools/miztoyaml/  .miz → YAML converter — Python 3
infra/            Docker Compose production stack (Nginx, MariaDB, Casdoor, MediaWiki)
docs/             Reference documentation
```

---

## Components

### sourcedcs-web — Squadron Website

Public-facing squadron website. Handles roster display, event scheduling, gallery, squadron/wing pages, join applications, and Casdoor SSO login.

**Quick start**

```bash
cd sourcedcs-web
npm install
npm start          # → http://localhost:7000
```

See [`sourcedcs-web/CASDOOR_SETUP.md`](sourcedcs-web/CASDOOR_SETUP.md) for authentication configuration.

---

### atobrief — Tactical Briefing Application

Browser-based briefing tool for presenting Air Tasking Orders (ATOs), Airspace Control Orders (ACOs), SPINS, COMMS, and Weather data. Features live editing, YAML import/export, an interactive SVG map, and real-time presenter/presentee synchronisation over Socket.IO.

**Quick start**

```bash
cd atobrief
npm install
npm start          # → http://localhost:4000
```

Load a YAML package via the upload screen (drag-drop or file picker) or join an active presenter's session with a session ID and password.

**Tabs**

| Tab | Content |
|-----|---------|
| ATO | Mission cards, intel strip, Gantt timeline |
| ACO | Airspace control measure table |
| SPINS | Flexible section-based operational procedures |
| COMMS | UHF / VHF preset frequency grids |
| WX | Decoded METAR / TAF + mission weather notes |
| MAP | Interactive SVG map — routes, airspace, targets, marshal points |

**Themes** — toggle between **Pro** (light, professional) and **Movie** (dark CRT green).

**YAML format** — see [`docs/atobrief/yaml-format.md`](docs/atobrief/yaml-format.md).

---

### asacs_link — DCS GCI Datalink Server

Reads live unit telemetry written by a DCS `Export.lua` script, applies coalition-based realism filtering, and streams position data to WebSocket clients at 2 Hz. Includes a web-based GCI dashboard.

**Quick start**

```bash
cd asacs_link
npm install
ASACS_DCS_FILES_PATH="/path/to/DCS/SavedGames/" npm start   # → http://localhost:3000
```

Copy the Lua files from `asacs_link/dcs/` to your DCS Saved Games folder:

```
Scripts/mygci_export.lua              ← unit telemetry via Export.lua
Scripts/Hooks/mygci_hook.lua          ← hook loader
Mods/services/MyGCI/lua/mygci_events.lua  ← mission metadata + player events
```

See [`asacs_link/README.md`](asacs_link/README.md) for the full setup guide, WebSocket protocol, and realism model.

---

### tools/miztoyaml — DCS .miz to YAML Converter

Python 3 command-line tool that extracts flights, waypoints, airspace drawings, SAM sites, weather, and loadout data from a DCS `.miz` file and outputs a ready-to-load ATO brief YAML package.

**Requirements**

```bash
pip install pyyaml
```

**Usage**

```bash
# Basic — outputs mission.yaml in the current directory
python3 -m tools.miztoyaml mission.miz

# Choose coalition and output file
python3 -m tools.miztoyaml mission.miz --coalition red --output brief.yaml

# Verbose logging
python3 -m tools.miztoyaml mission.miz --verbose
```

**Tests**

```bash
python3 -m pytest tools/tests/ -v
```

---

## Infrastructure

The production stack is in `infra/` and runs with Docker Compose.

**Services**

| Service | Description |
|---------|-------------|
| nginx | Reverse proxy + SSL termination (Let's Encrypt via Certbot) |
| main-website | `sourcedcs-web` container |
| atobrief | `atobrief` container |
| asacs-link | `asacs_link` container |
| casdoor | SSO identity provider (OAuth 2.0 / JWT) |
| mediawiki | Squadron wiki |
| mariadb | Shared database (MediaWiki + Casdoor) |

**Deploy**

```bash
cp .env.example infra/.env
# Edit infra/.env — set domains, passwords, Casdoor credentials, Discord tokens
cd infra
docker compose up -d
```

See `.env.example` for a full list of environment variables.

---

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/atobrief/yaml-format.md`](docs/atobrief/yaml-format.md) | ATO brief YAML package schema reference |
| [`docs/atobrief/weather-txt.md`](docs/atobrief/weather-txt.md) | `weather.txt` supplemental METAR/TAF format |
| [`asacs_link/README.md`](asacs_link/README.md) | ASACS Link setup, WebSocket protocol, unit object reference |
| [`sourcedcs-web/CASDOOR_SETUP.md`](sourcedcs-web/CASDOOR_SETUP.md) | Casdoor SSO configuration guide |

---

## License

MIT
