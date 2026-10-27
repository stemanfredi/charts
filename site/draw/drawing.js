// The drawing on the map: the document being edited (store.js: undo, selection), drawn in the
// layers of layers.js from features.js and labels.js, with the placing tools, clicks, hit testing,
// dragging and the Select area tool; saved in this browser as it changes (saving.js).

import { emptyDoc, addPoint, addLine, addLabel, addArea, find, elements, isShown, nextName, makePart, KIND, LABEL_OFFSET, lookOf, setLook, offsetOf, mainOutline, MAX_RADIUS } from './document.js';
import { typing } from '../dom.js';
import { outlineOf } from './outlines.js';
import { placeKind, placeBox, BOX, nameByLook } from './place.js';
import { norm360 } from '../geo.js';
import { serialise } from './file.js';
import { DrawStore, settleGeometry } from './store.js';
import { Saving } from './saving.js';
import { addIcons, measureText, HIT_LAYERS, MARK_LAYERS, HANDLE_LAYERS, CURSOR, FINGER } from './layers.js';
import { drawParts, enlargement, zoomDependent, GEOMETRY, shapeOf, valueFeatures, ringOf } from './features.js';
import { inflated } from './inflate.js';
import { lineTrace, nearestAlong, positionsOf } from './lines.js';
import { labelFeatures } from './labels.js';
import { inverse, cornersOf, pathOf, sector, circle } from '../geodesy.js';
import { snapAt, stepped, neighbours, RADIUS as SNAP_RADIUS } from './snap.js';
import { attachTo, insertCorner, addVertex, refNear, lineRef, resolve } from './attach.js';
import { copyOf, paste, centreOf, keep, kept } from './clipboard.js';
import { radiusTo, bearingTo, sectorEdgeTo, resizeRect, resizeSide, handleTo, moved } from './drag.js';

// the ID of the line being drawn, as measured for its values: always the same, so the traces cached by
// ID (lines.js) keep one entry for it, not one for each move of the pointer
const DRAFT_ID = '~draft';
const SNAP = 12; // px: a click this close to a point is on it (Connect's roots)
// with a finger (drawing-ui.md §1): snapping reaches farther, handles are grabbed farther, a + is
// added only along longer legs
const SNAP_PX = FINGER ? 16 : SNAP_RADIUS, GRAB_PX = FINGER ? 22 : 5, MID_PX = FINGER ? 80 : 40;
// where a line's end being drawn is: a point's (its ID), an attached end's, a position
const placeOfEnd = (doc, x) => (typeof x === 'string' ? doc.points.find((n) => n.id === x)?.position : Array.isArray(x) ? x : x?.position);
export class Drawing extends DrawStore {
  // onChange(what): 'doc' (the document changed), 'sel' (the selection), 'tool', 'draft' (what is
  // being drawn), 'drag', 'zoom', 'area' (a Select drag ended), 'placed' (a label placed: its text to
  // type), 'storage' (saving failed or another tab saved). known: what the app offers, for parse().
  // getView(): the map's view in the format's terms. units(): the display units ('km' | 'nm');
  // bearings(): each leg's bearing shown beside its length.
  constructor(map, { onChange, known, getView, units = () => 'km', bearings = () => false }) {
    super();
    Object.assign(this, { map, onChange, known, getView, units, bearings });
    this.saving = new Saving(this);
    this.tool = null;
    this.last = null; // the last click: its point and what was under it, for clicking through
    this.zoomRaf = 0;
    // what is being drawn: a line { start (a point's ID or a position), pts }; a polygon or a sector
    // { pts }; a shape { pts: [its centre] }
    this.draft = null;
    this.pressed = null; // the tools row's button of the tool on (measuring: Measure's: what it makes is a guide showing its values)
    this.cursor = null;
    map.on('click', (e) => this.click(e));
    map.on('mousemove', (e) => this.pointer(e));
    this.areaEvents(map);
    this.dragEvents(map);
    this.keyEvents(map);
    this.drag = null; // a drag under way: { id, role, ref, start, orig (the document before), moved }
    this.handlesShown = false; // a selected line's Bézier handles shown (the inspector's Handles)
    this.repointing = null; // { id, key }: what the next click attaches a label's anchor or a line's end to (its inspector's Attach to…)
    this.picking = null; // the Connect form: what a click on the map picks (roots)
    this.marksOn = true;
    // what each tool with kinds makes (its sub-rail; drawing-ui.md §2): Point a symbol or a preset
    // of the user's with only a symbol; Shape a circle, rings, a sector (three clicks), an outline, a
    // polygon or a preset with extent (a line is a line: Guide is its switch); Measure a distance (a
    // line), an area (a polygon) or a ring (a circle), each a guide showing its values
    this.variant = { point: 'symbol', shape: 'circle', measure: 'ruler' };
    this.presets = []; // the user's points kept as presets (presets.js), for Point › preset:<name>
    // labels keep their place on screen next to what they point at: drawn again as the map moves
    let labelRaf = 0;
    map.on('move', () => {
      if (!this.doc.labels.length) return;
      cancelAnimationFrame(labelRaf);
      labelRaf = requestAnimationFrame(() => this.renderLabels());
    });
    // once a frame while zooming, only what depends on it: outlines drawn enlarged; the marks of what
    // is selected (handles are thinned at the zoom)
    map.on('zoom', () => {
      const parts = { zoom: zoomDependent(this.doc), marks: this.sel.size > 0 || !!this.hover };
      if (!parts.zoom && !parts.marks) return;
      cancelAnimationFrame(this.zoomRaf);
      this.zoomRaf = requestAnimationFrame(() => { this.render(parts); if (parts.zoom) this.onChange('zoom'); });
    });
  }
  // the store's (store.js): a change to the document draws and saves it; the selection and the hover
  // only the marks
  changed() { this.render(); this.saving.soon(); this.onChange('doc'); }
  selectionChanged() {
    if (this.repointing && !this.sel.has(this.repointing.id)) this.cancelRepoint();
    this.renderMarks();
    this.onChange('sel');
  }
  hoverChanged() { this.renderMarks(); }
  preview(fn) { super.preview(fn); this.render(); }
  // a label's text being typed: only the labels drawn again
  previewLabels(fn) { super.preview(fn); this.labelTexts = null; this.renderLabels(); }
  // another document (opened from the list, New, imported): a line or a polygon being drawn belongs to
  // the one it replaces
  adopt(doc) {
    if (this.draft) this.cancelDraft();
    super.adopt(doc);
  }
  // the document as a file (GeoJSON), with the map's view as it is now
  text() {
    return serialise({ ...this.doc, view: this.getView() });
  }

  // ---- the map ---------------------------------------------------------------------------
  // the symbols, drawn here as signed distance fields (tinted per feature by icon-color)
  addIcons() { addIcons(this.map); }
  // Draw the parts asked for (features.js drawParts), each in its own source: 'draw' what never
  // depends on the zoom, 'drawzoom' what may, 'drawover' the marks, the line being drawn and the
  // forms' previews (Distribute, Connect). A change to the document draws all three; the selection, the pointer and the
  // Line tool's cursor only the marks; zooming only what follows it.
  render(parts = ALL_PARTS) {
    const p = drawParts(this.doc, this.sel, this.hover, { zoom: this.map.getZoom(), ctrl: this.handlesShown, midPx: MID_PX }, parts);
    const set = (id, features) => this.map.getSource(id)?.setData({ type: 'FeatureCollection', features });
    if (parts.base) { set('draw', p.base); this.values = null; this.labelTexts = null; }
    if (parts.zoom) set('drawzoom', p.zoom);
    if (parts.base || parts.marks) set('drawvalue', [...(this.values ??= valueFeatures(this.doc, this.units(), this.bearings())), ...this.draftValues()]);
    if (parts.marks) {
      let over = [...p.marks, ...this.draftFeatures()];
      // the generator's form: the lines and nodes it would make, faint, and the roots picked, ringed; the
      // guide line's selection marks hidden (its handles would read as more nodes, its halo hide the lines)
      if (this.previewPts?.length || this.picked?.length) over = over.filter((f) => !['handle', 'sel', 'hover', 'stalk'].includes(f.properties.kind));
      for (const l of this.previewLines || []) over.push({ type: 'Feature', properties: { kind: 'ghostline' }, geometry: { type: 'LineString', coordinates: l } });
      for (const q of this.previewPts || []) over.push({ type: 'Feature', properties: { kind: 'ghost' }, geometry: { type: 'Point', coordinates: q } });
      for (const q of this.picked || []) over.push({ type: 'Feature', properties: { kind: 'pick' }, geometry: { type: 'Point', coordinates: q } });
      // where a click or a drag would snap: a ring on a vertex, a cross at a crossing, a dot on an edge
      if (this.snapMark) over.push({ type: 'Feature', properties: { kind: `snap${this.snapMark.kind}` }, geometry: { type: 'Point', coordinates: this.snapMark.position } });
      set('drawover', over);
      this.renderLabels();
    }
  }
  renderMarks() { this.render(MARKS_ONLY); }
  // the labels (labels.js), in their own source: only they change as the map moves
  renderLabels() {
    const src = this.map.getSource('drawlabel');
    if (!src) return;
    src.setData({ type: 'FeatureCollection', features: labelFeatures(this.doc, this.view(), this.marksOn ? this.sel : new Set(), this.marksOn ? this.hover : null, this.units(), this.labelTexts ??= new Map()) });
  }
  // what a form would make, shown on the map, not in the drawing: nodes, roots (ringed), lines
  setPreview(pts, picked = [], lines = []) {
    if (!pts.length && !picked.length && !this.previewPts?.length && !this.picked?.length) return;
    this.previewPts = pts;
    this.picked = picked;
    this.previewLines = lines;
    this.renderMarks();
  }
  // how much a point's outline is drawn enlarged now (1: real size)
  enlargement(point) { return enlargement(this.doc, point, this.map.getZoom()); }
  // the lines drawn bowed (Inflate): their IDs
  inflatedIds() { const bowed = inflated(this.doc); return this.doc.lines.filter((s) => bowed.has(s.id) && isShown(this.doc, s)).map((s) => s.id); }
  // the lines drawn beside their real geometry (Offset): their IDs
  offset() { return this.doc.lines.filter((s) => isShown(this.doc, s) && offsetOf(this.doc, s)).map((s) => s.id); }
  // the IDs under a screen point: those right under it first, then those within pad px (lines drawn
  // offset are a few px from each other: the one clicked must come first), each set topmost first
  hitAt(point, pad = 4) {
    const layers = HIT_LAYERS.filter((id) => this.map.getLayer(id));
    const within = (r) => this.map.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], { layers }).map((f) => f.properties.id).filter(Boolean); // not a measurement being measured
    return [...new Set([...within(1), ...within(pad)])];
  }
  click(e) {
    const p = [e.lngLat.lng, e.lngLat.lat];
    if (this.tool === 'line') return this.lineClick(e.point, e.originalEvent);
    if (this.tool === 'shape') return this.shapeClick(e.point, e.originalEvent);
    if (this.tool === 'polygon') return this.polygonClick(e.point, e.originalEvent);
    if (this.tool === 'sector') return this.sectorClick(e.point, e.originalEvent);
    // picking (Connect's roots): a click on a point or anywhere is for the picker, not a selection
    if (this.picking && !this.tool) { this.picking(this.pointAt(e.point), p); return; } // a point, or a place (no point there)
    if (this.tool === 'label') return this.placeLabel(e.point, p);
    if (this.repointing) { // a label's anchor or a line's end attached to what is clicked (its inspector's Attach to…)
      const { id, key } = this.repointing;
      const r = key === 'anchor' ? null : this.snapFor(e.point, e.originalEvent, { exclude: new Set([id]) });
      const anchor = key === 'anchor' ? this.anchorFor(e.point, p) : null;
      this.cancelRepoint();
      this.change((doc) => {
        const x = find(doc, id)?.el;
        if (!x) return;
        if (key !== 'anchor') { const to = r.to && attachTo(doc, r.to); x[key] = typeof to === 'string' ? { position: [...r.position], element: to } : to || { position: r.position, element: null }; return; }
        // free text set on an element: its text moves off it, with an arrow
        if (anchor.element && !x.offset[0] && !x.offset[1]) { x.offset = [...LABEL_OFFSET]; if (x.leader === 'none') x.leader = 'arrow'; }
        x.anchor = anchor;
      });
      return;
    }
    if (this.tool && this.tool !== 'area') return this.place(this.snapFor(e.point, e.originalEvent).position); // with Select, a click selects as without a tool
    const add = e.originalEvent.shiftKey || e.originalEvent.ctrlKey || e.originalEvent.metaKey;
    const hits = this.hitAt(e.point);
    if (!hits.length) { this.last = null; if (!add) this.select([]); return; }
    // the same place again: the next one down
    const again = this.last && Math.hypot(this.last.x - e.point.x, this.last.y - e.point.y) < 3 && this.last.hits.join() === hits.join();
    const id = again && !add ? hits[(hits.indexOf(this.last.id) + 1) % hits.length] : hits[0];
    this.last = { x: e.point.x, y: e.point.y, hits, id };
    this.select([id], add ? 'toggle' : 'replace');
  }
  pointer(e) {
    this.lastPoint = e.point; // where a paste goes
    if (this.tool === 'line' || this.tool === 'polygon' || this.tool === 'sector' || (this.tool === 'shape' && this.draft)) {
      let r = this.snapFor(e.point, e.originalEvent, this.tool === 'shape' ? {} : this.tool === 'sector' ? { from: this.draft?.pts[0] ?? null } : this.lastLeg()); // as on the click: a shape's size, Shift steps nothing; a sector's edges step round its centre
      if (this.closesPolygon(e.point)) { r = { position: this.draft.pts[0], to: null, kind: 'vertex' }; this.snapMark = { kind: 'vertex', position: r.position }; } // a click closes it
      this.cursor = { point: e.point, p: r.position, snap: r, shift: !!e.originalEvent?.shiftKey };
      this.renderMarks();
      if (this.draft) this.onChange('draft');
      return;
    }
    if (this.tool === 'point' || this.tool === 'shape') { this.snapFor(e.point, e.originalEvent); this.renderMarks(); return; } // where a click would place it
    if (this.snapMark && !this.drag) { this.snapMark = null; this.renderMarks(); }
    if (this.repointing) { this.map.getCanvas().style.cursor = 'crosshair'; return; }
    // picking roots (the form's Connect): over a point, it is taken (or dropped); elsewhere, a new
    // root is placed there
    if (this.picking && !this.tool) { this.map.getCanvas().style.cursor = this.pointAt(e.point) ? 'pointer' : 'crosshair'; return; }
    if (this.tool || this.drag) return;
    // over a handle, the cursor says what dragging it does; over a selected element, that it moves
    const h = this.sel.size && this.handleAt(e.point), hits = h ? [] : this.hitAt(e.point, 3);
    const role = h ? h.role : hits.some((id) => this.sel.has(id)) ? 'move' : null;
    this.map.getCanvas().style.cursor = role ? CURSOR[role] : hits.length ? 'pointer' : '';
  }
  // hide or show the selection and hover marks (the PNG export captures the map without them)
  showMarks(on) {
    this.marksOn = on;
    for (const id of MARK_LAYERS) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  // ---- what the panel sets ------------------------------------------------------------------
  // the Bézier handles of a selected line, shown or not (its inspector's Handles)
  showHandles(on) { this.handlesShown = on; this.renderMarks(); }
  // what the next click on the map attaches (Attach to…): a label's anchor (key 'anchor'), a line's
  // start or end; or nothing
  startRepoint(id, key = 'anchor') { this.repointing = { id, key }; this.map.getCanvas().style.cursor = 'crosshair'; }
  cancelRepoint() { this.repointing = null; this.map.getCanvas().style.cursor = ''; }
  // what a click on the map picks while the generator's form is open (fn(nodeId, position)), or null
  setPicking(fn) { this.picking = fn; if (!fn && !this.tool) this.map.getCanvas().style.cursor = ''; }
  // a tool's variant chosen (its sub-rail): the tool on with it
  setVariant(button, v) {
    this.variant[button] = v;
    this.start(button);
  }
  // the tools row's button of the tool on (Shape › polygon draws with 'polygon', Measure › distance
  // with 'line'…); Select area is the list's
  get button() { return this.pressed; }
  get measuring() { return this.pressed === 'measure'; }

  // ---- tools -----------------------------------------------------------------------------
  start(tool) {
    if (this.tool) this.stop();
    clearTimeout(this.dblZoom); // stop()'s, which would turn it on again after this
    const v = this.variant[tool];
    this.pressed = tool;
    this.tool = tool === 'shape' && ['polygon', 'sector', 'arc'].includes(v) ? (v === 'arc' ? 'sector' : v) : tool === 'measure' ? { ruler: 'line', area: 'polygon', ring: 'shape' }[v] : tool;
    this.map.doubleClickZoom.disable();
    this.map.boxZoom.disable(); // Shift is the tools' (steps, a square), not the map's box zoom
    if (tool === 'area') this.map.dragPan.disable(); // a drag draws the rectangle (the tool is the box)
    this.map.getCanvas().style.cursor = 'crosshair';
    this.onChange('tool');
  }
  stop() {
    if (!this.tool) return;
    this.snapMark = null;
    if (this.tool === 'area') this.map.dragPan.enable();
    this.map.boxZoom.enable();
    this.tool = null;
    this.pressed = null;
    this.draft = null;
    this.renderMarks();
    this.map.getCanvas().style.cursor = '';
    this.dblZoom = setTimeout(() => this.map.doubleClickZoom.enable(), 0);
    this.onChange('tool');
  }

  // Copy, paste, duplicate (clipboard.js): the selection kept; pasted with its middle at the pointer
  // (else the map's centre), or duplicated beside itself (20 px on screen); one undo step, the copy selected
  copy() {
    if (!this.sel.size) return 0;
    this.clip = copyOf(this.doc, [...this.sel]);
    keep(this.clip);
    return this.clip.items.length;
  }
  paste(clip = kept() ?? this.clip, at = null) {
    const c = clip && centreOf(clip);
    if (!c) return 0;
    const pt = at ?? this.lastPoint ?? this.map.project(this.map.getCenter());
    const to = this.map.unproject(pt);
    let made = [];
    this.change((doc) => { made = paste(doc, clip, (q) => moved(q, c, [to.lng, to.lat])); });
    this.select(made.map((x) => x.el.id));
    return made.length;
  }
  duplicate() {
    const clip = this.sel.size && copyOf(this.doc, [...this.sel]), c = clip && centreOf(clip);
    if (!c) return 0;
    const q = this.map.project(c);
    return this.paste(clip, { x: q.x + 20, y: q.y + 20 });
  }
  // ---- snapping (snap.js): where a click or a drag lands --------------------------------------
  // the map's projection, as snap.js wants it
  view() {
    return { project: (p) => { const q = this.map.project(p); return [q.x, q.y]; }, unproject: (q) => { const p = this.map.unproject(q); return [p.lng, p.lat]; }, measure: measureText };
  }
  // Snapping at a screen point: { position, to (what a line's end would attach to), kind }. e: the
  // event (Alt: as it is, nothing snapped or attached; Shift, drawing from `from`: in 15° steps from
  // the leg before, prev → from); exclude: elements never snapped to. Marks the target on the map.
  snapFor(point, e, { from = null, prev = null, exclude = new Set() } = {}) {
    const ll = this.map.unproject(point), raw = [ll.lng, ll.lat];
    let r;
    if (e?.altKey || this.snapOff) r = { position: raw, to: null, kind: null }; // Alt, or Snap off (a finger's)
    else if (e?.shiftKey && from) r = { position: stepped(from, raw, prev), to: null, kind: null };
    else r = snapAt(this.doc, [point.x, point.y], this.view(), { ids: new Set(this.hitAt(point, SNAP_PX)), exclude, radius: SNAP_PX }) || { position: raw, to: null, kind: null };
    this.snapMark = r.kind ? { kind: r.kind, position: r.position } : null;
    return r;
  }
  // the leg being drawn: where it starts, and the leg before it (for Shift)
  lastLeg() {
    const d = this.draft;
    if (!d) return {};
    const pts = [...(d.start ? [placeOfEnd(this.doc, d.start)] : []), ...d.pts].filter(Boolean);
    return { from: pts.at(-1) ?? null, prev: pts.at(-2) ?? null };
  }
  // a point within SNAP px of a screen point, if any (the nearest): Connect's roots
  pointAt(point) {
    let best = null, bd = SNAP;
    for (const n of this.doc.points) {
      if (!isShown(this.doc, n)) continue;
      const q = this.map.project(n.position), d = Math.hypot(q.x - point.x, q.y - point.y);
      if (d <= bd) { best = n.id; bd = d; }
    }
    return best;
  }

  // ---- the Line tool: a start, vertices, an end, by clicks (drawing-ui.md §2.1) ----------
  // what a snap target attaches a line's end to. Another line's free end (where a point is to be made,
  // both ends attached to it) is kept as it is, at p, until the line is made: one undo step for both,
  // and nothing left behind if the line is dropped
  endAt(to, p) {
    if (to.end) return { position: p, pending: to };
    return attachTo(this.doc, to);
  }
  lineClick(point, e) {
    const d = this.draft, r = this.snapFor(point, e, this.lastLeg()), p = r.position;
    if (!d) this.draft = { start: r.to ? this.endAt(r.to, p) : p, pts: [] };
    // on something to attach to, the line ends there (not where it starts, with nothing between)
    else if (r.to && (d.pts.length || JSON.stringify(r.to) !== JSON.stringify(d.startTo))) return this.finishLine(this.endAt(r.to, p));
    else {
      const last = this.lastLeg().from; // the start too: a double-click's second click, the same point
      if (!last || last[0] !== p[0] || last[1] !== p[1]) d.pts.push(p);
    }
    if (!d && r.to) this.draft.startTo = r.to;
    this.renderMarks();
    this.onChange('draft');
  }
  // end the line: where given (a point's ID, an attached end), or at its last position (a free end)
  finishLine(end = null) {
    const d = this.draft;
    if (!d) return;
    if (!end && !d.pts.length) return; // no second point: nothing to make yet
    const pts = d.pts.slice(), to = end ?? pts.pop();
    this.draft = null;
    let seg;
    this.change((doc) => {
      // a free end waiting for its point (resolve): made now, once for both ends if they are the same
      const start = d.start?.pending ? attachTo(doc, d.start.pending) : d.start;
      const end = !to?.pending ? to : JSON.stringify(to.pending) === JSON.stringify(d.start?.pending) ? start : attachTo(doc, to.pending);
      seg = addLine(doc, start, pts, end, this.measuring ? { ...measured(), name: nextName(doc, 'line', 'Distance') } : {});
    });
    this.select([seg.id]);
    this.onChange('draft');
  }
  undoPoint() {
    const d = this.draft;
    if (!d) return;
    if (d.pts.length && this.tool !== 'shape') d.pts.pop(); else this.draft = null;
    this.renderMarks();
    this.onChange('draft');
  }
  cancelDraft() { this.draft = null; this.renderMarks(); this.onChange('draft'); }
  // the polygon being drawn, three corners or more, and point on its first corner: a click closes it
  closesPolygon(point) {
    const pts = this.tool === 'polygon' && this.draft?.pts;
    if (!pts || pts.length < 3) return false;
    const q = this.map.project(pts[0]);
    return Math.hypot(q.x - point.x, q.y - point.y) <= SNAP_PX;
  }
  // the Polygon tool: each click a corner, snapped (a double-click's second click is the same point);
  // a click on its first corner closes it
  polygonClick(point, e) {
    if (this.closesPolygon(point)) return this.finishPolygon();
    const p = this.snapFor(point, e, this.lastLeg()).position;
    const d = (this.draft ??= { pts: [] }), last = d.pts.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) d.pts.push(p);
    this.renderMarks();
    this.onChange('draft');
  }
  // the polygon kept, once it has three corners; the tool stays on for the next
  finishPolygon() {
    const d = this.draft;
    if (!d || d.pts.length < 3) return;
    this.draft = null;
    let g;
    this.change((doc) => { g = addArea(doc, d.pts, this.measuring ? measured() : {}); });
    this.select([g.id]);
    this.onChange('draft');
  }
  // the keys' (keyEvents): Enter or a double-click ends the line or polygon being drawn; Esc drops
  // it, or else ends the tool
  finish() { if (this.tool === 'line') this.finishLine(); else if (this.tool === 'polygon') this.finishPolygon(); }
  escape() {
    if (this.tool === 'sector' && this.draft?.pts.length) return this.undoPoint(); // one click back
    if (this.draft && (this.draft.start || this.draft.pts.length)) this.cancelDraft(); else this.stop();
  }
  finishesOnDoubleClick() { return this.tool === 'line' || this.tool === 'polygon'; }
  // Shape (and Measure › ring), in two clicks: the centre; then the size, the pointer showing it (a
  // circle's radius, an outline's front); a rectangle or an ellipse (place.js BOX) corner to corner
  // instead (Shift: a square, a circle). A second click on the first: the default size, centred there.
  // Facing north always (the bearing is set afterwards); a preset of the user's, which has its size, in
  // one click.
  boxing() { return !this.measuring && BOX.has(this.variant.shape); }
  shapeClick(point, e) {
    if (!this.draft) {
      this.draft = { pts: [this.snapFor(point, e).position] };
      if (!this.measuring && this.variant.shape?.startsWith('preset:')) return this.finishShape(null); // a preset of the user's has its size: one click
      this.renderMarks();
      return this.onChange('draft');
    }
    const c = this.map.project(this.draft.pts[0]);
    if (Math.hypot(c.x - point.x, c.y - point.y) <= SNAP_PX) return this.finishShape(null);
    if (this.boxing()) return this.finishBox(this.snapFor(point, e).position, e.shiftKey);
    this.finishShape(this.snapFor(point, e).position);
  }
  // a rectangle or an ellipse from the first click's corner to q; the tool stays on for the next
  finishBox(q, square) {
    const a = this.draft.pts[0];
    this.draft = null;
    let el;
    this.change((doc) => { el = placeBox(doc, a, q, this.variant.shape, square); });
    this.select([el.id]);
    this.onChange('draft');
  }
  // the shape being drawn made, sized to q (null: the default size), facing north; the tool stays on
  // for the next
  finishShape(q) {
    const c = this.draft.pts[0], d = q ? inverse(c, q).s : 0;
    this.draft = null;
    let el;
    this.change((doc) => {
      el = this.measuring ? addPoint(doc, c, { ...measured(), name: nextName(doc, 'point', 'Ring'), symbol: 'none', parts: [makePart('circle', { radius: Math.round((d || 1000) * 1000) / 1000 })] })
        : placeKind(doc, c, this.variant.shape, this.presets, d);
    });
    this.select([el.id]);
    this.onChange('draft');
  }
  // the shape being drawn, to the pointer: a point as it would be made, in a document of its own, or null
  draftShape() {
    const d = this.draft, q = this.cursor?.p;
    if (this.tool !== 'shape' || !d || !q) return null;
    const g = inverse(d.pts[0], q), doc = emptyDoc(0);
    if (this.boxing()) {
      const el = placeBox(doc, d.pts[0], q, this.variant.shape, !!this.cursor.shift);
      setLook(el, 'text.values', true);
      return { doc, el, centre: el.position, to: q };
    }
    const el = this.measuring ? addPoint(doc, d.pts[0], { symbol: 'none', parts: [makePart('circle', { radius: g.s || 1 })] })
      : placeKind(doc, d.pts[0], this.variant.shape, this.presets, g.s);
    setLook(el, 'text.values', true);
    return { doc, el, centre: d.pts[0], to: q };
  }
  // Shape › sector, in three clicks: the centre; the radius and one edge; the other edge, clockwise
  sectorClick(point, e) {
    const d = (this.draft ??= { pts: [] }), r = this.snapFor(point, e, { from: d.pts[0] ?? null });
    if (d.pts.length < 2) {
      if (!d.pts.length || inverse(d.pts[0], r.position).s > 0) d.pts.push(r.position);
    } else {
      const sec = this.draftSector(r.position);
      this.draft = null;
      let el;
      this.change((doc) => { const radius = Math.round(sec.r * 1000) / 1000;
        const arc = this.variant.shape === 'arc'; // Shape › arc: the sector's three clicks, its edge alone (a whole one: a circle, not filled)
        const part = sec.aperture ? makePart(arc ? 'arc' : 'sector', { radius, aperture: sec.aperture }) : { ...makePart('circle', { radius }), fill: !arc };
        el = addPoint(doc, d.pts[0], { symbol: 'none', parts: [part], bearing: sec.bearing }); el.name = nameByLook(doc, el); });
      this.select([el.id]);
    }
    this.renderMarks();
    this.onChange('draft');
  }
  // the sector being drawn, to the pointer (or to q): { centre, r, bearing, aperture, first }, or null
  draftSector(q = this.cursor?.p) {
    const d = this.draft;
    if (this.tool !== 'sector' || !d?.pts.length || !q) return null;
    const c = d.pts[0], first = d.pts[1] ?? q, a = inverse(c, first);
    if (!d.pts[1]) return { centre: c, r: a.s, bearing: norm360(a.azi), aperture: 0, first };
    const ap = Math.round(norm360(inverse(c, q).azi - a.azi) * 10) / 10 || 360;
    return { centre: c, r: a.s, bearing: +norm360(a.azi + ap / 2).toFixed(4), aperture: ap >= 360 ? null : ap, first };
  }
  // the polygon being drawn, to the cursor (closed back to its first corner)
  draftPolygon() {
    const d = this.draft;
    if (this.tool !== 'polygon' || !d) return null;
    const pts = [...d.pts, ...(this.cursor ? [this.cursor.p] : [])];
    return { pts };
  }
  // the line being drawn, to the cursor: its points
  draftLine() {
    const d = this.draft;
    if (!d) return null;
    const start = placeOfEnd(this.doc, d.start);
    if (!start) return null;
    return { pts: [start, ...d.pts, ...(this.cursor ? [this.cursor.p] : [])] };
  }
  // what is being drawn: a shape, a sector, a polygon, or the line (what a click would join is marked
  // by snap.js, under the pointer only)
  draftFeatures() {
    const sh = this.draftShape();
    if (sh) {
      const line = (coordinates) => ({ type: 'Feature', properties: { kind: 'draft' }, geometry: { type: 'LineString', coordinates } });
      // the reach from the centre to the pointer: a radius, drawn as a guide for a round shape only (an
      // outline faces north whatever the pointer's direction, so the line would say nothing)
      const { el } = sh, out = mainOutline(el) ? [] : [line([sh.centre, sh.to])];
      for (const part of el.parts) out.push(line(part.radius ? ringOf(el, part) : outlineOf(el.position, el.bearing, part.length, part.width, part.kind).ring));
      return out;
    }
    const sec = this.draftSector();
    if (sec) {
      const line = (coordinates) => ({ type: 'Feature', properties: { kind: 'draft' }, geometry: { type: 'LineString', coordinates } });
      const out = [line([sec.centre, sec.first])];
      const edge = this.variant.shape === 'arc' && sec.aperture ? sector(sec.centre, sec.r, sec.bearing, sec.aperture).slice(1, -1) : null; // an arc: its edge alone
      if (this.draft.pts[1] && sec.r > 0) out.push(line(edge || (sec.aperture ? sector(sec.centre, sec.r, sec.bearing, sec.aperture) : circle(sec.centre, sec.r))));
      return out;
    }
    const poly = this.draftPolygon();
    if (poly) return [{ type: 'Feature', properties: { kind: 'draft' }, geometry: { type: 'LineString', coordinates: poly.pts.length > 2 ? pathOf(poly.pts, true) : poly.pts } },
      ...this.draft.pts.map((c) => ({ type: 'Feature', properties: { kind: 'draftpt' }, geometry: { type: 'Point', coordinates: c } }))];
    if (this.tool !== 'line') return [];
    const l = this.draftLine(), f = [];
    if (!l) return f;
    f.push({ type: 'Feature', properties: { kind: 'draft' }, geometry: { type: 'LineString', coordinates: l.pts } });
    for (const p of l.pts.slice(0, this.cursor ? -1 : undefined)) f.push({ type: 'Feature', properties: { kind: 'draftpt' }, geometry: { type: 'Point', coordinates: p } });
    return f;
  }

  // the values of what is being drawn, as Measure always showed them: each leg's length, an area's
  // area and perimeter, a shape's radii (valueFeatures, on a document of its own)
  draftValues() {
    const u = this.units(), b = this.bearings(), sh = this.draftShape();
    // what is being dragged: its values while it moves, whether or not it shows them
    const dragged = this.drag?.moved && this.drag.id && find(this.doc, this.drag.id);
    if (dragged && dragged.kind !== 'label' && dragged.kind !== 'group' && !lookOf(this.doc, dragged.el).text.values) {
      const shows = (x) => ({ ...x, look: { ...x.look, text: { ...x.look.text, values: true } } });
      return valueFeatures({ ...this.doc, points: [], lines: [], areas: [], [KIND[dragged.kind].list]: [shows(dragged.el)] }, u, b); // it alone
    }
    if (sh) return valueFeatures(sh.doc, u, b);
    const poly = this.draftPolygon();
    if (poly && poly.pts.length > 1) {
      const doc = emptyDoc(0);
      if (poly.pts.length > 2) addArea(doc, poly.pts, measured()); else addLine(doc, poly.pts[0], [], poly.pts[1], { ...measured(), id: DRAFT_ID });
      return valueFeatures(doc, u, b);
    }
    const l = this.tool === 'line' && this.draftLine();
    if (!l || l.pts.length < 2) return [];
    const doc = emptyDoc(0);
    addLine(doc, l.pts[0], l.pts.slice(1, -1), l.pts.at(-1), { ...measured(), id: DRAFT_ID });
    return valueFeatures(doc, u, b);
  }

  // ---- dragging (drawing-ui.md §5): selected elements and their handles ------------------------
  handleAt(point, pad = GRAB_PX) {
    const layers = HANDLE_LAYERS.filter((id) => this.map.getLayer(id));
    const f = this.map.queryRenderedFeatures([[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]], { layers })[0];
    return f && { id: f.properties.id, role: f.properties.role, ref: f.properties.ref };
  }
  dragEvents(map) {
    const box = map.getCanvasContainer();
    const at = (e) => { const r = box.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    // first (capture): a press on a handle or a selected element takes the gesture from the map's panning
    box.addEventListener('pointerdown', (e) => {
      // a second finger during a drag: everything back (as Esc), the map's pinch takes over
      if (this.drag && e.pointerId !== this.drag.pointer) { this.cancelDrag(); return; } // a second finger: everything as it was (Esc too: keyEvents)
      if (e.button !== 0 || this.tool || this.picking || !this.sel.size || e.ctrlKey || e.metaKey) return;
      const pt = at(e), h = this.handleAt(pt);
      const grab = h || (this.hitAt(pt, 3).some((id) => this.sel.has(id)) ? { role: 'move' } : null);
      if (!grab) return;
      map.dragPan.disable();
      const ll = map.unproject([pt.x, pt.y]);
      this.drag = { ...grab, start: [ll.lng, ll.lat], from: pt, orig: JSON.stringify(this.doc), moved: false, pointer: e.pointerId };
    }, true);
    let raf = 0, move = null; // the move waiting for the next frame
    window.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const pt = at(e);
      if (!d.moved && Math.hypot(pt.x - d.from.x, pt.y - d.from.y) < 3) return;
      d.moved = true;
      cancelAnimationFrame(raf);
      move = () => {
        move = null;
        if (this.drag !== d) return;
        const ll = map.unproject([pt.x, pt.y]);
        this.doc = JSON.parse(d.orig);
        this.apply(d, [ll.lng, ll.lat], e, pt);
        settleGeometry(this.doc);
        this.render();
        this.onChange('drag');
      };
      raf = requestAnimationFrame(() => move?.());
    });
    window.addEventListener('pointerup', () => {
      const d = this.drag;
      if (!d) return;
      cancelAnimationFrame(raf);
      move?.(); // the last move, not drawn yet: where it is released
      this.drag = null;
      this.snapMark = null;
      if (this.tool !== 'area') map.dragPan.enable();
      if (d.moved) { this.pending = d.orig; this.change(() => {}); } // one undo step, from the document before the drag
      this.onChange('drag');
    });
  }
  cancelDrag() {
    this.doc = JSON.parse(this.drag.orig);
    this.drag = null;
    if (this.tool !== 'area') this.map.dragPan.enable();
    this.render();
    this.onChange('drag');
  }
  // The keys and clicks of what is being drawn, from anywhere but a field or a dialog: Enter
  // finishes the line or polygon (so does a double-click), Backspace takes back a point, a
  // right-click (not a right drag, which rotates the map) steps back one level, and Esc steps back
  // one level too: a drag undone, Attach to… given up, what is half-drawn dropped, else the tool
  // ended, else the selection cleared.
  keyEvents(map) {
    const escape = () => {
      if (this.drag) return this.cancelDrag();
      if (this.repointing) { this.cancelRepoint(); return this.onChange('sel'); }
      if (this.tool) return this.escape();
      this.select([]);
    };
    let right = null;
    map.on('mousedown', (e) => { if (e.originalEvent.button === 2) right = e.point; });
    map.on('contextmenu', (e) => { if (right && Math.hypot(e.point.x - right.x, e.point.y - right.y) <= 3) escape(); });
    map.on('dblclick', (e) => { if (this.finishesOnDoubleClick()) { e.preventDefault(); this.finish(); } });
    window.addEventListener('keydown', (e) => {
      if (typing(e.target) || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') escape(); // with Alt held too: Alt is the key for dragging free of snapping
      else if (e.ctrlKey || e.metaKey || e.altKey || !this.tool) return;
      else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); this.finish(); } // Enter on a focused button is that button's own click
      else if (e.key === 'Backspace' && !e.target.closest('input, select, textarea')) { e.preventDefault(); this.undoPoint(); } // a slider's or a box's Backspace is its own
    });
  }
  // the drag's new values, on this.doc as it was when it started (p: the pointer; e: Shift, Alt)
  apply(d, p, e, pt) {
    const doc = this.doc, el = d.id && find(doc, d.id)?.el;
    const point = (id) => doc.points.find((n) => n.id === id);
    const snap = e.shiftKey ? 15 : 0;
    switch (d.role) {
      case 'move': return this.moveSelection(doc, d.start, p);
      case 'anchor': { // a free label's point, or where along the edge (a line's leg) it points
        if (!el.anchor.element) { el.anchor.position = moved(el.anchor.position, d.start, p); return; }
        const x = find(doc, el.anchor.element), r = x && refNear(doc, x, p);
        if (r) { const { d: _, ...ref } = r; el.anchor = ref; } // eslint-disable-line no-unused-vars
        return;
      }
      case 'point': { // a line's end attached to a point's centre: the point moves, snapped (not onto itself or its lines)
        const n = point(d.ref), mine = new Set([n.id, ...doc.lines.filter((s) => s.start.element === n.id || s.end.element === n.id).map((s) => s.id)]);
        n.position = this.snapped(pt, e, moved(n.position, d.start, p), { exclude: mine }).position;
        return;
      }
      case 'end': { // a line's end, snapped; on something to attach to, attached there (Alt: free)
        const key = +d.ref ? 'end' : 'start', ps = positionsOf(el), k = key === 'end' ? ps.length - 1 : 0;
        const r = this.snapped(pt, e, moved(el[key].position, d.start, p), { exclude: new Set([el.id]), ...neighbours(key === 'end' ? ps : ps.slice().reverse(), key === 'end' ? k : ps.length - 1) });
        const to = r.to && attachTo(doc, r.to);
        el[key] = typeof to === 'string' ? { position: [...r.position], element: to } : to || { position: r.position, element: null };
        return;
      }
      case 'vertex': {
        const v = el.vertices[d.ref], r = this.snapped(pt, e, moved(v.position, d.start, p), { exclude: new Set([el.id]), ...neighbours(positionsOf(el), d.ref + 1) });
        v.position = r.position;
        return;
      }
      case 'mid': { const q = this.snapped(pt, e, p, { exclude: new Set([el.id]) }).position; addVertex(doc, el, d.ref, q); return; }
      case 'ppoint': { // an area's corner, snapped
        const n = el.points.length, ring = [...el.points.slice(d.ref + 1), ...el.points.slice(0, d.ref + 1)]; // ending at this corner
        el.points[d.ref] = this.snapped(pt, e, moved(el.points[d.ref], d.start, p), { exclude: new Set([el.id]), ...neighbours(ring, n - 1) }).position;
        return;
      }
      case 'pmid': { const q = this.snapped(pt, e, p, { exclude: new Set([el.id]) }).position; insertCorner(doc, el, d.ref, q); return; } // a corner added halfway along an edge
      case 'radius': {
        const part = el.parts[+d.ref];
        part.radius = Math.max(1, Math.min(MAX_RADIUS - 1, radiusTo(el.position, p))); // its size only: a sector's ends and the stalk turn it
        return;
      }
      case 'aperture': { // one end of a sector part's arc: its aperture, and the point's bearing (its middle)
        const [i, k] = String(d.ref).split(':').map(Number), part = el.parts[i], r = sectorEdgeTo(el.position, el.bearing, part.aperture, k, p, snap);
        el.bearing = r.bearing;
        part.aperture = r.aperture;
        return;
      }
      case 'corner': {
        // an outline part's corner (ref "part:corner"); on a point with other parts, about its centre
        const [i, c] = String(d.ref).split(':').map(Number), s = shapeOf(el, i);
        const r = resizeRect(s, cornersOf(s.center, s.bearing, s.length, s.width), c, p, { keep: e.shiftKey, aboutCentre: e.altKey || el.parts.length > 1 });
        el.position = r.center;
        Object.assign(el.parts[i], { length: r.length, width: r.width });
        return;
      }
      case 'side': { // an outline part's side (ref "part:side"), the opposite side kept; about the centre as a corner is
        const [i, c] = String(d.ref).split(':').map(Number), s = shapeOf(el, i);
        const r = resizeSide(s, c, p, { aboutCentre: e.altKey || el.parts.length > 1 });
        el.position = r.center;
        Object.assign(el.parts[i], { length: r.length, width: r.width });
        return;
      }
      case 'rotate': el.bearing = bearingTo(el.position, p, snap); return;
      case 'ctrl': {
        const [which, i] = String(d.ref).split(':'), k = +i, last = el.vertices.length + 1;
        const anchor = k === 0 ? el.start.position : k === last ? el.end.position : el.vertices[k - 1].position;
        const h = handleTo(anchor, p);
        if (k === 0) el.startHandle = h; else if (k === last) el.endHandle = h; else el.vertices[k - 1][which === 'in' ? 'handleIn' : 'handleOut'] = h;
        el.mode = 'fixed';
      }
    }
  }
  // a dragged position: snapped where the pointer is near something (snapFor), else where the drag
  // puts it (at: the grabbed thing moved as the pointer), in steps with Shift
  snapped(pt, e, at, opts) {
    if (e.shiftKey && opts.from) { this.snapMark = null; return { position: stepped(opts.from, at, opts.prev), to: null }; }
    const r = this.snapFor(pt, e, { exclude: opts.exclude });
    return r.kind ? r : { position: at, to: null };
  }
  // the selection moved by the pointer's displacement, each kind as features.js GEOMETRY says: points,
  // lines (their vertices, their free ends, the points their ends are attached to), areas, a group's
  // members; each position once
  // Labels: alone in the selection, their text moves (its offset on screen); with other elements, a
  // free one moves with them, one on an element follows it.
  moveSelection(doc, start, p) {
    const onlyLabels = [...this.sel].every((id) => find(doc, id)?.kind === 'label');
    const a = this.map.project(start), b = this.map.project(p);
    const mv = (pos) => moved(pos, start, p), seen = new Set();
    const acc = { points: new Set(), lines: new Set(),
      once: (el) => !seen.has(el) && !!seen.add(el),
      label: (el) => {
        if (!acc.once(el)) return;
        if (onlyLabels) el.offset = [Math.round(el.offset[0] + b.x - a.x), Math.round(el.offset[1] + b.y - a.y)];
        else if (!el.anchor.element) el.anchor.position = mv(el.anchor.position);
      },
      each: (x) => GEOMETRY[x.kind].move(doc, x.el, mv, acc) };
    for (const id of this.sel) { const x = find(doc, id); if (x) acc.each(x); }
    for (const sg of acc.lines) {
      for (const e of [sg.start, sg.end]) if (e.element) acc.points.add(e.element); else e.position = mv(e.position);
      for (const v of sg.vertices) v.position = mv(v.position);
    }
    for (const n of doc.points) if (acc.points.has(n.id)) n.position = mv(n.position);
  }

  // ---- the Select area tool: drag a rectangle, select what lies inside (Shift: add) ------------------
  areaEvents(map) {
    const box = document.createElement('div');
    box.className = 'dbox';
    box.hidden = true;
    map.getCanvasContainer().append(box);
    let from = null;
    const at = (e) => { const r = map.getCanvasContainer().getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    map.getCanvasContainer().addEventListener('pointerdown', (e) => {
      if (this.tool !== 'area' || e.button !== 0 || e.ctrlKey || e.metaKey) return; // Ctrl-drag still rotates the map
      from = at(e);
      Object.assign(box.style, { left: `${from.x}px`, top: `${from.y}px`, width: '0px', height: '0px' });
      box.hidden = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!from) return;
      const p = at(e);
      Object.assign(box.style, { left: `${Math.min(from.x, p.x)}px`, top: `${Math.min(from.y, p.y)}px`, width: `${Math.abs(p.x - from.x)}px`, height: `${Math.abs(p.y - from.y)}px` });
    });
    window.addEventListener('pointerup', (e) => {
      if (!from) return;
      const p = at(e), a = from;
      from = null;
      box.hidden = true;
      if (Math.abs(p.x - a.x) < 3 && Math.abs(p.y - a.y) < 3) return; // a click, not a drag
      this.select(this.inside([Math.min(a.x, p.x), Math.min(a.y, p.y), Math.max(a.x, p.x), Math.max(a.y, p.y)]), e.shiftKey ? 'add' : 'replace');
      this.onChange('area');
    });
  }
  // the visible elements inside a screen box [x0, y0, x1, y1]: points by their position (an outline
  // all of it), lines and areas when all of them is inside
  inside([x0, y0, x1, y1]) {
    const inBox = (p) => { const q = this.map.project(p); return q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1; };
    const k = (pt) => this.enlargement(pt);
    return elements(this.doc).filter((x) => isShown(this.doc, x.el) && GEOMETRY[x.kind].inside(this.doc, x.el, inBox, k)).map((x) => x.el.id);
  }

  // a new element of the tool's kind at p, at its default size, as its variant says, selected (the
  // Point tool's click; a tool's button pressed from the keyboard, at the map's centre)
  place(p, tool = this.tool) {
    let el;
    this.change((doc) => { el = placeKind(doc, p, this.variant[tool === 'shape' ? 'shape' : 'point'], this.presets); });
    this.select([el.id]);
    return el;
  }

  // A label where the Label tool clicks: on a point or an area, pointing at it; on a line, at that
  // distance along it; elsewhere, free text there. Selected, for its text to be typed.
  placeLabel(point, p) {
    let el;
    this.change((doc) => { el = addLabel(doc, this.anchorFor(point, p)); });
    this.select([el.id]);
    this.onChange('placed'); // the panel puts the cursor in its text
    return el;
  }
  // what a label clicked at would point at (a reference, attach.js): what snapping finds there (a
  // point's centre, a vertex, a place on an edge or a line's leg); else a point, an area's centre or a
  // line where it is clicked; else the position itself
  anchorFor(point, p) {
    const r = snapAt(this.doc, [point.x, point.y], this.view(), { ids: new Set(this.hitAt(point, SNAP_PX)), radius: SNAP_PX });
    if (r?.to && !r.to.end) return { ...r.to, position: resolve(this.doc, r.to)?.position ?? r.position };
    const x = this.hitAt(point).map((id) => find(this.doc, id)).find((y) => y && ['point', 'line', 'area'].includes(y.kind));
    if (x?.kind === 'line') return lineRef(this.doc, x.el, nearestAlong(lineTrace(this.doc, x.el).coords, p));
    if (x) return { position: [...resolve(this.doc, { element: x.el.id }).position], element: x.el.id };
    return { position: p };
  }
}

const ALL_PARTS = { base: true, zoom: true, marks: true }, MARKS_ONLY = { marks: true };
const measured = () => ({ guide: true, look: { text: { values: true } } }); // what Measure's tools make: guides showing their values

