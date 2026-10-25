// npm run tiles-check: the elevation tiles of known trouble spots, cut by clip.js in headless Chrome
// as the page does, checked for what each defect broke. Live data (Terrarium, OpenFreeMap), so not
// a deploy gate: CI runs it weekly, with the live smoke test.
//   seams     no bend in the depth slope at a tile edge (Canale di Corsica)
//   zooms     a tile agrees with the four of the next zoom it covers (Elba's pit, Taranto's dry
//             blocks)
//   probes    places whose answer is known get it: lakes without depth, limans flat at sea level,
//             Caspian depths, the Marciana Marina pit filled
import { start } from './browser.mjs';
import { NO_DEPTH_M } from '../site/catalog.js';
import { tileXY } from '../site/geo.js';

const { browser, base, check, section, finish } = await start();
const page = await browser.newPage();

// tile z/x/y holding lon/lat, and the pixel in it
function at(lon, lat, z) {
  const { x: X, y: Y } = tileXY(lon, lat, z);
  return { z, x: Math.floor(X), y: Math.floor(Y), i: Math.floor((X % 1) * 256), j: Math.floor((Y % 1) * 256) };
}

await section('the page and its clipper', async () => {
  await page.goto(`${base}#v=3/0/0/0&on=chart&menu=0`);
  await page.waitForFunction(() => window.map?.loaded?.(), null, { timeout: 90000 });
  // the page's own pipeline: the sea clipper in its worker, as the depth layers use it
  await page.evaluate(async () => {
    const { workerClipper } = await import('./clip.js');
    const { DEM_TILES, DEM_SEA, OMT_TILEJSON } = await import('./catalog.js');
    const sea = workerClipper({ template: DEM_TILES, native: DEM_SEA.native, mode: 'sea', omtTileJson: OMT_TILEJSON });
    // metres where the tile shows depths (NaN elsewhere), as the GIS export takes them
    window.metres = async (z, x, y) => Array.from(await sea.metres(z, x, y));
    // every pixel as the depth shading gets it: depths, -1 flat, NO_DEPTH_M for lakes, land high
    window.shaded = async (z, x, y) => {
      const { data } = await sea.protocol({ url: `clip-sea://${z}/${x}/${y}` });
      const g = new OffscreenCanvas(256, 256).getContext('2d');
      g.drawImage(data, 0, 0);
      const px = g.getImageData(0, 0, 256, 256).data, out = [];
      for (let k = 0; k < px.length; k += 4) out.push(px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768);
      return out;
    };
  });
});
const metres = (z, x, y) => page.evaluate(([a, b, c]) => window.metres(a, b, c), [z, x, y]);
const shaded = (z, x, y) => page.evaluate(([a, b, c]) => window.shaded(a, b, c), [z, x, y]);

await section('seams', async () => {
  // ---- seams: no bend in the depth slope at the edge between two tiles -----------------------
  // the bend at a column: how much the slope changes there, |v(x+1) − 2v(x) + v(x−1)|, along each
  // row; at the edge (the last column of the west tile, the first of the east one) no larger than
  // elsewhere in the same tiles (the Canale di Corsica bends were 4–8× that)
  for (const [name, lon, lat, z] of [['Canale di Corsica', 9.84375, 43.1, 10], ['Canale di Corsica', 9.84375, 43.1, 9], ['Ligurian slope', 8.4375, 43.8, 10]]) {
    const t = at(lon + 1e-6, lat, z); // the tile east of the edge
    const [L, R] = await Promise.all([metres(z, t.x - 1, t.y), metres(z, t.x, t.y)]);
    const v = (x, j) => (x < 256 ? L[j * 256 + x] : R[j * 256 + x - 256]); // the two tiles as one 512 px row
    const bend = (x, j) => Math.abs(v(x + 1, j) - 2 * v(x, j) + v(x - 1, j));
    const mean = (cols) => { let s = 0, n = 0; for (let j = 0; j < 256; j++) for (const x of cols) { const b = bend(x, j); if (Number.isFinite(b)) { s += b; n++; } } return n > 100 ? s / n : NaN; };
    const edge = mean([255, 256]), inside = mean([64, 96, 128, 160, 192, 320, 352, 384, 416, 448]);
    check(Number.isFinite(edge) && edge <= 2 * inside, `seams: no bend at the tile edge, ${name} zoom ${z} (slope change ${edge.toFixed(2)} m at the edge, ${inside.toFixed(2)} m inside)`);
  }

});

await section('zooms', async () => {
  // ---- zooms: a tile agrees with the four of the next zoom it covers -------------------------
  for (const [name, lon, lat, z] of [['Elba', 10.2, 42.8, 9], ['Gulf of Taranto', 17.2, 40.0, 7], ['Gulf of Taranto', 17.2, 40.0, 8], ['Gulf of Panama', -78.6, 8.4, 8]]) {
    const t = at(lon, lat, z);
    const [P, ...C] = await Promise.all([metres(z, t.x, t.y), ...[0, 1].flatMap((dy) => [0, 1].map((dx) => metres(z + 1, 2 * t.x + dx, 2 * t.y + dy)))]);
    // beyond the children's range by more than 20 m or half their depth: a dry block, a false pit.
    // Within it, the zooms differ by design: each fills pits up to the depths it draws
    let bad = 0, n = 0, worst = '';
    for (let j = 0; j < 256; j++) {
      for (let i = 0; i < 256; i++) {
        const p = P[j * 256 + i];
        if (!Number.isFinite(p)) continue;
        // not within 2 px of land: at the coast the DEM's own shore moves between zooms (sea it calls
        // dry at one zoom, a few metres deep at the next), which is not what this looks for
        let shore = false;
        for (let dj = -2; dj <= 2 && !shore; dj++) for (let di = -2; di <= 2; di++) if (!Number.isFinite(P[Math.min(255, Math.max(0, j + dj)) * 256 + Math.min(255, Math.max(0, i + di))])) shore = true;
        if (shore) continue;
        const c = C[(j >> 7) * 2 + (i >> 7)], ci = (i % 128) * 2, cj = (j % 128) * 2;
        const kids = [c[cj * 256 + ci], c[cj * 256 + ci + 1], c[(cj + 1) * 256 + ci], c[(cj + 1) * 256 + ci + 1]].filter(Number.isFinite);
        if (kids.length < 4) continue; // the coast: the finer coastline differs
        n++;
        const lo = Math.min(...kids), hi = Math.max(...kids), tol = (d) => Math.max(20, Math.abs(d) / 2);
        if (lo - p > tol(lo) || p - hi > tol(hi)) { bad++; worst ||= `${p.toFixed(0)} m over ${lo.toFixed(0)} to ${hi.toFixed(0)} m`; }
      }
    }
    // a block is the defect (Taranto's, before 0 and +1 m cells were holes: 2.3 % of the pixels);
    // a few scattered cells reading 2–5 m inside one are left (by value they are low land)
    check(n > 1000 && bad <= n * 0.002, `zooms agree: ${name} zoom ${z} against ${z + 1} (${n} pixels, ${bad} apart${worst ? `, e.g. ${worst}` : ''})`);
  }

});

await section('probes', async () => {
  // ---- probe points --------------------------------------------------------------------------
  const probe = async (lon, lat, z, r = 0) => { // the values within r pixels of the point
    const t = at(lon, lat, z), v = await shaded(z, t.x, t.y), out = [];
    for (let j = Math.max(0, t.j - r); j <= Math.min(255, t.j + r); j++) for (let i = Math.max(0, t.i - r); i <= Math.min(255, t.i + r); i++) out.push(v[j * 256 + i]);
    return out;
  };
  const near = (a, b) => Math.abs(a - b) < 0.5;
  let v = await probe(10.68, 45.65, 9);
  check(near(v[0], NO_DEPTH_M), `Lake Garda: a lake above sea level, no depth (${v[0]})`);
  v = await probe(35.5, 31.5, 9);
  check(near(v[0], NO_DEPTH_M), `Dead Sea: below sea level but not the sea, no depth (${v[0]})`);
  v = await probe(30.5177, 46.7158, 10);
  check(near(v[0], -1), `Khadzhibey liman (Odesa): inland water at sea level, flat (${v[0]})`);
  v = await probe(51.0, 41.5, 6);
  check(v[0] < -100, `Caspian: depths from its own surface, not a flat lake (${v[0].toFixed(0)} m)`);
  v = await probe(10.196, 42.807, 10, 3);
  check(Math.min(...v) > -100, `Marciana Marina (Elba): the harbour's false pit is filled (deepest ${Math.min(...v).toFixed(0)} m)`);
  v = await probe(17.3, 39.8, 7);
  check(v[0] < -100, `Gulf of Taranto: real depths, no 0 m blocks (${v[0].toFixed(0)} m)`);
});
await finish();
