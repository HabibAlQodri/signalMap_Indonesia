"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./icon";

type TimeLapsePlayerProps = {
  periods: { value: string; label: string }[];
  currentPeriod: string;
  onSelectPeriod: (period: string) => void;
  viewMode: "normal" | "delta";
  onToggleViewMode: () => void;
  networkType: "mobile" | "fixed";
  onToggleNetworkType: () => void;
  hasReferencePeriod: boolean;
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
}: TimeLapsePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [isMinimized, setIsMinimized] = useState(false);
  const playTimerRef = useRef<number | null>(null);

  // periods diurutkan dari terlama ke terbaru (kronologis Q4 2021 -> Q3 2026)
  const chronologicalPeriods = [...periods].reverse();
  const currentIndex = chronologicalPeriods.findIndex((p) => p.value === currentPeriod);
  const safeIndex = currentIndex >= 0 ? currentIndex : chronologicalPeriods.length - 1;

  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current !== null) {
        window.clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
      return;
    }

    const intervalMs = speed === 1 ? 1400 : 700;
    playTimerRef.current = window.setTimeout(() => {
      const nextIndex = safeIndex + 1;
      if (nextIndex < chronologicalPeriods.length) {
        onSelectPeriod(chronologicalPeriods[nextIndex].value);
      } else {
        // Loop kembali ke awal
        onSelectPeriod(chronologicalPeriods[0].value);
      }
    }, intervalMs);

    return () => {
      if (playTimerRef.current !== null) {
        window.clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying, safeIndex, speed, chronologicalPeriods, onSelectPeriod]);

  function handlePrev() {
    if (safeIndex > 0) {
      onSelectPeriod(chronologicalPeriods[safeIndex - 1].value);
    }
  }

  function handleNext() {
    if (safeIndex < chronologicalPeriods.length - 1) {
      onSelectPeriod(chronologicalPeriods[safeIndex + 1].value);
    }
  }

  function handleSliderChange(event: React.ChangeEvent<HTMLInputElement>) {
    const idx = Number(event.target.value);
    if (idx >= 0 && idx < chronologicalPeriods.length) {
      onSelectPeriod(chronologicalPeriods[idx].value);
    }
  }

  const currentLabel = chronologicalPeriods[safeIndex]?.label ?? currentPeriod;

  if (isMinimized) {
    return (
      <div className="timelapse-dock is-minimized">
        <button
          className="timelapse-pill-btn"
          onClick={() => setIsMinimized(false)}
          title="Buka panel linimasa pemutar waktu"
          type="button"
        >
          <Icon name="play" size={15} />
          <span>Linimasa · <strong>{currentLabel}</strong></span>
        </button>
      </div>
    );
  }

  return (
    <div className="timelapse-dock" role="region" aria-label="Pemutar Linimasa dan Pertumbuhan">
      <div className="timelapse-inner">
        {/* Kontrol Navigasi Waktu */}
        <div className="timelapse-playback-group">
          <button
            aria-label="Kuartal sebelumnya"
            className="timelapse-btn"
            disabled={safeIndex <= 0}
            onClick={handlePrev}
            title="Kuartal sebelumnya"
            type="button"
          >
            <Icon name="skip-back" size={14} />
          </button>

          <button
            aria-label={isPlaying ? "Jeda linimasa" : "Putar linimasa"}
            className={`timelapse-btn timelapse-play-btn ${isPlaying ? "is-playing" : ""}`}
            onClick={() => setIsPlaying((v) => !v)}
            title={isPlaying ? "Jeda" : "Mulai putar animasi dari kuartal ke kuartal"}
            type="button"
          >
            <Icon name={isPlaying ? "pause" : "play"} size={16} />
          </button>

          <button
            aria-label="Kuartal berikutnya"
            className="timelapse-btn"
            disabled={safeIndex >= chronologicalPeriods.length - 1}
            onClick={handleNext}
            title="Kuartal berikutnya"
            type="button"
          >
            <Icon name="skip-forward" size={14} />
          </button>
        </div>

        {/* Indikator Periode & Scrubber */}
        <div className="timelapse-scrubber-group">
          <div className="timelapse-meta-row">
            <div className="timelapse-period-badge">
              <span className="timelapse-dot" />
              <strong>{currentLabel}</strong>
              <small>({safeIndex + 1}/{chronologicalPeriods.length})</small>
            </div>
            <div className="timelapse-speed-toggle">
              <button
                className={`timelapse-speed-btn ${speed === 1 ? "is-active" : ""}`}
                onClick={() => setSpeed(1)}
                title="Kecepatan normal (1x)"
                type="button"
              >
                1x
              </button>
              <button
                className={`timelapse-speed-btn ${speed === 2 ? "is-active" : ""}`}
                onClick={() => setSpeed(2)}
                title="Kecepatan cepat (2x)"
                type="button"
              >
                2x
              </button>
            </div>
          </div>

          <div className="timelapse-slider-wrap">
            <input
              aria-label="Pilih kuartal linimasa"
              className="timelapse-slider"
              max={chronologicalPeriods.length - 1}
              min={0}
              onChange={handleSliderChange}
              step={1}
              type="range"
              value={safeIndex}
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
                ? "Tampilkan peta pertumbuhan YoY (dibandingkan 1 tahun sebelumnya)"
                : "Data 1 tahun sebelumnya tidak tersedia untuk periode ini"
            }
            type="button"
          >
            <Icon name="trending-up" size={14} />
            <span>Pertumbuhan YoY</span>
            {viewMode === "delta" && <span className="timelapse-active-dot" />}
          </button>

          <button
            className="timelapse-network-toggle"
            onClick={onToggleNetworkType}
            title={`Ubah ke ${networkType === "mobile" ? "Fixed broadband" : "Mobile"}`}
            type="button"
          >
            <Icon name={networkType === "mobile" ? "cell" : "signal"} size={13} />
            <span>{networkType === "mobile" ? "Mobile" : "Fixed"}</span>
          </button>

          <button
            aria-label="Kecilkan panel linimasa"
            className="timelapse-minimize-btn"
            onClick={() => setIsMinimized(true)}
            title="Kecilkan linimasa"
            type="button"
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

