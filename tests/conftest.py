import os

import pytest

# DB-backed tests read TEST_DATABASE_URL from .env. When that local cluster is
# stopped, libpq would otherwise wait on the OS TCP timeout per connect and the
# suite appears hung; fail the connect quickly so those tests skip/error fast.
os.environ.setdefault("PGCONNECT_TIMEOUT", "5")


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
