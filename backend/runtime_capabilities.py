"""Bounded capabilities advertised to same-origin web clients."""

import os

AGGREGATE_VERSION_V1 = "aggregate-version-v1"
PROCUREMENT_IMPORT_V2 = "procurement-import-v2"
PROCUREMENT_LOOKUP_V1 = "procurement-lookup-v1"
SERVER_CAPABILITIES = (AGGREGATE_VERSION_V1,)


def _procurement_import_available(environ):
    enabled = str(
        environ.get("VNEPS_PROCUREMENT_IMPORT_ENABLED", "false")
    ).strip().casefold() == "true"
    provider = str(
        environ.get("VNEPS_PROCUREMENT_PROVIDER", "disabled")
    ).strip().casefold()
    app_env = str(environ.get("APP_ENV", "development")).strip().casefold()
    fixture_path = str(
        environ.get("VNEPS_PROCUREMENT_FIXTURE_PATH", "")
    ).strip()
    # The checked-in VNEPS connector deliberately fails closed until an
    # official detail contract exists. Only the deterministic test fixture is
    # currently a usable implementation of the richer revision-import port.
    return bool(
        enabled
        and provider == "fixture"
        and app_env in {"test", "testing"}
        and fixture_path
    )


def current_server_capabilities(environ=None):
    environ = os.environ if environ is None else environ
    capabilities = list(SERVER_CAPABILITIES)
    if _procurement_import_available(environ):
        capabilities.append(PROCUREMENT_IMPORT_V2)
    if str(environ.get("PROCUREMENT_LOOKUP_ENABLED", "false")).strip().casefold() == "true":
        capabilities.append(PROCUREMENT_LOOKUP_V1)
    return capabilities


def with_server_capabilities(payload):
    """Attach the additive compatibility contract without mutating callers."""
    return {**payload, "serverCapabilities": current_server_capabilities()}
