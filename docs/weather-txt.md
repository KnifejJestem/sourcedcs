# weather.txt — Supplemental Weather Data

When converting a DCS `.miz` mission to a YAML package with the `miztoyaml`
tool, you can provide a `weather.txt` file in the **same directory** as the
`.miz` file to add real-world or custom METAR and TAF strings to the weather
section of your package.

These supplement the METAR that `miztoyaml` auto-generates from the DCS
in-game weather settings, giving you additional station reports and terminal
forecasts.

---

## File Location

Place `weather.txt` next to your `.miz` file:

```
my_mission/
├── my_mission.miz
├── weather.txt        ← additional METAR / TAF data
└── spins.md           ← optional SPINS markdown
```

The tool automatically detects and loads `weather.txt` during extraction.

---

## Format

Each line in `weather.txt` is parsed independently:

| Line prefix | Collected as |
|-------------|-------------|
| `METAR `    | Added to `weather.metars` list |
| `SPECI `    | Added to `weather.metars` list (special observation) |
| `TAF `      | Added to `weather.tafs` list |
| *(other)*   | Ignored |

- Blank lines are ignored.
- Prefix matching is **case-insensitive** (e.g. `metar`, `Metar`, `METAR` all work).
- Each METAR / TAF entry must be on a **single line** (multi-line TAFs should
  be joined).

---

## Example `weather.txt`

```
METAR OMAM 011850Z 31012G18KT 9999 FEW040 SCT080 28/08 Q1013 NOSIG
METAR LTAG 011900Z 22008KT 9999 SCT030 22/12 Q1015 NOSIG
METAR OMDM 011830Z 27006KT CAVOK 32/12 Q1012 NOSIG
TAF OMAM 011700Z 0120/0206 30010KT 9999 FEW040 BECMG 0122/0124 27008KT TEMPO 0200/0202 TS BKN020 4000
TAF LTAG 011800Z 0118/0218 24008KT 9999 SCT030 BECMG 0200/0202 18005KT
SPECI OMAM 012030Z 28018G28KT 5000 TSRA BKN015CB 26/22 Q1010
```

---

## METAR Format Reference

A standard ICAO METAR string follows this structure:

```
METAR ICAO DDHHmmZ dddssGggKT VVVV [weather] [clouds] TT/DD Qhhhh [remarks]
```

| Field | Example | Meaning |
|-------|---------|---------|
| `ICAO` | `OMAM` | 4-letter station identifier |
| `DDHHmmZ` | `011850Z` | Day, hour, minute (Zulu) |
| `dddssGggKT` | `31012G18KT` | Wind direction, speed, gust (knots) |
| `VVVV` | `9999` | Visibility in metres (`9999` = 10 km+) |
| Weather | `TSRA`, `BR`, `FG` | Present weather codes (optional) |
| Clouds | `FEW040 SCT080` | Cloud layers: coverage + altitude (hundreds of feet) |
| `TT/DD` | `28/08` | Temperature / dewpoint (°C, `M` prefix = below zero) |
| `Qhhhh` | `Q1013` | QNH in hPa (or `A2992` for altimeter in inHg) |
| `NOSIG` | | No significant change expected |

**US format** is also accepted:
```
KJFK 122151Z 25014G25KT 10SM FEW060 SCT250 22/10 A2997
```

---

## TAF Format Reference

A standard ICAO TAF string follows this structure:

```
TAF ICAO DDHHmmZ DDHH/DDHH dddssKT VVVV [clouds] [change groups...]
```

| Field | Example | Meaning |
|-------|---------|---------|
| `ICAO` | `OMAM` | Station identifier |
| `DDHHmmZ` | `011700Z` | Issued time |
| `DDHH/DDHH` | `0120/0206` | Validity period (day+hour / day+hour) |
| Base conditions | `30010KT 9999 FEW040` | Prevailing wind, visibility, clouds |

**Change groups** (appended on the same line):

| Keyword | Meaning |
|---------|---------|
| `BECMG DDHH/DDHH` | Gradual change during period |
| `TEMPO DDHH/DDHH` | Temporary fluctuations during period |
| `FM DDHHmm` | Permanent change from this time |
| `PROBnn DDHH/DDHH` | Probability (e.g. `PROB30`) |

---

## Common Weather Codes

| Code | Meaning |
|------|---------|
| `RA` | Rain |
| `-RA` | Light rain |
| `+RA` | Heavy rain |
| `TSRA` | Thunderstorm with rain |
| `SN` | Snow |
| `DZ` | Drizzle |
| `BR` | Mist |
| `FG` | Fog |
| `HZ` | Haze |
| `DU` | Dust |
| `CAVOK` | Ceiling and Visibility OK |

## Cloud Coverage

| Code | Coverage |
|------|----------|
| `FEW` | 1–2 oktas |
| `SCT` | 3–4 oktas (scattered) |
| `BKN` | 5–7 oktas (broken) |
| `OVC` | 8 oktas (overcast) |
| `SKC` / `CLR` | Sky clear |

The number after the coverage code is the cloud base altitude in **hundreds
of feet** (e.g. `SCT030` = scattered at 3 000 ft).

---

## How It Works

1. Run `miztoyaml` on your `.miz` file:
   ```bash
   python3 -m tools.miztoyaml my_mission.miz
   ```
2. The tool generates a METAR from the DCS in-game weather settings.
3. If `weather.txt` exists next to the `.miz`, its METAR/TAF lines are
   **appended** to the generated weather section.
4. The resulting YAML `weather:` block contains all METARs and TAFs:
   ```yaml
   weather:
     metars:
       - "METAR XXXX 010000Z 27008KT 9999 FEW040 15/00 Q1013 NOSIG"   # auto-generated
       - "METAR OMAM 011850Z 31012G18KT 9999 FEW040 SCT080 28/08 Q1013 NOSIG"  # from weather.txt
       - "METAR LTAG 011900Z 22008KT 9999 SCT030 22/12 Q1015 NOSIG"            # from weather.txt
     tafs:
       - "TAF OMAM 011700Z 0120/0206 30010KT 9999 FEW040 BECMG 0122/0124 27008KT"
   ```
5. The ATO BRIEF weather tab displays all stations with decoded conditions,
   flight category badges (VFR / MVFR / IFR / LIFR), and TAF change groups.
