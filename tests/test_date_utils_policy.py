import pytest

from backend.shared.date_utils import normalize_date_value, normalize_datetime_value


@pytest.mark.parametrize("value", [None, "", "   ", "\t\r\n"])
def test_optional_blank_dates_are_normalized_to_database_null(value):
    assert normalize_date_value(value) is None
    assert normalize_datetime_value(value) is None


def test_supported_vietnam_date_inputs_are_canonicalized():
    assert normalize_date_value("19/07/2026") == "2026-07-19"
    assert normalize_datetime_value("19/07/2026 14:30") == "2026-07-19 14:30:00"


def test_invalid_non_blank_dates_are_preserved_for_validation_reporting():
    assert normalize_date_value("not-a-date") == "not-a-date"
    assert normalize_datetime_value("not-a-date") == "not-a-date"
