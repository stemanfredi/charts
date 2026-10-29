#!/usr/bin/env node
// Smoke test in headless Chrome, against the live tile providers: the page loads without
// errors, the menu drives the map, URL state survives a reload, PNG and GIS export work.
//   CHROME=/path/to/chrome npm run smoke     (default: /usr/bin/google-chrome)
// Network-dependent by design: it is also what tells us a provider changed or went down.
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { start } from './browser.mjs';

const { browser, base, check, section, finish } = await start();
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
// cross-origin requests that carried a Referer (the page and the clip worker both promise none)
const referred = new Set();
ctx.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && r.headers().referer) referred.add(u.host); });

// a page at hash, loaded, its errors collected (in: another context, a phone's)
// tab: the left panel's tab to open on ('layers', 'elements'), as the frame keeps it in this browser;
// groups: the Layers groups open, as the page keeps them in this browser
async function open(hash, inCtx = ctx, tab = null, groups = null) {
  const page = await inCtx.newPage();
  if (tab) await page.addInitScript((t) => { const k = 'charts.frame'; localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), tab: t })); }, tab);
  if (groups) await page.addInitScript((gs) => localStorage.setItem('charts.groups.open', JSON.stringify(gs)), groups);
  page.errors = []; // the page's own: thrown errors, and what it logs as an error
  page.providerErrors = []; // a provider's: a resource the browser could not load (an HTTP 500, a refused tile)
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && (/Failed to load resource/.test(m.text()) ? page.providerErrors : page.errors).push(m.text().slice(0, 200)));
  await page.goto(base + hash);
  await page.waitForFunction(() => window.map?.loaded?.() && map.areTilesLoaded(), null, { timeout: 90000 });
  await page.waitForTimeout(1000);
  return page;
}
const visible = (page, id) => page.evaluate((id) => map.getLayoutProperty(id, 'visibility'), id);
// one of the view's outputs: the link (the bar's own button), png, zip (in the bar's Download menu, which
// stays open while an export runs; each item says how it went)
const exportItem = async (page, id) => {
  if (id === 'link') return page.click('#bar .linkbtn');
  if (!(await page.isVisible(`.dmenu #${id}`))) await page.click('#bar .dlbtn');
  await page.click(`#${id}`);
};
// the time line: behind the time chip on the bottom row
const timeOpen = async (page) => { if (!(await page.isVisible('#when'))) await page.click('#shown'); };
// the search: a field in the bar (a phone: behind its lens)
const findOpen = async (page) => page.click((await page.isVisible('#b-find')) ? '#b-find' : '#q');


// name → bytes, every entry of a zip (central directory: name and local header offset), and its item.json
function files(zz) {
  const out = {};
  for (let p = zz.readUInt32LE(zz.length - 6); zz.readUInt32LE(p) === 0x02014b50; p += 46 + zz.readUInt16LE(p + 28)) {
    const name = zz.toString('utf8', p + 46, p + 46 + zz.readUInt16LE(p + 28)), at = zz.readUInt32LE(p + 42), size = zz.readUInt32LE(p + 20);
    const body = zz.subarray(at + 30 + zz.readUInt16LE(at + 26), at + 30 + zz.readUInt16LE(at + 26) + size);
    out[name] = zz.readUInt16LE(p + 10) ? inflateRawSync(body) : body;
  }
  return out;
}
const unzip = (zz) => { const f = files(zz); return { files: f, names: Object.keys(f), item: JSON.parse(f['item.json']) }; };
// a PNG's size and iTXt text fields
function pngFields(b) {
  const f = { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  for (let p = 8; p < b.length;) {
    const n = b.readUInt32BE(p), type = b.toString('latin1', p + 4, p + 8);
    if (type === 'iTXt') { const parts = b.subarray(p + 8, p + 8 + n).toString('utf8').split('\0'); f[parts[0]] = parts.at(-1); }
    if (type === 'IEND') break;
    p += n + 12;
  }
  return f;
}

await section('the default view and the menu', async () => {
  // default view
  const p = await open('');
  check(p.errors.length === 0, `default view loads without errors ${p.errors.join(' | ')}`);
  check(await p.evaluate(() => map.getStyle().layers.length > 30), 'style has its layers');
  const broken = await p.evaluate(() => [...document.querySelectorAll('.item.error')].map((r) => `${r.querySelector('label').textContent} (${r.title})`));
  check(broken.length === 0, `no source marked failing ${broken.join(', ')}`, true);
  check(referred.size === 0, `no request to a tile host carries a Referer ${[...referred].join(', ')}`);

  // menu: a row's switch turns its layer on; the base cards swap chart and satellite
  await p.click('label[for=i-seamarks]');
  check((await visible(p, 'seamarks')) === 'visible', 'a layer row turns its layer on');
  await p.click('.basecard[data-base=sat]');
  check((await visible(p, 'esri')) === 'visible' && (await visible(p, 'water')) === 'none', 'satellite replaces the chart base');
  // the credits follow the base map a moment later (Esri's text is fetched): waited for, not timed
  await p.waitForFunction(() => /^Powered by Esri/.test(document.querySelector('.credits-text')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const credits = await p.evaluate(() => document.querySelector('.credits-text')?.textContent || '');
  const live = await p.evaluate(async () => (await (await fetch('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json')).json()).copyrightText);
  check(credits.includes('Powered by Esri') && credits.includes(live), `Esri credits: "Powered by Esri" and the service's own text (${live})`, true);
  // the base map's credit first, so a line cut at its end ("…") never cuts it
  await p.click('.basecard[data-base=chart]');
  await p.waitForFunction(() => /^© OpenStreetMap/.test(document.querySelector('.credits-text')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const chartCredits = await p.evaluate(() => document.querySelector('.credits-text').textContent);
  check(credits.startsWith('Powered by Esri') && chartCredits.startsWith('© OpenStreetMap'), `the base map's credit first (${credits.slice(0, 30)}… / ${chartCredits.slice(0, 30)}…)`);
  await p.close();
});

await section('URL state, Link, Measure, a bad link', async () => {
  // URL state: view and layers survive a reload; Link copies the current view. Measure: what it
  // measured goes in the drawing, a guide showing its values, selected
  const p = await open('#v=9/35.9/14.4/0&on=chart,coastline,depth,isobaths&u=nm');
  await p.evaluate(() => { if (!document.querySelector('#side').hidden) document.querySelector('#bar .ptab[aria-pressed=true]').click(); }); // the left panel closed: the clicks below land on the map
  await p.keyboard.press('m'); // Measure, a distance
  await p.mouse.click(300, 300);
  await p.mouse.move(420, 340);
  await p.waitForTimeout(200); // the values drawn
  const liveValues = await p.evaluate(() => map.querySourceFeatures('drawvalue').length);
  await p.mouse.dblclick(420, 340);
  const made = await p.evaluate(() => [drawing.doc.lines.length, drawing.sel.has(drawing.doc.lines[0]?.id), drawing.tool]);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const kinds = (await p.evaluate(() => drawing.doc.lines.map((l) => l.name.split(' ')[0]))).sort().join(); // the list is built only while seen: the panel is closed
  const measured = await p.evaluate(async () => { const { elements, isMeasurement } = await import('./draw/document.js'); return [elements(drawing.doc).filter((x) => isMeasurement(drawing.doc, x.el)).length, map.querySourceFeatures('drawvalue').map((f) => f.properties.label)]; });
  check(made.join() === '1,true,measure' && kinds === 'Distance' && measured[0] === 1 && measured[1].some((t) => /NM$/.test(t)) && liveValues > 0,
    `Measure: a distance in the drawing, selected, the tool still on (${made}); a guide showing its values in NM; the leg's length shown while drawing (${kinds}; ${measured[1].join(' | ')}; ${liveValues} live)`);
  await p.evaluate(() => map.jumpTo({ center: [12, 41], zoom: 6 }));
  await exportItem(p, 'link');
  const link = await p.evaluate(() => navigator.clipboard.readText());
  check(link.includes('v=6.00/41.00000/12.00000'), 'Link copies the current view');
  const again = await open(new URL(link).hash);
  check((await again.evaluate(() => map.getZoom().toFixed(2))) === '6.00' && (await visible(again, 'isobaths')) === 'visible', 'the copied link reopens the same view and layers');
  check(again.errors.length === 0, `reloaded view without errors ${again.errors.join(' | ')}`);
  await again.close();
  // a link with a latitude past the pole and a time that is no date: the page comes up, both ignored
  const bad = await open('#v=5/95/10/0&t=2026-13-40T99&on=chart');
  const badView = await bad.evaluate(() => [map.getCenter().lat, document.querySelector('#nostart')]);
  check(bad.errors.length === 0 && Math.abs(badView[0]) <= 85.1 && badView[1] === null, `a bad link's latitude and time are ignored, the page starts (lat ${badView[0]}) ${bad.errors.join(' | ')}`);
  await bad.close();
});

await section('the frame', async () => {
  // the bar always there across the top; Layers the left panel's tab, its key closing it; its toggle
  // opening it again where it was; the panel open never in the link
  const pv = await open('#v=6/41/12/0', ctx, 'layers');
  const now = () => pv.evaluate(() => [!document.querySelector('#side').hidden && document.querySelector('#bar .ptab[aria-pressed=true]')?.dataset.tab, Math.round(document.querySelector('#bar').getBoundingClientRect().top),
    new URLSearchParams(location.hash.slice(1)).has('menu')]);
  const opened = await now();
  await pv.keyboard.press('l');
  await pv.waitForTimeout(400);
  const closed = await now();
  await pv.click('#bar .ptab[data-tab=layers]');
  const back = await now();
  check(opened.join() === 'layers,0,false' && closed.join() === 'false,0,false' && back[0] === 'layers', `Layers a tab of the left panel, closed by its key, opened again by its button in the bar; the bar at the top; not in the link (${opened}; ${closed}; ${back})`);
  // the drawing renamed by a double-click on its row, the tree's first (an undo puts it back)
  await pv.click('#bar .ptab[data-tab=elements]');
  await pv.dblclick('.droot .dname');
  await pv.keyboard.type('Survey');
  await pv.keyboard.press('Enter');
  const named = await pv.evaluate(() => drawing.doc.meta.title);
  await pv.evaluate(() => drawing.undo());
  const unnamed = await pv.evaluate(() => [drawing.doc.meta.title, document.querySelector('.droot .dname').textContent]);
  check(named === 'Survey' && unnamed.join() === ',Untitled drawing', `the drawing renamed by a double-click on its row, back with an undo (${named}; ${unnamed})`);
  // every button of the bar on the screen, from a phone's width up, with a mouse and with a finger (44 px
  // buttons: under 1,280 px the file group and the search in Open's menu and behind the lens)
  const fitsAt = async (page, widths) => {
    const fits = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(200);
      fits.push(await page.evaluate(() => [...document.querySelectorAll('#bar > *')].every((e) => !e.offsetParent || e.getBoundingClientRect().right <= innerWidth) && document.documentElement.scrollWidth <= innerWidth
        && [...document.querySelectorAll('#bar > button')].every((b) => !b.offsetParent || [...b.querySelectorAll('svg')].some((i) => i.getBoundingClientRect().width > 0)))); // each button shown with its icon
    }
    return fits;
  };
  const mouse = await fitsAt(pv, [390, 720, 1024, 1440]);
  const tctx = await browser.newContext({ viewport: { width: 820, height: 800 }, hasTouch: true, isMobile: true });
  const finger = await fitsAt(await open('#v=6/41/12/0', tctx), [390, 820, 1180, 1280]);
  await tctx.close();
  check([...mouse, ...finger].every(Boolean), `the bar within the window, each button with its icon, with a mouse at 390, 720, 1024, 1440 px (${mouse}) and a finger at 390, 820, 1180, 1280 (${finger})`);
  await pv.close();
});

await section('NASA true colour', async () => {
  // NASA true colour opened at now: the time goes no later than NASA's newest day, and the tiles
  // are of the day shown (no older day passed off as it)
  const tc = await open('#v=5/40/10/0&col=gibs:terra&on=chart,coastline', ctx, 'layers', ['data']);
  await tc.waitForFunction(() => map.getLayoutProperty('gibs-terra', 'visibility') === 'visible' && /t=/.test(location.hash), null, { timeout: 20000 }).catch(() => {});
  await tc.waitForTimeout(500);
  const [tcTiles, tcHash, rowsOn, tcNotes] = await tc.evaluate(() => [map.getSource('gibs-terra').tiles[0], location.hash, document.querySelector('#when').hidden ? 'hidden' : 'shown',
    document.querySelectorAll('.item .note:not([hidden])').length]);
  const tcDay = /\/(\d{4}-\d{2}-\d{2})\//.exec(tcTiles)?.[1] || '', tcT = /t=([\d-]+T\d\d)/.exec(tcHash)?.[1] || '';
  check(rowsOn === 'shown' && tcDay && tcT.startsWith(tcDay) && tcDay <= new Date().toISOString().slice(0, 10) && !tcNotes, `NASA true colour: the tiles are of the day shown, no later than today, no note (${tcDay}, t=${tcT})`, true);
  await tc.close();
});

await section('a zoom', async () => {
  // a zoom alone updates what depends on it: a layer out of its range greyed out with its hint,
  // the depth shading's legend gone above zoom 12
  const zm = await open('#v=8/43.6/13.6/0&on=chart,coastline,depth,seamarks,legend', ctx, 'layers', ['sea']);
  const zoomed = () => zm.evaluate(() => [document.querySelector('.item:has(#i-seamarks) .hint').textContent, document.querySelector('.item:has(#i-seamarks)').classList.contains('dim'), !!document.querySelector('#legends canvas[data-legend=depth]')]);
  const z8 = await zoomed();
  await zm.evaluate(() => map.jumpTo({ zoom: 13.5 }));
  await zm.waitForTimeout(500);
  const z13 = await zoomed();
  check(z8.join() === 'zoom 9+,true,true' && z13.join() === ',false,false', `a zoom updates the hints and legends (zoom 8: ${z8}; 13.5: ${z13})`);
  await zm.close();
});

await section('search', async () => {
  // search: coordinates are read on the page (no request); a place comes from Photon
  const sp = await open('#v=6/41/12/0', ctx, 'elements');
  // there: in the middle of the map's part left free by the left frame (from 1024 px wide), within tol degrees
  const near = (lat, lon, tol) => sp.evaluate(({ lat, lon, tol }) => {
    const side = document.querySelector('#side'), props = document.querySelector('#props'), top = document.querySelector('#bar').offsetHeight;
    const L = side.hidden ? 0 : side.getBoundingClientRect().right, R = props.hidden ? innerWidth : props.getBoundingClientRect().left;
    const c = map.unproject([(L + R) / 2, (top + innerHeight) / 2]);
    return Math.abs(c.lat - lat) < tol && Math.abs(c.lng - lon) < tol;
  }, { lat, lon, tol });
  let photonCalls = 0;
  sp.on('request', (r) => { if (r.url().includes('photon.komoot.io')) photonCalls++; });
  await findOpen(sp);
  await sp.fill('#q', '35 54N 14 31E');
  await sp.keyboard.press('Enter');
  await sp.waitForTimeout(2500);
  check((await near(35.9, 14 + 31 / 60, 0.01)) && photonCalls === 0, 'coordinates in the search box go there, without a request');
  await findOpen(sp);
  await sp.fill('#q', 'Valletta');
  await sp.waitForSelector('#results li[role=option]', { timeout: 15000 }).catch(() => {});
  await sp.keyboard.press('Enter');
  await sp.waitForTimeout(2500);
  check((await near(35.9, 14.51, 0.05)) && photonCalls > 0, 'a place name is found (Photon) and the map goes there', true);
  check(sp.errors.length === 0, `search without errors ${sp.errors.join(' | ')}`);
  await sp.close();
});

await section('vessel density', async () => {
  // vessel density (EMODnet, off by default): loads, has a legend, type and year change the tiles
  const tr = await open('#v=7/37.5/14/0&on=chart,coastline,traffic,legend', ctx, 'layers', ['shipping']);
  check(tr.errors.length === 0 && !(await tr.evaluate(() => document.querySelector('#i-traffic').closest('.item').classList.contains('error'))), `vessel density loads ${tr.errors.join(' | ')}`, true);
  check(await tr.evaluate(() => !!document.querySelector('#legends canvas[data-legend=traffic]')), 'vessel density legend shown', true);
  await tr.selectOption('.item:has(#i-traffic) select.variant', 't10');
  await tr.selectOption('.item:has(#i-traffic) select.period', '2019');
  await tr.waitForTimeout(500); // the URL is written 250 ms after a change
  const tiles = await tr.evaluate(() => map.getSource('traffic').tiles[0]);
  const hash = await tr.evaluate(() => location.hash);
  check(/vesseldensity_10avg&/.test(tiles) && /time=2019-/.test(tiles), 'ship type and year select the WMS layer and time');
  check(/var=[^&]*traffic:t10/.test(hash) && /per=[^&]*traffic:2019/.test(hash), 'ship type and year are kept in the link');
  await tr.close();
});

await section('route density', async () => {
  // route density (EMSA, monthly): newest month by default, month and type change the tiles
  const rt = await open('#v=7/37.5/14/0&on=chart,coastline,routes,legend', ctx, 'layers', ['shipping']);
  check(rt.errors.length === 0 && !(await rt.evaluate(() => document.querySelector('#i-routes').closest('.item').classList.contains('error'))), `route density loads ${rt.errors.join(' | ')}`, true);
  await rt.selectOption('.item:has(#i-routes) select.variant', 't04');
  await rt.selectOption('.item:has(#i-routes) select.period', '2025-11');
  await rt.waitForTimeout(500);
  const rtiles = await rt.evaluate(() => map.getSource('routes').tiles[0]);
  check(/routedensity_04&/.test(rtiles) && /time=2025-11-01T/.test(rtiles) && /per=[^&]*routes:2025-11/.test(await rt.evaluate(() => location.hash)), 'route density month and type in tiles and link');
  check(await rt.evaluate(() => !!document.querySelector('#legends canvas[data-legend=routes]')), 'route density legend shown', true);
  check((await rt.evaluate(() => document.querySelector('.item:has(#i-routes) select.period').selectedOptions[0].text)) === 'Nov 2025', 'months labelled as "Nov 2025"');
  await rt.close();
});

await section('Copernicus layers, the time line, About, the manifest, my location', async () => {
  // Copernicus sea state, waves in colour and currents in arrows: tiles load, the legends show
  const cm = await open('#v=6/40/14/0&col=waves:height&arr=currents:surface&on=chart,coastline,legend', ctx, 'layers', ['data']);
  await cm.waitForFunction(() => document.querySelectorAll('#legends canvas[data-legend=waves], #legends canvas[data-legend=currents]').length === 2, null, { timeout: 30000 }).catch(() => {});
  const cmBroken = await cm.evaluate(() => [...document.querySelectorAll('.item.error, .item.partial')].map((r) => `${r.querySelector('.name').textContent} (${r.title})`));
  check(cmBroken.length === 0 && cm.errors.length === 0, `Copernicus waves and currents load ${cmBroken.join(', ')} ${cm.errors.join(' | ')}`, true);
  const [cmPicks, cmLink] = await cm.evaluate(() => [[...document.querySelectorAll('.pick select')].map((s) => s.value).join(' '), location.hash]);
  check(cmPicks === 'waves:height currents:surface' && /col=waves:height/.test(cmLink) && /arr=currents:surface/.test(cmLink) && !/on=[^&]*waves/.test(cmLink),
    `the link's entries are in the menus and stay in the link: colours, arrows ${cmPicks}`);
  check(await cm.evaluate(() => document.querySelectorAll('#legends canvas[data-legend=waves], #legends canvas[data-legend=currents]').length === 2), 'Copernicus legends shown', true);
  // the time chip: a time picked there (local time) is drawn, read above the legends and kept in
  // the link
  const ahead = await cm.evaluate(() => { const d = new Date(Date.now() + 864e5); d.setMinutes(0, 0, 0); return d.getTime(); });
  const aLocal = await cm.evaluate((t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`; }, ahead);
  const [minMax, shownOn] = await cm.evaluate(() => [[document.querySelector('#when input').min, document.querySelector('#when input').max], !document.querySelector('#shown').hidden]);
  check(shownOn && minMax[0] > '2020' && minMax[1] > minMax[0] && !minMax[1].startsWith('2099'), `the field holds the dates the layers have (${minMax.join(' to ')})`, true);
  await timeOpen(cm);
  await cm.fill('#when input', aLocal);
  await cm.waitForTimeout(1500);
  const [shownText, cmHash] = await cm.evaluate(() => [document.querySelector('#shown').textContent, location.hash]);
  check(!shownText.startsWith('Today') && cmHash.includes(`t=${new Date(ahead).toISOString().slice(0, 13)}`), `a time picked on the time line is drawn, shown beside the coordinates and kept in the link (${shownText})`);
  const cmAgain = await open(cmHash);
  check((await cmAgain.evaluate(() => document.querySelector('#when input').value)) === aLocal, 'the link reopens at that time');
  // a day typed key by key passes through years 0002, 0020, 0202: none of them is taken
  await cm.focus('#when input');
  await cm.keyboard.type(`${aLocal.slice(5, 7)}${aLocal.slice(8, 10)}${aLocal.slice(0, 4)}`); // en-US field: mm dd yyyy first
  await cm.waitForTimeout(500);
  check(/t=20\d\d-/.test(await cm.evaluate(() => location.hash)), 'a day typed key by key never jumps to a year before 2000');
  await cm.fill('#when input', await cm.evaluate(() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`; }));
  await cm.waitForTimeout(500);
  check((await cm.evaluate(() => document.querySelector('#shown').textContent)).startsWith('Today'), 'now typed in the field goes back to today');
  // About, the bar's ⓘ
  await cm.click('#bar .aboutbtn');
  check(await cm.evaluate(() => document.querySelector('#about').open), 'the About button opens About');
  await cm.click('#about [data-close]');
  check(await cm.evaluate(() => !document.querySelector('#nostart')), 'the map started: the notice that it did not is gone');
  // installable: the manifest and every icon it names are served
  const app = await cm.evaluate(async () => {
    const m = await (await fetch('manifest.webmanifest')).json();
    return [m.name, m.display, (await Promise.all(m.icons.map((i) => fetch(i.src).then((r) => r.ok)))).every(Boolean), m.icons.length];
  });
  check(app[0] === 'Charts' && app[1] === 'standalone' && app[2] && app[3] >= 3, `the app's manifest and its icons (${app.join(', ')})`);
  // my location: off until pressed; on, the map goes there and shows the dot and its accuracy; off, gone
  await cm.context().grantPermissions(['geolocation']);
  await cm.context().setGeolocation({ latitude: 40.85, longitude: 14.27, accuracy: 30 });
  await cm.click('#locate');
  const shown = () => map.getSource('mylocation').serialize().data.features.length;
  await cm.waitForFunction(`(${shown})() === 2 && !map.isMoving()`, null, { timeout: 15000 }).catch(() => {});
  const loc = await cm.evaluate(`[document.querySelector('#locate').getAttribute('aria-pressed'), (${shown})(), map.getCenter().lng, map.getCenter().lat]`);
  await cm.click('#locate');
  const off = await cm.evaluate(`[document.querySelector('#locate').getAttribute('aria-pressed'), (${shown})()]`);
  check(loc[0] === 'true' && loc[1] === 2 && Math.abs(loc[2] - 14.27) < 0.01 && Math.abs(loc[3] - 40.85) < 0.01 && off[0] === 'false' && off[1] === 0,
    `my location: shown where the device is, the map brought there, then hidden (${loc.map((x) => (typeof x === 'number' ? x.toFixed(3) : x)).join(', ')}; off ${off.join(', ')})`);
  // coordinates being typed never reach the place search
  const sent = [];
  cm.on('request', (r) => { if (r.url().includes('photon')) sent.push(r.url()); });
  await findOpen(cm);
  await cm.fill('#q', '35 54N 14');
  await cm.waitForTimeout(800);
  check(!sent.length && /latitude, then longitude/.test(await cm.textContent('#results')), `coordinates being typed stay in the page (${sent.length} sent)`);
  await cm.fill('#q', '');
  await cm.close(); await cmAgain.close();
});

await section('the Ocean data menus', async () => {
  // the Ocean data menus: waves in colours, currents in arrows; wind in arrows; currents in both
  // draw speed and direction; none
  const sl = await open('#v=6/40/14/0&col=waves:height&arr=currents:surface&on=chart,coastline', ctx, 'layers', ['data']);
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
});

await section('water properties at a depth', async () => {
  // water properties at a depth from the link: "100 m deep" in its chip beside the time's, each model
  // at its own level (the export records it), no note under the row
  const wp = await open('#v=5/40/10/0&col=temperature:depth&on=chart,coastline,legend&dz=100', ctx, 'layers', ['data']);
  await wp.waitForFunction(() => !!document.querySelector('#legends canvas[data-legend=temperature]')?.style.width, null, { timeout: 30000 }).catch(() => {});
  const [wpDepth, wpNotes, wpBroken] = await wp.evaluate(() => [document.querySelector('#depth').value + ' ' + document.querySelector('#depth').selectedOptions[0]?.textContent,
    document.querySelectorAll('.item .note:not([hidden])').length, [...document.querySelectorAll('.item.error, .item.partial')].map((r) => r.title)]);
  check(wpDepth === '100 100 m deep' && !wpNotes && !wpBroken.length && !wp.errors.length, `temperature at 100 m, shown in the depth chip as "100 m deep": ${wpDepth} ${wpBroken.join(' ')} ${wp.errors.join(' | ')}`, true);
  // the depth's chip beside the time's, a list of its own; the time's chip says the time only
  const [chips, timeText] = await wp.evaluate(() => { const t = document.querySelector('#shown').getBoundingClientRect(), d = document.querySelector('#depth').getBoundingClientRect(); return [d.width > 0 && Math.abs(d.top - t.top) < 4 && d.left >= t.right, document.querySelector('#shown').textContent]; });
  check(chips && !/deep/.test(timeText), `the depth a chip beside the time's (${timeText})`);
  await wp.close();
});

await section('a satellite observation', async () => {
  // a satellite observation opened at now: the time goes no later than its latest day, and the
  // day shown is the day drawn
  const ob = await open('#v=5/40/10/0&col=sst:measured&on=chart,coastline,legend', ctx, 'layers', ['data']);
  await ob.waitForFunction(() => /t=/.test(location.hash) && !!document.querySelector('#legends canvas[data-legend=sst]')?.style.width, null, { timeout: 30000 }).catch(() => {});
  await ob.waitForTimeout(1500);
  const [obT, obWithin, obShown, obDay, obBroken] = await ob.evaluate(() => {
    const t = /t=([\d-]+T\d\d)/.exec(location.hash)?.[1] || '', ms = Date.parse(`${t}:00:00Z`);
    return [t, ms <= new Date(document.querySelector('#when input').max).getTime(), document.querySelector('#shown').textContent,
      `${new Date(ms).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' })} ${new Date(ms).getUTCDate()} ${new Date(ms).toLocaleDateString([], { month: 'short', timeZone: 'UTC' })}`, [...document.querySelectorAll('.item.error, .item.partial')].map((r) => r.title)];
  });
  check(obT && obWithin && (obShown === 'Today' || obShown === obDay) && !obBroken.length && !ob.errors.length && !ob.providerErrors.length,
    `sea surface temperature: the time within its days, its day shown (t=${obT}, ${obShown}) ${obBroken.join(' ')} ${[...ob.errors, ...ob.providerErrors].slice(0, 3).join(' | ')}`, true);
  await ob.close();
});

await section('the PNG and GIS exports', async () => {
  const again = await open('#v=6/41/12/0&on=chart,coastline,depth,isobaths&u=nm'); // the view the link reopened
  // the scale is in the display's units, one bar: NM here, as Measure does (MapLibre writes "nm")
  check(/\d\sNM$/.test(await again.evaluate(() => document.querySelector('#scale').textContent)) && await again.evaluate(() => document.querySelectorAll('.maplibregl-ctrl-scale').length === 1), 'the scale reads NM, one bar');
  // PNG export
  const [dl] = await Promise.all([again.waitForEvent('download', { timeout: 60000 }), exportItem(again, 'png')]);
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
  await exportItem(again, 'zip');
  const zipSays = '#zip';
  await again.waitForFunction((sel) => document.querySelector(`${sel} span`).textContent === 'Failed', zipSays, { timeout: 15000 }).catch(() => {});
  const [zipLabel, zipTitle] = await again.evaluate((sel) => [document.querySelector(`${sel} span`).textContent, document.querySelector(sel).title], zipSays);
  check(zipLabel === 'Failed' && /polygon-clipping/.test(zipTitle), `a failed GIS export says so on its button (${zipLabel}: ${zipTitle})`);
  await again.unroute('**/polygon-clipping*');
  await again.keyboard.press('Escape'); // the menu closed (from 1024 px wide it stays open while an export runs)
  const [dz] = await Promise.all([again.waitForEvent('download', { timeout: 60000 }), exportItem(again, 'zip')]);
  const z = await readFile(await dz.path());
  const names = ['item.json', 'map.png', 'map.pgw', 'map.png.aux.xml', 'chart.png', 'vector/coastline.geojson', 'vector/isobaths.geojson', 'raster/depth.tif'];
  check(z.readUInt32LE(0) === 0x04034b50 && names.every((n) => z.includes(n)) && dz.suggestedFilename().endsWith('.zip'), `GIS export holds ${names.join(', ')} (${Math.round(z.length / 1024)} KB)`);
  // item.json lists every file in the zip, once
  const { names: entries, item } = unzip(z);
  const listed = Object.values(item.assets).map((a) => a.href.replace(/^\.\//, '')).sort().join();
  check(listed === entries.filter((n) => n !== 'item.json').sort().join(), `item.json lists every file in the zip (${Object.keys(item.assets).length} assets)`);
  // GEBCO's own values under the depth shading: its grid over the view, in metres, at a level that fits
  const gb = item.assets['raster/gebco-depth'];
  check(entries.includes('raster/gebco-depth.tif') && gb?.bands?.[0]?.unit === 'm' && gb['proj:code'] === 'EPSG:4326' && /GEBCO 2026/.test(gb.description),
    `GIS export: GEBCO's depths as values (${gb ? `${gb['proj:shape'].join(' × ')} cells, ${/level \d+|own grid/.exec(gb.description)?.[0]}` : 'missing'})`);
  await again.close();
});

await section('the values of a Copernicus layer in the GIS export', async () => {
  // the values of a Copernicus layer, from its datasets' Zarr stores: global and Mediterranean waves
  const cv = await open('#v=7/39.5/14/0&col=waves:height&on=chart,coastline', ctx, 'elements');
  await cv.waitForTimeout(3000);
  const [dv] = await Promise.all([cv.waitForEvent('download', { timeout: 120000 }), exportItem(cv, 'zip')]);
  const { names: ve, item: vi } = unzip(await readFile(await dv.path()));
  const wave = (k) => vi.assets[k]?.bands?.[0];
  check(['raster/waves-global.tif', 'raster/waves-mediterranean.tif'].every((n) => ve.includes(n)) && wave('raster/waves-mediterranean')?.name === 'VHM0' && wave('raster/waves-mediterranean')?.unit === 'm'
    && vi.assets['raster/waves-mediterranean']['proj:code'] === 'EPSG:4326' && cv.errors.length === 0,
    `GIS export: the waves' values as GeoTIFF, global and Mediterranean (${ve.filter((n) => n.startsWith('raster/')).join(', ')}) ${cv.errors.join(' | ')}`, true);
  await cv.close();
});

await section('export parity', async () => {
  // the export says what the map shows: one view per kind of layer; each exported, and the zip compared
  // with the map as it was
  const PARITY = [
    ['density and depth, no time', '#v=7/37.5/14/0&on=chart,coastline,depth,traffic,legend'],
    ['NASA daily', '#v=5/40/10/0&col=gibs:terra&on=chart,coastline'],
    ['Copernicus colours and arrows', '#v=6/39/14/0&col=waves:height&arr=currents:surface&on=chart,coastline,legend'],
    ['Copernicus at a depth', '#v=6/39/14/0&col=temperature:depth&dz=100&on=chart,coastline,legend'],
    ['daily only, an observation', '#v=6/39/14/0&col=sst:measured&on=chart,coastline,legend'],
  ];
  for (const [what, hash] of PARITY) {
    const pp = await open(`${hash}`, ctx, 'elements');
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
    const [dl] = await Promise.all([pp.waitForEvent('download', { timeout: 120000 }), exportItem(pp, 'zip')]);
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
});

await section('EMODnet and the depth sources', async () => {
  // EMODnet: depth and its values, seabed substrate with its classes, the human activities overlays
  const em = await open('#v=9/52.6/3.2/0&on=chart,coastline,emodnetdepth,substrate,cables,windfarms,wrecks,worlddensity,depthsource,legend', ctx, 'elements');
  await em.waitForTimeout(3000);
  const [emBroken, emClasses] = await em.evaluate(() => [[...document.querySelectorAll('.item.error, .item.partial')].map((r) => `${r.querySelector('.name').textContent} (${r.title})`),
    document.querySelector('#legends canvas[data-legend=substrate]')?.getAttribute('aria-label') || '']);
  const [de] = await Promise.all([em.waitForEvent('download', { timeout: 120000 }), exportItem(em, 'zip')]);
  const emFiles = files(await readFile(await de.path())), emItem = JSON.parse(emFiles['item.json']);
  check(!emBroken.length && !em.errors.length && /Sand/.test(emClasses) && emFiles['raster/emodnet-depth.tif'] && emItem.assets['raster/emodnet-depth']?.bands?.[0]?.unit === 'm',
    `EMODnet and World Bank layers load; substrate classes (${emClasses.slice(0, 60)}…); the depth values in the GIS export ${emBroken.join(', ')} ${em.errors.join(' | ')}`, true);
  // where GEBCO's depths come from: its layer draws, its codes go in the GIS export
  const src = emItem.assets['raster/gebco-source'];
  check(emFiles['raster/gebco-source.tif'] && /type identifier/.test(src?.description || '') && src?.['proj:code'] === 'EPSG:4326'
    && (await em.evaluate(() => /Surveyed/.test(document.querySelector('#legends canvas[data-legend=depthsource]')?.getAttribute('aria-label') || ''))),
    `depth sources (GEBCO): drawn with its legend, its codes in the GIS export (${src ? src['proj:shape'].join(' × ') : 'missing'})`);
  await em.close();
});

await section('the depth on a click', async () => {
  // a click on the sea says its depth (GEBCO, rounded towards shallower) and its source; on land, nothing
  const dp = await open('#v=9/43.9/8.3/0&on=chart,coastline,depth,isobaths', ctx, 'elements');
  const at = async (lng, lat) => {
    const { x, y } = await dp.evaluate(([a, b]) => map.project([a, b]), [lng, lat]);
    await dp.mouse.click(x, y);
    await dp.waitForTimeout(2500);
    return dp.evaluate(() => document.querySelector('.depthpop .maplibregl-popup-content > div')?.textContent || '');
  };
  const sea = await at(8.3, 43.9), land = await at(8.0, 44.2);
  check(/^\d+ m\d+°[\d.]+′[NS] \d+°[\d.]+′[EW]GEBCO 2026 · (surveyed|estimated|other grids, unknown)$/.test(sea) && !land && !dp.errors.length, `a click on the sea gives its depth, the place and the source (${sea}); on land, nothing ${dp.errors.join(' | ')}`);
  // isobaths over the shading take its colours up to its last zoom, then the style's blue again
  const ink = await dp.evaluate(() => [map.getPaintProperty('isobaths', 'line-color'), map.getStyle().layers.find((l) => l.id === 'depth').maxzoom]);
  check(Array.isArray(ink[0]) && ink[0][0] === 'step' && ink[0][3] === ink[1] && ink[0][4] === '#335f97', `isobaths: the shading's colours up to zoom ${ink[1]}, its deepest blue above (${JSON.stringify(ink[0]).slice(0, 80)})`);
  await dp.close();
});

await section('seagrass', async () => {
  // seagrass: its tiles from the bucket draw meadows off Liguria, with their legend; a tile with no
  // seagrass (none stored) is empty, not an error
  const sg = await open('#v=11/44.1/9.75/0&on=chart,coastline,seagrass,legend', ctx, 'elements');
  const [sgDrawn, sgLegend] = await sg.evaluate(() => [map.queryRenderedFeatures({ layers: ['seagrass', 'seagrass-points'] }).length,
    document.querySelector('#legends canvas[data-legend=seagrass]')?.getAttribute('aria-label') || '']);
  check(sgDrawn > 0 && /Posidonia oceanica/.test(sgLegend) && !sg.errors.length, `seagrass: ${sgDrawn} features drawn, with its legend ${sg.errors.join(' | ')}`);
  await sg.close();
});

await section('maritime zones', async () => {
  // Marine Regions' maritime limits load, with their legend (line types, from its WMS)
  const mz = await open('#v=6/40/16/0&on=chart,coastline,maritime,legend', ctx, 'elements');
  await mz.waitForFunction(() => /Median line/.test(document.querySelector('#legends canvas[data-legend=maritime]')?.getAttribute('aria-label') || ''), null, { timeout: 30000 }).catch(() => {});
  const [mzBroken, mzLegend] = await mz.evaluate(() => [[...document.querySelectorAll('.item.error, .item.partial')].map((r) => r.title), document.querySelector('#legends canvas[data-legend=maritime]')?.getAttribute('aria-label') || '']);
  check(!mzBroken.length && !mz.errors.length && /Median line/.test(mzLegend), `maritime zones load, with their legend (${mzLegend.slice(0, 60)}…) ${mzBroken.join(', ')} ${mz.errors.join(' | ')}`, true);
  await mz.close();
});

await section('the drawing', async () => {
  // the drawing: place, edit, undo, export, New, import, restore, the exports
  const dw = await open('#v=11/40.2/12.1/0&on=chart,coastline', ctx, 'elements');
  await dw.setViewportSize({ width: 1600, height: 800 }); // the map clear between the panels for the clicks below
  const DX = 260; // the left panel covers the map's left: the clicks below, written for the whole map, moved right of it
  await dw.evaluate(() => { // both panels on, the left on Elements (an earlier section may have changed them)
    if (document.querySelector('#bar .pright').getAttribute('aria-pressed') !== 'true') document.querySelector('#bar .pright').click();
    if (document.querySelector('#bar .ptab[data-tab=elements]').getAttribute('aria-pressed') !== 'true') document.querySelector('#bar .ptab[data-tab=elements]').click();
  });
  // the drawing's file out: from the bar's Download menu
  const exportDrawing = async () => {
    await dw.click('#bar .dlbtn');
    await dw.click('.dmenu button:has-text("Drawing (GeoJSON)")');
  };
  await dw.evaluate(async () => { const { addLine } = await import('./draw/document.js'); drawing.change((doc) => addLine(doc, [12, 40.1], [], [12.05, 40.12], { name: 'Distance 1', guide: true, look: { text: { values: true } } })); });
  // the drawing open, as saved in this browser (one key each, the open one's in charts.drawings.current): GeoJSON
  const saved = () => dw.evaluate(() => JSON.parse(localStorage.getItem(`charts.drawing.${localStorage.getItem('charts.drawings.current')}`) || 'null'));
  const own = (f) => f.properties.charts; // the app's own part of a feature
  const featuresOf = (fc, kind) => (fc?.features || []).filter((f) => own(f)?.kind === kind && !(own(f).guide && own(f).look?.text?.values));
  const measuredOf = (fc) => (fc?.features || []).filter((f) => own(f)?.guide && own(f)?.look?.text?.values);
  await dw.keyboard.press('s'); // the Shape tool, a circle (its first kind), its kinds a row under its button
  const sub = await dw.locator('#bar .kinds:not([hidden]) button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
  check(sub.join() === 'Circle,Rings,Sector,Rectangle,Ellipse,Triangle,Aerial vehicle,Surface vehicle,Underwater vehicle',
    `tools: Shape's kinds a row under its button, round a centre first, then the outlines, then the vehicles (${sub})`);
  // the bar across the top, the kind in use pressed in it; the left panel open on Elements, hidden by
  // its button, back with E; Properties hidden with nothing selected (it has nothing to show); the
  // bar's order: the file group (Open, the title, Download, Copy link), Layers, Elements, Undo…
  const layoutNow = () => dw.evaluate(() => [document.querySelector('#bar .kinds button[aria-pressed=true]')?.getAttribute('aria-label') ?? '', !!document.querySelector('#bar button[data-tool=shape]')?.offsetParent,
    !document.querySelector('#side').hidden, Math.round(document.querySelector('#bar').getBoundingClientRect().top), document.querySelector('#props').hidden]);
  const onTool = await layoutNow();
  const order = await dw.evaluate(() => [...document.querySelectorAll('#bar > button')].slice(0, 6).map((b) => b.getAttribute('aria-label')).join());
  const longHints = await dw.evaluate(() => [...document.querySelectorAll('#bar button[title]')].map((b) => b.title).filter((t) => t.length > 30));
  check(!longHints.length, `tools: the bar's hints a name and its key, no more (${longHints.join(' | ') || 'none longer than 30'})`);
  await dw.click('#bar .ptab[data-tab=elements]');
  const hiddenE = await layoutNow();
  await dw.keyboard.press('e');
  const shownE = await layoutNow();
  check(onTool.join() === 'Circle,true,true,0,true' && !hiddenE[2] && shownE[2] && order === 'Open,Download,Copy link,Layers,Elements,Undo',
    `tools: the bar at the top (${order}), the kind in use pressed in it; the left panel open, hidden by its button, back with E; Properties hidden with nothing selected (${onTool}; ${hiddenE[2]}; ${shownE[2]})`);
  // a kind picked in the row: the tool on with it, the row shut; the key again: the next kind, its
  // row open; the button while it is on: the row again, the tool still on
  const shut = () => dw.evaluate(() => [!!document.querySelector('#bar .kinds')?.offsetParent, document.querySelector('#bar button[data-tool=shape]').dataset.shows]);
  if (!(await shut())[0]) await dw.click('#bar button[data-tool=shape]'); // the row open (a click on a tab may have shut it)
  await dw.click('#bar .kinds button[aria-label="Rings"]');
  const picked = await shut();
  await dw.keyboard.press('s');
  const stepped = await shut();
  await dw.click('#bar .kinds button[aria-label="Circle"]');
  await dw.click('#bar button[data-tool=shape]');
  const reopened = [...await shut(), await dw.evaluate(() => drawing.button)];
  await dw.click('#bar .kinds button[aria-label="Circle"]');
  check(picked.join() === 'false,rings' && stepped.join() === 'true,sector' && reopened.join() === 'true,circle,shape',
    `tools: a kind picked in the row under the tool's button, the row shut (${picked}); the key again the next kind (${stepped}); the button while on, the row again (${reopened})`);
  await dw.mouse.click(DX + 500, 400);
  await dw.mouse.click(DX + 500, 400); // its centre again: the default size
  await dw.keyboard.press('Escape');
  const radius = dw.locator('.dinspect input[aria-label="Part 1 radius"]');
  await radius.fill('1.5 NM');
  await radius.press('Enter');
  const partsShown = await dw.evaluate(() => [document.querySelectorAll('.dinspect [data-grid$=":parts"] tbody tr[data-r]:not(.ladd)').length, !!document.querySelector('.dinspect select[aria-label="Add a part"]')]);
  check(partsShown.join() === '1,true', `drawing: the inspector lists its parts, one here, and + Part (${partsShown})`);
  await dw.selectOption('.dinspect select[aria-label="Part 1 kind"]', 'sector'); // the circle as a sector, its radius kept
  const bearing = dw.locator('input[aria-label^=Bearing]');
  await bearing.fill('-30');
  await bearing.press('Enter');
  let d; // saved a moment after the change: waited for, not timed (a slow runner saves later)
  const pt0 = () => own(featuresOf(d, 'point')[0] || { properties: {} });
  for (let i = 0; i < 25 && pt0()?.bearing !== 330; i++) { await dw.waitForTimeout(200); d = await saved(); }
  check(d?.type === 'FeatureCollection' && featuresOf(d, 'point').length === 1 && pt0().parts?.[0].kind === 'sector' && pt0().parts[0].radius === 2778 && pt0().bearing === 330 && pt0().parts[0].aperture === 90,
    `drawing: a point placed, its radius (1.5 NM), bearing (−30° → 330°) and sector set in the inspector, saved as GeoJSON (${JSON.stringify(pt0())})`);
  // the inspector as tables: every value row one line high (nothing wraps); ↑ in a value field nudges it
  const tall = await dw.evaluate(() => [...document.querySelectorAll('.dinspect .vrow')].filter((r) => r.getBoundingClientRect().height > 56).map((r) => r.textContent.slice(0, 30)));
  await bearing.focus();
  await bearing.press('ArrowUp');
  await dw.waitForTimeout(200);
  const nudged = await dw.evaluate(() => drawing.selected()[0].el.bearing);
  await dw.evaluate(() => drawing.undo()); // back to 330, for the undo check below
  check(!tall.length && nudged === 331, `inspector: value rows never wrap (${tall.join(' | ') || 'none taller'}); ↑ nudges a bearing (330 → ${nudged})`);
  await dw.locator('.dinsphead .ititle').click(); // out of the fields: the keys are the drawing's
  await dw.keyboard.press('Control+z');
  await dw.waitForTimeout(600);
  d = await saved();
  const undone = pt0().bearing ?? 0;
  await dw.keyboard.press('Control+Shift+Z');
  await dw.waitForTimeout(600);
  d = await saved();
  check(undone === 0 && pt0().bearing === 330, `drawing: undo and redo (bearing ${undone}, then 330)`);
  // the list's header box: all shown, a click hides them all; again, shows them all
  const allBox = dw.locator('.droot .deye');
  const isAll = async () => (await allBox.getAttribute('aria-pressed')) === 'true';
  const wasAll = await isAll();
  await allBox.click();
  await dw.waitForTimeout(600);
  d = await saved();
  const hidden = pt0().visible ?? true;
  await allBox.click();
  await dw.waitForTimeout(600);
  d = await saved();
  const allAgain = await isAll();
  check(wasAll && hidden === false && (pt0().visible ?? true) === true && allAgain, 'drawing: the list\'s eye hides all, then shows all');
  // the Layers tab's spinner: the drawing's own sources, set as the hover moves, never switch it on
  const blinks = await dw.evaluate(async () => {
    let n = 0;
    const o = new MutationObserver(() => { if (document.body.classList.contains('loading')) n++; });
    o.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    for (const x of [...drawing.doc.points, ...drawing.doc.lines, ...drawing.doc.points]) { drawing.setHover(x.id); await new Promise((r) => setTimeout(r, 120)); }
    drawing.setHover(null);
    await new Promise((r) => setTimeout(r, 500));
    o.disconnect();
    return n;
  });
  const spinBox = await dw.evaluate(() => { document.body.classList.add('loading'); const r = document.querySelector('#bar .ptab .spin').getBoundingClientRect(); document.body.classList.remove('loading'); return `${r.width}×${r.height}`; });
  check(blinks === 0 && spinBox === '9×9', `the Layers button's spinner stays off while the hover moves over the drawing (${blinks}); shown, a 9 px ring in its corner (${spinBox})`);
  const [dex] = await Promise.all([dw.waitForEvent('download'), (async () => { await dw.keyboard.press('Escape'); await exportDrawing(); })()]);
  const savedFile = JSON.parse(await readFile(await dex.path(), 'utf8'));
  const ruler = measuredOf(savedFile).find((f) => f.geometry.type === 'LineString' && f.geometry.coordinates[0][0] === 12);
  check(/\.geojson$/.test(dex.suggestedFilename()) && savedFile.type === 'FeatureCollection' && savedFile.charts?.view?.layers?.some((l) => l.id === 'coastline') && ruler?.geometry.type === 'LineString',
    `drawing: saved as GeoJSON with its view, layers and the measurement (a guide showing its values) (${dex.suggestedFilename()}, ${JSON.stringify(ruler?.geometry)})`);
  // opened again with one measurement of its own, moved: the file's, not the page's
  ruler.geometry.coordinates = [[12.2, 40.3], [12.25, 40.31]];
  savedFile.features = [...savedFile.features.filter((f) => !measuredOf(savedFile).includes(f)), ruler];
  const exported = JSON.stringify(savedFile);
  const measuredNow = () => dw.evaluate(async () => { const { elements, isMeasurement } = await import('./draw/document.js'); return elements(drawing.doc).filter((x) => isMeasurement(drawing.doc, x.el)).map((x) => x.el.start?.position ?? x.el.position ?? x.el.points[0]); });
  await dw.click('#bar .filebtn'); await dw.click('.dmenu .dnew'); // a new drawing, from the bar's Open, nothing asked
  await dw.waitForFunction(() => !drawing.doc.points.length && !drawing.doc.lines.length);
  await dw.evaluate(() => map.jumpTo({ center: [0, 0], zoom: 3 }));
  await dw.setInputFiles('input[type=file][accept*=geojson]', { name: 'x.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(exported) });
  await Promise.all([dw.waitForEvent('load'), dw.click('dialog[open] button.done')]);
  await dw.waitForFunction(() => window.map?.loaded?.(), null, { timeout: 90000 });
  await dw.waitForTimeout(800);
  const c = await dw.evaluate(() => map.getCenter());
  const mAfter = JSON.stringify(await measuredNow());
  check((await dw.evaluate(() => drawing.doc.points.length)) === 1 && Math.abs(c.lat - 40.2) < 0.01 && Math.abs(c.lng - 12.1) < 0.01 && mAfter === '[[12.2,40.3]]',
    `drawing: New, then the file opened again: its element, its view and its measurement (${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}; ${mAfter})`);
  // a file without the measurement: its drawing has none (they are each drawing's)
  savedFile.features = savedFile.features.filter((f) => f !== ruler);
  // dropped on the map: imported as from the menu (its report first)
  await dw.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'other.geojson', { type: 'application/geo+json' }));
    map.getContainer().dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, JSON.stringify(savedFile));
  await Promise.all([dw.waitForEvent('load'), dw.click('dialog[open] button.done')]);
  await dw.waitForFunction(() => window.map?.loaded?.(), null, { timeout: 90000 });
  await dw.waitForTimeout(500);
  check((await measuredNow()).length === 0, 'drawing: a file without measurements brings a drawing without them');
  const drawings = await dw.evaluate(() => drawing.saving.list().map((x) => x.title || 'Untitled'));
  check(drawings.length === 3, `drawing: every drawing kept in the list, the imported ones added (${drawings.join(', ')})`); // the first and two imported (an empty New left nothing)
  // a drawing's Delete asks first, a question and its buttons only (an absent foot once printed "null")
  await dw.click('#bar .filebtn');
  await dw.locator('.dmenu .drawings .hact').last().click();
  const asked = await dw.evaluate(() => document.querySelector('dialog[open]').textContent);
  await dw.click('dialog[open] button:not(.done)');
  await dw.keyboard.press('Escape');
  check(/for good/.test(asked) && !/null/.test(asked), `drawing: Delete asks first, nothing else in the dialog (${asked})`);
  await dw.reload();
  await dw.waitForFunction(() => window.map?.loaded?.(), null, { timeout: 90000 });
  check((await dw.locator('.dlist .drow').count()) === 1, 'drawing: restored after a reload');
  await dw.evaluate(() => drawing.select([drawing.doc.points[0].id])); // selected: its highlight must stay out of the picture
  const [dpng] = await Promise.all([dw.waitForEvent('download', { timeout: 120000 }), exportItem(dw, 'png')]);
  const [dzip] = await Promise.all([dw.waitForEvent('download', { timeout: 120000 }), exportItem(dw, 'zip')]);
  await dw.keyboard.press('Escape'); // the ☰ menu closed (it stays open while an export runs)
  const dfiles = files(await readFile(await dzip.path()));
  const dgj = JSON.parse(dfiles['vector/drawings.geojson'] || '{}'), ditem = JSON.parse(dfiles['item.json']), dfile = JSON.parse(dfiles['drawing.geojson'] || '{}');
  check(dpng && dgj.features?.map((f) => f.properties.kind).join() === 'point,sector' && dgj.features[1].properties.radius_m === 2778
    && featuresOf(dfile, 'point').length === 1 && !measuredOf(dfile).length && ditem.assets['vector/drawings'] && ditem.assets.drawing,
  `drawing: in the PNG and the GIS export (as drawn, and the drawing's own file, listed in the STAC item) ${Object.keys(dfiles).filter((n) => /draw/.test(n)).join(', ')}`);
  check(await dw.evaluate(() => map.getLayoutProperty('draw-mark-line-polygon', 'visibility') === 'visible'), 'drawing: the selection shown again after the exports');
  // lines: a line and two lines from its end drawn with the Line tool (joined there: a point, each
  // attached to it), the totals
  await dw.locator('.dinsphead .ititle').click();
  await dw.keyboard.press('Escape'); // nothing selected: the drawing's own inspector
  await dw.click('#bar .filebtn'); await dw.click('.dmenu .dnew'); // a new drawing, from the bar's Open, nothing asked
  await dw.waitForFunction(() => !drawing.doc.points.length);
  await dw.keyboard.press('g');
  await dw.mouse.click(DX + 200, 500);
  await dw.mouse.click(DX + 300, 420);
  await dw.mouse.dblclick(DX + 420, 400); // the first line ends there, free
  await dw.mouse.click(DX + 420, 400); // starts on its end: a point made there, both attached
  await dw.mouse.dblclick(DX + 600, 300);
  await dw.mouse.click(DX + 420, 400); // starts on that point
  await dw.mouse.dblclick(DX + 620, 520);
  await dw.keyboard.press('Escape');
  const segs = await dw.evaluate(() => drawing.doc.lines.map((s) => [s.start.element, s.end.element, s.vertices.length]));
  check(segs.length === 3 && segs[0][1] && segs[1][0] === segs[0][1] && segs[2][0] === segs[0][1] && segs[0][2] === 1,
    `drawing: three lines drawn with the Line tool, the two later ones attached where the first ends (${JSON.stringify(segs)})`);
  const net = await dw.evaluate(async () => {
    const { totals, lineTrace } = await import('./draw/lines.js');
    const doc = drawing.doc, len = (i) => lineTrace(doc, doc.lines[i]).length;
    return { all: totals(doc).all.length, want: len(0) + len(1) + len(2) };
  });
  check(Math.abs(net.all - net.want) < 1e-6, `drawing: the total, each line once (${(net.all / 1000).toFixed(2)} km)`);
  // the point moved: the lines attached to it follow
  const follows = await dw.evaluate(() => {
    const p = drawing.doc.points[0];
    drawing.change((doc) => { doc.points[0].position = [p.position[0] + 0.01, p.position[1]]; });
    const at = drawing.doc.points[0].position;
    return drawing.doc.lines.every((s) => [s.start, s.end].every((e) => !e.element || (e.position[0] === at[0] && e.position[1] === at[1])));
  });
  check(follows, 'drawing: a point moved, the lines attached to it follow');
  // Offset: a line drawn beside its geometry by MapLibre, set in pixels; its length stays real. A copy
  // of the first line, the two selected: the field sets both
  await dw.evaluate(() => drawing.change((doc) => { doc.lines.push({ ...structuredClone(doc.lines[0]), id: 'copy1', name: 'Line 4' }); }));
  const before = await dw.evaluate(() => drawing.offset().length);
  await dw.evaluate(() => drawing.select([drawing.doc.lines[0].id, 'copy1']));
  const offField = dw.locator('.dinspect input[aria-label="Offset (px)"]');
  await offField.fill('-8');
  await offField.press('Enter');
  await dw.waitForTimeout(600);
  const offset = await dw.evaluate(async () => { const { totals } = await import('./draw/lines.js'); return [drawing.offset().length, drawing.doc.lines[0].look.offset, drawing.doc.lines.at(-1).look.offset, totals(drawing.doc).all.lines]; });
  const painted = await dw.evaluate(() => map.querySourceFeatures('drawzoom').filter((f) => f.properties.kind === 'path').map((f) => f.properties.off));
  check(before === 0 && offset.join() === '2,-8,-8,4' && painted.includes(-8),
    `drawing: Offset off until set (${before}); −8 px on the two lines selected (${offset.slice(0, 3)}), their lengths still counted (${offset[3]} lines), carried to the map (${painted})`);
  await dw.mouse.move(DX + 150, 250); // a box: Shift-drag on the map
  await dw.keyboard.down('Shift');
  await dw.mouse.down();
  await dw.mouse.move(DX + 700, 600, { steps: 5 });
  await dw.mouse.up();
  await dw.keyboard.up('Shift');
  await dw.click('.dinsphead button[aria-label=Group]'); // the title row's Group
  check(await dw.evaluate(() => drawing.doc.groups.length === 1 && drawing.doc.lines.every((s) => s.groupId === drawing.doc.groups[0].id)), 'drawing: a box (Shift-drag), then a group of everything in it');
  // Box select (B, or its button): a plain drag draws the box, once, then Select again
  await dw.evaluate(() => drawing.select([]));
  await dw.click('#bar button[aria-label="Box select"]');
  await dw.mouse.move(DX + 150, 250);
  await dw.mouse.down();
  await dw.mouse.move(DX + 700, 600, { steps: 5 });
  await dw.mouse.up();
  const boxed = await dw.evaluate(() => [drawing.sel.size, drawing.boxNext, document.querySelector('#bar .selbtn').getAttribute('aria-pressed')]);
  check(boxed[0] > 0 && boxed.slice(1).join() === 'false,true', `drawing: Box select, a plain drag selects what lies inside, then Select again (${boxed})`);
  // two of its lines grouped: a subgroup of it, one step further in the list; deleted alone, its lines
  // back in the group above
  const top = await dw.evaluate(() => { drawing.select(drawing.doc.lines.slice(0, 2).map((s) => s.id)); return drawing.doc.groups[0].id; });
  await dw.click('.dinsphead button[aria-label=Group]'); // the title row's Group
  const nested = await dw.evaluate((t) => {
    const g = drawing.doc.groups.find((x) => x.groupId === t), cls = (id) => document.querySelector(`.dlist [data-id="${id}"]`)?.className ?? '';
    return g && { id: g.id, members: drawing.doc.lines.filter((s) => s.groupId === g.id).length, row: cls(g.id), member: cls(drawing.doc.lines[0].id), selected: drawing.selected()[0]?.el.id === g.id };
  }, top);
  check(nested?.members === 2 && nested.selected && /\bd1\b/.test(nested.row) && /\bd2\b/.test(nested.member),
    `drawing: a group of a group's members is a subgroup of it, indented further (${JSON.stringify(nested)})`);
  // the group above in Properties: its members counted as the tree does, its totals as a table
  await dw.evaluate((t) => drawing.select([t]), top);
  const gprops = await dw.evaluate((t) => [document.querySelector('.dinspect .frow:has(.flabel) .fvalue')?.textContent ?? '', document.querySelector(`.dlist [data-id="${t}"] .val`)?.textContent ?? '',
    !!document.querySelector('.dinspect .lgrid.plain[data-grid$="totals"]'), [...document.querySelectorAll('.dinspect h3')].map((x) => x.textContent).join()], top);
  check(gprops[0].split(' ')[0] === gprops[1].split(' ')[0] && / · 1 subgroup$/.test(gprops[0]) && gprops[2] && /Look · sets each member/.test(gprops[3]),
    `group: its members as the tree counts them, and its subgroups (${gprops[0]}; tree ${gprops[1]}); its totals a table; its Look said to set each member (${gprops[3]})`);
  await dw.evaluate((id) => drawing.remove([id]), nested?.id);
  check(await dw.evaluate((t) => drawing.doc.groups.length === 1 && drawing.doc.lines.every((s) => s.groupId === t), top), 'drawing: a subgroup deleted alone: its lines back in the group above');
  const [dnet] = await Promise.all([dw.waitForEvent('download'), (async () => { await dw.keyboard.press('Escape'); await exportDrawing(); })()]);
  const back = JSON.parse(await readFile(await dnet.path(), 'utf8'));
  check(featuresOf(back, 'line').length === 4 && featuresOf(back, 'point').length === 1 && back.charts.groups.length === 1 && featuresOf(back, 'line').filter((f) => own(f).start || own(f).end).length === 4,
    'drawing: exported whole, the lines\' ends attached to the point');
  // points along a line, connected to one root in the same form: one step, undone at once
  await dw.keyboard.press('Escape');
  await dw.keyboard.press('g');
  await dw.mouse.click(DX + 150, 650);
  await dw.mouse.dblclick(DX + 700, 640);
  await dw.evaluate(() => { drawing.stop(); drawing.variant.shape = 'circle'; }); // a circle, whatever was on
  await dw.keyboard.press('s');
  await dw.mouse.click(DX + 420, 760 - 60);
  await dw.mouse.click(DX + 420, 760 - 60); // its centre again: the default size
  await dw.keyboard.press('Escape');
  const guide = await dw.evaluate(() => drawing.doc.lines.at(-1).id);
  await dw.evaluate((id) => drawing.select([id]), guide);
  const beforeGen = await dw.evaluate(() => [drawing.doc.lines.length, drawing.undos.length]);
  await dw.click('.dinspect button:has-text("Distribute along…")');
  const gsp = dw.locator('input[aria-label=Spacing]');
  await gsp.fill('2 km');
  await gsp.press('Enter');
  await dw.click('.dinspect input[aria-label="Connect to roots"]');
  await dw.mouse.click(DX + 420, 700); // the circle's centre: a root (a click on a point uses it)
  const mb = dw.locator('input[aria-label="Shortest branch"]'); // Tree: each branch at least this long
  await mb.fill('300 m');
  await mb.press('Enter');
  const previewed = await dw.evaluate(() => [drawing.previewPts?.length ?? 0, drawing.previewLines?.length ?? 0]);
  await dw.click('.dinspect button.done:has-text("Create")');
  const gen = await dw.evaluate(() => {
    const rules = (k) => drawing.doc.rules.filter((r) => r.kind === k), a = rules('distribute')[0], c = rules('connect')[0];
    // what each line the connection made is, from its ends: a trunk at a root, else a branch
    const roots = new Set(c?.roots.map((r) => r.id)), made = drawing.doc.lines.filter((s) => c?.created.includes(s.id));
    const ofPart = (v) => made.filter((s) => (roots.has(s.start.element) || roots.has(s.end.element)) === (v === 'trunk')), part = (v) => ofPart(v).length;
    const names = (gid) => drawing.doc.groups.filter((g) => g.groupId === gid).map((g) => g.name).sort().join();
    return { a: rules('distribute').length, n: a?.points.length, c: rules('connect').length, subgroups: a && names(a.groupId), inCircles: a && a.points.every((x) => drawing.doc.points.find((q) => q.id === x.pointId).groupId === a.copiesId), trunks: part('trunk'), branches: part('branch'),
      attached: drawing.doc.lines.filter((s) => s.start.element && s.end.element).length, undos: drawing.undos.length, group: drawing.selected()[0]?.kind,
      // the branches' shortest (m, near enough at this scale), the hubs: one of its own per trunk
      shortest: Math.min(...ofPart('branch').map((s) => {
        const [a, b] = [s.start.position, s.end.position], k = Math.cos((a[1] * Math.PI) / 180);
        return 111320 * Math.hypot((b[0] - a[0]) * k, b[1] - a[1]);
      })), hubs: c?.hubs.length, minBranch: c?.minBranch };
  });
  await dw.locator('.dinsphead .ititle').click();
  await dw.keyboard.press('Control+z');
  const genUndone = await dw.evaluate(() => [drawing.doc.rules.filter((r) => r.kind === 'connect').length, drawing.doc.lines.length, drawing.doc.rules.filter((r) => r.kind === 'distribute').length]);
  check(previewed[0] === gen.n && previewed[1] > 0, `drawing: Distribute along previews its points and lines before making them (${previewed})`);
  check(gen.a === 1 && gen.n > 1 && gen.c === 1 && gen.trunks > 0 && gen.branches > 0 && gen.attached >= gen.trunks + gen.branches && gen.undos === beforeGen[1] + 1 && gen.group === 'group'
    && genUndone.join() === `0,${beforeGen[0]},0`, `drawing: Distribute along and Connect in one form, one undo step, the group selected (${gen.n} points, ${gen.trunks} + ${gen.branches} lines)`);
  check(gen.subgroups === 'Connection,Copies' && gen.inCircles, `rules: Distribute along's own group holds Copies and Connection (${gen.subgroups})`);
  check(gen.minBranch === 300 && gen.shortest >= 297 && gen.hubs === gen.trunks && gen.branches === gen.n,
    `drawing: Tree, a hub of its own per trunk, a branch to every point, each at least the 300 m set (${Math.round(gen.shortest)} m)`);
  // points round a circle: a circle's inspector offers them; they follow it when it grows
  const arcOf = await dw.evaluate(() => { const x = drawing.doc.points.at(-1); drawing.select([x.id]); return x.id; });
  await dw.click('.dinspect button:has-text("Distribute along…")');
  await dw.click('.dinspect [aria-label="Points by"] button:has-text("Count")');
  const gcount = dw.locator('input[aria-label=Count]');
  await gcount.fill('6');
  await gcount.press('Enter');
  await dw.click('.dinspect button.done:has-text("Create")');
  const onArc = await dw.evaluate(async (id) => {
    const { inverse } = await import('./geodesy.js');
    const a = drawing.doc.rules.find((x) => x.kind === 'distribute' && x.along.element === id);
    drawing.change((doc) => { doc.points.find((x) => x.id === id).parts[0].radius *= 2; });
    const c2 = drawing.doc.points.find((x) => x.id === id), r = c2.parts[0].radius;
    return a.points.map((x) => Math.round(inverse(c2.position, drawing.doc.points.find((n) => n.id === x.pointId).position).s / r * 100) / 100);
  }, arcOf);
  check(onArc.length === 6 && onArc.every((k) => k === 1), `drawing: points along a circle, following it when its radius doubles (${onArc})`);
  // a copy selected: the rule it was made by, Select all selects every copy
  await dw.evaluate((id) => { const a = drawing.doc.rules.find((x) => x.kind === 'distribute' && x.along.element === id); drawing.select([a.points[0].pointId]); }, arcOf);
  const madeBy = await dw.locator('.dinspect .frow:has(.flabel:text-is("Made by")) .fvalue').textContent().catch(() => '');
  await dw.click('.dinspect button:has-text("Select all")'); // under Made by
  const allCopies = await dw.evaluate(() => drawing.sel.size);
  check(/Distribute along .* · 6 copies/.test(madeBy) && allCopies === 6, `rules: a copy says what made it; Select all selects every copy (${madeBy}; ${allCopies})`);
  await dw.keyboard.press('Escape');
  await dw.keyboard.press('Control+z');
  await dw.keyboard.press('Control+z');
  // dragging: a selected point's radius handle, one undo step; Esc during a drag puts it back
  await dw.keyboard.press('Escape');
  await dw.evaluate(() => { drawing.stop(); drawing.variant.shape = 'circle'; }); // a circle, whatever was on
  await dw.keyboard.press('s');
  await dw.mouse.click(DX + 640, 300);
  await dw.mouse.click(DX + 640, 300); // its centre again: the default size
  await dw.keyboard.press('Escape');
  await dw.waitForTimeout(300);
  const nd = await dw.evaluate(async () => { const { destination } = await import('./geodesy.js'); const x = drawing.doc.points.at(-1); const q = map.project(destination(x.position, 0, x.parts[0].radius)); return { r: x.parts[0].radius, x: q.x, y: q.y, undos: drawing.undos.length }; });
  await dw.mouse.move(nd.x, nd.y);
  await dw.mouse.down();
  await dw.mouse.move(nd.x, nd.y - 30, { steps: 5 });
  await dw.waitForTimeout(100);
  await dw.mouse.up();
  const dragged = await dw.evaluate(() => [drawing.doc.points.at(-1).parts[0].radius, drawing.undos.length]);
  await dw.mouse.move(nd.x, nd.y - 30);
  await dw.mouse.down();
  await dw.mouse.move(nd.x, nd.y - 90, { steps: 5 });
  await dw.keyboard.press('Escape');
  await dw.mouse.up();
  const kept = await dw.evaluate(() => drawing.doc.points.at(-1).parts[0].radius);
  check(dragged[0] > nd.r * 1.1 && dragged[1] === nd.undos + 1 && kept === dragged[0], `drawing: a radius dragged (${Math.round(nd.r)} → ${Math.round(dragged[0])} m), one undo step; Esc puts a drag back`);
  // parts: a rectangle made a surface vehicle in its inspector, its length kept; a circle added to it,
  // drawn with it; the preset it was placed from remembered
  await dw.evaluate(() => { drawing.stop(); drawing.variant.shape = 'rectangle'; });
  await dw.keyboard.press('s');
  await dw.mouse.click(DX + 300, 200);
  await dw.mouse.click(DX + 300, 200); // its centre again: the default size
  await dw.keyboard.press('Escape');
  await dw.selectOption('.dinspect select[aria-label="Part 1 kind"]', 'surface-vehicle');
  await dw.selectOption('.dinspect select[aria-label="Add a part"]', 'circle');
  await dw.waitForTimeout(300);
  const twoParts = await dw.evaluate(() => { const x = drawing.doc.points.at(-1); return { kinds: x.parts.map((q) => q.kind).join(), len: x.parts[0].length, preset: x.properties.find((q) => q.key === 'preset')?.value,
    drawn: map.querySourceFeatures('draw').filter((f) => f.properties.id === x.id && f.properties.kind === 'ring').length + map.querySourceFeatures('drawzoom').filter((f) => f.properties.id === x.id && f.properties.kind === 'shape').length }; });
  check(twoParts.kinds === 'surface-vehicle,circle' && twoParts.len === 100 && twoParts.preset === 'Rectangle' && twoParts.drawn >= 2,
    `parts: an outline's kind changed, its length kept; a circle added, both drawn; its preset remembered (${JSON.stringify(twoParts)})`);
  // a rectangle corner to corner: its box from the first click to the second, facing north; Shift: a
  // square, the larger side
  await dw.evaluate(() => { drawing.stop(); drawing.variant.shape = 'rectangle'; });
  await dw.keyboard.press('s');
  await dw.mouse.click(DX + 300, 460);
  await dw.mouse.move(DX + 380, 500, { steps: 3 });
  await dw.mouse.click(DX + 380, 500);
  const boxOf = (a, b) => dw.evaluate(async ([a, b]) => { const { inverse } = await import('./geodesy.js'); const x = drawing.doc.points.at(-1), p = map.unproject(a), q = map.unproject(b), c = map.project(x.position);
    return [x.bearing, x.parts[0].length, x.parts[0].width, inverse([p.lng, p.lat], [p.lng, q.lat]).s, inverse([p.lng, p.lat], [q.lng, p.lat]).s, Math.round(c.x), Math.round(c.y)]; }, [a, b]);
  const sized = await boxOf([DX + 300, 460], [DX + 380, 500]);
  await dw.mouse.click(DX + 300, 560);
  await dw.keyboard.down('Shift');
  await dw.mouse.click(DX + 380, 600);
  await dw.keyboard.up('Shift');
  const square = await boxOf([DX + 300, 560], [DX + 380, 600]);
  check(sized[0] === 0 && Math.abs(sized[1] - sized[3]) < 2 && Math.abs(sized[2] - sized[4]) < 2 && Math.abs(sized[5] - DX - 340) <= 1 && Math.abs(sized[6] - 480) <= 1 && square[1] === square[2] && Math.abs(square[1] - square[4]) < 2,
    `shapes: a rectangle corner to corner, facing north, centred between them; Shift a square (${sized.map((v) => Math.round(v))}; ${square.slice(1, 3).map(Math.round)})`);
  // a line closed into an area by a click on its first point; a sector in three clicks
  await dw.keyboard.press('Escape');
  await dw.evaluate(() => drawing.stop());
  await dw.keyboard.press('g');
  const areasBefore = await dw.evaluate(() => drawing.doc.areas.length);
  for (const [x, y] of [[450, 450], [520, 450], [500, 520], [451, 451]]) await dw.mouse.click(DX + x, y);
  const closed = await dw.evaluate(() => [drawing.doc.areas.length, drawing.doc.areas.at(-1)?.points.length, !!drawing.draft]);
  await dw.keyboard.press('Escape');
  await dw.evaluate(() => { drawing.variant.shape = 'sector'; });
  await dw.keyboard.press('s');
  for (const [x, y] of [[600, 450], [600, 400], [650, 450]]) await dw.mouse.click(DX + x, y);
  await dw.waitForTimeout(300);
  const sec = await dw.evaluate(() => { const x = drawing.doc.points.at(-1); return [x.parts.map((q) => [q.kind, q.fill, Math.round(q.aperture)].join(':')).join(), x.name.split(' ')[0],
    map.querySourceFeatures('draw').filter((f) => f.properties.id === x.id && f.properties.kind === 'ring').map((f) => f.geometry.type)[0]]; });
  await dw.keyboard.press('Escape');
  check(closed.join() === `${areasBefore + 1},3,false` && sec[0] === 'sector:true:90' && sec[1] === 'Sector' && sec[2] === 'Polygon',
    `shapes: a line closed into an area on its first point (${closed}); a sector in three clicks (${sec})`);
  await dw.evaluate(() => drawing.remove([drawing.doc.points.at(-1).id, drawing.doc.areas.at(-1).id])); // the checks after these find the drawing as it was
  await dw.keyboard.press('Escape');
  await dw.keyboard.press('Escape');
  // attaching: a line drawn to a shape's corner ends attached there, and follows it when it turns
  const sc = await dw.evaluate(async () => {
    const { addShape } = await import('./draw/document.js'), { verticesOf } = await import('./draw/attach.js');
    let x;
    drawing.change((d) => { const c = map.unproject([500, 500]); x = addShape(d, [c.lng, c.lat]); Object.assign(x.parts[0], { length: 3000, width: 2000 }); });
    const q = map.project(verticesOf({ kind: 'point', el: x })[0]);
    return { id: x.id, x: q.x, y: q.y };
  });
  await dw.keyboard.press('Escape');
  await dw.keyboard.press('g');
  await dw.mouse.click(sc.x - 150, sc.y - 60);
  await dw.mouse.click(sc.x + 3, sc.y + 2); // within the snapping radius of the corner: snapped there
  await dw.keyboard.press('Enter'); // ended there, attached
  await dw.keyboard.press('Escape');
  const att = await dw.evaluate((id) => {
    const s = drawing.doc.lines.at(-1), before = [...s.end.position];
    drawing.change((d) => { d.points.find((p) => p.id === id).bearing = 30; });
    const after = drawing.doc.lines.at(-1).end;
    return [after.element, after.vertex, before.join() !== after.position.join()];
  }, sc.id);
  check(att[0] === sc.id && att[1] === 0 && att[2], `attaching: a line drawn to a shape's corner is attached to it, and follows it when the shape turns (${JSON.stringify(att)})`);
  // a line drawn onto another line's leg: its end attached along the leg (an edge, no vertex added);
  // then moved by its inspector's Attach to… onto the shape's corner
  const host = await dw.evaluate(async () => {
    const { addLine } = await import('./draw/document.js'), at = (x, y) => { const c = map.unproject([x, y]); return [c.lng, c.lat]; };
    let s;
    drawing.change((d) => { s = addLine(d, at(250, 200), [], at(550, 200)); });
    return { id: s.id, n: s.vertices.length, x: 400, y: 200 };
  });
  await dw.waitForTimeout(400); // drawn: what snapping looks for is on the map
  await dw.keyboard.press('g');
  await dw.mouse.click(host.x, host.y + 120);
  await dw.mouse.click(host.x, host.y);
  await dw.keyboard.press('Enter');
  await dw.keyboard.press('Escape');
  const onLeg = await dw.evaluate((h) => { const s = drawing.doc.lines.at(-1); return { end: s.end, n: drawing.doc.lines.find((x) => x.id === h.id).vertices.length, id: s.id }; }, host);
  check(onLeg.end.element === host.id && onLeg.end.edge === 0 && onLeg.end.at > 0.2 && onLeg.end.at < 0.8 && onLeg.n === host.n,
    `attaching: a line's end on another line's leg, along it, no vertex added (${JSON.stringify(onLeg.end)})`);
  await dw.evaluate((id) => drawing.select([id]), onLeg.id);
  await dw.click('.dinspect [data-grid*=":points"] tbody tr[data-r]:last-child td:first-child'); // its end's row: Attach to… over the table
  await dw.click('.dinspect .lbar button[aria-label="Attach end to…"]');
  const corner = await dw.evaluate(async (id) => { const { verticesOf } = await import('./draw/attach.js'); const q = map.project(verticesOf({ kind: 'point', el: drawing.doc.points.find((x) => x.id === id) })[2]); return [q.x, q.y]; }, sc.id);
  await dw.mouse.click(corner[0] + 2, corner[1] + 2);
  const moved2 = await dw.evaluate((id) => drawing.doc.lines.find((s) => s.id === id).end, onLeg.id);
  check(moved2.element === sc.id && moved2.vertex === 2, `attaching: Attach to… moves a line's end onto a shape's corner (${JSON.stringify(moved2)})`);
  await dw.keyboard.press('Escape');
  await dw.evaluate((id) => drawing.remove([id]), sc.id);
  // labels: one on the point, its text typed; drawn; its text dragged; names on the map; the point
  // deleted, the label stays where it pointed
  const nid = await dw.evaluate(() => drawing.doc.points.filter((x) => !x.parts.some((q) => q.length)).at(-1).id);
  await dw.keyboard.press('t');
  await dw.mouse.click(DX + 640, 300);
  await dw.keyboard.type('Hi {name}');
  await dw.locator('.dinsphead .ititle').click();
  await dw.keyboard.press('Escape'); // the tool off; the label stays selected
  // drawn once its glyphs have loaded and it has been placed: a fixed wait was sometimes too short
  await dw.waitForFunction(() => map.queryRenderedFeatures({ layers: ['draw-label-text'] }).length > 0, null, { timeout: 5000 }).catch(() => {});
  const lab = await dw.evaluate((id) => { const a = drawing.doc.labels[0], p = drawing.doc.points.find((x) => x.id === id); const q = map.project(p.position); return { a, point: p.position, x: q.x + a.offset[0], y: q.y + a.offset[1], undos: drawing.undos.length, drawn: map.queryRenderedFeatures({ layers: ['draw-label-text'] }).map((f) => f.properties.text), leader: map.queryRenderedFeatures({ layers: ['draw-leader'] }).length }; }, nid);
  check(lab.a?.anchor.element === nid && lab.a.text === 'Hi {name}' && lab.drawn.some((t) => /^Hi Circle \d+$/.test(t)) && lab.leader === 1,
    `labels: placed on a point with the Label tool, its text typed, drawn with its name and a leader (${lab.drawn.join(', ')})`);
  await dw.mouse.move(lab.x, lab.y);
  await dw.mouse.down();
  await dw.mouse.move(lab.x + 60, lab.y + 10, { steps: 5 });
  await dw.waitForTimeout(100);
  await dw.mouse.up();
  const moved = await dw.evaluate((id) => [drawing.doc.labels[0].offset, drawing.undos.length, drawing.doc.points.find((x) => x.id === id).position], nid);
  check(Math.abs(moved[0][0] - lab.a.offset[0] - 60) <= 2 && moved[1] === lab.undos + 1 && moved[2].join() === lab.point.join(),
    `labels: its text dragged 60 px, the point unmoved, one undo step (offset ${moved[0].join(', ')})`);
  await dw.evaluate((id) => drawing.change((doc) => { doc.points.find((n) => n.id === id).look.text = { name: true }; }), nid);
  // laid out in MapLibre's worker: not there on the next frame
  await dw.waitForFunction(() => map.queryRenderedFeatures({ layers: ['draw-name-point'] }).length > 0, null, { timeout: 5000, polling: 100 }).catch(() => {});
  const shownNames = await dw.evaluate(() => map.queryRenderedFeatures({ layers: ['draw-name-point'] }).map((f) => f.properties.nm));
  check(shownNames.length > 0, `labels: a point's name shown on the map (${shownNames.join(', ')})`);
  // the drawing's look (its Display, nothing selected): names on for every element that does not say
  // otherwise; a point's own switch still wins
  await dw.evaluate((id) => { drawing.change((doc) => { doc.points.find((n) => n.id === id).look = {}; }); drawing.select([]); }, nid);
  await dw.click('.droot .dname');
  await dw.locator('.dinspect .fblock:has(h3:text-is("Display")) input[aria-label="Names on map"]').check();
  const byDefault = await dw.evaluate((id) => [drawing.doc.look.text?.name, drawing.doc.points.find((n) => n.id === id).look.text], nid);
  await dw.waitForTimeout(300);
  const named = await dw.evaluate(() => map.queryRenderedFeatures({ layers: ['draw-name-point'] }).length);
  check(byDefault[0] === true && byDefault[1] === undefined && named > 0, `drawing: names on in the drawing's Display, shown for a point with none of its own (${named})`);
  // a property added in its Data; the drawing's totals by that key
  await dw.evaluate((id) => drawing.select([id]), nid);
  // Data: folded while it has nothing of the user's, the preset said under it; opened, its empty row
  const folded = await dw.evaluate(() => [!document.querySelector('.dinspect input[aria-label="Add a key"]'), document.querySelector('.dinspect .fblock:has(.hfold) .note')?.textContent ?? '']);
  check(folded[0] && /^from preset /.test(folded[1]), `data: folded while it has nothing of the user's, its preset said (${folded[1]})`);
  await dw.click('.dinspect button[aria-label="Open Data"]');
  const addKey = dw.locator('.dinspect input[aria-label="Add a key"]'); // Data's empty last row: a key typed there adds one
  await addKey.fill('kind');
  await addKey.press('Enter');
  const val = dw.locator('.dinspect [data-grid$=":data"] input[aria-label=Value]').last();
  await val.fill('x');
  await val.press('Enter');
  await dw.click('.droot .dname');
  await dw.selectOption('.dinspect select[aria-label="Totals by"]', 'kind');
  const byKind = await dw.evaluate(() => [...document.querySelectorAll('.dinspect .lgrid.plain td:first-child')].map((td) => td.textContent));
  check(byKind.some((t) => t.endsWith('“x”')) && byKind.some((t) => t.endsWith('No kind')), `drawing: a property added in Data, the totals by its key (${byKind.join(', ')})`);
  const pointed = await dw.evaluate(async () => { const { resolve } = await import('./draw/attach.js'); return resolve(drawing.doc, drawing.doc.labels[0].anchor).position; });
  await dw.evaluate((id) => drawing.remove([id]), nid);
  const freed = await dw.evaluate(() => drawing.doc.labels[0]?.anchor);
  check(!freed?.element && freed?.position?.[0] === pointed[0] && freed.position[1] === pointed[1], 'labels: the point deleted, its label stays, free, where it pointed');
  // legs typed after drawing: the leg to a line's point 2 set to 1 km at 090°, that point alone moved
  // (its end where it was); the edge to a polygon's corner 2 set to 500 m, that corner alone moved
  const legIds = await dw.evaluate(async () => {
    const { addLine, addArea } = await import('./draw/document.js');
    let l, a;
    drawing.change((d) => { l = addLine(d, [13, 41], [[13.02, 41.01]], [13.04, 41]); a = addArea(d, [[13, 40.5], [13.01, 40.5], [13.01, 40.51]]); });
    return [l.id, a.id];
  });
  await dw.evaluate((id) => drawing.select([id]), legIds[0]);
  const typeIn = async (aria, v) => { const f = dw.locator(`.dinspect input[aria-label="${aria}"]`); await f.fill(v); await f.press('Enter'); };
  const endAt = () => dw.evaluate((id) => drawing.doc.lines.find((x) => x.id === id).end.position.join(), legIds[0]);
  const endBefore = await endAt();
  await typeIn('Point 2 leg length', '1 km');
  await typeIn('Point 2 leg bearing (degrees true)', '90');
  const leg1 = await dw.evaluate(async (id) => { const { inverse } = await import('./geodesy.js'); const l = drawing.doc.lines.find((x) => x.id === id); const g = inverse(l.start.position, l.vertices[0].position); return [Math.round(g.s), Math.round(g.azi)]; }, legIds[0]);
  const endAfter = await endAt();
  await dw.evaluate((id) => drawing.select([id]), legIds[1]);
  await typeIn('Corner 2 leg length', '500 m');
  const edge = await dw.evaluate(async (id) => { const { inverse } = await import('./geodesy.js'); const a = drawing.doc.areas.find((x) => x.id === id); return [Math.round(inverse(a.points[0], a.points[1]).s), a.points[2].join()]; }, legIds[1]);
  check(leg1.join() === '1000,90' && endAfter === endBefore && edge[0] === 500 && edge[1] === '13.01,40.51',
    `legs typed after drawing: the leg to a line's point (${leg1}), that point alone moved (its end ${endAfter}); a polygon's edge (${edge[0]}), corner 3 where it was`);
  // the points' table as a list grid: ↓ goes to the same column in the next row; the bar over it acts
  // on the current row (its vertex deleted); a part added from the parts' empty last row
  await dw.evaluate((id) => drawing.select([id]), legIds[0]);
  await dw.locator('.dinspect input[aria-label="Point 2 leg length"]').focus();
  await dw.keyboard.press('ArrowDown');
  await dw.waitForTimeout(200);
  const movedTo = await dw.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await dw.locator('.dinspect input[aria-label="Point 2 latitude"]').focus();
  await dw.click('.dinspect .lbar button:has-text("Delete")');
  const vertsLeft = await dw.evaluate((id) => drawing.doc.lines.find((x) => x.id === id).vertices.length, legIds[0]);
  const pid = await dw.evaluate(async () => { const { addPoint } = await import('./draw/document.js'); let n; drawing.change((d) => { const c = map.getCenter(); n = addPoint(d, [c.lng, c.lat]); }); drawing.select([n.id]); return n.id; });
  await dw.selectOption('.dinspect [data-grid$=":parts"] select[aria-label="Add a part"]', 'rectangle');
  const partsNow = await dw.evaluate((id) => drawing.doc.points.find((x) => x.id === id).parts.map((q) => q.kind).join(), pid);
  check(movedTo === 'Point 3 leg length' && vertsLeft === 0 && partsNow === 'circle,rectangle',
    `list grids: ↓ to the next row (${movedTo}); the row's bar deletes its vertex (${vertsLeft} left); a part added from the empty row (${partsNow})`);
  // a point's parts linked to the map: a part's handle pressed on the map picks its row
  await dw.click('.dinspect [data-grid$=":parts"] tr[data-r="1"] td:first-child');
  const partMarked = await dw.evaluate(() => !drawing.placeAt()); // a row clicked draws nothing over: its handles say it
  const rh = await dw.evaluate((id) => { const x = drawing.doc.points.find((q) => q.id === id); map.jumpTo({ center: x.position, zoom: 14 }); return [0, 0, x.parts[0].radius]; }, pid);
  await dw.waitForTimeout(300);
  const handle = await dw.evaluate(async ([id]) => { const { destination } = await import('./geodesy.js'); const x = drawing.doc.points.find((q) => q.id === id), q = map.project(destination(x.position, 90, x.parts[0].radius)), r = map.getCanvasContainer().getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; }, [pid]);
  await dw.mouse.move(handle[0], handle[1]);
  await dw.mouse.down();
  await dw.mouse.up();
  await dw.waitForTimeout(300);
  const partPicked = await dw.evaluate(() => document.querySelector('.dinspect .lbar .funit')?.textContent);
  check(partMarked && partPicked === 'Part 1:', `parts: a row clicked marks nothing on the map (${partMarked}); a part's handle pressed picks its row (${partPicked}, ${Math.round(rh[2])} m)`);
  // a list's Copy: its rows, tab-separated, a header first
  await dw.evaluate((id) => drawing.select([id]), legIds[0]);
  await dw.click('.dinspect .fblock:has(h3:has-text("Points")) button:has-text("Copy")');
  const copied = await dw.evaluate(() => navigator.clipboard.readText());
  check(/^#\tLat\tLon/.test(copied) && /\n1\t/.test(copied) && copied.trim().split('\n').length === 3, `a list's Copy gives its rows, numbered from 1 (${copied.split('\n')[1]})`);
  // a line's depth profile: read when asked, the chart drawn, its length along the seabed longer
  const deepLine = await dw.evaluate(async () => { const { addLine } = await import('./draw/document.js'); let l; drawing.change((d) => { l = addLine(d, [12.0, 40.2], [], [12.3, 40.2]); }); drawing.select([l.id]); return l.id; });
  await dw.click('.dinspect button:has-text("Depth profile")');
  await dw.waitForSelector('svg.profile polyline', { timeout: 60000 }).catch(() => null);
  const prof = await dw.evaluate(() => [document.querySelectorAll('svg.profile polyline').length, document.querySelector('.dinspect .fblock .fvalue[title*="lower bound"]')?.textContent || '']);
  const deepLength = await dw.evaluate(async (id) => { const { lineTrace } = await import('./draw/lines.js'); return lineTrace(drawing.doc, drawing.doc.lines.find((x) => x.id === id)).length; }, deepLine);
  check(prof[0] > 0 && /along the seabed/.test(prof[1]) && deepLength > 25000, `a line's depth profile: the chart and the length along the seabed (${prof[1]})`);
  // a long line's table a page at a time: 100 rows built, not 502; ‹ › move by a page. A row clicked
  // ringed on the map; a point pressed on the map: its row picked, on its page
  const longId = await dw.evaluate(async () => {
    const { addLine } = await import('./draw/document.js');
    let s;
    drawing.change((doc) => { s = addLine(doc, [12, 40], Array.from({ length: 500 }, (_, i) => [12 + (i + 1) / 600, 40 + Math.sin(i / 9) / 200]), [12.9, 40]); });
    drawing.select([s.id]);
    return s.id;
  });
  const t0 = Date.now();
  await dw.waitForSelector('.dinspect .lpager');
  const pageOne = await dw.evaluate(() => [document.querySelectorAll('.dinspect [data-grid*=":points"] tbody tr[data-r]').length, document.querySelector('.dinspect .lpager .funit').textContent]);
  await dw.click('.dinspect .lpager button[aria-label="Next rows"]');
  const pageTwo = await dw.evaluate(() => [document.querySelector('.dinspect .lpager .funit').textContent, document.querySelector('.dinspect input[aria-label="Point 101 latitude"]') !== null]);
  check(pageOne[0] === 100 && pageOne[1] === '1–100 of 502' && pageTwo[0] === '101–200 of 502' && pageTwo[1] && Date.now() - t0 < 5000,
    `drawing: a long line's points a page at a time (${pageOne}; ${pageTwo}; ${Date.now() - t0} ms)`);
  await dw.click('.dinspect .lpager button[aria-label="Next rows"]'); // › again: the next page (a button kept by morph acts as it says)
  const pageThree = await dw.evaluate(() => document.querySelector('.dinspect .lpager .funit').textContent);
  await dw.click('.dinspect [data-grid*=":points"] tr[data-r="4"] td:first-child'); // point 205
  const ringed = await dw.evaluate((id) => drawing.placeAt()?.join() === drawing.doc.lines.find((x) => x.id === id).vertices[203].position.join(), longId);
  const vAt = await dw.evaluate((id) => { const v = drawing.doc.lines.find((x) => x.id === id).vertices[349].position; map.jumpTo({ center: v, zoom: 15 }); return v; }, longId);
  await dw.waitForTimeout(500);
  const vPx = await dw.evaluate((v) => { const q = map.project(v), r = map.getCanvasContainer().getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; }, vAt);
  await dw.mouse.move(vPx[0], vPx[1]);
  await dw.mouse.down();
  await dw.mouse.up();
  await dw.waitForTimeout(300);
  const pickedRow = await dw.evaluate(() => [document.querySelector('.dinspect .lbar .funit')?.textContent, document.querySelector('.dinspect .lpager .funit').textContent, document.querySelector('.dinspect tr.cur td')?.textContent]);
  await dw.click('.dinspect .lbar button:has-text("Delete")'); // the row picked from the map, not the one current before
  const deleted = await dw.evaluate(([id, v]) => { const x = drawing.doc.lines.find((l) => l.id === id); return [x.vertices.length, x.vertices.some((q) => q.position.join() === v.join())]; }, [longId, vAt]);
  check(pageThree === '201–300 of 502' && ringed && pickedRow.join() === 'Point 351:,301–400 of 502,351' && deleted.join() === '499,false',
    `points: › twice (${pageThree}); a row clicked is ringed on the map (${ringed}); a point pressed on the map picks its row, on its page (${pickedRow}); its bar's Delete takes that point (${deleted})`);
  await dw.evaluate((id) => drawing.remove([id]), longId);
  // Properties updated in place (dom.js morph): Tab, or a click into another field, from a field just
  // applied lands there; the same in a list
  const fl = await dw.evaluate(async () => { const { addLine } = await import('./draw/document.js'); let l; drawing.change((d) => { l = addLine(d, [12.0, 40.3], [[12.05, 40.32]], [12.1, 40.3]); }); drawing.select([l.id]); return l.id; });
  const focused = () => dw.evaluate(() => document.activeElement?.closest('[aria-label]')?.getAttribute('aria-label'));
  await dw.click('.dinspect input[aria-label="Name"]');
  await dw.keyboard.type('Q');
  await dw.keyboard.press('Tab');
  const afterTab = await focused();
  await dw.click('.dinspect input[aria-label="Name"]');
  await dw.keyboard.type('R');
  await dw.click('.dinspect input[aria-label="Offset (px)"]');
  await dw.keyboard.type('2');
  await dw.keyboard.press('Enter');
  const clicked = await dw.evaluate((id) => drawing.doc.lines.find((x) => x.id === id).look.offset, fl);
  await dw.click('.dinspect input[aria-label="Point 2 latitude"]');
  await dw.keyboard.press('Control+A');
  await dw.keyboard.type('40.33');
  await dw.keyboard.press('Tab');
  const inList = await focused();
  check(afterTab === 'Path' && clicked === 2 && inList === 'Point 2 longitude', `Properties in place: Tab from a field applied (${afterTab}), a click into the next (Offset ${clicked}), Tab in a list (${inList})`);
  await dw.evaluate((id) => drawing.remove([id]), fl);
  check(!dw.errors.length, `drawing: no errors ${dw.errors.join(' | ')}`);
  await dw.close();
});

await section('with a finger, on a phone', async () => {
  // with a finger, on a phone (drawing-ui.md §1): the sheet closed to start with, Elements and
  // Properties in it one at a time; the tools in the dock, Back there while one is on, Undo and Redo; what is
  // selected peeks (Properties' head), a tap on it Properties; a finger held then dragged: a box; handles larger
  const fctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const fp = await open('#v=11/40.2/12.1/0&on=chart,coastline', fctx);
  const shown = () => fp.evaluate(() => [!document.querySelector('#side').hidden, !document.querySelector('#props').hidden]);
  const atStart = await shown();
  const dock = await fp.evaluate(() => [...document.querySelectorAll('#dock > button')].filter((b) => b.offsetParent).map((b) => b.getAttribute('aria-label') || b.textContent).join());
  await fp.evaluate(() => drawing.setVariant('shape', 'circle'));
  await fp.click('#dock [data-tool=shape]');
  await fp.touchscreen.tap(195, 300); // the centre…
  await fp.touchscreen.tap(195, 300); // …again: the default size
  const placed = await fp.evaluate(() => drawing.doc.points.length);
  const drawingDock = await fp.evaluate(() => [...document.querySelectorAll('#dock > button')].filter((b) => b.offsetParent).map((b) => b.getAttribute('aria-label') || b.textContent).join());
  await fp.click('#dock button[aria-label=Undo]');
  const undone = await fp.evaluate(() => drawing.doc.points.length);
  await fp.click('#dock button[aria-label=Redo]');
  const redone = await fp.evaluate(() => drawing.doc.points.length);
  await fp.click('#dock button:has-text("Back")'); // the tool ends
  const afterBack = await fp.evaluate(() => drawing.tool);
  await fp.evaluate(() => drawing.select([drawing.doc.points[0].id]));
  const peek = await fp.evaluate(() => [!document.querySelector('#props').hidden, document.querySelector('#props').classList.contains('peek'), document.querySelector('#props').offsetHeight]);
  await fp.click('#bar .ptab[data-tab=elements]');
  const colOpen = await shown();
  await fp.click('#bar .ptab[data-tab=elements]');
  await fp.click('#props .dinsphead .ititle'); // the peek tapped: Properties
  const propsOpen = await fp.evaluate(() => [!document.querySelector('#side').hidden, !document.querySelector('#props').hidden, document.querySelector('#props').classList.contains('peek')]);
  await fp.evaluate(() => drawing.select([]));
  // a finger held still, then dragged: a box, what lies inside selected
  const boxed = await fp.evaluate(async () => {
    const box = map.getCanvasContainer(), r = box.getBoundingClientRect(), q = drawing.doc.points.map((x) => map.project(x.position));
    const [x0, y0] = [Math.min(...q.map((p) => p.x)) - 40, Math.min(...q.map((p) => p.y)) - 40], [x1, y1] = [Math.max(...q.map((p) => p.x)) + 40, Math.max(...q.map((p) => p.y)) + 40];
    const ev = (type, x, y) => new PointerEvent(type, { pointerId: 7, bubbles: true, button: 0, clientX: r.left + x, clientY: r.top + y, pointerType: 'touch' });
    box.dispatchEvent(ev('pointerdown', x0, y0));
    await new Promise((res) => setTimeout(res, 650));
    window.dispatchEvent(ev('pointermove', (x0 + x1) / 2, (y0 + y1) / 2));
    window.dispatchEvent(ev('pointermove', x1, y1));
    window.dispatchEvent(ev('pointerup', x1, y1));
    return drawing.sel.size;
  });
  await fp.evaluate(() => drawing.select([]));
  const handles = await fp.evaluate(() => map.getLayoutProperty('draw-handle', 'icon-size'));
  await fp.evaluate(() => drawing.select([drawing.doc.points[0].id]));
  // a drag of the radius handle, then a second finger: everything back
  const rBefore = await fp.evaluate(() => drawing.doc.points[0].parts[0].radius);
  await fp.evaluate(async () => {
    const { destination } = await import('./geodesy.js');
    const x = drawing.doc.points[0], q = map.project(destination(x.position, 0, x.parts[0].radius)), box = map.getCanvasContainer(), r = box.getBoundingClientRect();
    const ev = (type, id, dy = 0) => new PointerEvent(type, { pointerId: id, bubbles: true, button: 0, clientX: r.left + q.x, clientY: r.top + q.y - dy, pointerType: 'touch' });
    box.dispatchEvent(ev('pointerdown', 1));
    window.dispatchEvent(ev('pointermove', 1, 20));
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    box.dispatchEvent(ev('pointerdown', 2)); // a second finger
    window.dispatchEvent(ev('pointerup', 1));
  });
  const after = await fp.evaluate(() => [drawing.doc.points[0].parts[0].radius, !!drawing.drag]);
  check(atStart.join() === 'false,false' && dock === 'Undo,Redo,Point,Line,Shape,Label,Measure' && placed === 1 && drawingDock === 'Back,Undo,Redo,Shape' && undone === 0 && redone === 1 && afterBack === null,
    `finger: the sheet closed to start with; the dock Undo, Redo and the tools (${dock}); a circle placed by two taps, the dock then ${drawingDock}; Undo, Redo (${undone}, ${redone}); Back ends the tool (${atStart}; ${placed}; ${afterBack})`);
  check(peek[0] && peek[1] && peek[2] < 120 && colOpen.join() === 'true,false' && propsOpen.join() === 'false,true,false' && boxed === 1,
    `finger: what is selected peeks (${peek}); Elements in its place (${colOpen}); the peek tapped: Properties (${propsOpen}); held then dragged: a box selects ${boxed}`);
  check(handles === 1.75 && after[0] === rBefore && !after[1], `finger: handles drawn larger (${handles}); a second finger during a drag puts it back (${rBefore} → ${after[0]})`);
  check(!fp.errors.length, `finger: no errors ${fp.errors.join(' | ')}`);
  await fctx.close();
});

await finish();
