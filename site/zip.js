// Zip archives written and read in the browser with no library: deflate and inflate from the
// platform's CompressionStream and DecompressionStream, CRC-32 here. The plain PKZIP format (APPNOTE 6.3) that every unzip,
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
    out.push(new Blob([local, stored && f.data instanceof Blob ? f.data : body])); // a blob each: the browser may keep it on disk, not the page
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

// at most `size` bytes inflated (a file's own count): an archive that says less cannot fill memory
async function inflate(b, size) {
  const reader = new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), out = new Uint8Array(size);
  let n = 0;
  for (let r; !(r = await reader.read()).done;) {
    if (n + r.value.length > size) { reader.cancel(); throw new Error('damaged'); }
    out.set(r.value, n);
    n += r.value.length;
  }
  if (n !== size) throw new Error('damaged');
  return out;
}

// A zip archive read: Blob → Map of name → () => Promise of its bytes, each checked against its CRC
// when read. Only the directory is read at first, each file when asked: an archive of an area is
// never all in memory. Stored and deflated entries (what zip() writes, and most unzip tools); no
// zip64, no encryption. Throws on anything else.
export async function unzip(blob) {
  const bytesAt = async (at, n) => new Uint8Array(await blob.slice(at, at + n).arrayBuffer());
  const tailAt = Math.max(0, blob.size - 22 - 65535), tail = await bytesAt(tailAt, blob.size - tailAt), tv = new DataView(tail.buffer);
  let end = tail.length - 22; // the end record: last, unless a comment follows it (at most 64 KB)
  while (end >= 0 && tv.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip file');
  const dir = await bytesAt(tv.getUint32(end + 16, true), tv.getUint32(end + 12, true)), v = new DataView(dir.buffer);
  const files = new Map(), dec = new TextDecoder();
  for (let i = 0, p = 0; i < tv.getUint16(end + 10, true); i++) {
    if (p + 46 > dir.length || v.getUint32(p, true) !== 0x02014b50) throw new Error('a damaged zip file');
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true), at = v.getUint32(p + 42, true), name = dec.decode(dir.subarray(p + 46, p + 46 + nlen));
    if (method !== 0 && method !== 8) throw new Error(`${name}: compressed in a way this page does not read`);
    files.set(name, async () => {
      const local = await bytesAt(at, 30), lv = new DataView(local.buffer);
      if (local.length < 30 || lv.getUint32(0, true) !== 0x04034b50) throw new Error(`${name}: damaged`);
      const body = await bytesAt(at + 30 + lv.getUint16(26, true) + lv.getUint16(28, true), csize);
      const data = method === 0 ? body : await inflate(body, usize).catch(() => null);
      if (data?.length !== usize || crc32(data) !== crc) throw new Error(`${name}: damaged`);
      return data;
    });
    p += 46 + nlen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true); // name, extra field, comment
  }
  return files;
}
