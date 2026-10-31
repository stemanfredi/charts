// The drawing's panels (docs/drawing-ui.md): the tools in the bar (tools.js), the tree of the
// drawing's elements in the left panel (tree.js), and Properties in the right one, which shows what is selected (or, with nothing
// selected, the drawing itself) and edits it with fields. Fields apply on Enter or when they lose
// focus, one undo step each.

import { h, svg, typing, morph, animate, NARROW } from '../dom.js';
import { ask, askText, note } from '../menu.js';
import { FINGER } from './layers.js';
import { find, elements, groupsOf, membersOf, leavesOf, canHold, label, KIND, POINT_KIND_NAME, lookOf, lookField, setLook, LOOK_FIELDS, addPart, makePart, followedPart, mainOutline, roundParts, PART_KINDS, ROUND, SYMBOLS, LABEL_OFFSET, makeGroup, setGroup, moveStep, MAX_RADIUS, MAX_OFFSET, MAX_MIN_SIZE, STROKE_WIDTH, linkFrom, setLink, fewestPlaces } from './document.js';
import { insertPlace, deletePlace, reattach, partName, splitLine, lineRef, resolve, along } from './attach.js';
import { labelValues, labelText, TOKENS } from './labels.js';
import { OUTLINE_NAME } from './outlines.js';
import { lineTrace, totals, breakdown, nearestAlong } from './lines.js';
import { profileCsv } from './profile.js';
import { DISTRIBUTE_D, distribute, lines, planConnection, makeDistribution, editDistribution, connect, reconnect, alongTrace, alongOf,
  distributions, connections, ruleOf, changedByHand, giveBack, removePartOf, MAX_COPIES, MAX_TREE } from './generator.js';
import { BUILT_IN, builtInName } from './place.js';
import { boundsOf, drawable } from './features.js';
import { inverse, destination } from '../geodesy.js';
import { norm180, norm360 } from '../geo.js';
import { fields, choice, select, check } from '../fields.js';
import { mac, MOD } from '../keys.js';
import { loadPresets, savePresets, presetOf, presetTool } from './presets.js';
import { listGrid, setCurrent, currentOf } from './grid.js';
import { fmtArea, fmtDist, fmtElevation, rowsText, plural, distText, UNIT_TEXT, inUnit } from '../format.js';
import { fileGroup } from './files.js';
import { createTools } from './tools.js';
import { createTree, kindTitle, groupPath, eyeFor, shownName } from './tree.js';
import { icon, UI_ICON, SYMBOL_ICON } from '../icons.js';

// what Parts calls each kind of part
const PART_NAME = { circle: 'Circle', sector: 'Sector', ...OUTLINE_NAME };
const SYMBOL_TITLE = { diamond: 'Diamond', square: 'Square', triangle: 'Triangle', dot: 'Dot', none: 'None' };
const WIDTH_NAME = { 'aerial-vehicle': 'Span', 'surface-vehicle': 'Beam', 'underwater-vehicle': 'Diameter' }; // a shape's width, as said of each outline

// root: the left panel's Elements tab. ctx: { drawing, map, bar
// (the bar, its tools here), props (the right panel: the inspector), frame (frame.js), outputs, offlineItem, copyLink(), about() (files.js),
// onImport(doc, view) (an imported document, the view it was made in), openDrawing(id), openArea(file), download(text, name), profile(trace) }
export function drawView(root, ctx) {
  const { drawing, map } = ctx;
  const F = fields({ note, units: drawing.units }), { field } = F; // fields.js: each applies on Enter or when left
  // a longitude past ±180° (clicked on a world copy) shown in range, as the file writes it: the field
  // would refuse it back
  const { coord, position } = F, inRange = (v) => (v == null ? v : norm180(v));
  F.coord = (axis, get, ...rest) => coord(axis, axis === 'lon' ? () => inRange(get()) : get, ...rest);
  F.position = (get, ...rest) => position(() => { const p = get(); return [inRange(p[0]), p[1]]; }, ...rest);
  let facts = null; // the totals: computed once per change, when the list or the inspector reads them
  let totalsBy = ''; // the drawing's totals by group (''), or by the values of a property (its key)
  const totalsFolded = new Set(); // the Totals view's groups folded (by key)
  const computeFacts = () => (facts = { totals: totals(drawing.doc), breakdown: breakdown(drawing.doc, totalsBy || null) });
  const fx = () => facts || computeFacts();

  drawing.presets = loadPresets();
  const files = fileGroup(drawing, ctx, () => renderTools());
  const tools = createTools(drawing, ctx, { del, fileBtns: files.buttons });
  const { renderTools } = tools;

  // ---- the tree (tree.js), its first row the drawing ------------------------------------------
  const tree = createTree(drawing, { facts: fx });
  // the tree built only while it is seen (a large drawing's rows cost tens of ms per change); built
  // when its tab opens (render('tool'), after any change of the frame)
  let listStale = false;
  const listSeen = () => !root.closest('[hidden]');
  const renderList = () => { facts = null; listStale = !listSeen(); if (!listStale) tree.render(); };
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
        [['all', 'Delete the group and everything in it'], ['ungroup', 'Delete the group only (members kept)']]); // the main button keeps the most
      if (!a) return;
      withMembers = a === 'all';
    }
    drawing.remove(ids, withMembers); // lines attached to a point deleted stay, their places free where they were
  }

  // ---- inspector: fields ----------------------------------------------------------------------
  const inspector = h('div', { class: 'dinspect' });
  // the element id as it is now (a field's closure keeps the id, never a stale object)
  const now = (id) => find(drawing.doc, id)?.el;
  const set = (id, fn) => drawing.change((doc) => fn(find(doc, id).el, doc));
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
  // a value's unit beside it, in grey (drawing-ui.md §5: never inside the text): a distance field's
  // (fields.js unitText), or a formatted value's ("10.08 km" → 10.08 · km)
  const funit = (t) => h('span', { class: 'funit' }, t);
  const withUnit = (input) => [input, funit(input.unitText())];
  const fvalue = (t, attrs = {}) => h('span', { class: 'fvalue', ...attrs }, t);
  const valued = (text, attrs = {}) => { const i = text.lastIndexOf(' '); return i < 0 ? [fvalue(text, attrs)] : [fvalue(text.slice(0, i), attrs), funit(text.slice(i + 1))]; };
  const distValue = (m, attrs = {}) => valued(fmtDist(m, drawing.units()), attrs);
  const segOf = (aria, options, current, pick) => choice(aria, options, () => current, pick);

  // The look of xs ({ kind, el }, one or several; a group: everything in it; the drawing: { kind:
  // 'drawing', el: doc }): each field what they are drawn with (document.js lookOf: their own value,
  // else the drawing's), "mixed" where they differ; a change sets it on each of them, ↺ takes it back.
  // A group has no look of its own: it reaches its members. Only the fields their kinds have (a line
  // no fill, a label its text, a shape its minimum size); fields: those to show, else all of those.
  // xs with each group replaced by its members (its subgroups' too), none twice; the drawing as it is
  const flat = (xs) => (xs[0]?.kind === 'drawing' ? xs : leavesOf(drawing.doc, xs.map((x) => x.el.id)));
  function lookBlock(xs, fields = null, title = 'Look', extra = []) {
    const doc = drawing.doc;
    xs = flat(xs);
    if (!xs.length && !extra.length) return null; // an empty group
    const has = (x, f) => LOOK_FIELDS[x.kind].includes(f) && !(f === 'text.values' && x.kind === 'point' && !roundParts(x.el).length) // a point's values: its radii
      && !(f.startsWith('fill.') && x.kind === 'line' && !x.el.closed); // a line's fill: drawn while it is closed
    const shown = (f) => (!fields || fields.includes(f)) && xs.some((x) => has(x, f));
    const looks = xs.map((x) => lookOf(doc, x.el));
    const same = (f) => { const vs = xs.map((x, i) => (has(x, f) ? lookField(looks[i], f) : undefined)).filter((v) => v !== undefined); return vs.every((v) => v === vs[0]) ? vs[0] : null; };
    const target = (d, x) => (x.kind === 'drawing' ? d : find(d, x.el.id).el);
    // live: shown as it changes (a colour being picked), the undo step made when it is set
    const put = (f, v, live = false) => (live ? drawing.preview : drawing.change).call(drawing, (d) => { for (const x of xs) if (has(x, f)) setLook(target(d, x), f, v); });
    // what ↺ gives back: the drawing's, for what the drawing sets; else the default
    const aboveOf = (f) => (xs.some((x) => x.kind === 'drawing') || !LOOK_FIELDS.drawing.includes(f) ? 'the default' : 'the drawing\'s');
    const back = (...fs) => (xs.some((x) => fs.some((f) => has(x, f) && lookField(x.el.look, f) !== undefined))
      ? h('button', { type: 'button', class: 'x', title: `Back to ${aboveOf(fs[0])}`, 'aria-label': `${fs[0]} back to ${aboveOf(fs[0])}`,
        onclick: () => drawing.change((d) => { for (const x of xs) for (const f of fs) if (has(x, f)) setLook(target(d, x), f, undefined); }) }, '↺') : null);
    const mixed = (v) => (v === null ? h('span', { class: 'mixed' }, 'mixed') : null);
    const colour = (f, aria) => {
      const v = same(f);
      return [h('input', { type: 'color', value: v ?? lookField(looks[0], f) ?? '#000000', 'aria-label': aria, oninput: (e) => put(f, e.target.value, true), onchange: (e) => put(f, e.target.value) }), mixed(v)];
    };
    const num = (f, aria, lo, hi, title) => F.number(() => same(f), (v) => put(f, v), aria, { min: lo, max: hi, placeholder: 'mixed', bad: `a number from ${lo} to ${hi}`, title });
    const tick = (f, text, title) => row(text, check('', same(f), (v) => put(f, v), { 'aria-label': text, title }), back(f));
    // Fill and Stroke: rows of the grid like any other (a colour, its opacity), Width and Dash their own
    // an opacity as a percentage (kept as 0 to 1)
    const opacity = (f, aria) => [F.number(() => { const v = same(f); return v === null ? null : Math.round(v * 100); }, (v) => put(f, v / 100), aria, { max: 100, placeholder: 'mixed', bad: 'a percentage, 0 to 100', title: 'Opacity' }), funit('%')];
    return h('div', { class: 'fblock' }, h('h3', {}, title),
      shown('fill.color') ? row('Fill', colour('fill.color', 'Fill colour'), opacity('fill.opacity', 'Fill opacity (%)'), back('fill.color', 'fill.opacity')) : null,
      shown('stroke.color') ? row('Stroke', colour('stroke.color', 'Stroke colour'), opacity('stroke.opacity', 'Stroke opacity (%)'), back('stroke.color', 'stroke.opacity')) : null,
      shown('stroke.width') ? row('Width', num('stroke.width', 'Stroke width (px)', ...STROKE_WIDTH), funit('px'), back('stroke.width')) : null,
      shown('stroke.dash') ? row('Dash', segOf('Dash', [['solid', '—', 'Solid'], ['dashed', '- -', 'Dashed'], ['dotted', '···', 'Dotted']], same('stroke.dash'), (v) => put('stroke.dash', v)), back('stroke.dash')) : null,
      shown('text.size') ? row('Text size', segOf('Text size', [['small', 'S', 'Small'], ['medium', 'M', 'Medium'], ['large', 'L', 'Large']], same('text.size'), (v) => put('text.size', v)), back('text.size')) : null,
      shown('text.color') ? row('Text colour', colour('text.color', 'Text colour'), back('text.color')) : null,
      shown('text.background') ? row('Background', segOf('Background', [['halo', 'Halo', 'A white halo'], ['box', 'Box', 'A white box']], same('text.background'), (v) => put('text.background', v)), back('text.background')) : null,
      shown('text.name') ? tick('text.name', xs.length > 1 || xs[0].kind === 'drawing' ? 'Names on map' : 'Name on map', 'Names are left out where they would collide; zooming in shows them') : null,
      shown('text.values') ? tick('text.values', 'Show values', 'Values on the map: each leg\'s length, a closed line\'s area and perimeter, each radius') : null,
      shown('offset') ? row('Offset', F.number(() => same('offset'), (v) => put('offset', v), 'Offset (px)', { min: -MAX_OFFSET, max: MAX_OFFSET, placeholder: 'mixed', bad: `pixels from −${MAX_OFFSET} to ${MAX_OFFSET}`,
        title: 'Pixels beside its line, on screen only' }), funit('px'), back('offset')) : null,
      shown('minSize') ? row('Min. size', F.number(() => same('minSize'), (v) => put('minSize', v), 'Minimum size (px)', { max: MAX_MIN_SIZE, placeholder: 'mixed', bad: `pixels from 0 to ${MAX_MIN_SIZE}`,
        title: 'Shapes smaller than this are enlarged on screen' }), funit('px'), back('minSize')) : null,
      ...extra);
  }
  // the group an element (or a group) is in: none, or one of the drawing's that can hold them all
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
  // A folding section's head (drawing-ui.md §5: Data, Elevation profile, Totals), as a group's in Layers:
  // the whole head folds it (its title a button, for keys), the arrow at its right; extras: buttons
  // after the title (Copy, +)
  const foldHead = (title, open, toggle, ...extras) => h('h3', { class: open ? 'folds open' : 'folds', onclick: (e) => { if (!e.target.closest('.hbtns, .hfold')) toggle(); } },
    h('button', { type: 'button', class: 'hfold', 'aria-expanded': String(open), 'aria-label': `${open ? 'Fold' : 'Open'} ${title}`, onclick: toggle }, title),
    h('span', { class: 'hbtns' }, ...extras.flat().filter(Boolean)));
  // the row of what can be done to it (one place, before Look): the rule's Edit… and Select all, then its own
  const actionsRow = (...btns) => { btns = btns.flat().filter(Boolean); return btns.length ? row('', ...btns) : null; };
  const dataOpen = new Set(); // the elements whose Data was opened by hand
  function dataBlock(id) {
    const el = now(id);
    const put = (fn) => set(id, (x) => fn(x.properties));
    const removeAt = (i) => put((ps) => ps.splice(i, 1));
    const preset = el.properties.find((p) => p.key === 'preset');
    const open = el.properties.some((p) => p.key !== 'preset') || dataOpen.has(id);
    const toggle = () => { if (open) dataOpen.delete(id); else dataOpen.add(id); renderInspector(); };
    // the empty last row: a key typed there adds a property
    const addKey = field(() => '', (t) => (t.trim() ? t : undefined), (v) => { dataOpen.add(id); put((ps) => ps.push({ key: v, value: '' })); }, { 'aria-label': 'Add a key', placeholder: 'add a key…', bad: 'a key cannot be empty' });
    return h('div', { class: 'fblock' },
      foldHead('Data', open, toggle,
        FINGER ? h('button', { type: 'button', class: 'small', title: 'Add a property', onclick: () => { dataOpen.add(id); put((p) => p.push({ key: 'key', value: '' })); } }, '+') : null,
        open && el.properties.length ? copyBtn(() => [['Key', 'Value'], now(id).properties.map((p) => [p.key, p.value])]) : null),
      !open && preset ? h('p', { class: 'note' }, `from preset ${preset.value}`) : null,
      open ? listGrid({ name: `${id}:data`,
        columns: [{ head: 'Key', width: 120 }, { head: 'Value', width: 180 }],
        rows: el.properties.map((p, i) => ({ cells: [
          field(() => p.key, (t) => (t.trim() ? t : undefined), (v) => put((ps) => { ps[i].key = v; }), { 'aria-label': 'Key', bad: 'a key cannot be empty' }),
          field(() => p.value, (t) => t, (v) => put((ps) => { ps[i].value = v; }), { 'aria-label': 'Value' })] })),
        add: [addKey, null],
        actions: (i) => ({ label: el.properties[i].key, buttons: [act('Delete', `${MOD} Delete`, () => removeAt(i))] }),
        keys: { remove: removeAt } }) : null);
  }
  // every inspector's top (its title, kind · name, in the head): the rule that made it, its name
  const commonTop = (kind, id) => {
    const el = now(id);
    title = `${kindTitle(kind, el)} · ${shownName(drawing.doc, kind, el, drawing.units())}`;
    return [ruleRow(id)?.row, kind === 'label' ? null : row('Name', textField(id, 'name', 'Name'))]; // a label is its text
  };
  const ruleActs = (id) => ruleRow(id)?.acts ?? [];
  // and its foot: the group it is in, Guide, its data (Delete: in the head)
  const commonBottom = (kind, id) => {
    const el = now(id);
    // Guide (supporting geometry: faint, out of the totals): a measurement is a guide showing its
    // values; unticking Guide makes it part of the drawing
    const guide = ['point', 'line'].includes(kind) ? row('Guide', check('', el.guide, (v) => set(id, (x) => { x.guide = v; }), { 'aria-label': 'Guide', title: 'Faint and dashed, out of the totals' })) : null;
    return [groupRow([id]), guide, dataBlock(id)];
  };

  // A point's parts, each named by its place in the list: its kind (changing it keeps its reach), its
  // name, Fill, Shown, its own stroke, ×; its size (a radius, a sector's aperture; an outline's length
  // and width, its area). "+ Part" adds one.
  // a part as another kind, its reach kept: a round one's radius, an outline's half length
  const asKind = (part, kind) => {
    const reach = part.radius ?? part.length / 2;
    const next = makePart(kind, ROUND.includes(kind) ? { radius: reach, aperture: part.aperture } : { length: 2 * reach, width: part.width ?? reach });
    return { ...next, fill: part.fill, shown: part.shown, name: part.name };
  };
  function partsBlock(id) {
    const el = now(id), u = drawing.units();
    const fits = (m) => drawable(now(id), m);
    const at = (i, fn) => drawing.change((d) => { fn(find(d, id).el.parts[i]); reattach(d, id); }); // part i as it is now; what points at its corners stays where it was
    const adder = (aria, text) => select(aria, [['', text], ...PART_KINDS.map((k) => [k, PART_NAME[k]])], '', (k) => { if (k) set(id, (x) => addPart(x, k)); }, { title: 'Add a part' });
    const box = (i, key, aria) => check('', el.parts[i][key], (v) => at(i, (y) => { y[key] = v; }), { 'aria-label': `Part ${i + 1} ${aria}` });
    const PARTS_COPY = ['#', 'Kind', 'Radius m', 'Aperture °', 'Length m', 'Width m', 'Fill', 'Shown', 'Name'];
    const sizeU = unitOf(el.parts.map((q) => q.radius ?? q.length)), acrossU = unitOf(el.parts.map((q) => q.width ?? NaN));
    const dist = (i, key, aria) => F.dist(() => now(id).parts[i][key], (m) => at(i, (y) => { y[key] = m; }), aria, { check: (m) => (m >= MAX_RADIUS || (key === 'radius' && !fits(m)) ? 'too large' : null), in: key === 'width' ? acrossU : sizeU });
    // its size, two columns, in the column's unit: a round part's radius and a sector's aperture (°), an outline's length and width
    const size = (part, i) => (part.radius ? dist(i, 'radius', `Part ${i + 1} radius`) : dist(i, 'length', `Part ${i + 1} length`));
    const across = (part, i) => (part.kind === 'sector'
      ? h('span', { class: 'vpair' }, F.angle(() => now(id).parts[i].aperture, (v) => at(i, (y) => { y.aperture = v; }), `Part ${i + 1} aperture (degrees): centred on the bearing`, { wrap: false }), funit('°'))
      : part.radius ? null : dist(i, 'width', `Part ${i + 1} ${WIDTH_NAME[part.kind] || 'width'}`));
    const kind = (part, i) => select(`Part ${i + 1} kind`, PART_KINDS.map((k) => [k, PART_NAME[k]]), part.kind, (v) => drawing.change((d) => { const x = find(d, id).el; x.parts[i] = asKind(x.parts[i], v); reattach(d, id); }));
    const removeAt = (i) => drawing.change((d) => { removePartOf(d, id, i); reattach(d, id); });
    // the grid fits the panel's 320 px: #, Kind, Size, Across, Fill; the row current has its name and
    // Shown in the bar over the grid, with Delete
    const table = listGrid({ name: `${id}:parts`,
      columns: [{ head: '#', width: 28, cls: 'num' }, { head: 'Kind', width: 92 },
        { head: `Size ${UNIT_TEXT[sizeU]}`, width: 80, cls: 'n', title: 'Radius, or length' },
        { head: `Across ${UNIT_TEXT[acrossU]}`, width: 64, cls: 'n', title: 'Aperture (°), or width' },
        { head: 'Filled', width: 48 }],
      rows: el.parts.map((part, i) => ({ cells: [`${i + 1}`, kind(part, i), size(part, i), across(part, i), box(i, 'fill', 'filled')],
      cls: part.radius && !fits(part.radius) ? 'warn' : null })),
      add: [null, adder('Add a part', 'add a part…'), null, null, null],
      actions: (i) => ({ label: `Part ${i + 1}`, buttons: [field(() => now(id).parts[i].name, (t) => t, (v) => at(i, (y) => { y.name = v; }), { 'aria-label': `Part ${i + 1} name`, placeholder: 'name' }),
        check('Shown', now(id).parts[i].shown, (v) => at(i, (y) => { y.shown = v; }), { 'aria-label': `Part ${i + 1} shown` }),
        act('Delete', `${MOD} Delete`, () => removeAt(i))] }),
      keys: { remove: removeAt }, current: (i) => drawing.setPlace(i == null ? null : { id, index: i }) });
    const far = el.parts.find((part) => part.radius && !fits(part.radius));
    return h('div', { class: 'fblock' },
      h('h3', {}, `Parts (${el.parts.length})`, copyBtn(() => [PARTS_COPY,
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
      row('Bearing', F.angle(() => now(id).bearing, (v) => set(id, (x) => { x.bearing = v; }), 'Bearing (degrees true): where its outlines face, and its sectors'), funit('°T')),
      mainOutline(el) ? null : row('Symbol', segOf('Symbol (the same size on screen at every zoom)', SYMBOLS.map((sy) => [sy, sy === 'none' ? '∅' : icon(...SYMBOL_ICON[sy]), SYMBOL_TITLE[sy]]), el.symbol, (sy) => set(id, (x) => { x.symbol = sy; }))),
      partsBlock(id),
      changedByHand(drawing.doc, id) ? row('Parts', fvalue('changed by hand, not its rule\'s'),
        h('button', { type: 'button', class: 'x reset', title: 'Back to the rule\'s', 'aria-label': 'Parts back to the rule\'s', onclick: () => drawing.change((d) => giveBack(d, id)) }, '↺')) : null];
    // one Distribute: round the part whose row is current (else the one followed by default); the form can choose another
    parts.push(actionsRow(ruleActs(id),
      el.parts.length ? h('button', { type: 'button', class: 'small', title: 'Copies round one of its parts',
        onclick: () => openDistribution({ element: id, part: currentOf(`${id}:parts`) }) }, 'Distribute along…') : null,
      h('button', { type: 'button', class: 'small', title: 'Keep it as a kind of the Shape tool',
        onclick: async () => {
          const name = (await askText('Save as preset', 'Name', el.name || 'Preset'))?.trim();
          if (!name) return;
          if (drawing.presets.some((x) => x.name === name) && !(await ask('Save as preset', `Replace the preset “${name}”?`, [[() => true, 'Replace']]))) return;
          const p = presetOf(now(id), name);
          drawing.presets = [...drawing.presets.filter((x) => x.name !== name), p];
          savePresets(drawing.presets);
          const tool = presetTool(p);
          drawing.variant[tool] = `preset:${name}`;
          renderTools();
        } }, 'Save as preset…')), lookBlock([item(id)]));
    return [...parts, ...commonBottom('point', id)];
  }

  // a place's Attach to… (the next click on the map chooses what to link it to), pressed while it
  // waits for a click
  const waiting = (id, k) => drawing.repointing?.id === id && drawing.repointing.index === k;
  const attachBtn = (id, k, attrs, ...content) => h('button', { type: 'button', ...attrs, 'aria-pressed': String(waiting(id, k)), title: 'Then click where to attach it',
    onclick: () => { if (waiting(id, k)) drawing.cancelRepoint(); else drawing.startRepoint(id, k); renderInspector(); } }, ...content);
  const detach = (id, k) => set(id, (x, d) => setLink(d, id, k, null)); // free where it is
  // What a label points at: linked, a link to it and where on it, Detach (the broken link) and Attach
  // to…; free, its position typed, and Attach to…
  function refRow(text, id) {
    const to = linkFrom(drawing.doc, id)?.to, on = to && find(drawing.doc, to.element);
    const attach = attachBtn(id, 0, { class: 'x', 'aria-label': `Attach ${text.toLowerCase()} to…` }, icon(...UI_ICON.attach));
    if (!on) { const [, lat, , lon] = F.position(() => now(id).position, (q) => set(id, (x) => { x.position = q; })); return row(text, pair(lat, '·', lon), attach); }
    return row(text, link(on.el.id), partName(to, on.kind) ? h('span', { class: 'funit' }, partName(to, on.kind)) : null,
      h('button', { type: 'button', class: 'x', title: 'Free, where it is', 'aria-label': `Detach ${text.toLowerCase()}`, onclick: () => detach(id, 0) }, icon(...UI_ICON.detach)), attach);
  }

  // a label: its text (with live values), what it points at, its leader and its look
  const TOKEN_TEXT = { name: ['name', 'The name of what it points at'], length: ['length', 'The length of the line it points at, or of the side'],
    along: ['distance along', 'The distance along the line to where it points'], bearing: ['bearing', 'The bearing of the side or leg it points at'],
    radius: ['radius', 'The point\'s filled radius'], area: ['area', 'The area of the closed line or shape'], perimeter: ['perimeter', 'The perimeter of the closed line or shape'] };
  function labelInspector(id) {
    const doc = drawing.doc, el = now(id), u = drawing.units(), to = linkFrom(doc, id)?.to;
    const at = to && resolve(doc, to), values = labelValues(doc, to, u);
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
    const alongRow = onLine ? row('Along', withUnit(F.dist(() => at.along, (m) => drawing.change((d) => setLink(d, id, 0, lineRef(d, find(d, to.element).el, m))), 'Distance along', { zero: true,
      title: `Of ${fmtDist(at.length, u)}` }))) : null;
    // what it reads on the map, under its text, while a value fills it in
    const reads = /\{\w+\}/.test(el.text) ? h('p', { class: 'note' }, `Reads: ${labelText(doc, el, u).split('\n').map((t) => t.trim()).filter(Boolean).join(' · ') || '(nothing)'}`) : null;
    // its place: where it points (free: a position), along a line, and its text moved from there
    const moved = el.offset[0] !== (to ? LABEL_OFFSET[0] : 0) || el.offset[1] !== (to ? LABEL_OFFSET[1] : 0);
    return [...commonTop('label', id),
      row('Text', text), reads,
      tokens.length ? row('', ...tokens.map((k) => h('button', { type: 'button', class: 'small', title: `A live ${TOKEN_TEXT[k][0]}`, onclick: () => insert(`{${k}}`) }, `+ ${TOKEN_TEXT[k][0]}`))) : null,
      refRow(to ? 'Attached to' : 'Position', id), alongRow,
      row('Text offset', fvalue(`${el.offset[0]}, ${el.offset[1]}`.replace(/-/g, '−'), { title: 'Drag its text on the map' }), funit('px'),
        moved ? h('button', { type: 'button', class: 'x', title: 'Back to the default', 'aria-label': 'Text offset back to where a new label puts it', onclick: () => set(id, (x) => { x.offset = to ? [...LABEL_OFFSET] : [0, 0]; }) }, '↺') : null),
      to ? leaderRow([item(id)]) : null, // a free label points at nothing
      actionsRow(ruleActs(id)), lookBlock([item(id)]),
      ...commonBottom('label', id)];
  }

  // labels' leader: a line from the text to its point, an arrow head there, or none (one or several labels)
  function leaderRow(xs) {
    const on = xs.map((x) => x.el.leader !== 'none'), v = on.every((x) => x === on[0]) ? on[0] : null;
    return row('Leader', check('', v, (x) => drawing.change((d) => { for (const y of xs) find(d, y.el.id).el.leader = x ? 'arrow' : 'none'; }),
      { 'aria-label': 'Leader', title: 'A line from the text to its point' }));
  }

  // Legs typed (the line's table of points): the straight leg arriving at a place from the one before
  // (a closed line's first: from its last), its length and its bearing. A value typed moves that
  // place alone (the leg after it changes with it); a place linked is where it is linked, its leg not
  // typed.
  const legOf = (ps, k) => { const g = inverse(ps.at(k - 1), ps[k]); return { s: g.s, azi: norm360(g.azi) }; };
  const legTo = (ps, k, { s: len, azi }) => { const g = legOf(ps, k); return destination(ps.at(k - 1), azi ?? g.azi, len ?? g.s); };
  const setLeg = (id, k, v) => set(id, (x) => { x.points[k] = legTo(x.points, k, v); });
  // an element's places, read once per rendering of the inspector (each row's leg reads them)
  const placesRead = new Map();
  const placesNow = (id) => { if (!placesRead.has(id)) placesRead.set(id, now(id).points); return placesRead.get(id); };
  // a leg's two fields in a table: the length in the column's unit (a number to the metre), the bearing to a tenth
  const legFields = (id, k, what, unit) => [
    F.dist(() => legOf(placesNow(id), k).s, (m) => setLeg(id, k, { s: m }), `${what} ${k + 1} leg length`, { in: unit }),
    F.angle(() => legOf(placesNow(id), k).azi, (a) => setLeg(id, k, { azi: a }), `${what} ${k + 1} leg bearing (degrees true)`, { fixed: 1 })];
  // a place of a line added halfway to the next (a closed line's last: to its first), one taken away
  // (attach.js: while it keeps enough)
  const insertAfter = (id, k) => drawing.change((doc) => { const ps = find(doc, id).el.points; insertPlace(doc, id, k + 1, along(ps[k], ps[(k + 1) % ps.length], 0.5)); });
  const removeAt = (id, k) => drawing.change((doc) => deletePlace(doc, id, k));
  // a table of places' first columns; with its leg and bearing 304 px, inside Properties' 320
  // with a scroll bar: degrees in 6 decimals, distances to the metre (up to 999 km), bearings to a tenth
  const PLACE_COLUMNS = [{ head: '#', width: 28, cls: 'num' }, { head: 'Lat', width: 80, cls: 'n' }, { head: 'Lon', width: 88, cls: 'n' }];
  // A table of places, a page of them shown (list: 'points', a line's): #, Lat, Lon, the leg from the
  // place before and its bearing, in unit; rowAt(k): place k's cells; actions(k), insert(k),
  // remove(k); copy: every row (copyBtn). Its row current is ringed on the map.
  function placesTable(id, list, total, { name, leg, unit, copy, rowAt, actions, insert, remove }) {
    const pg = paged(`${id}:${list}`, total), abs = (r) => pg.rows[r];
    const table = listGrid({ name: pg.name,
      columns: [...PLACE_COLUMNS, { head: `${leg[0]} ${UNIT_TEXT[unit]}`, width: 56, cls: 'n', title: leg[1] }, { head: 'Brg °T', width: 52, cls: 'n', title: 'Its bearing' }],
      rows: pg.rows.map(rowAt), actions: (r) => actions(abs(r)), keys: { insert: (r) => insert(abs(r)), remove: (r) => remove(abs(r)) },
      current: (r) => drawing.setPlace(r == null ? null : { id, index: abs(r) }) });
    return h('div', { class: 'fblock' }, h('h3', { title: 'A row clicked is ringed on the map' }, `${name} (${total})`, copyBtn(copy)), table, pg.pager);
  }
  // a table's distances: one unit for the column (its head says it), by the rule a field's value
  // follows (format.js distText): metres while its largest is under 1 km, else km; NM in NM
  const unitOf = (ms) => (drawing.units() === 'nm' ? 'nm' : ms.every((m) => !(Number.isFinite(m) && m >= 1000)) ? 'm' : 'km'); // every: a long line's legs are more than Math.max(...) takes
  // a table of places (a line's points, a point's parts): its row k made current
  // (k: the place's index), the table at its page; from the map (a place pressed: drawing.currentPlace)
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
  const copyBtn = (rows) => h('button', { type: 'button', class: 'small', title: 'For a spreadsheet', onclick: () => {
    const [head, body] = rows();
    navigator.clipboard?.writeText(rowsText(head, body)).then(() => note(`${plural(body.length, 'row')} copied`), () => note('This browser did not let them be copied'));
  } }, 'Copy');

  // ---- a line's elevation profile (profile.js): a folding section, read when opened, read again as
  // the line changes; pointing at the chart shows the place on the map, pointing at the line on the
  // map shows it on the chart
  const profiles = new Map(); // line id → { key (its trace), prof (null while being read), failed }
  const profileShown = new Set();
  let profileCursor = null; // (d: metres along, or null) → the chart's cursor there
  // the chart gone (closed, the line no longer selected, the inspector built anew): its mark too
  const dropProfileCursor = () => { profileCursor?.(null); profileCursor = null; };
  let profileBuilt = 0;
  const W = 360, H = 110;
  function profileBlock(id) {
    const el = now(id), u = drawing.units();
    const open = profileShown.has(id);
    const head = foldHead('Elevation profile', open, () => { if (open) profileShown.delete(id); else profileShown.add(id); renderInspector(); });
    if (!open) return h('div', { class: 'fblock' }, head);
    const tr = lineTrace(drawing.doc, el), key = JSON.stringify(tr.coords);
    let p = profiles.get(id);
    if (!p || p.key !== key) {
      const mine = { key, prof: null, failed: false };
      profiles.set(id, p = mine);
      ctx.profile(tr).then((prof) => { mine.prof = prof; }, () => { mine.failed = true; })
        .then(() => { if (profiles.get(id) === mine && drawing.sel.size === 1 && drawing.sel.has(id)) renderInspector(); });
    }
    if (p.failed) profiles.delete(id); // said once; read again the next time it is shown
    if (!p.prof) return h('div', { class: 'fblock' }, head, h('p', { class: 'note' }, p.failed ? 'The elevation could not be read.' : 'Reading the elevation…'));
    const { pts, surface, length, lowest, highest } = p.prof;
    if (!lowest) return h('div', { class: 'fblock' }, head, h('p', { class: 'note' }, 'No elevation along this line (no data).'));
    // the chart: from the lowest to the highest, along the line; sea level in it (and its line) where the
    // line goes below it
    const sea = lowest.z < 0, top = sea ? Math.max(highest.z, 0) : highest.z, bottom = Math.min(lowest.z, top - 1);
    const X = (d) => (length ? (d / length) * W : 0), Y = (z) => ((top - z) / (top - bottom)) * (H - 14) + 4;
    const range = `${fmtElevation(lowest.z)} to ${fmtElevation(highest.z)}`;
    const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'profile', role: 'img', 'aria-label': `Elevation along the line, ${range}` });
    if (sea) chart.append(svg('line', { x1: 0, x2: W, y1: Y(0), y2: Y(0), class: 'psurface' }));
    let run = [];
    const flush = () => { if (run.length > 1) chart.append(svg('polyline', { points: run.join(' '), class: 'pline' })); run = []; };
    for (const x of pts) { if (Number.isFinite(x.z)) run.push(`${X(x.d).toFixed(1)},${Y(x.z).toFixed(1)}`); else flush(); }
    flush();
    for (const x of [lowest, highest]) chart.append(svg('circle', { cx: X(x.d), cy: Y(x.z), r: 2.5, class: 'pend' }));
    const cursor = svg('line', { y1: 0, y2: H, class: 'pcursor', visibility: 'hidden' });
    chart.append(cursor);
    const at = fvalue('');
    const nearest = (d) => pts.reduce((a, b) => (Math.abs(b.d - d) < Math.abs(a.d - d) ? b : a));
    // the chart's cursor at d (metres along), and the place on the map; null: none (the map's mark
    // taken away only if it is this one's: a form's preview is not)
    let marked = false;
    profileCursor = (d) => {
      if (d == null) { cursor.setAttribute('visibility', 'hidden'); at.textContent = ''; if (marked) drawing.setPreview([]); marked = false; return; }
      marked = true;
      const x = nearest(d);
      cursor.setAttribute('x1', X(x.d)); cursor.setAttribute('x2', X(x.d)); cursor.setAttribute('visibility', 'visible');
      at.textContent = `${fmtDist(x.d, u)} · ${Number.isFinite(x.z) ? fmtElevation(x.z) : 'no data'}`;
      drawing.setPreview([x.p]);
    };
    chart.addEventListener('pointermove', (e) => { const r = chart.getBoundingClientRect(); profileCursor(((e.clientX - r.left) / r.width) * length); });
    chart.addEventListener('pointerleave', () => profileCursor(null));
    return h('div', { class: 'fblock', 'data-key': `profile ${++profileBuilt}` }, head, // profileCursor is this one's: never kept by morph
      row('Elevation', fvalue(range), at),
      chart,
      row('Length', fvalue(`${fmtDist(surface, u)} along the surface · ${fmtDist(length, u)} on the map`, { title: 'Along the surface, seabed and ground: a lower bound (relief finer than the data is not in it)' }),
      h('button', { type: 'button', class: 'small', title: 'The profile as a file', onclick: () => ctx.download(profileCsv(p.prof), `${(el.name || 'line').replace(/[^\p{L}\p{N}-]+/gu, '-')}-profile.csv`, 'text/csv') }, 'CSV')));
  }
  // a double-click on an element, with no tool on, turns Properties on (the map does not zoom)
  map.on('dblclick', (e) => { if (!drawing.tool && drawing.hitAt(e.point).length) { e.preventDefault(); ctx.frame.setProps(true); } });
  // pointing at a line on the map whose profile is shown: its place on the chart
  map.on('mousemove', (e) => {
    if (!profileCursor || drawing.sel.size !== 1) return;
    const id = [...drawing.sel][0], x = find(drawing.doc, id);
    if (x?.kind !== 'line' || !profileShown.has(id)) return;
    profileCursor(drawing.hitAt(e.point, 6).includes(id) ? nearestAlong(lineTrace(drawing.doc, x.el).coords, [e.lngLat.lng, e.lngLat.lat]) : null); // off the line: no mark
  });

  // a line: its length (closed: its area and perimeter), its path, its places, its profile
  function lineInspector(id) {
    const doc = drawing.doc, el = now(id), closed = !!el.closed, u = drawing.units();
    const line = lineTrace(doc, el);
    const at = line.at;
    const splitAt = (k) => drawing.change((d) => splitLine(d, id, k));
    // Its places as rows, numbered 1 (its start) to N (its end): a page of them shown. Lat, Lon (one
    // linked: what to); the leg from the place before (a closed line's first: from its last; typed:
    // this place moves; a linked one's as it is); along, from the start; its name.
    const ps = el.points, N = ps.length, tied = (k) => linkFrom(doc, id, k)?.to;
    const end = (k) => !closed && (k === 0 || k === N - 1), legged = (k) => k > 0 || closed; // an open line's ends; a place with a leg to it
    const coord = (k, axis) => F.coord(axis, () => now(id).points[k][axis === 'lat' ? 1 : 0],
      (v) => set(id, (x) => { const p = x.points[k]; x.points[k] = axis === 'lat' ? [p[0], v] : [v, p[1]]; }), `Point ${k + 1} ${axis === 'lat' ? 'latitude' : 'longitude'}`, 6);
    const lu = unitOf(ps.map((_, k) => (legged(k) ? legOf(ps, k).s : 0)));
    const legCells = (k) => (tied(k) ? [fvalue(inUnit(legOf(ps, k).s, lu)), fvalue(legOf(ps, k).azi.toFixed(1))] : legFields(id, k, 'Point', lu));
    const name = (k) => field(() => now(id).names[k], (t) => t, (nv) => set(id, (x) => { x.names[k] = nv; }), { 'aria-label': `Point ${k + 1} name`, placeholder: 'name' });
    // the grid fits the panel's 320 px: #, Lat, Lon, the leg and its bearing; the row current says
    // how far along the line its point is, and holds its name, in the bar over the grid
    const alongText = (k) => funit(`${distText(at[k] || 0, drawing.units()).text} along`);
    const rowAt = (k) => ({ cells: [end(k) ? h('span', { title: k ? 'Its end' : 'Its start' }, `${k + 1}`) : `${k + 1}`,
        ...(tied(k) ? [link(tied(k).element), null] : [coord(k, 'lat'), coord(k, 'lon')]),
        ...(legged(k) ? legCells(k) : [null, null])] });
    const pointRows = () => { const x = now(id), qs = x.points, t = lineTrace(drawing.doc, x).at;
      return [['#', 'Lat', 'Lon', 'Leg m', 'Brg °', 'Along m', 'Name'], qs.map((q, k) => { const g = legged(k) ? legOf(qs, k) : null; return [k + 1, q[1], q[0], g ? +g.s.toFixed(3) : '', g ? +g.azi.toFixed(1) : '', +(t[k] || 0).toFixed(3), x.names[k]]; })]; };
    return [...commonTop('line', id),
      ...(closed ? [row('Area', valued(fmtArea(line.area, u))), row('Perimeter', distValue(line.length))] : [row('Length', distValue(line.length))]),
      row('Path', segOf('Path', [[false, 'Straight', 'Geodesics'], [true, 'Smooth', 'A curve through its bends']], !!el.smooth, (v) => set(id, (x) => { x.smooth = v; }))),
      // closed (three points or more) and opened again; what is linked to its legs stays where it is
      row('Closed', check('', closed, (v) => set(id, (x, d) => { x.closed = v; reattach(d, id); }), { 'aria-label': 'Closed', title: 'Its last point joined to its first: an area', disabled: !closed && N < 3 })),
      placesTable(id, 'points', N, { name: 'Points', leg: ['Leg', 'From the point before'], unit: lu, copy: pointRows, rowAt,
        actions: (k) => ({ label: end(k) ? (k ? `Point ${N}, its end` : 'Point 1, its start') : `Point ${k + 1}`,
          buttons: [k ? alongText(k) : null, name(k), k < N - 1 || closed ? act('Insert after', 'Insert', () => insertAfter(id, k)) : null,
            act('Delete', `${MOD} Delete; ${closed ? 'three' : 'two'} are kept`, () => removeAt(id, k), N <= fewestPlaces(el)),
            end(k) ? null : act('Split', closed ? 'Opened here: its start and its end' : 'Two lines, attached here', () => splitAt(k)),
            attachBtn(id, k, { class: 'small', 'aria-label': `Attach point ${k + 1} to…` }, 'Attach to…'), tied(k) ? act('Detach', 'Free, where it is', () => detach(id, k)) : null].filter(Boolean) }),
        insert: (k) => { if (k < N - 1 || closed) insertAfter(id, k); }, remove: (k) => removeAt(id, k) }),
      profileBlock(id),
      actionsRow(ruleActs(id), h('button', { type: 'button', class: 'small', title: 'Copies along this line', onclick: () => openDistribution({ element: id, part: null }) }, 'Distribute along…')),
      lookBlock([item(id)]), ...commonBottom('line', id)];
  }

  function groupInspector(id) {
    const doc = drawing.doc;
    const direct = membersOf(doc, id);
    const below = membersOf(doc, id, true).filter((x) => x.kind !== 'group'); // everything in it, its subgroups' too
    const shownEye = eyeFor(drawing, () => [item(id)], 'members'); // the group's own flag, as its row's eye: one flag hides them all
    shownEye.render();
    // its members as the tree counts them (everything in it, its subgroups' too), and its subgroups
    const allSubs = membersOf(doc, id, true).length - below.length;
    // its totals as the drawing's, its members only, by subgroup (its own: under its name)
    const shared = below.length > 1 ? sharedRows(below) : [];
    const totalsOf = below.length ? totalsBlock(null, (gid) => (gid ? groupPath(doc, doc.groups.find((g) => g.id === gid)) : ''), breakdown(doc, null, new Set(below.map((x) => x.el.id))), '', `${id}:totals`) : null;
    return [...commonTop('group', id),
      row('Members', fvalue([plural(below.length, 'element'), allSubs ? plural(allSubs, 'subgroup') : ''].filter(Boolean).join(' · ')), direct.length ? shownEye : null),
      totalsOf,
      actionsRow(ruleActs(id), h('button', { type: 'button', class: 'small', title: 'Everything in it', disabled: !below.length, onclick: () => drawing.select(below.map((x) => x.el.id)) }, 'Select members'), connectBtn(below)),
      ...(shared.length ? [h('div', { class: 'fblock' }, h('h3', {}, 'Each member'), ...shared)] : []),
      lookBlock([item(id)], null, 'Look · sets each member'), ...commonBottom('group', id)];
  }

  // What several elements share (drawing-ui.md §5): every row two or more of them have, "mixed"
  // where they differ (as Look), a value set on each that has it. Two or more points: Position,
  // Bearing, Symbol and Parts (part by part: its kind, size, across, fill); two or more lines, their
  // Path; points or lines, Guide. xs: the elements (several selected, or a group's members)
  function sharedRows(xs) {
    const pts = xs.filter((x) => x.kind === 'point'), lines = xs.filter((x) => x.kind === 'line'), geo = [...pts, ...lines];
    const same = (ys, f) => { const vs = ys.map(f); return vs.every((v) => v === vs[0]) ? vs[0] : null; };
    const each = (ys, fn) => drawing.change((d) => { for (const y of ys) fn(find(d, y.el.id).el, d); });
    const out = [];
    if (pts.length > 1) {
      const nowPts = () => pts.map((x) => now(x.el.id)).filter(Boolean);
      // their position, each axis alone: a latitude typed puts them all on that parallel, their longitudes kept
      const axis = (k, aria) => F.coord(k ? 'lat' : 'lon', () => same(nowPts(), (p) => p.position[k]), (v) => each(pts, (p) => { p.position[k] = v; }), aria, 6);
      out.push(row('Position', pair(axis(1, 'Latitude of each point'), '·', axis(0, 'Longitude of each point'))));
      out.push(row('Bearing', F.angle(() => same(nowPts(), (p) => p.bearing), (v) => each(pts, (p) => { p.bearing = v; }), 'Bearing (degrees true) of each point'), funit('°T')));
      const plain = pts.filter((x) => !mainOutline(x.el)); // a symbol: the points without an outline
      if (plain.length > 1) out.push(row('Symbol', segOf('Symbol of each point', SYMBOLS.map((sy) => [sy, sy === 'none' ? '∅' : icon(...SYMBOL_ICON[sy]), SYMBOL_TITLE[sy]]), same(plain, (x) => x.el.symbol), (sy) => each(plain, (p) => { p.symbol = sy; }))));
      // their parts, part by part: every row at least two points have; a cell set on those it applies to
      // (a size: each round part's radius and each outline's length at once; across: a sector's aperture,
      // an outline's width, each where two or more have one)
      const partsAt = (i) => nowPts().map((p) => p.parts[i]).filter(Boolean);
      const rows = Array.from({ length: Math.max(...pts.map((x) => x.el.parts.length)) }, (_, i) => i).filter((i) => partsAt(i).length > 1);
      const at = (i, fn) => drawing.change((d) => { for (const x of pts) { const p = find(d, x.el.id).el; if (p.parts[i]) fn(p.parts[i], p); reattach(d, x.el.id); } });
      const tooFar = (m) => (m >= MAX_RADIUS ? 'too large' : null);
      const kindCell = (i) => select(`Part ${i + 1} kind of each`, PART_KINDS.map((k) => [k, PART_NAME[k]]), same(partsAt(i), (q) => q.kind), (v) => at(i, (q, p) => { p.parts[i] = asKind(q, v); }));
      const all = rows.flatMap((i) => partsAt(i)), sizeU = unitOf(all.map((q) => q.radius ?? q.length)), acrossU = unitOf(all.map((q) => q.width ?? NaN));
      const sizeCell = (i) => F.dist(() => same(partsAt(i), (q) => q.radius ?? q.length), (m) => at(i, (q) => { if (q.radius != null) q.radius = m; else q.length = m; }), `Part ${i + 1} size of each`, { check: tooFar, in: sizeU });
      const acrossCell = (i) => {
        const sectors = partsAt(i).filter((q) => q.aperture != null).length, outlines = partsAt(i).filter((q) => q.width != null).length;
        return [sectors > 1 ? h('span', { class: 'vpair' }, F.angle(() => same(partsAt(i).filter((q) => q.aperture != null), (q) => q.aperture), (v) => at(i, (q) => { if (q.aperture != null) q.aperture = v; }), `Part ${i + 1} aperture of each`, { wrap: false }), funit('°')) : null,
          outlines > 1 ? F.dist(() => same(partsAt(i).filter((q) => q.width != null), (q) => q.width), (m) => at(i, (q) => { if (q.width != null) q.width = m; }), `Part ${i + 1} width of each`, { check: tooFar, in: acrossU }) : null];
      };
      if (rows.length) out.push(h('div', { class: 'fblock' }, h('h3', { title: 'Every part two or more points have' }, 'Parts · of each point'),
        listGrid({ name: 'shared:parts', plain: true, head: true,
          columns: [{ head: '#', width: 28, cls: 'num' }, { head: 'Kind', width: 92 }, { head: `Size ${UNIT_TEXT[sizeU]}`, width: 80, cls: 'n', title: 'Radius, or length' }, { head: `Across ${UNIT_TEXT[acrossU]}`, width: 64, cls: 'n', title: 'Aperture (°), or width' }, { head: 'Filled', width: 48 }],
          rows: rows.map((i) => ({ cells: [`${i + 1}`, kindCell(i), sizeCell(i), acrossCell(i),
            check('', same(partsAt(i), (q) => q.fill), (v) => at(i, (q) => { q.fill = v; }), { 'aria-label': `Part ${i + 1} filled, each` })] })) })));
    }
    if (lines.length > 1) out.push(row('Path', segOf('Path of each line', [[false, 'Straight', 'Geodesics'], [true, 'Smooth', 'A curve through its bends']], same(lines, (x) => !!x.el.smooth), (v) => each(lines, (l) => { l.smooth = v; }))));
    if (geo.length > 1) out.push(row('Guide', check('', same(geo, (x) => x.el.guide), (v) => each(geo, (g) => { g.guide = v; }), { 'aria-label': 'Guide', title: 'Faint and dashed, out of the totals' })));
    return out;
  }

  // a new group of ids, in the nearest group they are all in; it is selected
  function groupThem(ids) { let g; drawing.change((doc) => { g = makeGroup(doc, ids); }); drawing.select([g.id]); }
  function severalInspector(xs) {
    const counts = {};
    for (const x of xs) counts[x.kind] = (counts[x.kind] || 0) + 1;
    const ids = xs.map((x) => x.el.id);
    // two points: how far apart, and the bearing from the first to the second
    const between = xs.length === 2 && xs.every((x) => x.kind === 'point') ? inverse(xs[0].el.position, xs[1].el.position) : null;
    title = `${xs.length} elements · ${Object.entries(counts).map(([k, n]) => plural(n, KIND[k].name.toLowerCase())).join(', ')}`;
    return [between ? row('Apart', distValue(between.s, { title: 'From the first to the second' })) : null,
    between ? row('Bearing 1→2', fvalue(norm360(between.azi).toFixed(1), { title: `From ${label(xs[0].kind, xs[0].el)} to ${label(xs[1].kind, xs[1].el)}` }), funit('°T')) : null,
    ...sharedRows(flat(xs)),
    flat(xs).some((x) => x.kind === 'label') ? leaderRow(flat(xs).filter((x) => x.kind === 'label')) : null,
    actionsRow(connectBtn(flat(xs))),
    lookBlock(xs),
    groupRow(ids),
  ];
  }

  // Connect… for the points among xs (a group's: everything in it), two or more
  const connectBtn = (xs) => { const ids = xs.filter((x) => x.kind === 'point').map((x) => x.el.id); return ids.length > 1 ? h('button', { type: 'button', class: 'small', title: 'Lines from roots to these points', onclick: () => openConnect(ids) }, 'Connect…') : null; };
  const copies = (n) => `${n} ${n === 1 ? 'copy' : 'copies'}`;
  // a root no group is cheapest from, once made: said, as the form said it before
  const unusedRoots = (ids) => `Not used: ${ids.map((o) => label('point', now(o))).join(', ')} (no group is cheapest from it)`;
  // The rule an element was made by (generator.js ruleOf: a copy, a hub, a line, the rule's groups):
  // { row (what it made, a row at the top), acts (Edit…: its form; Select all: everything it made) },
  // or null
  function ruleRow(id) {
    const doc = drawing.doc, r = ruleOf(doc, id);
    if (!r) return null;
    const live = (ids) => ids.filter((x) => doc.points.some((n) => n.id === x)).length;
    const along = r.kind === 'distribute' && find(doc, r.along.element);
    const text = r.kind === 'distribute' ? `Distribute along ${along ? label(along.kind, along.el) : 'what is gone'} · ${copies(r.points.length)}`
      : `Connection · ${r.pattern === 'chain' ? 'chains' : 'trees'}, ${plural(live(r.pointIds), 'point')} to ${plural(live(r.roots.map((o) => o.id)), 'root')}`;
    const all = () => drawing.select(leavesOf(drawing.doc, [r.groupId]).map((x) => x.el.id));
    return { row: row('Made by', fvalue(text, { title: text })),
      acts: [h('button', { type: 'button', class: 'small', title: 'Its settings', disabled: r.kind === 'distribute' && !along, onclick: () => (r.kind === 'distribute' ? openDistribution(r.along, r) : openConnect(r.pointIds, r)) }, 'Edit…'),
        h('button', { type: 'button', class: 'small', title: 'Everything it made', onclick: all }, 'Select all')] };
  }

  // ---- the tools' forms (generator.js): Distribute along a line or an arc; Connect points to roots
  // form: { kind: 'distribute', along (a reference: the line, or the point), distributionId } or
  // { kind: 'connect', pointIds, connectionId } (an id: the one edited or made again, or null), and the
  // selection it was opened with (another closes it)
  let form = null;
  const DFORM = { by: 'spacing', spacing: 1000, count: 10, startMargin: 0, endMargin: 0, offset: 0, side: 'left', radius: DISTRIBUTE_D.radius, aperture: null, part: null, preset: 'circle', copy: null, groupId: null };
  const CON = { pattern: 'tree', groupSize: 'auto', minBranch: 0, roots: [], newRoots: [] };
  const dform = { ...DFORM }, con = { ...CON }; // a new form starts from these; one edited, from its rule's
  const dformParams = () => ({ spacing: dform.spacing, count: dform.by === 'count' ? dform.count : null, startMargin: dform.startMargin, endMargin: dform.endMargin, offset: dform.offset, side: dform.side, radius: dform.radius, aperture: dform.aperture, preset: dform.preset, copy: dform.copy, groupId: dform.groupId,
    along: form && { element: form.along.element, part: dform.part } });
  const conParams = () => ({ pattern: con.pattern, groupSize: con.groupSize, minBranch: con.minBranch, roots: con.roots.map((r) => ({ ...r })), newRoots: con.newRoots.map((q) => [...q]) });
  const selKey = () => [...drawing.sel].sort().join(' ');
  function openForm(f) {
    drawing.stop(); // a click on the map now picks a root, not a tool's next point
    drawing.boxSelect(false);
    form = { ...f, sel: selKey() };
    drawing.setPicking(form.kind === 'connect' ? pick : null, true); // roots are picked on the map while Connect's is open
    formPreview();
    renderInspector();
  }
  function openDistribution(along, a = null) {
    Object.assign(dform, DFORM, { part: along.part ?? null }); // a new one: the defaults, round the part followed by default
    if (a) Object.assign(dform, { by: a.count ? 'count' : 'spacing', spacing: a.spacing || dform.spacing, count: a.count || a.points.length, startMargin: a.startMargin, endMargin: a.endMargin,
      offset: a.offset, side: a.side, radius: a.radius, aperture: a.aperture, preset: a.preset ?? 'circle', copy: a.copy });
    openForm({ kind: 'distribute', along: { element: along.element, part: along.part ?? null }, distributionId: a?.id ?? null });
  }
  function openConnect(pointIds, c = null) {
    Object.assign(con, CON, c ? { pattern: c.pattern, groupSize: c.groupSize, minBranch: c.minBranch, roots: c.roots.map((r) => ({ ...r })) } : {}, { newRoots: [] });
    openForm({ kind: 'connect', pointIds: [...pointIds], connectionId: c?.id ?? null });
  }
  function closeForm() {
    form = null;
    drawing.setPicking(null);
    drawing.setPreview([]);
  }
  const distributionRun = () => distribute(drawing.doc, alongOf(drawing.doc, form.along.element), { ...dformParams(), part: dform.part });
  // what Connect would make (plan() in generator.js keeps the last plan by its inputs: the preview and
  // the form, drawn in the same task, share it): { positions (in order), roots, plan }
  const connectPlan = () => { const { nodes, roots, plan: p } = planConnection(drawing.doc, { pointIds: form.pointIds, ...conParams() }); return { positions: nodes.map((n) => n.position), roots, plan: p }; };
  // what the form would make, faint on the map: a distribution's points; a connection's lines, its
  // roots ringed
  function formPreview() {
    if (form.kind === 'distribute') return drawing.setPreview(distributionRun().points.map((x) => x.position));
    const c = connectPlan();
    drawing.setPreview([], c.roots.map((r) => r.position), c.plan ? lines(c.positions, c.roots, c.plan, con.pattern) : []);
  }
  // a setting changed: the preview and the form follow
  const formChanged = () => { formPreview(); renderInspector(); };
  // a click on the map while roots are picked: on a point, it is a root or no longer one; anywhere
  // else, a new root there (on one, it goes)
  function pick(nid, pos) {
    if (nid) {
      if (form.pointIds.includes(nid)) return note('That point is one of those being connected');
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

  // the connection's settings (tree or chain, group size, roots and their weights) and what it would make
  function connectRows(c) {
    const u = drawing.units(), redo = formChanged, p = c.plan;
    const names = [...con.roots.map((r) => label('point', now(r.id))), ...con.newRoots.map((_, i) => `New root ${i + 1}`)];
    const sizes = p ? p.groups.map((g) => g.nodes.length) : [];
    const what = con.pattern === 'chain' ? 'chain' : 'tree';
    const summary = !c.roots.length ? 'Choose at least one root: click the map where the lines start (anywhere, or on a point).'
      : p ? `${sizes.length} ${what}${sizes.length > 1 ? 's' : ''} (${sizes.join(', ')}), ${new Set(p.groups.map((g) => g.root)).size} of ${plural(c.roots.length, 'root')} used; ${fmtDist(p.total, u)} of lines in all (straight; the cheapest cut).` : '';
    const unused = p ? p.unused.map((i) => names[i]) : [];
    const drop = (k) => () => { if (k < con.roots.length) con.roots = con.roots.filter((_, i) => i !== k); else con.newRoots = con.newRoots.filter((_, i) => i !== k - con.roots.length); redo(); };
    const weight = (k) => (k < con.roots.length
      ? F.number(() => con.roots[k].weight, (v) => { con.roots[k].weight = v; redo(); }, `Weight of ${names[k]}`, { above: true, title: 'Its pull' })
      : fvalue('1', { title: 'Set it once made' }));
    return [row('Pattern', segOf('Tree or chain', [['tree', 'Tree', 'root → hub → each point'], ['chain', 'Chain', 'root → point → next point …']], con.pattern, (v) => { con.pattern = v; redo(); })),
      row('Group size', pair(segOf('Group size', [['auto', 'Auto', `any size: the cheapest cut${con.pattern === 'tree' ? ` (trees of up to ${MAX_TREE})` : ''}`], ['set', 'Set', `points at most per ${what}`]], con.groupSize === 'auto' ? 'auto' : 'set', (v) => { con.groupSize = v === 'auto' ? 'auto' : 3; redo(); }), '',
        con.groupSize === 'auto' ? [] : F.number(() => con.groupSize, (v) => { con.groupSize = v; redo(); }, 'Group size', { whole: true, above: true, max: con.pattern === 'tree' ? MAX_TREE : Infinity, title: `Points at most per ${what}` }))),
      con.pattern === 'tree' ? row('Min. branch', withUnit(F.dist(() => con.minBranch, (m) => { con.minBranch = m; redo(); }, 'Shortest branch', { zero: true,
        title: 'A hub at least this far from its points' }))) : null,
      // the roots, a table: a point's name (a link), or a new root's place; its weight; × drops it
      h('div', { class: 'fblock' }, h('h3', { title: 'Click the map, or a point' }, `Roots (${c.roots.length})`),
        names.length ? listGrid({ name: 'roots', plain: true, head: true, columns: [{ head: 'Root', width: 170 }, { head: 'Weight', width: 70, cls: 'n', title: 'Its pull' }, { width: 40 }],
          rows: names.map((name, k) => ({ cells: [k < con.roots.length ? link(con.roots[k].id) : fvalue(name, { title: `${con.newRoots[k - con.roots.length][1].toFixed(5)}, ${con.newRoots[k - con.roots.length][0].toFixed(5)}` }),
            weight(k), h('button', { type: 'button', class: 'x', 'aria-label': `Drop ${name}`, title: 'Drop it', onclick: drop(k) }, '×')] })) }) : null),
      h('p', { class: 'note fsummary' }, summary, unused.length ? ` Not used: ${unused.join(', ')} (no group is cheapest from it; a weight above 1 would pull some).` : '')];
  }
  // Distribute along a line or a point's arc: one form, one undo step
  function distributionForm() {
    const doc = drawing.doc, along = find(doc, form.along.element), editing = form.distributionId && distributions(doc).find((a) => a.id === form.distributionId);
    const tr = alongTrace(doc, along.el, dform.part), closed = tr?.closed;
    const run = distributionRun(), points = run.points, redo = formChanged;
    // a distance that may be 0 (margins, the offset), or must be above 0 (spacing)
    const dist = (key, aria, zero) => withUnit(F.dist(() => dform[key], (m) => { dform[key] = m; redo(); }, aria, { zero }));
    const differs = editing && points.length !== editing.points.length;
    const connected = differs && connections(doc).some((c) => c.pointIds.some((n) => editing.points.some((x) => x.pointId === n)));
    // what is repeated: a built-in kind (the circle to start with), or a preset of the user's (its size its own)
    const mine = drawing.presets.filter((x) => x.point.parts.length);
    const choose = (v) => {
      dform.preset = v;
      const pre = v.startsWith('preset:') && mine.find((x) => `preset:${x.name}` === v);
      dform.copy = pre ? structuredClone(pre.point) : null; // its symbol, parts and own look, as placed by hand
      redo();
    };
    const reach = dform.copy ? Math.max(...dform.copy.parts.map((q) => q.radius ?? q.length / 2)) : null;
    const arc = along.kind === 'point';
    title = `${editing ? 'Edit, distributed along' : 'Distribute along'} ${label(along.kind, along.el)}`;
    return [
      arc && along.el.parts.length > 1 ? row('Part', select('Part', along.el.parts.map((part, i) => [i, `${i + 1} · ${PART_NAME[part.kind]}${part.name ? ` ${part.name}` : ''}`]), dform.part ?? followedPart(along.el), (v) => { dform.part = +v; redo(); })) : null,
      row('By', segOf('Points by', [['spacing', 'Spacing'], ['count', 'Count']], dform.by, (v) => { dform.by = v; redo(); })),
      dform.by === 'spacing' ? row('Spacing', dist('spacing', 'Spacing', false)) : row('Count', F.number(() => dform.count, (v) => { dform.count = v; redo(); }, 'Count', { whole: true, above: true, max: MAX_COPIES })),
      run.capped ? h('p', { class: 'note warn' }, `At most ${MAX_COPIES.toLocaleString('en')} copies: the spacing would give more`) : null,
      closed ? null : row('Margins', pair(dist('startMargin', 'Start margin', true), '·', dist('endMargin', 'End margin', true))),
      row('Offset', pair(dist('offset', 'Offset', true), '·', select('Side', [['left', arc ? 'Out' : 'Left'], ['right', arc ? 'In' : 'Right'], ['alternate', 'Alternate']], dform.side, (v) => { dform.side = v; redo(); }))),
      row('Copy', select('Copy', [...Object.keys(BUILT_IN).map((k) => [k, builtInName(k)]), ...mine.map((x) => [`preset:${x.name}`, x.name]),
        ...(dform.copy && !mine.some((x) => `preset:${x.name}` === dform.preset) ? [[dform.preset, `${dform.preset.slice(7)} (as copied)`]] : [])], dform.preset, choose, { title: 'What each copy is' })), // a preset renamed or deleted since: its copy is kept
      dform.copy ? row('Radius', distValue(reach, { title: 'The preset\'s own' }))
        : row('Radius', withUnit(F.dist(() => dform.radius, (m) => { dform.radius = m; redo(); }, 'Radius', { check: (m) => (m >= MAX_RADIUS ? 'too large' : null), title: dform.preset === 'circle' ? 'Each circle\'s, whatever the spacing' : 'Its largest part\'s reach, whatever the spacing' }))),
      dform.preset === 'circle' ? row('Aperture', F.angle(() => dform.aperture, (v) => { dform.aperture = v; redo(); }, `Aperture (degrees): a sector ${arc ? 'facing outwards' : 'facing away from the line'}; empty: a circle`, { wrap: false, none: true }), funit('°')) : null,
      editing ? null : row('In group', select('Group', [['', 'none (at the top)'], ...doc.groups.map((g) => [g.id, groupPath(drawing.doc, g)])], dform.groupId ?? '', (v) => { dform.groupId = v || null; }, { title: 'Where its group goes' })),
      h('p', { class: 'note fsummary' }, points.length ? `${copies(points.length)}.` : `No copy fits: ${arc ? 'the part' : 'the line'} is shorter than the margins, or the spacing too long.`),
      differs ? h('p', { class: 'note warn' }, `Another number of points (${editing.points.length} now): they are made anew${connected ? ', and connected again' : ''}. Changes made to those by hand are lost; Undo brings them back.`) : null,
      formButtons(editing ? 'Apply' : 'Create', points.length, () => {
        let r;
        drawing.change((d) => { r = editing ? editDistribution(d, editing.id, dformParams()) : makeDistribution(d, dformParams()); });
        closeForm();
        renderInspector(); // the selection may stay as it was (the group)
        drawing.select([r.distribution.groupId]);
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
        if (r.unused.length) note(unusedRoots(r.unused));
      })];
  }

  // nothing selected: the drawing itself
  function drawingInspector() {
    const m = drawing.doc.meta;
    const meta = (key, aria, area) => F.text(() => m[key], (v) => drawing.change((doc) => { doc.meta[key] = v; }), aria, area ? 2 : 0);
    const n = drawElements().length;
    const groupName = (gid) => (gid ? groupPath(drawing.doc, drawing.doc.groups.find((g) => g.id === gid)) : 'Not grouped');
    const keys = [...new Set(elements(drawing.doc).filter((x) => x.kind !== 'group').flatMap((x) => x.el.properties.map((p) => p.key)))].sort((a, b) => a.localeCompare(b));
    if (totalsBy && !keys.includes(totalsBy)) { totalsBy = ''; computeFacts(); } // its key gone
    const by = select('Totals by', [['', 'group'], ...keys.map((k) => [k, k])], totalsBy || '', (v) => { totalsBy = v; computeFacts(); renderInspector(); });
    const offsetElsewhere = elements(drawing.doc).filter((x) => x.el.look?.offset != null); // where Offset is set on an element
    title = `Drawing · ${m.title?.trim() || 'Untitled drawing'}`;
    const titleField = Object.assign(meta('title', 'Title'), { placeholder: 'Untitled drawing' }); // what the tree and the bar call it while it has none
    const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    return [row('Title', titleField), row('Description', meta('description', 'Description', true)), row('Author', meta('author', 'Author')),
      row('Created', fvalue(when(drawing.doc.created), { title: 'Last change: ' + when(drawing.doc.modified) })),
      lookBlock([{ kind: 'drawing', el: drawing.doc }], LOOK_FIELDS.drawing, 'Display', [
        offsetElsewhere.length ? h('p', { class: 'note' }, 'Offset also set on ', ...offsetElsewhere.map((x) => link(x.el.id))) : null,
        row('Units', segOf('Distance units', [['km', 'km', 'Kilometres'], ['nm', 'NM', 'Nautical miles']], ctx.display.units, (v) => ctx.setDisplay({ units: v }))),
        row('Leg bearings', check('', ctx.display.bearings, (v) => ctx.setDisplay({ bearings: v }), { 'aria-label': 'Leg bearings', title: 'Beside each length on the map' }))]),
      n > 1 ? totalsBlock(keys.length ? by : null, groupName) : null,
      drawing.saving.failed ? h('p', { class: 'note warn' }, 'This browser does not let the drawing be saved (storage full or turned off): Download › Drawing (GeoJSON) keeps it as a file.') : null,
      drawing.saving.otherTab ? h('p', { class: 'note warn' }, 'The drawing was changed in another tab. Saving here replaces that version. ', h('button', { type: 'button', class: 'small', onclick: () => location.reload() }, 'Reload')) : null];
  }
  // The Totals view (docs/drawing-ui.md §5): a list grid, no head, of the lines by group (or by a
  // property's values), each listed under its group, those a connection made summed by what they are
  // (trunks and branches; a chain's root links and the links between points); the areas; the points
  // by kind. Each section's row names its columns; a group's rows fold; a name selects its element;
  // Copy gives every row tab-separated, in metres, for a spreadsheet
  const MADE_PART = { trunk: 'trunks, root → hub', branch: 'branches, hub → point', 'root link': 'root → first point', link: 'between points' };
  // b: what is counted (the drawing's, or a group's: breakdown's only); key: the property it is by, or ''
  const totalsClosed = new Set(); // the Totals sections folded (by their grid's name)
  function totalsBlock(by, groupName, b = fx().breakdown, key = totalsBy, name = 'totals') {
    const u = drawing.units(), doc = drawing.doc;
    const open = !totalsClosed.has(name);
    const head = foldHead('Totals', open, () => { totalsClosed[open ? 'add' : 'delete'](name); renderInspector(); });
    if (!open) return h('div', { class: 'fblock' }, head);
    // a group holding a connection: its pattern and roots beside the name (two are both "Connection")
    const made = (k) => { const c = k && connections(doc).find((x) => x.groupId === k); return c ? ` (${c.pattern}, from ${c.roots.map((r) => label('point', now(r.id))).join(', ')})` : ''; };
    const keyName = (k) => (key ? (k ? `“${k}”` : `No ${key}`) : groupName(k) + made(k));
    const rows = [], copy = []; // copy: [section, group, name, count, length m, area m², perimeter m]
    const tr = (cls, ...cells) => rows.push({ cls, cells });
    const sel = (text, id) => h('button', { type: 'button', class: 'small link', title: 'Select it', onclick: () => drawing.select([id]) }, text);
    const fold = (k, folded, text) => h('button', { type: 'button', class: 'small link tfold', 'aria-expanded': String(!folded), title: folded ? 'Show its lines' : 'Fold its lines', onclick: () => { totalsFolded[folded ? 'delete' : 'add'](k); renderInspector(); } }, `${folded ? '▸' : '▾'} ${text}`);
    const nameOf = (kind, id) => label(kind, find(doc, id).el);
    const lineRows = [...b.lines.rows].sort((p, q) => (!p.key) - (!q.key) || keyName(p.key).localeCompare(keyName(q.key)));
    const one = lineRows.length === 1 && (!lineRows[0].key || !groupName) && !key; // nothing grouped: no group rows (by a property, the row says "No …")
    if (b.lines.count) {
      tr('sec', 'Lines', '', 'Length');
      for (const r of lineRows) {
        const folded = totalsFolded.has(r.key), g = one ? '' : keyName(r.key);
        if (!one) { tr('grp', fold(r.key, folded, g), plural(r.count, 'line'), fmtDist(r.length, u)); copy.push(['Lines', g, '', r.count, r.length, '', '']); }
        for (const p of r.parts) { if (!folded) tr(one ? 'part top' : 'part', MADE_PART[p.part], plural(p.count, 'line'), fmtDist(p.length, u)); copy.push(['Lines', g, MADE_PART[p.part], p.count, p.length, '', '']); }
        for (const l of r.lines) { if (!folded) tr(one ? 'item top' : 'item', sel(nameOf('line', l.id), l.id), '', fmtDist(l.length, u)); copy.push(['Lines', g, nameOf('line', l.id), 1, l.length, '', '']); }
      }
      tr('all', 'All lines', plural(b.lines.count, 'line'), fmtDist(b.lines.length, u));
      copy.push(['Lines', '', 'All lines', b.lines.count, b.lines.length, '', '']);
    }
    if (b.areas.count) {
      tr('sec', 'Areas', 'Area', 'Perimeter');
      for (const a of b.areas.rows) { tr('item top', sel(nameOf('line', a.id), a.id), fmtArea(a.area, u), fmtDist(a.perimeter, u)); copy.push(['Areas', '', nameOf('line', a.id), 1, '', a.area, a.perimeter]); }
      tr('all', 'All areas', fmtArea(b.areas.area, u), fmtDist(b.areas.perimeter, u));
      copy.push(['Areas', '', 'All areas', b.areas.count, '', b.areas.area, b.areas.perimeter]);
    }
    if (b.points.count) {
      tr('sec', 'Points', 'Count', '');
      for (const [k, c] of [...b.points.kinds].sort((p, q) => q[1] - p[1])) { const kname = key ? keyName(k) : POINT_KIND_NAME[k] ?? OUTLINE_NAME[k] ?? k; tr('item top', kname, String(c), ''); copy.push(['Points', '', kname, c, '', '', '']); }
      tr('all', 'All points', String(b.points.count), '');
      copy.push(['Points', '', 'All points', b.points.count, '', '', '']);
    }
    const hidden = b.lines.hidden || b.areas.hidden || b.points.hidden;
    const HEAD = ['Section', key || 'Group', 'Name', 'Count', 'Length (m)', 'Area (m²)', 'Perimeter (m)'];
    const r1 = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v);
    head.title = `Guides and measurements are left out; lines running together each count${hidden ? '; hidden ones are counted' : ''}`;
    head.lastChild.append(copyBtn(() => [HEAD, copy.map((c) => c.map(r1))]));
    return h('div', { class: 'fblock' }, head,
      by ? row('By', by) : null,
      listGrid({ name, plain: true, columns: [{ width: 150 }, { width: 70, cls: 'num' }, { width: 84, cls: 'num' }], rows }));
  }
  // Built again on each change, and put in place of what it shows (dom.js morph): what stays the same
  // stays, with its focus, caret and scroll, so Tab and a click from a field just applied land where
  // they go. Something else shown (another selection, a form): built anew.
  let shows = null;
  function renderInspector() {
    placesRead.clear();
    dropProfileCursor(); // a profile shown again makes its own
    const xs = drawing.selected();
    if (form && selKey() !== form.sel) { closeForm(); note('The form closed: the selection changed'); }
    ctx.frame.has(!!form || xs.length > 0 || !NARROW.matches); // Properties shown while it has something (a computer: the drawing, with nothing selected), and is on
    // not seen (off, or nothing to show): not built; built anew when it is (render('tool'))
    if (ctx.props.hidden) { shows = null; return; }
    const what = `${form ? `${form.kind}:${form.sel}` : ''}|${selKey()}`;
    // a field being edited, when something else is to be shown, is applied first, to the element it belongs to
    if (what !== shows && inspector.contains(document.activeElement)) document.activeElement.blur();
    const kids = form ? (form.kind === 'distribute' ? distributionForm() : connectForm()) : !xs.length ? drawingInspector()
      : xs.length > 1 ? severalInspector(xs)
        : { point: pointInspector, line: lineInspector, group: groupInspector, label: labelInspector }[xs[0].kind](xs[0].el.id);
    const top = inspector.scrollTop;
    if (what === shows) morph(inspector, h('div', {}, kids.flat().filter(Boolean)));
    else inspector.replaceChildren(...kids.flat().filter(Boolean));
    shows = what;
    inspector.scrollTop = top;
    renderHead(xs);
  }
  // The inspector's head (drawing-ui.md §5): what it shows, then Zoom to, Duplicate, Group and Delete
  // for the selection (with nothing selected, Zoom to all of it; none while a form is open).
  function renderHead(xs = drawing.selected()) {
    inspTitle.textContent = title;
    inspTitle.title = title; // whole, where the head cuts it
    const ids = xs.map((x) => x.el.id), every = ids.length ? ids : elements(drawing.doc).map((x) => x.el.id);
    const act = (paths, aria, title, run) => h('button', { type: 'button', class: 'hact', 'aria-label': aria, title, onclick: run }, icon(...paths));
    inspActs.replaceChildren(...(form ? [] : [
      every.length ? act(UI_ICON.zoom, 'Zoom to', 'Zoom to', () => showOnMap(new Set(every))) : null,
      ids.length ? act(UI_ICON.duplicate, 'Duplicate', `Duplicate (${MOD} D)`, () => drawing.duplicate()) : null,
      ids.length ? act(UI_ICON.group, 'Group', 'Group', () => groupThem(ids)) : null,
      ids.length ? act(UI_ICON.delete, 'Delete', 'Delete (Delete)', () => del(ids)) : null,
    ].filter(Boolean)));
  }

  // ---- map and files --------------------------------------------------------------------------
  function showOnMap(ids) {
    const b = boundsOf(drawing.doc, ids);
    if (b) map.fitBounds(b, { padding: ctx.free(), maxZoom: 20, animate: animate() }); // clear of the panel; close enough for a 6 m shape
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
      if (k === 'c' && (!drawing.sel.size || !getSelection().isCollapsed)) return; // nothing selected, or text (in Properties): the page's own copy
      e.preventDefault();
      const n = k === 'c' ? drawing.copy() : k === 'v' ? drawing.paste() : drawing.duplicate();
      if (n && k === 'c') note(`Copied: ${plural(n, 'element')}`); // the clipboard has no other sign; a paste or a copy made is selected
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
    // a place current (a point of a line, a corner, a part: pressed on the map or its row): it, else the selection
    if (!typed && (e.key === 'Delete' || (mac && e.metaKey && e.key === 'Backspace')) && drawing.sel.size) { e.preventDefault(); if (!drawing.removePlace()) del([...drawing.sel]); return; }
    if (typed || mod || e.altKey) return;
    // the tools' keys: app.js, from anywhere
    // ↑ ↓ step the tree, unless what has the focus takes them itself (a slider, a radio card, the map)
    const ownArrows = e.target.closest?.('input[type=range], .maplibregl-canvas');
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !ownArrows && ctx.frame.tab === 'elements' && tree.step(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault(); // the tree stepped only while seen
    else if (e.key === 'F2' && drawing.sel.size === 1) { e.preventDefault(); tree.rename([...drawing.sel][0]); }
  });

  // ---- rendering ---------------------------------------------------------------------------
  return {
    render(what) {
      if (what === 'tool') { // also after any change of the frame: what has just come into view built
        if (listStale && listSeen()) { listStale = false; tree.render(); }
        if (shows === null && !ctx.props.hidden) renderInspector();
        return renderTools();
      }
      if (what === 'draft') return tools.renderTouch();
      if (what === 'cancel') { closeForm(); return renderInspector(); } // Esc or a right-click on the map with a form open
      if (what === 'drag') { if (!drawing.drag) renderInspector(); return; } // when it is let go (the map shows its values while it moves); the tree then too
      // a line's point or a point's part pressed on the map: its row in the table made current
      if (what === 'place') { const { id, index } = drawing.currentPlace; if (drawing.sel.size === 1 && drawing.sel.has(id)) pickPlace(`${id}:${kindOf(id) === 'point' ? 'parts' : 'points'}`, index, kindOf(id) !== 'point'); return; }
      if (what === 'box' && !drawing.sel.size) note('Nothing lies entirely inside the box'); // a box drawn: why nothing is selected
      // a label just placed (and selected, so shown): its text ready to be typed
      if (what === 'placed') {
        if (ctx.props.hidden) ctx.frame.showProps(true); // typing it is the point of placing it: Properties shown (the user's switch as it was)
        if (shows === null) renderInspector();
        const t = inspector.querySelector('.ltext'); t?.focus(); t?.select(); return;
      }
      // the selection only changed: the rows marked again, not built again (each row's value is a length
      // or an area, computed)
      if (what === 'sel') {
        if (!listStale) tree.mark();
      } else renderList();
      renderInspector();
      if (form && what === 'doc') formPreview(); // the form's preview follows the drawing (an undo, its line edited)
      if (what === 'doc') for (const id of profiles.keys()) if (!find(drawing.doc, id)) { profiles.delete(id); profileShown.delete(id); } // a line gone: its profile too
      renderTools();
    },
    importFile: (f) => files.importFile(f), // a file dropped on the map (app.js)
    press: tools.press, // the tools' keys (app.js)
  };
}
