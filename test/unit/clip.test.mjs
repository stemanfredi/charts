import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datumAt, DATUMS, fillSmallDepressions, smoothSea, clampCoastalSpikes, fillZeroHoles } from '../../site/clip.js';
import { levelsFor, DEPTH_LEVELS } from '../../site/catalog.js';

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

test('fillSmallDepressions: two neighbouring tiles treat a pit across their edge alike', () => {
  // tiles of T px with margins of M, side by side along x; each is filtered in its own area
  const T = 40, M = 8, H = 56, G = 4 * T, global = new Float32Array(G * H).fill(-20);
  const seam = 2 * T, y = 28;
  for (let x = seam - 12; x <= seam + 5; x++) global[y * G + x] = -300; // thin: 18 px long, 18 px in all
  for (let yy = y + 10; yy <= y + 12; yy++) for (let x = seam - 1; x <= seam + 1; x++) global[yy * G + x] = -300; // compact: 3 × 3
  const area = (k) => { // tile k's area, filtered: columns k·T − M to (k + 1)·T + M
    const w = T + 2 * M, e = new Float32Array(w * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < w; i++) e[j * w + i] = global[j * G + k * T - M + i];
    fillSmallDepressions(e, w, H, [5, 10, 50, 100, 200], 64, M - 1);
    return (x, yy) => e[yy * w + x - (k * T - M)];
  };
  const left = area(1), right = area(2);
  // each tile's own pixels of the thin pit: both keep it (longer than the margin), or the left
  // tile would fill it while the right one, seeing it cut by its area's edge, kept it
  assert.equal(left(seam - 3, y), -300);
  assert.equal(right(seam + 3, y), -300);
  // the compact pit lies whole in both areas: both raise it alike (to just above 50 m, the last
  // drawn depth inside the 20 m water around it)
  assert.ok(left(seam - 1, y + 11) > -51 && left(seam - 1, y + 11) === right(seam + 1, y + 11));
});

test('smoothSea: shallow water near a tile edge never gets deeper', () => {
  const w = 30, e = new Float32Array(w * w).fill(-25);
  e[15 * w + 10] = -4; // a shoal on the seam
  smoothSea(e, w, w, [10]);
  assert.equal(e[15 * w + 10], -4);
  assert.ok([...e].every((v) => v >= -25), 'nothing deeper than the data');
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
  assert.ok(levelsFor(8).includes(10) && levelsFor(8).includes(30) && levelsFor(8).includes(1500) && !levelsFor(8).includes(5));
  assert.ok(levelsFor(7).includes(20) && levelsFor(7).includes(100) && levelsFor(7).includes(500) && !levelsFor(7).includes(30));
  assert.deepEqual(levelsFor(5).slice(0, 3), [200, 1000, 2000]);
  assert.deepEqual(levelsFor(3), [3000, 5000]);
  assert.deepEqual(DEPTH_LEVELS.slice(0, 13), [5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 1500, 2000, 2500]);
  assert.ok(!DEPTH_LEVELS.includes(75) && !DEPTH_LEVELS.includes(150), 'none where the model cannot place them');
});

test('fillZeroHoles: exact 0 m sea takes the parent depth; real values and land stay', () => {
  const S = 256, parent = new Float32Array(S * S).fill(-800);
  for (let j = 0; j < S; j++) for (let i = 0; i < 20; i++) parent[j * S + i] = 50; // land on the parent's west edge
  const e = new Float32Array(S * S).fill(0); // the Taranto tile: sea read as 0 m
  e[100 * S + 100] = -30; // a real depth stays
  e[150 * S + 150] = 1; // +1 m among the zeros: a hole too
  e[160 * S + 160] = 3; // higher: the DEM's own land, left alone
  const out = fillZeroHoles(e, parent, [0, 0]);
  assert.equal(out[100 * S + 100], -30);
  assert.ok(Math.abs(out[200 * S + 200] + 800) < 1e-3, 'hole takes the parent depth');
  assert.ok(Math.abs(out[150 * S + 150] + 800) < 1e-3, 'a +1 m cell in the block too');
  assert.equal(out[160 * S + 160], 3);
  assert.equal(out[100 * S + 2], 0, 'where the parent is land, 0 stays (shown as the shallowest class)');
  assert.equal(e[200 * S + 200], 0, 'input untouched (it is a cached tile)');
  const real = new Float32Array(S * S).fill(-5);
  assert.equal(fillZeroHoles(real, parent, [1, 1]), real, 'no holes: same array');
});
