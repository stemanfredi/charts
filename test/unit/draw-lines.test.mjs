import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.geodesic = createRequire(import.meta.url)('geographiclib-geodesic');
globalThis.window ??= { addEventListener() {} };
const { anchorsOf, lineTrace, leg, pointsAlong, nearestAlong, totals, smooth, applySmooth, refreshAuto } = await import('../../site/draw/lines.js');
const { emptyDoc, addPoint, addDot, addShape, addLine, addArea, makeGroup, splitLine, remove, makePart } = await import('../../site/draw/document.js');
const { settleGeometry } = await import('../../site/draw/store.js');
const { inverse } = await import('../../site/geodesy.js');
const { mercator } = await import('../../site/geo.js');

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
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

test('anchors: the start, each vertex and the end, with their handles', () => {
  const { doc, line } = lineOf([12, 40], [[12.1, 40.05]], [12.2, 40], { startHandle: [10, 0], endHandle: [-10, 0] });
  line.vertices[0].handleIn = [-5, 0];
  line.vertices[0].handleOut = [5, 1];
  assert.deepEqual(anchorsOf(doc, line), [
    { position: [12, 40], hIn: null, hOut: [10, 0] },
    { position: [12.1, 40.05], hIn: [-5, 0], hOut: [5, 1] },
    { position: [12.2, 40], hIn: [-10, 0], hOut: null }]);
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
  addLine(doc, [179.5, -17], [], [-179.5, -16], { startHandle: [20000, 0], endHandle: [-20000, 0] });
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

test('totals: per line, per group, per value of a property and in all; guides left out; hidden elements flagged', () => {
  const doc = emptyDoc(0);
  const ringedPoint = addPoint(doc, [12, 40]), dot = addDot(doc, [12.1, 40]);
  addPoint(doc, [12.2, 40], { guide: true });
  const inGroup = addLine(doc, ringedPoint.id, [], dot.id, { properties: [{ key: 'kind', value: 'x' }] });
  const guide = addLine(doc, [12, 40], [], [12.3, 40], { guide: true });
  const hidden = addLine(doc, [12, 41], [[12.1, 41.1]], [12.2, 41], { properties: [{ key: 'kind', value: 'x' }], visible: false });
  addArea(doc, [[12, 42], [12.1, 42], [12.1, 42.1]]);
  addArea(doc, [[13, 42], [13.1, 42], [13.1, 42.1]], { guide: true });
  const g = makeGroup(doc, [ringedPoint.id, dot.id, inGroup.id]);
  const t = totals(doc, 'kind');
  const a = lineTrace(doc, inGroup).length, b = lineTrace(doc, hidden).length;
  assert.deepEqual([...t.lines.keys()].sort(), [inGroup.id, hidden.id].sort(), 'guides have no total');
  near(t.lines.get(inGroup.id), a, 1e-9, 'a line\'s length');
  assert.ok(!t.lines.has(guide.id));
  assert.deepEqual({ ...t.all, length: 0 }, { length: 0, lines: 2, points: 2, ringed: 1, areas: 1, hidden: true });
  near(t.all.length, a + b, 1e-6, 'all');
  // the group's points: one with a round part (the group's), a dot without
  assert.deepEqual({ ...t.groups.get(g.id), length: 0 }, { length: 0, lines: 1, points: 2, ringed: 1, areas: 0, hidden: false });
  assert.deepEqual({ ...t.groups.get(''), length: 0 }, { length: 0, lines: 1, points: 0, ringed: 0, areas: 1, hidden: true });
  near(t.values.get('x').length, a + b, 1e-6, 'kind x');
  assert.equal(t.values.get('x').hidden, true);
  assert.equal(t.values.get('').hidden, false); // those without it
  assert.equal(totals(doc).values.size, 0, 'no key: no values counted');
  // a hidden group hides its members: its totals say so
  g.visible = false;
  assert.equal(totals(doc).groups.get(g.id).hidden, true);
});

test('smooth: tangents at a vertex parallel to its neighbours\' chord, a third of each leg', () => {
  const { doc, line } = lineOf([12, 40], [[12.1, 40.05], [12.15, 39.98]], [12.2, 40]);
  const h = smooth(doc, line);
  const M = [[12, 40], [12.1, 40.05], [12.15, 39.98], [12.2, 40]].map(mercator);
  const chord = [M[2][0] - M[0][0], M[2][1] - M[0][1]];
  const k = 1 / Math.cos((40.05 * Math.PI) / 180), out = h.vertices[0].handleOut.map((v) => v * k), inn = h.vertices[0].handleIn.map((v) => v * k);
  near(out[0] * chord[1] - out[1] * chord[0], 0, 1e-3 * Math.hypot(...out) * Math.hypot(...chord), 'handleOut parallel to the chord');
  near(inn[0] * chord[1] - inn[1] * chord[0], 0, 1e-3 * Math.hypot(...inn) * Math.hypot(...chord), 'handleIn parallel');
  assert.ok(out[0] * chord[0] + out[1] * chord[1] > 0 && inn[0] * chord[0] + inn[1] * chord[1] < 0, 'out forward, in backward');
  near(Math.hypot(...out), Math.hypot(M[2][0] - M[1][0], M[2][1] - M[1][1]) / 3, 0.01, 'a third of the next leg');
  assert.ok(h.startHandle && h.endHandle);
  // a line without vertices, its start free, stays straight
  const straight = lineOf([12, 40], [], [12.2, 40]);
  assert.deepEqual(smooth(straight.doc, straight.line), { startHandle: null, endHandle: null, vertices: [] });
});

test('applySmooth and refreshAuto: lines in mode auto take the Smooth handles, fixed ones keep theirs', () => {
  const doc = emptyDoc(0);
  const auto = addLine(doc, [12, 40], [[12.1, 40.05]], [12.2, 40], { mode: 'auto' });
  const fixed = addLine(doc, [12, 41], [[12.1, 41.05]], [12.2, 41]);
  refreshAuto(doc);
  const h = smooth(doc, auto);
  assert.deepEqual([auto.startHandle, auto.endHandle, auto.vertices[0].handleIn, auto.vertices[0].handleOut],
    [h.startHandle, h.endHandle, h.vertices[0].handleIn, h.vertices[0].handleOut]);
  assert.ok(auto.startHandle);
  assert.deepEqual([fixed.startHandle, fixed.endHandle, fixed.vertices[0].handleIn], [null, null, null]);
  applySmooth(doc, fixed);
  assert.ok(fixed.vertices[0].handleOut, 'applied by hand: handles set');
  assert.equal(fixed.mode, 'fixed');
});

test('relaxed curves: a line heading onwards from a point leaves along the lines arriving there; one turning back stays straight', () => {
  const doc = emptyDoc(0);
  const a = addPoint(doc, [12, 40]), d = addDot(doc, [12.2, 40]), n = addPoint(doc, [12.4, 40.05]), s = addPoint(doc, [12.1, 39.95]);
  addLine(doc, a.id, [], d.id); // arrives at d, heading east
  const on = addLine(doc, d.id, [], n.id, { mode: 'auto' });
  const back = addLine(doc, d.id, [], s.id, { mode: 'auto' });
  refreshAuto(doc);
  assert.ok(on.startHandle && Math.abs(on.startHandle[1]) < 1e-3 * Math.abs(on.startHandle[0]) && on.startHandle[0] > 0, 'east, along the arriving line');
  assert.ok(on.endHandle, 'and bends to its end');
  assert.equal(back.startHandle, null);
  assert.equal(back.endHandle, null);
});

test('relaxed curves: only lines ending at the point count, guides left out; a free start stays straight', () => {
  const doc = emptyDoc(0);
  const d = addDot(doc, [12.2, 40]), n = addPoint(doc, [12.4, 40.05]);
  // a sibling leaving the same point, and a guide arriving there: neither is followed
  addLine(doc, d.id, [], [12.4, 39.9]);
  addLine(doc, [12, 40], [], d.id, { guide: true });
  const on = addLine(doc, d.id, [], n.id, { mode: 'auto' });
  const free = addLine(doc, [12.2, 40], [], [12.4, 40.05], { mode: 'auto' });
  refreshAuto(doc);
  assert.deepEqual([on.startHandle, on.endHandle], [null, null]);
  assert.deepEqual([free.startHandle, free.endHandle], [null, null]);
  // arriving from the north-west: the line leaves heading south-east, then bends to its end
  addLine(doc, [12.1, 40.1], [], d.id);
  refreshAuto(doc);
  assert.ok(on.startHandle && on.startHandle[0] > 0 && on.startHandle[1] < 0, `south-east: ${on.startHandle}`);
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
  const s = addLine(doc, a.id, [[12.1, 40.05], [12.2, 40.1], [12.3, 40.05]], b.id, { name: 'Main', startHandle: [10, 0] });
  Object.assign(s.vertices[1], { name: 'Mark', properties: [{ key: 'k', value: 'v' }], handleIn: [-5, 0], handleOut: [5, 0] });
  const whole = lineTrace(doc, s).length;
  const p = splitLine(doc, s.id, 1);
  assert.deepEqual([p.name, p.position, p.properties, p.symbol, p.parts], ['Mark', [12.2, 40.1], [{ key: 'k', value: 'v' }], 'dot', []]);
  const [first, rest] = doc.lines;
  assert.deepEqual([first.id, first.end, first.vertices.length, first.endHandle, first.startHandle], [s.id, { position: [12.2, 40.1], element: p.id }, 1, [-5, 0], [10, 0]]);
  assert.deepEqual([rest.start, rest.end, rest.vertices.length, rest.startHandle], [{ position: [12.2, 40.1], element: p.id }, { position: [12.4, 40], element: b.id }, 1, [5, 0]]);
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
