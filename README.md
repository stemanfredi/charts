# Charts

A lean world chart in one static page: coastline, buildings, satellite,
bathymetry, isobaths, seamarks and NASA daily ocean imagery, all from open
sources that need no key. Geodesic ruler, area and range-ring tools.
The link reproduces the exact view. PNG export.

No build step, no backend, no API keys. Serve the folder from anywhere static
(GitHub Pages: *Settings → Pages → Deploy from branch → `main` / root*).

```
index.html   page shell; the CDN block is generated (see Dependencies)
style.css    all styling
catalog.js   sources, style layers in draw order, menu items, provenance
app.js       map, menu, URL state, graticule, source health, PNG export
measure.js   geodesic measurements (GeographicLib, WGS 84)
tools/deps.mjs  pin / hash / upgrade the CDN libraries
```

Run locally: `python3 -m http.server` in this folder, open http://localhost:8000.

## Layers

| Item | Source | Licence | Real resolution |
|---|---|---|---|
| Chart, coastline, roads, buildings, names, boundaries | OpenFreeMap (OpenStreetMap, OpenMapTiles schema) | ODbL | OSM; coastline generalised below zoom 7 |
| Satellite | EOX Sentinel-2 cloudless 2016 (default) / 2024 / Esri World Imagery | CC BY 4.0 / **CC BY-NC-SA 4.0** / Esri terms | 10 m / 10 m / ≤ 0.5 m |
| Depth shading, isobaths | AWS Terrain Tiles (Terrarium), contoured in the browser | open data | seabed ~1–2 km in open sea; hidden above zoom 12 |
| Relief shading, land contours | same DEM, land part | open data | SRTM 30 m |
| EMODnet bathymetry | EMODnet DTM base layer | CC BY 4.0 | ~115 m in European seas |
| GEBCO bathymetry | GEBCO latest grid (WMS) | public domain | ~450 m global |
| Seamarks | OpenSeaMap | CC BY-SA 2.0 | crowd-sourced |
| NASA daily | GIBS: MODIS / VIIRS true colour, MUR SST, chlorophyll-a | NASA open data | 250 m / 1 km; date picker, default yesterday UTC |

Every row in the menu has a ⋯ panel with the same provenance, and the
attribution line lists only the sources currently drawn.

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
  so the sea layers read zoom ≤ 10 tiles and overzoom, while land layers use zoom 12.

## Rigour and limits

- Distances, bearings (true), areas and rings are geodesic on WGS 84
  (GeographicLib), and lines are drawn as densified geodesics. The on-screen
  scale bar and the exported one are valid at the centre latitude only, because
  the map is Web Mercator.
- Depth shading and isobaths come from a DEM, not soundings. Near the coast they
  do not follow the OSM coastline exactly. Land below sea level (polders) can
  show as tinted.
- EMODnet and GEBCO rasters carry their own land rendering; they are not masked
  to the sea.
- **Not for navigation.**

## Privacy

`no-referrer`, and a Content-Security-Policy that allows only the CDN and the
tile hosts listed in `tools/deps.mjs`. Still, every tile request tells that
provider which area you are looking at. Tile providers cannot be kept from
seeing that. Don't use the public page for sensitive areas of interest.

## Dependencies

Loaded from jsDelivr at **pinned** versions with Subresource Integrity, via an
import map: MapLibre GL JS, maplibre-contour, geographiclib-geodesic.

```
node tools/deps.mjs           # pinned vs latest on npm
node tools/deps.mjs --write   # after changing a version in PINS: refetch, rehash, rewrite index.html
```

The import map's own hash goes into the CSP, so edit that block only through
the script.
