// Search: coordinates are read here; place names go to Photon (OpenStreetMap data). search(map,
// Marker) wires the page's search box (#q) and its results; it returns the box.
import { $, h } from './dom.js';
import { dm, parseLatLon } from './format.js';
import { FETCH } from './net.js';
import { HOSTS } from './hosts.js';

const PHOTON = `${HOSTS.photon}/api/`;
// what a sea chart is mostly searched for comes first: places, the coast and the sea (capes, bays,
// straits, beaches, harbours), marinas, ferry terminals, lighthouses, piers; then the rest (streets,
// hotels, cafés…), in Photon's order. Nothing is left out.
const SEA_TAGS = ['place', 'natural', 'water', 'waterway', 'leisure:marina', 'leisure:slipway', 'amenity:ferry_terminal',
  'man_made:lighthouse', 'man_made:pier', 'man_made:breakwater', 'landuse:harbour', 'landuse:port'];
// what a result is, in a word: a road of any class is a street; "yes" (a building, an office) says its key
const resultKind = (p) => (p.osm_key === 'highway' ? 'street' : (p.osm_value === 'yes' ? p.osm_key : p.osm_value || '').replace(/_/g, ' '));
const seaFirst = ({ properties: p }) => (SEA_TAGS.some((t) => t === p.osm_key || t === `${p.osm_key}:${p.osm_value}`) ? 0 : 1);
const ZOOM_OF = { city: 11, town: 12, village: 13, hamlet: 14, island: 11, sea: 6, ocean: 4, bay: 10, strait: 9 };

export function search(map, Marker) {
  const q = $('#q'), qClear = $('#q-clear'), results = $('#results'), resultList = results.querySelector('ul');
  let hits = [], active = -1, searchCtl = null, searchTimer = 0, pin = null;
  function showResults(list) {
    hits = list;
    active = list.length && list[0].go ? 0 : -1;
    resultList.replaceChildren(...(list.length ? list.map((r, i) => h('li', { role: 'option', id: `r-${i}`, 'aria-selected': String(i === active),
      onpointerdown: (e) => e.preventDefault(), // keep the focus in the box
      onclick: () => choose(i) }, r.name, r.where ? h('small', {}, r.where) : null))
      : [h('li', { class: 'none' }, 'No places found')]));
    results.hidden = false;
    q.setAttribute('aria-expanded', 'true');
    q.setAttribute('aria-activedescendant', active >= 0 ? `r-${active}` : '');
  }
  function hideResults() {
    results.hidden = true;
    q.setAttribute('aria-expanded', 'false');
    q.removeAttribute('aria-activedescendant');
  }
  function setActive(i) {
    if (!hits.length) return;
    active = (i + hits.length) % hits.length;
    for (const [k, li] of [...resultList.children].entries()) li.setAttribute('aria-selected', String(k === active));
    q.setAttribute('aria-activedescendant', `r-${active}`);
    resultList.children[active]?.scrollIntoView({ block: 'nearest' });
  }
  function choose(i) {
    const r = hits[i];
    if (!r) return;
    hideResults();
    pin?.remove();
    pin = new Marker({ element: h('div', { class: 'pin', title: r.name }) }).setLngLat(r.at).addTo(map);
    if (r.bounds) map.fitBounds(r.bounds, { padding: 60, maxZoom: 15, bearing: map.getBearing() });
    else map.flyTo({ center: r.at, zoom: Math.max(map.getZoom(), r.zoom) });
    q.blur();
  }
  async function searchPlaces(text) {
    searchCtl?.abort();
    searchCtl = new AbortController();
    const c = map.getCenter(); // results near the view come first; rounded, the view is not sent exactly
    const url = `${PHOTON}?${new URLSearchParams({ q: text, limit: 12, lang: 'en', lat: c.lat.toFixed(1), lon: c.lng.toFixed(1) })}`;
    try {
      const r = await fetch(url, { signal: searchCtl.signal, ...FETCH });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // the same name, kind and town once (a port's ferry terminals); the sea's first, seven shown
      const seen = new Set();
      const features = (await r.json()).features
        .filter(({ properties: p }) => { const k = `${(p.name || '').toLowerCase()}|${resultKind(p)}|${p.city}`; return !seen.has(k) && seen.add(k); })
        .sort((a, b) => seaFirst(a) - seaFirst(b)).slice(0, 7);
      showResults(features.map((f) => {
        const p = f.properties, e = p.extent; // [west, north, east, south]
        return { go: true, name: p.name || p.street || text, at: f.geometry.coordinates,
          where: [resultKind(p), p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean).join(' · '),
          bounds: e ? [[e[0], e[3]], [e[2], e[1]]] : null, zoom: ZOOM_OF[p.osm_value] || 14 };
      }));
    } catch (err) {
      if (err.name !== 'AbortError') showResults([{ name: 'Place search is not available right now', where: err.message }]);
    }
  }
  q.addEventListener('input', () => {
    const text = q.value.trim();
    qClear.hidden = !text;
    clearTimeout(searchTimer);
    if (!text) { searchCtl?.abort(); hideResults(); return; }
    const ll = parseLatLon(text);
    if (ll) { // coordinates: nothing leaves the page
      searchCtl?.abort();
      showResults([{ go: true, name: `${dm(ll.lat, 'N', 'S')}  ${dm(ll.lon, 'E', 'W')}`, where: 'coordinates', at: [ll.lon, ll.lat], zoom: 11 }]);
    } else if (text.length >= 3) searchTimer = setTimeout(() => searchPlaces(text), 300);
    else hideResults();
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hits[active]?.go) choose(active); }
    else if (e.key === 'Escape') { if (!results.hidden) hideResults(); else { q.value = ''; qClear.hidden = true; pin?.remove(); pin = null; q.blur(); } }
  });
  q.addEventListener('focus', () => { if (q.value.trim() && hits.length) showResults(hits); });
  q.addEventListener('blur', () => setTimeout(hideResults, 150));
  qClear.addEventListener('click', () => { q.value = ''; qClear.hidden = true; hideResults(); pin?.remove(); pin = null; q.focus(); });
  return q;
}
