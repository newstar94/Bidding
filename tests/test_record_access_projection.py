import json
import sqlite3
import time
import uuid
from types import SimpleNamespace

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.auth.auth_helper import SessionRole
from backend.ai.errors import AiError
from backend.ai.types import AiRequestContext
from backend.ai.workspace_search import search_workspace_records
from backend.analytics.query_scope import visibility_clause
from backend.documents.docx_context_policy import project_docx_context
from backend.shared.access_policy import (
    can_read_record,
    resolve_document_export_capabilities,
)
from backend.shared.sensitive_data import (
    resolve_sensitive_read_policy,
    serialize_sensitive_read_item,
)

from tests.test_sync_conflict_authorization import (
    _seed_denied_package,
    _test_database,
)
from backend.sync.visibility_epoch import VISIBILITY_POLICY_VERSION
from backend.sync.visibility_scope import VisibilityScope
from backend.sync.api import sync_http_routes
import backend.sync.pagination as pagination_module
import backend.sync.read_service as read_service_module


def _enable_organization_word_export(cursor, organization_id):
    package_id = f"word-package-{uuid.uuid4().hex}"
    cursor.execute(
        """INSERT INTO goi_dich_vu
           (id, ten_goi, gia_ca, han_muc_nhan_su, trang_thai)
           VALUES (?, 'Word test', 0, 10, 'active')""",
        (package_id,),
    )
    cursor.execute(
        """INSERT INTO organization_subscriptions
           (organization_id, package_id, status, starts_at, expires_at,
            member_quota, revision)
           VALUES (?, ?, 'active', ?, ?, 10, 1)""",
        (
            organization_id,
            package_id,
            int(time.time()) - 60,
            int(time.time()) + 3600,
        ),
    )


def _insert_document_export_capabilities(cursor, organization_id, user_id, grants):
    cursor.execute(
        """INSERT INTO document_export_capabilities
           (organization_id, user_id, financial, identity, signature)
           VALUES (?, ?, ?, ?, ?)""",
        (organization_id, user_id, *grants),
    )


def _insert_sensitive_read_capabilities(cursor, organization_id, user_id, grants):
    cursor.execute(
        """INSERT INTO sensitive_record_read_capabilities
           (organization_id, user_id, financial, identity, signature)
           VALUES (?, ?, ?, ?, ?)""",
        (organization_id, user_id, *grants),
    )


def _word_policy_database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            ten_to_chuc TEXT NOT NULL,
            trang_thai TEXT NOT NULL DEFAULT 'active'
        );
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            vai_tro TEXT NOT NULL DEFAULT 'user',
            trang_thai TEXT NOT NULL DEFAULT 'active'
        );
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            vai_tro_trong_to_chuc TEXT NOT NULL,
            ten_nhan_su TEXT,
            trang_thai_thanh_vien TEXT NOT NULL DEFAULT 'active',
            PRIMARY KEY (user_id, organization_id)
        );
        CREATE TABLE goi_dich_vu (
            id TEXT PRIMARY KEY,
            ten_goi TEXT NOT NULL,
            gia_ca INTEGER NOT NULL,
            han_muc_nhan_su INTEGER NOT NULL,
            trang_thai TEXT NOT NULL,
            document_export_word INTEGER NOT NULL DEFAULT 1,
            document_export_excel INTEGER NOT NULL DEFAULT 1,
            document_export_award_result_excel INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE organization_subscriptions (
            organization_id TEXT PRIMARY KEY,
            package_id TEXT NOT NULL,
            status TEXT NOT NULL,
            starts_at INTEGER NOT NULL,
            expires_at INTEGER,
            member_quota INTEGER NOT NULL,
            revision INTEGER NOT NULL
        );
        CREATE TABLE document_export_capabilities (
            organization_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            financial INTEGER NOT NULL DEFAULT 0,
            identity INTEGER NOT NULL DEFAULT 0,
            signature INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (organization_id, user_id)
        );
        CREATE TABLE sensitive_record_read_capabilities (
            organization_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            financial INTEGER NOT NULL DEFAULT 0,
            identity INTEGER NOT NULL DEFAULT 0,
            signature INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (organization_id, user_id)
        );
        """
    )
    return connection


def _seed_word_policy_member(cursor, *, membership_role="employee"):
    suffix = uuid.uuid4().hex
    organization_id = f"org-word-{suffix}"
    user_id = f"user-word-{suffix}"
    cursor.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
        (organization_id, "Tổ chức kiểm thử Word"),
    )
    cursor.execute(
        "INSERT INTO tai_khoan (id, vai_tro) VALUES (?, 'user')",
        (user_id,),
    )
    cursor.execute(
        """INSERT INTO thanh_vien_to_chuc
           (user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su)
           VALUES (?, ?, ?, 'Thành viên kiểm thử')""",
        (user_id, organization_id, membership_role),
    )
    _enable_organization_word_export(cursor, organization_id)
    return organization_id, user_id


def test_word_export_grants_do_not_change_complete_record_projection():
    connection = _word_policy_database()
    try:
        cursor = connection.cursor()
        organization_id, employee_id = _seed_word_policy_member(cursor)
        _insert_document_export_capabilities(
            cursor, organization_id, employee_id, (1, 1, 1)
        )
        role = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )

        before = resolve_sensitive_read_policy(
            cursor,
            role,
            employee_id,
            organization_id,
            table_names={"chuyen_gia", "nha_thau"},
        )
        assert (
            before.can_view_contractor_financials,
            before.can_view_expert_details,
            before.can_view_signature_images,
        ) == (True, True, True)

        _insert_sensitive_read_capabilities(
            cursor, organization_id, employee_id, (1, 1, 1)
        )
        after = resolve_sensitive_read_policy(
            cursor,
            role,
            employee_id,
            organization_id,
            table_names={"chuyen_gia", "nha_thau"},
        )
        assert (
            after.can_view_contractor_financials,
            after.can_view_expert_details,
            after.can_view_signature_images,
        ) == (True, True, True)
    finally:
        connection.close()


def test_authorized_record_read_is_complete_without_field_capability():
    connection = _word_policy_database()
    try:
        cursor = connection.cursor()
        organization_id, employee_id = _seed_word_policy_member(cursor)
        role = SessionRole(
            'user',
            employee_id,
            platform_role='user',
            active_role='employee',
        )
        policy = resolve_sensitive_read_policy(
            cursor, role, employee_id, organization_id,
            table_names={'chuyen_gia', 'nha_thau'},
        )
        contractor = serialize_sensitive_read_item(
            'nha_thau',
            {
                'soTaiKhoan': '0123456789',
                'noiMoTaiKhoan': 'Vietcombank Ha Noi',
                'maNganHang': 'VCB',
                'anhDau': 'images/nha_thau/stamp.webp',
            },
            policy,
        )
        expert = serialize_sensitive_read_item(
            'chuyen_gia',
            {
                'soCCCD': '012345678901',
                'anhChungChi': 'images/chuyen_gia/certificate.webp',
                'anhChuKy': 'images/chuyen_gia/signature.webp',
            },
            policy,
        )
        assert contractor == {
            'soTaiKhoan': '0123456789',
            'noiMoTaiKhoan': 'Vietcombank Ha Noi',
            'maNganHang': 'VCB',
            'anhDau': 'images/nha_thau/stamp.webp',
        }
        assert expert == {
            'soCCCD': '012345678901',
            'anhChungChi': 'images/chuyen_gia/certificate.webp',
            'anhChuKy': 'images/chuyen_gia/signature.webp',
        }
    finally:
        connection.close()


def test_complete_record_read_contract_has_no_runtime_field_capability_controls():
    root = __import__("pathlib").Path(__file__).resolve().parents[1]
    runtime_sources = (
        root / "backend" / "auth" / "admin_user_routes.py",
        root / "backend" / "shared" / "sensitive_data.py",
        root / "backend" / "sync" / "visibility_epoch.py",
        root / "frontend" / "admin" / "AdminUserController.js",
        root / "views" / "modals" / "modal_detail_system_user.html",
    )
    combined = "\n".join(path.read_text(encoding="utf-8") for path in runtime_sources)

    assert "sensitive_record_read_capabilities" not in combined
    assert "sensitive_read_capabilities" not in combined
    assert "data-sensitive-read-capability" not in combined
    assert VISIBILITY_POLICY_VERSION >= 5


def test_document_entitlement_changes_do_not_change_record_visibility_token():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, _package_id = _seed_denied_package(cursor)
        role = SessionRole(
            "user", employee_id, platform_role="user", active_role="employee"
        )
        from backend.sync.visibility_epoch import build_visibility_token

        before = build_visibility_token(cursor, organization_id, employee_id, role)
        _insert_document_export_capabilities(
            cursor, organization_id, employee_id, (1, 1, 1)
        )
        after = build_visibility_token(cursor, organization_id, employee_id, role)
        assert before == after
    finally:
        connection.rollback()
        connection.close()
        database.close()


def test_record_access_and_word_export_have_distinct_sensitive_policies():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_id = _seed_denied_package(cursor)
        role = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )
        package = dict(cursor.execute(
            "SELECT * FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        ).fetchone())

        assert not can_read_record(
            cursor, role, employee_id, organization_id,
            "goithau", "goi_thau", package,
        )
        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
               (id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)
               VALUES (?, ?, ?, ?, 'goithau')""",
            (f"assigned-{uuid.uuid4().hex}", organization_id, employee_id, package_id),
        )
        assert can_read_record(
            cursor, role, employee_id, organization_id,
            "goithau", "goi_thau", package,
        )

        _enable_organization_word_export(cursor, organization_id)
        _insert_document_export_capabilities(
            cursor, organization_id, employee_id, (1, 1, 1)
        )

        capabilities = resolve_document_export_capabilities(
            cursor, role, employee_id, organization_id,
        )
        assert capabilities.as_dict() == {
            "financial": True,
            "identity": True,
            "signature": True,
        }

        sensitive_policy = resolve_sensitive_read_policy(
            cursor,
            role,
            employee_id,
            organization_id,
            table_names={"nha_thau"},
        )
        contractor = serialize_sensitive_read_item(
            "nha_thau",
            {
                "id": "contractor-1",
                "soTaiKhoan": "0123456789",
                "maNganHang": "VCB",
                "anhDau": "images/nha_thau/stamp.png",
            },
            sensitive_policy,
        )
        assert contractor == {
            "id": "contractor-1",
            "soTaiKhoan": "0123456789",
            "maNganHang": "VCB",
            "anhDau": "images/nha_thau/stamp.png",
        }
    finally:
        connection.rollback()
        connection.close()
        database.close()


def test_manager_employee_persona_reads_only_assigned_records_without_matrix():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, manager_id, package_id = _seed_denied_package(cursor)
        cursor.execute(
            """UPDATE thanh_vien_to_chuc
               SET vai_tro_trong_to_chuc = 'manager'
               WHERE organization_id = ? AND user_id = ?""",
            (organization_id, manager_id),
        )
        cursor.execute(
            "DELETE FROM ma_tran_phan_quyen WHERE organization_id = ? AND emp_id = ?",
            (organization_id, manager_id),
        )
        cursor.execute(
            """UPDATE phan_cong_nhan_su
               SET id_nhan_vien = ?
               WHERE organization_id = ? AND id_muc_tieu = ?""",
            (manager_id, organization_id, package_id),
        )
        role = SessionRole(
            "user",
            manager_id,
            platform_role="user",
            active_role="employee",
        )
        package = dict(cursor.execute(
            "SELECT * FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        ).fetchone())

        assert can_read_record(
            cursor, role, manager_id, organization_id,
            "goithau", "goi_thau", package,
        )

        cursor.execute(
            """DELETE FROM phan_cong_nhan_su
               WHERE organization_id = ? AND id_nhan_vien = ? AND id_muc_tieu = ?""",
            (organization_id, manager_id, package_id),
        )
        assert not can_read_record(
            cursor, role, manager_id, organization_id,
            "goithau", "goi_thau", package,
        )
    finally:
        connection.rollback()
        connection.close()
        database.close()


@pytest.mark.parametrize(
    ("entity", "table_name", "module_name"),
    [
        ("plans", "ke_hoach_lcnt", "kehoach"),
        ("packages", "goi_thau", "goithau"),
        ("contracts", "hop_dong", "hopdong"),
    ],
)
@pytest.mark.parametrize(
    ("active_role", "unrestricted"),
    [("manager", True), ("employee", False)],
)
def test_ai_and_analytics_use_authoritative_visibility_scope_for_all_entities(
    entity,
    table_name,
    module_name,
    active_role,
    unrestricted,
):
    context = AiRequestContext(
        user_id="employee-1",
        organization_id="org-1",
        organization_name="Tổ chức kiểm thử",
        platform_role="user",
        membership_role="manager",
        scope_type="organization",
        active_role=active_role,
        permissions={module_name: "view"},
    )

    actual_sql, actual_parameters = visibility_clause(
        context,
        entity,
        "record",
    )
    expected = VisibilityScope(
        organization_id=context.organization_id,
        user_id=context.user_id,
        unrestricted=unrestricted,
        permissions={module_name: "view"},
    ).live_predicate(table_name, "record")

    assert (actual_sql, actual_parameters) == (
        expected.sql,
        expected.parameters,
    )


def test_active_persona_returns_same_package_ids_across_read_channels(monkeypatch):
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, user_id, unassigned_id = _seed_denied_package(cursor)
        foreign_organization_id, _foreign_user_id, foreign_id = (
            _seed_denied_package(cursor)
        )
        plan_id = cursor.execute(
            "SELECT ke_hoach_id FROM goi_thau WHERE id = ?",
            (unassigned_id,),
        ).fetchone()[0]
        assigned_id = f"package-assigned-{uuid.uuid4().hex}"
        cursor.execute(
            """INSERT INTO goi_thau
               (id, organization_id, id_goc, ke_hoach_id, ten_goi_thau,
                gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc, trang_thai)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREPARING')""",
            (
                assigned_id,
                organization_id,
                assigned_id,
                plan_id,
                "Gói thầu được phân công",
                200_000_000,
                "45 ngày",
                "Ngân sách kiểm thử",
                "Quý III/2026",
                "Tháng 8/2026",
            ),
        )
        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
               (id, organization_id, id_nhan_vien, id_muc_tieu,
                loai_doi_tuong)
               VALUES (?, ?, ?, ?, 'goithau')""",
            (
                f"assignment-{uuid.uuid4().hex}",
                organization_id,
                user_id,
                assigned_id,
            ),
        )

        class BorrowedConnection:
            def cursor(self):
                return connection.cursor()

            def close(self):
                return None

        monkeypatch.setattr(
            pagination_module.database,
            "get_connection",
            lambda: BorrowedConnection(),
        )
        monkeypatch.setattr(
            pagination_module,
            "get_active_org",
            lambda *_args, **_kwargs: organization_id,
        )

        candidates = (assigned_id, unassigned_id, foreign_id)

        def ids_for_channels(role, permissions):
            monkeypatch.setattr(
                pagination_module,
                "verify_session",
                lambda _request: (True, role),
            )
            request = SimpleNamespace(
                query_params={"table": "goithau", "pageSize": "20"},
                cookies={},
                headers={"X-Active-Org": organization_id},
            )
            list_response = pagination_module._paginate_records_blocking(request)
            assert list_response.status_code == 200
            list_ids = {
                item["id"]
                for item in json.loads(list_response.body)["items"]
            }

            detail_ids = set()
            for record_id in candidates:
                row = cursor.execute(
                    """SELECT * FROM goi_thau
                       WHERE organization_id = ? AND id = ?""",
                    (organization_id, record_id),
                ).fetchone()
                if row is not None and can_read_record(
                    cursor,
                    role,
                    user_id,
                    organization_id,
                    "goithau",
                    "goi_thau",
                    dict(row),
                ):
                    detail_ids.add(record_id)

            sync_scope = VisibilityScope.resolve(
                cursor, role, user_id, organization_id
            )
            sync_predicate = sync_scope.live_predicate(
                "goi_thau", "record"
            )
            sync_ids = {
                row[0]
                for row in cursor.execute(
                    "SELECT record.id FROM goi_thau AS record WHERE "  # noqa: S608 - predicate is registry-built
                    + sync_predicate.sql
                    + " AND record.is_latest = 1 AND record.archived_at IS NULL",
                    sync_predicate.parameters,
                ).fetchall()
            }

            context = AiRequestContext(
                user_id=user_id,
                organization_id=organization_id,
                organization_name="Tổ chức kiểm thử",
                platform_role="user",
                membership_role=str(
                    cursor.execute(
                        """SELECT vai_tro_trong_to_chuc
                           FROM thanh_vien_to_chuc
                           WHERE organization_id = ? AND user_id = ?""",
                        (organization_id, user_id),
                    ).fetchone()[0]
                ),
                scope_type="organization",
                active_role=role.active_role,
                permissions=permissions,
            )
            try:
                ai_result = search_workspace_records(
                    cursor,
                    context,
                    {
                        "entity": "packages",
                        "operation": "list",
                        "query": "",
                        "status": "",
                        "packageId": "",
                        "limit": 20,
                    },
                )
                ai_ids = {row["id"] for row in ai_result.records}
            except AiError as error:
                assert error.code == "AI_PERMISSION_DENIED"
                ai_ids = set()

            try:
                clause, parameters = visibility_clause(
                    context, "packages", "record"
                )
                analytics_ids = {
                    row[0]
                    for row in cursor.execute(
                        "SELECT record.id FROM goi_thau AS record WHERE "  # noqa: S608 - clause is fixed by entity registry
                        + clause
                        + " AND record.is_latest = 1 "
                        "AND record.archived_at IS NULL",
                        parameters,
                    ).fetchall()
                }
            except AiError as error:
                assert error.code == "AI_PERMISSION_DENIED"
                analytics_ids = set()

            return {
                "list": list_ids,
                "detail": detail_ids,
                "sync": sync_ids,
                "ai": ai_ids,
                "analytics": analytics_ids,
            }

        def assert_channels(expected, role, permissions):
            observed = ids_for_channels(role, permissions)
            assert observed == {channel: expected for channel in observed}
            assert foreign_id not in set().union(*observed.values())

        cursor.execute(
            """UPDATE thanh_vien_to_chuc
               SET vai_tro_trong_to_chuc = 'manager'
               WHERE organization_id = ? AND user_id = ?""",
            (organization_id, user_id),
        )
        cursor.execute(
            "DELETE FROM ma_tran_phan_quyen WHERE organization_id = ? AND emp_id = ?",
            (organization_id, user_id),
        )
        assert_channels(
            {assigned_id, unassigned_id},
            SessionRole(
                "user", user_id, platform_role="user", active_role="manager"
            ),
            {"goithau": "view"},
        )
        assert_channels(
            {assigned_id},
            SessionRole(
                "user", user_id, platform_role="user", active_role="employee"
            ),
            {"goithau": "view"},
        )

        cursor.execute(
            """UPDATE thanh_vien_to_chuc
               SET vai_tro_trong_to_chuc = 'employee'
               WHERE organization_id = ? AND user_id = ?""",
            (organization_id, user_id),
        )
        cursor.execute(
            """INSERT INTO ma_tran_phan_quyen
               (id, organization_id, emp_id, goithau)
               VALUES (?, ?, ?, 'view')""",
            (f"permission-{uuid.uuid4().hex}", organization_id, user_id),
        )
        employee_role = SessionRole(
            "user", user_id, platform_role="user", active_role="employee"
        )
        assert_channels(
            {assigned_id}, employee_role, {"goithau": "view"}
        )

        cursor.execute(
            "DELETE FROM ma_tran_phan_quyen WHERE organization_id = ? AND emp_id = ?",
            (organization_id, user_id),
        )
        assert_channels(set(), employee_role, {})
        assert foreign_organization_id != organization_id
    finally:
        connection.rollback()
        connection.close()
        database.close()


def test_active_persona_package_parity_through_http_read_endpoints(monkeypatch):
    database = _test_database()
    setup = database.get_connection()
    organization_ids = []
    member_ids = []
    try:
        cursor = setup.cursor()
        organization_id, user_id, unassigned_id = _seed_denied_package(cursor)
        foreign_organization_id, foreign_user_id, foreign_id = (
            _seed_denied_package(cursor)
        )
        organization_ids.extend((organization_id, foreign_organization_id))
        plan_id = cursor.execute(
            "SELECT ke_hoach_id FROM goi_thau WHERE id = ?",
            (unassigned_id,),
        ).fetchone()[0]
        assigned_id = f"package-http-assigned-{uuid.uuid4().hex}"
        cursor.execute(
            """INSERT INTO goi_thau
                   (id, organization_id, id_goc, ke_hoach_id, ten_goi_thau,
                    gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                    thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc, trang_thai)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREPARING')""",
            (
                assigned_id,
                organization_id,
                assigned_id,
                plan_id,
                "Gói thầu HTTP được phân công",
                345_000_000,
                "60 ngày",
                "Ngân sách kiểm thử",
                "Quý III/2026",
                "Tháng 8/2026",
            ),
        )
        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
                   (id, organization_id, id_nhan_vien, id_muc_tieu,
                    loai_doi_tuong)
               VALUES (?, ?, ?, ?, 'goithau')""",
            (
                f"assignment-http-{uuid.uuid4().hex}",
                organization_id,
                user_id,
                assigned_id,
            ),
        )
        member_ids.extend(
            row[0]
            for row in cursor.execute(
                """SELECT user_id FROM thanh_vien_to_chuc
                   WHERE organization_id IN (?, ?)""",
                (organization_id, foreign_organization_id),
            ).fetchall()
        )
        assert user_id in member_ids
        assert foreign_user_id in member_ids
        setup.commit()

        current_role = {"value": None}

        async def inline_database_read(function, *args, **kwargs):
            kwargs.pop("timeout_seconds", None)
            return function(*args, **kwargs)

        for module in (pagination_module, read_service_module):
            monkeypatch.setattr(module, "database", database)
            monkeypatch.setattr(
                module,
                "verify_session",
                lambda _request: (True, current_role["value"]),
            )
            monkeypatch.setattr(
                module,
                "get_active_org",
                lambda *_args, **_kwargs: organization_id,
            )
            monkeypatch.setattr(
                module,
                "run_database_read",
                inline_database_read,
            )

        app = Starlette(routes=sync_http_routes(Route))
        candidates = (assigned_id, unassigned_id, foreign_id)

        def ids_for_channels(client, role, permissions):
            current_role["value"] = role
            headers = {"X-Active-Org": organization_id}
            list_response = client.get(
                "/api/paginate",
                params={"table": "goithau", "pageSize": "20"},
                headers=headers,
            )
            assert list_response.status_code == 200
            list_items = list_response.json()["items"]
            list_ids = {item["id"] for item in list_items}

            detail_ids = set()
            detail_items = {}
            for record_id in candidates:
                response = client.get(
                    "/api/record",
                    params={"table": "goithau", "id": record_id},
                    headers=headers,
                )
                if response.status_code == 200:
                    item = response.json()["item"]
                    detail_ids.add(item["id"])
                    detail_items[item["id"]] = item
                else:
                    assert response.status_code in {403, 404}

            sync_response = client.get(
                "/api/get-all-data",
                params={
                    "tables": "goithau",
                    "since": "2000-01-01 00:00:00",
                },
                headers=headers,
            )
            assert sync_response.status_code == 200
            sync_items = sync_response.json()["goithau"]
            sync_ids = {item["id"] for item in sync_items}

            channel_connection = database.get_connection()
            try:
                channel_cursor = channel_connection.cursor()
                membership_role = channel_cursor.execute(
                    """SELECT vai_tro_trong_to_chuc
                       FROM thanh_vien_to_chuc
                       WHERE organization_id = ? AND user_id = ?""",
                    (organization_id, user_id),
                ).fetchone()[0]
                context = AiRequestContext(
                    user_id=user_id,
                    organization_id=organization_id,
                    organization_name="Tổ chức kiểm thử",
                    platform_role="user",
                    membership_role=str(membership_role),
                    scope_type="organization",
                    active_role=role.active_role,
                    permissions=permissions,
                )
                try:
                    ai_result = search_workspace_records(
                        channel_cursor,
                        context,
                        {
                            "entity": "packages",
                            "operation": "list",
                            "query": "",
                            "status": "",
                            "packageId": "",
                            "limit": 20,
                        },
                    )
                    ai_ids = {row["id"] for row in ai_result.records}
                except AiError as error:
                    assert error.code == "AI_PERMISSION_DENIED"
                    ai_ids = set()

                try:
                    clause, parameters = visibility_clause(
                        context,
                        "packages",
                        "record",
                    )
                    analytics_ids = {
                        row[0]
                        for row in channel_cursor.execute(
                            "SELECT record.id FROM goi_thau AS record WHERE "  # noqa: S608 - predicate is registry-built
                            + clause
                            + " AND record.is_latest = 1 "
                            "AND record.archived_at IS NULL",
                            parameters,
                        ).fetchall()
                    }
                except AiError as error:
                    assert error.code == "AI_PERMISSION_DENIED"
                    analytics_ids = set()
            finally:
                channel_connection.close()

            if assigned_id in detail_items:
                assert str(detail_items[assigned_id]["giaGoiThau"]) == "345000000"
                assert str(next(
                    item for item in list_items if item["id"] == assigned_id
                )["giaGoiThau"]) == "345000000"
                assert str(next(
                    item for item in sync_items if item["id"] == assigned_id
                )["giaGoiThau"]) == "345000000"

            return {
                "list": list_ids,
                "detail": detail_ids,
                "sync": sync_ids,
                "ai": ai_ids,
                "analytics": analytics_ids,
            }

        def assert_channels(client, expected, role, permissions):
            observed = ids_for_channels(client, role, permissions)
            assert observed == {channel: expected for channel in observed}
            assert foreign_id not in set().union(*observed.values())

        with TestClient(app) as client:
            control = database.get_connection()
            try:
                control.execute(
                    """UPDATE thanh_vien_to_chuc
                       SET vai_tro_trong_to_chuc = 'manager'
                       WHERE organization_id = ? AND user_id = ?""",
                    (organization_id, user_id),
                )
                control.execute(
                    """DELETE FROM ma_tran_phan_quyen
                       WHERE organization_id = ? AND emp_id = ?""",
                    (organization_id, user_id),
                )
                control.commit()
            finally:
                control.close()
            assert_channels(
                client,
                {assigned_id, unassigned_id},
                SessionRole(
                    "user",
                    user_id,
                    platform_role="user",
                    active_role="manager",
                ),
                {"goithau": "view"},
            )
            assert_channels(
                client,
                {assigned_id},
                SessionRole(
                    "user",
                    user_id,
                    platform_role="user",
                    active_role="employee",
                ),
                {"goithau": "view"},
            )

            control = database.get_connection()
            try:
                control.execute(
                    """UPDATE thanh_vien_to_chuc
                       SET vai_tro_trong_to_chuc = 'employee'
                       WHERE organization_id = ? AND user_id = ?""",
                    (organization_id, user_id),
                )
                control.execute(
                    """INSERT INTO ma_tran_phan_quyen
                           (id, organization_id, emp_id, goithau)
                       VALUES (?, ?, ?, 'view')""",
                    (
                        f"permission-http-{uuid.uuid4().hex}",
                        organization_id,
                        user_id,
                    ),
                )
                control.commit()
            finally:
                control.close()
            employee_role = SessionRole(
                "user",
                user_id,
                platform_role="user",
                active_role="employee",
            )
            assert_channels(
                client,
                {assigned_id},
                employee_role,
                {"goithau": "view"},
            )

            control = database.get_connection()
            try:
                control.execute(
                    """DELETE FROM ma_tran_phan_quyen
                       WHERE organization_id = ? AND emp_id = ?""",
                    (organization_id, user_id),
                )
                control.commit()
            finally:
                control.close()
            assert_channels(client, set(), employee_role, {})
    finally:
        setup.close()
        if organization_ids:
            cleanup = database.get_connection()
            try:
                for organization_id in organization_ids:
                    cleanup.execute(
                        "DELETE FROM phan_cong_nhan_su WHERE organization_id = ?",
                        (organization_id,),
                    )
                    cleanup.execute(
                        "DELETE FROM goi_thau WHERE organization_id = ?",
                        (organization_id,),
                    )
                    cleanup.execute(
                        "DELETE FROM ke_hoach_lcnt WHERE organization_id = ?",
                        (organization_id,),
                    )
                    cleanup.execute(
                        "DELETE FROM chu_dau_tu WHERE organization_id = ?",
                        (organization_id,),
                    )
                    cleanup.execute(
                        "DELETE FROM ma_tran_phan_quyen WHERE organization_id = ?",
                        (organization_id,),
                    )
                    cleanup.execute(
                        "DELETE FROM thanh_vien_to_chuc WHERE organization_id = ?",
                        (organization_id,),
                    )
                    cleanup.execute(
                        "DELETE FROM to_chuc WHERE id = ?",
                        (organization_id,),
                    )
                for member_id in set(member_ids):
                    cleanup.execute(
                        "DELETE FROM tai_khoan WHERE id = ?",
                        (member_id,),
                    )
                cleanup.commit()
            finally:
                cleanup.close()
        database.close()


@pytest.mark.parametrize(
    ("membership_role", "keep_permission_matrix"),
    [
        ("employee", True),
        ("manager", False),
    ],
)
def test_paginate_package_visibility_has_bounded_authorization_queries(
    monkeypatch,
    membership_role,
    keep_permission_matrix,
):
    """Timeline pagination must not resolve every module one query at a time."""

    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, user_id, package_id = _seed_denied_package(cursor)
        plan_id = cursor.execute(
            "SELECT ke_hoach_id FROM goi_thau WHERE id = ?",
            (package_id,),
        ).fetchone()[0]
        cursor.execute(
            """UPDATE thanh_vien_to_chuc
                  SET vai_tro_trong_to_chuc = ?
                WHERE organization_id = ? AND user_id = ?""",
            (membership_role, organization_id, user_id),
        )
        cursor.execute(
            """UPDATE phan_cong_nhan_su
                  SET id_nhan_vien = ?
                WHERE organization_id = ? AND id_muc_tieu = ?""",
            (user_id, organization_id, package_id),
        )
        if not keep_permission_matrix:
            cursor.execute(
                """DELETE FROM ma_tran_phan_quyen
                    WHERE organization_id = ? AND emp_id = ?""",
                (organization_id, user_id),
            )

        query_count = {"value": 0}

        class CountingCursor:
            def __init__(self, delegate):
                self.delegate = delegate

            def execute(self, statement, parameters=None):
                query_count["value"] += 1
                self.delegate.execute(statement, parameters)
                return self

            def fetchone(self):
                return self.delegate.fetchone()

            def fetchall(self):
                return self.delegate.fetchall()

            def __iter__(self):
                return iter(self.delegate)

        class BorrowedConnection:
            def cursor(self):
                return CountingCursor(connection.cursor())

            def close(self):
                return None

        class CountingDatabase:
            def get_connection(self):
                return BorrowedConnection()

        async def inline_database_read(function, *args, **kwargs):
            kwargs.pop("timeout_seconds", None)
            return function(*args, **kwargs)

        role = SessionRole(
            "user",
            user_id,
            platform_role="user",
            active_role="employee",
        )
        monkeypatch.setattr(pagination_module, "database", CountingDatabase())
        monkeypatch.setattr(
            pagination_module,
            "verify_session",
            lambda _request: (True, role),
        )
        monkeypatch.setattr(
            pagination_module,
            "get_active_org",
            lambda *_args, **_kwargs: organization_id,
        )
        monkeypatch.setattr(
            pagination_module,
            "run_database_read",
            inline_database_read,
        )

        app = Starlette(
            routes=[Route("/api/paginate", pagination_module.paginate_records)]
        )
        with TestClient(app) as client:
            response = client.get(
                "/api/paginate",
                params={
                    "table": "goithau",
                    "page": "1",
                    "pageSize": "200",
                    "search": "",
                    "keHoachId": plan_id,
                },
                headers={"X-Active-Org": organization_id},
            )

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["items"]] == [package_id]
        assert str(response.json()["items"][0]["giaGoiThau"]) == "100000000"
        assert query_count["value"] <= 20
    finally:
        connection.rollback()
        connection.close()
        database.close()


def test_legacy_sensitive_read_grant_is_inert_for_record_projection():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, _package_id = _seed_denied_package(cursor)
        role = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )
        _insert_document_export_capabilities(
            cursor, organization_id, employee_id, (0, 0, 0)
        )
        _insert_sensitive_read_capabilities(
            cursor, organization_id, employee_id, (1, 1, 1)
        )

        policy = resolve_sensitive_read_policy(
            cursor,
            role,
            employee_id,
            organization_id,
            table_names={"chuyen_gia", "nha_thau"},
        )

        assert policy.can_view_expert_details is True
        assert policy.can_view_contractor_financials is True
        assert policy.can_view_signature_images is True
    finally:
        connection.rollback()
        connection.close()
        database.close()


@pytest.mark.parametrize(
    ("grants", "expected"),
    [
        ((0, 0, 0), (False, False, False)),
        ((1, 0, 0), (True, False, False)),
        ((0, 1, 0), (False, True, False)),
        ((0, 0, 1), (False, False, True)),
        ((1, 1, 0), (True, True, False)),
        ((1, 0, 1), (True, False, True)),
        ((0, 1, 1), (False, True, True)),
        ((1, 1, 1), (True, True, True)),
    ],
)
def test_employee_word_context_enforces_each_stored_capability_combination(
    grants,
    expected,
):
    connection = _word_policy_database()
    try:
        cursor = connection.cursor()
        organization_id, employee_id = _seed_word_policy_member(cursor)
        _insert_document_export_capabilities(
            cursor, organization_id, employee_id, grants
        )
        role = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )

        capabilities = resolve_document_export_capabilities(
            cursor, role, employee_id, organization_id
        )
        assert tuple(capabilities.as_dict().values()) == expected

        projected = project_docx_context(
            "result",
            {
                "nha_thau": [
                    {
                        "ten_nha_thau": "Nhà thầu kiểm thử",
                        "so_tai_khoan": "0123456789",
                        "anh_dau": "images/nha_thau/stamp.webp",
                    }
                ],
                "to_chuyen_gia": [
                    {
                        "ho_ten": "Chuyên gia kiểm thử",
                        "so_cccd": "012345678901",
                        "anh_chu_ky": "images/chuyen_gia/signature.webp",
                    }
                ],
            },
            capabilities,
        )
        contractor = projected["nha_thau"][0]
        expert = projected["to_chuyen_gia"][0]
        assert ("so_tai_khoan" in contractor) is expected[0]
        assert ("so_cccd" in expert) is expected[1]
        assert ("anh_dau" in contractor) is expected[2]
        assert ("anh_chu_ky" in expert) is expected[2]
    finally:
        connection.close()


def test_manager_inherits_all_word_capabilities_despite_stored_denies():
    connection = _word_policy_database()
    try:
        cursor = connection.cursor()
        organization_id, manager_id = _seed_word_policy_member(
            cursor, membership_role="manager"
        )
        _insert_document_export_capabilities(
            cursor, organization_id, manager_id, (0, 0, 0)
        )
        role = SessionRole(
            "user",
            manager_id,
            platform_role="user",
            active_role="manager",
        )

        capabilities = resolve_document_export_capabilities(
            cursor, role, manager_id, organization_id
        )

        assert capabilities.as_dict() == {
            "financial": True,
            "identity": True,
            "signature": True,
        }
    finally:
        connection.close()


def test_employee_word_capabilities_are_scoped_to_the_active_organization():
    connection = _word_policy_database()
    try:
        cursor = connection.cursor()
        first_organization_id, employee_id = _seed_word_policy_member(cursor)
        second_organization_id = f"org-word-{uuid.uuid4().hex}"
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (second_organization_id, "Tổ chức Word thứ hai"),
        )
        cursor.execute(
            """INSERT INTO thanh_vien_to_chuc
               (user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su)
               VALUES (?, ?, 'employee', 'Employee')""",
            (employee_id, second_organization_id),
        )
        _enable_organization_word_export(cursor, second_organization_id)
        _insert_document_export_capabilities(
            cursor, first_organization_id, employee_id, (0, 0, 0)
        )
        _insert_document_export_capabilities(
            cursor, second_organization_id, employee_id, (1, 1, 1)
        )
        role = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )

        first = resolve_document_export_capabilities(
            cursor, role, employee_id, first_organization_id
        )
        second = resolve_document_export_capabilities(
            cursor, role, employee_id, second_organization_id
        )

        assert first.as_dict() == {
            "financial": False,
            "identity": False,
            "signature": False,
        }
        assert second.as_dict() == {
            "financial": True,
            "identity": True,
            "signature": True,
        }
    finally:
        connection.close()
