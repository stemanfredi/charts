// A menu beside a rail button (Export): the button opens and closes it; a choice, Esc or a click
// elsewhere closes it; ↑ ↓ move between its items (from the keyboard, focus starts on the first).

export function railMenu(button, menu) {
  const items = () => [...menu.querySelectorAll('[role=menuitem]')];
  const set = (open, focus = false) => {
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    menu.style.top = `${button.offsetTop}px`; // level with its button
    if (focus) items()[0]?.focus();
  };
  button.addEventListener('click', (e) => set(menu.hidden, e.detail === 0));
  menu.addEventListener('click', (e) => { if (e.target.closest('[role=menuitem]')) set(false); });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !button.contains(e.target)) set(false); });
  // Esc, wherever the focus is (on the button after a click), closes it before anything else hears it
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); set(false); button.focus(); } }, true);
  menu.addEventListener('keydown', (e) => {
    const its = items(), i = its.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); its[(i + (e.key === 'ArrowDown' ? 1 : -1) + its.length) % its.length].focus(); }
  });
}
