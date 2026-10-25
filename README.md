# Charts

**[charts.makaw.org](https://charts.makaw.org)**

A world chart in a single static web page. It combines an OpenStreetMap base
map with satellite imagery, depth shading and isobaths, seamarks, shipping
density, Copernicus Marine ocean data (sea state, water properties, satellite
observations, water quality) and NASA daily imagery, and adds geodesic measuring tools and drawings. A click on the sea gives its depth (GEBCO's, rounded towards shallower) and how it was obtained. Every source
is public and needs no API key. There is no build step and no backend.

**Not for navigation.** Positions, coastlines and depths come from open
datasets of varying accuracy. Depths come from a coarse elevation model, not
from soundings.

## Features

- **Layers**, grouped by task, each with an ⓘ for its source, licence and
  resolution. Depth shading and isobaths end at the OpenStreetMap coastline.
- **Measuring**, geodesic on WGS 84 (distance, area, ring), in kilometres or
  nautical miles (the switch beside the scale), with true bearings beside each
  leg when switched on; both are kept in the link. A measurement is a guide
  showing its values, made with the drawing's own tools and part of the drawing.
- **Drawing** (Tools): points (a symbol), circles, rings and sectors about a
  centre, outlines of real size (rectangles, triangles, ellipses, vehicle
  outlines), polygons, lines (geodesic, or curved: a curve's length is the drawn
  line's), labels, and groups whose style each member takes unless it has its
  own.
  - Every shape is placed in two clicks, the centre then its size (a sector in
    three, a polygon corner by corner).
  - Line ends attach to points, to outlines' and polygons' corners and edges and
    to other lines' vertices, and follow them; snapping finds them.
  - Circles are repeated along a line or an arc and connected to origins in trees
    or chains.
  - Everything is named, edited in small tables and dragged on the map, with
    lengths, areas and totals; a line also has its depth profile and its length
    along the seabed.
  - Lines that run together can be drawn a few pixels apart (lengths stay real),
    and small outlines are shown enlarged.
  - Drawings stay in the browser, several of them, saved as you go and never sent
    anywhere. Export › Drawing (GeoJSON) writes one as a `.geojson` file
    (`docs/drawing-format.md`) with its view and layers, and Import adds one back
    (or any GeoJSON).
- **Search** takes place names or coordinates. **The link** reopens the exact
  view and layers, never a drawing.
- **Picture (PNG):** the map as on screen, without the controls: legends and
  credits bottom left; its centre, zoom, projection and the data's time beside
  the scale bottom right. The same details, the credits and a
  not-for-navigation disclaimer are also in the PNG's text fields.
- **GIS data:** a zip that QGIS opens file by file:
  - the map as a georeferenced PNG (world file, Web Mercator), and the PNG export;
  - one GeoJSON file per vector layer drawn (`vector/`: clipped to the view,
    pieces from neighbouring tiles joined), plus the drawing as drawn and its
    `.geojson` file, to import again;
  - the depth and land elevation in metres as GeoTIFF (`raster/`, when depth
    shading or relief and contours are drawn: the elevation tiles the map draws,
    at their resolution, over the view's bounding box);
  - the values of each Copernicus layer drawn as GeoTIFF
    (`raster/<layer>-global.tif`, `-mediterranean.tif`: read from Copernicus
    Marine's public Zarr stores at the time and depth drawn, in each dataset's own
    latitude/longitude grid over the view's bounding box, arrows as eastward and
    northward bands);
  - GEBCO's depth under the depth shading (`raster/gebco-depth.tif`, its own 15″
    grid, or its means of 2 × 2, 4 × 4 … cells for wider views; with *Depth
    sources*, GEBCO's codes for how each depth was obtained,
    `raster/gebco-source.tif`);
  - EMODnet's depth (`raster/emodnet-depth.tif`, 1/16 arc-minute, for views up to
    about 4° wide; imagery, density and the other EMODnet layers are in the
    pictures only);
  - a [STAC](https://stacspec.org) Item (`item.json`) with the view's footprint,
    the time of the data shown (its `datetime`; the export's own is `created`),
    the layers drawn (what each draws: colours or arrows, its time and depth),
    their sources, licences and files.

One limit of the GeoJSON: OpenMapTiles merges neighbouring buildings into one
feature whose parts touch, which is not valid geometry to begin with. The export
unions those parts, but now and then a building feature comes out still touching
itself (3 of 49 in central Taranto at zoom 14.5). GIS tools open these files;
QGIS's *Fix geometries* repairs them.

The drawing's file is plain GeoJSON, so any GIS opens it, with these limits:

- Other tools see points, lines and polygons, the user's properties as columns,
  and the common style names (`stroke`, `stroke-width`, `stroke-opacity`, `fill`,
  `fill-opacity`). They do not see radii, sectors, outlines or symbols: those are
  properties of a point (the GIS export has them drawn, as polygons).
- Legs are geodesics in the app; GeoJSON calls a leg straight in longitude and
  latitude. A long east-west leg is drawn slightly apart elsewhere (about 40 m at
  the middle of a 50 km leg at 40°N; nothing for a leg running north-south).
  Curved lines show straight through their vertices.
- Groups, the view, attachments, labels' placement and what Repeat along and
  Connect keep linked are in the app's own member, `charts`, which other tools
  ignore and keep or drop as they do.
- The app reads its own files of format version 1; a file of another version
  is refused.
- A file edited elsewhere and read back: an attached line end moves to what it is
  attached to (the report says how many); a nested value a GIS turned into text is
  read again.

## Data sources

The map data and imagery are not part of this repository. The browser fetches
them from each provider, and each layer stays under its provider's licence.

| Layer | Provider | Licence |
|---|---|---|
| Chart base, coastline, roads, buildings, names, boundaries | OpenStreetMap via OpenFreeMap (OpenMapTiles schema) | ODbL |
| Satellite | Esri World Imagery, or EOX Sentinel-2 cloudless | Esri terms of use; EOX: CC BY 4.0 (2016) or CC BY-NC-SA 4.0 (2024, non-commercial) |
| Depth shading, isobaths | GEBCO 2026 Grid (GEBCO Compilation Group), repacked as a Zarr store at `geodata.makaw.org` (`tools/gebco.mjs`); Terrarium where it cannot be read | Free to use and redistribute, with attribution |
| Depth sources (GEBCO) | GEBCO 2026 type identifier grid, at `geodata.makaw.org` | Free to use and redistribute, with attribution |
| Relief shading, land contours | AWS Terrain Tiles (Terrarium) | Open data, with attribution per source |
| Seamarks | OpenSeaMap | CC BY-SA 2.0 |
| EMODnet depth (Europe) | EMODnet Bathymetry (tiles; its values from its Zarr store, listed in EDITO's catalogue) | CC BY 4.0 |
| Seabed substrate | EMODnet Geology | CC BY 4.0 |
| Seagrass (Europe) | EMODnet Seabed Habitats, seagrass cover 2025, cut into tiles at `geodata.makaw.org` (`tools/seagrass.mjs`); its Caribbean part (CC BY-NC) left out | CC BY 4.0 |
| Maritime zones | Marine Regions (Flanders Marine Institute, VLIZ): maritime boundaries and zones | CC BY 4.0; not for legal or navigational use |
| Wrecks, cables, pipelines, offshore installations, wind farms, military and protected areas | EMODnet Human Activities (wrecks: UKHO) | CC BY 4.0 |
| Vessel density | EMODnet Human Activities | EMODnet open data, attribution requested |
| Vessel density (world) | World Bank Group and IMF, Global Shipping Traffic Density (the World Bank's tiles) | CC BY 4.0 |
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
late, so while one is on the time goes no later than its latest day or hour. They
are chosen in the Ocean data group, in two menus, one for colours and one for
arrows, since two colour layers cannot be read together, nor two sets of arrows:
currents are in both (speed in colour, direction in arrows), wind is arrows.

### Shipping traffic data outside the app

The density layers are pictures drawn by their services. To work with the data
itself, these sources publish it (check each provider's current terms before use):

- **EMODnet Human Activities**: vessel density (hours per km² per month, by ship
  type, 2017–2024) and EMSA route density (monthly since 2019) for European seas,
  as GeoTIFF downloads and OGC services, CC BY 4.0
  ([emodnet.ec.europa.eu/en/human-activities](https://emodnet.ec.europa.eu/en/human-activities)).
- **World Bank and IMF, Global Shipping Traffic Density**: world, 2015–2021, about
  500 m, all vessels and by type (commercial, fishing, passenger, leisure, oil and
  gas), as zipped GeoTIFFs (510 MB for all vessels), CC BY 4.0
  ([dataset 0037580](https://datacatalog.worldbank.org/search/dataset/0037580)).
- **Global Maritime Traffic Density Service** (GMTDS): world, monthly from 2011;
  downloads and services by request ([globalmaritimetraffic.org](https://globalmaritimetraffic.org)).
- **Global Fishing Watch**: fishing effort and vessel presence worldwide, through
  its API with a free account and token
  ([globalfishingwatch.org](https://globalfishingwatch.org)).
- **Raw AIS positions** for national waters: the United States' Marine Cadastre
  ([marinecadastre.gov](https://marinecadastre.gov)) and the Danish Maritime
  Authority publish historical AIS downloads; live AIS streams exist too, mostly
  behind a free registration or in exchange for feeding a receiver.

Esri imagery is not open data: it is used under Esri's terms of use. The EOX
2024 mosaic does not allow commercial use. Vessel and route density cover European and neighbouring
seas only.

The app is the reference for coverage, resolution and available periods. It
shows them behind each layer's ⓘ, and they are defined in `site/catalog.js`. The
on-screen credits and the PNG list only the sources that are drawn.

## Privacy

- No request sends a `Referer` header, including requests from MapLibre's and
  the clipping worker's threads.
- A Content-Security-Policy limits the page to the pinned CDN packages and the
  provider hosts listed in `tools/deps.mjs`.
- Tile requests necessarily tell each provider which area is being viewed. A
  hidden layer makes no requests. GEBCO's depths and the seagrass come from this project's own
  bucket, `geodata.makaw.org`. A GIS export with Copernicus layers drawn
  also reads their datasets from Copernicus Marine's catalogue and stores.
- Drawings stay in the browser. A line's depth profile, when opened, reads the
  depth tiles along that line; nothing else of a drawing makes a request.
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
  instead of leaving blank tiles that could be read as data. An export that
  fails, or leaves out values it could not read, says so on its button.

The reasons behind each rule are documented next to the code that applies it.

## Code layout

`site/` holds the page and is published as it is; everything else is for
development.

| Path | Responsibility |
|---|---|
| `site/index.html` | Page shell. The CDN block is generated; see *Dependencies*. |
| `site/style.css` | All styling. |
| `site/catalog.js` | Menu items and their provenance, data sources, datasets. |
| `site/style.js` | The map style built from the catalogue: sources, layers in draw order. |
| `site/app.js` | Map setup, state and URL, panels, legends, graticule, credits; assembles the exports. |
| `site/search.js` | Place search (Photon) and coordinates. |
| `site/png.js` | The PNG export's picture and text fields. |
| `site/values.js` | Layers as data for the GIS export: Copernicus, GEBCO and EMODnet values from their Zarr stores. |
| `site/gebco.js` | The sea's depths for the elevation tiles, from GEBCO's Zarr store. |
| `site/export.js` | GIS export contents: georeferencing, the STAC Item, PNG text fields. |
| `site/vector.js` | Vector layers of the view as GeoJSON: tile pieces joined, clipped to the view. |
| `site/geotiff.js` | GeoTIFF writer: elevation grids of the view, data values. |
| `site/zarr.js` | Zarr stores: metadata, chunks, Blosc (LZ4 or zlib) decoded. |
| `site/cmems.js` | Copernicus Marine tiles (regional over global), time steps and depth levels, legends. |
| `site/zip.js` | Zip writer (the browser's own deflate). |
| `site/clip.js`, `site/clip-worker.js` | Elevation tiles cut to the OSM coastline, in a Web Worker. |
| `site/geodesy.js` | Geodesics on WGS 84 (GeographicLib) for every measured and drawn length; a local planar frame about a point (`localFrame`). |
| `site/tools.js`, `site/keys.js`, `site/fields.js`, `site/listrow.js`, `site/menu.js` | The keys of what is being drawn, every key, the fields, a list row, the rail's menus. |
| `site/hosts.js` | Every host the page may reach: read by the catalogue and by `tools/deps.mjs` (the Content-Security-Policy). |
| `site/draw/document.js`, `site/draw/check.js` | The drawing's model: points, lines, areas, labels, groups; the style cascade; operations; field checks. |
| `site/draw/file.js` | The drawing's file: GeoJSON read (any) and written, with a report. |
| `site/draw/attach.js`, `site/draw/snap.js` | Line ends attached to points, corners, edges and vertices; snapping. |
| `site/draw/presets.js`, `site/draw/clipboard.js` | The user's presets (this browser only); copy, paste, duplicate. |
| `site/draw/lines.js` | Lines: geodesic and curved legs, lengths, distance along, totals, smoothing. |
| `site/draw/schematic.js` | Draw apart: lines kept from being drawn over others on screen (display only). |
| `site/draw/features.js` | What the map draws, what the GIS export writes; each kind's bounds, box test and move. |
| `site/draw/generator.js` | Repeat along a line or an arc, Connect (trees, chains), and how they follow. |
| `site/draw/store.js`, `site/draw/saving.js` | The document's selection and undo; the drawings kept in the browser. |
| `site/draw/drawing.js`, `site/draw/layers.js` | The drawing on the map: every tool (Measure's are its own, with Guide and Show values), the values shown while drawing, dragging, its layers. |
| `site/draw/place.js` | What the Point and Shape tools place, sized by the second click, each named after its look ("Circle 2"). |
| `site/draw/profile.js` | A line's depth profile and its length along the seabed, from the depths the depth shading draws. |
| `site/draw/panel.js` | The Tools panel: the tools and their kinds, list, inspector, forms, import report. |
| `site/draw/grid.js`, `site/draw/paste.js` | The inspector's lists as small spreadsheets; rows copied out of them and places pasted in. |
| `site/draw/drag.js`, `site/draw/labels.js`, `site/draw/outlines.js` | Dragging geometry; labels' anchors and text; shapes' outlines. |
| `site/legend.js` | Legend drawing. |
| `site/format.js` | Pure formatting and parsing helpers. |
| `site/geo.js`, `site/net.js`, `site/dom.js` | Web Mercator maths and small geometry helpers (`D2R`, `norm360`, `nearestOnSegment`); how requests are made and shared; DOM helpers. |
| `tools/deps.mjs` | Pins, hashes and checks the CDN dependencies. |
| `tools/gebco.mjs` | GEBCO's depth grids as Zarr stores (download, build, verify), published at `geodata.makaw.org`. |
| `tools/seagrass.mjs` | EMODnet's seagrass as vector tiles (download, build), published at `geodata.makaw.org`: its WMS takes a minute or more a tile. |
| `test/` | Unit tests, browser tests, and the development server. |
| `docs/` | The drawing tools: the file format and the interface. |

## Development

Requirements: the Node.js version in `.nvmrc`. The browser tests also need a
local Chrome or Chromium.

```sh
npm ci              # development dependencies (test tooling only)
npm run serve       # http://127.0.0.1:8000, site/ only, caching off (--host 0.0.0.0 for a phone)
npm test            # unit tests, offline
npm run lint        # ESLint's recommended rules
npm run check       # index.html CDN block matches the pins, SRI hashes and CSP
npm run smoke       # end-to-end in headless Chrome, against the live providers
npm run ui          # layout at phone, tablet and desktop widths
npm run tiles-check # elevation tiles of known trouble spots: seams, zooms, lakes
npm run perf        # how long the depth layers take to draw, GEBCO against Terrarium
npm run deps        # newer library versions and newer density data periods
```

The page itself needs no installation. Any static web server can host the
`site/` folder. The browser tests use `/usr/bin/google-chrome` by default; set
`CHROME=/path/to/chrome` to use another binary.

The smoke test depends on the network by design, because the page depends on
the providers. A failure can therefore mean that a provider changed or went
down, not only that the code broke.

### Exports

The PNG and GIS exports say what the map shows, and only from one place:
`snapshot()` in `site/app.js`, read at the moment of capture (the view, the time and
depth as stated beside the coordinates, the credits, each layer drawn with its
state). Each kind of data layer (`KINDS` in `site/app.js`) says how it is exported,
with `record()` and `values()` (`null`: in the pictures only); the page checks
on load that every kind has them and every catalogue item's kind exists, and
the smoke test fails on the console error. The smoke test also exports one view
per kind and compares the zip with the map: layers, time, depth, colours or
arrows, the PNG's size, text fields and credits, the Copernicus values.

### Continuous integration

`.github/workflows/ci.yml` runs the unit, lint, check, smoke and layout tests on
pushes to `main` and on pull requests. When they pass, it deploys `main` to
GitHub Pages; only `site/` is published. A scheduled run repeats the
tests against the live providers and reports dependency and data updates as
notices. Pages must be enabled once in the repository settings, with
*Source: GitHub Actions*.

## Dependencies

MapLibre GL JS, maplibre-contour, GeographicLib and polygon-clipping load from jsDelivr at pinned
versions with Subresource Integrity. MapLibre's worker script is pinned and
verified too: the page checks its hash and gives MapLibre the verified copy.
polygon-clipping loads only on the first GIS export, from its pinned URL with
its hash. The pins are listed in `PINS` in `tools/deps.mjs`. The unit tests take
GeographicLib and polygon-clipping from npm; a test fails if those versions
differ from the pins.

To upgrade, change a version in `PINS`, run `node tools/deps.mjs --write`, and
test. The script refetches the files and rewrites the generated block in
`site/index.html`, including the import map's hash in the CSP. Do not edit that
block by hand: `npm run check` fails if it differs from what the script would
produce.

The density periods offered in the menu are listed in `site/catalog.js`. When
`npm run deps` reports newer data, extend the list there.

## Roadmap

Known gaps and parked ideas: [ROADMAP.md](ROADMAP.md).

## Archived work

Support for survey-grade depths in selected areas ("area packs") was built and
then set aside, because regular users could not obtain the source data. The
last working version, with notes on reviving it, is the tag
`parked/area-packs`.

## Licence

The code is licensed under GPL-3.0-or-later; see `LICENSE`. Map data and
imagery are under their providers' licences, listed in *Data sources*.
