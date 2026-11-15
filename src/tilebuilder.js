import * as THREE from 'three';
// Port of TileBuilder.cs (+ web extras): turns a compact "PGT2" tile into faces (flat, vertex coloured), outline quads, tree hulls,
// plus collision data (terrain grid, wall segments, bridge decks). Local frame = Unity's: x = East, y = up, z = North
// (the scene root mirrors z so three.js stays right-handed).

const C = (r, g, b, a = 255) => [r / 255, g / 255, b / 255, a / 255];
const cPave = C(229, 226, 219), cGreen = C(203, 225, 186), cWater = C(178, 207, 231);
// road colours = guess map (make_map.py): white streets, light yellow (importance 3), yellow (importance 1-2 / autoroutier).
// alpha < 1 = depth pull towards the camera; majors pull a bit more so they win where they cross minor streets.
const cRoads = [C(250, 250, 247, 26), C(255, 236, 180, 13), C(247, 213, 139, 0)];
const cRoadsDeck = [C(250, 250, 247), C(255, 236, 180), C(247, 213, 139)];
const cWall = C(246, 243, 236), cRoof = C(214, 209, 201), cAttic = C(226, 221, 212), cAtticRoof = C(190, 186, 182), cDeck = C(212, 209, 203);
// tree types: 0 rond (tilleul, érable...), 1 platane, 2 marronnier, 3 conifère, 4 élancé (peuplier, ginkgo, bouleau), 5 petit, 6 fleuri
const cCrowns = [C(178, 208, 150), C(196, 217, 160), C(150, 189, 131), C(124, 166, 137), C(188, 215, 146), C(201, 223, 170), C(238, 203, 214)];
const cTrunks = [C(146, 132, 118), C(200, 192, 168), C(128, 114, 103), C(138, 116, 97), C(206, 202, 192), C(146, 132, 118), C(142, 122, 116)];
// metro entrances
const cHole = C(92, 94, 100, 0), cStep = C(120, 122, 128, 0), cMuret = C(214, 210, 202), cPole = C(78, 92, 86), cSign = C(244, 204, 64), cSignM = C(30, 30, 34);
const cGuimard = C(70, 112, 88), cGPanel = C(236, 196, 104), cLamp = C(240, 140, 66);

class Buf {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; this.o = []; this.s = []; }
  get count() { return this.p.length / 3; }
}

const T = (1 + Math.sqrt(5)) / 2;
const ICO = [[-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0], [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T], [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1]]
  .map(v => { const l = Math.hypot(...v); return v.map(x => x / l); });
const ICOT = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];

// world-frame polygons (landmarks.json "excl") whose buildings are replaced by hand-built models
let EXCL = [];
export function setExclusions(polys) {
  EXCL = polys.map(p => { const xs = p.map(q => q[0]), zs = p.map(q => q[1]); return { p, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }; });
}
function excluded(ring, origin) {
  let x = 0, z = 0; for (const q of ring) { x += q[0]; z += q[1]; } x = x / ring.length + origin.x; z = z / ring.length + origin.z;
  for (const e of EXCL) {
    if (x < e.x0 || x > e.x1 || z < e.z0 || z > e.z1) continue;
    let inside = false; const p = e.p;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
    if (inside) return true;
  }
  return false;
}
export function buildTile(buffer) {
  const d = new DataView(buffer); let o = 4;
  const f32 = () => { const v = d.getFloat32(o, true); o += 4; return v; };
  const i32 = () => { const v = d.getInt32(o, true); o += 4; return v; };
  const u16 = () => { const v = d.getUint16(o, true); o += 2; return v; };
  const i16 = () => { const v = d.getInt16(o, true); o += 2; return v; };
  const u8 = () => d.getUint8(o++);
  const F = new Buf(), L = new Buf(), H = new Buf();
  const walls = [];   // [ax, az, bx, bz, ymin, ymax]
  const decks = [];   // [lx0,lz0,ly0, lx1,lz1,ly1, rx1,rz1,ry1, rx0,rz0,ry0]
  const origin = { x: f32(), z: f32() };

  // ---- terrain grid
  const gn = u8(), gsp = f32(); const gh = new Float32Array(gn * gn);
  for (let i = 0; i < gn * gn; i++) gh[i] = u16() / 100;
  const cls = new Uint8Array(buffer, o, gn * gn); o += gn * gn;
  const ground = (x, z) => {
    const fx = Math.min(Math.max(x / gsp, 0), gn - 1.001), fz = Math.min(Math.max(z / gsp, 0), gn - 1.001);
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz;
    const a = gh[iz * gn + ix], b = gh[iz * gn + ix + 1], c = gh[(iz + 1) * gn + ix], e = gh[(iz + 1) * gn + ix + 1];
    return tx > tz ? a + (b - a) * tx + (e - b) * tz : a + (c - a) * tz + (e - c) * tx;
  };
  const vert = (B, x, y, z, nx, ny, nz, col) => { B.p.push(x, y, z); B.n.push(nx, ny, nz); B.c.push(...col); };
  const quad = (a, b, c, e, n, col) => {
    const i = F.count;
    for (const v of [a, b, c, e]) vert(F, v[0], v[1], v[2], n[0], n[1], n[2], col);
    F.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const line = (a, b, faint = 0) => {
    const i = L.count;
    L.p.push(...a, ...a, ...b, ...b); L.o.push(...b, ...b, ...a, ...a);
    L.s.push(-1, faint, 1, faint, 1, faint, -1, faint);
    L.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };

  const t0 = F.count;
  for (let j = 0; j < gn; j++) for (let i = 0; i < gn; i++) {
    const k = j * gn + i;
    const hx = gh[j * gn + Math.min(i + 1, gn - 1)] - gh[j * gn + Math.max(i - 1, 0)];
    const hz = gh[Math.min(j + 1, gn - 1) * gn + i] - gh[Math.max(j - 1, 0) * gn + i];
    const l = Math.hypot(hx, 2 * gsp, hz);
    vert(F, i * gsp, gh[k], j * gsp, -hx / l, 2 * gsp / l, -hz / l, cls[k] === 2 ? cWater : cls[k] === 1 ? cGreen : cPave);
  }
  for (let j = 0; j < gn - 1; j++) for (let i = 0; i < gn - 1; i++) {
    const a = t0 + j * gn + i, b = a + 1, c = a + gn, e = c + 1;
    F.i.push(a, c, e, a, e, b);
  }

  // ---- prisms (buildings + attic storeys); footprints replaced by hand-built landmarks are skipped
  const np = i32();
  for (let p = 0; p < np; p++) {
    const kind = u8(), z0 = u16() / 100, z1 = u16() / 100, nr = u8();
    const rings = [];
    for (let q = 0; q < nr; q++) { const n = u16(); const ring = []; for (let i = 0; i < n; i++) { const x = i16() / 10, z = i16() / 10; ring.push([x, z]); } rings.push(ring); }
    const nt = u16(); const tris = []; for (let i = 0; i < nt * 3; i++) tris.push(u16());
    if (EXCL.length && rings.length && excluded(rings[0], origin)) continue;
    const all = []; const wc = kind === 0 ? cWall : cAttic, rc = kind === 0 ? cRoof : cAtticRoof;
    for (const ring of rings) {
      const n = ring.length;
      all.push(...ring);
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n], pr = ring[(i + n - 1) % n];
        const dx = b[0] - a[0], dz = b[1] - a[1], dl = Math.hypot(dx, dz); if (dl < 0.01) continue;
        const nrm = [dz / dl, 0, -dx / dl];
        quad([a[0], z0, a[1]], [b[0], z0, b[1]], [b[0], z1, b[1]], [a[0], z1, a[1]], nrm, wc);
        if (kind === 0) walls.push(a[0], a[1], b[0], b[1], z0, z1);
        line([a[0], z1, a[1]], [b[0], z1, b[1]]);
        if (kind === 1) line([a[0], z0, a[1]], [b[0], z0, b[1]]);
        else {
          line([a[0], Math.max(z0, ground(a[0], a[1])), a[1]], [b[0], Math.max(z0, ground(b[0], b[1])), b[1]]);
          if (dl > 3) {
            const g0 = Math.max(ground(a[0], a[1]), ground(b[0], b[1]));
            for (let fz = g0 + 4; fz < z1 - 1.2; fz += 3) line([a[0], fz, a[1]], [b[0], fz, b[1]], 1);
          }
        }
        const ex = a[0] - pr[0], ez = a[1] - pr[1], el = Math.hypot(ex, ez);
        if (el > 0.01 && (ex * dx + ez * dz) / (el * dl) < 0.87)
          line([a[0], kind === 0 ? Math.max(z0, ground(a[0], a[1])) : z0, a[1]], [a[0], z1, a[1]]);
      }
    }
    const base = F.count;
    for (const v of all) vert(F, v[0], z1, v[1], 0, 1, 0, rc);
    for (const ix of tris) F.i.push(base + ix);
  }

  // ---- roads: ribbons draped on the terrain (subdivided across), bridges at their own deck altitude
  const nroads = i32();
  for (let k = 0; k < nroads; k++) {
    const fl = u8(), bridge = (fl & 1) !== 0, rc = (fl >> 1) & 3, w = u16() / 10, n = u16();
    const pts = []; for (let i = 0; i < n; i++) { const x = i16() / 10, z = i16() / 10; pts.push([x, z]); }
    const zs = []; if (bridge) for (let i = 0; i < n; i++) zs.push(u16() / 100);
    if (n < 2) continue;
    const lat = bridge ? 1 : Math.min(Math.max(Math.ceil(w / 2.5), 1), 10);
    let prevRow = null, pl = null, pr = null;
    for (let i = 0; i < n; i++) {
      let tx = i === 0 ? pts[1][0] - pts[0][0] : i === n - 1 ? pts[i][0] - pts[i - 1][0] : pts[i + 1][0] - pts[i - 1][0];
      let tz = i === 0 ? pts[1][1] - pts[0][1] : i === n - 1 ? pts[i][1] - pts[i - 1][1] : pts[i + 1][1] - pts[i - 1][1];
      let tl = Math.hypot(tx, tz); if (tl < 1e-6) { tx = 1; tz = 0; tl = 1; }
      tx /= tl; tz /= tl; const sx = -tz * w / 2, sz = tx * w / 2;
      const Lx = pts[i][0] + sx, Lz = pts[i][1] + sz, Rx = pts[i][0] - sx, Rz = pts[i][1] - sz;
      let row, l3, r3;
      if (bridge) { l3 = [Lx, zs[i], Lz]; r3 = [Rx, zs[i], Rz]; }
      else {
        row = [];
        for (let j = 0; j <= lat; j++) { const t = j / lat, qx = Lx + (Rx - Lx) * t, qz = Lz + (Rz - Lz) * t; row.push([qx, ground(qx, qz) + 0.03, qz]); }
        l3 = row[0]; r3 = row[lat];
      }
      if (i > 0) {
        if (bridge) {
          quad(pl, l3, r3, pr, [0, 1, 0], cRoadsDeck[rc]);
          decks.push(...pl, ...l3, ...r3, ...pr);
          const dn = v => [v[0], v[1] - 1.2, v[2]], up = v => [v[0], v[1] + 1.0, v[2]];
          quad(pl, l3, dn(l3), dn(pl), [0, 1, 0], cDeck); quad(pr, r3, dn(r3), dn(pr), [0, 1, 0], cDeck);
          line(pl, l3); line(pr, r3); line(dn(pl), dn(l3)); line(dn(pr), dn(r3));
          quad(pl, l3, up(l3), up(pl), [0, 1, 0], cDeck); quad(pr, r3, up(r3), up(pr), [0, 1, 0], cDeck);
          line(up(pl), up(l3)); line(up(pr), up(r3));
          walls.push(pl[0], pl[2], l3[0], l3[2], Math.min(pl[1], l3[1]) - 1.2, Math.max(pl[1], l3[1]) + 1, pr[0], pr[2], r3[0], r3[2], Math.min(pr[1], r3[1]) - 1.2, Math.max(pr[1], r3[1]) + 1);
        } else for (let j = 0; j < lat; j++) quad(prevRow[j], row[j], row[j + 1], prevRow[j + 1], [0, 1, 0], cRoads[rc]);
      }
      pl = l3; pr = r3; prevRow = row;
    }
  }

  // ---- kerbs
  const nc = i32();
  for (let k = 0; k < nc; k++) {
    const n = u16(); let prev = null;
    for (let i = 0; i < n; i++) {
      const x = i16() / 10, z = i16() / 10, p3 = [x, ground(x, z) + 0.05, z];
      if (prev) line(prev, p3, -1); prev = p3;
    }
  }

  // ---- trees (genus-based shapes, faceted crowns, inverted-hull outlines)
  const ntr = i32();
  for (let k = 0; k < ntr; k++) {
    const x = i16() / 10, z = i16() / 10, h = u8() / 4, ty = Math.min(u8(), 6), circ = u8() * 4, maxR = u8() / 10;
    const hs = hash(x, z);
    tree(x, ground(x, z), z, Math.max(h, 2.5), ty, circ, maxR, hs);
  }

  // ---- metro entrances (no line numbers / names)
  const nme = i32();
  for (let k = 0; k < nme; k++) {
    const x = i16() / 10, z = i16() / 10, hd = u8() / 256 * Math.PI * 2, style = u8();
    metro(x, z, hd, style);
  }

  // convex piece: flat-shaded faces + smooth inverted hull, both wound outward from centre c
  function convex(pv, tris, c, col, withHull = true) {
    for (let f = 0; f < tris.length; f += 3) {
      const a = pv[tris[f]], b = pv[tris[f + 1]], e = pv[tris[f + 2]];
      let n = norm(cross(sub(b, a), sub(e, a))); if (dot(n, sub(a, c)) < 0) n = n.map(v => -v);
      const i = F.count; for (const v of [a, b, e]) vert(F, v[0], v[1], v[2], n[0], n[1], n[2], col); F.i.push(i, i + 1, i + 2);
    }
    if (!withHull) return;
    const h0 = H.count;
    for (const v of pv) { H.p.push(...v); H.n.push(...norm(sub(v, c))); }
    for (let f = 0; f < tris.length; f += 3) {
      let a = tris[f], b = tris[f + 1], e = tris[f + 2];
      if (dot(cross(sub(pv[b], pv[a]), sub(pv[e], pv[a])), sub(pv[a], c)) < 0) [b, e] = [e, b];
      H.i.push(h0 + a, h0 + b, h0 + e);
    }
  }
  function blob(cx, cy, cz, rx, ry, rz, rot, seed, col) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const pv = ICO.map((v, i) => {
      const j = 1 + (frac(seed * 7.13 + i * 0.618) - 0.5) * 0.26;
      const x = v[0] * rx * j, y = v[1] * ry * j, zz = v[2] * rz * j;
      return [cx + x * cs + zz * sn, cy + y, cz - x * sn + zz * cs];
    });
    convex(pv, ICOT, [cx, cy, cz], col);
  }
  function ring(cx, cy, cz, r, n, rot) { const out = []; for (let i = 0; i < n; i++) { const a = rot + i / n * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r]); } return out; }
  function cone(cx, y0, y1, cz, r, n, rot, col) {
    const pv = [...ring(cx, y0, cz, r, n, rot), [cx, y1, cz], [cx, y0, cz]], tris = [];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; tris.push(i, j, n, j, i, n + 1); }
    convex(pv, tris, [cx, y0 + (y1 - y0) * 0.3, cz], col);
  }
  function prism(cx, y0, y1, cz, r, n, rot, col, withHull = true, r1 = r) {
    const pv = [...ring(cx, y0, cz, r, n, rot), ...ring(cx, y1, cz, r1, n, rot)], tris = [];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; tris.push(i, j, n + j, i, n + j, n + i); }
    convex(pv, tris, [cx, (y0 + y1) / 2, cz], col, withHull);
  }
  function tree(px, py, pz, h, ty, circ, maxR, hs) {
    const r1 = frac(hs * 0.000173), r2 = frac(hs * 0.000391), rot = r1 * 6.283;
    const v = 0.93 + 0.12 * r2, cc = cCrowns[ty], col = [cc[0] * v, cc[1] * v, cc[2] * v, 1];
    const tr = Math.min(Math.max(circ > 0 ? circ / 628 : h * 0.012, 0.07), 0.4), tc = cTrunks[ty];
    const lim = r => Math.max(Math.min(r, maxR), 0.8);
    let top;   // trunk top (inside the crown)
    if (ty === 3) {          // conifère: two stacked cones
      const r0 = lim(Math.min(0.21 * h, 4.2));
      cone(px, py + 0.13 * h, py + 0.74 * h, pz, r0, 7, rot, col);
      cone(px, py + 0.46 * h, py + h, pz, r0 * 0.68, 7, rot + 0.4, col);
      top = py + 0.5 * h;
    } else if (ty === 1) {   // platane: wide, two lobes
      const rx = lim(Math.min(0.34 * h, 8)), ry = 0.26 * h, cy = py + h - ry, ox = Math.cos(rot) * rx * 0.36, oz = Math.sin(rot) * rx * 0.36;
      blob(px + ox, cy, pz + oz, rx * 0.7, ry, rx * 0.66, rot, hs, col);
      blob(px - ox, cy + ry * 0.12, pz - oz, rx * 0.66, ry * 0.92, rx * 0.62, rot + 1.1, hs + 3, col);
      top = cy;
    } else {
      const P = [[0.26, 0.32, 5.5], null, [0.3, 0.39, 6.5], null, [0.1, 0.41, 2.4], [0.33, 0.3, 3.6], [0.33, 0.3, 3.6]][ty];
      const rx = lim(Math.max(Math.min(P[0] * h, P[2]), ty === 4 ? 1.0 : 0)), ry = P[1] * h, cy = py + h - ry;
      blob(px, cy, pz, rx, ry, rx * (0.9 + 0.2 * r2), rot, hs, col);
      top = cy;
    }
    prism(px, py - 0.4, top, pz, tr, 6, rot, tc, true, tr * 0.7);
  }

  function metro(cx, cz, hd, style) {
    const dx = Math.sin(hd), dz = Math.cos(hd), qx = dz, qz = -dx;   // along / across
    const P = (a, b) => [cx + dx * a + qx * b, cz + dz * a + qz * b];
    const g = ground(cx, cz);
    const at = (a, b, y) => { const p = P(a, b); return [p[0], g + y, p[1]]; };
    const L = 2.6, W = 0.95;
    // opening + steps (pulled like roads so it sits on the pavement)
    quad(at(-L, -W, 0.08), at(L, -W, 0.08), at(L, W, 0.08), at(-L, W, 0.08), [0, 1, 0], cHole);
    for (let s = -L + 0.45; s < L - 0.2; s += 0.42) line(at(s, -W, 0.09), at(s, W, 0.09), -1);
    quad(at(-L, -W * 0.15, 0.085), at(-L + 0.2, -W * 0.15, 0.085), at(-L + 0.2, W * 0.15, 0.085), at(-L, W * 0.15, 0.085), [0, 1, 0], cStep);
    // balustrade on three sides (open end at +L): low stone wall + rail
    const sides = [[[L, -W], [-L, -W]], [[-L, -W], [-L, W]], [[-L, W], [L, W]]];
    for (const [a, b] of sides) {
      const A = P(...a), B = P(...b), ga = ground(A[0], A[1]), gb = ground(B[0], B[1]);
      const nx = (B[1] - A[1]), nz = -(B[0] - A[0]), nl = Math.hypot(nx, nz) || 1;
      quad([A[0], ga - 0.3, A[1]], [B[0], gb - 0.3, B[1]], [B[0], gb + 0.32, B[1]], [A[0], ga + 0.32, A[1]], [nx / nl, 0, nz / nl], style ? cGuimard : cMuret);
      line([A[0], ga + 0.32, A[1]], [B[0], gb + 0.32, B[1]]); line([A[0], ga + 0.02, A[1]], [B[0], gb + 0.02, B[1]], -1);
      line([A[0], ga + 1.0, A[1]], [B[0], gb + 1.0, B[1]]);
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]), np = Math.max(1, Math.round(len / 0.55));
      for (let i = 0; i <= np; i++) { const t = i / np, x = A[0] + (B[0] - A[0]) * t, z = A[1] + (B[1] - A[1]) * t, y = ga + (gb - ga) * t; line([x, y + 0.32, z], [x, y + 1.0, z], i % 2 && i !== np ? 1 : 0); }
      walls.push(A[0], A[1], B[0], B[1], Math.min(ga, gb) - 1, Math.max(ga, gb) + 1.05);
    }
    if (style === 0) {   // modern totem: pole + yellow disc with an "M" (both faces)
      const p = P(L - 0.1, W + 0.45), gp = ground(p[0], p[1]);
      prism(p[0], gp - 0.2, gp + 2.75, p[1], 0.06, 6, hd, cPole);
      const cy = gp + 3.05, R = 0.42, n = 14, pts = [];
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push([p[0] + qx * Math.cos(a) * R, cy + Math.sin(a) * R, p[1] + qz * Math.cos(a) * R]); }
      const i0 = F.count; for (const v of pts) vert(F, v[0], v[1], v[2], dx, 0, dz, cSign);
      for (let i = 1; i < n - 1; i++) F.i.push(i0, i0 + i, i0 + i + 1);
      for (let i = 0; i < n; i++) line(pts[i], pts[(i + 1) % n]);
      const M = [[-0.2, -0.2], [-0.2, 0.2], [0, -0.02], [0.2, 0.2], [0.2, -0.2]];
      for (const side of [1, -1]) for (let i = 0; i < 4; i++) {
        const [a0, a1] = M[i], [b0, b1] = M[i + 1];
        const ax = p[0] + qx * a0 + dx * 0.03 * side, ay = cy + a1, az = p[1] + qz * a0 + dz * 0.03 * side;
        const bx = p[0] + qx * b0 + dx * 0.03 * side, by = cy + b1, bz = p[1] + qz * b0 + dz * 0.03 * side;
        const ux = bx - ax, uy = by - ay, uz = bz - az, ul = Math.hypot(ux, uy, uz), wv = 0.035;
        // perpendicular within the disc plane: (q, up) basis
        const pa = (uy * 1) / ul, pb = -(ux * qx + uz * qz) / ul;   // rotate 90° in (across, up)
        const ox = qx * pa * wv, oy = pb * wv, oz = qz * pa * wv;
        quad([ax - ox, ay - oy, az - oz], [bx - ox, by - oy, bz - oz], [bx + ox, by + oy, bz + oz], [ax + ox, ay + oy, az + oz], [dx * side, 0, dz * side], cSignM);
      }
    } else {             // Guimard-like: two green posts with lamps and a plain panel across the open end
      const posts = [P(L + 0.05, -W - 0.05), P(L + 0.05, W + 0.05)];
      let gy = 0;
      for (const p of posts) { const gp = ground(p[0], p[1]); gy = Math.max(gy, gp); prism(p[0], gp - 0.2, gp + 2.9, p[1], 0.07, 6, hd, cGuimard, true, 0.045); blob(p[0], gp + 3.05, p[1], 0.17, 0.24, 0.17, 0, 1, cLamp); }
      const a = posts[0], b = posts[1], y0 = gy + 2.35, y1 = gy + 2.7;
      const p0 = [a[0], y0, a[1]], p1 = [b[0], y0, b[1]], p2 = [b[0], y1, b[1]], p3 = [a[0], y1, a[1]];
      quad(p0, p1, p2, p3, [dx, 0, dz], cGPanel); line(p0, p1); line(p1, p2); line(p2, p3); line(p3, p0);
      line([a[0], y1 + 0.05, a[1]], [(a[0] + b[0]) / 2, y1 + 0.35, (a[1] + b[1]) / 2]); line([(a[0] + b[0]) / 2, y1 + 0.35, (a[1] + b[1]) / 2], [b[0], y1 + 0.05, b[1]]);
    }
  }

  const geo = (B, kind) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    if (kind === 'faces') { g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3)); g.setAttribute('acol', new THREE.Float32BufferAttribute(B.c, 4)); }
    if (kind === 'hull') g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    if (kind === 'lines') { g.setAttribute('other', new THREE.Float32BufferAttribute(B.o, 3)); g.setAttribute('side', new THREE.Float32BufferAttribute(B.s, 2)); }
    g.setIndex(B.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(B.i, 1) : new THREE.Uint16BufferAttribute(B.i, 1));
    g.computeBoundingSphere(); if (kind === 'lines') g.boundingSphere.radius += 2;
    return g;
  };
  return {
    origin, faces: geo(F, 'faces'), lines: geo(L, 'lines'), hull: H.p.length ? geo(H, 'hull') : null,
    col: { gn, gsp, gh, ground, walls: new Float32Array(walls), decks: new Float32Array(decks) },
  };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const frac = v => v - Math.floor(v);
const hash = (x, z) => (Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663)) >>> 0;
