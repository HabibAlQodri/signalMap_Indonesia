"use client";

import { useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import analysisData from "../lib/ookla-analysis.json";
import { formatNumber } from "../lib/network-data";
import type { MapMetric } from "./mapview";

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
  return 18 + ((maximum - value) / span) * 180;
}

export default function AnalysisPanel() {
  const [metric, setMetric] = useState<MapMetric>("download");
  const [region, setRegion] = useState("indonesia-sekitarnya");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("year");
  const [chartMode, setChartMode] = useState<ChartMode>("performance");
  const [exportError, setExportError] = useState("");

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

  return (
    <div className="map-panel-body analysis-panel">
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
                  const value = row[type] ? metricValue(row[type], metric) : null;
                  if (value === null) return null;
                  return (
                    <circle className={`analysis-point is-${type}`} key={type} r="3.5" cx={xFor(index)} cy={chartY(value, minimum, maximum)}>
                      <title>{`${row.label} · ${type === "mobile" ? "Mobile" : "Fixed"}: ${formatValue(value, metric)}`}</title>
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
