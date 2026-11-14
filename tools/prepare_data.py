#!/usr/bin/env python3
"""Copies the ParisGuessr (Unity) tile data into public/data for the web version:
tiles -> public/data/tiles/t_X_Y.bin.gz (gzip, decoded in the browser with fflate), spawns/tile index/meta as-is,
guess map -> JPEG. Source: ../ParisGuessr pipeline (Tools/build_tiles.py, Tools/make_map.py), IGN BD TOPO / RGE ALTI."""
import os, sys, gzip, glob, shutil
from PIL import Image
SRC = os.environ.get("PG_UNITY", "/home/box/UnityProjects/ParisGuessr")
DST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data")
os.makedirs(os.path.join(DST, "tiles"), exist_ok=True)
n = raw = gz = 0
for f in glob.glob(os.path.join(SRC, "Assets/StreamingAssets/tiles/*.bin")):
    b = open(f, "rb").read(); c = gzip.compress(b, 9, mtime=0)
    open(os.path.join(DST, "tiles", os.path.basename(f) + ".gz"), "wb").write(c); n += 1; raw += len(b); gz += len(c)
R = os.path.join(SRC, "Assets/ParisGuessr/Resources")
shutil.copy(os.path.join(R, "spawns.bytes"), os.path.join(DST, "spawns.bin"))
shutil.copy(os.path.join(R, "tiles.bytes"), os.path.join(DST, "tiles.bin"))
shutil.copy(os.path.join(R, "pg_meta.json"), os.path.join(DST, "meta.json"))
Image.open(os.path.join(R, "paris_map.png")).convert("RGB").save(os.path.join(DST, "paris_map.jpg"), quality=86, optimize=True, progressive=True)
print(f"tiles {n}, raw {raw/1e6:.1f} MB -> gz {gz/1e6:.1f} MB; map {os.path.getsize(os.path.join(DST,'paris_map.jpg'))/1e6:.2f} MB")
