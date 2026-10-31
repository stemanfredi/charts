// The tree (docs/drawing-ui.md §4): its first row the drawing, then every element, groups first,
// what is in each (a group's members, a point's shapes) one level further in; a filter past FILTER_FROM elements; rows selected by a click
// (Shift: a range; Ctrl/⌘: add or remove), hovered on the map, renamed (a double-click, F2), dragged
// into a group or before one of their kind, shown or hidden by their eye.

import { h, editInPlace } from '../dom.js';
import { find, elements, groupsOf, membersOf, label, KIND, setGroup, moveBefore, isShown, canHold, holderOf } from './document.js';
import { labelText } from './labels.js';
import { lineTrace } from './lines.js';
import { MOD } from '../keys.js';
import { fmtArea, fmtDist, plural } from '../format.js';
import { icon, KIND_ICON, UI_ICON, POINT_ICON } from '../icons.js';

const FILTER_FROM = 30; // the filter field appears past this many elements
// what a total counts: "15 points · 10 circles · 3 lines, 12.4 km · 2 areas" (closed lines)
const countOf = (b, u) => [b.points ? plural(b.points, 'point') : '', b.circles ? plural(b.circles, 'circle') : '',
  b.lines ? `${plural(b.lines, 'line')}, ${fmtDist(b.length, u)}` : '', b.areas ? plural(b.areas, 'area') : '', b.hidden ? 'incl. hidden' : ''].filter(Boolean).join(' · ');
// an element's icon and what the panel calls its kind: a circle or a sector; a closed line a polygon
const iconOf = (kind, el) => (kind === 'circle' ? POINT_ICON[el.aperture ? 'sector' : 'circle'] : KIND_ICON[el.closed ? 'polygon' : kind]);
export const kindTitle = (kind, el) => (kind === 'circle' && el.aperture ? 'Sector' : KIND[kind].name);
// an element's name as shown: its own, else a label's text as it reads on the map (its first line)
export const shownName = (doc, kind, el, units) => (kind === 'label' && !el.name?.trim() ? labelText(doc, el, units).split('\n')[0].trim() || 'Label' : label(kind, el));
// a group's name with the groups it is in: "A › B"
export const groupPath = (doc, g) => [...groupsOf(doc, g).reverse(), g].map((x) => label('group', x)).join(' › ');

const showAll = (drawing, v, xs) => drawing.change((doc) => { for (const x of xs) find(doc, x.el.id).el.visible = v; });
// An eye for all of xs() (what: what they are, for its label): every one shown, a click hides them
// all; some or none, a click shows them all. render() when they change.
export function eyeFor(drawing, xs, what) {
  const seen = (x) => x.el.visible;
  const b = h('button', { type: 'button', class: 'deye', onclick: () => { const all = xs(); showAll(drawing, !all.every(seen), all); } });
  b.render = () => {
    const all = xs(), on = all.filter(seen).length, every = !!all.length && on === all.length;
    b.setAttribute('aria-pressed', on && !every ? 'mixed' : String(every));
    b.setAttribute('aria-label', `${every ? 'Hide' : 'Show'} all ${what}`);
    b.title = every ? 'All shown: click to hide them all' : on ? 'Some hidden: click to show them all' : 'All hidden: click to show them all';
    b.replaceChildren(icon(...(every ? UI_ICON.eye : UI_ICON.hidden)));
  };
  return b;
}

// drawing (drawing.js); facts(): the totals computed for this rendering;
// Returns { box, render(), mark() (the selection marked,
// the last selected scrolled to), shown() (the rows, in order), step(dir) (↑ ↓:
// the next row selected; false if none), rename(id) }.
export function createTree(drawing, { facts }) {
  let anchor = null; // the row a Shift-click range starts from
  let filter = '';
  const folded = new Set(); // groups and points folded (this session)
  const filterInput = h('input', { type: 'search', placeholder: 'Filter by name or value', 'aria-label': 'Filter the list', oninput: (e) => { filter = e.target.value; render(); } });
  const selectShown = h('button', { type: 'button', class: 'small', title: 'Select every element the filter leaves in the list (Shift: add to the selection)',
    onclick: (e) => drawing.select(shown().map((x) => x.el.id), e.shiftKey ? 'add' : 'replace') }, 'Select all shown');
  // the list's head: the drawing's title, the eye for every element listed, its fold; above the list, past FILTER_FROM elements, the filter and
  // Select all shown
  const listed = () => (filter ? shown() : drawElements());
  const eyeAll = eyeFor(drawing, listed, 'listed');
  const filterRow = h('div', { class: 'dfilter' }, filterInput, selectShown);
  // the hover ends when the pointer leaves the list: a row rebuilt under it never says it was left
  const list = h('ul', { class: 'dlist', 'aria-label': 'Elements', onpointerleave: () => drawing.setHover(null) });
  // The first row is the drawing (drawing-ui.md §4): its title, how much it holds, the eye for
  // everything listed (Properties shows it while nothing is selected).
  const rootName = h('button', { type: 'button', class: 'dname', title: 'The drawing: its title, its display, its totals. Double-click to rename.', onclick: () => drawing.select([]), ondblclick: () => renameDrawing() });
  const rootVal = h('span', { class: 'val' });
  const rootRow = h('div', { class: 'drow droot' }, h('span', { class: 'kind' }, icon(...UI_ICON.drawing)), rootName, rootVal, eyeAll);
  const listBox = h('div', { class: 'dlistbox' }, rootRow, filterRow, list);

  // the drawing's elements this view lists: all of them, measurements too
  const drawElements = () => elements(drawing.doc);
  // the elements in list order, as a tree: each group, then what is in it (its subgroups, then its
  // members; a point, then its shapes), one level further in; at the top, the groups, then the rest.
  // depth: how far in.
  function ordered() {
    const all = drawElements(), out = [], seen = new Set();
    const under = (gid, depth) => {
      for (const g of drawing.doc.groups.filter((x) => (x.groupId ?? null) === gid && !seen.has(x))) {
        seen.add(g);
        out.push({ kind: 'group', el: g, depth });
        if (!folded.has(g.id) || filter) under(g.id, depth + 1);
      }
      for (const x of all.filter((y) => y.kind !== 'group' && (y.el.groupId ?? null) === gid)) {
        out.push({ ...x, depth });
        if (x.kind === 'point' && (!folded.has(x.el.id) || filter)) under(x.el.id, depth + 1); // its shapes
      }
    };
    under(null, 0);
    return out;
  }
  function shown() {
    const f = filter.trim().toLowerCase();
    return ordered().filter((x) => !f || shownName(drawing.doc, x.kind, x.el, drawing.units()).toLowerCase().includes(f) || x.el.properties.some((p) => p.value.toLowerCase().includes(f)));
  }
  function value(kind, el) {
    const u = drawing.units();
    if (kind === 'point') return held.get(el.id) ? plural(held.get(el.id), 'shape') : '';
    if (kind === 'circle') return `${el.aperture ? `${+el.aperture.toFixed(1)}° ` : ''}r ${fmtDist(el.radius, u)}`;
    const offset = el.look?.offset ? '⇉' : ''; // Offset set here: found again in the list
    if (kind === 'line') { const tr = lineTrace(drawing.doc, el); return [el.guide ? 'guide' : '', el.closed ? fmtArea(tr.area, u) : fmtDist(tr.length, u), offset].filter(Boolean).join(' · '); }
    if (kind === 'label') return el.name?.trim() ? labelText(drawing.doc, el, u).split('\n')[0] : ''; // unnamed: its text is its name already
    const n = membersOf(drawing.doc, el.id, true).filter((x) => x.kind !== 'group').length; // labels and guides too: the totals leave them out
    return [n ? plural(n, 'element') : 'empty', offset].filter(Boolean).join(' · ');
  }

  // one row of the list: a group's fold (or its room), its kind, its name, a short value, its eye (shown
  // or hidden: its own flag), dim while not drawn (itself or a group it is in hidden); selected by a click (Ctrl/⌘: adds or removes), outlined on the map while the pointer is
  // over it
  function elementRow({ id, kindIcon, title, name, value = '', valueTitle, visible, drawn = visible, selected }, on, more = {}) {
    return h('li', { class: `drow${selected ? ' sel' : ''}${drawn ? '' : ' dim'}${more.classes ? ` ${more.classes}` : ''}`, 'data-id': id, draggable: 'true',
      onpointerenter: () => on.hover(id), onpointerleave: () => on.hover(null) },
    more.fold || h('span', { class: 'dfold none', 'aria-hidden': 'true' }),
    h('span', { class: 'kind', title }, icon(...kindIcon)),
    h('button', { type: 'button', class: 'dname', title: `Select (${MOD}: add or remove)`, onclick: (e) => on.select(e), ...more.name }, name),
    h('span', { class: 'val', title: valueTitle }, value),
    h('button', { type: 'button', class: 'deye', 'aria-pressed': String(visible), 'aria-label': `Show ${name}`, title: visible ? 'Shown: click to hide' : 'Hidden: click to show',
      onclick: () => on.visible(!visible) }, icon(...(visible ? UI_ICON.eye : UI_ICON.hidden))));
  }
  function rowOf({ kind, el, depth = 0 }) {
    const id = el.id;
    const fold = kind === 'group' || held.get(id) ? h('button', { type: 'button', class: 'dfold', 'aria-expanded': String(!folded.has(id)), 'aria-label': `Show the members of ${label(kind, el)}`,
      onclick: () => { if (folded.has(id)) folded.delete(id); else folded.add(id); render(); } }) : null;
    const t = kind === 'group' && facts().totals.groups.get(id);
    return elementRow({ id, kindIcon: iconOf(kind, el), title: kindTitle(kind, el), name: shownName(drawing.doc, kind, el, drawing.units()), value: value(kind, el), valueTitle: t ? countOf(t, drawing.units()) : undefined,
      visible: el.visible, drawn: isShown(drawing.doc, el), selected: chosen(el) }, {
      select: (e) => clickRow(id, e), hover: (x) => drawing.setHover(x),
      visible: (v) => drawing.change((doc) => { find(doc, id).el.visible = v; }),
    }, { fold, classes: [depth ? `d${Math.min(depth, 5)}` : '', kind === 'group' ? 'dgroup' : ''].filter(Boolean).join(' '),
      name: { title: `Select (Shift: range, ${MOD}: add or remove). Double-click to rename.`, ondblclick: () => rename(id) } });
  }

  let held = new Map(); // how many shapes each point holds, counted at each rendering
  function render() {
    held = new Map();
    for (const c of [...drawing.doc.circles, ...drawing.doc.lines]) if (c.groupId) held.set(c.groupId, (held.get(c.groupId) ?? 0) + 1);
    const rows = shown();
    filterRow.hidden = drawElements().length <= FILTER_FROM && !filter; // nothing to show above the list: no room taken
    list.replaceChildren(...rows.map(rowOf));
    eyeAll.render();
    rootName.textContent = drawing.doc.meta.title || 'Untitled drawing';
    rootVal.textContent = plural(drawElements().filter((x) => x.kind !== 'group').length, 'element');
    rootVal.title = countOf(facts().totals.all, drawing.units());
    if (!rows.length) list.append(h('li', { class: 'empty' }, filter ? 'Nothing matches the filter.' : 'Nothing drawn yet: pick a tool, then click on the map.'));
  }
  // A row dragged (drawing-ui.md §4): dropped on a group's row, into that group; on a row of its
  // kind, just before it (the drawing order: the first on top) and in its group; on another, in its
  // group. One undo step.
  let dragged = null;
  const dropOn = (e) => { const r = e.target.closest?.('.drow[data-id]'); return r && dragged && r.dataset.id !== dragged ? r : null; };
  list.addEventListener('dragstart', (e) => { dragged = e.target.closest?.('.drow')?.dataset.id ?? null; if (dragged) e.dataTransfer.effectAllowed = 'move'; });
  list.addEventListener('dragover', (e) => { const r = dropOn(e); if (!r) return; e.preventDefault(); for (const x of list.querySelectorAll('.drop')) if (x !== r) x.classList.remove('drop'); r.classList.add('drop'); });
  list.addEventListener('dragleave', (e) => e.target.closest?.('.drow')?.classList.remove('drop'));
  list.addEventListener('dragend', () => { dragged = null; for (const x of list.querySelectorAll('.drop')) x.classList.remove('drop'); });
  list.addEventListener('drop', (e) => {
    const r = dropOn(e);
    if (!r) return;
    e.preventDefault();
    const id = dragged, t = find(drawing.doc, r.dataset.id), x = find(drawing.doc, id);
    drawing.change((doc) => {
      if (t.kind === 'group' || (t.kind === 'point' && canHold(doc, t.el.id, id))) setGroup(doc, id, t.el.id); // into a group; a shape into a point
      else if (t.kind === x.kind) moveBefore(doc, id, t.el.id);
      else setGroup(doc, id, t.el.groupId ?? null);
    });
  });
  function clickRow(id, e) {
    // a range starts from the row last clicked, or else from the last element selected (on the map)
    if (!anchor || !drawing.sel.has(anchor)) anchor = [...drawing.sel].at(-1) ?? null;
    if (e.shiftKey && anchor) {
      const ids = shown().map((x) => x.el.id), a = ids.indexOf(anchor), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) return drawing.select(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    }
    anchor = id;
    drawing.select([id], e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
  }
  function rename(id) {
    const row = list.querySelector(`[data-id="${CSS.escape(id)}"]`), x = find(drawing.doc, id);
    if (!row || !x) return;
    const key = x.kind === 'label' ? 'text' : 'name'; // a label is its text
    editInPlace(row.querySelector('.dname'), x.el[key], { 'aria-label': key === 'text' ? 'Text' : 'Name' }, (v) => {
      if (v !== null && v !== x.el[key]) drawing.change((doc) => { find(doc, id).el[key] = v; });
      else render();
    });
  }

  // the drawing renamed in its row, as an element is: its title
  function renameDrawing() {
    const title = drawing.doc.meta.title || '';
    const input = editInPlace(rootName, title, { placeholder: 'Untitled drawing', 'aria-label': 'Title' }, (v) => {
      input.replaceWith(rootName);
      if (v !== null && v !== title) drawing.change((doc) => { doc.meta.title = v; });
      else render();
    });
  }

  // a row selected: its element, or a shape with its point
  const chosen = (el) => drawing.sel.has(el.id) || !!holderOf(drawing.doc, el) && drawing.sel.has(el.groupId);
  function mark() {
    for (const row of list.querySelectorAll('.drow[data-id]')) row.classList.toggle('sel', chosen(find(drawing.doc, row.dataset.id)?.el ?? {}));
    if (drawing.sel.size) list.querySelector(`[data-id="${CSS.escape([...drawing.sel].at(-1))}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function step(dir) {
    const ids = shown().map((x) => x.el.id);
    if (!ids.length) return false;
    const cur = ids.indexOf([...drawing.sel].at(-1));
    const next = cur < 0 ? (dir > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, cur + dir));
    anchor = ids[next];
    drawing.select([ids[next]]);
    return true;
  }
  return { box: listBox, render, mark, shown, step, rename };
}
