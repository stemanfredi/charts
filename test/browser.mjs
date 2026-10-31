// What the browser tests share (smoke.mjs, draw.mjs, ui.mjs, tiles-check.mjs): the site served, headless
// Chrome launched, check() that prints and counts, section() that keeps one thrown error from
// skipping everything after it, finish() that closes and exits with the count; and what smoke.mjs and
// draw.mjs both do with a page: open it, wait for the map at rest, export, read a zip.
// A check of what a provider served (check(ok, what, true): a tile, a legend, a place found) fails
// the run only with STRICT=1 (the weekly run, ci.yml): on a push it is said, listed and shown as a
// warning in GitHub Actions, and the deploy is not held up by a provider's bad day.
//   CHROME=/path/to/chrome     the browser (default: /usr/bin/google-chrome)
//   STRICT=1                   a provider's failure fails the run too
import { chromium } from 'playwright-core';
import { serve, chromeOptions } from './serve.mjs';
import { unzip as readZip } from '../site/zip.js';

export async function start() {
  const server = await serve();
  const browser = await chromium.launch(chromeOptions());
  const failures = [], advisories = [], strict = process.env.STRICT === '1';
  const check = (ok, what, provider = false) => {
    console.log(`${ok ? 'ok  ' : provider ? 'FAIL~' : 'FAIL'}  ${what}`);
    if (!ok) (provider ? advisories : failures).push(what);
  };
  // a part of a run on its own: an error thrown in it is one failure, and the next part runs
  const section = async (name, fn) => {
    const had = new Set(browser.contexts().flatMap((c) => [c, ...c.pages()]));
    try { await fn(); } catch (err) {
      const where = err.stack?.split('\n').find((l) => /test\/\w+\.mjs/.test(l))?.trim();
      check(false, `${name} crashed: ${err.message.split('\n').filter((l) => l.trim()).slice(0, 6).map((l) => l.trim()).join(' / ')}${where ? ` (${where})` : ''}`);
      // what it opened and did not close would go on drawing and fetching under the sections after it
      for (const c of browser.contexts()) {
        if (!had.has(c)) { await c.close().catch(() => {}); continue; }
        for (const p of c.pages()) if (!had.has(p)) await p.close().catch(() => {});
      }
    }
  };
  const finish = async () => {
    await browser.close();
    server.close();
    if (advisories.length) {
      console.log(`\n${advisories.length} of what providers served failed (FAIL~)${strict ? '' : ': not held against the page'}:\n  ${advisories.join('\n  ')}`);
      if (process.env.GITHUB_ACTIONS) for (const a of advisories) console.log(`::warning title=Provider::${a.replace(/\n/g, ' ')}`);
    }
    const failed = failures.length + (strict ? advisories.length : 0);
    console.log(failed ? `\n${failed} failed` : `\nall passed${advisories.length ? ' (the page\'s own checks)' : ''}`);
    process.exit(failed ? 1 : 0);
  };
  return { server, browser, base: server.url, check, section, finish };
}

// the map at rest: its next 'idle' (a frame drawn with nothing left to load or move), after whatever
// the step before changed
export const settled = (page, timeout = 30000) => page.evaluate((ms) => new Promise((r) => { const t = setTimeout(r, ms); map.once('idle', () => { clearTimeout(t); r(); }); map.triggerRepaint(); }), timeout);
// two frames: what a resize or a click set in the page (its layout, a ResizeObserver's work) done
export const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// a page at url, loaded and its map at rest, its errors collected
// tab: the left panel's tab to open on ('layers', 'elements'), as the frame keeps it in this browser;
// groups: the Layers groups open, as the page keeps them in this browser
export async function openPage(ctx, url, tab = null, groups = null) {
  const page = await ctx.newPage();
  if (tab) await page.addInitScript((t) => { const k = 'charts.frame'; localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), tab: t })); }, tab);
  if (groups) await page.addInitScript((gs) => localStorage.setItem('charts.groups.open', JSON.stringify(gs)), groups);
  page.errors = []; // the page's own: thrown errors, and what it logs as an error
  page.providerErrors = []; // a provider's: a resource the browser could not load (an HTTP 500, a refused tile)
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && (/Failed to load resource/.test(m.text()) ? page.providerErrors : page.errors).push(m.text().slice(0, 200)));
  await page.goto(url);
  await page.waitForFunction(() => window.map?.loaded?.() && map.areTilesLoaded(), null, { timeout: 90000 });
  await page.waitForTimeout(1000);
  return page;
}
// one of the view's outputs: the link (the bar's own button), png, zip (in the bar's Download menu, which
// stays open while an export runs; each item says how it went)
export const exportItem = async (page, id) => {
  if (id === 'link') return page.click('#bar .cplbtn');
  if (!(await page.isVisible(`.dmenu #${id}`))) await page.click('#bar .dlbtn');
  await page.click(`#${id}`);
};
// a zip's entries (name → bytes), their names, and its item.json
export const unzip = async (zz) => {
  const files = {};
  for (const [name, get] of await readZip(new Blob([zz]))) files[name] = Buffer.from(await get());
  return { files, names: Object.keys(files), item: files['item.json'] && JSON.parse(files['item.json']) };
};
