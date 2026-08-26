"""Runtime payment-provider resolution without persisting secret material.

Provider profiles pin a credential *reference*.  The actual secret resolver is
an infrastructure seam and can be installed by the deployment process.  This
module deliberately has no environment-variable fallback for payOS secrets.
"""

from __future__ import annotations

import os
import threading

from .providers.base import PaymentProviderError
from .providers.fake import FakePaymentProvider
from .providers.payos import PayOSCredentials, PayOSPaymentProvider


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
