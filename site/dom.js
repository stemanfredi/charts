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
// from 1024 px wide: the drawing a frame on the left, the map's controls a column top right
export const WIDE = typeof matchMedia === 'function' ? matchMedia('(min-width: 1024px)') : { matches: false, addEventListener() {} };
// whether el (a key's target) is a field taking text: a box ticked, a colour or a slider is not,
// so the keys stay the page's
export const typing = (el) => !!el?.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]), select, textarea');
export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null));
  return el;
};
