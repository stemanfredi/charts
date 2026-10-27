// Snapping (docs/drawing-ui.md §2.2): where a click or a drag lands when it is near something
// drawn, on screen. Targets, nearest kind first: a vertex (a point's centre, a corner of an outline
// or an area, a line's vertex or free end); the crossing of two edges or legs; an edge or a leg. Each
// within RADIUS px; the nearest of the first kind found wins. What a target can attach a line's end
// to (attach.js) comes with it. Shift instead turns the leg being drawn in 15° steps. Pure: the map
// gives the projection (view.project, view.unproject).

import { inverse, destination } from '../geodesy.js';
import { nearestOnSegment } from '../geo.js';
import { verticesOf } from './attach.js';
import { lineTrace, steps } from './lines.js';
import { isShown, KIND } from './document.js';

export const RADIUS = 6; // px
const STEP = 15; // degrees: Shift's steps

// where the screen segments a–b and c–d cross, strictly inside both, or null
function crossing(a, b, c, d) {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (!den) return null;
  const u = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den, v = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  return u > 1e-6 && u < 1 - 1e-6 && v > 1e-6 && v < 1 - 1e-6 ? [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])] : null;
}

// What snapping at the screen point p ([x, y]) finds: { position, kind ('vertex' | 'crossing' |
// 'edge'), to (what a line's end would attach to, or null: a crossing) } or null. to: a reference's
// target (attach.js: { element } a point's centre, { element, vertex }, { element, edge, at }: an
// area's or an outline's, or a line's, its legs as drawn), or { end: { lineId, key } } (a line's free
// end: a point is made there to join them). ids: the elements whose edges to
// look at (the map's hits near p, which may lag a change by a frame; null: all; vertices are looked at
// in every element); exclude: elements never snapped to (the one drawn or dragged).
export function snapAt(doc, p, view, { ids = null, exclude = new Set(), radius = RADIUS } = {}) {
  const px = (q) => view.project(q);
  const want = (el) => !exclude.has(el.id) && isShown(doc, el);
  const edgesOf = (el) => !ids || ids.has(el.id);
  const vertices = [], edges = [];
  const vertex = (q, to) => { const s = px(q), d = Math.hypot(s[0] - p[0], s[1] - p[1]); if (d <= radius) vertices.push({ d, position: q, to }); };
  // an edge's screen segment, kept when near; to(t): its target t along it
  const edge = (a, b, to, id) => {
    if (!edgesOf({ id })) return;
    const A = px(a), B = px(b), n = nearestOnSegment(A, B, p);
    if (n.d <= radius) edges.push({ d: n.d, A, B, q: n.q, t: n.t, to, id });
  };
  for (const kind of ['point', 'line', 'area']) { // what has positions to snap to
    for (const el of doc[KIND[kind].list]) {
      if (!want(el)) continue;
      if (kind === 'point') vertex(el.position, { element: el.id });
      // the corners and sides of an area, of each of a point's shown outline parts (named by its place)
      const rings = kind === 'area' ? [{ cs: el.points, ref: {} }] : kind === 'point' ? el.parts.map((part, k) => (part.radius || !part.shown ? null : { cs: verticesOf({ kind, el }, k), ref: { part: k }, ellipse: part.kind === 'ellipse' })).filter(Boolean) : [];
      for (const { cs, ref, ellipse } of rings) {
        cs.forEach((c, i) => {
          if (!ellipse) vertex(c, { element: el.id, ...ref, vertex: i }); // an ellipse's samples are no corners: its edge
          edge(c, cs[(i + 1) % cs.length], (t) => ({ element: el.id, ...ref, edge: i, at: +t.toFixed(6) }), el.id);
        });
      }
      if (kind !== 'line') continue;
      el.vertices.forEach((v, i) => vertex(v.position, { element: el.id, vertex: i + 1 })); // its places: 0 its start
      for (const key of ['start', 'end']) if (!el[key].element) vertex(el[key].position, { end: { lineId: el.id, key } });
      // its legs, as drawn (a curve's samples), each sample segment knowing its leg and how far along it
      if (!edgesOf(el)) continue;
      const tr = lineTrace(doc, el), { from } = steps(tr.coords);
      for (let i = 1; i < tr.coords.length; i++) {
        const a = tr.coords[i - 1], b = tr.coords[i], start = from[i - 1], s = from[i] - start;
        edge(a, b, (t) => {
          const d = start + t * s;
          let k = tr.legs.length - 1;
          while (k > 0 && tr.at[k] > d + 1e-6) k--;
          return { element: el.id, edge: k, at: +Math.min(1, Math.max(0, tr.legs[k] ? (d - tr.at[k]) / tr.legs[k] : 0)).toFixed(6) };
        }, el.id);
      }
    }
  }
  const unproject = (q) => view.unproject(q);
  if (vertices.length) {
    const v = vertices.reduce((x, y) => (y.d < x.d ? y : x));
    return { position: [...v.position], kind: 'vertex', to: v.to };
  }
  // crossings of two edges near p (not two pieces of one line meeting end to end)
  let best = null;
  for (let i = 0; i < edges.length; i++) {
    for (let k = i + 1; k < edges.length; k++) {
      const e = edges[i], f = edges[k];
      if (e.id === f.id && (e.B === f.A || e.A === f.B || same(e.B, f.A) || same(e.A, f.B))) continue;
      const x = crossing(e.A, e.B, f.A, f.B), d = x && Math.hypot(x[0] - p[0], x[1] - p[1]);
      if (x && d <= radius && (!best || d < best.d)) best = { d, x };
    }
  }
  if (best) return { position: unproject(best.x), kind: 'crossing', to: null };
  if (edges.length) {
    const e = edges.reduce((x, y) => (y.d < x.d ? y : x));
    return { position: unproject(e.q), kind: 'edge', to: e.to(e.t) };
  }
  return null;
}
const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

// Shift: the position p turned about from so that the leg from → p is a whole number of STEP degrees
// from the bearing of the leg before it (prev → from), or from north when there is none; its length
// kept.
export function stepped(from, p, prev = null) {
  const d = inverse(from, p);
  if (!d.s) return [...p];
  const base = prev ? inverse(prev, from).azi : 0;
  const a = base + Math.round((d.azi - base) / STEP) * STEP;
  return destination(from, a, d.s);
}

// where a line's end would be, for the vertex at index k of anchors (positions): the one before it
// and the one before that (for Shift), as a vertex dragged sees them
export function neighbours(positions, k) {
  if (k > 0) return { from: positions[k - 1], prev: positions[k - 2] ?? null };
  return { from: positions[1] ?? null, prev: positions[2] ?? null };
}
