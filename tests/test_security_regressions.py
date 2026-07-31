import hashlib
import json
import os
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.auth import admin_user_routes
from backend.auth.auth_helper import SessionRole
from backend.shared import access_policy
from backend.sync import pagination
from scripts.backup import _stage_restore_assets, _verify_snapshot


def _manifest_entry(relative_path, payload):
    return {
        "relativePath": relative_path,
        "sizeBytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def test_backup_verifier_rejects_path_that_becomes_rooted_after_prefix_removal(
    tmp_path,
):
    snapshot = tmp_path / "snapshot"
    escaped_target = tmp_path / "escaped.txt"
    database_payload = b"database dump"
    database_path = snapshot / "database" / "bidding.dump"
    database_path.parent.mkdir(parents=True)
    database_path.write_bytes(database_payload)

    absolute_target = str(escaped_target.resolve())
    _drive, rooted_tail = os.path.splitdrive(absolute_target)
    malicious_relative_path = "uploads/" + rooted_tail
    malicious_payload = b"controlled restore asset\n"
    malicious_source = snapshot / Path(malicious_relative_path)
    malicious_source.parent.mkdir(parents=True, exist_ok=True)
    malicious_source.write_bytes(malicious_payload)

    database_entry = _manifest_entry("database/bidding.dump", database_payload)
    malicious_entry = _manifest_entry(
        malicious_relative_path,
        malicious_payload,
    )
    manifest = {
        "format": "biddingflow-pg-backup",
        "version": 1,
        "database": {"kind": "pg_dump", **database_entry},
        "fileCount": 2,
        "files": [database_entry, malicious_entry],
    }
    (snapshot / "manifest.json").write_text(
        json.dumps(manifest),
        encoding="utf-8",
    )

    with pytest.raises(RuntimeError, match="unsafe backup path"):
        _verify_snapshot(snapshot)



def test_valid_backup_stages_assets_inside_destination(tmp_path):
    snapshot = tmp_path / "snapshot"
    database_payload = b"database dump"
    asset_payload = b"safe asset"
    database_path = snapshot / "database" / "bidding.dump"
    asset_path = snapshot / "uploads" / "nested" / "asset.txt"
    database_path.parent.mkdir(parents=True)
    asset_path.parent.mkdir(parents=True)
    database_path.write_bytes(database_payload)
    asset_path.write_bytes(asset_payload)

    database_entry = _manifest_entry("database/bidding.dump", database_payload)
    asset_entry = _manifest_entry("uploads/nested/asset.txt", asset_payload)
    manifest = {
        "format": "biddingflow-pg-backup",
        "version": 1,
        "database": {"kind": "pg_dump", **database_entry},
        "fileCount": 2,
        "files": [database_entry, asset_entry],
    }
    (snapshot / "manifest.json").write_text(
        json.dumps(manifest),
        encoding="utf-8",
    )

    verified = _verify_snapshot(snapshot)
    destination = tmp_path / "live-uploads"
    stage = _stage_restore_assets(
        snapshot,
        verified,
        {"uploads": destination},
    )[destination]

    assert (stage / "nested" / "asset.txt").read_bytes() == asset_payload


class _AuthorizationCursor:
    def __init__(self):
        self.one = None
        self.rows = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.one = None
        self.rows = []
        if normalized.startswith("SELECT lower(trim(vai_tro_trong_to_chuc))"):
            self.one = ("employee",)
        elif normalized.startswith("SELECT goithau FROM ma_tran_phan_quyen"):
            self.one = ("edit",)
        elif normalized.startswith("SELECT id, goi_thau_id FROM thong_tin_mo_thau"):
            self.rows = [("opening-B", "package-B")]
        elif normalized.startswith("SELECT id, trang_thai FROM goi_thau"):
            self.rows = [
                (package_id, "PREPARING")
                for package_id in ("package-A", "package-B")
                if package_id in params
            ]
        elif "FROM phan_cong_nhan_su" in normalized:
            self.rows = [("package-A", "goithau")]
        return self

    def fetchone(self):
        return self.one

    def fetchall(self):
        return list(self.rows)


def test_opening_write_authorization_uses_stored_parent_not_payload_parent():
    item = {
        "id": "opening-B",
        "goiThauId": "package-A",
        "expectedVersion": 7,
    }
    context = access_policy.build_batch_write_authorization_context(
        _AuthorizationCursor(),
        "employee",
        "specialist-1",
        "org-1",
        {"thong_tin_mo_thau": [item]},
    )

    assert context.opening_parent_by_id["opening-B"] == "package-B"
    decision = access_policy.authorize_record_write_from_context(
        context,
        "thongtinmothau",
        "thong_tin_mo_thau",
        item,
    )
    assert not decision.allowed
    assert "\u0111\u1ed5i g\u00f3i th\u1ea7u cha" in decision.message


@pytest.mark.parametrize(
    ("table_key", "table_name", "assigned_id", "unassigned_id"),
    [
        ("goithauhanghoa", "goi_thau_hang_hoa", "goods-A", "goods-B"),
        (
            "hanghoaduthaunhathau",
            "hang_hoa_du_thau_nha_thau",
            "bid-goods-A",
            "bid-goods-B",
        ),
    ],
)
def test_goods_pagination_filters_unassigned_packages(
    monkeypatch,
    table_key,
    table_name,
    assigned_id,
    unassigned_id,
):
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        f"""
        CREATE TABLE {table_name} (
            id TEXT,
            organization_id TEXT,
            goi_thau_id TEXT
        );
        CREATE TABLE phan_cong_nhan_su (
            organization_id TEXT,
            id_nhan_vien TEXT,
            id_muc_tieu TEXT,
            loai_doi_tuong TEXT
        );
        INSERT INTO {table_name}
            VALUES ('{assigned_id}', 'org-1', 'package-A');
        INSERT INTO {table_name}
            VALUES ('{unassigned_id}', 'org-1', 'package-B');
        INSERT INTO phan_cong_nhan_su
            VALUES ('org-1', 'specialist-1', 'package-A', 'goithau');
        """
    )

    role = SimpleNamespace(user_id="specialist-1")
    monkeypatch.setattr(pagination, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(
        pagination,
        "get_active_org",
        lambda _request, _user_id, cursor=None: "org-1",
    )
    monkeypatch.setattr(pagination, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(
        pagination,
        "is_personal_scope_for_user",
        lambda *_args: False,
    )
    monkeypatch.setattr(
        pagination,
        "is_organization_manager",
        lambda *_args: False,
    )
    monkeypatch.setattr(
        pagination,
        "resolve_sensitive_read_policy",
        lambda *_args, **_kwargs: SimpleNamespace(can_view=lambda _family: True),
    )
    monkeypatch.setattr(
        pagination,
        "serialize_sensitive_read_items",
        lambda _table, items, _policy: items,
    )
    monkeypatch.setattr(
        pagination,
        "database",
        SimpleNamespace(get_connection=lambda: connection),
    )
    request = SimpleNamespace(
        query_params={"table": table_key, "page": "1", "pageSize": "20"},
        cookies={"session_token": "local-test"},
    )

    response = pagination._paginate_records_blocking(request)
    payload = json.loads(response.body)

    assert response.status_code == 200
    assert payload["totalItems"] == 1
    assert [item["id"] for item in payload["items"]] == [assigned_id]


class _AdminCursor:
    def __init__(self):
        self.one = None
        self.rows = []

    def execute(self, sql, _params=()):
        normalized = " ".join(str(sql).split())
        self.one = None
        self.rows = []
        if normalized.startswith("SELECT vai_tro FROM tai_khoan WHERE id = ?"):
            self.one = {"vai_tro": "super_admin"}
        elif normalized.startswith("SELECT lower(trim(vai_tro_trong_to_chuc))"):
            self.one = ("employee",)
        elif normalized.startswith("SELECT id, ten_dang_nhap AS username"):
            self.rows = [
                {
                    "id": "sa-1",
                    "username": "sa",
                    "name": "Admin",
                    "role": "super_admin",
                    "platform_role": "super_admin",
                    "email": "sa@example.test",
                    "avatar": None,
                },
                {
                    "id": "other-org-user",
                    "username": "other",
                    "name": "Other organization",
                    "role": "user",
                    "platform_role": "user",
                    "email": "other@example.test",
                    "avatar": None,
                },
            ]
        elif "FROM tai_khoan AS tk" in normalized and "WHERE tk.id = ?" in normalized:
            self.rows = [
                {
                    "id": "sa-1",
                    "username": "sa",
                    "name": "Admin",
                    "role": "employee",
                    "platform_role": "super_admin",
                    "email": "sa@example.test",
                    "avatar": None,
                }
            ]
        return self

    def fetchone(self):
        return self.one

    def fetchall(self):
        return list(self.rows)


class _AdminConnection:
    def cursor(self):
        return _AdminCursor()

    def close(self):
        pass


def _patch_admin_directory_dependencies(monkeypatch, verify_session):
    monkeypatch.setattr(admin_user_routes, "verify_session", verify_session)
    monkeypatch.setattr(
        admin_user_routes,
        "get_active_org",
        lambda *_args: "org-1",
    )
    monkeypatch.setattr(
        admin_user_routes,
        "get_account_subscriptions_by_user_ids",
        lambda _cursor, _ids: {},
    )
    monkeypatch.setattr(
        admin_user_routes,
        "personal_workspace_payload",
        lambda *_args: {"scope_type": "personal"},
    )
    monkeypatch.setattr(
        admin_user_routes,
        "database",
        SimpleNamespace(get_connection=lambda: _AdminConnection()),
    )


def test_global_user_directory_honors_employee_active_role(monkeypatch):
    role = SessionRole(
        "employee",
        "sa-1",
        "session-1",
        platform_role="super_admin",
        active_role="employee",
    )
    _patch_admin_directory_dependencies(
        monkeypatch,
        lambda _request, required_role=None: (True, role),
    )

    response = admin_user_routes._list_users_sync(
        SimpleNamespace(query_params={}),
    )
    payload = json.loads(response.body)

    assert response.status_code == 200
    assert [item["id"] for item in payload] == ["sa-1"]


def test_global_user_directory_requires_super_admin_controls(monkeypatch):
    role = SessionRole(
        "super_admin",
        "sa-1",
        "session-1",
        platform_role="super_admin",
        active_role="super_admin",
    )
    required_roles = []

    def verify_session(_request, required_role=None):
        required_roles.append(required_role)
        if required_role == "super_admin":
            return False, "SUPER_ADMIN_NETWORK_DENIED"
        return True, role

    _patch_admin_directory_dependencies(monkeypatch, verify_session)

    response = admin_user_routes._list_users_sync(
        SimpleNamespace(query_params={}),
    )

    assert response.status_code == 403
    assert required_roles == [None, "super_admin"]

