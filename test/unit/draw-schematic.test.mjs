import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.geodesic = createRequire(import.meta.url)('geographiclib-geodesic');
const { schematic } = await import('../../site/draw/schematic.js');
const { emptyDoc, addDot, addLine, makeGroup } = await import('../../site/draw/document.js');
const { toFile } = await import('../../site/draw/file.js');
const { totals, lineTrace } = await import('../../site/draw/lines.js');
const { exportFeatures } = await import('../../site/draw/features.js');
const { mercator, CIRC } = await import('../../site/geo.js');

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const ZOOM = 10, PX = CIRC / (512 * 2 ** ZOOM); // Mercator metres a pixel
// the geodesic from a to b, as a line's trace (a line of no drawing)
let refs = 0;
const ref = (doc, a, b) => lineTrace(doc, { id: `ref${++refs}`, start: { position: a, element: null }, end: { position: b, element: null }, startHandle: null, endHandle: null, vertices: [] });
// the offset of a drawn point from the geodesic a–b, in px at zoom 10, left positive (the lines here
// run east: left is north). The geodesic is a little north of the parallel between its ends.
const offFrom = (doc, a, b) => {
  const real = ref(doc, a, b).coords.map(mercator);
  return (p) => {
    const q = mercator(p);
    let i = 1;
    while (i < real.length - 1 && real[i][0] < q[0]) i++;
    const f = (q[0] - real[i - 1][0]) / (real[i][0] - real[i - 1][0]);
    return (q[1] - (real[i - 1][1] + f * (real[i][1] - real[i - 1][1]))) / PX;
  };
};
// the drawn point nearest a longitude
const at = (c, lon) => c.reduce((a, p) => (Math.abs(p[0] - lon) < Math.abs(a[0] - lon) ? p : a));
const r7 = (p) => p.map((v) => +v.toFixed(7));

// two lines running together east from a to d, then one turning north (left) to n and one south
// (right) to s, their ends attached to dots
const A = [12, 40], D = [12.5, 40], N = [12.7, 40.2], S = [12.7, 39.8];
function fork(optsN = { look: { apart: 2 } }, optsS = { look: { apart: 2 } }) {
  const doc = emptyDoc();
  const a = addDot(doc, A), n = addDot(doc, N), s = addDot(doc, S);
  const ln = addLine(doc, a.id, [D], n.id, optsN), ls = addLine(doc, a.id, [D], s.id, optsS);
  return { doc, ln, ls };
}

test('lines running together: side by side, centred on them, the gap between their strokes, the same at every zoom', () => {
  const { doc, ln, ls } = fork();
  const off = offFrom(doc, A, D);
  for (const z of [8, ZOOM, 14]) {
    const m = schematic(doc, z), px = CIRC / (512 * 2 ** z);
    const offZ = (p) => off(p) * PX / px; // off measures in zoom-10 pixels
    near(offZ(at(m.get(ln.id), 12.25)), 1.75, 0.05, `the one turning left, left, zoom ${z}`);
    near(offZ(at(m.get(ls.id), 12.25)), -1.75, 0.05, `the one turning right, right, zoom ${z}`);
  }
  // each comes back to its ends
  const m = schematic(doc, ZOOM);
  assert.deepEqual(r7(m.get(ln.id)[0]), A);
  assert.deepEqual(r7(m.get(ln.id).at(-1)), N);
  assert.deepEqual(r7(m.get(ls.id).at(-1)), S);
});

test('the gap is between strokes, whatever their widths; the stretch takes the widest gap; 0 is off', () => {
  const { doc, ln, ls } = fork({ look: { apart: 2 } }, { look: { apart: 2, stroke: { width: 5 } } });
  const off = offFrom(doc, A, D);
  const sep = (m) => off(at(m.get(ln.id), 12.25)) - off(at(m.get(ls.id), 12.25));
  near(sep(schematic(doc, ZOOM)), (5 + 1.5) / 2 + 2, 0.05, 'the default 2 px');
  ln.look.apart = 10;
  near(sep(schematic(doc, ZOOM)), (5 + 1.5) / 2 + 10, 0.05, 'the wider, 10 px');
  for (const l of doc.lines) l.look.apart = 0;
  const zero = schematic(doc, ZOOM);
  assert.ok(zero instanceof Map);
  assert.equal(zero.size, 0);
});

// one route east a–m–q–e, and three lines along it: a–e, a–m, a–q, Draw apart their group's
const RA = [12, 40], RM = [12.2, 40], RQ = [12.4, 40], RE = [12.6, 40];
function route() {
  const doc = emptyDoc();
  const [a, m, q, e] = [RA, RM, RQ, RE].map((p) => addDot(doc, p));
  const full = addLine(doc, a.id, [RM, RQ], e.id), first = addLine(doc, a.id, [], m.id), two = addLine(doc, a.id, [RM], q.id);
  const g = makeGroup(doc, [full.id, first.id, two.id]);
  g.look.apart = 2;
  return { doc, full, first, two, g };
}

test('a route and two parts of it: the shortest in the middle, the longer outwards, each reaching its end without crossing', () => {
  const { doc, full, first, two } = route();
  const m = schematic(doc, ZOOM), pitch = 1.5 + 2;
  const legs = { l1: offFrom(doc, RA, RM), l2: offFrom(doc, RM, RQ), l3: offFrom(doc, RQ, RE) };
  const on = (x, l, lon) => legs[l](at(m.get(x.id) ?? lineTrace(doc, x).coords, lon));
  // on the first leg, three: the shortest in the middle (on its line), the next right, the whole route left
  near(on(first, 'l1', 12.1), 0, 0.05, 'first: the middle slot, on its line');
  near(on(two, 'l1', 12.1), -pitch, 0.05, 'two, right');
  near(on(full, 'l1', 12.1), pitch, 0.05, 'full, left');
  // on the second, two: either side; on the third, the whole route alone, on its line
  near(on(two, 'l2', 12.3), -pitch / 2, 0.05, 'two on the second leg');
  near(on(full, 'l2', 12.3), pitch / 2, 0.05, 'full on the second leg');
  near(on(full, 'l3', 12.55), 0, 0.05, 'full alone on the third leg');
  // two ends on its point at q; nothing jumps
  assert.deepEqual(r7(m.get(two.id).at(-1)), RQ);
  const across = m.get(full.id).filter((p) => p[0] < 12.2).map(legs.l1);
  assert.ok(across.every((v, i) => !i || Math.abs(v - across[i - 1]) < 1.5), 'smooth');
});

// two lines on one route (the second a straight geodesic, the first through a vertex), a third crossing them
function twin(lat = 40.0000001, hidden = false) {
  const doc = emptyDoc();
  const long = addLine(doc, [12, 40], [[12.2, 40]], [12.4, 40], { look: { apart: 2 }, visible: !hidden });
  const tw = addLine(doc, [12, lat], [], [12.4, lat], { look: { apart: 2 } });
  const cross = addLine(doc, [12.2, 39.9], [], [12.2, 40.1], { look: { apart: 2 } });
  return { doc, long, tw, cross };
}

test('lines that coincide: the same stretch within the tolerance; farther, or crossing, not', () => {
  const { doc, long, tw, cross } = twin();
  const m = schematic(doc, ZOOM), off = offFrom(doc, [12, 40], [12.2, 40]);
  assert.ok(!m.has(cross.id), 'a crossing line is not moved');
  // the twin shares a stretch with the line: side by side about it, 1.5 px lines 2 px apart
  near(off(at(m.get(tw.id), 12.1)), -1.75, 0.05, 'twin, the shorter: right');
  near(off(at(m.get(long.id), 12.1)), 1.75, 0.05, 'long: left');
  assert.deepEqual(r7(m.get(tw.id)[0]), [12, 40.0000001], 'on its start');
  // a twin 300 m away: farther than the tolerance, never on the same stretch, at any zoom
  const far = twin(40.0027);
  for (const z of [6, 8, 12]) assert.ok(!schematic(far.doc, z).has(far.tw.id), `not moved at zoom ${z}`);
  // hidden: not drawn, so nothing moves for it
  assert.equal(schematic(twin(40.0000001, true).doc, ZOOM).size, 0);
});

test('Draw apart: only ticked lines take part; one ticked alone does not move; a line\'s own value wins over its group\'s', () => {
  assert.equal(schematic(fork({}, {}).doc, ZOOM).size, 0, 'none ticked');
  assert.equal(schematic(fork({ look: { apart: 2 } }, {}).doc, ZOOM).size, 0, 'one ticked, the other not: no stretch to share');
  const { doc, two, full } = route();
  assert.ok(schematic(doc, ZOOM).has(two.id), 'the group\'s');
  two.look.apart = 0;
  assert.ok(!schematic(doc, ZOOM).has(two.id), 'its own: not drawn apart');
  // in the file: the group's value, the line's own 0, nothing for a line taking its group's
  const f = toFile(doc), own = (id) => f.features.find((x) => x.id === id).properties.charts;
  assert.deepEqual([f.charts.groups[0].look.apart, own(two.id).look.apart, 'apart' in (own(full.id).look ?? {})], [2, 0, false]);
});

test('zoomed far out, a line too short on screen for its place comes nearer, rather than bending', () => {
  const { doc, two, g } = route();
  g.look.apart = 30;
  const z = 8, mpp = CIRC / (512 * 2 ** z), m = schematic(doc, z);
  // it is 146 px long here: its place (31.5 px on the first leg) and its coming back to its ends do
  // not fit at 1 px across for 4 along (eased: steeper midway), so all of it is nearer, the slope kept
  const pts = m.get(two.id).map(mercator);
  const off = (q) => Math.abs(q[1] - mercator(RA)[1]) / mpp; // the route runs along 40° N
  const most = Math.max(...pts.map(off)), steepest = Math.max(...pts.slice(1).map((q, i) => Math.abs(off(q) - off(pts[i])) / (Math.abs(q[0] - pts[i][0]) / mpp || Infinity)));
  assert.ok(most < 31.5 - 1, `nearer than its place (${most.toFixed(1)} px)`);
  assert.ok(steepest <= 0.6, `smooth: never steeper than about 1 in 2 (${steepest.toFixed(2)})`);
});

test('a shallow crossing is not running alongside: nothing moves for it', () => {
  // a line east, and another crossing it at about 6° over 0.4° of longitude, both ticked
  const doc = emptyDoc();
  addLine(doc, [12, 40], [], [12.4, 40], { look: { apart: 2 } });
  addLine(doc, [12, 39.98], [], [12.4, 40.02], { look: { apart: 2 } });
  assert.equal(schematic(doc, ZOOM).size, 0);
});

test('display only: the drawing, its totals and its export are the same whatever the gap', () => {
  const { doc } = fork();
  const before = [JSON.stringify(doc), totals(doc).all.length, JSON.stringify(exportFeatures(doc))];
  schematic(doc, ZOOM);
  assert.deepEqual([JSON.stringify(doc), totals(doc).all.length, JSON.stringify(exportFeatures(doc))], before);
});
