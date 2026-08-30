import pytest

from backend.domain.plan_basis_parser import (
    PARSER_VERSION,
    derive_ten_can_cu,
    parse_plan_basis,
)


def test_parse_complete_numeric_date_basis():
    raw = (
        "Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC "
        "về việc phê duyệt dự toán"
    )

    result = parse_plan_basis(raw)

    assert result.as_dict() == {
        "noiDungGoc": raw,
        "tenVanBan": "Quyết định",
        "soVanBan": "123/QĐ",
        "ngayBanHanh": "2025-11-11",
        "donViBanHanh": "UBND xã ABC",
        "trichYeu": "phê duyệt dự toán",
        "tenCanCu": "Quyết định về việc phê duyệt dự toán",
        "parseStatus": "PARSED",
        "parseVersion": PARSER_VERSION,
        "parseReasons": [],
    }


def test_parse_written_date_and_issuer_form():
    result = parse_plan_basis(
        "Quyết định số 45-2026/QĐ ngày 2 tháng 3 năm 2026 "
        "do Ủy ban nhân dân tỉnh ban hành về việc giao dự toán"
    )

    assert result.ten_van_ban == "Quyết định"
    assert result.so_van_ban == "45-2026/QĐ"
    assert result.ngay_ban_hanh == "2026-03-02"
    assert result.don_vi_ban_hanh == "Ủy ban nhân dân tỉnh"
    assert result.trich_yeu == "giao dự toán"
    assert result.parse_status == "PARSED"


def test_parse_without_optional_abstract_is_still_complete():
    result = parse_plan_basis(
        "Luật Đấu thầu số 22/2023/QH15 ngày 23/6/2023 của Quốc hội"
    )

    assert result.ten_van_ban == "Luật Đấu thầu"
    assert result.trich_yeu is None
    assert result.ten_can_cu == "Luật Đấu thầu"
    assert result.parse_status == "PARSED"


@pytest.mark.parametrize(
    ("ten_van_ban", "trich_yeu", "expected"),
    [
        ("Quyết định", "phê duyệt dự toán", "Quyết định về việc phê duyệt dự toán"),
        ("Quyết định", None, "Quyết định"),
        (None, "phê duyệt dự toán", "phê duyệt dự toán"),
        (None, None, ""),
        ("  Quyết định  ", "  phê duyệt dự toán  ", "Quyết định về việc phê duyệt dự toán"),
    ],
)
def test_derive_ten_can_cu(ten_van_ban, trich_yeu, expected):
    assert derive_ten_can_cu(ten_van_ban, trich_yeu) == expected


def test_partial_parse_preserves_original_and_safe_fields():
    raw = "Căn cứ Quyết định số 123/QĐ của UBND xã ABC về việc phê duyệt dự toán"

    result = parse_plan_basis(raw)

    assert result.noi_dung_goc == raw
    assert result.ten_van_ban == "Quyết định"
    assert result.so_van_ban == "123/QĐ"
    assert result.ngay_ban_hanh is None
    assert result.don_vi_ban_hanh == "UBND xã ABC"
    assert result.trich_yeu == "phê duyệt dự toán"
    assert result.parse_status == "PARTIAL"
    assert "MISSING_DATE" in result.parse_reasons


def test_invalid_calendar_date_is_not_guessed():
    result = parse_plan_basis(
        "Quyết định số 1/QĐ ngày 31/02/2025 của UBND xã ABC"
    )

    assert result.ngay_ban_hanh is None
    assert result.parse_status == "PARTIAL"
    assert "INVALID_DATE" in result.parse_reasons


def test_multiple_dates_are_ambiguous_and_not_first_match_wins():
    result = parse_plan_basis(
        "Quyết định số 1/QĐ ngày 01/02/2025 của UBND xã ABC "
        "về việc điều chỉnh kế hoạch ngày 02/02/2025"
    )

    assert result.ngay_ban_hanh is None
    assert result.parse_status == "PARTIAL"
    assert "MULTIPLE_DATES" in result.parse_reasons


def test_multiple_bases_in_one_textbox_are_not_split_or_guessed():
    raw = (
        "Căn cứ Quyết định số 1/QĐ ngày 01/01/2025 của UBND xã A; "
        "Căn cứ Quyết định số 2/QĐ ngày 02/01/2025 của UBND xã B"
    )

    result = parse_plan_basis(raw)

    assert result.noi_dung_goc == raw
    assert result.parse_status == "PARTIAL"
    assert result.ten_van_ban is None
    assert "MULTIPLE_BASES_DETECTED" in result.parse_reasons


def test_unparsed_text_remains_available_for_raw_word_recipe():
    raw = "Theo hồ sơ đã được cấp có thẩm quyền phê duyệt"

    result = parse_plan_basis(raw)

    assert result.noi_dung_goc == raw
    assert result.parse_status == "UNPARSED"
    assert result.ten_can_cu == ""
    assert result.parse_reasons


def test_parser_does_not_rewrite_original_case_spacing_or_punctuation():
    raw = "  Căn cứ QUYẾT ĐỊNH số 12/QĐ ngày 1/1/2025 của UBND XÃ A.  "

    result = parse_plan_basis(raw)

    assert result.noi_dung_goc == raw
    assert result.ten_van_ban == "QUYẾT ĐỊNH"
    assert result.don_vi_ban_hanh == "UBND XÃ A"
