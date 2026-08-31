"""Bounded capabilities advertised to same-origin web clients."""

import os

AGGREGATE_VERSION_V1 = "aggregate-version-v1"
PROCUREMENT_IMPORT_V2 = "procurement-import-v2"
PROCUREMENT_LOOKUP_V1 = "procurement-lookup-v1"
CONFLICT_CENTER_V1 = "conflict-center-v1"
SERVER_CAPABILITIES = (AGGREGATE_VERSION_V1,)


def _procurement_import_available(environ):
    import_enabled = str(
        environ.get(
            "PROCUREMENT_IMPORT_ENABLED",
            environ.get("VNEPS_PROCUREMENT_IMPORT_ENABLED", "true"),
        )
    ).strip().casefold() == "true"
    lookup_enabled = str(
        environ.get("PROCUREMENT_LOOKUP_ENABLED", "true")
    ).strip().casefold() == "true"
    explicit_provider = str(environ.get("PROCUREMENT_PROVIDER") or "").strip()
    if explicit_provider:
        provider = explicit_provider.casefold()
    elif (
        "PROCUREMENT_LOOKUP_ENABLED" not in environ
        and str(environ.get("VNEPS_PROCUREMENT_PROVIDER") or "").strip()
    ):
        provider = str(environ["VNEPS_PROCUREMENT_PROVIDER"]).strip().casefold()
    elif lookup_enabled:
        # The lookup connector is the Mua Sam Cong connector when no
        # dedicated import provider has been configured.  Keep capability
        # advertisement aligned with procurement_import.routes._provider_name.
        provider = "muasamcong"
    else:
        provider = "muasamcong"
    app_env = str(environ.get("APP_ENV", "development")).strip().casefold()
    fixture_path = str(
        environ.get("VNEPS_PROCUREMENT_FIXTURE_PATH", "")
    ).strip()
    return bool(
        (import_enabled or lookup_enabled)
        and (
            provider in {"muasamcong", "web_dau_thau"}
            or (
                provider == "fixture"
                and app_env in {"test", "testing"}
                and fixture_path
            )
        )
    )


def current_server_capabilities(environ=None):
    environ = os.environ if environ is None else environ
    capabilities = list(SERVER_CAPABILITIES)
    if _procurement_import_available(environ):
        capabilities.append(PROCUREMENT_IMPORT_V2)
    if str(environ.get("PROCUREMENT_LOOKUP_ENABLED", "true")).strip().casefold() == "true":
        capabilities.append(PROCUREMENT_LOOKUP_V1)
    if str(environ.get("CONFLICT_CENTER_ENABLED", "false")).strip().casefold() == "true":
        capabilities.append(CONFLICT_CENTER_V1)
    return capabilities


def with_server_capabilities(payload):
    """Attach the additive compatibility contract without mutating callers."""
    return {**payload, "serverCapabilities": current_server_capabilities()}
