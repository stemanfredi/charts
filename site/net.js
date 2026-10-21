// How the page asks other servers for data: no cookies, and no referrer. Workers do not inherit
// the page's <meta name="referrer" content="no-referrer">, so every fetch says it.
export const FETCH = { credentials: 'omit', referrerPolicy: 'no-referrer' };

// cache[key], made once by make() (a promise) and shared; forgotten if it fails, so the next ask
// tries again
export function memo(cache, key, make) {
  return (cache[key] ||= make().catch((e) => { delete cache[key]; throw e; }));
}
