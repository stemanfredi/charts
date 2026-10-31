import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';

const { radiusTo, bearingTo, sectorEdgeTo, moved } = await import('../../site/draw/drag.js');
const { destination } = await import('../../site/geodesy.js');
const { mercator } = await import('../../site/geo.js');

const C = [12, 40];

test('radius, bearing, aperture from the pointer; across north', () => {
  near(radiusTo(C, destination(C, 70, 1234)), 1234, 1e-6, 'radius');
  near(bearingTo(C, destination(C, 70, 1234)), 70, 1e-6, 'bearing');
  assert.equal(bearingTo(C, destination(C, 52, 500), 15), 45);
  assert.equal(bearingTo(C, destination(C, 353, 500), 15), 0);
});

test('an end of a sector\'s arc dragged: the other end stays; across north; at least 1°; wrapping past the kept end', () => {
  // 90° about 0: from 315 to 45, clockwise
  const end = sectorEdgeTo(C, 0, 90, 0.5, destination(C, 90, 500)); // the end to 90: 315 → 90
  near(end.aperture, 135, 1e-6, 'aperture'); near(end.bearing, 22.5, 1e-6, 'bearing');
  const start = sectorEdgeTo(C, 0, 90, -0.5, destination(C, 345, 500)); // the start to 345: 345 → 45
  near(start.aperture, 60, 1e-6, 'aperture across north'); near(start.bearing, 15, 1e-6, 'bearing');
  const thin = sectorEdgeTo(C, 0, 90, 0.5, destination(C, 315.5, 500)); // the end just past the start
  near(thin.aperture, 1, 1e-9, 'at least 1'); near(thin.bearing, 315.5, 1e-6, 'from the kept start');
  const wide = sectorEdgeTo(C, 0, 90, 0.5, destination(C, 300, 500)); // past the start: nearly all round
  near(wide.aperture, 345, 1e-6, 'wrapped'); near(wide.bearing, 127.5, 1e-6, 'bearing');
  assert.equal(sectorEdgeTo(C, 0, 90, 0.5, destination(C, 97, 500), 15).aperture, 135, 'Shift: the end on 15° steps');
});

test('moving by the pointer', () => {
  const p = moved([12.5, 40.5], [12, 40], [12.1, 40.05]);
  const d = [mercator(p)[0] - mercator([12.5, 40.5])[0], mercator(p)[1] - mercator([12.5, 40.5])[1]];
  near(d[0], mercator([12.1, 40.05])[0] - mercator([12, 40])[0], 1e-6, 'x');
  near(d[1], mercator([12.1, 40.05])[1] - mercator([12, 40])[1], 1e-6, 'y');
});
