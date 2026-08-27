"""Runtime payment-provider resolution without persisting secret material.

Provider profiles pin a credential *reference*.  The actual secret resolver is
an infrastructure seam installed by the application composition root.  payOS
credentials can come from the process environment, but are never copied into
provider profiles, application responses, logs, or durable audit metadata.
"""

from __future__ import annotations

import os
import threading

from .providers.base import PaymentProviderError
from .providers.fake import FakePaymentProvider
from .providers.payos import PayOSCredentials, PayOSPaymentProvider


PAYOS_ENV_SECRET_NAMES = {
    "client_id": "PAYOS_CLIENT_ID",
    "api_key": "PAYOS_API_KEY",
    "checksum_key": "PAYOS_CHECKSUM_KEY",
}


class PaymentProviderRegistry:
    """Build and cache adapters by immutable provider-profile ID."""

    def __init__(self, *, environment=None, credential_resolver=None, clock=None):
        self.environment = os.environ if environment is None else environment
        self.credential_resolver = credential_resolver
        self.clock = clock
        self._providers = {}
        self._lock = threading.Lock()

    def resolve(self, profile):
        profile = dict(profile or {})
        profile_id = str(profile.get("provider_profile_id") or profile.get("id") or "")
        if not profile_id:
            raise PaymentProviderError(
                "NO_HEALTHY_PROVIDER", "Payment provider profile không hợp lệ."
            )
        with self._lock:
            existing = self._providers.get(profile_id)
            if existing is not None:
                return existing
            provider = self._build(profile, profile_id)
            self._providers[profile_id] = provider
            return provider

    def install(self, profile_id, provider):
        """Install a test or infrastructure-owned adapter explicitly."""
        with self._lock:
            self._providers[str(profile_id)] = provider

    def _build(self, profile, profile_id):
        provider_name = str(profile.get("provider") or "").strip().casefold()
        if provider_name == "fake":
            return FakePaymentProvider(
                scenario=str(self.environment.get("FAKE_PAYMENT_SCENARIO", "success")),
                clock=self.clock,
                profile_id=profile_id,
            )
        if provider_name != "payos":
            raise PaymentProviderError(
                "NO_HEALTHY_PROVIDER", "Payment provider không được hỗ trợ."
            )
        credential_reference = str(profile.get("credential_reference") or "").strip()
        if not credential_reference or self.credential_resolver is None:
            raise PaymentProviderError(
                "PROVIDER_CREDENTIAL_UNAVAILABLE",
                "Không thể resolve credential reference của payment provider.",
                retryable=True,
            )
        secret = self.credential_resolver(credential_reference)
        if not isinstance(secret, dict):
            raise PaymentProviderError(
                "PROVIDER_CREDENTIAL_UNAVAILABLE",
                "Secret resolver không trả về payment credential hợp lệ.",
                retryable=True,
            )
        credentials = PayOSCredentials(
            secret.get("client_id") or secret.get("clientId"),
            secret.get("api_key") or secret.get("apiKey"),
            secret.get("checksum_key") or secret.get("checksumKey"),
        )
        return PayOSPaymentProvider(
            credentials,
            timeout_seconds=max(
                0.1, min(30.0, int(profile.get("timeout_ms") or 5000) / 1000)
            ),
        )


_runtime_registry = PaymentProviderRegistry()


def payment_provider_registry():
    return _runtime_registry


def configure_payment_credential_resolver(resolver):
    """Replace only the process-local resolver; profile references stay in DB."""
    global _runtime_registry
    _runtime_registry = PaymentProviderRegistry(credential_resolver=resolver)
    return _runtime_registry


def build_payos_environment_credential_resolver(environment=None):
    """Build a reference-bound resolver without persisting secret material.

    Only the exact reference configured for this process can resolve.  A
    different DB profile reference returns ``None`` instead of falling back to
    the same merchant keys, preventing a profile/reference mix-up.
    """

    environment = os.environ if environment is None else environment
    configured_reference = str(
        environment.get("PAYOS_CREDENTIAL_REFERENCE", "")
    ).strip()

    def resolve(credential_reference):
        if (
            not configured_reference
            or str(credential_reference or "").strip() != configured_reference
        ):
            return None
        return {
            key: environment.get(variable_name)
            for key, variable_name in PAYOS_ENV_SECRET_NAMES.items()
        }

    return resolve


def configure_payment_runtime(environment=None):
    """Install the process-local payOS resolver at the application root."""

    global _runtime_registry
    environment = os.environ if environment is None else environment
    _runtime_registry = PaymentProviderRegistry(
        environment=environment,
        credential_resolver=build_payos_environment_credential_resolver(
            environment
        ),
    )
    return _runtime_registry


def validate_payment_provider_runtime(
    database,
    *,
    environment=None,
    registry=None,
):
    """Resolve the exact live DB profile before payment traffic is ready."""

    environment = os.environ if environment is None else environment
    payment_enabled = any(
        str(environment.get(name, "false")).strip().casefold() == "true"
        for name in ("PAYMENT_CHECKOUT_ENABLED", "PAYMENT_ACTIVATION_ENABLED")
    )
    provider_name = str(
        environment.get("COMMERCIAL_PAYMENT_PROVIDER", "fake")
    ).strip().casefold()
    if not payment_enabled or provider_name != "payos":
        return None

    provider_environment = str(
        environment.get("PAYMENT_PROVIDER_ENVIRONMENT", "")
    ).strip().casefold()
    configured_reference = str(
        environment.get("PAYOS_CREDENTIAL_REFERENCE", "")
    ).strip()
    connection = database.get_connection()
    try:
        row = connection.execute(
            """SELECT id AS provider_profile_id, provider, environment,
                      credential_reference, timeout_ms, max_attempts,
                      mode, readiness_status
                 FROM payment_provider_profiles
                WHERE provider = ? AND environment = ?
                  AND mode = 'live' AND readiness_status = 'ready'
                ORDER BY routing_priority, version DESC LIMIT 1""",
            (provider_name, provider_environment),
        ).fetchone()
    finally:
        connection.close()

    profile = dict(row) if row is not None else None
    if (
        not profile
        or str(profile.get("provider") or "").strip().casefold() != "payos"
        or str(profile.get("environment") or "").strip().casefold()
        != "production"
        or str(profile.get("mode") or "").strip().casefold() != "live"
        or str(profile.get("readiness_status") or "").strip().casefold()
        != "ready"
    ):
        raise RuntimeError(
            "payOS live/ready production profile is unavailable."
        )
    if str(profile.get("credential_reference") or "").strip() != configured_reference:
        raise RuntimeError(
            "payOS database credential reference does not match "
            "PAYOS_CREDENTIAL_REFERENCE."
        )

    active_registry = registry or payment_provider_registry()
    try:
        return active_registry.resolve(profile)
    except (PaymentProviderError, TypeError, ValueError) as exc:
        raise RuntimeError(
            "payOS credentials could not be resolved for the live provider profile."
        ) from exc
