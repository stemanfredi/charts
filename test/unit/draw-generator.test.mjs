import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.geodesic = createRequire(import.meta.url)('geographiclib-geodesic');
const { distribute, alongTrace, hubFor, plan, lines, planConnection, makeDistribution, editDistribution, connect, unconnect, reconnect, refreshGenerated, COPY_RADIUS,
  distributions, connections, copyOf, giveBack, changedByHand, ruleOf, distributionOf, connectionOn, MAX_COPIES, MAX_AUTO_TREE } = await import('../../site/draw/generator.js');
const { emptyDoc, addPoint, addLine, makePart, find, remove } = await import('../../site/draw/document.js');
const { BUILT_IN, scaled } = await import('../../site/draw/place.js');
const { lineTrace, nearestAlong, pointsAlong, totals } = await import('../../site/draw/lines.js');
const { settleGeometry, DrawStore } = await import('../../site/draw/store.js');
const { inverse } = await import('../../site/geodesy.js');
const { verticesOf } = await import('../../site/draw/attach.js');
const { parse, serialise } = await import('../../site/draw/file.js');
const { inflated } = await import('../../site/draw/inflate.js');

const R = (position, weight = 1) => ({ position, weight }); // a root for plan()
const roots = (...ids) => ids.map((id) => ({ id, weight: 1 })); // roots for connect()
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const part = (s) => s.properties.find((p) => p.key === 'part')?.value;
// how far a position is from a line (metres, to the place along it nearest)
// (measured as on screen: a few metres' tolerance over tens of km)
const offLine = (doc, line, p) => { const c = lineTrace(doc, line).coords; return inverse(pointsAlong(c, [nearestAlong(c, p)])[0].position, p).s; };
// how far an array's point (its record x) is from its place along the line (no offset)
const fromPlace = (doc, line, x) => { const tr = lineTrace(doc, line); return inverse(pointsAlong(tr.coords, [x.t * tr.length])[0].position, find(doc, x.pointId).el.position).s; };

test('distribute: every spacing along the line between the margins, offset square to it, sides alternating', () => {
  const doc = emptyDoc(0);
  const g = addLine(doc, [12, 40], [[12.1, 40.03]], [12.2, 40]);
  const tr = lineTrace(doc, g);
  const on = distribute(doc, g, { spacing: 2000, startMargin: 500, endMargin: 1000 });
  assert.equal(on.length, tr.length);
  assert.equal(on.points.length, Math.floor((tr.length - 1500) / 2000) + 1);
  near(inverse([12, 40], on.points[0].position).s, 500, 0.5, 'the first at the start margin'); // a straight first leg
  near(on.points[0].t, 500 / tr.length, 1e-9, 't: the place along, 0 to 1');
  assert.ok(on.points.every((p) => p.left), 'left by default');
  const off = distribute(doc, g, { spacing: 2000, startMargin: 500, endMargin: 1000, offset: 300, side: 'alternate' });
  for (let k = 0; k < 3; k++) near(inverse(on.points[k].position, off.points[k].position).s, 300, 0.01, `offset ${k}`);
  // the first to the left of the line's direction (north-east on this leg), the second to the right
  assert.ok(off.points[0].position[1] > on.points[0].position[1]);
  assert.ok(off.points[1].position[1] < on.points[1].position[1]);
  assert.deepEqual(off.points.slice(0, 3).map((p) => p.left), [true, false, true]);
  // facing: away from the line, on the side offset to (square to its direction)
  const azi = inverse(on.points[0].position, off.points[0].position).azi;
  near(((off.points[0].facing - azi + 540) % 360) - 180, 0, 0.5, 'facing the offset');
  assert.ok(distribute(doc, g, { spacing: 2000, side: 'right' }).points.every((p) => !p.left));
  assert.equal(distribute(doc, g, { spacing: 2000, startMargin: 20000, endMargin: 20000 }).points.length, 0);
});

test('count instead of spacing: that many points, evenly between the margins; one in the middle', () => {
  const doc = emptyDoc(0);
  const g = addLine(doc, [12, 40], [], [12.4, 40]);
  const L = lineTrace(doc, g).length;
  const { points } = distribute(doc, g, { count: 5, startMargin: 1000, endMargin: 1000 });
  assert.equal(points.length, 5);
  const d = points.slice(1).map((p, i) => inverse(points[i].position, p.position).s);
  for (const x of d) near(x, d[0], 1, 'even');
  near(points[0].t * L, 1000, 1e-6, 'the first at the start margin');
  near(points[4].t * L, L - 1000, 1e-6, 'the last at the end margin');
  near(distribute(doc, g, { count: 1 }).points[0].t, 0.5, 1e-9, 'one: the middle');
  assert.equal(distribute(doc, g, { count: 3, startMargin: L, endMargin: L }).points.length, 0, 'no room');
});

test('plan: each group to the root it is cheapest from; a root that wins no group is reported unused', () => {
  const pts = [0, 1, 2, 3, 4, 5].map((i) => [12 + i * 0.02, 40]);
  // two roots at the two ends: the groups split between them
  const two = plan(pts, [R([11.95, 40]), R([12.15, 40])], 3);
  assert.deepEqual(two.groups.map((g) => [g.nodes, g.root]), [[[0, 1, 2], 0], [[3, 4, 5], 1]]);
  assert.deepEqual(two.unused, []);
  near(two.total, two.groups.reduce((a, g) => a + g.cost, 0), 1e-9, 'the total: the groups\' total');
  // a second root a little behind the first: nothing is cheapest from it, left unused, reported (no
  // share is forced on it: a weight would pull one)
  assert.deepEqual(plan(pts, [R([11.95, 40]), R([11.95, 40.01])], 3).unused, [1]);
  assert.deepEqual(plan(pts, [R([11.95, 40]), R([11.95, 40.01], 4)], 3).unused, [0], 'weighted 4, it wins everything');
  // a second root far from everything: the same
  assert.deepEqual(plan(pts, [R([11.95, 40]), R([20, 50])], 3).unused, [1]);
  // more roots than groups
  assert.equal(plan(pts.slice(0, 2), [R([11.95, 40]), R([12.2, 40])], 3).unused.length, 1);
  // nothing to plan
  assert.deepEqual(plan([], [R([0, 0])], 3), { groups: [], unused: [0], total: 0, groupSize: 3 });
});

test('plan: the cheapest cut of all, not an even share; a tie keeps fewer groups', () => {
  // a root at the western end, another far to the east: the east root takes only what is nearer it
  const pts = Array.from({ length: 10 }, (_, i) => [12 + i * 0.02, 40]);
  const p = plan(pts, [R([11.98, 40]), R([12.5, 40])], 'auto', 'chain');
  assert.deepEqual(p.groups.map((g) => [g.root, g.nodes.length]), [[0, 10]], 'every point from the near root: one chain');
  // the brute force agrees: no cut of up to 3 per group to either root is cheaper
  const best = plan(pts, [R([11.98, 40]), R([12.12, 40])], 3, 'tree');
  const cuts = (n, k) => (n === 0 ? [[]] : Array.from({ length: Math.min(k, n) }, (_, i) => i + 1).flatMap((c) => cuts(n - c, k).map((rest) => [c, ...rest])));
  let min = Infinity;
  for (const sizes of cuts(10, 3)) {
    let at = 0, total = 0;
    for (const c of sizes) { const g = pts.slice(at, at + c); at += c; total += Math.min(...[R([11.98, 40]), R([12.12, 40])].map((r) => plan(g, [r], c, 'tree').total)); }
    min = Math.min(min, total);
  }
  near(best.total, min, 1e-6, 'the optimum over every cut and assignment');
  // a tie: three points equally far from one root, one tree not three
  assert.equal(plan([[12, 40], [12.02, 40], [12.04, 40]], [R([12.02, 39.9])], 3).groups.length, 1);
});

test('weights: a root with a weight of 2 wins groups as if it were half as far', () => {
  const pts = Array.from({ length: 8 }, (_, i) => [12 + i * 0.02, 40]);
  const rs = [[11.98, 40], [12.3, 40]]; // the east root farther from the last point than the west one is from the first
  const plain = plan(pts, rs.map((q) => R(q)), 4, 'chain');
  assert.deepEqual(plain.groups.map((g) => g.root), [0, 0], 'without weights, both chains from the west root');
  const pulled = plan(pts, [R(rs[0]), R(rs[1], 3)], 4, 'chain');
  assert.deepEqual(pulled.groups.map((g) => g.root), [0, 1], 'weighted, the east root takes the eastern chain');
  assert.ok(pulled.total > plain.total, 'the real length grows: the total says the real one');
  assert.deepEqual(pulled.unused, []);
});

test('auto group size: the cheapest cut, trees of up to MAX_AUTO_TREE; a chain of any length', () => {
  const pts = Array.from({ length: 8 }, (_, i) => [12 + i * 0.02, 40]);
  const auto = plan(pts, [R([12.07, 39.9])], 'auto');
  for (let c = 1; c <= 8; c++) assert.ok(auto.total <= plan(pts, [R([12.07, 39.9])], c).total + 1e-6, `group size ${c}`);
  assert.equal(typeof auto.groupSize, 'number', 'the largest group is reported');
  assert.equal(plan(pts, [R([11.9, 40])], 'auto', 'chain').groups.length, 1); // one root at an end: one chain
  const many = Array.from({ length: MAX_AUTO_TREE + 5 }, (_, i) => [12 + i * 0.001, 40]);
  assert.ok(plan(many, [R([12.01, 39.99])], 'auto').groups.every((g) => g.nodes.length <= MAX_AUTO_TREE));
  assert.equal(plan(many, [R([11.99, 40])], 'auto', 'chain').groups.length, 1, 'a chain of any length');
});

test('two roots: each group to the root nearer it, whatever the order the roots are given in; one chain where a second trunk costs more than the gap it saves', () => {
  const pts = Array.from({ length: 9 }, (_, i) => [12 + i * 0.02, 40]);
  const ends = [R([12.18, 39.95]), R([11.98, 39.95])]; // given east first
  const trees = plan(pts, ends, 2, 'tree');
  const of = (o) => trees.groups.filter((g) => g.root === o).flatMap((g) => g.nodes);
  assert.deepEqual(trees.unused, []);
  assert.ok(of(1).includes(0) && of(0).includes(8), 'the western points to the western root, the eastern to the eastern');
  assert.ok(Math.max(...of(1)) < Math.min(...of(0)), 'the cut between them');
  // a chain: a second trunk of 5 km to save a 2 km gap is not worth it; roots nearer the line, it is
  assert.deepEqual(plan(pts, ends, 'auto', 'chain').groups.map((g) => g.nodes.length), [9]);
  const nearer = [R([12.16, 39.995]), R([12.0, 39.995])]; // under the end points: every cut costs the same; the tie goes to the most even
  assert.deepEqual(plan(pts, nearer, 'auto', 'chain').groups.map((g) => [g.root, g.nodes.length]), [[1, 4], [0, 5]]);
});

test('lines: the preview, root to hub to each point (tree), root then point to point (chain)', () => {
  const pts = Array.from({ length: 6 }, (_, i) => [12 + i * 0.02, 40]), origins = [R([12.05, 39.9])];
  const tree = plan(pts, origins, 3, 'tree');
  const sl = lines(pts, origins, tree, 'tree');
  assert.equal(sl.length, tree.groups.length + pts.length, 'a trunk per group, a branch per point off its hub (0 m where the hub is on it)');
  assert.ok(tree.groups.every((g) => sl.some(([a, b]) => a === origins[0].position && b === g.hub)));
  const chain = plan(pts, origins, 'auto', 'chain');
  const cl = lines(pts, origins, chain, 'chain');
  assert.equal(cl.length, pts.length, 'one line to each point');
  assert.equal(cl[0][0], origins[0].position);
  for (let i = 1; i < cl.length; i++) assert.equal(cl[i][0], cl[i - 1][1], 'joined end to end');
});

// a guide running east, two origins to the south-west and south-east
const scene = () => {
  const doc = emptyDoc(0);
  const a = addPoint(doc, [12, 40]), b = addPoint(doc, [12.4, 40]);
  const o1 = addPoint(doc, [12.0, 39.8]), o2 = addPoint(doc, [12.4, 39.8]);
  const guide = addLine(doc, a.id, [], b.id, { guide: true });
  return { doc, a, b, o1, o2, guide };
};
const ARRAY = { spacing: 3000, startMargin: 1000, endMargin: 1000, offset: 500, side: 'alternate', aperture: 180, groupId: null };
const pointsOf = (doc, a) => a.points.map((x) => doc.points.find((n) => n.id === x.pointId));
// the points a chain from an origin passes, in order (its lines attached end to end)
const chainFrom = (doc, id) => {
  const out = [];
  for (let at = id, s; (s = doc.lines.find((x) => part(x) === 'chain' && x.start.element === at));) { out.push(s.end.element); at = s.end.element; }
  return out;
};

test('distribution: points along the line in a group of its own, its Copies, each a circle of the array\'s radius, facing away with its own sector', () => {
  const { doc, guide } = scene();
  const { distribution: array, group } = makeDistribution(doc, { ...ARRAY, along: { element: guide.id } });
  const ns = pointsOf(doc, array);
  const places = distribute(doc, guide, ARRAY).points;
  assert.equal(ns.length, places.length);
  // its own group, "Distribute along" what it follows, at the top; a subgroup Circles in it holding the points
  const circles = doc.groups.find((g) => g.id === array.copiesId);
  assert.deepEqual([group.name, group.groupId, array.groupId], ['Distribute along Line 1', null, group.id]);
  assert.deepEqual([circles.name, circles.groupId], ['Copies', group.id]);
  assert.equal(doc.groups.length, 2);
  assert.ok(ns.every((n) => n.groupId === circles.id && n.symbol === 'diamond'));
  assert.ok(ns.every((n) => n.parts.length === 1 && n.parts[0].radius === COPY_RADIUS && n.parts[0].fill && n.parts[0].shown), 'each one part of its own: none given, the default radius');
  assert.ok(!('parts' in group) && !('radii' in group) && !('aperture' in group), 'a new group: only a style');
  assert.ok(ns.every((n) => n.parts[0].kind === 'sector' && n.parts[0].aperture === 180), 'each its own sector');
  near(Math.abs(((ns[0].bearing + 180) % 360) - 180), 0, 1, 'the first faces north, away from the line (left of east)');
  near(ns[1].bearing, 180, 1, 'the second south');
  // the rule: each point, its place along the line, its side, where it was put
  assert.deepEqual(doc.rules, [array]);
  assert.deepEqual(Object.keys(array).sort(), ['along', 'aperture', 'copiesId', 'copy', 'count', 'endMargin', 'groupId', 'id', 'kind', 'offset', 'points', 'preset', 'radius', 'side', 'spacing', 'startMargin'].sort());
  assert.deepEqual([array.kind, array.along, array.spacing, array.count, array.side, array.radius, array.preset, array.copy],
    ['distribute', { element: guide.id, part: null }, 3000, null, 'alternate', COPY_RADIUS, null, null]);
  array.points.forEach((x, k) => {
    assert.deepEqual(Object.keys(x).sort(), ['left', 'pointId', 'pos', 't']);
    near(x.t, places[k].t, 1e-12, `t ${k}`);
    assert.equal(x.left, k % 2 === 0);
    assert.deepEqual(x.pos, ns[k].position);
  });
  assert.equal(doc.lines.length, 1, 'a distribution makes no line');
  // into a group given: its own group made inside it; a radius given, apart from the spacing
  const again = makeDistribution(doc, { ...ARRAY, along: { element: guide.id }, groupId: group.id, radius: 800 });
  assert.notEqual(again.group, group);
  assert.deepEqual([again.group.name, again.group.groupId], ['Distribute along Line 1', group.id]);
  assert.equal(doc.groups.find((g) => g.id === again.distribution.copiesId).groupId, again.group.id);
  assert.equal(doc.groups.length, 4);
  assert.equal(again.distribution.radius, 800);
  assert.ok(pointsOf(doc, again.distribution).every((n) => n.groupId === again.distribution.copiesId && n.parts.map((r) => r.radius).join() === '800'));
  // no aperture: circles
  const circled = makeDistribution(doc, { ...ARRAY, aperture: null, along: { element: guide.id }, groupId: group.id });
  assert.ok(pointsOf(doc, circled.distribution).every((n) => n.parts.length === 1 && n.parts[0].kind === 'circle' && !('aperture' in n.parts[0])));
  // a group given that is not there: at the top
  assert.equal(makeDistribution(doc, { ...ARRAY, along: { element: guide.id }, groupId: 'nothing' }).group.groupId, null);
});

test('tree: straight lines origin → hub → points, attached at both ends, each saying its part, in a Connection group beside the copies\' Copies', () => {
  const { doc, guide, o1 } = scene();
  const { distribution: array, group } = makeDistribution(doc, { ...ARRAY, along: { element: guide.id } });
  const ids = array.points.map((x) => x.pointId);
  const r = connect(doc, { pointIds: ids, roots: roots(o1.id), pattern: 'tree', groupSize: 3 });
  const made = doc.lines.filter((s) => s !== guide);
  const hubs = doc.points.filter((n) => r.connection.created.includes(n.id));
  assert.equal(r.lines, made.length);
  assert.deepEqual([r.groupSize, r.unused], [3, []]);
  assert.ok(r.total > 0);
  assert.ok(hubs.every((n) => n.symbol === 'dot' && !n.parts.length), 'a hub is a dot');
  assert.deepEqual(r.connection.hubs.map((h) => h.pointId).sort(), hubs.map((n) => n.id).sort());
  for (const h of r.connection.hubs) {
    assert.equal(h.rootId, o1.id);
    assert.ok(h.pointIds.length >= 1 && h.pointIds.every((id) => ids.includes(id)));
    assert.deepEqual(h.pos, find(doc, h.pointId).el.position);
  }
  assert.ok(made.every((s) => !s.vertices.length && s.mode === 'fixed'), 'straight lines');
  assert.ok(made.filter((s) => part(s) === 'trunk').every((s) => lineTrace(doc, s).length > 1), 'no trunk of length zero');
  // attached at both ends, where their points are
  for (const s of made) for (const e of [s.start, s.end]) assert.deepEqual(e.position, find(doc, e.element).el.position);
  const trunks = made.filter((s) => part(s) === 'trunk'), branches = made.filter((s) => part(s) === 'branch');
  assert.equal(trunks.length + branches.length, made.length);
  assert.equal(trunks.length, r.groups);
  assert.ok(trunks.every((s) => s.start.element === o1.id), 'each trunk from the root');
  const trunkEnds = new Set(trunks.map((s) => s.end.element));
  assert.ok(branches.every((s) => trunkEnds.has(s.start.element) && ids.includes(s.end.element)), 'each branch from a hub to a point');
  assert.equal(hubs.length, r.groups, 'a hub of its own per tree, never one of its points');
  assert.ok(hubs.every((n) => !ids.includes(n.id)));
  assert.equal(branches.length, ids.length, 'a branch to every point');
  const cg = doc.groups.find((g) => g.id === r.connection.groupId);
  assert.deepEqual([cg.name, cg.groupId], ['Connection', array.groupId], 'a group of its own beside Copies, in the repetition\'s group');
  for (const id of r.connection.created) assert.equal(find(doc, id).el.groupId, cg.id, id);
  assert.deepEqual(doc.rules, [array, r.connection]);
  assert.deepEqual([r.connection.kind, r.connection.pattern, r.connection.groupSize, r.connection.roots, r.connection.pointIds], ['connect', 'tree', 3, roots(o1.id), ids]);
  const gt = totals(doc).groups.get(group.id); // the distribution's group (what is in its subgroups too): its circles, told apart from its hubs
  assert.deepEqual([gt.points, gt.ringed, gt.lines], [ids.length + hubs.length, ids.length, made.length]);
  // undone: what it made goes, its points and origin stay
  assert.equal(unconnect(doc, r.connection.id), r.connection);
  assert.deepEqual([doc.lines.length, connections(doc).length], [1, 0]);
  assert.ok(!doc.groups.some((g) => g.id === cg.id), 'its group gone, empty');
  assert.ok(ids.every((id) => find(doc, id)) && find(doc, o1.id));
  assert.ok(hubs.every((n) => !find(doc, n.id)), 'the hubs gone');
  assert.equal(unconnect(doc, r.connection.id), null);
});

test('tree: a hub on a point gives a branch of 0 m; the shortest branch set keeps the hub that far from its points and its root, and it keeps it as it follows', () => {
  const pts = [[12, 40], [12.01, 40], [12.02, 40]], origin = [12.01, 39.9]; // the median: on the middle point
  const at = plan(pts, [R(origin)], 3, 'tree');
  assert.ok(inverse(pts[1], at.groups[0].hub).s < 1, 'the hub on the middle point');
  const far = plan(pts, [R(origin)], 3, 'tree', 200);
  const hub = far.groups[0].hub;
  assert.ok(pts.every((q) => inverse(q, hub).s >= 200 - 1e-3), 'every branch at least 200 m');
  assert.ok(inverse(hub, pts[1]).s < 210, 'not further off than needed');
  assert.ok(inverse(origin, hub).s >= 200 - 1e-3, 'the trunk too');
  // made: a hub of its own, a branch of 0 m to the point under it; with 200 m, none shorter
  const doc = emptyDoc(0), ns = pts.map((q) => addPoint(doc, q)), o = addPoint(doc, origin);
  const r = connect(doc, { pointIds: ns.map((n) => n.id), roots: roots(o.id), pattern: 'tree', groupSize: 3 });
  const branches = () => doc.lines.filter((s) => part(s) === 'branch').map((s) => lineTrace(doc, s).length);
  assert.equal(branches().length, 3);
  assert.ok(Math.min(...branches()) < 1, 'a branch of 0 m');
  assert.equal(r.connection.minBranch, 0);
  const again = reconnect(doc, r.connection.id, { minBranch: 200 });
  assert.equal(again.connection.minBranch, 200);
  assert.ok(branches().every((l) => l >= 200 - 1e-3));
  // a point moved: the hub follows, its branches still at least 200 m
  find(doc, ns[0].id).el.position = [11.995, 40];
  settleGeometry(doc);
  assert.ok(branches().every((l) => l >= 200 - 1e-3));
  // a chain keeps none
  assert.equal(reconnect(doc, r.connection.id, { pattern: 'chain' }).connection.minBranch, 0);
});

test('chain: each root starts its own chain, from its end, point to point', () => {
  const { doc, guide } = scene();
  const { distribution: array } = makeDistribution(doc, { ...ARRAY, along: { element: guide.id }, offset: 0 });
  const ps = pointsOf(doc, array), o1 = addPoint(doc, [ps[0].position[0], 39.98]), o2 = addPoint(doc, [ps.at(-1).position[0], 39.98]); // under the end copies: a chain each is cheapest
  const r = connect(doc, { pointIds: array.points.map((x) => x.pointId), roots: roots(o1.id, o2.id), pattern: 'chain', groupSize: 'auto' });
  assert.equal(r.groups, 2); // one chain per root: the cheapest
  assert.ok(doc.lines.filter((s) => s !== guide).every((s) => part(s) === 'chain' && s.start.element && s.end.element));
  assert.deepEqual(r.connection.hubs, []);
  const ns = pointsOf(doc, array), west = chainFrom(doc, o1.id), east = chainFrom(doc, o2.id);
  assert.equal(west[0], ns[0].id, 'the western chain reaches the western end first');
  assert.equal(east[0], ns.at(-1).id, 'the eastern the eastern end');
  assert.equal(west.length + east.length, ns.length);
  assert.deepEqual([...west, ...east.slice().reverse()], ns.map((n) => n.id), 'every point once, in order');
});

test('connect: new roots made as squares in its Connection group, weight 1; a far root reported unused; nothing to connect', () => {
  const { doc, guide, o1 } = scene();
  const { distribution: array } = makeDistribution(doc, { ...ARRAY, along: { element: guide.id } });
  const far = addPoint(doc, [20, 50]);
  const r = connect(doc, { pointIds: array.points.map((x) => x.pointId), roots: roots(far.id), newRoots: [[12.2, 39.9]], pattern: 'tree', groupSize: 'auto' });
  const made = doc.points.find((n) => n.position[0] === 12.2 && n.position[1] === 39.9);
  assert.ok(made);
  assert.deepEqual([made.symbol, made.parts, made.groupId], ['square', [], r.connection.groupId]);
  assert.equal(doc.groups.find((g) => g.id === r.connection.groupId).groupId, array.groupId, 'its group beside Copies, in the repetition\'s group');
  assert.deepEqual(r.connection.roots, [{ id: far.id, weight: 1 }, { id: made.id, weight: 1 }]);
  assert.deepEqual(r.unused, [far.id]);
  assert.ok(!r.connection.created.includes(made.id), 'a root, kept when undone');
  unconnect(doc, r.connection.id);
  assert.ok(find(doc, made.id));
  assert.ok(doc.groups.some((g) => g.id === r.connection.groupId), 'its group kept: the new root still in it');
  assert.equal(connect(doc, { pointIds: ['nothing'], roots: roots(o1.id) }), null);
  assert.equal(connect(doc, { pointIds: array.points.map((x) => x.pointId), roots: roots() }), null);
  assert.equal(connections(doc).length, 0);
});

test('planConnection: points in a distribution taken in its order, others as given; the roots, given then new', () => {
  const { doc, guide, o1 } = scene();
  const { distribution: array } = makeDistribution(doc, { ...ARRAY, along: { element: guide.id } });
  const ids = array.points.map((x) => x.pointId);
  const pc = planConnection(doc, { pointIds: ids.slice().reverse(), roots: roots(o1.id), newRoots: [[12.3, 39.9]], groupSize: 3 });
  assert.deepEqual(pc.nodes.map((n) => n.id), ids);
  assert.deepEqual(pc.roots, [R(o1.position), R([12.3, 39.9])]);
  assert.equal(pc.plan.groupSize, 3);
  assert.equal(planConnection(doc, { pointIds: ids }).plan, null, 'no root: no plan');
  // points in no distribution: as given
  const ps = [3, 0, 2, 1].map((i) => addPoint(doc, [13, 40 + i * 0.02], { name: `n${i}` }));
  const names = planConnection(doc, { pointIds: ps.map((p) => p.id), roots: roots(o1.id) }).nodes.map((n) => n.name).join(',');
  assert.equal(names, 'n3,n0,n2,n1');
});

test('a distribution follows its line; one moved by hand stops; Edit moves them, or makes them anew and connects again', () => {
  const { doc, guide, b, o1 } = scene();
  const { distribution: array } = makeDistribution(doc, { ...ARRAY, along: { element: guide.id }, offset: 0 });
  const before = pointsOf(doc, array).map((n) => [...n.position]);
  // the line's end point moved north: the points move with it, each at the same place along it
  b.position = [12.4, 40.1];
  settleGeometry(doc);
  const after = pointsOf(doc, array).map((n) => n.position);
  assert.ok(after.at(-1)[1] > before.at(-1)[1] + 0.05, 'the far points moved north');
  near(after[0][1], before[0][1], 0.02, 'the near ones barely');
  array.points.forEach((x, k) => near(fromPlace(doc, guide, x), 0, 0.01, `${k} at its place along the line`));
  assert.deepEqual(array.points.map((x) => x.pos), after, 'where each was put, kept');
  // the bearing follows too: square to the line, now heading a little north of east
  const ns = pointsOf(doc, array);
  assert.ok(ns[0].bearing > 270 && ns[0].bearing < 359, `turned: ${ns[0].bearing}`);
  // one dragged by hand stays where it was put, the others still follow
  const hand = ns[2];
  hand.position = [12.2, 39.9];
  b.position = [12.4, 40];
  settleGeometry(doc);
  assert.deepEqual(hand.position, [12.2, 39.9]);
  array.points.forEach((x, k) => k === 2 || near(fromPlace(doc, guide, x), 0, 0.01, `${k} still follows`));
  // Edit array with the same number: every point placed again, the one moved by hand too; each the
  // rule's new copy, but those whose parts were changed by hand since: they keep their own
  const n0 = array.points.length;
  ns[1].parts.push({ ...makePart('circle', { radius: 2000 }), fill: false });
  Object.assign(ns[0].parts[0], { fill: false, shown: false, name: 'kept', strokeColor: '#00ff00', strokeDash: 'dotted' });
  const own = [structuredClone(ns[0].parts), structuredClone(ns[1].parts)];
  assert.deepEqual(editDistribution(doc, array.id, { offset: 200, aperture: 90, radius: 750 }), { distribution: array, remade: false });
  assert.equal(array.points.length, n0);
  near(inverse(hand.position, distribute(doc, guide, array).points[2].position).s, 0, 0.01, 'back on its place');
  array.points.forEach((x, k) => near(inverse(ns[k].position, distribute(doc, guide, array).points[k].position).s, 0, 0.01, `${k} moved, changed by hand or not`));
  assert.equal(array.radius, 750);
  for (const n of ns.slice(2)) assert.deepEqual([n.symbol, n.parts], ['diamond', [makePart('sector', { radius: 750, aperture: 90 })]], 'the new sector, the new radius');
  assert.deepEqual([ns[0].parts, ns[1].parts], own, 'those changed by hand: their own');
  assert.deepEqual(ns.map((n) => changedByHand(doc, n.id)), ns.map((_, k) => k < 2));
  // a connection on them, then another count: the points made anew, the connection made again on them
  const r = connect(doc, { pointIds: array.points.map((x) => x.pointId), roots: roots(o1.id), pattern: 'chain', groupSize: 'auto' });
  const old = new Set(array.points.map((x) => x.pointId));
  assert.equal(editDistribution(doc, array.id, { count: 4, spacing: null }).remade, true);
  assert.deepEqual([array.count, array.spacing, array.offset], [4, null, 200], 'the settings kept, but those changed');
  assert.equal(array.points.length, 4);
  assert.ok(array.points.every((x) => !old.has(x.pointId)));
  assert.ok(![...old].some((id) => find(doc, id)), 'the old points gone');
  const c = connections(doc)[0];
  assert.deepEqual([connections(doc).length, c.id, c.pointIds.length], [1, r.connection.id, 4]);
  assert.equal(c.groupId, r.connection.groupId, 'in its group, kept');
  assert.ok(doc.groups.some((g) => g.id === c.groupId));
  assert.ok(c.created.every((id) => find(doc, id).el.groupId === c.groupId));
  assert.ok(array.points.every((x) => find(doc, x.pointId).el.groupId === array.copiesId), 'the new points in Copies');
  assert.deepEqual(c.pointIds, array.points.map((x) => x.pointId));
  assert.deepEqual(chainFrom(doc, o1.id), c.pointIds);
  assert.equal(doc.lines.length, 5, 'the guide and the chain\'s four lines');
  assert.equal(editDistribution(doc, 'nothing', {}), null);
});

test('settled: the lines attached to a distribution\'s points follow them when the line moves', () => {
  const { doc, guide, b, o1 } = scene();
  const { distribution: array } = makeDistribution(doc, { ...ARRAY, along: { element: guide.id } });
  connect(doc, { pointIds: array.points.map((x) => x.pointId), roots: roots(o1.id), pattern: 'tree', groupSize: 3 });
  b.position = [12.4, 40.1];
  settleGeometry(doc);
  for (const s of doc.lines) for (const e of [s.start, s.end]) if (e.element) assert.deepEqual(e.position, find(doc, e.element).el.position);
  const hub = connections(doc)[0].hubs[0];
  assert.deepEqual(hub.pos, find(doc, hub.pointId).el.position, 'a hub at its median again');
});

test('connect: points in no distribution taken as given; hubs follow their points; Connect again with other settings', () => {
  // points running north, given in no order; the root to the west
  const doc = emptyDoc(0);
  const byName = {};
  for (const i of [3, 0, 2, 1]) byName[`n${i}`] = addPoint(doc, [12, 40 + i * 0.02], { name: `n${i}` });
  const o = addPoint(doc, [11.9, 40.03]);
  const r = connect(doc, { pointIds: ['n3', 'n0', 'n2', 'n1'].map((k) => byName[k].id), roots: roots(o.id), pattern: 'chain', groupSize: 'auto' });
  const names = chainFrom(doc, o.id).map((id) => find(doc, id).el.name).join(',');
  assert.ok(['n3,n0,n2,n1', 'n1,n2,n0,n3'].includes(names), `${names}: as given, from the nearer end`);
  const cg = doc.groups.find((g) => g.id === r.connection.groupId);
  assert.deepEqual([cg.name, cg.groupId], ['Connection', null], 'points in no group: its group at the top');
  assert.ok(doc.lines.every((x) => x.groupId === cg.id));
  // a tree with a hub; a point moved: the hub moves to the median again, the lines attached to it with it
  const s = reconnect(doc, r.connection.id, { pattern: 'tree', groupSize: 4 });
  assert.equal(s.connection.id, r.connection.id);
  assert.equal(s.connection.groupId, cg.id, 'in its group again');
  assert.deepEqual(doc.groups, [cg]);
  assert.equal(connections(doc).length, 1);
  assert.ok(doc.lines.every((x) => part(x) !== 'chain'), 'the chain\'s lines gone');
  const hub = find(doc, s.connection.hubs[0]?.pointId)?.el;
  assert.ok(hub, 'a hub off the points');
  const was = [...hub.position];
  byName.n3.position = [12.1, 40.06];
  settleGeometry(doc);
  assert.ok(hub.position[0] > was[0], 'the hub followed east');
  assert.ok(doc.lines.filter((x) => x.start.element === hub.id).every((x) => x.start.position[0] === hub.position[0]), 'its branches with it');
  // the hub moved by hand: it stays, and no longer follows
  hub.position = [11.95, 40];
  settleGeometry(doc);
  assert.deepEqual(hub.position, [11.95, 40]);
  assert.equal(connections(doc)[0].hubs.length, 0);
  assert.equal(reconnect(doc, 'nothing'), null);
});

test('a root deleted: the connection made again with the roots left (one undo step); the last deleted, its lines and hubs go', () => {
  const s = new DrawStore();
  let ids, o1, o2, circles;
  s.change((doc) => {
    const sc = scene();
    Object.assign(doc, sc.doc);
    ({ o1, o2 } = sc);
    const made = makeDistribution(doc, { ...ARRAY, along: { element: sc.guide.id } });
    circles = made.distribution.copiesId;
    ids = made.distribution.points.map((x) => x.pointId);
    connect(doc, { pointIds: ids, roots: roots(o1.id, o2.id), pattern: 'tree', groupSize: 3 });
  });
  const { id, groupId } = connections(s.doc)[0];
  const steps = s.undos.length;
  s.remove([o1.id]);
  assert.equal(s.undos.length, steps + 1, 'one undo step');
  let c = connections(s.doc)[0];
  assert.deepEqual([connections(s.doc).length, c.id, c.roots, c.pointIds, c.groupId], [1, id, roots(o2.id), ids, groupId]);
  const made = s.doc.lines.filter((x) => part(x));
  assert.ok(made.length && made.every((x) => x.start.element !== o1.id && x.end.element !== o1.id), 'nothing attached to the root gone');
  assert.ok(made.filter((x) => part(x) === 'trunk').every((x) => x.start.element === o2.id), 'every trunk from the root left');
  assert.ok(c.hubs.every((h) => h.rootId === o2.id));
  assert.ok(!s.doc.lines.some((x) => !x.guide && !part(x)), 'no line of before left behind');
  // the last root deleted: the connection, its lines and hubs go; the copies stay
  const hubs = c.hubs.map((h) => h.pointId);
  s.remove([o2.id]);
  assert.deepEqual(connections(s.doc), []);
  assert.deepEqual(s.doc.lines.map((x) => x.guide), [true], 'only the guide left');
  assert.ok(hubs.every((h) => !find(s.doc, h)), 'the hubs gone');
  assert.ok(ids.every((x) => find(s.doc, x)?.el.groupId === circles), 'the copies stay');
  assert.ok(!s.doc.groups.some((g) => g.id === groupId), 'its group gone, empty');
  // undone: the connection with its one root again
  s.undo();
  c = connections(s.doc)[0];
  assert.deepEqual(c.roots, roots(o2.id));
  assert.ok(s.doc.groups.some((g) => g.id === groupId), 'its group back');
});

test('refreshGenerated: a distribution whose line or points are gone is dropped, a connection whose points are gone too', () => {
  const { doc, guide, o1 } = scene();
  const { distribution: array } = makeDistribution(doc, { ...ARRAY, along: { element: guide.id } });
  const ids = array.points.map((x) => x.pointId);
  connect(doc, { pointIds: ids.slice(0, 3), roots: roots(o1.id), pattern: 'chain', groupSize: 'auto' });
  remove(doc, [ids[0]]);
  refreshGenerated(doc);
  assert.equal(array.points.length, ids.length - 1, 'a point deleted: out of its array');
  assert.equal(connections(doc).length, 1, 'a connection with points left stays');
  remove(doc, ids.slice(1, 3));
  refreshGenerated(doc);
  assert.equal(connections(doc).length, 0);
  remove(doc, [guide.id]);
  refreshGenerated(doc);
  assert.equal(distributions(doc).length, 0);
});

test('a distribution along a curved line in mode auto is back on it after a single change', () => {
  const doc = emptyDoc(0);
  const a = addPoint(doc, [12, 40]), b = addPoint(doc, [12.4, 40]);
  const line = addLine(doc, a.id, [[12.2, 40.05]], b.id, { mode: 'auto' });
  settleGeometry(doc);
  const { distribution: array } = makeDistribution(doc, { along: { element: line.id }, spacing: 3000 });
  settleGeometry(doc);
  b.position = [12.4, 40.2];
  settleGeometry(doc);
  for (const n of pointsOf(doc, array)) assert.ok(offLine(doc, line, n.position) < 5, `${offLine(doc, line, n.position)} m off the line`);
});

test('points along a point\'s arc: a sector\'s from one end to the other clockwise; a whole circle from its bearing, evenly', () => {
  const doc = emptyDoc(0);
  const c = [12, 40];
  const sec = addPoint(doc, c, { parts: [makePart('sector', { radius: 1000, aperture: 90 })], bearing: 90 });
  const tr = alongTrace(doc, sec);
  near(tr.length, 1000 * Math.PI / 2, 0.5, 'a quarter of the circle');
  const five = distribute(doc, sec, { count: 5 }).points;
  assert.equal(five.length, 5);
  near(inverse(c, five[0].position).azi, 45, 0.01, 'from the end anticlockwise of the bearing');
  near(inverse(c, five[4].position).azi, 135, 0.01, 'to the other');
  for (const p of five) near(inverse(c, p.position).s, 1000, 0.01, 'on the radius');
  near(five[2].facing, 90, 0.01, 'left of a clockwise arc: outwards');
  const ring = addPoint(doc, c, { parts: [makePart('circle', { radius: 2000 })], bearing: 30 });
  const four = distribute(doc, ring, { count: 4, startMargin: 500 }).points;
  assert.deepEqual(four.map((p) => Math.round(inverse(c, p.position).azi + 360) % 360), [30, 120, 210, 300], 'no ends, no margins');
  assert.equal(distribute(doc, ring, { spacing: 2000 * Math.PI / 2 + 1 }).points.length, 4, 'every spacing, no point twice');
  assert.equal(distribute(doc, addPoint(doc, c, { parts: [] }), { count: 3 }).points.length, 0, 'no parts: nothing to go along');
  assert.equal(alongTrace(doc, ring, 4), null, 'no such part');
});

test('points round a point\'s part: the first filled round part by default, or the one named; each sector its own aperture', () => {
  const doc = emptyDoc(0);
  const c = [12, 40];
  const p = addPoint(doc, c, { bearing: 90, parts: [{ ...makePart('circle', { radius: 500 }), fill: false }, makePart('sector', { radius: 1000, aperture: 60 }), makePart('sector', { radius: 2000, aperture: 120 })] });
  const dflt = alongTrace(doc, p), first = alongTrace(doc, p, 0), wide = alongTrace(doc, p, 2);
  assert.deepEqual(dflt, alongTrace(doc, p, 1), 'the first filled');
  near(dflt.length, (1000 * Math.PI) / 3, 0.5, 'a sixth of its circle');
  assert.equal(dflt.closed, false);
  near(inverse(c, dflt.coords[0]).azi, 60, 1e-6, 'from its own end');
  near(inverse(c, dflt.coords.at(-1)).azi, 120, 1e-6, 'to the other');
  assert.deepEqual([first.closed, Math.round(first.length)], [true, Math.round(2 * Math.PI * 500)]);
  near(inverse(c, wide.coords[0]).azi, 30, 1e-6, 'the wider one\'s end');
  near(wide.length, (2000 * 2 * Math.PI) / 3, 1, 'a third of its circle');
  p.parts[1].fill = false;
  p.parts[2].fill = false;
  assert.deepEqual(alongTrace(doc, p), first, 'none filled: the first round one');
  const three = distribute(doc, p, { count: 3, part: 2 }).points;
  assert.deepEqual(three.map((x) => Math.round(inverse(c, x.position).azi)), [30, 90, 150]);
  // an array round the part named: its points follow that part
  const { distribution: array } = makeDistribution(doc, { along: { element: p.id, part: 2 }, count: 3 });
  assert.deepEqual(array.along, { element: p.id, part: 2 });
  p.parts[2].aperture = 60;
  settleGeometry(doc);
  assert.deepEqual(pointsOf(doc, array).map((n) => Math.round(inverse(c, n.position).azi)), [60, 90, 120]);
  assert.ok(pointsOf(doc, array).every((n) => Math.abs(inverse(c, n.position).s - 2000) < 0.01));
});

test('points round an outline part: its ring, closed, from its front right corner clockwise; they follow it turned', () => {
  const doc = emptyDoc(0);
  const c = [12, 40];
  const p = addPoint(doc, c, { parts: [makePart('circle', { radius: 5000 }), makePart('rectangle', { length: 4000, width: 2000 })] });
  const tr = alongTrace(doc, p, 1);
  assert.equal(tr.closed, true);
  near(tr.length, 12000, 1, 'its perimeter');
  near(inverse(tr.coords[0], tr.coords.at(-1)).s, 0, 1e-6, 'a ring: back where it started');
  near(alongTrace(doc, p).length, 2 * Math.PI * 5000, 1, 'by default: the circle');
  const corner = (k) => verticesOf({ kind: 'point', el: p }, 1)[k];
  const six = distribute(doc, p, { count: 6, part: 1 }).points;
  // every 2 km round it: the front right corner, the right side's middle, the back right corner, the back left, the left side's middle, the front left
  for (const [k, v] of [[0, 0], [2, 1], [3, 2], [5, 3]]) near(inverse(six[k].position, corner(v)).s, 0, 1, `point ${k} on corner ${v}`);
  near(inverse(c, six[1].position).s, 1000, 1, 'the right side\'s middle');
  near(inverse(c, six[1].position).azi, 90, 0.01, 'east');
  const { distribution: array } = makeDistribution(doc, { along: { element: p.id, part: 1 }, count: 6 });
  assert.deepEqual(array.along, { element: p.id, part: 1 });
  p.bearing = 90;
  settleGeometry(doc);
  const ns = pointsOf(doc, array);
  near(inverse(ns[0].position, corner(0)).s, 0, 1, 'the turned outline\'s front right corner');
  near(inverse(c, ns[1].position).azi, 180, 0.01, 'its right side now south');
  assert.ok(ns.every((n) => n.parts.length === 1 && n.parts[0].kind === 'circle' && n.parts[0].radius === COPY_RADIUS));
});

test('a distribution along an arc follows its point: moved, turned, its radius changed', () => {
  const doc = emptyDoc(0);
  const sec = addPoint(doc, [12, 40], { parts: [makePart('sector', { radius: 1000, aperture: 180 })], bearing: 0 });
  const { distribution: array } = makeDistribution(doc, { along: { element: sec.id }, count: 3 });
  assert.deepEqual(array.along, { element: sec.id, part: null });
  sec.position = [12.1, 40.1]; sec.bearing = 90; sec.parts[0].radius = 1500;
  settleGeometry(doc);
  const azis = pointsOf(doc, array).map((n) => inverse(sec.position, n.position));
  assert.deepEqual(azis.map((d) => Math.round(d.s)), [1500, 1500, 1500]);
  assert.deepEqual(azis.map((d) => Math.round(d.azi + 360) % 360), [0, 90, 180]);
  remove(doc, [sec.id]);
  settleGeometry(doc);
  assert.equal(distributions(doc).length, 0, 'its point gone: the array goes, its points stay');
});

test('Edit from sectors to circles: each point\'s first part a circle, no aperture left on it; its file the same read back', () => {
  const { doc, guide } = scene();
  const { distribution: array } = makeDistribution(doc, { ...ARRAY, along: { element: guide.id } });
  editDistribution(doc, array.id, { aperture: null });
  const ns = pointsOf(doc, array);
  assert.ok(ns.every((n) => n.parts[0].kind === 'circle'));
  assert.deepEqual(ns[0].parts, [makePart('circle', { radius: COPY_RADIUS })], 'a circle as any other');
  const back = parse(serialise(doc), null, 0).doc;
  assert.deepEqual(back.points.find((n) => n.id === ns[0].id).parts, ns[0].parts);
});

test('copyOf: a circle of the radius (a sector with an aperture), a diamond; a built-in kind scaled to the radius; a user\'s copy as it is', () => {
  const rule = (o) => ({ radius: 300, aperture: null, preset: null, copy: null, ...o });
  assert.deepEqual(copyOf(rule()), { symbol: 'diamond', parts: [makePart('circle', { radius: 300 })] });
  assert.deepEqual(copyOf(rule({ preset: 'circle' })), copyOf(rule()));
  assert.deepEqual(copyOf(rule({ aperture: 45 })), { symbol: 'diamond', parts: [makePart('sector', { radius: 300, aperture: 45 })] });
  // rings: the largest reaching the radius, the others with it, each its own Fill
  const rings = copyOf(rule({ preset: 'rings', radius: 1500 }));
  assert.deepEqual([rings.symbol, rings.parts.map((p) => [p.kind, p.radius, p.fill])], ['none', [['circle', 500, true], ['circle', 1000, false], ['circle', 1500, false]]]);
  const rect = copyOf(rule({ preset: 'rectangle', radius: 400, aperture: 90 }));
  assert.deepEqual(rect, { symbol: BUILT_IN.rectangle.symbol, parts: scaled(BUILT_IN.rectangle.parts, 400) });
  assert.deepEqual([rect.parts.length, rect.parts[0].kind, rect.parts[0].length / 2], [1, 'rectangle', 400], 'its half length the radius; no aperture on it');
  const copy = { symbol: 'square', parts: [makePart('circle', { radius: 2000 })] };
  assert.equal(copyOf(rule({ preset: 'preset:mine', copy, radius: 10 })), copy, 'its size its own');
  assert.deepEqual(copyOf(rule({ preset: 'preset:gone' })), copyOf(rule()), 'a user\'s without its copy: a circle');
  // made: each point the copy, a copy of its own
  const { doc, guide } = scene();
  const ringed = makeDistribution(doc, { along: { element: guide.id }, count: 3, preset: 'rings', radius: 1500 }).distribution;
  for (const n of pointsOf(doc, ringed)) assert.deepEqual([n.symbol, n.parts], ['none', rings.parts]);
  const mine = makeDistribution(doc, { along: { element: guide.id }, count: 3, preset: 'preset:mine', copy }).distribution;
  assert.deepEqual([mine.preset, mine.copy], ['preset:mine', copy]);
  const ns = pointsOf(doc, mine);
  for (const n of ns) assert.deepEqual([n.symbol, n.parts], [copy.symbol, copy.parts]);
  assert.ok(ns[0].parts !== copy.parts && ns[0].parts !== ns[1].parts, 'each its own parts');
});

test('a copy changed by hand keeps its own when the rule is edited; giveBack gives it the rule\'s; a part chosen anew', () => {
  const doc = emptyDoc(0);
  const p = addPoint(doc, [12, 40], { parts: [makePart('circle', { radius: 5000 }), makePart('circle', { radius: 8000 })] });
  const { distribution: array } = makeDistribution(doc, { along: { element: p.id }, count: 4, radius: 500 });
  const ns = pointsOf(doc, array);
  assert.ok(ns.every((n) => !changedByHand(doc, n.id)));
  ns[0].parts[0].radius = 900;
  ns[1].symbol = 'square';
  assert.deepEqual(ns.map((n) => changedByHand(doc, n.id)), [true, true, false, false], 'its parts or its symbol');
  assert.equal(changedByHand(doc, p.id), false, 'not a copy');
  editDistribution(doc, array.id, { radius: 700 });
  assert.deepEqual(ns.map((n) => [n.symbol, n.parts[0].radius]), [['diamond', 900], ['square', 500], ['diamond', 700], ['diamond', 700]]);
  giveBack(doc, ns[0].id);
  giveBack(doc, ns[1].id);
  for (const n of ns) assert.deepEqual([n.symbol, n.parts], ['diamond', [makePart('circle', { radius: 700 })]]);
  assert.ok(ns.every((n) => !changedByHand(doc, n.id)));
  giveBack(doc, p.id);
  assert.equal(p.parts.length, 2, 'not a copy: as it was');
  // the part it goes round chosen anew: the same number, moved onto it
  assert.equal(editDistribution(doc, array.id, { along: { part: 1 } }).remade, false);
  assert.deepEqual(array.along, { element: p.id, part: 1 });
  for (const n of ns) near(inverse(p.position, n.position).s, 8000, 0.01, 'round the larger circle');
});

test('rule groups: Connection in the points\' group, the repetition\'s own (parentId), the top (null) or one given; gone with unconnect when empty', () => {
  const { doc, guide, o1, o2 } = scene();
  const { distribution: array, group } = makeDistribution(doc, { ...ARRAY, along: { element: guide.id } });
  const ids = array.points.map((x) => x.pointId);
  const groupOf = (r) => doc.groups.find((g) => g.id === r.connection.groupId);
  const inRule = (r) => r.connection.created.every((id) => find(doc, id).el.groupId === r.connection.groupId);
  const own = connect(doc, { pointIds: ids, roots: roots(o1.id), pattern: 'chain', groupSize: 'auto', parentId: group.id });
  assert.deepEqual([groupOf(own).name, groupOf(own).groupId], ['Connection', group.id], 'beside Copies');
  assert.ok(inRule(own));
  assert.deepEqual(doc.groups.filter((g) => g.groupId === group.id).map((g) => g.name).sort(), ['Connection', 'Copies']);
  unconnect(doc, own.connection.id);
  assert.equal(doc.groups.length, 2, 'empty: gone');
  const top = connect(doc, { pointIds: ids, roots: roots(o1.id), parentId: null });
  assert.equal(groupOf(top).groupId, null);
  // kept: on unconnect asked to keep it; with something else in it
  unconnect(doc, top.connection.id, true);
  assert.ok(doc.groups.some((g) => g.id === top.connection.groupId), 'kept when asked');
  const given = connect(doc, { pointIds: ids, roots: roots(o2.id), groupId: top.connection.groupId });
  assert.equal(given.connection.groupId, top.connection.groupId, 'an existing group: used, no new one');
  assert.equal(doc.groups.length, 3);
  assert.ok(inRule(given));
  o1.groupId = given.connection.groupId;
  unconnect(doc, given.connection.id);
  assert.ok(doc.groups.some((g) => g.id === given.connection.groupId), 'a point left in it: kept');
});

test('ruleOf, distributionOf, connectionOn: the rule an element belongs to; a connection on a distribution\'s copies', () => {
  const { doc, guide, o1 } = scene();
  const { distribution: array, group } = makeDistribution(doc, { ...ARRAY, along: { element: guide.id } });
  const ids = array.points.map((x) => x.pointId);
  const c = connect(doc, { pointIds: ids, roots: roots(o1.id), pattern: 'tree', groupSize: 3 }).connection;
  for (const id of [group.id, array.copiesId, ...ids]) assert.equal(ruleOf(doc, id), array, id);
  const hubs = c.hubs.map((h) => h.pointId), made = doc.lines.filter((s) => s !== guide).map((s) => s.id);
  for (const id of [c.groupId, ...hubs, ...made]) assert.equal(ruleOf(doc, id), c, id);
  for (const id of [o1.id, guide.id, 'nothing']) assert.equal(ruleOf(doc, id), null, id);
  assert.equal(distributionOf(doc, c), array);
  assert.equal(connectionOn(doc, array), c);
  // a connection on other points; a distribution with none
  const others = [addPoint(doc, [13, 40]), addPoint(doc, [13.1, 40])];
  const d = connect(doc, { pointIds: others.map((n) => n.id), roots: roots(o1.id) }).connection;
  assert.equal(distributionOf(doc, d), null);
  const bare = makeDistribution(doc, { along: { element: guide.id }, count: 2 }).distribution;
  assert.equal(connectionOn(doc, bare), null);
});

test('hubFor: the median; with a shortest branch, at least that far from every point and from the root; on one exactly, off to the left', () => {
  const pts = [[12, 40], [12.02, 40]], o = [12.01, 40.0005]; // the root between its points, nearly in line: the median on it
  const on = hubFor(pts, o);
  near(inverse(on, o).s, 0, 1, 'the hub on the root');
  const off = hubFor(pts, o, 50);
  assert.ok([...pts, o].every((q) => inverse(q, off).s >= 50 - 1e-6), 'every branch and the trunk at least 50 m');
  assert.ok(inverse(o, off).s < 51, 'just off the root');
  // the median on a point: off it towards the root (south here)
  const line = [[12, 40], [12.01, 40], [12.02, 40]], south = [12.01, 39.9];
  const h = hubFor(line, south, 100);
  near(inverse(line[1], h).s, 100, 1e-6, '100 m from the middle point');
  assert.ok(h[1] < 40 && Math.abs(h[0] - 12.01) < 1e-6, 'towards the root: on the trunk');
  assert.ok(line.every((q) => inverse(q, h).s >= 100 - 1e-6));
  // made: every branch and the trunk at least the shortest branch
  const doc = emptyDoc(0), ns = pts.map((q) => addPoint(doc, q)), root = addPoint(doc, o);
  const r = connect(doc, { pointIds: ns.map((n) => n.id), roots: roots(root.id), pattern: 'tree', groupSize: 2, minBranch: 30 });
  assert.ok(doc.lines.every((s) => lineTrace(doc, s).length >= 30 - 1e-6));
  assert.equal(reconnect(doc, r.connection.id, { pattern: 'chain' }).connection.minBranch, 0, 'a chain has no hub');
});

test('rules read back from the file: a distribution with its part and a user\'s copy, a connection in its group', () => {
  const doc = emptyDoc(0);
  const p = addPoint(doc, [12, 40], { parts: [makePart('circle', { radius: 5000 }), makePart('sector', { radius: 8000, aperture: 120 })] });
  const copy = { symbol: 'square', parts: [{ ...makePart('circle', { radius: 2000 }), fill: false, name: 'outer' }, makePart('rectangle', { length: 800, width: 400 })] };
  const { distribution: array } = makeDistribution(doc, { along: { element: p.id, part: 1 }, count: 4, preset: 'preset:mine', copy });
  const o = addPoint(doc, [12, 39.8]);
  connect(doc, { pointIds: array.points.map((x) => x.pointId), roots: roots(o.id), pattern: 'tree', groupSize: 2 });
  const back = parse(serialise(doc), null, 0).doc;
  const plain = (rules) => JSON.parse(JSON.stringify(rules, (k, v) => (typeof v === 'number' ? +v.toFixed(5) : v))); // positions written to 7 decimals
  assert.deepEqual(plain(back.rules), plain(doc.rules));
  assert.deepEqual(parse(serialise(back), null, 0).doc.rules, back.rules, 'stable');
  assert.deepEqual(back.rules[0].along, { element: p.id, part: 1 });
  assert.deepEqual(back.rules[0].copy, copy);
  assert.deepEqual(back.groups.map((g) => g.name), ['Distribute along Point 1', 'Copies', 'Connection']);
});

test('a distribution makes at most MAX_COPIES points, and says so', () => {
  const doc = emptyDoc(0), s = addLine(doc, [12, 40], [], [12.5, 40]);
  const byCount = distribute(doc, s, { count: MAX_COPIES + 1 }), bySpacing = distribute(doc, s, { spacing: 1 });
  assert.deepEqual([byCount.points.length, byCount.capped, bySpacing.points.length, bySpacing.capped], [MAX_COPIES, true, MAX_COPIES, true]);
  assert.equal(distribute(doc, s, { count: 10 }).capped, false);
});

test('inflate: display only; a branch along the dominant direction straight, the others bowed away from it by their angle; the trunk arriving along it; off at 0, kept in the file', () => {
  const doc = emptyDoc(0);
  const root = addPoint(doc, [12, 40]), ends = [[12.1, 40.03], [12.1, 40], [12.1, 39.97]].map((q) => addPoint(doc, q)); // a fan east of the hub, the trunk from the west
  const r = connect(doc, { pointIds: ends.map((n) => n.id), roots: roots(root.id), pattern: 'tree', groupSize: 3, inflate: 0.6 });
  assert.equal(r.connection.inflate, 0.6);
  const drawn = inflated(doc), line = (end) => doc.lines.find((s) => s.end.element === end);
  const mid = (c) => c[Math.floor(c.length / 2)];
  const up = drawn.get(line(ends[0].id).id), level = drawn.get(line(ends[1].id).id), down = drawn.get(line(ends[2].id).id);
  assert.ok(up && down && !level, 'the branch along the mean direction stays straight: not drawn apart');
  const hub = find(doc, r.connection.hubs[0].pointId).el;
  near(inverse(up[0], hub.position).s, 0, 1e-3, 'from the hub'); near(inverse(up.at(-1), ends[0].position).s, 0, 1e-3, 'to its end');
  assert.ok(mid(up)[1] > (hub.position[1] + ends[0].position[1]) / 2, 'the upper branch bows up, away from the middle');
  assert.ok(mid(down)[1] < (hub.position[1] + ends[2].position[1]) / 2, 'the lower one down');
  const trunk = drawn.get(doc.lines.find((s) => s.start.element === root.id).id);
  assert.ok(trunk && trunk.length > 2, 'the trunk bowed too');
  assert.ok(doc.lines.every((s) => !s.vertices.length && !s.startHandle && !s.endHandle), 'the real lines untouched');
  const sum = (c) => c.slice(1).reduce((a, q, i) => a + inverse(c[i], q).s, 0);
  assert.ok(sum(up) > lineTrace(doc, line(ends[0].id)).length, 'the drawn curve is longer than the real, straight branch');
  // a vertex added by hand: drawn as it is
  doc.lines.find((s) => s.end.element === ends[0].id).vertices.push({ position: [12.05, 40.02], handleIn: null, handleOut: null, name: '', properties: [] });
  assert.ok(!inflated(doc).has(line(ends[0].id).id));
  r.connection.inflate = 0;
  assert.equal(inflated(doc).size, 0);
  r.connection.inflate = 0.25;
  const back = parse(serialise(doc), null, 0).doc;
  assert.equal(connections(back)[0].inflate, 0.25);
});
