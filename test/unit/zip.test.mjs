import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zip, crc32 } from '../../site/zip.js';

// a reader for what zip() writes: central directory → { name: bytes }
async function unzip(blob) {
  const b = new Uint8Array(await blob.arrayBuffer()), v = new DataView(b.buffer);
  const end = b.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  const files = {};
  for (let i = 0, p = v.getUint32(end + 16, true); i < v.getUint16(end + 10, true); i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true), at = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
    assert.equal(v.getUint32(at, true), 0x04034b50);
    const body = b.subarray(at + 30 + v.getUint16(at + 26, true), at + 30 + v.getUint16(at + 26, true) + csize);
    const data = method === 0 ? body : new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    assert.equal(data.length, usize);
    assert.equal(crc32(data), crc, `${name} CRC`);
    files[name] = { data, method };
    p += 46 + nlen;
  }
  return files;
}

test('crc32: the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip: text deflated, incompressible data stored, UTF-8 names round-trip', async () => {
  const text = '{"type":"Feature"}\n'.repeat(500);
  const noise = crypto.getRandomValues(new Uint8Array(4096));
  const files = await unzip(await zip([{ name: 'item.json', data: text }, { name: 'raster/città.bin', data: noise }, { name: 'empty.txt', data: '' }]));
  assert.deepEqual(Object.keys(files), ['item.json', 'raster/città.bin', 'empty.txt']);
  assert.equal(new TextDecoder().decode(files['item.json'].data), text);
  assert.equal(files['item.json'].method, 8);
  assert.deepEqual(files['raster/città.bin'].data, noise);
  assert.equal(files['raster/città.bin'].method, 0);
  assert.equal(files['empty.txt'].data.length, 0);
});

test('unzip: what zip() writes read back, stored and deflated; a damaged file refused', async () => {
  const { unzip } = await import('../../site/zip.js');
  const big = new Uint8Array(5000).fill(7), files = [{ name: 'a/b.txt', data: 'hello, zip' }, { name: 'big.bin', data: big }, { name: 'ü.json', data: '{}' }];
  const z = await zip(files), read = await unzip(z);
  assert.deepEqual([...read.keys()], ['a/b.txt', 'big.bin', 'ü.json']);
  assert.equal(new TextDecoder().decode(await read.get('a/b.txt')()), 'hello, zip');
  assert.deepEqual(await read.get('big.bin')(), big);
  const bytes = new Uint8Array(await z.arrayBuffer());
  bytes[40] ^= 0xff; // inside the first file's data
  await assert.rejects((await unzip(new Blob([bytes]))).get('a/b.txt')(), /damaged/);
  await assert.rejects(unzip(new Blob([new Uint8Array(100)])), /not a zip/);
  // a file that inflates beyond the size it states: refused before it is all in memory
  const bomb = new Uint8Array(await (await zip([{ name: 'x', data: new Uint8Array(100000) }])).arrayBuffer()), bv = new DataView(bomb.buffer);
  const cd = bv.getUint32(bomb.length - 22 + 16, true);
  bv.setUint32(22, 10, true); bv.setUint32(cd + 24, 10, true); // the uncompressed size, local and central: 10 bytes
  await assert.rejects((await unzip(new Blob([bomb]))).get('x')(), /damaged/);
});
