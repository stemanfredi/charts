# Charts

A lean world chart in one static page: coastline, buildings, satellite,
depth shading, isobaths, seamarks and NASA daily ocean imagery, all from open
sources that need no key. Geodesic ruler, area and range-ring tools.
The link reproduces the exact view. PNG export.

No build step, no backend, no API keys. Serve the folder from anywhere static
(GitHub Pages: *Settings → Pages → Deploy from branch → `main` / root*).

```
index.html   page shell; the CDN block is generated (see Dependencies)
style.css    all styling
catalog.js   sources, style layers in draw order, menu items, provenance
app.js       map, menu, URL state, graticule, source health, PNG export
clip.js      elevation tiles cut to the OSM coastline
legend.js    colour legends
measure.js   geodesic measurements (GeographicLib, WGS 84)
tools/deps.mjs  pin / hash / upgrade the CDN libraries
tools/build_pack.py  build an area pack (Python, optional)
```

Run locally: `python3 -m http.server` in this folder, open http://localhost:8000.

## Layers

| Item | Source | Licence | Real resolution |
|---|---|---|---|
| Chart, coastline, roads, buildings, names, boundaries | OpenFreeMap (OpenStreetMap, OpenMapTiles schema) | ODbL | OSM; coastline generalised below zoom 7 |
| Satellite | Esri World Imagery (default) / EOX Sentinel-2 cloudless 2016 / 2024 | Esri terms / CC BY 4.0 / **CC BY-NC-SA 4.0** | ≤ 0.5 m / 10 m / 10 m |
| Depth shading, isobaths | AWS Terrain Tiles (Terrarium), cut to the OSM coastline, contoured in the browser | open data | seabed ~1–2 km in open sea; hidden above zoom 12 |
| Relief shading, land contours | same DEM, land part, under the sea fill | open data | SRTM 30 m |
| Seamarks | OpenSeaMap | CC BY-SA 2.0 | crowd-sourced |
| NASA daily | GIBS: MODIS / VIIRS true colour, MUR SST, chlorophyll-a | NASA open data | 250 m / 1 km; date picker, default yesterday UTC |

Every row in the menu has a ⋯ panel with the same provenance, and the
attribution line lists only the sources currently drawn.

Colour layers get a legend (bottom left, also in the PNG; *Legends* in the
menu hides them): depth shading and pack depths use the same colour stops as
the map, and sea surface temperature uses the colour map NASA GIBS publishes for
the layer (0.15 °C classes), fetched once when first shown.

## Area packs

Global layers are good for context, but their depths come from a coarse
elevation model and their land/sea edges don't quite agree. For an area you
care about, build an **area pack**: one GeoJSON file with

- depths from gridded bathymetry: EMODnet DTM 2024 (~115 m) where it covers
  the open sea, with open-sea gaps filled from GEBCO; GEBCO 2020 (~450 m)
  elsewhere, or your own GEBCO GeoTIFF via `--gebco`. GEBCO is never used in
  lagoons or lakes: in the Venice Lagoon it reads 10 m where EMODnet (and
  reality) has about 1 m;
- inland water (lagoons, lakes, rivers, docks) taken from the same OpenFreeMap
  water polygons the page draws and cut out of the OSMData land, which puts a
  lagoon behind its barrier islands on land;
- water without depth data shown as such, grey and never white (white reads as
  deep). Water within one grid cell of real data counts as covered, so shores
  don't get a grey halo;
- depth areas and isobaths at nautical levels (2, 5, 10, 20, 30, 50, 100 … m),
  traced on the grid and then **clipped to the OSMData coastline**, so they
  meet the shore exactly and never spill onto land;
- that coastline as land polygons, and the frame outline.

```
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt   # once
.venv/bin/python tools/build_pack.py spezia --center=44.075,9.86 --half-w-km 8
```

The menu's *Build command* button copies this line for the current view. The
first run downloads the OSMData land polygons (~900 MB) into `.cache/`, or you
can point `--land` at a copy you already have. Grids are cached there too. A
16 × 11 km harbour pack is about 0.4 MB; the 32 × 21 km Venice Lagoon is 0.65 MB gzipped.

Open a pack with *Open pack…* or by dropping it on the map; `.geojson.gz` works
too. **It is read in the browser and never uploaded**, so tile providers don't
learn about the area from the pack. Inside the pack frame (dashed magenta) its
layers sit above every global sea layer, and the menu shows its sources,
resolution and build date. A pack placed next to the page can be linked as
`#pack=packs/name.geojson` (same site only). `packs/` is git-ignored on
purpose, because a public repo would publish your areas of interest.

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
  Sea tiles are cut at every zoom, so land below sea level (the Caspian
  Depression, polders) is never tinted. The cut tiles go to MapLibre as
  bitmaps and to maplibre-contour as numbers, with no PNG round trip.
- Water bodies that OSM maps with a coastline but whose surface is not at sea
  level are listed in `DATUMS` (clip.js, and in the pack tool). Today that's the
  Caspian Sea, at about −28 m: its depths are measured from its surface, not
  from sea level, or the shallow northern Caspian (~5 m) would show as 30 m. Above zoom 6
  one of Terrarium's sources holds only the flat lake surface there, in large
  rectangles, so Caspian depths are read from zoom 6 tiles.
- The shaded sea tiles mark land with a high value, so the GPU-interpolated tint
  edge never covers the shore line. The thin gap it leaves shows the water
  fill, which takes the shallowest band's colour while depth shading is drawn.
- Elevation tiles are picked with floored zoom (like the vector basemap), and
  each one is cut with the OpenMapTiles tile the basemap shows at that zoom. With
  the default rounding they were cut with a more detailed coastline than the one
  on screen.
- Water is one surface, as in area packs: OSM splits it into polygons (the sea,
  a harbour basin closed off by a straight line between pier heads, a lagoon
  and its canals), but all of it is filled the same. The shore line is drawn
  *under* that fill at twice its width: where two water polygons meet, both
  fills cover it; where water meets land, the land-side half remains. Piers
  are drawn on top as land at about their real width.
- Inland water is classified once per water body, from the DEM along its
  shore (median over its polygon's vertices, remembered by OSM id so all tiles
  agree). At sea level (≤ 5 m: limans, lagoons, harbour basins) it is shown flat
  in the shallowest class with no isobaths, because the DEM inside it is not a
  depth. Lakes above that are grey: no depth data.
- Relief shading and land contours are drawn under the vector sea fill, so the
  fill cuts them exactly at the shore. The land DEM is not upsampled, because
  the slopes of an upsampled surface shade in visible facets.
- There are no EMODnet or GEBCO picture layers: their own land is baked into
  the image and cannot be cut away. Their depth *values* reach the page through
  area packs instead.

## Rigour and limits

- Distances, bearings (true), areas and rings are geodesic on WGS 84
  (GeographicLib), and lines are drawn as densified geodesics.
- The map is Web Mercator, so the scale bar is exact only at the centre
  latitude. As on a paper Mercator chart, the **latitude scale** down the left
  edge (shown with the graticule, north-up) is the distance scale that is valid
  everywhere: 1′ of latitude = 1 NM. When the scale varies by more than 1%
  across the view, a note says so on screen and in the PNG.
- Outside packs, depth shading covers the open sea only; lagoons, lakes and
  rivers are grey, with no depth source. Depth shading and isobaths come from a coarse DEM, not
  soundings. They end at the OSM coastline, but their shapes near the shore are
  only as good as the 1–2 km data, and sea the DEM calls dry is shown as the
  shallowest class. Packs carry 115–450 m gridded depths inside their frame.
- Packs are gridded bathymetry, not soundings. Their resolution is listed in the menu.
- **Not for navigation.**

## Privacy

`no-referrer`, and a Content-Security-Policy that allows only the CDN and the
tile hosts listed in `tools/deps.mjs`. Global tile requests still tell each
provider which area you are viewing. For sensitive areas, build the pack on a
machine where its one-off fetch is acceptable, then view it with the global
layers you don't need switched off: a hidden layer makes no requests.

## Dependencies

Loaded from jsDelivr at **pinned** versions with Subresource Integrity, via an
import map: MapLibre GL JS, maplibre-contour, geographiclib-geodesic.

```
node tools/deps.mjs           # pinned vs latest on npm
node tools/deps.mjs --write   # after changing a version in PINS: refetch, rehash, rewrite index.html
```

The import map's own hash goes into the CSP, so edit that block only through
the script.
