import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyEntry, keyOf, openKey } from '../../site/keys.js';

test('keys: each single key opens one thing or one tool, in either case; a key with none gives nothing', () => {
  assert.equal(keyEntry('L').open, 'layers');
  assert.equal(keyEntry('l').open, 'layers');
  assert.equal(keyEntry('/').open, 'search');
  assert.equal(keyEntry('b').tool, 'box');
  assert.equal(keyEntry('x'), undefined);
  assert.deepEqual(['point', 'line', 'shape', 'label', 'measure'].map(keyOf), ['P', 'G', 'S', 'T', 'M']);
  assert.equal(keyOf('select'), '', 'Select has no key');
  assert.deepEqual([openKey('layers'), openKey('elements'), openKey('props'), openKey('nothing')], ['L', 'E', 'I', '']);
});

test('keys: no key is given twice', () => {
  const seen = new Set();
  for (const k of 'lei/bpgstm') { assert.ok(!seen.has(k)); seen.add(k); assert.ok(keyEntry(k), k); }
});
