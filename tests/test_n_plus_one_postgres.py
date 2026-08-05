from pathlib import Path
import os
from uuid import uuid4

import psycopg
import pytest

from backend.api import org_routes
from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.shared import access_policy
from backend.shared.subscription_policy import (
    get_account_subscription,
    get_account_subscriptions_by_user_ids,
)
from backend.sync import delete_policy, ownership, uniqueness
from backend.sync.mapper import _save_ehsmt_adjustments, map_db_to_json


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


@pytest.fixture
def postgres_cursor():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        connection = psycopg.connect(
            database_url,
            connect_timeout=5,
            row_factory=compat_row_factory,
        )
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    try:
        yield PostgresCursor(connection.cursor())
    finally:
        connection.rollback()
        connection.close()


@pytest.fixture
def postgres_owner_records(postgres_cursor):
    """Seed owner-scoped rows inside the rollback-only test transaction."""

    prefix = f"__n1_test_{uuid4().hex}"
    organization_id = f"{prefix}_organization"
    investor_ids = []
    plan_ids = []
    package_ids = []
    postgres_cursor.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
        (organization_id, "N+1 rollback-only test organization"),
    )
    for index in range(3):
        investor_id = f"{prefix}_investor_{index}"
        plan_id = f"{prefix}_plan_{index}"
        package_id = f"{prefix}_package_{index}"
        postgres_cursor.execute(
            """INSERT INTO chu_dau_tu (
                   id, organization_id, id_goc, ma_chu_dau_tu, ma_so_thue,
                   ten_chu_dau_tu
               ) VALUES (?, ?, ?, ?, ?, ?)""",
            (
                investor_id,
                organization_id,
                investor_id,
                f"N1-CDT-{index}-{prefix}",
                f"N1-MST-{index}-{prefix}",
                f"N+1 test investor {index}",
            ),
        )
        postgres_cursor.execute(
            """INSERT INTO ke_hoach_lcnt (
                   id, organization_id, id_goc, ma_ke_hoach, ten_ke_hoach,
                   ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
                   ngay_phe_duyet, quyet_dinh_phe_duyet
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                plan_id,
                organization_id,
                plan_id,
                f"N1-KH-{index}-{prefix}",
                f"N+1 test plan {index}",
                f"N+1 test project {index}",
                "Mua sắm hàng hóa",
                investor_id,
                "2026-07-27",
                f"QD-{index}-{prefix}",
            ),
        )
        postgres_cursor.execute(
            """INSERT INTO goi_thau (
                   id, organization_id, id_goc, ma_goi_thau, ke_hoach_id,
                   ten_goi_thau, gia_goi_thau, thoi_gian_thuc_hien,
                   nguon_von, thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                package_id,
                organization_id,
                package_id,
                f"N1-GT-{index}-{prefix}",
                plan_id,
                f"N+1 test package {index}",
                1_000_000 + index,
                "30 ngày",
                "Ngân sách thử nghiệm",
                "30 ngày",
                "2026-07-27",
            ),
        )
        investor_ids.append(investor_id)
        plan_ids.append(plan_id)
        package_ids.append(package_id)

    return {
        "organization_id": organization_id,
        "investor_ids": investor_ids,
        "plan_ids": plan_ids,
        "package_ids": package_ids,
    }


def test_ehsmt_adjustment_upsert_allows_same_tenant_assignment(
    postgres_cursor,
    postgres_owner_records,
):
    organization_id = postgres_owner_records["organization_id"]
    package_id = postgres_owner_records["package_ids"][0]
    adjustment_id = f"{package_id}-adjustment"

    _save_ehsmt_adjustments(
        postgres_cursor,
        package_id,
        {
            "ehsmtAdjustments": [{
                "id": adjustment_id,
                "sequence": 1,
                "reason": "PostgreSQL conflict-target regression",
            }],
        },
        organization_id,
        "organization",
        1,
        "2026-08-05T00:00:00+00:00",
    )
    _save_ehsmt_adjustments(
        postgres_cursor,
        package_id,
        {
            "ehsmtAdjustments": [{
                "id": adjustment_id,
                "sequence": 1,
                "reason": "PostgreSQL conflict-target regression updated",
            }],
        },
        organization_id,
        "organization",
        2,
        "2026-08-05T00:01:00+00:00",
    )

    employee_id = postgres_cursor.execute(
        "SELECT id FROM tai_khoan ORDER BY id LIMIT 1"
    ).fetchone()[0]
    postgres_cursor.execute(
        """INSERT INTO phan_cong_nhan_su (
               id, organization_id, owner_type, id_nhan_vien,
               id_muc_tieu, loai_doi_tuong
           ) VALUES (?, ?, 'organization', ?, ?, 'goithau')""",
        (f"{package_id}-assignment", organization_id, employee_id, package_id),
    )

    assert postgres_cursor.execute(
        """SELECT reason FROM goi_thau_dieu_chinh_hsmt
           WHERE organization_id = ? AND id = ?""",
        (organization_id, adjustment_id),
    ).fetchone()[0] == "PostgreSQL conflict-target regression updated"


def test_account_subscription_batch_matches_scalar_postgres(postgres_cursor):
    user_ids = [
        str(row[0])
        for row in postgres_cursor.execute(
            "SELECT id FROM tai_khoan ORDER BY id LIMIT 50"
        ).fetchall()
    ]
    user_ids.append("__missing-account-subscription__")

    scalar = {
        user_id: get_account_subscription(postgres_cursor, user_id)
        for user_id in user_ids
    }
    batched = get_account_subscriptions_by_user_ids(postgres_cursor, user_ids)

    assert {
        user_id: batched.get(user_id)
        for user_id in user_ids
    } == scalar


def test_delete_reference_batch_matches_scalar_postgres(postgres_cursor):
    owner_row = postgres_cursor.execute(
        "SELECT organization_id FROM chu_dau_tu ORDER BY organization_id LIMIT 1"
    ).fetchone()
    organization_id = str(owner_row[0]) if owner_row else "__missing-organization__"
    record_ids = [
        str(row[0])
        for row in postgres_cursor.execute(
            "SELECT id FROM chu_dau_tu WHERE organization_id = ? ORDER BY id LIMIT 10",
            (organization_id,),
        ).fetchall()
    ]
    record_ids.append("__missing-investor__")

    scalar = {
        record_id: delete_policy.find_blocking_delete_references(
            postgres_cursor,
            organization_id,
            "chu_dau_tu",
            record_id,
        )
        for record_id in record_ids
    }
    batched = delete_policy.find_blocking_delete_references_by_record_ids(
        postgres_cursor,
        organization_id,
        "chu_dau_tu",
        record_ids,
    )

    assert batched == scalar


def test_new_batch_sql_executes_in_rollback_only_postgres_transaction(
    postgres_cursor,
):
    missing_id = "__n-plus-one-regression-missing__"
    records = {
        "goi_thau": [{
            "id": missing_id,
            "rebidFromPackageId": f"{missing_id}-source",
            "nhaThauTrungThauId": f"{missing_id}-winner",
        }],
        "danh_muc_trang_thai_hop_dong": [{
            "id": missing_id,
            "name": "__missing-status-name__",
        }],
    }

    access_policy.build_batch_write_authorization_context(
        postgres_cursor,
        "super_admin",
        missing_id,
        "__missing-organization__",
        records,
    )
    for table_name in ("ke_hoach_lcnt", "goi_thau", "hop_dong"):
        assert access_policy._load_assigned_lineages(
            postgres_cursor,
            "__missing-organization__",
            missing_id,
            table_name,
            [missing_id],
        ) == set()
    ownership.build_owner_reference_context(
        postgres_cursor,
        "__missing-organization__",
        records,
        {},
    )
    uniqueness.build_domain_uniqueness_context(
        postgres_cursor,
        "__missing-organization__",
        records,
    )
    delete_policy.build_delete_impacts_by_record_ids(
        postgres_cursor,
        "__missing-organization__",
        "goi_thau",
        [missing_id],
    )

    assignment = {
        "id": missing_id,
        "id_muc_tieu": f"{missing_id}-target",
        "loai_doi_tuong": "kehoach",
        "created_at": "2026-07-27 00:00:00",
    }
    transfer_assignment = {
        **assignment,
        "id": f"{missing_id}-transfer",
        "id_muc_tieu": f"{missing_id}-transfer-target",
        "loai_doi_tuong": "goithau",
    }
    changes = [
        (assignment, None, True),
        (transfer_assignment, f"{missing_id}-successor", False),
    ]
    org_routes._insert_assignment_departure_history(
        postgres_cursor,
        "__missing-organization__",
        missing_id,
        changes,
        "2026-07-27 12:00:00.123456",
        missing_id,
    )
    org_routes._apply_assignment_departures(
        postgres_cursor,
        "__missing-organization__",
        changes,
        1,
        "2026-07-27 12:00:00.123456",
    )
    assert org_routes._delete_member_permissions(
        postgres_cursor,
        missing_id,
        "__missing-organization__",
        "2026-07-27 12:00:00.123456",
        1,
    ) == []


def test_owner_reference_batch_matches_scalar_postgres(
    postgres_cursor,
    postgres_owner_records,
):
    organization_id = postgres_owner_records["organization_id"]
    package_ids = postgres_owner_records["package_ids"]
    placeholders = ", ".join("?" for _ in package_ids)
    rows = postgres_cursor.execute(
        f"""SELECT * FROM goi_thau
            WHERE organization_id = ? AND id IN ({placeholders})
            ORDER BY id""",
        (organization_id, *package_ids),
    ).fetchall()
    items = [map_db_to_json("goi_thau", dict(row)) for row in rows]
    records = {"goi_thau": items}
    context = ownership.build_owner_reference_context(
        postgres_cursor,
        organization_id,
        records,
        {},
    )

    for item in items:
        scalar = ownership.validate_owner_scoped_references(
            postgres_cursor,
            organization_id,
            "goi_thau",
            item,
            {},
            {},
        )
        batched = ownership.validate_owner_scoped_references(
            postgres_cursor,
            organization_id,
            "goi_thau",
            item,
            {},
            {},
            context,
        )
        assert batched == scalar


def test_uniqueness_batch_matches_scalar_postgres(
    postgres_cursor,
    postgres_owner_records,
):
    organization_id = postgres_owner_records["organization_id"]
    investor_ids = postgres_owner_records["investor_ids"]
    placeholders = ", ".join("?" for _ in investor_ids)
    rows = postgres_cursor.execute(
        f"""SELECT * FROM chu_dau_tu
            WHERE organization_id = ? AND id IN ({placeholders})
            ORDER BY id""",
        (organization_id, *investor_ids),
    ).fetchall()
    items = [map_db_to_json("chu_dau_tu", dict(row)) for row in rows]
    items.append({
        **items[0],
        "id": f"{investor_ids[0]}_duplicate",
        "rootId": f"{investor_ids[0]}_duplicate",
    })
    context = uniqueness.build_domain_uniqueness_context(
        postgres_cursor,
        organization_id,
        {"chu_dau_tu": items},
    )

    for item in items:
        record_id = str(item["id"])
        root_id = str(item.get("rootId") or record_id)
        scalar = uniqueness.validate_domain_uniqueness(
            postgres_cursor,
            organization_id,
            "chu_dau_tu",
            item,
            record_id,
            root_id,
        )
        batched = uniqueness.validate_domain_uniqueness_from_context(
            context,
            "chu_dau_tu",
            item,
            record_id,
            root_id,
        )
        assert batched == scalar
