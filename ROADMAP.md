# Roadmap

What is known and not done yet. The app is the reference for what it does; this file
lists only what it does not do, or not well enough.

## Open

- **Smoothing where GEBCO's depths are estimated.** The layer *Depth sources (GEBCO)* shows,
  from GEBCO's type identifier grid, where depths are surveyed and where interpolated or
  predicted. Interpolated areas of sparse data can still show patterns of the data's own grid
  (as Terrarium's Gulf of Panama did): smoothing them there, and never where depths are
  surveyed, would remove those without touching real detail. None seen with GEBCO so far:
  only if one appears.

## Land and mountains

What walkers and climbers need from a map, against the open data that a keyless page can read
(researched 2026-10-24). Coverage is by country: each layer says which.

- **Next:**
  - **Official topographic maps, slope classes and winter routes,** as overlays, by country:
    swisstopo (maps, slopes over 30° in four classes, ski-touring routes, hiking trails; free with
    attribution) and basemap.at (CC BY 4.0); IGN France (maps, slopes, winter routes) once the
    licence of its own layers is read; Kartverket (CC BY 4.0, its zooms 12–20 for display only).
  - **A line's profile on land:** ascent, descent and a walking time, from the elevation the
    relief shading draws, beside the depth profile.
  - **GPX in and out:** routes and tracks read as lines, the drawing's lines written as GPX.
- **To research before deciding:**
  - **Avalanche danger:** Euregio's bulletins (CAAML v6 JSON) and EAWS's warning regions
    (GeoJSON), both readable from a page. Their licences are not read yet, and the data is
    safety-critical: only with the bulletin's date always shown and a link to the official one.
  - **Trail tiles from OpenStreetMap:** grades (`sac_scale`), trail visibility, via ferrata, huts,
    drinking water and springs, which the base map's tiles leave out. A build like seagrass's,
    much larger; Overpass cannot serve a public map.
  - **Offline areas:** only from files published for download (this project's own builds,
    providers' extracts or sheets), never by caching third-party tiles past their terms; browser
    storage is best-effort and can be evicted.
  - **Print with a grid:** a paper map at a set scale, with a coordinate grid.
  - **Detailed elevation in Switzerland (swissALTI3D, 0.5 and 2 m, cloud-optimised GeoTIFF):**
    its catalogue says "proprietary" where the open-data terms say free; to reconcile first. Swiss
    grid: reprojected in the page or in a build.
- **Not planned:** weather forecasts (open only as model files, GRIB or NetCDF, which need a
  build and a server-like pipeline); hut availability and current route conditions (no open
  source); OpenTopoMap (an intermediary).

## Parked

- **Seabed habitats (EUSeaMap 2025, MSFD broad habitat types).** EMODnet Seabed Habitats' WMS
  (ows.emodnet-seabedhabitats.eu, CORS `*`, a clean JSON legend of about 30 classes) draws each
  tile in 1–3 minutes or not at all, and its tile cache (WMTS) keeps nothing (2026-10-22): a live
  layer would stay blank. The data is 2.4 million polygons: built into tiles and published with
  geodata.makaw.org, as seagrass is, if seagrass shows that build to be worth it; or live, if
  EMODnet speeds up its service.
- **Draw: a drawing as a viewer page.** Export a standalone HTML page holding only the map and the
  elements visible at that moment, with a box to show and hide them, and no editing: a way to show a
  drawing to someone without the app, as a file (a link never carries a drawing). Only what is
  visible goes in.
- **Draw: counts and lengths as a spreadsheet.** One row per element (kind, name, group, its
  properties, length, area), and a sheet of the totals the app already shows, by group or by any
  property: XLSX written with the GIS export's ZIP writer (`site/zip.js`), or CSV.
- **Draw: clip to sea.** A switch on a point and on an area, for the map only: radii, sectors and
  areas drawn only where they cover the sea, cut at the coast the map draws (OSM sea polygons, as
  depth shading's; lagoons and lakes classified as `clip.js` does); the inspector shows the whole
  area and its part at sea; exports keep the whole shapes. The coast fetched for the element's box
  at a zoom fit for its size, so the values do not change as the map zooms (coarse for large
  circles). The geometry arrives after the map draws
  (a cache, redrawn when ready), tile pieces must be unioned (polygon-clipping, lazy already), and the
  sea polygon reader lives in the clipping worker; about a step's worth of work for a display nicety.
- **Magnetic bearings.** Bearings are true (°T); magnetic ones need a model of the
  declination by place and year (WMM).
- **Detailed world vessel density, by vessel type.** The world layer is the World Bank's
  own tiles: all vessels, coarse. Its data (World Bank and IMF, 2015–2021, 0.005°, CC BY
  4.0: commercial, fishing, passenger, leisure, oil and gas) comes as GeoTIFFs only
  (510 MB zip for all vessels, datacatalog.worldbank.org dataset 0037580): tiles would be built from
  them and published with the site (z0–7 PNG, estimated 150–250 MB; PMTiles, a ~8 KB library, or
  plain folders; files under 100 MB for GitHub Pages). EMODnet's own density (hours per km² per month
  by ship type, 2017–2024) and EMSA's route density come as GeoTIFFs and OGC services too, CC BY 4.0
  (emodnet.ec.europa.eu/en/human-activities); Global Fishing Watch has fishing effort behind a free
  token; raw AIS for national waters: Marine Cadastre (US), the Danish Maritime Authority.
- **GMTDS world density, monthly to 2024** (NGA, by MapLarge: WMS/WMTS at
  gmtds.maplarge.com, keyless and readable from a page). Its terms conflict: CC BY 4.0
  for authorised downloads, services by request, site terms forbidding public display.
  Only with their written permission (gmtds@maplarge.com).
- **NOAA charts (US waters).** NOAA's official chart service, as an overlay.
- **Survey-grade depths in US waters (NOAA BlueTopo).** Depth files from surveys,
  GeoTIFFs in local UTM projections: the page would need a reader and reprojection.
- **The base map from OpenStreetMap's own vector tiles** (OSM Foundation, since 2025), instead
  of OpenFreeMap: the same OSM data, another schema (no sea names), limited capacity.
- **Place search from Nominatim** (OSM's own) instead of Photon: its usage policy rules out
  search as you type.
- **Tides.** No keyless worldwide source found; NOAA's (US only) refused an automated check.
- **A wind forecast.** The wind layer is a satellite observation, a day late;
  Copernicus Marine has no wind forecast, so wind over forecast waves is for past
  hours only. Another keyless source would be needed.
