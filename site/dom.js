// The page's DOM helpers: an element by selector, an element built with its attributes, handlers
// (on…) and children, and whether a key pressed goes to a field.
export const $ = (sel, el = document) => el.querySelector(sel);
// an SVG element, built as h builds others (attributes only, no handlers)
export const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids.flat().filter((k) => k != null));
  return el;
};
// this browser's storage: read and written where it is allowed (a private window, storage full or
// turned off: nothing, and set says false); json(k): what k holds, parsed, or null
export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  remove: (k) => { try { localStorage.removeItem(k); } catch { /* nothing to remove */ } },
  json: (k) => { try { return JSON.parse(store.get(k)); } catch { return null; } },
};
// a phone's width: the panels one bottom sheet at a time, closed to start with
export const NARROW = typeof matchMedia === 'function' ? matchMedia('(max-width: 719px)') : { matches: false };
// the map's flights, where the system asks for less motion: none (the page's own transitions: style.css)
export const animate = () => !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
// a bar without room for the file group and the search field (a phone, or a finger's 44 px buttons
// under 1,280 px): Open's menu (☰) holds them all, the search behind its lens (style.css says the same)
export const COMPACT = typeof matchMedia === 'function' ? matchMedia('(max-width: 719px), (pointer: coarse) and (max-width: 1279px)') : { matches: false };
// whether el (a key's target) is a field taking text: a box ticked, a colour or a slider is not,
// so the keys stay the page's
export const typing = (el) => !!el?.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]), select, textarea');
export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) { el.addEventListener(k.slice(2), v); el.acts = true; } // acts: morph() keeps it only as the same thing
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null));
  return el;
};

// Make old's children what next's are, keeping what is the same (docs/drawing-ui.md §5: the
// inspector updated in place, its focus, caret and scroll untouched). A node kept keeps its own
// handlers, which refer to it; so it is kept only when it is the same thing: its tag and what names
// it, and for a button (or what acts as one) its class and text too, so that it never acts on
// something else than it says; a button whose action hangs on more (a page to go to, a row to act
// on) says it in its data-key. A field being typed in keeps its text; a field's
// reset(text) (fields.js) takes the new one. Anything else is replaced, that subtree only.
const NAMES = ['type', 'role', 'aria-label', 'data-unit', 'data-r', 'data-id', 'data-grid', 'data-rows', 'data-v', 'data-tab', 'data-key'];
const sameAs = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && NAMES.every((k) => a.getAttribute(k) === b.getAttribute(k))
  && (!(button(a) || button(b)) || (a.className === b.className && a.textContent === b.textContent))));
const button = (el) => el.acts && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
export function morph(old, next) {
  const was = [...old.childNodes], now = [...next.childNodes];
  now.forEach((n, i) => {
    const o = was[i];
    if (!o) old.append(n);
    else if (!sameAs(o, n)) old.replaceChild(n, o);
    else if (o.nodeType === 3) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; }
    else if (o.nodeType === 1) update(o, n);
  });
  for (const o of was.slice(now.length)) o.remove();
}
function update(o, n) {
  for (const { name } of [...o.attributes]) if (!n.hasAttribute(name)) o.removeAttribute(name);
  for (const { name, value } of [...n.attributes]) if (o.getAttribute(name) !== value) o.setAttribute(name, value);
  if (o.style && o.style.cssText !== n.style.cssText) o.style.cssText = n.style.cssText; // set through the CSSOM (the page's CSP allows no style attribute)
  if (o.tagName === 'INPUT' && (o.type === 'checkbox' || o.type === 'radio')) { o.checked = n.checked; o.indeterminate = n.indeterminate; return; }
  if (o.tagName === 'SELECT') { morph(o, n); o.selectedIndex = n.selectedIndex; return; }
  if (o.tagName === 'INPUT' || o.tagName === 'TEXTAREA') {
    if (o === document.activeElement && (o.edited?.() ?? true)) return; // being typed in: its text stays
    if (o.reset) o.reset(n.value); else if (o.value !== n.value) o.value = n.value;
    return;
  }
  morph(o, n);
}
