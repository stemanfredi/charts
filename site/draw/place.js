// What the Point and Shape tools place (docs/drawing-ui.md §9). The Shape tool's kinds are presets
// built in, as the user's are: a symbol and parts, placed in two clicks. Pure: it changes the document
// given; the caller keeps the undo step.

import { addPoint, nextName, idsOf, makePart, pointKind, reachOf, POINT_KIND_NAME, OUTLINES } from './document.js';
import { OUTLINE_NAME } from './outlines.js';
import { norm360 } from '../geo.js';

// The built-in presets, by the Shape tool's kind: a circle of 1 km; rings at 1, 2 and 3 km (the first
// filled); a sector of 1 km, 90° wide; an outline (a triangle equilateral, 100 m a side; the others
// 100 × 50 m).
const outline = (kind) => makePart(kind, kind === 'triangle' ? { length: 50 * Math.sqrt(3), width: 100 } : {});
export const BUILT_IN = {
  circle: { symbol: 'none', parts: [makePart('circle', { radius: 1000 })] },
  rings: { symbol: 'none', parts: [1000, 2000, 3000].map((radius, i) => ({ ...makePart('circle', { radius }), fill: !i })) },
  sector: { symbol: 'none', parts: [makePart('sector', { radius: 1000, aperture: 90 })] },
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
// preset. size (the Shape tool's second click): { d (metres from the centre), azi }: a built-in's
// largest part reaches d, every part scaled with it, facing azi; a preset of the user's keeps its size,
// facing azi. Without it: the preset's own size, facing north.
export function placeKind(doc, p, kind, presets, size = null) {
  const taken = idsOf(doc), azi = size ? +norm360(size.azi).toFixed(4) : 0;
  const mine = kind?.startsWith('preset:') && presets.find((x) => x.name === kind.slice(7));
  if (mine) {
    return addPoint(doc, p, { ...structuredClone(mine.point), bearing: azi, name: nextName(doc, 'point', mine.name.replace(/[^\w ]+/g, '').trim() || 'Point'),
      properties: [{ key: 'preset', value: mine.name }] }, taken);
  }
  const built = BUILT_IN[kind];
  if (!built) return addPoint(doc, p, { parts: [] }, taken); // a symbol
  const parts = structuredClone(size?.d > 0 ? scaled(built.parts, size.d) : built.parts);
  const el = addPoint(doc, p, { symbol: built.symbol, parts, bearing: azi, properties: [{ key: 'preset', value: builtInName(kind) }] }, taken);
  el.name = nameByLook(doc, el);
  return el;
}
