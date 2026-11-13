"use client";

import { useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import analysisData from "../lib/ookla-analysis.json";
import { formatNumber } from "../lib/network-data";
import type { MapMetric } from "./mapview";
import Icon from "./icon";

type AnalysisEntry = (typeof analysisData.entries)[number];
type PeriodMode = "year" | "quarter";
type ChartMode = "performance" | "tests";
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

function downloadCsv(rows: AnalysisRow[], metric: MapMetric, region: string, periodMode: PeriodMode) {
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
  link.download = `ookla-analisis-${region}-${periodMode}-${metric}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportStatisticsCsv(
  rows: AnalysisRow[],
  metric: MapMetric,
  regionLabel: string,
  periodMode: PeriodMode,
  chartMode: ChartMode,
  latestPeriod: string,
  latestMobileTests: number,
  latestFixedTests: number,
  periodChange: number | null,
  changeLabel: string,
) {
  const metricUnit = metric === "latency" ? "ms" : "Mbps";
  const valueForCsv = (entry: AnalysisValue | null) => {
    if (!entry) return "";
    const value = metricValue(entry, metric);
    return metric === "latency" ? value.toFixed(2) : (value / 1000).toFixed(2);
  };
  const content = [
    ["Ringkasan statistik Ookla"],
    ["Wilayah analisis (perkiraan)", regionLabel],
    ["Periode arsip terbaru", latestPeriod],
    ["Metrik", `${metricLabels[metric]} (${metricUnit})`],
    ["Perubahan Mobile", changeLabel, periodChange === null ? "" : `${periodChange.toFixed(2)}%`],
    ["Tes Mobile periode terbaru", latestMobileTests],
    ["Tes Fixed periode terbaru", latestFixedTests],
    ["Jenis grafik", chartMode === "performance" ? "Performa" : "Volume tes"],
    [],
    ["Periode", `Mobile (${metricUnit})`, `Fixed (${metricUnit})`, `Selisih M-F (${metricUnit})`, "Tes Mobile", "Tes Fixed"],
    ...[...rows].reverse().map((row) => {
      const mobile = row.mobile ? metricValue(row.mobile, metric) : null;
      const fixed = row.fixed ? metricValue(row.fixed, metric) : null;
      return [
        row.label,
        valueForCsv(row.mobile),
        valueForCsv(row.fixed),
        mobile === null || fixed === null
          ? ""
          : (metric === "latency" ? mobile - fixed : (mobile - fixed) / 1000).toFixed(2),
        row.mobile?.tests ?? "",
        row.fixed?.tests ?? "",
      ];
    }),
    [],
    ["Catatan", "Rata-rata dibobot jumlah tes; batas wilayah analisis merupakan perkiraan; bersumber dari arsip Ookla, bukan pengukuran langsung."],
  ].map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadBlob(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }), `ookla-statistik-${periodMode}-${metric}.csv`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function tableCells(row: AnalysisRow, metric: MapMetric) {
  const mobile = row.mobile ? metricValue(row.mobile, metric) : null;
  const fixed = row.fixed ? metricValue(row.fixed, metric) : null;
  return [
    row.label,
    mobile === null ? "—" : formatValue(mobile, metric),
    fixed === null ? "—" : formatValue(fixed, metric),
    mobile === null || fixed === null ? "—" : formatValue(mobile - fixed, metric),
  ];
}

function exportTableImage(
  rows: AnalysisRow[],
  metric: MapMetric,
  regionLabel: string,
  periodMode: PeriodMode,
  format: "png" | "jpeg",
) {
  const width = 1200;
  const margin = 52;
  const headerHeight = 210;
  const rowHeight = 66;
  const height = headerHeight + rows.length * rowHeight + 54;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Browser tidak dapat menyiapkan gambar ekspor.");
  context.scale(scale, scale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#263b35";
  context.font = "700 30px Arial, sans-serif";
  context.fillText("Analisis performa jaringan Ookla", margin, 48);
  context.fillStyle = "#64766e";
  context.font = "18px Arial, sans-serif";
  context.fillText(`${regionLabel} · ${periodMode === "year" ? "Tahunan" : "Kuartalan"} · ${metricLabels[metric]}`, margin, 80);
  context.fillText("Rata-rata dibobot jumlah tes · batas wilayah analisis merupakan perkiraan", margin, 110);

  const columns = [
    { label: "Periode", x: margin, width: 180, align: "left" as const },
    { label: "Mobile", x: 232, width: 260, align: "right" as const },
    { label: "Fixed", x: 492, width: 260, align: "right" as const },
    { label: "Selisih M-F", x: 752, width: 396, align: "right" as const },
  ];
  let y = 148;
  context.fillStyle = "#f0f5f1";
  context.fillRect(margin, y, width - margin * 2, 48);
  context.font = "700 17px Arial, sans-serif";
  context.fillStyle = "#52645b";
  for (const column of columns) {
    context.textAlign = column.align;
    context.fillText(column.label, column.x + (column.align === "right" ? column.width : 0), y + 30);
  }
  y += 48;
  context.font = "16px Arial, sans-serif";
  [...rows].reverse().forEach((row, index) => {
    if (index % 2 === 1) {
      context.fillStyle = "#fafcfb";
      context.fillRect(margin, y, width - margin * 2, rowHeight);
    }
    context.strokeStyle = "#e7ede9";
    context.beginPath();
    context.moveTo(margin, y + rowHeight);
    context.lineTo(width - margin, y + rowHeight);
    context.stroke();
    const values = tableCells(row, metric);
    context.fillStyle = "#43564d";
    columns.forEach((column, columnIndex) => {
      const x = column.x + (column.align === "right" ? column.width : 0);
      context.textAlign = column.align;
      context.font = columnIndex === 0 ? "700 16px Arial, sans-serif" : "16px Arial, sans-serif";
      context.fillText(values[columnIndex], x, y + 27);
      if (columnIndex === 1 || columnIndex === 2) {
        const tests = columnIndex === 1 ? row.mobile?.tests : row.fixed?.tests;
        context.fillStyle = "#84928b";
        context.font = "13px Arial, sans-serif";
        context.fillText(tests === undefined ? "Tidak tersedia" : `${formatNumber(tests)} tes`, x, y + 49);
        context.fillStyle = "#43564d";
      }
    });
    y += rowHeight;
  });
  context.textAlign = "left";
  context.fillStyle = "#7b8982";
  context.font = "14px Arial, sans-serif";
  context.fillText("Sumber: arsip Ookla yang tersedia · bukan pengukuran langsung", margin, height - 19);

  return new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Gambar tabel gagal dibuat oleh browser."));
        return;
      }
      downloadBlob(blob, `ookla-analisis-${periodMode}-${metric}.${format === "jpeg" ? "jpg" : "png"}`);
      resolve();
    }, format === "jpeg" ? "image/jpeg" : "image/png", format === "jpeg" ? 0.94 : undefined);
  });
}

function exportTablePdf(rows: AnalysisRow[], metric: MapMetric, regionLabel: string, periodMode: PeriodMode) {
  const document = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const margin = 40;
  const tableWidth = pageWidth - margin * 2;
  const columnWidths = [100, 200, 200, tableWidth - 500];
  const rowHeight = 34;
  const rowsLatestFirst = [...rows].reverse();
  const drawHeader = (continued: boolean) => {
    document.setTextColor(38, 59, 53);
    document.setFont("helvetica", "bold");
    document.setFontSize(18);
    document.text("Analisis performa jaringan Ookla", margin, 40);
    document.setFont("helvetica", "normal");
    document.setFontSize(10);
    document.setTextColor(95, 116, 105);
    document.text(`${regionLabel} | ${periodMode === "year" ? "Tahunan" : "Kuartalan"} | ${metricLabels[metric]}${continued ? " (lanjutan)" : ""}`, margin, 59);
    document.text("Rata-rata dibobot jumlah tes | batas wilayah analisis merupakan perkiraan", margin, 74);
    const y = 90;
    document.setFillColor(240, 245, 241);
    document.rect(margin, y, tableWidth, rowHeight, "F");
    document.setFont("helvetica", "bold");
    document.setFontSize(10);
    document.setTextColor(62, 83, 72);
    ["Periode", "Mobile", "Fixed", "Selisih M-F"].forEach((heading, index) => {
      const x = margin + columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0);
      document.text(heading, x + 8, y + 21);
    });
    return y + rowHeight;
  };
  let y = drawHeader(false);
  rowsLatestFirst.forEach((row, rowIndex) => {
    if (y + rowHeight > pageHeight - 38) {
      document.addPage();
      y = drawHeader(true);
    }
    const values = tableCells(row, metric);
    const isAlternate = rowIndex % 2 === 1;
    if (isAlternate) {
      document.setFillColor(250, 252, 251);
      document.rect(margin, y, tableWidth, rowHeight, "F");
    }
    document.setDrawColor(231, 237, 233);
    document.line(margin, y + rowHeight, margin + tableWidth, y + rowHeight);
    document.setFont("helvetica", rowIndex === 0 ? "bold" : "normal");
    document.setFontSize(10);
    document.setTextColor(67, 86, 77);
    values.forEach((value, index) => {
      const x = margin + columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0);
      document.text(value, x + 8, y + (index === 0 ? 21 : 15));
      if (index === 1 || index === 2) {
        const tests = index === 1 ? row.mobile?.tests : row.fixed?.tests;
        document.setFont("helvetica", "normal");
        document.setFontSize(8);
        document.setTextColor(125, 141, 132);
        document.text(tests === undefined ? "Tidak tersedia" : `${formatNumber(tests)} tes`, x + 8, y + 27);
        document.setFont("helvetica", "normal");
        document.setFontSize(10);
        document.setTextColor(67, 86, 77);
      }
    });
    y += rowHeight;
  });
  const pageCount = document.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    document.setPage(page);
    document.setFont("helvetica", "normal");
    document.setFontSize(8);
    document.setTextColor(123, 137, 128);
    document.text("Sumber: arsip Ookla yang tersedia | bukan pengukuran langsung", margin, pageHeight - 18);
    document.text(`${page} / ${pageCount}`, pageWidth - margin, pageHeight - 18, { align: "right" });
  }
  downloadBlob(document.output("blob"), `ookla-analisis-${periodMode}-${metric}.pdf`);
}

function exportStatisticsImage(
  rows: AnalysisRow[],
  metric: MapMetric,
  regionLabel: string,
  periodMode: PeriodMode,
  chartMode: ChartMode,
  latestPeriod: string,
  latestMobileTests: number,
  latestFixedTests: number,
  periodChange: number | null,
  changeLabel: string,
  format: "png" | "jpeg",
) {
  const width = 1400;
  const height = 760;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Browser tidak dapat menyiapkan gambar ekspor statistik.");
  context.scale(scale, scale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#263b35";
  context.font = "700 34px Arial, sans-serif";
  context.fillText("Statistik performa jaringan Ookla", 60, 58);
  context.fillStyle = "#64766e";
  context.font = "20px Arial, sans-serif";
  context.fillText(`${regionLabel} · ${periodMode === "year" ? "Tahunan" : "Kuartalan"} · ${metricLabels[metric]}`, 60, 94);
  context.fillText("Batas wilayah analisis merupakan perkiraan · data arsip, bukan pengukuran langsung", 60, 126);

  const cardY = 154;
  const cardWidth = 405;
  const cardGap = 24;
  const cards = [
    { label: `DATA TERBARU · ${latestPeriod}`, value: `${formatNumber(latestMobileTests)} Mobile`, detail: `${formatNumber(latestFixedTests)} tes Fixed` },
    { label: "PERUBAHAN MOBILE", value: periodChange === null ? "—" : `${periodChange > 0 ? "+" : ""}${periodChange.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`, detail: changeLabel },
    { label: "PERIODE TERCAKUP", value: `${rows.length} periode`, detail: `${chartMode === "performance" ? "Tren performa" : "Volume tes"} · ${metricLabels[metric]}` },
  ];
  cards.forEach((card, index) => {
    const x = 60 + index * (cardWidth + cardGap);
    context.fillStyle = "#f5f8f5";
    context.fillRect(x, cardY, cardWidth, 100);
    context.fillStyle = "#728078";
    context.font = "15px Arial, sans-serif";
    context.fillText(card.label, x + 18, cardY + 27);
    context.fillStyle = "#287c61";
    context.font = "700 25px Arial, sans-serif";
    context.fillText(card.value, x + 18, cardY + 59);
    context.fillStyle = "#728078";
    context.font = "14px Arial, sans-serif";
    context.fillText(card.detail, x + 18, cardY + 83);
  });

  const chartLeft = 100;
  const chartRight = 1335;
  const chartTop = 320;
  const chartBottom = 620;
  const chartValues = chartMode === "performance"
    ? rows.flatMap((row) => [row.mobile, row.fixed].filter((entry): entry is AnalysisValue => entry !== null).map((entry) => metricValue(entry, metric)))
    : rows.flatMap((row) => [row.mobile?.tests ?? 0, row.fixed?.tests ?? 0]);
  const maximum = Math.max(...chartValues, 1);
  const minimum = chartMode === "performance" && chartValues.length ? Math.min(...chartValues) : 0;
  const span = maximum - minimum || 1;
  const xForRow = (index: number) => rows.length <= 1 ? (chartLeft + chartRight) / 2 : chartLeft + index * (chartRight - chartLeft) / (rows.length - 1);
  const yForValue = (value: number) => chartBottom - ((value - minimum) / span) * (chartBottom - chartTop);
  context.fillStyle = "#40564b";
  context.font = "700 20px Arial, sans-serif";
  context.fillText(chartMode === "performance" ? `Tren ${metricLabels[metric].toLocaleLowerCase("id-ID")} (${metric === "latency" ? "ms" : "Mbps"})` : "Volume tes", 60, 295);
  context.strokeStyle = "#e7ede9";
  context.lineWidth = 2;
  for (const fraction of [0, 0.5, 1]) {
    const y = chartTop + fraction * (chartBottom - chartTop);
    context.beginPath();
    context.moveTo(chartLeft, y);
    context.lineTo(chartRight, y);
    context.stroke();
  }
  if (chartMode === "performance") {
    (["mobile", "fixed"] as const).forEach((type, seriesIndex) => {
      context.strokeStyle = seriesIndex === 0 ? "#279276" : "#6478c5";
      context.fillStyle = context.strokeStyle;
      context.lineWidth = 4;
      context.beginPath();
      let started = false;
      rows.forEach((row, index) => {
        const entry = row[type];
        if (!entry) return;
        const x = xForRow(index);
        const y = yForValue(metricValue(entry, metric));
        if (started) context.lineTo(x, y);
        else {
          context.moveTo(x, y);
          started = true;
        }
        context.fillRect(x - 5, y - 5, 10, 10);
      });
      context.stroke();
    });
  } else {
    const barWidth = Math.max(5, Math.min(20, (chartRight - chartLeft) / Math.max(rows.length, 1) / 3));
    rows.forEach((row, index) => {
      const center = xForRow(index);
      ([row.mobile?.tests ?? 0, row.fixed?.tests ?? 0] as const).forEach((tests, seriesIndex) => {
        if (!tests) return;
        const y = yForValue(tests);
        context.fillStyle = seriesIndex === 0 ? "#279276" : "#6478c5";
        context.fillRect(center + (seriesIndex === 0 ? -barWidth - 2 : 2), y, barWidth, chartBottom - y);
      });
    });
  }
  context.fillStyle = "#718078";
  context.font = "13px Arial, sans-serif";
  rows.forEach((row, index) => {
    if (periodMode === "quarter" && row.quarter !== 1 && index !== rows.length - 1) return;
    context.textAlign = "center";
    context.fillText(periodMode === "year" ? row.label : `Q${row.quarter} '${String(row.year).slice(-2)}`, xForRow(index), chartBottom + 24);
  });
  context.textAlign = "left";
  context.font = "16px Arial, sans-serif";
  context.fillStyle = "#279276";
  context.fillRect(500, 682, 12, 12);
  context.fillStyle = "#64766e";
  context.fillText(`Mobile · ${chartMode === "performance" ? "rata-rata tertimbang" : "jumlah tes"}`, 520, 694);
  context.fillStyle = "#6478c5";
  context.fillRect(815, 682, 12, 12);
  context.fillStyle = "#64766e";
  context.fillText(`Fixed · ${chartMode === "performance" ? "rata-rata tertimbang" : "jumlah tes"}`, 835, 694);
  context.fillStyle = "#7b8982";
  context.font = "13px Arial, sans-serif";
  context.fillText("Sumber: arsip Ookla yang tersedia · bukan pengukuran langsung", 60, 740);

  return new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Gambar statistik gagal dibuat oleh browser."));
        return;
      }
      downloadBlob(blob, `ookla-statistik-${periodMode}-${metric}.${format === "jpeg" ? "jpg" : "png"}`);
      resolve();
    }, format === "jpeg" ? "image/jpeg" : "image/png", format === "jpeg" ? 0.94 : undefined);
  });
}

function exportStatisticsPdf(
  rows: AnalysisRow[],
  metric: MapMetric,
  regionLabel: string,
  periodMode: PeriodMode,
  chartMode: ChartMode,
  latestPeriod: string,
  latestMobileTests: number,
  latestFixedTests: number,
  periodChange: number | null,
  changeLabel: string,
) {
  const document = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = document.internal.pageSize.getWidth();
  const left = 42;
  const right = pageWidth - 42;
  document.setTextColor(38, 59, 53);
  document.setFont("helvetica", "bold");
  document.setFontSize(20);
  document.text("Statistik performa jaringan Ookla", left, 42);
  document.setFont("helvetica", "normal");
  document.setFontSize(11);
  document.setTextColor(95, 116, 105);
  document.text(`${regionLabel} | ${periodMode === "year" ? "Tahunan" : "Kuartalan"} | ${metricLabels[metric]}`, left, 62);
  document.text("Batas wilayah analisis merupakan perkiraan | data arsip, bukan pengukuran langsung", left, 78);

  const cardY = 98;
  const cardWidth = (right - left - 24) / 3;
  const cardValues = [
    [`Data terbaru: ${latestPeriod}`, `${formatNumber(latestMobileTests)} tes Mobile`, `${formatNumber(latestFixedTests)} tes Fixed`],
    ["Perubahan Mobile", periodChange === null ? "Tidak tersedia" : `${periodChange > 0 ? "+" : ""}${periodChange.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`, changeLabel],
    ["Periode tercakup", `${rows.length} periode`, `${chartMode === "performance" ? "Tren performa" : "Volume tes"} | ${metricLabels[metric]}`],
  ];
  cardValues.forEach((lines, index) => {
    const x = left + index * (cardWidth + 12);
    document.setFillColor(245, 248, 245);
    document.roundedRect(x, cardY, cardWidth, 66, 5, 5, "F");
    document.setTextColor(75, 96, 84);
    document.setFont("helvetica", "bold");
    document.setFontSize(11);
    document.text(lines[0], x + 12, cardY + 19);
    document.setFont("helvetica", "normal");
    document.setFontSize(10);
    document.text(lines[1], x + 12, cardY + 37);
    document.setTextColor(123, 137, 128);
    document.setFontSize(9);
    document.text(lines[2], x + 12, cardY + 53);
  });

  const chartLeft = left + 36;
  const chartRight = right - 12;
  const chartTop = 205;
  const chartBottom = 365;
  const chartValues = chartMode === "performance"
    ? rows.flatMap((row) => [row.mobile, row.fixed].filter((entry): entry is AnalysisValue => entry !== null).map((entry) => metricValue(entry, metric)))
    : rows.flatMap((row) => [row.mobile?.tests ?? 0, row.fixed?.tests ?? 0]);
  const maximum = Math.max(...chartValues, 1);
  const minimum = chartMode === "performance" && chartValues.length ? Math.min(...chartValues) : 0;
  const span = maximum - minimum || 1;
  const xForRow = (index: number) => rows.length <= 1 ? (chartLeft + chartRight) / 2 : chartLeft + index * (chartRight - chartLeft) / (rows.length - 1);
  const yForValue = (value: number) => chartBottom - ((value - minimum) / span) * (chartBottom - chartTop);
  document.setTextColor(64, 86, 75);
  document.setFont("helvetica", "bold");
  document.setFontSize(12);
  document.text(chartMode === "performance" ? `Tren ${metricLabels[metric].toLocaleLowerCase("id-ID")} (${metric === "latency" ? "ms" : "Mbps"})` : "Volume tes", left, 188);
  document.setDrawColor(231, 237, 233);
  for (const fraction of [0, 0.5, 1]) {
    const y = chartTop + fraction * (chartBottom - chartTop);
    document.line(chartLeft, y, chartRight, y);
  }
  if (chartMode === "performance") {
    (["mobile", "fixed"] as const).forEach((type, seriesIndex) => {
      const color = seriesIndex === 0 ? [39, 146, 118] : [100, 120, 197];
      document.setDrawColor(color[0], color[1], color[2]);
      document.setFillColor(color[0], color[1], color[2]);
      let previous: { x: number; y: number } | null = null;
      rows.forEach((row, index) => {
        const entry = row[type];
        if (!entry) return;
        const point = { x: xForRow(index), y: yForValue(metricValue(entry, metric)) };
        if (previous) document.line(previous.x, previous.y, point.x, point.y);
        document.circle(point.x, point.y, 2, "F");
        previous = point;
      });
    });
  } else {
    const barWidth = Math.max(3, Math.min(9, (chartRight - chartLeft) / Math.max(rows.length, 1) / 3));
    rows.forEach((row, index) => {
      const center = xForRow(index);
      ([row.mobile?.tests ?? 0, row.fixed?.tests ?? 0] as const).forEach((tests, seriesIndex) => {
        if (!tests) return;
        const color = seriesIndex === 0 ? [39, 146, 118] : [100, 120, 197];
        document.setFillColor(color[0], color[1], color[2]);
        const y = yForValue(tests);
        document.rect(center + (seriesIndex === 0 ? -barWidth - 1 : 1), y, barWidth, chartBottom - y, "F");
      });
    });
  }
  document.setFont("helvetica", "normal");
  document.setFontSize(8);
  document.setTextColor(95, 116, 105);
  rows.forEach((row, index) => {
    if (periodMode === "quarter" && row.quarter !== 1 && index !== rows.length - 1) return;
    document.text(periodMode === "year" ? row.label : `Q${row.quarter} '${String(row.year).slice(-2)}`, xForRow(index), chartBottom + 13, { align: "center" });
  });
  document.setFillColor(39, 146, 118);
  document.circle(left + 180, 403, 3, "F");
  document.setTextColor(95, 116, 105);
  document.text("Mobile", left + 190, 406);
  document.setFillColor(100, 120, 197);
  document.circle(left + 250, 403, 3, "F");
  document.text("Fixed broadband", left + 260, 406);
  document.setFontSize(9);
  document.text("Rata-rata dibobot jumlah tes | Sumber: arsip Ookla yang tersedia", left, 435);
  downloadBlob(document.output("blob"), `ookla-statistik-${periodMode}-${metric}.pdf`);
}

type AnalysisTab = "trend" | "multi-region" | "gap" | "growth";

type AnalysisRow = {
  key: string;
  label: string;
  year: number;
  quarter?: number;
  mobile: AnalysisValue | null;
  fixed: AnalysisValue | null;
};

const regionColors: Record<string, string> = {
  "indonesia-sekitarnya": "#475569",
  jawa: "#2563eb",
  sumatra: "#16a085",
  "bali-nusa-tenggara": "#d97706",
  kalimantan: "#059669",
  sulawesi: "#7c3aed",
  maluku: "#db2777",
  papua: "#dc2626",
};

function downloadLeaderboardCsv(
  items: {
    rank: number;
    regionLabel: string;
    value: number;
    diffVsBenchmark: number;
    tests: number;
    devices: number;
  }[],
  metric: MapMetric,
  networkType: "mobile" | "fixed",
  periodLabel: string
) {
  const metricUnit = metric === "latency" ? "ms" : "Mbps";
  const content = [
    ["Peringkat Performa Wilayah Ookla"],
    ["Periode", periodLabel],
    ["Jenis Jaringan", networkType === "mobile" ? "Mobile" : "Fixed broadband"],
    ["Metrik", `${metricLabels[metric]} (${metricUnit})`],
    [],
    ["Peringkat", "Wilayah", `Nilai (${metricUnit})`, `Selisih vs Nasional (${metricUnit})`, "Jumlah Tes", "Jumlah Perangkat"],
    ...items.map((item) => [
      item.rank,
      item.regionLabel,
      metric === "latency" ? item.value.toFixed(1) : (item.value / 1000).toFixed(2),
      metric === "latency" ? item.diffVsBenchmark.toFixed(1) : (item.diffVsBenchmark / 1000).toFixed(2),
      item.tests,
      item.devices,
    ]),
  ].map((row) => row.map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadBlob(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }), `ookla-peringkat-${networkType}-${metric}.csv`);
}

function downloadConvergenceCsv(
  items: {
    regionLabel: string;
    mobileDownload: number;
    fixedDownload: number;
    ratio: number;
    mobileLatency: number;
    fixedLatency: number;
    latencyDiff: number;
    status: string;
  }[],
  periodLabel: string
) {
  const content = [
    ["Analisis Kesenjangan (Convergence Gap) Mobile vs Fixed Broadband"],
    ["Periode", periodLabel],
    [],
    ["Wilayah", "Unduh Mobile (Mbps)", "Unduh Fixed (Mbps)", "Rasio Unduh (Fixed/Mobile)", "Latensi Mobile (ms)", "Latensi Fixed (ms)", "Selisih Latensi (ms)", "Status Kesenjangan"],
    ...items.map((item) => [
      item.regionLabel,
      (item.mobileDownload / 1000).toFixed(2),
      (item.fixedDownload / 1000).toFixed(2),
      item.ratio.toFixed(2),
      item.mobileLatency.toFixed(1),
      item.fixedLatency.toFixed(1),
      item.latencyDiff.toFixed(1),
      item.status,
    ]),
  ].map((row) => row.map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadBlob(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }), `ookla-kesenjangan-konvergensi.csv`);
}

function downloadGrowthCsv(
  items: {
    rank: number;
    regionLabel: string;
    currentValue: number;
    priorYoYValue: number | null;
    yoyPct: number | null;
    qoqPct: number | null;
    fiveYearPct: number | null;
  }[],
  metric: MapMetric,
  networkType: "mobile" | "fixed"
) {
  const metricUnit = metric === "latency" ? "ms" : "Mbps";
  const content = [
    ["Analisis Pertumbuhan (Growth YoY & QoQ) Performa Jaringan"],
    ["Jenis Jaringan", networkType === "mobile" ? "Mobile" : "Fixed broadband"],
    ["Metrik", `${metricLabels[metric]} (${metricUnit})`],
    [],
    ["Peringkat", "Wilayah", `Nilai Terkini (${metricUnit})`, `Nilai 1 Thn Lalu (${metricUnit})`, "Pertumbuhan YoY (%)", "Pertumbuhan QoQ (%)", "Pertumbuhan 5 Tahun (%)"],
    ...items.map((item) => [
      item.rank,
      item.regionLabel,
      metric === "latency" ? item.currentValue.toFixed(1) : (item.currentValue / 1000).toFixed(2),
      item.priorYoYValue === null ? "—" : (metric === "latency" ? item.priorYoYValue.toFixed(1) : (item.priorYoYValue / 1000).toFixed(2)),
      item.yoyPct === null ? "—" : `${item.yoyPct.toFixed(1)}%`,
      item.qoqPct === null ? "—" : `${item.qoqPct.toFixed(1)}%`,
      item.fiveYearPct === null ? "—" : `${item.fiveYearPct.toFixed(1)}%`,
    ]),
  ].map((row) => row.map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadBlob(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }), `ookla-pertumbuhan-${networkType}-${metric}.csv`);
}

function chartY(value: number, minimum: number, maximum: number) {
  const span = maximum - minimum || Math.max(Math.abs(maximum) * 0.1, 1);
  return 18 + ((maximum - value) / span) * 180;
}

export default function AnalysisPanel() {
  const [activeTab, setActiveTab] = useState<AnalysisTab>("trend");

  // Tab 1: Tren Wilayah
  const [metric, setMetric] = useState<MapMetric>("download");
  const [region, setRegion] = useState("indonesia-sekitarnya");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("year");
  const [chartMode, setChartMode] = useState<ChartMode>("performance");
  const [exportError, setExportError] = useState("");

  // Tab 2: Peringkat & Komparasi Multi-Wilayah
  const [mrMetric, setMrMetric] = useState<MapMetric>("download");
  const [mrNetworkType, setMrNetworkType] = useState<"mobile" | "fixed">("mobile");
  const [mrPeriod, setMrPeriod] = useState(analysisData.latestPeriod);
  const [activeRegions, setActiveRegions] = useState<string[]>(
    analysisData.regions.map((r) => r.value)
  );

  // Tab 3: Kesenjangan Mobile vs Fixed
  const [gapPeriod, setGapPeriod] = useState(analysisData.latestPeriod);

  // Tab 4: Pertumbuhan
  const [growthMetric, setGrowthMetric] = useState<MapMetric>("download");
  const [growthNetworkType, setGrowthNetworkType] = useState<"mobile" | "fixed">("mobile");

  // --- Logic Tab 1: Tren Wilayah ---
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
  const maximumTests = Math.max(0, ...rows.flatMap((row) => [row.mobile?.tests ?? 0, row.fixed?.tests ?? 0]));
  const xFor = (index: number) => rows.length <= 1 ? 320 : 42 + (index * 566) / (rows.length - 1);
  const testBarWidth = Math.max(2, Math.min(12, 180 / Math.max(rows.length, 1)));
  const formatTestsAxis = (tests: number) => `${(tests / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  const lineFor = (type: "mobile" | "fixed") => rows
    .map((row, index) => {
      const value = row[type] ? metricValue(row[type], metric) : null;
      return value === null ? null : `${xFor(index)},${chartY(value, minimum, maximum)}`;
    })
    .filter((point): point is string => point !== null)
    .join(" ");

  const latestPeriodValue = analysisData.latestPeriod;
  const latestPeriod = analysisData.periods.find((p) => p.value === latestPeriodValue)?.label ?? "—";
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

  async function handleStatisticsImageExport(format: "png" | "jpeg") {
    setExportError("");
    try {
      await exportStatisticsImage(
        rows, metric, regionLabel, periodMode, chartMode, latestPeriod,
        latestMobileTests, latestFixedTests, periodChange, changeLabel, format,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Gambar statistik gagal diekspor.");
    }
  }

  function handleStatisticsCsvExport() {
    setExportError("");
    try {
      exportStatisticsCsv(
        rows, metric, regionLabel, periodMode, chartMode, latestPeriod,
        latestMobileTests, latestFixedTests, periodChange, changeLabel,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "CSV statistik gagal diekspor.");
    }
  }

  function handleStatisticsPdfExport() {
    setExportError("");
    try {
      exportStatisticsPdf(
        rows, metric, regionLabel, periodMode, chartMode, latestPeriod,
        latestMobileTests, latestFixedTests, periodChange, changeLabel,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "PDF statistik gagal diekspor.");
    }
  }

  async function handleImageExport(format: "png" | "jpeg") {
    setExportError("");
    try {
      await exportTableImage(rows, metric, regionLabel, periodMode, format);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Gambar tabel gagal diekspor.");
    }
  }

  function handlePdfExport() {
    setExportError("");
    try {
      exportTablePdf(rows, metric, regionLabel, periodMode);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "PDF tabel gagal diekspor.");
    }
  }

  // --- Logic Tab 2: Leaderboard & Multi-Region ---
  const leaderboardItems = useMemo(() => {
    const periodEntries = analysisData.entries.filter(
      (e) => e.period === mrPeriod && e.networkType === mrNetworkType
    );
    const benchmarkEntry = periodEntries.find((e) => e.region === "indonesia-sekitarnya");
    const benchmarkVal = benchmarkEntry ? metricValue(benchmarkEntry, mrMetric) : 0;

    const parsed = periodEntries.map((e) => {
      const reg = analysisData.regions.find((r) => r.value === e.region);
      const val = metricValue(e, mrMetric);
      const diff = val - benchmarkVal;
      return {
        regionValue: e.region,
        regionLabel: reg?.label ?? e.region,
        value: val,
        diffVsBenchmark: diff,
        tests: e.tests,
        devices: e.devices,
      };
    });

    if (mrMetric === "latency") {
      parsed.sort((a, b) => a.value - b.value);
    } else {
      parsed.sort((a, b) => b.value - a.value);
    }

    return parsed.map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [mrPeriod, mrNetworkType, mrMetric]);

  const maxLeaderboardVal = useMemo(() => {
    const vals = leaderboardItems.map((i) => i.value);
    return Math.max(...vals, 1);
  }, [leaderboardItems]);

  const multiRegionTimeline = useMemo(() => {
    const allChronologicalPeriods = [...analysisData.periods].reverse();
    const periodKeys = allChronologicalPeriods.map((p) => p.value);

    const regionSeries = analysisData.regions.map((reg) => {
      const points = periodKeys.map((pKey) => {
        const found = analysisData.entries.find(
          (e) => e.region === reg.value && e.period === pKey && e.networkType === mrNetworkType
        );
        return found ? metricValue(found, mrMetric) : null;
      });
      return {
        regionValue: reg.value,
        regionLabel: reg.label,
        color: regionColors[reg.value] || "#475569",
        points,
      };
    });

    const activeSeries = regionSeries.filter((s) => activeRegions.includes(s.regionValue));
    const allNums = activeSeries.flatMap((s) => s.points.filter((v): v is number => v !== null));
    const minVal = allNums.length ? Math.min(...allNums) : 0;
    const maxVal = allNums.length ? Math.max(...allNums) : 1;

    return {
      periods: allChronologicalPeriods,
      series: activeSeries,
      minVal,
      maxVal,
    };
  }, [mrNetworkType, mrMetric, activeRegions]);

  function toggleRegionActive(regVal: string) {
    setActiveRegions((curr) =>
      curr.includes(regVal) ? (curr.length > 1 ? curr.filter((v) => v !== regVal) : curr) : [...curr, regVal]
    );
  }

  // --- Logic Tab 3: Kesenjangan (Convergence Gap) ---
  const convergenceData = useMemo(() => {
    const periodLabel = analysisData.periods.find((p) => p.value === gapPeriod)?.label ?? gapPeriod;
    const items = analysisData.regions.map((reg) => {
      const mob = analysisData.entries.find((e) => e.region === reg.value && e.period === gapPeriod && e.networkType === "mobile");
      const fix = analysisData.entries.find((e) => e.region === reg.value && e.period === gapPeriod && e.networkType === "fixed");

      const mobDown = mob ? mob.avgDownloadKbps : 0;
      const fixDown = fix ? fix.avgDownloadKbps : 0;
      const ratio = mobDown > 0 ? fixDown / mobDown : 0;

      const mobLat = mob ? mob.avgLatencyMs : 0;
      const fixLat = fix ? fix.avgLatencyMs : 0;
      const latDiff = mobLat - fixLat;

      let status = "Konvergen";
      let statusColor = "#16a085";
      let statusBg = "#ecfdf5";
      if (ratio >= 3.0) {
        status = "Disparitas Tinggi";
        statusColor = "#d65e4d";
        statusBg = "#fef2f2";
      } else if (ratio >= 1.8) {
        status = "Disparitas Sedang";
        statusColor = "#d97706";
        statusBg = "#fffbeb";
      }

      return {
        regionValue: reg.value,
        regionLabel: reg.label,
        mobileDownload: mobDown,
        fixedDownload: fixDown,
        ratio,
        mobileLatency: mobLat,
        fixedLatency: fixLat,
        latencyDiff: latDiff,
        status,
        statusColor,
        statusBg,
      };
    });

    const national = items.find((i) => i.regionValue === "indonesia-sekitarnya");
    const nonNational = items.filter((i) => i.regionValue !== "indonesia-sekitarnya");
    const sortedByRatio = [...nonNational].sort((a, b) => b.ratio - a.ratio);
    const highestGap = sortedByRatio[0];
    const lowestGap = sortedByRatio[sortedByRatio.length - 1];

    // Tren Rasio Nasional dari waktu ke waktu
    const chronological = [...analysisData.periods].reverse();
    const ratioTrend = chronological.map((p) => {
      const mob = analysisData.entries.find((e) => e.region === "indonesia-sekitarnya" && e.period === p.value && e.networkType === "mobile");
      const fix = analysisData.entries.find((e) => e.region === "indonesia-sekitarnya" && e.period === p.value && e.networkType === "fixed");
      const r = mob && fix && mob.avgDownloadKbps > 0 ? fix.avgDownloadKbps / mob.avgDownloadKbps : 0;
      return { period: p.value, label: p.label, ratio: r };
    });

    return {
      periodLabel,
      items,
      national,
      highestGap,
      lowestGap,
      ratioTrend,
    };
  }, [gapPeriod]);

  // --- Logic Tab 4: Pertumbuhan (Growth YoY & QoQ) ---
  const growthData = useMemo(() => {
    const latest = analysisData.latestPeriod;
    const [y, m, d] = latest.split("-").map(Number);
    const yoyPrior = `${y - 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const allPeriods = analysisData.periods.map((p) => p.value);
    const latestIdx = allPeriods.indexOf(latest);
    const qoqPrior = latestIdx + 1 < allPeriods.length ? allPeriods[latestIdx + 1] : null;
    const earliest = allPeriods[allPeriods.length - 1];

    const items = analysisData.regions.map((reg) => {
      const getVal = (p: string | null) => {
        if (!p) return null;
        const e = analysisData.entries.find((entry) => entry.region === reg.value && entry.period === p && entry.networkType === growthNetworkType);
        return e ? metricValue(e, growthMetric) : null;
      };

      const currVal = getVal(latest) ?? 0;
      const priorYoY = getVal(yoyPrior);
      const priorQoQ = getVal(qoqPrior);
      const earliestVal = getVal(earliest);

      const calcPct = (curr: number, prev: number | null) => {
        if (prev === null || prev <= 0) return null;
        if (growthMetric === "latency") {
          return ((prev - curr) / prev) * 100;
        }
        return ((curr - prev) / prev) * 100;
      };

      return {
        regionValue: reg.value,
        regionLabel: reg.label,
        currentValue: currVal,
        priorYoYValue: priorYoY,
        yoyPct: calcPct(currVal, priorYoY),
        qoqPct: calcPct(currVal, priorQoQ),
        fiveYearPct: calcPct(currVal, earliestVal),
      };
    });

    items.sort((a, b) => (b.yoyPct ?? -999) - (a.yoyPct ?? -999));
    const ranked = items.map((item, idx) => ({ ...item, rank: idx + 1 }));
    const topGainer = ranked[0];
    const national = ranked.find((i) => i.regionValue === "indonesia-sekitarnya");

    return {
      items: ranked,
      topGainer,
      national,
      latestLabel: analysisData.periods.find((p) => p.value === latest)?.label ?? latest,
      priorYoYLabel: analysisData.periods.find((p) => p.value === yoyPrior)?.label ?? yoyPrior,
    };
  }, [growthNetworkType, growthMetric]);

  return (
    <div className="map-panel-body analysis-panel">
      {/* Sub-Navigation Tabs */}
      <div className="analysis-subnav" role="tablist" aria-label="Kategori Analisis">
        <button
          role="tab"
          aria-selected={activeTab === "trend"}
          className={`analysis-subnav-btn ${activeTab === "trend" ? "is-active" : ""}`}
          onClick={() => setActiveTab("trend")}
          type="button"
        >
          <Icon name="activity" size={14} />
          <span>Tren Wilayah</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "multi-region"}
          className={`analysis-subnav-btn ${activeTab === "multi-region" ? "is-active" : ""}`}
          onClick={() => setActiveTab("multi-region")}
          type="button"
        >
          <Icon name="award" size={14} />
          <span>Peringkat & Komparasi</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "gap"}
          className={`analysis-subnav-btn ${activeTab === "gap" ? "is-active" : ""}`}
          onClick={() => setActiveTab("gap")}
          type="button"
        >
          <Icon name="sliders" size={14} />
          <span>Kesenjangan (M-F)</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "growth"}
          className={`analysis-subnav-btn ${activeTab === "growth" ? "is-active" : ""}`}
          onClick={() => setActiveTab("growth")}
          type="button"
        >
          <Icon name="trending-up" size={14} />
          <span>Pertumbuhan</span>
        </button>
      </div>

      {/* ================= TAB 1: TREN WILAYAH ================= */}
      {activeTab === "trend" && (
        <div className="analysis-tab-content">
          <div className="analysis-period-summary" aria-label="Periode dan jumlah tes Ookla terbaru">
            <div className="analysis-period-main">
              <span>DATA TERBARU DI ARSIP</span>
              <strong>{latestPeriod}</strong>
            </div>
            <div className="analysis-period-tests">
              <span>JUMLAH TES · {regionLabel}</span>
              <div className="analysis-test-counts">
                <div><span>Mobile</span><strong>{formatNumber(latestMobileTests)}</strong></div>
                <div><span>Fixed</span><strong>{formatNumber(latestFixedTests)}</strong></div>
              </div>
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
                {Object.entries(metricLabels).map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
              </select>
            </label>
          </div>
          <div aria-label="Pengelompokan periode" className="analysis-period-toggle" role="group">
            <button aria-pressed={periodMode === "year"} className={periodMode === "year" ? "is-active" : ""} onClick={() => setPeriodMode("year")} type="button">Tahunan</button>
            <button aria-pressed={periodMode === "quarter"} className={periodMode === "quarter" ? "is-active" : ""} onClick={() => setPeriodMode("quarter")} type="button">Kuartalan</button>
          </div>
          <div className="analysis-chart-wrap">
            <div className="analysis-chart-heading">
              <strong>{chartMode === "performance" ? `Tren ${metricLabels[metric].toLocaleLowerCase("id-ID")}` : "Volume tes Ookla"}</strong>
              <span>{chartMode === "performance" ? metric === "latency" ? "ms" : "Mbps" : "juta tes"}</span>
            </div>
            <div aria-label="Jenis grafik" className="analysis-visual-toggle" role="group">
              <button aria-pressed={chartMode === "performance"} className={chartMode === "performance" ? "is-active" : ""} onClick={() => setChartMode("performance")} type="button">Performa</button>
              <button aria-pressed={chartMode === "tests"} className={chartMode === "tests" ? "is-active" : ""} onClick={() => setChartMode("tests")} type="button">Volume tes</button>
            </div>
            <svg
              aria-label={chartMode === "performance"
                ? `Tren ${metricLabels[metric]} untuk mobile dan fixed, wilayah ${regionLabel}`
                : `Jumlah tes Mobile dan Fixed berdasarkan periode, wilayah ${regionLabel}`}
              className="analysis-chart"
              role="img"
              viewBox="0 0 640 250"
            >
              <line className="analysis-grid-line" x1="42" x2="608" y1="18" y2="18" />
              <line className="analysis-grid-line" x1="42" x2="608" y1="198" y2="198" />
              <text className="analysis-axis-label" textAnchor="end" x="37" y="22">{chartMode === "performance" ? formatValue(maximum, metric) : formatTestsAxis(maximumTests)}</text>
              <text className="analysis-axis-label" textAnchor="end" x="37" y="202">{chartMode === "performance" ? formatValue(minimum, metric) : "0"}</text>
              {chartMode === "performance" ? (["mobile", "fixed"] as const).map((type) => (
                <polyline className={`analysis-line is-${type}`} key={type} points={lineFor(type)} />
              )) : rows.map((row, index) => {
                const x = xFor(index);
                return (["mobile", "fixed"] as const).map((type, seriesIndex) => {
                  const tests = row[type]?.tests ?? 0;
                  if (!tests || !maximumTests) return null;
                  const y = chartY(tests, 0, maximumTests);
                  return (
                    <rect
                      className={`analysis-volume-bar is-${type}`}
                      height={198 - y}
                      key={`${row.key}-${type}`}
                      rx="2"
                      width={testBarWidth}
                      x={x + (seriesIndex === 0 ? -testBarWidth - 1 : 1)}
                      y={y}
                    >
                      <title>{`${row.label} · ${type === "mobile" ? "Mobile" : "Fixed"}: ${formatNumber(tests)} tes`}</title>
                    </rect>
                  );
                });
              })}
              {rows.map((row, index) => {
                const showTick = periodMode === "year" || row.quarter === 1 || index === rows.length - 1;
                return (
                  <g key={row.key}>
                    {chartMode === "performance" && (["mobile", "fixed"] as const).map((type) => {
                      const val = row[type] ? metricValue(row[type], metric) : null;
                      if (val === null) return null;
                      return (
                        <circle className={`analysis-point is-${type}`} key={type} r="3.5" cx={xFor(index)} cy={chartY(val, minimum, maximum)}>
                          <title>{`${row.label} · ${type === "mobile" ? "Mobile" : "Fixed"}: ${formatValue(val, metric)}`}</title>
                        </circle>
                      );
                    })}
                    {showTick && <text className="analysis-x-label" textAnchor="middle" x={xFor(index)} y="222">{periodMode === "year" ? row.label : `Q${row.quarter} '${String(row.year).slice(-2)}`}</text>}
                  </g>
                );
              })}
              <text className="analysis-x-label" textAnchor="middle" x="325" y="244">Periode data</text>
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
          <div aria-label="Ekspor statistik" className="analysis-statistics-export">
            <span>EKSPOR STATISTIK</span>
            <div>
              <button aria-label="Ekspor statistik CSV" className="map-export-button" onClick={handleStatisticsCsvExport} type="button">CSV</button>
              <button aria-label="Ekspor statistik PNG" className="map-export-button" onClick={() => void handleStatisticsImageExport("png")} type="button">PNG</button>
              <button aria-label="Ekspor statistik JPEG" className="map-export-button" onClick={() => void handleStatisticsImageExport("jpeg")} type="button">JPG</button>
              <button aria-label="Ekspor statistik PDF" className="map-export-button" onClick={handleStatisticsPdfExport} type="button">PDF</button>
            </div>
          </div>
          <p className="map-panel-caption">Batas wilayah memakai kotak koordinat dan titik tengah sel, bukan batas administrasi. Perbandingan dibobot jumlah tes; tahun berjalan hanya memakai kuartal yang tersedia.</p>
          <div className="map-section-heading analysis-table-heading">
            <span>PERBANDINGAN {periodMode === "year" ? "TAHUNAN" : "KUARTALAN"} · EKSPOR TABEL</span>
            <div aria-label="Ekspor tabel" className="analysis-export-actions">
              <button aria-label="Ekspor analisis CSV" className="map-export-button" onClick={() => downloadCsv(rows, metric, region, periodMode)} type="button">CSV</button>
              <button aria-label="Ekspor tabel PNG" className="map-export-button" onClick={() => void handleImageExport("png")} type="button">PNG</button>
              <button aria-label="Ekspor tabel JPEG" className="map-export-button" onClick={() => void handleImageExport("jpeg")} type="button">JPG</button>
              <button aria-label="Ekspor tabel PDF" className="map-export-button" onClick={handlePdfExport} type="button">PDF</button>
            </div>
          </div>
          {exportError && <p className="analysis-export-error" role="status">{exportError}</p>}
          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead>
                <tr><th>Periode</th><th>Mobile</th><th>Fixed</th><th>Selisih M−F</th></tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => {
                  const mob = r.mobile ? metricValue(r.mobile, metric) : null;
                  const fix = r.fixed ? metricValue(r.fixed, metric) : null;
                  return (
                    <tr key={r.key}>
                      <th scope="row">{r.label}</th>
                      <td>
                        {mob === null ? "—" : <><span>{formatValue(mob, metric)}</span><small>{formatNumber(r.mobile?.tests ?? 0)} tes</small></>}
                      </td>
                      <td>
                        {fix === null ? "—" : <><span>{formatValue(fix, metric)}</span><small>{formatNumber(r.fixed?.tests ?? 0)} tes</small></>}
                      </td>
                      <td>{mob === null || fix === null ? "—" : formatValue(mob - fix, metric)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="map-panel-footnote">Selisih = Mobile dikurangi Fixed. Data berasal dari arsip lokal Ookla, bukan pengukuran langsung.</p>
        </div>
      )}

      {/* ================= TAB 2: PERINGKAT & KOMPARASI MULTI-WILAYAH ================= */}
      {activeTab === "multi-region" && (
        <div className="analysis-tab-content">
          <div className="coverage-panel-filters analysis-filters">
            <label>
              <span>Periode</span>
              <select onChange={(e) => setMrPeriod(e.target.value)} value={mrPeriod}>
                {analysisData.periods.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Jaringan</span>
              <select onChange={(e) => setMrNetworkType(e.target.value as "mobile" | "fixed")} value={mrNetworkType}>
                <option value="mobile">Mobile</option>
                <option value="fixed">Fixed broadband</option>
              </select>
            </label>
            <label>
              <span>Metrik</span>
              <select onChange={(e) => setMrMetric(e.target.value as MapMetric)} value={mrMetric}>
                {Object.entries(metricLabels).map(([val, lbl]) => (
                  <option key={val} value={val}>{lbl}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="analysis-section-box">
            <div className="analysis-box-header">
              <div>
                <strong>Peringkat 8 Wilayah di Indonesia</strong>
                <p>Urutan performa terbaik berdasarkan data {analysisData.periods.find((p) => p.value === mrPeriod)?.label} ({mrNetworkType === "mobile" ? "Mobile" : "Fixed"})</p>
              </div>
              <button
                className="map-export-button"
                onClick={() =>
                  downloadLeaderboardCsv(
                    leaderboardItems,
                    mrMetric,
                    mrNetworkType,
                    analysisData.periods.find((p) => p.value === mrPeriod)?.label ?? mrPeriod
                  )
                }
                type="button"
              >
                <Icon name="download" size={13} /> Ekspor CSV
              </button>
            </div>

            <div className="leaderboard-list">
              {leaderboardItems.map((item) => {
                const isNational = item.regionValue === "indonesia-sekitarnya";
                const isPositiveDiff = mrMetric === "latency" ? item.diffVsBenchmark < 0 : item.diffVsBenchmark > 0;
                const ratioPct = Math.min(100, Math.max(10, (item.value / maxLeaderboardVal) * 100));
                const medal = item.rank === 1 ? "🥇" : item.rank === 2 ? "🥈" : item.rank === 3 ? "🥉" : `#${item.rank}`;

                return (
                  <div className={`leaderboard-card ${isNational ? "is-national" : ""}`} key={item.regionValue}>
                    <div className="leaderboard-card-rank">{medal}</div>
                    <div className="leaderboard-card-info">
                      <div className="leaderboard-name-row">
                        <strong>{item.regionLabel}</strong>
                        <span className="leaderboard-value">
                          {formatValue(item.value, mrMetric)}
                        </span>
                      </div>
                      <div className="leaderboard-bar-track">
                        <div
                          className="leaderboard-bar-fill"
                          style={{
                            width: `${ratioPct}%`,
                            background: regionColors[item.regionValue] || "#2563eb",
                          }}
                        />
                      </div>
                      <div className="leaderboard-meta-row">
                        <span>
                          {isNational ? (
                            "Tolok Ukur Rata-rata Nasional"
                          ) : (
                            <em className={isPositiveDiff ? "diff-positive" : "diff-negative"}>
                              {isPositiveDiff ? "+" : ""}
                              {mrMetric === "latency"
                                ? `${item.diffVsBenchmark.toFixed(1)} ms vs Nasional`
                                : `${(item.diffVsBenchmark / 1000).toFixed(1)} Mbps vs Nasional`}
                            </em>
                          )}
                        </span>
                        <small>{formatNumber(item.tests)} tes · {formatNumber(item.devices)} perangkat</small>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="analysis-chart-wrap" style={{ marginTop: "16px" }}>
            <div className="analysis-chart-heading">
              <strong>Grafik Komparasi Antar-Wilayah (2021–2026)</strong>
              <span>{mrMetric === "latency" ? "ms (lebih rendah lebih baik)" : "Mbps"}</span>
            </div>
            <p className="analysis-chip-hint">Pilih wilayah untuk ditampilkan di grafik komparasi:</p>
            <div className="analysis-chip-grid">
              {analysisData.regions.map((reg) => {
                const isActive = activeRegions.includes(reg.value);
                const color = regionColors[reg.value] || "#475569";
                return (
                  <button
                    key={reg.value}
                    type="button"
                    className={`analysis-region-chip ${isActive ? "is-active" : ""}`}
                    onClick={() => toggleRegionActive(reg.value)}
                    style={{ borderColor: isActive ? color : undefined }}
                  >
                    <span style={{ background: color }} />
                    <span>{reg.label.replace(" (perkiraan)", "")}</span>
                  </button>
                );
              })}
            </div>

            <svg
              className="analysis-chart"
              role="img"
              aria-label="Grafik komparasi multi-wilayah"
              viewBox="0 0 640 250"
            >
              <line className="analysis-grid-line" x1="42" x2="608" y1="18" y2="18" />
              <line className="analysis-grid-line" x1="42" x2="608" y1="198" y2="198" />
              <text className="analysis-axis-label" textAnchor="end" x="37" y="22">
                {formatValue(multiRegionTimeline.maxVal, mrMetric)}
              </text>
              <text className="analysis-axis-label" textAnchor="end" x="37" y="202">
                {formatValue(multiRegionTimeline.minVal, mrMetric)}
              </text>

              {multiRegionTimeline.series.map((s) => {
                const pointsStr = s.points
                  .map((v, idx) => {
                    if (v === null) return null;
                    const x = xFor(idx);
                    const y = chartY(v, multiRegionTimeline.minVal, multiRegionTimeline.maxVal);
                    return `${x},${y}`;
                  })
                  .filter((p): p is string => p !== null)
                  .join(" ");

                return (
                  <polyline
                    key={s.regionValue}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={pointsStr}
                  />
                );
              })}

              {multiRegionTimeline.periods.map((p, idx) => {
                const showTick = p.value.endsWith("-01-01") || idx === multiRegionTimeline.periods.length - 1;
                return showTick ? (
                  <text key={p.value} className="analysis-x-label" textAnchor="middle" x={xFor(idx)} y="222">
                    {p.label}
                  </text>
                ) : null;
              })}
              <text className="analysis-x-label" textAnchor="middle" x="325" y="244">Linimasa Kuartalan</text>
            </svg>
          </div>
        </div>
      )}

      {/* ================= TAB 3: KESENJANGAN (CONVERGENCE GAP) ================= */}
      {activeTab === "gap" && (
        <div className="analysis-tab-content">
          <div className="coverage-panel-filters analysis-filters">
            <label>
              <span>Periode analisis kesenjangan</span>
              <select onChange={(e) => setGapPeriod(e.target.value)} value={gapPeriod}>
                {analysisData.periods.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="gap-kpi-grid">
            <div className="gap-kpi-card">
              <span>RASIO UNDUH NASIONAL</span>
              <strong>{convergenceData.national ? `${convergenceData.national.ratio.toFixed(1)}x` : "—"}</strong>
              <small>Fixed Broadband vs Mobile di Indonesia</small>
            </div>
            <div className="gap-kpi-card">
              <span>DISPARITAS LATENSI</span>
              <strong>{convergenceData.national ? `+${convergenceData.national.latencyDiff.toFixed(1)} ms` : "—"}</strong>
              <small>Mobile lebih lambat vs Fixed</small>
            </div>
            <div className="gap-kpi-card">
              <span>WILAYAH PALING TIMPANG</span>
              <strong>{convergenceData.highestGap?.regionLabel.replace(" (perkiraan)", "")}</strong>
              <small>Rasio Fixed/Mobile: {convergenceData.highestGap?.ratio.toFixed(1)}x</small>
            </div>
            <div className="gap-kpi-card">
              <span>WILAYAH PALING BERIMBANG</span>
              <strong>{convergenceData.lowestGap?.regionLabel.replace(" (perkiraan)", "")}</strong>
              <small>Rasio Fixed/Mobile: {convergenceData.lowestGap?.ratio.toFixed(1)}x</small>
            </div>
          </div>

          <div className="map-section-heading analysis-table-heading" style={{ marginTop: "18px" }}>
            <span>TABEL KESENJANGAN 8 WILAYAH · {convergenceData.periodLabel}</span>
            <button
              className="map-export-button"
              onClick={() => downloadConvergenceCsv(convergenceData.items, convergenceData.periodLabel)}
              type="button"
            >
              <Icon name="download" size={13} /> Ekspor CSV
            </button>
          </div>

          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>Wilayah</th>
                  <th>Mobile</th>
                  <th>Fixed</th>
                  <th>Rasio Unduh</th>
                  <th>Latensi M / F</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {convergenceData.items.map((item) => (
                  <tr key={item.regionValue}>
                    <th scope="row"><strong>{item.regionLabel}</strong></th>
                    <td>{(item.mobileDownload / 1000).toFixed(1)} Mbps</td>
                    <td>{(item.fixedDownload / 1000).toFixed(1)} Mbps</td>
                    <td><strong>{item.ratio.toFixed(1)}x</strong></td>
                    <td>{item.mobileLatency.toFixed(0)} ms / {item.fixedLatency.toFixed(0)} ms</td>
                    <td>
                      <span
                        className="gap-status-pill"
                        style={{ color: item.statusColor, background: item.statusBg }}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="map-panel-footnote">Rasio Unduh = Kecepatan Fixed dibagi Mobile. Rasio tinggi menandakan disparitas besar antara infrastruktur kabel rumah dan jaringan seluler.</p>
        </div>
      )}

      {/* ================= TAB 4: PERTUMBUHAN (GROWTH) ================= */}
      {activeTab === "growth" && (
        <div className="analysis-tab-content">
          <div className="coverage-panel-filters analysis-filters">
            <label>
              <span>Jaringan</span>
              <select onChange={(e) => setGrowthNetworkType(e.target.value as "mobile" | "fixed")} value={growthNetworkType}>
                <option value="mobile">Mobile</option>
                <option value="fixed">Fixed broadband</option>
              </select>
            </label>
            <label>
              <span>Metrik Pertumbuhan</span>
              <select onChange={(e) => setGrowthMetric(e.target.value as MapMetric)} value={growthMetric}>
                {Object.entries(metricLabels).map(([val, lbl]) => (
                  <option key={val} value={val}>{lbl}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="gap-kpi-grid">
            <div className="gap-kpi-card">
              <span>PERTUMBUHAN NASIONAL (YoY)</span>
              <strong>
                {growthData.national?.yoyPct !== null && growthData.national?.yoyPct !== undefined
                  ? `${growthData.national.yoyPct > 0 ? "+" : ""}${growthData.national.yoyPct.toFixed(1)}%`
                  : "—"}
              </strong>
              <small>{growthData.priorYoYLabel} → {growthData.latestLabel}</small>
            </div>
            <div className="gap-kpi-card">
              <span>AKSELERASI TERTINGGI (YoY)</span>
              <strong>{growthData.topGainer?.regionLabel.replace(" (perkiraan)", "")}</strong>
              <small>
                {growthData.topGainer?.yoyPct !== null && growthData.topGainer?.yoyPct !== undefined
                  ? `Peningkatan ${growthData.topGainer.yoyPct > 0 ? "+" : ""}${growthData.topGainer.yoyPct.toFixed(1)}% YoY`
                  : "—"}
              </small>
            </div>
          </div>

          <div className="map-section-heading analysis-table-heading" style={{ marginTop: "18px" }}>
            <span>PERINGKAT AKSELERASI & PERTUMBUHAN WILAYAH</span>
            <button
              className="map-export-button"
              onClick={() => downloadGrowthCsv(growthData.items, growthMetric, growthNetworkType)}
              type="button"
            >
              <Icon name="download" size={13} /> Ekspor CSV
            </button>
          </div>

          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Wilayah</th>
                  <th>Nilai Terkini</th>
                  <th>1 Thn Lalu</th>
                  <th>YoY (%)</th>
                  <th>QoQ (%)</th>
                  <th>5 Tahun (%)</th>
                </tr>
              </thead>
              <tbody>
                {growthData.items.map((item) => {
                  const yoyPositive = item.yoyPct !== null && item.yoyPct > 0;
                  const qoqPositive = item.qoqPct !== null && item.qoqPct > 0;
                  const fivePositive = item.fiveYearPct !== null && item.fiveYearPct > 0;

                  return (
                    <tr key={item.regionValue}>
                      <td>#{item.rank}</td>
                      <th scope="row"><strong>{item.regionLabel}</strong></th>
                      <td>{formatValue(item.currentValue, growthMetric)}</td>
                      <td>{item.priorYoYValue !== null ? formatValue(item.priorYoYValue, growthMetric) : "—"}</td>
                      <td>
                        {item.yoyPct !== null ? (
                          <span className={`growth-badge ${yoyPositive ? "is-pos" : "is-neg"}`}>
                            {yoyPositive ? "+" : ""}{item.yoyPct.toFixed(1)}%
                          </span>
                        ) : "—"}
                      </td>
                      <td>
                        {item.qoqPct !== null ? (
                          <span className={`growth-badge ${qoqPositive ? "is-pos" : "is-neg"}`}>
                            {qoqPositive ? "+" : ""}{item.qoqPct.toFixed(1)}%
                          </span>
                        ) : "—"}
                      </td>
                      <td>
                        {item.fiveYearPct !== null ? (
                          <span className={`growth-badge ${fivePositive ? "is-pos" : "is-neg"}`}>
                            {fivePositive ? "+" : ""}{item.fiveYearPct.toFixed(1)}%
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="map-panel-footnote">YoY = Pertumbuhan dibandingkan kuartal yang sama tahun lalu. 5 Tahun = Total ekspansi sejak Q4 2021 hingga {growthData.latestLabel}.</p>
        </div>
      )}
    </div>
  );
}
