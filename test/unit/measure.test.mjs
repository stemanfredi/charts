import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// on the page GeographicLib is a classic script on window; here the same pinned package
globalThis.geodesic = createRequire(import.meta.url)('geographiclib-geodesic');
const { stats, summary, fmtDist, Measure } = await import('../../measure.js');

test('fmtDist: metres, km, NM', () => {
  assert.equal(fmtDist(512, 'km'), '512 m');
  assert.equal(fmtDist(12345, 'km'), '12.35 km');
  assert.equal(fmtDist(1852 * 3, 'nm'), '3.00 NM');
});

test('ruler: one degree of longitude on the equator is 111 319.49 m (WGS 84)', () => {
  const s = stats({ kind: 'ruler', pts: [[0, 0], [1, 0]] });
  assert.ok(Math.abs(s.len - 111319.491) < 0.01, s.len);
  assert.ok(Math.abs(s.segs[0].azi - 90) < 1e-9);
});

test('area: 1°×1° cell at the equator ≈ 12 308.8 km²', () => {
  const s = stats({ kind: 'area', pts: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  assert.ok(Math.abs(Math.abs(s.area) / 1e6 - 12308.8) < 1, s.area);
  assert.match(summary({ kind: 'area', pts: [[0, 0], [1, 0], [1, 1], [0, 1]] }, 'km'), /^Area 1230[89]\.\d km²$/);
});

test('ring: labelled as a radius', () => {
  assert.equal(summary({ kind: 'ring', pts: [[10, 43.5]], r: 15000 }, 'km'), 'Ring r 15.00 km');
  assert.equal(summary({ kind: 'ring', pts: [[10, 43.5]], r: 1852 * 3 }, 'nm'), 'Ring r 3.00 NM');
});

test('URL round trip; bad rings dropped; hidden flag kept', () => {
  const fake = { on() {}, getSource() {}, getCanvas: () => ({ style: {} }), doubleClickZoom: { enable() {}, disable() {} } };
  globalThis.window ??= { addEventListener() {} };
  const m = new Measure(fake, () => {});
  m.load('r:9.5,43.6;10.1,43.2~!a:1,1;2,1;2,2~c:10,43.5;15000~c:10,43.5;0~c:1,1;NaN~junk');
  assert.deepEqual(m.list.map((x) => [x.kind, x.hidden]), [['ruler', false], ['area', true], ['ring', false]]);
  const again = new Measure(fake, () => {});
  again.load(m.serialize());
  assert.equal(again.serialize(), m.serialize());
});

test('preview: the cursor adds a leg, but not where a tap just put a point', () => {
  const fake = { on() {}, getSource() {}, getCanvas: () => ({ style: {} }), doubleClickZoom: { enable() {}, disable() {} } };
  globalThis.window ??= { addEventListener() {} };
  const m = new Measure(fake, () => {});
  m.start('ruler');
  m.click({ lngLat: { lng: 10, lat: 43 } });
  m.hover = [10, 43]; // a tap: the "cursor" is on the point it added
  assert.equal(m.preview().pts.length, 1);
  m.hover = [10.5, 43.2]; // a mouse elsewhere: the next leg
  assert.equal(m.preview().pts.length, 2);
});

test('bearings: off by default, beside each leg once switched on', () => {
  let data = null;
  const fake = { on() {}, getSource: () => ({ setData: (d) => { data = d; } }), getCanvas: () => ({ style: {} }), doubleClickZoom: { enable() {}, disable() {} } };
  globalThis.window ??= { addEventListener() {} };
  const m = new Measure(fake, () => {});
  m.load('r:9.5,43.6;10.1,43.2');
  const labels = () => data.features.map((f) => f.properties.label).filter(Boolean);
  assert.ok(labels().length && labels().every((t) => !t.includes('°T')), labels().join(' | '));
  m.setBearings(true);
  assert.ok(labels().some((t) => /km · \d{3}\.\d°T$/.test(t)), labels().join(' | '));
});
