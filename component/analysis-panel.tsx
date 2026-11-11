"use client";

import { useMemo, useState } from "react";
import analysisData from "../lib/ookla-analysis.json";
import { formatNumber } from "../lib/network-data";
import type { MapMetric } from "./mapview";
import Icon from "./icon";

type AnalysisEntry = (typeof analysisData.entries)[number];
type PeriodMode = "year" | "quarter";
type AnalysisValue = {
  avgDownloadKbps: number;
  avgUploadKbps: number;
  avgLatencyMs: number;
  tests: number;
};

const metricLabels: Record<MapMetric, string> = {
  download: "Unduh",
  upload: "Unggah",
  latency: "Latensi",
};

function metricValue(entry: AnalysisValue, metric: MapMetric) {
  if (metric === "download") return entry.avgDownloadKbps;
  if (metric === "upload") return entry.avgUploadKbps;
  return entry.avgLatencyMs;
}

function weightedMetricValue(entries: AnalysisEntry[], metric: MapMetric) {
  const totalTests = entries.reduce((sum, entry) => sum + entry.tests, 0);
  if (!totalTests) return null;
  return entries.reduce((sum, entry) => sum + metricValue(entry, metric) * entry.tests, 0) / totalTests;
}

function formatValue(value: number, metric: MapMetric) {
  const formatted = metric === "latency"
    ? value.toLocaleString("id-ID", { maximumFractionDigits: 1 })
    : (value / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 });
  return `${formatted} ${metric === "latency" ? "ms" : "Mbps"}`;
}

function downloadCsv(rows: AnalysisRow[], metric: MapMetric) {
  const content = [
    ["Periode", "Unduh mobile (Mbps)", "Unduh fixed (Mbps)", "Unggah mobile (Mbps)", "Unggah fixed (Mbps)", "Latensi mobile (ms)", "Latensi fixed (ms)", "Tes mobile", "Tes fixed"],
    ...rows.map((row) => [
      row.label,
      row.mobile ? (row.mobile.avgDownloadKbps / 1000).toFixed(2) : "",
      row.fixed ? (row.fixed.avgDownloadKbps / 1000).toFixed(2) : "",
      row.mobile ? (row.mobile.avgUploadKbps / 1000).toFixed(2) : "",
      row.fixed ? (row.fixed.avgUploadKbps / 1000).toFixed(2) : "",
      row.mobile?.avgLatencyMs.toFixed(2) ?? "",
      row.fixed?.avgLatencyMs.toFixed(2) ?? "",
      row.mobile?.tests ?? "",
      row.fixed?.tests ?? "",
    ]),
  ].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `ookla-analisis-${metric}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type AnalysisRow = {
  key: string;
  label: string;
  year: number;
  quarter?: number;
  mobile: AnalysisValue | null;
  fixed: AnalysisValue | null;
};

function chartY(value: number, minimum: number, maximum: number) {
  const span = maximum - minimum || Math.max(Math.abs(maximum) * 0.1, 1);
  return 18 + ((maximum - value) / span) * 136;
}

export default function AnalysisPanel() {
  const [metric, setMetric] = useState<MapMetric>("download");
  const [region, setRegion] = useState("indonesia-sekitarnya");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("year");

  const rows = useMemo(() => {
    const grouped = new Map<string, {
      year: number;
      quarter?: number;
      mobile: { tests: number; download: number; upload: number; latency: number };
      fixed: { tests: number; download: number; upload: number; latency: number };
    }>();
    for (const entry of analysisData.entries) {
      if (entry.region !== region) continue;
      const key = periodMode === "year" ? String(entry.year) : entry.period;
      let row = grouped.get(key);
      if (!row) {
        row = {
          year: entry.year,
          quarter: periodMode === "quarter" ? entry.quarter : undefined,
          mobile: { tests: 0, download: 0, upload: 0, latency: 0 },
          fixed: { tests: 0, download: 0, upload: 0, latency: 0 },
        };
        grouped.set(key, row);
      }
      const target = entry.networkType === "mobile" ? row.mobile : row.fixed;
      target.tests += entry.tests;
      target.download += entry.avgDownloadKbps * entry.tests;
      target.upload += entry.avgUploadKbps * entry.tests;
      target.latency += entry.avgLatencyMs * entry.tests;
    }

    return [...grouped.entries()].map(([key, row]): AnalysisRow => {
      const finish = (value: typeof row.mobile): AnalysisValue | null => value.tests
        ? {
            avgDownloadKbps: value.download / value.tests,
            avgUploadKbps: value.upload / value.tests,
            avgLatencyMs: value.latency / value.tests,
            tests: value.tests,
          }
        : null;
      return {
        key,
        label: periodMode === "year" ? key : `Q${row.quarter} ${row.year}`,
        year: row.year,
        quarter: row.quarter,
        mobile: finish(row.mobile),
        fixed: finish(row.fixed),
      };
    }).sort((a, b) => a.year - b.year || (a.quarter ?? 0) - (b.quarter ?? 0));
  }, [periodMode, region]);

  const chartSeries = rows.flatMap((row) => [
    ...(row.mobile ? [{ key: row.key, label: row.label, type: "mobile" as const, value: metricValue(row.mobile, metric) }] : []),
    ...(row.fixed ? [{ key: row.key, label: row.label, type: "fixed" as const, value: metricValue(row.fixed, metric) }] : []),
  ]);
  const values = chartSeries.map((point) => point.value);
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 1;
  const xFor = (index: number) => rows.length <= 1 ? 320 : 42 + (index * 566) / (rows.length - 1);
  const lineFor = (type: "mobile" | "fixed") => rows
    .map((row, index) => {
      const value = row[type] ? metricValue(row[type], metric) : null;
      return value === null ? null : `${xFor(index)},${chartY(value, minimum, maximum)}`;
    })
    .filter((point): point is string => point !== null)
    .join(" ");

  const latestPeriodValue = analysisData.latestPeriod;
  const latestPeriod = analysisData.periods.find((period) => period.value === latestPeriodValue)?.label ?? "—";
  const regionLabel = analysisData.regions.find((item) => item.value === region)?.label ?? region;
  const latestEntries = analysisData.entries.filter((entry) => entry.region === region && entry.period === latestPeriodValue);
  const latestEntry = latestEntries[0];
  const latestMobileTests = latestEntries.find((entry) => entry.networkType === "mobile")?.tests ?? 0;
  const latestFixedTests = latestEntries.find((entry) => entry.networkType === "fixed")?.tests ?? 0;
  const latestYear = latestEntry?.year;
  const latestQuarter = latestEntry?.quarter;
  const latestMobileEntries = analysisData.entries.filter((entry) =>
    entry.region === region &&
    entry.networkType === "mobile" &&
    (periodMode === "year"
      ? entry.year === latestYear && entry.quarter <= (latestQuarter ?? 0)
      : entry.period === analysisData.latestPeriod),
  );
  const previousMobileEntries = analysisData.entries.filter((entry) =>
    entry.region === region &&
    entry.networkType === "mobile" &&
    (periodMode === "year"
      ? entry.year === (latestYear ?? 0) - 1 && entry.quarter <= (latestQuarter ?? 0)
      : entry.year === (latestYear ?? 0) - 1 && entry.quarter === latestQuarter),
  );
  const latestMobile = weightedMetricValue(latestMobileEntries, metric);
  const previousMobile = weightedMetricValue(previousMobileEntries, metric);
  const periodChange = latestMobile !== null && previousMobile !== null && previousMobile !== 0
    ? ((latestMobile - previousMobile) / previousMobile) * 100
    : null;
  const changeLabel = periodMode === "year"
    ? `Q1–Q${latestQuarter ?? "?"} ${Number(latestYear) - 1} → ${latestYear}`
    : `Q${latestQuarter ?? "?"} ${Number(latestYear) - 1} → ${latestYear}`;

  return (
    <div className="map-panel-body analysis-panel">
      <div className="analysis-period-summary" aria-label="Periode dan jumlah tes Ookla terbaru">
        <div className="analysis-period-main">
          <span>PERIODE TERBARU DI ARSIP</span>
          <strong>{latestPeriod}</strong>
        </div>
        <div className="analysis-period-tests">
          <span>JUMLAH TES · {regionLabel}</span>
          <p>
            <strong>{formatNumber(latestMobileTests)}</strong> mobile
            <i aria-hidden="true" />
            <strong>{formatNumber(latestFixedTests)}</strong> fixed
          </p>
        </div>
        <small>Data historis Ookla yang tersedia, bukan pengukuran langsung.</small>
      </div>
      <div className="coverage-panel-filters analysis-filters">
        <label>
          <span>Wilayah analisis · perkiraan</span>
          <select aria-label="Filter wilayah analisis" onChange={(event) => setRegion(event.target.value)} value={region}>
            {analysisData.regions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span>Metrik</span>
          <select aria-label="Pilih metrik analisis" onChange={(event) => setMetric(event.target.value as MapMetric)} value={metric}>
            {Object.entries(metricLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <div aria-label="Pengelompokan periode" className="analysis-period-toggle" role="group">
        <button aria-pressed={periodMode === "year"} className={periodMode === "year" ? "is-active" : ""} onClick={() => setPeriodMode("year")} type="button">Tahunan</button>
        <button aria-pressed={periodMode === "quarter"} className={periodMode === "quarter" ? "is-active" : ""} onClick={() => setPeriodMode("quarter")} type="button">Kuartalan</button>
      </div>
      <div className="analysis-chart-wrap">
        <div className="analysis-chart-heading">
          <strong>Tren {metricLabels[metric].toLocaleLowerCase("id-ID")}</strong>
          <span>{metric === "latency" ? "ms" : "Mbps"}</span>
        </div>
        <svg aria-label={`Tren ${metricLabels[metric]} untuk mobile dan fixed, wilayah ${regionLabel}`} className="analysis-chart" role="img" viewBox="0 0 640 205">
          <line className="analysis-grid-line" x1="42" x2="608" y1="18" y2="18" />
          <line className="analysis-grid-line" x1="42" x2="608" y1="154" y2="154" />
          <text className="analysis-axis-label" textAnchor="end" x="37" y="22">{formatValue(maximum, metric)}</text>
          <text className="analysis-axis-label" textAnchor="end" x="37" y="158">{formatValue(minimum, metric)}</text>
          {(["mobile", "fixed"] as const).map((type) => (
            <polyline className={`analysis-line is-${type}`} key={type} points={lineFor(type)} />
          ))}
          {rows.map((row, index) => {
            const showTick = periodMode === "year" || row.quarter === 1 || index === rows.length - 1;
            return (
              <g key={row.key}>
                {(["mobile", "fixed"] as const).map((type) => {
                  const value = row[type] ? metricValue(row[type], metric) : null;
                  if (value === null) return null;
                  return (
                    <circle className={`analysis-point is-${type}`} key={type} r="3.5" cx={xFor(index)} cy={chartY(value, minimum, maximum)}>
                      <title>{`${row.label} · ${type === "mobile" ? "Mobile" : "Fixed"}: ${formatValue(value, metric)}`}</title>
                    </circle>
                  );
                })}
                {showTick && <text className="analysis-x-label" textAnchor="middle" x={xFor(index)} y="176">{periodMode === "year" ? row.label : `Q${row.quarter} '${String(row.year).slice(-2)}`}</text>}
              </g>
            );
          })}
          <text className="analysis-x-label" textAnchor="middle" x="200" y="198">Periode data</text>
        </svg>
        <div className="analysis-legend">
          <span><i className="is-mobile" />Mobile</span>
          <span><i className="is-fixed" />Fixed broadband</span>
        </div>
      </div>
      <div className="analysis-kpi">
        <span>Perubahan Mobile, {latestYear ? changeLabel : "antarperiode"}</span>
        <strong className={periodChange !== null && periodChange < 0 ? "is-negative" : ""}>
          {periodChange === null ? "—" : `${periodChange > 0 ? "+" : ""}${periodChange.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`}
        </strong>
        <small>{regionLabel} · {metricLabels[metric].toLocaleLowerCase("id-ID")}</small>
      </div>
      <p className="map-panel-caption">Batas wilayah memakai kotak koordinat dan titik tengah sel, bukan batas administrasi. Perbandingan dibobot jumlah tes; tahun berjalan hanya memakai kuartal yang tersedia.</p>
      <div className="map-section-heading analysis-table-heading">
        <span>PERBANDINGAN {periodMode === "year" ? "TAHUNAN" : "KUARTALAN"}</span>
        <button aria-label="Ekspor analisis CSV" className="map-export-button" onClick={() => downloadCsv(rows, metric)} type="button">
          <Icon name="download" size={13} /> CSV
        </button>
      </div>
      <div className="analysis-table-wrap">
        <table className="analysis-table">
          <thead>
            <tr><th>Periode</th><th>Mobile</th><th>Fixed</th><th>Selisih M−F</th></tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((row) => {
              const mobile = row.mobile ? metricValue(row.mobile, metric) : null;
              const fixed = row.fixed ? metricValue(row.fixed, metric) : null;
              return (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>
                    {mobile === null ? "—" : <><span>{formatValue(mobile, metric)}</span><small>{formatNumber(row.mobile?.tests ?? 0)} tes</small></>}
                  </td>
                  <td>
                    {fixed === null ? "—" : <><span>{formatValue(fixed, metric)}</span><small>{formatNumber(row.fixed?.tests ?? 0)} tes</small></>}
                  </td>
                  <td>{mobile === null || fixed === null ? "—" : formatValue(mobile - fixed, metric)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="map-panel-footnote">Selisih = Mobile dikurangi Fixed. Data berasal dari arsip lokal Ookla, bukan pengukuran langsung.</p>
    </div>
  );
}
