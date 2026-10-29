// The panels' fields (Properties, Layers). A field applies on Enter or when it loses focus, never
// on each key; a value it cannot read stays marked, is not applied, and note() says why; Esc puts
// back what it showed and leaves it. A read gives the value to apply, or undefined: not valid (null
// is a value: "none", "the default"). A distance's, an angle's or a coordinate's get() null (several
// elements that differ): the field empty, "mixed" its placeholder.

import { h } from './dom.js';
import { parseCoord, parseDist, distText, UNIT_TEXT, inUnit } from './format.js';
import { MAX_LAT, norm360 } from './geo.js';

const num = (t) => Number(t.replace(',', '.').trim());
// A number in a text stepped by one unit of its last decimal place (a whole: by 1), ten with big, its
// unit kept ("1.2 km" ↑ "1.3 km"); lo: the least it may be. null: no number there.
export function stepped(text, up, big, lo = -Infinity) {
  const m = /^\s*(-?\d+(?:[.,](\d+))?)\s*(.*?)\s*$/.exec(text);
  if (!m) return null;
  const dec = m[2]?.length ?? 0, v = num(m[1]) + (up ? 1 : -1) * (big ? 10 : 1) * 10 ** -dec;
  return `${Math.max(lo, v).toFixed(dec)}${m[3] ? ` ${m[3]}` : ''}`;
}

// fields({ note(text), units() ('km' | 'nm') }): the field builders, saying what was not applied
// through note
export function fields({ note, units }) {
  // a text input: show() its text; read(text) the value, or undefined; apply(value). attrs: the
  // input's own, bad: what a valid value is ("a distance above 0"), and nudge(text, up, big): the
  // text ↑ or ↓ makes of it (Shift: big), or null: in a value grid's row (docs/drawing-ui.md §5),
  // the arrows step it, each step applied
  function field(show, read, apply, { bad, nudge, ...attrs } = {}) {
    const input = h('input', { value: show(), spellcheck: 'false', ...attrs });
    let shown = input.value; // what Esc puts back
    const title = input.title;
    let applied = shown; // what it applied last: the same text again (Enter, then the blur that follows) is not applied twice
    // morph (dom.js): typed in and not applied yet; or the text it shows now
    input.edited = () => input.value !== applied;
    input.reset = (t) => { shown = applied = input.value = t; ok(); };
    const ok = () => { input.classList.remove('bad'); input.removeAttribute('aria-invalid'); input.title = title; };
    input.addEventListener('change', () => {
      if (input.value === applied) return;
      const v = read(input.value);
      if (v === undefined) { // marked, and why, on the field (its tooltip) and in the panel's note
        const why = `${attrs['aria-label'] || 'Value'} not applied: ${bad || 'not valid'}`;
        input.classList.add('bad'); input.setAttribute('aria-invalid', 'true'); input.title = why;
        note(why);
        return;
      }
      ok();
      applied = input.value;
      apply(v);
    });
    input.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && nudge && input.closest('.vrow')) {
        const t = nudge(input.value, e.key === 'ArrowUp', e.shiftKey);
        if (t !== null) { e.preventDefault(); input.value = t; input.dispatchEvent(new Event('change')); }
        return;
      }
      if (e.key === 'Enter') input.dispatchEvent(new Event('change'));
      else if (e.key === 'Escape') { e.stopPropagation(); input.value = shown; ok(); input.blur(); }
    });
    return input;
  }
  // free text, on one line or several (a textarea: rows)
  const text = (get, put, aria, rows = 0) => {
    if (!rows) return field(get, (t) => t, put, { 'aria-label': aria });
    const t = h('textarea', { rows, 'aria-label': aria }, get());
    t.addEventListener('change', () => put(t.value));
    return t;
  };
  // a distance in the display units (a suffix may say another: 500 m, 1.2 NM). zero: 0 allowed;
  // check(m): an error text, or null; in: a unit of its own ('m', 'km', 'nm'), its number alone shown
  // to the metre, or to the unit's thousandth (a table's column, its unit in the head)
  // The number alone is shown; its unit is beside it (the field's unitText(): the panel's row says
  // it), or in a table's head
  const dist = (get, put, aria, { zero = false, check = () => null, in: fixed = null, ...attrs } = {}) => {
    let unit;
    const input = field(() => { const v = get(); if (v == null) { unit = fixed || (units() === 'nm' ? 'nm' : 'km'); return ''; } if (fixed) { unit = fixed; return inUnit(v, fixed); } const t = distText(v, units()); unit = t.unit; return zero && !v ? '0' : `${t.value}`; }, (t) => {
      const m = zero && t.trim() === '0' ? 0 : parseDist(t, unit);
      return m === null || (zero ? m < 0 : m <= 0) || check(m) ? undefined : m;
    }, put, { 'aria-label': aria, class: 'dist', nudge: (t, up, big) => stepped(t, up, big, 0), bad: zero ? 'a distance, 0 or more, with m, km or NM' : 'a distance above 0, with m, km or NM',
      title: 'In the unit beside it, or with one', placeholder: 'mixed', ...attrs });
    input.unitText = () => UNIT_TEXT[unit];
    input.dataset.unit = unit; // morph (dom.js) replaces the field when the unit it reads in changes
    return input;
  };
  // degrees: wrap (a bearing: any number, read modulo 360), else strictly between lo and hi; fixed:
  // its decimals always shown (a table's column)
  const angle = (get, put, aria, { lo = 0, hi = 360, wrap = true, fixed = null, none = false } = {}) => field(() => { const v = get(); return v == null ? '' : fixed == null ? `${+v.toFixed(4)}` : v.toFixed(fixed); }, (t) => {
    const v = num(t.replace('°', ''));
    if (t.trim() === '' && none) return null; // none: empty is a value of its own (no sector)
    if (t.trim() === '' || !Number.isFinite(v)) return undefined;
    if (wrap) return norm360(v);
    return v > lo && v < hi ? v : undefined;
  }, put, { 'aria-label': aria, class: 'angle', inputmode: 'decimal', placeholder: 'mixed', nudge: (t, up, big) => { const v = num(t.replace('°', '')); return Number.isFinite(v) ? `${+(v + (up ? 1 : -1) * (big ? 10 : 1)).toFixed(4)}` : null; }, bad: wrap ? 'degrees' : `degrees between ${lo} and ${hi}` });
  // one coordinate (axis 'lat' or 'lon'): decimal degrees, degrees and minutes, DMS, a hemisphere letter;
  // fixed: its decimals always shown (a table's column: 6, a decimetre)
  const coord = (axis, get, put, aria = axis === 'lat' ? 'Latitude' : 'Longitude', fixed = null) => field(() => { const v = get(); return v == null ? '' : fixed == null ? `${+v.toFixed(7)}` : v.toFixed(fixed); }, (t) => {
    const v = parseCoord(t, axis);
    return v === null || (axis === 'lat' && Math.abs(v) > MAX_LAT) ? undefined : v;
  }, put, { 'aria-label': aria, class: 'coord', placeholder: 'mixed', bad: axis === 'lat' ? 'a latitude between −85.05 and 85.05 (N or S)' : 'a longitude between −180 and 180 (E or W)',
    title: 'Degrees, or 37 17.48N' });
  // a position [lon, lat]: its latitude, then its longitude, each applied alone (fixed: decimals shown)
  const position = (get, put, aria = '', fixed = null) => [
    h('span', { class: 'funit' }, 'Lat'), coord('lat', () => get()[1], (v) => put([get()[0], v]), `${aria}Latitude`.trim(), fixed),
    h('span', { class: 'funit' }, 'Lon'), coord('lon', () => get()[0], (v) => put([v, get()[1]]), `${aria}Longitude`.trim(), fixed)];
  // a number in a range (pixels, a count); whole: integers only
  const number = (get, put, aria, { min = 0, max = Infinity, above = false, whole = false, bad, ...attrs } = {}) => field(() => { const v = get(); return v == null ? '' : `${v}`; }, (t) => {
    if (!t.trim()) return undefined;
    const v = num(t);
    return Number.isFinite(v) && (!whole || Number.isInteger(v)) && (above ? v > min : v >= min) && v <= max ? v : undefined;
  }, put, { 'aria-label': aria, class: 'angle', inputmode: whole ? 'numeric' : 'decimal', nudge: (t, up, big) => stepped(t, up, big, min), bad: bad || `${whole ? 'a whole number' : 'a number'} ${above ? 'above' : 'from'} ${min}${max < Infinity ? ` to ${max}` : ''}`, ...attrs });
  return { field, text, dist, angle, coord, position, number };
}

// A choice among options ([[value, text]]) as a <select>: value the one chosen (null: "mixed", a
// disabled first option), pick(value) on a change; attrs on the select (title, class…)
export function select(aria, options, value, pick, attrs = {}) {
  return h('select', { 'aria-label': aria, ...attrs, onchange: (e) => pick(e.target.value) },
    value === null ? h('option', { value: '', selected: true, disabled: true }, 'mixed') : null,
    options.map(([v, text]) => h('option', { value: v, selected: value !== null && String(v) === String(value) }, text)));
}
// A box with its text after it: value true, false or null ("mixed": shown indeterminate), put(checked)
// on a change; attrs on the box (aria-label, title…), title also on the label (its tooltip)
export function check(text, value, put, attrs = {}) {
  const box = h('input', { type: 'checkbox', checked: value === true, ...attrs, onchange: (e) => put(e.target.checked) });
  box.indeterminate = value === null;
  return h('label', { class: 'fcheck', title: attrs.title }, box, text);
}

// A choice between a few values, as pressed buttons (a segmented control). options: [[value, label
// (text or nodes), title]]; get() the value now (null: none pressed, as for "mixed"); pick(value).
// The element's render() presses get()'s again.
export function choice(aria, options, get, pick) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': aria },
    options.map(([v, label, title]) => h('button', { type: 'button', title, 'data-v': String(v), onclick: () => pick(v) }, label)));
  el.render = () => { const now = get(); for (const [i, b] of [...el.children].entries()) b.setAttribute('aria-pressed', String(options[i][0] === now)); };
  el.render();
  return el;
}
