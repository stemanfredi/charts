#!/usr/bin/env python3
"""Build an area pack: survey-grade depths and an exact coastline for one frame.

The pack is one GeoJSON file, opened in the page ("Open pack…" or drag and
drop). It is read in the browser and never uploaded:
  sea      frame minus land
  land     OSMData land polygons, clipped to the frame
  band     region deeper than d metres, one per depth contour (stacked)
  isobath  depth contour at d metres, clipped to the sea
  frame    the frame outline, so the page shows where pack data stops

Depths: EMODnet DTM 2024 (~115 m) where it covers the frame, with gaps filled
from GEBCO; GEBCO elsewhere (2020 grid from NOAA ERDDAP, or your own GEBCO
GeoTIFF with --gebco). Contours are traced on the unmasked grid and then
clipped to the sea, so they reach the true coastline without gaps.
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
MAX_CELLS = 1_500_000  # per ERDDAP request; larger frames are fetched with a stride


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
    with urllib.request.urlopen(url, timeout=300) as r:
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


def depth_grid(a, bb):
    if a.gebco:
        g = geotiff_grid(a.gebco, bb)
        gname, gres, gcredit = a.gebco_label, "file resolution", a.gebco_label
    else:
        g = erddap_grid(GEBCO[0], bb)
        _, gname, gres, gcredit = GEBCO
    if a.source == "gebco":
        return g, dict(source=gname, resolution=gres, credit=gcredit)
    try:
        e = erddap_grid(EMODNET[0], bb)
    except Exception as err:  # outside coverage or service down
        if a.source == "emodnet":
            raise
        print(f"  EMODnet unavailable ({err}); using {gname}")
        return g, dict(source=gname, resolution=gres, credit=gcredit)
    # EMODnet is null on land and outside its coverage: measure coverage on GEBCO's sea cells
    gz = bilinear(*g, e[0], e[1])
    sea = gz < 0
    cover = np.isfinite(e[2])[sea].mean() if sea.any() else 0.0
    if a.source == "auto" and cover < 0.9:
        print(f"  EMODnet covers {cover:.0%} of the sea here; using {gname}")
        return g, dict(source=gname, resolution=gres, credit=gcredit)
    z = np.where(np.isfinite(e[2]), e[2], gz)
    filled = int((~np.isfinite(e[2]) & sea).sum())
    _, ename, eres, ecredit = EMODNET
    note = f", {filled} gap cells from {gname}" if filled else ""
    return (e[0], e[1], z), dict(source=ename + note, resolution=eres,
                                  credit=ecredit + (f" · {gcredit}" if filled else ""))


# ── land ───────────────────────────────────────────────────────────────────

def land_path(a):
    if a.land:
        return Path(a.land)
    shp = CACHE / "land-polygons-complete-4326" / "land_polygons.shp"
    if not shp.exists():
        CACHE.mkdir(exist_ok=True)
        z = CACHE / "land-polygons-complete-4326.zip"
        print(f"  downloading OSMData land polygons (~900 MB, once) to {z} …", flush=True)
        urllib.request.urlretrieve(LAND_URL, z)
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


# ── build ──────────────────────────────────────────────────────────────────

def main():
    a = parse_args()
    lat, lon = (float(v) for v in a.center.split(","))
    fwd, inv, frame, bb = frame_of(lat, lon, a.half_w_km, a.aspect)
    print(f"{a.name}: {lat:.5f}, {lon:.5f} · {2 * a.half_w_km:g} × {2 * a.half_w_km * a.aspect:g} km", flush=True)

    (glon, glat, z), meta = depth_grid(a, bb)
    land = land_geom(a, bb, fwd, frame)
    sea = frame.difference(land) if not land.is_empty else frame

    depth = -z
    dmax = float(np.nanmax(depth)) if np.isfinite(depth).any() else 0.0
    levels = [lv for lv in LEVELS if lv < dmax]
    gen = contourpy.contour_generator(glon, glat, np.ma.masked_invalid(depth),
                                      line_type=contourpy.LineType.Separate,
                                      fill_type=contourpy.FillType.OuterOffset)
    to_m, to_ll = reproject(fwd), reproject(inv)
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
    for lv in levels:
        polys = []
        for pts, offs in zip(*gen.filled(lv, 1e6)):
            rings = [pts[offs[i]:offs[i + 1]] for i in range(len(offs) - 1)]
            if len(rings[0]) >= 4:
                polys.append(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4]).buffer(0))
        if polys:
            add("band", to_m(unary_union(polys)).intersection(sea), d=lv)
    for lv in levels:
        segs = [LineString(p) for p in gen.lines(lv) if len(p) >= 2]
        if not segs:
            continue
        clipped = to_m(MultiLineString(segs)).intersection(sea)
        parts = [g for g in getattr(clipped, "geoms", [clipped]) if g.geom_type == "LineString" and g.length > 4 * tol]
        if parts:
            add("isobath", MultiLineString(parts), d=lv, major=int(lv in MAJOR), label=int(lv in LABEL))
    add("land", land)
    add("frame", LineString(frame.exterior.coords))

    w, s, e, n = to_ll(frame).bounds
    doc = {
        "type": "FeatureCollection",
        "pack": {
            "version": 1, "name": a.name,
            "center": [lon, lat], "half_w_km": a.half_w_km, "aspect": a.aspect,
            "bbox": [round(w, 6), round(s, 6), round(e, 6), round(n, 6)],
            "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "depth": {"source": meta["source"], "resolution": meta["resolution"], "max_m": round(dmax, 1)},
            "land": "OSMData land polygons (OpenStreetMap coastline)",
            "levels_m": levels, "detail_m": a.detail_m,
            "credits": f"{meta['credit']} · Coastline © OpenStreetMap contributors (ODbL), OSMData",
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
