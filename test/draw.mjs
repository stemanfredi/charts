#!/usr/bin/env node
// The drawing in headless Chrome, with no network but the site's own server: every other request
// aborted, so what is tested is the drawing, not a provider's day (the map's tiles and glyphs fail;
// the drawing's text is still laid out and drawn).
//   CHROME=/path/to/chrome npm run draw     (default: /usr/bin/google-chrome)
// What needs a provider stays in smoke.mjs: the elevation profile (relief and depth tiles).
import { readFile } from 'node:fs/promises';
import { start, openPage, exportItem, unzip, settled, frames } from './browser.mjs';

const { browser, base, check, section, finish } = await start();
// a context with no network but the site's own (base: http://127.0.0.1:8099/)
const offline = async (opts) => {
  const c = await browser.newContext({ locale: 'en-US', serviceWorkers: 'block', ...opts });
  await c.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  return c;
};
const ctx = await offline({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const open = (hash, inCtx = ctx, tab = null) => openPage(inCtx, base + hash, tab);

// The drawing, in sections that share one page: each fails on its own, the next runs on (test/browser.mjs)
let dw = null; // the page, opened by the first section
const DX = 260; // the left panel covers the map's left: the clicks below, written for the whole map, moved right of it
// the drawing's file out: from the bar's Download menu
const exportDrawing = async () => {
  await dw.click('#bar .dlbtn');
  await dw.click('.dmenu button:has-text("Drawing (GeoJSON)")');
};
// the drawing open, as saved in this browser (one key each, the open one's in charts.drawings.current): GeoJSON
const saved = () => dw.evaluate(() => JSON.parse(localStorage.getItem(`charts.drawing.${localStorage.getItem('charts.drawings.current')}`) || 'null'));
// the same, once written: 400 ms after the last change (draw/saving.js), its timer then cleared
const written = async () => { await dw.waitForFunction(() => !drawing.saving.timer, null, { timeout: 5000 }); return saved(); };
// the page at the state it is waited for, else on after timeout (the check then says what it found)
const until = (fn, arg) => dw.waitForFunction(fn, arg, { timeout: 5000 }).catch(() => {});
const own = (f) => f.properties.charts; // the app's own part of a feature
const featuresOf = (fc, kind) => (fc?.features || []).filter((f) => own(f)?.kind === kind && !(own(f).guide && own(f).look?.text?.values));
const measuredOf = (fc) => (fc?.features || []).filter((f) => own(f)?.guide && own(f)?.look?.text?.values);
let savedFile = null, ruler = null; // the drawing's file as exported, and its measurement: opened again in the next section

await section('the drawing: the bar, the tools, the kinds, the inspector, its file', async () => {
  dw = await open('#v=11/40.2/12.1/0&on=chart,coastline', ctx, 'elements');
  await dw.setViewportSize({ width: 1600, height: 800 }); // the map clear between the panels for the clicks below
  await dw.evaluate(() => { // both panels on, the left on Elements (an earlier section may have changed them)
    if (document.querySelector('#bar .pright').getAttribute('aria-pressed') !== 'true') document.querySelector('#bar .pright').click();
    if (document.querySelector('#bar .ptab[data-tab=elements]').getAttribute('aria-pressed') !== 'true') document.querySelector('#bar .ptab[data-tab=elements]').click();
  });
  await dw.evaluate(async () => { const { addLine } = await import('./draw/document.js'); drawing.change((doc) => addLine(doc, [[12, 40.1], [12.05, 40.12]], { name: 'Distance 1', guide: true, look: { text: { values: true } } })); });
  await dw.keyboard.press('s'); // the Shape tool, a circle (its first kind), its kinds a row under its button
  const sub = await dw.locator('#bar .kinds:not([hidden]) button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
  check(sub.join() === 'Circle,Rings,Sector,Rectangle,Ellipse,Triangle,Aerial vehicle,Surface vehicle,Underwater vehicle',
    `tools: Shape's kinds a row under its button, round a centre first, then the outlines, then the vehicles (${sub})`);
  // the bar across the top, the kind in use pressed in it; the left panel open on Elements, hidden by
  // its button, back with E; Properties shows the drawing with nothing selected; the
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
  check(onTool.join() === 'Circle,true,true,0,false' && !hiddenE[2] && shownE[2] && order === 'Open,Download,Copy link,Layers,Elements,Undo',
    `tools: the bar at the top (${order}), the kind in use pressed in it; the left panel open, hidden by its button, back with E; Properties shows the drawing with nothing selected (${onTool}; ${hiddenE[2]}; ${shownE[2]})`);
  // a kind picked in the row: the tool on with it, the row shut; the key again: the tool off; a
  // right-click on the button: on again, the row open
  const shut = () => dw.evaluate(() => [!!document.querySelector('#bar .kinds')?.offsetParent, document.querySelector('#bar button[data-tool=shape]').dataset.shows]);
  if (!(await shut())[0]) await dw.click('#bar button[data-tool=shape]'); // the row open (a click on a tab may have shut it)
  await dw.click('#bar .kinds button[aria-label="Rings"]');
  const picked = await shut();
  await dw.keyboard.press('s');
  const off = [...await shut(), await dw.evaluate(() => drawing.button)];
  await dw.click('#bar button[data-tool=shape]', { button: 'right' });
  const reopened = [...await shut(), await dw.evaluate(() => drawing.button)];
  await dw.click('#bar .kinds button[aria-label="Circle"]');
  check(picked.join() === 'false,rings' && off.join() === 'false,rings,' && reopened.join() === 'true,rings,shape',
    `tools: a kind picked in the row under the tool's button, the row shut (${picked}); the key again: off (${off}); a right-click on the button: on, the row again (${reopened})`);
  await dw.mouse.click(DX + 500, 400);
  await dw.mouse.click(DX + 500, 400); // its centre again: the default size
  const made = await dw.evaluate(() => [drawing.doc.points.length, drawing.doc.circles.map((c) => [c.radius, c.groupId === drawing.doc.points[0].id]).join(), drawing.sel.has(drawing.doc.points[0].id)]);
  check(made.join() === '1,1000,true,true', `shapes: the Shape tool makes a point holding its circle, the point selected (${made})`);
  await dw.keyboard.press('Escape'); // the tool off
  await dw.keyboard.press('Escape'); // nothing selected
  await settled(dw); // drawn: a click finds it
  // the first click on a point's shape selects its point (with its shapes), the next the shape alone
  const inside = await dw.evaluate(async () => { const { destination } = await import('./geodesy.js'); const c = drawing.doc.circles[0], q = map.project(destination(c.position, 90, c.radius / 2)), r = map.getCanvasContainer().getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; });
  const chosen = () => dw.evaluate(() => [...drawing.sel].map((id) => (drawing.doc.points.some((x) => x.id === id) ? 'point' : 'circle')).join());
  await dw.mouse.click(...inside);
  await until(() => drawing.sel.size === 1);
  const first = await chosen();
  await dw.mouse.click(...inside);
  await until(() => drawing.sel.has(drawing.doc.circles[0].id));
  const second = await chosen();
  const rows = await dw.evaluate(() => [...document.querySelectorAll('.dlist .drow')].map((r) => r.querySelector('.kind').title).join());
  check(first === 'point' && second === 'circle' && rows.startsWith('Point,Circle,'), `selection: a shape clicked selects its point first, clicked again the shape alone (${first}, ${second}); the tree shows it under its point (${rows})`);
  const radius = dw.locator('.dinspect input[aria-label="Radius"]');
  await radius.fill('1.5 NM');
  await radius.press('Enter');
  const aperture = dw.locator('.dinspect input[aria-label^="Aperture"]');
  await aperture.fill('90'); // the circle a sector, its radius kept
  await aperture.press('Enter');
  const bearing = dw.locator('input[aria-label^=Bearing]');
  await bearing.fill('-30');
  await bearing.press('Enter');
  let d = await written();
  const pt0 = () => own(featuresOf(d, 'circle')[0] || { properties: {} });
  check(d?.type === 'FeatureCollection' && featuresOf(d, 'point').length === 1 && pt0().radius === 2778 && pt0().bearing === 330 && pt0().aperture === 90 && pt0().group === featuresOf(d, 'point')[0].id,
    `drawing: a circle's radius (1.5 NM), bearing (−30° → 330°) and aperture set in the inspector, saved as GeoJSON with its point (${JSON.stringify(pt0())})`);
  // the inspector as tables: every value row one line high (nothing wraps); ↑ in a value field nudges it
  const tall = await dw.evaluate(() => [...document.querySelectorAll('.dinspect .vrow')].filter((r) => r.getBoundingClientRect().height > 56).map((r) => r.textContent.slice(0, 30)));
  await bearing.focus();
  await bearing.press('ArrowUp');
  await until(() => drawing.selected()[0]?.el.bearing !== 330);
  const nudged = await dw.evaluate(() => drawing.selected()[0].el.bearing);
  await dw.evaluate(() => drawing.undo()); // back to 330, for the undo check below
  check(!tall.length && nudged === 331, `inspector: value rows never wrap (${tall.join(' | ') || 'none taller'}); ↑ nudges a bearing (330 → ${nudged})`);
  await dw.locator('.dinsphead .ititle').click(); // out of the fields: the keys are the drawing's
  await dw.keyboard.press('Control+z');
  d = await written();
  const undone = pt0().bearing ?? 0;
  await dw.keyboard.press('Control+Shift+Z');
  d = await written();
  check(undone === 0 && pt0().bearing === 330, `drawing: undo and redo (bearing ${undone}, then 330)`);
  // the list's header box: all shown, a click hides them all; again, shows them all
  const allBox = dw.locator('.droot .deye');
  const isAll = async () => (await allBox.getAttribute('aria-pressed')) === 'true';
  const wasAll = await isAll();
  await allBox.click();
  d = await written();
  const hidden = pt0().visible ?? true;
  await allBox.click();
  d = await written();
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
  savedFile = JSON.parse(await readFile(await dex.path(), 'utf8'));
  ruler = measuredOf(savedFile).find((f) => f.geometry.type === 'LineString' && f.geometry.coordinates[0][0] === 12);
  check(/\.geojson$/.test(dex.suggestedFilename()) && savedFile.type === 'FeatureCollection' && savedFile.charts?.view?.layers?.some((l) => l.id === 'coastline') && ruler?.geometry.type === 'LineString',
    `drawing: saved as GeoJSON with its view, layers and the measurement (a guide showing its values) (${dex.suggestedFilename()}, ${JSON.stringify(ruler?.geometry)})`);
});

await section('the drawing\'s files: imported again, dropped on the map, the list, restored after a reload, in the exports', async () => {
  // opened again with one measurement of its own, moved: the file's, not the page's
  ruler.geometry.coordinates = [[12.2, 40.3], [12.25, 40.31]];
  savedFile.features = [...savedFile.features.filter((f) => !measuredOf(savedFile).includes(f)), ruler];
  const exported = JSON.stringify(savedFile);
  const measuredNow = () => dw.evaluate(async () => { const { elements, isMeasurement } = await import('./draw/document.js'); return elements(drawing.doc).filter((x) => isMeasurement(drawing.doc, x.el)).map((x) => x.el.position ?? x.el.points[0]); });
  await dw.click('#bar .filebtn'); await dw.click('.dmenu .dnew'); // a new drawing, from the bar's Open, nothing asked
  await dw.waitForFunction(() => !drawing.doc.points.length && !drawing.doc.lines.length);
  await dw.evaluate(() => map.jumpTo({ center: [0, 0], zoom: 3 }));
  await dw.setInputFiles('input[type=file][accept*=geojson]', { name: 'x.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(exported) });
  await dw.click('dialog[open] button.done'); // its view has the page's layers: the map moves, no reload
  await dw.waitForFunction(() => Math.abs(map.getCenter().lat - 40.2) < 0.01);
  const c = await dw.evaluate(() => map.getCenter());
  const mAfter = JSON.stringify(await measuredNow());
  check((await dw.evaluate(() => drawing.doc.points.length)) === 1 && Math.abs(c.lat - 40.2) < 0.01 && Math.abs(c.lng - 12.1) < 0.01 && mAfter === '[[12.2,40.3]]',
    `drawing: New, then the file opened again (no reload: its layers are the page's): its element, its view and its measurement (${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}; ${mAfter})`);
  // a file without the measurement: its drawing has none (they are each drawing's)
  savedFile.features = savedFile.features.filter((f) => f !== ruler);
  // dropped on the map: imported as from the menu (its report first)
  await dw.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'other.geojson', { type: 'application/geo+json' }));
    map.getContainer().dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, JSON.stringify(savedFile));
  await dw.click('dialog[open] button.done'); // the same layers again: no reload
  await dw.waitForFunction(() => drawing.saving.list().length === 3); // imported once the dialog has closed: the third drawing of the list
  check((await measuredNow()).length === 0, 'drawing: a file without measurements brings a drawing without them');
  const drawings = await dw.evaluate(() => drawing.saving.list().map((x) => x.title || 'Untitled'));
  check(drawings.length === 3, `drawing: every drawing kept in the list, the imported ones added (${drawings.join(', ')})`); // the first and two imported (an empty New left nothing)
  // a drawing's Delete asks first, a question and its buttons only (an absent foot once printed "null")
  await dw.click('#bar .filebtn');
  await dw.locator('.dmenu .drawings .del').last().click();
  const asked = await dw.evaluate(() => document.querySelector('dialog[open]').textContent);
  await dw.click('dialog[open] button:not(.done)');
  await dw.keyboard.press('Escape');
  check(/for good/.test(asked) && !/null/.test(asked), `drawing: Delete asks first, nothing else in the dialog (${asked})`);
  await dw.reload();
  await dw.waitForFunction(() => window.map?.loaded?.(), null, { timeout: 90000 });
  check((await dw.locator('.dlist .drow').count()) === 2, 'drawing: restored after a reload (a point and its sector)');
  await dw.evaluate(() => drawing.select([drawing.doc.points[0].id])); // selected: its highlight must stay out of the picture
  const [dpng] = await Promise.all([dw.waitForEvent('download', { timeout: 120000 }), exportItem(dw, 'png')]);
  const [dzip] = await Promise.all([dw.waitForEvent('download', { timeout: 120000 }), exportItem(dw, 'zip')]);
  await dw.keyboard.press('Escape'); // the ☰ menu closed (it stays open while an export runs)
  const dfiles = (await unzip(await readFile(await dzip.path()))).files;
  const dgj = JSON.parse(dfiles['vector/drawings.geojson'] || '{}'), ditem = JSON.parse(dfiles['item.json']), dfile = JSON.parse(dfiles['drawing.geojson'] || '{}');
  check(dpng && dgj.features?.map((f) => f.properties.kind).join() === 'point,sector' && dgj.features[1].properties.radius_m === 2778
    && featuresOf(dfile, 'point').length === 1 && !measuredOf(dfile).length && ditem.assets['vector/drawings'] && ditem.assets.drawing,
  `drawing: in the PNG and the GIS export (as drawn, and the drawing's own file, listed in the STAC item) ${Object.keys(dfiles).filter((n) => /draw/.test(n)).join(', ')}`);
  check(await dw.evaluate(() => map.getLayoutProperty('draw-mark-line-polygon', 'visibility') === 'visible'), 'drawing: the selection shown again after the exports');
});

await section('lines, groups and the box', async () => {
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
  const segs = await dw.evaluate(async () => { const { linkFrom } = await import('./draw/document.js'), tie = (s, i) => linkFrom(drawing.doc, s.id, i < 0 ? s.points.length + i : i)?.to.element ?? null; return drawing.doc.lines.map((s) => [tie(s, 0), tie(s, -1), s.points.length]); });
  check(segs.length === 3 && segs[0][1] && segs[1][0] === segs[0][1] && segs[2][0] === segs[0][1] && segs[0][2] === 3,
    `drawing: three lines drawn with the Line tool, the two later ones attached where the first ends (${JSON.stringify(segs)})`);
  const net = await dw.evaluate(async () => {
    const { totals, lineTrace } = await import('./draw/lines.js');
    const doc = drawing.doc, len = (i) => lineTrace(doc, doc.lines[i]).length;
    return { all: totals(doc).all.length, want: len(0) + len(1) + len(2) };
  });
  check(Math.abs(net.all - net.want) < 1e-6, `drawing: the total, each line once (${(net.all / 1000).toFixed(2)} km)`);
  // the point moved: the lines attached to it follow
  const follows = await dw.evaluate(async () => {
    const { linkFrom } = await import('./draw/document.js'), tie = (s, i) => linkFrom(drawing.doc, s.id, i < 0 ? s.points.length + i : i)?.to.element ?? null;
    const p = drawing.doc.points[0];
    drawing.change((doc) => { doc.points[0].position = [p.position[0] + 0.01, p.position[1]]; });
    const at = drawing.doc.points[0].position;
    return drawing.doc.lines.every((s) => [0, -1].every((i) => !tie(s, i) || s.points.at(i).join() === at.join()));
  });
  check(follows, 'drawing: a point moved, the lines attached to it follow');
  // Offset: a line drawn beside its geometry by MapLibre, set in pixels; its length stays real. A copy
  // of the first line, the two selected: the field sets both
  await dw.evaluate(() => drawing.change((doc) => { // its links too
    doc.lines.push({ ...structuredClone(doc.lines[0]), id: 'copy1', name: 'Line 4' });
    doc.links.push(...doc.links.filter((l) => l.from[0] === doc.lines[0].id).map((l) => ({ from: ['copy1', l.from[1]], to: { ...l.to } })));
  }));
  const before = await dw.evaluate(() => drawing.offset().length);
  await dw.evaluate(() => drawing.select([drawing.doc.lines[0].id, 'copy1']));
  const offField = dw.locator('.dinspect input[aria-label="Offset (px)"]');
  await offField.fill('-8');
  await offField.press('Enter');
  await settled(dw);
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
  check(featuresOf(back, 'line').length === 4 && featuresOf(back, 'point').length === 1 && back.charts.groups.length === 1 && new Set(back.charts.links.map((l) => l.from[0])).size === 4 && back.charts.links.every((l) => l.to.element === featuresOf(back, 'point')[0].id),
    'drawing: exported whole, the lines\' ends attached to the point');
});

await section('the rules: Distribute along, Connect', async () => {
  // points along a line, one step; then connected to one root (the distribution's group's Connect…),
  // another: each undone at once
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
  const previewed = [await dw.evaluate(() => drawing.previewPts?.length ?? 0)];
  await dw.click('.dinspect button.done:has-text("Create")');
  const distributed = await dw.evaluate(() => [drawing.undos.length, drawing.selected()[0]?.kind, drawing.doc.rules.length]);
  await dw.click('.dinspect button:has-text("Connect…")'); // the group's: its copies
  await dw.mouse.click(DX + 420, 700); // the circle's centre: a root (a click on a point uses it)
  const mb = dw.locator('input[aria-label="Shortest branch"]'); // Tree: each branch at least this long
  await mb.fill('300 m');
  await mb.press('Enter');
  previewed.push(await dw.evaluate(() => drawing.previewLines?.length ?? 0));
  await dw.click('.dinspect button.done:has-text("Connect")');
  const gen = await dw.evaluate(async () => {
    const { linkFrom } = await import('./draw/document.js'), tie = (s, i) => linkFrom(drawing.doc, s.id, i < 0 ? s.points.length + i : i)?.to.element ?? null;
    const rules = (k) => drawing.doc.rules.filter((r) => r.kind === k), a = rules('distribute')[0], c = rules('connect')[0];
    // what each line the connection made is, from its ends: a trunk at a root, else a branch
    const roots = new Set(c?.roots.map((r) => r.id)), made = drawing.doc.lines.filter((s) => c?.created.includes(s.id));
    const ofPart = (v) => made.filter((s) => (roots.has(tie(s, 0)) || roots.has(tie(s, -1))) === (v === 'trunk')), part = (v) => ofPart(v).length;
    const names = (gid) => drawing.doc.groups.filter((g) => g.groupId === gid).map((g) => g.name).sort().join();
    return { a: rules('distribute').length, n: a?.points.length, c: rules('connect').length, subgroups: a && names(a.groupId), inCircles: a && a.points.every((x) => drawing.doc.points.find((q) => q.id === x.pointId).groupId === a.copiesId), trunks: part('trunk'), branches: part('branch'),
      attached: drawing.doc.lines.filter((s) => tie(s, 0) && tie(s, -1)).length, undos: drawing.undos.length, group: drawing.selected()[0]?.kind,
      // the branches' shortest (m, near enough at this scale), the hubs: one of its own per trunk
      shortest: Math.min(...ofPart('branch').map((s) => {
        const [a, b] = [s.points[0], s.points.at(-1)], k = Math.cos((a[1] * Math.PI) / 180);
        return 111320 * Math.hypot((b[0] - a[0]) * k, b[1] - a[1]);
      })), hubs: c?.hubs.length, minBranch: c?.minBranch };
  });
  await dw.locator('.dinsphead .ititle').click();
  await dw.keyboard.press('Control+z');
  const connUndone = await dw.evaluate(() => drawing.doc.rules.map((r) => r.kind).join());
  await dw.keyboard.press('Control+z');
  const genUndone = await dw.evaluate(() => [drawing.doc.rules.filter((r) => r.kind === 'connect').length, drawing.doc.lines.length, drawing.doc.rules.filter((r) => r.kind === 'distribute').length]);
  check(previewed[0] === gen.n && previewed[1] > 0, `drawing: Distribute along previews its points, Connect its lines, before making them (${previewed})`);
  check(distributed.join() === `${beforeGen[1] + 1},group,1` && gen.a === 1 && gen.n > 1 && gen.c === 1 && gen.trunks > 0 && gen.branches > 0 && gen.attached >= gen.trunks + gen.branches
    && gen.undos === beforeGen[1] + 2 && gen.group === 'group' && connUndone === 'distribute' && genUndone.join() === `0,${beforeGen[0]},0`,
  `drawing: Distribute along, then Connect… on its group, one undo step each, the group selected (${gen.n} points, ${gen.trunks} + ${gen.branches} lines)`);
  check(gen.subgroups === 'Connection,Copies' && gen.inCircles, `rules: Distribute along's own group holds Copies and Connection (${gen.subgroups})`);
  check(gen.minBranch === 300 && gen.shortest >= 297 && gen.hubs === gen.trunks && gen.branches === gen.n,
    `drawing: Tree, a hub of its own per trunk, a branch to every point, each at least the 300 m set (${Math.round(gen.shortest)} m)`);
  // points round a circle: a circle's inspector offers them; they follow it when it grows
  const arcOf = await dw.evaluate(() => { const x = drawing.doc.circles.at(-1); drawing.select([x.id]); return x.id; });
  await dw.click('.dinspect button:has-text("Distribute along…")');
  await dw.click('.dinspect [aria-label="Points by"] button:has-text("Count")');
  const gcount = dw.locator('input[aria-label=Count]');
  await gcount.fill('6');
  await gcount.press('Enter');
  await dw.click('.dinspect button.done:has-text("Create")');
  const onArc = await dw.evaluate(async (id) => {
    const { inverse } = await import('./geodesy.js');
    const a = drawing.doc.rules.find((x) => x.kind === 'distribute' && x.along.element === id);
    drawing.change((doc) => { doc.circles.find((x) => x.id === id).radius *= 2; });
    const c2 = drawing.doc.circles.find((x) => x.id === id), r = c2.radius;
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
});

await section('dragging, shapes, attaching', async () => {
  // dragging: a selected circle's radius handle, one undo step; Esc during a drag puts it back
  await dw.keyboard.press('Escape');
  await dw.evaluate(() => { drawing.stop(); drawing.variant.shape = 'circle'; }); // a circle, whatever was on
  await dw.keyboard.press('s');
  await dw.mouse.click(DX + 640, 300);
  await dw.mouse.click(DX + 640, 300); // its centre again: the default size
  await dw.keyboard.press('Escape');
  await dw.evaluate(() => drawing.select([drawing.doc.circles.at(-1).id])); // the circle alone, as a second click selects it
  await settled(dw); // its handles drawn: the drag below starts on one
  const nd = await dw.evaluate(async () => { const { destination } = await import('./geodesy.js'); const x = drawing.doc.circles.at(-1); const q = map.project(destination(x.position, 0, x.radius)); return { r: x.radius, x: q.x, y: q.y, undos: drawing.undos.length }; });
  await dw.mouse.move(nd.x, nd.y);
  await dw.mouse.down();
  await dw.mouse.move(nd.x, nd.y - 30, { steps: 5 });
  await frames(dw); // the drag's last move applied (on the next frame: draw/drawing.js)
  await dw.mouse.up();
  const dragged = await dw.evaluate(() => [drawing.doc.circles.at(-1).radius, drawing.undos.length]);
  await dw.mouse.move(nd.x, nd.y - 30);
  await dw.mouse.down();
  await dw.mouse.move(nd.x, nd.y - 90, { steps: 5 });
  await dw.keyboard.press('Escape');
  await dw.mouse.up();
  const kept = await dw.evaluate(() => drawing.doc.circles.at(-1).radius);
  check(dragged[0] > nd.r * 1.1 && dragged[1] === nd.undos + 1 && kept === dragged[0], `drawing: a radius dragged (${Math.round(nd.r)} → ${Math.round(dragged[0])} m), one undo step; Esc puts a drag back`);
  // a rectangle by the Shape tool: a point holding a closed line of four places, the preset it was
  // placed from remembered; the point's Bearing typed turns its rectangle about it
  await dw.evaluate(() => { drawing.stop(); drawing.variant.shape = 'rectangle'; });
  await dw.keyboard.press('s');
  await dw.mouse.click(DX + 300, 200);
  await dw.mouse.click(DX + 300, 200); // its centre again: the default size
  await dw.keyboard.press('Escape');
  const ringOf = () => dw.evaluate(async () => { const { inverse } = await import('./geodesy.js'); const x = drawing.doc.points.at(-1), r = drawing.doc.lines.find((l) => l.groupId === x.id);
    return { sel: drawing.sel.has(x.id), n: r?.points.length, closed: r?.closed, preset: x.properties.find((q) => q.key === 'preset')?.value, azi: inverse(x.position, r.points[0]).azi, s: inverse(x.position, r.points[0]).s,
      drawn: map.querySourceFeatures('drawzoom').some((f) => f.properties.id === r.id && f.properties.kind === 'path') }; });
  await settled(dw);
  const rect = await ringOf();
  const turnTo = dw.locator('.dinspect input[aria-label^=Bearing]');
  await turnTo.fill('45');
  await turnTo.press('Enter');
  const turned = await ringOf();
  check(rect.sel && rect.n === 4 && rect.closed && rect.preset === 'Rectangle' && rect.drawn && Math.abs(turned.azi - rect.azi - 45) < 1e-6 && Math.abs(turned.s - rect.s) < 1e-6,
    `shapes: the Shape tool's rectangle a point holding a closed line, drawn; the point turned, its rectangle with it (${JSON.stringify(rect)}; ${turned.azi.toFixed(2)}°)`);
  await dw.locator('.dinsphead .ititle').click(); // out of the field: the keys are the drawing's
  // a rectangle corner to corner: its box from the first click to the second, facing north; Shift: a
  // square, the larger side
  await dw.evaluate(() => { drawing.stop(); drawing.variant.shape = 'rectangle'; });
  await dw.keyboard.press('s');
  await dw.mouse.click(DX + 300, 460);
  await dw.mouse.move(DX + 380, 500, { steps: 3 });
  await dw.mouse.click(DX + 380, 500);
  const boxOf = (a, b) => dw.evaluate(async ([a, b]) => { const { inverse } = await import('./geodesy.js'); const x = drawing.doc.points.at(-1), ps = drawing.doc.lines.find((l) => l.groupId === x.id).points, p = map.unproject(a), q = map.unproject(b), c = map.project(x.position);
    return [x.bearing, +inverse(ps[0], ps[1]).s.toFixed(3), +inverse(ps[1], ps[2]).s.toFixed(3), inverse([p.lng, p.lat], [p.lng, q.lat]).s, inverse([p.lng, p.lat], [q.lng, p.lat]).s, Math.round(c.x), Math.round(c.y)]; }, [a, b]);
  const sized = await boxOf([DX + 300, 460], [DX + 380, 500]);
  await dw.mouse.click(DX + 300, 560);
  await dw.keyboard.down('Shift');
  await dw.mouse.click(DX + 380, 600);
  await dw.keyboard.up('Shift');
  const square = await boxOf([DX + 300, 560], [DX + 380, 600]);
  check(sized[0] === 0 && Math.abs(sized[1] - sized[3]) < 2 && Math.abs(sized[2] - sized[4]) < 2 && Math.abs(sized[5] - DX - 340) <= 1 && Math.abs(sized[6] - 480) <= 1 && square[1] === square[2] && Math.abs(square[1] - square[4]) < 2,
    `shapes: a rectangle corner to corner, facing north, centred between them; Shift a square (${sized.map((v) => Math.round(v))}; ${square.slice(1, 3).map(Math.round)})`);
  // a line closed by a click on its first point (a closed line, "Area n", filled); a sector in three clicks
  await dw.keyboard.press('Escape');
  await dw.evaluate(() => drawing.stop());
  await dw.keyboard.press('g');
  const ringsBefore = await dw.evaluate(() => drawing.doc.lines.filter((x) => x.closed).length);
  for (const [x, y] of [[450, 450], [520, 450], [500, 520], [451, 451]]) await dw.mouse.click(DX + x, y);
  await settled(dw);
  const closed = await dw.evaluate(() => { const g = drawing.doc.lines.at(-1); return [drawing.doc.lines.filter((x) => x.closed).length, g.closed && g.points.length, !!drawing.draft, g.name.split(' ')[0],
    map.querySourceFeatures('draw').some((f) => f.properties.id === g.id && f.properties.kind === 'polygon')]; });
  await dw.keyboard.press('Escape');
  await dw.evaluate(() => { drawing.variant.shape = 'sector'; });
  await dw.keyboard.press('s');
  for (const [x, y] of [[600, 450], [600, 400], [650, 450]]) await dw.mouse.click(DX + x, y);
  await settled(dw);
  const sec = await dw.evaluate(() => { const x = drawing.doc.points.at(-1), c = drawing.doc.circles.filter((q) => q.groupId === x.id); return [c.map((q) => Math.round(q.aperture)).join(), x.name.split(' ')[0],
    map.querySourceFeatures('draw').filter((f) => f.properties.id === c[0]?.id && f.properties.kind === 'ring').map((f) => f.geometry.type)[0]]; });
  await dw.keyboard.press('Escape');
  check(closed.join() === `${ringsBefore + 1},3,false,Area,true` && sec[0] === '90' && sec[1] === 'Sector' && sec[2] === 'Polygon',
    `shapes: a line closed on its first point, filled (${closed}); a sector in three clicks (${sec})`);
  await dw.evaluate(() => drawing.remove([drawing.doc.points.at(-1).id, drawing.doc.lines.at(-1).id])); // the checks after these find the drawing as it was
  await dw.keyboard.press('Escape');
  await dw.keyboard.press('Escape');
  // attaching: a line drawn to a shape's corner ends attached there, and follows it when its point turns
  const sc = await dw.evaluate(async () => {
    const { build } = await import('./draw/place.js');
    let x, r;
    drawing.change((d) => { const c = map.unproject([500, 500]); x = build(d, [c.lng, c.lat], 'rectangle', 0, { size: [3000, 2000] }); r = d.lines.find((l) => l.groupId === x.id); });
    const q = map.project(r.points[0]);
    return { id: r.id, pid: x.id, x: q.x, y: q.y };
  });
  await dw.keyboard.press('Escape');
  await dw.keyboard.press('g');
  await dw.mouse.click(sc.x - 150, sc.y - 60);
  await dw.mouse.click(sc.x + 3, sc.y + 2); // within the snapping radius of the corner: snapped there
  await dw.keyboard.press('Enter'); // ended there, attached
  await dw.keyboard.press('Escape');
  const att = await dw.evaluate(async (pid) => {
    const { linkFrom, carry } = await import('./draw/document.js'), s = drawing.doc.lines.at(-1), before = [...s.points[1]];
    drawing.change((d) => { const p = d.points.find((q) => q.id === pid); carry(d, p, p.position, 30); });
    const to = linkFrom(drawing.doc, s.id, 1)?.to;
    return [to?.element, to?.vertex, before.join() !== drawing.doc.lines.at(-1).points[1].join()];
  }, sc.pid);
  check(att[0] === sc.id && att[1] === 0 && att[2], `attaching: a line drawn to a shape's corner is attached to it, and follows it when the shape turns (${JSON.stringify(att)})`);
  // a line drawn onto another line's leg: its end attached along the leg (an edge, no vertex added);
  // then moved by its inspector's Attach to… onto the shape's corner
  const host = await dw.evaluate(async () => {
    const { addLine } = await import('./draw/document.js'), at = (x, y) => { const c = map.unproject([x, y]); return [c.lng, c.lat]; };
    let s;
    drawing.change((d) => { s = addLine(d, [at(250, 200), at(550, 200)]); });
    return { id: s.id, n: s.points.length, x: 400, y: 200 };
  });
  await settled(dw); // drawn: what snapping looks for is on the map
  await dw.keyboard.press('g');
  await dw.mouse.click(host.x, host.y + 120);
  await dw.mouse.click(host.x, host.y);
  await dw.keyboard.press('Enter');
  await dw.keyboard.press('Escape');
  const onLeg = await dw.evaluate(async (h) => { const { linkFrom } = await import('./draw/document.js'), s = drawing.doc.lines.at(-1); return { end: linkFrom(drawing.doc, s.id, 1)?.to ?? {}, n: drawing.doc.lines.find((x) => x.id === h.id).points.length, id: s.id }; }, host);
  check(onLeg.end.element === host.id && onLeg.end.edge === 0 && onLeg.end.at > 0.2 && onLeg.end.at < 0.8 && onLeg.n === host.n,
    `attaching: a line's end on another line's leg, along it, no vertex added (${JSON.stringify(onLeg.end)})`);
  await dw.evaluate((id) => drawing.select([id]), onLeg.id);
  await dw.click('.dinspect [data-grid*=":points"] tbody tr[data-r]:last-child td:first-child'); // its end's row: Attach to… over the table
  await dw.click('.dinspect .lbar button[aria-label="Attach point 2 to…"]');
  const corner = await dw.evaluate((id) => { const q = map.project(drawing.doc.lines.find((x) => x.id === id).points[2]); return [q.x, q.y]; }, sc.id);
  await dw.mouse.click(corner[0] + 2, corner[1] + 2);
  const moved2 = await dw.evaluate(async (id) => { const { linkFrom } = await import('./draw/document.js'); return linkFrom(drawing.doc, id, 1)?.to ?? {}; }, onLeg.id);
  check(moved2.element === sc.id && moved2.vertex === 2, `attaching: Attach to… moves a line's end onto a shape's corner (${JSON.stringify(moved2)})`);
  // any place of a line: its middle one attached to a point by its row's Attach to…, then following
  // the point dragged on the map
  const mid = await dw.evaluate(async () => {
    const { addLine, addPoint } = await import('./draw/document.js'), at = (x, y) => { const c = map.unproject([x, y]); return [c.lng, c.lat]; };
    let s, p;
    drawing.change((d) => { s = addLine(d, [at(250, 300), at(350, 320), at(450, 300)]); p = addPoint(d, at(350, 420), { symbol: 'square' }); });
    drawing.select([s.id]);
    const q = map.project(p.position), r = map.getCanvasContainer().getBoundingClientRect();
    return { id: s.id, pid: p.id, x: r.left + q.x, y: r.top + q.y };
  });
  await settled(dw);
  await dw.click('.dinspect [data-grid*=":points"] tbody tr[data-r="1"] td:first-child');
  await dw.click('.dinspect .lbar button[aria-label="Attach point 2 to…"]');
  await dw.mouse.click(mid.x, mid.y);
  const tiedMid = await dw.evaluate(async (m) => { const { linkFrom } = await import('./draw/document.js'); return linkFrom(drawing.doc, m.id, 1)?.to.element === m.pid && drawing.doc.lines.find((x) => x.id === m.id).points[1].join() === drawing.doc.points.find((x) => x.id === m.pid).position.join(); }, mid);
  await dw.evaluate((id) => drawing.select([id]), mid.pid);
  await settled(dw);
  await dw.mouse.move(mid.x, mid.y);
  await dw.mouse.down();
  await dw.mouse.move(mid.x + 80, mid.y + 30, { steps: 5 });
  await frames(dw);
  await dw.mouse.up();
  const followed = await dw.evaluate((m) => { const p = drawing.doc.points.find((x) => x.id === m.pid).position, s = drawing.doc.lines.find((x) => x.id === m.id); const q = map.project(p); return [s.points[1].join() === p.join(), Math.round(q.x), s.points[0].join() !== p.join()]; }, mid);
  check(tiedMid && followed[0] && followed[2], `attaching: a line's middle place attached to a point by its row's Attach to…, following the point dragged (${tiedMid}, ${followed})`);
  await dw.keyboard.press('Escape');
  await dw.evaluate((ids) => drawing.remove(ids), [sc.pid, mid.id, mid.pid]); // the shape's point: its shape with it
});

await section('labels, names, data and totals', async () => {
  // labels: one on the point, its text typed; drawn; its text dragged; names on the map; the point
  // deleted, the label stays where it pointed
  const nid = await dw.evaluate(() => drawing.doc.points.filter((x) => x.name.startsWith('Circle')).at(-1).id);
  await dw.keyboard.press('t');
  await dw.mouse.click(DX + 640, 300);
  await dw.keyboard.type('Hi {name}');
  await dw.locator('.dinsphead .ititle').click();
  await dw.keyboard.press('Escape'); // the tool off; the label stays selected
  // drawn once its glyphs have loaded and it has been placed: a fixed wait was sometimes too short
  await dw.waitForFunction(() => map.queryRenderedFeatures({ layers: ['draw-label-text'] }).length > 0, null, { timeout: 5000 }).catch(() => {});
  const lab = await dw.evaluate((id) => { const a = drawing.doc.labels[0], p = drawing.doc.points.find((x) => x.id === id); const q = map.project(p.position); return { a, point: p.position, x: q.x + a.offset[0], y: q.y + a.offset[1], undos: drawing.undos.length, drawn: map.queryRenderedFeatures({ layers: ['draw-label-text'] }).map((f) => f.properties.text), leader: map.queryRenderedFeatures({ layers: ['draw-leader'] }).length }; }, nid);
  const labTo = await dw.evaluate(async () => { const { linkFrom } = await import('./draw/document.js'); return linkFrom(drawing.doc, drawing.doc.labels[0].id)?.to.element; });
  check(labTo === nid && lab.a.text === 'Hi {name}' && lab.drawn.some((t) => /^Hi Circle \d+$/.test(t)) && lab.leader === 1,
    `labels: placed on a point with the Label tool, its text typed, drawn with its name and a leader (${lab.drawn.join(', ')})`);
  await dw.mouse.move(lab.x, lab.y);
  await dw.mouse.down();
  await dw.mouse.move(lab.x + 60, lab.y + 10, { steps: 5 });
  await frames(dw);
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
  await until(() => map.queryRenderedFeatures({ layers: ['draw-name-point'] }).length > 0);
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
  const pointed = await dw.evaluate(() => drawing.doc.labels[0].position);
  await dw.evaluate((id) => drawing.remove([id]), nid);
  const freed = await dw.evaluate(() => [drawing.doc.links.some((l) => l.from[0] === drawing.doc.labels[0]?.id), drawing.doc.labels[0]?.position]);
  check(!freed[0] && freed[1]?.[0] === pointed[0] && freed[1][1] === pointed[1], 'labels: the point deleted, its label stays, free, where it pointed');
});

await section('legs typed, list grids', async () => {
  // legs typed after drawing: the leg to a line's point 2 set to 1 km at 090°, that point alone moved
  // (its end where it was); the leg to a closed line's point 2 set to 500 m, that point alone moved
  const legIds = await dw.evaluate(async () => {
    const { addLine } = await import('./draw/document.js');
    let l, a;
    drawing.change((d) => { l = addLine(d, [[13, 41], [13.02, 41.01], [13.04, 41]]); a = addLine(d, [[13, 40.5], [13.01, 40.5], [13.01, 40.51]], { closed: true }); });
    return [l.id, a.id];
  });
  await dw.evaluate((id) => drawing.select([id]), legIds[0]);
  const typeIn = async (aria, v) => { const f = dw.locator(`.dinspect input[aria-label="${aria}"]`); await f.fill(v); await f.press('Enter'); };
  const endAt = () => dw.evaluate((id) => drawing.doc.lines.find((x) => x.id === id).points.at(-1).join(), legIds[0]);
  const endBefore = await endAt();
  await typeIn('Point 2 leg length', '1 km');
  await typeIn('Point 2 leg bearing (degrees true)', '90');
  const leg1 = await dw.evaluate(async (id) => { const { inverse } = await import('./geodesy.js'); const l = drawing.doc.lines.find((x) => x.id === id); const g = inverse(l.points[0], l.points[1]); return [Math.round(g.s), Math.round(g.azi)]; }, legIds[0]);
  const endAfter = await endAt();
  await dw.evaluate((id) => drawing.select([id]), legIds[1]);
  await typeIn('Point 2 leg length', '500 m');
  const edge = await dw.evaluate(async (id) => { const { inverse } = await import('./geodesy.js'); const a = drawing.doc.lines.find((x) => x.id === id); return [Math.round(inverse(a.points[0], a.points[1]).s), a.points[2].join()]; }, legIds[1]);
  // its values: area and perimeter, no length; Closed unticked, it is an open line again (its length)
  const rows = () => dw.evaluate(() => [...document.querySelectorAll('.dinspect .flabel')].map((x) => x.textContent).filter((t) => ['Length', 'Area', 'Perimeter'].includes(t)).join());
  const ringRows = await rows();
  await dw.locator('.dinspect input[aria-label="Closed"]').click();
  const opened = [await dw.evaluate((id) => drawing.doc.lines.find((x) => x.id === id).closed, legIds[1]), await rows()];
  await dw.evaluate(() => drawing.undo());
  check(ringRows === 'Area,Perimeter' && opened.join() === 'false,Length', `a closed line's values, area and perimeter; Closed unticked, open (${ringRows}; ${opened})`);
  check(leg1.join() === '1000,90' && endAfter === endBefore && edge[0] === 500 && edge[1] === '13.01,40.51',
    `legs typed after drawing: the leg to a line's point (${leg1}), that point alone moved (its end ${endAfter}); a closed line's (${edge[0]}), point 3 where it was`);
  // the points' table as a list grid: ↓ goes to the same column in the next row; the bar over it acts
  // on the current row (its vertex deleted)
  await dw.evaluate((id) => drawing.select([id]), legIds[0]);
  await dw.locator('.dinspect input[aria-label="Point 2 leg length"]').focus();
  await dw.keyboard.press('ArrowDown');
  await frames(dw); // focus moves on the next frame, to the grid as built again (draw/grid.js)
  const movedTo = await dw.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await dw.locator('.dinspect input[aria-label="Point 2 latitude"]').focus();
  await dw.click('.dinspect .lbar button:has-text("Delete")');
  const vertsLeft = await dw.evaluate((id) => drawing.doc.lines.find((x) => x.id === id).points.length - 2, legIds[0]);
  check(movedTo === 'Point 3 leg length' && vertsLeft === 0, `list grids: ↓ to the next row (${movedTo}); the row's bar deletes its vertex (${vertsLeft} left)`);
  // a list's Copy: its rows, tab-separated, a header first
  await dw.evaluate((id) => drawing.select([id]), legIds[0]);
  await dw.click('.dinspect .fblock:has(h3:has-text("Points")) button:has-text("Copy")');
  const copied = await dw.evaluate(() => navigator.clipboard.readText());
  check(/^#\tLat\tLon/.test(copied) && /\n1\t/.test(copied) && copied.trim().split('\n').length === 3, `a list's Copy gives its rows, numbered from 1 (${copied.split('\n')[1]})`);
});

await section('paging, Properties in place', async () => {
  // a long line's table a page at a time: 100 rows built, not 502; ‹ › move by a page. A row clicked
  // ringed on the map; a point pressed on the map: its row picked, on its page
  const longId = await dw.evaluate(async () => {
    const { addLine } = await import('./draw/document.js');
    let s;
    drawing.change((doc) => { s = addLine(doc, [[12, 40], ...Array.from({ length: 500 }, (_, i) => [12 + (i + 1) / 600, 40 + Math.sin(i / 9) / 200]), [12.9, 40]]); });
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
  const ringed = await dw.evaluate((id) => drawing.placeAt()?.join() === drawing.doc.lines.find((x) => x.id === id).points[204].join(), longId);
  const vAt = await dw.evaluate((id) => { const v = drawing.doc.lines.find((x) => x.id === id).points[350]; map.jumpTo({ center: v, zoom: 15 }); return v; }, longId);
  await settled(dw);
  const vPx = await dw.evaluate((v) => { const q = map.project(v), r = map.getCanvasContainer().getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; }, vAt);
  await dw.mouse.move(vPx[0], vPx[1]);
  await dw.mouse.down();
  await dw.mouse.up();
  await until(() => document.querySelector('.dinspect .lbar .funit')?.textContent === 'Point 351:');
  const pickedRow = await dw.evaluate(() => [document.querySelector('.dinspect .lbar .funit')?.textContent, document.querySelector('.dinspect .lpager .funit').textContent, document.querySelector('.dinspect tr.cur td')?.textContent]);
  await dw.click('.dinspect .lbar button:has-text("Delete")'); // the row picked from the map, not the one current before
  const deleted = await dw.evaluate(([id, v]) => { const x = drawing.doc.lines.find((l) => l.id === id); return [x.points.length - 2, x.points.some((q) => q.join() === v.join())]; }, [longId, vAt]);
  check(pageThree === '201–300 of 502' && ringed && pickedRow.join() === 'Point 351:,301–400 of 502,351' && deleted.join() === '499,false',
    `points: › twice (${pageThree}); a row clicked is ringed on the map (${ringed}); a point pressed on the map picks its row, on its page (${pickedRow}); its bar's Delete takes that point (${deleted})`);
  await dw.evaluate((id) => drawing.remove([id]), longId);
  // Properties updated in place (dom.js morph): Tab, or a click into another field, from a field just
  // applied lands there; the same in a list
  const fl = await dw.evaluate(async () => { const { addLine } = await import('./draw/document.js'); let l; drawing.change((d) => { l = addLine(d, [[12.0, 40.3], [12.05, 40.32], [12.1, 40.3]]); }); drawing.select([l.id]); return l.id; });
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
  const fctx = await offline({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const fp = await open('#v=11/40.2/12.1/0&on=chart,coastline', fctx);
  const shown = () => fp.evaluate(() => [!document.querySelector('#side').hidden, !document.querySelector('#props').hidden]);
  const atStart = await shown();
  const dock = await fp.evaluate(() => [...document.querySelectorAll('#dock > button')].filter((b) => b.offsetParent).map((b) => b.getAttribute('aria-label') || b.textContent).join());
  await fp.click('#dock [data-tool=shape]');
  await fp.evaluate(() => drawing.setVariant('shape', 'circle')); // the tool stays on
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
  // Box select in the dock, then a finger dragged: a box, what lies inside selected
  await fp.click('#dock button[aria-label="Box select"]');
  const boxed = await fp.evaluate(async () => {
    const box = map.getCanvasContainer(), r = box.getBoundingClientRect(), q = drawing.doc.points.map((x) => map.project(x.position));
    const [x0, y0] = [Math.min(...q.map((p) => p.x)) - 40, Math.min(...q.map((p) => p.y)) - 40], [x1, y1] = [Math.max(...q.map((p) => p.x)) + 40, Math.max(...q.map((p) => p.y)) + 40];
    const ev = (type, x, y) => new PointerEvent(type, { pointerId: 7, bubbles: true, button: 0, clientX: r.left + x, clientY: r.top + y, pointerType: 'touch' });
    box.dispatchEvent(ev('pointerdown', x0, y0));
    window.dispatchEvent(ev('pointermove', (x0 + x1) / 2, (y0 + y1) / 2));
    window.dispatchEvent(ev('pointermove', x1, y1));
    window.dispatchEvent(ev('pointerup', x1, y1));
    return drawing.sel.size;
  });
  await fp.evaluate(() => drawing.select([]));
  const handles = await fp.evaluate(() => map.getLayoutProperty('draw-handle', 'icon-size'));
  await fp.evaluate(() => drawing.select([drawing.doc.circles[0].id]));
  // a drag of the radius handle, then a second finger: everything back
  const rBefore = await fp.evaluate(() => drawing.doc.circles[0].radius);
  await fp.evaluate(async () => {
    const { destination } = await import('./geodesy.js');
    const x = drawing.doc.circles[0], q = map.project(destination(x.position, 0, x.radius)), box = map.getCanvasContainer(), r = box.getBoundingClientRect();
    const ev = (type, id, dy = 0) => new PointerEvent(type, { pointerId: id, bubbles: true, button: 0, clientX: r.left + q.x, clientY: r.top + q.y - dy, pointerType: 'touch' });
    box.dispatchEvent(ev('pointerdown', 1));
    window.dispatchEvent(ev('pointermove', 1, 20));
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    box.dispatchEvent(ev('pointerdown', 2)); // a second finger
    window.dispatchEvent(ev('pointerup', 1));
  });
  const after = await fp.evaluate(() => [drawing.doc.circles[0].radius, !!drawing.drag]);
  check(atStart.join() === 'false,false' && dock === 'Undo,Redo,Box select,Point,Line,Shape,Label,Measure' && placed === 1 && drawingDock === 'Back,Undo,Redo,Shape' && undone === 0 && redone === 1 && afterBack === null,
    `finger: the sheet closed to start with; the dock Undo, Redo and the tools (${dock}); a circle placed by two taps, the dock then ${drawingDock}; Undo, Redo (${undone}, ${redone}); Back ends the tool (${atStart}; ${placed}; ${afterBack})`);
  check(peek[0] && peek[1] && peek[2] < 120 && colOpen.join() === 'true,false' && propsOpen.join() === 'false,true,false' && boxed === 2,
    `finger: what is selected peeks (${peek}); Elements in its place (${colOpen}); the peek tapped: Properties (${propsOpen}); Box select then a drag selects ${boxed} (a point and its circle)`);
  check(handles === 1.75 && after[0] === rBefore && !after[1], `finger: handles drawn larger (${handles}); a second finger during a drag puts it back (${rBefore} → ${after[0]})`);
  check(!fp.errors.length, `finger: no errors ${fp.errors.join(' | ')}`);
  await fctx.close();
});

await finish();
