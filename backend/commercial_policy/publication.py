"""Automatic technical preparation for an explicitly requested publication."""

from copy import deepcopy

from backend.billing.runtime import payment_provider_registry
from backend.billing.providers.base import PaymentProviderError

from .errors import CommercialPolicyError, NO_HEALTHY_PROVIDER


def prepare_publication_document(cursor, document, *, registry=None):
    candidate = deepcopy(document)
    rollout = candidate.get("rollout")
    if not isinstance(rollout, dict) or rollout.get("mode") not in {"pilot", "production"}:
        return candidate
    row = cursor.execute(
        """SELECT id, provider, environment, credential_reference, mode,
                  min_amount, max_amount, checkout_ttl_seconds, timeout_ms
             FROM payment_provider_profiles
            WHERE provider = 'payos' AND environment = 'production'
              AND mode = 'live' AND readiness_status = 'ready'
            ORDER BY routing_priority, version DESC LIMIT 1"""
    ).fetchone()
    profile = dict(row) if row else None
    if not profile or not str(profile.get("credential_reference") or "").strip():
        raise CommercialPolicyError(
            NO_HEALTHY_PROVIDER, "Chưa có cấu hình payOS thực tế trên máy chủ.", status_code=409,
            details={"errors": [{"path": "providerProfiles", "code": NO_HEALTHY_PROVIDER,
                                 "message": "Chưa có cấu hình payOS thực tế trên máy chủ."}]},
        )
    try:
        (registry or payment_provider_registry()).resolve(profile)
    except (PaymentProviderError, TypeError, ValueError) as exc:
        raise CommercialPolicyError(
            NO_HEALTHY_PROVIDER, "Bộ khóa payOS trên máy chủ chưa sử dụng được.", status_code=409,
            details={"errors": [{"path": "providerProfiles", "code": NO_HEALTHY_PROVIDER,
                                 "message": "Bộ khóa payOS trên máy chủ chưa sử dụng được."}]},
        ) from exc
    profiles = candidate.get("providerProfiles")
    if not isinstance(profiles, list):
        # Let document validation report malformed configuration.
        return candidate
    configured = next((item for item in profiles if isinstance(item, dict)
                       and item.get("provider") == "payos"
                       and item.get("environment") == "production"), None)
    if configured is None:
        configured = {
            "alias": "payOS", "provider": "payos", "environment": "production",
            "minAmount": profile["min_amount"], "maxAmount": profile["max_amount"],
            "checkoutTtlSeconds": profile["checkout_ttl_seconds"],
        }
        profiles.append(configured)
    configured.update(mode="live", readiness="ready",
                      credentialReference=profile["credential_reference"])
    return candidate
