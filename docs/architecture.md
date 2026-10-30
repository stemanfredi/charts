# Architecture

A map of the code and the reasons for its shape. It names where each idea
lives, not what every file does: the code says that, with the reason for each
rule in a comment beside it.

## The shape in one paragraph

One static page, `site/`, served as it is. MapLibre draws a style that is
built at load from a catalogue of layers; a few layers are not fetched as
they are but made in the page, in a worker, from raw data. A drawing module
owns everything the user draws, as a document with its own file format. Two
exports describe the view from one snapshot of the page's state. Nothing
runs anywhere else: no backend, no keys, no build.

## Ideas that shape it

**The catalogue drives the page.** `site/catalog.js` is the one list of
layers: what each shows, where its tiles or data come from, its licence and
credits, its variants and periods. The menu, the map style (`site/style.js`),
the legends, the credits on screen and in the exports, and the tests all read
it. Adding a layer is adding an entry; a layer that needs its own behaviour
(time, depth, values as data) is a *kind*, a small object in `site/app.js`
that says what it does with the state.

**Every host in one place.** `site/hosts.js` lists every address the page may
reach. The catalogue builds its addresses from it, and the page's security
policy is generated from it (`tools/deps.mjs`), so a host the policy does not
name cannot be reached by mistake, and a copy of the site changes one line.

**One coastline.** Depth shading, isobaths, relief and land contours are
drawn from elevation tiles that the page cuts to the OpenStreetMap coastline
before MapLibre sees them (`site/clip.js`, in a Web Worker so the map stays
responsive). The sea's tiles are sampled from GEBCO's grid (`site/gebco.js`,
reading a Zarr store the project publishes); the land's come from a public
DEM. Inland water is classified per water body from the elevation along its
shore: at sea level, a lake with no depth, or a sea with its own surface
(the Caspian). The depths are drawn as GEBCO has them, no filter.

**Depths as data, not pictures.** Depth layers that come as images from their
providers are not used for the sea, because their land is baked in and cannot
be cut away. Reading the grid itself (`site/zarr.js`, a small Zarr reader
with Blosc) is also what lets the GIS export write real values, and a click
on the sea say its depth and how it was obtained.

**Geodesic measurement.** Every length, bearing and area is computed on the
WGS 84 ellipsoid (`site/geodesy.js`, GeographicLib). Lines are drawn as
densified geodesics, so the line on screen is the path the numbers describe.
The map is Web Mercator, so the scale bar is exact only at the centre
latitude, and the scale bar says so ("≈", in orange) when the scale varies
across the view.

**The drawing is a document.** `site/draw/document.js` holds points, lines,
areas, labels and groups as plain data, with a *look cascade*: an element
draws with its own look, else its group's, else the drawing's, else the
defaults. Operations on the document are pure functions; the map, the panel
and the file are views of it. The file is GeoJSON that any GIS opens, with
the app's own structure under one member (`site/draw/file.js`; the format in
[drawing-format.md](drawing-format.md)). Attachments (`attach.js`) keep line
ends on what they touch; rules (`generator.js`) keep copies along a line and
connections to roots linked to what they were made from. Drawings are saved
in the browser as they change and never sent.

**Display-only is kept apart from geometry.** What changes how a line is
drawn without changing where it is (an offset beside its path) is a look,
applied when the map's features are built (`features.js`), never written
into positions. Lengths and exports always come from the real geometry.

**One snapshot for every export.** The PNG and the GIS zip say what the map
shows from a single capture of the page's state (`snapshot` in
`site/app.js`): the view, the time and depth, each layer drawn with its
state, the credits. `site/gis.js` assembles the zip (a georeferenced picture,
each vector layer clipped to the view, elevation and data values as GeoTIFF,
a STAC item); `site/png.js` the picture with its text fields. Readers of the
files learn the same facts as a viewer of the screen.

**Visible failures.** A source that fails is marked in the Layers tab
instead of leaving blank tiles that could be read as data. An export that
fails, or leaves out values it could not read, says so on its button. A
drawing file that cannot be read says why.

**Privacy by construction.** No request carries a referrer; the security
policy limits the page to its own files and the listed hosts; libraries are
the page's own files, so no CDN sees a visit. Coordinates typed are parsed in
the page. The only data that leaves the browser is what a tile request
necessarily says, the area looked at, and the place name typed into search.

## Where to look

| For | Start at |
|---|---|
| The page, its state and the URL, legends, the time line | `site/app.js` |
| The frame: the bar, the side panels, a phone's sheet | `site/frame.js` |
| A layer: its sources, variants, legend, credits | `site/catalog.js`, then `site/style.js` |
| Elevation tiles, the coastline cut, inland water | `site/clip.js`, `site/gebco.js` |
| Copernicus layers, their times and depths | `site/cmems.js`, `site/values.js` |
| Readers and writers: Zarr, GeoTIFF, zip, PNG | `site/zarr.js`, `site/geotiff.js`, `site/zip.js`, `site/png.js` |
| The exports | `site/gis.js`, `site/export.js`, `snapshot` in `site/app.js` |
| The drawing's model, file and rules | `site/draw/document.js`, `file.js`, `generator.js` |
| The drawing on the map and in the panel | `site/draw/drawing.js`, `layers.js`, `features.js`, `panel.js` |
| Geodesy and map maths | `site/geodesy.js`, `site/geo.js` |
| The page's files and the offline areas kept for use without a connection | `site/sw.js`, `site/offline.js` |
| The data builds | `tools/gebco.mjs`, `tools/seagrass.mjs` |
| The tests | `test/`, described in [development.md](development.md) |
