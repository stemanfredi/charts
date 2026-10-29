// Elevation tiles cut to the OSM coastline before the map sees them.
//
// The sea's depths come from GEBCO (gebco.js, at every zoom), the land's heights from the
// Terrarium DEM. Each has its own coastline, which does not match OSM's: depth tint and
// isobaths stopped short of the shore or ran onto land, and relief shading smeared into the
// sea. Each tile is therefore masked with the OSM sea polygons (OpenMapTiles `water`, class
// ocean/dock) that the basemap itself draws, so the two coastlines agree by construction:
//   sea  tiles: land → +1 m (no tint, outside every isobath); sea the grid calls
//               ≥ 0 m → −1 m (unknown depth is shown as the shallowest class);
//               inland water at sea level (limans, lagoons, harbour basins) → −1 m
//               flat (no depth, no isobaths); lakes above it → NO_DEPTH_M (grey)
//   land tiles: sea → 0 m (no relief or contours in the water)
// The depths are drawn as GEBCO has them: no filter; the spline that samples its cells smooths
// nothing larger than a cell (gebco.js).

import { NO_DEPTH_M } from './catalog.js';
import { HOSTS } from './hosts.js';
import { gebcoTile } from './gebco.js';
import { latOf, tileBounds, TILE } from './geo.js';
import { FETCH, fetchOk, lru } from './net.js';

const OMT_MAXZOOM = 14;
// Every tile is cut, at every zoom: each shortcut tried (deep ocean, low zooms) left a hole
// somewhere (islands under the tint, isobaths across the Jordan valley, seabed relief over
// satellite imagery).

// Water bodies whose surface is not at sea level but which OSM maps with a coastline
// (so they arrive as `ocean`). Depths inside them are measured from that surface.
// [name, [west, south, east, north], surface elevation m] (GEBCO gives the Caspian's bed relative
// to sea level: −36 m in the north, −630 m in the south)
export const DATUMS = [
  ['Caspian Sea', [46.5, 36.5, 55.2, 47.4], -28],
];
const SEA_CLASSES = new Set(['ocean', 'dock']);
// Inland water (OSM lagoons, limans, harbour basins, lakes) is classified once per water
// body, from the elevation along its shoreline (its polygon's vertices, relative to any DATUMS
// surface there), and remembered by OSM id so every tile agrees (each clipper its own memory: the
// sea's from GEBCO, the land's from the DEM). It is at sea level when the
// shore both dips to within this of sea level somewhere (lower quartile ≤ +8 m: a raised lake's
// does not) and rises to within it somewhere (upper quartile ≥ −8 m: the Dead Sea's, Galilee's,
// Salton Sea's do not). Shore values are noisy by several metres and OSM splits one liman
// into several polygons, so the margin sits above that noise (Odesa limans: 0–7 m).
const SEA_LEVEL_WATER_M = 8;
// what a water body shows (also the values of the water mask, 0 being land): DEPTH real depths
// (the sea, or a DATUMS water body), FLAT inland water at sea level, LAKE no depth source
const DEPTH = 1, FLAT = 2, LAKE = 3;
// land value in the shaded sea tiles (contours still get +1 m): pulls the tint edge back to the
// water pixels, so it never covers the shore line; the sliver it leaves shows the water fill,
// which app.js colours like the shallowest band while depth shading is on
const LAND_SHADE_M = 500;
const SIZE = TILE;

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
        for (let j = 0; j < n && i + 1 < geom.length; j++) { // never past the data, whatever the count says
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

const omtCache = lru(48); // promises of tiles (net.js lru): shared by neighbouring requests

// the `water` layer of OpenMapTiles tile oz/ox/oy (cached)
function omtLayer(omtTemplate, oz, ox, oy) {
  return omtCache(`${oz}/${ox}/${oy}`, async () => {
    const url = (await omtTemplate()).replace('{z}', oz).replace('{x}', ox).replace('{y}', oy);
    const r = await fetch(url, FETCH);
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
// OpenMapTiles keeps a water body's id across zooms. Heights come from the elevation tile that
// matches that zoom. Returns { vals, datum } or null.
async function ancestorShore(ctx, id, oz, ox, oy) {
  for (let k = 2; k <= 8; k += 2) {
    const az = oz - k;
    if (az < 0) break;
    const ax = ox >> k, ay = oy >> k;
    const layer = await omtLayer(ctx.omtTemplate, az, ax, ay);
    const f = layer.features.find((g) => g.id === id);
    if (!f) continue;
    const dz = az + 1, n = 2 ** dz; // a 512 px OMT tile at az ≈ 256 px elevation tile at az + 1
    const all = f.rings.flatMap((r) => { const pts = []; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]); return pts; })
      .filter(([vx, vy]) => vx > 0 && vy > 0 && vx < layer.extent && vy < layer.extent); // tile-edge clip points are not shore
    if (all.length < 10) continue;
    const stride = Math.max(1, Math.floor(all.length / 300)), vals = [];
    let datum = 0;
    for (let i = 0; i < all.length; i += stride) {
      const X = (ax + all[i][0] / layer.extent) / 2 ** az, Y = (ay + all[i][1] / layer.extent) / 2 ** az; // 0..1 web mercator
      const lon = X * 360 - 180, lat = latOf(Y);
      const tx = Math.min(n - 1, Math.floor(X * n)), ty = Math.min(n - 1, Math.floor(Y * n));
      const t = await ctx.raw(dz, tx, ty);
      const px = Math.min(SIZE - 1, Math.floor((X * n - tx) * SIZE)), py = Math.min(SIZE - 1, Math.floor((Y * n - ty) * SIZE));
      const h0 = datumAt(lon, lat);
      vals.push(t[py * SIZE + px] - h0);
      if (h0) datum++;
    }
    return { vals, datum };
  }
  return null;
}

// Water mask for elevation tile z/x/y: 0 land, else DEPTH, FLAT or LAKE.
// It must use the OpenMapTiles tile the basemap shows at the same map zoom, or the two
// coastlines differ where OSM is generalised: 256 px raster-dem tiles at z show at map
// zoom z−1 (with roundZoom off, see app.js) → OMT z−1 (omtOffset 1); 512 px contour tiles
// at z show at map zoom z → OMT z (omtOffset 0). levelAt(px, py) is the elevation above the
// local surface (sea level, or a DATUMS surface); inDatum(px, py) says whether that is a datum.
async function seaMask(ctx, z, x, y, levelAt, inDatum, omtOffset) {
  const oz = Math.max(0, Math.min(z - omtOffset, OMT_MAXZOOM)), d = z - oz;
  const ox = x >> d, oy = y >> d;
  const layer = await omtLayer(ctx.omtTemplate, oz, ox, oy);
  const c = new OffscreenCanvas(SIZE, SIZE), g = c.getContext('2d');
  const k = (SIZE * 2 ** d) / layer.extent, sx = (x - (ox << d)) * SIZE, sy = (y - (oy << d)) * SIZE;
  const classify = async (f) => {
    if (f.id && ctx.waterLevel.has(f.id)) return ctx.waterLevel.get(f.id); // decided once: every tile agrees
    let vals = [];
    let datum = 0;
    for (const r of f.rings) {
      for (let i = 0; i < r.length && vals.length < 300; i += 2) {
        const px = r[i] * k - sx, py = r[i + 1] * k - sy;
        if (px >= 0 && py >= 0 && px < SIZE && py < SIZE) { vals.push(levelAt(px, py)); if (inDatum(px, py)) datum++; }
      }
    }
    if (vals.length < 10 && f.id) { // little or no shore in this tile: read it at a lower zoom (a read
      // that fails fails the tile, which is asked again later, rather than a lake until the tile is dropped)
      const a = await ancestorShore(ctx, f.id, oz, ox, oy);
      if (a) ({ vals, datum } = a);
    }
    if (vals.length < 10) return LAKE; // still undecided (no shore here nor in any ancestor): a lake, not remembered
    vals.sort((a, b) => a - b);
    const atSea = vals[vals.length >> 2] <= SEA_LEVEL_WATER_M && vals[(3 * vals.length) >> 2] >= -SEA_LEVEL_WATER_M;
    // inland water at a DATUMS surface is that water body (OSM tiles carry the Caspian as
    // `lake` at some zooms): real depths from its surface, not the flat lagoon class
    const v = !atSea ? LAKE : datum * 2 > vals.length ? DEPTH : FLAT;
    if (f.id) ctx.waterLevel.set(f.id, v);
    return v;
  };
  // painted as colour channels: LAKE blue, FLAT green, DEPTH red, each over the ones before
  const classes = new Map();
  for (const f of layer.features) if (f.cls !== 'swimming_pool') classes.set(f, SEA_CLASSES.has(f.cls) ? DEPTH : await classify(f));
  for (const kind of [LAKE, FLAT, DEPTH]) {
    g.fillStyle = { [DEPTH]: '#f00', [FLAT]: '#0f0', [LAKE]: '#00f' }[kind];
    for (const [f, c] of classes) {
      if (c !== kind) continue;
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
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4] > 127 ? DEPTH : px[i * 4 + 1] > 127 ? FLAT : px[i * 4 + 2] > 127 ? LAKE : 0;
  return mask;
}

// a Terrarium tile decoded to metres (row-major SIZE × SIZE)
async function demMetres(url) {
  const img = await createImageBitmap(await (await fetchOk(url)).blob());
  if (img.width !== SIZE || img.height !== SIZE) throw new Error(`expected ${SIZE} px DEM tiles`);
  const g = new OffscreenCanvas(SIZE, SIZE).getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, SIZE, SIZE).data, e = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < e.length; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  return e;
}

// The DEM's seam between its land and sea sources makes false peaks on the land side: at Elba, zoom 10 has
// a dozen pixels up to 211 m above every neighbour, all within 3 px of the sea (none at zooms 11–12).
// A land pixel that near the OSM sea, standing more than SPIKE_M beyond all its land neighbours,
// takes the nearest of their values. Only land neighbours count, so an islet is never flattened
// against the sea, and inland terrain (summits included) is never touched.
const SPIKE_MAXZOOM = 10, SPIKE_M = 40, SPIKE_REACH = 3;
export function clampCoastalSpikes(e, sea, w, h) {
  const src = e.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (sea[p]) continue;
      let lo = Infinity, hi = -Infinity, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const q = p + dy * w + dx;
          if ((dx || dy) && !sea[q]) { lo = Math.min(lo, src[q]); hi = Math.max(hi, src[q]); n++; }
        }
      }
      if (n < 3 || (src[p] <= hi + SPIKE_M && src[p] >= lo - SPIKE_M)) continue;
      let coastal = false;
      for (let dy = -SPIKE_REACH; dy <= SPIKE_REACH && !coastal; dy++) {
        for (let dx = -SPIKE_REACH; dx <= SPIKE_REACH; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && xx >= 0 && yy < h && xx < w && sea[yy * w + xx]) { coastal = true; break; }
        }
      }
      if (coastal) e[p] = src[p] > hi ? hi : lo;
    }
  }
  return e;
}

// Clipped elevation for one tile, in metres (row-major 256 × 256).
// Shared by the map's raster-dem layers (protocol) and maplibre-contour (getTile +
// decodeImage), so each tile is computed once and never round-trips through PNG.
// mode 'sea': GEBCO's depths; 'land': the Terrarium tiles at `template`
// the OpenMapTiles tile URL, fetched once for both clippers; a failure is retried on the next tile.
// The TileJSON says where its tiles are: taken only from the host the page names (hosts.js), since
// a worker is outside the page's Content-Security-Policy
const tileJsons = lru(Infinity);
const omtTemplateOf = (omtTileJson) => tileJsons(omtTileJson, () => fetchOk(omtTileJson).then((r) => r.json()).then((tj) => {
  const t = tj?.tiles?.[0];
  if (typeof t !== 'string' || new URL(t).origin !== new URL(HOSTS.openfreemap).origin) throw new Error('the base map\'s TileJSON names tiles elsewhere');
  return t;
}));
export function clipper({ template, mode, omtTileJson }) {
  const omtTemplate = () => omtTemplateOf(omtTileJson);
  // 64 tiles each: a view and its surroundings (raw 256 kB, cut 320 kB: two clippers, two cuts of a sea tile)
  const rawCache = lru(64), cache = lru(64), waterLevel = new Map(); // waterLevel: OSM id → DEPTH, FLAT or LAKE
  // a tile's elevation in metres as the data has it (no mask): also what inland water is classified
  // from, at lower zooms too
  const raw = (z, x, y) => rawCache(`${z}/${x}/${y}`, () => (mode === 'sea' ? gebcoTile(z, x, y) : demMetres(template.replace('{z}', z).replace('{x}', x).replace('{y}', y))));
  // Shared by several requesters (the shading and the contours ask for the same tile): the work goes on
  // while any of them still waits, and stops between its steps once every one has given up (MapLibre
  // aborts the tiles a quick zoom leaves behind), so the tiles now wanted are not queued behind them
  const waiting = new Map(); // key → { n: requesters still waiting, ac: aborts the work }
  const elevation = (z, x, y, omtOffset = 1, signal = null) => {
    const key = `${z}/${x}/${y}/${omtOffset}`;
    let w = waiting.get(key);
    if (!w) waiting.set(key, w = { n: 0, ac: new AbortController() });
    w.n++;
    signal?.addEventListener('abort', () => { if (--w.n === 0) w.ac.abort(); }, { once: true });
    return cache(key, () => cut(z, x, y, omtOffset, w.ac.signal).finally(() => waiting.delete(key)));
  };
  const cut = async (z, x, y, omtOffset, signal) => {
    const [tw, ts, te, tn] = tileBounds(z, x, y);
    const datums = mode === 'sea' ? DATUMS.filter(([, b]) => b[0] < te && b[2] > tw && b[1] < tn && b[3] > ts) : [];
    const src = await raw(z, x, y);
    if (signal.aborted) throw new Error('aborted'); // nobody waits: not cut (the lru forgets a make that fails: asked again, it is)
    // surface per tile pixel: 0, or a DATUMS surface for pixels inside its box
    const lonAt = (i) => tw + ((i + 0.5) / SIZE) * (te - tw);
    const latAt = (j) => latOf((y + (j + 0.5) / SIZE) / 2 ** z);
    const surface = (i, j) => {
      if (!datums.length) return 0;
      for (const [, b, h0] of datums) { const lo = lonAt(i), la = latAt(j); if (lo >= b[0] && lo <= b[2] && la >= b[1] && la <= b[3]) return h0; }
      return 0;
    };
    const mask = await seaMask({ omtTemplate, raw, waterLevel }, z, x, y, // px, py: a shore vertex's place, fractional
      (px, py) => src[Math.floor(py) * SIZE + Math.floor(px)] - surface(px, py), (px, py) => surface(px, py) !== 0, omtOffset);
    if (signal.aborted) throw new Error('aborted');
    const out = new Float32Array(SIZE * SIZE);
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const k = j * SIZE + i, m = mask[k];
        let h = src[k];
        if (mode === 'sea') h = m === 0 ? 1 : m === DEPTH ? Math.min(h - surface(i, j), -1) : m === FLAT ? -1 : NO_DEPTH_M;
        else if (m === DEPTH) h = 0;
        out[k] = h;
      }
    }
    if (mode === 'land' && z <= SPIKE_MAXZOOM) clampCoastalSpikes(out, mask.map((m) => m === DEPTH), SIZE, SIZE);
    return { h: out, mask };
  };
  return {
    // Terrarium-encoded ImageBitmap for a raster-dem source
    async bitmap(z, x, y, signal) {
      const { h: e } = await elevation(z, x, y, 1, signal);
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
    async contourElevation(z, x, y, signal) {
      const { h: e } = await elevation(z, x, y, 0, signal);
      // lakes carry NO_DEPTH_M for the shading's grey; for contours they are just "not sea"
      // (+1 m), or every lake would be ringed by contours from 0 to 9000 m. Depths half a metre
      // shallower: GEBCO is in whole metres, so on a flat shelf whole groups of cells read exactly
      // −20, and the 20 m line traced their edges cell by cell (a staircase, Adriatic at zoom 12);
      // a whole metre stands for ±0.5 m, and with the half added no flat lies on a line, which
      // crosses the slope between values instead (towards shallower: the shallow side a line
      // encloses is never smaller)
      // always a new array: the worker transfers it, which would empty the cached tile
      return mode === 'sea' ? e.map((v) => (v > 1 ? 1 : v < 0 ? v + 0.5 : v)) : e.slice();
    },
    // metres as the raster-dem tile draws them, NaN where it shows no value of its own: for the sea
    // land, lakes and inland water at sea level (flat, depth unknown); for the land the sea (ZIP export)
    async metres(z, x, y) {
      const { h, mask } = await elevation(z, x, y);
      return h.map((v, k) => ((mode === 'sea' ? mask[k] === DEPTH : mask[k] !== DEPTH) ? v : NaN));
    },
  };
}

// ---- main thread: the same clipper running in a Web Worker (clip-worker.js) -------------
// The cutting is the page's heaviest work (seconds of main-thread time while panning); in a
// worker the map stays responsive. Tiles come back transferred, not copied.
const zxy = (url) => url.match(/(\d+)\/(\d+)\/(\d+)(?:\.png)?$/).slice(1).map(Number);
let worker = null, seq = 0, diedAt = 0;
const replies = new Map(), inits = []; // each clipper's init, sent again to a worker started anew
const RETRY_MS = 5000; // after the worker died: no new one before this, or a script that fails to load is fetched at every tile
function clipWorker() {
  if (worker) return worker;
  if (Date.now() - diedAt < RETRY_MS) throw new Error('clip worker: not running');
  const w = new Worker(new URL('./clip-worker.js', import.meta.url), { type: 'module' });
  worker = w;
  for (const init of inits) w.postMessage({ init });
  w.onmessage = ({ data }) => {
    if (data.setup) { console.error(`clip worker, ${data.setup} set-up:`, data.error); return; } // every tile of that mode will fail: said once, here
    const r = replies.get(data.seq);
    replies.delete(data.seq);
    if (r) data.error ? r.reject(new Error(data.error)) : r.resolve(data.value);
  };
  // the worker died (out of memory, a script error): every tile waiting on it fails now rather than
  // waits forever, and a later ask starts a new one. Said once: a dead worker may report twice
  w.onerror = (e) => {
    if (worker !== w) return;
    console.error('clip worker:', e.message);
    w.terminate();
    worker = null;
    diedAt = Date.now();
    for (const r of replies.values()) r.reject(new Error(`clip worker: ${e.message}`));
    replies.clear();
  };
  return w;
}
const ask = (msg, signal) => new Promise((resolve, reject) => {
  const w = clipWorker(); // throws while it is not to be started: this tile fails
  const n = ++seq;
  replies.set(n, { resolve, reject });
  signal?.addEventListener('abort', () => { replies.delete(n); reject(new Error('aborted')); if (worker === w) w.postMessage({ cancel: n }); }, { once: true });
  w.postMessage({ ...msg, seq: n });
});

// MapLibre protocol handler and maplibre-contour hooks for one clipper (mode 'sea' or 'land')
export function workerClipper({ template, mode, omtTileJson }) {
  inits.push({ template, mode, omtTileJson });
  if (worker) worker.postMessage({ init: inits.at(-1) }); // else the next start sends every init once
  else clipWorker();
  return {
    protocol: async (params, abortController) => {
      if (abortController?.signal.aborted) throw new Error('aborted');
      return { data: await ask({ mode, op: 'bitmap', zxy: zxy(params.url) }, abortController?.signal) };
    },
    getTile: async (url, ac) => ({ data: { elevation: await ask({ mode, op: 'contourElevation', zxy: zxy(url) }, ac?.signal) } }),
    decodeImage: async (data) => ({ width: SIZE, height: SIZE, data: data.elevation }),
    metres: (z, x, y) => ask({ mode, op: 'metres', zxy: [z, x, y] }),
  };
}
