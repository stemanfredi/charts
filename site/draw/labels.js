// Labels (docs/drawing-format.md §7.7): where each one points (its anchor), its text with the
// live values filled in, and what the map draws for it: the text, a leader line from the text to the
// anchor, the leader's end. The text sits at an offset in screen pixels from the anchor, so the map
// gives the projection (view.project, view.unproject) and the size of a text (view.measure). Pure
// otherwise: no map, no DOM.

import { isShown, label, labelColour, lookOf, followedPart } from './document.js';
import { resolve, verticesOf } from './attach.js';
import { fmtDist, fmtArea, fmtBrg, areaOf, pathOf, perimeterOf } from '../geodesy.js';

export const SIZE_PX = { small: 11, medium: 13, large: 16 };
const PAD = { halo: 3, box: 6 }; // px around the text a leader stops short of (a box's padding and border)



// The live values a label can show of what it points at, each as text, or undefined where it does not
// apply: name; length (its line's, or the side it is on); along (from its line's start); bearing (of
// the side or leg it is on); radius (a point's filled one); area and perimeter (an area's, a shape's
// outline's).
export const TOKENS = ['name', 'length', 'along', 'bearing', 'radius', 'area', 'perimeter'];
export function labelValues(doc, anchor, units = 'km') {
  const at = resolve(doc, anchor), x = at?.element;
  if (!x) return {};
  const ring = x.kind === 'area' || x.kind === 'point' ? verticesOf(x, anchor.part) : null; // a point's: its outline part (pointed at, else its largest)
  const round = x.kind === 'point' ? x.el.parts[followedPart(x.el)] : null; // its filled circle, else its first
  const len = at.edge && x.kind !== 'line' ? at.edge.length : at.length;
  return {
    name: x.el.name || label(x.kind, x.el),
    length: len === undefined ? undefined : fmtDist(len, units),
    along: at.along === undefined ? undefined : fmtDist(at.along, units),
    bearing: at.edge ? fmtBrg(at.edge.bearing) : undefined,
    radius: round ? fmtDist(round.radius, units) : undefined,
    area: ring ? fmtArea(areaOf(pathOf(ring, true)), units) : undefined,
    perimeter: ring ? fmtDist(perimeterOf(ring), units) : undefined,
  };
}
// A label's text, its {name}, {length}, {along}, {bearing}, {radius}, {area}, {perimeter} filled in (in
// the display units); a value that does not apply is left empty.
export function labelText(doc, a, units = 'km') {
  const v = labelValues(doc, a.anchor, units);
  return a.text.replace(new RegExp(`\\{(${TOKENS.join('|')})\\}`, 'g'), (_, k) => v[k] ?? '');
}

// Where a leader leaves the text: the point where the line from the text's centre t to the anchor p
// (screen px) crosses the text's box, half its size half ([w, h], padding included), or null when the
// anchor is inside the box (no leader to draw).
export function leaderFrom(t, p, half) {
  const dx = p[0] - t[0], dy = p[1] - t[1];
  const k = Math.max(Math.abs(dx) / half[0], Math.abs(dy) / half[1]);
  if (k <= 1) return null;
  return [t[0] + dx / k, t[1] + dy / k];
}

// The map's features for the labels (the "drawlabel" source): each shown label's text at its offset
// from its anchor, its leader, its end (an arrow head turned along the leader, or a dot); for the
// selected ones, a handle at an anchor that can be dragged (a free one, or one along a line).
// view: { project, unproject, measure(text, px) → [w, h] }; units: the display units.
export function labelFeatures(doc, view, sel = new Set(), hover = null, units = 'km') {
  const out = [];
  const pt = (properties, coordinates) => out.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });
  for (const a of doc.labels) {
    if (!isShown(doc, a)) continue;
    const at = resolve(doc, a.anchor);
    if (!at || (at.element && !isShown(doc, at.element.el))) continue; // a hidden element's label is hidden with it
    const text = labelText(doc, a, units);
    const lt = lookOf(doc, a).text, px = SIZE_PX[lt.size], c = labelColour(doc, a), mark = sel.has(a.id) ? 'sel' : hover === a.id ? 'hover' : '';
    const p = view.project(at.position), t = [p[0] + a.offset[0], p[1] + a.offset[1]];
    if (text.trim()) pt({ id: a.id, kind: 'label', text, px, c, box: lt.background === 'box' ? 1 : 0, mark }, view.unproject(t));
    if (a.leader !== 'none') {
      const [w, h] = text.trim() ? view.measure(text, px) : [0, 0], pad = PAD[lt.background];
      const from = text.trim() ? leaderFrom(t, p, [w / 2 + pad, h / 2 + pad]) : t;
      if (from && Math.hypot(p[0] - from[0], p[1] - from[1]) > 2) {
        out.push({ type: 'Feature', properties: { id: a.id, kind: 'leader', c }, geometry: { type: 'LineString', coordinates: [view.unproject(from), at.position] } });
        if (a.leader !== 'line') pt({ id: a.id, kind: 'lend', end: a.leader, c, rot: (Math.atan2(p[0] - from[0], from[1] - p[1]) * 180) / Math.PI }, at.position);
      }
    }
    if (sel.has(a.id) && (!a.anchor.element || a.anchor.edge != null)) pt({ id: a.id, kind: 'lhandle', role: 'anchor', ref: '' }, at.position);
  }
  return out;
}

