import * as THREE from 'three';
import { gunzipSync } from 'fflate';
import { World, key } from './world.js';
import { buildTile } from './tilebuilder.js';
import { facesMat, linesMat, hullMat } from './shaders.js';

// Streams 250 m tiles (data/tiles/t_X_Y.bin.gz) around a focus point: nearest first, 4 downloads in flight,
// one mesh build per frame, far tiles disposed. Also answers ground-height and wall queries for the walker.
export class Streamer {
  constructor(root, base) {
    this.root = root; this.base = base; this.tiles = new Map(); this.pending = [];
    this.focus = { x: 0, z: 0 }; this.loadRadius = 420; this.unloadRadius = 620; this.inFlight = 0; this.bytes = 0; this.active = false;
  }
  distToTile(x, y) {
    const ts = World.tile, f = this.focus;
    const dx = Math.max(0, x * ts - f.x, f.x - (x + 1) * ts), dy = Math.max(0, y * ts - f.z, f.z - (y + 1) * ts);
    return Math.hypot(dx, dy);
  }
  readyAround(px, pz, r) {
    const ts = World.tile;
    for (let y = Math.floor((pz - r) / ts); y <= Math.floor((pz + r) / ts); y++)
      for (let x = Math.floor((px - r) / ts); x <= Math.floor((px + r) / ts); x++) {
        const k = key(x, y); if (!World.tiles.has(k)) continue;
        const t = this.tiles.get(k); if (!t || !(t.done || t.failed)) return false;
      }
    return true;
  }
  update() {
    if (!this.active) return;
    const ts = World.tile;
    for (const [k, t] of this.tiles) {
      const cx = (t.x + 0.5) * ts, cz = (t.y + 0.5) * ts;
      if (Math.hypot(cx - this.focus.x, cz - this.focus.z) > this.unloadRadius + ts * 0.71 && (t.done || t.failed)) { this.free(t); this.tiles.delete(k); }
    }
    while (this.inFlight < 4) {
      let best = Infinity, bx = 0, by = 0;
      const R = this.loadRadius;
      for (let y = Math.floor((this.focus.z - R) / ts); y <= Math.floor((this.focus.z + R) / ts); y++)
        for (let x = Math.floor((this.focus.x - R) / ts); x <= Math.floor((this.focus.x + R) / ts); x++) {
          const k = key(x, y); if (this.tiles.has(k) || !World.tiles.has(k)) continue;
          const d = this.distToTile(x, y); if (d <= R && d < best) { best = d; bx = x; by = y; }
        }
      if (best === Infinity) break;
      const t = { x: bx, y: by, done: false, failed: false };
      this.tiles.set(key(bx, by), t); this.inFlight++;
      fetch(`${this.base}tiles/t_${bx}_${by}.bin.gz`).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(b => { this.bytes += b.byteLength; t.data = gunzipSync(new Uint8Array(b)).buffer; this.pending.push(t); })
        .catch(e => { t.failed = true; console.warn('[PG] tile failed', bx, by, e); })
        .finally(() => { this.inFlight--; });
    }
    if (this.pending.length) {
      this.pending.sort((a, b) => this.distToTile(a.x, a.y) - this.distToTile(b.x, b.y));
      const t = this.pending.shift();
      if (this.tiles.get(key(t.x, t.y)) === t) this.build(t);
    }
  }
  build(t) {
    let r;
    try { r = buildTile(t.data); } catch (e) { console.error('[PG] tile build', t.x, t.y, e); t.failed = true; return; }
    t.data = null;
    const g = new THREE.Group(); g.position.set(r.origin.x, 0, r.origin.z);
    g.add(new THREE.Mesh(r.faces, facesMat)); g.add(new THREE.Mesh(r.lines, linesMat)); if (r.hull) g.add(new THREE.Mesh(r.hull, hullMat));
    g.matrixAutoUpdate = false; g.updateMatrix(); g.children.forEach(c => { c.matrixAutoUpdate = false; c.updateMatrix(); });
    this.root.add(g); t.group = g; t.geos = [r.faces, r.lines, r.hull].filter(Boolean);
    t.col = r.col; t.ox = r.origin.x; t.oz = r.origin.z;
    // wall segment hash (5 m cells, local coords)
    const cells = new Map(), w = r.col.walls, cs = 5;
    for (let i = 0; i < w.length; i += 6) {
      const x0 = Math.floor(Math.min(w[i], w[i + 2]) / cs), x1 = Math.floor(Math.max(w[i], w[i + 2]) / cs);
      const z0 = Math.floor(Math.min(w[i + 1], w[i + 3]) / cs), z1 = Math.floor(Math.max(w[i + 1], w[i + 3]) / cs);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const k = z * 4096 + x; let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(i); }
    }
    t.cells = cells; t.done = true;
  }
  free(t) {
    if (t.group) { this.root.remove(t.group); t.geos.forEach(g => g.dispose()); if (t.metro) t.metro.children.forEach(m => m.geometry.dispose()); }
    const i = this.pending.indexOf(t); if (i >= 0) this.pending.splice(i, 1);
  }
  tileAt(x, z) { return this.tiles.get(key(Math.floor(x / World.tile), Math.floor(z / World.tile))); }
  /** ground (terrain or bridge deck within reach of feetY) at world x,z; null if the tile is not loaded */
  groundAt(x, z, feetY) {
    const t = this.tileAt(x, z); if (!t || !t.done) return null;
    const lx = x - t.ox, lz = z - t.oz; let g = t.col.ground(lx, lz);
    const dk = t.col.decks;
    for (let i = 0; i < dk.length; i += 12) {
      // quad pl, l3, r3, pr -> two triangles, barycentric height
      for (const [a, b, c] of [[0, 3, 6], [0, 6, 9]]) {
        const h = triHeight(lx, lz, dk, i + a, i + b, i + c);
        if (h !== null && h > g && h < feetY + 1.2) g = h;
      }
    }
    return g;
  }
  /** push a circle (radius r) out of building walls; returns corrected [x, z] */
  collide(x, z, r, feetY) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const tt of neighbours(this, x, z)) {
        const cs = 5, w = tt.col.walls;
        const cx = Math.floor((x - tt.ox) / cs), cz = Math.floor((z - tt.oz) / cs);
        const seen = new Set();
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const a = tt.cells.get((cz + dz) * 4096 + cx + dx); if (!a) continue;
          for (const i of a) {
            if (seen.has(i)) continue; seen.add(i);
            if (feetY + 1.6 < w[i + 4] || feetY + 0.35 > w[i + 5]) continue;
            const qx = x - tt.ox, qz = z - tt.oz;
            const ax = w[i], az = w[i + 1], ex = w[i + 2] - ax, ez = w[i + 3] - az, L2 = ex * ex + ez * ez; if (L2 < 1e-6) continue;
            const s = Math.max(0, Math.min(1, ((qx - ax) * ex + (qz - az) * ez) / L2));
            const ddx = qx - (ax + ex * s), ddz = qz - (az + ez * s), dd = Math.hypot(ddx, ddz);
            if (dd < r && dd > 1e-5) { x += ddx / dd * (r - dd); z += ddz / dd * (r - dd); moved = true; }
          }
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }
  get loadedCount() { let n = 0; for (const t of this.tiles.values()) if (t.done) n++; return n; }
}
function* neighbours(s, x, z) {
  const ts = World.tile, tx = Math.floor(x / ts), tz = Math.floor(z / ts);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const t = s.tiles.get(key(tx + dx, tz + dz)); if (t && t.done) yield t;
  }
}
function triHeight(x, z, d, a, b, c) {
  const x1 = d[a], z1 = d[a + 2], x2 = d[b], z2 = d[b + 2], x3 = d[c], z3 = d[c + 2];
  const den = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3); if (Math.abs(den) < 1e-9) return null;
  const l1 = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / den, l2 = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / den, l3 = 1 - l1 - l2;
  if (l1 < 0 || l2 < 0 || l3 < 0) return null;
  return l1 * d[a + 1] + l2 * d[b + 1] + l3 * d[c + 1];
}
