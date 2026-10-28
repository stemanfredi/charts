// List grids (docs/drawing-ui.md §5): a small spreadsheet of like things (a line's vertices, an
// area's corners, a point's parts, its properties). Its columns of fixed widths, the first ones
// (frozen) kept in place while the rest scrolls sideways; a current row, marked, whose actions are a
// bar under the grid and keys (Insert, Ctrl/⌘ Delete); ↑, ↓ and Enter go to the same column in the
// row above or below. The panel builds its inspector again after each change: where the focus goes
// after a key, and which row is current, are kept by the grid's name and taken up again.

import { h } from '../dom.js';

const state = new Map(); // a grid's name → { current (row index, or null), focus ({ row, col }, or null) }
const stateOf = (name) => { if (!state.has(name)) state.set(name, { current: null, focus: null }); return state.get(name); };
const typing = (el) => el?.matches?.('input:not([type=checkbox]):not([type=color]):not([type=range]), textarea');

// The focus asked for in grid name (after a key moved it), on the grid as it is now in the page: only
// when it was lost (the grid built again) or is still where the key was pressed, never taken from
// where it went since
function takeFocus(name, from) {
  const st = stateOf(name), f = st.focus, now = document.activeElement;
  if (!f || (now && now !== document.body && now !== from)) { st.focus = null; return; }
  const tr = document.querySelector(`[data-grid="${CSS.escape(name)}"] tr[data-r="${f.row}"]`);
  const cell = tr?.children[f.col];
  const el = cell?.querySelector('input, select, textarea, button');
  st.focus = null;
  if (!el) return;
  el.focus();
  if (el.select && typing(el)) el.select();
}

// A list grid. name: what keeps its state (the element's id and the list's); columns: [{ head,
// width (px), frozen, title, cls }]; rows: [{ cells: [node], cls }]; add: the cells of the empty
// last row (typing in it adds one), or null; actions(i): { label, buttons } for row i, or null; keys: { insert(i),
// remove(i) }.
export function listGrid({ name, columns, rows, add = null, actions = () => null, keys = {} }) {
  const st = stateOf(name);
  if (st.current != null && st.current >= rows.length) st.current = null;
  // the frozen columns' offsets, from the left
  let left = 0;
  const lefts = columns.map((c) => { const at = left; if (c.frozen) left += c.width; return c.frozen ? at : null; });
  const cell = (tag, k, kids, attrs = {}) => {
    const c = columns[k], el = h(tag, { class: [c.cls, c.frozen ? 'frozen' : '', k === columns.filter((x) => x.frozen).length - 1 && c.frozen ? 'edge' : ''].filter(Boolean).join(' ') || null, ...attrs }, ...[kids].flat().filter((x) => x != null));
    if (c.frozen) el.style.left = `${lefts[k]}px`; // CSSOM: the page's CSP allows no style attribute
    return el;
  };
  const bar = h('div', { class: 'lbar' });
  const showBar = () => {
    const a = st.current != null ? actions(st.current) : null;
    bar.replaceChildren(...(a ? [h('span', { class: 'funit' }, `${a.label}:`), ...a.buttons] : []));
    bar.hidden = !a;
  };
  const body = h('tbody', {});
  const markCurrent = (i) => {
    if (st.current === i) return;
    st.current = i;
    for (const tr of body.querySelectorAll('tr[data-r]')) tr.classList.toggle('cur', +tr.dataset.r === i);
    showBar();
  };
  rows.forEach((r, i) => {
    const tr = h('tr', { 'data-r': i, class: [r.cls, st.current === i ? 'cur' : ''].filter(Boolean).join(' ') || null, onfocusin: () => markCurrent(i), onpointerdown: () => markCurrent(i) },
      ...r.cells.map((kids, k) => cell('td', k, kids)));
    body.append(tr);
  });
  if (add) body.append(h('tr', { 'data-r': rows.length, class: 'ladd' }, ...add.map((kids, k) => cell('td', k, kids))));
  const table = h('table', { class: 'lgrid', 'data-grid': name, 'data-rows': rows.length }, // its rows another number: a table of its own (morph)
    h('colgroup', {}, ...columns.map((c) => h('col', { width: c.width }))),
    h('thead', {}, h('tr', {}, ...columns.map((c, k) => cell('th', k, c.head ?? '', c.title ? { title: c.title } : {})))),
    body);
  table.style.width = `${columns.reduce((t, c) => t + c.width, 0)}px`;
  // keys: in a cell being typed in, ↑ ↓ (and Enter) to the row above or below, the same column; Insert
  // and Ctrl/⌘ Delete for the current row
  table.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-r]');
    if (!tr) return;
    const i = +tr.dataset.r, col = [...tr.children].indexOf(e.target.closest('td'));
    if (e.key === 'Insert' && keys.insert && i < rows.length) { e.preventDefault(); keys.insert(i); return; }
    if (e.key === 'Delete' && (e.ctrlKey || e.metaKey) && keys.remove && i < rows.length) { e.preventDefault(); keys.remove(i); return; }
    const down = e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey), up = e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey);
    if (!(down || up) || !typing(e.target)) return;
    const to = i + (down ? 1 : -1);
    if (to < 0 || to > rows.length - (add ? 0 : 1)) return;
    e.preventDefault();
    st.focus = { row: to, col };
    if (e.key !== 'Enter') e.target.dispatchEvent(new Event('change')); // applied (Enter: by the field itself)
    requestAnimationFrame(() => takeFocus(name, e.target)); // on the grid as built again, or this one
  });
  showBar();
  return h('div', { class: 'lgridbox' }, h('div', { class: 'lscroll' }, table), bar);
}
