// The drawing's panels (docs/drawing-ui.md): the tools in the bar (tools.js), the tree of the
// drawing's elements in the left panel (tree.js), and Properties in the right one, which shows what is selected (or, with nothing
// selected, the drawing itself) and edits it with fields. Fields apply on Enter or when they lose
// focus, one undo step each.

import { h, svg, typing, morph } from '../dom.js';
import { ask, askText, note } from '../menu.js';
import { FINGER } from './layers.js';
import { find, elements, groupsOf, membersOf, canHold, label, kindName, POINT_KIND_NAME, lookOf, lookField, setLook, LOOK_FIELDS, labelColour, addPart, makePart, followedPart, mainOutline, PART_KINDS, ROUND, SYMBOLS, DASHES, LABEL_OFFSET, makeGroup, setGroup, moveStep, MAX_RADIUS, offsetOf, MAX_OFFSET, MAX_MIN_SIZE, STROKE_WIDTH } from './document.js';
import { insertCorner, removeCorner, reattach, partName, addVertex, removeVertex, splitKeeping, lineRef, freeRef, resolve, along } from './attach.js';
import { labelValues, labelText, TOKENS } from './labels.js';
import { OUTLINE_NAME, outlineOf } from './outlines.js';
import { lineTrace, totals, breakdown, nearestAlong, positionsOf } from './lines.js';
import { profileCsv } from './profile.js';
import { COPY_RADIUS, distribute, lines, plan, planConnection, makeDistribution, editDistribution, connect, reconnect, unconnect, alongTrace, alongOf,
  distributions, connections, ruleOf, distributionOf, connectionOn, changedByHand, giveBack, removePartOf, MAX_COPIES, MAX_TREE } from './generator.js';
import { BUILT_IN, builtInName } from './place.js';
import { boundsOf, drawable, ringOf } from './features.js';
import { inverse, areaOf, pathOf, destination, perimeterOf } from '../geodesy.js';
import { norm360 } from '../geo.js';
import { fields, choice, select, check } from '../fields.js';
import { mac, MOD } from '../keys.js';
import { loadPresets, savePresets, presetOf, presetTool } from './presets.js';
import { listGrid, setCurrent, currentOf } from './grid.js';
import { fmtArea, fmtDist, rowsText, plural } from '../format.js';
import { fileGroup } from './files.js';
import { createTools } from './tools.js';
import { createTree, kindTitle, groupPath, eyeFor, shownName } from './tree.js';
import { KIND_ICON, UI_ICON } from './icons.js';

// what a total counts: "15 points, 10 with radii · 3 lines, 12.4 km · 2 areas"
// an element's icon and what the panel calls its kind: a point by what it looks like (a circle, a
// rectangle…); an area a polygon
const PART_NAME = { circle: 'Circle', sector: 'Sector', ...OUTLINE_NAME };
const SYMBOL_ICON = { diamond: ['m12 4 8 8-8 8-8-8z'], square: ['M6 6h12v12H6z'], triangle: ['M12 4l9 15H3z'], dot: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'], none: [] };
const SYMBOL_TITLE = { diamond: 'Diamond', square: 'Square', triangle: 'Triangle', dot: 'Dot', none: 'None' };
const WIDTH_NAME = { 'aerial-vehicle': 'Span', 'surface-vehicle': 'Beam', 'underwater-vehicle': 'Diameter' }; // a shape's width, as said of each outline

// root: the left panel's Elements tab. ctx: { drawing, map, icon, units() ('km' | 'nm'), known, bar
// (the bar, its tools here), props (the right panel: the inspector), frame (frame.js), outputs, copyLink(), about(), linkIcon (files.js),
// onImport(doc, report) (applies an imported document), openDrawing(id), download(text, name), profile(trace) }
export function drawView(root, ctx) {
  const { drawing, map, icon } = ctx;
  const F = fields({ note, units: ctx.units }), { field } = F; // fields.js: each applies on Enter or when left
  let facts = null; // the totals: computed once per rendering of the list, read by the inspector
  let totalsBy = ''; // the drawing's totals by group (''), or by the values of a property (its key)
  const totalsFolded = new Set(); // the Totals view's groups folded (by key)
  const computeFacts = () => (facts = { totals: totals(drawing.doc, totalsBy || null), breakdown: breakdown(drawing.doc, totalsBy || null) });
  const fx = () => facts || computeFacts();

  drawing.presets = loadPresets();
  const files = fileGroup(drawing, ctx, () => icon(...UI_ICON.delete), () => renderTools());
  const tools = createTools(drawing, ctx, { del, fileBtns: files.buttons });
  const { renderTools } = tools;

  // ---- the tree (tree.js), its first row the drawing ------------------------------------------
  // The drawing shown in Properties (its row clicked), until something is selected
  let showDrawing = false;
  function openDrawing() {
    drawing.select([]);
    showDrawing = true;
    renderInspector();
  }
  const tree = createTree(drawing, ctx, { facts: () => facts, openDrawing });
  const renderList = () => { computeFacts(); tree.render(); };
  const drawElements = () => elements(drawing.doc);
  // the inspector's head: what it shows, the actions on it (renderHead), its fold
  let title = ''; // what the inspector shows, said in its head (set by the inspector built)
  const inspTitle = h('span', { class: 'ititle' }), inspActs = h('span', { class: 'iacts' });
  const inspHead = h('div', { class: 'dinsphead' }, inspTitle, inspActs);

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
    note(`Deleted ${what}${freed ? `; ${plural(freed, 'line')} attached to it now end${freed === 1 ? 's' : ''} where ${freed === 1 ? 'it' : 'they'} did` : ''}`, () => drawing.undo());
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
  const coordFields = (id, key) => { const [, lat, , lon] = F.position(() => now(id)[key], (p) => set(id, (el) => { el[key] = p; }), '', 6); return row('Position', pair(lat, '·', lon)); };
  const distField = (get, apply, aria, check, attrs = {}) => F.dist(get, apply, aria, { check, ...attrs });
  // a value's unit beside it, in grey (drawing-ui.md §5: never inside the text): a distance field's
  // (fields.js unitText), or a formatted value's ("10.08 km" → 10.08 · km)
  const funit = (t) => h('span', { class: 'funit' }, t);
  const withUnit = (input) => [input, funit(input.unitText())];
  const fvalue = (t, attrs = {}) => h('span', { class: 'fvalue', ...attrs }, t);
  const valued = (text, attrs = {}) => { const i = text.lastIndexOf(' '); return i < 0 ? [fvalue(text, attrs)] : [fvalue(text.slice(0, i), attrs), funit(text.slice(i + 1))]; };
  const distValue = (m, attrs = {}) => valued(fmtDist(m, ctx.units()), attrs);
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
    const has = (x, f) => x.kind === 'drawing' || LOOK_FIELDS[x.kind].includes(f);
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
    // Fill and Stroke: a small matrix, the same columns for both (a line: its Stroke row alone)
    const matrix = () => h('table', { class: 'lmatrix' },
      h('thead', {}, h('tr', {}, h('th'), h('th', {}, 'Colour'), h('th', {}, 'Opacity'), h('th', {}, 'Width'), h('th', {}, 'Dash'), h('th'))),
      h('tbody', {},
        shown('fill.color') ? h('tr', {}, h('th', {}, 'Fill'), h('td', {}, ...colour('fill.color', 'Fill colour')), h('td', {}, num('fill.opacity', 'Fill opacity', 0, 1)), h('td'), h('td'), h('td', {}, back('fill.color', 'fill.opacity'))) : null,
        h('tr', {}, h('th', {}, 'Stroke'), h('td', {}, ...colour('stroke.color', 'Stroke colour')), h('td', {}, num('stroke.opacity', 'Stroke opacity', 0, 1)),
          h('td', {}, num('stroke.width', 'Stroke width (px)', ...STROKE_WIDTH)), h('td', {}, dashSelect()), h('td', {}, back('stroke.color', 'stroke.opacity', 'stroke.width', 'stroke.dash')))));
    const dash = same('stroke.dash');
    return h('div', { class: 'fblock' }, h('h3', {}, title),
      shown('stroke.color') ? matrix() : null,
      shown('text.size') ? row('Text size', segOf('Text size', [['small', 'S', 'Small'], ['medium', 'M', 'Medium'], ['large', 'L', 'Large']], same('text.size'), (v) => put('text.size', v)), back('text.size')) : null,
      shown('text.color') ? row('Text colour', colour('text.color', 'Text colour'), back('text.color')) : null,
      shown('text.background') ? row('Background', segOf('Background', [['halo', 'Halo', 'A white halo round the letters'], ['box', 'Box', 'A white box with a border in the text\'s colour']], same('text.background'), (v) => put('text.background', v)), back('text.background')) : null,
      shown('text.name') ? tick('text.name', xs.length > 1 || xs[0].kind === 'drawing' ? 'Names on map' : 'Name on map', 'Names are left out where they would collide; zooming in shows them') : null,
      shown('text.values') ? tick('text.values', 'Show values', 'Values on the map: each leg\'s length, an area\'s area and perimeter, each radius') : null,
      shown('offset') ? row('Offset', F.number(() => same('offset'), (v) => put('offset', v), 'Offset (px)', { min: -MAX_OFFSET, max: MAX_OFFSET, placeholder: 'mixed', bad: `pixels from −${MAX_OFFSET} to ${MAX_OFFSET}`,
        title: 'Drawn this many pixels beside its line, to the right of its direction (negative: left), as GIS tools offset a line: display only, lengths stay real' }), funit('px'), back('offset')) : null,
      shown('minSize') ? row('Min. size', F.number(() => same('minSize'), (v) => put('minSize', v), 'Minimum size (px)', { max: MAX_MIN_SIZE, placeholder: 'mixed', bad: `pixels from 0 to ${MAX_MIN_SIZE}`,
        title: 'Shapes shorter than this on screen are drawn enlarged, their outline dotted (0: always real size)' }), funit('px'), back('minSize')) : null,
      ...extra);
  }
  // the group an element (or a group) is in: none, or one of the drawing's that can hold them all;
  // New group…: a group of them, in the group they are in (a subgroup)
  function groupRow(ids) {
    const doc = drawing.doc;
    const gs = ids.map((id) => find(doc, id)?.el.groupId ?? null), same = gs.every((g) => g === gs[0]) ? gs[0] : undefined;
    const fits = doc.groups.filter((g) => ids.every((id) => canHold(doc, g.id, id)));
    return row('In group', select('In group', [['', 'none'], ...fits.map((g) => [g.id, groupPath(drawing.doc, g)])], same === undefined ? null : same ?? '', (v) => {
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
    title = `${kindTitle(kind, el)} · ${shownName(drawing.doc, kind, el, ctx.units())}`;
    return [...(ruleRow(id) ?? []), row('Name', textField(id, 'name', 'Name')), groupRow([id])];
  };
  // and its foot: Guide, its data (Delete: in the head)
  const commonBottom = (kind, id) => {
    const el = now(id);
    // Guide (supporting geometry: faint, out of the totals): a measurement is a guide showing its
    // values; unticking Guide makes it part of the drawing
    const guide = ['point', 'line', 'area'].includes(kind) ? row('Guide', check('', el.guide, (v) => set(id, (x) => { x.guide = v; }), { 'aria-label': 'Guide', title: 'Supporting geometry: drawn faint and dashed, left out of the totals' })) : null;
    return [guide, dataBlock(id)];
  };

  // A point's parts, each named by its place in the list: its kind (changing it keeps its reach), its
  // name, Fill, Shown, its own stroke, ×; its size (a radius, a sector's aperture; an outline's length
  // and width, its area). "+ Part" adds one.
  function partsBlock(id) {
    const el = now(id), u = ctx.units(), U = colUnitText();
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
    const dist = (i, key, aria) => distField(() => now(id).parts[i][key], (m) => at(i, (y) => { y[key] = m; }), aria, (m) => (m >= MAX_RADIUS || (key === 'radius' && !fits(m)) ? 'too large' : null), { in: colUnit() });
    // its size, two columns, in the column's unit: a round part's radius and a sector's aperture (°), an outline's length and width
    const size = (part, i) => (part.radius ? dist(i, 'radius', `Part ${i + 1} radius`) : dist(i, 'length', `Part ${i + 1} length`));
    const across = (part, i) => (part.kind === 'sector'
      ? h('span', { class: 'vpair' }, angleField(() => now(id).parts[i].aperture, (v) => at(i, (y) => { y.aperture = v; }), `Part ${i + 1} aperture (degrees): centred on the bearing`, 0, 360, false), funit('°'))
      : part.radius ? null : dist(i, 'width', `Part ${i + 1} ${WIDTH_NAME[part.kind] || 'width'}`));
    const kind = (part, i) => select(`Part ${i + 1} kind`, PART_KINDS.map((k) => [k, PART_NAME[k]]), part.kind, (v) => drawing.change((d) => { const x = find(d, id).el; x.parts[i] = asKind(x.parts[i], v); reattach(d, id); }));
    const removeAt = (i) => drawing.change((d) => { removePartOf(d, id, i); reattach(d, id); });
    // the part as drawn, for the mark of its row on the map
    const ringAt = (i) => { const x = now(id), part = x.parts[i]; return part && (part.radius ? ringOf(x, part) : outlineOf(x.position, x.bearing, part.length, part.width, part.kind).ring); };
    const table = listGrid({ name: `${id}:parts`,
      columns: [{ head: '#', width: 28, frozen: true, cls: 'num' }, { head: 'Kind', width: 96 },
        { head: `Size ${U}`, width: 92, cls: 'n', title: 'A circle\'s or sector\'s radius, an outline\'s length' },
        { head: `Across ${U}`, width: 76, cls: 'n', title: 'A sector\'s aperture (°), centred on the bearing; an outline\'s width' },
        { head: 'Fill', width: 40 }, { head: 'Shown', width: 50 }, { head: 'Name', width: 110 }],
      rows: el.parts.map((part, i) => ({ cells: [`${i + 1}`, kind(part, i), size(part, i), across(part, i), box(i, 'fill', 'filled'), box(i, 'shown', 'shown'),
        field(() => part.name, (t) => t, (v) => at(i, (y) => { y.name = v; }), { 'aria-label': `Part ${i + 1} name` })],
      cls: part.radius && !fits(part.radius) ? 'warn' : null })),
      add: [null, adder('Add a part', 'add a part…'), null, null, null, null, null],
      actions: (i) => ({ label: `Part ${i + 1}`, buttons: [act('Delete', 'Take this part away (Ctrl/⌘ Delete)', () => removeAt(i))] }),
      keys: { remove: removeAt },
      current: (i) => drawing.markPlace(i == null ? null : ringAt(i) && { line: ringAt(i) }) });
    const far = el.parts.find((part) => part.radius && !fits(part.radius));
    return h('div', { class: 'fblock' },
      h('h3', {}, `Parts (${el.parts.length})`, copyBtn(() => [['#', 'Kind', 'Radius m', 'Aperture °', 'Length m', 'Width m', 'Fill', 'Shown', 'Name'],
        now(id).parts.map((q, i) => [i + 1, q.kind, q.radius ?? '', q.aperture ?? '', q.length ?? '', q.width ?? '', q.fill ? 'yes' : 'no', q.shown ? 'yes' : 'no', q.name])])),
      table,
      far ? h('p', { class: 'note warn' }, `Not drawn: a circle of ${fmtDist(far.radius, u)} there reaches a pole.`) : null);
  }

  const kindOf = (id) => find(drawing.doc, id)?.kind;
  const item = (id) => find(drawing.doc, id);
  // a button selecting another element (a point, a line, a group)
  const link = (id, text) => h('button', { type: 'button', class: 'small link', onclick: () => drawing.select([id]) }, text ?? label(kindOf(id), now(id)));

  // a point: its position and bearing, its symbol, its parts, Distribute along…, its look, Save as preset…
  function pointInspector(id) {
    const el = now(id);
    const parts = [...commonTop('point', id), coordFields(id, 'position'),
      row('Bearing', angleField(() => now(id).bearing, (v) => set(id, (x) => { x.bearing = v; }), 'Bearing (degrees true): where its outlines face, and its sectors'), funit('°T')),
      mainOutline(el) ? null : row('Symbol', segOf('Symbol (the same size on screen at every zoom)', SYMBOLS.map((sy) => [sy, sy === 'none' ? '∅' : icon(...SYMBOL_ICON[sy]), SYMBOL_TITLE[sy]]), el.symbol, (sy) => set(id, (x) => { x.symbol = sy; }))),
      partsBlock(id),
      // one Distribute: round the part whose row is current (else the one followed by default); the form can choose another
      el.parts.length ? row('', h('button', { type: 'button', class: 'small', title: 'Copies placed round one of its parts (the row picked in Parts): a circle\'s whole round, a sector\'s arc, an outline; they follow it, and can be connected to roots',
        onclick: () => openDistribution({ element: id, part: currentOf(`${id}:parts`) }) }, 'Distribute along…')) : null,
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
          note(`Preset “${name}” in the ${tool === 'shape' ? 'Shape' : 'Point'} tool`);
        } }, 'Save as preset…')));
    return [...parts, ...commonBottom('point', id)];
  }

  // an area: its area and perimeter, its corners (typed, one inserted halfway to the next, one
  // removed while more than three)
  function areaInspector(id) {
    const el = now(id), u = ctx.units(), n = el.points.length;
    const corner = (i, axis) => F.coord(axis, () => now(id).points[i][axis === 'lat' ? 1 : 0],
      (v) => set(id, (x) => { const q = x.points[i]; x.points[i] = axis === 'lat' ? [q[0], v] : [v, q[1]]; }), `Corner ${i + 1} ${axis === 'lat' ? 'latitude' : 'longitude'}`, 6);
    const insertAt = (i) => drawing.change((doc) => { const x = find(doc, id).el, q = x.points[i], r = x.points[(i + 1) % x.points.length]; insertCorner(doc, x, i + 1, along(q, r, 0.5)); });
    const drop = (i) => { if (n > 3) drawing.change((doc) => removeCorner(doc, find(doc, id).el, i)); };
    // its corners as rows, 1 to n, a page of them shown: Lat, Lon; the edge from the corner before
    // (corner 1's from the last; typed: this corner moves)
    const pg = paged(`${id}:corners`, n), abs = (r) => pg.rows[r];
    const U = colUnitText();
    const table = listGrid({ name: pg.name,
      columns: [...PLACE_COLUMNS, { head: `Edge ${U}`, width: 56, cls: 'n', title: 'The straight edge from the corner before (corner 1: from the last): its length (typed: this corner moves, the edges either side of it change)' },
        { head: 'Brg °T', width: 52, cls: 'n', title: 'The edge\'s bearing, degrees true (typed: this corner moves)' }],
      rows: pg.rows.map((i) => ({ cells: [`${i + 1}`, corner(i, 'lat'), corner(i, 'lon'), ...legFields(id, (x) => x.points, i, setAreaEdge, 'Corner')] })),
      actions: (r, i = abs(r)) => ({ label: `Corner ${i + 1}`, buttons: [act('Insert after', 'A corner halfway to the next (Insert)', () => insertAt(i)), act('Delete', 'Take this corner away (Ctrl/⌘ Delete); three are kept', () => drop(i), n <= 3)] }),
      keys: { insert: (r) => insertAt(abs(r)), remove: (r) => drop(abs(r)) },
      current: (r) => drawing.markPlace(r == null ? null : now(id).points[abs(r)]) });
    const cornerRows = () => { const ps = now(id).points; return [['#', 'Lat', 'Lon', 'Edge m', 'Brg °'], ps.map((q, i) => { const g = legOf(ps, i); return [i + 1, q[1], q[0], +g.s.toFixed(3), +g.azi.toFixed(1)]; })]; };
    return [...commonTop('area', id),
      row('Area', valued(fmtArea(areaOf(pathOf(el.points, true)), u))),
      row('Perimeter', distValue(perimeterOf(el.points))),
      h('div', { class: 'fblock' }, h('h3', {}, `Corners (${n})`, copyBtn(cornerRows)), table, pg.pager),
      lookBlock([item(id)]), ...commonBottom('area', id)];
  }

  // What a line's end or a label's anchor (key) points at (a reference, attach.js): attached, a link
  // to it and where on it, Attach to… (the next click on the map chooses again) and Detach (free where
  // it is); free, its position typed, and Attach to…
  function refRow(text, id, key) {
    const r = now(id)[key], on = r.element && find(drawing.doc, r.element);
    // one row: free, its position; attached, what to (and where on it) and the broken link that
    // detaches it (it stays where it is); at its end Attach to…, pressed while it waits for a click
    const attach = h('button', { type: 'button', class: 'x', 'aria-pressed': String(drawing.repointing?.id === id && drawing.repointing.key === key), 'aria-label': `Attach ${text.toLowerCase()} to…`,
      title: 'Attach to…: then click a point, a vertex, an edge, a line or an area to attach it there, or anywhere for a position (Esc: cancel)',
      onclick: () => { if (drawing.repointing?.id === id && drawing.repointing.key === key) drawing.cancelRepoint(); else drawing.startRepoint(id, key); renderInspector(); } }, icon(...UI_ICON.attach));
    if (!on) { const [, lat, , lon] = F.position(() => now(id)[key].position, (q) => set(id, (x) => { x[key] = { position: q, element: null }; })); return row(text, pair(lat, '·', lon), attach); }
    return row(text, link(on.el.id), partName(r, on.kind) ? h('span', { class: 'funit' }, partName(r, on.kind)) : null,
      h('button', { type: 'button', class: 'x', title: 'Detach: keep it where it is, no longer following what it is attached to', 'aria-label': `Detach ${text.toLowerCase()}`, onclick: () => set(id, (x) => { x[key] = freeRef(x[key]); }) }, icon(...UI_ICON.detach)), attach);
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
    const alongRow = onLine ? row('Along', withUnit(F.dist(() => at.along, (m) => drawing.change((d) => { const a = find(d, id).el; a.anchor = lineRef(d, find(d, a.anchor.element).el, m); }), 'Distance along', { zero: true,
      title: `From its start, of ${fmtDist(at.length, u)}` }))) : null;
    // what it reads on the map, under its text, while a value fills it in
    const reads = /\{\w+\}/.test(el.text) ? h('p', { class: 'note' }, `Reads: ${labelText(doc, el, u).split('\n').map((t) => t.trim()).filter(Boolean).join(' · ') || '(nothing)'}`) : null;
    // its place: where it points (free: a position), along a line, and its text moved from there
    const moved = el.offset[0] !== (el.anchor.element ? LABEL_OFFSET[0] : 0) || el.offset[1] !== (el.anchor.element ? LABEL_OFFSET[1] : 0);
    return [...commonTop('label', id),
      row('Text', text), reads,
      tokens.length ? row('', ...tokens.map((k) => h('button', { type: 'button', class: 'small', title: `Insert, a live value: ${TOKEN_TEXT[k][1].toLowerCase()} (it follows edits and the units)`, onclick: () => insert(`{${k}}`) }, `+ ${TOKEN_TEXT[k][0]}`))) : null,
      ...[refRow(el.anchor.element ? 'Attached to' : 'Position', id, 'anchor')].flat(), alongRow,
      row('Text offset', fvalue(`${el.offset[0]}, ${el.offset[1]}`.replace(/-/g, '−'), { title: 'Pixels from where it points: drag its text on the map' }), funit('px'),
        moved ? h('button', { type: 'button', class: 'x', title: 'Back to where a new label puts it', 'aria-label': 'Text offset back to where a new label puts it', onclick: () => set(id, (x) => { x.offset = x.anchor.element ? [...LABEL_OFFSET] : [0, 0]; }) }, '↺') : null),
      el.anchor.element ? leaderRow([item(id)]) : null, // a free label points at nothing
      lookBlock([item(id)]),
      ...commonBottom('label', id)];
  }

  // labels' leader: a line from the text to its point, an arrow head there, or none (one or several labels)
  function leaderRow(xs) {
    const on = xs.map((x) => x.el.leader !== 'none'), v = on.every((x) => x === on[0]) ? on[0] : null;
    return row('Leader', check('', v, (x) => drawing.change((d) => { for (const y of xs) find(d, y.el.id).el.leader = x ? 'arrow' : 'none'; }),
      { 'aria-label': 'Leader', title: 'A line from the text to what it points at, an arrow head there' }));
  }

  // a line: its ends (each attached to a point, or free), length, curve, the table of its vertices
  // (lat, lon, leg, name, distance from its start)
  // Legs typed (the line's table of points, the area's of corners): the straight leg arriving at a
  // place from the one before, its length and its bearing. A value typed moves that place alone (the
  // leg after it changes with it); a line's end attached is where it is attached, its leg not typed.
  const legOf = (ps, k) => { const g = inverse(ps.at(k - 1), ps[k]); return { s: g.s, azi: norm360(g.azi) }; };
  const legTo = (ps, k, { s: len, azi }) => { const g = legOf(ps, k); return destination(ps.at(k - 1), azi ?? g.azi, len ?? g.s); }; // an area's corner 1: from its last
  function setLineLeg(x, k, v) {
    const to = legTo(positionsOf(x), k, v);
    if (k <= x.vertices.length) x.vertices[k - 1].position = to; else if (!x.end.element) x.end.position = to;
  }
  function setAreaEdge(x, k, v) { x.points[k] = legTo(x.points, k, v); }
  // a leg's two fields (get(): the places now; put(x, value): set on the element)
  // an element's places, read once per rendering of the inspector (each row's leg reads them)
  const placesRead = new Map();
  const placesNow = (id, places) => { if (!placesRead.has(id)) placesRead.set(id, places(now(id))); return placesRead.get(id); };
  // in a table: the length in the column's unit (a number to the metre), the bearing to a tenth
  const legFields = (id, places, k, put, what) => [
    F.dist(() => legOf(placesNow(id, places), k).s, (m) => set(id, (x) => put(x, k, { s: m })), `${what} ${k + 1} leg length`, { in: colUnit() }),
    F.angle(() => legOf(placesNow(id, places), k).azi, (a) => set(id, (x) => put(x, k, { azi: a })), `${what} ${k + 1} leg bearing (degrees true)`, { fixed: 1 })];
  // a table of places' first columns, # pinned; with its leg and bearing 304 px, inside Properties' 320
  // with a scroll bar: degrees in 6 decimals, distances to the metre (up to 999 km), bearings to a tenth
  const PLACE_COLUMNS = [{ head: '#', width: 28, frozen: true, cls: 'num' }, { head: 'Lat', width: 80, cls: 'n' }, { head: 'Lon', width: 88, cls: 'n' }];
  // a table's distances: one unit for the column (its head says it), km or NM as the display's
  const colUnit = () => (ctx.units() === 'nm' ? 'nm' : 'km');
  const colUnitText = () => (ctx.units() === 'nm' ? 'NM' : 'km');
  const inUnit = (m) => (m / (ctx.units() === 'nm' ? 1852 : 1000)).toFixed(3);
  // a table of places (a line's points, an area's corners, a point's parts): its row k made current
  // (k: the place's index), the table at its page; from the map (a place pressed: drawing.place)
  function pickPlace(table, k, paged = true) {
    const from = paged ? k - (k % PAGE) : 0, name = paged ? `${table}@${from}` : table;
    if (paged) pageAt.set(table, from);
    setCurrent(name, k - from);
    renderInspector();
    inspector.querySelector(`[data-grid="${CSS.escape(name)}"] tr[data-r="${k - from}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  // A long list a page at a time (drawing-ui.md §5): PAGE rows, from the page shown (each list's own,
  // this session), and ‹ › under it; Copy still takes every row. rows: the absolute rows
  // shown, in order.
  const PAGE = 100, pageAt = new Map();
  function paged(name, total) {
    const from = Math.min(pageAt.get(name) ?? 0, Math.max(0, total - 1) - (Math.max(0, total - 1) % PAGE)), to = Math.min(total, from + PAGE);
    const go = (f) => { pageAt.set(name, f); renderInspector(); };
    const pager = total > PAGE ? h('div', { class: 'lpager' },
      // data-key: the page each goes to (morph keeps a button only when it does the same)
      h('button', { type: 'button', class: 'small', 'aria-label': 'Previous rows', 'data-key': `to ${from - PAGE}`, disabled: !from, onclick: () => go(from - PAGE) }, '‹'),
      h('span', { class: 'funit' }, `${from + 1}–${to} of ${total}`),
      h('button', { type: 'button', class: 'small', 'aria-label': 'Next rows', 'data-key': `to ${from + PAGE}`, disabled: to >= total, onclick: () => go(from + PAGE) }, '›')) : null;
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
  let profileBuilt = 0;
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
    return h('div', { class: 'fblock', 'data-key': `profile ${++profileBuilt}` }, h('h3', {}, 'Profile', close), // profileCursor is this one's: never kept by morph
      row('Depth', h('span', { class: 'fvalue' }, `${fmtDepth(shallowest.z)} to ${fmtDepth(deepest.z)}`), at),
      chart,
      row('Seabed', h('span', { class: 'fvalue', title: 'Each step\'s length counting the change in depth: a lower bound, as relief finer than the depth grid (about 460 m) is not in it' },
        `${fmtDist(seabed, u)} along the seabed · ${fmtDist(length, u)} on the surface`),
      h('button', { type: 'button', class: 'small', title: 'The profile as a CSV file: distance along, depth, latitude, longitude', onclick: () => ctx.download(profileCsv(p.prof), `${(el.name || 'line').replace(/[^\w-]+/g, '-')}-profile.csv`, 'text/csv') }, 'CSV')));
  }
  // pointing at a line on the map whose profile is shown: its place on the chart
  // a double-click on an element, with no tool on, turns Properties on (the map does not zoom)
  map.on('dblclick', (e) => { if (!drawing.tool && drawing.hitAt(e.point).length) { e.preventDefault(); ctx.frame.setProps(true); } });
  map.on('mousemove', (e) => {
    if (!profileCursor || drawing.sel.size !== 1) return;
    const id = [...drawing.sel][0], x = find(drawing.doc, id);
    if (x?.kind !== 'line' || !profileShown.has(id)) return;
    if (drawing.hitAt(e.point, 6).includes(id)) profileCursor(nearestAlong(lineTrace(drawing.doc, x.el).coords, [e.lngLat.lng, e.lngLat.lat]));
  });

  function lineInspector(id) {
    const doc = drawing.doc, el = now(id);
    const line = lineTrace(doc, el);
    const at = line.at;
    const insertAfter = (i) => drawing.change((doc) => {
      const x = find(doc, id).el, ps = positionsOf(x), a = ps[i + 1], b = ps[i + 2];
      addVertex(doc, x, i + 1, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); // what points at its vertices and edges stays where it is
    });
    const removeAt = (i) => drawing.change((doc) => removeVertex(doc, find(doc, id).el, i));
    const splitAt = (i) => { let p; drawing.change((d) => { p = splitKeeping(d, id, i); }); note(`Split: both parts attached to ${label('point', p)}`); };
    // Its points as rows, numbered 1 (its start) to N (its end), the vertices between: a page of them
    // shown. Lat, Lon; the leg from the point before (typed: this point moves); along, from the start;
    // a vertex's name. An end attached: what to, its leg as it is.
    const n = el.vertices.length, N = n + 2, ps = positionsOf(el);
    const coord = (k, axis, get, put) => F.coord(axis, get, put, `Point ${k + 1} ${axis === 'lat' ? 'latitude' : 'longitude'}`, 6);
    const vcoord = (k, axis) => coord(k, axis, () => now(id).vertices[k - 1].position[axis === 'lat' ? 1 : 0],
      (v) => set(id, (x) => { const p = x.vertices[k - 1].position; x.vertices[k - 1].position = axis === 'lat' ? [p[0], v] : [v, p[1]]; }));
    const value = (t) => h('span', { class: 'fvalue' }, t);
    const endKey = (k) => (k === 0 ? 'start' : 'end');
    const endCells = (k) => {
      const key = endKey(k);
      if (el[key].element) return [link(el[key].element), null];
      const at = (axis) => coord(k, axis, () => now(id)[key].position[axis === 'lat' ? 1 : 0],
        (v) => set(id, (x) => { const q = x[key].position; x[key] = { position: axis === 'lat' ? [q[0], v] : [v, q[1]], element: null }; }));
      return [at('lat'), at('lon')];
    };
    const legCells = (k) => (k === N - 1 && el.end.element ? [value(inUnit(legOf(ps, k).s)), value(legOf(ps, k).azi.toFixed(1))] : legFields(id, positionsOf, k, setLineLeg, 'Point'));
    const name = (k) => field(() => now(id).vertices[k - 1].name, (t) => t, (nv) => set(id, (x) => { x.vertices[k - 1].name = nv; }), { 'aria-label': `Point ${k + 1} name` });
    const rowAt = (k) => ({ cls: k === 0 || k === N - 1 ? 'vnode' : null,
      cells: [k === 0 || k === N - 1 ? h('span', { title: k ? 'Its end' : 'Its start' }, `${k + 1}`) : `${k + 1}`,
        ...(k === 0 || k === N - 1 ? endCells(k) : [vcoord(k, 'lat'), vcoord(k, 'lon')]),
        ...(k ? legCells(k) : [null, null]), value(inUnit(at[k] || 0)), k === 0 || k === N - 1 ? null : name(k)] });
    // an end's Attach to… (the next click on the map chooses what to) and Detach (free where it is)
    const endActs = (key) => {
      const waiting = drawing.repointing?.id === id && drawing.repointing.key === key;
      const attach = h('button', { type: 'button', class: 'small', 'aria-pressed': String(waiting), 'aria-label': `Attach ${key} to…`,
        title: 'Then click a point, a vertex, an edge, a line or an area to attach it there, or anywhere for a position (Esc: cancel)',
        onclick: () => { if (waiting) drawing.cancelRepoint(); else drawing.startRepoint(id, key); renderInspector(); } }, 'Attach to…');
      return [attach, el[key].element ? act('Detach', 'Keep it where it is, no longer following what it is attached to', () => set(id, (x) => { x[key] = freeRef(x[key]); })) : null].filter(Boolean);
    };
    const pg = paged(`${id}:points`, N), abs = (r) => pg.rows[r];
    const U = colUnitText();
    const table = listGrid({ name: pg.name,
      columns: [...PLACE_COLUMNS, { head: `Leg ${U}`, width: 56, cls: 'n', title: 'The straight leg from the point before: its length (typed: this point moves, the legs either side of it change)' },
        { head: 'Brg °T', width: 52, cls: 'n', title: 'The leg\'s bearing, degrees true (typed: this point moves)' },
        { head: `Along ${U}`, width: 80, cls: 'num', title: 'The distance from its start' }, { head: 'Name', width: 110 }],
      rows: pg.rows.map(rowAt),
      actions: (rr, k = abs(rr)) => (k === 0 ? { label: 'Point 1, its start', buttons: [act('Insert after', 'A vertex halfway to the next (Insert)', () => insertAfter(-1)), ...endActs('start')] }
        : k === N - 1 ? { label: `Point ${N}, its end`, buttons: endActs('end') }
          : { label: `Point ${k + 1}`, buttons: [act('Insert after', 'A vertex halfway to the next (Insert)', () => insertAfter(k - 1)),
            act('Delete', 'Take this point away (Ctrl/⌘ Delete)', () => removeAt(k - 1)), act('Split', 'Split the line here: this point becomes a point both parts are attached to', () => splitAt(k - 1))] }),
      keys: { insert: (rr) => { const k = abs(rr); if (k < N - 1) insertAfter(k - 1); }, remove: (rr) => { const k = abs(rr); if (k >= 1 && k <= n) removeAt(k - 1); } },
      current: (rr) => drawing.markPlace(rr == null ? null : positionsOf(now(id))[abs(rr)]) });
    const pointRows = () => { const x = now(id), qs = positionsOf(x), t = lineTrace(drawing.doc, x).at;
      return [['#', 'Lat', 'Lon', 'Leg m', 'Brg °', 'Along m', 'Name'], qs.map((q, k) => { const g = k ? legOf(qs, k) : null; return [k + 1, q[1], q[0], g ? +g.s.toFixed(3) : '', g ? +g.azi.toFixed(1) : '', +(t[k] || 0).toFixed(3), x.vertices[k - 1]?.name ?? '']; })]; };
    const off = el.look.offset ?? null, offNow = offsetOf(drawing.doc, el);
    return [...commonTop('line', id),
      row('Length', distValue(line.length)),
      offNow && off == null ? h('p', { class: 'note' }, `Drawn ${Math.abs(offNow)} px to the ${offNow > 0 ? 'right' : 'left'} of its line, the drawing's Offset. Its length is the real one.`) : null,
      profileBlock(id),
      row('Path', segOf('Path', [[false, 'Straight', 'Geodesics, as measured'], [true, 'Smooth', 'A curve through its bends, following them; its length measured along it']], !!el.smooth, (v) => set(id, (x) => { x.smooth = v; }))),
      row('', h('button', { type: 'button', class: 'small', title: 'Copies placed along this line, every so far or so many, which then follow it; they can be connected to roots', onclick: () => openDistribution({ element: id, part: null }) }, 'Distribute along…')),
      h('div', { class: 'fblock' }, h('h3', { title: 'Where the line runs, from its start (1) to its end. A row clicked is ringed on the map; a point pressed on the map picks its row.' }, `Points (${N})`, copyBtn(pointRows)),
      table, pg.pager), // wider than the panel: it scrolls sideways, its number kept
      lookBlock([item(id)]), ...commonBottom('line', id)];
  }

  function groupInspector(id) {
    const doc = drawing.doc;
    const direct = membersOf(doc, id);
    const below = membersOf(doc, id, true).filter((x) => x.kind !== 'group'); // everything in it, its subgroups' too
    const shownEye = eyeFor(drawing, icon, () => membersOf(drawing.doc, id, true), 'members');
    shownEye.render();
    // its members as the tree counts them (everything in it, its subgroups' too), and its subgroups
    const allSubs = membersOf(doc, id, true).length - below.length;
    // its totals as the drawing's, its members only, by subgroup (its own: under its name)
    const totalsOf = below.length ? totalsBlock(null, (gid) => (gid ? groupPath(doc, doc.groups.find((g) => g.id === gid)) : ''), breakdown(doc, null, new Set(below.map((x) => x.el.id))), '') : null;
    return [...commonTop('group', id),
      row('Members', h('span', { class: 'fvalue' }, [plural(below.length, 'element'), allSubs ? plural(allSubs, 'subgroup') : ''].filter(Boolean).join(' · ')), direct.length ? shownEye : null),
      row('', h('button', { type: 'button', class: 'small', title: 'Everything in it, its groups\' too', disabled: !below.length, onclick: () => drawing.select(below.map((x) => x.el.id)) }, 'Select members')),
      totalsOf,
      lookBlock([item(id)], null, 'Look · sets each member'), ...commonBottom('group', id)];
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
      h('button', { type: 'button', class: 'chipname', title: 'Select this one only', onclick: () => drawing.select([x.el.id]) }, icon(...KIND_ICON[x.kind]), shownName(drawing.doc, x.kind, x.el, ctx.units())),
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
    between ? row('Distance', distValue(between.s)) : null,
    between ? row('Bearing', fvalue(norm360(between.azi).toFixed(1), { title: `From ${label(xs[0].kind, xs[0].el)}` }), funit('°T')) : null,
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
      con.pattern === 'tree' ? row('Min. branch', withUnit(F.dist(() => con.minBranch, (m) => { con.minBranch = m; redo(); }, 'Shortest branch', { zero: true,
        title: 'Each hub at least this far from its points and from its root. 0: where the lines are shortest, on a point if need be' }))) : null,
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
    const dist = (key, aria, zero) => withUnit(F.dist(() => dform[key], (m) => { dform[key] = m; redo(); }, aria, { zero }));
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
      row('Offset', pair(dist('offset', 'Offset', true), '·', select('Side', [['left', arc ? 'Out' : 'Left'], ['right', arc ? 'In' : 'Right'], ['alternate', 'Alternate']], dform.side, (v) => { dform.side = v; redo(); }))),
      row('Copy', select('Copy', [...Object.keys(BUILT_IN).map((k) => [k, builtInName(k)]), ...mine.map((x) => [`preset:${x.name}`, x.name])], dform.preset, choose, { title: 'What each copy is: a built-in kind, or a preset of yours' })),
      dform.copy ? row('Radius', distValue(reach, { title: 'The preset\'s own size' }))
        : row('Radius', withUnit(F.dist(() => dform.radius, (m) => { dform.radius = m; redo(); }, 'Radius', { check: (m) => (m >= MAX_RADIUS ? 'too large' : null), title: dform.preset === 'circle' ? 'Each circle\'s, whatever the spacing' : 'Its largest part\'s reach, whatever the spacing' }))),
      dform.preset === 'circle' ? row('Sector', segOf('Sector', [[null, 'None', 'circles'], ...[90, 180, 270].map((a) => [a, `${a}°`, arc ? 'facing outwards' : 'facing away from the line'])], dform.aperture, (v) => { dform.aperture = v; redo(); })) : null,
      editing ? null : row('In group', select('Group', [['', 'none (at the top)'], ...doc.groups.map((g) => [g.id, groupPath(drawing.doc, g)])], dform.groupId ?? '', (v) => { dform.groupId = v || null; }, { title: 'Where its own group goes' })),
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
  function drawingInspector() {
    const m = drawing.doc.meta;
    const meta = (key, aria, area) => F.text(() => m[key], (v) => drawing.change((doc) => { doc.meta[key] = v; }), aria, area ? 2 : 0);
    const n = drawElements().length;
    const groupName = (gid) => (gid ? groupPath(drawing.doc, drawing.doc.groups.find((g) => g.id === gid)) : 'Not grouped');
    const keys = [...new Set(elements(drawing.doc).flatMap((x) => x.el.properties.map((p) => p.key)))].sort((a, b) => a.localeCompare(b));
    if (totalsBy && !keys.includes(totalsBy)) { totalsBy = ''; computeFacts(); } // its key gone
    const by = select('Totals by', [['', 'group'], ...keys.map((k) => [k, k])], totalsBy || '', (v) => { totalsBy = v; computeFacts(); renderInspector(); });
    const offsetElsewhere = elements(drawing.doc).filter((x) => x.el.look?.offset != null); // where Offset is set on an element
    title = `Drawing · ${m.title?.trim() || 'Untitled drawing'}`;
    const titleField = Object.assign(meta('title', 'Title'), { placeholder: 'Untitled drawing' }); // what the tree and the bar call it while it has none
    return [row('Title', titleField), row('Description', meta('description', 'Description', true)), row('Author', meta('author', 'Author')),
      lookBlock([{ kind: 'drawing', el: drawing.doc }], ['text.name', 'offset', 'minSize'], 'Display', [
        offsetElsewhere.length ? h('p', { class: 'note' }, 'Offset also set on ', ...offsetElsewhere.map((x) => link(x.el.id))) : null,
        row('Leg bearings', check('', ctx.display.bearings, (v) => ctx.setDisplay({ bearings: v }), { 'aria-label': 'Leg bearings', title: 'Each leg\'s bearing (°T) beside its length, where values are shown' }))]),
      n > 1 ? totalsBlock(keys.length ? by : null, groupName) : null,
      drawing.saving.failed ? h('p', { class: 'note warn' }, 'This browser does not let the drawing be saved (storage full or turned off): Download › Drawing (GeoJSON), in the bar, keeps it as a file.') : null,
      drawing.saving.otherTab ? h('p', { class: 'note warn' }, 'The drawing was changed in another tab. Saving here replaces that version. ', h('button', { type: 'button', class: 'small', onclick: () => location.reload() }, 'Reload')) : null];
  }
  // The Totals view (docs/drawing-ui.md §5): the lines by group (or by a property's values), each
  // listed under its group, those a connection made summed by what they are (trunks and branches; a
  // chain's root links and the links between points); the areas; the points by kind. A group's rows
  // fold; Copy gives every row tab-separated, in metres, for a spreadsheet
  const MADE_PART = { trunk: 'trunks, root → hub', branch: 'branches, hub → point', 'root link': 'root → first point', link: 'between points' };
  // b: what is counted (the drawing's, or a group's: breakdown's only); key: the property it is by, or ''
  function totalsBlock(by, groupName, b = fx().breakdown, key = totalsBy) {
    const u = ctx.units(), doc = drawing.doc;
    // a group holding a connection: its pattern and roots beside the name (two are both "Connection")
    const made = (k) => { const c = k && connections(doc).find((x) => x.groupId === k); return c ? ` (${c.pattern}, from ${c.roots.map((r) => label('point', now(r.id))).join(', ')})` : ''; };
    const keyName = (k) => (key ? (k ? `“${k}”` : `No ${key}`) : groupName(k) + made(k));
    const td = (x, cls = '') => h('td', { class: cls }, x), num = (x) => td(x, 'num');
    // a row that acts (folds a group, selects an element): the whole row the target, by pointer or keys
    const acts = (cls, title, fn, ...cells) => h('tr', { class: `${cls} acts`, role: 'button', tabindex: 0, title, onclick: fn, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } } }, ...cells);
    const sec = (title, ...heads) => h('tr', { class: 'sec' }, td(title), ...heads.map((x) => num(x)));
    const rows = [], copy = []; // copy: [section, group, name, count, length m, area m², perimeter m]
    const nameOf = (kind, id) => label(kind, find(doc, id).el);
    const lineRows = [...b.lines.rows].sort((p, q) => (!p.key) - (!q.key) || keyName(p.key).localeCompare(keyName(q.key)));
    const one = lineRows.length === 1 && (!lineRows[0].key || !groupName) && !key; // nothing grouped: no group rows (by a property, the row says "No …")
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
      rows.push(sec('Points', 'Count', ''));
      for (const [k, c] of [...b.points.kinds].sort((p, q) => q[1] - p[1])) { const name = key ? keyName(k) : POINT_KIND_NAME[k] ?? OUTLINE_NAME[k] ?? k; rows.push(h('tr', { class: 'item top' }, td(name), num(String(c)), td(''))); copy.push(['Points', '', name, c, '', '', '']); }
      rows.push(h('tr', { class: 'all' }, td('All points'), num(String(b.points.count)), td('')));
      copy.push(['Points', '', 'All points', b.points.count, '', '', '']);
    }
    const hidden = b.lines.hidden || b.areas.hidden || b.points.hidden;
    const head = ['Section', key || 'Group', 'Name', 'Count', 'Length (m)', 'Area (m²)', 'Perimeter (m)'];
    const r1 = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v);
    return h('div', { class: 'fblock' }, h('h3', {}, 'Totals', copyBtn(() => [head, copy.map((c) => c.map(r1))])),
      by ? row('By', by) : null,
      h('table', { class: 'vtable totals' }, h('tbody', {}, rows)),
      h('p', { class: 'note' }, `Guides and measurements are left out; lines running together each count${hidden ? '; hidden ones are counted' : ''}.`));
  }
  // Built again on each change, and put in place of what it shows (dom.js morph): what stays the same
  // stays, with its focus, caret and scroll, so Tab and a click from a field just applied land where
  // they go. Something else shown (another selection, a form): built anew.
  let shows = null;
  function renderInspector() {
    placesRead.clear();
    const xs = drawing.selected();
    if (form && selKey() !== form.sel) closeForm();
    const what = `${form ? `${form.kind}:${form.sel}` : ''}|${selKey()}`;
    // a field being edited, when something else is to be shown, is applied first, to the element it belongs to
    if (what !== shows && inspector.contains(document.activeElement)) document.activeElement.blur();
    const kids = form ? (form.kind === 'distribute' ? distributionForm() : connectForm()) : !xs.length ? drawingInspector()
      : xs.length > 1 ? severalInspector(xs)
        : { point: pointInspector, area: areaInspector, line: lineInspector, group: groupInspector, label: labelInspector }[xs[0].kind](xs[0].el.id);
    const top = inspector.scrollTop;
    if (what === shows) morph(inspector, h('div', {}, kids.flat().filter(Boolean)));
    else inspector.replaceChildren(...kids.flat().filter(Boolean));
    shows = what;
    inspector.scrollTop = top;
    renderHead(xs);
    tree.markDrawing(showDrawing && !xs.length);
    ctx.frame.has(!!form || xs.length > 0 || showDrawing); // Properties shown while it has something, and is on
  }
  // The inspector's head (drawing-ui.md §5): what it shows, then Zoom to, Duplicate, Group and Delete
  // for the selection (with nothing selected, Zoom to all of it; none while a form is open).
  function renderHead(xs = drawing.selected()) {
    inspTitle.textContent = title;
    const ids = xs.map((x) => x.el.id), every = ids.length ? ids : elements(drawing.doc).map((x) => x.el.id);
    const act = (paths, aria, title, run) => h('button', { type: 'button', class: 'hact', 'aria-label': aria, title, onclick: run }, icon(...paths));
    inspActs.replaceChildren(...(form ? [] : [
      every.length ? act(UI_ICON.zoom, 'Zoom to', ids.length ? 'Zoom to: fit the map to it' : 'Zoom to: fit the map to the whole drawing', () => showOnMap(new Set(every))) : null,
      ids.length ? act(UI_ICON.duplicate, 'Duplicate', `Duplicate: a copy beside it (${MOD} D)`, () => { const n = drawing.duplicate(); if (n) note(`Duplicated: ${plural(n, 'element')}`, () => drawing.undo()); }) : null,
      ids.length ? act(UI_ICON.group, 'Group', 'Group: a new group of it, in the group it is in', () => groupThem(ids)) : null,
      ids.length ? act(UI_ICON.delete, 'Delete', 'Delete (Delete)', () => del(ids)) : null,
    ].filter(Boolean)));
  }

  // ---- map and files --------------------------------------------------------------------------
  function showOnMap(ids) {
    const b = boundsOf(drawing.doc, ids);
    if (b) map.fitBounds(b, { padding: ctx.free?.() ?? 60, maxZoom: 16 }); // clear of the panel
  }
  root.replaceChildren(tree.box);
  ctx.props.append(inspHead, inspector);
  renderList();
  renderTools();

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
      const dir = e.key === ']' ? -1 : 1, ids = tree.shown().map((x) => x.el.id).filter((id) => drawing.sel.has(id));
      drawing.change((doc) => { for (const id of dir < 0 ? ids : ids.reverse()) moveStep(doc, id, dir); });
      return;
    }
    // deleting: Delete; on a Mac, whose delete key is Backspace, ⌘-Backspace as in the Finder. Never
    // Backspace alone, which takes back a point while drawing (here and in Measure)
    if (!typed && (e.key === 'Delete' || (mac && e.metaKey && e.key === 'Backspace')) && drawing.sel.size) { e.preventDefault(); del([...drawing.sel]); return; }
    if (typed || mod || e.altKey) return;
    // the tools' keys: app.js, from anywhere
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && tree.step(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
    else if (e.key === 'F2' && drawing.sel.size === 1) { e.preventDefault(); tree.rename([...drawing.sel][0]); }
  });

  // ---- rendering ---------------------------------------------------------------------------
  return {
    render(what) {
      if (what === 'tool') return renderTools();
      if (what === 'draft') return tools.renderTouch();
      if (what === 'drag') return renderInspector(); // once a frame (drawing.js): in place, the tree after it is let go
      // a line's point or an area's corner pressed on the map: its row in the table made current
      if (what === 'place') { const { id, index } = drawing.place; if (drawing.sel.size === 1 && drawing.sel.has(id)) pickPlace(`${id}:${{ line: 'points', area: 'corners', point: 'parts' }[kindOf(id)]}`, index, kindOf(id) !== 'point'); return; }
      if (what === 'area') { // a Select drag ended: say what it did, even when nothing was inside
        const n = drawing.sel.size;
        note(n ? `${plural(n, 'element')} selected` : 'Nothing lies entirely inside the box');
      }
      // a label just placed (and selected, so shown): its text ready to be typed
      if (what === 'placed') { const t = inspector.querySelector('.ltext'); t?.focus(); t?.select(); return; }
      // the selection only changed: the rows marked again, not built again (each row's value is a length
      // or an area, computed)
      if (what === 'sel') {
        showDrawing = false; // something else selected, or nothing (the drawing's row: openDrawing)
        tree.mark();
      } else renderList();
      renderInspector();
      if (form && what === 'doc') formPreview(); // the form's preview follows the drawing (an undo, its line edited)
      if (what === 'doc') for (const id of profiles.keys()) if (!find(drawing.doc, id)) { profiles.delete(id); profileShown.delete(id); } // a line gone: its profile too
      renderTools();
    },
    importFile: (f) => files.importFile(f), // a file dropped on the map (app.js)
    press: tools.press, cycle: tools.cycle, // the tools' keys (app.js)
  };
}
