from __future__ import annotations

from collections import deque
from hashlib import pbkdf2_hmac
from types import SimpleNamespace
import time

import pytest

from backend.auth import auth_helper, password_policy, profile_validation
from backend.auth import session_utils, username_validator


class _Cursor:
    def __init__(self, rows=()):
        self.rows = deque(rows)
        self.calls = []

    def execute(self, sql, parameters=()):
        self.calls.append((sql, parameters))
        return self

    def fetchone(self):
        return self.rows.popleft() if self.rows else None


class _Request:
    def __init__(self, *, method="GET", headers=None, cookies=None):
        self.method = method
        self.headers = headers or {}
        self.cookies = cookies or {}
        self.state = SimpleNamespace()


def test_argon_and_transitional_password_verification_edges(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(TypeError):
        auth_helper.hash_password(None)
    assert not auth_helper.verify_password("", "password")
    assert not auth_helper.verify_password("unknown-format", "password")
    assert not auth_helper.verify_password("$argon2id$broken", "password")

    salt = "stable-test-salt"
    password = "Transition password 2026!"
    digest = pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    encoded = f"pbkdf2_sha256$100000${salt}${digest}"
    assert auth_helper.verify_password(encoded, password)
    assert not auth_helper.verify_password(encoded, "wrong")
    assert not auth_helper.verify_password("pbkdf2_sha256$broken", password)
    assert not auth_helper.verify_password(
        f"pbkdf2_sha256$99999${salt}${digest}", password
    )

    assert auth_helper.password_needs_rehash("")
    assert auth_helper.password_needs_rehash(encoded)
    monkeypatch.setattr(
        auth_helper,
        "_PASSWORD_HASHER",
        SimpleNamespace(check_needs_rehash=lambda _value: False),
    )
    assert not auth_helper.password_needs_rehash(
        "$argon2id$valid-enough-for-mocked-check"
    )
    monkeypatch.setattr(
        auth_helper,
        "_PASSWORD_HASHER",
        SimpleNamespace(
            check_needs_rehash=lambda _value: (_ for _ in ()).throw(
                ValueError("bad")
            )
        ),
    )
    assert auth_helper.password_needs_rehash("$argon2id$bad")


def test_session_cache_expiry_user_invalidation_and_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth_helper._session_cache.clear()
    monkeypatch.setattr(auth_helper.time, "time", lambda: 100)
    auth_helper._session_cache_set("one", {"id": "user-1"})
    auth_helper._session_cache_set("two", {"id": "user-2"})
    assert auth_helper._session_cache_get("one") == {"id": "user-1"}
    auth_helper._session_cache_invalidate("two")
    assert auth_helper._session_cache_get("two") is None
    auth_helper._session_cache_set("two", {"id": "user-2"})
    auth_helper._session_cache_invalidate_by_user_id("user-1")
    assert auth_helper._session_cache_get("one") is None
    monkeypatch.setattr(auth_helper.time, "time", lambda: 1_000)
    assert auth_helper._session_cache_get("two") is None

    auth_helper._session_cache["expired"] = ({"id": "x"}, 10)
    auth_helper._session_cache["live"] = ({"id": "y"}, 2_000)
    auth_helper._session_cache_cleanup()
    assert "expired" not in auth_helper._session_cache
    assert "live" in auth_helper._session_cache
    auth_helper._session_cache.clear()


def test_super_admin_controls_network_and_reauthentication(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = _Request(method="POST")
    user = {
        "privileged_reauth_at": int(time.time()),
    }
    monkeypatch.setattr(auth_helper, "get_client_ip", lambda _request: "127.0.0.1")
    monkeypatch.setattr(auth_helper, "is_client_ip_allowed", lambda _ip: False)
    assert auth_helper.verify_super_admin_controls(request, user)[0] is False

    monkeypatch.setattr(auth_helper, "is_client_ip_allowed", lambda _ip: True)
    assert auth_helper.verify_super_admin_controls(request, user) == (True, None)
    assert auth_helper.verify_super_admin_controls(
        request, {**user, "privileged_reauth_at": "invalid"}
    )[0] is False
    assert auth_helper.verify_super_admin_controls(
        request, {**user, "privileged_reauth_at": 1}
    )[0] is False
    assert auth_helper.verify_super_admin_controls(request, user) == (True, None)
    assert auth_helper.verify_super_admin_controls(
        _Request(method="GET"), {**user, "privileged_reauth_at": 0}
    ) == (True, None)
    assert auth_helper.verify_super_admin_controls(
        request, {**user, "privileged_reauth_at": 0}, require_reauth=False
    ) == (True, None)


@pytest.mark.parametrize(
    ("user", "expected"),
    [
        (None, False),
        ({}, False),
        ({"privileged_reauth_at": "invalid"}, False),
        ({"privileged_reauth_at": 1}, False),
        ({"privileged_reauth_at": int(time.time())}, True),
    ],
)
def test_recent_reauthentication(user, expected: bool) -> None:
    assert auth_helper.verify_recent_reauthentication(user)[0] is expected


def test_verify_session_rejects_missing_invalid_revoked_and_wrong_role(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert auth_helper.verify_session(_Request())[0] is False
    request = _Request(cookies={"session_token": " token "})
    monkeypatch.setattr(auth_helper, "load_session_user", lambda *_args: None)
    assert auth_helper.verify_session(request)[0] is False

    expired = {"id": "user", "vai_tro": "user", "last_seen_at": 1}
    monkeypatch.setattr(auth_helper, "load_session_user", lambda *_args: expired)
    monkeypatch.setattr(
        auth_helper,
        "session_invalid_reason",
        lambda *_args: "expired",
    )
    assert auth_helper.verify_session(request)[0] is False

    user = {
        "id": "user",
        "vai_tro": "user",
        "last_seen_at": int(time.time()),
        "session_id": "session",
    }
    monkeypatch.setattr(auth_helper, "load_session_user", lambda *_args: user)
    monkeypatch.setattr(auth_helper, "session_invalid_reason", lambda *_args: None)
    assert auth_helper.verify_session(request, "super_admin")[0] is False


def test_verify_session_touches_activity_sets_state_and_admin_controls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = int(time.time())
    user = {
        "id": "admin",
        "vai_tro": "super_admin",
        "last_seen_at": now - auth_helper.SESSION_ACTIVITY_TOUCH_SECONDS,
        "session_id": "session",
        "privileged_reauth_at": now,
    }
    touched = []
    monkeypatch.setattr(auth_helper.time, "time", lambda: now)
    monkeypatch.setattr(auth_helper, "load_session_user", lambda *_args: user)
    monkeypatch.setattr(auth_helper, "session_invalid_reason", lambda *_args: None)
    monkeypatch.setattr(
        auth_helper, "touch_session", lambda *_args, **kwargs: touched.append(kwargs)
    )
    monkeypatch.setattr(
        auth_helper, "verify_super_admin_controls", lambda *_args: (True, None)
    )
    request = _Request(cookies={"session_token": "token"})
    valid, role = auth_helper.verify_session(request, "super_admin")
    assert valid
    assert str(role) == "super_admin"
    assert role.user_id == "admin"
    assert role.session_id == "session"
    assert request.state.auth_user_id == "admin"
    assert touched[0]["now"] == now

    monkeypatch.setattr(
        auth_helper, "verify_super_admin_controls", lambda *_args: (False, "denied")
    )
    assert auth_helper.verify_session(request, "super_admin") == (False, "denied")


@pytest.mark.parametrize(
    ("username", "valid"),
    [
        ("good_user", True),
        ("ab", False),
        ("UPPER", False),
        ("_leading", False),
        ("trailing_", False),
        ("two__underscores", False),
        ("admin", False),
        ("prefix_admin", False),
        ("dang_nhap", False),
    ],
)
def test_username_validation_contract(username: str, valid: bool) -> None:
    assert username_validator.validate_username(username)[0] is valid


def test_username_suggestion_is_valid_and_collision_resistant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cursor = _Cursor(rows=[None])
    assert (
        username_validator.generate_suggested_username(
            "Ignored", "normal.user@example.com", cursor
        )
        == "normal_user"
    )
    cursor = _Cursor(rows=[(1,), None])
    monkeypatch.setattr(username_validator.secrets, "choice", lambda _alphabet: "x")
    suggestion = username_validator.generate_suggested_username(
        "Ignored", "admin@example.com", cursor
    )
    assert suggestion == "member_xxxx"
    assert username_validator.validate_username(suggestion)[0]


@pytest.mark.parametrize(
    ("password", "valid_input"),
    [
        (None, False),
        ("", False),
        ("short", True),
        ("passwordpassword", True),
        ("x" * 257, False),
    ],
)
def test_new_password_policy_rejects_invalid_or_leaked_values(
    password, valid_input: bool
) -> None:
    assert password_policy.validate_new_password(password)[0] is False
    assert password_policy.validate_password_input(password) is valid_input


def test_password_input_accepts_bounded_nonempty_string() -> None:
    assert password_policy.validate_new_password("Strong passphrase 2026!")[0]
    assert password_policy.validate_password_input("x")
    assert password_policy.validate_password_input("x" * 256)


@pytest.mark.parametrize(
    "name",
    ["", "x" * 101, "bad<name", "bad\x00name"],
)
def test_profile_name_rejects_empty_oversized_and_markup(name: str) -> None:
    with pytest.raises(profile_validation.ProfileValidationError) as error:
        profile_validation._validate_name(name)
    assert error.value.code == "INVALID_PROFILE_NAME"


@pytest.mark.parametrize(
    "email",
    ["", "invalid", "a@localhost", f"{'x' * 250}@example.com"],
)
def test_profile_email_rejects_invalid_addresses(email: str) -> None:
    with pytest.raises(profile_validation.ProfileValidationError) as error:
        profile_validation.validate_profile_email(email)
    assert error.value.code == "INVALID_PROFILE_EMAIL"
    assert profile_validation.validate_profile_email(" User@Example.com ") == (
        "user@example.com"
    )


def test_profile_avatar_allowlist_and_validation_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert profile_validation._validate_avatar("") == ""
    url = "https://lh3.googleusercontent.com/avatar"
    assert profile_validation._validate_avatar(url) == url
    with pytest.raises(profile_validation.ProfileValidationError):
        profile_validation._validate_avatar(
            f"https://lh3.googleusercontent.com/{'x' * 2_100}"
        )
    with pytest.raises(profile_validation.ProfileValidationError):
        profile_validation._validate_avatar(
            "https://user@lh3.googleusercontent.com/avatar"
        )

    monkeypatch.setattr(
        profile_validation,
        "reencode_base64_image",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            ValueError("Dung lượng quá lớn")
        ),
    )
    with pytest.raises(profile_validation.ProfileValidationError) as error:
        profile_validation._validate_avatar("data:image/png;base64,bad")
    assert error.value.code in {"PROFILE_AVATAR_TOO_LARGE", "INVALID_PROFILE_AVATAR"}


def test_personal_and_organization_context_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    metrics = []
    monkeypatch.setattr(
        session_utils,
        "record_database_phase",
        lambda *args, **kwargs: metrics.append((args, kwargs)),
    )
    request = _Request(headers={"X-Active-Org": "personal%3Auser-1"})
    assert (
        session_utils.get_active_org(
            request, "user-1", cursor=_Cursor(rows=[("user",)])
        )
        == "personal:user-1"
    )
    assert request.state.organization_context.scope_type == "personal"

    request = _Request()
    assert (
        session_utils.get_active_org(
            request, "user-1", cursor=_Cursor(rows=[("user",), None])
        )
        == "personal:user-1"
    )

    organization = {
        "id": "org-1",
        "trang_thai": "active",
        "vai_tro_trong_to_chuc": "employee",
    }
    request = _Request(headers={"X-Active-Org": "org-1"})
    assert (
        session_utils.get_active_org(
            request, "user-1", cursor=_Cursor(rows=[("user",), organization])
        )
        == "org-1"
    )
    assert request.state.organization_context.membership_role == "employee"
    assert metrics[-1][1]["outcome"] == "ok"


def test_organization_context_rejects_idor_suspended_invalid_role_and_admin_personal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    outcomes = []
    monkeypatch.setattr(
        session_utils,
        "record_database_phase",
        lambda *_args, **kwargs: outcomes.append(kwargs["outcome"]),
    )
    with pytest.raises(session_utils.OrgPermissionError):
        session_utils.get_active_org(
            _Request(headers={"X-Active-Org": "org-other"}),
            "user-1",
            cursor=_Cursor(rows=[("user",), None]),
        )
    with pytest.raises(session_utils.OrgPermissionError):
        session_utils.get_active_org(
            _Request(headers={"X-Active-Org": "personal:admin"}),
            "admin",
            cursor=_Cursor(rows=[("super_admin",)]),
        )
    with pytest.raises(session_utils.OrgPermissionError):
        session_utils.get_active_org(
            _Request(headers={"X-Active-Org": "org-1"}),
            "user-1",
            cursor=_Cursor(
                rows=[
                    ("user",),
                    {
                        "id": "org-1",
                        "trang_thai": "suspended",
                        "vai_tro_trong_to_chuc": "employee",
                    },
                ]
            ),
        )
    with pytest.raises(session_utils.OrgPermissionError):
        session_utils.get_active_org(
            _Request(headers={"X-Active-Org": "org-1"}),
            "user-1",
            cursor=_Cursor(
                rows=[
                    ("user",),
                    {
                        "id": "org-1",
                        "trang_thai": "active",
                        "vai_tro_trong_to_chuc": "owner",
                    },
                ]
            ),
        )
    assert outcomes == ["error", "error", "error", "error"]


def test_session_context_uses_and_closes_database_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cursor = _Cursor(rows=[("user",), None])

    class _Connection:
        closed = False

        def cursor(self):
            return cursor

        def close(self):
            self.closed = True

    connection = _Connection()
    monkeypatch.setattr(
        session_utils.database, "get_connection", lambda: connection
    )
    monkeypatch.setattr(
        session_utils, "record_database_phase", lambda *_args, **_kwargs: None
    )
    assert (
        session_utils.get_active_org(_Request(), "user-1")
        == "personal:user-1"
    )
    assert connection.closed
    assert session_utils._org_cache_cleanup() is None
    assert session_utils._org_cache_invalidate_by_user_id("user-1") is None
