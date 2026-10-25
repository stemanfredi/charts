import { test } from 'node:test';
import assert from 'node:assert/strict';

const { stepped } = await import('../../site/fields.js');

test('stepped: a value nudged by one unit of its last decimal place (ten with Shift), its unit kept; never under the least', () => {
  assert.equal(stepped('1.2 km', true, false), '1.3 km');
  assert.equal(stepped('1.2 km', false, true), '0.2 km');
  assert.equal(stepped('500 m', true, false), '501 m');
  assert.equal(stepped('0.05', false, false, 0), '0.04');
  assert.equal(stepped('0', false, false, 0), '0');
  assert.equal(stepped('3,5 NM', true, false), '3.6 NM'); // a decimal comma read, written with a point
  assert.equal(stepped('12', true, true), '22');
  assert.equal(stepped('mixed', true, false), null);
});
