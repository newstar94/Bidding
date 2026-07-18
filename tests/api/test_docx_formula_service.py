from datetime import date

from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.documents.docx_formula_service import (
    _evaluate_formula,
    _format_formula_date,
    apply_computed_mappings,
)


def test_computed_word_formulas_are_isolated_from_the_route():
    assert _evaluate_formula("formatNumber(gia * 2)", {"gia": 1250}, {}) == "2.500"
    assert _format_formula_date(date(2026, 3, 5)) == "05/3/2026"

    context = {"ngay_goc": "2026-01-02"}
    mappings = [
        ("ngay_tiep", "__computed__", "addDays(ngay_goc, 1)"),
        ("ngay_sau", "__computed__", "addDays(ngay_tiep, 1)"),
    ]
    apply_computed_mappings(context, mappings)

    assert context["ngay_tiep"] == "03/01/2026"
    assert context["ngay_sau"] == "04/01/2026"


def test_formula_evaluator_rejects_unsafe_python_calls():
    try:
        _evaluate_formula("__import__('os').getcwd()", {}, {})
    except ValueError as exc:
        assert "khong duoc ho tro" in str(exc)
    else:
        raise AssertionError("Unsafe formula was accepted")

