# Charts

A world chart in a single static web page. It combines an OpenStreetMap base
map with satellite imagery, depth shading and isobaths, seamarks, shipping
density, Copernicus Marine ocean data (sea state, water properties, satellite
observations, water quality) and NASA daily imagery, and adds geodesic measuring tools. Every source
is public and needs no API key. There is no build step and no backend.

**Not for navigation.** Positions, coastlines and depths come from open
datasets of varying accuracy. Depths come from a coarse elevation model, not
from soundings.

## Features

Layers are grouped by task, each with an ⓘ for its source, licence and
resolution. Depth shading and isobaths end at the OpenStreetMap coastline.
Ruler, area and range ring are geodesic on WGS 84, in kilometres or nautical
miles. Search takes place names or coordinates. The link reopens the exact
view, and the PNG export carries the scale, legends and credits. The GIS export
is a zip: the map as a georeferenced PNG (world file, Web
Mercator), the PNG export, one GeoJSON file per vector layer drawn (`vector/`:
clipped to the view, pieces from neighbouring tiles joined) plus the
measurements, the depth and land elevation in metres as GeoTIFF (`raster/`, when
depth shading or relief and contours are drawn: the elevation tiles the map
draws, at their resolution, over the view's bounding box; imagery and density
layers are in the pictures only), and a [STAC](https://stacspec.org) Item (`item.json`) with the
view's footprint, the layers drawn, their sources, licences and files. QGIS
opens every file straight from the zip.

One limit of the GeoJSON: OpenMapTiles merges neighbouring buildings into one
feature whose parts touch, which is not valid geometry to begin with. The export
unions those parts, but now and then a building feature comes out still touching
itself (3 of 49 in central Taranto at zoom 14.5). GIS tools open these files;
QGIS's *Fix geometries* repairs them.

## Data sources

The map data and imagery are not part of this repository. The browser fetches
them from each provider, and each layer stays under its provider's licence.

| Layer | Provider | Licence |
|---|---|---|
| Chart base, coastline, roads, buildings, names, boundaries | OpenStreetMap via OpenFreeMap (OpenMapTiles schema) | ODbL |
| Satellite | Esri World Imagery, or EOX Sentinel-2 cloudless | Esri terms of use; EOX: CC BY 4.0 (2016) or CC BY-NC-SA 4.0 (2024, non-commercial) |
| Depth shading, isobaths, relief shading, land contours | AWS Terrain Tiles (Terrarium) | Open data, with attribution per source |
| Seamarks | OpenSeaMap | CC BY-SA 2.0 |
| Vessel density | EMODnet Human Activities | EMODnet open data, attribution requested |
| Route density | EMSA, via EMODnet Human Activities | CC BY 4.0 |
| Sea state, water properties, satellite observations, water quality | Copernicus Marine Service | Copernicus Marine licence: free, attribution required |
| NASA daily (true colour) | NASA EOSDIS GIBS | NASA open data |
| Place search | Photon (komoot), OpenStreetMap data | ODbL |

Layers that change with time (Copernicus and NASA daily) share one time, now by
default. While one is on, the top of the Layers panel holds one line to set
it, in local time: the browser's own date and time field, limited to the dates
those layers have, a step of an hour (a day, for daily layers) either way, and
Now. The time shown is also written beside the cursor's coordinates. Forecasts reach about nine days ahead. Copernicus layers: waves, currents and wind;
temperature, salinity, mixed layer depth and water quality (dissolved oxygen, pH,
nitrate, primary production); satellite sea surface temperature (and its anomaly),
chlorophyll and sea level anomaly. Daily products show the day of that hour, and
variables with depth are drawn at one depth, chosen on the same line. NASA daily
is true colour: the day as the satellite saw it. In the Mediterranean they come from
the regional products, elsewhere from the global ones. Everything is drawn at
the time shown, each dataset at its own time resolution (an hour, the global
waves' three hours, a day), and the time can only be one every layer that is on
has: observations (wind and the satellite layers, NASA daily too) are published
late, so while one is on the time goes no later than its latest day or hour. The map
holds one colour layer and one arrow layer: currents draw speed in colour and
direction in arrows, and give up their colours to another colour layer (waves,
temperature…) and their arrows to wind; a second colour layer replaces the
first.

Esri imagery is not open data: it is used under Esri's terms of use. The EOX
2024 mosaic does not allow commercial use. Vessel and route density cover European and neighbouring
seas only.

The app is the reference for coverage, resolution and available periods. It
shows them behind each layer's ⓘ, and they are defined in `catalog.js`. The
on-screen credits and the PNG list only the sources that are drawn.

## Privacy

- No request sends a `Referer` header, including requests from MapLibre's and
  the clipping worker's threads.
- A Content-Security-Policy limits the page to the pinned CDN packages and the
  provider hosts listed in `tools/deps.mjs`.
- Tile requests necessarily tell each provider which area is being viewed. A
  hidden layer makes no requests.
- Coordinates typed into the search box are parsed in the page and never sent.
  Place names are sent to Photon as you type, along with the map centre rounded
  to 0.1°. The results list says so.

## How it works

- **One coastline.** Elevation tiles are masked with the OpenStreetMap water
  polygons before the map sees them. This happens in a Web Worker
  (`clip.js`). As a result, depth shading and isobaths end at the drawn shore,
  and relief shading never spills into the sea. Inland water is classified once
  per water body: water at sea level (lagoons, harbour basins), lakes without
  depth data, or seas with their own surface level, such as the Caspian.
- **Honest depths.** The elevation model is coarse offshore and has defects
  where its land and sea sources meet: false pits at the coast (and false
  peaks on the land side), and bends at tile edges. Before contouring, small
  enclosed pits are raised, which only ever makes water shallower; the seam
  blur touches only a few pixels along tile edges; coastal land spikes are
  clamped. Everywhere else the data is drawn as it is. Isobath spacing widens with depth and tightens with zoom. EMODnet and GEBCO
  image layers are not used: their own land is baked into the picture and
  cannot be cut away.
- **Geodesic measurement.** Distances, bearings, areas and rings use
  GeographicLib on WGS 84. Lines are drawn as densified geodesics, so the line
  on screen is the path the numbers describe. The map itself is Web Mercator,
  so the scale bar is exact only at the centre latitude. A note appears when
  the scale varies noticeably across the view.
- **Visible failures.** A source that fails is marked in the Layers panel
  instead of leaving blank tiles that could be read as data.

The reasons behind each rule are documented next to the code that applies it.

## Code layout

| Path | Responsibility |
|---|---|
| `index.html` | Page shell. The CDN block is generated; see *Dependencies*. |
| `style.css` | All styling. |
| `catalog.js` | Sources, style layers in draw order, menu items and their provenance. |
| `app.js` | Map setup, panels, URL state, search, legends, graticule, PNG and GIS export. |
| `export.js` | GIS export contents: georeferencing and the STAC Item. |
| `vector.js` | Vector layers of the view as GeoJSON: tile pieces joined, clipped to the view. |
| `geotiff.js` | Elevation grids of the view as GeoTIFF. |
| `cmems.js` | Copernicus Marine tiles (regional over global), time ranges, legends. |
| `zip.js` | Zip writer (the browser's own deflate). |
| `clip.js`, `clip-worker.js` | Elevation tiles cut to the OSM coastline, in a Web Worker. |
| `measure.js` | Geodesic ruler, area and range ring. |
| `legend.js` | Legend drawing. |
| `format.js` | Pure formatting and parsing helpers. |
| `tools/deps.mjs` | Pins, hashes and checks the CDN dependencies. |
| `test/` | Unit tests, browser tests, and the development server. |

## Development

Requirements: the Node.js version in `.nvmrc`. The browser tests also need a
local Chrome or Chromium.

```sh
npm ci              # development dependencies (test tooling only)
npm run serve       # http://localhost:8000, browser caching off (--port, --host)
npm test            # unit tests, offline
npm run check       # index.html CDN block matches the pins, SRI hashes and CSP
npm run smoke       # end-to-end in headless Chrome, against the live providers
npm run ui          # layout at phone, tablet and desktop widths
npm run deps        # newer library versions and newer density data periods
```

The page itself needs no installation. Any static web server can host the
repository root. The browser tests use `/usr/bin/google-chrome` by default; set
`CHROME=/path/to/chrome` to use another binary.

The smoke test depends on the network by design, because the page depends on
the providers. A failure can therefore mean that a provider changed or went
down, not only that the code broke.

### Continuous integration

`.github/workflows/ci.yml` runs the unit, check, smoke and layout tests on
pushes to `main` and on pull requests. When they pass, it deploys `main` to
GitHub Pages; only the site files are published. A scheduled run repeats the
tests against the live providers and reports dependency and data updates as
notices. Pages must be enabled once in the repository settings, with
*Source: GitHub Actions*.

## Dependencies

MapLibre GL JS, maplibre-contour, GeographicLib and polygon-clipping load from jsDelivr at pinned
versions with Subresource Integrity. MapLibre's worker script is pinned and
verified too: the page checks its hash and gives MapLibre the verified copy.
polygon-clipping loads only on the first GIS export, from its pinned URL with
its hash. The pins are listed in `PINS` in `tools/deps.mjs`.

To upgrade, change a version in `PINS`, run `node tools/deps.mjs --write`, and
test. The script refetches the files and rewrites the generated block in
`index.html`, including the import map's hash in the CSP. Do not edit that
block by hand: `npm run check` fails if it differs from what the script would
produce.

The density periods offered in the menu are listed in `catalog.js`. When
`npm run deps` reports newer data, extend the list there.

## Archived work

Support for survey-grade depths in selected areas ("area packs") was built and
then set aside, because regular users could not obtain the source data. The
last working version, with notes on reviving it, is the tag
`parked/area-packs`.

## Licence

The code is licensed under GPL-3.0-or-later; see `LICENSE`. Map data and
imagery are under their providers' licences, listed in *Data sources*.
