import json
import re
import sys
from datetime import date
from pathlib import Path

import duckdb


ROOT = Path(__file__).resolve().parents[1]
OOKLA_DATA_DIR = ROOT / "lib" / "data_ookla"
OOKLA_OUTPUT_DIR = ROOT / "public" / "data" / "ookla"
OOKLA_PERIODS_PATH = ROOT / "lib" / "ookla-periods.json"
OOKLA_ANALYSIS_PATH = ROOT / "lib" / "ookla-analysis.json"
OOKLA_BOUNDS = {"west": 90, "south": -15, "east": 145, "north": 15}
OOKLA_MODES = ("mobile", "fixed")
OOKLA_ANALYSIS_REGIONS = [
    {"value": "indonesia-sekitarnya", "label": "Indonesia & sekitar", "bounds": OOKLA_BOUNDS},
    {"value": "sumatra", "label": "Sumatra (perkiraan)", "bounds": {"west": 94, "south": -6.5, "east": 106.5, "north": 6}},
    {"value": "jawa", "label": "Jawa (perkiraan)", "bounds": {"west": 105, "south": -9, "east": 115, "north": -5}},
    {"value": "bali-nusa-tenggara", "label": "Bali & Nusa Tenggara (perkiraan)", "bounds": {"west": 114, "south": -12, "east": 128, "north": -7}},
    {"value": "kalimantan", "label": "Kalimantan (perkiraan)", "bounds": {"west": 108, "south": -5, "east": 119, "north": 5}},
    {"value": "sulawesi", "label": "Sulawesi (perkiraan)", "bounds": {"west": 118, "south": -7, "east": 126, "north": 3}},
    {"value": "maluku", "label": "Maluku (perkiraan)", "bounds": {"west": 124, "south": -9, "east": 135, "north": 3}},
    {"value": "papua", "label": "Papua (perkiraan)", "bounds": {"west": 130, "south": -11, "east": 141, "north": 1}},
]
OOKLA_FILE_PATTERN = re.compile(
    r"(?P<period>\d{4}-\d{2}-\d{2})_performance_(?P<mode>mobile|fixed)_tiles\.parquet"
)

def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def build_ookla_data() -> None:
    files_by_period: dict[date, dict[str, Path]] = {}
    for path in OOKLA_DATA_DIR.glob("*_performance_*_tiles.parquet"):
        match = OOKLA_FILE_PATTERN.fullmatch(path.name)
        if match:
            period = date.fromisoformat(match["period"])
            files_by_period.setdefault(period, {})[match["mode"]] = path

    if not files_by_period:
        raise FileNotFoundError(f"No Ookla Parquet files found in {OOKLA_DATA_DIR}")

    latest_period = max(files_by_period)
    window_start = latest_period.replace(year=latest_period.year - 5)
    periods = sorted(period for period in files_by_period if period >= window_start)
    for period in periods:
        missing_modes = set(OOKLA_MODES) - files_by_period[period].keys()
        if missing_modes:
            raise ValueError(
                f"Missing {', '.join(sorted(missing_modes))} Ookla data for {period}"
            )

    query = """
        SELECT
            substr(quadkey, 1, 12) AS cell,
            sum(tile_x * tests) / sum(tests) AS longitude,
            sum(tile_y * tests) / sum(tests) AS latitude,
            sum(avg_d_kbps * tests) / sum(tests) AS download_kbps,
            sum(avg_u_kbps * tests) / sum(tests) AS upload_kbps,
            sum(avg_lat_ms * tests) / sum(tests) AS latency_ms,
            sum(tests) AS tests,
            sum(devices) AS devices,
            count(*) AS records
        FROM read_parquet(?)
        WHERE tile_x BETWEEN ? AND ?
            AND tile_y BETWEEN ? AND ?
            AND tests > 0
        GROUP BY cell
        ORDER BY cell
    """
    connection = duckdb.connect()
    index_periods = []
    try:
        for period in reversed(periods):
            year, quarter = period.year, (period.month - 1) // 3 + 1
            period_label = f"Q{quarter} {year}"
            index_periods.append({"value": period.isoformat(), "label": period_label})
            for mode in OOKLA_MODES:
                grouped = connection.execute(
                    query,
                    [
                        str(files_by_period[period][mode]),
                        OOKLA_BOUNDS["west"],
                        OOKLA_BOUNDS["east"],
                        OOKLA_BOUNDS["south"],
                        OOKLA_BOUNDS["north"],
                    ],
                ).fetchall()
                if not grouped:
                    raise ValueError(
                        f"No Ookla {mode} records inside the configured region for {period}"
                    )

                total_tests = sum(row[6] for row in grouped)
                total_devices = sum(row[7] for row in grouped)
                record_count = sum(row[8] for row in grouped)
                avg_download_kbps = sum(row[3] * row[6] for row in grouped) / total_tests
                avg_upload_kbps = sum(row[4] * row[6] for row in grouped) / total_tests
                avg_latency_ms = sum(row[5] * row[6] for row in grouped) / total_tests
                cells = [
                    [
                        round(longitude, 5),
                        round(latitude, 5),
                        round(download_kbps),
                        round(upload_kbps),
                        round(latency_ms, 1),
                        tests,
                        devices,
                    ]
                    for (
                        _,
                        longitude,
                        latitude,
                        download_kbps,
                        upload_kbps,
                        latency_ms,
                        tests,
                        devices,
                        _,
                    ) in grouped
                ]
                write_json(
                    OOKLA_OUTPUT_DIR / f"{mode}-{period.isoformat()}.json",
                    {
                        "source": "Ookla Open Data",
                        "networkType": mode,
                        "networkLabel": "Mobile" if mode == "mobile" else "Fixed broadband",
                        "period": period.isoformat(),
                        "periodLabel": period_label,
                        "bounds": OOKLA_BOUNDS,
                        "records": record_count,
                        "tests": total_tests,
                        "devices": total_devices,
                        "avgDownloadKbps": round(avg_download_kbps),
                        "avgUploadKbps": round(avg_upload_kbps),
                        "avgLatencyMs": round(avg_latency_ms, 1),
                        "aggregatedCells": len(cells),
                        "aggregation": "Tests-weighted average in level-12 quadkey cells",
                        "cells": cells,
                    },
                )
                print(
                    f"Prepared {mode} {period_label}: "
                    f"{record_count:,} records, {len(cells):,} cells"
                )
    finally:
        connection.close()

    write_json(
        OOKLA_PERIODS_PATH,
        {
            "latestPeriod": latest_period.isoformat(),
            "windowStart": window_start.isoformat(),
            "periods": index_periods,
            "bounds": OOKLA_BOUNDS,
        },
    )


def build_ookla_analysis() -> None:
    periods_index = json.loads(OOKLA_PERIODS_PATH.read_text(encoding="utf-8"))
    period_values = {item["value"] for item in periods_index["periods"]}
    entries = []
    for path in sorted(OOKLA_OUTPUT_DIR.glob("*.json")):
        dataset = json.loads(path.read_text(encoding="utf-8"))
        period = dataset["period"]
        if period not in period_values:
            continue
        year, month, _ = map(int, period.split("-"))
        quarter = (month - 1) // 3 + 1
        for region in OOKLA_ANALYSIS_REGIONS:
            west = region["bounds"]["west"]
            south = region["bounds"]["south"]
            east = region["bounds"]["east"]
            north = region["bounds"]["north"]
            total_tests = total_devices = 0
            weighted_download = weighted_upload = weighted_latency = 0
            cell_count = 0
            for cell in dataset["cells"]:
                longitude, latitude, download, upload, latency, tests, devices = cell
                if not (west <= longitude <= east and south <= latitude <= north):
                    continue
                total_tests += tests
                total_devices += devices
                weighted_download += download * tests
                weighted_upload += upload * tests
                weighted_latency += latency * tests
                cell_count += 1
            if not total_tests:
                continue
            entries.append(
                {
                    "period": period,
                    "year": year,
                    "quarter": quarter,
                    "periodLabel": f"Q{quarter} {year}",
                    "networkType": dataset["networkType"],
                    "region": region["value"],
                    "cells": cell_count,
                    "tests": total_tests,
                    "devices": total_devices,
                    "avgDownloadKbps": weighted_download / total_tests,
                    "avgUploadKbps": weighted_upload / total_tests,
                    "avgLatencyMs": weighted_latency / total_tests,
                }
            )
    if not entries:
        raise ValueError(f"No periodized Ookla data found in {OOKLA_OUTPUT_DIR}")
    write_json(
        OOKLA_ANALYSIS_PATH,
        {
            "regions": OOKLA_ANALYSIS_REGIONS,
            "periods": periods_index["periods"],
            "latestPeriod": periods_index["latestPeriod"],
            "note": "Analisis wilayah memakai kotak koordinat perkiraan dan titik tengah sel quadkey level 12, bukan batas administrasi.",
            "entries": entries,
        },
    )


if __name__ == "__main__":
    if "--analysis-only" in sys.argv:
        build_ookla_analysis()
    else:
        build_ookla_data()
        build_ookla_analysis()
