# Development

For whoever changes the code or hosts a copy. What the page is and why it is
shaped as it is: [the README](../README.md) and [architecture.md](architecture.md).

## Working on it

Requirements: the Node.js version in `.nvmrc`; a local Chrome or Chromium for
the browser tests. The page itself needs no build: `site/` is what is served.

```sh
npm ci              # development dependencies (test tooling only)
npm run serve       # http://127.0.0.1:8000, site/ only, caching off (--host 0.0.0.0 for a phone)
npm test            # unit tests, offline (they also check site/vendor/ and the security policy)
npm run lint        # ESLint's recommended rules
npm run smoke       # end-to-end in headless Chrome, against the live providers
npm run draw        # the drawing tools in headless Chrome, the network blocked
npm run ui          # layout at phone, tablet and desktop widths
npm run tiles-check # elevation tiles of known trouble spots: seams, zooms, lakes
npm run perf        # how long the depth layers take to draw
npm run data-check  # newer density data periods (newer libraries: npm outdated)
npm run vendor      # site/vendor/, the security policy and sw.js's lists written anew
```

The browser tests use `/usr/bin/google-chrome` by default; set
`CHROME=/path/to/chrome` for another binary. They serve the site on port 8099,
which the project's data host allows cross-origin reads from.

The smoke test depends on the network by design, because the page depends on
the providers. A failure can mean that a provider changed or went down, not
only that the code broke. Checks of what a provider served are therefore
*advisory*: they warn, and only the weekly run (`STRICT=1`) fails on them.

Some functions are exported only for the unit tests. The reasons behind a
rule in the code are in a comment next to it, not here.

## Tests, briefly

- **Unit** (`test/unit/`): the drawing model and file, geodesy, the readers and
  writers (Zarr, GeoTIFF, zip, PNG), the catalogue's consistency, the vendored
  libraries and the security policy against `package.json` and `site/hosts.js`.
- **Smoke** (`test/smoke.mjs`): the page in a browser, in sections that fail
  on their own: layers, time, search, exports compared with the map, the
  elevation profile, the service worker and offline areas.
- **Drawing** (`test/draw.mjs`): the drawing tools, files and inspector, a
  phone with a finger; every request but the site's own aborted, so a
  provider's bad day cannot fail it.
- **Layout** (`test/ui.mjs`): no overlaps and 44 px targets at three widths.
- **Tiles** (`test/tiles-check.mjs`): the elevation tiles of places that once
  went wrong, weekly, against live data.
- `test/browser.mjs` is what the browser tests share: the site served, Chrome,
  the checks and the sections.

## Dependencies

MapLibre GL JS, maplibre-contour, GeographicLib and polygon-clipping are the
page's own files in `site/vendor/`, copied from npm at the versions in
`package.json`, with their licences, by `npm run vendor`. No CDN
is involved. polygon-clipping loads only on the first GIS export.

To upgrade one: change its version in `package.json`, run `npm install` and
`npm run vendor` (until then a unit test says `site/vendor/` is
out of date), and test the page.

## The service worker

`site/sw.js` keeps the page's own files, so that the page opens without a
connection, and answers the saved hosts (`OFFLINE` in `site/hosts.js`, never
Esri's) from the finished offline areas (`pack-…` caches with their
`pack.json`); it stores nothing of them: the page saving an area fetches into
its cache itself (`site/offline.js`, `fetchInto` in `site/net.js`). Its lists
of files and hosts are written by `npm run vendor`, its version by
the deploy; `dev`, on a development copy, is network first. The details are
in its comments.

## Continuous integration and deploy

`.github/workflows/ci.yml` runs the unit, lint, smoke, drawing and layout
tests on pushes to `main` and on pull requests, and deploys `main` to GitHub Pages when
they pass; only `site/` is published, with the commit written into the page
as its version and into `site/sw.js`. A provider's outage shows as warnings on a push and does not
hold up a deploy; the weekly run is strict, so an outage that lasts a week is
a failed run, mailed. The weekly run also lists newer library versions and
reports newer density data. Pages must be enabled once in the repository
settings, with *Source: GitHub Actions*.

## Hosting a copy

Any static web server can serve `site/`. Two things are the project's own and
need replacing in a copy:

- **The data host.** GEBCO's depths and the seagrass tiles are read from the
  host named in `site/hosts.js`; a copy changes that one line. The host must be
  a static file server (any object storage with a public bucket does) serving
  the folders the two tools build, `gebco-2026/` (two Zarr stores: small
  files, fetched whole, no range requests) and `seagrass-2025/`
  (`{z}/{x}/{y}.pbf` and `index.json`), over HTTPS, with cross-origin reads
  allowed from the page's origin and, for the browser tests, from
  `http://127.0.0.1:8099`. The page reads every file as bytes itself, so
  content types are not needed, and the files are stored as they are. The
  release is in each path, so the files can be cached as immutable. Nothing
  else: no listing, no function, no key. The storage used here is one of many
  possible; its details change often and are not documented here.
- **The data builds.** `tools/gebco.mjs` downloads GEBCO's grids and builds
  the two Zarr stores (and verifies them); `tools/seagrass.mjs` builds the
  seagrass tiles from EMODnet's service, which takes a minute or more per
  tile. Both say how to run them at their top.

The security policy in `site/index.html` is generated from `site/hosts.js`, and the
module preloads beside it from the imports of `site/app.js`,
so a copy that adds a host adds it there and runs `npm run vendor`.

## Providers

The map data and imagery are not part of this repository. The browser fetches
them from each provider, and each layer stays under its provider's licence.
The page is the reference for coverage, resolution and periods (each layer's
ⓘ); they are defined in `site/catalog.js`, as are the credits, so this table
is a summary only.

| Layer | Provider | Licence |
|---|---|---|
| Chart base, coastline, roads, buildings, names, boundaries | OpenStreetMap via OpenFreeMap (OpenMapTiles schema) | ODbL |
| Satellite | Esri World Imagery, or EOX Sentinel-2 cloudless | Esri terms of use; EOX: CC BY 4.0 (2016) or CC BY-NC-SA 4.0 (2024, non-commercial) |
| Depth shading, isobaths, depth on click | GEBCO 2026 Grid (GEBCO Compilation Group), repacked as Zarr stores on the project's data host | Free to use and redistribute, with attribution |
| Depth sources | GEBCO 2026 type identifier grid, likewise | As GEBCO |
| Relief shading, land contours | AWS Terrain Tiles (Terrarium) | Open data, with attribution per source |
| Seamarks | OpenSeaMap | CC BY-SA 2.0 |
| EMODnet depth (Europe) | EMODnet Bathymetry (tiles; values from its Zarr store, listed in EDITO's catalogue) | CC BY 4.0 |
| Seabed substrate (Europe) | EMODnet Geology | CC BY 4.0 |
| Seagrass (Europe) | EMODnet Seabed Habitats, seagrass cover 2025, cut into tiles on the project's data host; its Caribbean part (CC BY-NC) left out | CC BY 4.0 |
| Maritime zones | Marine Regions (Flanders Marine Institute, VLIZ) | CC BY 4.0; not for legal or navigational use |
| Wrecks, cables, pipelines, offshore installations, wind farms, military and protected areas | EMODnet Human Activities (wrecks: UKHO) | CC BY 4.0 |
| Vessel density (Europe) | EMODnet Human Activities | EMODnet open data, attribution requested |
| Vessel density (world) | World Bank Group and IMF, Global Shipping Traffic Density | CC BY 4.0 |
| Route density (Europe) | EMSA, via EMODnet Human Activities | CC BY 4.0 |
| Sea state, water properties, satellite observations, water quality | Copernicus Marine Service | Copernicus Marine licence: free, attribution required |
| NASA daily (true colour) | NASA EOSDIS GIBS | NASA open data |
| Place search | Photon (komoot), OpenStreetMap data | ODbL |

Vessel and route density cover European and neighbouring seas only. The
density periods offered in the menu are listed in `site/catalog.js`; when
`npm run data-check` reports newer data, extend the list there.
