"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatNumber, regions } from "../lib/network-data";
import { useLanguage } from "../lib/i18n";
import ooklaPeriods from "../lib/ookla-periods.json";
import {
  type OoklaMetadata,
  type OoklaData,
  type OoklaNetworkType,
  formatOoklaNetworkType,
  formatOoklaPeriod,
} from "../lib/ookla-data";
import Icon, { type IconName } from "./icon";
import MapView, { type Basemap, type MapMetric, type MapViewMode } from "./mapview";
import AnalysisPanel from "./analysis-panel";
import TimeLapsePlayer from "./timelapse-player";

type PanelName = "layers" | "analysis" | "visualization";

const metrics: { value: MapMetric; label: string; short: string }[] = [
  { value: "download", label: "Kecepatan unduh", short: "Unduh" },
  { value: "upload", label: "Kecepatan unggah", short: "Unggah" },
  { value: "latency", label: "Latensi", short: "Latensi" },
];
const panelItems: { value: PanelName; label: string; short: string; icon: IconName }[] = [
  { value: "analysis", label: "Analisis data", short: "Analisis", icon: "activity" },
  { value: "visualization", label: "Visualisasi", short: "Visualisasi", icon: "bar-chart" },
  { value: "layers", label: "Layer peta", short: "Layer", icon: "layers" },
];

function metricReading(metric: MapMetric, data: OoklaMetadata | null, locale = "id-ID") {
  if (!data) return "—";
  if (metric === "download") {
    return `${(data.avgDownloadKbps / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} Mbps`;
  }
  if (metric === "upload") {
    return `${(data.avgUploadKbps / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} Mbps`;
  }
  return `${data.avgLatencyMs.toLocaleString(locale)} ms`;
}

function downloadMapCsv(data: OoklaData) {
  const rows = [
    ["periode", "jaringan", "longitude", "latitude", "unduh_mbps", "unggah_mbps", "latensi_ms", "tes", "perangkat", "jumlah_sel_gabungan"],
    ...data.cells.map((cell) => [
      data.periodLabel,
      data.networkLabel,
      cell[0].toFixed(6),
      cell[1].toFixed(6),
      (cell[2] / 1000).toFixed(2),
      (cell[3] / 1000).toFixed(2),
      cell[4].toFixed(2),
      cell[5],
      cell[6],
      cell[7] ?? 1,
    ]),
  ].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", rows], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `ookla-peta-${data.networkType}-${data.period}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Dashboard() {
  const { t, locale } = useLanguage();
  const numberLocale = locale === "en" ? "en-US" : "id-ID";
  const [initialLoading, setInitialLoading] = useState(true);
  const [panel, setPanel] = useState<PanelName | null>("analysis");
  const [mapMetric, setMapMetric] = useState<MapMetric>("download");
  const [ooklaNetworkType, setOoklaNetworkType] = useState<OoklaNetworkType>("mobile");
  const [ooklaPeriod, setOoklaPeriod] = useState(ooklaPeriods.latestPeriod);
  const [loadedOoklaSummary, setLoadedOoklaSummary] = useState<OoklaMetadata | null>(null);
  const [loadedOoklaMapData, setLoadedOoklaMapData] = useState<OoklaData | null>(null);
  const ooklaSummary =
    loadedOoklaSummary?.networkType === ooklaNetworkType && loadedOoklaSummary.period === ooklaPeriod
      ? loadedOoklaSummary
      : null;
  const ooklaMapData =
    loadedOoklaMapData?.networkType === ooklaNetworkType && loadedOoklaMapData.period === ooklaPeriod
      ? loadedOoklaMapData
      : null;
  const [basemap, setBasemap] = useState<Basemap>("voyager");
  const [overlayOn, setOverlayOn] = useState(true);
  const [view3d, setView3d] = useState(false);
  const [viewMode, setViewMode] = useState<MapViewMode>("normal");

  const referencePeriod = useMemo(() => {
    const [y, m, d] = ooklaPeriod.split("-").map(Number);
    const prior = `${y - 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return ooklaPeriods.periods.some((p) => p.value === prior) ? prior : null;
  }, [ooklaPeriod]);

  const hasReferencePeriod = referencePeriod !== null;

  function toggleViewMode() {
    if (viewMode === "delta") {
      setViewMode("normal");
    } else {
      if (hasReferencePeriod) {
        setViewMode("delta");
      }
    }
  }

  function toggleNetworkType() {
    setOoklaNetworkType((curr) => (curr === "mobile" ? "fixed" : "mobile"));
  }

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
  const [fullscreen, setFullscreen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
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
  const updateOoklaSummary = useCallback((data: OoklaMetadata | null) => setLoadedOoklaSummary(data), []);
  const updateOoklaMapData = useCallback((data: OoklaData | null) => setLoadedOoklaMapData(data), []);

  const suggestions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale === "en" ? "en-US" : "id-ID");
    if (!normalized) {
      return regions.slice(0, 6);
    }
    return regions
      .filter((item) => item.name.toLocaleLowerCase(locale === "en" ? "en-US" : "id-ID").includes(normalized) || t(item.label).toLocaleLowerCase(locale === "en" ? "en-US" : "id-ID").includes(normalized))
      .slice(0, 6);
  }, [locale, query, t]);
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
    const normalizedQuery = query.trim().toLocaleLowerCase(locale === "en" ? "en-US" : "id-ID");
    if (!normalizedQuery) return;
    const region = regions.find((item) => item.name.toLocaleLowerCase(locale === "en" ? "en-US" : "id-ID").includes(normalizedQuery) || t(item.label).toLocaleLowerCase(locale === "en" ? "en-US" : "id-ID").includes(normalizedQuery));
    if (region) {
      focusMap(region);
      setSearchMessage("");
      return;
    }
    setSearchMessage(t("Wilayah belum ditemukan. Coba nama wilayah pada daftar peta."));
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

  const metricLabel = t(metrics.find((item) => item.value === mapMetric)?.label ?? "");
  const announcement = `${metricLabel} ${locale === "en" ? "shown" : "ditampilkan"}${view3d ? `, ${t("Tampilan 3D")} ${locale === "en" ? "on" : "aktif"}` : ""}.`;

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
  const suggestionCount = suggestions.length;
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
      pickRegion(suggestions[activeSuggestion]);
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
            <div className="map-section-heading">
              <span>{t("PERFORMA JARINGAN")}</span>
              <span className="map-source-chip">
                OOKLA · {(ooklaSummary?.networkLabel ?? formatOoklaNetworkType(ooklaNetworkType)).toLocaleUpperCase("id-ID")} · {ooklaSummary?.periodLabel ?? formatOoklaPeriod(ooklaPeriod)}
              </span>
            </div>
            <div className="ookla-data-selects">
              <label>
                <span>{t("Jenis jaringan")}</span>
                <select
                  aria-label={t("Pilih jenis jaringan Ookla")}
                  onChange={(event) => setOoklaNetworkType(event.target.value as OoklaNetworkType)}
                  value={ooklaNetworkType}
                >
                  <option value="mobile">Mobile</option>
                  <option value="fixed">Fixed broadband</option>
                </select>
              </label>
              <label>
                <span>{t("Periode")}</span>
                <select
                  aria-label={t("Pilih periode data Ookla")}
                  onChange={(event) => setOoklaPeriod(event.target.value)}
                  value={ooklaPeriod}
                >
                  {ooklaPeriods.periods.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ookla-period-summary" aria-live="polite">
              <span>{t("Data yang ditampilkan")}</span>
              <strong>{ooklaSummary?.periodLabel ?? formatOoklaPeriod(ooklaPeriod)}</strong>
              <small>{ooklaSummary ? `${formatNumber(ooklaSummary.tests, numberLocale)} ${t("tes")} · ${formatNumber(ooklaSummary.devices, numberLocale)} ${t("perangkat")}` : t("Jumlah tes dimuat bersama data peta")}</small>
            </div>
            <button
              className="map-export-button map-data-export"
              disabled={!ooklaMapData}
              onClick={() => ooklaMapData && downloadMapCsv(ooklaMapData)}
              type="button"
            >
              <Icon name="download" size={14} />
              {t("Ekspor {count} sel peta CSV", { count: formatNumber(ooklaMapData?.aggregatedCells ?? 0, numberLocale) })}
            </button>
            <p className="map-panel-footnote">{t("Ekspor berisi sel quadkey agregat untuk jaringan dan periode terpilih, bukan tes individual.")}</p>
            <button aria-pressed={overlayOn} className="map-layer-switch" onClick={() => setOverlayOn((value) => !value)}>
              <span className="map-layer-symbol"><Icon name="activity" size={17} /></span>
              <span><strong>{t("Hasil pengukuran")}</strong><small>{overlayOn ? t("Overlay {network} aktif", { network: (ooklaSummary?.networkLabel ?? formatOoklaNetworkType(ooklaNetworkType)).toLocaleLowerCase(locale === "en" ? "en-US" : "id-ID") }) : t("Overlay disembunyikan")}</small></span>
              <i className={`switch-track ${overlayOn ? "is-on" : ""}`} />
            </button>
            <button
              aria-pressed={viewMode === "delta"}
              className="map-layer-switch"
              disabled={!hasReferencePeriod && viewMode !== "delta"}
              onClick={toggleViewMode}
            >
              <span className="map-layer-symbol"><Icon name="trending-up" size={17} /></span>
              <span>
                <strong>{t("Mode Pertumbuhan YoY")}</strong>
                <small>{viewMode === "delta" ? t("Membandingkan dengan 1 thn lalu ({period})", { period: referencePeriod ? formatOoklaPeriod(referencePeriod) : "—" }) : (hasReferencePeriod ? t("Bandingkan dengan {period}", { period: referencePeriod ? formatOoklaPeriod(referencePeriod) : "—" }) : t("Perlu data 1 thn sebelumnya"))}</small>
              </span>
              <i className={`switch-track ${viewMode === "delta" ? "is-on" : ""}`} />
            </button>
            <button aria-pressed={view3d} className="map-layer-switch" disabled={!overlayOn} onClick={() => setView3d((value) => !value)}>
              <span className="map-layer-symbol"><Icon name="layers" size={17} /></span>
              <span><strong>{t("Tampilan 3D")}</strong><small>{view3d ? t("Batang tinggi = jumlah tes, hanya area layar") : t("Miringkan peta, tampilkan batang")}</small></span>
              <i className={`switch-track ${view3d ? "is-on" : ""}`} />
            </button>
            <div className="map-option-label">{t("Tampilkan metrik")}</div>
            <div className="metric-choice-grid">
              {metrics.map((metric) => (
                <button
                  aria-pressed={mapMetric === metric.value}
                  className={mapMetric === metric.value ? "is-active" : ""}
                  key={metric.value}
                  onClick={() => setMapMetric(metric.value)}
                >
                  <span>{metric.value === "download" ? "↓" : metric.value === "upload" ? "↑" : "◷"}</span>
                  <span>{t(metric.short)}<small>{metricReading(metric.value, ooklaSummary, numberLocale)}</small></span>
                </button>
              ))}
            </div>
            <p className="map-option-hint">{t("Titik menandai sel ukur; halo warna membantu menghubungkan hasil di area berdekatan. Klik titik untuk detail.")}</p>
          </div>

          <div className="map-control-section">
            <div className="map-section-heading"><span>{t("PETA DASAR")}</span></div>
            <div className="basemap-choices">
              {([
                { value: "voyager", label: t("Nusantara"), description: t("Jalan & wilayah") },
                { value: "light", label: t("Terang"), description: "OpenStreetMap" },
                { value: "dark", label: t("Gelap"), description: t("Kontras rendah cahaya") },
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

        </div>
      );
    }

    if (panel === "analysis") {
      return <AnalysisPanel />;
    }

    if (panel === "visualization") {
      return <AnalysisPanel visualizationOnly />;
    }

    return null;
  }

  const activePanelItem = panelItems.find((item) => item.value === panel);

  return (
    <main aria-busy={initialLoading} className="map-workspace" ref={workspaceRef}>
      <MapView
        focusLocation={focusLocation}
        metric={mapMetric}
        networkType={ooklaNetworkType}
        period={ooklaPeriod}
        basemap={basemap}
        overlayOn={overlayOn}
        view3d={view3d}
        viewMode={viewMode}
        referencePeriod={referencePeriod}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        onInitialLoadComplete={finishInitialLoading}
        onDataLoaded={updateOoklaSummary}
        onMapDataLoaded={updateOoklaMapData}
      />

      <TimeLapsePlayer
        periods={ooklaPeriods.periods}
        currentPeriod={ooklaPeriod}
        onSelectPeriod={(p) => setOoklaPeriod(p)}
        viewMode={viewMode}
        onToggleViewMode={toggleViewMode}
        networkType={ooklaNetworkType}
        onToggleNetworkType={toggleNetworkType}
        hasReferencePeriod={hasReferencePeriod}
      />

      <header className="map-topbar">
        <h1 className="sr-only">{t("SinyalNusa: eksplorasi kualitas jaringan Indonesia")}</h1>
        <Link aria-label={t("SinyalNusa, peta kualitas jaringan")} className="map-brand-plate" href="/">
          <Image
            alt=""
            className="map-brand-logo"
            height={756}
            src="/SinyalNusa_Gradient_Tech_Logo-removebg.png"
            width={2079}
          />
        </Link>

        <form className="map-global-search" onSubmit={handleSearch} role="search">
          <Icon name="search" size={17} />
          <input
            aria-activedescendant={activeSuggestion >= 0 ? `search-option-${activeSuggestion}` : undefined}
            aria-autocomplete="list"
            aria-controls="search-listbox"
            aria-expanded={searchFocused && suggestionCount > 0}
            aria-label={t("Cari wilayah atau provinsi")}
            autoComplete="off"
            onBlur={() => { setSearchFocused(false); setActiveSuggestion(-1); }}
            onChange={(event) => { setQuery(event.target.value); setSearchMessage(""); setActiveSuggestion(-1); }}
            onFocus={() => setSearchFocused(true)}
            onKeyDown={handleSearchKeys}
            role="combobox"
            placeholder={t("Cari wilayah atau provinsi")}
            ref={searchRef}
            value={query}
          />
          {query && (
            <button aria-label={t("Hapus pencarian")} className="map-search-clear" onClick={() => { setQuery(""); setSearchMessage(""); searchRef.current?.focus(); }} onMouseDown={(event) => event.preventDefault()} type="button">
              <Icon name="close" size={14} />
            </button>
          )}
          <kbd>{shortcutLabel}</kbd>
          {searchFocused && suggestions.length > 0 && (
            <div className="map-search-results" id="search-listbox" onMouseDown={(event) => event.preventDefault()} role="listbox" aria-label={t("Saran pencarian")}>
              <div className="map-search-heading" role="presentation">{query.trim() ? t("WILAYAH PETA") : t("LONCAT KE WILAYAH")}</div>
              {suggestions.map((region, i) => (
                <button aria-selected={activeSuggestion === i} className={`map-search-item ${activeSuggestion === i ? "is-active" : ""}`} id={`search-option-${i}`} key={region.name} onClick={() => pickRegion(region)} role="option" tabIndex={-1} type="button">
                  <span className="map-search-item-icon"><Icon name="locate" size={15} /></span>
                  <span><strong>{t(region.label)}</strong><small>{t("Pindahkan peta ke wilayah ini")}</small></span>
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
              aria-label={t("Pilih wilayah peta, saat ini {region}", { region: t(currentRegion.label) })}
              className="map-region-trigger"
              onClick={() => (regionOpen ? setRegionOpen(false) : openRegionMenu())}
              ref={regionBtnRef}
              type="button"
            >
              <Icon name="globe" size={16} />
              <span>{t(currentRegion.label)}</span>
              <Icon className={`region-chevron ${regionOpen ? "is-open" : ""}`} name="chevron-down" size={14} />
            </button>
            {regionOpen && (
              <ul aria-label={t("Daftar wilayah")} className="map-region-menu" id="region-listbox" role="listbox" tabIndex={-1}>
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
                    <span>{t(region.label)}</span>
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
            <span>{t("Tampilan 3D")}</span>
            <i aria-hidden="true" className={`switch-track ${view3d ? "is-on" : ""}`} />
          </button>
          <span className="sr-only" id="view3d-hint">
            {overlayOn ? t("Miringkan peta dan tampilkan batang tinggi sesuai jumlah tes.") : t("Tidak tersedia karena overlay hasil pengukuran dinonaktifkan.")}
          </span>
          <span aria-hidden="true" className="map-control-divider" />
          <div aria-label={t("Pilih metrik peta")} className="map-quick-metrics" onKeyDown={handleMetricKeys} role="radiogroup">
            {metrics.map((metric, i) => (
              <button
                aria-checked={mapMetric === metric.value}
                aria-label={`${t(metric.label)}: ${locale === "en" ? "average" : "rata-rata"} ${metricReading(metric.value, ooklaSummary, numberLocale)}`}
                className={mapMetric === metric.value ? "is-active" : ""}
                key={metric.value}
                onClick={() => setMapMetric(metric.value)}
                ref={(node) => { metricButtonRefs.current[i] = node; }}
                role="radio"
                tabIndex={mapMetric === metric.value ? 0 : -1}
                title={metric.label}
                type="button"
              >
                <span aria-hidden="true">{t(metric.short)}</span>
                <strong aria-hidden="true">{metricReading(metric.value, ooklaSummary, numberLocale)}</strong>
              </button>
            ))}
          </div>
        </div>
      </header>

      <nav aria-label={t("Kontrol peta")} className="map-tool-rail">
        {panelItems.map((item) => (
          <button
            aria-label={t(item.label)}
            aria-controls="map-side-panel"
            aria-expanded={panel === item.value}
            className={panel === item.value ? "is-active" : ""}
            key={item.value}
            onClick={(event) => showPanel(item.value, event.currentTarget)}
            title={t(item.label)}
            type="button"
          >
            <Icon name={item.icon} size={20} />
            <span>{t(item.short)}</span>
          </button>
        ))}
      </nav>

      {panel && (
        <aside aria-label={activePanelItem ? t(activePanelItem.label) : t("Panel peta")} className="map-side-panel" id="map-side-panel">
          <div className="map-panel-header">
            <div>
              <span className="map-panel-kicker">{t("SINYALNUSA / EKSPLORASI")}</span>
              <h2>{activePanelItem ? t(activePanelItem.label) : ""}</h2>
            </div>
            <button aria-label={t("Tutup panel (Esc)")} className="map-panel-close" onClick={closePanel} ref={panelCloseRef} type="button"><Icon name="close" size={17} /></button>
          </div>
          {renderPanelContent()}
        </aside>
      )}

      <div aria-live="polite" className="sr-only" role="status">{announcement}</div>

      <div
        aria-hidden={!initialLoading}
        aria-live="polite"
        className={`dashboard-initial-loading${initialLoading ? "" : " is-ready"}`}
        role="status"
      >
        <div className="dashboard-loading-card">
          <Image
            alt=""
            className="dashboard-loading-logo"
            height={756}
            src="/SinyalNusa_Gradient_Tech_Logo-removebg.png"
            width={2079}
          />
          <p>{t("Menyiapkan peta jaringan Indonesia")}</p>
          <span className="dashboard-loading-status">
            <i className="map-loading-spinner" />
            {t("Memuat peta dasar dan data pengukuran…")}
          </span>
        </div>
      </div>
    </main>
  );
}