// Elevation tiles cut to the OSM coastline before the map sees them.
//
// The DEM has its own coastline, which does not match OSM's: depth tint and
// isobaths stopped short of the shore or ran onto land, and relief shading
// smeared into the sea. Each DEM tile is therefore masked with the OSM sea
// polygons (OpenMapTiles `water`, class ocean/dock) that the basemap itself
// draws, so the two coastlines agree by construction:
//   sea  tiles: land → +1 m (no tint, outside every isobath); sea the DEM calls
//               ≥ 0 m → −1 m (unknown depth is shown as the shallowest class);
//               inland water at sea level (limans, lagoons, harbour basins) → −1 m
//               flat (no DEM depth, no isobaths); lakes above it → NO_DEPTH_M (grey)
//   land tiles: sea → 0 m (no relief or contours in the water)
// Above the DEM's native zoom, tiles are upsampled bilinearly (in metres, not in
// the encoded bytes) and masked at the higher zoom, so the coast stays sharp.

const OMT_MAXZOOM = 14;
// Every tile is cut, at every zoom: each shortcut tried (deep ocean, low zooms) left a hole
// somewhere (islands under the tint, isobaths across the Jordan valley, seabed relief over
// satellite imagery).

// Water bodies whose surface is not at sea level but which OSM maps with a coastline
// (so they arrive as `ocean`). Depths inside them are measured from that surface.
// [name, [west, south, east, north], surface elevation m, [min, max] DEM zoom with real depths]
// Caspian: Terrarium has only the flat lake surface (−29 m) in large rectangles above zoom 6,
// and in blocks at zooms 3–4; zooms 5–6 carry the bathymetry. Tiles at map zoom 3–4 are
// therefore downsampled from zoom 5 (≤ 36 source tiles); zoom ≤ 2 reads its own tiles.
export const DATUMS = [
  ['Caspian Sea', [46.5, 36.5, 55.2, 47.4], -28, [5, 6]],
];
const DATUM_DOWNSAMPLE_MINZOOM = 3;
const tileBounds = (z, x, y) => {
  const n = 2 ** z, lat = (t) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
};
const SEA_CLASSES = new Set(['ocean', 'dock']);
// Inland water (OSM lagoons, limans, harbour basins, lakes) is classified once per water
// body, from the DEM along its shoreline (its polygon's vertices, relative to any DATUMS
// surface there), and remembered by OSM id so every tile agrees. It is at sea level when the
// shore both dips to within this of sea level somewhere (lower quartile ≤ +8 m: a raised lake's
// does not) and rises to within it somewhere (upper quartile ≥ −8 m: the Dead Sea's, Galilee's,
// Salton Sea's do not). SRTM shore values are noisy by several metres and OSM splits one liman
// into several polygons, so the margin sits above that noise (Odesa limans: 0–7 m).
const SEA_LEVEL_WATER_M = 8;
const waterLevel = new Map(); // OSM id → 'sea' (sea level), 'datum' (in a DATUMS water body), 'lake'
const decidedListeners = new Set(); // notified with the id when a water body is classified
// value the sea tiles carry for water without a depth source; DEPTH_RAMP paints it grey
export const NO_DEPTH_M = 9000;
// land value in the shaded sea tiles (contours still get +1 m): pulls the tint edge back to the
// water pixels, so it never covers the shore line; the sliver it leaves shows the water fill,
// which app.js colours like the shallowest band while depth shading is on
const LAND_SHADE_M = 500;
const SIZE = 256;

// ---- minimal Mapbox Vector Tile reader: just the `water` polygons ----------------
function reader(buf) {
  let p = 0;
  const r = {
    get done() { return p >= buf.length; },
    varint() { let v = 0, s = 0, b; do { b = buf[p++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; },
    bytes() { const n = r.varint(); const out = buf.subarray(p, p + n); p += n; return out; },
    skip(wire) { if (wire === 0) r.varint(); else if (wire === 1) p += 8; else if (wire === 2) p += r.varint(); else if (wire === 5) p += 4; else throw new Error(`bad wire type ${wire}`); },
  };
  return r;
}
const text = new TextDecoder();
const zigzag = (n) => (n >>> 1) ^ -(n & 1);
function packed(bytes) { const r = reader(bytes), out = []; while (!r.done) out.push(r.varint()); return out; }

// → { extent, features: [{ cls, rings: [[x, y, x, y …], …] }] } for the `water` layer
function waterLayer(buf) {
  const t = reader(buf);
  while (!t.done) {
    const key = t.varint();
    if (key >> 3 !== 3 || (key & 7) !== 2) { t.skip(key & 7); continue; }
    const l = reader(t.bytes());
    let name = '', extent = 4096;
    const feats = [], keys = [], values = [];
    while (!l.done) {
      const k = l.varint(), f = k >> 3;
      if (f === 1) name = text.decode(l.bytes());
      else if (f === 2) feats.push(l.bytes());
      else if (f === 3) keys.push(text.decode(l.bytes()));
      else if (f === 4) {
        const v = reader(l.bytes());
        let s = null;
        while (!v.done) { const vk = v.varint(); if (vk >> 3 === 1 && (vk & 7) === 2) s = text.decode(v.bytes()); else v.skip(vk & 7); }
        values.push(s);
      } else if (f === 5) extent = l.varint();
      else l.skip(k & 7);
    }
    if (name !== 'water') continue;
    const classKey = keys.indexOf('class');
    const features = [];
    for (const fb of feats) {
      const fr = reader(fb);
      let tags = [], type = 0, geom = [], id = 0;
      while (!fr.done) {
        const k = fr.varint(), f = k >> 3;
        if (f === 1) id = fr.varint();
        else if (f === 2) tags = packed(fr.bytes());
        else if (f === 3) type = fr.varint();
        else if (f === 4) geom = packed(fr.bytes());
        else fr.skip(k & 7);
      }
      if (type !== 3) continue;
      let cls = null;
      for (let i = 0; i < tags.length; i += 2) if (tags[i] === classKey) cls = values[tags[i + 1]];
      const rings = [];
      let x = 0, y = 0, ring = null;
      for (let i = 0; i < geom.length;) {
        const cmd = geom[i++], id = cmd & 7, n = cmd >> 3;
        if (id === 7) { if (ring) rings.push(ring); ring = null; continue; }
        for (let j = 0; j < n; j++) {
          x += zigzag(geom[i++]); y += zigzag(geom[i++]);
          if (id === 1) { if (ring) rings.push(ring); ring = [x, y]; } else ring.push(x, y);
        }
      }
      if (ring) rings.push(ring);
      features.push({ cls, id, rings });
    }
    return { extent, features };
  }
  return { extent: 4096, features: [] };
}

// ---- small LRU of promises (tiles shared by neighbouring requests) ----------------
function lru(max) {
  const m = new Map();
  const get = (key, make) => {
    if (m.has(key)) { const v = m.get(key); m.delete(key); m.set(key, v); return v; }
    const v = make().catch((e) => { m.delete(key); throw e; });
    m.set(key, v);
    if (m.size > max) m.delete(m.keys().next().value);
    return v;
  };
  get.delete = (key) => m.delete(key);
  return get;
}
const omtCache = lru(48), demCache = lru(64);

async function fetchOk(url, signal) {
  const r = await fetch(url, { signal, credentials: 'omit' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

// Water mask for DEM tile z/x/y: 0 land, 1 OSM sea, 2 inland water at sea level, 3 lake.
// It must use the OpenMapTiles tile the basemap shows at the same map zoom, or the two
// coastlines differ where OSM is generalised: 256 px raster-dem tiles at z show at map
// zoom z−1 (with roundZoom off, see app.js) → OMT z−1 (omtOffset 1); 512 px contour tiles
// at z show at map zoom z → OMT z (omtOffset 0). levelAt(px, py) is the DEM height above the
// local surface (sea level, or a DATUMS surface); inDatum(px, py) says whether that is a datum.
// Returns the mask and the ids of water bodies drawn before they could be classified.
// the `water` layer of OpenMapTiles tile oz/ox/oy (cached)
function omtLayer(omtTemplate, oz, ox, oy, signal) {
  return omtCache(`${oz}/${ox}/${oy}`, async () => {
    const url = (await omtTemplate()).replace('{z}', oz).replace('{x}', ox).replace('{y}', oy);
    const r = await fetch(url, { signal, credentials: 'omit' });
    if (r.status === 204 || r.status === 404) return { extent: 4096, features: [] }; // empty tile
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return waterLayer(new Uint8Array(await r.arrayBuffer()));
  });
}

// surface of the DATUMS water body at lon/lat, or 0 (sea level)
export const datumAt = (lon, lat) => {
  for (const [, b, h0] of DATUMS) if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]) return h0;
  return 0;
};

// Shore samples of water body `id` from the nearest lower-zoom OpenMapTiles tile that contains
// its shoreline: a tile that shows only the inside of a large lagoon has none of its own.
// OpenMapTiles keeps a water body's id across zooms. Heights come from the DEM tile that
// matches that zoom (≤ native). Returns { vals, datum } or null.
async function ancestorShore(ctx, id, oz, ox, oy) {
  for (let k = 2; k <= 8; k += 2) {
    const az = oz - k;
    if (az < 0) break;
    const ax = ox >> k, ay = oy >> k;
    const layer = await omtLayer(ctx.omtTemplate, az, ax, ay);
    const f = layer.features.find((g) => g.id === id);
    if (!f) continue;
    const dz = Math.min(az + 1, ctx.native), n = 2 ** dz; // a 512 px OMT tile at az ≈ 256 px DEM at az + 1
    const all = f.rings.flatMap((r) => { const pts = []; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]); return pts; })
      .filter(([vx, vy]) => vx > 0 && vy > 0 && vx < layer.extent && vy < layer.extent); // tile-edge clip points are not shore
    if (all.length < 10) continue;
    const stride = Math.max(1, Math.floor(all.length / 300)), vals = [];
    let datum = 0;
    for (let i = 0; i < all.length; i += stride) {
      const X = (ax + all[i][0] / layer.extent) / 2 ** az, Y = (ay + all[i][1] / layer.extent) / 2 ** az; // 0..1 web mercator
      const lon = X * 360 - 180, lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180) / Math.PI;
      const tx = Math.min(n - 1, Math.floor(X * n)), ty = Math.min(n - 1, Math.floor(Y * n));
      const t = await demMetres(ctx.template.replace('{z}', dz).replace('{x}', tx).replace('{y}', ty));
      const px = Math.min(SIZE - 1, Math.floor((X * n - tx) * SIZE)), py = Math.min(SIZE - 1, Math.floor((Y * n - ty) * SIZE));
      const h0 = datumAt(lon, lat);
      vals.push(t.e[py * SIZE + px] - h0);
      if (h0) datum++;
    }
    return { vals, datum };
  }
  return null;
}

async function seaMask(ctx, z, x, y, levelAt, inDatum, omtOffset, signal) {
  const oz = Math.max(0, Math.min(z - omtOffset, OMT_MAXZOOM)), d = z - oz;
  const ox = x >> d, oy = y >> d;
  const layer = await omtLayer(ctx.omtTemplate, oz, ox, oy, signal);
  const c = new OffscreenCanvas(SIZE, SIZE), g = c.getContext('2d');
  const k = (SIZE * 2 ** d) / layer.extent, sx = (x - (ox << d)) * SIZE, sy = (y - (oy << d)) * SIZE;
  const pending = [];
  const classify = async (f) => {
    if (f.id && waterLevel.has(f.id)) return waterLevel.get(f.id); // decided once: every tile agrees
    let vals = [];
    let datum = 0;
    for (const r of f.rings) {
      for (let i = 0; i < r.length && vals.length < 300; i += 2) {
        const px = r[i] * k - sx, py = r[i + 1] * k - sy;
        if (px >= 0 && py >= 0 && px < SIZE && py < SIZE) { vals.push(levelAt(px, py)); if (inDatum(px, py)) datum++; }
      }
    }
    if (vals.length < 10 && f.id) { // little or no shore in this tile: read it at a lower zoom
      const a = await ancestorShore(ctx, f.id, oz, ox, oy).catch(() => null);
      if (a) ({ vals, datum } = a);
    }
    if (vals.length < 10) { // still undecided: provisional, redrawn once decided
      if (f.id) pending.push(f.id);
      return 'lake';
    }
    vals.sort((a, b) => a - b);
    const atSea = vals[vals.length >> 2] <= SEA_LEVEL_WATER_M && vals[(3 * vals.length) >> 2] >= -SEA_LEVEL_WATER_M;
    // inland water at a DATUMS surface is that water body (OSM tiles carry the Caspian as
    // `lake` at some zooms): real depths from its surface, not the flat lagoon class
    const v = !atSea ? 'lake' : datum * 2 > vals.length ? 'datum' : 'sea';
    if (f.id) { waterLevel.set(f.id, v); for (const fn of decidedListeners) fn(f.id); }
    return v;
  };
  // lakes in blue, sea-level inland water in green, sea in red over both
  const classes = new Map();
  for (const f of layer.features) if (f.cls !== 'swimming_pool') classes.set(f, SEA_CLASSES.has(f.cls) ? 'datum' : await classify(f));
  for (const kind of [3, 2, 1]) {
    g.fillStyle = ['', '#f00', '#0f0', '#00f'][kind];
    for (const f of layer.features) {
      if (f.cls === 'swimming_pool') continue;
      const c = classes.get(f);
      const fk = c === 'datum' ? 1 : c === 'sea' ? 2 : 3;
      if (fk !== kind) continue;
      g.beginPath(); // one path per feature, so overlapping water features add up instead of cancelling
      for (const r of f.rings) {
        g.moveTo(r[0] * k - sx, r[1] * k - sy);
        for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * k - sx, r[i + 1] * k - sy);
        g.closePath();
      }
      g.fill('nonzero');
    }
  }
  const px = g.getImageData(0, 0, SIZE, SIZE).data, mask = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4] > 127 ? 1 : px[i * 4 + 1] > 127 ? 2 : px[i * 4 + 2] > 127 ? 3 : 0;
  return { mask, pending };
}

// Terrarium tile at zoom ≤ native, decoded to metres
function demMetres(url, signal) {
  return demCache(url, async () => {
    const img = await createImageBitmap(await (await fetchOk(url, signal)).blob());
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data, e = new Float32Array(img.width * img.height);
    let max = -Infinity;
    for (let i = 0; i < e.length; i++) { e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768; if (e[i] > max) max = e[i]; }
    if (img.width !== SIZE) throw new Error(`expected ${SIZE} px DEM tiles`);
    return { w: img.width, e, max };
  });
}

// Clipped elevation for one DEM tile, in metres (row-major 256 × 256), up to any zoom.
// Shared by the map's raster-dem layers (protocol) and maplibre-contour (getTile +
// decodeImage), so each tile is computed once and never round-trips through PNG.
// onStale(): called (at most every 300 ms) when tiles already handed out are out of date,
// because a water body they drew provisionally has now been classified.
export function clipper({ template, native, mode, omtTileJson, onStale }) {
  // the OpenMapTiles tile URL, fetched once; a failure is retried on the next tile
  let omtUrl = null;
  const omtTemplate = () => (omtUrl ||= fetch(omtTileJson, { credentials: 'omit' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((tj) => tj.tiles[0])
    .catch((e) => { omtUrl = null; throw e; }));
  const cache = lru(128);
  const waiting = new Map(); // water body id → cache keys of tiles drawn before it was classified
  let staleTimer = 0;
  decidedListeners.add((id) => {
    const keys = waiting.get(id);
    if (!keys) return;
    waiting.delete(id);
    for (const key of keys) cache.delete(key);
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => onStale?.(), 300);
  });
  // shared by several requesters, so no single requester's abort signal is passed down
  const elevation = (z, x, y, omtOffset = 1) => {
    const key = `${z}/${x}/${y}/${omtOffset}`;
    return cache(key, async () => {
    const [tw, ts, te, tn] = tileBounds(z, x, y);
    const datums = mode === 'sea' ? DATUMS.filter(([, b]) => b[0] < te && b[2] > tw && b[1] < tn && b[3] > ts) : [];
    let nz = Math.min(z, native);
    for (const [, , , [lo, hi]] of datums) nz = Math.min(Math.max(nz, z >= DATUM_DOWNSAMPLE_MINZOOM ? lo : 0), hi);
    const d = z - nz, f = 2 ** d, n = 2 ** nz; // d < 0: downsampled from a higher zoom
    // source pixels this tile needs, in global pixel coordinates at the native zoom;
    // bilinear sampling reads one pixel past the edge, so neighbours may be needed
    const w = SIZE, step = 1 / f, gx = (x / f) * w, gy = (y / f) * w;
    const tx0 = d === 0 ? x : Math.floor((gx - 1) / w), tx1 = d === 0 ? x : Math.floor((gx + w * step + 1) / w);
    const ty0 = d === 0 ? y : Math.max(0, Math.floor((gy - 1) / w)), ty1 = d === 0 ? y : Math.min(n - 1, Math.floor((gy + w * step + 1) / w));
    const want = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) want.push([tx, ty]);
    const tiles = await Promise.all(want.map(([tx, ty]) => demMetres(template.replace('{z}', nz).replace('{x}', ((tx % n) + n) % n).replace('{y}', ty))));
    // the source tiles as one flat buffer (sw × sh), so sampling is plain indexing
    const sw = (tx1 - tx0 + 1) * w, sh = (ty1 - ty0 + 1) * w, src = new Float32Array(sw * sh);
    want.forEach(([tx, ty], k) => {
      const e = tiles[k].e, ox = (tx - tx0) * w, oy = (ty - ty0) * w;
      for (let r = 0; r < w; r++) src.set(e.subarray(r * w, r * w + w), (oy + r) * sw + ox);
    });
    const bx = tx0 * w, by = ty0 * w; // global pixel of src[0]
    const at = (X, Y) => src[(Math.min(sh - 1, Math.max(0, Y - by))) * sw + Math.min(sw - 1, Math.max(0, X - bx))];
    // surface per tile pixel: 0, or a DATUMS surface for pixels inside its box
    const lonAt = (i) => tw + ((i + 0.5) / SIZE) * (te - tw);
    const latAt = (j) => { const t = y + (j + 0.5) / SIZE, m = 2 ** z; return (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / m))) * 180) / Math.PI; };
    const surface = (i, j) => {
      if (!datums.length) return 0;
      for (const [, b, h0] of datums) { const lo = lonAt(i), la = latAt(j); if (lo >= b[0] && lo <= b[2] && la >= b[1] && la <= b[3]) return h0; }
      return 0;
    };
    const demAt = (px, py) => at(Math.floor(gx + px * step), Math.floor(gy + py * step));
    const { mask, pending } = await seaMask({ omtTemplate, template, native }, z, x, y,
      (px, py) => demAt(px, py) - surface(px, py), (px, py) => surface(px, py) !== 0, omtOffset);
    for (const id of pending) (waiting.get(id) || waiting.set(id, new Set()).get(id)).add(key);
    const out = new Float32Array(SIZE * SIZE);
    for (let j = 0; j < SIZE; j++) {
      const v = gy + (j + 0.5) * step - 0.5, j0 = Math.floor(v), fj = v - j0;
      for (let i = 0; i < SIZE; i++) {
        let h;
        if (d === 0) h = src[j * sw + i];
        else {
          const u = gx + (i + 0.5) * step - 0.5, i0 = Math.floor(u), fi = u - i0;
          h = (at(i0, j0) * (1 - fi) + at(i0 + 1, j0) * fi) * (1 - fj) + (at(i0, j0 + 1) * (1 - fi) + at(i0 + 1, j0 + 1) * fi) * fj;
        }
        const m = mask[j * SIZE + i];
        if (mode === 'sea') h = m === 0 ? 1 : m === 1 ? Math.min(h - surface(i, j), -1) : m === 2 ? -1 : NO_DEPTH_M;
        else if (m === 1) h = 0;
        out[j * SIZE + i] = h;
      }
    }
    return out;
    });
  };
  return {
    // Terrarium-encoded ImageBitmap for a raster-dem source
    async bitmap(z, x, y) {
      const e = await elevation(z, x, y);
      const img = new ImageData(SIZE, SIZE), o = img.data;
      for (let k = 0; k < e.length; k++) {
        // The GPU interpolates between pixels, and the tint edge falls where the value
        // crosses 0. With land at +1 it lands mid-way and bleeds onto land, half-hiding the
        // shore line; a higher land value pulls it back toward the water.
        const t = (mode === 'sea' && e[k] === 1 ? LAND_SHADE_M : e[k]) + 32768, q = k * 4;
        o[q] = Math.floor(t / 256); o[q + 1] = Math.floor(t) % 256; o[q + 2] = Math.floor((t - Math.floor(t)) * 256); o[q + 3] = 255;
      }
      return createImageBitmap(img, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    },
    // metres for maplibre-contour (512 px contour tiles: cut with the coastline of the same zoom)
    async contourElevation(z, x, y) {
      const e = await elevation(z, x, y, 0);
      // lakes carry NO_DEPTH_M for the shading's grey; for contours they are just "not sea"
      // (+1 m), or every lake would be ringed by contours from 0 to 9000 m
      return mode === 'sea' ? e.map((v) => (v > 1 ? 1 : v)) : e;
    },
  };
}

// ---- main thread: the same clipper running in a Web Worker (clip-worker.js) -------------
// The cutting is the page's heaviest work (seconds of main-thread time while panning); in a
// worker the map stays responsive. Tiles come back transferred, not copied.
const zxy = (url) => url.match(/(\d+)\/(\d+)\/(\d+)(?:\.png)?$/).slice(1).map(Number);
let worker = null, seq = 0;
const replies = new Map(), staleHandlers = {};
function clipWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./clip-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.stale) { staleHandlers[data.stale]?.(); return; }
    const r = replies.get(data.seq);
    replies.delete(data.seq);
    if (r) data.error ? r.reject(new Error(data.error)) : r.resolve(data.value);
  };
  worker.onerror = (e) => console.error('clip worker:', e.message);
  return worker;
}
const ask = (msg, signal) => new Promise((resolve, reject) => {
  const n = ++seq;
  replies.set(n, { resolve, reject });
  signal?.addEventListener('abort', () => { replies.delete(n); reject(new Error('aborted')); }, { once: true });
  clipWorker().postMessage({ ...msg, seq: n });
});

// MapLibre protocol handler and maplibre-contour hooks for one clipper (mode 'sea' or 'land')
export function workerClipper({ template, native, mode, omtTileJson, onStale }) {
  staleHandlers[mode] = onStale;
  clipWorker().postMessage({ init: { template, native, mode, omtTileJson } });
  return {
    protocol: async (params, abortController) => {
      if (abortController?.signal.aborted) throw new Error('aborted');
      return { data: await ask({ mode, op: 'bitmap', zxy: zxy(params.url) }, abortController?.signal) };
    },
    getTile: async (url) => ({ data: { elevation: await ask({ mode, op: 'contourElevation', zxy: zxy(url) }) } }),
    decodeImage: async (data) => ({ width: SIZE, height: SIZE, data: data.elevation }),
  };
}
