from datetime import datetime, timezone

import pytest

from backend.billing.provider_timestamp import parse_provider_transaction_time


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (1_705_315_800, 1_705_315_800),
        ("1705315800", 1_705_315_800),
        ("2024-01-15T10:30:00.000Z", int(datetime(2024, 1, 15, 10, 30, tzinfo=timezone.utc).timestamp())),
        ("2024-01-15T17:30:00+07:00", int(datetime(2024, 1, 15, 10, 30, tzinfo=timezone.utc).timestamp())),
    ],
)
def test_explicit_payos_transaction_timestamps_normalize_to_unix_seconds(value, expected):
    parsed = parse_provider_transaction_time({"transactionDateTime": value})
    assert parsed.ok is True
    assert parsed.unix_seconds == expected
    assert parsed.reason is None


@pytest.mark.parametrize(
    ("result", "reason"),
    [
        ({"transactionDateTime": "2023-02-04 18:25:00"}, "PAYMENT_TIMESTAMP_TIMEZONE_REQUIRED"),
        ({"transactionDateTime": "not-a-date"}, "PAYMENT_TIMESTAMP_INVALID"),
        ({"transactionDateTime": 99_999_999_999_999}, "PAYMENT_TIMESTAMP_OUT_OF_RANGE"),
        ({"createdAt": "2024-01-15T10:30:00.000Z"}, "PAYMENT_OCCURRENCE_TIME_REVIEW_REQUIRED"),
        ({}, "PAYMENT_OCCURRENCE_TIME_MISSING"),
    ],
)
def test_ambiguous_or_non_transaction_payos_timestamps_require_review(result, reason):
    parsed = parse_provider_transaction_time(result)
    assert parsed.ok is False
    assert parsed.unix_seconds is None
    assert parsed.reason == reason
