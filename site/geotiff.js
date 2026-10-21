// Elevation grids of the view as GeoTIFF (the ZIP export): the clipped DEM tiles the map draws,
// assembled north-up over the view's bounding box, at the tiles' own resolution.
// The file is the plain baseline GeoTIFF every GIS reads: Float32 bands (one, or several pixel by
// pixel), uncompressed (the zip compresses it), EPSG:3857 or EPSG:4326 by GeoKeys, NaN as no data
// (GDAL_NODATA), each band's unit and description in GDAL's metadata tag. The Copernicus values
// (zarr.js) use it too, in their latitude/longitude grids.

const R = 6378137, CIRC = 2 * Math.PI * R, HALF = CIRC / 2;
const SIZE = 256; // DEM tile edge, pixels

// The pixels of zoom-z DEM tiles that cover the view (corners in EPSG:3857 metres, as export.js
// mercator gives them): { x0, y0, w, h } in global pixels, and the tiles to read, as [x, y] with
// x unwrapped (the world copy in view) and y within the world.
export function gridFor(view, z) {
  const pix = CIRC / 2 ** z / SIZE;
  const xs = view.map((p) => (p[0] + HALF) / pix), ys = view.map((p) => (HALF - p[1]) / pix);
  const top = 2 ** z * SIZE;
  const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(top, Math.ceil(Math.max(...ys)));
  const tiles = [];
  for (let ty = Math.floor(y0 / SIZE); ty <= Math.floor((y1 - 1) / SIZE); ty++) {
    for (let tx = Math.floor(x0 / SIZE); tx <= Math.floor((x1 - 1) / SIZE); tx++) tiles.push([tx, ty]);
  }
  return { z, x0, y0, w: x1 - x0, h: y1 - y0, tiles, pix };
}

// grid: from gridFor; data: tile arrays (SIZE × SIZE, row-major) in the order of grid.tiles
// → Float32Array w × h, rows from the north
export function mosaic(grid, data) {
  const out = new Float32Array(grid.w * grid.h).fill(NaN);
  grid.tiles.forEach(([tx, ty], k) => {
    const t = data[k];
    for (let j = 0; j < SIZE; j++) {
      const y = ty * SIZE + j - grid.y0;
      if (y < 0 || y >= grid.h) continue;
      const i0 = Math.max(0, grid.x0 - tx * SIZE), i1 = Math.min(SIZE, grid.x0 + grid.w - tx * SIZE);
      if (i1 > i0) out.set(t.subarray(j * SIZE + i0, j * SIZE + i1), y * grid.w + tx * SIZE + i0 - grid.x0);
    }
  });
  return out;
}

// [a, b, c, d, e, f] (export.js affine order) of the grid in EPSG:3857
export const gridTransform = ({ x0, y0, pix }) => [pix, 0, x0 * pix - HALF, 0, -pix, HALF - y0 * pix];

// GeoTIFF bytes for a grid w × h with transform t (north-up; in metres for EPSG:3857, degrees for
// EPSG:4326): values a Float32Array, or one per band with `bands` [{ description, unit }]
export function geotiff(values, w, h, t, { description = '', unit = 'metre', crs = 3857, bands = [{ description, unit }] } = {}) {
  const planes = values instanceof Float32Array ? [values] : values, n = planes.length;
  const ascii = (s) => new TextEncoder().encode(`${s}\0`);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  const meta = ascii(`<GDALMetadata>${bands.map((b, i) => `<Item name="DESCRIPTION" sample="${i}" role="description">${esc(b.description)}</Item><Item name="UNITTYPE" sample="${i}" role="unittype">${esc(b.unit)}</Item>`).join('')}</GDALMetadata>`);
  // GeoKeys, pixel is area: projected EPSG:3857 in metres, or geographic EPSG:4326 in degrees
  const keys = crs === 4326 ? [1, 1, 0, 4, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326, 2054, 0, 1, 9102]
    : [1, 1, 0, 4, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3857, 3076, 0, 1, 9001];
  // [tag, type, values]; types: 2 ASCII, 3 SHORT, 4 LONG, 12 DOUBLE. Image data goes after the tags.
  const tags = [
    [256, 4, [w]], [257, 4, [h]], [258, 3, Array(n).fill(32)], [259, 3, [1]], [262, 3, [1]],
    [273, 4, [0]], // strip offset, set below
    [277, 3, [n]], [278, 4, [h]], [279, 4, [w * h * n * 4]], [284, 3, [1]],
    ...(n > 1 ? [[338, 3, Array(n - 1).fill(0)]] : []), // the other bands: data, not alpha
    [339, 3, Array(n).fill(3)],
    [33550, 12, [t[0], -t[4], 0]], [33922, 12, [0, 0, 0, t[2], t[5], 0]],
    [34735, 3, keys], [42112, 2, meta], [42113, 2, ascii('nan')],
  ];
  const size = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const ifd = 8, ifdLen = 2 + tags.length * 12 + 4;
  let at = ifd + ifdLen;
  const placed = tags.map(([tag, type, v]) => {
    const n = v.length, bytes = n * size[type];
    const off = bytes > 4 ? at : null;
    if (off !== null) at += bytes + (bytes & 1); // values start on a word boundary
    return { tag, type, v, n, off };
  });
  const dataAt = at + (at & 3 ? 4 - (at & 3) : 0);
  placed.find((p) => p.tag === 273).v = [dataAt];
  const buf = new ArrayBuffer(dataAt + w * h * n * 4), dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8.set([0x49, 0x49, 42, 0]); // "II", 42: little-endian TIFF
  dv.setUint32(4, ifd, true);
  dv.setUint16(ifd, tags.length, true);
  const put = (type, v, pos) => {
    v.forEach((x, i) => {
      if (type === 2) dv.setUint8(pos + i, x);
      else if (type === 3) dv.setUint16(pos + i * 2, x, true);
      else if (type === 4) dv.setUint32(pos + i * 4, x, true);
      else dv.setFloat64(pos + i * 8, x, true);
    });
  };
  placed.forEach(({ tag, type, v, n, off }, k) => {
    const e = ifd + 2 + k * 12;
    dv.setUint16(e, tag, true);
    dv.setUint16(e + 2, type, true);
    dv.setUint32(e + 4, n, true);
    if (off === null) put(type, v, e + 8); else { dv.setUint32(e + 8, off, true); put(type, v, off); }
  });
  dv.setUint32(ifd + 2 + tags.length * 12, 0, true); // no further images
  const px = new Float32Array(buf, dataAt, w * h * n); // little-endian on every platform the page runs on
  if (n === 1) px.set(planes[0]); else for (let i = 0; i < w * h; i++) for (let b = 0; b < n; b++) px[i * n + b] = planes[b][i];
  return u8;
}
