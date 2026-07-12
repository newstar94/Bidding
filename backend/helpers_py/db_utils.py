from .schema import SCHEMA_DINH_NGHIA
from .auth_helper import hash_password
from .id_utils import generate_record_id, stable_org_id
from .word_defaults import ensure_default_word_mappings_for_all_orgs
import os
import uuid
import re
import json
from .db_helper import database

DB_SCHEMA_VERSION = 1


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


def _normalize_sqlite_type(type_name: str) -> str:
    type_name = (type_name or "").strip().upper()
    if not type_name:
        return "TEXT"
    if "INT" in type_name:
        return "INTEGER"
    if "CHAR" in type_name or "CLOB" in type_name or "TEXT" in type_name:
        return "TEXT"
    if "BLOB" in type_name:
        return "BLOB"
    if "REAL" in type_name or "FLOA" in type_name or "DOUB" in type_name:
        return "REAL"
    return type_name


def _build_create_table_sql(table_name: str, table_spec: dict) -> str:
    """Xây dựng câu lệnh CREATE TABLE từ table_spec — dùng chung khi tạo mới và khi rebuild."""
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


def _sync_table_schema(cursor, table_name: str, table_spec: dict):
    """Keep an existing DB aligned with SCHEMA_DINH_NGHIA for future schema changes."""
    _assert_safe_table(table_name)
    expected_cols = table_spec["columns"]

    cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
    table_row = cursor.fetchone()
    if not table_row:
        cursor.execute(_build_create_table_sql(table_name, table_spec))
        return "created"
    current_create_sql = table_row[0] or ""

    cursor.execute(f"PRAGMA table_info({table_name})")
    current_info = cursor.fetchall()
    current_cols = {row[1]: row for row in current_info}

    expected_names = list(expected_cols.keys())
    current_names = list(current_cols.keys())
    rebuild_needed = expected_names != current_names or "_schema_sync_" in current_create_sql

    if not rebuild_needed:
        for col_name, col_def in expected_cols.items():
            expected_type = _normalize_sqlite_type(col_def.split()[0])
            current_type = _normalize_sqlite_type(current_cols[col_name][2])
            if expected_type != current_type:
                rebuild_needed = True
                break
            expected_not_null = "NOT NULL" in col_def.upper()
            current_not_null = bool(current_cols[col_name][3])
            if expected_not_null and not current_not_null:
                rebuild_needed = True
                break

    if not rebuild_needed:
        return "unchanged"

    temp_table = f"_schema_sync_{table_name}_{uuid.uuid4().hex[:8]}"
    common_cols = [col for col in expected_names if col in current_cols]
    cursor.execute("PRAGMA legacy_alter_table = ON")
    try:
        cursor.execute(f"ALTER TABLE {table_name} RENAME TO {temp_table}")
        cursor.execute(_build_create_table_sql(table_name, table_spec))
        if common_cols:
            cols_sql = ", ".join(common_cols)
            cursor.execute(f"INSERT INTO {table_name} ({cols_sql}) SELECT {cols_sql} FROM {temp_table}")
        cursor.execute(f"DROP TABLE {temp_table}")
        return "rebuilt"
    finally:
        cursor.execute("PRAGMA legacy_alter_table = OFF")


def _normalize_contractor_code(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").strip().lower())


def _backfill_member_contractor_versions(cursor):
    cursor.execute("""
        SELECT id, owner_id, ma_nha_thau, ma_so_thue, phien_ban,
               COALESCE(NULLIF(ngay_ap_dung, ''), substr(COALESCE(created_at, updated_at, ''), 1, 10)) AS effective_date
        FROM nha_thau
    """)
    candidates_by_code = {}
    for row in cursor.fetchall():
        candidate = dict(row)
        for raw_code in (candidate.get("ma_nha_thau"), candidate.get("ma_so_thue")):
            code = _normalize_contractor_code(raw_code)
            if code:
                candidates_by_code.setdefault((candidate.get("owner_id"), code), {})[candidate["id"]] = candidate

    def choose(owner_id, raw_code, reference_time):
        code = _normalize_contractor_code(raw_code)
        candidates = list(candidates_by_code.get((owner_id, code), {}).values())
        if not candidates:
            return None
        reference_date = str(reference_time or "")[:10]
        older = [item for item in candidates if not reference_date or (item.get("effective_date") or "") <= reference_date]
        pool = older or candidates
        if older:
            return max(pool, key=lambda item: (item.get("effective_date") or "", int(item.get("phien_ban") or 0)))["id"]
        return min(pool, key=lambda item: (int(item.get("phien_ban") or 0), item.get("effective_date") or ""))["id"]

    specs = [
        (
            "thong_tin_mo_thau_lien_danh_thanh_vien",
            """
                SELECT member.id, member.owner_id, member.ma_nha_thau, member.ma_so_thue,
                       COALESCE(pkg.thoi_gian_mo_thau, pkg.thoi_gian_mo_ehsdxtc, bid.created_at, bid.updated_at, '') AS reference_time
                FROM thong_tin_mo_thau_lien_danh_thanh_vien member
                JOIN thong_tin_mo_thau bid ON bid.id = member.thong_tin_mo_thau_id
                JOIN goi_thau pkg ON pkg.id = bid.goi_thau_id
                WHERE COALESCE(member.thanh_vien_nha_thau_id, '') = ''
            """,
        ),
        (
            "nha_thau_lien_danh_thanh_vien",
            """
                SELECT member.id, member.owner_id, member.ma_nha_thau, member.ma_so_thue,
                       COALESCE(parent.ngay_ap_dung, parent.created_at, parent.updated_at, '') AS reference_time
                FROM nha_thau_lien_danh_thanh_vien member
                JOIN nha_thau parent ON parent.id = member.nha_thau_id
                WHERE COALESCE(member.thanh_vien_nha_thau_id, '') = ''
            """,
        ),
    ]
    for table_name, select_sql in specs:
        cursor.execute(select_sql)
        for row in cursor.fetchall():
            item = dict(row)
            contractor_id = choose(
                item.get("owner_id"),
                item.get("ma_nha_thau") or item.get("ma_so_thue"),
                item.get("reference_time") or "",
            )
            if contractor_id:
                cursor.execute(
                    f"UPDATE {table_name} SET thanh_vien_nha_thau_id = ? WHERE id = ?",
                    (contractor_id, item["id"]),
                )


def _backfill_partner_effective_dates(cursor):
    """Every partner version must have a deterministic effective date."""
    for table_name in ("chu_dau_tu", "nha_thau"):
        _assert_safe_table(table_name)
        cursor.execute(
            f"""
            UPDATE {table_name}
            SET ngay_ap_dung = substr(COALESCE(NULLIF(created_at, ''), NULLIF(updated_at, ''), datetime('now', 'localtime')), 1, 10)
            WHERE COALESCE(ngay_ap_dung, '') = ''
            """
        )


def _clear_competitive_quotation_appraisal(cursor):
    """Remove legacy appraisal data that is not applicable to competitive quotations."""
    cursor.execute("SELECT id, hinh_thuc_lua_chon, danh_gia_hsdt_metadata FROM goi_thau")
    for row in cursor.fetchall():
        item = dict(row)
        if str(item.get("hinh_thuc_lua_chon") or "").strip().lower() != "chào hàng cạnh tranh":
            continue
        raw_metadata = item.get("danh_gia_hsdt_metadata")
        try:
            metadata = json.loads(raw_metadata) if raw_metadata else {}
        except (TypeError, ValueError, json.JSONDecodeError):
            metadata = {}
        if isinstance(metadata.get("technical"), dict):
            metadata["technical"].pop("soBctdKt", None)
            metadata["technical"].pop("ngayBctdKt", None)
        if isinstance(metadata.get("result"), dict):
            metadata["result"].pop("soBctdKetQua", None)
            metadata["result"].pop("ngayBctdKetQua", None)
        cursor.execute(
            """
            UPDATE goi_thau
            SET yeu_cau_tham_dinh_hsmt = 'Không',
                so_bao_cao_tham_dinh_hsmt = '',
                ngay_bao_cao_tham_dinh_hsmt = '',
                danh_gia_hsdt_metadata = ?
            WHERE id = ?
            """,
            (json.dumps(metadata, ensure_ascii=False), item["id"]),
        )
        cursor.execute(
            "DELETE FROM goi_thau_chuyen_gia WHERE goi_thau_id = ? AND loai = 'tham_dinh'",
            (item["id"],),
        )


def _ensure_schema_version_tables(cursor):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS schema_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_version INTEGER,
            to_version INTEGER NOT NULL,
            action TEXT NOT NULL,
            details TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)
    cursor.execute("PRAGMA user_version")
    row = cursor.fetchone()
    return int(row[0] if row else 0)


def _record_schema_version(cursor, previous_version: int, schema_actions):
    schema_actions = [action for action in schema_actions if action[1] != "unchanged"]
    cursor.execute(f"PRAGMA user_version = {DB_SCHEMA_VERSION}")
    cursor.execute("""
        INSERT INTO schema_metadata (key, value, updated_at)
        VALUES ('schema_version', ?, datetime('now', 'localtime'))
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
    """, (str(DB_SCHEMA_VERSION),))

    if previous_version != DB_SCHEMA_VERSION or schema_actions:
        details = "; ".join(f"{table}:{action}" for table, action in schema_actions)
        cursor.execute("""
            INSERT INTO schema_migrations (from_version, to_version, action, details)
            VALUES (?, ?, ?, ?)
        """, (
            previous_version,
            DB_SCHEMA_VERSION,
            "schema_sync",
            details or "no table shape changes"
        ))
        if schema_actions:
            print("[DB] Schema sync actions: " + details)
        if previous_version != DB_SCHEMA_VERSION:
            print(f"[DB] Schema version set from {previous_version} to {DB_SCHEMA_VERSION}")


def _ensure_runtime_indexes(cursor):
    """Create safe indexes that do not change business data or table shape."""
    versioned_tables = ["chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "chuyen_gia", "hop_dong"]
    synced_tables = versioned_tables + ["phan_cong_nhan_su", "trang_thai_ho_so_giay", "thong_tin_mo_thau", "ma_tran_phan_quyen"]
    owner_typed_tables = synced_tables + ["cau_hinh_bien_word"]

    for table in versioned_tables:
        _assert_safe_table(table)
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_updated ON {table} (owner_id, updated_at)")
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_latest ON {table} (owner_id, is_latest)")
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_root ON {table} (owner_id, id_goc)")

    for table in synced_tables:
        _assert_safe_table(table)
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_type_owner ON {table} (owner_type, owner_id)")
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_sync_version ON {table} (owner_id, sync_version)")

    for table in owner_typed_tables:
        _assert_safe_table(table)
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_owner_type_owner ON {table} (owner_type, owner_id)")

    for table in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "chuyen_gia", "hop_dong"]:
        _assert_safe_table(table)
        cursor.execute(f"""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_unique_version
            ON {table} (owner_id, COALESCE(NULLIF(id_goc, ''), id), phien_ban)
        """)
        cursor.execute(f"""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_unique_latest
            ON {table} (owner_id, COALESCE(NULLIF(id_goc, ''), id))
            WHERE is_latest = 1
        """)

    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_goi_thau_unique_plan_snapshot_version
        ON goi_thau (owner_id, COALESCE(NULLIF(id_goc, ''), id), phien_ban, ke_hoach_id)
    """)
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_goi_thau_unique_latest
        ON goi_thau (owner_id, COALESCE(NULLIF(id_goc, ''), id), COALESCE(ke_hoach_id, ''))
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
            ON {table} (owner_id, {column})
            WHERE is_latest = 1 AND {column} IS NOT NULL AND {column} != ''
        """)
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_goi_thau_ma_goi_thau_owner_plan_latest_unique
        ON goi_thau (owner_id, COALESCE(ke_hoach_id, ''), ma_goi_thau)
        WHERE is_latest = 1 AND ma_goi_thau IS NOT NULL AND ma_goi_thau != ''
    """)

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_ke_hoach ON goi_thau (ke_hoach_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_nha_thau_trung ON goi_thau (nha_thau_trung_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ke_hoach_cong_viec_parent ON ke_hoach_cong_viec (owner_id, ke_hoach_id, loai, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_phan_lo_parent ON goi_thau_phan_lo (owner_id, goi_thau_id, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_tuy_chon_parent ON goi_thau_tuy_chon_mua_them (owner_id, goi_thau_id, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_gia_han_parent ON goi_thau_gia_han (owner_id, goi_thau_id, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_lam_ro_parent ON goi_thau_lam_ro (owner_id, goi_thau_id, loai, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_nha_thau_lien_danh_parent ON nha_thau_lien_danh_thanh_vien (owner_id, nha_thau_id, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_mo_thau_lien_danh_parent ON thong_tin_mo_thau_lien_danh_thanh_vien (owner_id, thong_tin_mo_thau_id, sort_order)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_ke_hoach ON hop_dong (ke_hoach_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_chu_dau_tu ON hop_dong (chu_dau_tu_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_nha_thau ON hop_dong (nha_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_goi_thau_owner_hd ON hop_dong_goi_thau (owner_id, hop_dong_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_goi_thau_owner_gt ON hop_dong_goi_thau (owner_id, goi_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_chuyen_gia_owner_gt ON goi_thau_chuyen_gia (owner_id, goi_thau_id, loai)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_chuyen_gia_owner_cg ON goi_thau_chuyen_gia (owner_id, chuyen_gia_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_thong_tin_mo_thau_goi_thau ON thong_tin_mo_thau (goi_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_thong_tin_mo_thau_nha_thau ON thong_tin_mo_thau (nha_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_phan_cong_owner_target ON phan_cong_nhan_su (owner_id, id_muc_tieu, loai_doi_tuong)")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tai_khoan_token ON tai_khoan (token_phien) WHERE token_phien IS NOT NULL AND token_phien != ''")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tai_khoan_email ON tai_khoan (email) WHERE email != ''")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tai_khoan_ten_dang_nhap ON tai_khoan (ten_dang_nhap)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_thanh_vien_to_chuc_to_chuc ON thanh_vien_to_chuc (to_chuc_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_to_chuc_quan_ly ON to_chuc (quan_ly_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_records_owner_deleted ON deleted_records (owner_id, deleted_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_records_owner_delete_version ON deleted_records (owner_id, delete_version)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_deleted_records_owner_table ON deleted_records (owner_id, table_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sync_mutations_owner_created ON sync_mutations (owner_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_owner_created ON audit_log (owner_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created ON audit_log (actor_user_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_action_created ON audit_log (action, created_at)")

    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_deleted_records_unique_record
        ON deleted_records (owner_id, table_name, record_id)
    """)
    cursor.execute("DELETE FROM sync_mutations WHERE created_at < datetime('now', 'localtime', '-7 days')")

    _ensure_fts_indexes(cursor)
    _ensure_delta_sync_triggers(cursor, synced_tables)


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
                    owner_id UNINDEXED,
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
                    INSERT INTO {fts_table}(rowid, owner_id, id, {cols_sql})
                    VALUES (new.rowid, new.owner_id, new.id, {new_cols});
                END
            """)
            cursor.execute(f"""
                CREATE TRIGGER trg_{table}_fts_ad AFTER DELETE ON {table}
                BEGIN
                    INSERT INTO {fts_table}({fts_table}, rowid, owner_id, id, {cols_sql})
                    VALUES ('delete', old.rowid, old.owner_id, old.id, {old_cols});
                END
            """)
            cursor.execute(f"""
                CREATE TRIGGER trg_{table}_fts_au AFTER UPDATE ON {table}
                BEGIN
                    INSERT INTO {fts_table}({fts_table}, rowid, owner_id, id, {cols_sql})
                    VALUES ('delete', old.rowid, old.owner_id, old.id, {old_cols});
                    INSERT INTO {fts_table}(rowid, owner_id, id, {cols_sql})
                    VALUES (new.rowid, new.owner_id, new.id, {new_cols});
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
             AND NEW.owner_id IS NOT NULL
             AND NEW.owner_id != ''
            BEGIN
                INSERT OR IGNORE INTO sync_metadata (owner_id, current_version)
                VALUES (NEW.owner_id, 0);

                UPDATE sync_metadata
                SET current_version = current_version + 1,
                    updated_at = datetime('now', 'localtime')
                WHERE owner_id = NEW.owner_id;

                UPDATE {table}
                SET updated_at = datetime('now', 'localtime'),
                    sync_version = (
                        SELECT current_version
                        FROM sync_metadata
                        WHERE owner_id = NEW.owner_id
                    )
                WHERE id = NEW.id;
            END
        """)

        cursor.execute(f"""
            CREATE TRIGGER trg_{table}_deleted_log
            AFTER DELETE ON {table}
            FOR EACH ROW
            WHEN OLD.owner_id IS NOT NULL
             AND OLD.owner_id != ''
            BEGIN
                INSERT OR IGNORE INTO sync_metadata (owner_id, current_version)
                VALUES (OLD.owner_id, 0);

                UPDATE sync_metadata
                SET current_version = current_version + 1,
                    updated_at = datetime('now', 'localtime')
                WHERE owner_id = OLD.owner_id;

                INSERT INTO deleted_records (table_name, record_id, owner_id, deleted_at, delete_version)
                VALUES (
                    '{table}',
                    OLD.id,
                    OLD.owner_id,
                    datetime('now', 'localtime'),
                    (SELECT current_version FROM sync_metadata WHERE owner_id = OLD.owner_id)
                )
                ON CONFLICT(owner_id, table_name, record_id) DO UPDATE SET
                    deleted_at = excluded.deleted_at,
                    delete_version = MAX(
                        COALESCE(deleted_records.delete_version, 0),
                        COALESCE(excluded.delete_version, 0)
                    );
            END
        """)


def recalculate_is_latest(cursor, table_name, owner_id=None):
    """
    Tính lại cờ is_latest cho bảng versioned (chu_dau_tu, ke_hoach_lcnt, goi_thau, nha_thau).
    Hàm dùng chung — tránh duplicate logic giữa sync_api và các tác vụ bảo trì.

    Args:
        cursor: DB cursor đang mở
        table_name: Tên bảng cần cập nhật
        owner_id: Nếu cung cấp, chỉ cập nhật bản ghi của owner đó (dùng khi sync).
                  Nếu None, cập nhật toàn bộ.
    """
    partition_expr = (
        "CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END, COALESCE(ke_hoach_id, '')"
        if table_name == "goi_thau"
        else "CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END"
    )

    if owner_id:
        cursor.execute(f"UPDATE {table_name} SET is_latest = 0 WHERE owner_id = ?", (owner_id,))
        cursor.execute(f"""
            UPDATE {table_name} SET is_latest = 1 WHERE owner_id = ? AND id IN (
                SELECT id FROM (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            PARTITION BY {partition_expr}
                            ORDER BY CAST(phien_ban AS INTEGER) DESC, updated_at DESC, id DESC
                        ) AS rn
                    FROM {table_name}
                    WHERE owner_id = ?
                )
                WHERE rn = 1
            )
        """, (owner_id, owner_id))
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
                )
                WHERE rn = 1
            )
        """)



def recalculate_tong_muc_dau_tu(cursor, owner_id=None):
    """
    Tính lại tong_muc_dau_tu cho cac ke_hoach_lcnt co is_tong_muc_tu_dong = 1
    dua tren logic tong gia_goi_thau, cv_da_thuc_hien, cv_khong_ap_dung, cv_chua_du_dieu_kien.
    """
    if owner_id:
        cursor.execute("""
            SELECT id, loai_hinh_mua_sam
            FROM ke_hoach_lcnt
            WHERE owner_id = ? AND is_tong_muc_tu_dong = 1
        """, (owner_id,))
    else:
        cursor.execute("""
            SELECT id, loai_hinh_mua_sam
            FROM ke_hoach_lcnt
            WHERE is_tong_muc_tu_dong = 1
        """)
    plans = cursor.fetchall()

    for row in plans:
        plan_id = row[0]
        loai_hinh = row[1]

        cursor.execute("""
            SELECT COALESCE(SUM(gia_goi_thau), 0)
            FROM goi_thau
            WHERE ke_hoach_id = ? AND is_latest = 1
        """, (plan_id,))
        sum_iv = cursor.fetchone()[0] or 0

        cursor.execute("""
            SELECT loai, COALESCE(SUM(gia_tri), 0)
            FROM ke_hoach_cong_viec
            WHERE ke_hoach_id = ?
            GROUP BY loai
        """, (plan_id,))
        cv_sums = {r[0]: r[1] or 0 for r in cursor.fetchall()}
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
    """Create fresh DB and reconcile schema for future table/column changes.

    Existing DBs are aligned to SCHEMA_DINH_NGHIA by rebuilding changed tables
    and preserving columns that still exist in the new schema.
    """
    conn = None
    try:
        conn = database.get_connection()
        cursor = conn.cursor()

        previous_schema_version = _ensure_schema_version_tables(cursor)
        schema_actions = []
        cursor.execute("PRAGMA foreign_keys = OFF")
        for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
            action = _sync_table_schema(cursor, table_name, table_spec)
            schema_actions.append((table_name, action))
        cursor.execute("PRAGMA foreign_keys = ON")
        _backfill_partner_effective_dates(cursor)
        _backfill_member_contractor_versions(cursor)
        _clear_competitive_quotation_appraisal(cursor)

        cursor.execute("SELECT COUNT(*) FROM goi_dich_vu")
        if cursor.fetchone()[0] == 0:
            cursor.executemany(
                "INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta) VALUES (?, ?, ?, ?, ?)",
                [
                    ('silver', 'Gói Bạc (Silver)', 15000000.0, 5, 'Phù hợp với đơn vị quy mô nhỏ, quản lý tối đa 5 nhân sự.'),
                    ('gold', 'Gói Vàng (Gold)', 35000000.0, 15, 'Giải pháp tuyệt vời cho phòng thầu chuyên nghiệp, tối đa 15 nhân sự.'),
                    ('diamond', 'Gói Kim Cương (Diamond)', 75000000.0, 999, 'Đặc quyền quản trị thầu tối cao, không giới hạn số lượng nhân sự.'),
                ]
            )

        cursor.execute("SELECT COUNT(*) FROM tai_khoan")
        if cursor.fetchone()[0] == 0:
            admin_uuid = generate_record_id("tai_khoan")
            admin_pass = os.environ.get("ADMIN_PASSWORD", "")
            if not admin_pass:
                raise ValueError("ADMIN_PASSWORD environment variable is not configured. Initial admin password must be set in the environment.")
            admin_name = os.environ.get("ADMIN_NAME", "Administrator")
            admin_email = os.environ.get("ADMIN_EMAIL", "admin@localhost")
            org_name = os.environ.get("DEFAULT_ORG_NAME", "HTD")
            org_id = stable_org_id(org_name)

            cursor.execute(
                """
                INSERT INTO tai_khoan (
                    id, ten_dang_nhap, mat_khau, ho_ten, vai_tro, email,
                    da_xac_minh, goi_dich_vu_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (admin_uuid, 'admin', hash_password(admin_pass), admin_name, 'super_admin', admin_email, 1, 'diamond')
            )
            cursor.execute(
                "INSERT INTO to_chuc (id, ten_to_chuc, quan_ly_id) VALUES (?, ?, ?)",
                (org_id, org_name, admin_uuid)
            )
            cursor.execute(
                "INSERT INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc) VALUES (?, ?, ?)",
                (admin_uuid, org_id, 'super_admin')
            )
            cursor.execute(
                "INSERT OR IGNORE INTO sync_metadata (owner_id, current_version) VALUES (?, ?)",
                (org_id, 1)
            )

        _ensure_runtime_indexes(cursor)
        _record_schema_version(cursor, previous_schema_version, schema_actions)
        ensure_default_word_mappings_for_all_orgs(cursor)

        conn.commit()
        print("[DB] Database schema initialized and synchronized successfully.")
    except Exception as e:
        if conn:
            conn.rollback()
        print("[DB] Database schema initialization/synchronization failed:", e)
        raise
    finally:
        if conn:
            conn.close()
