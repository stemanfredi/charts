// A pop-up opened from a button (the Export menu, the drawings menu, the time's box): Esc or a
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
