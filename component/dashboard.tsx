"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import coverageData from "../lib/coverage-data.json";
import frequencyData from "../lib/frequency-data.json";
import ooklaSummary from "../lib/ookla-summary.json";
import { formatNumber, regions } from "../lib/network-data";
import Icon, { type IconName } from "./icon";
import MapView, { type Basemap, type MapMetric } from "./mapview";

type CoverageMetric = "2G" | "3G" | "4G" | "5G";
type CoverageRow = (typeof coverageData)[number];
type PanelName = "layers" | "coverage" | "frequency" | "summary";

const coverageMetrics: CoverageMetric[] = ["2G", "3G", "4G", "5G"];
const metricLabels: Record<CoverageMetric, string> = {
  "2G": "Cakupan 2G",
  "3G": "Cakupan 3G",
  "4G": "Cakupan 4G",
  "5G": "Cakupan 5G",
};
const metrics: { value: MapMetric; label: string; short: string; reading: string }[] = [
  {
    value: "download",
    label: "Kecepatan unduh",
    short: "Unduh",
    reading: `${(ooklaSummary.avgDownloadKbps / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} Mbps`,
  },
  {
    value: "upload",
    label: "Kecepatan unggah",
    short: "Unggah",
    reading: `${(ooklaSummary.avgUploadKbps / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} Mbps`,
  },
  {
    value: "latency",
    label: "Latensi",
    short: "Latensi",
    reading: `${ooklaSummary.avgLatencyMs.toLocaleString("id-ID")} ms`,
  },
];
const panelItems: { value: PanelName; label: string; icon: IconName }[] = [
  { value: "layers", label: "Layer peta", icon: "layers" },
  { value: "coverage", label: "Cakupan wilayah", icon: "globe" },
  { value: "frequency", label: "Frekuensi", icon: "signal" },
  { value: "summary", label: "Ringkasan data", icon: "activity" },
];

function percentage(value: number) {
  return `${(value * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}

function downloadCsv(rows: CoverageRow[]) {
  const content = [
    ["Provinsi", "Kabupaten/Kota", "2G", "3G", "4G", "5G"],
    ...rows.map((row) => [
      row.province,
      row.district,
      ...coverageMetrics.map((metric) => percentage(row[metric])),
    ]),
  ]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "signalmap-cakupan-kabupaten-kota.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Dashboard() {
  const [panel, setPanel] = useState<PanelName | null>("layers");
  const [mapMetric, setMapMetric] = useState<MapMetric>("download");
  const [basemap, setBasemap] = useState<Basemap>("voyager");
  const [overlayOn, setOverlayOn] = useState(true);
  const [regionName, setRegionName] = useState("Indonesia");
  const [focusLocation, setFocusLocation] = useState({
    name: regions[0].name,
    center: regions[0].center,
    zoom: regions[0].zoom,
    key: 0,
  });
  const [query, setQuery] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const [coverageSearch, setCoverageSearch] = useState("");
  const [provinceFilter, setProvinceFilter] = useState("Semua provinsi");
  const [coverageMetric, setCoverageMetric] = useState<CoverageMetric>("4G");
  const [coverageSort, setCoverageSort] = useState<"low" | "high">("low");
  const [fullscreen, setFullscreen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const provinces = useMemo(
    () => [...new Set(coverageData.map((row) => row.province))].sort((a, b) => a.localeCompare(b, "id")),
    [],
  );
  const filteredCoverage = useMemo(() => {
    const normalizedSearch = coverageSearch.trim().toLocaleLowerCase("id-ID");
    return coverageData
      .filter((row) => provinceFilter === "Semua provinsi" || row.province === provinceFilter)
      .filter(
        (row) =>
          !normalizedSearch ||
          row.district.toLocaleLowerCase("id-ID").includes(normalizedSearch) ||
          row.province.toLocaleLowerCase("id-ID").includes(normalizedSearch),
      )
      .sort((a, b) =>
        coverageSort === "low" ? a[coverageMetric] - b[coverageMetric] : b[coverageMetric] - a[coverageMetric],
      );
  }, [coverageMetric, coverageSearch, coverageSort, provinceFilter]);
  const coverageAverages = useMemo(
    () =>
      Object.fromEntries(
        coverageMetrics.map((metric) => [
          metric,
          coverageData.reduce((sum, row) => sum + row[metric], 0) / coverageData.length,
        ]),
      ) as Record<CoverageMetric, number>,
    [],
  );
  useEffect(() => {
    function handleShortcuts(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        setPanel(null);
        searchRef.current?.blur();
      }
    }
    function handleFullscreenChange() {
      setFullscreen(document.fullscreenElement === workspaceRef.current);
    }
    window.addEventListener("keydown", handleShortcuts);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      window.removeEventListener("keydown", handleShortcuts);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  function focusMap(region: (typeof regions)[number]) {
    setRegionName(region.name);
    setFocusLocation((current) => ({
      name: region.name,
      center: region.center,
      zoom: region.zoom,
      key: current.key + 1,
    }));
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID");
    if (!normalizedQuery) return;
    const region = regions.find((item) => item.name.toLocaleLowerCase("id-ID").includes(normalizedQuery));
    if (region) {
      focusMap(region);
      setSearchMessage("");
      return;
    }
    const district = coverageData.find(
      (row) =>
        row.district.toLocaleLowerCase("id-ID").includes(normalizedQuery) ||
        row.province.toLocaleLowerCase("id-ID").includes(normalizedQuery),
    );
    if (!district) {
      setSearchMessage("Wilayah belum ditemukan di data cakupan.");
      return;
    }
    setCoverageSearch(query.trim());
    setProvinceFilter("Semua provinsi");
    setCoverageMetric("4G");
    setCoverageSort("low");
    setPanel("coverage");
    setSearchMessage("");
  }

  async function toggleFullscreen() {
    if (!workspaceRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await workspaceRef.current.requestFullscreen();
  }

  function showPanel(name: PanelName) {
    setPanel((current) => current === name ? null : name);
  }

  function renderPanelContent() {
    if (panel === "layers") {
      return (
        <div className="map-panel-body">
          <div className="map-control-section">
            <div className="map-section-heading"><span>PERFORMA JARINGAN</span><span className="map-source-chip">OOKLA · Q1 2026</span></div>
            <button aria-pressed={overlayOn} className="map-layer-switch" onClick={() => setOverlayOn((value) => !value)}>
              <span className="map-layer-symbol"><Icon name="activity" size={17} /></span>
              <span><strong>Hasil pengukuran</strong><small>{overlayOn ? "Overlay performa aktif" : "Overlay disembunyikan"}</small></span>
              <i className={`switch-track ${overlayOn ? "is-on" : ""}`} />
            </button>
            <div className="map-option-label">Tampilkan metrik</div>
            <div className="metric-choice-grid">
              {metrics.map((metric) => (
                <button
                  aria-pressed={mapMetric === metric.value}
                  className={mapMetric === metric.value ? "is-active" : ""}
                  key={metric.value}
                  onClick={() => setMapMetric(metric.value)}
                >
                  <span>{metric.value === "download" ? "↓" : metric.value === "upload" ? "↑" : "◷"}</span>
                  <span>{metric.short}<small>{metric.reading}</small></span>
                </button>
              ))}
            </div>
            <p className="map-option-hint">Titik menandai sel ukur; halo warna membantu menghubungkan hasil di area berdekatan. Klik titik untuk detail.</p>
          </div>

          <div className="map-control-section">
            <div className="map-section-heading"><span>PETA DASAR</span></div>
            <div className="basemap-choices">
              {([
                { value: "voyager", label: "Nusantara", description: "Jalan & wilayah" },
                { value: "light", label: "Terang", description: "OpenStreetMap" },
                { value: "dark", label: "Gelap", description: "Kontras rendah cahaya" },
              ] as const).map((item) => (
                <button
                  aria-pressed={basemap === item.value}
                  className={`basemap-choice basemap-swatch-${item.value} ${basemap === item.value ? "is-active" : ""}`}
                  key={item.value}
                  onClick={() => setBasemap(item.value)}
                >
                  <span />
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="map-control-section">
            <div className="map-section-heading"><span>CAKUPAN RADIO</span></div>
            <div className="map-source-note">
              <Icon name="globe" size={17} />
              <p>Data 2G–5G tersedia per kabupaten/kota, tetapi sumbernya tidak menyertakan batas peta untuk menggambar layer geografis.</p>
            </div>
            <button className="map-inline-action" onClick={() => setPanel("coverage")}>Lihat cakupan per wilayah <span>→</span></button>
          </div>
        </div>
      );
    }

    if (panel === "coverage") {
      return (
        <div className="map-panel-body">
          <div className="coverage-panel-summary">
            <div><strong>{formatNumber(coverageData.length)}</strong><span>kabupaten/kota</span></div>
            <div><strong>{percentage(coverageAverages[coverageMetric])}</strong><span>rata-rata {coverageMetric}</span></div>
          </div>
          <p className="map-panel-caption">Rata-rata sederhana antarwilayah, bukan estimasi berbobot penduduk.</p>
          <label className="panel-search">
            <Icon name="search" size={15} />
            <input
              aria-label="Cari dalam data cakupan"
              onChange={(event) => setCoverageSearch(event.target.value)}
              placeholder="Cari kabupaten/kota..."
              value={coverageSearch}
            />
          </label>
          <div className="coverage-panel-filters">
            <select aria-label="Filter provinsi" onChange={(event) => setProvinceFilter(event.target.value)} value={provinceFilter}>
              <option>Semua provinsi</option>
              {provinces.map((province) => <option key={province}>{province}</option>)}
            </select>
            <select aria-label="Pilih teknologi" onChange={(event) => setCoverageMetric(event.target.value as CoverageMetric)} value={coverageMetric}>
              {coverageMetrics.map((metric) => <option key={metric} value={metric}>{metricLabels[metric]}</option>)}
            </select>
            <button
              aria-label={coverageSort === "low" ? "Urutkan tertinggi dulu" : "Urutkan terendah dulu"}
              className="map-sort-button"
              onClick={() => setCoverageSort((value) => value === "low" ? "high" : "low")}
              title={coverageSort === "low" ? "Terendah dulu" : "Tertinggi dulu"}
            >
              {coverageSort === "low" ? "↑ Rendah" : "↓ Tinggi"}
            </button>
          </div>
          <div className="coverage-ranked-list">
            {filteredCoverage.slice(0, 40).map((row) => (
              <article className="coverage-ranked-row" key={`${row.province}-${row.district}`}>
                <span className={`coverage-rank-dot ${row[coverageMetric] < 0.25 ? "is-low" : ""}`} />
                <div><strong>{row.district}</strong><small>{row.province}</small></div>
                <strong className={row[coverageMetric] < 0.25 ? "is-low" : ""}>{percentage(row[coverageMetric])}</strong>
              </article>
            ))}
            {filteredCoverage.length === 0 && <p className="map-panel-empty">Tidak ada wilayah yang cocok.</p>}
          </div>
          <div className="map-panel-bottom">
            <span>Menampilkan {Math.min(40, filteredCoverage.length)} dari {formatNumber(filteredCoverage.length)}</span>
            <button onClick={() => downloadCsv(filteredCoverage)}><Icon name="download" size={14} /> Ekspor CSV</button>
          </div>
          <p className="map-panel-footnote">Periode data cakupan tidak tercantum pada lembar sumber. Ini adalah daftar, bukan layer batas wilayah.</p>
        </div>
      );
    }

    if (panel === "frequency") {
      return (
        <div className="map-panel-body">
          <p className="map-panel-intro">Data izin pita frekuensi radio untuk mobile broadband, berdasarkan sumber tahun 2023.</p>
          <div className="frequency-panel-list">
            {frequencyData.map((item) => (
              <article className="frequency-panel-row" key={item.band}>
                <div className="frequency-panel-head"><strong>{item.band}</strong><span>{item.bandwidth}</span></div>
                <p>{item.range}</p>
                <small>{item.holders.join(" · ")}</small>
              </article>
            ))}
          </div>
          <p className="map-panel-footnote">Lebar pita tiap pemegang izin berbeda. Data alokasi ini tidak menunjukkan performa aktual operator.</p>
        </div>
      );
    }

    return (
      <div className="map-panel-body">
        <div className="map-stat-lead">
          <span className="map-stat-kicker">PENGUKURAN MOBILE · Q1 2026</span>
          <strong>{(ooklaSummary.avgDownloadKbps / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}<small>Mbps</small></strong>
          <span>kecepatan unduh rata-rata tertimbang tes</span>
        </div>
        <div className="map-stat-grid">
          <div><span>Unggah</span><strong>{(ooklaSummary.avgUploadKbps / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} Mbps</strong></div>
          <div><span>Latensi</span><strong>{ooklaSummary.avgLatencyMs.toLocaleString("id-ID")} ms</strong></div>
          <div><span>Tes tercatat</span><strong>{formatNumber(ooklaSummary.tests)}</strong></div>
          <div><span>Perangkat</span><strong>{formatNumber(ooklaSummary.devices)}</strong></div>
          <div><span>Sel asli</span><strong>{formatNumber(ooklaSummary.records)}</strong></div>
          <div><span>Sel peta</span><strong>{formatNumber(ooklaSummary.aggregatedCells)}</strong></div>
        </div>
        <div className="map-section-heading"><span>RATA-RATA CAKUPAN · {coverageData.length} WILAYAH</span></div>
        <div className="map-coverage-bars">
          {coverageMetrics.map((metric) => (
            <div key={metric}><span>{metric}</span><i><b style={{ width: `${coverageAverages[metric] * 100}%` }} /></i><strong>{percentage(coverageAverages[metric])}</strong></div>
          ))}
        </div>
        <p className="map-panel-footnote">Sumber data berasal dari periode dan metode berbeda; jangan gunakan rata-rata ini sebagai perbandingan antaroperator.</p>
      </div>
    );
  }

  const activePanelItem = panelItems.find((item) => item.value === panel);

  return (
    <main className="map-workspace" ref={workspaceRef}>
      <MapView
        key={focusLocation.key}
        focusLocation={focusLocation}
        metric={mapMetric}
        basemap={basemap}
        overlayOn={overlayOn}
      />

      <header className="map-topbar">
        <Link aria-label="SignalMap peta jaringan" className="map-brand-plate" href="/">
          <span className="map-brand-mark"><Icon name="signal" size={21} /></span>
          <span><strong>signal<span>map</span></strong><small>PETA JARINGAN NUSANTARA</small></span>
        </Link>

        <form className="map-global-search" onSubmit={handleSearch}>
          <Icon name="search" size={16} />
          <input
            aria-label="Cari wilayah atau provinsi"
            autoComplete="off"
            list="map-search-suggestions"
            onChange={(event) => { setQuery(event.target.value); setSearchMessage(""); }}
            placeholder="Cari wilayah atau provinsi"
            ref={searchRef}
            value={query}
          />
          <datalist id="map-search-suggestions">
            {coverageData.map((row) => <option key={`${row.province}-${row.district}`} value={row.district} />)}
            {regions.map((region) => <option key={region.name} value={region.name} />)}
          </datalist>
          <kbd>⌘ K</kbd>
          {searchMessage && <span className="map-search-message" role="status">{searchMessage}</span>}
        </form>

        <div className="map-quick-controls">
          <label className="map-region-select">
            <Icon name="globe" size={15} />
            <select aria-label="Pilih wilayah peta" onChange={(event) => {
              const region = regions.find((item) => item.name === event.target.value);
              if (region) focusMap(region);
            }} value={regionName}>
              {regions.map((region) => <option key={region.name} value={region.name}>{region.label}</option>)}
            </select>
            <Icon name="chevron-down" size={13} />
          </label>
          <div aria-label="Pilih metrik peta" className="map-quick-metrics" role="group">
            {metrics.map((metric) => (
              <button
                aria-pressed={mapMetric === metric.value}
                className={mapMetric === metric.value ? "is-active" : ""}
                key={metric.value}
                onClick={() => setMapMetric(metric.value)}
                title={metric.label}
              >
                <span>{metric.short}</span>
                <strong>{metric.reading}</strong>
              </button>
            ))}
          </div>
        </div>
      </header>

      <nav aria-label="Kontrol peta" className="map-tool-rail">
        {panelItems.map((item) => (
          <button
            aria-label={item.label}
            aria-pressed={panel === item.value}
            className={panel === item.value ? "is-active" : ""}
            key={item.value}
            onClick={() => showPanel(item.value)}
            title={item.label}
          >
            <Icon name={item.icon} size={19} />
          </button>
        ))}
        <span className="map-rail-separator" />
        <button aria-label="Unduh data cakupan CSV" onClick={() => downloadCsv(filteredCoverage)} title="Ekspor cakupan CSV">
          <Icon name="download" size={18} />
        </button>
      </nav>

      {panel && (
        <aside aria-label={activePanelItem?.label ?? "Panel peta"} className="map-side-panel">
          <div className="map-panel-header">
            <div>
              <span className="map-panel-kicker">SIGNALMAP / EKSPLORASI</span>
              <h1>{activePanelItem?.label}</h1>
            </div>
            <button aria-label="Tutup panel" className="map-panel-close" onClick={() => setPanel(null)}><Icon name="close" size={17} /></button>
          </div>
          {renderPanelContent()}
        </aside>
      )}

      <div className="map-bottom-left">
        <span className="map-bottom-pulse" />
        <span>{focusLocation.name}</span>
        <i />
        <span>{overlayOn ? "Ookla mobile" : "Overlay nonaktif"}</span>
      </div>
      <button aria-label={fullscreen ? "Keluar dari layar penuh" : "Layar penuh"} className="map-fullscreen-button" onClick={toggleFullscreen} title={fullscreen ? "Keluar dari layar penuh" : "Layar penuh"}>
        <Icon name="expand" size={17} />
      </button>
    </main>
  );
}
