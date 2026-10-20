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

  // menu: a group checkbox switches all its items; base radio swaps chart and satellite
  await p.click('details[data-group=sea] summary input');
  check((await visible(p, 'seamarks')) === 'visible', 'group checkbox turns on all its items');
  await p.click('label[for=i-sat]');
  check((await visible(p, 'esri')) === 'visible' && (await visible(p, 'water')) === 'none', 'satellite replaces the chart base');
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
