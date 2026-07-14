from .schema import SCHEMA_DINH_NGHIA
from backend.db.migration_runner import MigrationContext, run_migrations
from backend.db.migrations import MIGRATIONS
from .db_helper import database
import re

DB_SCHEMA_VERSION = MIGRATIONS[-1].VERSION if MIGRATIONS else 0


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
    """Build canonical table DDL used by the clean baseline migration."""
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


def _create_baseline_indexes_and_triggers(cursor):
    """Create indexes, invariant triggers and FTS exactly once in migration 0001."""
    versioned_tables = ["chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "chuyen_gia", "hop_dong"]
    synced_tables = versioned_tables + ["phan_cong_nhan_su", "trang_thai_ho_so_giay", "thong_tin_mo_thau", "ma_tran_phan_quyen"]
    owner_typed_tables = synced_tables + ["cau_hinh_bien_word"]

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
            ON {table} (organization_id, {column})
            WHERE is_latest = 1 AND {column} IS NOT NULL AND {column} != ''
        """)
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_goi_thau_ma_goi_thau_owner_plan_latest_unique
        ON goi_thau (organization_id, COALESCE(ke_hoach_id, ''), ma_goi_thau)
        WHERE is_latest = 1 AND ma_goi_thau IS NOT NULL AND ma_goi_thau != ''
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
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_phan_cong_owner_target ON phan_cong_nhan_su (organization_id, id_muc_tieu, loai_doi_tuong)")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tai_khoan_token ON tai_khoan (token_phien) WHERE token_phien IS NOT NULL AND token_phien != ''")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_dinh_danh_ngoai_user ON dinh_danh_ngoai (user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_password_reset_user_active ON password_reset_tokens (user_id, used_at, expires_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_tokens (expires_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit_buckets (expires_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_thanh_vien_to_chuc_to_chuc ON thanh_vien_to_chuc (organization_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_status_expiry ON organization_subscriptions (status, expires_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_api_idempotency_created ON api_idempotency (created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_records_owner_deleted ON deleted_records (organization_id, deleted_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_records_owner_delete_version ON deleted_records (organization_id, delete_version)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_records_owner_table ON deleted_records (organization_id, table_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sync_mutations_owner_created ON sync_mutations (organization_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_owner_created ON audit_log (organization_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created ON audit_log (actor_user_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_action_created ON audit_log (action, created_at)")

    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_deleted_records_unique_record
        ON deleted_records (organization_id, table_name, record_id)
    """)
    _ensure_fts_indexes(cursor)
    _ensure_delta_sync_triggers(cursor, synced_tables)
    _ensure_assignment_tenant_triggers(cursor)


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
        old_cols = ", ".join(f"old.{col}" for col in columns)
        try:
            cursor.execute(f"""
                CREATE VIRTUAL TABLE IF NOT EXISTS {fts_table}
                USING fts5(
                    organization_id UNINDEXED,
                    id UNINDEXED,
                    {cols_sql},
                    content='{table}',
                    content_rowid='rowid'
                )
            """)
            cursor.execute(f"INSERT INTO {fts_table}({fts_table}) VALUES('rebuild')")
            cursor.execute(f"DROP TRIGGER IF EXISTS trg_{table}_fts_ai")
            cursor.execute(f"DROP TRIGGER IF EXISTS trg_{table}_fts_ad")
            cursor.execute(f"DROP TRIGGER IF EXISTS trg_{table}_fts_au")
            cursor.execute(f"""
                CREATE TRIGGER trg_{table}_fts_ai AFTER INSERT ON {table}
                BEGIN
                    INSERT INTO {fts_table}(rowid, organization_id, id, {cols_sql})
                    VALUES (new.rowid, new.organization_id, new.id, {new_cols});
                END
            """)
            cursor.execute(f"""
                CREATE TRIGGER trg_{table}_fts_ad AFTER DELETE ON {table}
                BEGIN
                    INSERT INTO {fts_table}({fts_table}, rowid, organization_id, id, {cols_sql})
                    VALUES ('delete', old.rowid, old.organization_id, old.id, {old_cols});
                END
            """)
            cursor.execute(f"""
                CREATE TRIGGER trg_{table}_fts_au AFTER UPDATE ON {table}
                BEGIN
                    INSERT INTO {fts_table}({fts_table}, rowid, organization_id, id, {cols_sql})
                    VALUES ('delete', old.rowid, old.organization_id, old.id, {old_cols});
                    INSERT INTO {fts_table}(rowid, organization_id, id, {cols_sql})
                    VALUES (new.rowid, new.organization_id, new.id, {new_cols});
                END
            """)
        except Exception as exc:
            print(f"FTS5 is not available for {table}; LIKE search fallback will be used: {exc}")


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


def recalculate_is_latest(cursor, table_name, organization_id=None):
    """
    Tính lại cờ is_latest cho bảng versioned (chu_dau_tu, ke_hoach_lcnt, goi_thau, nha_thau).
    Hàm dùng chung — tránh duplicate logic giữa sync_api và các tác vụ bảo trì.

    Args:
        cursor: DB cursor đang mở
        table_name: Tên bảng cần cập nhật
        organization_id: Nếu cung cấp, chỉ cập nhật bản ghi của owner đó (dùng khi sync).
                  Nếu None, cập nhật toàn bộ.
    """
    partition_expr = (
        "CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END, COALESCE(ke_hoach_id, '')"
        if table_name == "goi_thau"
        else "CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END"
    )

    if organization_id:
        cursor.execute(f"UPDATE {table_name} SET is_latest = 0 WHERE organization_id = ?", (organization_id,))
        cursor.execute(f"""
            UPDATE {table_name} SET is_latest = 1 WHERE organization_id = ? AND id IN (
                SELECT id FROM (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            PARTITION BY {partition_expr}
                            ORDER BY CAST(phien_ban AS INTEGER) DESC, updated_at DESC, id DESC
                        ) AS rn
                    FROM {table_name}
                    WHERE organization_id = ? AND archived_at IS NULL
                )
                WHERE rn = 1
            )
        """, (organization_id, organization_id))
    else:
        cursor.execute(f"UPDATE {table_name} SET is_latest = 0")
        cursor.execute(f"""
            UPDATE {table_name} SET is_latest = 1 WHERE id IN (
                SELECT id FROM (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            PARTITION BY {partition_expr}
                            ORDER BY CAST(phien_ban AS INTEGER) DESC, updated_at DESC, id DESC
                        ) AS rn
                    FROM {table_name}
                    WHERE archived_at IS NULL
                )
                WHERE rn = 1
            )
        """)



def recalculate_tong_muc_dau_tu(cursor, organization_id=None):
    """
    Tính lại tong_muc_dau_tu cho cac ke_hoach_lcnt co is_tong_muc_tu_dong = 1
    dua tren logic tong gia_goi_thau, cv_da_thuc_hien, cv_khong_ap_dung, cv_chua_du_dieu_kien.
    """
    if organization_id:
        cursor.execute("""
            SELECT id, loai_hinh_mua_sam
            FROM ke_hoach_lcnt
            WHERE organization_id = ? AND is_tong_muc_tu_dong = 1
        """, (organization_id,))
    else:
        cursor.execute("""
            SELECT id, loai_hinh_mua_sam
            FROM ke_hoach_lcnt
            WHERE is_tong_muc_tu_dong = 1 AND archived_at IS NULL
        """)
    plans = cursor.fetchall()

    for row in plans:
        plan_id = row[0]
        loai_hinh = row[1]

        cursor.execute("""
            SELECT gia_goi_thau
            FROM goi_thau
            WHERE ke_hoach_id = ? AND is_latest = 1 AND archived_at IS NULL
        """, (plan_id,))
        sum_iv = sum(int(item[0] or 0) for item in cursor.fetchall())

        cursor.execute("""
            SELECT loai, gia_tri
            FROM ke_hoach_cong_viec
            WHERE ke_hoach_id = ?
        """, (plan_id,))
        cv_sums = {}
        for item in cursor.fetchall():
            cv_sums[item[0]] = cv_sums.get(item[0], 0) + int(item[1] or 0)
        sum_i = cv_sums.get("da_thuc_hien", 0)
        sum_ii = cv_sums.get("khong_ap_dung", 0)
        sum_iii = cv_sums.get("chua_du_dieu_kien", 0)

        is_project = (loai_hinh == 'Dự án')
        if is_project:
            total = sum_i + sum_ii + sum_iii + sum_iv
        else:
            total = sum_ii + sum_iii + sum_iv

        cursor.execute("""
            UPDATE ke_hoach_lcnt
            SET tong_muc_dau_tu = ?
            WHERE id = ?
        """, (total, plan_id))


def khoi_tao_va_di_tru_he_thong():
    """Apply immutable, ordered migrations to a clean or already-versioned DB."""
    conn = None
    try:
        conn = database.get_connection()
        cursor = conn.cursor()

        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("BEGIN IMMEDIATE")
        version = run_migrations(
            cursor,
            MigrationContext(
                build_create_table_sql=_build_create_table_sql,
                create_indexes_and_triggers=_create_baseline_indexes_and_triggers,
                assert_foreign_key_integrity=_assert_foreign_key_integrity,
            ),
        )
        if version != DB_SCHEMA_VERSION:
            raise RuntimeError(f"Migration runner stopped at unexpected version {version}.")
        _assert_schema_contract(cursor)
        _assert_foreign_key_integrity(cursor)

        conn.commit()
        print(f"[DB] Database migrations applied successfully (version {version}).")
    except Exception as e:
        if conn:
            conn.rollback()
        print("[DB] Database schema initialization/synchronization failed:", e)
        raise
    finally:
        if conn:
            conn.close()
