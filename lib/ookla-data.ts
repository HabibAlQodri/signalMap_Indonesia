import type { Cell } from "./cell-index";

export type OoklaNetworkType = "mobile" | "fixed";

export type OoklaMetadata = {
  source: string;
  networkType: OoklaNetworkType;
  networkLabel: string;
  period: string;
  periodLabel: string;
  bounds: { west: number; south: number; east: number; north: number };
  records: number;
  tests: number;
  devices: number;
  avgDownloadKbps: number;
  avgUploadKbps: number;
  avgLatencyMs: number;
  aggregatedCells: number;
  aggregation: string;
};

export type OoklaData = OoklaMetadata & {
  cells: Cell[];
};

export function formatOoklaPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `Q${Math.ceil(month / 3)} ${year}`;
}

export function formatOoklaNetworkType(networkType: OoklaNetworkType) {
  return networkType === "mobile" ? "Mobile" : "Fixed broadband";
}
