// The page's DOM helpers: an element by selector, an element built with its attributes, handlers
// (on…) and children, and whether a key pressed goes to a field.
export const $ = (sel, el = document) => el.querySelector(sel);
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
