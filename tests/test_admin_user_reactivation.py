import json
from pathlib import Path
from types import SimpleNamespace

from backend.auth import admin_user_routes


class _Cursor:
    def __init__(self, target_row):
        self.target_row = target_row
        self.statements = []
        self._last = None

    def execute(self, statement, parameters=()):
        normalized = " ".join(str(statement).split())
        self.statements.append((normalized, parameters))
        self._last = normalized
        return self

    def fetchone(self):
        if self._last and self._last.startswith("SELECT trang_thai FROM tai_khoan"):
            return self.target_row
        return None


class _Connection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.events = []

    def cursor(self):
        return self._cursor

    def commit(self):
        self.events.append("commit")

    def rollback(self):
        self.events.append("rollback")

    def close(self):
        self.events.append("close")


def _request(user_id="target-1"):
    return SimpleNamespace(
        cookies={"session_token": "request-token"},
        headers={},
        method="POST",
        path_params={"user_id": user_id},
        client=SimpleNamespace(host="127.0.0.1"),
    )


def _install(monkeypatch, target_row, *, authority=(True, None)):
    cursor = _Cursor(target_row)
    connection = _Connection(cursor)
    audits = []
    actor = SimpleNamespace(user_id="admin-1")
    monkeypatch.setattr(admin_user_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(admin_user_routes, "verify_session", lambda *_args, **_kwargs: (True, actor))
    valid, message = authority
    monkeypatch.setattr(
        admin_user_routes,
        "verify_session_in_transaction",
        lambda *_args, **_kwargs: (valid, actor if valid else message),
    )
    monkeypatch.setattr(
        admin_user_routes,
        "log_audit",
        lambda action, **kwargs: audits.append((action, kwargs)),
    )
    return cursor, connection, audits


def _body(response):
    return json.loads(response.body)


def test_reactivation_restores_an_inactive_account_and_records_required_audit(monkeypatch):
    cursor, connection, audits = _install(monkeypatch, ("inactive",))

    response = admin_user_routes._reactivate_user_sync(_request())

    assert response.status_code == 200
    assert _body(response)["changed"] is True
    assert _body(response)["code"] == "ACCOUNT_REACTIVATED"
    updates = [statement for statement, _ in cursor.statements if statement.startswith("UPDATE tai_khoan")]
    assert updates == [
        "UPDATE tai_khoan SET trang_thai = 'active', updated_at = CURRENT_TIMESTAMP "
        "WHERE id = ? AND trang_thai = 'inactive'"
    ]
    assert any(statement.endswith("FOR UPDATE") for statement, _ in cursor.statements)
    assert audits and audits[0][0] == "admin.user_reactivated"
    assert audits[0][1]["required"] is True
    assert audits[0][1]["actor_user_id"] == "admin-1"
    assert connection.events[-2:] == ["commit", "close"]


def test_reactivation_is_idempotent_for_an_active_account(monkeypatch):
    cursor, connection, audits = _install(monkeypatch, ("active",))

    response = admin_user_routes._reactivate_user_sync(_request())

    assert response.status_code == 200
    assert _body(response)["changed"] is False
    assert not any(statement.startswith("UPDATE") for statement, _ in cursor.statements)
    assert audits == []
    assert "commit" in connection.events


def test_reactivation_rejects_unknown_accounts_and_revoked_authority(monkeypatch):
    _cursor, connection, _audits = _install(monkeypatch, None)
    missing = admin_user_routes._reactivate_user_sync(_request("missing"))
    assert missing.status_code == 404
    assert "rollback" in connection.events

    cursor, connection, audits = _install(
        monkeypatch, ("inactive",), authority=(False, "step-up expired"),
    )
    denied = admin_user_routes._reactivate_user_sync(_request())
    assert denied.status_code == 403
    assert "rollback" in connection.events
    assert not any(statement.startswith("UPDATE") for statement, _ in cursor.statements)
    assert audits == []


def test_reactivation_route_is_a_super_admin_post_next_to_deactivation():
    source = (Path(__file__).resolve().parents[1] / "backend" / "app.py").read_text(encoding="utf-8")
    assert 'Route("/api/auth/users/{user_id}/reactivate", reactivate_user_api, methods=["POST"])' in source
    routes = (
        Path(__file__).resolve().parents[1] / "backend" / "auth" / "admin_user_routes.py"
    ).read_text(encoding="utf-8")
    reactivation = routes[routes.index("def _reactivate_user_sync"):routes.index("async def reactivate_user_api")]
    assert "required_role='super_admin'" in reactivation
    assert 'required_role="super_admin"' in reactivation
    assert "DELETE FROM" not in reactivation
