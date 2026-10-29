// Shape outlines (docs/drawing-format.md §7.5): each a fixed silhouette in a unit frame, stretched to a
// shape's length (along its bearing) and width (across it). Pure: no map, no DOM.

import { destination, cornersOf, pathOf } from '../geodesy.js';
export const OUTLINE_NAME = { rectangle: 'Rectangle', triangle: 'Triangle', ellipse: 'Ellipse', 'aerial-vehicle': 'Aerial vehicle', 'surface-vehicle': 'Surface vehicle', 'underwater-vehicle': 'Underwater vehicle' };

const R2D = 180 / Math.PI;
// n + 1 points of a curve f(t), t from 0 to 1
const curve = (f, n) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
const q = Math.PI / 2;
// The right half of each silhouette, [u, v]: u across (0 the axis … ½ the right side), v along (½ the
// front … −½ the back), from the front on the axis to the back on the axis
const RIGHT = {
  // a pointed bow curving out to full beam over the front 30 %; straight sides; a flat stern
  'surface-vehicle': [...curve((s) => [0.5 * Math.sin(q * s), 0.5 - 0.3 * s], 16), [0.5, -0.44], [0.485, -0.485], [0.44, -0.5], [0, -0.5]],
  // a rocket: a smoothly rounded nose over the front fifth, a straight body to 0.4 wide, fins a little
  // wider than the body over the last fifth
  'underwater-vehicle': [...curve((s) => [0.4 * Math.sin(q * s), 0.3 + 0.2 * Math.cos(q * s)], 12), [0.4, -0.32], [0.5, -0.5], [0.4, -0.5], [0, -0.5]],
  // a slim body with a rounded nose; swept wings; small tail wings
  'aerial-vehicle': [...curve((s) => [0.05 * Math.sin(q * s), 0.42 + 0.08 * Math.cos(q * s)], 8),
    [0.05, 0.1], [0.5, -0.12], [0.5, -0.2], [0.05, -0.08], [0.05, -0.36], [0.18, -0.44], [0.18, -0.5], [0, -0.5]],
};

// A silhouette's points in the unit frame, clockwise seen from above, not closed: [[u, v]]
export function unitOutline(outline) {
  if (outline === 'rectangle') return [[0.5, 0.5], [0.5, -0.5], [-0.5, -0.5], [-0.5, 0.5]];
  if (outline === 'triangle') return [[0, 0.5], [0.5, -0.5], [-0.5, -0.5]]; // isosceles, its apex at the front
  if (outline === 'ellipse') return Array.from({ length: 72 }, (_, i) => [0.5 * Math.sin((i * Math.PI) / 36), 0.5 * Math.cos((i * Math.PI) / 36)]);
  const right = RIGHT[outline];
  // the left half: the right one mirrored, back to front, without the points on the axis twice
  return [...right, ...right.slice(1, -1).reverse().map(([u, v]) => [-u, v])];
}

// A shape's outline on the ellipsoid: { ring (closed, its edges geodesics), corners (of its bounding
// rectangle: front right, back right, back left, front left, as outlines.js's rectangle) }. Each point is
// a geodesic destination from the centre, as the rectangle's corners are.
// Kept by what it depends on, as lines' traces are: an unchanged shape is not computed again (callers
// read it, never change it). points: its own corners (outlinePoints).
const outlines = new Map();
export function outlineOf(center, bearing, length, width, outline = 'rectangle') {
  const key = `${center}|${bearing}|${length}|${width}|${outline}`;
  let o = outlines.get(key);
  if (!o) {
    const corners = cornersOf(center, bearing, length, width);
    const points = outline === 'rectangle' ? corners : unitOutline(outline).map(([u, v]) => destination(center, bearing + Math.atan2(u * width, v * length) * R2D, Math.hypot(u * width, v * length)));
    o = { corners, points, ring: pathOf(points, true, 1000) };
    if (outlines.size > 5000) outlines.clear();
    outlines.set(key, o);
  }
  return o;
}
// An outline's own corners on the ellipsoid, in order, not closed: a rectangle's four (as
// outlines.js's rectangle), a silhouette's points. Its edges join each to the next, the last to the first.
export const outlinePoints = (...args) => outlineOf(...args).points;
