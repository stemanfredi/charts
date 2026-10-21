# Roadmap

What is known and not done yet. The app is the reference for what it does; this file
lists only what it does not do, or not well enough.

## Open

- **Legends for the Uses & areas overlays.** Wrecks, cables, pipelines, installations,
  wind farms, military and protected areas are drawn with EMODnet's symbols, not
  explained on the map. Their WMS gives legends (GetLegendGraphic): draw them as the
  substrate's are, where they are classes.
- **Seabed habitats (EUSeaMap).** EMODnet Seabed Habitats' classification, listed in
  EDITO's catalogue (emodnet-euseamap_classification: WMS, Zarr, GeoParquet); its WMS
  (ows.emodnet-seabedhabitats.eu) did not answer when tried (2026-10-21). Retry; if it
  answers, a classed layer like the substrate.

## Parked

- **Measure: editing a drawn measurement** (dragging its points); today it is deleted
  and drawn again.
- **Magnetic bearings.** Bearings are true (°T); magnetic ones need a model of the
  declination by place and year (WMM).
- **A wind forecast.** The wind layer is a satellite observation, a day late;
  Copernicus Marine has no wind forecast, so wind over forecast waves is for past
  hours only. Another keyless source would be needed.
