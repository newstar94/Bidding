"""Deployment controls for commercial policy, billing and usage enforcement."""

from __future__ import annotations

from dataclasses import dataclass


def _flag(environment, name, default="false"):
    return str(environment.get(name, default)).strip().casefold() == "true"


@dataclass(frozen=True)
class CommercialRuntimeConfig:
    trial_full_access_enabled: bool
    enabled: bool
    mode: str
    payment_checkout_enabled: bool
    payment_activation_enabled: bool
    procurement_credit_enforcement_enabled: bool

    @classmethod
    def from_environment(cls, environment):
        trial_enabled = _flag(environment, "TRIAL_FULL_ACCESS_ENABLED")
        config = cls(
            trial_full_access_enabled=trial_enabled,
            enabled=False if trial_enabled else _flag(environment, "COMMERCIAL_POLICY_ENABLED"),
            mode=(
                "off"
                if trial_enabled
                else str(environment.get("COMMERCIAL_POLICY_MODE", "off"))
                .strip()
                .casefold()
            ),
            payment_checkout_enabled=(
                False if trial_enabled else _flag(environment, "PAYMENT_CHECKOUT_ENABLED")
            ),
            payment_activation_enabled=(
                False if trial_enabled else _flag(environment, "PAYMENT_ACTIVATION_ENABLED")
            ),
            procurement_credit_enforcement_enabled=(
                False
                if trial_enabled
                else _flag(environment, "PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED")
            ),
        )
        config.validate()
        return config

    def validate(self):
        if self.mode not in {"off", "shadow", "enforce"}:
            raise RuntimeError("COMMERCIAL_POLICY_MODE must be off, shadow, or enforce.")
        if not self.enabled and self.mode != "off":
            raise RuntimeError(
                "COMMERCIAL_POLICY_ENABLED=false conflicts with shadow/enforce mode."
            )
        if self.procurement_credit_enforcement_enabled and (
            not self.enabled or self.mode != "enforce"
        ):
            raise RuntimeError(
                "PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED requires commercial enforce mode."
            )
        if self.payment_checkout_enabled and (
            not self.enabled or self.mode != "enforce"
        ):
            raise RuntimeError(
                "PAYMENT_CHECKOUT_ENABLED requires commercial enforce mode."
            )


def commercial_runtime_config(environment=None):
    if environment is None:
        import os

        environment = os.environ
    return CommercialRuntimeConfig.from_environment(environment)


def trial_full_access_enabled(environment=None):
    """Return the deployment-wide trial switch used at entitlement seams."""

    return commercial_runtime_config(environment).trial_full_access_enabled


def validate_commercial_startup_configuration(environment):
    """Reject live-looking deployments that have not passed external gates."""

    config = CommercialRuntimeConfig.from_environment(environment)
    app_environment = str(environment.get("APP_ENV", "development")).strip().casefold()
    production = app_environment in {"prod", "production"}
    provider = str(environment.get("COMMERCIAL_PAYMENT_PROVIDER", "fake")).strip().casefold()
    if provider not in {"fake", "payos"}:
        raise RuntimeError("COMMERCIAL_PAYMENT_PROVIDER must be fake or payos.")
    payment_enabled = (
        config.payment_checkout_enabled or config.payment_activation_enabled
    )
    if production and payment_enabled:
        if provider != "payos":
            raise RuntimeError("Production payment processing cannot use Fake Provider.")
    if provider == "payos" and payment_enabled:
        if (
            str(environment.get("PAYMENT_PROVIDER_ENVIRONMENT", ""))
            .strip()
            .casefold()
            != "production"
        ):
            raise RuntimeError(
                "payOS requires PAYMENT_PROVIDER_ENVIRONMENT=production; "
                "payOS does not provide a separate sandbox provider."
            )
        readiness_flags = [
            "PAYOS_MERCHANT_AUTHORIZATION_CONFIRMED",
            "PAYOS_WEBHOOK_AUTHORIZATION_CONFIRMED",
        ]
        if production:
            readiness_flags.insert(0, "COMMERCIAL_EXTERNAL_LEGAL_READY")
        missing = [name for name in readiness_flags if not _flag(environment, name)]
        required_values = (
            "PAYOS_CREDENTIAL_REFERENCE",
            "PAYOS_CLIENT_ID",
            "PAYOS_API_KEY",
            "PAYOS_CHECKSUM_KEY",
        )
        missing.extend(
            name
            for name in required_values
            if not str(environment.get(name, "")).strip()
        )
        if missing:
            raise RuntimeError(
                "payOS payment processing is blocked by external readiness: "
                + ", ".join(missing)
            )
    return config
