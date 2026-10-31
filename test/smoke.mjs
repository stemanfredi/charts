#!/usr/bin/env node
// Smoke test in headless Chrome, against the live tile providers: the page loads without
// errors, the menu drives the map, URL state survives a reload, PNG and GIS export work.
// The drawing tools are draw.mjs's, with the network blocked; the elevation profile, which reads
// relief and depth tiles, is here.
//   CHROME=/path/to/chrome npm run smoke     (default: /usr/bin/google-chrome)
// Network-dependent by design: it is also what tells us a provider changed or went down.
import { readFile } from 'node:fs/promises';
import { start, openPage, exportItem, unzip, settled, frames } from './browser.mjs';
import { setSwVersion } from './serve.mjs';
import { tileBounds } from '../site/geo.js';
import { OFFLINE_PREFIXES } from '../site/hosts.js';

const { browser, base, check, section, finish } = await start();
// the service worker blocked, but in its own section at the end: here the network as it is, routes included
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' });
// cross-origin requests that carried a Referer (the page and the clip worker both promise none)
const referred = new Set();
ctx.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && r.headers().referer) referred.add(u.host); });

// a page at hash, loaded, its errors collected (in: another context, a phone's; tab, groups: openPage's)
const open = (hash, inCtx = ctx, tab = null, groups = null) => openPage(inCtx, base + hash, tab, groups);
const visible = (page, id) => page.evaluate((id) => map.getLayoutProperty(id, 'visibility'), id);
// the time line: behind the time chip on the bottom row
// the search: a field in the bar (a phone: behind its lens)
const findOpen = async (page) => page.click((await page.isVisible('#b-find')) ? '#b-find' : '#q');

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
  await p.waitForFunction(() => map.querySourceFeatures('drawvalue').length > 0, null, { timeout: 5000 }).catch(() => {}); // the leg's values drawn
  const liveValues = await p.evaluate(() => map.querySourceFeatures('drawvalue').length);
  await p.mouse.dblclick(420, 340);
  const made = await p.evaluate(() => [drawing.doc.lines.length, drawing.sel.has(drawing.doc.lines[0]?.id), drawing.tool]);
  await p.keyboard.press('Escape');
  await settled(p);
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
  await pv.waitForFunction(() => document.querySelector('#side').hidden, null, { timeout: 5000 }).catch(() => {});
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
      await frames(page);
      fits.push(await page.evaluate(() => [...document.querySelectorAll('#bar > *')].every((e) => !e.offsetParent || e.getBoundingClientRect().right <= innerWidth) && document.documentElement.scrollWidth <= innerWidth
        && [...document.querySelectorAll('#bar > button')].every((b) => !b.offsetParent || [...b.querySelectorAll('svg')].some((i) => i.getBoundingClientRect().width > 0)))); // each button shown with its icon
    }
    return fits;
  };
  const mouse = await fitsAt(pv, [390, 720, 1024, 1440]);
  const tctx = await browser.newContext({ viewport: { width: 820, height: 800 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const finger = await fitsAt(await open('#v=6/41/12/0', tctx), [390, 820, 1180, 1280]);
  await tctx.close();
  check([...mouse, ...finger].every(Boolean), `the bar within the window, each button with its icon, with a mouse at 390, 720, 1024, 1440 px (${mouse}) and a finger at 390, 820, 1180, 1280 (${finger})`);
  await pv.close();
});

await section('NASA true colour', async () => {
  // NASA true colour opened at now: the time goes no later than NASA's newest day, and the tiles
  // are of the day shown (no older day passed off as it)
  const tc = await open('#v=5/40/10/0&col=gibs:terra&on=chart,coastline', ctx, 'layers', ['data']);
  // the tiles of the day in the link (both set once NASA's days are read)
  await tc.waitForFunction(() => { const day = /\/(\d{4}-\d{2}-\d{2})\//.exec(map.getSource('gibs-terra').tiles[0])?.[1]; return map.getLayoutProperty('gibs-terra', 'visibility') === 'visible' && day && location.hash.includes(`t=${day}`); }, null, { timeout: 20000 }).catch(() => {});
  const [tcTiles, tcHash, rowsOn, tcNotes] = await tc.evaluate(() => [map.getSource('gibs-terra').tiles[0], location.hash, document.querySelector('#shown').hidden ? 'hidden' : 'shown',
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
  await settled(zm);
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
  const arrived = (lat, lon, tol) => sp.waitForFunction(({ lat, lon, tol }) => { const c = map.getCenter(); return !map.isMoving() && Math.abs(c.lat - lat) < tol && Math.abs(c.lng - lon) < tol; }, { lat, lon, tol }, { timeout: 10000 }).catch(() => {});
  await sp.fill('#q', '35 54N 14 31E');
  await sp.keyboard.press('Enter');
  await arrived(35.9, 14 + 31 / 60, 0.01);
  check((await near(35.9, 14 + 31 / 60, 0.01)) && photonCalls === 0, 'coordinates in the search box go there, without a request');
  await findOpen(sp);
  await sp.fill('#q', 'Valletta');
  await sp.waitForSelector('#results li[role=option]', { timeout: 15000 }).catch(() => {});
  await sp.keyboard.press('Enter');
  await arrived(35.9, 14.51, 0.05);
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
  await tr.waitForFunction(() => /per=traffic:2019/.test(location.hash), null, { timeout: 5000 }).catch(() => {}); // written 250 ms after a change
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
  await rt.waitForFunction(() => /per=[^&]*routes:2025-11/.test(location.hash), null, { timeout: 5000 }).catch(() => {}); // written 250 ms after a change
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
  const [minMax, shownOn] = await cm.evaluate(() => [[document.querySelector('#shown input').min, document.querySelector('#shown input').max], !document.querySelector('#shown').hidden]);
  check(shownOn && minMax[0] > '2020' && minMax[1] > minMax[0] && !minMax[1].startsWith('2099'), `the field holds the dates the layers have (${minMax.join(' to ')})`, true);
  await cm.fill('#shown input', aLocal);
  await cm.waitForFunction((t) => location.hash.includes(`t=${t}`), new Date(ahead).toISOString().slice(0, 13), { timeout: 5000 }).catch(() => {});
  const [shownText, cmHash] = await cm.evaluate(() => [document.querySelector('#shown').textContent, location.hash]);
  check(!shownText.startsWith('Today') && cmHash.includes(`t=${new Date(ahead).toISOString().slice(0, 13)}`), `a time picked on the time line is drawn, shown beside the coordinates and kept in the link (${shownText})`);
  const cmAgain = await open(cmHash);
  check((await cmAgain.evaluate(() => document.querySelector('#shown input').value)) === aLocal, 'the link reopens at that time');
  // a day typed key by key passes through years 0002, 0020, 0202: none of them is taken
  await cm.focus('#shown input');
  await cm.keyboard.type(`${aLocal.slice(5, 7)}${aLocal.slice(8, 10)}${aLocal.slice(0, 4)}`); // en-US field: mm dd yyyy first
  await cm.waitForFunction(() => /t=20\d\d-/.test(location.hash), null, { timeout: 5000 }).catch(() => {}); // a year before 2000 stays: the wait fails, the check too
  check(/t=20\d\d-/.test(await cm.evaluate(() => location.hash)), 'a day typed key by key never jumps to a year before 2000');
  await cm.fill('#shown input', await cm.evaluate(() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`; }));
  await cm.waitForFunction(() => document.querySelector('#shown').textContent.startsWith('Today'), null, { timeout: 5000 }).catch(() => {});
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
  await cm.waitForFunction(() => map.getSource('mylocation').serialize().data.features.length === 2 && !map.isMoving(), null, { timeout: 15000 }).catch(() => {}); // a function: the policy refuses a string polled (eval)
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
  // the hint shown: coordinates read as such, no search timer set (search.js), so none will be sent
  await cm.waitForFunction(() => /latitude, then longitude/.test(document.querySelector('#results').textContent), null, { timeout: 5000 }).catch(() => {});
  check(!sent.length && /latitude, then longitude/.test(await cm.textContent('#results')), `coordinates being typed stay in the page (${sent.length} sent)`);
  await cm.fill('#q', '');
  await cm.close(); await cmAgain.close();
});

await section('the Ocean data menus', async () => {
  // the Ocean data menus: waves in colours, currents in arrows; wind in arrows; currents in both
  // draw speed and direction; none
  const sl = await open('#v=6/40/14/0&col=waves:height&arr=currents:surface&on=chart,coastline', ctx, 'layers', ['data']);
  const LOOKS = () => ['waves', 'currents', 'wind'].map((id) => (map.getLayoutProperty(`cmems-${id}`, 'visibility') === 'visible' ? `${id}:${/cmems:\/\/\w+\/\w+\/(\w+)/.exec(map.getSource(`cmems-${id}`).tiles[0] || '')?.[1]}` : '')).filter(Boolean).join(' ');
  await sl.evaluate(`window.looks = ${LOOKS}`); // for the waits below: the policy refuses a string polled (eval)
  // what is drawn once it is as expected (a wrong look: the wait fails, the check too)
  const looks = async (want, hash = '') => {
    await sl.waitForFunction(([want, hash]) => window.looks() === want && location.hash.includes(hash), [want, hash], { timeout: 10000 }).catch(() => {});
    return sl.evaluate(LOOKS);
  };
  const l1 = await looks('waves:colour currents:arrows');
  await sl.selectOption('select[aria-label=Arrows]', 'wind:observed');
  const l2 = await looks('waves:colour wind:arrows');
  await sl.selectOption('select[aria-label=Colours]', 'currents:surface');
  await sl.selectOption('select[aria-label=Arrows]', 'currents:surface');
  const [l3, l3hash] = [await looks('currents:both', 'col=currents:surface&arr=currents:surface'), await sl.evaluate(() => location.hash)];
  await sl.selectOption('select[aria-label=Colours]', '');
  await sl.selectOption('select[aria-label=Arrows]', '');
  await sl.waitForFunction(() => document.querySelector('#shown').hidden, null, { timeout: 10000 }).catch(() => {});
  const [l4, whenHidden] = [await looks(''), await sl.evaluate(() => document.querySelector('#shown').hidden)];
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
  const OB = () => {
    const t = /t=([\d-]+T\d\d)/.exec(location.hash)?.[1] || '', ms = Date.parse(`${t}:00:00Z`);
    return [t, ms <= new Date(document.querySelector('#shown input').max).getTime(), document.querySelector('#shown').textContent,
      `${new Date(ms).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' })} ${new Date(ms).getUTCDate()} ${new Date(ms).toLocaleDateString([], { month: 'short', timeZone: 'UTC' })}`, [...document.querySelectorAll('.item.error, .item.partial')].map((r) => r.title)];
  };
  // the time moved to the latest day the observation has: its day shown
  await ob.evaluate(`window.ob = ${OB}`);
  await ob.waitForFunction(() => { const [t, within, shown, day] = window.ob(); return t && within && (shown === 'Today' || shown === day); }, null, { timeout: 10000 }).catch(() => {});
  const [obT, obWithin, obShown, obDay, obBroken] = await ob.evaluate(OB);
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
  // an export that fails says so in the note, its button as it was, and the next click tries again
  await again.route('**/polygon-clipping*', (r) => r.abort());
  await exportItem(again, 'zip');
  await again.waitForFunction(() => /export failed/.test(document.querySelector('.dnote:not(#update)')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  const [zipNote, zipLabel] = await again.evaluate(() => [document.querySelector('.dnote:not(#update)')?.textContent || '', document.querySelector('#zip span').textContent]);
  check(/^GIS data \(ZIP\): export failed: .*polygon-clipping/.test(zipNote) && zipLabel === 'GIS data (ZIP)', `a failed GIS export says so in the note (${zipNote}; the button: ${zipLabel})`);
  await again.unroute('**/polygon-clipping*');
  await again.keyboard.press('Escape'); // the menu closed (from 1024 px wide it stays open while an export runs)
  const [dz] = await Promise.all([again.waitForEvent('download', { timeout: 60000 }), exportItem(again, 'zip')]);
  const z = await readFile(await dz.path());
  const names = ['item.json', 'map.png', 'map.pgw', 'map.png.aux.xml', 'chart.png', 'vector/coastline.geojson', 'vector/isobaths.geojson', 'raster/depth.tif'];
  check(z.readUInt32LE(0) === 0x04034b50 && names.every((n) => z.includes(n)) && dz.suggestedFilename().endsWith('.zip'), `GIS export holds ${names.join(', ')} (${Math.round(z.length / 1024)} KB)`);
  // item.json lists every file in the zip, once
  const { names: entries, item } = await unzip(z);
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
  await cv.waitForFunction(() => /t=/.test(location.hash), null, { timeout: 30000 }).catch(() => {}); // its datasets' times read
  const [dv] = await Promise.all([cv.waitForEvent('download', { timeout: 120000 }), exportItem(cv, 'zip')]);
  const { names: ve, item: vi } = await unzip(await readFile(await dv.path()));
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
    ['density and depth, no time', '#v=7/37.5/14/0&on=chart,coastline,depth,traffic,legend', false],
    ['NASA daily', '#v=5/40/10/0&col=gibs:terra&on=chart,coastline', true],
    ['Copernicus colours and arrows', '#v=6/39/14/0&col=waves:height&arr=currents:surface&on=chart,coastline,legend', true],
    ['Copernicus at a depth', '#v=6/39/14/0&col=temperature:depth&dz=100&on=chart,coastline,legend', true],
    ['daily only, an observation', '#v=6/39/14/0&col=sst:measured&on=chart,coastline,legend', true],
  ];
  for (const [what, hash, hasTime] of PARITY) {
    const pp = await open(`${hash}`, ctx, 'elements');
    if (hasTime) await pp.waitForFunction(() => /t=/.test(location.hash), null, { timeout: 30000 }).catch(() => {}); // the time read and in the link
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
    const zf = (await unzip(await readFile(await dl.path()))).files, item = JSON.parse(zf['item.json']), pr = item.properties, layers = pr['chart:layers'];
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
  // the legends drawn from what the services say (their classes)
  await em.waitForFunction(() => ['substrate', 'depthsource'].every((id) => document.querySelector(`#legends canvas[data-legend=${id}]`)?.getAttribute('aria-label')?.includes(',')), null, { timeout: 30000 }).catch(() => {});
  const [emBroken, emClasses] = await em.evaluate(() => [[...document.querySelectorAll('.item.error, .item.partial')].map((r) => `${r.querySelector('.name').textContent} (${r.title})`),
    document.querySelector('#legends canvas[data-legend=substrate]')?.getAttribute('aria-label') || '']);
  const [de] = await Promise.all([em.waitForEvent('download', { timeout: 120000 }), exportItem(em, 'zip')]);
  const emFiles = (await unzip(await readFile(await de.path()))).files, emItem = JSON.parse(emFiles['item.json']);
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
    // the sea: its popup; on land the answer is no popup, and nothing says the lookup is over: a sleep
    if (lng === 8.3) await dp.waitForSelector('.depthpop .maplibregl-popup-content > div', { timeout: 15000 }).catch(() => {});
    else await dp.waitForTimeout(2500);
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

await section('the elevation profile', async () => {
  const dw = await open('#v=11/40.2/12.1/0&on=chart,coastline', ctx, 'elements');
  await dw.setViewportSize({ width: 1600, height: 800 });
  await dw.evaluate(() => { if (document.querySelector('#bar .pright').getAttribute('aria-pressed') !== 'true') document.querySelector('#bar .pright').click(); }); // Properties on
  // a line's elevation profile: read when asked, the chart drawn, its length along the surface longer
  const deepLine = await dw.evaluate(async () => { const { addLine } = await import('./draw/document.js'); let l; drawing.change((d) => { l = addLine(d, [12.0, 40.2], [], [12.3, 40.2]); }); drawing.select([l.id]); return l.id; });
  await dw.click('.dinspect button:has-text("Elevation profile")');
  await dw.waitForSelector('svg.profile polyline', { timeout: 60000 }).catch(() => null);
  const prof = await dw.evaluate(() => [document.querySelectorAll('svg.profile polyline').length, document.querySelector('.dinspect .fblock .fvalue[title*="lower bound"]')?.textContent || '']);
  const deepLength = await dw.evaluate(async (id) => { const { lineTrace } = await import('./draw/lines.js'); return lineTrace(drawing.doc, drawing.doc.lines.find((x) => x.id === id)).length; }, deepLine);
  check(prof[0] > 0 && /along the surface/.test(prof[1]) && deepLength > 25000, `a line's elevation profile: the chart and the length along the surface (${prof[1]})`);
  // on land: the heights, above sea level (across the Matterhorn, 4,478 m)
  await dw.evaluate(async () => { const { addLine } = await import('./draw/document.js'); let l; drawing.change((d) => { l = addLine(d, [7.62, 45.97], [], [7.70, 45.98]); }); drawing.select([l.id]); });
  await dw.click('.dinspect button:has-text("Elevation profile")');
  await dw.waitForSelector('svg.profile polyline', { timeout: 60000 }).catch(() => null);
  const land = await dw.evaluate(() => document.querySelector('svg.profile')?.getAttribute('aria-label') || '');
  const [low, high] = (land.match(/([−\d,]+) m to ([−\d,]+) m/) || []).slice(1).map((x) => +x.replace(/,/g, '').replace('−', '-'));
  check(low > 2000 && high > 4000 && high < 4500, `a line's elevation profile on land: its heights (${land})`);
  await dw.evaluate((id) => drawing.select([id]), deepLine);
  // the line pointed at on the map: its place marked; off the line, and with the section closed, no mark left
  await dw.evaluate(() => map.jumpTo({ center: [12.15, 40.2], zoom: 9 }));
  await settled(dw);
  const onLine = await dw.evaluate(() => { const p = map.project([12.15, 40.2]), r = map.getCanvas().getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; });
  const marks = () => dw.evaluate(() => drawing.previewPts?.length || 0);
  await dw.mouse.move(onLine[0], onLine[1]);
  const markedOn = await marks();
  await dw.mouse.move(onLine[0], onLine[1] + 60);
  const markedOff = await marks();
  await dw.mouse.move(onLine[0], onLine[1]);
  await dw.click('.dinspect button:has-text("Elevation profile")'); // closed
  const markedClosed = await marks();
  check(markedOn === 1 && markedOff === 0 && markedClosed === 0, `a line's elevation profile: its place marked while the line is pointed at (${markedOn}), not off it (${markedOff}), nor once the section is closed (${markedClosed})`);
  check(!dw.errors.length, `the elevation profile: no errors ${dw.errors.join(' | ')}`);
  await dw.close();
});

await section('the page without a connection, and a new version', async () => {
  // a version published: the worker keeps the page's files and takes the page over; without a
  // connection the page still opens, with its drawings
  setSwVersion('a');
  const sctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const sp = await open('#v=8/43.5/9.5/0&on=chart,coastline', sctx);
  await sp.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 30000 });
  const kept = await sp.evaluate(async () => [(await caches.keys()).join(), (await (await caches.open('shell-a')).keys()).map((r) => new URL(r.url).pathname)]);
  const shell = (await readFile(new URL('../site/sw.js', import.meta.url), 'utf8')).match(/shell:start[^\n]*\n([\s\S]*?)\s*\/\/ shell:end/)[1].split('\n').length;
  check(kept[0] === 'shell-a' && kept[1].length === shell && kept[1].includes('/vendor/maplibre-gl.mjs'), `offline: the worker keeps the page's ${kept[1].length} of ${shell} files (${kept[0]})`);
  await sp.evaluate(async () => { const { addPoint } = await import('./draw/document.js'); drawing.change((d) => addPoint(d, [9.5, 43.5])); });
  await sp.waitForFunction(() => !drawing.saving.timer, null, { timeout: 5000 }); // saved (draw/saving.js: 400 ms after a change)
  const drawn = await sp.evaluate(() => drawing.doc.points.length);
  await sctx.setOffline(true);
  await sp.reload();
  await sp.waitForFunction((n) => window.drawing?.doc.points.length === n, drawn, { timeout: 15000 }).catch(() => {}); // restored once the map has loaded
  const offline = await sp.evaluate(() => [!document.querySelector('#nostart'), !!document.querySelector('#bar'), drawing.doc.points.length, document.querySelector('#update').hidden]);
  check(drawn === 1 && offline[0] && offline[1] && offline[2] === drawn && offline[3], `offline: the page opens without a connection, the map started, the bar there, its ${offline[2]} points kept (${offline})`);
  await sctx.setOffline(false);
  // a newer version: fetched by the worker, it waits; the chip says so, and its Reload applies it
  setSwVersion('b');
  await sp.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await sp.waitForSelector('#update:not([hidden])', { timeout: 30000 });
  const before = await sp.evaluate(async () => (await caches.keys()).sort().join());
  await Promise.all([sp.waitForEvent('load', { timeout: 30000 }), sp.click('#update .linkbtn')]);
  await sp.waitForFunction(() => window.map, null, { timeout: 30000 });
  const after = await sp.evaluate(async () => [(await caches.keys()).join(), document.querySelector('#update').hidden]);
  check(before === 'shell-a,shell-b' && after[0] === 'shell-b' && after[1], `a new version waits beside the old (${before}), the chip's Reload applies it (${after[0]}), the chip gone (${after[1]})`);
  check(!sp.errors.filter((e) => !/Failed to fetch|AJAXError|NetworkError|ERR_INTERNET_DISCONNECTED/.test(e)).length, `offline: no errors of the page's own ${sp.errors.join(' | ')}`);
  setSwVersion(null);
  await sctx.close();
});

await section('a saved area: served from it, online and without a connection; Esri never', async () => {
  // an area saved by hand (the downloader comes later): every file of the saved hosts the view asked
  // for, put in a pack-… cache under its own address, as a saved area keeps them
  setSwVersion('c');
  const actx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const savedHosts = Object.values(OFFLINE_PREFIXES);
  const isSaved = (u) => savedHosts.some((h) => u.startsWith(h));
  const asked = new Set(), failed = [];
  actx.on('request', (r) => { if (isSaved(r.url())) asked.add(r.url()); });
  actx.on('requestfailed', (r) => { if (!r.serviceWorker() && isSaved(r.url())) failed.push(r.url()); }); // the page's, not the worker's own tries of the network
  const loading = new Set(); // a saved host's requests on their way
  actx.on('request', (r) => { if (isSaved(r.url())) loading.add(r); });
  for (const done of ['requestfinished', 'requestfailed']) actx.on(done, (r) => loading.delete(r));
  const view = '#v=10/44.08/9.85/0&on=chart,coastline,depth,isobaths,relief,contours,seamarks';
  const ap = await open(view, actx);
  await ap.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 30000 });
  const put = await ap.evaluate(async (urls) => {
    const cache = await caches.open('pack-test');
    let n = 0;
    for (const u of urls) { const r = await fetch(u, { credentials: 'omit', referrerPolicy: 'no-referrer' }).catch(() => null); if (r?.ok) { await cache.put(u, r); n++; } }
    await cache.put(new URL('pack.json', document.baseURI).href, new Response('{"name":"test"}')); // complete: used
    navigator.serviceWorker.controller.postMessage('packs');
    return n;
  }, [...asked]);
  // online: the area's files come from it; Esri's never pass through the worker
  const fromWorker = [], esri = [];
  actx.on('response', (r) => { if (isSaved(r.url()) && r.fromServiceWorker()) fromWorker.push(r.url()); if (/arcgisonline/.test(r.url())) esri.push(r.fromServiceWorker()); });
  await ap.goto(base + view.replace('chart,', 'sat,'));
  await ap.waitForFunction(() => window.map?.loaded?.() && map.areTilesLoaded(), null, { timeout: 90000 });
  check(put > 20 && fromWorker.length > 10 && esri.length > 0 && esri.every((w) => !w), `saved area: ${put} files saved; online, ${fromWorker.length} served from it; Esri's ${esri.length} tiles never through the worker`);
  // without a connection: the same view drawn from the area, no request to a saved host failing; the
  // area first given what the online loads asked for since (work that ends after the map says its
  // tiles are loaded: a lake's shore read at lower zooms)
  await ap.goto(base + view);
  await ap.waitForFunction(() => window.map?.loaded?.() && map.areTilesLoaded(), null, { timeout: 90000 });
  await settled(ap);
  await new Promise((r) => { const quiet = () => (loading.size ? setTimeout(quiet, 100) : r()); quiet(); }); // and nothing of a saved host still on its way
  await ap.evaluate(async (urls) => {
    const cache = await caches.open('pack-test');
    for (const u of urls) if (!(await cache.match(u))) { const r = await fetch(u, { credentials: 'omit', referrerPolicy: 'no-referrer' }).catch(() => null); if (r?.ok) await cache.put(u, r); }
  }, [...asked]);
  failed.length = 0;
  await (await actx.newCDPSession(ap)).send('Network.clearBrowserCache'); // only the saved area can answer
  await actx.setOffline(true);
  await ap.reload();
  await ap.waitForFunction(() => window.map?.loaded?.() && map.areTilesLoaded(), null, { timeout: 60000 }).catch(() => {});
  await settled(ap);
  const drawn = await ap.evaluate(() => {
    const at = (layer) => map.queryRenderedFeatures({ layers: map.getStyle().layers.filter((l) => l.source === layer).map((l) => l.id) }).length;
    return { base: at('omt'), isobaths: at('isobaths'), contours: at('contours'), loaded: map.loaded() && map.areTilesLoaded() };
  });
  check(drawn.base > 50 && drawn.isobaths > 0 && drawn.contours > 0 && !failed.length,
    `saved area, offline: the base map (${drawn.base} features), isobaths (${drawn.isobaths}) and contours (${drawn.contours}) drawn; ${failed.length} saved-host requests failed${failed.length ? `: ${failed.slice(0, 3).join(' ')}` : ''}`);
  await actx.setOffline(false);
  setSwVersion(null);
  await actx.close();
});

await section('Offline areas: the view saved from the dialog, drawn without a connection, deleted', async () => {
  setSwVersion('d');
  const octx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const savedHosts = Object.values(OFFLINE_PREFIXES);
  // the page's requests that failed (not the service worker's own tries of the network) for a saved
  // host, in the saved area: a tile beyond it, which a wide window shows, is not in it, nor a tile
  // below the area's lowest zoom (MapLibre asks for a failed tile's parents, coarser and coarser,
  // to show something in its place: a tile beyond the area has parents that contain it)
  const failed = [];
  let area = null, areaFrom = 0;
  let wide = false; // the window wider than the area: a depth chunk (degrees wide) may be wanted only by tiles beyond it
  const inArea = (u) => {
    if (!area) return true;
    // a GEBCO chunk (gebco.js): level k of 15″ × 2^k cells, 512 × 512 cells a chunk, from 90° N, 180° W
    const c = /\.zarr\/(\d+)\/\w+\/(\d+)\.(\d+)$/.exec(u), m = /\/(\d+)\/(\d+)\/(\d+)\.(?:pbf|png)$/.exec(u);
    const deg = c && (512 * 15 * 2 ** c[1]) / 3600;
    if (!c && !m) return true;
    if (c && wide) return false;
    if (m && +m[1] < areaFrom) return false;
    const [w, s, e, n] = c ? [-180 + c[3] * deg, 90 - (+c[2] + 1) * deg, -180 + (+c[3] + 1) * deg, 90 - c[2] * deg] : tileBounds(+m[1], +m[2], +m[3]);
    return e > area[0] && w < area[2] && n > area[1] && s < area[3];
  };
  octx.on('requestfailed', (r) => { if (!r.serviceWorker() && savedHosts.some((x) => r.url().startsWith(x)) && inArea(r.url())) failed.push(r.url()); });
  const op = await open('#v=11/44.08/9.85/0&on=chart,coastline,depth,isobaths,relief,contours,seamarks,places,roads', octx);
  await op.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 30000 });
  await exportItem(op, 'offline');
  await op.waitForSelector('dialog.offline[open]');
  await op.selectOption('dialog.offline select', '12');
  const t0 = Date.now();
  await op.click('dialog.offline button.done');
  await op.waitForSelector('dialog.offline .drawings li', { timeout: 600000 });
  const took = Math.round((Date.now() - t0) / 1000);
  const row = await op.textContent('dialog.offline .drawings li .val');
  check(/zooms 8–12 · [\d.]+ MB/.test(row) && !(await op.textContent('dialog.offline .ostatus')), `offline areas: saved (${row}; ${took} s)`);
  // renamed in its row: double-clicked, typed, Enter (a single click would show it on the map)
  await op.dblclick('dialog.offline .drawings .dname');
  await op.fill('dialog.offline .drawings input.dname', 'Gulf');
  await op.press('dialog.offline .drawings input.dname', 'Enter');
  const renamed = await op.waitForFunction(() => document.querySelector('dialog.offline[open] .drawings .dname')?.textContent === 'Gulf', null, { timeout: 5000 }).then(() => true, () => false);
  check(renamed, `offline areas: renamed in its row (${await op.textContent('dialog.offline .drawings .dname').catch(() => 'no row')})`);
  await op.click('dialog.offline .fbuttons button:not(.done)'); // Close
  ({ bounds: area, from: areaFrom } = await op.evaluate(async () => {
    const id = (await caches.keys()).find((k) => k.startsWith('pack-'));
    return (await (await caches.open(id)).match(new URL('pack.json', document.baseURI).href)).json();
  }));
  // without a connection: the area at zooms 9 to 12, across it, with no request to a saved host failing
  failed.length = 0;
  await (await octx.newCDPSession(op)).send('Network.clearBrowserCache'); // only the saved area can answer
  await octx.setOffline(true);
  await op.reload();
  const seen = [];
  for (const [z, lng, lat] of [[8, 9.85, 44.08], [10, 9.6, 44.0], [11, 10.1, 44.2], [12, 9.85, 44.08], [12, 9.55, 43.95]]) {
    wide = z < 11;
    await op.evaluate(([z, lng, lat]) => map.jumpTo({ zoom: z, center: [lng, lat] }), [z, lng, lat]);
    await op.waitForFunction(() => map.loaded() && map.areTilesLoaded(), null, { timeout: 60000 }).catch(() => {});
    await settled(op);
    seen.push(await op.evaluate(() => map.queryRenderedFeatures().length));
  }
  check(seen.every((n) => n > 5) && !failed.length, `offline areas, offline: drawn at zooms 8–12 across the area (${seen.join(', ')} features); ${failed.length} saved-host requests failed${failed.length ? `: ${failed.slice(0, 3).join(' ')}` : ''}`);
  // still without a connection: the layers kept are not marked as failing (beyond the area is no
  // fault); one not kept says why; place search says there is no connection, asking nobody
  await op.evaluate(() => document.querySelector('#i-maritime').click());
  await op.waitForFunction(() => document.querySelector('#i-maritime').closest('.item').classList.contains('error'), null, { timeout: 15000 }).catch(() => {});
  await settled(op);
  const marks = await op.evaluate(() => [...document.querySelectorAll('.error, .partial')].filter((r) => r.title).map((r) => `${r.querySelector('input')?.id || r.textContent.trim().slice(0, 12)}: ${r.title}`));
  check(marks.length === 1 && /^i-maritime: No connection/.test(marks[0]), `offline: only a layer not kept is marked (${marks.join(' | ') || 'none'})`);
  await findOpen(op);
  await op.fill('#q', 'Genova');
  await op.waitForSelector('#results li', { timeout: 5000 }).catch(() => {});
  const said = await op.evaluate(() => document.querySelector('#results')?.textContent || '');
  check(/No connection/.test(said), `offline: place search says there is no connection (${said.slice(0, 60)})`);
  await op.keyboard.press('Escape');
  await octx.setOffline(false);
  // its file written (File), then deleted: asked first, then gone from the list and from the browser
  await exportItem(op, 'offline');
  await op.waitForSelector('dialog.offline[open] .drawings li');
  const [fdl] = await Promise.all([op.waitForEvent('download', { timeout: 60000 }), op.click('dialog.offline .drawings button[aria-label^="Download"]')]);
  const fileBytes = await readFile(await fdl.path());
  await op.click('dialog.offline .drawings .del');
  await op.click('dialog.dreport .fbuttons button.done');
  await op.waitForFunction(() => !document.querySelector('dialog.offline .drawings li'), null, { timeout: 10000 });
  const left = await op.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('pack-')).length);
  check(left === 0, `offline areas: deleted (${left} left)`);
  // as a file: written before the delete above (its File button), opened again, drawn offline from it
  const az = (await unzip(fileBytes)).files;
  const head = JSON.parse(az['area.json']);
  check(head.format === 'charts-offline-area' && head.files.length > 100 && head.files.every((f) => az[f.name]) && !head.files.some((f) => f.url.includes('openseamap')) && /OpenStreetMap/.test(String(az['README.txt'])),
    `offline areas, file: ${head.files.length} files with their addresses, the credits, no seamarks (${Math.round(fileBytes.length / 1e6)} MB)`);
  await op.setInputFiles('input[type=file][accept*=".zip"]', { name: 'area.zip', mimeType: 'application/zip', buffer: fileBytes }); // the bar's Open › Open a file…
  await op.waitForSelector('dialog.offline .drawings li', { timeout: 60000 });
  await op.click('dialog.offline .fbuttons button:not(.done)'); // Close
  failed.length = 0;
  await (await octx.newCDPSession(op)).send('Network.clearBrowserCache');
  await octx.setOffline(true);
  await op.reload();
  await op.evaluate(() => map.jumpTo({ zoom: 12, center: [9.85, 44.08] }));
  await op.waitForFunction(() => map.loaded() && map.areTilesLoaded(), null, { timeout: 60000 }).catch(() => {});
  await settled(op);
  const fromFile = await op.evaluate(() => map.queryRenderedFeatures().length), missed = failed.filter((u) => !u.includes('openseamap'));
  check(fromFile > 100 && !missed.length, `offline areas, file opened again: drawn offline (${fromFile} features), ${missed.length} requests failed but the seamarks'${missed.length ? `: ${missed.slice(0, 3).join(' ')}` : ''}`);
  await octx.setOffline(false);
  await op.reload();
  await exportItem(op, 'offline');
  await op.waitForSelector('dialog.offline[open] .drawings li');
  await op.click('dialog.offline .drawings .del');
  await op.click('dialog.dreport .fbuttons button.done');
  await op.waitForFunction(() => !document.querySelector('dialog.offline .drawings li'), null, { timeout: 10000 });
  setSwVersion(null);
  await octx.close();
});

await finish();
