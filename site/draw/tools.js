// The drawing's tools (docs/drawing-ui.md §1, §2): their buttons in the bar (Undo, Redo, Select, Box
// select, Point, Line, Shape, Label, Measure), a tool's kinds in a row under its button, the touch row over
// the map's foot (with a finger). A tool with kinds remembers the one chosen last; its key pressed
// again moves to the next (app.js).

import { h, NARROW } from '../dom.js';

// room in the bar for every kind of a tool, with a mouse (a finger: the bigger buttons do not fit)
const WIDE = typeof matchMedia === 'function' ? matchMedia('(min-width: 1280px) and (pointer: fine)') : { matches: false };
import { ask, askText } from '../menu.js';
import { OUTLINES } from './document.js';
import { OUTLINE_NAME } from './outlines.js';
import { savePresets, presetTool } from './presets.js';
import { keyOf, MOD } from '../keys.js';
import { KIND_ICON, POINT_ICON, SELECT_ICON, BOX_ICON } from './icons.js';

// drawing (drawing.js); ctx: { icon, units(), bar, frame, measureIcon }; del(ids): delete, asked
// first (the touch row's); fileBtns: the bar's file group (files.js). Returns { press, cycle,
// renderTools, renderTouch }.
export function createTools(drawing, ctx, { del, fileBtns }) {
  const { icon } = ctx;
  // the bar's hints: a name and its key, no more (drawing-ui.md says the rest)
  const TOOLS = { point: ['Point'], line: ['Line'], shape: ['Shape'], label: ['Label'], measure: ['Measure'] };
  // the kinds each tool makes, by name. Shape: round a centre, the outlines to scale, the polygon, the
  // vehicles, the user's presets with extent
  const presetsOf = (tool) => drawing.presets.filter((x) => presetTool(x) === tool).map((x) => [`preset:${x.name}`, x.name]);
  const outline = (k) => [k, OUTLINE_NAME[k]];
  const variants = (tool) => ({
    point: [['symbol', 'Symbol'], ...presetsOf('point')],
    shape: [['circle', 'Circle'], ['rings', 'Rings'], ['sector', 'Sector'], outline('rectangle'), outline('ellipse'), outline('triangle'), ['polygon', 'Polygon'], ...OUTLINES.filter((k) => k.endsWith('-vehicle')).map(outline), ...presetsOf('shape')],
  })[tool] || [];
  const current = (tool) => drawing.variant[tool];
  // A tool's button pressed: on, or off when it is on. Its kinds are a row under its button, open as
  // it goes on (or its key moves to the next kind) and shut once one is picked or the map is clicked:
  // a menu, not a fixture; the tool's button shows the kind in use (drawing-ui.md §1)
  let kindsOpen = false;
  const press = (tool) => { kindsOpen = drawing.button !== tool; return kindsOpen ? drawing.start(tool) : drawing.stop(); };
  // a kind picked in its row: the tool on with it, the row shut
  const choose = (tool, v) => { kindsOpen = false; drawing.setVariant(tool, v); };
  // the next kind of a tool (its key pressed again), its row open to show it; or the tool on. B: Box
  // select, on or off
  function cycle(tool) {
    if (tool === 'box') return drawing.boxSelect(!drawing.boxNext);
    const vs = variants(tool).map(([v]) => v), on = drawing.button === tool;
    if (!on || vs.length < 2) return press(tool);
    drawing.setVariant(tool, vs[(vs.indexOf(current(tool)) + 1) % vs.length]);
    kindsOpen = true;
    renderKinds();
  }
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
  // applies. Back steps back one level (what is half drawn, else the tool, else the selection); Snap
  // off places as Alt does; Undo (the bar has no room for it on a phone); Properties, while off.
  const touchBtn = (text, title, run) => h('button', { type: 'button', title, onclick: run }, text);
  const touch = {
    done: touchBtn('Done', 'End the line or close the polygon being drawn (Enter, or a double-click)', () => drawing.finish()),
    back: touchBtn('Back', 'Back one step: what is half drawn, else the tool, else the selection (Esc)', () => (drawing.tool ? drawing.escape() : drawing.select([]))),
    del: touchBtn('Delete', 'Delete the selection (Delete)', () => del([...drawing.sel])),
    dup: touchBtn('Duplicate', `A copy of the selection beside it (${MOD} D)`, () => drawing.duplicate()),
    snap: h('button', { type: 'button', title: 'Snap to what is drawn; off: placed exactly where tapped (Alt)', onclick: () => { drawing.snapOff = !drawing.snapOff; renderTools(); } }, 'Snap'),
    box: touchBtn('Box', 'Box select: drag a box on the map, what lies inside it selected', () => drawing.boxSelect(!drawing.boxNext)),
    undo: touchBtn('Undo', `Undo (${MOD} Z)`, () => drawing.undo()),
    props: touchBtn('Properties', 'Its properties (I)', () => ctx.frame.setProps(true)),
  };
  const touchbar = h('div', { class: 'touchbar', role: 'group', 'aria-label': 'Actions' }, Object.values(touch));
  document.querySelector('#footl').append(touchbar); // the map's foot, under the legends
  function renderTouch() {
    const sel = drawing.sel.size > 0, tool = !!drawing.tool;
    touch.done.hidden = !(['line', 'polygon', 'measure'].includes(drawing.tool) && drawing.draft);
    touch.back.hidden = !tool && !sel;
    touch.del.hidden = touch.dup.hidden = !sel || tool;
    touch.snap.hidden = !tool;
    touch.snap.setAttribute('aria-pressed', String(!drawing.snapOff));
    touch.box.hidden = !NARROW.matches || tool; // a phone's bar has no room for it
    touch.box.setAttribute('aria-pressed', String(!!drawing.boxNext));
    touch.undo.hidden = !NARROW.matches || !drawing.undos.length;
    touch.props.hidden = !NARROW.matches || !sel || tool || ctx.frame.props; // a phone's bar has no Properties toggle
    touchbar.hidden = Object.values(touch).every((b) => b.hidden);
  }
  // With a mouse and room in the bar (WIDE), a tool's kinds are buttons in the bar in its place, each
  // the tool on with that kind (pressed again: off); else the tool's one button and the row under it
  const inline = Object.fromEntries(['point', 'shape'].map((k) => [k, h('span', { class: 'kinds inline', role: 'group', 'aria-label': `${TOOLS[k][0]}: what it makes` })]));
  // a kind's button: its name, the tool's key (which moves to the next kind); a preset's, right-click
  const kindBtn = (tool, v, name, onclick, pressed) => {
    const preset = v.startsWith('preset:');
    return h('button', { type: 'button', 'aria-pressed': String(pressed), title: `${name} (${preset ? 'preset, right-click' : keyOf(tool)})`, 'aria-label': name,
      onclick, oncontextmenu: preset ? (e) => { e.preventDefault(); presetMenu(name); } : null },
    preset ? h('span', { class: 'initials' }, name.slice(0, 2)) : icon(...(POINT_ICON[v] || KIND_ICON.point)));
  };
  const inBar = (k) => WIDE.matches && variants(k).length > 1;
  function renderInline() {
    for (const [k, box] of Object.entries(inline)) {
      const on = inBar(k);
      box.hidden = !on;
      toolBtns.find((b) => b.dataset.tool === k).hidden = on;
      box.replaceChildren(...(on ? variants(k).map(([v, name]) => kindBtn(k, v, name,
        () => (drawing.button === k && current(k) === v ? drawing.stop() : choose(k, v)), drawing.button === k && current(k) === v)) : []));
    }
  }
  WIDE.addEventListener?.('change', () => renderTools());
  function renderKinds() {
    renderInline();
    const tool = drawing.button;
    const vs = inBar(tool) ? [] : variants(tool);
    kindsRow.hidden = vs.length < 2 || !kindsOpen;
    kindsRow.setAttribute('aria-label', `${TOOLS[tool]?.[0] ?? ''}: what it makes`);
    kindsRow.replaceChildren(...vs.map(([v, name]) => kindBtn(tool, v, name, () => choose(tool, v), current(tool) === v)));
    // under its tool's button, within the window
    const from = toolBtns.find((x) => x.dataset.tool === tool);
    kindsRow.style.left = from && !kindsRow.hidden ? `${Math.max(0, Math.min(from.offsetLeft - 5, innerWidth - kindsRow.offsetWidth - 6))}px` : '';
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
  // and Box select; what makes elements (a tool's kinds in its place when there is room); Measure; at
  // its end Properties' toggle (app.js puts find a place before it)
  const makes = toolBtns.filter((b) => b.dataset.tool !== 'measure').flatMap((b) => [b, inline[b.dataset.tool]].filter(Boolean)), measure = toolBtns.find((b) => b.dataset.tool === 'measure');
  ctx.bar.replaceChildren(...fileBtns, sep(), ...ctx.frame.tabBtns, sep(), undoBtn, redoBtn, sep(), selectBtn, boxBtn, sep(), ...makes, sep(), measure, h('span', { class: 'grow' }), ctx.frame.rightBtn, kindsRow);
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
      b.classList.toggle('haskinds', variants(k).length > 1);
    }
    undoBtn.disabled = !drawing.undos.length;
    redoBtn.disabled = !drawing.redos.length;
    renderTouch();
    renderKinds();
  }
  return { press, cycle, renderTools, renderTouch };
}
