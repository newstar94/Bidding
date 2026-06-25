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
    
    import json
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
                items = json.loads(cv_str)
                if isinstance(items, list):
                    return sum(float(item.get('giaTri') or 0) for item in items if isinstance(item, dict))
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
        
        # Tránh kiểm tra DB liên tục mỗi khi import module
        cursor.execute("CREATE TABLE IF NOT EXISTS sys_config (key TEXT PRIMARY KEY, val TEXT)")

        # Tự động loại bỏ mọi bảng không được định nghĩa trong SCHEMA_DINH_NGHIA và không phải bảng hệ thống
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        db_tables = [row[0] for row in cursor.fetchall()]
        for tbl in db_tables:
            if tbl not in SCHEMA_DINH_NGHIA and tbl not in ['sys_config', 'sqlite_sequence']:
                # Skip dropping tables that look like backups/temp tables
                if "old" in tbl or "temp" in tbl or tbl.startswith("_"):
                    continue
                print(f"Đồng bộ: Loại bỏ bảng vô nghĩa/không sử dụng khỏi DB: '{tbl}'")
                cursor.execute(f"DROP TABLE IF EXISTS '{tbl}'")
        conn.commit()

        cursor.execute("SELECT val FROM sys_config WHERE key = 'migration_done_v9'")
        config_row = cursor.fetchone()
        if config_row and config_row[0] == '1':
            conn.close()
            return
            
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tai_khoan'")
        if cursor.fetchone():
            cursor.execute("PRAGMA table_info(tai_khoan)")
            cols = [row[1] for row in cursor.fetchall()]
            if 'ten_to_chuc' in cols:
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS to_chuc (
                        id TEXT PRIMARY KEY,
                        ten_to_chuc TEXT UNIQUE NOT NULL,
                        quan_ly_id TEXT,
                        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
                    )
                """)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS thanh_vien_to_chuc (
                        user_id TEXT NOT NULL,
                        to_chuc_id TEXT NOT NULL,
                        vai_tro_trong_to_chuc TEXT,
                        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                        PRIMARY KEY (user_id, to_chuc_id)
                    )
                """)
                
                cursor.execute("SELECT id, ten_to_chuc, vai_tro FROM tai_khoan WHERE ten_to_chuc IS NOT NULL AND ten_to_chuc != ''")
                tk_rows = cursor.fetchall()
                org_managers = {}
                for row in tk_rows:
                    u_id = row['id']
                    vai_tro = row['vai_tro'] or ''
                    orgs = [o.strip() for o in row['ten_to_chuc'].split(',') if o.strip()]
                    for org in orgs:
                        if org not in org_managers:
                            org_managers[org] = u_id
                        else:
                            cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (org_managers[org],))
                            mgr_row = cursor.fetchone()
                            current_mgr_role = mgr_row['vai_tro'] or '' if mgr_row else ''
                            def role_weight(role):
                                if 'super_admin' in role: return 3
                                if 'manager' in role: return 2
                                return 1
                            if role_weight(vai_tro) > role_weight(current_mgr_role):
                                org_managers[org] = u_id
                
                for org_name, mgr_id in org_managers.items():
                    org_hash_id = "org-" + hashlib.md5(org_name.encode('utf-8')).hexdigest()[:16]
                    cursor.execute("""
                        INSERT OR IGNORE INTO to_chuc (id, ten_to_chuc, quan_ly_id)
                        VALUES (?, ?, ?)
                    """, (org_hash_id, org_name, mgr_id))
                
                for row in tk_rows:
                    u_id = row['id']
                    vai_tro = row['vai_tro'] or ''
                    orgs = [o.strip() for o in row['ten_to_chuc'].split(',') if o.strip()]
                    for org in orgs:
                        cursor.execute("SELECT id FROM to_chuc WHERE ten_to_chuc = ?", (org,))
                        org_row = cursor.fetchone()
                        if org_row:
                            org_id = org_row['id']
                            role_in_org = 'employee'
                            if 'super_admin' in vai_tro:
                                role_in_org = 'super_admin'
                            elif 'manager' in vai_tro:
                                role_in_org = 'manager'
                            cursor.execute("""
                                INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc)
                                VALUES (?, ?, ?)
                            """, (u_id, org_id, role_in_org))
                print("Đồng bộ: Di trú trước dữ liệu tổ chức từ tai_khoan.ten_to_chuc thành công!")
        
        for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
            cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'")
            table_exists = cursor.fetchone()
            
            if not table_exists:
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
                sql_create = f"CREATE TABLE {table_name} ({', '.join(cols_def)})"
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
                    
                    def normalize_type(t):
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

                    if normalize_type(expected_type) != normalize_type(current_type):
                        print(f"Đồng bộ: Phát hiện lệch kiểu dữ liệu cột '{col_name}' trong '{table_name}' (Code: {expected_type}, DB: {current_type})")
                        rebuild_needed = True
                        break
                else:
                    col_def_upper = col_def.upper()
                    if "DEFAULT" in col_def_upper or "NOT NULL" in col_def_upper or "UNIQUE" in col_def_upper or "REFERENCES" in col_def_upper:
                        print(f"Đồng bộ: Phát hiện thiếu cột phức tạp '{col_name}' trong '{table_name}', cần xây dựng lại bảng.")
                        rebuild_needed = True
                        break

            # Check for CHECK constraints updates
            cursor.execute(f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table_name}'")
            db_sql_row = cursor.fetchone()
            if db_sql_row:
                table_sql = db_sql_row[0] or ""
                has_check_in_code = any("CHECK" in str(c_def).upper() for c_def in expected_cols.values())
                has_check_in_db = "CHECK" in table_sql.upper()
                if has_check_in_code and not has_check_in_db:
                    print(f"Đồng bộ: Thiếu ràng buộc CHECK trong bảng '{table_name}'. Cần xây dựng lại.")
                    rebuild_needed = True

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
                    
                    sql_create = f"CREATE TABLE {table_name} ({', '.join(cols_def)})"
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
                        
        # English system legacy migration
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='system_packages'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM system_packages")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta) VALUES (?, ?, ?, ?, ?)",
                               (d['id'], d['name'], d['price'], d['quota'], d['description']))
            print("Đã di trú system_packages -> goi_dich_vu")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM users")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO tai_khoan (id, ten_dang_nhap, mat_khau, ho_ten, vai_tro, email, token_phien, anh_dai_dien, goi_dich_vu_id, ngay_bat_dau_goi, ngay_het_han_goi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d['username'], d['password'], d['name'], d['role'], d['email'], d['active_session_token'], d.get('avatar'), d.get('package_id', 'silver'), d.get('package_start_date'), d.get('package_end_date')))
                
                org_name = d.get('organization_name')
                if org_name:
                    orgs = [o.strip() for o in org_name.split(',') if o.strip()]
                    for org in orgs:
                        org_hash_id = "org-" + hashlib.md5(org.encode('utf-8')).hexdigest()[:16]
                        cursor.execute("INSERT OR IGNORE INTO to_chuc (id, ten_to_chuc, quan_ly_id) VALUES (?, ?, ?)",
                                       (org_hash_id, org, d['id']))
                        role_in_org = 'employee'
                        if 'super_admin' in d['role']:
                            role_in_org = 'super_admin'
                        elif 'manager' in d['role']:
                            role_in_org = 'manager'
                        cursor.execute("INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc) VALUES (?, ?, ?)",
                                       (d['id'], org_hash_id, role_in_org))
            print("Đã di trú users -> tai_khoan")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='investors'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM investors")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO chu_dau_tu (id, ten_chu_dau_tu, ma_chu_dau_tu, ma_so_thue, chuc_vu_nguoi_dung_dau, nguoi_ky_quyet_dinh, chuc_vu_nguoi_ky, danh_xung, dia_chi, so_dien_thoai, so_tai_khoan, noi_mo_tai_khoan, email, ma_qhns) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d['name'], d.get('code', ''), d.get('tax_code', ''), d.get('head_position', ''), d.get('signer_name', ''), d.get('signer_position', ''), d.get('honorific', 'Ông'), d.get('address', ''), d.get('phone', ''), d.get('bank_account', ''), d.get('bank_name', ''), d.get('email', ''), d.get('budget_code', '')))
            print("Đã di trú investors -> chu_dau_tu")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='plans'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM plans")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO ke_hoach_lcnt (id, id_goc, ma_ke_hoach, phien_ban, ten_ke_hoach, ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id, tong_muc_dau_tu, ngay_phe_duyet, quyet_dinh_phe_duyet, thoi_gian_dang_tai, cv_da_thuc_hien, cv_khong_ap_dung, cv_chua_du_dieu_kien, nguon_von, thoi_gian_du_an, dia_diem_quy_mo, thong_tin_khac) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d.get('root_id'), d.get('code'), d.get('version', '00'), d['name'], d.get('project_name'), d.get('loai_hinh'), d.get('investor_id'), d.get('total_investment', 0), d.get('approval_date'), d.get('approval_decision'), d.get('publish_date'), d.get('cv_da_thuc_hien', '[]'), d.get('cv_khong_ap_dung', '[]'), d.get('cv_chua_du_dieu_kien', '[]'), d.get('nguon_von', ''), d.get('thoigian_duan', ''), d.get('diadiem_quymo', ''), d.get('thongtin_khac', '')))
            print("Đã di trú plans -> ke_hoach_lcnt")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='contractors'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM contractors")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO nha_thau (id, ten_nha_thau, loai_nha_thau, thanh_vien_lien_danh, ma_so_thue, nguoi_dai_dien, danh_xung, so_dien_thoai, email, dia_chi, so_tai_khoan, noi_mo_tai_khoan, ma_ngan_hang, ma_nha_thau) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d['name'], d.get('type', 'Độc lập'), d.get('members', '[]'), d.get('tax_code', ''), d.get('representative', ''), d.get('honorific', 'Ông'), d.get('phone', ''), d.get('email', ''), d.get('address', ''), d.get('bank_account', ''), d.get('bank_name', ''), d.get('bank_code', ''), d.get('code', '')))
            print("Đã di trú contractors -> nha_thau")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='experts'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM experts")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO chuyen_gia (id, ho_ten, so_chung_chi, ngay_cap_chung_chi, so_cccd, ngay_cap_cccd, anh_chung_chi) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d['full_name'], d.get('certificate_code'), d.get('certificate_date'), d.get('cccd'), d.get('cccd_date'), d.get('certificate_image')))
            print("Đã di trú experts -> chuyen_gia")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='packages'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM packages")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO goi_thau (id, id_goc, ma_goi_thau, phien_ban, ke_hoach_id, ten_goi_thau, gia_goi_thau, loai_hop_dong, hinh_thuc_lua_chon, phuong_thuc_lua_chon, thoi_gian_thuc_hien, nguon_von, nha_thau_trung_thau_id, linh_vuc, tuy_chon_mua_them, thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc, phan_lo, phan_lo_list, tuy_chon_mua_them_list, thoi_gian_goi_thau, thoi_gian_hop_dong, awarded_phan_lo_list, trang_thai) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d.get('root_id'), d.get('code'), d.get('version', '00'), d.get('plan_id'), d['name'], d.get('price', 0), d.get('contract_type'), d.get('selection_method'), d.get('phuong_thuc_lua_chon', 'Một giai đoạn một túi hồ sơ'), d.get('execution_time'), d.get('capital_source'), d.get('awarded_contractor_id'), d.get('linh_vuc'), d.get('purchase_option', 'Không'), d.get('org_time'), d.get('org_start_time'), d.get('phan_lo', 'Không'), d.get('phan_lo_list', '[]'), d.get('tuy_chon_mua_them_list', '[]'), d.get('thoi_gian_goi_thau'), d.get('thoi_gian_hop_dong'), d.get('awarded_phan_lo_list', '[]'), d.get('status', 'Chuẩn bị')))
            print("Đã di trú packages -> goi_thau")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='contracts'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM contracts")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO hop_dong (id, ten_hop_dong, so_hop_dong, ngay_ky, chu_dau_tu_id, nha_thau_id, gia_tri, loai_hop_dong, thoi_gian_thuc_hien, trang_thai_ho_so) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d.get('name'), d.get('code'), d.get('sign_date'), d.get('investor_id'), d.get('contractor_id'), d.get('value', 0), d.get('type'), str(d.get('execution_time', '')), d.get('paper_status')))
            print("Đã di trú contracts -> hop_dong")
  
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='contract_package'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM contract_package")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO hop_dong_goi_thau (hop_dong_id, goi_thau_id) VALUES (?, ?)",
                               (d['contract_id'], d['package_id']))
            print("Đã di trú contract_package -> hop_dong_goi_thau")
  
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='assignments'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM assignments")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO phan_cong_nhan_su (id, id_nhan_vien, id_muc_tieu, loai_doi_tuong) VALUES (?, ?, ?, ?)",
                               (d['id'], d['emp_id'], d['target_id'], d['type']))
            print("Đã di trú assignments -> phan_cong_nhan_su")
            
        # Bảng cũ đã được loại bỏ động ở đầu hàm.
        pass
            
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
                           
        cursor.execute("UPDATE tai_khoan SET da_xac_minh = 1 WHERE da_xac_minh IS NULL OR da_xac_minh = 0")

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
        # Các chỉ mục (indexes) đã được chuyển toàn bộ sang db_helper.py để tập trung quản lý.

        # Tính lại is_latest bằng hàm chung recalculate_is_latest() (tránh duplicate logic)
        for tbl in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "goi_thau", "hop_dong", "chuyen_gia"]:
            recalculate_is_latest(cursor, tbl)

        try:
            cursor.execute("DELETE FROM thanh_vien_to_chuc WHERE user_id NOT IN (SELECT id FROM tai_khoan)")
            cursor.execute("UPDATE to_chuc SET quan_ly_id = NULL WHERE quan_ly_id NOT IN (SELECT id FROM tai_khoan)")
            print("Đồng bộ: Dọn dẹp các liên kết mồ côi tổ chức thành công!")
        except Exception as migration_ex:
            print("Lỗi khi di trú dữ liệu tổ chức:", migration_ex)

        try:
            cursor.execute("DROP TRIGGER IF EXISTS tg_sync_goithau_chuyengia_insert")
            cursor.execute("DROP TRIGGER IF EXISTS tg_sync_goithau_chuyengia_update")
            print("Đồng bộ: Đã dọn dẹp trigger goi_thau_chuyen_gia.")

            # Xóa các cột JSON dư thừa nếu SQLite hỗ trợ (>= 3.35.0)
            sqlite_ver = tuple(int(x) for x in conn.execute("SELECT sqlite_version()").fetchone()[0].split("."))
            if sqlite_ver >= (3, 35, 0):
                existing_cols = [row[1] for row in cursor.execute("PRAGMA table_info(goi_thau)").fetchall()]
                if 'chuyen_gia_list' in existing_cols:
                    cursor.execute("ALTER TABLE goi_thau DROP COLUMN chuyen_gia_list")
                    print("Đồng bộ: Đã xóa cột chuyen_gia_list khỏi bảng goi_thau.")
                if 'tham_dinh_list' in existing_cols:
                    cursor.execute("ALTER TABLE goi_thau DROP COLUMN tham_dinh_list")
                    print("Đồng bộ: Đã xóa cột tham_dinh_list khỏi bảng goi_thau.")
            else:
                print(f"Đồng bộ: SQLite {'.'.join(str(x) for x in sqlite_ver)} chưa hỗ trợ DROP COLUMN — bỏ qua, cột thừa không ảnh hưởng chức năng.")
        except Exception as trigger_ex:
            print("Lỗi khi dọn dẹp trigger/cột JSON:", trigger_ex)
                           
        try:
            cursor.execute("SELECT id, ten_to_chuc FROM to_chuc")
            org_rows = cursor.fetchall()
            for org_row in org_rows:
                o_id = org_row['id']
                o_name = org_row['ten_to_chuc']
                for tbl in business_tables:
                    cursor.execute(f"UPDATE {tbl} SET owner_id = ? WHERE owner_id = ?", (o_id, o_name))
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='deleted_records'")
            if cursor.fetchone():
                for org_row in org_rows:
                    cursor.execute("UPDATE deleted_records SET owner_id = ? WHERE owner_id = ?", (org_row['id'], org_row['ten_to_chuc']))
            print("Đồng bộ: Di trú cột owner_id từ Tên tổ chức sang ID tổ chức thành công!")
        except Exception as migration_owner_ex:
            print("Lỗi khi di trú owner_id sang ID tổ chức:", migration_owner_ex)

        # Di trú ke_hoach_id cho các hop_dong hiện có dựa trên goi_thau liên kết
        try:
            cursor.execute("""
                UPDATE hop_dong 
                SET ke_hoach_id = (
                    SELECT ke_hoach_id 
                    FROM goi_thau 
                    INNER JOIN hop_dong_goi_thau ON goi_thau.id = hop_dong_goi_thau.goi_thau_id 
                    WHERE hop_dong_goi_thau.hop_dong_id = hop_dong.id 
                    LIMIT 1
                ) 
                WHERE ke_hoach_id IS NULL
            """)
            print("Đồng bộ: Di trú ke_hoach_id cho hop_dong thành công!")
        except Exception as migration_kh_ex:
            print("Lỗi khi di trú ke_hoach_id cho hop_dong:", migration_kh_ex)

        # Tính lại tổng mức tự động cho các kế hoạch hiện có
        try:
            recalculate_tong_muc_dau_tu(cursor)
            print("Đồng bộ: Tính toán lại tổng mức đầu tư tự động thành công!")
        except Exception as recalc_ex:
            print("Lỗi khi tự động tính lại tổng mức đầu tư:", recalc_ex)

        cursor.execute("INSERT OR REPLACE INTO sys_config (key, val) VALUES ('migration_done_v9', '1')")
        conn.commit()
        conn.close()
        print("Khởi tạo và di trú cơ sở dữ liệu Tiếng Việt thành công!")
    except Exception as e:
        print("Lỗi khởi tạo/di trú database Tiếng Việt:", e)



def _run_migration():
    try:
        khoi_tao_va_di_tru_he_thong()
    except Exception as _mg_ex:
        print(f"[Lỗi khởi tạo DB] {_mg_ex}")
