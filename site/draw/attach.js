// Links (docs/drawing-ui.md §2.2): a place of an element (a line's place, a label's point) tied to a
// place on another, following it. The drawing's links are [{ from: [id, index], to }]; to, a target,
// is { element, part?, vertex? | edge and at? }: element alone, its centre (a point's position, a
// closed line's centroid, an open line's middle); vertex k, its vertex k (a line's place k, a point's
// outline part's corner k (part: its place in the point's parts; none: its largest outline)); edge k
// and at, the side from vertex k to the next (a line's leg k, a closed line's last back to its first;
// an outline's, closed), at (0–1) along it. Every place keeps its position: refreshAttached moves
// the linked ones where their targets are, after each change; a link whose place or target is gone
// goes, its place free where it was. Pure: no map, no DOM.

import { inverse, destination } from '../geodesy.js';
import { mercator, nearestOnSegment } from '../geo.js';
import { find, addDot, addPoint, centroid, mainOutline, outlineParts, positionsIn, targetOf, setLink, idsOf, newId, nextName, fewestPlaces } from './document.js';
import { outlinePoints } from './outlines.js';
import { lineTrace, pointsAlong, nearestAlong } from './lines.js';

// the vertices of an element: a line's places, the corners of a point's outline part (part: its place
// in the point's parts; null: its largest outline); null for anything else
export function verticesOf(x, part = null) {
  if (x?.kind === 'point') {
    const o = part == null ? mainOutline(x.el)?.part : x.el.parts[part];
    return o && o.length ? outlinePoints(x.el.position, x.el.bearing, o.length, o.width, o.kind) : null;
  }
  if (x?.kind === 'line') return x.el.points;
  return null;
}
// a line's edges are its legs (a closed one's close); an outline's sides close
const edgeCount = (x, vs) => (x.kind === 'line' && !x.el.closed ? vs.length - 1 : vs.length);
// the position f (0–1) along the geodesic a → b
export const along = (a, b, f) => { const d = inverse(a, b); return destination(a, d.azi, d.s * f); };

// Where a target is, and what about it: { position, element ({ kind, el }), length (of its line),
// along (from its line's start, on a line), edge ({ length, bearing } of the side or leg it is on) },
// or null when what it names is gone.
export function resolve(doc, ref) {
  const x = find(doc, ref.element);
  if (!x || x.kind === 'group' || x.kind === 'label') return null;
  const tr = x.kind === 'line' ? lineTrace(doc, x.el) : null, line = tr ? { length: tr.length } : {};
  const at = (d) => ({ ...line, along: d, position: pointsAlong(tr.coords, [d])[0].position });
  if (ref.vertex == null && ref.edge == null) {
    if (x.kind === 'point') return { position: x.el.position, element: x };
    return x.el.closed ? { ...line, position: centroid(x.el.points), element: x } : { ...at(tr.length / 2), element: x };
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
// the [object, key] of place [id, index] (positionsIn), or null when it is not there
const slotOf = (doc, [id, index]) => { const x = find(doc, id); return (x && positionsIn(x.kind, x.el)[index]) ?? null; };
// where place [id, index] is, or null
export const placeAt = (doc, from) => { const s = slotOf(doc, from); return s ? s[0][s[1]] : null; };

// Each linked place where its target is now; a link whose place or target is gone goes (the place
// free where it was). Again until nothing moves: a line's place on another line's place follows that
// one's, however long the chain and in whatever order (at most once per link: a loop settles too).
export function refreshAttached(doc) {
  for (let pass = 0, moved = true; moved && pass <= doc.links.length; pass++) {
    moved = false;
    for (const l of [...doc.links]) {
      const s = slotOf(doc, l.from), p = s && targetPosition(doc, l.to);
      if (!p) { doc.links.splice(doc.links.indexOf(l), 1); continue; }
      const [o, k] = s;
      if (o[k][0] !== p[0] || o[k][1] !== p[1]) { o[k] = [...p]; moved = true; }
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
// A target on element x at p, with its position and its distance d from p: on its edge nearest p (a line's: along its legs as drawn, curves
// included; a point's: of its outline parts, the nearest), or (vertex) on its vertex nearest p. null:
// x has no vertices.
export function refNear(doc, x, p, vertex = false) {
  if (x.kind === 'line') {
    const vs = verticesOf(x);
    if (vertex) { const v = nearestVertex(vs, p); return { position: [...vs[v.vertex]], element: x.el.id, vertex: v.vertex, d: v.d }; }
    const r = lineRef(doc, x.el, nearestAlong(lineTrace(doc, x.el).coords, p)), P = mercator(p), Q = mercator(r.position);
    return { ...r, d: Math.hypot(Q[0] - P[0], Q[1] - P[1]) };
  }
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
// the target d metres along a line from its start (with its position): on the leg there
export function lineRef(doc, line, d) {
  const tr = lineTrace(doc, line), dd = Math.max(0, Math.min(tr.length, d));
  let k = tr.legs.length - 1;
  while (k > 0 && tr.at[k] > dd) k--;
  const at = tr.legs[k] ? (dd - tr.at[k]) / tr.legs[k] : 0;
  return { position: pointsAlong(tr.coords, [dd])[0].position, element: line.id, edge: k, at: +Math.min(1, Math.max(0, at)).toFixed(6) };
}

// The links to the vertices and edges of element id placed again where their places are: after its
// vertices changed in number (one added or removed, another outline), each goes to the nearest vertex,
// or the nearest place along an edge. One with nothing left to point at goes.
export function reattach(doc, id) {
  const x = find(doc, id);
  doc.links = doc.links.flatMap((l) => {
    if (l.to.element !== id || (l.to.vertex == null && l.to.edge == null)) return [l];
    const p = placeAt(doc, l.from), n = x && p && refNear(doc, x, p, l.to.vertex != null);
    return n ? [{ from: l.from, to: targetOf(n) }] : [];
  });
}
// A place added to a line at index (before the one there), one taken away (while it keeps its fewest
// places): the links from its places numbered again (the one from a place taken away goes),
// those to its vertices and edges where they were (reattach).
export function insertPlace(doc, id, index, position) {
  const el = find(doc, id).el;
  el.points.splice(index, 0, [...position]);
  el.names.splice(index, 0, '');
  renumber(doc, id, index, 1);
}
export function deletePlace(doc, id, index) {
  const el = find(doc, id).el;
  if (el.points.length <= fewestPlaces(el)) return;
  el.points.splice(index, 1);
  el.names.splice(index, 1);
  renumber(doc, id, index, -1);
}
function renumber(doc, id, index, n) {
  doc.links = doc.links.filter((l) => n > 0 || l.from[0] !== id || l.from[1] !== index);
  for (const l of doc.links) if (l.from[0] === id && l.from[1] >= index) l.from = [id, l.from[1] + n];
  reattach(doc, id);
}
// Split a line at its place index (not an end): a point (a dot, named as the place) made there, the
// line ending there and a new one carrying on from it with the rest, both linked to it. The links from
// the rest's places go with it (the one at the split goes: the point is there); those to its
// vertices and edges, to the point when on that place, else to the half where they now are. Returns
// the point. A closed line is opened there instead: one line from that place round to it again (its
// start and its end there), nothing made; the links numbered from its new start.
export function splitLine(doc, lineId, index) {
  const s = find(doc, lineId).el, n = s.points.length;
  if (s.closed) {
    s.points = [...s.points.slice(index), ...s.points.slice(0, index + 1)].map((q) => [...q]);
    s.names = [...s.names.slice(index), ...s.names.slice(0, index), ''];
    s.closed = false;
    for (const l of doc.links) if (l.from[0] === lineId) l.from = [lineId, (l.from[1] - index + n) % n];
    reattach(doc, lineId);
    return null;
  }
  const taken = idsOf(doc), p = addPoint(doc, s.points[index], { name: s.names[index] || nextName(doc, 'point'), symbol: 'dot', parts: [] }, taken);
  const rest = { ...structuredClone(s), id: newId(doc, taken), name: nextName(doc, 'line'), points: s.points.slice(index), names: ['', ...s.names.slice(index + 1)] };
  s.points = s.points.slice(0, index + 1);
  s.names = [...s.names.slice(0, index), ''];
  doc.lines.splice(doc.lines.indexOf(s) + 1, 0, rest);
  setLink(doc, lineId, index, { element: p.id });
  for (const l of doc.links) if (l.from[0] === lineId && l.from[1] > index) l.from = [rest.id, l.from[1] - index];
  setLink(doc, rest.id, 0, { element: p.id });
  const halves = [s, rest].map((el) => ({ kind: 'line', el }));
  for (const l of doc.links) {
    const t = l.to;
    if (t.element !== lineId || (t.vertex == null && t.edge == null)) continue;
    if (t.vertex === index) { l.to = { element: p.id }; continue; }
    const q = placeAt(doc, l.from);
    l.to = targetOf(halves.map((x) => refNear(doc, x, q, t.vertex != null)).reduce((a, b) => (b.d < a.d ? b : a)));
  }
  return p;
}

// where on what it is attached to, as the tables number it: a line's point or leg, an outline's
// corner or edge
export const partName = (r, kind) => (r.vertex != null ? `${kind === 'line' ? 'point' : 'corner'} ${r.vertex + 1}` : r.edge != null ? `${kind === 'line' ? 'leg' : 'edge'} ${r.edge + 1}` : '');

// What a place is linked to on a snap target (snap.js): a target, or null (nothing to attach to). On
// another line's free end, a point is made there and that end linked to it too (doc is changed).
export function attachTo(doc, to) {
  if (!to) return null;
  if (!to.end) return targetOf(to);
  const p = addDot(doc, placeAt(doc, to.end));
  setLink(doc, ...to.end, { element: p.id });
  return { element: p.id };
}
