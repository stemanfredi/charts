// Rules (docs/drawing-ui.md §6): Repeat along and Connect, two tools that make ordinary points and
// lines and stay linked to them, kept in doc.rules ({ kind: 'repeat' | 'connect', ... }). What a rule
// makes is in a group of its own: Repeat along's, "Repeat along X", holds a subgroup "Circles" (the
// copies) and Connect's subgroup "Connection" (its lines, hubs and new origins); Connect alone makes
// its "Connection" in the points' group. Pure: no map, no DOM.
//   Repeat along: circles along a line, or round a point's part (a circle: the whole of it from its bearing,
//     or its sector's arc from one end to the other, clockwise): points every `spacing` (or `count` of
//     them) between the margins, offset to one side or alternating, each a circle or a sector facing
//     away from the line (on an arc, left is outwards). They follow the line or the point when it is
//     edited (moved, turned, its radius or arc changed); one moved by hand stops following.
//   Connect: points joined to origins. The points, in order (an array's along its line, otherwise
//     along the direction they mainly run in), are shared evenly among the origins, each origin taking
//     the share nearest it (one far from its share, likely a mistake, gives it to its neighbour and is
//     reported unused); each share is cut into groups of at most `capacity` (one shorter, placed where
//     the total is smallest; 'auto': the size with the shortest total). Pattern 'tree': a hub per
//     group (the geometric median of its points and its origin, Weiszfeld; moved back along the trunk
//     while a branch is shorter than `minBranch`), a line from the origin to it (part "trunk"), lines
//     from it to each point ("branch", 0 m where the hub is on the point); 'chain': a line from the origin to
//     the group's nearer end point, then point to point ("chain"). Each line is attached to the points
//     it joins; hubs follow their points; one moved by hand stops following.
// The lines are straight: they are the real object (positions, lengths).

import { inverse, destination, localFrame as frame } from '../geodesy.js';
import { norm360 } from '../geo.js';
import { lineTrace, pointsAlong } from './lines.js';
import { addPoint, addDot, addLine, newId, idsOf, makePart, followedPart, label } from './document.js';
import { outlineOf } from './outlines.js';
import { BUILT_IN, scaled } from './place.js';

// a drawing's rules of each kind
export const repeats = (doc) => doc.rules.filter((r) => r.kind === 'repeat');
export const connections = (doc) => doc.rules.filter((r) => r.kind === 'connect');
import { removeKeepingLabels } from './labels.js';

const FORCE_LIMIT = 2; // an origin keeps its share unless a neighbouring origin's connection is less than half as long

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

// The geometric median of planar points (Weiszfeld), weights all 1.
export function weiszfeld(pts, iterations = 500) {
  let m = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  for (let it = 0; it < iterations; it++) {
    let wx = 0, wy = 0, w = 0;
    for (const p of pts) {
      const d = Math.hypot(p[0] - m[0], p[1] - m[1]);
      if (d < 1e-9) return p.slice(); // on a point: it is the median (where the weight is not outweighed)
      wx += p[0] / d; wy += p[1] / d; w += 1 / d;
    }
    const next = [wx / w, wy / w];
    if (Math.hypot(next[0] - m[0], next[1] - m[1]) < 1e-6) return next;
    m = next;
  }
  return m;
}
const hubOf = (positions) => { const f = frame(positions[0]); return f.from(weiszfeld(positions.map(f.to))); };
// A tree's hub: the geometric median of its nodes and its origin (on a node, it stays there: a branch
// of 0 m). A branch shorter than minBranch (m) moves it back along the trunk towards the origin, to the
// first place where every branch is that long, or to the origin.
const HUB_STEPS = 64;
export function hubFor(nodes, origin, minBranch = 0) {
  const b = hubOf([...nodes, origin]);
  const ok = (q) => nodes.every((n) => inverse(n, q).s >= minBranch - 1e-6);
  if (!(minBranch > 0) || ok(b)) return b;
  const t = inverse(b, origin), at = (f) => destination(b, t.azi, t.s * f);
  for (let i = 1; i < HUB_STEPS; i++) {
    if (!ok(at(i / HUB_STEPS))) continue;
    let lo = (i - 1) / HUB_STEPS, hi = i / HUB_STEPS; // the first step far enough: the place between it and the one before
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (ok(at(mid))) hi = mid; else lo = mid; }
    return at(hi);
  }
  return [...origin];
}
// How a group joins an origin, and its length (straight lines). 'tree': origin → hub → each node;
// 'chain': origin → the nearer end node → the next … → the other end (reversed: from the last node).
function route(nodes, origin, pattern, minBranch = 0) {
  if (pattern === 'chain') {
    let along = 0;
    for (let i = 1; i < nodes.length; i++) along += inverse(nodes[i - 1], nodes[i]).s;
    const a = inverse(origin, nodes[0]).s, z = inverse(origin, nodes.at(-1)).s;
    return { reversed: z < a, first: Math.min(a, z), cost: Math.min(a, z) + along };
  }
  const b = hubFor(nodes, origin, minBranch);
  return { hub: b, first: inverse(origin, b).s, cost: inverse(origin, b).s + nodes.reduce((a, n) => a + inverse(b, n).s, 0) };
}
// the ways to cut n nodes into groups of at most c, in order: arrays of sizes (the shorter group at
// each possible place)
export function partitions(n, c) {
  const g = Math.ceil(n / c), short = n - (g - 1) * c;
  if (!n) return [];
  if (short === c) return [Array(g).fill(c)];
  return Array.from({ length: g }, (_, j) => Array.from({ length: g }, (__, i) => (i === j ? short : c)));
}
// One share of the nodes (indices, in order) cut for one origin: groups of at most capacity (one
// shorter, placed where the total is smallest), or 'auto': a chain is the whole share; a tree, groups
// of the size with the shortest total.
function cut(points, idx, origin, capacity, pattern, minBranch) {
  const sizes = capacity !== 'auto' ? [Math.min(capacity, idx.length)] : pattern === 'chain' ? [idx.length] : Array.from({ length: idx.length }, (_, i) => idx.length - i);
  let best = null;
  for (const c of sizes) { // from the largest down: a tie keeps fewer groups
    for (const parts of partitions(idx.length, c)) {
      let at = 0;
      const groups = parts.map((n) => { const g = idx.slice(at, at + n); at += n; return { nodes: g, ...route(g.map((i) => points[i]), origin, pattern, minBranch) }; });
      const total = groups.reduce((a, g) => a + g.cost, 0);
      if (!best || total < best.total - 1e-6) best = { groups, total, capacity: c };
    }
  }
  return best;
}

// The plan: the nodes (positions, in order) shared evenly among the origins (each origin taking the
// share nearest it), each share joined to its origin; minBranch: a tree's shortest branch (m). An
// origin far from its share (its connection more than twice as long as the neighbouring origin's would
// be) gives the share to that neighbour and is reported unused: probably a mistake.
// { groups: [{ nodes, origin, hub | reversed, cost }], unused: [origin indices], estimate, capacity }.
export function plan(points, origins, capacity, pattern = 'tree', minBranch = 0) {
  const n = points.length, K = origins.length;
  if (!n || !K) return { groups: [], unused: origins.map((_, i) => i), estimate: 0, capacity };
  // the origins in order along the nodes: by the node nearest each
  const nearest = (o) => points.reduce((bi, p, i) => (inverse(o, p).s < inverse(o, points[bi]).s ? i : bi), 0);
  const order = origins.map((o, i) => ({ i, at: nearest(o) })).sort((x, y) => x.at - y.at || x.i - y.i).map((x) => x.i);
  const shares = order.map((oi, k) => { const from = Math.round((k * n) / K), to = Math.round(((k + 1) * n) / K); return { oi, idx: Array.from({ length: to - from }, (_, j) => from + j) }; });
  // a share whose origin is far: to the neighbouring origin (before or after it), if that is less than half
  const cost = (sh, oi) => route(sh.idx.map((i) => points[i]), origins[oi], pattern).first;
  shares.forEach((sh, k) => {
    if (!sh.idx.length) return;
    const own = cost(sh, sh.oi);
    const others = [shares[k - 1], shares[k + 1]].filter(Boolean).map((x) => x.oi).filter((oi) => oi !== sh.oi);
    const better = others.find((oi) => FORCE_LIMIT * cost(sh, oi) < own);
    if (better !== undefined) sh.oi = better;
  });
  const groups = [];
  let used = 0;
  for (const sh of shares) {
    if (!sh.idx.length) continue;
    const c = cut(points, sh.idx, origins[sh.oi], capacity, pattern, minBranch);
    used = Math.max(used, c.capacity);
    for (const g of c.groups) groups.push({ nodes: g.nodes, origin: sh.oi, hub: g.hub, reversed: g.reversed, first: g.first, cost: g.cost });
  }
  const serving = new Set(groups.map((g) => g.origin));
  return { groups, unused: origins.map((_, i) => i).filter((i) => !serving.has(i)), estimate: groups.reduce((a, g) => a + g.cost, 0), capacity: capacity === 'auto' ? used : capacity };
}

// The straight lines a plan makes, as [from, to] positions (the preview, before anything is made).
export function lines(points, origins, p, pattern = 'tree') {
  const out = [];
  for (const g of p.groups) {
    const o = origins[g.origin], pts = g.nodes.map((i) => points[i]);
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

// points in the order a connection shares them out: all in one array, its order along its line;
// otherwise along the direction they mainly run in (their principal axis)
function ordered(doc, nodes) {
  const arr = repeats(doc).find((a) => nodes.every((n) => a.points.some((x) => x.pointId === n.id)));
  if (arr) { const t = new Map(arr.points.map((x) => [x.pointId, x.t])); return [...nodes].sort((a, b) => t.get(a.id) - t.get(b.id)); }
  if (nodes.length < 2) return nodes;
  const f = frame(nodes[0].position), xy = nodes.map((n) => f.to(n.position));
  const mx = xy.reduce((a, p) => a + p[0], 0) / xy.length, my = xy.reduce((a, p) => a + p[1], 0) / xy.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of xy) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const th = Math.atan2(2 * sxy, sxx - syy) / 2, dx = Math.cos(th), dy = Math.sin(th);
  return nodes.map((n, i) => ({ n, k: (xy[i][0] - mx) * dx + (xy[i][1] - my) * dy })).sort((a, b) => a.k - b.k).map((x) => x.n);
}

// A connection's plan before it is made (the form's preview): { nodes (points), origins (positions), plan }.
// params: pointIds, originIds, newOrigins (positions), pattern, capacity.
export function planConnection(doc, { pointIds, originIds = [], newOrigins = [], pattern = 'tree', capacity = 'auto', minBranch = 0 }) {
  const byId = new Map(doc.points.map((n) => [n.id, n]));
  const nodes = ordered(doc, pointIds.map((id) => byId.get(id)).filter(Boolean));
  const origins = [...originIds.map((id) => byId.get(id)).filter(Boolean).map((n) => n.position), ...newOrigins];
  return { nodes, origins, plan: nodes.length && origins.length ? plan(nodes.map((n) => n.position), origins, capacity, pattern, minBranch) : null };
}

// ---- making ----------------------------------------------------------------------------------------

export const ARRAY_RADIUS = 500; // m: the circles' radius when none is given
const ARRAY_KEYS = ['spacing', 'count', 'startMargin', 'endMargin', 'offset', 'side', 'radius', 'aperture', 'preset', 'copy'];
const settings = (p) => ({ spacing: p.count ? null : p.spacing, count: p.count || null, startMargin: p.startMargin || 0, endMargin: p.endMargin || 0,
  offset: p.offset || 0, side: p.side || 'left', radius: p.radius > 0 ? p.radius : ARRAY_RADIUS, aperture: p.aperture ?? null,
  preset: typeof p.preset === 'string' ? p.preset : null, copy: p.copy ?? null });
// What a repetition's copies are: { symbol, parts }. Its preset: null or 'circle', a circle of its
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
// the repetition's copies made at places, into its Circles group: each facing away from what it follows
function place(doc, a, points) {
  const taken = idsOf(doc), copy = copyOf(a);
  a.points = points.map((pt) => {
    const n = addPoint(doc, pt.position, { groupId: a.circlesId, ...structuredClone(copy), bearing: +pt.facing.toFixed(4) }, taken);
    return { pointId: n.id, t: pt.t, left: pt.left, pos: [...n.position] };
  });
}

// Repeat along: copies along a line or round a point's part (doc is changed: one undo step for the
// caller). params: along ({ element, part }: the line, or the point and the place of its part), spacing
// or count, startMargin, endMargin, offset, side ('left', 'right', 'alternate'), radius (the copies',
// apart from the spacing), aperture (the circle's as a sector, facing away from what it follows; null:
// circles), preset and copy (copyOf), groupId (the group its own group goes in; null: at the top).
// Returns { array (its rule), group (its own: "Repeat along X", with "Circles" in it) }.
export function makeArray(doc, params) {
  const along = alongOf(doc, params.along.element);
  const set = settings(params);
  const { points } = distribute(doc, along, { ...set, part: params.along.part ?? null });
  const parent = doc.groups.some((g) => g.id === params.groupId) ? params.groupId : null;
  const group = groupFor(doc, `Repeat along ${label(along.position ? 'point' : 'line', along)}`, parent);
  const circles = groupFor(doc, 'Circles', group.id);
  const array = { id: newId(doc), kind: 'repeat', groupId: group.id, circlesId: circles.id, along: { element: along.id, part: params.along.part ?? null }, ...set, points: [] };
  doc.rules.push(array);
  place(doc, array, points);
  return { array, group };
}

// A repetition with new settings. The same number of copies: they move (one moved by hand too), each
// made the rule's copy again unless changed by hand since (its symbol or parts: then its own stay);
// another number: they are made anew, and each connection built on them is made again with its
// settings. Returns { array, remade }, or null (the rule or what it follows gone).
export function editArray(doc, id, params) {
  const a = doc.rules.find((x) => x.id === id), along = a && alongOf(doc, a.along.element);
  if (!along) return null;
  const was = copyOf(a); // the copy before: a point that is still it takes the new one
  Object.assign(a, settings({ ...Object.fromEntries(ARRAY_KEYS.map((k) => [k, a[k]])), ...params }));
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
    return { array: a, remade: false };
  }
  const old = new Set(a.points.map((x) => x.pointId));
  const built = connections(doc).filter((c) => c.pointIds.some((n) => old.has(n))).map((c) => unconnect(doc, c.id, true));
  removeKeepingLabels(doc, [...old].filter((n) => byId.has(n)));
  place(doc, a, points);
  const made = a.points.map((x) => x.pointId);
  for (const c of built) connect(doc, { ...c, pointIds: [...c.pointIds.filter((n) => !old.has(n)), ...made] });
  return { array: a, remade: true };
}
// the rule's copy given back to a copy changed by hand (its inspector's ↺)
export function giveBack(doc, pointId) {
  const a = repeats(doc).find((r) => r.points.some((x) => x.pointId === pointId)), n = doc.points.find((x) => x.id === pointId);
  if (!a || !n) return;
  Object.assign(n, structuredClone(copyOf(a)));
}
// whether a copy has been changed by hand (its symbol or parts no longer the rule's)
export const changedByHand = (doc, pointId) => {
  const a = repeats(doc).find((r) => r.points.some((x) => x.pointId === pointId)), n = doc.points.find((x) => x.id === pointId);
  return !!a && !!n && !isCopy(n, copyOf(a));
};

// Connect points to origins (doc is changed: one undo step for the caller). params: pointIds, originIds
// (points), newOrigins (positions where an origin point is made: square, with its lines), pattern
// ('tree' or 'chain'), capacity (a number, or 'auto'), minBranch (a tree's shortest branch, m), id
// (the connection made again: its own), groupId (made again: its group, kept), parentId (the group a
// new "Connection" group goes in; undefined: the first point's, a repetition's own for its copies).
// Returns { connection, groups, capacity, lines, unused (origin IDs), estimate, atOrigin (trees whose
// hub is at their origin: their points nearer it than the shortest branch) }, or null (no point or no
// origin).
export function connect(doc, params) {
  const byId = new Map(doc.points.map((n) => [n.id, n]));
  const first = params.pointIds.map((id) => byId.get(id)).find(Boolean);
  if (!first) return null;
  const pattern = params.pattern === 'chain' ? 'chain' : 'tree';
  if (!planConnection(doc, { ...params, pattern }).plan) return null;
  // its group: the one it had, else a new "Connection" in the points' group (a repetition's copies:
  // beside their Circles, in its own group)
  const around = repeats(doc).find((a) => a.circlesId && a.circlesId === first.groupId)?.groupId ?? first.groupId ?? null;
  const groupId = doc.groups.some((g) => g.id === params.groupId) ? params.groupId
    : groupFor(doc, 'Connection', params.parentId !== undefined ? params.parentId : around).id;
  const inGroup = (el) => { el.groupId = groupId; return el; };
  const before = idsOf(doc);
  const made = (params.newOrigins || []).map((pos) => inGroup(addPoint(doc, pos, { symbol: 'square', parts: [] })));
  const originIds = [...(params.originIds || []).filter((id) => byId.has(id)), ...made.map((n) => n.id)];
  const { nodes, plan: p } = planConnection(doc, { ...params, originIds, newOrigins: [], pattern });
  const origins = originIds.map((id) => doc.points.find((n) => n.id === id));
  // a straight line from a to b, attached to both, saying its part
  const line = (a, b, part) => inGroup(addLine(doc, a.id, [], b.id, { properties: [{ key: 'part', value: part }] }));
  const hubs = [];
  let atOrigin = 0;
  for (const g of p.groups) {
    const o = origins[g.origin], ns = g.nodes.map((i) => nodes[i]);
    if (pattern === 'chain') {
      const seq = [o, ...(g.reversed ? ns.slice().reverse() : ns)];
      seq.slice(1).forEach((n, i) => line(seq[i], n, 'chain'));
      continue;
    }
    // a hub of its own, always: on one of the points (the median often is), a branch of 0 m to it
    const b = inGroup(addDot(doc, g.hub));
    if (inverse(b.position, o.position).s < 1) atOrigin++;
    hubs.push({ pointId: b.id, pointIds: ns.map((x) => x.id), originId: o.id, pos: [...b.position] });
    line(o, b, 'trunk');
    for (const n of ns) line(b, n, 'branch');
  }
  const keep = new Set(originIds);
  const created = [...doc.points, ...doc.lines].map((x) => x.id).filter((id) => !before.has(id) && !keep.has(id));
  const minBranch = pattern === 'tree' && params.minBranch > 0 ? params.minBranch : 0;
  const connection = { id: params.id || newId(doc), kind: 'connect', groupId, pattern, capacity: params.capacity ?? 'auto', minBranch, originIds, pointIds: nodes.map((n) => n.id), hubs, created };
  doc.rules.push(connection);
  return { connection, groups: p.groups.length, capacity: p.capacity, lines: doc.lines.filter((x) => created.includes(x.id)).length,
    unused: p.unused.map((i) => originIds[i]), estimate: p.estimate, atOrigin };
}

// A connection undone: what it made that still exists goes (its points and origins stay), and its
// record; its group too when nothing is left in it, unless kept (to be made again). Returns the record,
// or null.
export function unconnect(doc, id, keepGroup = false) {
  const c = connections(doc).find((x) => x.id === id);
  if (!c) return null;
  const keep = new Set([...c.originIds, ...c.pointIds]);
  const live = new Set([...doc.points, ...doc.lines].map((x) => x.id));
  removeKeepingLabels(doc, c.created.filter((x) => !keep.has(x) && live.has(x)));
  doc.rules = doc.rules.filter((x) => x !== c);
  if (!keepGroup && !doc.groups.some((g) => g.groupId === c.groupId) && ![...doc.points, ...doc.lines, ...doc.areas, ...doc.labels].some((x) => x.groupId === c.groupId)) {
    doc.groups = doc.groups.filter((g) => g.id !== c.groupId);
  }
  return c;
}

// After a delete (gone: the IDs deleted): each connection that lost an origin is made again with the
// origins left; with none left, its lines and hubs go.
export function reconnectWithout(doc, gone) {
  for (const c of connections(doc).filter((x) => x.originIds.some((o) => gone.has(o)))) {
    const left = c.originIds.filter((o) => !gone.has(o));
    if (left.length && c.pointIds.some((n) => doc.points.some((p) => p.id === n))) reconnect(doc, c.id, { originIds: left });
    else unconnect(doc, c.id);
  }
}

// Connect again: a connection made anew, in its group, with its settings and changes ({ pattern,
// capacity, minBranch, originIds, newOrigins }). Lines edited by hand are replaced. Returns as connect.
export function reconnect(doc, id, changes = {}) {
  const c = unconnect(doc, id, true);
  return c && connect(doc, { pointIds: c.pointIds, originIds: c.originIds, pattern: c.pattern, capacity: c.capacity, minBranch: c.minBranch, groupId: c.groupId, ...changes, id: c.id });
}

// The rule an element was made by or is part of: a repetition's copy, its group or Circles; a
// connection's line, hub or group; else null. { rule, array? (the repetition, for a connection on its
// copies) }
export function ruleOf(doc, id) {
  for (const r of doc.rules) {
    if (r.kind === 'repeat' && (r.groupId === id || r.circlesId === id || r.points.some((x) => x.pointId === id))) return r;
    if (r.kind === 'connect' && (r.groupId === id || r.created.includes(id))) return r;
  }
  return null;
}
// the repetition whose copies a connection connects, or null
export const repeatOf = (doc, c) => repeats(doc).find((a) => c.pointIds.length && c.pointIds.every((n) => a.points.some((x) => x.pointId === n))) ?? null;
// the connection made on a repetition's copies, or null
export const connectionOn = (doc, a) => { const ids = new Set(a.points.map((x) => x.pointId)); return connections(doc).find((c) => c.pointIds.length && c.pointIds.every((n) => ids.has(n))) ?? null; };

// ---- after any change: what the tools made follows ---------------------------------------------------

const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
// Each array's points re-placed along its line or arc as it is now (at the same place along it, the
// same offset and side), each facing away from it again; each hub at the median of its points and
// origin again (its branches at least the connection's shortest). One moved by hand since (not where it was last put) stops following. An array whose
// line or point (or its radius) or points are gone, a connection whose points are gone, is dropped.
export function refreshGenerated(doc) {
  if (!doc.rules.length) return;
  const byId = new Map(doc.points.map((n) => [n.id, n]));
  doc.rules = doc.rules.filter((a) => {
    if (a.kind !== 'repeat') return true;
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
      const n = byId.get(b.pointId), o = byId.get(b.originId), members = b.pointIds.map((id) => byId.get(id)).filter(Boolean);
      if (!n || !o || !members.length || !same(n.position, b.pos)) return false;
      n.position = hubFor(members.map((x) => x.position), o.position, c.minBranch);
      b.pos = [...n.position];
      return true;
    });
    return c.pointIds.some((id) => byId.has(id));
  });
}
