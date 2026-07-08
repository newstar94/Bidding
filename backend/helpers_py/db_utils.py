from .schema import SCHEMA_DINH_NGHIA
from .auth_helper import hash_password
from .word_defaults import ensure_default_word_mappings_for_all_orgs
import os
import json
import uuid
import hashlib
from db_helper import database

# Whitelist bảo vệ DDL: chỉ cho phép tên bảng được định nghĩa trong schema
_ALLOWED_TABLES: frozenset = frozenset()  # Sẽ được khởi tạo sau khi SCHEMA_DINH_NGHIA sẵn sàng

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

    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
    if not cursor.fetchone():
        cursor.execute(_build_create_table_sql(table_name, table_spec))
        return

    cursor.execute(f"PRAGMA table_info({table_name})")
    current_info = cursor.fetchall()
    current_cols = {row[1]: row for row in current_info}

    expected_names = list(expected_cols.keys())
    current_names = list(current_cols.keys())
    rebuild_needed = expected_names != current_names

    if not rebuild_needed:
        for col_name, col_def in expected_cols.items():
            expected_type = _normalize_sqlite_type(col_def.split()[0])
            current_type = _normalize_sqlite_type(current_cols[col_name][2])
            if expected_type != current_type:
                rebuild_needed = True
                break

    if not rebuild_needed:
        return

    temp_table = f"_schema_sync_{table_name}_{uuid.uuid4().hex[:8]}"
    common_cols = [col for col in expected_names if col in current_cols]
    cursor.execute(f"ALTER TABLE {table_name} RENAME TO {temp_table}")
    cursor.execute(_build_create_table_sql(table_name, table_spec))
    if common_cols:
        cols_sql = ", ".join(common_cols)
        cursor.execute(f"INSERT INTO {table_name} ({cols_sql}) SELECT {cols_sql} FROM {temp_table}")
    cursor.execute(f"DROP TABLE {temp_table}")


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
        ON goi_thau (owner_id, COALESCE(NULLIF(id_goc, ''), id))
        WHERE is_latest = 1
    """)

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_ke_hoach ON goi_thau (ke_hoach_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_goi_thau_nha_thau_trung ON goi_thau (nha_thau_trung_thau_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_ke_hoach ON hop_dong (ke_hoach_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_chu_dau_tu ON hop_dong (chu_dau_tu_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hop_dong_nha_thau ON hop_dong (nha_thau_id)")
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

    _ensure_delta_sync_triggers(cursor, synced_tables)


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
    if owner_id:
        cursor.execute(f"UPDATE {table_name} SET is_latest = 0 WHERE owner_id = ?", (owner_id,))
        cursor.execute(f"""
            UPDATE {table_name} SET is_latest = 1 WHERE owner_id = ? AND id IN (
                SELECT id FROM (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            PARTITION BY CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END
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
                            PARTITION BY CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END
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
            SELECT id, loai_hinh_mua_sam, cv_da_thuc_hien, cv_khong_ap_dung, cv_chua_du_dieu_kien
            FROM ke_hoach_lcnt
            WHERE owner_id = ? AND is_tong_muc_tu_dong = 1
        """, (owner_id,))
    else:
        cursor.execute("""
            SELECT id, loai_hinh_mua_sam, cv_da_thuc_hien, cv_khong_ap_dung, cv_chua_du_dieu_kien
            FROM ke_hoach_lcnt
            WHERE is_tong_muc_tu_dong = 1
        """)
    plans = cursor.fetchall()
    
    for row in plans:
        plan_id = row[0]
        loai_hinh = row[1]
        cv_da_thuc_hien_str = row[2]
        cv_khong_ap_dung_str = row[3]
        cv_chua_du_dieu_kien_str = row[4]
        
        cursor.execute("""
            SELECT COALESCE(SUM(gia_goi_thau), 0)
            FROM goi_thau
            WHERE ke_hoach_id = ? AND is_latest = 1
        """, (plan_id,))
        sum_iv = cursor.fetchone()[0] or 0
            
        def sum_cv_list(cv_str):
            if not cv_str:
                return 0
            try:
                parsed = json.loads(cv_str)
                if isinstance(parsed, list):
                    return sum(float(i.get('giaTri') or 0) for i in parsed if isinstance(i, dict))
            except Exception:
                pass
            return 0

        sum_i = sum_cv_list(cv_da_thuc_hien_str)
        sum_ii = sum_cv_list(cv_khong_ap_dung_str)
        sum_iii = sum_cv_list(cv_chua_du_dieu_kien_str)

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

        cursor.execute("PRAGMA foreign_keys = OFF")
        for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
            _sync_table_schema(cursor, table_name, table_spec)
        cursor.execute("PRAGMA foreign_keys = ON")

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
            admin_uuid = "user-" + str(uuid.uuid4())
            admin_pass = os.environ.get("ADMIN_PASSWORD", "")
            if not admin_pass:
                import secrets as _secrets
                admin_pass = _secrets.token_urlsafe(16)
                print(f"\n{'='*60}")
                print(f"  MẬT KHẨU ADMIN MẶC ĐỊNH (lần khởi tạo đầu tiên):")
                print(f"  Tài khoản : admin")
                print(f"  Mật khẩu  : {admin_pass}")
                print(f"  ⚠️  Hãy đổi mật khẩu ngay sau khi đăng nhập lần đầu!")
                print(f"{'='*60}\n")
            admin_name = os.environ.get("ADMIN_NAME", "Administrator")
            admin_email = os.environ.get("ADMIN_EMAIL", "admin@localhost")
            org_name = os.environ.get("DEFAULT_ORG_NAME", "HTD")
            org_id = "org-" + hashlib.md5(org_name.encode("utf-8")).hexdigest()[:16]

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
        ensure_default_word_mappings_for_all_orgs(cursor)

        conn.commit()
        print("Khởi tạo và đồng bộ schema cơ sở dữ liệu thành công!")
    except Exception as e:
        if conn:
            conn.rollback()
        print("Lỗi khởi tạo/đồng bộ schema database:", e)
        raise
    finally:
        if conn:
            conn.close()

