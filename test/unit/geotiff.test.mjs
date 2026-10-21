import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridFor, mosaic, gridTransform, geotiff } from '../../site/geotiff.js';

const HALF = Math.PI * 6378137;

test('gridFor: the pixels and tiles under the view', () => {
  // zoom 1: 512 × 512 px; a view on the north-east quarter, between pixels 300–400 and 100–200
  const pix = (2 * HALF) / 512;
  const at = (px, py) => [px * pix - HALF, HALF - py * pix];
  const g = gridFor([at(300.5, 100.2), at(399.5, 100.2), at(399.5, 199.9), at(300.5, 199.9)], 1);
  assert.deepEqual([g.x0, g.y0, g.w, g.h], [300, 100, 100, 100]);
  assert.deepEqual(g.tiles, [[1, 0]]);
  // across the antimeridian: tiles east of it keep their unwrapped x
  const a = gridFor([at(500, 10), at(530, 10), at(530, 20), at(500, 20)], 1);
  assert.deepEqual(a.tiles, [[1, 0], [2, 0]]);
});

test('mosaic: tiles placed in the grid, the rest NaN', () => {
  const tile = (v) => new Float32Array(256 * 256).fill(v);
  const g = { x0: 250, y0: 0, w: 12, h: 2, tiles: [[0, 0], [1, 0]] };
  const m = mosaic(g, [tile(1), tile(2)]);
  assert.deepEqual([...m.subarray(0, 12)], [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
  const gap = mosaic({ ...g, tiles: [[0, 0]] }, [tile(1)]);
  assert.ok(Number.isNaN(gap[6]) && gap[5] === 1);
});

test('gridTransform: north-up, pixel corners in EPSG:3857', () => {
  const pix = (2 * HALF) / 512;
  assert.deepEqual(gridTransform({ x0: 256, y0: 0, pix }), [pix, 0, 0, 0, -pix, HALF]);
});

test('geotiff: a baseline TIFF with GeoKeys, Float32 data and NaN no data', () => {
  const vals = Float32Array.from([1.5, -2, NaN, 4, 5, 6]);
  const pix = 10;
  const b = geotiff(vals, 3, 2, [pix, 0, 1000, 0, -pix, 2000], { description: 'Depth' });
  const dv = new DataView(b.buffer);
  assert.equal(String.fromCharCode(b[0], b[1]), 'II');
  assert.equal(dv.getUint16(2, true), 42);
  const ifd = dv.getUint32(4, true), n = dv.getUint16(ifd, true), tags = {};
  const size = { 2: 1, 3: 2, 4: 4, 12: 8 };
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12, tag = dv.getUint16(e, true), type = dv.getUint16(e + 2, true), cnt = dv.getUint32(e + 4, true);
    const at = cnt * size[type] > 4 ? dv.getUint32(e + 8, true) : e + 8;
    tags[tag] = Array.from({ length: cnt }, (_, i) => (type === 2 ? b[at + i] : type === 3 ? dv.getUint16(at + i * 2, true) : type === 4 ? dv.getUint32(at + i * 4, true) : dv.getFloat64(at + i * 8, true)));
  }
  const keys = Object.keys(tags).map(Number);
  assert.deepEqual(keys, [...keys].sort((x, y) => x - y), 'tags in ascending order');
  assert.deepEqual([tags[256][0], tags[257][0], tags[258][0], tags[339][0], tags[277][0]], [3, 2, 32, 3, 1]);
  assert.deepEqual(tags[33550], [10, 10, 0]);
  assert.deepEqual(tags[33922], [0, 0, 0, 1000, 2000, 0]);
  assert.ok(tags[34735].join().includes('3072,0,1,3857'), 'EPSG:3857');
  assert.equal(String.fromCharCode(...tags[42113]), 'nan\0');
  assert.ok(String.fromCharCode(...tags[42112]).includes('>Depth<'));
  const data = new Float32Array(b.buffer.slice(tags[273][0], tags[273][0] + tags[279][0]));
  assert.deepEqual([...data].map(String), [...vals].map(String));
});

test('geotiff: EPSG:4326 in degrees, two bands pixel by pixel, each with its unit', () => {
  const u = Float32Array.from([1, 2, 3, 4]), v = Float32Array.from([-1, -2, NaN, -4]);
  const b = geotiff([u, v], 2, 2, [0.5, 0, 10, 0, -0.25, 45], { crs: 4326, bands: [{ description: 'eastward', unit: 'm/s' }, { description: 'northward', unit: 'm/s' }] });
  const dv = new DataView(b.buffer), ifd = dv.getUint32(4, true), tags = {}, size = { 2: 1, 3: 2, 4: 4, 12: 8 };
  for (let k = 0; k < dv.getUint16(ifd, true); k++) {
    const e = ifd + 2 + k * 12, type = dv.getUint16(e + 2, true), cnt = dv.getUint32(e + 4, true);
    const at = cnt * size[type] > 4 ? dv.getUint32(e + 8, true) : e + 8;
    tags[dv.getUint16(e, true)] = Array.from({ length: cnt }, (_, i) => (type === 2 ? b[at + i] : type === 3 ? dv.getUint16(at + i * 2, true) : type === 4 ? dv.getUint32(at + i * 4, true) : dv.getFloat64(at + i * 8, true)));
  }
  assert.deepEqual([tags[277][0], tags[258], tags[339], tags[338]], [2, [32, 32], [3, 3], [0]]);
  assert.ok(tags[34735].join().includes('2048,0,1,4326') && tags[34735].join().includes('1024,0,1,2'), 'geographic EPSG:4326');
  assert.deepEqual([tags[33550], tags[33922]], [[0.5, 0.25, 0], [0, 0, 0, 10, 45, 0]]);
  const meta = String.fromCharCode(...tags[42112]);
  assert.ok(meta.includes('sample="1" role="description">northward<') && meta.includes('sample="1" role="unittype">m/s<'));
  const data = new Float32Array(b.buffer.slice(tags[273][0], tags[273][0] + tags[279][0]));
  assert.deepEqual([...data].map(String), ['1', '-1', '2', '-2', '3', 'NaN', '4', '-4']);
});
