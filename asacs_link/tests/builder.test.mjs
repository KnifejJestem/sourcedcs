/**
 * tests/builder.test.mjs
 *
 * Unit tests for the display/builder.js GeoJSON FeatureCollection builders.
 *
 * Run with:  node --test tests/
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBlips,
  buildHeadingTicks,
  buildTrails,
  buildLabels,
  HISTORY_MAX,
} from '../public/js/display/builder.js';

// ── buildBlips ────────────────────────────────────────────────

describe('buildBlips', () => {
  it('returns a FeatureCollection', () => {
    const fc = buildBlips([]);
    assert.equal(fc.type, 'FeatureCollection');
    assert.ok(Array.isArray(fc.features));
  });

  it('blue force primary radar contact: correct colour and isPrimary flag', () => {
    const contacts = [
      { id: 1, lat: 35.0, lon: 38.0, coalition: 2, contactType: 'primary' },
    ];
    const fc = buildBlips(contacts);
    assert.equal(fc.features.length, 1);
    const f = fc.features[0];
    assert.equal(f.geometry.type, 'Point');
    // Coordinates are [lon, lat, alt] — alt defaults to 0 when absent
    assert.equal(f.geometry.coordinates[0], 38.0);
    assert.equal(f.geometry.coordinates[1], 35.0);
    assert.equal(f.geometry.coordinates[2], 0);
    assert.equal(f.properties.colour,    '#4fc3f7', 'blue force should use blue colour');
    assert.equal(f.properties.isPrimary, 1,         'primary contact should have isPrimary=1');
  });

  it('red force datalink track: correct colour and isPrimary flag', () => {
    const contacts = [
      { id: 2, lat: 35.0, lon: 38.0, coalition: 1, contactType: 'track' },
    ];
    const fc = buildBlips(contacts);
    assert.equal(fc.features.length, 1);
    const f = fc.features[0];
    assert.equal(f.properties.colour,    '#ef5350', 'red force should use red colour');
    assert.equal(f.properties.isPrimary, 0,         'track should have isPrimary=0');
  });

  it('red force track is visually distinct from blue force primary (colour and isPrimary differ)', () => {
    const blueContacts = [{ id: 1, lat: 35, lon: 38, coalition: 2, contactType: 'primary' }];
    const redContacts  = [{ id: 2, lat: 35, lon: 38, coalition: 1, contactType: 'track'   }];
    const blueF = buildBlips(blueContacts).features[0];
    const redF  = buildBlips(redContacts).features[0];
    assert.notEqual(blueF.properties.colour,    redF.properties.colour);
    assert.notEqual(blueF.properties.isPrimary, redF.properties.isPrimary);
  });

  it('unknown / neutral coalition uses unknown colour', () => {
    const contacts = [{ id: 3, lat: 35, lon: 38, coalition: 0, contactType: 'primary' }];
    const fc = buildBlips(contacts);
    assert.equal(fc.features[0].properties.colour, '#aaaaaa');
  });

  it('skips contacts with missing lat or lon', () => {
    const contacts = [
      { id: 4, lat: null, lon: 38,   coalition: 2, contactType: 'track' },
      { id: 5, lat: 35,   lon: null, coalition: 2, contactType: 'track' },
      { id: 6, lat: 35,   lon: 38,   coalition: 2, contactType: 'track' },
    ];
    const fc = buildBlips(contacts);
    assert.equal(fc.features.length, 1);
    assert.equal(fc.features[0].properties.id, '6');
  });
});

// ── buildHeadingTicks ─────────────────────────────────────────

describe('buildHeadingTicks', () => {
  // Use the equator (lat=0) and zoom=8 for simple, predictable values.
  // At lat=0: cos(0)=1, so metersPerPixel = 156543.03392 / 256 ≈ 611.5
  const ZOOM = 8;
  const LAT  = 0;
  const LON  = 0;

  it('returns a FeatureCollection', () => {
    const fc = buildHeadingTicks([], ZOOM);
    assert.equal(fc.type, 'FeatureCollection');
  });

  it('heading 0° (north): lat increases, lon unchanged', () => {
    const contacts = [{ id: 1, lat: LAT, lon: LON, coalition: 2, contactType: 'track', hdg: 0 }];
    const fc = buildHeadingTicks(contacts, ZOOM);
    assert.equal(fc.features.length, 1);
    const [[sLon, sLat], [eLon, eLat]] = fc.features[0].geometry.coordinates;
    assert.equal(sLon, LON);
    assert.equal(sLat, LAT);
    assert.ok(eLat > LAT,                        `north tick: eLat ${eLat} should be > ${LAT}`);
    assert.ok(Math.abs(eLon - LON) < 1e-9,       `north tick: eLon ${eLon} should equal ${LON}`);
  });

  it('heading 90° (east): lon increases, lat unchanged', () => {
    const contacts = [{ id: 2, lat: LAT, lon: LON, coalition: 2, contactType: 'track', hdg: 90 }];
    const fc = buildHeadingTicks(contacts, ZOOM);
    const [[sLon, sLat], [eLon, eLat]] = fc.features[0].geometry.coordinates;
    assert.ok(eLon > sLon,                        `east tick: eLon ${eLon} should be > ${sLon}`);
    assert.ok(Math.abs(eLat - sLat) < 1e-9,      `east tick: eLat ${eLat} should equal ${sLat}`);
  });

  it('heading 180° (south): lat decreases, lon unchanged', () => {
    const contacts = [{ id: 3, lat: LAT, lon: LON, coalition: 2, contactType: 'track', hdg: 180 }];
    const fc = buildHeadingTicks(contacts, ZOOM);
    const [[, sLat], [eLon, eLat]] = fc.features[0].geometry.coordinates;
    assert.ok(eLat < sLat,                        `south tick: eLat ${eLat} should be < ${sLat}`);
    assert.ok(Math.abs(eLon - LON) < 1e-9,        `south tick: eLon ${eLon} should equal ${LON}`);
  });

  it('heading 270° (west): lon decreases, lat unchanged', () => {
    const contacts = [{ id: 4, lat: LAT, lon: LON, coalition: 2, contactType: 'track', hdg: 270 }];
    const fc = buildHeadingTicks(contacts, ZOOM);
    const [[sLon, sLat], [eLon, eLat]] = fc.features[0].geometry.coordinates;
    assert.ok(eLon < sLon,                        `west tick: eLon ${eLon} should be < ${sLon}`);
    assert.ok(Math.abs(eLat - sLat) < 1e-9,      `west tick: eLat ${eLat} should equal ${sLat}`);
  });

  it('skips contacts with no heading (primary radar contacts)', () => {
    const contacts = [{ id: 5, lat: 35, lon: 38, coalition: 2, contactType: 'primary' }];
    const fc = buildHeadingTicks(contacts, ZOOM);
    assert.equal(fc.features.length, 0);
  });

  it('tick length scales with zoom (higher zoom → shorter tick in degrees)', () => {
    const c = { id: 6, lat: LAT, lon: LON, coalition: 2, contactType: 'track', hdg: 0 };
    const fcZ5  = buildHeadingTicks([c], 5);
    const fcZ10 = buildHeadingTicks([c], 10);
    const dLatZ5  = fcZ5.features[0].geometry.coordinates[1][1];
    const dLatZ10 = fcZ10.features[0].geometry.coordinates[1][1];
    assert.ok(dLatZ5 > dLatZ10, 'lower zoom should produce longer tick in degrees');
  });
});

// ── buildTrails ───────────────────────────────────────────────

describe('buildTrails', () => {
  it('returns a FeatureCollection', () => {
    const fc = buildTrails([], new Map());
    assert.equal(fc.type, 'FeatureCollection');
  });

  it('no trail for contact with no history entry', () => {
    const contacts = [{ id: 1, lat: 35, lon: 38, coalition: 2, contactType: 'track' }];
    const fc = buildTrails(contacts, new Map());
    assert.equal(fc.features.length, 0);
  });

  it('no trail for contact with exactly 1 history position', () => {
    const contacts = [{ id: 2, lat: 35, lon: 38, coalition: 2, contactType: 'track' }];
    const history  = new Map([['2', [[38.0, 35.0]]]]);
    const fc = buildTrails(contacts, history);
    assert.equal(fc.features.length, 0, 'fewer than 2 positions should not produce a trail');
  });

  it('trail produced for contact with ≥ 2 history positions', () => {
    const positions = [[38.0, 35.0], [38.1, 35.1], [38.2, 35.2]];
    const contacts  = [{ id: 3, lat: 35.2, lon: 38.2, coalition: 1, contactType: 'track' }];
    const history   = new Map([['3', positions]]);
    const fc = buildTrails(contacts, history);
    assert.equal(fc.features.length, 1);
    const f = fc.features[0];
    assert.equal(f.geometry.type, 'LineString');
    assert.deepEqual(f.geometry.coordinates, positions);
    assert.equal(f.properties.colour, '#ef5350', 'red force trail should be red');
  });

  it('trail coordinates are a copy (mutation of original does not affect result)', () => {
    const positions = [[38.0, 35.0], [38.1, 35.1]];
    const contacts  = [{ id: 4, lat: 35.1, lon: 38.1, coalition: 2, contactType: 'track' }];
    const history   = new Map([['4', positions]]);
    const fc = buildTrails(contacts, history);
    positions.push([38.2, 35.2]);
    // The feature's coordinates should still be the original 2 points
    assert.equal(fc.features[0].geometry.coordinates.length, 2);
  });

  it('HISTORY_MAX is 30', () => {
    assert.equal(HISTORY_MAX, 30);
  });
});

// ── buildLabels ───────────────────────────────────────────────

describe('buildLabels', () => {
  it('returns a FeatureCollection', () => {
    const fc = buildLabels([]);
    assert.equal(fc.type, 'FeatureCollection');
  });

  it('track label includes callsign, FL altitude, and speed in knots', () => {
    const contacts = [{
      id: 1, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      pilotName: 'VIPER 1',
      alt: 6096,   // 6096 m × 3.28084 ≈ 20000 ft → FL200
      gs:  350,
    }];
    const fc = buildLabels(contacts);
    assert.equal(fc.features.length, 1);
    const { label } = fc.features[0].properties;
    assert.ok(label.includes('VIPER 1'), `label should contain callsign, got: "${label}"`);
    assert.ok(label.includes('FL200'),   `label should contain FL200, got: "${label}"`);
    assert.ok(label.includes('350kt'),   `label should contain speed, got: "${label}"`);
  });

  it('primary radar contacts produce an empty label', () => {
    const contacts = [{
      id: 2, lat: 35.0, lon: 38.0,
      coalition: 1, contactType: 'primary',
    }];
    const fc = buildLabels(contacts);
    assert.equal(fc.features.length, 1);
    assert.equal(fc.features[0].properties.label, '', 'primary contact should have empty label');
  });

  it('falls back to groupName when pilotName is absent', () => {
    const contacts = [{
      id: 3, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      groupName: 'HAWG FLIGHT',
      alt: 3048, gs: 250,
    }];
    const fc = buildLabels(contacts);
    assert.ok(fc.features[0].properties.label.includes('HAWG FLIGHT'),
      'should fall back to groupName');
  });

  it('falls back to String(id) when both pilotName and groupName are absent', () => {
    const contacts = [{
      id: 42, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      alt: 3048, gs: 250,
    }];
    const fc = buildLabels(contacts);
    assert.ok(fc.features[0].properties.label.includes('42'),
      'should fall back to unit id');
  });

  it('altitude rounds to nearest FL (nearest 100 ft)', () => {
    // 7620 m ≈ 25000 ft → FL250
    const contacts = [{
      id: 5, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      pilotName: 'EAGLE 1',
      alt: 7620, gs: 400,
    }];
    const { label } = buildLabels(contacts).features[0].properties;
    assert.ok(label.includes('FL250'), `expected FL250, got: "${label}"`);
  });

  it('speed falls back to raw spd (m/s) when gs is absent', () => {
    // spd = 154 m/s × 1.94384 ≈ 299.4 kt → rounds to 299
    const contacts = [{
      id: 6, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      pilotName: 'EAGLE 2',
      alt: 6096,
      spd: 154,   // m/s — no gs field
    }];
    const { label } = buildLabels(contacts).features[0].properties;
    assert.ok(label.includes('299kt'), `expected 299kt, got: "${label}"`);
  });

  it('skips contacts with missing lat or lon', () => {
    const contacts = [{ id: 7, lat: null, lon: 38, coalition: 2, contactType: 'track' }];
    const fc = buildLabels(contacts);
    assert.equal(fc.features.length, 0);
  });
});
