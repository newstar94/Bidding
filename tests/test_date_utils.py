import pytest

from backend.shared.date_utils import (
    format_short_vietnamese_date,
    normalize_datetime_value,
    parse_datetime_value,
)


def test_datetime_parser_accepts_iso_offsets_and_fractional_seconds():
    assert normalize_datetime_value("2026-07-31T08:00:00+07:00") == (
        "2026-07-31 08:00:00"
    )
    assert normalize_datetime_value("2026-07-31T08:00:00.123+07:00") == (
        "2026-07-31 08:00:00"
    )
    assert normalize_datetime_value("2026-07-31T01:00:00.000Z") == (
        "2026-07-31 08:00:00"
    )
    assert parse_datetime_value("2026-07-31T08:00:00+07:00") is not None


@pytest.mark.parametrize(
    ("month", "expected"),
    [
        (1, "05/01/2026"),
        (2, "05/02/2026"),
        (3, "05/3/2026"),
        (4, "05/4/2026"),
        (5, "05/5/2026"),
        (6, "05/6/2026"),
        (7, "05/7/2026"),
        (8, "05/8/2026"),
        (9, "05/9/2026"),
        (10, "05/10/2026"),
        (11, "05/11/2026"),
        (12, "05/12/2026"),
    ],
)
def test_short_vietnamese_date_leads_only_january_and_february_with_zero(
    month,
    expected,
):
    assert format_short_vietnamese_date(5, month, 2026) == expected
