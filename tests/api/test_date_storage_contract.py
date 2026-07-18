from backend.shared.date_utils import normalize_date_value, normalize_datetime_value
from backend.sync.request_contract import parse_sync_read_window


def test_business_dates_are_stored_without_midnight():
    assert normalize_date_value("05/03/2026") == "2026-03-05"
    assert normalize_date_value("2026-02-05 00:00:00") == "2026-02-05"


def test_business_datetimes_keep_second_precision():
    assert normalize_datetime_value("05/03/2026 14:09") == "2026-03-05 14:09:00"


def test_epoch_sync_cursor_is_always_interpreted_as_utc():
    assert parse_sync_read_window({"since": "3600"}).since == "1970-01-01 01:00:00"
