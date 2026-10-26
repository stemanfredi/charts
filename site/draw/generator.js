// Rules (docs/drawing-ui.md §6): Distribute along and Connect, two tools that make ordinary points and
// lines and stay linked to them, kept in doc.rules ({ kind: 'distribute' | 'connect', ... }). What a
// rule makes is in a group of its own: Distribute along's, "Distribute along X", holds a subgroup
// "Copies" and Connect's subgroup "Connection" (its lines, hubs and new roots); Connect alone makes
// its "Connection" in the points' group. Pure: no map, no DOM.
//   Distribute along: copies along a line, or round a point's part (a circle: the whole of it from its
//     bearing, or its sector's arc from one end to the other, clockwise): points every `spacing` (or
//     `count` of them) between the margins, offset to one side or alternating, each a copy facing
//     away from the line (on an arc, left is outwards). They follow the line or the point when it is
//     edited (moved, turned, its radius or arc changed); one moved by hand stops following.
//   Connect: points joined to roots. The points in order (a distribution's along its line, otherwise
//     as given) are cut into groups of consecutive points, at most `groupSize` each ('auto': any
//     size), each joined to one root: the cut and the roots chosen together as the cheapest (plan:
//     the sum of the groups' lengths, each divided by its root's weight; a root with a weight of 2
//     wins groups as if it were half as far). A root that wins no group is reported unused. Tree: a
//     hub per group (the geometric median of its points and its root, kept at least `minBranch` from
//     each of them), a line from the root to it (part "trunk"), lines from it to each point ("branch");
//     chain: a line from the root to the group's nearer end point, then point to point ("chain").
//     Each line is attached to the points it joins; hubs follow their points; one moved by hand stops
//     following.
// The lines are straight: they are the real object (positions, lengths).

import { inverse, destination, localFrame as frame } from '../geodesy.js';
import { norm360 } from '../geo.js';
import { lineTrace, pointsAlong } from './lines.js';
import { addPoint, addDot, addLine, newId, idsOf, makePart, followedPart, label, remove } from './document.js';
import { outlineOf } from './outlines.js';
import { BUILT_IN, scaled } from './place.js';

// a drawing's rules of each kind
export const distributions = (doc) => doc.rules.filter((r) => r.kind === 'distribute');
export const connections = (doc) => doc.rules.filter((r) => r.kind === 'connect');

// ---- placing points along a line ---------------------------------------------------------------------

// What points go along: a line as drawn; a point's part (part: its place; null: the round part it
// follows by default), clockwise: a circle's whole round from its bearing, closed; a sector's arc, from
// one end to the other, sampled every half degree; an outline's ring, closed. { coords, length,
// closed }, or null (a point with no such part).
export function alongTrace(doc, el, part = null) {
  if (!el.position) { const tr = lineTrace(doc, el); return { coords: tr.coords, length: tr.length, closed: false }; }
  const o = el.parts[part ?? followedPart(el)];
  if (!o) return null;
  let coords;
  if (o.radius) {
    const ap = o.kind === 'sector' ? o.aperture : 360, from = ap < 360 ? el.bearing - ap / 2 : el.bearing, n = Math.max(8, Math.ceil(ap * 2));
    coords = Array.from({ length: n + 1 }, (_, i) => destination(el.position, from + (ap * i) / n, o.radius));
  } else coords = outlineOf(el.position, el.bearing, o.length, o.width, o.kind).ring;
  let length = 0;
  for (let i = 1; i < coords.length; i++) length += inverse(coords[i - 1], coords[i]).s;
  return { coords, length, closed: o.kind !== 'sector' };
}
// the element points go along (a line or a point), or null
export const alongOf = (doc, id) => doc.lines.find((s) => s.id === id) ?? doc.points.find((n) => n.id === id) ?? null;

// the most copies one repetition makes: more would hang the page (each is a point, drawn and followed)
export const MAX_COPIES = 2000;
// The points' places along el (a line, or a point's arc): { points: [{ position, facing, t, left }],
// length, capped (more than MAX_COPIES asked for: the first of them) }. facing: the azimuth away from
// the line on the side the point is offset to (a sector's bearing); t: where along it (0 to 1). count
// (instead of spacing): that many points, evenly from one margin to the other. A whole circle has no
// ends: no margins, the points evenly round it (count), or every spacing from its bearing.
export function distribute(doc, el, { spacing, count = null, startMargin = 0, endMargin = 0, offset = 0, side = 'left', part = null }) {
  const tr = alongTrace(doc, el, part);
  if (!tr) return { points: [], length: 0, capped: false };
  const L = tr.length, ds = [], n = Math.min(count ?? 0, MAX_COPIES);
  if (tr.closed) {
    if (n > 0) for (let i = 0; i < n; i++) ds.push((L * i) / n);
    else if (spacing > 0) for (let d = 0; d < L - 1e-6 && ds.length < MAX_COPIES; d += spacing) ds.push(d);
  } else {
    const room = L - startMargin - endMargin;
    if (n > 0 && room >= 0) for (let i = 0; i < n; i++) ds.push(startMargin + (n > 1 ? (room * i) / (n - 1) : room / 2));
    else if (spacing > 0) for (let d = startMargin; d <= L - endMargin + 1e-6 && ds.length < MAX_COPIES; d += spacing) ds.push(d);
  }
  const capped = count > MAX_COPIES || (!(count > 0) && spacing > 0 && ds.length >= MAX_COPIES);
  const points = pointsAlong(tr.coords, ds).map(({ position, azi }, k) => {
    const left = side === 'left' || (side === 'alternate' && k % 2 === 0);
    const facing = facingOf(el, position, azi, left);
    return { position: offset ? destination(position, facing, offset) : position, facing, t: L ? ds[k] / L : 0, left };
  });
  return { points, length: L, capped };
}
const away = (azi, left) => norm360(azi + (left ? -90 : 90));
// the azimuth away from what the points go along, at position (azi: the way along it there): on an
// arc, exactly from its centre (left, outwards) or towards it
const facingOf = (el, position, azi, left) => (el.position ? away(inverse(el.position, position).azi + 90, left) : away(azi, left));

// ---- planning a connection ----------------------------------------------------------------------------

// The geometric median of planar points (Weiszfeld), weights all 1; tol: the step (m) at which it
// has settled.
export function weiszfeld(pts, iterations = 500, tol = 1e-6) {
  let m = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  for (let it = 0; it < iterations; it++) {
    let wx = 0, wy = 0, w = 0;
    for (const p of pts) {
      const d = Math.hypot(p[0] - m[0], p[1] - m[1]);
      if (d < 1e-9) return p.slice(); // on a point: it is the median (where the weight is not outweighed)
      wx += p[0] / d; wy += p[1] / d; w += 1 / d;
    }
    const next = [wx / w, wy / w];
    if (Math.hypot(next[0] - m[0], next[1] - m[1]) < tol) return next;
    m = next;
  }
  return m;
}
const hubOf = (positions) => { const f = frame(positions[0]); return f.from(weiszfeld(positions.map(f.to))); };
// A tree's hub: the geometric median of its nodes and its root (on a node when that is the median: a
// branch of 0 m). With a shortest branch (minBranch, m), the hub is kept that far from every node and
// from the root: pushed straight away from each it is too near, in turn, until none is. On one of them
// (within a metre: the median settles beside a node), it goes towards the root (from the root: towards
// the nodes).
export function hubFor(nodes, root, minBranch = 0) {
  let h = hubOf([...nodes, root]);
  if (!(minBranch > 0)) return h;
  const all = [...nodes, root];
  for (let it = 0; it < 100; it++) {
    const q = all.find((p) => inverse(p, h).s < minBranch - 1e-6);
    if (!q) break;
    const d = inverse(q, h);
    const away = q === root ? inverse(root, hubOf(nodes)) : inverse(q, root);
    const azi = d.s > 1 ? d.azi : away.s > 1e-9 ? away.azi : 0; // nowhere to head (the root on the node): north
    h = destination(q, azi, minBranch);
  }
  return h;
}
// How a group joins a root, and its length (straight lines). 'tree': root → hub → each node; 'chain':
// root → the nearer end node → the next … → the other end (reversed: from the last node).
function route(nodes, root, pattern, minBranch = 0) {
  if (pattern === 'chain') {
    let along = 0;
    for (let i = 1; i < nodes.length; i++) along += inverse(nodes[i - 1], nodes[i]).s;
    const a = inverse(root, nodes[0]).s, z = inverse(root, nodes.at(-1)).s;
    return { reversed: z < a, cost: Math.min(a, z) + along };
  }
  const b = hubFor(nodes, root, minBranch);
  return { hub: b, cost: inverse(root, b).s + nodes.reduce((a, n) => a + inverse(b, n).s, 0) };
}
// the largest tree Auto considers: each candidate group costs a hub, and every run of this many
// points is a candidate; and the largest a Group size may set (the search grows with its square:
// 400 points in trees of any size took 11 s). Chains cost nothing to size: any
export const MAX_AUTO_TREE = 32, MAX_TREE = 64;

// The plan: the points (positions, in order) cut into groups of consecutive points, each joined to one
// of the roots ([{ position, weight }]), the cut and the roots chosen together as the cheapest: the sum
// over the groups of their length divided by its root's weight (dynamic programming over the order:
// the best plan for the first i points ends with one group of up to groupSize points to one root). A
// tie (points evenly along a line: every cut costs the same) goes to the plan whose largest group is
// smallest. groupSize: a number, or 'auto' (a chain of any length; a tree of up to MAX_AUTO_TREE).
// minBranch: a tree's shortest branch (m).
// The candidates are costed in one local planar frame (metres about the middle point: the choice
// only needs their lengths against each other); the groups chosen are then routed on the ellipsoid.
// { groups: [{ nodes (indices), root (index), hub | reversed, cost (m) }], unused: [root indices],
//   total (m, the real length), groupSize (the largest group's, for 'auto') }
export function plan(points, roots, groupSize = 'auto', pattern = 'tree', minBranch = 0) {
  const n = points.length, R = roots.length;
  if (!n || !R) return { groups: [], unused: roots.map((_, i) => i), total: 0, groupSize };
  const chain = pattern === 'chain';
  const k = Math.min(n, groupSize === 'auto' ? (chain ? n : MAX_AUTO_TREE) : chain ? groupSize : Math.min(groupSize, MAX_TREE));
  const weight = (r) => (roots[r].weight > 0 ? roots[r].weight : 1);
  const f = frame(points[n >> 1]), P = points.map(f.to), Q = roots.map((r) => f.to(r.position));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const along = [0]; // along[i]: the chain from the first point to point i
  for (let i = 1; i < n; i++) along[i] = along[i - 1] + dist(P[i - 1], P[i]);
  // a group's cost from root r, planar: a chain from its nearer end; a tree through its hub, the
  // median pushed off what it is nearer than minBranch (as hubFor)
  const cost = (j, i, r) => {
    if (chain) return Math.min(dist(Q[r], P[j]), dist(Q[r], P[i - 1])) + along[i - 1] - along[j];
    const nodes = P.slice(j, i), all = [...nodes, Q[r]];
    let h = weiszfeld(all, 100, 0.01);
    for (let it = 0; minBranch > 0 && it < 100; it++) {
      const q = all.find((p) => dist(p, h) < minBranch - 1e-6);
      if (!q) break;
      const d = dist(q, h), to = d > 1 ? h : q === Q[r] ? weiszfeld(nodes, 100, 0.01) : Q[r], l = dist(q, to);
      h = l > 1e-9 ? [q[0] + ((to[0] - q[0]) / l) * minBranch, q[1] + ((to[1] - q[1]) / l) * minBranch] : [q[0], q[1] + minBranch]; // nowhere to head (the root on the node): north
    }
    return dist(Q[r], h) + nodes.reduce((a, p) => a + dist(h, p), 0);
  };
  const best = [{ score: 0, mx: 0 }]; // best[i]: the cheapest plan for the first i points (its largest group mx), and its last group
  for (let i = 1; i <= n; i++) {
    let b = null;
    for (let j = Math.max(0, i - k); j < i; j++) {
      for (let r = 0; r < R; r++) {
        const score = best[j].score + cost(j, i, r) / weight(r), mx = Math.max(best[j].mx, i - j);
        const eps = 1e-9 * (score + b?.score); // a tie: within rounding (totals reach 10⁷ m)
        if (!b || score < b.score - eps || (score <= b.score + eps && mx < b.mx)) b = { score, mx, j, r };
      }
    }
    best[i] = b;
  }
  const groups = [];
  for (let i = n; i > 0; i = best[i].j) {
    const { j, r } = best[i], nodes = Array.from({ length: i - j }, (_, x) => j + x);
    const rt = route(nodes.map((x) => points[x]), roots[r].position, pattern, minBranch);
    groups.unshift({ nodes, root: r, hub: rt.hub, reversed: rt.reversed, cost: rt.cost });
  }
  const used = new Set(groups.map((g) => g.root));
  return { groups, unused: roots.map((_, i) => i).filter((i) => !used.has(i)), total: groups.reduce((a, g) => a + g.cost, 0),
    groupSize: groupSize === 'auto' ? Math.max(...groups.map((g) => g.nodes.length)) : groupSize };
}

// The straight lines a plan makes, as [from, to] positions (the preview, before anything is made).
export function lines(points, roots, p, pattern = 'tree') {
  const out = [];
  for (const g of p.groups) {
    const o = roots[g.root].position, pts = g.nodes.map((i) => points[i]);
    if (pattern === 'chain') {
      const seq = g.reversed ? pts.slice().reverse() : pts;
      [o, ...seq].forEach((q, i, all) => { if (i) out.push([all[i - 1], q]); });
    } else {
      out.push([o, g.hub]);
      for (const q of pts) out.push([g.hub, q]);
    }
  }
  return out;
}

// points in the order a connection cuts them: all in one distribution, its order along its line;
// otherwise as given
function ordered(doc, nodes) {
  const arr = distributions(doc).find((a) => nodes.every((n) => a.points.some((x) => x.pointId === n.id)));
  if (arr) { const t = new Map(arr.points.map((x) => [x.pointId, x.t])); return [...nodes].sort((a, b) => t.get(a.id) - t.get(b.id)); }
  return nodes;
}

// A connection's plan before it is made (the form's preview): { nodes (points), roots ([{ position,
// weight }]), plan }. params: pointIds, roots ([{ id, weight }]), newRoots (positions, weight 1),
// pattern, groupSize, minBranch.
export function planConnection(doc, { pointIds, roots = [], newRoots = [], pattern = 'tree', groupSize = 'auto', minBranch = 0 }) {
  const byId = new Map(doc.points.map((n) => [n.id, n]));
  const nodes = ordered(doc, pointIds.map((id) => byId.get(id)).filter(Boolean));
  const rs = [...roots.filter((r) => byId.has(r.id)).map((r) => ({ position: byId.get(r.id).position, weight: r.weight })), ...newRoots.map((position) => ({ position, weight: 1 }))];
  return { nodes, roots: rs, plan: nodes.length && rs.length ? plan(nodes.map((n) => n.position), rs, groupSize, pattern, minBranch) : null };
}

// ---- making ----------------------------------------------------------------------------------------

export const COPY_RADIUS = 500; // m: the copies' radius when none is given
const DISTRIBUTE_KEYS = ['spacing', 'count', 'startMargin', 'endMargin', 'offset', 'side', 'radius', 'aperture', 'preset', 'copy'];
const settings = (p) => ({ spacing: p.count ? null : p.spacing, count: p.count || null, startMargin: p.startMargin || 0, endMargin: p.endMargin || 0,
  offset: p.offset || 0, side: p.side || 'left', radius: p.radius > 0 ? p.radius : COPY_RADIUS, aperture: p.aperture ?? null,
  preset: typeof p.preset === 'string' ? p.preset : null, copy: p.copy ?? null });
// What a distribution's copies are: { symbol, parts }. Its preset: null or 'circle', a circle of its
// radius (a sector, with its aperture), a diamond; another built-in kind scaled to its radius (its
// largest part reaching it); one of the user's ('preset:<name>'): copy, kept as it was chosen, its size
// its own.
export function copyOf(a) {
  if (a.copy) return a.copy;
  const kind = a.preset && BUILT_IN[a.preset] ? a.preset : 'circle';
  if (kind === 'circle') return { symbol: 'diamond', parts: [a.aperture ? makePart('sector', { radius: a.radius, aperture: a.aperture }) : makePart('circle', { radius: a.radius })] };
  return { symbol: BUILT_IN[kind].symbol, parts: scaled(BUILT_IN[kind].parts, a.radius) };
}
// whether a point is the copy given (its symbol and parts as the rule gives them; else changed by hand)
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const isCopy = (n, copy) => canon({ symbol: n.symbol, parts: n.parts }) === canon({ symbol: copy.symbol, parts: copy.parts });
// a group made for a rule, in parent (null: at the top)
function groupFor(doc, name, parent) {
  const g = { id: newId(doc), name, properties: [], groupId: parent, visible: true, look: {} };
  doc.groups.push(g);
  return g;
}
// the distribution's copies made at places, into its Copies group: each facing away from what it follows
function place(doc, a, points) {
  const taken = idsOf(doc), copy = copyOf(a);
  a.points = points.map((pt) => {
    const n = addPoint(doc, pt.position, { groupId: a.copiesId, ...structuredClone(copy), bearing: +pt.facing.toFixed(4) }, taken);
    return { pointId: n.id, t: pt.t, left: pt.left, pos: [...n.position] };
  });
}

// Distribute along: copies along a line or round a point's part (doc is changed: one undo step for the
// caller). params: along ({ element, part }: the line, or the point and the place of its part), spacing
// or count, startMargin, endMargin, offset, side ('left', 'right', 'alternate'), radius (the copies',
// apart from the spacing), aperture (the circle's as a sector, facing away from what it follows; null:
// circles), preset and copy (copyOf), groupId (the group its own group goes in; null: at the top).
// Returns { distribution (its rule), group (its own: "Distribute along X", with "Copies" in it) }.
export function makeDistribution(doc, params) {
  const along = alongOf(doc, params.along.element);
  const set = settings(params);
  const { points } = distribute(doc, along, { ...set, part: params.along.part ?? null });
  const parent = doc.groups.some((g) => g.id === params.groupId) ? params.groupId : null;
  const group = groupFor(doc, `Distribute along ${label(along.position ? 'point' : 'line', along)}`, parent);
  const copies = groupFor(doc, 'Copies', group.id);
  const distribution = { id: newId(doc), kind: 'distribute', groupId: group.id, copiesId: copies.id, along: { element: along.id, part: params.along.part ?? null }, ...set, points: [] };
  doc.rules.push(distribution);
  place(doc, distribution, points);
  return { distribution, group };
}

// A distribution with new settings. The same number of copies: they move (one moved by hand too), each
// made the rule's copy again unless changed by hand since (its symbol or parts: then its own stay);
// another number: they are made anew, and each connection built on them is made again with its
// settings. Returns { distribution, remade }, or null (the rule or what it follows gone).
export function editDistribution(doc, id, params) {
  const a = doc.rules.find((x) => x.id === id), along = a && alongOf(doc, a.along.element);
  if (!along) return null;
  const was = copyOf(a); // the copy before: a point that is still it takes the new one
  Object.assign(a, settings({ ...Object.fromEntries(DISTRIBUTE_KEYS.map((k) => [k, a[k]])), ...params }));
  if (params.along) a.along = { element: a.along.element, part: params.along.part ?? null };
  const { points } = distribute(doc, along, { ...a, part: a.along.part });
  const byId = new Map(doc.points.map((n) => [n.id, n])), copy = copyOf(a);
  if (points.length === a.points.length && a.points.every((x) => byId.has(x.pointId))) {
    a.points.forEach((x, k) => {
      const n = byId.get(x.pointId), pt = points[k];
      n.position = pt.position;
      n.bearing = +pt.facing.toFixed(4);
      if (isCopy(n, was)) Object.assign(n, structuredClone(copy)); // not changed by hand: the rule's
      Object.assign(x, { t: pt.t, left: pt.left, pos: [...pt.position] });
    });
    return { distribution: a, remade: false };
  }
  const old = new Set(a.points.map((x) => x.pointId));
  const built = connections(doc).filter((c) => c.pointIds.some((n) => old.has(n))).map((c) => unconnect(doc, c.id, true));
  remove(doc, [...old].filter((n) => byId.has(n)));
  place(doc, a, points);
  const made = a.points.map((x) => x.pointId);
  for (const c of built) connect(doc, { ...c, pointIds: [...c.pointIds.filter((n) => !old.has(n)), ...made] });
  return { distribution: a, remade: true };
}
// the rule's copy given back to a copy changed by hand (its inspector's ↺)
export function giveBack(doc, pointId) {
  const a = distributions(doc).find((r) => r.points.some((x) => x.pointId === pointId)), n = doc.points.find((x) => x.id === pointId);
  if (!a || !n) return;
  Object.assign(n, structuredClone(copyOf(a)));
}
// whether a copy has been changed by hand (its symbol or parts no longer the rule's)
export const changedByHand = (doc, pointId) => {
  const a = distributions(doc).find((r) => r.points.some((x) => x.pointId === pointId)), n = doc.points.find((x) => x.id === pointId);
  return !!a && !!n && !isCopy(n, copyOf(a));
};

// Connect points to roots (doc is changed: one undo step for the caller). params: pointIds, roots
// ([{ id (a point), weight }]), newRoots (positions where a root point is made: square, weight 1),
// pattern ('tree' or 'chain'), groupSize (a number, or 'auto'), minBranch (a tree's shortest branch,
// m), inflate (its trees drawn bowed, 0–1, display only: inflate.js), id (the connection made again: its
// own), groupId (made again: its group, kept), parentId (the group a new "Connection" group goes in;
// undefined: the first point's, a distribution's own for its copies). Returns { connection, groups, groupSize, lines, unused (root IDs), total (m) }, or null (no
// point or no root).
export function connect(doc, params) {
  const byId = new Map(doc.points.map((n) => [n.id, n]));
  const first = params.pointIds.map((id) => byId.get(id)).find(Boolean);
  if (!first) return null;
  const pattern = params.pattern === 'chain' ? 'chain' : 'tree';
  if (!planConnection(doc, { ...params, pattern }).plan) return null;
  // its group: the one it had, else a new "Connection" in the points' group (a distribution's copies:
  // beside their Copies, in its own group)
  const around = distributions(doc).find((a) => a.copiesId && a.copiesId === first.groupId)?.groupId ?? first.groupId ?? null;
  const groupId = doc.groups.some((g) => g.id === params.groupId) ? params.groupId
    : groupFor(doc, 'Connection', params.parentId !== undefined ? params.parentId : around).id;
  const inGroup = (el) => { el.groupId = groupId; return el; };
  const before = idsOf(doc);
  const made = (params.newRoots || []).map((pos) => inGroup(addPoint(doc, pos, { symbol: 'square', parts: [] })));
  const roots = [...(params.roots || []).filter((r) => byId.has(r.id)).map((r) => ({ id: r.id, weight: r.weight > 0 ? r.weight : 1 })), ...made.map((n) => ({ id: n.id, weight: 1 }))];
  const { nodes, plan: p } = planConnection(doc, { ...params, roots, newRoots: [], pattern });
  const rootPoints = roots.map((r) => doc.points.find((n) => n.id === r.id));
  // a straight line from a to b, attached to both, saying its part
  const line = (a, b, part) => inGroup(addLine(doc, a.id, [], b.id, { properties: [{ key: 'part', value: part }] }));
  const hubs = [];
  for (const g of p.groups) {
    const o = rootPoints[g.root], ns = g.nodes.map((i) => nodes[i]);
    if (pattern === 'chain') {
      const seq = [o, ...(g.reversed ? ns.slice().reverse() : ns)];
      seq.slice(1).forEach((n, i) => line(seq[i], n, 'chain'));
      continue;
    }
    // a hub of its own, always: on one of the points (the median often is), a branch of 0 m to it
    const b = inGroup(addDot(doc, g.hub));
    hubs.push({ pointId: b.id, pointIds: ns.map((x) => x.id), rootId: o.id, pos: [...b.position] });
    line(o, b, 'trunk');
    for (const n of ns) line(b, n, 'branch');
  }
  const keep = new Set(roots.map((r) => r.id));
  const created = [...doc.points, ...doc.lines].map((x) => x.id).filter((id) => !before.has(id) && !keep.has(id));
  const minBranch = pattern === 'tree' && params.minBranch > 0 ? params.minBranch : 0;
  const inflate = pattern === 'tree' && params.inflate > 0 ? Math.min(1, params.inflate) : 0; // chains are never bowed
  const connection = { id: params.id || newId(doc), kind: 'connect', groupId, pattern, groupSize: params.groupSize ?? 'auto', minBranch, inflate, roots, pointIds: nodes.map((n) => n.id), hubs, created };
  doc.rules.push(connection);
  return { connection, groups: p.groups.length, groupSize: p.groupSize, lines: doc.lines.filter((x) => created.includes(x.id)).length,
    unused: p.unused.map((i) => roots[i].id), total: p.total };
}

// A connection undone: what it made that still exists goes (its points and origins stay), and its
// record; its group too when nothing is left in it, unless kept (to be made again). Returns the record,
// or null.
export function unconnect(doc, id, keepGroup = false) {
  const c = connections(doc).find((x) => x.id === id);
  if (!c) return null;
  const keep = new Set([...c.roots.map((r) => r.id), ...c.pointIds]);
  const live = new Set([...doc.points, ...doc.lines].map((x) => x.id));
  remove(doc, c.created.filter((x) => !keep.has(x) && live.has(x)));
  doc.rules = doc.rules.filter((x) => x !== c);
  if (!keepGroup && !doc.groups.some((g) => g.groupId === c.groupId) && ![...doc.points, ...doc.lines, ...doc.areas, ...doc.labels].some((x) => x.groupId === c.groupId)) {
    doc.groups = doc.groups.filter((g) => g.id !== c.groupId);
  }
  return c;
}

// After a delete (gone: the IDs deleted): each connection that lost a root is made again with the
// roots left; with none left, its lines and hubs go.
export function reconnectWithout(doc, gone) {
  for (const c of connections(doc).filter((x) => x.roots.some((r) => gone.has(r.id)))) {
    const left = c.roots.filter((r) => !gone.has(r.id));
    if (left.length && c.pointIds.some((n) => doc.points.some((p) => p.id === n))) reconnect(doc, c.id, { roots: left });
    else unconnect(doc, c.id);
  }
}

// Connect again: a connection made anew, in its group, with its settings and changes ({ pattern,
// groupSize, minBranch, roots, newRoots }). Lines edited by hand are replaced. Returns as connect.
export function reconnect(doc, id, changes = {}) {
  const c = unconnect(doc, id, true);
  return c && connect(doc, { pointIds: c.pointIds, roots: c.roots, pattern: c.pattern, groupSize: c.groupSize, minBranch: c.minBranch, inflate: c.inflate, groupId: c.groupId, ...changes, id: c.id });
}

// The rule an element was made by or is part of: a distribution's copy, its group or Copies; a
// connection's line, hub or group; else null.
export function ruleOf(doc, id) {
  for (const r of doc.rules) {
    if (r.kind === 'distribute' && (r.groupId === id || r.copiesId === id || r.points.some((x) => x.pointId === id))) return r;
    if (r.kind === 'connect' && (r.groupId === id || r.created.includes(id))) return r;
  }
  return null;
}
// the distribution whose copies a connection connects, or null
export const distributionOf = (doc, c) => distributions(doc).find((a) => c.pointIds.length && c.pointIds.every((n) => a.points.some((x) => x.pointId === n))) ?? null;
// the connection made on a distribution's copies, or null
export const connectionOn = (doc, a) => { const ids = new Set(a.points.map((x) => x.pointId)); return connections(doc).find((c) => c.pointIds.length && c.pointIds.every((n) => ids.has(n))) ?? null; };

// ---- after any change: what the tools made follows ---------------------------------------------------

const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
// Each distribution's points re-placed along its line or arc as it is now (at the same place along it,
// the same offset and side), each facing away from it again; each hub at the median of its points and
// root again (its branches at least the connection's shortest). One moved by hand since (not where it
// was last put) stops following. A distribution whose line or point (or its radius) or points are gone,
// a connection whose points are gone, is dropped.
export function refreshGenerated(doc) {
  if (!doc.rules.length) return;
  const byId = new Map(doc.points.map((n) => [n.id, n]));
  doc.rules = doc.rules.filter((a) => {
    if (a.kind !== 'distribute') return true;
    a.points = a.points.filter((x) => byId.has(x.pointId)).sort((x, y) => x.t - y.t);
    const along = alongOf(doc, a.along.element), tr = along && alongTrace(doc, along, a.along.part);
    if (!tr || !a.points.length) return false;
    const at = pointsAlong(tr.coords, a.points.map((x) => x.t * tr.length));
    a.points.forEach((x, k) => {
      const n = byId.get(x.pointId);
      if (!same(n.position, x.pos)) return; // moved by hand
      const facing = facingOf(along, at[k].position, at[k].azi, x.left);
      n.position = a.offset ? destination(at[k].position, facing, a.offset) : at[k].position;
      n.bearing = +facing.toFixed(4);
      x.pos = [...n.position];
    });
    return true;
  });
  doc.rules = doc.rules.filter((c) => {
    if (c.kind !== 'connect') return true;
    c.hubs = c.hubs.filter((b) => {
      const n = byId.get(b.pointId), o = byId.get(b.rootId), members = b.pointIds.map((id) => byId.get(id)).filter(Boolean);
      if (!n || !o || !members.length || !same(n.position, b.pos)) return false;
      n.position = hubFor(members.map((x) => x.position), o.position, c.minBranch);
      b.pos = [...n.position];
      return true;
    });
    return c.pointIds.some((id) => byId.has(id));
  });
}
