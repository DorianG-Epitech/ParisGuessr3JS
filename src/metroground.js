import * as THREE from 'three';
import { World } from './world.js';
import { facesMat, linesMat } from './shaders.js';

// Metro/RER hint in 3D: the line traces (hints.json, world metres) draped on the terrain as coloured ribbons with outlines,
// built per streamed tile (one tile per frame) and attached to the tile group so they go away with it.
const HALF = { M: 1.15, R: 1.7 }, DY = 0.3, STEP = 3;
export class MetroGround {
  constructor(streamer) { this.s = streamer; this.lines = []; this.on = false; this.done = new Set(); }
  setLines(lines) { this.lines = lines.map(L => ({ ...L, col: [parseInt(L.c.slice(0, 2), 16) / 255, parseInt(L.c.slice(2, 4), 16) / 255, parseInt(L.c.slice(4, 6), 16) / 255],
    bb: L.p.map(p => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); } return [x0, y0, x1, y1]; }) })); }
  enable(on) {
    if (on === this.on) return; this.on = on;
    if (!on) { for (const t of this.s.tiles.values()) this.drop(t); this.done.clear(); }
  }
  drop(t) { if (t.metro) { t.group && t.group.remove(t.metro); t.metro.children.forEach(m => m.geometry.dispose()); t.metro = null; } }
  update() {
    if (!this.on) return;
    for (const t of this.s.tiles.values()) if (t.done && t.group && !t.metro && !t.metroEmpty) { this.build(t); return; }
  }
  build(t) {
    const ts = World.tile, X0 = t.x * ts, Z0 = t.y * ts, X1 = X0 + ts, Z1 = Z0 + ts, g = t.col.ground;
    const P = [], N = [], C = [], I = [], LP = [], LO = [], LS = [], LI = [];
    const line = (a, b) => { const i = LP.length / 3; LP.push(...a, ...a, ...b, ...b); LO.push(...b, ...b, ...a, ...a); LS.push(-1, -1, 1, -1, 1, -1, -1, -1); LI.push(i, i + 1, i + 2, i, i + 2, i + 3); };
    for (const L of this.lines) {
      const hw = HALF[L.m] || 1.6, col = [...L.col, 0];
      L.p.forEach((p, pi) => {
        const b = L.bb[pi]; if (b[2] < X0 - 5 || b[0] > X1 + 5 || b[3] < Z0 - 5 || b[1] > Z1 + 5) return;
        // densify, keep runs of points inside the tile (+ one step margin so ribbons meet across tile edges)
        let run = [];
        const flush = () => {
          if (run.length >= 2) {
            let pl = null, pr = null;
            for (let i = 0; i < run.length; i++) {
              const a = run[Math.max(0, i - 1)], c = run[Math.min(run.length - 1, i + 1)];
              let tx = c[0] - a[0], tz = c[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
              const q = run[i], lx = q[0] - t.ox, lz = q[1] - t.oz;
              const l3 = [lx - tz * hw, g(lx - tz * hw, lz + tx * hw) + DY, lz + tx * hw], r3 = [lx + tz * hw, g(lx + tz * hw, lz - tx * hw) + DY, lz - tx * hw];
              if (pl) {
                const k = P.length / 3; P.push(...pl, ...l3, ...r3, ...pr); for (let j = 0; j < 4; j++) { N.push(0, 1, 0); C.push(...col); }
                I.push(k, k + 1, k + 2, k, k + 2, k + 3); line(pl, l3); line(pr, r3);
              }
              pl = l3; pr = r3;
            }
          }
          run = [];
        };
        for (let i = 2; i < p.length; i += 2) {
          const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP));
          for (let k = i === 2 ? 0 : 1; k <= n; k++) {
            const x = ax + (bx - ax) * k / n, z = ay + (by - ay) * k / n;
            if (x >= X0 - STEP && x <= X1 + STEP && z >= Z0 - STEP && z <= Z1 + STEP) run.push([x, z]); else flush();
          }
        }
        flush();
      });
    }
    if (!P.length) { t.metroEmpty = true; return; }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); fg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    fg.setAttribute('acol', new THREE.Float32BufferAttribute(C, 4)); fg.setIndex(I); fg.computeBoundingSphere();
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(LP, 3)); lg.setAttribute('other', new THREE.Float32BufferAttribute(LO, 3));
    lg.setAttribute('side', new THREE.Float32BufferAttribute(LS, 2)); lg.setIndex(LI); lg.computeBoundingSphere(); lg.boundingSphere.radius += 2;
    const grp = new THREE.Group(); grp.add(new THREE.Mesh(fg, facesMat), new THREE.Mesh(lg, linesMat));
    grp.children.forEach(m => { m.matrixAutoUpdate = false; m.updateMatrix(); m.renderOrder = 1; });
    grp.matrixAutoUpdate = false; grp.updateMatrix(); t.group.add(grp); t.metro = grp;
  }
}
