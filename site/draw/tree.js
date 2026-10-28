// The tree (docs/drawing-ui.md §4): its first row the drawing, then every element, groups first,
// what is in each one level further in; a filter past FILTER_FROM elements; rows selected by a click
// (Shift: a range; Ctrl/⌘: add or remove), hovered on the map, renamed (a double-click, F2), dragged
// into a group or before one of their kind, shown or hidden by their eye.

import { h } from '../dom.js';
import { find, elements, groupsOf, label, kindName, pointKind, POINT_KIND_NAME, mainOutline, followedPart, setGroup, moveBefore } from './document.js';
import { labelText } from './labels.js';
import { OUTLINE_NAME } from './outlines.js';
import { lineTrace } from './lines.js';
import { areaOf, pathOf } from '../geodesy.js';
import { MOD } from '../keys.js';
import { fmtArea, fmtDist, plural } from '../format.js';
import { KIND_ICON, UI_ICON, POINT_ICON } from './icons.js';

const FILTER_FROM = 30; // the filter field appears past this many elements
// what a total counts: "15 points, 10 with radii · 3 lines, 12.4 km · 2 areas"
export const countOf = (b, u) => [b.points ? `${plural(b.points, 'point')}${b.ringed && b.ringed < b.points ? `, ${b.ringed} with radii` : ''}` : '',
  b.lines ? `${plural(b.lines, 'line')}, ${fmtDist(b.length, u)}` : '', b.areas ? plural(b.areas, 'area') : '', b.hidden ? 'incl. hidden' : ''].filter(Boolean).join(' · ');
// an element's icon and what the panel calls its kind: a point by what it looks like (a circle, a
// rectangle…); an area a polygon
export const iconOf = (kind, el) => (kind === 'point' ? POINT_ICON[pointKind(el)] : KIND_ICON[kind === 'area' ? 'polygon' : kind]);
export const kindTitle = (kind, el) => (kind === 'point' ? (POINT_KIND_NAME[pointKind(el)] ?? OUTLINE_NAME[pointKind(el)]) : kindName(kind));
// a group's name with the groups it is in: "A › B"
export const groupPath = (doc, g) => [...groupsOf(doc, g).reverse(), g].map((x) => label('group', x)).join(' › ');

// An eye for all of xs() (what: what they are, for its label): every one shown, a click hides them
// all; some or none, a click shows them all. render() when they change.
const showAll = (drawing, v, xs) => drawing.change((doc) => { for (const x of xs) find(doc, x.el.id).el.visible = v; });
export function eyeFor(drawing, icon, xs, what) {
  const b = h('button', { type: 'button', class: 'deye', onclick: () => { const all = xs(); showAll(drawing, !all.every((x) => x.el.visible), all); } });
  b.render = () => {
    const all = xs(), on = all.filter((x) => x.el.visible).length, every = !!all.length && on === all.length;
    b.setAttribute('aria-pressed', on && !every ? 'mixed' : String(every));
    b.setAttribute('aria-label', `${every ? 'Hide' : 'Show'} all ${what}`);
    b.title = every ? 'All shown: click to hide them all' : on ? 'Some hidden: click to show them all' : 'All hidden: click to show them all';
    b.replaceChildren(icon(...(every ? UI_ICON.eye : UI_ICON.hidden)));
  };
  return b;
}

// drawing (drawing.js); ctx: { icon, units() }; facts(): the totals computed for this rendering;
// openDrawing(): the drawing's row clicked. Returns { box, render(), mark() (the selection marked,
// the last selected scrolled to), markDrawing(on), shown() (the rows, in order), step(dir) (↑ ↓:
// the next row selected; false if none), rename(id) }.
export function createTree(drawing, ctx, { facts, openDrawing }) {
  const { icon } = ctx;
  let anchor = null; // the row a Shift-click range starts from
  let filter = '';
  const folded = new Set(); // groups folded (this session)
  const filterInput = h('input', { type: 'search', placeholder: 'Filter by name or value', 'aria-label': 'Filter the list', oninput: (e) => { filter = e.target.value; render(); } });
  const selectShown = h('button', { type: 'button', class: 'small', title: 'Select every element the filter leaves in the list (Shift: add to the selection)',
    onclick: (e) => drawing.select(shown().map((x) => x.el.id), e.shiftKey ? 'add' : 'replace') }, 'Select all shown');
  // the list's head: the drawing's title, the eye for every element listed, its fold; above the list, past FILTER_FROM elements, the filter and
  // Select all shown
  const listed = () => (filter ? shown() : drawElements());
  const eyeAll = eyeFor(drawing, icon, listed, 'listed');
  const filterRow = h('div', { class: 'dfilter' }, filterInput, selectShown);
  // the hover ends when the pointer leaves the list: a row rebuilt under it never says it was left
  const list = h('ul', { class: 'dlist', 'aria-label': 'Elements', onpointerleave: () => drawing.setHover(null) });
  // The first row is the drawing (drawing-ui.md §4): its title, how much it holds, the eye for
  // everything listed. A click shows it in Properties (openDrawing).
  const rootName = h('button', { type: 'button', class: 'dname', title: 'The drawing: its title, its display, its totals', onclick: () => openDrawing() });
  const rootVal = h('span', { class: 'val' });
  const rootRow = h('div', { class: 'drow droot' }, h('span', { class: 'kind' }, icon(...UI_ICON.drawing)), rootName, rootVal, eyeAll);
  const listBox = h('div', { class: 'dlistbox' }, rootRow, filterRow, list);

  // the drawing's elements this view lists: all of them, measurements too
  const drawElements = () => elements(drawing.doc);
  // the elements in list order, as a tree: each group, then what is in it (its subgroups, then its
  // members), one level further in; at the top, the groups, then the rest. depth: how far in.
  function ordered() {
    const all = drawElements(), out = [], seen = new Set();
    const under = (gid, depth) => {
      for (const g of drawing.doc.groups.filter((x) => (x.groupId ?? null) === gid && !seen.has(x))) {
        seen.add(g);
        out.push({ kind: 'group', el: g, depth });
        if (!folded.has(g.id) || filter) under(g.id, depth + 1);
      }
      out.push(...all.filter((x) => x.kind !== 'group' && (x.el.groupId ?? null) === gid).map((x) => ({ ...x, depth })));
    };
    under(null, 0);
    return out;
  }
  function shown() {
    const f = filter.trim().toLowerCase();
    return ordered().filter((x) => !f || label(x.kind, x.el).toLowerCase().includes(f) || x.el.properties.some((p) => p.value.toLowerCase().includes(f)));
  }
  function value(kind, el) {
    const u = ctx.units();
    if (kind === 'point') {
      // its largest outline's size, its first filled round part's radius (its kind: its icon and name)
      const o = mainOutline(el)?.part, r = el.parts[followedPart(el)];
      const shape = o ? [`${fmtDist(o.length, u)} × ${fmtDist(o.width, u)}`] : [];
      return [...shape, r ? `${r.kind === 'sector' ? `${+r.aperture.toFixed(1)}° ` : ''}r ${fmtDist(r.radius, u)}` : ''].filter(Boolean).join(' · ');
    }
    if (kind === 'area') return [el.guide ? 'guide' : '', fmtArea(areaOf(pathOf(el.points, true)), u)].filter(Boolean).join(' · ');
    const offset = el.look?.offset ? '⇉' : ''; // Offset set here: found again in the list
    if (kind === 'line') return [el.guide ? 'guide' : '', fmtDist(lineTrace(drawing.doc, el).length, u), offset].filter(Boolean).join(' · ');
    if (kind === 'label') return labelText(drawing.doc, el, u).split('\n')[0];
    const t = facts().totals.groups.get(el.id), n = t ? t.points + t.lines + t.areas : 0;
    return [n ? plural(n, 'element') : 'empty', offset].filter(Boolean).join(' · ');
  }

  // one row of the list: a group's fold (or its room), its kind, its name, a short value, its eye (shown
  // or hidden); selected by a click (Ctrl/⌘: adds or removes), outlined on the map while the pointer is
  // over it
  function elementRow({ id, icon, kindIcon, title, name, value = '', valueTitle, visible, selected }, on, more = {}) {
    return h('li', { class: `drow${selected ? ' sel' : ''}${visible ? '' : ' dim'}${more.classes ? ` ${more.classes}` : ''}`, 'data-id': id, draggable: 'true',
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
    const fold = kind === 'group' ? h('button', { type: 'button', class: 'dfold', 'aria-expanded': String(!folded.has(id)), 'aria-label': `Show the members of ${label(kind, el)}`,
      onclick: () => { if (folded.has(id)) folded.delete(id); else folded.add(id); render(); } }) : null;
    const t = kind === 'group' && facts().totals.groups.get(id);
    return elementRow({ id, icon, kindIcon: iconOf(kind, el), title: kindTitle(kind, el), name: label(kind, el), value: value(kind, el), valueTitle: t ? countOf(t, ctx.units()) : undefined,
      visible: el.visible, selected: drawing.sel.has(id) }, {
      select: (e) => clickRow(id, e), hover: (x) => drawing.setHover(x),
      visible: (v) => drawing.change((doc) => { find(doc, id).el.visible = v; }),
    }, { fold, classes: [depth ? `d${Math.min(depth, 5)}` : '', kind === 'group' ? 'dgroup' : ''].filter(Boolean).join(' '),
      name: { title: `Select (Shift: range, ${MOD}: add or remove). Double-click to rename.`, ondblclick: () => rename(id) } });
  }

  function render() {
    const rows = shown();
    filterRow.hidden = drawElements().length <= FILTER_FROM && !filter; // nothing to show above the list: no room taken
    list.replaceChildren(...rows.map(rowOf));
    eyeAll.render();
    rootName.textContent = drawing.doc.meta.title || 'Untitled drawing';
    rootVal.textContent = plural(drawElements().filter((x) => x.kind !== 'group').length, 'element');
    rootVal.title = countOf(facts().totals.all, ctx.units());
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
      if (t.kind === 'group') setGroup(doc, id, t.el.id);
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
    const btn = row.querySelector('.dname');
    const input = h('input', { class: 'dname', value: x.el.name, 'aria-label': 'Name' });
    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      if (apply && input.value !== x.el.name) drawing.change((doc) => { find(doc, id).el.name = input.value; });
      else render();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
    btn.replaceWith(input);
    input.focus();
    input.select();
  }

  function mark() {
    for (const row of list.querySelectorAll('.drow[data-id]')) row.classList.toggle('sel', drawing.sel.has(row.dataset.id));
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
  return { box: listBox, render, mark, markDrawing: (on) => rootRow.classList.toggle('sel', on), shown, step, rename };
}
