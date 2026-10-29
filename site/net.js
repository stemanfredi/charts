// How the page asks other servers for data: no cookies, and no referrer. Workers do not inherit
// the page's <meta name="referrer" content="no-referrer">, so every fetch says it.
export const FETCH = { credentials: 'omit', referrerPolicy: 'no-referrer' };

// a fetch that throws on any status but 2xx (init: on top of FETCH: a signal)
export async function fetchOk(url, init = {}) {
  const r = await fetch(url, { ...FETCH, ...init });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}
// the bytes at url, or null where there are none (403 and 404: a chunk not stored, a tile not there)
export async function fetchBytes(url) {
  const r = await fetch(url, FETCH);
  if (r.status === 403 || r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
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
