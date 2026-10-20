// Copernicus Marine layers on the map (catalog.js CMEMS): a tile handler that draws an item's
// datasets into one tile, each at its own time step for the hour asked, the global first and the
// regional one over it; the datasets' time ranges, read from their own capabilities; legends.
import { CMEMS, cmemsStyle, cmemsTileUrl, cmemsLegendUrl, cmemsCapsUrl, timeDomain, snapTime, domainEndMs, depthLevels, nearestLevel } from './catalog.js';

const FETCH = { credentials: 'omit', referrerPolicy: 'no-referrer' };
// regional datasets: drawn only within their area [west, south, east, north], and not asked for a
// tile outside it. The Mediterranean model also covers an Atlantic box to 18°W and 46°N, where its
// values do not match the global model's (straight seams at 46°N and 18°W): it is cut at the Strait
// of Gibraltar, and the global model draws the Atlantic.
const AREA = { MEDSEA: [-5.6, 30.1, 36.3, 46] };

async function ok(r) {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

// part (product/dataset/variable) → promise of { time: its time domain, levels: its depth levels }
// (catalog.js timeDomain, depthLevels)
const domains = {};
export function domainOf(part) {
  return (domains[part] ||= fetch(cmemsCapsUrl(part), FETCH).then(ok).then((r) => r.text())
    .then((xml) => {
      const variable = part.split('/')[2], time = timeDomain(xml, variable);
      if (!time.length) throw new Error(`no time steps for ${part}`);
      return { time, levels: depthLevels(xml, variable) };
    })
    .catch((e) => { delete domains[part]; throw e; }));
}

// for each part of item/variant: the time it draws for t (ms), null outside its range (an
// observation: its latest step, for t after it), or undefined if its range is not known
export function partTimes(item, variant, t) {
  const v = CMEMS[item][variant];
  return Promise.all(v.parts.map((p) => domainOf(p).then(({ time }) => {
    const s = snapTime(time, t), end = domainEndMs(time);
    return s === null && v.observed && t > end ? snapTime(time, end) : s;
  }, () => undefined)));
}
// for each part: the depth level drawn for depth (m), as the service lists it; null for a variable
// without depth (or if its levels are not known: the service then draws its default, the top)
export function partLevels(item, variant, depth) {
  const v = CMEMS[item][variant];
  return Promise.all(v.parts.map((p) => (v.depth ? domainOf(p).then(({ levels }) => nearestLevel(levels, depth), () => null) : null)));
}

const lon = (x, z) => (x / 2 ** z) * 360 - 180;
const lat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
function inArea(part, z, x, y) {
  const a = AREA[part.split('_')[0]];
  return !a || (lon(x + 1, z) > a[0] && lon(x, z) < a[2] && lat(y + 1, z) < a[3] && lat(y, z) > a[1]);
}

// MapLibre protocol handler for cmems://item/variant/t/depth/z/x/y (t: the hour, ms since the
// epoch; depth: m below the surface, used by variables with depth)
export async function cmemsTile({ url }, abortController) {
  const [, item, variant, t, depth, z, x, y] = /^cmems:\/\/(\w+)\/(\w+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(url).map((v, i) => (i > 2 ? +v : v));
  const v = CMEMS[item][variant], style = cmemsStyle(v);
  const [times, levels] = await Promise.all([partTimes(item, variant, t), partLevels(item, variant, depth)]);
  const images = await Promise.all(v.parts.map(async (part, i) => {
    if (times[i] === null || !inArea(part, z, x, y)) return null; // no data at this hour, or not here
    const when = times[i] === undefined ? new Date(t) : new Date(times[i]); // range unknown: ask anyway
    const r = await fetch(cmemsTileUrl(part, style, when.toISOString(), z, x, y, levels[i]), { ...FETCH, signal: abortController?.signal }).then(ok);
    return createImageBitmap(await r.blob());
  }));
  const c = new OffscreenCanvas(512, 512), g = c.getContext('2d');
  images.forEach((im, i) => {
    if (!im) return;
    const a = AREA[v.parts[i].split('_')[0]];
    if (!a) { g.drawImage(im, 0, 0); return; }
    // the area in tile pixels (Web Mercator: x linear in longitude, y in the Mercator ordinate)
    const px = (L) => ((L + 180) / 360 * 2 ** z - x) * 512;
    const py = (B) => ((1 - Math.log(Math.tan(Math.PI / 4 + (B * Math.PI) / 360)) / Math.PI) / 2 * 2 ** z - y) * 512;
    g.save();
    g.beginPath();
    g.rect(px(a[0]), py(a[3]), px(a[2]) - px(a[0]), py(a[1]) - py(a[3]));
    g.clip();
    g.drawImage(im, 0, 0);
    g.restore();
  });
  return { data: c.transferToImageBitmap() };
}

// legend of item/variant: the service's colour map over the fixed range, as entries for
// legend.js drawColormap
const legends = {};
export function cmemsLegend(item, variant) {
  const v = CMEMS[item][variant], url = cmemsLegendUrl(v.parts[0], cmemsStyle(v));
  return (legends[url] ||= fetch(url, FETCH).then(ok).then((r) => r.json())
    .then(({ continuous: c }) => {
      const cols = c.cmap.colorMap, lo = c.valueMin, step = (c.valueMax - c.valueMin) / cols.length;
      return cols.map((rgb, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, rgb: `rgb(${rgb.join(',')})` }));
    })
    .catch((e) => { delete legends[url]; throw e; }));
}
