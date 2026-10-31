import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';

const { placeKind, placeBox, BOX, BUILT_IN, builtInName } = await import('../../site/draw/place.js');
const { inverse } = await import('../../site/geodesy.js');
const { emptyDoc, membersOf, OUTLINES, addPoint, addCircle, addLine, carry } = await import('../../site/draw/document.js');
const { OUTLINE_NAME, outlinePoints } = await import('../../site/draw/outlines.js');
const { presetOf } = await import('../../site/draw/presets.js');

const C = [12, 40];
const preset = (value) => [{ key: 'preset', value }];
const shapes = (doc, p) => membersOf(doc, p.id).map((x) => x.el);
// a circle's [radius, aperture, fill opacity] (its own: null where it takes the drawing's)
const round = (c) => [c.radius, c.aperture, c.look.fill?.opacity ?? null];
// a rectangle's length (its right side) and width (its back)
const sides = (l) => [inverse(l.points[0], l.points[1]).s, inverse(l.points[1], l.points[2]).s];

test('a click of Point: a diamond; of Shape, with no size: a point and its shapes at their own size, facing north, its kind named', () => {
  const doc = emptyDoc(0);
  const s = placeKind(doc, C, 'symbol', []);
  assert.deepEqual([s.symbol, shapes(doc, s), s.properties], ['diamond', [], []]);
  const c = placeKind(doc, C, 'circle', []);
  assert.deepEqual([c.name, c.symbol, c.bearing, c.properties, shapes(doc, c).map(round), shapes(doc, c)[0].position], ['Circle 1', 'none', 0, preset('Circle'), [[1000, null, null]], C]);
  const rings = placeKind(doc, C, 'rings', []);
  assert.deepEqual([rings.name, shapes(doc, rings).map(round), rings.properties], ['Rings 1', [[1000, null, null], [2000, null, 0], [3000, null, 0]], preset('Rings')]);
  const sec = placeKind(doc, C, 'sector', []);
  assert.deepEqual([sec.name, shapes(doc, sec).map(round), shapes(doc, sec)[0].name, sec.properties], ['Sector 1', [[1000, 90, null]], 'Sector 1', preset('Sector')]);
  const r = placeKind(doc, C, 'rectangle', []), ring = shapes(doc, r)[0];
  assert.deepEqual([r.name, r.bearing, r.properties, ring.closed, ring.name, ring.points.length], ['Rectangle 1', 0, preset('Rectangle'), true, 'Rectangle 1', 4]);
  sides(ring).forEach((v, k) => near(v, [100, 50][k], 1e-3, 'its sides'));
  near(inverse(C, ring.points[0]).azi, Math.atan2(25, 50) * 180 / Math.PI, 1e-6, 'facing north');
  const t = shapes(doc, placeKind(doc, C, 'triangle', []))[0];
  for (const k of [0, 1, 2]) near(inverse(t.points[k], t.points[(k + 1) % 3]).s, 100, 1e-3, 'equilateral, 100 m a side');
  for (const k of OUTLINES) {
    const o = placeKind(doc, C, k, []);
    assert.deepEqual([o.symbol, o.properties, o.name, shapes(doc, o).length], ['none', preset(OUTLINE_NAME[k]), `${OUTLINE_NAME[k]} ${k === 'rectangle' || k === 'triangle' ? 2 : 1}`, 1]);
    assert.equal(shapes(doc, o)[0].points.length, outlinePoints(C, 0, 100, 50, k).length, k);
  }
});

test('the second click sizes it: the largest shape reaches it, every other one with it, facing north', () => {
  const doc = emptyDoc(0);
  assert.deepEqual(shapes(doc, placeKind(doc, C, 'circle', [], 750)).map(round), [[750, null, null]]);
  assert.deepEqual(shapes(doc, placeKind(doc, C, 'rings', [], 900)).map((x) => x.radius), [300, 600, 900]);
  assert.deepEqual(shapes(doc, placeKind(doc, C, 'sector', [], 400)).map(round), [[400, 90, null]]);
  const e = shapes(doc, placeKind(doc, C, 'ellipse', [], 200))[0];
  near(Math.max(...e.points.map((q) => inverse(C, q).s)), 200, 1e-3, 'half its length');
  sides(shapes(doc, placeKind(doc, C, 'rectangle', [], 100))[0]).forEach((v, k) => near(v, [200, 100][k], 1e-3, 'its own proportions'));
});

test('a preset of the user\'s: its point and shapes copied at their own size, about the place clicked, facing north; its name', () => {
  const src = emptyDoc(0), p = addPoint(src, [5, 50], { symbol: 'square', bearing: 30, look: { stroke: { color: '#00ff00' } } });
  addCircle(src, [5, 50], { groupId: p.id, radius: 20, aperture: 60, bearing: 40 });
  addLine(src, outlinePoints([5, 50], 30, 30, 10), { groupId: p.id, closed: true });
  const mine = presetOf(src, p.id, 'Mine');
  const doc = emptyDoc(0);
  const q = placeKind(doc, C, 'preset:Mine', [mine], 5000), [c, l] = shapes(doc, q);
  assert.deepEqual([q.bearing, q.symbol, q.name, q.properties, q.look, q.position], [0, 'square', 'Mine 1', preset('Mine'), { stroke: { color: '#00ff00' } }, C]);
  assert.deepEqual([c.radius, c.aperture, c.position], [20, 60, C]);
  near(c.bearing, 10, 1e-9, 'turned with its point: 40 − 30');
  sides(l).forEach((v, k) => near(v, [30, 10][k], 1e-6, 'its size'));
  near(inverse(C, l.points[0]).azi, Math.atan2(5, 15) * 180 / Math.PI, 1e-6, 'facing north');
  assert.equal(placeKind(doc, C, 'preset:Mine', [mine]).name, 'Mine 2');
  assert.deepEqual([src.circles[0].radius, mine.doc.circles[0].radius], [20, 20], 'the drawing and the preset untouched');
  // a preset not there: a diamond
  assert.deepEqual(shapes(doc, placeKind(doc, C, 'preset:Gone', [mine])), []);
});

test('a point turned turns its shapes about it; moved, they move with it, each its distance and bearing from it kept', () => {
  const doc = emptyDoc(0), p = placeKind(doc, C, 'rectangle', []), ring = shapes(doc, p)[0];
  const sec = addCircle(doc, C, { groupId: p.id, aperture: 90, bearing: 10 }), off = addCircle(doc, [12, 40.001], { groupId: p.id });
  const before = ring.points.map((q) => inverse(C, q));
  const to = [13, 41];
  carry(doc, p, to, 45);
  assert.deepEqual([p.position, p.bearing, sec.position, sec.bearing], [to, 45, to, 55]);
  ring.points.forEach((q, k) => { const g = inverse(to, q); near(g.s, before[k].s, 1e-6, 'its distance'); near(((g.azi - before[k].azi + 720) % 360), 45, 1e-6, 'its bearing, turned'); });
  near(inverse(to, off.position).s, inverse(C, [12, 40.001]).s, 1e-6, 'a circle off its centre: its distance');
  near(inverse(to, off.position).azi, 45, 1e-6, 'turned with it');
});

test('the built-in kinds: the Shape tool\'s; their names', () => {
  assert.deepEqual(BUILT_IN, ['circle', 'rings', 'sector', ...OUTLINES]);
  assert.deepEqual(['circle', 'rings', 'sector', 'rectangle', 'aerial-vehicle', 'nothing'].map(builtInName), ['Circle', 'Rings', 'Sector', 'Rectangle', 'Aerial vehicle', undefined]);
});

test('corner to corner: a rectangle or an ellipse, its box from one corner to the other, facing north; square: the larger side', () => {
  assert.deepEqual([...BOX], ['rectangle', 'ellipse']);
  const doc = emptyDoc(0), a = [12, 40], b = [12.02, 40.01];
  const r = placeBox(doc, a, b, 'rectangle'), [len, wid] = sides(shapes(doc, r)[0]);
  near(r.position[0], 12.01, 1e-9, 'centre lon'); near(r.position[1], 40.005, 1e-9, 'centre lat');
  near(len, inverse([12.01, 40], [12.01, 40.01]).s, 0.01, 'length: north-south');
  near(wid, inverse([12, 40.005], [12.02, 40.005]).s, 0.01, 'width: east-west');
  assert.deepEqual([r.bearing, r.name, r.properties], [0, 'Rectangle 1', preset('Rectangle')]);
  const e = shapes(doc, placeBox(doc, b, a, 'ellipse', true))[0]; // either corner first; a circle
  const reach = (az) => Math.max(...e.points.map((q) => { const g = inverse([12.01, 40.005], q); return g.s * Math.abs(Math.cos((g.azi - az) * Math.PI / 180)); }));
  near(reach(0), reach(90), 0.05, 'as long as wide');
  near(2 * reach(90), wid, 0.05, 'the larger side');
});
