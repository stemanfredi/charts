// Direct manipulation (docs/drawing-ui.md §5): the geometry of each drag, as the new values of the
// fields the inspector already edits. Pure: no map, no DOM. Positions [lon, lat], distances metres,
// angles degrees true.

import { inverse, destination, localFrame } from '../geodesy.js';
import { mercator, unmercator, D2R, norm360 } from '../geo.js';


// a radius: the pointer's distance from the centre
export const radiusTo = (centre, p) => inverse(centre, p).s;
// a bearing: the pointer's azimuth from the centre; snap (degrees) rounds it
export function bearingTo(centre, p, snap = 0) {
  const a = norm360(inverse(centre, p).azi);
  return snap ? norm360(Math.round(a / snap) * snap) : a;
}
// A sector with one end of its arc dragged to the pointer, the other end kept: { bearing, aperture }.
// edge −0.5: the end anticlockwise of the bearing (where the arc starts, clockwise); 0.5: the other.
// The arc runs clockwise from start to end, 1–359° (past the kept end it wraps round); snap (degrees)
// rounds the dragged end's bearing.
export function sectorEdgeTo(centre, bearing, aperture, edge, p, snap = 0) {
  const at = bearingTo(centre, p, snap);
  const start = edge < 0 ? at : bearing - aperture / 2, end = edge < 0 ? bearing + aperture / 2 : at;
  const ap = Math.round(Math.min(359, Math.max(1, norm360(end - start))) * 10) / 10;
  return { bearing: +norm360((edge < 0 ? end - ap : start) + ap / 2).toFixed(4), aperture: ap };
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

// A rectangle with one side dragged to the pointer, the opposite side kept (aboutCentre: the centre
// kept, both sides moving): side i runs from corner i to corner i + 1 (geodesy.rectangle's order:
// 0 the right side, 1 the back, 2 the left, 3 the front). Returns { center, length, width }.
export function resizeSide(shape, i, p, { aboutCentre = false } = {}) {
  const f = localFrame(shape.center), v = f.to(p), b = shape.bearing * D2R;
  const u = [Math.sin(b), Math.cos(b)], n = [Math.cos(b), -Math.sin(b)]; // along the bearing; across it, to the right
  const a = v[0] * u[0] + v[1] * u[1], c = v[0] * n[0] + v[1] * n[1];
  const along = i === 1 || i === 3, at = along ? a : c, half = (along ? shape.length : shape.width) / 2;
  const sign = i === 0 || i === 3 ? 1 : -1; // the right side and the front lie at +half, the left and the back at −half
  const size = Math.max(1, aboutCentre ? 2 * Math.abs(at) : sign * at + half);
  const shift = aboutCentre ? 0 : (at - sign * half) / 2; // the centre: halfway between the kept side (at −sign · half) and the new one (at)
  const d = along ? u : n, center = aboutCentre ? shape.center : f.from([shift * d[0], shift * d[1]]);
  return along ? { center, length: size, width: shape.width } : { center, length: shape.length, width: size };
}

// A position moved by the pointer's displacement on screen (in the projection): from start to now
export function moved(pos, start, now) {
  const a = mercator(start), b = mercator(now), q = mercator(pos);
  return unmercator([q[0] + b[0] - a[0], q[1] + b[1] - a[1]]);
}

// where a rectangle's rotate stalk ends: beyond the middle of its front edge, along its bearing, by
// gap metres
export function rotateHandle(shape, gap) {
  return destination(shape.center, shape.bearing, shape.length / 2 + gap);
}
