// The page's frame (drawing-ui.md §1): a bar across the top, and over the map a panel on each side,
// the left one with tabs (Layers, Elements: each a button in the bar), the right one Properties.
// Each is as wide as dragged at its inner edge (double-click: the default), remembered in this browser. On a phone they are one
// bottom sheet at a time, as tall as dragged at its grip (dragged down to the bottom: closed). Which tab is open (or none) and whether
// Properties is on are the user's; Properties shows only while it has something to show (has()). On a phone, while it is off and the
// left is closed, what it shows peeks: its head alone at the bottom (its actions), a tap or a drag up on it Properties on.
// What the panels hold is their modules': this only places them.

import { h, store, NARROW } from './dom.js';
import { note } from './menu.js';
import { openKey } from './keys.js';

const KEY = 'charts.frame';
const LEFT = { min: 200, max: 480, dflt: 260 }, RIGHT = { min: 260, max: 600, dflt: 320 }, SHEET = { min: 25, max: 90, dflt: 52 }; // px; the sheet in % of the window
const MIN_MAP = 480; // px of map kept between the two panels
const clamp = (v, r) => Math.round(Math.max(r.min, Math.min(r.max, v)));

// left, right: the panels (empty asides); tabs: [{ id, label, paths, badge, body }] for the left (its
// button's icon, and what it shows besides, if anything); icon(...paths).
// onChange(): after any change of what is shown.
export function createFrame({ left, right, tabs, icon, onChange = () => {} }) {
  const saved = store.json(KEY) ?? {};
  const st = {
    tab: NARROW.matches ? null : saved.tab === undefined ? 'layers' : saved.tab, // the left's tab, or null: closed (at first: Layers)
    props: NARROW.matches ? false : saved.props !== false, // Properties on (on a phone: off to start with)
    has: false, // Properties has something to show
    lw: clamp(saved.lw ?? LEFT.dflt, LEFT), rw: clamp(saved.rw ?? RIGHT.dflt, RIGHT), sh: clamp(saved.sh ?? SHEET.dflt, SHEET),
  };
  const save = () => store.set(KEY, JSON.stringify({ tab: st.tab, props: st.props, lw: st.lw, rw: st.rw, sh: st.sh }));
  const root = document.documentElement;

  // the bar's toggles: a button per left tab (the left panel open on it, or closed when it shows it; while
  // the left makes way for Properties, it back on that tab, Properties off), Properties' at the bar's end
  const toggle = (cls, label, key, paths, onclick, badge = null) => h('button', { type: 'button', class: `ptoggle ${cls}`, 'aria-label': label, title: `${label} (${key})`, 'aria-pressed': 'false', onclick }, icon(...paths), badge);
  const tabBtns = tabs.map((t) => toggle('ptab', t.label, openKey(t.id), t.paths, () => toggleTab(t.id), t.badge));
  tabs.forEach((t, i) => { tabBtns[i].dataset.tab = t.id; });
  const rightBtn = toggle('pright', 'Properties', openKey('props'), ['M4 5h16v14H4z', 'M15 5v14'], () => setProps(!st.props));
  // a grip (the sheet's, on a phone) and an edge to drag (the panel's width)
  const grip = (panel) => h('div', { class: 'grip', 'aria-hidden': 'true', onpointerdown: (e) => drag(e, panel, 'sheet') });
  const edge = (panel, side) => h('div', { class: `edge ${side}`, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize', title: 'Drag to resize; double-click: the default width',
    onpointerdown: (e) => drag(e, panel, side), ondblclick: () => { st[side === 'left' ? 'lw' : 'rw'] = (side === 'left' ? LEFT : RIGHT).dflt; place(); save(); } });
  left.prepend(grip(left));
  left.append(...tabs.map((t) => t.body), edge(left, 'left'));
  right.prepend(grip(right));
  right.append(edge(right, 'right'));
  right.addEventListener('click', (e) => { if (right.classList.contains('peek') && !e.target.closest('button, input, select, a')) setProps(true); });
  // a phone: the map's foot and fitting keep above the sheet shown, its height as laid out (the peek's is its head's)
  const sized = new ResizeObserver(() => root.style.setProperty('--sheet-now', `${Math.max(...[left, right].map((e) => (e.hidden ? 0 : e.offsetHeight)))}px`));
  sized.observe(left);
  sized.observe(right);

  function drag(e, panel, what) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let down = false; // the sheet dragged most of the way down: closed when let go
    const move = (ev) => {
      if (what === 'sheet') {
        const v = ((panel.getBoundingClientRect().bottom - ev.clientY) / innerHeight) * 100; // from its foot (a phone's: the dock)
        if (panel === right && !st.props) { if (v < SHEET.min / 2) return; st.props = true; } // the peek dragged up: Properties on
        down = v < SHEET.min / 2; st.sh = clamp(v, SHEET);
      }
      else if (what === 'left') st.lw = clamp(ev.clientX - panel.getBoundingClientRect().left, LEFT);
      else st.rw = clamp(panel.getBoundingClientRect().right - ev.clientX, RIGHT);
      place();
    };
    const up = () => { // let go, or taken by the browser (a second finger, a system gesture)
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (down) { st.sh = SHEET.dflt; if (panel === left) setTab(null); else setProps(false); } else { place(); save(); }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // Both panels while the map keeps MIN_MAP px between them; else Properties, while shown, has the room
  // (the left comes back when it goes). A phone: one sheet at a time, the last asked for. The first
  // time the left makes way in a visit, a note says so.
  const yields = () => !!st.tab && left.hidden && !NARROW.matches;
  let told = false;
  function place() {
    const wantsRight = st.has && (st.props || NARROW.matches), both = !NARROW.matches && innerWidth - st.lw - st.rw >= MIN_MAP;
    const showLeft = !!st.tab && (both || !wantsRight || (NARROW.matches && !st.props)), showRight = wantsRight && !(NARROW.matches && showLeft);
    if (!told && !left.hidden && !showLeft && st.tab && !NARROW.matches) { told = true; note('No room for both panels: Elements and Layers make way for Properties until it closes (or narrow either)'); }
    left.hidden = !showLeft;
    right.hidden = !showRight;
    right.classList.toggle('peek', showRight && !st.props);
    for (const t of tabs) t.body.hidden = t.id !== st.tab;
    tabs.forEach((t, i) => tabBtns[i].setAttribute('aria-pressed', String(showLeft && t.id === st.tab)));
    left.setAttribute('aria-label', tabs.find((t) => t.id === st.tab)?.label ?? '');
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
  function toggleTab(id) {
    if (yields()) { setTab(id); setProps(false); } else setTab(st.tab === id ? null : id);
  }
  NARROW.addEventListener?.('change', place);
  addEventListener('resize', place);
  place();
  return {
    tabBtns, rightBtn,
    get tab() { return st.tab; },
    get props() { return st.props; },
    setTab, setProps,
    toggleTab, // its button or key: open there, or closed when it is
    has: (v) => { if (v !== st.has) { st.has = v; place(); } }, // Properties has something to show, or not
  };
}
