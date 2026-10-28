// The lines of a drawing (docs/drawing-format.md §7): a line runs from its start through its
// vertices to its end, one leg between each two of these anchors. A straight line's legs are
// geodesics (as the ruler draws them); a smooth one's are cubic Béziers in the map's projection (Web
// Mercator) through its anchors, their handles computed from the anchors (Catmull-Rom), ground metres
// [east, north] at their anchor. Lengths are always geodesic: a curve's, the sum over close samples
// of it. Pure: no map, no DOM.

import { densify, inverse, destination, areaOf, pathOf, perimeterOf, lengthOf } from '../geodesy.js';
import { mercator, unmercator, D2R, nearestOnSegment, unrollTo } from '../geo.js';
import { isShown, groupsOf, roundParts, pointKind } from './document.js';

const TOL = 1e-4; // a curve is sampled finer until its length changes by less than this, relative
const MAX_SAMPLES = 4096;

// the projection's scale (Mercator metres per ground metre) at a latitude
const scale = (lat) => 1 / Math.cos(lat * D2R);

// a line's positions, start to end (its anchors')
export const positionsOf = (line) => [line.start.position, ...line.vertices.map((v) => v.position), line.end.position];

// The anchors of a line: [{ position, hIn, hOut }], from its start to its end (an attached end where
// what it is attached to is: attach.js refreshAttached keeps it there); handles only on a smooth line
// with a vertex (without one it stays straight, a geodesic).
export function anchorsOf(line) {
  const ps = positionsOf(line), hs = line.smooth && ps.length > 2 ? smoothHandles(ps) : null;
  return ps.map((position, i) => ({ position, hIn: hs?.[i].hIn ?? null, hOut: hs?.[i].hOut ?? null }));
}
// Catmull-Rom tangents in the projection: at a vertex, parallel to the line from the anchor before to
// the anchor after, each handle a third of its own leg; at the ends, towards the neighbouring
// handle's end, a third of the leg. In ground metres, [{ hIn, hOut }] per anchor.
function smoothHandles(positions) {
  const ps = [positions[0]];
  for (const p of positions.slice(1)) ps.push(unrollTo(ps[ps.length - 1], p));
  const M = ps.map(mercator), last = M.length - 1;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], len = (v) => Math.hypot(v[0], v[1]);
  const unit = (v) => { const l = len(v); return l ? [v[0] / l, v[1] / l] : [0, 0]; };
  const ground = (v, i) => { const c = Math.cos(ps[i][1] * D2R); return [v[0] * c, v[1] * c]; };
  const hIn = [], hOut = [];
  for (let i = 1; i < last; i++) {
    const t = unit(sub(M[i + 1], M[i - 1])), a = len(sub(M[i], M[i - 1])) / 3, b = len(sub(M[i + 1], M[i])) / 3;
    hIn[i] = [-t[0] * a, -t[1] * a];
    hOut[i] = [t[0] * b, t[1] * b];
  }
  const end = (i, j, h) => { const target = [M[j][0] + h[0], M[j][1] + h[1]], d = unit(sub(target, M[i])), l = len(sub(M[j], M[i])) / 3; return [d[0] * l, d[1] * l]; };
  hOut[0] = end(0, 1, hIn[1]);
  hIn[last] = end(last, last - 1, hOut[last - 1]);
  return M.map((_, i) => ({ hIn: hIn[i] ? ground(hIn[i], i) : null, hOut: hOut[i] ? ground(hOut[i], i) : null }));
}

// One leg a → b: its points (both ends included, longitudes continuous from a's) and its length.
export function leg(a, b) {
  const q = unrollTo(a.position, b.position);
  if (!a.hOut && !b.hIn) {
    const pts = densify(a.position, q).map((p) => unrollTo(a.position, p));
    pts[0] = a.position; // the anchors exactly, not as computed back
    pts[pts.length - 1] = q;
    return { pts, length: inverse(a.position, q).s };
  }
  const P0 = mercator(a.position), P3 = mercator(q);
  const h1 = a.hOut || [0, 0], h2 = b.hIn || [0, 0], k1 = scale(a.position[1]), k2 = scale(q[1]);
  const P1 = [P0[0] + h1[0] * k1, P0[1] + h1[1] * k1], P2 = [P3[0] + h2[0] * k2, P3[1] + h2[1] * k2];
  const at = (t) => {
    const u = 1 - t, A = u * u * u, B = 3 * u * u * t, C = 3 * u * t * t, E = t * t * t;
    return unmercator([A * P0[0] + B * P1[0] + C * P2[0] + E * P3[0], A * P0[1] + B * P1[1] + C * P2[1] + E * P3[1]]);
  };
  let n = 16, pts, length = Infinity;
  for (;;) {
    const next = [];
    for (let i = 0; i <= n; i++) next.push(i === 0 ? a.position : i === n ? q : at(i / n));
    const len = lengthOf(next);
    const done = Math.abs(len - length) <= TOL * len || n >= MAX_SAMPLES;
    pts = next;
    length = len;
    if (done) break;
    n *= 2;
  }
  return { pts: pts.map((p, i) => (i ? unrollTo(pts[i - 1], p) : p)), length };
}

// A line's trace: { coords, length, at (distance from the start at each anchor), legs (lengths) },
// cached by what it depends on (the anchors), so an unchanged line is not computed again.
const cache = new Map();
export function lineTrace(doc, line) {
  const anchors = anchorsOf(line);
  const key = JSON.stringify(anchors);
  const hit = cache.get(line.id);
  if (hit && hit.key === key) return hit.line;
  const coords = [], at = [0], legs = [];
  let length = 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    const l = leg(anchors[i], anchors[i + 1]);
    const pts = coords.length ? l.pts.map((p) => unrollTo(coords[coords.length - 1], p)) : l.pts;
    coords.push(...(i ? pts.slice(1) : pts));
    length += l.length;
    legs.push(l.length);
    at.push(length);
  }
  const trace = { coords, length, at, legs };
  if (cache.size > 5000) cache.clear();
  cache.set(line.id, { key, line: trace });
  return trace;
}

// A polyline's steps' geodesics and their distances from its start, once per coords (a trace's are cached).
const stepsOf = new WeakMap();
export function steps(coords) {
  let x = stepsOf.get(coords);
  if (!x) {
    const legs = [], from = [0];
    for (let i = 1; i < coords.length; i++) { legs.push(inverse(coords[i - 1], coords[i])); from.push(from[i - 1] + legs[i - 1].s); }
    stepsOf.set(coords, x = { legs, from });
  }
  return x;
}
// Positions along a line (its coords, a geodesic polyline) at distances: [{ position, azi }], azi the
// line's direction there.
export function pointsAlong(coords, distances) {
  const { legs, from } = steps(coords);
  const out = [];
  for (const d of distances) {
    if (!legs.length) { out.push({ position: coords[0], azi: 0 }); continue; }
    let lo = 0, hi = legs.length - 1; // the last step starting before d
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (from[m] < d) lo = m; else hi = m - 1; }
    const i = lo, start = from[i];
    const p = destination(coords[i], legs[i].azi, Math.max(0, d - start));
    out.push({ position: p, azi: inverse(p, coords[i + 1]).s > 0.01 ? inverse(p, coords[i + 1]).azi : legs[i].azi });
  }
  return out;
}
// The distance along a line (coords) of its point nearest to p, measured in the projection (as on
// screen): metres from its start.
export function nearestAlong(coords, p) {
  const P = mercator(unrollTo(coords[0], p));
  let best = Infinity, at = 0, along = 0;
  for (let i = 1; i < coords.length; i++) {
    const s = inverse(coords[i - 1], coords[i]).s, { t, d } = nearestOnSegment(mercator(coords[i - 1]), mercator(unrollTo(coords[i - 1], coords[i])), P);
    if (d < best) { best = d; at = along + t * s; }
    along += s;
  }
  return at;
}

// Totals: each line's length (guides left out: they are supporting geometry), the lines' count and
// length, the points' count (ringed: those with radii) and the areas' count, per group (everything
// in it, its subgroups' too), per value of the property by (a key; '' for those without it), and for
// the whole drawing. Hidden elements count, and each total says whether it includes any (hidden:
// true). Groups by ID ('' for not grouped); values only with by.
export function totals(doc, by = null) {
  const lines = new Map();
  const bucket = () => ({ length: 0, lines: 0, points: 0, ringed: 0, areas: 0, hidden: false });
  const groups = new Map(), values = new Map(), all = bucket();
  const into = (map, key) => { if (!map.has(key)) map.set(key, bucket()); return map.get(key); };
  const each = (el, fn) => {
    const gs = groupsOf(doc, el).map((g) => g.id), value = by ? [into(values, el.properties.find((p) => p.key === by)?.value ?? '')] : [];
    for (const b of [...(gs.length ? gs : ['']).map((g) => into(groups, g)), ...value, all]) { fn(b); if (!isShown(doc, el)) b.hidden = true; }
  };
  for (const s of doc.lines) {
    if (s.guide) continue;
    const len = lineTrace(doc, s).length;
    lines.set(s.id, len);
    each(s, (b) => { b.length += len; b.lines++; });
  }
  for (const p of doc.points) if (!p.guide) each(p, (b) => { b.points++; if (roundParts(p).length) b.ringed++; });
  for (const g of doc.areas) if (!g.guide) each(g, (b) => { b.areas++; });
  return { lines, groups, values, all };
}

// The lines a connection made, by what each is, from its ends: 'trunk' (a tree's, root → hub),
// 'branch' (hub → point), 'root link' (a chain's, root → its first point), 'link' (point → point); by
// line ID
export function madeLines(doc) {
  const out = new Map(), byId = new Map(doc.lines.map((s) => [s.id, s]));
  for (const c of doc.rules) {
    if (c.kind !== 'connect') continue;
    const roots = new Set(c.roots.map((r) => r.id)), tree = c.pattern !== 'chain';
    for (const id of c.created) {
      const s = byId.get(id);
      if (!s) continue;
      const atRoot = roots.has(s.start.element) || roots.has(s.end.element);
      out.set(id, { connection: c, part: tree ? (atRoot ? 'trunk' : 'branch') : (atRoot ? 'root link' : 'link') });
    }
  }
  return out;
}
const PART_ORDER = ['trunk', 'branch', 'root link', 'link'];

// The drawing's lengths and counts laid out for the Totals view (docs/drawing-ui.md §5): the lines
// by group (or by the values of property `by`), each line listed under its group but for those a
// connection made, which are summed by what they are (trunks and branches; a chain's root links and
// the links between points); the areas; the points by kind. Guides are left out; hidden elements are
// counted, and said. Pure: no formatting, no names (the panel puts those).
//   { lines: { rows: [{ key, lines: [{ id, length }], parts: [{ part, count, length }], count, length, hidden }],
//              count, length, hidden }, areas: { rows: [{ id, area, perimeter }], count, area, perimeter, hidden },
//     points: { count, hidden, kinds: Map kind → count (by a property: its value → count) } }
export function breakdown(doc, by = null) {
  const keyOf = (el) => (by ? el.properties.find((p) => p.key === by)?.value ?? '' : groupsOf(doc, el)[0]?.id ?? '');
  const made = madeLines(doc), rows = new Map();
  const rowOf = (key) => { if (!rows.has(key)) rows.set(key, { key, lines: [], parts: new Map(), count: 0, length: 0, hidden: false }); return rows.get(key); };
  const lines = { count: 0, length: 0, hidden: false };
  for (const s of doc.lines) {
    if (s.guide) continue;
    const len = lineTrace(doc, s).length, r = rowOf(keyOf(s)), m = made.get(s.id);
    if (m) { const p = r.parts.get(m.part) || { part: m.part, count: 0, length: 0 }; p.count++; p.length += len; r.parts.set(m.part, p); } else r.lines.push({ id: s.id, length: len });
    r.count++; r.length += len; lines.count++; lines.length += len;
    if (!isShown(doc, s)) r.hidden = lines.hidden = true;
  }
  const areas = { rows: [], count: 0, area: 0, perimeter: 0, hidden: false };
  for (const g of doc.areas) {
    if (g.guide) continue;
    const area = areaOf(pathOf(g.points, true)), perimeter = perimeterOf(g.points);
    areas.rows.push({ id: g.id, area, perimeter });
    areas.count++; areas.area += area; areas.perimeter += perimeter;
    if (!isShown(doc, g)) areas.hidden = true;
  }
  const points = { count: 0, hidden: false, kinds: new Map() }; // kinds: by kind, or by the property's values
  for (const p of doc.points) {
    if (p.guide) continue;
    const k = by ? keyOf(p) : pointKind(p);
    points.kinds.set(k, (points.kinds.get(k) || 0) + 1);
    points.count++;
    if (!isShown(doc, p)) points.hidden = true;
  }
  return { lines: { ...lines, rows: [...rows.values()].map((r) => ({ ...r, parts: [...r.parts.values()].sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part)) })) }, areas, points };
}
