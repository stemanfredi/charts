// Zip archives written in the browser with no library: deflate from the platform's
// CompressionStream, CRC-32 here. The plain PKZIP format (APPNOTE 6.3) that every unzip,
// GDAL's /vsizip/ and QGIS read: names in UTF-8, no zip64 (each file and the whole archive
// under 4 GB, far beyond one map view).

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
export function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const utf8 = new TextEncoder();
const bytesOf = async (data) => (typeof data === 'string' ? utf8.encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data);
const deflate = async (b) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());

// files: [{ name, data: string | Uint8Array | Blob }] → Blob (application/zip). Each file is
// deflated, or stored when that is no smaller (PNG is compressed already). Times are local, as
// zip has no time zone.
export async function zip(files, date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const out = [], central = [];
  let offset = 0;
  for (const f of files) {
    const raw = await bytesOf(f.data), name = utf8.encode(f.name), crc = crc32(raw);
    const packed = await deflate(raw), stored = packed.length >= raw.length, body = stored ? raw : packed;
    // the fields local and central headers share, from "version needed" to the name length
    const common = (v, at) => {
      v.setUint16(at, 20, true); // version needed: 2.0 (deflate)
      v.setUint16(at + 2, 0x0800, true); // names are UTF-8
      v.setUint16(at + 4, stored ? 0 : 8, true);
      v.setUint16(at + 6, time, true);
      v.setUint16(at + 8, day, true);
      v.setUint32(at + 10, crc, true);
      v.setUint32(at + 14, body.length, true);
      v.setUint32(at + 18, raw.length, true);
      v.setUint16(at + 22, name.length, true);
    };
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    common(lv, 4);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length), cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    common(cv, 6);
    cv.setUint32(42, offset, true); // where its local header starts
    entry.set(name, 46);
    out.push(local, body);
    central.push(entry);
    offset += local.length + body.length;
  }
  const size = central.reduce((n, e) => n + e.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  return new Blob([...out, ...central, end], { type: 'application/zip' });
}

// A zip archive read: Blob → Map of name → bytes, each checked against its CRC. Stored and deflated
// entries (what zip() writes, and most unzip tools); no zip64, no encryption. Throws on anything else.
export async function unzip(blob) {
  const b = new Uint8Array(await blob.arrayBuffer()), v = new DataView(b.buffer);
  let end = b.length - 22; // the end record: last, unless a comment follows it (at most 64 KB)
  while (end >= 0 && end >= b.length - 22 - 65535 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || v.getUint32(end, true) !== 0x06054b50) throw new Error('not a zip file');
  const files = new Map(), dec = new TextDecoder();
  for (let i = 0, p = v.getUint32(end + 16, true); i < v.getUint16(end + 10, true); i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('a damaged zip file');
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true), at = v.getUint32(p + 42, true), name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    if (v.getUint32(at, true) !== 0x04034b50) throw new Error('a damaged zip file');
    if (method !== 0 && method !== 8) throw new Error(`${name}: compressed in a way this page does not read`);
    const from = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true), body = b.subarray(from, from + csize);
    const data = method === 0 ? body.slice() : new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`${name}: damaged`);
    files.set(name, data);
    p += 46 + nlen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true); // name, extra field, comment
  }
  return files;
}
