import * as THREE from 'three';
import { World, loadWorld, arrName } from './world.js';
import { Streamer } from './streamer.js';
import { U } from './shaders.js';

THREE.ColorManagement.enabled = false;   // flat palette written as-is (like the Unity Gamma build)
const $ = id => document.getElementById(id);
const BASE = 'data/';
const ROUNDS = 5;
const params = new URLSearchParams(location.search);
const autoDemo = params.has('autodemo');
const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const log = (...a) => console.log('[PG]', ...a);

// ------------------------------------------------------------------ renderer / scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, touch ? 1.5 : 2));
renderer.setClearColor(0xf7f7f4);
const scene = new THREE.Scene();
const root = new THREE.Group(); root.scale.set(1, 1, -1); scene.add(root);   // data frame x=E, z=N -> three.js z=-N
const camera = new THREE.PerspectiveCamera(70, 1, 0.15, 360); camera.rotation.order = 'YXZ';
const fogEnd = touch ? 270 : 330;
U.fogRange.value.set(60, fogEnd); camera.far = fogEnd + 25;
const streamer = new Streamer(root, BASE);
streamer.loadRadius = touch ? 340 : 420; streamer.unloadRadius = streamer.loadRadius + 200;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  const b = renderer.getDrawingBufferSize(new THREE.Vector2());
  U.resolution.value.copy(b); U.lineWidth.value = Math.max(1.4, b.y / 720 * 1.8);
  if (state === 'Map' || state === 'Result') drawMap();
  $('rotate').classList.toggle('hidden', !(touch && h > w));
}

// ------------------------------------------------------------------ player (data frame: x=E, z=N, y=up; yaw clockwise from north)
const P = { x: 0, y: 40, z: 0, vy: 0, yaw: 0, pitch: 0, controls: false };
const keys = new Set();
let joy = null, look = null;
function teleport(s) {
  const g = streamer.groundAt(s.x, s.y, 1e4); if (g === null) return false;
  P.x = s.x; P.z = s.y; P.y = g; P.vy = 0; P.yaw = s.heading; P.pitch = 0; return true;
}
function updatePlayer(dt) {
  let mx = 0, my = 0, run = false;
  if (P.controls) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) my += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (joy) { const R = 60; let dx = joy.x - joy.sx, dy = joy.y - joy.sy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
      mx += dx / R; my += -dy / R; run = Math.hypot(dx, dy) / R > 0.92; }
  }
  const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
  const sp = (run ? 10 : 4.5) * dt, yr = P.yaw * Math.PI / 180;
  let dx = (Math.sin(yr) * my + Math.cos(yr) * mx) * sp, dz = (Math.cos(yr) * my - Math.sin(yr) * mx) * sp;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
  for (let i = 0; i < steps; i++) {
    let nx = P.x + dx / steps, nz = P.z + dz / steps;
    [nx, nz] = streamer.collide(nx, nz, 0.3, P.y);
    nx = Math.min(Math.max(nx, 60), World.width - 60); nz = Math.min(Math.max(nz, 60), World.height - 60);
    const g = streamer.groundAt(nx, nz, P.y);
    if (g === null) break;
    P.x = nx; P.z = nz;
  }
  const g = streamer.groundAt(P.x, P.z, P.y);
  if (g !== null) {
    if (g >= P.y - 0.05) { P.y = g; P.vy = 0; }
    else { P.vy -= 20 * dt; P.y = Math.max(g, P.y + P.vy * dt); if (P.y === g) P.vy = 0; }
  }
  P.pitch = Math.max(-80, Math.min(80, P.pitch));
  camera.position.set(P.x, P.y + 1.62, -P.z);
  camera.rotation.set(-P.pitch * Math.PI / 180, -yr, 0);
}

// ------------------------------------------------------------------ input
addEventListener('keydown', e => {
  keys.add(e.code);
  const k = e.key.toLowerCase();
  if (state === 'Explore') { if (k === 'm' || e.code === 'Space') openMap(); else if (k === 'r') teleport(cur.spawn); }
  else if (state === 'Map') { if (e.key === 'Escape') closeMap(); else if (e.key === 'Enter') validate(); }
  else if (state === 'Result' && e.key === 'Enter') nextRound();
  else if ((state === 'Menu' || state === 'Final') && e.key === 'Enter' && worldReady) newGame();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('pointerdown', e => {
  if (!P.controls) return;
  if (e.pointerType === 'mouse') { if (!document.pointerLockElement) canvas.requestPointerLock?.(); return; }
  canvas.setPointerCapture(e.pointerId);
  if (e.clientX < innerWidth * 0.42 && !joy) joy = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
  else if (!look) look = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') {
    if (document.pointerLockElement === canvas && P.controls) { P.yaw += e.movementX * 0.12; P.pitch += e.movementY * 0.12; }
    return;
  }
  if (joy && e.pointerId === joy.id) { joy.x = e.clientX; joy.y = e.clientY; }
  if (look && e.pointerId === look.id) { P.yaw += (e.clientX - look.x) * 0.25; P.pitch += (e.clientY - look.y) * 0.25; look.x = e.clientX; look.y = e.clientY; }
});
const endPtr = e => { if (joy && e.pointerId === joy.id) joy = null; if (look && e.pointerId === look.id) look = null; };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
document.addEventListener('pointerlockchange', () => $('lockHint').classList.toggle('hidden', touch || !!document.pointerLockElement || state !== 'Explore'));

// ------------------------------------------------------------------ game flow
let state = '', stateT = 0, worldReady = false, menuSpawn = null, menuPlaced = false, loadT = 0;
let rounds = [], cur = null, pin = null;
function setState(s) {
  state = s; stateT = performance.now(); log('state ' + s);
  $('menu').classList.toggle('hidden', s !== 'Menu'); $('loading').classList.toggle('hidden', s !== 'Loading');
  $('hud').classList.toggle('hidden', s !== 'Explore'); $('mapview').classList.toggle('hidden', s !== 'Map' && s !== 'Result');
  $('final').classList.toggle('hidden', s !== 'Final');
  P.controls = s === 'Explore';
  if (s !== 'Explore' && document.pointerLockElement) document.exitPointerLock();
  joy = look = null;
  $('lockHint').classList.toggle('hidden', touch || s !== 'Explore' || !!document.pointerLockElement);
}
const total = () => rounds.reduce((a, r) => a + r.score, 0);
const fmt = n => n.toLocaleString('fr-FR').replace(/\s/g, '\u202F');
const dist = m => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const place = s => (s.street ? s.street + ', ' : '') + arrName(s.arr);

function newGame() { rounds = []; nextRound(true); }
function nextRound(first) {
  if (!first && rounds.length >= ROUNDS) { showFinal(); return; }
  let s;
  for (let t = 0; t < 200; t++) {
    s = World.spawns[(Math.random() * World.spawns.length) | 0];
    if (rounds.every(r => Math.hypot(r.spawn.x - s.x, r.spawn.y - s.y) >= 1500 && r.spawn.arr !== s.arr)) break;
  }
  cur = { spawn: s, guess: null, dist: 0, score: 0 }; rounds.push(cur); pin = null;
  streamer.focus = { x: s.x, z: s.y }; loadT = performance.now();
  $('loadTitle').textContent = `Manche ${rounds.length}/${ROUNDS}`;
  log(`round ${rounds.length} spawn (${s.x.toFixed(1)}, ${s.y.toFixed(1)}) ${s.street} arr ${s.arr}`);
  setState('Loading');
}
function openMap() {
  setState('Map'); $('resinfo').classList.add('hidden'); $('next').classList.add('hidden');
  $('validate').classList.remove('hidden'); $('closeMap').classList.remove('hidden');
  log(`map opened, player moved ${Math.hypot(P.x - cur.spawn.x, P.z - cur.spawn.y).toFixed(1)} m, yaw ${P.yaw.toFixed(0)}`);
  sizeMap();
  if (!pin) { mc = { x: World.width / 2, y: World.height * 0.52 }; mk = fitScale() * 1.15; }
  updateMapUi(); drawMap();
}
function closeMap() { setState('Explore'); }
function validate() {
  if (!pin) return;
  cur.guess = pin; cur.dist = Math.hypot(pin.x - cur.spawn.x, pin.y - cur.spawn.y);
  cur.score = cur.dist < 25 ? 5000 : Math.round(5000 * Math.exp(-cur.dist / 1200));
  log(`guess dist ${cur.dist.toFixed(0)} m score ${cur.score}`);
  setState('Result');
  $('validate').classList.add('hidden'); $('closeMap').classList.add('hidden'); $('next').classList.remove('hidden');
  $('next').textContent = rounds.length >= ROUNDS ? 'Résultats' : 'Manche suivante';
  $('resinfo').classList.remove('hidden');
  $('resPlace').textContent = 'Tu étais : ' + place(cur.spawn);
  $('resScore').textContent = `${dist(cur.dist)}  ·  +${fmt(cur.score)} pts`;
  $('mapHint').textContent = `Manche ${rounds.length}/${ROUNDS} · total ${fmt(total())} pts`;
  sizeMap();
  const infoH = $('resinfo').offsetHeight + 20;
  mc = { x: (pin.x + cur.spawn.x) / 2, y: (pin.y + cur.spawn.y) / 2 };
  const ex = Math.abs(pin.x - cur.spawn.x) + 400, ey = Math.abs(pin.y - cur.spawn.y) + 400;
  mk = Math.min(mapW / ex, (mapH - infoH) / ey) * 0.85; mk = Math.min(Math.max(mk, fitScale() * 0.9), 1.6);
  mc.y += infoH / 2 / mk;
  drawMap();
}
function showFinal() {
  setState('Final');
  $('total').textContent = `${fmt(total())} / ${fmt(ROUNDS * 5000)} points`;
  $('recap').innerHTML = '';
  for (const r of rounds) { const li = document.createElement('li'); li.textContent = `${place(r.spawn)} — ${dist(r.dist)} — ${fmt(r.score)} pts`; $('recap').appendChild(li); }
}
const tapBtn = (id, fn) => $(id).addEventListener('click', e => { e.preventDefault(); fn(); });
tapBtn('play', () => worldReady && newGame()); tapBtn('replay', newGame);
tapBtn('mapBtn', openMap); tapBtn('backBtn', () => teleport(cur.spawn));
tapBtn('closeMap', closeMap); tapBtn('validate', validate); tapBtn('next', () => nextRound());
tapBtn('zoomIn', () => zoomAt(mapW / 2, mapH / 2, 1.6)); tapBtn('zoomOut', () => zoomAt(mapW / 2, mapH / 2, 1 / 1.6));
$('hint').textContent = touch ? 'Glisse à gauche pour marcher, à droite pour regarder'
  : 'Clic : contrôler la vue · ZQSD/WASD : marcher · Maj : courir · M : carte · R : retour au départ';

// ------------------------------------------------------------------ guess map (2D canvas, map image covers the world bbox, north up)
const mapc = $('mapc'), mctx = mapc.getContext('2d');
const mapImg = new Image(); mapImg.src = BASE + 'paris_map.jpg'; mapImg.onload = () => { if (state === 'Map' || state === 'Result') drawMap(); };
let mc = { x: 0, y: 0 }, mk = 0.05, mapW = 1, mapH = 1, mdpr = 1;
function sizeMap() {
  mdpr = Math.min(devicePixelRatio || 1, 2); mapW = mapc.clientWidth; mapH = mapc.clientHeight;
  mapc.width = Math.round(mapW * mdpr); mapc.height = Math.round(mapH * mdpr);
}
const fitScale = () => Math.min(mapW / World.width, mapH / World.height);
const toScreen = (x, y) => [mapW / 2 + (x - mc.x) * mk, mapH / 2 - (y - mc.y) * mk];
const toWorld = (sx, sy) => ({ x: mc.x + (sx - mapW / 2) / mk, y: mc.y - (sy - mapH / 2) / mk });
function clampView() { mc.x = Math.min(Math.max(mc.x, 0), World.width); mc.y = Math.min(Math.max(mc.y, 0), World.height); }
function zoomAt(sx, sy, f) {
  const w = toWorld(sx, sy); mk = Math.min(Math.max(mk * f, fitScale() * 0.9), 1.6);
  const w2 = toWorld(sx, sy); mc.x += w.x - w2.x; mc.y += w.y - w2.y; clampView(); drawMap();
}
function drawMap() {
  if (mapc.width !== Math.round(mapc.clientWidth * mdpr)) sizeMap();
  const c = mctx; c.setTransform(mdpr, 0, 0, mdpr, 0, 0);
  c.fillStyle = '#e8e6e1'; c.fillRect(0, 0, mapW, mapH);
  if (mapImg.complete && mapImg.naturalWidth) {
    const x0 = Math.max(0, mc.x - mapW / 2 / mk), x1 = Math.min(World.width, mc.x + mapW / 2 / mk);
    const y0 = Math.max(0, mc.y - mapH / 2 / mk), y1 = Math.min(World.height, mc.y + mapH / 2 / mk);
    if (x1 > x0 && y1 > y0) {
      const iw = mapImg.naturalWidth, ih = mapImg.naturalHeight;
      const [ax, ay] = toScreen(x0, y1), [bx, by] = toScreen(x1, y0);
      c.imageSmoothingQuality = 'high';
      c.drawImage(mapImg, x0 / World.width * iw, (1 - y1 / World.height) * ih, (x1 - x0) / World.width * iw, (y1 - y0) / World.height * ih, ax, ay, bx - ax, by - ay);
    }
  } else { c.fillStyle = '#555'; c.font = '18px system-ui'; c.fillText('Chargement de la carte…', 20, 30); }
  const pinAt = (p, col) => { const [x, y] = toScreen(p.x, p.y); c.beginPath(); c.arc(x, y, 12, 0, 7); c.fillStyle = '#141418'; c.fill();
    c.beginPath(); c.arc(x, y, 9.5, 0, 7); c.fillStyle = col; c.fill(); c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fillStyle = '#fff'; c.fill(); };
  if (state === 'Result') {
    const [gx, gy] = toScreen(cur.guess.x, cur.guess.y), [tx, ty] = toScreen(cur.spawn.x, cur.spawn.y);
    c.setLineDash([5, 7]); c.lineWidth = 3; c.strokeStyle = '#222226'; c.beginPath(); c.moveTo(gx, gy); c.lineTo(tx, ty); c.stroke(); c.setLineDash([]);
    pinAt(cur.guess, '#d93333'); pinAt({ x: cur.spawn.x, y: cur.spawn.y }, '#26a64d');
  } else if (pin) pinAt(pin, '#d93333');
}
function updateMapUi() {
  $('validate').disabled = !pin;
  if (state === 'Map') $('mapHint').textContent = pin ? 'Valide ou déplace ton repère'
    : (touch ? 'Touche la carte pour placer ton repère · pince pour zoomer' : 'Clique sur la carte pour placer ton repère · molette pour zoomer');
}
const ptrs = new Map(); let dragged = false, pinch = 0;
mapc.addEventListener('pointerdown', e => { mapc.setPointerCapture(e.pointerId); const r = mapc.getBoundingClientRect();
  ptrs.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top, sx: e.clientX, sy: e.clientY, t: performance.now() }); if (ptrs.size === 1) dragged = false; pinch = 0; });
mapc.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return; const r = mapc.getBoundingClientRect();
  const nx = e.clientX - r.left, ny = e.clientY - r.top;
  if (ptrs.size >= 2) {
    p.x = nx; p.y = ny; const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch); pinch = d; dragged = true; return;
  }
  if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) dragged = true;
  if (dragged) { mc.x -= (nx - p.x) / mk; mc.y += (ny - p.y) / mk; clampView(); drawMap(); }
  p.x = nx; p.y = ny;
});
const mapUp = e => {
  const p = ptrs.get(e.pointerId); if (!p) return; ptrs.delete(e.pointerId);
  if (e.type === 'pointerup' && !dragged && state === 'Map' && performance.now() - p.t < 800) {
    const w = toWorld(p.x, p.y);
    if (w.x >= 0 && w.y >= 0 && w.x <= World.width && w.y <= World.height) { pin = w; updateMapUi(); drawMap(); }
  }
  if (ptrs.size < 2) pinch = 0;
};
mapc.addEventListener('pointerup', mapUp); mapc.addEventListener('pointercancel', mapUp);
mapc.addEventListener('wheel', e => { e.preventDefault(); const r = mapc.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.18, -Math.sign(e.deltaY))); }, { passive: false });

// ------------------------------------------------------------------ main loop
const compassLabels = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const compassSpans = compassLabels.map((t, i) => { const s = document.createElement('span'); s.textContent = t; if (i === 0) s.style.color = '#cc2626'; $('compassInner').appendChild(s); return s; });
let last = performance.now(), frames = 0, perfT = last;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; const st = (now - stateT) / 1000;
  if (state === 'Explore') streamer.focus = { x: P.x, z: P.z };
  streamer.update();
  switch (state) {
    case 'Menu':
      if (!menuSpawn) break;
      if (!menuPlaced && streamer.readyAround(menuSpawn.x, menuSpawn.y, 150) && teleport(menuSpawn)) menuPlaced = true;
      if (menuPlaced) P.yaw += dt * 6;
      if (autoDemo && menuPlaced && st > 4) newGame();
      break;
    case 'Loading':
      if (streamer.readyAround(cur.spawn.x, cur.spawn.y, 260) && teleport(cur.spawn)) {
        log(`round ready in ${((now - loadT) / 1000).toFixed(1)}s, tiles ${streamer.loadedCount}, ${(streamer.bytes / 1024) | 0} KB so far`);
        setState('Explore');
        $('hudRound').textContent = `Manche ${rounds.length}/${ROUNDS}`; $('hudScore').textContent = `Score : ${fmt(total())}`;
      }
      break;
    case 'Explore':
      if (autoDemo && st > 8) openMap();
      for (let i = 0; i < 8; i++) {
        let d = ((i * 45 - P.yaw) % 360 + 540) % 360 - 180;
        compassSpans[i].style.display = Math.abs(d) > 80 ? 'none' : ''; compassSpans[i].style.left = (150 + d / 80 * 150) + 'px';
      }
      $('joy').style.display = joy ? 'block' : 'none';
      if (joy) { $('joy').style.left = joy.sx + 'px'; $('joy').style.top = joy.sy + 'px';
        let dx = joy.x - joy.sx, dy = joy.y - joy.sy; const l = Math.hypot(dx, dy); if (l > 60) { dx *= 60 / l; dy *= 60 / l; }
        $('joyKnob').style.transform = `translate(${dx}px, ${dy}px)`; }
      break;
    case 'Map':
      if (autoDemo && st > 3 && !pin) { pin = { x: cur.spawn.x + (Math.random() - 0.5) * 1800, y: cur.spawn.y + (Math.random() - 0.5) * 1200 }; mc = { ...pin }; mk = fitScale() * 3; clampView(); updateMapUi(); drawMap(); }
      if (autoDemo && pin && st > 6) validate();
      break;
    case 'Result':
      if (autoDemo && st > 6) nextRound();
      break;
  }
  if (state === 'Menu' || state === 'Explore' || state === 'Loading') {
    updatePlayer(dt);
    renderer.render(scene, camera);
  }
  frames++;
  if (now - perfT > 5000) { log(`perf ${(frames * 1000 / (now - perfT)).toFixed(1)} fps, draw calls ${renderer.info.render.calls}, tris ${renderer.info.render.triangles}, tiles ${streamer.loadedCount}`); frames = 0; perfT = now; }
}

addEventListener('resize', resize);
resize();
setState('Menu');
requestAnimationFrame(frame);
loadWorld(BASE).then(() => {
  worldReady = true; $('play').disabled = false; $('play').textContent = 'JOUER';
  menuSpawn = World.spawns[(Math.random() * World.spawns.length) | 0];
  streamer.focus = { x: menuSpawn.x, z: menuSpawn.y }; streamer.active = true;
  window.pgReady = true;
}).catch(e => { $('play').textContent = 'Erreur de chargement'; console.error(e); });
