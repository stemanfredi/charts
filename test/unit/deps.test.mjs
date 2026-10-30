import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stale } from '../../tools/deps.mjs';

test('site/vendor/ holds the libraries at package.json\'s versions, and the policy names the hosts', async () => {
  assert.deepEqual(await stale(), [], 'run node tools/deps.mjs --write');
});

test('a saved area keeps only hosts the page knows, never Esri\'s', async () => {
  const { HOSTS, OFFLINE } = await import('../../site/hosts.js');
  assert.ok(OFFLINE.every((k) => HOSTS[k]), 'every saved host is one of HOSTS');
  assert.ok(!OFFLINE.includes('esri') && !OFFLINE.some((k) => HOSTS[k].includes('arcgis')), 'Esri\'s terms forbid saving its tiles');
});
