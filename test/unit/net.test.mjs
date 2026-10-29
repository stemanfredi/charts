import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lru } from '../../site/net.js';

test('lru: a promise kept per key, the least recently used forgotten past max; peek is not a use', async () => {
  let made = 0;
  const get = lru(2), make = (v) => () => { made++; return Promise.resolve(v); };
  assert.equal(await get('a', make(1)), 1);
  assert.equal(await get('a', make(2)), 1, 'kept: made once');
  assert.equal(made, 1);
  await get('b', make(2));
  assert.equal(get.peek('a'), get.peek('a'), 'peek gives the one kept');
  await get('c', make(3)); // past max: a (used before b) goes
  assert.equal(get.peek('a'), undefined);
  assert.equal(await get('b', make(9)), 2, 'b stays');
  assert.equal(made, 3);
  // a use moves a key to the front: a asked again, then d; b (least recent) goes, not a
  await get('a', make(1));
  await get('d', make(4));
  assert.deepEqual([get.peek('a') !== undefined, get.peek('b'), get.peek('c')], [true, undefined, undefined]);
});

test('lru: a make that fails is forgotten, so the next ask tries again', async () => {
  let tries = 0;
  const get = lru(Infinity);
  const make = () => { tries++; return tries === 1 ? Promise.reject(new Error('down')) : Promise.resolve('up'); };
  await assert.rejects(get('k', make), /down/);
  assert.equal(await get('k', make), 'up');
  assert.equal(tries, 2);
});
