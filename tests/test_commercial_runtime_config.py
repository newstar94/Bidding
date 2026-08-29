import pytest

from backend.commercial_policy.config import (
    CommercialRuntimeConfig,
    validate_commercial_startup_configuration,
)


def test_commercial_runtime_defaults_remain_fully_disabled():
    config = CommercialRuntimeConfig.from_environment({})
    assert not config.trial_full_access_enabled
    assert config.mode == "off"
    assert not config.enabled
    assert not config.payment_checkout_enabled
    assert not config.payment_activation_enabled
    assert not config.procurement_credit_enforcement_enabled


def test_trial_full_access_disables_every_commercial_enforcement_switch():
    config = CommercialRuntimeConfig.from_environment({
        "TRIAL_FULL_ACCESS_ENABLED": "true",
        "COMMERCIAL_POLICY_ENABLED": "true",
        "COMMERCIAL_POLICY_MODE": "enforce",
        "PAYMENT_CHECKOUT_ENABLED": "true",
        "PAYMENT_ACTIVATION_ENABLED": "true",
        "PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED": "true",
    })

    assert config.trial_full_access_enabled
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
    base["PAYMENT_PROVIDER_ENVIRONMENT"] = "production"
    with pytest.raises(RuntimeError, match="external readiness"):
        validate_commercial_startup_configuration(base)
    base.update({
        "COMMERCIAL_EXTERNAL_LEGAL_READY": "true",
        "PAYOS_MERCHANT_AUTHORIZATION_CONFIRMED": "true",
        "PAYOS_WEBHOOK_AUTHORIZATION_CONFIRMED": "true",
        "PAYOS_CREDENTIAL_REFERENCE": "env://payos/default",
        "PAYOS_CLIENT_ID": "client-value",
        "PAYOS_API_KEY": "api-value",
        "PAYOS_CHECKSUM_KEY": "checksum-value",
    })
    assert validate_commercial_startup_configuration(base).payment_checkout_enabled


@pytest.mark.parametrize(
    "missing_name",
    ("PAYOS_CLIENT_ID", "PAYOS_API_KEY", "PAYOS_CHECKSUM_KEY"),
)
def test_enabled_payos_requires_every_process_local_credential(missing_name):
    environment = {
        "APP_ENV": "development",
        "COMMERCIAL_POLICY_ENABLED": "true",
        "COMMERCIAL_POLICY_MODE": "enforce",
        "PAYMENT_CHECKOUT_ENABLED": "true",
        "COMMERCIAL_PAYMENT_PROVIDER": "payos",
        "PAYMENT_PROVIDER_ENVIRONMENT": "production",
        "PAYOS_MERCHANT_AUTHORIZATION_CONFIRMED": "true",
        "PAYOS_WEBHOOK_AUTHORIZATION_CONFIRMED": "true",
        "PAYOS_CREDENTIAL_REFERENCE": "env://payos/default",
        "PAYOS_CLIENT_ID": "client-value",
        "PAYOS_API_KEY": "api-value",
        "PAYOS_CHECKSUM_KEY": "checksum-value",
    }
    environment.pop(missing_name)

    with pytest.raises(RuntimeError) as error:
        validate_commercial_startup_configuration(environment)

    message = str(error.value)
    assert missing_name in message
    assert "client-value" not in message
    assert "api-value" not in message
    assert "checksum-value" not in message


def test_enabled_payos_rejects_non_production_provider_environment():
    environment = {
        "APP_ENV": "development",
        "COMMERCIAL_POLICY_ENABLED": "true",
        "COMMERCIAL_POLICY_MODE": "enforce",
        "PAYMENT_CHECKOUT_ENABLED": "true",
        "COMMERCIAL_PAYMENT_PROVIDER": "payos",
        "PAYMENT_PROVIDER_ENVIRONMENT": "test",
    }

    with pytest.raises(RuntimeError, match="PAYMENT_PROVIDER_ENVIRONMENT=production"):
        validate_commercial_startup_configuration(environment)


def test_checkout_off_activation_on_is_a_supported_incident_response_combination():
    config = CommercialRuntimeConfig.from_environment({
        "COMMERCIAL_POLICY_ENABLED": "true",
        "COMMERCIAL_POLICY_MODE": "enforce",
        "PAYMENT_CHECKOUT_ENABLED": "false",
        "PAYMENT_ACTIVATION_ENABLED": "true",
    })
    assert not config.payment_checkout_enabled
    assert config.payment_activation_enabled
