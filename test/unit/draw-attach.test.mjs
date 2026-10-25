import { test } from 'node:test';
import assert from 'node:assert/strict';

const { emptyDoc, addPoint, addDot, addShape, addLine, addArea, centroid, remove, makePart, removePart } = await import('../../site/draw/document.js');
const { targetPosition, resolve, refreshAttached, reattach, insertCorner, removeCorner, addVertex, removeVertex, splitKeeping, attachTo, verticesOf, partName, refNear } = await import('../../site/draw/attach.js');
const { snapAt, stepped, neighbours } = await import('../../site/draw/snap.js');
const { parse, serialise } = await import('../../site/draw/file.js');
const { settleGeometry } = await import('../../site/draw/store.js');
const { inverse } = await import('../../site/geodesy.js');
const { lineTrace } = await import('../../site/draw/lines.js');

const near = (a, b, m = 0.01) => assert.ok(inverse(a, b).s < m, `${a} is ${inverse(a, b).s} m from ${b}`);
// a flat screen: 10 000 px a degree about 10° E, 40° N (y down)
const view = { project: ([lon, lat]) => [(lon - 10) * 1e4, -(lat - 40) * 1e4], unproject: ([x, y]) => [10 + x / 1e4, 40 - y / 1e4] };
const px = (p) => view.project(p);

function drawing() {
  const doc = emptyDoc(0);
  const p = addPoint(doc, [10, 40], { id: 'p' });
  const sh = addShape(doc, [10.02, 40]);
  sh.id = 'sh';
  const a = addArea(doc, [[10, 40.02], [10.02, 40.02], [10.02, 40.04]], { id: 'a' });
  const l = addLine(doc, [10.05, 40], [[10.06, 40.01]], [10.07, 40], { id: 'l' });
  return { doc, p, sh, a, l };
}

test('where a reference is: a centre, a vertex, a place along an edge or a leg; nothing for what is not there', () => {
  const { doc, sh, a, l } = drawing();
  assert.deepEqual(targetPosition(doc, { element: 'p' }), [10, 40]);
  assert.deepEqual(targetPosition(doc, { element: 'a' }), centroid(a.points)); // an area's centre: its centroid
  assert.deepEqual(targetPosition(doc, { element: 'a', vertex: 1 }), [10.02, 40.02]);
  near(targetPosition(doc, { element: 'a', edge: 0, at: 0.5 }), [10.01, 40.02], 1);
  // a line's places: 0 its start, then its vertices, the last its end
  assert.deepEqual([0, 1, 2].map((k) => targetPosition(doc, { element: 'l', vertex: k })), [[10.05, 40], [10.06, 40.01], [10.07, 40]]);
  const tr = lineTrace(doc, l), mid = resolve(doc, { element: 'l' }); // a line's centre: its middle along it
  assert.ok(Math.abs(mid.along - tr.length / 2) < 1e-6 && mid.length === tr.length);
  const leg = resolve(doc, { element: 'l', edge: 1, at: 0.5 }); // half way along its second leg
  assert.ok(Math.abs(leg.along - (tr.at[1] + tr.legs[1] / 2)) < 1e-6);
  assert.ok(Math.abs(leg.edge.length - tr.legs[1]) < 1e-6);
  near(leg.position, [10.065, 40.005], 2);
  assert.deepEqual(targetPosition(doc, { element: 'sh', vertex: 0 }), verticesOf({ kind: 'point', el: sh })[0]);
  assert.equal(verticesOf({ kind: 'area', el: a }).length, 3);
  assert.equal(verticesOf({ kind: 'line', el: l }).length, 3);
  assert.equal(verticesOf({ kind: 'point', el: doc.points[0] }), null);
  for (const bad of [{ element: 'x' }, { element: 'a', vertex: 3 }, { element: 'a', edge: 3, at: 0 }, { element: 'l', vertex: 3 }, { element: 'l', edge: 2, at: 0 }, { element: 'p', vertex: 0 }]) {
    assert.equal(targetPosition(doc, bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(resolve(doc, { position: [1, 2], element: null }), { position: [1, 2], element: null });
  assert.deepEqual([partName({ vertex: 0 }), partName({ vertex: 2 }), partName({ edge: 0 }), partName({})], ['vertex 1', 'vertex 3', 'edge 1', '']);
});

test('ends follow what they are attached to: an outline turned, an area\'s corner moved, a vertex moved; gone, free where they were', () => {
  const { doc, sh, a, l } = drawing();
  const s1 = addLine(doc, [9.9, 39.9], [], { element: 'sh', part: 0, vertex: 0, position: [0, 0] });
  const s2 = addLine(doc, [9.9, 39.9], [], { element: 'a', edge: 1, at: 0.25, position: [0, 0] });
  const s3 = addLine(doc, { element: 'l', vertex: 1, position: [0, 0] }, [], [9.9, 39.9]);
  refreshAttached(doc);
  near(s1.end.position, verticesOf({ kind: 'point', el: sh })[0]);
  sh.bearing = 90;
  a.points[2] = [10.03, 40.05];
  l.vertices[0].position = [10.06, 40.02];
  refreshAttached(doc);
  near(s1.end.position, verticesOf({ kind: 'point', el: sh })[0]);
  near(s2.end.position, targetPosition(doc, { element: 'a', edge: 1, at: 0.25 }));
  assert.deepEqual(s3.start.position, [10.06, 40.02]);
  assert.deepEqual([s1.end.part, s1.end.vertex, s2.end.edge, s2.end.at, s3.start.vertex], [0, 0, 1, 0.25, 1]);
  const was = [...s1.end.position];
  remove(doc, ['sh']);
  assert.deepEqual(s1.end, { position: was, element: null });
  sh.parts = [makePart('circle')]; // a point without an outline: nothing to attach to there
  doc.points.push(sh);
  s1.end = { ...s1.end, element: 'sh', part: 0, vertex: 0 };
  refreshAttached(doc);
  assert.deepEqual(s1.end, { position: was, element: null });
});

test('vertices added, taken away, a line split: ends on its vertices stay on the same ones; one whose vertex goes, on the nearest left', () => {
  const doc = emptyDoc(0);
  const l = addLine(doc, [10, 40], [[10.01, 40], [10.02, 40], [10.03, 40]], [10.04, 40], { id: 'l' });
  const on = (v) => addLine(doc, [10, 39], [], { element: 'l', vertex: v + 1, position: l.vertices[v].position }); // places: 0 its start
  const [a, b, c] = [on(0), on(1), on(2)];
  addVertex(doc, l, 1, [10.015, 40]);
  assert.deepEqual([a.end.vertex, b.end.vertex, c.end.vertex], [1, 3, 4]);
  removeVertex(doc, l, 2); // b's: to the nearest vertex left (10.015)
  assert.deepEqual([a.end.vertex, b.end.element, b.end.vertex, c.end.vertex], [1, 'l', 2, 3]);
  settleGeometry(doc);
  assert.deepEqual(b.end.position, [10.015, 40]);
  const p = splitKeeping(doc, 'l', 0); // a's vertex becomes a point; b's and c's go to the rest
  const rest = doc.lines.find((s) => s.start.element === p.id && s.id !== 'l');
  assert.deepEqual(a.end, { position: [10.01, 40], element: p.id });
  assert.deepEqual([b.end.element, b.end.vertex, c.end.element, c.end.vertex], [rest.id, 1, rest.id, 2]);
  assert.deepEqual(rest.vertices[1].position, [10.03, 40]);
  settleGeometry(doc);
  assert.deepEqual([b.end.position, c.end.position], [[10.015, 40], [10.03, 40]]);
});

test('an area\'s corners added and taken away, an outline changed: ends on corners and edges stay where they were', () => {
  const doc = emptyDoc(0);
  const a = addArea(doc, [[10, 40], [10.02, 40], [10.02, 40.02], [10, 40.02]], { id: 'a' });
  const c2 = addLine(doc, [9.9, 39.9], [], { element: 'a', vertex: 2, position: [10.02, 40.02] });
  const e3 = addLine(doc, [9.9, 39.9], [], { element: 'a', edge: 3, at: 0.5, position: [0, 0] });
  refreshAttached(doc);
  const at = [...e3.end.position];
  insertCorner(doc, a, 1, [10.01, 39.99]);
  assert.equal(c2.end.vertex, 3);
  assert.equal(e3.end.edge, 4);
  refreshAttached(doc);
  near(e3.end.position, at, 1);
  removeCorner(doc, a, 3); // c2's: to the nearest one left
  refreshAttached(doc);
  assert.ok(c2.end.element === 'a' && c2.end.vertex != null);
  removeCorner(doc, a, 0);
  removeCorner(doc, a, 0); // three left: no more
  assert.equal(a.points.length, 3);
  const sh = addShape(doc, [11, 40]);
  const s = addLine(doc, [10.9, 39.9], [], { element: sh.id, vertex: 1, position: [0, 0] });
  refreshAttached(doc);
  const before = [...s.end.position];
  sh.parts[0] = { ...sh.parts[0], kind: 'surface-vehicle' };
  reattach(doc, sh.id);
  refreshAttached(doc);
  assert.ok(s.end.element === sh.id && s.end.part === 0 && s.end.vertex != null);
  assert.ok(inverse(s.end.position, before).s < 30, 'the nearest corner of the new outline');
});

test('what a snap target attaches to: a centre (the ID), a vertex, a place along a leg (no vertex added), a free end joined by a point', () => {
  const { doc, l } = drawing();
  assert.equal(attachTo(doc, { element: 'p' }), 'p');
  assert.deepEqual(attachTo(doc, { element: 'a', vertex: 2 }), { element: 'a', vertex: 2, position: [10.02, 40.04] });
  assert.equal(attachTo(doc, null), null);
  const r = attachTo(doc, { element: 'l', edge: 1, at: 0.5 });
  assert.deepEqual(r, { element: 'l', edge: 1, at: 0.5, position: targetPosition(doc, { element: 'l', edge: 1, at: 0.5 }) });
  near(r.position, [10.065, 40.005], 2);
  assert.deepEqual(l.vertices.map((v) => v.position), [[10.06, 40.01]]);
  const id = attachTo(doc, { end: { lineId: 'l', key: 'start' } });
  assert.equal(doc.points.find((x) => x.id === id).symbol, 'dot');
  assert.deepEqual(l.start, { position: [10.05, 40], element: id });
});

test('the file keeps each kind of attachment; one to what is not there is free, with a warning', () => {
  const { doc } = drawing();
  addLine(doc, { element: 'sh', vertex: 2, position: [0, 0] }, [], { element: 'a', edge: 2, at: 0.3, position: [0, 0] }, { id: 'x' });
  addLine(doc, { element: 'l', vertex: 1, position: [0, 0] }, [], 'p', { id: 'y' });
  addLine(doc, [9.9, 39.9], [], { element: 'l', edge: 0, at: 0.4, position: [0, 0] }, { id: 'z' });
  settleGeometry(doc);
  const text = serialise(doc), back = parse(text);
  assert.deepEqual(back.report.warnings, []);
  for (const id of ['x', 'y', 'z']) assert.deepEqual(back.doc.lines.find((s) => s.id === id), doc.lines.find((s) => s.id === id));
  const raw = JSON.parse(text), x = raw.features.find((f) => f.id === 'x').properties.charts;
  const y = raw.features.find((f) => f.id === 'y').properties.charts, z = raw.features.find((f) => f.id === 'z').properties.charts;
  assert.deepEqual([x.start, x.end, y.start, y.end, z.end], [{ element: 'sh', vertex: 2 }, { element: 'a', edge: 2, at: 0.3 }, { element: 'l', vertex: 1 }, { element: 'p' }, { element: 'l', edge: 0, at: 0.4 }]);
  y.end = 'p'; // a bare ID: still read as its centre
  x.start = { element: 'sh', vertex: 9 };
  x.end = { element: 'a', edge: 3, at: 0.5 };
  const r = parse(JSON.stringify(raw));
  const s = r.doc.lines.find((q) => q.id === 'x');
  assert.deepEqual([s.start.element, s.end.element], [null, null]);
  assert.deepEqual(r.doc.lines.find((q) => q.id === 'y').end, { position: [10, 40], element: 'p' });
  assert.equal(r.report.warnings.filter((w) => /line x: its (start|end) is attached to/.test(w)).length, 2);
});

test('snapping: a vertex before a crossing before an edge; within the radius; never what is excluded', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [10, 40], { id: 'p' });
  addLine(doc, [10.01, 40.01], [], [10.03, 40.01], { id: 'h' });
  addLine(doc, [10.02, 40], [], [10.02, 40.02], { id: 'v' });
  const at = (q) => snapAt(doc, px(q), view);
  const v = at([10.0003, 40.0003]);
  assert.deepEqual([v.kind, v.to, v.position], ['vertex', { element: 'p' }, [10, 40]]);
  const x = at([10.0201, 40.0102]);
  assert.equal(x.kind, 'crossing');
  near(x.position, [10.02, 40.01], 0.5);
  assert.equal(x.to, null);
  const e = at([10.025, 40.0105]);
  assert.equal(e.kind, 'edge');
  assert.deepEqual([e.to.element, e.to.edge], ['h', 0]);
  assert.ok(Math.abs(e.to.at - 0.75) < 0.01);
  near(targetPosition(doc, e.to), e.position, 0.5);
  near(e.position, [10.025, 40.01], 2);
  assert.equal(at([10.03, 40.03]), null);
  assert.equal(snapAt(doc, px([10.0003, 40.0003]), view, { exclude: new Set(['p']) }), null);
  // ids: the elements whose edges are looked at (the map's hits); vertices are looked at in all
  assert.equal(snapAt(doc, px([10.0201, 40.005]), view, { ids: new Set(['h']) }), null);
  assert.equal(snapAt(doc, px([10.0201, 40.005]), view, { ids: new Set(['v']) }).to.element, 'v');
  assert.equal(snapAt(doc, px([10.0003, 40.0003]), view, { ids: new Set() }).kind, 'vertex');
  const end = at([10.0301, 40.0101]); // a line's free end
  assert.deepEqual(end.to, { end: { lineId: 'h', key: 'end' } });
});

test('snapping to corners and edges of outlines and areas, and to a line\'s vertices', () => {
  const { doc, sh } = drawing();
  const c = verticesOf({ kind: 'point', el: sh })[3];
  const s = snapAt(doc, px(c), view);
  assert.deepEqual([s.kind, s.to], ['vertex', { element: 'sh', part: 0, vertex: 3 }]); // an outline's corner: named by its part
  const mid = [10.01, 40.0201];
  const e = snapAt(doc, px(mid), view);
  assert.deepEqual([e.kind, e.to.element, e.to.edge], ['edge', 'a', 0]);
  assert.ok(Math.abs(e.to.at - 0.5) < 0.01);
  const v = snapAt(doc, px([10.0601, 40.0101]), view);
  assert.deepEqual(v.to, { element: 'l', vertex: 1 }); // its first vertex: place 1
  doc.lines[0].visible = false;
  assert.equal(snapAt(doc, px([10.0601, 40.0101]), view), null, 'a hidden line is not snapped to');
});

test('several outlines on one point: corners and edges named by part; snapped, resolved, followed, kept in the file; a part taken away, on the nearest left', () => {
  const doc = emptyDoc(0);
  const sh = addShape(doc, [10.02, 40]);
  sh.id = 'sh';
  sh.parts = [makePart('rectangle', { length: 1000, width: 500 }), makePart('circle', { radius: 3000 }), makePart('rectangle', { length: 4000, width: 3000 })];
  const x = { kind: 'point', el: sh };
  assert.deepEqual(verticesOf(x), verticesOf(x, 2)); // none named: the largest outline
  assert.equal(verticesOf(x, 1), null); // a round part has no corners
  assert.ok(Math.abs(inverse([10.02, 40], verticesOf(x, 0)[0]).s - Math.hypot(1000, 500) / 2) < 1e-3);
  assert.ok(Math.abs(inverse([10.02, 40], verticesOf(x, 2)[0]).s - Math.hypot(4000, 3000) / 2) < 1e-3);
  assert.deepEqual(targetPosition(doc, { element: 'sh', part: 0, vertex: 2 }), verticesOf(x, 0)[2]);
  assert.deepEqual(targetPosition(doc, { element: 'sh', vertex: 2 }), verticesOf(x, 2)[2]);
  near(targetPosition(doc, { element: 'sh', part: 0, edge: 0, at: 0.5 }), [10.02 + 250 / (111320 * Math.cos((40 * Math.PI) / 180)), 40], 2); // the right side's middle
  for (const bad of [{ element: 'sh', part: 1, vertex: 0 }, { element: 'sh', part: 7, vertex: 0 }, { element: 'sh', part: 0, vertex: 4 }]) assert.equal(targetPosition(doc, bad), null, JSON.stringify(bad));
  // snapped: each outline's corners, named by part
  assert.deepEqual(snapAt(doc, px(verticesOf(x, 0)[1]), view).to, { element: 'sh', part: 0, vertex: 1 });
  assert.deepEqual(snapAt(doc, px(verticesOf(x, 2)[3]), view).to, { element: 'sh', part: 2, vertex: 3 });
  // the nearest outline's vertex or edge, always with its part
  const r = refNear(doc, x, verticesOf(x, 2)[2], true), q = refNear(doc, x, targetPosition(doc, { element: 'sh', part: 0, edge: 1, at: 0.3 }), false);
  assert.deepEqual([r.part, r.vertex, q.part, q.edge, +q.at.toFixed(3)], [2, 2, 0, 1, 0.3]);
  // an end on the small one's corner follows it as the point turns
  const l = addLine(doc, [10, 39.9], [], { element: 'sh', part: 0, vertex: 1, position: [0, 0] });
  refreshAttached(doc);
  near(l.end.position, verticesOf(x, 0)[1]);
  sh.bearing = 45;
  refreshAttached(doc);
  near(l.end.position, verticesOf(x, 0)[1]);
  const back = parse(serialise(doc), null, 0).doc.lines[0].end;
  assert.deepEqual([back.element, back.part, back.vertex], ['sh', 0, 1]); // the file keeps the part
  near(back.position, l.end.position);
  // the part taken away: on the nearest outline left, by its new place
  const at = [...l.end.position];
  removePart(sh, 0);
  reattach(doc, 'sh');
  refreshAttached(doc);
  assert.deepEqual([l.end.element, l.end.part], ['sh', 1]);
  assert.ok(l.end.vertex != null || l.end.edge != null);
  assert.ok(inverse(l.end.position, at).s < 2500, 'on the outline left, near where it was');
});

test('Shift: 15° steps from north, or from the leg before; the length kept', () => {
  const from = [10, 40];
  const q = stepped(from, [10.01, 40.012]); // about 33° from north
  assert.ok(Math.abs(inverse(from, q).azi - 30) < 1e-6);
  assert.ok(Math.abs(inverse(from, q).s - inverse(from, [10.01, 40.012]).s) < 1e-6);
  const r = stepped(from, [10.012, 40.002], [9.99, 39.99]); // the leg before heads about 37°
  const base = inverse([9.99, 39.99], from).azi, d = inverse(from, r).azi - base;
  assert.ok(Math.abs(d / 15 - Math.round(d / 15)) < 1e-6);
  assert.deepEqual(stepped(from, from), from);
  assert.deepEqual(neighbours([[0, 0], [1, 1], [2, 2]], 2), { from: [1, 1], prev: [0, 0] });
  assert.deepEqual(neighbours([[0, 0], [1, 1], [2, 2]], 0), { from: [1, 1], prev: [2, 2] });
});

test('a point moved: lines on its centre follow; one on another line\'s vertex follows that line', () => {
  const doc = emptyDoc(0);
  const p = addDot(doc, [10, 40]);
  const l = addLine(doc, p.id, [[10.01, 40.01]], [10.02, 40], { id: 'l' });
  const m = addLine(doc, { element: 'l', vertex: 1, position: [10.01, 40.01] }, [], [10.01, 40.03]);
  p.position = [10, 40.005];
  l.vertices[0].position = [10.01, 40.015];
  settleGeometry(doc);
  assert.deepEqual([l.start.position, m.start.position], [[10, 40.005], [10.01, 40.015]]);
});

test('an ellipse: snapping finds its edge, never its outline\'s samples as corners; a rectangle\'s corners stay', () => {
  const doc = emptyDoc(0);
  const e = addShape(doc, [10.01, 40.01], 'ellipse');
  e.id = 'e';
  Object.assign(e.parts[0], { length: 5000, width: 3000 });
  const sample = verticesOf({ kind: 'point', el: e })[5];
  const hit = snapAt(doc, px(sample), view, { ids: new Set(['e']) });
  assert.equal(hit.kind, 'edge');
  assert.deepEqual([hit.to.element, hit.to.part], ['e', 0]);
  assert.equal(hit.to.vertex, undefined);
  const r = addShape(doc, [10.03, 40.01], 'rectangle');
  const c = verticesOf({ kind: 'point', el: r })[0];
  assert.equal(snapAt(doc, px(c), view, { ids: new Set([r.id]) }).to.vertex, 0);
});

test('an end snapped onto another line\'s leg: attached there, no vertex added; it follows that line, and its vertices added or taken away', () => {
  const doc = emptyDoc(0);
  const h = addLine(doc, [10, 40], [[10.02, 40]], [10.04, 40], { id: 'h' });
  const hit = snapAt(doc, px([10.03, 40.0001]), view);
  assert.deepEqual([hit.kind, hit.to.element, hit.to.edge], ['edge', 'h', 1]);
  assert.ok(Math.abs(hit.to.at - 0.5) < 0.01);
  const m = addLine(doc, [10.03, 40.02], [], attachTo(doc, hit.to));
  assert.equal(h.vertices.length, 1, 'no vertex added');
  assert.deepEqual([m.end.element, m.end.edge], ['h', 1]);
  near(m.end.position, [10.03, 40], 1);
  h.end.position = [10.04, 40.02]; // the leg moved: the end with it, half way along
  settleGeometry(doc);
  near(m.end.position, targetPosition(doc, { element: 'h', edge: 1, at: m.end.at }));
  near(m.end.position, [10.03, 40.01], 2);
  const was = [...m.end.position];
  addVertex(doc, h, 0, [10.01, 40]); // a vertex before it: the same place, now along leg 2
  settleGeometry(doc);
  assert.deepEqual([m.end.element, m.end.edge], ['h', 2]);
  near(m.end.position, was, 0.5);
  removeVertex(doc, h, 1); // the vertex its leg starts at: on the leg left there, at the place nearest
  settleGeometry(doc);
  assert.deepEqual([m.end.element, m.end.edge], ['h', 1]);
  near(m.end.position, targetPosition(doc, { element: 'h', edge: 1, at: m.end.at }));
  assert.ok(m.end.at > 0.5 && m.end.at < 1);
});
