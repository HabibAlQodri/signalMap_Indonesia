"use client";

import { useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import analysisData from "../../lib/ookla/ookla-analysis.json";
import { formatNumber } from "../../lib/network-data";
import type { MapMetric } from "../map/mapview";
import Icon from "../ui/icon";
import { useLanguage } from "../../lib/i18n";
import { trainIsolationForest, type IFPoint } from "../../lib/anomaly/isolation-forest";

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

function formatValue(value: number, metric: MapMetric, locale = "id-ID") {
  const formatted = metric === "latency"
    ? value.toLocaleString(locale, { maximumFractionDigits: 1 })
    : (value / 1000).toLocaleString(locale, { maximumFractionDigits: 1 });
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

type AnalysisTab = "ranking" | "gap" | "disparity";

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
  jabodetabek: "#0284c7",
  "surabaya-gerbangkertosusila": "#4f46e5",
  "medan-sumut": "#0d9488",
  bali: "#ea580c",
  "ikn-kalimantan-timur": "#10b981",
  "makassar-sulsel": "#8b5cf6",
};
const analysisYears = [...new Set(analysisData.entries.map((entry) => entry.year))].sort((a, b) => a - b);

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
  periodLabel: string
) {
  const metricUnit = metric === "latency" ? "ms" : "Mbps";
  const content = [
    ["Peringkat Performa Wilayah Ookla"],
    ["Periode", periodLabel],
    ["Metrik", `${metricLabels[metric]} (${metricUnit})`],
    [],
    ["Peringkat", "Wilayah", `Nilai (${metricUnit})`, `Selisih vs Indonesia (${metricUnit})`, "Jumlah Tes", "Jumlah Perangkat"],
    ...items.map((item) => [
      item.rank,
      item.regionLabel,
      metric === "latency" ? item.value.toFixed(1) : (item.value / 1000).toFixed(2),
      metric === "latency" ? item.diffVsBenchmark.toFixed(1) : (item.diffVsBenchmark / 1000).toFixed(2),
      item.tests,
      item.devices,
    ]),
  ].map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadBlob(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }), `ookla-peringkat-${metric}.csv`);
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

export default function AnalysisPanel({ visualizationOnly = false }: { visualizationOnly?: boolean }) {
  const { t, locale } = useLanguage();
  const numberLocale = locale === "en" ? "en-US" : "id-ID";
  const [activeTab, setActiveTab] = useState<AnalysisTab>("ranking");

  // Tab 1: Tren Wilayah
  const [metric, setMetric] = useState<MapMetric>("download");
  const [region, setRegion] = useState("indonesia-sekitarnya");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("year");
  const [selectedYear, setSelectedYear] = useState("all");
  const [selectedQuarter, setSelectedQuarter] = useState("all");
  const [chartMode, setChartMode] = useState<ChartMode>("performance");
  const [exportError, setExportError] = useState("");

  // Tab 2: Peringkat & Komparasi
  const [rankingMetric, setRankingMetric] = useState<MapMetric>("download");
  const [rankingNetworkType, setRankingNetworkType] = useState<"mobile" | "fixed">("mobile");
  const [rankingPeriod, setRankingPeriod] = useState(analysisData.latestPeriod);
  const [activeRegions, setActiveRegions] = useState<string[]>(analysisData.regions.map((item) => item.value));

  // Tab 3: Kesenjangan Mobile vs Fixed
  const [gapPeriod, setGapPeriod] = useState(analysisData.latestPeriod);

  // Tab 4 (Baru): Kesenjangan Digital & Indeks Gini
  const [disparityNetworkType, setDisparityNetworkType] = useState<"mobile" | "fixed">("mobile");
  const [disparityMetric, setDisparityMetric] = useState<MapMetric>("download");

  // Visualisasi
  const [visMetric, setVisMetric] = useState<MapMetric>("download");
  const [visNetworkType, setVisNetworkType] = useState<"mobile" | "fixed">("mobile");
  const [visTab, setVisTab] = useState<"trend" | "compare" | "quadrant" | "radar" | "anomaly">("compare");
  const [mlSelectedRegions, setMlSelectedRegions] = useState<string[]>(
    analysisData.regions.map((r) => r.value)
  );
  const [anomalyNetworkType, setAnomalyNetworkType] = useState<"mobile" | "fixed">("mobile");

  // Visualisasi: Matriks Kuadran
  const [quadrantPeriod, setQuadrantPeriod] = useState(analysisData.latestPeriod);
  const [quadrantNetworkType, setQuadrantNetworkType] = useState<"mobile" | "fixed">("mobile");

  // Visualisasi: Radar Multi-Dimensi
  const [radarPrimaryRegion, setRadarPrimaryRegion] = useState("jawa");
  const [radarBenchmarkRegion, setRadarBenchmarkRegion] = useState("indonesia-sekitarnya");
  const [radarPeriod, setRadarPeriod] = useState(analysisData.latestPeriod);
  const [radarNetworkType, setRadarNetworkType] = useState<"mobile" | "fixed">("mobile");

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
      if (selectedYear !== "all" && entry.year !== Number(selectedYear)) continue;
      if (periodMode === "quarter" && selectedQuarter !== "all" && entry.quarter !== Number(selectedQuarter)) continue;
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
  }, [periodMode, region, selectedQuarter, selectedYear]);

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
  const formatTestsAxis = (tests: number) => `${(tests / 1_000_000).toLocaleString(numberLocale, { maximumFractionDigits: 1 })} ${locale === "en" ? "M" : "jt"}`;
  const lineFor = (type: "mobile" | "fixed") => rows
    .map((row, index) => {
      const value = row[type] ? metricValue(row[type], metric) : null;
      return value === null ? null : `${xFor(index)},${chartY(value, minimum, maximum)}`;
    })
    .filter((point): point is string => point !== null)
    .join(" ");

  const regionLabel = analysisData.regions.find((item) => item.value === region)?.label ?? region;
  const latestTrendRow = rows[rows.length - 1];
  const previousTrendRow = rows[rows.length - 2];
  const latestPeriod = latestTrendRow?.label ?? "—";
  const latestMobileTests = latestTrendRow?.mobile?.tests ?? 0;
  const latestFixedTests = latestTrendRow?.fixed?.tests ?? 0;
  const latestMobile = latestTrendRow?.mobile ? metricValue(latestTrendRow.mobile, metric) : null;
  const previousMobile = previousTrendRow?.mobile ? metricValue(previousTrendRow.mobile, metric) : null;
  const periodChange = latestMobile !== null && previousMobile !== null && previousMobile !== 0
    ? ((latestMobile - previousMobile) / previousMobile) * 100
    : null;
  const changeLabel = previousTrendRow
    ? `${previousTrendRow.label} → ${latestPeriod}`
    : "Belum ada periode pembanding";

  async function handleStatisticsImageExport(format: "png" | "jpeg") {
    setExportError("");
    try {
      await exportStatisticsImage(
        rows, metric, regionLabel, periodMode, chartMode, latestPeriod,
        latestMobileTests, latestFixedTests, periodChange, changeLabel, format,
      );
    } catch (error) {
      setExportError(t(error instanceof Error ? error.message : "Gambar statistik gagal diekspor."));
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
      setExportError(t(error instanceof Error ? error.message : "CSV statistik gagal diekspor."));
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
      setExportError(t(error instanceof Error ? error.message : "PDF statistik gagal diekspor."));
    }
  }

  async function handleImageExport(format: "png" | "jpeg") {
    setExportError("");
    try {
      await exportTableImage(rows, metric, regionLabel, periodMode, format);
    } catch (error) {
      setExportError(t(error instanceof Error ? error.message : "Gambar tabel gagal diekspor."));
    }
  }

  function handlePdfExport() {
    setExportError("");
    try {
      exportTablePdf(rows, metric, regionLabel, periodMode);
    } catch (error) {
      setExportError(t(error instanceof Error ? error.message : "PDF tabel gagal diekspor."));
    }
  }

  const rankingItems = useMemo(() => {
    const periodEntries = analysisData.entries.filter(
      (entry) => entry.period === rankingPeriod && entry.networkType === rankingNetworkType
    );
    const indonesia = periodEntries.find((entry) => entry.region === "indonesia-sekitarnya");
    const benchmarkValue = indonesia ? metricValue(indonesia, rankingMetric) : 0;
    const items = periodEntries.map((entry) => {
      const regionInfo = analysisData.regions.find((item) => item.value === entry.region);
      return {
        regionValue: entry.region,
        regionLabel: regionInfo?.label ?? entry.region,
        value: metricValue(entry, rankingMetric),
        diffVsBenchmark: metricValue(entry, rankingMetric) - benchmarkValue,
        tests: entry.tests,
        devices: entry.devices,
      };
    });
    items.sort((a, b) => rankingMetric === "latency" ? a.value - b.value : b.value - a.value);
    return items.map((item, index) => ({ ...item, rank: index + 1 }));
  }, [rankingMetric, rankingNetworkType, rankingPeriod]);

  const indonesiaRankingData = rankingItems.find((item) => item.regionValue === "indonesia-sekitarnya");

  const regionalComparison = useMemo(() => {
    const periods = [...analysisData.periods].reverse();
    const series = analysisData.regions
      .filter((item) => activeRegions.includes(item.value))
      .map((item) => ({
        value: item.value,
        label: item.label.replace(" (perkiraan)", ""),
        color: regionColors[item.value] ?? "#475569",
        points: periods.map((period) => {
          const entry = analysisData.entries.find(
            (candidate) => candidate.region === item.value &&
              candidate.period === period.value &&
              candidate.networkType === rankingNetworkType
          );
          return entry ? metricValue(entry, rankingMetric) : null;
        }),
      }));
    const values = series.flatMap((item) => item.points.filter((value): value is number => value !== null));
    return {
      periods,
      series,
      minimum: values.length ? Math.min(...values) : 0,
      maximum: values.length ? Math.max(...values) : 1,
    };
  }, [activeRegions, rankingMetric, rankingNetworkType]);

  function toggleRankingRegion(value: string) {
    setActiveRegions((current) =>
      current.includes(value)
        ? current.length > 1 ? current.filter((regionValue) => regionValue !== value) : current
        : [...current, value]
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

    return { periodLabel, items, national, highestGap, lowestGap };
  }, [gapPeriod]);

  // --- Logic Visualisasi: Pertumbuhan YoY, QoQ, dan 5 Tahun ---
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
        const e = analysisData.entries.find((entry) => entry.region === reg.value && entry.period === p && entry.networkType === visNetworkType);
        return e ? metricValue(e, visMetric) : null;
      };

      const currVal = getVal(latest) ?? 0;
      const priorYoY = getVal(yoyPrior);
      const priorQoQ = getVal(qoqPrior);
      const earliestVal = getVal(earliest);

      const calcPct = (curr: number, prev: number | null) => {
        if (prev === null || prev <= 0) return null;
        if (visMetric === "latency") {
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
  }, [visNetworkType, visMetric]);

  // ─── Isolation Forest: deteksi anomali per wilayah per periode ───────────
  const anomalyResults = useMemo(() => {
    const allPeriods = analysisData.periods.map((p) => p.value);

    type AnomalyEntry = {
      region: string;
      regionLabel: string;
      period: string;
      periodLabel: string;
      download: number;
      upload: number;
      latency: number;
      qoqDeltaDownload: number | null;
      yoyDeltaDownload: number | null;
    };

    // 1. Kumpulkan time-series per wilayah
    const seriesByRegion = new Map<string, { period: string; download: number; upload: number; latency: number }[]>();
    for (const reg of analysisData.regions) {
      const pts = allPeriods.map((p) => {
        const e = analysisData.entries.find(
          (en) => en.region === reg.value && en.period === p && en.networkType === anomalyNetworkType,
        );
        return e ? { period: p, download: e.avgDownloadKbps, upload: e.avgUploadKbps, latency: e.avgLatencyMs } : null;
      }).filter((x): x is NonNullable<typeof x> => x !== null);
      seriesByRegion.set(reg.value, pts);
    }

    // 2. Bangun fitur multi-dimensi: [download, upload, latency, qoqDelta%, yoyDelta%]
    const featureRows: AnomalyEntry[] = [];
    for (const reg of analysisData.regions) {
      const series = seriesByRegion.get(reg.value) ?? [];
      series.forEach((pt, idx) => {
        const prevQ = idx > 0 ? series[idx - 1] : null;
        const prevY = series.find((s) => {
          // sama kuartal, 1 tahun lebih awal
          const ptDate = new Date(pt.period);
          const sDate = new Date(s.period);
          return (
            Math.abs(ptDate.getFullYear() - sDate.getFullYear()) === 1 &&
            ptDate.getMonth() === sDate.getMonth()
          );
        }) ?? null;

        const qoqDelta = prevQ && prevQ.download > 0
          ? ((pt.download - prevQ.download) / prevQ.download) * 100
          : null;
        const yoyDelta = prevY && prevY.download > 0
          ? ((pt.download - prevY.download) / prevY.download) * 100
          : null;

        featureRows.push({
          region: reg.value,
          regionLabel: reg.label.replace(" (perkiraan)", ""),
          period: pt.period,
          periodLabel: analysisData.periods.find((p) => p.value === pt.period)?.label ?? pt.period,
          download: pt.download,
          upload: pt.upload,
          latency: pt.latency,
          qoqDeltaDownload: qoqDelta,
          yoyDeltaDownload: yoyDelta,
        });
      });
    }

    if (featureRows.length < 4) return [];

    // 3. Normalisasi fitur ke [0,1] agar skala tidak bias
    const fields: (keyof Pick<AnomalyEntry, "download" | "upload" | "latency">)[] = ["download", "upload", "latency"];
    const mins = { download: Infinity, upload: Infinity, latency: Infinity };
    const maxs = { download: -Infinity, upload: -Infinity, latency: -Infinity };
    for (const r of featureRows) {
      for (const f of fields) {
        if (r[f] < mins[f]) mins[f] = r[f];
        if (r[f] > maxs[f]) maxs[f] = r[f];
      }
    }
    const norm = (v: number, f: keyof typeof mins) => {
      const range = maxs[f] - mins[f];
      return range === 0 ? 0 : (v - mins[f]) / range;
    };

    const trainingPoints: IFPoint[] = featureRows.map((r) => [
      norm(r.download, "download"),
      norm(r.upload, "upload"),
      norm(r.latency, "latency"),
      (r.qoqDeltaDownload ?? 0) / 100,
      (r.yoyDeltaDownload ?? 0) / 100,
    ]);

    // 4. Latih model dan skor tiap titik
    const forest = trainIsolationForest(trainingPoints, 120, 256);

    return featureRows.map((r, i) => {
      const result = forest.score(trainingPoints[i]);
      return { ...r, ...result };
    })
      .filter((r) => r.isAnomaly)
      .sort((a, b) => b.score - a.score);
  }, [anomalyNetworkType]);

  // ─── 4-Quadrant Matrix (Speed vs Latency) ─────────────────────────────────
  const quadrantData = useMemo(() => {
    const periodLabel = analysisData.periods.find((p) => p.value === quadrantPeriod)?.label ?? quadrantPeriod;
    const entries = analysisData.entries.filter(
      (e) => e.period === quadrantPeriod && e.networkType === quadrantNetworkType
    );
    const valid = entries
      .filter((e) => e.region !== "indonesia-sekitarnya")
      .map((e) => {
        const reg = analysisData.regions.find((r) => r.value === e.region);
        return {
          region: e.region,
          label: reg?.label.replace(" (perkiraan)", "") ?? e.region,
          downloadMbps: e.avgDownloadKbps / 1000,
          latencyMs: e.avgLatencyMs,
          tests: e.tests,
          devices: e.devices,
          color: regionColors[e.region] ?? "#475569",
        };
      });

    if (valid.length === 0) return null;

    const downloads = valid.map((v) => v.downloadMbps).sort((a, b) => a - b);
    const latencies = valid.map((v) => v.latencyMs).sort((a, b) => a - b);
    const medianDown = downloads[Math.floor(downloads.length / 2)] ?? 10;
    const medianLat = latencies[Math.floor(latencies.length / 2)] ?? 20;

    const minDown = 0;
    const maxDown = Math.max(10, ...downloads) * 1.15;
    const minLat = Math.max(0, Math.min(...latencies) * 0.75);
    const maxLat = Math.max(25, ...latencies) * 1.15;

    const classified = valid.map((v) => {
      const isFast = v.downloadMbps >= medianDown;
      const isResponsive = v.latencyMs <= medianLat; // Latensi lebih rendah = lebih baik
      let quadrant: "leader" | "accelerator" | "responsive" | "developing";
      let quadrantName: string;
      if (isFast && isResponsive) {
        quadrant = "leader";
        quadrantName = "Pemimpin Digital";
      } else if (isFast && !isResponsive) {
        quadrant = "accelerator";
        quadrantName = "Akselerator Throughput";
      } else if (!isFast && isResponsive) {
        quadrant = "responsive";
        quadrantName = "Responsif & Stabil";
      } else {
        quadrant = "developing";
        quadrantName = "Butuh Akselerasi";
      }
      return { ...v, quadrant, quadrantName };
    });
    const counts = { leader: 0, accelerator: 0, responsive: 0, developing: 0 };
    classified.forEach((item) => {
      counts[item.quadrant] += 1;
    });

    return {
      periodLabel,
      medianDown,
      medianLat,
      minDown,
      maxDown,
      minLat,
      maxLat,
      regionCount: valid.length,
      counts,
      items: classified,
    };
  }, [quadrantPeriod, quadrantNetworkType]);

  // ─── Radar / Spider Chart Multi-Dimensi ────────────────────────────────────
  const radarData = useMemo(() => {
    const periodLabel = analysisData.periods.find((p) => p.value === radarPeriod)?.label ?? radarPeriod;
    const primaryEntry = analysisData.entries.find(
      (e) => e.period === radarPeriod && e.networkType === radarNetworkType && e.region === radarPrimaryRegion
    );
    const benchEntry = analysisData.entries.find(
      (e) => e.period === radarPeriod && e.networkType === radarNetworkType && e.region === radarBenchmarkRegion
    );

    const primaryReg = analysisData.regions.find((r) => r.value === radarPrimaryRegion);
    const benchReg = analysisData.regions.find((r) => r.value === radarBenchmarkRegion);

    const allPeriodEntries = analysisData.entries.filter(
      (e) => e.period === radarPeriod && e.networkType === radarNetworkType
    );
    const maxDown = Math.max(10, ...allPeriodEntries.map((e) => e.avgDownloadKbps / 1000));
    const maxUp = Math.max(5, ...allPeriodEntries.map((e) => e.avgUploadKbps / 1000));
    const maxLat = Math.max(20, ...allPeriodEntries.map((e) => e.avgLatencyMs));
    const maxTests = Math.max(1000, ...allPeriodEntries.map((e) => e.tests));

    const computeScores = (e: typeof primaryEntry) => {
      if (!e) return { download: 0, upload: 0, latency: 0, stability: 0, penetration: 0, raw: null };
      const downMbps = e.avgDownloadKbps / 1000;
      const upMbps = e.avgUploadKbps / 1000;
      const latMs = e.avgLatencyMs;
      const bufMs = Math.max(0, (e.avgLatencyDownMs ?? latMs) - latMs);

      const sDown = Math.min(100, Math.round((downMbps / maxDown) * 100));
      const sUp = Math.min(100, Math.round((upMbps / maxUp) * 100));
      const sLat = Math.max(10, Math.min(100, Math.round((1 - (latMs / (maxLat * 1.25))) * 100)));
      const sStab = Math.max(10, Math.min(100, Math.round(100 - Math.min(85, bufMs * 0.2))));
      const sPen = Math.min(100, Math.round((Math.log10(Math.max(10, e.tests)) / Math.log10(Math.max(100, maxTests))) * 100));

      const typedE = e as unknown as { qoeOverall?: number; qoeStreaming?: number; qoeGaming?: number; qoeWork?: number };

      return {
        download: sDown,
        upload: sUp,
        latency: sLat,
        stability: sStab,
        penetration: sPen,
        raw: {
          downMbps,
          upMbps,
          latMs,
          bufMs,
          tests: e.tests,
          qoeOverall: typedE.qoeOverall ?? 75,
          qoeStreaming: typedE.qoeStreaming ?? 70,
          qoeGaming: typedE.qoeGaming ?? 65,
          qoeWork: typedE.qoeWork ?? 72,
        },
      };
    };

    const primaryScores = computeScores(primaryEntry);
    const benchScores = computeScores(benchEntry);

    const axes = [
      { key: "download" as const, label: "Kecepatan Unduh", angle: -Math.PI / 2 },
      { key: "upload" as const, label: "Kecepatan Unggah", angle: -Math.PI / 2 + (2 * Math.PI) / 5 },
      { key: "penetration" as const, label: "Penetrasi Tes", angle: -Math.PI / 2 + (4 * Math.PI) / 5 },
      { key: "stability" as const, label: "Kontrol Bufferbloat", angle: -Math.PI / 2 + (6 * Math.PI) / 5 },
      { key: "latency" as const, label: "Responsivitas Ping", angle: -Math.PI / 2 + (8 * Math.PI) / 5 },
    ];

    const cx = 220;
    const cy = 150;
    const r = 108;

    const getPolyPoints = (scores: { download: number; upload: number; latency: number; stability: number; penetration: number }) => {
      return axes
        .map((axis) => {
          const val = (scores[axis.key] ?? 50) / 100;
          const px = cx + r * val * Math.cos(axis.angle);
          const py = cy + r * val * Math.sin(axis.angle);
          return `${px.toFixed(1)},${py.toFixed(1)}`;
        })
        .join(" ");
    };

    return {
      periodLabel,
      primaryLabel: primaryReg?.label.replace(" (perkiraan)", "") ?? radarPrimaryRegion,
      primaryColor: regionColors[radarPrimaryRegion] ?? "#2563eb",
      benchLabel: benchReg?.label.replace(" (perkiraan)", "") ?? radarBenchmarkRegion,
      benchColor: regionColors[radarBenchmarkRegion] ?? "#64748b",
      axes,
      cx,
      cy,
      r,
      primaryPoints: getPolyPoints(primaryScores),
      benchPoints: getPolyPoints(benchScores),
      primaryScores,
      benchScores,
    };
  }, [radarPeriod, radarNetworkType, radarPrimaryRegion, radarBenchmarkRegion]);

  // ─── Disparitas Antar-Wilayah & Tren Gini 5 Tahun ─────────────────────────
  const disparityData = useMemo(() => {
    const majorRegions = analysisData.regions.filter((r) => r.value !== "indonesia-sekitarnya");
    const periodsAsc = [...analysisData.periods].reverse();

    const timeline = periodsAsc.map((p) => {
      const vals = majorRegions
        .map((r) => {
          const e = analysisData.entries.find(
            (entry) => entry.period === p.value && entry.networkType === disparityNetworkType && entry.region === r.value
          );
          if (!e) return null;
          return disparityMetric === "download"
            ? e.avgDownloadKbps / 1000
            : disparityMetric === "upload"
            ? e.avgUploadKbps / 1000
            : e.avgLatencyMs;
        })
        .filter((v): v is number => v !== null && v > 0);

      if (vals.length < 2) return { period: p.value, label: p.label, gini: 0, max: 0, min: 0, ratio: 1 };

      const n = vals.length;
      const mean = vals.reduce((a, b) => a + b, 0) / n;
      let sumDiff = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          sumDiff += Math.abs(vals[i] - vals[j]);
        }
      }
      const gini = sumDiff / (2 * n * n * mean);
      const maxVal = Math.max(...vals);
      const minVal = Math.min(...vals);
      const ratio = minVal > 0 ? maxVal / minVal : 1;

      return {
        period: p.value,
        label: p.label,
        gini: Math.round(gini * 1000) / 1000,
        max: maxVal,
        min: minVal,
        ratio: Math.round(ratio * 10) / 10,
      };
    });

    const latestItem = timeline[timeline.length - 1];
    const initialItem = timeline[0];
    const giniChange = initialItem && latestItem && initialItem.gini > 0
      ? ((latestItem.gini - initialItem.gini) / initialItem.gini) * 100
      : 0;

    return {
      timeline,
      latestItem,
      initialItem,
      giniChange,
    };
  }, [disparityNetworkType, disparityMetric]);

  return (
    <div className="map-panel-body analysis-panel">
      {!visualizationOnly && <div className="analysis-subnav" role="tablist" aria-label={t("Kategori Analisis")}>
        <button
          role="tab"
          aria-selected={activeTab === "ranking"}
          className={`analysis-subnav-btn ${activeTab === "ranking" ? "is-active" : ""}`}
          onClick={() => setActiveTab("ranking")}
          type="button"
        >
          <Icon name="bar-chart" size={14} />
          <span>{t("Peringkat")}</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "gap"}
          className={`analysis-subnav-btn ${activeTab === "gap" ? "is-active" : ""}`}
          onClick={() => setActiveTab("gap")}
          type="button"
        >
          <Icon name="sliders" size={14} />
          <span>{t("Kesenjangan (M-F)")}</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "disparity"}
          className={`analysis-subnav-btn ${activeTab === "disparity" ? "is-active" : ""}`}
          onClick={() => setActiveTab("disparity")}
          type="button"
        >
          <Icon name="trending-up" size={14} />
          <span>{t("Disparitas Gini")}</span>
        </button>
      </div>}
      <p className="analysis-panel-intro">
        {visualizationOnly
          ? t("Jelajahi tren wilayah, perubahan YoY, matriks kuadran, radar kinerja, dan deteksi anomali.")
          : t("Tinjau peringkat wilayah, kesenjangan konvergensi, dan indeks Gini 5 tahun.")}
      </p>

      {visualizationOnly && (
        <div className="vis-subnav" role="tablist" aria-label={t("Jenis visualisasi")}>
          <button
            aria-selected={visTab === "trend"}
            className={`vis-subnav-btn${visTab === "trend" ? " is-active" : ""}`}
            onClick={() => setVisTab("trend")}
            role="tab"
            type="button"
          >
            <Icon name="activity" size={12} />
            <span>{t("Tren Wilayah")}</span>
          </button>
          <button
            aria-selected={visTab === "compare"}
            className={`vis-subnav-btn${visTab === "compare" ? " is-active" : ""}`}
            onClick={() => setVisTab("compare")}
            role="tab"
            type="button"
          >
            <Icon name="bar-chart" size={12} />
            <span>{t("Perubahan YoY")}</span>
          </button>
          <button
            aria-selected={visTab === "quadrant"}
            className={`vis-subnav-btn${visTab === "quadrant" ? " is-active" : ""}`}
            onClick={() => setVisTab("quadrant")}
            role="tab"
            type="button"
          >
            <Icon name="compass" size={12} />
            <span>{t("Matriks Kuadran")}</span>
          </button>
          <button
            aria-selected={visTab === "radar"}
            className={`vis-subnav-btn${visTab === "radar" ? " is-active" : ""}`}
            onClick={() => setVisTab("radar")}
            role="tab"
            type="button"
          >
            <Icon name="award" size={12} />
            <span>{t("Radar Kinerja")}</span>
          </button>
          <button
            aria-selected={visTab === "anomaly"}
            className={`vis-subnav-btn${visTab === "anomaly" ? " is-active" : ""}`}
            onClick={() => setVisTab("anomaly")}
            role="tab"
            type="button"
          >
            <Icon name="bell" size={12} />
            <span>{t("Deteksi Anomali")}</span>
          </button>
        </div>
      )}

      {/* ================= VISUALISASI: DETEKSI ANOMALI ================= */}
      {visualizationOnly && visTab === "anomaly" && (
        <div className="analysis-tab-content">
          <div className="coverage-panel-filters analysis-filters">
            <label>
              <span>{t("Jaringan")}</span>
              <select onChange={(e) => setAnomalyNetworkType(e.target.value as "mobile" | "fixed")} value={anomalyNetworkType}>
                <option value="mobile">{t("Mobile")}</option>
                <option value="fixed">{t("Fixed broadband")}</option>
              </select>
            </label>
          </div>

          <div className="anomaly-info-box">
            <Icon name="bell" size={14} />
            <p>
              {t(
                "Model Isolation Forest mendeteksi periode dengan perubahan drastis pada unduh, unggah, dan latensi (misal: peluncuran 5G, gangguan kabel laut, atau lonjakan tes). Skor > 60% = anomali kandidat."
              )}
            </p>
          </div>

          {anomalyResults.length === 0 ? (
            <div className="map-panel-empty">{t("Tidak ada anomali terdeteksi pada data yang tersedia.")}</div>
          ) : (
            <>
              <div className="anomaly-kpi-row">
                <div className="anomaly-kpi-card">
                  <span>{t("Total Anomali")}</span>
                  <strong>{anomalyResults.length}</strong>
                </div>
                <div className="anomaly-kpi-card is-critical">
                  <span>{t("Kritis (>72%)")}</span>
                  <strong>{anomalyResults.filter((r) => r.severity === "kritis").length}</strong>
                </div>
                <div className="anomaly-kpi-card is-warn">
                  <span>{t("Perhatian (60-72%)")}</span>
                  <strong>{anomalyResults.filter((r) => r.severity === "perhatian").length}</strong>
                </div>
              </div>

              <div className="anomaly-list">
                {anomalyResults.map((item, idx) => {
                  const color = regionColors[item.region] ?? "#475569";
                  const isCritical = item.severity === "kritis";
                  return (
                    <div key={`${item.region}-${item.period}`} className={`anomaly-card${isCritical ? " is-critical" : ""}`}>
                      <div className="anomaly-card-rank">{idx + 1}</div>
                      <div className="anomaly-card-body">
                        <div className="anomaly-card-header">
                          <span className="anomaly-region-dot" style={{ background: color }} />
                          <strong className="anomaly-region-name">{t(item.regionLabel)}</strong>
                          <span className="anomaly-period-chip">{item.periodLabel}</span>
                          <span className={`anomaly-severity-badge ${item.severity}`}>
                            {item.severity === "kritis" ? `⚠ ${t("Kritis")}` : `⚡ ${t("Perhatian")}`}
                          </span>
                        </div>
                        <div className="anomaly-score-bar-track">
                          <div
                            className="anomaly-score-bar-fill"
                            style={{
                              width: `${item.score * 100}%`,
                              background: isCritical ? "#dc2626" : "#d97706",
                            }}
                          />
                        </div>
                        <div className="anomaly-card-metrics">
                          <span>{t("Unduh")}: {(item.download / 1000).toFixed(1)} Mbps</span>
                          <span>{t("Latensi")}: {item.latency.toFixed(1)} ms</span>
                          {item.qoqDeltaDownload !== null && (
                            <span className={item.qoqDeltaDownload >= 0 ? "pos" : "neg"}>
                              QoQ: {item.qoqDeltaDownload >= 0 ? "+" : ""}{item.qoqDeltaDownload.toFixed(1)}%
                            </span>
                          )}
                          {item.yoyDeltaDownload !== null && (
                            <span className={item.yoyDeltaDownload >= 0 ? "pos" : "neg"}>
                              YoY: {item.yoyDeltaDownload >= 0 ? "+" : ""}{item.yoyDeltaDownload.toFixed(1)}%
                            </span>
                          )}
                          <span className="anomaly-score-label">{t("Skor")}: {(item.score * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="map-panel-footnote">
                {t(
                  "Isolation Forest · 120 pohon · fitur: unduh, unggah, latensi, delta QoQ, delta YoY. Ambang anomali: skor > 60%."
                )}
              </p>
            </>
          )}
        </div>
      )}

      {/* ================= VISUALISASI: MATRIKS KUADRAN ================= */}
      {visualizationOnly && visTab === "quadrant" && quadrantData && (
        <div className="analysis-tab-content">
          <div className="coverage-panel-filters analysis-filters">
            <label>
              <span>{t("Periode kuadran")}</span>
              <select onChange={(e) => setQuadrantPeriod(e.target.value)} value={quadrantPeriod}>
                {analysisData.periods.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("Jaringan")}</span>
              <select onChange={(e) => setQuadrantNetworkType(e.target.value as "mobile" | "fixed")} value={quadrantNetworkType}>
                <option value="mobile">{t("Mobile")}</option>
                <option value="fixed">{t("Fixed broadband")}</option>
              </select>
            </label>
          </div>

          <div className="vis-section-header">
            <strong>{t("Matriks Kuadran Kecepatan vs Latensi")}</strong>
            <p>{t("Pemetaan posisi wilayah berdasarkan kecepatan unduh (X) dan responsivitas latensi (Y). Sumbu pembagi adalah median nasional.")}</p>
          </div>

          <div className="quadrant-chart-wrap">
            <div className="quadrant-summary-grid">
              <div><span>{t("Wilayah dianalisis")}</span><strong>{quadrantData.regionCount}</strong></div>
              <div><span>{t("Median unduh")}</span><strong>{quadrantData.medianDown.toFixed(1)} <small>Mbps</small></strong></div>
              <div><span>{t("Median latensi")}</span><strong>{quadrantData.medianLat.toFixed(1)} <small>ms</small></strong></div>
            </div>
            <div className="quadrant-plot-wrap">
              <svg
                className="analysis-chart"
                role="img"
                viewBox="0 0 520 320"
                aria-label={t("Diagram pencar 4-kuadran kecepatan unduh terhadap latensi")}
              >
              {(() => {
                const padL = 60, padR = 25, padT = 25, padB = 40;
                const chartW = 520 - padL - padR;
                const chartH = 320 - padT - padB;
                const xSpan = quadrantData.maxDown - quadrantData.minDown || 1;
                const ySpan = quadrantData.maxLat - quadrantData.minLat || 1;

                const midX = padL + ((quadrantData.medianDown - quadrantData.minDown) / xSpan) * chartW;
                const midY = padT + ((quadrantData.medianLat - quadrantData.minLat) / ySpan) * chartH;

                return (
                  <>
                    <rect x={midX} y={padT} width={padL + chartW - midX} height={midY - padT} fill="#f0fdf4" rx="4" />
                    <rect x={padL} y={padT} width={midX - padL} height={midY - padT} fill="#fefce8" rx="4" />
                    <rect x={midX} y={midY} width={padL + chartW - midX} height={padT + chartH - midY} fill="#eff6ff" rx="4" />
                    <rect x={padL} y={midY} width={midX - padL} height={padT + chartH - midY} fill="#fff7ed" rx="4" />

                    <line x1={midX} x2={midX} y1={padT} y2={padT + chartH} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth="1.5" />
                    <line x1={padL} x2={padL + chartW} y1={midY} y2={midY} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth="1.5" />

                    <text x={padL + chartW / 2} y={312} textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="600">
                      {t("Kecepatan Unduh (Mbps)")} →
                    </text>
                    <text x={18} y={padT + chartH / 2} textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="600" transform={`rotate(-90 18 ${padT + chartH / 2})`}>
                      ← {t("Latensi Rendah (ms, Lebih Cepat)")}
                    </text>

                    <text x={padL} y={padT + chartH + 14} fontSize="9" fill="#94a3b8">{quadrantData.minDown.toFixed(0)}</text>
                    <text x={padL + chartW} y={padT + chartH + 14} textAnchor="end" fontSize="9" fill="#94a3b8">{quadrantData.maxDown.toFixed(0)}</text>
                    <text x={padL - 6} y={padT + 8} textAnchor="end" fontSize="9" fill="#94a3b8">{quadrantData.minLat.toFixed(0)} ms</text>
                    <text x={padL - 6} y={padT + chartH} textAnchor="end" fontSize="9" fill="#94a3b8">{quadrantData.maxLat.toFixed(0)} ms</text>

                    {quadrantData.items.map((item) => {
                      const cx = padL + ((item.downloadMbps - quadrantData.minDown) / xSpan) * chartW;
                      const cy = padT + ((item.latencyMs - quadrantData.minLat) / ySpan) * chartH;
                      const r = Math.max(6, Math.min(18, Math.sqrt(item.devices) / 25));

                      return (
                        <g key={item.region}>
                          <circle
                            cx={cx}
                            cy={cy}
                            r={r}
                            fill={item.color}
                            fillOpacity="0.75"
                            stroke="#ffffff"
                            strokeWidth="2"
                          >
                            <title>{`${item.label}\n${t("Unduh")}: ${item.downloadMbps.toFixed(1)} Mbps\n${t("Latensi")}: ${item.latencyMs.toFixed(1)} ms\n${t("Kuadran")}: ${t(item.quadrantName)}\n${t("Pengujian")}: ${formatNumber(item.tests, numberLocale)}`}</title>
                          </circle>
                        </g>
                      );
                    })}
                  </>
                );
              })()}
              </svg>
            </div>

            <div className="quadrant-legend-grid">
              <div className="quadrant-legend-card leader">
                <strong>⭐ {t("Pemimpin Digital")} <span>{quadrantData.counts.leader}</span></strong>
                <p>{t("Kecepatan unduh tinggi dengan latensi rendah. Ideal untuk gaming kompetitif, streaming 4K, dan ekosistem digital maju.")}</p>
                <div className="quadrant-region-list">
                  {quadrantData.items.filter((item) => item.quadrant === "leader").map((item) => (
                    <span key={item.region}><i style={{ background: item.color }} />{t(item.label)}</span>
                  ))}
                </div>
              </div>
              <div className="quadrant-legend-card accelerator">
                <strong>🚀 {t("Akselerator Throughput")} <span>{quadrantData.counts.accelerator}</span></strong>
                <p>{t("Kecepatan unduh tinggi namun latensi relatif tinggi. Butuh optimasi routing, CDN lokal, atau penanganan bufferbloat.")}</p>
                <div className="quadrant-region-list">
                  {quadrantData.items.filter((item) => item.quadrant === "accelerator").map((item) => (
                    <span key={item.region}><i style={{ background: item.color }} />{t(item.label)}</span>
                  ))}
                </div>
              </div>
              <div className="quadrant-legend-card responsive">
                <strong>🎯 {t("Responsif & Stabil")} <span>{quadrantData.counts.responsive}</span></strong>
                <p>{t("Latensi gesit dan stabil meskipun throughput masih moderat. Pengalaman browsing dan call suara sangat responsif.")}</p>
                <div className="quadrant-region-list">
                  {quadrantData.items.filter((item) => item.quadrant === "responsive").map((item) => (
                    <span key={item.region}><i style={{ background: item.color }} />{t(item.label)}</span>
                  ))}
                </div>
              </div>
              <div className="quadrant-legend-card developing">
                <strong>⚠️ {t("Butuh Akselerasi")} <span>{quadrantData.counts.developing}</span></strong>
                <p>{t("Kecepatan unduh dan responsivitas masih di bawah median. Menjadi prioritas penguatan BTS 4G/5G dan fiberisasi.")}</p>
                <div className="quadrant-region-list">
                  {quadrantData.items.filter((item) => item.quadrant === "developing").map((item) => (
                    <span key={item.region}><i style={{ background: item.color }} />{t(item.label)}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= VISUALISASI: RADAR KINERJA ================= */}
      {visualizationOnly && visTab === "radar" && radarData && (
        <div className="analysis-tab-content">
          <div className="coverage-panel-filters analysis-filters">
            <label>
              <span>{t("Wilayah utama")}</span>
              <select onChange={(e) => setRadarPrimaryRegion(e.target.value)} value={radarPrimaryRegion}>
                {analysisData.regions.map((r) => (
                  <option key={r.value} value={r.value}>{t(r.label)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("Pembanding")}</span>
              <select onChange={(e) => setRadarBenchmarkRegion(e.target.value)} value={radarBenchmarkRegion}>
                {analysisData.regions.map((r) => (
                  <option key={r.value} value={r.value}>{t(r.label)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("Jaringan")}</span>
              <select onChange={(e) => setRadarNetworkType(e.target.value as "mobile" | "fixed")} value={radarNetworkType}>
                <option value="mobile">{t("Mobile")}</option>
                <option value="fixed">{t("Fixed broadband")}</option>
              </select>
            </label>
          </div>

          <div className="vis-section-header">
            <strong>{t("Radar Kinerja 5-Dimensi · {period}", { period: radarData.periodLabel })}</strong>
            <p>{t("Benchmark multi-aspek: Unduh, Unggah, Responsivitas Ping, Kontrol Bufferbloat, dan Penetrasi Tes.")}</p>
          </div>

          <div className="radar-chart-wrap">
            <svg
              className="analysis-chart"
              role="img"
              viewBox="0 0 460 310"
              aria-label={t("Diagram radar perbandingan performa")}
            >
              {[0.2, 0.4, 0.6, 0.8, 1.0].map((level) => {
                const points = radarData.axes
                  .map((a) => {
                    const px = radarData.cx + radarData.r * level * Math.cos(a.angle);
                    const py = radarData.cy + radarData.r * level * Math.sin(a.angle);
                    return `${px.toFixed(1)},${py.toFixed(1)}`;
                  })
                  .join(" ");
                return (
                  <polygon
                    key={level}
                    points={points}
                    fill={level === 1.0 ? "#f8faf9" : "none"}
                    stroke="#e2e8e4"
                    strokeWidth="1"
                    strokeDasharray={level < 1.0 ? "2 2" : undefined}
                  />
                );
              })}

              {radarData.axes.map((axis) => {
                const outerX = radarData.cx + radarData.r * Math.cos(axis.angle);
                const outerY = radarData.cy + radarData.r * Math.sin(axis.angle);
                const labelX = radarData.cx + (radarData.r + 28) * Math.cos(axis.angle);
                const labelY = radarData.cy + (radarData.r + 28) * Math.sin(axis.angle);

                return (
                  <g key={axis.key}>
                    <line x1={radarData.cx} y1={radarData.cy} x2={outerX} y2={outerY} stroke="#cbd5e1" strokeWidth="1" />
                    <text
                      x={labelX}
                      y={labelY + 4}
                      textAnchor="middle"
                      fontSize="9.5"
                      fontWeight="600"
                      fill="#334155"
                    >
                      {t(axis.label)}
                    </text>
                  </g>
                );
              })}

              <polygon
                points={radarData.benchPoints}
                fill="#64748b"
                fillOpacity="0.12"
                stroke={radarData.benchColor}
                strokeWidth="2"
                strokeDasharray="4 3"
              />

              <polygon
                points={radarData.primaryPoints}
                fill={radarData.primaryColor}
                fillOpacity="0.25"
                stroke={radarData.primaryColor}
                strokeWidth="2.5"
              />

              {radarData.axes.map((axis) => {
                const score = (radarData.primaryScores[axis.key] ?? 50) / 100;
                const px = radarData.cx + radarData.r * score * Math.cos(axis.angle);
                const py = radarData.cy + radarData.r * score * Math.sin(axis.angle);
                return (
                  <circle
                    key={axis.key}
                    cx={px}
                    cy={py}
                    r="4"
                    fill={radarData.primaryColor}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  >
                    <title>{`${radarData.primaryLabel} · ${axis.label}: ${(radarData.primaryScores[axis.key] ?? 0)}/100`}</title>
                  </circle>
                );
              })}
            </svg>

            <div className="analysis-legend" style={{ justifyContent: "center", marginTop: 4 }}>
              <span><i style={{ background: radarData.primaryColor }} /><strong>{radarData.primaryLabel}</strong></span>
              <span><i style={{ background: radarData.benchColor, border: "1px dashed #475569" }} />{radarData.benchLabel} ({t("Pembanding")})</span>
            </div>

            <div className="radar-dimension-grid">
              {radarData.axes.map((axis) => {
                const primaryScore = radarData.primaryScores[axis.key] ?? 0;
                const benchmarkScore = radarData.benchScores[axis.key] ?? 0;
                return (
                  <div className="radar-dimension-card" key={axis.key}>
                    <strong>{t(axis.label)}</strong>
                    <div className="radar-dimension-value">
                      <span>{radarData.primaryLabel}</span>
                      <b>{primaryScore}</b>
                    </div>
                    <div className="radar-dimension-track" aria-hidden="true">
                      <span style={{ width: `${primaryScore}%`, background: radarData.primaryColor }} />
                    </div>
                    <div className="radar-dimension-value is-benchmark">
                      <span>{radarData.benchLabel}</span>
                      <b>{benchmarkScore}</b>
                    </div>
                    <div className="radar-dimension-track is-benchmark" aria-hidden="true">
                      <span style={{ width: `${benchmarkScore}%`, background: radarData.benchColor }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {radarData.primaryScores.raw && (
              <div className="radar-score-grid">
                <div className="radar-score-card is-highlight">
                  <span>{t("SKOR QoE")}</span>
                  <strong>{radarData.primaryScores.raw.qoeOverall}/100</strong>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= VISUALISASI: TREN WILAYAH ================= */}
      {visualizationOnly && visTab === "trend" && (
        <div className="analysis-tab-content">
          <div className="analysis-period-summary" aria-label={t("Periode dan jumlah tes Ookla terbaru")}>
            <div className="analysis-period-main">
              <span>{t("DATA TERBARU DI ARSIP")}</span>
              <strong>{latestPeriod}</strong>
            </div>
            <div className="analysis-period-tests">
              <span>{t("JUMLAH TES · {region}", { region: t(regionLabel) })}</span>
              <div className="analysis-test-counts">
                <div><span>{t("Mobile")}</span><strong>{formatNumber(latestMobileTests, numberLocale)}</strong></div>
                <div><span>{t("Fixed")}</span><strong>{formatNumber(latestFixedTests, numberLocale)}</strong></div>
              </div>
            </div>
            <small>{t("Data historis Ookla yang tersedia, bukan pengukuran langsung.")}</small>
          </div>
          <div className="coverage-panel-filters analysis-filters">
            <label>
              <span>{t("Wilayah analisis · perkiraan")}</span>
              <select aria-label={t("Wilayah analisis · perkiraan")} onChange={(event) => setRegion(event.target.value)} value={region}>
                {analysisData.regions.map((item) => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
              </select>
            </label>
            <label>
              <span>{t("Metrik")}</span>
              <select aria-label={t("Pilih metrik analisis")} onChange={(event) => setMetric(event.target.value as MapMetric)} value={metric}>
                {Object.entries(metricLabels).map(([val, lbl]) => <option key={val} value={val}>{t(lbl)}</option>)}
              </select>
            </label>
          </div>
          <div aria-label={t("Pengelompokan periode")} className="analysis-period-toggle" role="group">
            <button aria-pressed={periodMode === "year"} className={periodMode === "year" ? "is-active" : ""} onClick={() => setPeriodMode("year")} type="button">{t("Tahunan")}</button>
            <button aria-pressed={periodMode === "quarter"} className={periodMode === "quarter" ? "is-active" : ""} onClick={() => setPeriodMode("quarter")} type="button">{t("Kuartalan")}</button>
          </div>
          <div className="coverage-panel-filters analysis-filters analysis-period-filters">
            <label>
              <span>{t("Tahun")}</span>
              <select aria-label={t("Filter tahun tren")} onChange={(event) => setSelectedYear(event.target.value)} value={selectedYear}>
                <option value="all">{t("Semua tahun")}</option>
                {analysisYears.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            {periodMode === "quarter" && (
              <label>
                <span>{t("Kuartal")}</span>
                <select aria-label={t("Filter kuartal tren")} onChange={(event) => setSelectedQuarter(event.target.value)} value={selectedQuarter}>
                  <option value="all">{t("Semua kuartal")}</option>
                  {[1, 2, 3, 4].map((quarter) => <option key={quarter} value={quarter}>Q{quarter}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="analysis-chart-wrap">
            <div className="analysis-chart-heading">
              <strong>{chartMode === "performance" ? `${t("Tren {metric}", { metric: t(metricLabels[metric]).toLocaleLowerCase(numberLocale) })}` : t("Volume tes Ookla")}</strong>
              <span>{chartMode === "performance" ? metric === "latency" ? "ms" : "Mbps" : "juta tes"}</span>
            </div>
            <div aria-label={t("Jenis grafik")} className="analysis-visual-toggle" role="group">
              <button aria-pressed={chartMode === "performance"} className={chartMode === "performance" ? "is-active" : ""} onClick={() => setChartMode("performance")} type="button">{t("Performa")}</button>
              <button aria-pressed={chartMode === "tests"} className={chartMode === "tests" ? "is-active" : ""} onClick={() => setChartMode("tests")} type="button">{t("Volume tes")}</button>
            </div>
            <svg
              aria-label={chartMode === "performance"
                ? t("Tren {metric} untuk mobile dan fixed, wilayah {region}", { metric: t(metricLabels[metric]), region: t(regionLabel) })
                : t("Jumlah tes Mobile dan Fixed berdasarkan periode, wilayah {region}", { region: t(regionLabel) })}
              className="analysis-chart"
              role="img"
              viewBox="0 0 640 250"
            >
              <line className="analysis-grid-line" x1="42" x2="608" y1="18" y2="18" />
              <line className="analysis-grid-line" x1="42" x2="608" y1="198" y2="198" />
              <text className="analysis-axis-label" textAnchor="end" x="37" y="22">{chartMode === "performance" ? formatValue(maximum, metric, numberLocale) : formatTestsAxis(maximumTests)}</text>
              <text className="analysis-axis-label" textAnchor="end" x="37" y="202">{chartMode === "performance" ? formatValue(minimum, metric, numberLocale) : "0"}</text>
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
                      <title>{`${row.label} · ${t(type === "mobile" ? "Mobile" : "Fixed")}: ${formatNumber(tests, numberLocale)} ${t("tes")}`}</title>
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
                          <title>{`${row.label} · ${t(type === "mobile" ? "Mobile" : "Fixed")}: ${formatValue(val, metric, numberLocale)}`}</title>
                        </circle>
                      );
                    })}
                    {showTick && <text className="analysis-x-label" textAnchor="middle" x={xFor(index)} y="222">{periodMode === "year" ? row.label : `Q${row.quarter} '${String(row.year).slice(-2)}`}</text>}
                  </g>
                );
              })}
              <text className="analysis-x-label" textAnchor="middle" x="325" y="244">{t("Periode data")}</text>
            </svg>
            <div className="analysis-legend">
              <span><i className="is-mobile" />{t("Mobile")}</span>
              <span><i className="is-fixed" />{t("Fixed broadband")}</span>
            </div>
          </div>
          <div className="analysis-kpi">
            <span>{t("Perubahan Mobile, {range}", { range: changeLabel })}</span>
            <strong className={periodChange !== null && periodChange < 0 ? "is-negative" : ""}>
              {periodChange === null ? "—" : `${periodChange > 0 ? "+" : ""}${periodChange.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`}
            </strong>
            <small>{t(regionLabel)} · {t(metricLabels[metric]).toLocaleLowerCase(numberLocale)}</small>
          </div>
          <div aria-label={t("Ekspor statistik")} className="analysis-statistics-export">
            <span>{t("EKSPOR STATISTIK")}</span>
            <div>
              <button aria-label={t("Ekspor statistik CSV")} className="map-export-button" onClick={handleStatisticsCsvExport} type="button">CSV</button>
              <button aria-label={t("Ekspor statistik PNG")} className="map-export-button" onClick={() => void handleStatisticsImageExport("png")} type="button">PNG</button>
              <button aria-label={t("Ekspor statistik JPEG")} className="map-export-button" onClick={() => void handleStatisticsImageExport("jpeg")} type="button">JPG</button>
              <button aria-label={t("Ekspor statistik PDF")} className="map-export-button" onClick={handleStatisticsPdfExport} type="button">PDF</button>
            </div>
          </div>
          <p className="map-panel-caption">{t("Batas wilayah memakai kotak koordinat dan titik tengah sel, bukan batas administrasi. Perbandingan dibobot jumlah tes; tahun berjalan hanya memakai kuartal yang tersedia.")}</p>
          <div className="map-section-heading analysis-table-heading">
            <span>{t("PERBANDINGAN {period} · EKSPOR TABEL", { period: t(periodMode === "year" ? "Tahunan" : "Kuartalan").toLocaleUpperCase(numberLocale) })}</span>
            <div aria-label={t("Ekspor tabel")} className="analysis-export-actions">
              <button aria-label={t("Ekspor analisis CSV")} className="map-export-button" onClick={() => downloadCsv(rows, metric, region, periodMode)} type="button">CSV</button>
              <button aria-label={t("Ekspor tabel PNG")} className="map-export-button" onClick={() => void handleImageExport("png")} type="button">PNG</button>
              <button aria-label={t("Ekspor tabel JPEG")} className="map-export-button" onClick={() => void handleImageExport("jpeg")} type="button">JPG</button>
              <button aria-label={t("Ekspor tabel PDF")} className="map-export-button" onClick={handlePdfExport} type="button">PDF</button>
            </div>
          </div>
          {exportError && <p className="analysis-export-error" role="status">{exportError}</p>}
          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead>
                <tr><th>{t("Periode")}</th><th>{t("Mobile")}</th><th>{t("Fixed")}</th><th>{t("Selisih M−F")}</th></tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => {
                  const mob = r.mobile ? metricValue(r.mobile, metric) : null;
                  const fix = r.fixed ? metricValue(r.fixed, metric) : null;
                  return (
                    <tr key={r.key}>
                      <th scope="row">{r.label}</th>
                      <td>
                        {mob === null ? "—" : <><span>{formatValue(mob, metric, numberLocale)}</span><small>{formatNumber(r.mobile?.tests ?? 0, numberLocale)} {t("tes")}</small></>}
                      </td>
                      <td>
                        {fix === null ? "—" : <><span>{formatValue(fix, metric, numberLocale)}</span><small>{formatNumber(r.fixed?.tests ?? 0, numberLocale)} {t("tes")}</small></>}
                      </td>
                      <td>{mob === null || fix === null ? "—" : formatValue(mob - fix, metric, numberLocale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="map-panel-footnote">{t("Selisih = Mobile dikurangi Fixed. Data berasal dari arsip lokal Ookla, bukan pengukuran langsung.")}</p>
        </div>
      )}

      {/* ================= TAB 2: PERINGKAT & KOMPARASI ================= */}
      {!visualizationOnly && activeTab === "ranking" && (
        <div className="analysis-tab-content">
          <div className="coverage-panel-filters analysis-filters analysis-ranking-filters">
            <label>
              <span>{t("Periode peringkat")}</span>
              <select aria-label={t("Pilih periode peringkat")} onChange={(event) => setRankingPeriod(event.target.value)} value={rankingPeriod}>
                {analysisData.periods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
              </select>
            </label>
            <label>
              <span>{t("Jaringan")}</span>
              <select aria-label={t("Pilih jaringan peringkat")} onChange={(event) => setRankingNetworkType(event.target.value as "mobile" | "fixed")} value={rankingNetworkType}>
                <option value="mobile">{t("Mobile")}</option>
                <option value="fixed">{t("Fixed broadband")}</option>
              </select>
            </label>
            <label>
              <span>{t("Metrik")}</span>
              <select aria-label={t("Pilih metrik peringkat")} onChange={(event) => setRankingMetric(event.target.value as MapMetric)} value={rankingMetric}>
                {Object.entries(metricLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
            </label>
          </div>

          <div className="analysis-national-summary">
            <div>
              <span>{t("DATA INDONESIA · {period}", { period: analysisData.periods.find((period) => period.value === rankingPeriod)?.label ?? rankingPeriod })}</span>
              <strong>{indonesiaRankingData ? formatValue(indonesiaRankingData.value, rankingMetric, numberLocale) : t("Data tidak tersedia")}</strong>
              <small>{t("Indonesia & sekitar")} · {t(rankingNetworkType === "mobile" ? "Mobile" : "Fixed broadband")}</small>
            </div>
            <div>
              <span>{t("JUMLAH TES")}</span>
              <strong>{formatNumber(indonesiaRankingData?.tests ?? 0, numberLocale)}</strong>
              <small>{formatNumber(indonesiaRankingData?.devices ?? 0, numberLocale)} {t("perangkat")}</small>
            </div>
          </div>

          <div className="map-section-heading analysis-table-heading">
            <span>{t("PERINGKAT 8 WILAYAH DI INDONESIA")}</span>
            <button
              className="map-export-button"
              onClick={() => downloadLeaderboardCsv(rankingItems, rankingMetric, analysisData.periods.find((period) => period.value === rankingPeriod)?.label ?? rankingPeriod)}
              type="button"
            >
              <Icon name="download" size={13} /> {t("Ekspor CSV")}
            </button>
          </div>
          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead>
                <tr><th>{t("Peringkat")}</th><th>{t("Wilayah")}</th><th>{t(metricLabels[rankingMetric])}</th><th>{t("Selisih vs Indonesia")}</th><th>{t("Tes")}</th></tr>
              </thead>
              <tbody>
                {rankingItems.map((item) => (
                  <tr key={item.regionValue}>
                    <td>#{item.rank}</td>
                    <th scope="row">{t(item.regionLabel)}</th>
                    <td>{formatValue(item.value, rankingMetric, numberLocale)}</td>
                    <td>{formatValue(item.diffVsBenchmark, rankingMetric, numberLocale)}</td>
                    <td>{formatNumber(item.tests, numberLocale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="map-section-heading analysis-table-heading">
            <span>{t("GRAFIK KOMPARASI ANTAR-WILAYAH · 2021–2026")}</span>
          </div>
          <p className="map-panel-footnote">{t("Rata-rata metrik per kuartal, dibobot jumlah tes. Batas wilayah merupakan perkiraan; data berasal dari arsip Ookla.")}</p>
          <div className="ml-region-pills">
            {analysisData.regions.map((item) => {
              const active = activeRegions.includes(item.value);
              const color = regionColors[item.value] ?? "#475569";
              return (
                <button
                  aria-pressed={active}
                  className={`ml-region-pill${active ? " is-active" : ""}`}
                  key={item.value}
                  onClick={() => toggleRankingRegion(item.value)}
                  style={active ? { borderColor: color, color, background: `${color}18` } : {}}
                  type="button"
                >
                  <span className="ml-region-dot" style={{ background: active ? color : "#c8d4ce" }} />
                  {t(item.label.replace(" (perkiraan)", ""))}
                </button>
              );
            })}
          </div>
          <div className="analysis-chart-wrap analysis-comparison-chart-wrap">
            <div className="analysis-chart-heading">
              <strong>{t(metricLabels[rankingMetric])} · {t(rankingNetworkType === "mobile" ? "Mobile" : "Fixed broadband")}</strong>
              <span>{rankingMetric === "latency" ? "ms" : "Mbps"}</span>
            </div>
            <svg aria-label={t("Grafik komparasi {metric} antarwilayah 2021 hingga 2026", { metric: t(metricLabels[rankingMetric]) })} className="analysis-chart" role="img" viewBox="0 0 640 230">
              <line className="analysis-grid-line" x1="48" x2="610" y1="20" y2="20" />
              <line className="analysis-grid-line" x1="48" x2="610" y1="175" y2="175" />
              <text className="analysis-axis-label" textAnchor="end" x="44" y="24">{formatValue(regionalComparison.maximum, rankingMetric, numberLocale)}</text>
              <text className="analysis-axis-label" textAnchor="end" x="44" y="179">{formatValue(regionalComparison.minimum, rankingMetric, numberLocale)}</text>
              {regionalComparison.series.map((series) => {
                const points = series.points.map((value, index) => {
                  if (value === null) return "";
                  const x = regionalComparison.periods.length <= 1
                    ? 329
                    : 48 + index * (562 / (regionalComparison.periods.length - 1));
                  const span = regionalComparison.maximum - regionalComparison.minimum || Math.max(Math.abs(regionalComparison.maximum) * 0.1, 1);
                  const y = 20 + ((regionalComparison.maximum - value) / span) * 155;
                  return `${x},${y}`;
                }).filter(Boolean).join(" ");
                return <polyline key={series.value} points={points} style={{ fill: "none", stroke: series.color, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }} />;
              })}
              {regionalComparison.periods.map((period, index) => {
                const year = period.value.slice(0, 4);
                if (index !== 0 && year === regionalComparison.periods[index - 1].value.slice(0, 4)) return null;
                const x = regionalComparison.periods.length <= 1
                  ? 329
                  : 48 + index * (562 / (regionalComparison.periods.length - 1));
                return <text className="analysis-x-label" key={period.value} textAnchor="middle" x={x} y="198">{year}</text>;
              })}
            </svg>
            <div className="ml-chart-legend">
              {regionalComparison.series.map((series) => (
                <span key={series.value}><i style={{ background: series.color }} />{series.label}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 3: KESENJANGAN (CONVERGENCE GAP) ================= */}
      {activeTab === "gap" && (
        <div className="analysis-tab-content">
          <div className="gap-kpi-grid">
            <div className="gap-kpi-card">
              <span>{t("RASIO UNDUH NASIONAL")}</span>
              <strong>{convergenceData.national ? `${convergenceData.national.ratio.toFixed(1)}x` : "—"}</strong>
              <small>{t("Fixed Broadband vs Mobile di Indonesia")}</small>
            </div>
            <div className="gap-kpi-card">
              <span>{t("DISPARITAS LATENSI")}</span>
              <strong>{convergenceData.national ? `${convergenceData.national.latencyDiff > 0 ? "+" : ""}${convergenceData.national.latencyDiff.toFixed(1)} ms` : "—"}</strong>
              <small>{t("Selisih latensi Mobile − Fixed")}</small>
            </div>
            <div className="gap-kpi-card">
              <span>{t("WILAYAH PALING TIMPANG")}</span>
              <strong>{t(convergenceData.highestGap?.regionLabel.replace(" (perkiraan)", "") ?? "")}</strong>
              <small>{t("Rasio Fixed/Mobile: {ratio}x", { ratio: convergenceData.highestGap?.ratio.toFixed(1) ?? "—" })}</small>
            </div>
            <div className="gap-kpi-card">
              <span>{t("WILAYAH PALING BERIMBANG")}</span>
              <strong>{t(convergenceData.lowestGap?.regionLabel.replace(" (perkiraan)", "") ?? "")}</strong>
              <small>{t("Rasio Fixed/Mobile: {ratio}x", { ratio: convergenceData.lowestGap?.ratio.toFixed(1) ?? "—" })}</small>
            </div>
          </div>

          <div className="coverage-panel-filters analysis-filters analysis-gap-period-filter">
            <label>
              <span>{t("Periode kesenjangan")}</span>
              <select aria-label={t("Pilih periode kesenjangan")} onChange={(event) => setGapPeriod(event.target.value)} value={gapPeriod}>
                {analysisData.periods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
              </select>
            </label>
          </div>
          <div className="map-section-heading analysis-table-heading">
            <span>{t("TABEL KESENJANGAN 8 WILAYAH · {period}", { period: convergenceData.periodLabel.toLocaleUpperCase(numberLocale) })}</span>
            <button
              className="map-export-button"
              onClick={() => downloadConvergenceCsv(convergenceData.items, convergenceData.periodLabel)}
              type="button"
            >
              <Icon name="download" size={13} /> {t("Ekspor CSV")}
            </button>
          </div>
          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead>
                <tr><th>{t("Wilayah")}</th><th>{t("Unduh Mobile")}</th><th>{t("Unduh Fixed")}</th><th>{t("Rasio F/M")}</th><th>{t("Selisih latensi")}</th><th>{t("Status")}</th></tr>
              </thead>
              <tbody>
                {convergenceData.items.map((item) => (
                  <tr key={item.regionValue}>
                    <th scope="row">{t(item.regionLabel)}</th>
                    <td>{formatValue(item.mobileDownload, "download", numberLocale)}</td>
                    <td>{formatValue(item.fixedDownload, "download", numberLocale)}</td>
                    <td>{item.ratio.toFixed(1)}x</td>
                    <td>{formatValue(item.latencyDiff, "latency", numberLocale)}</td>
                    <td><span className="gap-status-pill" style={{ color: item.statusColor, background: item.statusBg }}>{t(item.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="map-panel-footnote">{t("Rasio unduh adalah kecepatan Fixed dibagi Mobile; rasio lebih tinggi menunjukkan disparitas lebih besar. Data berasal dari arsip Ookla.")}</p>
        </div>
      )}

      {/* ================= TAB: DISPARITAS GINI 5 TAHUN ================= */}
      {activeTab === "disparity" && disparityData && (
        <div className="analysis-tab-content">
          <div className="coverage-panel-filters analysis-filters">
            <label>
              <span>{t("Jaringan")}</span>
              <select onChange={(e) => setDisparityNetworkType(e.target.value as "mobile" | "fixed")} value={disparityNetworkType}>
                <option value="mobile">{t("Mobile")}</option>
                <option value="fixed">{t("Fixed broadband")}</option>
              </select>
            </label>
            <label>
              <span>{t("Metrik")}</span>
              <select onChange={(e) => setDisparityMetric(e.target.value as MapMetric)} value={disparityMetric}>
                {Object.entries(metricLabels).map(([k, v]) => (
                  <option key={k} value={k}>{t(v)}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="disparity-kpi-grid">
            <div className="gap-kpi-card">
              <span>{t("INDEKS GINI TERKINI")}</span>
              <strong>{disparityData.latestItem ? disparityData.latestItem.gini.toFixed(3) : "—"}</strong>
              <small>
                {disparityData.latestItem?.gini && disparityData.latestItem.gini < 0.25
                  ? t("Pemerataan Relatif Baik (<0.25)")
                  : t("Ketimpangan Sedang (0.25–0.40)")}
              </small>
            </div>
            <div className="gap-kpi-card">
              <span>{t("TREN DISPARITAS 5 TAHUN")}</span>
              <strong style={{ color: disparityData.giniChange <= 0 ? "#15803d" : "#b91c1c" }}>
                {disparityData.giniChange > 0 ? "+" : ""}{disparityData.giniChange.toFixed(1)}%
              </strong>
              <small>
                {disparityData.giniChange <= 0
                  ? t("Kesenjangan menyempit (Konvergensi)")
                  : t("Kesenjangan melebar (Divergensi)")}
              </small>
            </div>
            <div className="gap-kpi-card">
              <span>{t("RASIO WILAYAH MAX/MIN")}</span>
              <strong>{disparityData.latestItem ? `${disparityData.latestItem.ratio.toFixed(1)}x` : "—"}</strong>
              <small>{t("Wilayah tercepat vs terendah")}</small>
            </div>
            <div className="gap-kpi-card">
              <span>{t("RENTANG KECEPATAN")}</span>
              <strong>
                {disparityData.latestItem
                  ? `${disparityData.latestItem.min.toFixed(0)} - ${disparityData.latestItem.max.toFixed(0)}`
                  : "—"}{" "}
                <span style={{ fontSize: 11, fontWeight: 500 }}>{disparityMetric === "latency" ? "ms" : "Mbps"}</span>
              </strong>
              <small>{disparityData.latestItem?.label ?? ""}</small>
            </div>
          </div>

          <div className="vis-section-header">
            <strong>{t("Tren Koefisien Gini Disparitas Antarwilayah (2021–2026/2027)")}</strong>
            <p>{t("Koefisien Gini 0 = pemerataan sempurna; angka lebih rendah menunjukkan pemerataan internet antarpulau yang semakin baik.")}</p>
          </div>

          <div className="gini-chart-wrap">
            <svg
              className="analysis-chart"
              role="img"
              viewBox="0 0 640 220"
              aria-label={t("Grafik garis tren Indeks Gini")}
            >
              <line className="analysis-grid-line" x1="45" x2="610" y1="20" y2="20" />
              <line className="analysis-grid-line" x1="45" x2="610" y1="170" y2="170" />
              <text className="analysis-axis-label" textAnchor="end" x="40" y="24">0.40</text>
              <text className="analysis-axis-label" textAnchor="end" x="40" y="95">0.25</text>
              <text className="analysis-axis-label" textAnchor="end" x="40" y="174">0.10</text>

              <rect x="45" y="20" width="565" height="75" fill="#fef2f2" fillOpacity="0.4" />
              <rect x="45" y="95" width="565" height="75" fill="#f0fdf4" fillOpacity="0.4" />
              <text x="50" y="32" fontSize="9" fill="#dc2626" fontWeight="600">{t("Zona Ketimpangan Tinggi (>0.25)")}</text>
              <text x="50" y="107" fontSize="9" fill="#16a34a" fontWeight="600">{t("Zona Pemerataan Baik (<0.25)")}</text>

              {(() => {
                const maxG = 0.40, minG = 0.10;
                const spanG = maxG - minG;
                const pts = disparityData.timeline.map((item, idx) => {
                  const x = 45 + idx * (565 / Math.max(1, disparityData.timeline.length - 1));
                  const clamped = Math.max(minG, Math.min(maxG, item.gini));
                  const y = 20 + ((maxG - clamped) / spanG) * 150;
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                }).join(" ");

                return (
                  <>
                    <polyline
                      points={pts}
                      fill="none"
                      stroke="#0d9488"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {disparityData.timeline.map((item, idx) => {
                      const x = 45 + idx * (565 / Math.max(1, disparityData.timeline.length - 1));
                      const clamped = Math.max(minG, Math.min(maxG, item.gini));
                      const y = 20 + ((maxG - clamped) / spanG) * 150;
                      const isYearStart = item.label.includes("Q1") || idx === disparityData.timeline.length - 1;

                      return (
                        <g key={item.period}>
                          <circle cx={x} cy={y} r="3.5" fill="#0d9488" stroke="#ffffff" strokeWidth="1.5">
                            <title>{`${item.label}\nIndeks Gini: ${item.gini}\nRasio Max/Min: ${item.ratio}x\nMax: ${item.max.toFixed(1)}, Min: ${item.min.toFixed(1)}`}</title>
                          </circle>
                          {isYearStart && (
                            <text x={x} y="192" textAnchor="middle" fontSize="9" fill="#64748b">
                              {item.label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </>
                );
              })()}
            </svg>
          </div>
          <p className="map-panel-footnote">
            {t("Indeks Gini dihitung dari distribusi kecepatan rata-rata antarwilayah tiap kuartal. Penurunan indeks membuktikan hasil positif program Palapa Ring dan penetrasi BTS pelosok.")}
          </p>
        </div>
      )}

      {/* ================= VISUALISASI: DELTA HEATMAP + MULTI-LINE CHART ================= */}
      {visualizationOnly && visTab === "compare" && (() => {
        // --- Kalkulasi Delta Heatmap ---
        const latestP = analysisData.latestPeriod;
        const allPeriods = analysisData.periods.map((p) => p.value);
        const latestIdx = allPeriods.indexOf(latestP);
        // YoY = periode yang sama 4 kuartal lalu
        const yoyP = latestIdx + 4 < allPeriods.length ? allPeriods[latestIdx + 4] : null;

        const deltaItems = analysisData.regions.map((reg) => {
          const getVal = (period: string | null) => {
            if (!period) return null;
            const e = analysisData.entries.find(
              (entry) => entry.region === reg.value && entry.period === period && entry.networkType === visNetworkType
            );
            if (!e) return null;
            if (visMetric === "download") return e.avgDownloadKbps;
            if (visMetric === "upload") return e.avgUploadKbps;
            return e.avgLatencyMs;
          };
          const curr = getVal(latestP);
          const prior = getVal(yoyP);
          const delta = curr !== null && prior !== null && prior > 0
            ? visMetric === "latency"
              ? ((prior - curr) / prior) * 100
              : ((curr - prior) / prior) * 100
            : null;
          return {
            value: reg.value,
            label: reg.label.replace(" (perkiraan)", ""),
            curr,
            prior,
            delta,
            color: regionColors[reg.value] ?? "#475569",
          };
        });

        const toggleRegion = (val: string) => {
          setMlSelectedRegions((prev) =>
            prev.includes(val) ? (prev.length > 1 ? prev.filter((r) => r !== val) : prev) : [...prev, val]
          );
        };

        const visibleDeltaItems = deltaItems.filter((item) => mlSelectedRegions.includes(item.value));
        const visibleMaxAbsDelta = Math.max(0.1, ...visibleDeltaItems.map((item) => Math.abs(item.delta ?? 0)));
        const metricUnit = visMetric === "latency" ? "ms" : "Mbps";
        const latestLabel = analysisData.periods.find((p) => p.value === latestP)?.label ?? latestP;
        const priorLabel = yoyP ? (analysisData.periods.find((p) => p.value === yoyP)?.label ?? yoyP) : "—";

        return (
          <div className="analysis-tab-content">
            {/* --- Kontrol Bersama --- */}
            <div className="coverage-panel-filters analysis-filters">
              <label>
                <span>{t("Jaringan")}</span>
                <select onChange={(e) => setVisNetworkType(e.target.value as "mobile" | "fixed")} value={visNetworkType}>
                  <option value="mobile">{t("Mobile")}</option>
                  <option value="fixed">{t("Fixed broadband")}</option>
                </select>
              </label>
              <label>
                <span>{t("Metrik")}</span>
                <select onChange={(e) => setVisMetric(e.target.value as MapMetric)} value={visMetric}>
                  {Object.entries(metricLabels).map(([val, lbl]) => (
                    <option key={val} value={val}>{t(lbl)}</option>
                  ))}
                </select>
              </label>
            </div>

            {visTab === "compare" && (
              <div className="vis-section">
                <div className="vis-section-header">
                  <div>
                    <strong>{t("Jaringan yang dibandingkan")}</strong>
                    <p>{t("Pilih wilayah untuk menyaring perubahan YoY.")}</p>
                  </div>
                </div>
                <div className="ml-region-pills">
                  {analysisData.regions.map((reg) => {
                    const active = mlSelectedRegions.includes(reg.value);
                    return (
                      <button
                        key={reg.value}
                        aria-pressed={active}
                        className={`ml-region-pill${active ? " is-active" : ""}`}
                        onClick={() => toggleRegion(reg.value)}
                        style={active ? { borderColor: regionColors[reg.value], color: regionColors[reg.value], background: `${regionColors[reg.value]}18` } : {}}
                        type="button"
                      >
                        <span className="ml-region-dot" style={{ background: active ? regionColors[reg.value] : "#c8d4ce" }} />
                        {t(reg.label.replace(" (perkiraan)", ""))}
                      </button>
                    );
                  })}
                </div>

                <div className="vis-section-header">
                  <div>
                    <strong>{t("Perubahan YoY per Wilayah")}</strong>
                    <p>{t("Perubahan {metric} ({unit}) dari", { metric: t(metricLabels[visMetric]), unit: metricUnit })} <span className="vis-period-chip">{priorLabel}</span> {t("ke")} <span className="vis-period-chip">{latestLabel}</span></p>
                  </div>
                </div>
                <div className="delta-heatmap-grid">
                  {visibleDeltaItems.map((item) => {
                    const hasData = item.delta !== null;
                    const isPositive = (item.delta ?? 0) >= 0;
                    const pct = hasData ? Math.abs(item.delta!) / visibleMaxAbsDelta : 0;
                    const barColor = !hasData
                      ? "#e2e8e4"
                      : isPositive ? "#16a085" : "#e74c3c";
                    const bgAlpha = Math.round(pct * 0.18 * 255).toString(16).padStart(2, "0");
                    const bgColor = !hasData ? "#f8faf9" : (isPositive ? `#16a085${bgAlpha}` : `#e74c3c${bgAlpha}`);

                    return (
                      <div key={item.value} className="delta-heatmap-card" style={{ background: bgColor }}>
                        <div className="delta-card-top">
                          <span className="delta-card-dot" style={{ background: item.color }} />
                          <span className="delta-card-name">{item.label}</span>
                          {hasData && (
                            <span className={`delta-card-badge ${isPositive ? "is-pos" : "is-neg"}`}>
                              {isPositive ? "▲" : "▼"} {Math.abs(item.delta!).toFixed(1)}%
                            </span>
                          )}
                        </div>
                        <div className="delta-bar-track">
                          <div
                            className="delta-bar-fill"
                            style={{
                              width: `${pct * 100}%`,
                              background: barColor,
                              marginLeft: isPositive ? "0" : "auto",
                            }}
                          />
                        </div>
                        <div className="delta-card-values">
                          <span>
                            {item.prior !== null
                              ? `${priorLabel}: ${visMetric === "latency" ? item.prior.toFixed(1) : (item.prior / 1000).toFixed(1)} ${metricUnit}`
                              : "—"}
                          </span>
                          <span>
                            {item.curr !== null
                              ? `${latestLabel}: ${visMetric === "latency" ? item.curr.toFixed(1) : (item.curr / 1000).toFixed(1)} ${metricUnit}`
                              : "—"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="map-panel-footnote">
                  {t("Positif (hijau) = peningkatan kecepatan / penurunan latensi. Negatif (merah) = penurunan.")}
                  {" "}{t("Perbandingan {from} → {to} ({network}).", { from: priorLabel, to: latestLabel, network: t(visNetworkType === "mobile" ? "Mobile" : "Fixed") })}
                </p>

                <div className="vis-section-header">
                  <div>
                    <strong>{t("Peringkat Akselerasi & Pertumbuhan Wilayah")}</strong>
                    <p>{t("Pertumbuhan YoY untuk {network} · {metric}", { network: t(visNetworkType === "mobile" ? "Mobile" : "Fixed broadband"), metric: t(metricLabels[visMetric]) })}</p>
                  </div>
                  <button
                    className="map-export-button"
                    onClick={() => downloadGrowthCsv(growthData.items, visMetric, visNetworkType)}
                    type="button"
                  >
                    <Icon name="download" size={13} /> {t("Ekspor CSV")}
                  </button>
                </div>
                <div className="gap-kpi-grid">
                  <div className="gap-kpi-card">
                    <span>{t("PERTUMBUHAN NASIONAL (YoY)")}</span>
                    <strong>
                      {growthData.national?.yoyPct !== null && growthData.national?.yoyPct !== undefined
                        ? `${growthData.national.yoyPct > 0 ? "+" : ""}${growthData.national.yoyPct.toFixed(1)}%`
                        : "—"}
                    </strong>
                    <small>{growthData.priorYoYLabel} → {growthData.latestLabel}</small>
                  </div>
                  <div className="gap-kpi-card">
                    <span>{t("AKSELERASI TERTINGGI (YoY)")}</span>
                    <strong>{t(growthData.topGainer?.regionLabel.replace(" (perkiraan)", "") ?? "")}</strong>
                    <small>
                      {growthData.topGainer?.yoyPct !== null && growthData.topGainer?.yoyPct !== undefined
                        ? t("Peningkatan {value}% YoY", { value: `${growthData.topGainer.yoyPct > 0 ? "+" : ""}${growthData.topGainer.yoyPct.toFixed(1)}` })
                        : "—"}
                    </small>
                  </div>
                </div>
                <div className="analysis-table-wrap">
                  <table className="analysis-table">
                    <thead>
                      <tr>
                        <th>{t("No")}</th>
                        <th>{t("Wilayah")}</th>
                        <th>{t("Nilai Terkini")}</th>
                        <th>{t("1 Thn Lalu")}</th>
                        <th>{t("YoY (%)")}</th>
                        <th>{t("QoQ (%)")}</th>
                        <th>{t("5 Tahun (%)")}</th>
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
                            <th scope="row"><strong>{t(item.regionLabel)}</strong></th>
                            <td>{formatValue(item.currentValue, visMetric, numberLocale)}</td>
                            <td>{item.priorYoYValue !== null ? formatValue(item.priorYoYValue, visMetric, numberLocale) : "—"}</td>
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
                <p className="map-panel-footnote">{t("YoY = pertumbuhan dibandingkan kuartal yang sama tahun lalu. 5 Tahun = total perubahan sejak Q4 2021 hingga {period}.", { period: growthData.latestLabel })}</p>
              </div>
            )}

          </div>
        );
      })()}
    </div>
  );
}
