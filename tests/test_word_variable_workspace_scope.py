import asyncio
import sqlite3
import time
from types import SimpleNamespace

from backend.auth.session_utils import get_active_org
from backend.documents.word_defaults import (
    ensure_default_word_mappings,
    ensure_personal_word_workspace,
)
from backend.shared.access_policy import (
    can_manage_word_config,
    can_read_word_config,
)
from backend.shared.workspace_scope import personal_scope_id


def _database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            vai_tro TEXT NOT NULL
        );
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            ten_to_chuc TEXT NOT NULL,
            trang_thai TEXT NOT NULL DEFAULT 'active'
        );
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            vai_tro_trong_to_chuc TEXT NOT NULL,
            trang_thai_thanh_vien TEXT NOT NULL DEFAULT 'active'
        );
        CREATE TABLE sync_metadata (
            organization_id TEXT PRIMARY KEY,
            current_version INTEGER NOT NULL
        );
        CREATE TABLE cau_hinh_bien_word (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            owner_type TEXT NOT NULL,
            ten_bien TEXT NOT NULL,
            source_table TEXT NOT NULL,
            source_column TEXT NOT NULL,
            mo_ta TEXT,
            UNIQUE(organization_id, ten_bien),
            UNIQUE(organization_id, source_table, source_column)
        );
        CREATE TABLE word_default_seeds (
            organization_id TEXT PRIMARY KEY,
            mappings_version INTEGER NOT NULL,
            updated_at TEXT
        );
        CREATE TABLE goi_dich_vu (
            id TEXT PRIMARY KEY,
            trang_thai TEXT NOT NULL
        );
        CREATE TABLE organization_subscriptions (
            organization_id TEXT PRIMARY KEY,
            package_id TEXT NOT NULL,
            status TEXT NOT NULL,
            starts_at INTEGER NOT NULL,
            expires_at INTEGER,
            member_quota INTEGER NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE account_subscriptions (
            user_id TEXT PRIMARY KEY,
            package_id TEXT NOT NULL,
            status TEXT NOT NULL,
            starts_at INTEGER NOT NULL,
            expires_at INTEGER,
            revision INTEGER NOT NULL DEFAULT 1
        );
        """
    )
    return connection


def _request(active_workspace_id):
    return SimpleNamespace(
        headers={"X-Active-Org": active_workspace_id},
        state=SimpleNamespace(),
    )


def test_new_account_bootstrap_creates_personal_word_variables_immediately():
    connection = _database()
    cursor = connection.cursor()
    cursor.execute("INSERT INTO tai_khoan (id, vai_tro) VALUES ('user-a', 'user')")

    inserted = ensure_personal_word_workspace(cursor, "user-a")
    inserted_again = ensure_personal_word_workspace(cursor, "user-a")

    scope_id = personal_scope_id("user-a")
    assert inserted > 0
    assert inserted_again == 0
    assert cursor.execute(
        "SELECT current_version FROM sync_metadata WHERE organization_id = ?",
        (scope_id,),
    ).fetchone()[0] == 1
    assert cursor.execute(
        "SELECT count(*) FROM cau_hinh_bien_word WHERE organization_id = ? AND owner_type = 'personal'",
        (scope_id,),
    ).fetchone()[0] > 0


def test_switching_workspace_selects_distinct_personal_and_organization_variables():
    connection = _database()
    cursor = connection.cursor()
    cursor.execute("INSERT INTO tai_khoan (id, vai_tro) VALUES ('user-a', 'user')")
    cursor.execute("INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('org-a', 'Tổ chức A')")
    cursor.execute(
        "INSERT INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc) VALUES ('user-a', 'org-a', 'employee')"
    )
    ensure_personal_word_workspace(cursor, "user-a")
    ensure_default_word_mappings(cursor, "org-a")

    personal_scope = get_active_org(
        _request(personal_scope_id("user-a")), "user-a", cursor=cursor
    )
    organization_scope = get_active_org(
        _request("org-a"), "user-a", cursor=cursor
    )
    personal_mapping = cursor.execute(
        "SELECT id, ten_bien FROM cau_hinh_bien_word WHERE organization_id = ? ORDER BY id LIMIT 1",
        (personal_scope,),
    ).fetchone()
    cursor.execute(
        "UPDATE cau_hinh_bien_word SET ten_bien = 'bien_ca_nhan' WHERE id = ? AND organization_id = ?",
        (personal_mapping["id"], personal_scope),
    )

    assert personal_scope == "personal:user-a"
    assert organization_scope == "org-a"
    assert cursor.execute(
        "SELECT ten_bien FROM cau_hinh_bien_word WHERE id = ? AND organization_id = ?",
        (personal_mapping["id"], personal_scope),
    ).fetchone()[0] == "bien_ca_nhan"
    assert cursor.execute(
        "SELECT count(*) FROM cau_hinh_bien_word WHERE organization_id = ? AND ten_bien = 'bien_ca_nhan'",
        (organization_scope,),
    ).fetchone()[0] == 0


def test_default_word_variable_upgrade_rewrites_legacy_explanation_text():
    connection = _database()
    cursor = connection.cursor()
    cursor.execute("INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('org-a', 'Tổ chức A')")
    cursor.execute(
        """INSERT INTO cau_hinh_bien_word
           (id, organization_id, owner_type, ten_bien, source_table, source_column, mo_ta)
           VALUES ('legacy-ma-cdt', 'org-a', 'organization', 'ma_cdt',
                   'chu_dau_tu', 'ma_chu_dau_tu',
                   'Bien don mac dinh tu schema he thong: chu_dau_tu.ma_chu_dau_tu')"""
    )
    cursor.execute(
        "INSERT INTO word_default_seeds (organization_id, mappings_version) VALUES ('org-a', 13)"
    )

    ensure_default_word_mappings(cursor, "org-a")

    description = cursor.execute(
        "SELECT mo_ta FROM cau_hinh_bien_word WHERE id = 'legacy-ma-cdt'"
    ).fetchone()[0]
    version = cursor.execute(
        "SELECT mappings_version FROM word_default_seeds WHERE organization_id = 'org-a'"
    ).fetchone()[0]
    assert description == "Biến đơn mặc định từ schema hệ thống: chu_dau_tu.ma_chu_dau_tu"
    assert version == 14


def test_organization_members_can_read_but_only_manager_can_change_word_variables():
    connection = _database()
    cursor = connection.cursor()
    now = int(time.time())
    cursor.executemany(
        "INSERT INTO tai_khoan (id, vai_tro) VALUES (?, 'user')",
        (("manager-a",), ("employee-a",)),
    )
    cursor.execute("INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('org-a', 'Tổ chức A')")
    cursor.executemany(
        "INSERT INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc) VALUES (?, 'org-a', ?)",
        (("manager-a", "manager"), ("employee-a", "employee")),
    )
    cursor.execute("INSERT INTO goi_dich_vu (id, trang_thai) VALUES ('gold', 'active')")
    cursor.execute(
        """INSERT INTO organization_subscriptions
           (organization_id, package_id, status, starts_at, expires_at, member_quota)
           VALUES ('org-a', 'gold', 'active', ?, ?, 10)""",
        (now - 60, now + 3600),
    )
    manager = SimpleNamespace(active_role="manager", platform_role="user")
    employee = SimpleNamespace(active_role="employee", platform_role="user")

    assert can_read_word_config(cursor, manager, "manager-a", "org-a")
    assert can_manage_word_config(cursor, manager, "manager-a", "org-a")
    assert can_read_word_config(cursor, employee, "employee-a", "org-a")
    assert not can_manage_word_config(cursor, employee, "employee-a", "org-a")


def test_email_registration_bootstraps_word_variables_before_commit(monkeypatch):
    from backend.auth import otp_routes

    events = []

    class Cursor:
        def __init__(self):
            self.row = None

        def execute(self, sql, _params=()):
            self.row = None
            if "INSERT INTO tai_khoan" in sql:
                events.append("account_inserted")
            return self

        def fetchone(self):
            return self.row

    class Connection:
        in_transaction = False

        def __init__(self):
            self._cursor = Cursor()

        def execute(self, _sql, _params=()):
            return self._cursor

        def cursor(self):
            return self._cursor

        def commit(self):
            events.append("committed")

        def rollback(self):
            events.append("rolled_back")

        def close(self):
            pass

    class Request:
        headers = {}
        client = SimpleNamespace(host="127.0.0.1")

        async def json(self):
            return {
                "username": "newuser2026",
                "password": "Strong-Unique-2026!",
                "name": "Người dùng mới",
                "email": "new.user@example.com",
            }

    async def allow_rate_limit(*_args, **_kwargs):
        return SimpleNamespace(allowed=True)

    async def hash_without_cpu_pool(*_args, **_kwargs):
        return "password-hash"

    monkeypatch.setattr(otp_routes, "_rate_limit_decision", allow_rate_limit)
    monkeypatch.setattr(otp_routes, "run_cpu_bound", hash_without_cpu_pool)
    monkeypatch.setattr(otp_routes.database, "get_connection", Connection)
    monkeypatch.setattr(otp_routes, "generate_record_id", lambda _table: "user-new")
    monkeypatch.setattr(otp_routes, "generate_otp", lambda: "123456")
    monkeypatch.setattr(
        otp_routes,
        "ensure_personal_word_workspace",
        lambda _cursor, user_id: events.append(("word_variables_created", user_id)),
    )

    response = asyncio.run(otp_routes.register_api(Request()))

    assert response.status_code == 200
    assert events == [
        "account_inserted",
        ("word_variables_created", "user-new"),
        "committed",
    ]
