from backend.shared.subscription_policy import (
    LEGACY_SUBSCRIPTION_TERM_DAYS,
    SECONDS_PER_DAY,
    legacy_subscription_expiry,
)


def test_legacy_term_is_centralized_without_changing_existing_duration():
    assert LEGACY_SUBSCRIPTION_TERM_DAYS == 365
    assert legacy_subscription_expiry(1_800_000_000) == (
        1_800_000_000 + LEGACY_SUBSCRIPTION_TERM_DAYS * SECONDS_PER_DAY
    )
