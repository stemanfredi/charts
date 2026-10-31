#!/usr/bin/env node
// GEBCO's grids as Zarr stores for Charts: the grid itself repacked, the same cells and values,
// north up, in square compressed chunks, with coarser levels. The stores are published as plain
// files at geodata.makaw.org/gebco-2026/ (README: Hosting the data yourself); site/zarr.js reads them.
//
//   node tools/gebco.mjs download DIR                    the grids from CEDA into DIR (resumable)
//   node tools/gebco.mjs build DIR elevation|tid         DIR/zarr/gebco-2026/<grid>.zarr
//          [--workers N] [--scratch DIR2]                (default: all cores; DIR2: a local disk)
//   node tools/gebco.mjs verify DIR elevation|tid        the store against the grid's files
//
// elevation  GEBCO's elevation (ice surface), int16 metres. Level k+1: the mean of 2 × 2 cells of
//            level k (from the unrounded means), rounded to whole metres, a half upwards (for a
//            depth, the shallower). No data −32768 (0 m is a real elevation along every coast).
// tid        GEBCO's type identifier grid: how each cell's depth was obtained (int8 codes: 0 land,
//            10–17 direct measurements, 40–47 indirect, 70–72 unknown or from another grid). Level
//            k+1: the most common code of 2 × 2 cells of level k, on a tie the higher (the less
//            certain source: a coarse view never shows more measured seabed than there is). No
//            data 127, as GEBCO marks it.
//
// Layout (a multiscale group, each level a group of its own, so xarray and GDAL open any level):
//   .zgroup .zattrs .zmetadata       root; .zmetadata holds every level's metadata (consolidated)
//   <k>/<grid>                       level k: 43200/2^k × 86400/2^k cells of 15″·2^k
//   <k>/latitude, <k>/longitude      its cell centres (latitude descending: row 0 is the north)
// Levels 0–6 (16′ cells: the world in 2 × 3 chunks). Chunks of 512 × 512 cells, each one Blosc
// block: byte shuffle, then zlib (Node's own; the page decompresses with the browser's own); edge
// chunks padded with the fill value, as Zarr stores them. Level 0 is read from the grid's eight
// GeoTIFFs (uncompressed, row by row: read directly); each next level goes through a scratch file.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { openSync, readSync, writeSync, closeSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { openStore, readCells } from '../site/zarr.js';
import { lru } from '../site/net.js';

const RELEASE = 'gebco-2026';
const CEDA = 'https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2026';
const LISTING = 'https://data.ceda.ac.uk/bodc/gebco/global/gebco_2026';
const CHUNK = 512, LEVELS = 7;

// 2 × 2 means of an h × w array (h, w even) → Float32Array
export function mean2(a, h, w) {
  const out = new Float32Array((h / 2) * (w / 2));
  for (let y = 0; y < h / 2; y++) {
    const r0 = 2 * y * w, r1 = r0 + w, o = y * (w / 2);
    for (let x = 0; x < w / 2; x++) out[o + x] = (a[r0 + 2 * x] + a[r0 + 2 * x + 1] + a[r1 + 2 * x] + a[r1 + 2 * x + 1]) / 4;
  }
  return out;
}
// 2 × 2 most common values of an h × w array (h, w even), on a tie the highest → Int8Array
export function mode2(a, h, w) {
  const out = new Int8Array((h / 2) * (w / 2));
  for (let y = 0; y < h / 2; y++) {
    const r0 = 2 * y * w, r1 = r0 + w;
    for (let x = 0; x < w / 2; x++) {
      const q = [a[r0 + 2 * x], a[r0 + 2 * x + 1], a[r1 + 2 * x], a[r1 + 2 * x + 1]];
      let best = q[0], score = -1;
      for (const v of q) {
        const s = q.filter((u) => u === v).length * 256 + v;
        if (s > score) { best = v; score = s; }
      }
      out[y * (w / 2) + x] = best;
    }
  }
  return out;
}

const GRIDS = {
  elevation: {
    remote: 'ice_surface_elevation', local: 'elevation', match: /^gebco_2026_n.*_geotiff\.tif$/, T: Int16Array, dtype: '<i2', fill: -32768,
    work: Float32Array, down: mean2, store: (a) => { const o = new Int16Array(a.length); for (let i = 0; i < a.length; i++) o[i] = Math.round(a[i]); return o; }, type: 'mean',
    attrs: { units: 'm', long_name: 'Elevation relative to mean sea level (negative below it), ice surface' },
    title: 'GEBCO 2026 Grid, ice surface elevation, as a multiscale Zarr store',
    history: 'Level 0: the GEBCO 2026 grid unchanged (15 arc-second cells, metres). Level k+1: mean of 2 x 2 cells of level k, rounded to whole metres. Built for Charts (tools/gebco.mjs).',
  },
  tid: {
    remote: 'type_identifier_grid', local: 'tid', match: /^gebco_2026_tid_n.*_geotiff\.tif$/, T: Int8Array, dtype: '|i1', fill: 127,
    work: Int8Array, down: mode2, store: (a) => a, type: 'mode',
    attrs: {
      long_name: 'GEBCO type identifier: how the depth of each cell was obtained',
      flag_groups: { 0: 'land', '10-17': 'direct measurement (surveys, soundings)', '40-47': 'indirect (predicted from satellite gravity, interpolated, from charts)', '70-72': 'unknown, or from another grid' },
      references: "https://www.gebco.net/data-products/gridded-bathymetry-data (the codes, in GEBCO's documentation)",
    },
    title: 'GEBCO 2026 Grid, type identifier (TID), as a multiscale Zarr store',
    history: 'Level 0: the GEBCO 2026 TID grid unchanged (15 arc-second cells). Level k+1: the most common code of 2 x 2 cells of level k, on a tie the higher (less certain) code. Built for Charts (tools/gebco.mjs).',
  },
};

// ---- GeoTIFF: the grid's files are uncompressed and stored row by row, so rows are read directly ----

// file → { width, height, bytes (per cell), offset (of row 0) }; anything else is refused
function tiffLayout(fd) {
  const read = (pos, n) => { const b = Buffer.alloc(n); readSync(fd, b, 0, n, pos); return b; };
  const h = read(0, 8);
  if (h.toString('latin1', 0, 2) !== 'II' || h.readUInt16LE(2) !== 42) throw new Error('not a little-endian classic TIFF');
  const ifd = h.readUInt32LE(4), n = read(ifd, 2).readUInt16LE(0), e = read(ifd + 2, n * 12), tags = {};
  for (let k = 0; k < n; k++) {
    const tag = e.readUInt16LE(k * 12), type = e.readUInt16LE(k * 12 + 2), count = e.readUInt32LE(k * 12 + 4);
    const size = { 1: 1, 3: 2, 4: 4 }[type];
    if (!size) continue; // ASCII, doubles (GeoTIFF keys, no-data text): not needed here
    const raw = count * size <= 4 ? e.subarray(k * 12 + 8, k * 12 + 12) : read(e.readUInt32LE(k * 12 + 8), count * size);
    tags[tag] = Array.from({ length: count }, (_, i) => (size === 1 ? raw[i] : size === 2 ? raw.readUInt16LE(i * 2) : raw.readUInt32LE(i * 4)));
  }
  const [width] = tags[256], [height] = tags[257], [bits] = tags[258], bytes = bits / 8;
  if ((tags[259]?.[0] ?? 1) !== 1) throw new Error('compressed TIFF');
  if ((tags[277]?.[0] ?? 1) !== 1 || (tags[284]?.[0] ?? 1) !== 1) throw new Error('more than one band');
  if (!tags[273]) throw new Error('tiled TIFF (expected strips)');
  const offsets = tags[273], rows = tags[278]?.[0] ?? height;
  offsets.forEach((o, i) => { if (o !== offsets[0] + i * rows * width * bytes) throw new Error('strips not contiguous'); });
  return { width, height, bytes, offset: offsets[0] };
}

// the grid's eight files (90° × 90° each, named by their bounds) → { files, cells, rows, cols }
function openGrid(dir, name) {
  const g = GRIDS[name], folder = join(dir, g.local), files = new Map();
  for (const f of readdirSync(folder).filter((x) => g.match.test(x))) {
    const [n, , w] = /_n(-?[\d.]+)_s(-?[\d.]+)_w(-?[\d.]+)_e/.exec(f).slice(1).map(Number);
    const fd = openSync(join(folder, f), 'r'), layout = tiffLayout(fd);
    files.set(`${Math.round((90 - n) / 90)},${Math.round((w + 180) / 90)}`, { fd, ...layout });
  }
  if (files.size !== 8) throw new Error(`${folder}: expected 8 files, found ${files.size}`);
  const cells = files.get('0,0').width;
  for (const f of files.values()) if (f.width !== cells || f.height !== cells || f.bytes !== g.T.BYTES_PER_ELEMENT) throw new Error('files differ in size or type');
  return { files, cells, rows: 2 * cells, cols: 4 * cells, T: g.T };
}

// rows r0..r1−1 of the whole grid, all columns
function readRows(grid, r0, r1) {
  const { files, cells, cols, T } = grid, out = new T((r1 - r0) * cols), bpe = T.BYTES_PER_ELEMENT;
  for (let rb = Math.floor(r0 / cells); rb <= Math.floor((r1 - 1) / cells); rb++) {
    const a = Math.max(r0, rb * cells), z = Math.min(r1, (rb + 1) * cells);
    for (let cb = 0; cb < 4; cb++) {
      const f = files.get(`${rb},${cb}`), buf = Buffer.alloc((z - a) * cells * bpe);
      readSync(f.fd, buf, 0, buf.length, f.offset + (a - rb * cells) * cells * bpe);
      const v = new T(buf.buffer, buf.byteOffset, (z - a) * cells);
      for (let r = 0; r < z - a; r++) out.set(v.subarray(r * cells, (r + 1) * cells), (a - r0 + r) * cols + cb * cells);
    }
  }
  return out;
}

// ---- Zarr chunks ----------------------------------------------------------------------------------

// bytes of `typesize`-byte numbers → one Blosc block (format 2): byte shuffle, then one zlib stream
// (blocks not split); stored as is where zlib would not make it smaller. site/zarr.js reads both.
export function bloscEncode(bytes, typesize, level = 9) {
  const n = bytes.length, m = n / typesize, sh = new Uint8Array(n);
  if (typesize > 1) { for (let i = 0; i < m; i++) for (let j = 0; j < typesize; j++) sh[j * m + i] = bytes[i * typesize + j]; } else sh.set(bytes);
  const z = deflateSync(sh, { level });
  const header = (flags, cbytes) => {
    const h = Buffer.alloc(16);
    h[0] = 2; h[1] = 1; h[2] = flags; h[3] = typesize; // format 2, zlib format 1, flags, type size
    h.writeUInt32LE(n, 4); h.writeUInt32LE(n, 8); h.writeUInt32LE(cbytes, 12); // bytes, block size, compressed size
    return h;
  };
  if (z.length + 8 >= n) return Buffer.concat([header(0x02 | (3 << 5), 16 + n), Buffer.from(bytes)]); // stored as is
  const start = Buffer.alloc(8);
  start.writeUInt32LE(20, 0); start.writeInt32LE(z.length, 4); // where the block starts (just after this); there, its stream's length
  return Buffer.concat([header((typesize > 1 ? 0x01 : 0) | 0x10 | (3 << 5), 24 + z.length), start, z]); // shuffle, not split, zlib
}

// one chunk row of a level (≤ CHUNK rows, all columns) → its chunk files; the bytes written
function writeChunks(out, name, level, rowChunk, values, rows, cols) {
  const g = GRIDS[name], dir = join(out, String(level), name);
  let size = 0;
  for (let c = 0; c < cols; c += CHUNK) {
    const block = new g.T(CHUNK * CHUNK).fill(g.fill), w = Math.min(CHUNK, cols - c);
    for (let r = 0; r < rows; r++) block.set(values.subarray(r * cols + c, r * cols + c + w), r * CHUNK);
    const data = bloscEncode(new Uint8Array(block.buffer), g.T.BYTES_PER_ELEMENT);
    writeFileSync(join(dir, `${rowChunk}.${c / CHUNK}`), data);
    size += data.length;
  }
  return size;
}

// ---- building: chunk rows shared among worker threads -----------------------------------------------

// one chunk row of a level: its chunks written, and its share of the next level into `next`
function job({ dir, name, out, level, band, rows: H, cols: W, cur, next }) {
  const g = GRIDS[name], r0 = band * CHUNK, r1 = Math.min(H, r0 + CHUNK), n = r1 - r0;
  let work;
  if (level === 0) work = readRows(openGrid.cache ||= openGrid(dir, name), r0, r1);
  else {
    const fd = openSync(cur, 'r'), bpe = g.work.BYTES_PER_ELEMENT, buf = Buffer.alloc(n * W * bpe);
    readSync(fd, buf, 0, buf.length, r0 * W * bpe);
    closeSync(fd);
    work = new g.work(buf.buffer, buf.byteOffset, n * W);
  }
  const size = writeChunks(out, name, level, band, level === 0 ? work : g.store(work), n, W);
  if (next) {
    const down = g.down(work, n, W), fd = openSync(next, 'r+');
    writeSync(fd, new Uint8Array(down.buffer, down.byteOffset, down.byteLength), 0, down.byteLength, (r0 / 2) * (W / 2) * g.work.BYTES_PER_ELEMENT);
    closeSync(fd);
  }
  return size;
}

if (!isMainThread && workerData?.gebco) parentPort.on('message', (j) => parentPort.postMessage(job(j)));

function zarray(shape, chunks, dtype, compressor, fill) {
  return { zarr_format: 2, shape, chunks, dtype, compressor, fill_value: fill, order: 'C', filters: null };
}

// the store of grid `name` from DIR's files, levels 0…levels−1
export async function build(dir, name, { out = join(dir, 'zarr', RELEASE, `${name}.zarr`), scratch = join(dir, 'zarr'), workers = cpus().length, levels = LEVELS, log = console.log } = {}) {
  const g = GRIDS[name], grid = openGrid(dir, name), t0 = Date.now();
  for (const f of grid.files.values()) closeSync(f.fd);
  rmSync(out, { recursive: true, force: true });
  const shapes = Array.from({ length: levels }, (_, k) => [grid.rows / 2 ** k, grid.cols / 2 ** k]);
  shapes.forEach((_, k) => mkdirSync(join(out, String(k), name), { recursive: true }));
  mkdirSync(scratch, { recursive: true });
  const pool = Array.from({ length: workers }, () => new Worker(fileURLToPath(import.meta.url), { workerData: { gebco: true } }));
  const run = (jobs) => new Promise((resolve, reject) => {
    let next = 0, done = 0, size = 0;
    const give = (w) => { if (next < jobs.length) w.postMessage(jobs[next++]); };
    for (const w of pool) {
      w.removeAllListeners('message').removeAllListeners('error');
      w.on('message', (s) => { size += s; done++; if (done === jobs.length) resolve(size); else give(w); });
      w.on('error', reject);
      give(w);
    }
  });
  let total = 0, cur = null;
  try {
    for (let k = 0; k < levels; k++) {
      const [H, W] = shapes[k], nxt = k + 1 < levels ? join(scratch, `.${name}-level${k + 1}`) : null;
      if (nxt) { writeFileSync(nxt, ''); writeTruncate(nxt, (H / 2) * (W / 2) * g.work.BYTES_PER_ELEMENT); }
      total += await run(Array.from({ length: Math.ceil(H / CHUNK) }, (_, band) => ({ dir, name, out, level: k, band, rows: H, cols: W, cur, next: nxt })));
      if (cur) rmSync(cur);
      cur = nxt;
      log(`level ${k}: ${H} × ${W} cells, ${(total / 1e9).toFixed(2)} GB, ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
    }
  } finally {
    await Promise.all(pool.map((w) => w.terminate()));
  }
  // coordinates and metadata
  const meta = {};
  shapes.forEach(([H, W], k) => {
    const cs = (90 / grid.cells) * 2 ** k; // 15″ at level 0 for GEBCO (21600 cells per 90°)
    for (const [coord, n, at, units] of [['latitude', H, (i) => 90 - (i + 0.5) * cs, 'degrees_north'], ['longitude', W, (i) => -180 + (i + 0.5) * cs, 'degrees_east']]) {
      mkdirSync(join(out, String(k), coord), { recursive: true });
      writeFileSync(join(out, String(k), coord, '0'), new Uint8Array(Float64Array.from({ length: n }, (_, i) => at(i)).buffer));
      meta[`${k}/${coord}/.zarray`] = zarray([n], [n], '<f8', null, null);
      meta[`${k}/${coord}/.zattrs`] = { _ARRAY_DIMENSIONS: [coord], units, standard_name: coord };
    }
    meta[`${k}/${name}/.zarray`] = zarray([H, W], [CHUNK, CHUNK], g.dtype, { id: 'blosc', cname: 'zlib', clevel: 9, shuffle: g.T.BYTES_PER_ELEMENT > 1 ? 1 : 0, blocksize: 0 }, g.fill);
    meta[`${k}/${name}/.zattrs`] = { _ARRAY_DIMENSIONS: ['latitude', 'longitude'], ...g.attrs, cell_size_degrees: cs, north: 90, west: -180 };
    meta[`${k}/.zgroup`] = { zarr_format: 2 };
    meta[`${k}/.zattrs`] = { cell_size_degrees: cs };
  });
  meta['.zgroup'] = { zarr_format: 2 };
  meta['.zattrs'] = {
    title: g.title,
    source: 'GEBCO Compilation Group (2026) GEBCO 2026 Grid; https://www.gebco.net (files from CEDA, dap.ceda.ac.uk/bodc/gebco/global/gebco_2026)',
    licence: 'Free to use and redistribute, with this attribution, without suggesting GEBCO endorses the product (GEBCO terms of use)',
    history: g.history,
    multiscales: [{
      version: '0.4', name, type: g.type, axes: [{ name: 'latitude', type: 'space', unit: 'degree' }, { name: 'longitude', type: 'space', unit: 'degree' }],
      datasets: shapes.map((_, k) => ({ path: `${k}/${name}`, coordinateTransformations: [{ type: 'scale', scale: [-meta[`${k}/.zattrs`].cell_size_degrees, meta[`${k}/.zattrs`].cell_size_degrees] }, { type: 'translation', translation: [90, -180] }] })),
    }],
  };
  for (const [key, v] of Object.entries(meta)) writeFileSync(join(out, key), JSON.stringify(v));
  writeFileSync(join(out, '.zmetadata'), JSON.stringify({ zarr_consolidated_format: 1, metadata: meta }));
  log(`done: ${(total / 1e9).toFixed(2)} GB of chunks in ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
  return { out, total };
}
function writeTruncate(path, size) { const fd = openSync(path, 'r+'); try { writeSync(fd, new Uint8Array(1), 0, 1, size - 1); } finally { closeSync(fd); } }

// ---- verify: the store against the grid's files ------------------------------------------------------

export async function verify(dir, name, { out = join(dir, 'zarr', RELEASE, `${name}.zarr`), samples = 20000, log = console.log } = {}) {
  const g = GRIDS[name], grid = openGrid(dir, name);
  const store = await openStore(out, async (path) => { try { return new Uint8Array(readFileSync(path)); } catch { return null; } });
  // the samples read one cell at a time: each chunk decoded once, not once per cell
  const decoded = lru(64), rawChunk = store.chunk;
  store.chunk = (nm, idx) => decoded(`${nm}/${idx.join('.')}`, () => rawChunk(nm, idx));
  const levels = JSON.parse(readFileSync(join(out, '.zmetadata'))).metadata['.zattrs'].multiscales[0].datasets.length;
  const src = (r, c) => readRows(grid, r, r + 1)[c];
  const cellAt = async (k, r, c) => (await readCells(store, `${k}/${name}`, 0, 0, { rows: [r], cols: [c] }))[0];
  let rng = 1; const rand = (n) => { rng = (rng * 48271) % 2147483647; return rng % n; }; // repeatable
  const report = [];
  // level 0: the files' cells
  let bad = 0;
  for (let i = 0; i < samples; i++) {
    const r = rand(grid.rows), c = rand(grid.cols), want = src(r, c), got = await cellAt(0, r, c);
    if (!(got === want || (Number.isNaN(got) && want === g.fill))) bad++;
  }
  report.push(`level 0: ${samples} cells against the files, ${bad} differ`);
  // level k: the rule from the level before (elevation: from the files, the exact mean of its block)
  for (let k = 1; k < levels; k++) {
    bad = 0;
    const f = 2 ** k, n = Math.max(200, samples / 50 / k);
    for (let i = 0; i < n; i++) {
      const r = rand(grid.rows / f), c = rand(grid.cols / f);
      let want;
      if (name === 'elevation') {
        const rows = readRows(grid, r * f, (r + 1) * f);
        let s = 0;
        for (let y = 0; y < f; y++) for (let x = 0; x < f; x++) s += rows[y * grid.cols + c * f + x];
        want = Math.round(s / (f * f));
      } else {
        const q = await Promise.all([[0, 0], [0, 1], [1, 0], [1, 1]].map(([dy, dx]) => cellAt(k - 1, 2 * r + dy, 2 * c + dx)));
        want = mode2(Int8Array.from(q), 2, 2)[0];
      }
      if ((await cellAt(k, r, c)) !== want) bad++;
    }
    report.push(`level ${k}: ${n} cells against ${name === 'elevation' ? `the mean of their ${f} × ${f} cells` : 'the most common code below them'}, ${bad} differ`);
  }
  report.forEach((l) => log(l));
  return report.every((l) => / 0 differ$/.test(l));
}

// ---- download: the grids from CEDA, resumable, each file's size checked ------------------------------

export async function download(dir, { log = console.log } = {}) {
  let ok = true;
  for (const g of Object.values(GRIDS)) {
    const r = await fetch(`${LISTING}/${g.remote}/geotiff?json`);
    if (!r.ok) throw new Error(`CEDA listing: HTTP ${r.status}`);
    const files = (await r.json()).items.filter((i) => g.match.test(i.name));
    mkdirSync(join(dir, g.local), { recursive: true });
    for (const { name, size } of files) {
      const path = join(dir, g.local, name);
      for (let attempt = 1; attempt <= 5; attempt++) {
        const have = (() => { try { return statSync(path).size; } catch { return 0; } })();
        if (have === size) break;
        if (have > size) rmSync(path);
        // a network error (the error itself) is an attempt failed, as a bad status is
        const res = await fetch(`${CEDA}/${g.remote}/geotiff/${name}`, { headers: have && have < size ? { Range: `bytes=${have}-` } : {} }).catch((e) => e);
        if (!res.ok) { log(`${name}: ${res.status ? `HTTP ${res.status}` : res.message}, attempt ${attempt}`); continue; }
        const append = res.status === 206, file = createWriteStream(path, { flags: append ? 'a' : 'w' });
        try { for await (const part of res.body) if (!file.write(part)) await new Promise((r2) => file.once('drain', r2)); } catch (e) { log(`${name}: ${e.message}, attempt ${attempt}`); }
        await new Promise((r2) => file.end(r2));
      }
      const have = statSync(path).size;
      log(`${have === size ? 'have' : 'INCOMPLETE'} ${g.local}/${name} (${have} of ${size} bytes)`);
      ok &&= have === size;
    }
  }
  return ok;
}

if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, dir, name] = process.argv.slice(2), opt = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  if (!dir || (cmd !== 'download' && !GRIDS[name])) { console.error('usage: node tools/gebco.mjs download DIR | build DIR elevation|tid [--workers N] [--scratch DIR2] | verify DIR elevation|tid'); process.exit(2); }
  if (cmd === 'download') process.exit((await download(dir)) ? 0 : 1);
  else if (cmd === 'build') await build(dir, name, { workers: Number(opt('workers')) || undefined, scratch: opt('scratch') });
  else if (cmd === 'verify') process.exit((await verify(dir, name)) ? 0 : 1);
  else { console.error(`unknown command ${cmd}`); process.exit(2); }
}
