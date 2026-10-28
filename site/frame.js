// The page's frame (drawing-ui.md §1): a bar across the top, and over the map a panel on each side,
// the left one with tabs (Elements, Layers), the right one Properties. Each is as wide as dragged at
// its inner edge (double-click: the default), remembered in this browser. On a phone they are one
// bottom sheet at a time, as tall as dragged at its grip (dragged down to the bottom: closed). Which tab is open (or none) and whether
// Properties is on are the user's; Properties shows only while it has something to show (has()).
// What the panels hold is their modules': this only places them.

import { h, store, NARROW } from './dom.js';

const KEY = 'charts.frame';
const LEFT = { min: 200, max: 480, dflt: 260 }, RIGHT = { min: 260, max: 600, dflt: 320 }, SHEET = { min: 25, max: 90, dflt: 52 }; // px; the sheet in % of the window
const MIN_MAP = 480; // px of map kept between the two panels
const clamp = (v, r) => Math.round(Math.max(r.min, Math.min(r.max, v)));

// left, right: the panels (empty asides); tabs: [{ id, label, body }] for the left; icon(...paths).
// onChange(): after any change of what is shown.
export function createFrame({ left, right, tabs, icon, onChange = () => {} }) {
  const saved = store.json(KEY) ?? {};
  const st = {
    tab: NARROW.matches ? null : saved.tab === undefined ? 'layers' : saved.tab, // the left's tab, or null: closed (at first: Layers)
    last: saved.last ?? 'layers', // the tab the left's toggle opens
    props: NARROW.matches ? false : saved.props !== false, // Properties on (on a phone: off to start with)
    has: false, // Properties has something to show
    lw: clamp(saved.lw ?? LEFT.dflt, LEFT), rw: clamp(saved.rw ?? RIGHT.dflt, RIGHT), sh: clamp(saved.sh ?? SHEET.dflt, SHEET),
  };
  const save = () => store.set(KEY, JSON.stringify({ tab: st.tab, last: st.last, props: st.props, lw: st.lw, rw: st.rw, sh: st.sh }));
  const root = document.documentElement;

  // the bar's toggles: the left panel at its start, Properties at its end
  const toggle = (side, label, paths, onclick) => h('button', { type: 'button', class: `ptoggle ${side}`, 'aria-label': label, title: label, 'aria-pressed': 'false', onclick }, icon(...paths));
  const leftBtn = toggle('pleft', 'Elements and Layers', ['M4 5h16v14H4z', 'M9 5v14'], () => setTab(st.tab ? null : st.last));
  const rightBtn = toggle('pright', 'Properties', ['M4 5h16v14H4z', 'M15 5v14'], () => setProps(!st.props));

  // the left's tabs
  const tabBtns = tabs.map((t) => h('button', { type: 'button', role: 'tab', 'data-tab': t.id, onclick: () => setTab(t.id) }, t.label));
  for (const t of tabs) t.body.setAttribute('role', 'tabpanel');
  // a grip (the sheet's, on a phone) and an edge to drag (the panel's width)
  const grip = (panel) => h('div', { class: 'grip', 'aria-hidden': 'true', onpointerdown: (e) => drag(e, panel, 'sheet') });
  const edge = (panel, side) => h('div', { class: `edge ${side}`, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize', title: 'Drag to resize; double-click: the default width',
    onpointerdown: (e) => drag(e, panel, side), ondblclick: () => { st[side === 'left' ? 'lw' : 'rw'] = (side === 'left' ? LEFT : RIGHT).dflt; place(); save(); } });
  left.prepend(grip(left), h('div', { class: 'tabs', role: 'tablist' }, tabBtns));
  left.append(...tabs.map((t) => t.body), edge(left, 'left'));
  right.prepend(grip(right));
  right.append(edge(right, 'right'));

  function drag(e, panel, what) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let down = false; // the sheet dragged most of the way down: closed when let go
    const move = (ev) => {
      if (what === 'sheet') { const v = ((innerHeight - ev.clientY) / innerHeight) * 100; down = v < SHEET.min / 2; st.sh = clamp(v, SHEET); }
      else if (what === 'left') st.lw = clamp(ev.clientX - panel.getBoundingClientRect().left, LEFT);
      else st.rw = clamp(panel.getBoundingClientRect().right - ev.clientX, RIGHT);
      place();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', () => {
      el.removeEventListener('pointermove', move);
      if (down) { st.sh = SHEET.dflt; if (panel === left) setTab(null); else setProps(false); } else { place(); save(); }
    }, { once: true });
  }

  // Both panels while the map keeps MIN_MAP px between them; else Properties, while shown, has the room
  // (the left comes back when it goes). A phone: one sheet at a time, the last asked for.
  function place() {
    const wantsRight = st.props && st.has, both = !NARROW.matches && innerWidth - st.lw - st.rw >= MIN_MAP;
    const showLeft = !!st.tab && (both || !wantsRight || (NARROW.matches && !st.props)), showRight = wantsRight && !(NARROW.matches && showLeft);
    left.hidden = !showLeft;
    right.hidden = !showRight;
    for (const t of tabs) t.body.hidden = t.id !== st.tab;
    for (const b of tabBtns) b.setAttribute('aria-selected', String(b.dataset.tab === st.tab));
    leftBtn.setAttribute('aria-pressed', String(showLeft));
    rightBtn.setAttribute('aria-pressed', String(st.props));
    root.style.setProperty('--lw', `${st.lw}px`);
    root.style.setProperty('--rw', `${st.rw}px`);
    root.style.setProperty('--sheet-h', `${st.sh}vh`);
    document.body.classList.toggle('has-left', showLeft);
    document.body.classList.toggle('has-right', showRight);
    onChange();
  }
  function setTab(id) {
    st.tab = id;
    if (id) st.last = id;
    if (id && NARROW.matches) st.props = false; // a phone: the sheet holds one thing
    place();
    save();
  }
  function setProps(on) {
    st.props = on;
    if (on && NARROW.matches) st.tab = null;
    place();
    save();
  }
  NARROW.addEventListener?.('change', place);
  addEventListener('resize', place);
  place();
  return {
    leftBtn, rightBtn,
    get tab() { return st.tab; },
    get props() { return st.props; },
    setTab, setProps,
    toggleTab: (id) => setTab(st.tab === id ? null : id), // its key: open there, or closed when it is
    has: (v) => { if (v !== st.has) { st.has = v; place(); } }, // Properties has something to show, or not
  };
}
