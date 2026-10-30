#!/usr/bin/env node
// The page's libraries, copied from npm into site/vendor/ (the page has no build and loads them
// from there, as its own files), the page's Content-Security-Policy, and the preloads of its modules.
//
//   node tools/deps.mjs --write    copy the libraries, at package.json's versions, with their
//                                  licences into site/vendor/, and write into index.html the policy
//                                  (from the hosts in site/hosts.js) and a modulepreload for each
//                                  module app.js reaches (a cold load asks for them at once, not
//                                  nine import levels deep, one round trip each); and into
//                                  site/sw.js the list of the page's files it keeps
//   node tools/deps.mjs            newer data periods in the EMODnet density WMS than catalog.js
//                                  lists (newer library versions: npm outdated)
//
// To upgrade a library: change its version in package.json, npm install, --write, then test the page.
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTS, cspSource } from '../site/hosts.js';

// [package, file in it, name in site/vendor/]
export const LIBRARIES = [
  ['maplibre-gl', 'dist/maplibre-gl.mjs', 'maplibre-gl.mjs'],
  ['maplibre-gl', 'dist/maplibre-gl.css', 'maplibre-gl.css'],
  ['maplibre-gl', 'dist/maplibre-gl-worker.mjs', 'maplibre-gl-worker.mjs'], // found by maplibre-gl.mjs beside itself
  ['maplibre-contour', 'dist/index.mjs', 'maplibre-contour.mjs'],
  ['geographiclib-geodesic', 'geographiclib-geodesic.min.js', 'geographiclib-geodesic.min.js'],
  ['polygon-clipping', 'dist/polygon-clipping.umd.min.js', 'polygon-clipping.umd.min.js'], // loaded on the first GIS export (gis.js)
];

// Every host the page may talk to, as Content-Security-Policy sources (site/hosts.js: the code builds
// its addresses from the same list)
export const CSP_HOSTS = Object.values(HOSTS).map(cspSource);
const CSP = [
  "default-src 'none'",
  "script-src 'self'", "style-src 'self'", // the page sets styles through the DOM only, never as markup
  "img-src 'self' data: blob:", // tiles come by fetch (connect-src), drawn from blobs
  `connect-src 'self' ${CSP_HOSTS.join(' ')}`,
  "worker-src 'self'", // clip-worker.js, MapLibre's worker
  "manifest-src 'self'", // manifest.webmanifest: the page installed as an app
  "base-uri 'none'", "form-action 'none'", "object-src 'none'",
].join('; ');
const META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
const INDEX = new URL('../site/index.html', import.meta.url), VENDOR = new URL('../site/vendor/', import.meta.url);
const MODULES = new URL('../node_modules/', import.meta.url);
const BLOCK = /(<!-- csp:start[^>]*-->)[\s\S]*?(<!-- csp:end -->)/;
const SITE = new URL('../site/', import.meta.url), PRELOAD = /(<!-- preload:start[^>]*-->)[\s\S]*?(<!-- preload:end -->)/;
const SW = new URL('../site/sw.js', import.meta.url), SHELL = /( *)(\/\/ shell:start[^\n]*\n)[\s\S]*?( *\/\/ shell:end)/;
// not kept by the service worker: itself, the picture for link previews, and version.json (written
// by the deploy, asked for apart)
const NOT_SHELL = new Set(['sw.js', 'preview.jpg', 'version.json']);

// the modules app.js imports statically, directly or through others, in the order they are met
// (dynamic imports are left out: they are lazy on purpose); the libraries are not read into
async function moduleGraph(entry = 'app.js') {
  const seen = new Set();
  const walk = async (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    if (name.startsWith('vendor/')) return;
    const src = await readFile(new URL(name, SITE), 'utf8');
    for (const m of src.matchAll(/^import\s+(?:[^'";]*?\sfrom\s+)?['"](\.\.?\/[^'"]+)['"]/gm)) await walk(posix.normalize(posix.join(posix.dirname(name), m[1])));
  };
  await walk(entry);
  seen.delete(entry); // the script tag asks for it
  return [...seen];
}

// the page's files, relative to site/, sorted (the libraries in site/vendor/ included)
async function shellFiles() {
  const files = (await readdir(SITE, { recursive: true, withFileTypes: true })).filter((e) => e.isFile())
    .map((e) => posix.join(posix.relative(fileURLToPath(SITE), e.parentPath).split('\\').join('/'), e.name))
    .filter((f) => !NOT_SHELL.has(f) && !f.split('/').some((part) => part.startsWith('.')));
  return files.sort();
}
const swWith = (src, files) => {
  if (!SHELL.test(src)) throw new Error('shell markers not found in sw.js');
  return src.replace(SHELL, (_, pad, a, b) => `${pad}${a}${files.map((f) => `${pad}'${f}',\n`).join('')}${b}`);
};

// what site/vendor/ should hold: name → the bytes in node_modules (the libraries and their licences)
async function wanted() {
  const out = new Map();
  // without the source-map pointer: the maps are not shipped, and the browser's tools would ask for them
  for (const [pkg, file, name] of LIBRARIES) out.set(name, Buffer.from((await readFile(new URL(`${pkg}/${file}`, MODULES), 'utf8')).replace(/\n\/[/*]# sourceMappingURL=\S+( \*\/)?\s*$/, '\n')));
  for (const pkg of new Set(LIBRARIES.map(([p]) => p))) {
    const licence = (await readdir(new URL(`${pkg}/`, MODULES))).find((f) => /^licen[cs]e/i.test(f));
    if (!licence) throw new Error(`${pkg}: no licence file in the package`);
    out.set(`LICENSE-${pkg}.txt`, await readFile(new URL(`${pkg}/${licence}`, MODULES)));
  }
  return out;
}
const indexWith = (html, modules) => {
  if (!BLOCK.test(html) || !PRELOAD.test(html)) throw new Error('csp or preload markers not found in index.html');
  return html.replace(BLOCK, (_, a, b) => `${a}\n  ${META}\n  ${b}`)
    .replace(PRELOAD, (_, a, b) => `${a}\n${modules.map((m) => `  <link rel="modulepreload" href="${m}">\n`).join('')}  ${b}`);
};

// what differs from --write's result: [] when nothing (the unit tests assert this)
export async function stale() {
  const out = [];
  const w = await wanted();
  for (const [name, bytes] of w) {
    const have = await readFile(new URL(name, VENDOR)).catch(() => null);
    if (!have || !have.equals(bytes)) out.push(`site/vendor/${name}`);
  }
  for (const e of await readdir(VENDOR, { withFileTypes: true }).catch(() => [])) if (!w.has(e.name) || e.isDirectory()) out.push(`site/vendor/${e.name}: not a library of package.json's`);
  const html = await readFile(INDEX, 'utf8');
  if (indexWith(html, await moduleGraph()) !== html) out.push('index.html: the Content-Security-Policy or the preloads');
  const sw = await readFile(SW, 'utf8');
  if (swWith(sw, await shellFiles()) !== sw) out.push('sw.js: the list of the page\'s files');
  return out;
}

async function write() {
  await mkdir(VENDOR, { recursive: true });
  const w = await wanted();
  for (const e of await readdir(VENDOR, { withFileTypes: true })) if (!w.has(e.name) || e.isDirectory()) await rm(new URL(e.name, VENDOR), { recursive: true }); // a library renamed or dropped, or anything else left there
  for (const [name, bytes] of w) await writeFile(new URL(name, VENDOR), bytes);
  await writeFile(INDEX, indexWith(await readFile(INDEX, 'utf8'), await moduleGraph()));
  await writeFile(SW, swWith(await readFile(SW, 'utf8'), await shellFiles()));
  console.log('site/vendor/, the policy, the preloads and the service worker\'s files written');
}


// newest period the WMS offers for each density dataset vs the newest one catalog.js lists
async function dataReport() {
  const { DENSITY, HA_WMS } = await import('../site/catalog.js');
  const r = await fetch(`${HA_WMS}?service=WMS&request=GetCapabilities&version=1.3.0`);
  if (!r.ok) throw new Error(`EMODnet capabilities ${r.status}`);
  const xml = await r.text();
  for (const [id, d] of Object.entries(DENSITY)) {
    const name = d.layer('all');
    const i = xml.indexOf(`<Name>${name}</Name>`);
    const times = (/name="time"[^>]*>([^<]*)/.exec(xml.slice(i, xml.indexOf('</Layer>', i))) || [])[1] || '';
    const newest = times.match(/\d{4}-\d{2}/g)?.sort().at(-1);
    const listed = [...d.periods].sort().at(-1);
    const offered = id === 'traffic' ? newest?.slice(0, 4) : newest;
    const newer = offered && offered > listed;
    console.log(`${d.title.padEnd(24)} listed to ${listed.padEnd(8)} WMS offers to ${offered}${newer ? '   ← newer data: update catalog.js' : ''}`);
    if (newer && process.env.GITHUB_ACTIONS) console.log(`::notice title=Newer ${d.title}::the WMS has ${offered}; catalog.js lists to ${listed}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv;
  if (a.includes('--write')) await write();
  else await dataReport();
}
