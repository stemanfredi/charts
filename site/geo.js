// Web Mercator (EPSG:3857), as the map and its tiles use it: the sphere, lon/lat ↔ metres, tile edges.

export const R = 6378137; // the sphere's radius, metres
export const CIRC = 2 * Math.PI * R; // the world's width, metres
const D2R = Math.PI / 180;
// lon/lat → EPSG:3857 metres, and back
export const mercator = ([lng, lat]) => [R * lng * D2R, R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2))];
export const unmercator = ([x, y]) => [x / R / D2R, 90 - (360 / Math.PI) * Math.atan(Math.exp(-y / R))];
// Web Mercator y (0 at the top of the world, 1 at the bottom) → latitude
export const latOf = (t) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * t))) * 180) / Math.PI;
// tile z/x/y → [west, south, east, north], degrees
export function tileBounds(z, x, y) {
  const n = 2 ** z;
  return [(x / n) * 360 - 180, latOf((y + 1) / n), ((x + 1) / n) * 360 - 180, latOf(y / n)];
}
