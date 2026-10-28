// The drawing's tools (docs/drawing-ui.md §1, §2): their buttons in the bar (☰, Select, Point, Line,
// Shape, Label, Measure, Undo, Redo), a tool's kinds in a row under its button, the touch row over
// the map's foot (with a finger). A tool with kinds remembers the one chosen last; its key pressed
// again moves to the next (app.js).

import { h, NARROW } from '../dom.js';
import { ask, askText } from '../menu.js';
import { OUTLINES } from './document.js';
import { OUTLINE_NAME } from './outlines.js';
import { savePresets, presetTool } from './presets.js';
import { keyOf, MOD } from '../keys.js';
import { KIND_ICON, POINT_ICON, SELECT_ICON } from './icons.js';

// drawing (drawing.js); ctx: { icon, units(), bar, frame, measureIcon }; del(ids): delete, asked
// first (the touch row's); toggleFiles(button): the drawings menu. Returns { press, cycle,
// renderTools, renderTouch }.
export function createTools(drawing, ctx, { del, toggleFiles }) {
  const { icon } = ctx;
  const TOOLS = { point: ['Point', 'Place points: click on the map'], line: ['Line', 'Draw a line: click its start, its bends, then a point, a corner, an edge or a vertex to end there (attached), or Enter'],
    shape: ['Shape', 'Place a shape of the outline chosen, or draw a polygon'], label: ['Label', 'Place a label: click a point, a shape, an area or a line to point at it, or anywhere for free text'],
    measure: ['Measure', 'Measure a distance, or an area (a click on the first point closes it): it goes in the drawing'] };
  // the kinds each tool makes (its sub-rail), each with a short tooltip. Shape: round a centre, the
  // outlines to scale, the polygon, the vehicles, the user's presets with extent
  const presetsOf = (tool) => drawing.presets.filter((x) => presetTool(x) === tool).map((x) => [`preset:${x.name}`, `${x.name}: a preset of yours (right-click: rename or delete)`]);
  const outline = (k) => [k, `${OUTLINE_NAME[k]}: an outline to scale`];
  const variants = (tool) => ({
    point: [['symbol', 'Symbol: the same size at every zoom'], ...presetsOf('point')],
    shape: [['circle', 'Circle: a distance round a centre'], ['rings', 'Rings: distances round a centre'], ['sector', 'Sector: part of a circle, in three clicks'],
      outline('rectangle'), outline('ellipse'), outline('triangle'), ['polygon', 'Polygon: corner by corner'], ...OUTLINES.filter((k) => k.endsWith('-vehicle')).map(outline), ...presetsOf('shape')],
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
  // the bar's own: ☰, the drawings and the file; Select
  const fileBtn = h('button', { type: 'button', class: 'filebtn', 'aria-label': 'File', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    title: 'The drawings in this browser, and the file: New, Import, Export', onclick: () => toggleFiles(fileBtn) }, icon('M4 6h16', 'M4 12h16', 'M4 18h16'));
  const selectBtn = h('button', { type: 'button', class: 'selbtn', 'aria-label': 'Select', title: `Select: a click on an element (Shift, ${MOD}: add or remove); Shift-drag a box on the map`,
    onclick: () => drawing.stop() }, icon(...SELECT_ICON));
  // With a finger (drawing-ui.md §1): what keys and a mouse do on a computer, each shown when it
  // applies. Back steps back one level (what is half drawn, else the tool, else the selection); Snap
  // off places as Alt does; Undo (the bar has no room for it on a phone); Properties, while off.
  const touchBtn = (text, title, run) => h('button', { type: 'button', title, onclick: run }, text);
  const touch = {
    done: touchBtn('Done', 'End the line or close the polygon being drawn (Enter, or a double-click)', () => drawing.finish()),
    back: touchBtn('Back', 'Back one step: what is half drawn, else the tool, else the selection (Esc)', () => (drawing.tool ? drawing.escape() : drawing.select([]))),
    del: touchBtn('Delete', 'Delete the selection (Delete)', () => del([...drawing.sel])),
    dup: touchBtn('Duplicate', `A copy of the selection beside it (${MOD} D)`, () => drawing.duplicate()),
    snap: h('button', { type: 'button', title: 'Snap to what is drawn; off: placed exactly where tapped (Alt)', onclick: () => { drawing.snapOff = !drawing.snapOff; renderTools(); } }, 'Snap'),
    undo: touchBtn('Undo', `Undo (${MOD} Z)`, () => drawing.undo()),
    props: touchBtn('Properties', 'Its properties (I)', () => ctx.frame.setProps(true)),
  };
  const touchbar = h('div', { class: 'touchbar', role: 'group', 'aria-label': 'Actions' }, Object.values(touch));
  document.body.append(touchbar); // over the map, at its foot (above a phone's sheet)
  function renderTouch() {
    const sel = drawing.sel.size > 0, tool = !!drawing.tool;
    touch.done.hidden = !(['line', 'polygon', 'measure'].includes(drawing.tool) && drawing.draft);
    touch.back.hidden = !tool && !sel;
    touch.del.hidden = touch.dup.hidden = !sel || tool;
    touch.snap.hidden = !tool;
    touch.snap.setAttribute('aria-pressed', String(!drawing.snapOff));
    touch.undo.hidden = !NARROW.matches || !drawing.undos.length;
    touch.props.hidden = !NARROW.matches || !sel || tool || ctx.frame.props; // a phone's bar has no Properties toggle
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
    // under its tool's button, within the window
    const from = toolBtns.find((x) => x.dataset.tool === tool);
    subrail.style.left = from && !subrail.hidden ? `${Math.max(0, Math.min(from.offsetLeft - 5, innerWidth - subrail.offsetWidth - 6))}px` : '';
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
  // The bar (drawing-ui.md §1): ☰ and the left panel's toggle; Select; what makes elements; Measure;
  // Undo, Redo; at its end Properties' toggle (app.js puts find a place before it). The tree in the left
  // panel, the inspector in the right one.
  const makes = toolBtns.filter((b) => b.dataset.tool !== 'measure'), measure = toolBtns.find((b) => b.dataset.tool === 'measure');
  ctx.bar.replaceChildren(fileBtn, ctx.frame.leftBtn, sep(), selectBtn, sep(), ...makes, sep(), measure, sep(), undoBtn, redoBtn, h('span', { class: 'grow' }), ctx.frame.rightBtn, subrail);
  function renderTools() {
    const on = drawing.button;
    selectBtn.setAttribute('aria-pressed', String(!on));
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
  return { press, cycle, renderTools, renderTouch };
}
