import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { bloscEncode, mean2, mode2, build, verify } from '../../tools/gebco.mjs';
import { unblosc, openStore, readCells } from '../../site/zarr.js';

// an uncompressed, single-strip TIFF of h × w signed integers (as GEBCO's files are laid out)
function tiff(values, w, h) {
  const bpe = values.BYTES_PER_ELEMENT, tags = [[256, 4, w], [257, 4, h], [258, 3, bpe * 8], [259, 3, 1], [262, 3, 1], [273, 4, 0], [277, 3, 1], [278, 4, h], [279, 4, w * h * bpe], [339, 3, 2]];
  const ifd = 8, data = ifd + 2 + tags.length * 12 + 4, b = Buffer.alloc(data + w * h * bpe);
  b.write('II', 0, 'latin1'); b.writeUInt16LE(42, 2); b.writeUInt32LE(ifd, 4); b.writeUInt16LE(tags.length, ifd);
  tags.forEach(([tag, type, v], k) => {
    const e = ifd + 2 + k * 12;
    b.writeUInt16LE(tag, e); b.writeUInt16LE(type, e + 2); b.writeUInt32LE(1, e + 4);
    if (type === 3) b.writeUInt16LE(v, e + 8); else b.writeUInt32LE(tag === 273 ? data : v, e + 8);
  });
  Buffer.from(values.buffer, values.byteOffset, values.byteLength).copy(b, data);
  return b;
}

// a synthetic world of 2 × 4 files of n × n cells, as GEBCO names them; cell(r, c) its values
function world(dir, folder, prefix, n, T, cell) {
  mkdirSync(join(dir, folder), { recursive: true });
  for (let rb = 0; rb < 2; rb++) {
    for (let cb = 0; cb < 4; cb++) {
      const v = new T(n * n);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) v[r * n + c] = cell(rb * n + r, cb * n + c);
      const north = 90 - 90 * rb, west = -180 + 90 * cb;
      writeFileSync(join(dir, folder, `${prefix}_n${north}.0_s${north - 90}.0_w${west}.0_e${west + 90}.0_geotiff.tif`), tiff(v, n, n));
    }
  }
}

test('bloscEncode: zlib with byte shuffle, or stored as is, read back by zarr.js', async () => {
  const smooth = Int16Array.from({ length: 4096 }, (_, i) => -4000 + (i % 700));
  const enc = bloscEncode(new Uint8Array(smooth.buffer), 2);
  assert.equal(enc[2] >> 5, 3, 'zlib');
  assert.ok(enc.length < smooth.byteLength / 2, 'smaller');
  assert.deepEqual(new Int16Array((await unblosc(enc)).buffer), smooth);
  const noise = new Uint8Array(randomBytes(999)); // incompressible
  const raw = bloscEncode(noise, 1);
  assert.equal(raw[2] & 2, 2, 'stored as is');
  assert.deepEqual(await unblosc(raw), noise);
});

test('mean2 and mode2: 2 × 2 means; the most common code, on a tie the higher', () => {
  assert.deepEqual([...mean2(Int16Array.from([-10, -20, 0, 2, -30, -40, 1, 1]), 2, 4)], [-25, 1]);
  // a tie of two (11, 41) → 41; all four differ → 70; three of a kind → 0
  assert.deepEqual([...mode2(Int8Array.from([11, 11, 41, 70, 0, 0, 41, 41, 0, 12, 0, 0]), 2, 6)], [41, 70, 0]);
});

test('build: a synthetic world → both stores, every cell and every level as zarr.js reads them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gebco-'));
  try {
    const n = 300, rows = 2 * n, cols = 4 * n; // 600 × 1200 cells: more than one chunk of 512 each way, with edge chunks
    const elev = (r, c) => ((r * 7 + c * 13) % 2001) - 1000; // a ramp through 0: real 0 m cells
    const codes = [0, 11, 12, 41, 70];
    const tid = (r, c) => codes[(r * 3 + c * 5 + ((r * c) % 7)) % 5];
    world(dir, 'elevation', 'gebco_2026', n, Int16Array, elev);
    world(dir, 'tid', 'gebco_2026_tid', n, Int8Array, tid);
    const quiet = () => {};
    for (const name of ['elevation', 'tid']) await build(dir, name, { workers: 3, levels: 3, log: quiet });
    const fetchBytes = async (p) => { try { return new Uint8Array(readFileSync(p)); } catch { return null; } };
    const all = (h, w) => ({ rows: Array.from({ length: h }, (_, i) => i), cols: Array.from({ length: w }, (_, i) => i) });
    // elevation: level 0 the cells; level k the mean of its 2^k × 2^k cells, a half rounded upwards
    const es = await openStore(join(dir, 'zarr/gebco-2026/elevation.zarr'), fetchBytes);
    for (let k = 0; k < 3; k++) {
      const f = 2 ** k, h = rows / f, w = cols / f, got = await readCells(es, `${k}/elevation`, 0, 0, all(h, w));
      let bad = 0, zeros = 0;
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          let s = 0;
          for (let y = 0; y < f; y++) for (let x = 0; x < f; x++) s += elev(r * f + y, c * f + x);
          const want = Math.round(s / (f * f));
          if (got[r * w + c] !== want) bad++;
          if (want === 0 && got[r * w + c] === 0) zeros++;
        }
      }
      assert.equal(bad, 0, `elevation level ${k}: ${bad} of ${h * w} cells differ`);
      assert.ok(zeros > 0, `elevation level ${k}: 0 m cells read as 0, not as no data`);
    }
    // tid: level 0 the codes; level k the most common code of the four below it (int8 in zarr.js)
    const ts = await openStore(join(dir, 'zarr/gebco-2026/tid.zarr'), fetchBytes);
    let below = Float32Array.from({ length: rows * cols }, (_, i) => tid(Math.floor(i / cols), i % cols));
    for (let k = 0; k < 3; k++) {
      const h = rows / 2 ** k, w = cols / 2 ** k, got = await readCells(ts, `${k}/tid`, 0, 0, all(h, w));
      const want = k === 0 ? below : Float32Array.from(mode2(Int8Array.from(below), h * 2, w * 2));
      assert.deepEqual(got, want, `tid level ${k}`);
      below = want;
    }
    // the metadata: consolidated, both levels' coordinates, GEBCO's attribution
    const md = JSON.parse(readFileSync(join(dir, 'zarr/gebco-2026/elevation.zarr/.zmetadata'))).metadata;
    assert.deepEqual(md['2/elevation/.zarray'].shape, [rows / 4, cols / 4]);
    assert.equal(md['0/elevation/.zarray'].fill_value, -32768);
    assert.match(md['.zattrs'].source, /GEBCO Compilation Group \(2026\)/);
    assert.equal(md['1/latitude/.zarray'].shape[0], rows / 2);
    // verify, as run on the real grid, agrees
    assert.equal(await verify(dir, 'elevation', { samples: 300, log: () => {} }), true);
    assert.equal(await verify(dir, 'tid', { samples: 300, log: () => {} }), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
