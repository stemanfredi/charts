# Charts

A lean world chart in one static page: coastline, buildings, satellite,
depth shading, isobaths, seamarks and NASA daily ocean imagery, all from open
sources that need no key. Geodesic ruler, area and range-ring tools.
The link reproduces the exact view. PNG export. **Not for navigation.**

No build step, no backend, no API keys. Serve the folder from anywhere static;
on GitHub, CI publishes it to Pages (see *Development*).

```
index.html   page shell; the CDN block is generated (see Dependencies)
style.css    all styling
catalog.js   sources, style layers in draw order, menu items, provenance, isobath spacing
app.js       map, menu, URL state, graticule, source health, search, PNG export
clip.js      elevation tiles cut to the OSM coastline (runs in clip-worker.js)
legend.js    colour legends
measure.js   geodesic measurements (GeographicLib, WGS 84)
format.js    pure formatting helpers (angles, coordinates, scale, wrap)
tools/deps.mjs  pin / hash / check / upgrade the CDN libraries
test/        unit tests (node --test) and headless-Chrome smoke and layout tests
```

Run locally: `npm run serve` (Node ≥ 24, nothing to install), open
http://localhost:8000. Caching is off, so a reload always runs the current files.

## Layers

| Item | Source | Licence | Real resolution |
|---|---|---|---|
| Chart, coastline, roads, buildings, names, boundaries | OpenFreeMap (OpenStreetMap, OpenMapTiles schema) | ODbL | OSM; coastline generalised below zoom 7 |
| Satellite | Esri World Imagery (default) / EOX Sentinel-2 cloudless 2016 / 2024 | Esri terms / CC BY 4.0 / **CC BY-NC-SA 4.0** | ≤ 0.5 m / 10 m / 10 m |
| Depth shading, isobaths | AWS Terrain Tiles (Terrarium), cut to the OSM coastline, contoured in the browser | open data | seabed ~1–2 km in open sea |
| Relief shading, land contours | same DEM, land part | open data | SRTM 30 m |
| Seamarks | OpenSeaMap | CC BY-SA 2.0 | crowd-sourced |
| Vessel density (off by default) | EMODnet Human Activities (AIS from CLS, ORBCOMM, vesseltracker.com) | EMODnet open data, attribution | 1 km, annual 2017–2024; EU and neighbouring seas |
| Route density (off by default) | EMSA via EMODnet Human Activities | CC BY 4.0 | 1 km, monthly from 2019, ~3 months behind; EU and neighbouring seas |
| NASA daily | GIBS: MODIS / VIIRS true colour, MUR SST, chlorophyll-a | NASA open data | 250 m / 1 km; newest published day by default |

Each row in the Layers panel has an ⓘ with its source, licence and resolution;
the credits list only the sources currently drawn. Colour layers get a legend
(also in the PNG).

Search takes a place name (via Photon, see *Privacy*) or coordinates in any
common form (`35.898, 14.513`, `35 53.9N 14 30.8E`, `35°53'54"N 014°30'48"E`).
Keys: <kbd>/</kbd> search, <kbd>L</kbd> layers, <kbd>R</kbd> ruler, <kbd>A</kbd>
area, <kbd>C</kbd> range ring, <kbd>Esc</kbd> cancels.

## How it works

- **One coastline.** Every layer made from elevation data is cut to the OSM
  coastline the basemap draws, in a Web Worker (`clip.js`): depth tint and
  isobaths end at the real shore, relief never smears into the sea. Inland
  water is classified once per water body (lagoon at sea level, lake, or the
  Caspian with its own surface). The reasons for each rule are in the code.
- **Honest data.** Depths come from a coarse DEM (~1–2 km offshore), not
  soundings. False pits and tile-edge seams are removed before contouring.
  EMODnet and GEBCO image layers are not used: their
  own land is baked into the picture and cannot be cut away.
- **Geodesic.** Distances, true bearings, areas and rings are on WGS 84
  (GeographicLib). The map is Web Mercator, so when the scale varies by more
  than 3% across the view, a note beside the scale bar says so.
- **Frugal.** A hidden layer requests nothing. Tiles go through the normal
  browser cache; nothing is prefetched. A failing source marks its row (⚠)
  instead of leaving blank tiles that look like data.

## Privacy

`no-referrer` on every request, and a Content-Security-Policy that allows only
the pinned CDN packages and the hosts listed in `tools/deps.mjs`. Tile requests still tell each
provider which area you are viewing.

Coordinates typed into the search box never leave the page. A place name goes
to [Photon](https://photon.komoot.io) (komoot, OpenStreetMap data) as you type,
with the map's centre rounded to 0.1°; the results list says so.

## Dependencies

Loaded from jsDelivr at **pinned** versions with Subresource Integrity, via an
import map: MapLibre GL JS, maplibre-contour, geographiclib-geodesic. MapLibre's
worker is pinned and hashed too: the page fetches it and hands MapLibre the
checked copy.

```
node tools/deps.mjs           # pinned vs latest, and newer density periods in the WMS
node tools/deps.mjs --write   # after changing a version in PINS: refetch, rehash, rewrite index.html
```

The import map's own hash goes into the CSP, so edit that block only through
the script.

## Development

```
npm run serve       # the site on port 8000 with caching off (--port, --host to change)
npm ci
npm test            # unit tests, offline
npm run check       # index.html CDN block = pins + SRI hashes + CSP hash
npm run smoke       # headless Chrome on the live providers (CHROME=/path/to/chrome)
npm run ui          # layout at 390 / 820 / 1280 px: no overlaps, nothing off screen, targets ≥ 44 px on touch
npm run deps        # newer library versions
```

CI runs all of them on every push and pull request, and deploys `main` to
GitHub Pages when they pass (only `index.html`, `*.js`, `*.css`). It also runs
every Monday, so a provider that changes or goes down fails a run. One-time
setting: *Settings → Pages → Source: GitHub Actions*.

Parked: survey-grade depths for one area ("area packs"), built and then set
aside because a regular user could not obtain them. The last working version,
with notes for bringing it back, is the tag `parked/area-packs`.

## Licence

Code: GPL-3.0-or-later (`LICENSE`). The map data and imagery are not in this
repository: the browser fetches them, and each layer keeps its provider's
licence (see *Layers*; EOX 2024 is non-commercial, Esri has its own terms).
