// The drawing being edited, without the map: the document (document.js), its selection, the element
// under the pointer, undo and redo, and the display setting it is drawn with. Pure: no map, no
// DOM (the tests run it in Node). The map's side (drawing.js) extends it and is told of each change:
// changed() (the document), selectionChanged(), hoverChanged().

import { emptyDoc, touch, find, elements, dependents } from './document.js';
import { refreshAttached } from './attach.js';
import { refreshAuto } from './lines.js';
import { removeKeepingLabels } from './labels.js';
import { refreshGenerated, reconnectWithout } from './generator.js';

const UNDO_STEPS = 100, UNDO_BYTES = 20e6;

// after any change: attached ends follow their points, curves in mode "auto" their anchors, an array
// follows its line (as now curved) and a hub its points; then the lines attached to those follow again
export function settleGeometry(doc) {
  refreshAttached(doc);
  refreshAuto(doc);
  refreshGenerated(doc);
  refreshAttached(doc);
  refreshAuto(doc);
}

export class DrawStore {
  constructor() {
    this.doc = emptyDoc();
    this.sel = new Set();
    this.hover = null;
    this.undos = []; // the document before each change, as JSON, oldest first
    this.redos = [];
    this.pending = null; // the document before a change being previewed (a colour being picked)
  }
  // the map's: told of what changed
  changed() {}
  selectionChanged() {}
  hoverChanged() {}

  // ---- selection ---------------------------------------------------------------------------
  // mode: 'replace', 'toggle' (each id in or out) or 'add'
  select(ids, mode = 'replace') {
    const next = mode === 'replace' ? new Set() : new Set(this.sel);
    for (const id of ids) {
      if (mode === 'toggle' && next.has(id)) next.delete(id);
      else next.add(id);
    }
    if (next.size === this.sel.size && [...next].every((id) => this.sel.has(id))) return;
    this.sel = next;
    this.selectionChanged();
  }
  selected() { return [...this.sel].map((id) => find(this.doc, id)).filter(Boolean); }
  setHover(id) {
    if (this.hover === id) return;
    this.hover = id;
    this.hoverChanged();
  }

  // ---- changes, undo -----------------------------------------------------------------------
  // A change shown while it is being made (a colour picker moving), not yet an undo step: the next
  // change() makes the step, from the document as it was before the first preview.
  preview(fn) {
    if (this.pending == null) this.pending = JSON.stringify(this.doc);
    fn(this.doc);
  }
  // fn(doc) changes the document: one undo step (none when nothing changed: a field applied twice)
  change(fn) {
    const before = this.pending ?? JSON.stringify(this.doc);
    this.pending = null;
    fn(this.doc);
    settleGeometry(this.doc);
    if (JSON.stringify(this.doc) === before) return;
    touch(this.doc);
    this.undos.push(before);
    let bytes = this.undos.reduce((n, s) => n + s.length, 0);
    while (this.undos.length > UNDO_STEPS || (bytes > UNDO_BYTES && this.undos.length > 1)) bytes -= this.undos.shift().length;
    this.redos = [];
    this.settle();
  }
  undo() { this.step(this.undos, this.redos); }
  redo() { this.step(this.redos, this.undos); }
  step(from, to) {
    if (!from.length) return;
    if (this.pending != null) { this.doc = JSON.parse(this.pending); this.pending = null; } // a preview not applied: dropped
    to.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(from.pop());
    this.settle();
  }
  // after the document changed: the selection and the hover keep only what still exists
  settle() {
    const ids = new Set(elements(this.doc).map((x) => x.el.id));
    this.sel = new Set([...this.sel].filter((id) => ids.has(id)));
    if (this.hover && !ids.has(this.hover)) this.hover = null;
    this.changed();
  }
  // what deleting ids takes with it (to ask first), and the deletion: one undo step
  dependents(ids, withMembers) { return dependents(this.doc, ids, withMembers); }
  // a delete: one undo step; a connection that lost a root made again with those left
  remove(ids, withMembers = false) { this.change((doc) => reconnectWithout(doc, removeKeepingLabels(doc, ids, withMembers))); }
  // A whole other document (read back, opened, New): its display settings with it, nothing selected,
  // undo starting again.
  adopt(doc) {
    this.doc = doc;
    this.undos = [];
    this.redos = [];
    this.pending = null;
    this.sel = new Set();
    this.hover = null;
    this.settle();
  }
  isEmpty(doc = this.doc) { return !elements(doc).length && !doc.meta.title && !doc.meta.description && !doc.meta.author; }
}
