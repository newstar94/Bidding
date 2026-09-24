import os
from pathlib import Path
import subprocess
import sys

import pytest

from backend.commercial_policy.config import commercial_runtime_config


def test_commercial_default_probe():
    config = commercial_runtime_config()
    assert not config.trial_full_access_enabled
    assert not config.enabled
    assert config.mode == "off"
    assert not config.payment_checkout_enabled
    assert not config.payment_activation_enabled
    assert not config.procurement_credit_enforcement_enabled


@pytest.mark.parametrize("mode", ["off", "enforce"])
def test_pytest_isolates_ambient_commercial_flags(mode):
    environment = {
        **os.environ,
        "TRIAL_FULL_ACCESS_ENABLED": "true",
        "COMMERCIAL_POLICY_ENABLED": "false" if mode == "off" else "true",
        "COMMERCIAL_POLICY_MODE": mode,
        "PAYMENT_CHECKOUT_ENABLED": "true",
        "PAYMENT_ACTIVATION_ENABLED": "true",
        "PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED": "true",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    result = subprocess.run(
        [sys.executable, "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider",
         f"{__file__}::test_commercial_default_probe"],
        cwd=Path(__file__).resolve().parents[1], env=environment,
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
