"""Runtime source-selection seam for procurement import.

The HTTP route adapter supplies concrete source factories; this module owns
environment precedence, provider validation, and bounded timeout policy.
"""

from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True, slots=True)
class ProcurementRouteError(RuntimeError):
    code: str
    message: str
    status_code: int

    def __str__(self):
        return self.message


def procurement_provider_name(environ=None):
    """Resolve one provider using the shared lookup/import precedence."""

    environment = os.environ if environ is None else environ
    explicit = str(environment.get("PROCUREMENT_PROVIDER") or "").strip()
    if explicit:
        return explicit.casefold()
    lookup_enabled = str(
        environment.get("PROCUREMENT_LOOKUP_ENABLED") or ""
    ).strip().casefold() == "true"
    if lookup_enabled:
        return "muasamcong"
    return str(
        environment.get("VNEPS_PROCUREMENT_PROVIDER", "disabled")
    ).strip().casefold()


def procurement_import_enabled(environ=None):
    """Return whether either enabled connector authorizes import preparation."""

    environment = os.environ if environ is None else environ
    import_enabled = str(environment.get(
        "PROCUREMENT_IMPORT_ENABLED",
        environment.get("VNEPS_PROCUREMENT_IMPORT_ENABLED", "false"),
    )).strip().casefold() == "true"
    if import_enabled:
        return True
    lookup_enabled = str(
        environment.get("PROCUREMENT_LOOKUP_ENABLED", "false")
    ).strip().casefold() == "true"
    return lookup_enabled and procurement_provider_name(environment) in {
        "muasamcong", "web_dau_thau",
    }


def procurement_source_timeout_seconds(environ=None):
    """Return the bounded blocking-I/O timeout appropriate to the provider."""

    environment = os.environ if environ is None else environ
    provider = procurement_provider_name(environment)
    if provider in {"muasamcong", "web_dau_thau"}:
        return max(
            20.0,
            min(float(environment.get("MUASAMCONG_REQUEST_TIMEOUT_SECONDS", "60")), 120.0),
        )
    return max(
        1.0,
        min(float(environment.get("VNEPS_PROCUREMENT_TIMEOUT_SECONDS", "8")), 120.0),
    )


def build_procurement_source(
    *,
    fixture_source_factory,
    vneps_source_factory,
    muasamcong_source_factory,
    environ=None,
):
    """Build the selected source without exposing environment rules to routes."""

    environment = os.environ if environ is None else environ
    if not procurement_import_enabled(environment):
        raise ProcurementRouteError(
            "PROCUREMENT_LOOKUP_DISABLED",
            "Tính năng nhập Mua Sắm Công chưa được bật.",
            503,
        )
    provider = procurement_provider_name(environment)
    if provider == "fixture":
        if str(environment.get("APP_ENV", "")).strip().casefold() not in {
            "test", "testing",
        }:
            raise ProcurementRouteError(
                "PROCUREMENT_LOOKUP_DISABLED",
                "Fixture procurement chỉ được phép trong APP_ENV=test.",
                503,
            )
        path = str(environment.get("VNEPS_PROCUREMENT_FIXTURE_PATH", "")).strip()
        if not path:
            raise ProcurementRouteError(
                "PROCUREMENT_LOOKUP_DISABLED", "Chưa cấu hình fixture provider.", 503
            )
        return fixture_source_factory(path)
    if provider == "vneps":
        return vneps_source_factory()
    if provider in {"muasamcong", "web_dau_thau"}:
        return muasamcong_source_factory()
    raise ProcurementRouteError(
        "PROCUREMENT_LOOKUP_DISABLED",
        "Connector procurement chưa được cấu hình.",
        503,
    )
