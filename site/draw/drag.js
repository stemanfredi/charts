// Direct manipulation (docs/drawing-ui.md §5): the geometry of each drag, as the new values of the
// fields the inspector already edits. Pure: no map, no DOM. Positions [lon, lat], distances metres,
// angles degrees true.

import { inverse, destination, localFrame } from '../geodesy.js';
import { mercator, unmercator, D2R, norm360 as norm, unrollTo } from '../geo.js';


// a radius: the pointer's distance from the centre
export const radiusTo = (centre, p) => inverse(centre, p).s;
// a bearing: the pointer's azimuth from the centre; snap (degrees) rounds it
export function bearingTo(centre, p, snap = 0) {
  const a = norm(inverse(centre, p).azi);
  return snap ? norm(Math.round(a / snap) * snap) : a;
}
// A sector with one end of its arc dragged to the pointer, the other end kept: { bearing, aperture }.
// edge −0.5: the end anticlockwise of the bearing (where the arc starts, clockwise); 0.5: the other.
// The arc runs clockwise from start to end, 1–359° (past the kept end it wraps round); snap (degrees)
// rounds the dragged end's bearing.
export function sectorEdgeTo(centre, bearing, aperture, edge, p, snap = 0) {
  const at = bearingTo(centre, p, snap);
  const start = edge < 0 ? at : bearing - aperture / 2, end = edge < 0 ? bearing + aperture / 2 : at;
  const ap = Math.round(Math.min(359, Math.max(1, norm(end - start))) * 10) / 10;
  return { bearing: +norm((edge < 0 ? end - ap : start) + ap / 2).toFixed(4), aperture: ap };
}


// A rectangle resized by dragging its corner i (0 front right, 1 back right, 2 back left, 3 front
// left, as geodesy.rectangle) to p: the opposite corner stays put (aboutCentre: the centre does), its
// bearing unchanged; keep: proportions kept. Returns { center, length, width }.
export function resizeRect(shape, corners, i, p, { keep = false, aboutCentre = false } = {}) {
  const fixed = aboutCentre ? shape.center : corners[(i + 2) % 4];
  const f = localFrame(fixed), v = f.to(p), b = shape.bearing * D2R;
  const u = [Math.sin(b), Math.cos(b)], n = [Math.cos(b), -Math.sin(b)]; // along the bearing; across it, to the right
  let a = v[0] * u[0] + v[1] * u[1], c = v[0] * n[0] + v[1] * n[1];
  const k = aboutCentre ? 2 : 1;
  let length = Math.abs(a) * k, width = Math.abs(c) * k;
  if (keep) {
    const s = Math.max(length / shape.length, width / shape.width);
    length = shape.length * s; width = shape.width * s;
    a = Math.sign(a || 1) * length / k; c = Math.sign(c || 1) * width / k;
  }
  length = Math.max(1, length); width = Math.max(1, width);
  if (aboutCentre) return { center: shape.center, length, width };
  // the new centre: halfway from the fixed corner to the dragged one (along and across the bearing)
  return { center: f.from([(a * u[0] + c * n[0]) / 2, (a * u[1] + c * n[1]) / 2]), length, width };
}

// A Bézier handle from a pointer: metres east and north of its anchor, as the projection draws it
// (the inverse of lines.js: Mercator offsets times cos latitude at the anchor)
export function handleTo(anchor, p) {
  const A = mercator(anchor), P = mercator(unrollTo(anchor, p)), c = Math.cos(anchor[1] * D2R);
  return [+((P[0] - A[0]) * c).toFixed(3), +((P[1] - A[1]) * c).toFixed(3)];
}

// A position moved by the pointer's displacement on screen (in the projection): from start to now
export function moved(pos, start, now) {
  const a = mercator(start), b = mercator(now), q = mercator(pos);
  return unmercator([q[0] + b[0] - a[0], q[1] + b[1] - a[1]]);
}

// where a rectangle's rotate handle sits: beyond the middle of its front edge, along its bearing, by
// gap metres
export function rotateHandle(shape, gap) {
  return destination(shape.center, shape.bearing, shape.length / 2 + gap);
}
