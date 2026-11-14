import * as THREE from 'three';
// Port of TileBuilder.cs: turns a compact "PGT1" tile into faces (flat, vertex coloured), outline quads, tree hulls,
// plus collision data (terrain grid, wall segments, bridge decks). Local frame = Unity's: x = East, y = up, z = North
// (the scene root mirrors z so three.js stays right-handed).

const C = (r, g, b, a = 255) => [r / 255, g / 255, b / 255, a / 255];
const cPave = C(229, 226, 219), cGreen = C(203, 225, 186), cWater = C(178, 207, 231), cRoad = C(201, 201, 199, 0);
const cWall = C(246, 243, 236), cRoof = C(214, 209, 201), cAttic = C(226, 221, 212), cAtticRoof = C(190, 186, 182), cDeck = C(212, 209, 203);
const cTrunk = C(160, 145, 130), cCrown = C(196, 222, 176);

class Buf {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; this.o = []; this.s = []; }
  get count() { return this.p.length / 3; }
}

const T = (1 + Math.sqrt(5)) / 2;
const ICO = [[-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0], [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T], [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1]]
  .map(v => { const l = Math.hypot(...v); return v.map(x => x / l); });
const ICOT = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];

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

  // ---- prisms (buildings + attic storeys)
  const np = i32();
  for (let p = 0; p < np; p++) {
    const kind = u8(), z0 = u16() / 100, z1 = u16() / 100, nr = u8();
    const all = []; const wc = kind === 0 ? cWall : cAttic, rc = kind === 0 ? cRoof : cAtticRoof;
    for (let q = 0; q < nr; q++) {
      const n = u16(); const ring = [];
      for (let i = 0; i < n; i++) { const x = i16() / 10, z = i16() / 10; ring.push([x, z]); }
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
    const nt = u16(); const base = F.count;
    for (const v of all) vert(F, v[0], z1, v[1], 0, 1, 0, rc);
    for (let i = 0; i < nt * 3; i++) F.i.push(base + u16());
  }

  // ---- roads: ribbons draped on the terrain (subdivided across), bridges at their own deck altitude
  const nroads = i32();
  for (let k = 0; k < nroads; k++) {
    const bridge = u8() !== 0, w = u16() / 10, n = u16();
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
          quad(pl, l3, r3, pr, [0, 1, 0], cDeck);
          decks.push(...pl, ...l3, ...r3, ...pr);
          const dn = v => [v[0], v[1] - 1.2, v[2]], up = v => [v[0], v[1] + 1.0, v[2]];
          quad(pl, l3, dn(l3), dn(pl), [0, 1, 0], cDeck); quad(pr, r3, dn(r3), dn(pr), [0, 1, 0], cDeck);
          line(pl, l3); line(pr, r3); line(dn(pl), dn(l3)); line(dn(pr), dn(r3));
          quad(pl, l3, up(l3), up(pl), [0, 1, 0], cDeck); quad(pr, r3, up(r3), up(pr), [0, 1, 0], cDeck);
          line(up(pl), up(l3)); line(up(pr), up(r3));
          walls.push(pl[0], pl[2], l3[0], l3[2], Math.min(pl[1], l3[1]) - 1.2, Math.max(pl[1], l3[1]) + 1, pr[0], pr[2], r3[0], r3[2], Math.min(pr[1], r3[1]) - 1.2, Math.max(pr[1], r3[1]) + 1);
        } else for (let j = 0; j < lat; j++) quad(prevRow[j], row[j], row[j + 1], prevRow[j + 1], [0, 1, 0], cRoad);
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

  // ---- trees
  const ntr = i32();
  for (let k = 0; k < ntr; k++) {
    const x = i16() / 10, z = i16() / 10, h = u8() / 4;
    const hs = (Math.imul(Math.trunc(x * 73856093), 1) ^ Math.imul(Math.trunc(z * 19349663), 1)) >>> 0;
    tree(x, ground(x, z), z, h, (hs % 1000) / 1000);
  }

  function tree(px, py, pz, h, rnd) {
    const tr = Math.min(Math.max(h * 0.012, 0.1), 0.25), th = h * 0.5;
    const c = [[-tr, -tr], [tr, -tr], [tr, tr], [-tr, tr]];
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, ml = Math.hypot(mx, mz);
      quad([px + a[0], py, pz + a[1]], [px + b[0], py, pz + b[1]], [px + b[0], py + th, pz + b[1]], [px + a[0], py + th, pz + a[1]], [mx / ml, 0, mz / ml], cTrunk);
    }
    const cr = Math.min(h * (0.19 + 0.06 * rnd), 4.5), cy = py + h - cr * 1.2;
    const rot = rnd * 6.28, cs = Math.cos(rot), sn = Math.sin(rot);
    const P = v => { const x = v[0] * cr, y = v[1] * cr * 1.25, z = v[2] * cr; return [px + x * cs + z * sn, cy + y, pz - x * sn + z * cs]; };
    const pv = ICO.map(P);
    for (let f = 0; f < 20; f++) {
      const a = pv[ICOT[f * 3]], b = pv[ICOT[f * 3 + 1]], e = pv[ICOT[f * 3 + 2]];
      let n = cross(sub(b, a), sub(e, a)); n = norm(n); if (dot(n, sub(a, [px, cy, pz])) < 0) n = n.map(v => -v);
      const i = F.count; for (const v of [a, b, e]) vert(F, v[0], v[1], v[2], n[0], n[1], n[2], cCrown); F.i.push(i, i + 1, i + 2);
    }
    // hull: crown (smooth normals) + trunk, front faces pointing outward (BackSide keeps the inner shell)
    const h0 = H.count;
    for (const v of pv) { const n = norm(sub(v, [px, cy, pz])); H.p.push(...v); H.n.push(...n); }
    for (let f = 0; f < 20; f++) {
      let a = h0 + ICOT[f * 3], b = h0 + ICOT[f * 3 + 1], e = h0 + ICOT[f * 3 + 2];
      const A = pv[a - h0], Bv = pv[b - h0], E = pv[e - h0];
      if (dot(cross(sub(Bv, A), sub(E, A)), sub(A, [px, cy, pz])) < 0) [b, e] = [e, b];
      H.i.push(a, b, e);
    }
    const s0 = H.count;
    for (let i = 0; i < 4; i++) {
      const n = norm([c[i][0], 0, c[i][1]]);
      H.p.push(px + c[i][0], py, pz + c[i][1]); H.n.push(...n); H.p.push(px + c[i][0], py + th, pz + c[i][1]); H.n.push(...n);
    }
    for (let i = 0; i < 4; i++) {
      const a = s0 + i * 2, b = s0 + ((i + 1) % 4) * 2;
      const A = H.p.slice(a * 3, a * 3 + 3), Bv = H.p.slice(b * 3, b * 3 + 3), B1 = H.p.slice(b * 3 + 3, b * 3 + 6);
      const out = [c[i][0] + c[(i + 1) % 4][0], 0, c[i][1] + c[(i + 1) % 4][1]];
      if (dot(cross(sub(Bv, A), sub(B1, A)), out) >= 0) H.i.push(a, b, b + 1, a, b + 1, a + 1);
      else H.i.push(a, b + 1, b, a, a + 1, b + 1);
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
