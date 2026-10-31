#!/usr/bin/env node
// Layout check: at phone, tablet and desktop width, with Layers closed and open and the drawing's views,
//  - no two overlays overlap, except under the bar or a panel (which must then be on top);
//  - nothing on screen leaves the viewport;
//  - every visible control is a ≥ 44 × 44 px target (labels count for their checkbox).
//   CHROME=/path/to/chrome npm run ui        Screenshots go to $UI_SHOTS if set.
import { start, frames } from './browser.mjs';

// phone and tablet are touch devices (pointer: coarse, 44 px targets); desktop has a mouse (36 px; 24
// in the panels, 28 (32 drawn) in the bar, 32 in the map's controls and the search bar)
const VIEWPORTS = [['phone', 390, 844, true], ['tablet', 820, 1180, true], ['desktop', 1280, 800, false]];
// overlays that must not collide (screen-space boxes of floating UI)
const OVERLAYS = {
  search: '#search', controls: '#mapctl', legend: '#legends', touch: '.touchbar', note: '.dnote', status: '#status', bar: '#bar', dock: '#dock', side: '#side', props: '#props',
};

// a drawing as the app saves it (GeoJSON, version 1): a point with two sectors, a rectangle, a line
// from and back to the point, a label along the line
const DRAWING = JSON.stringify({ type: 'FeatureCollection', charts: { format: 'charts-drawing', version: 1 }, features: [
  { type: 'Feature', id: 'n1', geometry: { type: 'Point', coordinates: [14, 44.5] }, properties: { name: 'Point 1', key: 'value',
    charts: { kind: 'point', bearing: 45, parts: [{ kind: 'sector', radius: 20000, aperture: 90 }, { kind: 'sector', radius: 40000, aperture: 90, fill: false }] } } },
  { type: 'Feature', id: 's1', geometry: { type: 'Point', coordinates: [13, 44] }, properties: { name: 'Rectangle 1',
    charts: { kind: 'point', bearing: 30, parts: [{ kind: 'rectangle', length: 30000, width: 10000 }] } } },
  { type: 'Feature', id: 'g1', geometry: { type: 'LineString', coordinates: [[14, 44.5], [14.5, 44.2], [14.2, 43.9], [14, 44.5]] }, properties: { name: 'Line 1',
    charts: { kind: 'line', start: 'n1', end: 'n1', vertices: [{ name: 'a point' }, {}] } } },
  { type: 'Feature', id: 'l1', geometry: { type: 'Point', coordinates: [14.2, 44.4] }, properties: { name: 'Label 1',
    charts: { kind: 'label', text: '{name}\n{along}', anchor: { element: 'g1', edge: 0, at: 0.4 }, look: { text: { background: 'box' } } } } }] });
// put where the app keeps its drawings (draw/saving.js): the list, the one open, its text
const SEED = (d) => { localStorage.setItem('charts.drawings', JSON.stringify([{ id: 'ui', title: '', modified: '2026-10-24T00:00:00Z', size: d.length }])); localStorage.setItem('charts.drawings.current', 'ui'); localStorage.setItem('charts.drawing.ui', d); };

const { browser, base, check, section, finish } = await start();

for (const [name, width, height, touch] of VIEWPORTS) {
  for (const menu of [0, 1, 'drawing', 'draw', 'line', 'label']) { // the Draw view four times: the drawing's inspector, a node's, a line's, a label's
    await section(`${name} ${width}px, ${menu}`, async () => {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      // the Draw view with a drawing: a node with two parts (its inspector shown) and a shape
      if (typeof menu === 'string') await page.addInitScript(SEED, DRAWING);
      await page.addInitScript(() => localStorage.setItem('charts.groups.open', '["base","sea","data"]')); // the Layers groups open
      // a zoomed-out view (scale note shown), four stacked legends (they once ran over the
      // credits), a measurement
      await page.goto(`${base}#v=5/45/14/0&col=waves:height&arr=currents:surface&on=chart,coastline,depth,isobaths,traffic,legend`);
      await page.waitForFunction(() => window.map?.loaded?.(), null, { timeout: 90000 });
      // 1: the left panel on Layers; else not on Layers (Elements, where a computer opens on Layers)
      const onLayers = await page.locator('#bar .ptab[data-tab=layers]').getAttribute('aria-pressed') === 'true';
      if (menu === 1 && !onLayers) await page.click('#bar .ptab[data-tab=layers]');
      if (menu !== 1 && onLayers) await page.click('#bar .ptab[data-tab=elements]');
      await page.evaluate(async () => { const { addLine } = await import('./draw/document.js'); drawing.change((doc) => addLine(doc, [12, 44], [], [13, 44.5], { name: 'Distance 1', guide: true, look: { text: { values: true } } })); });
      // the left panel (on a phone closed to start with): open on Elements; an element (or the drawing)
      // selected, its properties shown (on a phone in place of the tree)
      if (typeof menu === 'string' && await page.locator('#bar .ptab[data-tab=elements]').getAttribute('aria-pressed') !== 'true') await page.click('#bar .ptab[data-tab=elements]');
      if (menu === 'drawing') await page.click('.droot .dname');
      if (menu === 'draw') await page.click('.dlist .drow .dname');
      if (menu === 'line') await page.click('.dlist .drow:has(.kind[title=Line]) .dname');
      if (menu === 'label') await page.click('.dlist .drow:has(.kind[title=Label]) .dname');
      if (['drawing', 'draw', 'line', 'label'].includes(menu) && await page.locator('#props').isHidden()) await page.keyboard.press('i');
      // the inspector's text: no element printed as text ("[object …]")
      if (typeof menu === 'string') check(!(await page.evaluate(() => document.querySelector('.dinspect').textContent.includes('[object'))), `${name}: the ${menu} inspector shows no "[object …]"`);
      await page.mouse.move(width / 2, height / 2); // shows the cursor readout
      // (only with the map under the pointer: on a phone a panel may cover it)
      await page.waitForFunction(([x, y]) => !document.elementFromPoint(x, y)?.closest('.maplibregl-canvas') || document.querySelector('#pos')?.textContent, [width / 2, height / 2], { timeout: 5000 }).catch(() => {});
      await frames(page); // laid out as shown (the legends are there from the map's load; its tiles do not matter here)
      if (process.env.UI_SHOTS) await page.screenshot({ path: `${process.env.UI_SHOTS}/${name}-${typeof menu === 'string' ? menu : menu ? 'menu' : 'map'}.png` });
      const r = await page.evaluate(({ OVERLAYS }) => {
        // with a mouse 36 px, but 24 in the panels (grids of rows), 28 (32 drawn) in the bar, 32 in the map's controls
        const COARSE = matchMedia('(pointer: coarse)').matches, MIN = COARSE ? 44 : 36, minOf = (el) => (COARSE ? MIN : el.closest('#side, #props') ? 24 : el.closest('#bar') ? 28 : el.closest('#mapctl, #search') ? 32 : MIN);
        const seen = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden' && el.closest('[hidden]') === null; };
        const boxes = {};
        for (const [k, sel] of Object.entries(OVERLAYS)) {
          const el = document.querySelector(sel);
          if (el && seen(el)) boxes[k] = el.getBoundingClientRect().toJSON();
        }
        const overlaps = [], offscreen = [];
        const keys = Object.keys(boxes);
        for (let i = 0; i < keys.length; i++) {
          const a = boxes[keys[i]];
          if (a.left < 0 || a.top < 0 || a.right > innerWidth + 0.5 || a.bottom > innerHeight + 0.5) offscreen.push(keys[i]);
          for (let j = i + 1; j < keys.length; j++) {
            const b = boxes[keys[j]];
            const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (x <= 0.5 || y <= 0.5) continue;
            const pair = [keys[i], keys[j]];
            if (pair.some((k) => ['bar', 'side', 'props', 'note'].includes(k))) { // allowed only if the bar, the panel or the note (centred on the window, a few seconds) is the one on top
              const cx = Math.max(a.left, b.left) + x / 2, cy = Math.max(a.top, b.top) + y / 2;
              if (document.elementFromPoint(cx, cy)?.closest('#bar, #side, #props, .dnote')) continue;
            }
            overlaps.push(`${pair.join(' × ')} ${Math.round(x)}×${Math.round(y)}`);
          }
        }
        // targets: controls, except checkboxes/radios whose label is the target
        const small = [];
        for (const el of document.querySelectorAll('button, select, summary, input, label, [role=button]:not(#scale)')) {
          if (!seen(el) || el.closest('#menu details:not([open]) > ul')) continue;
          if (!COARSE && el.closest('.status')) continue; // the bottom row's chips: text-sized with a mouse, as its links; a finger's 44 px (style.css)
          if (el.matches('input[type=checkbox], input[type=radio]') && (el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`)))) continue;
          if (el.matches('label') && !el.querySelector('input') && !el.htmlFor) continue; // plain text labels
          const b = el.getBoundingClientRect();
          if (b.width < minOf(el) - 0.5 || b.height < minOf(el) - 0.5) {
            small.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} ${Math.round(b.width)}×${Math.round(b.height)}`);
          }
        }
        return { overlaps, offscreen, small: [...new Set(small)], MIN };
      }, { OVERLAYS });
      const where = `${name} ${width}px, ${typeof menu === 'string' ? `Draw view, ${{ drawing: 'the drawing', draw: 'a node', line: 'a line', label: 'a label' }[menu]}` : `menu ${menu ? 'open' : 'closed'}`}`;
      check(!r.overlaps.length, `${where}: no overlapping overlays ${r.overlaps.join(', ')}`);
      check(!r.offscreen.length, `${where}: nothing off screen ${r.offscreen.join(', ')}`);
      check(!r.small.length, `${where}: targets ≥ ${r.MIN} px ${r.small.join(', ')}`);
      await page.close();
    });
  }
}
await finish();
