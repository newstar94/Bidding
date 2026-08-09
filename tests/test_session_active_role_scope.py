from backend.auth.session_store import load_session_user, set_session_active_role
from backend.auth import auth_routes
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    UPGRADES,
    _upgrade_to_v43_bind_session_active_role_to_workspace,
)


class RecordingCursor:
    def __init__(self):
        self.calls = []
        self.rowcount = 1

    def execute(self, statement, parameters=()):
        self.calls.append((" ".join(str(statement).split()), tuple(parameters)))
        return self


def test_v43_binds_selected_session_role_to_one_workspace():
    assert DB_SCHEMA_VERSION >= 43
    upgrade = next(item for item in UPGRADES if item.version == 43)
    assert upgrade.name == "bind_session_active_role_to_workspace"
    assert upgrade.apply is _upgrade_to_v43_bind_session_active_role_to_workspace

    cursor = RecordingCursor()
    _upgrade_to_v43_bind_session_active_role_to_workspace(cursor, None)
    statements = "\n".join(statement for statement, _ in cursor.calls)

    assert "ADD COLUMN IF NOT EXISTS active_role_organization_id TEXT" in statements
    assert "SET active_role = NULL" in statements
    assert "active_role_organization_id IS NULL" in statements
    assert "auth_sessions_active_role_workspace_check" in statements


def test_fresh_session_schema_rejects_binding_without_role_but_allows_legacy_writer():
    columns = SCHEMA_DINH_NGHIA["auth_sessions"]["columns"]

    assert "active_role_organization_id" in columns
    assert "active_role_organization_id IS NULL OR (active_role IS NOT NULL" in columns[
        "active_role_organization_id"
    ]


def test_selected_role_and_workspace_are_persisted_atomically():
    cursor = RecordingCursor()

    updated = set_session_active_role(
        cursor,
        "session-1",
        "user-1",
        "manager",
        "org-a",
    )

    assert updated is True
    statement, parameters = cursor.calls[-1]
    assert "active_role = ?" in statement
    assert "active_role_organization_id = ?" in statement
    assert parameters == ("manager", "org-a", "session-1", "user-1")


def test_session_snapshot_loads_the_selected_role_workspace_binding():
    statements = []
    row = {
        "id": "user-1",
        "active_role": "manager",
        "active_role_organization_id": "org-a",
    }

    class Connection:
        def execute(self, statement, _parameters=()):
            statements.append(" ".join(str(statement).split()))
            return self

        def fetchone(self):
            return row

        def close(self):
            return None

    class Database:
        def get_connection(self):
            return Connection()

    loaded = load_session_user(Database(), "session-token")

    assert loaded["active_role_organization_id"] == "org-a"
    assert "sessions.active_role_organization_id" in statements[0]


def test_active_role_route_binds_selection_to_resolved_workspace(monkeypatch):
    persisted = []

    class Connection:
        def cursor(self):
            return RecordingCursor()

        def commit(self):
            return None

        def rollback(self):
            return None

        def close(self):
            return None

    session = type(
        "Session",
        (),
        {
            "user_id": "user-1",
            "session_id": "session-1",
            "platform_role": "user",
        },
    )()
    request = type("Request", (), {})()

    monkeypatch.setattr(
        auth_routes,
        "verify_session",
        lambda _request: (True, session),
    )
    monkeypatch.setattr(
        auth_routes.database,
        "get_connection",
        lambda: Connection(),
    )
    monkeypatch.setattr(
        auth_routes,
        "get_active_org",
        lambda *_args, **_kwargs: "org-a",
    )
    monkeypatch.setattr(
        auth_routes,
        "organization_membership_role",
        lambda *_args: "manager",
    )
    monkeypatch.setattr(
        auth_routes,
        "set_session_active_role",
        lambda *args: persisted.append(args[1:]) or True,
    )
    monkeypatch.setattr(auth_routes, "log_audit", lambda *_args, **_kwargs: None)

    response = auth_routes._set_active_role_sync(request, "manager")

    assert response.status_code == 200
    assert persisted == [("session-1", "user-1", "manager", "org-a")]


def test_session_bootstrap_rederives_role_for_selected_workspace():
    user = {
        "vai_tro": "user",
        "active_role": "manager",
        "active_role_organization_id": "org-a",
    }
    access = {
        "active_org_id": "org-b",
        "membership_role": "employee",
        "organizations": [
            {
                "id": "org-b",
                "role": "employee",
                "scope_type": "organization",
            }
        ],
    }

    payload = auth_routes._attach_effective_session_role(user, access)

    assert payload["active_role"] == "employee"
