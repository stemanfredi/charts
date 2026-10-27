// The drawing document (docs/drawing-format.md): its elements, and the operations on them. Pure:
// no map, no DOM, so the tests run it in Node. The file is file.js's (GeoJSON).
//
// Four primitives and the group:
//   point: one position; a symbol (screen size) and its parts about it, to scale (circles, sectors,
//     outlines), one bearing for the outlines' front and the sectors' centre;
//   line: vertices joined by legs, its two ends free positions or attached to a point (following it);
//   area: a free polygon;
//   label: text pointing at an element, or free;
//   group: members sharing a look, field by field; a group can be in a group (its parent).
// Any element can be a guide (supporting geometry: faint, left out of totals). How each is drawn is
// its look (docs/drawing-ui.md §5): its own values, else its groups', else the drawing's.


export const FORMAT = 'charts-drawing';
export const VERSION = 1; // the drawing's version: this code writes and reads it, and no other

// a shape whose long side is shorter than this on screen (px) is drawn enlarged (display only);
// 0 turns it off. The drawing's value, unless a shape has its own.
const MIN_DISPLAY_SIZE = 12;
export const MAX_OFFSET = 50; // px: Offset's reach either side of a line
export const MAX_MIN_SIZE = 200; // px: the largest minimum display size
export const STROKE_WIDTH = [0.5, 20]; // px: a stroke's width, least and most
export const DEFAULT_STYLE = Object.freeze({
  fill: Object.freeze({ color: '#e8590c', opacity: 0.15 }),
  stroke: Object.freeze({ color: '#e8590c', opacity: 1, width: 1.5, dash: 'solid' }),
});
// what a guide is drawn with, unless it or its group says otherwise: faint, dashed, one colour
export const GUIDE_STROKE = Object.freeze({ color: '#6b7a86', opacity: 1, width: 1, dash: 'dashed' });
export const GUIDE_STYLE = Object.freeze({ fill: Object.freeze({ color: '#6b7a86', opacity: 0.05 }), stroke: GUIDE_STROKE });
// what a measurement (a guide showing its values, Measure's tools make) is drawn with
const MEASURE_COLOUR = '#b0127a';
export const MEASURE_STYLE = Object.freeze({ fill: Object.freeze({ color: MEASURE_COLOUR, opacity: 0.08 }),
  stroke: Object.freeze({ color: MEASURE_COLOUR, opacity: 1, width: 2, dash: 'dashed' }) });
// A look: how an element is drawn. Every field optional where it is set (an element's, a group's, the
// drawing's); the defaults fill it in. fill, stroke: as a style; text: its name on the map, its values
// shown, and a label's size, colour (null: its group's stroke colour, else the default) and
// background; offset: a line drawn this many px to the right of where it is (negative: left; 0: on
// it; display only); minSize: a small outline drawn enlarged below it
// (px, 0: never; for a vehicle, twice the drawing's).
const LOOK_TEXT = Object.freeze({ name: false, values: false, size: 'medium', color: null, background: 'halo' });
export const DEFAULT_LOOK = Object.freeze({ fill: DEFAULT_STYLE.fill, stroke: DEFAULT_STYLE.stroke, text: LOOK_TEXT, offset: 0, minSize: MIN_DISPLAY_SIZE });
export const SYMBOLS = ['diamond', 'square', 'triangle', 'dot', 'none'];
export const DASHES = ['solid', 'dashed', 'dotted'];
export const OUTLINES = ['rectangle', 'triangle', 'ellipse', 'aerial-vehicle', 'surface-vehicle', 'underwater-vehicle']; // outlines.js draws them
// A point's parts (docs/drawing-ui.md §5): round ones (a circle, its radius; a sector, its radius
// and aperture, centred on the point's bearing; an arc, a sector's curved edge alone, never filled)
// and outlines (a length along the bearing and a width).
// Each has its own Fill and Shown switches, a name, and its own stroke colour and dash (null: the
// point's).
export const ROUND = ['circle', 'sector', 'arc'];
export const ARCED = new Set(['sector', 'arc']); // a round part with an aperture
export const PART_KINDS = [...ROUND, ...OUTLINES];
export const isRound = (part) => ROUND.includes(part.kind);
export function makePart(kind, size = {}) {
  const part = { kind, fill: true, shown: true, name: '', strokeColor: null, strokeDash: null };
  if (ROUND.includes(kind)) part.radius = size.radius ?? NEW_RADIUS; else { part.length = size.length ?? 100; part.width = size.width ?? 50; }
  if (ARCED.has(kind)) part.aperture = size.aperture ?? 90;
  if (kind === 'arc') part.fill = false;
  return part;
}
// a part's reach from the point: its radius, or half its length (along the bearing)
export const reachOf = (part) => (isRound(part) ? part.radius : part.length / 2);
// its round parts, its outline parts ({ part, i }: i its place in the list)
export const roundParts = (p) => p.parts.map((part, i) => ({ part, i })).filter((x) => isRound(x.part));
export const outlineParts = (p) => p.parts.map((part, i) => ({ part, i })).filter((x) => !isRound(x.part));
// its largest outline ({ part, i }), or null: what its handles turn, what it is named by
export const mainOutline = (p) => outlineParts(p).reduce((a, b) => (!a || reachOf(b.part) > reachOf(a.part) ? b : a), null);
// the round part a distribution follows by default: the first filled, else the first; null: none
export const followedPart = (p) => { const r = roundParts(p); return (r.find((x) => x.part.fill) ?? r[0])?.i ?? null; };
// The kinds of element: the document's list each lives in, and its name in the panel. In this order
// (the file's, and the list's). How each is drawn, exported and moved: features.js; edited: panel.js.
export const KIND = {
  group: { list: 'groups', name: 'Group' }, point: { list: 'points', name: 'Point' }, line: { list: 'lines', name: 'Line' },
  area: { list: 'areas', name: 'Area' }, label: { list: 'labels', name: 'Label' },
};
export const KINDS = Object.keys(KIND);
const LIST = Object.fromEntries(KINDS.map((k) => [k, KIND[k].list]));
// labels (docs/drawing-format.md §7.7): their leader's end, text size, background
export const LEADERS = ['arrow', 'dot', 'line', 'none'];
export const LABEL_SIZES = ['small', 'medium', 'large'];
export const BACKGROUNDS = ['halo', 'box'];
const LABEL_COLOUR = '#1f2933'; // a label's text, unless it or the drawing sets one
export const LABEL_OFFSET = Object.freeze([40, -40]); // px: a new label's text, up and to the right of what it points at
const NEW_RADIUS = 1000; // a new point's one radius: a neutral starting value, not a preset
export const MAX_RADIUS = 1e7;

const clone = (x) => structuredClone(x);
export const isoNow = (now) => new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');

// ---- IDs -----------------------------------------------------------------------------------

// every ID in use: elements and rules
export function idsOf(doc) {
  const ids = new Set();
  for (const k of KINDS) for (const el of doc[LIST[k]]) ids.add(el.id);
  for (const x of doc.rules) ids.add(x.id);
  return ids;
}
// a new random 8-character ID, not in use (taken: the set of IDs in use, updated)
export function newId(doc, taken = idsOf(doc)) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    const id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => abc[b % 36]).join('');
    if (!taken.has(id)) { taken.add(id); return id; }
  }
}

// The empty document at time now (ms).
export function emptyDoc(now = Date.now()) {
  const t = isoNow(now);
  return { created: t, modified: t, meta: { title: '', description: '', author: '' }, view: null, look: {},
    groups: [], points: [], lines: [], areas: [], labels: [], rules: [] };
}

// ---- reading the document --------------------------------------------------------------------

// every element as { kind, el }, kinds in KINDS order
export function elements(doc) {
  return KINDS.flatMap((kind) => doc[LIST[kind]].map((el) => ({ kind, el })));
}
export function find(doc, id) {
  for (const kind of KINDS) { const el = doc[LIST[kind]].find((x) => x.id === id); if (el) return { kind, el }; }
  return null;
}
export const kindName = (kind) => KIND[kind].name;
// the mean of a list of positions (an area's place, for its name and labels)
export const centroid = (pts) => [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
// where an element is: a point's position, an area's centroid, a line's start
export const placeOf = (kind, el) => (kind === 'point' ? el.position : kind === 'area' ? centroid(el.points) : kind === 'line' ? el.start.position : null);
// what the panel calls an element: its name, or for an unnamed one its kind and where it is
export function label(kind, el) {
  if (el.name?.trim()) return el.name;
  const at = placeOf(kind, el);
  return at ? `${KIND[kind].name} · ${at[1].toFixed(4)}, ${at[0].toFixed(4)}` : `${KIND[kind].name} ${el.id}`;
}
// "Point 4": the next free number among the kind's names (base: another word than the kind's); a bare
// "Base" counts as 1
export function nextName(doc, kind, base = KIND[kind].name) {
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: (\\d+))?$`);
  const used = doc[LIST[kind]].map((e) => re.exec(e.name)).filter(Boolean).map((m) => (m[1] ? +m[1] : 1));
  return `${base} ${used.length ? Math.max(...used) + 1 : 1}`;
}
// What kind of point it is, for its name and icon: its largest outline's kind; else, by its round
// parts, 'sector' (one is), 'arc' (one is), 'rings' (several) or 'circle'; else 'point' (a symbol). Every one is a
// point in the file.
export function pointKind(p) {
  const o = mainOutline(p), r = roundParts(p);
  if (o) return o.part.kind;
  const has = (k) => r.some((x) => x.part.kind === k);
  return !r.length ? 'point' : has('sector') ? 'sector' : has('arc') ? 'arc' : r.length > 1 ? 'rings' : 'circle';
}
export const POINT_KIND_NAME = { point: 'Point', circle: 'Circle', rings: 'Rings', sector: 'Sector', arc: 'Arc' };

const groupOf = (doc, el) => (el.groupId ? doc.groups.find((g) => g.id === el.groupId) : null);
// The groups an element (or a group) is in, the nearest first: its group, that group's, and so on
export function groupsOf(doc, el) {
  const out = [];
  for (let g = groupOf(doc, el); g && g !== el && !out.includes(g); g = groupOf(doc, g)) out.push(g);
  return out;
}
// What is in group gid: its members and subgroups (deep: and theirs, all the way down)
export function membersOf(doc, gid, deep = false) {
  return elements(doc).filter((x) => (deep ? groupsOf(doc, x.el).some((g) => g.id === gid) : x.el.groupId === gid));
}
// a measurement: its name not on the map, whatever the drawing's names
const MEASURE_LOOK = Object.freeze({ ...MEASURE_STYLE, text: Object.freeze({ name: false }) });
// looks laid one over another, field by field (a later one's values over an earlier one's)
function layered(looks) {
  const part = (k) => Object.assign({}, ...looks.map((l) => l?.[k]));
  const last = (k) => looks.reduce((v, l) => (l?.[k] != null ? l[k] : v), null);
  return { fill: part('fill'), stroke: part('stroke'), text: part('text'), offset: last('offset'), minSize: last('minSize') };
}
// The look an element (or a group; or the drawing, kind 'drawing': its defaults) is drawn with, every field: its own, else its group's, else that
// group's group's, and so on, else a guide's (faint, dashed) or a measurement's (a guide showing its
// values: as while it is measured), else the drawing's, else the defaults.
export function lookOf(doc, el) {
  const own = [el.look], under = [DEFAULT_LOOK, doc.look];
  const role = !el.guide ? null : layered([...under, ...own]).text.values ? MEASURE_LOOK : GUIDE_STYLE; // only points, lines and areas are guides
  return layered([...under, role, ...own]);
}
// its fill and stroke
export const styleOf = (doc, el) => { const l = lookOf(doc, el); return { fill: l.fill, stroke: l.stroke }; };
// a measurement: a guide showing its values (what Measure's tools make)
export const isMeasurement = (doc, el) => !!el.guide && lookOf(doc, el).text.values;
// a label's colour: its own, else the drawing's, else the default
export const labelColour = (doc, a) => lookOf(doc, a).text.color ?? LABEL_COLOUR;
// how far a line is drawn from where it is (Offset: px, positive to the right of its direction, 0: on it)
export const offsetOf = (doc, el) => lookOf(doc, el).offset;
// A point's minimum display size: { px, own } (own: set on it, not the drawing's, so a vehicle does
// not double it)
export function minSizeOf(doc, p) {
  const own = p.look.minSize;
  return own != null ? { px: own, own: true } : { px: doc.look.minSize ?? MIN_DISPLAY_SIZE, own: false };
}
// Set one field of x's own look (path: 'offset', 'fill.color', 'text.name'…); undefined takes it back
// (the value then comes from the drawing, or the defaults).
export function setLook(x, path, v) {
  const [a, b] = path.split('.');
  if (!b) { if (v === undefined) delete x.look[a]; else x.look[a] = v; return; }
  const part = { ...x.look[a] };
  if (v === undefined) delete part[b]; else part[b] = v;
  if (Object.keys(part).length) x.look[a] = part; else delete x.look[a];
}
// the field at path of a look
export const lookField = (l, path) => path.split('.').reduce((o, k) => o?.[k], l);
// whether an element is drawn: shown itself, and every group it is in too (a hidden group hides
// everything in it)
export function isShown(doc, el) {
  return !!el.visible && groupsOf(doc, el).every((g) => g.visible !== false);
}

// ---- making elements (they change doc in place; the caller keeps the undo snapshot) -----------

export function touch(doc, now = Date.now()) { doc.modified = isoNow(now); }

const base = (doc, kind, taken, name = nextName(doc, kind)) => ({ id: newId(doc, taken), name, properties: [], groupId: null, visible: true, ...(kind === 'group' ? {} : { look: {} }) }); // a group has no look: its members' own
// A point at position: a diamond with one circle unless opts say otherwise; opts set its other fields
// ({ symbol, parts, name, ... }).
export function addPoint(doc, position, opts = {}, taken = idsOf(doc)) {
  const p = { ...base(doc, 'point', taken), position: [...position], bearing: 0, symbol: 'diamond', parts: [makePart('circle')], guide: false, ...opts };
  doc.points.push(p);
  return p;
}
// a small dot: where lines meet (a split), a hub
export const addDot = (doc, position, taken = idsOf(doc)) => addPoint(doc, position, { symbol: 'dot', parts: [] }, taken);
// a point with one outline drawn to scale, no symbol
export function addShape(doc, position, kind = 'rectangle') {
  return addPoint(doc, position, { name: nextName(doc, 'point', 'Shape'), symbol: 'none', parts: [makePart(kind)] });
}
// an area through the positions (three or more), its edges geodesics
export function addArea(doc, points, opts = {}) {
  const g = { ...base(doc, 'area'), points: points.map((q) => [...q]), guide: false, ...opts };
  doc.areas.push(g);
  return g;
}
// a line's end: at a point (its ID: attached to its centre, following it), attached otherwise (an end
// { position, element, corner | edge and at | vertex }: attach.js), or a free position
const endOf = (doc, x) => (typeof x === 'string' ? { position: [...doc.points.find((p) => p.id === x).position], element: x }
  : Array.isArray(x) ? { position: [...x], element: null } : { ...structuredClone(x), position: [...x.position] });
// A line from start to end (each a point's ID, an attached end, or a position) through positions, its
// legs straight (geodesics), fixed. Returns it.
export function addLine(doc, start, positions, end, opts = {}) {
  const taken = idsOf(doc);
  const s = { ...base(doc, 'line', taken), start: endOf(doc, start), end: endOf(doc, end), startHandle: null, endHandle: null, mode: 'fixed',
    guide: false, vertices: positions.map((p) => vertex(p)), ...opts };
  doc.lines.push(s);
  return s;
}
const vertex = (p) => ({ position: [...p], handleIn: null, handleOut: null, name: '', properties: [] });
// a part added to a point: a round one twice the reach of the last round one (filled when it is the
// first), an outline of the default size; one taken away (by its place)
export function addPart(p, kind = 'circle') {
  const last = ROUND.includes(kind) ? roundParts(p).at(-1)?.part : null;
  const part = makePart(kind, last ? { radius: last.radius * 2, aperture: last.aperture } : {});
  if (last) part.fill = false;
  p.parts.push(part);
  return part;
}
export function removePart(p, i) { p.parts = p.parts.filter((_, k) => k !== i); }
// A label anchored as anchor (a reference, attach.js): on an element its name, and its text
// up and to the right with a leader; at a free position, the text there, no leader.
export function addLabel(doc, anchor) {
  const free = !anchor.element;
  const a = { ...base(doc, 'label'), text: free ? 'Text' : '{name}', anchor: clone(anchor), offset: free ? [0, 0] : [...LABEL_OFFSET], leader: free ? 'none' : 'arrow' };
  doc.labels.push(a);
  return a;
}

// ---- deleting -------------------------------------------------------------------------------------

// What deleting the elements ids takes with it: everything in a group, when withMembers (otherwise
// its members and subgroups go to the group above it). Lines attached to a point deleted stay, their
// ends free where they were; labels on it too. A Set of IDs.
export function dependents(doc, ids, withMembers = false) {
  const all = new Set(ids);
  if (withMembers) for (const { el } of elements(doc)) if (groupsOf(doc, el).some((g) => all.has(g.id))) all.add(el.id);
  return all;
}
// Delete ids and what goes with them (dependents); the members and subgroups of a deleted group go to
// the group above it (or none), unless withMembers, keeping their look. Ends attached to what goes
// become free, as do labels pointing at it (where they pointed).
export function remove(doc, ids, withMembers = false) {
  const all = dependents(doc, ids, withMembers);
  // where each one staying in a deleted group goes: the nearest group above it that stays, read while
  // the group is still there
  const moves = [];
  for (const { el } of elements(doc)) {
    if (all.has(el.id) || !el.groupId || !all.has(el.groupId)) continue;
    moves.push([el, groupsOf(doc, el).find((g) => !all.has(g.id))?.id ?? null]);
  }
  for (const kind of KINDS) doc[LIST[kind]] = doc[LIST[kind]].filter((el) => !all.has(el.id));
  for (const [el, gid] of moves) el.groupId = gid;
  const freed = (r) => ({ position: [...r.position], element: null });
  for (const s of doc.lines) for (const key of ['start', 'end']) if (s[key].element && all.has(s[key].element)) s[key] = freed(s[key]);
  for (const a of doc.labels) if (a.anchor.element && all.has(a.anchor.element)) a.anchor = freed(a.anchor);
  return all;
}

// ---- lines, vertices --------------------------------------------------------------------------------

// a vertex added at index, one taken away (what points at the line's vertices and edges: attach.js
// addVertex, removeVertex)
export function insertVertex(line, index, position) { line.vertices.splice(index, 0, vertex(position)); }
export function deleteVertex(line, index) { line.vertices.splice(index, 1); }
export function straighten(line) {
  line.startHandle = null;
  line.endHandle = null;
  for (const v of line.vertices) { v.handleIn = null; v.handleOut = null; }
  line.mode = 'fixed';
}
// Split a line at its vertex index: the vertex becomes a point (a dot, with the vertex's name and
// properties), the line ends there, and a new line carries on from it with the rest, both attached
// to it (what points at the line: attach.js splitKeeping). Returns the new point.
export function splitLine(doc, lineId, index) {
  const s = doc.lines.find((x) => x.id === lineId), v = s.vertices[index];
  const taken = idsOf(doc);
  const p = addPoint(doc, v.position, { name: v.name || nextName(doc, 'point'), properties: clone(v.properties), symbol: 'dot', parts: [] }, taken);
  const rest = { ...clone(s), id: newId(doc, taken), name: nextName(doc, 'line'), start: { position: [...v.position], element: p.id }, end: clone(s.end),
    startHandle: v.handleOut, endHandle: s.endHandle, vertices: clone(s.vertices.slice(index + 1)) };
  s.end = { position: [...v.position], element: p.id };
  s.endHandle = v.handleIn;
  s.vertices = s.vertices.slice(0, index);
  doc.lines.splice(doc.lines.indexOf(s) + 1, 0, rest);
  return p;
}

// ---- groups ----------------------------------------------------------------------------------------

// The nearest group all of xs ({ el }) are in, or null
function commonGroup(doc, xs) {
  const chains = xs.map((x) => groupsOf(doc, x.el));
  return chains[0]?.find((g) => chains.every((c) => c.includes(g))) ?? null;
}
// A group of the elements ids, in the nearest group they are all in (a subgroup of it), its fill and
// stroke those of the first point with radii, else its parent's. A group among them goes in with what
// is in it.
export function makeGroup(doc, ids) {
  const picked = ids.map((id) => find(doc, id)).filter(Boolean), chosen = new Set(picked.filter((x) => x.kind === 'group').map((x) => x.el));
  const xs = picked.filter((x) => !groupsOf(doc, x.el).some((g) => chosen.has(g))); // inside a group chosen: it goes with it
  const parent = commonGroup(doc, xs), g = { ...base(doc, 'group', idsOf(doc)), groupId: parent?.id ?? null };
  doc.groups.push(g);
  for (const x of xs) setGroup(doc, x.el.id, g.id);
  return g;
}
// Order (docs/drawing-format.md §2): each kind's list is the panel's order and the drawing order, the
// first on top. moveBefore: id just before beforeId (one of its kind), in its group; moveStep: one
// step up (-1) or down (1) among its siblings (its kind, its group).
export function moveBefore(doc, id, beforeId) {
  const x = find(doc, id), b = find(doc, beforeId);
  if (!x || !b || x.kind !== b.kind || id === beforeId) return;
  setGroup(doc, id, b.el.groupId ?? null);
  if ((x.el.groupId ?? null) !== (b.el.groupId ?? null)) return; // it could not go there (a group into itself)
  const list = doc[LIST[x.kind]];
  list.splice(list.indexOf(x.el), 1);
  list.splice(list.indexOf(b.el), 0, x.el);
}
export function moveStep(doc, id, dir) {
  const x = find(doc, id);
  if (!x) return;
  const list = doc[LIST[x.kind]], sibs = list.filter((e) => (e.groupId ?? null) === (x.el.groupId ?? null)), y = sibs[sibs.indexOf(x.el) + dir];
  if (!y) return;
  const i = list.indexOf(x.el), j = list.indexOf(y);
  [list[i], list[j]] = [y, x.el];
}
// whether group gid can take id: not itself, nor a group it is in
export const canHold = (doc, gid, id) => !gid || (gid !== id && !groupsOf(doc, find(doc, gid)?.el ?? {}).some((g) => g.id === id));
// The fields of a look each kind is drawn with
const STYLE_FIELDS = ['fill.color', 'fill.opacity', 'stroke.color', 'stroke.opacity', 'stroke.width', 'stroke.dash'];
export const LOOK_FIELDS = {
  point: [...STYLE_FIELDS, 'text.name', 'text.values', 'minSize'],
  area: [...STYLE_FIELDS, 'text.name', 'text.values'],
  line: [...STYLE_FIELDS.slice(2), 'text.name', 'text.values', 'offset'],
  label: ['text.size', 'text.color', 'text.background'],
};
// Move an element (or a group) into the group gid, or out of any (null): only its membership changes,
// never its look; never into itself or a group inside it.
export function setGroup(doc, id, gid) {
  const x = find(doc, id);
  if (x && canHold(doc, gid, id)) x.el.groupId = gid;
}

// ---- the user's properties as columns -----------------------------------------------------------------

// keys the GIS export uses itself: a property so keyed is written p_<key>
export const RESERVED = ['kind', 'id', 'name', 'outline', 'group', 'guide', 'text', 'anchor', 'along_m', 'length_m', 'width_m', 'radius_m', 'area_m2', 'perimeter_m', 'bearing_deg', 'aperture_deg', 'part_name', 'filled'];
// the user's properties as columns, in their order: a key that collides with a field (reserved) gets
// p_, a repeated key _2, _3…; changed: whether a key had to be changed
// The user's properties ([{ key, value }]) as columns: one each, in order; a key the export uses (reserved)
// prefixed p_, a repeated one numbered. { out, changed (a key had to be renamed) }
export function columnsOf(props, reserved = RESERVED) {
  const out = Object.create(null); // no prototype: a key named __proto__ is a column too
  let changed = false;
  for (const { key, value } of props) {
    let k = reserved.includes(key) ? `p_${key}` : key;
    if (Object.hasOwn(out, k)) { let i = 2; while (Object.hasOwn(out, `${k}_${i}`)) i++; k = `${k}_${i}`; } // hasOwn: a key named toString is a column like any other
    if (k !== key) changed = true;
    out[k] = value;
  }
  return { out, changed };
}
