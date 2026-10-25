import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.geodesic = createRequire(import.meta.url)('geographiclib-geodesic');
const { inverse, destination, circle, sector, rectangle, reachesPole, pathOf } = await import('../../site/geodesy.js');

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const norm = (a) => ((a % 360) + 360) % 360;
// the difference between two azimuths, the short way round
const nearAngle = (a, b, tol, what) => near(Math.abs(((norm(a) - norm(b) + 540) % 360) - 180), 0, tol, what);

test('destination and inverse agree', () => {
  const p = [9.52, 37.29];
  for (const [azi, s] of [[0, 1000], [137.5, 250e3], [300, 5e6]]) {
    const q = destination(p, azi, s);
    const g = inverse(p, q);
    near(g.s, s, 1e-6, 'length');
    nearAngle(g.azi, azi, 1e-9, 'azimuth');
  }
});

test('circle: every point at its radius (±1 mm), closed', () => {
  for (const [c, r] of [[[10, 43.5], 1000], [[-70, -60], 400e3]]) {
    const ring = circle(c, r);
    near(norm(ring.at(-1)[0] - ring[0][0] + 180), 180, 1e-9, 'closed: longitude');
    near(ring.at(-1)[1], ring[0][1], 1e-9, 'closed: latitude');
    for (const p of ring) near(inverse(c, p).s, r, 1e-3, 'radius');
  }
});

test('circle across the antimeridian keeps continuous longitudes', () => {
  const ring = circle([179.9, -16.5], 50e3);
  for (let i = 1; i < ring.length; i++) assert.ok(Math.abs(ring[i][0] - ring[i - 1][0]) < 1, `jump at ${i}`);
  assert.ok(ring.some((p) => p[0] > 180), 'goes past 180 without wrapping');
});

test('sector: from the centre, its edges at bearing ± aperture / 2, its arc at the radius', () => {
  const c = [12, 40], r = 2000;
  const ring = sector(c, r, 45, 90);
  assert.deepEqual(ring[0], c);
  assert.deepEqual(ring.at(-1), c);
  nearAngle(inverse(c, ring[1]).azi, 0, 1e-9, 'first edge');
  nearAngle(inverse(c, ring.at(-2)).azi, 90, 1e-9, 'last edge');
  for (const p of ring.slice(1, -1)) near(inverse(c, p).s, r, 1e-3, 'radius');
  // wrapping through north: 350 ± 30
  const w = sector(c, r, 350, 60);
  nearAngle(inverse(c, w[1]).azi, 320, 1e-9, 'edge before north');
  nearAngle(inverse(c, w.at(-2)).azi, 20, 1e-9, 'edge after north');
});

test('rectangle: corners at the half diagonal, sides at length and width', () => {
  const c = [12.1, 40.2], L = 120, W = 40;
  const { corners, ring } = rectangle(c, 30, L, W);
  for (const p of corners) near(inverse(c, p).s, Math.hypot(L, W) / 2, 1e-6, 'half diagonal');
  near(inverse(corners[0], corners[1]).s, L, 1e-3, 'right side'); // front right → back right
  near(inverse(corners[1], corners[2]).s, W, 1e-3, 'back');
  near(inverse(corners[2], corners[3]).s, L, 1e-3, 'left side');
  near(inverse(corners[3], corners[0]).s, W, 1e-3, 'front');
  // the long axis points along the bearing: front midpoint is ahead of the centre
  const front = [(corners[0][0] + corners[3][0]) / 2, (corners[0][1] + corners[3][1]) / 2];
  nearAngle(inverse(c, front).azi, 30, 0.01, 'axis');
  ring.at(-1).forEach((v, i) => near(v, ring[0][i], 1e-9, 'closed'));
});

test('reachesPole: a circle up to the pole and no further', () => {
  const c = [0, 80];
  const toPole = inverse(c, [0, 90]).s;
  assert.equal(reachesPole(c, toPole - 1), false);
  assert.equal(reachesPole(c, toPole + 1), true);
  assert.equal(reachesPole([0, -80], toPole + 1), true);
  assert.equal(reachesPole([0, 0], 1e6), false);
});

test('pathOf: a step densifies, the default does not split short legs', () => {
  assert.equal(pathOf([[0, 0], [0.01, 0]], false).length, 2);
  assert.equal(pathOf([[0, 0], [0.1, 0]], false, 1000).length, 13); // 11.1 km in ≤ 1 km steps
});
