// Every host the page talks to, in one place: the code builds its addresses from these, and
// tools/deps.mjs writes the page's Content-Security-Policy from them (connect-src: tiles and data
// both come by fetch). Public addresses, seen by any visitor: nothing here is a secret. A copy of
// the site reading its own data changes them here.
export const HOSTS = {
  // what the map draws
  openfreemap: 'https://tiles.openfreemap.org', // the OpenStreetMap base, and the fonts
  terrain: 'https://s3.amazonaws.com/elevation-tiles-prod', // AWS Terrain Tiles (Terrarium)
  eox: 'https://tiles.maps.eox.at', // Sentinel-2 cloudless
  esri: 'https://server.arcgisonline.com', // World Imagery
  gibs: 'https://gibs.earthdata.nasa.gov', // NASA daily imagery
  openseamap: 'https://tiles.openseamap.org',
  emodnetHumanActivities: 'https://ows.emodnet-humanactivities.eu',
  copernicusWmts: 'https://wmts.marine.copernicus.eu',
  emodnetBathymetry: 'https://tiles.emodnet-bathymetry.eu', // EMODnet depth
  emodnetGeology: 'https://drive.emodnet-geology.eu', // seabed substrate
  arcgisTiles: 'https://tiles.arcgis.com', // the World Bank's world vessel density
  vliz: 'https://geo.vliz.be', // Marine Regions' maritime zones
  // data the page reads but does not draw from
  photon: 'https://photon.komoot.io', // place search
  // Copernicus Marine's datasets as data, on a GIS export (zarr.js): the STAC catalogue that says
  // where each dataset's Zarr store is, and the stores (EMODnet's depth model too)
  copernicusStac: 'https://stac.marine.copernicus.eu',
  cloudferro: 'https://s3.waw3-1.cloudferro.com',
  geodata: 'https://geodata.makaw.org', // GEBCO's depths and the seagrass tiles (tools/gebco.mjs, tools/seagrass.mjs)
};
// a host as a Content-Security-Policy source: its origin, or its path ending in /
export const cspSource = (base) => (new URL(base).pathname === '/' ? new URL(base).origin : `${base}/`);
