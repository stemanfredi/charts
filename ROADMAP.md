# Roadmap

What is known and not done yet. The app is the reference for what it does; this file
lists only what it does not do, or not well enough.

## Open

- **Seabed habitats (EUSeaMap).** EMODnet Seabed Habitats' classification, listed in
  EDITO's catalogue (emodnet-euseamap_classification: WMS, Zarr, GeoParquet); its WMS
  (ows.emodnet-seabedhabitats.eu) did not answer when tried (2026-10-21). Retry; if it
  answers, a classed layer like the substrate.

- **Where depths come from (GEBCO type identifier).** For every 15″ cell, how its depth was
  obtained: surveyed (multibeam, single-beam, soundings), indirect (predicted from satellite
  gravity, interpolated, from charts) or unknown. Published beside the depths, at
  `geodata.makaw.org/gebco-2026/tid.zarr/` (the same levels; a coarse cell takes the most
  common source, the less certain on a tie). Once Charts reads GEBCO's depths:
  - a layer or legend showing where depths are measured and where estimated;
  - smoothing only where they are estimated: the regular rings in flat seas (Gulf of Panama)
    could not be told from real detail by the depths alone;
  - the source codes beside the depths in the GIS export.

## Parked

- **Measure: editing a drawn measurement** (dragging its points); today it is deleted
  and drawn again.
- **Magnetic bearings.** Bearings are true (°T); magnetic ones need a model of the
  declination by place and year (WMM).
- **Detailed world vessel density, by vessel type.** The world layer is the World Bank's
  own tiles: all vessels, coarse. Its data (World Bank and IMF, 2015–2021, 0.005°, CC BY
  4.0: commercial, fishing, passenger, leisure, oil and gas) comes as GeoTIFFs only
  (510 MB zip for all vessels): tiles would be built from them and published with the site
  (z0–7 PNG, estimated 150–250 MB; PMTiles, a ~8 KB library, or plain folders; files under
  100 MB for GitHub Pages).
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
