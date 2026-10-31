// The drawing on the map: the document being edited (store.js: undo, selection), drawn in the
// layers of layers.js from features.js and labels.js, with the placing tools, clicks, hit testing,
// dragging and the box (Shift-drag); saved in this browser as it changes (saving.js).

import { emptyDoc, addPoint, addLine, addLabel, addArea, find, elements, leavesOf, positionsIn, isShown, nextName, makePart, KIND, LABEL_OFFSET, lookOf, setLook, offsetOf, mainOutline, MAX_RADIUS, MIN_PLACES, linkFrom, setLink } from './document.js';
import { typing } from '../dom.js';
import { outlineOf } from './outlines.js';
import { placeKind, placeBox, BOX, nameByLook } from './place.js';
import { norm360 } from '../geo.js';
import { serialise } from './file.js';
import { DrawStore, settleGeometry } from './store.js';
import { Saving } from './saving.js';
import { addIcons, measureText, HIT_LAYERS, MARK_LAYERS, HANDLE_LAYERS, CURSOR, FINGER } from './layers.js';
import { drawParts, enlargement, zoomDependent, GEOMETRY, shapeOf, valueFeatures, ringOf } from './features.js';
import { lineTrace, nearestAlong } from './lines.js';
import { labelFeatures } from './labels.js';
import { inverse, cornersOf, sector, circle } from '../geodesy.js';
import { snapAt, stepped, neighbours, RADIUS as SNAP_RADIUS } from './snap.js';
import { attachTo, insertPlace, deletePlace, refNear, lineRef, resolve, reattach } from './attach.js';
import { removePartOf } from './generator.js';
import { clipOf, paste, centreOf } from './clipboard.js';
import { radiusTo, bearingTo, sectorEdgeTo, resizeRect, resizeSide, moved } from './drag.js';

// the ID of the line being drawn, as measured for its values: always the same, so the traces cached by
// ID (lines.js) keep one entry for it, not one for each move of the pointer
const DRAFT_ID = '~draft';
// with a finger (drawing-ui.md §1): snapping reaches farther, handles are grabbed farther, a + is
// added only along longer legs
const SNAP_PX = FINGER ? 16 : SNAP_RADIUS, GRAB_PX = FINGER ? 22 : 5, MID_PX = FINGER ? 80 : 40;
// a pointer event's place on the map's canvas (px)
const canvasPoint = (map, e) => { const r = map.getCanvasContainer().getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
export class Drawing extends DrawStore {
  // onChange(what): 'doc' (the document changed), 'sel' (the selection), 'tool', 'draft' (what is
  // being drawn), 'drag', 'area' (a box select ended), 'place' (a handle pressed: currentPlace),
  // 'placed' (a label placed: its text to type), 'storage' (saving failed or another tab saved).
  // known: what the app offers, for parse().
  // getView(): the map's view in the format's terms. units(): the display units ('km' | 'nm');
  // bearings(): each leg's bearing shown beside its length.
  constructor(map, { onChange, known, getView, units = () => 'km', bearings = () => false }) {
    super();
    Object.assign(this, { map, onChange, known, getView, units, bearings });
    this.saving = new Saving(this);
    this.tool = null;
    this.last = null; // the last click: its point and what was under it, for clicking through
    this.zoomRaf = 0;
    // what is being drawn: a line { pts, tos (what each snapped to) }; a sector { pts }; a shape
    // { pts: [its centre] }
    this.draft = null;
    this.button = null; // the bar's button of the tool on (Shape › sector draws with 'sector')
    this.cursor = null;
    map.on('click', (e) => this.click(e));
    let hoverRaf = 0, hoverEvent = null; // once a frame, the last move: pointer() queries the map's features
    map.on('mousemove', (e) => { hoverEvent = e; if (!hoverRaf) hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; this.pointer(hoverEvent); }); });
    this.dragEvents(map);
    this.areaEvents(map);
    this.keyEvents(map);
    this.drag = null; // a drag under way: { id, role, ref, start, orig (the document before), moved }
    this.boxNext = false; // Box select on: the next drag on the map draws the box (boxSelect)
    this.repointing = null; // { id, index }: the place the next click links (a label's 0, a line's: its inspector's Attach to…)
    this.picking = null; // the Connect form: what a click on the map picks (roots)
    this.keepSel = false; // a form open: a click on the map changes nothing (the form is filled from what was selected)
    this.currentPlace = null; // the place current on the element selected (setPlace)
    this.marksOn = true;
    // what each tool with kinds makes (its row of kinds; drawing-ui.md §2): Point a symbol or a preset
    // of the user's with only a symbol; Shape a circle, rings, a sector (three clicks), an outline, a
    // polygon or a preset with extent (a line is a line: Guide is its switch). Measure has none: a
    // line, or an area when closed, a guide showing its values
    this.variant = { point: 'symbol', shape: 'circle' };
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
      this.zoomRaf = requestAnimationFrame(() => this.render(parts));
    });
  }
  // the store's (store.js): a change to the document draws and saves it; the selection and the hover
  // only the marks
  changed() { this.render(); this.saving.soon(); this.onChange('doc'); }
  selectionChanged() {
    if (this.repointing && !this.sel.has(this.repointing.id)) this.cancelRepoint();
    this.currentPlace = null;
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
    return serialise(this.doc, this.getView());
  }

  // ---- the map ---------------------------------------------------------------------------
  // the symbols, drawn here as signed distance fields (tinted per feature by icon-color)
  addIcons() { addIcons(this.map); }
  // Draw the parts asked for (features.js drawParts), each in its own source: 'draw' what never
  // depends on the zoom, 'drawzoom' what may, 'drawover' the marks, the line being drawn and the
  // forms' previews (Distribute, Connect). A change to the document draws all three; the selection, the pointer and the
  // Line tool's cursor only the marks; zooming only what follows it.
  render(parts = ALL_PARTS) {
    const p = drawParts(this.doc, this.sel, this.hover, { zoom: this.map.getZoom(), midPx: MID_PX }, parts);
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
      // the place current (a line's point, an area's corner): ringed
      const pm = this.placeAt();
      if (pm) over.push({ type: 'Feature', properties: { kind: 'place' }, geometry: { type: 'Point', coordinates: pm } });
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
    if (this.tool === 'line' || this.tool === 'measure') return this.lineClick(e.point, e.originalEvent);
    if (this.tool === 'shape') return this.shapeClick(e.point, e.originalEvent);
    if (this.tool === 'sector') return this.sectorClick(e.point, e.originalEvent);
    // picking (Connect's roots): a click on a point or anywhere is for the picker, not a selection
    if (this.picking && !this.tool) { this.picking(this.pointAt(e.point), p); return; } // a point, or a place (no point there)
    if (this.keepSel && !this.tool) return;
    if (this.tool === 'label') return this.placeLabel(e.point, p);
    if (this.repointing) { // a place linked to what is clicked (its inspector's Attach to…)
      const { id, index } = this.repointing, label = find(this.doc, id)?.kind === 'label';
      const r = label ? this.anchorFor(e.point, p) : this.snapFor(e.point, e.originalEvent, { exclude: new Set([id]) });
      this.cancelRepoint();
      this.change((doc) => {
        const x = find(doc, id);
        if (!x) return;
        // free text set on an element: its text moves off it, with an arrow
        if (label && r.to && !x.el.offset[0] && !x.el.offset[1]) { x.el.offset = [...LABEL_OFFSET]; if (x.el.leader === 'none') x.el.leader = 'arrow'; }
        this.putPlace(doc, x, index, label ? r : { position: r.position, to: attachTo(doc, r.to) });
      });
      return;
    }
    if (this.tool) return this.place(this.snapFor(e.point, e.originalEvent).position);
    const add = e.originalEvent.shiftKey || e.originalEvent.ctrlKey || e.originalEvent.metaKey;
    const hits = this.hitAt(e.point);
    // nothing there: the selection cleared, and said on the click (app.js: a click that only clears it reads no depth)
    if (!hits.length) { this.last = null; if (!add) { if (this.sel.size) e.cleared = true; this.select([]); } return; }
    // the same place again: the next one down
    const again = this.last && Math.hypot(this.last.x - e.point.x, this.last.y - e.point.y) < 3 && this.last.hits.join() === hits.join();
    const id = again && !add ? hits[(hits.indexOf(this.last.id) + 1) % hits.length] : hits[0];
    this.last = { x: e.point.x, y: e.point.y, hits, id };
    this.select([id], add ? 'toggle' : 'replace');
  }
  pointer(e) {
    this.lastPoint = e.point; // where a paste goes
    if (['line', 'measure', 'sector'].includes(this.tool) || (this.tool === 'shape' && this.draft)) {
      let r = this.snapFor(e.point, e.originalEvent, this.tool === 'shape' ? {} : this.tool === 'sector' ? { from: this.draft?.pts[0] ?? null } : this.lastLeg()); // as on the click: a shape's size, Shift steps nothing; a sector's edges step round its centre
      if (this.closesPath(e.point)) { r = { position: this.pathPoints()[0], to: null, kind: 'vertex' }; this.snapMark = { kind: 'vertex', position: r.position }; } // a click closes it
      this.cursor = { point: e.point, p: r.position, snap: r, shift: !!e.originalEvent?.shiftKey };
      this.renderMarks();
      if (this.draft) this.onChange('draft');
      return;
    }
    if (this.tool === 'point' || this.tool === 'shape') { // where a click would place it; the cursor kept current, so a shape's preview starts at its first click, not at the last shape's end
      const r = this.snapFor(e.point, e.originalEvent);
      this.cursor = { point: e.point, p: r.position, snap: r, shift: !!e.originalEvent?.shiftKey };
      this.renderMarks();
      return;
    }
    if (this.snapMark && !this.drag) { this.snapMark = null; this.renderMarks(); }
    if (this.repointing || this.boxNext) { this.map.getCanvas().style.cursor = 'crosshair'; return; }
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
  // The place current on the element selected: { id, index } (a line's point, 0 its start; an area's
  // corner; a point's part), pressed on the map or its row in Properties' table current; or null
  setPlace(place) {
    if (JSON.stringify(place) === JSON.stringify(this.currentPlace)) return;
    this.currentPlace = place;
    this.renderMarks();
  }
  // where the place current is, ringed on the map: a line's point, an area's corner (a part: none)
  placeAt() {
    const c = this.currentPlace, x = c && find(this.doc, c.id);
    return (x?.kind === 'line' || x?.kind === 'area') ? x.el.points[c.index] ?? null : null;
  }
  // Delete with a place current: it removed, as its row's Delete does (a line's point while more than
  // two, an area's corner while more than three, a part); false when it cannot be (Delete takes the element)
  removePlace() {
    const c = this.currentPlace, x = c && this.sel.size === 1 && this.sel.has(c.id) && find(this.doc, c.id);
    if (!x) return false;
    const { index: i } = c;
    if (x.el.points?.[i] && x.el.points.length > MIN_PLACES[x.kind]) this.change((doc) => deletePlace(doc, c.id, i));
    else if (x.kind === 'point' && x.el.parts[i]) this.change((doc) => { removePartOf(doc, c.id, i); reattach(doc, c.id); });
    else return false;
    return true;
  }
  // what the next click on the map attaches (Attach to…): place index of element id (a label's 0, a
  // line's place); or nothing
  startRepoint(id, index = 0) {
    this.stop(); // a click on the map now attaches, not a tool's next point
    this.boxSelect(false);
    this.repointing = { id, index };
    this.map.getCanvas().style.cursor = 'crosshair';
  }
  cancelRepoint() { this.repointing = null; this.map.getCanvas().style.cursor = ''; }
  // what a click on the map picks while the generator's form is open (fn(nodeId, position)), or null
  setPicking(fn, keepSel = !!fn) { this.picking = fn; this.keepSel = keepSel; if (!fn && !this.tool) this.map.getCanvas().style.cursor = ''; }
  // a tool's variant chosen (its row of kinds): the tool on with it
  setVariant(button, v) {
    this.variant[button] = v;
    this.start(button);
  }

  // ---- tools -----------------------------------------------------------------------------
  start(tool) {
    if (this.tool) this.stop();
    this.boxNext = false;
    clearTimeout(this.dblZoom); // stop()'s, which would turn it on again after this
    const v = this.variant[tool];
    this.button = tool;
    this.tool = tool === 'shape' && v === 'sector' ? v : tool;
    this.map.doubleClickZoom.disable();
    this.map.getCanvas().style.cursor = 'crosshair';
    this.onChange('tool');
  }
  stop() {
    if (!this.tool) return;
    this.snapMark = null;
    this.tool = null;
    this.button = null;
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
    this.clip = clipOf(this.doc, [...this.sel]);
    return this.clip.items.length;
  }
  paste(clip = this.clip, at = null) {
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
    const clip = this.sel.size && clipOf(this.doc, [...this.sel]), c = clip && centreOf(clip);
    if (!c) return 0;
    const q = this.map.project(c);
    return this.paste(clip, { x: q.x + 20, y: q.y + 20 });
  }
  // ---- snapping (snap.js): where a click or a drag lands --------------------------------------
  // the map's projection, as snap.js wants it
  view() {
    return { project: (p) => { const q = this.map.project(p); return [q.x, q.y]; }, unproject: (q) => { const p = this.map.unproject(q); return [p.lng, p.lat]; }, measure: measureText };
  }
  // Snapping at a screen point: { position, to (what a line's place would attach to), kind }. e: the
  // event (Alt: as it is, nothing snapped or attached; Shift, drawing from `from`: in 15° steps from
  // the leg before, prev → from); exclude: elements never snapped to. Marks the target on the map.
  snapFor(point, e, { from = null, prev = null, exclude = new Set() } = {}) {
    const ll = this.map.unproject(point), raw = [ll.lng, ll.lat];
    let r;
    if (e?.altKey) r = { position: raw, to: null, kind: null }; // Alt: free
    else if (e?.shiftKey && from) r = { position: stepped(from, raw, prev), to: null, kind: null };
    else r = snapAt(this.doc, [point.x, point.y], this.view(), { ids: new Set(this.hitAt(point, SNAP_PX)), exclude, radius: SNAP_PX }) || { position: raw, to: null, kind: null };
    this.snapMark = r.kind ? { kind: r.kind, position: r.position } : null;
    return r;
  }
  // the leg being drawn: where it starts, and the leg before it (for Shift)
  lastLeg() {
    const pts = this.draft?.pts ?? [];
    return { from: pts.at(-1) ?? null, prev: pts.at(-2) ?? null };
  }
  // a point within snapping distance of a screen point, if any (the nearest): Connect's roots
  pointAt(point) {
    let best = null, bd = SNAP_PX;
    for (const n of this.doc.points) {
      if (!isShown(this.doc, n)) continue;
      const q = this.map.project(n.position), d = Math.hypot(q.x - point.x, q.y - point.y);
      if (d <= bd) { best = n.id; bd = d; }
    }
    return best;
  }

  // ---- the Line tool: its places, by clicks (drawing-ui.md §2.1) ----------
  // The Line tool, and Measure (drawing-ui.md §3) as it: each click a place, snapped (the Line tool's
  // first and last, on something to attach to, linked there when it is made; a measurement's to
  // nothing); Enter, a double-click or Done ends it, a click on its first place closes it into an area.
  // What is measured goes in the drawing as a measurement (a guide showing its values, its legs'
  // lengths shown as it is drawn), selected: saved and printed with it, deleted as anything else.
  lineClick(point, e) {
    if (this.closesPath(point)) return this.closeLine();
    const r = this.snapFor(point, e, this.lastLeg()), p = r.position, to = this.tool === 'line' ? r.to : null;
    const d = (this.draft ??= { pts: [], tos: [] }), last = d.pts.at(-1); // a double-click's second click: the same place
    if (!last || last[0] !== p[0] || last[1] !== p[1]) { d.pts.push(p); d.tos.push(to ?? null); }
    this.renderMarks();
    this.onChange('draft');
  }
  // the line made: its ends linked to what they snapped to (another line's free end: a point made there,
  // once for both ends when it is the same one), one undo step
  finishLine() {
    const d = this.draft, measured = this.tool === 'measure';
    if (!(d?.pts.length > 1)) return; // no second point: nothing to make yet
    this.draft = null;
    let seg;
    this.change((doc) => {
      seg = addLine(doc, d.pts, measured ? { ...guideWithValues(), name: nextName(doc, 'line', 'Distance') } : {});
      const [a, b] = [d.tos[0], d.tos.at(-1)], first = attachTo(doc, a);
      setLink(doc, seg.id, 0, first);
      setLink(doc, seg.id, d.pts.length - 1, a?.end && JSON.stringify(a) === JSON.stringify(b) ? first : attachTo(doc, b));
    });
    this.select([seg.id]);
    this.onChange('draft');
  }
  // Undo while a line or measurement is being drawn: its last point back (Backspace too)
  undo() { if (this.draft) this.undoPoint(); else super.undo(); }
  undoPoint() {
    const d = this.draft;
    if (!d) return;
    if (d.pts.length > 1 && this.tool !== 'shape') { d.pts.pop(); d.tos?.pop(); } else this.draft = null;
    this.renderMarks();
    this.onChange('draft');
  }
  cancelDraft() { this.draft = null; this.renderMarks(); this.onChange('draft'); }
  // the line or measurement being drawn, three points or more so far: the pointer on its first point (a
  // click there closes it)
  pathPoints() { return this.finishesOnDoubleClick() ? this.draft?.pts ?? [] : []; }
  closesPath(point) {
    const pts = this.pathPoints();
    if (pts.length < 3) return false;
    const q = this.map.project(pts[0]);
    return Math.hypot(q.x - point.x, q.y - point.y) <= SNAP_PX;
  }
  // the line closed: an area of its points (what its first point was attached to is not kept; a
  // measurement's shows its area and perimeter); the tool stays on for the next
  closeLine() {
    const pts = this.pathPoints(), measured = this.tool === 'measure';
    this.draft = null;
    let g;
    this.change((doc) => { g = addArea(doc, pts, measured ? guideWithValues() : {}); });
    this.select([g.id]);
    this.onChange('draft');
  }
  // the keys' (keyEvents): Enter or a double-click ends the line or measurement being drawn;
  // Esc drops it, or else ends the tool
  finish() { if (this.finishesOnDoubleClick()) this.finishLine(); }
  escape() {
    if (this.tool === 'sector' && this.draft?.pts.length) return this.undoPoint(); // one click back
    if (this.draft) this.cancelDraft();
    else this.stop();
  }
  finishesOnDoubleClick() { return ['line', 'measure'].includes(this.tool); }
  // Shape, in two clicks: the centre; then the size, the pointer showing it (a
  // circle's radius, an outline's front); a rectangle or an ellipse (place.js BOX) corner to corner
  // instead (Shift: a square, a circle). A second click on the first: the default size, centred there.
  // Facing north always (the bearing is set afterwards); a preset of the user's, which has its size, in
  // one click.
  boxing() { return BOX.has(this.variant.shape); }
  shapeClick(point, e) {
    if (!this.draft) {
      const r = this.snapFor(point, e);
      this.draft = { pts: [r.position] };
      this.cursor = { point, p: r.position, snap: r, shift: !!e?.shiftKey }; // its preview from here, until the pointer moves
      if (this.variant.shape?.startsWith('preset:')) return this.finishShape(null); // a preset of the user's has its size: one click
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
      el = placeKind(doc, c, this.variant.shape, this.presets, d);
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
    const el = placeKind(doc, d.pts[0], this.variant.shape, this.presets, g.s);
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
        const part = sec.aperture ? makePart('sector', { radius, aperture: sec.aperture }) : makePart('circle', { radius });
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
  // the line or measurement being drawn, to the cursor: its points
  draftLine() {
    const pts = this.pathPoints();
    return pts.length ? { pts: [...pts, ...(this.cursor ? [this.cursor.p] : [])] } : null;
  }
  // what is being drawn: a shape, a sector, a polygon, or the line (what a click would join is marked
  // by snap.js, under the pointer only)
  draftFeatures() {
    const line = (coordinates) => ({ type: 'Feature', properties: { kind: 'draft' }, geometry: { type: 'LineString', coordinates } });
    const dot = (coordinates) => ({ type: 'Feature', properties: { kind: 'draftpt' }, geometry: { type: 'Point', coordinates } });
    const sh = this.draftShape();
    if (sh) {
      // the reach from the centre to the pointer: a radius, drawn as a guide for a round shape only (an
      // outline faces north whatever the pointer's direction, so the line would say nothing)
      const { el } = sh, out = mainOutline(el) ? [] : [line([sh.centre, sh.to])];
      for (const part of el.parts) out.push(line(part.radius ? ringOf(el, part) : outlineOf(el.position, el.bearing, part.length, part.width, part.kind).ring));
      return out;
    }
    const sec = this.draftSector();
    if (sec) {
      const out = [line([sec.centre, sec.first])];
      if (this.draft.pts[1] && sec.r > 0) out.push(line(sec.aperture ? sector(sec.centre, sec.r, sec.bearing, sec.aperture) : circle(sec.centre, sec.r)));
      return out;
    }
    const l = this.draftLine();
    if (!l) return [];
    return [line(l.pts), ...l.pts.slice(0, this.cursor ? -1 : undefined).map(dot)];
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
    const l = this.draftLine();
    if (!l || l.pts.length < 2) return [];
    const doc = emptyDoc(0);
    addLine(doc, l.pts, { ...guideWithValues(), id: DRAFT_ID });
    return valueFeatures(doc, u, b);
  }

  // ---- dragging (drawing-ui.md §5): selected elements and their handles ------------------------
  handleAt(point, pad = GRAB_PX) {
    const layers = HANDLE_LAYERS.filter((id) => this.map.getLayer(id));
    const f = this.map.queryRenderedFeatures([[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]], { layers })[0];
    return f && { id: f.properties.id, role: f.properties.role, ref: f.properties.ref };
  }
  dragEvents(map) {
    const box = map.getCanvasContainer(), at = (e) => canvasPoint(map, e);
    // first (capture): a press on a handle or a selected element takes the gesture from the map's panning
    box.addEventListener('pointerdown', (e) => {
      // a second finger during a drag: everything back (as Esc), the map's pinch takes over
      if (this.drag && e.pointerId !== this.drag.pointer) { this.cancelDrag(); return; } // a second finger: everything as it was (Esc too: keyEvents)
      if (e.button !== 0 || this.tool || this.picking || !this.sel.size || e.ctrlKey || e.metaKey) return;
      const pt = at(e), h = this.handleAt(pt);
      const grab = h || (this.hitAt(pt, 3).some((id) => this.sel.has(id)) ? { role: 'move' } : null);
      if (!grab) return;
      // a line's point, an area's corner or a point's part (a handle of it) pressed: its row in
      // Properties' table made current (place: the element and the row's index, a line's start 0)
      const index = ['vertex', 'ppoint', 'radius', 'aperture', 'corner', 'side'].includes(h?.role) ? parseInt(h.ref, 10) : null;
      if (index != null) { this.setPlace({ id: h.id, index }); this.onChange('place'); }
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
    window.addEventListener('pointercancel', () => { if (this.drag) this.cancelDrag(); }); // taken by the browser: as a second finger
    window.addEventListener('pointerup', () => {
      const d = this.drag;
      if (!d) return;
      cancelAnimationFrame(raf);
      move?.(); // the last move, not drawn yet: where it is released
      this.drag = null;
      this.snapMark = null;
      map.dragPan.enable();
      if (d.moved) { this.pending = d.orig; this.change(() => {}); } // one undo step, from the document before the drag
      this.onChange('drag');
    });
  }
  cancelDrag() {
    this.doc = JSON.parse(this.drag.orig);
    this.drag = null;
    this.map.dragPan.enable();
    this.render();
    this.onChange('drag');
  }
  // The keys and clicks of what is being drawn, from anywhere but a field or a dialog: Enter, a
  // double-click or a right-click (not a right drag, which rotates the map) finishes the line or
  // polygon, as in QGIS; a right-click with nothing to finish steps back one level, as Esc does:
  // a drag undone, a form closed, Attach to… given up, what is half-drawn dropped, else the tool
  // ended, else the selection cleared. Backspace (or Undo) takes back a point.
  keyEvents(map) {
    const escape = () => {
      if (this.drag) return this.cancelDrag();
      if (this.keepSel) return this.onChange('cancel'); // the form's Cancel
      if (this.repointing) { this.cancelRepoint(); return this.onChange('sel'); }
      if (this.tool) return this.escape();
      if (this.boxNext) return this.boxSelect(false);
      this.select([]);
    };
    let right = null;
    map.on('mousedown', (e) => { if (e.originalEvent.button === 2) right = e.point; });
    map.on('contextmenu', (e) => { if (right && Math.hypot(e.point.x - right.x, e.point.y - right.y) <= 3) { if (this.finishesOnDoubleClick() && this.pathPoints().length >= 2) this.finish(); else escape(); } });
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
        const to = linkFrom(doc, el.id)?.to, x = to && find(doc, to.element);
        if (!to) el.position = moved(el.position, d.start, p);
        else if (x) setLink(doc, el.id, 0, refNear(doc, x, p) ?? to);
        return;
      }
      case 'point': { // a line's place linked to a point's centre: the point moves, snapped (not onto itself or its lines)
        const n = point(d.ref), mine = new Set([n.id, ...doc.links.filter((l) => l.to.element === n.id).map((l) => l.from[0])]);
        n.position = this.snapped(pt, e, moved(n.position, d.start, p), { exclude: mine }).position;
        return;
      }
      case 'vertex': { // a line's place, snapped; on something to attach to, linked there (Alt: free)
        const i = +d.ref, r = this.snapped(pt, e, moved(el.points[i], d.start, p), { exclude: new Set([el.id]), ...neighbours(el.points, i) });
        this.putPlace(doc, { kind: 'line', el }, i, { position: r.position, to: attachTo(doc, r.to) });
        return;
      }
      case 'mid': { const q = this.snapped(pt, e, p, { exclude: new Set([el.id]) }).position; insertPlace(doc, el.id, +d.ref + 1, q); return; }
      case 'ppoint': { // an area's corner, snapped
        const n = el.points.length, ring = [...el.points.slice(d.ref + 1), ...el.points.slice(0, d.ref + 1)]; // ending at this corner
        el.points[d.ref] = this.snapped(pt, e, moved(el.points[d.ref], d.start, p), { exclude: new Set([el.id]), ...neighbours(ring, n - 1) }).position;
        return;
      }
      case 'pmid': { const q = this.snapped(pt, e, p, { exclude: new Set([el.id]) }).position; insertPlace(doc, el.id, +d.ref, q); return; } // a corner added halfway along an edge
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
      case 'rotate': el.bearing = bearingTo(el.position, p, snap);
    }
  }
  // a dragged position: snapped where the pointer is near something (snapFor), else where the drag
  // puts it (at: the grabbed thing moved as the pointer), in steps with Shift
  snapped(pt, e, at, opts) {
    if (e.shiftKey && opts.from) { this.snapMark = null; return { position: stepped(opts.from, at, opts.prev), to: null }; }
    const r = this.snapFor(pt, e, { exclude: opts.exclude });
    return r.kind ? r : { position: at, to: null };
  }
  // the selection moved by the pointer's displacement (a group: everything in it), each position once:
  // a line's place linked moves what it is on when that is a point (once, however many places are on
  // it), else follows it. Labels: alone in the selection, their text moves (its offset on screen); with
  // other elements, a free one moves with them, one on an element follows it.
  moveSelection(doc, start, p) {
    const onlyLabels = [...this.sel].every((id) => find(doc, id)?.kind === 'label');
    const a = this.map.project(start), b = this.map.project(p), mv = (pos) => moved(pos, start, p);
    const points = new Set(); // the points moved: selected, or what a selected line's place is on
    for (const { kind, el } of leavesOf(doc, this.sel)) {
      if (kind === 'point') points.add(el.id);
      else if (kind === 'label' && onlyLabels) el.offset = [Math.round(el.offset[0] + b.x - a.x), Math.round(el.offset[1] + b.y - a.y)];
      else {
        const tied = new Map(doc.links.filter((l) => l.from[0] === el.id).map((l) => [l.from[1], l.to.element]));
        positionsIn(kind, el).forEach(([o, k], i) => {
          if (!tied.has(i)) o[k] = mv(o[k]);
          else if (kind === 'line') points.add(tied.get(i)); // a line's place linked: what it is on moves, if a point; a label on one follows it
        });
      }
    }
    for (const n of doc.points) if (points.has(n.id)) n.position = mv(n.position);
  }

  // Box select (Select's other kind, B): the next drag on the map, a mouse's or a finger's, draws the
  // box (as Shift-drag does), then back to Select; on: false puts it off
  boxSelect(on) {
    if (on && this.tool) this.stop();
    this.boxNext = on;
    this.map.getCanvas().style.cursor = on ? 'crosshair' : '';
    this.onChange('tool');
  }
  // ---- box select: Shift-drag a box with no tool on (a finger: held, then dragged), what lies inside
  // added to the selection -------
  areaEvents(map) {
    const box = document.createElement('div');
    box.className = 'dbox';
    box.hidden = true;
    map.getCanvasContainer().append(box);
    let from = null;
    const at = (e) => canvasPoint(map, e);
    map.boxZoom.disable(); // Shift-drag is the box's, not the map's box zoom
    const begin = (p) => {
      map.dragPan.disable();
      from = p;
      Object.assign(box.style, { left: `${from.x}px`, top: `${from.y}px`, width: '0px', height: '0px' });
      box.hidden = false;
    };
    // first (capture, after a drag's): Shift pressed on the map with no tool, or Box select pressed
    // (a finger's way too: the dock's button), not on what a drag takes
    map.getCanvasContainer().addEventListener('pointerdown', (e) => {
      if (this.tool || this.drag || !(e.shiftKey || this.boxNext) || (e.button !== 0 && e.pointerType !== 'touch') || e.ctrlKey || e.metaKey) return;
      if (from) return; // a second finger
      begin(at(e));
    }, true);
    map.getCanvasContainer().addEventListener('contextmenu', (e) => { if (from) e.preventDefault(); }); // a long press's menu while the box is drawn
    window.addEventListener('pointermove', (e) => {
      if (!from) return;
      const p = at(e);
      Object.assign(box.style, { left: `${Math.min(from.x, p.x)}px`, top: `${Math.min(from.y, p.y)}px`, width: `${Math.abs(p.x - from.x)}px`, height: `${Math.abs(p.y - from.y)}px` });
    });
    const end = () => {
      from = null;
      box.hidden = true;
      map.dragPan.enable();
      if (this.boxNext) this.boxSelect(false); // one box, then Select again
    };
    window.addEventListener('pointercancel', () => { if (from) end(); }); // taken by the browser: nothing selected
    window.addEventListener('pointerup', (e) => {
      if (!from) return;
      const p = at(e), a = from;
      end();
      if (Math.abs(p.x - a.x) < 3 && Math.abs(p.y - a.y) < 3) return; // a click, not a drag
      this.select(this.inside([Math.min(a.x, p.x), Math.min(a.y, p.y), Math.max(a.x, p.x), Math.max(a.y, p.y)]), 'add');
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
  // Point tool's click)
  place(p) {
    let el;
    this.change((doc) => { el = placeKind(doc, p, this.variant.point, this.presets); });
    this.select([el.id]);
    return el;
  }

  // A label where the Label tool clicks: on a point or an area, pointing at it; on a line, at that
  // distance along it; elsewhere, free text there. Selected, for its text to be typed.
  placeLabel(point, p) {
    let el;
    this.change((doc) => { const r = this.anchorFor(point, p); el = addLabel(doc, r.position, r.to); });
    this.select([el.id]);
    this.onChange('placed'); // the panel puts the cursor in its text
    return el;
  }
  // where a label clicked at would point, and at what ({ position, to: a target, or null): what
  // snapping finds there (a point's centre, a vertex, a place on an edge or a line's leg); else a
  // point, an area's centre or a line where it is clicked; else the position itself
  anchorFor(point, p) {
    const r = snapAt(this.doc, [point.x, point.y], this.view(), { ids: new Set(this.hitAt(point, SNAP_PX)), radius: SNAP_PX });
    const at = (to) => ({ position: [...resolve(this.doc, to).position], to });
    if (r?.to && !r.to.end) return at(r.to);
    const x = this.hitAt(point).map((id) => find(this.doc, id)).find((y) => y && ['point', 'line', 'area'].includes(y.kind));
    if (x?.kind === 'line') return at(lineRef(this.doc, x.el, nearestAlong(lineTrace(this.doc, x.el).coords, p)));
    if (x) return at({ element: x.el.id });
    return { position: p, to: null };
  }
  // place index of x ({ kind, el }) put at r.position and linked to r.to (a target, or null: free)
  putPlace(doc, x, index, r) {
    const [o, k] = positionsIn(x.kind, x.el)[index];
    o[k] = [...r.position];
    setLink(doc, x.el.id, index, r.to);
  }
}

const ALL_PARTS = { base: true, zoom: true, marks: true }, MARKS_ONLY = { marks: true };
const guideWithValues = () => ({ guide: true, look: { text: { values: true } } }); // what Measure makes; how what is drawn shows its values

