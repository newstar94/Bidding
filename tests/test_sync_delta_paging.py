import json
from types import SimpleNamespace

import pytest

from backend.auth.auth_helper import SessionRole
from backend.shared.sensitive_data import SensitiveReadPolicy
from backend.sync import delta_paging, visibility_epoch
from backend.sync.delta_paging import (
    DeltaCursorError,
    _load_candidates,
    _project_candidate,
    decode_delta_cursor,
    encode_delta_cursor,
)
from backend.sync.mapper import save_child_payloads
from backend.sync.visibility_scope import VisibilityScope
from backend.sync.read_service import _load_visible_deletions
from tests.test_sync_conflict_authorization import _seed_denied_package, _test_database


def _cursor(**overrides):
    values = {
        "signing_key": "session-secret",
        "organization_id": "org-a",
        "user_id": "user-a",
        "after_version": 10,
        "through_version": 50,
        "marker": (20, "upsert", "goithau", "package-1"),
        "expires_at": 2_000,
    }
    values.update(overrides)
    return encode_delta_cursor(**values)


def test_delta_cursor_round_trips_fixed_snapshot_and_marker():
    decoded = decode_delta_cursor(
        _cursor(),
        signing_key="session-secret",
        organization_id="org-a",
        user_id="user-a",
        now=1_000,
    )
    assert decoded["after"] == 10
    assert decoded["through"] == 50
    assert decoded["marker"] == (20, "upsert", "goithau", "package-1")


@pytest.mark.parametrize(
    "changes",
    [
        {"signing_key": "other"},
        {"organization_id": "org-b"},
        {"user_id": "user-b"},
    ],
)
def test_delta_cursor_rejects_tamper_and_cross_scope_replay(changes):
    arguments = {
        "signing_key": "session-secret",
        "organization_id": "org-a",
        "user_id": "user-a",
        "now": 1_000,
    }
    arguments.update(changes)
    with pytest.raises(DeltaCursorError):
        decode_delta_cursor(_cursor(), **arguments)


def test_delta_cursor_expires():
    with pytest.raises(DeltaCursorError, match="CURSOR_EXPIRED"):
        decode_delta_cursor(
            _cursor(),
            signing_key="session-secret",
            organization_id="org-a",
            user_id="user-a",
            now=2_001,
        )


def test_visibility_scope_pushes_assignment_and_module_denial_into_sql():
    scope = VisibilityScope(
        organization_id="org-a",
        user_id="employee-a",
        unrestricted=False,
        permissions={"goithau": "view"},
    )

    package = scope.live_predicate("goi_thau", "source_row")
    opening = scope.live_predicate("thong_tin_mo_thau", "source_row")
    denied = scope.live_predicate("chuyen_gia", "source_row")

    assert "pc.id_muc_tieu = source_row.id" in package.sql
    assert "pc.id_muc_tieu = source_row.goi_thau_id" in opening.sql
    assert package.parameters == ("org-a", "employee-a")
    assert opening.parameters == ("org-a", "employee-a")
    assert denied.sql == "FALSE"
    assert denied.parameters == ()


def test_visibility_policy_v3_token_is_rejected_by_v4_delta_read(monkeypatch):
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
        monkeypatch.setattr(visibility_epoch, "VISIBILITY_POLICY_VERSION", 3)
        old_token = visibility_epoch.build_visibility_token(
            cursor, organization_id, employee_id, role
        )
        assert old_token == visibility_epoch.build_visibility_token(
            cursor, organization_id, employee_id, role
        )

        monkeypatch.setattr(visibility_epoch, "VISIBILITY_POLICY_VERSION", 4)
        current_token = visibility_epoch.build_visibility_token(
            cursor, organization_id, employee_id, role
        )
        assert current_token != old_token
        assert current_token == visibility_epoch.build_visibility_token(
            cursor, organization_id, employee_id, role
        )

        class _Cursor:
            def execute(self, _sql, _params=()):
                return self

            def fetchone(self):
                return (10,)

        class _Connection:
            def cursor(self):
                return _Cursor()

            def close(self):
                pass

        monkeypatch.setattr(
            delta_paging, "verify_session", lambda _request: (True, role)
        )
        monkeypatch.setattr(
            delta_paging,
            "get_active_org",
            lambda _request, _user_id, cursor=None: organization_id,
        )
        monkeypatch.setattr(
            delta_paging,
            "database",
            SimpleNamespace(get_connection=lambda: _Connection()),
        )
        monkeypatch.setattr(
            delta_paging,
            "build_visibility_token",
            lambda *_args, **_kwargs: current_token,
        )
        monkeypatch.setattr(
            delta_paging.VisibilityScope,
            "resolve",
            classmethod(lambda cls, *_args: SimpleNamespace()),
        )
        response = delta_paging._read_delta_page_blocking(
            SimpleNamespace(
                query_params={
                    "after_version": "1",
                    "visibility_token": old_token,
                },
                cookies={"session_token": "test-session"},
            )
        )

        assert response.status_code == 409
        assert json.loads(response.body) == {
            "code": "SYNC_VISIBILITY_RESET_REQUIRED",
            "requiresFullSync": True,
        }
    finally:
        connection.rollback()
        connection.close()
        database.close()


def test_full_refresh_projection_keeps_assigned_package_and_child_only():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_b = _seed_denied_package(cursor)
        package_a = f"assigned-{package_b}"
        cursor.execute(
            """INSERT INTO goi_thau
               (id, organization_id, id_goc, ke_hoach_id, ten_goi_thau,
                gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc, trang_thai)
               SELECT ?, organization_id, ?, ke_hoach_id, 'Assigned package',
                      gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                      thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc, trang_thai
                 FROM goi_thau WHERE organization_id = ? AND id = ?""",
            (package_a, package_a, organization_id, package_b),
        )
        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
               (id, organization_id, id_nhan_vien, id_muc_tieu,
                loai_doi_tuong)
               VALUES (?, ?, ?, ?, 'goithau')""",
            (f"assignment-{package_a}", organization_id, employee_id, package_a),
        )
        for suffix, package_id in (("a", package_a), ("b", package_b)):
            cursor.execute(
                """INSERT INTO goi_thau_hang_hoa
                   (id, organization_id, goi_thau_id, ma_hang_hoa,
                    ten_hang_hoa, don_vi_tinh, so_luong)
                   VALUES (?, ?, ?, ?, ?, 'unit', 1)""",
                (
                    f"goods-{suffix}-{package_b}",
                    organization_id,
                    package_id,
                    f"GOODS-{suffix}",
                    f"Goods {suffix}",
                ),
            )
        scope = VisibilityScope.resolve(
            cursor,
            SessionRole(
                "user",
                employee_id,
                platform_role="user",
                active_role="employee",
            ),
            employee_id,
            organization_id,
        )

        package_predicate = scope.live_predicate("goi_thau", "source_row")
        package_ids = {
            row[0]
            for row in cursor.execute(
                "SELECT source_row.id FROM goi_thau AS source_row WHERE "  # noqa: S608 - predicate is registry-built
                + package_predicate.sql,
                package_predicate.parameters,
            ).fetchall()
        }
        child_predicate = scope.live_predicate(
            "goi_thau_hang_hoa", "source_row"
        )
        child_ids = {
            row[0]
            for row in cursor.execute(
                "SELECT source_row.id FROM goi_thau_hang_hoa AS source_row "  # noqa: S608 - predicate is registry-built
                "WHERE " + child_predicate.sql,
                child_predicate.parameters,
            ).fetchall()
        }

        assert package_ids == {package_a}
        assert child_ids == {f"goods-a-{package_b}"}
    finally:
        connection.rollback()
        connection.close()
        database.close()


def test_deletion_scope_accepts_historical_assignment_snapshot_without_broadening_scope():
    scope = VisibilityScope(
        organization_id="org-a",
        user_id="employee-a",
        unrestricted=False,
        permissions={"goithau": "view"},
    )

    predicate = scope.deletion_predicate("goi_thau")

    assert "deleted_assignment" in predicate.sql
    assert "record_snapshot_json" in predicate.sql
    assert predicate.parameters == (
        "org-a",
        "goi_thau",
        "employee-a",
        "employee-a",
    )


def test_full_read_tombstones_share_delta_record_scope_for_package_children():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_b = _seed_denied_package(cursor)
        package_a = f"assigned-{package_b}"
        plan_id = cursor.execute(
            "SELECT ke_hoach_id FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, package_b),
        ).fetchone()[0]
        cursor.execute(
            """INSERT INTO goi_thau
               (id, organization_id, id_goc, ke_hoach_id, ten_goi_thau,
                gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc, trang_thai)
               SELECT ?, organization_id, ?, ke_hoach_id, 'Assigned package',
                      gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                      thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc, trang_thai
                 FROM goi_thau WHERE organization_id = ? AND id = ?""",
            (package_a, package_a, organization_id, package_b),
        )
        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
               (id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)
               VALUES (?, ?, ?, ?, 'goithau')""",
            (f"assigned-row-{package_b}", organization_id, employee_id, package_a),
        )
        tombstones = (
            ("goi_thau", package_a, {"id": package_a}),
            ("goi_thau", package_b, {"id": package_b}),
            ("thong_tin_mo_thau", "opening-a", {"id": "opening-a", "goi_thau_id": package_a}),
            ("thong_tin_mo_thau", "opening-b", {"id": "opening-b", "goi_thau_id": package_b}),
        )
        for version, (table_name, record_id, snapshot) in enumerate(tombstones, start=11):
            cursor.execute(
                """INSERT INTO deleted_records
                   (table_name, record_id, organization_id, delete_version,
                    record_snapshot_json, deleted_at)
                   VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
                (table_name, record_id, organization_id, version, json.dumps(snapshot)),
            )
        cursor.execute(
            """INSERT INTO deleted_records
               (table_name, record_id, organization_id, delete_version,
                record_snapshot_json, deleted_at)
               VALUES ('goi_thau', 'cross-org-package', 'other-org', 19, '{}',
                       CURRENT_TIMESTAMP)"""
        )
        cursor.execute(
            """DELETE FROM phan_cong_nhan_su
               WHERE organization_id = ? AND id_nhan_vien = ?
                 AND id_muc_tieu = ? AND loai_doi_tuong = 'goithau'""",
            (organization_id, employee_id, package_a),
        )
        cursor.execute(
            """UPDATE deleted_records
               SET record_snapshot_json = ?
               WHERE organization_id = ? AND table_name = 'phan_cong_nhan_su'
                 AND record_id = ?""",
            (
                json.dumps({
                    "id": f"assigned-row-{package_b}",
                    "id_nhan_vien": employee_id,
                    "id_muc_tieu": package_a,
                    "loai_doi_tuong": "goithau",
                }),
                organization_id,
                f"assigned-row-{package_b}",
            ),
        )
        scope = VisibilityScope(
            organization_id=organization_id,
            user_id=employee_id,
            unrestricted=False,
            permissions={"goithau": "view"},
        )

        full = _load_visible_deletions(cursor, scope, after_version=10)
        delta = _load_candidates(
            cursor,
            organization_id,
            10,
            20,
            (10, "", "", ""),
            100,
            visibility_scope=scope,
        )
        scoped_keys = {"goithau", "thongtinmothau"}
        full_ids = {
            (item["table"], item["id"])
            for item in full
            if item["table"] in scoped_keys
        }
        delta_ids = {
            (row["table_key"], row["record_id"])
            for row in delta
            if row["kind"] == "delete" and row["table_key"] in scoped_keys
        }
        assert full_ids == delta_ids == {
            ("goithau", package_a),
            ("thongtinmothau", "opening-a"),
        }
        manager = VisibilityScope(
            organization_id=organization_id,
            user_id="manager-a",
            unrestricted=True,
            permissions={},
        )
        manager_ids = {
            (item["table"], item["id"])
            for item in _load_visible_deletions(cursor, manager, after_version=10)
            if item["table"] in scoped_keys
        }
        assert manager_ids == {
            ("goithau", package_a),
            ("goithau", package_b),
            ("thongtinmothau", "opening-a"),
            ("thongtinmothau", "opening-b"),
        }
        assert ("goithau", "cross-org-package") not in manager_ids
        assert plan_id
    finally:
        connection.rollback()
        connection.close()
        database.close()


def test_delta_query_pins_through_version_and_orders_live_with_tombstone():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, _employee_id, package_id = _seed_denied_package(cursor)
        cursor.execute(
            "UPDATE goi_thau SET sync_version = 11 WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        )
        cursor.execute(
            """INSERT INTO deleted_records
               (table_name, record_id, organization_id, delete_version, record_snapshot_json)
               VALUES ('goi_thau', ?, ?, 12, '{}')""",
            (f"deleted-{package_id}", organization_id),
        )
        cursor.execute(
            """INSERT INTO deleted_records
               (table_name, record_id, organization_id, delete_version, record_snapshot_json)
               VALUES ('goi_thau', ?, ?, 13, '{}')""",
            (f"concurrent-{package_id}", organization_id),
        )

        rows = _load_candidates(
            cursor,
            organization_id,
            10,
            12,
            (10, "", "", ""),
            100,
        )

        identities = [(int(row["version"]), row["kind"], row["record_id"]) for row in rows]
        assert (11, "upsert", package_id) in identities
        assert (12, "delete", f"deleted-{package_id}") in identities
        assert all(version <= 12 for version, _kind, _record_id in identities)
        assert identities == sorted(identities)
    finally:
        connection.rollback()
        connection.close()
        database.close()


def test_delta_package_upsert_keeps_normalized_evaluation_rounds():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_id = _seed_denied_package(cursor)
        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
               (id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)
               VALUES (?, ?, ?, ?, 'goithau')""",
            (f"assignment-delta-{package_id}", organization_id, employee_id, package_id),
        )
        batch_id = "batch-official-result"
        metadata = {
            "schemaVersion": 1,
            "lotBatches": {
                batch_id: {
                    "batchId": batch_id,
                    "sequenceNo": 1,
                    "lotIds": ["lot-1"],
                    "lotCodes": ["PP01"],
                    "saved": True,
                    "status": "FINAL",
                    "result": {
                        "saved": True,
                        "soQuyetDinhKetQua": "QD-LOT-1",
                    },
                },
            },
            "activeLotBatchId": "",
        }
        save_child_payloads(
            cursor,
            "goi_thau",
            {"id": package_id, "danhGiaHsdtMetadata": metadata},
            organization_id,
            "organization",
            11,
            "2026-08-03 03:00:00",
            employee_id,
        )
        cursor.execute(
            "UPDATE goi_thau SET sync_version = 11 WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        )
        candidate = next(
            row for row in _load_candidates(
                cursor,
                organization_id,
                10,
                11,
                (10, "", "", ""),
                100,
            )
            if row["table_key"] == "goithau" and row["record_id"] == package_id
        )

        projected = _project_candidate(
            cursor,
            candidate,
            role=SessionRole(
                "user",
                employee_id,
                platform_role="user",
                active_role="employee",
            ),
            user_id=employee_id,
            organization_id=organization_id,
            media_session_token="session-secret",
            sensitive_policy=SensitiveReadPolicy(True, True, True),
        )

        projected_metadata = json.loads(projected["record"]["danhGiaHsdtMetadata"])
        assert projected_metadata["lotBatches"][batch_id]["status"] == "FINAL"
        assert projected_metadata["lotBatches"][batch_id]["result"]["soQuyetDinhKetQua"] == "QD-LOT-1"
    finally:
        connection.rollback()
        connection.close()
        database.close()
