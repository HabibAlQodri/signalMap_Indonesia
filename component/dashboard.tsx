"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const panelItems: { value: PanelName; label: string; short: string; icon: IconName }[] = [
  { value: "layers", label: "Layer peta", short: "Layer", icon: "layers" },
  { value: "coverage", label: "Cakupan wilayah", short: "Cakupan", icon: "globe" },
  { value: "frequency", label: "Frekuensi", short: "Frekuensi", icon: "signal" },
  { value: "summary", label: "Ringkasan data", short: "Ringkasan", icon: "activity" },
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
  const [initialLoading, setInitialLoading] = useState(true);
  const [panel, setPanel] = useState<PanelName | null>(null);
  const [mapMetric, setMapMetric] = useState<MapMetric>("download");
  const [basemap, setBasemap] = useState<Basemap>("voyager");
  const [overlayOn, setOverlayOn] = useState(true);
  const [view3d, setView3d] = useState(false);
  const [regionName, setRegionName] = useState("Indonesia");
  const [focusLocation, setFocusLocation] = useState({
    name: regions[0].name,
    center: regions[0].center,
    zoom: regions[0].zoom,
    key: 0,
  });
  const [query, setQuery] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [shortcutLabel, setShortcutLabel] = useState("Ctrl K");
  const [coverageSearch, setCoverageSearch] = useState("");
  const [provinceFilter, setProvinceFilter] = useState("Semua provinsi");
  const [coverageMetric, setCoverageMetric] = useState<CoverageMetric>("4G");
  const [coverageSort, setCoverageSort] = useState<"low" | "high">("low");
  const [fullscreen, setFullscreen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [announcement, setAnnouncement] = useState("");
  const [regionOpen, setRegionOpen] = useState(false);
  const [regionActive, setRegionActive] = useState(0);
  const regionWrapRef = useRef<HTMLDivElement>(null);
  const regionBtnRef = useRef<HTMLButtonElement>(null);
  const panelCloseRef = useRef<HTMLButtonElement>(null);
  const lastRailButtonRef = useRef<HTMLButtonElement | null>(null);
  const metricButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const finishInitialLoading = useCallback(() => setInitialLoading(false), []);

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
  const suggestions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("id-ID");
    if (!normalized) {
      return { regionHits: regions.slice(0, 6), districtHits: [] as CoverageRow[] };
    }
    return {
      regionHits: regions
        .filter((item) => item.name.toLocaleLowerCase("id-ID").includes(normalized) || item.label.toLocaleLowerCase("id-ID").includes(normalized))
        .slice(0, 4),
      districtHits: coverageData
        .filter(
          (row) =>
            row.district.toLocaleLowerCase("id-ID").includes(normalized) ||
            row.province.toLocaleLowerCase("id-ID").includes(normalized),
        )
        .slice(0, 6),
    };
  }, [query]);
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
    if (/Mac|iPhone|iPad/i.test(navigator.platform)) setShortcutLabel("⌘ K");
  }, []);
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
    openDistrict(query.trim());
  }

  function openDistrict(text: string) {
    setQuery(text);
    setCoverageSearch(text);
    setProvinceFilter("Semua provinsi");
    setCoverageMetric("4G");
    setCoverageSort("low");
    setPanel("coverage");
    setSearchMessage("");
    setSearchFocused(false);
    searchRef.current?.blur();
  }

  function pickRegion(region: (typeof regions)[number]) {
    setQuery(region.label);
    focusMap(region);
    setSearchMessage("");
    setSearchFocused(false);
    searchRef.current?.blur();
  }

  async function toggleFullscreen() {
    if (!workspaceRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await workspaceRef.current.requestFullscreen();
  }

  function showPanel(name: PanelName, trigger?: HTMLButtonElement | null) {
    if (trigger) lastRailButtonRef.current = trigger;
    setPanel((current) => current === name ? null : name);
  }

  function closePanel() {
    setPanel(null);
    window.setTimeout(() => lastRailButtonRef.current?.focus(), 0);
  }

  // Dropdown wilayah kustom (pola listbox): tutup saat klik di luar.
  const currentRegion = regions.find((item) => item.name === regionName) ?? regions[0];
  useEffect(() => {
    if (!regionOpen) return;
    function handleOutside(event: MouseEvent) {
      if (!regionWrapRef.current?.contains(event.target as Node)) setRegionOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [regionOpen]);

  function openRegionMenu() {
    setRegionActive(Math.max(0, regions.findIndex((item) => item.name === currentRegion.name)));
    setRegionOpen(true);
  }

  function chooseRegion(index: number) {
    focusMap(regions[index]);
    setRegionOpen(false);
    regionBtnRef.current?.focus();
  }

  function handleRegionKeys(event: React.KeyboardEvent<HTMLElement>) {
    if (!regionOpen) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openRegionMenu();
      }
      return;
    }
    if (event.key === "ArrowDown") { event.preventDefault(); setRegionActive((v) => (v + 1) % regions.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setRegionActive((v) => (v - 1 + regions.length) % regions.length); }
    else if (event.key === "Home") { event.preventDefault(); setRegionActive(0); }
    else if (event.key === "End") { event.preventDefault(); setRegionActive(regions.length - 1); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseRegion(regionActive); }
    else if (event.key === "Escape") { event.stopPropagation(); event.nativeEvent.stopPropagation(); setRegionOpen(false); regionBtnRef.current?.focus(); }
    else if (event.key === "Tab") setRegionOpen(false);
  }

  // Pindahkan fokus ke panel saat dibuka agar pengguna keyboard/screen reader tidak tertinggal di peta.
  useEffect(() => {
    if (panel) panelCloseRef.current?.focus();
  }, [panel]);

  // Umumkan perubahan metrik & mode 3D untuk pembaca layar.
  useEffect(() => {
    const label = metrics.find((item) => item.value === mapMetric)?.label ?? "";
    setAnnouncement(`${label} ditampilkan${view3d ? ", tampilan 3D aktif" : ""}.`);
  }, [mapMetric, view3d]);

  // Navigasi panah pada grup metrik (pola radiogroup).
  function handleMetricKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const current = metrics.findIndex((item) => item.value === mapMetric);
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % metrics.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + metrics.length) % metrics.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = metrics.length - 1;
    setMapMetric(metrics[next].value);
    metricButtonRefs.current[next]?.focus();
  }

  // Navigasi panah pada daftar saran pencarian (pola combobox).
  const suggestionCount = suggestions.regionHits.length + suggestions.districtHits.length;
  function handleSearchKeys(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!searchFocused || suggestionCount === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((value) => (value + 1) % suggestionCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((value) => (value <= 0 ? suggestionCount - 1 : value - 1));
    } else if (event.key === "Enter" && activeSuggestion >= 0) {
      event.preventDefault();
      const regionCount = suggestions.regionHits.length;
      if (activeSuggestion < regionCount) pickRegion(suggestions.regionHits[activeSuggestion]);
      else openDistrict(suggestions.districtHits[activeSuggestion - regionCount].district);
      setActiveSuggestion(-1);
    } else if (event.key === "Escape") {
      setSearchFocused(false);
      setActiveSuggestion(-1);
    }
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
            <button aria-pressed={view3d} className="map-layer-switch" disabled={!overlayOn} onClick={() => setView3d((value) => !value)}>
              <span className="map-layer-symbol"><Icon name="layers" size={17} /></span>
              <span><strong>Tampilan 3D</strong><small>{view3d ? "Batang tinggi = jumlah tes, hanya area layar" : "Miringkan peta, tampilkan batang"}</small></span>
              <i className={`switch-track ${view3d ? "is-on" : ""}`} />
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
                <span aria-hidden="true" className="coverage-row-bar"><b className={row[coverageMetric] < 0.25 ? "is-low" : ""} style={{ width: `${Math.max(0, Math.min(1, row[coverageMetric])) * 100}%` }} /></span>
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
    <main aria-busy={initialLoading} className="map-workspace" ref={workspaceRef}>
      <MapView
        focusLocation={focusLocation}
        metric={mapMetric}
        basemap={basemap}
        overlayOn={overlayOn}
        view3d={view3d}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        onInitialLoadComplete={finishInitialLoading}
      />

      <header className="map-topbar">
        <h1 className="sr-only">SignalMap: peta performa jaringan seluler Indonesia</h1>
        <Link aria-label="SignalMap peta jaringan" className="map-brand-plate" href="/">
          <span className="map-brand-mark"><Icon name="signal" size={21} /></span>
          <span><strong>signal<span>map</span></strong><small>PETA JARINGAN NUSANTARA</small></span>
        </Link>

        <form className="map-global-search" onSubmit={handleSearch} role="search">
          <Icon name="search" size={17} />
          <input
            aria-activedescendant={activeSuggestion >= 0 ? `search-option-${activeSuggestion}` : undefined}
            aria-autocomplete="list"
            aria-controls="search-listbox"
            aria-expanded={searchFocused && suggestionCount > 0}
            aria-label="Cari wilayah atau provinsi"
            autoComplete="off"
            onBlur={() => { setSearchFocused(false); setActiveSuggestion(-1); }}
            onChange={(event) => { setQuery(event.target.value); setSearchMessage(""); setActiveSuggestion(-1); }}
            onFocus={() => setSearchFocused(true)}
            onKeyDown={handleSearchKeys}
            role="combobox"
            placeholder="Cari wilayah, kabupaten/kota, atau provinsi"
            ref={searchRef}
            value={query}
          />
          {query && (
            <button aria-label="Hapus pencarian" className="map-search-clear" onClick={() => { setQuery(""); setSearchMessage(""); searchRef.current?.focus(); }} onMouseDown={(event) => event.preventDefault()} type="button">
              <Icon name="close" size={14} />
            </button>
          )}
          <kbd>{shortcutLabel}</kbd>
          {searchFocused && (suggestions.regionHits.length > 0 || suggestions.districtHits.length > 0) && (
            <div className="map-search-results" id="search-listbox" onMouseDown={(event) => event.preventDefault()} role="listbox" aria-label="Saran pencarian">
              {suggestions.regionHits.length > 0 && <div className="map-search-heading" role="presentation">{query.trim() ? "WILAYAH PETA" : "LONCAT KE WILAYAH"}</div>}
              {suggestions.regionHits.map((region, i) => (
                <button aria-selected={activeSuggestion === i} className={`map-search-item ${activeSuggestion === i ? "is-active" : ""}`} id={`search-option-${i}`} key={region.name} onClick={() => pickRegion(region)} role="option" tabIndex={-1} type="button">
                  <span className="map-search-item-icon"><Icon name="locate" size={15} /></span>
                  <span><strong>{region.label}</strong><small>Pindahkan peta ke wilayah ini</small></span>
                </button>
              ))}
              {suggestions.districtHits.length > 0 && <div className="map-search-heading" role="presentation">KABUPATEN/KOTA · DATA CAKUPAN</div>}
              {suggestions.districtHits.map((row, j) => (
                <button aria-selected={activeSuggestion === suggestions.regionHits.length + j} className={`map-search-item ${activeSuggestion === suggestions.regionHits.length + j ? "is-active" : ""}`} id={`search-option-${suggestions.regionHits.length + j}`} key={`${row.province}-${row.district}`} onClick={() => openDistrict(row.district)} role="option" tabIndex={-1} type="button">
                  <span className="map-search-item-icon"><Icon name="globe" size={15} /></span>
                  <span><strong>{row.district}</strong><small>{row.province} · 4G {percentage(row["4G"])}</small></span>
                </button>
              ))}
            </div>
          )}
          {searchMessage && <span className="map-search-message" role="status">{searchMessage}</span>}
        </form>

        <div className="map-quick-controls">
          <div className="map-region-select" onKeyDown={handleRegionKeys} ref={regionWrapRef}>
            <button
              aria-activedescendant={regionOpen ? `region-option-${regionActive}` : undefined}
              aria-controls="region-listbox"
              aria-expanded={regionOpen}
              aria-haspopup="listbox"
              aria-label={`Pilih wilayah peta, saat ini ${currentRegion.label}`}
              className="map-region-trigger"
              onClick={() => (regionOpen ? setRegionOpen(false) : openRegionMenu())}
              ref={regionBtnRef}
              type="button"
            >
              <Icon name="globe" size={16} />
              <span>{currentRegion.label}</span>
              <Icon className={`region-chevron ${regionOpen ? "is-open" : ""}`} name="chevron-down" size={14} />
            </button>
            {regionOpen && (
              <ul aria-label="Daftar wilayah" className="map-region-menu" id="region-listbox" role="listbox" tabIndex={-1}>
                {regions.map((region, i) => (
                  <li
                    aria-selected={region.name === currentRegion.name}
                    className={`map-region-option ${i === regionActive ? "is-active" : ""} ${region.name === currentRegion.name ? "is-selected" : ""}`}
                    id={`region-option-${i}`}
                    key={region.name}
                    onClick={() => chooseRegion(i)}
                    onMouseEnter={() => setRegionActive(i)}
                    role="option"
                  >
                    <span>{region.label}</span>
                    {region.name === currentRegion.name && (
                      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24" width="16"><path d="m5 12 5 5 9-10" /></svg>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <span aria-hidden="true" className="map-control-divider" />
          <button
            aria-describedby="view3d-hint"
            aria-pressed={view3d}
            className={`map-3d-toggle ${view3d ? "is-active" : ""}`}
            disabled={!overlayOn}
            onClick={() => setView3d((value) => !value)}
            type="button"
          >
            <Icon name="layers" size={16} />
            <span>Tampilan 3D</span>
            <i aria-hidden="true" className={`switch-track ${view3d ? "is-on" : ""}`} />
          </button>
          <span className="sr-only" id="view3d-hint">
            {overlayOn ? "Miringkan peta dan tampilkan batang tinggi sesuai jumlah tes." : "Tidak tersedia karena overlay hasil pengukuran dinonaktifkan."}
          </span>
          <span aria-hidden="true" className="map-control-divider" />
          <div aria-label="Pilih metrik peta" className="map-quick-metrics" onKeyDown={handleMetricKeys} role="radiogroup">
            {metrics.map((metric, i) => (
              <button
                aria-checked={mapMetric === metric.value}
                aria-label={`${metric.label}: rata-rata ${metric.reading}`}
                className={mapMetric === metric.value ? "is-active" : ""}
                key={metric.value}
                onClick={() => setMapMetric(metric.value)}
                ref={(node) => { metricButtonRefs.current[i] = node; }}
                role="radio"
                tabIndex={mapMetric === metric.value ? 0 : -1}
                title={metric.label}
                type="button"
              >
                <span aria-hidden="true">{metric.short}</span>
                <strong aria-hidden="true">{metric.reading}</strong>
              </button>
            ))}
          </div>
        </div>
      </header>

      <nav aria-label="Kontrol peta" className="map-tool-rail">
        {panelItems.map((item) => (
          <button
            aria-label={item.label}
            aria-controls="map-side-panel"
            aria-expanded={panel === item.value}
            className={panel === item.value ? "is-active" : ""}
            key={item.value}
            onClick={(event) => showPanel(item.value, event.currentTarget)}
            title={item.label}
            type="button"
          >
            <Icon name={item.icon} size={20} />
            <span>{item.short}</span>
          </button>
        ))}
        <span className="map-rail-separator" />
        <button aria-label="Unduh data cakupan CSV" onClick={() => downloadCsv(filteredCoverage)} title="Ekspor cakupan CSV">
          <Icon name="download" size={19} />
          <span>CSV</span>
        </button>
      </nav>

      {panel && (
        <aside aria-label={activePanelItem?.label ?? "Panel peta"} className="map-side-panel" id="map-side-panel">
          <div className="map-panel-header">
            <div>
              <span className="map-panel-kicker">SIGNALMAP / EKSPLORASI</span>
              <h2>{activePanelItem?.label}</h2>
            </div>
            <button aria-label="Tutup panel (Esc)" className="map-panel-close" onClick={closePanel} ref={panelCloseRef} type="button"><Icon name="close" size={17} /></button>
          </div>
          {renderPanelContent()}
        </aside>
      )}

      <div aria-live="polite" className="sr-only" role="status">{announcement}</div>

      <div className="map-bottom-left">
        <span className="map-bottom-pulse" />
        <span>{focusLocation.name}</span>
        <i />
        <span>{overlayOn ? "Ookla mobile" : "Overlay nonaktif"}</span>
      </div>

      <div
        aria-hidden={!initialLoading}
        aria-live="polite"
        className={`dashboard-initial-loading${initialLoading ? "" : " is-ready"}`}
        role="status"
      >
        <div className="dashboard-loading-card">
          <span className="dashboard-loading-mark"><Icon name="signal" size={22} /></span>
          <strong className="dashboard-loading-brand">signal<span>map</span></strong>
          <p>Menyiapkan peta jaringan Indonesia</p>
          <span className="dashboard-loading-status">
            <i className="map-loading-spinner" />
            Memuat peta dasar dan data pengukuran…
          </span>
        </div>
      </div>
    </main>
  );
}