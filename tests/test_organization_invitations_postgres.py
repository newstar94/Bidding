"""Consent-based organization invitations (ADR 0093) against real PostgreSQL SQL."""

import asyncio
import json
import os
import time
from types import SimpleNamespace

import pytest

from backend.api import org_invitations, org_routes
from backend.db.db_helper import PostgresDatabase
from backend.db.postgres_schema import build_create_table_sql
from backend.db.schema import SCHEMA_DINH_NGHIA


TABLES = (
    "rate_limit_buckets",
    "sync_metadata",
    "ma_tran_phan_quyen",
    "organization_invitations",
)


@pytest.fixture
def invitation_db(monkeypatch):
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL required for TEMP-table PostgreSQL tests")
    database = PostgresDatabase(url)
    connection = database.get_connection()
    view = SimpleNamespace(
        execute=connection.execute, cursor=connection.cursor,
        commit=connection.commit, rollback=connection.rollback, close=lambda: None,
    )
    proxy = SimpleNamespace(get_connection=lambda: view)
    try:
        for ddl in (
            "CREATE TEMP TABLE to_chuc (id TEXT PRIMARY KEY, ten_to_chuc TEXT, trang_thai TEXT DEFAULT 'active')",
            """CREATE TEMP TABLE tai_khoan (id TEXT PRIMARY KEY, email_norm TEXT, ho_ten TEXT,
                ten_dang_nhap TEXT, vai_tro TEXT DEFAULT 'user', trang_thai TEXT DEFAULT 'active',
                da_xac_minh INTEGER DEFAULT 1)""",
            """CREATE TEMP TABLE thanh_vien_to_chuc (user_id TEXT, organization_id TEXT,
                vai_tro_trong_to_chuc TEXT DEFAULT 'employee', ten_nhan_su TEXT, so_dien_thoai TEXT,
                trang_thai_thanh_vien TEXT DEFAULT 'active', left_at TEXT, left_by TEXT,
                updated_at TEXT, PRIMARY KEY (user_id, organization_id))""",
        ):
            connection.execute(ddl)
        for table in TABLES:
            ddl = build_create_table_sql(table, SCHEMA_DINH_NGHIA[table]).replace("CREATE TABLE ", "CREATE TEMP TABLE ", 1)
            connection.execute(ddl)
        connection.execute(
            "CREATE UNIQUE INDEX ON organization_invitations (organization_id, email_norm) WHERE status = 'pending'"
        )
        connection.execute("INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('org-a', 'Ban QLDA A')")
        for user, email, role in (
            ("manager", "manager@example.test", "manager"),
            ("invitee", "invitee@example.test", None),
            ("stranger", "stranger@example.test", None),
        ):
            connection.execute(
                "INSERT INTO tai_khoan (id, email_norm, ho_ten) VALUES (?, ?, ?)",
                (user, email, f"Họ tên thật {user}"),
            )
            if role:
                connection.execute(
                    "INSERT INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su) VALUES (?, 'org-a', ?, 'Trưởng phòng')",
                    (user, role),
                )
        events = []
        monkeypatch.setattr(org_invitations, "database", proxy)
        monkeypatch.setattr(org_invitations, "get_active_org", lambda *_a, **_k: "org-a")
        monkeypatch.setattr(
            org_invitations, "is_organization_manager",
            lambda _c, role, *_a: role.user_id == "manager",
        )
        monkeypatch.setattr(org_invitations, "is_business_organization", lambda *_a: True)
        monkeypatch.setattr(
            org_invitations, "verify_session_in_transaction",
            lambda _cursor, request: (True, SimpleNamespace(user_id=request.user_id)),
        )
        monkeypatch.setattr(
            org_invitations, "log_audit",
            lambda action, **_kwargs: events.append(action),
        )
        monkeypatch.setattr(org_invitations, "lock_organization_membership_invariants", lambda *_a: True)
        monkeypatch.setattr(org_routes, "log_audit", lambda action, **_kwargs: events.append(action))
        monkeypatch.setattr(org_routes, "queue_membership_notification", lambda *_a, **_k: None)
        monkeypatch.setattr(org_routes, "enqueue_websocket_event", lambda *_a, **_k: None)
        monkeypatch.setenv("TRIAL_FULL_ACCESS_ENABLED", "true")
        monkeypatch.delenv("EMAIL_OUTBOX_ENCRYPTION_KEY", raising=False)
        yield SimpleNamespace(connection=connection, events=events)
    finally:
        connection.rollback()
        connection.close()
        database.close()


def _request(user_id):
    return SimpleNamespace(user_id=user_id, headers={}, state=SimpleNamespace(), path_params={})


def _body(response):
    return json.loads(response.body)


def test_invitation_response_never_reveals_whether_an_account_exists(invitation_db):
    role = SimpleNamespace(user_id="manager")
    known, _ = org_invitations._create_invitation_sync(
        _request("manager"), role,
        {"email": "Invitee@Example.test", "employee_name": "Chị Lan", "phone": "0900"},
    )
    unknown, _ = org_invitations._create_invitation_sync(
        _request("manager"), role,
        {"email": "nobody@example.test", "employee_name": "Anh Minh"},
    )
    assert known.status_code == unknown.status_code == 200
    assert _body(known)["message"] == _body(unknown)["message"]
    assert "Họ tên thật" not in known.body.decode("utf-8")
    listing = _body(org_invitations._list_organization_invitations_sync(_request("manager"), role))
    assert {item["email"] for item in listing["invitations"]} == {"invitee@example.test", "nobody@example.test"}
    assert all("Họ tên thật" not in json.dumps(item, ensure_ascii=False) for item in listing["invitations"])


def test_only_the_invited_email_owner_can_accept_and_gets_default_permissions(invitation_db):
    role = SimpleNamespace(user_id="manager")
    response, _ = org_invitations._create_invitation_sync(
        _request("manager"), role, {"email": "invitee@example.test", "employee_name": "Chị Lan"},
    )
    invitation_id = _body(response)["invitationId"]

    stranger = org_invitations._respond_invitation_sync(
        _request("stranger"), SimpleNamespace(user_id="stranger"), invitation_id, True,
    )
    assert stranger.status_code == 404

    mine = _body(org_invitations._my_invitations_sync(_request("invitee"), SimpleNamespace(user_id="invitee")))
    assert [item["organizationName"] for item in mine["invitations"]] == ["Ban QLDA A"]

    accepted = org_invitations._respond_invitation_sync(
        _request("invitee"), SimpleNamespace(user_id="invitee"), invitation_id, True,
    )
    assert accepted.status_code == 200
    cursor = invitation_db.connection
    member = cursor.execute(
        "SELECT ten_nhan_su, vai_tro_trong_to_chuc FROM thanh_vien_to_chuc WHERE user_id = 'invitee'"
    ).fetchone()
    assert tuple(member) == ("Chị Lan", "employee")
    permission = cursor.execute(
        "SELECT kehoach, goithau, hopdong, chudautu, nhathau, chuyengia, thongtinmothau FROM ma_tran_phan_quyen WHERE emp_id = 'invitee'"
    ).fetchone()
    assert tuple(permission) == ("view", "view", "view", "view", "view", "view", "")
    assert "organization.invitation_accepted" in invitation_db.events
    again = org_invitations._respond_invitation_sync(
        _request("invitee"), SimpleNamespace(user_id="invitee"), invitation_id, True,
    )
    assert again.status_code == 404


def test_invitation_ends_when_inviter_is_no_longer_manager(invitation_db):
    role = SimpleNamespace(user_id="manager")
    response, _ = org_invitations._create_invitation_sync(
        _request("manager"), role, {"email": "invitee@example.test", "employee_name": "Chị Lan"},
    )
    invitation_id = _body(response)["invitationId"]
    invitation_db.connection.execute(
        "UPDATE thanh_vien_to_chuc SET vai_tro_trong_to_chuc = 'employee' WHERE user_id = 'manager'"
    )
    result = org_invitations._respond_invitation_sync(
        _request("invitee"), SimpleNamespace(user_id="invitee"), invitation_id, True,
    )
    assert result.status_code == 404
    assert invitation_db.connection.execute(
        "SELECT count(*) FROM thanh_vien_to_chuc WHERE user_id = 'invitee'"
    ).fetchone()[0] == 0
    assert "organization.invitation_revoked" in invitation_db.events


def test_expired_invitation_is_listed_as_expired_and_renewed_on_reinvite(invitation_db):
    role = SimpleNamespace(user_id="manager")
    response, _ = org_invitations._create_invitation_sync(
        _request("manager"), role, {"email": "invitee@example.test", "employee_name": "Chị Lan"},
    )
    invitation_id = _body(response)["invitationId"]
    invitation_db.connection.execute(
        "UPDATE organization_invitations SET created_at = ?, expires_at = ? WHERE id = ?",
        (int(time.time()) - 20, int(time.time()) - 10, invitation_id),
    )
    # Another invitation from the same organization must not relabel it.
    org_invitations._create_invitation_sync(
        _request("manager"), role, {"email": "other@example.test", "employee_name": "Anh Minh"},
    )
    listing = _body(org_invitations._list_organization_invitations_sync(_request("manager"), role))
    statuses = {item["email"]: item["status"] for item in listing["invitations"]}
    assert statuses["invitee@example.test"] == "expired"

    renewed, _ = org_invitations._create_invitation_sync(
        _request("manager"), role, {"email": "invitee@example.test", "employee_name": "Chị Lan"},
    )
    assert _body(renewed)["invitationId"] == invitation_id
    listing = _body(org_invitations._list_organization_invitations_sync(_request("manager"), role))
    statuses = {item["email"]: item["status"] for item in listing["invitations"]}
    assert statuses["invitee@example.test"] == "pending"


def test_expired_and_declined_invitations_cannot_be_accepted(invitation_db):
    role = SimpleNamespace(user_id="manager")
    response, _ = org_invitations._create_invitation_sync(
        _request("manager"), role, {"email": "invitee@example.test", "employee_name": "Chị Lan"},
    )
    invitation_id = _body(response)["invitationId"]
    declined = org_invitations._respond_invitation_sync(
        _request("invitee"), SimpleNamespace(user_id="invitee"), invitation_id, False,
    )
    assert declined.status_code == 200
    assert org_invitations._respond_invitation_sync(
        _request("invitee"), SimpleNamespace(user_id="invitee"), invitation_id, True,
    ).status_code == 404

    response, _ = org_invitations._create_invitation_sync(
        _request("manager"), role, {"email": "invitee@example.test", "employee_name": "Chị Lan"},
    )
    second = _body(response)["invitationId"]
    invitation_db.connection.execute(
        "UPDATE organization_invitations SET created_at = ?, expires_at = ? WHERE id = ?",
        (int(time.time()) - 20, int(time.time()) - 10, second),
    )
    assert org_invitations._respond_invitation_sync(
        _request("invitee"), SimpleNamespace(user_id="invitee"), second, True,
    ).status_code == 404


def test_non_manager_cannot_invite(invitation_db):
    response, _ = org_invitations._create_invitation_sync(
        _request("stranger"), SimpleNamespace(user_id="stranger"),
        {"email": "x@example.test", "employee_name": "X"},
    )
    assert response.status_code == 403


def test_direct_add_of_a_new_person_requires_an_invitation(monkeypatch):
    calls = []

    class Cursor:
        def execute(self, sql, params=()):
            calls.append(sql)
            self.result = None
            if "SELECT vai_tro FROM tai_khoan WHERE id = ?" in " ".join(sql.split()):
                self.result = ("user",)
            return self

        def fetchone(self):
            return self.result

    class Connection:
        def execute(self, *_a):
            return Cursor()

        def cursor(self):
            return Cursor()

        def rollback(self):
            calls.append("rollback")

        def close(self):
            pass

    monkeypatch.setattr(org_routes, "database", SimpleNamespace(get_connection=Connection))
    monkeypatch.setattr(org_routes, "get_active_org", lambda *_a, **_k: "org-a")
    monkeypatch.setattr(org_routes, "is_business_organization", lambda *_a: True)
    monkeypatch.setattr(org_routes, "_lock_and_can_manage_organization_mutation", lambda *_a: True)
    response = org_routes._add_user_to_org_sync(
        SimpleNamespace(headers={}, state=SimpleNamespace()),
        SimpleNamespace(user_id="manager"),
        {"user_id": "someone", "employee_name": "Ai đó"},
    )
    assert response.status_code == 409
    assert _body(response)["code"] == "MEMBERSHIP_INVITATION_REQUIRED"


def test_lookup_endpoint_is_gone():
    import backend.app as app_module

    paths = {getattr(route, "path", "") for route in app_module.routes}
    assert "/api/organizations/membership-candidate" not in paths
    assert {"/api/organizations/invitations", "/api/invitations"} <= paths
    assert not hasattr(org_routes, "_lookup_membership_candidate_sync")
    asyncio.run(asyncio.sleep(0))
