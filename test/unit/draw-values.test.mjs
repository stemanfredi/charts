import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRing } from './helpers.mjs';

// on the page GeographicLib is a classic script on window; here the same pinned package
const { inverse, areaOf, pathOf } = await import('../../site/geodesy.js');
const { emptyDoc, addLine, addPoint, makePart, isMeasurement } = await import('../../site/draw/document.js');
const { valueFeatures } = await import('../../site/draw/features.js');
const { lineTrace, totals } = await import('../../site/draw/lines.js');
const { fmtDist } = await import('../../site/format.js');

const labels = (doc, units = 'km', bearings = false) => valueFeatures(doc, units, bearings).map((f) => f.properties.label);

test('fmtDist: metres, km, NM', () => {
  assert.equal(fmtDist(512, 'km'), '512 m');
  assert.equal(fmtDist(12345, 'km'), '12.35 km');
  assert.equal(fmtDist(1852 * 3, 'nm'), '3.00 NM');
});

test('a line: one degree of longitude on the equator is 111 319.49 m (WGS 84), heading east', () => {
  const doc = emptyDoc(0), l = addLine(doc, [[0, 0], [1, 0]]);
  assert.ok(Math.abs(lineTrace(doc, l).length - 111319.491) < 0.01);
  assert.ok(Math.abs(inverse([0, 0], [1, 0]).azi - 90) < 1e-9);
});

test('a closed line: a 1° × 1° cell at the equator is about 12 308.8 km², its perimeter its four legs; smooth, a curve through them', () => {
  const doc = emptyDoc(0), cell = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const g = addRing(doc, cell, { look: { text: { values: true } } }), tr = lineTrace(doc, g);
  assert.ok(Math.abs(Math.abs(areaOf(pathOf(cell, true))) / 1e6 - 12308.8) < 1);
  assert.ok(Math.abs(tr.area - areaOf(pathOf(cell, true))) < 1, 'its area, of its legs as drawn');
  assert.deepEqual([tr.legs.length, tr.at.length], [4, 5]); // the closing leg too
  assert.ok(Math.abs(tr.length - cell.reduce((t, p, i) => t + inverse(p, cell[(i + 1) % 4]).s, 0)) < 1e-6);
  assert.match(labels(doc)[0], /^1230[89]\.\d km²\nperimeter 443\.8 km$/); // one label, at its centre: no legs
  assert.equal(valueFeatures(doc).length, 1);
  g.smooth = true; // the curve bulges out of its places: more area, a longer perimeter; it still closes
  const sm = lineTrace(doc, g);
  assert.ok(sm.area > tr.area * 1.05 && sm.length > tr.length, `${sm.area} ${sm.length}`);
  assert.deepEqual(sm.coords.at(-1), sm.coords[0]);
  g.closed = false; // opened: three legs, no area
  assert.deepEqual([lineTrace(doc, g).legs.length, lineTrace(doc, g).area], [3, 0]);
});

test('a measurement: a guide showing its values, out of the totals; its values each leg, the total, a ring\'s radius', () => {
  const doc = emptyDoc(0);
  const pts = [[9.5, 43.6], [9.8, 43.4], [10.1, 43.2]];
  const m = () => ({ guide: true, look: { text: { values: true } } });
  const r = addLine(doc, pts, m()), a = addRing(doc, [[1, 1], [2, 1], [2, 2]], { ...m(), visible: false }), c = addPoint(doc, [10, 43.5], { ...m(), parts: [makePart('circle', { radius: 15000 })] });
  assert.ok([r, a, c].every((x) => isMeasurement(doc, x)));
  assert.deepEqual([totals(doc).all.lines, totals(doc).all.points, totals(doc).all.areas], [0, 0, 0]);
  const legs = [inverse(pts[0], pts[1]).s, inverse(pts[1], pts[2]).s];
  assert.deepEqual(labels(doc), [...legs.map((s) => fmtDist(s, 'km')), `Σ ${fmtDist(legs[0] + legs[1], 'km')}`, 'r 15.00 km']); // the hidden area: none
});

test('values: bearings beside each straight leg once switched on; in the display units', () => {
  const doc = emptyDoc(0);
  addLine(doc, [[9.5, 43.6], [10.1, 43.2]], { look: { text: { values: true } } });
  addPoint(doc, [10, 43], { look: { text: { values: true } }, parts: [makePart('circle', { radius: 1852 })] });
  assert.ok(labels(doc).every((t) => !t.includes('°T')));
  assert.match(labels(doc, 'km', true)[0], /km · \d{3}\.\d°T$/);
  assert.ok(labels(doc, 'nm').every((t) => t.includes('NM')), labels(doc, 'nm').join(' | '));
  assert.equal(labels(doc, 'nm').at(-1), 'r 1.00 NM');
});
