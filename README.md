# Charts

**[charts.makaw.org](https://charts.makaw.org)**

A chart of the world's seas in one web page. It draws the OpenStreetMap base
map with depth shading and isobaths, satellite imagery, seamarks, shipping
density, ocean data from Copernicus Marine and NASA's daily imagery, and lets
you measure and draw on it.

**Not for navigation.** Positions, coastlines and depths come from open
datasets of varying accuracy. Depths are a global elevation model, not
soundings.

## What you can do

Choose layers by task; each says where its data comes from, under what
licence, and how fine it is. Click the sea for its depth. Search a place or
type coordinates. Set one time for every layer that changes with time, and
one depth for the ocean variables. Measure distances, bearings and areas along
the real curve of the Earth, in kilometres or nautical miles. Draw points,
shapes of real size, lines, areas and labels; keep them in groups; attach
lines to what they touch; place copies along a line and connect them to
roots. Read a line's depth profile. Export the view as a picture, as GIS data
that QGIS opens, or your drawing as GeoJSON. Install the page as an app on a
phone.

Everything runs in your browser. There is no account, no key and no server
of its own: the page fetches each layer from its provider as you look at it.

## Privacy

Drawings stay in your browser and are never sent anywhere. The page keeps
its own files in your browser too, so that it opens without a connection. Tile requests
necessarily tell each provider which area you are looking at; a hidden layer
makes no request. Place names you type go to the search provider as you type,
with the map's centre to a tenth of a degree; coordinates are read in the
page. Your location, when you show it, stays in
the page. The About dialog in the page says the same, and each layer's ⓘ
names its provider.

## Hosting a copy

The page is static: the `site/` folder can be served by any web server, with
no build and nothing to install. What a copy inherits, and what it does not:

- **The providers are not yours.** Map tiles, imagery and ocean data are
  fetched from public services, each under its own terms. Most are open data
  with attribution; two are not: Esri's imagery is used under Esri's terms of
  use, and the 2024 Sentinel-2 mosaic allows no commercial use. Any provider
  may change its service, limit requests or go away, and a copy is bound by
  the same terms as this one. The list is in the page, behind each layer's ⓘ,
  and in [docs/development.md](docs/development.md).
- **The depths and the seagrass are served by this project itself,** from its
  own file storage. A copy must provide its own: the two build tools produce
  the files, and any static file host with public reads and cross-origin
  access serves them. The storage used here is one way among many; the
  address is a single line in `site/hosts.js`.
- **What a copy cannot promise:** that the providers stay available, or that
  the data is as current as the original. A source that fails is marked in
  the page rather than drawn blank.

How to set it up, test it and deploy it: [docs/development.md](docs/development.md).

## More

- [docs/architecture.md](docs/architecture.md): how the code is shaped, and why.
- [docs/drawing-ui.md](docs/drawing-ui.md) and
  [docs/drawing-format.md](docs/drawing-format.md): the drawing tools and
  their file.
- [docs/takeaways.md](docs/takeaways.md): what was learned the hard way.
- [ROADMAP.md](ROADMAP.md): what is open, what to research, what is not planned.

## Licence

The code is under GPL-3.0-or-later; see `LICENSE`. The libraries in
`site/vendor/` keep their own licences, copied beside them. Map data and
imagery stay under their providers' licences.
