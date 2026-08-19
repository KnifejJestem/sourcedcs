#!/usr/bin/env python3
"""Fits a smooth polynomial surface MAR ~= f(speed, altitude) to a mar-sweep.mjs CSV.

    python3 examples/fit-mar.py aim120cMAR.csv
    python3 examples/fit-mar.py aim120cMAR.csv --degree 4

Altitude is fit in thousands of feet (not raw feet) -- raw feet (up to
45000) raised to a degree-5 power overflows into numbers so large relative
to the speed terms that the least-squares fit becomes poorly conditioned;
thousands of feet keeps both axes in comparable, well-conditioned magnitude
without changing what the fit represents.

Tries every degree from 1 to --max-degree (default 5), reports R^2 / RMSE /
max error for each so you can see where the fit stops actually improving
(a real kink -- e.g. from the OUT/COLD altitude targets -- won't smooth out
just by raising the degree; the table makes that visible instead of hiding
it), then prints the full formula for the chosen degree (best R^2 by
default) and saves a fit-vs-actual comparison plot.
"""
import argparse

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

ALT_SCALE = 1000.0  # fit altitude in kft, not ft -- see module docstring


def poly_terms(degree):
    """(i, j) exponent pairs for every speed^i * alt_kft^j term with i+j <= degree."""
    return [(i, total - i) for total in range(degree + 1) for i in range(total + 1)]


def design_matrix(speed, alt_kft, degree):
    terms = poly_terms(degree)
    return np.column_stack([speed**i * alt_kft**j for i, j in terms]), terms


def fit(speed, alt_kft, z, degree):
    A, terms = design_matrix(speed, alt_kft, degree)
    coeffs, *_ = np.linalg.lstsq(A, z, rcond=None)
    pred = A @ coeffs
    resid = z - pred
    ss_res = np.sum(resid**2)
    ss_tot = np.sum((z - z.mean())**2)
    r2 = 1 - ss_res / ss_tot
    rmse = np.sqrt(np.mean(resid**2))
    max_err = np.max(np.abs(resid))
    return coeffs, terms, r2, rmse, max_err


def format_formula(coeffs, terms, threshold=1e-9):
    parts = []
    for c, (i, j) in zip(coeffs, terms):
        if abs(c) < threshold:
            continue
        term = ''
        if i > 0:
            term += 'speed' if i == 1 else f'speed^{i}'
        if j > 0:
            term += ('*' if term else '') + ('alt_kft' if j == 1 else f'alt_kft^{j}')
        parts.append(f'{c:+.6g}' + (f'*{term}' if term else ''))
    return 'MAR_nm(speed_kt, alt_ft) = ' + ' '.join(parts) + '   [alt_kft = alt_ft / 1000]'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('csv', help='CSV produced by mar-sweep.mjs (columns: x_kt,y_ft,z_nm)')
    ap.add_argument('--max-degree', type=int, default=5, help='highest degree to try (default 5)')
    ap.add_argument('--degree', type=int, default=None, help='force this degree instead of auto-picking the best R^2 up to --max-degree')
    ap.add_argument('--out-prefix', default='mar-fit', help='output plot prefix (default: mar-fit -> mar-fit-degreeN.png)')
    ap.add_argument('--no-show', action='store_true', help='skip the interactive window, just save the PNG')
    args = ap.parse_args()

    df = pd.read_csv(args.csv).dropna(subset=['z_nm'])
    speed = df['x_kt'].to_numpy(float)
    alt_kft = df['y_ft'].to_numpy(float) / ALT_SCALE
    z = df['z_nm'].to_numpy(float)

    print(f'{len(df)} points loaded ({df["x_kt"].nunique()} speeds x {df["y_ft"].nunique()} altitudes)\n')
    print(f'{"degree":>6} {"R^2":>10} {"RMSE (nm)":>10} {"max err (nm)":>13}')
    results = {}
    for d in range(1, args.max_degree + 1):
        results[d] = fit(speed, alt_kft, z, d)
        _, _, r2, rmse, max_err = results[d]
        print(f'{d:>6} {r2:>10.5f} {rmse:>10.3f} {max_err:>13.3f}')

    degree = args.degree or max(results, key=lambda d: results[d][2])
    coeffs, terms, r2, rmse, max_err = results[degree]
    print(f'\nUsing degree {degree} (R^2={r2:.5f}, RMSE={rmse:.3f}nm, max err={max_err:.3f}nm)\n')
    print(format_formula(coeffs, terms))

    # Fit-vs-actual: same per-speed line layout as plot-mar.py's lines plot --
    # dots are the real sweep data, solid lines are this polynomial's
    # prediction along the same altitude range, same color per speed.
    speeds_u = np.sort(df['x_kt'].unique())
    cmap = plt.get_cmap('viridis')
    norm = plt.Normalize(vmin=speeds_u.min(), vmax=speeds_u.max())
    fig, ax = plt.subplots(figsize=(9, 6))
    for s in speeds_u:
        sub = df[df['x_kt'] == s].sort_values('y_ft')
        color = cmap(norm(s))
        ax.plot(sub['y_ft'], sub['z_nm'], 'o', color=color, markersize=3, alpha=0.5)
        yy_kft = sub['y_ft'].to_numpy(float) / ALT_SCALE
        A, _ = design_matrix(np.full_like(yy_kft, s), yy_kft, degree)
        ax.plot(sub['y_ft'], A @ coeffs, '-', color=color, linewidth=1.5)
    ax.set_xlabel('Friendly altitude (ft)')
    ax.set_ylabel('Minimum Abort Range (nm)')
    ax.set_title(f'MAR: degree-{degree} polynomial fit (lines) vs. actual data (dots)')
    ax.grid(True, alpha=0.3)
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    fig.colorbar(sm, ax=ax, label='Friendly speed (kt)')

    out_path = f'{args.out_prefix}-degree{degree}.png'
    fig.savefig(out_path, dpi=150)
    print(f'\nSaved {out_path}')
    if not args.no_show:
        plt.show()


if __name__ == '__main__':
    main()
