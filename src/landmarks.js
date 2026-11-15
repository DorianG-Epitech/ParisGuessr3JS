import * as THREE from 'three';
import { U, facesMat, linesMat, hullMat } from './shaders.js';
// Hand-built low-poly models of Paris landmarks, in the same outlined flat style as the tiles. Placement data
// (centre, axis bearing, ground altitude, IGN footprints to hide / reuse) comes from data/landmarks.json
// (tools/landmarks_gen.py, IGN BD TOPO). Models are built lazily near the player and dropped when far away.
// Local frame: u along the landmark axis (bearing b, clockwise from north), v = u rotated 90° clockwise, y up from ground.

const C = (r, g, b) => [r / 255, g / 255, b / 255, 1];
const STONE = C(236, 230, 212), STONE2 = C(226, 219, 200), LEAD = C(150, 157, 167), WHITE = C(251, 250, 245), GOLD = C(226, 192, 100),
  BRONZE = C(176, 142, 110), BRONZE2 = C(160, 128, 98), GLASS = C(198, 217, 228), COPPER = C(140, 184, 160), DARK = C(96, 100, 112),
  FRAME = C(242, 242, 238), BLUE = C(74, 124, 204), GREEN = C(84, 162, 96), YELLOW = C(232, 200, 64), RED = C(212, 74, 62), ROOF = C(196, 190, 182);

function makeMats(f0, f1) {
  const fr = { value: new THREE.Vector2(f0, f1) };
  const mk = m => { const c = m.clone(); c.uniforms = { ...U, fogRange: fr }; return c; };
  return { faces: mk(facesMat), lines: mk(linesMat), hull: mk(hullMat) };
}

class Kit {
  constructor(L) {
    this.cx = L.x; this.cz = L.z; this.Y = L.y; const b = L.b * Math.PI / 180; this.sb = Math.sin(b); this.cb = Math.cos(b);
    this.F = { p: [], n: [], c: [], i: [] }; this.L = { p: [], o: [], s: [], i: [] }; this.H = { p: [], n: [], i: [] }; this.walls = [];
  }
  W(p) { return [this.cx + p[0] * this.sb + p[1] * this.cb, this.Y + p[2], this.cz + p[0] * this.cb - p[1] * this.sb]; }   // local [u,v,y] -> data frame
  V(d) { return [d[0] * this.sb + d[1] * this.cb, d[2], d[0] * this.cb - d[1] * this.sb]; }
  // polygon (convex or fan-able), local points; normal points away from ref (local) if given
  face(pts, col, ref) {
    const P = pts.map(p => this.W(p));
    let n = norm(cross(sub(P[1], P[0]), sub(P[2], P[0])));
    if (ref) { if (dot(n, sub(P[0], this.W(ref))) < 0) n = n.map(x => -x); } else if (n[1] < 0) n = n.map(x => -x);
    const F = this.F, i0 = F.p.length / 3;
    for (const q of P) { F.p.push(...q); F.n.push(...n); F.c.push(...col); }
    for (let i = 1; i < P.length - 1; i++) F.i.push(i0, i0 + i, i0 + i + 1);
  }
  line(a, b, faint = 0) {
    const A = this.W(a), B = this.W(b), L = this.L, i = L.p.length / 3;
    L.p.push(...A, ...A, ...B, ...B); L.o.push(...B, ...B, ...A, ...A); L.s.push(-1, faint, 1, faint, 1, faint, -1, faint);
    L.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  pline(pts, faint = 0, closed = false) { for (let i = 0; i < pts.length - 1; i++) this.line(pts[i], pts[i + 1], faint); if (closed) this.line(pts[pts.length - 1], pts[0], faint); }
  wall(a, b, y0, y1) { const A = this.W([a[0], a[1], 0]), B = this.W([b[0], b[1], 0]); this.walls.push(A[0], A[2], B[0], B[2], this.Y + y0, this.Y + y1); }
  // extruded polygon [[u,v]...]: walls + roof + edge lines (+ optional faint storey lines)
  extrude(pts, y0, y1, col, roof = ROOF, { storey = 0, collide = true, top = true, vlines = true } = {}) {
    let A = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; A += a[0] * b[1] - b[0] * a[1]; }
    const s = A > 0 ? 1 : -1, n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], du = b[0] - a[0], dv = b[1] - a[1], dl = Math.hypot(du, dv); if (dl < 0.01) continue;
      const nl = this.V([s * dv / dl, -s * du / dl, 0]);
      const P = [[a[0], a[1], y0], [b[0], b[1], y0], [b[0], b[1], y1], [a[0], a[1], y1]].map(p => this.W(p)), F = this.F, i0 = F.p.length / 3;
      for (const q of P) { F.p.push(...q); F.n.push(...nl); F.c.push(...col); }
      F.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      this.line([a[0], a[1], y1], [b[0], b[1], y1]); this.line([a[0], a[1], Math.max(y0, -0.2)], [b[0], b[1], Math.max(y0, -0.2)]);
      const pr = pts[(i + n - 1) % n], eu = a[0] - pr[0], ev = a[1] - pr[1], el = Math.hypot(eu, ev);
      if (vlines && el > 0.01 && (eu * du + ev * dv) / (el * dl) < 0.9) this.line([a[0], a[1], Math.max(y0, -0.2)], [a[0], a[1], y1]);
      if (storey && dl > 2) for (let y = Math.max(y0, 0) + storey; y < y1 - 1; y += storey) this.line([a[0], a[1], y], [b[0], b[1], y], 1);
      if (collide) this.wall(a, b, y0, y1);
    }
    if (top) {
      const tri = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []);
      const F = this.F, i0 = F.p.length / 3;
      for (const p of pts) { F.p.push(...this.W([p[0], p[1], y1])); F.n.push(0, 1, 0); F.c.push(...roof); }
      for (const t of tri) F.i.push(i0 + t[0], i0 + t[1], i0 + t[2]);
    }
  }
  box(u0, u1, v0, v1, y0, y1, col, roof = col, o = {}) { this.extrude([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], y0, y1, col, roof, o); }
  // pitched roof over [u0,u1]x[v0,v1] from eaves y0 to ridge y1; ridge along u (alongU) or v; gable ends in wall colour
  gable(u0, u1, v0, v1, y0, y1, roof, wallc, alongU = true) {
    const c = [(u0 + u1) / 2, (v0 + v1) / 2, y0];
    if (alongU) {
      const vm = (v0 + v1) / 2;
      this.face([[u0, v0, y0], [u1, v0, y0], [u1, vm, y1], [u0, vm, y1]], roof, c); this.face([[u0, v1, y0], [u1, v1, y0], [u1, vm, y1], [u0, vm, y1]], roof, c);
      this.face([[u0, v0, y0], [u0, v1, y0], [u0, vm, y1]], wallc, c); this.face([[u1, v0, y0], [u1, v1, y0], [u1, vm, y1]], wallc, c);
      this.pline([[u0, v0, y0], [u0, vm, y1], [u0, v1, y0]]); this.pline([[u1, v0, y0], [u1, vm, y1], [u1, v1, y0]]); this.line([u0, vm, y1], [u1, vm, y1]);
    } else {
      const um = (u0 + u1) / 2;
      this.face([[u0, v0, y0], [u0, v1, y0], [um, v1, y1], [um, v0, y1]], roof, c); this.face([[u1, v0, y0], [u1, v1, y0], [um, v1, y1], [um, v0, y1]], roof, c);
      this.face([[u0, v0, y0], [u1, v0, y0], [um, v0, y1]], wallc, c); this.face([[u0, v1, y0], [u1, v1, y0], [um, v1, y1]], wallc, c);
      this.pline([[u0, v0, y0], [um, v0, y1], [u1, v0, y0]]); this.pline([[u0, v1, y0], [um, v1, y1], [u1, v1, y0]]); this.line([um, v0, y1], [um, v1, y1]);
    }
  }
  // surface of revolution around vertical axis at (u,v): profile [[r,y]...] bottom->top; hull outline, rings + some meridians as lines
  revolve(u, v, prof, n, col, { meridians = 0, ringLines = true, hull = true, cap = true, faint = false } = {}) {
    const ring = (r, y) => { const o = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; o.push([u + Math.cos(a) * r, v + Math.sin(a) * r, y]); } return o; };
    const rings = prof.map(([r, y]) => ring(r, y)), cy = (prof[0][1] + prof[prof.length - 1][1]) / 2, ctr = [u, v, cy];
    for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = rings[k][i], b = rings[k][j], c = rings[k + 1][j], d = rings[k + 1][i];
      if (prof[k + 1][0] < 1e-3) this.face([a, b, c], col, [u, v, prof[k][1] - 1]); else this.face([a, b, c, d], col, [u, v, (prof[k][1] + prof[k + 1][1]) / 2]);
    }
    const top = prof[prof.length - 1]; if (cap && top[0] > 1e-3) this.face(rings[rings.length - 1], col);
    if (ringLines) for (let k = 0; k < rings.length; k++) if (prof[k][0] > 1e-3 && (k === 0 || k === rings.length - 1 || ringLines === 'all')) this.pline(rings[k], faint ? 1 : 0, true);
    if (meridians) for (let i = 0; i < n; i += Math.max(1, Math.round(n / meridians))) this.pline(rings.map(r => r[i]), 1);
    if (hull) {
      const H = this.H, h0 = H.p.length / 3, wc = this.W(ctr);
      for (const r of rings) for (const p of r) { const w = this.W(p); H.p.push(...w); H.n.push(...norm(sub(w, wc))); }
      for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) {
        const j = (i + 1) % n; const tri = (a, b, c) => {
          const A = H.p.slice(a * 3, a * 3 + 3), B = H.p.slice(b * 3, b * 3 + 3), Cc = H.p.slice(c * 3, c * 3 + 3);
          if (dot(cross(sub(B, A), sub(Cc, A)), sub(A, wc)) >= 0) H.i.push(a, b, c); else H.i.push(a, c, b);
        };
        const a = h0 + k * n + i, b = h0 + k * n + j, c = h0 + (k + 1) * n + j, d = h0 + (k + 1) * n + i;
        tri(a, b, c); tri(a, c, d);
      }
    }
  }
  cyl(u, v, r, y0, y1, n, col, o = {}) { this.revolve(u, v, [[r, y0], [o.r1 ?? r, y1]], n, col, o); }
  dome(u, v, r, y0, h, n, col, o = {}) {   // half ellipsoid (k = profile exponent; <1 gives a pointier, onion-ish top)
    const prof = [], m = o.steps || 5, k = o.k || 1;
    for (let i = 0; i <= m; i++) { const t = i / m * Math.PI / 2; prof.push([r * Math.pow(Math.cos(t), k), y0 + h * Math.sin(t)]); }
    prof[m][0] = 0; this.revolve(u, v, prof, n, col, { meridians: o.meridians ?? n / 2, ...o });
  }
  // tube between two local points (columns, pipes, antennas)
  tube(a, b, r, n, col, hullOn = false) {
    const d = norm(sub(b, a)), t = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], e1 = norm(cross(d, t)), e2 = cross(d, e1);
    const ring = c => { const o = []; for (let i = 0; i < n; i++) { const q = i / n * Math.PI * 2, cs = Math.cos(q) * r, sn = Math.sin(q) * r; o.push([c[0] + e1[0] * cs + e2[0] * sn, c[1] + e1[1] * cs + e2[1] * sn, c[2] + e1[2] * cs + e2[2] * sn]); } return o; };
    const A = ring(a), B = ring(b), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.face([A[i], A[j], B[j], B[i]], col, mid); }
    this.face(B, col, mid);
    if (n <= 6) { this.line(A[0], B[0]); this.line(A[n >> 1], B[n >> 1]); }
    if (hullOn) {
      const H = this.H, h0 = H.p.length / 3, wa = this.W(a), wb = this.W(b);
      for (const [R, c] of [[A, wa], [B, wb]]) for (const p of R) { const w = this.W(p); H.p.push(...w); H.n.push(...norm(sub(w, c))); }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, wc = this.W(mid), tri = (x, y, z) => {
          const P = q => H.p.slice(q * 3, q * 3 + 3);
          if (dot(cross(sub(P(y), P(x)), sub(P(z), P(x))), sub(P(x), wc)) >= 0) H.i.push(x, y, z); else H.i.push(x, z, y);
        };
        tri(h0 + i, h0 + j, h0 + n + j); tri(h0 + i, h0 + n + j, h0 + n + i);
      }
    }
  }
  pyramid(u, v, half, y0, h, col, rot = 0, lattice = 0) {
    const cs = Math.cos(rot), sn = Math.sin(rot), P = (a, b) => [u + a * cs - b * sn, v + a * sn + b * cs];
    const base = [P(-half, -half), P(half, -half), P(half, half), P(-half, half)].map(p => [p[0], p[1], y0]), T = [u, v, y0 + h];
    for (let i = 0; i < 4; i++) {
      const a = base[i], b = base[(i + 1) % 4]; this.face([a, b, T], col, [u, v, y0 + h * 0.3]); this.line(a, b); this.line(a, T);
      for (let k = 1; k < lattice; k++) {   // rhombus glazing: lines parallel to the two sloping edges
        const t = k / lattice, ab = lerp3(a, b, t);
        this.line(ab, lerp3(b, T, 1 - t), 1); this.line(ab, lerp3(a, T, t), 1);
      }
    }
  }
  // pointed or round arch outline on a vertical plane: centre (u,v) on the face, across = unit [du,dv]
  archLine(u, v, du, dv, w, yb, ys, pointed = true, faint = 0) {
    const pts = [[u - du * w / 2, v - dv * w / 2, yb], [u - du * w / 2, v - dv * w / 2, ys]];
    const m = 6;
    for (let i = 1; i <= m; i++) {
      const t = i / m * Math.PI; let x = -Math.cos(t) * w / 2, y = Math.sin(t) * w / 2;
      if (pointed) y = Math.sin(t) * w * 0.85;
      pts.push([u + du * x, v + dv * x, ys + y]);
    }
    pts.push([u + du * w / 2, v + dv * w / 2, yb]);
    this.pline(pts, faint);
  }
  circle(u, v, du, dv, r, yc, n = 16, faint = 0, spokes = 0) {
    const P = a => [u + du * Math.cos(a) * r, v + dv * Math.cos(a) * r, yc + Math.sin(a) * r];
    for (let i = 0; i < n; i++) this.line(P(i / n * Math.PI * 2), P((i + 1) / n * Math.PI * 2), faint);
    for (let i = 0; i < spokes; i++) this.line([u, v, yc], P(i / spokes * Math.PI * 2), 1);
  }
  geometry() {
    const g = (B, kind) => {
      if (!B.p.length) return null;
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
      if (kind !== 'lines') geo.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
      if (kind === 'faces') geo.setAttribute('acol', new THREE.Float32BufferAttribute(B.c, 4));
      if (kind === 'lines') { geo.setAttribute('other', new THREE.Float32BufferAttribute(B.o, 3)); geo.setAttribute('side', new THREE.Float32BufferAttribute(B.s, 2)); }
      geo.setIndex(new THREE.Uint32BufferAttribute(B.i, 1)); geo.computeBoundingSphere(); if (kind === 'lines') geo.boundingSphere.radius += 2;
      return geo;
    };
    return { faces: g(this.F, 'faces'), lines: g(this.L, 'lines'), hull: g(this.H, 'hull') };
  }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const interp = (tab, x) => { for (let i = 0; i < tab.length - 1; i++) if (x <= tab[i + 1][0]) { const t = (x - tab[i][0]) / (tab[i + 1][0] - tab[i][0]); return tab[i][1] + (tab[i + 1][1] - tab[i][1]) * Math.max(0, t); } return tab[tab.length - 1][1]; };
const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

// ------------------------------------------------------------------------------------------------ models
const B = {};

B.eiffel = k => {
  const HW = y => interp([[0, 62.5], [20, 52], [40, 44], [57.6, 37.2], [85, 28.6], [115.7, 21], [150, 16], [180, 12.6], [220, 9.2], [250, 7.2], [276, 5.6], [300, 3.6]], y);
  const LW = y => interp([[0, 25], [57.6, 17], [115.7, 12], [180, 9]], y);
  const lv = [-1, 14, 28, 42, 57.6, 72, 86, 100, 115.7, 133, 150, 165, 180];
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const ring = y => { const o = HW(y), i = o - LW(y); return [[su * i, sv * i, y], [su * o, sv * i, y], [su * o, sv * o, y], [su * i, sv * o, y]]; };
    for (let l = 0; l < lv.length - 1; l++) {
      const A = ring(lv[l]), Bq = ring(lv[l + 1]), mid = [su * (HW(lv[l]) - LW(lv[l]) / 2), sv * (HW(lv[l]) - LW(lv[l]) / 2), lv[l]];
      for (let s = 0; s < 4; s++) {
        const a = A[s], b = A[(s + 1) % 4], c = Bq[(s + 1) % 4], d = Bq[s];
        k.face([a, b, c, d], s % 2 ? BRONZE : BRONZE2, mid); k.line(a, d);
        k.line(a, c, 1); k.line(b, d, 1);
      }
      k.pline([...Bq, Bq[0]], lv[l + 1] === 57.6 || lv[l + 1] === 115.7 ? 0 : 1);
    }
    const g = ring(0); k.extrude([g[0], g[1], g[2], g[3]].map(p => [p[0], p[1]]), -2, 0.01, BRONZE, BRONZE, { top: false, vlines: false });
  }
  const sv = [180, 200, 220, 250, 276, 300];
  for (let l = 0; l < sv.length - 1; l++) {
    const a = HW(sv[l]), b = HW(sv[l + 1]);
    const A = [[-a, -a, sv[l]], [a, -a, sv[l]], [a, a, sv[l]], [-a, a, sv[l]]], Bq = [[-b, -b, sv[l + 1]], [b, -b, sv[l + 1]], [b, b, sv[l + 1]], [-b, b, sv[l + 1]]];
    for (let s = 0; s < 4; s++) { const p = A[s], q = A[(s + 1) % 4], r = Bq[(s + 1) % 4], t = Bq[s]; k.face([p, q, r, t], s % 2 ? BRONZE : BRONZE2, [0, 0, sv[l]]); k.line(p, t); k.line(p, r, 1); k.line(q, t, 1); }
    k.pline([...Bq, Bq[0]], 1);
  }
  // platforms
  const p1o = 39, p1i = 24;
  for (const [u0, u1, v0, v1] of [[-p1o, p1o, p1i, p1o], [-p1o, p1o, -p1o, -p1i], [p1i, p1o, -p1i, p1i], [-p1o, -p1i, -p1i, p1i]]) k.box(u0, u1, v0, v1, 57.6, 64, BRONZE, BRONZE2, { collide: false });
  k.box(-22, 22, -22, 22, 115.7, 121, BRONZE, BRONZE2, { collide: false });
  k.box(-9, 9, -9, 9, 276, 283, BRONZE, BRONZE2, { collide: false });
  k.box(-3.6, 3.6, -3.6, 3.6, 300, 307, BRONZE, BRONZE2, { collide: false });
  k.tube([0, 0, 307], [0, 0, 324], 0.8, 6, BRONZE2, true); k.tube([0, 0, 324], [0, 0, 330], 0.35, 6, BRONZE2, true);
  // the four big arches under the first platform
  for (const [ax, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14 * Math.PI, y = 4 + 35 * Math.sin(t), half = HW(y) - LW(y) + 1, c = -Math.cos(t) * half, d = sgn * (HW(y) - 0.6);
      pts.push({ c, y, d, d2: d - sgn * 3 });
    }
    const P = (c, d, y) => ax ? [d, c, y] : [c, d, y];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], ref = P((a.c + b.c) / 2, 0, (a.y + b.y) / 2 - 10);
      k.face([P(a.c, a.d, a.y), P(b.c, b.d, b.y), P(b.c, b.d2, b.y), P(a.c, a.d2, a.y)], BRONZE2, ref);
      k.face([P(a.c, a.d, a.y), P(b.c, b.d, b.y), P(b.c, b.d, b.y + 2), P(a.c, a.d, a.y + 2)], BRONZE, P(a.c, 0, a.y));
      k.line(P(a.c, a.d, a.y), P(b.c, b.d, b.y)); k.line(P(a.c, a.d, a.y + 2), P(b.c, b.d, b.y + 2)); k.line(P(a.c, a.d2, a.y), P(b.c, b.d2, b.y), 1);
    }
  }
  for (const su of [-1, 1]) for (const sv2 of [-1, 1]) { const o = 62.5, i = 37.5; k.wall([su * i, sv2 * i], [su * o, sv2 * i], -2, 30); k.wall([su * o, sv2 * i], [su * o, sv2 * o], -2, 30); k.wall([su * o, sv2 * o], [su * i, sv2 * o], -2, 30); k.wall([su * i, sv2 * o], [su * i, sv2 * i], -2, 30); }
};

B.notredame = k => {
  // west front (u = -61.5) with the two towers, nave + choir with apse, double aisles, transept, spire, flying buttresses
  for (const s of [-1, 1]) {
    k.box(-61.5, -45.5, s > 0 ? 6.6 : -22.6, s > 0 ? 22.6 : -6.6, -3, 63, STONE, LEAD);
    for (const vv of [s * 11.5, s * 17.7]) k.archLine(-61.6, vv, 0, 1, 2.6, 46, 58, true);
    k.archLine(-61.6, s * 14.6, 0, 1, 5.5, 0, 9, true);
    k.pline([[-61.6, s * 6.6, 60.5], [-61.6, s * 22.6, 60.5]], 1);
  }
  k.box(-61.5, -47, -6.6, 6.6, -3, 45, STONE, LEAD);
  k.circle(-61.6, 0, 0, 1, 4.8, 27, 18, 0, 12); k.archLine(-61.6, 0, 0, 1, 6.5, 0, 11, true);
  for (const y of [18, 21.5, 33.5, 45]) k.line([-61.65, -22.6, y], [-61.65, 22.6, y], y === 45 ? 0 : 1);
  const apse = (r, uc) => { const o = []; for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + i / 8 * Math.PI; o.push([uc + Math.cos(a) * r, Math.sin(a) * r]); } return o; };
  k.extrude([[-45.5, -22], ...apse(22, 38), [-45.5, 22]], -3, 13, STONE2, LEAD);
  k.extrude([[-47, -6.5], ...apse(6.5, 38), [-47, 6.5]], -3, 33, STONE, LEAD, { collide: false });
  k.gable(-47, 38, -6.5, 6.5, 33, 43, LEAD, STONE);
  for (let i = 0; i < 8; i++) { const a0 = -Math.PI / 2 + i / 8 * Math.PI, a1 = a0 + Math.PI / 8; k.face([[38, 0, 43], [38 + Math.cos(a0) * 6.5, Math.sin(a0) * 6.5, 33], [38 + Math.cos(a1) * 6.5, Math.sin(a1) * 6.5, 33]], LEAD, [38, 0, 30]); k.line([38, 0, 43], [38 + Math.cos(a0) * 6.5, Math.sin(a0) * 6.5, 33]); }
  k.box(-5, 7, -25, 25, -3, 33, STONE, LEAD); k.gable(-5, 7, -25, 25, 33, 43, LEAD, STONE, false);
  for (const s of [-1, 1]) k.circle(1, s * 25.1, 1, 0, 4.4, 22, 16, 0, 10);
  k.cyl(1, 0, 3.2, 40, 52, 8, LEAD, { hull: true }); k.cyl(1, 0, 3.2, 52, 96, 8, LEAD, { r1: 0.05, hull: true, meridians: 8 });
  for (let u = -40; u <= 33; u += 7) {
    if (u > -9 && u < 11) continue;
    for (const s of [-1, 1]) {
      k.box(u - 0.8, u + 0.8, s * 20.4, s * 22.4, 0, 17, STONE2, STONE2, { collide: false }); k.pyramid(u, s * 21.4, 1, 17, 4, STONE2);
      const arc = []; for (let i = 0; i <= 4; i++) { const t = i / 4; arc.push([u, s * (21 - 14 * t), 15 + 14 * t - 4 * Math.sin(t * Math.PI)]); }
      const top = arc.map(p => [p[0], p[1], p[2] + 1.6]);
      for (let i = 0; i < 4; i++) k.face([arc[i], arc[i + 1], top[i + 1], top[i]], STONE2, [u - 5, 0, 20]);
      k.pline(arc); k.pline(top);
    }
  }
};

B.arc = k => {
  // 45 m wide (v) x 22 m deep (u) x 50 m; main arch 14.6 x 29.2 through u; side arches 8.4 x 18.7 through v
  const D = 11, Wd = 22.5, m = 7.3, sR = 4.2;
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const u0 = su > 0 ? sR : -D, u1 = su > 0 ? D : -sR, v0 = sv > 0 ? m : -Wd, v1 = sv > 0 ? Wd : -m;
    k.box(u0, u1, v0, v1, -3, 29.2, STONE, STONE);
  }
  const archFill = (axisU, half, ys, ytop, t0, t1) => {   // fill between a round arch and ytop, extruded along the other axis
    const n = 10, P = (s, y, t) => axisU ? [t, s, y] : [s, t, y], curve = [];
    for (let i = 0; i <= n; i++) { const a = Math.PI - i / n * Math.PI; curve.push([Math.cos(a) * half, ys + Math.sin(a) * half]); }
    for (const t of [t0, t1]) {
      for (let i = 0; i < n; i++) { const [s0, y0] = curve[i], [s1, y1] = curve[i + 1]; k.face([P(s0, y0, t), P(s1, y1, t), P(s1, ytop, t), P(s0, ytop, t)], STONE, P(0, ytop, (t0 + t1) / 2)); }
      k.pline(curve.map(([s, y]) => P(s, y, t)));
    }
    for (let i = 0; i < n; i++) { const [s0, y0] = curve[i], [s1, y1] = curve[i + 1]; k.face([P(s0, y0, t0), P(s1, y1, t0), P(s1, y1, t1), P(s0, y0, t1)], STONE2, P(0, ys, (t0 + t1) / 2)); }
  };
  archFill(true, m, 21.9, 29.2, -D, D);
  for (const sv of [-1, 1]) {
    const v0 = sv > 0 ? m : -Wd, v1 = sv > 0 ? Wd : -m;
    // side arch through the pier along v: piers above are already solid boxes -> cut look: fill between arch and 29.2 on u in [-sR, sR]
    archFillV(k, sR, 14.5, 29.2, v0, v1);
  }
  k.box(-D - 0.4, D + 0.4, -Wd - 0.4, Wd + 0.4, 29.2, 37, STONE, STONE, { collide: false });
  k.box(-D - 0.9, D + 0.9, -Wd - 0.9, Wd + 0.9, 37, 39, STONE2, STONE2, { collide: false });
  k.box(-D, D, -Wd, Wd, 39, 50, STONE, STONE2, { collide: false });
  for (const y of [42, 44.5, 48]) for (const su of [-1, 1]) k.line([su * (D + 0.05), -Wd, y], [su * (D + 0.05), Wd, y], 1);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {   // sculpture groups on the piers (outlines only)
    const vc = sv * 15; k.pline([[su * (D + 0.05), vc - 4, 4], [su * (D + 0.05), vc + 4, 4], [su * (D + 0.05), vc + 4, 15], [su * (D + 0.05), vc - 4, 15]], 0, true);
    k.pline([[su * (D + 0.05), vc - 4, 21], [su * (D + 0.05), vc + 4, 21], [su * (D + 0.05), vc + 4, 26], [su * (D + 0.05), vc - 4, 26]], 1, true);
  }
};
function archFillV(k, half, ys, ytop, v0, v1) {
  const n = 8, curve = [];
  for (let i = 0; i <= n; i++) { const a = Math.PI - i / n * Math.PI; curve.push([Math.cos(a) * half, ys + Math.sin(a) * half]); }
  for (const v of [v0, v1]) {
    for (let i = 0; i < n; i++) { const [s0, y0] = curve[i], [s1, y1] = curve[i + 1]; k.face([[s0, v, y0], [s1, v, y1], [s1, v, ytop], [s0, v, ytop]], STONE, [0, (v0 + v1) / 2, ytop]); }
    k.pline(curve.map(([s, y]) => [s, v, y]));
  }
  for (let i = 0; i < n; i++) { const [s0, y0] = curve[i], [s1, y1] = curve[i + 1]; k.face([[s0, v0, y0], [s1, v0, y1], [s1, v1, y1], [s0, v1, y0]], STONE2, [0, (v0 + v1) / 2, ys]); }
}

B.sacrecoeur = (k, L) => {
  k.extrude(L.bodies['8831'].pts, -5, 22, WHITE, WHITE);
  k.cyl(0, 0, 10.5, 22, 30, 20, WHITE); k.cyl(0, 0, 9.5, 30, 44, 20, WHITE, { meridians: 10 });
  k.cyl(0, 0, 10.4, 44, 46, 20, WHITE);
  k.dome(0, 0, 9.6, 46, 19, 20, WHITE, { k: 0.8, steps: 6 });
  k.cyl(0, 0, 2.6, 64, 70, 10, WHITE, { meridians: 5 }); k.dome(0, 0, 2.7, 70, 5, 10, WHITE); k.tube([0, 0, 74.5], [0, 0, 80], 0.25, 4, WHITE);
  const small = (u, v, r, y0, hd) => { k.cyl(u, v, r, y0, y0 + hd, 12, WHITE, { meridians: 6 }); k.dome(u, v, r, y0 + hd, r * 1.9, 12, WHITE, { k: 0.8 }); k.cyl(u, v, r * 0.3, y0 + hd + r * 1.8, y0 + hd + r * 2.6, 6, WHITE); };
  for (const s of [-1, 1]) { small(-23, s * 17, 3.4, 22, 7); small(9, s * 16, 3, 22, 6); }
  k.box(53.5, 65.5, -4.4, 7.6, -5, 47, WHITE, WHITE);
  k.cyl(59.6, 1.6, 4.6, 47, 57, 12, WHITE, { meridians: 6 }); k.dome(59.6, 1.6, 4.6, 57, 8, 12, WHITE, { k: 0.85 }); k.cyl(59.6, 1.6, 1.2, 64.5, 70, 6, WHITE);
  for (const v of [-6, 0, 6]) k.archLine(-31.2, v, 0, 1, 4.2, 0, 9, false);
};

B.pyramide = k => {
  k.pyramid(0, 0, 17.7, 0, 21.6, GLASS, 0, 9);
  for (const [u, v] of [[29, 0], [-29, 0], [0, 29]]) k.pyramid(u, v, 3.8, 0, 5, GLASS, 0, 3);
  k.wall([-17.7, -17.7], [17.7, -17.7], -1, 21); k.wall([17.7, -17.7], [17.7, 17.7], -1, 21); k.wall([17.7, 17.7], [-17.7, 17.7], -1, 21); k.wall([-17.7, 17.7], [-17.7, -17.7], -1, 21);
};

B.pantheon = (k, L) => {
  k.extrude(clipU(L.bodies['2436'].pts, -50), -3, 24, STONE, ROOF);
  // portico (west, u < -50): 6 columns front + pediment
  for (let i = 0; i < 6; i++) { const v = -14 + i * 5.6; k.tube([-60, v, 0], [-60, v, 19], 0.9, 8, STONE, true); }
  for (const v of [-14, 14]) for (const u of [-55, -51]) k.tube([u, v, 0], [u, v, 19], 0.9, 8, STONE, true);
  k.box(-62, -50, -16.5, 16.5, 19, 22.5, STONE, STONE, { collide: false }); k.gable(-62, -48, -16.5, 16.5, 22.5, 30, ROOF, STONE, true);
  k.box(-62, -60, -16.5, 16.5, -3, 0.3, STONE2, STONE2);
  // dome
  k.box(-17, 17, -17, 17, 24, 30, STONE, ROOF, { collide: false });
  k.cyl(0, 0, 12.8, 30, 47, 24, STONE2, { meridians: 0 });
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; k.tube([Math.cos(a) * 15.2, Math.sin(a) * 15.2, 30], [Math.cos(a) * 15.2, Math.sin(a) * 15.2, 44.5], 0.55, 5, STONE); }
  k.cyl(0, 0, 16, 44.5, 47, 24, STONE); k.cyl(0, 0, 13, 47, 54, 24, STONE2);
  k.dome(0, 0, 13, 54, 15, 24, C(206, 207, 203), { steps: 6, meridians: 12 });
  k.cyl(0, 0, 2.6, 68.5, 76, 8, STONE, { meridians: 4 }); k.dome(0, 0, 2.6, 76, 3.5, 8, STONE); k.tube([0, 0, 79.4], [0, 0, 83], 0.2, 4, STONE);
};
function clipU(pts, umin) {   // Sutherland-Hodgman against u >= umin
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ia = a[0] >= umin, ib = b[0] >= umin;
    if (ia) out.push(a);
    if (ia !== ib) { const t = (umin - a[0]) / (b[0] - a[0]); out.push([umin, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

B.invalides = (k, L) => {
  k.extrude(L.bodies['4904'].pts, -4, 28.7, STONE, ROOF);
  k.gable(-32.5, -26, -11, 11, 28.7, 34, ROOF, STONE, true);
  for (let i = 0; i < 6; i++) k.tube([-33.5, -9 + i * 3.6, 0], [-33.5, -9 + i * 3.6, 13], 0.55, 6, STONE);
  k.box(-16, 16, -16, 16, 28.7, 33, STONE, ROOF, { collide: false });
  k.cyl(0, 0, 13.6, 33, 51, 24, STONE, { meridians: 12 });
  for (let i = 0; i < 12; i++) { const a = (i + 0.5) / 12 * Math.PI * 2; k.box(Math.cos(a) * 14.5 - 0.6, Math.cos(a) * 14.5 + 0.6, Math.sin(a) * 14.5 - 0.6, Math.sin(a) * 14.5 + 0.6, 33, 50, STONE2, STONE2, { collide: false }); }
  k.cyl(0, 0, 14.8, 50, 52, 24, STONE); k.cyl(0, 0, 13, 52, 58, 24, STONE2);
  k.dome(0, 0, 13, 58, 21, 24, GOLD, { steps: 7, meridians: 12, k: 0.9 });
  k.cyl(0, 0, 3, 78, 89, 10, GOLD, { meridians: 5 }); k.cyl(0, 0, 1.6, 89, 106, 8, GOLD, { r1: 0.05 });
};

B.opera = (k, L) => {
  // body from the IGN footprint, facade (u < -49) rebuilt: arcades, loggia with paired columns, attic, end pavilions with gilded groups
  k.extrude(clipU(L.bodies['5873'].pts, -49), -3, 25, STONE, ROOF);
  k.extrude(L.bodies['0051'].pts, -3, 25.3, STONE, ROOF);
  k.extrude(L.bodies['5869'].pts, 0, 32, STONE2, ROOF, { collide: false });
  k.box(-56, -49, -28, 28, -3, 10, STONE, STONE);
  for (let i = 0; i < 7; i++) k.archLine(-56.05, -21 + i * 7, 0, 1, 4.6, 0, 6, false);
  k.box(-52, -49, -28, 28, 10, 21.5, STONE2, STONE2, { collide: false });
  k.box(-56, -52, -28, 28, 10, 10.8, STONE, STONE, { collide: false });
  for (let i = 0; i < 8; i++) for (const d of [-0.9, 0.9]) { const v = -24.5 + i * 7 + d; k.tube([-55.3, v, 10.8], [-55.3, v, 21.5], 0.5, 6, STONE); }
  k.box(-56, -49, -28, 28, 21.5, 24, STONE, STONE, { collide: false });
  k.box(-55, -49, -28, 28, 24, 28.5, STONE2, ROOF, { collide: false });
  for (const s of [-1, 1]) {
    k.box(-57, -47, s > 0 ? 28 : -36, s > 0 ? 36 : -28, -3, 27, STONE, ROOF);
    k.archLine(-57.05, s * 32, 0, 1, 4, 0, 6, false); k.circle(-57.05, s * 32, 0, 1, 1.6, 17, 10);
    k.box(-54, -50, s * 32 - 2, s * 32 + 2, 27, 28.5, STONE2, STONE2, { collide: false }); k.dome(-52, s * 32, 1.9, 28.5, 4, 8, GOLD, { meridians: 0 });
  }
  k.cyl(3, 0, 17, 25, 33, 24, STONE, { meridians: 12 }); k.dome(3, 0, 17, 33, 10, 24, COPPER, { meridians: 12, steps: 4 });
  k.cyl(3, 0, 2.4, 42.5, 46, 8, COPPER); k.dome(3, 0, 1.4, 46, 2.5, 6, GOLD, { meridians: 0 });
  k.box(22, 52, -24, 24, 32, 47, STONE, ROOF, { collide: false }); k.gable(22, 52, -24, 24, 47, 58, COPPER, STONE, true);
  k.tube([21.5, 0, 58], [21.5, 0, 61], 0.6, 6, GOLD); k.dome(21.5, 0, 1.2, 60.5, 2.6, 6, GOLD, { meridians: 0 });
  for (const s of [-1, 1]) k.dome(51.5, s * 23, 1.2, 47, 3, 6, GOLD, { meridians: 0 });
  for (const s of [-1, 1]) { k.cyl(12, s * 46, 8, 22, 25.5, 16, STONE); k.dome(12, s * 46, 8, 25.5, 5.5, 16, COPPER, { steps: 4 }); }
};

B.madeleine = k => {
  k.box(-52, 52, -21.5, 21.5, -4, 7, STONE2, STONE);
  for (let i = 0; i < 4; i++) k.box(-58 + i * 1.5, -52, -16, 16, -4, 1.75 * (i + 1), STONE2, STONE2, { collide: i === 0 });
  k.box(-45, 46, -15, 15, 7, 25, STONE, STONE, { collide: false });
  const cols = [];
  for (let i = 0; i < 8; i++) { const v = -19.6 + i * 5.6; cols.push([-50, v], [50, v]); }
  for (let i = 1; i < 17; i++) { const u = -50 + i * 100 / 17; cols.push([u, -19.6], [u, 19.6]); }
  for (const [u, v] of cols) k.tube([u, v, 7], [u, v, 24.5], 0.95, 6, STONE, true);
  k.box(-51.5, 51.5, -21, 21, 24.5, 28.5, STONE, STONE, { collide: false });
  k.gable(-51.5, 51.5, -21, 21, 28.5, 35, ROOF, STONE, true);
  k.line([-51.6, -21, 26.5], [-51.6, 21, 26.5], 1); k.line([51.6, -21, 26.5], [51.6, 21, 26.5], 1);
};

B.grandpalais = (k, L) => {
  k.extrude(L.bodies['2546'].pts, -3, 19, STONE, ROOF);
  const vault = (axisU, a0, a1, r, ys, off = 0) => {
    const n = 10, P = (s, y, t) => axisU ? [t, off + s, y] : [off + s, t, y];   // s across, t along
    const prof = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI; prof.push([Math.cos(a) * r, ys + Math.sin(a) * r]); }
    for (let i = 0; i < n; i++) k.face([P(prof[i][0], prof[i][1], a0), P(prof[i + 1][0], prof[i + 1][1], a0), P(prof[i + 1][0], prof[i + 1][1], a1), P(prof[i][0], prof[i][1], a1)], GLASS, P(0, ys, (a0 + a1) / 2));
    for (let i = 0; i <= n; i += 2) k.line(P(prof[i][0], prof[i][1], a0), P(prof[i][0], prof[i][1], a1), i % 4 ? 1 : 0);
    for (let t = a0; t <= a1 + 0.1; t += 8) k.pline(prof.map(p => P(p[0], p[1], Math.min(t, a1))), Math.abs(t - a0) < 0.1 || t + 8 > a1 + 0.1 ? 0 : 1);
  };
  vault(true, -96, 96, 20, 19); vault(false, -100, -18, 16, 19, 0);
  for (const s of [-1, 1]) {   // apsidal ends of the nave: quarter domes
    const n = 10, m = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const a0 = i / n * Math.PI, a1 = (i + 1) / n * Math.PI, e0 = j / m * Math.PI / 2, e1 = (j + 1) / m * Math.PI / 2;
      const P = (a, e) => [s * (96 + 20 * Math.cos(e) * Math.sin(a)), 20 * Math.cos(e) * Math.cos(a), 19 + 20 * Math.sin(e)];
      k.face([P(a0, e0), P(a1, e0), P(a1, e1), P(a0, e1)], GLASS, [s * 96, 0, 19]);
      if (j === 0) k.line(P(a0, e0), P(a1, e0)); if (i % 2 === 0) k.line(P(a0, e0), P(a0, e1), 1);
    }
  }
  k.cyl(0, 0, 17, 19, 37, 20, GLASS, { meridians: 10, faint: true });
  k.dome(0, 0, 17, 37, 9, 20, GLASS, { meridians: 10, steps: 4 });
  k.cyl(0, 0, 1.8, 45.5, 48.5, 8, FRAME); k.tube([0, 0, 48.5], [0, 0, 58], 0.15, 4, FRAME);
  for (const s of [-1, 1]) { k.box(s * 104 - 3, s * 104 + 3, 48, 56, 19, 22, STONE, STONE, { collide: false }); k.dome(s * 104, 52, 2.6, 22, 5, 8, BRONZE2, { meridians: 0 }); }
};

B.pompidou = k => {
  const U0 = -83, U1 = 83, V = 30;
  k.box(U0, U1, -V, V, -3, 42, GLASS, FRAME);
  for (let y = 7; y < 42; y += 7) for (const s of [-1, 1]) k.line([U0, s * V, y], [U1, s * V, y], 1);
  for (let i = 0; i <= 13; i++) {
    const u = U0 + i * 166 / 13;
    for (const s of [-1, 1]) {
      k.tube([u, s * (V + 3), -0.5], [u, s * (V + 3), 42.5], 0.45, 6, FRAME);
      k.line([u, s * V, 0], [u, s * V, 42], 1);
      if (i < 13) for (let y = 0; y < 42; y += 7) { const u2 = U0 + (i + 1) * 166 / 13; k.line([u, s * (V + 3), y], [u2, s * (V + 3), y + 7], 1); k.line([u, s * (V + 3), y + 7], [u2, s * (V + 3), y], 1); }
    }
  }
  for (let y = 7; y <= 42; y += 7) for (const s of [-1, 1]) k.line([U0, s * (V + 3), y], [U1, s * (V + 3), y]);
  const cols = [BLUE, GREEN, YELLOW, RED];
  for (let i = 0; i < 15; i++) {
    const u = -74 + i * 10.6, top = 42 + (i * 7 % 5) * 1.6, c = cols[(i * 3) % 4], r = i % 3 === 0 ? 1.5 : 1.0;
    k.tube([u, V + 6, -0.5], [u, V + 6, top], r, 8, c, true); k.tube([u, V + 6, top], [u, V + 1, top], r, 8, c, true);
  }
  for (const [u, v, r] of [[-60, 14, 3], [-30, -12, 2.4], [40, 10, 3], [62, -14, 2.4], [10, 16, 2]]) k.cyl(u, v, r, 42, 47.5, 12, FRAME, { r1: r * 0.85 });
  let u = 75, y = 0.5;   // escalator tube on the piazza side, zigzag of flights
  for (let f = 0; f < 6; f++) { const u2 = u - 22, y2 = Math.min(y + 7, 42); k.tube([u, -(V + 6), y + 1.5], [u2, -(V + 6), y2 + 1.5], 1.7, 8, C(232, 238, 242), true); k.tube([u2, -(V + 6), y2 + 1.5], [u2 - 3, -(V + 6), y2 + 1.5], 1.7, 8, C(232, 238, 242), true); u = u2 - 3; y = y2; }
};

B.montparnasse = (k, L) => {
  const pts = L.bodies['9410'].pts;
  k.extrude(pts, -4, 205, DARK, C(80, 84, 92), { storey: 3.6 });
  const cu = pts.reduce((a, p) => a + p[0], 0) / pts.length, cv = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  k.extrude(pts.map(p => [cu + (p[0] - cu) * 0.82, cv + (p[1] - cv) * 0.82]), 205, 209.5, C(110, 114, 124), C(84, 88, 96), { collide: false });
  k.tube([cu, cv, 209.5], [cu, cv, 222], 0.5, 6, FRAME, true);
};

B.sulpice = (k, L) => {
  for (const id of ['7858', '7859', '7855']) k.extrude(L.bodies[id].pts, -4, 23.4, STONE, ROOF);
  k.box(-45, 52, -9.5, 9.5, 23.4, 28, STONE, ROOF, { collide: false }); k.gable(-45, 52, -9.5, 9.5, 28, 35, LEAD, STONE, true);
  k.box(-55, -45, -28, 28, -4, 32, STONE, ROOF);
  for (let i = 0; i < 10; i++) { const v = -19 + i * 38 / 9; k.tube([-57.4, v, 0], [-57.4, v, 13.5], 0.7, 6, STONE); k.tube([-57.4, v, 15.5], [-57.4, v, 27.5], 0.6, 6, STONE); }
  k.box(-58.6, -55, -21, 21, 13.5, 15.5, STONE2, STONE2, { collide: false }); k.box(-58.6, -55, -21, 21, 27.5, 30, STONE2, STONE2, { collide: false });
  k.box(-58.6, -55, -21, 21, -4, 0.4, STONE2, STONE2);
  for (const [s, top] of [[-1, 70], [1, 66]]) {
    const v = s * 21.5;
    k.box(-58.6, -45.4, v - 6.6, v + 6.6, -4, 46, STONE, STONE);
    k.box(-58, -46, v - 6, v + 6, 46, 52, STONE2, STONE2, { collide: false });
    k.cyl(-52, v, 5.8, 52, top - 5, 16, STONE, { meridians: 8 }); k.cyl(-52, v, 4.4, top - 5, top, 16, STONE2, { meridians: 8 });
    k.archLine(-58.7, v, 0, 1, 3, 32, 40, false);
  }
};

// ------------------------------------------------------------------------------------------------ manager
const RANGE = { eiffel: 2600, montparnasse: 2000, sacrecoeur: 1700, invalides: 1300, pantheon: 1100, notredame: 900 };
export class Landmarks {
  constructor(root, list, fogEnd) {
    this.root = root; this.list = list; this.std = { faces: facesMat, lines: linesMat, hull: hullMat };
    for (const L of list) { L.range = RANGE[L.id] || 0; L.mats = L.range ? makeMats(Math.max(fogEnd, 380), L.range) : this.std; }
    this.fogEnd = fogEnd;
  }
  /** IGN footprints (world frame) replaced by the models: the tile builder skips buildings inside them */
  exclusions() { return this.list.flatMap(L => L.excl); }
  update(px, pz) {
    let built = false;
    for (const L of this.list) {
      const d = Math.hypot(L.x - px, L.z - pz), R = Math.max(L.range, this.fogEnd) + 150;
      if (!L.group && d < R && !built) { this.build(L); built = true; }
      else if (L.group && d > R + 300) { this.root.remove(L.group); L.geos.forEach(g => g.dispose()); L.group = null; L.walls = null; }
    }
  }
  build(L) {
    const k = new Kit(L);
    try { B[L.id](k, L); } catch (e) { console.error('[PG] landmark', L.id, e); L.group = new THREE.Group(); L.geos = []; return; }
    const g = k.geometry(), grp = new THREE.Group();
    if (g.faces) grp.add(new THREE.Mesh(g.faces, L.mats.faces)); if (g.lines) grp.add(new THREE.Mesh(g.lines, L.mats.lines)); if (g.hull) grp.add(new THREE.Mesh(g.hull, L.mats.hull));
    grp.matrixAutoUpdate = false; grp.children.forEach(c => { c.matrixAutoUpdate = false; c.frustumCulled = true; });
    this.root.add(grp); L.group = grp; L.geos = [g.faces, g.lines, g.hull].filter(Boolean); L.walls = new Float32Array(k.walls);
    console.log(`[PG] landmark ${L.id}: ${(g.faces?.index.count || 0) / 3} tris, ${(g.lines?.index.count || 0) / 6} lines`);
  }
  get builtCount() { return this.list.filter(L => L.group).length; }
  collide(x, z, r, feetY) {
    for (const L of this.list) {
      if (!L.walls || Math.hypot(L.x - x, L.z - z) > 260) continue;
      const w = L.walls;
      for (let it = 0; it < 2; it++) for (let i = 0; i < w.length; i += 6) {
        if (feetY + 1.6 < w[i + 4] || feetY + 0.35 > w[i + 5]) continue;
        const ax = w[i], az = w[i + 1], ex = w[i + 2] - ax, ez = w[i + 3] - az, L2 = ex * ex + ez * ez; if (L2 < 1e-6) continue;
        const s = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)), dx = x - (ax + ex * s), dz = z - (az + ez * s), dd = Math.hypot(dx, dz);
        if (dd < r && dd > 1e-5) { x += dx / dd * (r - dd); z += dz / dd * (r - dd); }
      }
    }
    return [x, z];
  }
}
