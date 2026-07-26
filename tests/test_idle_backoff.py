from __future__ import annotations

import pytest

from backend.shared.idle_backoff import IdlePollBackoff, idle_poll_backoff_from_env


def test_idle_poll_backoff_grows_to_a_hard_maximum_and_resets() -> None:
    backoff = IdlePollBackoff(
        1,
        10,
        jitter_ratio=0,
        random_fraction=lambda: 0,
    )

    assert [backoff.next_delay() for _ in range(7)] == [1, 2, 4, 8, 10, 10, 10]
    backoff.reset()
    assert backoff.next_delay() == 1


def test_idle_poll_backoff_jitter_never_exceeds_the_pickup_latency_cap() -> None:
    backoff = IdlePollBackoff(5, 10, jitter_ratio=0.1, random_fraction=lambda: 1)

    assert backoff.next_delay() == pytest.approx(4.5)
    assert backoff.next_delay() == pytest.approx(9.0)
    assert backoff.next_delay() == pytest.approx(9.0)


def test_idle_poll_backoff_rejects_invalid_configuration() -> None:
    with pytest.raises(ValueError):
        IdlePollBackoff(0, 10)
    with pytest.raises(ValueError):
        IdlePollBackoff(5, 4)
    with pytest.raises(ValueError):
        IdlePollBackoff(1, 10, multiplier=0.5)
    with pytest.raises(ValueError):
        IdlePollBackoff(1, 10, jitter_ratio=1)


def test_ten_second_backoff_halves_long_idle_claim_attempts() -> None:
    backoff = IdlePollBackoff(1, 10, jitter_ratio=0, random_fraction=lambda: 0)
    elapsed = 0.0
    attempts = 0
    while elapsed < 3600:
        attempts += 1
        elapsed += backoff.next_delay()

    fixed_five_second_attempts = 3600 // 5
    assert attempts == 363
    assert attempts / fixed_five_second_attempts < 0.51


def test_environment_factory_bounds_invalid_and_explicit_poll_settings() -> None:
    fallback = idle_poll_backoff_from_env(
        "INITIAL",
        "MAXIMUM",
        default_initial=5,
        environ={"INITIAL": "invalid", "MAXIMUM": "nan"},
    )
    assert 4.5 <= fallback.next_delay() <= 5

    configured = idle_poll_backoff_from_env(
        "INITIAL",
        "MAXIMUM",
        default_initial=5,
        environ={
            "INITIAL": "2",
            "MAXIMUM": "6",
            "WORKER_IDLE_POLL_JITTER_RATIO": "0",
        },
    )
    assert [configured.next_delay() for _ in range(4)] == [2, 4, 6, 6]
