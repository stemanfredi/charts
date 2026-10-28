// The drawing document (document.js) as GeoJSON: what the map draws (drawParts, for the layers of
// drawing.js), the values shown on the map (valueFeatures, the draw-value layer) and what the GIS export
// writes (exportFeatures). Pure, like document.js.

import { circle, sector, cornersOf, reachesPole, ccw, areaOf, destination, inverse, pathOf, perimeterOf } from '../geodesy.js';

import { styleOf, lookOf, minSizeOf, offsetOf, isShown, elements, groupsOf, centroid, roundParts, outlineParts, mainOutline, reachOf, columnsOf } from './document.js';
import { mercator, unrollTo, metresPerPixel, D2R } from '../geo.js';
import { rotateHandle } from './drag.js';
import { lineTrace, anchorsOf, positionsOf, pointsAlong } from './lines.js';
import { labelText } from './labels.js';
import { resolve, along } from './attach.js';
import { outlineOf } from './outlines.js';
import { fmtArea, fmtBrg, fmtDist } from '../format.js';

// a round part's polygon about its point: a circle, or a sector centred on the point's bearing
export const ringOf = (p, part) => (part.kind === 'sector' ? sector(p.position, part.radius, p.bearing, part.aperture)
  : circle(p.position, part.radius));
// whether a point's radius can be drawn: a circle reaching a pole cannot be a polygon
export const drawable = (p, r) => !reachesPole(p.position, r);
// a point's outline part (i: its place; none: its largest) as a shape: { center, bearing, length,
// width, outline } (drag.js, outlines.js)
export const shapeOf = (p, i = mainOutline(p)?.i) => { const o = p.parts[i]; return { center: p.position, bearing: p.bearing, length: o.length, width: o.width, outline: o.kind }; };

// How much larger than their real size a point's outlines are drawn at map zoom: 1 when its largest's
// long side is at least the drawing's minimum display size on screen, more when shorter; all its
// outlines by the same. Display only: lengths, totals and exports use the real sizes.
export function enlargement(doc, p, zoom) {
  const o = mainOutline(p)?.part;
  if (!o) return 1;
  const min = minSizeOf(doc);
  if (!min || zoom == null) return 1;
  const px = Math.max(o.length, o.width) / metresPerPixel(zoom, p.position[1]);
  return px < min ? min / px : 1;
}

const HANDLE_GAP = 12; // px
const BAND_GAP = 2; // px: the hover band's points, at least this far apart on screen

// line paint of a style's stroke (a radius may have its own colour and dash)
const lineProps = (s, colour = s.color, dash = s.dash) => ({ sc: colour, so: s.opacity, sw: s.width, dash });

// The features drawn, in three parts, each its own map source so that only what changed is drawn
// again (drawing.js):
// - base: what never depends on the zoom: each shown round part (a polygon, filled when its Fill is
//   on), each area, each point's symbol, the names of points and of vertices;
// - zoom: what may (outlines drawn enlarged when small): each visible outline and line, and their
//   names;
// - marks: those of the selected elements (sel: Set of IDs) and of the one under the pointer (hover).
// Every feature has the element's id, so a click on it finds the element.
// A mark never covers the element's own stroke, so a change to it shows while it is selected: the
// hover band just outside the outline (a point: its outermost round part, or its largest outline),
// drawn offset by half the stroke's width and a gap (sw), its ring counter-clockwise so that "outside"
// is one side; handles at the points a drag grabs; a ring around a point's centre.
// display: { zoom }: an outline too small to see at that zoom is drawn enlarged, dotted
// (it is not to scale); without a zoom, everything at real size. A line with an Offset carries it
// (off, px): MapLibre draws it beside its geometry (layers.js), display only. want: the parts to make (the others come back empty).
export function drawParts(doc, sel = new Set(), hover = null, display = {}, want = { base: true, zoom: true, marks: true }) {
  const base = [], zoomed = [], marks = [];
  const markOf = (id) => (!want.marks ? null : sel.has(id) ? 'sel' : hover === id ? 'hover' : null);
  // What says "selected": the one element selected shows its handles and its own stroke, untouched
  // (as the drawing tools do: the edge is what one aligns to), a point a small white dot at its
  // centre; among several selected, each shows such dots at its key points (dots(): a line's ends and
  // vertices, an area's or an outline's corners), inert, thinned as handles are. The blue band
  // along an element is for hovering only.
  const mark = (id, geometry, props = {}, dots = null) => {
    const kind = markOf(id);
    if (!kind) return kind;
    if (kind === 'sel' && geometry.type !== 'Point') {
      if (sel.size > 1 && dots) for (const p of thinned(dots())) marks.push({ type: 'Feature', properties: { id, kind }, geometry: { type: 'Point', coordinates: p } });
    } else marks.push({ type: 'Feature', properties: { id, kind, ...props }, geometry: fine(geometry) });
    return kind;
  };
  // a band's line or outline at the screen's resolution: a point every BAND_GAP px is all it shows (a
  // line of 10,000 vertices would be re-tiled whole at each hover)
  const fine = (g) => (g.type === 'LineString' ? { ...g, coordinates: thinned(g.coordinates, BAND_GAP) }
    : g.type === 'Polygon' ? { ...g, coordinates: g.coordinates.map((r) => thinned(r, BAND_GAP)) } : g);
  // handles, thinned at the map's zoom: one at least HANDLE_GAP px from the last one kept, and the
  // last point always (a line of hundreds of points would be a chain of squares)
  const mpp = display.zoom == null ? 0 : metresPerPixel(display.zoom);
  const midPx = display.midPx ?? 40; // a + halfway only along a leg or edge this long on screen (80 with a finger)
  // Each handle says what dragging it does: role and ref (a part's place in its point's list, an index, a point ID).
  // items: [{ p, role, ref, kind ('handle', 'mid', 'ctrl') }]; thin: a line's points thinned.
  // positions thinned at the map's zoom: one at least gap px from the last kept, the last always
  const thinned = (ps, gap = HANDLE_GAP) => {
    if (!mpp) return ps;
    const out = [];
    let last = null;
    ps.forEach((p, i) => {
      const m = mercator(p);
      if (last && i < ps.length - 1 && Math.hypot(m[0] - last[0], m[1] - last[1]) / mpp < gap) return;
      last = m;
      out.push(p);
    });
    return out;
  };
  const handles = (id, items, thin = false) => {
    if (!sel.has(id) || sel.size !== 1) return; // the one element selected: among several, dots say which, and a drag moves them all
    const kept = thin ? new Set(thinned(items.map((h) => h.p))) : null;
    for (const h of items) {
      if (kept && !kept.has(h.p)) continue;
      marks.push({ type: 'Feature', properties: { id, kind: h.kind || 'handle', role: h.role, ref: h.ref ?? '' }, geometry: { type: 'Point', coordinates: h.p } });
    }
  };
  const ground = (lat) => mpp * Math.cos(lat * D2R); // metres a pixel there
  // names shown on the map: as its look says (its own, else the drawing's); drawn by MapLibre,
  // which leaves out those that collide
  const baseNames = [], zoomNames = [];
  const wants = (el) => lookOf(doc, el).text.name;
  const named = (el) => !!el.name.trim() && wants(el);
  const name = (to, el, geometry, c, props = {}) => to.push({ type: 'Feature', properties: { id: el.id, kind: 'name', nm: el.name, c, ...props }, geometry });

  // the drawing order within a kind (drawing-format.md §2): the first in its list on top (layers.js
  // sorts by z, the higher above)
  const Z = new Map();
  for (const list of [doc.points, doc.lines, doc.areas]) list.forEach((el, i) => Z.set(el.id, list.length - i));
  // points: their round parts, then (with the lines) their outlines, then their symbols on top
  for (const n of doc.points) {
    const rounds = roundParts(n).filter(({ part }) => part.shown && drawable(n, part.radius));
    if (!isShown(doc, n) || !rounds.length || (!want.base && !markOf(n.id))) continue;
    const st = styleOf(doc, n);
    let outer = null;
    for (const { part } of rounds) {
      const rg = ringOf(n, part);
      if (want.base) base.push({ type: 'Feature', properties: { id: n.id, kind: 'ring', z: Z.get(n.id), fill: part.fill ? 1 : 0, fc: st.fill.color, fo: st.fill.opacity,
        ...lineProps(st.stroke) }, geometry: { type: 'Polygon', coordinates: [rg] } });
      if (!outer || part.radius > outer.part.radius) outer = { part, rg };
    }
    // its halo round its outermost round part (a point with an outline: round that); its parts dragged
    if (!mainOutline(n)) mark(n.id, { type: 'Polygon', coordinates: [ccw(outer.rg)] }, { sw: st.stroke.width });
    if (sel.has(n.id)) {
      // each round part's radius dragged by its handles, named by its place in the list: a circle's at
      // its four cardinal points, a sector's at the middle of its arc
      const items = rounds.flatMap(({ part, i }) => (part.kind === 'sector' ? [n.bearing] : [0, 90, 180, 270]).map((az) => ({ p: destination(n.position, az, part.radius), role: 'radius', ref: i })));
      // a sector's ends: each moves alone; the stalk's end beyond the outermost arc's middle turns the
      // point (with an outline, the outline's stalk does)
      const sectors = rounds.filter(({ part }) => part.kind === 'sector');
      for (const { part, i } of sectors) for (const k of [-0.5, 0.5]) items.push({ p: destination(n.position, n.bearing + k * part.aperture, part.radius), role: 'aperture', ref: `${i}:${k}` });
      if (sectors.length && !mainOutline(n) && mpp) {
        const far = Math.max(...sectors.map(({ part }) => part.radius));
        const arc = destination(n.position, n.bearing, far), tip = destination(n.position, n.bearing, far + 24 * ground(n.position[1]));
        marks.push({ type: 'Feature', properties: { id: n.id, kind: 'stalk' }, geometry: { type: 'LineString', coordinates: [arc, tip] } });
        items.push({ p: tip, role: 'rotate', ref: 0 });
      }
      handles(n.id, items);
    }
  }
  // areas: at real size whatever the zoom; their corners dragged, a + halfway along each edge long
  // enough on screen adds a corner there
  for (const g of doc.areas) {
    if (!isShown(doc, g) || (!want.base && !want.zoom && !markOf(g.id))) continue;
    const st = styleOf(doc, g), rg = pathOf(g.points, true);
    if (want.base) base.push({ type: 'Feature', properties: { id: g.id, kind: 'polygon', z: Z.get(g.id), fill: 1, fc: st.fill.color, fo: st.fill.opacity, ...lineProps(st.stroke) }, geometry: { type: 'Polygon', coordinates: [rg] } });
    if (want.zoom && named(g)) name(zoomNames, g, { type: 'Point', coordinates: centroid(g.points) }, st.stroke.color, { ctr: 1 }); // with the outlines' names (a centre)
    if (mark(g.id, { type: 'Polygon', coordinates: [ccw(rg)] }, { sw: st.stroke.width }, () => g.points) && sel.has(g.id)) {
      handles(g.id, g.points.map((p, i) => ({ p, role: 'ppoint', ref: i })), true);
      if (mpp) handles(g.id, g.points.flatMap((a, i) => { const b = g.points[(i + 1) % g.points.length], d = inverse(a, b); return d.s / ground(a[1]) > midPx ? [{ p: destination(a, d.azi, d.s / 2), role: 'pmid', ref: i + 1, kind: 'mid' }] : []; }));
    }
  }
  // outlines: to scale, all of a point's enlarged together when its largest is too small to see at
  // this zoom
  for (const n of doc.points) {
    const outs = outlineParts(n).filter(({ part }) => part.shown);
    if (!outs.length || !isShown(doc, n) || (!want.zoom && !markOf(n.id))) continue;
    const k = enlargement(doc, n, display.zoom), st = styleOf(doc, n);
    const main = outs.reduce((a, b) => (reachOf(b.part) > reachOf(a.part) ? b : a)); // its largest shown, as mainOutline measures
    const corners = [];
    let halo = null, mainCorners = null;
    for (const { part, i } of outs) {
      const o = outlineOf(n.position, n.bearing, part.length * k, part.width * k, part.kind);
      if (i === main.i) mainCorners = o.corners;
      if (want.zoom) zoomed.push({ type: 'Feature', properties: { id: n.id, kind: 'shape', z: Z.get(n.id), fill: part.fill ? 1 : 0, fc: st.fill.color, fo: st.fill.opacity,
        ...lineProps(st.stroke, st.stroke.color, k > 1 ? 'dotted' : st.stroke.dash), ...(k > 1 ? { enlarged: k } : {}) }, geometry: { type: 'Polygon', coordinates: [o.ring] } });
      if (i === main.i) halo = o.ring;
      corners.push(...o.corners.map((p, c) => ({ p, role: 'corner', ref: `${i}:${c}` })));
      corners.push(...o.corners.map((p, c) => ({ p: along(p, o.corners[(c + 1) % 4], 0.5), role: 'side', ref: `${i}:${c}` }))); // the middle of each side: that side alone
    }
    if (want.zoom && named(n)) name(zoomNames, n, { type: 'Point', coordinates: n.position }, st.stroke.color, { ctr: 1 });
    if (mark(n.id, { type: 'Polygon', coordinates: [ccw(halo)] }, { sw: st.stroke.width }, () => mainCorners) && k === 1) {
      // corners resize, a side's middle moves that side, the stalk's end (beyond the largest's front)
      // rotates (outlines drawn enlarged are only moved)
      if (mpp && sel.has(n.id)) {
        const s0 = shapeOf(n, main.i), front = destination(s0.center, s0.bearing, s0.length / 2), tip = rotateHandle(s0, 24 * ground(s0.center[1]));
        marks.push({ type: 'Feature', properties: { id: n.id, kind: 'stalk' }, geometry: { type: 'LineString', coordinates: [front, tip] } });
        corners.push({ p: tip, role: 'rotate', ref: 0 });
      }
      handles(n.id, corners);
    }
  }
  // lines: a guide dashed and faint, the others solid; every visible line also has an invisible stroke
  // wide enough to click. A line's halo is on both sides of it.
  for (const sg of doc.lines) {
    if (!isShown(doc, sg)) continue;
    const st = styleOf(doc, sg).stroke;
    // its named vertices: at their real positions, whatever the zoom
    if (want.base && wants(sg)) for (const v of sg.vertices) if (v.name.trim()) baseNames.push({ type: 'Feature', properties: { id: sg.id, kind: 'name', nm: v.name, c: st.color, vx: 1 }, geometry: { type: 'Point', coordinates: v.position } });
    if (!want.zoom && !markOf(sg.id)) continue;
    const line = lineTrace(doc, sg), off = offsetOf(doc, sg);
    const g = { type: 'LineString', coordinates: line.coords };
    if (want.zoom) {
      zoomed.push({ type: 'Feature', properties: { id: sg.id, kind: 'linehit', off }, geometry: g });
      if (named(sg)) name(zoomNames, sg, g, st.color);
      zoomed.push({ type: 'Feature', properties: { id: sg.id, kind: sg.guide ? 'guide' : 'path', z: Z.get(sg.id), off, ...lineProps(st) }, geometry: g });
    }
    if (mark(sg.id, g, { sw: st.width, off }, () => positionsOf(sg)) && sel.has(sg.id)) {
      const an = positionsOf(sg).map((position) => ({ position })), last = an.length - 1;
      // its ends: one attached to a point's centre moves the point; another (free, or attached to a
      // corner, an edge, a vertex) itself, attached again where it is dropped
      const centre = (e) => e.element && e.edge == null && e.vertex == null;
      const endRole = (e, i) => (centre(e) && doc.points.some((p) => p.id === e.element) ? { role: 'point', ref: e.element } : { role: 'end', ref: i ? 1 : 0 });
      handles(sg.id, an.map((a, i) => ({ p: a.position, ...(i === 0 ? endRole(sg.start, 0) : i === last ? endRole(sg.end, 1) : { role: 'vertex', ref: i - 1 }) })), true);
      // a + halfway along each leg long enough on screen: dragging it adds a point there
      if (mpp) {
        const mids = [];
        for (let i = 0; i < last; i++) {
          const a = an[i].position, b = an[i + 1].position, d = inverse(a, b);
          if (d.s / ground(a[1]) > midPx) mids.push({ p: destination(a, d.azi, d.s / 2), role: 'mid', ref: i, kind: 'mid' });
        }
        handles(sg.id, mids);
      }
    }
  }
  for (const n of doc.points) {
    if (!isShown(doc, n)) continue;
    const p = { type: 'Point', coordinates: n.position };
    if (want.base) {
      const st = styleOf(doc, n);
      // the centre of a point is always visible: with nothing else to show it, a small dot there
      const symbol = n.symbol === 'none' ? (mainOutline(n) ? null : 'centre') : n.symbol;
      if (symbol) base.push({ type: 'Feature', properties: { id: n.id, kind: 'symbol', symbol, sc: st.stroke.color, so: st.stroke.opacity }, geometry: p });
      if (named(n) && !mainOutline(n)) name(baseNames, n, p, st.stroke.color);
    }
    if (!mainOutline(n)) mark(n.id, p); // the ring round a point's centre; a shape has its outline's halo
  }
  return { base: [...base, ...baseNames], zoom: [...zoomed, ...zoomNames], marks };
}
// All of it as one collection (the tests, and anything that wants the whole picture)
export function drawFeatures(doc, sel = new Set(), hover = null, display = {}) {
  const p = drawParts(doc, sel, hover, display);
  return { type: 'FeatureCollection', features: [...p.base, ...p.zoom, ...p.marks] };
}
// whether anything drawn changes with the zoom: an outline that may be drawn enlarged
export function zoomDependent(doc) {
  return doc.points.some((p) => mainOutline(p) && isShown(doc, p)) && minSizeOf(doc) > 0;
}
// whether an element shows its values (its look's)
const showsValues = (doc, el) => lookOf(doc, el).text.values;

// ---- values shown on the map (Show values) -----------------------------------------------------

// The values of the elements showing them, as label features (the draw-value layer draws them): each leg
// of a line its length (and its bearing, when bearings are on and the leg is straight), the total at
// its end; an area its area and perimeter; a point each round part's radius. units: 'km' | 'nm'.
export function valueFeatures(doc, units = 'km', bearings = false) {
  const out = [];
  const label = (id, coord, text, anchor = 'center') => out.push({ type: 'Feature', properties: { id, label: text, anchor }, geometry: { type: 'Point', coordinates: coord } });
  for (const s of doc.lines) {
    if (!showsValues(doc, s) || !isShown(doc, s)) continue;
    const tr = lineTrace(doc, s), an = anchorsOf(s);
    tr.legs.forEach((len, i) => {
      const mid = pointsAlong(tr.coords, [tr.at[i] + len / 2])[0].position;
      const straight = !an[i].hOut && !an[i + 1].hIn;
      label(s.id, mid, bearings && straight ? `${fmtDist(len, units)} · ${fmtBrg(inverse(an[i].position, an[i + 1].position).azi)}` : fmtDist(len, units));
    });
    if (tr.legs.length > 1) label(s.id, s.end.position, `Σ ${fmtDist(tr.length, units)}`, 'top');
  }
  for (const g of doc.areas) {
    if (!showsValues(doc, g) || !isShown(doc, g)) continue;
    label(g.id, centroid(g.points), `${fmtArea(areaOf(pathOf(g.points, true)), units)}\nperimeter ${fmtDist(perimeterOf(g.points), units)}`);
  }
  for (const n of doc.points) {
    if (!showsValues(doc, n) || !isShown(doc, n)) continue;
    for (const { part } of roundParts(n)) if (part.shown && drawable(n, part.radius)) label(n.id, destination(n.position, part.kind === 'sector' ? n.bearing : 0, part.radius), `r ${fmtDist(part.radius, units)}`, 'bottom');
  }
  return out;
}

// ---- the GIS export -----------------------------------------------------------------------------

export const flatten = (props) => columnsOf(props).out;
const deg = (a) => +a.toFixed(4);
const m = (v) => +v.toFixed(3);

// The drawing's visible elements as GeoJSON features, as drawn: real geometry, values in metres and
// degrees; a point's parts as polygons. Labels: a point where each points, with its text
// (live values in the display units).
export function exportFeatures(doc, units = 'km') {
  const out = [];
  const groupName = (el) => groupsOf(doc, el).reverse().map((g) => g.name).join(' / '); // the groups it is in, outermost first
  const base = (kind, el) => ({ kind, id: el.id, name: el.name, group: groupName(el), ...(el.guide ? { guide: true } : {}) });
  const feature = (properties, geometry) => out.push({ type: 'Feature', properties, geometry });
  for (const n of doc.points) {
    if (!isShown(doc, n)) continue;
    feature({ ...base('point', n), ...flatten(n.properties) }, { type: 'Point', coordinates: n.position });
    for (const part of n.parts) { // each shown part: a polygon
      if (!part.shown || (part.radius && !drawable(n, part.radius))) continue;
      const own = { part_name: part.name, filled: part.fill };
      if (part.radius) {
        const rg = ringOf(n, part);
        feature({ ...base(part.kind, n), ...own, radius_m: m(part.radius), area_m2: Math.round(areaOf(rg)),
          ...(part.kind === 'sector' ? { bearing_deg: deg(n.bearing), aperture_deg: deg(part.aperture) } : {}), ...flatten(n.properties) }, { type: 'Polygon', coordinates: [ccw(rg)] });
      } else {
        const { ring: rg } = outlineOf(n.position, n.bearing, part.length, part.width, part.kind);
        feature({ ...base('shape', n), ...own, outline: part.kind, length_m: m(part.length), width_m: m(part.width), bearing_deg: deg(n.bearing), area_m2: Math.round(areaOf(rg)), ...flatten(n.properties) },
          { type: 'Polygon', coordinates: [ccw(rg)] });
      }
    }
  }
  for (const sg of doc.lines) {
    if (!isShown(doc, sg)) continue;
    const line = lineTrace(doc, sg);
    feature({ ...base('line', sg), length_m: m(line.length), ...flatten(sg.properties) }, { type: 'LineString', coordinates: line.coords });
  }
  for (const g of doc.areas) {
    if (!isShown(doc, g)) continue;
    const rg = ccw(pathOf(g.points, true));
    feature({ ...base('area', g), area_m2: Math.round(areaOf(rg)), perimeter_m: m(perimeterOf(g.points)), ...flatten(g.properties) }, { type: 'Polygon', coordinates: [rg] });
  }
  for (const a of doc.labels) {
    const at = isShown(doc, a) && resolve(doc, a.anchor);
    if (!at || (at.element && !isShown(doc, at.element.el))) continue;
    feature({ ...base('label', a), text: labelText(doc, a, units), anchor: a.anchor.element ?? '', ...(at.along !== undefined ? { along_m: m(at.along) } : {}), ...flatten(a.properties) },
      { type: 'Point', coordinates: at.position });
  }
  return out;
}

// ---- each kind's geometry -------------------------------------------------------------------
// What bounds an element (Zoom to), whether it lies inside a screen box (Shift-drag), how it moves
// with the pointer (dragging a selection). bounds(doc, el): its points, at real size. inside(doc, el,
// inBox, k): all of it in the box (inBox(position): on screen inside it; k(point): how much its outline
// is drawn enlarged). move(doc, el, mv, acc): moved by mv(position), each point once: acc collects
// the points and lines to move after, once(el) says whether el moves now (not yet moved),
// label(el) moves a label as the selection says, each({ kind, el }) moves another element.
const members = (doc, g) => elements(doc).filter((x) => x.el.groupId === g.id);
export const GEOMETRY = {
  group: {
    bounds: (doc, g) => members(doc, g).flatMap((x) => GEOMETRY[x.kind].bounds(doc, x.el)),
    inside: () => false, // its members are, or are not
    move: (doc, g, mv, acc) => { for (const x of members(doc, g)) acc.each(x); },
  },
  point: {
    bounds: (doc, n) => {
      const far = Math.max(0, ...roundParts(n).filter(({ part }) => part.shown && drawable(n, part.radius)).map(({ part }) => part.radius));
      return [n.position, ...(far ? circle(n.position, far, 16) : []), ...outlineParts(n).flatMap(({ part }) => cornersOf(n.position, n.bearing, part.length, part.width))];
    },
    inside: (doc, n, inBox, k) => {
      const outs = outlineParts(n);
      if (!outs.length) return inBox(n.position); // by its centre, not its round parts
      const e = k(n); // as drawn: small outlines' enlarged corners
      return outs.every(({ part }) => cornersOf(n.position, n.bearing, part.length * e, part.width * e).every(inBox));
    },
    move: (doc, n, mv, acc) => { acc.points.add(n.id); },
  },
  line: {
    bounds: (doc, sg) => lineTrace(doc, sg).coords,
    inside: (doc, sg, inBox) => lineTrace(doc, sg).coords.every(inBox),
    move: (doc, sg, mv, acc) => { acc.lines.add(sg); },
  },
  area: {
    bounds: (doc, g) => g.points,
    inside: (doc, g, inBox) => g.points.every(inBox),
    move: (doc, g, mv, acc) => { if (acc.once(g)) g.points = g.points.map(mv); },
  },
  label: {
    bounds: (doc, a) => { const at = resolve(doc, a.anchor); return at ? [at.position] : []; },
    inside: (doc, a, inBox) => { const at = resolve(doc, a.anchor); return !!at && inBox(at.position); },
    move: (doc, a, mv, acc) => acc.label(a),
  },
};

// for the map's Zoom to: [west, south, east, north] of the elements ids, or null
export function boundsOf(doc, ids) {
  const pts = elements(doc).filter((x) => ids.has(x.el.id)).flatMap((x) => GEOMETRY[x.kind].bounds(doc, x.el));
  if (!pts.length) return null;
  // longitudes continuous from the first point (an element across the antimeridian)
  const lons = pts.map((p) => unrollTo(pts[0], p)[0]), lats = pts.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}
