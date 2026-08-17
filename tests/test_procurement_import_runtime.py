import pytest

from backend.procurement_import.runtime import (
    ProcurementRouteError,
    build_procurement_source,
    procurement_import_enabled,
    procurement_provider_name,
    procurement_source_timeout_seconds,
)


def _build(environ):
    return build_procurement_source(
        environ=environ,
        fixture_source_factory=lambda path: ("fixture", path),
        vneps_source_factory=lambda: "vneps",
        muasamcong_source_factory=lambda: "muasamcong",
    )


def test_runtime_resolves_shared_lookup_connector_and_timeout_from_one_seam():
    environment = {
        "PROCUREMENT_LOOKUP_ENABLED": "true",
        "VNEPS_PROCUREMENT_PROVIDER": "vneps",
        "MUASAMCONG_REQUEST_TIMEOUT_SECONDS": "999",
    }

    assert procurement_provider_name(environment) == "muasamcong"
    assert procurement_import_enabled(environment) is True
    assert procurement_source_timeout_seconds(environment) == 120.0
    assert _build(environment) == "muasamcong"


def test_runtime_preserves_fixture_and_disabled_provider_error_contracts():
    fixture_environment = {
        "PROCUREMENT_IMPORT_ENABLED": "true",
        "VNEPS_PROCUREMENT_PROVIDER": "fixture",
        "APP_ENV": "test",
        "VNEPS_PROCUREMENT_FIXTURE_PATH": "fixture.json",
    }
    assert _build(fixture_environment) == ("fixture", "fixture.json")

    with pytest.raises(ProcurementRouteError) as disabled:
        _build({"VNEPS_PROCUREMENT_PROVIDER": "disabled"})
    assert disabled.value.code == "PROCUREMENT_LOOKUP_DISABLED"
    assert disabled.value.status_code == 503

    with pytest.raises(ProcurementRouteError, match="APP_ENV=test"):
        _build({
            "PROCUREMENT_IMPORT_ENABLED": "true",
            "VNEPS_PROCUREMENT_PROVIDER": "fixture",
            "APP_ENV": "development",
        })
