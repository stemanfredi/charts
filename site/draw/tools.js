// The drawing's tools (docs/drawing-ui.md §1, §2): their buttons in the bar (Undo, Redo, Select, Box
// select, Point, Line, Shape, Label, Measure), a tool's kinds in a row under its button, the touch row over
// the map's foot (with a finger). On a phone Undo, Redo and the tools are the dock, the bar along the
// bottom, with Back and Done while a tool is on, the kinds in a row above it. A tool with kinds remembers the one chosen last; while it is on,
// its key steps to the next kind and its button opens the row (app.js).

import { h, NARROW } from '../dom.js';
import { ask, askText } from '../menu.js';
import { OUTLINES } from './document.js';
import { OUTLINE_NAME } from './outlines.js';
import { savePresets, presetTool } from './presets.js';
import { keyOf, MOD } from '../keys.js';
import { KIND_ICON, POINT_ICON, SELECT_ICON, BOX_ICON } from './icons.js';

// drawing (drawing.js); ctx: { icon, units(), bar, frame, measureIcon }; del(ids): delete, asked
// first (the touch row's); fileBtns: the bar's file group (files.js). Returns { press, step,
// renderTools, renderTouch }.
export function createTools(drawing, ctx, { del, fileBtns }) {
  const { icon } = ctx;
  // the bar's hints: a name and its key, no more (drawing-ui.md says the rest)
  const TOOLS = { point: ['Point'], line: ['Line'], shape: ['Shape'], label: ['Label'], measure: ['Measure'] };
  // the kinds each tool makes, by name. Shape: round a centre, the outlines to scale, the vehicles, the
  // user's presets with extent
  const presetsOf = (tool) => drawing.presets.filter((x) => presetTool(x) === tool).map((x) => [`preset:${x.name}`, x.name]);
  const outline = (k) => [k, OUTLINE_NAME[k]];
  const variants = (tool) => ({
    point: [['symbol', 'Symbol'], ...presetsOf('point')],
    shape: [['circle', 'Circle'], ['rings', 'Rings'], ['sector', 'Sector'], outline('rectangle'), outline('ellipse'), outline('triangle'), ...OUTLINES.filter((k) => k.endsWith('-vehicle')).map(outline), ...presetsOf('shape')],
  })[tool] || [];
  const current = (tool) => drawing.variant[tool];
  // A tool's button pressed: on; when it is on, off, or for a tool with kinds its row opened (Esc,
  // Select or another tool turns it off). Its kinds are a row under its button, open as it goes on and
  // shut once one is picked or the map is clicked: a menu, not a fixture; the tool's button shows the
  // kind in use (drawing-ui.md §1)
  let kindsOpen = false;
  const hasKinds = (tool) => variants(tool).length > 1;
  const press = (tool) => {
    if (drawing.button === tool && hasKinds(tool)) { kindsOpen = true; return renderKinds(); }
    kindsOpen = drawing.button !== tool;
    return kindsOpen ? drawing.start(tool) : drawing.stop();
  };
  // a tool's key: as its button, but on a tool with kinds that is on, the next kind (its row open to show it)
  const step = (tool) => {
    if (drawing.button !== tool || !hasKinds(tool)) return press(tool);
    const vs = variants(tool).map(([v]) => v);
    kindsOpen = true;
    drawing.setVariant(tool, vs[(vs.indexOf(current(tool)) + 1) % vs.length]);
  };
  // a kind picked in its row: the tool on with it, the row shut
  const choose = (tool, v) => { kindsOpen = false; drawing.setVariant(tool, v); };
  drawing.map.getCanvasContainer().addEventListener('pointerdown', () => { if (kindsOpen) { kindsOpen = false; renderKinds(); } }, true);
  // the bar's tools
  const toolBtns = Object.entries(TOOLS).map(([k, [text]]) => h('button', { type: 'button', 'data-tool': k, 'aria-pressed': 'false', 'aria-label': text, title: `${text} (${keyOf(k)})`,
    onclick: () => press(k) }, icon(...(k === 'measure' ? ctx.measureIcon : KIND_ICON[k]))));
  const undoBtn = h('button', { type: 'button', class: 'urbtn', 'aria-label': 'Undo', title: `Undo (${MOD} Z)`, onclick: () => drawing.undo() }, icon('M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'));
  const redoBtn = h('button', { type: 'button', class: 'urbtn', 'aria-label': 'Redo', title: `Redo (${MOD} Shift Z)`, onclick: () => drawing.redo() }, icon('m15 14 5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'));
  const sep = () => h('span', { class: 'tsep', 'aria-hidden': 'true' });
  const kindsRow = h('div', { class: 'kinds', role: 'group', hidden: true });
  // Select
  const selectBtn = h('button', { type: 'button', class: 'selbtn', 'aria-label': 'Select', title: 'Select',
    onclick: () => { drawing.stop(); drawing.boxSelect(false); } }, icon(...SELECT_ICON));
  // Select's other kind: the next drag on the map draws a box, what lies inside selected; then Select
  const boxBtn = h('button', { type: 'button', class: 'boxbtn', 'aria-label': 'Box select', 'aria-pressed': 'false', title: `Box select (${keyOf('box')})`,
    onclick: () => drawing.boxSelect(!drawing.boxNext) }, icon(...BOX_ICON));
  // With a finger (drawing-ui.md §1): what keys and a mouse do on a computer, each shown when it
  // applies. Back steps back one level (what is half drawn, else the tool, else the selection). On a
  // phone Back and Done are the dock's; the selection's actions are its sheet's head (frame.js). A
  // finger always snaps (a place near something, not on it: zoomed in, the 16 px are less)
  const touchBtn = (text, title, run) => h('button', { type: 'button', title, onclick: run }, text);
  const touch = {
    done: touchBtn('Done', 'End the line or measurement being drawn (Enter, or a double-click)', () => drawing.finish()),
    back: touchBtn('Back', 'Back one step: what is half drawn, else the tool, else the selection (Esc)', () => (drawing.tool ? drawing.escape() : drawing.select([]))),
    del: touchBtn('Delete', 'Delete the selection (Delete)', () => del([...drawing.sel])),
    dup: touchBtn('Duplicate', `A copy of the selection beside it (${MOD} D)`, () => drawing.duplicate()),
  };
  touch.done.classList.add('done');
  const touchbar = h('div', { class: 'touchbar', role: 'group', 'aria-label': 'Actions' });
  document.querySelector('#footl').append(touchbar); // the map's foot, under the legends
  function renderTouch() {
    const sel = drawing.sel.size > 0, tool = !!drawing.tool, phone = NARROW.matches;
    touch.done.hidden = !(['line', 'measure'].includes(drawing.tool) && drawing.draft);
    touch.back.hidden = !tool && (phone || !sel); // a phone: a tap on the map clears the selection
    touch.del.hidden = touch.dup.hidden = !sel || tool;
    for (const b of toolBtns) b.hidden = phone && tool && b.dataset.tool !== drawing.button; // a phone: the tool on alone
    touchbar.hidden = phone || [touch.done, touch.back, touch.del, touch.dup].every((b) => b.hidden);
  }
  // a kind's button: its name; a preset's, right-click to rename or delete it
  const kindBtn = (tool, v, name, onclick, pressed) => {
    const preset = v.startsWith('preset:');
    return h('button', { type: 'button', 'aria-pressed': String(pressed), title: preset ? `${name} (preset, right-click)` : name, 'aria-label': name,
      onclick, oncontextmenu: preset ? (e) => { e.preventDefault(); presetMenu(name); } : null },
    preset ? h('span', { class: 'initials' }, name.slice(0, 2)) : icon(...(POINT_ICON[v] || KIND_ICON.point)));
  };
  function renderKinds() {
    const tool = drawing.button;
    const vs = variants(tool);
    kindsRow.hidden = vs.length < 2 || !kindsOpen;
    kindsRow.setAttribute('aria-label', `${TOOLS[tool]?.[0] ?? ''}: what it makes`);
    kindsRow.replaceChildren(...vs.map(([v, name]) => kindBtn(tool, v, name, () => choose(tool, v), current(tool) === v)));
    // under its tool's button, as the bar's menus hang under theirs (4 px below the button, its left
    // edge on the button's), within the window
    // (a phone: above the dock, style.css)
    const from = !NARROW.matches && toolBtns.find((x) => x.dataset.tool === tool);
    kindsRow.style.left = from && !kindsRow.hidden ? `${Math.max(0, Math.min(from.offsetLeft, innerWidth - kindsRow.offsetWidth - 6))}px` : '';
    kindsRow.style.top = from && !kindsRow.hidden ? `${from.offsetTop + from.offsetHeight + 4}px` : '';
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
  // The bar (drawing-ui.md §1): the file group (files.js); Layers and Elements (the left panel's tabs); Undo, Redo (history, not tools); Select
  // and Box select; what makes elements; Measure; at its end Properties' toggle (app.js puts find a
  // place before it)
  const makes = toolBtns.filter((b) => b.dataset.tool !== 'measure'), measure = toolBtns.find((b) => b.dataset.tool === 'measure');
  const historySep = sep(), makesSep = sep(), measureSep = sep();
  ctx.bar.replaceChildren(...fileBtns, sep(), ...ctx.frame.tabBtns, historySep, undoBtn, redoBtn, sep(), selectBtn, boxBtn, makesSep, ...makes, measureSep, measure, h('span', { class: 'grow' }), ctx.frame.rightBtn, kindsRow);
  // a phone: Undo, Redo and the tools in the dock (Back and Done with them); else in the bar, those two in the touch row
  const dock = document.querySelector('#dock');
  function placeTools() {
    if (NARROW.matches) dock.replaceChildren(touch.back, undoBtn, redoBtn, ...toolBtns, touch.done, kindsRow);
    else {
      historySep.after(undoBtn, redoBtn);
      makesSep.after(...makes);
      measureSep.after(measure);
      ctx.bar.append(kindsRow);
      touchbar.replaceChildren(...Object.values(touch));
    }
    renderTouch();
  }
  NARROW.addEventListener?.('change', placeTools);
  placeTools();
  function renderTools() {
    const on = drawing.button;
    selectBtn.setAttribute('aria-pressed', String(!on && !drawing.boxNext));
    boxBtn.setAttribute('aria-pressed', String(!!drawing.boxNext));
    for (const b of toolBtns) {
      b.setAttribute('aria-pressed', String(on === b.dataset.tool));
      // a tool with kinds shows the one in use (a preset of the user's: the tool's own)
      const k = b.dataset.tool, v = variants(k).length > 1 ? current(k) : null;
      const paths = (v && POINT_ICON[v]) || (k === 'measure' ? ctx.measureIcon : KIND_ICON[k]);
      if (b.dataset.shows !== String(v)) { b.dataset.shows = String(v); b.querySelector('svg')?.replaceWith(icon(...paths)); }
      b.classList.toggle('haskinds', hasKinds(k));
    }
    undoBtn.disabled = !drawing.undos.length;
    redoBtn.disabled = !drawing.redos.length;
    renderTouch();
    renderKinds();
  }
  return { press, step, renderTools, renderTouch };
}
