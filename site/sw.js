// The service worker: the page's own files kept in this browser, so that the page opens without a
// connection. It answers only for those files (and the page's address); every other request, the
// tiles and data of the providers, goes to the network as if it were not there.
// VERSION: the commit published, written by the deploy (ci.yml). A new one is a new worker: it
// fetches the files of its version, then waits until the page applies it (Reload) or every tab of
// the page is closed, so a page never mixes the files of two versions. 'dev', on a development
// copy: the network first, the files kept only for when there is none, so an edit shows at a reload.
const VERSION = 'dev';
// the files, relative to this worker (tools/deps.mjs --write: every file in site/ but this one,
// the preview picture and version.json, which is asked for apart)
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
const CACHE = `shell-${VERSION}`, PREFIX = 'shell-';
const INDEX = new URL('index.html', self.registration.scope).href, VERSION_FILE = new URL('version.json', self.registration.scope).href;
const OWN = new Set(SHELL.map((f) => new URL(f, self.registration.scope).href));

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

// the page asks for the waiting version to be applied (its Reload)
self.addEventListener('message', (e) => { if (e.data === 'apply') self.skipWaiting(); });

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
  if (key === VERSION_FILE) { e.respondWith(networkFirst(req, key)); return; } // the version shown in About: the latest when online
  if (key !== INDEX && !OWN.has(key)) return; // not the page's own: the network, untouched
  e.respondWith(VERSION === 'dev' ? networkFirst(req, key) : cacheFirst(req, key));
});
