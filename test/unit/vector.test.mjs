import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { clipLine, joinLines, viewFeatures } from '../../site/vector.js';

// on the page polygon-clipping is a classic script on window; here the same pinned package
const polygonClipping = createRequire(import.meta.url)('polygon-clipping');

test('clipLine: parts inside a convex polygon, either winding', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(clipLine([[-5, 5], [15, 5]], sq), [[[0, 5], [10, 5]]]);
  assert.deepEqual(clipLine([[-5, 5], [15, 5]], [...sq].reverse()), [[[0, 5], [10, 5]]]);
  // in, out, in again: two parts; a stretch inside keeps its vertices
  assert.deepEqual(clipLine([[2, 2], [5, 2], [5, 20], [8, 20], [8, 2]], sq), [[[2, 2], [5, 2], [5, 10]], [[8, 10], [8, 2]]]);
  assert.deepEqual(clipLine([[20, 20], [30, 30]], sq), []);
  // a diamond (a rotated view)
  const [part] = clipLine([[-10, 0], [10, 0]], [[0, -5], [5, 0], [0, 5], [-5, 0]]);
  assert.deepEqual(part, [[-5, 0], [5, 0]]);
});

test('joinLines: pieces in any order and direction become one line; a loop stays closed', () => {
  const a = [[0, 0], [1, 0]], b = [[2, 0], [1, 0]], c = [[2, 0], [3, 1]];
  const [l, ...rest] = joinLines([c, a, b], 1e-9);
  assert.equal(rest.length, 0);
  const pts = l[0][0] === 3 ? l.slice().reverse() : l;
  assert.deepEqual(pts, [[0, 0], [1, 0], [2, 0], [3, 1]]);
  const loop = joinLines([[[0, 0], [1, 0], [1, 1]], [[1, 1], [0, 1], [0, 0]]], 1e-9);
  assert.equal(loop.length, 1);
  assert.deepEqual(loop[0][0], loop[0][loop[0].length - 1]);
  assert.equal(joinLines([[[0, 0], [1, 0]], [[1.5, 0], [2, 0]]], 0.1).length, 2, 'ends apart stay apart');
});

// two neighbouring zoom-10 tiles at the equator and the view inside both
const Z = 10, N = 2 ** Z;
const lonOf = (tx) => (tx / N) * 360 - 180;
const latOf = (ty) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / N))) * 180) / Math.PI;
const W = lonOf(N / 2), M = lonOf(N / 2 + 1), E = lonOf(N / 2 + 2); // tiles x 512 and 513
const T = latOf(N / 2 - 1), B = latOf(N / 2); // tile row y 511, from the equator up
const buf = (M - W) * 0.05; // each tile's copy reaches 5 % into its neighbour
const view = [[W + 0.01, T - 0.01], [E - 0.01, T - 0.01], [E - 0.01, B + 0.01], [W + 0.01, B + 0.01]];
const mid = (T + B) / 2;

test('viewFeatures: a road across a tile seam is one line, cut to the view', () => {
  const props = { class: 'primary' };
  const fs = viewFeatures([
    { id: 7, properties: props, tile: [Z, 512, 511], geometry: { type: 'LineString', coordinates: [[W - buf, mid], [M + buf, mid]] } },
    { id: 7, properties: props, tile: [Z, 513, 511], geometry: { type: 'LineString', coordinates: [[M - buf, mid], [E + buf, mid]] } },
  ], view, polygonClipping);
  assert.equal(fs.length, 1);
  assert.equal(fs[0].id, 7);
  assert.equal(fs[0].geometry.type, 'LineString');
  const xs = fs[0].geometry.coordinates.map((p) => p[0]);
  assert.ok(Math.abs(Math.min(...xs) - (W + 0.01)) < 1e-6 && Math.abs(Math.max(...xs) - (E - 0.01)) < 1e-6, `ends at the view's edges: ${xs}`);
});

test('viewFeatures: polygon pieces overlapping in the buffers are one polygon; a label once', () => {
  const box = (x0, x1) => ({ type: 'Polygon', coordinates: [[[x0, B + 0.02], [x1, B + 0.02], [x1, T - 0.02], [x0, T - 0.02], [x0, B + 0.02]]] });
  const fs = viewFeatures([
    { properties: { class: 'ocean' }, tile: [Z, 512, 511], geometry: box(W + 0.1, M + buf) },
    { properties: { class: 'ocean' }, tile: [Z, 513, 511], geometry: box(M - buf, E + buf) },
    { id: 3, properties: { name: 'Gulf' }, tile: [Z, 512, 511], geometry: { type: 'Point', coordinates: [M + buf / 2, mid] } },
    { id: 3, properties: { name: 'Gulf' }, tile: [Z, 513, 511], geometry: { type: 'Point', coordinates: [M + buf / 2, mid] } },
    { id: 4, properties: { name: 'Away' }, tile: [Z, 513, 511], geometry: { type: 'Point', coordinates: [E + buf / 2, mid] } },
  ], view, polygonClipping);
  const poly = fs.find((f) => f.properties.class === 'ocean');
  assert.equal(poly.geometry.type, 'Polygon');
  assert.equal(poly.geometry.coordinates.length, 1, 'no hole, no seam');
  const xs = poly.geometry.coordinates[0].map((p) => p[0]);
  const unit = (M - W) / 4096; // vertices are snapped to the tile grid; the view edge is not
  assert.ok(Math.abs(Math.min(...xs) - (W + 0.1)) <= unit && Math.abs(Math.max(...xs) - (E - 0.01)) < 1e-6, 'from its own west edge to the view edge');
  assert.deepEqual(fs.filter((f) => f.geometry.type === 'Point').map((f) => f.properties.name), ['Gulf']);
});

test('viewFeatures: a tile across the antimeridian is moved to the view', () => {
  // view just east of 180°, as MapLibre gives it (continuous longitudes); the tile is canonical (x 0)
  const v = [[180.01, 0.3], [180.2, 0.3], [180.2, 0.1], [180.01, 0.1]];
  const fs = viewFeatures([{ id: 1, properties: {}, tile: [Z, 0, N / 2 - 1], geometry: { type: 'LineString', coordinates: [[-180, 0.2], [-179.5, 0.2]] } }], v, polygonClipping);
  assert.equal(fs.length, 1);
  assert.ok(fs[0].geometry.coordinates.every(([x]) => x > 180), `${fs[0].geometry.coordinates}`);
});

test('viewFeatures: copies of a vertex that differ by less than a tile unit union without slivers', () => {
  // the same building from two tiles, its corners on the tile grid in one copy and up to 0.3 units
  // off in the other (as tiles' own rounding leaves them)
  const u = 1 / 4096, at = (i, j, d = 0) => [lonOf(N / 2 + 1 + (i + d) * u), latOf(N / 2 - 1 + (j + d) * u)];
  const sq = (d) => ({ type: 'Polygon', coordinates: [[at(-40, 2000, d), at(40, 2000), at(40, 2080, d), at(-40, 2080), at(-40, 2000, d)]] });
  const fs = viewFeatures([
    { id: 9, properties: {}, tile: [Z, 512, 511], geometry: sq(0) },
    { id: 9, properties: {}, tile: [Z, 513, 511], geometry: sq(0.3) },
  ], view, polygonClipping);
  assert.equal(fs.length, 1);
  assert.equal(fs[0].geometry.type, 'Polygon');
  assert.deepEqual(fs[0].geometry.coordinates.map((r) => r.length), [5], 'one ring, four corners');
  const r7 = ([x, y]) => [+x.toFixed(7), +y.toFixed(7)];
  const corners = [at(-40, 2000), at(40, 2000), at(40, 2080), at(-40, 2080)].map(r7).map(String).sort();
  assert.deepEqual(fs[0].geometry.coordinates[0].slice(1).map(String).sort(), corners, 'the corners on the grid, not a bump where the copies differ');
});
