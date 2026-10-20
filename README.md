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
| NASA daily | GIBS: MODIS / VIIRS true colour, MUR SST, chlorophyll-a | NASA open data | 250 m / 1 km; date picker, default yesterday UTC |

Every row in the menu has a ⋯ panel with the same provenance, and the
attribution line lists only the sources currently drawn.

Colour layers get a legend (bottom left, also in the PNG; *Legends* in the
menu hides them): depth shading uses the same colour stops as the map, and sea surface temperature uses the colour map NASA GIBS publishes for
the layer (0.15 °C classes), fetched once when first shown.

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
  shore (lower quartile over its polygon's vertices, remembered by OSM id so all
  tiles agree; the 8 m threshold sits above SRTM's noise, so the several OSM
  polygons of one liman agree). At sea level (≤ 8 m: limans, lagoons, harbour basins) it is shown flat
  in the shallowest class with no isobaths, because the DEM inside it is not a
  depth. Lakes above that are grey (no depth data). Over satellite no water colour is drawn at all: the image shows the water, with isobaths on top.
- Relief shading and land contours are drawn under the vector sea fill, so the
  fill cuts them exactly at the shore. The land DEM is not upsampled, because
  the slopes of an upsampled surface shade in visible facets.
- There are no EMODnet or GEBCO picture layers: their own land is baked into
  the image and cannot be cut away (see *Parked* for using their values).

## Rigour and limits

- Distances, bearings (true), areas and rings are geodesic on WGS 84
  (GeographicLib), and lines are drawn as densified geodesics.
- The map is Web Mercator, so the scale bar is exact only at the centre
  latitude. As on a paper Mercator chart, the **latitude scale** down the left
  edge (shown with the graticule, north-up) is the distance scale that is valid
  everywhere: 1′ of latitude = 1 NM. When the scale varies by more than 1%
  across the view, a note says so on screen and in the PNG.
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

