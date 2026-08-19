# Examples

Headless usage of the simulator — no browser, no server. Run from the
`missile_simulation/` folder (paths are relative to it).

## `headless-engagement.mjs`

Runs one engagement (built-in AIM-120C, a simple head-on setup) and prints
both aircraft's flight paths and the missile's flyout summary. Shows the
basic pattern: `missileFromJson()` to load a weapon, plain objects for the
shooter/target config, `runEngagement()` to resolve it.

```bash
node examples/headless-engagement.mjs
```

## `mar-sweep.mjs`

Computes a grid of **Minimum Abort Range** (MAR): for each Friendly
(speed, altitude), the smallest range at which Friendly must break into a
defensive OUT maneuver to guarantee a Hostile missile misses. Two modes:

- `--mirror-hostile` — **classic MAR**: Hostile always flies at exactly
  Friendly's own speed/altitude, only its launch range varies. Much faster
  (the hostile speed x altitude grid is by far the biggest cost factor), and
  the standard textbook MAR definition.
- (default, no flag) — **full search**: Hostile's speed, altitude, *and*
  launch range all vary independently, so the result holds no matter the
  Hostile's settings, not just a mirrored one. Meaningfully slower.

```bash
# classic MAR (Hostile mirrors Friendly's own speed/altitude) -- fast
node examples/mar-sweep.mjs --x-step 50 --y-step 2000 --mirror-hostile --out mar-classic.csv

# full worst-case search (Hostile's speed/altitude/launch-range all vary
# independently) -- much slower, but answers "no matter the Hostile's
# settings" literally
node examples/mar-sweep.mjs \
  --x-min 400 --x-max 800 --x-step 25 \
  --y-min 1000 --y-max 45000 --y-step 2000 \
  --workers 8 \
  --out mar-full.csv
```

Full flag reference:

```bash
node examples/mar-sweep.mjs --help
```

Notes:
- Progress and the resolved config are logged to **stderr**; results stream
  to the CSV (`--out`) as each `(x, y)` point finishes, so you can `tail -f`
  the CSV or watch stderr during a long run.
- `--workers N` shards the outer `(x, y)` grid across `N` Node
  `worker_threads` — set it to your core count.
- Cost scales with `(x,y) points × binary-search iterations × r-steps ×
  hostile-speed-steps × hostile-alt-steps`. If a full-resolution run is too
  slow, coarsen `--hostile-speed-step` / `--hostile-alt-step` first — they
  don't need to match the outer grid's resolution.
- `--r-max` is only a **starting guess** for how far out a Hostile launch
  might reach, not a hard limit — a safe z always exists eventually (far
  enough out, no missile can reach), so if the starting guess turns out too
  small the search doubles it automatically (up to `--r-max-hard-cap`,
  default 300nm) until it finds one. A blank `z_nm` cell means even that hard
  cap wasn't enough, which is a genuine "investigate this point" signal, not
  a normal "bump --r-max" one. Points that needed to expand cost more time
  (each doubling re-searches a wider r range), so a run with a
  too-conservative starting `--r-max` will just be slower on the affected
  points, not wrong.

## `plot-mar.py`

Turns `mar-sweep.mjs`'s CSV into three views of the same grid:
- `-surface.png` — 3D surface (altitude, speed) -> MAR
- `-heatmap.png` — same data as a 2D heatmap, easier to read exact values off of
- `-lines.png` — 2D: altitude on x, MAR on y, one line per speed (colored)

```bash
# in this repo's nix devShell (flake.nix already provides matplotlib/pandas/numpy):
nix develop
python3 examples/plot-mar.py mar-full.csv
# writes mar-surface.png, mar-heatmap.png, mar-lines.png; add --no-show to
# skip the interactive window (e.g. over SSH), or --out-prefix to rename
```

Outside this repo's nix shell, `pip install matplotlib numpy pandas` works on
a normal Python setup, but not reliably from a Nix environment — see the note
at the top of `plot-mar.py` if `pip install` can't find the packages
afterward.
