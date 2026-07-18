from types import SimpleNamespace

from starlette.testclient import TestClient

from backend.app import app
from backend.observability import client_errors


def _valid_payload():
    return {
        "kind": "error",
        "releaseId": "release-test-123",
        "errorName": "TypeError",
        "source": "/dist/assets/app-safe123.js",
        "line": 12,
        "column": 7,
    }


def test_client_error_payload_rejects_raw_message_and_identity_data():
    payload = {
        **_valid_payload(),
        "message": "person@example.com CCCD 012345678901",
    }

    normalized, errors = client_errors.normalize_client_error_payload(payload)

    assert normalized is None
    assert any(error["field"] == "message" and error["code"] == "UNKNOWN_FIELD" for error in errors)


def test_client_error_limiter_is_bounded_and_windowed():
    limiter = client_errors._ClientErrorRateLimiter(limit=2, window_seconds=10, max_keys=16)

    assert limiter.allow("user-1", now=1)
    assert limiter.allow("user-1", now=2)
    assert not limiter.allow("user-1", now=3)
    assert limiter.allow("user-1", now=12)
    for index in range(30):
        assert limiter.allow(f"user-{index + 2}", now=20)
    assert len(limiter._entries) == 16


def test_authenticated_client_error_is_logged_with_allowlisted_fields(monkeypatch):
    captured = []
    monkeypatch.setattr(
        client_errors,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="opaque-user-1")),
    )
    monkeypatch.setattr(
        client_errors,
        "log_structured_event",
        lambda event, **kwargs: captured.append((event, kwargs)),
    )

    with TestClient(app) as client:
        bootstrap = client.post("/api/auth/check-session", json={"remember": False})
        csrf_token = client.cookies.get("csrf_token")
        assert bootstrap.status_code == 200
        response = client.post(
            "/api/client-errors",
            json=_valid_payload(),
            headers={"X-CSRF-Token": csrf_token},
        )

    assert response.status_code == 202
    assert response.json() == {"accepted": True}
    assert captured[0][0] == "client.error"
    assert captured[0][1]["actor_user_id"] == "opaque-user-1"
    assert captured[0][1]["fields"] == _valid_payload()
