// Direct manipulation (docs/drawing-ui.md §5): the geometry of each drag, as the new values of the
// fields the inspector already edits. Pure: no map, no DOM. Positions [lon, lat], distances metres,
// angles degrees true.

import { inverse } from '../geodesy.js';
import { mercator, unmercator, norm360 } from '../geo.js';

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

// A position moved by the pointer's displacement on screen (in the projection): from start to now
export function moved(pos, start, now) {
  const a = mercator(start), b = mercator(now), q = mercator(pos);
  return unmercator([q[0] + b[0] - a[0], q[1] + b[1] - a[1]]);
}
