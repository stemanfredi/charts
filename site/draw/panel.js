// The drawing's left frame (docs/drawing-ui.md): the rail of the tools, and the column: the tree of the
// drawing's elements, and under it the inspector, which shows what is selected (or, with nothing
// selected, the drawing itself) and edits it with fields. Fields apply on Enter or when they lose
// focus, one undo step each.

import { h, svg, typing, NARROW, store } from '../dom.js';
import { popup } from '../menu.js';
import { FINGER } from './layers.js';
import { find, elements, groupsOf, membersOf, canHold, label, kindName, pointKind, POINT_KIND_NAME, lookOf, lookField, setLook, LOOK_FIELDS, labelColour, addPart, makePart, followedPart, mainOutline, PART_KINDS, ROUND, SYMBOLS, DASHES, LEADERS, LABEL_OFFSET, makeGroup, setGroup, moveBefore, moveStep, isMeasurement, MAX_RADIUS, offsetOf, MAX_OFFSET, MAX_MIN_SIZE, STROKE_WIDTH, OUTLINES } from './document.js';
import { parse } from './file.js';
import { insertCorner, removeCorner, reattach, partName, addVertex, removeVertex, splitKeeping, lineRef, freeRef, resolve, along } from './attach.js';
import { labelText, labelValues, TOKENS } from './labels.js';
import { OUTLINE_NAME, outlineOf, isVehicle } from './outlines.js';
import { lineTrace, totals, breakdown, nearestAlong, positionsOf } from './lines.js';
import { profileCsv } from './profile.js';
import { COPY_RADIUS, distribute, lines, plan, planConnection, makeDistribution, editDistribution, connect, reconnect, unconnect, alongTrace, alongOf,
  distributions, connections, ruleOf, distributionOf, connectionOn, changedByHand, giveBack, removePartOf, MAX_COPIES, MAX_TREE } from './generator.js';
import { BUILT_IN, builtInName } from './place.js';
import { boundsOf, drawable } from './features.js';
import { inverse, areaOf, pathOf, destination, perimeterOf } from '../geodesy.js';
import { moved } from './drag.js';
import { norm360 } from '../geo.js';
import { fields, choice, select, check } from '../fields.js';
import { keyOf, mac, MOD } from '../keys.js';
import { loadPresets, savePresets, presetOf, presetsFile, readPresets } from './presets.js';
import { listGrid } from './grid.js';
import { fmtArea, fmtBrg, fmtDist, rowsText } from '../format.js';

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
// the column's and the actions' icons (as Lucide's): the column, Zoom to, Duplicate, Group, Delete,
// Detach, shown and hidden
const UI_ICON = {
  elements: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 3v18'],
  zoom: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M12 9v6', 'M9 12h6'],
  duplicate: ['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z', 'M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2'],
  group: ['M3 7h7l2 2h9v10H3z', 'M12 11v6', 'M9 14h6'],
  delete: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  detach: ['m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'm5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71', 'M8 2v3', 'M2 8h3', 'M16 19v3', 'M19 16h3'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  hidden: ['M10.7 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7', 'M6.6 6.6A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M14.1 14.1a3 3 0 1 1-4.2-4.2', 'M2 2l20 20'],
  // a fold's
  chevron: ['m6 9 6 6 6-6'],
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
const SELECT_ICON = ['M5 3l14 8-6 2-2 6z']; // an arrow
const SYMBOL_TITLE = { diamond: 'Diamond', square: 'Square', triangle: 'Triangle', dot: 'Dot', none: 'None' };
const SPLIT_KEY = 'charts.drawing.split';
const ELEMENTS_KEY = 'charts.drawing.elements'; // the column open ('1') or not
const FOLDS_KEY = 'charts.drawing.folds'; // the column's halves folded: { list, insp }
const WIDTH_NAME = { 'aerial-vehicle': 'Span', 'surface-vehicle': 'Beam', 'underwater-vehicle': 'Diameter' }; // a shape's width, as said of each outline

// root: the column's content. ctx: { drawing, map, icon, units() ('km' | 'nm'), known, strip (the rail),
// elements (the column), columnShown(), menuExtras(close) (the ☰ menu's foot), onImport(doc, report)
// (applies an imported document), openDrawing(id), download(text, name), profile(trace) }
export function drawView(root, ctx) {
  const { drawing, map, icon } = ctx;
  let anchor = null; // the row a Shift-click range starts from
  let filter = '';
  const folded = new Set(); // groups folded in the list (this session)
  const F = fields({ note, units: ctx.units }), { field } = F; // fields.js: each applies on Enter or when left
  let facts = null; // the totals: computed once per rendering of the list, read by the inspector
  let totalsBy = ''; // the drawing's totals by group (''), or by the values of a property (its key)
  const totalsFolded = new Set(); // the Totals view's groups folded (by key)
  const computeFacts = () => (facts = { totals: totals(drawing.doc, totalsBy || null), breakdown: breakdown(drawing.doc, totalsBy || null) });
  const fx = () => facts || computeFacts();

  // ---- tools ------------------------------------------------------------------------------
  // The rail (drawing-ui.md §2): Select, Point, Line, Shape, Label, Measure, then Undo and Redo. A tool
  // with variants shows them in its sub-rail; it remembers the one chosen last, and its key pressed
  // again moves to the next (app.js).
  drawing.presets = loadPresets();
  const TOOLS = { point: ['Point', 'Place points: click on the map'], line: ['Line', 'Draw a line: click its start, its bends, then a point, a corner, an edge or a vertex to end there (attached), or Enter'],
    shape: ['Shape', 'Place a shape of the outline chosen, or draw a polygon'], label: ['Label', 'Place a label: click a point, a shape, an area or a line to point at it, or anywhere for free text'],
    measure: ['Measure', 'Measure a distance: a line kept as a guide showing its lengths'] };
  // the kinds each tool makes (its sub-rail), each with a short tooltip. Shape: round a centre, the
  // outlines to scale, the polygon, the vehicles, the user's presets with extent
  const presetsOf = (tool) => drawing.presets.filter((x) => presetTool(x) === tool).map((x) => [`preset:${x.name}`, `${x.name}: a preset of yours (right-click: rename or delete)`]);
  const outline = (k) => [k, `${OUTLINE_NAME[k]}: an outline to scale`];
  const variants = (tool) => ({
    point: [['symbol', 'Symbol: the same size at every zoom'], ...presetsOf('point')],
    shape: [['circle', 'Circle: a distance round a centre'], ['rings', 'Rings: distances round a centre'], ['sector', 'Sector: part of a circle, in three clicks'],
      outline('rectangle'), outline('ellipse'), outline('triangle'), ['polygon', 'Polygon: corner by corner'], ...OUTLINES.filter(isVehicle).map(outline), ...presetsOf('shape')],
  })[tool] || [];
  const current = (tool) => drawing.variant[tool];
  // A tool's button pressed: on, or off when it is on. Its kinds are a column beside the rail, open
  // while the tool is on; the tool's button shows the kind in use (drawing-ui.md §1)
  const press = (tool) => (drawing.button === tool ? drawing.stop() : drawing.start(tool));
  // a variant chosen in the sub-rail: the tool on with it
  const choose = (tool, v) => drawing.setVariant(tool, v);
  // the next variant of a tool (its key pressed again), or the tool on
  function cycle(tool) {
    const vs = variants(tool).map(([v]) => v), on = drawing.button === tool;
    if (!on || vs.length < 2) return press(tool);
    choose(tool, vs[(vs.indexOf(current(tool)) + 1) % vs.length]);
  }
  // the rail's tools
  const toolBtns = Object.entries(TOOLS).map(([k, [text, title]]) => h('button', { type: 'button', 'data-tool': k, 'aria-pressed': 'false', 'aria-label': text, title: `${title} (${keyOf(k)})`,
    onclick: () => press(k) }, icon(...(k === 'measure' ? ctx.measureIcon : KIND_ICON[k]))));
  const undoBtn = h('button', { type: 'button', class: 'urbtn', 'aria-label': 'Undo', title: `Undo (${MOD} Z)`, onclick: () => drawing.undo() }, icon('M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'));
  const redoBtn = h('button', { type: 'button', class: 'urbtn', 'aria-label': 'Redo', title: `Redo (${MOD} Shift Z)`, onclick: () => drawing.redo() }, icon('m15 14 5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'));
  const sep = () => h('span', { class: 'tsep', 'aria-hidden': 'true' });
  const subrail = h('div', { class: 'subrail', role: 'group', hidden: true });
  // the rail's own: ☰, the drawings and the file; Select; the column's toggle
  const fileBtn = h('button', { type: 'button', class: 'filebtn', 'aria-label': 'File', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    title: 'The drawings in this browser, and the file: New, Import, Export', onclick: () => toggleDrawings(fileBtn) }, icon('M4 6h16', 'M4 12h16', 'M4 18h16'));
  const selectBtn = h('button', { type: 'button', class: 'selbtn', 'aria-label': 'Select', title: `Select: a click on an element (Shift, ${MOD}: add or remove); Shift-drag a box on the map`,
    onclick: () => drawing.stop() }, icon(...SELECT_ICON));
  const colToggle = h('button', { type: 'button', class: 'etoggle coltoggle', 'aria-label': 'The tree and the inspector', title: 'The tree and the inspector: shown or hidden (E)',
    onclick: () => setElements(!elementsOpen) }, icon(...UI_ICON.elements));
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
  document.body.append(touchbar); // over the map, at its foot: the column may be closed
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
      preset ? h('span', { class: 'initials' }, name.slice(0, 2)) : icon(...(POINT_ICON[v] || KIND_ICON.point)));
    }));
    // level with its tool's button, within the window
    const from = toolBtns.find((x) => x.dataset.tool === tool);
    subrail.style.top = from && !subrail.hidden ? `${Math.max(0, Math.min(from.offsetTop - 5, innerHeight - subrail.offsetHeight - 6))}px` : '';
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
  // An eye for all of xs() (what: what they are, for its label): every one shown, a click hides them
  // all; some or none, a click shows them all. render() when they change.
  const showAll = (v, xs) => drawing.change((doc) => { for (const x of xs) find(doc, x.el.id).el.visible = v; });
  const eyeFor = (xs, what) => {
    const b = h('button', { type: 'button', class: 'deye', onclick: () => { const all = xs(); showAll(!all.every((x) => x.el.visible), all); } });
    b.render = () => {
      const all = xs(), on = all.filter((x) => x.el.visible).length, every = !!all.length && on === all.length;
      b.setAttribute('aria-pressed', on && !every ? 'mixed' : String(every));
      b.setAttribute('aria-label', `${every ? 'Hide' : 'Show'} all ${what}`);
      b.title = every ? 'All shown: click to hide them all' : on ? 'Some hidden: click to show them all' : 'All hidden: click to show them all';
      b.replaceChildren(icon(...(every ? UI_ICON.eye : UI_ICON.hidden)));
    };
    return b;
  };
  // the list's head: the drawing's title, the eye for every element listed, its fold; above the list, past FILTER_FROM elements, the filter and
  // Select all shown
  const listed = () => (filter ? shown() : drawElements());
  const eyeAll = eyeFor(listed, 'listed');
  const filterRow = h('div', { class: 'dfilter' }, filterInput, selectShown);
  // the hover ends when the pointer leaves the list: a row rebuilt under it never says it was left
  const list = h('ul', { class: 'dlist', 'aria-label': 'Elements', onpointerleave: () => drawing.setHover(null) });
  // The column (drawing-ui.md §1), the tree over the inspector, shown or hidden by the rail's toggle (and E); either half
  // folds to its head (each remembered in this browser). The inspector shows what is selected, or the
  // drawing itself with nothing selected.
  let elementsOpen = !NARROW.matches && store.get(ELEMENTS_KEY) !== '0'; // on a phone: closed to start with
  function setElements(v) {
    elementsOpen = v;
    store.set(ELEMENTS_KEY, v ? '1' : '0');
    if (v) ctx.columnShown?.();
    place();
  }
  const folds = { list: false, insp: false, ...store.json(FOLDS_KEY) };
  const foldBtn = (half, what) => h('button', { type: 'button', class: 'etoggle fold', 'aria-label': `Fold the ${what}`, title: 'Fold or open', onclick: () => {
    folds[half] = !folds[half];
    store.set(FOLDS_KEY, JSON.stringify(folds));
    place();
  } }, icon(...UI_ICON.chevron));
  const docTitle = h('button', { type: 'button', class: 'dtitle', title: 'The drawing: its title, its display, its totals', onclick: () => drawing.select([]) });
  const listFold = foldBtn('list', 'tree'), inspFold = foldBtn('insp', 'inspector');
  const listHead = h('div', { class: 'dlisthead' });
  const listBox = h('div', { class: 'dlistbox' }, listHead, filterRow, list);
  // the inspector's head: what it shows, the actions on it (renderHead), its fold
  let title = ''; // what the inspector shows, said in its head (set by the inspector built)
  const inspTitle = h('span', { class: 'ititle' }), inspActs = h('span', { class: 'iacts' });
  const inspHead = h('div', { class: 'dinsphead' }, inspTitle, inspActs, inspFold);

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
    const t = facts.totals.groups.get(el.id), n = t ? t.points + t.lines + t.areas : 0;
    return [n ? plural(n, 'element') : 'empty', offset].filter(Boolean).join(' · ');
  }
  // an outline drawn larger than its real size at this zoom says so
  function enlarged(point) {
    const k = drawing.enlargement(point);
    return k > 1 ? `shown ×${k < 10 ? k.toFixed(1) : Math.round(k)}` : '';
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
      onclick: () => { if (folded.has(id)) folded.delete(id); else folded.add(id); renderList(); } }) : null;
    const t = kind === 'group' && facts.totals.groups.get(id);
    return elementRow({ id, icon, kindIcon: iconOf(kind, el), title: kindTitle(kind, el), name: label(kind, el), value: value(kind, el), valueTitle: t ? countOf(t, ctx.units()) : undefined,
      visible: el.visible, selected: drawing.sel.has(id) }, {
      select: (e) => clickRow(id, e), hover: (x) => drawing.setHover(x),
      visible: (v) => drawing.change((doc) => { find(doc, id).el.visible = v; }),
    }, { fold, classes: [depth ? `d${Math.min(depth, 5)}` : '', kind === 'group' ? 'dgroup' : ''].filter(Boolean).join(' '),
      name: { title: `Select (Shift: range, ${MOD}: add or remove). Double-click to rename.`, ondblclick: () => rename(id) } });
  }

  function renderList() {
    computeFacts();
    const rows = shown();
    filterRow.hidden = drawElements().length <= FILTER_FROM && !filter; // nothing to show above the list: no room taken
    list.replaceChildren(...rows.map(rowOf));
    eyeAll.render();
    docTitle.textContent = drawing.doc.meta.title || 'Untitled drawing';
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

  // A dialog: its title, its body (body(done): what it shows; done(value) answers), its buttons
  // ([value, text], the last the main one; a value may be a function, read when chosen), then cancel's
  // (Cancel, Esc), then a note. Resolves to the value chosen, or null.
  const askDialog = h('dialog', { class: 'dreport', 'aria-labelledby': 'dask-title' });
  document.body.append(askDialog);
  function dialog(title, body, buttons, cancel = 'Cancel', foot = null) {
    return new Promise((resolve) => {
      let answer = null;
      const done = (v) => { answer = v; askDialog.close(); };
      askDialog.replaceChildren(h('h2', { id: 'dask-title' }, title), body(done),
        h('div', { class: 'fbuttons' }, buttons.map(([v, t], i) => h('button', { type: 'button', class: i === buttons.length - 1 ? 'done' : '', onclick: () => done(typeof v === 'function' ? v() : v) }, t)),
          h('button', { type: 'button', onclick: () => askDialog.close() }, cancel)), foot);
      askDialog.addEventListener('close', () => resolve(answer), { once: true });
      askDialog.showModal();
    });
  }
  // a question: resolves to the chosen button's value, or null
  const ask = (title, text, buttons) => dialog(title, () => h('p', {}, text), buttons);
  // a text asked for: resolves to it, or null
  function askText(title, what, value = '') {
    const input = h('input', { type: 'text', value, 'aria-label': what });
    const asked = dialog(title, (done) => {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(input.value); } });
      return h('p', {}, h('label', {}, `${what} `, input));
    }, [[() => input.value, 'OK']]);
    input.select();
    return asked;
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

  // The look of xs ({ kind, el }, one or several; a group: everything in it; the drawing: { kind:
  // 'drawing', el: doc }): each field what they are drawn with (document.js lookOf: their own value,
  // else the drawing's), "mixed" where they differ; a change sets it on each of them, ↺ takes it back.
  // A group has no look of its own: it reaches its members. Only the fields their kinds have (a line
  // no fill, a label its text, a shape its minimum size); fields: those to show, else all of those.
  function lookBlock(xs, fields = null, title = 'Look', extra = []) {
    const doc = drawing.doc;
    xs = [...new Map(xs.flatMap((x) => (x.kind === 'group' ? membersOf(doc, x.el.id, true).filter((m) => m.kind !== 'group') : [x])).map((x) => [x.el.id ?? 'drawing', x])).values()];
    if (!xs.length && !extra.length) return null; // an empty group
    const has = (x, f) => (x.kind === 'drawing' || LOOK_FIELDS[x.kind].includes(f)) && (f !== 'minSize' || x.kind !== 'point' || !!mainOutline(x.el));
    const shown = (f) => (!fields || fields.includes(f)) && xs.some((x) => has(x, f));
    const looks = xs.map((x) => (x.kind === 'label' ? { ...lookOf(doc, x.el), text: { ...lookOf(doc, x.el).text, color: labelColour(doc, x.el) } } : lookOf(doc, x.el)));
    const same = (f) => { const vs = xs.map((x, i) => (has(x, f) ? lookField(looks[i], f) : undefined)).filter((v) => v !== undefined); return vs.every((v) => v === vs[0]) ? vs[0] : null; };
    const target = (d, x) => (x.kind === 'drawing' ? d : find(d, x.el.id).el);
    // live: shown as it changes (a colour being picked), the undo step made when it is set
    const put = (f, v, live = false) => (live ? drawing.preview : drawing.change).call(drawing, (d) => { for (const x of xs) if (has(x, f)) setLook(target(d, x), f, v); });
    const above = xs.some((x) => x.kind === 'drawing') ? 'the default' : 'the drawing\'s';
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
    const dash = same('stroke.dash');
    return h('div', { class: 'fblock' }, h('h3', {}, title),
      both ? matrix() : null,
      !both && shown('stroke.color') ? row('Stroke', pair(colour('stroke.color', 'Stroke colour'), '·', num('stroke.opacity', 'Stroke opacity', 0, 1)), back('stroke.color', 'stroke.opacity')) : null,
      !both && shown('stroke.width') ? row('Width', pair([num('stroke.width', 'Stroke width (px)', ...STROKE_WIDTH), h('span', { class: 'funit' }, 'px')], '·', dashSelect()), back('stroke.width', 'stroke.dash')) : null,
      shown('text.size') ? row('Text size', segOf('Text size', [['small', 'S', 'Small'], ['medium', 'M', 'Medium'], ['large', 'L', 'Large']], same('text.size'), (v) => put('text.size', v)), back('text.size')) : null,
      shown('text.color') ? row('Text colour', pair(colour('text.color', 'Text colour'), 'on',
        segOf('Background', [['halo', 'Halo', 'A white halo round the letters'], ['box', 'Box', 'A white box with a border in the text\'s colour']], same('text.background'), (v) => put('text.background', v))),
      back('text.color', 'text.background')) : null,
      shown('text.name') ? tick('text.name', xs.length > 1 || xs[0].kind === 'drawing' ? 'Names on map' : 'Name on map', 'Names are left out where they would collide; zooming in shows them') : null,
      shown('text.values') ? tick('text.values', 'Show values', 'Values on the map: each leg\'s length, an area\'s area and perimeter, each radius') : null,
      shown('offset') ? row('Offset', F.number(() => same('offset'), (v) => put('offset', v), 'Offset (px)', { min: -MAX_OFFSET, max: MAX_OFFSET, placeholder: 'mixed', bad: `pixels from −${MAX_OFFSET} to ${MAX_OFFSET}`,
        title: 'Drawn this many pixels beside its line, to the right of its direction (negative: left), as GIS tools offset a line: display only, lengths stay real' }), h('span', { class: 'funit' }, 'px'), back('offset')) : null,
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
    return row('Group', select('Group', [['', 'none'], ...fits.map((g) => [g.id, groupPath(g)])], same === undefined ? null : same ?? '', (v) => {
      drawing.change((d) => { for (const id of ids) setGroup(d, id, v || null); });
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
  // every inspector's top (its title, kind · name, in the head): the rule that made it, its name, the
  // group it is in
  const commonTop = (kind, id) => {
    const el = now(id);
    title = `${kindTitle(kind, el)} · ${label(kind, el)}`;
    return [...(ruleRow(id) ?? []), row('Name', textField(id, 'name', 'Name')), groupRow([id])];
  };
  // and its foot: its data, Guide and Visible (Delete: in the head)
  const commonBottom = (kind, id) => {
    const el = now(id);
    // Guide (supporting geometry: faint, out of the totals): a measurement is a guide showing its
    // values; unticking Guide makes it part of the drawing
    const flags = ['point', 'line', 'area'].includes(kind) ? [check('Guide', el.guide, (v) => set(id, (x) => { x.guide = v; }), { title: 'Supporting geometry: drawn faint and dashed, left out of the totals' })] : [];
    return [dataBlock(id), flags.length ? h('div', { class: 'frow fend' }, ...flags) : null];
  };

  // A point's parts, each named by its place in the list: its kind (changing it keeps its reach), its
  // name, Fill, Shown, its own stroke, ×; its size (a radius, a sector's aperture; an outline's length
  // and width, its area). "+ Part" adds one.
  function partsBlock(id) {
    const el = now(id), u = ctx.units();
    const fits = (m) => drawable(now(id), m);
    const at = (i, fn) => drawing.change((d) => { fn(find(d, id).el.parts[i]); reattach(d, id); }); // part i as it is now; what points at its corners stays where it was
    // a part as another kind, its reach kept: a round one's radius, an outline's half length
    const asKind = (part, kind) => {
      const reach = part.radius ?? part.length / 2;
      const next = makePart(kind, ROUND.includes(kind) ? { radius: reach, aperture: part.aperture } : { length: 2 * reach, width: part.width ?? reach });
      return { ...next, fill: part.fill, shown: part.shown, name: part.name };
    };
    const adder = (aria, text) => select(aria, [['', text], ...PART_KINDS.map((k) => [k, PART_NAME[k]])], '', (k) => { if (k) set(id, (x) => addPart(x, k)); }, { title: 'A circle, a sector or an outline about the point, to scale' });
    const box = (i, key, aria) => check('', el.parts[i][key], (v) => at(i, (y) => { y[key] = v; }), { 'aria-label': `Part ${i + 1} ${aria}` });
    const dist = (i, key, aria) => distField(() => now(id).parts[i][key], (m) => at(i, (y) => { y[key] = m; }), aria, (m) => (m >= MAX_RADIUS || (key === 'radius' && !fits(m)) ? 'too large' : null));
    // its size, a pair: a round part's radius (a sector's aperture beside it), an outline's length × width
    const size = (part, i) => (part.radius
      ? (part.kind === 'sector' ? pair(dist(i, 'radius', `Part ${i + 1} radius`), '·', angleField(() => now(id).parts[i].aperture, (v) => at(i, (y) => { y.aperture = v; }), `Part ${i + 1} aperture (degrees): centred on the bearing`, 0, 360, false)) : dist(i, 'radius', `Part ${i + 1} radius`))
      : Object.assign(pair(dist(i, 'length', `Part ${i + 1} length`), '×', dist(i, 'width', `Part ${i + 1} ${WIDTH_NAME[part.kind] || 'width'}`)),
        { title: `Its area: ${fmtArea(areaOf(outlineOf(el.position, el.bearing, part.length, part.width, part.kind).ring), u)}` }));
    const kind = (part, i) => select(`Part ${i + 1} kind`, PART_KINDS.map((k) => [k, PART_NAME[k]]), part.kind, (v) => drawing.change((d) => { const x = find(d, id).el; x.parts[i] = asKind(x.parts[i], v); reattach(d, id); }));
    const removeAt = (i) => drawing.change((d) => { removePartOf(d, id, i); reattach(d, id); });
    const table = listGrid({ name: `${id}:parts`,
      columns: [{ head: '', width: 22, frozen: true, cls: 'num' }, { head: 'Kind', width: 108, frozen: true }, { head: 'Size', width: 176, title: 'A radius (a sector: and its aperture), or a length × a width' },
        { head: 'Fill', width: 52 }, { head: 'Shown', width: 52 }, { head: 'Name', width: 110 }],
      rows: el.parts.map((part, i) => ({ cells: [`${i + 1}`, kind(part, i), size(part, i), box(i, 'fill', 'filled'), box(i, 'shown', 'shown'),
        field(() => part.name, (t) => t, (v) => at(i, (y) => { y.name = v; }), { 'aria-label': `Part ${i + 1} name`, placeholder: 'name' })],
      cls: part.radius && !fits(part.radius) ? 'warn' : null })),
      add: [null, adder('Add a part', 'add a part…'), null, null, null, null],
      actions: (i) => ({ label: `Part ${i + 1}`, buttons: [act('Distribute along it…', 'Copies placed round this part; they follow it', () => openDistribution({ element: id, part: i })), act('Delete', 'Take this part away (Ctrl/⌘ Delete)', () => removeAt(i))] }),
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
      mainOutline(el) ? null : row('Symbol', segOf('Symbol (the same size on screen at every zoom)', SYMBOLS.map((sy) => [sy, sy === 'none' ? '∅' : icon(...SYMBOL_ICON[sy]), SYMBOL_TITLE[sy]]), el.symbol, (sy) => set(id, (x) => { x.symbol = sy; }))),
      partsBlock(id),
      el.parts.length ? row('', h('button', { type: 'button', class: 'small', title: 'Copies placed round one of its parts: a circle\'s whole round, a sector\'s arc, an outline; they follow it, and can be connected to roots',
        onclick: () => openDistribution({ element: id, part: null }) }, 'Distribute along…')) : null,
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
    const insertAt = (i) => drawing.change((doc) => { const x = find(doc, id).el, q = x.points[i], r = x.points[(i + 1) % x.points.length]; insertCorner(doc, x, i + 1, along(q, r, 0.5)); });
    const drop = (i) => { if (n > 3) drawing.change((doc) => removeCorner(doc, find(doc, id).el, i)); };
    const pg = paged(`${id}:corners`, n), abs = (r) => pg.rows[r];
    const table = listGrid({ name: pg.name,
      columns: [{ head: '', width: 26, frozen: true, cls: 'num' }, { head: 'Lat', width: 100, frozen: true }, { head: 'Lon', width: 100, frozen: true },
        { head: 'Edge', width: 104, title: 'The straight edge from the corner before: its length (typed: this corner and those after it move together; the closing edge follows)' },
        { head: 'Brg °', width: 72, title: 'The edge\'s bearing, degrees true' }],
      rows: pg.rows.map((i) => ({ cells: [`${i + 1}`, corner(i, 'lat'), corner(i, 'lon'), ...(i ? legFields(id, (x) => x.points, i, setAreaEdge, 'Edge') : [null, null])] })),
      actions: (r, i = abs(r)) => ({ label: `Corner ${i + 1}`, buttons: [act('Insert after', 'A corner halfway to the next (Insert)', () => insertAt(i)), act('Delete', 'Take this corner away (Ctrl/⌘ Delete); three are kept', () => drop(i), n <= 3)] }),
      keys: { insert: (r) => insertAt(abs(r)), remove: (r) => drop(abs(r)) } });
    const cornerRows = () => { const ps = now(id).points; return [['#', 'Lat', 'Lon', 'Edge m', 'Brg °'], ps.map((q, i) => { const g = i ? legOf(ps, i) : null; return [i + 1, q[1], q[0], g ? +g.s.toFixed(3) : '', g ? +g.azi.toFixed(1) : '']; })]; };
    return [...commonTop('area', id),
      row('Area', h('span', { class: 'fvalue' }, fmtArea(areaOf(pathOf(el.points, true)), u))),
      row('Perimeter', h('span', { class: 'fvalue' }, fmtDist(perimeterOf(el.points), u))),
      h('div', { class: 'fblock' }, h('h3', {}, `Corners (${n})`, copyBtn(cornerRows)), table, pg.pager),
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
    return [row(text, link(on.el.id), partName(r) ? h('span', { class: 'funit' }, partName(r)) : null,
      h('button', { type: 'button', class: 'x', title: 'Detach: keep it where it is, no longer following what it is attached to', 'aria-label': `Detach ${text.toLowerCase()}`, onclick: () => set(id, (x) => { x[key] = freeRef(x[key]); }) }, icon(...UI_ICON.detach))), row('', attach)];
  }

  // a label: its text (with live values), what it points at, its leader and its look
  const TOKEN_TEXT = { name: ['name', 'The name of what it points at'], length: ['length', 'The length of the line it points at, or of the side'],
    along: ['distance along', 'The distance along the line to where it points'], bearing: ['bearing', 'The bearing of the side or leg it points at'],
    radius: ['radius', 'The point\'s filled radius'], area: ['area', 'The area of the area or shape'], perimeter: ['perimeter', 'The perimeter of the area or shape'] };
  function labelInspector(id) {
    const doc = drawing.doc, el = now(id), u = ctx.units();
    const at = resolve(doc, el.anchor), values = labelValues(doc, el.anchor, u);
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
    const alongRow = onLine ? row('Along', F.dist(() => at.along, (m) => drawing.change((d) => { const a = find(d, id).el; a.anchor = lineRef(d, find(d, a.anchor.element).el, m); }), 'Distance along', { zero: true,
      title: `From its start, of ${fmtDist(at.length, u)}` })) : null;
    return [...commonTop('label', id),
      row('Text', text),
      tokens.length ? row('', ...tokens.map((k) => h('button', { type: 'button', class: 'small', title: `Insert, a live value: ${TOKEN_TEXT[k][1].toLowerCase()} (it follows edits and the units)`, onclick: () => insert(`{${k}}`) }, `+ ${TOKEN_TEXT[k][0]}`))) : null,
      ...[refRow(el.anchor.element ? 'Attached to' : 'Position', id, 'anchor')].flat(), alongRow,
      leaderRow([item(id)]), lookBlock([item(id)]),
      row('Placement', h('span', { class: 'fvalue', title: 'Pixels from its point: drag its text on the map' }, `${el.offset[0]}, ${el.offset[1]} px`),
        h('button', { type: 'button', class: 'x', title: 'Back to where a new label goes', 'aria-label': 'Placement back to where a new label goes', onclick: () => set(id, (x) => { x.offset = x.anchor.element ? [...LABEL_OFFSET] : [0, 0]; }) }, '↺')),
      ...commonBottom('label', id)];
  }

  // labels' leader: where the line from the text to its point ends (one or several labels)
  function leaderRow(xs) {
    const vs = xs.map((x) => x.el.leader), v = vs.every((x) => x === vs[0]) ? vs[0] : null;
    return row('Leader', segOf('Leader', LEADERS.map((k) => [k, { arrow: 'Arrow', dot: 'Dot', line: 'Line', none: 'None' }[k], { arrow: 'A line to its point, an arrow head there', dot: 'A line to its point, a dot there', line: 'A line to its point', none: 'No line' }[k]]),
      v, (k) => drawing.change((d) => { for (const x of xs) find(d, x.el.id).el.leader = k; })));
  }

  // a line: its ends (each attached to a point, or free), length, curve, the table of its vertices
  // (lat, lon, leg, name, distance from its start)
  // Legs typed (the line's vertex table, the polygon's corner table): the straight leg arriving at a
  // place, its length and its bearing. A value typed moves that place and every one after it together
  // (the legs after it keep their lengths and bearings); a line's end attached stays attached.
  const legOf = (ps, k) => { const g = inverse(ps[k - 1], ps[k]); return { s: g.s, azi: norm360(g.azi) }; };
  const legTo = (ps, k, { s: len, azi }) => { const g = legOf(ps, k); return destination(ps[k - 1], azi ?? g.azi, len ?? g.s); };
  function setLineLeg(x, k, v) {
    const ps = positionsOf(x), from = ps[k], to = legTo(ps, k, v);
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
  // an element's places, read once per rendering of the inspector (each row's leg reads them)
  const placesRead = new Map();
  const placesNow = (id, places) => { if (!placesRead.has(id)) placesRead.set(id, places(now(id))); return placesRead.get(id); };
  const legFields = (id, places, k, put, what) => [
    distField(() => legOf(placesNow(id, places), k).s, (m) => set(id, (x) => put(x, k, { s: m })), `${what} ${k} length`),
    angleField(() => +legOf(placesNow(id, places), k).azi.toFixed(1), (a) => set(id, (x) => put(x, k, { azi: a })), `${what} ${k} bearing (degrees true)`, 0, 360, true)];
  // A long list a page at a time (drawing-ui.md §5): PAGE rows, from the page shown (each list's own,
  // this session), and ‹ › under it; Copy still takes every row. rows: the absolute rows
  // shown, in order.
  const PAGE = 100, pageAt = new Map();
  function paged(name, total) {
    const from = Math.min(pageAt.get(name) ?? 0, Math.max(0, total - 1) - (Math.max(0, total - 1) % PAGE)), to = Math.min(total, from + PAGE);
    const go = (f) => { pageAt.set(name, f); renderInspector(); };
    const pager = total > PAGE ? h('div', { class: 'lpager' },
      h('button', { type: 'button', class: 'small', 'aria-label': 'Previous rows', disabled: !from, onclick: () => go(from - PAGE) }, '‹'),
      h('span', { class: 'funit' }, `${from + 1}–${to} of ${total}`),
      h('button', { type: 'button', class: 'small', 'aria-label': 'Next rows', disabled: to >= total, onclick: () => go(from + PAGE) }, '›')) : null;
    return { rows: Array.from({ length: to - from }, (_, k) => from + k), pager, name: `${name}@${from}` };
  }
  // a row action's button, in a list grid's bar
  const act = (text, title, onclick, disabled = false) => h('button', { type: 'button', class: 'small', title, disabled, onclick }, text);
  // a list's Copy: its rows (rows(): [head, rows]) as text a spreadsheet takes, every column
  const copyBtn = (rows) => h('button', { type: 'button', class: 'small', title: 'Copy the rows, tab-separated, a header first: they paste into a spreadsheet', onclick: () => {
    const [head, body] = rows();
    navigator.clipboard?.writeText(rowsText(head, body)).then(() => note(`${plural(body.length, 'row')} copied`), () => note('This browser did not let them be copied'));
  } }, 'Copy');

  // ---- a line's depth profile (profile.js): read when its Profile button is pressed, read again as
  // the line changes; pointing at the chart shows the place on the map, pointing at the line on the
  // map shows it on the chart
  const profiles = new Map(); // line id → { key (its trace), prof (null while being read), failed }
  const profileShown = new Set();
  let profileCursor = null; // (d: metres along, or null) → the chart's cursor there
  const W = 360, H = 110;
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
    const line = lineTrace(doc, el);
    const at = line.at;
    const endOf = (e) => (e.element ? link(e.element) : h('span', { class: 'funit' }, 'free'));
    const leg = (k) => legFields(id, positionsOf, k, setLineLeg, 'Leg');
    const insertAfter = (i) => drawing.change((doc) => {
      const x = find(doc, id).el, ps = positionsOf(x), a = ps[i + 1], b = ps[i + 2];
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
    const vertexRows = () => { const x = now(id), ps = positionsOf(x), t = lineTrace(drawing.doc, x).at;
      return [['#', 'Lat', 'Lon', 'Leg m', 'Brg °', 'Name', 'Along m'], ps.map((q, i) => { const g = i ? legOf(ps, i) : null; return [i === 0 ? 'start' : i === ps.length - 1 ? 'end' : i, q[1], q[0], g ? +g.s.toFixed(3) : '', g ? +g.azi.toFixed(1) : '', x.vertices[i - 1]?.name ?? '', +(t[i] || 0).toFixed(3)]; })]; };
    const removeAt = (i) => drawing.change((doc) => removeVertex(doc, find(doc, id).el, i));
    const splitAt = (i) => { let p; drawing.change((d) => { p = splitKeeping(d, id, i); }); note(`Split: both parts attached to ${label('point', p)}`); };
    // its places as rows, by place: 0 its start (◂), 1…n its vertices, n + 1 its end (▸); a page of them shown
    const pg = paged(`${id}:vertices`, n + 2), abs = (r) => pg.rows[r];
    const rowAt = (k) => (k === 0 ? { cls: 'vnode', cells: ['◂', ...endCells('start'), null, null, null, along(0)] }
      : k === n + 1 ? { cls: 'vnode', cells: ['▸', ...endCells('end'), ...leg(n + 1), null, along(at.length - 1)] }
        : ((i) => ({ cells: [`${i + 1}`, coord(i, 'lat'), coord(i, 'lon'), ...leg(i + 1),
          field(() => now(id).vertices[i].name, (t) => t, (nv) => set(id, (x) => { x.vertices[i].name = nv; }), { 'aria-label': `Vertex ${i + 1} name` }), along(i + 1)] }))(k - 1));
    const table = listGrid({ name: pg.name,
      columns: [{ head: '', width: 26, frozen: true, cls: 'num' }, { head: 'Lat', width: 100, frozen: true }, { head: 'Lon', width: 100, frozen: true },
        { head: 'Leg', width: 104, title: 'The straight leg from the place before: its length (typed: this place and those after it move together)' },
        { head: 'Brg °', width: 72, title: 'The leg\'s bearing, degrees true' }, { head: 'Name', width: 110 }, { head: 'Along', width: 84, cls: 'num', title: 'The distance from its start' }],
      rows: pg.rows.map(rowAt),
      actions: (rr, r = abs(rr)) => (r === 0 ? { label: 'Start', buttons: [act('Insert after', 'A vertex halfway to the next (Insert)', () => insertAfter(-1))] }
        : r <= n ? { label: `Vertex ${r}`, buttons: [act('Insert after', 'A vertex halfway to the next (Insert)', () => insertAfter(r - 1)),
          act('Delete', 'Take this vertex away (Ctrl/⌘ Delete)', () => removeAt(r - 1)), act('Split', 'Split the line here: this vertex becomes a point both parts are attached to', () => splitAt(r - 1))] } : null),
      keys: { insert: (rr) => { const r = abs(rr); if (r <= n) insertAfter(r - 1); }, remove: (rr) => { const r = abs(rr); if (r >= 1 && r <= n) removeAt(r - 1); } } });
    const off = el.look.offset ?? null, offNow = offsetOf(drawing.doc, el);
    return [...commonTop('line', id),
      ...[refRow('Start', id, 'start'), refRow('End', id, 'end')].flat(),
      row('Length', h('span', { class: 'fvalue' }, fmtDist(line.length, u))),
      offNow && off == null ? h('p', { class: 'note' }, `Drawn ${Math.abs(offNow)} px to the ${offNow > 0 ? 'right' : 'left'} of its line, the drawing's Offset. Its length is the real one.`) : null,
      profileBlock(id),
      row('Legs', segOf('Legs', [[false, 'Straight', 'Geodesics, as measured'], [true, 'Smooth', 'A curve through its bends, following them; its length measured along it']], !!el.smooth, (v) => set(id, (x) => { x.smooth = v; }))),
      row('', h('button', { type: 'button', class: 'small', title: 'Copies placed along this line, every so far or so many, which then follow it; they can be connected to roots', onclick: () => openDistribution({ element: id, part: null }) }, 'Distribute along…')),
      h('div', { class: 'fblock' }, h('h3', { title: 'Where the line runs: its start (◂), its vertices (1, 2…), its end (▸). Along: the distance from the start. Click a row for what can be done with it (under the table).' }, `Vertices (${el.vertices.length})`, copyBtn(vertexRows)),
      table, pg.pager), // wider than the panel: it scrolls sideways, its first columns kept
      lookBlock([item(id)]), ...commonBottom('line', id)];
  }

  function groupInspector(id) {
    const doc = drawing.doc, u = ctx.units();
    const direct = membersOf(doc, id), subs = direct.filter((x) => x.kind === 'group').length;
    const below = membersOf(doc, id, true).filter((x) => x.kind !== 'group'); // everything in it, its subgroups' too
    const t = fx().totals.groups.get(id), shownEye = eyeFor(() => membersOf(drawing.doc, id, true), 'members');
    shownEye.render();
    return [...commonTop('group', id),
      row('Members', h('span', { class: 'fvalue' }, [`${direct.length - subs}`, subs ? plural(subs, 'group') : ''].filter(Boolean).join(' · ')), direct.length ? shownEye : null),
      row('', h('button', { type: 'button', class: 'small', title: 'Everything in it, its groups\' too', disabled: !below.length, onclick: () => drawing.select(below.map((x) => x.el.id)) }, 'Select members')),
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

  // a new group of ids, in the nearest group they are all in; it is selected
  function groupThem(ids) { let g; drawing.change((doc) => { g = makeGroup(doc, ids); }); drawing.select([g.id]); }
  function severalInspector(xs) {
    const counts = {};
    for (const x of xs) counts[x.kind] = (counts[x.kind] || 0) + 1;
    const ids = xs.map((x) => x.el.id);
    const pointIds = xs.filter((x) => x.kind === 'point').map((x) => x.el.id);
    // two points: how far apart, and the bearing from the first to the second
    const between = xs.length === 2 && xs.every((x) => x.kind === 'point') ? inverse(xs[0].el.position, xs[1].el.position) : null;
    title = `${xs.length} elements selected`;
    return [chips(xs),
    h('p', { class: 'note' }, Object.entries(counts).map(([k, n]) => plural(n, kindName(k).toLowerCase())).join(', ')),
    between ? row('Distance', h('span', { class: 'fvalue' }, fmtDist(between.s, ctx.units()))) : null,
    between ? row('Bearing', h('span', { class: 'fvalue', title: `From ${label(xs[0].kind, xs[0].el)}` }, fmtBrg(between.azi))) : null,
    pointIds.length > 1 ? h('div', { class: 'frow fbuttons' },
      h('button', { type: 'button', title: 'Join these points to roots with straight lines: trees through hubs, or chains', onclick: () => openConnect(pointIds) }, 'Connect…')) : null,
    groupRow(ids),
    xs.some((x) => x.kind === 'label') ? leaderRow(xs.filter((x) => x.kind === 'label')) : null,
    lookBlock(xs),
  ];
  }

  const treesOf = (c, n) => `${n} ${c.pattern === 'chain' ? 'chain' : 'tree'}${n === 1 ? '' : 's'}`;
  const copies = (n) => `${n} ${n === 1 ? 'copy' : 'copies'}`;
  // The rule an element was made by (generator.js ruleOf: a copy, a hub, a line, the rule's groups), as
  // a row: what it made, Edit… (its form: a distribution's, with its connection; a connection's on points
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
    return [row('Made by', h('span', { class: 'fvalue', title: text }, text)),
      row('', h('button', { type: 'button', class: 'small', title: 'Its settings: the same number of copies moves them, another makes them anew', disabled: a && !along, onclick: () => (a ? openDistribution(a.along, a) : openConnect(c.pointIds, c)) }, 'Edit…'),
        h('button', { type: 'button', class: 'small', title: 'Everything it made', onclick: all }, 'Select all'))];
  }

  // ---- the tools' forms (generator.js): Distribute along a line or an arc, connected to roots or not;
  // Connect, for points placed by hand ----------------------------------------------------------------
  // form: { kind: 'distribute', along (a reference: the line, or the point), distributionId, connectionId } or
  // { kind: 'connect', pointIds, connectionId }
  // (an id: the one edited or made again, or null), and the selection it was opened with (another
  // closes it)
  let form = null;
  const dform = { by: 'spacing', spacing: 1000, count: 10, startMargin: 0, endMargin: 0, offset: 0, side: 'left', radius: COPY_RADIUS, aperture: null, part: null, preset: 'circle', copy: null, groupId: null, connect: false };
  const con = { pattern: 'tree', groupSize: 'auto', minBranch: 0, roots: [], newRoots: [] };
  const dformParams = () => ({ spacing: dform.spacing, count: dform.by === 'count' ? dform.count : null, startMargin: dform.startMargin, endMargin: dform.endMargin, offset: dform.offset, side: dform.side, radius: dform.radius, aperture: dform.aperture, preset: dform.preset, copy: dform.copy, groupId: dform.groupId,
    along: form && { element: form.along.element, part: dform.part } });
  const conParams = () => ({ pattern: con.pattern, groupSize: con.groupSize, minBranch: con.minBranch, roots: con.roots.map((r) => ({ ...r })), newRoots: con.newRoots.map((q) => [...q]) });
  const fromConnection = (c) => (c ? { pattern: c.pattern, groupSize: c.groupSize, minBranch: c.minBranch, roots: c.roots.map((r) => ({ ...r })) } : { roots: [] });
  const selKey = () => [...drawing.sel].sort().join(' ');
  // roots are picked on the map while the form connects
  const picks = () => form && (form.kind === 'connect' || dform.connect);
  function openForm(f) {
    form = { ...f, sel: selKey() };
    drawing.setPicking(picks() ? pick : null);
    formPreview();
    renderInspector();
  }
  function openDistribution(along, a = null) {
    const c = a && connectionOn(drawing.doc, a);
    dform.part = along.part ?? null; // a new one: the part followed by default
    if (a) Object.assign(dform, { by: a.count ? 'count' : 'spacing', spacing: a.spacing || dform.spacing, count: a.count || a.points.length, startMargin: a.startMargin, endMargin: a.endMargin,
      offset: a.offset, side: a.side, radius: a.radius, aperture: a.aperture, preset: a.preset ?? 'circle', copy: a.copy });
    dform.connect = !!c;
    Object.assign(con, fromConnection(c), { newRoots: [] });
    openForm({ kind: 'distribute', along: { element: along.element, part: along.part ?? null }, distributionId: a?.id ?? null, connectionId: c?.id ?? null });
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
  const distributionRun = () => distribute(drawing.doc, alongOf(drawing.doc, form.along.element), { ...dformParams(), part: dform.part });
  const distributionPoints = () => distributionRun().points, distributionCapped = () => distributionRun().capped;
  // the points being connected: the form's (Connect), or the distribution's being edited
  const formPointIds = () => (form.kind === 'connect' ? form.pointIds : distributions(drawing.doc).find((a) => a.id === form.distributionId)?.points.map((x) => x.pointId) ?? []);
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
    const positions = distributionPoints().map((x) => x.position), roots = rootsNow();
    return { positions, roots, plan: dform.connect && positions.length && roots.length ? plan(positions, roots, con.groupSize, con.pattern, con.minBranch) : null };
  };
  // what the form would make, faint on the map: the points; the lines, the roots ringed
  function formPreview() {
    const c = connectPlan(), joined = form.kind === 'connect' || dform.connect;
    drawing.setPreview(form.kind === 'distribute' ? c.positions : [], joined ? c.roots.map((r) => r.position) : [], c.plan ? lines(c.positions, c.roots, c.plan, con.pattern) : []);
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
      row('Group size', pair(segOf('Group size', [['auto', 'Auto', `any size: the cheapest cut${con.pattern === 'tree' ? ` (trees of up to ${MAX_TREE})` : ''}`], ['set', 'Set', `points at most per ${what}`]], con.groupSize === 'auto' ? 'auto' : 'set', (v) => { con.groupSize = v === 'auto' ? 'auto' : 3; redo(); }), '',
        con.groupSize === 'auto' ? [] : F.number(() => con.groupSize, (v) => { con.groupSize = v; redo(); }, 'Group size', { whole: true, above: true, max: con.pattern === 'tree' ? MAX_TREE : Infinity, title: `Points at most per ${what}${con.pattern === 'tree' ? ` (up to ${MAX_TREE})` : ''}` }))),
      con.pattern === 'tree' ? row('Min. branch', F.dist(() => con.minBranch, (m) => { con.minBranch = m; redo(); }, 'Shortest branch', { zero: true,
        title: 'Each hub at least this far from its points and from its root. 0: where the lines are shortest, on a point if need be' })) : null,
      h('div', { class: 'fblock' }, h('h3', {}, `Roots (${c.roots.length})`),
        h('p', { class: 'note' }, 'Click the map for a new root, or a point to use it; again, or ×, drops it. A weight above 1 pulls groups to it.'),
        names.map((name, k) => h('div', { class: 'frow' }, k < con.roots.length ? link(con.roots[k].id) : h('span', { class: 'fvalue' }, `${name}: ${con.newRoots[k - con.roots.length][1].toFixed(5)}, ${con.newRoots[k - con.roots.length][0].toFixed(5)}`),
          h('span', { class: 'funit' }, 'weight'), weight(k),
          h('button', { type: 'button', class: 'x', 'aria-label': `Drop ${name}`, onclick: drop(k) }, '×')))),
      h('p', { class: 'note fsummary' }, summary, unused.length ? ` Not used: ${unused.join(', ')} (no group is cheapest from it; a weight above 1 would pull some).` : '')];
  }
  const sameConnection = (c) => c && c.pattern === con.pattern && c.groupSize === con.groupSize && c.minBranch === con.minBranch && !con.newRoots.length
    && c.roots.length === con.roots.length && c.roots.every((o) => con.roots.some((r) => r.id === o.id && r.weight === o.weight));

  // Distribute along a line or a point's arc, and its connection to roots: one form, one undo step
  function distributionForm() {
    const doc = drawing.doc, along = find(doc, form.along.element), editing = form.distributionId && distributions(doc).find((a) => a.id === form.distributionId);
    const tr = alongTrace(doc, along.el, dform.part), closed = tr?.closed;
    const c = connectPlan(), points = c.positions, redo = formChanged;
    // a distance that may be 0 (margins, the offset), or must be above 0 (spacing)
    const dist = (key, aria, zero) => F.dist(() => dform[key], (m) => { dform[key] = m; redo(); }, aria, { zero });
    const differs = editing && points.length !== editing.points.length;
    const was = form.connectionId && connections(doc).find((x) => x.id === form.connectionId);
    const ok = points.length && (!dform.connect || c.plan);
    // what is repeated: a built-in kind (the circle to start with), or a preset of the user's (its size its own)
    const mine = drawing.presets.filter((x) => x.point.parts.length);
    const choose = (v) => {
      dform.preset = v;
      const pre = v.startsWith('preset:') && mine.find((x) => `preset:${x.name}` === v);
      dform.copy = pre ? { symbol: pre.point.symbol, parts: structuredClone(pre.point.parts) } : null;
      redo();
    };
    const reach = dform.copy ? Math.max(...dform.copy.parts.map((q) => q.radius ?? q.length / 2)) : null;
    const arc = along.kind === 'point';
    title = `${editing ? 'Edit, distributed along' : 'Distribute along'} ${label(along.kind, along.el)}`;
    return [
      arc && along.el.parts.length > 1 ? row('Part', select('Part', along.el.parts.map((part, i) => [i, `${i + 1} · ${PART_NAME[part.kind]}${part.name ? ` ${part.name}` : ''}`]), dform.part ?? followedPart(along.el), (v) => { dform.part = +v; redo(); })) : null,
      row('By', segOf('Points by', [['spacing', 'Spacing'], ['count', 'Count']], dform.by, (v) => { dform.by = v; redo(); })),
      dform.by === 'spacing' ? row('Spacing', dist('spacing', 'Spacing', false)) : row('Count', F.number(() => dform.count, (v) => { dform.count = v; redo(); }, 'Count', { whole: true, above: true, max: MAX_COPIES })),
      distributionCapped() ? h('p', { class: 'note warn' }, `At most ${MAX_COPIES.toLocaleString('en')} copies: the spacing would give more`) : null,
      closed ? null : row('Margins', pair(dist('startMargin', 'Start margin', true), '·', dist('endMargin', 'End margin', true))),
      row('Offset', pair(dist('offset', 'Offset', true), '', select('Side', [['left', arc ? 'Out' : 'Left'], ['right', arc ? 'In' : 'Right'], ['alternate', 'Alternate']], dform.side, (v) => { dform.side = v; redo(); }))),
      row('Copy', select('Copy', [...Object.keys(BUILT_IN).map((k) => [k, builtInName(k)]), ...mine.map((x) => [`preset:${x.name}`, x.name])], dform.preset, choose, { title: 'What each copy is: a built-in kind, or a preset of yours' })),
      dform.copy ? row('Radius', h('span', { class: 'fvalue', title: 'The preset\'s own size' }, fmtDist(reach, ctx.units())))
        : row('Radius', F.dist(() => dform.radius, (m) => { dform.radius = m; redo(); }, 'Radius', { check: (m) => (m >= MAX_RADIUS ? 'too large' : null), title: dform.preset === 'circle' ? 'Each circle\'s, whatever the spacing' : 'Its largest part\'s reach, whatever the spacing' })),
      dform.preset === 'circle' ? row('Sector', segOf('Sector', [[null, 'None', 'circles'], ...[90, 180, 270].map((a) => [a, `${a}°`, arc ? 'facing outwards' : 'facing away from the line'])], dform.aperture, (v) => { dform.aperture = v; redo(); })) : null,
      editing ? null : row('In group', select('Group', [['', 'none (at the top)'], ...doc.groups.map((g) => [g.id, groupPath(g)])], dform.groupId ?? '', (v) => { dform.groupId = v || null; }, { title: 'Where its own group goes' })),
      h('p', { class: 'note fsummary' }, points.length ? `${copies(points.length)}.` : `No copy fits: ${arc ? 'the part' : 'the line'} is shorter than the margins, or the spacing too long.`),
      differs ? h('p', { class: 'note warn' }, `Another number of points (${editing.points.length} now): they are made anew${was ? ', and connected again' : ''}. Changes made to those by hand are lost; Undo brings them back.`) : null,
      h('div', { class: 'fblock' }, h('h3', {}, check('Connect to roots', dform.connect, (v) => { dform.connect = v; redo(); }, { title: 'Straight lines from roots to the points, attached to them: Tree, through a hub (which then follows its points); Chain, point to point. The points are cut into groups along the line, each to the root it is cheapest from.' })),
      dform.connect ? connectRows(c) : null,
      was && dform.connect && !sameConnection(was) ? h('p', { class: 'note warn' }, 'Its lines and hubs are made again. Changes made to those by hand are lost; Undo brings them back.') : null,
      was && !dform.connect ? h('p', { class: 'note warn' }, 'Its lines and hubs go (its roots stay).') : null),
      formButtons(editing ? 'Apply' : 'Create', ok, () => {
        let r, k = null;
        drawing.change((d) => {
          r = editing ? editDistribution(d, editing.id, dformParams()) : makeDistribution(d, dformParams());
          const was2 = connections(d).find((x) => x.id === form.connectionId);
          if (!dform.connect) { if (was2) unconnect(d, was2.id); return; }
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
    title = `${editing ? 'Connect again' : 'Connect'} ${plural(c.positions.length, 'point')}`;
    return [editing ? h('p', { class: 'note warn' }, 'Its lines and hubs are made again; changes made to those by hand are lost (Undo brings them back).') : null,
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
    const groupName = (gid) => (gid ? groupPath(drawing.doc.groups.find((g) => g.id === gid)) : 'Not grouped');
    const keys = [...new Set(elements(drawing.doc).flatMap((x) => x.el.properties.map((p) => p.key)))].sort((a, b) => a.localeCompare(b));
    if (totalsBy && !keys.includes(totalsBy)) { totalsBy = ''; computeFacts(); } // its key gone
    const by = select('Totals by', [['', 'group'], ...keys.map((k) => [k, k])], totalsBy || '', (v) => { totalsBy = v; computeFacts(); renderInspector(); });
    const offsetElsewhere = elements(drawing.doc).filter((x) => x.el.look?.offset != null); // where Offset is set on an element
    title = 'Drawing'; // its title: the tree's head
    return [row('Title', meta('title', 'Title')), row('Description', meta('description', 'Description', true)), row('Author', meta('author', 'Author')),
      lookBlock([{ kind: 'drawing', el: drawing.doc }], ['text.name', 'offset', 'minSize'], 'Display', [
        offsetElsewhere.length ? h('p', { class: 'note' }, 'Offset also set on ', ...offsetElsewhere.map((x) => link(x.el.id))) : null,
        row('Bearings', check('beside lengths', ctx.display.bearings, (v) => ctx.setDisplay({ bearings: v }), { title: 'Each leg\'s bearing (°T) beside its length, where values are shown' }))]),
      n > 1 ? totalsBlock(keys.length ? by : null, groupName) : null,
      drawing.saving.failed ? h('p', { class: 'note warn' }, 'This browser does not let the drawing be saved (storage full or turned off): Export drawing (GeoJSON), in the drawings menu, keeps it as a file.') : null,
      drawing.saving.otherTab ? h('p', { class: 'note warn' }, 'The drawing was changed in another tab. Saving here replaces that version. ', h('button', { type: 'button', class: 'small', onclick: () => location.reload() }, 'Reload')) : null];
  }
  // The Totals view (docs/drawing-ui.md §5): the lines by group (or by a property's values), each
  // listed under its group, those a connection made summed by what they are (trunks and branches; a
  // chain's root links and the links between points); the areas; the points by kind. A group's rows
  // fold; Copy gives every row tab-separated, in metres, for a spreadsheet
  const MADE_PART = { trunk: 'trunks, root → hub', branch: 'branches, hub → point', 'root link': 'root → first point', link: 'between points' };
  function totalsBlock(by, groupName) {
    const b = fx().breakdown, u = ctx.units(), doc = drawing.doc;
    // a group holding a connection: its pattern and roots beside the name (two are both "Connection")
    const made = (k) => { const c = k && connections(doc).find((x) => x.groupId === k); return c ? ` (${c.pattern}, from ${c.roots.map((r) => label('point', now(r.id))).join(', ')})` : ''; };
    const keyName = (k) => (totalsBy ? (k ? `“${k}”` : `No ${totalsBy}`) : groupName(k) + made(k));
    const td = (x, cls = '') => h('td', { class: cls }, x), num = (x) => td(x, 'num');
    // a row that acts (folds a group, selects an element): the whole row the target, by pointer or keys
    const acts = (cls, title, fn, ...cells) => h('tr', { class: `${cls} acts`, role: 'button', tabindex: 0, title, onclick: fn, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } } }, ...cells);
    const sec = (title, ...heads) => h('tr', { class: 'sec' }, td(title), ...heads.map((x) => num(x)));
    const rows = [], copy = []; // copy: [section, group, name, count, length m, area m², perimeter m]
    const nameOf = (kind, id) => label(kind, find(doc, id).el);
    const lineRows = [...b.lines.rows].sort((p, q) => (!p.key) - (!q.key) || keyName(p.key).localeCompare(keyName(q.key)));
    const one = lineRows.length === 1 && !lineRows[0].key && !totalsBy; // nothing grouped: no group rows (by a property, the row says "No …")
    if (b.lines.count) {
      rows.push(sec('Lines', '', 'Length'));
      for (const r of lineRows) {
        const folded = totalsFolded.has(r.key), g = one ? '' : keyName(r.key);
        if (!one) {
          rows.push(acts('grp', folded ? 'Show its lines' : 'Fold its lines', () => { totalsFolded[folded ? 'delete' : 'add'](r.key); renderInspector(); }, td(`${folded ? '▸' : '▾'} ${g}`), num(plural(r.count, 'line')), num(fmtDist(r.length, u))));
          copy.push(['Lines', g, '', r.count, r.length, '', '']);
        }
        for (const p of r.parts) { if (!folded) rows.push(h('tr', { class: one ? 'part top' : 'part' }, td(MADE_PART[p.part]), num(plural(p.count, 'line')), num(fmtDist(p.length, u)))); copy.push(['Lines', g, MADE_PART[p.part], p.count, p.length, '', '']); }
        for (const l of r.lines) { if (!folded) rows.push(acts(one ? 'item top' : 'item', 'Select it', () => drawing.select([l.id]), td(nameOf('line', l.id)), td(''), num(fmtDist(l.length, u)))); copy.push(['Lines', g, nameOf('line', l.id), 1, l.length, '', '']); }
      }
      rows.push(h('tr', { class: 'all' }, td('All lines'), num(plural(b.lines.count, 'line')), num(fmtDist(b.lines.length, u))));
      copy.push(['Lines', '', 'All lines', b.lines.count, b.lines.length, '', '']);
    }
    if (b.areas.count) {
      rows.push(sec('Areas', 'Area', 'Perimeter'));
      for (const a of b.areas.rows) { rows.push(acts('item top', 'Select it', () => drawing.select([a.id]), td(nameOf('area', a.id)), num(fmtArea(a.area, u)), num(fmtDist(a.perimeter, u)))); copy.push(['Areas', '', nameOf('area', a.id), 1, '', a.area, a.perimeter]); }
      rows.push(h('tr', { class: 'all' }, td('All areas'), num(fmtArea(b.areas.area, u)), num(fmtDist(b.areas.perimeter, u))));
      copy.push(['Areas', '', 'All areas', b.areas.count, '', b.areas.area, b.areas.perimeter]);
    }
    if (b.points.count) {
      rows.push(sec('Points', '', ''));
      for (const [k, c] of [...b.points.kinds].sort((p, q) => q[1] - p[1])) { const name = totalsBy ? keyName(k) : POINT_KIND_NAME[k] ?? OUTLINE_NAME[k] ?? k; rows.push(h('tr', { class: 'item top' }, td(name), num(String(c)), td(''))); copy.push(['Points', '', name, c, '', '', '']); }
      rows.push(h('tr', { class: 'all' }, td('All points'), num(String(b.points.count)), td('')));
      copy.push(['Points', '', 'All points', b.points.count, '', '', '']);
    }
    const hidden = b.lines.hidden || b.areas.hidden || b.points.hidden;
    const head = ['Section', totalsBy ? totalsBy : 'Group', 'Name', 'Count', 'Length (m)', 'Area (m²)', 'Perimeter (m)'];
    const r1 = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v);
    return h('div', { class: 'fblock' }, h('h3', {}, 'Totals', copyBtn(() => [head, copy.map((c) => c.map(r1))])),
      by ? row('By', by) : null,
      h('table', { class: 'vtable totals' }, h('tbody', {}, rows)),
      h('p', { class: 'note' }, `Guides and measurements are left out; lines running together each count${hidden ? '; hidden ones are counted' : ''}.`));
  }
  function renderInspector() {
    // a field being edited is applied first, to the element it belongs to
    if (inspector.contains(document.activeElement)) document.activeElement.blur();
    placesRead.clear();
    const xs = drawing.selected();
    if (form && selKey() !== form.sel) closeForm();
    const kids = form ? (form.kind === 'distribute' ? distributionForm() : connectForm()) : !xs.length ? drawingInspector()
      : xs.length > 1 ? severalInspector(xs)
        : { point: pointInspector, area: areaInspector, line: lineInspector, group: groupInspector, label: labelInspector }[xs[0].kind](xs[0].el.id);
    const top = inspector.scrollTop;
    inspector.replaceChildren(...kids.flat().filter(Boolean));
    inspector.scrollTop = top;
    renderHead(xs);
  }
  // The inspector's head (drawing-ui.md §5): what it shows, then Zoom to, Duplicate, Group and Delete
  // for the selection (with nothing selected, Zoom to all of it; none while a form is open).
  function renderHead(xs = drawing.selected()) {
    inspTitle.textContent = title;
    const ids = xs.map((x) => x.el.id), every = ids.length ? ids : elements(drawing.doc).map((x) => x.el.id);
    const act = (paths, aria, title, run) => h('button', { type: 'button', class: 'hact', 'aria-label': aria, title, onclick: run }, icon(...paths));
    inspActs.replaceChildren(...(form ? [] : [
      every.length ? act(UI_ICON.zoom, 'Zoom to', ids.length ? 'Zoom to: fit the map to it' : 'Zoom to: fit the map to the whole drawing', () => showOnMap(new Set(every))) : null,
      ids.length ? act(UI_ICON.duplicate, 'Duplicate', `Duplicate: a copy beside it (${MOD} D)`, () => { const n = drawing.duplicate(); if (n) note(`Duplicated: ${plural(n, 'element')}`, true); }) : null,
      ids.length ? act(UI_ICON.group, 'Group', 'Group: a new group of it, in the group it is in', () => groupThem(ids)) : null,
      ids.length ? act(UI_ICON.delete, 'Delete', 'Delete (Delete)', () => del(ids)) : null,
    ].filter(Boolean)));
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
  // The drawings menu (the rail's ☰): the drawings in this browser (the one open marked; each opened
  // where it was drawn, or deleted for good, asked first), + New, the file in and out, the view's outputs
  const drawingsMenu = h('div', { class: 'dmenu', role: 'menu', 'aria-label': 'Drawings in this browser', hidden: true });
  document.body.append(drawingsMenu);
  const drawings = popup(drawingsMenu, { choose: false, // the view's outputs say how they went in it, open meanwhile
    place: (b) => { const r = b.getBoundingClientRect(); Object.assign(drawingsMenu.style, { top: `${r.bottom + 4}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - 360))}px` }); },
  });
  const toggleDrawings = (b) => (drawingsMenu.hidden ? openDrawingsMenu(b) : drawings.close());
  const closeDrawingsMenu = () => drawings.close();
  function openDrawingsMenu(from) {
    const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
    const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const del = async (x) => {
      closeDrawingsMenu();
      if (!await ask('Delete the drawing', `Delete “${x.title || 'Untitled'}” for good? It cannot be brought back.`, [['yes', 'Delete']])) return;
      drawing.saving.remove(x.id);
      note('Drawing deleted');
    };
    const pick = (run) => () => { closeDrawingsMenu(); run(); };
    drawingsMenu.replaceChildren(h('ul', { class: 'drawings' }, drawing.saving.list().map((x) => h('li', { class: x.open ? 'open' : '' },
      h('button', { type: 'button', role: 'menuitem', class: 'dname', 'aria-current': x.open ? 'true' : null, title: x.open ? 'The drawing open' : 'Open it, where it was drawn',
        onclick: pick(() => { if (!x.open) ctx.openDrawing(x.id); }) }, x.title || 'Untitled'),
      h('span', { class: 'val' }, [when(x.modified), x.size ? kb(x.size) : ''].filter(Boolean).join(' · ')),
      h('button', { type: 'button', class: 'hact', 'aria-label': `Delete ${x.title || 'Untitled'}`, title: 'Delete for good', onclick: () => del(x) }, icon(...UI_ICON.delete))))),
    h('button', { type: 'button', role: 'menuitem', class: 'dnew', title: 'A new, empty drawing (this one stays in the list)', onclick: pick(newDrawing) }, '+ New drawing'),
    // the drawing's file, and the presets': in and out (a file dropped on the map is imported too)
    h('div', { class: 'dfile' },
      h('button', { type: 'button', role: 'menuitem', title: 'A drawing\'s file, any GeoJSON, or a presets file: a drawing is added to these and opened; presets join the Point and Shape tools', onclick: pick(() => fileInput.click()) }, 'Import…'),
      h('button', { type: 'button', role: 'menuitem', title: 'This drawing, with the view and layers, as a GeoJSON file to share or keep', onclick: pick(exportFile) }, 'Export drawing (GeoJSON)'),
      h('button', { type: 'button', role: 'menuitem', title: 'Your presets (the Point and Shape tools\' own) as a small file, to import them in another browser', onclick: pick(() => ctx.download(presetsFile(drawing.presets), 'presets.json')) }, 'Export presets (JSON)')),
    ...ctx.menuExtras(closeDrawingsMenu)); // the view's outputs and About
    drawings.open(from, true);
  }
  function newDrawing() {
    drawing.saving.add();
    note('New drawing');
  }
  async function importFile(f) {
    let text;
    try { text = await f.text(); } catch (e) { return note(`The file could not be read: ${e.message}`); }
    const presets = readPresets(text);
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
    const body = () => h('div', {},
      doc ? h('p', {}, counts.length ? `It holds ${counts.join(', ')}.` : 'It holds no elements.', doc.view ? ' Its view and layers will replace the current ones.' : '') : h('p', {}, report.refused),
      report.skipped.length ? [h('h3', {}, `Skipped (${report.skipped.length})`), list(report.skipped.map((s) => `${s.kind}${s.id ? ` ${s.id}` : ''}: ${s.reason}`))] : null,
      report.warnings.length ? [h('h3', {}, `Warnings (${report.warnings.length})`), list(report.warnings)] : null);
    const go = await dialog(doc ? `Import ${f.name}` : 'Not imported', body, doc ? [[true, 'Import']] : [], doc ? 'Cancel' : 'Close',
      doc ? h('p', { class: 'note' }, 'It is added to the drawings in this browser and opened; this one stays in the list.') : null);
    if (go) ctx.onImport(doc, report);
  }

  // ---- the divider between list and inspector ----------------------------------------------------
  const divider = h('div', { class: 'ddivider', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the list', tabindex: 0, title: 'Drag to resize the list' });
  const setSplit = (px) => {
    const v = Math.round(Math.max(80, Math.min(px, root.clientHeight - 160)));
    root.style.setProperty('--dlist-h', `${v}px`);
    store.set(SPLIT_KEY, String(v));
  };
  if (+store.get(SPLIT_KEY) > 0) root.style.setProperty('--dlist-h', `${+store.get(SPLIT_KEY)}px`);
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

  // The drawing's left frame (drawing-ui.md §1): the rail (ctx.strip) and the column (ctx.elements, root
  // in it), the tree over the inspector, each half folding to its head.
  const makes = toolBtns.filter((b) => b.dataset.tool !== 'measure'), measure = toolBtns.find((b) => b.dataset.tool === 'measure');
  ctx.strip.replaceChildren(fileBtn, sep(), selectBtn, sep(), ...makes, sep(), measure, sep(), undoBtn, redoBtn, h('span', { class: 'grow' }), colToggle, subrail);
  listHead.replaceChildren(docTitle, eyeAll, listFold);
  root.replaceChildren(listBox, divider, inspHead, inspector, noteEl, fileInput);
  function place() {
    root.classList.toggle('nolist', folds.list);
    root.classList.toggle('noinsp', folds.insp && !folds.list); // one half open at least
    listFold.setAttribute('aria-expanded', String(!folds.list));
    inspFold.setAttribute('aria-expanded', String(!(folds.insp && !folds.list)));
    ctx.elements.hidden = !elementsOpen;
    renderTools();
  }
  renderList(); // the tree's head with the drawing's title
  place();

  // ---- keys ----------------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const typed = typing(e.target); // a box ticked is no typing: the keys stay the drawing's
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      if (typed) return; // the field's own undo
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) drawing.redo(); else drawing.undo();
      return;
    }
    // copy, paste, duplicate (Ctrl/⌘ C, V, D): the selection's elements, not text being typed
    if (mod && !e.altKey && !typed && ['c', 'v', 'd'].includes(e.key.toLowerCase())) {
      const k = e.key.toLowerCase();
      if (k === 'c' && !drawing.sel.size) return; // nothing selected: the page's own copy
      e.preventDefault();
      const n = k === 'c' ? drawing.copy() : k === 'v' ? drawing.paste() : drawing.duplicate();
      if (n) note(`${k === 'c' ? 'Copied' : k === 'v' ? 'Pasted' : 'Duplicated'}: ${plural(n, 'element')}`, k !== 'c');
      return;
    }
    // the drawing order: Ctrl/⌘ ] one step up (drawn above), [ one step down, among its kind in its group
    if (mod && !typed && (e.key === ']' || e.key === '[') && drawing.sel.size) {
      e.preventDefault();
      const dir = e.key === ']' ? -1 : 1, ids = shown().map((x) => x.el.id).filter((id) => drawing.sel.has(id));
      drawing.change((doc) => { for (const id of dir < 0 ? ids : ids.reverse()) moveStep(doc, id, dir); });
      return;
    }
    // deleting: Delete; on a Mac, whose delete key is Backspace, ⌘-Backspace as in the Finder. Never
    // Backspace alone, which takes back a point while drawing (here and in Measure)
    if (!typed && (e.key === 'Delete' || (mac && e.metaKey && e.key === 'Backspace')) && drawing.sel.size) { e.preventDefault(); del([...drawing.sel]); return; }
    if (typed || mod || e.altKey) return;
    const ids = shown().map((x) => x.el.id); // the tools' keys: app.js, from anywhere
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && ids.length && !e.target.closest('.ddivider')) {
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
    selectBtn.setAttribute('aria-pressed', String(!on));
    colToggle.setAttribute('aria-pressed', String(elementsOpen));
    for (const b of toolBtns) {
      b.setAttribute('aria-pressed', String(on === b.dataset.tool));
      // a tool with kinds shows the one in use (a preset of the user's: the tool's own)
      const k = b.dataset.tool, v = variants(k).length > 1 ? current(k) : null;
      const paths = (v && POINT_ICON[v]) || (k === 'measure' ? ctx.measureIcon : KIND_ICON[k]);
      if (b.dataset.shows !== String(v)) { b.dataset.shows = String(v); b.querySelector('svg')?.replaceWith(icon(...paths)); }
      b.classList.toggle('haskinds', variants(k).length > 1);
    }
    undoBtn.disabled = !drawing.undos.length;
    redoBtn.disabled = !drawing.redos.length;
    renderTouch();
    renderSubrail();
  }
  return {
    render(what) {
      if (what === 'tool') return renderTools();
      if (what === 'draft') return renderTouch();
      if (what === 'area') { // a Select drag ended: say what it did, even when nothing was inside
        const n = drawing.sel.size;
        note(n ? `${plural(n, 'element')} selected` : 'Nothing lies entirely inside the box');
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
      if (what === 'sel') {
        for (const row of list.querySelectorAll('.drow[data-id]')) row.classList.toggle('sel', drawing.sel.has(row.dataset.id));
      } else renderList();
      renderInspector();
      if (form && what === 'doc') formPreview(); // the form's preview follows the drawing (an undo, its line edited)
      if (what === 'doc') for (const id of profiles.keys()) if (!find(drawing.doc, id)) { profiles.delete(id); profileShown.delete(id); } // a line gone: its profile too
      if (what === 'sel' && drawing.sel.size) list.querySelector(`[data-id="${CSS.escape([...drawing.sel].at(-1))}"]`)?.scrollIntoView({ block: 'nearest' });
      renderTools();
    },
    importFile, // a file dropped on the map (app.js)
    press, cycle, // the tools' keys (app.js)
    toggleElements: () => setElements(!elementsOpen), // its key (app.js)
    setColumn: (v) => { if (v !== elementsOpen) setElements(v); }, // shown or not (app.js: on a phone, Layers opened)
  };
}
