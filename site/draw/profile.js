// A line's elevation profile and its length along the surface (docs/drawing-ui.md §5): elevations
// sampled along the line as drawn (curves included), from what the map's shadings draw: the sea's
// depths (GEBCO, cut to the coastline) below sea level, the land's heights above it. Pure but for
// elevationAt, the app's reading of those.

import { pointsAlong } from './lines.js';
import { CIRC, D2R } from '../geo.js';

export const STEP_MIN = 30; // m: the land's elevation, about (38 m a pixel at its tiles' last zoom); closer adds nothing
export const MAX_SAMPLES = 1000;

// The zoom of the tiles to read for a step of `step` metres at latitude lat: a pixel about the
// step, at most maxZoom (the tiles' last)
export function zoomFor(step, lat, maxZoom) {
  const z = Math.round(Math.log2((CIRC * Math.cos(lat * D2R)) / (256 * step)));
  return Math.max(0, Math.min(maxZoom, z));
}

// The places to sample along a trace ({ coords, length }): MAX_SAMPLES, or every STEP_MIN metres on a
// short line, both ends included. [{ d (metres along), p ([lon, lat]) }]
export function samplesOf(trace) {
  const L = trace.length, step = Math.max(STEP_MIN, L / (MAX_SAMPLES - 1)), n = Math.max(1, Math.ceil(L / step));
  const ds = Array.from({ length: n + 1 }, (_, i) => (L * i) / n);
  return { step: L / n, samples: pointsAlong(trace.coords, ds).map(({ position }, i) => ({ d: ds[i], p: position })) };
}

// The profile: each sample's elevation (metres, negative below sea level; NaN where there is none),
// the lowest and the highest, and the length along the surface: each step's length counting the
// change in elevation between two known, flat otherwise. A lower bound: relief finer than the data is
// not in it. elevationAt(p, z): a promise of the elevation at p, read at zoom z. A place that could
// not be read is a gap, as one without data is; only when none could, it fails.
export async function profileOf(trace, elevationAt, maxZoom) {
  const { step, samples } = samplesOf(trace);
  const z = zoomFor(step, samples[0]?.p[1] ?? 0, maxZoom);
  let failed = 0;
  const zs = await Promise.all(samples.map((x) => elevationAt(x.p, z).catch(() => { failed++; return NaN; })));
  if (failed === samples.length) throw new Error('the elevation could not be read');
  const pts = samples.map((x, i) => ({ ...x, z: zs[i] }));
  let surface = 0, lowest = null, highest = null;
  pts.forEach((x, i) => {
    if (Number.isFinite(x.z)) { if (lowest === null || x.z < lowest.z) lowest = x; if (highest === null || x.z > highest.z) highest = x; }
    if (!i) return;
    const a = pts[i - 1], dd = x.d - a.d;
    surface += Number.isFinite(a.z) && Number.isFinite(x.z) ? Math.hypot(dd, x.z - a.z) : dd;
  });
  return { pts, surface, length: trace.length, lowest, highest, zoom: z };
}

// The profile as CSV: distance along (m), elevation (m, negative below sea level), latitude, longitude; none: empty
export const profileCsv = (prof) => ['distance_m,elevation_m,lat,lon', ...prof.pts.map((x) => `${x.d.toFixed(1)},${Number.isFinite(x.z) ? x.z.toFixed(1) : ''},${x.p[1].toFixed(7)},${x.p[0].toFixed(7)}`)].join('\n') + '\n';
