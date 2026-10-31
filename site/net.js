// How the page asks other servers for data: no cookies, and no referrer. Workers do not inherit
// the page's <meta name="referrer" content="no-referrer">, so every fetch says it.
export const FETCH = { credentials: 'omit', referrerPolicy: 'no-referrer' };

// Saving an offline area (offline.js): a file fetched into the area's cache, by whoever reads it (the
// page, its clipping worker). The copy there first (the page's base tiles, read again by the cut),
// else the network's, put there when it is a file (2xx with a body: a 204 is no tile), stored(bytes,
// url) said of it; the browser's storage full throws (a QuotaExceededError). area: { cache (a Cache,
// or its promise), reload: the addresses asked of the providers themselves (cache 'reload', which
// the service worker takes from no saved area: an area saved again), stored }
export async function fetchInto(area, url, init = {}) {
  const cache = await area.cache, had = await cache.match(url);
  if (had) return had;
  const r = await fetch(url, { ...FETCH, ...init, ...(area.reload.some((h) => url.startsWith(h)) && { cache: 'reload' }) });
  if (!r.ok || r.status === 204) return r;
  const body = await r.blob();
  if (body.size) { await cache.put(url, new Response(body, r)); area.stored(body.size, url); }
  return new Response(body, r);
}
// the area every fetch below goes into: set in a clipping worker saving one (clip-worker.js)
let area = null;
export const fetchAllInto = (a) => { area = a; };
const get = (url, init = {}) => (area ? fetchInto(area, url, init) : fetch(url, { ...FETCH, ...init }));

// a fetch that throws on any status but 2xx (init: on top of FETCH: a signal)
export async function fetchOk(url, init = {}) {
  const r = await get(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}
// the bytes at url, or null where there are none (403 and 404: a chunk not stored, a tile not there)
export async function fetchBytes(url) {
  const r = await get(url);
  if (r.status === 403 || r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
// a tile's address: its template ({z}/{x}/{y}) filled
export const tileUrl = (template, z, x, y) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
// A cache of promises (max Infinity: every one kept), the least recently used forgotten past max: get(key, make) gives the
// one kept or makes it (forgotten if it fails, so the next ask tries again); peek(key) the one kept,
// if any, without counting as a use.
export function lru(max) {
  const m = new Map();
  const get = (key, make) => {
    if (m.has(key)) { const v = m.get(key); m.delete(key); m.set(key, v); return v; }
    const v = make().catch((e) => { m.delete(key); throw e; });
    m.set(key, v);
    if (m.size > max) m.delete(m.keys().next().value);
    return v;
  };
  get.peek = (key) => m.get(key);
  return get;
}
