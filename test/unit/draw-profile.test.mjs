import { test } from 'node:test';
import assert from 'node:assert/strict';

const { profileOf, samplesOf, zoomFor, profileCsv, GRID, MAX_SAMPLES } = await import('../../site/draw/profile.js');
const { emptyDoc, addLine } = await import('../../site/draw/document.js');
const { lineTrace } = await import('../../site/draw/lines.js');

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const traceOf = (pts) => { const doc = emptyDoc(0); return lineTrace(doc, addLine(doc, pts[0], pts.slice(1, -1), pts.at(-1))); };

test('samples: every grid cell along a short line, both ends; at most MAX_SAMPLES along a long one', () => {
  const short = traceOf([[12, 40], [12.1, 40]]), s = samplesOf(short);
  assert.equal(s.samples[0].d, 0);
  near(s.samples.at(-1).d, short.length, 1e-6, 'the end');
  assert.ok(s.step <= GRID && s.step > GRID / 2, `${s.step}`);
  const long = samplesOf(traceOf([[0, 0], [20, 0]]));
  assert.ok(long.samples.length <= MAX_SAMPLES);
  assert.ok(zoomFor(460, 40, 12) >= 7 && zoomFor(460, 40, 12) <= 9, 'a pixel about a cell');
  assert.equal(zoomFor(1, 0, 12), 12, 'never past the tiles\' last zoom');
});

test('a profile: depths along, the shallowest and the deepest, the length along the seabed counting the change in depth; no depth: flat', async () => {
  const tr = traceOf([[12, 40], [12.05, 40]]);
  // a slope from 10 m to 110 m deep, then land in its last quarter
  const depthAt = async ([lon]) => (lon > 12.0375 ? NaN : -10 - ((lon - 12) / 0.0375) * 100);
  const p = await profileOf(tr, depthAt, 12);
  assert.ok(p.pts.every((x) => x.p.length === 2));
  near(p.shallowest.z, -10, 1e-6, 'shallowest');
  assert.ok(p.deepest.z < -100 && p.deepest.z >= -110, `${p.deepest.z}`);
  const flat = tr.length, sloped = Math.hypot(tr.length * 0.75, 100);
  assert.ok(p.seabed > flat && p.seabed < flat + (sloped - tr.length * 0.75) + 1, `${p.seabed} vs ${flat}`);
  const csv = profileCsv(p).trim().split('\n');
  assert.equal(csv[0], 'distance_m,depth_m,lat,lon');
  assert.match(csv.at(-1), /^\d+\.\d,,40\.0+,12\.05/); // land: no depth
});
