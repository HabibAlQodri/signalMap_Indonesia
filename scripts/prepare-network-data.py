import json
import re
import zipfile
from datetime import date
from pathlib import Path
from xml.etree import ElementTree

import duckdb


ROOT = Path(__file__).resolve().parents[1]
OOKLA_DATA_DIR = ROOT / "lib" / "data_ookla"
OOKLA_OUTPUT_DIR = ROOT / "public" / "data" / "ookla"
OOKLA_PERIODS_PATH = ROOT / "lib" / "ookla-periods.json"
COVERAGE_PATH = ROOT / "lib" / "data-coverage-jaringan-telekomunikasi.xlsx"
FREQUENCY_PATH = ROOT / "lib" / "data-frekuensi-mobile-broadband-per-2023.xlsx"
COVERAGE_DATA_PATH = ROOT / "lib" / "coverage-data.json"
FREQUENCY_DATA_PATH = ROOT / "lib" / "frequency-data.json"
OOKLA_BOUNDS = {"west": 90, "south": -15, "east": 145, "north": 15}
OOKLA_MODES = ("mobile", "fixed")
OOKLA_FILE_PATTERN = re.compile(
    r"(?P<period>\d{4}-\d{2}-\d{2})_performance_(?P<mode>mobile|fixed)_tiles\.parquet"
)

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "relationships": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "package": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def read_workbook_rows(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path) as workbook:
        workbook_xml = ElementTree.fromstring(workbook.read("xl/workbook.xml"))
        relationships_xml = ElementTree.fromstring(
            workbook.read("xl/_rels/workbook.xml.rels")
        )
        relationships = {
            relationship.attrib["Id"]: relationship.attrib["Target"]
            for relationship in relationships_xml
        }
        shared_strings = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            strings_xml = ElementTree.fromstring(workbook.read("xl/sharedStrings.xml"))
            shared_strings = [
                "".join(text.text or "" for text in item.findall(".//main:t", NS))
                for item in strings_xml.findall("main:si", NS)
            ]

        sheet = workbook_xml.find("main:sheets/main:sheet", NS)
        if sheet is None:
            raise ValueError(f"No worksheet found in {path.name}")
        target = relationships[sheet.attrib[f"{{{NS['relationships']}}}id"]].lstrip("/")
        sheet_path = target if target.startswith("xl/") else f"xl/{target}"
        sheet_xml = ElementTree.fromstring(workbook.read(sheet_path))
        rows = []
        for row in sheet_xml.findall(".//main:sheetData/main:row", NS):
            values = []
            for cell in row.findall("main:c", NS):
                value = cell.find("main:v", NS)
                text = value.text if value is not None else ""
                if cell.attrib.get("t") == "s" and text:
                    text = shared_strings[int(text)]
                elif cell.attrib.get("t") == "inlineStr":
                    text = "".join(
                        node.text or "" for node in cell.findall(".//main:t", NS)
                    )
                values.append(text)
            rows.append(values)
        return rows


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def build_coverage_data() -> None:
    rows = read_workbook_rows(COVERAGE_PATH)
    coverage = [
        {
            "province": row[0],
            "district": row[1],
            "2G": min(1, float(row[2])),
            "3G": min(1, float(row[3])),
            "4G": min(1, float(row[4])),
            "5G": min(1, float(row[5])),
        }
        for row in rows[1:]
        if len(row) >= 6 and row[0] and row[1]
    ]
    write_json(COVERAGE_DATA_PATH, coverage)


def build_frequency_data() -> None:
    rows = read_workbook_rows(FREQUENCY_PATH)
    frequencies = []
    for row in rows[2:]:
        if len(row) < 5 or not row[1]:
            continue
        frequencies.append(
            {
                "band": row[1],
                "range": row[2].replace("\n", " "),
                "bandwidth": row[3],
                "holders": [holder.strip() for holder in row[4].split(",") if holder.strip()],
            }
        )
    write_json(FREQUENCY_DATA_PATH, frequencies)


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


if __name__ == "__main__":
    build_coverage_data()
    build_frequency_data()
    build_ookla_data()
