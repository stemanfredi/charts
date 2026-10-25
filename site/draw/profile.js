// A line's depth profile and its length along the seabed (docs/drawing-ui.md §5): depths
// sampled along the line as drawn (curves included), from the depths the map's depth shading draws
// (GEBCO, cut to the coastline). Pure but for depthAt, the app's reading of those depths.

import { pointsAlong } from './lines.js';
import { CIRC, D2R } from '../geo.js';

export const GRID = 460; // m: GEBCO's cells, about; samples closer than this add nothing
export const MAX_SAMPLES = 1000;

// The zoom of the depth tiles to read for a step of `step` metres at latitude lat: a pixel about the
// step, at most maxZoom (the depth tiles' last)
export function zoomFor(step, lat, maxZoom) {
  const z = Math.round(Math.log2((CIRC * Math.cos(lat * D2R)) / (256 * step)));
  return Math.max(0, Math.min(maxZoom, z));
}

// The places to sample along a trace ({ coords, length }): every step metres (the grid's, or longer
// for a long line: at most MAX_SAMPLES), both ends included. [{ d (metres along), p ([lon, lat]) }]
export function samplesOf(trace) {
  const L = trace.length, step = Math.max(GRID, L / (MAX_SAMPLES - 1)), n = Math.max(1, Math.ceil(L / step));
  const ds = Array.from({ length: n + 1 }, (_, i) => (L * i) / n);
  return { step: L / n, samples: pointsAlong(trace.coords, ds).map(({ position }, i) => ({ d: ds[i], p: position })) };
}

// The profile: each sample's depth (metres, negative below the sea surface; NaN where there is none:
// land, lakes, no data), the shallowest and the deepest, and the length along the seabed: each step's
// length counting the change in depth between two depths known, flat otherwise. A lower bound: relief
// finer than the grid is not in it. depthAt(p, z): a promise of the depth at p, read at zoom z.
export async function profileOf(trace, depthAt, maxZoom) {
  const { step, samples } = samplesOf(trace);
  const z = zoomFor(step, samples[0]?.p[1] ?? 0, maxZoom);
  const depths = await Promise.all(samples.map((x) => depthAt(x.p, z)));
  const pts = samples.map((x, i) => ({ ...x, z: depths[i] }));
  let seabed = 0, min = null, max = null;
  pts.forEach((x, i) => {
    if (Number.isFinite(x.z)) { if (min === null || x.z > min.z) min = x; if (max === null || x.z < max.z) max = x; }
    if (!i) return;
    const a = pts[i - 1], dd = x.d - a.d;
    seabed += Number.isFinite(a.z) && Number.isFinite(x.z) ? Math.hypot(dd, x.z - a.z) : dd;
  });
  return { pts, seabed, length: trace.length, shallowest: min, deepest: max, zoom: z };
}

// The profile as CSV: distance along (m), depth (m), latitude, longitude; no depth: empty
export const profileCsv = (prof) => ['distance_m,depth_m,lat,lon', ...prof.pts.map((x) => `${x.d.toFixed(1)},${Number.isFinite(x.z) ? x.z.toFixed(1) : ''},${x.p[1].toFixed(7)},${x.p[0].toFixed(7)}`)].join('\n') + '\n';
