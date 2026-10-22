// GEBCO 2026 depths for the sea's elevation tiles (clip.js): the grid of 15″ cells, published as a
// multiscale Zarr store (tools/gebco.mjs builds it, GEBCO in catalog.js says where), sampled at a
// tile's pixel centres. Each zoom reads the coarsest level whose cells are no larger than its
// pixels (level 0, GEBCO's own cells, from zoom 8 up), interpolated between cell centres in
// floating point, so no precision is lost however far the map zooms in. Chunks (512 × 512 cells,
// about 2° at level 0) are shared by many neighbouring tiles: the latest are kept.
import { openStore } from './zarr.js';
import { latOf } from './geo.js';
import { FETCH, memo } from './net.js';
import { GEBCO } from './catalog.js';

const SIZE = 256, CELL = 15 / 3600, LEVELS = 7, KEEP = 48; // KEEP: chunks kept, 512 kB each

// the level for tiles of zoom z: the coarsest whose cells are no larger than the tile's pixels
export const levelFor = (z) => Math.max(0, Math.min(LEVELS - 1, Math.floor(Math.log2(360 / (SIZE * 2 ** z) / CELL))));

const once = {};
const store = () => memo(once, 'store', () => openStore(GEBCO, async (url) => {
  const r = await fetch(url, FETCH);
  if (r.status === 404 || r.status === 403) return null; // a chunk not stored: the fill value
  if (!r.ok) throw new Error(`GEBCO: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}));

const chunks = new Map(); // `level/row.col` → promise of the chunk's cells, the latest last
function chunk(s, name, key, idx) {
  if (chunks.has(key)) { const c = chunks.get(key); chunks.delete(key); chunks.set(key, c); return c; }
  const c = s.chunk(name, idx).catch((e) => { chunks.delete(key); throw e; });
  chunks.set(key, c);
  if (chunks.size > KEEP) chunks.delete(chunks.keys().next().value);
  return c;
}

// metres at the pixel centres of 256 px Web Mercator tile z/x/y, row-major, north up; rejects if
// the store cannot be read (clip.js then falls back to Terrarium)
export async function gebcoTile(z, x, y) {
  const s = await store(), k = levelFor(z), name = `${k}/elevation`, meta = s.meta(name);
  const [H, W] = meta.shape, [CH, CW] = meta.chunks, cs = CELL * 2 ** k, n = 2 ** z;
  // each pixel centre's place in the grid, in cells (0.5 off a cell's corner is its centre)
  const col = Float64Array.from({ length: SIZE }, (_, i) => (((x + (i + 0.5) / SIZE) / n) * 360) / cs - 0.5);
  const row = Float64Array.from({ length: SIZE }, (_, j) => (90 - latOf((y + (j + 0.5) / SIZE) / n)) / cs - 0.5);
  const r0 = Math.max(0, Math.floor(row[0])), r1 = Math.min(H - 1, Math.floor(row[SIZE - 1]) + 1);
  const c0 = Math.floor(col[0]), c1 = Math.floor(col[SIZE - 1]) + 1;
  const wrap = (c) => ((c % W) + W) % W; // across the antimeridian
  // the chunks those cells are in, fetched together
  const need = new Map(), chunkCols = new Set();
  for (let c = c0; c <= c1; c++) chunkCols.add(Math.floor(wrap(c) / CW)); // a tile spans a few hundred cells at most
  for (let cr = Math.floor(r0 / CH); cr <= Math.floor(r1 / CH); cr++) {
    for (const cc of chunkCols) { const key = `${k}/${cr}.${cc}`; need.set(key, chunk(s, name, key, [cr, cc])); }
  }
  const got = new Map(await Promise.all([...need].map(async ([key, p]) => [key, await p])));
  const cell = (r, c) => {
    r = Math.min(H - 1, Math.max(0, r)); c = wrap(c);
    return got.get(`${k}/${Math.floor(r / CH)}.${Math.floor(c / CW)}`)[(r % CH) * CW + (c % CW)];
  };
  const out = new Float32Array(SIZE * SIZE);
  for (let j = 0; j < SIZE; j++) {
    const v = row[j], ra = Math.floor(v), fr = v - ra;
    for (let i = 0; i < SIZE; i++) {
      const u = col[i], ca = Math.floor(u), fc = u - ca;
      out[j * SIZE + i] = (cell(ra, ca) * (1 - fc) + cell(ra, ca + 1) * fc) * (1 - fr) + (cell(ra + 1, ca) * (1 - fc) + cell(ra + 1, ca + 1) * fc) * fr;
    }
  }
  return out;
}
