import json
import time

import pytest

from backend.api import org_routes
from backend.auth.auth_helper import SessionRole
from backend.auth import session_utils
from backend.db.db_helper import SQLiteDatabase
from backend.db.db_utils import _build_create_table_sql
from backend.db.schema import SCHEMA_DINH_NGHIA


class _Request:
    method = "POST"
    cookies = {}

    def __init__(self, payload, headers=None):
        self._payload = payload
        self.headers = headers or {}

    async def json(self):
        return self._payload


def _payload(response):
    return json.loads(response.body.decode("utf-8"))


def _subscription_database(path, quota=2, expires_at=None):
    database = SQLiteDatabase(path)
    connection = database.get_connection()
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        connection.execute(_build_create_table_sql(table_name, table_spec))
    connection.execute(
        "INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su) VALUES ('silver', 'Silver', 0, ?)",
        (quota,),
    )
    accounts = (
        ("owner", "owner", "owner@example.com"),
        ("member-1", "member_1", "member-1@example.com"),
        ("member-2", "member_2", "member-2@example.com"),
        ("admin", "admin", "admin@example.com"),
    )
    for user_id, username, email in accounts:
        connection.execute(
            """
            INSERT INTO tai_khoan (
                id, ten_dang_nhap, username_norm, mat_khau, email, email_norm, vai_tro
            ) VALUES (?, ?, ?, 'test-hash', ?, ?, ?)
            """,
            (user_id, username, username, email, email, "super_admin" if user_id == "admin" else "user"),
        )
    connection.execute("INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('org-a', 'Organization A')")
    connection.execute(
        "INSERT INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc) VALUES ('owner', 'org-a', 'manager')"
    )
    now = int(time.time())
    connection.execute(
        """
        INSERT INTO organization_subscriptions (
            organization_id, package_id, status, starts_at, expires_at, member_quota
        ) VALUES ('org-a', 'silver', 'active', ?, ?, ?)
        """,
        (now - 60, expires_at if expires_at is not None else now + 86400, quota),
    )
    connection.commit()
    connection.close()
    return database


def _patch_org_routes(monkeypatch, database, actor="owner"):
    monkeypatch.setattr(org_routes, "database", database)
    monkeypatch.setattr(
        org_routes,
        "verify_session",
        lambda _request, required_role=None: (True, SessionRole("super_admin" if required_role else "user", actor)),
    )
    monkeypatch.setattr(org_routes, "get_active_org", lambda _request, _user_id: "org-a")
    monkeypatch.setattr(org_routes, "is_organization_manager", lambda *_args: True)
    monkeypatch.setattr(org_routes, "log_audit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(org_routes, "broadcast_websocket_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(org_routes, "disconnect_user_websockets", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(org_routes, "_session_cache_invalidate_by_user_id", lambda *_args: None)
    monkeypatch.setattr(org_routes, "_org_cache_invalidate_by_user_id", lambda *_args: None)


@pytest.mark.anyio
async def test_add_member_quota_is_enforced_inside_server_transaction(monkeypatch, tmp_path):
    database = _subscription_database(tmp_path / "quota.db", quota=2)
    _patch_org_routes(monkeypatch, database)

    added = await org_routes.add_user_to_org_api(_Request({"user_id": "member-1"}))
    rejected = await org_routes.add_user_to_org_api(_Request({"user_id": "member-2"}))

    assert added.status_code == 200
    assert rejected.status_code == 409
    assert _payload(rejected)["code"] == "ORG_MEMBER_QUOTA_EXCEEDED"
    connection = database.get_connection()
    assert connection.execute(
        "SELECT count(*) FROM thanh_vien_to_chuc WHERE organization_id = 'org-a'"
    ).fetchone()[0] == 2
    connection.close()


@pytest.mark.anyio
async def test_subscription_renewal_is_idempotent_and_lock_is_server_owned(monkeypatch, tmp_path):
    database = _subscription_database(tmp_path / "subscription.db", quota=5)
    _patch_org_routes(monkeypatch, database, actor="admin")
    request = _Request(
        {"organization_id": "org-a", "action": "renew", "duration_days": 365},
        {"Idempotency-Key": "renew-key-2026"},
    )

    first = await org_routes.update_organization_subscription_api(request)
    replay = await org_routes.update_organization_subscription_api(request)
    assert first.status_code == replay.status_code == 200
    assert _payload(first)["subscription"]["expires_at"] == _payload(replay)["subscription"]["expires_at"]

    locked = await org_routes.update_organization_subscription_api(_Request(
        {"organization_id": "org-a", "action": "lock"},
        {"Idempotency-Key": "lock-key-2026"},
    ))
    assert locked.status_code == 200
    connection = database.get_connection()
    assert connection.execute("SELECT trang_thai FROM to_chuc WHERE id = 'org-a'").fetchone()[0] == "suspended"
    assert connection.execute(
        "SELECT status FROM organization_subscriptions WHERE organization_id = 'org-a'"
    ).fetchone()[0] == "suspended"
    connection.close()


def test_expired_subscription_blocks_direct_protected_workspace_access(monkeypatch, tmp_path):
    database = _subscription_database(tmp_path / "expired.db", expires_at=int(time.time()) - 1)
    monkeypatch.setattr(session_utils, "database", database)
    session_utils._org_cache.clear()
    request = _Request({}, {"X-Active-Org": "org-a"})

    with pytest.raises(session_utils.OrgPermissionError, match="hết hạn"):
        session_utils.get_active_org(request, "owner")


def test_personal_workspace_does_not_require_a_subscription(monkeypatch, tmp_path):
    database = _subscription_database(tmp_path / "personal-without-package.db")
    connection = database.get_connection()
    connection.execute(
        """INSERT INTO to_chuc (
               id, ten_to_chuc, scope_type, personal_owner_user_id, trang_thai
           ) VALUES ('personal-member-1', 'Không gian cá nhân', 'personal', 'member-1', 'active')"""
    )
    connection.execute(
        """INSERT INTO thanh_vien_to_chuc (
               user_id, organization_id, vai_tro_trong_to_chuc
           ) VALUES ('member-1', 'personal-member-1', 'employee')"""
    )
    connection.commit()
    connection.close()
    monkeypatch.setattr(session_utils, "database", database)
    session_utils._org_cache.clear()
    request = _Request({}, {"X-Active-Org": "personal-member-1"})

    assert session_utils.get_active_org(request, "member-1") == "personal-member-1"
