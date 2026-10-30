# Takeaways

Conclusions reached the hard way, kept so they are not reached twice. Each is
a fact about this project as it stands, with its date; the story behind it is
in the history, not here.

- **GEBCO's grid needs no clean-up before drawing** (2026-10). The filters
  written for a tile-based DEM (filling small pits, blurring tile seams,
  filling dry blocks) all addressed that DEM's defects. Sampled with one
  spline from the same cells, GEBCO tiles join at their edges by construction,
  show no false pits and agree across zooms. The check that proves it runs
  weekly (`npm run tiles-check`).

- **A tile-based DEM is not a source of sea depths** (2026-10). Its
  bathymetry stops at a zoom, its sea is filled with zero in blocks, and its
  land and sea sources meet in false pits and peaks at the coast. Reading a
  bathymetric grid directly, as data, removed all of it.

- **Inland water classified per tile can differ by zoom** (2026-10-26). A
  lake or lagoon is judged from the shore vertices in the first tile that
  asks, within an 8 m margin, so a large liman may be "at sea level" at one
  zoom and "a lake" at another when the page opens there first. Deciding
  from the whole shoreline, read at the zoom where the body fits in one tile,
  makes every zoom agree, but costs ancestor tiles and finer depth chunks
  (up to about 3 MB more on the north Caspian) and is wrong for rivers, whose
  banks are one polygon for a long way. A version that keeps the cost down
  must read heights no finer than the view's and leave rivers per tile.

- **Line offsets belong to the renderer** (2026-10). Drawing lines apart by
  computing new geometry needed a page of heuristics and still met at shared
  ends badly. A signed pixel offset per line, applied by MapLibre as GIS
  tools do, is a number the user sets and nothing to maintain.

- **The deploy must know its own version** (2026-10). Telling a visitor that
  a newer version is published works only if the page carries the commit it
  was built from; reading a version file at load logs a 404 on every local
  copy and cannot tell the page's own version from the latest. The notice was
  cut later (2026-10-28): with no service worker, a reload gets the latest.
  It came back with the service worker (2026-10-30), from the worker itself:
  a new version waits until the page applies it.

- **A double scale bar costs a row** (2026-10). Two stacked bars made the
  bottom of the screen a row taller, and everything above it sat high,
  wrongly on a phone. One bar in the chosen units is enough on screen; the
  picture export keeps both.

- **Survey-grade depths in selected areas were not worth keeping** (2025).
  Built as "area packs" and set aside because regular users could not obtain
  the source data. The last working version is the tag `parked/area-packs`.
