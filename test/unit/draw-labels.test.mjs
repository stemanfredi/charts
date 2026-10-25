import { test } from 'node:test';
import assert from 'node:assert/strict';

const { labelText, labelValues, TOKENS, leaderFrom, labelFeatures } = await import('../../site/draw/labels.js');
const { resolve: anchorAt } = await import('../../site/draw/attach.js');
const { lineRef, targetPosition, refreshAttached, splitKeeping } = await import('../../site/draw/attach.js');
const { emptyDoc, addPoint, addShape, addArea, addLine, addLabel, makeGroup, centroid, setLook, labelColour, LOOK_FIELDS, makePart, remove } = await import('../../site/draw/document.js');
const { drawFeatures, exportFeatures } = await import('../../site/draw/features.js');
const { lineTrace, nearestAlong } = await import('../../site/draw/lines.js');
const { inverse, destination } = await import('../../site/geodesy.js');
const { mercator, unmercator } = await import('../../site/geo.js');

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
// a line east from 12° E along 40° N, with a bend, from a named point to an unnamed one; a shape; an area
const B = destination([12, 40], 90, 10000), E = destination(B, 90, 10000);
const AREA = [[13, 41], [13.1, 41], [13.1, 41.1]];
function base() {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 40], { id: 'a', name: 'Start' });
  addPoint(doc, E, { id: 'e', name: '' });
  addLine(doc, 'a', [B], 'e', { id: 's', name: 'Line' });
  addShape(doc, [12.5, 40.5]).id = 'h';
  addArea(doc, AREA, { id: 'q', name: 'Area' });
  return doc;
}
// the reference d metres along the line s
const on = (doc, d) => lineRef(doc, doc.lines[0], d);
// a label as stored, its fields given; its anchor's position where it points
const withLabel = (doc, id, anchor, more = {}) => {
  const a = addLabel(doc, anchor.position ? anchor : { ...anchor, position: targetPosition(doc, anchor) });
  Object.assign(a, { id, ...more, look: { ...a.look, ...more.look } });
  return a;
};
// a screen: Web Mercator at a scale (px per Mercator metre), y down
const K = 0.01;
const view = { project: (p) => { const m = mercator(p); return [m[0] * K, -m[1] * K]; }, unproject: (q) => unmercator([q[0] / K, -q[1] / K]), measure: (t, px) => [t.length * px * 0.5, px * 1.2] };

test('anchors: a point, an outline\'s centre, an area\'s centroid, a distance along a line (clamped), a free position', () => {
  const doc = base();
  assert.deepEqual(anchorAt(doc, { element: 'a' }).position, [12, 40]);
  assert.equal(anchorAt(doc, { element: 'a' }).element.kind, 'point');
  assert.deepEqual(anchorAt(doc, { element: 'h' }).position, [12.5, 40.5]);
  assert.deepEqual(anchorAt(doc, { element: 'q' }).position, centroid(AREA));
  const r = on(doc, 15000);
  assert.deepEqual([r.element, r.edge, r.at], ['s', 1, 0.5]); // half way along its second leg
  const at = anchorAt(doc, r);
  near(inverse(B, at.position).s, 5000, 0.01, 'past the bend');
  near(at.along, 15000, 0.01, 'from its start');
  near(at.length, 20000, 0.01, 'its line');
  near(inverse(r.position, at.position).s, 0, 1e-3, 'its position: where it points');
  assert.equal(at.element.kind, 'line');
  assert.equal(anchorAt(doc, on(doc, 1e9)).along, at.length);
  assert.equal(anchorAt(doc, on(doc, -5)).along, 0);
  near(inverse([12, 40], anchorAt(doc, { element: 's', vertex: 0 }).position).s, 0, 1e-6, 'its first vertex: its start');
  near(anchorAt(doc, { element: 's' }).along, 10000, 1e-6, 'the line alone: its middle');
  assert.deepEqual(anchorAt(doc, { position: [1, 2], element: null }), { position: [1, 2], element: null });
  assert.equal(anchorAt(doc, { element: 'gone' }), null);
  assert.equal(anchorAt(doc, { element: makeGroup(doc, ['a']).id }), null); // a group is nowhere
  // the anchor moves with the line: a bend moved, a label on it stays on it; one half way along a leg,
  // half way along it still
  const bend = withLabel(doc, 'l1', on(doc, 10000)), half = withLabel(doc, 'l2', on(doc, 5000));
  doc.lines[0].vertices[0].position = destination([12, 40], 45, 10000);
  refreshAttached(doc);
  near(inverse(doc.lines[0].vertices[0].position, bend.anchor.position).s, 0, 0.01, 'at the moved bend');
  near(inverse(destination([12, 40], 45, 5000), half.anchor.position).s, 0, 0.01, 'half way along the moved leg');
});

test('nearest distance along a line, from a point beside it', () => {
  const doc = base();
  const line = lineTrace(doc, doc.lines[0]);
  near(nearestAlong(line.coords, destination(destination([12, 40], 90, 3000), 0, 200)), 3000, 2, 'beside the first leg');
  near(nearestAlong(line.coords, destination(E, 90, 500)), 20000, 0.01, 'past the end');
  near(nearestAlong(line.coords, destination([12, 40], 270, 500)), 0, 0.01, 'before the start');
});

test('live values: name, length, distance along, in the display units; empty where they do not apply', () => {
  const doc = base();
  const a = { text: '{name}: {along} of {length}', anchor: on(doc, 12500) };
  assert.equal(labelText(doc, a), 'Line: 12.50 km of 20.00 km');
  assert.equal(labelText(doc, a, 'nm'), 'Line: 6.75 NM of 10.80 NM');
  assert.equal(labelText(doc, { text: '{name} {length}|', anchor: { element: 'a' } }), 'Start |');
  assert.equal(labelText(doc, { text: '{name} {along}|', anchor: { element: 'q' } }), 'Area |');
  assert.equal(labelText(doc, { text: '{name}|{along}', anchor: { position: [0, 0], element: null } }), '|');
  assert.equal(labelText(doc, { text: '{name}|{other}', anchor: { element: 'gone' } }), '|{other}');
  assert.equal(labelText(doc, { text: '{name}', anchor: { element: 'e' } }), `Point · ${E[1].toFixed(4)}, ${E[0].toFixed(4)}`);
});

test('the leader leaves the text at its box, towards the anchor; none when the anchor is inside', () => {
  assert.deepEqual(leaderFrom([0, 0], [100, 0], [20, 10]), [20, 0]);
  assert.deepEqual(leaderFrom([0, 0], [-40, 40], [20, 10]), [-10, 10]);
  assert.equal(leaderFrom([0, 0], [5, 5], [20, 10]), null);
});

test('features: text at its screen offset, leader to the anchor, the arrow turned along it, handles when selected', () => {
  const doc = base();
  withLabel(doc, 'l1', { element: 'a' }, { text: '{name}', offset: [0, -100], look: { text: { background: 'box' } } });
  withLabel(doc, 'l2', on(doc, 5000), { text: 'x', offset: [3, 3], leader: 'dot' });
  withLabel(doc, 'l3', { position: [13, 41], element: null });
  withLabel(doc, 'l4', { element: 'h' }, { text: 'hidden', visible: false });
  withLabel(doc, 'l5', on(doc, 5000), { text: '', offset: [0, -100], leader: 'line' });
  withLabel(doc, 'l6', { element: 'q' }, { offset: [100, 0] });
  const f = labelFeatures(doc, view, new Set(['l1', 'l3', 'l5']), 'l6');
  const of = (id, kind) => f.filter((x) => x.properties.id === id && x.properties.kind === kind);
  const t = of('l1', 'label')[0];
  assert.deepEqual([t.properties.text, t.properties.box, t.properties.mark, t.properties.px, t.properties.c], ['Start', 1, 'sel', 13, '#1f2933']);
  const tp = view.project(t.geometry.coordinates), ap = view.project([12, 40]);
  near(tp[0] - ap[0], 0, 1e-6, 'x');
  near(tp[1] - ap[1], -100, 1e-6, 'up 100 px');
  const leader = of('l1', 'leader')[0].geometry.coordinates;
  near(view.project(leader[0])[1] - tp[1], 13 * 0.6 + 6, 1e-6, 'from the box edge, below the text');
  assert.deepEqual(leader[1], [12, 40]);
  assert.equal(of('l1', 'lend')[0].properties.end, 'arrow');
  near(of('l1', 'lend')[0].properties.rot, 180, 1e-9, 'pointing down');
  assert.equal(of('l1', 'lhandle').length, 0); // on a point: it follows the point
  assert.equal(of('l2', 'leader').length, 0); // its anchor inside its text: no leader
  assert.deepEqual(of('l3', 'label').map((x) => x.properties.text), ['Text']);
  near(inverse([13, 41], of('l3', 'label')[0].geometry.coordinates).s, 0, 1e-6, 'free: the text where it was put');
  assert.equal(of('l3', 'lhandle').length, 1); // free and selected: its anchor can be dragged
  assert.equal(of('l3', 'leader').length, 0);
  assert.equal(of('l4', 'label').length, 0);
  // no text: no label, the leader from where the text would be; a plain line, no end
  assert.equal(of('l5', 'label').length, 0);
  near(view.project(of('l5', 'leader')[0].geometry.coordinates[0])[1] - view.project(anchorAt(doc, on(doc, 5000)).position)[1], -100, 1e-6, 'from the offset');
  assert.equal(of('l5', 'lend').length, 0);
  assert.equal(of('l5', 'lhandle').length, 1); // along a line: dragged along it
  // on an area: its name, from its centroid; hovered
  assert.deepEqual([of('l6', 'label')[0].properties.text, of('l6', 'label')[0].properties.mark], ['Area', 'hover']);
  assert.deepEqual(of('l6', 'leader')[0].geometry.coordinates[1], centroid(AREA));
  doc.points[0].visible = false; // a hidden element's label is hidden with it
  assert.equal(labelFeatures(doc, view).filter((x) => x.properties.id === 'l1').length, 0);
});

test('a label\'s colour: its own, else its group\'s stroke colour, else the default', () => {
  const doc = base();
  const own = withLabel(doc, 'l1', { element: 'a' }, { look: { text: { color: '#123456' } } });
  const grouped = withLabel(doc, 'l2', { element: 'a' });
  const g = makeGroup(doc, [own.id, grouped.id]);
  g.look.stroke = { color: '#00ff00' };
  setLook(own, 'text.color', '#123456'); // joining the group took its colour; set its own again
  const c = (id) => labelFeatures(doc, view).find((x) => x.properties.id === id && x.properties.kind === 'label').properties.c;
  assert.deepEqual([c('l1'), c('l2')], ['#123456', '#00ff00']);
});

test('deleting what a label points at leaves the label free, where it pointed; a split carries it on', () => {
  const doc = base();
  withLabel(doc, 'l1', { element: 'a' });
  withLabel(doc, 'l2', on(doc, 15000));
  withLabel(doc, 'l3', on(doc, 4000));
  remove(doc, ['a']);
  assert.deepEqual(doc.labels[0].anchor, { position: [12, 40], element: null });
  assert.deepEqual(doc.lines[0].start, { position: [12, 40], element: null }); // the line stays, its end free
  const was = anchorAt(doc, doc.labels[1].anchor).position;
  const point = splitKeeping(doc, 's', 0);
  assert.deepEqual([point.position, point.symbol], [B, 'dot']);
  const rest = doc.lines[1];
  assert.equal(rest.start.element, point.id);
  assert.equal(doc.lines[0].end.element, point.id);
  near(anchorAt(doc, doc.labels[1].anchor).along, 5000, 0.01, 'on the second part');
  assert.deepEqual([doc.labels[1].anchor.element, doc.labels[1].anchor.edge], [rest.id, 0]);
  near(inverse(anchorAt(doc, doc.labels[1].anchor).position, was).s, 0, 0.01, 'the same place');
  const l3 = doc.labels[2].anchor;
  assert.deepEqual([l3.element, l3.edge], ['s', 0]);
  near(l3.at, 0.4, 1e-6, 'on the first part, where it was');
  near(anchorAt(doc, l3).along, 4000, 0.01, 'from its start');
  remove(doc, ['l3']);
  assert.deepEqual(doc.labels.map((x) => x.id), ['l1', 'l2']);
});

test('deleting a group: with its members, their labels are left free; without, they keep pointing at them', () => {
  const doc = base();
  withLabel(doc, 'l1', { element: 'q' });
  withLabel(doc, 'l2', { element: 'h' });
  const g = makeGroup(doc, ['q']), g2 = makeGroup(doc, ['h']);
  remove(doc, [g.id]);
  assert.ok(doc.areas.some((x) => x.id === 'q'));
  assert.deepEqual(doc.labels[0].anchor, { position: centroid(AREA), element: 'q' });
  remove(doc, [g2.id], true);
  assert.ok(!doc.points.some((x) => x.id === 'h'));
  assert.deepEqual(doc.labels[1].anchor, { position: [12.5, 40.5], element: null });
});

test('new labels: on an element, its name with an arrow; free, text where clicked', () => {
  const doc = base();
  const a = addLabel(doc, { element: 'a' }), b = addLabel(doc, { position: [1, 2] });
  assert.deepEqual([a.name, a.text, a.leader, a.offset, a.anchor], ['Label 1', '{name}', 'arrow', [40, -40], { element: 'a' }]);
  assert.deepEqual([b.name, b.text, b.leader, b.offset, b.anchor], ['Label 2', 'Text', 'none', [0, 0], { position: [1, 2] }]);
  assert.deepEqual(a.look, {}); // its colour: the group's, or the default
  assert.equal(labelColour(doc, a), '#1f2933');
  assert.equal(LOOK_FIELDS.label.includes('text.name'), false);
});

test('names on the map: own switch or the group\'s; named vertices with their line; outlines and areas at their centre', () => {
  const doc = base();
  makeGroup(doc, ['a']).look.text = { name: true };
  doc.points[1].name = 'End'; // its switch off
  doc.lines[0].look.text = { name: true };
  doc.lines[0].vertices[0].name = 'Bend';
  Object.assign(doc.points.find((p) => p.id === 'h'), { name: 'Box', look: { text: { name: true } } });
  doc.areas[0].look.text = { name: true };
  const names = drawFeatures(doc, new Set(), null, { zoom: 10 }).features.filter((x) => x.properties.kind === 'name');
  assert.deepEqual(names.map((x) => [x.properties.nm, x.geometry.type, x.properties.ctr ?? 0]).sort(), [['Area', 'Point', 1], ['Bend', 'Point', 0], ['Box', 'Point', 1], ['Line', 'LineString', 0], ['Start', 'Point', 0]]);
});

test('labels in the GIS export: a point where each points, its text with live values', () => {
  const doc = base();
  withLabel(doc, 'l1', on(doc, 2500), { text: '{name} at {along}', properties: [{ key: 'text', value: 'mine' }] });
  withLabel(doc, 'l2', { position: [1, 2], element: null }, { text: 'free' });
  withLabel(doc, 'l3', { element: 'h' });
  withLabel(doc, 'l4', { element: 'a' }, { visible: false });
  doc.points.find((p) => p.id === 'h').visible = false; // its label goes with it
  const labels = exportFeatures(doc).filter((x) => x.properties.kind === 'label');
  assert.deepEqual(labels.map((x) => x.properties.id), ['l1', 'l2']);
  const p = labels[0].properties;
  assert.deepEqual([p.text, p.anchor, p.along_m, p.p_text], ['Line at 2.50 km', 's', 2500, 'mine']);
  assert.equal(labels[0].geometry.type, 'Point');
  near(inverse([12, 40], labels[0].geometry.coordinates).s, 2500, 0.01, 'along the line');
  assert.deepEqual([labels[1].properties.anchor, labels[1].properties.along_m, labels[1].geometry.coordinates], ['', undefined, [1, 2]]);
  assert.equal(exportFeatures(doc, 'nm').find((x) => x.properties.id === 'l1').properties.text, 'Line at 1.35 NM');
});

test('live values on a vertex and a side: a side\'s length and bearing; an area\'s and an outline\'s area and perimeter; a point\'s radius', () => {
  const doc = base();
  const h = doc.points.find((p) => p.id === 'h'); // a rectangle 100 m by 50 m
  h.bearing = 30;
  const t = (text, anchor, units) => labelText(doc, { text, anchor }, units);
  assert.deepEqual(TOKENS, ['name', 'length', 'along', 'bearing', 'radius', 'area', 'perimeter']);
  // on a shape's sides: each side's own length and bearing; its outline's area and perimeter
  assert.equal(t('{length} {bearing}', { element: 'h', edge: 0, at: 0.5 }), '100 m 210.0°T');
  assert.equal(t('{length} {bearing}', { element: 'h', edge: 1, at: 0.5 }), '50 m 300.0°T');
  assert.equal(t('{area} {perimeter}|{radius}', { element: 'h', edge: 1, at: 0.5 }), '0.50 ha 300 m|');
  assert.equal(t('{area} {perimeter}', { element: 'h' }, 'nm'), '0.001 NM² 0.162 NM');
  // on an area's corner: its name, area and perimeter; no side, so no length or bearing
  assert.equal(t('{name} {area} {perimeter}|{length}|{bearing}|{along}', { element: 'q', vertex: 1 }), 'Area 46.72 km² 33.45 km|||');
  const corner = withLabel(doc, 'l1', { element: 'q', vertex: 1 });
  assert.deepEqual(corner.anchor.position, AREA[1]);
  assert.deepEqual(labelFeatures(doc, view).find((x) => x.properties.id === 'l1' && x.properties.kind === 'leader').geometry.coordinates[1], AREA[1]);
  // on an area's side: that side's length and bearing
  assert.equal(t('{length} {bearing}', { element: 'q', edge: 1, at: 0.2 }), '11.11 km 000.0°T');
  assert.equal(t('{length} {bearing}', { element: 'q', edge: 0, at: 0.2 }, 'nm'), '4.54 NM 090.0°T');
  // on a line's leg: the line's length, the distance along it, the leg's bearing
  assert.equal(t('{length} {along} {bearing}|{area}', on(doc, 15000)), '20.00 km 15.00 km 090.0°T|');
  // a point: the radius of its first filled round part, else its first round part; none without one
  assert.equal(t('{radius}|{area}|{bearing}', { element: 'a' }), '1.00 km||');
  assert.equal(t('{radius}', { element: 'a' }, 'nm'), '0.540 NM');
  doc.points[0].parts = [makePart('rectangle'), { ...makePart('circle', { radius: 500 }), fill: false }, makePart('sector', { radius: 2000, aperture: 30 }), makePart('circle', { radius: 3000 })];
  assert.equal(t('{radius}', { element: 'a' }), '2.00 km');
  doc.points[0].parts[2].fill = false;
  assert.equal(t('{radius}', { element: 'a' }), '3.00 km');
  doc.points[0].parts[3].fill = false;
  assert.equal(t('{radius}', { element: 'a' }), '500 m');
  doc.points[0].parts = [makePart('rectangle')];
  assert.equal(t('{radius}|', { element: 'a' }), '|');
  doc.points[0].parts = [];
  assert.equal(t('{radius}|{area}', { element: 'a' }), '|');
  assert.deepEqual(labelValues(doc, { position: [0, 0], element: null }), {});
});

test('live values on a point with several outlines: the area and perimeter of the outline the anchor names, else of the largest', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 40], { id: 'h', symbol: 'none', parts: [makePart('rectangle', { length: 100, width: 50 }), makePart('circle', { radius: 1000 }), makePart('rectangle', { length: 200, width: 20 })] });
  const t = (text, anchor) => labelText(doc, { text, anchor });
  assert.equal(t('{area} {perimeter}', { element: 'h', part: 0, edge: 1, at: 0.5 }), '0.50 ha 300 m');
  assert.equal(t('{length}', { element: 'h', part: 0, edge: 1, at: 0.5 }), '50 m'); // that outline's side
  assert.equal(t('{area} {perimeter}', { element: 'h', part: 2, vertex: 0 }), '0.40 ha 440 m');
  assert.equal(t('{area} {perimeter}', { element: 'h' }), '0.40 ha 440 m'); // its centre: the largest (by length)
  assert.equal(t('{length}', { element: 'h', part: 2, edge: 0, at: 0.5 }), '200 m');
  assert.equal(t('{radius}', { element: 'h' }), '1.00 km');
});
