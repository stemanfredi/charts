// What the unit tests share.
import assert from 'node:assert/strict';

// a and b within tol of each other (what: what they are, for the message)
export const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

const { addPoint, nextName, makePart } = await import('../../site/draw/document.js');
const { drawParts } = await import('../../site/draw/features.js');
// a point with one outline drawn to scale, no symbol
export const addShape = (doc, position, kind = 'rectangle') => addPoint(doc, position, { name: nextName(doc, 'point', 'Shape'), symbol: 'none', parts: [makePart(kind)] });
// what the map draws, all of it as one collection
export function drawFeatures(doc, sel = new Set(), hover = null, display = {}) {
  const p = drawParts(doc, sel, hover, display);
  return { type: 'FeatureCollection', features: [...p.base, ...p.zoom, ...p.marks] };
}
const { addLine, setLink } = await import('../../site/draw/document.js');
// a line from a through mids to b, each end a position, a point's ID (linked to its centre) or a
// target with its position ({ element, vertex…, position }: linked there)
export function lineFrom(doc, a, mids, b, opts = {}) {
  const at = (x) => (typeof x === 'string' ? doc.points.find((p) => p.id === x).position : Array.isArray(x) ? x : x.position);
  const s = addLine(doc, [at(a), ...mids, at(b)], opts);
  [a, b].forEach((x, k) => { if (!Array.isArray(x)) setLink(doc, s.id, k ? s.points.length - 1 : 0, typeof x === 'string' ? { element: x } : x); });
  return s;
}
// a closed line through the positions (an area)
export const addRing = (doc, pts, opts = {}) => addLine(doc, pts, { closed: true, ...opts });
const { linkFrom } = await import('../../site/draw/document.js');
// place i of element el (negative: from its end, -1 its last) as { position, to (its link's target, or null) }
export function placeIn(doc, el, i = 0) {
  const ps = el.points ?? [el.position], k = i < 0 ? ps.length + i : i;
  return { position: ps[k], to: linkFrom(doc, el.id, k)?.to ?? null };
}
