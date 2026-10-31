// The bar's file group (docs/drawing-ui.md §1, §10): Open (the drawings in this browser, the one open
// marked, each opened where it was drawn or deleted for good, asked first; + New; a file from the
// computer), Download (the drawing's GeoJSON, the view's outputs, the presets) and Copy link. Where the bar has no room for them (COMPACT: a phone, a tablet),
// Open's menu holds them all, and About. An imported file gets a report first.

import { h, COMPACT } from '../dom.js';
import { popup, dialog, ask, note } from '../menu.js';
import { parse } from './file.js';
import { elements, isMeasurement, mainOutline } from './document.js';
import { presetsFile, readPresets, savePresets } from './presets.js';
import { plural, slug } from '../format.js';
import { icon, UI_ICON } from '../icons.js';

// drawing (drawing.js); ctx: { download(text, name), openDrawing(id), onImport(doc, view), openArea(file) (an offline area's zip),
// outputs (the view's, menu items), offlineItem (Offline areas…, a menu item), copyLink(), about() }; presetsChanged(): the tools' kinds shown again. Returns { buttons (the bar's),
// importFile(file) }.
export function fileGroup(drawing, ctx, presetsChanged) {
  const fileInput = h('input', { type: 'file', accept: '.geojson,.json,.zip,application/geo+json,application/json,application/zip', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); } });
  // the file: the drawing (its measurements too) and the view, as GeoJSON
  function exportFile() {
    const text = drawing.text();
    const when = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const title = slug(drawing.doc.meta.title) || 'chart';
    ctx.download(text, `${title}-${when}.geojson`);
  }
  // one menu, opened from Open or from Download, with what that button holds
  const menuEl = h('div', { class: 'dmenu', role: 'menu', hidden: true });
  document.body.append(menuEl, fileInput);
  const menu = popup(menuEl, { choose: false, // open while an output is prepared (it says how it went in the note)
    place: (b) => { const r = b.getBoundingClientRect(); Object.assign(menuEl.style, { top: `${r.bottom + 4}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - 360))}px` }); },
  });
  const close = () => menu.close();
  menuEl.addEventListener('click', (e) => { if (e.target.closest('[data-closes]')) close(); }); // an output that opens a dialog of its own
  const item = (text, title, run, paths = null) => h('button', { type: 'button', role: 'menuitem', title, onclick: () => { close(); run(); } }, paths && icon(...paths), h('span', {}, text));
  const sep = () => h('div', { class: 'dsep' });
  // Open: the drawings in this browser, + New, a file from the computer
  function openItems() {
    const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
    const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const del = async (x) => {
      close();
      if (!await ask('Delete the drawing', `Delete “${x.title || 'Untitled'}” for good? It cannot be brought back.`, [['yes', 'Delete']])) return;
      drawing.saving.remove(x.id);
    };
    return [h('button', { type: 'button', role: 'menuitem', class: 'dnew', title: 'A new, empty drawing (this one stays in the list)', onclick: () => { close(); newDrawing(); } }, '+ New drawing'),
      h('ul', { class: 'drawings' }, drawing.saving.list().map((x) => h('li', { class: x.open ? 'open' : '' },
        h('button', { type: 'button', role: 'menuitem', class: 'dname', 'aria-current': x.open ? 'true' : null, title: x.open ? 'The drawing open' : 'Open it, where it was drawn',
          onclick: () => { close(); if (!x.open) ctx.openDrawing(x.id); } }, x.title || 'Untitled'),
        h('span', { class: 'val' }, [when(x.modified), x.size ? kb(x.size) : ''].filter(Boolean).join(' · ')),
        h('button', { type: 'button', class: 'hact del', 'aria-label': `Delete ${x.title || 'Untitled'}`, title: 'Delete for good', onclick: () => del(x) }, icon(...UI_ICON.delete))))),
      sep(),
      // a file dropped on the map is opened too
      item('Open a file…', 'A drawing\'s file, any GeoJSON, a presets file or an offline area: a drawing is added to these and opened; presets join the Point and Shape tools; an area to the offline areas', () => fileInput.click(), UI_ICON.open)];
  }
  // Download: the drawing, the view's outputs, the presets; apart, the offline areas
  const downloadItems = () => [item('Drawing (GeoJSON)', 'This drawing, with the view and layers, as a GeoJSON file to share or keep', exportFile, UI_ICON.file), sep(), ...ctx.outputs,
    item('Presets (JSON)', 'Your presets (the Point and Shape tools\' own) as a small file, to import them in another browser', () => ctx.download(presetsFile(drawing.presets), 'presets.json'), UI_ICON.file), sep(), ctx.offlineItem];
  function toggle(b, items) {
    if (!menuEl.hidden && b.getAttribute('aria-expanded') === 'true') return close();
    menuEl.setAttribute('aria-label', b.getAttribute('aria-label'));
    menuEl.replaceChildren(...items());
    menu.open(b, true);
  }
  // the bar's buttons: Open (COMPACT: ☰, everything), Download, Copy link
  const barBtn = (cls, label, paths, onclick, more = {}) => h('button', { type: 'button', class: cls, 'aria-label': label, title: label, onclick, ...more }, icon(...paths));
  const openBtn = barBtn('filebtn', 'Open', UI_ICON.open, () => toggle(openBtn, () => (COMPACT.matches
    ? [...openItems(), sep(), ...downloadItems(), sep(), item('Copy link', 'Copy a link to this exact view', ctx.copyLink, UI_ICON.link), item('About', 'About this chart', ctx.about, UI_ICON.info)]
    : openItems())), { 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  openBtn.append(icon(...UI_ICON.menu)); // COMPACT's: ☰ (style.css shows one of the two)
  const downloadBtn = barBtn('dlbtn', 'Download', UI_ICON.download, () => toggle(downloadBtn, downloadItems), { 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  const linkBtn = barBtn('cplbtn', 'Copy link', UI_ICON.link, () => ctx.copyLink());
  function newDrawing() {
    drawing.saving.add();
  }
  async function importFile(f) {
    // a zip (its first bytes PK\x03\x04): an offline area's, to the offline areas, whatever its size
    const head = await f.slice(0, 4).arrayBuffer().then((b) => new Uint8Array(b), () => []);
    if (String.fromCharCode(...head) === 'PK\x03\x04') return ctx.openArea(f);
    if (f.size > 64e6) return note('The file is larger than 64 MB: not read'); // read whole before anything is checked: a mistaken drop would stall the page
    let text;
    try { text = await f.text(); } catch (e) { return note(`The file could not be read: ${e.message}`); }
    const presets = readPresets(text);
    // a file of presets: added to the user's (one of the same name replaced)
    if (presets) {
      const names = new Set(presets.map((x) => x.name));
      drawing.presets = [...drawing.presets.filter((x) => !names.has(x.name)), ...presets];
      savePresets(drawing.presets);
      return presetsChanged();
    }
    const { doc, view, report } = parse(text, drawing.known);
    const list = (items) => h('ul', {}, items.map((t) => h('li', {}, t)));
    const counts = doc ? [['point', doc.points.filter((x) => !mainOutline(x))], ['shape', doc.points.filter((x) => mainOutline(x))], ['line', doc.lines], ['area', doc.areas], ['label', doc.labels], ['group', doc.groups]]
      .map(([k, xs]) => [k, xs.filter((x) => !isMeasurement(doc, x)).length]).filter(([, n]) => n).map(([k, n]) => plural(n, k)) : [];
    const measured = doc ? elements(doc).filter((x) => isMeasurement(doc, x.el)).length : 0;
    if (measured) counts.push(plural(measured, 'measurement'));
    const body = () => h('div', {},
      doc ? h('p', {}, counts.length ? `It holds ${counts.join(', ')}.` : 'It holds no elements.', view ? ' Its view and layers will replace the current ones.' : '') : h('p', {}, report.refused),
      report.skipped.length ? [h('h3', {}, `Skipped (${report.skipped.length})`), list(report.skipped.map((s) => `${s.kind}${s.id ? ` ${s.id}` : ''}: ${s.reason}`))] : null,
      report.warnings.length ? [h('h3', {}, `Warnings (${report.warnings.length})`), list(report.warnings)] : null);
    const go = await dialog(doc ? `Import ${f.name}` : 'Not imported', body, doc ? [[true, 'Import']] : [], doc ? 'Cancel' : 'Close',
      doc ? h('p', { class: 'note' }, 'It is added to the drawings in this browser and opened; this one stays in the list.') : null);
    if (go) ctx.onImport(doc, view);
  }
  return { buttons: [openBtn, downloadBtn, linkBtn], importFile };
}
