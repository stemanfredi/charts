#!/usr/bin/env python3
"""Build an area pack: survey-grade depths and an exact coastline for one frame.

The pack is one GeoJSON file, opened in the page ("Open pack…" or drag and
drop). It is read in the browser and never uploaded:
  sea      all water in the frame (sea, lagoons, lakes, rivers); drawn as "no depth data"
  land     OSMData land polygons minus OSM inland water, clipped to the frame
  band     water deeper than d metres (d = 0 and every depth contour), stacked
  isobath  depth contour at d metres, clipped to the water
  frame    the frame outline, so the page shows where pack data stops

Water: the OSMData coastline puts lagoons and estuaries behind barrier islands
on land, so OSM inland water (the OpenFreeMap `water` polygons the page draws)
is cut out of the land: a lagoon gets depths, a lake without data says so.
Depths: EMODnet DTM 2024 (~115 m) where it covers the frame's water, with gaps
filled from GEBCO; GEBCO elsewhere (2020 grid from NOAA ERDDAP, or your own
GEBCO GeoTIFF with --gebco). Contours are traced on the unmasked grid and then
clipped to the water, so they reach the true shore without gaps.
All geometry work runs in a Transverse Mercator centred on the frame (metres),
and the result is written in WGS 84.

Setup once:   python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
Build:        .venv/bin/python tools/build_pack.py spezia --center 44.075,9.86 --half-w-km 8
"""
import argparse
import gzip
import hashlib
import json
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import contourpy
import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Polygon, box, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"

# Nautical depth contours (metres); majors drawn heavier, labelled ones carry a depth label.
LEVELS = [2, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 1500, 2000, 3000, 4000, 5000, 6000]
MAJOR = {10, 20, 50, 100, 200, 500, 1000, 2000}
LABEL = {5, 10, 20, 50, 100, 200, 500, 1000, 2000, 3000, 4000, 5000}

EMODNET = ("https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024", "EMODnet DTM 2024", "1/16′ (~115 m)",
           "EMODnet Bathymetry Consortium (2024): EMODnet Digital Bathymetry (DTM 2024), CC BY 4.0")
GEBCO = ("https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020", "GEBCO 2020 grid", "15″ (~450 m)",
         "GEBCO Compilation Group (2020): GEBCO 2020 Grid")
LAND_URL = "https://osmdata.openstreetmap.de/download/land-polygons-complete-4326.zip"
OMT_TILEJSON = "https://tiles.openfreemap.org/planet"
INLAND_SKIP = {"ocean", "swimming_pool"}  # ocean comes from the land polygons themselves
# Water bodies OSM maps with a coastline whose surface is not at sea level: depths are
# measured from that surface (same table as DATUMS in clip.js).
DATUMS = [("Caspian Sea", (46.5, 36.5, 55.2, 47.4), -28.0)]
MAX_CELLS = 1_500_000  # per ERDDAP request; larger frames are fetched with a stride
UA = {"User-Agent": "charts-build-pack/1 (static chart area packs)"}


def http(url, timeout=120, **headers):
    return urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **headers}), timeout=timeout)


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("name", help="pack name (file name and title)")
    p.add_argument("--center", required=True, help="LAT,LON of the frame centre (write --center=-1.2,116.8 for southern latitudes)")
    p.add_argument("--half-w-km", type=float, required=True, help="half the frame width, km")
    p.add_argument("--aspect", type=float, default=2 / 3, help="frame height / width (default 2/3)")
    p.add_argument("--source", default="auto", choices=["auto", "emodnet", "gebco"], help="depth source")
    p.add_argument("--gebco", help="local GEBCO GeoTIFF to use instead of GEBCO 2020 (needs rasterio)")
    p.add_argument("--gebco-label", default="GEBCO grid (local file)", help="credit line for --gebco")
    p.add_argument("--land", help="OSMData land_polygons.shp (default: downloaded into .cache/)")
    p.add_argument("--detail-m", type=float, default=1.0,
                   help="coastline wiggles below this are smoothed; also the simplification tolerance (default 1 m)")
    p.add_argument("--out", help="output file (default packs/NAME.geojson)")
    p.add_argument("--gzip", action="store_true", help="write NAME.geojson.gz")
    return p.parse_args()


def reproject(t):
    """Geometry function applying pyproj transformer t to every coordinate (vectorised)."""
    return lambda g: shapely.transform(g, lambda xy: np.column_stack(t.transform(xy[:, 0], xy[:, 1])))


# ── frame ──────────────────────────────────────────────────────────────────

def frame_of(lat, lon, half_w_km, aspect):
    crs = f"+proj=tmerc +lat_0={lat:.10f} +lon_0={lon:.10f} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
    fwd = Transformer.from_crs(4326, crs, always_xy=True)
    inv = Transformer.from_crs(crs, 4326, always_xy=True)
    hw, hh = half_w_km * 1000, half_w_km * 1000 * aspect
    frame = box(-hw, -hh, hw, hh)
    # sample the whole outline: in TMerc parallels bow, corners alone under-cover the edges
    xs, ys = np.asarray(frame.exterior.segmentize(hw / 32).coords).T
    lons, lats = inv.transform(xs, ys)
    eps = 0.01
    return fwd, inv, frame, (lons.min() - eps, lats.min() - eps, lons.max() + eps, lats.max() + eps)


# ── depth grids ────────────────────────────────────────────────────────────

def erddap_grid(base, bb):
    w, s, e, n = bb
    key = hashlib.sha1(f"{base}{bb}".encode()).hexdigest()[:16]
    cached = CACHE / f"grid_{key}.npz"
    if cached.exists():
        z = np.load(cached)
        return z["lon"], z["lat"], z["z"]
    # estimate the cell count from a 1-cell probe of the grid spacing
    step = 1 / 960 if "emodnet" in base else 1 / 240
    stride = max(1, int(np.ceil(np.sqrt(((e - w) / step) * ((n - s) / step) / MAX_CELLS))))
    q = f"elevation[({s}):{stride}:({n})][({w}):{stride}:({e})]"
    url = f"{base}.json?{urllib.parse.quote(q, safe='():[]')}"
    print(f"  fetching {base.rsplit('/', 1)[-1]} (stride {stride}) …", flush=True)
    with http(url, timeout=300) as r:
        rows = json.load(r)["table"]["rows"]
    a = np.array([[np.nan if v is None else v for v in row] for row in rows], dtype=float)
    lat, lon = np.unique(a[:, 0]), np.unique(a[:, 1])
    z = np.full((lat.size, lon.size), np.nan)
    z[np.searchsorted(lat, a[:, 0]), np.searchsorted(lon, a[:, 1])] = a[:, 2]
    CACHE.mkdir(exist_ok=True)
    np.savez_compressed(cached, lon=lon, lat=lat, z=z)
    return lon, lat, z


def geotiff_grid(path, bb):
    import rasterio
    from rasterio.windows import from_bounds
    with rasterio.open(path) as src:
        win = from_bounds(*bb, src.transform).round_offsets().round_lengths()
        z = src.read(1, window=win, masked=True).astype(float).filled(np.nan)
        t = src.window_transform(win)
    lon = t.c + t.a * (np.arange(z.shape[1]) + 0.5)
    lat = t.f + t.e * (np.arange(z.shape[0]) + 0.5)
    return lon, lat[::-1], z[::-1]


def bilinear(lon, lat, z, qlon, qlat):
    """Sample grid z(lat, lon) at the points of a (qlat × qlon) mesh."""
    fi = np.interp(qlat, lat, np.arange(lat.size))
    fj = np.interp(qlon, lon, np.arange(lon.size))
    i0, j0 = np.floor(fi).astype(int), np.floor(fj).astype(int)
    i1, j1 = np.minimum(i0 + 1, lat.size - 1), np.minimum(j0 + 1, lon.size - 1)
    di, dj = (fi - i0)[:, None], (fj - j0)[None, :]
    return ((1 - di) * (1 - dj) * z[np.ix_(i0, j0)] + (1 - di) * dj * z[np.ix_(i0, j1)]
            + di * (1 - dj) * z[np.ix_(i1, j0)] + di * dj * z[np.ix_(i1, j1)])


def depth_grid(a, bb, fwd, ocean, inland):
    """Depth grid for the frame. GEBCO is used only in the open sea: in lagoons and
    lakes it can be off by metres (Venice lagoon: GEBCO 10 m, EMODnet 1 m), so inland
    water without EMODnet data is left empty and the page shows it as "no depth data"."""
    def where(geom, lon, lat):
        lon2, lat2 = np.meshgrid(lon, lat)
        return shapely.contains_xy(geom, *fwd.transform(lon2, lat2)) if not geom.is_empty else np.zeros(lon2.shape, bool)

    if a.gebco:
        g = geotiff_grid(a.gebco, bb)
        gname, gres, gcredit = a.gebco_label, "file resolution", a.gebco_label
    else:
        g = erddap_grid(GEBCO[0], bb)
        _, gname, gres, gcredit = GEBCO
    gebco_only = lambda: ((g[0], g[1], np.where(where(inland, g[0], g[1]), np.nan, g[2])),  # noqa: E731
                          dict(source=gname, resolution=gres, credit=gcredit))
    if a.source == "gebco":
        return gebco_only()
    try:
        e = erddap_grid(EMODNET[0], bb)
    except Exception as err:  # outside coverage or service down
        if a.source == "emodnet":
            raise
        print(f"  EMODnet unavailable ({err}); using {gname}")
        return gebco_only()
    # EMODnet is null on land and outside its coverage: measure it on the OSM open sea
    sea = where(ocean, e[0], e[1])
    have = np.isfinite(e[2])
    cover = have[sea].mean() if sea.any() else 0.0
    if a.source == "auto" and cover < 0.9:
        print(f"  EMODnet covers {cover:.0%} of the open sea here; using {gname}")
        return gebco_only()
    gz = bilinear(*g, e[0], e[1])
    fill = ~have & sea
    z = np.where(have, e[2], np.where(fill, gz, np.nan))
    _, ename, eres, ecredit = EMODNET
    note = f", {int(fill.sum())} open-sea gap cells from {gname}" if fill.any() else ""
    return (e[0], e[1], z), dict(source=ename + note, resolution=eres,
                                  credit=ecredit + (f" · {gcredit}" if fill.any() else ""))


# ── land ───────────────────────────────────────────────────────────────────

def land_path(a):
    if a.land:
        return Path(a.land)
    shp = CACHE / "land-polygons-complete-4326" / "land_polygons.shp"
    if not shp.exists():
        CACHE.mkdir(exist_ok=True)
        z = CACHE / "land-polygons-complete-4326.zip"
        print(f"  downloading OSMData land polygons (~900 MB, once) to {z} …", flush=True)
        with http(LAND_URL, timeout=600) as r, open(z, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(CACHE)
        z.unlink()
    return shp


def land_geom(a, bb, fwd, frame):
    from pyogrio.raw import read
    _, _, wkb, _ = read(land_path(a), bbox=bb, columns=[])
    clip = box(*bb)
    # clip in lat/lon first: continent-scale polygons do not survive a local projection
    parts = [shapely.from_wkb(g).intersection(clip) for g in wkb]
    ll = unary_union([p for p in parts if not p.is_empty])
    if ll.is_empty:
        return ll
    land = reproject(fwd)(ll).intersection(frame)
    d = a.detail_m
    opened = land.buffer(-d).buffer(d)  # drop sub-detail wiggles, keep the shape
    return (opened if not opened.is_empty else land).intersection(frame)


# ── grid helpers ───────────────────────────────────────────────────────────

def fill_from_neighbours(a, max_steps=200):
    """Fill NaN cells with the mean of their filled 4-neighbours, ring by ring.
    Returns (filled grid, steps from real data: 0 = measured, 1 = adjacent, …)."""
    f = a.copy()
    reach = np.where(np.isfinite(f), 0, np.iinfo(np.int32).max).astype(np.int32)
    for step in range(1, max_steps + 1):
        nan = ~np.isfinite(f)
        if not nan.any():
            break
        p = np.pad(f, 1, constant_values=np.nan)
        nb = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
        cnt = np.isfinite(nb).sum(0)
        new = nan & (cnt > 0)
        if not new.any():
            break
        f[new] = np.nansum(nb, 0)[new] / cnt[new]
        reach[new] = step
    return np.where(np.isfinite(f), f, 0.0), reach


def cell_region(lon, lat, field, level):
    """Area where field > level, traced with marching squares (smooth, not cell-stepped), in lon/lat."""
    if not (field > level).any():
        return Polygon()
    g = contourpy.contour_generator(lon, lat, field, fill_type=contourpy.FillType.OuterOffset)
    polys = []
    for pts, offs in zip(*g.filled(level, 1e9)):
        rings = [pts[offs[i]:offs[i + 1]] for i in range(len(offs) - 1)]
        if len(rings[0]) >= 4:
            polys.append(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4]).buffer(0))
    return unary_union(polys) if polys else Polygon()


# ── inland water (OpenFreeMap / OpenMapTiles `water` layer) ─────────────────

def _varint(b, p):
    v = s = 0
    while True:
        c = b[p]; p += 1
        v |= (c & 0x7F) << s; s += 7
        if not c & 0x80:
            return v, p


def _fields(b):
    p = 0
    while p < len(b):
        key, p = _varint(b, p)
        f, w = key >> 3, key & 7
        if w == 0:
            v, p = _varint(b, p)
        elif w == 2:
            n, p = _varint(b, p); v = b[p:p + n]; p += n
        elif w == 1:
            v = b[p:p + 8]; p += 8
        elif w == 5:
            v = b[p:p + 4]; p += 4
        else:
            raise ValueError(f"wire type {w}")
        yield f, v


def _packed(b):
    out, p = [], 0
    while p < len(b):
        v, p = _varint(b, p); out.append(v)
    return out


def water_polygons(tile):
    """(class, [rings in tile units]) for each polygon feature of the MVT `water` layer."""
    for f, layer in _fields(tile):
        if f != 3:
            continue
        name, feats, keys, values, extent = "", [], [], [], 4096
        for lf, v in _fields(layer):
            if lf == 1: name = bytes(v).decode()
            elif lf == 2: feats.append(v)
            elif lf == 3: keys.append(bytes(v).decode())
            elif lf == 4: values.append(next((bytes(x).decode() for vf, x in _fields(v) if vf == 1), None))
            elif lf == 5: extent = v
        if name != "water":
            continue
        ck = keys.index("class") if "class" in keys else -1
        for fb in feats:
            tags, ftype, geom = [], 0, []
            for ff, v in _fields(fb):
                if ff == 2: tags = _packed(v)
                elif ff == 3: ftype = v
                elif ff == 4: geom = _packed(v)
            if ftype != 3:
                continue
            cls = next((values[tags[i + 1]] for i in range(0, len(tags), 2) if tags[i] == ck), None)
            rings, ring, x, y, i = [], None, 0, 0, 0
            while i < len(geom):
                cmd = geom[i]; i += 1
                cid, n = cmd & 7, cmd >> 3
                if cid == 7:
                    if ring: rings.append(ring)
                    ring = None
                    continue
                for _ in range(n):
                    dx, dy = geom[i], geom[i + 1]; i += 2
                    x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1)
                    if cid == 1:
                        if ring: rings.append(ring)
                        ring = [(x, y)]
                    else:
                        ring.append((x, y))
            if ring:
                rings.append(ring)
            yield cls, extent, rings


def inland_water(bb, fwd, frame):
    """Union of OSM inland water (lagoons, lakes, rivers, docks) in the frame, in metres."""
    w, s, e, n = bb
    tj = json.load(http(OMT_TILEJSON, timeout=60))
    tz = min(int(tj.get("maxzoom", 14)), 13)
    while tz > 8:  # keep the tile count reasonable for large frames
        x0, x1 = (int((v + 180) / 360 * 2 ** tz) for v in (w, e))
        y0, y1 = (int((1 - np.arcsinh(np.tan(np.radians(v))) / np.pi) / 2 * 2 ** tz) for v in (n, s))
        if (x1 - x0 + 1) * (y1 - y0 + 1) <= 64:
            break
        tz -= 1
    print(f"  fetching OSM inland water ({(x1 - x0 + 1) * (y1 - y0 + 1)} tiles, zoom {tz}) …", flush=True)
    polys = []
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            cached = CACHE / f"omt_{tz}_{tx}_{ty}.pbf"
            if cached.exists():
                data = cached.read_bytes()
            else:
                with http(tj["tiles"][0].format(z=tz, x=tx, y=ty), **{"Accept-Encoding": "gzip"}) as r:
                    data = r.read()
                    if r.headers.get("Content-Encoding") == "gzip" or data[:2] == b"\x1f\x8b":
                        data = gzip.decompress(data)
                CACHE.mkdir(exist_ok=True)
                cached.write_bytes(data)
            for cls, extent, rings in water_polygons(data):
                if cls in INLAND_SKIP or not rings:
                    continue
                def ll(r):
                    X = (tx + np.array([p[0] for p in r]) / extent) / 2 ** tz
                    Y = (ty + np.array([p[1] for p in r]) / extent) / 2 ** tz
                    return np.column_stack(fwd.transform(X * 360 - 180, np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * Y))))))
                # MVT: exterior rings and holes have opposite winding; rebuild polygons from their order
                cur = None
                for r in rings:
                    if len(r) < 4:
                        continue
                    ring = shapely.LinearRing(ll(r))
                    if cur is None or ring.is_ccw == cur[0].is_ccw:
                        if cur: polys.append(Polygon(cur[0], cur[1:]).buffer(0))
                        cur = [ring]
                    else:
                        cur.append(ring)
                if cur:
                    polys.append(Polygon(cur[0], cur[1:]).buffer(0))
    return unary_union(polys).intersection(frame) if polys else Polygon()


# ── build ──────────────────────────────────────────────────────────────────

def main():
    a = parse_args()
    lat, lon = (float(v) for v in a.center.split(","))
    fwd, inv, frame, bb = frame_of(lat, lon, a.half_w_km, a.aspect)
    print(f"{a.name}: {lat:.5f}, {lon:.5f} · {2 * a.half_w_km:g} × {2 * a.half_w_km * a.aspect:g} km", flush=True)

    land = land_geom(a, bb, fwd, frame)
    ocean = frame.difference(land) if not land.is_empty else frame
    inland = inland_water(bb, fwd, frame).difference(ocean)
    if not inland.is_empty:
        land = land.difference(inland)
    sea = ocean.union(inland)  # all water
    (glon, glat, z), meta = depth_grid(a, bb, fwd, ocean, inland)

    # depth below the local water surface (0 m except in the DATUMS water bodies)
    lon2, lat2 = np.meshgrid(glon, glat)
    surface = np.zeros_like(z)
    datum_note = []
    for name, (dw, ds, de, dn), h0 in DATUMS:
        inside = (lon2 >= dw) & (lon2 <= de) & (lat2 >= ds) & (lat2 <= dn)
        if inside.any():
            surface[inside] = h0
            datum_note.append(f"{name} depths from its {h0:g} m surface")
    depth = surface - z
    dmax = float(np.nanmax(depth)) if np.isfinite(depth).any() else 0.0
    levels = [lv for lv in LEVELS if lv < dmax]
    band_levels = [0] + levels  # band 0: any valid depth; water outside it has no depth data
    # Empty cells are filled from their neighbours before contouring, so contours do not
    # step around them. Water more than one cell from real data is then cut out as
    # "no depth data", traced on the has-data field so its edge is smooth too.
    filled, reach = fill_from_neighbours(depth)
    gen = contourpy.contour_generator(glon, glat, filled,
                                      line_type=contourpy.LineType.Separate,
                                      fill_type=contourpy.FillType.OuterOffset)
    nodata = cell_region(glon, glat, (reach > 1).astype(float), 0.5)
    to_m, to_ll = reproject(fwd), reproject(inv)
    nodata = to_m(nodata) if not nodata.is_empty else nodata
    wet = sea.difference(nodata) if not nodata.is_empty else sea  # water with depth
    tol = a.detail_m
    feats = []

    def add(kind, geom, **props):
        if geom is None or geom.is_empty:
            return
        # keep only the geometry type the page draws for this kind (clipping can leave stray points/lines)
        want = ("LineString",) if kind in ("isobath", "frame") else ("Polygon",)
        parts = [p for p in shapely.get_parts(geom.simplify(tol, preserve_topology=True)) if p.geom_type in want and not p.is_empty]
        if not parts:
            return
        g = to_ll(unary_union(parts) if want == ("Polygon",) else MultiLineString(parts))
        feats.append({"type": "Feature", "properties": {"kind": kind, **props}, "geometry": mapping(g)})

    add("sea", sea)
    for lv in band_levels:
        polys = []
        for pts, offs in zip(*gen.filled(lv, 1e6)):
            rings = [pts[offs[i]:offs[i + 1]] for i in range(len(offs) - 1)]
            if len(rings[0]) >= 4:
                polys.append(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4]).buffer(0))
        if polys:
            add("band", to_m(unary_union(polys)).intersection(wet), d=lv)
    for lv in levels:
        segs = [LineString(p) for p in gen.lines(lv) if len(p) >= 2]
        if not segs:
            continue
        clipped = to_m(MultiLineString(segs)).intersection(wet)
        parts = [g for g in getattr(clipped, "geoms", [clipped]) if g.geom_type == "LineString" and g.length > 4 * tol]
        if parts:
            add("isobath", MultiLineString(parts), d=lv, major=int(lv in MAJOR), label=int(lv in LABEL))
    add("land", land)
    add("frame", LineString(frame.exterior.coords))

    w, s, e, n = to_ll(frame).bounds
    doc = {
        "type": "FeatureCollection",
        "pack": {
            "version": 2, "name": a.name,
            "center": [lon, lat], "half_w_km": a.half_w_km, "aspect": a.aspect,
            "bbox": [round(w, 6), round(s, 6), round(e, 6), round(n, 6)],
            "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "depth": {"source": meta["source"] + "".join(f"; {t}" for t in datum_note), "resolution": meta["resolution"], "max_m": round(dmax, 1)},
            "land": "OSMData land polygons minus OSM inland water (OpenFreeMap)",
            "levels_m": levels, "detail_m": a.detail_m,
            "credits": f"{meta['credit']} · Coastline and inland water © OpenStreetMap contributors (ODbL), OSMData, OpenFreeMap",
        },
        "features": feats,
    }
    out = Path(a.out) if a.out else ROOT / "packs" / f"{a.name}.geojson{'.gz' if a.gzip else ''}"
    out.parent.mkdir(parents=True, exist_ok=True)
    text = re.sub(r"(-?\d+\.\d{6})\d+", r"\1", json.dumps(doc, separators=(",", ":")))  # 6 decimals ≈ 0.1 m
    out.write_bytes(gzip.compress(text.encode(), 9) if out.suffix == ".gz" else text.encode())
    kinds = {}
    for f in feats:
        kinds[f["properties"]["kind"]] = kinds.get(f["properties"]["kind"], 0) + 1
    print(f"{out}  {out.stat().st_size / 1e6:.2f} MB · {meta['source']}, max {dmax:.0f} m · {kinds}")


if __name__ == "__main__":
    sys.exit(main())
