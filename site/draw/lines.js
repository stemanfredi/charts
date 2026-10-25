// The lines of a drawing (docs/drawing-format.md §7): a line runs from its start through its
// vertices to its end, one leg between each two of these anchors. A leg without handles is the
// geodesic (as the ruler draws it); a leg with a handle is a cubic Bézier in the map's projection (Web
// Mercator), its handles ground metres [east, north] at their anchor. Lengths are always geodesic: a
// curve's, the sum over close samples of it. Pure: no map, no DOM.

import { densify, inverse, destination } from '../geodesy.js';
import { mercator, unmercator, D2R, nearestOnSegment } from '../geo.js';
import { isShown, groupsOf, roundParts } from './document.js';

const TOL = 1e-4; // a curve is sampled finer until its length changes by less than this, relative
const MAX_SAMPLES = 4096;

// longitude of q moved by whole turns to be continuous with p's
const near = (p, q) => [q[0] + 360 * Math.round((p[0] - q[0]) / 360), q[1]];
// the projection's scale (Mercator metres per ground metre) at a latitude
const scale = (lat) => 1 / Math.cos(lat * D2R);

// The anchors of a line: [{ position, hIn, hOut }], from its start to its end (an attached end where
// what it is attached to is: attach.js refreshAttached keeps it there).
export function anchorsOf(doc, line) {
  return [{ position: line.start.position, hIn: null, hOut: line.startHandle },
    ...line.vertices.map((v) => ({ position: v.position, hIn: v.handleIn, hOut: v.handleOut })),
    { position: line.end.position, hIn: line.endHandle, hOut: null }];
}

// One leg a → b: its points (both ends included, longitudes continuous from a's) and its length.
export function leg(a, b) {
  const q = near(a.position, b.position);
  if (!a.hOut && !b.hIn) {
    const pts = densify(a.position, q).map((p) => near(a.position, p));
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
    let len = 0;
    for (let i = 1; i < next.length; i++) len += inverse(next[i - 1], next[i]).s;
    const done = Math.abs(len - length) <= TOL * len || n >= MAX_SAMPLES;
    pts = next;
    length = len;
    if (done) break;
    n *= 2;
  }
  return { pts: pts.map((p, i) => (i ? near(pts[i - 1], p) : p)), length };
}

// A line's trace: { coords, length, at (distance from the start at each anchor), legs (lengths) },
// cached by what it depends on (the anchors), so an unchanged line is not computed again.
const cache = new Map();
export function lineTrace(doc, line) {
  const anchors = anchorsOf(doc, line);
  const key = JSON.stringify(anchors);
  const hit = cache.get(line.id);
  if (hit && hit.key === key) return hit.line;
  const coords = [], at = [0], legs = [];
  let length = 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    const l = leg(anchors[i], anchors[i + 1]);
    const pts = coords.length ? l.pts.map((p) => near(coords[coords.length - 1], p)) : l.pts;
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

// Positions along a line (its coords, a geodesic polyline) at distances: [{ position, azi }], azi the
// line's direction there.
export function pointsAlong(coords, distances) {
  const legs = [];
  for (let i = 1; i < coords.length; i++) legs.push(inverse(coords[i - 1], coords[i]));
  const out = [];
  let i = 0, start = 0;
  for (const d of distances) {
    while (i < legs.length - 1 && start + legs[i].s < d) { start += legs[i].s; i++; }
    if (!legs.length) { out.push({ position: coords[0], azi: 0 }); continue; }
    const p = destination(coords[i], legs[i].azi, Math.max(0, d - start));
    out.push({ position: p, azi: inverse(p, coords[i + 1]).s > 0.01 ? inverse(p, coords[i + 1]).azi : legs[i].azi });
  }
  return out;
}
// The distance along a line (coords) of its point nearest to p, measured in the projection (as on
// screen): metres from its start.
export function nearestAlong(coords, p) {
  const P = mercator(near(coords[0], p));
  let best = Infinity, at = 0, along = 0;
  for (let i = 1; i < coords.length; i++) {
    const s = inverse(coords[i - 1], coords[i]).s, { t, d } = nearestOnSegment(mercator(coords[i - 1]), mercator(near(coords[i - 1], coords[i])), P);
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

// ---- Smooth: handles for a line through its vertices (mode "auto") ----------------------------

// Catmull-Rom tangents in the projection: at a vertex, parallel to the line from the anchor before
// to the anchor after, each handle a third of its own leg; at the ends, towards the neighbouring
// handle's end, a third of the leg. Returned as the line's handle fields, in ground metres. A
// line without vertices stays as it is: straight, a geodesic.
//
// Relaxed curves: where other lines arrive at the point the line starts from (their end attached to
// it), the line leaves along their arriving direction (the mean), a third of its first leg, then bends
// to its end: branches carry on the incoming direction and fan out. Then even a line without vertices
// curves.
export function smooth(doc, line) {
  const anchors = anchorsOf(doc, line);
  const arrive = arriving(doc, line);
  if (anchors.length < 3 && !arrive) return { startHandle: line.startHandle, endHandle: line.endHandle, vertices: line.vertices.map((v) => ({ handleIn: v.handleIn, handleOut: v.handleOut })) };
  const ps = [anchors[0].position];
  for (const a of anchors.slice(1)) ps.push(near(ps[ps.length - 1], a.position));
  const M = ps.map(mercator);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], len = (v) => Math.hypot(v[0], v[1]);
  const unit = (v) => { const l = len(v); return l ? [v[0] / l, v[1] / l] : [0, 0]; };
  const ground = (v, i) => { const c = Math.cos(ps[i][1] * D2R); return [+(v[0] * c).toFixed(3), +(v[1] * c).toFixed(3)]; };
  const hIn = [], hOut = [];
  for (let i = 1; i < M.length - 1; i++) {
    const t = unit(sub(M[i + 1], M[i - 1]));
    const a = len(sub(M[i], M[i - 1])) / 3, b = len(sub(M[i + 1], M[i])) / 3;
    hIn[i] = [-t[0] * a, -t[1] * a];
    hOut[i] = [t[0] * b, t[1] * b];
  }
  const last = M.length - 1;
  const end = (i, j, h) => { const target = [M[j][0] + h[0], M[j][1] + h[1]], d = unit(sub(target, M[i])), l = len(sub(M[j], M[i])) / 3; return [d[0] * l, d[1] * l]; };
  // the start: along the arriving direction, if lines arrive there; else towards the next handle
  const first = len(sub(M[1], M[0])) / 3;
  // the arriving direction is followed only where the line heads roughly onwards (within about 80°),
  // the less the further it turns: a branch going sideways or back would otherwise loop round
  const onwards = arrive ? arrive[0] * unit(sub(M[1], M[0]))[0] + arrive[1] * unit(sub(M[1], M[0]))[1] : 0;
  const start = arrive && onwards > 0.17 ? [arrive[0] * first * onwards, arrive[1] * first * onwards] : last > 1 ? end(0, 1, hIn[1]) : null;
  if (!start) return { startHandle: null, endHandle: null, vertices: [] }; // no vertex, nothing to follow: straight
  return {
    startHandle: ground(start, 0),
    endHandle: ground(last > 1 ? end(last, last - 1, hOut[last - 1]) : end(last, 0, start), last),
    vertices: line.vertices.map((v, k) => ({ handleIn: ground(hIn[k + 1], k + 1), handleOut: ground(hOut[k + 1], k + 1) })),
  };
}
// The mean direction (Mercator, unit) in which other lines arrive at the point a line starts from, or
// null.
function arriving(doc, line) {
  const at = line.start.element;
  if (!at) return null;
  const dirs = [];
  for (const s of doc.lines) {
    if (s === line || s.end.element !== at || s.guide) continue;
    const c = lineTrace(doc, s).coords;
    if (c.length < 2) continue;
    const A = mercator(c.at(-2)), B = mercator(c.at(-1)), d = [B[0] - A[0], B[1] - A[1]], l = Math.hypot(d[0], d[1]);
    if (l) dirs.push([d[0] / l, d[1] / l]);
  }
  if (!dirs.length) return null;
  const m = [dirs.reduce((a, d) => a + d[0], 0), dirs.reduce((a, d) => a + d[1], 0)], l = Math.hypot(m[0], m[1]);
  return l > 1e-9 ? [m[0] / l, m[1] / l] : null;
}

// set a line's handles by the Smooth rule
export function applySmooth(doc, line) {
  const h = smooth(doc, line);
  line.startHandle = h.startHandle;
  line.endHandle = h.endHandle;
  h.vertices.forEach((v, i) => { line.vertices[i].handleIn = v.handleIn; line.vertices[i].handleOut = v.handleOut; });
}
// lines in mode "auto" follow their anchors: their handles computed again (after any change)
export function refreshAuto(doc) { for (const s of doc.lines) if (s.mode === 'auto') applySmooth(doc, s); }
