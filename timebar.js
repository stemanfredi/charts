// The map's time: one hour for every layer that changes with time (Copernicus Marine, NASA
// daily), on a bar along the bottom of the map. Its track spans days around now, marks now and
// the hour shown, and draws for each such layer on where it has data, so what a layer shows at
// that hour (forecast, latest observation, nothing) can be read off the bar.

const HOUR = 36e5, DAY = 864e5, SPAN = 17; // days on the track
export const floorHour = (t) => Math.floor(t / HOUR) * HOUR;
const floorDay = (t) => Math.floor(t / DAY) * DAY;

// days on the track: a week back and ten days ahead of now (forecasts reach about nine), or the
// same around the hour shown when that is outside them (a date picked in the calendar)
export function timeWindow(t, now) {
  const today = floorDay(now), inView = t >= today - 7 * DAY && t < today + 10 * DAY;
  const start = floorDay(inView ? now : t) - 7 * DAY;
  return { start, end: start + SPAN * DAY };
}

// a span [from, to] (ms) as left/width percentages of the window, or null if it is outside
export function spanPct([from, to], { start, end }) {
  const a = Math.max(from, start), b = Math.min(to, end);
  if (b <= a) return null;
  return [((a - start) / (end - start)) * 100, ((b - a) / (end - start)) * 100];
}

const el = (tag, cls, ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
};
const fmtWhen = (t) => { const d = new Date(t); return `${d.toUTCString().slice(0, 11)} · ${d.toISOString().slice(11, 16)} UTC`; };
function fmtRel(t, now) {
  const h = Math.round((t - floorHour(now)) / HOUR), a = Math.abs(h), n = a >= 48 ? `${Math.round(a / 24)} days` : `${a} h`;
  return !h ? 'now' : h > 0 ? `in ${n}` : `${n} ago`;
}
// local time beside UTC, unless they are the same
function fmtLocal(t) {
  const d = new Date(t);
  if (!d.getTimezoneOffset()) return '';
  return `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} local`;
}

// root: the bar's element; onChange(t): an hour picked (ms, on the hour). Returns render, and
// slot: a place in the bar's top line for other settings of the whole map (the depth)
export function timeBar(root, onChange) {
  const button = (cls, text, label, fn) => {
    const b = el('button', cls, text);
    b.type = 'button';
    if (label) { b.title = label; b.setAttribute('aria-label', label); }
    b.addEventListener('click', fn);
    return b;
  };
  const when = el('span', 'tb-when'), rel = el('span', 'tb-rel'), local = el('span', 'tb-local');
  const cal = el('input', 'tb-cal');
  cal.type = 'date';
  cal.setAttribute('aria-label', 'Day');
  cal.title = 'Go to a day (the hour stays)';
  cal.addEventListener('change', () => cal.value && onChange(Date.parse(`${cal.value}T00:00:00Z`) + (shown.time % DAY)));
  const head = el('div', 'tb-head',
    button('tb-step', '‹', 'Previous hour (←)', () => onChange(shown.time - HOUR)),
    el('span', 'tb-label', when, local, rel),
    button('tb-step', '›', 'Next hour (→)', () => onChange(shown.time + HOUR)),
    el('span', 'tb-slot'),
    cal,
    button('tb-now', 'Now', 'The current hour (Home)', () => onChange(floorHour(Date.now()))));
  const days = el('div', 'tb-days'), rows = el('div', 'tb-rows');
  const nowMark = el('div', 'tb-nowmark'), cursor = el('div', 'tb-cursor');
  const track = el('div', 'tb-track', days, rows, nowMark, cursor);
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', 'Time shown, UTC');
  root.append(head, track);

  let shown = { time: floorHour(Date.now()), rows: [] }, win = timeWindow(shown.time, Date.now());
  const pct = (t) => ((t - win.start) / (win.end - win.start)) * 100;
  // the hour under a pointer on the track (the rows' labels sit left of the days, on wide screens)
  const timeAt = (e) => {
    const r = days.getBoundingClientRect();
    return win.start + Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * SPAN * 24) * HOUR;
  };

  // the hour shown (or being dragged to): label, cursor, slider value
  function label(t) {
    when.textContent = fmtWhen(t);
    local.textContent = fmtLocal(t);
    rel.textContent = fmtRel(t, Date.now());
    cursor.style.left = `${pct(t)}%`;
    cursor.hidden = t < win.start || t >= win.end;
    track.setAttribute('aria-valuenow', String(t));
    track.setAttribute('aria-valuetext', `${fmtWhen(t)}, ${fmtRel(t, Date.now())}`);
  }
  function drawDays() {
    // a label every k days, so they never touch (narrow screens)
    const w = days.getBoundingClientRect().width || 600, k = Math.max(1, Math.ceil(46 / (w / SPAN)));
    const today = floorDay(Date.now());
    days.replaceChildren(...Array.from({ length: SPAN }, (_, i) => {
      const t = win.start + i * DAY, d = new Date(t);
      const c = el('div', `tb-day${t === today ? ' today' : ''}`, i % k ? '' : `${d.toUTCString().slice(0, 3)} ${d.getUTCDate()}`);
      c.style.left = `${(i / SPAN) * 100}%`;
      c.style.width = `${100 / SPAN}%`;
      return c;
    }));
    nowMark.style.left = `${pct(Date.now())}%`;
    track.setAttribute('aria-valuemin', String(win.start));
    track.setAttribute('aria-valuemax', String(win.end - HOUR));
  }

  // time: the hour shown; rows: [{ label, spans: [[from, to]], title }] for each time layer on
  function render(time, rowsData) {
    shown = { time, rows: rowsData };
    win = timeWindow(time, Date.now());
    cal.value = new Date(time).toISOString().slice(0, 10);
    drawDays();
    rows.replaceChildren(...rowsData.map((r) => {
      const bar = el('div', 'tb-bar', ...r.spans.map((s) => spanPct(s, win)).filter(Boolean).map(([l, w]) => {
        const i = el('i');
        i.style.left = `${l}%`;
        i.style.width = `${w}%`;
        return i;
      }));
      const row = el('div', 'tb-row', el('span', 'tb-name', r.label), bar);
      row.title = r.title || '';
      return row;
    }));
    label(time);
  }

  // drag or click on the track: the label follows, the map changes once on release
  let dragging = false;
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); label(timeAt(e)); });
  track.addEventListener('pointermove', (e) => { if (dragging) label(timeAt(e)); });
  track.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; onChange(timeAt(e)); });
  track.addEventListener('pointercancel', () => { dragging = false; label(shown.time); });
  track.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -HOUR, ArrowRight: HOUR, ArrowDown: -HOUR, ArrowUp: HOUR, PageDown: -DAY, PageUp: DAY }[e.key];
    if (step) { e.preventDefault(); onChange(shown.time + step); } else if (e.key === 'Home') { e.preventDefault(); onChange(floorHour(Date.now())); }
  });
  new ResizeObserver(() => drawDays()).observe(days);
  return { render, slot: head.querySelector('.tb-slot') };
}
