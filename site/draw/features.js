// The drawing document (document.js) as GeoJSON: what the map draws (drawParts, for the layers of
// drawing.js), the values shown on the map (valueFeatures, the draw-value layer) and what the GIS export
// writes (exportFeatures). Pure, like document.js.

import { circle, sector, reachesPole, ccw, areaOf, destination, inverse } from '../geodesy.js';

import { styleOf, lookOf, offsetOf, isShown, leavesOf, groupsOf, centroid, columnsOf, linkFrom, membersOf, positionsIn, holderOf } from './document.js';
import { mercator, unrollTo, metresPerPixel, D2R } from '../geo.js';
import { lineTrace, anchorsOf, pointsAlong } from './lines.js';
import { labelText } from './labels.js';
import { resolve } from './attach.js';
import { fmtArea, fmtBrg, fmtDist } from '../format.js';

// a circle's polygon: the whole of it, or a sector centred on its bearing
export const ringOf = (c) => (c.aperture ? sector(c.position, c.radius, c.bearing, c.aperture) : circle(c.position, c.radius));
// whether a circle can be drawn: one reaching a pole cannot be a polygon
export const drawable = (c, r = c.radius) => !reachesPole(c.position, r);
// how far a point's shapes reach from it (m): their farthest place, or circle's rim
export const reachOf = (doc, p) => Math.max(0, ...membersOf(doc, p.id).flatMap(({ kind, el }) => positionsIn(kind, el).map(([o, k]) => inverse(p.position, o[k]).s + (el.radius ?? 0))));

const HANDLE_GAP = 12; // px
const BAND_GAP = 2; // px: the hover band's points, at least this far apart on screen

// line paint of a style's stroke
const lineProps = (s) => ({ sc: s.color, so: s.opacity, sw: s.width, dash: s.dash });

// The features drawn, in three parts, each its own map source so that only what changed is drawn
// again (drawing.js):
// - base: each shown circle (a polygon, its fill and stroke its own), each closed line's fill, each
//   point's symbol, the names of points, circles and of lines' places;
// - zoom: each visible line, and its names;
// - marks: those of the selected elements (sel: Set of IDs; a point's shapes with it) and of the one
//   under the pointer (hover).
// Every feature has the element's id, so a click on it finds the element.
// A mark never covers the element's own stroke, so a change to it shows while it is selected: the
// hover band just outside a circle or along a line, drawn offset by half the stroke's width and a gap
// (sw), a circle's ring counter-clockwise so that "outside" is one side; handles at the points a drag
// grabs; a ring around a point's centre. A line with an Offset carries it (off, px): MapLibre draws it
// beside its geometry (layers.js), display only. display: { zoom } (handles thinned at it, the stalks'
// length), midPx. want: the parts to make (the others come back empty).
export function drawParts(doc, sel = new Set(), hover = null, display = {}, want = { base: true, zoom: true, marks: true }) {
  const base = [], zoomed = [], marks = [];
  const heldBy = new Set(doc.points.filter((p) => sel.has(p.id)).map((p) => p.id)); // the points selected: their shapes with them
  const markOf = (el) => (!want.marks ? null : sel.has(el.id) || heldBy.has(el.groupId) ? 'sel' : hover === el.id ? 'hover' : null);
  // What says "selected": the one element selected shows its handles and its own stroke, untouched
  // (as the drawing tools do: the edge is what one aligns to), a point a small white dot at its
  // centre; among several selected (a point's shapes with it), each shows squares as handles look at
  // its key points (dots(): a line's places, a circle's handles), inert, thinned as handles are. The
  // band along an element is for hovering only.
  const mark = (el, geometry, props = {}, dots = null) => {
    const kind = markOf(el), id = el.id;
    if (!kind) return kind;
    if (kind === 'sel' && geometry.type !== 'Point') {
      if ((sel.size > 1 || !sel.has(id)) && dots) for (const p of thinned(dots())) marks.push({ type: 'Feature', properties: { id, kind: 'dot' }, geometry: { type: 'Point', coordinates: p } }); // as handles look, inert
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
  const midPx = display.midPx ?? 40; // a + halfway only along a leg this long on screen (80 with a finger)
  // Each handle says what dragging it does: role and ref (an index, a sector's end, a point ID).
  // items: [{ p, role, ref, kind ('handle', 'mid') }]; thin: a line's points thinned.
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
  // a stalk from far metres along bearing from c to 24 px beyond: its end turns the element
  const stalk = (id, c, bearing, far) => {
    if (!mpp || !want.marks) return [];
    marks.push({ type: 'Feature', properties: { id, kind: 'stalk' }, geometry: { type: 'LineString', coordinates: [destination(c, bearing, far), destination(c, bearing, far + 24 * ground(c[1]))] } });
    return [{ p: destination(c, bearing, far + 24 * ground(c[1])), role: 'rotate' }];
  };
  // names shown on the map: as its look says (its own, else the drawing's); drawn by MapLibre,
  // which leaves out those that collide
  const baseNames = [], zoomNames = [];
  const wants = (el) => lookOf(doc, el).text.name;
  const named = (el) => !!el.name.trim() && wants(el);
  const name = (to, el, geometry, c, props = {}) => to.push({ type: 'Feature', properties: { id: el.id, kind: 'name', nm: el.name, c, ...props }, geometry });

  // the drawing order within a kind (drawing-format.md §2): the first in its list on top (layers.js
  // sorts by z, the higher above)
  const Z = new Map();
  for (const list of [doc.circles, doc.lines]) list.forEach((el, i) => Z.set(el.id, list.length - i));
  // circles: each a polygon; selected alone, its radius dragged by its handles (a circle's at its four
  // cardinal points, a sector's at the middle of its arc), a sector's ends each alone, and the stalk
  // beyond its arc's middle turns it
  for (const c of doc.circles) {
    if (!isShown(doc, c) || !drawable(c) || (!want.base && !markOf(c))) continue;
    const st = styleOf(doc, c), rg = ringOf(c);
    if (want.base) {
      base.push({ type: 'Feature', properties: { id: c.id, kind: 'ring', z: Z.get(c.id), fill: st.fill.opacity > 0 ? 1 : 0, fc: st.fill.color, fo: st.fill.opacity, ...lineProps(st.stroke) }, geometry: { type: 'Polygon', coordinates: [rg] } });
      if (named(c)) name(baseNames, c, { type: 'Point', coordinates: c.position }, st.stroke.color);
    }
    const items = [...(c.aperture ? [c.bearing] : [0, 90, 180, 270]).map((az) => ({ p: destination(c.position, az, c.radius), role: 'radius' })),
      ...(c.aperture ? [-0.5, 0.5].map((k) => ({ p: destination(c.position, c.bearing + k * c.aperture, c.radius), role: 'aperture', ref: k })) : [])];
    mark(c, { type: 'Polygon', coordinates: [ccw(rg)] }, { sw: st.stroke.width }, () => items.map((h) => h.p));
    if (sel.has(c.id) && sel.size === 1) handles(c.id, [...items, ...(c.aperture ? stalk(c.id, c.position, c.bearing, c.radius) : [])]);
  }
  // lines: a guide dashed and faint, the others solid; every visible line also has an invisible stroke
  // wide enough to click, a closed one its fill (with the circles, under the lines). A line's halo is on
  // both sides of it.
  for (const sg of doc.lines) {
    if (!isShown(doc, sg)) continue;
    const { fill, stroke: st } = styleOf(doc, sg);
    if (want.base && sg.closed) base.push({ type: 'Feature', properties: { id: sg.id, kind: 'polygon', z: Z.get(sg.id), fill: 1, fc: fill.color, fo: fill.opacity }, geometry: { type: 'Polygon', coordinates: [lineTrace(doc, sg).coords] } });
    // its named places: at their real positions, whatever the zoom
    if (want.base && wants(sg)) sg.names.forEach((nm, i) => { if (nm.trim()) baseNames.push({ type: 'Feature', properties: { id: sg.id, kind: 'name', nm, c: st.color, vx: 1 }, geometry: { type: 'Point', coordinates: sg.points[i] } }); });
    if (!want.zoom && !markOf(sg)) continue;
    const line = lineTrace(doc, sg), off = offsetOf(doc, sg);
    const g = { type: 'LineString', coordinates: line.coords };
    if (want.zoom) {
      zoomed.push({ type: 'Feature', properties: { id: sg.id, kind: 'linehit', off }, geometry: g });
      if (named(sg)) name(zoomNames, sg, sg.closed ? { type: 'Point', coordinates: centroid(sg.points) } : g, st.color, sg.closed ? { ctr: 1 } : {}); // a closed one's at its centre
      zoomed.push({ type: 'Feature', properties: { id: sg.id, kind: sg.guide ? 'guide' : 'path', z: Z.get(sg.id), off, ...lineProps(st) }, geometry: g });
    }
    if (mark(sg, g, { sw: st.width, off }, () => sg.points) && sel.has(sg.id)) {
      const ps = sg.points;
      // its places: one linked to a point's centre moves the point; another (free, or linked to a
      // vertex, a leg) itself, linked again where it is dropped
      const role = (to) => (to && to.edge == null && to.vertex == null && doc.points.some((p) => p.id === to.element) ? { role: 'point', ref: to.element } : null);
      handles(sg.id, ps.map((p, i) => ({ p, ...(role(linkFrom(doc, sg.id, i)?.to) ?? { role: 'vertex', ref: i }) })), true);
      // a + halfway along each leg long enough on screen, on the line as drawn (a smooth line's curve):
      // dragging it adds a point there
      if (mpp) {
        const mids = [];
        for (let i = 0; i < line.legs.length; i++) {
          if (line.legs[i] / ground(ps[i][1]) > midPx) mids.push({ p: pointsAlong(line.coords, [(line.at[i] + line.at[i + 1]) / 2])[0].position, role: 'mid', ref: i, kind: 'mid' });
        }
        handles(sg.id, mids);
      }
    }
  }
  // points: the symbol (none: a small dot, so that the centre is always seen) and the name; selected
  // with shapes, a stalk beyond their reach along its bearing turns it with them
  for (const n of doc.points) {
    if (!isShown(doc, n)) continue;
    const p = { type: 'Point', coordinates: n.position };
    if (want.base) {
      const st = styleOf(doc, n);
      base.push({ type: 'Feature', properties: { id: n.id, kind: 'symbol', symbol: n.symbol === 'none' ? 'centre' : n.symbol, sc: st.stroke.color, so: st.stroke.opacity }, geometry: p });
      if (named(n)) name(baseNames, n, p, st.stroke.color);
    }
    mark(n, p);
    if (sel.has(n.id) && sel.size === 1 && membersOf(doc, n.id).length) handles(n.id, stalk(n.id, n.position, n.bearing, reachOf(doc, n)));
  }
  return { base: [...base, ...baseNames], zoom: [...zoomed, ...zoomNames], marks };
}
// whether an element shows its values (its look's)
const showsValues = (doc, el) => lookOf(doc, el).text.values;

// ---- values shown on the map (Show values) -----------------------------------------------------

// The values of the elements showing them, as label features (the draw-value layer draws them): each leg
// of a line its length (and its bearing, when bearings are on and the leg is straight), the total at
// its end; a closed line its area and perimeter; a circle its radius. units: 'km' | 'nm'.
export function valueFeatures(doc, units = 'km', bearings = false) {
  const out = [];
  const label = (id, coord, text, anchor = 'center') => out.push({ type: 'Feature', properties: { id, label: text, anchor }, geometry: { type: 'Point', coordinates: coord } });
  for (const s of doc.lines) {
    if (!showsValues(doc, s) || !isShown(doc, s)) continue;
    const tr = lineTrace(doc, s), an = anchorsOf(s);
    if (s.closed) { label(s.id, centroid(s.points), `${fmtArea(tr.area, units)}\nperimeter ${fmtDist(tr.length, units)}`); continue; }
    tr.legs.forEach((len, i) => {
      const mid = pointsAlong(tr.coords, [tr.at[i] + len / 2])[0].position;
      const straight = !an[i].hOut && !an[i + 1].hIn;
      label(s.id, mid, bearings && straight ? `${fmtDist(len, units)} · ${fmtBrg(inverse(an[i].position, an[i + 1].position).azi)}` : fmtDist(len, units));
    });
    if (tr.legs.length > 1) label(s.id, s.points.at(-1), `Σ ${fmtDist(tr.length, units)}`, 'top');
  }
  for (const c of doc.circles) if (showsValues(doc, c) && isShown(doc, c) && drawable(c)) label(c.id, destination(c.position, c.aperture ? c.bearing : 0, c.radius), `r ${fmtDist(c.radius, units)}`, 'bottom');
  return out;
}

// ---- the GIS export -----------------------------------------------------------------------------

export const flatten = (props) => columnsOf(props).out;
const deg = (a) => +a.toFixed(4);
const m = (v) => +v.toFixed(3);

// The drawing's visible elements as GeoJSON features, as drawn: real geometry, values in metres and
// degrees; a circle as a polygon. Labels: a point where each points, with its text (live values in
// the display units).
export function exportFeatures(doc, units = 'km') {
  const out = [];
  const groupName = (el) => groupsOf(doc, el).filter((g) => !g.position).reverse().map((g) => g.name).join(' / '); // the groups it is in, outermost first
  const base = (kind, el) => ({ kind, id: el.id, name: el.name, group: groupName(el), ...(holderOf(doc, el) ? { point: el.groupId } : {}), ...(el.guide ? { guide: true } : {}) });
  const feature = (properties, geometry) => out.push({ type: 'Feature', properties, geometry });
  for (const n of doc.points) if (isShown(doc, n)) feature({ ...base('point', n), ...flatten(n.properties) }, { type: 'Point', coordinates: n.position });
  for (const c of doc.circles) {
    if (!isShown(doc, c) || !drawable(c)) continue;
    const rg = ringOf(c);
    feature({ ...base(c.aperture ? 'sector' : 'circle', c), radius_m: m(c.radius), area_m2: Math.round(areaOf(rg)),
      ...(c.aperture ? { bearing_deg: deg(c.bearing), aperture_deg: deg(c.aperture) } : {}), ...flatten(c.properties) }, { type: 'Polygon', coordinates: [ccw(rg)] });
  }
  for (const sg of doc.lines) {
    if (!isShown(doc, sg)) continue;
    const line = lineTrace(doc, sg);
    if (sg.closed) feature({ ...base('line', sg), area_m2: Math.round(line.area), perimeter_m: m(line.length), ...flatten(sg.properties) }, { type: 'Polygon', coordinates: [ccw(line.coords)] });
    else feature({ ...base('line', sg), length_m: m(line.length), ...flatten(sg.properties) }, { type: 'LineString', coordinates: line.coords });
  }
  for (const a of doc.labels) {
    const to = linkFrom(doc, a.id)?.to, at = to && resolve(doc, to);
    if (!isShown(doc, a) || (at && !isShown(doc, at.element.el))) continue;
    feature({ ...base('label', a), text: labelText(doc, a, units), anchor: to?.element ?? '', ...(at?.along !== undefined ? { along_m: m(at.along) } : {}), ...flatten(a.properties) },
      { type: 'Point', coordinates: a.position });
  }
  return out;
}

// ---- each kind's geometry -------------------------------------------------------------------
// What bounds an element (Zoom to) and whether it lies inside a screen box (Shift-drag). bounds(doc,
// el): its points, at real size. inside(doc, el, inBox): all of it in the box (inBox(position): on
// screen inside it; a point and a circle by their centre). A group: its members are, or are not.
export const GEOMETRY = {
  group: { inside: () => false },
  point: {
    bounds: (doc, n) => [n.position],
    inside: (doc, n, inBox) => inBox(n.position),
  },
  circle: {
    bounds: (doc, c) => (drawable(c) ? circle(c.position, c.radius, 16) : [c.position]),
    inside: (doc, c, inBox) => inBox(c.position),
  },
  line: {
    bounds: (doc, sg) => lineTrace(doc, sg).coords,
    inside: (doc, sg, inBox) => lineTrace(doc, sg).coords.every(inBox),
  },
  label: {
    bounds: (doc, a) => [a.position],
    inside: (doc, a, inBox) => inBox(a.position),
  },
};

// [west, south, east, north] of positions, or null: longitudes continuous from the first (an element
// across the antimeridian). A loop: an imported line's positions are more than Math.min(...) takes
export function extentOf(pts) {
  if (!pts.length) return null;
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    const x = unrollTo(pts[0], p)[0];
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], p[1]);
  }
  return b;
}
// for the map's Zoom to: the extent of the elements ids, or null
export const boundsOf = (doc, ids) => extentOf(leavesOf(doc, ids).flatMap((x) => GEOMETRY[x.kind].bounds(doc, x.el)));
