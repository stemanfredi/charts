import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tilesIn, baseTiles, fromZoom, areaOf, isAreaHead, isKeptFile, BASE_TILES, TOP_MAX, PACK, MANIFEST_FILE } from '../../site/offline.js';

test('tilesIn: the tiles an area covers at a zoom, a margin of tiles more, clamped to the world', () => {
  assert.deepEqual(tilesIn([-180, -85, 180, 85], 0), [[0, 0, 0]]);
  assert.equal(tilesIn([-180, -85, 180, 85], 2).length, 16);
  // a point-sized area: one tile; with a margin of one, its 3 × 3; at the world's corner, cut to 2 × 2
  assert.equal(tilesIn([9.5, 44, 9.5001, 44.0001], 10).length, 1);
  assert.equal(tilesIn([9.5, 44, 9.5001, 44.0001], 10, 1).length, 9);
  assert.equal(tilesIn([-180, 85.04, -179.99, 85.05], 10, 1).length, 4);
  // an edge exactly on a tile's boundary does not take the next tile
  assert.equal(tilesIn([0, 0, 90, 66.51326], 2).length, 1);
});

test('baseTiles: what OpenFreeMap\'s terms count, from a zoom to the top (at most 14); fromZoom: 3 below the view\'s', () => {
  assert.equal(fromZoom(11.7), 8);
  assert.equal(fromZoom(1), 0);
  // 40 × 40 km in the Alps, to zoom 14: under the 3,000 of the terms
  const alps = [11.6, 46.32, 12.12, 46.68];
  const n = baseTiles(alps, 8, 14);
  assert.ok(n > 500 && n < BASE_TILES, `${n}`);
  assert.equal(baseTiles(alps, 8, 20), baseTiles(alps, 8, TOP_MAX));
  assert.ok(baseTiles(alps, 0, 14) - baseTiles(alps, 8, 14) < 60); // zooms 0–7: a few tiles each, the ring included
  assert.equal(baseTiles(alps, 13, 13), tilesIn(alps, 13).length); // above the contours' zooms: no ring // the base map's tiles stop at 14
  // 320 km at sea to zoom 12 is about the limit; to zoom 14 far over it
  const sea = [8, 42.5, 12, 45.4];
  assert.ok(baseTiles(sea, 5, 12) < 4000 && baseTiles(sea, 5, 14) > 3 * BASE_TILES);
});

test('isAreaHead: an area file opened only with its format, a date, an area of the world and zooms an area has', () => {
  const head = { format: 'charts-offline-area', version: 1, name: 'A', saved: '2026-10-30T10:00:00.000Z', bounds: [9, 44, 10, 45], from: 8, top: 12, files: [] };
  assert.ok(isAreaHead(head));
  for (const bad of [{ saved: undefined }, { saved: 'soon' }, { bounds: [9, 44, 10] }, { bounds: [10, 44, 9, 45] }, { bounds: [9, 44, 10, '45'] },
    { from: undefined }, { top: 15 }, { from: 13 }, { files: {} }, { version: 2 }, { files: [{ name: 'files/0', url: 'https://example.com/1/2/3.png' }] }]) assert.ok(!isAreaHead({ ...head, ...bad }), JSON.stringify(bad));
});

test('isKeptFile: an area file carries only what saveArea keeps, on the saved hosts', () => {
  for (const url of ['https://tiles.openfreemap.org/planet', 'https://tiles.openfreemap.org/planet/20261025_080012_pt/12/2170/1480.pbf',
    'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/256-511.pbf', 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/11/1080/740.png',
    'https://geodata.makaw.org/gebco-2026/elevation.zarr/.zmetadata', 'https://geodata.makaw.org/gebco-2026/elevation.zarr/0/elevation/12.34',
    'https://tiles.openseamap.org/seamark/12/2170/1480.png']) assert.ok(isKeptFile(url), url);
  for (const url of [undefined, 'https://example.com/1/2/3.png', 'https://tiles.openfreemap.org/planet/x.js', 'https://tiles.openfreemap.org/styles/liberty',
    'https://s3.amazonaws.com/elevation-tiles-prod/../other/1/2/3.png', 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/1/2/3.png?x=1',
    'https://geodata.makaw.org/gebco-2026/elevation.zarr/.zattrs']) assert.ok(!isKeptFile(url), url);
});

test('areaOf: the view\'s bounds in the world, a centre beyond ±180° (a hand-edited link) moved by whole turns', () => {
  const view = (w, s, e, n) => ({ getBounds: () => ({ getWest: () => w, getSouth: () => s, getEast: () => e, getNorth: () => n }) });
  assert.deepEqual(areaOf(view(9, 44, 10, 45)), [9, 44, 10, 45]);
  assert.deepEqual(areaOf(view(194, 44, 196, 45)), [-166, 44, -164, 45]);
  assert.deepEqual(areaOf(view(-556, 44, -554, 45)), [164, 44, 166, 45]);
  assert.deepEqual(areaOf(view(168, -89, 190, 89)), [168, -85.05112878, 180, 85.05112878]); // across 180°: cut there
});

test('the service worker names the saved areas\' caches and their manifest as the page does', async () => {
  const sw = await readFile(new URL('../../site/sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes(`PACK = '${PACK}'`) && sw.includes(`new URL('${MANIFEST_FILE}', self.registration.scope)`));
});
