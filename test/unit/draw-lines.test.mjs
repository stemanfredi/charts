import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near, addShape } from './helpers.mjs';

const { anchorsOf, lineTrace, leg, pointsAlong, nearestAlong, totals } = await import('../../site/draw/lines.js');
const { emptyDoc, addPoint, addDot, addLine, addArea, makeGroup, splitLine, remove, makePart } = await import('../../site/draw/document.js');
const { settleGeometry } = await import('../../site/draw/store.js');
const { inverse } = await import('../../site/geodesy.js');
const { mercator } = await import('../../site/geo.js');

// a line from start to end (positions or point IDs) through vertices, in a new document unless one is given
const lineOf = (start, vertices, end, opts = {}, doc = emptyDoc(0)) => ({ doc, line: addLine(doc, start, vertices, end, opts) });

test('straight legs: the same length as the ruler over the same points', () => {
  const pts = [[9.5245389, 37.2913083], [9.5179611, 37.2983056], [9.4870056, 37.5712417], [10.62, 42.8]];
  const { doc, line } = lineOf(pts[0], pts.slice(1, -1), pts[3]);
  const tr = lineTrace(doc, line);
  near(tr.length, pts.slice(1).reduce((t, p, i) => t + inverse(pts[i], p).s, 0), 1e-6, 'length');
  // distance along: at each anchor, the legs before it
  assert.equal(tr.at.length, 4);
  assert.equal(tr.legs.length, 3);
  near(tr.at[2], inverse(pts[0], pts[1]).s + inverse(pts[1], pts[2]).s, 1e-6, 'at vertex 2');
  near(tr.at[3], tr.length, 1e-9, 'at the end');
  near(tr.legs.reduce((a, l) => a + l, 0), tr.length, 1e-6, 'the legs add up');
  assert.deepEqual(tr.coords[0], pts[0]);
  assert.deepEqual(tr.coords.at(-1), pts[3]);
});

test('anchors: the start, each vertex and the end; handles only on a smooth line with a vertex', () => {
  const { line } = lineOf([12, 40], [[12.1, 40.05]], [12.2, 40]);
  assert.deepEqual(anchorsOf(line), [
    { position: [12, 40], hIn: null, hOut: null },
    { position: [12.1, 40.05], hIn: null, hOut: null },
    { position: [12.2, 40], hIn: null, hOut: null }]);
  line.smooth = true;
  const an = anchorsOf(line);
  assert.ok(an[0].hOut && an[1].hIn && an[1].hOut && an[2].hIn && !an[0].hIn && !an[2].hOut);
  const two = lineOf([12, 40], [], [12.2, 40], { smooth: true }).line;
  assert.ok(anchorsOf(two).every((a) => !a.hIn && !a.hOut), 'no vertex: straight');
});

test('curved legs: zero handles follow the rhumb line; a handle is ground metres scaled by the projection', () => {
  const a = [0, 60], b = [1, 60];
  const rhumb = leg({ position: a, hOut: [0, 0] }, { position: b, hIn: null });
  // along a parallel: every sample on the parallel (the rhumb line), not the geodesic, which bulges north
  for (const p of rhumb.pts) near(p[1], 60, 1e-9, 'latitude');
  assert.ok(rhumb.length > inverse(a, b).s, 'the rhumb line is longer than the geodesic');
  // the curve's first sample, close to its start, heads east
  const l = leg({ position: a, hOut: [100, 0] }, { position: b, hIn: [0, 0] });
  assert.ok(mercator(l.pts[1])[0] > mercator(a)[0]);
  // length converges: sampling twice as fine changes it by less than the tolerance
  const curve = leg({ position: [12, 40], hOut: [3000, 2000] }, { position: [12.1, 40.05], hIn: [-1000, 3000] });
  assert.ok(curve.pts.length > 17);
  let fine = 0;
  for (let i = 1; i < curve.pts.length; i++) fine += inverse(curve.pts[i - 1], curve.pts[i]).s;
  near(fine, curve.length, 1e-6, 'length is the sum over its samples');
  assert.deepEqual([curve.pts[0], curve.pts.at(-1)], [[12, 40], [12.1, 40.05]], 'the anchors exactly');
});

test('a handle of [100, 0] at 60° N is 200 m of Mercator x', () => {
  // read back the Bézier's first control point from a sample: with P2 = P3 (no handle at b),
  // B(t) = (1−t)³P0 + 3(1−t)²t P1 + (3(1−t)t² + t³)P3
  const a = [0, 60], b = [0.01, 60.001];
  const l = leg({ position: a, hOut: [100, 0] }, { position: b, hIn: [0, 0] });
  const n = l.pts.length - 1, t = 1 / n, u = 1 - t;
  const P0 = mercator(a), P3 = mercator(b), B = mercator(l.pts[1]);
  const P1 = [0, 1].map((i) => (B[i] - u ** 3 * P0[i] - (3 * u * t * t + t ** 3) * P3[i]) / (3 * u * u * t));
  near(P1[0] - P0[0], 200, 1e-3, 'Mercator x of the handle');
  near(P1[1] - P0[1], 0, 1e-3, 'Mercator y of the handle');
});

test('across the antimeridian: continuous longitudes', () => {
  const doc = emptyDoc(0);
  addLine(doc, [179.5, -17], [[179.9, -16.6]], [-179.5, -16]);
  addLine(doc, [179.5, -17], [[179.9, -16.6]], [-179.5, -16], { smooth: true });
  for (const s of doc.lines) {
    const { coords } = lineTrace(doc, s);
    for (let i = 1; i < coords.length; i++) assert.ok(Math.abs(coords[i][0] - coords[i - 1][0]) < 1, `${s.name}: jump at ${i}`);
    assert.ok(coords.at(-1)[0] > 180);
  }
});

test('a trace is computed again when an anchor moves, and not otherwise', () => {
  const { doc, line } = lineOf([12, 40], [[12.1, 40]], [12.2, 40]);
  const first = lineTrace(doc, line);
  assert.equal(lineTrace(doc, line), first, 'unchanged: the same trace');
  line.vertices[0].position = [12.1, 40.1];
  const moved = lineTrace(doc, line);
  assert.notEqual(moved, first);
  assert.ok(moved.length > first.length, 'a bent line is longer');
});

test('points along: the start, the end and between, with the line\'s direction', () => {
  const { doc, line } = lineOf([12, 40], [[12.1, 40]], [12.1, 40.1]);
  const tr = lineTrace(doc, line);
  const [s, m, e] = pointsAlong(tr.coords, [0, tr.at[1] / 2, tr.length]);
  near(inverse(s.position, [12, 40]).s, 0, 1e-6, 'the start');
  near(inverse(e.position, [12.1, 40.1]).s, 0, 0.01, 'the end');
  near(inverse([12, 40], m.position).s, tr.at[1] / 2, 0.01, 'half the first leg');
  near(m.azi, 90, 0.1, 'east along the first leg');
  near(e.azi, 0, 0.1, 'north along the second');
  assert.deepEqual(pointsAlong([[5, 5]], [0, 100]), [{ position: [5, 5], azi: 0 }, { position: [5, 5], azi: 0 }], 'a single position');
});

test('nearest along: the distance from the start of the place nearest a position', () => {
  const { doc, line } = lineOf([12, 40], [[12.1, 40]], [12.1, 40.1]);
  const tr = lineTrace(doc, line);
  near(nearestAlong(tr.coords, [12.05, 40.01]), tr.at[1] / 2, 50, 'beside the first leg, half way');
  near(nearestAlong(tr.coords, [12.2, 40.05]), tr.at[1] + (tr.length - tr.at[1]) / 2, 50, 'beside the second');
  near(nearestAlong(tr.coords, [11.9, 39.9]), 0, 1e-6, 'before the start');
  near(nearestAlong(tr.coords, [12.1, 41]), tr.length, 1e-6, 'past the end');
});

test('totals: per group and in all; guides left out; hidden elements flagged', () => {
  const doc = emptyDoc(0);
  const ringedPoint = addPoint(doc, [12, 40]), dot = addDot(doc, [12.1, 40]);
  addPoint(doc, [12.2, 40], { guide: true });
  const inGroup = addLine(doc, ringedPoint.id, [], dot.id, { properties: [{ key: 'kind', value: 'x' }] });
  addLine(doc, [12, 40], [], [12.3, 40], { guide: true });
  const hidden = addLine(doc, [12, 41], [[12.1, 41.1]], [12.2, 41], { properties: [{ key: 'kind', value: 'x' }], visible: false });
  addArea(doc, [[12, 42], [12.1, 42], [12.1, 42.1]]);
  addArea(doc, [[13, 42], [13.1, 42], [13.1, 42.1]], { guide: true });
  const g = makeGroup(doc, [ringedPoint.id, dot.id, inGroup.id]);
  const t = totals(doc);
  const a = lineTrace(doc, inGroup).length, b = lineTrace(doc, hidden).length;
  assert.deepEqual({ ...t.all, length: 0 }, { length: 0, lines: 2, points: 2, ringed: 1, areas: 1, hidden: true }, 'guides left out');
  near(t.all.length, a + b, 1e-6, 'all');
  // the group's points: one with a round part (the group's), a dot without
  assert.deepEqual({ ...t.groups.get(g.id), length: 0 }, { length: 0, lines: 1, points: 2, ringed: 1, areas: 0, hidden: false });
  near(t.groups.get(g.id).length, a, 1e-9, 'the group\'s line');
  assert.deepEqual({ ...t.groups.get(''), length: 0 }, { length: 0, lines: 1, points: 0, ringed: 0, areas: 1, hidden: true });
  // a hidden group hides its members: its totals say so
  g.visible = false;
  assert.equal(totals(doc).groups.get(g.id).hidden, true);
});

test('smooth: tangents at a vertex parallel to its neighbours\' chord, a third of each leg', () => {
  const { line } = lineOf([12, 40], [[12.1, 40.05], [12.15, 39.98]], [12.2, 40], { smooth: true });
  const an = anchorsOf(line);
  const M = [[12, 40], [12.1, 40.05], [12.15, 39.98], [12.2, 40]].map(mercator);
  const chord = [M[2][0] - M[0][0], M[2][1] - M[0][1]];
  const k = 1 / Math.cos((40.05 * Math.PI) / 180), out = an[1].hOut.map((v) => v * k), inn = an[1].hIn.map((v) => v * k);
  near(out[0] * chord[1] - out[1] * chord[0], 0, 1e-3 * Math.hypot(...out) * Math.hypot(...chord), 'out parallel to the chord');
  near(inn[0] * chord[1] - inn[1] * chord[0], 0, 1e-3 * Math.hypot(...inn) * Math.hypot(...chord), 'in parallel');
  assert.ok(out[0] * chord[0] + out[1] * chord[1] > 0 && inn[0] * chord[0] + inn[1] * chord[1] < 0, 'out forward, in backward');
  near(Math.hypot(...out), Math.hypot(M[2][0] - M[1][0], M[2][1] - M[1][1]) / 3, 0.01, 'a third of the next leg');
});

test('a smooth line follows its vertices: longer than straight, its curve again when one moves', () => {
  const { doc, line } = lineOf([12, 40], [[12.1, 40.05]], [12.2, 40]);
  const straight = lineTrace(doc, line).length;
  line.smooth = true;
  const curved = lineTrace(doc, line);
  assert.ok(curved.length > straight, 'a curve through the vertex is longer than its two legs');
  line.vertices[0].position = [12.1, 40.1];
  assert.notEqual(lineTrace(doc, line), curved, 'computed again');
});

test('an attached end follows its point; one whose point is deleted stays where it was, free', () => {
  const doc = emptyDoc(0);
  const a = addPoint(doc, [12, 40]), b = addPoint(doc, [12.2, 40]);
  const line = addLine(doc, a.id, [[12.1, 40.05]], b.id);
  assert.deepEqual([line.start, line.end], [{ position: [12, 40], element: a.id }, { position: [12.2, 40], element: b.id }]);
  const before = lineTrace(doc, line).length;
  b.position = [12.4, 40];
  settleGeometry(doc);
  assert.deepEqual(line.end.position, [12.4, 40]);
  assert.ok(lineTrace(doc, line).length > before, 'longer');
  remove(doc, [b.id]);
  settleGeometry(doc);
  assert.deepEqual(line.end, { position: [12.4, 40], element: null });
});

test('totals: a point with at least one round part counted as ringed, whatever else it has', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [12, 40]); // a circle
  addPoint(doc, [12, 40], { parts: [makePart('sector', { radius: 500, aperture: 40 })] });
  addShape(doc, [12, 40]); // an outline only
  addPoint(doc, [12, 40], { parts: [makePart('ellipse'), { ...makePart('circle'), fill: false, shown: false }] }); // hidden and not filled: still one
  addDot(doc, [12, 40]);
  assert.deepEqual([totals(doc).all.points, totals(doc).all.ringed], [5, 3]);
});

test('split: a vertex becomes a dot both parts are attached to; lengths unchanged; the dot moved, both follow', () => {
  const doc = emptyDoc(0);
  const a = addPoint(doc, [12, 40]), b = addPoint(doc, [12.4, 40]);
  const s = addLine(doc, a.id, [[12.1, 40.05], [12.2, 40.1], [12.3, 40.05]], b.id, { name: 'Main' });
  Object.assign(s.vertices[1], { name: 'Mark' });
  const whole = lineTrace(doc, s).length;
  const p = splitLine(doc, s.id, 1);
  assert.deepEqual([p.name, p.position, p.properties, p.symbol, p.parts], ['Mark', [12.2, 40.1], [], 'dot', []]);
  const [first, rest] = doc.lines;
  assert.deepEqual([first.id, first.end, first.vertices.length], [s.id, { position: [12.2, 40.1], element: p.id }, 1]);
  assert.deepEqual([rest.start, rest.end, rest.vertices.length], [{ position: [12.2, 40.1], element: p.id }, { position: [12.4, 40], element: b.id }, 1]);
  assert.notEqual(rest.id, first.id);
  near(lineTrace(doc, first).length + lineTrace(doc, rest).length, whole, 1e-6, 'length');
  p.position = [12.2, 40.2];
  settleGeometry(doc);
  assert.deepEqual([first.end.position, rest.start.position], [[12.2, 40.2], [12.2, 40.2]]);
});

test('totals: a group counts everything in it, its subgroups\' too', () => {
  const doc = emptyDoc(0);
  const a = addPoint(doc, [12, 40]), b = addPoint(doc, [12.1, 40]), c = addPoint(doc, [12.2, 40]);
  const s = addLine(doc, a.id, [], b.id);
  const top = makeGroup(doc, [a.id, b.id, c.id, s.id]), sub = makeGroup(doc, [a.id, s.id]);
  const t = totals(doc);
  assert.deepEqual([t.groups.get(top.id).points, t.groups.get(top.id).lines, t.groups.get(sub.id).points, t.groups.get(sub.id).lines], [3, 1, 1, 1]);
  assert.equal(t.groups.get(top.id).length, t.groups.get(sub.id).length);
  assert.ok(!t.groups.has(''), 'nothing outside a group');
});

test('breakdown: lines by group with each listed, a connection\'s summed by what they are; areas; points by kind', async () => {
  const { breakdown } = await import('../../site/draw/lines.js');
  const { connect } = await import('../../site/draw/generator.js');
  const doc = emptyDoc(0);
  const a = addLine(doc, [12, 40], [], [12.1, 40], { name: 'A' });
  addLine(doc, [12, 40.2], [], [12.1, 40.2], { visible: false });
  addLine(doc, [12, 40.4], [], [12.1, 40.4], { guide: true });
  const g = makeGroup(doc, [a.id]);
  addArea(doc, [[12, 42], [12.1, 42], [12.1, 42.1]]);
  addPoint(doc, [13, 40]); addPoint(doc, [13, 40], { parts: [makePart('circle', { radius: 100 })] }); addPoint(doc, [13, 40], { parts: [makePart('rectangle', { length: 10, width: 5 })] });
  // a tree of three points from one root, and a chain of two from another
  const pts = [[14, 40], [14.01, 40], [14.02, 40]].map((q) => addPoint(doc, q)), root = addPoint(doc, [14.01, 39.9]);
  connect(doc, { pointIds: pts.map((p) => p.id), roots: [{ id: root.id, weight: 1 }], pattern: 'tree', groupSize: 3 });
  const cs = [[15, 40], [15.01, 40]].map((q) => addPoint(doc, q)), r2 = addPoint(doc, [15, 39.9]);
  connect(doc, { pointIds: cs.map((p) => p.id), roots: [{ id: r2.id, weight: 1 }], pattern: 'chain', groupSize: 'auto' });
  const t = breakdown(doc);
  assert.equal(t.lines.count, 2 + 4 + 2, 'the guide left out; the tree\'s trunk and three branches; the chain\'s two links');
  assert.equal(t.lines.hidden, true);
  const own = t.lines.rows.find((r) => r.key === g.id);
  assert.deepEqual(own.lines.map((l) => l.id), [a.id]);
  near(own.length, lineTrace(doc, a).length, 1e-9, 'the group\'s length');
  const tree = t.lines.rows.find((r) => r.parts.some((p) => p.part === 'trunk'));
  assert.deepEqual(tree.parts.map((p) => [p.part, p.count]), [['trunk', 1], ['branch', 3]]);
  assert.equal(tree.lines.length, 0, 'a connection\'s lines are summed, not listed');
  const chain = t.lines.rows.find((r) => r.parts.some((p) => p.part === 'root link'));
  assert.deepEqual(chain.parts.map((p) => [p.part, p.count]), [['root link', 1], ['link', 1]]);
  assert.equal(t.lines.rows.find((r) => r.key === '').lines.length, 1, 'the ungrouped hidden line, listed');
  assert.deepEqual([t.areas.count, t.areas.rows.length], [1, 1]);
  assert.ok(t.areas.area > 0 && t.areas.perimeter > 0);
  // by a property none has: every line under '', the connections' still summed by what they are
  const byPart = breakdown(doc, 'part');
  assert.deepEqual(byPart.lines.rows.map((r) => [r.key, r.parts.map((p) => p.part)]), [['', ['trunk', 'branch', 'root link', 'link']]]);
  assert.ok(doc.lines.every((s) => !s.properties.length), 'a connection\'s lines carry no property of the app\'s');
  // points by kind: the one rectangle; every point counted (the connections' hubs and roots too)
  assert.equal(t.points.kinds.get('rectangle'), 1);
  assert.equal([...t.points.kinds.values()].reduce((x, y) => x + y, 0), t.points.count);
  assert.deepEqual([...byPart.points.kinds.keys()], [''], 'by a property: points by its values');
  assert.equal(t.points.count, doc.points.length);
});
