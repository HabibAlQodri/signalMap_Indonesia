"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { formatNumber } from "../lib/network-data";
import ooklaSummary from "../lib/ookla-summary.json";
import Icon from "./icon";

export type MapMetric = "download" | "upload" | "latency";
export type Basemap = "light" | "voyager" | "dark";

type FocusLocation = {
  name: string;
  center: { lat: number; lng: number };
  zoom: number;
  key: number;
};

type OoklaData = {
  year: number;
  quarter: number;
  records: number;
  tests: number;
  cells: number[][];
};

type MapViewProps = {
  focusLocation: FocusLocation;
  metric: MapMetric;
  basemap: Basemap;
  overlayOn: boolean;
};

const metricDetails: Record<
  MapMetric,
  { label: string; unit: string; bands: [string, string, string, string]; average: string }
> = {
  download: {
    label: "Kecepatan unduh",
    unit: "Mbps",
    bands: ["<20", "20–50", "50–100", ">100"],
    average: `${(ooklaSummary.avgDownloadKbps / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} Mbps`,
  },
  upload: {
    label: "Kecepatan unggah",
    unit: "Mbps",
    bands: ["<20", "20–50", "50–100", ">100"],
    average: `${(ooklaSummary.avgUploadKbps / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} Mbps`,
  },
  latency: {
    label: "Latensi",
    unit: "ms",
    bands: [">100", "60–100", "30–60", "≤30"],
    average: `${ooklaSummary.avgLatencyMs.toLocaleString("id-ID")} ms`,
  },
};

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

function metricValue(cell: number[], metric: MapMetric) {
  return metric === "download" ? cell[2] : metric === "upload" ? cell[3] : cell[4];
}

function formatCellMetric(value: number, metric: MapMetric) {
  if (metric === "latency") return `${value.toLocaleString("id-ID")} ms`;
  return `${(value / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} Mbps`;
}

export default function MapView({
  focusLocation,
  metric,
  basemap,
  overlayOn,
}: MapViewProps) {
  const [data, setData] = useState<OoklaData | null>(null);
  const [dataError, setDataError] = useState("");
  const [mapError, setMapError] = useState("");
  const [locationError, setLocationError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [selectedCell, setSelectedCell] = useState<number[] | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapReadyRef = useRef(false);
  const dataRef = useRef<OoklaData | null>(null);
  const overlayOnRef = useRef(overlayOn);
  const basemapRef = useRef(basemap);
  const cartoKey = process.env.NEXT_PUBLIC_CARTO_KEY;

  useEffect(() => {
    dataRef.current = data;
    overlayOnRef.current = overlayOn;
  }, [data, overlayOn]);

  useEffect(() => {
    basemapRef.current = basemap;
  }, [basemap]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/ookla-mobile-tiles.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Permintaan data gagal (${response.status}).`);
        return response.json() as Promise<OoklaData>;
      })
      .then(setData)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataError(error instanceof Error ? error.message : "Data peta gagal dimuat.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    if (!cartoKey) {
      return;
    }

    let map: MapLibreMap | null = null;
    let cancelled = false;

    import("maplibre-gl")
      .then((maplibregl) => {
        if (cancelled) return;
        maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
        const styleUrl = `https://basemaps.cartocdn.com/gl/${basemapNames[basemapRef.current]}-gl-style/style.json?key=${encodeURIComponent(cartoKey)}`;
        map = new maplibregl.Map({
          container,
          style: styleUrl,
          center: [focusLocation.center.lng, focusLocation.center.lat],
          zoom: focusLocation.zoom,
          minZoom: 3,
          maxZoom: 15,
          attributionControl: false,
          cooperativeGestures: false,
          scrollZoom: true,
        });
        mapRef.current = map;

        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
        map.on("style.load", () => {
          mapReadyRef.current = true;
          setMapReady(true);
          setMapError("");
        });
        map.on("error", (event) => {
          if (!mapReadyRef.current && event.error.message) setMapError(event.error.message);
        });
        map.on("click", (event) => {
          const currentData = dataRef.current;
          if (!currentData || !overlayOnRef.current) {
            setSelectedCell(null);
            return;
          }
          let nearest: number[] | null = null;
          let nearestDistance = 13;
          for (const cell of currentData.cells) {
            const point = map?.project([cell[0], cell[1]]);
            if (!point) continue;
            const distance = Math.hypot(event.point.x - point.x, event.point.y - point.y);
            if (distance < nearestDistance) {
              nearest = cell;
              nearestDistance = distance;
            }
          }
          setSelectedCell(nearest);
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setMapError(error instanceof Error ? error.message : "Library peta gagal dimuat.");
      });

    return () => {
      cancelled = true;
      mapReadyRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
      map = null;
    };
  }, [cartoKey, focusLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cartoKey) return;
    const styleUrl = `https://basemaps.cartocdn.com/gl/${basemapNames[basemap]}-gl-style/style.json?key=${encodeURIComponent(cartoKey)}`;
    mapReadyRef.current = false;
    setMapReady(false);
    map.setStyle(styleUrl);
  }, [basemap, cartoKey]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = canvasRef.current;
    if (!map || !canvas) return;

    function drawCells() {
      const currentMap = mapRef.current;
      const currentCanvas = canvasRef.current;
      if (!currentMap || !currentCanvas) return;
      const { clientWidth: width, clientHeight: height } = currentMap.getContainer();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      currentCanvas.width = Math.round(width * scale);
      currentCanvas.height = Math.round(height * scale);
      const context = currentCanvas.getContext("2d");
      if (!context) {
        setMapError("Canvas peta tidak tersedia di browser ini.");
        return;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!data || !overlayOn) return;

      const zoom = currentMap.getZoom();
      const heatRadius = Math.max(4, Math.min(9, 11 - zoom * 0.35));
      const pointRadius = Math.max(2.2, Math.min(4.5, 2.1 + (zoom - 4) * 0.2));
      const bounds = currentMap.getBounds();
      const drawHeat = !currentMap.isMoving();
      for (const cell of data.cells) {
        if (!bounds.contains([cell[0], cell[1]])) continue;
        const point = currentMap.project([cell[0], cell[1]]);
        if (
          point.x < -heatRadius ||
          point.y < -heatRadius ||
          point.x > width + heatRadius ||
          point.y > height + heatRadius
        ) continue;

        const color = colorForMetric(metricValue(cell, metric), metric);
        if (drawHeat) {
          const confidence = Math.max(0.07, Math.min(0.2, 0.065 + Math.log10(cell[5] + 1) * 0.035));
          const heat = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, heatRadius);
          heat.addColorStop(0, color);
          heat.addColorStop(0.28, color);
          heat.addColorStop(1, "transparent");
          context.globalAlpha = confidence;
          context.fillStyle = heat;
          context.beginPath();
          context.arc(point.x, point.y, heatRadius, 0, Math.PI * 2);
          context.fill();
        }

        context.globalAlpha = Math.max(0.68, Math.min(0.95, 0.62 + Math.log10(cell[5] + 1) * 0.12));
        context.fillStyle = color;
        context.beginPath();
        context.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 0.68;
        context.strokeStyle = "#fff";
        context.lineWidth = 0.8;
        context.stroke();
      }
      if (selectedCell) {
        const point = currentMap.project([selectedCell[0], selectedCell[1]]);
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

    map.on("move", drawCells);
    map.on("moveend", drawCells);
    map.on("resize", drawCells);
    drawCells();
    return () => {
      map.off("move", drawCells);
      map.off("moveend", drawCells);
      map.off("resize", drawCells);
    };
  }, [data, metric, overlayOn, selectedCell, basemap, focusLocation, mapReady]);

  function zoomMap(amount: number) {
    mapRef.current?.zoomTo(Math.min(15, Math.max(3, mapRef.current.getZoom() + amount)), { duration: 180 });
  }

  function locateUser() {
    if (!navigator.geolocation) {
      setLocationError("Lokasi perangkat tidak didukung oleh browser ini.");
      return;
    }
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        mapRef.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 10, duration: 900 });
        setSelectedCell(null);
      },
      (error) => {
        setLocationError(error.code === error.PERMISSION_DENIED ? "Izin lokasi belum diberikan." : "Lokasi perangkat tidak dapat ditemukan.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  const selectedMetric = selectedCell ? metricValue(selectedCell, metric) : null;

  return (
    <div aria-label="Peta interaktif performa jaringan Indonesia" className={`map-canvas map-stage basemap-${basemap}`} role="application">
      <div className="maplibre-container" ref={mapContainerRef} />
      <canvas aria-hidden="true" className="map-data-canvas" ref={canvasRef} />

      <div className="map-zoom-controls">
        <button aria-label="Perbesar peta" disabled={!mapReady} onClick={() => zoomMap(1)}><Icon name="plus" size={17} /></button>
        <button aria-label="Perkecil peta" disabled={!mapReady} onClick={() => zoomMap(-1)}><Icon name="zoom-out" size={17} /></button>
        <button aria-label="Gunakan lokasi saya" disabled={!mapReady} onClick={locateUser}><Icon name="locate" size={16} /></button>
      </div>

      <div className="map-floating-card map-performance-card">
        <div className="map-performance-top">
          <span className="map-performance-dot" />
          <span>{metricDetails[metric].label.toLocaleUpperCase("id-ID")}</span>
          <i />
          <span>OOKLA · Q1 2026</span>
        </div>
        <strong className="map-performance-value">
          {selectedMetric === null ? metricDetails[metric].average : formatCellMetric(selectedMetric, metric)}
        </strong>
        <div className="map-performance-bottom">
          <span>{selectedCell ? `${formatNumber(selectedCell[5])} tes di sel ini` : "Rata-rata nasional tertimbang tes"}</span>
          <span>{selectedCell ? `${formatNumber(selectedCell[6])} perangkat` : `${formatNumber(ooklaSummary.tests)} tes`}</span>
        </div>
        {selectedCell && <div className="map-performance-coordinate">{selectedCell[1].toFixed(3)}°, {selectedCell[0].toFixed(3)}°</div>}
      </div>

      {!cartoKey && <div className="map-location-error" role="status">Basemap belum dikonfigurasi. Isi NEXT_PUBLIC_CARTO_KEY di .env.local lalu jalankan ulang aplikasi.</div>}
      {(locationError || mapError) && <div className="map-location-error" role="status">{locationError || mapError}</div>}
      {dataError && <div className="map-data-error" role="alert">{dataError}</div>}
      <div className="map-legend map-floating-card">
        <div className="map-legend-heading">
          <strong>{metricDetails[metric].label}</strong>
          <span>{metricDetails[metric].unit}</span>
        </div>
        <div className="map-legend-colors">
          {metricDetails[metric].bands.map((band) => <i key={band} />)}
        </div>
        <div className="map-legend-bands">
          {metricDetails[metric].bands.map((band) => <span key={band}>{band}</span>)}
        </div>
      </div>
    </div>
  );
}
