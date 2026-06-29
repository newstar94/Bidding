from .schema import SCHEMA_DINH_NGHIA
from .auth_helper import hash_password
import sys
import os
import json
import time
import traceback
import uuid
import hashlib
import db_helper
from db_helper import database, models, load_and_register

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


def _normalize_sqlite_type(t: str) -> str:
    """Chuẩn hóa kiểu dữ liệu SQLite để so sánh giữa schema code và DB."""
    t = t.strip()
    if not t:
        return "TEXT"
    if "INT" in t:
        return "INTEGER"
    if "CHAR" in t or "CLOB" in t or "TEXT" in t:
        return "TEXT"
    if "BLOB" in t:
        return "BLOB"
    if "REAL" in t or "FLOA" in t or "DOUB" in t:
        return "REAL"
    return t


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


def recalculate_is_latest(cursor, table_name, owner_id=None):
    """
    Tính lại cờ is_latest cho bảng versioned (chu_dau_tu, ke_hoach_lcnt, goi_thau, nha_thau).
    Hàm dùng chung — tránh duplicate logic giữa sync_api và migration.

    Args:
        cursor: DB cursor đang mở
        table_name: Tên bảng cần cập nhật
        owner_id: Nếu cung cấp, chỉ cập nhật bản ghi của owner đó (dùng khi sync).
                  Nếu None, cập nhật toàn bộ (dùng khi migration lúc khởi động).
    """
    if owner_id:
        cursor.execute(f"UPDATE {table_name} SET is_latest = 0 WHERE owner_id = ?", (owner_id,))
        cursor.execute(f"""
            UPDATE {table_name} SET is_latest = 1 WHERE owner_id = ? AND id IN (
                SELECT t1.id FROM {table_name} t1
                INNER JOIN (
                    SELECT
                        CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END as grp,
                        MAX(CAST(phien_ban AS INTEGER)) as max_ver
                    FROM {table_name}
                    WHERE owner_id = ?
                    GROUP BY CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END
                ) t2 ON (
                    CASE WHEN t1.id_goc IS NOT NULL AND t1.id_goc != '' THEN t1.id_goc ELSE t1.id END
                ) = t2.grp
                AND CAST(t1.phien_ban AS INTEGER) = t2.max_ver
                WHERE t1.owner_id = ?
            )
        """, (owner_id, owner_id, owner_id))
    else:
        cursor.execute(f"UPDATE {table_name} SET is_latest = 0")
        cursor.execute(f"""
            UPDATE {table_name} SET is_latest = 1 WHERE id IN (
                SELECT t1.id FROM {table_name} t1
                INNER JOIN (
                    SELECT
                        CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END as grp,
                        MAX(CAST(phien_ban AS INTEGER)) as max_ver
                    FROM {table_name}
                    GROUP BY CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END
                ) t2 ON (
                    CASE WHEN t1.id_goc IS NOT NULL AND t1.id_goc != '' THEN t1.id_goc ELSE t1.id END
                ) = t2.grp
                AND CAST(t1.phien_ban AS INTEGER) = t2.max_ver
            )
        """)



def recalculate_tong_muc_dau_tu(cursor, owner_id=None):
    """
    Tính lại tong_muc_dau_tu cho cac ke_hoach_lcnt co is_tong_muc_tu_dong = 1
    dua tren logic tong gia_goi_thau, cv_da_thuc_hien, cv_khong_ap_dung, cv_chua_du_dieu_kien.
    """
    if owner_id:
        cursor.execute("""
            SELECT id, id_goc, loai_hinh_mua_sam, cv_da_thuc_hien, cv_khong_ap_dung, cv_chua_du_dieu_kien
            FROM ke_hoach_lcnt
            WHERE owner_id = ? AND is_tong_muc_tu_dong = 1
        """, (owner_id,))
    else:
        cursor.execute("""
            SELECT id, id_goc, loai_hinh_mua_sam, cv_da_thuc_hien, cv_khong_ap_dung, cv_chua_du_dieu_kien
            FROM ke_hoach_lcnt
            WHERE is_tong_muc_tu_dong = 1
        """)
    plans = cursor.fetchall()
    
    for row in plans:
        plan_id = row[0]
        id_goc = row[1]
        loai_hinh = row[2]
        cv_da_thuc_hien_str = row[3]
        cv_khong_ap_dung_str = row[4]
        cv_chua_du_dieu_kien_str = row[5]
        
        root_id = id_goc if (id_goc and id_goc.strip()) else plan_id
        cursor.execute("""
            SELECT id FROM ke_hoach_lcnt
            WHERE (id_goc = ? OR id = ?)
        """, (root_id, root_id))
        version_ids = [r[0] for r in cursor.fetchall()]
        
        sum_iv = 0
        if version_ids:
            placeholders = ",".join(["?"] * len(version_ids))
            cursor.execute(f"""
                SELECT COALESCE(SUM(gia_goi_thau), 0)
                FROM goi_thau
                WHERE ke_hoach_id IN ({placeholders}) AND is_latest = 1
            """, tuple(version_ids))
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
    try:
        conn = database.get_connection()
        cursor = conn.cursor()
        
        # Tự động loại bỏ mọi bảng không được định nghĩa trong SCHEMA_DINH_NGHIA và không phải bảng hệ thống
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        db_tables = [row[0] for row in cursor.fetchall()]
        for tbl in db_tables:
            if tbl not in SCHEMA_DINH_NGHIA and tbl not in ['sqlite_sequence']:
                # Skip dropping tables that look like backups/temp tables
                if "old" in tbl or "temp" in tbl or tbl.startswith("_"):
                    continue
                print(f"Đồng bộ: Loại bỏ bảng vô nghĩa/không sử dụng khỏi DB: '{tbl}'")
                cursor.execute(f"DROP TABLE IF EXISTS '{tbl}'")
        conn.commit()

        for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
            cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'")
            table_exists = cursor.fetchone()
            
            if not table_exists:
                sql_create = _build_create_table_sql(table_name, table_spec)
                print(f"Đồng bộ: Tạo bảng mới '{table_name}' theo cấu trúc code định nghĩa.")
                cursor.execute(sql_create)
                continue
            
            cursor.execute(f"PRAGMA table_info({table_name})")
            current_cols = {row[1]: row for row in cursor.fetchall()}
            expected_cols = table_spec["columns"]
            
            if table_name == "hop_dong" and "thoi_gian_thuc_hien" not in current_cols and "so_ngay_thuc_hien" in current_cols:
                print("Đồng bộ: Đổi tên cột 'so_ngay_thuc_hien' thành 'thoi_gian_thuc_hien' trong bảng 'hop_dong'")
                try:
                    cursor.execute("ALTER TABLE hop_dong RENAME COLUMN so_ngay_thuc_hien TO thoi_gian_thuc_hien")
                    cursor.execute("PRAGMA table_info(hop_dong)")
                    current_cols = {row[1]: row for row in cursor.fetchall()}
                except Exception as ex:
                    print(f"Lỗi khi đổi tên cột: {ex}")

            rebuild_needed = False
            for col_name, col_def in expected_cols.items():
                if col_name in current_cols:
                    expected_type = col_def.split()[0].upper().replace(",", "")
                    current_type = current_cols[col_name][2].upper()
                    if _normalize_sqlite_type(expected_type) != _normalize_sqlite_type(current_type):
                        print(f"Đồng bộ: Phát hiện lệch kiểu dữ liệu cột '{col_name}' trong '{table_name}' (Code: {expected_type}, DB: {current_type})")
                        rebuild_needed = True
                        break
                else:
                    col_def_upper = col_def.upper()
                    if "DEFAULT" in col_def_upper or "NOT NULL" in col_def_upper or "UNIQUE" in col_def_upper or "REFERENCES" in col_def_upper:
                        print(f"Đồng bộ: Phát hiện thiếu cột phức tạp '{col_name}' trong '{table_name}', cần xây dựng lại bảng.")
                        rebuild_needed = True
                        break

            # Check for CHECK constraints updates (compare full constraint definition)
            cursor.execute(f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table_name}'")
            db_sql_row = cursor.fetchone()
            if db_sql_row:
                table_sql = db_sql_row[0] or ""
                has_check_in_code = any("CHECK" in str(c_def).upper() for c_def in expected_cols.values())
                has_check_in_db = "CHECK" in table_sql.upper()
                if has_check_in_code and not has_check_in_db:
                    print(f"Đồng bộ: Thiếu ràng buộc CHECK trong bảng '{table_name}'. Cần xây dựng lại.")
                    rebuild_needed = True
                elif has_check_in_code and has_check_in_db:
                    # So sánh chi tiết nội dung CHECK constraint
                    import re as _re
                    check_defs_in_code = [
                        str(c_def) for c_def in expected_cols.values()
                        if "CHECK" in str(c_def).upper()
                    ]
                    for check_def in check_defs_in_code:
                        # Trích phần trong CHECK(...) từ code
                        m_code = _re.search(r'CHECK\s*\((.+)\)', check_def, _re.IGNORECASE | _re.DOTALL)
                        if not m_code:
                            continue
                        code_check_content = _re.sub(r'\s+', ' ', m_code.group(1).strip())
                        # Kiểm tra chuỗi đó có trong định nghĩa SQL của bảng không
                        normalized_table_sql = _re.sub(r'\s+', ' ', table_sql)
                        if code_check_content not in normalized_table_sql:
                            print(f"Đồng bộ: Ràng buộc CHECK trong bảng '{table_name}' đã thay đổi. Cần xây dựng lại.")
                            rebuild_needed = True
                            break

            # Check foreign key counts to detect changes
            cursor.execute(f"PRAGMA foreign_key_list({table_name})")
            db_fks = cursor.fetchall()
            expected_fks = table_spec.get("foreign_keys", [])
            if len(db_fks) != len(expected_fks):
                print(f"Đồng bộ: Số lượng khóa ngoại của bảng '{table_name}' khác biệt (DB: {len(db_fks)}, Code: {len(expected_fks)}). Cần xây dựng lại.")
                rebuild_needed = True
            else:
                # Check if any foreign key references a temp or non-existent table
                for fk in db_fks:
                    target_table = fk[2]
                    if target_table not in SCHEMA_DINH_NGHIA or target_table.startswith("_temp_mig_") or "_old_" in target_table:
                        print(f"Đồng bộ: Bảng '{table_name}' có khóa ngoại trỏ tới bảng tạm/không tồn tại '{target_table}'. Cần xây dựng lại.")
                        rebuild_needed = True
                        break

            if rebuild_needed:
                print(f"Đồng bộ: Tiến hành xây dựng lại bảng '{table_name}' để đồng bộ cấu trúc...")
                temp_table = f"_temp_mig_{table_name}"
                original_restored = False
                try:
                    cursor.execute("PRAGMA foreign_keys = OFF")
                    cursor.execute(f"DROP TABLE IF EXISTS {temp_table}")
                    cursor.execute(f"ALTER TABLE {table_name} RENAME TO {temp_table}")
                    sql_create = _build_create_table_sql(table_name, table_spec)
                    cursor.execute(sql_create)
                    
                    cursor.execute(f"PRAGMA table_info({temp_table})")
                    old_cols = [row[1] for row in cursor.fetchall()]
                    common_cols = [c for c in expected_cols.keys() if c in old_cols]
                    
                    if common_cols:
                        cols_str = ", ".join(common_cols)
                        cursor.execute(f"INSERT INTO {table_name} ({cols_str}) SELECT {cols_str} FROM {temp_table}")
                    
                    cursor.execute(f"DROP TABLE {temp_table}")
                    cursor.execute("PRAGMA foreign_keys = ON")
                    print(f"Đồng bộ: Xây dựng lại bảng '{table_name}' thành công và bảo toàn dữ liệu!")
                    continue
                except Exception as ex:
                    print(f"Lỗi nghiêm trọng khi xây dựng lại bảng '{table_name}': {ex}")
                    try:
                        cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'")
                        new_tbl_exists = cursor.fetchone()
                        if not new_tbl_exists:
                            cursor.execute(f"ALTER TABLE {temp_table} RENAME TO {table_name}")
                            original_restored = True
                            print(f"Đồng bộ: Đã khôi phục lại bảng gốc '{table_name}' từ bảng tạm.")
                    except Exception as restore_ex:
                        print(f"Không thể khôi phục bảng gốc '{table_name}': {restore_ex}")
                    cursor.execute("PRAGMA foreign_keys = ON")
                    if not original_restored:
                        raise ex

            for col_name, col_def in expected_cols.items():
                if col_name not in current_cols:
                    print(f"Đồng bộ: Thêm cột mới '{col_name}' ({col_def}) vào bảng '{table_name}'")
                    alter_def = col_def
                    if "PRIMARY KEY" in col_def.upper():
                        continue
                    if "NOT NULL" in col_def.upper() and "DEFAULT" not in col_def.upper():
                        alter_def = col_def.replace("NOT NULL", "")
                    cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {alter_def}")
            
            for col_name in list(current_cols.keys()):
                if col_name not in expected_cols:
                    print(f"Đồng bộ: Xóa cột thừa '{col_name}' khỏi bảng '{table_name}' để khớp định nghĩa code")
                    try:
                        cursor.execute(f"ALTER TABLE {table_name} DROP COLUMN {col_name}")
                    except Exception as ex:
                        print(f"Không thể xóa trực tiếp cột '{col_name}' trong SQLite (phiên bản cũ): {ex}")
                        
        cursor.execute("SELECT COUNT(*) FROM goi_dich_vu")
        if cursor.fetchone()[0] == 0:
            cursor.execute("INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta) VALUES (?, ?, ?, ?, ?)",
                           ('silver', 'Gói Bạc (Silver)', 15000000.0, 5, 'Phù hợp với đơn vị quy mô nhỏ, quản lý tối đa 5 nhân sự.'))
            cursor.execute("INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta) VALUES (?, ?, ?, ?, ?)",
                           ('gold', 'Gói Vàng (Gold)', 35000000.0, 15, 'Giải pháp tuyệt vời cho phòng thầu chuyên nghiệp, tối đa 15 nhân sự.'))
            cursor.execute("INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta) VALUES (?, ?, ?, ?, ?)",
                           ('diamond', 'Gói Kim Cương (Diamond)', 75000000.0, 999, 'Đặc quyền quản trị thầu tối cao, không giới hạn số lượng nhân sự.'))
                           
        cursor.execute("SELECT COUNT(*) FROM tai_khoan")
        if cursor.fetchone()[0] == 0:
            admin_uuid = "user-" + str(uuid.uuid4())
            admin_pass = os.environ.get("ADMIN_PASSWORD", "123456")
            admin_name = os.environ.get("ADMIN_NAME", "Administrator")
            admin_email = os.environ.get("ADMIN_EMAIL", "admin@localhost")
            cursor.execute("INSERT INTO tai_khoan (id, ten_dang_nhap, mat_khau, ho_ten, vai_tro, email, goi_dich_vu_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                           (admin_uuid, 'admin', hash_password(admin_pass), admin_name, 'super_admin', admin_email, 'diamond'))
            
            org_name = 'HTD'
            org_hash_id = "org-" + hashlib.md5(org_name.encode('utf-8')).hexdigest()[:16]
            cursor.execute("""
                INSERT OR IGNORE INTO to_chuc (id, ten_to_chuc, quan_ly_id)
                VALUES (?, ?, ?)
            """, (org_hash_id, org_name, admin_uuid))
            cursor.execute("""
                INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc)
                VALUES (?, ?, ?)
            """, (admin_uuid, org_hash_id, 'super_admin'))
                           
        # Kích hoạt tự động chỉ cho tài khoản CŨ (tạo trước khi có tính năng OTP):
        # - Tài khoản cũ: da_xac_minh = 0 VÀ ma_xac_minh IS NULL (không có OTP đang chờ)
        # - Tài khoản mới chưa xác thực: da_xac_minh = 0 VÀ ma_xac_minh IS NOT NULL → KHÔNG được kích hoạt tự động
        cursor.execute("UPDATE tai_khoan SET da_xac_minh = 1 WHERE (da_xac_minh IS NULL OR da_xac_minh = 0) AND (ma_xac_minh IS NULL)")

        cursor.execute("SELECT id FROM tai_khoan WHERE vai_tro = 'super_admin' OR ten_dang_nhap = 'admin' LIMIT 1")
        admin_row = cursor.fetchone()
        admin_id = str(admin_row[0]) if admin_row else "1"
        
        business_tables = [
            "chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "chuyen_gia", 
            "nha_thau", "hop_dong", "phan_cong_nhan_su", 
            "trang_thai_ho_so_giay", "thong_tin_mo_thau"
        ]
        for tbl in business_tables:
            cursor.execute(f"UPDATE {tbl} SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''", (admin_id,))

        # Tính lại is_latest bằng hàm chung recalculate_is_latest() (tránh duplicate logic)
        for tbl in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "goi_thau", "hop_dong", "chuyen_gia"]:
            recalculate_is_latest(cursor, tbl)

        # Tính lại tổng mức tự động cho các kế hoạch hiện có
        try:
            recalculate_tong_muc_dau_tu(cursor)
        except Exception as recalc_ex:
            print("Lỗi khi tự động tính lại tổng mức đầu tư:", recalc_ex)

        conn.commit()
        conn.close()
        print("Khởi tạo và đồng bộ cơ sở dữ liệu thành công!")
    except Exception as e:
        print("Lỗi khởi tạo/đồng bộ database:", e)
# _run_migration đã được loại bỏ — dùng trực tiếp khoi_tao_va_di_tru_he_thong()
