// Reading a drawing's values forgivingly (docs/drawing-format.md): each check returns the value, or a
// default with a warning (c.warn), or skips the element (c.skip throws Skip), for the file's reader
// (file.js). Pure: no map, no DOM.

import { MAX_LAT, norm360 } from '../geo.js';
import { DEFAULT_STYLE, MAX_OFFSET, MAX_MIN_SIZE, STROKE_WIDTH, DASHES, MAX_RADIUS, LABEL_SIZES, BACKGROUNDS, ROUND, ARCED, PART_KINDS, isoNow } from './document.js';

export const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
export const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const fin = (x) => typeof x === 'number' && Number.isFinite(x);

export class Skip extends Error {}

export function time(t) {
  return typeof t === 'string' && !Number.isNaN(Date.parse(t)) ? isoNow(Date.parse(t)) : null;
}
const MAX_TEXT = 10000; // characters: a name, a value, a description
const MAX_PARTS = 100; // parts on one point
const MAX_PROPERTIES = 200; // properties on one element
export function text(v, c, what) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v.length > MAX_TEXT ? (c.warn(`${what}: cut to ${MAX_TEXT} characters`), v.slice(0, MAX_TEXT)) : v;
  if (typeof v === 'number' || typeof v === 'boolean') { c.warn(`${what}: ${typeof v} made text`); return String(v); }
  c.warn(`${what}: not text, ignored`);
  return '';
}
export function properties(list, c) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) { c.warn('properties: not a list, ignored'); return []; }
  const out = [];
  for (const p of list) {
    if (out.length >= MAX_PROPERTIES) { c.warn(`more than ${MAX_PROPERTIES} properties: the rest dropped`); break; }
    if (!isObj(p)) { c.warn('a property that is not {key, value} dropped'); continue; }
    const key = text(p.key, c, 'property key');
    if (!key) { c.warn('a property with an empty key dropped'); continue; }
    out.push({ key, value: text(p.value, c, `property "${key}"`) });
  }
  return out;
}
// Offset, on a line or a group: px to the right of the line (negative: left), or null (a line's: its
// group's)
export function offset(v, c) {
  if (v === undefined || v === null) return null;
  if (fin(v)) return Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, v));
  c.warn('Offset: not a number of pixels; ignored');
  return null;
}
export function flag(v, c, what) {
  if (v !== undefined && v !== null && typeof v !== 'boolean') c.warn(`${what} is not true or false; false used`);
  return v === true;
}
export function position(p, c, what) {
  if (!Array.isArray(p) || p.length < 2 || !fin(p[0]) || !fin(p[1])) c.skip(`${what}: not [longitude, latitude]`);
  if (Math.abs(p[1]) > MAX_LAT) c.skip(`${what}: [${p[0]}, ${p[1]}] is out of range (latitude ±${MAX_LAT})`);
  // a longitude past ±180 (placed on a copy of the world beside the first): the same place, brought back
  return [Math.abs(p[0]) > 180 ? norm360(p[0] + 180) - 180 : p[0], p[1]];
}
export function angle(a, c, what) {
  if (!fin(a)) return 0;
  if (a >= 0 && a < 360) return a;
  const n = norm360(a);
  if (n !== a) c.warn(`${what} ${a} read as ${n}`);
  return n;
}
// a minimum display size in px: 0 to MAX_MIN_SIZE, or null (not valid: warned)
export function minSize(v, c, what) {
  if (fin(v) && v >= 0) return Math.min(MAX_MIN_SIZE, v);
  c.warn(`${what}: not a number of pixels ≥ 0, ignored`);
  return null;
}
export function handle(h, c, what) {
  if (h === undefined || h === null) return null;
  if (!Array.isArray(h) || h.length < 2 || !fin(h[0]) || !fin(h[1])) { c.warn(`${what}: not [east, north], ignored`); return null; }
  return [h[0], h[1]];
}
// a sector's aperture (degrees, above 0 and below 360), or null: circles (360 or more: circles, warned)
export function aperture(a, c) {
  if (a === undefined || a === null) return null;
  if (!fin(a) || a <= 0) { c.warn('aperture: not an angle above 0; a circle'); return null; }
  if (a >= 360) { if (a > 360) c.warn(`aperture ${a} read as a full circle`); return null; }
  return a;
}
export function colour(v, dflt, c, what) {
  if (v === undefined) return dflt;
  if (typeof v === 'string' && COLOUR.test(v)) return v.toLowerCase();
  c.warn(`${what}: not a #rrggbb colour, default used`);
  return dflt;
}
function clamp(v, lo, hi, dflt, c, what) {
  if (v === undefined) return dflt;
  if (!fin(v)) { c.warn(`${what}: not a number, default used`); return dflt; }
  const r = Math.min(hi, Math.max(lo, v));
  if (r !== v) c.warn(`${what} ${v} clamped to ${r}`);
  return r;
}
// An element's or a group's own style: the values it sets, each checked; those it does not set come
// from its groups, else the defaults (document.js styleOf). fill: whether it has one (lines have none).
export function ownStyle(s, c, fill) {
  if (s === undefined || s === null) return {};
  if (!isObj(s)) { c.warn('style: not an object, ignored'); return {}; }
  const out = {};
  const part = (key, d, check) => {
    if (s[key] === undefined) return;
    if (!isObj(s[key])) { c.warn(`${key}: not an object, ignored`); return; }
    const v = Object.fromEntries(Object.keys(d).filter((f) => s[key][f] !== undefined).map((f) => [f, check(f, s[key][f])]).filter(([, x]) => x !== undefined));
    if (Object.keys(v).length) out[key] = v;
  };
  const check = (key) => (f, v) => (f === 'color' ? colour(v, undefined, c, `${key} colour`) : f === 'dash' ? (DASHES.includes(v) ? v : (c.warn(`unknown dash "${String(v).slice(0, 20)}", ignored`), undefined))
    : clamp(v, f === 'width' ? STROKE_WIDTH[0] : 0, f === 'width' ? STROKE_WIDTH[1] : 1, undefined, c, `${key} ${f}`));
  if (fill) part('fill', DEFAULT_STYLE.fill, check('fill'));
  else if (s.fill !== undefined) c.warn('fill: a line has none; ignored');
  part('stroke', DEFAULT_STYLE.stroke, check('stroke'));
  return out;
}
// A look as the file has it (an element's own, the drawing's): what it sets, each value
// checked; what is not valid is left out (warned). fill: whether it can have one (a line cannot).
export function look(l, c, fill = true) {
  if (l === undefined || l === null) return {};
  if (!isObj(l)) { c.warn('look: not an object, ignored'); return {}; }
  const out = ownStyle({ fill: l.fill, stroke: l.stroke }, c, fill);
  if (l.text !== undefined) {
    const t = isObj(l.text) ? l.text : (c.warn('look text: not an object, ignored'), {}), o = {};
    for (const k of ['name', 'values']) {
      if (typeof t[k] === 'boolean') o[k] = t[k];
      else if (t[k] !== undefined) c.warn(`look text ${k}: not true or false, ignored`);
    }
    const one = (k, list) => { if (t[k] === undefined) return; if (list.includes(t[k])) o[k] = t[k]; else c.warn(`look text ${k} "${String(t[k]).slice(0, 20)}" unknown, ignored`); };
    one('size', LABEL_SIZES);
    one('background', BACKGROUNDS);
    if (t.color != null) { const v = colour(t.color, undefined, c, 'look text colour'); if (v !== undefined) o.color = v; }
    if (Object.keys(o).length) out.text = o;
  }
  const a = offset(l.offset, c);
  if (a !== null) out.offset = a;
  if (l.minSize != null) { const m = minSize(l.minSize, c, 'look minSize'); if (m !== null) out.minSize = m; }
  return out;
}
// a point's parts (document.js makePart), each named by its place in the list (part 1, 2…)
export function parts(list, c) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) { c.warn('parts: not a list, ignored'); return []; }
  const out = [];
  if (list.length > MAX_PARTS) { c.warn(`more than ${MAX_PARTS} parts: the first ${MAX_PARTS} kept`); list = list.slice(0, MAX_PARTS); }
  list.forEach((r, i) => {
    const n = i + 1, round = ROUND.includes(r?.kind), size = (v) => fin(v) && v > 0 && v < MAX_RADIUS;
    const bad = !isObj(r) ? 'not an object' : !PART_KINDS.includes(r.kind) ? `unknown kind "${String(r.kind).slice(0, 20)}"`
      : round ? (!size(r.radius) ? 'radius not between 0 and 10 000 km' : null) : !size(r.length) || !size(r.width) ? 'length or width not above 0' : null;
    if (bad) { c.warn(`part ${n} skipped: ${bad}`); return; }
    const part = { kind: r.kind, fill: r.fill !== false, shown: r.shown !== false, name: text(r.name, c, `part ${n} name`),
      strokeColor: r.strokeColor == null ? null : colour(r.strokeColor, null, c, `part ${n} stroke colour`),
      strokeDash: r.strokeDash == null ? null : DASHES.includes(r.strokeDash) ? r.strokeDash : (c.warn(`part ${n}: unknown dash, the point's used`), null) };
    if (round) part.radius = r.radius; else { part.length = r.length; part.width = r.width; }
    if (ARCED.has(r.kind)) {
      const a = aperture(r.aperture, c);
      if (a === null) { part.kind = 'circle'; if (r.aperture == null) c.warn(`part ${n}: a${r.kind === 'arc' ? 'n arc' : ' sector'} with no aperture; a circle`); } else part.aperture = a;
    }
    if (part.kind === 'arc') part.fill = false;
    out.push(part);
  });
  return out;
}

// The view a drawing was made in: the map's place, its layers and data, the units. known: what the app
// offers (layers, data, depths), to check them; null: not checked.
export function readView(v, known, c) {
  if (!isObj(v)) { c.warn('not an object, ignored'); return null; }
  const view = { center: null, zoom: null, bearing: 0, layers: null, data: null, units: 'km', bearings: false };
  if (v.center !== undefined) {
    try { view.center = position(v.center, c, 'center'); } catch (e) { if (!(e instanceof Skip)) throw e; c.warn(`${e.message}; ignored`); }
  }
  if (v.zoom !== undefined) view.zoom = fin(v.zoom) ? Math.min(24, Math.max(0, v.zoom)) : (c.warn('zoom: not a number, ignored'), null);
  if (v.bearing !== undefined) view.bearing = angle(v.bearing, c, 'bearing');
  if (v.bearings !== undefined) view.bearings = flag(v.bearings, c, 'bearings');
  if (v.units !== undefined) view.units = v.units === 'nm' || v.units === 'km' ? v.units : (c.warn(`unknown units "${String(v.units).slice(0, 10)}", km used`), 'km');
  if (Array.isArray(v.layers)) {
    view.layers = [];
    for (const l of v.layers) {
      if (!isObj(l) || typeof l.id !== 'string') { c.warn('a layer without an ID skipped'); continue; }
      const k = known?.layers;
      if (k && !Object.hasOwn(k, l.id)) { c.warn(`layer "${l.id.slice(0, 40)}" not known here; skipped`); continue; }
      const out = { id: l.id };
      for (const [key, list] of [['variant', k?.[l.id]?.variants], ['period', k?.[l.id]?.periods]]) {
        if (l[key] === undefined || l[key] === null) continue;
        if (k && !list?.includes(l[key])) c.warn(`layer ${l.id}: ${key} "${String(l[key]).slice(0, 40)}" not known here; default used`);
        else out[key] = String(l[key]);
      }
      if (l.opacity !== undefined) out.opacity = clamp(l.opacity, 0, 1, 1, c, `layer ${l.id} opacity`);
      view.layers.push(out);
    }
  } else if (v.layers !== undefined) c.warn('layers: not a list, ignored');
  if (isObj(v.data)) {
    const d = { colour: null, arrows: null, time: time(v.data.time), depth: null };
    for (const slot of ['colour', 'arrows']) {
      const e = v.data[slot];
      if (e === undefined || e === null) continue;
      if (!isObj(e) || typeof e.id !== 'string') { c.warn(`data ${slot}: not {id, variant}, ignored`); continue; }
      const variants = known?.data && Object.hasOwn(known.data, e.id) ? known.data[e.id] : undefined;
      if (known && !(variants && (e.variant == null || variants.includes(e.variant)))) { c.warn(`data ${slot}: "${e.id}${e.variant ? `:${e.variant}` : ''}" not known here; skipped`); continue; }
      d[slot] = { id: e.id, variant: e.variant == null ? null : String(e.variant) };
    }
    if (v.data.depth !== undefined && v.data.depth !== null) {
      if (fin(v.data.depth) && (!known || known.depths.includes(v.data.depth))) d.depth = v.data.depth;
      else c.warn(`data depth ${String(v.data.depth).slice(0, 20)} not offered here; ignored`);
    }
    view.data = d;
  } else if (v.data !== undefined && v.data !== null) c.warn('data: not an object, ignored');
  return view;
}
