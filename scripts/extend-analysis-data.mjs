import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OOKLA_OUTPUT_DIR = path.join(ROOT, "public", "data", "ookla");
const OOKLA_PERIODS_PATH = path.join(ROOT, "lib", "ookla", "ookla-periods.json");
const OOKLA_ANALYSIS_PATH = path.join(ROOT, "lib", "ookla", "ookla-analysis.json");

const OOKLA_BOUNDS = { west: 90, south: -15, east: 145, north: 15 };

const OOKLA_ANALYSIS_REGIONS = [
  // 8 Wilayah Kepulauan Utama (Utama)
  { value: "indonesia-sekitarnya", label: "Indonesia & sekitar", bounds: OOKLA_BOUNDS, category: "major" },
  { value: "sumatra", label: "Sumatra (perkiraan)", bounds: { west: 94, south: -6.5, east: 106.5, north: 6 }, category: "major" },
  { value: "jawa", label: "Jawa (perkiraan)", bounds: { west: 105, south: -9, east: 115, north: -5 }, category: "major" },
  { value: "bali-nusa-tenggara", label: "Bali & Nusa Tenggara (perkiraan)", bounds: { west: 114, south: -12, east: 128, north: -7 }, category: "major" },
  { value: "kalimantan", label: "Kalimantan (perkiraan)", bounds: { west: 108, south: -5, east: 119, north: 5 }, category: "major" },
  { value: "sulawesi", label: "Sulawesi (perkiraan)", bounds: { west: 118, south: -7, east: 126, north: 3 }, category: "major" },
  { value: "maluku", label: "Maluku (perkiraan)", bounds: { west: 124, south: -9, east: 135, north: 3 }, category: "major" },
  { value: "papua", label: "Papua (perkiraan)", bounds: { west: 130, south: -11, east: 141, north: 1 }, category: "major" },

  // 6 Koridor Strategis & Aglomerasi Ekonomi
  { value: "jabodetabek", label: "Jabodetabek (Kawasan Khusus)", bounds: { west: 106.5, south: -6.65, east: 107.2, north: -6.0 }, category: "corridor" },
  { value: "surabaya-gerbangkertosusila", label: "Surabaya Raya & Sekitar", bounds: { west: 112.4, south: -7.55, east: 113.0, north: -7.1 }, category: "corridor" },
  { value: "medan-sumut", label: "Medan & Sumatra Utara", bounds: { west: 98.3, south: 3.2, east: 99.0, north: 3.9 }, category: "corridor" },
  { value: "bali", label: "Bali (Pusat Pariwisata)", bounds: { west: 114.4, south: -8.9, east: 115.8, north: -8.0 }, category: "corridor" },
  { value: "ikn-kalimantan-timur", label: "Kawasan IKN & Kaltim", bounds: { west: 116.5, south: -1.4, east: 117.5, north: -0.3 }, category: "corridor" },
  { value: "makassar-sulsel", label: "Makassar & Gerbang Timur", bounds: { west: 119.2, south: -5.4, east: 119.8, north: -4.9 }, category: "corridor" }
];

function calculateQoE(downMbps, upMbps, idleLatMs, loadedLatMs) {
  // Streaming 4K: butuh download >= 25 Mbps, toleransi bufferbloat s/d 200ms
  const sSpeed = Math.min(100, (downMbps / 50) * 100);
  const sLat = Math.max(0, 100 - (loadedLatMs / 300) * 100);
  const qoeStreaming = Math.round(sSpeed * 0.7 + sLat * 0.3);

  // Cloud Gaming: sangat sensitif terhadap latency < 35ms dan bufferbloat < 50ms
  const gLat = Math.max(0, 100 - (idleLatMs / 60) * 100);
  const gBuf = Math.max(0, 100 - ((loadedLatMs - idleLatMs) / 120) * 100);
  const qoeGaming = Math.round(gLat * 0.6 + gBuf * 0.4);

  // Video Conference / WFH: butuh upload >= 10 Mbps, latency < 60ms
  const wUp = Math.min(100, (upMbps / 20) * 100);
  const wDown = Math.min(100, (downMbps / 30) * 100);
  const wLat = Math.max(0, 100 - (idleLatMs / 80) * 100);
  const qoeWork = Math.round(wUp * 0.4 + wDown * 0.3 + wLat * 0.3);

  // Overall Quality Score (0-100)
  const qoeOverall = Math.round(qoeStreaming * 0.35 + qoeGaming * 0.35 + qoeWork * 0.30);

  return {
    qoeStreaming: Math.min(100, Math.max(10, qoeStreaming)),
    qoeGaming: Math.min(100, Math.max(10, qoeGaming)),
    qoeWork: Math.min(100, Math.max(10, qoeWork)),
    qoeOverall: Math.min(100, Math.max(10, qoeOverall)),
  };
}

async function run() {
  console.log("Membaca periode dari:", OOKLA_PERIODS_PATH);
  const periodsData = JSON.parse(fs.readFileSync(OOKLA_PERIODS_PATH, "utf-8"));
  const periodValues = new Set(periodsData.periods.map((p) => p.value));

  const jsonFiles = fs.readdirSync(OOKLA_OUTPUT_DIR).filter((f) => f.endsWith(".json")).sort();
  console.log(`Ditemukan ${jsonFiles.length} file datasets Ookla di ${OOKLA_OUTPUT_DIR}`);

  const entries = [];

  for (const filename of jsonFiles) {
    const filePath = path.join(OOKLA_OUTPUT_DIR, filename);
    const dataset = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const period = dataset.period;
    if (!periodValues.has(period)) continue;

    const [yearStr, monthStr] = period.split("-");
    const year = parseInt(yearStr, 10);
    const quarter = Math.floor((parseInt(monthStr, 10) - 1) / 3) + 1;
    const periodLabel = `Q${quarter} ${year}`;
    const networkType = dataset.networkType;

    for (const region of OOKLA_ANALYSIS_REGIONS) {
      const { west, south, east, north } = region.bounds;
      let totalTests = 0;
      let totalDevices = 0;
      let weightedDownload = 0;
      let weightedUpload = 0;
      let weightedLatency = 0;
      let weightedLatencyDown = 0;
      let weightedLatencyUp = 0;
      let cellCount = 0;

      for (const cell of dataset.cells) {
        const [lon, lat, down, up, latMs, tests, devices, _r, latDown, latUp] = cell;
        if (lon >= west && lon <= east && lat >= south && lat <= north) {
          totalTests += tests;
          totalDevices += devices;
          weightedDownload += down * tests;
          weightedUpload += up * tests;
          weightedLatency += latMs * tests;
          weightedLatencyDown += (latDown ?? latMs) * tests;
          weightedLatencyUp += (latUp ?? latMs) * tests;
          cellCount++;
        }
      }

      if (!totalTests) continue;

      const avgDownloadKbps = weightedDownload / totalTests;
      const avgUploadKbps = weightedUpload / totalTests;
      const avgLatencyMs = weightedLatency / totalTests;
      const avgLatencyDownMs = weightedLatencyDown / totalTests;
      const avgLatencyUpMs = weightedLatencyUp / totalTests;
      const bufferbloatMs = Math.max(0, avgLatencyDownMs - avgLatencyMs);

      const qoe = calculateQoE(
        avgDownloadKbps / 1000,
        avgUploadKbps / 1000,
        avgLatencyMs,
        avgLatencyDownMs
      );

      entries.push({
        period,
        year,
        quarter,
        periodLabel,
        networkType,
        region: region.value,
        cells: cellCount,
        tests: totalTests,
        devices: totalDevices,
        avgDownloadKbps,
        avgUploadKbps,
        avgLatencyMs,
        avgLatencyDownMs,
        avgLatencyUpMs,
        bufferbloatMs: Math.round(bufferbloatMs * 10) / 10,
        ...qoe,
      });
    }
  }

  console.log(`Berhasil mengekstrak ${entries.length} entri riwayat.`);

  // --- Tambahkan Proyeksi Masa Depan (Forecast Q4 2026, Q1 2027, Q2 2027) ---
  const forecastPeriods = [
    { value: "2026-10-01", label: "Q4 2026", isForecast: true },
    { value: "2027-01-01", label: "Q1 2027", isForecast: true },
    { value: "2027-04-01", label: "Q2 2027", isForecast: true },
  ];

  for (const fPeriod of forecastPeriods) {
    const [yearStr, monthStr] = fPeriod.value.split("-");
    const year = parseInt(yearStr, 10);
    const quarter = Math.floor((parseInt(monthStr, 10) - 1) / 3) + 1;

    for (const netType of ["mobile", "fixed"]) {
      for (const reg of OOKLA_ANALYSIS_REGIONS) {
        // Ambil riwayat 4 kuartal terakhir untuk tren
        const history = entries
          .filter((e) => e.region === reg.value && e.networkType === netType)
          .sort((a, b) => a.period.localeCompare(b.period));

        if (history.length < 4) continue;
        const last1 = history[history.length - 1];
        const last4 = history[history.length - 4];

        // Estimasi pertumbuhan per kuartal
        const downGrowth = Math.max(1.01, Math.min(1.08, Math.pow(last1.avgDownloadKbps / last4.avgDownloadKbps, 0.25)));
        const upGrowth = Math.max(1.01, Math.min(1.08, Math.pow(last1.avgUploadKbps / last4.avgUploadKbps, 0.25)));
        const latChange = Math.max(0.96, Math.min(1.01, Math.pow(last1.avgLatencyMs / last4.avgLatencyMs, 0.25)));

        const projDownload = last1.avgDownloadKbps * downGrowth;
        const projUpload = last1.avgUploadKbps * upGrowth;
        const projLat = last1.avgLatencyMs * latChange;
        const projLatDown = (last1.avgLatencyDownMs ?? projLat) * latChange;
        const projLatUp = (last1.avgLatencyUpMs ?? projLat) * latChange;
        const projTests = Math.round(last1.tests * 1.02);
        const projDevices = Math.round(last1.devices * 1.02);
        const bufferbloatMs = Math.max(0, projLatDown - projLat);

        const qoe = calculateQoE(
          projDownload / 1000,
          projUpload / 1000,
          projLat,
          projLatDown
        );

        entries.push({
          period: fPeriod.value,
          year,
          quarter,
          periodLabel: `${fPeriod.label} (proyeksi)`,
          networkType: netType,
          region: reg.value,
          cells: last1.cells,
          tests: projTests,
          devices: projDevices,
          avgDownloadKbps: projDownload,
          avgUploadKbps: projUpload,
          avgLatencyMs: projLat,
          avgLatencyDownMs: projLatDown,
          avgLatencyUpMs: projLatUp,
          bufferbloatMs: Math.round(bufferbloatMs * 10) / 10,
          isForecast: true,
          ...qoe,
        });
      }
    }
  }

  const allPeriods = [
    ...forecastPeriods.slice().reverse(),
    ...periodsData.periods,
  ];

  const outputData = {
    regions: OOKLA_ANALYSIS_REGIONS.map((r) => ({
      value: r.value,
      label: r.label,
      bounds: r.bounds,
      category: r.category,
    })),
    periods: allPeriods,
    latestHistoricalPeriod: periodsData.latestPeriod,
    latestPeriod: periodsData.latestPeriod, // tetap jadikan Q3 2026 data riil terkini
    note: "Analisis wilayah memakai kotak koordinat perkiraan dan titik tengah sel quadkey level 12, bukan batas administrasi murni. Dilengkapi metrik QoE, Bufferbloat, dan proyeksi tren.",
    entries,
  };

  fs.writeFileSync(OOKLA_ANALYSIS_PATH, JSON.stringify(outputData, null, 2), "utf-8");
  console.log(`Berhasil menyimpan ${entries.length} entri analisis ke ${OOKLA_ANALYSIS_PATH}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
