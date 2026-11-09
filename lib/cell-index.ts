/**
 * Indeks spasial + klaster per level zoom untuk sel pengukuran Ookla.
 *
 * Format sel: [lng, lat, unduh(kbps), unggah(kbps), latensi(ms), tes, perangkat, jumlahSel?]
 * - Sel mentah punya 7 elemen.
 * - Sel klaster (hasil agregasi) punya elemen ke-8 = jumlah sel yang digabung.
 *
 * Tujuannya: jumlah titik yang digambar per frame dibatasi oleh ukuran layar, bukan oleh
 * jumlah total data. Level dibangun malas (lazy) dan di-cache.
 */

export type Cell = number[];

export type CellLevel = {
  cells: Cell[];
  grid: Map<number, Cell[]>;
  ix0: number;
  ix1: number;
  iy0: number;
  iy1: number;
};

export const RAW_LEVEL = 99;
/** Mulai zoom ini sel mentah ditampilkan (bin 10px pada zoom 10 ≈ ukuran 1 sel asli). */
export const RAW_FROM_ZOOM = 10;
export const MIN_CLUSTER_LEVEL = 3;
export const MAX_CLUSTER_LEVEL = RAW_FROM_ZOOM - 1;

const BIN_PIXELS = 10;
const KEY_STRIDE = 1024;

export function levelIndexFor(zoom: number) {
  if (zoom >= RAW_FROM_ZOOM) return RAW_LEVEL;
  return Math.max(MIN_CLUSTER_LEVEL, Math.floor(zoom));
}

function bucketKey(ix: number, iy: number) {
  return iy * KEY_STRIDE + ix;
}

export function makeLevel(cells: Cell[]): CellLevel {
  const grid = new Map<number, Cell[]>();
  let ix0 = Infinity;
  let ix1 = -Infinity;
  let iy0 = Infinity;
  let iy1 = -Infinity;
  for (const cell of cells) {
    const ix = Math.floor(cell[0] + 180);
    const iy = Math.floor(cell[1] + 90);
    const key = bucketKey(ix, iy);
    const bucket = grid.get(key);
    if (bucket) bucket.push(cell);
    else grid.set(key, [cell]);
    if (ix < ix0) ix0 = ix;
    if (ix > ix1) ix1 = ix;
    if (iy < iy0) iy0 = iy;
    if (iy > iy1) iy1 = iy;
  }
  return { cells, grid, ix0, ix1, iy0, iy1 };
}

/** Gabungkan sel ke dalam bin ±10–20px pada level zoom tertentu (rata-rata tertimbang jumlah tes). */
export function buildClusters(cells: Cell[], level: number): Cell[] {
  const bin = BIN_PIXELS / (512 * 2 ** level);
  // [bobot, Σlng·w, Σlat·w, Σunduh·w, Σunggah·w, Σlatensi·w, Σtes, Σperangkat, jumlahSel]
  const groups = new Map<number, number[]>();
  for (const cell of cells) {
    const mx = (cell[0] + 180) / 360;
    const sin = Math.sin((cell[1] * Math.PI) / 180);
    const my = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
    const key = Math.floor(my / bin) * 4194304 + Math.floor(mx / bin);
    const weight = cell[5] > 0 ? cell[5] : 1;
    let group = groups.get(key);
    if (!group) {
      group = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      groups.set(key, group);
    }
    group[0] += weight;
    group[1] += cell[0] * weight;
    group[2] += cell[1] * weight;
    group[3] += cell[2] * weight;
    group[4] += cell[3] * weight;
    group[5] += cell[4] * weight;
    group[6] += cell[5];
    group[7] += cell[6];
    group[8] += 1;
  }
  const result: Cell[] = [];
  for (const g of groups.values()) {
    result.push([
      g[1] / g[0],
      g[2] / g[0],
      Math.round(g[3] / g[0]),
      Math.round(g[4] / g[0]),
      Math.round(g[5] / g[0]),
      g[6],
      g[7],
      g[8],
    ]);
  }
  return result;
}

export function getLevel(store: Map<number, CellLevel>, cells: Cell[], index: number): CellLevel {
  let level = store.get(index);
  if (!level) {
    level = makeLevel(index === RAW_LEVEL ? cells : buildClusters(cells, index));
    store.set(index, level);
  }
  return level;
}

export function forEachInBounds(
  level: CellLevel,
  west: number,
  south: number,
  east: number,
  north: number,
  visit: (cell: Cell) => void,
) {
  if (!level.cells.length) return;
  const fromX = Math.max(level.ix0, Math.floor(west + 180));
  const toX = Math.min(level.ix1, Math.floor(east + 180));
  const fromY = Math.max(level.iy0, Math.floor(south + 90));
  const toY = Math.min(level.iy1, Math.floor(north + 90));
  for (let iy = fromY; iy <= toY; iy++) {
    for (let ix = fromX; ix <= toX; ix++) {
      const bucket = level.grid.get(bucketKey(ix, iy));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) visit(bucket[i]);
    }
  }
}
