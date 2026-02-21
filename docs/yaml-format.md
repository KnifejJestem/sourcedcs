# ATO BRIEF — Package File Format

A **package file** is a single YAML file that contains one or more of the five
top-level sections below.  Any subset is valid; the viewer will enable only the
tabs for which data is present.

```yaml
ato:     { ... }   # Air Tasking Order (drives ATO, Timeline, and Map tabs)
aco:     { ... }   # Airspace Control Order (ACO tab)
spins:   { ... }   # Special Instructions (SPINS tab)
comms:   { ... }   # Frequency Preset Table (COMMS tab)
weather: { ... }   # Mission weather forecast (WX tab)
```

---

## Coordinate strings

All `coords` / `anchor_point` / `center` / `boundary` values are free-text
strings parsed by the viewer.  Any of the following notations are accepted:

| Notation | Example |
|----------|---------|
| Degrees + decimal minutes (DM) | `N26°51.319' E056°21.616'` |
| Degrees + decimal minutes (deg keyword) | `N26deg51.319' E056deg21.616'` |
| Degrees-minutes-seconds (DMS) | `N26°51'19.09" E056°21'36.93"` |
| DMS with deg keyword | `N26deg51'19.09" E056deg21'36.93"` |

The hemisphere letters (`N`/`S` and `E`/`W`) are required and must come
**before** the degrees.  The viewer reformats every stored coordinate on the
fly when you switch the `DM / DMS / MGRS` toggle, so no re-authoring of the
YAML is needed when changing display modes.

## Time strings

Time values are four-digit strings in `HHMM` format with an optional suffix:

- `'2040'` or `'2040Z'` — Zulu (UTC)  
- `'2040L'` — Local (stripped when parsing; use `local_offset_hours` for display)

Always quote times in YAML to avoid the value being parsed as an integer:
`not_earlier_than: '2040'`

---

## `ato:` — Air Tasking Order

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `irl_date` | string | Real-world date of the briefing session (`DD/MM/YYYY`) |
| `irl_time_zulu` | string | Real-world start time in Zulu (`HHMMz`) |
| `ingame_start_local` | string | In-game mission start in Local (`HHMML`) |
| `local_offset_hours` | number | UTC offset for the theater (e.g. `4` for UTC+4). Used to convert Zulu times when the `L` display mode is selected. |
| `ae_flags` | list of strings | Informational tags shown in the header (e.g. `[IRL, INGAME]`) |

### `global_control:`

Package-wide command and control data.

| Field | Type | Description |
|-------|------|-------------|
| `primary_freq_mhz` | string | Package primary frequency in MHz |
| `controlling_unit` | string | AWACS / GCI callsign |
| `aircraft_type` | string | AWACS / GCI aircraft type |
| `bullseye.name` | string | Bullseye reference point name |
| `bullseye.coords` | coord string | Bullseye position (plotted on map with crosshair symbol) |

### `airfields:` (list)

Each airfield entry is plotted on the map with a runway-cross symbol.

| Field | Type | Description |
|-------|------|-------------|
| `icao` | string | ICAO code (used to resolve `deploy_location_icao` etc.) |
| `name` | string | Human-readable name |
| `role` | string | `deploy` / `recovery` / `alternate` / `divert` (or any string) |
| `coords` | coord string | Position |
| `elevation_ft` | number | Field elevation in feet (shown as sub-label on map) |

### `carriers:` (list)

Carrier positions are planning estimates plotted with an anchor symbol.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Ship name |
| `callsign` | string | Callsign (also used as an ICAO-like key for route resolution) |
| `deploy_coords` | coord string | Estimated position at start of ATO window |
| `recovery_coords` | coord string | Estimated position at end / recovery window |

### `marshal_points:` (list)

Marshal points are holding positions where flights orbit before ingressing to the target area.
Each marshal point is plotted on the map as a diamond symbol with a dashed orbit ring.

```yaml
marshal_points:
  - name: MARSHAL ALPHA
    coords: "N25°30'00\" E055°30'00\""
    altitude: FL250
  - name: MARSHAL BRAVO
    coords: "N24°45'00\" E056°00'00\""
    altitude: FL220
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Marshal point identifier (shown as map label and in popup) |
| `coords` | coord string | Position |
| `altitude` | string | Holding altitude (e.g. `FL250`) — shown in popup and as map sub-label |

### `targets:` (list)

Reusable target definitions that can be referenced by missions via `target_ref`.
Each target is plotted on the map as a threat marker (×) with an optional
engagement-range ring.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier referenced by `aim_points[].target_ref` |
| `name` | string | Display name |
| `type` | string | Target category (e.g. `SAM`, `EWR`, `BUILDING`) |
| `coords` | coord string | Position |
| `elevation` | string | Target elevation (e.g. `E350FT`) |
| `engagement_range_nm` | number | SAM/AAA engagement range in NM (draws a dashed ring on the map) |
| `max_alt_ft` | number | Maximum engagement altitude in feet (shown in popup) |

### `missions:` (list)

One entry per tasked mission.  Missions drive the ATO card list, timeline bars,
and map routes.

#### Mission identification

| Field | Type | Description |
|-------|------|-------------|
| `unit` | string | Operating unit |
| `home_base_icao` | string | Home base ICAO (display only) |
| `mission_number` | string | ATO mission number (e.g. `MSN3266`) |
| `callsign` | string | Flight callsign |
| `mission_type` | string | `CAP` / `BAI` / `CAS` / `SEAD` / `STRIKE` (drives color coding) |
| `deploy_location_icao` | string | ICAO or coord string — start of route on map |
| `aar_location_icao` | string | ICAO or coord string — recovery / end of route on map |

#### `aircraft:`

| Field | Type | Description |
|-------|------|-------------|
| `count` | number | Number of aircraft in the flight |
| `type` | string | Aircraft designation (e.g. `F16C`) |
| `loadout` | string | Loadout code — see [Loadout format](#loadout-format) |

#### `target:`

| Field | Type | Description |
|-------|------|-------------|
| `location` | string | Target area name |
| `mission_type_override` | string | Optional sub-type shown alongside `mission_type` |
| `altitude` | string | Target altitude reference (e.g. `E73FT`, `FL200`) |
| `not_earlier_than` | time string | Legacy mission window open (NET) — used when neither `tot_*` nor `tos`/`toffs` is set |
| `not_later_than` | time string | Legacy mission window close (NLT) |
| `tot_net` | time string | Time on Target — NET (strike/BAI missions: when weapons should be on target) |
| `tot_nlt` | time string | Time on Target — NLT |
| `tos` | time string | Time on Station (CAP/CAS missions: when aircraft should be on station) |
| `toffs` | time string | Time OFF Station (when aircraft departs station) |

**Timing guidance:**
- For **strike/BAI/SEAD** missions, use `tot_net` / `tot_nlt` (Time on Target — when weapons should impact).
- For **CAP/CAS/orbit** missions, use `tos` / `toffs` (Time on Station / Time OFF Station).
- Both can be specified for a single mission (e.g. a SEAD flight that must be on station before a strike TOT).
- The legacy `not_earlier_than` / `not_later_than` fields are still accepted for backward compatibility.

#### Mission-level timing fields

| Field | Type | Description |
|-------|------|-------------|
| `takeoff_time` | time string | Planned takeoff time |
| `recovery_time` | time string | Planned recovery / landing time |
| `vul_start` | time string | Vulnerability window start — period when the flight is exposed to threats |
| `vul_end` | time string | Vulnerability window end |

The **vulnerability window** is shown as a red hatched overlay on the timeline and
as a time pair in the detail panel.  It marks the period when the flight is
inside the threat envelope or otherwise exposed.

#### `target.aim_points:` (list)

Each aim point can be a plain coord string, a named coord object, or a
reference to a target defined in `ato.targets`.

```yaml
aim_points:
  # Reference an existing target — inherits coords, elevation, name
  - target_ref: SA6-NORTH

  # Reference + override the display name
  - target_ref: SA6-SOUTH
    name: SECONDARY

  # Standalone aim point (no reference)
  - coords: "N26deg28'00\" E056deg18'00\""
    name: MANUAL-POINT
    elevation: E200FT
```

| Field | Type | Description |
|-------|------|-------------|
| `target_ref` | string | `id` of a target in `ato.targets` |
| `coords` | coord string | Position (overrides target `coords` when also using `target_ref`) |
| `name` | string | Display name (overrides target `name` when also using `target_ref`) |
| `elevation` | string | Elevation override |

#### `steer_points:` (list)

En-route waypoints plotted as hollow circles connected by dashed lines.
Each steer point can be specified with inline coordinates or by referencing a named marker
(airfield ICAO, carrier callsign, or marshal point name) via `name_ref`.

```yaml
steer_points:
  - coords: "N24deg30'00\" E056deg00'00\""
    name: SP1
  - coords: "N25deg15'00\" E056deg05'00\""
    name: SP2
  - name_ref: ALPHA        # reference a marshal point by name
    name: MARSHAL ALPHA    # optional display label (defaults to the referenced name)
```

| Field | Type | Description |
|-------|------|-------------|
| `coords` | coord string | Waypoint position (used when `name_ref` is not set) |
| `name_ref` | string | Name of an airfield (ICAO), carrier (callsign), or marshal point to use as the waypoint position |
| `name` | string | Waypoint label shown on map |

#### `control:`

| Field | Type | Description |
|-------|------|-------------|
| `primary_freq_mhz` | string | Mission primary frequency |
| `secondary_freq_mhz` | string | Mission secondary frequency |
| `net_name` | string | Net callsign |

#### `refuel:`

| Field | Type | Description |
|-------|------|-------------|
| `tanker_callsign` | string | AAR tanker callsign |
| `ar_track` | string | AR track identifier |
| `altitude` | string | Refueling altitude (e.g. `FL240`) |
| `not_earlier_than` | time string | AAR window open (NET) |
| `not_later_than` | time string | AAR window close (NLT) — shown as a hatched bar on the timeline |

---

## `aco:` — Airspace Control Order

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `operation` | string | Operation name |
| `ato_day` | string | Date this ACO applies to |
| `id` | string | ACO identifier |
| `timezone` | string | Timezone reference (display only) |
| `distributing_agency` | string | Agency responsible for distributing this ACO |
| `classification` | string | Classification marking |

### `acms:` (list)

Each ACM (Airspace Control Measure) appears as one row in the ACO table and as
one shape on the map.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | ACM identifier |
| `type` | string | `ROZ` / `ORBIT` / `MEZ` / `NFZ` / `TRA` / `ANCHOR` (drives color on map) |
| `missions` | list of strings | Mission numbers this ACM supports |
| `alt_lower` | string | Lower altitude bound (e.g. `SFC`, `FL200`) |
| `alt_upper` | string | Upper altitude bound |
| `time_from` | time string | Activation time |
| `time_to` | time string | Deactivation time |
| `control_agency` | string | Controlling agency callsign |
| `control_freq_mhz` | number | Controlling agency frequency |
| `notes` | string | Free-text notes |

#### `geometry:`

The `geometry` sub-key defines the shape drawn on the map.  Use **exactly one**
of the three shape definitions:

**Circle**
```yaml
geometry:
  center: "N35°05.098' E035°44.098'"
  radius_nm: 10
```

**Polygon** (≥ 3 points)
```yaml
geometry:
  boundary:
    - "N26°20'00\" E056°05'00\""
    - "N26°40'00\" E056°05'00\""
    - "N26°40'00\" E056°30'00\""
    - "N26°20'00\" E056°30'00\""
```

**Anchor / Racetrack** (orbit pattern)
```yaml
geometry:
  anchor_point: "N25°30'00\" E055°30'00\""
  heading_deg: 45       # hot-leg heading in degrees true
  leg_length_nm: 15     # length of each straight leg
  direction: cw         # cw (clockwise) or ccw
```

---

## `spins:` — Special Instructions

SPINS use a flexible `sections` list.  Sections can be added, removed, or
reordered freely without any code changes.

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `operation` | string | Operation name |
| `ato_day` | string | Date |
| `version` | string | SPINS version |
| `classification` | string | Classification marking |

### `sections:` (list)

Each section has a `title` and then any combination of `note`, `entries`,
and `table`.  All three are optional.

```yaml
sections:
  - title: C1 — COMMAND & CONTROL
    note: Optional single line shown at the top of the section.
    entries:
      - { label: PRIMARY AWACS, value: "MAGIC / 265.1 MHz", style: green }
      - { bullet: "Free-text bullet point" }
      - { heading: "MSN 6011" }
      - { value: Objective text shown in amber }
    table:
      headers: [COL A, COL B, COL C]
      cell_classes: [~, ~, css-class-name]
      rows:
        - [row1a, row1b, row1c]
        - [row2a, row2b, row2c]
```

#### Entry types

| Entry shape | Rendered as |
|-------------|-------------|
| `{label, value, style?}` | Key-value row.  `style` tints the value: `amber` / `red` / `green` / `blue` |
| `{bullet, style?}` | Bulleted line.  `style` tints the text: same color names as above |
| `{heading}` | Mission block header — subsequent entries are indented under it until the next `{heading}` |
| `{value}` (no `label`) | Plain objective text, shown in amber |

Coordinate strings embedded anywhere in `label`, `value`, or `bullet` text are
automatically reformatted when the coord display mode changes.

#### `table:` sub-key

| Field | Type | Description |
|-------|------|-------------|
| `headers` | list of strings | Column header labels |
| `rows` | list of lists | Table data rows |
| `cell_classes` | list | Optional CSS class per column.  Use `~` (YAML null) for columns with no class |

---

## `comms:` — Frequency Preset Table

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `operation` | string | Operation name |
| `ato_day` | string | Date |
| `classification` | string | Classification marking |
| `wing_lead` | string | Wing lead callsign (display only) |

### `uhf_presets:` and `vhf_presets:`

Both use the same format: a mapping from channel number to preset data.  Only
list channels that have assigned frequencies — the viewer automatically fills
channels 1–20 with SPARE entries for any channel not defined in the YAML.

```yaml
uhf_presets:
  1:  { callsign: GUARD,       freq_mhz: 243.000, role: Emergency }
  2:  { callsign: PACKAGE,     freq_mhz: 260.000, role: Package primary }
  3:  { callsign: INTRAFLIGHT, freq_mhz: 261.500, role: Intraflight }
```

Channel keys are integers.  Channels are sorted numerically, so any ordering
in the YAML file is accepted.

| Field | Type | Description |
|-------|------|-------------|
| `callsign` | string | Net / station callsign |
| `freq_mhz` | number or null | Frequency in MHz.  `null` marks an empty / SPARE slot |
| `role` | string or null | Free-text role description |

---

## Loadout format

The `aircraft.loadout` field uses a compact code:

```
AAA+NXcccNXccc...
│││ │ └─────── weapon groups (repeating)
│││ └───────── gun ammo present (omit if no gun)
└┴┴─────────── 3-digit air-to-air prefix
```

### Air-to-air prefix (3 digits, required)

Each digit is a **count**:

| Position | Missile type | Typical weapon |
|----------|-------------|----------------|
| Digit 1 | Fox 3 (active radar) | AIM-120 AMRAAM |
| Digit 2 | Fox 1 (semi-active radar) | AIM-7 Sparrow |
| Digit 3 | Fox 2 (IR) | AIM-9 Sidewinder |

### Weapon groups (`NXccc`)

- `N` — quantity (single digit)
- `X` — literal separator character
- `ccc` — weapon code (1–3 digits, see table below)

Groups are concatenated with no delimiter: `3X381X114` = `3×GBU-38` and
`1×AGM-114`.

### Examples

| Code | Meaning |
|------|---------|
| `501+` | 5×Fox3, 0×Fox1, 1×Fox2, gun |
| `301+3X381X114` | 3×Fox3, 0×Fox1, 1×Fox2, gun + 3×GBU-38 + 1×AGM-114 |
| `0004X114` | No AA missiles, no gun, 4×AGM-114 Hellfire |

### Weapon codes

| Code | Name | Category |
|------|------|----------|
| `62` | AGM-62 Walleye | AGM |
| `65` | AGM-65 Maverick | AGM |
| `88` | AGM-88 HARM | AGM |
| `114` | AGM-114 Hellfire | AGM |
| `122` | AGM-122 Sidearm | AGM |
| `130` | AGM-130 | AGM |
| `141` | ADM-141 TALD (decoy) | AGM |
| `154` | AGM-154 JSOW | AGM |
| `158` | AGM-158 JASSM | AGM |
| `179` | AGM-179 JAGM | AGM |
| `10` | GBU-10 Paveway II (2000 lb) | GBU |
| `12` | GBU-12 Paveway II (500 lb) | GBU |
| `16` | GBU-16 Paveway II (1000 lb) | GBU |
| `24` | GBU-24 Paveway III | GBU |
| `27` | GBU-27 Paveway III | GBU |
| `28` | GBU-28 Bunker Buster | GBU |
| `31` | GBU-31 JDAM (2000 lb) | GBU |
| `32` | GBU-32 JDAM (1000 lb) | GBU |
| `38` | GBU-38 JDAM (500 lb) | GBU |
| `39` | GBU-39 SDB | GBU |
| `54` | GBU-54 Laser JDAM | GBU |
| `87` | CBU-87 CEM Cluster | CBU |
| `97` | CBU-97 SFW Cluster | CBU |
| `99` | CBU-99 Rockeye | CBU |
| `103` | CBU-103 WCMD CEM | CBU |
| `105` | CBU-105 WCMD SFW | CBU |
| `82` | Mk 82 (500 lb) | Unguided |
| `83` | Mk 83 (1000 lb) | Unguided |
| `84` | Mk 84 (2000 lb) | Unguided |
| `20` | Mk 20 Rockeye | Unguided |
| `3` | LAU-3 (19× Hydra 70 mm) | Rockets |
| `61` | LAU-61 (19× Hydra 70 mm) | Rockets |
| `68` | LAU-68 (7× Hydra 70 mm) | Rockets |
| `131` | LAU-131 (7× Hydra 70 mm) | Rockets |

---

---

## `weather:` — Mission Weather Forecast

The weather section accepts **raw METAR and TAF strings** exactly as they
appear in a real aerodrome weather briefing.  The viewer decodes and displays
them in human-readable form on the WX tab.

```yaml
weather:
  operation: CLEAR SKY          # optional header field
  metars:
    - 'METAR OMAM 011850Z 31012G18KT 9999 FEW040 SCT080 28/08 Q1013 NOSIG'
    - 'METAR OMSJ 011850Z 28008KT 9000 SCT035 30/12 Q1012 NOSIG'
  tafs:
    - 'TAF OMAM 011700Z 0120/0206 30010KT 9999 FEW040
           BECMG 0122/0124 27008KT
           TEMPO 0200/0202 TS BKN020 4000
           PROB30 0203/0205 TSRA BKN010CB'
  mission_wx:
    - { mission_ref: MSN3266, notes: Clear at CAP. No impact. }
    - { mission_ref: AA7511,  notes: Watch for dust below 1000 ft., style: amber }
```

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `operation` | string | Operation name (display only) |
| `issued` | string | When this weather package was issued (display only) |
| `valid_from` | string | Start of the valid period (display only) |
| `valid_to` | string | End of the valid period (display only) |
| `metars` | list of strings | Raw METAR / SPECI strings — one per station |
| `tafs` | list of strings | Raw TAF strings — one per station |
| `mission_wx` | list | Mission-specific weather notes — see below |

### `metars:` — Raw METAR strings

Paste standard ICAO or US-format METAR strings verbatim.  The viewer decodes:

- **Station** — 4-letter ICAO identifier
- **Wind** — direction, speed, gusts (KT, MPS, KMH accepted)
- **Visibility** — metres (`9999`) or US statute miles (`10SM`, `1/4SM`, `M1/4SM`)
- **`CAVOK`** — Ceiling and Visibility OK
- **Present weather** — decoded from ICAO codes (see table below)
- **Sky condition / cloud layers** — `FEW`, `SCT`, `BKN`, `OVC`, `VV`, `SKC`, `CLR`, `NSC`, with altitude in hundreds of feet; `CB`/`TCU` suffixes recognised
- **Temperature / dewpoint** — `T/T` or `M01/M02` (M prefix = below zero)
- **QNH** — `Q1013` (hPa) or `A2992` (altimeter × 100, inHg)
- **NOSIG** — No significant change expected

A **flight category** badge (VFR / MVFR / IFR / LIFR) is automatically computed
from the ceiling and visibility and shown on each station header.

Examples:
```
METAR OMAM 011850Z 31012G18KT 9999 FEW040 SCT080 28/08 Q1013 NOSIG
KJFK 122151Z 25014G25KT 10SM FEW060 SCT250 22/10 A2997
EDDM 011850Z 18005KT 3000 BR FEW003 OVC005 08/07 Q1016
EGLL 232320Z VRB03KT CAVOK 15/08 Q1022 NOSIG
```

### `tafs:` — Raw TAF strings

Paste standard ICAO TAF strings verbatim.  Multi-line TAF strings work if
quoted as a YAML block scalar or a plain quoted string with spaces.  The viewer
decodes:

- **Station**, issued time, validity period
- **Prevailing (base) conditions** — same elements as METAR
- **Change groups** — decoded type label + time period + changed conditions:

| TAF keyword | Displayed as |
|-------------|-------------|
| `BECMG DDHH/DDHH` | Becoming · Day DD HH:00Z – Day DD HH:00Z |
| `TEMPO DDHH/DDHH` | Temporary · time range |
| `FM DDHHmm` | From · Day DD HH:mmZ |
| `PROBnn DDHH/DDHH` | nn% Probability · time range |
| `PROBnn TEMPO DDHH/DDHH` | nn% Probability — Temporary · time range |
| `PROBnn BECMG DDHH/DDHH` | nn% Probability — Becoming · time range |

Any `PROBnn` value is handled dynamically (PROB20, PROB30, PROB40…).

Example:
```
TAF OMAM 011700Z 0120/0206 30010KT 9999 FEW040
    BECMG 0122/0124 27008KT
    TEMPO 0200/0202 TS BKN020 4000
    PROB30 0203/0205 TSRA BKN010CB
```

### Present weather codes

The viewer decodes ICAO present weather codes to plain English.  Common codes:

| Code | Decoded |
|------|---------|
| `RA` | Rain |
| `-RA` | Light Rain |
| `+RA` | Heavy Rain |
| `SN` | Snow |
| `DZ` | Drizzle |
| `TS` | Thunderstorm |
| `TSRA` | Thunderstorm with Rain |
| `+TSRA` | Heavy Thunderstorm with Rain |
| `TSGR` | Thunderstorm with Hail |
| `FZRA` | Freezing Rain |
| `FZDZ` | Freezing Drizzle |
| `FZFG` | Freezing Fog |
| `SHRA` | Rain Showers |
| `SHSN` | Snow Showers |
| `BR` | Mist |
| `FG` | Fog |
| `BCFG` | Patchy Fog |
| `MIFG` | Shallow Fog |
| `HZ` | Haze |
| `DU` | Dust |
| `BLSN` | Blowing Snow |
| `BLDU` | Blowing Dust |
| `VCSH` | Showers in Vicinity |
| `VCTS` | Thunderstorm in Vicinity |
| `VCFG` | Fog in Vicinity |
| `SS` | Sandstorm |
| `DS` | Duststorm |
| `FC` | Funnel Cloud |

Intensity prefixes (`-` light, `+` heavy) and vicinity indicator (`VC`) are
decoded automatically for any code combination.

### `mission_wx:` — Mission-specific notes

Plain-English notes linked to missions by mission number.

| Field | Type | Description |
|-------|------|-------------|
| `mission_ref` | string | Mission number (cross-reference to ATO) |
| `notes` | string | Free-text weather note |
| `style` | string | Optional color tint: `amber` / `red` / `green` / `blue` |
