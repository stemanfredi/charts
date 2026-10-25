// The Tools panel (docs/drawing-ui.md): the placing tools, the list of the
// drawing's elements, and under it the inspector, which shows what is selected (or, with nothing
// selected, the drawing itself) and edits it with fields. Fields apply on Enter or when they lose
// focus, one undo step each.

import { h, typing as typingIn } from '../dom.js';
import { FINGER } from './layers.js';
import { find, elements, groupsOf, membersOf, canHold, label, kindName, pointKind, POINT_KIND_NAME, lookOf, styleOf, lookField, setLook, LOOK_FIELDS, labelColour, addPart, removePart, makePart, followedPart, mainOutline, PART_KINDS, ROUND, SYMBOLS, DASHES, LEADERS, LABEL_OFFSET, makeGroup, setGroup, straighten, isMeasurement, MAX_RADIUS, offsetOf, MAX_OFFSET, MAX_MIN_SIZE, STROKE_WIDTH } from './document.js';
import { parse } from './file.js';
import { insertCorner, removeCorner, reattach, partName, addVertex, removeVertex, splitKeeping, lineRef, freeRef } from './attach.js';
import { labelText, labelValues, TOKENS } from './labels.js';
import { resolve as anchorAt } from './attach.js';
import { OUTLINES, OUTLINE_NAME, outlineOf, isVehicle } from './outlines.js';
import { lineTrace, totals, applySmooth, nearestAlong } from './lines.js';
import { profileCsv } from './profile.js';
import { COPY_RADIUS, distribute, lines, plan, planConnection, makeDistribution, editDistribution, connect, reconnect, unconnect, alongTrace, alongOf,
  distributions, connections, ruleOf, distributionOf, connectionOn, changedByHand, giveBack, MAX_COPIES, MAX_AUTO_TREE } from './generator.js';
import { BUILT_IN, builtInName } from './place.js';
import { boundsOf, drawable, perimeterOf } from './features.js';
import { fmtDist, fmtArea, fmtBrg, inverse, areaOf, pathOf, destination } from '../geodesy.js';
import { moved } from './drag.js';
import { norm360 } from '../geo.js';
import { fields, choice, select, check } from '../fields.js';
import { keyOf, mac, MOD } from '../keys.js';
import { loadPresets, savePresets, presetOf, presetsFile, readPresets } from './presets.js';
import { listGrid } from './grid.js';
import { rowsText, placesOf, placesAfterPaste } from './paste.js';

const FILTER_FROM = 30; // the filter field appears past this many elements
// what a total counts: "15 points, 10 with radii · 3 lines, 12.4 km · 2 areas"
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const countOf = (b, u) => [b.points ? `${plural(b.points, 'point')}${b.ringed && b.ringed < b.points ? `, ${b.ringed} with radii` : ''}` : '',
  b.lines ? `${plural(b.lines, 'line')}, ${fmtDist(b.length, u)}` : '', b.areas ? plural(b.areas, 'area') : '', b.hidden ? 'incl. hidden' : ''].filter(Boolean).join(' · ');
const KIND_ICON = {
  point: ['m12 4 8 8-8 8-8-8z'], shape: ['M4 8h16v8H4z'], polygon: ['M5 7l7-4 7 5-2 11H7z'], line: ['M4 18 20 6'], group: ['M3 7h7l2 2h9v10H3z'],
  label: ['M10 4h10v7H10z', 'M10 11 4 19'], // a text box and its leader
  area: ['M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4M4 7V4'], // a dashed box: Select area
};
// what each kind of point and shape looks like (the sub-rails, the list): those round a centre have it
// marked, the outlines not
const POINT_ICON = {
  point: KIND_ICON.point, symbol: KIND_ICON.point,
  circle: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M12 12h8', 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'], // its radius drawn from its centre
  rings: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'],
  sector: ['M5 19V5a14 14 0 0 1 14 14z'], // a quarter of a circle, its centre bottom left
  rectangle: ['M4 8h16v8H4z'], ellipse: ['M12 7c5 0 9 2.2 9 5s-4 5-9 5-9-2.2-9-5 4-5 9-5z'], triangle: ['M12 4l8 15H4z'], polygon: KIND_ICON.polygon,
  'aerial-vehicle': ['M12 3v18M4 12l8-3 8 3M9 19l3-1 3 1'], 'surface-vehicle': ['M12 3c3 2 4 5 4 8v9H8v-9c0-3 1-6 4-8z'], 'underwater-vehicle': ['M7 9h8a3 3 0 0 1 0 6H7l-3 2V7z'],
};
// an element's icon and what the panel calls its kind: a point by what it looks like (a circle, a
// rectangle…); an area a polygon
const iconOf = (kind, el) => (kind === 'point' ? POINT_ICON[pointKind(el)] : KIND_ICON[kind === 'area' ? 'polygon' : kind]);
const kindTitle = (kind, el) => (kind === 'point' ? (POINT_KIND_NAME[pointKind(el)] ?? OUTLINE_NAME[pointKind(el)]) : kindName(kind));
const PART_NAME = { circle: 'Circle', sector: 'Sector', ...OUTLINE_NAME };
// where a preset is placed from: Shape when it has extent (an outline, radii), else Point
const presetTool = (x) => (x.point.parts.length ? 'shape' : 'point');
const SYMBOL_ICON = { diamond: ['m12 4 8 8-8 8-8-8z'], square: ['M6 6h12v12H6z'], triangle: ['M12 4l9 15H3z'], dot: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'], none: [] };
const SYMBOL_TITLE = { diamond: 'Diamond', square: 'Square', triangle: 'Triangle', dot: 'Dot', none: 'None' };
const SPLIT_KEY = 'charts.drawing.split';
const WIDTH_NAME = { 'aerial-vehicle': 'Span', 'surface-vehicle': 'Beam', 'underwater-vehicle': 'Diameter' }; // a shape's width, as said of each outline

// root: the view's element. ctx: { drawing, map, icon, units() ('km' | 'nm'), known, isOpen() (the
// Tools panel shown), onImport(doc, report) (applies an imported document),
// download(text, name) }
export function drawView(root, ctx) {
  const { drawing, map, icon } = ctx;
  let anchor = null; // the row a Shift-click range starts from
  let filter = '';
  const folded = new Set(); // groups folded in the list (this session)
  const F = fields({ note, units: ctx.units }), { field } = F; // fields.js: each applies on Enter or when left
  let facts = null; // the totals: computed once per rendering of the list, read by the inspector
  let totalsBy = ''; // the drawing's totals by group (''), or by the values of a property (its key)
  const computeFacts = () => (facts = { totals: totals(drawing.doc, totalsBy || null) });
  const fx = () => facts || computeFacts();

  // ---- tools ------------------------------------------------------------------------------
  // The row (drawing-ui.md §2): Point, Line, Shape, Label, Measure, then Undo and Redo. A tool
  // with variants shows them in a sub-rail under the row; it remembers the one chosen last, and its
  // key pressed again moves to the next (app.js).
  drawing.presets = loadPresets();
  const TOOLS = { point: ['Point', 'Place points: click on the map'], line: ['Line', 'Draw a line: click its start, its bends, then a point, a corner, an edge or a vertex to end there (attached), or Enter'],
    shape: ['Shape', 'Place a shape of the outline chosen, or draw a polygon'], label: ['Label', 'Place a label: click a point, a shape, an area or a line to point at it, or anywhere for free text'],
    measure: ['Measure', 'Measure a distance, an area, or a radius: kept as a guide showing its values'],
    area: ['Select', 'Select area: drag a box on the map to select what lies inside it; Shift adds to the selection'] };
  // the kinds each tool makes (its sub-rail), each with a short tooltip. Shape: round a centre, the
  // outlines to scale, the polygon, the vehicles, the user's presets with extent
  const presetsOf = (tool) => drawing.presets.filter((x) => presetTool(x) === tool).map((x) => [`preset:${x.name}`, `${x.name}: a preset of yours (right-click: rename or delete)`]);
  const outline = (k) => [k, `${OUTLINE_NAME[k]}: an outline to scale`];
  const variants = (tool) => ({
    point: [['symbol', 'Symbol: the same size at every zoom'], ...presetsOf('point')],
    shape: [['circle', 'Circle: a distance round a centre'], ['rings', 'Rings: distances round a centre'], ['sector', 'Sector: part of a circle, in three clicks'],
      outline('rectangle'), outline('ellipse'), outline('triangle'), ['polygon', 'Polygon: corner by corner'], ...OUTLINES.filter(isVehicle).map(outline), ...presetsOf('shape')],
    measure: [['ruler', 'Distance: a line showing its lengths'], ['area', 'Area: a polygon showing its area and perimeter'], ['ring', 'Ring: a circle showing its radius']],
  })[tool] || [];
  const current = (tool) => drawing.variant[tool];
  // a tool's button pressed: on, or off when it is on; pressed with the keyboard (no pointer), a point,
  // a shape or a label placed at the map's centre, for its fields
  function press(tool, e = {}) {
    if (drawing.button === tool) return drawing.stop();
    if (tool === 'measure') return drawing.start(tool);
    const c = map.getCenter();
    if (e.detail === 0 && (tool === 'point' || tool === 'shape') && !['sector', 'polygon'].includes(current(tool))) return drawing.place([c.lng, c.lat], tool);
    if (e.detail === 0 && tool === 'label') return drawing.placeLabel(map.project(c), [c.lng, c.lat]);
    drawing.start(tool);
  }
  // a variant chosen in the sub-rail: the tool on with it
  function choose(tool, v) {
    drawing.setVariant(tool, v);
  }
  // the next variant of a tool (its key pressed again), or the tool on
  function cycle(tool) {
    const vs = variants(tool).map(([v]) => v), on = drawing.button === tool;
    if (!on || vs.length < 2) return press(tool);
    choose(tool, vs[(vs.indexOf(current(tool)) + 1) % vs.length]);
  }
  const toolBtns = Object.entries(TOOLS).map(([k, [text, title]]) => h('button', { type: 'button', 'data-tool': k, 'aria-pressed': 'false', title: `${title} (${keyOf(k)})`,
    onclick: (e) => press(k, e) }, icon(...(k === 'measure' ? ctx.measureIcon : KIND_ICON[k])),
  k === 'measure' ? [h('span', { class: 'long' }, text), h('span', { class: 'short' }, 'Meas.')] : text)); // the compact column's label: short
  const undoBtn = h('button', { type: 'button', class: 'urbtn', 'aria-label': 'Undo', title: `Undo (${MOD} Z)`, onclick: () => drawing.undo() }, icon('M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'));
  const redoBtn = h('button', { type: 'button', class: 'urbtn', 'aria-label': 'Redo', title: `Redo (${MOD} Shift Z)`, onclick: () => drawing.redo() }, icon('m15 14 5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'));
  // the panel compact (only the tools, drawing-ui.md §1) or whole
  const compactBtn = h('button', { type: 'button', class: 'urbtn cbtn', onclick: () => ctx.setCompact(!ctx.compact()) });
  // Where Undo, Redo and the compact button are: whole, in the panel's header (ctx.header), beside its
  // ×; compact (no header), in the tools' column, the compact button first (drawing-ui.md §1). The
  // tools: what makes, then (after a divider) Select area.
  const sep = () => h('span', { class: 'tsep', 'aria-hidden': 'true' });
  const toolsRow = h('div', { class: 'tools2' });
  function placeControls(c) {
    const makes = toolBtns.filter((b) => b.dataset.tool !== 'area'), select = toolBtns.find((b) => b.dataset.tool === 'area');
    if (c) { toolsRow.replaceChildren(compactBtn, sep(), ...makes, sep(), select, sep(), undoBtn, redoBtn); ctx.header?.replaceChildren(); }
    else { toolsRow.replaceChildren(...makes, sep(), select); ctx.header?.replaceChildren(undoBtn, redoBtn, sep(), compactBtn); }
  }
  placeControls(false);
  const subrail = h('div', { class: 'subrail', role: 'group', hidden: true });
  // With a finger (drawing-ui.md §1): what keys and a mouse do on a computer, each shown when it
  // applies. Back steps back one level (what is half drawn, else the tool, else the selection); Snap
  // off places as Alt does.
  const touchBtn = (text, title, run) => h('button', { type: 'button', title, onclick: run }, text);
  const touch = {
    done: touchBtn('Done', 'End the line or close the polygon being drawn (Enter, or a double-click)', () => drawing.finish()),
    back: touchBtn('Back', 'Back one step: what is half drawn, else the tool, else the selection (Esc)', () => (drawing.tool ? drawing.escape() : drawing.select([]))),
    del: touchBtn('Delete', 'Delete the selection (Delete)', () => del([...drawing.sel])),
    dup: touchBtn('Duplicate', `A copy of the selection beside it (${MOD} D)`, () => drawing.duplicate()),
    snap: h('button', { type: 'button', title: 'Snap to what is drawn; off: placed exactly where tapped (Alt)', onclick: () => { drawing.snapOff = !drawing.snapOff; renderTools(); } }, 'Snap'),
  };
  const touchbar = h('div', { class: 'touchbar', role: 'group', 'aria-label': 'Actions' }, Object.values(touch));
  function renderTouch() {
    const sel = drawing.sel.size > 0, tool = !!drawing.tool;
    touch.done.hidden = !(['line', 'polygon'].includes(drawing.tool) && drawing.draft);
    touch.back.hidden = !tool && !sel;
    touch.del.hidden = touch.dup.hidden = !sel || tool;
    touch.snap.hidden = !tool;
    touch.snap.setAttribute('aria-pressed', String(!drawing.snapOff));
    touchbar.hidden = Object.values(touch).every((b) => b.hidden);
  }
  function renderSubrail() {
    const tool = drawing.button;
    const vs = variants(tool);
    subrail.hidden = vs.length < 2;
    subrail.setAttribute('aria-label', `${TOOLS[tool]?.[0] ?? ''}: what it makes`);
    subrail.replaceChildren(...vs.map(([v, title]) => {
      const preset = v.startsWith('preset:'), name = preset ? v.slice(7) : '';
      return h('button', { type: 'button', 'aria-pressed': String(current(tool) === v), title, 'aria-label': preset ? name : title.split(':')[0].split(',')[0],
        onclick: () => choose(tool, v), oncontextmenu: preset ? (e) => { e.preventDefault(); presetMenu(name); } : null },
      preset ? h('span', { class: 'initials' }, name.slice(0, 2)) : icon(...(POINT_ICON[v] || ctx.measureIcons?.(v) || KIND_ICON.point)));
    }));
    // where the row scrolls sideways (phones): the kind in use in sight
    subrail.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  // a preset of the user's: renamed, or deleted
  async function presetMenu(name) {
    const a = await ask('Preset', `“${name}”`, [['delete', 'Delete'], ['rename', 'Rename…']]);
    if (a === 'delete') drawing.presets = drawing.presets.filter((x) => x.name !== name);
    if (a === 'rename') {
      const to = (await askText('Rename the preset', 'Name', name))?.trim();
      if (!to || drawing.presets.some((x) => x.name === to)) return;
      drawing.presets = drawing.presets.map((x) => (x.name === name ? { ...x, name: to } : x));
      for (const t of ['point', 'shape']) if (drawing.variant[t] === `preset:${name}`) drawing.variant[t] = `preset:${to}`;
    }
    if (a === 'delete') for (const [t, v] of [['point', 'symbol'], ['shape', 'circle']]) if (drawing.variant[t] === `preset:${name}`) drawing.variant[t] = v;
    savePresets(drawing.presets);
    renderTools();
  }

  // ---- list ---------------------------------------------------------------------------------
  const filterInput = h('input', { type: 'search', placeholder: 'Filter by name or value', 'aria-label': 'Filter the list', oninput: (e) => { filter = e.target.value; renderList(); } });
  const selectShown = h('button', { type: 'button', class: 'small', title: 'Select every element the filter leaves in the list (Shift: add to the selection)',
    onclick: (e) => drawing.select(shown().map((x) => x.el.id), e.shiftKey ? 'add' : 'replace') }, 'Select all shown');
  // the list's first row, All: one box over the rows' own (shown or not), every element a step to its
  // right; above the list, past FILTER_FROM elements, the filter and Select all shown
  const showAll = (v, xs) => drawing.change((doc) => { for (const x of xs) find(doc, x.el.id).el.visible = v; });
  // A box for all of xs() shown: ticked when every one is, empty when none is, half when some are; a
  // click shows them all, or hides them all when every one is shown
  const allBox = (xs, aria) => {
    const box = h('input', { type: 'checkbox', 'aria-label': aria, onchange: () => { const all = xs(); showAll(!all.every((x) => x.el.visible), all); } });
    box.render = () => { const all = xs(), on = all.filter((x) => x.el.visible).length; box.checked = !!all.length && on === all.length; box.indeterminate = on > 0 && on < all.length; };
    queueMicrotask(box.render); // once what it counts can be read (the list's, while the panel is still being built)
    return h('label', { class: 'dvis', title: 'Show all, or hide all when every one is shown' }, box);
  };
  const listAll = allBox(() => (filter ? shown() : drawElements()), 'Show all listed');
  const allRow = h('li', { class: 'drow dall' }, listAll, h('span', { class: 'dname' }, 'All'));
  const filterRow = h('div', { class: 'dfilter' }, filterInput, selectShown);
  // the hover ends when the pointer leaves the list: a row rebuilt under it never says it was left
  const list = h('ul', { class: 'dlist', 'aria-label': 'Elements', onpointerleave: () => drawing.setHover(null) });
  const listBox = h('div', { class: 'dlistbox' }, filterRow, list);

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
  // a group's name with the groups it is in: "A › B"
  const groupPath = (g) => [...groupsOf(drawing.doc, g).reverse(), g].map((x) => label('group', x)).join(' › ');
  function shown() {
    const f = filter.trim().toLowerCase();
    return ordered().filter((x) => !f || label(x.kind, x.el).toLowerCase().includes(f) || x.el.properties.some((p) => p.value.toLowerCase().includes(f)));
  }
  function value(kind, el) {
    const u = ctx.units();
    if (kind === 'point') {
      // its largest outline's size, its first filled round part's radius (its kind: its icon and name)
      const o = mainOutline(el)?.part, r = el.parts[followedPart(el)];
      const shape = o ? [`${fmtDist(o.length, u)} × ${fmtDist(o.width, u)}`, enlarged(el)] : [];
      return [...shape, r ? `${r.kind === 'sector' ? `${+r.aperture.toFixed(1)}° ` : ''}r ${fmtDist(r.radius, u)}` : ''].filter(Boolean).join(' · ');
    }
    if (kind === 'area') return [el.guide ? 'guide' : '', fmtArea(areaOf(pathOf(el.points, true)), u)].filter(Boolean).join(' · ');
    const offset = el.look?.offset ? '⇉' : ''; // Offset set here: found again in the list
    if (kind === 'line') return [el.guide ? 'guide' : '', fmtDist(lineTrace(drawing.doc, el).length, u), offset].filter(Boolean).join(' · ');
    if (kind === 'label') return labelText(drawing.doc, el, u).split('\n')[0];
    const t = facts.totals.groups.get(el.id);
    return [t ? countOf(t, u) : 'empty', offset].filter(Boolean).join(' · ');
  }
  // an outline drawn larger than its real size at this zoom says so
  function enlarged(point) {
    const k = drawing.enlargement(point);
    return k > 1 ? `shown ×${k < 10 ? k.toFixed(1) : Math.round(k)}` : '';
  }

  // one row of the list: shown or not, its kind, its name, a short value, delete; selected by a click
  // (Ctrl/⌘: adds or removes), outlined on the map while the pointer is over it
  function elementRow({ id, icon, kindIcon, title, name, value = '', visible, selected }, on, more = {}) {
    return h('li', { class: `drow${selected ? ' sel' : ''}${visible ? '' : ' dim'}${more.classes ? ` ${more.classes}` : ''}`, 'data-id': id,
      onpointerenter: () => on.hover(id), onpointerleave: () => on.hover(null) },
    h('label', { class: 'dvis', title: 'Show on the map' }, h('input', { type: 'checkbox', checked: visible, 'aria-label': `Show ${name}`, onchange: (e) => on.visible(e.target.checked) })),
    more.fold || null,
    h('span', { class: 'kind', title }, icon(...kindIcon)),
    h('button', { type: 'button', class: 'dname', title: `Select (${MOD}: add or remove)`, onclick: (e) => on.select(e), ...more.name }, name),
    h('span', { class: 'val' }, value),
    h('button', { type: 'button', class: 'x', 'aria-label': `Delete ${name}`, title: 'Delete', onclick: () => on.remove() }, '×'));
  }
  function rowOf({ kind, el, depth = 0 }) {
    const id = el.id;
    const fold = kind === 'group' ? h('button', { type: 'button', class: 'dfold', 'aria-expanded': String(!folded.has(id)), 'aria-label': `Show the members of ${label(kind, el)}`,
      onclick: () => { if (folded.has(id)) folded.delete(id); else folded.add(id); renderList(); } }) : null;
    return elementRow({ id, icon, kindIcon: iconOf(kind, el), title: kindTitle(kind, el), name: label(kind, el), value: value(kind, el), visible: el.visible, selected: drawing.sel.has(id) }, {
      select: (e) => clickRow(id, e), hover: (x) => drawing.setHover(x), remove: () => del([id]),
      visible: (v) => drawing.change((doc) => { find(doc, id).el.visible = v; }),
    }, { fold, classes: [`member d${Math.min(depth + 1, 5)}`, kind === 'group' ? 'dgroup' : ''].filter(Boolean).join(' '), // under All: a step to its right
      name: { title: `Select (Shift: range, ${MOD}: add or remove). Double-click to rename.`, ondblclick: () => rename(id) } });
  }

  function renderList() {
    computeFacts();
    const rows = shown();
    filterRow.hidden = drawElements().length <= FILTER_FROM && !filter; // nothing to show above the list: no room taken
    list.replaceChildren(...(rows.length ? [allRow] : []), ...rows.map(rowOf));
    listAll.firstChild.render();
    if (!rows.length) list.append(h('li', { class: 'empty' }, filter ? 'Nothing matches the filter.' : 'Nothing drawn yet: pick a tool above, then click on the map.'));
  }
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
      else renderList();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
    btn.replaceWith(input);
    input.focus();
    input.select();
  }

  // ---- deleting -----------------------------------------------------------------------------
  async function del(ids) {
    const doc = drawing.doc;
    const groups = ids.filter((id) => find(doc, id)?.kind === 'group');
    let withMembers = false;
    const members = elements(doc).filter((x) => groupsOf(doc, x.el).some((g) => groups.includes(g.id))).length;
    if (members) {
      const a = await ask('Delete group', `The group${groups.length > 1 ? 's have' : ' has'} ${members} member${members > 1 ? 's' : ''}.`,
        [['ungroup', 'Delete the group only (members kept)'], ['all', 'Delete the group and everything in it']]);
      if (!a) return;
      withMembers = a === 'all';
    }
    const what = ids.length === 1 ? label(find(doc, ids[0]).kind, find(doc, ids[0]).el) : `${ids.length} elements`;
    // lines attached to a point deleted stay, their ends free where they were
    const gone = drawing.dependents(ids, withMembers);
    const freed = doc.lines.filter((s) => !gone.has(s.id) && [s.start, s.end].some((e) => e.element && gone.has(e.element))).length;
    drawing.remove(ids, withMembers);
    note(`Deleted ${what}${freed ? `; ${plural(freed, 'line')} attached to it now end${freed === 1 ? 's' : ''} where ${freed === 1 ? 'it' : 'they'} did` : ''}`, true);
  }

  // a question in a dialog: resolves to the chosen button's value, or null (Cancel, Esc)
  const askDialog = h('dialog', { class: 'dreport', 'aria-labelledby': 'dask-title' });
  document.body.append(askDialog);
  function ask(title, text, buttons) {
    return new Promise((resolve) => {
      let answer = null;
      askDialog.replaceChildren(h('h2', { id: 'dask-title' }, title), h('p', {}, text),
        h('div', { class: 'fbuttons' }, buttons.map(([v, t], i) => h('button', { type: 'button', class: i === buttons.length - 1 ? 'done' : '', onclick: () => { answer = v; askDialog.close(); } }, t)),
          h('button', { type: 'button', onclick: () => askDialog.close() }, 'Cancel')));
      askDialog.addEventListener('close', () => resolve(answer), { once: true });
      askDialog.showModal();
    });
  }

  // a text asked for in a dialog: resolves to it, or null (Cancel, Esc)
  function askText(title, what, value = '') {
    return new Promise((resolve) => {
      let answer = null;
      const input = h('input', { type: 'text', value, 'aria-label': what, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); answer = input.value; askDialog.close(); } } });
      askDialog.replaceChildren(h('h2', { id: 'dask-title' }, title), h('p', {}, h('label', {}, `${what} `, input)),
        h('div', { class: 'fbuttons' }, h('button', { type: 'button', class: 'done', onclick: () => { answer = input.value; askDialog.close(); } }, 'OK'),
          h('button', { type: 'button', onclick: () => askDialog.close() }, 'Cancel')));
      askDialog.addEventListener('close', () => resolve(answer), { once: true });
      askDialog.showModal();
      input.select();
    });
  }

  // ---- the note: what just happened, for a few seconds -----------------------------------------
  const noteEl = h('div', { class: 'dnote', role: 'status', hidden: true });
  let noteTimer = 0;
  function note(text, undo = false) {
    clearTimeout(noteTimer);
    noteEl.replaceChildren(...[h('span', {}, text), undo ? h('button', { type: 'button', onclick: () => { drawing.undo(); noteEl.hidden = true; } }, 'Undo') : null].filter(Boolean));
    noteEl.hidden = false;
    noteTimer = setTimeout(() => { noteEl.hidden = true; }, 5000);
  }

  // ---- inspector: fields ----------------------------------------------------------------------
  const inspector = h('div', { class: 'dinspect' });
  // the element id as it is now (a field's closure keeps the id, never a stale object)
  const now = (id) => find(drawing.doc, id)?.el;
  const set = (id, fn) => drawing.change((doc) => fn(find(doc, id).el));
  // A value grid's row (docs/drawing-ui.md §5): its label, its cell (one value or a pair, at most
  // one small button after it: never wrapping) and its last column, kept for a trailing × or ↺ so
  // nothing shifts when one appears. Without a label and with buttons only: an action row, which may
  // wrap.
  const isX = (k) => k?.tagName === 'BUTTON' && k.classList.contains('x');
  const row = (text, ...kids) => {
    kids = kids.flat().filter(Boolean);
    const last = isX(kids.at(-1)) ? kids.pop() : null;
    if (!text && kids.length && kids.every((k) => k.tagName === 'BUTTON')) return h('div', { class: 'frow' }, ...kids, last);
    return h('div', { class: 'frow vrow' }, h('span', { class: 'flabel' }, text), h('div', { class: 'vcell' }, ...kids), h('span', { class: 'vlast' }, last));
  };
  // two fields read as one value, side by side (a pair, §2), sep between them
  const pair = (a, sep, b) => h('span', { class: 'vpair' }, ...[a].flat(), h('span', { class: 'vsep' }, sep), ...[b].flat());
  const textField = (id, key, aria, area = false) => F.text(() => now(id)[key], (v) => set(id, (el) => { el[key] = v; }), aria, area ? 2 : 0);
  const coordFields = (id, key) => { const [, lat, , lon] = F.position(() => now(id)[key], (p) => set(id, (el) => { el[key] = p; })); return row('Position', pair(lat, '·', lon)); };
  const distField = (get, apply, aria, check) => F.dist(get, apply, aria, { check });
  const angleField = (get, apply, aria, lo, hi, wrap) => F.angle(get, apply, aria, { lo, hi, wrap });
  const segOf = (aria, options, current, pick) => choice(aria, options, () => current, pick);

  // The look of xs ({ kind, el }, one or several; the drawing: { kind: 'drawing', el: doc }): each
  // field what they are drawn with (document.js lookOf: their own value, else their groups', else
  // the drawing's), "mixed" where they differ; a change sets their own value, ↺ takes it back. Only
  // the fields their kinds have (a line no fill, a label its text, a shape its minimum size); fields:
  // those to show, else all of those.
  function lookBlock(xs, fields = null, title = 'Look', extra = []) {
    const doc = drawing.doc;
    const has = (x, f) => (x.kind === 'drawing' || LOOK_FIELDS[x.kind].includes(f)) && (f !== 'minSize' || x.kind !== 'point' || !!mainOutline(x.el));
    const shown = (f) => (!fields || fields.includes(f)) && xs.some((x) => has(x, f));
    const looks = xs.map((x) => (x.kind === 'label' ? { ...lookOf(doc, x.el), text: { ...lookOf(doc, x.el).text, color: labelColour(doc, x.el) } } : lookOf(doc, x.el)));
    const same = (f) => { const vs = xs.map((x, i) => (has(x, f) ? lookField(looks[i], f) : undefined)).filter((v) => v !== undefined); return vs.every((v) => v === vs[0]) ? vs[0] : null; };
    const target = (d, x) => (x.kind === 'drawing' ? d : find(d, x.el.id).el);
    // live: shown as it changes (a colour being picked), the undo step made when it is set
    const put = (f, v, live = false) => (live ? drawing.preview : drawing.change).call(drawing, (d) => { for (const x of xs) if (has(x, f)) setLook(target(d, x), f, v); });
    const above = xs.some((x) => x.el.groupId) ? 'the group\'s' : xs.some((x) => x.kind === 'drawing') ? 'the default' : 'the drawing\'s';
    const back = (...fs) => (xs.some((x) => fs.some((f) => has(x, f) && lookField(x.el.look, f) !== undefined))
      ? h('button', { type: 'button', class: 'x', title: `Back to ${above}`, 'aria-label': `${fs[0]} back to ${above}`,
        onclick: () => drawing.change((d) => { for (const x of xs) for (const f of fs) if (has(x, f)) setLook(target(d, x), f, undefined); }) }, '↺') : null);
    const mixed = (v) => (v === null ? h('span', { class: 'mixed' }, 'mixed') : null);
    const colour = (f, aria) => {
      const v = same(f);
      return [h('input', { type: 'color', value: v ?? lookField(looks[0], f) ?? '#000000', 'aria-label': aria, oninput: (e) => put(f, e.target.value, true), onchange: (e) => put(f, e.target.value) }), mixed(v)];
    };
    const num = (f, aria, lo, hi) => F.number(() => same(f), (v) => put(f, v), aria, { min: lo, max: hi, placeholder: 'mixed', bad: `a number from ${lo} to ${hi}` });
    const tick = (f, text, title) => row(text, check('', same(f), (v) => put(f, v), { 'aria-label': text, title }), back(f));
    const dashSelect = () => select('Dash', DASHES.map((d) => [d, d]), dash, (v) => put('stroke.dash', v));
    // Fill and Stroke: a small matrix when both are there (the same columns, two rows); a line's stroke
    // alone: two rows of pairs (§2: no one-row matrix)
    const both = shown('fill.color') && shown('stroke.color');
    const matrix = () => h('table', { class: 'lmatrix' },
      h('thead', {}, h('tr', {}, h('th'), h('th', {}, 'Colour'), h('th', {}, 'Opacity'), h('th', {}, 'Width'), h('th', {}, 'Dash'), h('th'))),
      h('tbody', {},
        h('tr', {}, h('th', {}, 'Fill'), h('td', {}, ...colour('fill.color', 'Fill colour')), h('td', {}, num('fill.opacity', 'Fill opacity', 0, 1)), h('td'), h('td'), h('td', {}, back('fill.color', 'fill.opacity'))),
        h('tr', {}, h('th', {}, 'Stroke'), h('td', {}, ...colour('stroke.color', 'Stroke colour')), h('td', {}, num('stroke.opacity', 'Stroke opacity', 0, 1)),
          h('td', {}, num('stroke.width', 'Stroke width (px)', ...STROKE_WIDTH)), h('td', {}, dashSelect()), h('td', {}, back('stroke.color', 'stroke.opacity', 'stroke.width', 'stroke.dash')))));
    const group = xs.length === 1 && (xs[0].kind === 'group' || xs[0].kind === 'drawing');
    const dash = same('stroke.dash');
    return h('div', { class: 'fblock' }, h('h3', {}, title),
      both ? matrix() : null,
      !both && shown('stroke.color') ? row('Stroke', pair(colour('stroke.color', 'Stroke colour'), '·', num('stroke.opacity', 'Stroke opacity', 0, 1)), back('stroke.color', 'stroke.opacity')) : null,
      !both && shown('stroke.width') ? row('Width', pair([num('stroke.width', 'Stroke width (px)', ...STROKE_WIDTH), h('span', { class: 'funit' }, 'px')], '·', dashSelect()), back('stroke.width', 'stroke.dash')) : null,
      shown('text.size') ? row('Text size', segOf('Text size', [['small', 'S', 'Small'], ['medium', 'M', 'Medium'], ['large', 'L', 'Large']], same('text.size'), (v) => put('text.size', v)), back('text.size')) : null,
      shown('text.color') ? row('Text colour', pair(colour('text.color', 'Text colour'), 'on',
        segOf('Background', [['halo', 'Halo', 'A white halo round the letters'], ['box', 'Box', 'A white box with a border in the text\'s colour']], same('text.background'), (v) => put('text.background', v))),
      back('text.color', 'text.background')) : null,
      shown('text.name') ? tick('text.name', group || xs.length > 1 ? 'Names on map' : 'Name on map', 'Names are left out where they would collide; zooming in shows them') : null,
      shown('text.values') ? tick('text.values', 'Show values', 'Values on the map: each leg\'s length, an area\'s area and perimeter, each radius') : null,
      shown('offset') ? row('Offset', F.number(() => same('offset'), (v) => put('offset', v), 'Offset (px)', { min: -MAX_OFFSET, max: MAX_OFFSET, placeholder: 'mixed', bad: `pixels from −${MAX_OFFSET} to ${MAX_OFFSET}`,
        title: 'Drawn this many pixels beside its line, to the right of its direction (negative: left), as QGIS offsets a line: display only, lengths stay real' }), h('span', { class: 'funit' }, 'px'), back('offset')) : null,
      shown('minSize') ? row('Min. size', F.number(() => same('minSize'), (v) => put('minSize', v), 'Minimum size (px)', { max: MAX_MIN_SIZE, placeholder: 'mixed', bad: `pixels from 0 to ${MAX_MIN_SIZE}`,
        title: 'Shapes shorter than this on screen are drawn enlarged, their outline dotted (0: always real size; a vehicle: twice the drawing\'s)' }), h('span', { class: 'funit' }, 'px'), back('minSize')) : null,
      ...extra);
  }
  // the group an element (or a group) is in: none, or one of the drawing's that can hold them all;
  // New group…: a group of them, in the group they are in (a subgroup)
  function groupRow(ids) {
    const doc = drawing.doc;
    const gs = ids.map((id) => find(doc, id)?.el.groupId ?? null), same = gs.every((g) => g === gs[0]) ? gs[0] : undefined;
    const fits = doc.groups.filter((g) => ids.every((id) => canHold(doc, g.id, id)));
    return row('Group', select('Group', [['', 'none'], ...fits.map((g) => [g.id, groupPath(g)]), ['+', 'New group…']], same === undefined ? null : same ?? '', (v) => {
      const gid = v || null;
      if (gid === '+') { let g; drawing.change((d) => { g = makeGroup(d, ids); }); drawing.select([g.id]); return; }
      drawing.change((d) => { for (const id of ids) setGroup(d, id, gid); });
    }));
  }

  // its data, near the foot: its properties, keys and values of the user's own (a description, a
  // category: properties like any other)
  // Data, folded while it has nothing of the user's: the preset a point was placed from is said under
  // its heading (it is a property all the same, in the list once open)
  const dataOpen = new Set(); // the elements whose Data was opened by hand
  function dataBlock(id) {
    const el = now(id);
    const put = (fn) => set(id, (x) => fn(x.properties));
    const removeAt = (i) => put((ps) => ps.splice(i, 1));
    const preset = el.properties.find((p) => p.key === 'preset');
    const open = el.properties.some((p) => p.key !== 'preset') || dataOpen.has(id);
    const toggle = h('button', { type: 'button', class: 'hfold', 'aria-expanded': String(open), 'aria-label': open ? 'Fold Data' : 'Open Data',
      onclick: () => { if (open) dataOpen.delete(id); else dataOpen.add(id); renderInspector(); } }, 'Data');
    // the empty last row: a key typed there adds a property
    const addKey = field(() => '', (t) => (t.trim() ? t : undefined), (v) => { dataOpen.add(id); put((ps) => ps.push({ key: v, value: '' })); }, { 'aria-label': 'Add a key', placeholder: 'add a key…', bad: 'a key cannot be empty' });
    return h('div', { class: 'fblock' },
      h('h3', {}, toggle, h('span', { class: 'hbtns' },
        FINGER ? h('button', { type: 'button', class: 'small', title: 'A property: a key and a value', onclick: () => { dataOpen.add(id); put((p) => p.push({ key: 'key', value: '' })); } }, '+') : null,
        open && el.properties.length ? copyBtn(() => [['Key', 'Value'], now(id).properties.map((p) => [p.key, p.value])]) : null)),
      !open && preset ? h('p', { class: 'note' }, `from preset ${preset.value}`) : null,
      open ? listGrid({ name: `${id}:data`,
        columns: [{ head: 'Key', width: 120 }, { head: 'Value', width: 180 }],
        rows: el.properties.map((p, i) => ({ cells: [
          field(() => p.key, (t) => (t.trim() ? t : undefined), (v) => put((ps) => { ps[i].key = v; }), { 'aria-label': 'Key', bad: 'a key cannot be empty' }),
          field(() => p.value, (t) => t, (v) => put((ps) => { ps[i].value = v; }), { 'aria-label': 'Value' })] })),
        add: [addKey, null],
        actions: (i) => ({ label: el.properties[i].key, buttons: [act('Delete', 'Take this property away (Ctrl/⌘ Delete)', () => removeAt(i))] }),
        keys: { remove: removeAt } }) : null);
  }
  // every inspector's top: the header (kind · name, Zoom to), its name, the group it is in
  const commonTop = (kind, id) => {
    const el = now(id);
    return [
      h('div', { class: 'fhead' }, h('h2', {}, kindTitle(kind, el), ' · ', label(kind, el)),
        h('button', { type: 'button', class: 'small', title: 'Fit the map to it', onclick: () => showOnMap(new Set([id])) }, 'Zoom to')),
      ...(ruleRow(id) ?? []), row('Name', textField(id, 'name', 'Name')), groupRow([id]),
    ];
  };
  // and its foot: its data, Guide, Visible and Delete
  const commonBottom = (kind, id) => {
    const el = now(id);
    // Guide (supporting geometry: faint, out of the totals): a measurement is a guide showing its
    // values; unticking Guide makes it part of the drawing
    const flags = ['point', 'line', 'area'].includes(kind) ? [check('Guide', el.guide, (v) => set(id, (x) => { x.guide = v; }), { title: 'Supporting geometry: drawn faint and dashed, left out of the totals' })] : [];
    return [dataBlock(id), h('div', { class: 'frow fend' }, ...flags,
      check('Visible', el.visible, (v) => set(id, (x) => { x.visible = v; })),
      h('button', { type: 'button', class: 'danger', onclick: () => del([id]) }, `Delete ${kindTitle(kind, el).toLowerCase()}`))];
  };

  // A point's parts, each named by its place in the list: its kind (changing it keeps its reach), its
  // name, Fill, Shown, its own stroke, ×; its size (a radius, a sector's aperture; an outline's length
  // and width, its area). "+ Part" adds one.
  function partsBlock(id) {
    const el = now(id), u = ctx.units();
    const fits = (m) => drawable(now(id), m);
    const at = (i, fn) => drawing.change((d) => { fn(find(d, id).el.parts[i]); reattach(d, id); }); // part i as it is now; what points at its corners stays where it was
    const pointStroke = styleOf(drawing.doc, el).stroke.color;
    // a part as another kind, its reach kept: a round one's radius, an outline's half length
    const asKind = (part, kind) => {
      const reach = part.radius ?? part.length / 2;
      const next = makePart(kind, ROUND.includes(kind) ? { radius: reach, aperture: part.aperture } : { length: 2 * reach, width: part.width ?? reach });
      return { ...next, fill: part.fill, shown: part.shown, name: part.name, strokeColor: part.strokeColor, strokeDash: part.strokeDash };
    };
    const adder = (aria, text) => select(aria, [['', text], ...PART_KINDS.map((k) => [k, PART_NAME[k]])], '', (k) => { if (k) set(id, (x) => addPart(x, k)); }, { title: 'A circle, a sector or an outline about the point, to scale' });
    const strokeOf = (part, i) => {
      const own = part.strokeColor || part.strokeDash;
      const swatch = h('span', { class: 'swatch' });
      swatch.style.background = part.strokeColor || pointStroke; // CSSOM: the page's CSP allows no style attribute
      const summary = h('summary', { title: own ? 'This part has its own stroke' : 'Stroke: as the point (click to give this part its own)', class: own ? 'own' : '', 'aria-label': `Part ${i + 1} stroke` }, swatch);
      // its pop-up placed by the window, out of the grid that scrolls sideways (which would cut it)
      const place = (e) => { if (!e.target.open) return; const r = summary.getBoundingClientRect(), pop = e.target.querySelector('.pop'); pop.style.left = `${Math.max(8, r.right - 200)}px`; pop.style.top = `${r.bottom + 4}px`; };
      return h('details', { class: 'rstroke', ontoggle: place },
        summary,
        h('div', { class: 'pop' },
          h('label', {}, 'Colour ', h('input', { type: 'color', value: part.strokeColor || pointStroke,
            oninput: (e) => drawing.preview((d) => { find(d, id).el.parts[i].strokeColor = e.target.value; }), // seen as it is picked
            onchange: (e) => at(i, (y) => { y.strokeColor = e.target.value; }) })),
          h('label', {}, 'Dash ', select(`Part ${i + 1} dash`, [['', 'as the point'], ...DASHES.map((d) => [d, d])], part.strokeDash ?? '', (v) => at(i, (y) => { y.strokeDash = v || null; }))),
          h('button', { type: 'button', class: 'small', onclick: () => at(i, (y) => { y.strokeColor = null; y.strokeDash = null; }) }, 'Use the point\'s')));
    };
    const box = (i, key, aria) => check('', el.parts[i][key], (v) => at(i, (y) => { y[key] = v; }), { 'aria-label': `Part ${i + 1} ${aria}` });
    const dist = (i, key, aria) => distField(() => now(id).parts[i][key], (m) => at(i, (y) => { y[key] = m; }), aria, (m) => (m >= MAX_RADIUS || (key === 'radius' && !fits(m)) ? 'too large' : null));
    // its size, a pair: a round part's radius (a sector's aperture beside it), an outline's length × width
    const size = (part, i) => (part.radius
      ? (part.kind === 'sector' ? pair(dist(i, 'radius', `Part ${i + 1} radius`), '·', angleField(() => now(id).parts[i].aperture, (v) => at(i, (y) => { y.aperture = v; }), `Part ${i + 1} aperture (degrees): centred on the bearing`, 0, 360, false)) : dist(i, 'radius', `Part ${i + 1} radius`))
      : Object.assign(pair(dist(i, 'length', `Part ${i + 1} length`), '×', dist(i, 'width', `Part ${i + 1} ${WIDTH_NAME[part.kind] || 'width'}`)),
        { title: `Its area: ${fmtArea(areaOf(outlineOf(el.position, el.bearing, part.length, part.width, part.kind).ring), u)}` }));
    const kind = (part, i) => select(`Part ${i + 1} kind`, PART_KINDS.map((k) => [k, PART_NAME[k]]), part.kind, (v) => drawing.change((d) => { const x = find(d, id).el; x.parts[i] = asKind(x.parts[i], v); reattach(d, id); }));
    const removeAt = (i) => drawing.change((d) => { removePart(find(d, id).el, i); reattach(d, id); });
    const table = listGrid({ name: `${id}:parts`,
      columns: [{ head: '', width: 22, frozen: true, cls: 'num' }, { head: 'Kind', width: 108, frozen: true }, { head: 'Size', width: 176, title: 'A radius (a sector: and its aperture), or a length × a width' },
        { head: 'Fill', width: 52 }, { head: 'Shown', width: 52 }, { head: '', width: 52, title: 'Its own stroke' }, { head: 'Name', width: 110 }],
      rows: el.parts.map((part, i) => ({ cells: [`${i + 1}`, kind(part, i), size(part, i), box(i, 'fill', 'filled'), box(i, 'shown', 'shown'), strokeOf(part, i),
        field(() => part.name, (t) => t, (v) => at(i, (y) => { y.name = v; }), { 'aria-label': `Part ${i + 1} name`, placeholder: 'name' })],
      cls: part.radius && !fits(part.radius) ? 'warn' : null })),
      add: [null, adder('Add a part', 'add a part…'), null, null, null, null, null],
      actions: (i) => ({ label: `Part ${i + 1}`, buttons: [act('Distribute along it…', 'Copies placed round this part; they follow it', () => openArray({ element: id, part: i })), act('Delete', 'Take this part away (Ctrl/⌘ Delete)', () => removeAt(i))] }),
      keys: { remove: removeAt } });
    const far = el.parts.find((part) => part.radius && !fits(part.radius));
    return h('div', { class: 'fblock' },
      h('h3', {}, `Parts (${el.parts.length})`, h('span', { class: 'hbtns' }, FINGER ? adder('Add a part (heading)', '+') : null, copyBtn(() => [['#', 'Kind', 'Radius m', 'Aperture °', 'Length m', 'Width m', 'Fill', 'Shown', 'Name'],
        now(id).parts.map((q, i) => [i + 1, q.kind, q.radius ?? '', q.aperture ?? '', q.length ?? '', q.width ?? '', q.fill ? 'yes' : 'no', q.shown ? 'yes' : 'no', q.name])]))),
      table,
      far ? h('p', { class: 'note warn' }, `Not drawn: a circle of ${fmtDist(far.radius, u)} there reaches a pole.`) : null,
      mainOutline(el) ? h('span', { class: 'fenlarged', 'data-id': id }, enlarged(el)) : null);
  }

  const kindOf = (id) => find(drawing.doc, id)?.kind;
  const item = (id) => find(drawing.doc, id);
  // a button selecting another element (a point, a line, a group)
  const link = (id, text) => h('button', { type: 'button', class: 'small link', onclick: () => drawing.select([id]) }, text ?? label(kindOf(id), now(id)));

  // a point: its position and bearing, its symbol, its parts, Distribute along…, its look, Save as preset…
  function pointInspector(id) {
    const el = now(id);
    const parts = [...commonTop('point', id), coordFields(id, 'position'),
      row('Bearing', angleField(() => now(id).bearing, (v) => set(id, (x) => { x.bearing = v; }), 'Bearing (degrees true): where its outlines face, and its sectors'), h('span', { class: 'funit' }, '°T')),
      row('Symbol', segOf('Symbol (the same size on screen at every zoom)', SYMBOLS.map((sy) => [sy, sy === 'none' ? '∅' : icon(...SYMBOL_ICON[sy]), SYMBOL_TITLE[sy]]), el.symbol, (sy) => set(id, (x) => { x.symbol = sy; }))),
      partsBlock(id),
      el.parts.length ? row('', h('button', { type: 'button', class: 'small', title: 'Copies placed round one of its parts: a circle\'s whole round, a sector\'s arc, an outline; they follow it, and can be connected to roots',
        onclick: () => openArray({ element: id, part: null }) }, 'Distribute along…')) : null,
      changedByHand(drawing.doc, id) ? row('Parts', h('span', { class: 'fvalue' }, 'changed by hand, not its rule\'s'),
        h('button', { type: 'button', class: 'x reset', title: 'Back to the rule\'s', 'aria-label': 'Parts back to the rule\'s', onclick: () => drawing.change((d) => giveBack(d, id)) }, '↺')) : null];
    parts.push(lookBlock([item(id)]),
      row('', h('button', { type: 'button', class: 'small', title: 'Keep what is drawn about it (symbol, parts, look) as a preset of yours, in the Shape tool (the Point tool for a symbol only): in this browser only',
        onclick: async () => {
          const name = (await askText('Save as preset', 'Name', el.name || 'Preset'))?.trim();
          if (!name) return;
          const p = presetOf(drawing.doc, now(id), name);
          drawing.presets = [...drawing.presets.filter((x) => x.name !== name), p];
          savePresets(drawing.presets);
          const tool = presetTool(p);
          drawing.variant[tool] = `preset:${name}`;
          renderTools();
          note(`Preset “${name}” in the ${TOOLS[tool][0]} tool`);
        } }, 'Save as preset…')));
    return [...parts, ...commonBottom('point', id)];
  }

  // an area: its area and perimeter, its corners (typed, one inserted halfway to the next, one
  // removed while more than three)
  function areaInspector(id) {
    const el = now(id), u = ctx.units(), n = el.points.length;
    const corner = (i, axis) => F.coord(axis, () => now(id).points[i][axis === 'lat' ? 1 : 0],
      (v) => set(id, (x) => { const q = x.points[i]; x.points[i] = axis === 'lat' ? [q[0], v] : [v, q[1]]; }), `Corner ${i + 1} ${axis === 'lat' ? 'latitude' : 'longitude'}`);
    const insertAt = (i) => drawing.change((doc) => { const x = find(doc, id).el, q = x.points[i], r = x.points[(i + 1) % x.points.length], d = inverse(q, r); insertCorner(doc, x, i + 1, destination(q, d.azi, d.s / 2)); });
    const drop = (i) => { if (n > 3) drawing.change((doc) => removeCorner(doc, find(doc, id).el, i)); };
    const table = listGrid({ name: `${id}:corners`,
      columns: [{ head: '', width: 26, frozen: true, cls: 'num' }, { head: 'Lat', width: 100, frozen: true, paste: true }, { head: 'Lon', width: 100, frozen: true },
        { head: 'Edge', width: 104, title: 'The straight edge from the corner before: its length (typed: this corner and those after it move together; the closing edge follows)' },
        { head: 'Brg °', width: 72, title: 'The edge\'s bearing, degrees true' }],
      rows: el.points.map((_, i) => ({ cells: [`${i + 1}`, corner(i, 'lat'), corner(i, 'lon'), ...(i ? legFields(id, (x) => x.points, i, setAreaEdge, 'Edge') : [null, null])] })),
      actions: (i) => ({ label: `Corner ${i + 1}`, buttons: [act('Insert after', 'A corner halfway to the next (Insert)', () => insertAt(i)), act('Delete', 'Take this corner away (Ctrl/⌘ Delete); three are kept', () => drop(i), n <= 3)] }),
      keys: { insert: insertAt, remove: drop },
      paste: (r, text) => pastePlaces(id, r, text, (d, x, from, places) => { const res = placesAfterPaste(x.points, from, places); x.points = res.places; return res; }) });
    const cornerRows = () => { const ps = now(id).points; return [['#', 'Lat', 'Lon', 'Edge m', 'Brg °'], ps.map((q, i) => { const g = i ? legOf(ps, i) : null; return [i + 1, q[1], q[0], g ? +g.s.toFixed(3) : '', g ? +g.azi.toFixed(1) : '']; })]; };
    return [...commonTop('area', id),
      row('Area', h('span', { class: 'fvalue' }, `${fmtArea(areaOf(pathOf(el.points, true)), u)} · perimeter ${fmtDist(perimeterOf(el.points), u)}`)),
      h('div', { class: 'fblock' }, h('h3', {}, `Corners (${n})`, copyBtn(cornerRows)), table),
      lookBlock([item(id)]), ...commonBottom('area', id)];
  }

  // What a line's end or a label's anchor (key) points at (a reference, attach.js): attached, a link
  // to it and where on it, Attach to… (the next click on the map chooses again) and Detach (free where
  // it is); free, its position typed, and Attach to…
  function refRow(text, id, key) {
    const r = now(id)[key], on = r.element && find(drawing.doc, r.element);
    const attach = h('button', { type: 'button', class: 'small', 'aria-pressed': String(drawing.repointing?.id === id && drawing.repointing.key === key),
      title: 'Then click a point, a vertex, an edge, a line or an area to attach it there, or anywhere for a position (Esc: cancel)',
      onclick: () => { if (drawing.repointing?.id === id && drawing.repointing.key === key) drawing.cancelRepoint(); else drawing.startRepoint(id, key); renderInspector(); } }, 'Attach to…');
    if (!on) { const [, lat, , lon] = F.position(() => now(id)[key].position, (q) => set(id, (x) => { x[key] = { position: q, element: null }; })); return [row(text, pair(lat, '·', lon)), row('', attach)]; }
    // attached: what to (and where on it), Attach to…; × detaches it (it stays where it is)
    return row(text, link(on.el.id), partName(r) ? h('span', { class: 'funit' }, partName(r)) : null, attach,
      h('button', { type: 'button', class: 'x', title: 'Detach: keep it where it is, no longer following what it is attached to', 'aria-label': `Detach ${text.toLowerCase()}`, onclick: () => set(id, (x) => { x[key] = freeRef(x[key]); }) }, '×'));
  }

  // a label: its text (with live values), what it points at, its leader and its look
  const TOKEN_TEXT = { name: ['name', 'The name of what it points at'], length: ['length', 'The length of the line it points at, or of the side'],
    along: ['distance along', 'The distance along the line to where it points'], bearing: ['bearing', 'The bearing of the side or leg it points at'],
    radius: ['radius', 'The point\'s filled radius'], area: ['area', 'The area of the area or shape'], perimeter: ['perimeter', 'The perimeter of the area or shape'] };
  function labelInspector(id) {
    const doc = drawing.doc, el = now(id), u = ctx.units();
    const at = anchorAt(doc, el.anchor), values = labelValues(doc, el.anchor, u);
    const text = h('textarea', { rows: 3, 'aria-label': 'Text', class: 'ltext' }, el.text);
    text.addEventListener('input', () => drawing.previewLabels((d) => { find(d, id).el.text = text.value; })); // seen on the map as it is typed
    text.addEventListener('change', () => set(id, (x) => { x.text = text.value; }));
    const insert = (token) => {
      const a = text.selectionStart ?? text.value.length, b = text.selectionEnd ?? a;
      text.value = text.value.slice(0, a) + token + text.value.slice(b);
      set(id, (x) => { x.text = text.value; });
    };
    const tokens = TOKENS.filter((k) => values[k] !== undefined);
    // on a line: how far along it, typed (the leg there, and where on it)
    const onLine = at?.element?.kind === 'line' && at.along !== undefined;
    const alongRow = onLine ? row('Along', F.dist(() => at.along, (m) => drawing.change((d) => { const a = find(d, id).el; a.anchor = lineRef(d, find(d, a.anchor.element).el, m); }), 'Distance along', { zero: true }),
      h('span', { class: 'funit', title: 'From its start' }, `of ${fmtDist(at.length, u)}`)) : null;
    return [...commonTop('label', id),
      row('Text', text),
      tokens.length ? row('', ...tokens.map((k) => h('button', { type: 'button', class: 'small', title: `Insert, a live value: ${TOKEN_TEXT[k][1].toLowerCase()} (it follows edits and the units)`, onclick: () => insert(`{${k}}`) }, `+ ${TOKEN_TEXT[k][0]}`))) : null,
      ...[refRow(el.anchor.element ? 'Attached to' : 'Position', id, 'anchor')].flat(), alongRow,
      leaderRow([item(id)]), lookBlock([item(id)]),
      row('Placement', h('span', { class: 'fvalue' }, `${el.offset[0]}, ${el.offset[1]} px from its point`),
        h('button', { type: 'button', class: 'small', title: 'Back to where a new label goes', onclick: () => set(id, (x) => { x.offset = x.anchor.element ? [...LABEL_OFFSET] : [0, 0]; }) }, 'Reset')),
      ...commonBottom('label', id)];
  }

  // labels' leader: where the line from the text to its point ends (one or several labels)
  function leaderRow(xs) {
    const vs = xs.map((x) => x.el.leader), v = vs.every((x) => x === vs[0]) ? vs[0] : null;
    return row('Leader', segOf('Leader', LEADERS.map((k) => [k, { arrow: 'Arrow', dot: 'Dot', line: 'Line', none: 'None' }[k], { arrow: 'A line to its point, an arrow head there', dot: 'A line to its point, a dot there', line: 'A line to its point', none: 'No line' }[k]]),
      v, (k) => drawing.change((d) => { for (const x of xs) find(d, x.el.id).el.leader = k; })));
  }

  // a line: its ends (each attached to a point, or free), length, curve, the table of its vertices
  // (lat, lon, name, distance from its start, the handles folded)
  // Legs typed (the line's vertex table, the polygon's corner table): the straight leg arriving at a
  // place, its length and its bearing. A value typed moves that place and every one after it together
  // (the legs after it keep their lengths and bearings); a line's end attached stays attached.
  const legOf = (ps, k) => { const g = inverse(ps[k - 1], ps[k]); return { s: g.s, azi: norm360(g.azi) }; };
  const legTo = (ps, k, { s: len, azi }) => { const g = legOf(ps, k); return destination(ps[k - 1], azi ?? g.azi, len ?? g.s); };
  const linePlaces = (x) => [x.start.position, ...x.vertices.map((v) => v.position), x.end.position];
  function setLineLeg(x, k, v) {
    const ps = linePlaces(x), from = ps[k], to = legTo(ps, k, v);
    for (let j = k; j < ps.length; j++) {
      const q = moved(ps[j], from, to);
      if (j <= x.vertices.length) x.vertices[j - 1].position = q; else if (!x.end.element) x.end.position = q;
    }
  }
  function setAreaEdge(x, k, v) { // corners k … the last: the closing edge, back to corner 1, follows
    const from = x.points[k], to = legTo(x.points, k, v);
    for (let j = k; j < x.points.length; j++) x.points[j] = moved(x.points[j], from, to);
  }
  // a leg's two fields (get(): the places now; put(x, value): set on the element)
  const legFields = (id, places, k, put, what) => [
    distField(() => legOf(places(now(id)), k).s, (m) => set(id, (x) => put(x, k, { s: m })), `${what} ${k} length`),
    angleField(() => +legOf(places(now(id)), k).azi.toFixed(1), (a) => set(id, (x) => put(x, k, { azi: a })), `${what} ${k} bearing (degrees true)`, 0, 360, true)];
  // a row action's button, in a list grid's bar
  const act = (text, title, onclick, disabled = false) => h('button', { type: 'button', class: 'small', title, disabled, onclick }, text);
  // a list's Copy: its rows (rows(): [head, rows]) as text a spreadsheet takes, every column
  const copyBtn = (rows) => h('button', { type: 'button', class: 'small', title: 'Copy the rows, tab-separated, a header first: they paste into a spreadsheet', onclick: () => {
    const [head, body] = rows();
    navigator.clipboard?.writeText(rowsText(head, body)).then(() => note(`${plural(body.length, 'row')} copied`), () => note('This browser did not let them be copied'));
  } }, 'Copy');
  // Places pasted into a list of them (a line's places, an area's corners) from row r: put(d, el, r,
  // places) applies them, returning { applied, left }; the note says what was done, or why not
  const pastePlaces = (id, r, text, put) => {
    const { places, bad } = placesOf(text);
    if (bad) { note(`Not pasted: line ${bad} is no place (a latitude, then a longitude)`); return; }
    if (!places.length) return;
    let res = null;
    drawing.change((d) => { res = put(d, find(d, id).el, r, places); reattach(d, id); });
    note(res.applied ? `${plural(res.applied, 'place')} pasted${res.left ? `; ${res.left} left out: ${res.left === 1 ? 'it' : 'they'} would move an attached end` : ''}` : 'Not pasted: it would move an attached end', !!res.applied);
  };

  // ---- a line's depth profile (profile.js): read when its Profile button is pressed, read again as
  // the line changes; pointing at the chart shows the place on the map, pointing at the line on the
  // map shows it on the chart
  const profiles = new Map(); // line id → { key (its trace), prof (null while being read), failed }
  const profileShown = new Set();
  let profileCursor = null; // (d: metres along, or null) → the chart's cursor there
  const SVG = 'http://www.w3.org/2000/svg', W = 360, H = 110;
  const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  // depths as said: metres below the surface, positive
  const fmtDepth = (z) => (z >= -1 ? 'under 1 m' : `${Math.floor(-z)} m`);
  function profileBlock(id) {
    const el = now(id), u = ctx.units();
    if (!profileShown.has(id)) {
      return row('Profile', h('button', { type: 'button', class: 'small', title: 'The depth along the line, as the depth shading has it (GEBCO, cut to the coast), and its length along the seabed',
        onclick: () => { profileShown.add(id); renderInspector(); } }, 'Depth profile'));
    }
    const tr = lineTrace(drawing.doc, el), key = JSON.stringify(tr.coords);
    let p = profiles.get(id);
    if (!p || p.key !== key) {
      const mine = { key, prof: null, failed: false };
      profiles.set(id, p = mine);
      ctx.profile(tr).then((prof) => { mine.prof = prof; }, () => { mine.failed = true; })
        .then(() => { if (profiles.get(id) === mine && drawing.sel.size === 1 && drawing.sel.has(id)) renderInspector(); });
    }
    const close = h('button', { type: 'button', class: 'x', 'aria-label': 'Close the profile', title: 'Close the profile', onclick: () => { profileShown.delete(id); profileCursor = null; renderInspector(); } }, '×');
    if (!p.prof) return h('div', { class: 'fblock' }, h('h3', {}, 'Profile', close), h('p', { class: 'note' }, p.failed ? 'The depths could not be read.' : 'Reading the depths…'));
    const { pts, seabed, length, shallowest, deepest } = p.prof;
    if (!deepest) return h('div', { class: 'fblock' }, h('h3', {}, 'Profile', close), h('p', { class: 'note' }, 'No depth along this line (land, lakes, or no data).'));
    // the chart: depth down from the surface (0) to the deepest, along the line
    const bottom = Math.min(deepest.z, -1), X = (d) => (length ? (d / length) * W : 0), Y = (z) => (z / bottom) * (H - 14) + 4;
    const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'profile', role: 'img', 'aria-label': `Depth along the line, ${fmtDepth(shallowest.z)} to ${fmtDepth(deepest.z)}` });
    chart.append(svg('line', { x1: 0, x2: W, y1: Y(0), y2: Y(0), class: 'psurface' }));
    let run = [];
    const flush = () => { if (run.length > 1) chart.append(svg('polyline', { points: run.join(' '), class: 'pdepth' })); run = []; };
    for (const x of pts) { if (Number.isFinite(x.z)) run.push(`${X(x.d).toFixed(1)},${Y(x.z).toFixed(1)}`); else flush(); }
    flush();
    for (const [x, cls] of [[deepest, 'pmax'], [shallowest, 'pmin']]) chart.append(svg('circle', { cx: X(x.d), cy: Y(x.z), r: 2.5, class: cls }));
    const cursor = svg('line', { y1: 0, y2: H, class: 'pcursor', visibility: 'hidden' });
    chart.append(cursor);
    const at = h('span', { class: 'fvalue' }, '');
    const nearest = (d) => pts.reduce((a, b) => (Math.abs(b.d - d) < Math.abs(a.d - d) ? b : a));
    // the chart's cursor at d (metres along), and the place on the map; null: none
    profileCursor = (d) => {
      if (d == null) { cursor.setAttribute('visibility', 'hidden'); at.textContent = ''; drawing.setPreview([]); return; }
      const x = nearest(d);
      cursor.setAttribute('x1', X(x.d)); cursor.setAttribute('x2', X(x.d)); cursor.setAttribute('visibility', 'visible');
      at.textContent = `${fmtDist(x.d, u)} · ${Number.isFinite(x.z) ? fmtDepth(x.z) : 'no depth'}`;
      drawing.setPreview([x.p]);
    };
    chart.addEventListener('pointermove', (e) => { const r = chart.getBoundingClientRect(); profileCursor(((e.clientX - r.left) / r.width) * length); });
    chart.addEventListener('pointerleave', () => profileCursor(null));
    return h('div', { class: 'fblock' }, h('h3', {}, 'Profile', close),
      row('Depth', h('span', { class: 'fvalue' }, `${fmtDepth(shallowest.z)} to ${fmtDepth(deepest.z)}`), at),
      chart,
      row('Seabed', h('span', { class: 'fvalue', title: 'Each step\'s length counting the change in depth: a lower bound, as relief finer than the depth grid (about 460 m) is not in it' },
        `${fmtDist(seabed, u)} along the seabed · ${fmtDist(length, u)} on the surface`),
      h('button', { type: 'button', class: 'small', title: 'The profile as a CSV file: distance along, depth, latitude, longitude', onclick: () => ctx.download(profileCsv(p.prof), `${(el.name || 'line').replace(/[^\w-]+/g, '-')}-profile.csv`, 'text/csv') }, 'CSV')));
  }
  // pointing at a line on the map whose profile is shown: its place on the chart
  map.on('mousemove', (e) => {
    if (!profileCursor || drawing.sel.size !== 1) return;
    const id = [...drawing.sel][0], x = find(drawing.doc, id);
    if (x?.kind !== 'line' || !profileShown.has(id)) return;
    if (drawing.hitAt(e.point, 6).includes(id)) profileCursor(nearestAlong(lineTrace(drawing.doc, x.el).coords, [e.lngLat.lng, e.lngLat.lat]));
  });

  function lineInspector(id) {
    const doc = drawing.doc, el = now(id), u = ctx.units();
    const hv = drawing.handlesShown; // its Bézier handles, in the table and on the map
    const line = lineTrace(doc, el);
    const fix = (fn) => set(id, (x) => { fn(x); x.mode = 'fixed'; }); // a handle typed: the curve is the user's now
    const handleFields = (get, put, what) => {
      const one = (i, axis) => F.number(() => { const hd = get(now(id)); return hd ? +hd[i].toFixed(3) : null; },
        (v) => fix((x) => { const hd = get(x) || [0, 0]; const next = [...hd]; next[i] = v ?? 0; put(x, v === null && !next[1 - i] ? null : next); }),
        `${what} ${axis} (m)`, { min: -Infinity, empty: true, class: 'num', bad: 'metres, or empty for none', placeholder: '—' });
      return h('span', { class: 'fhandle' }, h('span', { class: 'funit' }, what), h('span', { class: 'funit' }, 'E'), one(0, 'east'), h('span', { class: 'funit' }, 'N'), one(1, 'north'), h('span', { class: 'funit' }, 'm'));
    };
    const at = line.at;
    const endOf = (e) => (e.element ? link(e.element) : h('span', { class: 'funit' }, 'free'));
    const leg = (k) => legFields(id, linePlaces, k, setLineLeg, 'Leg');
    const insertAfter = (i) => drawing.change((doc) => {
      const x = find(doc, id).el, ps = [x.start.position, ...x.vertices.map((v) => v.position), x.end.position];
      const a = ps[i + 1], b = ps[i + 2];
      addVertex(doc, x, i + 1, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); // what points at its vertices and edges stays where it is
    });
    const coord = (i, axis) => F.coord(axis, () => now(id).vertices[i].position[axis === 'lat' ? 1 : 0],
      (v) => set(id, (x) => { const p = x.vertices[i].position; x.vertices[i].position = axis === 'lat' ? [p[0], v] : [v, p[1]]; }), `Vertex ${i + 1} ${axis === 'lat' ? 'latitude' : 'longitude'}`);
    const n = el.vertices.length;
    const along = (k) => h('span', { class: 'fvalue' }, fmtDist(at[k] || 0, u));
    // an end's cells: attached, what to (across both); free, its latitude and longitude
    const endCells = (key) => {
      if (el[key].element) return [endOf(el[key]), null];
      const [, lat, , lon] = F.position(() => now(id)[key].position, (q) => set(id, (x) => { x[key] = { position: q, element: null }; }), `${key === 'start' ? 'Start' : 'End'} `);
      return [lat, lon];
    };
    const pasteLine = (r, text) => pastePlaces(id, r, text, (d, x, from, places) => {
      const ps = linePlaces(x), locked = new Set([...(x.start.element ? [0] : []), ...(x.end.element ? [ps.length - 1] : [])]);
      const res = placesAfterPaste(ps, from, places, locked), q = res.places;
      if (!x.start.element) x.start.position = q[0];
      x.vertices = q.slice(1, -1).map((pos, i) => (x.vertices[i] ? { ...x.vertices[i], position: pos } : { position: pos, handleIn: null, handleOut: null, name: '', properties: [] }));
      if (!x.end.element) x.end.position = q.at(-1);
      return res;
    });
    const vertexRows = () => { const x = now(id), ps = linePlaces(x), t = lineTrace(drawing.doc, x).at;
      return [['#', 'Lat', 'Lon', 'Leg m', 'Brg °', 'Name', 'Along m'], ps.map((q, i) => { const g = i ? legOf(ps, i) : null; return [i === 0 ? 'start' : i === ps.length - 1 ? 'end' : i, q[1], q[0], g ? +g.s.toFixed(3) : '', g ? +g.azi.toFixed(1) : '', x.vertices[i - 1]?.name ?? '', +(t[i] || 0).toFixed(3)]; })]; };
    const removeAt = (i) => drawing.change((doc) => removeVertex(doc, find(doc, id).el, i));
    const splitAt = (i) => { let p; drawing.change((d) => { p = splitKeeping(d, id, i); }); note(`Split: both parts attached to ${label('point', p)}`); };
    // its places as rows: its start (◂), its vertices, its end (▸); its handles under each, when shown
    const handlesOf = (getIn, putIn, getOut, putOut) => h('span', { class: 'fhandles' }, getIn ? handleFields(getIn, putIn, 'in') : null, getOut ? handleFields(getOut, putOut, 'out') : null);
    const table = listGrid({ name: `${id}:vertices`,
      columns: [{ head: '', width: 26, frozen: true, cls: 'num' }, { head: 'Lat', width: 100, frozen: true, paste: true }, { head: 'Lon', width: 100, frozen: true },
        { head: 'Leg', width: 104, title: 'The straight leg from the place before: its length (typed: this place and those after it move together)' },
        { head: 'Brg °', width: 72, title: 'The leg\'s bearing, degrees true' }, { head: 'Name', width: 110 }, { head: 'Along', width: 84, cls: 'num', title: 'The distance from its start' }],
      rows: [
        { cls: 'vnode', cells: ['◂', ...endCells('start'), null, null, null, along(0)], sub: hv ? handlesOf(null, null, (x) => x.startHandle, (x, hd) => { x.startHandle = hd; }) : null },
        ...el.vertices.map((v, i) => ({ cells: [`${i + 1}`, coord(i, 'lat'), coord(i, 'lon'), ...leg(i + 1),
          field(() => now(id).vertices[i].name, (t) => t, (nv) => set(id, (x) => { x.vertices[i].name = nv; }), { 'aria-label': `Vertex ${i + 1} name` }), along(i + 1)],
        sub: hv ? handlesOf((x) => x.vertices[i].handleIn, (x, hd) => { x.vertices[i].handleIn = hd; }, (x) => x.vertices[i].handleOut, (x, hd) => { x.vertices[i].handleOut = hd; }) : null })),
        { cls: 'vnode', cells: ['▸', ...endCells('end'), ...leg(n + 1), null, along(at.length - 1)], sub: hv ? handlesOf((x) => x.endHandle, (x, hd) => { x.endHandle = hd; }, null, null) : null }],
      actions: (r) => (r === 0 ? { label: 'Start', buttons: [act('Insert after', 'A vertex halfway to the next (Insert)', () => insertAfter(-1))] }
        : r <= n ? { label: `Vertex ${r}`, buttons: [act('Insert after', 'A vertex halfway to the next (Insert)', () => insertAfter(r - 1)),
          act('Delete', 'Take this vertex away (Ctrl/⌘ Delete)', () => removeAt(r - 1)), act('Split', 'Split the line here: this vertex becomes a point both parts are attached to', () => splitAt(r - 1))] } : null),
      keys: { insert: (r) => { if (r <= n) insertAfter(r - 1); }, remove: (r) => { if (r >= 1 && r <= n) removeAt(r - 1); } },
      paste: pasteLine });
    const off = el.look.offset ?? null, offNow = offsetOf(drawing.doc, el);
    return [...commonTop('line', id),
      ...[refRow('Start', id, 'start'), refRow('End', id, 'end')].flat(),
      row('Length', h('span', { class: 'fvalue' }, fmtDist(line.length, u)),
        h('button', { type: 'button', class: 'small', title: 'Copies placed along this line, every so far or so many, which then follow it; they can be connected to roots', onclick: () => openArray({ element: id, part: null }) }, 'Distribute along…')),
      offNow && off == null ? h('p', { class: 'note' }, `Drawn ${Math.abs(offNow)} px to the ${offNow > 0 ? 'right' : 'left'} of its line, its group's Offset. Its length is the real one.`) : null,
      drawing.inflatedIds().includes(id) ? h('p', { class: 'note' }, 'Drawn bowed, its connection\'s Inflate. Its length is the real one.') : null,
      profileBlock(id),
      row('Curve', h('span', { class: 'fvalue' }, el.mode === 'auto' ? 'smooth, follows its vertices' : 'as stored')),
      row('', h('button', { type: 'button', class: 'small', title: 'Curve smoothly through its bends; the curve then follows them (it replaces handles typed)', disabled: !el.vertices.length && !el.start.element, onclick: async () => {
          const typed = el.mode === 'fixed' && [el.startHandle, el.endHandle, ...el.vertices.flatMap((v) => [v.handleIn, v.handleOut])].some(Boolean);
          if (typed && !await ask('Smooth', 'Smoothing replaces the handles you typed with its own. The vertices stay.', [['yes', 'Smooth']])) return;
          set(id, (x) => { x.mode = 'auto'; applySmooth(drawing.doc, x); });
        } }, 'Smooth'),
        h('button', { type: 'button', class: 'small', title: 'Straight legs: geodesics', onclick: () => set(id, (x) => straighten(x)) }, 'Straighten')),
      h('div', { class: 'fblock' }, h('h3', { title: 'Where the line runs: its start (◂), its vertices (1, 2…), its end (▸). Along: the distance from the start. Click a row for what can be done with it (under the table).' }, `Vertices (${el.vertices.length})`, copyBtn(vertexRows),
        h('label', { class: 'fcheck small', title: 'Handles curve the line near a vertex: how far the curve is pulled east (E) and north (N) of it, in metres, as it arrives (in) and leaves (out). Empty: a straight leg. Typing one keeps the curve as typed.' }, h('input', { type: 'checkbox', checked: hv, onchange: (e) => { drawing.showHandles(e.target.checked); renderInspector(); } }), 'Handles')),
      table), // wider than the panel: it scrolls sideways, its first columns kept
      lookBlock([item(id)]), ...commonBottom('line', id)];
  }

  function groupInspector(id) {
    const doc = drawing.doc, u = ctx.units();
    const direct = membersOf(doc, id), subs = direct.filter((x) => x.kind === 'group').length;
    const below = membersOf(doc, id, true).filter((x) => x.kind !== 'group'); // everything in it, its subgroups' too
    const t = fx().totals.groups.get(id);
    return [...commonTop('group', id),
      row('Members', h('span', { class: 'fvalue' }, [`${direct.length - subs}`, subs ? plural(subs, 'group') : ''].filter(Boolean).join(' · ')),
        h('button', { type: 'button', class: 'small', title: 'Everything in it, its groups\' too', disabled: !below.length, onclick: () => drawing.select(below.map((x) => x.el.id)) }, 'Select members')),
      direct.length ? row('Shown', allBox(() => membersOf(drawing.doc, id, true), 'Members shown')) : null,
      t ? row('Totals', h('span', { class: 'fvalue' }, countOf(t, u))) : null,
      lookBlock([item(id)]), ...commonBottom('group', id)];
  }

  // The selection as chips: each element's kind and name (a click selects it alone), its × taking it
  // out of the selection; past CHIPS of them, the rest folded behind "+N more"
  const CHIPS = 12;
  let chipsAll = false; // the fold opened (until the selection changes)
  let chipsOf = '';
  function chips(xs) {
    const key = xs.map((x) => x.el.id).join();
    if (key !== chipsOf) { chipsOf = key; chipsAll = false; }
    const shown = chipsAll ? xs : xs.slice(0, CHIPS);
    return h('div', { class: 'chips', 'aria-label': 'Selected' }, shown.map((x) => h('span', { class: 'chip' },
      h('button', { type: 'button', class: 'chipname', title: 'Select this one only', onclick: () => drawing.select([x.el.id]) }, icon(...KIND_ICON[x.kind]), label(x.kind, x.el)),
      h('button', { type: 'button', class: 'x', 'aria-label': `Take ${label(x.kind, x.el)} out of the selection`, title: 'Take it out of the selection', onclick: () => drawing.select([x.el.id], 'toggle') }, '×'))),
    xs.length > shown.length ? h('button', { type: 'button', class: 'small', onclick: () => { chipsAll = true; renderInspector(); } }, `+${xs.length - shown.length} more`) : null);
  }

  function severalInspector(xs) {
    const counts = {};
    for (const x of xs) counts[x.kind] = (counts[x.kind] || 0) + 1;
    const vis = xs.every((x) => x.el.visible) ? true : xs.every((x) => !x.el.visible) ? false : null;
    const ids = xs.map((x) => x.el.id), members = ids;
    const pointIds = xs.filter((x) => x.kind === 'point').map((x) => x.el.id);
    const makeG = () => { let g; drawing.change((doc) => { g = makeGroup(doc, members); }); drawing.select([g.id]); };
    // two points: how far apart, and the bearing from the first to the second
    const between = xs.length === 2 && xs.every((x) => x.kind === 'point') ? inverse(xs[0].el.position, xs[1].el.position) : null;
    return [h('div', { class: 'fhead' }, h('h2', {}, `${xs.length} elements selected`),
      h('button', { type: 'button', class: 'small', onclick: () => showOnMap(new Set(ids)) }, 'Zoom to')),
    chips(xs),
    h('p', { class: 'note' }, Object.entries(counts).map(([k, n]) => plural(n, kindName(k).toLowerCase())).join(', ')),
    between ? row('Between', h('span', { class: 'fvalue', title: `From ${label(xs[0].kind, xs[0].el)}` }, `${fmtDist(between.s, ctx.units())} · ${fmtBrg(between.azi)}`)) : null,
    h('div', { class: 'frow fbuttons' },
      pointIds.length > 1 ? h('button', { type: 'button', title: 'Join these points to roots with straight lines: trees through hubs, or chains', onclick: () => openConnect(pointIds) }, 'Connect…') : null,
      h('button', { type: 'button', title: 'A new group of these, in the group they are in', onclick: makeG }, 'Group')),
    groupRow(members),
    xs.some((x) => x.kind === 'label') ? leaderRow(xs.filter((x) => x.kind === 'label')) : null,
    lookBlock(xs),
    h('div', { class: 'frow fend' }, check('Visible', vis, (v) => drawing.change((doc) => { for (const id of ids) find(doc, id).el.visible = v; })),
      h('button', { type: 'button', class: 'danger', onclick: () => del(ids) }, 'Delete all'))];
  }


  const treesOf = (c, n) => `${n} ${c.pattern === 'chain' ? 'chain' : 'tree'}${n === 1 ? '' : 's'}`;
  const copies = (n) => `${n} ${n === 1 ? 'copy' : 'copies'}`;
  // The rule an element was made by (generator.js ruleOf: a copy, a hub, a line, the rule's groups), as
  // a row: what it made, Edit… (its form: a repetition's, with its connection; a connection's on points
  // placed by hand) and Select all (everything it made)
  function ruleRow(id) {
    const doc = drawing.doc, r = ruleOf(doc, id);
    if (!r) return null;
    const live = (ids) => ids.filter((x) => doc.points.some((n) => n.id === x)).length;
    const a = r.kind === 'distribute' ? r : distributionOf(doc, r), c = r.kind === 'connect' ? r : connectionOn(doc, r);
    const along = a && find(doc, a.along.element);
    const rootIds = (x) => x.roots.map((o) => o.id);
    const text = a ? `Distribute along ${along ? label(along.kind, along.el) : 'what is gone'} · ${copies(a.points.length)}${c ? `, connected to ${plural(live(rootIds(c)), 'root')}` : ''}`
      : `Connection · ${c.pattern === 'chain' ? 'chains' : 'trees'}, ${plural(live(c.pointIds), 'point')} to ${plural(live(rootIds(c)), 'root')}`;
    const all = () => { const g = a ? a.groupId : c.groupId; drawing.select(membersOf(drawing.doc, g, true).filter((x) => x.kind !== 'group').map((x) => x.el.id)); };
    // Inflate: the trees drawn bowed, display only; live while the slider moves, one undo step when it is let go
    const pct = h('span', { class: 'fvalue' }, c ? `${Math.round(c.inflate * 100)} %` : '');
    const setInflate = (v, live) => (live ? drawing.preview : drawing.change).call(drawing, (d) => { const x = connections(d).find((y) => y.id === c.id); if (x) x.inflate = v; });
    const inflate = c && c.pattern === 'tree' ? row('Inflate', pair(h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(c.inflate * 100), 'aria-label': 'Inflate (%)',
      title: 'Its trees drawn bowed: each branch away from the fan\'s middle direction, the trunk arriving along it. Display only: lengths stay real',
      oninput: (e) => { setInflate(+e.target.value / 100, true); pct.textContent = `${e.target.value} %`; }, onchange: (e) => setInflate(+e.target.value / 100) }), pct)) : null;
    return [row('Made by', h('span', { class: 'fvalue', title: text }, text),
      h('button', { type: 'button', class: 'small', title: 'Its settings: the same number of copies moves them, another makes them anew', disabled: a && !along, onclick: () => (a ? openArray(a.along, a) : openConnect(c.pointIds, c)) }, 'Edit…')),
    row('', h('button', { type: 'button', class: 'small', title: 'Everything it made', onclick: all }, 'Select all')), inflate];
  }

  // ---- the tools' forms (generator.js): Distribute along a line or an arc, connected to roots or not;
  // Connect, for points placed by hand ----------------------------------------------------------------
  // form: { kind: 'array', along (a reference: the line, or the point), arrayId, connectionId } or
  // { kind: 'connect', pointIds, connectionId }
  // (an id: the one edited or made again, or null), and the selection it was opened with (another
  // closes it)
  let form = null;
  const arr = { by: 'spacing', spacing: 1000, count: 10, startMargin: 0, endMargin: 0, offset: 0, side: 'left', radius: COPY_RADIUS, aperture: null, part: null, preset: 'circle', copy: null, groupId: null, connect: false };
  const con = { pattern: 'tree', groupSize: 'auto', minBranch: 0, roots: [], newRoots: [] };
  const arrParams = () => ({ spacing: arr.spacing, count: arr.by === 'count' ? arr.count : null, startMargin: arr.startMargin, endMargin: arr.endMargin, offset: arr.offset, side: arr.side, radius: arr.radius, aperture: arr.aperture, preset: arr.preset, copy: arr.copy, groupId: arr.groupId,
    along: form && { element: form.along.element, part: arr.part } });
  const conParams = () => ({ pattern: con.pattern, groupSize: con.groupSize, minBranch: con.minBranch, roots: con.roots.map((r) => ({ ...r })), newRoots: con.newRoots.map((q) => [...q]) });
  const fromConnection = (c) => (c ? { pattern: c.pattern, groupSize: c.groupSize, minBranch: c.minBranch, roots: c.roots.map((r) => ({ ...r })) } : { roots: [] });
  const selKey = () => [...drawing.sel].sort().join(' ');
  // roots are picked on the map while the form connects
  const picks = () => form && (form.kind === 'connect' || arr.connect);
  function openForm(f) {
    form = { ...f, sel: selKey() };
    drawing.setPicking(picks() ? pick : null);
    formPreview();
    renderInspector();
  }
  function openArray(along, a = null) {
    const c = a && connectionOn(drawing.doc, a);
    arr.part = along.part ?? null; // a new one: the part followed by default
    if (a) Object.assign(arr, { by: a.count ? 'count' : 'spacing', spacing: a.spacing || arr.spacing, count: a.count || a.points.length, startMargin: a.startMargin, endMargin: a.endMargin,
      offset: a.offset, side: a.side, radius: a.radius, aperture: a.aperture, preset: a.preset ?? 'circle', copy: a.copy });
    arr.connect = !!c;
    Object.assign(con, fromConnection(c), { newRoots: [] });
    openForm({ kind: 'array', along: { element: along.element, part: along.part ?? null }, arrayId: a?.id ?? null, connectionId: c?.id ?? null });
  }
  function openConnect(pointIds, c = null) {
    Object.assign(con, fromConnection(c), { newRoots: [] });
    openForm({ kind: 'connect', pointIds: [...pointIds], connectionId: c?.id ?? null });
  }
  function closeForm() {
    form = null;
    drawing.setPicking(null);
    drawing.setPreview([]);
  }
  const arrayRun = () => distribute(drawing.doc, alongOf(drawing.doc, form.along.element), { ...arrParams(), part: arr.part });
  const arrayPoints = () => arrayRun().points, arrayCapped = () => arrayRun().capped;
  // the points being connected: the form's (Connect), or the distribution's being edited
  const formPointIds = () => (form.kind === 'connect' ? form.pointIds : distributions(drawing.doc).find((a) => a.id === form.arrayId)?.points.map((x) => x.pointId) ?? []);
  // the roots as the planner takes them, those gone or among the points dropped
  const rootsNow = () => {
    con.roots = con.roots.filter((r) => drawing.doc.points.some((n) => n.id === r.id) && !formPointIds().includes(r.id));
    return [...con.roots.map((r) => ({ position: now(r.id).position, weight: r.weight })), ...con.newRoots.map((position) => ({ position, weight: 1 }))];
  };
  // a connection's plan before it is made: { positions (in order), roots, plan }; for Distribute along,
  // on the places the points would have. Planned once for each change: the preview and the form, drawn
  // in the same task, share it (the next task plans again)
  let planned = null;
  const connectPlan = () => {
    if (!planned) { planned = planNow(); queueMicrotask(() => { planned = null; }); }
    return planned;
  };
  const planNow = () => {
    if (form.kind === 'connect') return (({ nodes, roots, plan: p }) => ({ positions: nodes.map((n) => n.position), roots, plan: p }))(planConnection(drawing.doc, { pointIds: form.pointIds, ...conParams() }));
    const positions = arrayPoints().map((x) => x.position), roots = rootsNow();
    return { positions, roots, plan: arr.connect && positions.length && roots.length ? plan(positions, roots, con.groupSize, con.pattern, con.minBranch) : null };
  };
  // what the form would make, faint on the map: the points; the lines, the roots ringed
  function formPreview() {
    const c = connectPlan(), joined = form.kind === 'connect' || arr.connect;
    drawing.setPreview(form.kind === 'array' ? c.positions : [], joined ? c.roots.map((r) => r.position) : [], c.plan ? lines(c.positions, c.roots, c.plan, con.pattern) : []);
  }
  // a setting changed: the preview and the form follow
  const formChanged = () => { drawing.setPicking(picks() ? pick : null); formPreview(); renderInspector(); };
  // a click on the map while roots are picked: on a point, it is a root or no longer one; anywhere
  // else, a new root there (on one, it goes)
  function pick(nid, pos) {
    if (nid) {
      if (formPointIds().includes(nid)) return note('That point is one of those being connected');
      con.roots = con.roots.some((r) => r.id === nid) ? con.roots.filter((r) => r.id !== nid) : [...con.roots, { id: nid, weight: 1 }];
    } else {
      const near = con.newRoots.findIndex((q) => { const a = map.project(q), b = map.project(pos); return Math.hypot(a.x - b.x, a.y - b.y) < 12; });
      con.newRoots = near >= 0 ? con.newRoots.filter((_, i) => i !== near) : [...con.newRoots, pos];
    }
    formChanged();
  }
  const formButtons = (text, ok, onclick) => h('div', { class: 'frow fbuttons' },
    h('button', { type: 'button', class: 'done', disabled: !ok, onclick }, text),
    h('button', { type: 'button', onclick: () => { closeForm(); renderInspector(); } }, 'Cancel'));

  // the connection's settings (tree or chain, group size, roots and their weights) and what it would
  // make, for both forms
  function connectRows(c) {
    const u = ctx.units(), redo = formChanged, p = c.plan;
    const names = [...con.roots.map((r) => label('point', now(r.id))), ...con.newRoots.map((_, i) => `New root ${i + 1}`)];
    const sizes = p ? p.groups.map((g) => g.nodes.length) : [];
    const what = con.pattern === 'chain' ? 'chain' : 'tree';
    const summary = !c.roots.length ? 'Choose at least one root: click the map where the lines start (anywhere, or on a point).'
      : p ? `${sizes.length} ${what}${sizes.length > 1 ? 's' : ''} (${sizes.join(', ')}), ${new Set(p.groups.map((g) => g.root)).size} of ${plural(c.roots.length, 'root')} used; ${fmtDist(p.total, u)} of lines in all (straight; the cheapest cut).` : '';
    const unused = p ? p.unused.map((i) => names[i]) : [];
    const drop = (k) => () => { if (k < con.roots.length) con.roots = con.roots.filter((_, i) => i !== k); else con.newRoots = con.newRoots.filter((_, i) => i !== k - con.roots.length); redo(); };
    const weight = (k) => (k < con.roots.length
      ? F.number(() => con.roots[k].weight, (v) => { con.roots[k].weight = v; redo(); }, `Weight of ${names[k]}`, { above: true, title: 'Its pull: at 2, every group is as if half as far from it; at 1, the plain shortest' })
      : h('span', { class: 'fvalue', title: 'A new root weighs 1: set it once made' }, '1'));
    return [row('', segOf('Tree or chain', [['tree', 'Tree', 'root → hub → each point'], ['chain', 'Chain', 'root → point → next point …']], con.pattern, (v) => { con.pattern = v; redo(); })),
      row('Group size', pair(segOf('Group size', [['auto', 'Auto', `any size: the cheapest cut${con.pattern === 'tree' ? ` (trees of up to ${MAX_AUTO_TREE})` : ''}`], ['set', 'Set', `points at most per ${what}`]], con.groupSize === 'auto' ? 'auto' : 'set', (v) => { con.groupSize = v === 'auto' ? 'auto' : 3; redo(); }), '',
        con.groupSize === 'auto' ? [] : F.number(() => con.groupSize, (v) => { con.groupSize = v; redo(); }, 'Group size', { whole: true, above: true, title: `Points at most per ${what}` }))),
      con.pattern === 'tree' ? row('Min. branch', F.dist(() => con.minBranch, (m) => { con.minBranch = m; redo(); }, 'Shortest branch', { zero: true,
        title: 'Each hub at least this far from its points and from its root. 0: where the lines are shortest, on a point if need be' })) : null,
      h('div', { class: 'fblock' }, h('h3', {}, `Roots (${c.roots.length})`),
        h('p', { class: 'note' }, 'Where the lines start: anywhere. Click the map to add one there (a new point, made with the rest), or click a point to use it; click again, or ×, to drop it. Roots are ringed. A weight above 1 pulls groups to that root.'),
        names.map((name, k) => h('div', { class: 'frow' }, k < con.roots.length ? link(con.roots[k].id) : h('span', { class: 'fvalue' }, `${name}: ${con.newRoots[k - con.roots.length][1].toFixed(5)}, ${con.newRoots[k - con.roots.length][0].toFixed(5)}`),
          h('span', { class: 'funit' }, 'weight'), weight(k),
          h('button', { type: 'button', class: 'x', 'aria-label': `Drop ${name}`, onclick: drop(k) }, '×')))),
      h('p', { class: 'note fsummary' }, summary, unused.length ? ` Not used: ${unused.join(', ')} (no group is cheapest from it; a weight above 1 would pull some).` : '')];
  }
  const sameConnection = (c) => c && c.pattern === con.pattern && c.groupSize === con.groupSize && c.minBranch === con.minBranch && !con.newRoots.length
    && c.roots.length === con.roots.length && c.roots.every((o) => con.roots.some((r) => r.id === o.id && r.weight === o.weight));

  // Distribute along a line or a point's arc, and its connection to roots: one form, one undo step
  function arrayForm() {
    const doc = drawing.doc, along = find(doc, form.along.element), editing = form.arrayId && distributions(doc).find((a) => a.id === form.arrayId);
    const tr = alongTrace(doc, along.el, arr.part), closed = tr?.closed;
    const c = connectPlan(), points = c.positions, redo = formChanged;
    // a distance that may be 0 (margins, the offset), or must be above 0 (spacing)
    const dist = (key, aria, zero) => F.dist(() => arr[key], (m) => { arr[key] = m; redo(); }, aria, { zero });
    const differs = editing && points.length !== editing.points.length;
    const was = form.connectionId && connections(doc).find((x) => x.id === form.connectionId);
    const ok = points.length && (!arr.connect || c.plan);
    // what is repeated: a built-in kind (the circle to start with), or a preset of the user's (its size its own)
    const mine = drawing.presets.filter((x) => x.point.parts.length);
    const choose = (v) => {
      arr.preset = v;
      const pre = v.startsWith('preset:') && mine.find((x) => `preset:${x.name}` === v);
      arr.copy = pre ? { symbol: pre.point.symbol, parts: structuredClone(pre.point.parts) } : null;
      redo();
    };
    const reach = arr.copy ? Math.max(...arr.copy.parts.map((q) => q.radius ?? q.length / 2)) : null;
    const arc = along.kind === 'point';
    return [h('div', { class: 'fhead' }, h('h2', {}, editing ? 'Edit, distributed along ' : 'Distribute along ', label(along.kind, along.el))),
      h('p', { class: 'note' }, arc ? `Copies round one of its parts, clockwise (${closed ? 'the whole of it, a circle from its bearing' : 'a sector\'s arc, from one end to the other'}); they follow it when it moves, turns or changes (one moved by hand stops following).`
        : 'Copies along this line, which they then follow when it is edited (one moved by hand stops following).'),
      arc && along.el.parts.length > 1 ? row('Part', select('Part', along.el.parts.map((part, i) => [i, `${i + 1} · ${PART_NAME[part.kind]}${part.name ? ` ${part.name}` : ''}`]), arr.part ?? followedPart(along.el), (v) => { arr.part = +v; redo(); })) : null,
      row('By', pair(segOf('Points by', [['spacing', 'Spacing'], ['count', 'Count']], arr.by, (v) => { arr.by = v; redo(); }), '',
        arr.by === 'spacing' ? dist('spacing', 'Spacing', false) : F.number(() => arr.count, (v) => { arr.count = v; redo(); }, 'Count', { whole: true, above: true, max: MAX_COPIES }))),
      arrayCapped() ? h('p', { class: 'note warn' }, `At most ${MAX_COPIES.toLocaleString('en')} copies: the spacing would give more`) : null,
      closed ? null : row('Margins', pair(dist('startMargin', 'Start margin', true), '·', dist('endMargin', 'End margin', true))),
      row('Offset', pair(dist('offset', 'Offset', true), '', select('Side', [['left', arc ? 'Out' : 'Left'], ['right', arc ? 'In' : 'Right'], ['alternate', 'Alternate']], arr.side, (v) => { arr.side = v; redo(); }))),
      row('Copy', select('Copy', [...Object.keys(BUILT_IN).map((k) => [k, builtInName(k)]), ...mine.map((x) => [`preset:${x.name}`, x.name])], arr.preset, choose, { title: 'What each copy is: a built-in kind, or a preset of yours' })),
      arr.copy ? row('Radius', h('span', { class: 'fvalue', title: 'The preset\'s own size' }, fmtDist(reach, ctx.units())))
        : row('Radius', F.dist(() => arr.radius, (m) => { arr.radius = m; redo(); }, 'Radius', { check: (m) => (m >= MAX_RADIUS ? 'too large' : null), title: arr.preset === 'circle' ? 'Each circle\'s, whatever the spacing' : 'Its largest part\'s reach, whatever the spacing' })),
      arr.preset === 'circle' ? row('Sector', segOf('Sector', [[null, 'None', 'circles'], ...[90, 180, 270].map((a) => [a, `${a}°`, arc ? 'facing outwards' : 'facing away from the line'])], arr.aperture, (v) => { arr.aperture = v; redo(); })) : null,
      editing ? null : row('In group', select('Group', [['', 'none (at the top)'], ...doc.groups.map((g) => [g.id, groupPath(g)])], arr.groupId ?? '', (v) => { arr.groupId = v || null; }, { title: 'Where its own group goes' })),
      h('p', { class: 'note fsummary' }, points.length ? `${copies(points.length)}.` : `No copy fits: ${arc ? 'the part' : 'the line'} is shorter than the margins, or the spacing too long.`),
      differs ? h('p', { class: 'note warn' }, `Another number of points (${editing.points.length} now): they are made anew${was ? ', and connected again' : ''}. Changes made to those by hand are lost; Undo brings them back.`) : null,
      h('div', { class: 'fblock' }, h('h3', {}, check('Connect to roots', arr.connect, (v) => { arr.connect = v; redo(); }, { title: 'Straight lines from roots to the points, attached to them: Tree, through a hub (which then follows its points); Chain, point to point. The points are cut into groups along the line, each to the root it is cheapest from.' })),
      arr.connect ? connectRows(c) : null,
      was && arr.connect && !sameConnection(was) ? h('p', { class: 'note warn' }, 'Its lines and hubs are made again. Changes made to those by hand are lost; Undo brings them back.') : null,
      was && !arr.connect ? h('p', { class: 'note warn' }, 'Its lines and hubs go (its roots stay).') : null),
      formButtons(editing ? 'Apply' : 'Create', ok, () => {
        let r, k = null;
        drawing.change((d) => {
          r = editing ? editDistribution(d, editing.id, arrParams()) : makeDistribution(d, arrParams());
          const was2 = connections(d).find((x) => x.id === form.connectionId);
          if (!arr.connect) { if (was2) unconnect(d, was2.id); return; }
          if (was2 && sameConnection(was2)) return;
          k = was2 ? reconnect(d, was2.id, conParams()) : connect(d, { pointIds: r.distribution.points.map((x) => x.pointId), ...conParams(), parentId: r.distribution.groupId });
        });
        closeForm();
        renderInspector(); // the selection may stay as it was (the group)
        drawing.select([r.distribution.groupId]);
        note([editing ? (r.remade ? 'Copies made anew' : 'Copies moved') : `${copies(r.distribution.points.length)} in ${label('group', find(drawing.doc, r.distribution.groupId).el)}`,
          k ? `${treesOf(k.connection, k.groups)}, ${plural(k.lines, 'line')}${k.unused.length ? `; not used: ${k.unused.map((o) => label('point', now(o))).join(', ')}` : ''}` : ''].filter(Boolean).join('; '));
      })];
  }

  // Connect, for points placed by hand (and Connect again, for a connection so made)
  function connectForm() {
    const doc = drawing.doc;
    const editing = form.connectionId && connections(doc).find((c) => c.id === form.connectionId);
    const c = connectPlan();
    return [h('div', { class: 'fhead' }, h('h2', {}, editing ? 'Connect again' : 'Connect', ` ${plural(c.positions.length, 'point')}`)),
      editing ? h('p', { class: 'note warn' }, 'Its lines and hubs are made again (its points and roots stay). Changes made to those by hand are lost; Undo brings them back.') : null,
      h('p', { class: 'note' }, 'Straight lines from roots to the points, attached to them: Tree, through a hub (which then follows its points); Chain, point to point. The points, in the order selected, are cut into groups, each to the root it is cheapest from.'),
      ...connectRows(c),
      formButtons(editing ? 'Connect again' : 'Connect', c.plan, () => {
        let r;
        drawing.change((d) => { r = editing ? reconnect(d, editing.id, conParams()) : connect(d, { pointIds: form.pointIds, ...conParams() }); });
        const ids = form.pointIds;
        closeForm();
        renderInspector(); // the selection may stay as it was (the group)
        drawing.select(r.connection.groupId ? [r.connection.groupId] : ids);
        note(`${treesOf(r.connection, r.groups)}, ${plural(r.lines, 'line')}${r.unused.length ? `; not used: ${r.unused.map((o) => label('point', now(o))).join(', ')}` : ''}`);
      })];
  }

  // nothing selected: the drawing itself
  const fileInput = h('input', { type: 'file', accept: '.geojson,.json,application/geo+json,application/json', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); } });
  function drawingInspector() {
    const m = drawing.doc.meta;
    const meta = (key, aria, area) => F.text(() => m[key], (v) => drawing.change((doc) => { doc.meta[key] = v; }), aria, area ? 2 : 0);
    const n = drawElements().length;
    const t = fx().totals, u = ctx.units();
    const tot = (b) => countOf(b, u) || 'nothing';
    const groupName = (gid) => (gid ? groupPath(drawing.doc.groups.find((g) => g.id === gid)) : 'Not grouped');
    const keys = [...new Set(elements(drawing.doc).flatMap((x) => x.el.properties.map((p) => p.key)))].sort((a, b) => a.localeCompare(b));
    if (totalsBy && !keys.includes(totalsBy)) { totalsBy = ''; computeFacts(); } // its key gone
    const by = select('Totals by', [['', 'group'], ...keys.map((k) => [k, k])], totalsBy || '', (v) => { totalsBy = v; computeFacts(); renderInspector(); });
    const rows = totalsBy ? [...fx().totals.values].sort(([a], [b]) => (!a) - (!b) || a.localeCompare(b)).map(([v, b]) => [v ? `“${v}”` : `No ${totalsBy}`, b])
      : t.groups.size > 1 ? [...t.groups].map(([gid, b]) => [groupName(gid), b]) : [];
    const offsetElsewhere = elements(drawing.doc).filter((x) => x.el.look.offset != null); // where Offset is set on an element or a group
    return [h('div', { class: 'fhead' }, h('h2', {}, 'Drawing'), n ? h('button', { type: 'button', class: 'small', onclick: () => showOnMap(new Set(elements(drawing.doc).map((x) => x.el.id))) }, 'Zoom to') : null),
      row('Title', meta('title', 'Title')), row('Description', meta('description', 'Description', true)), row('Author', meta('author', 'Author')),
      drawingsBlock(),
      lookBlock([{ kind: 'drawing', el: drawing.doc }], ['text.name', 'offset', 'minSize'], 'Display', [
        offsetElsewhere.length ? h('p', { class: 'note' }, 'Offset also set on ', ...offsetElsewhere.map((x) => link(x.el.id))) : null,
        row('Bearings', check('beside lengths', ctx.display.bearings, (v) => ctx.setDisplay({ bearings: v }), { title: 'Each leg\'s bearing (°T) beside its length, where values are shown' }))]),
      n ? h('div', { class: 'fblock' }, h('h3', {}, 'Totals'),
        keys.length ? row('By', by) : null,
        h('table', { class: 'vtable totals' }, h('tbody', {},
          h('tr', { class: 'all' }, h('td', {}, 'All'), h('td', {}, tot(t.all))),
          rows.map(([name, b]) => h('tr', {}, h('td', {}, name), h('td', {}, tot(b)))))),
        h('p', { class: 'note' }, 'Guides and measurements are left out; lines running together each count.')) : null,
      drawing.saving.failed ? h('p', { class: 'note warn' }, 'This browser does not let the drawing be saved (storage full or turned off): Export › Drawing (GeoJSON) keeps it as a file.') : null,
      drawing.saving.otherTab ? h('p', { class: 'note warn' }, 'The drawing was changed in another tab. Saving here replaces that version. ', h('button', { type: 'button', class: 'small', onclick: () => location.reload() }, 'Reload')) : null,
      h('p', { class: 'note' }, 'Drawings stay in this browser, saved as you go; nothing is sent anywhere. Export › Drawing (GeoJSON) writes one as a file, with the view, to share or keep it: links do not carry drawings.')];
  }
  function renderInspector() {
    // a field being edited is applied first, to the element it belongs to
    if (inspector.contains(document.activeElement)) document.activeElement.blur();
    const xs = drawing.selected();
    if (form && selKey() !== form.sel) closeForm();
    const kids = form ? (form.kind === 'array' ? arrayForm() : connectForm()) : !xs.length ? drawingInspector()
      : xs.length > 1 ? severalInspector(xs)
        : { point: pointInspector, area: areaInspector, line: lineInspector, group: groupInspector, label: labelInspector }[xs[0].kind](xs[0].el.id);
    const top = inspector.scrollTop;
    inspector.replaceChildren(...kids.flat().filter(Boolean));
    inspector.scrollTop = top;
  }

  // ---- map and files --------------------------------------------------------------------------
  function showOnMap(ids) {
    const b = boundsOf(drawing.doc, ids);
    if (b) map.fitBounds(b, { padding: ctx.free?.() ?? 60, maxZoom: 16 }); // clear of the panel
  }
  // the file: the drawing (its measurements too) and the view, as GeoJSON
  function exportFile() {
    const text = drawing.text();
    const when = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const title = drawing.doc.meta.title.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'chart';
    ctx.download(text, `${title}-${when}.geojson`);
  }
  // the drawings in this browser: the one open, the others to open (each with its view), New, and
  // Delete for good (asked first)
  function drawingsBlock() {
    const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
    const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const del = async (x) => {
      if (!await ask('Delete the drawing', `Delete “${x.title || 'Untitled'}” for good? It cannot be brought back.`, [['yes', 'Delete']])) return;
      drawing.saving.remove(x.id);
      note('Drawing deleted');
    };
    return h('div', { class: 'fblock' }, h('h3', {}, 'Drawings in this browser', h('button', { type: 'button', class: 'small', title: 'A new, empty drawing (this one stays in the list)', onclick: newDrawing }, '+ New')),
      h('ul', { class: 'drawings' }, drawing.saving.list().map((x) => h('li', { class: x.open ? 'open' : '' },
        h('button', { type: 'button', class: 'dname', disabled: x.open, title: x.open ? 'Open' : 'Open it, where it was drawn', onclick: () => ctx.openDrawing(x.id) }, x.title || 'Untitled'),
        h('span', { class: 'val' }, [when(x.modified), x.size ? kb(x.size) : ''].filter(Boolean).join(' · ')),
        h('button', { type: 'button', class: 'x', 'aria-label': `Delete ${x.title || 'Untitled'}`, title: 'Delete for good', onclick: () => del(x) }, '×')))));
  }
  function newDrawing() {
    drawing.saving.add();
    note('New drawing');
  }
  async function importFile(f) {
    const text = await f.text(), presets = readPresets(text);
    // a file of presets: added to the user's (one of the same name replaced)
    if (presets) {
      const names = new Set(presets.map((x) => x.name));
      drawing.presets = [...drawing.presets.filter((x) => !names.has(x.name)), ...presets];
      savePresets(drawing.presets);
      renderTools();
      return note(`${plural(presets.length, 'preset')} added to the Point and Shape tools`);
    }
    const { doc, report } = parse(text, ctx.known);
    const list = (items) => h('ul', {}, items.map((t) => h('li', {}, t)));
    const counts = doc ? [['point', doc.points.filter((x) => !mainOutline(x))], ['shape', doc.points.filter((x) => mainOutline(x))], ['line', doc.lines], ['area', doc.areas], ['label', doc.labels], ['group', doc.groups]]
      .map(([k, xs]) => [k, xs.filter((x) => !isMeasurement(doc, x)).length]).filter(([, n]) => n).map(([k, n]) => plural(n, k)) : [];
    const measured = doc ? elements(doc).filter((x) => isMeasurement(doc, x.el)).length : 0;
    if (measured) counts.push(plural(measured, 'measurement'));
    const replaced = doc?.view ? ['its view and layers'] : [];
    askDialog.replaceChildren(...[
      h('h2', { id: 'dask-title' }, doc ? `Import ${f.name}` : 'Not imported'),
      doc ? h('p', {}, counts.length ? `It holds ${counts.join(', ')}.` : 'It holds no elements.', replaced.length ? ` ${replaced.join(' and ').replace(/^i/, 'I')} will replace the current ones.` : '') : h('p', {}, report.refused),
      report.skipped.length ? [h('h3', {}, `Skipped (${report.skipped.length})`), list(report.skipped.map((s) => `${s.kind}${s.id ? ` ${s.id}` : ''}: ${s.reason}`))] : null,
      report.warnings.length ? [h('h3', {}, `Warnings (${report.warnings.length})`), list(report.warnings)] : null,
      h('div', { class: 'fbuttons' },
        doc ? h('button', { type: 'button', class: 'done', onclick: () => { askDialog.close(); ctx.onImport(doc, report); } }, 'Import') : null,
        h('button', { type: 'button', onclick: () => askDialog.close() }, doc ? 'Cancel' : 'Close')),
      doc ? h('p', { class: 'note' }, 'It is added to the drawings in this browser and opened; this one stays in the list.') : null,
    ].flat().filter(Boolean));
    askDialog.showModal();
  }

  // ---- the divider between list and inspector ----------------------------------------------------
  const divider = h('div', { class: 'ddivider', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the list', tabindex: 0, title: 'Drag to resize the list' });
  const setSplit = (px) => {
    const v = Math.round(Math.max(80, Math.min(px, root.clientHeight - 160)));
    root.style.setProperty('--dlist-h', `${v}px`);
    try { localStorage.setItem(SPLIT_KEY, String(v)); } catch { /* only a convenience */ }
  };
  try { const v = +localStorage.getItem(SPLIT_KEY); if (v > 0) root.style.setProperty('--dlist-h', `${v}px`); } catch { /* only a convenience */ }
  divider.addEventListener('pointerdown', (e) => {
    const y0 = e.clientY, h0 = listBox.offsetHeight;
    divider.setPointerCapture(e.pointerId);
    const move = (ev) => setSplit(h0 + ev.clientY - y0);
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', () => divider.removeEventListener('pointermove', move), { once: true });
  });
  divider.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setSplit(listBox.offsetHeight + (e.key === 'ArrowUp' ? -24 : 24)); }
  });

  root.append(toolsRow, touchbar, subrail, listBox, divider, inspector, noteEl, fileInput); // fileInput: the rail's Import

  // ---- keys, while the Tools panel is open -----------------------------------------------------
  window.addEventListener('keydown', (e) => {
    // while the Tools panel is open
    if (!ctx.isOpen() || document.querySelector('dialog[open]')) return;
    const typing = typingIn(e.target); // a box ticked is no typing: the keys stay the drawing's
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      if (typing) return; // the field's own undo
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) drawing.redo(); else drawing.undo();
      return;
    }
    // copy, paste, duplicate (Ctrl/⌘ C, V, D): the selection's elements, not text being typed
    if (mod && !e.altKey && !typing && ['c', 'v', 'd'].includes(e.key.toLowerCase())) {
      const k = e.key.toLowerCase();
      if (k === 'c' && !drawing.sel.size) return; // nothing selected: the page's own copy
      e.preventDefault();
      const n = k === 'c' ? drawing.copy() : k === 'v' ? drawing.paste() : drawing.duplicate();
      if (n) note(`${k === 'c' ? 'Copied' : k === 'v' ? 'Pasted' : 'Duplicated'}: ${plural(n, 'element')}`, k !== 'c');
      return;
    }
    // deleting: Delete; on a Mac, whose delete key is Backspace, ⌘-Backspace as in the Finder. Never
    // Backspace alone, which takes back a point while drawing (here and in Measure)
    if (!typing && (e.key === 'Delete' || (mac && e.metaKey && e.key === 'Backspace')) && drawing.sel.size) { e.preventDefault(); del([...drawing.sel]); return; }
    if (typing || mod || e.altKey || !ctx.isOpen()) return;
    const ids = shown().map((x) => x.el.id); // the tools' keys: app.js, from anywhere
    if (e.key === 'Escape' && drawing.repointing) { drawing.cancelRepoint(); renderInspector(); }
    else if (e.key === 'Escape') drawing.select([]); // with a tool on, Esc is the toolbox's (tools.js)
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && ids.length && !e.target.closest('.ddivider')) {
      e.preventDefault();
      const cur = ids.indexOf([...drawing.sel].at(-1));
      const next = cur < 0 ? (e.key === 'ArrowDown' ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      anchor = ids[next];
      drawing.select([ids[next]]);
      list.querySelector(`[data-id="${CSS.escape(ids[next])}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'F2' && drawing.sel.size === 1) { e.preventDefault(); rename([...drawing.sel][0]); }
  });

  // ---- rendering ---------------------------------------------------------------------------
  function renderTools() {
    const on = drawing.button;
    for (const b of toolBtns) b.setAttribute('aria-pressed', String(on === b.dataset.tool));
    undoBtn.disabled = !drawing.undos.length;
    redoBtn.disabled = !drawing.redos.length;
    renderTouch();
    const c = ctx.compact();
    if (compactBtn.dataset.c !== String(c)) {
      compactBtn.dataset.c = String(c);
      placeControls(c);
      compactBtn.setAttribute('aria-label', c ? 'The whole panel' : 'Only the tools');
      compactBtn.title = c ? 'The whole panel: the list and the inspector' : 'Only the tools: the map as large as it can be (it goes back when the tool ends)';
      // a panel on the right, an arrow out of it or into it (as Lucide's panel-right-open, -close)
      compactBtn.replaceChildren(icon('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M15 3v18', c ? 'm10 15-3-3 3-3' : 'm8 9 3 3-3 3'));
    }
    renderSubrail();
  }
  return {
    render(what) {
      if (what === 'tool') return renderTools();
      if (what === 'draft') return renderTouch();
      if (what === 'area') { // a Select drag ended: say what it did, even when nothing was inside
        const n = drawing.sel.size;
        note(n ? `${n} element${n > 1 ? 's' : ''} selected` : 'Nothing lies entirely inside the rectangle');
      }
      if (what === 'zoom') { // what an enlarged outline says, without rebuilding the fields (one may be being typed in)
        for (const row of list.querySelectorAll('.drow')) { const x = find(drawing.doc, row.dataset.id); if (x?.kind === 'point' && mainOutline(x.el)) row.querySelector('.val').textContent = value('point', x.el); }
        for (const el of inspector.querySelectorAll('.fenlarged')) { const sh = now(el.dataset.id); if (sh) el.textContent = enlarged(sh); }
        return;
      }
      // a label just placed (and selected, so shown): its text ready to be typed
      if (what === 'placed') { const t = inspector.querySelector('.ltext'); t?.focus(); t?.select(); return; }
      // the selection only changed: the rows marked again, not built again (each row's value is a length
      // or an area, computed)
      if (what === 'sel') for (const row of list.querySelectorAll('.drow[data-id]')) row.classList.toggle('sel', drawing.sel.has(row.dataset.id));
      else renderList();
      renderInspector();
      if (form && what === 'doc') formPreview(); // the form's preview follows the drawing (an undo, its line edited)
      if (what === 'doc') for (const id of profiles.keys()) if (!find(drawing.doc, id)) { profiles.delete(id); profileShown.delete(id); } // a line gone: its profile too
      if (what === 'sel' && drawing.sel.size) list.querySelector(`[data-id="${CSS.escape([...drawing.sel].at(-1))}"]`)?.scrollIntoView({ block: 'nearest' });
      renderTools();
    },
    save: exportFile, // the rail's Export › Drawing (GeoJSON), and Import
    // the rail's Export › Presets: the user's, as a file
    savePresets: () => ctx.download(presetsFile(drawing.presets), 'presets.json'),
    press, cycle, // the tools' keys (app.js)
    open: () => fileInput.click(),
    // the panel closed: nothing it started goes on picking on the map (the form's roots, Attach to…)
    closed() { if (form) { closeForm(); renderInspector(); } if (drawing.repointing) drawing.cancelRepoint(); },
  };
}
