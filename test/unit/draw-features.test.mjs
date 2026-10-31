import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near, addShape, drawFeatures, lineFrom, addRing } from './helpers.mjs';

const drawgeo = await import('../../site/draw/features.js');
const { drawParts, exportFeatures, valueFeatures, flatten, boundsOf, GEOMETRY, reachOf } = drawgeo;
const { emptyDoc, addPoint, addDot, addCircle, addLabel, makeGroup, styleOf, leavesOf, positionsIn } = await import('../../site/draw/document.js');
const { lineTrace } = await import('../../site/draw/lines.js');
const { inverse, destination, areaOf, lengthOf } = await import('../../site/geodesy.js');
const { fmtArea, fmtDist } = await import('../../site/format.js');

const STYLE = { fill: { color: '#112233', opacity: 0.2 }, stroke: { color: '#445566' } };
// a point holding three circles: the first filled (its own look), the second not, the third hidden
const ringedDoc = () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'n' });
  addCircle(doc, [12, 41], { id: 'c1', groupId: 'n', radius: 500, look: structuredClone(STYLE) });
  addCircle(doc, [12, 41], { id: 'c2', groupId: 'n', look: { fill: { opacity: 0 }, stroke: { color: '#445566' } } });
  addCircle(doc, [12, 41], { id: 'c3', groupId: 'n', radius: 2000, visible: false });
  return doc;
};
// twice the signed area of a ring: positive when counter-clockwise
const turn = (rg) => { let a = 0; for (let i = 0; i < rg.length - 1; i++) a += rg[i][0] * rg[i + 1][1] - rg[i + 1][0] * rg[i][1]; return a; };
const kindsOf = (fs) => fs.map((x) => [x.properties.id, x.properties.kind]);
const perimeterOf = (pts) => lengthOf([...pts, pts[0]]);

test('circles: one polygon each shown, filled while its fill is seen, in its own stroke', () => {
  const f = drawFeatures(ringedDoc()).features;
  const rings = f.filter((x) => x.properties.kind === 'ring');
  assert.deepEqual(rings.map((x) => [x.properties.id, x.properties.fill, x.properties.sc, x.properties.dash]), [['c1', 1, '#445566', 'solid'], ['c2', 0, '#445566', 'solid']]);
  assert.equal(rings[0].properties.fc, '#112233');
  near(inverse([12, 41], rings[1].geometry.coordinates[0][10]).s, 1000, 1e-3, 'on the circle');
  assert.deepEqual(f.filter((x) => x.properties.kind === 'symbol').map((x) => x.properties.symbol), ['diamond']);
});

test('a new point: a diamond, no shapes; a dot', () => {
  const doc = emptyDoc(0);
  const p = addPoint(doc, [12, 41]), d = addDot(doc, [12.1, 41]);
  assert.deepEqual([p.symbol, p.bearing], ['diamond', 0]);
  assert.deepEqual(['outline', 'radii', 'aperture', 'parts'].filter((k) => k in p), []);
  const f = drawFeatures(doc).features;
  assert.deepEqual(kindsOf(f), [[p.id, 'symbol'], [d.id, 'symbol']]);
  assert.equal(f.find((x) => x.properties.id === d.id).properties.symbol, 'dot');
});

test('sectors: closed at the centre, centred on their bearing', () => {
  const doc = emptyDoc(0);
  addCircle(doc, [12, 41], { aperture: 180, bearing: 90 });
  const rg = drawFeatures(doc).features.find((x) => x.properties.kind === 'ring').geometry.coordinates[0];
  assert.deepEqual(rg[0], [12, 41]);
  assert.deepEqual(rg.at(-1), [12, 41]);
  near(inverse([12, 41], rg[(rg.length - 1) / 2]).azi, 90, 1e-6, 'the arc\'s middle');
  near(inverse([12, 41], rg[1]).azi, 0, 1e-6, 'one edge');
});

test('hidden elements are not drawn, nor a hidden group\'s members, nor a hidden point\'s shapes; a pole-reaching circle is not drawn', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'n', visible: false });
  addCircle(doc, [12, 41], { groupId: 'n' });
  addPoint(doc, [0, 84], { id: 'polar' });
  addCircle(doc, [0, 84], { groupId: 'polar', radius: 1e6 });
  addShape(doc, [12, 40]).point.visible = false;
  addRing(doc, [[12, 40], [12.1, 40], [12.1, 40.1]], { visible: false });
  lineFrom(doc, [12, 40], [], [12.1, 40], { visible: false });
  const m = addPoint(doc, [13, 41], { id: 'm' }), l = lineFrom(doc, [13, 40], [], [13.1, 40], { id: 'l' });
  makeGroup(doc, [m.id, l.id]).visible = false;
  assert.deepEqual(kindsOf(drawFeatures(doc).features), [['polar', 'symbol']]);
});

test('symbols: "none" draws a dot at the centre, a point with shapes too', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'n', symbol: 'none' });
  addPoint(doc, [12, 41], { id: 'sq', symbol: 'square' });
  addShape(doc, [12, 41]).point.id = 'h';
  const sym = drawFeatures(doc).features.filter((x) => x.properties.kind === 'symbol');
  assert.deepEqual(sym.map((x) => [x.properties.id, x.properties.symbol]), [['n', 'centre'], ['sq', 'square'], ['h', 'centre']]);
});

test('grouped circles: drawn with their own style (a group adds nothing)', () => {
  const doc = emptyDoc(0);
  const a = addCircle(doc, [12, 41], { radius: 300, look: { fill: { color: '#abcdef' } } });
  const b = addCircle(doc, [12.2, 41], { aperture: 90, bearing: 180 });
  makeGroup(doc, [a.id, b.id]);
  const rings = () => drawFeatures(doc).features.filter((x) => x.properties.kind === 'ring');
  assert.deepEqual(rings().map((x) => [x.properties.id, x.properties.fc]), [[a.id, '#abcdef'], [b.id, styleOf(doc, b).fill.color]]);
  const rg = rings()[1].geometry.coordinates[0];
  assert.deepEqual(rg[0], [12.2, 41]); // a sector, about its own bearing
  near(inverse([12.2, 41], rg[(rg.length - 1) / 2]).azi, 180, 1e-6, 'centred on its bearing');
});

test('selection and hover: a halo just outside, handles, a mark at the centre, never the stroke itself', () => {
  const doc = ringedDoc();
  addCircle(doc, [12, 41], { id: 'm', radius: 100 });
  addCircle(doc, [12, 41], { id: 's', bearing: 90, aperture: 60 });
  addPoint(doc, [12.5, 41], { id: 'gm' });
  makeGroup(doc, ['gm']);
  const f = drawFeatures(doc, new Set(['c1', 's', 'gm']), 'm').features;
  const marks = f.filter((x) => ['sel', 'dot', 'hover', 'handle'].includes(x.properties.kind));
  const halo = (id) => marks.filter((x) => x.properties.id === id && x.geometry.type === 'Polygon');
  // several selected: no bands, dots (a point's centre; a circle's handles); the hovered one a band
  // round its circle, with the stroke width to clear
  assert.deepEqual(['c1', 's', 'gm'].map((id) => halo(id).length), [0, 0, 0]);
  assert.deepEqual([halo('m')[0].properties.kind, halo('m')[0].properties.sw], ['hover', 1.5]);
  near(inverse([12, 41], halo('m')[0].geometry.coordinates[0][5]).s, 100, 1e-3, 'round its circle');
  assert.ok(turn(halo('m')[0].geometry.coordinates[0]) > 0, 'counter-clockwise');
  assert.equal(marks.filter((x) => x.properties.kind === 'dot' && x.properties.id === 'c1').length, 4);
  // handles, each saying what dragging it does: a circle's four (its cardinal points), a sector's at
  // the middle of its arc and its two ends; none on hover
  const handles = (id) => drawFeatures(doc, new Set([id]), 'm').features.filter((x) => x.properties.id === id && x.properties.kind === 'handle'); // one selected: its handles
  assert.equal(marks.filter((x) => x.properties.kind === 'handle').length, 0, 'several selected: no handles');
  assert.deepEqual(handles('c1').map((x) => [x.properties.role, Math.round(inverse([12, 41], x.geometry.coordinates).s), (Math.round(inverse([12, 41], x.geometry.coordinates).azi) + 360) % 360]),
    [['radius', 500, 0], ['radius', 500, 90], ['radius', 500, 180], ['radius', 500, 270]]);
  assert.deepEqual(handles('s').map((x) => [x.properties.role, x.properties.ref, Math.round(inverse([12, 41], x.geometry.coordinates).azi)]),
    [['radius', '', 90], ['aperture', -0.5, 60], ['aperture', 0.5, 120]]); // no zoom: no stalk
  assert.deepEqual(handles('gm'), []); // a point without shapes: nothing to drag but itself
  // the dot at a selected point's centre
  assert.deepEqual(kindsOf(marks.filter((x) => x.geometry.type === 'Point' && x.properties.kind === 'sel')), [['gm', 'sel']]);
  // the element's own features are unchanged by being selected
  assert.deepEqual(f.filter((x) => !marks.includes(x)), drawFeatures(doc).features);
});

test('a point selected: its shapes with it (dots), a stalk beyond their reach turns it; a shape clicked again alone: its own handles', () => {
  const doc = emptyDoc(0);
  const { point: p, shapes: [r] } = addShape(doc, [12, 40], 'rectangle', 500);
  const c = addCircle(doc, [12, 40], { groupId: p.id, radius: 2000, aperture: 40 });
  near(reachOf(doc, p), 2000, 1e-6, 'its reach: the sector\'s rim');
  const f = drawFeatures(doc, new Set([p.id]), null, { zoom: 14 }).features;
  assert.deepEqual(f.filter((x) => x.properties.kind === 'handle').map((x) => [x.properties.id, x.properties.role]), [[p.id, 'rotate']]);
  const stalk = f.find((x) => x.properties.kind === 'stalk').geometry.coordinates;
  near(inverse([12, 40], stalk[0]).s, 2000, 1e-6, 'from its reach');
  near(inverse([12, 40], stalk[1]).azi, 0, 1e-6, 'along its bearing');
  assert.deepEqual([r.id, c.id].map((id) => f.filter((x) => x.properties.id === id && x.properties.kind === 'dot').length), [4, 3]); // its shapes marked with it
  const alone = drawFeatures(doc, new Set([r.id]), null, { zoom: 14 }).features;
  assert.deepEqual(alone.filter((x) => x.properties.kind === 'handle').map((x) => x.properties.role), ['vertex', 'vertex', 'vertex', 'vertex']); // a line's places
  const sec = drawFeatures(doc, new Set([c.id]), null, { zoom: 14 }).features.filter((x) => x.properties.kind === 'handle');
  assert.deepEqual(sec.map((x) => x.properties.role), ['radius', 'aperture', 'aperture', 'rotate']); // a sector alone: its own stalk
  assert.equal(drawFeatures(doc, new Set([addPoint(doc, [13, 40]).id]), null, { zoom: 14 }).features.filter((x) => x.properties.kind === 'stalk').length, 0); // no shapes: nothing to turn
});

test('flatten: order kept, collisions prefixed, repeats numbered; no prototype (a key may be named __proto__)', () => {
  const plain = (o) => Object.fromEntries(Object.entries(o));
  assert.equal(Object.getPrototypeOf(flatten([])), null);
  assert.deepEqual(plain(flatten([{ key: 'depth', value: '1' }, { key: 'name', value: 'x' }, { key: 'depth', value: '2' }, { key: 'depth', value: '3' }, { key: 'name', value: 'y' }])),
    { depth: '1', p_name: 'x', depth_2: '2', depth_3: '3', p_name_2: 'y' });
  assert.deepEqual(plain(flatten([{ key: 'guide', value: 1 }, { key: 'length_m', value: 2 }, { key: 'point', value: 3 }, { key: 'radius_name', value: 5 }])),
    { p_guide: 1, p_length_m: 2, p_point: 3, radius_name: 5 }); // the export's own fields
});

test('export: a point, its circles and its closed line (each with its point), values in metres, counter-clockwise polygons', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'n', name: 'A', properties: [{ key: 'category', value: 'c' }, { key: 'id', value: 'theirs' }], bearing: 45 });
  addCircle(doc, [12, 41], { id: 's1', groupId: 'n', radius: 500, aperture: 90, bearing: 45, look: { fill: { opacity: 0 } } });
  addCircle(doc, [12, 41], { id: 's2', groupId: 'n', aperture: 90, bearing: 45, visible: false });
  const { point: h, shapes: [r] } = addShape(doc, [12, 40], 'rectangle', 60);
  addCircle(doc, [13, 41], { id: 'c', radius: 700 });
  addPoint(doc, [14, 41], { id: 'hidden', visible: false });
  const f = exportFeatures(doc);
  assert.deepEqual(f.map((x) => [x.properties.id, x.properties.kind, x.geometry.type, x.properties.point]), [
    ['n', 'point', 'Point', undefined], [h.id, 'point', 'Point', undefined], ['s1', 'sector', 'Polygon', 'n'], ['c', 'circle', 'Polygon', undefined], [r.id, 'line', 'Polygon', h.id]]);
  assert.deepEqual(f[0].properties, { kind: 'point', id: 'n', name: 'A', group: '', category: 'c', p_id: 'theirs' });
  const e = f[2].properties;
  assert.deepEqual([e.radius_m, e.bearing_deg, e.aperture_deg], [500, 45, 90]);
  near(e.area_m2, (Math.PI * 500 * 500) / 4, 200, 'a quarter disc');
  near(f[4].properties.area_m2, 120 * 60, 1, 'the rectangle\'s area');
  const c = f[3].properties;
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
    ['a', 'point', 'Point', undefined], ['s', 'line', 'LineString', undefined], ['g', 'line', 'LineString', true], ['q', 'line', 'Polygon', undefined]]);
  const s = f[1];
  near(s.properties.length_m, inverse([12, 41], [12.1, 41.05]).s + inverse([12.1, 41.05], [12.2, 41]).s, 0.001, 'the legs');
  assert.equal(s.properties.p_length_m, 'x');
  assert.deepEqual(s.geometry.coordinates, lineTrace(doc, doc.lines[0]).coords);
  const e = f[3].properties;
  assert.equal(e.group, 'G');
  near(e.area_m2, areaOf([...q.points, q.points[0]]), 1, 'area');
  near(e.perimeter_m, perimeterOf(q.points), 0.001, 'perimeter');
  assert.ok(!('length_m' in e));
  near(perimeterOf(q.points), inverse([12, 40], [12.1, 40]).s + inverse([12.1, 40], [12.1, 40.1]).s + inverse([12.1, 40.1], [12, 40]).s, 1e-6, 'its edges, closed');
  assert.ok(turn(f[3].geometry.coordinates[0]) > 0, 'counter-clockwise');
});

test('boundsOf: a circle to its rim, a point with its shapes; across the antimeridian continuous', () => {
  const doc = ringedDoc();
  const b = boundsOf(doc, new Set(['n']));
  near(inverse([12, 41], [12, b[3]]).s, 2000, 1, 'north: its shapes, the hidden one too'); // what it stands for, at real size
  near(inverse([12, 41], [12, boundsOf(doc, new Set(['c2']))[3]]).s, 1000, 1, 'a circle alone');
  assert.equal(boundsOf(doc, new Set(['x'])), null);
  const { point: h } = addShape(doc, [12, 40], 'rectangle', 1000);
  const hb = boundsOf(doc, new Set([h.id]));
  near(inverse([12, 40], [12, hb[3]]).s, 1000, 1, 'its front');
  near(inverse([12, 40], [hb[2], 40]).s, 500, 1, 'its side');
  const l = lineFrom(doc, [179.9, 0], [], [-179.9, 0]);
  assert.deepEqual(boundsOf(doc, new Set([l.id])).map((v) => +v.toFixed(6)), [179.9, 0, 180.1, 0]);
});

test('geometry by kind: a group is bounded by its members; inside a box; what a group stands for, each once', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 41], { id: 'a' });
  addPoint(doc, [12.2, 41.1], { id: 'b' });
  lineFrom(doc, 'a', [[12.1, 41.2]], 'b', { id: 's' });
  addCircle(doc, [13, 42], { id: 'h' });
  addRing(doc, [[11, 40], [11.1, 40], [11.1, 40.1]], { id: 'q' });
  addLabel(doc, [12, 41], { element: 'a' }).id = 'l';
  const g = makeGroup(doc, ['a', 'b', 's', 'h', 'q', 'l']);
  const b = boundsOf(doc, new Set([g.id]));
  assert.ok(b[0] <= 11 && b[2] >= 13 && b[1] <= 40 && b[3] >= 42, JSON.stringify(b));
  const box = (p) => p[0] >= 11.9 && p[0] <= 12.3 && p[1] >= 40.9 && p[1] <= 41.3; // the points, the line and the label; not the circle nor the closed line
  const kindOf = { a: 'point', b: 'point', s: 'line', h: 'circle', q: 'line', l: 'label' };
  const el = (id) => [...doc.points, ...doc.circles, ...doc.lines, ...doc.labels].find((e) => e.id === id);
  assert.deepEqual(Object.keys(kindOf).map((id) => GEOMETRY[kindOf[id]].inside(doc, el(id), box)), [true, true, true, false, false, true]);
  assert.equal(GEOMETRY.group.inside(doc, g, () => true), false); // its members are, or are not
  assert.equal(GEOMETRY.circle.inside(doc, el('h'), (p) => p[0] === 13), true); // by its centre
  // what moves: everything in the group, each once though selected as well; each position of each
  assert.deepEqual(leavesOf(doc, [g.id, 'q']).map((x) => x.el.id), ['a', 'b', 'h', 's', 'q', 'l']);
  assert.deepEqual(positionsIn('line', el('s')).map(([o, k]) => o[k]), [[12, 41], [12.1, 41.2], [12.2, 41.1]]); // in the order of its places
  assert.deepEqual(positionsIn('line', el('q')).map(([o, k]) => o[k]), el('q').points);
  assert.deepEqual(positionsIn('circle', el('h')).map(([o, k]) => o[k]), [[13, 42]]);
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
  addCircle(doc, [12, 41], { id: 'c', groupId: 'n' });
  lineFrom(doc, [12, 39], [], [12.1, 39], { id: 's' });
  addRing(doc, [[12, 38], [12.1, 38], [12.1, 38.1]], { id: 'q' });
  const p = drawParts(doc, new Set(['n']), null, { zoom: 10 });
  assert.deepEqual(kindsOf(p.base), [['c', 'ring'], ['q', 'polygon'], ['n', 'symbol']]);
  assert.deepEqual(kindsOf(p.zoom), [['s', 'linehit'], ['s', 'path'], ['q', 'linehit'], ['q', 'path']]);
  assert.deepEqual(p.marks.map((x) => x.properties.kind), ['dot', 'dot', 'dot', 'dot', 'sel', 'stalk', 'handle']); // its circle with it; its ring; the stalk; no band
  const only = drawParts(doc, new Set(['n']), null, { zoom: 10 }, { zoom: true });
  assert.deepEqual([only.base, only.marks], [[], []]);
  assert.deepEqual(only.zoom, p.zoom);
});

test('values shown: each leg\'s length and bearing, the total; a closed line\'s area and perimeter; a circle\'s radius', () => {
  const doc = emptyDoc(0);
  const B = destination([12, 40], 90, 10000), E = destination(B, 90, 10000);
  // what Measure keeps: guides showing their values
  const m = () => ({ guide: true, look: { text: { values: true } } });
  const ruler = lineFrom(doc, [12, 40], [B], E, m());
  const area = addRing(doc, [[12, 41], [12.1, 41], [12.1, 41.1]], m());
  const ring = addCircle(doc, [13, 40], { ...m(), radius: 2000 });
  assert.deepEqual([ruler.guide, ruler.look.text.values, ruler.points.length, area.guide, ring.radius], [true, true, 3, true, 2000]);
  lineFrom(doc, [12, 39], [], [12.1, 39]); // not showing its values
  lineFrom(doc, [12, 38], [], [12.1, 38], { ...m(), visible: false }); // hidden
  const v = valueFeatures(doc);
  assert.deepEqual(v.map((x) => [x.properties.id, x.properties.label, x.properties.anchor]), [
    [ruler.id, '10.00 km', 'center'], [ruler.id, '10.00 km', 'center'], [ruler.id, 'Σ 20.00 km', 'top'],
    [area.id, `${fmtArea(areaOf([...area.points, area.points[0]]), 'km')}\nperimeter ${fmtDist(perimeterOf(area.points), 'km')}`, 'center'],
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
  Object.assign(ring, { aperture: 90, bearing: 135 });
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
