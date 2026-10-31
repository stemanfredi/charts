import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addShape, lineFrom, placeIn, addRing } from './helpers.mjs';

const d = await import('../../site/draw/document.js');
const { parse, serialise, toFile } = await import('../../site/draw/file.js');
const { refreshAttached, lineRef, resolve, splitLine, insertPlace, deletePlace } = await import('../../site/draw/attach.js');
const { distributions, connections } = await import('../../site/draw/generator.js');
const { outlinePoints } = await import('../../site/draw/outlines.js');
const { emptyDoc, addPoint, addDot, addLabel, addCircle, addLine, carry, membersOf, dependents, remove, idsOf, newId, nextName,
  label, styleOf, offsetOf, isShown, isMeasurement, placeOf, makeGroup, setGroup, linkFrom,
  DEFAULT_STYLE, GUIDE_STYLE, FORMAT, VERSION } = d;

const NOW = Date.parse('2026-10-22T10:00:00Z');
const warned = (r, re) => assert.ok(r.warnings.some((w) => re.test(w)), `no warning ${re}: ${r.warnings.join(' | ')}`);
const skippedIds = (r) => r.skipped.map((s) => s.id);
// a file of now: a FeatureCollection (charts: the collection's own member)
const F = (id, type, coordinates, charts, props = {}) => ({ type: 'Feature', id, geometry: { type, coordinates }, properties: charts ? { ...props, charts } : props });
const collection = (features, charts = { format: FORMAT, version: VERSION }) => ({ type: 'FeatureCollection', ...(charts ? { charts } : {}), features });
const read = (o, known = null) => parse(typeof o === 'string' ? o : JSON.stringify(o), known, NOW);
const VIEW = { center: [12.5, 41.9], zoom: 7.25, bearing: 10, layers: [{ id: 'chart' }], data: null, units: 'nm', bearings: true }; // a view the scene's file carries
const again = (doc, known = null) => parse(serialise(doc, VIEW), known, NOW);
// a label pointing at r: a target (with its position, else where the target is), or { position } free
const labelAt = (doc, r) => addLabel(doc, r.position ?? resolve(doc, r).position, r.element ? r : null);

// a document as the file holds it: values rounded as the writer rounds them (positions 7 decimals,
// metres and pixels 3, angles 4)
const r = (n) => (v) => (typeof v === 'number' ? +v.toFixed(n) : v);
const ROUND = { position: 7, pos: 7, center: 7, points: 7,
  radius: 3, width: 3, at: 6, offset: 3, opacity: 3, bearing: 4, aperture: 4, zoom: 4 };
function rounded(x, n = null) {
  if (Array.isArray(x)) return x.map((y) => rounded(y, n));
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, rounded(v, k in ROUND ? ROUND[k] : n)]));
  return n === null ? x : r(n)(x);
}

// a drawing made by the operations, one of each kind and most of their fields
function sample() {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [12, 41]), b = addPoint(doc, [12.2, 41.1]);
  b.bearing = 30;
  // b's shapes: two sectors (one hidden, one unfilled) and a triangle
  addCircle(doc, b.position, { groupId: b.id, aperture: 120, bearing: 30, visible: false, name: 'inner' });
  addCircle(doc, b.position, { groupId: b.id, radius: 2000, aperture: 120, bearing: 30, look: { fill: { opacity: 0 } } });
  const tri = addLine(doc, outlinePoints(b.position, 30, 100, 50, 'triangle'), { groupId: b.id, closed: true });
  const el = addShape(doc, [12.1, 41], 'ellipse');
  carry(doc, el.point, el.point.position, 45);
  addCircle(doc, [12.4, 41], { radius: 300.5 }); // a free one
  addDot(doc, [12.3, 41]);
  const l = lineFrom(doc, a.id, [[12.1, 41.2]], b.id);
  l.look.stroke = { ...d.GUIDE_STROKE }; // its own, though as a guide's
  l.properties = [{ key: 'name', value: 'x' }, { key: 'k', value: 'v' }, { key: 'k', value: 'w' }];
  d.setLink(doc, l.id, 1, { element: doc.points[3].id }); // a middle place linked too
  const free = lineFrom(doc, [13, 40], [], [13.5, 40.5]);
  free.smooth = true;
  free.look.offset = 4;
  // closed lines: one clockwise (written reversed), smooth, a place named and one linked; one plain
  const ring = addRing(doc, [[12, 40], [12, 40.5], [12.5, 40.5]], { smooth: true, names: ['', 'top', ''] });
  ring.look = { fill: { color: '#123456', opacity: 0.5 }, stroke: { dash: 'dotted' } };
  d.setLink(doc, ring.id, 2, { element: doc.points[3].id });
  addRing(doc, [[12, 40], [12.5, 40], [12.5, 40.5]]);
  labelAt(doc, lineRef(doc, l, 10));
  labelAt(doc, { position: [12, 40] });
  labelAt(doc, { position: [12, 41], element: a.id });
  labelAt(doc, { position: [12, 40], element: ring.id, vertex: 1 });
  labelAt(doc, { position: [12, 40], element: ring.id, edge: 2, at: 0.5 }); // on its closing leg
  labelAt(doc, { position: [12, 40], element: el.shapes[0].id, edge: 2, at: 0.25 });
  labelAt(doc, { position: [12, 40], element: tri.id, vertex: 1 }); // on a corner of a point's shape
  labelAt(doc, { position: [12, 40], element: doc.circles[0].id }); // on a circle's centre
  makeGroup(doc, [b.id]);
  // measurements: guides showing their values
  const m = () => ({ guide: true, look: { text: { values: true } } });
  addCircle(doc, [12, 41], { name: 'Ring 1', radius: 500, ...m() });
  lineFrom(doc, [12, 41], [[12.5, 41]], [13, 41], { name: 'Distance 1', ...m() });
  addRing(doc, [[12, 41], [12.5, 41], [13, 42]], m());
  doc.look = { offset: 2 }; // the drawing's
  for (const l of doc.lines) l.points = l.points.map((q) => q.map(r(7))); // as the file writes them
  refreshAttached(doc); // each reference where it points
  return doc;
}

// ---- the file: reading, writing ------------------------------------------------------------------

test('refused: not JSON, not an object, neither GeoJSON nor a drawing, another format version', () => {
  for (const [text, re] of [['{', /not JSON/], ['[1]', /no document/], ['{"format":"x"}', /neither a drawing file nor GeoJSON/],
    ['{"type":"Topology"}', /neither/], [JSON.stringify(collection([], { version: VERSION + 1 })), /format version 2; this app reads version 1/],
    [JSON.stringify(collection([], { version: 0 })), /format version 0/], [JSON.stringify(collection([], { version: '1' })), /format version 1;/],
    [JSON.stringify(collection([], { version: null })), /format version null/]]) {
    const { doc, report } = parse(text, null, NOW);
    assert.equal(doc, null, text);
    assert.match(report.refused, re, text);
  }
});

test('a minimal file: defaults everywhere', () => {
  const { doc, report } = read(collection([F('n1', 'Point', [12, 41], { kind: 'point' })]));
  assert.equal(report.refused, null);
  assert.deepEqual([report.warnings, report.skipped], [[], []]);
  assert.equal(doc.created, '2026-10-22T10:00:00Z');
  assert.deepEqual(doc.meta, { title: '', description: '', author: '' });
  assert.deepEqual(doc.look, {});
  assert.deepEqual(doc.points[0], { id: 'n1', name: '', properties: [], groupId: null, visible: true, guide: false,
    position: [12, 41], bearing: 0, symbol: 'none', look: {} });
  assert.deepEqual(styleOf(doc, doc.points[0]), DEFAULT_STYLE); // no look of its own: the default
  assert.deepEqual(d.lookOf(doc, doc.points[0]), d.DEFAULT_LOOK);
});

test('round trip: a drawing made by the operations survives its file unchanged, and the file is stable', () => {
  const doc = sample();
  const { doc: back, report } = again(doc);
  assert.deepEqual([report.warnings, report.skipped], [[], []]);
  assert.deepEqual(back, doc);
  assert.equal(serialise(back), serialise(doc));
});

test('round trip: values come back rounded as the file writes them', () => {
  const doc = emptyDoc(NOW);
  const p = addPoint(doc, [12.123456789, 41.987654321], { bearing: 45.123456 });
  p.look = { stroke: { opacity: 0.123456 } };
  const c = addCircle(doc, [3, 3], { groupId: p.id, radius: 1000.12345, aperture: 90.000049, bearing: 45.123456 });
  c.look = { fill: { opacity: 0.123456 }, stroke: { width: 2.00049 } };
  const s = lineFrom(doc, [1.000000049, 2], [[1.5, 2.12345678]], p.id, { look: { offset: 3.33333 } });
  labelAt(doc, lineRef(doc, s, 1500.12345)).offset = [10.12345, -20.98765];
  addRing(doc, [[0, 0], [1.123456789, 0], [1, 1]]);
  const f = toFile(doc);
  assert.deepEqual(f.features[0].geometry.coordinates, [12.1234568, 41.9876543]);
  assert.deepEqual(f.features[1].properties.charts, { kind: 'circle', group: p.id, radius: 1000.123, aperture: 90, bearing: 45.1235 });
  assert.deepEqual([f.features[0].properties['stroke-opacity'], f.features[1].properties['fill-opacity'], f.features[1].properties['stroke-width']], [0.123, 0.123, 2]);
  assert.equal(f.features[0].properties.charts.bearing, 45.1235);
  const { doc: back } = again(doc);
  // a label linked: where its target is in the drawing read (the link wins over the geometry)
  const want = rounded(doc), at = back.labels[0].position;
  assert.deepEqual(at, resolve(back, linkFrom(back, back.labels[0].id).to).position);
  assert.ok(Math.abs(at[0] - doc.labels[0].position[0]) < 1e-6 && Math.abs(at[1] - doc.labels[0].position[1]) < 1e-6);
  want.labels[0].position = at;
  assert.deepEqual(back, want);
  assert.equal(back.lines[0].points.at(-1)[0], back.points[0].position[0]); // the linked end where its point is
});

test('defaults are left out of the file; positions on one line', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [12, 41]);
  addDot(doc, [12.5, 41]);
  const c = addCircle(doc, [13, 41]);
  lineFrom(doc, a.id, [], [14, 41]);
  addRing(doc, [[0, 0], [1, 0], [1, 1]]);
  const lb = labelAt(doc, { position: [12, 41], element: a.id });
  const text = serialise(doc), f = JSON.parse(text);
  assert.deepEqual(Object.keys(f), ['type', 'charts', 'features']);
  assert.deepEqual(f.charts, { format: FORMAT, version: VERSION, created: '2026-10-22T10:00:00Z', modified: '2026-10-22T10:00:00Z',
    links: [{ from: [doc.lines[0].id, 0], to: { element: a.id } }, { from: [lb.id, 0], to: { element: a.id } }] }); // the ties, in one table
  const [pt, dot, circ, line, area, lab] = f.features;
  assert.deepEqual(pt, { type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [12, 41] },
    properties: { name: 'Point 1', charts: { kind: 'point', symbol: 'diamond' } } }); // its symbol: written (the default is none)
  assert.deepEqual(dot.properties.charts, { kind: 'point', symbol: 'dot' });
  assert.deepEqual(circ, { type: 'Feature', id: c.id, geometry: { type: 'Point', coordinates: [13, 41] }, properties: { name: 'Circle 1', charts: { kind: 'circle', radius: 1000 } } }); // its radius always; no aperture: a whole circle
  assert.deepEqual(line.properties.charts, { kind: 'line' }); // no names: none written
  assert.deepEqual(line.geometry, { type: 'LineString', coordinates: [[12, 41], [14, 41]] });
  assert.deepEqual(area.properties.charts, { kind: 'line' }); // closed: its geometry says so
  assert.deepEqual(area.geometry, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
  assert.deepEqual(lab.properties.charts, { kind: 'label', text: '{name}' });
  assert.deepEqual(lab.geometry.coordinates, [12, 41]); // where it points
  assert.match(text, /"coordinates": \[12, 41\]/);
});

test('closed lines are Polygons, written counter-clockwise; one stored clockwise says so and reads back as it was, its names too', () => {
  const doc = emptyDoc(NOW);
  const cw = addRing(doc, [[0, 0], [0, 1], [1, 1]], { names: ['a', 'b', ''] }), ccw = addRing(doc, [[0, 0], [1, 0], [1, 1]]);
  const [fa, fb] = toFile(doc).features;
  assert.deepEqual(fa.geometry.coordinates, [[[1, 1], [0, 1], [0, 0], [1, 1]]]); // closed
  assert.deepEqual(fa.properties.charts, { kind: 'line', reversed: true, names: ['a', 'b', ''] }); // its names in its own order
  assert.deepEqual(fb.geometry.coordinates, [[[0, 0], [1, 0], [1, 1], [0, 0]]]);
  assert.ok(!('reversed' in fb.properties.charts));
  const back = again(doc).doc;
  assert.deepEqual(back.lines.map((x) => [x.closed, x.points, x.names]), [[true, cw.points, cw.names], [true, ccw.points, ccw.names]]);
});

test('properties: the user\'s as columns, a key colliding with the feature\'s own renamed, the list kept; the common style names', () => {
  const doc = emptyDoc(NOW);
  const p = addCircle(doc, [0, 0], { properties: [{ key: 'description', value: 'about it' }, { key: 'category', value: 'kind A' }, { key: 'depth', value: '120' }, { key: 'stroke', value: 'thin' }, { key: 'depth', value: 'again' }] });
  p.look = { stroke: { color: '#ff0000', width: 3, opacity: 0.5, dash: 'dashed' }, fill: { color: '#00ff00', opacity: 0.25 } };
  const q = addPoint(doc, [1, 0], { properties: [{ key: 'a', value: '1' }] });
  const [fq, fp] = toFile(doc).features;
  assert.deepEqual(fp.properties, { name: 'Circle 1', description: 'about it', category: 'kind A', depth: '120', p_stroke: 'thin', depth_2: 'again',
    stroke: '#ff0000', 'stroke-width': 3, 'stroke-opacity': 0.5, fill: '#00ff00', 'fill-opacity': 0.25, charts: fp.properties.charts });
  assert.deepEqual(fp.properties.charts.properties, p.properties); // the keys as they are
  assert.deepEqual(fp.properties.charts.look, { stroke: { dash: 'dashed' } }); // the rest of its look: the app's
  assert.ok(!('properties' in fq.properties.charts)); // nothing renamed: the columns are enough
  assert.equal(fq.properties.a, '1');
  const back = again(doc).doc;
  assert.deepEqual([back.circles[0].properties, back.circles[0].look, back.points[0].properties], [p.properties, p.look, q.properties]);
});

test('unknown fields are ignored; foreign columns are kept as properties', () => {
  const { doc, report } = read({ ...collection([F('n1', 'Point', [12, 41], { kind: 'point', colourOfTheDay: 'red' }, { extra: 3 })]), extra: 1 });
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(doc.points[0].properties, [{ key: 'extra', value: '3' }]);
  assert.ok(!serialise(doc).includes('colourOfTheDay'));
});

test('IDs: a malformed, repeated or missing one is replaced with a warning; a number is read as text; the rest loads', () => {
  const { doc, report } = read(collection([
    F('ok', 'Point', [0, 0], { kind: 'point' }), F('bad id', 'Point', [0, 0], { kind: 'point' }), F('ok', 'Point', [1, 1], { kind: 'point' }),
    F(7, 'Point', [2, 2], { kind: 'point' }), { type: 'Feature', geometry: { type: 'Point', coordinates: [3, 3] }, properties: {} },
  ], { groups: [{ id: 'bad id' }, { name: 'no ID' }] }));
  const ids = doc.points.map((p) => p.id);
  assert.equal(ids[0], 'ok');
  assert.equal(doc.points[0].position[0], 0); // the first "ok" kept, not the duplicate
  assert.equal(ids[3], '7');
  assert.equal(new Set(ids).size, 5);
  for (const id of [ids[1], ids[2], ids[4]]) assert.match(id, /^[a-z0-9]{8}$/);
  warned(report, /malformed ID; a new one given/);
  warned(report, /ID already used; a new one given/);
  assert.deepEqual(doc.groups, []); // a group needs its own ID: the others refer to it
  assert.deepEqual(report.skipped.map((s) => [s.kind, s.reason]), [['group', 'no valid ID'], ['group', 'no valid ID']]);
});

test('skipped: latitudes out of range, positions missing, too few positions, what is not a feature, geometry collections; a longitude past ±180 brought back', () => {
  const { doc, report } = read(collection([
    F('ok', 'Point', [0, 0]), F('far', 'Point', [0, 86]), F('west', 'Point', [-181, 0]), F('nopos', 'Point', null), F('short', 'Point', [1]),
    F('one', 'LineString', [[0, 0]]), F('badvertex', 'LineString', [[0, 0], [1, 'x']]), F('two', 'Polygon', [[[0, 0], [1, 0], [0, 0]]]), F('noring', 'Polygon', [1, 2]),
    'junk', { type: 'Feature', id: 'nogeo', properties: {} }, F('gc', 'GeometryCollection', undefined), F('odd', 'Curve', [0, 0]),
  ]));
  assert.deepEqual(doc.points.map((p) => [p.id, p.position]), [['ok', [0, 0]], ['west', [179, 0]]]);
  assert.deepEqual(doc.lines, []);
  assert.deepEqual(skippedIds(report), ['far', 'nopos', 'short', 'one', 'badvertex', 'two', 'noring', '10', 'nogeo', 'gc', 'odd']);
  const why = Object.fromEntries(report.skipped.map((s) => [s.id, s.reason]));
  assert.match(why.far, /out of range/);
  assert.match(why.nopos, /not \[longitude, latitude\]/);
  assert.match(why.one, /two positions/);
  assert.match(why.badvertex, /position 2/);
  assert.match(why.two, /a ring needs three positions/);
  assert.match(why['10'], /not a Feature/);
  assert.match(why.nogeo, /no geometry/);
  assert.match(why.gc, /geometry collection/);
  assert.match(why.odd, /Curve: not read/);
});

test('repairs: symbol, angles, sizes, Offset, style values, circles, flags', () => {
  const st = { stroke: '#FF0000', 'stroke-width': 99, 'stroke-opacity': 2, fill: 'red' };
  const { doc, report } = read(collection([
    F('p1', 'Point', [0, 0], { kind: 'point', symbol: 'star', bearing: -90, look: { minSize: -3, stroke: { dash: 'wavy' }, text: { name: 'yes' } } }, st),
    F('p2', 'Point', [0, 0], { kind: 'point', parts: [{ kind: 'circle', radius: 100 }] }), // a point holds no parts
    F('c1', 'Point', [0, 0], { kind: 'circle', radius: 100 }), F('c2', 'Point', [0, 0], { kind: 'circle', radius: 0 }), F('c3', 'Point', [0, 0], { kind: 'circle', radius: 2e7 }),
    F('c4', 'Point', [0, 0], { kind: 'circle' }), F('c5', 'Point', [0, 0], { kind: 'circle', radius: 300, aperture: 400, bearing: 370 }),
    F('c6', 'Point', [0, 0], { kind: 'circle', radius: 5, aperture: 0 }), F('c7', 'Point', [0, 0], { kind: 'circle', radius: 60, aperture: 360 }),
    F('c8', 'Point', [0, 0], { kind: 'circle', radius: 70, aperture: 45, length: 3 }), F('c9', 'LineString', [[0, 0], [1, 0]], { kind: 'circle', radius: 70 }),
    F('s1', 'LineString', [[0, 0], [1, 0]], { kind: 'line', look: { offset: -99 }, smooth: 'yes' }),
    F('s2', 'LineString', [[0, 0], [1, 0]], { kind: 'line', look: { offset: 99 } }),
    F('s3', 'LineString', [[0, 0], [1, 0]], { kind: 'line', look: { offset: true } }),
  ]));
  const [p1, p2] = doc.points, [, s1, s2, s3] = doc.lines;
  assert.deepEqual([p1.symbol, p1.bearing, p1.look.minSize, p1.look.text, d.lookOf(doc, p1).text.name], ['none', 270, undefined, undefined, false]); // not valid: left out, the drawing's applies
  assert.deepEqual([p1.look.fill, p1.look.stroke], [undefined, { color: '#ff0000', width: 20, opacity: 1 }]); // the bad colour and dash dropped: the defaults; a fill a point has none of
  assert.ok(!('parts' in p2));
  assert.deepEqual(doc.circles.map((c) => [c.id, c.radius, c.aperture, c.bearing]), [['c1', 100, null, 0], ['c5', 300, null, 10], ['c6', 5, null, 0], ['c7', 60, null, 0], ['c8', 70, 45, 0]]); // a sector of 360° or more: a circle; only a circle's fields kept
  assert.ok(!('length' in doc.circles[4]));
  assert.deepEqual([doc.lines.length, skippedIds(report).sort()], [4, ['c2', 'c3', 'c4']]); // a LineString is a line, whatever it says
  assert.match(report.skipped[0].reason, /radius not between 0 and 10 000 km/);
  assert.deepEqual([s1.look.offset, s1.smooth], [-d.MAX_OFFSET, false]); // clamped either side
  assert.deepEqual([s2.look.offset, s3.look.offset], [d.MAX_OFFSET, undefined]); // true or false is not a number of pixels
  for (const re of [/unknown symbol "star"/, /bearing -90 read as 270/, /aperture 400 read as a full circle/, /aperture: not an angle above 0; a circle/, /bearing 370 read as 10/,
    /unknown dash "wavy"/, /look text name: not true or false, ignored/, /stroke width 99 clamped to 20/, /stroke opacity 2 clamped to 1/, /fill colour: not a #rrggbb/,
    /Offset: not a number/, /smooth is not true or false/]) warned(report, re);
  assert.equal(report.warnings.filter((w) => /aperture/.test(w)).length, 2); // those two; a sector of exactly 360°: a circle, quietly
});

test('circles in the file: a Point with kind circle, its radius always, aperture and bearing when not the defaults, rounded; read back', () => {
  const doc = emptyDoc(NOW);
  addCircle(doc, [0, 0], { radius: 100.00049, aperture: 33.333333, bearing: 10, name: 'b', visible: false, guide: true });
  const f = toFile(doc).features[0];
  assert.deepEqual([f.geometry, f.properties], [{ type: 'Point', coordinates: [0, 0] }, { name: 'b', charts: { kind: 'circle', visible: false, guide: true, radius: 100, aperture: 33.3333, bearing: 10 } }]);
  assert.deepEqual(again(doc).doc.circles, rounded(doc.circles));
});

test('any GeoJSON: Multi geometries split, holes dropped, foreign points diamonds, names and columns read', () => {
  const { doc, report } = read({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'mp', geometry: { type: 'MultiPoint', coordinates: [[1, 1], [2, 2, 30]] }, properties: { Name: 'Twin', depth: 12, flag: true, nested: { a: 1 }, Description: 'two of them' } },
    { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 0]], [[0, 1], [1, 1], [2, 1]]] }, properties: { title: 'Pair', stroke: '#00AA00', 'stroke-width': 3 } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 0.5]]] }, properties: null },
    { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] }, properties: { fill: '#0000ff', 'fill-opacity': 0.4 } },
  ] });
  assert.deepEqual(report.skipped, []);
  warned(report, /holes are not read/);
  const [a, b] = doc.points;
  assert.equal(a.id, 'mp'); // the first part keeps the feature's ID, the others get new ones
  assert.match(b.id, /^[a-z0-9]{8}$/);
  assert.deepEqual([a.position, b.position], [[1, 1], [2, 2]]); // the altitude dropped
  assert.deepEqual([a.symbol, a.name], ['diamond', 'Twin']);
  assert.deepEqual(a.properties, [{ key: 'depth', value: '12' }, { key: 'flag', value: 'true' }, { key: 'nested', value: '{"a":1}' }, { key: 'Description', value: 'two of them' }]); // a description: a property like any other
  assert.deepEqual(doc.lines.filter((s) => !s.closed).map((s) => [s.name, s.points.length, s.names, s.look]), [['Pair', 2, ['', ''], { stroke: { color: '#00aa00', width: 3 } }], ['Pair', 3, ['', '', ''], { stroke: { color: '#00aa00', width: 3 } }]]);
  assert.deepEqual(doc.links, []);
  const rings = doc.lines.filter((x) => x.closed);
  assert.equal(rings.length, 3);
  assert.deepEqual([rings[0].points, rings[0].names], [[[0, 0], [2, 0], [2, 2], [0, 2]], ['', '', '', '']]); // closed lines: their first position not repeated, the outer ring only
  assert.deepEqual(rings[2].look, { fill: { color: '#0000ff', opacity: 0.4 } });
  assert.ok(rings.every((x) => !x.guide && !d.lookOf(doc, x).text.values));
  // a bare Feature, and a bare geometry
  assert.deepEqual(read(F('one', 'Point', [3, 4])).doc.points.map((p) => [p.id, p.position]), [['one', [3, 4]]]);
  assert.deepEqual(read({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }).doc.lines[0].points, [[0, 0], [1, 1]]);
});

test('the app\'s own written back as text by another tool is read again', () => {
  const doc = sample();
  const f = toFile(doc);
  for (const x of f.features) x.properties.charts = JSON.stringify(x.properties.charts);
  const { doc: back, report } = read(f);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(back, doc);
});

test('links read: a place that disagrees with its target moves to it (counted); one from or to what is not there (or no such vertex), to its own element, or from a place already linked, is dropped', () => {
  const L = (from, to) => ({ from, to });
  const { doc, report } = read(collection([
    F('a', 'Point', [0, 0], { kind: 'point' }), F('b', 'Point', [1, 0], { kind: 'point' }), F('ar', 'Polygon', [[[0, 0], [1, 0], [1, 1], [0, 0]]], { kind: 'area' }),
    F('s1', 'LineString', [[0.001, 0], [0.5, 0.5], [1.002, 0]], { kind: 'line' }),
    F('s2', 'LineString', [[0, 0], [2, 2]], { kind: 'line' }),
    F('s3', 'LineString', [[3, 3], [2, 2]], { kind: 'line' }),
    F('s4', 'LineString', [[3, 3], [2, 2]], { kind: 'line' }),
    F('s5', 'LineString', [[4, 4], [5, 5]], { kind: 'line' }),
  ], { links: [L(['s1', 0], { element: 'a' }), L(['s1', 2], 'b'), L(['s1', 1], { element: 'ar', vertex: 2 }), // a bare ID: its centre; a middle place as an end
    L(['s2', 0], 'a'), L(['s2', 1], { element: 'ar' }), L(['s3', 0], 'gone'), L(['s4', 1], { element: 'ar', vertex: 3 }),
    L(['s5', 0], { element: 's5', vertex: 1 }), L(['s5', 2], 'a'), L(['s1', 0], 'b'), L(['a', 0], 'b'), 'junk'] }));
  const [, s1, s2, s3, s4, s5] = doc.lines;
  assert.deepEqual([0, 1, 2].map((i) => placeIn(doc, s1, i)), [{ position: [0, 0], to: { element: 'a' } }, { position: [1, 1], to: { element: 'ar', vertex: 2 } }, { position: [1, 0], to: { element: 'b' } }]);
  assert.deepEqual([placeIn(doc, s2, 0).to, placeIn(doc, s2, 1)], [{ element: 'a' }, { position: d.centroid(doc.lines[0].points), to: { element: 'ar' } }]);
  assert.deepEqual([placeIn(doc, s3, 0), placeIn(doc, s4, 1), placeIn(doc, s5, 0)], [{ position: [3, 3], to: null }, { position: [2, 2], to: null }, { position: [4, 4], to: null }]);
  assert.equal(doc.links.length, 5);
  warned(report, /^4 places moved to what they are linked to/);
  warned(report, /link to ar, which is not here \(or has no such vertex or edge\): dropped/);
  warned(report, /link to gone, which is not here/);
  warned(report, /link to its own element: dropped/);
  warned(report, /link from s5 2, which is not a line's or a label's place here: dropped/);
  warned(report, /link from a 0, which is not/);
  warned(report, /link from a place already linked: dropped/);
});

test('links in a chain, listed last to first: each place where the one it is on is, however long the chain', () => {
  // s4's end on s3's last point, s3's on s2's, s2's on s1's: the file's ends all elsewhere
  const on = (id, to) => ({ from: [id, 1], to: { element: to, vertex: 1 } });
  const { doc, report } = read(collection([
    F('s4', 'LineString', [[4, 0], [9, 9]], { kind: 'line' }), F('s3', 'LineString', [[3, 0], [8, 8]], { kind: 'line' }),
    F('s2', 'LineString', [[2, 0], [7, 7]], { kind: 'line' }), F('s1', 'LineString', [[1, 0], [1, 1]], { kind: 'line' }),
    F('a', 'Point', [0, 5], { kind: 'label' }),
  ], { links: [on('s4', 's3'), on('s3', 's2'), on('s2', 's1'), { from: ['a', 0], to: 'a' }] }));
  assert.deepEqual(doc.lines.map((s) => s.points[1]), [[1, 1], [1, 1], [1, 1], [1, 1]]);
  warned(report, /^3 places moved/);
  warned(report, /link to its own element: dropped/);
  assert.deepEqual(placeIn(doc, doc.labels[0]), { position: [0, 5], to: null });
});

test('labels: on an element, along a line, on a vertex, or free; checked; written back', () => {
  const to = (id, t) => ({ from: [id, 0], to: t });
  const { doc, report } = read(collection([
    F('a', 'Point', [12, 40], { kind: 'point', look: { text: { name: true } } }), F('s', 'LineString', [[12, 40], [13, 40]], { kind: 'line' }),
    F('ar', 'Polygon', [[[12, 41], [13, 41], [13, 42], [12, 41]]], { kind: 'area' }),
    F('l1', 'Point', [0, 0], { kind: 'label', text: '{name}', offset: [10, -20], leader: 'none', look: { text: { size: 'large', color: '#AA0000', background: 'box' } } }),
    F('l2', 'Point', [0, 0], { kind: 'label' }),
    F('l3', 'Point', [12, 41], { kind: 'label', leader: 'zigzag', offset: 'far', look: { text: { size: 'huge' } } }),
    F('l4', 'Point', [12, 42], { kind: 'label' }),
    F('l5', 'Point', [0, 0], { kind: 'label' }),
    F('l6', 'Point', [0, 0], { kind: 'label' }),
    F('l7', 'Point', [12, 99], { kind: 'label' }),
    F('l8', 'Point', [12, 43], { kind: 'label' }),
    F('l9', 'Point', [0, 0], { kind: 'label' }),
    F('l10', 'Point', [0, 0], { kind: 'label' }),
  ], { links: [to('l1', { element: 'a' }), to('l2', { element: 's', edge: 0, at: 0.123456789 }), to('l4', { element: 'gone' }), to('l5', { element: 's', edge: 0, at: -3 }),
    to('l6', { element: 'a', along: 10 }), // no distance along a point
    to('l7', 'a'), // skipped: not here
    to('l8', { element: 'a', vertex: 0 }), // a point without an outline: no vertices
    to('l9', 'ar'), // a bare ID: its centre
    to('l10', { element: 'ar', vertex: 2 })] }));
  assert.deepEqual(doc.labels.map((x) => x.id), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l8', 'l9', 'l10']);
  assert.deepEqual(skippedIds(report), ['l7']);
  const [l1, l2, l3, l4, l5, l6, l8, l9, l10] = doc.labels;
  const text = (a) => d.lookOf(doc, a).text, at = (a) => placeIn(doc, a);
  assert.deepEqual([l1.leader, l1.offset, l1.look, at(l1)], ['none', [10, -20], { text: { size: 'large', color: '#aa0000', background: 'box' } }, { position: [12, 40], to: { element: 'a' } }]);
  assert.deepEqual([at(l2).to, l2.text, l2.leader, l2.look, text(l2).background], [{ element: 's', edge: 0, at: 0.123456789 }, '', 'arrow', {}, 'halo']);
  assert.deepEqual(l2.position, resolve(doc, at(l2).to).position); // where it points
  assert.ok(Math.abs(resolve(doc, at(l2).to).along - 0.123456789 * resolve(doc, at(l2).to).length) < 1e-6);
  assert.deepEqual([at(l3), l3.leader, l3.offset, l3.look, text(l3).size], [{ position: [12, 41], to: null }, 'arrow', [40, -40], {}, 'medium']);
  assert.deepEqual([at(l4), at(l5), at(l6)], [{ position: [12, 42], to: null }, { position: [12, 40], to: { element: 's', edge: 0, at: 0 } }, { position: [12, 40], to: { element: 'a' } }]);
  assert.deepEqual([at(l8), at(l9), at(l10)], [{ position: [12, 43], to: null }, { position: d.centroid(doc.lines[1].points), to: { element: 'ar' } }, { position: [13, 42], to: { element: 'ar', vertex: 2 } }]);
  assert.ok(!('name' in l1.look.text));
  for (const re of [/leader: unknown "zigzag"/, /offset: not \[x, y\]/, /size "huge" unknown/, /link to gone, which is not here/, /link to a, which is not here \(or has no such vertex/, /link from l7 0, which is not/]) warned(report, re);
  assert.deepEqual(doc.points[0].look, { text: { name: true } });
  const f = toFile(doc), out = (id) => f.features.find((x) => x.id === id), linked = (id) => f.charts.links.find((l) => l.from[0] === id)?.to;
  assert.deepEqual(linked('l2'), { element: 's', edge: 0, at: 0.123457 });
  assert.deepEqual([linked('l1'), linked('l9'), linked('l10'), linked('l4')], [{ element: 'a' }, { element: 'ar' }, { element: 'ar', vertex: 2 }, undefined]); // free: none
  assert.deepEqual(out('l1').geometry.coordinates, [12, 40]); // where it points
  assert.deepEqual(out('l10').geometry.coordinates, [13, 42]);
  at(l2).to.at = 0.123457; // as the file writes it
  refreshAttached(doc);
  assert.deepEqual(again(doc).doc, doc);
});

test('groups in the file: a group holds nothing of its own; a point holds shapes (circles, lines), nothing else; a missing group or point makes it standalone', () => {
  const { doc, report } = read(collection([
    F('m', 'Point', [0, 0], { kind: 'point', group: 'g' }),
    F('c', 'Point', [0, 0], { kind: 'circle', radius: 1, aperture: 90, group: 'm' }), // a point's: its shape
    F('l', 'Polygon', [[[0, 0], [1, 0], [1, 1], [0, 0]]], { kind: 'line', group: 'm' }),
    F('p', 'Point', [0, 0], { kind: 'point', group: 'm' }), // a point holds no point
    F('t', 'Point', [0, 0], { kind: 'label', group: 'c' }), // nor does a circle hold anything
    F('lost', 'Point', [0, 0], { kind: 'point', group: 'nowhere' }),
  ], { groups: [{ id: 'g', look: { fill: { color: '#ff0000' }, offset: 3 }, parts: [{ kind: 'circle', radius: 300 }], radii: [{ value: 300, primary: true }], aperture: 90 }] }));
  const [m, p, lost] = doc.points;
  const g = doc.groups[0];
  assert.ok(!('look' in g) && !('parts' in g) && !('radii' in g) && !('aperture' in g)); // a group is only who is in it
  assert.equal(offsetOf(doc, m), 0); // nothing from the group
  assert.equal(styleOf(doc, m).fill.color, DEFAULT_STYLE.fill.color);
  assert.deepEqual(membersOf(doc, 'm').map((x) => x.el.id), ['c', 'l']);
  assert.deepEqual([p.groupId, doc.labels[0].groupId, lost.groupId], [null, null, null]);
  for (const re of [/point p: group m not found; now standalone/, /label t: group c not found/, /group nowhere not found; now standalone/]) warned(report, re);
  assert.ok(!('parts' in toFile(doc).charts.groups[0]) && !('radii' in toFile(doc).charts.groups[0]));
  assert.deepEqual(toFile(doc).features.find((x) => x.id === 'c').properties.charts.group, 'm'); // its point
  assert.deepEqual(again(doc).doc, doc);
});

test('view: layers, variants and data checked against what the app offers', () => {
  const known = { layers: { chart: { variants: null, periods: null }, depth: { variants: ['atlas', 'nautical'], periods: null }, traffic: { variants: ['all', 't09'], periods: ['2024'] } },
    data: { waves: ['height', 'period'] }, depths: [0, 10] };
  const { view: v, report } = read(collection([], { view: { center: [12.5, 41.9], zoom: 7.25, bearing: -10, units: 'nm', bearings: true,
    layers: [{ id: 'chart' }, { id: 'depth', variant: 'nautical', opacity: 0.8 }, { id: 'gone' }, { id: 'traffic', variant: 't99', period: '2024' }],
    data: { colour: { id: 'waves', variant: 'height' }, arrows: { id: 'wind', variant: null }, time: '2026-10-22T09:00:00Z', depth: 15 } } }), known);
  assert.deepEqual(v.layers, [{ id: 'chart' }, { id: 'depth', variant: 'nautical', opacity: 0.8 }, { id: 'traffic', period: '2024' }]);
  assert.deepEqual([v.bearing, v.units, v.bearings, 'minDisplaySize' in v], [350, 'nm', true, false]); // the drawing's look holds it
  assert.deepEqual(v.data, { colour: { id: 'waves', variant: 'height' }, arrows: null, time: '2026-10-22T09:00:00Z', depth: null });
  for (const re of [/layer "gone" not known/, /variant "t99" not known/, /arrows: "wind" not known/, /depth 15 not offered/]) warned(report, re);
  assert.deepEqual(read(serialise(emptyDoc(NOW), v), known).view, v, 'written and read again as it is');
});

test('rules (distribute, connect) are kept as records; defaults left out; an unknown kind or a distribution along nothing skipped', () => {
  const { doc, report } = read(collection([], { rules: [
    { id: 'a1', kind: 'distribute', groupId: 'g1', copiesId: 'g2', along: { element: 's', part: 2 }, spacing: 1000, side: 'alternate', radius: 250, preset: 'preset:mine', copy: { symbol: 'square' },
      points: [{ pointId: 'n1', t: 0.5, pos: [1, 2] }] },
    { id: 'a2', kind: 'distribute' }, { id: 'a3', kind: 'distribute', along: { element: 's' } }, { id: 'a4', kind: 'distribute', along: { element: 's', part: 1.5 } },
    { id: 'a5', kind: 'distribute', along: {} },
    { id: 'c1', kind: 'connect', groupId: 'g3', groupSize: 3, roots: [{ id: 'n9' }, { id: 'n8', weight: 2 }, 'x'], pointIds: ['n1'], created: ['gone'] }, { id: 'c1', kind: 'connect' },
    { id: 'x1', kind: 'spiral' }, { id: 'x2' }] }));
  const [a] = distributions(doc), [c] = connections(doc);
  assert.deepEqual(doc.rules.map((x) => x.id), ['a1', 'a3', 'a4', 'c1']);
  assert.deepEqual(distributions(doc).map((x) => x.id), ['a1', 'a3', 'a4']); // a2, a5 are along nothing
  assert.deepEqual(report.skipped.filter((x) => x.kind === 'rule').map((x) => x.id), ['a2', 'a5', 'c1', 'x1', 'x2']);
  assert.ok(report.skipped.some((x) => x.id === 'x1' && /unknown kind "spiral"/.test(x.reason)));
  assert.deepEqual([a.kind, a.groupId, a.copiesId, a.along, a.spacing, a.side, a.offset, a.count, a.radius, a.aperture, a.preset, a.points[0].left],
    ['distribute', 'g1', 'g2', { element: 's' }, 1000, 'alternate', 0, null, 250, null, 'preset:mine', false]); // what it is along: an element, nothing else
  assert.ok(!('copy' in a)); // its copies are in the drawing: no copy kept
  assert.deepEqual(distributions(doc).slice(1).map((x) => [x.groupId, x.copiesId, x.preset]), [[null, null, null], [null, null, null]]);
  assert.equal(connections(doc).length, 1); // the second c1: its ID used
  assert.deepEqual([c.kind, c.groupId, c.pattern, c.groupSize, c.created, c.hubs, c.roots], ['connect', 'g3', 'tree', 3, ['gone'], [], [{ id: 'n9', weight: 1 }, { id: 'n8', weight: 2 }]]); // deleted since: not an error; a weight of 1 unless given
  const f = toFile(doc).charts;
  assert.deepEqual(f.rules[3], { id: 'c1', kind: 'connect', groupId: 'g3', groupSize: 3, roots: [{ id: 'n9' }, { id: 'n8', weight: 2 }], pointIds: ['n1'], created: ['gone'] });
  assert.deepEqual(f.rules[0], { id: 'a1', kind: 'distribute', groupId: 'g1', copiesId: 'g2', along: { element: 's' }, spacing: 1000, side: 'alternate', radius: 250,
    preset: 'preset:mine', points: [{ pointId: 'n1', t: 0.5, pos: [1, 2] }] });
  assert.deepEqual(f.rules[1], { id: 'a3', kind: 'distribute', along: { element: 's' } });
  assert.deepEqual(again(doc).doc, doc);
});

test('a user property title or Name stays one on the app\'s own features; on others it names them; a Description is a property', () => {
  const doc = emptyDoc(NOW);
  const p = addPoint(doc, [10, 40], { id: 'p', name: '' });
  p.properties = [{ key: 'title', value: 'T' }, { key: 'Description', value: 'D' }];
  const back = again(doc).doc.points[0];
  assert.deepEqual([back.name, back.properties], ['', [{ key: 'title', value: 'T' }, { key: 'Description', value: 'D' }]]);
  const foreign = read({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { title: 'T', Description: 'D' }, geometry: { type: 'Point', coordinates: [10, 40] } }] }).doc.points[0];
  assert.deepEqual([foreign.name, foreign.properties], ['T', [{ key: 'Description', value: 'D' }]]);
});

test('the collection\'s charts member written as text by a GIS is read; a feature\'s visible not true or false warns', () => {
  const doc = emptyDoc(NOW);
  doc.meta.title = 'Kept';
  const f = toFile(doc);
  f.charts = JSON.stringify(f.charts);
  f.features.push({ type: 'Feature', properties: { charts: { kind: 'point', visible: 'no' } }, geometry: { type: 'Point', coordinates: [10, 40] } });
  const r = read(f);
  assert.equal(r.doc.meta.title, 'Kept');
  assert.equal(r.doc.points[0].visible, true);
  assert.ok(r.report.warnings.some((w) => /visible/.test(w)), r.report.warnings.join('; '));
});

// ---- operations ------------------------------------------------------------------------------------

test('operations: new elements, names, IDs', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [12, 41]), b = addPoint(doc, [13, 41]);
  assert.deepEqual([a.name, b.name, a.symbol, a.bearing, 'parts' in a], ['Point 1', 'Point 2', 'diamond', 0, false]);
  b.name = 'Point 7';
  assert.equal(nextName(doc, 'point'), 'Point 8');
  const c = addCircle(doc, [12, 41]), sec = addCircle(doc, [12, 41], { aperture: 90 });
  assert.deepEqual([c.name, c.radius, c.aperture, c.bearing, c.groupId, sec.name], ['Circle 1', 1000, null, 0, null, 'Sector 1']);
  const h = addShape(doc, [12, 41]);
  assert.deepEqual([h.point.name, h.point.symbol, h.shapes.map((x) => [x.name, x.closed, x.points.length, x.groupId])], ['Rectangle 1', 'none', [['Rectangle 1', true, 4, h.point.id]]]);
  const j = addDot(doc, [12, 42]);
  assert.equal(j.symbol, 'dot');
  const ids = idsOf(doc);
  assert.equal(ids.size, 7); // the points, circles and lines
  const before = new Set(ids);
  for (let i = 0; i < 200; i++) assert.ok(!before.has(newId(doc, ids)));
  assert.equal(ids.size, 207); // each new ID taken as it is made
  assert.match(a.id, /^[a-z0-9]{8}$/);
  a.name = '';
  assert.equal(label('point', a), 'Point · 41.0000, 12.0000');
  assert.equal(label('circle', { ...c, name: '' }), 'Circle · 41.0000, 12.0000');
  assert.equal(label('line', addRing(doc, [[1, 0], [3, 0], [0, 3]], { name: ' ' })), 'Line · 0.0000, 1.0000');
  assert.deepEqual([placeOf('line', doc.lines.at(-1)), placeOf('circle', c)], [[1, 0], [12, 41]]); // a line's, closed or not: its start; a circle's centre
  const g = makeGroup(doc, []);
  assert.equal(label('group', { ...g, name: '' }), `Group ${g.id}`);
});

test('a point holds shapes: its circles and lines, nothing else; they are shown with it, deleted with it, and the tree\'s under it', () => {
  const doc = emptyDoc(NOW);
  const p = addPoint(doc, [0, 0]), q = addPoint(doc, [1, 0]);
  const c = addCircle(doc, [0, 0]), l = addRing(doc, [[0, 0], [0.1, 0], [0, 0.1]]), t = labelAt(doc, { position: [0, 0] });
  for (const x of [c, l, t, q]) setGroup(doc, x.id, p.id);
  assert.deepEqual([c.groupId, l.groupId, t.groupId, q.groupId], [p.id, p.id, null, null]); // a label, a point: not a point's
  assert.deepEqual([d.canHold(doc, p.id, c.id), d.canHold(doc, p.id, q.id), d.holderOf(doc, c)?.id, d.holderOf(doc, q)], [true, false, p.id, null]);
  const g = makeGroup(doc, [p.id]);
  assert.deepEqual([p.groupId, c.groupId], [g.id, p.id]); // the point in the group, its shapes in it
  assert.deepEqual(d.leavesOf(doc, [p.id]).map((x) => x.el.id), [p.id, c.id, l.id]); // a point stands for its shapes
  assert.deepEqual(d.leavesOf(doc, [g.id]).map((x) => x.el.id), [p.id, c.id, l.id]);
  p.visible = false;
  assert.deepEqual([isShown(doc, c), isShown(doc, l)], [false, false]); // hidden with it
  assert.deepEqual(dependents(doc, [p.id]), new Set([p.id, c.id, l.id])); // deleted with it
  assert.deepEqual(dependents(doc, [c.id]), new Set([c.id])); // one alone
  setGroup(doc, c.id, g.id); // taken out of it: free, in its group
  assert.deepEqual([d.holderOf(doc, c), membersOf(doc, p.id).map((x) => x.el.id)], [null, [l.id]]);
  remove(doc, [p.id]);
  assert.deepEqual([doc.points.map((x) => x.id), doc.circles.map((x) => x.id), doc.lines], [[q.id], [c.id], []]);
  assert.deepEqual(again(doc).doc, doc);
});

test('lines: positions and names only, ties in the links; places inserted and deleted, the links from them numbered again', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [12, 41]), b = addPoint(doc, [12.3, 41.2]);
  const s = d.addLine(doc, [[12, 41], [12.1, 41.1], [12.2, 41]]);
  assert.deepEqual([s.name, s.points, s.names, s.smooth, s.guide], ['Line 1', [[12, 41], [12.1, 41.1], [12.2, 41]], ['', '', ''], false, false]);
  assert.deepEqual(placeOf('line', s), [12, 41]);
  d.setLink(doc, s.id, 0, { element: a.id, d: 2, position: [0, 0] }); // the target alone kept
  d.setLink(doc, s.id, 2, { element: b.id });
  assert.deepEqual(doc.links, [{ from: [s.id, 0], to: { element: a.id } }, { from: [s.id, 2], to: { element: b.id } }]);
  s.names[1] = 'bend';
  insertPlace(doc, s.id, 1, [12.05, 41.05]);
  assert.deepEqual([s.points.length, s.names, doc.links.map((l) => l.from[1])], [4, ['', '', 'bend', ''], [0, 3]]);
  deletePlace(doc, s.id, 0); // the start: the link from it goes, the others move down
  assert.deepEqual([s.points[0], s.names, doc.links], [[12.05, 41.05], ['', 'bend', ''], [{ from: [s.id, 2], to: { element: b.id } }]]);
  deletePlace(doc, s.id, 1);
  deletePlace(doc, s.id, 0); // two are kept
  assert.deepEqual([s.points.length, doc.links.map((l) => l.from[1])], [2, [1]]);
  d.setLink(doc, s.id, 1, null); // free where it is
  assert.deepEqual([doc.links, s.points[1]], [[], [12.2, 41]]);
  assert.deepEqual(again(doc).doc, doc);
});

test('a middle place linked follows its target; deleting the target frees it, where it was', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0.5]);
  const s = d.addLine(doc, [[0, 0], [1, 0], [2, 0]]);
  d.setLink(doc, s.id, 1, { element: a.id });
  refreshAttached(doc);
  assert.deepEqual(s.points, [[0, 0], [0, 0.5], [2, 0]]);
  a.position = [1, 1];
  refreshAttached(doc);
  assert.deepEqual(s.points[1], [1, 1]);
  remove(doc, [a.id]);
  refreshAttached(doc);
  assert.deepEqual([s.points[1], doc.links], [[1, 1], []]);
});

test('attached ends follow their point; a point gone leaves them free where they were', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]), b = addPoint(doc, [1, 0]);
  const s = lineFrom(doc, a.id, [], b.id), t = lineFrom(doc, b.id, [], [2, 0]);
  a.position = [0, 0.5];
  refreshAttached(doc);
  assert.deepEqual(placeIn(doc, s, 0), { position: [0, 0.5], to: { element: a.id } });
  assert.deepEqual(dependents(doc, [b.id]), new Set([b.id])); // lines do not go with a point
  assert.deepEqual([...remove(doc, [b.id])], [b.id]);
  refreshAttached(doc); // after every change
  assert.deepEqual(doc.lines.map((x) => x.id), [s.id, t.id]);
  assert.deepEqual([placeIn(doc, s, -1), placeIn(doc, t, 0)], [{ position: [1, 0], to: null }, { position: [1, 0], to: null }]);
  doc.points = []; // gone some other way
  refreshAttached(doc);
  assert.deepEqual([placeIn(doc, s, 0), doc.links], [{ position: [0, 0.5], to: null }, []]);
});

test('split a line at a place: a dot carrying the place\'s name, both lines linked to it; the links of the second half go with it', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]), b = addPoint(doc, [3, 1]);
  const s = lineFrom(doc, a.id, [[1, 0], [2, 0], [3, 0]], [4, 0], { name: 'Main' });
  s.names[2] = 'bend';
  d.setLink(doc, s.id, 3, { element: b.id });
  d.setLink(doc, s.id, 2, { element: b.id }); // the place split at: its link goes, the point is there
  const p = splitLine(doc, s.id, 2);
  const rest = doc.lines[1];
  assert.deepEqual([p.symbol, p.name, p.properties, p.position], ['dot', 'bend', [], [2, 0]]);
  assert.deepEqual([s.points, s.names, placeIn(doc, s, -1).to], [[[0, 0], [1, 0], [2, 0]], ['', '', ''], { element: p.id }]);
  assert.deepEqual([rest.points, rest.names, rest.name], [[[2, 0], [3, 0], [4, 0]], ['', '', ''], 'Line 1']);
  assert.deepEqual(doc.links.map((l) => [l.from, l.to.element]), [[[s.id, 0], a.id], [[rest.id, 1], b.id], [[s.id, 2], p.id], [[rest.id, 0], p.id]]);
  assert.notEqual(rest.id, s.id);
  assert.equal(splitLine(doc, s.id, 1).name, 'Point 3'); // an unnamed place: the next point's name
});

test('measurements: guides showing their values (a line, an area, a circle with its radius), drawn as while measured', () => {
  const doc = emptyDoc(NOW), m = () => ({ guide: true, look: { text: { values: true } } });
  const r1 = lineFrom(doc, [12, 44], [[12.5, 44.2]], [13, 44], { ...m(), name: 'Distance 1' });
  const c = addCircle(doc, [14, 40], { ...m(), radius: 5000 });
  const a = addRing(doc, [[12, 44], [13, 44], [12.5, 45]], m());
  assert.ok([r1, c, a].every((x) => isMeasurement(doc, x)));
  assert.ok(!isMeasurement(doc, addCircle(doc, [0, 0], { look: { text: { values: true } } })) && !isMeasurement(doc, addCircle(doc, [0, 0], { guide: true })));
  assert.deepEqual(styleOf(doc, r1), d.MEASURE_STYLE); // drawn as while it was measured
  r1.look.stroke = { color: '#000000' };
  assert.deepEqual(styleOf(doc, r1).stroke, { ...d.MEASURE_STYLE.stroke, color: '#000000' });
  r1.look.text.values = false; // a guide not showing its values: faint, dashed
  assert.deepEqual(styleOf(doc, r1).stroke, { ...GUIDE_STYLE.stroke, color: '#000000' });
  r1.look.text.values = true;
  assert.equal(nextName(doc, 'line', 'Distance'), 'Distance 2');
  assert.deepEqual(again(doc).doc, doc);
});

test('shown: hidden itself, or in a hidden group', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]), b = addPoint(doc, [1, 0], { visible: false });
  assert.deepEqual([isShown(doc, a), isShown(doc, b)], [true, false]);
  const g = makeGroup(doc, [a.id]);
  g.visible = false;
  assert.equal(isShown(doc, a), false);
});

// ---- groups --------------------------------------------------------------------------------------

test('groups: made from a selection, only who is in it changes: members keep their own look, joining or leaving', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [12, 41]), b = addCircle(doc, [12.1, 41], { aperture: 45, bearing: 20 }), h = addShape(doc, [12, 40]).point, j = addDot(doc, [13, 40]);
  const s = lineFrom(doc, a.id, [], [12.1, 41], { look: { offset: 6 } });
  a.look.stroke = { color: '#123456' };
  b.look.fill = { color: '#654321' };
  const before = structuredClone([a, b, h, j, s].map((x) => [x.look, x.aperture ?? null]));
  const g = makeGroup(doc, [h.id, b.id, a.id, j.id, s.id]);
  assert.equal(g.name, 'Group 1');
  assert.ok(!('look' in g)); // a group has no look of its own
  assert.ok([a, b, h, j, s].every((x) => x.groupId === g.id));
  assert.equal(doc.lines[0].groupId, h.id); // the shape's point is in it; the shape still its point's
  assert.deepEqual([a, b, h, j, s].map((x) => [x.look, x.aperture ?? null]), before); // as they were
  assert.deepEqual([styleOf(doc, a).stroke.color, styleOf(doc, b).fill.color, offsetOf(doc, s)], ['#123456', '#654321', 6]);
  setGroup(doc, a.id, null);
  setGroup(doc, s.id, null);
  assert.deepEqual([a.look, s.look], [{ stroke: { color: '#123456' } }, { offset: 6 }]); // leaving: as it was too
  assert.deepEqual(again(doc).doc, rounded(doc));
});

test('a label in a group keeps its own colour; else the default', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]);
  const l = labelAt(doc, { element: a.id }), m = labelAt(doc, { element: a.id });
  l.look.text = { color: '#111111' };
  makeGroup(doc, [l.id, m.id]);
  assert.deepEqual([d.lookOf(doc, l).text.color, d.lookOf(doc, m).text.color], ['#111111', '#1f2c36']);
});

test('delete a group: members ungrouped, a point keeping its shapes, or deleted with it; ends attached to them freed', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]), b = addPoint(doc, [1, 0]), c = addPoint(doc, [2, 0]);
  const s = lineFrom(doc, a.id, [], c.id);
  const g = makeGroup(doc, [c.id, b.id]);
  const sec = addCircle(doc, [2, 0], { groupId: c.id, radius: 50, aperture: 30 });
  assert.deepEqual(dependents(doc, [g.id]), new Set([g.id]));
  assert.deepEqual(dependents(doc, [g.id], true), new Set([g.id, b.id, c.id, sec.id]));
  const kept = structuredClone(doc);
  remove(kept, [g.id]);
  const kc = kept.points.find((p) => p.id === c.id);
  assert.deepEqual([kc.groupId, kept.circles[0].groupId, kept.groups], [null, c.id, []]);
  assert.equal(placeIn(kept, kept.lines[0], -1).to.element, c.id);
  const gone = structuredClone(doc);
  remove(gone, [g.id], true);
  refreshAttached(gone); // after every change
  assert.deepEqual([gone.points.map((p) => p.id), gone.circles], [[a.id], []]);
  assert.deepEqual(placeIn(gone, gone.lines[0], -1), { position: [2, 0], to: null }); // the line stays, its end free
  assert.equal(placeIn(doc, s, -1).to.element, c.id); // the original untouched
});

test('delete a group: members ungrouped keep the group\'s style and colour as their own', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]);
  const s = lineFrom(doc, a.id, [], [1, 0]);
  const l = labelAt(doc, { element: a.id });
  const g = makeGroup(doc, [a.id, s.id, l.id]);
  g.look = { fill: { color: '#abcdef' }, stroke: { color: '#123456' } };
  const before = [styleOf(doc, a), styleOf(doc, s).stroke, d.lookOf(doc, l).text.color];
  remove(doc, [g.id]);
  assert.deepEqual([styleOf(doc, a), styleOf(doc, s).stroke, d.lookOf(doc, l).text.color], before);
});

test('nested groups: a group of members of a group is a subgroup of it; visibility comes down the chain', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]), b = addPoint(doc, [1, 0]), c = addPoint(doc, [2, 0]);
  const s = lineFrom(doc, a.id, [], b.id);
  const top = makeGroup(doc, [a.id, b.id, c.id, s.id]);
  const sub = makeGroup(doc, [a.id, s.id]);
  assert.equal(sub.groupId, top.id, 'in the group its members were in');
  assert.deepEqual([a.groupId, s.groupId, b.groupId], [sub.id, sub.id, top.id]);
  assert.deepEqual(d.groupsOf(doc, a).map((g) => g.id), [sub.id, top.id]);
  top.visible = false;
  assert.ok(!isShown(doc, a) && !isShown(doc, sub));
  top.visible = true;
  assert.deepEqual(d.membersOf(doc, top.id).map((x) => x.el.id).sort(), [b.id, c.id, sub.id].sort());
  assert.deepEqual(d.membersOf(doc, top.id, true).map((x) => x.el.id).sort(), [a.id, b.id, c.id, s.id, sub.id].sort());
  // never into itself or a group inside it
  setGroup(doc, top.id, sub.id);
  assert.equal(top.groupId, null);
  assert.ok(!d.canHold(doc, sub.id, top.id) && !d.canHold(doc, top.id, top.id) && d.canHold(doc, top.id, sub.id));
  // a group chosen with what is in it: wrapped whole, in the group it was in
  const wrap = makeGroup(doc, [sub.id, a.id]);
  assert.deepEqual([wrap.groupId, sub.groupId, a.groupId], [top.id, wrap.id, sub.id]);
  assert.deepEqual(again(doc).doc, doc);
});

test('nested groups: deleting a group alone puts what was in it in the group above, looking the same; with its members, everything below goes', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]), b = addPoint(doc, [1, 0]);
  const top = makeGroup(doc, [a.id, b.id]);
  top.look = { stroke: { color: '#333333' } };
  const sub = makeGroup(doc, [a.id]);
  sub.look = { fill: { color: '#444444' } };
  const inner = makeGroup(doc, [a.id]);
  const before = styleOf(doc, a);
  assert.deepEqual(dependents(doc, [top.id], true), new Set([top.id, a.id, b.id, sub.id, inner.id]));
  const kept = structuredClone(doc);
  remove(kept, [sub.id]);
  const [ka, ki] = [kept.points.find((p) => p.id === a.id), kept.groups.find((g) => g.id === inner.id)];
  assert.equal(ki.groupId, top.id, 'its subgroup now in the group above');
  assert.equal(ka.groupId, inner.id);
  assert.deepEqual(styleOf(kept, ka), before, 'looking the same');
  remove(doc, [top.id], true);
  assert.deepEqual([doc.points.length, doc.groups.length], [0, 0]);
});

test('nested groups in the file: the parent kept; one missing or making a loop puts the group at the top', () => {
  const { doc, report } = read(collection([F('p', 'Point', [0, 0], { kind: 'point', group: 'c' })], { format: FORMAT, version: VERSION, groups: [
    { id: 'a', look: { stroke: { color: '#ff0000' } } }, { id: 'b', groupId: 'a' }, { id: 'c', groupId: 'b' }, // a's look: not read (a group has none)
    { id: 'x', groupId: 'y' }, { id: 'y', groupId: 'x' }, { id: 'z', groupId: 'nowhere' }] }));
  const by = Object.fromEntries(doc.groups.map((g) => [g.id, g.groupId]));
  assert.deepEqual([by.a, by.b, by.c, by.z], [null, 'a', 'b', null]);
  assert.ok(by.x === null || by.y === null, 'a loop broken');
  warned(report, /group nowhere not found; now at the top/);
  warned(report, /in a group inside itself; now at the top/);
  assert.ok(!('look' in doc.groups[0]) && styleOf(doc, doc.points[0]).stroke.color === DEFAULT_STYLE.stroke.color, 'nothing from the groups');
  assert.equal(toFile(doc).charts.groups.find((g) => g.id === 'c').groupId, 'b');
  assert.deepEqual(again(doc).doc, doc);
});

test('the look: the drawing\'s defaults, then its own (a group adds nothing); a measurement keeps its name off; written where each belongs', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]), b = addPoint(doc, [1, 0]);
  const m = lineFrom(doc, [0, 0], [], [1, 1], { guide: true, look: { text: { values: true } } });
  const s = lineFrom(doc, a.id, [], b.id);
  doc.look = { text: { name: true }, offset: 4 };
  assert.deepEqual([d.lookOf(doc, a).text.name, d.lookOf(doc, m).text.name, offsetOf(doc, s)], [true, false, 4]);
  makeGroup(doc, [a.id, s.id]);
  d.setLook(a, 'text.name', false); // its own, over the drawing's
  assert.deepEqual([d.lookOf(doc, a).text.name, d.lookOf(doc, b).text.name, offsetOf(doc, s)], [false, true, 4]);
  d.setLook(a, 'text.name', undefined); // taken back
  assert.deepEqual(a.look, {});
  const f = toFile(doc);
  assert.deepEqual(f.charts.look, { text: { name: true }, offset: 4 });
  assert.ok(!('look' in f.charts.groups[0]));
  assert.deepEqual(f.features.find((x) => x.id === m.id).properties.charts.look, { text: { values: true } });
  assert.deepEqual(again(doc).doc, doc);
});

test('the file\'s text: number pairs on one line, the user\'s text never touched', () => {
  const doc = d.emptyDoc(NOW);
  d.addPoint(doc, [12.5, 41.25], { name: 'grid [ 3, 4 ]', properties: [{ key: 'k', value: '[  10,  20 ]' }] });
  const text = serialise(doc);
  assert.ok(text.includes('[12.5, 41.25]'));
  assert.deepEqual([parse(text, null, NOW).doc.points[0].name, parse(text, null, NOW).doc.points[0].properties[0].value], ['grid [ 3, 4 ]', '[  10,  20 ]']);
});

test('hardening: a property key named like Object.prototype\'s is a column like any other; a layer so named is not "known"; caps on properties, text, positions', () => {
  const { doc, view, report } = read(collection([
    F('p', 'Point', [12, 41], { kind: 'point', properties: [{ key: 'toString', value: 'a' }, { key: '__proto__', value: 'b' }, { key: 'constructor', value: 'c' }] }, { name: 'x'.repeat(20000) }),
    F('s', 'LineString', Array.from({ length: 100001 }, (_, i) => [12 + i * 1e-6, 41]), { kind: 'line' }),
    F('q', 'Polygon', [[...Array.from({ length: 100001 }, (_, i) => [12 + i * 1e-6, 41]), [12, 41]]], { kind: 'area' }),
    F('t', 'Point', [12, 41], { kind: 'point', properties: Array.from({ length: 250 }, (_, i) => ({ key: `k${i}`, value: '1' })) }),
  ], { view: { center: [12, 41], zoom: 5, layers: [{ id: '__proto__' }, { id: 'constructor' }], data: { colour: { id: 'toString' } } } }), { layers: { chart: { variants: null, periods: null } }, data: {}, depths: [] });
  const p = doc.points.find((n) => n.id === 'p');
  assert.deepEqual(p.properties.map((x) => x.key), ['toString', '__proto__', 'constructor']);
  assert.equal(p.name.length, 10000);
  assert.equal(doc.points.find((n) => n.id === 't').properties.length, 200);
  assert.deepEqual(doc.lines.length, 0, 'too many positions: skipped');
  assert.deepEqual(report.skipped.map((x) => x.id).sort(), ['q', 's']);
  assert.deepEqual(view.layers, [], 'neither "__proto__" nor "constructor" is a layer the app offers');
  assert.equal(view.data.colour, null);
  for (const re of [/cut to 10000 characters/, /more than 200 properties/, /layer "__proto__" not known/, /layer "constructor" not known/, /colour: "toString" not known/]) warned(report, re);
  // the columns of the export keep every key as it is: toString, not toString_2
  const cols = Object.entries(toFile(doc).features.find((f) => f.id === 'p').properties).filter(([k]) => k !== 'charts' && k !== 'name');
  assert.deepEqual(cols, [['toString', 'a'], ['__proto__', 'b'], ['constructor', 'c']]);
  assert.ok(!toFile(doc).features.find((f) => f.id === 'p').properties.charts.properties, 'no key had to be renamed');
  const back = read(JSON.stringify(toFile(doc))).doc.points.find((n) => n.id === 'p');
  assert.deepEqual(back.properties, p.properties, 'read back as they were');
});

test('root weights: read as given, small ones kept; 0, a negative, text read as 1; written as read', () => {
  const pts = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [12, 40] }, properties: { charts: { kind: 'point' } } }));
  const { doc } = read(collection(pts, { rules: [{ id: 'c1', kind: 'connect', pointIds: ['a'],
    roots: [{ id: 'a', weight: 2 }, { id: 'b', weight: 0.0004 }, { id: 'c', weight: 0 }, { id: 'd', weight: -1 }, { id: 'e', weight: 'x' }] }] }));
  assert.deepEqual(doc.rules[0].roots.map((r) => r.weight), [2, 0.0004, 1, 1, 1]);
  assert.deepEqual(again(doc).doc.rules[0].roots.map((r) => r.weight), [2, 0.0004, 1, 1, 1], 'the file keeps a small weight');
});

test('a file of more than a million positions is refused, as soon as that is known', () => {
  const line = (id) => ({ type: 'Feature', id, geometry: { type: 'LineString', coordinates: Array.from({ length: 100000 }, (_, i) => [12 + i * 1e-6, 41]) }, properties: {} });
  const { doc, report } = read(collection(Array.from({ length: 11 }, (_, i) => line(`l${i}`))));
  assert.equal(doc, null);
  assert.match(report.refused, /^This file holds more than 1,000,000 positions/);
});

test('a feature whose geometry type is not text is skipped with a reason, not thrown', () => {
  const { doc, report } = read({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 7, coordinates: [1, 2] } }, { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }] });
  assert.equal(doc.points.length, 1);
  assert.deepEqual(report.skipped.map((s) => s.reason), ['geometry type: not text']);
});

test('order: moved before one of its kind (into its group), or a step among its siblings; drawn first on top', async () => {
  const { drawParts } = await import('../../site/draw/features.js');
  const doc = emptyDoc(NOW);
  const [a, b, c] = [0, 1, 2].map((i) => addRing(doc, [[i, 0], [i + 1, 0], [i, 1]]));
  const p = addPoint(doc, [5, 5]);
  const g = makeGroup(doc, [c.id]);
  d.moveBefore(doc, c.id, a.id); // out of g, into a's (none), just before it
  assert.deepEqual([doc.lines.map((x) => x.id), c.groupId], [[c.id, a.id, b.id], null]);
  d.moveBefore(doc, p.id, b.id); // another kind: nothing
  assert.deepEqual(doc.lines.map((x) => x.id), [c.id, a.id, b.id]);
  setGroup(doc, b.id, g.id);
  d.moveStep(doc, a.id, -1); // up among its siblings (not grouped): c
  assert.deepEqual(doc.lines.map((x) => x.id), [a.id, c.id, b.id]);
  d.moveStep(doc, b.id, -1); // alone in its group: stays
  assert.deepEqual(doc.lines.map((x) => x.id), [a.id, c.id, b.id]);
  const z = Object.fromEntries(drawParts(doc).base.filter((f) => f.properties.kind === 'polygon').map((f) => [f.properties.id, f.properties.z]));
  assert.ok(z[a.id] > z[c.id] && z[c.id] > z[b.id], 'the first drawn on top');
  assert.deepEqual(again(doc).doc.lines.map((x) => x.id), [a.id, c.id, b.id]); // the order kept in the file
});
