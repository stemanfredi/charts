// Geodesic measurements on the WGS 84 ellipsoid (GeographicLib, Karney 2013):
// ruler (polyline), area (polygon) and range ring (circle). Lines are drawn as
// densified geodesics, so what you see is the path the numbers describe.

const G = window.geodesic.Geodesic.WGS84;
const { STANDARD, DISTANCE_IN, LONG_UNROLL } = window.geodesic.Geodesic;
const MASK = STANDARD | DISTANCE_IN | LONG_UNROLL; // DISTANCE_IN: positions along a line by distance
const NM = 1852;

const KIND = { ruler: 'Ruler', area: 'Area', ring: 'Ring' };

export function fmtDist(m, units) {
  if (units === 'nm') return m < NM ? `${(m / NM).toFixed(3)} NM` : `${(m / NM).toFixed(m < 100 * NM ? 2 : 1)} NM`;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 100e3 ? 2 : 1)} km`;
}
function fmtArea(a, units) {
  a = Math.abs(a);
  if (units === 'nm') return `${(a / NM / NM).toFixed(a < 100 * NM * NM ? 3 : 1)} NM²`;
  return a < 1e6 ? `${(a / 1e4).toFixed(2)} ha` : `${(a / 1e6).toFixed(a < 1e8 ? 2 : 1)} km²`;
}
function fmtBrg(b) {
  const t = (((b % 360) + 360) % 360).toFixed(1);
  return `${t === '360.0' ? '000.0' : t.padStart(5, '0')}°T`;
}

// Points along the geodesic p→q, every ≤ step metres, with continuous longitude.
function densify(p, q, step = 20000) {
  const line = G.InverseLine(p[1], p[0], q[1], q[0], MASK);
  const n = Math.max(1, Math.ceil(line.s13 / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const r = line.Position((line.s13 * i) / n, MASK);
    out.push([r.lon2, r.lat2]);
  }
  return out;
}
function unrollFrom(ref, pts) {
  // keep longitudes continuous across the antimeridian
  return pts.map(([x, y]) => [x + 360 * Math.round((ref[0] - x) / 360), y]);
}
function pathOf(pts, closed) {
  const ring = closed ? [...pts, pts[0]] : pts;
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const seg = unrollFrom(out.length ? out[out.length - 1] : ring[i], densify(ring[i], ring[i + 1]));
    out.push(...(i ? seg.slice(1) : seg));
  }
  return out;
}
function circle(c, r, n = 128) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const d = G.Direct(c[1], c[0], (360 * i) / n, r, MASK);
    pts.push([d.lon2, d.lat2]);
  }
  return pts;
}

export function stats(mm) {
  if (mm.kind === 'ring') return { r: mm.r || 0 };
  let len = 0;
  const segs = [];
  const ring = mm.kind === 'area' && mm.pts.length > 2 ? [...mm.pts, mm.pts[0]] : mm.pts;
  for (let i = 0; i < ring.length - 1; i++) {
    const g = G.Inverse(ring[i][1], ring[i][0], ring[i + 1][1], ring[i + 1][0]);
    segs.push({ s: g.s12, azi: g.azi1 });
    len += g.s12;
  }
  let area = 0;
  if (mm.kind === 'area' && mm.pts.length > 2) {
    const poly = G.Polygon(false);
    for (const p of mm.pts) poly.AddPoint(p[1], p[0]);
    area = poly.Compute(false, true).area;
  }
  return { len, segs, area };
}

export function summary(mm, units) {
  const st = stats(mm);
  if (mm.kind === 'ring') return `${KIND.ring} ${fmtDist(st.r, units)}`;
  if (mm.kind === 'area') return `${KIND.area} ${fmtArea(st.area, units)}`;
  return `${KIND.ruler} ${fmtDist(st.len, units)}`;
}

function features(mm, units, draft) {
  const f = [];
  const tag = { id: mm.id, draft: draft ? 1 : 0 };
  const label = (coord, text, anchor = 'center') => f.push({ type: 'Feature', properties: { ...tag, label: text, anchor }, geometry: { type: 'Point', coordinates: coord } });
  for (const p of mm.pts) f.push({ type: 'Feature', properties: { ...tag, vertex: 1 }, geometry: { type: 'Point', coordinates: p } });

  if (mm.kind === 'ring') {
    if (!mm.r) return f;
    const pts = circle(mm.pts[0], mm.r);
    f.push({ type: 'Feature', properties: { ...tag, ring: 1 }, geometry: { type: 'LineString', coordinates: pts } });
    const north = G.Direct(mm.pts[0][1], mm.pts[0][0], 0, mm.r);
    label([north.lon2, north.lat2], fmtDist(mm.r, units), 'bottom');
    return f;
  }
  if (mm.pts.length < 2) return f;
  const closed = mm.kind === 'area' && mm.pts.length > 2;
  const path = pathOf(mm.pts, closed);
  f.push({ type: 'Feature', properties: tag, geometry: { type: 'LineString', coordinates: path } });
  const st = stats(mm);
  if (closed) {
    f.push({ type: 'Feature', properties: { ...tag, fill: 1 }, geometry: { type: 'Polygon', coordinates: [path] } });
    const c = mm.pts.reduce((a, p) => [a[0] + p[0] / mm.pts.length, a[1] + p[1] / mm.pts.length], [0, 0]);
    label(c, `${fmtArea(st.area, units)}\nperimeter ${fmtDist(st.len, units)}`);
  } else {
    st.segs.forEach((s, i) => {
      const mid = G.InverseLine(mm.pts[i][1], mm.pts[i][0], mm.pts[i + 1][1], mm.pts[i + 1][0], MASK).Position(s.s / 2, MASK);
      label([mid.lon2, mid.lat2], `${fmtDist(s.s, units)} · ${fmtBrg(s.azi)}`);
    });
    if (st.segs.length > 1) label(mm.pts[mm.pts.length - 1], `Σ ${fmtDist(st.len, units)}`, 'top');
  }
  return f;
}

export class Measure {
  constructor(map, onChange) {
    this.map = map;
    this.onChange = onChange;
    this.list = [];
    this.units = 'km';
    this.tool = null;
    this.draft = null;
    this.hover = null;
    this.seq = 1;
    map.on('click', (e) => this.click(e));
    map.on('mousemove', (e) => { if (this.tool) { this.hover = [e.lngLat.lng, e.lngLat.lat]; this.render(); } });
    map.on('dblclick', (e) => { if (this.tool) { e.preventDefault(); this.finish(); } });
    window.addEventListener('keydown', (e) => {
      // not while typing, nor on a focused button (its own Enter click would restart the tool)
      if (!this.tool || e.target.closest('input,select,textarea,button')) return;
      if (e.key === 'Escape') this.cancel();
      else if (e.key === 'Enter') this.finish();
      else if (e.key === 'Backspace' && this.draft?.pts.length) { this.draft.pts.pop(); this.render(); }
    });
  }

  start(kind) {
    this.cancel();
    this.tool = kind;
    this.draft = { id: 0, kind, pts: [] };
    this.map.doubleClickZoom.disable();
    this.map.getCanvas().style.cursor = 'crosshair';
    this.onChange('tool');
  }
  cancel() {
    if (!this.tool) return;
    this.tool = null;
    this.draft = null;
    this.map.getCanvas().style.cursor = '';
    setTimeout(() => this.map.doubleClickZoom.enable(), 0);
    this.render();
    this.onChange('tool');
  }
  click(e) {
    if (!this.tool) return;
    const p = [e.lngLat.lng, e.lngLat.lat];
    const d = this.draft;
    if (d.kind === 'ring') {
      if (!d.pts.length) { d.pts.push(p); return this.render(); }
      d.r = G.Inverse(d.pts[0][1], d.pts[0][0], p[1], p[0]).s12;
      return this.finish();
    }
    // the second click of a double-click lands on the same point: ignore it
    const last = d.pts[d.pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) d.pts.push(p);
    this.render();
  }
  finish() {
    const d = this.draft;
    if (!d) return;
    if (d.kind === 'ring' ? d.r > 0 : d.pts.length >= (d.kind === 'area' ? 3 : 2)) this.list.push({ ...d, id: this.seq++, hidden: false });
    this.cancel();
    this.onChange('list');
  }

  setHidden(id, hidden) { for (const x of this.list) if (id == null || x.id === id) x.hidden = hidden; this.render(); this.onChange('list'); }
  remove(id) { this.list = this.list.filter((x) => id != null && x.id !== id); this.render(); this.onChange('list'); }
  setRadius(id, r) { const x = this.list.find((y) => y.id === id); if (x && r > 0) { x.r = r; this.render(); this.onChange('list'); } }
  setUnits(u) { this.units = u; this.render(); this.onChange('list'); }

  render() {
    const f = [];
    for (const x of this.list) if (!x.hidden) f.push(...features(x, this.units, false));
    if (this.draft) {
      const d = this.draft;
      let preview = d;
      if (this.hover && d.pts.length) {
        preview = d.kind === 'ring'
          ? { ...d, r: G.Inverse(d.pts[0][1], d.pts[0][0], this.hover[1], this.hover[0]).s12 }
          : { ...d, pts: [...d.pts, this.hover] };
      }
      f.push(...features(preview, this.units, true));
    }
    this.map.getSource('measure')?.setData({ type: 'FeatureCollection', features: f });
  }

  // compact text for the URL: r:lon,lat;lon,lat  a:…  c:lon,lat;radius  (! = hidden)
  serialize() {
    const xy = (p) => `${+p[0].toFixed(5)},${+p[1].toFixed(5)}`;
    return this.list.map((x) => `${x.hidden ? '!' : ''}${x.kind[0]}:${x.pts.map(xy).join(';')}${x.kind === 'ring' ? `;${Math.round(x.r)}` : ''}`).join('~');
  }
  load(s) {
    const kinds = { r: 'ruler', a: 'area', c: 'ring' };
    for (const part of (s || '').split('~')) {
      const mm = /^(!?)([rac]):(.+)$/.exec(part);
      if (!mm) continue;
      const bits = mm[3].split(';');
      const kind = kinds[mm[2]];
      const x = { id: this.seq++, kind, hidden: !!mm[1], pts: [] };
      if (kind === 'ring') { x.r = +bits.pop(); if (!(x.r > 0)) continue; } // no rings without a radius
      x.pts = bits.map((b) => b.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
      if (x.pts.length) this.list.push(x);
    }
    this.render();
  }
}

export const MEASURE_LAYERS = [
  { id: 'measure-fill', type: 'fill', source: 'measure', filter: ['has', 'fill'], paint: { 'fill-color': '#b0127a', 'fill-opacity': 0.08 } },
  { id: 'measure-line', type: 'line', source: 'measure',
    filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'draft'], 0], ['!', ['has', 'ring']]],
    layout: { 'line-join': 'round' }, paint: { 'line-color': '#b0127a', 'line-width': 2 } },
  { id: 'measure-dash', type: 'line', source: 'measure',
    filter: ['all', ['==', ['geometry-type'], 'LineString'], ['any', ['==', ['get', 'draft'], 1], ['has', 'ring']]],
    layout: { 'line-join': 'round' }, paint: { 'line-color': '#b0127a', 'line-width': 2, 'line-dasharray': [3, 2] } },
  { id: 'measure-vertex', type: 'circle', source: 'measure', filter: ['has', 'vertex'],
    paint: { 'circle-radius': 3.5, 'circle-color': '#fff', 'circle-stroke-color': '#b0127a', 'circle-stroke-width': 1.5 } },
  { id: 'measure-label', type: 'symbol', source: 'measure', filter: ['has', 'label'],
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-anchor': ['get', 'anchor'],
      'text-offset': [0, 0], 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-justify': 'center' },
    paint: { 'text-color': '#7a0d55', 'text-halo-color': '#fff', 'text-halo-width': 1.6 } },
];
