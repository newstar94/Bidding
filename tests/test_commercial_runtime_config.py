import pytest

from backend.commercial_policy.config import (
    CommercialRuntimeConfig,
    validate_commercial_startup_configuration,
)


def test_commercial_runtime_defaults_remain_fully_disabled():
    config = CommercialRuntimeConfig.from_environment({})
    assert config.mode == "off"
    assert not config.enabled
    assert not config.payment_checkout_enabled
    assert not config.payment_activation_enabled
    assert not config.procurement_credit_enforcement_enabled


@pytest.mark.parametrize(
    "environment",
    [
        {"COMMERCIAL_POLICY_MODE": "shadow"},
        {"PAYMENT_CHECKOUT_ENABLED": "true"},
        {
            "COMMERCIAL_POLICY_ENABLED": "true",
            "COMMERCIAL_POLICY_MODE": "shadow",
            "PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED": "true",
        },
    ],
)
def test_contradictory_commercial_flags_fail_closed(environment):
    with pytest.raises(RuntimeError):
        CommercialRuntimeConfig.from_environment(environment)


def test_production_payment_requires_payos_and_every_external_readiness_gate():
    base = {
        "APP_ENV": "production",
        "COMMERCIAL_POLICY_ENABLED": "true",
        "COMMERCIAL_POLICY_MODE": "enforce",
        "PAYMENT_CHECKOUT_ENABLED": "true",
    }
    with pytest.raises(RuntimeError, match="Fake Provider"):
        validate_commercial_startup_configuration(base)
    base["COMMERCIAL_PAYMENT_PROVIDER"] = "payos"
    with pytest.raises(RuntimeError, match="external readiness"):
        validate_commercial_startup_configuration(base)
    base.update({
        "COMMERCIAL_EXTERNAL_LEGAL_READY": "true",
        "PAYOS_MERCHANT_AUTHORIZATION_CONFIRMED": "true",
        "PAYOS_WEBHOOK_AUTHORIZATION_CONFIRMED": "true",
        "PAYOS_CREDENTIAL_REFERENCE": "secret://biddingflow/payos/merchant-1",
    })
    assert validate_commercial_startup_configuration(base).payment_checkout_enabled


def test_checkout_off_activation_on_is_a_supported_incident_response_combination():
    config = CommercialRuntimeConfig.from_environment({
        "COMMERCIAL_POLICY_ENABLED": "true",
        "COMMERCIAL_POLICY_MODE": "enforce",
        "PAYMENT_CHECKOUT_ENABLED": "false",
        "PAYMENT_ACTIVATION_ENABLED": "true",
    })
    assert not config.payment_checkout_enabled
    assert config.payment_activation_enabled
