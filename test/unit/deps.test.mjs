import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stale } from '../../tools/deps.mjs';

test('site/vendor/ holds the libraries at package.json\'s versions, and the policy names the hosts', async () => {
  assert.deepEqual(await stale(), [], 'run node tools/deps.mjs --write');
});
