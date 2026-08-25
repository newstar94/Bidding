"""Benchmark the isolated server path used by basic Excel imports."""

from __future__ import annotations

import argparse
from io import BytesIO
import json
import statistics
import tempfile
import time
from pathlib import Path

from backend.documents.document_worker import run_document_job
from backend.documents.excel_service import create_excel_template


DEFAULT_BUDGET_SECONDS = 1.5


def _official_expert_template() -> bytes:
    workbook = create_excel_template("chuyengia")
    worksheet = workbook.active
    columns = {
        str(cell.value or ""): cell.column
        for cell in worksheet[1]
    }
    for row_number in range(2, 52):
        sequence = row_number - 1
        worksheet.cell(row_number, columns["Họ tên"], f"Dòng kiểm thử {sequence}")
        worksheet.cell(
            row_number,
            columns["Số CCCD"],
            str(100_000_000_000 + sequence),
        )
        worksheet.cell(
            row_number,
            columns["Số chứng chỉ"],
            f"BENCH-{sequence:04d}",
        )
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def run_case(*, samples: int = 3) -> dict[str, object]:
    content = _official_expert_template()
    durations: list[float] = []
    row_counts: list[int] = []
    with tempfile.TemporaryDirectory(prefix="expert-excel-benchmark-") as raw_dir:
        workbook_path = Path(raw_dir) / "mau_nhap_lieu_chuyengia.xlsx"
        workbook_path.write_bytes(content)
        for _ in range(max(1, int(samples))):
            started = time.perf_counter()
            rows = run_document_job(
                "parse_excel",
                {
                    "content_path": str(workbook_path),
                    "kind": "xlsx",
                    "import_type": "chuyengia",
                },
                timeout_seconds=30,
            )
            durations.append(time.perf_counter() - started)
            row_counts.append(len(rows))
            if len(rows) != 50 or not all(row.get("isValid") for row in rows):
                raise RuntimeError("Benchmark workbook was not parsed as 50 valid rows.")
    return {
        "benchmark": "isolated-server-expert-excel-import",
        "samples": len(durations),
        "workbookBytes": len(content),
        "rowCounts": row_counts,
        "durationsSeconds": [round(value, 3) for value in durations],
        "medianSeconds": round(statistics.median(durations), 3),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--assert", dest="assert_budget", action="store_true")
    parser.add_argument("--budget-seconds", type=float, default=DEFAULT_BUDGET_SECONDS)
    args = parser.parse_args(argv)
    report = run_case(samples=args.samples)
    report["budgetSeconds"] = args.budget_seconds
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.assert_budget and float(report["medianSeconds"]) > args.budget_seconds:
        print("Expert Excel import exceeded the server processing budget.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
