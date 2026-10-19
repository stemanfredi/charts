// Elevation tiles cut to the OSM coastline before the map sees them.
//
// The DEM has its own coastline, which does not match OSM's: depth tint and
// isobaths stopped short of the shore or ran onto land, and relief shading
// smeared into the sea. Each DEM tile is therefore masked with the OSM sea
// polygons (OpenMapTiles `water`, class ocean/dock) that the basemap itself
// draws, so the two coastlines agree by construction:
//   sea  tiles: land → +1 m (no tint, outside every isobath); sea the DEM calls
//               ≥ 0 m → −1 m (unknown depth is shown as the shallowest class)
//   land tiles: sea → 0 m (no relief or contours in the water)
// Above the DEM's native zoom, tiles are upsampled bilinearly (in metres, not in
// the encoded bytes) and masked at the higher zoom, so the coast stays sharp.

const OMT_MAXZOOM = 14;
// Below this zoom a screen pixel is ≥ 1.2 km, the size of the DEM's own coastline
// error: tiles pass through uncut and the per-tile work is skipped.
const CLIP_MINZOOM = 8;
const SEA_CLASSES = new Set(['ocean', 'dock']);
const SIZE = 256;

// ---- minimal Mapbox Vector Tile reader: just the `water` polygons ----------------
function reader(buf) {
  let p = 0;
  const r = {
    get done() { return p >= buf.length; },
    varint() { let v = 0, s = 0, b; do { b = buf[p++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; },
    bytes() { const n = r.varint(); const out = buf.subarray(p, p + n); p += n; return out; },
    skip(wire) { if (wire === 0) r.varint(); else if (wire === 1) p += 8; else if (wire === 2) p += r.varint(); else if (wire === 5) p += 4; else throw new Error(`bad wire type ${wire}`); },
  };
  return r;
}
const text = new TextDecoder();
const zigzag = (n) => (n >>> 1) ^ -(n & 1);
function packed(bytes) { const r = reader(bytes), out = []; while (!r.done) out.push(r.varint()); return out; }

// → { extent, features: [{ cls, rings: [[x, y, x, y …], …] }] } for the `water` layer
function waterLayer(buf) {
  const t = reader(buf);
  while (!t.done) {
    const key = t.varint();
    if (key >> 3 !== 3 || (key & 7) !== 2) { t.skip(key & 7); continue; }
    const l = reader(t.bytes());
    let name = '', extent = 4096;
    const feats = [], keys = [], values = [];
    while (!l.done) {
      const k = l.varint(), f = k >> 3;
      if (f === 1) name = text.decode(l.bytes());
      else if (f === 2) feats.push(l.bytes());
      else if (f === 3) keys.push(text.decode(l.bytes()));
      else if (f === 4) {
        const v = reader(l.bytes());
        let s = null;
        while (!v.done) { const vk = v.varint(); if (vk >> 3 === 1 && (vk & 7) === 2) s = text.decode(v.bytes()); else v.skip(vk & 7); }
        values.push(s);
      } else if (f === 5) extent = l.varint();
      else l.skip(k & 7);
    }
    if (name !== 'water') continue;
    const classKey = keys.indexOf('class');
    const features = [];
    for (const fb of feats) {
      const fr = reader(fb);
      let tags = [], type = 0, geom = [];
      while (!fr.done) {
        const k = fr.varint(), f = k >> 3;
        if (f === 2) tags = packed(fr.bytes());
        else if (f === 3) type = fr.varint();
        else if (f === 4) geom = packed(fr.bytes());
        else fr.skip(k & 7);
      }
      if (type !== 3) continue;
      let cls = null;
      for (let i = 0; i < tags.length; i += 2) if (tags[i] === classKey) cls = values[tags[i + 1]];
      const rings = [];
      let x = 0, y = 0, ring = null;
      for (let i = 0; i < geom.length;) {
        const cmd = geom[i++], id = cmd & 7, n = cmd >> 3;
        if (id === 7) { if (ring) rings.push(ring); ring = null; continue; }
        for (let j = 0; j < n; j++) {
          x += zigzag(geom[i++]); y += zigzag(geom[i++]);
          if (id === 1) { if (ring) rings.push(ring); ring = [x, y]; } else ring.push(x, y);
        }
      }
      if (ring) rings.push(ring);
      features.push({ cls, rings });
    }
    return { extent, features };
  }
  return { extent: 4096, features: [] };
}

// ---- small LRU of promises (tiles shared by neighbouring requests) ----------------
function lru(max) {
  const m = new Map();
  return (key, make) => {
    if (m.has(key)) { const v = m.get(key); m.delete(key); m.set(key, v); return v; }
    const v = make().catch((e) => { m.delete(key); throw e; });
    m.set(key, v);
    if (m.size > max) m.delete(m.keys().next().value);
    return v;
  };
}
const omtCache = lru(48), demCache = lru(64);

async function fetchOk(url, signal) {
  const r = await fetch(url, { signal, credentials: 'omit' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

// Sea mask for DEM tile z/x/y (1 = OSM sea). A 256 px tile at z has the resolution
// of the 512 px OpenMapTiles tile at z−1, which is the one the basemap loads.
async function seaMask(omtTemplate, z, x, y, signal) {
  const oz = Math.max(0, Math.min(z - 1, OMT_MAXZOOM)), d = z - oz;
  const ox = x >> d, oy = y >> d;
  const layer = await omtCache(`${oz}/${ox}/${oy}`, async () => {
    const url = (await omtTemplate).replace('{z}', oz).replace('{x}', ox).replace('{y}', oy);
    const r = await fetch(url, { signal, credentials: 'omit' });
    if (r.status === 204 || r.status === 404) return { extent: 4096, features: [] }; // empty tile
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return waterLayer(new Uint8Array(await r.arrayBuffer()));
  });
  const c = new OffscreenCanvas(SIZE, SIZE), g = c.getContext('2d');
  const k = (SIZE * 2 ** d) / layer.extent, sx = (x - (ox << d)) * SIZE, sy = (y - (oy << d)) * SIZE;
  g.fillStyle = '#fff';
  for (const f of layer.features) {
    if (!SEA_CLASSES.has(f.cls)) continue;
    g.beginPath(); // one path per feature, so overlapping water features add up instead of cancelling
    for (const r of f.rings) {
      g.moveTo(r[0] * k - sx, r[1] * k - sy);
      for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * k - sx, r[i + 1] * k - sy);
      g.closePath();
    }
    g.fill('nonzero');
  }
  const px = g.getImageData(0, 0, SIZE, SIZE).data, mask = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  return mask;
}

// Terrarium tile at zoom ≤ native, decoded to metres
function demMetres(url, signal) {
  return demCache(url, async () => {
    const img = await createImageBitmap(await (await fetchOk(url, signal)).blob());
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data, e = new Float32Array(img.width * img.height);
    for (let i = 0; i < e.length; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    if (img.width !== SIZE) throw new Error(`expected ${SIZE} px DEM tiles`);
    return { w: img.width, e };
  });
}

// A maplibre-contour getTile(url) that serves clipped Terrarium PNGs up to any zoom.
export function clippedDem({ template, native, mode, omtTileJson }) {
  const omtTemplate = fetch(omtTileJson, { credentials: 'omit' }).then((r) => r.json()).then((tj) => tj.tiles[0]);
  return async (url, abortController) => {
    const [z, x, y] = url.match(/(\d+)\/(\d+)\/(\d+)\.png/).slice(1).map(Number);
    const signal = abortController?.signal;
    if (z < CLIP_MINZOOM) return { data: await (await fetchOk(template.replace('{z}', z).replace('{x}', x).replace('{y}', y), signal)).blob() };
    const nz = Math.min(z, native), d = z - nz, f = 2 ** d, n = 2 ** nz;
    // source pixels this tile needs, in global pixel coordinates at the native zoom;
    // bilinear sampling reads one pixel past the edge, so neighbours may be needed
    const w = SIZE, step = 1 / f, gx = (x / f) * w, gy = (y / f) * w;
    const tx0 = Math.floor((gx - 1) / w), tx1 = Math.floor((gx + w * step + 1) / w);
    const ty0 = Math.max(0, Math.floor((gy - 1) / w)), ty1 = Math.min(n - 1, Math.floor((gy + w * step + 1) / w));
    const want = [];
    if (d === 0) want.push([x, y]);
    else for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) want.push([tx, ty]);
    const [tiles, mask] = await Promise.all([
      Promise.all(want.map(([tx, ty]) => demMetres(template.replace('{z}', nz).replace('{x}', ((tx % n) + n) % n).replace('{y}', ty), signal))),
      seaMask(omtTemplate, z, x, y, signal),
    ]);
    const byKey = new Map(want.map(([tx, ty], k) => [`${tx}/${ty}`, tiles[k].e]));
    const get = (X, Y) => {
      Y = Math.min(n * w - 1, Math.max(0, Y));
      const tx = Math.floor(X / w), ty = Math.floor(Y / w);
      return byKey.get(`${tx}/${ty}`)[(Y - ty * w) * w + (X - tx * w)];
    };
    const out = new ImageData(SIZE, SIZE), o = out.data;
    for (let j = 0; j < SIZE; j++) {
      const v = gy + (j + 0.5) * step - 0.5, j0 = Math.floor(v), fj = v - j0;
      for (let i = 0; i < SIZE; i++) {
        let h;
        if (d === 0) h = tiles[0].e[j * w + i];
        else {
          const u = gx + (i + 0.5) * step - 0.5, i0 = Math.floor(u), fi = u - i0;
          h = (get(i0, j0) * (1 - fi) + get(i0 + 1, j0) * fi) * (1 - fj) + (get(i0, j0 + 1) * (1 - fi) + get(i0 + 1, j0 + 1) * fi) * fj;
        }
        const sea = mask[j * SIZE + i];
        if (mode === 'sea') h = sea ? Math.min(h, -1) : 1;
        else if (sea) h = 0;
        const t = h + 32768, q = (j * SIZE + i) * 4;
        o[q] = Math.floor(t / 256); o[q + 1] = Math.floor(t) % 256; o[q + 2] = Math.floor((t - Math.floor(t)) * 256); o[q + 3] = 255;
      }
    }
    const c = new OffscreenCanvas(SIZE, SIZE);
    c.getContext('2d').putImageData(out, 0, 0);
    return { data: await c.convertToBlob({ type: 'image/png' }) };
  };
}
