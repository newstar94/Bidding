import time
from types import SimpleNamespace

from backend.auth import auth_helper


def _session_user(*, revoked=False, active_role=None, active_role_organization_id=None):
    now = int(time.time())
    return {
        "id": "user-1",
        "vai_tro": "user",
        "session_id": "session-1",
        "last_seen_at": now,
        "idle_expires_at": now + 3_600,
        "absolute_expires_at": now + 7_200,
        "revoked_at": now if revoked else None,
        "active_role": active_role,
        "active_role_organization_id": active_role_organization_id,
    }


def _request(*, organization_id=None):
    return SimpleNamespace(
        cookies={"session_token": "token-1"},
        state=SimpleNamespace(),
        method="GET",
        headers={"X-Active-Org": organization_id} if organization_id else {},
    )


def test_verify_session_loads_persistent_session_once_per_request(monkeypatch):
    calls = []

    def load(_database, token):
        calls.append(token)
        return _session_user()

    monkeypatch.setattr(auth_helper, "load_session_user", load)
    request = _request()

    assert auth_helper.verify_session(request)[0] is True
    assert auth_helper.verify_session(request)[0] is True
    assert calls == ["token-1"]


def test_new_request_observes_session_revoked_by_another_worker(monkeypatch):
    persisted = {"revoked": False}
    calls = []

    def load(_database, token):
        calls.append(token)
        return _session_user(revoked=persisted["revoked"])

    monkeypatch.setattr(auth_helper, "load_session_user", load)

    assert auth_helper.verify_session(_request())[0] is True
    persisted["revoked"] = True
    valid, message = auth_helper.verify_session(_request())

    assert valid is False
    assert "hết hạn" in message
    assert calls == ["token-1", "token-1"]


def test_process_session_and_organization_caches_are_removed():
    assert not hasattr(auth_helper, "_session_cache")
    assert not hasattr(auth_helper, "_session_cache_cleanup")

    from backend.auth import session_utils

    assert not hasattr(session_utils, "_org_cache_cleanup")
    assert not hasattr(session_utils, "_org_cache_invalidate_by_user_id")


def test_verify_session_ignores_role_bound_to_another_workspace(monkeypatch):
    monkeypatch.setattr(
        auth_helper,
        "load_session_user",
        lambda *_args: _session_user(
            active_role="manager",
            active_role_organization_id="org-a",
        ),
    )

    valid, role = auth_helper.verify_session(_request(organization_id="org-b"))

    assert valid is True
    assert str(role) == "user"
    assert role.active_role is None
    assert role.active_role_organization_id == "org-a"


def test_verify_session_accepts_role_bound_to_requested_workspace(monkeypatch):
    monkeypatch.setattr(
        auth_helper,
        "load_session_user",
        lambda *_args: _session_user(
            active_role="manager",
            active_role_organization_id="org-a",
        ),
    )

    valid, role = auth_helper.verify_session(_request(organization_id="org-a"))

    assert valid is True
    assert str(role) == "manager"
    assert role.active_role == "manager"
    assert role.active_role_organization_id == "org-a"
