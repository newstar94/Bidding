import pytest


@pytest.fixture(autouse=True)
def _commercial_trial_mode_is_explicit_per_test(monkeypatch):
    """Keep paid-mode regressions deterministic when the local .env enables trial."""

    monkeypatch.setenv("TRIAL_FULL_ACCESS_ENABLED", "false")
