from types import SimpleNamespace

import pytest

from backend.billing.providers.payos import PayOSPaymentProvider
from backend.billing.runtime import (
    PaymentProviderRegistry,
    build_payos_environment_credential_resolver,
    validate_payment_provider_runtime,
)
from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    UPGRADES,
    _upgrade_to_v80_add_live_payos_profile,
)


PAYOS_REFERENCE = "env://payos/default"


def _environment(**overrides):
    environment = {
        "APP_ENV": "production",
        "COMMERCIAL_POLICY_ENABLED": "true",
        "COMMERCIAL_POLICY_MODE": "enforce",
        "PAYMENT_CHECKOUT_ENABLED": "true",
        "PAYMENT_ACTIVATION_ENABLED": "true",
        "COMMERCIAL_PAYMENT_PROVIDER": "payos",
        "PAYMENT_PROVIDER_ENVIRONMENT": "production",
        "PAYOS_CREDENTIAL_REFERENCE": PAYOS_REFERENCE,
        "PAYOS_CLIENT_ID": "client-value",
        "PAYOS_API_KEY": "api-value",
        "PAYOS_CHECKSUM_KEY": "checksum-value",
    }
    environment.update(overrides)
    return environment


def _profile(**overrides):
    profile = {
        "provider_profile_id": "provider-payos-production-v2",
        "provider": "payos",
        "environment": "production",
        "credential_reference": PAYOS_REFERENCE,
        "timeout_ms": 5000,
        "max_attempts": 3,
        "mode": "live",
        "readiness_status": "ready",
    }
    profile.update(overrides)
    return profile


class _ProfileConnection:
    def __init__(self, profile):
        self.profile = profile
        self.closed = False

    def execute(self, _statement, _parameters=()):
        return SimpleNamespace(fetchone=lambda: self.profile)

    def close(self):
        self.closed = True


class _ProfileDatabase:
    def __init__(self, profile):
        self.connection = _ProfileConnection(profile)

    def get_connection(self):
        return self.connection


def test_payos_environment_resolver_only_serves_the_pinned_reference():
    resolver = build_payos_environment_credential_resolver(_environment())

    assert resolver(PAYOS_REFERENCE) == {
        "client_id": "client-value",
        "api_key": "api-value",
        "checksum_key": "checksum-value",
    }
    assert resolver("env://payos/different") is None


def test_payos_registry_builds_real_adapter_from_process_local_credentials():
    environment = _environment()
    registry = PaymentProviderRegistry(
        environment=environment,
        credential_resolver=build_payos_environment_credential_resolver(environment),
    )

    provider = registry.resolve(_profile())

    assert isinstance(provider, PayOSPaymentProvider)
    assert provider.credentials.client_id == "client-value"
    assert provider.credentials.api_key == "api-value"
    assert provider.credentials.checksum_key == "checksum-value"


def test_payment_runtime_rejects_profile_reference_mismatch_without_secret_values():
    environment = _environment()
    database = _ProfileDatabase(
        _profile(credential_reference="secret://wrong/provider")
    )
    registry = PaymentProviderRegistry(
        environment=environment,
        credential_resolver=build_payos_environment_credential_resolver(environment),
    )

    with pytest.raises(RuntimeError) as error:
        validate_payment_provider_runtime(
            database,
            environment=environment,
            registry=registry,
        )

    message = str(error.value)
    assert "credential reference" in message
    assert "client-value" not in message
    assert "api-value" not in message
    assert "checksum-value" not in message


@pytest.mark.parametrize(
    "profile",
    [
        None,
        _profile(mode="shadow"),
        _profile(readiness_status="blocked_external"),
        _profile(environment="staging"),
    ],
)
def test_payment_runtime_requires_matching_live_ready_production_profile(profile):
    environment = _environment()
    database = _ProfileDatabase(profile)
    registry = PaymentProviderRegistry(
        environment=environment,
        credential_resolver=build_payos_environment_credential_resolver(environment),
    )

    with pytest.raises(RuntimeError, match="live/ready production profile"):
        validate_payment_provider_runtime(
            database,
            environment=environment,
            registry=registry,
        )


def test_payment_runtime_resolves_the_database_profile_before_readiness():
    environment = _environment()
    database = _ProfileDatabase(_profile())
    registry = PaymentProviderRegistry(
        environment=environment,
        credential_resolver=build_payos_environment_credential_resolver(environment),
    )

    resolved = validate_payment_provider_runtime(
        database,
        environment=environment,
        registry=registry,
    )

    assert isinstance(resolved, PayOSPaymentProvider)
    assert database.connection.closed is True


def test_disabled_payment_runtime_does_not_require_database_or_credentials():
    environment = {
        "COMMERCIAL_POLICY_ENABLED": "false",
        "COMMERCIAL_POLICY_MODE": "off",
        "COMMERCIAL_PAYMENT_PROVIDER": "payos",
    }

    assert validate_payment_provider_runtime(
        object(), environment=environment
    ) is None


def test_v80_migration_adds_immutable_live_profile_without_secret_values():
    statements = []

    class Cursor:
        def execute(self, statement, _parameters=()):
            statements.append(" ".join(statement.split()))

    _upgrade_to_v80_add_live_payos_profile(Cursor(), None)

    assert DB_SCHEMA_VERSION >= 80
    assert next(upgrade.name for upgrade in UPGRADES if upgrade.version == 80) == (
        "add_live_payos_profile"
    )
    assert "provider-payos-production-v2" in statements[0]
    assert "env://payos/default" in statements[0]
    assert "'live', 'ready'" in statements[0]
    assert "PAYOS_CLIENT_ID" not in statements[0]
    assert "PAYOS_API_KEY" not in statements[0]
    assert "PAYOS_CHECKSUM_KEY" not in statements[0]
