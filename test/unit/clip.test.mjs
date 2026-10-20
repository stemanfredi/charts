import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datumAt, DATUMS, fillSmallDepressions, smoothSea, levelsFor, DEPTH_LEVELS } from '../../clip.js';

test('Caspian surface applies inside its box only (per point, not per tile)', () => {
  assert.equal(DATUMS[0][0], 'Caspian Sea');
  assert.equal(datumAt(50.5, 45.3), -28); // northern Caspian
  assert.equal(datumAt(46.0, 46.0), 0);   // Kalmyk steppe lakes, west of the box
  assert.equal(datumAt(14, 37.5), 0);     // Mediterranean
  assert.equal(datumAt(55.3, 40), 0);     // just east of the box
});

test('fillSmallDepressions: pits and pockets go, level by level; canyons, basins and shoals stay', () => {
  const w = 40, sea = () => new Float32Array(w * w).fill(-10);
  // a pit: 3×3 of −485 m in −10 m water (Marciana Marina in the raw data) → just above 5 m, no ring left
  let e = sea();
  for (let j = 18; j < 21; j++) for (let i = 18; i < 21; i++) e[j * w + i] = -485;
  fillSmallDepressions(e, w, w);
  assert.ok([...e].every((v) => v >= -10), 'pit left');
  // a cove pocket the grid half-has: −27 m among land
  e = new Float32Array(w * w).fill(40);
  e[20 * w + 20] = -27; e[20 * w + 21] = -14;
  fillSmallDepressions(e, w, w);
  assert.ok(e[20 * w + 20] > -5 && e[20 * w + 21] > -5, 'pocket left');
  // a canyon reaching the edge of the area is not enclosed: kept
  e = sea();
  for (let i = 0; i <= 20; i++) e[20 * w + i] = -300;
  fillSmallDepressions(e, w, w);
  assert.equal(e[20 * w + 20], -300);
  // a basin larger than the minimum (10 × 10 px) is kept
  e = sea();
  for (let j = 15; j < 25; j++) for (let i = 15; i < 25; i++) e[j * w + i] = -400;
  fillSmallDepressions(e, w, w);
  assert.equal(e[20 * w + 20], -400);
  // a small shoal (a hazard) is never removed
  e = sea();
  e[20 * w + 20] = -2;
  fillSmallDepressions(e, w, w);
  assert.equal(e[20 * w + 20], -2);
  // land is untouched
  e = new Float32Array(w * w).fill(120);
  fillSmallDepressions(e, w, w);
  assert.ok([...e].every((v) => v === 120));
});

test('smoothSea: a gradient kink at a tile edge is smoothed; land and the coast are not pulled up', () => {
  const w = 20, e = new Float32Array(w * w);
  // depth falls 6 m per pixel left of column 10 and 13 m per pixel right of it (the Terrarium seam)
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) e[y * w + x] = x < 10 ? -400 - 6 * x : -460 - 13 * (x - 10);
  const bend = (a) => Math.abs((a[10 * w + 11] - a[10 * w + 10]) - (a[10 * w + 10] - a[10 * w + 9]));
  const before = bend(e);
  smoothSea(e, w, w);
  assert.ok(bend(e) < before / 2, `bend ${before} → ${bend(e)}`);
  // land stays as it is; a sea pixel beside land is averaged only with sea, so it stays below 0
  const c = new Float32Array(w * w).fill(80);
  for (let y = 0; y < w; y++) for (let x = 10; x < w; x++) c[y * w + x] = -20;
  smoothSea(c, w, w);
  assert.equal(c[10 * w + 9], 80);
  assert.equal(c[10 * w + 10], -20);
});

test('levelsFor: only the depths drawn at that DEM zoom', () => {
  assert.equal(levelsFor(10), DEPTH_LEVELS);
  assert.ok(levelsFor(8).includes(100) && levelsFor(8).includes(500));
  assert.ok(!levelsFor(7).includes(100) && levelsFor(7).includes(200) && levelsFor(7).includes(1000) && !levelsFor(7).includes(500));
  assert.deepEqual(levelsFor(5).slice(0, 3), [1000, 2000, 3000]);
});
