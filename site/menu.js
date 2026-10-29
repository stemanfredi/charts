// The page's pop-ups, dialogs and note.

import { h } from './dom.js';

// A pop-up opened from a button (the bar's Open and Download, the time's box): Esc or a
// pointer down elsewhere closes it (Esc gives the focus back to its button), and so does a menu item
// chosen unless choose is false; ↑ ↓ move between its items (opened from the keyboard, the focus
// starts on the first). place(button) puts it where it goes; closed() runs as it closes. The button
// it is opened from says so (aria-expanded).

export function popup(el, { place = () => {}, closed = () => {}, choose = true } = {}) {
  let from = null;
  const items = () => [...el.querySelectorAll('[role=menuitem]')];
  function open(button, focus = false) {
    close();
    from = button;
    el.hidden = false;
    place(button);
    button.setAttribute('aria-expanded', 'true');
    if (focus) items()[0]?.focus();
  }
  function close() {
    if (el.hidden) return;
    el.hidden = true;
    from?.setAttribute('aria-expanded', 'false');
    closed();
  }
  document.addEventListener('pointerdown', (e) => { if (!el.hidden && !el.contains(e.target) && !from?.contains(e.target)) close(); });
  // Esc, wherever the focus is (on the button after a click), closes it before anything else hears it
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) { e.stopPropagation(); close(); from?.focus(); } }, true);
  if (choose) el.addEventListener('click', (e) => { if (e.target.closest('[role=menuitem]')) close(); });
  el.addEventListener('keydown', (e) => {
    const its = items(), i = its.indexOf(document.activeElement);
    if (its.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); its[(i + (e.key === 'ArrowDown' ? 1 : -1) + its.length) % its.length].focus(); }
  });
  // its button pressed: opened from it (from the keyboard: its first item focused), or closed
  const toggle = (button, e) => (el.hidden || from !== button ? open(button, e?.detail === 0) : close());
  return { open, close, toggle };
}

// A dialog: its title, its body (body(done): what it shows; done(value) answers), its buttons
// ([value, text], the last the main one; a value may be a function, read when chosen), then cancel's
// (Cancel, Esc), then a note. Resolves to the value chosen, or null. One at a time.
let askDialog = null;
export function dialog(title, body, buttons, cancel = 'Cancel', foot = null) {
  if (askDialog?.open) return Promise.resolve(null); // one at a time: a second asked meanwhile is not
  if (!askDialog) document.body.append(askDialog = h('dialog', { class: 'dreport', 'aria-labelledby': 'dask-title' }));
  return new Promise((resolve) => {
    let answer = null;
    const done = (v) => { answer = v; askDialog.close(); };
    askDialog.replaceChildren(h('h2', { id: 'dask-title' }, title), body(done),
      h('div', { class: 'fbuttons' }, buttons.map(([v, t], i) => h('button', { type: 'button', class: i === buttons.length - 1 ? 'done' : '', onclick: () => done(typeof v === 'function' ? v() : v) }, t)),
        h('button', { type: 'button', onclick: () => askDialog.close() }, cancel)));
    if (foot) askDialog.append(foot); // none: nothing (replaceChildren would write "null")
    askDialog.addEventListener('close', () => resolve(answer), { once: true });
    askDialog.showModal();
  });
}
// a question: resolves to the chosen button's value, or null
export const ask = (title, text, buttons) => dialog(title, () => h('p', {}, text), buttons);
// a text asked for: resolves to it, or null
export function askText(title, what, value = '') {
  const input = h('input', { type: 'text', value, 'aria-label': what });
  const asked = dialog(title, (done) => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(input.value); } });
    return h('p', {}, h('label', {}, `${what} `, input));
  }, [[() => input.value, 'OK']]);
  input.select();
  return asked;
}

// The note: what just happened, for a few seconds, a chip under the bar
let noteEl = null, noteTimer = 0;
export function note(text) {
  if (!noteEl) document.body.append(noteEl = h('div', { class: 'dnote', role: 'status', hidden: true })); // a chip under the bar, at the centre
  clearTimeout(noteTimer);
  noteEl.textContent = text;
  noteEl.hidden = false;
  noteTimer = setTimeout(() => { noteEl.hidden = true; }, 4000);
}
