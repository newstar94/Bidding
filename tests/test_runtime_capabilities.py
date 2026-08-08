from backend.auth.auth_routes import build_session_bootstrap
from backend.runtime_capabilities import (
    AGGREGATE_VERSION_V1,
    SERVER_CAPABILITIES,
    with_server_capabilities,
)


class _AnonymousRequest:
    cookies = {}


def test_session_bootstrap_advertises_bounded_server_capabilities():
    payload = build_session_bootstrap(_AnonymousRequest())

    assert payload == {
        "valid": False,
        "reason": "missing_auth",
        "serverCapabilities": [AGGREGATE_VERSION_V1],
    }
    assert SERVER_CAPABILITIES == (AGGREGATE_VERSION_V1,)


def test_capability_projection_does_not_mutate_source_payload():
    source = {"valid": True}

    projected = with_server_capabilities(source)

    assert source == {"valid": True}
    assert projected["serverCapabilities"] == ["aggregate-version-v1"]
