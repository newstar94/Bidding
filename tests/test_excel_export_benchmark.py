from __future__ import annotations

from scripts.benchmark_excel_export import (
    benchmark_case,
    build_lot_rows,
    nearest_rank_percentile,
)


def test_excel_benchmark_builds_stable_lot_rows() -> None:
    rows = build_lot_rows(3)

    assert [row["maPhanLo"] for row in rows] == ["L00001", "L00002", "L00003"]
    assert rows[2]["giaTriPhanLo"] == 3_000_000


def test_excel_benchmark_percentile_uses_observed_samples() -> None:
    assert nearest_rank_percentile([4, 1, 3, 2], 0.5) == 2
    assert nearest_rank_percentile([4, 1, 3, 2], 0.95) == 4


def test_direct_excel_benchmark_verifies_output_rows() -> None:
    result = benchmark_case(4, 1, "direct")

    assert result["rows"] == 4
    assert result["renderedRows"] == 4
    assert result["outputBytes"] > 0
    assert result["directExport"]["medianMs"] >= 0
