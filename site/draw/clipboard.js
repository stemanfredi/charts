// Copy, paste, duplicate (docs/drawing-ui.md §8). A copy keeps its group (when the drawing has
// it), its look and properties; it gets new IDs and numbered names, and keeps the attachments between
// the elements copied together (ends attached to an element left behind are free; a label on one keeps
// pointing at it, if it is in the drawing, else is free where it pointed). The clipboard holds the
// elements as the document does, in this page, so they paste into another drawing opened in it too.
// Pure.

import { find, leavesOf, positionsIn, newId, idsOf, KIND, nextName } from './document.js';
import { extentOf } from './features.js';

const clone = (x) => structuredClone(x);

// The elements ids as a clipboard: { items: [{ kind, el }] } (for a group, everything in it; the
// groups themselves are not copied); a label's anchor holds where it points.
export const clipOf = (doc, ids) => ({ items: leavesOf(doc, ids).map(({ kind, el }) => ({ kind, el: clone(el) })) });

// the middle of what a clipboard holds (its bounding box's centre), or null
export function centreOf(clip) {
  const b = extentOf(clip.items.flatMap(({ kind, el }) => positionsIn(kind, el).map(([o, k]) => o[k])));
  return b && [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}
// "Point 4" → "Point"; a name with no number of its own is its own base
const baseOf = (name) => /^(.*\S) \d+$/.exec(name)?.[1] ?? name;
// the next free name on base (document.js nextName), or '' for a name that was empty
const nameOn = (doc, kind, base) => (base ? nextName(doc, kind, base) : '');

// The clipboard pasted into doc, each position moved by mv(position): the new elements, in order.
export function paste(doc, clip, mv) {
  const taken = idsOf(doc), ids = new Map(), groups = new Set(doc.groups.map((g) => g.id));
  for (const { el } of clip.items) ids.set(el.id, newId(doc, taken));
  const made = [];
  for (const { kind, el: src } of clip.items) {
    const el = clone(src);
    el.id = ids.get(src.id);
    el.name = nameOn(doc, kind, baseOf(src.name));
    if (el.groupId && !groups.has(el.groupId)) el.groupId = null;
    for (const [o, k] of positionsIn(kind, el)) o[k] = mv(o[k]);
    if (kind === 'line') {
      for (const key of ['start', 'end']) {
        const e = el[key];
        if (e.element && ids.has(e.element)) e.element = ids.get(e.element);
        else if (e.element) el[key] = { position: e.position, element: null };
      }
    }
    if (kind === 'label' && el.anchor.element) {
      if (ids.has(el.anchor.element)) el.anchor.element = ids.get(el.anchor.element);
      else if (!find(doc, el.anchor.element)) el.anchor = { position: el.anchor.position, element: null };
    }
    doc[KIND[kind].list].push(el);
    made.push({ kind, el });
  }
  return made;
}
