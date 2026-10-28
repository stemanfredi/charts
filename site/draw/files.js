// The drawings menu (the bar's ☰, docs/drawing-ui.md §10): the drawings in this browser (the one open
// marked; each opened where it was drawn, or deleted for good, asked first), + New, the file in and out
// (a drawing's GeoJSON, the presets'), then ctx.menuExtras (the view's outputs, About). An imported
// file gets a report first.

import { h } from '../dom.js';
import { popup, dialog, ask, note } from '../menu.js';
import { parse } from './file.js';
import { elements, isMeasurement, mainOutline } from './document.js';
import { presetsFile, readPresets, savePresets } from './presets.js';
import { plural } from '../format.js';

// drawing (drawing.js); ctx: { download(text, name), openDrawing(id), onImport(doc, report), known,
// menuExtras(close) }; deleteIcon: the bin's svg, made anew for each row; presetsChanged(): the
// tools' kinds shown again. Returns { toggle(button), importFile(file) }.
export function drawingsMenu(drawing, ctx, deleteIcon, presetsChanged) {
  const fileInput = h('input', { type: 'file', accept: '.geojson,.json,application/geo+json,application/json', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); } });
  // the file: the drawing (its measurements too) and the view, as GeoJSON
  function exportFile() {
    const text = drawing.text();
    const when = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const title = drawing.doc.meta.title.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'chart';
    ctx.download(text, `${title}-${when}.geojson`);
  }
  const menuEl = h('div', { class: 'dmenu', role: 'menu', 'aria-label': 'Drawings in this browser', hidden: true });
  document.body.append(menuEl, fileInput);
  const drawings = popup(menuEl, { choose: false, // the view's outputs say how they went in it, open meanwhile
    place: (b) => { const r = b.getBoundingClientRect(); Object.assign(menuEl.style, { top: `${r.bottom + 4}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - 360))}px` }); },
  });
  const toggleDrawings = (b) => (menuEl.hidden ? openDrawingsMenu(b) : drawings.close());
  const closeDrawingsMenu = () => drawings.close();
  function openDrawingsMenu(from) {
    const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
    const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const del = async (x) => {
      closeDrawingsMenu();
      if (!await ask('Delete the drawing', `Delete “${x.title || 'Untitled'}” for good? It cannot be brought back.`, [['yes', 'Delete']])) return;
      drawing.saving.remove(x.id);
      note('Drawing deleted');
    };
    const pick = (run) => () => { closeDrawingsMenu(); run(); };
    menuEl.replaceChildren(h('ul', { class: 'drawings' }, drawing.saving.list().map((x) => h('li', { class: x.open ? 'open' : '' },
      h('button', { type: 'button', role: 'menuitem', class: 'dname', 'aria-current': x.open ? 'true' : null, title: x.open ? 'The drawing open' : 'Open it, where it was drawn',
        onclick: pick(() => { if (!x.open) ctx.openDrawing(x.id); }) }, x.title || 'Untitled'),
      h('span', { class: 'val' }, [when(x.modified), x.size ? kb(x.size) : ''].filter(Boolean).join(' · ')),
      h('button', { type: 'button', class: 'hact', 'aria-label': `Delete ${x.title || 'Untitled'}`, title: 'Delete for good', onclick: () => del(x) }, deleteIcon())))),
    h('button', { type: 'button', role: 'menuitem', class: 'dnew', title: 'A new, empty drawing (this one stays in the list)', onclick: pick(newDrawing) }, '+ New drawing'),
    // the drawing's file, and the presets': in and out (a file dropped on the map is imported too)
    h('div', { class: 'dfile' },
      h('button', { type: 'button', role: 'menuitem', title: 'A drawing\'s file, any GeoJSON, or a presets file: a drawing is added to these and opened; presets join the Point and Shape tools', onclick: pick(() => fileInput.click()) }, 'Import…'),
      h('button', { type: 'button', role: 'menuitem', title: 'This drawing, with the view and layers, as a GeoJSON file to share or keep', onclick: pick(exportFile) }, 'Export drawing (GeoJSON)'),
      h('button', { type: 'button', role: 'menuitem', title: 'Your presets (the Point and Shape tools\' own) as a small file, to import them in another browser', onclick: pick(() => ctx.download(presetsFile(drawing.presets), 'presets.json')) }, 'Export presets (JSON)')),
    ...ctx.menuExtras(closeDrawingsMenu)); // the view's outputs and About
    drawings.open(from, true);
  }
  function newDrawing() {
    drawing.saving.add();
    note('New drawing');
  }
  async function importFile(f) {
    let text;
    try { text = await f.text(); } catch (e) { return note(`The file could not be read: ${e.message}`); }
    const presets = readPresets(text);
    // a file of presets: added to the user's (one of the same name replaced)
    if (presets) {
      const names = new Set(presets.map((x) => x.name));
      drawing.presets = [...drawing.presets.filter((x) => !names.has(x.name)), ...presets];
      savePresets(drawing.presets);
      presetsChanged();
      return note(`${plural(presets.length, 'preset')} added to the Point and Shape tools`);
    }
    const { doc, report } = parse(text, ctx.known);
    const list = (items) => h('ul', {}, items.map((t) => h('li', {}, t)));
    const counts = doc ? [['point', doc.points.filter((x) => !mainOutline(x))], ['shape', doc.points.filter((x) => mainOutline(x))], ['line', doc.lines], ['area', doc.areas], ['label', doc.labels], ['group', doc.groups]]
      .map(([k, xs]) => [k, xs.filter((x) => !isMeasurement(doc, x)).length]).filter(([, n]) => n).map(([k, n]) => plural(n, k)) : [];
    const measured = doc ? elements(doc).filter((x) => isMeasurement(doc, x.el)).length : 0;
    if (measured) counts.push(plural(measured, 'measurement'));
    const body = () => h('div', {},
      doc ? h('p', {}, counts.length ? `It holds ${counts.join(', ')}.` : 'It holds no elements.', doc.view ? ' Its view and layers will replace the current ones.' : '') : h('p', {}, report.refused),
      report.skipped.length ? [h('h3', {}, `Skipped (${report.skipped.length})`), list(report.skipped.map((s) => `${s.kind}${s.id ? ` ${s.id}` : ''}: ${s.reason}`))] : null,
      report.warnings.length ? [h('h3', {}, `Warnings (${report.warnings.length})`), list(report.warnings)] : null);
    const go = await dialog(doc ? `Import ${f.name}` : 'Not imported', body, doc ? [[true, 'Import']] : [], doc ? 'Cancel' : 'Close',
      doc ? h('p', { class: 'note' }, 'It is added to the drawings in this browser and opened; this one stays in the list.') : null);
    if (go) ctx.onImport(doc, report);
  }
  return { toggle: toggleDrawings, importFile };
}
