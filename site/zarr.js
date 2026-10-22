// Zarr stores (version 2), public and readable from a page: Copernicus Marine's datasets ("timeChunked":
// a chunk is one or a few time steps over a large block of the grid), EMODnet's depth model, GEBCO's
// grids (tools/gebco.mjs builds them). What these stores use, and nothing more: Blosc (version 1
// format) with LZ4 or zlib, and byte shuffle; little-endian int8, int16, int32, float32, float64;
// C order; coordinates time, [elevation,] latitude, longitude.

// ---- Blosc ----------------------------------------------------------------------------------

// LZ4 block format: src → dst (its decompressed size known); the bytes written
function lz4(src, dst) {
  let i = 0, o = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) for (let b = 255; b === 255; lit += b) b = src[i++];
    dst.set(src.subarray(i, i + lit), o);
    i += lit;
    o += lit;
    if (i >= src.length) break; // the last sequence is literals only
    const off = src[i] | (src[i + 1] << 8);
    i += 2;
    let len = token & 15;
    if (len === 15) for (let b = 255; b === 255; len += b) b = src[i++];
    for (let end = o + len + 4; o < end; o++) dst[o] = dst[o - off]; // may overlap itself: byte by byte
  }
  return o;
}

// a zlib stream → its bytes, by the browser's own decompressor
async function inflate(src, size) {
  const out = new Uint8Array(await new Response(new Blob([src]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  if (out.length !== size) throw new Error('Blosc: a zlib stream decodes short');
  return out;
}

// a Blosc buffer (16-byte header, block starts, blocks of LZ4 or zlib streams) → promise of its
// bytes. Flags: 1 byte shuffle, 2 stored as is, 4 bit shuffle (not used here), 16 blocks not split
// by byte; the compressor in the top 3 bits (1: LZ4 or LZ4HC, 3: zlib). A block is split into one
// stream per byte of the type, but for the last, short one; a stream as long as its output is
// stored as is.
export async function unblosc(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flags = b[2], typesize = b[3], nbytes = v.getUint32(4, true), blocksize = v.getUint32(8, true);
  const out = new Uint8Array(nbytes);
  if (flags & 2) { out.set(b.subarray(16, 16 + nbytes)); return out; }
  if (flags & 4) throw new Error('Blosc: bit shuffle is not supported');
  const codec = flags >> 5;
  if (codec !== 1 && codec !== 3) throw new Error(`Blosc: compressor ${codec} is neither LZ4 nor zlib`);
  const tmp = new Uint8Array(blocksize);
  for (let k = 0, n = Math.ceil(nbytes / blocksize); k < n; k++) {
    const size = Math.min(blocksize, nbytes - k * blocksize), streams = !(flags & 16) && size === blocksize ? typesize : 1;
    const part = size / streams;
    for (let s = 0, p = v.getUint32(16 + 4 * k, true); s < streams; s++) {
      const cb = v.getInt32(p, true);
      p += 4;
      const dst = tmp.subarray(s * part, (s + 1) * part);
      if (cb === part) dst.set(b.subarray(p, p + cb));
      else if (codec === 3) dst.set(await inflate(b.subarray(p, p + cb), part));
      else if (lz4(b.subarray(p, p + cb), dst) !== part) throw new Error('Blosc: a stream decodes short');
      p += cb;
    }
    const dst = out.subarray(k * blocksize, k * blocksize + size);
    if (flags & 1 && typesize > 1) { // byte shuffle: all first bytes, all second bytes…; a tail of size % typesize as is
      const m = Math.floor(size / typesize);
      for (let j = 0; j < typesize; j++) for (let i = 0; i < m; i++) dst[i * typesize + j] = tmp[j * m + i];
      dst.set(tmp.subarray(m * typesize, size), m * typesize);
    } else dst.set(tmp.subarray(0, size));
  }
  return out;
}

// ---- arrays ---------------------------------------------------------------------------------

const TYPES = { '|i1': Int8Array, '<i2': Int16Array, '<i4': Int32Array, '<f4': Float32Array, '<f8': Float64Array };
// a chunk's bytes (Blosc, or none: the chunk is not stored, all fill) → promise of numbers of the
// array's dtype
export async function decode(meta, bytes) {
  const T = TYPES[meta.dtype];
  if (!T) throw new Error(`Zarr: dtype ${meta.dtype} is not supported`);
  const n = meta.chunks.reduce((a, c) => a * c, 1);
  if (!bytes) return new T(n).fill(meta.fill_value ?? 0);
  const raw = meta.compressor ? await unblosc(bytes) : bytes;
  return new T(raw.buffer.slice(raw.byteOffset, raw.byteOffset + n * T.BYTES_PER_ELEMENT));
}

// CF time units ("hours since 1950-01-01", "seconds since 1970-01-01 00:00:00") → value → ms
export function timeScale(units) {
  const m = /^(days|hours|minutes|seconds) since (\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(units || '');
  if (!m) throw new Error(`Zarr: time units "${units}"`);
  const unit = { days: 864e5, hours: 36e5, minutes: 6e4, seconds: 1e3 }[m[1]], epoch = Date.parse(`${m[2]}T${m[3] || '00:00:00'}Z`);
  return (v) => epoch + v * unit;
}

// A store: its consolidated metadata, and chunks as they are asked for. fetchBytes(url) → bytes, or
// null for a chunk that is not stored (the store says 403 or 404: all land, or a time no longer kept).
export async function openStore(url, fetchBytes) {
  const head = await fetchBytes(`${url}/.zmetadata`);
  if (!head) throw new Error(`Zarr: no consolidated metadata at ${url} (moved, or not public)`);
  const md = JSON.parse(new TextDecoder().decode(head)).metadata;
  const meta = (name) => md[`${name}/.zarray`] && { ...md[`${name}/.zarray`], attrs: md[`${name}/.zattrs`] || {} };
  const chunk = (name, idx) => fetchBytes(`${url}/${name}/${idx.join('.')}`).then((b) => decode(meta(name), b));
  // a whole one-dimensional array (a coordinate), its chunks end to end
  const coord = async (name) => {
    const m = meta(name), parts = await Promise.all(Array.from({ length: Math.ceil(m.shape[0] / m.chunks[0]) }, (_, k) => chunk(name, [k])));
    const out = new Float64Array(m.shape[0]);
    parts.forEach((p, k) => out.set(p.subarray(0, Math.min(m.chunks[0], m.shape[0] - k * m.chunks[0])), k * m.chunks[0]));
    return out;
  };
  return { meta, chunk, coord };
}

// The index of the value nearest to x in a sorted coordinate, or -1 if none is within tol
export function nearest(values, x, tol = Infinity) {
  let best = -1;
  for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - x) <= tol && (best < 0 || Math.abs(values[i] - x) < Math.abs(values[best] - x))) best = i;
  return best;
}

// The cells of a regular lat/lon grid (coordinates of cell centres) over [west, south, east, north],
// at most `max` of them (every step-th row and column beyond): { rows, cols, step }. Rows run north
// to south as indices into the latitude coordinate; columns west to east into the longitude one,
// wrapping round a global grid (a view across the antimeridian), clipped to a regional one.
export function cellsOf(lat, lon, [w, s, e, n], max = 4e6) {
  const dlat = (lat[lat.length - 1] - lat[0]) / (lat.length - 1), dlon = (lon[lon.length - 1] - lon[0]) / (lon.length - 1);
  const global = Math.abs(dlon * lon.length - 360) < Math.abs(dlon);
  const rowOf = (y) => (y - lat[0]) / dlat, colOf = (x) => (x - lon[0]) / dlon;
  let r0 = Math.ceil(Math.min(rowOf(s), rowOf(n)) - 0.5), r1 = Math.floor(Math.max(rowOf(s), rowOf(n)) + 0.5);
  let c0 = Math.ceil(colOf(w) - 0.5), c1 = Math.floor(colOf(e) + 0.5);
  r0 = Math.max(0, r0); r1 = Math.min(lat.length - 1, r1);
  if (global) c1 = Math.min(c1, c0 + lon.length - 1); else { c0 = Math.max(0, c0); c1 = Math.min(lon.length - 1, c1); }
  if (r1 < r0 || c1 < c0) return { rows: [], cols: [], step: 1 };
  let step = Math.max(1, Math.floor(Math.sqrt(((r1 - r0 + 1) * (c1 - c0 + 1)) / max)));
  while (Math.ceil((r1 - r0 + 1) / step) * Math.ceil((c1 - c0 + 1) / step) > max) step++;
  const rows = [], cols = [];
  for (let r = r0; r <= r1; r += step) rows.push(r);
  if (dlat > 0) rows.reverse(); // latitudes ascending: the north is the end
  for (let c = c0; c <= c1; c += step) cols.push(((c % lon.length) + lon.length) % lon.length);
  return { rows, cols, step, dlat: Math.abs(dlat) * step, dlon: dlon * step, west: lon[0] + c0 * dlon, north: lat[rows[0]] };
}

// The values of `name` at time index ti (and elevation index zi, for a 4-D variable; neither for a
// 2-D one, latitude × longitude) over the cells
// (cellsOf): Float32Array rows × cols, north-up, in the variable's units (scale and offset applied),
// NaN where it has no value. Only the chunks that hold those cells are read.
export async function readCells(store, name, ti, zi, { rows, cols }) {
  const m = store.meta(name), four = m.shape.length === 4, two = m.shape.length === 2;
  const [ct, cz, cy, cx] = four ? m.chunks : two ? [1, 1, ...m.chunks] : [m.chunks[0], 1, m.chunks[1], m.chunks[2]];
  const scale = m.attrs.scale_factor ?? 1, offset = m.attrs.add_offset ?? 0;
  const fill = m.dtype === '<f4' ? Math.fround(m.fill_value) : m.fill_value;
  const out = new Float32Array(rows.length * cols.length).fill(NaN);
  // the rows by chunk row, the columns by chunk column: [output index, index within the chunk]
  const group = (idx, c) => idx.reduce((g, v, k) => { const b = Math.floor(v / c); if (!g.has(b)) g.set(b, []); g.get(b).push([k, v % c]); return g; }, new Map());
  const byRow = group(rows, cy), byCol = group(cols, cx), W = cols.length;
  const tz = Math.floor(ti / ct), zz = Math.floor(zi / cz), base = ((ti % ct) * cz + (four ? zi % cz : 0)) * cy * cx;
  await Promise.all([...byRow].flatMap(([by, rs]) => [...byCol].map(async ([bx, cs]) => {
    const data = await store.chunk(name, four ? [tz, zz, by, bx] : two ? [by, bx] : [tz, by, bx]);
    for (const [i, y] of rs) {
      for (const [j, x] of cs) {
        const raw = data[base + y * cx + x];
        if (raw !== fill && !Number.isNaN(raw)) out[i * W + j] = raw * scale + offset;
      }
    }
  })));
  return out;
}
