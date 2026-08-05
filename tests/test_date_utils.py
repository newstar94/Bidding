from backend.shared.date_utils import normalize_datetime_value, parse_datetime_value


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
