#!/usr/bin/env python3
"""Plots the (altitude, speed) -> MAR surface produced by mar-sweep.mjs.

    pip install matplotlib numpy pandas
    python3 examples/plot-mar.py mar-sweep-output.csv

In this repo's Nix devShell (`nix develop`), matplotlib/pandas/numpy are
already provided via flake.nix's pythonEnv -- no pip install needed or
wanted. `pip install` from inside a Nix Python environment often silently
fails to be importable afterward (packages install into a location the
interpreter doesn't see, or prebuilt wheels expect shared libraries a Nix
environment doesn't expose at the paths they assume); if you're not using
this repo's devShell, `nix-shell -p 'python3.withPackages (ps: with ps; [
matplotlib numpy pandas ])'` is a more reliable one-off than pip.

Produces three views of the same grid:
  - a 3D surface (the literal "3D graph" of altitude/speed -> MAR)
  - a 2D heatmap (easier to read exact values off of)
  - a 2D line plot: altitude on x, MAR on y, one line per speed (color)

Grid cells where mar-sweep.mjs found no safe z within its searched domain are
left as NaN and render as gaps rather than being silently dropped, since "no
solution found" is itself meaningful information about that (speed, altitude)
combination.
"""
import argparse

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401 -- registers the 3D projection


def pivot_grid(df):
    xs = np.sort(df['x_kt'].unique())
    ys = np.sort(df['y_ft'].unique())
    z = df.pivot(index='y_ft', columns='x_kt', values='z_nm').reindex(index=ys, columns=xs).to_numpy()
    return xs, ys, z


def plot_surface(xs, ys, z, out_path):
    x, y = np.meshgrid(xs, ys)
    fig = plt.figure(figsize=(10, 7))
    ax = fig.add_subplot(111, projection='3d')
    surf = ax.plot_surface(x, y, z, cmap='viridis', edgecolor='none')
    ax.set_xlabel('Friendly speed (kt)')
    ax.set_ylabel('Friendly altitude (ft)')
    ax.set_zlabel('Minimum Abort Range (nm)')
    ax.set_title('MAR vs. Friendly speed / altitude')
    fig.colorbar(surf, shrink=0.6, aspect=12, label='MAR (nm)')
    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path}')
    return fig


def plot_heatmap(xs, ys, z, out_path):
    fig, ax = plt.subplots(figsize=(9, 6))
    mesh = ax.pcolormesh(xs, ys, z, cmap='viridis', shading='nearest')
    ax.set_xlabel('Friendly speed (kt)')
    ax.set_ylabel('Friendly altitude (ft)')
    ax.set_title('MAR vs. Friendly speed / altitude')
    fig.colorbar(mesh, ax=ax, label='MAR (nm)')
    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path}')
    return fig


def plot_lines_by_speed(df, out_path):
    """One line per Friendly speed: altitude on x, MAR on y, speed as color.

    Speed is a continuous quantity here, not a set of categories, so it gets
    a single sequential colormap + colorbar (matching the other two plots)
    rather than a per-line legend -- reads the same way as a contour plot's
    color axis, and stays uncluttered regardless of how many distinct speeds
    are in the sweep.
    """
    speeds = np.sort(df['x_kt'].unique())
    cmap = plt.get_cmap('viridis')
    norm = plt.Normalize(vmin=speeds.min(), vmax=speeds.max())

    fig, ax = plt.subplots(figsize=(9, 6))
    for speed in speeds:
        sub = df[df['x_kt'] == speed].sort_values('y_ft')
        ax.plot(sub['y_ft'], sub['z_nm'], color=cmap(norm(speed)), linewidth=2, marker='o', markersize=4)

    ax.set_xlabel('Friendly altitude (ft)')
    ax.set_ylabel('Minimum Abort Range (nm)')
    ax.set_title('MAR vs. Friendly altitude, by speed')
    ax.grid(True, alpha=0.3)

    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    fig.colorbar(sm, ax=ax, label='Friendly speed (kt)')

    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path}')
    return fig


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('csv', help='CSV produced by mar-sweep.mjs (columns: x_kt,y_ft,z_nm)')
    ap.add_argument('--out-prefix', default='mar', help='output file prefix (default: mar -> mar-surface.png, mar-heatmap.png, mar-lines.png)')
    ap.add_argument('--no-show', action='store_true', help='skip the interactive window, just save the PNGs')
    args = ap.parse_args()

    df = pd.read_csv(args.csv)
    xs, ys, z = pivot_grid(df)
    if len(xs) < 2 or len(ys) < 2:
        print('Warning: fewer than 2 distinct x or y values -- surface/heatmap will be degenerate. '
              'Run mar-sweep.mjs with a wider grid for a real plot.')

    plot_surface(xs, ys, z, f'{args.out_prefix}-surface.png')
    plot_heatmap(xs, ys, z, f'{args.out_prefix}-heatmap.png')
    plot_lines_by_speed(df, f'{args.out_prefix}-lines.png')

    if not args.no_show:
        plt.show()


if __name__ == '__main__':
    main()
