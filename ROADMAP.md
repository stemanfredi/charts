# Roadmap

What is known and not done yet. The app is the reference for what it does; this file
lists only what it does not do, or not well enough.

## Open

- **Legends for the Uses & areas overlays.** Wrecks, pipelines, installations, wind
  farms, military and protected areas are drawn with EMODnet's symbols, not explained
  on the map (cables have theirs). Their WMS gives legends (GetLegendGraphic): draw
  them as the substrate's and the cables' are, where they are classes.
- **Seabed habitats (EUSeaMap).** EMODnet Seabed Habitats' classification, listed in
  EDITO's catalogue (emodnet-euseamap_classification: WMS, Zarr, GeoParquet); its WMS
  (ows.emodnet-seabedhabitats.eu) did not answer when tried (2026-10-21). Retry; if it
  answers, a classed layer like the substrate.

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
- **A wind forecast.** The wind layer is a satellite observation, a day late;
  Copernicus Marine has no wind forecast, so wind over forecast waves is for past
  hours only. Another keyless source would be needed.
