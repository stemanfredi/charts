import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.geodesic = createRequire(import.meta.url)('geographiclib-geodesic');
const { radiusTo, bearingTo, sectorEdgeTo, resizeRect, handleTo, moved, rotateHandle } = await import('../../site/draw/drag.js');
const { inverse, destination, rectangle } = await import('../../site/geodesy.js');
const { mercator } = await import('../../site/geo.js');

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
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

test('resize a rectangle from each corner: the opposite corner stays put; Shift keeps proportions; Alt the centre', () => {
  const shape = { center: C, bearing: 30, length: 120, width: 40 };
  const { corners } = rectangle(C, 30, 120, 40);
  for (let i = 0; i < 4; i++) {
    const p = destination(corners[i], 30 + i * 25, 15); // the corner dragged somewhere near
    const r = resizeRect(shape, corners, i, p);
    const after = rectangle(r.center, 30, r.length, r.width).corners;
    near(inverse(after[(i + 2) % 4], corners[(i + 2) % 4]).s, 0, 0.005, `corner ${(i + 2) % 4} fixed`);
    near(inverse(after[i], p).s, 0, 0.05, `corner ${i} under the pointer`);
  }
  const k = resizeRect(shape, corners, 0, destination(corners[0], 30, 60), { keep: true });
  near(k.length / k.width, 3, 1e-9, 'proportions');
  const c = resizeRect(shape, corners, 0, destination(C, 30, 100), { aboutCentre: true });
  assert.deepEqual(c.center, C);
  near(c.length, 200, 0.5, 'about the centre');
});

test('a Bézier handle in metres east and north; moving by the pointer; the rotate handle', () => {
  const h = handleTo([0, 60], [0.001, 60]);
  // the format's convention: Mercator metres times cos latitude (true ground metres within 0.5 %)
  near(h[0], (mercator([0.001, 60])[0] - mercator([0, 60])[0]) * Math.cos((60 * Math.PI) / 180), 0.001, 'east, at 60° N');
  near(h[0], inverse([0, 60], [0.001, 60]).s, 0.005 * h[0], 'about ground metres');
  near(h[1], 0, 1e-6, 'north');
  const p = moved([12.5, 40.5], [12, 40], [12.1, 40.05]);
  const d = [mercator(p)[0] - mercator([12.5, 40.5])[0], mercator(p)[1] - mercator([12.5, 40.5])[1]];
  near(d[0], mercator([12.1, 40.05])[0] - mercator([12, 40])[0], 1e-6, 'x');
  near(d[1], mercator([12.1, 40.05])[1] - mercator([12, 40])[1], 1e-6, 'y');
  const r = rotateHandle({ center: C, bearing: 30, length: 120 }, 20);
  near(inverse(C, r).s, 80, 1e-6, 'beyond the front edge');
  near(inverse(C, r).azi, 30, 1e-6, 'along the bearing');
});
