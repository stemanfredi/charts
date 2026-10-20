# Charts

A lean world chart in one static page: coastline, buildings, satellite,
depth shading, isobaths, seamarks and NASA daily ocean imagery, all from open
sources that need no key. Geodesic ruler, area and range-ring tools.
The link reproduces the exact view. PNG export.

No build step, no backend, no API keys. Serve the folder from anywhere static;
on GitHub, CI publishes it to Pages (see *Development*).

```
index.html   page shell; the CDN block is generated (see Dependencies)
style.css    all styling
catalog.js   sources, style layers in draw order, menu items, provenance
app.js       map, menu, URL state, graticule, source health, PNG export
clip.js      elevation tiles cut to the OSM coastline (runs in clip-worker.js)
legend.js    colour legends
measure.js   geodesic measurements (GeographicLib, WGS 84)
format.js    pure formatting helpers (angles, scale, wrap)
tools/deps.mjs  pin / hash / check / upgrade the CDN libraries
test/        unit tests (node --test) and a headless-Chrome smoke test
```

Run locally: `python3 -m http.server` in this folder, open http://localhost:8000.

## Layers

| Item | Source | Licence | Real resolution |
|---|---|---|---|
| Chart, coastline, roads, buildings, names, boundaries | OpenFreeMap (OpenStreetMap, OpenMapTiles schema) | ODbL | OSM; coastline generalised below zoom 7 |
| Satellite | Esri World Imagery (default) / EOX Sentinel-2 cloudless 2016 / 2024 | Esri terms / CC BY 4.0 / **CC BY-NC-SA 4.0** | ≤ 0.5 m / 10 m / 10 m |
| Depth shading, isobaths | AWS Terrain Tiles (Terrarium), cut to the OSM coastline, contoured in the browser | open data | seabed ~1–2 km in open sea; shading hidden above zoom 12, isobaths magnified |
| Relief shading, land contours | same DEM, land part, under the sea fill | open data | SRTM 30 m |
| Seamarks | OpenSeaMap | CC BY-SA 2.0 | crowd-sourced |
| Vessel density (off by default) | EMODnet Human Activities (Cogea; AIS from CLS, ORBCOMM, vesseltracker.com), WMS | EMODnet open data, attribution | 1 km, annual averages 2017–2024 by ship type; EU and neighbouring seas; 2024 incomplete, so 2023 is the default |
| Route density (off by default) | EMSA route density via EMODnet Human Activities, WMS | CC BY 4.0 | 1 km, monthly from Jan 2019, about 3 months behind; counts routes crossing each cell; EU and neighbouring seas |
| NASA daily | GIBS: MODIS / VIIRS true colour, MUR SST, chlorophyll-a | NASA open data | 250 m / 1 km; date picker, default yesterday UTC |

Every row in the menu has a ⋯ panel with the same provenance, and the
attribution line lists only the sources currently drawn.

Layout follows Google Maps: *Layers* top left (the panel opens down the left
edge, a bottom sheet on phones), tools top right (ruler, area, ring; copy link,
PNG), zoom, compass, cursor position and scale bar bottom right.

Colour layers get a legend (bottom left, also in the PNG; *Legends* in the
menu hides them): depth shading uses the same colour stops as the map, and sea surface temperature uses the colour map NASA GIBS publishes for
the layer (0.15 °C classes), fetched once when first shown. Vessel and route density use
the colour stops their WMS publishes. `npm run deps` (weekly in CI) reports when
the WMS offers newer periods than `catalog.js` lists.

## How loading works

- Each menu item maps to style layers (`metadata.item` in `catalog.js`). A hidden
  item's layers are `visibility: none`, and MapLibre requests no tiles for a
  source with no visible layer. Hiding something stops its traffic and keeps
  its settings.
- Items have zoom limits. Outside them the row greys out and says why
  ("zoom 13+", "zoom ≤ 12").
- Tiles come through the normal browser HTTP cache. Nothing is prefetched or
  bulk-downloaded (OSM and the other providers forbid that).
- A failing source marks its row (⚠, with the error in the tooltip) instead of
  leaving blank tiles that look like data.
- Terrarium has bathymetry only up to zoom 10 (above that most seas read 0 m),
  so the sea layers read zoom ≤ 10 tiles while land layers use zoom 12.

## One coastline

Every layer that comes from elevation data is made to agree with the OSM
coastline the basemap draws:

- `clip.js` masks each elevation tile with the OSM sea polygons from the same
  OpenFreeMap tiles (already in the browser cache), before MapLibre or
  maplibre-contour see it. For the sea layers, land becomes +1 m (no tint, no
  isobath), and sea that the DEM calls dry becomes −1 m, the shallowest class.
  For the land layers, sea becomes 0 m. Depth tiles are upsampled from zoom 10
  to 12 and masked at 12, so the shore stays sharp.
  Every tile is cut, at every zoom: each shortcut tried (deep ocean, low zooms)
  left a hole somewhere, such as islands under the tint, an isobath through the
  Jordan valley, or seabed relief over satellite imagery. Land below sea level
  (the Caspian Depression, polders) is never tinted. The cut tiles go to MapLibre as
  bitmaps and to maplibre-contour as numbers, with no PNG round trip.
- Water bodies that OSM maps with a coastline but whose surface is not at sea
  level are listed in `DATUMS` (clip.js). Today that's the
  Caspian Sea, at about −28 m: its depths are measured from its surface, not
  from sea level, or the shallow northern Caspian (~5 m) would show as 30 m.
  Terrarium holds only the flat lake surface there in large blocks at zooms 3–4
  and 7+, so Caspian depths are always read from zoom 5–6 tiles.
- The shaded sea tiles mark land with a high value, so the GPU-interpolated tint
  edge never covers the shore line. The thin gap it leaves shows the water
  fill, which takes the shallowest band's colour while depth shading is drawn.
- Elevation tiles are picked with floored zoom (like the vector basemap), and
  each one is cut with the OpenMapTiles tile the basemap shows at that zoom. With
  the default rounding they were cut with a more detailed coastline than the one
  on screen.
- Water is one surface: OSM splits it into polygons (the sea,
  a harbour basin closed off by a straight line between pier heads, a lagoon
  and its canals), but all of it is filled the same. The shore line is drawn
  *under* that fill at twice its width: where two water polygons meet, both
  fills cover it; where water meets land, the land-side half remains. Piers
  are drawn on top as land at about their real width.
- Inland water is classified once per water body, from the DEM along its
  shore (its polygon's vertices, relative to any `DATUMS` surface there), and
  remembered by OSM id so all tiles agree. It is at sea level when the shore
  both dips to within 8 m of sea level (lower quartile) and rises to within
  8 m of it (upper quartile): raised lakes fail the first, the Dead Sea,
  Galilee and the Salton Sea the second. At sea level (limans, lagoons, harbour
  basins) it is shown flat in the shallowest class with no isobaths, because the
  DEM inside it is not a depth; other lakes are grey (no depth data). A tile
  that shows only the inside of a water body classifies it from the same water
  body in a lower-zoom OpenMapTiles tile, where its shore is (ids are stable
  across zooms); if even that fails, it is drawn as a lake and redrawn once
  another tile has classified it. Over satellite no water colour is drawn at
  all: the image shows the water, with isobaths on top.
- The cutting runs in a Web Worker (`clip-worker.js`): on the main thread it
  blocked the page for seconds while panning. A worker loaded from its own file
  does not inherit the page's `<meta>` security policy (only HTTP headers would
  apply, and GitHub Pages sets none); its requests are fixed in code, to the
  elevation tiles and OpenFreeMap. It does not inherit the page's `no-referrer`
  either, so each of its requests sets `referrerPolicy: 'no-referrer'` itself.
- Relief shading and land contours are drawn under the vector sea fill, so the
  fill cuts them exactly at the shore. The land DEM is not upsampled, because
  the slopes of an upsampled surface shade in visible facets.
- There are no EMODnet or GEBCO picture layers: their own land is baked into
  the image and cannot be cut away (see *Parked* for using their values).

## Rigour and limits

- Distances, bearings (true), areas and rings are geodesic on WGS 84
  (GeographicLib), and lines are drawn as densified geodesics.
- The map is Web Mercator, so the scale bar is exact only at the centre
  latitude. When the scale varies by more than 1% across the view (from the
  lowest to the highest latitude in it), a note under the scale bar says so, on
  screen and in the PNG. For exact distances use the ruler, which is geodesic.
- Depth colours have two schemes (the Depth shading item's menu, also used by the
  legend): *darker = deeper* (atlas and ocean maps, the default) and
  *darker = shallower* (nautical charts, IHO S-52, where shallow water is the hazard).
- Depth shading and isobaths come from a coarse DEM, not soundings. They end at
  the OSM coastline, but their shapes near the shore are only as good as the
  1–2 km data, and sea the DEM calls dry is shown as the shallowest class.
  Lakes above sea level are grey: no depth source.
- **Not for navigation.**

## Privacy

`no-referrer`, and a Content-Security-Policy that allows only the CDN and the
tile hosts listed in `tools/deps.mjs`. Global tile requests still tell each
provider which area you are viewing; a hidden layer makes no requests.

## Dependencies

Loaded from jsDelivr at **pinned** versions with Subresource Integrity, via an
import map: MapLibre GL JS, maplibre-contour, geographiclib-geodesic.

```
node tools/deps.mjs           # pinned vs latest on npm
node tools/deps.mjs --write   # after changing a version in PINS: refetch, rehash, rewrite index.html
```

The import map's own hash goes into the CSP, so edit that block only through
the script.

## Development

The site needs nothing; `package.json` exists for the checks only (Node ≥ 22).

```
npm ci
npm test            # unit tests, offline: formatting, geodesics, URL round trip, catalog consistency
npm run check       # index.html CDN block = pins + SRI hashes + CSP hash (fetches the CDN files)
npm run smoke       # headless Chrome on the live providers; CHROME=/path/to/chrome if not /usr/bin/google-chrome
npm run ui          # layout at 390 / 820 / 1280 px, panel open and closed: no overlapping overlays,
                    # nothing off screen, every control ≥ 44 px (UI_SHOTS=dir saves screenshots)
npm run deps        # newer versions of the pinned libraries
```

The catalog test also guards the CSP: a new source on a host missing from
`TILE_HOSTS` fails it.

CI (`.github/workflows/ci.yml`) runs `test`, `check`, `smoke` and `ui` on every push
and pull request, and deploys `main` to GitHub Pages when they pass. Only the
site files are published: `index.html`, `*.js`, `*.css`. It also runs every
Monday, so a tile provider that changes or goes down fails a run, and newer
library versions appear as notices; updating stays a deliberate `--write`.
One-time repository setting: *Settings → Pages → Source: GitHub Actions*.

## Parked: more detail for a specific view

Global depths are ~1–2 km. Better depths for one area were built and then
parked (2026-10-20) because a regular user could not obtain them. The last
working version is the git tag **`parked/area-packs`**: `tools/build_pack.py`
(Python) wrote an "area pack" GeoJSON that the page opened from a file, by
drag and drop or as a `#pack=` link.

Options when this comes back:

1. In-page help, with packs prepared by someone running the tool.
2. Curated packs published next to the page and linked (public repo = public areas).
3. A "detailed depths for this view" button built in the browser: EMODnet's
   ERDDAP allows browser requests (Europe and nearby seas); NOAA's GEBCO ERDDAP
   does not, so elsewhere it would say "not available here". It can reuse
   `clip.js` (coastline mask, inland water, DATUMS).

Lessons from the pack tool, worth keeping:

- Measure EMODnet coverage on the OSM open sea, not on GEBCO's coastline;
  fill only open-sea gaps from GEBCO.
- Never use GEBCO in lagoons or lakes: Venice Lagoon reads 10 m in GEBCO, ~1 m in EMODnet.
- The OSMData land polygons put lagoons behind barrier islands on land: cut
  OSM inland water out of the land.
- Fill empty grid cells from neighbours before contouring and trace the
  no-data area with marching squares, or edges come out cell-stepped.
- Caspian depths are measured from its −28 m surface.
- OpenFreeMap rejects Python's default User-Agent: send one.

