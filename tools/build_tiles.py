#!/usr/bin/env python3
"""ParisGuessr (Three.js): IGN BD TOPO + RGE ALTI (Etalab 2.0) + Paris trees (opendata.paris.fr, ODbL)
+ metro entrances (IDFM "Référentiel des arrêts : Accès", Etalab 2.0) -> compact 250 m "PGT2" tiles (gzip) in public/data/tiles.
PGT2 = PGT1 (Unity version) + road class (map colour) + tree genus type / trunk / crown limit + metro entrances.
Geometry is extruded at runtime (TileBuilder.cs), so a tile only stores footprints, heights, road centrelines, curbs, trees and a
5 m terrain grid. World frame: x = E - X0, z = N - Y0, y = altitude NGF (m)."""
import os, sys, json, struct, math, random, numpy as np
import shapely, shapely.geometry as sg, shapely.ops as so
from shapely.strtree import STRtree
import mapbox_earcut as earcut
from pyproj import Transformer

D = os.environ.get("PG_DATA", "/workspace/parisguessr/data")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import gzip, collections
OUT_TILES = os.path.join(ROOT, "public", "data", "tiles")
OUT_RES = os.path.join(ROOT, "public", "data")
X0, Y0, X1, Y1 = 642800.0, 6857200.0, 661400.0, 6867400.0
TS = 250.0; NX = int(math.ceil((X1 - X0) / TS)); NY = int(math.ceil((Y1 - Y0) / TS))
GN, GSP = 51, 5.0
random.seed(44)

meta = json.load(open(os.path.join(D, "dem", "dem.json")))
DEM = np.fromfile(os.path.join(D, "dem", "dem_4m.f32"), np.float32).reshape(meta["h"], meta["w"])
def dem(x, y):
    """bilinear, L93 coords, arrays ok"""
    fx = (np.asarray(x) - meta["x0"]) / meta["step"]; fy = (np.asarray(y) - meta["y0"]) / meta["step"]
    fx = np.clip(fx, 0, meta["w"] - 1.001); fy = np.clip(fy, 0, meta["h"] - 1.001)
    ix = fx.astype(int); iy = fy.astype(int); tx = fx - ix; ty = fy - iy
    return (DEM[iy, ix] * (1 - tx) * (1 - ty) + DEM[iy, ix + 1] * tx * (1 - ty) + DEM[iy + 1, ix] * (1 - tx) * ty + DEM[iy + 1, ix + 1] * tx * ty)

def load(name): return json.load(open(os.path.join(D, "vector", name + ".geojson")))["features"]
def tile_of(x, y): return int((x - X0) // TS), int((y - Y0) // TS)
def cm(v): return int(max(0, min(65535, round(v * 100))))
def dm(v): return int(max(-32767, min(32767, round(v * 10))))

tiles = {}
def T(k):
    if k not in tiles: tiles[k] = dict(prisms=[], roads=[], curbs=[], trees=[], metro=[])
    return tiles[k]

paris = sg.shape(load("commune")[0]["geometry"]).buffer(0)
arrs = [(int(f["properties"]["code_insee"]) - 75100, sg.shape(f["geometry"]).buffer(0)) for f in load("arrondissement_municipal")]

# ---------------- buildings ----------------
def prism(poly, z0, z1, kind):
    poly = sg.polygon.orient(poly, 1.0)
    rings = [poly.exterior] + list(poly.interiors)
    pts, ends, rr = [], [], []
    for r in rings:
        c = list(r.coords)[:-1]
        if len(c) < 3: continue
        rr.append(c); pts += c; ends.append(len(pts))
    if not rr or len(pts) > 60000: return None
    tri = earcut.triangulate_float64(np.array(pts, np.float64), np.array(ends, np.uint32))
    if len(tri) == 0: return None
    return dict(kind=kind, z0=z0, z1=z1, rings=rr, tri=tri)

print("buildings...", flush=True)
B = load("batiment")
bshapes = []
nb = 0
for f in B:
    p = f["properties"]
    if p.get("etat_de_l_objet") != "En service" or f["geometry"] is None: continue
    g = sg.shape(f["geometry"])
    g = shapely.force_2d(g).buffer(0)
    if g.is_empty: continue
    h = p.get("hauteur")
    zs = [c[2] for poly in f["geometry"]["coordinates"] for ring in poly for c in ring if len(c) > 2]
    sol = p.get("altitude_minimale_sol")
    for poly in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
        if poly.area < 6: continue
        poly = poly.simplify(0.25, preserve_topology=True)
        if poly.is_empty or poly.geom_type != "Polygon": continue
        ex = np.array(poly.exterior.coords)
        g0 = float(dem(ex[:, 0], ex[:, 1]).min())
        base = min(g0, sol if sol is not None else g0) - 0.6
        if h is not None and h > 0: gut = (sol if sol is not None else g0) + h
        elif zs: gut = float(np.median(zs))
        else: gut = g0 + 6
        gut = max(gut, g0 + 2.5)
        bshapes.append(poly)
        c = poly.representative_point(); k = tile_of(c.x, c.y)
        if not (0 <= k[0] < NX and 0 <= k[1] < NY): continue
        pr = prism(poly, base, gut, 0)
        if pr is None: continue
        T(k)["prisms"].append(pr); nb += 1
        # attic / mansard storey (Paris roofs): real max roof altitude if known, else 2.8 m for >= 4 storeys residential
        top = p.get("altitude_maximale_toit"); ah = 0
        if top is not None and top > gut + 1.5: ah = min(top - gut, 8)
        elif (p.get("nombre_d_etages") or 0) >= 4 and (p.get("usage_1") or "").startswith("R") and poly.area > 60: ah = 2.8
        if ah > 0:
            ins = poly.buffer(-1.8, join_style=2)
            for q in (ins.geoms if ins.geom_type == "MultiPolygon" else [ins]):
                if q.is_empty or q.geom_type != "Polygon" or q.area < 25: continue
                q = q.simplify(0.25, preserve_topology=True)
                pa = prism(q, gut - 0.05, gut + ah, 1)
                if pa: T(k)["prisms"].append(pa)
del B
print("buildings", nb, flush=True)
btree = STRtree(bshapes)

# ---------------- roads ----------------
print("roads...", flush=True)
RIB = {"Route à 1 chaussée", "Route à 2 chaussées", "Rond-point", "Route empierrée", "Bretelle", "Type autoroutier"}
SPAWNABLE = {"Route à 1 chaussée", "Route à 2 chaussées", "Rond-point", "Route empierrée"}
tile_boxes = {}
def tbox(k):
    if k not in tile_boxes: tile_boxes[k] = sg.box(X0 + k[0] * TS, Y0 + k[1] * TS, X0 + (k[0] + 1) * TS, Y0 + (k[1] + 1) * TS)
    return tile_boxes[k]
def densify(coords, step=4.0):
    out = [coords[0]]
    for a, b in zip(coords[:-1], coords[1:]):
        L = math.dist(a[:2], b[:2]); n = max(1, int(L // step))
        for i in range(1, n + 1):
            t = i / n; out.append(tuple(a[j] + (b[j] - a[j]) * t for j in range(len(a))))
    return out
ground_ribbons = {}   # tile -> list of buffered polys for curbs
spawn_src = []
ground_lines = []
for f in load("troncon_de_route"):
    p = f["properties"]
    if p["nature"] not in RIB or p["etat_de_l_objet"] != "En service" or f["geometry"] is None: continue
    pos = int(p["position_par_rapport_au_sol"] or 0)
    if pos < 0: continue
    w = p.get("largeur_de_chaussee") or 0
    if not w: w = 3.2 * (p.get("nombre_de_voies") or 0) or 5.0
    w = float(min(max(w, 3.0), 30.0))
    imp = int(p["importance"] or 6)
    rcls = 2 if (p["nature"] == "Type autoroutier" or imp <= 2) else 1 if imp == 3 else 0
    line3 = sg.shape(f["geometry"])
    if line3.geom_type != "LineString": continue
    line = shapely.force_2d(line3)
    name = p.get("nom_collaboratif_gauche") or p.get("nom_voie_ban_gauche") or p.get("nom_collaboratif_droite") or ""
    if pos == 0 and p["nature"] in SPAWNABLE and line.length > 8: spawn_src.append((line, name))
    if pos == 0: ground_lines.append(line)
    x0, y0, x1, y1 = line.bounds
    for kx in range(int((x0 - X0) // TS), int((x1 - X0) // TS) + 1):
        for ky in range(int((y0 - Y0) // TS), int((y1 - Y0) // TS) + 1):
            if not (0 <= kx < NX and 0 <= ky < NY): continue
            k = (kx, ky); bx = tbox(k).buffer(w)
            part = line3.intersection(bx) if pos > 0 else line.intersection(bx)
            for seg in (part.geoms if hasattr(part, "geoms") else [part]):
                if seg.is_empty or seg.geom_type != "LineString" or seg.length < 0.5: continue
                c = densify(list(seg.coords))
                T(k)["roads"].append(dict(bridge=pos > 0, w=w, pts=c, cls=rcls))
            if pos == 0:
                ground_ribbons.setdefault(k, []).append(line.intersection(tbox(k).buffer(40)).buffer(w / 2, cap_style=1, quad_segs=3))
print("curbs...", flush=True)
for k, polys in ground_ribbons.items():
    u = so.unary_union([q for q in polys if not q.is_empty]).simplify(0.2)
    bl = u.boundary.intersection(tbox(k))
    for seg in (bl.geoms if hasattr(bl, "geoms") else [bl]):
        if seg.geom_type == "LineString" and seg.length > 0.5:
            T(k)["curbs"].append(densify(list(seg.coords), 5.0))
        elif seg.geom_type == "MultiLineString":
            for s in seg.geoms: T(k)["curbs"].append(densify(list(s.coords), 5.0))

# ---------------- trees ----------------
# type: 0 rond (tilleul, érable...), 1 platane, 2 marronnier, 3 conifère, 4 élancé (peuplier, ginkgo, bouleau), 5 petit, 6 fleuri
print("trees...", flush=True)
G = {"Platanus": 1, "Aesculus": 2, "Populus": 4, "Ginkgo": 4, "Betula": 4, "Liriodendron": 4,
     "Corylus": 5, "Pyrus": 5, "Crataegus": 5, "Sorbus": 5, "Koelreuteria": 5, "Parrotia": 5, "Amelanchier": 5, "Cornus": 5, "Ostrya": 5, "Laburnum": 5, "Morus": 5,
     "Prunus": 6, "Malus": 6, "Cercis": 6, "Magnolia": 6, "Lagerstroemia": 6, "Paulownia": 6}
for g in ("Pinus Taxus Cedrus Chamaecyparis Abies Picea Thuja Cupressus Sequoiadendron Sequoia Metasequoia Taxodium Cryptomeria Larix "
          "Calocedrus Cupressocyparis Juniperus Pseudotsuga Tsuga Thujopsis Cephalotaxus Araucaria Ilex").split(): G[g] = 3
STAGE = {"Jeune (arbre)": 5, "Jeune (arbre)Adulte": 9, "Adulte": 13, "Mature": 18}
tr = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
lat, lon, hh, cc, ty = [], [], [], [], []
import csv
for row in csv.DictReader(open(os.path.join(D, "arbres_paris_genre.csv"), encoding="utf-8-sig"), delimiter=";"):
    try:
        la, lo = row["geo_point_2d"].split(","); la, lo = float(la), float(lo)
    except (ValueError, AttributeError): continue
    h = float(row["hauteurenm"] or 0); c = float(row["circonferenceencm"] or 0)
    # dataset quirks: 0 = unknown, absurd values (e.g. 30 m with a 20 cm trunk)
    hc = 3 + c * 0.09 if 10 <= c <= 600 else None
    if not (2 < h < 40): h = hc or STAGE.get(row.get("stadedeveloppement") or "", 0) or (8 + random.random() * 8)
    elif hc and h > 2 * hc + 4: h = hc
    if not (10 <= c <= 700): c = 0
    t = G.get((row["genre"] or "").strip(), 0)
    if t in (5, 6): h = min(h, 12)
    lat.append(la); lon.append(lo); hh.append(h); cc.append(c); ty.append(t)
ex, ny_ = tr.transform(np.array(lon), np.array(lat))
pts = shapely.points(ex, ny_)
inside = np.zeros(len(pts), bool)
idx = btree.query(pts, predicate="within")
inside[idx[0]] = True
# distance to the nearest building: crowns are clamped so they do not cut into facades
near_i, near_d = btree.query_nearest(pts, max_distance=12, return_distance=True)
bdist = np.full(len(pts), 12.0); np.minimum.at(bdist, near_i[0], near_d)
nt = 0; cnt = collections.Counter()
for x, y, h, c, t, ins, bd in zip(ex, ny_, hh, cc, ty, inside, bdist):
    if ins: continue
    k = tile_of(x, y)
    if 0 <= k[0] < NX and 0 <= k[1] < NY: T(k)["trees"].append((x, y, h, t, c, max(1.0, bd + 0.6))); nt += 1; cnt[t] += 1
print("trees", nt, dict(cnt), flush=True)

# ---------------- metro entrances ----------------
# IDFM "Référentiel des arrêts : Accès" (+ relations accès / zones d'arrêts) — Licence Ouverte Etalab 2.0. Only metro
# station accesses; no line numbers or names are kept. Orientation = nearest street; points inside a building are pushed out.
print("metro...", flush=True)
M = os.path.join(D, "metro")
zt = {z["zdaid"]: z["zdatype"] for z in json.load(open(os.path.join(M, "zda.json")))}
metro_acc = {r["accid"] for r in json.load(open(os.path.join(M, "rel.json"))) if zt.get(r["zdaid"]) == "metroStation"}
ltree = STRtree(ground_lines)
placed = []; nm = 0; dropped = 0
for a_ in json.load(open(os.path.join(M, "acces.json"))):
    if a_["accid"] not in metro_acc: continue
    x, y = float(a_["accxespg2154"]), float(a_["accyespg2154"])
    if not (X0 <= x < X1 and Y0 <= y < Y1): continue
    pt = sg.Point(x, y)
    hit = btree.query(pt, predicate="within")
    if len(hit):
        poly = bshapes[hit[0]]; ext = poly.exterior; q = ext.interpolate(ext.project(pt))
        if q.distance(pt) > 6: dropped += 1; continue
        dx, dy = q.x - x, q.y - y; L_ = math.hypot(dx, dy) or 1
        x, y = q.x + dx / L_ * 2.2, q.y + dy / L_ * 2.2; pt = sg.Point(x, y)
        if len(btree.query(pt, predicate="within")): dropped += 1; continue
    if any(math.hypot(x - px, y - py) < 4 for px, py in placed): continue
    li = ltree.query_nearest(pt, max_distance=60)
    hd = random.random() * 360
    if len(li):
        line = ground_lines[li[0]]; d = line.project(pt)
        p0 = line.interpolate(max(0, d - 1.5)); p1 = line.interpolate(min(line.length, d + 1.5))
        hd = math.degrees(math.atan2(p1.x - p0.x, p1.y - p0.y)) % 360
        if random.random() < 0.5: hd = (hd + 180) % 360
    style = 1 if (int(a_["accid"]) * 2654435761 >> 7) % 100 < 30 else 0   # 0 totem "M" (modern), 1 Guimard-like arch
    k = tile_of(x, y); T(k)["metro"].append((x, y, hd, style)); placed.append((x, y)); nm += 1
print("metro entrances", nm, "dropped (deep inside buildings)", dropped, flush=True)

# ---------------- terrain classes ----------------
water = so.unary_union([sg.shape(f["geometry"]).buffer(0) for f in load("surface_hydrographique") if f["geometry"]])
green_src = [sg.shape(f["geometry"]).buffer(0) for f in load("zone_de_vegetation") if f["geometry"]]
green_src += [sg.shape(f["geometry"]).buffer(0) for f in load("cimetiere") if f["geometry"]]
green = so.unary_union(green_src)
shapely.prepare(water); shapely.prepare(green)

# ---------------- write ----------------
os.makedirs(OUT_TILES, exist_ok=True); os.makedirs(OUT_RES, exist_ok=True)
for fn in os.listdir(OUT_TILES):
    if fn.endswith(".bin.gz"): os.remove(os.path.join(OUT_TILES, fn))
written = []
for ky in range(NY):
    for kx in range(NX):
        k = (kx, ky); t = tiles.get(k)
        if t is None or (not t["prisms"] and not t["roads"]): continue
        ox, oy = X0 + kx * TS, Y0 + ky * TS
        b = bytearray(b"PGT2"); b += struct.pack("<ff", ox - X0, oy - Y0)
        gx = ox + np.arange(GN) * GSP; gy = oy + np.arange(GN) * GSP
        GX, GY = np.meshgrid(gx, gy)
        H = dem(GX, GY)
        cls = np.zeros(GX.shape, np.uint8)
        gp = shapely.points(GX.ravel(), GY.ravel())
        cls.ravel()[shapely.contains(green, gp)] = 1
        cls.ravel()[shapely.contains(water, gp)] = 2
        b += struct.pack("<Bf", GN, GSP); b += np.clip(np.round(H * 100), 0, 65535).astype("<u2").tobytes(); b += cls.tobytes()
        b += struct.pack("<i", len(t["prisms"]))
        for pr in t["prisms"]:
            b += struct.pack("<BHHB", pr["kind"], cm(pr["z0"]), cm(pr["z1"]), len(pr["rings"]))
            for r in pr["rings"]:
                b += struct.pack("<H", len(r))
                b += np.array([[dm(x - ox), dm(y - oy)] for x, y in r], "<i2").tobytes()
            tri = np.asarray(pr["tri"], "<u2"); b += struct.pack("<H", len(tri) // 3); b += tri.tobytes()
        b += struct.pack("<i", len(t["roads"]))
        for r in t["roads"]:
            b += struct.pack("<BHH", (1 if r["bridge"] else 0) | (r["cls"] << 1), int(r["w"] * 10), len(r["pts"]))
            b += np.array([[dm(c[0] - ox), dm(c[1] - oy)] for c in r["pts"]], "<i2").tobytes()
            if r["bridge"]: b += np.array([cm(c[2] if len(c) > 2 else 0) for c in r["pts"]], "<u2").tobytes()
        b += struct.pack("<i", len(t["curbs"]))
        for c in t["curbs"]:
            b += struct.pack("<H", len(c)); b += np.array([[dm(x - ox), dm(y - oy)] for x, y in c], "<i2").tobytes()
        b += struct.pack("<i", len(t["trees"]))
        for x, y, h, ty_, c, bd in t["trees"]:
            b += struct.pack("<hhBBBB", dm(x - ox), dm(y - oy), int(min(255, h * 4)), ty_, int(min(255, c / 4)), int(min(255, bd * 10)))
        b += struct.pack("<i", len(t["metro"]))
        for x, y, hd, st in t["metro"]: b += struct.pack("<hhBB", dm(x - ox), dm(y - oy), int(hd / 360 * 256) % 256, st)
        gz = gzip.compress(bytes(b), 9, mtime=0)
        open(os.path.join(OUT_TILES, f"t_{kx}_{ky}.bin.gz"), "wb").write(gz); written.append((kx, ky, len(b), len(gz)))
sizes = [w[2] for w in written]
print("tiles", len(written), "raw MB", sum(sizes) / 1e6, "gz MB", sum(w[3] for w in written) / 1e6, "max KB", max(sizes) / 1e3, flush=True)
idxb = bytearray(struct.pack("<i", len(written)))
for w in written: idxb += struct.pack("<HH", w[0], w[1])
old = open(os.path.join(OUT_RES, "tiles.bin"), "rb").read() if os.path.exists(os.path.join(OUT_RES, "tiles.bin")) else None
print("tile index unchanged:", old == bytes(idxb))
open(os.path.join(OUT_RES, "tiles.bin"), "wb").write(idxb)

