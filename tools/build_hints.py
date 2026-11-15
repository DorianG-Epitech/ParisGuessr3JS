#!/usr/bin/env python3
"""Hint data for the guess map -> public/data/hints.json (world metres, x = E - x0, y = N - y0, rounded to 1 m).
  lines: metro + RER traces (IDFM « Traces du réseau ferré IDF », Licence Ouverte), merged per line, simplified to 4 m,
         clipped to the world bbox + 1 km.   [{"m": "M"|"R", "c": "ffbe00", "p": [[x, y, x, y, ...], ...]}]
  arr:   arrondissement boundaries (IGN BD TOPO), simplified to 3 m.  [{"a": 15, "p": [[x, y, ...], ...]}]
Inputs: $PG_DATA/traces_reseau_ferre.geojson (download:
  https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/traces-du-reseau-ferre-idf/exports/geojson)
  and $PG_DATA/vector/arrondissement_municipal.geojson (Lambert-93)."""
import os, json
import shapely.geometry as sg, shapely.ops as so
from pyproj import Transformer

D = os.environ.get("PG_DATA", "/workspace/parisguessr/data")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data", "hints.json")
meta = json.load(open(os.path.join(os.path.dirname(__file__), "..", "public", "data", "meta.json")))
X0, Y0 = meta["x0"], meta["y0"]
clip = sg.box(meta["x0"] - 1000, meta["y0"] - 1000, meta["x1"] + 1000, meta["y1"] + 1000)
tr = Transformer.from_crs(4326, 2154, always_xy=True)

def flat(line):
    out = []
    for x, y in line.coords: out += [round(x - X0), round(y - Y0)]
    return out

groups = {}
for f in json.load(open(os.path.join(D, "traces_reseau_ferre.geojson")))["features"]:
    p = f["properties"]
    if p["mode"] not in ("METRO", "RER") or p["indice_lig"] == "TER": continue
    g = so.transform(tr.transform, sg.shape(f["geometry"])).intersection(clip)
    if g.is_empty: continue
    k = (p["mode"], p["indice_lig"]); groups.setdefault(k, {"c": p["colourweb_hexa"], "g": []})["g"].append(g)
lines = []
for (mode, lig), v in sorted(groups.items(), key=lambda kv: kv[0][0] == "METRO"):   # RER first, metro drawn on top
    m = so.linemerge(so.unary_union(v["g"])).simplify(4)
    parts = [m] if m.geom_type == "LineString" else list(m.geoms)
    lines.append({"m": "R" if mode == "RER" else "M", "c": v["c"], "p": [flat(l) for l in parts if l.length > 20]})
arr = []
for f in json.load(open(os.path.join(D, "vector", "arrondissement_municipal.geojson")))["features"]:
    g = sg.shape(f["geometry"]).simplify(3)
    polys = [g] if g.geom_type == "Polygon" else list(g.geoms)
    arr.append({"a": int(f["properties"]["numero_de_l_arrondissement_municipal"]), "p": [flat(p.exterior) for p in polys]})
arr.sort(key=lambda a: a["a"])
json.dump({"lines": lines, "arr": arr}, open(OUT, "w"), separators=(",", ":"))
print(f"{len(lines)} lines, {len(arr)} arrondissements, {os.path.getsize(OUT) / 1024:.1f} KB")
