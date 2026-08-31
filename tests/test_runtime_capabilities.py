from backend.auth.auth_routes import build_session_bootstrap
from backend.runtime_capabilities import (
    AGGREGATE_VERSION_V1,
    PROCUREMENT_IMPORT_V2,
    PROCUREMENT_LOOKUP_V1,
    CONFLICT_CENTER_V1,
    SERVER_CAPABILITIES,
    with_server_capabilities,
)


class _AnonymousRequest:
    cookies = {}


def test_procurement_capabilities_are_advertised_by_default(monkeypatch):
    for name in (
        "PROCUREMENT_LOOKUP_ENABLED",
        "PROCUREMENT_IMPORT_ENABLED",
        "PROCUREMENT_PROVIDER",
        "VNEPS_PROCUREMENT_IMPORT_ENABLED",
        "VNEPS_PROCUREMENT_PROVIDER",
    ):
        monkeypatch.delenv(name, raising=False)

    capabilities = with_server_capabilities({"valid": True})["serverCapabilities"]

    assert PROCUREMENT_LOOKUP_V1 in capabilities
    assert PROCUREMENT_IMPORT_V2 in capabilities


def test_session_bootstrap_advertises_bounded_server_capabilities(monkeypatch):
    monkeypatch.setenv("PROCUREMENT_LOOKUP_ENABLED", "false")
    monkeypatch.setenv("PROCUREMENT_IMPORT_ENABLED", "false")
    payload = build_session_bootstrap(_AnonymousRequest())

    assert payload == {
        "valid": False,
        "reason": "missing_auth",
        "serverCapabilities": [AGGREGATE_VERSION_V1],
    }
    assert SERVER_CAPABILITIES == (AGGREGATE_VERSION_V1,)


def test_capability_projection_does_not_mutate_source_payload(monkeypatch):
    monkeypatch.setenv("PROCUREMENT_LOOKUP_ENABLED", "false")
    monkeypatch.setenv("PROCUREMENT_IMPORT_ENABLED", "false")
    source = {"valid": True}

    projected = with_server_capabilities(source)

    assert source == {"valid": True}
    assert projected["serverCapabilities"] == ["aggregate-version-v1"]


def test_procurement_lookup_capability_is_advertised_only_when_enabled(monkeypatch):
    monkeypatch.setenv("PROCUREMENT_LOOKUP_ENABLED", "true")
    enabled = with_server_capabilities({"valid": True})
    monkeypatch.setenv("PROCUREMENT_LOOKUP_ENABLED", "false")
    disabled = with_server_capabilities({"valid": True})

    assert PROCUREMENT_LOOKUP_V1 in enabled["serverCapabilities"]
    assert PROCUREMENT_LOOKUP_V1 not in disabled["serverCapabilities"]


def test_conflict_center_capability_is_advertised_only_when_enabled(monkeypatch):
    monkeypatch.setenv("CONFLICT_CENTER_ENABLED", "true")
    enabled = with_server_capabilities({"valid": True})
    monkeypatch.setenv("CONFLICT_CENTER_ENABLED", "false")
    disabled = with_server_capabilities({"valid": True})

    assert CONFLICT_CENTER_V1 in enabled["serverCapabilities"]
    assert CONFLICT_CENTER_V1 not in disabled["serverCapabilities"]


def test_muasamcong_lookup_also_advertises_opening_import_capability(monkeypatch):
    monkeypatch.delenv("PROCUREMENT_IMPORT_ENABLED", raising=False)
    monkeypatch.delenv("VNEPS_PROCUREMENT_IMPORT_ENABLED", raising=False)
    monkeypatch.delenv("PROCUREMENT_PROVIDER", raising=False)
    monkeypatch.setenv("VNEPS_PROCUREMENT_PROVIDER", "disabled")
    monkeypatch.setenv("PROCUREMENT_LOOKUP_ENABLED", "true")

    capabilities = with_server_capabilities({"valid": True})["serverCapabilities"]

    assert PROCUREMENT_IMPORT_V2 in capabilities


def test_procurement_import_capability_is_not_advertised_for_unusable_vneps(
    monkeypatch,
):
    monkeypatch.delenv("PROCUREMENT_IMPORT_ENABLED", raising=False)
    monkeypatch.delenv("PROCUREMENT_LOOKUP_ENABLED", raising=False)
    monkeypatch.delenv("PROCUREMENT_PROVIDER", raising=False)
    monkeypatch.setenv("VNEPS_PROCUREMENT_IMPORT_ENABLED", "true")
    monkeypatch.setenv("VNEPS_PROCUREMENT_PROVIDER", "vneps")
    monkeypatch.setenv("VNEPS_PROCUREMENT_API_AUTHORIZATION_CONFIRMED", "false")

    capabilities = with_server_capabilities({"valid": True})[
        "serverCapabilities"
    ]

    assert PROCUREMENT_IMPORT_V2 not in capabilities


def test_procurement_import_capability_is_advertised_for_test_fixture(
    monkeypatch,
):
    monkeypatch.delenv("PROCUREMENT_IMPORT_ENABLED", raising=False)
    monkeypatch.delenv("PROCUREMENT_PROVIDER", raising=False)
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("VNEPS_PROCUREMENT_IMPORT_ENABLED", "true")
    monkeypatch.setenv("VNEPS_PROCUREMENT_PROVIDER", "fixture")
    monkeypatch.setenv(
        "VNEPS_PROCUREMENT_FIXTURE_PATH",
        "tests/fixtures/vneps_plan_history.json",
    )

    capabilities = with_server_capabilities({"valid": True})[
        "serverCapabilities"
    ]

    assert PROCUREMENT_IMPORT_V2 in capabilities


def test_procurement_import_capability_is_advertised_for_muasamcong(monkeypatch):
    monkeypatch.delenv("PROCUREMENT_IMPORT_ENABLED", raising=False)
    monkeypatch.delenv("PROCUREMENT_PROVIDER", raising=False)
    monkeypatch.setenv("VNEPS_PROCUREMENT_IMPORT_ENABLED", "true")
    monkeypatch.setenv("VNEPS_PROCUREMENT_PROVIDER", "muasamcong")

    capabilities = with_server_capabilities({"valid": True})[
        "serverCapabilities"
    ]

    assert PROCUREMENT_IMPORT_V2 in capabilities
