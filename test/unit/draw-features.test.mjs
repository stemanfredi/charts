import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near, addShape, drawFeatures, lineFrom, addRing } from './helpers.mjs';

const drawgeo = await import('../../site/draw/features.js');
const { drawParts, exportFeatures, valueFeatures, flatten, boundsOf, enlargement, shapeOf, zoomDependent, GEOMETRY } = drawgeo;
const { emptyDoc, addPoint, addDot, addLabel, makeGroup, makePart, styleOf, leavesOf, positionsIn } = await import('../../site/draw/document.js');
const { lineTrace } = await import('../../site/draw/lines.js');
const { inverse, destination, areaOf, pathOf, perimeterOf } = await import('../../site/geodesy.js');
const { fmtArea, fmtDist } = await import('../../site/format.js');

// a round part (a circle, or a sector given its aperture), its other fields as given
const C = (radius, more = {}) => ({ ...makePart(more.aperture ? 'sector' : 'circle', { radius, aperture: more.aperture }), ...more });
// three circles: the first filled, the second not, the third hidden
const PARTS = (more = {}) => [C(500, more), C(1000, { fill: false, ...more }), C(2000, { fill: false, shown: false, ...more })];
const STYLE = { fill: { color: '#112233', opacity: 0.2 }, stroke: { color: '#445566' } };
// a point with three circles (the last hidden), its own fill and stroke
const ringedDoc = () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'n', look: structuredClone(STYLE), parts: PARTS() });
  return doc;
};
// twice the signed area of a ring: positive when counter-clockwise
const turn = (rg) => { let a = 0; for (let i = 0; i < rg.length - 1; i++) a += rg[i][0] * rg[i + 1][1] - rg[i + 1][0] * rg[i][1]; return a; };
const kindsOf = (fs) => fs.map((x) => [x.properties.id, x.properties.kind]);

test('round parts: one polygon per shown part, filled as each says, in the point\'s stroke', () => {
  const f = drawFeatures(ringedDoc()).features;
  const rings = f.filter((x) => x.properties.kind === 'ring');
  assert.deepEqual(rings.map((x) => [x.properties.fill, x.properties.sc, x.properties.dash]), [[1, '#445566', 'solid'], [0, '#445566', 'solid']]);
  assert.equal(rings[0].properties.fc, '#112233');
  near(inverse([12, 41], rings[1].geometry.coordinates[0][10]).s, 1000, 1e-3, 'on the circle');
  assert.deepEqual(f.filter((x) => x.properties.kind === 'symbol').map((x) => x.properties.symbol), ['diamond']);
});

test('a new point: a diamond with one circle of 1 km; a dot: no parts', () => {
  const doc = emptyDoc(0);
  const p = addPoint(doc, [12, 41]), d = addDot(doc, [12.1, 41]);
  assert.deepEqual([p.symbol, p.parts, p.bearing], ['diamond', [{ kind: 'circle', fill: true, shown: true, name: '', radius: 1000 }], 0]);
  assert.deepEqual(['outline', 'radii', 'aperture'].filter((k) => k in p), []);
  assert.deepEqual([d.symbol, d.parts], ['dot', []]);
  const f = drawFeatures(doc).features;
  assert.deepEqual(kindsOf(f.filter((x) => x.properties.id === d.id)), [[d.id, 'symbol']]);
  assert.equal(f.find((x) => x.properties.id === d.id).properties.symbol, 'dot');
  assert.equal(f.filter((x) => x.properties.id === p.id && x.properties.kind === 'ring').length, 1);
});

test('sectors: closed at the centre, centred on the point\'s bearing', () => {
  const doc = ringedDoc();
  doc.points[0].bearing = 90;
  for (const part of doc.points[0].parts) Object.assign(part, { kind: 'sector', aperture: 180 });
  const rg = drawFeatures(doc).features.find((x) => x.properties.kind === 'ring').geometry.coordinates[0];
  assert.deepEqual(rg[0], [12, 41]);
  assert.deepEqual(rg.at(-1), [12, 41]);
  near(inverse([12, 41], rg[(rg.length - 1) / 2]).azi, 90, 1e-6, 'the arc\'s middle');
  near(inverse([12, 41], rg[1]).azi, 0, 1e-6, 'one edge');
});

test('hidden elements and parts are not drawn, nor a hidden group\'s members; a pole-reaching circle is not drawn', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'n', parts: PARTS(), visible: false });
  addPoint(doc, [0, 84], { id: 'polar', parts: [C(1e6)] });
  addShape(doc, [12, 40]).visible = false;
  addRing(doc, [[12, 40], [12.1, 40], [12.1, 40.1]], { visible: false });
  lineFrom(doc, [12, 40], [], [12.1, 40], { visible: false });
  const m = addPoint(doc, [13, 41], { id: 'm' }), l = lineFrom(doc, [13, 40], [], [13.1, 40], { id: 'l' });
  makeGroup(doc, [m.id, l.id]).visible = false;
  assert.deepEqual(kindsOf(drawFeatures(doc).features), [['polar', 'symbol']]);
});

test('symbols: "none" draws a dot at the centre, unless the point has an outline', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'n', symbol: 'none' });
  addPoint(doc, [12, 41], { id: 'bare', symbol: 'none', parts: [] });
  addPoint(doc, [12, 41], { id: 'sq', symbol: 'square', parts: [] });
  addShape(doc, [12, 41]).id = 'h';
  const sym = drawFeatures(doc).features.filter((x) => x.properties.kind === 'symbol');
  assert.deepEqual(sym.map((x) => [x.properties.id, x.properties.symbol]), [['n', 'centre'], ['bare', 'centre'], ['sq', 'square']]);
});

test('grouped points: drawn with their own style and parts (a group adds nothing)', () => {
  const doc = emptyDoc(0);
  const a = addPoint(doc, [12, 41], { look: { fill: { color: '#abcdef' } }, parts: [C(300)] });
  const b = addPoint(doc, [12.2, 41]);
  makeGroup(doc, [a.id, b.id]);
  assert.deepEqual([a.parts.map((r) => r.radius), b.parts.map((r) => r.radius)], [[300], [1000]]); // their own
  const rings = () => drawFeatures(doc).features.filter((x) => x.properties.kind === 'ring');
  assert.deepEqual(rings().map((x) => [x.properties.id, x.properties.fc]), [[a.id, '#abcdef'], [b.id, styleOf(doc, b).fill.color]]);
  near(inverse([12.2, 41], rings()[1].geometry.coordinates[0][0]).s, 1000, 1e-3, 'its own radius');
  Object.assign(b.parts[0], { kind: 'sector', aperture: 90 });
  b.bearing = 180;
  const rg = rings()[1].geometry.coordinates[0];
  assert.deepEqual(rg[0], [12.2, 41]); // a sector, about the point's own bearing
  near(inverse([12.2, 41], rg[(rg.length - 1) / 2]).azi, 180, 1e-6, 'centred on its bearing');
  assert.notDeepEqual(rings()[0].geometry.coordinates[0][0], [12, 41]); // a's: a circle still
});

test('selection and hover: a halo just outside, handles, a mark at the centre, never the stroke itself', () => {
  const doc = ringedDoc();
  addPoint(doc, [12, 41], { id: 'm', parts: [C(100)] });
  addPoint(doc, [12, 41], { id: 's', bearing: 90, parts: [C(1000, { aperture: 60 })] });
  const gm = addPoint(doc, [12.5, 41], { id: 'gm' });
  makeGroup(doc, ['gm']);
  const h = addShape(doc, [12, 40]);
  Object.assign(h, { id: 'h', look: { stroke: { width: 4 } } });
  Object.assign(h.parts[0], { length: 10, width: 5 });
  const f = drawFeatures(doc, new Set(['n', 'h', 's', 'gm']), 'm').features;
  const marks = f.filter((x) => ['sel', 'dot', 'hover', 'handle'].includes(x.properties.kind));
  const halo = (id) => marks.filter((x) => x.properties.id === id && x.geometry.type === 'Polygon');
  // several selected: no bands, dots (a point's centre; an outline's four corners); the hovered one a
  // band at its largest shown round part, with the stroke width to clear
  assert.deepEqual(['n', 'h', 's', 'gm'].map((id) => halo(id).length), [0, 0, 0, 0]);
  assert.equal(halo('m')[0].properties.kind, 'hover');
  assert.equal(halo('m')[0].properties.sw, 1.5);
  near(inverse([12, 41], halo('m')[0].geometry.coordinates[0][5]).s, 100, 1e-3, 'round its circle');
  assert.ok(turn(halo('m')[0].geometry.coordinates[0]) > 0, 'counter-clockwise');
  const hovered = drawFeatures(doc, new Set(), 'n').features.filter((x) => x.properties.kind === 'hover' && x.geometry.type === 'Polygon');
  near(inverse([12, 41], hovered[0].geometry.coordinates[0][5]).s, 1000, 1e-3, 'hovered: its outermost shown circle (the third is hidden)');
  // handles, each saying what dragging it does: four per shown circle (its cardinal points), one at
  // the middle of a sector's arc, a sector's two edges, an outline's corners and the middle of its
  // sides; none on hover. A part's handle refers to it by its place in the point's list
  const handles = (id) => drawFeatures(doc, new Set([id]), 'm').features.filter((x) => x.properties.id === id && x.properties.kind === 'handle'); // one selected: its handles
  assert.equal(marks.filter((x) => x.properties.kind === 'handle').length, 0, `several selected: no handles, the bands say which ${JSON.stringify(marks.filter((x) => x.properties.kind === 'handle').map((x) => x.properties))}`);
  assert.deepEqual(handles('n').map((x) => [x.properties.role, x.properties.ref, Math.round(inverse([12, 41], x.geometry.coordinates).s)]),
    [...[0, 1, 2, 3].map(() => ['radius', 0, 500]), ...[0, 1, 2, 3].map(() => ['radius', 1, 1000])]);
  assert.deepEqual(handles('n').slice(0, 4).map((x) => (Math.round(inverse([12, 41], x.geometry.coordinates).azi) + 360) % 360), [0, 90, 180, 270], 'at the cardinal points');
  assert.deepEqual(handles('s').map((x) => [x.properties.role, x.properties.ref, Math.round(inverse([12, 41], x.geometry.coordinates).azi)]),
    [['radius', 0, 90], ['aperture', '0:-0.5', 60], ['aperture', '0:0.5', 120]]);
  assert.deepEqual(handles('h').map((x) => [x.properties.role, x.properties.ref]), [...[0, 1, 2, 3].map((c) => ['corner', `0:${c}`]), ...[0, 1, 2, 3].map((c) => ['side', `0:${c}`])]); // no zoom: no rotate stalk
  near(inverse([12, 40], handles('h')[7].geometry.coordinates).azi, 0, 1e-6, 'side 3, the front: ahead, along the bearing');
  assert.equal(marks.filter((x) => x.properties.id === 'm' && x.properties.kind === 'handle').length, 0); // hovered, not selected: no handles
  assert.deepEqual(handles('gm').map((x) => x.properties.role), ['radius', 'radius', 'radius', 'radius']); // a member's parts: its own
  assert.ok(gm.groupId);
  // the dot at a selected point's centre, the ring round a hovered one's; a shape's four corners
  assert.deepEqual(kindsOf(marks.filter((x) => x.geometry.type === 'Point' && x.properties.kind !== 'handle')), [['h', 'dot'], ['h', 'dot'], ['h', 'dot'], ['h', 'dot'], ['n', 'sel'], ['m', 'hover'], ['s', 'sel'], ['gm', 'sel']]); // outlines are drawn before the points' centres
  // the element's own features are unchanged by being selected
  assert.deepEqual(f.filter((x) => !marks.includes(x)), drawFeatures(doc).features);
});

test('a selected outline: corners and a rotate stalk at its front; drawn enlarged, it is only moved', () => {
  const doc = emptyDoc(0);
  const h = addShape(doc, [12, 40]);
  Object.assign(h.parts[0], { length: 10, width: 5 });
  doc.look.minSize = 12;
  const at = (zoom) => drawFeatures(doc, new Set([h.id]), null, { zoom }).features;
  const close = at(20);
  assert.deepEqual(close.filter((x) => x.properties.kind === 'handle').map((x) => x.properties.role), ['corner', 'corner', 'corner', 'corner', 'side', 'side', 'side', 'side', 'rotate']);
  assert.equal(close.filter((x) => x.properties.kind === 'sel' && x.geometry.type === 'Polygon').length, 0, 'the one selected: its handles say it, its edge untouched, no band');
  const stalk = close.find((x) => x.properties.kind === 'stalk').geometry.coordinates;
  near(inverse([12, 40], stalk[0]).s, 5, 1e-6, 'from its front');
  near(inverse([12, 40], stalk[1]).azi, 0, 1e-6, 'ahead, along its bearing');
  const far = at(10);
  assert.equal(far.filter((x) => x.properties.kind === 'handle').length, 0);
  assert.equal(far.filter((x) => x.properties.kind === 'sel' && x.geometry.type === 'Polygon').length, 0); // enlarged: only moved, nothing to drag, and still no band
  // among several selected: dots at the corners, no band, no handles
  const two = drawFeatures(doc, new Set([h.id, addShape(doc, [13, 40]).id]), null, { zoom: 20 }).features;
  assert.equal(two.filter((x) => x.properties.kind === 'sel' && x.geometry.type === 'Polygon').length, 0);
  assert.equal(two.filter((x) => x.properties.kind === 'dot').length, 8);
  assert.equal(two.filter((x) => x.properties.kind === 'handle').length, 0);
});

test('several outlines on one point: each drawn, filled as it says; corners named by part; the largest turns; all enlarged by one factor', () => {
  const doc = emptyDoc(0);
  const h = addShape(doc, [12, 40]);
  h.id = 'h';
  h.parts = [makePart('rectangle', { length: 100, width: 50 }), { ...makePart('ellipse', { length: 200, width: 80 }), fill: false }];
  doc.look.minSize = 12;
  const at = (zoom) => drawFeatures(doc, new Set(['h']), null, { zoom }).features;
  const close = at(20), shapes = close.filter((x) => x.properties.kind === 'shape');
  assert.deepEqual(shapes.map((x) => [x.properties.fill, x.properties.dash, x.properties.enlarged]), [[1, 'solid', undefined], [0, 'solid', undefined]]);
  near(inverse([12, 40], shapes[0].geometry.coordinates[0][0]).s, Math.hypot(100, 50) / 2, 1e-3, 'the rectangle at real size');
  assert.deepEqual(close.filter((x) => x.properties.kind === 'handle').map((x) => [x.properties.role, x.properties.ref]),
    [...[0, 1].flatMap((i) => [...[0, 1, 2, 3].map((c) => ['corner', `${i}:${c}`]), ...[0, 1, 2, 3].map((c) => ['side', `${i}:${c}`])]), ['rotate', 0]]);
  near(inverse([12, 40], close.find((x) => x.properties.kind === 'stalk').geometry.coordinates[0]).s, 100, 1e-6, 'the stalk from the largest\'s front');
  const hovered = drawFeatures(doc, new Set(), 'h', { zoom: 20 }).features;
  const halo = hovered.find((x) => x.properties.kind === 'hover' && x.geometry.type === 'Polygon').geometry.coordinates[0];
  near(Math.max(...halo.map((q) => inverse([12, 40], q).s)), 100, 1e-3, 'hovered: the band round the largest');
  // small on screen: by the largest's long side, every outline by the same factor
  const k = enlargement(doc, h, 11), mpp = (40075016.686 * Math.cos((40 * Math.PI) / 180)) / (512 * 2 ** 11);
  near(k, (12 * mpp) / 200, 1e-9, 'the largest drawn at the minimum');
  const small = at(11).filter((x) => x.properties.kind === 'shape');
  assert.deepEqual(small.map((x) => [x.properties.dash, +x.properties.enlarged.toFixed(9)]), [['dotted', +k.toFixed(9)], ['dotted', +k.toFixed(9)]]);
  near(inverse([12, 40], small[0].geometry.coordinates[0][0]).s, (Math.hypot(100, 50) / 2) * k, 1e-2, 'the rectangle enlarged with it');
  assert.equal(at(11).filter((x) => x.properties.kind === 'handle').length, 0); // drawn enlarged: only moved
  // exported each, at real size
  assert.deepEqual(exportFeatures(doc).filter((x) => x.properties.kind === 'shape').map((x) => [x.properties.outline, x.properties.length_m, x.properties.width_m, x.properties.filled]),
    [['rectangle', 100, 50, true], ['ellipse', 200, 80, false]]);
  // a hidden one is neither drawn nor exported
  h.parts[0].shown = false;
  assert.equal(at(20).filter((x) => x.properties.kind === 'shape').length, 1);
  assert.deepEqual(exportFeatures(doc).filter((x) => x.properties.kind === 'shape').map((x) => x.properties.outline), ['ellipse']);
});

test('rings with mixed fill: each part filled or not as it says, wherever it is in the list', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'n', parts: [C(500, { fill: false }), C(1000), C(1500, { fill: false }), C(2000)] });
  const rings = drawFeatures(doc).features.filter((x) => x.properties.kind === 'ring');
  assert.deepEqual(rings.map((x) => [x.properties.fill, Math.round(inverse([12, 41], x.geometry.coordinates[0][0]).s)]), [[0, 500], [1, 1000], [0, 1500], [1, 2000]]);
  assert.deepEqual(exportFeatures(doc).filter((x) => x.properties.kind === 'circle').map((x) => x.properties.filled), [false, true, false, true]);
});

test('a circle and sectors of different apertures on one point: each its own, all about the point\'s bearing', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'n', bearing: 90, parts: [C(1000), C(2000, { aperture: 60 }), C(3000, { aperture: 120 })] });
  const f = drawFeatures(doc, new Set(['n']), null, { zoom: 12 }).features;
  const rings = f.filter((x) => x.properties.kind === 'ring').map((x) => x.geometry.coordinates[0]);
  assert.notDeepEqual(rings[0][0], [12, 41]); // a circle
  for (const [rg, ap, r] of [[rings[1], 60, 2000], [rings[2], 120, 3000]]) {
    assert.deepEqual([rg[0], rg.at(-1)], [[12, 41], [12, 41]]); // closed at the centre
    near(inverse([12, 41], rg[1]).azi, 90 - ap / 2, 1e-6, 'one edge');
    near(inverse([12, 41], rg.at(-2)).azi, 90 + ap / 2, 1e-6, 'the other');
    near(inverse([12, 41], rg[Math.floor(rg.length / 2)]).s, r, 1e-3, 'its radius');
  }
  const handles = f.filter((x) => x.properties.kind === 'handle').map((x) => [x.properties.role, x.properties.ref, Math.round(inverse([12, 41], x.geometry.coordinates).azi) + 0, Math.round(inverse([12, 41], x.geometry.coordinates).s)]);
  assert.deepEqual(handles.slice(0, 10), [['radius', 0, 0, 1000], ['radius', 0, 90, 1000], ['radius', 0, 180, 1000], ['radius', 0, -90, 1000], ['radius', 1, 90, 2000], ['radius', 2, 90, 3000],
    ['aperture', '1:-0.5', 60, 2000], ['aperture', '1:0.5', 120, 2000], ['aperture', '2:-0.5', 30, 3000], ['aperture', '2:0.5', 150, 3000]]);
  assert.deepEqual(handles[10].slice(0, 3), ['rotate', 0, 90]); // the stalk beyond the outermost arc
  assert.ok(handles[10][3] > 3000);
  const e = exportFeatures(doc).filter((x) => x.geometry.type === 'Polygon').map((x) => [x.properties.kind, x.properties.radius_m, x.properties.aperture_deg, x.properties.bearing_deg]);
  assert.deepEqual(e, [['circle', 1000, undefined, undefined], ['sector', 2000, 60, 90], ['sector', 3000, 120, 90]]);
});

test('flatten: order kept, collisions prefixed, repeats numbered; no prototype (a key may be named __proto__)', () => {
  const plain = (o) => Object.fromEntries(Object.entries(o));
  assert.equal(Object.getPrototypeOf(flatten([])), null);
  assert.deepEqual(plain(flatten([{ key: 'depth', value: '1' }, { key: 'name', value: 'x' }, { key: 'depth', value: '2' }, { key: 'depth', value: '3' }, { key: 'name', value: 'y' }])),
    { depth: '1', p_name: 'x', depth_2: '2', depth_3: '3', p_name_2: 'y' });
  assert.deepEqual(plain(flatten([{ key: 'guide', value: 1 }, { key: 'length_m', value: 2 }, { key: 'part_name', value: 3 }, { key: 'filled', value: 4 }, { key: 'radius_name', value: 5 }])),
    { p_guide: 1, p_length_m: 2, p_part_name: 3, p_filled: 4, radius_name: 5 }); // a part's fields
});

test('export: a point, its round parts and its outline, values in metres, counter-clockwise polygons', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'n', name: 'A', properties: [{ key: 'category', value: 'c' }, { key: 'id', value: 'theirs' }], bearing: 45, parts: PARTS({ aperture: 90 }) });
  const h = addShape(doc, [12, 40]);
  Object.assign(h, { id: 'h', bearing: 30 });
  Object.assign(h.parts[0], { length: 120, width: 40, name: 'hull' });
  addPoint(doc, [13, 41], { id: 'c', parts: [C(700)] });
  addPoint(doc, [14, 41], { id: 'hidden', visible: false });
  const f = exportFeatures(doc);
  assert.deepEqual(f.map((x) => [x.properties.id, x.properties.kind, x.geometry.type]), [
    ['n', 'point', 'Point'], ['n', 'sector', 'Polygon'], ['n', 'sector', 'Polygon'],
    ['h', 'point', 'Point'], ['h', 'shape', 'Polygon'],
    ['c', 'point', 'Point'], ['c', 'circle', 'Polygon']]);
  assert.deepEqual(f[0].properties, { kind: 'point', id: 'n', name: 'A', group: '', category: 'c', p_id: 'theirs' });
  const e = f[1].properties;
  assert.deepEqual([e.radius_m, e.part_name, e.filled, e.bearing_deg, e.aperture_deg, e.p_id], [500, '', true, 45, 90, 'theirs']);
  near(e.area_m2, (Math.PI * 500 * 500) / 4, 200, 'a quarter disc');
  assert.deepEqual([f[2].properties.radius_m, f[2].properties.filled], [1000, false]);
  const s = f[4].properties;
  assert.deepEqual([s.outline, s.length_m, s.width_m, s.bearing_deg, s.part_name, s.filled], ['rectangle', 120, 40, 30, 'hull', true]);
  near(s.area_m2, 4800, 1, 'its area');
  const c = f[6].properties;
  assert.deepEqual([c.radius_m, c.bearing_deg, c.aperture_deg], [700, undefined, undefined]); // a circle: no bearing
  near(c.area_m2, Math.PI * 700 * 700, 1000, 'a disc (a polygon of 128 sides)');
  for (const x of f.filter((y) => y.geometry.type === 'Polygon')) assert.ok(turn(x.geometry.coordinates[0]) > 0, 'counter-clockwise');
});

test('export: lines with their length, closed ones as polygons with area and perimeter, guides marked, groups by name', () => {
  const doc = emptyDoc(0);
  const a = addPoint(doc, [12, 41], { id: 'a' });
  lineFrom(doc, 'a', [[12.1, 41.05]], [12.2, 41], { id: 's', properties: [{ key: 'length_m', value: 'x' }] });
  lineFrom(doc, [12, 40.9], [], [12.4, 40.9], { id: 'g', guide: true });
  const q = addRing(doc, [[12, 40], [12.1, 40], [12.1, 40.1]], { id: 'q' });
  makeGroup(doc, [a.id, q.id]).name = 'G';
  const f = exportFeatures(doc);
  assert.deepEqual(f.map((x) => [x.properties.id, x.properties.kind, x.geometry.type, x.properties.guide]), [
    ['a', 'point', 'Point', undefined], ['a', 'circle', 'Polygon', undefined],
    ['s', 'line', 'LineString', undefined], ['g', 'line', 'LineString', true], ['q', 'line', 'Polygon', undefined]]);
  const s = f[2];
  near(s.properties.length_m, inverse([12, 41], [12.1, 41.05]).s + inverse([12.1, 41.05], [12.2, 41]).s, 0.001, 'the legs');
  assert.equal(s.properties.p_length_m, 'x');
  assert.deepEqual(s.geometry.coordinates, lineTrace(doc, doc.lines[0]).coords);
  const e = f[4].properties;
  assert.equal(e.group, 'G');
  near(e.area_m2, areaOf(pathOf(q.points, true)), 1, 'area');
  near(e.perimeter_m, perimeterOf(q.points), 0.001, 'perimeter');
  assert.ok(!('length_m' in e));
  near(perimeterOf(q.points), inverse([12, 40], [12.1, 40]).s + inverse([12.1, 40], [12.1, 40.1]).s + inverse([12.1, 40.1], [12, 40]).s, 1e-6, 'its edges, closed');
  assert.ok(turn(f[4].geometry.coordinates[0]) > 0, 'counter-clockwise');
});

test('boundsOf: a point to its largest shown round part, an outline by its corners; across the antimeridian continuous', () => {
  const doc = ringedDoc();
  const b = boundsOf(doc, new Set(['n']));
  near(inverse([12, 41], [12, b[3]]).s, 1000, 1, 'north'); // the third (2 km) is hidden
  assert.equal(boundsOf(doc, new Set(['x'])), null);
  const h = addShape(doc, [12, 40]);
  Object.assign(h.parts[0], { length: 2000, width: 1000 });
  const hb = boundsOf(doc, new Set([h.id]));
  near(inverse([12, 40], [12, hb[3]]).s, 1000, 1, 'its front');
  near(inverse([12, 40], [hb[2], 40]).s, 500, 1, 'its side');
  const l = lineFrom(doc, [179.9, 0], [], [-179.9, 0]);
  assert.deepEqual(boundsOf(doc, new Set([l.id])).map((v) => +v.toFixed(6)), [179.9, 0, 180.1, 0]);
});

test('geometry by kind: a group is bounded by its members; inside a box; what a group stands for, each once', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'a', parts: [] });
  addPoint(doc, [12.2, 41.1], { id: 'b', parts: [] });
  lineFrom(doc, 'a', [[12.1, 41.2]], 'b', { id: 's' });
  addShape(doc, [13, 42]).id = 'h';
  addRing(doc, [[11, 40], [11.1, 40], [11.1, 40.1]], { id: 'q' });
  addLabel(doc, [12, 41], { element: 'a' }).id = 'l';
  const g = makeGroup(doc, ['a', 'b', 's', 'h', 'q', 'l']);
  const b = boundsOf(doc, new Set([g.id]));
  assert.ok(b[0] <= 11 && b[2] >= 13 && b[1] <= 40 && b[3] >= 42, JSON.stringify(b));
  const box = (p) => p[0] >= 11.9 && p[0] <= 12.3 && p[1] >= 40.9 && p[1] <= 41.3; // the points, the line and the label; not the shape nor the closed line
  const kindOf = { a: 'point', b: 'point', s: 'line', h: 'point', q: 'line', l: 'label' };
  const el = (id) => [...doc.points, ...doc.lines, ...doc.labels].find((e) => e.id === id);
  assert.deepEqual(Object.keys(kindOf).map((id) => GEOMETRY[kindOf[id]].inside(doc, el(id), box, () => 1)), [true, true, true, false, false, true]);
  assert.equal(GEOMETRY.group.inside(doc, g, () => true, () => 1), false); // its members are, or are not
  // a small outline is inside by its corners as drawn (enlarged)
  const hb = (p) => Math.abs(p[0] - 13) < 0.01 && Math.abs(p[1] - 42) < 0.01;
  assert.deepEqual([1, 1000].map((k) => GEOMETRY.point.inside(doc, el('h'), hb, () => k)), [true, false]);
  // what moves: everything in the group, each once though selected as well; each position of each
  assert.deepEqual(leavesOf(doc, [g.id, 'q']).map((x) => x.el.id), ['a', 'b', 'h', 's', 'q', 'l']);
  assert.deepEqual(positionsIn('line', el('s')).map(([o, k]) => o[k]), [[12, 41], [12.1, 41.2], [12.2, 41.1]]); // in the order of its places
  assert.deepEqual(positionsIn('line', el('q')).map(([o, k]) => o[k]), el('q').points);
});

test('minimum display size: an outline too small on screen is drawn enlarged, dotted; real size once big enough', () => {
  const doc = emptyDoc(0);
  const s = addShape(doc, [12, 40]);
  Object.assign(s, { bearing: 30, look: { stroke: { dash: 'dashed' } } });
  Object.assign(s.parts[0], { length: 100, width: 40 });
  doc.look.minSize = 12;
  const drawing = (minSize) => ({ ...doc, look: { minSize } }); // the drawing's minimum otherwise
  // at zoom 11, 40°N: about 29 m a pixel, so 100 m is under 4 px
  const k = enlargement(doc, s, 11);
  assert.ok(k > 3 && k < 4, k);
  const px = (zoom) => 100 / ((40075016.686 * Math.cos((40 * Math.PI) / 180)) / (512 * 2 ** zoom));
  near(px(11) * k, 12, 1e-9, 'the long side drawn at the minimum, 12 px');
  const shape = (display) => drawFeatures(doc, new Set(), null, display).features.find((x) => x.properties.kind === 'shape');
  const big = shape({ zoom: 11 });
  assert.equal(big.properties.dash, 'dotted');
  near(big.properties.enlarged, k, 1e-9, 'enlarged');
  near(inverse([12, 40], big.geometry.coordinates[0][0]).s, (Math.hypot(100, 40) / 2) * k, 1e-3, 'proportions kept: the half diagonal scaled by k');
  // zoomed in: real size, its own dash
  assert.equal(enlargement(doc, s, 17), 1);
  assert.equal(shape({ zoom: 17 }).properties.dash, 'dashed');
  // off for the drawing (0); twice the minimum, twice the size
  assert.equal(enlargement(drawing(0), s, 11), 1);
  near(enlargement(drawing(24), s, 11), 2 * k, 1e-9, 'the drawing\'s minimum');
  // without an outline or a zoom (exports, tests): real size
  assert.equal(enlargement(doc, addPoint(doc, [12, 40]), 11), 1);
  assert.equal(shape({}).properties.enlarged, undefined);
  // the export is always real geometry
  assert.equal(exportFeatures(doc).find((x) => x.properties.kind === 'shape').properties.length_m, 100);
});

test('shapeOf: a point\'s outline as a shape', () => {
  const doc = emptyDoc(0);
  const s = addShape(doc, [12, 40], 'ellipse');
  s.bearing = 15;
  assert.deepEqual(shapeOf(s), { center: [12, 40], bearing: 15, length: 100, width: 50, outline: 'ellipse' });
});

test('lines: guides and the others drawn, a click target each, halos, handles by what they move', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'a' });
  addPoint(doc, [12.2, 41], { id: 'b' });
  lineFrom(doc, 'a', [[12.1, 41.05]], 'b', { id: 's1' });
  lineFrom(doc, 'b', [], [12.4, 41.1], { id: 's2' });
  lineFrom(doc, [12, 40.9], [], [12.4, 40.9], { id: 'g', guide: true, look: { stroke: { width: 3 } } });
  const f = drawFeatures(doc, new Set(['s1', 's2'])).features;
  const kinds = (k) => f.filter((x) => x.properties.kind === k).map((x) => x.properties.id);
  assert.deepEqual(kinds('linehit'), ['s1', 's2', 'g']);
  assert.deepEqual(kinds('path'), ['s1', 's2']);
  assert.deepEqual(kinds('guide'), ['g']);
  const s1 = f.find((x) => x.properties.kind === 'path');
  assert.equal(s1.properties.sc, '#e8590c');
  assert.deepEqual([s1.geometry.coordinates[0], s1.geometry.coordinates.at(-1)], [[12, 41], [12.2, 41]]);
  const guide = f.find((x) => x.properties.kind === 'guide').properties;
  assert.deepEqual([guide.dash, guide.sc, guide.sw], ['dashed', '#5d6d79', 3]); // a guide's look, its own width
  assert.deepEqual(kindsOf(f.filter((x) => x.properties.kind === 'sel' && x.geometry.type === 'LineString')), [], 'two selected: no bands');
  assert.deepEqual(kindsOf(f.filter((x) => x.properties.kind === 'dot')), [['s1', 'dot'], ['s1', 'dot'], ['s1', 'dot'], ['s2', 'dot'], ['s2', 'dot']], 'dots at their ends and vertices');
  assert.deepEqual(kindsOf(drawFeatures(doc, new Set(), 's1').features.filter((x) => x.properties.kind === 'hover' && x.geometry.type === 'LineString')), [['s1', 'hover']], 'hovered: the band');
  // handles: a place linked to a point's centre moves its point, another itself
  const handles = (fs, id, kind = 'handle') => fs.filter((x) => x.properties.kind === kind && x.properties.id === id).map((x) => [x.properties.role, x.properties.ref]);
  const one = (id) => drawFeatures(doc, new Set([id])).features; // handles: one selected
  assert.deepEqual(handles(f, 's1'), [], 'two selected: no handles');
  assert.deepEqual(handles(one('s1'), 's1'), [['point', 'a'], ['vertex', 1], ['point', 'b']]); // by its place, 0 its start
  assert.deepEqual(handles(one('s2'), 's2'), [['point', 'b'], ['vertex', 1]]);
  assert.deepEqual(handles(f, 'g'), []); // not selected: none
  // thinned at a zoom where they would crowd: the first and the last kept
  const far = drawFeatures(doc, new Set(['s1']), null, { zoom: 3 }).features.filter((x) => x.properties.kind === 'handle');
  assert.deepEqual(far.map((x) => x.geometry.coordinates), [[12, 41], [12.2, 41]]);
  // at a zoom, a + halfway along each leg long enough on screen
  const z = drawFeatures(doc, new Set(['s1']), null, { zoom: 10 }).features;
  assert.deepEqual(handles(z, 's1', 'mid'), [['mid', 0], ['mid', 1]]);
  near(inverse([12, 41], z.find((x) => x.properties.kind === 'mid').geometry.coordinates).s, inverse([12, 41], [12.1, 41.05]).s / 2, 1e-6, 'halfway');
});

test('lines with an Offset: drawn on their real geometry, the offset carried for MapLibre (the line, its hit stroke, its marks); none in the export', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 40], { id: 'a' });
  addPoint(doc, [12.2, 40], { id: 'b' });
  lineFrom(doc, 'a', [], 'b', { id: 's1', look: { offset: -3 } });
  lineFrom(doc, 'a', [], 'b', { id: 's2' });
  const f = drawFeatures(doc, new Set(['s1']), null, { zoom: 12 }).features;
  const of = (id, kind) => f.filter((x) => x.properties.id === id && x.properties.kind === kind);
  assert.deepEqual(of('s1', 'path').map((x) => x.properties.off), [-3]);
  assert.deepEqual(of('s1', 'linehit').map((x) => x.properties.off), [-3]);
  assert.deepEqual(of('s1', 'sel').map((x) => x.properties.off), [], 'one selected: no band');
  assert.deepEqual(drawFeatures(doc, new Set(['s1']), 's1', { zoom: 12 }).features.filter((x) => x.properties.id === 's1' && x.properties.kind === 'hover').map((x) => x.properties.off), [], 'selected and hovered: still none');
  assert.deepEqual(drawFeatures(doc, new Set(), 's1', { zoom: 12 }).features.filter((x) => x.properties.id === 's1' && x.properties.kind === 'hover').map((x) => x.properties.off), [-3], 'hovered: the band, offset with the line');
  assert.deepEqual(of('s2', 'path').map((x) => x.properties.off), [0]);
  assert.deepEqual(f.filter((x) => x.properties.kind === 'path').map((x) => x.geometry.coordinates), [lineTrace(doc, doc.lines[0]).coords, lineTrace(doc, doc.lines[1]).coords]);
  assert.ok(exportFeatures(doc).filter((x) => x.properties.kind === 'line').every((x) => !('off' in x.properties)));
});

test('closed lines: filled at real size, their stroke a line\'s; places and each leg\'s middle (the closing one too) as handles; bounded', () => {
  const doc = emptyDoc(0);
  const q = addRing(doc, [[12, 40], [12.1, 40], [12.1, 40.1]], { id: 'q', look: { fill: { color: '#00ff00' } } });
  const f = drawFeatures(doc, new Set(['q']), null, { zoom: 10 }).features;
  const poly = f.find((x) => x.properties.kind === 'polygon');
  assert.deepEqual([poly.properties.fc, poly.properties.fill, poly.geometry.coordinates[0]], ['#00ff00', 1, lineTrace(doc, q).coords]); // its ring as drawn, closed
  assert.deepEqual(f.filter((x) => x.properties.kind === 'path').map((x) => x.geometry.coordinates), [lineTrace(doc, q).coords]);
  assert.deepEqual(f.filter((x) => x.properties.role === 'vertex').map((x) => x.properties.ref), [0, 1, 2]);
  assert.deepEqual(f.filter((x) => x.properties.role === 'mid').map((x) => x.properties.ref), [0, 1, 2]);
  assert.deepEqual(boundsOf(doc, new Set(['q'])).map((v) => +v.toFixed(3)), [12, 40, 12.1, 40.1]);
  q.closed = false; // opened: no fill, no closing leg
  const g = drawFeatures(doc, new Set(['q']), null, { zoom: 10 }).features;
  assert.deepEqual([g.some((x) => x.properties.kind === 'polygon'), g.filter((x) => x.properties.role === 'mid').length], [false, 2]);
});

test('the parts: what never depends on the zoom, what may, the marks; only those wanted are made', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'n' });
  addShape(doc, [12, 40]).id = 'h';
  lineFrom(doc, [12, 39], [], [12.1, 39], { id: 's' });
  addRing(doc, [[12, 38], [12.1, 38], [12.1, 38.1]], { id: 'q' });
  const p = drawParts(doc, new Set(['n']), null, { zoom: 10 });
  assert.deepEqual(kindsOf(p.base), [['n', 'ring'], ['q', 'polygon'], ['n', 'symbol']]);
  assert.deepEqual(kindsOf(p.zoom), [['h', 'shape'], ['s', 'linehit'], ['s', 'path'], ['q', 'linehit'], ['q', 'path']]);
  assert.deepEqual(p.marks.map((x) => x.properties.kind), ['handle', 'handle', 'handle', 'handle', 'sel']); // one selected: its handles, its ring; no band
  const only = drawParts(doc, new Set(['n']), null, { zoom: 10 }, { zoom: true });
  assert.deepEqual([only.base, only.marks], [[], []]);
  assert.deepEqual(only.zoom, p.zoom);
});

test('zoomDependent: an outline that may be drawn enlarged', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41]);
  lineFrom(doc, [12, 40], [], [12.1, 40]);
  doc.look.minSize = 12;
  assert.equal(zoomDependent(doc), false);
  const h = addShape(doc, [12, 40]);
  assert.equal(zoomDependent(doc), true);
  doc.look.minSize = 0;
  assert.equal(zoomDependent(doc), false); // off for the drawing
  h.visible = false;
  doc.look.minSize = 12;
  assert.equal(zoomDependent(doc), false);
});

test('values shown: each leg\'s length and bearing, the total; a closed line\'s area and perimeter; a point\'s round parts\' radii', () => {
  const doc = emptyDoc(0);
  const B = destination([12, 40], 90, 10000), E = destination(B, 90, 10000);
  // what Measure keeps: guides showing their values
  const m = () => ({ guide: true, look: { text: { values: true } } });
  const ruler = lineFrom(doc, [12, 40], [B], E, m());
  const area = addRing(doc, [[12, 41], [12.1, 41], [12.1, 41.1]], m());
  const ring = addPoint(doc, [13, 40], { ...m(), symbol: 'none', parts: [C(2000)] });
  assert.deepEqual([ruler.guide, ruler.look.text.values, ruler.points.length, area.guide, ring.symbol, ring.parts.map((r) => r.radius)], [true, true, 3, true, 'none', [2000]]);
  lineFrom(doc, [12, 39], [], [12.1, 39]); // not showing its values
  lineFrom(doc, [12, 38], [], [12.1, 38], { ...m(), visible: false }); // hidden
  const v = valueFeatures(doc);
  assert.deepEqual(v.map((x) => [x.properties.id, x.properties.label, x.properties.anchor]), [
    [ruler.id, '10.00 km', 'center'], [ruler.id, '10.00 km', 'center'], [ruler.id, 'Σ 20.00 km', 'top'],
    [area.id, `${fmtArea(areaOf(pathOf(area.points, true)), 'km')}\nperimeter ${fmtDist(perimeterOf(area.points), 'km')}`, 'center'],
    [ring.id, 'r 2.00 km', 'bottom']]);
  near(inverse([12, 40], v[0].geometry.coordinates).s, 5000, 0.01, 'the leg\'s middle');
  assert.deepEqual(v[2].geometry.coordinates, E); // the total at the end
  near(inverse([13, 40], v[4].geometry.coordinates).s, 2000, 1e-6, 'at the radius');
  near(inverse([13, 40], v[4].geometry.coordinates).azi, 0, 1e-6, 'north');
  // bearings: on straight legs only; units
  const b = valueFeatures(doc, 'nm', true).filter((x) => x.properties.id === ruler.id).map((x) => x.properties.label);
  assert.equal(b[0], `${fmtDist(10000, 'nm')} · 090.0°T`);
  ruler.smooth = true;
  const c = valueFeatures(doc, 'nm', true).filter((x) => x.properties.id === ruler.id).map((x) => x.properties.label);
  assert.ok(!c[0].includes('°') && !c[1].includes('°'), c.join());
  // a sector's radius at its bearing
  Object.assign(ring.parts[0], { kind: 'sector', aperture: 90 });
  ring.bearing = 135;
  near(inverse([13, 40], valueFeatures(doc).at(-1).geometry.coordinates).azi, 135, 1e-6, 'at the bearing');
  // a single leg: no total
  ruler.points.splice(1, 1);
  assert.equal(valueFeatures(doc).filter((x) => x.properties.id === ruler.id).length, 1);
});

test('measured elements are drawn as guides, in the style they are measured with; their values are not drawn with the drawing', () => {
  const doc = emptyDoc(0);
  lineFrom(doc, [12, 40], [], [12.1, 40], { guide: true, look: { text: { values: true } } });
  addRing(doc, [[12, 41], [12.1, 41], [12.1, 41.1]], { guide: true, look: { text: { values: true } } });
  const f = drawFeatures(doc).features;
  assert.deepEqual(f.map((x) => x.properties.kind).sort(), ['guide', 'guide', 'linehit', 'linehit', 'polygon']);
  const area = f.find((x) => x.properties.kind === 'polygon').properties, line = f.find((x) => x.properties.kind === 'guide' && x.properties.id === area.id).properties;
  assert.deepEqual([area.fc, area.fo, line.sc, line.sw, line.dash], ['#b0127a', 0.08, '#b0127a', 2, 'dashed']); // as while measured
});
