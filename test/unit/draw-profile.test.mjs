import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';

const { profileOf, samplesOf, zoomFor, profileCsv, STEP_MIN, MAX_SAMPLES } = await import('../../site/draw/profile.js');
const { emptyDoc, addLine } = await import('../../site/draw/document.js');
const { lineTrace } = await import('../../site/draw/lines.js');

const traceOf = (pts) => { const doc = emptyDoc(0); return lineTrace(doc, addLine(doc, pts[0], pts.slice(1, -1), pts.at(-1))); };

test('samples: every STEP_MIN along a short line, both ends; at most MAX_SAMPLES along a long one', () => {
  const short = traceOf([[12, 40], [12.01, 40]]), s = samplesOf(short);
  assert.equal(s.samples[0].d, 0);
  near(s.samples.at(-1).d, short.length, 1e-6, 'the end');
  assert.ok(s.step <= STEP_MIN && s.step > STEP_MIN / 2, `${s.step}`);
  const long = samplesOf(traceOf([[0, 0], [20, 0]]));
  assert.ok(long.samples.length <= MAX_SAMPLES);
  assert.ok(zoomFor(460, 40, 12) >= 7 && zoomFor(460, 40, 12) <= 9, 'a pixel about a cell');
  assert.equal(zoomFor(1, 0, 12), 12, 'never past the tiles\' last zoom');
});

test('a profile: elevations along, the lowest and the highest, the length along the surface counting the change in elevation; none: flat', async () => {
  const tr = traceOf([[12, 40], [12.05, 40]]);
  // a slope from 10 m to 110 m deep, then a shore rising to 50 m, then no data in its last fifth
  const elevationAt = async ([lon]) => (lon > 12.04 ? NaN : lon > 12.03 ? ((lon - 12.03) / 0.01) * 50 : -10 - ((lon - 12) / 0.03) * 100);
  const p = await profileOf(tr, elevationAt, 12);
  assert.ok(p.pts.every((x) => x.p.length === 2));
  assert.ok(p.lowest.z < -100 && p.lowest.z >= -110, `${p.lowest.z}`);
  assert.ok(p.highest.z > 45 && p.highest.z <= 50, `${p.highest.z}`);
  const flat = tr.length;
  assert.ok(p.surface > flat && p.surface < flat + 160, `${p.surface} vs ${flat}`); // at most the climbs' 100 + 50 m more
  const csv = profileCsv(p).trim().split('\n');
  assert.equal(csv[0], 'distance_m,elevation_m,lat,lon');
  assert.match(csv.at(-1), /^\d+\.\d,,40\.0+,12\.05/); // no data: empty
});

test('a profile: a place whose depth could not be read is a gap; none read, it fails', async () => {
  const tr = traceOf([[12, 40], [12.05, 40]]);
  let n = 0;
  const p = await profileOf(tr, async () => { if (n++ === 3) throw new Error('tile'); return -20; }, 12);
  assert.ok(Number.isNaN(p.pts[3].z) && p.pts.filter((x) => Number.isFinite(x.z)).length === p.pts.length - 1);
  assert.equal(p.deepest.z, -20);
  await assert.rejects(profileOf(tr, async () => { throw new Error('offline'); }, 12));
  const land = await profileOf(tr, async () => NaN, 12);
  assert.equal(land.deepest, null, 'all land: read, no depth');
});
