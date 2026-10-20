import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datumAt, DATUMS, fillSmallDepressions, smoothSea, clampCoastalSpikes } from '../../clip.js';
import { levelsFor, DEPTH_LEVELS } from '../../catalog.js';

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

test('smoothSea: a kink at a tile edge is smoothed either way; away from edges nothing changes', () => {
  const w = 30, row = 15;
  const bend = (a) => Math.abs((a[row * w + 11] - a[row * w + 10]) - (a[row * w + 10] - a[row * w + 9]));
  // depth slope changes at column 10 (the Terrarium seam): steeper, then flatter, beyond it
  for (const [l, r] of [[6, 13], [13, 6]]) {
    const e = new Float32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) e[y * w + x] = x < 10 ? -400 - l * x : -400 - l * 10 - r * (x - 10);
    // a one-pixel shoal far from the edge
    e[row * w + 24] = -50;
    const before = bend(e);
    smoothSea(e, w, w, [10]);
    assert.ok(bend(e) < before / 2, `${l}→${r}: bend ${before} → ${bend(e)}`);
    assert.equal(e[row * w + 24], -50, 'a shoal away from the edges is left exactly as it is');
  }
  // land stays as it is; a sea pixel beside land is averaged only with sea, so it stays below 0
  const c = new Float32Array(w * w).fill(80);
  for (let y = 0; y < w; y++) for (let x = 10; x < w; x++) c[y * w + x] = -20;
  smoothSea(c, w, w, [10]);
  assert.equal(c[row * w + 9], 80);
  assert.equal(c[row * w + 10], -20);
});

test('clampCoastalSpikes: false peaks beside the sea go; inland summits and islets stay', () => {
  const w = 20, at = (x, y) => y * w + x;
  // land 100 m in columns 0–9, sea in columns 10–19
  const e = new Float32Array(w * w), sea = new Uint8Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { e[at(x, y)] = x < 10 ? 100 : 0; sea[at(x, y)] = x >= 10 ? 1 : 0; }
  e[at(8, 5)] = 311;  // the Elba spike: 2 px from the sea
  e[at(8, 9)] = -100; // a false pit beside the sea
  e[at(2, 14)] = 400; // a summit 7 px inland
  e[at(15, 15)] = 60; sea[at(15, 15)] = 0; // a one-pixel islet
  clampCoastalSpikes(e, sea, w, w);
  assert.equal(e[at(8, 5)], 100);
  assert.equal(e[at(8, 9)], 100);
  assert.equal(e[at(2, 14)], 400);
  assert.equal(e[at(15, 15)], 60);
});

test('levelsFor: only the depths drawn at that DEM zoom', () => {
  assert.equal(levelsFor(10), DEPTH_LEVELS);
  assert.ok(levelsFor(8).includes(100) && levelsFor(8).includes(500));
  assert.ok(!levelsFor(7).includes(100) && levelsFor(7).includes(200) && levelsFor(7).includes(1000) && !levelsFor(7).includes(500));
  assert.deepEqual(levelsFor(5).slice(0, 3), [1000, 2000, 3000]);
  const range = (a, b, s) => Array.from({ length: (b - a) / s + 1 }, (_, k) => a + k * s);
  assert.deepEqual(DEPTH_LEVELS, [5, 10, 20, 30, 40, 50, 100, 150, 200, ...range(300, 3000, 100), ...range(3500, 11000, 500)]);
});
