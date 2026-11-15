import os
import json, math
from pyproj import Transformer
import shapely.geometry as sg, shapely
tr = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
L = {"eiffel":(48.85826,2.29448),"notredame":(48.85297,2.34989),"arc":(48.87378,2.29504),"sacrecoeur":(48.88671,2.34310),
"pyramide":(48.86104,2.33580),"pantheon":(48.84622,2.34637),"invalides":(48.85500,2.31258),"opera":(48.87197,2.33163),
"madeleine":(48.87005,2.32446),"grandpalais":(48.86610,2.31248),"pompidou":(48.86064,2.35222),"montparnasse":(48.84212,2.32198),
"petitpalais":(48.86600,2.31470),"sulpice":(48.85098,2.33475),"ecolemil":(48.85060,2.30360)}
P = {k: tr.transform(lo, la) for k,(la,lo) in L.items()}
json.dump(P, open(os.environ.get("PG_LM_DIR", ".") + "/centers.json","w"))
feats = json.load(open("/workspace/parisguessr/data/vector/batiment.geojson"))["features"]
out = []
for f in feats:
    if not f["geometry"]: continue
    g = shapely.force_2d(sg.shape(f["geometry"]))
    c = g.centroid
    for k,(x,y) in P.items():
        if math.hypot(c.x-x, c.y-y) < 180:
            f["properties"]["_lm"] = k; out.append(f); break
json.dump({"type":"FeatureCollection","features":out}, open(os.environ.get("PG_LM_SUBSET", "subset.geojson"),"w"))
print(len(out))
