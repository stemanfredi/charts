// Geodesics on the WGS 84 ellipsoid (GeographicLib, Karney 2013), for whatever measures or draws
// real-world lengths: the drawing tools, measurements included, use this one module, so a drawn value
// and a measured one are the same number. Lines are densified geodesics, so what you see is the path the numbers
// describe. Positions are [lon, lat], distances metres, azimuths degrees clockwise from true north.

import { unrollTo, norm180, signedArea2 } from './geo.js';

// GeographicLib is a classic script on the page (window.geodesic); tests set globalThis.geodesic
export const G = globalThis.geodesic.Geodesic.WGS84;
const { STANDARD, DISTANCE_IN, LONG_UNROLL } = globalThis.geodesic.Geodesic;
const MASK = STANDARD | DISTANCE_IN | LONG_UNROLL; // DISTANCE_IN: positions along a line by distance
// p → q: { s: length, azi: azimuth at p }
export function inverse(p, q) {
  const g = G.Inverse(p[1], p[0], q[1], q[0]);
  return { s: g.s12, azi: g.azi1 };
}
// a polyline's geodesic length, m; perimeterOf: a ring's, closed back to its first point
export const lengthOf = (pts) => pts.reduce((t, p, i) => (i ? t + inverse(pts[i - 1], p).s : 0), 0);
export const perimeterOf = (pts) => lengthOf([...pts, pts[0]]);
// the point s metres from p at azimuth azi, its longitude continuous with p's
export function destination(p, azi, s) {
  const d = G.Direct(p[1], p[0], azi, s, MASK);
  return [d.lon2, d.lat2];
}

// a local planar frame about a point (metres east, north), scaled on the ellipsoid there: for what
// spans a few tens of km at most
export function localFrame([lon0, lat0]) {
  const k = inverse([lon0, lat0], [lon0 + 1e-4, lat0]).s / 1e-4, m = inverse([lon0, lat0], [lon0, lat0 + 1e-4]).s / 1e-4;
  // the short way round, across ±180° too
  return { to: ([lon, lat]) => [norm180(lon - lon0) * k, (lat - lat0) * m], from: ([x, y]) => [norm180(lon0 + x / k), lat0 + y / m] };
}
// Points along the geodesic p→q, every ≤ step metres, with continuous longitude.
export function densify(p, q, step = 20000) {
  const line = G.InverseLine(p[1], p[0], q[1], q[0], MASK);
  const n = Math.max(1, Math.ceil(line.s13 / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const r = line.Position((line.s13 * i) / n, MASK);
    out.push([r.lon2, r.lat2]);
  }
  return out;
}
const unrollFrom = (ref, pts) => pts.map((p) => unrollTo(ref, p)); // longitudes continuous across the antimeridian
// the densified geodesic polyline through pts (closed: back to the first)
export function pathOf(pts, closed, step) {
  const ring = closed ? [...pts, pts[0]] : pts;
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const seg = unrollFrom(out.length ? out[out.length - 1] : ring[i], densify(ring[i], ring[i + 1], step));
    out.push(...(i ? seg.slice(1) : seg));
  }
  return out;
}
// the circle of radius r about c, as a closed ring of n + 1 points
export function circle(c, r, n = 128) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const d = G.Direct(c[1], c[0], (360 * i) / n, r, MASK);
    pts.push([d.lon2, d.lat2]);
  }
  return pts;
}
// the sector of radius r about c, centred on azimuth bearing, aperture degrees wide: a closed ring
// from the centre along one edge, round the arc and back
export function sector(c, r, bearing, aperture) {
  const n = Math.max(8, Math.ceil((128 * aperture) / 360));
  const pts = [c];
  for (let i = 0; i <= n; i++) pts.push(destination(c, bearing - aperture / 2 + (aperture * i) / n, r));
  pts.push(c);
  return pts;
}
// A rectangle's corners, length × width about c, its length along azimuth bearing: at the half
// diagonal from the centre (front right, back right, back left, front left)
export function cornersOf(c, bearing, length, width) {
  const half = Math.hypot(length, width) / 2, off = (Math.atan2(width, length) * 180) / Math.PI;
  return [bearing + off, bearing + 180 - off, bearing + 180 + off, bearing - off].map((a) => destination(c, a, half));
}
// whether a circle of radius r about c reaches either pole (it cannot then be drawn as a polygon)
export function reachesPole(c, r) {
  return inverse(c, [c[0], c[1] >= 0 ? 90 : -90]).s <= r;
}
// a closed ring counter-clockwise, as GeoJSON wants its outer rings (RFC 7946)
export const ccw = (ring) => (signedArea2(ring) < 0 ? ring.slice().reverse() : ring);
// the geodesic area of a closed ring, m² (its sign ignored)
export function areaOf(ring) {
  const poly = G.Polygon(false);
  for (const p of ring.slice(0, -1)) poly.AddPoint(p[1], p[0]);
  return Math.abs(poly.Compute(false, true).area);
}
