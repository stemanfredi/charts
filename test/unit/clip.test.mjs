import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datumAt, DATUMS, fillPits } from '../../clip.js';

test('Caspian surface applies inside its box only (per point, not per tile)', () => {
  assert.equal(DATUMS[0][0], 'Caspian Sea');
  assert.equal(datumAt(50.5, 45.3), -28); // northern Caspian
  assert.equal(datumAt(46.0, 46.0), 0);   // Kalmyk steppe lakes, west of the box
  assert.equal(datumAt(14, 37.5), 0);     // Mediterranean
  assert.equal(datumAt(55.3, 40), 0);     // just east of the box
});

test('fillPits: coastal pits are filled; a canyon, a polder and a wide basin stay', () => {
  const w = 24, grid = () => new Float32Array(w * w).fill(-10);
  // pit: 3×3 of −400 m in −10 m water (Marciana Marina in the raw data)
  let e = grid();
  for (let j = 10; j < 13; j++) for (let i = 10; i < 13; i++) e[j * w + i] = -400;
  fillPits(e, w);
  assert.ok([...e].every((v) => v === -10), 'pit not filled');
  // canyon: a −300 m line running out to the tile edge is deeper on the ring too
  e = grid();
  for (let i = 0; i <= 12; i++) e[12 * w + i] = -300;
  fillPits(e, w);
  assert.equal(e[12 * w + 12], -300, 'canyon head was filled');
  // a pit with only land around (a cove the coarse grid does not have) becomes −1 m: unknown depth
  e = new Float32Array(w * w).fill(50);
  e[12 * w + 12] = -336;
  fillPits(e, w);
  assert.equal(e[12 * w + 12], -1);
  // land below sea level but not a pit (a polder, −6 m beside 2 m) stays
  e = new Float32Array(w * w).fill(2);
  e[12 * w + 12] = -6;
  fillPits(e, w);
  assert.equal(e[12 * w + 12], -6);
  // a wide basin (deeper over more than the ring) stays
  e = grid();
  for (let j = 4; j < 20; j++) for (let i = 4; i < 20; i++) e[j * w + i] = -400;
  fillPits(e, w);
  assert.equal(e[12 * w + 12], -400);
});
