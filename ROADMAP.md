# Roadmap

What is not done, and what has been decided about it. The page is the
reference for what it does; what was learned on the way is in
[docs/takeaways.md](docs/takeaways.md).

## Open

- **Inland water decided from its whole shore**, so that a lake or lagoon is
  the same at every zoom (the takeaway says what a version must do: read
  heights no finer than the view's, leave rivers per tile).
- **Smoothing where GEBCO's depths are estimated.** The *Depth sources* layer
  shows where depths are surveyed and where interpolated or predicted.
  Interpolated areas of sparse data can show the pattern of the data's own
  grid; smoothing only there would remove it without touching real detail.
  None seen so far: only if one appears.

## Land and mountains

What walkers and climbers need from a map, against the open data a keyless
page can read (researched 2026-10-24). Coverage is by country: each layer
would say which.

- **Next**
  - Official topographic maps, slope classes and winter routes as overlays,
    by country: swisstopo (maps, slopes over 30° in four classes, ski-touring
    routes, hiking trails; free with attribution) and basemap.at (CC BY 4.0);
    IGN France once the licence of its own layers is read; Kartverket (CC BY
    4.0, zooms 12–20 for display only).
  - A line's profile on land: ascent, descent and a walking time, from the
    elevation the relief shading draws, beside the depth profile.
  - GPX in and out: routes and tracks read as lines, the drawing's lines
    written as GPX.
- **To research before deciding**
  - Avalanche danger: Euregio's bulletins (CAAML v6 JSON) and EAWS's warning
    regions (GeoJSON), both readable from a page. Licences not read yet, and
    the data is safety-critical: only with the bulletin's date always shown
    and a link to the official one.
  - Trail tiles from OpenStreetMap: grades, trail visibility, via ferrata,
    huts, drinking water and springs, which the base map's tiles leave out. A
    build like the seagrass one, much larger; Overpass cannot serve a public
    map.
  - Offline areas: only from files published for download (this project's
    own builds, providers' extracts or sheets), never by caching third-party
    tiles past their terms; browser storage is best-effort and can be evicted.
  - Print with a grid: a paper map at a set scale, with a coordinate grid.
  - Detailed elevation in Switzerland (swissALTI3D, 0.5 and 2 m,
    cloud-optimised GeoTIFF): its catalogue says "proprietary" where the
    open-data terms say free; to reconcile first. Swiss grid: reprojected in
    the page or in a build.
- **Not planned**: weather forecasts (open only as model files, GRIB or
  NetCDF, which need a build and a server-like pipeline); hut availability and
  current route conditions (no open source); OpenTopoMap (an intermediary).

## Sea: ideas, each with what holds it back

- **Seabed habitats (EUSeaMap 2025, MSFD broad habitat types).** EMODnet
  Seabed Habitats' WMS draws a tile in minutes or not at all and its tile
  cache keeps nothing (2026-10-22), so a live layer would stay blank. The
  data is 2.4 million polygons: built into tiles and published like the
  seagrass, if that build proves worth it, or live if the service speeds up.
- **Detailed world vessel density, by vessel type.** The world layer is the
  World Bank's own tiles: all vessels, coarse. Its data (World Bank and IMF,
  2015–2021, 0.005°, CC BY 4.0, by vessel class) comes as GeoTIFFs only: tiles
  would be built from them and published with the site (zooms 0–7, an
  estimated 150–250 MB). EMODnet's density by ship type and EMSA's route
  density come as GeoTIFFs and OGC services too (CC BY 4.0); Global Fishing
  Watch has fishing effort behind a free token; raw AIS for national waters:
  Marine Cadastre (US), the Danish Maritime Authority.
- **GMTDS world density, monthly to 2024** (NGA, by MapLarge): keyless and
  readable from a page, but its terms conflict (CC BY 4.0 for authorised
  downloads, services by request, site terms forbidding public display).
  Only with written permission.
- **NOAA charts (US waters)** as an overlay; **survey-grade depths in US
  waters (NOAA BlueTopo)**, GeoTIFFs in local UTM projections, which need a
  reader and reprojection in the page.
- **The base map from OpenStreetMap's own vector tiles** instead of
  OpenFreeMap: the same data, another schema (no sea names), limited capacity.
- **Place search from Nominatim** instead of Photon: its usage policy rules
  out search as you type.
- **Tides**: no keyless worldwide source found; NOAA's (US only) refused an
  automated check.
- **A wind forecast**: the wind layer is a satellite observation, a day late;
  Copernicus Marine has no wind forecast. Another keyless source is needed.
- **Magnetic bearings**: bearings are true; magnetic ones need a declination
  model by place and year (WMM).

## Drawing

- **A drawing as a viewer page**: a standalone HTML file holding the map and
  the elements visible at that moment, with a box to show and hide them and
  no editing, to show a drawing to someone without the app (a link never
  carries a drawing).
- **Counts and lengths as a spreadsheet**: one row per element (kind, name,
  group, properties, length, area) and a sheet of the totals the app already
  shows, by group or by any property; XLSX with the zip writer, or CSV.
- **Clip to sea**: a switch on a point and on an area, for the map only, so
  radii, sectors and areas are drawn only where they cover the sea, cut at the
  coast the map draws; the inspector would show the whole area and its part
  at sea; exports keep the whole shapes. The coast must be fetched for the
  element's box at a zoom fit for its size and unioned from tile pieces, and
  the sea polygon reader lives in the clipping worker: a step's worth of work
  for a display nicety.
- **One drawing order across kinds** *(to be confirmed)*: the tree's order
  deciding which element covers which whatever their kind (a line under an
  area, a circle over a rectangle), as drawing tools and desktop GIS do. Now
  the order holds within a kind and the stacking between kinds is fixed
  (drawing-ui.md §7). It means a pair of map layers per element, in the
  tree's order, as areas already have (layers.js slotLayers): simple, but
  the layer count grows with the drawing, so it would need a cap past which
  the fixed stack comes back, and hit-testing reads many layers.
