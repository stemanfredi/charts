// The PNG export: the map as on screen, without the controls; its details in the file's text fields.
// What it says comes from app.js snapshot(), read when the view was captured.
import { h } from './dom.js';
import { niceLen, NOTE_AT } from './format.js';
import { pngText } from './export.js';
import { CIRC } from './geo.js';

export const pngOf = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the browser returned no image'))), 'image/png'));

// The map as on screen without the controls, the same size: the credits bottom left (all of
// them: a picture cannot be tapped), the legends above them; bottom right, where it is (centre,
// zoom, projection, the data's time and depth) beside the scale; the north arrow top right. Where
// that leaves the credits too little room (a phone), they take the width, the rest above them.
// What it says comes from the snapshot s, and goes with it as the PNG's text fields.
export function chartCanvas(src, s) {
  const dpr = src.width / src.clientWidth, W = src.clientWidth, H = src.clientHeight;
  const out = h('canvas', { width: src.width, height: src.height });
  const g = out.getContext('2d');
  g.drawImage(src, 0, 0);
  g.scale(dpr, dpr);
  const INK = '#2b3a46', BACK = 'rgba(255,255,255,0.85)';
  const box = (x, y, w, hh) => { g.fillStyle = BACK; g.beginPath(); g.roundRect(x, y, w, hh, 4); g.fill(); };
  g.font = '11px system-ui, sans-serif';
  g.textBaseline = 'alphabetic';
  // double scale bar at the centre latitude (Web Mercator scale varies with latitude), bottom
  // right as on screen: km above a shared line, nautical miles below it
  const lat = s.lat;
  const mpp = (CIRC * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** s.zoom);
  const bar = (unitM) => { const len = niceLen((120 * mpp) / unitM) * unitM; return { len, px: len / mpp }; };
  const km = bar(1), nm = bar(1852);
  const v = s.scaleVariation;
  const kmText = `${km.len < 1000 ? `${+km.len.toPrecision(6)} m` : `${+(km.len / 1000).toPrecision(6)} km`} at ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}${v > NOTE_AT ? ` · scale varies ${(v * 100).toFixed(0)}% across the view` : ''}`;
  const nmText = `${+(nm.len / 1852).toPrecision(6)} NM`;
  const bw = Math.max(km.px, nm.px, g.measureText(kmText).width) + 20;
  // where it is, and when the data is
  const info = [s.at, `zoom ${s.zoom.toFixed(1)}`, 'Web Mercator', s.timeText, s.depthText].filter(Boolean).join(' · ');
  // a block of text on its backing, wrapped to width w, its bottom at y, from x (or to x, right):
  // its top
  const block = (text, colour, x, y, w, right = false) => {
    const lines = [];
    for (const item of text.split(' · ')) { // as many items to a line as fit, measured; an item stays whole
      const line = lines.length ? `${lines.at(-1)} · ${item}` : item;
      if (lines.length && g.measureText(line).width <= w - 12) lines[lines.length - 1] = line; else lines.push(item);
    }
    const hh = lines.length * 14 + 6, bw2 = Math.min(w, Math.max(...lines.map((t) => g.measureText(t).width)) + 12), x0 = right ? x - bw2 : x;
    box(x0, y - hh, bw2, hh);
    g.fillStyle = colour;
    lines.forEach((t, n) => g.fillText(t, x0 + 6, y - hh + 15 + n * 14, w - 12));
    return y - hh;
  };
  const infoW = g.measureText(info).width + 12, beside = W - 20 - bw - 12 - infoW - 8;
  let sb = H - 10, top; // the scale's bottom; the bottom of the legends' stack
  if (beside >= 200) { // one row: the credits, where it is, the scale
    top = block(s.credits, '#5d6d79', 10, H - 10, beside);
    block(info, INK, W - 10 - bw - 8, H - 10, infoW, true);
  } else { // a phone: the credits across the bottom, where it is above them (right), the scale above that
    sb = block(info, INK, W - 10, block(s.credits, '#5d6d79', 10, H - 10, W - 20) - 6, W - 20, true) - 6;
    top = sb - 48;
  }
  box(W - 10 - bw, sb - 48, bw, 48);
  g.strokeStyle = INK;
  g.lineWidth = 2;
  for (const [b, tick] of [[km, -6], [nm, 6]]) {
    const bx = W - 20 - b.px;
    g.beginPath(); g.moveTo(bx, sb - 24 + tick); g.lineTo(bx, sb - 24); g.lineTo(bx + b.px, sb - 24); g.lineTo(bx + b.px, sb - 24 + tick); g.stroke();
  }
  g.fillStyle = INK;
  g.textAlign = 'right';
  g.fillText(kmText, W - 20, sb - 34);
  g.fillText(nmText, W - 20, sb - 6);
  g.textAlign = 'left';
  // every legend of the drawn layers, stacked above (as on screen, even with the switch off)
  let ly = top - 6;
  for (const el of [...s.legends].reverse()) {
    const lw = parseFloat(el.style.width), lh = parseFloat(el.style.height);
    if (!lw || !lh) continue; // not drawn yet (a colour map still loading)
    ly -= lh;
    g.drawImage(el, 10, ly, lw, lh);
    ly -= 6;
  }
  // north arrow
  g.save();
  g.translate(W - 28, 34);
  g.rotate((-s.bearing * Math.PI) / 180);
  g.fillStyle = BACK; g.beginPath(); g.arc(0, 0, 18, 0, 2 * Math.PI); g.fill();
  g.fillStyle = INK; g.beginPath(); g.moveTo(0, -14); g.lineTo(6, 6); g.lineTo(0, 2); g.lineTo(-6, 6); g.closePath(); g.fill();
  g.font = 'bold 10px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('N', 0, 15);
  g.restore();
  out.fields = {
    Title: `Charts · ${s.at}`,
    Description: [`Centre ${s.at}`, `zoom ${s.zoom.toFixed(2)}`, `bearing ${Math.round(s.bearing)}°`, 'Web Mercator (EPSG:3857)', s.dataText, s.link].filter(Boolean).join(' · '),
    Copyright: s.credits,
    'Creation Time': s.when.toUTCString(),
    Software: 'Charts',
    Disclaimer: 'Not for navigation: positions, coastlines and depths come from open datasets of varying accuracy; depths are a coarse elevation model, not soundings.',
  };
  return out;
}
// the picture as a PNG, with the text fields chartCanvas wrote when it drew it
export async function chartPng(chart) {
  return new Blob([pngText(new Uint8Array(await (await pngOf(chart)).arrayBuffer()), chart.fields)], { type: 'image/png' });
}
