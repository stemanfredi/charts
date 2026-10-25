#!/usr/bin/env node
// Smoke test in headless Chrome, against the live tile providers: the page loads without
// errors, the menu drives the map, URL state survives a reload, PNG and GIS export work.
//   CHROME=/path/to/chrome npm run smoke     (default: /usr/bin/google-chrome)
// Network-dependent by design: it is also what tells us a provider changed or went down.
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { serve, chromeOptions } from './serve.mjs';

const server = await serve();
const base = server.url;
const browser = await chromium.launch(chromeOptions());
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
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
  await page.waitForFunction(() => window.map?.loaded?.() && map.areTilesLoaded(), null, { timeout: 90000 });
  await page.waitForTimeout(1000);
  return page;
}
const visible = (page, id) => page.evaluate((id) => map.getLayoutProperty(id, 'visibility'), id);

try {
  // default view
  let p = await open('');
  check(p.errors.length === 0, `default view loads without errors ${p.errors.join(' | ')}`);
  check(await p.evaluate(() => map.getStyle().layers.length > 30), 'style has its layers');
  const broken = await p.evaluate(() => [...document.querySelectorAll('.item.error')].map((r) => `${r.querySelector('label').textContent} (${r.title})`));
  check(broken.length === 0, `no source marked failing ${broken.join(', ')}`);
  check(referred.size === 0, `no request to a tile host carries a Referer ${[...referred].join(', ')}`);

  // menu: a row's switch turns its layer on; the base cards swap chart and satellite
  await p.click('label[for=i-seamarks]');
  check((await visible(p, 'seamarks')) === 'visible', 'a layer row turns its layer on');
  await p.click('.basecard[data-base=sat]');
  check((await visible(p, 'esri')) === 'visible' && (await visible(p, 'water')) === 'none', 'satellite replaces the chart base');
  await p.waitForTimeout(1500);
  const credits = await p.evaluate(() => document.querySelector('.credits-text')?.textContent || '');
  const live = await p.evaluate(async () => (await (await fetch('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json')).json()).copyrightText);
  check(credits.includes('Powered by Esri') && credits.includes(live), `Esri credits: "Powered by Esri" and the service's own text (${live})`);
  // the base map's credit first, so a line cut at its end ("…") never cuts it
  await p.click('.basecard[data-base=chart]');
  await p.waitForTimeout(500);
  const chartCredits = await p.evaluate(() => document.querySelector('.credits-text').textContent);
  check(credits.startsWith('Powered by Esri') && chartCredits.startsWith('© OpenStreetMap'), `the base map's credit first (${credits.slice(0, 30)}… / ${chartCredits.slice(0, 30)}…)`);
  await p.close();

  // URL state: view, layers and measurements survive a reload; Link copies the current view
  p = await open('#v=9/35.9/14.4/0&on=chart,coastline,depth,isobaths&u=nm&m=r:14,36.1;14.6,35.7~c:14.5,36;15000&menu=1&g=measure');
  const kinds = (await p.evaluate(() => [...document.querySelectorAll('.mlist label.name')].map((l) => l.textContent.split(' ')[0]))).join();
  check(kinds === 'Ruler,Ring', `measurements load from the URL as ruler and ring (${kinds})`);
  await p.evaluate(() => map.jumpTo({ center: [12, 41], zoom: 6 }));
  await p.click('#link');
  const link = await p.evaluate(() => navigator.clipboard.readText());
  check(link.includes('v=6.00/41.00000/12.00000') && link.includes('c:14.5,36;15000'), 'Link copies the current view with its measurements');
  const again = await open(new URL(link).hash);
  check((await again.evaluate(() => map.getZoom().toFixed(2))) === '6.00' && (await visible(again, 'isobaths')) === 'visible', 'the copied link reopens the same view and layers');
  check(again.errors.length === 0, `reloaded view without errors ${again.errors.join(' | ')}`);

  // one side panel: Measure replaces Layers in place, the link keeps the view, its button closes it
  const pv = await open('#v=6/41/12/0&menu=1');
  await pv.click('#b-measure');
  await pv.waitForTimeout(400);
  const views = await pv.evaluate(() => [!document.querySelector('#panel').hidden, document.querySelector('#lview').hidden, !document.querySelector('#mview').hidden, document.querySelector('#panel-title').textContent, location.hash.includes('menu=measure')]);
  check(views.join() === 'true,true,true,Measure,true', `Measure switches the panel in place and the link keeps it (${views.join()})`);
  await pv.click('#b-measure');
  check(await pv.evaluate(() => document.querySelector('#panel').hidden), "the shown view's button closes the panel");
  await pv.close();

  // NASA true colour opened at now: the time goes no later than NASA's newest day, and the tiles
  // are of the day shown (no older day passed off as it)
  const tc = await open('#v=5/40/10/0&menu=1&g=data&col=gibs:terra&on=chart,coastline');
  await tc.waitForFunction(() => map.getLayoutProperty('gibs-terra', 'visibility') === 'visible' && /t=/.test(location.hash), null, { timeout: 20000 }).catch(() => {});
  await tc.waitForTimeout(500);
  const [tcTiles, tcHash, rowsOn, tcNotes] = await tc.evaluate(() => [map.getSource('gibs-terra').tiles[0], location.hash, document.querySelector('#when').hidden ? 'hidden' : 'shown',
    document.querySelectorAll('.item .note:not([hidden])').length]);
  const tcDay = /\/(\d{4}-\d{2}-\d{2})\//.exec(tcTiles)?.[1] || '', tcT = /t=([\d-]+T\d\d)/.exec(tcHash)?.[1] || '';
  check(rowsOn === 'shown' && tcDay && tcT.startsWith(tcDay) && tcDay <= new Date().toISOString().slice(0, 10) && !tcNotes, `NASA true colour: the tiles are of the day shown, no later than today, no note (${tcDay}, t=${tcT})`);
  await tc.close();

  // a zoom alone updates what depends on it: a layer out of its range greyed out with its hint,
  // the depth shading's legend gone above zoom 12
  const zm = await open('#v=8/43.6/13.6/0&on=chart,coastline,depth,seamarks,legend&menu=1&g=sea');
  const zoomed = () => zm.evaluate(() => [document.querySelector('.item:has(#i-seamarks) .hint').textContent, document.querySelector('.item:has(#i-seamarks)').classList.contains('dim'), !!document.querySelector('#legends canvas[data-legend=depth]')]);
  const z8 = await zoomed();
  await zm.evaluate(() => map.jumpTo({ zoom: 13.5 }));
  await zm.waitForTimeout(500);
  const z13 = await zoomed();
  check(z8.join() === 'zoom 9+,true,true' && z13.join() === ',false,false', `a zoom updates the hints and legends (zoom 8: ${z8}; 13.5: ${z13})`);
  await zm.close();

  // search: coordinates are read on the page (no request); a place comes from Photon
  const sp = await open('#v=6/41/12/0&menu=0');
  const near = (lat, lon, tol) => sp.evaluate(({ lat, lon, tol }) => { const c = map.getCenter(); return Math.abs(c.lat - lat) < tol && Math.abs(c.lng - lon) < tol; }, { lat, lon, tol });
  let photonCalls = 0;
  sp.on('request', (r) => { if (r.url().includes('photon.komoot.io')) photonCalls++; });
  await sp.fill('#q', '35 54N 14 31E');
  await sp.keyboard.press('Enter');
  await sp.waitForTimeout(2500);
  check((await near(35.9, 14 + 31 / 60, 0.01)) && photonCalls === 0, 'coordinates in the search box go there, without a request');
  await sp.fill('#q', 'Valletta');
  await sp.waitForSelector('#results li[role=option]', { timeout: 15000 }).catch(() => {});
  await sp.keyboard.press('Enter');
  await sp.waitForTimeout(2500);
  check((await near(35.9, 14.51, 0.05)) && photonCalls > 0, 'a place name is found (Photon) and the map goes there');
  check(sp.errors.length === 0, `search without errors ${sp.errors.join(' | ')}`);
  await sp.close();

  // vessel density (EMODnet, off by default): loads, has a legend, type and year change the tiles
  const tr = await open('#v=7/37.5/14/0&on=chart,coastline,traffic,legend&menu=1&g=shipping');
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
  const rt = await open('#v=7/37.5/14/0&on=chart,coastline,routes,legend&menu=1&g=shipping');
  check(rt.errors.length === 0 && !(await rt.evaluate(() => document.querySelector('#i-routes').closest('.item').classList.contains('error'))), `route density loads ${rt.errors.join(' | ')}`);
  await rt.selectOption('.item:has(#i-routes) select.variant', 't04');
  await rt.selectOption('.item:has(#i-routes) select.period', '2025-11');
  await rt.waitForTimeout(500);
  const rtiles = await rt.evaluate(() => map.getSource('routes').tiles[0]);
  check(/routedensity_04&/.test(rtiles) && /time=2025-11-01T/.test(rtiles) && /per=[^&]*routes:2025-11/.test(await rt.evaluate(() => location.hash)), 'route density month and type in tiles and link');
  check(await rt.evaluate(() => !!document.querySelector('#legends canvas[data-legend=routes]')), 'route density legend shown');
  check((await rt.evaluate(() => document.querySelector('.item:has(#i-routes) select.period').selectedOptions[0].text)) === 'Nov 2025', 'months labelled as "Nov 2025"');
  await rt.close();


  // Copernicus sea state, waves in colour and currents in arrows: tiles load, the legends show
  const cm = await open('#v=6/40/14/0&col=waves:height&arr=currents:surface&on=chart,coastline,legend&menu=1&g=data');
  await cm.waitForFunction(() => document.querySelectorAll('#legends canvas[data-legend=waves], #legends canvas[data-legend=currents]').length === 2, null, { timeout: 30000 }).catch(() => {});
  const cmBroken = await cm.evaluate(() => [...document.querySelectorAll('.item.error, .item.partial')].map((r) => `${r.querySelector('.name').textContent} (${r.title})`));
  check(cmBroken.length === 0 && cm.errors.length === 0, `Copernicus waves and currents load ${cmBroken.join(', ')} ${cm.errors.join(' | ')}`);
  const [cmPicks, cmLink] = await cm.evaluate(() => [[...document.querySelectorAll('.pick select')].map((s) => s.value).join(' '), location.hash]);
  check(cmPicks === 'waves:height currents:surface' && /col=waves:height/.test(cmLink) && /arr=currents:surface/.test(cmLink) && !/on=[^&]*waves/.test(cmLink),
    `the link's entries are in the menus and stay in the link: colours, arrows ${cmPicks}`);
  check(await cm.evaluate(() => document.querySelectorAll('#legends canvas[data-legend=waves], #legends canvas[data-legend=currents]').length === 2), 'Copernicus legends shown');
  // the time line at the panel's foot: a time picked there (local time) is drawn, read above the
  // legends and kept in the link; › steps an hour; Now goes back to now
  const ahead = await cm.evaluate(() => { const d = new Date(Date.now() + 864e5); d.setMinutes(0, 0, 0); return d.getTime(); });
  const aLocal = await cm.evaluate((t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`; }, ahead);
  const [minMax, shownOn] = await cm.evaluate(() => [[document.querySelector('#when input').min, document.querySelector('#when input').max], !document.querySelector('#shown').hidden]);
  check(shownOn && minMax[0] > '2020' && minMax[1] > minMax[0] && !minMax[1].startsWith('2099'), `the field holds the dates the layers have (${minMax.join(' to ')})`);
  await cm.fill('#when input', aLocal);
  await cm.waitForTimeout(1500);
  const [shownText, cmHash] = await cm.evaluate(() => [document.querySelector('#shown').textContent, location.hash]);
  check(!shownText.startsWith('Today') && cmHash.includes(`t=${new Date(ahead).toISOString().slice(0, 13)}`), `a time picked on the time line is drawn, shown beside the coordinates and kept in the link (${shownText})`);
  const cmAgain = await open(cmHash);
  check((await cmAgain.evaluate(() => document.querySelector('#when input').value)) === aLocal, 'the link reopens at that time');
  await cm.click('#when [data-step="1"]');
  await cm.waitForTimeout(500);
  check((await cm.evaluate(() => location.hash)).includes(`t=${new Date(ahead + 36e5).toISOString().slice(0, 13)}`), 'the later button steps one hour');
  // a day typed key by key passes through years 0002, 0020, 0202: none of them is taken
  await cm.focus('#when input');
  await cm.keyboard.type(`${aLocal.slice(5, 7)}${aLocal.slice(8, 10)}${aLocal.slice(0, 4)}`); // en-US field: mm dd yyyy first
  await cm.waitForTimeout(500);
  check(/t=20\d\d-/.test(await cm.evaluate(() => location.hash)), 'a day typed key by key never jumps to a year before 2000');
  await cm.click('#when [data-now]');
  await cm.waitForTimeout(500);
  check((await cm.evaluate(() => document.querySelector('#shown').textContent)).startsWith('Today'), 'Now goes back to now');
  // About, in the right-hand column
  await cm.click('#b-about');
  check(await cm.evaluate(() => document.querySelector('#about').open), 'the About button opens About');
  await cm.click('#about [data-close]');
  await cm.close(); await cmAgain.close();
  // the Ocean data menus: waves in colours, currents in arrows; wind in arrows; currents in both
  // draw speed and direction; none
  const sl = await open('#v=6/40/14/0&col=waves:height&arr=currents:surface&on=chart,coastline&menu=1&g=data');
  const looks = () => sl.evaluate(() => ['waves', 'currents', 'wind'].map((id) => (map.getLayoutProperty(`cmems-${id}`, 'visibility') === 'visible' ? `${id}:${/cmems:\/\/\w+\/\w+\/(\w+)/.exec(map.getSource(`cmems-${id}`).tiles[0] || '')?.[1]}` : '')).filter(Boolean).join(' '));
  await sl.waitForTimeout(1000);
  const l1 = await looks();
  await sl.selectOption('select[aria-label=Arrows]', 'wind:observed');
  await sl.waitForTimeout(500);
  const l2 = await looks();
  await sl.selectOption('select[aria-label=Colours]', 'currents:surface');
  await sl.selectOption('select[aria-label=Arrows]', 'currents:surface');
  await sl.waitForTimeout(500);
  const [l3, l3hash] = [await looks(), await sl.evaluate(() => location.hash)];
  await sl.selectOption('select[aria-label=Colours]', '');
  await sl.selectOption('select[aria-label=Arrows]', '');
  await sl.waitForTimeout(500);
  const [l4, whenHidden] = [await looks(), await sl.evaluate(() => document.querySelector('#when').hidden)];
  check(l1 === 'waves:colour currents:arrows' && l2 === 'waves:colour wind:arrows' && l3 === 'currents:both' && /col=currents:surface&arr=currents:surface/.test(l3hash) && !l4 && whenHidden,
    `Ocean data menus: ${l1} → arrows wind: ${l2} → currents in both: ${l3} → none: ${l4 || 'nothing drawn, no time line'}`);
  await sl.close();
  // water properties at a depth from the link: "100 m deep" beside the time, each model at its own
  // level (the export records it), no note under the row
  const wp = await open('#v=5/40/10/0&col=temperature:depth&on=chart,coastline,legend&menu=1&g=data&dz=100');
  await wp.waitForFunction(() => !!document.querySelector('#legends canvas[data-legend=temperature]')?.style.width, null, { timeout: 30000 }).catch(() => {});
  const [wpDepth, wpNotes, wpBroken] = await wp.evaluate(() => [document.querySelector('#when .depthsel select').value + ' ' + document.querySelector('#shown').textContent,
    document.querySelectorAll('.item .note:not([hidden])').length, [...document.querySelectorAll('.item.error, .item.partial')].map((r) => r.title)]);
  check(/^100 .* · 100 m deep$/.test(wpDepth) && !wpNotes && !wpBroken.length && !wp.errors.length, `temperature at 100 m, set on the time line and shown as "100 m deep": ${wpDepth} ${wpBroken.join(' ')} ${wp.errors.join(' | ')}`);
  // the depth on a row of its own, under the time line, which keeps its width
  const [inW, below] = await wp.evaluate(() => { const i = document.querySelector('#when input').getBoundingClientRect(), d = document.querySelector('#when .depthsel').getBoundingClientRect(); return [i.width, d.top >= i.bottom]; });
  check(below && inW >= 150, `the depth sits under the time line, which keeps its width (${Math.round(inW)} px)`);
  await wp.close();
  // a satellite observation opened at now: the time goes no later than its latest day, and the
  // day shown is the day drawn
  const ob = await open('#v=5/40/10/0&col=sst:measured&on=chart,coastline,legend&menu=1&g=data');
  await ob.waitForFunction(() => /t=/.test(location.hash) && !!document.querySelector('#legends canvas[data-legend=sst]')?.style.width, null, { timeout: 30000 }).catch(() => {});
  await ob.waitForTimeout(1500);
  const [obT, obWithin, obShown, obDay, obBroken] = await ob.evaluate(() => {
    const t = /t=([\d-]+T\d\d)/.exec(location.hash)?.[1] || '', ms = Date.parse(`${t}:00:00Z`);
    return [t, ms <= new Date(document.querySelector('#when input').max).getTime(), document.querySelector('#shown').textContent,
      `${new Date(ms).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' })} ${new Date(ms).getUTCDate()} ${new Date(ms).toLocaleDateString([], { month: 'short', timeZone: 'UTC' })}`, [...document.querySelectorAll('.item.error, .item.partial')].map((r) => r.title)];
  });
  check(obT && obWithin && (obShown === 'Today' || obShown === obDay) && !obBroken.length && !ob.errors.length,
    `sea surface temperature: the time within its days, its day shown (t=${obT}, ${obShown}) ${obBroken.join(' ')} ${ob.errors.join(' | ')}`);
  await ob.close();

  // the nautical scale reads NM, as Measure and the PNG do (MapLibre writes "nm")
  check(/\d\sNM$/.test(await again.evaluate(() => document.querySelectorAll('.maplibregl-ctrl-scale')[1].textContent)), 'the nautical scale reads NM');
  // PNG export
  const [dl] = await Promise.all([again.waitForEvent('download', { timeout: 60000 }), again.click('#png')]);
  const png = await readFile(await dl.path());
  check(png.length > 50_000 && png.subarray(1, 4).toString() === 'PNG', `PNG export (${Math.round(png.length / 1024)} KB)`);
  // the map's size (no strip under it), its details in text fields
  const [cw, chh] = await again.evaluate(() => [map.getCanvas().width, map.getCanvas().height]);
  const text = png.toString('latin1');
  check(png.readUInt32BE(16) === cw && png.readUInt32BE(20) === chh && /iTXtCopyright\0[^]*OpenStreetMap/.test(text) && /iTXtDisclaimer\0\0\0\0\0Not for navigation/.test(text),
    `PNG export: the map's size (${png.readUInt32BE(16)}×${png.readUInt32BE(20)}), credits and disclaimer in its text fields`);
  // GIS export: a zip whose STAC item lists the georeferenced map and the files beside it;
  // polygon-clipping loads on this first export, not with the page
  check(await again.evaluate(() => !('polygonClipping' in window) && !document.querySelector('script[src*=polygon-clipping]')), 'polygon-clipping not loaded with the page');
  // an export that fails says so on its button, and the next click tries again
  await again.route('**/polygon-clipping*', (r) => r.abort());
  await again.click('#zip');
  await again.waitForFunction(() => document.querySelector('#zip span').textContent === 'Failed', null, { timeout: 15000 }).catch(() => {});
  const [zipLabel, zipTitle] = await again.evaluate(() => [document.querySelector('#zip span').textContent, document.querySelector('#zip').title]);
  check(zipLabel === 'Failed' && /polygon-clipping/.test(zipTitle), `a failed GIS export says so on its button (${zipLabel}: ${zipTitle})`);
  await again.unroute('**/polygon-clipping*');
  const [dz] = await Promise.all([again.waitForEvent('download', { timeout: 60000 }), again.click('#zip')]);
  const z = await readFile(await dz.path());
  const names = ['item.json', 'map.png', 'map.pgw', 'map.png.aux.xml', 'chart.png', 'vector/coastline.geojson', 'vector/isobaths.geojson', 'raster/depth.tif'];
  check(z.readUInt32LE(0) === 0x04034b50 && names.every((n) => z.includes(n)) && dz.suggestedFilename().endsWith('.zip'), `GIS export holds ${names.join(', ')} (${Math.round(z.length / 1024)} KB)`);
  // item.json lists every file in the zip, once (central directory: name and local header offset)
  const unzip = (zz) => {
    const entries = [];
    for (let p = zz.readUInt32LE(zz.length - 6); zz.readUInt32LE(p) === 0x02014b50; p += 46 + zz.readUInt16LE(p + 28)) {
      entries.push({ name: zz.toString('utf8', p + 46, p + 46 + zz.readUInt16LE(p + 28)), at: zz.readUInt32LE(p + 42), method: zz.readUInt16LE(p + 10), size: zz.readUInt32LE(p + 20) });
    }
    const ij = entries.find((e) => e.name === 'item.json'), body = zz.subarray(ij.at + 30 + zz.readUInt16LE(ij.at + 26), ij.at + 30 + zz.readUInt16LE(ij.at + 26) + ij.size);
    return { entries, item: JSON.parse((ij.method ? inflateRawSync(body) : body).toString()) };
  };
  const { entries, item } = unzip(z);
  const listed = Object.values(item.assets).map((a) => a.href.replace(/^\.\//, '')).sort().join();
  check(listed === entries.map((e) => e.name).filter((n) => n !== 'item.json').sort().join(), `item.json lists every file in the zip (${Object.keys(item.assets).length} assets)`);
  // GEBCO's own values under the depth shading: its grid over the view, in metres, at a level that fits
  const gb = item.assets['raster/gebco-depth'];
  check(entries.some((e) => e.name === 'raster/gebco-depth.tif') && gb?.bands?.[0]?.unit === 'm' && gb['proj:code'] === 'EPSG:4326' && /GEBCO 2026/.test(gb.description),
    `GIS export: GEBCO's depths as values (${gb ? `${gb['proj:shape'].join(' × ')} cells, ${/level \d+|own grid/.exec(gb.description)?.[0]}` : 'missing'})`);
  // the values of a Copernicus layer, from its datasets' Zarr stores: global and Mediterranean waves
  const cv = await open('#v=7/39.5/14/0&col=waves:height&on=chart,coastline&menu=0');
  await cv.waitForTimeout(3000);
  const [dv] = await Promise.all([cv.waitForEvent('download', { timeout: 120000 }), cv.click('#zip')]);
  const { entries: ve, item: vi } = unzip(await readFile(await dv.path()));
  const wave = (k) => vi.assets[k]?.bands?.[0];
  check(['raster/waves-global.tif', 'raster/waves-mediterranean.tif'].every((n) => ve.some((e) => e.name === n)) && wave('raster/waves-mediterranean')?.name === 'VHM0' && wave('raster/waves-mediterranean')?.unit === 'm'
    && vi.assets['raster/waves-mediterranean']['proj:code'] === 'EPSG:4326' && cv.errors.length === 0,
    `GIS export: the waves' values as GeoTIFF, global and Mediterranean (${ve.filter((e) => e.name.startsWith('raster/')).map((e) => e.name).join(', ')}) ${cv.errors.join(' | ')}`);
  await cv.close();

  // ---- the export says what the map shows (parity) ----
  // one view per kind of layer; each exported, and the zip compared with the map as it was
  const files = (zz) => { // name → bytes, every entry of a zip
    const out = {};
    for (let p = zz.readUInt32LE(zz.length - 6); zz.readUInt32LE(p) === 0x02014b50; p += 46 + zz.readUInt16LE(p + 28)) {
      const name = zz.toString('utf8', p + 46, p + 46 + zz.readUInt16LE(p + 28)), at = zz.readUInt32LE(p + 42), size = zz.readUInt32LE(p + 20);
      const body = zz.subarray(at + 30 + zz.readUInt16LE(at + 26), at + 30 + zz.readUInt16LE(at + 26) + size);
      out[name] = zz.readUInt16LE(p + 10) ? inflateRawSync(body) : body;
    }
    return out;
  };
  const pngFields = (b) => { // a PNG's size and iTXt text fields
    const f = { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    for (let p = 8; p < b.length;) {
      const n = b.readUInt32BE(p), type = b.toString('latin1', p + 4, p + 8);
      if (type === 'iTXt') { const parts = b.subarray(p + 8, p + 8 + n).toString('utf8').split('\0'); f[parts[0]] = parts.at(-1); }
      if (type === 'IEND') break;
      p += n + 12;
    }
    return f;
  };
  const PARITY = [
    ['density and depth, no time', '#v=7/37.5/14/0&on=chart,coastline,depth,traffic,legend'],
    ['NASA daily', '#v=5/40/10/0&col=gibs:terra&on=chart,coastline'],
    ['Copernicus colours and arrows', '#v=6/39/14/0&col=waves:height&arr=currents:surface&on=chart,coastline,legend'],
    ['Copernicus at a depth', '#v=6/39/14/0&col=temperature:depth&dz=100&on=chart,coastline,legend'],
    ['daily only, an observation', '#v=6/39/14/0&col=sst:measured&on=chart,coastline,legend'],
  ];
  for (const [what, hash] of PARITY) {
    const pp = await open(`${hash}&menu=0`);
    await pp.waitForTimeout(3000);
    const seen = await pp.evaluate(() => { // the map, read from MapLibre itself
      const z = map.getZoom(), on = new Set(), draws = {};
      for (const l of map.getStyle().layers) {
        if (!l.metadata?.item || map.getLayoutProperty(l.id, 'visibility') !== 'visible' || z < (l.minzoom ?? 0) || z >= (l.maxzoom ?? 24)) continue;
        on.add(l.metadata.item);
        const look = /^cmems:\/\/\w+\/\w+\/(\w+)/.exec(map.getSource(l.source)?.tiles?.[0] || '')?.[1];
        if (look) draws[l.metadata.item] = look;
      }
      return { on: [...on].sort(), draws, t: /t=([\d-]+T\d\d)/.exec(location.hash)?.[1] || '', dz: +(/dz=(\d+)/.exec(location.hash)?.[1] || 0),
        hourly: /\d:\d\d/.test(document.querySelector('#shown').textContent), canvas: [map.getCanvas().width, map.getCanvas().height] };
    });
    const [dl] = await Promise.all([pp.waitForEvent('download', { timeout: 120000 }), pp.click('#zip')]);
    const zf = files(await readFile(await dl.path())), item = JSON.parse(zf['item.json']), pr = item.properties, layers = pr['chart:layers'];
    const chart = pngFields(zf['chart.png']), timed = !!seen.t;
    const expect = !timed ? pr.created : seen.hourly ? `${seen.t}:00:00.000Z` : `${seen.t.slice(0, 10)}T00:00:00Z`;
    const dataText = !timed ? null : seen.hourly ? `data at ${seen.t.replace('T', ' ')}:00 UTC` : `data of ${seen.t.slice(0, 10)}`;
    const wrong = [];
    if (layers.map((l) => l.id).sort().join() !== seen.on.join()) wrong.push(`layers ${layers.map((l) => l.id).sort()} ≠ map ${seen.on}`);
    if (pr.datetime !== expect) wrong.push(`datetime ${pr.datetime} ≠ ${expect}`);
    for (const l of layers) {
      if (seen.draws[l.id] && l.draws !== seen.draws[l.id]) wrong.push(`${l.id} draws ${l.draws} ≠ map ${seen.draws[l.id]}`);
      if (seen.dz && l.depth_m != null && Math.abs(l.depth_m - seen.dz) > seen.dz * 0.15) wrong.push(`${l.id} at ${l.depth_m} m ≠ ${seen.dz} m`);
      if (seen.draws[l.id] && !(l.assets || []).some((a) => a.startsWith(`raster/${l.id}`))) wrong.push(`${l.id}: no values`);
    }
    if (chart.width !== seen.canvas[0] || chart.height !== seen.canvas[1]) wrong.push(`chart.png ${chart.width}×${chart.height} ≠ map ${seen.canvas.join('×')}`);
    if (dataText && !chart.Description?.includes(dataText)) wrong.push(`chart.png says "${chart.Description}", not "${dataText}"`);
    if (chart.Copyright !== pr['chart:attribution']) wrong.push('chart.png and item.json credit differently');
    check(!wrong.length && !pp.errors.length, `export parity, ${what}: ${wrong.join('; ') || `${layers.length} layers, ${pr.datetime}`} ${pp.errors.join(' | ')}`);
    await pp.close();
  }
  // EMODnet: depth and its values, seabed substrate with its classes, the human activities overlays
  const em = await open('#v=9/52.6/3.2/0&on=chart,coastline,emodnetdepth,substrate,cables,windfarms,wrecks,worlddensity,depthsource,legend&menu=0');
  await em.waitForTimeout(3000);
  const [emBroken, emClasses] = await em.evaluate(() => [[...document.querySelectorAll('.item.error, .item.partial')].map((r) => `${r.querySelector('.name').textContent} (${r.title})`),
    document.querySelector('#legends canvas[data-legend=substrate]')?.getAttribute('aria-label') || '']);
  const [de] = await Promise.all([em.waitForEvent('download', { timeout: 120000 }), em.click('#zip')]);
  const emFiles = files(await readFile(await de.path())), emItem = JSON.parse(emFiles['item.json']);
  check(!emBroken.length && !em.errors.length && /Sand/.test(emClasses) && emFiles['raster/emodnet-depth.tif'] && emItem.assets['raster/emodnet-depth']?.bands?.[0]?.unit === 'm',
    `EMODnet and World Bank layers load; substrate classes (${emClasses.slice(0, 60)}…); the depth values in the GIS export ${emBroken.join(', ')} ${em.errors.join(' | ')}`);
  // where GEBCO's depths come from: its layer draws, its codes go in the GIS export
  const src = emItem.assets['raster/gebco-source'];
  check(emFiles['raster/gebco-source.tif'] && /type identifier/.test(src?.description || '') && src?.['proj:code'] === 'EPSG:4326'
    && (await em.evaluate(() => /Surveyed/.test(document.querySelector('#legends canvas[data-legend=depthsource]')?.getAttribute('aria-label') || ''))),
    `depth sources (GEBCO): drawn with its legend, its codes in the GIS export (${src ? src['proj:shape'].join(' × ') : 'missing'})`);
  await em.close();
  // a click on the sea says its depth (GEBCO, rounded towards shallower) and its source; on land, nothing
  const dp = await open('#v=9/43.9/8.3/0&on=chart,coastline,depth,isobaths&menu=0');
  const at = async (lng, lat) => {
    const { x, y } = await dp.evaluate(([a, b]) => map.project([a, b]), [lng, lat]);
    await dp.mouse.click(x, y);
    await dp.waitForTimeout(2500);
    return dp.evaluate(() => document.querySelector('.depthpop .maplibregl-popup-content > div')?.textContent || '');
  };
  const sea = await at(8.3, 43.9), land = await at(8.0, 44.2);
  check(/^\d+ m deepGEBCO 2026 · (surveyed|estimated|other grids, unknown)$/.test(sea) && !land && !dp.errors.length, `a click on the sea gives its depth and source (${sea}); on land, nothing ${dp.errors.join(' | ')}`);
  // isobaths over the shading take its colours up to its last zoom, then the style's blue again
  const ink = await dp.evaluate(() => [map.getPaintProperty('isobaths', 'line-color'), map.getStyle().layers.find((l) => l.id === 'depth').maxzoom]);
  check(Array.isArray(ink[0]) && ink[0][0] === 'step' && ink[0][3] === ink[1] && ink[0][4] === '#335f97', `isobaths: the shading's colours up to zoom ${ink[1]}, its deepest blue above (${JSON.stringify(ink[0]).slice(0, 80)})`);
  await dp.close();
  // Marine Regions' maritime limits load, with their legend (line types, from its WMS)
  const mz = await open('#v=6/40/16/0&on=chart,coastline,maritime,legend&menu=0');
  await mz.waitForFunction(() => /Median line/.test(document.querySelector('#legends canvas[data-legend=maritime]')?.getAttribute('aria-label') || ''), null, { timeout: 30000 }).catch(() => {});
  const [mzBroken, mzLegend] = await mz.evaluate(() => [[...document.querySelectorAll('.item.error, .item.partial')].map((r) => r.title), document.querySelector('#legends canvas[data-legend=maritime]')?.getAttribute('aria-label') || '']);
  check(!mzBroken.length && !mz.errors.length && /Median line/.test(mzLegend), `maritime zones load, with their legend (${mzLegend.slice(0, 60)}…) ${mzBroken.join(', ')} ${mz.errors.join(' | ')}`);
  await mz.close();
} catch (err) {
  check(false, `smoke run crashed: ${err.message}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
