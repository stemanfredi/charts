// GEBCO 2026 for the map: its grids of 15″ cells, published as multiscale Zarr stores (tools/gebco.mjs
// builds them, catalog.js says where), sampled at a tile's pixel centres. Each zoom reads the
// coarsest level whose cells are no larger than its pixels (level 0, GEBCO's own cells, from zoom 8
// up). Chunks (512 × 512 cells, about 2° at level 0) are shared by many neighbouring tiles: the
// latest are kept.
//   gebcoTile   the sea's depths for the elevation tiles (clip.js): a cubic B-spline over 4 × 4 cells,
//               in floating point, so no precision is lost however far the map zooms in, and
//               isobaths curve through GEBCO's whole metres instead of breaking at its cells (a
//               straight-line interpolation left a wave one cell long on flat shelves); the
//               spline barely moves anything smaller than a cell, below what the data resolves
//   gebcoSeaTile the same, blending water cells only: a land cell beside the shore (tens of metres
//               up) no longer pulls the water next to it shallower over a cell's width (the sea's
//               drawn depths; the plain blend stays what inland water is classified from)
//   tidTile     where the depths come from (the type identifier grid): each cell's own code,
//               coloured by its group (catalog.js DEPTH_SOURCES), a MapLibre tile handler
//   tidAt       the code of the cell at a point (the depth on a click)
import { openStore } from './zarr.js';
import { latOf, TILE } from './geo.js';
import { fetchBytes, lru } from './net.js';
import { GEBCO, GEBCO_TID, DEPTH_SOURCES } from './catalog.js';

const SIZE = TILE, CELL = 15 / 3600, LEVELS = 7, KEEP = 96; // KEEP: chunks kept (512 kB each at most): a zoomed-out view's, and its neighbours'

// the level for tiles of zoom z: the coarsest whose cells are no larger than the tile's pixels
const levelFor = (z) => Math.max(0, Math.min(LEVELS - 1, Math.floor(Math.log2(360 / (SIZE * 2 ** z) / CELL))));

const stores = lru(Infinity);
// every chunk of these stores is written (tools/gebco.mjs): one the host has not got is a failure
// (a broken upload), never the fill value drawn as the deepest sea
const store = (url) => stores(url, () => openStore(url, async (u) => { const b = await fetchBytes(u); if (!b) throw new Error(`GEBCO: ${u.slice(u.lastIndexOf('/', u.lastIndexOf('/') - 1) + 1)} is missing`); return b; }));

const chunks = lru(KEEP); // `store level/row.col` → promise of the chunk's cells

// a grid's values at the pixel centres of 256 px Web Mercator tile z/x/y, row-major, north up:
// smoothly interpolated (a cubic B-spline; seaOnly: over the cells below sea level alone, where any
// is), or each pixel its cell's own value (nearest: codes)
async function gridTile(url, variable, z, x, y, nearest, seaOnly = false) {
  const s = await store(url), k = levelFor(z), name = `${k}/${variable}`, meta = s.meta(name);
  const [H, W] = meta.shape, [CH, CW] = meta.chunks, cs = CELL * 2 ** k, n = 2 ** z;
  // each pixel centre's place in the grid, in cells (0.5 off a cell's corner is its centre)
  const col = Float64Array.from({ length: SIZE }, (_, i) => (((x + (i + 0.5) / SIZE) / n) * 360) / cs - 0.5);
  const row = Float64Array.from({ length: SIZE }, (_, j) => (90 - latOf((y + (j + 0.5) / SIZE) / n)) / cs - 0.5);
  const r0 = Math.max(0, Math.floor(row[0]) - 1), r1 = Math.min(H - 1, Math.floor(row[SIZE - 1]) + 2);
  const c0 = Math.floor(col[0]) - 1, c1 = Math.floor(col[SIZE - 1]) + 2;
  const wrap = (c) => ((c % W) + W) % W; // across the antimeridian
  // the chunks those cells are in, fetched together
  const need = new Map(), chunkCols = new Set();
  for (let c = c0; c <= c1; c++) chunkCols.add(Math.floor(wrap(c) / CW)); // a tile spans a few hundred cells at most
  for (let cr = Math.floor(r0 / CH); cr <= Math.floor(r1 / CH); cr++) {
    for (const cc of chunkCols) { const key = `${url} ${k}/${cr}.${cc}`; need.set(key, chunks(key, () => s.chunk(name, [cr, cc]))); }
  }
  const got = new Map(await Promise.all([...need].map(async ([key, p]) => [key, await p])));
  // the cells around the tile as one block (rows r0…r1, columns c0…c1, wrapped and clamped), copied
  // from their chunks once, so that sampling below is plain indexing
  const ww = c1 - c0 + 1, wh = r1 - r0 + 1, win = new Float32Array(ww * wh);
  const colChunk = new Int32Array(ww), colOff = new Int32Array(ww);
  for (let x = 0; x < ww; x++) { const c = wrap(c0 + x); colChunk[x] = Math.floor(c / CW); colOff[x] = c % CW; }
  for (let y = 0; y < wh; y++) {
    const r = Math.min(H - 1, Math.max(0, r0 + y)), cr = Math.floor(r / CH), ro = (r % CH) * CW;
    let cc = -1, block = null;
    for (let x = 0; x < ww; x++) {
      if (colChunk[x] !== cc) { cc = colChunk[x]; block = got.get(`${url} ${k}/${cr}.${cc}`); } // a new chunk: a few times a row
      win[y * ww + x] = block[ro + colOff[x]];
    }
  }
  const at = (r, c) => win[Math.min(wh - 1, Math.max(0, r - r0)) * ww + (c - c0)];
  const out = new Float32Array(SIZE * SIZE);
  if (nearest) {
    for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) out[j * SIZE + i] = at(Math.round(row[j]), Math.round(col[i]));
    return out;
  }
  // cubic B-spline weights of the four cells around t ∈ [0, 1): the columns' once for the tile
  const bs = (t, w, o) => { const t2 = t * t, t3 = t2 * t; w[o] = (1 - t) ** 3 / 6; w[o + 1] = (3 * t3 - 6 * t2 + 4) / 6; w[o + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6; w[o + 3] = t3 / 6; };
  const wc = new Float64Array(SIZE * 4), cx = new Int32Array(SIZE), wr = new Float64Array(4);
  for (let i = 0; i < SIZE; i++) { const ca = Math.floor(col[i]); cx[i] = ca - 1 - c0; bs(col[i] - ca, wc, i * 4); }
  for (let j = 0; j < SIZE; j++) {
    const ra = Math.floor(row[j]);
    bs(row[j] - ra, wr, 0);
    const y0 = Math.min(wh - 1, Math.max(0, ra - 1 - r0)), y1 = Math.min(wh - 1, Math.max(0, ra - r0)),
      y2 = Math.min(wh - 1, Math.max(0, ra + 1 - r0)), y3 = Math.min(wh - 1, Math.max(0, ra + 2 - r0));
    const rows4 = [y0 * ww, y1 * ww, y2 * ww, y3 * ww];
    for (let i = 0; i < SIZE; i++) {
      const x = cx[i], o = i * 4;
      let sum = 0, sea = 0, ws = 0;
      for (let a = 0; a < 4; a++) {
        const b = rows4[a] + x;
        for (let k = 0; k < 4; k++) {
          const v = win[b + k], w = wr[a] * wc[o + k];
          sum += w * v;
          if (v < 0) { sea += w * v; ws += w; }
        }
      }
      out[j * SIZE + i] = seaOnly && ws > 0 ? sea / ws : sum;
    }
  }
  return out;
}

// metres at the pixel centres of tile z/x/y; rejects if the store cannot be read (the tile fails,
// as any tile does: the map reports it)
export const gebcoTile = (z, x, y) => gridTile(GEBCO, 'elevation', z, x, y, false);
export const gebcoSeaTile = (z, x, y) => gridTile(GEBCO, 'elevation', z, x, y, false, true);

// MapLibre tile handler for gebco-tid://z/x/y: each cell coloured by the group of its code; land and
// no data transparent
const RGBA = new Uint8ClampedArray(128 * 4); // code × 4 → r, g, b, 255 of its group (alpha 0: not drawn)
for (const { ranges, colour } of DEPTH_SOURCES) for (const [lo, hi] of ranges) for (let c = lo; c <= hi; c++) RGBA.set([...[1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)), 255], c * 4);
export async function tidTile({ url }) {
  const [z, x, y] = /^gebco-tid:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(url).slice(1).map(Number);
  const codes = await gridTile(GEBCO_TID, 'tid', z, x, y, true), img = new ImageData(SIZE, SIZE);
  const d = img.data; // 65k cells a tile, on the page's thread: bytes written in place, nothing allocated per cell
  for (let p = 0, q = 0; p < codes.length; p++, q += 4) {
    const k = codes[p] * 4;
    if (RGBA[k + 3]) { d[q] = RGBA[k]; d[q + 1] = RGBA[k + 1]; d[q + 2] = RGBA[k + 2]; d[q + 3] = 255; }
  }
  return { data: await createImageBitmap(img) };
}

// GEBCO's type identifier code of the 15″ cell holding lon/lat: how its depth was obtained
export async function tidAt(lon, lat) {
  const s = await store(GEBCO_TID), name = '0/tid', meta = s.meta(name), [H, W] = meta.shape, [CH, CW] = meta.chunks;
  const r = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / CELL))), c = ((Math.floor((lon + 180) / CELL) % W) + W) % W;
  const cells = await chunks(`${GEBCO_TID} 0/${Math.floor(r / CH)}.${Math.floor(c / CW)}`, () => s.chunk(name, [Math.floor(r / CH), Math.floor(c / CW)]));
  return cells[(r % CH) * CW + (c % CW)];
}
