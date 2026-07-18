from .schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    DatabaseUpgradeContext,
    apply_database_upgrades,
    read_database_version,
    record_database_version,
)
from .db_helper import database
import os
import re
from backend.shared.logging_utils import log_error

_ALLOWED_TABLES: frozenset = frozenset()

def _get_allowed_tables() -> frozenset:
    global _ALLOWED_TABLES
    if not _ALLOWED_TABLES:
        _ALLOWED_TABLES = frozenset(SCHEMA_DINH_NGHIA.keys())
    return _ALLOWED_TABLES

def _assert_safe_table(table_name: str) -> str:
    """Kiểm tra tên bảng nằm trong whitelist schema trước khi dùng trong DDL/DML."""
    if table_name not in _get_allowed_tables():
        raise ValueError(f"Tên bảng không hợp lệ hoặc không được phép: '{table_name}'")
    return table_name


def _build_create_table_sql(table_name: str, table_spec: dict) -> str:
    """Build canonical table DDL used by a fresh database installation."""
    cols_def = []
    primary_keys = table_spec.get("primary_keys", [])
    for col_name, col_def in table_spec["columns"].items():
        if primary_keys and col_name in primary_keys:
            clean_def = col_def.replace("PRIMARY KEY", "")
            cols_def.append(f"{col_name} {clean_def}")
        else:
            cols_def.append(f"{col_name} {col_def}")
    if primary_keys:
        cols_def.append(f"PRIMARY KEY ({', '.join(primary_keys)})")
    for constraint in table_spec.get("unique_constraints", []):
        cols_def.append(constraint)
    for fk in table_spec.get("foreign_keys", []):
        cols_def.append(fk)
    return f"CREATE TABLE {table_name} ({', '.join(cols_def)})"


def _normalize_ddl(sql):
    return re.sub(r"\s+", " ", str(sql or "").strip()).lower()


def _assert_schema_contract(cursor):
    """Fail startup when a baseline table or table-level constraint drifts."""
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        row = cursor.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table_name,),
        ).fetchone()
        if not row:
            raise RuntimeError(f"Schema drift: missing table {table_name}.")
        expected = _normalize_ddl(_build_create_table_sql(table_name, table_spec))
        actual = _normalize_ddl(row[0])
        if actual != expected:
            raise RuntimeError(f"Schema drift: table definition changed for {table_name}.")


def _assert_post_baseline_schema(cursor):
    """Validate canonical indexes and triggers that are not table definitions."""
    timeline_columns = [
        "id", "organization_id", "owner_type", "goi_thau_id", "ma_nhom",
        "ten_nhom", "ma_moc", "cong_viec", "don_vi_ban_hanh", "so_van_ban",
        "ngay_du_kien", "ngay_thuc_te", "ghi_chu", "source_key", "source_mode",
        "is_optional", "trang_thai", "sort_order", "template_version",
        "sync_version", "created_at", "updated_at",
    ]
    actual_columns = [
        row[1] for row in cursor.execute("PRAGMA table_info(goi_thau_moc_tien_do)").fetchall()
    ]
    if actual_columns != timeline_columns:
        raise RuntimeError("Schema drift: package timeline table is missing or incompatible.")
    required_indexes = {
        "idx_goi_thau_moc_tien_do_package",
        "idx_goi_thau_moc_tien_do_status",
    }
    actual_indexes = {
        row[1] for row in cursor.execute("PRAGMA index_list(goi_thau_moc_tien_do)").fetchall()
    }
    if not required_indexes <= actual_indexes:
        raise RuntimeError("Schema drift: package timeline indexes are missing.")
    required_timeline_triggers = {
        "trg_goi_thau_moc_tien_do_workspace_owner_insert",
        "trg_goi_thau_moc_tien_do_workspace_owner_update",
    }
    actual_timeline_triggers = {
        row[0]
        for row in cursor.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'goi_thau_moc_tien_do'"
        ).fetchall()
    }
    if not required_timeline_triggers <= actual_timeline_triggers:
        raise RuntimeError("Schema drift: package timeline workspace triggers are missing.")

    required_record_ownership_triggers = {
        "trg_record_edit_ownership_workspace_insert",
        "trg_record_edit_ownership_workspace_update",
    }
    actual_record_ownership_triggers = {
        row[0]
        for row in cursor.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'record_edit_ownership'"
        ).fetchall()
    }
    if not required_record_ownership_triggers <= actual_record_ownership_triggers:
        raise RuntimeError("Schema drift: record ownership workspace triggers are missing.")

    pending_email_columns = [
        "user_id", "current_email_norm", "pending_email", "pending_email_norm",
        "otp_hash", "requested_at", "expires_at", "verified_at", "requested_ip",
    ]
    actual_pending_email_columns = [
        row[1]
        for row in cursor.execute("PRAGMA table_info(pending_email_changes)").fetchall()
    ]
    if actual_pending_email_columns != pending_email_columns:
        raise RuntimeError("Schema drift: pending email change table is missing or incompatible.")
    pending_email_indexes = {
        row[1]
        for row in cursor.execute("PRAGMA index_list(pending_email_changes)").fetchall()
    }
    if "idx_pending_email_changes_expiry" not in pending_email_indexes:
        raise RuntimeError("Schema drift: pending email change expiry index is missing.")
    email_change_trigger = cursor.execute(
        """SELECT 1 FROM sqlite_master
           WHERE type = 'trigger' AND name = 'trg_tai_khoan_verified_email_update'"""
    ).fetchone()
    if not email_change_trigger:
        raise RuntimeError("Schema drift: verified email change trigger is missing.")

    document_capability_columns = [
        "organization_id", "user_id", "financial", "identity", "signature",
        "created_at", "updated_at",
    ]
    actual_document_capability_columns = [
        row[1]
        for row in cursor.execute(
            "PRAGMA table_info(document_export_capabilities)"
        ).fetchall()
    ]
    if actual_document_capability_columns != document_capability_columns:
        raise RuntimeError(
            "Schema drift: document export capability table is missing or incompatible."
        )
    document_capability_indexes = {
        row[1]
        for row in cursor.execute(
            "PRAGMA index_list(document_export_capabilities)"
        ).fetchall()
    }
    if "idx_document_export_capabilities_user" not in document_capability_indexes:
        raise RuntimeError(
            "Schema drift: document export capability index is missing."
        )

    audit_indexes = {
        row[1]: int(row[2])
        for row in cursor.execute("PRAGMA index_list(audit_log)").fetchall()
    }
    if audit_indexes.get("idx_audit_log_single_successor") != 1:
        raise RuntimeError(
            "Schema drift: unique audit-chain successor index is missing."
        )
    audit_successor_columns = [
        row[2]
        for row in cursor.execute(
            "PRAGMA index_info(idx_audit_log_single_successor)"
        ).fetchall()
    ]
    if audit_successor_columns != ["previous_hash"]:
        raise RuntimeError(
            "Schema drift: audit-chain successor index is incompatible."
        )


def _create_baseline_indexes_and_triggers(cursor):
    """Create canonical indexes, invariant triggers and FTS for a fresh database."""
    versioned_tables = ["chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "chuyen_gia", "hop_dong"]
    synced_tables = versioned_tables + ["phan_cong_nhan_su", "trang_thai_ho_so_giay", "thong_tin_mo_thau", "ma_tran_phan_quyen"]
    owner_typed_tables = [
        table_name
        for table_name, table_spec in SCHEMA_DINH_NGHIA.items()
        if "owner_type" in table_spec.get("columns", {})
    ]

    for table in versioned_tables:
        _assert_safe_table(table)
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_updated ON {table} (organization_id, updated_at)")
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_latest ON {table} (organization_id, is_latest)")
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_root ON {table} (organization_id, id_goc)")

    for table in synced_tables:
        _assert_safe_table(table)
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_type_owner ON {table} (owner_type, organization_id)")
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_sync_version ON {table} (organization_id, sync_version)")

    for table in owner_typed_tables:
        _assert_safe_table(table)
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_type_owner ON {table} (owner_type, organization_id)")

    for table, date_column in [
        ("ke_hoach_lcnt", "ngay_phe_duyet"),
        ("goi_thau", "ngay_quyet_dinh"),
        ("hop_dong", "ngay_ky"),
    ]:
        _assert_safe_table(table)
        cursor.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{table}_latest_date "
            f"ON {table} (organization_id, is_latest, archived_at, {date_column})"
        )
        cursor.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{table}_latest_month "
            f"ON {table} (organization_id, is_latest, archived_at, substr({date_column}, 6, 2))"
        )

    for table in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "chuyen_gia", "hop_dong"]:
        _assert_safe_table(table)
        cursor.execute(f"""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_unique_version
            ON {table} (organization_id, COALESCE(NULLIF(id_goc, ''), id), phien_ban)
        """)
        cursor.execute(f"""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_unique_latest
            ON {table} (organization_id, COALESCE(NULLIF(id_goc, ''), id))
            WHERE is_latest = 1
        """)

    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_goi_thau_unique_plan_snapshot_version
        ON goi_thau (organization_id, COALESCE(NULLIF(id_goc, ''), id), phien_ban, ke_hoach_id)
    """)
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_goi_thau_unique_latest
        ON goi_thau (organization_id, COALESCE(NULLIF(id_goc, ''), id), COALESCE(ke_hoach_id, ''))
        WHERE is_latest = 1
    """)

    business_unique_indexes = [
        ("chu_dau_tu", "ma_chu_dau_tu"),
        ("chu_dau_tu", "ma_so_thue"),
        ("ke_hoach_lcnt", "ma_ke_hoach"),
        ("nha_thau", "ma_nha_thau"),
        ("nha_thau", "ma_so_thue"),
        ("chuyen_gia", "so_cccd"),
        ("hop_dong", "so_hop_dong"),
    ]
    for table, column in business_unique_indexes:
        _assert_safe_table(table)
        cursor.execute(f"""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_{column}_owner_latest_unique
            ON {table} (organization_id, lower(trim({column})))
            WHERE is_latest = 1 AND {column} IS NOT NULL AND trim({column}) != ''
        """)
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_goi_thau_ma_goi_thau_owner_plan_latest_unique
        ON goi_thau (organization_id, COALESCE(ke_hoach_id, ''), lower(trim(ma_goi_thau)))
        WHERE is_latest = 1 AND ma_goi_thau IS NOT NULL AND trim(ma_goi_thau) != ''
    """)

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_ke_hoach ON goi_thau (ke_hoach_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_nha_thau_trung ON goi_thau (nha_thau_trung_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ke_hoach_cong_viec_parent ON ke_hoach_cong_viec (organization_id, ke_hoach_id, loai, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_phan_lo_parent ON goi_thau_phan_lo (organization_id, goi_thau_id, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_tuy_chon_parent ON goi_thau_tuy_chon_mua_them (organization_id, goi_thau_id, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_gia_han_parent ON goi_thau_gia_han (organization_id, goi_thau_id, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_lam_ro_parent ON goi_thau_lam_ro (organization_id, goi_thau_id, loai, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_nha_thau_lien_danh_parent ON nha_thau_lien_danh_thanh_vien (organization_id, nha_thau_id, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_mo_thau_lien_danh_parent ON thong_tin_mo_thau_lien_danh_thanh_vien (organization_id, thong_tin_mo_thau_id, sort_order)")
    cursor.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_nha_thau_lien_danh_one_leader
                      ON nha_thau_lien_danh_thanh_vien (organization_id, nha_thau_id)
                      WHERE vai_tro = 'Đứng đầu liên danh'""")
    cursor.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_mo_thau_lien_danh_one_leader
                      ON thong_tin_mo_thau_lien_danh_thanh_vien (organization_id, thong_tin_mo_thau_id)
                      WHERE vai_tro = 'Đứng đầu liên danh'""")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_nha_thau_tham_du_mo_thau_bid ON nha_thau_tham_du_mo_thau (organization_id, thong_tin_mo_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_vong_danh_gia_package ON vong_danh_gia (organization_id, goi_thau_id, thu_tu)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tieu_chi_danh_gia_round ON tieu_chi_danh_gia (organization_id, vong_danh_gia_id, thu_tu)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ket_qua_danh_gia_opening ON ket_qua_danh_gia_nha_thau (organization_id, thong_tin_mo_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_ke_hoach ON hop_dong (ke_hoach_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_chu_dau_tu ON hop_dong (chu_dau_tu_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_nha_thau ON hop_dong (nha_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_goi_thau_owner_hd ON hop_dong_goi_thau (organization_id, hop_dong_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_goi_thau_owner_gt ON hop_dong_goi_thau (organization_id, goi_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_chuyen_gia_owner_gt ON goi_thau_chuyen_gia (organization_id, goi_thau_id, loai)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_chuyen_gia_owner_cg ON goi_thau_chuyen_gia (organization_id, chuyen_gia_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_thong_tin_mo_thau_goi_thau ON thong_tin_mo_thau (goi_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_thong_tin_mo_thau_nha_thau ON thong_tin_mo_thau (nha_thau_id)")
    cursor.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_thong_tin_mo_thau_active_business_key
        ON thong_tin_mo_thau (organization_id, goi_thau_id, nha_thau_id, ma_phan_lo)
        WHERE archived_at IS NULL"""
    )
    cursor.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_phan_cong_owner_target
        ON phan_cong_nhan_su (organization_id, id_muc_tieu, loai_doi_tuong)"""
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active ON auth_sessions (user_id, revoked_at, absolute_expires_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions (idle_expires_at, absolute_expires_at, revoked_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_dinh_danh_ngoai_user ON dinh_danh_ngoai (user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_password_reset_user_active ON password_reset_tokens (user_id, used_at, expires_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_tokens (expires_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit_buckets (expires_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_thanh_vien_to_chuc_to_chuc ON thanh_vien_to_chuc (organization_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_status_expiry ON organization_subscriptions (status, expires_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_account_subscriptions_status_expiry ON account_subscriptions (status, expires_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_api_idempotency_created ON api_idempotency (created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_records_owner_deleted ON deleted_records (organization_id, deleted_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_records_owner_delete_version ON deleted_records (organization_id, delete_version)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_records_owner_table ON deleted_records (organization_id, table_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sync_mutations_owner_created ON sync_mutations (organization_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_owner_created ON audit_log (organization_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created ON audit_log (actor_user_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_action_created ON audit_log (action, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_record_edit_ownership_user ON record_edit_ownership (organization_id, user_id, table_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_moc_tien_do_package ON goi_thau_moc_tien_do (organization_id, goi_thau_id, sort_order, ma_moc)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_moc_tien_do_status ON goi_thau_moc_tien_do (organization_id, trang_thai, ngay_du_kien)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_pending_email_changes_expiry ON pending_email_changes (expires_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_document_export_capabilities_user ON document_export_capabilities (user_id, organization_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_assignment_history_member ON phan_cong_nhan_su_lich_su (organization_id, id_nhan_vien, ended_at)")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_single_successor ON audit_log (previous_hash)")

    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_deleted_records_unique_record
        ON deleted_records (organization_id, table_name, record_id)
    """)
    _ensure_fts_indexes(cursor)
    _ensure_workspace_owner_triggers(cursor, owner_typed_tables)
    _ensure_record_edit_ownership_triggers(cursor)
    _ensure_verified_email_change_trigger(cursor)
    _ensure_delta_sync_triggers(cursor, synced_tables)
    _ensure_assignment_tenant_triggers(cursor)
    _ensure_contract_package_triggers(cursor)
    _ensure_evaluation_actor_triggers(cursor)
    _ensure_lineage_triggers(cursor, versioned_tables)


def _ensure_workspace_owner_triggers(cursor, owner_typed_tables):
    """Validate polymorphic organization/personal scope references."""
    for table_name in owner_typed_tables:
        _assert_safe_table(table_name)
        for operation, event in (("insert", "INSERT"), ("update", "UPDATE OF organization_id, owner_type")):
            trigger_name = f"trg_{table_name}_workspace_owner_{operation}"
            cursor.execute(f"DROP TRIGGER IF EXISTS {trigger_name}")
            cursor.execute(f"""
                CREATE TRIGGER {trigger_name}
                BEFORE {event} ON {table_name}
                FOR EACH ROW
                BEGIN
                    SELECT CASE
                        WHEN NEW.owner_type = 'organization'
                         AND NOT EXISTS (SELECT 1 FROM to_chuc WHERE id = NEW.organization_id)
                        THEN RAISE(ABORT, 'organization workspace does not exist')
                    END;
                    SELECT CASE
                        WHEN NEW.owner_type = 'personal'
                         AND NOT EXISTS (
                             SELECT 1 FROM tai_khoan
                             WHERE id = substr(NEW.organization_id, 10)
                               AND vai_tro != 'super_admin'
                         )
                        THEN RAISE(ABORT, 'personal workspace owner does not exist')
                    END;
                END
            """)


def _ensure_record_edit_ownership_triggers(cursor):
    """Allow record ownership only in a real organization or a user's implicit scope."""
    for operation, event in (
        ("insert", "INSERT"),
        ("update", "UPDATE OF organization_id, user_id"),
    ):
        cursor.execute(
            f"""
            CREATE TRIGGER trg_record_edit_ownership_workspace_{operation}
            BEFORE {event} ON record_edit_ownership
            FOR EACH ROW
            WHEN NOT EXISTS (SELECT 1 FROM to_chuc WHERE id = NEW.organization_id)
             AND NOT (
                 NEW.organization_id = 'personal:' || NEW.user_id
                 AND EXISTS (
                     SELECT 1 FROM tai_khoan
                     WHERE id = NEW.user_id AND vai_tro != 'super_admin'
                 )
             )
            BEGIN
                SELECT RAISE(ABORT, 'record ownership workspace does not exist');
            END
            """
        )


def _ensure_verified_email_change_trigger(cursor):
    """Require a verified, unexpired pending request before changing account email."""
    cursor.execute(
        """
        CREATE TRIGGER trg_tai_khoan_verified_email_update
        BEFORE UPDATE OF email, email_norm ON tai_khoan
        FOR EACH ROW
        WHEN OLD.email_norm IS NOT NEW.email_norm
        BEGIN
            SELECT CASE WHEN NOT EXISTS (
                SELECT 1
                FROM pending_email_changes AS pending
                WHERE pending.user_id = OLD.id
                  AND pending.current_email_norm = OLD.email_norm
                  AND pending.pending_email_norm = NEW.email_norm
                  AND pending.pending_email = NEW.email
                  AND pending.verified_at IS NOT NULL
                  AND pending.verified_at <= pending.expires_at
                  AND CAST(strftime('%s', 'now') AS INTEGER) < pending.expires_at
            ) THEN RAISE(ABORT, 'verified email change required') END;
        END
        """
    )


def _ensure_lineage_triggers(cursor, versioned_tables):
    """Normalize an initial logical root and prevent lineage reassignment."""
    for table_name in versioned_tables:
        _assert_safe_table(table_name)
        fill_trigger = f"trg_{table_name}_lineage_fill"
        immutable_trigger = f"trg_{table_name}_lineage_immutable"
        cursor.execute(f"DROP TRIGGER IF EXISTS {fill_trigger}")
        cursor.execute(f"DROP TRIGGER IF EXISTS {immutable_trigger}")
        cursor.execute(f"""
            CREATE TRIGGER {fill_trigger}
            AFTER INSERT ON {table_name}
            FOR EACH ROW
            WHEN NEW.id_goc IS NULL OR trim(NEW.id_goc) = ''
            BEGIN
                UPDATE {table_name} SET id_goc = NEW.id WHERE id = NEW.id;
            END
        """)
        cursor.execute(f"""
            CREATE TRIGGER {immutable_trigger}
            BEFORE UPDATE OF id_goc ON {table_name}
            FOR EACH ROW
            WHEN OLD.id_goc IS NOT NULL
             AND trim(OLD.id_goc) != ''
             AND NEW.id_goc != OLD.id_goc
            BEGIN
                SELECT RAISE(ABORT, 'LINEAGE_IMMUTABLE');
            END
        """)


def _ensure_assignment_tenant_triggers(cursor):
    """Enforce the polymorphic assignment target inside SQLite.

    ``id_muc_tieu`` can point to one of three tables, so a declarative FK cannot
    express the invariant. Paired INSERT/UPDATE triggers provide the equivalent
    tenant-bound check even when service validation is bypassed.
    """
    condition = """
        NEW.loai_doi_tuong NOT IN ('kehoach', 'goithau', 'hopdong')
        OR (
            NEW.loai_doi_tuong = 'kehoach'
            AND NOT EXISTS (
                SELECT 1 FROM ke_hoach_lcnt
                WHERE organization_id = NEW.organization_id AND id = NEW.id_muc_tieu
            )
        )
        OR (
            NEW.loai_doi_tuong = 'goithau'
            AND NOT EXISTS (
                SELECT 1 FROM goi_thau
                WHERE organization_id = NEW.organization_id AND id = NEW.id_muc_tieu
            )
        )
        OR (
            NEW.loai_doi_tuong = 'hopdong'
            AND NOT EXISTS (
                SELECT 1 FROM hop_dong
                WHERE organization_id = NEW.organization_id AND id = NEW.id_muc_tieu
            )
        )
    """
    for operation in ("INSERT", "UPDATE"):
        trigger_name = f"trg_phan_cong_tenant_{operation.lower()}"
        cursor.execute(f"DROP TRIGGER IF EXISTS {trigger_name}")
        cursor.execute(f"""
            CREATE TRIGGER {trigger_name}
            BEFORE {operation} ON phan_cong_nhan_su
            FOR EACH ROW
            WHEN {condition}
            BEGIN
                SELECT RAISE(ABORT, 'ASSIGNMENT_TENANT_MISMATCH');
            END
        """)


def _ensure_evaluation_actor_triggers(cursor):
    """Keep evaluation actors inside the owning organization."""
    for table_name in ("vong_danh_gia", "ket_qua_danh_gia_nha_thau"):
        for operation in ("INSERT", "UPDATE"):
            trigger_name = f"trg_{table_name}_actor_{operation.lower()}"
            cursor.execute(f"DROP TRIGGER IF EXISTS {trigger_name}")
            cursor.execute(f"""
                CREATE TRIGGER {trigger_name}
                BEFORE {operation} ON {table_name}
                FOR EACH ROW
                WHEN NEW.nguoi_cham_id IS NOT NULL
                 AND NOT EXISTS (
                    SELECT 1 FROM thanh_vien_to_chuc
                    WHERE organization_id = NEW.organization_id
                      AND user_id = NEW.nguoi_cham_id
                 )
                BEGIN
                    SELECT RAISE(ABORT, 'EVALUATION_ACTOR_TENANT_MISMATCH');
                END
            """)


def _ensure_contract_package_triggers(cursor):
    condition = """
        NOT EXISTS (
            SELECT 1
            FROM hop_dong hd
            JOIN ke_hoach_lcnt hdkh
              ON hdkh.organization_id = hd.organization_id AND hdkh.id = hd.ke_hoach_id
            JOIN goi_thau gt
              ON gt.organization_id = NEW.organization_id AND gt.id = NEW.goi_thau_id
            JOIN ke_hoach_lcnt gtkh
              ON gtkh.organization_id = gt.organization_id AND gtkh.id = gt.ke_hoach_id
            WHERE hd.organization_id = NEW.organization_id
              AND hd.id = NEW.hop_dong_id
              AND hd.archived_at IS NULL
              AND gt.archived_at IS NULL
              AND COALESCE(NULLIF(hdkh.id_goc, ''), hdkh.id)
                  = COALESCE(NULLIF(gtkh.id_goc, ''), gtkh.id)
              AND (
                  hd.co_qd_chi_dinh = 1
                  OR (
                      gt.trang_thai = 'AWARDED'
                      AND gt.nha_thau_trung_thau_id IS NOT NULL
                      AND gt.nha_thau_trung_thau_id = hd.nha_thau_id
                  )
              )
        )
    """
    for operation in ("INSERT", "UPDATE"):
        trigger_name = f"trg_hop_dong_goi_thau_business_{operation.lower()}"
        cursor.execute(f"DROP TRIGGER IF EXISTS {trigger_name}")
        cursor.execute(f"""
            CREATE TRIGGER {trigger_name}
            BEFORE {operation} ON hop_dong_goi_thau
            FOR EACH ROW
            WHEN {condition}
            BEGIN
                SELECT RAISE(ABORT, 'CONTRACT_PACKAGE_BUSINESS_MISMATCH');
            END
        """)


def _assert_foreign_key_integrity(cursor):
    violations = cursor.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        sample = ", ".join(
            f"{row[0]}(rowid={row[1]}, parent={row[2]})"
            for row in violations[:5]
        )
        raise RuntimeError(f"Foreign key integrity check failed: {sample}")


def _ensure_fts_indexes(cursor):
    specs = {
        "ke_hoach_lcnt": ["ma_ke_hoach", "ten_ke_hoach", "ten_du_an_du_toan"],
        "goi_thau": ["ma_goi_thau", "ten_goi_thau"],
        "chu_dau_tu": ["ma_chu_dau_tu", "ten_chu_dau_tu", "ten_viet_tat", "ma_so_thue"],
        "nha_thau": ["ma_nha_thau", "ten_nha_thau", "ten_viet_tat", "ma_so_thue"],
        "hop_dong": ["so_hop_dong", "ten_hop_dong"],
    }
    for table, columns in specs.items():
        _assert_safe_table(table)
        fts_table = f"fts_{table}"
        cols_sql = ", ".join(columns)
        new_cols = ", ".join(f"new.{col}" for col in columns)
        changed_terms = [
            "old.organization_id IS NOT new.organization_id",
            "old.id IS NOT new.id",
            *(f"old.{column} IS NOT new.{column}" for column in columns),
        ]
        try:
            cursor.execute(f"DROP TABLE IF EXISTS {fts_table}")
            cursor.execute(f"""
                CREATE VIRTUAL TABLE {fts_table}
                USING fts5(
                    organization_id UNINDEXED,
                    id UNINDEXED,
                    {cols_sql},
                    tokenize='unicode61 remove_diacritics 2'
                )
            """)
            cursor.execute(f"""
                INSERT INTO {fts_table}(rowid, organization_id, id, {cols_sql})
                SELECT rowid, organization_id, id, {cols_sql} FROM {table}
            """)
            cursor.execute(f"DROP TRIGGER IF EXISTS trg_{table}_fts_ai")
            cursor.execute(f"DROP TRIGGER IF EXISTS trg_{table}_fts_ad")
            cursor.execute(f"DROP TRIGGER IF EXISTS trg_{table}_fts_au")
            cursor.execute(f"""
                CREATE TRIGGER trg_{table}_fts_ai AFTER INSERT ON {table}
                BEGIN
                    INSERT OR REPLACE INTO {fts_table}(rowid, organization_id, id, {cols_sql})
                    VALUES (new.rowid, new.organization_id, new.id, {new_cols});
                END
            """)
            cursor.execute(f"""
                CREATE TRIGGER trg_{table}_fts_ad AFTER DELETE ON {table}
                BEGIN
                    DELETE FROM {fts_table} WHERE rowid = old.rowid;
                END
            """)
            cursor.execute(f"""
                CREATE TRIGGER trg_{table}_fts_au AFTER UPDATE ON {table}
                FOR EACH ROW
                WHEN {" OR ".join(changed_terms)}
                BEGIN
                    DELETE FROM {fts_table} WHERE rowid = old.rowid;
                    INSERT OR REPLACE INTO {fts_table}(rowid, organization_id, id, {cols_sql})
                    VALUES (new.rowid, new.organization_id, new.id, {new_cols});
                END
            """)
        except Exception as exc:
            log_error(exc, f"Database.FTS.{table}", level="WARNING")


def _ensure_delta_sync_triggers(cursor, synced_tables):
    """Keep version-based delta sync working for direct SQLite edits outside the API."""
    for table in synced_tables:
        _assert_safe_table(table)
        cursor.execute(f"DROP TRIGGER IF EXISTS trg_{table}_updated_at")
        cursor.execute(f"DROP TRIGGER IF EXISTS trg_{table}_deleted_log")

        cursor.execute(f"""
            CREATE TRIGGER trg_{table}_updated_at
            AFTER UPDATE ON {table}
            FOR EACH ROW
            WHEN OLD.updated_at = NEW.updated_at
             AND COALESCE(OLD.sync_version, 0) = COALESCE(NEW.sync_version, 0)
             AND NEW.organization_id IS NOT NULL
             AND NEW.organization_id != ''
            BEGIN
                INSERT OR IGNORE INTO sync_metadata (organization_id, current_version)
                VALUES (NEW.organization_id, 0);

                UPDATE sync_metadata
                SET current_version = current_version + 1,
                    updated_at = datetime('now')
                WHERE organization_id = NEW.organization_id;

                UPDATE {table}
                SET updated_at = datetime('now'),
                    sync_version = (
                        SELECT current_version
                        FROM sync_metadata
                        WHERE organization_id = NEW.organization_id
                    )
                WHERE id = NEW.id;
            END
        """)

        cursor.execute(f"""
            CREATE TRIGGER trg_{table}_deleted_log
            AFTER DELETE ON {table}
            FOR EACH ROW
            WHEN OLD.organization_id IS NOT NULL
             AND OLD.organization_id != ''
            BEGIN
                INSERT OR IGNORE INTO sync_metadata (organization_id, current_version)
                VALUES (OLD.organization_id, 0);

                UPDATE sync_metadata
                SET current_version = current_version + 1,
                    updated_at = datetime('now')
                WHERE organization_id = OLD.organization_id;

                INSERT INTO deleted_records (table_name, record_id, organization_id, deleted_at, delete_version)
                VALUES (
                    '{table}',
                    OLD.id,
                    OLD.organization_id,
                    datetime('now'),
                    (SELECT current_version FROM sync_metadata WHERE organization_id = OLD.organization_id)
                )
                ON CONFLICT(organization_id, table_name, record_id) DO UPDATE SET
                    deleted_at = excluded.deleted_at,
                    delete_version = MAX(
                        COALESCE(deleted_records.delete_version, 0),
                        COALESCE(excluded.delete_version, 0)
                    );
            END
        """)


def _chunks(values, size=200):
    values = tuple(values)
    for start in range(0, len(values), size):
        yield values[start:start + size]


def recalculate_is_latest(
    cursor,
    table_name,
    organization_id=None,
    *,
    affected_families=None,
):
    """Recompute only affected version families and update changed flags only.

    Family keys are lineage-root strings for normal versioned tables and
    ``(lineage_root, plan_id)`` pairs for ``goi_thau`` plan snapshots. Passing
    ``None`` retains the full-scope maintenance behavior; an empty iterable is
    an intentional no-op.
    """
    _assert_safe_table(table_name)
    is_package = table_name == "goi_thau"
    root_expr = "COALESCE(NULLIF(business.id_goc, ''), business.id)"
    partition_expr = f"business.organization_id, {root_expr}"
    if is_package:
        partition_expr += ", COALESCE(business.ke_hoach_id, '')"

    if affected_families is None:
        batches = (None,)
    else:
        if is_package:
            normalized = sorted({
                (str(root_id or "").strip(), str(plan_id or "").strip())
                for root_id, plan_id in affected_families
                if str(root_id or "").strip()
            })
        else:
            normalized = sorted({
                str(root_id or "").strip()
                for root_id in affected_families
                if str(root_id or "").strip()
            })
        if not normalized:
            return 0
        batches = _chunks(normalized)

    changed_rows = 0
    for family_batch in batches:
        params = []
        affected_cte = ""
        scope_join = ""
        if family_batch is not None:
            if is_package:
                values_sql = ", ".join("(?, ?)" for _ in family_batch)
                affected_cte = f"affected(root_id, plan_id) AS (VALUES {values_sql}),"
                for root_id, plan_id in family_batch:
                    params.extend((root_id, plan_id))
                scope_join = (
                    f"JOIN affected ON affected.root_id = {root_expr} "
                    "AND affected.plan_id = COALESCE(business.ke_hoach_id, '')"
                )
            else:
                values_sql = ", ".join("(?)" for _ in family_batch)
                affected_cte = f"affected(root_id) AS (VALUES {values_sql}),"
                params.extend(family_batch)
                scope_join = f"JOIN affected ON affected.root_id = {root_expr}"

        scope_filter = ""
        scoped_params = []
        if organization_id:
            scope_filter = "WHERE business.organization_id = ?"
            scoped_params.append(organization_id)
        ranked_filter = (
            f"{scope_filter} AND business.archived_at IS NULL"
            if scope_filter
            else "WHERE business.archived_at IS NULL"
        )
        params.extend(scoped_params)
        params.extend(scoped_params)

        cursor.execute(f"""
            WITH {affected_cte}
            scoped_rows AS (
                SELECT business.id
                FROM {table_name} AS business
                {scope_join}
                {scope_filter}
            ),
            ranked AS (
                SELECT
                    business.id,
                    ROW_NUMBER() OVER (
                        PARTITION BY {partition_expr}
                        ORDER BY CAST(business.phien_ban AS INTEGER) DESC,
                                 business.updated_at DESC,
                                 business.id DESC
                    ) AS rn
                FROM {table_name} AS business
                {scope_join}
                {ranked_filter}
            ),
            winners AS (
                SELECT id FROM ranked WHERE rn = 1
            ),
            desired AS (
                SELECT scoped_rows.id,
                       CASE WHEN winners.id IS NULL THEN 0 ELSE 1 END AS desired_is_latest
                FROM scoped_rows
                LEFT JOIN winners ON winners.id = scoped_rows.id
            )
            UPDATE {table_name}
            SET is_latest = (
                SELECT desired_is_latest FROM desired
                WHERE desired.id = {table_name}.id
            )
            WHERE id IN (
                SELECT desired.id
                FROM desired
                WHERE desired.desired_is_latest != {table_name}.is_latest
            )
        """, tuple(params))
        changed_rows += int(cursor.execute("SELECT changes()").fetchone()[0])
    return changed_rows


def recalculate_tong_muc_dau_tu(cursor, organization_id=None, *, plan_ids=None):
    """Set-based recalculation for active automatic plans, optionally targeted."""
    if plan_ids is None:
        batches = (None,)
    else:
        normalized = sorted({str(plan_id or "").strip() for plan_id in plan_ids if str(plan_id or "").strip()})
        if not normalized:
            return 0
        batches = _chunks(normalized)

    changed_rows = 0
    for plan_batch in batches:
        filters = ["plan.is_tong_muc_tu_dong = 1", "plan.archived_at IS NULL"]
        params = []
        if organization_id:
            filters.append("plan.organization_id = ?")
            params.append(organization_id)
        if plan_batch is not None:
            placeholders = ", ".join("?" for _ in plan_batch)
            filters.append(f"plan.id IN ({placeholders})")
            params.extend(plan_batch)

        cursor.execute(f"""
            WITH target_plans AS (
                SELECT plan.id, plan.organization_id, plan.loai_hinh_mua_sam
                FROM ke_hoach_lcnt AS plan
                WHERE {" AND ".join(filters)}
            ),
            package_totals AS (
                SELECT package.organization_id,
                       package.ke_hoach_id AS plan_id,
                       SUM(COALESCE(package.gia_goi_thau, 0)) AS package_total
                FROM goi_thau AS package
                JOIN target_plans AS plan
                  ON plan.organization_id = package.organization_id
                 AND plan.id = package.ke_hoach_id
                WHERE package.is_latest = 1
                  AND package.archived_at IS NULL
                  AND package.is_rebid = 0
                GROUP BY package.organization_id, package.ke_hoach_id
            ),
            work_totals AS (
                SELECT work.organization_id,
                       work.ke_hoach_id AS plan_id,
                       SUM(CASE WHEN work.loai = 'da_thuc_hien' THEN COALESCE(work.gia_tri, 0) ELSE 0 END) AS completed_total,
                       SUM(CASE WHEN work.loai = 'khong_ap_dung' THEN COALESCE(work.gia_tri, 0) ELSE 0 END) AS excluded_total,
                       SUM(CASE WHEN work.loai = 'chua_du_dieu_kien' THEN COALESCE(work.gia_tri, 0) ELSE 0 END) AS pending_total
                FROM ke_hoach_cong_viec AS work
                JOIN target_plans AS plan
                  ON plan.organization_id = work.organization_id
                 AND plan.id = work.ke_hoach_id
                GROUP BY work.organization_id, work.ke_hoach_id
            ),
            totals AS (
                SELECT plan.id,
                       plan.organization_id,
                       CASE WHEN plan.loai_hinh_mua_sam = 'Dự án'
                            THEN COALESCE(work.completed_total, 0)
                               + COALESCE(work.excluded_total, 0)
                               + COALESCE(work.pending_total, 0)
                               + COALESCE(package.package_total, 0)
                            ELSE COALESCE(work.excluded_total, 0)
                               + COALESCE(work.pending_total, 0)
                               + COALESCE(package.package_total, 0)
                       END AS total
                FROM target_plans AS plan
                LEFT JOIN package_totals AS package
                  ON package.organization_id = plan.organization_id
                 AND package.plan_id = plan.id
                LEFT JOIN work_totals AS work
                  ON work.organization_id = plan.organization_id
                 AND work.plan_id = plan.id
            )
            UPDATE ke_hoach_lcnt
            SET tong_muc_dau_tu = (
                SELECT totals.total
                FROM totals
                WHERE totals.organization_id = ke_hoach_lcnt.organization_id
                  AND totals.id = ke_hoach_lcnt.id
            )
            WHERE EXISTS (
                SELECT 1
                FROM totals
                WHERE totals.organization_id = ke_hoach_lcnt.organization_id
                  AND totals.id = ke_hoach_lcnt.id
                  AND ke_hoach_lcnt.tong_muc_dau_tu IS NOT totals.total
            )
        """, tuple(params))
        changed_rows += int(cursor.execute("SELECT changes()").fetchone()[0])
    return changed_rows


def _create_fresh_database(cursor, context):
    """Create the complete current schema without replaying historical upgrades."""
    import time

    from backend.auth.auth_helper import hash_password
    from backend.auth.identity import normalize_email, normalize_username
    from backend.auth.password_policy import validate_new_password
    from backend.db.id_utils import generate_record_id, stable_org_id
    from backend.documents.word_defaults import ensure_default_word_mappings_for_all_orgs

    existing_application_tables = {
        row[0]
        for row in cursor.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
        if row[0] in SCHEMA_DINH_NGHIA
    }
    if existing_application_tables:
        raise RuntimeError(
            "The clean schema baseline requires an empty database; existing tables: "
            + ", ".join(sorted(existing_application_tables))
        )

    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        cursor.execute(context.build_create_table_sql(table_name, table_spec))

    cursor.executemany(
        """INSERT INTO goi_dich_vu
           (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta)
           VALUES (?, ?, ?, ?, ?)""",
        [
            (
                "silver",
                "Gói Bạc (Silver)",
                15_000_000,
                5,
                "Phù hợp với đơn vị quy mô nhỏ, quản lý tối đa 5 nhân sự.",
            ),
            (
                "gold",
                "Gói Vàng (Gold)",
                35_000_000,
                15,
                "Giải pháp cho phòng thầu chuyên nghiệp, tối đa 15 nhân sự.",
            ),
            (
                "diamond",
                "Gói Kim Cương (Diamond)",
                75_000_000,
                999,
                "Gói quản trị không giới hạn số lượng nhân sự.",
            ),
        ],
    )

    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    password_valid, password_error = validate_new_password(admin_password)
    if not password_valid:
        raise RuntimeError(
            f"ADMIN_PASSWORD does not satisfy password policy: {password_error}"
        )
    admin_id = generate_record_id("tai_khoan")
    admin_name = os.environ.get("ADMIN_NAME", "Administrator").strip() or "Administrator"
    admin_username = normalize_username(os.environ.get("ADMIN_USERNAME", "admin"))
    admin_email = normalize_email(os.environ.get("ADMIN_EMAIL", "admin@localhost"))
    organization_name = os.environ.get("DEFAULT_ORG_NAME", "HTD").strip() or "HTD"
    organization_id = stable_org_id(organization_name)
    cursor.execute(
        """
        INSERT INTO tai_khoan (
            id, ten_dang_nhap, username_norm, mat_khau, ho_ten, vai_tro,
            email, email_norm, da_xac_minh
        ) VALUES (?, ?, ?, ?, ?, 'super_admin', ?, ?, 1)
        """,
        (
            admin_id,
            admin_username,
            admin_username,
            hash_password(admin_password),
            admin_name,
            admin_email,
            admin_email,
        ),
    )
    cursor.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
        (organization_id, organization_name),
    )
    cursor.execute(
        """INSERT INTO thanh_vien_to_chuc
           (user_id, organization_id, vai_tro_trong_to_chuc)
           VALUES (?, ?, 'manager')""",
        (admin_id, organization_id),
    )
    now = int(time.time())
    cursor.execute(
        """
        INSERT INTO organization_subscriptions (
            organization_id, package_id, status, starts_at, expires_at,
            member_quota
        ) VALUES (?, 'diamond', 'active', ?, ?, 999)
        """,
        (organization_id, now, now + 3650 * 24 * 60 * 60),
    )
    cursor.execute(
        "INSERT INTO sync_metadata (organization_id, current_version) VALUES (?, 1)",
        (organization_id,),
    )

    context.create_indexes_and_triggers(cursor)
    ensure_default_word_mappings_for_all_orgs(cursor)
    record_database_version(cursor, DB_SCHEMA_VERSION)

    missing_tables = sorted(
        set(SCHEMA_DINH_NGHIA)
        - {
            row[0]
            for row in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    )
    if missing_tables:
        raise RuntimeError(
            "Fresh database initialization did not create: "
            + ", ".join(missing_tables)
        )
    context.assert_foreign_key_integrity(cursor)
    return DB_SCHEMA_VERSION


def khoi_tao_va_di_tru_he_thong():
    """Initialize a fresh schema or apply future upgrades from one registry file."""
    conn = None
    try:
        conn = database.get_connection()
        cursor = conn.cursor()

        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("BEGIN IMMEDIATE")
        context = DatabaseUpgradeContext(
            build_create_table_sql=_build_create_table_sql,
            create_indexes_and_triggers=_create_baseline_indexes_and_triggers,
            assert_foreign_key_integrity=_assert_foreign_key_integrity,
        )
        installed_version = read_database_version(cursor)
        if installed_version is None:
            version = _create_fresh_database(cursor, context)
        else:
            version = apply_database_upgrades(cursor, installed_version, context)
        if version != DB_SCHEMA_VERSION:
            raise RuntimeError(
                f"Database initialization stopped at unexpected version {version}."
            )
        _assert_schema_contract(cursor)
        _assert_post_baseline_schema(cursor)
        _assert_foreign_key_integrity(cursor)

        conn.commit()
        if os.environ.get("APP_DEBUG", "False").lower() == "true":
            log_error(
                f"Database schema ready (version {version}).",
                "Database",
                level="INFO",
            )
    except Exception as e:
        if conn:
            conn.rollback()
        log_error(e, "Database.Migration")
        raise
    finally:
        if conn:
            conn.close()
