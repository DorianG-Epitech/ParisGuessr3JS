import * as THREE from 'three';
import { World, loadWorld, arrName } from './world.js';
import { Streamer } from './streamer.js';
import { U } from './shaders.js';
import { Landmarks } from './landmarks.js';
import { setExclusions } from './tilebuilder.js';

THREE.ColorManagement.enabled = false;   // flat palette written as-is (like the Unity Gamma build)
const $ = id => document.getElementById(id);
const BASE = 'data/';
const ROUNDS = 5;
const params = new URLSearchParams(location.search);
const autoDemo = params.has('autodemo');
const spotParam = params.get('spot');   // debug: ?spot=x,z,heading[,pitch] (world metres) starts round 1 there
const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (touch) document.body.classList.add('touch');
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
U.fogRange.value.set(60, fogEnd); camera.far = 2700;   // tall landmarks (Eiffel tower...) stay visible far beyond the street fog
let landmarks = null;
const streamer = new Streamer(root, BASE);
streamer.loadRadius = touch ? 340 : 420; streamer.unloadRadius = streamer.loadRadius + 200;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  const b = renderer.getDrawingBufferSize(new THREE.Vector2());
  U.resolution.value.copy(b); U.lineWidth.value = Math.max(1.4, b.y / 720 * 1.8);
  $('rotate').classList.toggle('hidden', !(touch && h > w));
}

// ------------------------------------------------------------------ player (data frame: x=E, z=N, y=up; yaw clockwise from north)
const P = { x: 0, y: 40, z: 0, vy: 0, yaw: 0, pitch: 0, controls: false };
const keys = new Set();
let joy = null, look = null, modal = false;
// aerial view (hint « Prendre de la hauteur », free after the guess): camera rises AIR_H m above the player, movement frozen
const AIR_H = 115, baseLoad = streamer.loadRadius;
let airOn = false, air = 0;
function setAir(on) {
  airOn = on; streamer.loadRadius = baseLoad + (on ? 280 : 0); streamer.unloadRadius = streamer.loadRadius + 200;
  P.pitch = on ? 52 : 0; log('aerial ' + (on ? 'on' : 'off')); updateHintUi();
}
function teleport(s) {
  const g = streamer.groundAt(s.x, s.y, 1e4); if (g === null) return false;
  P.x = s.x; P.z = s.y; P.y = g; P.vy = 0; P.yaw = s.heading; P.pitch = s.pitch || 0; return true;
}
function updatePlayer(dt) {
  let mx = 0, my = 0, run = false;
  if (P.controls && !modal && !airOn && air < 0.02) {
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
    if (landmarks) [nx, nz] = landmarks.collide(nx, nz, 0.3, P.y);
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
  P.pitch = Math.max(-80, Math.min(85, P.pitch));
  air += ((airOn ? 1 : 0) - air) * Math.min(1, dt * 3.5); if (Math.abs(air - (airOn ? 1 : 0)) < 0.002) air = airOn ? 1 : 0;
  const e = air * air * (3 - 2 * air);
  U.fogRange.value.set(60 + e * 260, fogEnd + e * 520);
  camera.position.set(P.x, P.y + 1.62 + e * AIR_H, -P.z);
  camera.rotation.set(-P.pitch * Math.PI / 180, -yr, 0);
}

// ------------------------------------------------------------------ input
const playing = () => state === 'Explore' || state === 'Roam';
addEventListener('keydown', e => {
  keys.add(e.code);
  const k = e.key.toLowerCase();
  if (modal) { if (e.key === 'Escape') closeConfirm(false); else if (e.key === 'Enter') closeConfirm(true); return; }
  if (playing()) {
    if (k === 'm') toggleBig();
    else if (e.key === 'Escape' && mapMode !== 'mini') setMapMode('mini');
    else if (k === 'r' && !airOn) teleport(cur.spawn);
    else if (state === 'Explore' && (e.code === 'Space' || e.key === 'Enter') && pin) validate();
    else if (state === 'Roam' && e.key === 'Enter') nextRound();
  }
  else if (state === 'Result' && e.key === 'Enter') nextRound();
  else if ((state === 'Menu' || state === 'Final') && e.key === 'Enter' && worldReady) newGame();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('pointerdown', e => {
  if (!P.controls || modal) return;
  if (touch && mapMode === 'full') return;
  if (e.pointerType === 'mouse') { if (mapMode === 'big') setMapMode('mini'); if (!document.pointerLockElement) canvas.requestPointerLock?.(); return; }
  canvas.setPointerCapture(e.pointerId);
  if (e.clientX < innerWidth * 0.42 && !joy) joy = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
  else if (!look) look = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') {
    if (document.pointerLockElement === canvas && P.controls && !modal) { P.yaw += e.movementX * 0.12; P.pitch += e.movementY * 0.12; }
    return;
  }
  if (joy && e.pointerId === joy.id) { joy.x = e.clientX; joy.y = e.clientY; }
  if (look && e.pointerId === look.id) { P.yaw += (e.clientX - look.x) * 0.25; P.pitch += (e.clientY - look.y) * 0.25; look.x = e.clientX; look.y = e.clientY; }
});
const endPtr = e => { if (joy && e.pointerId === joy.id) joy = null; if (look && e.pointerId === look.id) look = null; };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
const updLock = () => $('lockHint').classList.toggle('hidden', touch || !playing() || modal || mapMode !== 'mini' || !!document.pointerLockElement);
document.addEventListener('pointerlockchange', updLock);

// ------------------------------------------------------------------ hints
let hintData = { lines: [], arr: [] };
const HINTS = {
  metro: { name: 'Lignes métro/RER', cost: '−1 500 points sur cette manche', short: 'métro/RER' },
  arr: { name: 'Arrondissement', cost: 'score de la manche divisé par 2', short: 'arrondissement' },
  air: { name: 'Prendre de la hauteur', cost: 'score de la manche divisé par 2', short: 'hauteur' },
};
const hintBtn = { metro: $('hMetro'), arr: $('hArr'), air: $('hAir') };
function inRing(r, x, y) { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
  const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
const arrAt = (x, y) => hintData.arr.find(a => a.p.some(r => inRing(r, x, y)));
let pendingHint = null;
function askHint(h) {
  if (state === 'Roam') { if (h === 'air') setAir(!airOn); return; }
  if (state !== 'Explore') return;
  if (cur.hints[h]) { if (h === 'air') setAir(!airOn); return; }
  pendingHint = h; modal = true; keys.clear(); joy = look = null;
  if (document.pointerLockElement) document.exitPointerLock();
  $('confirmText').innerHTML = `Utiliser l'indice <b>« ${HINTS[h].name} »</b> ?<br>Coût : ${HINTS[h].cost}.`;
  $('confirm').classList.remove('hidden'); updLock();
}
function closeConfirm(ok) {
  $('confirm').classList.add('hidden'); modal = false; const h = pendingHint; pendingHint = null; updLock();
  if (!ok || !h || state !== 'Explore') return;
  cur.hints[h] = true; log('hint ' + h);
  if (h === 'arr') { const a = arrAt(cur.spawn.x, cur.spawn.y); cur.arr = a ? a.a : cur.spawn.arr; }
  if (h === 'air') setAir(true);
  if (h === 'metro' || h === 'arr') { if (mapMode === 'mini' && !touch) setMapMode('big'); }
  updateHintUi(); drawMap();
}
function updateHintUi() {
  if (!cur) return;
  const roam = state === 'Roam';
  hintBtn.metro.classList.toggle('hidden', roam); hintBtn.arr.classList.toggle('hidden', roam);
  for (const h of ['metro', 'arr']) { hintBtn[h].classList.toggle('used', cur.hints[h]); hintBtn[h].querySelector('span').textContent = cur.hints[h] ? 'utilisé' : (h === 'metro' ? '−1 500 pts' : 'score ÷ 2'); }
  const b = hintBtn.air; b.classList.toggle('used', cur.hints.air && !roam);
  b.querySelector('b').textContent = airOn ? 'Revenir dans la rue' : (roam ? 'Vue aérienne' : 'Prendre de la hauteur');
  b.querySelector('span').textContent = roam ? 'gratuit' : cur.hints.air ? 'utilisé' : 'score ÷ 2';
  $('hudArr').classList.toggle('hidden', !cur.arr); if (cur.arr) $('hudArr').textContent = arrName(cur.arr);
}
for (const h in hintBtn) hintBtn[h].addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); askHint(h); });
$('confirmYes').addEventListener('click', () => closeConfirm(true)); $('confirmNo').addEventListener('click', () => closeConfirm(false));

// ------------------------------------------------------------------ game flow
let state = '', stateT = 0, worldReady = false, menuSpawn = null, menuPlaced = false, loadT = 0;
let rounds = [], cur = null, pin = null, roamed = false;
function setState(s) {
  state = s; stateT = performance.now(); log('state ' + s);
  $('menu').classList.toggle('hidden', s !== 'Menu'); $('loading').classList.toggle('hidden', s !== 'Loading');
  $('hud').classList.toggle('hidden', !playing()); $('final').classList.toggle('hidden', s !== 'Final');
  P.controls = playing();
  if (!playing() && document.pointerLockElement) document.exitPointerLock();
  joy = look = null;
  const roam = s === 'Roam', res = s === 'Result';
  $('validate').classList.toggle('hidden', s !== 'Explore'); $('roam').classList.toggle('hidden', !res);
  $('next').classList.toggle('hidden', !res); $('resinfo').classList.toggle('hidden', !res);
  $('nextRoam').classList.toggle('hidden', !roam);
  setMapMode(playing() ? 'mini' : res ? 'full' : 'hidden');
  updateHintUi(); updLock();
}
const total = () => rounds.reduce((a, r) => a + r.score, 0);
const fmt = n => n.toLocaleString('fr-FR').replace(/\s/g, '\u202F');
const dist = m => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const place = s => (s.street ? s.street + ', ' : '') + arrName(s.arr);

function newGame() { rounds = []; nextRound(true); }
function nextRound(first) {
  if (airOn) setAir(false); air = 0;
  if (!first && rounds.length >= ROUNDS) { showFinal(); return; }
  let s;
  for (let t = 0; t < 200; t++) {
    s = World.spawns[(Math.random() * World.spawns.length) | 0];
    if (rounds.every(r => Math.hypot(r.spawn.x - s.x, r.spawn.y - s.y) >= 1500 && r.spawn.arr !== s.arr)) break;
  }
  if (spotParam && first) { const v = spotParam.split(',').map(Number); s = { x: v[0], y: v[1], heading: v[2] || 0, pitch: v[3] || 0, arr: 0, street: '' };
    const a = arrAt(s.x, s.y); if (a) s.arr = a.a; }
  cur = { spawn: s, guess: null, dist: 0, base: 0, score: 0, hints: { metro: false, arr: false, air: false }, arr: 0 }; rounds.push(cur); pin = null;
  streamer.focus = { x: s.x, z: s.y }; loadT = performance.now();
  $('loadTitle').textContent = `Manche ${rounds.length}/${ROUNDS}`;
  log(`round ${rounds.length} spawn (${s.x.toFixed(1)}, ${s.y.toFixed(1)}) ${s.street} arr ${s.arr}`);
  setState('Loading');
}
function resetMapView() { sizeMap(); mc = { x: World.width / 2, y: World.height * 0.5 }; mk = fitScale() * 1.05; }
/** Score: base from the distance, then hints in a fixed order: −1500 (metro/RER, floor 0), then ÷2 for each of arrondissement / height. */
function scoreRound(r) {
  r.base = r.dist < 25 ? 5000 : Math.round(5000 * Math.exp(-r.dist / 1200));
  let s = r.base; const st = [];
  if (r.hints.metro) { s = Math.max(0, s - 1500); st.push('− 1 500 (métro/RER)'); }
  if (r.hints.arr) { s = Math.round(s / 2); st.push('÷ 2 (arrondissement)'); }
  if (r.hints.air) { s = Math.round(s / 2); st.push('÷ 2 (hauteur)'); }
  r.score = s; r.calc = st.length ? `Indices : ${fmt(r.base)} ${st.join(' ')} = ${fmt(s)} pts` : 'Aucun indice utilisé';
}
function validate() {
  if (!pin || state !== 'Explore') return;
  cur.guess = pin; cur.dist = Math.hypot(pin.x - cur.spawn.x, pin.y - cur.spawn.y);
  scoreRound(cur);
  log(`guess dist ${cur.dist.toFixed(0)} m base ${cur.base} hints ${Object.keys(cur.hints).filter(h => cur.hints[h]).join('+') || 'none'} score ${cur.score}`);
  if (airOn) setAir(false);
  showResult();
}
function showResult() {
  setState('Result');
  $('next').textContent = rounds.length >= ROUNDS ? 'Résultats' : 'Manche suivante';
  $('resPlace').textContent = 'Tu étais : ' + place(cur.spawn);
  $('resScore').textContent = `${dist(cur.dist)}  ·  +${fmt(cur.score)} pts`;
  $('resCalc').textContent = cur.calc;
  $('mapHint').textContent = `Manche ${rounds.length}/${ROUNDS} · total ${fmt(total())} pts`;
  sizeMap();
  const infoH = $('resinfo').offsetHeight + 20;
  mc = { x: (cur.guess.x + cur.spawn.x) / 2, y: (cur.guess.y + cur.spawn.y) / 2 };
  const ex = Math.abs(cur.guess.x - cur.spawn.x) + 400, ey = Math.abs(cur.guess.y - cur.spawn.y) + 400;
  mk = Math.min(mapW / ex, (mapH - infoH) / ey) * 0.85; mk = Math.min(Math.max(mk, fitScale() * 0.9), 1.6);
  mc.y += infoH / 2 / mk;
  drawMap();
}
function startRoam() {
  roamed = true; setState('Roam');
  $('nextRoam').textContent = rounds.length >= ROUNDS ? 'Résultats' : 'Manche suivante';
  sizeMap(); mc = { x: P.x, y: P.z }; mk = Math.max(fitScale() * 4, 0.12); clampView(); drawMap();
}
function showFinal() {
  setState('Final');
  $('total').textContent = `${fmt(total())} / ${fmt(ROUNDS * 5000)} points`;
  $('recap').innerHTML = '';
  for (const r of rounds) { const li = document.createElement('li'); const used = Object.keys(r.hints).filter(h => r.hints[h]).map(h => HINTS[h].short);
    li.textContent = `${place(r.spawn)} — ${dist(r.dist)} — ${fmt(r.score)} pts` + (used.length ? ` (indices : ${used.join(', ')})` : ''); $('recap').appendChild(li); }
}
const tapBtn = (id, fn) => $(id).addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(); });
tapBtn('play', () => worldReady && newGame()); tapBtn('replay', newGame);
tapBtn('backBtn', () => { if (airOn) setAir(false); teleport(cur.spawn); });
tapBtn('closeMap', () => setMapMode('mini')); tapBtn('validate', validate); tapBtn('next', () => nextRound());
tapBtn('roam', startRoam); tapBtn('nextRoam', () => nextRound());
tapBtn('mapExpand', toggleBig);
tapBtn('zoomIn', () => zoomAt(mapW / 2, mapH / 2, 1.6)); tapBtn('zoomOut', () => zoomAt(mapW / 2, mapH / 2, 1 / 1.6));
$('hint').textContent = touch ? 'Glisse à gauche pour marcher, à droite pour regarder · touche la carte pour l\'agrandir'
  : 'Clic : contrôler la vue · ZQSD/WASD : marcher · Maj : courir · M : agrandir la carte · Espace : deviner · R : retour au départ';

// ------------------------------------------------------------------ map (2D canvas, map image covers the world bbox, north up)
// modes: 'mini' docked bottom-right during play (CSS :hover enlarges it on desktop), 'big' (M / ⤢, desktop), 'full' (result, or tap on phones), 'hidden'
const mapv = $('mapview'), mapc = $('mapc'), mctx = mapc.getContext('2d');
const mapImg = new Image(); mapImg.src = BASE + 'paris_map.jpg'; mapImg.onload = () => drawMap();
let mc = { x: 0, y: 0 }, mk = 0.05, mapW = 1, mapH = 1, mdpr = 1, mapMode = 'hidden';
function setMapMode(m) {
  mapMode = m; mapv.classList.toggle('hidden', m === 'hidden');
  mapv.classList.toggle('mini', m === 'mini' || m === 'big'); mapv.classList.toggle('big', m === 'big'); mapv.classList.toggle('full', m === 'full');
  $('closeMap').classList.toggle('hidden', !(m === 'full' && playing()));
  if (m !== 'mini' && document.pointerLockElement) document.exitPointerLock();
  if (m === 'full' || m === 'big') joy = look = null;
  updateMapUi(); updLock();
}
function toggleBig() { if (!playing()) return; setMapMode(mapMode === 'mini' ? (touch ? 'full' : 'big') : 'mini'); }
function sizeMap() {
  mdpr = Math.min(devicePixelRatio || 1, 2); const w = mapc.clientWidth, h = mapc.clientHeight; if (!w || !h) return;
  if (mapW > 1 && Math.abs(w - mapW) > 0.5) mk *= w / mapW;   // keep the same area visible when the map grows/shrinks
  mapW = w; mapH = h; mapc.width = Math.round(mapW * mdpr); mapc.height = Math.round(mapH * mdpr);
}
new ResizeObserver(() => { if (mapMode === 'hidden') return; sizeMap(); drawMap(); }).observe(mapc);
const fitScale = () => Math.min(mapW / World.width, mapH / World.height);
const toScreen = (x, y) => [mapW / 2 + (x - mc.x) * mk, mapH / 2 - (y - mc.y) * mk];
const toWorld = (sx, sy) => ({ x: mc.x + (sx - mapW / 2) / mk, y: mc.y - (sy - mapH / 2) / mk });
function clampView() { mc.x = Math.min(Math.max(mc.x, 0), World.width); mc.y = Math.min(Math.max(mc.y, 0), World.height); }
function zoomAt(sx, sy, f) {
  const w = toWorld(sx, sy); mk = Math.min(Math.max(mk * f, fitScale() * 0.9), 2);
  const w2 = toWorld(sx, sy); mc.x += w.x - w2.x; mc.y += w.y - w2.y; clampView(); drawMap();
}
function pathRing(c, r, close) { for (let i = 0; i < r.length; i += 2) { const [x, y] = toScreen(r[i], r[i + 1]); i ? c.lineTo(x, y) : c.moveTo(x, y); } if (close) c.closePath(); }
function drawMap() {
  if (mapMode === 'hidden' || !cur) return;
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
  } else { c.fillStyle = '#555'; c.font = '16px system-ui'; c.fillText('Chargement de la carte…', 12, 24); }
  c.lineJoin = c.lineCap = 'round';
  if (cur.hints.arr && cur.arr) {   // arrondissement hint: highlighted boundary
    const a = hintData.arr.find(q => q.a === cur.arr);
    if (a) { c.beginPath(); for (const r of a.p) pathRing(c, r, true); c.fillStyle = 'rgba(40,90,220,.16)'; c.fill();
      c.lineWidth = 5; c.strokeStyle = '#fff'; c.stroke(); c.lineWidth = 3; c.strokeStyle = '#2350c8'; c.stroke(); }
  }
  if (cur.hints.metro) {   // metro/RER hint: line traces in their official colours (RER wider, under the metro)
    const w = Math.min(Math.max(mk * 9, 1.6), 5);
    for (const L of hintData.lines) {
      const lw = L.m === 'R' ? w * 1.5 : w;
      c.beginPath(); for (const p of L.p) pathRing(c, p, false);
      c.lineWidth = lw + 2; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke(); c.lineWidth = lw; c.strokeStyle = '#' + L.c; c.stroke();
    }
  }
  const pinAt = (p, col) => { const [x, y] = toScreen(p.x, p.y); const r = mapMode === 'mini' ? 0.75 : 1; c.beginPath(); c.arc(x, y, 12 * r, 0, 7); c.fillStyle = '#141418'; c.fill();
    c.beginPath(); c.arc(x, y, 9.5 * r, 0, 7); c.fillStyle = col; c.fill(); c.beginPath(); c.arc(x, y, 3.5 * r, 0, 7); c.fillStyle = '#fff'; c.fill(); };
  if (cur.guess) {
    const [gx, gy] = toScreen(cur.guess.x, cur.guess.y), [tx, ty] = toScreen(cur.spawn.x, cur.spawn.y);
    c.setLineDash([5, 7]); c.lineWidth = 3; c.strokeStyle = '#222226'; c.beginPath(); c.moveTo(gx, gy); c.lineTo(tx, ty); c.stroke(); c.setLineDash([]);
    pinAt(cur.guess, '#d93333'); pinAt({ x: cur.spawn.x, y: cur.spawn.y }, '#26a64d');
    if (state === 'Roam') {   // free roam: where the player is now, with heading
      const [px, py] = toScreen(P.x, P.z), a = P.yaw * Math.PI / 180;
      c.beginPath(); c.moveTo(px + Math.sin(a) * 13, py - Math.cos(a) * 13); c.lineTo(px + Math.sin(a + 2.5) * 8, py - Math.cos(a + 2.5) * 8); c.lineTo(px + Math.sin(a - 2.5) * 8, py - Math.cos(a - 2.5) * 8); c.closePath();
      c.fillStyle = '#1f6fe0'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
    }
  } else if (pin) pinAt(pin, '#d93333');
}
function updateMapUi() {
  $('validate').disabled = !pin;
  if (state === 'Explore') $('mapHint').textContent = pin ? 'Devine ou déplace ton repère'
    : (touch ? 'Touche la carte pour placer ton repère · pince pour zoomer' : 'Clique sur la carte pour placer ton repère · molette pour zoomer');
  else if (state === 'Roam') $('mapHint').textContent = 'Balade libre · vert : vrai lieu · rouge : ton repère';
}
const ptrs = new Map(); let dragged = false, pinch = 0;
mapc.addEventListener('pointerdown', e => { mapc.setPointerCapture(e.pointerId); const r = mapc.getBoundingClientRect();
  ptrs.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top, sx: e.clientX, sy: e.clientY, t: performance.now() }); if (ptrs.size === 1) dragged = false; pinch = 0; });
mapc.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return; const r = mapc.getBoundingClientRect();
  const nx = e.clientX - r.left, ny = e.clientY - r.top;
  if (touch && mapMode === 'mini') { p.x = nx; p.y = ny; return; }
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
  if (e.type === 'pointerup' && !dragged && performance.now() - p.t < 800) {
    if (touch && mapMode === 'mini' && playing()) setMapMode('full');   // phones: tap the minimap to expand it
    else if (state === 'Explore') {
      const w = toWorld(p.x, p.y);
      if (w.x >= 0 && w.y >= 0 && w.x <= World.width && w.y <= World.height) { pin = w; log(`pin ${w.x.toFixed(0)},${w.y.toFixed(0)}`); updateMapUi(); drawMap(); }
    }
  }
  if (ptrs.size < 2) pinch = 0;
};
mapc.addEventListener('pointerup', mapUp); mapc.addEventListener('pointercancel', mapUp);
mapc.addEventListener('wheel', e => { e.preventDefault(); const r = mapc.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.18, -Math.sign(e.deltaY))); }, { passive: false });
window.pgDebug = { get state() { return state; }, get cur() { return cur; }, get P() { return P; }, toScreen: (x, y) => toScreen(x, y), get mapMode() { return mapMode; } };

// ------------------------------------------------------------------ main loop
const compassLabels = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const compassSpans = compassLabels.map((t, i) => { const s = document.createElement('span'); s.textContent = t; if (i === 0) s.style.color = '#cc2626'; $('compassInner').appendChild(s); return s; });
let last = performance.now(), frames = 0, perfT = last, roamDraw = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; const st = (now - stateT) / 1000;
  if (playing()) streamer.focus = { x: P.x, z: P.z };
  streamer.update();
  if (landmarks) landmarks.update(streamer.focus.x, streamer.focus.z);
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
        $('hudRound').textContent = `Manche ${rounds.length}/${ROUNDS}`; $('hudScore').textContent = `Score : ${fmt(total())}`;
        setState('Explore'); resetMapView(); drawMap();
      }
      break;
    case 'Explore':
      if (autoDemo && st > 8 && !pin) { pin = { x: cur.spawn.x + (Math.random() - 0.5) * 1800, y: cur.spawn.y + (Math.random() - 0.5) * 1200 }; updateMapUi(); drawMap(); }
      if (autoDemo && pin && st > 11) validate();
      break;
    case 'Roam':
      if (now - roamDraw > 150) { roamDraw = now; drawMap(); }
      if (autoDemo && st > 6) nextRound();
      break;
    case 'Result':
      if (autoDemo && st > 6) { if (rounds.length === 1 && !roamed) startRoam(); else nextRound(); }
      break;
  }
  if (playing()) {
    for (let i = 0; i < 8; i++) {
      let d = ((i * 45 - P.yaw) % 360 + 540) % 360 - 180;
      compassSpans[i].style.display = Math.abs(d) > 80 ? 'none' : ''; compassSpans[i].style.left = (150 + d / 80 * 150) + 'px';
    }
    $('joy').style.display = joy ? 'block' : 'none';
    if (joy) { $('joy').style.left = joy.sx + 'px'; $('joy').style.top = joy.sy + 'px';
      let dx = joy.x - joy.sx, dy = joy.y - joy.sy; const l = Math.hypot(dx, dy); if (l > 60) { dx *= 60 / l; dy *= 60 / l; }
      $('joyKnob').style.transform = `translate(${dx}px, ${dy}px)`; }
  }
  if (state === 'Menu' || playing() || state === 'Loading') {
    updatePlayer(dt);
    if (!(touch && mapMode === 'full')) renderer.render(scene, camera);
  }
  frames++;
  if (now - perfT > 5000) { log(`perf ${(frames * 1000 / (now - perfT)).toFixed(1)} fps, draw calls ${renderer.info.render.calls}, tris ${renderer.info.render.triangles}, tiles ${streamer.loadedCount}, landmarks ${landmarks ? landmarks.builtCount : 0}`); frames = 0; perfT = now; }
}

addEventListener('resize', resize);
resize();
setState('Menu');
requestAnimationFrame(frame);
Promise.all([loadWorld(BASE), fetch(BASE + 'landmarks.json').then(r => r.json()).catch(() => []), fetch(BASE + 'hints.json').then(r => r.json()).catch(() => null)]).then(([, lm, hd]) => {
  if (hd) hintData = hd;
  landmarks = new Landmarks(root, lm, fogEnd); setExclusions(landmarks.exclusions());
  worldReady = true; $('play').disabled = false; $('play').textContent = 'JOUER';
  menuSpawn = World.spawns[(Math.random() * World.spawns.length) | 0];
  streamer.focus = { x: menuSpawn.x, z: menuSpawn.y }; streamer.active = true;
  window.pgReady = true;
}).catch(e => { $('play').textContent = 'Erreur de chargement'; console.error(e); });
