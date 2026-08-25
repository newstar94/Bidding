import asyncio
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace

from backend.auth import admin_user_routes, auth_helper, auth_routes
from backend.documents import package_document_routes
from backend.shared.access_policy import AccessDecision


class _Cursor:
    def __init__(self, row=None):
        self.row = row
        self.statements = []

    def execute(self, statement, parameters=()):
        self.statements.append((" ".join(str(statement).split()), parameters))
        return self

    def fetchone(self):
        return self.row


class _Connection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.events = []

    def execute(self, statement, parameters=()):
        self.events.append(("execute", statement, parameters))
        return self._cursor.execute(statement, parameters)

    def cursor(self):
        self.events.append(("cursor",))
        return self._cursor

    def rollback(self):
        self.events.append(("rollback",))

    def close(self):
        self.events.append(("close",))


def _request(*, method="PUT"):
    return SimpleNamespace(
        cookies={"session_token": "request-token"},
        headers={},
        method=method,
        client=SimpleNamespace(host="127.0.0.1"),
    )


def _session_row(**overrides):
    now = int(time.time())
    row = {
        "id": "actor-1",
        "vai_tro": "super_admin",
        "account_status": "active",
        "session_id": "session-1",
        "idle_expires_at": now + 600,
        "absolute_expires_at": now + 600,
        "revoked_at": None,
        "privileged_reauth_at": now,
        "active_role": None,
        "active_role_organization_id": None,
    }
    row.update(overrides)
    return row


def test_transactional_authority_rejects_a_session_revoked_after_initial_check():
    cursor = _Cursor(_session_row(revoked_at=int(time.time())))

    valid, message = auth_helper.verify_session_in_transaction(cursor, _request())

    assert valid is False
    assert "đăng nhập" in message.lower()
    assert "FOR UPDATE OF sessions, accounts" in cursor.statements[0][0]


def test_transactional_super_admin_authority_rechecks_step_up(monkeypatch):
    monkeypatch.setattr(auth_helper, "is_client_ip_allowed", lambda _ip: True)
    cursor = _Cursor(_session_row(privileged_reauth_at=1))

    valid, message = auth_helper.verify_session_in_transaction(
        cursor,
        _request(),
        required_role="super_admin",
    )

    assert valid is False
    assert message == auth_helper.PRIVILEGED_REAUTH_REQUIRED


def test_admin_access_mutation_stops_when_authority_is_revoked_in_write_lane(
    monkeypatch,
):
    cursor = _Cursor()
    connection = _Connection(cursor)
    monkeypatch.setattr(admin_user_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        admin_user_routes,
        "verify_session_in_transaction",
        lambda *_args, **_kwargs: (False, "revoked between checks"),
    )

    response = admin_user_routes._update_user_access_settings_sync(
        _request(),
        "actor-1",
        {"user_id": "target-1", "platform_role": "user"},
    )

    assert response.status_code == 403
    assert ("rollback",) in connection.events
    assert not any("UPDATE tai_khoan" in statement for statement, _ in cursor.statements)


def test_system_package_mutation_stops_when_step_up_is_revoked_in_write_lane(
    monkeypatch,
):
    cursor = _Cursor()
    connection = _Connection(cursor)
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        auth_routes,
        "verify_session_in_transaction",
        lambda *_args, **_kwargs: (False, "step-up expired"),
    )

    response = auth_routes._update_system_package_sync(
        _request(),
        "actor-1",
        "gold",
        "Gold",
        1,
        1,
        "",
        "active",
    )

    assert response.status_code == 403
    assert ("rollback",) in connection.events
    assert not any("UPDATE goi_dich_vu" in statement for statement, _ in cursor.statements)


def test_long_upload_rechecks_revocation_before_metadata_commit(monkeypatch, tmp_path):
    read_connection = _Connection(_Cursor())
    read_connection.__class__.__enter__ = lambda self: self
    read_connection.__class__.__exit__ = lambda self, *_args: self.close()
    write_connection = _Connection(_Cursor())
    connections = iter((read_connection, write_connection))
    session = SimpleNamespace(user_id="actor-1")
    request = _request()
    request.path_params = {"package_id": "package-1", "document_type": "HSMT"}
    request.query_params = {}

    async def request_form():
        return {"file": SimpleNamespace(filename="source.pdf")}

    request.form = request_form

    @asynccontextmanager
    async def fake_spooled_upload(*_args, **_kwargs):
        yield tmp_path / "source.pdf", 12, b"%PDF-1.7"

    async def fake_blocking_io(function, *_args, **_kwargs):
        if function is package_document_routes.persist_upload_path:
            return 12, "checksum"
        return None

    monkeypatch.setattr(
        package_document_routes.database,
        "get_connection",
        lambda: next(connections),
    )
    monkeypatch.setattr(
        package_document_routes, "verify_session", lambda _request: (True, session)
    )
    monkeypatch.setattr(
        package_document_routes, "get_active_org", lambda *_args: "org-1"
    )
    monkeypatch.setattr(
        package_document_routes, "load_package", lambda *_args: {"id": "package-1"}
    )
    monkeypatch.setattr(
        package_document_routes,
        "_package_write_decision",
        lambda *_args: AccessDecision(True, ""),
    )
    monkeypatch.setattr(
        package_document_routes, "allowed_upload_types", lambda _package: {"HSMT"}
    )
    monkeypatch.setattr(
        package_document_routes, "_validate_mutation_scope", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(package_document_routes, "spooled_upload", fake_spooled_upload)
    monkeypatch.setattr(package_document_routes, "run_blocking_io", fake_blocking_io)
    monkeypatch.setattr(
        package_document_routes,
        "verify_session_in_transaction",
        lambda *_args, **_kwargs: (False, "revoked during upload"),
    )
    metadata_write_called = []
    monkeypatch.setattr(
        package_document_routes,
        "load_package_for_document_mutation",
        lambda *_args: metadata_write_called.append(True),
    )

    response = asyncio.run(package_document_routes.upload_package_document_api(request))

    assert response.status_code == 401
    assert ("rollback",) in write_connection.events
    assert metadata_write_called == []
