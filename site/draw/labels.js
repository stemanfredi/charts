// Labels (docs/drawing-format.md §7.7): where each one points (its position; linked, what it points
// at), its text with the live values filled in, and what the map draws for it: the text, a leader line
// from the text to where it points, the leader's end. The text sits at an offset in screen pixels from there, so the map
// gives the projection (view.project, view.unproject) and the size of a text (view.measure). Pure
// otherwise: no map, no DOM.

import { isShown, label, lookOf, followedPart, linkFrom } from './document.js';
import { resolve, verticesOf } from './attach.js';
import { lineTrace } from './lines.js';
import { areaOf, pathOf, perimeterOf } from '../geodesy.js';
import { fmtArea, fmtBrg, fmtDist } from '../format.js';

const SIZE_PX = { small: 11, medium: 13, large: 16 };
const PAD = { halo: 3, box: 6 }; // px around the text a leader stops short of (a box's padding and border)

// The live values a label can show of what it points at (to: its link's target, or none), each as
// text, or undefined where it does not apply: name; length (its line's, or the side it is on); along (from its line's start); bearing (of
// the side or leg it is on); radius (a point's filled one); area and perimeter (a closed line's, a
// shape's outline's).
export const TOKENS = ['name', 'length', 'along', 'bearing', 'radius', 'area', 'perimeter'];
export function labelValues(doc, to, units = 'km') {
  const at = to && resolve(doc, to), x = at?.element;
  if (!x) return {};
  const ring = x.kind === 'point' ? verticesOf(x, to.part) : null; // its outline part (pointed at, else its largest)
  const tr = x.el.closed ? lineTrace(doc, x.el) : null;
  const round = x.kind === 'point' ? x.el.parts[followedPart(x.el)] : null; // its filled circle, else its first
  const len = at.edge && x.kind !== 'line' ? at.edge.length : at.length;
  return {
    name: x.el.name || label(x.kind, x.el),
    length: len === undefined ? undefined : fmtDist(len, units),
    along: at.along === undefined ? undefined : fmtDist(at.along, units),
    bearing: at.edge ? fmtBrg(at.edge.bearing) : undefined,
    radius: round ? fmtDist(round.radius, units) : undefined,
    area: ring ? fmtArea(areaOf(pathOf(ring, true)), units) : tr ? fmtArea(tr.area, units) : undefined,
    perimeter: ring ? fmtDist(perimeterOf(ring), units) : tr ? fmtDist(tr.length, units) : undefined,
  };
}
// A label's text, its {name}, {length}, {along}, {bearing}, {radius}, {area}, {perimeter} filled in (in
// the display units); a value that does not apply is left empty.
export function labelText(doc, a, units = 'km') {
  const v = labelValues(doc, linkFrom(doc, a.id)?.to, units);
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
// from where it points, its leader, its end (an arrow head turned along the leader, or a dot); for the
// selected ones, a handle where it points when that can be dragged (free, or on an edge or a leg).
// view: { project, unproject, measure(text, px) → [w, h] }; units: the display units; texts: each
// label's text by id, filled as read (kept by the caller while the drawing and the units stay as they
// are: the map moving changes no text).
export function labelFeatures(doc, view, sel = new Set(), hover = null, units = 'km', texts = new Map()) {
  const out = [];
  const pt = (properties, coordinates) => out.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });
  for (const a of doc.labels) {
    if (!isShown(doc, a)) continue;
    const to = linkFrom(doc, a.id)?.to, on = to && resolve(doc, to)?.element;
    if (on && !isShown(doc, on.el)) continue; // a hidden element's label is hidden with it
    if (!texts.has(a.id)) texts.set(a.id, labelText(doc, a, units));
    const text = texts.get(a.id);
    const lt = lookOf(doc, a).text, px = SIZE_PX[lt.size], c = lt.color, mark = sel.has(a.id) ? 'sel' : hover === a.id ? 'hover' : '';
    const p = view.project(a.position), t = [p[0] + a.offset[0], p[1] + a.offset[1]];
    if (text.trim()) pt({ id: a.id, kind: 'label', text, px, c, box: lt.background === 'box' ? 1 : 0, mark }, view.unproject(t));
    if (a.leader !== 'none') {
      const [w, h] = text.trim() ? view.measure(text, px) : [0, 0], pad = PAD[lt.background];
      const from = text.trim() ? leaderFrom(t, p, [w / 2 + pad, h / 2 + pad]) : t;
      if (from && Math.hypot(p[0] - from[0], p[1] - from[1]) > 2) {
        out.push({ type: 'Feature', properties: { id: a.id, kind: 'leader', c }, geometry: { type: 'LineString', coordinates: [view.unproject(from), a.position] } });
        pt({ id: a.id, kind: 'lend', c, rot: (Math.atan2(p[0] - from[0], from[1] - p[1]) * 180) / Math.PI }, a.position);
      }
    }
    if (sel.has(a.id) && (!to || to.edge != null)) pt({ id: a.id, kind: 'lhandle', role: 'anchor', ref: '' }, a.position);
  }
  return out;
}

