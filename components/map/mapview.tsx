"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { formatNumber } from "../../lib/network-data";
import {
  type Cell,
  type CellLevel,
  RAW_LEVEL,
  MIN_CLUSTER_LEVEL,
  MAX_CLUSTER_LEVEL,
  forEachInBounds,
  getLevel,
  levelIndexFor,
} from "../../lib/map/cell-index";
import { buildIndonesiaBoundaryIndex, type IndonesiaBoundaryIndex } from "../../lib/map/indonesia-boundary";
import {
  type OoklaData,
  type OoklaLatencyDirection,
  type OoklaMetadata,
  type OoklaNetworkType,
  formatOoklaNetworkType,
  formatOoklaPeriod,
} from "../../lib/ookla/ookla-data";
import Icon from "../ui/icon";
import { useLanguage } from "../../lib/i18n";

export type MapMetric = "download" | "upload" | "latency";
export type Basemap = "light" | "voyager" | "dark";
export type MapViewMode = "normal" | "delta";
export type BoundaryLevel = "none" | "adm0" | "adm1" | "adm2";
type AdministrativeBoundaryLevel = Exclude<BoundaryLevel, "none">;

type FocusLocation = {
  name: string;
  center: { lat: number; lng: number };
  zoom: number;
  key: number;
};

type MapViewProps = {
  focusLocation: FocusLocation;
  metric: MapMetric;
  latencyDirection: OoklaLatencyDirection;
  networkType: OoklaNetworkType;
  period: string;
  basemap: Basemap;
  boundaryLevel: BoundaryLevel;
  overlayOn: boolean;
  minTests: number;
  view3d?: boolean;
  viewMode?: MapViewMode;
  referencePeriod?: string | null;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onInitialLoadComplete?: () => void;
  onDataLoaded: (data: OoklaMetadata | null) => void;
  onMapDataLoaded: (data: OoklaData | null) => void;
};

type LegendBand = { label: string; color: string };

export function colorForDelta(pct: number) {
  if (pct === 9999) return "#2563eb"; // Cakupan Baru
  if (pct >= 50) return "#16a085"; // Peningkatan pesat
  if (pct >= 15) return "#83b968"; // Peningkatan baik
  if (pct >= -15) return "#e8ac48"; // Stabil
  return "#d65e4d"; // Penurunan
}

function metricDetailsFor(
  data: OoklaData | null,
  viewMode: MapViewMode,
  t: (message: string) => string,
  locale: string,
  latencyDirection: OoklaLatencyDirection,
): Record<
  MapMetric,
  { label: string; unit: string; bands: LegendBand[]; average: string; ends: [string, string] }
> {
  const latencyLabel = latencyDirection === "down"
    ? t("Latensi unduh")
    : latencyDirection === "up"
      ? t("Latensi unggah")
      : t("Latensi rata-rata");
  const latencyAverage = latencyDirection === "down"
    ? data?.avgLatencyDownMs ?? data?.avgLatencyMs
    : latencyDirection === "up"
      ? data?.avgLatencyUpMs ?? data?.avgLatencyMs
      : data?.avgLatencyMs;
  if (viewMode === "delta") {
    const deltaBands: LegendBand[] = [
      { label: "<-15%", color: "#d65e4d" },
      { label: "±15%", color: "#e8ac48" },
      { label: "+15–50%", color: "#83b968" },
      { label: ">+50%", color: "#16a085" },
      { label: t("Baru"), color: "#2563eb" },
    ];
    return {
      download: {
        label: t("Pertumbuhan Unduh (YoY)"),
        unit: "% YoY",
        bands: deltaBands,
        average: data ? `${(data.avgDownloadKbps / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} Mbps` : "—",
        ends: [t("Turun"), t("Naik")],
      },
      upload: {
        label: t("Pertumbuhan Unggah (YoY)"),
        unit: "% YoY",
        bands: deltaBands,
        average: data ? `${(data.avgUploadKbps / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} Mbps` : "—",
        ends: [t("Turun"), t("Naik")],
      },
      latency: {
        label: `${t("Perbaikan")} ${latencyLabel} (YoY)`,
        unit: "% YoY",
        bands: [
          { label: t("Memburuk"), color: "#d65e4d" },
          { label: t("Stabil"), color: "#e8ac48" },
          { label: t("Membaik"), color: "#83b968" },
          { label: ">+50%", color: "#16a085" },
          { label: t("Baru"), color: "#2563eb" },
        ],
        average: latencyAverage === undefined ? "—" : `${latencyAverage.toLocaleString(locale)} ms`,
        ends: [t("Memburuk"), t("Membaik")],
      },
    };
  }

  return {
    download: {
      label: t("Kecepatan unduh"),
      unit: "Mbps",
      bands: [
        { label: "<20", color: "#d65e4d" },
        { label: "20–50", color: "#e8ac48" },
        { label: "50–100", color: "#83b968" },
        { label: ">100", color: "#16a085" },
      ],
      average: data ? `${(data.avgDownloadKbps / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} Mbps` : "—",
      ends: [t("Rendah"), t("Tinggi")],
    },
    upload: {
      label: t("Kecepatan unggah"),
      unit: "Mbps",
      bands: [
        { label: "<20", color: "#d65e4d" },
        { label: "20–50", color: "#e8ac48" },
        { label: "50–100", color: "#83b968" },
        { label: ">100", color: "#16a085" },
      ],
      average: data ? `${(data.avgUploadKbps / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} Mbps` : "—",
      ends: [t("Rendah"), t("Tinggi")],
    },
    latency: {
      label: latencyLabel,
      unit: "ms",
      bands: [
        { label: ">100", color: "#d65e4d" },
        { label: "60–100", color: "#e8ac48" },
        { label: "30–60", color: "#83b968" },
        { label: "≤30", color: "#16a085" },
      ],
      average: latencyAverage === undefined ? "—" : `${latencyAverage.toLocaleString(locale)} ms`,
      ends: [t("Lambat"), t("Cepat")],
    },
  };
}

const basemapNames: Record<Basemap, string> = {
  voyager: "voyager",
  light: "positron",
  dark: "dark-matter",
};

function colorForMetric(value: number, metric: MapMetric) {
  if (metric === "latency") {
    if (value <= 30) return "#16a085";
    if (value <= 60) return "#83b968";
    if (value <= 100) return "#e8ac48";
    return "#d65e4d";
  }
  const mbps = value / 1000;
  if (mbps >= 100) return "#16a085";
  if (mbps >= 50) return "#83b968";
  if (mbps >= 20) return "#e8ac48";
  return "#d65e4d";
}

function qualityFor(value: number, metric: MapMetric, t: (message: string) => string) {
  const color = colorForMetric(value, metric);
  const label =
    color === "#16a085" ? t("Sangat baik") : color === "#83b968" ? t("Baik") : color === "#e8ac48" ? t("Cukup") : t("Rendah");
  return { color, label };
}

function metricValue(cell: Cell, metric: MapMetric, latencyDirection: OoklaLatencyDirection = "average") {
  if (metric === "download") return cell[2];
  if (metric === "upload") return cell[3];
  if (latencyDirection === "down") return cell[8] ?? cell[4];
  if (latencyDirection === "up") return cell[9] ?? cell[4];
  return cell[4];
}

function formatCellMetric(value: number, metric: MapMetric, locale = "id-ID") {
  if (metric === "latency") return `${value.toLocaleString(locale)} ms`;
  return `${(value / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} Mbps`;
}

/** Cari sel terdekat dari titik layar memakai indeks grid (tidak memindai semua data). */
function findNearestCell(map: MapLibreMap, level: CellLevel, point: { x: number; y: number }, radius: number) {
  const corners = [
    map.unproject([point.x - radius, point.y - radius]),
    map.unproject([point.x + radius, point.y - radius]),
    map.unproject([point.x - radius, point.y + radius]),
    map.unproject([point.x + radius, point.y + radius]),
  ];
  const west = Math.min(...corners.map((c) => c.lng));
  const east = Math.max(...corners.map((c) => c.lng));
  const south = Math.min(...corners.map((c) => c.lat));
  const north = Math.max(...corners.map((c) => c.lat));
  let nearest: Cell | null = null;
  let nearestDistance = radius;
  forEachInBounds(level, west, south, east, north, (cell) => {
    const projected = map.project([cell[0], cell[1]]);
    const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (distance < nearestDistance) {
      nearest = cell;
      nearestDistance = distance;
    }
  });
  return nearest as Cell | null;
}

/** ---- Mode 3D: batang ekstrusi untuk sel yang ada di area layar saat ini ---- */
const SOURCE_3D = "cells-3d";
const LAYER_3D = "cells-3d-bars";
const BOUNDARY_SOURCE = "administrative-boundaries";
const BOUNDARY_FILL_LAYER = "administrative-boundaries-fill";
const BOUNDARY_LINE_LAYER = "administrative-boundaries-line";
const BOUNDARY_FILES: Record<AdministrativeBoundaryLevel, string> = {
  adm0: "/boundaries/indonesia-adm0.geojson",
  adm1: "/boundaries/indonesia-adm1.geojson",
  adm2: "/boundaries/indonesia-adm2.geojson",
};
const MAX_BARS = 6000;
const MAX_BAR_PX = 120;
const PITCH_3D = 58;
const BEARING_3D = -18;

/** Meter per piksel layar pada zoom & lintang tertentu (tile 512px MapLibre). */
function metersPerPixel(zoom: number, lat: number) {
  return (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export function makeReferenceIndex(cells: Cell[]): Map<string, Cell> {
  const index = new Map<string, Cell>();
  for (const c of cells) {
    const k = `${c[0].toFixed(2)},${c[1].toFixed(2)}`;
    if (!index.has(k)) index.set(k, c);
  }
  return index;
}

export function getCellDelta(
  cell: Cell,
  refIndex: Map<string, Cell> | null,
  metric: MapMetric,
  latencyDirection: OoklaLatencyDirection = "average",
): { pct: number | null; prevValue: number | null } {
  if (!refIndex || refIndex.size === 0) return { pct: null, prevValue: null };
  const k = `${cell[0].toFixed(2)},${cell[1].toFixed(2)}`;
  const prev = refIndex.get(k);
  if (!prev) return { pct: 9999, prevValue: null };
  const currVal = metricValue(cell, metric, latencyDirection);
  const prevVal = metricValue(prev, metric, latencyDirection);
  if (prevVal <= 0) return { pct: 9999, prevValue: null };
  if (metric === "latency") {
    // Latensi turun = koneksi membaik (persentase positif)
    const pct = ((prevVal - currVal) / prevVal) * 100;
    return { pct, prevValue: prevVal };
  } else {
    const pct = ((currVal - prevVal) / prevVal) * 100;
    return { pct, prevValue: prevVal };
  }
}

function buildBars(
  map: MapLibreMap,
  cells: Cell[],
  levels: Map<number, CellLevel>,
  metric: MapMetric,
  latencyDirection: OoklaLatencyDirection,
  viewMode: MapViewMode = "normal",
  referenceIndex: Map<string, Cell> | null = null
) {
  const zoom = map.getZoom();
  const index = levelIndexFor(zoom);
  const level = getLevel(levels, cells, index);
  // Pitch membuat bounds mencakup area jauh di cakrawala; batasi lewat getBounds() lalu ambil sel terpadat.
  const bounds = map.getBounds();
  const picked: Cell[] = [];
  forEachInBounds(level, bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(), (cell) => {
    picked.push(cell);
  });
  const visible = picked.length > MAX_BARS ? picked.sort((a, b) => b[5] - a[5]).slice(0, MAX_BARS) : picked;

  const center = map.getCenter();
  const maxHeight = MAX_BAR_PX * metersPerPixel(zoom, center.lat);
  let maxTests = 1;
  for (const cell of visible) if (cell[5] > maxTests) maxTests = cell[5];
  const logMax = Math.log10(maxTests + 1) || 1;

  // Lebar batang ≈ ukuran sel di layar (bin 10px untuk klaster, ±610 m untuk sel asli).
  const widthDeg = (index === RAW_LEVEL ? 0.0055 : (10 * 360) / (512 * 2 ** index)) * 0.78;
  const half = widthDeg / 2;

  const features = visible.map((cell, i) => {
    const [lng, lat] = cell;
    const halfLat = half * Math.cos((lat * Math.PI) / 180);
    const norm = Math.log10(cell[5] + 1) / logMax;
    const value = metricValue(cell, metric, latencyDirection);
    let color: string;
    if (viewMode === "delta" && referenceIndex) {
      const delta = getCellDelta(cell, referenceIndex, metric, latencyDirection);
      color = delta.pct !== null ? colorForDelta(delta.pct) : colorForMetric(value, metric);
    } else {
      color = colorForMetric(value, metric);
    }
    return {
      type: "Feature" as const,
      properties: {
        id: i,
        color,
        height: Math.max(maxHeight * 0.04, maxHeight * norm * norm),
        d: cell[2],
        u: cell[3],
        l: cell[4],
        ld: cell[8] ?? cell[4],
        lu: cell[9] ?? cell[4],
        t: cell[5],
        v: cell[6],
        n: cell[7] ?? 1,
        lng,
        lat,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [lng - half, lat - halfLat],
          [lng + half, lat - halfLat],
          [lng + half, lat + halfLat],
          [lng - half, lat + halfLat],
          [lng - half, lat - halfLat],
        ]],
      },
    };
  });
  return { type: "FeatureCollection" as const, features };
}

function cellFromProps(p: Record<string, number>): Cell {
  return [p.lng, p.lat, p.d, p.u, p.l, p.t, p.v, p.n, p.ld, p.lu];
}

/** Sprite halo per warna: jauh lebih murah daripada membuat gradient untuk setiap sel. */
const spriteCache = new Map<string, HTMLCanvasElement>();
function heatSprite(color: string) {
  let sprite = spriteCache.get(color);
  if (!sprite) {
    sprite = document.createElement("canvas");
    sprite.width = 48;
    sprite.height = 48;
    const g = sprite.getContext("2d");
    if (g) {
      const gradient = g.createRadialGradient(24, 24, 0, 24, 24, 24);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.28, color);
      gradient.addColorStop(1, `${color}00`);
      g.fillStyle = gradient;
      g.fillRect(0, 0, 48, 48);
    }
    spriteCache.set(color, sprite);
  }
  return sprite;
}

export default function MapView({
  focusLocation,
  metric,
  latencyDirection,
  networkType,
  period,
  basemap,
  boundaryLevel,
  overlayOn,
  minTests,
  view3d = false,
  viewMode = "normal",
  referencePeriod = null,
  fullscreen = false,
  onToggleFullscreen,
  onInitialLoadComplete,
  onDataLoaded,
  onMapDataLoaded,
}: MapViewProps) {
  const { t, locale } = useLanguage();
  const tRef = useRef(t);
  const localeRef = useRef(locale === "en" ? "en-US" : "id-ID");
  useEffect(() => {
    tRef.current = t;
    localeRef.current = locale === "en" ? "en-US" : "id-ID";
  }, [locale, t]);
  const datasetKey = `${networkType}-${period}`;
  const [loadedDataset, setLoadedDataset] = useState<{
    key: string;
    data: OoklaData | null;
    error: string;
  } | null>(null);
  const data = loadedDataset?.key === datasetKey ? loadedDataset.data : null;
  const dataError = loadedDataset?.key === datasetKey ? loadedDataset.error : "";
  const mapData = useMemo(() => {
    if (!data || minTests === 0) return data;
    return { ...data, cells: data.cells.filter((cell) => cell[5] >= minTests) };
  }, [data, minTests]);
  const [mapError, setMapError] = useState("");
  const [locationError, setLocationError] = useState("");
  const locationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLocationError = useCallback(() => {
    if (locationTimerRef.current) {
      clearTimeout(locationTimerRef.current);
      locationTimerRef.current = null;
    }
    setLocationError("");
  }, []);

  const showLocationError = useCallback((msg: string) => {
    if (locationTimerRef.current) {
      clearTimeout(locationTimerRef.current);
    }
    setLocationError(msg);
    locationTimerRef.current = setTimeout(() => {
      setLocationError("");
      locationTimerRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => {
    return () => {
      if (locationTimerRef.current) {
        clearTimeout(locationTimerRef.current);
      }
    };
  }, []);

  const [mapReady, setMapReady] = useState(false);
  const [boundaryFailure, setBoundaryFailure] = useState<{
    level: AdministrativeBoundaryLevel;
    message: string;
  } | null>(null);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [referenceData, setReferenceData] = useState<OoklaData | null>(null);
  const referenceMapData = useMemo(() => {
    if (!referenceData || minTests === 0) return referenceData;
    return { ...referenceData, cells: referenceData.cells.filter((cell) => cell[5] >= minTests) };
  }, [referenceData, minTests]);
  const refCache = useRef<Map<string, OoklaData>>(new Map());
  const viewModeRef = useRef(viewMode);
  const referenceIndexRef = useRef<Map<string, Cell> | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const compassRef = useRef<HTMLSpanElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const boundaryCacheRef = useRef(new Map<AdministrativeBoundaryLevel, GeoJSON.FeatureCollection>());
  const boundaryRequestRef = useRef(new Map<AdministrativeBoundaryLevel, Promise<GeoJSON.FeatureCollection>>());
  const boundaryLevelRef = useRef(boundaryLevel);
  const indonesiaBoundaryRef = useRef<IndonesiaBoundaryIndex | null>(null);
  const mapReadyRef = useRef(false);
  const dataRef = useRef<OoklaData | null>(null);
  const overlayOnRef = useRef(overlayOn);
  const view3dRef = useRef(view3d);
  const metricRef = useRef(metric);
  const latencyDirectionRef = useRef(latencyDirection);
  const basemapRef = useRef(basemap);
  const hoverRef = useRef<Cell | null>(null);
  const levelsRef = useRef<Map<number, CellLevel>>(new Map());
  const initialFocusRef = useRef(focusLocation);
  const lastFocusKeyRef = useRef(focusLocation.key);
  const drawRef = useRef<(() => void) | null>(null);
  const cartoKey = process.env.NEXT_PUBLIC_CARTO_KEY;

  const loadBoundaryCollection = useCallback((level: AdministrativeBoundaryLevel) => {
    const cached = boundaryCacheRef.current.get(level);
    if (cached) return Promise.resolve(cached);

    const pending = boundaryRequestRef.current.get(level);
    if (pending) return pending;

    const request = fetch(BOUNDARY_FILES[level]).then(async (response) => {
      if (!response.ok) {
        throw new Error(tRef.current("Gagal memuat batas administratif ({status}).").replace("{status}", String(response.status)));
      }
      const collection = await response.json() as GeoJSON.FeatureCollection;
      if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
        throw new Error(tRef.current("Format data batas administratif tidak valid."));
      }
      boundaryCacheRef.current.set(level, collection);
      return collection;
    });
    boundaryRequestRef.current.set(level, request);
    void request.catch(() => {
      if (boundaryRequestRef.current.get(level) === request) boundaryRequestRef.current.delete(level);
    });
    return request;
  }, []);

  // Sel terpilih hanya relevan saat overlay aktif.
  const activeCell = overlayOn && mapData && selectedCell && selectedCell[5] >= minTests ? selectedCell : null;

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "delta" || !referencePeriod) {
      setReferenceData(null);
      return;
    }
    const key = `${networkType}-${referencePeriod}`;
    const cached = refCache.current.get(key);
    if (cached) {
      setReferenceData(cached);
      return;
    }
    const controller = new AbortController();
    fetch(`/data/ookla/${networkType}-${referencePeriod}.json`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Data pembanding gagal dimuat");
        return res.json() as Promise<OoklaData>;
      })
      .then((res) => {
        refCache.current.set(key, res);
        setReferenceData(res);
      })
      .catch(() => {
        setReferenceData(null);
      });
    return () => controller.abort();
  }, [viewMode, referencePeriod, networkType]);

  const referenceIndex = useMemo(() => {
    if (!referenceMapData?.cells) return null;
    return makeReferenceIndex(referenceMapData.cells);
  }, [referenceMapData]);

  useEffect(() => {
    referenceIndexRef.current = referenceIndex;
    drawRef.current?.();
  }, [referenceIndex]);

  useEffect(() => {
    dataRef.current = mapData;
    overlayOnRef.current = overlayOn;
    view3dRef.current = view3d;
    metricRef.current = metric;
    latencyDirectionRef.current = latencyDirection;
  }, [mapData, overlayOn, metric, view3d, latencyDirection]);

  useEffect(() => {
    basemapRef.current = basemap;
  }, [basemap]);

  // Cache level klaster dikosongkan saat data berganti, lalu dibangun bertahap saat browser idle
  // supaya tidak ada lonjakan kerja di main thread ketika pengguna zoom.
  useEffect(() => {
    levelsRef.current = new Map();
    if (!mapData) return;
    const order: number[] = [];
    for (let level = MIN_CLUSTER_LEVEL; level <= MAX_CLUSTER_LEVEL; level++) order.push(level);
    order.push(RAW_LEVEL);
    let index = 0;
    let timer = 0;
    const step = () => {
      if (index >= order.length) return;
      getLevel(levelsRef.current, mapData.cells, order[index++]);
      timer = window.setTimeout(step, 40);
    };
    timer = window.setTimeout(step, 300);
    return () => window.clearTimeout(timer);
  }, [mapData]);

  // Pindah wilayah cukup dengan flyTo — peta dan data tidak perlu dibuat/diunduh ulang.
  useEffect(() => {
    initialFocusRef.current = focusLocation;
    if (lastFocusKeyRef.current === focusLocation.key) return;
    lastFocusKeyRef.current = focusLocation.key;
    setSelectedCell(null);
    mapRef.current?.flyTo({
      center: [focusLocation.center.lng, focusLocation.center.lat],
      zoom: focusLocation.zoom,
      duration: 1100,
      essential: true,
    });
  }, [focusLocation]);

  useEffect(() => {
    const controller = new AbortController();
    const dataRequest = fetch(`/data/ookla/${networkType}-${period}.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(tRef.current("Permintaan data gagal ({status}).").replace("{status}", String(response.status)));
        return response.json() as Promise<OoklaData>;
      });
    const boundaryRequest = indonesiaBoundaryRef.current
      ? Promise.resolve(indonesiaBoundaryRef.current)
      : fetch("/boundaries/indonesia-adm0.geojson", { signal: controller.signal }).then(async (response) => {
        if (!response.ok) {
          throw new Error(tRef.current("Batas Indonesia gagal dimuat ({status}).").replace("{status}", String(response.status)));
        }
        const collection = await response.json() as GeoJSON.FeatureCollection;
        const index = buildIndonesiaBoundaryIndex(collection);
        indonesiaBoundaryRef.current = index;
        return index;
      });

    Promise.all([dataRequest, boundaryRequest])
      .then(([result, boundaryIndex]) => {
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
          { tests: 0, devices: 0, download: 0, upload: 0, latency: 0, latencyDown: 0, latencyUp: 0 },
        );
        const weightedAverage = (value: number, precision = 0) => {
          if (!totals.tests) return 0;
          const factor = 10 ** precision;
          return Math.round((value / totals.tests) * factor) / factor;
        };
        const indonesiaData = {
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
        setSelectedCell(null);
        setLoadedDataset({ key: datasetKey, data: indonesiaData, error: "" });
        onDataLoaded(indonesiaData);
        onMapDataLoaded(indonesiaData);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        onDataLoaded(null);
        onMapDataLoaded(null);
        setLoadedDataset({
          key: datasetKey,
          data: null,
          error: error instanceof Error ? tRef.current(error.message) : tRef.current("Data peta gagal dimuat."),
        });
      });
    return () => controller.abort();
  }, [datasetKey, networkType, period, onDataLoaded, onMapDataLoaded]);

  useEffect(() => {
    const dataFinished = data !== null || dataError !== "";
    const mapFinished = mapReady || mapError !== "" || !cartoKey;
    if (dataFinished && mapFinished) onInitialLoadComplete?.();
  }, [cartoKey, data, dataError, mapError, mapReady, onInitialLoadComplete]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    if (!cartoKey) {
      return;
    }

    let map: MapLibreMap | null = null;
    let cancelled = false;
    let hoverFrame = 0;
    let pending: { x: number; y: number; lat: number; lng: number } | null = null;

    function syncHud() {
      const current = mapRef.current;
      if (!current) return;
      if (zoomRef.current) zoomRef.current.textContent = `Zoom ${current.getZoom().toFixed(1)}`;
      if (compassRef.current) compassRef.current.style.transform = `rotate(${-current.getBearing()}deg)`;
    }

    function updateHover(point: { x: number; y: number }) {
      const current = mapRef.current;
      const tip = tipRef.current;
      const cells = dataRef.current?.cells;
      let found: Cell | null = null;
      if (current && cells && overlayOnRef.current && view3dRef.current) {
        const hit = current.getLayer(LAYER_3D)
          ? current.queryRenderedFeatures([point.x, point.y], { layers: [LAYER_3D] })[0]
          : undefined;
        found = hit ? cellFromProps(hit.properties as Record<string, number>) : null;
      } else if (current && cells && overlayOnRef.current) {
        found = findNearestCell(current, getLevel(levelsRef.current, cells, levelIndexFor(current.getZoom())), point, 11);
      }
      const sameCell = !!found && !!hoverRef.current && found[0] === hoverRef.current[0] && found[1] === hoverRef.current[1];
      if (found !== hoverRef.current && !sameCell) {
        hoverRef.current = found;
        current?.getCanvas().style.setProperty("cursor", found ? "pointer" : "");
        drawRef.current?.();
      }
      if (!tip) return;
      if (!found) {
        tip.style.display = "none";
        return;
      }
      const value = metricValue(found, metricRef.current, latencyDirectionRef.current);
      if (viewModeRef.current === "delta" && referenceIndexRef.current) {
        const delta = getCellDelta(found, referenceIndexRef.current, metricRef.current, latencyDirectionRef.current);
        if (delta.pct === 9999) {
          tip.textContent = `${formatCellMetric(value, metricRef.current, localeRef.current)} · ${tRef.current("Area Baru (YoY)")}`;
          tip.style.setProperty("--tip-color", "#2563eb");
        } else if (delta.pct !== null) {
          const sign = delta.pct > 0 ? "+" : "";
          tip.textContent = `${formatCellMetric(value, metricRef.current, localeRef.current)} · ${sign}${delta.pct.toFixed(1)}% YoY`;
          tip.style.setProperty("--tip-color", colorForDelta(delta.pct));
        } else {
          tip.textContent = `${formatCellMetric(value, metricRef.current, localeRef.current)} · ${formatNumber(found[5], localeRef.current)} ${tRef.current("tes")}`;
          tip.style.setProperty("--tip-color", colorForMetric(value, metricRef.current));
        }
      } else {
        tip.textContent = `${formatCellMetric(value, metricRef.current, localeRef.current)} · ${formatNumber(found[5], localeRef.current)} ${tRef.current("tes")}`;
        tip.style.setProperty("--tip-color", colorForMetric(value, metricRef.current));
      }
      tip.style.display = "block";
      tip.style.transform = `translate(${point.x + 14}px, ${point.y - 36}px)`;
    }

    import("maplibre-gl")
      .then((maplibregl) => {
        if (cancelled) return;
        maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
        const styleUrl = `https://basemaps.cartocdn.com/gl/${basemapNames[basemapRef.current]}-gl-style/style.json?key=${encodeURIComponent(cartoKey)}`;
        map = new maplibregl.Map({
          container,
          style: styleUrl,
          center: [initialFocusRef.current.center.lng, initialFocusRef.current.center.lat],
          zoom: initialFocusRef.current.zoom,
          minZoom: 3,
          maxZoom: 15,
          attributionControl: false,
          cooperativeGestures: false,
          scrollZoom: true,
        });
        mapRef.current = map;

        map.addControl(new maplibregl.ScaleControl({ maxWidth: 96, unit: "metric" }), "bottom-right");
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
        map.on("style.load", () => {
          mapReadyRef.current = true;
          setMapReady(true);
          setMapError("");
          syncHud();
        });
        map.on("move", syncHud);
        map.on("error", (event) => {
          if (!mapReadyRef.current && event.error.message) setMapError(event.error.message);
        });
        map.on("mousemove", (event) => {
          pending = { x: event.point.x, y: event.point.y, lat: event.lngLat.lat, lng: event.lngLat.lng };
          if (hoverFrame) return;
          hoverFrame = window.requestAnimationFrame(() => {
            hoverFrame = 0;
            if (!pending) return;
            if (coordRef.current) coordRef.current.textContent = `${pending.lat.toFixed(4)}°, ${pending.lng.toFixed(4)}°`;
            updateHover(pending);
          });
        });
        map.on("mouseout", () => {
          if (hoverRef.current) {
            hoverRef.current = null;
            drawRef.current?.();
          }
          if (tipRef.current) tipRef.current.style.display = "none";
        });
        map.on("click", (event) => {
          const currentData = dataRef.current;
          if (!currentData || !overlayOnRef.current || !map) {
            setSelectedCell(null);
            return;
          }
          if (view3dRef.current) {
            const hit = map.getLayer(LAYER_3D)
              ? map.queryRenderedFeatures([event.point.x, event.point.y], { layers: [LAYER_3D] })[0]
              : undefined;
            setSelectedCell(hit ? cellFromProps(hit.properties as Record<string, number>) : null);
            return;
          }
          setSelectedCell(findNearestCell(map, getLevel(levelsRef.current, currentData.cells, levelIndexFor(map.getZoom())), event.point, 13));
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setMapError(error instanceof Error ? error.message : tRef.current("Library peta gagal dimuat."));
      });

    return () => {
      cancelled = true;
      if (hoverFrame) window.cancelAnimationFrame(hoverFrame);
      mapReadyRef.current = false;
      hoverRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      map = null;
    };
  }, [cartoKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cartoKey) return;
    const styleUrl = `https://basemaps.cartocdn.com/gl/${basemapNames[basemap]}-gl-style/style.json?key=${encodeURIComponent(cartoKey)}`;
    mapReadyRef.current = false;
    setMapReady(false);
    map.setStyle(styleUrl);
  }, [basemap, cartoKey]);

  useEffect(() => {
    boundaryLevelRef.current = boundaryLevel;
  }, [boundaryLevel]);

  useEffect(() => {
    const map = mapRef.current;
    let cancelled = false;

    if (map && mapReady) {
      if (map.getLayer(BOUNDARY_LINE_LAYER)) map.removeLayer(BOUNDARY_LINE_LAYER);
      if (map.getLayer(BOUNDARY_FILL_LAYER)) map.removeLayer(BOUNDARY_FILL_LAYER);
      if (map.getSource(BOUNDARY_SOURCE)) map.removeSource(BOUNDARY_SOURCE);
    }
    if (boundaryLevel === "none") return;

    const level: AdministrativeBoundaryLevel = boundaryLevel;
    loadBoundaryCollection(level)
      .then((collection) => {
        if (
          cancelled ||
          !map ||
          !mapReady ||
          mapRef.current !== map ||
          !mapReadyRef.current ||
          boundaryLevelRef.current !== level
        ) return;
        if (!map.getSource(BOUNDARY_SOURCE)) {
          map.addSource(BOUNDARY_SOURCE, { type: "geojson", data: collection });
          map.addLayer({
            id: BOUNDARY_FILL_LAYER,
            type: "fill",
            source: BOUNDARY_SOURCE,
            paint: {
              "fill-color": "#4c9a7e",
              "fill-opacity": 0.035,
            },
          });
          map.addLayer({
            id: BOUNDARY_LINE_LAYER,
            type: "line",
            source: BOUNDARY_SOURCE,
            paint: {
              "line-color": "#174f40",
              "line-opacity": 0.95,
              "line-width": level === "adm2"
                ? ["interpolate", ["linear"], ["zoom"], 3, 0.9, 6, 1.2, 9, 1.7, 12, 2]
                : level === "adm1" ? 1.3 : 2,
            },
          });
        }
        setBoundaryFailure(null);
      })
      .catch((error: unknown) => {
        if (cancelled || boundaryLevelRef.current !== level) return;
        setBoundaryFailure({
          level,
          message: error instanceof Error ? error.message : tRef.current("Batas administratif gagal dimuat."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [boundaryLevel, loadBoundaryCollection, mapReady]);

  const boundaryError = boundaryLevel !== "none" && boundaryFailure?.level === boundaryLevel
    ? boundaryFailure.message
    : "";

  useEffect(() => {
    const map = mapRef.current;
    const canvas = canvasRef.current;
    if (!map || !canvas) return;

    function placePopup(width: number, height: number) {
      const popup = popupRef.current;
      const currentMap = mapRef.current;
      if (!popup || !currentMap) return;
      if (!activeCell) {
        popup.style.display = "none";
        return;
      }
      const point = currentMap.project([activeCell[0], activeCell[1]]);
      const inside = point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
      popup.style.display = inside ? "block" : "none";
      popup.style.transform = `translate(${point.x}px, ${point.y}px)`;
      popup.classList.toggle("is-below", point.y < 290);
      const half = 146;
      const shift = point.x - half < 8 ? 8 - (point.x - half) : point.x + half > width - 8 ? width - 8 - (point.x + half) : 0;
      popup.style.setProperty("--shift-x", `${shift}px`);
    }

    function drawCells() {
      const currentMap = mapRef.current;
      const currentCanvas = canvasRef.current;
      if (!currentMap || !currentCanvas) return;
      const { clientWidth: width, clientHeight: height } = currentMap.getContainer();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(width * scale);
      const pixelHeight = Math.round(height * scale);
      // Mengubah width/height mengalokasikan ulang buffer: lakukan hanya jika ukuran benar-benar berubah.
      if (currentCanvas.width !== pixelWidth || currentCanvas.height !== pixelHeight) {
        currentCanvas.width = pixelWidth;
        currentCanvas.height = pixelHeight;
      }
      const context = currentCanvas.getContext("2d");
      if (!context) {
        setMapError(tRef.current("Canvas peta tidak tersedia di browser ini."));
        return;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);
      placePopup(width, height);
      if (!mapData || !overlayOn || view3d) return;

      const zoom = currentMap.getZoom();
      const heatRadius = Math.max(4, Math.min(9, 11 - zoom * 0.35));
      const pointRadius = Math.max(2.2, Math.min(4.5, 2.1 + (zoom - 4) * 0.2));
      const level = getLevel(levelsRef.current, mapData.cells, levelIndexFor(zoom));
      const bounds = currentMap.getBounds();
      const drawHeat = !currentMap.isMoving();
      const pad = heatRadius + 6;
      const batches = new Map<string, { color: string; alpha: number; points: number[] }>();

      forEachInBounds(level, bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(), (cell) => {
        const point = currentMap.project([cell[0], cell[1]]);
        if (point.x < -pad || point.y < -pad || point.x > width + pad || point.y > height + pad) return;
        let color: string;
        if (viewModeRef.current === "delta" && referenceIndexRef.current) {
          const delta = getCellDelta(cell, referenceIndexRef.current, metric, latencyDirection);
          color = delta.pct !== null ? colorForDelta(delta.pct) : colorForMetric(metricValue(cell, metric, latencyDirection), metric);
        } else {
          color = colorForMetric(metricValue(cell, metric, latencyDirection), metric);
        }
        const strength = Math.log10(cell[5] + 1);
        if (drawHeat) {
          context.globalAlpha = Math.max(0.07, Math.min(0.2, 0.065 + strength * 0.035));
          context.drawImage(heatSprite(color), point.x - heatRadius, point.y - heatRadius, heatRadius * 2, heatRadius * 2);
        }
        const base = 0.62 + strength * 0.12;
        const alpha = base < 0.78 ? 0.72 : base < 0.88 ? 0.82 : 0.92;
        const radius = pointRadius + Math.min(2.5, Math.log10(cell[7] ?? 1) * 1.3);
        const key = `${color}${alpha}`;
        let batch = batches.get(key);
        if (!batch) {
          batch = { color, alpha, points: [] };
          batches.set(key, batch);
        }
        batch.points.push(point.x, point.y, radius);
      });

      // Titik digambar per kelompok warna/opasitas: satu path + satu fill, bukan satu per sel.
      for (const batch of batches.values()) {
        context.beginPath();
        for (let i = 0; i < batch.points.length; i += 3) {
          const x = batch.points[i];
          const y = batch.points[i + 1];
          const r = batch.points[i + 2];
          context.moveTo(x + r, y);
          context.arc(x, y, r, 0, Math.PI * 2);
        }
        context.globalAlpha = batch.alpha;
        context.fillStyle = batch.color;
        context.fill();
        context.globalAlpha = 0.68;
        context.strokeStyle = "#fff";
        context.lineWidth = 0.8;
        context.stroke();
      }

      const hovered = hoverRef.current;
      if (hovered && hovered !== activeCell) {
        const point = currentMap.project([hovered[0], hovered[1]]);
        context.globalAlpha = 1;
        context.beginPath();
        context.arc(point.x, point.y, pointRadius + 3, 0, Math.PI * 2);
        context.strokeStyle = "#fff";
        context.lineWidth = 2;
        context.stroke();
        context.beginPath();
        context.arc(point.x, point.y, pointRadius + 4.5, 0, Math.PI * 2);
        context.strokeStyle = "rgb(38 60 53 / 55%)";
        context.lineWidth = 1;
        context.stroke();
      }
      if (activeCell) {
        const point = currentMap.project([activeCell[0], activeCell[1]]);
        const radius = pointRadius + 2;
        context.globalAlpha = 1;
        context.beginPath();
        context.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
        context.strokeStyle = "#fff";
        context.lineWidth = 2;
        context.stroke();
        context.beginPath();
        context.arc(point.x, point.y, radius + 6, 0, Math.PI * 2);
        context.strokeStyle = "#263c35";
        context.lineWidth = 1;
        context.stroke();
      }
      context.globalAlpha = 1;
    }

    // Gabungkan banyak event move/resize menjadi satu gambar per frame.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        drawCells();
      });
    };

    drawRef.current = schedule;
    map.on("move", schedule);
    map.on("moveend", schedule);
    map.on("resize", schedule);
    drawCells();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      drawRef.current = null;
      map.off("move", schedule);
      map.off("moveend", schedule);
      map.off("resize", schedule);
    };
  }, [mapData, metric, latencyDirection, overlayOn, activeCell, basemap, mapReady, view3d, viewMode, referenceIndex]);

  // Kamera: miringkan peta saat 3D aktif, kembalikan saat nonaktif.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (view3d) map.easeTo({ pitch: PITCH_3D, bearing: BEARING_3D, duration: 800 });
    else map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  }, [view3d, mapReady]);

  // Batang 3D hanya dibangun untuk sel di area layar; dibangun ulang tiap gerakan selesai.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const active = view3d && overlayOn && !!mapData;

    function removeLayer() {
      if (!map) return;
      if (map.getLayer(LAYER_3D)) map.removeLayer(LAYER_3D);
      if (map.getSource(SOURCE_3D)) map.removeSource(SOURCE_3D);
    }

    if (!active || !mapData) {
      removeLayer();
      return;
    }

    function refresh() {
      if (!map || !mapData) return;
      const collection = buildBars(map, mapData.cells, levelsRef.current, metric, latencyDirection, viewMode, referenceIndex);
      const source = map.getSource(SOURCE_3D) as { setData?: (d: unknown) => void } | undefined;
      if (source?.setData) {
        source.setData(collection);
        return;
      }
      map.addSource(SOURCE_3D, { type: "geojson", data: collection });
      map.addLayer({
        id: LAYER_3D,
        type: "fill-extrusion",
        source: SOURCE_3D,
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.9,
          "fill-extrusion-vertical-gradient": true,
        },
      });
    }

    refresh();
    map.on("moveend", refresh);
    return () => {
      map.off("moveend", refresh);
    };
  }, [mapData, metric, latencyDirection, overlayOn, view3d, mapReady, viewMode, referenceIndex]);

  // Tandai batang terpilih (putih) tanpa membangun ulang data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !view3d || !map.getLayer(LAYER_3D)) return;
    map.setPaintProperty(
      LAYER_3D,
      "fill-extrusion-color",
      activeCell
        ? ["case", ["all", ["==", ["get", "lng"], activeCell[0]], ["==", ["get", "lat"], activeCell[1]]], "#263c35", ["get", "color"]]
        : ["get", "color"],
    );
  }, [activeCell, view3d, mapReady, mapData, metric]);

  // Mobile: popup detail menjadi kartu di bawah layar. Geser peta agar sel terpilih
  // tidak tertutup kartu atau bar atas (pita terlihat ≈ 175px dari atas sampai 340px dari bawah).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !activeCell || window.innerWidth > 700) return;
    const point = map.project([activeCell[0], activeCell[1]]);
    const height = map.getContainer().clientHeight;
    if (point.y >= 175 && point.y <= height - 340) return;
    map.easeTo({ center: [activeCell[0], activeCell[1]], offset: [0, -82], duration: 350 });
  }, [activeCell, mapReady]);

  function zoomMap(amount: number) {
    mapRef.current?.zoomTo(Math.min(15, Math.max(3, mapRef.current.getZoom() + amount)), { duration: 180 });
  }

  function resetNorth() {
    if (view3d) mapRef.current?.resetNorth({ duration: 400 });
    else mapRef.current?.resetNorthPitch({ duration: 400 });
  }

  function locateUser() {
    if (!navigator.geolocation) {
      showLocationError(t("Lokasi perangkat tidak didukung oleh browser ini."));
      return;
    }
    clearLocationError();
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        mapRef.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 10, duration: 900 });
        setSelectedCell(null);
      },
      (error) => {
        showLocationError(error.code === error.PERMISSION_DENIED ? t("Izin lokasi belum diberikan.") : t("Lokasi perangkat tidak dapat ditemukan."));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  const selectedMetric = activeCell ? metricValue(activeCell, metric, latencyDirection) : null;
  const numberLocale = locale === "en" ? "en-US" : "id-ID";
  const metricDetails = metricDetailsFor(data, viewMode, t, numberLocale, latencyDirection);
  const details = metricDetails[metric];
  const periodLabel = data?.periodLabel ?? formatOoklaPeriod(period);
  const networkLabel = data?.networkLabel ?? formatOoklaNetworkType(networkType);

  return (
    <div aria-label={t("Peta interaktif performa jaringan Indonesia")} className={`map-canvas map-stage basemap-${basemap} ${view3d ? "is-3d" : ""}`} role="application">
      <div className="maplibre-container" ref={mapContainerRef} />
      <canvas aria-hidden="true" className="map-data-canvas" ref={canvasRef} />

      <div className="map-hover-tip" ref={tipRef} aria-hidden="true" />

      <div aria-live="polite" className="map-cell-popup" ref={popupRef}>
        {activeCell && (
          <div className="map-cell-popup-card" role="dialog" aria-label={t("Detail sel pengukuran")}>
            <div className="map-cell-popup-head">
              <div>
                <strong>{(activeCell[7] ?? 1) > 1 ? t("Area gabungan · {count} sel", { count: formatNumber(activeCell[7], numberLocale) }) : t("Sel pengukuran")}</strong>
                <small>{activeCell[1].toFixed(3)}°, {activeCell[0].toFixed(3)}°</small>
              </div>
              <button aria-label={t("Tutup detail sel")} onClick={() => setSelectedCell(null)}><Icon name="close" size={14} /></button>
            </div>
            {activeCell[5] < 10 && <span className="map-confidence-badge">{t("Sampel rendah · interpretasikan dengan hati-hati")}</span>}
            <div className="map-cell-metrics">
              {(["download", "upload", "latency"] as const).map((key) => {
                const value = metricValue(activeCell, key, latencyDirection);
                const quality = qualityFor(value, key, t);
                const delta = viewMode === "delta" ? getCellDelta(activeCell, referenceIndex, key, latencyDirection) : null;
                const rowColor = delta && delta.pct !== null ? colorForDelta(delta.pct) : quality.color;
                return (
                  <div className={`map-cell-row ${key === metric ? "is-current" : ""}`} key={key}>
                    <i style={{ background: rowColor }} />
                    <span>
                      {metricDetails[key].label}
                      {delta && delta.pct !== null ? (
                        <em style={{ color: rowColor }}>
                          {delta.pct === 9999 ? t("Cakupan Baru (YoY)") : `${delta.pct > 0 ? "+" : ""}${delta.pct.toFixed(1)}% YoY`}
                        </em>
                      ) : (
                        <em style={{ color: quality.color }}>{quality.label}</em>
                      )}
                    </span>
                    <div style={{ textAlign: "right" }}>
                      <strong>{formatCellMetric(value, key)}</strong>
                      {delta && delta.prevValue !== null && delta.pct !== 9999 && (
                        <div style={{ fontSize: "10.5px", color: "#84928b" }}>
                          {t("Thn lalu: {value}", { value: formatCellMetric(delta.prevValue, key, numberLocale) })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="map-cell-foot">
              <span><b>{formatNumber(activeCell[5], numberLocale)}</b> {t("tes")}</span>
              <span><b>{formatNumber(activeCell[6], numberLocale)}</b> {t("perangkat")}</span>
              <span>Ookla · {periodLabel}</span>
            </div>
          </div>
        )}
      </div>

      <div className="map-control-stack">
        <div className="map-control-group">
          <button aria-label={t("Perbesar peta")} disabled={!mapReady} onClick={() => zoomMap(1)} title={t("Perbesar")}><Icon name="plus" size={18} /></button>
          <button aria-label={t("Perkecil peta")} disabled={!mapReady} onClick={() => zoomMap(-1)} title={t("Perkecil")}><Icon name="zoom-out" size={18} /></button>
        </div>
        <div className="map-control-group">
          <button aria-label={t("Arahkan peta ke utara")} disabled={!mapReady} onClick={resetNorth} title={t("Reset arah utara")}>
            <span className="map-compass-icon" ref={compassRef}><Icon name="compass" size={18} /></span>
          </button>
          <button aria-label={t("Gunakan lokasi saya")} disabled={!mapReady} onClick={locateUser} title={t("Lokasi saya")}><Icon name="locate" size={17} /></button>
          {onToggleFullscreen && (
            <button
              aria-label={t(fullscreen ? "Keluar dari layar penuh" : "Layar penuh")}
              aria-pressed={fullscreen}
              onClick={onToggleFullscreen}
              title={t(fullscreen ? "Keluar dari layar penuh" : "Layar penuh")}
            >
              <Icon name="expand" size={17} />
            </button>
          )}
        </div>
      </div>

      <div className="map-floating-card map-performance-card">
        <div className="map-performance-top">
          <span className="map-performance-dot" />
          <span>{details.label.toLocaleUpperCase(locale === "en" ? "en-US" : "id-ID")}</span>
          <i />
          <span>OOKLA · {networkLabel.toLocaleUpperCase("id-ID")} · {periodLabel}</span>
        </div>
        <strong className="map-performance-value">
          {selectedMetric === null ? details.average : formatCellMetric(selectedMetric, metric)}
        </strong>
        <div className="map-performance-bottom">
          <span>{activeCell ? `${formatNumber(activeCell[5], numberLocale)} ${t("tes di {area} ini", { area: t((activeCell[7] ?? 1) > 1 ? "area" : "sel") })}` : t("Rata-rata area tertimbang tes")}</span>
          <span>{activeCell ? `${formatNumber(activeCell[6], numberLocale)} ${t("perangkat")}` : data ? `${formatNumber(data.tests, numberLocale)} ${t("tes")}` : "—"}</span>
        </div>
        {activeCell && <div className="map-performance-coordinate">{activeCell[1].toFixed(3)}°, {activeCell[0].toFixed(3)}°</div>}
      </div>

      {!data && !dataError && (
        <div className="map-loading-chip" role="status"><span className="map-loading-spinner" />{t("Memuat data pengukuran…")}</div>
      )}
      {!cartoKey && (
        <div className="map-location-error" role="status">
          <Icon name="locate" size={15} />
          <span>{t("Basemap belum dikonfigurasi. Isi NEXT_PUBLIC_CARTO_KEY di .env.local lalu jalankan ulang aplikasi.")}</span>
        </div>
      )}
      {(locationError || mapError) && (
        <div className="map-location-error" role="status">
          <Icon name="locate" size={15} />
          <span>{locationError || mapError}</span>
          <button
            aria-label={t("Tutup notifikasi")}
            className="map-error-close-btn"
            onClick={() => {
              clearLocationError();
              if (mapError) setMapError("");
            }}
            type="button"
          >
            ×
          </button>
        </div>
      )}
      {dataError && <div className="map-data-error" role="alert">{dataError}</div>}
      {boundaryError && <div className="map-data-error" role="alert">{boundaryError}</div>}

      <div className="map-legend map-floating-card">
        <div className="map-legend-heading">
          <strong>{details.label}</strong>
          <span>{details.unit}</span>
        </div>
        <div className="map-legend-colors" style={{ display: "flex", gap: "2px", height: "8px" }}>
          {details.bands.map((band) => (
            <i key={band.label} style={{ flex: 1, background: band.color, borderRadius: "2px" }} />
          ))}
        </div>
        <div className="map-legend-bands" style={{ display: "flex", justifyContent: "space-between", gap: "2px", fontSize: "9px" }}>
          {details.bands.map((band) => <span key={band.label}>{band.label}</span>)}
        </div>
        <div className="map-legend-ends">
          <span>{details.ends[0]}</span>
          <span>{details.ends[1]}</span>
        </div>
        <p className="map-legend-note">
          {viewMode === "delta"
            ? t("Peta Pertumbuhan YoY · Biru = area baru · Klik titik untuk perbandingan")
            : view3d
            ? t("Tinggi batang = jumlah tes · warna = metrik · klik kanan + geser untuk memutar")
            : t("Titik = sel ukur · klik untuk detail")}
        </p>
      </div>

      <div className="map-hud" aria-hidden="true">
        <span ref={coordRef}>—</span>
        <i />
        <span ref={zoomRef}>{t("Zoom")} —</span>
      </div>
    </div>
  );
}