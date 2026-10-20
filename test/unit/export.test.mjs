import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mercator, affine, worldFile, footprint, stacItem } from '../../export.js';

const close = (a, b, eps, what) => assert.ok(Math.abs(a - b) < eps, `${what}: ${a} vs ${b}`);

test('mercator: EPSG:3857 metres', () => {
  const [x, y] = mercator([180, 85.0511287798066]);
  close(x, 20037508.342789244, 1e-6, 'x at 180°');
  close(y, 20037508.342789244, 1e-3, 'y at the Web Mercator limit');
  for (const v of mercator([0, 0])) close(v, 0, 1e-6, 'origin');
});

test('affine and world file: north-up view, pixel corners vs pixel centres', () => {
  // 1° × 1° at the equator in 100 × 100 px
  const t = affine([[10, 1], [11, 1], [11, 0], [10, 0]], 100, 100);
  const [x0, y0] = mercator([10, 1]), [x1] = mercator([11, 1]), [, y1] = mercator([10, 0]);
  close(t[0], (x1 - x0) / 100, 1e-9, 'a'); assert.equal(t[1], 0); close(t[2], x0, 1e-6, 'c');
  assert.equal(t[3], 0); close(t[4], (y1 - y0) / 100, 1e-9, 'e'); close(t[5], y0, 1e-6, 'f');
  const w = worldFile(t).trim().split('\n').map(Number);
  assert.equal(w.length, 6);
  close(w[4], x0 + t[0] / 2, 1e-6, 'C: centre of the first pixel');
  close(w[5], y0 + t[4] / 2, 1e-6, 'F: centre of the first pixel');
});

test('affine: a rotated view keeps its rotation terms; across the antimeridian', () => {
  // rotated 90°: the image's top edge runs south along a meridian
  const r = affine([[10, 1], [10, 0], [11, 0], [11, 1]], 100, 100);
  close(r[0], 0, 1e-9, 'a'); assert.ok(r[3] < 0, 'd: south along the row'); assert.ok(r[1] > 0, 'b: east down the column'); close(r[4], 0, 1e-9, 'e');
  const across = affine([[179.5, 1], [180.5, 1], [180.5, 0], [179.5, 0]], 100, 100);
  close(across[0] * 100, mercator([1, 0])[0], 1e-6, 'one degree wide');
});

test('footprint: counter-clockwise ring, bbox west > east across the antimeridian', () => {
  const { bbox, geometry } = footprint([[10, 2], [12, 2], [12, 1], [10, 1]]);
  assert.deepEqual(bbox, [10, 1, 12, 2]);
  const ring = geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  let area2 = 0;
  for (let i = 0; i < ring.length - 1; i++) area2 += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  assert.ok(area2 > 0, 'counter-clockwise');
  assert.deepEqual(footprint([[179, 2], [181, 2], [181, 1], [179, 1]]).bbox, [179, 1, -179, 2]);
  assert.deepEqual(footprint([[539, 2], [541, 2], [541, 1], [539, 1]]).bbox, [179, 1, -179, 2], 'a world copy east of 180°');
  assert.deepEqual(footprint([[-300, 80], [300, 80], [300, -80], [-300, -80]]).bbox, [-180, -80, 180, 80], 'more than the whole world');
});

test('stacItem: one provider per source, licence-less helpers left out', () => {
  const osm = { src: 'OpenStreetMap via OpenFreeMap', lic: 'ODbL', url: 'https://openfreemap.org' };
  const item = stacItem({
    id: 'chart-x', when: new Date('2026-10-20T12:00:00Z'), corners: [[10, 2], [12, 2], [12, 1], [10, 1]], zoom: 9.123, bearing: 0,
    layers: [{ id: 'chart', label: 'Chart', info: osm }, { id: 'roads', label: 'Roads', info: osm }, { id: 'graticule', label: 'Graticule', info: { src: 'Computed', lic: '—' } }, { id: 'gibs', label: 'NASA daily', variant: 'SST', date: '2026-10-18', info: { src: 'NASA', lic: 'open' } }, { id: 'relief', label: 'Relief', info: { src: 'Hillshade', lic: 'As DEM' } }],
    attribution: 'OpenStreetMap', link: 'https://example.org/#v=9/1/1/0', assets: { map: { href: './map.png', roles: ['visual'] } },
  });
  assert.equal(item.type, 'Feature');
  assert.equal(item.stac_version, '1.1.0');
  assert.equal(item.properties.datetime, '2026-10-20T12:00:00.000Z');
  assert.deepEqual(item.properties.providers.map((p) => `${p.name} ${p.roles}`), ['OpenStreetMap via OpenFreeMap producer', 'NASA producer', 'Hillshade processor']);
  assert.deepEqual(item.properties['chart:layers'][3], { id: 'gibs', title: 'NASA daily', variant: 'SST', date: '2026-10-18' });
  assert.equal(item.properties['chart:zoom'], 9.12);
  assert.equal(item.links[0].rel, 'via');
});
