import { test } from 'node:test';
import assert from 'node:assert/strict';

const d = await import('../../site/draw/document.js');
const { parse, serialise, toFile } = await import('../../site/draw/file.js');
const { refreshAttached, lineRef, resolve } = await import('../../site/draw/attach.js');
const { distributions, connections } = await import('../../site/draw/generator.js');
const { emptyDoc, addPoint, addDot, addShape, addLine, addArea, addLabel, addPart, removePart, makePart, dependents, remove, idsOf, newId, nextName,
  label, styleOf, offsetOf, isShown, isMeasurement, placeOf, makeGroup, setGroup, splitLine,
  DEFAULT_STYLE, GUIDE_STYLE, FORMAT, VERSION } = d;

const NOW = Date.parse('2026-10-22T10:00:00Z');
const warned = (r, re) => assert.ok(r.warnings.some((w) => re.test(w)), `no warning ${re}: ${r.warnings.join(' | ')}`);
const skippedIds = (r) => r.skipped.map((s) => s.id);
// a file of now: a FeatureCollection (charts: the collection's own member)
const F = (id, type, coordinates, charts, props = {}) => ({ type: 'Feature', id, geometry: { type, coordinates }, properties: charts ? { ...props, charts } : props });
const collection = (features, charts = { format: FORMAT, version: VERSION }) => ({ type: 'FeatureCollection', ...(charts ? { charts } : {}), features });
const read = (o, known = null) => parse(typeof o === 'string' ? o : JSON.stringify(o), known, NOW);
const again = (doc, known = null) => parse(serialise(doc), known, NOW);

// a document as the file holds it: values rounded as the writer rounds them (positions 7 decimals,
// metres and pixels 3, angles 4)
const r = (n) => (v) => (typeof v === 'number' ? +v.toFixed(n) : v);
const ROUND = { position: 7, pos: 7, center: 7, points: 7,
  radius: 3, length: 3, width: 3, at: 6, offset: 3, minSize: 3, opacity: 3, bearing: 4, aperture: 4, zoom: 4 };
function rounded(x, n = null) {
  if (Array.isArray(x)) return x.map((y) => rounded(y, n));
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, rounded(v, k in ROUND ? ROUND[k] : n)]));
  return n === null ? x : r(n)(x);
}

// a drawing made by the operations, one of each kind and most of their parts
function sample() {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [12, 41]), b = addPoint(doc, [12.2, 41.1]);
  b.bearing = 30;
  Object.assign(b.parts[0], { kind: 'sector', aperture: 120, shown: false, name: 'inner' });
  addPart(b, 'sector');
  addPart(b, 'triangle');
  addShape(doc, [12.1, 41], 'ellipse').bearing = 45;
  addDot(doc, [12.3, 41]);
  const l = addLine(doc, a.id, [[12.1, 41.2]], b.id);
  l.look.stroke = { ...d.GUIDE_STROKE }; // its own, though as a guide's
  l.properties = [{ key: 'name', value: 'x' }, { key: 'k', value: 'v' }, { key: 'k', value: 'w' }];
  const free = addLine(doc, [13, 40], [], [13.5, 40.5]);
  free.smooth = true;
  free.look.offset = 4;
  addArea(doc, [[12, 40], [12, 40.5], [12.5, 40.5]]).look = { fill: { color: '#123456', opacity: 0.5 }, stroke: { dash: 'dotted' } };
  addArea(doc, [[12, 40], [12.5, 40], [12.5, 40.5]]);
  addLabel(doc, lineRef(doc, l, 10));
  addLabel(doc, { position: [12, 40] });
  addLabel(doc, { position: [12, 41], element: a.id });
  addLabel(doc, { position: [12, 40], element: doc.areas[0].id, vertex: 1 });
  addLabel(doc, { position: [12, 40], element: doc.points[2].id, edge: 2, at: 0.25 });
  addLabel(doc, { position: [12, 40], element: b.id, part: 2, vertex: 1 }); // on an outline part's corner
  makeGroup(doc, [b.id]);
  // measurements: guides showing their values
  const m = () => ({ guide: true, look: { text: { values: true } } });
  addPoint(doc, [12, 41], { name: 'Ring 1', symbol: 'none', parts: [makePart('circle', { radius: 500 })], ...m() });
  addLine(doc, [12, 41], [[12.5, 41]], [13, 41], { name: 'Distance 1', ...m() });
  addArea(doc, [[12, 41], [12.5, 41], [13, 42]], m());
  doc.view = { center: [12.5, 41.9], zoom: 7.25, bearing: 10, layers: [{ id: 'chart' }], data: null, units: 'nm', bearings: true };
  doc.look = { minSize: 20 }; // the drawing's
  refreshAttached(doc); // each reference where it points
  return doc;
}

// ---- the file: reading, writing ------------------------------------------------------------------

test('refused: not JSON, not an object, neither GeoJSON nor a drawing, another format version', () => {
  for (const [text, re] of [['{', /not JSON/], ['[1]', /no document/], ['{"format":"x"}', /neither a drawing file nor GeoJSON/],
    ['{"type":"Topology"}', /neither/], [JSON.stringify(collection([], { version: VERSION + 1 })), /format version 2; this app reads version 1/],
    [JSON.stringify(collection([], { version: 0 })), /format version 0/]]) {
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
  assert.equal(doc.view, null);
  assert.deepEqual(doc.look, {});
  assert.deepEqual(doc.points[0], { id: 'n1', name: '', properties: [], groupId: null, visible: true, guide: false,
    position: [12, 41], bearing: 0, symbol: 'none', parts: [], look: {} });
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
  const p = addPoint(doc, [12.123456789, 41.987654321], { bearing: 45.123456, parts: [makePart('sector', { radius: 1000.12345, aperture: 90.000049 })] });
  p.look = { fill: { opacity: 0.123456 }, stroke: { width: 2.00049 } };
  const s = addLine(doc, [1.000000049, 2], [[1.5, 2.12345678]], p.id, { look: { offset: 3.33333 } });
  addLabel(doc, lineRef(doc, s, 1500.12345)).offset = [10.12345, -20.98765];
  addArea(doc, [[0, 0], [1.123456789, 0], [1, 1]]);
  Object.assign(addShape(doc, [3, 3]).parts[0], { length: 120.12345, width: 40.98765 });
  const f = toFile(doc);
  assert.deepEqual(f.features[0].geometry.coordinates, [12.1234568, 41.9876543]);
  assert.deepEqual(f.features[0].properties.charts.parts, [{ kind: 'sector', radius: 1000.123, aperture: 90 }]);
  assert.deepEqual(f.features.find((x) => x.geometry.coordinates[0] === 3).properties.charts.parts, [{ kind: 'rectangle', length: 120.123, width: 40.988 }]);
  assert.equal(f.features[0].properties['fill-opacity'], 0.123);
  assert.equal(f.features[0].properties.charts.bearing, 45.1235);
  const { doc: back } = again(doc);
  // a label's anchor: where it points in the drawing read (the file holds what, not where)
  const want = rounded(doc), at = back.labels[0].anchor.position;
  assert.deepEqual(at, resolve(back, back.labels[0].anchor).position);
  assert.ok(Math.abs(at[0] - doc.labels[0].anchor.position[0]) < 1e-6 && Math.abs(at[1] - doc.labels[0].anchor.position[1]) < 1e-6);
  want.labels[0].anchor.position = at;
  assert.deepEqual(back, want);
  assert.equal(back.lines[0].end.position[0], back.points[0].position[0]); // the attached end where its point is
});

test('defaults are left out of the file; positions on one line', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [12, 41]);
  addDot(doc, [12.5, 41]);
  addShape(doc, [13, 41]);
  addLine(doc, a.id, [], [14, 41]);
  addArea(doc, [[0, 0], [1, 0], [1, 1]]);
  addLabel(doc, { position: [12, 41], element: a.id });
  const text = serialise(doc), f = JSON.parse(text);
  assert.deepEqual(Object.keys(f), ['type', 'charts', 'features']);
  assert.deepEqual(f.charts, { format: FORMAT, version: VERSION, created: '2026-10-22T10:00:00Z', modified: '2026-10-22T10:00:00Z' });
  const [pt, dot, shape, line, area, lab] = f.features;
  assert.deepEqual(pt, { type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [12, 41] },
    properties: { name: 'Point 1', charts: { kind: 'point', symbol: 'diamond', parts: [{ kind: 'circle', radius: 1000 }] } } }); // its symbol: written (the default is none); a part's Fill and Shown: on
  assert.deepEqual(dot.properties.charts, { kind: 'point', symbol: 'dot' }); // no parts: none written
  assert.deepEqual(shape.properties.charts, { kind: 'point', parts: [{ kind: 'rectangle', length: 100, width: 50 }] }); // no symbol: the default
  assert.deepEqual(line.properties.charts, { kind: 'line', start: { element: a.id } });
  assert.deepEqual(line.geometry, { type: 'LineString', coordinates: [[12, 41], [14, 41]] });
  assert.deepEqual(area.properties.charts, { kind: 'area' });
  assert.deepEqual(lab.properties.charts, { kind: 'label', text: '{name}', anchor: { element: a.id } });
  assert.deepEqual(lab.geometry.coordinates, [12, 41]); // where it points
  assert.match(text, /"coordinates": \[12, 41\]/);
});

test('areas are written counter-clockwise; one stored clockwise says so and reads back as it was', () => {
  const doc = emptyDoc(NOW);
  const cw = addArea(doc, [[0, 0], [0, 1], [1, 1]]), ccw = addArea(doc, [[0, 0], [1, 0], [1, 1]]);
  const [fa, fb] = toFile(doc).features;
  assert.deepEqual(fa.geometry.coordinates, [[[1, 1], [0, 1], [0, 0], [1, 1]]]); // closed
  assert.equal(fa.properties.charts.reversed, true);
  assert.deepEqual(fb.geometry.coordinates, [[[0, 0], [1, 0], [1, 1], [0, 0]]]);
  assert.ok(!('reversed' in fb.properties.charts));
  const back = again(doc).doc;
  assert.deepEqual(back.areas.map((x) => x.points), [cw.points, ccw.points]);
});

test('properties: the user\'s as columns, a key colliding with the feature\'s own renamed, the list kept; the common style names', () => {
  const doc = emptyDoc(NOW);
  const p = addPoint(doc, [0, 0], { properties: [{ key: 'description', value: 'about it' }, { key: 'category', value: 'kind A' }, { key: 'depth', value: '120' }, { key: 'stroke', value: 'thin' }, { key: 'depth', value: 'again' }] });
  p.look = { stroke: { color: '#ff0000', width: 3, opacity: 0.5, dash: 'dashed' }, fill: { color: '#00ff00', opacity: 0.25 } };
  const q = addPoint(doc, [1, 0], { properties: [{ key: 'a', value: '1' }] });
  const [fp, fq] = toFile(doc).features;
  assert.deepEqual(fp.properties, { name: 'Point 1', description: 'about it', category: 'kind A', depth: '120', p_stroke: 'thin', depth_2: 'again',
    stroke: '#ff0000', 'stroke-width': 3, 'stroke-opacity': 0.5, fill: '#00ff00', 'fill-opacity': 0.25, charts: fp.properties.charts });
  assert.deepEqual(fp.properties.charts.properties, p.properties); // the keys as they are
  assert.deepEqual(fp.properties.charts.look, { stroke: { dash: 'dashed' } }); // the rest of its look: the app's
  assert.ok(!('properties' in fq.properties.charts)); // nothing renamed: the columns are enough
  assert.equal(fq.properties.a, '1');
  const back = again(doc).doc;
  assert.deepEqual([back.points[0].properties, back.points[0].look, back.points[1].properties], [p.properties, p.look, q.properties]);
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
  assert.deepEqual([doc.lines, doc.areas], [[], []]);
  assert.deepEqual(skippedIds(report), ['far', 'nopos', 'short', 'one', 'badvertex', 'two', 'noring', '10', 'nogeo', 'gc', 'odd']);
  const why = Object.fromEntries(report.skipped.map((s) => [s.id, s.reason]));
  assert.match(why.far, /out of range/);
  assert.match(why.nopos, /not \[longitude, latitude\]/);
  assert.match(why.one, /two positions/);
  assert.match(why.badvertex, /position 2/);
  assert.match(why.two, /3 corners/);
  assert.match(why['10'], /not a Feature/);
  assert.match(why.nogeo, /no geometry/);
  assert.match(why.gc, /geometry collection/);
  assert.match(why.odd, /Curve: not read/);
});

test('repairs: symbol, angles, sizes, Offset, style values, parts, flags', () => {
  const st = { stroke: '#FF0000', 'stroke-width': 99, 'stroke-opacity': 2, fill: 'red' };
  const { doc, report } = read(collection([
    F('p1', 'Point', [0, 0], { kind: 'point', symbol: 'star', bearing: -90, look: { minSize: -3, stroke: { dash: 'wavy' }, text: { name: 'yes' } },
      parts: [{ kind: 'circle', radius: 100 }, { kind: 'circle', radius: 200 }, { kind: 'circle', radius: 0 }, { kind: 'circle', radius: 2e7 }, 'x',
        { kind: 'sector', radius: 300, aperture: 400 }] }, st),
    F('p2', 'Point', [0, 0], { kind: 'point', look: { minSize: 900 },
      parts: [{ kind: 'hovercraft', length: 10, width: 4 }, { kind: 'sector', radius: 5, aperture: 0 }, { kind: 'circle', radius: 1, fill: false, shown: false, name: 7 },
        { kind: 'circle', radius: 2, fill: 'no', shown: 0 }] }),
    F('p3', 'Point', [0, 0], { kind: 'point', parts: [{ kind: 'rectangle', length: 0, width: 4 }, { kind: 'sector', radius: 50 }, { kind: 'sector', radius: 60, aperture: 360 },
      { kind: 'ellipse', length: 10, width: 4, aperture: 30, radius: 9 }, { kind: 'sector', radius: 70, aperture: 45, length: 3 }, { kind: 'triangle', length: 10 }] }),
    F('s1', 'LineString', [[0, 0], [1, 0]], { kind: 'line', look: { offset: -99 }, smooth: 'yes' }),
    F('s2', 'LineString', [[0, 0], [1, 0]], { kind: 'line', look: { offset: 99 } }),
    F('s3', 'LineString', [[0, 0], [1, 0]], { kind: 'line', look: { offset: true } }),
  ]));
  const [p1, p2, p3] = doc.points, [s1, s2, s3] = doc.lines;
  assert.deepEqual([p1.symbol, p1.bearing, p1.look.minSize, p1.look.text, d.lookOf(doc, p1).text.name], ['none', 270, undefined, undefined, false]); // not valid: left out, the drawing's applies
  assert.deepEqual(p1.parts.map((x) => [x.kind, x.radius, x.fill, x.shown]), [['circle', 100, true, true], ['circle', 200, true, true], ['circle', 300, true, true]]); // a sector of 360° or more: a circle
  assert.ok(!('aperture' in p1.parts[2]));
  assert.deepEqual([p1.look.fill, p1.look.stroke], [undefined, { color: '#ff0000', width: 20, opacity: 1 }]); // the bad colour and dash dropped: the group's, else the defaults
  assert.deepEqual([p2.symbol, p2.look.minSize], ['none', undefined]); // a point has none of its own
  assert.deepEqual(p2.parts, [makePart('circle', { radius: 5 }), { ...makePart('circle', { radius: 1 }), fill: false, shown: false, name: '7' }, makePart('circle', { radius: 2 })]); // Fill and Shown: on unless false
  assert.deepEqual(p3.parts, [makePart('circle', { radius: 50 }), makePart('circle', { radius: 60 }), makePart('ellipse', { length: 10, width: 4 }), makePart('sector', { radius: 70, aperture: 45 })]); // only a kind's own sizes kept
  assert.equal(p3.symbol, 'none');
  assert.deepEqual([s1.look.offset, s1.smooth], [-d.MAX_OFFSET, false]); // clamped either side
  assert.deepEqual([s2.look.offset, s3.look.offset], [d.MAX_OFFSET, undefined]); // true or false is not a number of pixels
  for (const re of [/unknown symbol "star"/, /bearing -90 read as 270/, /aperture 400 read as a full circle/, /aperture: not an angle above 0; a circle/,
    /unknown dash "wavy"/, /look text name: not true or false, ignored/, /part 3 skipped: radius not between/, /part 4 skipped: radius not between/, /part 5 skipped: not an object/,
    /part 1 skipped: unknown kind "hovercraft"/, /part 3 name: number made text/, /part 1 skipped: length or width not above 0/, /part 2: a sector with no aperture; a circle/,
    /part 6 skipped: length or width not above 0/, /stroke width 99 clamped to 20/, /stroke opacity 2 clamped to 1/, /fill colour: not a #rrggbb/,
    /Offset: not a number/, /smooth is not true or false/]) warned(report, re);
  assert.equal(report.warnings.filter((w) => /aperture/.test(w)).length, 3); // those three; a sector of exactly 360°: a circle, quietly
});

test('parts: named by their place, without IDs; an ID in the file is ignored and never written', () => {
  const { doc, report } = read(collection([
    F('n1', 'Point', [0, 0], { kind: 'point', parts: [{ id: 'r1', kind: 'circle', radius: 100 }] }),
    F('r1', 'Point', [0, 0], { kind: 'point' }), // a point with what was a part's ID: its own
    F('n2', 'Point', [0, 0], { kind: 'point', parts: [{ id: 'r1', kind: 'circle', radius: 200 }, { id: 'bad id', kind: 'circle', radius: 300, fill: false }] }),
  ]));
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(doc.points.map((p) => p.id), ['n1', 'r1', 'n2']);
  assert.deepEqual(doc.points[2].parts, [makePart('circle', { radius: 200 }), { ...makePart('circle', { radius: 300 }), fill: false }]);
  assert.ok(doc.points.every((p) => p.parts.every((x) => !('id' in x))));
  assert.deepEqual(idsOf(doc), new Set(['n1', 'r1', 'n2'])); // parts take no ID
  const f = toFile(doc);
  assert.deepEqual(f.features[2].properties.charts.parts, [{ kind: 'circle', radius: 200 }, { kind: 'circle', radius: 300, fill: false }]);
  assert.ok(!/"id"/.test(JSON.stringify(f.features.map((x) => x.properties.charts.parts ?? []))));
});

test('parts in the file: only what differs from the defaults, sizes rounded; no outline, radii or aperture on a point', () => {
  const doc = emptyDoc(NOW);
  addPoint(doc, [0, 0], { bearing: 10, parts: [makePart('circle', { radius: 100.00049 }), { ...makePart('sector', { radius: 200, aperture: 33.333333 }), fill: false, shown: false, name: 'b' },
    makePart('underwater-vehicle', { length: 12.34567, width: 2.5 })] });
  const c = toFile(doc).features[0].properties.charts;
  assert.deepEqual(c.parts, [{ kind: 'circle', radius: 100 }, { kind: 'sector', radius: 200, aperture: 33.3333, fill: false, shown: false, name: 'b' },
    { kind: 'underwater-vehicle', length: 12.346, width: 2.5 }]);
  assert.ok(!('outline' in c) && !('radii' in c) && !('aperture' in c));
  const back = again(doc).doc.points[0];
  assert.deepEqual(back.parts, rounded(doc.points[0].parts));
  // the old fields of a point are not read
  const old = read(collection([F('p', 'Point', [0, 0], { kind: 'point', outline: { kind: 'rectangle', length: 10, width: 5 }, radii: [{ value: 100, primary: true }], aperture: 90 })])).doc.points[0];
  assert.deepEqual(old.parts, []);
  assert.ok(!('outline' in old) && !('radii' in old) && !('aperture' in old));
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
  assert.equal(doc.view, null);
  const [a, b] = doc.points;
  assert.equal(a.id, 'mp'); // the first part keeps the feature's ID, the others get new ones
  assert.match(b.id, /^[a-z0-9]{8}$/);
  assert.deepEqual([a.position, b.position], [[1, 1], [2, 2]]); // the altitude dropped
  assert.deepEqual([a.symbol, a.parts, a.name], ['diamond', [], 'Twin']);
  assert.deepEqual(a.properties, [{ key: 'depth', value: '12' }, { key: 'flag', value: 'true' }, { key: 'nested', value: '{"a":1}' }, { key: 'Description', value: 'two of them' }]); // a description: a property like any other
  assert.deepEqual(doc.lines.map((s) => [s.name, s.vertices.length, s.start.element, s.look]), [['Pair', 0, null, { stroke: { color: '#00aa00', width: 3 } }], ['Pair', 1, null, { stroke: { color: '#00aa00', width: 3 } }]]);
  assert.equal(doc.areas.length, 3);
  assert.deepEqual(doc.areas[0].points, [[0, 0], [2, 0], [2, 2], [0, 2]]); // the ring open, its outer edge only
  assert.deepEqual(doc.areas[2].look, { fill: { color: '#0000ff', opacity: 0.4 } });
  assert.ok(doc.areas.every((x) => !x.guide && !d.lookOf(doc, x).text.values));
  // a bare Feature, and a bare geometry
  assert.deepEqual(read(F('one', 'Point', [3, 4])).doc.points.map((p) => [p.id, p.position]), [['one', [3, 4]]]);
  assert.deepEqual(read({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }).doc.lines[0].end.position, [1, 1]);
});

test('the app\'s own written back as text by another tool is read again', () => {
  const doc = sample();
  const f = toFile(doc);
  for (const x of f.features) x.properties.charts = JSON.stringify(x.properties.charts);
  const { doc: back, report } = read(f);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(back, doc);
});

test('attached ends: one that disagrees with what it is on moves to it (counted); one on what is not there (or no such vertex), or on its own line, is free', () => {
  const { doc, report } = read(collection([
    F('a', 'Point', [0, 0], { kind: 'point' }), F('b', 'Point', [1, 0], { kind: 'point' }), F('ar', 'Polygon', [[[0, 0], [1, 0], [1, 1], [0, 0]]], { kind: 'area' }),
    F('s1', 'LineString', [[0.001, 0], [0.5, 0.5], [1.002, 0]], { kind: 'line', start: { element: 'a' }, end: 'b' }), // a bare ID: read as its centre
    F('s2', 'LineString', [[0, 0], [2, 2]], { kind: 'line', start: 'a', end: { element: 'ar' } }), // an area's centre: its centroid
    F('s3', 'LineString', [[3, 3], [2, 2]], { kind: 'line', start: 'gone' }),
    F('s4', 'LineString', [[3, 3], [2, 2]], { kind: 'line', end: { element: 'ar', vertex: 3 } }),
    F('s5', 'LineString', [[4, 4], [5, 5]], { kind: 'line', start: { element: 's5', vertex: 1 } }),
  ]));
  const [s1, s2, s3, s4, s5] = doc.lines;
  assert.deepEqual([s1.start, s1.end], [{ position: [0, 0], element: 'a' }, { position: [1, 0], element: 'b' }]);
  assert.deepEqual(s1.vertices[0].position, [0.5, 0.5]); // the vertices stay
  assert.deepEqual([s2.start.element, s2.end], ['a', { position: d.centroid(doc.areas[0].points), element: 'ar' }]);
  assert.deepEqual(s3.start, { position: [3, 3], element: null });
  assert.deepEqual(s4.end, { position: [2, 2], element: null });
  assert.deepEqual(s5.start, { position: [4, 4], element: null });
  warned(report, /^3 line ends moved to what they are attached to/);
  warned(report, /line s4: its end is attached to ar, which is not here \(or has no such vertex or edge\); free/);
  warned(report, /line s3: its start is attached to gone/);
  warned(report, /line s5: its start is attached to s5/);
});

test('labels: on an element, along a line, on a vertex, or free; checked; written back', () => {
  const { doc, report } = read(collection([
    F('a', 'Point', [12, 40], { kind: 'point', look: { text: { name: true } } }), F('s', 'LineString', [[12, 40], [13, 40]], { kind: 'line' }),
    F('ar', 'Polygon', [[[12, 41], [13, 41], [13, 42], [12, 41]]], { kind: 'area' }),
    F('l1', 'Point', [0, 0], { kind: 'label', text: '{name}', anchor: { element: 'a' }, offset: [10, -20], leader: 'none', look: { text: { size: 'large', color: '#AA0000', background: 'box' } } }),
    F('l2', 'Point', [0, 0], { kind: 'label', anchor: { element: 's', edge: 0, at: 0.123456789 } }),
    F('l3', 'Point', [12, 41], { kind: 'label', leader: 'zigzag', offset: 'far', look: { text: { size: 'huge' } } }),
    F('l4', 'Point', [12, 42], { kind: 'label', anchor: { element: 'gone' } }),
    F('l5', 'Point', [0, 0], { kind: 'label', anchor: { element: 's', edge: 0, at: -3 } }),
    F('l6', 'Point', [0, 0], { kind: 'label', anchor: { element: 'a', along: 10 } }), // no distance along a point
    F('l7', 'Point', [12, 99], { kind: 'label' }),
    F('l8', 'Point', [12, 43], { kind: 'label', anchor: { element: 'a', vertex: 0 } }), // a point without an outline: no vertices
    F('l9', 'Point', [0, 0], { kind: 'label', anchor: 'ar' }), // a bare ID: its centre
    F('l10', 'Point', [0, 0], { kind: 'label', anchor: { element: 'ar', vertex: 2 } }),
  ]));
  assert.deepEqual(doc.labels.map((x) => x.id), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l8', 'l9', 'l10']);
  assert.deepEqual(skippedIds(report), ['l7']);
  const [l1, l2, l3, l4, l5, l6, l8, l9, l10] = doc.labels;
  const text = (a) => d.lookOf(doc, a).text;
  assert.deepEqual([l1.leader, l1.offset, l1.look, l1.anchor], ['none', [10, -20], { text: { size: 'large', color: '#aa0000', background: 'box' } }, { position: [12, 40], element: 'a' }]);
  assert.deepEqual([l2.anchor.element, l2.anchor.edge, l2.anchor.at, l2.text, l2.leader, l2.look, text(l2).background], ['s', 0, 0.123456789, '', 'arrow', {}, 'halo']);
  assert.deepEqual(l2.anchor.position, resolve(doc, l2.anchor).position); // where it points
  assert.ok(Math.abs(resolve(doc, l2.anchor).along - 0.123456789 * resolve(doc, l2.anchor).length) < 1e-6);
  assert.deepEqual([l3.anchor, l3.leader, l3.offset, l3.look, text(l3).size], [{ position: [12, 41] }, 'arrow', [40, -40], {}, 'medium']);
  assert.deepEqual([l4.anchor, l5.anchor, l6.anchor], [{ position: [12, 42] }, { position: [12, 40], element: 's', edge: 0, at: 0 }, { position: [12, 40], element: 'a' }]);
  assert.deepEqual([l8.anchor, l9.anchor, l10.anchor], [{ position: [12, 43] }, { position: d.centroid(doc.areas[0].points), element: 'ar' }, { position: [13, 42], element: 'ar', vertex: 2 }]);
  assert.ok(!('name' in l1.look.text));
  for (const re of [/leader: unknown "zigzag"/, /offset: not \[x, y\]/, /size "huge" unknown/, /label l4: what it points at \(gone\) is not here; free/, /label l8: what it points at \(a\) is not here; free/]) warned(report, re);
  assert.deepEqual(doc.points[0].look, { text: { name: true } });
  const f = toFile(doc), out = (id) => f.features.find((x) => x.id === id);
  assert.deepEqual(out('l2').properties.charts.anchor, { element: 's', edge: 0, at: 0.123457 });
  assert.deepEqual([out('l1').properties.charts.anchor, out('l9').properties.charts.anchor, out('l10').properties.charts.anchor], [{ element: 'a' }, { element: 'ar' }, { element: 'ar', vertex: 2 }]);
  assert.ok(!('anchor' in out('l4').properties.charts)); // free: none
  assert.deepEqual(out('l1').geometry.coordinates, [12, 40]); // where it points
  assert.deepEqual(out('l10').geometry.coordinates, [13, 42]);
  l2.anchor.at = 0.123457; // as the file writes it
  l2.anchor.position = resolve(doc, l2.anchor).position;
  assert.deepEqual(again(doc).doc, doc);
});

test('groups in the file: a member\'s parts are its own (none when missing); a group\'s parts or sector not read; a missing group makes it standalone', () => {
  const { doc, report } = read(collection([
    F('m', 'Point', [0, 0], { kind: 'point', group: 'g' }),
    F('own', 'Point', [0, 0], { kind: 'point', group: 'g', parts: [{ kind: 'sector', radius: 1, aperture: 90 }] }),
    F('none', 'Point', [0, 0], { kind: 'point', group: 'g', parts: [] }),
    F('lost', 'Point', [0, 0], { kind: 'point', group: 'nowhere' }),
  ], { groups: [{ id: 'g', look: { fill: { color: '#ff0000' }, offset: 3 }, parts: [{ kind: 'circle', radius: 300 }], radii: [{ value: 300, primary: true }], aperture: 90 }] }));
  const [m, own, none, lost] = doc.points;
  const g = doc.groups[0];
  assert.ok(!('look' in g) && !('parts' in g) && !('radii' in g) && !('aperture' in g)); // a group is only who is in it
  assert.equal(offsetOf(doc, m), 0); // nothing from the group
  assert.equal(styleOf(doc, m).fill.color, DEFAULT_STYLE.fill.color);
  assert.deepEqual([m.parts, m.symbol, d.pointKind(m)], [[], 'none', 'point']);
  assert.deepEqual([own.parts.map((x) => [x.kind, x.radius, x.aperture]), own.symbol, d.pointKind(own)], [[['sector', 1, 90]], 'none', 'sector']);
  assert.deepEqual([none.parts, none.symbol], [[], 'none']);
  assert.deepEqual([lost.groupId, lost.parts], [null, []]);
  warned(report, /group nowhere not found; now standalone/);
  assert.ok(!('parts' in toFile(doc).charts.groups[0]) && !('radii' in toFile(doc).charts.groups[0]));
  assert.deepEqual(again(doc).doc, doc);
});

test('view: layers, variants and data checked against what the app offers', () => {
  const known = { layers: { chart: { variants: null, periods: null }, depth: { variants: ['atlas', 'nautical'], periods: null }, traffic: { variants: ['all', 't09'], periods: ['2024'] } },
    data: { waves: ['height', 'period'] }, depths: [0, 10] };
  const { doc, report } = read(collection([], { view: { center: [12.5, 41.9], zoom: 7.25, bearing: -10, units: 'nm', bearings: true,
    layers: [{ id: 'chart' }, { id: 'depth', variant: 'nautical', opacity: 0.8 }, { id: 'gone' }, { id: 'traffic', variant: 't99', period: '2024' }],
    data: { colour: { id: 'waves', variant: 'height' }, arrows: { id: 'wind', variant: null }, time: '2026-10-22T09:00:00Z', depth: 15 } } }), known);
  const v = doc.view;
  assert.deepEqual(v.layers, [{ id: 'chart' }, { id: 'depth', variant: 'nautical', opacity: 0.8 }, { id: 'traffic', period: '2024' }]);
  assert.deepEqual([v.bearing, v.units, v.bearings, 'minDisplaySize' in v], [350, 'nm', true, false]); // the drawing's look holds it
  assert.deepEqual(v.data, { colour: { id: 'waves', variant: 'height' }, arrows: null, time: '2026-10-22T09:00:00Z', depth: null });
  for (const re of [/layer "gone" not known/, /variant "t99" not known/, /arrows: "wind" not known/, /depth 15 not offered/]) warned(report, re);
  assert.equal(serialise(again(doc, known).doc), serialise(doc));
});

test('minimum display size: the drawing\'s, read, checked and written; a point has none of its own', () => {
  const { doc } = read(collection([
    F('a', 'Point', [12, 40], { kind: 'point', parts: [{ kind: 'rectangle', length: 10, width: 5 }], look: { minSize: 0 } }),
  ], { look: { minSize: 900 } }));
  assert.deepEqual([doc.look, doc.points[0].look.minSize, d.minSizeOf(doc)], [{ minSize: 200 }, undefined, 200]); // clamped; the point's not read
  const bad = read(collection([], { look: { minSize: -3 } }));
  warned(bad.report, /look minSize: not a number of pixels/);
  assert.equal(d.minSizeOf(bad.doc), 12); // the default
  assert.deepEqual(toFile(doc).charts.look, { minSize: 200 });
});

test('rules (distribute, connect) are kept as records; defaults left out; an unknown kind or a distribution along nothing skipped', () => {
  const copy = { symbol: 'square', parts: [{ kind: 'circle', radius: 300 }, { kind: 'rectangle', length: 400, width: 200, fill: false }] };
  const { doc, report } = read(collection([], { rules: [
    { id: 'a1', kind: 'distribute', groupId: 'g1', copiesId: 'g2', along: { element: 's', part: 2 }, spacing: 1000, side: 'alternate', radius: 250, preset: 'preset:mine', copy,
      points: [{ pointId: 'n1', t: 0.5, pos: [1, 2] }] },
    { id: 'a2', kind: 'distribute' }, { id: 'a3', kind: 'distribute', along: { element: 's', part: -1 } }, { id: 'a4', kind: 'distribute', along: { element: 's', part: 1.5 } },
    { id: 'a5', kind: 'distribute', along: {} },
    { id: 'c1', kind: 'connect', groupId: 'g3', groupSize: 3, roots: [{ id: 'n9' }, { id: 'n8', weight: 2 }, 'x'], pointIds: ['n1'], created: ['gone'] }, { id: 'c1', kind: 'connect' },
    { id: 'x1', kind: 'spiral' }, { id: 'x2' }] }));
  const [a] = distributions(doc), [c] = connections(doc);
  assert.deepEqual(doc.rules.map((x) => x.id), ['a1', 'a3', 'a4', 'c1']);
  assert.deepEqual(distributions(doc).map((x) => x.id), ['a1', 'a3', 'a4']); // a2, a5 are along nothing
  assert.deepEqual(report.skipped.filter((x) => x.kind === 'rule').map((x) => x.id), ['a2', 'a5', 'c1', 'x1', 'x2']);
  assert.ok(report.skipped.some((x) => x.id === 'x1' && /unknown kind "spiral"/.test(x.reason)));
  assert.deepEqual([a.kind, a.groupId, a.copiesId, a.along, a.spacing, a.side, a.offset, a.count, a.radius, a.aperture, a.preset, a.points[0].left],
    ['distribute', 'g1', 'g2', { element: 's', part: 2 }, 1000, 'alternate', 0, null, 250, null, 'preset:mine', false]);
  assert.deepEqual([a.copy.symbol, a.copy.parts], ['square', [makePart('circle', { radius: 300 }), { ...makePart('rectangle', { length: 400, width: 200 }), fill: false }]]);
  assert.deepEqual(distributions(doc).slice(1).map((x) => x.along.part), [null, null]); // not a place in the list: the part followed by default
  assert.deepEqual(distributions(doc).slice(1).map((x) => [x.groupId, x.copiesId, x.preset, x.copy]), [[null, null, null, null], [null, null, null, null]]);
  assert.equal(connections(doc).length, 1); // the second c1: its ID used
  assert.deepEqual([c.kind, c.groupId, c.pattern, c.groupSize, c.created, c.hubs, c.roots], ['connect', 'g3', 'tree', 3, ['gone'], [], [{ id: 'n9', weight: 1 }, { id: 'n8', weight: 2 }]]); // deleted since: not an error; a weight of 1 unless given
  const f = toFile(doc).charts;
  assert.deepEqual(f.rules[3], { id: 'c1', kind: 'connect', groupId: 'g3', groupSize: 3, roots: [{ id: 'n9' }, { id: 'n8', weight: 2 }], pointIds: ['n1'], created: ['gone'] });
  assert.deepEqual(f.rules[0], { id: 'a1', kind: 'distribute', groupId: 'g1', copiesId: 'g2', along: { element: 's', part: 2 }, spacing: 1000, side: 'alternate', radius: 250,
    preset: 'preset:mine', copy, points: [{ pointId: 'n1', t: 0.5, pos: [1, 2] }] });
  assert.deepEqual(f.rules[1], { id: 'a3', kind: 'distribute', along: { element: 's' }, points: [] });
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

test('operations: new elements, names, parts, IDs', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [12, 41]), b = addPoint(doc, [13, 41]);
  assert.deepEqual([a.name, b.name, a.symbol, a.parts.map((x) => [x.kind, x.radius, x.fill, x.shown])], ['Point 1', 'Point 2', 'diamond', [['circle', 1000, true, true]]]);
  b.name = 'Point 7';
  assert.equal(nextName(doc, 'point'), 'Point 8');
  const h = addShape(doc, [12, 41]);
  assert.deepEqual([h.name, h.symbol, h.parts], ['Shape 1', 'none', [{ kind: 'rectangle', fill: true, shown: true, name: '', length: 100, width: 50 }]]);
  assert.equal(addShape(doc, [12, 41], 'ellipse').parts[0].kind, 'ellipse');
  doc.points.pop();
  assert.equal(nextName(doc, 'point', 'Shape'), 'Shape 2');
  const j = addDot(doc, [12, 42]);
  assert.deepEqual([j.symbol, j.parts, d.pointKind(j), d.pointKind(a), d.pointKind(h)], ['dot', [], 'point', 'circle', 'rectangle']);
  const rr = addPart(a);
  assert.deepEqual(rr, { kind: 'circle', fill: false, shown: true, name: '', radius: 2000 }); // no ID; twice the last, not filled
  assert.equal(d.pointKind(a), 'rings');
  assert.equal(d.followedPart(a), 0);
  a.parts[0].fill = false; // none filled: the first followed
  assert.equal(d.followedPart(a), 0);
  a.parts[1].fill = true; // by its place in the list: the first filled
  assert.equal(d.followedPart(a), 1);
  a.parts[0].fill = true; // both filled: each its own Fill
  assert.deepEqual([a.parts.map((x) => x.fill), d.followedPart(a)], [[true, true], 0]);
  removePart(a, 1);
  assert.deepEqual(a.parts.map((x) => [x.radius, x.fill]), [[1000, true]]);
  removePart(a, 5); // no such place: nothing
  assert.equal(a.parts.length, 1);
  assert.deepEqual([addPart(j).fill, j.parts[0].radius], [true, 1000]); // the first round part: filled, of the new point's radius
  const sec = addPart(a, 'sector'), out = addPart(a, 'ellipse');
  assert.deepEqual([sec.kind, sec.radius, sec.aperture, sec.fill], ['sector', 2000, 90, false]);
  assert.deepEqual(addPart(a, 'sector').aperture, 90); // twice the last round one, its aperture
  assert.deepEqual([a.parts.at(-1).radius, a.parts.at(-1).aperture], [4000, 90]);
  assert.deepEqual([out.kind, out.length, out.width, out.fill], ['ellipse', 100, 50, true]); // an outline: the default size
  assert.equal(d.pointKind(a), 'ellipse');
  removePart(a, 3);
  removePart(a, 2);
  assert.equal(d.pointKind(a), 'sector');
  removePart(a, 1);
  const ids = idsOf(doc);
  assert.equal(ids.size, 4); // the points (parts take no ID)
  const before = new Set(ids);
  for (let i = 0; i < 200; i++) assert.ok(!before.has(newId(doc, ids)));
  assert.equal(ids.size, 204); // each new ID taken as it is made
  assert.match(a.id, /^[a-z0-9]{8}$/);
  a.name = '';
  assert.equal(label('point', a), 'Point · 41.0000, 12.0000');
  assert.equal(label('area', addArea(doc, [[0, 0], [3, 0], [0, 3]], { name: ' ' })), 'Area · 1.0000, 1.0000');
  assert.deepEqual(placeOf('area', doc.areas[0]), [1, 1]);
  const g = makeGroup(doc, []);
  assert.equal(label('group', { ...g, name: '' }), `Group ${g.id}`);
});

test('parts: round and outline ones by place, each one\'s reach, the largest outline, the part followed; the point\'s kind', () => {
  const doc = emptyDoc(NOW);
  const p = addPoint(doc, [0, 0], { parts: [makePart('rectangle', { length: 300, width: 400 }), { ...makePart('circle', { radius: 100 }), fill: false },
    makePart('triangle', { length: 500, width: 10 }), makePart('sector', { radius: 200, aperture: 30 })] });
  assert.deepEqual([d.isRound(p.parts[1]), d.isRound(p.parts[0]), d.ROUND, d.PART_KINDS], [true, false, ['circle', 'sector'], ['circle', 'sector', ...d.OUTLINES]]);
  assert.deepEqual(p.parts.map(d.reachOf), [150, 100, 250, 200]); // an outline: half its length, whatever its width
  assert.deepEqual(d.roundParts(p).map((x) => x.i), [1, 3]);
  assert.deepEqual(d.outlineParts(p).map((x) => x.i), [0, 2]);
  assert.deepEqual(d.mainOutline(p), { part: p.parts[2], i: 2 }); // by reach: the longer, not the wider
  assert.equal(d.followedPart(p), 3); // the first filled round part
  assert.equal(d.pointKind(p), 'triangle'); // the largest outline's kind
  p.parts = p.parts.filter((x) => d.isRound(x));
  assert.deepEqual([d.mainOutline(p), d.pointKind(p)], [null, 'sector']); // a sector among them
  p.parts[1].kind = 'circle';
  assert.equal(d.pointKind(p), 'rings');
  p.parts[1].fill = false;
  assert.equal(d.followedPart(p), 0); // none filled: the first round one
  p.parts = [makePart('ellipse')];
  assert.deepEqual([d.followedPart(p), d.pointKind(p)], [null, 'ellipse']);
});

test('lines: ends attached to points or free; vertices inserted and deleted', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [12, 41]);
  const s = addLine(doc, a.id, [[12.1, 41.1]], [12.2, 41]);
  assert.deepEqual([s.name, s.start, s.end, s.smooth, s.guide], ['Line 1', { position: [12, 41], element: a.id }, { position: [12.2, 41], element: null }, false, false]);
  assert.equal(doc.points.length, 1); // no point made for a free end
  assert.deepEqual(placeOf('line', s), [12, 41]);
  d.insertVertex(s, 1, [12.15, 41.05]);
  assert.deepEqual(s.vertices.map((v) => v.position), [[12.1, 41.1], [12.15, 41.05]]);
  d.deleteVertex(s, 0);
  assert.deepEqual(again(doc).doc, doc);
});

test('attached ends follow their point; a point gone leaves them free where they were', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]), b = addPoint(doc, [1, 0]);
  const s = addLine(doc, a.id, [], b.id), t = addLine(doc, b.id, [], [2, 0]);
  a.position = [0, 0.5];
  refreshAttached(doc);
  assert.deepEqual(s.start, { position: [0, 0.5], element: a.id });
  assert.deepEqual(dependents(doc, [b.id]), new Set([b.id])); // lines do not go with a point
  assert.deepEqual([...remove(doc, [b.id])], [b.id]);
  assert.deepEqual(doc.lines.map((x) => x.id), [s.id, t.id]);
  assert.deepEqual([s.end, t.start], [{ position: [1, 0], element: null }, { position: [1, 0], element: null }]);
  doc.points = []; // gone some other way
  refreshAttached(doc);
  assert.equal(s.start.element, null);
  assert.deepEqual(s.start.position, [0, 0.5]);
});

test('split a line at a vertex: a dot carrying the vertex\'s own, both lines attached to it', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]);
  const s = addLine(doc, a.id, [[1, 0], [2, 0], [3, 0]], [4, 0], { name: 'Main' });
  Object.assign(s.vertices[1], { name: 'bend', properties: [{ key: 'k', value: 'v' }] });
  const p = splitLine(doc, s.id, 1);
  const rest = doc.lines[1];
  assert.deepEqual([p.symbol, p.parts, p.name, p.properties, p.position], ['dot', [], 'bend', [{ key: 'k', value: 'v' }], [2, 0]]);
  assert.deepEqual([s.end, s.vertices.map((v) => v.position)], [{ position: [2, 0], element: p.id }, [[1, 0]]]);
  assert.deepEqual([rest.start, rest.end, rest.vertices.map((v) => v.position), rest.name],
    [{ position: [2, 0], element: p.id }, { position: [4, 0], element: null }, [[3, 0]], 'Line 1']);
  assert.notEqual(rest.id, s.id);
  assert.equal(splitLine(doc, s.id, 0).name, 'Point 2'); // an unnamed vertex: the next point's name
});

test('measurements: guides showing their values (a line, an area, a point with its radius), drawn as while measured', () => {
  const doc = emptyDoc(NOW), m = () => ({ guide: true, look: { text: { values: true } } });
  const r1 = addLine(doc, [12, 44], [[12.5, 44.2]], [13, 44], { ...m(), name: 'Distance 1' });
  const c = addPoint(doc, [14, 40], { ...m(), symbol: 'none', parts: [makePart('circle', { radius: 5000 })] });
  const a = addArea(doc, [[12, 44], [13, 44], [12.5, 45]], m());
  assert.ok([r1, c, a].every((x) => isMeasurement(doc, x)));
  assert.ok(!isMeasurement(doc, addPoint(doc, [0, 0], { look: { text: { values: true } } })) && !isMeasurement(doc, addPoint(doc, [0, 0], { guide: true })));
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

test('groups: made from a selection, only who is in it changes: members keep their own look and parts, joining or leaving', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [12, 41]), b = addPoint(doc, [12.1, 41]), h = addShape(doc, [12, 40]), j = addDot(doc, [13, 40]);
  const s = addLine(doc, a.id, [], b.id, { look: { offset: 6 } });
  a.parts[0].radius = 750;
  a.look.fill = { color: '#123456' };
  b.look.fill = { color: '#654321' };
  b.bearing = 20;
  Object.assign(b.parts[0], { kind: 'sector', aperture: 45 });
  const before = structuredClone([a, b, h, j, s].map((x) => [x.look, x.parts ?? null]));
  const g = makeGroup(doc, [h.id, b.id, a.id, j.id, s.id]);
  assert.equal(g.name, 'Group 1');
  assert.ok(!('look' in g) && !('parts' in g)); // a group has no look of its own
  assert.ok([a, b, h, j, s].every((x) => x.groupId === g.id));
  assert.deepEqual([a, b, h, j, s].map((x) => [x.look, x.parts ?? null]), before); // as they were
  assert.deepEqual([styleOf(doc, a).fill.color, styleOf(doc, b).fill.color, offsetOf(doc, s)], ['#123456', '#654321', 6]);
  setGroup(doc, a.id, null);
  setGroup(doc, s.id, null);
  assert.deepEqual([a.look, s.look], [{ fill: { color: '#123456' } }, { offset: 6 }]); // leaving: as it was too
  assert.deepEqual(again(doc).doc, doc);
});

test('a sector is the point\'s own: joining or leaving a group keeps it as it was', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [12, 41]), b = addPoint(doc, [12.1, 41]);
  Object.assign(a.parts[0], { kind: 'sector', aperture: 120 });
  const g = makeGroup(doc, [a.id, b.id]);
  assert.deepEqual([a.parts[0].aperture, b.parts[0].kind, d.pointKind(a), d.pointKind(b)], [120, 'circle', 'sector', 'circle']);
  Object.assign(b.parts[0], { kind: 'sector', aperture: 60 });
  b.bearing = 90; // facing its own way
  setGroup(doc, a.id, null);
  assert.equal(a.parts[0].aperture, 120);
  setGroup(doc, a.id, g.id);
  assert.equal(a.parts[0].aperture, 120);
  const back = again(doc).doc;
  assert.deepEqual(back.points.map((p) => [p.parts[0].aperture, p.bearing]), [[120, 0], [60, 90]]);
});

test('a label in a group keeps its own colour; else the default', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]);
  const l = addLabel(doc, { element: a.id }), m = addLabel(doc, { element: a.id });
  l.look.text = { color: '#111111' };
  makeGroup(doc, [l.id, m.id]);
  assert.deepEqual([d.labelColour(doc, l), d.labelColour(doc, m)], ['#111111', '#1f2933']);
});

test('delete a group: members ungrouped, keeping their own parts, or deleted with it; ends attached to them freed', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]), b = addPoint(doc, [1, 0]), c = addPoint(doc, [2, 0]);
  const s = addLine(doc, a.id, [], c.id);
  const g = makeGroup(doc, [c.id, b.id]);
  Object.assign(c.parts[0], { kind: 'sector', radius: 50, aperture: 30 });
  assert.deepEqual(dependents(doc, [g.id]), new Set([g.id]));
  assert.deepEqual(dependents(doc, [g.id], true), new Set([g.id, b.id, c.id]));
  const kept = structuredClone(doc);
  remove(kept, [g.id]);
  const [kb, kc] = [b.id, c.id].map((id) => kept.points.find((p) => p.id === id));
  assert.deepEqual([kc.groupId, kc.parts.map((x) => [x.kind, x.radius, x.aperture]), kept.groups], [null, [['sector', 50, 30]], []]);
  assert.deepEqual(kb.parts.map((x) => [x.kind, x.radius, x.aperture]), [['circle', 1000, undefined]]);
  assert.equal(kept.lines[0].end.element, c.id);
  const gone = structuredClone(doc);
  remove(gone, [g.id], true);
  assert.deepEqual(gone.points.map((p) => p.id), [a.id]);
  assert.deepEqual(gone.lines[0].end, { position: [2, 0], element: null }); // the line stays, its end free
  assert.equal(s.end.element, c.id); // the original untouched
});

test('delete a group: members ungrouped keep the group\'s style and colour as their own', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]);
  const s = addLine(doc, a.id, [], [1, 0]);
  const l = addLabel(doc, { element: a.id });
  const g = makeGroup(doc, [a.id, s.id, l.id]);
  g.look = { fill: { color: '#abcdef' }, stroke: { color: '#123456' } };
  const before = [styleOf(doc, a), styleOf(doc, s).stroke, d.labelColour(doc, l)];
  remove(doc, [g.id]);
  assert.deepEqual([styleOf(doc, a), styleOf(doc, s).stroke, d.labelColour(doc, l)], before);
});

test('nested groups: a group of members of a group is a subgroup of it; visibility comes down the chain', () => {
  const doc = emptyDoc(NOW);
  const a = addPoint(doc, [0, 0]), b = addPoint(doc, [1, 0]), c = addPoint(doc, [2, 0]);
  const s = addLine(doc, a.id, [], b.id);
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
  const m = addLine(doc, [0, 0], [], [1, 1], { guide: true, look: { text: { values: true } } });
  const s = addLine(doc, a.id, [], b.id);
  doc.look = { text: { name: true }, offset: 4, minSize: 20 };
  assert.deepEqual([d.lookOf(doc, a).text.name, d.lookOf(doc, m).text.name, offsetOf(doc, s), d.minSizeOf(doc)], [true, false, 4, 20]);
  makeGroup(doc, [a.id, s.id]);
  d.setLook(a, 'text.name', false); // its own, over the drawing's
  assert.deepEqual([d.lookOf(doc, a).text.name, d.lookOf(doc, b).text.name, offsetOf(doc, s)], [false, true, 4]);
  d.setLook(a, 'text.name', undefined); // taken back
  assert.deepEqual(a.look, {});
  const f = toFile(doc);
  assert.deepEqual(f.charts.look, { text: { name: true }, offset: 4, minSize: 20 });
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

test('hardening: a property key named like Object.prototype\'s is a column like any other; a layer so named is not "known"; caps on parts, properties, text, positions', () => {
  const { doc, report } = read(collection([
    F('p', 'Point', [12, 41], { kind: 'point', properties: [{ key: 'toString', value: 'a' }, { key: '__proto__', value: 'b' }, { key: 'constructor', value: 'c' }],
      parts: Array.from({ length: 150 }, () => ({ kind: 'circle', radius: 100 })) }, { name: 'x'.repeat(20000) }),
    F('s', 'LineString', Array.from({ length: 100001 }, (_, i) => [12 + i * 1e-6, 41]), { kind: 'line' }),
    F('q', 'Polygon', [[...Array.from({ length: 100001 }, (_, i) => [12 + i * 1e-6, 41]), [12, 41]]], { kind: 'area' }),
    F('t', 'Point', [12, 41], { kind: 'point', properties: Array.from({ length: 250 }, (_, i) => ({ key: `k${i}`, value: '1' })) }),
  ], { view: { center: [12, 41], zoom: 5, layers: [{ id: '__proto__' }, { id: 'constructor' }], data: { colour: { id: 'toString' } } } }), { layers: { chart: { variants: null, periods: null } }, data: {}, depths: [] });
  const p = doc.points.find((n) => n.id === 'p');
  assert.deepEqual(p.properties.map((x) => x.key), ['toString', '__proto__', 'constructor']);
  assert.equal(p.parts.length, 100);
  assert.equal(p.name.length, 10000);
  assert.equal(doc.points.find((n) => n.id === 't').properties.length, 200);
  assert.deepEqual([doc.lines.length, doc.areas.length], [0, 0], 'too many positions: skipped');
  assert.deepEqual(report.skipped.map((x) => x.id).sort(), ['q', 's']);
  assert.deepEqual(doc.view.layers, [], 'neither "__proto__" nor "constructor" is a layer the app offers');
  assert.equal(doc.view.data.colour, null);
  for (const re of [/more than 100 parts/, /cut to 10000 characters/, /more than 200 properties/, /layer "__proto__" not known/, /layer "constructor" not known/, /colour: "toString" not known/]) warned(report, re);
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
  const [a, b, c] = [0, 1, 2].map((i) => addArea(doc, [[i, 0], [i + 1, 0], [i, 1]]));
  const p = addPoint(doc, [5, 5]);
  const g = makeGroup(doc, [c.id]);
  d.moveBefore(doc, c.id, a.id); // out of g, into a's (none), just before it
  assert.deepEqual([doc.areas.map((x) => x.id), c.groupId], [[c.id, a.id, b.id], null]);
  d.moveBefore(doc, p.id, b.id); // another kind: nothing
  assert.deepEqual(doc.areas.map((x) => x.id), [c.id, a.id, b.id]);
  setGroup(doc, b.id, g.id);
  d.moveStep(doc, a.id, -1); // up among its siblings (not grouped): c
  assert.deepEqual(doc.areas.map((x) => x.id), [a.id, c.id, b.id]);
  d.moveStep(doc, b.id, -1); // alone in its group: stays
  assert.deepEqual(doc.areas.map((x) => x.id), [a.id, c.id, b.id]);
  const z = Object.fromEntries(drawParts(doc).base.filter((f) => f.properties.kind === 'polygon').map((f) => [f.properties.id, f.properties.z]));
  assert.ok(z[a.id] > z[c.id] && z[c.id] > z[b.id], 'the first drawn on top');
  assert.deepEqual(again(doc).doc.areas.map((x) => x.id), [a.id, c.id, b.id]); // the order kept in the file
});
