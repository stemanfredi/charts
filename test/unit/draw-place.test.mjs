import { test } from 'node:test';
import assert from 'node:assert/strict';

const { placeKind, scaled, BUILT_IN, builtInName, nameByLook } = await import('../../site/draw/place.js');
const { emptyDoc, makePart, OUTLINES } = await import('../../site/draw/document.js');
const { OUTLINE_NAME } = await import('../../site/draw/outlines.js');

const C = [12, 40];
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const preset = (value) => [{ key: 'preset', value }];

test('a click of Point: a symbol; of Shape, with no size: the preset\'s own size, facing north, its preset named', () => {
  const doc = emptyDoc(0);
  const s = placeKind(doc, C, 'symbol', []);
  assert.deepEqual([s.symbol, s.parts, s.properties], ['diamond', [], []]);
  const c = placeKind(doc, C, 'circle', []);
  assert.deepEqual([c.name, c.symbol, c.parts, c.bearing, c.properties], ['Circle 1', 'none', [makePart('circle', { radius: 1000 })], 0, preset('Circle')]);
  const rings = placeKind(doc, C, 'rings', []);
  assert.deepEqual([rings.name, rings.parts.map((r) => [r.kind, r.radius, r.fill]), rings.properties], ['Rings 1', [['circle', 1000, true], ['circle', 2000, false], ['circle', 3000, false]], preset('Rings')]);
  const sec = placeKind(doc, C, 'sector', []);
  assert.deepEqual([sec.name, sec.parts, sec.properties], ['Sector 1', [makePart('sector', { radius: 1000, aperture: 90 })], preset('Sector')]);
  const r = placeKind(doc, C, 'rectangle', []);
  assert.deepEqual([r.name, r.bearing, r.parts, r.properties], ['Rectangle 1', 0, [makePart('rectangle', { length: 100, width: 50 })], preset('Rectangle')]);
  const t = placeKind(doc, C, 'triangle', []);
  near(t.parts[0].length, 50 * Math.sqrt(3), 1e-3, 'an equilateral triangle\'s height');
  near(t.parts[0].width, 100, 1e-3, 'its side');
  for (const k of OUTLINES) {
    const o = placeKind(doc, C, k, []);
    assert.deepEqual([o.symbol, o.parts.map((x) => x.kind), o.properties, o.name], ['none', [k], preset(OUTLINE_NAME[k]), `${OUTLINE_NAME[k]} ${k === 'rectangle' || k === 'triangle' ? 2 : 1}`]);
  }
  // each placement its own parts: the built-in ones untouched
  c.parts[0].radius = 5;
  assert.equal(BUILT_IN.circle.parts[0].radius, 1000);
});

test('the second click sizes it: the largest part reaches it, every other one with it, facing north; a preset of the user\'s keeps its size', () => {
  const doc = emptyDoc(0);
  const c = placeKind(doc, C, 'circle', [], 750);
  assert.deepEqual([c.parts.map((r) => r.radius), c.bearing], [[750], 0]);
  const rings = placeKind(doc, C, 'rings', [], 900);
  assert.deepEqual(rings.parts.map((r) => [r.radius, r.fill]), [[300, true], [600, false], [900, false]]);
  const sec = placeKind(doc, C, 'sector', [], 400);
  assert.deepEqual([sec.parts, sec.bearing], [[makePart('sector', { radius: 400, aperture: 90 })], 0]);
  const e = placeKind(doc, C, 'ellipse', [], 200);
  assert.deepEqual([e.bearing, e.parts], [0, [makePart('ellipse', { length: 400, width: 200 })]]);
  const rect = placeKind(doc, C, 'surface-vehicle', [], 100);
  assert.deepEqual([rect.parts[0].length, rect.parts[0].width, rect.properties], [200, 100, preset('Surface vehicle')]); // its own proportions
  const t = placeKind(doc, C, 'triangle', [], 100);
  near(t.parts[0].length, 200, 1e-3, 'twice d');
  near(t.parts[0].width, 400 / Math.sqrt(3), 1e-3, 'equilateral, whatever its size');
  const mine = { name: 'Mine', point: { symbol: 'square', parts: [makePart('rectangle', { length: 30, width: 10 }), { ...makePart('circle', { radius: 20 }), fill: false }], look: { fill: { color: '#00ff00' } } } };
  const p = placeKind(doc, C, 'preset:Mine', [mine], 5000);
  assert.deepEqual([p.bearing, p.parts, p.symbol, p.name, p.properties, p.look], [0, mine.point.parts, 'square', 'Mine 1', preset('Mine'), { fill: { color: '#00ff00' } }]);
  const q = placeKind(doc, C, 'preset:Mine', [mine]);
  assert.deepEqual([q.bearing, q.parts, q.name], [0, mine.point.parts, 'Mine 2']);
  p.parts[0].length = 1;
  assert.equal(mine.point.parts[0].length, 30, 'the preset untouched');
  // a preset not there: a symbol
  assert.deepEqual(placeKind(doc, C, 'preset:Gone', [mine]).parts, []);
});

test('scaled: every part by one factor, the largest reaching d (a radius, or half a length); the rest of each part kept', () => {
  const parts = [makePart('circle', { radius: 1000 }), { ...makePart('sector', { radius: 2000, aperture: 40 }), fill: false, name: 'far' }, makePart('rectangle', { length: 400, width: 50 })];
  const was = structuredClone(parts);
  const s = scaled(parts, 500);
  assert.deepEqual(s, [makePart('circle', { radius: 250 }), { ...makePart('sector', { radius: 500, aperture: 40 }), fill: false, name: 'far' }, makePart('rectangle', { length: 100, width: 12.5 })]);
  assert.deepEqual(parts, was, 'the parts given untouched');
  // the largest an outline: half its length reaches d
  assert.deepEqual(scaled([makePart('circle', { radius: 100 }), makePart('ellipse', { length: 1000, width: 300 })], 50).map((x) => x.radius ?? [x.length, x.width]), [10, [100, 30]]);
  assert.deepEqual(scaled([makePart('circle', { radius: 1000 }), makePart('circle', { radius: 3000 })], 1).map((x) => x.radius), [0.333, 1]); // to the millimetre
});

test('the built-in presets: by the Shape tool\'s kinds, each a symbol of none and its parts; their names', () => {
  assert.deepEqual(Object.keys(BUILT_IN), ['circle', 'rings', 'sector', ...OUTLINES]);
  assert.ok(Object.values(BUILT_IN).every((b) => b.symbol === 'none' && b.parts.length));
  assert.deepEqual(BUILT_IN.rings.parts.map((x) => [x.kind, x.radius, x.fill]), [['circle', 1000, true], ['circle', 2000, false], ['circle', 3000, false]]);
  for (const k of OUTLINES.filter((x) => x !== 'triangle')) assert.deepEqual(BUILT_IN[k].parts, [makePart(k, { length: 100, width: 50 })], k);
  assert.deepEqual(['circle', 'rings', 'sector', 'rectangle', 'aerial-vehicle', 'point', 'nothing'].map(builtInName), ['Circle', 'Rings', 'Sector', 'Rectangle', 'Aerial vehicle', 'Point', undefined]);
  const doc = emptyDoc(0);
  placeKind(doc, C, 'sector', []);
  assert.equal(nameByLook(doc, { parts: [makePart('circle'), makePart('sector')] }), 'Sector 2');
  assert.equal(nameByLook(doc, { parts: [makePart('circle'), makePart('ellipse')] }), 'Ellipse 1'); // by its largest outline
  assert.equal(nameByLook(doc, { parts: [] }), 'Point 1');
});
