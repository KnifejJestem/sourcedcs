/**
 * tests/builder-extended.test.mjs
 *
 * Extended tests for builder.js covering:
 *   - buildLabels() label-offset (draggable label) feature
 *   - exported colour constants (COLOUR_BANDIT, COLOUR_HOSTILE)
 *   - 3D altitude coordinates in buildBlips()
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBlips, buildLabels, COLOUR_BANDIT, COLOUR_HOSTILE,
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

  it('uses overridden position when an offset is stored for the unit', () => {
    const contacts = [{
      id: 2, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      pilotName: 'HAWK 2',
      alt: 6096, gs: 350,
    }];
    const offsets = new Map([['2', [40.0, 37.0]]]);
    const fc = buildLabels(contacts, offsets);
    const [lon, lat] = fc.features[0].geometry.coordinates;
    assert.equal(lon, 40.0, 'lon should use the overridden value');
    assert.equal(lat, 37.0, 'lat should use the overridden value');
  });

  it('unit position unchanged when offset map does not contain the unit id', () => {
    const contacts = [{
      id: 3, lat: 35.0, lon: 38.0,
      coalition: 2, contactType: 'track',
      pilotName: 'HAWK 3',
      alt: 6096, gs: 350,
    }];
    const offsets = new Map([['999', [40.0, 37.0]]]); // different ID
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
