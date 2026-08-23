import json
import uuid

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.auth.auth_helper import SessionRole
import backend.procurement_import.routes as procurement_routes
from backend.procurement_import.routes import procurement_import_routes
from backend.sync.api import sync_http_routes
import backend.sync.pagination as pagination
import backend.sync.read_service as read_service
from tests.test_sync_conflict_authorization import (
    _seed_denied_package,
    _test_database,
)


async def _inline_blocking(function, *args, **kwargs):
    kwargs.pop("timeout_seconds", None)
    return function(*args, **kwargs)


def _delete_seeded_workspace(database, organization_id):
    cleanup = database.get_connection()
    try:
        user_ids = [
            row[0]
            for row in cleanup.execute(
                "SELECT user_id FROM thanh_vien_to_chuc WHERE organization_id = ?",
                (organization_id,),
            ).fetchall()
        ]
        for table in (
            "procurement_import_operation",
            "phan_cong_nhan_su",
            "goi_thau",
            "ke_hoach_lcnt",
            "chu_dau_tu",
            "ma_tran_phan_quyen",
            "thanh_vien_to_chuc",
        ):
            cleanup.execute(
                f"DELETE FROM {table} WHERE organization_id = ?",  # noqa: S608 - fixed test allowlist
                (organization_id,),
            )
        cleanup.execute("DELETE FROM to_chuc WHERE id = ?", (organization_id,))
        for user_id in user_ids:
            cleanup.execute("DELETE FROM tai_khoan WHERE id = ?", (user_id,))
        cleanup.commit()
    finally:
        cleanup.close()


def _seed_notice_operation(
    cursor,
    organization_id,
    package_id,
    actor_id,
):
    operation_id = f"operation-read-scope-{uuid.uuid4().hex}"
    manifest = [{
        "importKind": "NOTICE",
        "revisionId": "notice-01",
        "status": "FAILED",
        "canonicalRevision": {
            "noticeNo": "IB2600000001",
            "relationship": {},
        },
        "targetPackageRootId": package_id,
    }]
    cursor.execute(
        """INSERT INTO procurement_import_operation
               (id, organization_id, provider, family_key, mode, status,
                next_revision_index, total_revisions, bundle_digest,
                revision_results_json, idempotency_key, request_hash,
                actor_user_id)
           VALUES (?, ?, 'MUASAMCONG', 'IB2600000001', 'ALL', 'FAILED',
                   0, 1, ?, ?, ?, ?, ?)""",
        (
            operation_id,
            organization_id,
            "sha256:" + "a" * 64,
            json.dumps(manifest),
            f"operation-key-{uuid.uuid4().hex}",
            "b" * 64,
            actor_id,
        ),
    )
    return operation_id


def _seed_plan_operation(cursor, organization_id, family_no, actor_id):
    operation_id = f"plan-operation-read-scope-{uuid.uuid4().hex}"
    manifest = [{
        "revisionId": "plan-01",
        "status": "FAILED",
        "canonicalRevision": {"familyNo": family_no},
    }]
    cursor.execute(
        """INSERT INTO procurement_import_operation
               (id, organization_id, provider, family_key, mode, status,
                next_revision_index, total_revisions, bundle_digest,
                revision_results_json, idempotency_key, request_hash,
                actor_user_id)
           VALUES (?, ?, 'MUASAMCONG', ?, 'ALL', 'FAILED', 0, 1, ?, ?, ?, ?, ?)""",
        (
            operation_id,
            organization_id,
            family_no,
            "sha256:" + "c" * 64,
            json.dumps(manifest),
            f"plan-operation-key-{uuid.uuid4().hex}",
            "d" * 64,
            actor_id,
        ),
    )
    return operation_id


def _procurement_operation_client(
    monkeypatch,
    database,
    organization_id,
    current_role,
):
    monkeypatch.setattr(procurement_routes, "database", database)
    monkeypatch.setattr(
        procurement_routes,
        "verify_session",
        lambda _request: (True, current_role["value"]),
    )
    monkeypatch.setattr(
        procurement_routes,
        "get_active_org",
        lambda *_args, **_kwargs: organization_id["value"],
    )
    monkeypatch.setattr(
        procurement_routes,
        "run_blocking_io",
        _inline_blocking,
    )
    return TestClient(Starlette(routes=procurement_import_routes(Route)))


def test_operation_get_denies_employee_outside_notice_target_scope(monkeypatch):
    database = _test_database()
    setup = database.get_connection()
    organization_id = None
    try:
        cursor = setup.cursor()
        organization_id, employee_id, package_id = _seed_denied_package(cursor)
        actor_id = cursor.execute(
            """SELECT user_id FROM thanh_vien_to_chuc
               WHERE organization_id = ? AND user_id != ? LIMIT 1""",
            (organization_id, employee_id),
        ).fetchone()[0]
        operation_id = _seed_notice_operation(
            cursor,
            organization_id,
            package_id,
            actor_id,
        )
        setup.commit()

        role = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )
        client = _procurement_operation_client(
            monkeypatch,
            database,
            {"value": organization_id},
            {"value": role},
        )
        with client:
            response = client.get(
                f"/api/procurement/imports/operations/{operation_id}",
                headers={"X-Active-Org": organization_id},
            )

        assert response.status_code == 403
        assert response.json()["code"] == "ORGANIZATION_ACCESS_DENIED"
    finally:
        setup.close()
        if organization_id:
            _delete_seeded_workspace(database, organization_id)
        database.close()


def test_operation_get_follows_module_active_persona_and_target_scope(
    monkeypatch,
):
    database = _test_database()
    setup = database.get_connection()
    organization_id = None
    try:
        cursor = setup.cursor()
        organization_id, employee_id, package_id = _seed_denied_package(cursor)
        actor_id = cursor.execute(
            """SELECT user_id FROM thanh_vien_to_chuc
               WHERE organization_id = ? AND user_id != ? LIMIT 1""",
            (organization_id, employee_id),
        ).fetchone()[0]
        operation_id = _seed_notice_operation(
            cursor,
            organization_id,
            package_id,
            actor_id,
        )
        setup.commit()

        active_organization = {"value": organization_id}
        current_role = {"value": SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )}
        client = _procurement_operation_client(
            monkeypatch,
            database,
            active_organization,
            current_role,
        )

        def get_status():
            return client.get(
                f"/api/procurement/imports/operations/{operation_id}",
                headers={"X-Active-Org": active_organization["value"]},
            ).status_code

        with client:
            assert get_status() == 403

            control = database.get_connection()
            try:
                control.execute(
                    """INSERT INTO phan_cong_nhan_su
                           (id, organization_id, id_nhan_vien, id_muc_tieu,
                            loai_doi_tuong)
                       VALUES (?, ?, ?, ?, 'goithau')""",
                    (
                        f"assignment-reader-{uuid.uuid4().hex}",
                        organization_id,
                        employee_id,
                        package_id,
                    ),
                )
                control.commit()
            finally:
                control.close()
            assert get_status() == 200  # Non-actor but in target scope.

            control = database.get_connection()
            try:
                control.execute(
                    "DELETE FROM phan_cong_nhan_su WHERE organization_id = ? AND id_nhan_vien = ?",
                    (organization_id, employee_id),
                )
                control.execute(
                    """UPDATE thanh_vien_to_chuc
                          SET vai_tro_trong_to_chuc = 'manager'
                        WHERE organization_id = ? AND user_id = ?""",
                    (organization_id, employee_id),
                )
                control.execute(
                    "DELETE FROM ma_tran_phan_quyen WHERE organization_id = ? AND emp_id = ?",
                    (organization_id, employee_id),
                )
                control.commit()
            finally:
                control.close()
            current_role["value"] = SessionRole(
                "user",
                employee_id,
                platform_role="user",
                active_role="manager",
            )
            assert get_status() == 200

            current_role["value"] = SessionRole(
                "user",
                employee_id,
                platform_role="user",
                active_role="employee",
            )
            assert get_status() == 403

            control = database.get_connection()
            try:
                control.execute(
                    """UPDATE thanh_vien_to_chuc
                          SET vai_tro_trong_to_chuc = 'employee'
                        WHERE organization_id = ? AND user_id = ?""",
                    (organization_id, employee_id),
                )
                control.execute(
                    """INSERT INTO phan_cong_nhan_su
                           (id, organization_id, id_nhan_vien, id_muc_tieu,
                            loai_doi_tuong)
                       VALUES (?, ?, ?, ?, 'goithau')""",
                    (
                        f"assignment-reader-revoked-{uuid.uuid4().hex}",
                        organization_id,
                        employee_id,
                        package_id,
                    ),
                )
                control.commit()
            finally:
                control.close()
            assert get_status() == 403  # Assignment alone cannot replace module view.

            active_organization["value"] = f"foreign-{uuid.uuid4().hex}"
            assert get_status() == 404
    finally:
        setup.close()
        if organization_id:
            _delete_seeded_workspace(database, organization_id)
        database.close()


def test_plan_operation_get_uses_plan_scope_and_module_only_without_target(
    monkeypatch,
):
    database = _test_database()
    setup = database.get_connection()
    organization_id = None
    try:
        cursor = setup.cursor()
        organization_id, employee_id, package_id = _seed_denied_package(cursor)
        actor_id = cursor.execute(
            """SELECT user_id FROM thanh_vien_to_chuc
               WHERE organization_id = ? AND user_id != ? LIMIT 1""",
            (organization_id, employee_id),
        ).fetchone()[0]
        family_no = f"PL{uuid.uuid4().hex[:10].upper()}"
        cursor.execute(
            """UPDATE ke_hoach_lcnt SET ma_ke_hoach = ?
                WHERE organization_id = ?""",
            (family_no, organization_id),
        )
        cursor.execute(
            """UPDATE ma_tran_phan_quyen SET kehoach = 'view'
                WHERE organization_id = ? AND emp_id = ?""",
            (organization_id, employee_id),
        )
        scoped_operation_id = _seed_plan_operation(
            cursor,
            organization_id,
            family_no,
            actor_id,
        )
        no_target_operation_id = _seed_plan_operation(
            cursor,
            organization_id,
            f"PL{uuid.uuid4().hex[:10].upper()}",
            actor_id,
        )
        setup.commit()

        current_role = {"value": SessionRole(
            "user", employee_id, platform_role="user", active_role="employee"
        )}
        client = _procurement_operation_client(
            monkeypatch,
            database,
            {"value": organization_id},
            current_role,
        )
        with client:
            scoped_url = (
                f"/api/procurement/imports/operations/{scoped_operation_id}"
            )
            no_target_url = (
                f"/api/procurement/imports/operations/{no_target_operation_id}"
            )
            assert client.get(scoped_url).status_code == 403
            assert client.get(no_target_url).status_code == 200

            control = database.get_connection()
            try:
                control.execute(
                    """INSERT INTO phan_cong_nhan_su
                           (id, organization_id, id_nhan_vien, id_muc_tieu,
                            loai_doi_tuong)
                       VALUES (?, ?, ?, ?, 'goithau')""",
                    (
                        f"assignment-plan-reader-{uuid.uuid4().hex}",
                        organization_id,
                        employee_id,
                        package_id,
                    ),
                )
                control.commit()
            finally:
                control.close()
            assert client.get(scoped_url).status_code == 200

            control = database.get_connection()
            try:
                control.execute(
                    """DELETE FROM ma_tran_phan_quyen
                        WHERE organization_id = ? AND emp_id = ?""",
                    (organization_id, employee_id),
                )
                control.commit()
            finally:
                control.close()
            assert client.get(scoped_url).status_code == 403
            assert client.get(no_target_url).status_code == 403
    finally:
        setup.close()
        if organization_id:
            _delete_seeded_workspace(database, organization_id)
        database.close()


def test_list_and_detail_all_versions_contain_only_individually_visible_versions(
    monkeypatch,
):
    database = _test_database()
    setup = database.get_connection()
    organization_id = None
    try:
        cursor = setup.cursor()
        organization_id, employee_id, current_package_id = _seed_denied_package(
            cursor
        )
        plan_id = cursor.execute(
            "SELECT ke_hoach_id FROM goi_thau WHERE id = ?",
            (current_package_id,),
        ).fetchone()[0]
        historical_package_id = f"package-visible-history-{uuid.uuid4().hex}"
        cursor.execute(
            "UPDATE goi_thau SET phien_ban = 2 WHERE id = ?",
            (current_package_id,),
        )
        cursor.execute(
            """INSERT INTO goi_thau
                   (id, organization_id, id_goc, phien_ban, is_latest,
                    ke_hoach_id, ten_goi_thau, gia_goi_thau,
                    thoi_gian_thuc_hien, nguon_von, thoi_gian_to_chuc,
                    thoi_gian_bat_dau_to_chuc, trang_thai)
               VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, 'PREPARING')""",
            (
                historical_package_id,
                organization_id,
                current_package_id,
                plan_id,
                "Gói thầu phiên bản lịch sử không được phân công",
                90_000_000,
                "20 ngày",
                "Ngân sách kiểm thử",
                "Quý II/2026",
                "Tháng 6/2026",
            ),
        )
        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
                   (id, organization_id, id_nhan_vien, id_muc_tieu,
                    loai_doi_tuong)
               VALUES (?, ?, ?, ?, 'goithau')""",
            (
                f"assignment-visible-history-{uuid.uuid4().hex}",
                organization_id,
                employee_id,
                current_package_id,
            ),
        )
        setup.commit()

        current_role = {"value": SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )}
        async def inline_database_read(function, *args, **kwargs):
            kwargs.pop("timeout_seconds", None)
            return function(*args, **kwargs)

        for module in (read_service, pagination):
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

        with TestClient(app) as client:
            detail_response = client.get(
                "/api/record",
                params={"table": "goithau", "id": current_package_id},
                headers={"X-Active-Org": organization_id},
            )
            list_response = client.get(
                "/api/paginate",
                params={"table": "goithau", "pageSize": "20"},
                headers={"X-Active-Org": organization_id},
            )

        expected_versions = [
            {"id": current_package_id, "phienBan": 2}
        ]
        assert detail_response.status_code == 200
        assert detail_response.json()["item"]["allVersions"] == expected_versions
        assert list_response.status_code == 200
        listed = next(
            item
            for item in list_response.json()["items"]
            if item["id"] == current_package_id
        )
        assert listed["allVersions"] == expected_versions

        control = database.get_connection()
        try:
            control.execute(
                """UPDATE thanh_vien_to_chuc
                      SET vai_tro_trong_to_chuc = 'manager'
                    WHERE organization_id = ? AND user_id = ?""",
                (organization_id, employee_id),
            )
            control.commit()
        finally:
            control.close()
        current_role["value"] = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="manager",
        )
        with TestClient(app) as client:
            manager_response = client.get(
                "/api/record",
                params={"table": "goithau", "id": current_package_id},
                headers={"X-Active-Org": organization_id},
            )
        assert manager_response.status_code == 200
        assert manager_response.json()["item"]["allVersions"] == [
            {"id": current_package_id, "phienBan": 2},
            {"id": historical_package_id, "phienBan": 1},
        ]

        current_role["value"] = SessionRole(
            "user",
            employee_id,
            platform_role="user",
            active_role="employee",
        )
        with TestClient(app) as client:
            specialist_response = client.get(
                "/api/record",
                params={"table": "goithau", "id": current_package_id},
                headers={"X-Active-Org": organization_id},
            )
        assert specialist_response.status_code == 200
        assert specialist_response.json()["item"]["allVersions"] == expected_versions
    finally:
        setup.close()
        if organization_id:
            _delete_seeded_workspace(database, organization_id)
        database.close()
