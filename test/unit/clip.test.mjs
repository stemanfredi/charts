import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datumAt, DATUMS, clampCoastalSpikes } from '../../site/clip.js';
import { DEPTH_LEVELS } from '../../site/catalog.js';

test('Caspian surface applies inside its box only (per point, not per tile)', () => {
  assert.equal(DATUMS[0][0], 'Caspian Sea');
  assert.equal(datumAt(50.5, 45.3), -28); // northern Caspian
  assert.equal(datumAt(46.0, 46.0), 0);   // Kalmyk steppe lakes, west of the box
  assert.equal(datumAt(14, 37.5), 0);     // Mediterranean
  assert.equal(datumAt(55.3, 40), 0);     // just east of the box
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

test('DEPTH_LEVELS: the depths nautical charts use, none the model cannot place', () => {
  assert.deepEqual(DEPTH_LEVELS.slice(0, 13), [5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 1500, 2000, 2500]);
  assert.ok(!DEPTH_LEVELS.includes(75) && !DEPTH_LEVELS.includes(150), 'none where the model cannot place them');
});
