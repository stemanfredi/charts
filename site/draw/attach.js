// References to a place on an element (docs/drawing-ui.md §2.2): what a line's end and a label
// point at. A reference is { position, element, part?, vertex? | edge and at? }: element null, free at
// position; element alone, its centre (a point's position, an area's centroid, a line's middle);
// vertex k, its vertex k (an area's corner k, a point's outline part's corner k (part: its place in
// the point's parts; none: its largest outline); a line's place k, 0 its start, the last its end); edge k and at, the side from vertex k to the next (an area's or an outline's, closed; a
// line's leg k), at (0–1) along it. position is where it is now (refreshAttached, after each change);
// one whose element (or vertex, or edge) is gone is free where it was. Pure: no map, no DOM.

import { inverse, destination } from '../geodesy.js';
import { mercator, nearestOnSegment } from '../geo.js';
import { find, addDot, centroid, insertVertex, deleteVertex, splitLine, mainOutline, outlineParts } from './document.js';
import { outlinePoints } from './outlines.js';
import { lineTrace, pointsAlong, nearestAlong, positionsOf } from './lines.js';

// the vertices of an element: an area's corners, the corners of a point's outline part (part: its place
// in the point's parts; null: its largest outline), a line's places (its start, its vertices, its end);
// null for anything else
export function verticesOf(x, part = null) {
  if (x?.kind === 'area') return x.el.points;
  if (x?.kind === 'point') {
    const o = part == null ? mainOutline(x.el)?.part : x.el.parts[part];
    return o && o.length ? outlinePoints(x.el.position, x.el.bearing, o.length, o.width, o.kind) : null;
  }
  if (x?.kind === 'line') return positionsOf(x.el);
  return null;
}
// a line's edges are its legs (open); an area's and an outline's sides close
const edgeCount = (x, vs) => (x.kind === 'line' ? vs.length - 1 : vs.length);
// the position f (0–1) along the geodesic a → b
export const along = (a, b, f) => { const d = inverse(a, b); return destination(a, d.azi, d.s * f); };

// Where a reference points, and what about it: { position, element ({ kind, el }, or null: free),
// length (of its line), along (from its line's start, on a line), edge ({ length, bearing } of the
// side or leg it is on) }, or null when what it names is gone.
export function resolve(doc, ref) {
  if (!ref.element) return ref.position ? { position: ref.position, element: null } : null;
  const x = find(doc, ref.element);
  if (!x || x.kind === 'group' || x.kind === 'label') return null;
  const tr = x.kind === 'line' ? lineTrace(doc, x.el) : null, line = tr ? { length: tr.length } : {};
  const at = (d) => ({ ...line, along: d, position: pointsAlong(tr.coords, [d])[0].position });
  if (ref.vertex == null && ref.edge == null) {
    if (x.kind === 'point') return { position: x.el.position, element: x };
    if (x.kind === 'area') return { position: centroid(x.el.points), element: x };
    return { ...at(tr.length / 2), element: x };
  }
  const vs = verticesOf(x, ref.part);
  if (!vs) return null;
  if (ref.vertex != null) {
    if (ref.vertex >= vs.length) return null;
    return { position: vs[ref.vertex], element: x, ...(tr ? { ...line, along: tr.at[ref.vertex] } : {}) };
  }
  if (ref.edge >= edgeCount(x, vs)) return null;
  const a = vs[ref.edge], b = vs[(ref.edge + 1) % vs.length], f = ref.at ?? 0, g = inverse(a, b);
  const edge = { length: tr ? tr.legs[ref.edge] : g.s, bearing: g.azi };
  if (tr) return { ...at(tr.at[ref.edge] + f * tr.legs[ref.edge]), element: x, edge };
  return { position: along(a, b, f), element: x, edge };
}
export const targetPosition = (doc, ref) => resolve(doc, ref)?.position ?? null;
// a reference free where it is
export const freeRef = (ref) => ({ position: [...ref.position], element: null });

// every reference in the drawing, as [object, key] pairs: the lines' ends, the labels' anchors
const refsIn = (doc) => [...doc.lines.flatMap((s) => [[s, 'start'], [s, 'end']]), ...doc.labels.map((a) => [a, 'anchor'])];

// Each reference where what it points at is now; one whose target is gone is free where it was.
// Twice: a line's end on another line's vertex follows that line's own end.
export function refreshAttached(doc) {
  for (let pass = 0; pass < 2; pass++) {
    for (const [o, k] of refsIn(doc)) {
      const r = o[k];
      if (!r.element) continue;
      const p = targetPosition(doc, r);
      if (!p) { if (r.position) o[k] = freeRef(r); } // gone: free where it was
      else if (!r.position || p[0] !== r.position[0] || p[1] !== r.position[1]) r.position = [...p];
    }
  }
}

// The edge of a closed ring of corners nearest to p (as on screen: in the projection), and how far
// along it: { edge, at, d (Mercator metres) }.
function nearestEdge(cs, p) {
  const P = mercator(p);
  let best = null;
  for (let i = 0; i < cs.length; i++) {
    const { t, d } = nearestOnSegment(mercator(cs[i]), mercator(cs[(i + 1) % cs.length]), P);
    if (!best || d < best.d) best = { edge: i, at: t, d };
  }
  return best;
}
// the vertex of vs nearest to p (in the projection)
function nearestVertex(vs, p) {
  const P = mercator(p);
  let k = 0, best = Infinity;
  vs.forEach((c, i) => { const C = mercator(c), d = Math.hypot(C[0] - P[0], C[1] - P[1]); if (d < best) { best = d; k = i; } });
  return { vertex: k, d: best };
}
// A reference on element x at p: on its edge nearest p (a line's: along its legs as drawn, curves
// included; a point's: of its outline parts, the nearest), or (vertex) on its vertex nearest p. null:
// x has no vertices.
export function refNear(doc, x, p, vertex = false) {
  if (x.kind === 'line') {
    const vs = verticesOf(x);
    if (vertex) { const v = nearestVertex(vs, p); return { position: [...vs[v.vertex]], element: x.el.id, vertex: v.vertex, d: v.d }; }
    const r = lineRef(doc, x.el, nearestAlong(lineTrace(doc, x.el).coords, p)), P = mercator(p), Q = mercator(r.position);
    return { ...r, d: Math.hypot(Q[0] - P[0], Q[1] - P[1]) };
  }
  if (x.kind === 'area') return nearOn(x.el.points, x.el.id, p, vertex);
  if (x.kind !== 'point') return null;
  // a point: on the nearest of its outline parts, named by its place (its shown ones, if any is)
  const outs = outlineParts(x.el), shown = outs.filter(({ part }) => part.shown);
  const each = (shown.length ? shown : outs).map(({ i }) => ({ ...nearOn(verticesOf(x, i), x.el.id, p, vertex), part: i }));
  return each.length ? each.reduce((a, b) => (b.d < a.d ? b : a)) : null;
}
// on a closed ring of vertices vs of element id at p: its nearest vertex, or place on an edge
function nearOn(vs, id, p, vertex) {
  if (vertex) { const v = nearestVertex(vs, p); return { position: [...vs[v.vertex]], element: id, vertex: v.vertex, d: v.d }; }
  const e = nearestEdge(vs, p);
  return { position: along(vs[e.edge], vs[(e.edge + 1) % vs.length], e.at), element: id, edge: e.edge, at: +e.at.toFixed(6), d: e.d };
}
// the reference d metres along a line from its start: on the leg there
export function lineRef(doc, line, d) {
  const tr = lineTrace(doc, line), dd = Math.max(0, Math.min(tr.length, d));
  let k = tr.legs.length - 1;
  while (k > 0 && tr.at[k] > dd) k--;
  const at = tr.legs[k] ? (dd - tr.at[k]) / tr.legs[k] : 0;
  return { position: pointsAlong(tr.coords, [dd])[0].position, element: line.id, edge: k, at: +Math.min(1, Math.max(0, at)).toFixed(6) };
}
const clean = ({ d, ...ref }) => ref; // eslint-disable-line no-unused-vars

// The references on the vertices and edges of element id placed again where they are now: after its
// vertices changed in number (one added or removed, another outline), each goes to the nearest vertex,
// or the nearest place along an edge. One with nothing left to point at is free.
export function reattach(doc, id) {
  const x = find(doc, id);
  for (const [o, k] of refsIn(doc)) {
    const r = o[k];
    if (r.element !== id || (r.vertex == null && r.edge == null)) continue;
    const n = x && refNear(doc, x, r.position, r.vertex != null);
    o[k] = n ? { ...clean(n), position: [...r.position] } : freeRef(r);
  }
}
// a corner added to an area at index (before the corner there), one taken away (it keeps three at
// least); a vertex added to a line before its vertex index, one taken away: what points at their
// vertices and edges follows
export function insertCorner(doc, area, index, position) {
  area.points.splice(index, 0, [...position]);
  reattach(doc, area.id);
}
export function removeCorner(doc, area, index) {
  if (area.points.length <= 3) return;
  area.points.splice(index, 1);
  reattach(doc, area.id);
}
export function addVertex(doc, line, index, position) {
  insertVertex(line, index, position);
  reattach(doc, line.id);
}
export function removeVertex(doc, line, index) {
  deleteVertex(line, index);
  reattach(doc, line.id);
}
// Split a line at its vertex index (document.js splitLine): what pointed at that vertex points at the
// point made there; what pointed at the rest of the line, at the part where it now is. Returns the
// point.
export function splitKeeping(doc, lineId, index) {
  const at = doc.lines.find((s) => s.id === lineId).vertices[index].position;
  const was = refsIn(doc).filter(([o, k]) => o[k].element === lineId && (o[k].vertex != null || o[k].edge != null));
  const point = splitLine(doc, lineId, index);
  const parts = doc.lines.filter((s) => s.id === lineId || (s.start.element === point.id && s.id !== lineId)).map((el) => ({ kind: 'line', el }));
  for (const [o, k] of was) {
    const r = o[k];
    if (r.vertex != null && Math.abs(r.position[0] - at[0]) < 1e-12 && Math.abs(r.position[1] - at[1]) < 1e-12) { o[k] = { position: [...at], element: point.id }; continue; }
    const n = parts.map((x) => refNear(doc, x, r.position, r.vertex != null)).reduce((a, b) => (b.d < a.d ? b : a));
    o[k] = { ...clean(n), position: [...r.position] };
  }
  return point;
}

// what a reference is on, in words: "", "vertex 2", "edge 3"
// where on what it is attached to, as the tables number it: a line's point or leg, an area's or an
// outline's corner or edge
export const partName = (r, kind) => (r.vertex != null ? `${kind === 'line' ? 'point' : 'corner'} ${r.vertex + 1}` : r.edge != null ? `${kind === 'line' ? 'leg' : 'edge'} ${r.edge + 1}` : '');

// What a line's end becomes on a snap target (snap.js): a point's ID (its centre), a reference, or
// null (nothing to attach to). On another line's free end, a point is made there and that end
// attached to it too (doc is changed).
export function attachTo(doc, to) {
  if (!to) return null;
  if (to.end) {
    const s = doc.lines.find((x) => x.id === to.end.lineId), p = addDot(doc, s[to.end.key].position);
    s[to.end.key] = { position: [...p.position], element: p.id };
    return p.id;
  }
  if (to.vertex == null && to.edge == null) return to.element;
  return { ...to, position: [...targetPosition(doc, to)] };
}
