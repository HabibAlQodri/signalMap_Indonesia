/**
 * Isolation Forest — implementasi TypeScript ringan untuk deteksi anomali
 * pada data time-series performa jaringan Ookla.
 *
 * Algoritma:
 *  1. Bangun n pohon isolasi (ITree) dari sampel acak data
 *  2. Setiap node membagi data secara acak (fitur acak, nilai split acak)
 *  3. Anomali = titik yang terisolasi lebih cepat (path pendek → skor tinggi)
 *  4. Skor akhir dinormalisasi 0–1 (> 0.6 = anomali kandidat)
 */

export type IFPoint = number[]; // [download, upload, latency, qoqDelta, yoyDelta]

interface ITreeNode {
  isLeaf: boolean;
  size: number;
  splitFeature?: number;
  splitValue?: number;
  left?: ITreeNode;
  right?: ITreeNode;
}

/** Rata-rata path length untuk n titik, berdasarkan formula Isolation Forest */
function avgPathLength(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  const H = Math.log(n - 1) + 0.5772156649; // Euler-Mascheroni
  return 2 * H - (2 * (n - 1)) / n;
}

/** Bangun satu pohon isolasi secara rekursif */
function buildTree(data: IFPoint[], maxDepth: number, depth = 0): ITreeNode {
  const n = data.length;
  if (n <= 1 || depth >= maxDepth) {
    return { isLeaf: true, size: n };
  }

  const dim = data[0].length;
  const feat = Math.floor(Math.random() * dim);

  const vals = data.map((p) => p[feat]);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);

  if (minV === maxV) {
    return { isLeaf: true, size: n };
  }

  const split = minV + Math.random() * (maxV - minV);
  const left = data.filter((p) => p[feat] < split);
  const right = data.filter((p) => p[feat] >= split);

  return {
    isLeaf: false,
    size: n,
    splitFeature: feat,
    splitValue: split,
    left: buildTree(left, maxDepth, depth + 1),
    right: buildTree(right, maxDepth, depth + 1),
  };
}

/** Hitung path length sebuah titik dalam satu pohon */
function pathLength(point: IFPoint, node: ITreeNode, depth = 0): number {
  if (node.isLeaf) {
    return depth + avgPathLength(node.size);
  }
  if (point[node.splitFeature!] < node.splitValue!) {
    return pathLength(point, node.left!, depth + 1);
  }
  return pathLength(point, node.right!, depth + 1);
}

export interface AnomalyResult {
  score: number;    // 0–1, semakin tinggi semakin anomali
  avgPath: number;  // rata-rata path length raw
  isAnomaly: boolean;
  severity: "normal" | "perhatian" | "kritis";
}

export interface IsolationForest {
  score(point: IFPoint): AnomalyResult;
}

/**
 * Latih Isolation Forest
 * @param data   Array titik data (setiap titik = array angka)
 * @param nTrees Jumlah pohon (default 100)
 * @param sampleSize Ukuran subsampel per pohon (default 256 atau panjang data)
 */
export function trainIsolationForest(
  data: IFPoint[],
  nTrees = 100,
  sampleSize?: number,
): IsolationForest {
  const n = data.length;
  if (n < 2) {
    return {
      score: () => ({ score: 0, avgPath: 0, isAnomaly: false, severity: "normal" }),
    };
  }

  const ss = Math.min(sampleSize ?? 256, n);
  const maxDepth = Math.ceil(Math.log2(ss));

  const trees: ITreeNode[] = [];
  for (let i = 0; i < nTrees; i++) {
    // Subsampel acak tanpa pengembalian
    const shuffled = [...data].sort(() => Math.random() - 0.5).slice(0, ss);
    trees.push(buildTree(shuffled, maxDepth));
  }

  const baseline = avgPathLength(ss);

  return {
    score(point: IFPoint): AnomalyResult {
      const paths = trees.map((tree) => pathLength(point, tree));
      const avg = paths.reduce((a, b) => a + b, 0) / paths.length;
      // Rumus anomaly score: s = 2^(-avg/baseline)
      const raw = Math.pow(2, -avg / baseline);
      const score = Math.max(0, Math.min(1, raw));

      const isAnomaly = score > 0.60;
      const severity: AnomalyResult["severity"] =
        score > 0.72 ? "kritis" : score > 0.60 ? "perhatian" : "normal";

      return { score, avgPath: avg, isAnomaly, severity };
    },
  };
}

