// Vector layers of the view as clean GeoJSON (the ZIP export).
//
// The map holds features per tile: each tile's copy is cut a little beyond the tile (a buffer, so
// lines and fills join seamlessly on screen), and a feature crossing tiles comes in pieces. Here:
//   all       vertices snapped back to the tile grid, so neighbouring tiles' copies coincide;
//   lines     cut exactly at their own tile's edges, then joined end to end across the seams;
//   polygons  pieces unioned (polygon-clipping: the buffers overlap, so a plain join would not do);
//   points    the same label from neighbouring tiles' buffers kept once;
// then everything is clipped to the view, which may be rotated (a convex quadrilateral).
// Pieces belong together when they share the feature id and properties; without an id (ocean
// polygons, isobaths) all pieces with the same properties are one feature, which is what they are.
// Work is in Web Mercator metres, so lines are straight; output in lon/lat (RFC 7946).
// Known limit: OpenMapTiles merges neighbouring buildings into one feature whose parts touch (not
// valid as given), and on such input polygon-clipping now and then returns a part that still
// touches itself (3 of 49 building features in central Taranto at zoom 14.5). GIS tools read them; QGIS's
// "Fix geometries" repairs them.

import { mercator, unmercator as lonLat, CIRC, signedArea2 } from './geo.js';

const EXTENT = 4096; // vector tile units per tile edge (OpenMapTiles, maplibre-contour)
const DIGITS = 1e7; // output to 7 decimals of a degree: about 1 cm
const unmercator = (p) => lonLat(p).map((v) => Math.round(v * DIGITS) / DIGITS);

// Web Mercator square of tile z/x/y, counter-clockwise from its south-west corner
function tileQuad(z, x, y) {
  const s = CIRC / 2 ** z, x0 = x * s - CIRC / 2, y1 = CIRC / 2 - y * s;
  return [[x0, y1 - s], [x0 + s, y1 - s], [x0 + s, y1], [x0, y1]];
}

// Parts of polyline pts inside convex polygon quad (either winding): Cyrus–Beck per segment,
// consecutive inside stretches kept as one part.
export function clipLine(pts, quad) {
  const sign = Math.sign(signedArea2(quad));
  const edges = quad.map((a, i) => [a, quad[(i + 1) % quad.length]]);
  // > 0 inside the half-plane of edge a→b
  const side = ([a, b], p) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  const parts = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    let t0 = 0, t1 = 1;
    for (const e of edges) {
      const fp = side(e, p), fq = side(e, q);
      if (fp < 0 && fq < 0) { t0 = 1; t1 = 0; break; }
      if (fp < 0) t0 = Math.max(t0, fp / (fp - fq));
      else if (fq < 0) t1 = Math.min(t1, fp / (fp - fq));
    }
    if (t0 > t1) { cur = null; continue; }
    const at = (t) => (t === 0 ? p : t === 1 ? q : [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    if (!cur || t0 > 0) { cur = [at(t0)]; parts.push(cur); }
    cur.push(at(t1));
    if (t1 < 1) cur = null;
  }
  return parts.filter((l) => l.length > 1);
}
const inside = (p, quad) => clipLine([p, p], quad).length > 0;

// Polylines joined where an end of one meets an end of another (within tol); closed loops stay closed
export function joinLines(lines, tol) {
  lines = lines.map((l) => l.slice());
  const alive = lines.map(() => true);
  const key = ([x, y]) => `${Math.round(x / tol)},${Math.round(y / tol)}`;
  const index = new Map(); // grid cell → line indices with an end there
  const add = (p, i) => { const k = key(p); (index.get(k) || index.set(k, []).get(k)).push(i); };
  lines.forEach((l, i) => { add(l[0], i); add(l[l.length - 1], i); });
  const near = (a, b) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  const partner = (p, self) => {
    const [cx, cy] = key(p).split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of index.get(`${cx + dx},${cy + dy}`) || []) {
          if (j === self || !alive[j]) continue;
          const l = lines[j];
          if (near(l[0], p)) return [j, false];
          if (near(l[l.length - 1], p)) return [j, true];
        }
      }
    }
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    if (!alive[i]) continue;
    for (const atEnd of [true, false]) {
      for (;;) {
        const l = lines[i], p = atEnd ? l[l.length - 1] : l[0];
        if (l.length > 2 && near(l[0], l[l.length - 1])) break; // a closed loop
        const m = partner(p, i);
        if (!m) break;
        const [j, jEnd] = m;
        alive[j] = false;
        let o = lines[j];
        if (atEnd === jEnd) o = o.slice().reverse(); // join end to start
        lines[i] = atEnd ? l.concat(o.slice(1)) : o.slice(0, -1).concat(l);
        add(atEnd ? lines[i][lines[i].length - 1] : lines[i][0], i);
      }
    }
  }
  return lines.filter((_, i) => alive[i]);
}

// pieces: [{ id, properties, geometry (lon/lat, as MapLibre gives it), tile: [z, x, y] or null }];
// corners: the view's corners as for export.js affine; polygonClipping: the library's API.
// → GeoJSON features, clipped to the view. A polygon the library fails on (it throws on some
// degenerate input) is left out, its error pushed to failed: the rest is kept.
export function viewFeatures(pieces, corners, polygonClipping, failed = []) {
  const view = corners.map(mercator);
  const cx = view.reduce((s, p) => s + p[0], 0) / view.length;
  const groups = new Map();
  for (const pc of pieces) {
    const g = pc.geometry, type = g.type.replace('Multi', '');
    const k = `${type}|${pc.id ?? ''}|${JSON.stringify(pc.properties)}`;
    const grp = groups.get(k) || groups.set(k, { type, id: pc.id, properties: pc.properties, parts: [], tol: 0 }).get(k);
    // the world copy nearest the view (tiles come with their canonical x)
    const first = type === 'Point' ? (g.type === 'Point' ? g.coordinates : g.coordinates[0]) : type === 'LineString' ? (g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0]) : (g.type === 'Polygon' ? g.coordinates[0][0] : g.coordinates[0][0][0]);
    const shift = CIRC * Math.round((cx - mercator(first)[0]) / CIRC);
    // vertices back on the tile grid, which the tiles of one zoom share: copies of the same vertex
    // from neighbouring tiles then agree exactly (lon/lat in floating point leave them a hair apart,
    // and a union of near-identical edges leaves slivers)
    const unit = pc.tile ? CIRC / 2 ** pc.tile[0] / EXTENT : 0;
    const snap = (v) => (unit ? Math.round(v / unit) * unit : v);
    const m = (p) => { const [x, y] = mercator(p); return [snap(x) + shift, snap(y)]; };
    const multi = g.type.startsWith('Multi') ? g.coordinates : [g.coordinates];
    // two tile units: where two tiles cut the same line at their seam (each from its own copy)
    if (pc.tile) grp.tol = Math.max(grp.tol, (2 * CIRC) / 2 ** pc.tile[0] / EXTENT);
    if (type === 'Point') for (const p of multi) grp.parts.push(m(p));
    else if (type === 'LineString') {
      const quad = pc.tile && tileQuad(...pc.tile).map(([x, y]) => [x + shift, y]);
      for (const l of multi) grp.parts.push(...(quad ? clipLine(l.map(m), quad) : [l.map(m)]));
    } else for (const poly of multi) grp.parts.push(poly.map((ring) => ring.map(m)));
  }
  const out = [];
  const feature = (grp, geometry) => out.push({ type: 'Feature', ...(grp.id != null && { id: grp.id }), properties: grp.properties, geometry });
  const ll = (l) => l.map(unmercator);
  // a ring in lon/lat without repeated points, or null if that leaves it no area
  const ring = (r) => {
    const out = ll(r).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
    return out.length >= 4 ? out : null;
  };
  const polygon = (p) => { const [outer, ...holes] = p.map(ring); return outer ? [outer, ...holes.filter(Boolean)] : null; };
  for (const grp of groups.values()) {
    if (grp.type === 'Point') {
      const kept = []; // the same label from several tiles: once
      for (const p of grp.parts) {
        if (!inside(p, view) || kept.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= (grp.tol || 1e-6))) continue;
        kept.push(p);
        feature(grp, { type: 'Point', coordinates: unmercator(p) });
      }
    } else if (grp.type === 'LineString') {
      const lines = joinLines(grp.parts, grp.tol || 1e-6).flatMap((l) => clipLine(l, view)).map(ll);
      if (lines.length) feature(grp, lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines });
    } else {
      let polys;
      try {
        const merged = grp.parts.length > 1 ? polygonClipping.union(...grp.parts.map((p) => [p])) : [grp.parts[0]];
        polys = polygonClipping.intersection(merged, [[...view, view[0]]]).map(polygon).filter(Boolean);
      } catch (e) { failed.push(e.message); continue; }
      if (polys.length) feature(grp, polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys });
    }
  }
  return out;
}
