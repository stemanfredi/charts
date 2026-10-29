// The drawing's file: a GeoJSON FeatureCollection (RFC 7946; docs/drawing-format.md). Any GIS
// reads it as it is, and this app reads any GeoJSON (what is not its own becomes plain points, lines
// and areas). Each element is a Feature with its real geometry; the user's properties and the common
// style names (stroke, fill…) are its properties; what is the app's own is under one key, "charts";
// the drawing's view, look, groups and rules are a member "charts" of the collection.
// Legs are geodesics, or a smooth curve through the vertices (other tools draw them straight in
// longitude and latitude: the geometry holds the vertices, "smooth" is the app's). Drawings of another format version are not read. Pure: no map, no DOM.

import { FORMAT, VERSION, KINDS, KIND, SYMBOLS, LEADERS, LABEL_OFFSET, META_D,
  emptyDoc, newId, columnsOf } from './document.js';
import { ID, isObj, fin, Skip, time, text, properties, flag, position, angle, ownStyle, look, pointSpec, parts, readView, VIEW_D, VIEW_DATA_D } from './check.js';
import { resolve, targetPosition } from './attach.js';
import { groupSizeOf, patternOf, DISTRIBUTE_D, CONNECT_D } from './generator.js';
import { positionsOf } from './lines.js';
import { norm180, samePosition, signedArea2 } from '../geo.js';

const SIDES = ['left', 'right', 'alternate'];
const MAX_LABEL_OFFSET = 2000; // px: a label's text from its anchor
const MAX_POSITIONS = 100000; // positions in one line or area: more would stall the page at every change
const MAX_FEATURES = 20000; // elements in one file: the rest are skipped (as many points stall the list)
const MAX_TOTAL_POSITIONS = 1000000; // positions in a file's lines and areas together: more is refused, as soon as read
class Refused extends Error {}
// the properties a feature's own are written beside: a user's key that is one of these gets a p_
const FILE_PROPERTIES = ['name', 'stroke', 'stroke-width', 'stroke-opacity', 'fill', 'fill-opacity', 'charts'];
const GEOMETRIES = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'];

// ---- reading ---------------------------------------------------------------------------------

// A file's text → { doc, view, report }. doc is null when the file is refused (report.refused says why);
// view: the map's view the file was made in (page state, not the document's), or null;
// otherwise every element that could be read, completed with defaults, and the report lists what was
// skipped (and why) and what was repaired. known: what the app offers, to check the view's layers:
// { layers: { id: { variants, periods } }, data: { id: [variants] }, depths: [metres] }. now: the time
// to give a file without one.
export function parse(text, known = null, now = Date.now()) {
  const report = { refused: null, skipped: [], warnings: [] };
  const refuse = (why) => { report.refused = why; return { doc: null, view: null, report }; };
  let raw;
  try { raw = JSON.parse(text); } catch { return refuse('This is not a drawing file: it is not JSON.'); }
  if (!isObj(raw)) return refuse('This is not a drawing file: it holds no document.');
  if (raw.type !== 'FeatureCollection' && raw.type !== 'Feature' && !GEOMETRIES.includes(raw.type)) return refuse('This is neither a drawing file nor GeoJSON.');
  const app = isObj(unpack(raw.charts)) ? unpack(raw.charts) : null; // as text: a GIS may write it so
  if (app && app.version !== undefined && +app.version !== VERSION) return refuse(`This drawing is of format version ${app.version}; this app reads version ${VERSION}.`);
  const { doc, view } = read(raw, app, known, now, report);
  return report.refused ? { doc: null, view: null, report } : { doc, view, report };
}

// a value a GIS may have written back as text (a nested value): read again
const unpack = (v) => { if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return v; try { return JSON.parse(v); } catch { return v; } };

function read(raw, app, known, now, report) {
  const doc = emptyDoc(now);
  let view = null;
  const taken = new Set();
  const ctx = (kind, id) => ({
    warn: (t) => report.warnings.push(`${kind}${id ? ` ${id}` : ''}: ${t}`),
    skip: (reason) => { throw new Skip(reason); },
  });
  const attempt = (kind, id, fn) => {
    try { return fn(ctx(kind, id)); } catch (e) {
      if (!(e instanceof Skip)) throw e;
      report.skipped.push({ kind, id, reason: e.message });
      return null;
    }
  };
  // an element's ID: its own, if valid and not used yet; else a new one (warned when it had one)
  const idOf = (v, c) => {
    const id = typeof v === 'number' ? String(v) : v;
    if (typeof id === 'string' && ID.test(id) && !taken.has(id)) { taken.add(id); return id; }
    if (id != null) c.warn(id && taken.has(id) ? 'ID already used; a new one given' : 'malformed ID; a new one given');
    return newId(doc, taken);
  };

  // the drawing's own: times, meta, view, groups
  if (app) {
    doc.created = time(app.created) || doc.created;
    doc.modified = time(app.modified) || doc.modified;
    if (app.meta !== undefined) {
      const c = ctx('meta'), m = isObj(app.meta) ? app.meta : (c.warn('not an object, ignored'), {});
      doc.meta = { title: text(m.title, c, 'title'), description: text(m.description, c, 'description'), author: text(m.author, c, 'author') };
    }
    if (app.view != null) view = readView(app.view, known, ctx('view'));
    doc.look = look(app.look, ctx('look'), 'drawing');
    for (const x of Array.isArray(app.groups) ? app.groups : []) {
      const g = attempt('group', x?.id, (c) => {
        if (!isObj(x)) c.skip('not an object');
        const id = typeof x.id === 'string' && ID.test(x.id) && !taken.has(x.id) ? x.id : c.skip('no valid ID');
        taken.add(id);
        return { ...commonOf(x, c), id, groupId: typeof x.groupId === 'string' ? x.groupId : null }; // a group has no look: its members' own
      });
      if (g) doc.groups.push(g);
    }
    // each group's parent: one of the drawing's, never itself nor a group inside it
    const byId = new Map(doc.groups.map((g) => [g.id, g]));
    for (const g of doc.groups) {
      if (g.groupId == null) continue;
      const c = ctx('group', g.id);
      let up = byId.get(g.groupId);
      if (!up) { c.warn(`group ${String(g.groupId).slice(0, 64)} not found; now at the top`); g.groupId = null; continue; }
      const seen = new Set([g]);
      while (up && !seen.has(up)) { seen.add(up); up = byId.get(up.groupId); }
      if (up) { c.warn('in a group inside itself; now at the top'); g.groupId = null; }
    }
  }
  const groups = new Set(doc.groups.map((g) => g.id));
  const groupOf = (v, c) => {
    if (v == null) return null;
    if (groups.has(v)) return v;
    c.warn(`group ${String(v).slice(0, 64)} not found; now standalone`);
    return null;
  };

  // the features, each part of a Multi geometry an element of its own
  const features = raw.type === 'FeatureCollection' ? (Array.isArray(raw.features) ? raw.features : (report.warnings.push('features: not a list, ignored'), []))
    : raw.type === 'Feature' ? [raw] : [{ type: 'Feature', properties: {}, geometry: raw }];
  const ends = []; // lines' attached ends, resolved once every point is read
  const anchored = []; // labels on an element, resolved once every element is read
  let over = 0, positions = 0;
  try { features.forEach((f, i) => {
    const fid = isObj(f) && (typeof f.id === 'string' || typeof f.id === 'number') ? String(f.id) : null;
    const skip = (reason) => report.skipped.push({ kind: 'feature', id: fid ?? String(i + 1), reason }); // a feature without an ID: its place in the list
    if (!isObj(f) || f.type !== 'Feature') { skip('not a Feature'); return; }
    const g = f.geometry;
    if (!isObj(g)) { skip('no geometry'); return; }
    const props = isObj(f.properties) ? f.properties : {};
    const own = unpack(props.charts);
    const mine = isObj(own) ? own : null;
    if (typeof g.type !== 'string') { skip('geometry type: not text'); return; }
    const parts = g.type === 'GeometryCollection' ? null : g.type.startsWith('Multi')
      ? (Array.isArray(g.coordinates) ? g.coordinates.map((coordinates) => ({ type: g.type.slice(5), coordinates })) : [])
      : [g];
    if (!parts) { skip('a geometry collection: not read'); return; }
    parts.forEach((part, k) => {
      if (doc.points.length + doc.lines.length + doc.areas.length + doc.labels.length >= MAX_FEATURES) { over++; return; } // a Multi geometry: each part an element
      const kind = mine?.kind === 'label' && part.type === 'Point' ? 'label' : { Point: 'point', LineString: 'line', Polygon: 'area' }[part.type];
      if (!kind) { skip(`geometry ${String(part.type).slice(0, 20)}: not read`); return; }
      const el = attempt(kind, fid, (c) => {
        const id = idOf(k ? null : f.id, c);
        const x = { ...commonOf({ ...propertiesFrom(props, mine, c), visible: mine?.visible }, c), id, groupId: groupOf(mine?.group, c) };
        x.look = look(mine?.look, c, kind);
        if (kind !== 'label') { // its colours, opacities and width: the common style names
          const st = styleFrom(props, c, kind !== 'line');
          for (const part of ['fill', 'stroke']) if (st[part]) x.look[part] = { ...x.look[part], ...st[part] };
          x.guide = flag(mine?.guide, c, 'guide');
        }
        return READ[kind](part.coordinates, props, mine || {}, x, c, { ends, anchored, taken, doc, foreign: !mine });
      });
      positions += el?.vertices ? el.vertices.length + 2 : el?.points?.length ?? 0; // a line's, an area's
      if (positions > MAX_TOTAL_POSITIONS) throw new Refused(`This file holds more than ${MAX_TOTAL_POSITIONS.toLocaleString('en')} positions in its lines and areas: it would stall the page at every change.`);
      if (el) doc[KIND[kind].list].push(el);
    });
  }); } catch (e) { if (!(e instanceof Refused)) throw e; report.refused = e.message; return { doc: null, view: null }; }

  // a line's end attached: the attachment wins, the end goes where what it is attached to is
  let moved = 0;
  if (over) report.warnings.push(`${over} past the first ${MAX_FEATURES} elements: skipped`);
  for (const { line, end, to } of ends) {
    const p = to.element !== line.id && targetPosition(doc, to);
    if (!p) { report.warnings.push(`line ${line.id}: its ${end} is attached to ${String(to.element).slice(0, 64)}, which is not here (or has no such vertex or edge); free`); continue; }
    if (!samePosition(p, line[end].position)) moved++; // more than the file's rounding
    line[end] = { position: [...p], ...to };
  }
  if (moved) report.warnings.push(`${moved} line end${moved > 1 ? 's' : ''} moved to what ${moved > 1 ? 'they are' : 'it is'} attached to (the file was edited elsewhere)`);
  // a label on an element: where it points; on one that is not here (or no such vertex or edge): free,
  // where it was
  for (const { label, to } of anchored) {
    const p = targetPosition(doc, to);
    if (!p) { report.warnings.push(`label ${label.id}: what it points at (${String(to.element).slice(0, 64)}) is not here; free`); continue; }
    label.anchor = { position: [...p], ...to };
  }

  // rules: what Distribute along and Connect keep linked, checked loosely (a reference gone is dropped at
  // the next change)
  const idList = (v) => (Array.isArray(v) ? v.filter((y) => typeof y === 'string' && ID.test(y)) : []);
  const pair = (p) => Array.isArray(p) && fin(p[0]) && fin(p[1]);
  const ref = (v) => (typeof v === 'string' && ID.test(v) ? v : null);
  for (const x of Array.isArray(app?.rules) ? app.rules : []) {
    const r = attempt('rule', x?.id, (c) => {
      if (!isObj(x) || !ref(x.id) || taken.has(x.id)) c.skip('no valid ID');
      if (x.kind !== 'distribute' && x.kind !== 'connect') c.skip(`unknown kind "${String(x.kind).slice(0, 20)}"`);
      if (x.kind === 'distribute') {
        const along = isObj(x.along) ? ref(x.along.element) : null;
        if (!along) c.skip('nothing it is along');
        taken.add(x.id);
        const D = DISTRIBUTE_D, d = (k) => (fin(x[k]) && x[k] >= 0 ? x[k] : D[k]);
        const copy = isObj(x.copy) ? pointSpec(x.copy, c) : null;
        return { id: x.id, kind: 'distribute', groupId: ref(x.groupId), copiesId: ref(x.copiesId), along: { element: along, part: Number.isInteger(x.along.part) && x.along.part >= 0 ? x.along.part : null },
          spacing: fin(x.spacing) && x.spacing > 0 ? x.spacing : D.spacing, count: Number.isInteger(x.count) && x.count > 0 ? x.count : D.count,
          startMargin: d('startMargin'), endMargin: d('endMargin'), offset: d('offset'), side: SIDES.includes(x.side) ? x.side : D.side,
          radius: fin(x.radius) && x.radius > 0 ? x.radius : D.radius, aperture: fin(x.aperture) && x.aperture > 0 && x.aperture < 360 ? x.aperture : D.aperture,
          preset: typeof x.preset === 'string' ? x.preset : D.preset, copy: copy?.parts.length ? copy : D.copy,
          points: Array.isArray(x.points) ? x.points.filter((f) => isObj(f) && ref(f.pointId) && fin(f.t) && pair(f.pos)).map((f) => ({ pointId: f.pointId, t: f.t, left: f.left === true, pos: [f.pos[0], f.pos[1]] })) : [] };
      }
      taken.add(x.id);
      const pattern = patternOf(x.pattern);
      return { id: x.id, kind: 'connect', groupId: ref(x.groupId), pattern, groupSize: groupSizeOf(x.groupSize, pattern),
        minBranch: fin(x.minBranch) && x.minBranch > 0 ? x.minBranch : CONNECT_D.minBranch, pointIds: idList(x.pointIds),
        roots: Array.isArray(x.roots) ? x.roots.filter((r) => isObj(r) && ref(r.id)).map((r) => ({ id: r.id, weight: fin(r.weight) && r.weight > 0 ? r.weight : 1 })) : [],
        hubs: Array.isArray(x.hubs) ? x.hubs.filter((b) => isObj(b) && ref(b.pointId) && ref(b.rootId) && Array.isArray(b.pointIds) && pair(b.pos))
          .map((b) => ({ pointId: b.pointId, pointIds: idList(b.pointIds), rootId: b.rootId, pos: [b.pos[0], b.pos[1]] })) : [],
        created: idList(x.created) };
    });
    if (r) doc.rules.push(r);
  }
  return { doc, view };
}

// a feature's name and the user's properties (a description, a category: properties like any other):
// the app's own list when it wrote one (keys a GIS column could not hold), else the feature's other
// properties, as text. A feature from elsewhere (no `charts` of the app's) may say its name as Name or
// title; the app's own features only as name (a user's property "title" stays one)
function propertiesFrom(props, mine, c) {
  const pick = (...keys) => keys.map((k) => props[k]).find((v) => v != null);
  const asText = (v) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const aliases = mine ? [] : ['Name', 'title'];
  const list = Array.isArray(unpack(mine?.properties)) ? unpack(mine.properties)
    : Object.entries(props).filter(([k]) => !FILE_PROPERTIES.includes(k) && !aliases.includes(k)).map(([key, value]) => ({ key, value: asText(value) }));
  return { name: text(pick('name', ...aliases) ?? '', c, 'name'), properties: list };
}
// name, properties, visible, as elements and groups have them
function commonOf(x, c) {
  if (x.visible !== undefined && typeof x.visible !== 'boolean') c.warn('visible is not true or false; true used');
  return { name: text(x.name, c, 'name'), properties: properties(x.properties, c), visible: x.visible !== false };
}
// an element's own colours, opacities and stroke width, from the common style names
function styleFrom(props, c, fill) {
  const s = {};
  const put = (part, field, v) => { if (v !== undefined) (s[part] ??= {})[field] = v; };
  put('stroke', 'color', props.stroke); put('stroke', 'width', props['stroke-width']); put('stroke', 'opacity', props['stroke-opacity']);
  if (fill) { put('fill', 'color', props.fill); put('fill', 'opacity', props['fill-opacity']); }
  return ownStyle(s, c, fill);
}
const coord = (p, c, what) => position(Array.isArray(p) ? p.slice(0, 2) : p, c, what);

// what a reference points at, as the file says it ({ element, part?, vertex | edge and at }; a bare ID: an
// element's centre), or null
function refIn(v) {
  if (typeof v === 'string') return { element: v };
  if (!isObj(v) || typeof v.element !== 'string') return null;
  const n = (k) => (Number.isInteger(v[k]) && v[k] >= 0 ? v[k] : undefined);
  const on = { element: v.element, ...(n('part') !== undefined ? { part: n('part') } : {}) };
  return n('vertex') !== undefined ? { ...on, vertex: n('vertex') }
    : n('edge') !== undefined ? { ...on, edge: n('edge'), at: fin(v.at) ? Math.min(1, Math.max(0, v.at)) : 0 } : { element: v.element };
}
// each kind's reader: (coordinates, properties, the app's own, the element so far, ctx, state) → element
const READ = {
  point(coords, props, mine, x, c, { foreign }) {
    const p = { ...x, position: coord(coords, c, 'position'), bearing: mine.bearing === undefined ? 0 : angle(mine.bearing, c, 'bearing') };
    p.parts = parts(mine.parts, c);
    const dflt = foreign ? 'diamond' : 'none'; // a point from another tool: a diamond, to be seen
    p.symbol = SYMBOLS.includes(mine.symbol) ? mine.symbol : (mine.symbol !== undefined && c.warn(`unknown symbol "${String(mine.symbol).slice(0, 20)}", default used`), dflt);
    return p;
  },
  line(coords, props, mine, x, c, { ends }) {
    if (!Array.isArray(coords) || coords.length < 2) c.skip('a line needs two positions');
    if (coords.length > MAX_POSITIONS) c.skip(`more than ${MAX_POSITIONS} positions`);
    const pts = coords.map((q, k) => coord(q, c, `position ${k + 1}`));
    const meta = Array.isArray(mine.vertices) ? mine.vertices : [];
    const s = { ...x, start: { position: pts[0], element: null }, end: { position: pts.at(-1), element: null },
      smooth: flag(mine.smooth, c, 'smooth'),
      vertices: pts.slice(1, -1).map((position, k) => {
        const v = isObj(meta[k]) ? meta[k] : {};
        return { position, name: text(v.name, c, `vertex ${k + 1} name`) };
      }) };
    // its ends attached: { element, vertex | edge and at } (attach.js)
    for (const end of ['start', 'end']) {
      const v = unpack(mine[end]), to = refIn(v);
      if (to) ends.push({ line: s, end, to });
      else if (v != null) c.warn(`${end}: not what a line's end is attached to; free`);
    }
    return s;
  },
  area(coords, props, mine, x, c) {
    if (!Array.isArray(coords) || !Array.isArray(coords[0])) c.skip('no ring');
    if (coords.length > 1) c.warn('holes are not read; the outer ring only');
    if (coords[0].length > MAX_POSITIONS) c.skip(`more than ${MAX_POSITIONS} corners`);
    let pts = coords[0].map((q, k) => coord(q, c, `corner ${k + 1}`));
    if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts = pts.slice(0, -1);
    if (pts.length < 3) c.skip('an area needs 3 corners');
    if (mine.reversed === true) pts.reverse();
    return { ...x, points: pts };
  },
  label(coords, props, mine, x, c, { anchored }) {
    const at = coord(coords, c, 'position');
    const o = mine.offset;
    const offset = Array.isArray(o) && o.length >= 2 && fin(o[0]) && fin(o[1]) ? [Math.max(-MAX_LABEL_OFFSET, Math.min(MAX_LABEL_OFFSET, o[0])), Math.max(-MAX_LABEL_OFFSET, Math.min(MAX_LABEL_OFFSET, o[1]))]
      : (o !== undefined && c.warn('offset: not [x, y] pixels, the default used'), [...LABEL_OFFSET]);
    const one = (v, list, d, what) => (v === undefined ? d : list.includes(v) ? v : (c.warn(`${what}: unknown "${String(v).slice(0, 20)}", ${d} used`), d));
    const a = { ...x, text: text(mine.text, c, 'text'), anchor: { position: at, element: null }, offset, leader: one(mine.leader, LEADERS, 'arrow', 'leader') };
    const to = refIn(unpack(mine.anchor));
    if (to) anchored.push({ label: a, to });
    return a;
  },
};

// ---- writing ---------------------------------------------------------------------------------

const r7 = (v) => +v.toFixed(7), r3 = (v) => +v.toFixed(3), r4 = (v) => +v.toFixed(4);
const pos = (p) => [r7(norm180(p[0])), r7(p[1])]; // a click past ±180° is kept as the map has it, written in range (§2)
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// o without the fields equal to their defaults d; an object field against an object default field by
// field, left out when nothing in it differs
function lean(o, d) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (!(k in d)) out[k] = v;
    else if (isObj(v) && isObj(d[k])) { const sub = lean(v, d[k]); if (Object.keys(sub).length) out[k] = sub; } else if (!sameJson(v, d[k])) out[k] = v;
  }
  return out;
}
const partOut = (r) => lean({ kind: r.kind, radius: r.radius && r3(r.radius), aperture: r.aperture && r4(r.aperture), length: r.length && r3(r.length), width: r.width && r3(r.width),
  fill: r.fill, shown: r.shown, name: r.name },
{ radius: undefined, aperture: undefined, length: undefined, width: undefined, fill: true, shown: true, name: '' });
const VERTEX_D = { name: '' };

// the user's properties as GIS columns (features.js), their keys checked against the file's own
const columns = (list) => columnsOf(list, FILE_PROPERTIES);
// A look as the file has it: what it sets, numbers rounded. simple: an element's, whose colours,
// opacities and stroke width are the common style names (styleNames), not here.
function lookOut(l, simple = false) {
  const out = {};
  for (const part of ['fill', 'stroke']) {
    const v = Object.fromEntries(Object.entries(l[part] ?? {}).filter(([k]) => !simple || k === 'dash').map(([k, x]) => [k, typeof x === 'number' ? r3(x) : x]));
    if (Object.keys(v).length) out[part] = v;
  }
  if (l.text && Object.keys(l.text).length) out.text = { ...l.text };
  if (l.offset != null) out.offset = r3(l.offset);
  if (l.minSize != null) out.minSize = r3(l.minSize);
  return out;
}
// an element's own colours, opacities and stroke width as the common style names
function styleNames(st) {
  const o = {};
  if (st.stroke?.color) o.stroke = st.stroke.color;
  if (st.stroke?.width !== undefined) o['stroke-width'] = r3(st.stroke.width);
  if (st.stroke?.opacity !== undefined) o['stroke-opacity'] = r3(st.stroke.opacity);
  if (st.fill?.color) o.fill = st.fill.color;
  if (st.fill?.opacity !== undefined) o['fill-opacity'] = r3(st.fill.opacity);
  return o;
}
// what a reference (a line's end, a label's anchor) points at, as the file says it: nothing (null), or
// { element, vertex | edge and at } (its position is the geometry's)
const endOut = (e) => {
  if (!e.element) return null;
  const on = { element: e.element, ...(e.part != null ? { part: e.part } : {}) };
  return e.vertex != null ? { ...on, vertex: e.vertex } : e.edge != null ? { ...on, edge: e.edge, at: +e.at.toFixed(6) } : { element: e.element };
};

// one element as a Feature
function feature(doc, kind, el) {
  const { out: cols, changed } = columns(el.properties);
  const props = Object.assign(Object.create(null), lean({ name: el.name }, { name: '' })); // no prototype: a column named __proto__ is set, not the prototype
  Object.assign(props, cols, kind === 'label' ? {} : styleNames(el.look));
  const mine = { kind, ...(changed ? { properties: el.properties.map((p) => ({ ...p })) } : {}),
    ...lean({ group: el.groupId, visible: el.visible, guide: el.guide ?? false, look: lookOut(el.look, kind !== 'label') }, { group: null, visible: true, guide: false, look: {} }) };
  let geometry;
  if (kind === 'point') {
    geometry = { type: 'Point', coordinates: pos(el.position) };
    Object.assign(mine, lean({ symbol: el.symbol, bearing: r4(el.bearing) }, { symbol: 'none', bearing: 0 }));
    if (el.parts.length) mine.parts = el.parts.map(partOut);
  } else if (kind === 'line') {
    geometry = { type: 'LineString', coordinates: positionsOf(el).map(pos) };
    const vs = el.vertices.map((v) => lean({ name: v.name }, VERTEX_D));
    Object.assign(mine, lean({ start: endOut(el.start), end: endOut(el.end), smooth: el.smooth },
    { start: null, end: null, smooth: false }));
    if (vs.some((v) => Object.keys(v).length)) mine.vertices = vs;
  } else if (kind === 'area') {
    // counter-clockwise, as RFC 7946 asks; a ring stored clockwise is written reversed, and says so
    const cw = signedArea2(el.points) < 0, pts = cw ? el.points.slice().reverse() : el.points;
    geometry = { type: 'Polygon', coordinates: [[...pts, pts[0]].map(pos)] };
    if (cw) mine.reversed = true;
  } else {
    const at = resolve(doc, el.anchor);
    geometry = { type: 'Point', coordinates: pos(at ? at.position : el.anchor.position ?? [0, 0]) };
    Object.assign(mine, lean({ text: el.text, anchor: endOut(el.anchor),
      offset: [r3(el.offset[0]), r3(el.offset[1])], leader: el.leader }, { text: '', anchor: null, offset: LABEL_OFFSET, leader: 'arrow' }));
  }
  return { type: 'Feature', id: el.id, geometry, properties: { ...props, charts: mine } };
}

// The document as the file's object (with the view it is in: the map's, page state the file carries):
// a FeatureCollection, what differs from the defaults, rounded as the format says.
export function toFile(doc, v = null) {
  const app = lean({
    format: FORMAT, version: VERSION, created: doc.created, modified: doc.modified,
    meta: lean(doc.meta, META_D),
    view: v ? lean({ center: v.center && pos(v.center), zoom: v.zoom === null ? null : r4(v.zoom), bearing: r4(v.bearing), layers: v.layers && v.layers.map((l) => ({ ...l })),
      data: v.data && lean({ colour: v.data.colour && { ...v.data.colour }, arrows: v.data.arrows && { ...v.data.arrows }, time: v.data.time, depth: v.data.depth }, VIEW_DATA_D),
      units: v.units, bearings: v.bearings === true }, { ...VIEW_D, data: {} }) : null,
    look: lookOut(doc.look),
    groups: doc.groups.map((g) => lean({ id: g.id, groupId: g.groupId, name: g.name, properties: g.properties.map((p) => ({ ...p })), visible: g.visible },
      { groupId: null, name: '', properties: [], visible: true })),
    rules: doc.rules.map((a) => (a.kind === 'distribute'
      ? lean({ ...a, along: { element: a.along.element, ...(a.along.part != null ? { part: a.along.part } : {}) }, spacing: a.spacing == null ? null : r3(a.spacing), radius: a.radius == null ? null : r3(a.radius),
        aperture: a.aperture == null ? null : r4(a.aperture), startMargin: r3(a.startMargin), endMargin: r3(a.endMargin), offset: r3(a.offset),
        copy: a.copy && lean({ symbol: a.copy.symbol, parts: a.copy.parts.map(partOut), look: lookOut(a.copy.look ?? {}) }, { look: {} }),
        points: a.points.map((f) => ({ pointId: f.pointId, t: +f.t.toFixed(9), ...(f.left ? { left: true } : {}), pos: pos(f.pos) })) }, DISTRIBUTE_D)
      : lean({ ...a, roots: a.roots.map((r) => (r.weight === 1 ? { id: r.id } : { id: r.id, weight: +r.weight.toPrecision(6) })), pointIds: [...a.pointIds], hubs: a.hubs.map((b) => ({ ...b, pointIds: [...b.pointIds], pos: pos(b.pos) })), created: [...a.created] }, CONNECT_D))),
  }, { meta: {}, view: null, look: {}, groups: [], rules: [] });
  return { type: 'FeatureCollection', charts: app, features: KINDS.filter((k) => k !== 'group').flatMap((k) => doc[KIND[k].list].map((el) => feature(doc, k, el))) };
}
// The file's text: indented JSON, with each pair of numbers (a position) on one line. Only
// the indentation's line breaks are matched: a string never holds one (JSON writes it \n).
export function serialise(doc, view = null) {
  return `${JSON.stringify(toFile(doc, view), null, 2).replace(/\[\n\s*(-?[\d.e+-]+),\n\s*(-?[\d.e+-]+)\n\s*\]/g, '[$1, $2]')}\n`;
}
