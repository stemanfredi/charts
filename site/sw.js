// The service worker: the page's own files kept in this browser, so that the page opens without a
// connection, and the areas saved for use without one (caches named pack-…: the providers' files under
// their own addresses). It answers for the page's files, and for the hosts an area may keep when one
// is saved; every other request goes to the network as if it were not there.
// VERSION: the commit published, written by the deploy (ci.yml). A new one is a new worker: it
// fetches the files of its version, then waits until the page applies it (Reload) or every tab of
// the page is closed, so a page never mixes the files of two versions. 'dev', on a development
// copy: the network first, the files kept only for when there is none, so an edit shows at a reload.
const VERSION = 'dev';
// the files, relative to this worker (tools/deps.mjs --write: every file in site/ but this one,
// the preview picture and version.json, which only a deployed copy has: kept apart, below)
const SHELL = [
  // shell:start (written by tools/deps.mjs --write; do not edit by hand)
  'app.js',
  'apple-touch-icon.png',
  'catalog.js',
  'clip-worker.js',
  'clip.js',
  'cmems.js',
  'dom.js',
  'draw/attach.js',
  'draw/check.js',
  'draw/clipboard.js',
  'draw/document.js',
  'draw/drag.js',
  'draw/drawing.js',
  'draw/features.js',
  'draw/file.js',
  'draw/files.js',
  'draw/generator.js',
  'draw/grid.js',
  'draw/icons.js',
  'draw/labels.js',
  'draw/layers.js',
  'draw/lines.js',
  'draw/outlines.js',
  'draw/panel.js',
  'draw/place.js',
  'draw/presets.js',
  'draw/profile.js',
  'draw/saving.js',
  'draw/snap.js',
  'draw/store.js',
  'draw/tools.js',
  'draw/tree.js',
  'export.js',
  'favicon-32.png',
  'fields.js',
  'format.js',
  'frame.js',
  'gebco.js',
  'geo.js',
  'geodesy.js',
  'geotiff.js',
  'gis.js',
  'hosts.js',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'icon.svg',
  'index.html',
  'keys.js',
  'legend.js',
  'manifest.webmanifest',
  'menu.js',
  'net.js',
  'offline.js',
  'png.js',
  'search.js',
  'style.css',
  'style.js',
  'values.js',
  'vector.js',
  'vendor/LICENSE-geographiclib-geodesic.txt',
  'vendor/LICENSE-maplibre-contour.txt',
  'vendor/LICENSE-maplibre-gl.txt',
  'vendor/LICENSE-polygon-clipping.txt',
  'vendor/geographiclib-geodesic.min.js',
  'vendor/maplibre-contour.mjs',
  'vendor/maplibre-gl-worker.mjs',
  'vendor/maplibre-gl.css',
  'vendor/maplibre-gl.mjs',
  'vendor/polygon-clipping.umd.min.js',
  'zarr.js',
  'zip.js',
  // shell:end
];
// the hosts a saved area may keep, by name (site/hosts.js OFFLINE_PREFIXES; tools/deps.mjs --write)
const SAVED_HOSTS = {
  // hosts:start (written by tools/deps.mjs --write; do not edit by hand)
  openfreemap: 'https://tiles.openfreemap.org/',
  terrain: 'https://s3.amazonaws.com/elevation-tiles-prod/',
  geodata: 'https://geodata.makaw.org/',
  openseamap: 'https://tiles.openseamap.org/',
  // hosts:end
};
const SAVED = Object.values(SAVED_HOSTS);
const CACHE = `shell-${VERSION}`, PREFIX = 'shell-', PACK = 'pack-';
const INDEX = new URL('index.html', self.registration.scope).href;
// version.json answered as the other files: About says the version running, not the one deployed since
const OWN = new Set([...SHELL, 'version.json'].map((f) => new URL(f, self.registration.scope).href));

self.addEventListener('install', (e) => {
  // each file asked again of the server (no-cache: revalidated, so not a copy the browser kept from
  // before the deploy); version.json exists only where the deploy wrote it
  e.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.addAll(SHELL.map((f) => new Request(f, { cache: 'no-cache' })));
    await cache.add(new Request('version.json', { cache: 'no-cache' })).catch(() => {});
  }));
});

self.addEventListener('activate', (e) => {
  // the files of other versions dropped; the pages open now taken over, so that a first visit opens
  // without a connection next time without a reload in between
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// the page asks for the waiting version to be applied (its Reload), says the saved areas changed, or
// names the area it is saving ({ record: name, fresh }, null when done; fresh: an area saved again,
// the providers' changing files from the network, not from the saved areas; told again every second,
// so a page gone mid-save stops it soon) and asks how far it has got ({ stats }, answered on the
// message's port)
self.addEventListener('message', (e) => {
  if (e.data === 'apply') self.skipWaiting();
  if (e.data === 'packs') { packs = null; anyPack = undefined; }
  if (e.data?.record !== undefined) {
    recording = !e.data.record ? null : recording?.name === e.data.record ? recording : { name: e.data.record, fresh: !!e.data.fresh, bytes: {}, full: false };
    if (recording) recording.told = Date.now();
  }
  if (e.data?.stats) e.ports[0]?.postMessage(recording && { bytes: recording.bytes, full: recording.full });
  if (e.data === 'connection') e.source?.postMessage({ connection });
});

// Whether the network answers: what the last try of the base map's provider said (a phone with a
// signal but no data calls itself online; another provider down, OpenSeaMap often, is not the
// connection), told to the pages when it changes, and to a page that asks
let connection = null; // true, false, or null: not tried yet
function net(req) {
  const said = (ok) => { if (ok !== connection) { connection = ok; self.clients.matchAll().then((cs) => cs.forEach((c) => c.postMessage({ connection: ok }))); } };
  if (!req.url.startsWith(SAVED_HOSTS.openfreemap)) return fetch(req);
  return fetch(req).then((r) => { said(true); return r; }, (err) => { if (err.name !== 'AbortError') said(false); throw err; }); // a tile the map gave up says nothing
}

// The saved areas: their caches (pack-…, complete once their manifest is in: one being saved is not
// used yet), and the base map's versions they hold. OpenFreeMap names its tiles by
// its weekly build (…/planet/20261025_080012_pt/{z}/{x}/{y}.pbf): a tile of this week's build, asked
// for while online, is also looked for under the builds the areas were saved from.
let packs = null; // promise of { names, builds }; null: to read again
let anyPack; // whether an area is saved: undefined until read (the worker just started, or the areas changed)
const OFM_TILEJSON = `${SAVED_HOSTS.openfreemap}planet`, MANIFEST = new URL('pack.json', self.registration.scope).href;
const OFM_TILE = new RegExp(`^(${OFM_TILEJSON.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/)([^/]+)(/\\d+/\\d+/\\d+\\.pbf)$`);
const readPacks = () => (packs ??= caches.keys().then(async (keys) => {
  const names = [], builds = new Set();
  for (const name of keys.filter((k) => k.startsWith(PACK))) {
    const cache = await caches.open(name);
    if (!(await cache.match(MANIFEST))) continue;
    names.push(name);
    // a description that is not one (an area's file opened) names no build, and fails nothing else
    const build = await cache.match(OFM_TILEJSON).then((tj) => tj?.json()).then((j) => OFM_TILE.exec(String(j?.tiles?.[0]).replace('{z}/{x}/{y}', '0/0/0'))?.[2], () => null);
    if (build) builds.add(build);
  }
  anyPack = names.length > 0;
  return { names, builds: [...builds] };
}));
readPacks();
// a saved area's copy of url, if any: looked for across every cache at once (only the areas hold the
// providers' addresses)
async function saved(url) {
  const { builds } = await readPacks();
  for (const key of [url, ...(OFM_TILE.test(url) ? builds.map((b) => url.replace(OFM_TILE, `$1${b}$3`)) : [])]) {
    const r = await caches.match(key);
    if (r) return r;
  }
  return null;
}
// a request to a saved host: the base map's description from the network first (its newest build),
// the area's copy without a connection, or after 4 s of a weak one; anything else from the area
// first, so a saved area asks nothing of the provider
async function fromPacks(req) {
  if (req.url === OFM_TILEJSON) {
    const asked = net(req), copy = saved(req.url);
    asked.catch(() => {}); // a late failure, after the copy was used: nothing to say
    const late = new Promise((r) => setTimeout(r, 4000)).then(() => copy.then((c) => c || asked));
    try { return await Promise.race([asked, late]); } catch (err) { const c = await copy; if (c) return c; throw err; }
  }
  return (await saved(req.url)) || net(req);
}

// Saving an area: every request to a saved host is kept in it as well, taken from a saved area that
// has it, or from the network a few at a time per host, each until its file has come (the providers'
// terms: OpenFreeMap 4, OpenSeaMap 2; one place for every request, the page's and its workers', and
// any other tab's of the page meanwhile)
let recording = null; // { name, fresh, told: when the page last said, bytes: host → bytes, full: storage was }
const active = new Map(), queued = new Map();
function limited(host, run) {
  const max = host === SAVED_HOSTS.openseamap ? 2 : 4;
  return new Promise((resolve, reject) => {
    const go = () => {
      active.set(host, (active.get(host) || 0) + 1);
      run().then(resolve, reject).finally(() => { active.set(host, active.get(host) - 1); queued.get(host)?.shift()?.(); });
    };
    if ((active.get(host) || 0) < max) go();
    else { if (!queued.has(host)) queued.set(host, []); queued.get(host).push(go); }
  });
}
// saved again (fresh), only the base map and the seamarks change: the elevation and the depths
// (a versioned path) are taken from the area as before
const CHANGING = [SAVED_HOSTS.openfreemap, SAVED_HOSTS.openseamap];
async function record(req, host) {
  const rec = recording, cache = await caches.open(rec.name);
  const r = (await cache.match(req.url)) || ((!rec.fresh || !CHANGING.includes(host)) && (await saved(req.url)))
    || (await limited(host, () => net(req).then(async (res) => { await res.clone().blob(); return res; })));
  if (!r.ok) return r;
  const body = await r.clone().blob();
  if (!(await cache.match(req.url))) {
    try {
      await cache.put(req.url, new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers }));
      rec.bytes[host] = (rec.bytes[host] || 0) + body.size;
    } catch { rec.full = true; } // the browser's storage is full: the page stops, the map still has its file
  }
  return r;
}

// cache first: the file kept, else the network
const kept = (key) => caches.open(CACHE).then((c) => c.match(key));
const cacheFirst = async (req, key) => (await kept(key)) || fetch(req);
// network first: the network, else the file kept (and kept anew when the network answers)
async function networkFirst(req, key) {
  try {
    const r = await fetch(req);
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return r;
  } catch (err) {
    const r = await kept(key);
    if (r) return r;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  url.search = ''; // a file is the same file whatever its query; the view is in the hash, never sent
  const key = req.mode === 'navigate' && url.href.startsWith(self.registration.scope) ? INDEX : url.href; // the page's address: index.html
  const host = SAVED.find((h) => req.url.startsWith(h));
  if (recording && Date.now() - recording.told > 10000) recording = null; // its page is gone
  if (host && recording) { e.respondWith(record(req, host)); return; }
  if (host && anyPack !== false) { // none saved: untouched
    e.respondWith(readPacks().then(({ names }) => (names.length ? fromPacks(req) : fetch(req))));
    return;
  }
  if (key !== INDEX && !OWN.has(key)) return; // not the page's own: the network, untouched
  e.respondWith(VERSION === 'dev' ? networkFirst(req, key) : cacheFirst(req, key));
});
