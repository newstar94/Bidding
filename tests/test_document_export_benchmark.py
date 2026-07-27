from __future__ import annotations

from scripts.benchmark_document_export import (
    benchmark_case,
    build_benchmark_context,
    build_benchmark_template,
    nearest_rank_percentile,
)


def test_nearest_rank_percentile_uses_observed_samples() -> None:
    assert nearest_rank_percentile([9, 1, 5, 3, 7], 0.5) == 5
    assert nearest_rank_percentile([9, 1, 5, 3, 7], 0.95) == 9


def test_benchmark_context_is_sealed_to_the_detailed_evaluation_schema() -> None:
    context, manifest, seal_ms = build_benchmark_context(3)

    assert len(context["ds_dgct"]) == 3
    assert context["ds_dgct"][0]["stt"] == "1"
    assert context["ds_dgct"][2]["ten_tieu_chi"].endswith("3")
    assert manifest["custom_root_keys"] == ["ds_dgct"]
    assert seal_ms >= 0


def test_direct_benchmark_verifies_rendered_row_count(tmp_path) -> None:
    template_path = tmp_path / "benchmark-template.docx"
    build_benchmark_template(template_path)

    result = benchmark_case(template_path, 4, 1, "direct")

    assert result["rows"] == 4
    assert result["renderedRows"] == 4
    assert result["outputBytes"] > 0
    assert result["directRender"]["medianMs"] >= 0


def test_benchmark_rejects_unbounded_parallelism(tmp_path) -> None:
    template_path = tmp_path / "benchmark-template.docx"
    build_benchmark_template(template_path)

    try:
        benchmark_case(template_path, 1, 1, "worker", parallel_jobs=33)
    except ValueError as error:
        assert "song song" in str(error)
    else:
        raise AssertionError("Benchmark accepted unbounded parallel jobs")
