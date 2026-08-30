from hashlib import sha256
import json
import os
from pathlib import Path
import uuid

import psycopg
import pytest
from psycopg import sql

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.db.postgres_schema import (
    _create_extensions,
    _create_foreign_keys,
    _create_synced_delete_trigger_function,
    _create_trigger_functions,
    assert_foreign_key_integrity,
    assert_schema_contract,
    build_create_table_sql,
    create_fresh_database,
    create_indexes_and_triggers,
)
from backend.db.upgrades import (
    BASELINE_NAME,
    DB_SCHEMA_VERSION,
    DatabaseUpgradeContext,
    apply_database_upgrades,
)
from scripts.audit_fk_indexes import find_missing_foreign_key_indexes


V1_SOURCE_COMMIT = "1fe7dd42"
V1_SOURCE_SHA256 = "da1003067e0f7375f45341a0d6f69a90333f8d72d08c909ba2c71fe0c9aa059b"
V1_POSTGRES_SOURCE_SHA256 = "88c6de73a61f5631c49572fbe30aef246dd46769df74d305434c3bdc111cc778"
V1_FIXTURE = Path(__file__).parent / "fixtures" / "postgres_schema_v1.json"


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


def _load_v1_fixture():
    fixture = json.loads(V1_FIXTURE.read_text(encoding="utf-8"))
    assert fixture["sourceCommit"] == V1_SOURCE_COMMIT
    assert fixture["sourcePath"] == "backend/db/schema.py"
    assert fixture["sourceBlobSha256"] == V1_SOURCE_SHA256
    assert fixture["postgresSourcePath"] == "backend/db/postgres_schema.py"
    assert fixture["postgresSourceBlobSha256"] == V1_POSTGRES_SOURCE_SHA256
    assert fixture["schemaVersion"] == 1
    assert len(fixture["tables"]) == 48
    assert len(fixture["catalogSql"]["indexes"]) == 133
    assert len(fixture["catalogSql"]["triggers"]) == 68
    return fixture


def _foreign_key_name(table_name, index, definition):
    digest = sha256(definition.encode("utf-8")).hexdigest()[:8]
    return f"fk_{table_name}_{index}_{digest}"[:63]


def _create_v1_schema(cursor, fixture):
    tables = fixture["tables"]
    for table_name, table_spec in tables.items():
        cursor.execute(build_create_table_sql(table_name, table_spec))
    for table_name, table_spec in tables.items():
        foreign_keys = [
            definition
            for definition in table_spec.get("foreign_keys", ())
            if definition.lstrip().upper().startswith("FOREIGN KEY")
        ]
        for index, definition in enumerate(foreign_keys, 1):
            cursor.execute(
                sql.SQL("ALTER TABLE {} ADD CONSTRAINT {} {}").format(
                    sql.Identifier(table_name),
                    sql.Identifier(_foreign_key_name(table_name, index, definition)),
                    sql.SQL(definition),
                )
            )
    for statement in fixture["catalogSql"]["indexes"]:
        cursor.execute(statement.replace(" gin_trgm_ops", " public.gin_trgm_ops"))
    for statement in fixture["catalogSql"]["triggers"]:
        cursor.execute(statement)
    cursor.execute(
        """INSERT INTO database_metadata
               (id, schema_version, baseline, installation_id)
           VALUES (1, 1, ?, 'fixture-v1-installation')""",
        (BASELINE_NAME,),
    )


def _seed_v1_representative_data(cursor):
    cursor.execute(
        """INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su)
           VALUES ('fixture-plan', 'Fixture plan', 1000000, 5)"""
    )
    cursor.execute(
        """INSERT INTO tai_khoan
               (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                vai_tro, email, email_norm, da_xac_minh)
           VALUES ('fixture-user', 'fixture', 'fixture', 'hash', 'Fixture User',
                   'super_admin', 'fixture@example.test',
                   'fixture@example.test', 1)"""
    )
    cursor.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('fixture-org', 'Fixture Org')"
    )
    cursor.execute(
        """INSERT INTO chu_dau_tu
               (id, organization_id, owner_type, ma_chu_dau_tu, ten_chu_dau_tu)
           VALUES ('fixture-owner', 'fixture-org', 'organization',
                   'OWNER-1', 'Fixture Owner')"""
    )
    cursor.execute(
        """INSERT INTO nha_thau
               (id, organization_id, owner_type, ma_nha_thau, ten_nha_thau)
           VALUES ('fixture-bidder', 'fixture-org', 'organization',
                   'BIDDER-1', 'Fixture Bidder')"""
    )
    cursor.execute(
        """INSERT INTO ke_hoach_lcnt
               (id, organization_id, owner_type, ma_ke_hoach, ten_ke_hoach,
                ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
                ngay_phe_duyet, quyet_dinh_phe_duyet)
           VALUES ('fixture-plan-record', 'fixture-org', 'organization',
                   'PLAN-1', 'Fixture Plan', 'Fixture Project',
                   'Dự toán mua sắm', 'fixture-owner', DATE '2026-01-01',
                   '01/QD')"""
    )
    cursor.execute(
        """INSERT INTO goi_thau
               (id, organization_id, owner_type, ma_goi_thau, ke_hoach_id,
                ten_goi_thau, gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc,
                phuong_phap_danh_gia, trong_so_ky_thuat, phan_lo)
           VALUES ('fixture-package', 'fixture-org', 'organization', 'PKG-1',
                   'fixture-plan-record', 'Fixture Package', 900000,
                   '30 ngày', 'Ngân sách', 'Q1/2026', '01/2026',
                   'Giá thấp nhất', 70, 'Có')"""
    )
    cursor.execute(
        """INSERT INTO goi_thau_phan_lo
               (id, organization_id, owner_type, goi_thau_id,
                ma_phan_lo, ten_phan_lo)
           VALUES ('fixture-lot', 'fixture-org', 'organization',
                   'fixture-package', '  LOT A  ', 'Fixture Lot')"""
    )
    cursor.execute(
        """INSERT INTO thong_tin_mo_thau
               (id, organization_id, owner_type, goi_thau_id, nha_thau_id,
                ma_phan_lo, ten_phan_lo, ten_nha_thau)
           VALUES ('fixture-opening', 'fixture-org', 'organization',
                   'fixture-package', 'fixture-bidder', '  LOT A  ',
                   'Fixture Lot', 'Fixture Bidder')"""
    )
    cursor.execute(
        """INSERT INTO trang_thai_ho_so_giay
               (id, organization_id, owner_type, name)
           VALUES ('fixture-paper-status', 'fixture-org', 'organization',
                   'Dự thảo')"""
    )
    cursor.execute(
        """INSERT INTO hop_dong
               (id, organization_id, owner_type, ten_hop_dong, so_hop_dong,
                ngay_ky, chu_dau_tu_id, nha_thau_id, ke_hoach_id, gia_tri,
                loai_hop_dong, thoi_gian_thuc_hien, trang_thai_hop_dong,
                trang_thai_ho_so)
           VALUES ('fixture-contract', 'fixture-org', 'organization',
                   'Fixture Contract', '01/HD', DATE '2026-02-01',
                   'fixture-owner', 'fixture-bidder', 'fixture-plan-record',
                   800000, 'Trọn gói', '30 ngày', 'ACTIVE', 'Dự thảo')"""
    )
    cursor.execute(
        """INSERT INTO sync_metadata
               (organization_id, current_version, min_available_version)
           VALUES ('fixture-org', 9, 2)"""
    )
    cursor.execute(
        """INSERT INTO auth_sessions
               (id, user_id, token_hash, created_at, last_seen_at,
                idle_expires_at, absolute_expires_at)
           VALUES
               ('fixture-session-old', 'fixture-user', 'old-token',
                100, 100, 1000, 1000),
               ('fixture-session-new', 'fixture-user', 'new-token',
                200, 200, 1000, 1000)"""
    )


def _upgrade_context():
    return DatabaseUpgradeContext(
        build_create_table_sql=build_create_table_sql,
        create_indexes_and_triggers=create_indexes_and_triggers,
        assert_foreign_key_integrity=assert_foreign_key_integrity,
        create_foreign_keys=_create_foreign_keys,
        create_trigger_functions=_create_trigger_functions,
        create_synced_delete_trigger_function=(
            _create_synced_delete_trigger_function
        ),
    )


def _install_v59_synced_delete_function(cursor):
    """Reproduce the released v59 function body that omitted row snapshots."""

    cursor.execute(
        """CREATE OR REPLACE FUNCTION bf_log_synced_delete()
           RETURNS trigger LANGUAGE plpgsql AS $$
           DECLARE next_version BIGINT;
           BEGIN
             IF OLD.organization_id IS NULL OR OLD.organization_id = '' THEN
               RETURN OLD;
             END IF;
             INSERT INTO sync_metadata (organization_id, current_version)
             VALUES (OLD.organization_id, 0)
             ON CONFLICT (organization_id) DO NOTHING;
             UPDATE sync_metadata
             SET current_version = current_version + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = OLD.organization_id
             RETURNING current_version INTO next_version;
             INSERT INTO deleted_records (
               table_name, record_id, organization_id, deleted_at,
               delete_version
             ) VALUES (
               TG_TABLE_NAME, OLD.id, OLD.organization_id,
               CURRENT_TIMESTAMP, next_version
             )
             ON CONFLICT (organization_id, table_name, record_id) DO UPDATE SET
               deleted_at = EXCLUDED.deleted_at,
               delete_version = GREATEST(
                 COALESCE(deleted_records.delete_version, 0),
                 COALESCE(EXCLUDED.delete_version, 0)
               );
             RETURN OLD;
           END $$"""
    )


def _schema_object_oids(cursor):
    return {
        "constraints": tuple(row[0] for row in cursor.execute(
            """SELECT constraint_row.oid
                 FROM pg_constraint AS constraint_row
                WHERE constraint_row.connamespace = current_schema()::regnamespace
                ORDER BY constraint_row.oid"""
        ).fetchall()),
        "indexes": tuple(row[0] for row in cursor.execute(
            """SELECT index_row.oid
                 FROM pg_class AS index_row
                WHERE index_row.relnamespace = current_schema()::regnamespace
                  AND index_row.relkind = 'i'
                ORDER BY index_row.oid"""
        ).fetchall()),
        "triggers": tuple(row[0] for row in cursor.execute(
            """SELECT trigger_row.oid
                 FROM pg_trigger AS trigger_row
                 JOIN pg_class AS relation
                   ON relation.oid = trigger_row.tgrelid
                WHERE relation.relnamespace = current_schema()::regnamespace
                  AND NOT trigger_row.tgisinternal
                ORDER BY trigger_row.oid"""
        ).fetchall()),
    }


def _open_fixture_connection():
    fixture = _load_v1_fixture()
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

    schema_name = f"bf_upgrade_v1_{uuid.uuid4().hex}"
    cursor = PostgresCursor(connection.cursor())
    try:
        cursor.execute(
            sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema_name))
        )
        cursor.execute(
            sql.SQL("SET LOCAL search_path TO {}").format(
                sql.Identifier(schema_name)
            )
        )
        _create_extensions(cursor)
        _create_v1_schema(cursor, fixture)
        _seed_v1_representative_data(cursor)
    except Exception:
        connection.rollback()
        connection.close()
        raise
    return connection, cursor, schema_name


def _close_fixture_connection(connection, cursor, schema_name):
    try:
        connection.rollback()
        cursor.execute("SET search_path TO public")
        cursor.execute(
            sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(
                sql.Identifier(schema_name)
            )
        )
        connection.commit()
    finally:
        connection.close()


def test_real_postgres_v1_chain_reaches_latest_catalog_and_preserves_data():
    connection, cursor, schema_name = _open_fixture_connection()
    try:

        assert apply_database_upgrades(cursor, 1, _upgrade_context()) == DB_SCHEMA_VERSION
        assert_schema_contract(cursor)
        assert_foreign_key_integrity(cursor)

        metadata = cursor.execute(
            """SELECT schema_version, baseline, installation_id
                 FROM database_metadata WHERE id = 1"""
        ).fetchone()
        assert tuple(metadata) == (
            DB_SCHEMA_VERSION,
            BASELINE_NAME,
            "fixture-v1-installation",
        )
        assert cursor.execute(
            "SELECT COUNT(*) FROM auth_sessions WHERE revoked_at IS NULL"
        ).fetchone()[0] == 1
        assert cursor.execute(
            "SELECT trong_so_ky_thuat FROM goi_thau WHERE id = 'fixture-package'"
        ).fetchone()[0] is None
        assert cursor.execute(
            """SELECT trang_thai_hop_dong FROM hop_dong
                WHERE id = 'fixture-contract'"""
        ).fetchone()[0] == "Đang thực hiện"
        assert cursor.execute(
            """SELECT COUNT(*) FROM danh_muc_trang_thai_hop_dong
                WHERE organization_id = 'fixture-org'"""
        ).fetchone()[0] == 6
        assert cursor.execute(
            """SELECT ma_phan_lo_normalized FROM goi_thau_phan_lo
                WHERE id = 'fixture-lot'"""
        ).fetchone()[0] == "lot a"
        assert cursor.execute(
            """SELECT ma_phan_lo_normalized FROM thong_tin_mo_thau
                WHERE id = 'fixture-opening'"""
        ).fetchone()[0] == "lot a"
        assert tuple(cursor.execute(
            """SELECT document_export_word, document_export_excel,
                      document_export_award_result_excel
                 FROM goi_dich_vu WHERE id = 'fixture-plan'"""
        ).fetchone()) == (1, 1, 1)
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_fresh_catalog_keeps_only_constraint_backed_audit_successor_index(
    monkeypatch,
):
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

    schema_name = f"bf_fresh_v47_{uuid.uuid4().hex}"
    cursor = PostgresCursor(connection.cursor())
    try:
        cursor.execute(
            sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema_name))
        )
        cursor.execute(
            sql.SQL("SET LOCAL search_path TO {}, public").format(
                sql.Identifier(schema_name)
            )
        )
        monkeypatch.setenv("ADMIN_PASSWORD", "Test-only!Schema47Password")

        assert create_fresh_database(cursor, _upgrade_context()) == DB_SCHEMA_VERSION
        assert_schema_contract(cursor)
        assert find_missing_foreign_key_indexes(connection)["missing"] == []
        fresh_definition = cursor.execute(
            "SELECT pg_get_functiondef('bf_log_synced_delete()'::regprocedure)"
        ).fetchone()[0]
        assert "record_snapshot_json" in fresh_definition
        assert "to_jsonb(old)" in fresh_definition.casefold()
        names = {
            row[0]
            for row in cursor.execute(
                """SELECT indexname
                     FROM pg_indexes
                    WHERE schemaname = current_schema()
                      AND tablename = 'audit_log'
                      AND indexdef LIKE '%(chain_id, previous_hash)%'"""
            ).fetchall()
        }
        assert names == {"audit_log_chain_id_previous_hash_key"}
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_v81_upgrade_covers_commercial_foreign_keys():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(
            cursor,
            1,
            context,
            target_version=80,
        ) == 80
        missing_at_v80 = find_missing_foreign_key_indexes(connection)["missing"]
        assert len(missing_at_v80) == 32

        assert apply_database_upgrades(cursor, 80, context) == DB_SCHEMA_VERSION
        assert find_missing_foreign_key_indexes(connection)["missing"] == []
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_v82_upgrade_adds_usage_rollup_fk_indexes_and_owner_trigger():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(
            cursor,
            1,
            context,
            target_version=81,
        ) == 81
        assert cursor.execute(
            "SELECT to_regclass('product_usage_hourly')"
        ).fetchone()[0] is None
        assert cursor.execute(
            "SELECT to_regclass('idx_activity_product_usage')"
        ).fetchone()[0] is None

        assert apply_database_upgrades(cursor, 81, context) == DB_SCHEMA_VERSION

        assert cursor.execute(
            "SELECT to_regclass('product_usage_hourly')"
        ).fetchone()[0] == "product_usage_hourly"
        assert cursor.execute(
            """SELECT data_type
                 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'product_usage_hourly'
                  AND column_name = 'first_seen_at'"""
        ).fetchone()[0] == "bigint"
        assert {
            row[0]
            for row in cursor.execute(
                """SELECT indexname
                     FROM pg_indexes
                    WHERE schemaname = current_schema()
                      AND tablename = 'product_usage_hourly'"""
            ).fetchall()
        } >= {
            "idx_product_usage_presence_recent",
            "idx_product_usage_feature_window",
            "idx_product_usage_metric_window",
            "idx_product_usage_user_fk",
            "idx_product_usage_hourly_owner_type_owner",
            "product_usage_hourly_pkey",
        }
        assert cursor.execute(
            """SELECT COUNT(*)
                 FROM pg_constraint
                WHERE connamespace = current_schema()::regnamespace
                  AND conrelid = 'product_usage_hourly'::regclass
                  AND contype = 'f'
                  AND convalidated"""
        ).fetchone()[0] == 1
        assert cursor.execute(
            """SELECT COUNT(*)
                 FROM pg_trigger
                WHERE tgrelid = 'product_usage_hourly'::regclass
                  AND tgname = 'trg_product_usage_hourly_workspace_owner'
                  AND NOT tgisinternal"""
        ).fetchone()[0] == 1
        assert cursor.execute(
            """SELECT COUNT(*)
                 FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND tablename = 'nhat_ky_thuc_hien'
                  AND indexname = 'idx_activity_product_usage'
                  AND indexdef LIKE '%(occurred_at, actor_user_id)%'
                  AND indexdef LIKE '%WHERE (actor_user_id IS NOT NULL)%'"""
        ).fetchone()[0] == 1
        assert find_missing_foreign_key_indexes(connection)["missing"] == []
        assert_schema_contract(cursor)
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_v83_upgrade_adds_plan_basis_catalog_and_owner_invariants():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(
            cursor,
            1,
            context,
            target_version=82,
        ) == 82
        assert cursor.execute(
            "SELECT to_regclass('ke_hoach_can_cu')"
        ).fetchone()[0] is None

        assert apply_database_upgrades(cursor, 82, context) == DB_SCHEMA_VERSION

        assert cursor.execute(
            "SELECT to_regclass('ke_hoach_can_cu')"
        ).fetchone()[0] == "ke_hoach_can_cu"
        assert {
            row[0]
            for row in cursor.execute(
                """SELECT indexname
                     FROM pg_indexes
                    WHERE schemaname = current_schema()
                      AND tablename = 'ke_hoach_can_cu'"""
            ).fetchall()
        } >= {
            "idx_ke_hoach_can_cu_parent",
            "idx_ke_hoach_can_cu_lineage",
            "idx_ke_hoach_can_cu_owner_type_owner",
            "ke_hoach_can_cu_organization_id_ke_hoach_id_sort_order_key",
            "ke_hoach_can_cu_pkey",
        }
        assert cursor.execute(
            """SELECT COUNT(*)
                 FROM pg_constraint
                WHERE connamespace = current_schema()::regnamespace
                  AND conrelid = 'ke_hoach_can_cu'::regclass
                  AND contype = 'f'
                  AND convalidated"""
        ).fetchone()[0] == 1
        assert cursor.execute(
            """SELECT COUNT(*)
                 FROM pg_trigger
                WHERE tgrelid = 'ke_hoach_can_cu'::regclass
                  AND tgname = 'trg_ke_hoach_can_cu_workspace_owner'
                  AND NOT tgisinternal"""
        ).fetchone()[0] == 1
        assert find_missing_foreign_key_indexes(connection)["missing"] == []
        assert_schema_contract(cursor)
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_real_postgres_v35_checkpoint_reaches_latest_catalog():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(
            cursor,
            1,
            context,
            target_version=35,
        ) == 35
        connection.commit()
        cursor.execute(
            sql.SQL("SET LOCAL search_path TO {}").format(
                sql.Identifier(schema_name)
            )
        )

        assert apply_database_upgrades(cursor, 35, context) == DB_SCHEMA_VERSION
        assert_schema_contract(cursor)
        assert_foreign_key_integrity(cursor)
        assert tuple(cursor.execute(
            "SELECT schema_version, baseline FROM database_metadata WHERE id = 1"
        ).fetchone()) == (DB_SCHEMA_VERSION, BASELINE_NAME)
        assert cursor.execute(
            "SELECT ma_phan_lo_normalized FROM goi_thau_phan_lo WHERE id = 'fixture-lot'"
        ).fetchone()[0] == "lot a"
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_v77_removes_procurement_case_activity_without_breaking_immutable_audit():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(
            cursor,
            1,
            context,
            target_version=76,
        ) == 76
        cursor.execute(
            """INSERT INTO nhat_ky_thuc_hien (
                   id, organization_id, target_type, target_id,
                   target_root_id, action, actor_user_id
               ) VALUES (
                   'fixture-case-activity', 'fixture-org', 'procurement_case',
                   'fixture-case', 'fixture-case', 'procurement_case.created',
                   'fixture-user'
               )"""
        )

        assert apply_database_upgrades(cursor, 76, context) == DB_SCHEMA_VERSION
        assert cursor.execute(
            """SELECT COUNT(*) FROM nhat_ky_thuc_hien
                WHERE target_type = 'procurement_case'"""
        ).fetchone()[0] == 0
        assert cursor.execute(
            """SELECT COUNT(*) FROM pg_trigger
                WHERE tgrelid = 'nhat_ky_thuc_hien'::regclass
                  AND tgname = 'trg_nhat_ky_thuc_hien_immutable'
                  AND NOT tgisinternal"""
        ).fetchone()[0] == 1
        assert_schema_contract(cursor)
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_v59_to_v61_replaces_delete_function_and_renames_default_workspace():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(
            cursor, 1, context, target_version=59
        ) == 59
        _install_v59_synced_delete_function(cursor)
        old_definition = cursor.execute(
            "SELECT pg_get_functiondef('bf_log_synced_delete()'::regprocedure)"
        ).fetchone()[0]
        assert "record_snapshot_json" not in old_definition
        trigger_count = cursor.execute(
            """SELECT COUNT(*)
                 FROM pg_trigger
                WHERE tgrelid = 'phan_cong_nhan_su'::regclass
                  AND tgname = 'trg_phan_cong_nhan_su_deleted_log'
                  AND NOT tgisinternal"""
        ).fetchone()[0]
        assert trigger_count == 1

        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('fixture-htd', 'HTD')"
        )

        assert apply_database_upgrades(cursor, 59, context) == DB_SCHEMA_VERSION
        definition = cursor.execute(
            "SELECT pg_get_functiondef('bf_log_synced_delete()'::regprocedure)"
        ).fetchone()[0]
        assert "record_snapshot_json" in definition
        assert "to_jsonb(old)" in definition.casefold()

        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
                   (id, organization_id, id_nhan_vien, id_muc_tieu,
                    loai_doi_tuong)
               VALUES ('fixture-assignment-v60', 'fixture-org', 'fixture-user',
                       'fixture-package', 'goithau')"""
        )
        cursor.execute(
            "DELETE FROM phan_cong_nhan_su WHERE id = 'fixture-assignment-v60'"
        )
        snapshot_text = cursor.execute(
            """SELECT record_snapshot_json
                 FROM deleted_records
                WHERE organization_id = 'fixture-org'
                  AND table_name = 'phan_cong_nhan_su'
                  AND record_id = 'fixture-assignment-v60'"""
        ).fetchone()[0]
        snapshot = json.loads(snapshot_text)
        assert snapshot["id"] == "fixture-assignment-v60"
        assert snapshot["organization_id"] == "fixture-org"
        assert snapshot["id_nhan_vien"] == "fixture-user"
        assert snapshot["id_muc_tieu"] == "fixture-package"
        assert snapshot["loai_doi_tuong"] == "goithau"

        assert cursor.execute(
            "SELECT ten_to_chuc FROM to_chuc WHERE id = 'fixture-htd'"
        ).fetchone()[0] == "HCP"

        assert apply_database_upgrades(cursor, DB_SCHEMA_VERSION, context) == DB_SCHEMA_VERSION
        assert cursor.execute(
            """SELECT COUNT(*)
                 FROM pg_trigger
                WHERE tgrelid = 'phan_cong_nhan_su'::regclass
                  AND tgname = 'trg_phan_cong_nhan_su_deleted_log'
                  AND NOT tgisinternal"""
        ).fetchone()[0] == trigger_count
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_v46_exact_catalog_only_advances_version_without_rebuilding_objects():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(cursor, 1, context) == DB_SCHEMA_VERSION
        assert_schema_contract(cursor)
        cursor.execute("UPDATE database_metadata SET schema_version = 45 WHERE id = 1")
        before = _schema_object_oids(cursor)

        assert apply_database_upgrades(cursor, 45, context, target_version=46) == 46
        assert _schema_object_oids(cursor) == before
        assert apply_database_upgrades(cursor, 46, context) == DB_SCHEMA_VERSION
        assert cursor.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()[0] == DB_SCHEMA_VERSION
        assert_schema_contract(cursor)
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_v47_removes_only_explicit_duplicate_audit_successor_index():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(
            cursor,
            1,
            context,
            target_version=45,
        ) == 45
        # Simulate the already-installed v46 catalog from the previous release.
        # Replaying the v46 reconciler here would intentionally compare against
        # the latest generated catalog rather than that historical checkpoint.
        cursor.execute(
            "UPDATE database_metadata SET schema_version = 46 WHERE id = 1"
        )
        before = {
            row[0]
            for row in cursor.execute(
                """SELECT indexname
                     FROM pg_indexes
                    WHERE schemaname = current_schema()
                      AND tablename = 'audit_log'
                      AND indexdef LIKE '%(chain_id, previous_hash)%'"""
            ).fetchall()
        }
        assert before == {
            "audit_log_chain_id_previous_hash_key",
            "idx_audit_log_single_successor",
        }

        assert apply_database_upgrades(cursor, 46, context) == DB_SCHEMA_VERSION

        after = {
            row[0]
            for row in cursor.execute(
                """SELECT indexname
                     FROM pg_indexes
                    WHERE schemaname = current_schema()
                      AND tablename = 'audit_log'
                      AND indexdef LIKE '%(chain_id, previous_hash)%'"""
            ).fetchall()
        }
        assert after == {"audit_log_chain_id_previous_hash_key"}

        cursor.execute(
            """INSERT INTO audit_chain_heads
                   (chain_id, last_sequence, last_hash)
               VALUES ('fixture-chain', 0, ?)""",
            ("0" * 64,),
        )
        cursor.execute(
            """INSERT INTO audit_log
                   (chain_id, sequence, action, previous_hash, entry_hash)
               VALUES ('fixture-chain', 1, 'fixture', ?, ?)""",
            ("a" * 64, "b" * 64),
        )
        with pytest.raises(psycopg.errors.UniqueViolation), connection.transaction():
            cursor.execute(
                """INSERT INTO audit_log
                       (chain_id, sequence, action, previous_hash, entry_hash)
                   VALUES ('fixture-chain', 2, 'fixture', ?, ?)""",
                ("a" * 64, "c" * 64),
            )
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_v47_fails_closed_when_named_audit_index_is_not_the_exact_twin():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(
            cursor,
            1,
            context,
            target_version=45,
        ) == 45
        cursor.execute(
            "UPDATE database_metadata SET schema_version = 46 WHERE id = 1"
        )
        cursor.execute("DROP INDEX idx_audit_log_single_successor")
        cursor.execute(
            """CREATE UNIQUE INDEX idx_audit_log_single_successor
                   ON audit_log (chain_id, sequence)"""
        )

        with pytest.raises(RuntimeError, match="not an exact duplicate"), (
            connection.transaction()
        ):
            apply_database_upgrades(cursor, 46, context)

        assert cursor.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()[0] == 46
        assert cursor.execute(
            "SELECT to_regclass('idx_audit_log_single_successor') IS NOT NULL"
        ).fetchone()[0]
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_v47_migration_runbook_limits_drop_and_documents_rollback():
    runbook = (
        Path(__file__).resolve().parents[1]
        / "deploy"
        / "runbooks"
        / "database-upgrade-v47.md"
    ).read_text(encoding="utf-8")

    for required in (
        "--preflight",
        "--dry-run",
        "backup",
        "append-only",
        "DROP INDEX IF EXISTS idx_audit_log_single_successor",
        "audit_log_chain_id_previous_hash_key",
        "CREATE UNIQUE INDEX idx_audit_log_single_successor",
        "rollback",
        "không sửa migration v1–v46",
    ):
        assert required.casefold() in runbook.casefold()


def test_v46_failed_type_conversion_rolls_back_catalog_and_version():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(
            cursor,
            1,
            context,
            target_version=45,
        ) == 45
        cursor.execute(
            """INSERT INTO user_notifications
                   (id, user_id, organization_id, kind, title, message, created_at)
               VALUES ('fixture-notification', 'fixture-user', 'fixture-org',
                       'organization_added', 'Fixture title', 'Fixture message',
                       2147483648)"""
        )
        before = _schema_object_oids(cursor)
        connection.commit()
        cursor.execute(
            sql.SQL("SET LOCAL search_path TO {}").format(
                sql.Identifier(schema_name)
            )
        )

        with pytest.raises(psycopg.errors.NumericValueOutOfRange):
            apply_database_upgrades(cursor, 45, context)
        connection.rollback()
        cursor.execute(
            sql.SQL("SET LOCAL search_path TO {}").format(
                sql.Identifier(schema_name)
            )
        )

        assert _schema_object_oids(cursor) == before
        assert cursor.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()[0] == 45
        assert cursor.execute(
            """SELECT created_at FROM user_notifications
                WHERE id = 'fixture-notification'"""
        ).fetchone()[0] == 2147483648
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_v46_migration_runbook_covers_chain_rehearsal_and_rollback():
    runbook = (
        Path(__file__).resolve().parents[1]
        / "deploy"
        / "runbooks"
        / "database-upgrade-v46.md"
    ).read_text(encoding="utf-8")

    for required in (
        "--preflight",
        "--dry-run",
        "postgres_schema_v1.json",
        V1_SOURCE_COMMIT,
        "v35",
        "catalog",
        "foreign key",
        "backup",
        "rollback",
        "append-only",
        "không sửa migration v1–v45",
    ):
        assert required.casefold() in runbook.casefold()


def test_migration_chain_fixtures_leave_public_schema_unchanged():
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
        cursor = PostgresCursor(connection.cursor())
        assert cursor.execute(
            """SELECT COUNT(*) FROM pg_namespace
                WHERE nspname LIKE 'bf_upgrade_v1_%'"""
        ).fetchone()[0] == 0
        assert_schema_contract(cursor)
    finally:
        connection.rollback()
        connection.close()


def test_procurement_binding_history_is_unique_per_local_snapshot():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        assert apply_database_upgrades(
            cursor, 1, _upgrade_context()
        ) == DB_SCHEMA_VERSION
        digest = "sha256:" + "a" * 64
        cursor.execute(
            """INSERT INTO procurement_source_binding (
                   id, organization_id, provider, family_key,
                   plan_revision_uuid, id_detail, local_entity_type,
                   local_root_id, local_snapshot_id, match_method,
                   canonical_fields_json, digest)
               VALUES ('binding-1', 'org-binding-history', 'VNEPS',
                       'PL2600000001', 'plan-revision-01', 'detail-a',
                       'goithau', 'root-a', 'snapshot-a', 'EXACT', '{}', ?)""",
            (digest,),
        )
        cursor.execute(
            """INSERT INTO procurement_source_binding (
                   id, organization_id, provider, family_key,
                   plan_revision_uuid, id_detail, local_entity_type,
                   local_root_id, local_snapshot_id, match_method,
                   canonical_fields_json, digest)
               VALUES ('binding-2', 'org-binding-history', 'VNEPS',
                       'PL2600000001', 'plan-revision-01', 'detail-a',
                       'goithau', 'root-a', 'snapshot-b', 'EXACT', '{}', ?)""",
            (digest,),
        )
        assert cursor.execute(
            """SELECT COUNT(*) FROM procurement_source_binding
                WHERE organization_id = 'org-binding-history'
                  AND plan_revision_uuid = 'plan-revision-01'
                  AND id_detail = 'detail-a'"""
        ).fetchone()[0] == 2
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_unknown_package_status_is_available_after_upgrade_chain():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        assert apply_database_upgrades(
            cursor, 1, _upgrade_context()
        ) == DB_SCHEMA_VERSION
        definition = cursor.execute(
            """SELECT pg_get_constraintdef(oid)
                 FROM pg_constraint
                WHERE connamespace = current_schema()::regnamespace
                  AND conrelid = 'goi_thau'::regclass
                  AND conname = 'goi_thau_trang_thai_check'"""
        ).fetchone()[0]
        assert "'UNKNOWN'::text" in definition
    finally:
        _close_fixture_connection(connection, cursor, schema_name)
