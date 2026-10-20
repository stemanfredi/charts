import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtAngle, dm, mercatorVariation, niceLen, wrap } from '../../format.js';

test('fmtAngle: degrees, minutes, hemispheres, carry', () => {
  assert.equal(fmtAngle(44, 'N', 'S', 1), '44°N');
  assert.equal(fmtAngle(-12.5, 'E', 'W', 0.5), '12°30′W');
  assert.equal(fmtAngle(9.9999999, 'E', 'W', 1 / 60), '10°E'); // 59.99′ rounds up into the degrees
  assert.equal(fmtAngle(30 + 5 / 60, 'N', 'S', 1 / 60), '30°05′N');
});

test('dm: decimal minutes, carry into degrees', () => {
  assert.equal(dm(44.5, 'N', 'S'), '44°30.000′N');
  assert.equal(dm(-0.25, 'N', 'S'), '0°15.000′S');
  assert.equal(dm(44.99999995, 'N', 'S'), '45°00.000′N');
});

test('mercatorVariation: by |lat|, 0 at the equator crossing', () => {
  assert.equal(mercatorVariation(-1e-9, 1e-9), 0);
  const across = mercatorVariation(-14, 14);
  assert.ok(Math.abs(across - (1 / Math.cos((14 * Math.PI) / 180) - 1)) < 1e-12);
  assert.ok(across > 0.03); // the case that used to read 0 %
  assert.ok(Math.abs(mercatorVariation(60, 61) - mercatorVariation(-61, -60)) < 1e-12);
  assert.ok(Number.isFinite(mercatorVariation(80, 90))); // clamped at 85°
});

test('niceLen: 1/2/5 steps not above the input', () => {
  assert.deepEqual([0.7, 1, 3, 19, 20, 49, 999, 1234].map(niceLen), [0.5, 1, 2, 10, 20, 20, 500, 1000]);
});

test('wrap: lines up to n chars, long words kept', () => {
  assert.deepEqual(wrap('a bb ccc dddd', 6), ['a bb', 'ccc', 'dddd']);
  assert.deepEqual(wrap('supercalifragilistic x', 5), ['supercalifragilistic', 'x']);
  assert.deepEqual(wrap('', 5), []);
});
