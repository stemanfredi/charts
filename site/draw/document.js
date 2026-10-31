// The drawing document (docs/drawing-format.md): its elements, and the operations on them. Pure:
// no map, no DOM, so the tests run it in Node. The file is file.js's (GeoJSON).
//
// Four primitives and the group:
//   point: one position, a symbol (screen size) and a bearing; it can hold shapes (its members, as a
//     group holds its own), which move and turn with it (carry);
//   circle: a centre and a radius; with an aperture, a sector centred on its bearing;
//   line: places joined by legs; closed, a ring (its last place joined to its first): an area;
//   label: text pointing at a place;
//   group: members kept together, with no look of its own; a group can be in a group (its parent).
// A shape is a circle or a line: free, or held by a point (its parent, as a group is a member's).
// Any element can be a guide (supporting geometry: faint, left out of totals). How each is drawn is
// its look (docs/drawing-ui.md §5): its own values, else the drawing's, else the defaults.
// Elements hold positions only; what ties a place of one to another is in the drawing's links (one
// table: { from: [id, index], to: a target, attach.js }), applied after each change.

import { inverse, destination } from '../geodesy.js';
import { norm360 } from '../geo.js';

export const FORMAT = 'charts-drawing';
export const VERSION = 1; // the drawing's version: this code writes and reads it, and no other

export const MAX_OFFSET = 50; // px: Offset's reach either side of a line
export const STROKE_WIDTH = [0.5, 20]; // px: a stroke's width, least and most
export const DEFAULT_STYLE = Object.freeze({
  fill: Object.freeze({ color: '#e8590c', opacity: 0.15 }),
  stroke: Object.freeze({ color: '#e8590c', opacity: 1, width: 1.5, dash: 'solid' }),
});
// what a guide is drawn with, unless it or its group says otherwise: faint, dashed, one colour
export const GUIDE_STROKE = Object.freeze({ color: '#5d6d79', opacity: 1, width: 1, dash: 'dashed' });
export const GUIDE_STYLE = Object.freeze({ fill: Object.freeze({ color: '#5d6d79', opacity: 0.05 }), stroke: GUIDE_STROKE });
// what a measurement (a guide showing its values, Measure's tools make) is drawn with
const MEASURE_COLOUR = '#b0127a';
export const MEASURE_STYLE = Object.freeze({ fill: Object.freeze({ color: MEASURE_COLOUR, opacity: 0.08 }),
  stroke: Object.freeze({ color: MEASURE_COLOUR, opacity: 1, width: 2, dash: 'dashed' }) });
// A look: how an element is drawn. Every field optional where it is set (an element's, the
// drawing's); the defaults fill it in. fill, stroke: as a style; text: its name on the map, its values
// shown, and a label's size, colour (null: the default) and
// background; offset: a line drawn this many px to the right of where it is (negative: left; 0: on
// it; display only).
const LOOK_TEXT = Object.freeze({ name: false, values: false, size: 'medium', color: '#1f2c36', background: 'halo' }); // the colour: a label's text, the UI's ink (style.css --ink)
export const DEFAULT_LOOK = Object.freeze({ fill: DEFAULT_STYLE.fill, stroke: DEFAULT_STYLE.stroke, text: LOOK_TEXT, offset: 0 });
export const SYMBOLS = ['diamond', 'square', 'triangle', 'dot', 'none'];
export const DASHES = ['solid', 'dashed', 'dotted'];
export const OUTLINES = ['rectangle', 'triangle', 'ellipse', 'aerial-vehicle', 'surface-vehicle', 'underwater-vehicle']; // the Shape tool's outlines (outlines.js)
// The kinds of element: the document's list each lives in, and its name in the panel. In this order
// (the file's, and the list's). How each is drawn, exported and moved: features.js; edited: panel.js.
export const KIND = {
  group: { list: 'groups', name: 'Group' }, point: { list: 'points', name: 'Point' }, circle: { list: 'circles', name: 'Circle' },
  line: { list: 'lines', name: 'Line' }, label: { list: 'labels', name: 'Label' },
};
export const KINDS = Object.keys(KIND);
// labels (docs/drawing-format.md §7.7): their leader's end, text size, background
export const LEADERS = ['arrow', 'none']; // a line to what it points at, an arrow head there; or none
export const LABEL_SIZES = ['small', 'medium', 'large'];
export const BACKGROUNDS = ['halo', 'box'];
export const LABEL_OFFSET = Object.freeze([40, -40]); // px: a new label's text, up and to the right of what it points at
const NEW_RADIUS = 1000; // a new circle's radius: a neutral starting value, not a preset
export const MAX_RADIUS = 1e7;

export const isoNow = (now) => new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');

// ---- IDs -----------------------------------------------------------------------------------

// every ID in use: elements and rules
export function idsOf(doc) {
  const ids = new Set();
  for (const k of KINDS) for (const el of doc[KIND[k].list]) ids.add(el.id);
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
export const META_D = { title: '', description: '', author: '' };
export function emptyDoc(now = Date.now()) {
  const t = isoNow(now);
  return { created: t, modified: t, meta: { ...META_D }, look: {},
    groups: [], points: [], circles: [], lines: [], labels: [], rules: [], links: [] };
}

// ---- reading the document --------------------------------------------------------------------

// every element as { kind, el }, kinds in KINDS order
export function elements(doc) {
  return KINDS.flatMap((kind) => doc[KIND[kind].list].map((el) => ({ kind, el })));
}
export function find(doc, id) {
  for (const kind of KINDS) { const el = doc[KIND[kind].list].find((x) => x.id === id); if (el) return { kind, el }; }
  return null;
}
// the mean of a list of positions (a closed line's centre, for its name and labels)
export const centroid = (pts) => [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
// where an element is: a point's position, a circle's centre, a line's start
export const placeOf = (kind, el) => (el.position && kind !== 'label' ? el.position : kind === 'line' ? el.points[0] : null);
// what the panel calls an element: its name, or for an unnamed one its kind and where it is
export function label(kind, el) {
  if (el.name?.trim()) return el.name;
  if (kind === 'label') return el.text.split('\n')[0].trim() || 'Label'; // its text as written (tree.js shownName: as it reads)
  const at = placeOf(kind, el);
  return at ? `${KIND[kind].name} · ${at[1].toFixed(4)}, ${at[0].toFixed(4)}` : `${KIND[kind].name} ${el.id}`;
}
// "Point 4": the next free number among the kind's names (base: another word than the kind's); a bare
// "Base" counts as 1
export function nextName(doc, kind, base = KIND[kind].name) {
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: (\\d+))?$`);
  const used = doc[KIND[kind].list].map((e) => re.exec(e.name)).filter(Boolean).map((m) => (m[1] ? +m[1] : 1));
  return `${base} ${used.length ? Math.max(...used) + 1 : 1}`;
}
// what holds an element: its group, or (a shape) its point
const groupOf = (doc, el) => (el.groupId ? doc.groups.find((g) => g.id === el.groupId) ?? doc.points.find((p) => p.id === el.groupId) : null);
// The groups an element (or a group) is in, the nearest first: its group (a shape: its point, then
// the point's group), that group's, and so on
export function groupsOf(doc, el) {
  const out = [];
  for (let g = groupOf(doc, el); g && g !== el && !out.includes(g); g = groupOf(doc, g)) out.push(g);
  return out;
}
// What is in group gid: its members and subgroups (deep: and theirs, all the way down)
export function membersOf(doc, gid, deep = false) {
  return elements(doc).filter((x) => (deep ? groupsOf(doc, x.el).some((g) => g.id === gid) : x.el.groupId === gid));
}
// What the elements ids stand for, none twice, in the document's order: each itself, a group
// everything in it (its subgroups' too; the groups themselves left out), a point itself and its shapes
export function leavesOf(doc, ids) {
  const want = new Set(ids);
  return elements(doc).filter((x) => x.kind !== 'group' && (want.has(x.el.id) || groupsOf(doc, x.el).some((g) => want.has(g.id))));
}
// every position an element has, as [object, key] pairs, in the order of its places (a link's from
// index): a line's places, a label's where it points, a point's position, a circle's centre
export function positionsIn(kind, el) {
  if (el.position) return [[el, 'position']];
  if (kind === 'line') return el.points.map((_, i) => [el.points, i]);
  return [];
}
// a measurement: its name not on the map, whatever the drawing's names
const MEASURE_LOOK = Object.freeze({ ...MEASURE_STYLE, text: Object.freeze({ name: false }) });
// looks laid one over another, field by field (a later one's values over an earlier one's)
function layered(looks) {
  const part = (k) => Object.assign({}, ...looks.map((l) => l?.[k]));
  const last = (k) => looks.reduce((v, l) => (l?.[k] != null ? l[k] : v), null);
  return { fill: part('fill'), stroke: part('stroke'), text: part('text'), offset: last('offset') };
}
// The look an element is drawn with, every field: its own, else a guide's (faint, dashed) or a
// measurement's (a guide showing its values: as while it is measured), else the drawing's, else the
// defaults.
export function lookOf(doc, el) {
  const own = [el.look], under = [DEFAULT_LOOK, doc.look];
  const role = !el.guide ? null : layered([...under, ...own]).text.values ? MEASURE_LOOK : GUIDE_STYLE; // labels are never guides
  return layered([...under, role, ...own]);
}
// its fill and stroke
export const styleOf = (doc, el) => { const l = lookOf(doc, el); return { fill: l.fill, stroke: l.stroke }; };
// a measurement: a guide showing its values (what Measure makes)
export const isMeasurement = (doc, el) => !!el.guide && lookOf(doc, el).text.values;
// how far a line is drawn from where it is (Offset: px, positive to the right of its direction, 0: on it)
export const offsetOf = (doc, el) => lookOf(doc, el).offset;
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
export const isShown = (doc, el) => !!el.visible && groupsOf(doc, el).every((g) => g.visible !== false);

// ---- making elements (they change doc in place; the caller keeps the undo snapshot) -----------

export function touch(doc, now = Date.now()) { doc.modified = isoNow(now); }

const base = (doc, kind, taken, name = nextName(doc, kind)) => ({ id: newId(doc, taken), name, properties: [], groupId: null, visible: true, ...(kind === 'group' ? {} : { look: {} }) }); // a group has no look: its members' own
// A point at position: a diamond unless opts say otherwise; opts set its other fields ({ symbol,
// name, ... }).
export function addPoint(doc, position, opts = {}, taken = idsOf(doc)) {
  const p = { ...base(doc, 'point', taken), position: [...position], bearing: 0, symbol: 'diamond', guide: false, ...opts };
  doc.points.push(p);
  return p;
}
// a small dot: where lines meet (a split), a hub
export const addDot = (doc, position, taken = idsOf(doc)) => addPoint(doc, position, { symbol: 'dot' }, taken);
// A circle about position (aperture: a sector that wide, centred on its bearing), of the default
// radius unless opts say otherwise
export function addCircle(doc, position, opts = {}, taken = idsOf(doc)) {
  const c = { ...base(doc, 'circle', taken, nextName(doc, 'circle', opts.aperture ? 'Sector' : 'Circle')), position: [...position], radius: NEW_RADIUS, aperture: null, bearing: 0, guide: false, ...opts };
  doc.circles.push(c);
  return c;
}
// A line through positions (two or more; closed, three or more), its legs straight (geodesics), each
// place unnamed. Returns it.
export function addLine(doc, positions, opts = {}) {
  const s = { ...base(doc, 'line'), points: positions.map((p) => [...p]), names: positions.map(() => ''), smooth: false, closed: false, guide: false, ...opts };
  doc.lines.push(s);
  return s;
}
export const fewestPlaces = (line) => (line.closed ? 3 : 2); // what a line keeps
// A point moved to position and turned to bearing, its shapes with it as one piece: each of their
// places (a circle's centre) keeps its geodesic distance from the point and its bearing from it,
// turned by as much as the point is, and a circle's own bearing turns as much
export function carry(doc, p, position, bearing = p.bearing) {
  const d = bearing - p.bearing, from = p.position;
  if (!d && from[0] === position[0] && from[1] === position[1]) return;
  const to = (q) => { const g = inverse(from, q); return g.s ? destination(position, g.azi + d, g.s) : [...position]; };
  for (const { kind, el } of membersOf(doc, p.id)) {
    for (const [o, k] of positionsIn(kind, el)) o[k] = to(o[k]);
    if (kind === 'circle') el.bearing = +norm360(el.bearing + d).toFixed(4);
  }
  p.position = [...position];
  p.bearing = bearing;
}
// the point holding element el (its shapes'), or null
export const holderOf = (doc, el) => (el?.groupId ? doc.points.find((p) => p.id === el.groupId) ?? null : null);
// A label pointing at position, linked to `to` (a target, attach.js) when given: on an element its
// name, and its text up and to the right with a leader; free, the text there, no leader.
export function addLabel(doc, position, to = null) {
  // no name: it goes by its text (tree.js shownName)
  const a = { ...base(doc, 'label', undefined, ''), text: to ? '{name}' : 'Text', position: [...position], offset: to ? [...LABEL_OFFSET] : [0, 0], leader: to ? 'arrow' : 'none' };
  doc.labels.push(a);
  setLink(doc, a.id, 0, to);
  return a;
}

// ---- links ---------------------------------------------------------------------------------------

// What a link points at, nothing else (a snap's or refNear's distance and position left out):
// { element, vertex? | edge and at? } (attach.js resolve)
export const targetOf = ({ element, vertex, edge, at }) => ({ element, ...(vertex != null ? { vertex } : edge != null ? { edge, at: at ?? 0 } : {}) });
// the link from place index of element id, or undefined
export const linkFrom = (doc, id, index = 0) => doc.links.find((l) => l.from[0] === id && l.from[1] === index);
// place index of element id tied to `to` (a target), or free where it is (to null): one link a place
export function setLink(doc, id, index, to) {
  doc.links = doc.links.filter((l) => l.from[0] !== id || l.from[1] !== index);
  if (to) doc.links.push({ from: [id, index], to: targetOf(to) });
}

// ---- deleting -------------------------------------------------------------------------------------

// What deleting the elements ids takes with it: a point its shapes; everything in a group, when
// withMembers (otherwise its members and subgroups go to the group above it). What is linked to an
// element deleted stays, free where it was. A Set of IDs.
export function dependents(doc, ids, withMembers = false) {
  const all = new Set(ids);
  for (const { el } of elements(doc)) if (groupsOf(doc, el).some((g) => all.has(g.id) && (withMembers || g.position))) all.add(el.id);
  return all;
}
// Delete ids and what goes with them (dependents); the members and subgroups of a deleted group go to
// the group above it (or none), unless withMembers, keeping their look. The links from and to what
// goes are dropped at the next refresh (attach.js refreshAttached, after every change): what was
// linked to it is free where it was.
export function remove(doc, ids, withMembers = false) {
  const all = dependents(doc, ids, withMembers);
  // where each one staying in a deleted group goes: the nearest group above it that stays, read while
  // the group is still there
  const moves = [];
  for (const { el } of elements(doc)) {
    if (all.has(el.id) || !el.groupId || !all.has(el.groupId)) continue;
    moves.push([el, groupsOf(doc, el).find((g) => !all.has(g.id))?.id ?? null]);
  }
  for (const kind of KINDS) doc[KIND[kind].list] = doc[KIND[kind].list].filter((el) => !all.has(el.id));
  for (const [el, gid] of moves) el.groupId = gid;
  return all;
}

// ---- groups ----------------------------------------------------------------------------------------

// The nearest group all of xs ({ el }) are in, or null
function commonGroup(doc, xs) {
  const chains = xs.map((x) => groupsOf(doc, x.el).filter((g) => !g.position)); // groups, not points
  return chains[0]?.find((g) => chains.every((c) => c.includes(g))) ?? null;
}
// A group of the elements ids, in the nearest group they are all in (a subgroup of it). A group among
// them goes in with what is in it.
export function makeGroup(doc, ids) {
  const picked = ids.map((id) => find(doc, id)).filter(Boolean), chosen = new Set(picked.filter((x) => x.kind === 'group').map((x) => x.el));
  const xs = picked.filter((x) => !groupsOf(doc, x.el).some((g) => chosen.has(g))); // inside a group chosen: it goes with it
  const g = addGroup(doc, undefined, commonGroup(doc, xs)?.id ?? null);
  for (const x of xs) setGroup(doc, x.el.id, g.id);
  return g;
}
// a new group, named (else the next "Group n"), in the group parent (null: at the top)
export function addGroup(doc, name, parent = null) {
  const g = { ...base(doc, 'group', idsOf(doc), name), groupId: parent };
  doc.groups.push(g);
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
  const list = doc[KIND[x.kind].list];
  list.splice(list.indexOf(x.el), 1);
  list.splice(list.indexOf(b.el), 0, x.el);
}
export function moveStep(doc, id, dir) {
  const x = find(doc, id);
  if (!x) return;
  const list = doc[KIND[x.kind].list], sibs = list.filter((e) => (e.groupId ?? null) === (x.el.groupId ?? null)), y = sibs[sibs.indexOf(x.el) + dir];
  if (!y) return;
  const i = list.indexOf(x.el), j = list.indexOf(y);
  [list[i], list[j]] = [y, x.el];
}
// whether group gid can take id: not itself, nor a group it is in; a point (gid) takes shapes only
export function canHold(doc, gid, id) {
  const h = gid && find(doc, gid);
  if (h?.kind === 'point') return ['circle', 'line'].includes(find(doc, id)?.kind);
  return !gid || (gid !== id && !groupsOf(doc, h?.el ?? {}).some((g) => g.id === id));
}
// The fields of a look each kind is drawn with
const STYLE_FIELDS = ['fill.color', 'fill.opacity', 'stroke.color', 'stroke.opacity', 'stroke.width', 'stroke.dash'];
export const LOOK_FIELDS = {
  point: ['stroke.color', 'stroke.opacity', 'text.name'], // its symbol's colour
  circle: [...STYLE_FIELDS, 'text.name', 'text.values'],
  line: [...STYLE_FIELDS, 'text.name', 'text.values', 'offset'], // a fill drawn only while closed
  label: ['text.size', 'text.color', 'text.background'],
  drawing: ['text.name', 'offset'], // the drawing's own look: what its Display sets, nothing else
};
// Move an element (or a group) into the group gid (a shape: into the point gid), or out of any (null):
// only its membership changes, never its look; never into itself or a group inside it.
export function setGroup(doc, id, gid) {
  const x = find(doc, id);
  if (x && canHold(doc, gid, id)) x.el.groupId = gid;
}

// ---- the user's properties as columns -----------------------------------------------------------------

// keys the GIS export uses itself: a property so keyed is written p_<key>
const GIS_COLUMNS = ['kind', 'id', 'name', 'group', 'point', 'guide', 'text', 'anchor', 'along_m', 'length_m', 'radius_m', 'area_m2', 'perimeter_m', 'bearing_deg', 'aperture_deg'];
// The user's properties ([{ key, value }]) as columns: one each, in order; a key the export uses (reserved)
// prefixed p_, a repeated one numbered. { out, changed (a key had to be renamed) }
export function columnsOf(props, reserved = GIS_COLUMNS) {
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
