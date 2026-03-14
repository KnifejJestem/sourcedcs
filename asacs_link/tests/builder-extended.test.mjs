/**
 * tests/builder-extended.test.mjs
 *
 * Extended tests for builder.js covering:
 *   - buildLabels() label-offset (draggable label) feature
 *     (offsets are now relative [deltaLon, deltaLat] from the unit position)
 *   - buildLeaderLines() leader-line feature
 *   - exported colour constants (COLOUR_BANDIT, COLOUR_HOSTILE)
 *   - 3D altitude coordinates in buildBlips()
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBlips, buildLabels, buildLeaderLines, COLOUR_BANDIT, COLOUR_HOSTILE,
  bearingDeg, distNm,
} from '../public/js/display/builder.js';

describe('buildLabels with offsets', () => {
  it('uses default position when no offset is provided', () => {
    const contacts = [{
      id: 1, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      pilotName: 'HAWK 1',
      alt: 6096, gs: 350,
    }];
    const fc = buildLabels(contacts, new Map());
    const [lon, lat] = fc.features[0].geometry.coordinates;
    assert.equal(lon, 38.0);
    assert.equal(lat, 35.0);
  });

  it('applies delta offset — label at unit + [dLon, dLat]', () => {
    const contacts = [{
      id: 2, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      pilotName: 'HAWK 2',
      alt: 6096, gs: 350,
    }];
    // delta of +2° lon, +2° lat → label should be at [40.0, 37.0]
    const offsets = new Map([['2', [2.0, 2.0]]]);
    const fc = buildLabels(contacts, offsets);
    const [lon, lat] = fc.features[0].geometry.coordinates;
    assert.equal(lon, 40.0, 'lon should be unit.lon + delta.lon');
    assert.equal(lat, 37.0, 'lat should be unit.lat + delta.lat');
  });

  it('sets hasOffset=1 in properties when a delta is present', () => {
    const contacts = [{
      id: 2, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      pilotName: 'HAWK 2',
    }];
    const offsets = new Map([['2', [1.0, 0.5]]]);
    const fc = buildLabels(contacts, offsets);
    assert.equal(fc.features[0].properties.hasOffset, 1);
  });

  it('sets hasOffset=0 in properties when no delta is present', () => {
    const contacts = [{
      id: 3, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      pilotName: 'HAWK 3',
    }];
    const fc = buildLabels(contacts, new Map());
    assert.equal(fc.features[0].properties.hasOffset, 0);
  });

  it('unit position unchanged when offset map does not contain the unit id', () => {
    const contacts = [{
      id: 3, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      pilotName: 'HAWK 3',
      alt: 6096, gs: 350,
    }];
    const offsets = new Map([['999', [2.0, 2.0]]]); // different ID
    const fc = buildLabels(contacts, offsets);
    const [lon, lat] = fc.features[0].geometry.coordinates;
    assert.equal(lon, 38.0);
    assert.equal(lat, 35.0);
  });

  it('works when offsets parameter is omitted', () => {
    const contacts = [{
      id: 4, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      pilotName: 'HAWK 4',
      alt: 6096, gs: 350,
    }];
    const fc = buildLabels(contacts); // no offsets argument
    const [lon, lat] = fc.features[0].geometry.coordinates;
    assert.equal(lon, 38.0);
    assert.equal(lat, 35.0);
  });
});

describe('buildLeaderLines', () => {
  it('returns an empty FeatureCollection when offsets map is empty', () => {
    const contacts = [{ id: 1, lat: 35.0, lon: 38.0, coalition: 2, contactType: 'track' }];
    const fc = buildLeaderLines(contacts, new Map());
    assert.equal(fc.type, 'FeatureCollection');
    assert.equal(fc.features.length, 0);
  });

  it('returns an empty FeatureCollection when offsets parameter is omitted', () => {
    const contacts = [{ id: 1, lat: 35.0, lon: 38.0, coalition: 2, contactType: 'track' }];
    const fc = buildLeaderLines(contacts);
    assert.equal(fc.features.length, 0);
  });

  it('produces a line from unit position to label position when offset exists', () => {
    const contacts = [{
      id: 1, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      alt: 6096,
    }];
    const offsets = new Map([['1', [2.0, 2.0]]]);
    const fc = buildLeaderLines(contacts, offsets);
    assert.equal(fc.features.length, 1);
    const coords = fc.features[0].geometry.coordinates;
    assert.equal(coords.length, 2, 'LineString should have 2 coordinate pairs');
    // Start: unit position
    assert.equal(coords[0][0], 38.0, 'start lon should be unit.lon');
    assert.equal(coords[0][1], 35.0, 'start lat should be unit.lat');
    // End: unit position + delta
    assert.equal(coords[1][0], 40.0, 'end lon should be unit.lon + delta.lon');
    assert.equal(coords[1][1], 37.0, 'end lat should be unit.lat + delta.lat');
  });

  it('does not produce a line for units not in the offset map', () => {
    const contacts = [
      { id: 1, lat: 35.0, lon: 38.0, coalition: 2, contactType: 'track' },
      { id: 2, lat: 36.0, lon: 39.0, coalition: 2, contactType: 'track' },
    ];
    const offsets = new Map([['1', [1.0, 1.0]]]); // only unit 1
    const fc = buildLeaderLines(contacts, offsets);
    assert.equal(fc.features.length, 1);
    assert.equal(fc.features[0].properties.id, '1');
  });

  it('carries coalition colour in feature properties', () => {
    const contacts = [{ id: 1, lat: 35.0, lon: 38.0, coalition: 2, contactType: 'track' }];
    const offsets = new Map([['1', [1.0, 0.5]]]);
    const fc = buildLeaderLines(contacts, offsets);
    assert.match(fc.features[0].properties.colour, /^#[0-9a-fA-F]{6}$/);
  });

  it('uses unit altitude as z-coordinate in both line endpoints', () => {
    const contacts = [{ id: 1, lat: 35.0, lon: 38.0, coalition: 2, contactType: 'track', alt: 6096 }];
    const offsets = new Map([['1', [1.0, 0.5]]]);
    const fc = buildLeaderLines(contacts, offsets);
    const coords = fc.features[0].geometry.coordinates;
    assert.equal(coords[0][2], 6096);
    assert.equal(coords[1][2], 6096);
  });

  it('defaults z-coordinate to 0 when unit has no alt', () => {
    const contacts = [{ id: 1, lat: 35.0, lon: 38.0, coalition: 2, contactType: 'track' }];
    const offsets = new Map([['1', [0.5, 0.5]]]);
    const fc = buildLeaderLines(contacts, offsets);
    const coords = fc.features[0].geometry.coordinates;
    assert.equal(coords[0][2], 0);
    assert.equal(coords[1][2], 0);
  });
});

describe('exported colour constants', () => {
  it('COLOUR_BANDIT is a red hex colour', () => {
    assert.match(COLOUR_BANDIT,  /^#[0-9a-fA-F]{6}$/);
    // Red component should be dominant
    const r = parseInt(COLOUR_BANDIT.slice(1, 3), 16);
    const g = parseInt(COLOUR_BANDIT.slice(3, 5), 16);
    assert.ok(r > g, 'bandit colour should be reddish');
  });

  it('COLOUR_HOSTILE is an amber/orange hex colour', () => {
    assert.match(COLOUR_HOSTILE, /^#[0-9a-fA-F]{6}$/);
    const r = parseInt(COLOUR_HOSTILE.slice(1, 3), 16);
    const g = parseInt(COLOUR_HOSTILE.slice(3, 5), 16);
    const b = parseInt(COLOUR_HOSTILE.slice(5, 7), 16);
    // Orange: high red, medium green, low blue
    assert.ok(r > g, 'hostile colour red should exceed green');
    assert.ok(g > b, 'hostile colour green should exceed blue');
  });
});

describe('buildBlips 3D coordinates', () => {
  it('includes altitude as third coordinate element', () => {
    const contacts = [{ id: 1, lat: 35.0, lon: 38.0, alt: 6096, coalition: 2, contactType: 'track' }];
    const fc = buildBlips(contacts);
    assert.equal(fc.features[0].geometry.coordinates[2], 6096);
  });

  it('defaults altitude to 0 when unit has no alt field', () => {
    const contacts = [{ id: 2, lat: 35.0, lon: 38.0, coalition: 2, contactType: 'primary' }];
    const fc = buildBlips(contacts);
    assert.equal(fc.features[0].geometry.coordinates[2], 0);
  });

  it('includes declaration in feature properties', () => {
    const contacts = [{
      id: 3, lat: 35.0, lon: 38.0,
      coalition: 1, contactType: 'track',
      declaration: 'bandit',
    }];
    const fc = buildBlips(contacts);
    assert.equal(fc.features[0].properties.declaration, 'bandit');
  });

  it('declaration defaults to empty string when not provided', () => {
    const contacts = [{ id: 4, lat: 35.0, lon: 38.0, coalition: 2, contactType: 'track' }];
    const fc = buildBlips(contacts);
    assert.equal(fc.features[0].properties.declaration, '');
  });
});

// ── bearingDeg ────────────────────────────────────────────────

describe('bearingDeg', () => {
  it('due north: bearing = 0°', () => {
    // Moving north: lat increases, lon unchanged
    const b = bearingDeg(0, 0, 1, 0);
    assert.ok(Math.abs(b - 0) < 0.01 || Math.abs(b - 360) < 0.01,
      `expected ~0°, got ${b}`);
  });

  it('due east: bearing = 90°', () => {
    const b = bearingDeg(0, 0, 0, 1);
    assert.ok(Math.abs(b - 90) < 0.01, `expected ~90°, got ${b}`);
  });

  it('due south: bearing = 180°', () => {
    const b = bearingDeg(1, 0, 0, 0);
    assert.ok(Math.abs(b - 180) < 0.01, `expected ~180°, got ${b}`);
  });

  it('due west: bearing = 270°', () => {
    const b = bearingDeg(0, 1, 0, 0);
    assert.ok(Math.abs(b - 270) < 0.01, `expected ~270°, got ${b}`);
  });

  it('always returns a value in [0, 360)', () => {
    const cases = [
      [35, 38, 36, 37],
      [35, 38, 34, 39],
      [35, 38, 34, 37],
      [35, 38, 36, 39],
    ];
    for (const [lat1, lon1, lat2, lon2] of cases) {
      const b = bearingDeg(lat1, lon1, lat2, lon2);
      assert.ok(b >= 0 && b < 360, `bearing ${b} outside [0,360) for ${[lat1,lon1,lat2,lon2]}`);
    }
  });

  it('reciprocal bearing differs by 180°', () => {
    const b1 = bearingDeg(35, 38, 36, 39);
    const b2 = bearingDeg(36, 39, 35, 38);
    const diff = Math.abs((b1 - b2 + 360) % 360 - 180);
    assert.ok(diff < 1, `reciprocal bearing difference ${diff}° exceeds 1°`);
  });
});

// ── distNm ────────────────────────────────────────────────────

describe('distNm', () => {
  it('same point returns 0 NM', () => {
    assert.ok(distNm(35, 38, 35, 38) < 1e-9);
  });

  it('1° of latitude ≈ 60 NM at the equator', () => {
    // Exact value varies slightly with Earth-radius model; allow ±1 NM
    const d = distNm(0, 0, 1, 0);
    assert.ok(Math.abs(d - 60) < 1, `expected ~60 NM, got ${d.toFixed(2)}`);
  });

  it('distance is symmetric (A→B equals B→A)', () => {
    const d1 = distNm(35, 38, 36, 39);
    const d2 = distNm(36, 39, 35, 38);
    assert.ok(Math.abs(d1 - d2) < 1e-9, `d(A→B)=${d1} ≠ d(B→A)=${d2}`);
  });

  it('larger separation gives greater distance', () => {
    const dSmall = distNm(35, 38, 35.1, 38.1);
    const dLarge = distNm(35, 38, 36.0, 39.0);
    assert.ok(dLarge > dSmall, 'larger angular separation should give greater NM');
  });

  it('returns a positive value for distinct points', () => {
    assert.ok(distNm(35, 38, 36, 39) > 0);
  });
});
