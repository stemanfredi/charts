// What the Point and Shape tools place (docs/drawing-ui.md §9). The Shape tool's kinds are presets
// built in, as the user's are: a symbol and parts, placed in two clicks. Pure: it changes the document
// given; the caller keeps the undo step.

import { addPoint, nextName, idsOf, makePart, pointKind, reachOf, POINT_KIND_NAME, OUTLINES } from './document.js';
import { OUTLINE_NAME } from './outlines.js';
import { inverse } from '../geodesy.js';
import { unrollTo } from '../geo.js';

// The built-in presets, by the Shape tool's kind: a circle of 1 km; rings at 1, 2 and 3 km (the first
// filled); a sector of 1 km, 90° wide, and an arc as its edge; an outline (a triangle equilateral, 100 m a side; the others
// 100 × 50 m).
const outline = (kind) => makePart(kind, kind === 'triangle' ? { length: 50 * Math.sqrt(3), width: 100 } : {});
export const BUILT_IN = {
  circle: { symbol: 'none', parts: [makePart('circle', { radius: 1000 })] },
  rings: { symbol: 'none', parts: [1000, 2000, 3000].map((radius, i) => ({ ...makePart('circle', { radius }), fill: !i })) },
  sector: { symbol: 'none', parts: [makePart('sector', { radius: 1000, aperture: 90 })] },
  arc: { symbol: 'none', parts: [makePart('arc', { radius: 1000, aperture: 90 })] },
  ...Object.fromEntries(OUTLINES.map((k) => [k, { symbol: 'none', parts: [outline(k)] }])),
};
// what a built-in kind is called: "Circle", "Rings", "Rectangle"…
export const builtInName = (kind) => POINT_KIND_NAME[kind] ?? OUTLINE_NAME[kind];
// the name a new point gets after what it is: "Circle 2", "Sector 1", "Rectangle 3"…
export const nameByLook = (doc, el) => nextName(doc, 'point', builtInName(pointKind(el)) ?? 'Point');

// A preset's parts scaled so that the largest reaches d (metres: a round part's radius, an outline's
// half length), every other one with it
export function scaled(parts, d) {
  const k = d / Math.max(...parts.map(reachOf));
  const r3 = (v) => Math.round(v * k * 1000) / 1000;
  return parts.map((p) => (p.radius ? { ...p, radius: r3(p.radius) } : { ...p, length: r3(p.length), width: r3(p.width) }));
}

// What the Point or the Shape tool places at p, by the tool's kind: a built-in preset (Shape), a preset
// of the user's ('preset:<name>'), else a symbol (Point). Each remembers its preset in the property
// preset, and faces north: its bearing is set afterwards (the stalk, the inspector), so
// that a shape does not swing while it is sized. d (the Shape tool's second click, metres from the
// centre): a built-in's largest part reaches it, every part scaled with it; 0: its own size. A
// preset of the user's keeps its size.
export function placeKind(doc, p, kind, presets, d = 0) {
  const taken = idsOf(doc);
  const mine = kind?.startsWith('preset:') && presets.find((x) => x.name === kind.slice(7));
  if (mine) {
    return addPoint(doc, p, { ...structuredClone(mine.point), bearing: 0, name: nextName(doc, 'point', mine.name.replace(/[^\w ]+/g, '').trim() || 'Point'),
      properties: [{ key: 'preset', value: mine.name }] }, taken);
  }
  const built = BUILT_IN[kind];
  if (!built) return addPoint(doc, p, { parts: [] }, taken); // a symbol
  const parts = structuredClone(d > 0 ? scaled(built.parts, d) : built.parts);
  const el = addPoint(doc, p, { symbol: built.symbol, parts, bearing: 0, properties: [{ key: 'preset', value: builtInName(kind) }] }, taken);
  el.name = nameByLook(doc, el);
  return el;
}

// The kinds drawn corner to corner (their box): the first click one corner, the second the opposite
// one; square (Shift): as long as wide, the larger of the two
export const BOX = new Set(['rectangle', 'ellipse']);
export function placeBox(doc, a, b, kind, square = false) {
  b = unrollTo(a, b); // across the antimeridian: the box between them, not round the world
  const centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let length = inverse([centre[0], a[1]], [centre[0], b[1]]).s, width = inverse([a[0], centre[1]], [b[0], centre[1]]).s; // north-south, east-west
  if (square) length = width = Math.max(length, width);
  const el = placeKind(doc, centre, kind, []);
  const r3 = (v) => Math.round(Math.max(v, 0.001) * 1000) / 1000;
  Object.assign(el.parts[0], { length: r3(length), width: r3(width) });
  return el;
}
