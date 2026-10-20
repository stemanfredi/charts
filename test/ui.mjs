#!/usr/bin/env node
// Layout check: at phone, tablet and desktop width, with the layers panel closed and open,
//  - no two overlays overlap, except under the panel (which must then be on top);
//  - nothing on screen leaves the viewport;
//  - every visible control is a ≥ 44 × 44 px target (labels count for their checkbox).
//   CHROME=/path/to/chrome npm run ui        Screenshots go to $UI_SHOTS if set.
import { chromium } from 'playwright-core';
import { serve, chromeOptions } from './serve.mjs';

// phone and tablet are touch devices (pointer: coarse, 44 px targets); desktop has a mouse (36 px)
const VIEWPORTS = [['phone', 390, 844, true], ['tablet', 820, 1180, true], ['desktop', 1280, 800, false]];
// overlays that must not collide (screen-space boxes of floating UI)
const OVERLAYS = {
  search: '#search', rail: '#rail', zoom: '#zoom', panel: '#panel', legend: '#legends', status: '#status',
};

const server = await serve();
const browser = await chromium.launch(chromeOptions());
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };

try {
  for (const [name, width, height, touch] of VIEWPORTS) {
    for (const menu of [0, 1]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      // a zoomed-out view (scale note shown), three stacked legends (they once ran over the
      // credits), a measurement
      await page.goto(`${server.url}#v=5/45/14/0&menu=${menu}&g=base,sea,seastate&on=chart,coastline,depth,isobaths,traffic,waves,sst,gibs,legend&m=r:12,44;13,44.5`);
      await page.waitForFunction(() => window.map?.loaded?.(), null, { timeout: 90000 });
      await page.mouse.move(width / 2, height / 2); // shows the cursor readout
      await page.waitForTimeout(800);
      if (process.env.UI_SHOTS) await page.screenshot({ path: `${process.env.UI_SHOTS}/${name}-${menu ? 'menu' : 'map'}.png` });
      const r = await page.evaluate(({ OVERLAYS }) => {
        const MIN = matchMedia('(pointer: coarse)').matches ? 44 : 36;
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
            if (pair.includes('panel')) { // allowed only if the panel is the one on top
              const cx = Math.max(a.left, b.left) + x / 2, cy = Math.max(a.top, b.top) + y / 2;
              if (document.elementFromPoint(cx, cy)?.closest('#panel')) continue;
            }
            overlaps.push(`${pair.join(' × ')} ${Math.round(x)}×${Math.round(y)}`);
          }
        }
        // targets: controls, except checkboxes/radios whose label is the target
        const small = [];
        for (const el of document.querySelectorAll('button, select, summary, input, label')) {
          if (!seen(el) || el.closest('#menu details:not([open]) > ul')) continue;
          if (el.matches('input[type=checkbox], input[type=radio]') && (el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`)))) continue;
          if (el.matches('label') && !el.querySelector('input') && !el.htmlFor) continue; // plain text labels
          const b = el.getBoundingClientRect();
          if (b.width < MIN - 0.5 || b.height < MIN - 0.5) {
            small.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} ${Math.round(b.width)}×${Math.round(b.height)}`);
          }
        }
        return { overlaps, offscreen, small: [...new Set(small)], MIN };
      }, { OVERLAYS });
      const where = `${name} ${width}px, menu ${menu ? 'open' : 'closed'}`;
      check(!r.overlaps.length, `${where}: no overlapping overlays ${r.overlaps.join(', ')}`);
      check(!r.offscreen.length, `${where}: nothing off screen ${r.offscreen.join(', ')}`);
      check(!r.small.length, `${where}: targets ≥ ${r.MIN} px ${r.small.join(', ')}`);
      await page.close();
    }
  }
} catch (err) {
  check(false, `ui check crashed: ${err.message}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
