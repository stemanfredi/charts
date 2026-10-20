#!/usr/bin/env node
// Smoke test in headless Chrome, against the live tile providers: the page loads without
// errors, the menu drives the map, URL state survives a reload, PNG export works.
//   CHROME=/path/to/chrome npm run smoke     (default: /usr/bin/google-chrome)
// Network-dependent by design: it is also what tells us a provider changed or went down.
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { serve, chromeOptions } from './serve.mjs';

const server = await serve();
const base = server.url;
const browser = await chromium.launch(chromeOptions());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const failures = [];
// cross-origin requests that carried a Referer (the page and the clip worker both promise none)
const referred = new Set();
ctx.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && r.headers().referer) referred.add(u.host); });
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };

async function open(hash) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text().slice(0, 200)));
  await page.goto(base + hash);
  await page.waitForFunction(() => window.map?.loaded() && map.areTilesLoaded(), null, { timeout: 90000 });
  await page.waitForTimeout(1000);
  return page;
}
const visible = (page, id) => page.evaluate((id) => map.getLayoutProperty(id, 'visibility'), id);

try {
  // default view
  let p = await open('');
  check(p.errors.length === 0, `default view loads without errors ${p.errors.join(' | ')}`);
  check(await p.evaluate(() => map.getStyle().layers.length > 30), 'style has its layers');
  const broken = await p.evaluate(() => [...document.querySelectorAll('.item.error')].map((r) => r.querySelector('label').textContent));
  check(broken.length === 0, `no source marked failing ${broken.join(', ')}`);
  check(referred.size === 0, `no request to a tile host carries a Referer ${[...referred].join(', ')}`);

  // menu: a group checkbox switches all its items; base radio swaps chart and satellite
  await p.click('details[data-group=sea] summary input');
  check((await visible(p, 'seamarks')) === 'visible', 'group checkbox turns on all its items');
  await p.click('label[for=i-sat]');
  check((await visible(p, 'esri')) === 'visible' && (await visible(p, 'water')) === 'none', 'satellite replaces the chart base');
  await p.waitForTimeout(1500);
  const credits = await p.evaluate(() => document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent || '');
  const live = await p.evaluate(async () => (await (await fetch('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json')).json()).copyrightText);
  check(credits.includes('Powered by Esri') && credits.includes(live), `Esri credits: "Powered by Esri" and the service's own text (${live})`);
  await p.mouse.move(640, 400); await p.mouse.down(); await p.mouse.move(500, 300, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(500);
  check(await p.evaluate(() => !document.querySelector('.maplibregl-ctrl-attrib').classList.contains('maplibregl-compact')), 'credits stay written out on desktop after a drag');
  await p.close();

  // URL state: view, layers and measurements survive a reload; Link copies the current view
  p = await open('#v=9/43.4/9.9/0&on=chart,coastline,depth,isobaths&u=nm&m=r:9.5,43.6;10.1,43.2~c:10,43.5;15000&menu=1&g=measure');
  const kinds = (await p.evaluate(() => [...document.querySelectorAll('.mlist .item .line label')].map((l) => l.textContent.split(' ')[0]))).join();
  check(kinds === 'Ruler,Ring', `measurements load from the URL as ruler and ring (${kinds})`);
  await p.evaluate(() => map.jumpTo({ center: [12, 41], zoom: 6 }));
  await p.click('#link');
  const link = await p.evaluate(() => navigator.clipboard.readText());
  check(link.includes('v=6.00/41.00000/12.00000') && link.includes('c:10,43.5;15000'), 'Link copies the current view with its measurements');
  const again = await open(new URL(link).hash);
  check((await again.evaluate(() => map.getZoom().toFixed(2))) === '6.00' && (await visible(again, 'isobaths')) === 'visible', 'the copied link reopens the same view and layers');
  check(again.errors.length === 0, `reloaded view without errors ${again.errors.join(' | ')}`);

  // vessel density (EMODnet, off by default): loads, has a legend, type and year change the tiles
  const tr = await open('#v=7/37.5/14/0&on=chart,coastline,traffic,legend&menu=1&g=sea');
  check(tr.errors.length === 0 && !(await tr.evaluate(() => document.querySelector('#i-traffic').closest('.item').classList.contains('error'))), `vessel density loads ${tr.errors.join(' | ')}`);
  check(await tr.evaluate(() => !!document.querySelector('#legends canvas[data-legend=traffic]')), 'vessel density legend shown');
  await tr.selectOption('.item:has(#i-traffic) select.variant', 't10');
  await tr.selectOption('.item:has(#i-traffic) select.period', '2019');
  await tr.waitForTimeout(500); // the URL is written 250 ms after a change
  const tiles = await tr.evaluate(() => map.getSource('traffic').tiles[0]);
  const hash = await tr.evaluate(() => location.hash);
  check(/vesseldensity_10avg&/.test(tiles) && /time=2019-/.test(tiles), 'ship type and year select the WMS layer and time');
  check(/var=[^&]*traffic:t10/.test(hash) && /per=[^&]*traffic:2019/.test(hash), 'ship type and year are kept in the link');
  await tr.close();

  // route density (EMSA, monthly): newest month by default, month and type change the tiles
  const rt = await open('#v=7/37.5/14/0&on=chart,coastline,routes,legend&menu=1&g=sea');
  check(rt.errors.length === 0 && !(await rt.evaluate(() => document.querySelector('#i-routes').closest('.item').classList.contains('error'))), `route density loads ${rt.errors.join(' | ')}`);
  await rt.selectOption('.item:has(#i-routes) select.variant', 't04');
  await rt.selectOption('.item:has(#i-routes) select.period', '2025-11');
  await rt.waitForTimeout(500);
  const rtiles = await rt.evaluate(() => map.getSource('routes').tiles[0]);
  check(/routedensity_04&/.test(rtiles) && /time=2025-11-01T/.test(rtiles) && /per=[^&]*routes:2025-11/.test(await rt.evaluate(() => location.hash)), 'route density month and type in tiles and link');
  check(await rt.evaluate(() => !!document.querySelector('#legends canvas[data-legend=routes]')), 'route density legend shown');
  check((await rt.evaluate(() => document.querySelector('.item:has(#i-routes) select.period').selectedOptions[0].text)) === 'Nov 2025', 'months labelled as "Nov 2025"');
  await rt.close();


  // PNG export
  const [dl] = await Promise.all([again.waitForEvent('download', { timeout: 60000 }), again.click('#png')]);
  const png = await readFile(await dl.path());
  check(png.length > 50_000 && png.subarray(1, 4).toString() === 'PNG', `PNG export (${Math.round(png.length / 1024)} KB)`);
} catch (err) {
  check(false, `smoke run crashed: ${err.message}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
