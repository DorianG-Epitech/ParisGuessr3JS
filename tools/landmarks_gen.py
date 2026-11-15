#!/usr/bin/env python3
"""Landmark placement data for ParisGuessr3JS (src/landmarks.js): centre, axis bearing, ground altitude, IGN footprints
(BD TOPO, Etalab 2.0) to hide from the tiles, and local footprints reused as bodies. Output: public/data/landmarks.json"""
import json, math, os, sys
import numpy as np, shapely, shapely.geometry as sg
X0, Y0 = 642800.0, 6857200.0
D = "/workspace/parisguessr/data"
meta = json.load(open(os.path.join(D, "dem", "dem.json")))
DEM = np.fromfile(os.path.join(D, "dem", "dem_4m.f32"), np.float32).reshape(meta["h"], meta["w"])
def dem(x, y):
    fx = (x - meta["x0"]) / meta["step"]; fy = (y - meta["y0"]) / meta["step"]; ix, iy = int(fx), int(fy)
    return float(DEM[iy, ix])
feats = {f["properties"]["cleabs"]: f for f in json.load(open(os.environ.get("PG_LM_SUBSET", "subset.geojson")))["features"]}
def G(i): return shapely.force_2d(sg.shape(feats["BATIMENT%016d" % i]["geometry"])).buffer(0)
C = {  # key: (centre building, bearing of local +u, excluded buildings, footprints kept as local bodies)
 "eiffel": (162699, 45, [162159, 162699, 162160, 162158], []),
 "notredame": (305564422, 115, [305564422, 245184819, 245184816, 305564421, 245184818, 245184817], []),
 "arc": (157326, 116, [157326], []),
 "sacrecoeur": (253248827, 356, [253248831, 253248827, 253248847], [253248831]),
 "pyramide": (245184969, 22, [245184969], []),
 "pantheon": (241930812, 109, [241930812, 253232436], [253232436]),
 "invalides": (253244903, 3, [253244903, 253244904], [253244904]),
 "opera": (253245873, 345, [253245873, 253245869, 245200051], [253245873, 253245869, 245200051]),
 "madeleine": (158567, 27, [158567], []),
 "grandpalais": (245172471, 2, [245172546, 245172471], [245172546]),
 "pompidou": (161473, 21, [161473], [161473]),
 "montparnasse": (241929410, 130, [241929410], [241929410]),
 "sulpice": (241937855, 83, [241937855, 241937858, 241937859, 253245361], [241937855, 241937858, 241937859, 253245361]),
}
out = []
for k, (ci, b, ex, keep) in C.items():
    g = G(ci); c = g.centroid; cx, cy = c.x, c.y
    sb, cb = math.sin(math.radians(b)), math.cos(math.radians(b))
    loc = lambda x, y: (round((x - cx) * sb + (y - cy) * cb, 2), round((x - cx) * cb - (y - cy) * sb, 2))
    sol = feats["BATIMENT%016d" % ci]["properties"].get("altitude_minimale_sol")
    excl = []
    for i in ex:
        for p in (lambda q: q.geoms if q.geom_type == "MultiPolygon" else [q])(G(i).buffer(1.0).simplify(0.5)):
            excl.append([[round(x - X0, 1), round(y - Y0, 1)] for x, y in list(p.exterior.coords)[:-1]])
    bodies = {}
    for i in keep:
        f = feats["BATIMENT%016d" % i]; p = G(i).simplify(0.4)
        p = max(p.geoms, key=lambda q: q.area) if p.geom_type == "MultiPolygon" else p
        pts = [loc(x, y) for x, y in list(sg.polygon.orient(p, 1.0).exterior.coords)[:-1]]
        us = [q[0] for q in pts]; vs = [q[1] for q in pts]
        bodies[str(i)[-4:]] = dict(pts=pts, h=f["properties"].get("hauteur"))
        print(f"  {k} body {str(i)[-4:]} h={f['properties'].get('hauteur')} u[{min(us):.1f},{max(us):.1f}] v[{min(vs):.1f},{max(vs):.1f}] n={len(pts)}")
    for i in ex:
        q = G(i).centroid; print(f"  {k} ex {str(i)[-4:]} at local {loc(q.x, q.y)} h={feats['BATIMENT%016d' % i]['properties'].get('hauteur')}")
    gd = dem(cx, cy)
    print(k, f"centre ({cx - X0:.1f},{cy - Y0:.1f}) sol={sol} dem={gd:.1f}")
    out.append(dict(id=k, x=round(cx - X0, 2), z=round(cy - Y0, 2), b=b, y=round(gd, 2), excl=excl, bodies=bodies))
dst = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data", "landmarks.json")
json.dump(out, open(dst, "w"), separators=(",", ":"))
print("bytes", os.path.getsize(dst))
