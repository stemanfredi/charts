// The Tools panel's list row: one per element (shown or not, its kind, its name, a short value,
// delete), selected by a click (Ctrl/⌘-click adds or removes it), outlined on the map while the pointer
// is over it.

import { h } from './dom.js';
import { MOD } from './keys.js';

// icon(...paths): an SVG icon; kindIcon: its paths; title: the kind's name. on: { select(event),
// hover(id or null), visible(shown), remove() }; more: the row's own extras { classes, fold (a node
// after its box: a group's arrow, so that every box sits on its level), name (attributes of the
// name's button) }
export function elementRow({ id, icon, kindIcon, title, name, value = '', visible, selected }, on, more = {}) {
  return h('li', { class: `drow${selected ? ' sel' : ''}${visible ? '' : ' dim'}${more.classes ? ` ${more.classes}` : ''}`, 'data-id': id,
    onpointerenter: () => on.hover(id), onpointerleave: () => on.hover(null) },
  h('label', { class: 'dvis', title: 'Show on the map' }, h('input', { type: 'checkbox', checked: visible, 'aria-label': `Show ${name}`, onchange: (e) => on.visible(e.target.checked) })),
  more.fold || null,
  h('span', { class: 'kind', title }, icon(...kindIcon)),
  h('button', { type: 'button', class: 'dname', title: `Select (${MOD}: add or remove)`, onclick: (e) => on.select(e), ...more.name }, name),
  h('span', { class: 'val' }, value),
  h('button', { type: 'button', class: 'x', 'aria-label': `Delete ${name}`, title: 'Delete', onclick: () => on.remove() }, '×'));
}
