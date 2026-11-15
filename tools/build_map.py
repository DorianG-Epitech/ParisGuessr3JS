#!/usr/bin/env python3
"""Vector guess map -> public/data/map/v_X_Y.bin.gz (1 km tiles, same style as paris_map.jpg / make_map.py), from IGN BD TOPO
(Licence Ouverte Etalab 2.0). Coordinates: decimetres local to the tile corner, each ring/line delta-coded.
Binary: for layers P, g, w, b, f: varint ring count, then per ring varint point count + zigzag varints (x0, y0, dx, dy, ...);
then roads: varint group count, per group varint class, varint width (dm), varint line count, lines as above.
  v_X_Y: P: Paris (commune) fill   g: green (végétation, cimetières, terrains de sport)   w: water   b: buildings (merged)
  b = merged buildings coarsened to blocks; detailed merged buildings in b_X_Y.bin.gz (same ring encoding, one layer)
  f: railways at ground level   r: [[class, width_dm, [lines]], ...] roads (0 path, 1 street, 2 importance 4, 3 importance 3, 4 major)
Inputs: $PG_DATA/vector/*.geojson (Lambert-93)."""
import os, json, gzip, math, sys
import shapely, shapely.geometry as sg, shapely.ops as so
from shapely.strtree import STRtree

D = os.environ.get("PG_DATA", "/workspace/parisguessr/data")
HERE = os.path.dirname(os.path.abspath(__file__))
meta = json.load(open(os.path.join(HERE, "..", "public", "data", "meta.json")))
X0, Y0, X1, Y1 = meta["x0"], meta["y0"], meta["x1"], meta["y1"]
TS = 1000
OUT = os.path.join(HERE, "..", "public", "data", "map"); os.makedirs(OUT, exist_ok=True)
def load(n):
    print("load", n, flush=True)
    return [f for f in json.load(open(os.path.join(D, "vector", n + ".geojson")))["features"] if f["geometry"]]
def g2(f): return shapely.force_2d(sg.shape(f["geometry"]))

paris = g2(load("commune")[0])
green = [g2(f).buffer(0) for f in load("zone_de_vegetation") + load("cimetiere") + load("terrain_de_sport")]
water = [g2(f).buffer(0) for f in load("surface_hydrographique")]
rail = [g2(f) for f in load("troncon_de_voie_ferree") if f["properties"].get("position_par_rapport_au_sol") in ("0", "1")]
roads = []
DEFW = [2, 6, 8, 10, 12]
for f in load("troncon_de_route"):
    p = f["properties"]
    if p["etat_de_l_objet"] != "En service" or int(p["position_par_rapport_au_sol"] or 0) < 0 or p["nature"] == "Escalier": continue
    imp = int(p["importance"] or 6); n = p["nature"]
    c = 0 if n in ("Sentier", "Chemin") else 4 if (n == "Type autoroutier" or imp <= 2) else 3 if imp == 3 else 2 if imp == 4 else 1
    w = p.get("largeur_de_chaussee") or DEFW[c]
    roads.append((c, max(1, min(40, round(float(w)))), g2(f)))
blds = []
for f in load("batiment"):
    if f["properties"].get("etat_de_l_objet", "En service") != "En service": continue
    try: blds.append(g2(f).buffer(0))
    except Exception: pass
print(len(green), len(water), len(rail), len(roads), len(blds), flush=True)
T = {k: (STRtree(v), v) for k, v in [("g", green), ("w", water), ("b", blds), ("f", rail), ("r", [r[2] for r in roads])]}

def enc_line(coords, ox, oy):
    out, px, py = [], 0, 0
    for i, (x, y) in enumerate(coords):
        qx, qy = round((x - ox) * 10), round((y - oy) * 10)
        if i and qx == px and qy == py: continue
        out += [qx, qy] if i == 0 else [qx - px, qy - py]; px, py = qx, qy
    return out
def polys(g):
    if g.is_empty: return []
    if g.geom_type == "Polygon": return [g]
    if hasattr(g, "geoms"): return [q for x in g.geoms for q in polys(x)]
    return []
def lines(g):
    if g.is_empty: return []
    if g.geom_type == "LineString": return [g]
    if hasattr(g, "geoms"): return [q for x in g.geoms for q in lines(x)]
    return []
def enc_polys(g, ox, oy, tol, minA):
    out = []
    for p in polys(g.simplify(tol)):
        if p.area < minA: continue
        out.append(enc_line(p.exterior.coords, ox, oy))
        out += [enc_line(r.coords, ox, oy) for r in p.interiors if sg.Polygon(r).area >= minA]
    return out

total = 0; totb = 0; n = 0
nx, ny = math.ceil((X1 - X0) / TS), math.ceil((Y1 - Y0) / TS)
for ty in range(ny):
    for tx in range(nx):
        ox, oy = X0 + tx * TS, Y0 + ty * TS
        box = sg.box(ox, oy, ox + TS, oy + TS); pad = box.buffer(30, join_style=2)
        def q(k, b=box): tree, arr = T[k]; return [arr[i] for i in tree.query(b)]
        t = {"P": enc_polys(paris.intersection(box), ox, oy, 1, 1)}
        t["g"] = enc_polys(so.unary_union([x.intersection(box) for x in q("g")]), ox, oy, 0.8, 4) if q("g") else []
        t["w"] = enc_polys(so.unary_union([x.intersection(box) for x in q("w")]), ox, oy, 0.8, 4) if q("w") else []
        bb = q("b")
        bu = so.unary_union([x.intersection(box) for x in bb]) if bb else sg.GeometryCollection()
        t["b"] = enc_polys(bu.buffer(1.5, join_style=2).buffer(-1.5, join_style=2), ox, oy, 2.5, 40) if bb else []   # coarse blocks (mid zoom)
        bdet = enc_polys(bu, ox, oy, 0.5, 5) if bb else []                                                            # detailed (high zoom)
        t["f"] = [enc_line(l.coords, ox, oy) for x in q("f", pad) for l in lines(x.intersection(pad).simplify(0.8))]
        groups = {}
        tree, arr = T["r"]
        for i in tree.query(pad):
            c, w, g = roads[i]
            for l in lines(g.intersection(pad).simplify(0.4)): groups.setdefault((c, w), []).append(enc_line(l.coords, ox, oy))
        t["r"] = [[c, w * 10, ls] for (c, w), ls in sorted(groups.items())]
        if not any(t[k] for k in t): continue
        buf = bytearray()
        def vu(v):
            while v >= 0x80: buf.append((v & 0x7F) | 0x80); v >>= 7
            buf.append(v)
        def ring(a):
            vu(len(a) // 2)
            for v in a: vu((v << 1) ^ (v >> 63) if v < 0 else v << 1)
        for k in "Pgwbf": vu(len(t[k])); [ring(a) for a in t[k]]
        vu(len(t["r"]))
        for c, w, ls in t["r"]: vu(c); vu(w); vu(len(ls)); [ring(a) for a in ls]
        data = gzip.compress(bytes(buf), 9)
        open(os.path.join(OUT, f"v_{tx}_{ty}.bin.gz"), "wb").write(data); total += len(data); n += 1
        if bdet:
            buf = bytearray(); vu(len(bdet)); [ring(a) for a in bdet]
            data = gzip.compress(bytes(buf), 9); open(os.path.join(OUT, f"b_{tx}_{ty}.bin.gz"), "wb").write(data); totb += len(data)
    print(f"row {ty}/{ny}: {n} tiles, {total / 1024:.0f} KB", flush=True)
json.dump({"tile": TS, "nx": nx, "ny": ny}, open(os.path.join(OUT, "index.json"), "w"))
print(f"done: {n} tiles, base {total / 1048576:.2f} MB gz ({total / max(n, 1) / 1024:.1f} KB avg), detailed buildings {totb / 1048576:.2f} MB gz")
