import pytest


@pytest.fixture(autouse=True)
def _commercial_trial_mode_is_explicit_per_test(monkeypatch):
    """Keep paid-mode regressions deterministic when the local .env enables trial."""

    monkeypatch.setenv("TRIAL_FULL_ACCESS_ENABLED", "false")
    # Keep the suite hermetic when backend.app imports an ignored developer
    # .env. Paid-mode tests explicitly opt into their required flags.
    monkeypatch.setenv("COMMERCIAL_POLICY_ENABLED", "false")
    monkeypatch.setenv("COMMERCIAL_POLICY_MODE", "off")
    monkeypatch.setenv("PAYMENT_CHECKOUT_ENABLED", "false")
    monkeypatch.setenv("PAYMENT_ACTIVATION_ENABLED", "false")
    monkeypatch.setenv("PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED", "false")
