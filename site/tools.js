// The keys of what is being drawn (draw/drawing.js Drawing, the one owner of the tools): Enter
// finishes, Backspace takes back a point, Esc steps back, the map's double-click finishes and its
// right-click steps back one level (what is half-drawn is dropped, else the tool ends, else idle()
// runs: the selection cleared). What is drawn says the rest on the map (its values).
//
// The owner: { tool (its tool on, or null), finish(), undoPoint(), escape(), finishesOnDoubleClick() }.

export class Toolbox {
  constructor(map, idle = () => {}) {
    // a right click, not a right drag (which rotates the map)
    let right = null;
    map.on('mousedown', (e) => { if (e.originalEvent.button === 2) right = e.point; });
    map.on('contextmenu', (e) => {
      if (!right || Math.hypot(e.point.x - right.x, e.point.y - right.y) > 3) return;
      const o = this.active();
      if (o) o.owner.escape(); else idle();
    });
    // the keys of a tool on, not while typing (a field's own Enter, Backspace and Esc); Enter on a
    // focused button is that button's own click
    window.addEventListener('keydown', (e) => {
      const o = this.active();
      if (!o || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, select, textarea') || document.querySelector('dialog[open]')) return;
      if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); o.owner.finish(); }
      else if (e.key === 'Backspace') { e.preventDefault(); o.owner.undoPoint(); }
      else if (e.key === 'Escape') { e.stopImmediatePropagation(); o.owner.escape(); } // not also the panel's (clearing the selection)
    });
    map.on('dblclick', (e) => { const o = this.active(); if (o?.owner.finishesOnDoubleClick?.()) { e.preventDefault(); o.owner.finish(); } });
  }
  // the owner of the tools
  add(owner) { this.owner = { owner }; }
  active() { return this.owner?.owner.tool ? this.owner : null; }
}
