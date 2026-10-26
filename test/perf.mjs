// npm run perf [-- RUNS]: how long the depth layers take to draw, from a fresh browser (empty cache)
// until every tile is in, with what GEBCO's store sent; the median of RUNS (3). Not in CI: timings
// vary with the machine and the network. 37–47 s at zooms 7–9 when gebco.js looked up a chunk for
// every cell it read; 5 s since each tile copies its cells into one block
import { chromium } from 'playwright-core';
import { serve, chromeOptions } from './serve.mjs';
const server = await serve();
const browser = await chromium.launch(chromeOptions());
const views = { 'Ligurian z9': '9/43.9/8.3', 'Adriatic z7': '7/43.2/14.8', 'Gulf of Panama z11': '11/8.4/-78.6', 'Elba z12': '12/42.78/10.25' };
const runs = Number(process.argv[2] || 3), out = {};
for (let r = 0; r < runs; r++) {
  for (const [name, v] of Object.entries(views)) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); // empty cache
    const p = await ctx.newPage();
    const net = [0, 0]; // requests, bytes
    ctx.on('requestfinished', async (q) => {
      if (!q.url().includes('geodata.makaw.org')) return;
      const s = await q.sizes().catch(() => null); net[0]++; net[1] += s?.responseBodySize || 0;
    });
    const t0 = Date.now();
    await p.goto(`${server.url}#v=${v}/0&on=chart,coastline,depth,isobaths&menu=0`);
    await p.waitForFunction(() => window.map?.loaded() && map.areTilesLoaded() && !document.body.classList.contains('loading'), null, { timeout: 180000, polling: 100 });
    (out[name] ||= []).push({ ms: Date.now() - t0, net: [...net] });
    await ctx.close();
  }
}
for (const [k, rs] of Object.entries(out)) {
  const ms = rs.map((x) => x.ms).sort((a, b) => a - b), med = ms[ms.length >> 1], n = rs.at(-1).net;
  console.log(`${k.padEnd(20)} median ${(med / 1000).toFixed(1)} s  (runs ${ms.map((x) => (x / 1000).toFixed(1)).join(', ')})  GEBCO ${n[0]} requests, ${(n[1] / 1e6).toFixed(1)} MB`);
}
await browser.close(); server.close();
