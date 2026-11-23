import type { Cell, CellLevel } from "../map/cell-index";
import {
  getLevel,
  MIN_CLUSTER_LEVEL,
  MAX_CLUSTER_LEVEL,
  RAW_LEVEL,
} from "../map/cell-index";
import type { OoklaData, OoklaNetworkType } from "./ookla-data";
import {
  buildIndonesiaBoundaryIndex,
  type IndonesiaBoundaryIndex,
} from "../map/indonesia-boundary";

export type CachedDataset = {
  data: OoklaData;
  levels: Map<number, CellLevel>;
  referenceIndex?: Map<string, Cell>;
};

// Global in-memory cache persisten sepanjang sesi browser
const datasetCache = new Map<string, CachedDataset>();
const inFlightRequests = new Map<string, Promise<OoklaData>>();

let sharedBoundaryIndex: IndonesiaBoundaryIndex | null = null;
let boundaryPromise: Promise<IndonesiaBoundaryIndex> | null = null;

export function getDatasetCacheKey(networkType: OoklaNetworkType, period: string) {
  return `${networkType}-${period}`;
}

export function isDatasetCached(networkType: OoklaNetworkType, period: string): boolean {
  return datasetCache.has(getDatasetCacheKey(networkType, period));
}

export function getCachedDataset(networkType: OoklaNetworkType, period: string): CachedDataset | undefined {
  return datasetCache.get(getDatasetCacheKey(networkType, period));
}

export function makeReferenceIndex(cells: Cell[]): Map<string, Cell> {
  const index = new Map<string, Cell>();
  for (const c of cells) {
    const k = `${c[0].toFixed(2)},${c[1].toFixed(2)}`;
    if (!index.has(k)) index.set(k, c);
  }
  return index;
}

export async function getSharedBoundaryIndex(signal?: AbortSignal): Promise<IndonesiaBoundaryIndex> {
  if (sharedBoundaryIndex) return sharedBoundaryIndex;
  if (boundaryPromise) return boundaryPromise;

  boundaryPromise = fetch("/boundaries/indonesia-adm0.geojson", { signal })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Batas Indonesia gagal dimuat (${response.status})`);
      }
      const collection = (await response.json()) as GeoJSON.FeatureCollection;
      sharedBoundaryIndex = buildIndonesiaBoundaryIndex(collection);
      return sharedBoundaryIndex;
    })
    .finally(() => {
      boundaryPromise = null;
    });

  return boundaryPromise;
}

export function prebuildLevels(cells: Cell[]): Map<number, CellLevel> {
  const levels = new Map<number, CellLevel>();
  // Bangun level awal yang sering dilihat saat pertama load
  for (let l = MIN_CLUSTER_LEVEL; l <= Math.min(MIN_CLUSTER_LEVEL + 2, MAX_CLUSTER_LEVEL); l++) {
    getLevel(levels, cells, l);
  }
  getLevel(levels, cells, RAW_LEVEL);
  return levels;
}

export async function loadProcessedDataset(
  networkType: OoklaNetworkType,
  period: string,
  signal?: AbortSignal
): Promise<OoklaData> {
  const key = getDatasetCacheKey(networkType, period);
  const cached = datasetCache.get(key);
  if (cached) {
    return cached.data;
  }

  const existingInFlight = inFlightRequests.get(key);
  if (existingInFlight) {
    return existingInFlight;
  }

  const requestPromise = (async () => {
    try {
      const dataPromise = fetch(`/data/ookla/${networkType}-${period}.json`, { signal }).then(
        async (res) => {
          if (!res.ok) throw new Error(`Permintaan data gagal (${res.status})`);
          return res.json() as Promise<OoklaData>;
        }
      );

      const [result, boundaryIndex] = await Promise.all([
        dataPromise,
        getSharedBoundaryIndex(signal),
      ]);

      // Filter hanya sel yang berada di dalam wilayah kedaulatan Indonesia
      const cells = result.cells.filter((cell) => boundaryIndex.contains(cell[0], cell[1]));

      const totals = cells.reduce(
        (sum, cell) => ({
          tests: sum.tests + cell[5],
          devices: sum.devices + cell[6],
          download: sum.download + cell[2] * cell[5],
          upload: sum.upload + cell[3] * cell[5],
          latency: sum.latency + cell[4] * cell[5],
          latencyDown: sum.latencyDown + (cell[8] ?? cell[4]) * cell[5],
          latencyUp: sum.latencyUp + (cell[9] ?? cell[4]) * cell[5],
        }),
        { tests: 0, devices: 0, download: 0, upload: 0, latency: 0, latencyDown: 0, latencyUp: 0 }
      );

      const weightedAverage = (value: number, precision = 0) => {
        if (!totals.tests) return 0;
        const factor = 10 ** precision;
        return Math.round((value / totals.tests) * factor) / factor;
      };

      const indonesiaData: OoklaData = {
        ...result,
        cells,
        aggregatedCells: cells.length,
        tests: totals.tests,
        devices: totals.devices,
        avgDownloadKbps: weightedAverage(totals.download),
        avgUploadKbps: weightedAverage(totals.upload),
        avgLatencyMs: weightedAverage(totals.latency, 1),
        avgLatencyDownMs: weightedAverage(totals.latencyDown, 1),
        avgLatencyUpMs: weightedAverage(totals.latencyUp, 1),
      };

      // Siapkan klaster awal
      const levels = prebuildLevels(cells);

      datasetCache.set(key, {
        data: indonesiaData,
        levels,
      });

      return indonesiaData;
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, requestPromise);
  return requestPromise;
}

export function prefetchDataset(networkType: OoklaNetworkType, period: string): void {
  const key = getDatasetCacheKey(networkType, period);
  if (datasetCache.has(key) || inFlightRequests.has(key)) return;

  // Gunakan idle callback atau timeout kecil agar tidak bersaing dengan rendering frame utama
  if (typeof window !== "undefined") {
    const run = () => {
      loadProcessedDataset(networkType, period).catch(() => {
        // Abaikan error prefetch latar belakang
      });
    };

    const win = window as unknown as { requestIdleCallback?: (fn: () => void) => void };
    if (typeof win.requestIdleCallback === "function") {
      win.requestIdleCallback(run);
    } else {
      setTimeout(run, 60);
    }
  }
}

export function prefetchAdjacentPeriods(
  networkType: OoklaNetworkType,
  currentPeriod: string,
  chronologicalPeriods: { value: string; label: string }[],
  viewMode: "normal" | "delta" = "normal"
): void {
  const currentIndex = chronologicalPeriods.findIndex((p) => p.value === currentPeriod);
  if (currentIndex === -1) return;

  // Prioritas 1: Kuartal berikutnya (forward in time)
  if (currentIndex < chronologicalPeriods.length - 1) {
    prefetchDataset(networkType, chronologicalPeriods[currentIndex + 1].value);
  }

  // Prioritas 2: Dua kuartal berikutnya (untuk autoplay cepat 2x)
  if (currentIndex < chronologicalPeriods.length - 2) {
    prefetchDataset(networkType, chronologicalPeriods[currentIndex + 2].value);
  }

  // Prioritas 3: Kuartal sebelumnya (scrubbing back)
  if (currentIndex > 0) {
    prefetchDataset(networkType, chronologicalPeriods[currentIndex - 1].value);
  }

  // Jika mode delta aktif, prefetch periode pembanding YoY (4 kuartal lalu)
  if (viewMode === "delta" && currentIndex >= 4) {
    prefetchDataset(networkType, chronologicalPeriods[currentIndex - 4].value);
  }
}
