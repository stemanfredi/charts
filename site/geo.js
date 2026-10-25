// Web Mercator (EPSG:3857), as the map and its tiles use it: the sphere, lon/lat ↔ metres, tile edges.

export const R = 6378137; // the sphere's radius, metres
export const CIRC = 2 * Math.PI * R; // the world's width, metres
export const MAX_LAT = 85.05112878; // the latitude the map stops at (a square world)
export const D2R = Math.PI / 180;
export const TILE = 256; // a raster tile's edge, pixels (the DEM and depth tiles)
// an angle in degrees as 0 ≤ a < 360
export const norm360 = (a) => ((a % 360) + 360) % 360;
// the nearest place on the planar segment a–b to p: { q, t (0–1 along it), d }
export function nearestOnSegment(a, b, p) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { q, t, d: Math.hypot(q[0] - p[0], q[1] - p[1]) };
}
// the position q with its longitude moved by whole turns to be continuous with p's (across the antimeridian)
export const unrollTo = (p, q) => [q[0] + 360 * Math.round((p[0] - q[0]) / 360), q[1]];
// metres on the ground per screen pixel at a zoom (512 px tiles), at a latitude
export const metresPerPixel = (zoom, lat = 0) => (CIRC * Math.cos(lat * D2R)) / (512 * 2 ** zoom);
// lon/lat → EPSG:3857 metres, and back
export const mercator = ([lng, lat]) => [R * lng * D2R, R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2))];
export const unmercator = ([x, y]) => [x / R / D2R, 90 - (360 / Math.PI) * Math.atan(Math.exp(-y / R))];
// Web Mercator y (0 at the top of the world, 1 at the bottom) → latitude
export const latOf = (t) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * t))) * 180) / Math.PI;
// lon/lat → its place in the tile grid of zoom z, fractional: { x, y } (the tile Math.floor(x), Math.floor(y))
export function tileXY(lng, lat, z) {
  const [mx, my] = mercator([lng, lat]), n = 2 ** z;
  return { x: ((((mx / CIRC + 0.5) % 1) + 1) % 1) * n, y: (0.5 - my / CIRC) * n };
}
// tile z/x/y → [west, south, east, north], degrees
export function tileBounds(z, x, y) {
  const n = 2 ** z;
  return [(x / n) * 360 - 180, latOf((y + 1) / n), ((x + 1) / n) * 360 - 180, latOf(y / n)];
}
