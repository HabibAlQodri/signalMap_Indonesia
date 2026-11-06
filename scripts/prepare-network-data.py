import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import duckdb


ROOT = Path(__file__).resolve().parents[1]
PARQUET_PATH = ROOT / "lib" / "ookla_indonesia_mobile.parquet"
COVERAGE_PATH = ROOT / "lib" / "data-coverage-jaringan-telekomunikasi.xlsx"
FREQUENCY_PATH = ROOT / "lib" / "data-frekuensi-mobile-broadband-per-2023.xlsx"
PUBLIC_DATA_PATH = ROOT / "public" / "data" / "ookla-mobile-tiles.json"
OOKLA_SUMMARY_PATH = ROOT / "lib" / "ookla-summary.json"
COVERAGE_DATA_PATH = ROOT / "lib" / "coverage-data.json"
FREQUENCY_DATA_PATH = ROOT / "lib" / "frequency-data.json"

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
    connection = duckdb.connect()
    query = """
        SELECT
            substr(quadkey, 1, 12) AS cell,
            sum(tile_x * tests) / sum(tests) AS longitude,
            sum(tile_y * tests) / sum(tests) AS latitude,
            sum(avg_d_kbps * tests) / sum(tests) AS download_kbps,
            sum(avg_u_kbps * tests) / sum(tests) AS upload_kbps,
            sum(avg_lat_ms * tests) / sum(tests) AS latency_ms,
            sum(tests) AS tests,
            sum(devices) AS devices
        FROM read_parquet(?)
        GROUP BY cell
        ORDER BY cell
    """
    grouped = connection.execute(query, [str(PARQUET_PATH)]).fetchall()
    (
        row_count,
        total_tests,
        total_devices,
        year,
        quarter,
        avg_download_kbps,
        avg_upload_kbps,
        avg_latency_ms,
    ) = connection.execute(
        """
        SELECT
            count(*),
            sum(tests),
            sum(devices),
            min(year),
            min(quarter),
            sum(avg_d_kbps * tests) / sum(tests),
            sum(avg_u_kbps * tests) / sum(tests),
            sum(avg_lat_ms * tests) / sum(tests)
        FROM read_parquet(?)
        """,
        [str(PARQUET_PATH)],
    ).fetchone()
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
        for _, longitude, latitude, download_kbps, upload_kbps, latency_ms, tests, devices in grouped
    ]
    write_json(
        PUBLIC_DATA_PATH,
        {
            "source": "Ookla Open Data",
            "year": year,
            "quarter": quarter,
            "records": row_count,
            "tests": total_tests,
            "devices": total_devices,
            "avgDownloadKbps": round(avg_download_kbps),
            "avgUploadKbps": round(avg_upload_kbps),
            "avgLatencyMs": round(avg_latency_ms, 1),
            "aggregation": "Tests-weighted average in level-12 quadkey cells",
            "cells": cells,
        },
    )
    write_json(
        OOKLA_SUMMARY_PATH,
        {
            "year": year,
            "quarter": quarter,
            "records": row_count,
            "tests": total_tests,
            "devices": total_devices,
            "avgDownloadKbps": round(avg_download_kbps),
            "avgUploadKbps": round(avg_upload_kbps),
            "avgLatencyMs": round(avg_latency_ms, 1),
            "aggregatedCells": len(cells),
        },
    )
    connection.close()


if __name__ == "__main__":
    build_coverage_data()
    build_frequency_data()
    build_ookla_data()
