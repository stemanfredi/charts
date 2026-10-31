import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near, drawFeatures, lineFrom, placeIn, addRing } from './helpers.mjs';

const { labelText, labelValues, TOKENS, leaderFrom, labelFeatures } = await import('../../site/draw/labels.js');
const { resolve: anchorAt } = await import('../../site/draw/attach.js');
const { lineRef, targetPosition, refreshAttached, splitLine } = await import('../../site/draw/attach.js');
const { emptyDoc, addPoint, addLine, addCircle, addLabel, makeGroup, centroid, lookOf, LOOK_FIELDS, remove, linkFrom, setLink, carry } = await import('../../site/draw/document.js');
const { outlinePoints } = await import('../../site/draw/outlines.js');
const { exportFeatures } = await import('../../site/draw/features.js');
const { lineTrace, nearestAlong } = await import('../../site/draw/lines.js');
const { inverse, destination } = await import('../../site/geodesy.js');
const { mercator, unmercator } = await import('../../site/geo.js');

// a line east from 12° E along 40° N, with a bend, from a named point to an unnamed one; a closed
// line (an area); a point holding a rectangle (a closed line, 100 m by 50 m)
const B = destination([12, 40], 90, 10000), E = destination(B, 90, 10000);
const AREA = [[13, 41], [13.1, 41], [13.1, 41.1]];
function base() {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 40], { id: 'a', name: 'Start' });
  addPoint(doc, E, { id: 'e', name: '' });
  lineFrom(doc, 'a', [B], 'e', { id: 's', name: 'Line' });
  addRing(doc, AREA, { id: 'q', name: 'Area' });
  addPoint(doc, [12.5, 40.5], { id: 'h', symbol: 'none' });
  addLine(doc, outlinePoints([12.5, 40.5], 0, 100, 50), { id: 'hr', groupId: 'h', closed: true });
  return doc;
}
// the target d metres along the line s (with its position)
const on = (doc, d) => lineRef(doc, doc.lines[0], d);
// a label as stored, its fields given, pointing at anchor (a target, or { position } free)
const withLabel = (doc, id, anchor, more = {}) => {
  const a = addLabel(doc, anchor.position ?? targetPosition(doc, anchor), anchor.element ? anchor : null), l = linkFrom(doc, a.id);
  Object.assign(a, { id, ...more, look: { ...a.look, ...more.look } });
  if (l) l.from = [id, 0];
  return a;
};
// the text of a label pointing at `to` (a target, or none)
const textOn = (doc, text, to, units) => { const a = addLabel(doc, [0, 0]); a.text = text; setLink(doc, a.id, 0, to?.element ? to : null); return labelText(doc, a, units); };
// a screen: Web Mercator at a scale (px per Mercator metre), y down
const K = 0.01;
const view = { project: (p) => { const m = mercator(p); return [m[0] * K, -m[1] * K]; }, unproject: (q) => unmercator([q[0] / K, -q[1] / K]), measure: (t, px) => [t.length * px * 0.5, px * 1.2] };

test('anchors: a point, a shape\'s point, an area\'s centroid, a distance along a line (clamped), a free position', () => {
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
  assert.equal(anchorAt(doc, { element: 'gone' }), null);
  assert.equal(anchorAt(doc, { element: makeGroup(doc, ['a']).id }), null); // a group is nowhere
  // the anchor moves with the line: a bend moved, a label on it stays on it; one half way along a leg,
  // half way along it still
  const bend = withLabel(doc, 'l1', on(doc, 10000)), half = withLabel(doc, 'l2', on(doc, 5000));
  doc.lines[0].points[1] = destination([12, 40], 45, 10000);
  refreshAttached(doc);
  near(inverse(doc.lines[0].points[1], bend.position).s, 0, 0.01, 'at the moved bend');
  near(inverse(destination([12, 40], 45, 5000), half.position).s, 0, 0.01, 'half way along the moved leg');
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
  assert.equal(textOn(doc, '{name}: {along} of {length}', on(doc, 12500)), 'Line: 12.50 km of 20.00 km');
  assert.equal(textOn(doc, '{name}: {along} of {length}', on(doc, 12500), 'nm'), 'Line: 6.75 NM of 10.80 NM');
  assert.equal(textOn(doc, '{name} {length}|', { element: 'a' }), 'Start |');
  assert.equal(textOn(doc, '{name} {along}|', { element: 'q' }), 'Area |');
  assert.equal(textOn(doc, '{name}|{along}', null), '|');
  assert.equal(textOn(doc, '{name}|{other}', { element: 'gone' }), '|{other}');
  assert.equal(textOn(doc, '{name}', { element: 'e' }), `Point · ${E[1].toFixed(4)}, ${E[0].toFixed(4)}`);
});

test('the leader leaves the text at its box, towards the anchor; none when the anchor is inside', () => {
  assert.deepEqual(leaderFrom([0, 0], [100, 0], [20, 10]), [20, 0]);
  assert.deepEqual(leaderFrom([0, 0], [-40, 40], [20, 10]), [-10, 10]);
  assert.equal(leaderFrom([0, 0], [5, 5], [20, 10]), null);
});

test('features: text at its screen offset, leader to the anchor, the arrow turned along it, handles when selected', () => {
  const doc = base();
  withLabel(doc, 'l1', { element: 'a' }, { text: '{name}', offset: [0, -100], look: { text: { background: 'box' } } });
  withLabel(doc, 'l2', on(doc, 5000), { text: 'x', offset: [3, 3] });
  withLabel(doc, 'l3', { position: [13, 41], element: null });
  withLabel(doc, 'l4', { element: 'h' }, { text: 'hidden', visible: false });
  withLabel(doc, 'l5', on(doc, 5000), { text: '', offset: [0, -100] });
  withLabel(doc, 'l6', { element: 'q' }, { offset: [100, 0] });
  const f = labelFeatures(doc, view, new Set(['l1', 'l3', 'l5']), 'l6');
  const of = (id, kind) => f.filter((x) => x.properties.id === id && x.properties.kind === kind);
  const t = of('l1', 'label')[0];
  assert.deepEqual([t.properties.text, t.properties.box, t.properties.mark, t.properties.px, t.properties.c], ['Start', 1, 'sel', 13, '#1f2c36']);
  const tp = view.project(t.geometry.coordinates), ap = view.project([12, 40]);
  near(tp[0] - ap[0], 0, 1e-6, 'x');
  near(tp[1] - ap[1], -100, 1e-6, 'up 100 px');
  const leader = of('l1', 'leader')[0].geometry.coordinates;
  near(view.project(leader[0])[1] - tp[1], 13 * 0.6 + 6, 1e-6, 'from the box edge, below the text');
  assert.deepEqual(leader[1], [12, 40]);
  near(of('l1', 'lend')[0].properties.rot, 180, 1e-9, 'pointing down');
  assert.equal(of('l1', 'lhandle').length, 0); // on a point: it follows the point
  assert.equal(of('l2', 'leader').length, 0); // its anchor inside its text: no leader
  assert.deepEqual(of('l3', 'label').map((x) => x.properties.text), ['Text']);
  near(inverse([13, 41], of('l3', 'label')[0].geometry.coordinates).s, 0, 1e-6, 'free: the text where it was put');
  assert.equal(of('l3', 'lhandle').length, 1); // free and selected: its anchor can be dragged
  assert.equal(of('l3', 'leader').length, 0);
  assert.equal(of('l4', 'label').length, 0);
  // no text: no label, the leader from where the text would be
  assert.equal(of('l5', 'label').length, 0);
  near(view.project(of('l5', 'leader')[0].geometry.coordinates[0])[1] - view.project(anchorAt(doc, on(doc, 5000)).position)[1], -100, 1e-6, 'from the offset');
  assert.equal(of('l5', 'lhandle').length, 1); // along a line: dragged along it
  // on an area: its name, from its centroid; hovered
  assert.deepEqual([of('l6', 'label')[0].properties.text, of('l6', 'label')[0].properties.mark], ['Area', 'hover']);
  assert.deepEqual(of('l6', 'leader')[0].geometry.coordinates[1], centroid(AREA));
  doc.points[0].visible = false; // a hidden element's label is hidden with it
  assert.equal(labelFeatures(doc, view).filter((x) => x.properties.id === 'l1').length, 0);
});

test('a label\'s colour: its own, else the default (a group adds nothing)', () => {
  const doc = base();
  const own = withLabel(doc, 'l1', { element: 'a' }, { look: { text: { color: '#123456' } } });
  const other = withLabel(doc, 'l2', { element: 'a' });
  makeGroup(doc, [own.id, other.id]);
  const c = (id) => labelFeatures(doc, view).find((x) => x.properties.id === id && x.properties.kind === 'label').properties.c;
  assert.deepEqual([c('l1'), c('l2')], ['#123456', '#1f2c36']);
});

test('deleting what a label points at leaves the label free, where it pointed; a split carries it on', () => {
  const doc = base();
  withLabel(doc, 'l1', { element: 'a' });
  withLabel(doc, 'l2', on(doc, 15000));
  withLabel(doc, 'l3', on(doc, 4000));
  remove(doc, ['a']);
  refreshAttached(doc); // after every change
  assert.deepEqual(placeIn(doc, doc.labels[0]), { position: [12, 40], to: null });
  assert.deepEqual(placeIn(doc, doc.lines[0], 0), { position: [12, 40], to: null }); // the line stays, its start free
  const was = doc.labels[1].position, to = (i) => placeIn(doc, doc.labels[i]).to;
  const point = splitLine(doc, 's', 1);
  assert.deepEqual([point.position, point.symbol], [B, 'dot']);
  const rest = doc.lines[1];
  assert.equal(placeIn(doc, rest, 0).to.element, point.id);
  assert.equal(placeIn(doc, doc.lines[0], -1).to.element, point.id);
  near(anchorAt(doc, to(1)).along, 5000, 0.01, 'on the second part');
  assert.deepEqual([to(1).element, to(1).edge], [rest.id, 0]);
  near(inverse(anchorAt(doc, to(1)).position, was).s, 0, 0.01, 'the same place');
  const l3 = to(2);
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
  assert.ok(doc.lines.some((x) => x.id === 'q'));
  assert.deepEqual(placeIn(doc, doc.labels[0]), { position: centroid(AREA), to: { element: 'q' } });
  remove(doc, [g2.id], true);
  refreshAttached(doc);
  assert.ok(!doc.points.some((x) => x.id === 'h'));
  assert.deepEqual(placeIn(doc, doc.labels[1]), { position: [12.5, 40.5], to: null });
});

test('new labels: on an element, its name with an arrow; free, text where clicked', () => {
  const doc = base();
  const a = addLabel(doc, [12, 40], { element: 'a', d: 3 }), b = addLabel(doc, [1, 2]);
  assert.deepEqual([a.name, a.text, a.leader, a.offset, placeIn(doc, a)], ['', '{name}', 'arrow', [40, -40], { position: [12, 40], to: { element: 'a' } }]); // the target alone kept
  assert.deepEqual([b.name, b.text, b.leader, b.offset, placeIn(doc, b)], ['', 'Text', 'none', [0, 0], { position: [1, 2], to: null }]);
  assert.deepEqual(a.look, {}); // its colour: the group's, or the default
  assert.equal(lookOf(doc, a).text.color, '#1f2c36');
  assert.equal(LOOK_FIELDS.label.includes('text.name'), false);
});

test('names on the map: by its own switch; named vertices with their line; closed lines at their centre', () => {
  const doc = base();
  makeGroup(doc, ['a']);
  doc.points.find((p) => p.id === 'a').look.text = { name: true };
  doc.points[1].name = 'End'; // its switch off
  doc.lines[0].look.text = { name: true };
  doc.lines[0].names[1] = 'Bend';
  Object.assign(doc.points.find((p) => p.id === 'h'), { name: 'Box', look: { text: { name: true } } });
  doc.lines[1].look.text = { name: true };
  const names = drawFeatures(doc, new Set(), null, { zoom: 10 }).features.filter((x) => x.properties.kind === 'name');
  assert.deepEqual(names.map((x) => [x.properties.nm, x.geometry.type, x.properties.ctr ?? 0]).sort(), [['Area', 'Point', 1], ['Bend', 'Point', 0], ['Box', 'Point', 0], ['Line', 'LineString', 0], ['Start', 'Point', 0]]);
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

test('live values on a vertex and a leg: a leg\'s bearing; a closed line\'s area and perimeter (a point\'s shape is one); a circle\'s radius and area', () => {
  const doc = base();
  carry(doc, doc.points.find((p) => p.id === 'h'), [12.5, 40.5], 30); // its rectangle turned with it
  const t = (text, to, units) => textOn(doc, text, to, units);
  assert.deepEqual(TOKENS, ['name', 'length', 'along', 'bearing', 'radius', 'area', 'perimeter']);
  // on a shape's legs: each leg's bearing; its length (the perimeter), area and perimeter as any closed line's
  assert.equal(t('{length} {bearing}', { element: 'hr', edge: 0, at: 0.5 }), '300 m 210.0°T');
  assert.equal(t('{bearing}', { element: 'hr', edge: 1, at: 0.5 }), '300.0°T');
  assert.equal(t('{area} {perimeter}|{radius}', { element: 'hr', edge: 1, at: 0.5 }), '0.50 ha 300 m|');
  assert.equal(t('{area} {perimeter}', { element: 'hr' }, 'nm'), '0.001 NM² 0.162 NM');
  // on a closed line's place: its name, area and perimeter; as on any line, its length (the
  // perimeter) and the distance along it; no leg, so no bearing
  assert.equal(t('{name} {area} {perimeter}|{length}|{bearing}|{along}', { element: 'q', vertex: 1 }), 'Area 46.72 km² 33.45 km|33.45 km||8.41 km');
  assert.equal(t('{area} {perimeter}|{along}', { element: 'q' }), '46.72 km² 33.45 km|'); // its centre
  const corner = withLabel(doc, 'l1', { element: 'q', vertex: 1 });
  assert.deepEqual(corner.position, AREA[1]);
  assert.deepEqual(labelFeatures(doc, view).find((x) => x.properties.id === 'l1' && x.properties.kind === 'leader').geometry.coordinates[1], AREA[1]);
  // on a closed line's leg: as on any line's, its length, the distance along it, the leg's bearing
  assert.equal(t('{length} {along} {bearing}', { element: 'q', edge: 1, at: 0.2 }), '33.45 km 10.63 km 000.0°T');
  assert.equal(t('{bearing}', { element: 'q', edge: 0, at: 0.2 }, 'nm'), '090.0°T');
  // on a line's leg: the line's length, the distance along it, the leg's bearing
  assert.equal(t('{length} {along} {bearing}|{area}', on(doc, 15000)), '20.00 km 15.00 km 090.0°T|');
  // a circle: its radius and area (a sector's its own); a point: neither
  addCircle(doc, [12, 40], { id: 'c' });
  assert.equal(t('{radius}|{area}|{perimeter}|{bearing}', { element: 'c' }), '1.00 km|3.14 km²||');
  assert.equal(t('{radius}', { element: 'c' }, 'nm'), '0.540 NM');
  addCircle(doc, [12, 40], { id: 'sc', aperture: 90 });
  assert.equal(t('{area}', { element: 'sc' }), '78.51 ha'); // a quarter of it
  assert.equal(t('{radius}|{area}', { element: 'a' }), '|');
  assert.deepEqual(labelValues(doc, null), {});
});
