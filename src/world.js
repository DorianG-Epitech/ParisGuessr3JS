// Static world data: bbox, tile index, spawn points (random street points inside Paris), street-name prettifier.
export const World = { x0: 0, y0: 0, width: 0, height: 0, tile: 250, nx: 0, ny: 0, tiles: new Set(), spawns: [] };
export const key = (x, y) => y * 1000 + x;

export async function loadWorld(base) {
  const [meta, idx, sp] = await Promise.all([
    fetch(base + 'meta.json').then(r => r.json()),
    fetch(base + 'tiles.bin').then(r => r.arrayBuffer()),
    fetch(base + 'spawns.bin').then(r => r.arrayBuffer()),
  ]);
  Object.assign(World, { x0: meta.x0, y0: meta.y0, width: meta.x1 - meta.x0, height: meta.y1 - meta.y0, tile: meta.tile, nx: meta.nx, ny: meta.ny });
  let d = new DataView(idx), n = d.getInt32(0, true);
  for (let i = 0; i < n; i++) World.tiles.add(key(d.getUint16(4 + i * 4, true), d.getUint16(6 + i * 4, true)));
  d = new DataView(sp); let o = 4; const dec = new TextDecoder();
  const nn = d.getInt32(o, true); o += 4; const names = [];
  for (let i = 0; i < nn; i++) { const l = d.getUint16(o, true); o += 2; names.push(pretty(dec.decode(new Uint8Array(sp, o, l)))); o += l; }
  const ns = d.getInt32(o, true); o += 4;
  for (let i = 0; i < ns; i++) {
    const x = d.getFloat32(o, true), y = d.getFloat32(o + 4, true), h = d.getUint16(o + 8, true) / 100, arr = d.getUint8(o + 10), ni = d.getUint16(o + 11, true);
    o += 13; World.spawns.push({ x, y, heading: h, arr, street: names[ni] || '' });
  }
  console.log(`[PG] world ${World.width}x${World.height} m, ${World.tiles.size} tiles, ${World.spawns.length} spawns`);
}

const ABBR = { R: 'Rue', AV: 'Avenue', BD: 'Boulevard', PL: 'Place', QU: 'Quai', QUAI: 'Quai', IMP: 'Impasse', PAS: 'Passage', SQ: 'Square', VLA: 'Villa',
  CITE: 'Cité', CHE: 'Chemin', RTE: 'Route', ALL: 'Allée', CRS: 'Cours', PONT: 'Pont', PORT: 'Port', RPT: 'Rond-point', SEN: 'Sentier', HAM: 'Hameau',
  CAR: 'Carrefour', GAL: 'Galerie', PRV: 'Parvis', ESP: 'Esplanade', PROM: 'Promenade', PTE: 'Porte', CHAU: 'Chaussée', COUR: 'Cour', ST: 'Saint', STE: 'Sainte' };
const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'sur', 'aux', 'au', 'à']);
const cap = x => x.split('-').map(p => p === 'ST' ? 'Saint' : p === 'STE' ? 'Sainte' : p ? p[0] + p.slice(1).toLowerCase() : p).join('-');
/** "R DE LA MONTAGNE SAINTE-GENEVIEVE" -> "Rue de la Montagne Sainte-Genevieve" */
export function pretty(n) {
  if (!n || n.toUpperCase() !== n) return n;
  return n.split(' ').filter(Boolean).map((w, i) => {
    if (i === 0 && ABBR[w]) return ABBR[w];
    if (i > 0 && SMALL.has(w.toLowerCase())) return w.toLowerCase();
    if (/^[LD]'/.test(w)) return w[0].toLowerCase() + "'" + cap(w.slice(2));
    if (w === 'ST' || w === 'STE') return ABBR[w];
    return cap(w);
  }).join(' ');
}
export const arrName = a => a <= 0 ? 'Paris' : a === 1 ? '1er arrondissement' : `${a}e arrondissement`;
