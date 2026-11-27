"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Icon from "../ui/icon";
import { useLanguage } from "../../lib/i18n";
import {
  prefetchAdjacentPeriods,
  prefetchDataset,
  isDatasetCached,
} from "../../lib/ookla/ookla-loader";

type TimeLapsePlayerProps = {
  periods: { value: string; label: string }[];
  currentPeriod: string;
  onSelectPeriod: (period: string) => void;
  viewMode: "normal" | "delta";
  onToggleViewMode: () => void;
  networkType: "mobile" | "fixed";
  onToggleNetworkType: () => void;
  hasReferencePeriod: boolean;
  /** Jika true, render sebagai konten panel (tanpa floating dock) */
  panelMode?: boolean;
};

export default function TimeLapsePlayer({
  periods,
  currentPeriod,
  onSelectPeriod,
  viewMode,
  onToggleViewMode,
  networkType,
  onToggleNetworkType,
  hasReferencePeriod,
  panelMode = false,
}: TimeLapsePlayerProps) {
  const { t } = useLanguage();
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [isMinimized, setIsMinimized] = useState(false);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const playTimerRef = useRef<number | null>(null);
  const throttleTimerRef = useRef<number | null>(null);
  const pendingIndexRef = useRef<number | null>(null);

  // periods diurutkan dari terlama ke terbaru (kronologis Q4 2021 -> Q3 2026)
  const chronologicalPeriods = useMemo(() => [...periods].reverse(), [periods]);
  const currentIndex = chronologicalPeriods.findIndex((p) => p.value === currentPeriod);
  const safeIndex = currentIndex >= 0 ? currentIndex : chronologicalPeriods.length - 1;
  const displayIndex = scrubIndex ?? safeIndex;

  // 1. Proactive Prefetching: Muat periode sekitar secara cerdas di latar belakang
  useEffect(() => {
    prefetchAdjacentPeriods(networkType, currentPeriod, chronologicalPeriods, viewMode);
  }, [currentPeriod, networkType, chronologicalPeriods, viewMode]);

  // 2. Loop Animasi Waktu Otomatis dengan Fast Pre-Buffering
  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current !== null) {
        window.clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
      return;
    }

    const intervalMs = speed === 0.5 ? 2000 : speed === 1 ? 1100 : 550;

    // Saat tick dimulai, segera prefetch kuartal berikutnya & 2 kuartal ke depan
    const nextIndex = safeIndex + 1 < chronologicalPeriods.length ? safeIndex + 1 : 0;
    const nextNextIndex = (nextIndex + 1) % chronologicalPeriods.length;
    prefetchDataset(networkType, chronologicalPeriods[nextIndex].value);
    prefetchDataset(networkType, chronologicalPeriods[nextNextIndex].value);

    playTimerRef.current = window.setTimeout(() => {
      onSelectPeriod(chronologicalPeriods[nextIndex].value);
    }, intervalMs);

    return () => {
      if (playTimerRef.current !== null) {
        window.clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying, safeIndex, speed, chronologicalPeriods, networkType, onSelectPeriod]);

  // Cleanup throttle timer on unmount
  useEffect(() => {
    return () => {
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);

  const handlePrev = useCallback(() => {
    if (safeIndex > 0) {
      const prevIdx = safeIndex - 1;
      onSelectPeriod(chronologicalPeriods[prevIdx].value);
      if (prevIdx > 0) {
        prefetchDataset(networkType, chronologicalPeriods[prevIdx - 1].value);
      }
    }
  }, [safeIndex, chronologicalPeriods, networkType, onSelectPeriod]);

  const handleNext = useCallback(() => {
    if (safeIndex < chronologicalPeriods.length - 1) {
      const nextIdx = safeIndex + 1;
      onSelectPeriod(chronologicalPeriods[nextIdx].value);
      if (nextIdx < chronologicalPeriods.length - 1) {
        prefetchDataset(networkType, chronologicalPeriods[nextIdx + 1].value);
      }
    }
  }, [safeIndex, chronologicalPeriods, networkType, onSelectPeriod]);

  // 3. Optimistic Scrubber Dragging (60 FPS fluid scrub)
  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const idx = Number(event.target.value);
    if (idx < 0 || idx >= chronologicalPeriods.length) return;

    // Update tampilan scrubber lokal secara instan (zero lag)
    setScrubIndex(idx);
    pendingIndexRef.current = idx;

    // Prefetch periode yang sedang digeser
    prefetchDataset(networkType, chronologicalPeriods[idx].value);

    // Throttle pembaruan peta agar tidak membebani render canvas saat drag cepat
    if (throttleTimerRef.current === null) {
      throttleTimerRef.current = window.setTimeout(() => {
        throttleTimerRef.current = null;
        if (pendingIndexRef.current !== null) {
          onSelectPeriod(chronologicalPeriods[pendingIndexRef.current].value);
        }
      }, 50);
    }
  };

  const handleSliderCommit = () => {
    if (pendingIndexRef.current !== null) {
      onSelectPeriod(chronologicalPeriods[pendingIndexRef.current].value);
      pendingIndexRef.current = null;
    }
    setScrubIndex(null);
  };

  // 4. Keyboard Navigation: Panah Kiri/Kanan & Spasi untuk Play/Pause
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Abaikan jika fokus pada input text atau select box
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" && target.getAttribute("type") !== "range" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlePrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handleNext();
      } else if (event.key === " " && target?.tagName !== "BUTTON") {
        event.preventDefault();
        setIsPlaying((v) => !v);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePrev, handleNext]);

  const currentLabel = chronologicalPeriods[displayIndex]?.label ?? currentPeriod;
  const isCached = isDatasetCached(networkType, chronologicalPeriods[displayIndex]?.value ?? currentPeriod);

  if (isMinimized && !panelMode) {
    return (
      <div className="timelapse-dock is-subbar is-minimized">
        <button
          className="timelapse-pill-btn"
          onClick={() => setIsMinimized(false)}
          title={t("Buka panel linimasa pemutar waktu")}
          type="button"
        >
          <Icon name="play" size={15} />
          <span>{t("Linimasa")} · <strong>{currentLabel}</strong></span>
        </button>
      </div>
    );
  }

  return (
    <div className="timelapse-dock is-subbar" role="region" aria-label={t("Pemutar Linimasa dan Pertumbuhan")}>
      <div className="timelapse-inner">
        {/* Kontrol Navigasi Waktu */}
        <div className="timelapse-playback-group">
          <button
            aria-label={t("Kuartal sebelumnya (Panah Kiri)")}
            className="timelapse-btn"
            disabled={safeIndex <= 0}
            onClick={handlePrev}
            title={t("Kuartal sebelumnya (←)")}
            type="button"
          >
            <Icon name="skip-back" size={14} />
          </button>

          <button
            aria-label={t(isPlaying ? "Jeda linimasa (Spasi)" : "Putar linimasa (Spasi)")}
            className={`timelapse-btn timelapse-play-btn ${isPlaying ? "is-playing" : ""}`}
            onClick={() => setIsPlaying((v) => !v)}
            title={t(isPlaying ? "Jeda (Spasi)" : "Putar animasi linimasa (Spasi)")}
            type="button"
          >
            <Icon name={isPlaying ? "pause" : "play"} size={16} />
          </button>

          <button
            aria-label={t("Kuartal berikutnya (Panah Kanan)")}
            className="timelapse-btn"
            disabled={safeIndex >= chronologicalPeriods.length - 1}
            onClick={handleNext}
            title={t("Kuartal berikutnya (→)")}
            type="button"
          >
            <Icon name="skip-forward" size={14} />
          </button>
        </div>

        {/* Indikator Periode & Scrubber */}
        <div className="timelapse-scrubber-group">
          <div className="timelapse-meta-row">
            <div className="timelapse-period-badge">
              <span
                className={`timelapse-dot ${isCached ? "is-cached" : "is-loading"}`}
                title={isCached ? t("Data siap di memori (Instan)") : t("Memuat data...")}
              />
              <strong>{currentLabel}</strong>
              <small>({displayIndex + 1}/{chronologicalPeriods.length})</small>
            </div>
            <div className="timelapse-speed-toggle">
              <button
                className={`timelapse-speed-btn ${speed === 0.5 ? "is-active" : ""}`}
                onClick={() => setSpeed(0.5)}
                title={t("Kecepatan santai (0.5x)")}
                type="button"
              >
                0.5x
              </button>
              <button
                className={`timelapse-speed-btn ${speed === 1 ? "is-active" : ""}`}
                onClick={() => setSpeed(1)}
                title={t("Kecepatan normal (1x)")}
                type="button"
              >
                1x
              </button>
              <button
                className={`timelapse-speed-btn ${speed === 2 ? "is-active" : ""}`}
                onClick={() => setSpeed(2)}
                title={t("Kecepatan cepat (2x)")}
                type="button"
              >
                2x
              </button>
            </div>
          </div>

          <div className="timelapse-slider-wrap">
            <input
              aria-label={t("Pilih kuartal linimasa")}
              className="timelapse-slider"
              max={chronologicalPeriods.length - 1}
              min={0}
              onChange={handleSliderChange}
              onMouseUp={handleSliderCommit}
              onTouchEnd={handleSliderCommit}
              onKeyUp={handleSliderCommit}
              step={1}
              type="range"
              value={displayIndex}
            />
          </div>
        </div>

        {/* Tombol Mode Delta / Pertumbuhan YoY */}
        <div className="timelapse-mode-group">
          <button
            aria-pressed={viewMode === "delta"}
            className={`timelapse-delta-btn ${viewMode === "delta" ? "is-active" : ""}`}
            disabled={!hasReferencePeriod && viewMode !== "delta"}
            onClick={onToggleViewMode}
            title={
              hasReferencePeriod
                ? t("Tampilkan peta pertumbuhan YoY (dibandingkan 1 tahun sebelumnya)")
                : t("Data 1 tahun sebelumnya tidak tersedia untuk periode ini")
            }
            type="button"
          >
            <Icon name="trending-up" size={14} />
            <span>{t("Pertumbuhan YoY")}</span>
            {viewMode === "delta" && <span className="timelapse-active-dot" />}
          </button>

          <button
            className="timelapse-network-toggle"
            onClick={onToggleNetworkType}
            title={t("Ubah ke {network}", { network: t(networkType === "mobile" ? "Fixed broadband" : "Mobile") })}
            type="button"
          >
            <Icon name={networkType === "mobile" ? "cell" : "signal"} size={13} />
            <span>{t(networkType === "mobile" ? "Mobile" : "Fixed")}</span>
          </button>

          <button
            aria-label={t("Kecilkan panel linimasa")}
            className="timelapse-minimize-btn"
            onClick={() => setIsMinimized(true)}
            title={t("Kecilkan linimasa")}
            type="button"
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
