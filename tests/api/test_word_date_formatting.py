from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.documents.custom_exporter import (
    format_context_dates,
    format_vietnamese_datetime,
    is_datetime_field_name,
)
from backend.documents.routes_docx import _format_formula_date


def test_word_date_only_fields_never_include_midnight():
    context = {
        "ngay_quyet_dinh_ket_qua": "2026-07-20 00:00:00",
        "ngayTrinhHsmt": "2026-01-12 00:00:00",
    }

    format_context_dates(context)

    assert str(context["ngay_quyet_dinh_ket_qua"]) == "ngày 20 tháng 7 năm 2026"
    assert str(context["ngayTrinhHsmt"]) == "ngày 12 tháng 01 năm 2026"
    assert "00:00" not in str(context["ngay_quyet_dinh_ket_qua"])


def test_word_datetime_fields_use_24_hour_compact_format():
    assert is_datetime_field_name("thoi_gian_mo_thau")
    assert is_datetime_field_name("thoiGianMoThau")
    assert format_vietnamese_datetime(
        "05/02/2026 04:09", key_name="thoiGianMoThau"
    ) == "04:09 ngày 05/02/2026"
    assert format_vietnamese_datetime(
        "05/03/2026 14:09", key_name="thoi_gian_mo_thau"
    ) == "14:09 ngày 05/3/2026"


def test_word_formula_dates_follow_custom_month_padding():
    from datetime import date

    assert _format_formula_date(date(2026, 1, 5)) == "05/01/2026"
    assert _format_formula_date(date(2026, 2, 5)) == "05/02/2026"
    assert _format_formula_date(date(2026, 3, 5)) == "05/3/2026"
    assert _format_formula_date(date(2026, 12, 5)) == "05/12/2026"
