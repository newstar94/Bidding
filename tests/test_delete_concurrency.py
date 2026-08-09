import os
from pathlib import Path
from threading import Barrier, BrokenBarrierError, Event, Thread
from uuid import uuid4

import psycopg
import pytest

from backend.auth.auth_helper import SessionRole
from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.sync import deletion_service


class _DeleteRaceRecords(dict):
    def __repr__(self):
        redacted = dict(self)
        redacted["database_url"] = "<redacted>"
        return repr(redacted)


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return None
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip('"').strip("'") or None
    return None


def _connect(database_url):
    return psycopg.connect(
        database_url,
        connect_timeout=5,
        row_factory=compat_row_factory,
    )


@pytest.fixture
def delete_race_records():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    suffix = uuid4().hex
    organization_id = f"delete-race-org-{suffix}"
    manager_id = f"delete-race-manager-{suffix}"
    investor_id = f"delete-race-investor-{suffix}"
    plan_id = f"delete-race-plan-{suffix}"
    status_id = f"delete-race-status-{suffix}"
    try:
        setup_connection = _connect(database_url)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    try:
        cursor = PostgresCursor(setup_connection.cursor())
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, "Tổ chức kiểm thử stale delete"),
        )
        email = f"{manager_id}@example.test"
        cursor.execute(
            """INSERT INTO tai_khoan
               (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                vai_tro, email, email_norm, da_xac_minh, username_da_dat)
               VALUES (?, ?, ?, 'test-password-hash', 'Race Manager',
                       'user', ?, ?, 1, 1)""",
            (manager_id, manager_id, manager_id, email, email),
        )
        cursor.execute(
            """INSERT INTO thanh_vien_to_chuc
               (user_id, organization_id, vai_tro_trong_to_chuc, ten_nhan_su)
               VALUES (?, ?, 'manager', 'Race Manager')""",
            (manager_id, organization_id),
        )
        cursor.execute(
            """INSERT INTO chu_dau_tu
               (id, organization_id, id_goc, ten_chu_dau_tu)
               VALUES (?, ?, ?, 'Nhà đầu tư v1')""",
            (investor_id, organization_id, investor_id),
        )
        cursor.execute(
            """INSERT INTO ke_hoach_lcnt
               (id, organization_id, id_goc, ten_ke_hoach, ten_du_an_du_toan,
                loai_hinh_mua_sam, chu_dau_tu_id, ngay_phe_duyet,
                quyet_dinh_phe_duyet)
               VALUES (?, ?, ?, 'Kế hoạch race', 'Dự án race',
                       'Mua sắm thường xuyên', ?, CURRENT_DATE, 'QĐ-RACE')""",
            (plan_id, organization_id, plan_id, investor_id),
        )
        cursor.execute(
            """INSERT INTO danh_muc_trang_thai_hop_dong
               (id, organization_id, name, color)
               VALUES (?, ?, 'Trạng thái v1', '#64748b')""",
            (status_id, organization_id),
        )
        setup_connection.commit()
    finally:
        setup_connection.close()

    yield _DeleteRaceRecords({
        "database_url": database_url,
        "organization_id": organization_id,
        "manager_id": manager_id,
        "investor_id": investor_id,
        "plan_id": plan_id,
        "status_id": status_id,
    })

    cleanup_connection = _connect(database_url)
    try:
        cursor = PostgresCursor(cleanup_connection.cursor())
        cursor.execute(
            "DELETE FROM deleted_records WHERE organization_id = ?",
            (organization_id,),
        )
        cursor.execute(
            "DELETE FROM danh_muc_trang_thai_hop_dong WHERE organization_id = ?",
            (organization_id,),
        )
        cursor.execute(
            "DELETE FROM ke_hoach_lcnt WHERE organization_id = ?",
            (organization_id,),
        )
        cursor.execute(
            "DELETE FROM chu_dau_tu WHERE organization_id = ?",
            (organization_id,),
        )
        cursor.execute(
            "DELETE FROM thanh_vien_to_chuc WHERE organization_id = ?",
            (organization_id,),
        )
        cursor.execute("DELETE FROM to_chuc WHERE id = ?", (organization_id,))
        cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (manager_id,))
        cleanup_connection.commit()
    finally:
        cleanup_connection.close()


def _apply_delete_after_concurrent_update(
    monkeypatch,
    records,
    *,
    deletion,
    update_sql,
    update_params,
):
    barrier = Barrier(2)
    update_done = Event()
    worker_errors = []

    def update_worker():
        connection = None
        try:
            connection = _connect(records["database_url"])
            barrier.wait(timeout=5)
            connection.execute(update_sql, update_params)
            connection.commit()
        except (psycopg.Error, BrokenBarrierError) as error:
            worker_errors.append(error)
            if connection:
                connection.rollback()
        finally:
            if connection:
                connection.close()
            update_done.set()

    original_context_builder = (
        deletion_service.build_batch_write_authorization_context
    )

    def context_after_update(*args, **kwargs):
        context = original_context_builder(*args, **kwargs)
        barrier.wait(timeout=5)
        if not update_done.wait(timeout=5):
            raise AssertionError("Concurrent update did not reach the delete barrier")
        if worker_errors:
            raise worker_errors[0]
        return context

    monkeypatch.setattr(
        deletion_service,
        "build_batch_write_authorization_context",
        context_after_update,
    )
    worker = Thread(target=update_worker, daemon=True)
    worker.start()

    connection = _connect(records["database_url"])
    try:
        cursor = PostgresCursor(connection.cursor())
        role = SessionRole(
            "user",
            records["manager_id"],
            platform_role="user",
            active_role="manager",
        )
        result = deletion_service.apply_sync_deletions(
            cursor,
            [deletion],
            organization_id=records["organization_id"],
            actor_role=role,
            actor_user_id=records["manager_id"],
            current_time="2026-08-09 12:00:00",
            sync_version=2,
            clean_record_id=lambda _table, value: str(value) if value else None,
            ip_address="127.0.0.1",
        )
        worker.join(timeout=5)
        assert not worker.is_alive()
        return connection, cursor, result
    except Exception:
        connection.rollback()
        connection.close()
        worker.join(timeout=5)
        raise


def test_hard_delete_conflicts_when_concurrent_update_commits_after_prefetch(
    monkeypatch,
    delete_race_records,
):
    records = delete_race_records
    connection, cursor, result = _apply_delete_after_concurrent_update(
        monkeypatch,
        records,
        deletion={
            "table": "customcontractstatuses",
            "id": records["status_id"],
            "expectedVersion": 1,
        },
        update_sql="""UPDATE danh_muc_trang_thai_hop_dong
                      SET name = %s, row_version = row_version + 1
                      WHERE organization_id = %s AND id = %s""",
        update_params=(
            "Trạng thái v2",
            records["organization_id"],
            records["status_id"],
        ),
    )
    try:
        assert result["impacts"] == []
        assert [error["code"] for error in result["errors"]] == [
            "ROW_VERSION_CONFLICT"
        ]
        assert result["errors"][0]["currentVersion"] == 2
        row = cursor.execute(
            """SELECT name, row_version
               FROM danh_muc_trang_thai_hop_dong
               WHERE organization_id = ? AND id = ?""",
            (records["organization_id"], records["status_id"]),
        ).fetchone()
        assert tuple(row) == ("Trạng thái v2", 2)
        tombstone_count = cursor.execute(
            """SELECT COUNT(*) FROM deleted_records
               WHERE organization_id = ? AND table_name = ? AND record_id = ?""",
            (
                records["organization_id"],
                "danh_muc_trang_thai_hop_dong",
                records["status_id"],
            ),
        ).fetchone()[0]
        assert tombstone_count == 0
    finally:
        connection.rollback()
        connection.close()


def test_archive_conflicts_when_concurrent_update_commits_after_prefetch(
    monkeypatch,
    delete_race_records,
):
    records = delete_race_records
    connection, cursor, result = _apply_delete_after_concurrent_update(
        monkeypatch,
        records,
        deletion={
            "table": "chudautu",
            "id": records["investor_id"],
            "expectedVersion": 1,
        },
        update_sql="""UPDATE chu_dau_tu
                      SET ten_chu_dau_tu = %s, row_version = row_version + 1
                      WHERE organization_id = %s AND id = %s""",
        update_params=(
            "Nhà đầu tư v2",
            records["organization_id"],
            records["investor_id"],
        ),
    )
    try:
        assert result["impacts"] == []
        assert [error["code"] for error in result["errors"]] == [
            "ROW_VERSION_CONFLICT"
        ]
        assert result["errors"][0]["currentVersion"] == 2
        row = cursor.execute(
            """SELECT ten_chu_dau_tu, row_version, archived_at
               FROM chu_dau_tu
               WHERE organization_id = ? AND id = ?""",
            (records["organization_id"], records["investor_id"]),
        ).fetchone()
        assert tuple(row) == ("Nhà đầu tư v2", 2, None)
        tombstone_count = cursor.execute(
            """SELECT COUNT(*) FROM deleted_records
               WHERE organization_id = ? AND table_name = ? AND record_id = ?""",
            (
                records["organization_id"],
                "chu_dau_tu",
                records["investor_id"],
            ),
        ).fetchone()[0]
        assert tombstone_count == 0
    finally:
        connection.rollback()
        connection.close()
