// The drawings kept in this browser's local storage, never sent anywhere: each under its own key, with
// a small index (its title, when it last changed, its size); the one open saved as it changes, read
// back at load. New, Import and Delete add to the list and take from it; switching opens another,
// with its view. Local storage may be missing or refuse (private windows, full, turned off): every
// access is guarded.

import { emptyDoc } from './document.js';
import { parse } from './file.js';

const INDEX = 'charts.drawings', CURRENT = 'charts.drawings.current', OPENING = 'charts.drawings.opening';
const KEY = (id) => `charts.drawing.${id}`;

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  remove: (k) => { try { localStorage.removeItem(k); } catch { /* nothing to remove */ } },
};
const newKey = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('');
const readIndex = () => { try { const v = JSON.parse(store.get(INDEX)); return Array.isArray(v) ? v : []; } catch { return []; } };

// a drawing kept, read: the last one read is kept, so the open drawing is read once at load (for its
// view before the map is made, then by restore())
let lastRead = null; // { text, read: parse's result }
function readKept(text, known) {
  if (lastRead?.text !== text) lastRead = { text, read: parse(text, known) };
  return lastRead.read;
}
// the view of the drawing open (format terms), or null: read before the map is made
export function savedView(known) {
  const id = store.get(CURRENT), text = id && store.get(KEY(id));
  return text ? readKept(text, known).doc?.view ?? null : null;
}

// drawing: the Drawing (drawing.js) whose document is saved: its doc, known, text(), isEmpty(),
// adopt(doc), onChange('storage'). failed: the browser refused to save it; otherTab: another tab
// saved over it.
export class Saving {
  constructor(drawing) {
    this.d = drawing;
    this.timer = 0;
    this.failed = false;
    this.viewMoved = false; // the view moved since the last save
    this.otherTab = false;
    this.id = store.get(CURRENT) || newKey(); // the drawing open: saved once it holds something
    window.addEventListener('storage', (e) => { if (e.key === KEY(this.id)) { this.otherTab = true; this.d.onChange('storage'); } });
    // a change still waiting to be saved when the page goes (closed, reloaded, hidden): saved now
    const flush = () => { if (this.timer || this.viewMoved) this.now(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }
  // the drawings, the one changed last first: [{ id, title, modified, size, open }]
  list() {
    const index = readIndex();
    if (!index.some((x) => x.id === this.id)) index.push({ id: this.id, title: this.d.doc.meta.title, modified: this.d.doc.modified, size: 0 }); // open, not saved yet
    return index.map((x) => ({ ...x, open: x.id === this.id })).sort((a, b) => (a.modified < b.modified ? 1 : -1));
  }
  // the drawing open, read back at load
  restore() {
    const text = store.get(KEY(this.id));
    if (!text) return;
    const { doc, report } = readKept(text, this.d.known);
    lastRead = null; // the document is the drawing's own from now on
    // one this app cannot read (another format version): left as it is, never saved over; a new one opens
    if (!doc) { console.error('saved drawing not read:', report.refused); this.id = newKey(); store.set(CURRENT, this.id); return; }
    // one that stalled the page while it was drawn last time (the page closed before OPENING was
    // cleared): left as it is, a new one opens, so the page always comes up
    if (store.get(OPENING) === this.id) { console.error('saved drawing not opened: the page did not finish drawing it last time'); store.remove(OPENING); this.id = newKey(); store.set(CURRENT, this.id); return; }
    store.set(OPENING, this.id);
    this.d.adopt(doc);
    store.remove(OPENING);
  }
  soon() { clearTimeout(this.timer); this.timer = setTimeout(() => this.now(), 400); }
  now() {
    clearTimeout(this.timer);
    this.timer = 0;
    this.viewMoved = false;
    if (this.d.isEmpty() && !store.get(KEY(this.id))) return; // nothing drawn, nothing saved: nothing to do
    const text = this.d.text();
    const ok = store.set(KEY(this.id), text);
    if (ok) {
      const index = readIndex().filter((x) => x.id !== this.id);
      index.push({ id: this.id, title: this.d.doc.meta.title, modified: this.d.doc.modified, size: text.length });
      store.set(INDEX, JSON.stringify(index));
      store.set(CURRENT, this.id);
    }
    if (ok === !this.failed) return; // as it was: nothing to say
    this.failed = !ok;
    this.d.onChange('storage');
  }
  // the view only changed: kept with the drawing at its next save, or when the page goes; never by a
  // tab another tab has saved over since (it would put back that tab's older drawing)
  viewChanged() { if (!this.d.isEmpty() && !this.otherTab) this.viewMoved = true; }
  // open another drawing of the list (this one saved first); returns its view, or null
  open(id) {
    if (id === this.id) return null;
    this.now();
    return this.load(id)?.view ?? null;
  }
  // the drawing id read and opened: its document, or null (not there, not readable)
  load(id) {
    const text = store.get(KEY(id));
    const doc = text && parse(text, this.d.known).doc;
    if (!doc) return null;
    this.id = id;
    store.set(CURRENT, id);
    this.otherTab = false;
    this.d.adopt(doc);
    return doc;
  }
  // a drawing added to the list and opened: an empty one (New), or one imported
  add(doc = emptyDoc()) {
    this.now();
    this.id = newKey();
    this.otherTab = false;
    this.d.adopt(doc);
    this.now();
  }
  // a drawing deleted for good; the one open goes to the next of the list, or a new empty one
  remove(id) {
    store.remove(KEY(id));
    store.set(INDEX, JSON.stringify(readIndex().filter((x) => x.id !== id)));
    if (id !== this.id) { this.d.onChange('doc'); return; }
    clearTimeout(this.timer); // the one deleted is not saved again
    this.timer = 0;
    const next = readIndex().sort((a, b) => (a.modified < b.modified ? 1 : -1))[0];
    if (next && this.load(next.id)) return;
    this.id = newKey();
    store.remove(CURRENT);
    this.d.adopt(emptyDoc());
  }
}
