import sqlite3
import uuid

from starlette.testclient import TestClient

from backend.app import app
from backend.auth import google_auth_routes
from backend.auth.username_validator import generate_suggested_username, validate_username
from backend.shared import helpers


def test_google_username_suggestion_uses_shared_validator_for_sensitive_email():
    connection = sqlite3.connect(":memory:")
    cursor = connection.cursor()
    cursor.execute("CREATE TABLE tai_khoan (username_norm TEXT)")

    suggestion = generate_suggested_username("Google User", "google@example.com", cursor)

    assert suggestion == "member"
    assert validate_username(suggestion)[0] is True
    connection.close()


def test_google_first_login_set_username_and_session_ready_with_csrf(monkeypatch):
    unique = uuid.uuid4().hex[:8]
    email = f"codex.user.{unique}@example.com"
    username = f"codex_user_{unique}"

    monkeypatch.setattr(google_auth_routes, "GOOGLE_CLIENT_ID", "test-google-client")
    monkeypatch.setattr(
        google_auth_routes,
        "_verify_google_token",
        lambda _token: {
            "aud": "test-google-client",
            "sub": f"google-{unique}",
            "email": email,
            "name": "Google Test User",
            "picture": "",
            "email_verified": "true",
            "exp": "4102444800",
        },
    )
    monkeypatch.setattr(helpers, "gui_email", lambda *_args, **_kwargs: None)

    with TestClient(app, base_url="https://testserver") as client:
        login_response = client.post(
            "/api/auth/google-login",
            json={"credential": "valid-test-token"},
        )

        assert login_response.status_code == 200
        assert login_response.json()["needs_username"] is True
        csrf_token = client.cookies.get("csrf_token")
        assert csrf_token

        missing_csrf_response = client.post(
            "/api/auth/set-username",
            json={"username": username},
        )
        assert missing_csrf_response.status_code == 403
        assert missing_csrf_response.json()["code"] == "CSRF_TOKEN_INVALID"

        set_username_response = client.post(
            "/api/auth/set-username",
            json={"username": username},
            headers={"X-CSRF-Token": csrf_token},
        )
        assert set_username_response.status_code == 200
        assert set_username_response.json()["username"] == username

        session_response = client.post(
            "/api/auth/check-session",
            json={"remember": False},
        )
        assert session_response.status_code == 200
        session_payload = session_response.json()
        assert session_payload["valid"] is True
        assert session_payload["user"]["needs_username"] is False
        assert session_payload["user"]["username"] == username
        assert session_payload["user"]["membership_role"] == "employee"
        assert session_payload["user"]["effective_roles"] == ["employee"]
        organizations = session_payload["user"]["organizations"]
        assert len(organizations) == 1
        assert organizations[0]["scope_type"] == "personal"
        assert organizations[0]["status"] == "active"
        assert organizations[0]["subscription"] is None
        assert session_payload["user"]["active_org_id"] == organizations[0]["id"]
        assert session_payload["user"]["package_id"] is None
        assert session_payload["user"]["subscription"] is None

        async def password_hash_must_not_run(*_args, **_kwargs):
            raise AssertionError("Existing Google identity must not repeat password hashing")

        monkeypatch.setattr(google_auth_routes, "run_cpu_bound", password_hash_must_not_run)
        repeated_login = client.post(
            "/api/auth/google-login",
            json={"credential": "valid-test-token"},
        )
        assert repeated_login.status_code == 200
        assert repeated_login.json()["id"] == login_response.json()["id"]
        assert repeated_login.json()["account_linked"] is False
