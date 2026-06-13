import json
from datetime import datetime

from starlette.responses import JSONResponse

# Import helpers from helpers.py
from helpers import (
    database,
    verify_session,
    SCHEMA_DINH_NGHIA,
    SPECIAL_FIELD_MAPS,
    to_camel_case,
    clean_id,
    save_base64_image,
    load_base64_image,
    log_error
)

# Global dictionary to store active WebSocket connections
active_connections = {}  # owner_id -> set of websocket instances

# ==========================================
# CÁC HÀM TRỢ GIÚP CHO ĐỒNG BỘ DỮ LIỆU
# ==========================================

def safe_int_id(val, prefix=""):
    if not val:
        return None
    val_str = str(val).strip()
    if prefix:
        val_str = val_str.replace(prefix, "")
    import re
    digits = re.findall(r'\d+', val_str)
    if digits:
        return int(digits[0])
    return None

def safe_float(val):
    if not val:
        return 0.0
    try:
        s = str(val).strip()
        if ',' in s and '.' in s:
            if s.find('.') < s.find(','):
                s = s.replace('.', '').replace(',', '.')
            else:
                s = s.replace(',', '')
        elif ',' in s:
            if s.count(',') == 1:
                s = s.replace(',', '.')
            else:
                s = s.replace(',', '')
        return float(s)
    except Exception:
        return 0.0

def safe_int(val):
    if not val:
        return 0
    try:
        return int(float(val))
    except Exception:
        return 0

def get_active_org(request, user_id):
    active_org = request.headers.get('X-Active-Org')
    if active_org:
        import urllib.parse
        active_org = urllib.parse.unquote(active_org)
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT tc.id, tc.ten_to_chuc 
        FROM thanh_vien_to_chuc tvtc
        JOIN to_chuc tc ON tvtc.to_chuc_id = tc.id
        WHERE tvtc.user_id = ?
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        return str(user_id)
        
    for row in rows:
        if active_org and (active_org == row['id'] or active_org == row['ten_to_chuc']):
            return row['id']
            
    return rows[0]['id']

# ==========================================
# WEBSOCKET & ĐỒNG BỘ DỮ LIỆU
# ==========================================

async def sync_websocket_endpoint(websocket):
    await websocket.accept()
    
    owner_id = None
    try:
        data = await websocket.receive_text()
        msg = json.loads(data)
        if msg.get("action") == "auth":
            token = msg.get("token")
            username = msg.get("username")
            
            conn = database.get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT id, vai_tro, token_phien FROM tai_khoan WHERE ten_dang_nhap = ? OR (email != '' AND email = ?)", (username, username))
            row = cursor.fetchone()
            conn.close()
            
            if row and row['token_phien'] == token:
                user_id = row['id']
                conn = database.get_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT to_chuc_id 
                    FROM thanh_vien_to_chuc 
                    WHERE user_id = ?
                """, (user_id,))
                user_orgs = [r[0] for r in cursor.fetchall()]
                conn.close()
                if user_orgs:
                    owner_id = user_orgs[0]
                else:
                    owner_id = str(user_id)
                    
        if not owner_id:
            await websocket.close(code=4003)
            return
            
        if owner_id not in active_connections:
            active_connections[owner_id] = set()
        active_connections[owner_id].add(websocket)
        
        while True:
            await websocket.receive_text()
            
    except Exception:
        pass
    finally:
        if owner_id and owner_id in active_connections:
            active_connections[owner_id].discard(websocket)
            if not active_connections[owner_id]:
                del active_connections[owner_id]

def broadcast_websocket_event(owner_id, message):
    if owner_id in active_connections:
        import asyncio
        websockets = list(active_connections[owner_id])
        msg_str = json.dumps(message)
        
        async def broadcast():
            for ws in websockets:
                try:
                    await ws.send_text(msg_str)
                except Exception:
                    pass
        
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(broadcast())

async def sync_api(request):
    """
    [POST] /api/sync
    Đồng bộ dữ liệu thay đổi từ ứng dụng Frontend vào cơ sở dữ liệu SQLite.
    """
    def log_sync_error(msg):
        log_error(msg, "SyncAPI")

    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            log_sync_error(f"Xác thực thất bại khi đồng bộ: {role_or_err}")
            return JSONResponse({"error": role_or_err}, status_code=403)
            
        data = await request.json()
        conn = database.get_connection()
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=10000")
        cursor = conn.cursor()
        
        org_name = get_active_org(request, role_or_err.user_id)
        current_time = int(datetime.utcnow().timestamp())
        
        # Map of API payload key to DB table name
        TABLE_KEYS = {
            "chudautu": "chu_dau_tu",
            "kehoach": "ke_hoach_lcnt",
            "goithau": "goi_thau",
            "chuyengia": "chuyen_gia",
            "nhathau": "nha_thau",
            "hopdong": "hop_dong",
            "assignments": "phan_cong_nhan_su",
            "custompaperstatuses": "trang_thai_ho_so_giay",
            "thongtinmothau": "thong_tin_mo_thau"
        }
        
        def get_clean_id(tbl, raw_id):
            if raw_id is None:
                return None
            if tbl in ["phan_cong_nhan_su", "trang_thai_ho_so_giay"]:
                return str(raw_id).strip()
            return clean_id(raw_id)
        
        for payload_key, table_name in TABLE_KEYS.items():
            if payload_key not in data:
                continue
            items = data[payload_key]
            if not isinstance(items, list):
                continue
                
            table_spec = SCHEMA_DINH_NGHIA[table_name]
            columns = list(table_spec["columns"].keys())
            
            # 1. Phát hiện và xử lý các bản ghi bị xóa
            incoming_ids = set()
            for item in items:
                raw_id = item.get('id')
                c_id = get_clean_id(table_name, raw_id)
                if c_id:
                    incoming_ids.add(str(c_id))
            
            cursor.execute(f"SELECT id FROM {table_name} WHERE owner_id = ?", (org_name,))
            existing_ids = set(str(row[0]) for row in cursor.fetchall())
            
            deleted_ids = existing_ids - incoming_ids
            if deleted_ids:
                deleted_list = list(deleted_ids)
                # Xóa khỏi bảng chính
                placeholders = ", ".join(["?"] * len(deleted_list))
                cursor.execute(f"DELETE FROM {table_name} WHERE owner_id = ? AND id IN ({placeholders})", (org_name, *deleted_list))
                # Ghi vào bảng deleted_records
                for d_id in deleted_list:
                    cursor.execute(
                        "INSERT INTO deleted_records (table_name, record_id, owner_id, deleted_at) VALUES (?, ?, ?, ?)",
                        (table_name, d_id, org_name, current_time)
                    )
            
            # 2. Thêm hoặc cập nhật (INSERT OR REPLACE) các bản ghi
            for item in items:
                try:
                    row_data = {}
                    for col in columns:
                        if col == "owner_id":
                            val = org_name
                        elif col == "updated_at":
                            val = current_time
                        else:
                            # Rút trích key JSON tương ứng từ trường DB
                            json_key = SPECIAL_FIELD_MAPS.get(table_name, {}).get(col)
                            if not json_key:
                                if col == "id_goc":
                                    json_key = "rootId"
                                else:
                                    json_key = to_camel_case(col)
                                    
                            val = item.get(json_key)
                            
                            # Fallback nếu client gửi key ở dạng raw/snake_case
                            if val is None:
                                val = item.get(col)
                                
                            # Làm sạch tiền tố ID
                            if col == "id" or col.endswith("_id") or col == "id_goc":
                                val = get_clean_id(table_name, val)
                                    
                            # Xử lý các trường kiểu List/Dict sang JSON string
                            if isinstance(val, (list, dict)):
                                val = json.dumps(val)
                            elif col.endswith("_list") or col.startswith("cv_") or col == "thanh_vien_lien_danh":
                                if val is None:
                                    val = "[]"
                                elif not isinstance(val, str):
                                    val = json.dumps(val)
                                    
                            # Chuẩn hóa kiểu dữ liệu số
                            col_type_upper = table_spec["columns"][col].upper()
                            if "REAL" in col_type_upper:
                                val = safe_float(val)
                            elif "INTEGER" in col_type_upper:
                                if val is not None:
                                    val = safe_int(val)
                                    
                            # Gán giá trị mặc định của schema nếu val là None
                            if val is None and "DEFAULT" in col_type_upper:
                                import re
                                default_match = re.search(r"DEFAULT\s+'([^']+)'", col_type_upper)
                                if default_match:
                                    val = default_match.group(1)
                                    
                            # Tối ưu hóa lưu trữ ảnh chuyên gia ra file vật lý
                            if table_name == "chuyen_gia" and col in ["anh_chung_chi", "anh_chu_ky"] and val:
                                ext_suffix = "cert" if col == "anh_chung_chi" else "sig"
                                expert_id = clean_id(item.get('id'))
                                val = save_base64_image(val, "chuyen_gia", f"{expert_id}_{ext_suffix}")
                                    
                        row_data[col] = val
                        
                    # Thực thi INSERT OR REPLACE
                    non_null_row_data = {k: v for k, v in row_data.items() if v is not None}
                    cols_str = ", ".join(non_null_row_data.keys())
                    placeholders = ", ".join(["?"] * len(non_null_row_data))
                    sql = f"INSERT OR REPLACE INTO {table_name} ({cols_str}) VALUES ({placeholders})"
                    cursor.execute(sql, tuple(non_null_row_data.values()))
                    
                    # Ràng buộc thêm: Gắn các gói thầu với hợp đồng (junction table)
                    if table_name == "hop_dong":
                        c_hd_id = get_clean_id("hop_dong", item.get('id'))
                        cursor.execute("DELETE FROM hop_dong_goi_thau WHERE hop_dong_id = ?", (c_hd_id,))
                        for gt_id_str in item.get('goiThauIds', []):
                            if gt_id_str:
                                gt_id = clean_id(gt_id_str)
                                if gt_id is not None:
                                    cursor.execute(
                                        "INSERT OR REPLACE INTO hop_dong_goi_thau (hop_dong_id, goi_thau_id) VALUES (?, ?)",
                                        (c_hd_id, gt_id)
                                    )
                except Exception as item_err:
                    import traceback
                    log_sync_error(f"Lỗi đồng bộ bản ghi trong bảng {table_name} (ID: {item.get('id')}): {item_err}\n{traceback.format_exc()}")
                    
        # Cập nhật cờ is_latest cho các bảng versioning sau khi lưu xong dữ liệu
        for tbl in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "goi_thau"]:
            cursor.execute(f"UPDATE {tbl} SET is_latest = 0 WHERE owner_id = ?", (org_name,))
            cursor.execute(f"""
                UPDATE {tbl} SET is_latest = 1 WHERE owner_id = ? AND id IN (
                    SELECT t1.id FROM {tbl} t1
                    INNER JOIN (
                        SELECT COALESCE(id_goc, id) as id_goc_group, MAX(CAST(phien_ban AS INTEGER)) as max_ver
                        FROM {tbl}
                        WHERE owner_id = ?
                        GROUP BY COALESCE(id_goc, id)
                    ) t2 ON COALESCE(t1.id_goc, t1.id) = t2.id_goc_group AND CAST(t1.phien_ban AS INTEGER) = t2.max_ver
                    WHERE t1.owner_id = ?
                )
            """, (org_name, org_name, org_name))
                    
        conn.commit()
        
        # Broadcast WebSocket update
        broadcast_websocket_event(org_name, {"event": "db_changed", "sender_session": request.headers.get('X-Session-Token')})
        
        return JSONResponse({"status": "success", "timestamp": current_time})
    except Exception as e:
        import traceback
        log_sync_error(f"Lỗi tổng quát sync_api: {e}\n{traceback.format_exc()}")
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

async def get_all_data_api(request):
    """
    [GET] /api/get-all-data
    Trả về dữ liệu thay đổi từ lần đồng bộ trước (nếu truyền since) hoặc toàn bộ dữ liệu.
    """
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
            
        since = 0
        try:
            since = int(request.query_params.get('since', 0))
        except Exception:
            pass
            
        conn = database.get_connection()
        cursor = conn.cursor()
        current_time = int(datetime.utcnow().timestamp())
        
        # Hàm ánh xạ động DB snake_case sang JSON camelCase
        def map_db_to_json(table_name, row_dict):
            item = {}
            table_spec = SCHEMA_DINH_NGHIA[table_name]
            
            for col in table_spec["columns"].keys():
                json_key = SPECIAL_FIELD_MAPS.get(table_name, {}).get(col)
                if not json_key:
                    if col == "id_goc":
                        json_key = "rootId"
                    else:
                        json_key = to_camel_case(col)
                        
                val = row_dict.get(col)
                
                # 1. Thêm tiền tố ID cho client
                if col == "id" or col.endswith("_id") or col == "id_goc":
                    if table_name != "phan_cong_nhan_su" and val is not None:
                        prefix = ""
                        if col == "id":
                            prefix_map = {
                                "chu_dau_tu": "cdt-",
                                "ke_hoach_lcnt": "kh-",
                                "goi_thau": "gt-",
                                "chuyen_gia": "cg-",
                                "nha_thau": "nt-",
                                "hop_dong": "hd-",
                                "thong_tin_mo_thau": "tm-"
                            }
                            prefix = prefix_map.get(table_name, "")
                        elif col == "chu_dau_tu_id":
                            prefix = "cdt-"
                        elif col == "ke_hoach_id":
                            prefix = "kh-"
                        elif col == "goi_thau_id":
                            prefix = "gt-"
                        elif col == "nha_thau_trung_thau_id" or col == "nha_thau_id":
                            prefix = "nt-"
                        elif col == "id_goc":
                            prefix_map = {
                                "ke_hoach_lcnt": "kh-",
                                "goi_thau": "gt-",
                                "chu_dau_tu": "cdt-",
                                "nha_thau": "nt-"
                            }
                            prefix = prefix_map.get(table_name, "")
                            
                        if isinstance(val, str) and prefix and val.startswith(prefix):
                            pass
                        else:
                            val = f"{prefix}{val}"
                        
                # 2. Xử lý các trường dạng List/Dict đã lưu chuỗi JSON
                is_json_field = (
                    col.endswith("_list") or 
                    col.startswith("cv_") or 
                    col == "thanh_vien_lien_danh"
                )
                if is_json_field:
                    if val:
                        try:
                            val = json.loads(val)
                        except Exception:
                            val = []
                    else:
                        val = []
                        
                item[json_key] = val
            return item

        org_name = get_active_org(request, role_or_err.user_id)
        
        # Check scale for Server-side Pagination flag
        # Calculate total records across versionable/heavy tables
        heavy_tables = ["chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "chuyen_gia", "hop_dong"]
        total_records = 0
        for tbl in heavy_tables:
            cursor.execute(f"SELECT COUNT(*) FROM {tbl} WHERE owner_id = ?", (org_name,))
            total_records += cursor.fetchone()[0]
            
        use_server_pagination = total_records > 10000
        
        # Helper query function
        def query_table(tbl):
            if use_server_pagination:
                # If using server pagination, do not fetch all data, client will fetch paginated
                return []
            if since > 0:
                cursor.execute(f"SELECT * FROM {tbl} WHERE owner_id = ? AND updated_at > ?", (org_name, since))
            else:
                cursor.execute(f"SELECT * FROM {tbl} WHERE owner_id = ?", (org_name,))
            return cursor.fetchall()

        # 1. Chudautu
        chudautu = []
        for row in query_table("chu_dau_tu"):
            chudautu.append(map_db_to_json("chu_dau_tu", dict(row)))
            
        # 2. Kehoach
        kehoach = []
        for row in query_table("ke_hoach_lcnt"):
            item = map_db_to_json("ke_hoach_lcnt", dict(row))
            for list_key in ["cvDaThucHienList", "cvKhongApDungList", "cvChuaDuDieuKienList"]:
                if item.get(list_key) is None:
                    item[list_key] = []
            kehoach.append(item)
            
        # 3. Chuyengia
        chuyengia = []
        for row in query_table("chuyen_gia"):
            row_dict = dict(row)
            img = load_base64_image(row_dict.get("anh_chung_chi", ""))
            sig = load_base64_image(row_dict.get("anh_chu_ky", ""))
            item = map_db_to_json("chuyen_gia", row_dict)
            item["anhChungChi"] = img
            item["anhChuKy"] = sig
            chuyengia.append(item)
            
        # 4. Nhathau
        nhathau = []
        for row in query_table("nha_thau"):
            nhathau.append(map_db_to_json("nha_thau", dict(row)))
            
        # 5. Goithau
        goithau = []
        for row in query_table("goi_thau"):
            row_dict = dict(row)
            item = map_db_to_json("goi_thau", row_dict)
            cg_ids = []
            if item.get("toChuyenGia"):
                for x in item.get("toChuyenGia", []):
                    if isinstance(x, dict) and 'id' in x:
                        val = x['id']
                        if val and not str(val).startswith("cg-"):
                            cg_ids.append(f"cg-{val}")
                        else:
                            cg_ids.append(val)
            item["chuyenGiaIds"] = cg_ids
            for list_key in ["phanLoList", "tuyChonMuaThemList", "awardedPhanLoList", "toChuyenGia", "toThamDinh", "giaHanList", "yeuCauLamRoList", "traLoiLamRoList"]:
                if item.get(list_key) is None:
                    item[list_key] = []
            goithau.append(item)
            
        # 6. Hopdong
        hopdong = []
        for row in query_table("hop_dong"):
            row_dict = dict(row)
            item = map_db_to_json("hop_dong", row_dict)
            # Lấy danh sách gói thầu thuộc hợp đồng này (junction table)
            goithau_ids = []
            cursor.execute("SELECT goi_thau_id FROM hop_dong_goi_thau WHERE hop_dong_id = ?", (row_dict["id"],))
            for subrow in cursor.fetchall():
                val = subrow[0]
                if val and not val.startswith("gt-"):
                    goithau_ids.append(f"gt-{val}")
                else:
                    goithau_ids.append(val)
            item["goiThauIds"] = goithau_ids
            hopdong.append(item)
            
        # 7. Assignments
        assignments = []
        if since > 0:
            cursor.execute("SELECT * FROM phan_cong_nhan_su WHERE owner_id = ? AND updated_at > ?", (org_name, since))
        else:
            cursor.execute("SELECT * FROM phan_cong_nhan_su WHERE owner_id = ?", (org_name,))
        for row in cursor.fetchall():
            assignments.append(map_db_to_json("phan_cong_nhan_su", dict(row)))
            
        # 8. Custom Paper Statuses
        custompaperstatuses = []
        if since > 0:
            cursor.execute("SELECT * FROM trang_thai_ho_so_giay WHERE owner_id = ? AND updated_at > ?", (org_name, since))
        else:
            cursor.execute("SELECT * FROM trang_thai_ho_so_giay WHERE owner_id = ?", (org_name,))
        for row in cursor.fetchall():
            custompaperstatuses.append(map_db_to_json("trang_thai_ho_so_giay", dict(row)))
            
        # 9. Thong Tin Mo Thau
        thongtinmothau = []
        for row in query_table("thong_tin_mo_thau"):
            thongtinmothau.append(map_db_to_json("thong_tin_mo_thau", dict(row)))
            
        # 10. Deletions
        deletions = []
        if since > 0:
            cursor.execute("SELECT table_name, record_id FROM deleted_records WHERE owner_id = ? AND deleted_at > ?", (org_name, since))
            TABLE_KEYS = {
                "chudautu": "chu_dau_tu",
                "kehoach": "ke_hoach_lcnt",
                "goithau": "goi_thau",
                "chuyengia": "chuyen_gia",
                "nhathau": "nha_thau",
                "hopdong": "hop_dong",
                "assignments": "phan_cong_nhan_su",
                "custompaperstatuses": "trang_thai_ho_so_giay",
                "thongtinmothau": "thong_tin_mo_thau"
            }
            TABLE_KEYS_INV = {v: k for k, v in TABLE_KEYS.items()}
            for row in cursor.fetchall():
                tbl_key = TABLE_KEYS_INV.get(row[0])
                if tbl_key:
                    prefix_map = {
                        "chu_dau_tu": "cdt-",
                        "ke_hoach_lcnt": "kh-",
                        "goi_thau": "gt-",
                        "chuyen_gia": "cg-",
                        "nha_thau": "nt-",
                        "hop_dong": "hd-",
                        "thong_tin_mo_thau": "tm-"
                    }
                    pfx = prefix_map.get(row[0], "")
                    deletions.append({"table": tbl_key, "id": f"{pfx}{row[1]}"})
                    
        conn.close()
        
        return JSONResponse({
            "chudautu": chudautu,
            "kehoach": kehoach,
            "chuyengia": chuyengia,
            "nhathau": nhathau,
            "goithau": goithau,
            "hopdong": hopdong,
            "assignments": assignments,
            "custompaperstatuses": custompaperstatuses,
            "thongtinmothau": thongtinmothau,
            "deletions": deletions,
            "useServerSidePagination": use_server_pagination,
            "timestamp": current_time
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)

async def paginate_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
            
        params = request.query_params
        table_key = params.get("table")
        page = int(params.get("page", 1))
        page_size = int(params.get("pageSize", 10))
        search = params.get("search", "").strip().lower()
        
        TABLE_KEYS = {
            "chudautu": "chu_dau_tu",
            "kehoach": "ke_hoach_lcnt",
            "goithau": "goi_thau",
            "chuyengia": "chuyen_gia",
            "nhathau": "nha_thau",
            "hopdong": "hop_dong"
        }
        
        if table_key not in TABLE_KEYS:
            return JSONResponse({"error": "Invalid table key"}, status_code=400)
            
        table_name = TABLE_KEYS[table_key]
        org_name = get_active_org(request, role_or_err.user_id)
        
        # Build query
        query_parts = ["owner_id = ?"]
        query_params = [org_name]
        
        # Apply versioning filter for tables that support it
        versioned_tables = ["chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau"]
        if table_name in versioned_tables:
            query_parts.append("is_latest = 1")
            
        # Apply search filter
        if search:
            search_like = f"%{search}%"
            if table_name == "ke_hoach_lcnt":
                query_parts.append("(ma_ke_hoach LIKE ? OR ten_ke_hoach LIKE ? OR ten_du_an_du_toan LIKE ?)")
                query_params.extend([search_like, search_like, search_like])
            elif table_name == "goi_thau":
                query_parts.append("(ma_goi_thau LIKE ? OR ten_goi_thau LIKE ?)")
                query_params.extend([search_like, search_like])
            elif table_name == "chu_dau_tu":
                query_parts.append("(ma_chu_dau_tu LIKE ? OR ten_chu_dau_tu LIKE ? OR ma_so_thue LIKE ?)")
                query_params.extend([search_like, search_like, search_like])
            elif table_name == "nha_thau":
                query_parts.append("(ma_nha_thau LIKE ? OR ten_nha_thau LIKE ? OR ma_so_thue LIKE ?)")
                query_params.extend([search_like, search_like, search_like])
            elif table_name == "chuyen_gia":
                query_parts.append("(ho_ten LIKE ? OR so_cccd LIKE ? OR so_chung_chi LIKE ?)")
                query_params.extend([search_like, search_like, search_like])
            elif table_name == "hop_dong":
                query_parts.append("(so_hop_dong LIKE ? OR ten_hop_dong LIKE ?)")
                query_params.extend([search_like, search_like])
                
        # Apply specific filters (e.g. trangThai and hinhThuc for goi_thau)
        if table_name == "goi_thau":
            trang_thai = params.get("trangThai", "")
            hinh_thuc = params.get("hinhThuc", "")
            if trang_thai:
                query_parts.append("trang_thai = ?")
                query_params.append(trang_thai)
            if hinh_thuc:
                query_parts.append("hinh_thuc_lua_chon = ?")
                query_params.append(hinh_thuc)
                
        # Get count
        where_clause = " AND ".join(query_parts)
        conn = database.get_connection()
        cursor = conn.cursor()
        
        count_sql = f"SELECT COUNT(*) FROM {table_name} WHERE {where_clause}"
        cursor.execute(count_sql, tuple(query_params))
        total_items = cursor.fetchone()[0]
        
        # Get paginated items
        offset = (page - 1) * page_size
        items_sql = f"SELECT * FROM {table_name} WHERE {where_clause} LIMIT ? OFFSET ?"
        cursor.execute(items_sql, tuple(query_params + [page_size, offset]))
        rows = cursor.fetchall()
        
        # Map DB snake_case to JSON camelCase
        def map_db_to_json(tbl, row_dict):
            item = {}
            table_spec = SCHEMA_DINH_NGHIA[tbl]
            for col in table_spec["columns"].keys():
                json_key = SPECIAL_FIELD_MAPS.get(tbl, {}).get(col)
                if not json_key:
                    if col == "id_goc":
                        json_key = "rootId"
                    else:
                        json_key = to_camel_case(col)
                val = row_dict.get(col)
                
                # Prepend prefix
                if col == "id" or col.endswith("_id") or col == "id_goc":
                    if tbl != "phan_cong_nhan_su" and val is not None:
                        prefix = ""
                        if col == "id":
                            prefix_map = {
                                "chu_dau_tu": "cdt-",
                                "ke_hoach_lcnt": "kh-",
                                "goi_thau": "gt-",
                                "chuyen_gia": "cg-",
                                "nha_thau": "nt-",
                                "hop_dong": "hd-",
                                "thong_tin_mo_thau": "tm-"
                            }
                            prefix = prefix_map.get(tbl, "")
                        elif col == "chu_dau_tu_id":
                            prefix = "cdt-"
                        elif col == "ke_hoach_id":
                            prefix = "kh-"
                        elif col == "goi_thau_id":
                            prefix = "gt-"
                        elif col == "nha_thau_trung_thau_id" or col == "nha_thau_id":
                            prefix = "nt-"
                        elif col == "id_goc":
                            prefix_map = {
                                "ke_hoach_lcnt": "kh-",
                                "goi_thau": "gt-",
                                "chu_dau_tu": "cdt-",
                                "nha_thau": "nt-"
                            }
                            prefix = prefix_map.get(tbl, "")
                        if isinstance(val, str) and prefix and val.startswith(prefix):
                            pass
                        else:
                            val = f"{prefix}{val}"
                        
                is_json_field = col.endswith("_list") or col.startswith("cv_") or col == "thanh_vien_lien_danh"
                if is_json_field:
                    if val:
                        try:
                            val = json.loads(val)
                        except Exception:
                            val = []
                    else:
                        val = []
                item[json_key] = val
            return item
            
        items = []
        for row in rows:
            row_dict = dict(row)
            # handle base64 images for chuyengia
            if table_name == "chuyen_gia":
                row_dict["anh_chung_chi"] = load_base64_image(row_dict.get("anh_chung_chi", ""))
                row_dict["anh_chu_ky"] = load_base64_image(row_dict.get("anh_chu_ky", ""))
                
            item = map_db_to_json(table_name, row_dict)
            
            # Additional relationships for goithau/hopdong
            if table_name == "goi_thau":
                cg_ids = []
                if item.get("toChuyenGia"):
                    for x in item.get("toChuyenGia", []):
                        if isinstance(x, dict) and 'id' in x:
                            val = x['id']
                            if val and not str(val).startswith("cg-"):
                                cg_ids.append(f"cg-{val}")
                            else:
                                cg_ids.append(val)
                item["chuyenGiaIds"] = cg_ids
                for list_key in ["phanLoList", "tuyChonMuaThemList", "awardedPhanLoList", "toChuyenGia", "toThamDinh", "giaHanList", "yeuCauLamRoList", "traLoiLamRoList"]:
                    if item.get(list_key) is None:
                        item[list_key] = []
            elif table_name == "hop_dong":
                goithau_ids = []
                cursor.execute("SELECT goi_thau_id FROM hop_dong_goi_thau WHERE hop_dong_id = ?", (row_dict["id"],))
                for subrow in cursor.fetchall():
                    val = subrow[0]
                    if val and not val.startswith("gt-"):
                        goithau_ids.append(f"gt-{val}")
                    else:
                        goithau_ids.append(val)
                item["goiThauIds"] = goithau_ids
                
            # If versioned table, query all versions for the dropdown
            if table_name in versioned_tables:
                root_col = "id_goc" if "id_goc" in row_dict and row_dict["id_goc"] else "id"
                root_val = row_dict.get("id_goc") or row_dict.get("id")
                cursor.execute(f"SELECT id, phien_ban FROM {table_name} WHERE owner_id = ? AND (id_goc = ? OR id = ?) ORDER BY CAST(phien_ban AS INTEGER) DESC", (org_name, root_val, root_val))
                versions = []
                for v_row in cursor.fetchall():
                    prefix_map = {
                        "chu_dau_tu": "cdt-",
                        "ke_hoach_lcnt": "kh-",
                        "goi_thau": "gt-",
                        "nha_thau": "nt-"
                    }
                    pfx = prefix_map.get(table_name, "")
                    versions.append({
                        "id": f"{pfx}{v_row[0]}",
                        "phienBan": v_row[1]
                    })
                item["allVersions"] = versions
                
            items.append(item)
            
        conn.close()
        return JSONResponse({
            "items": items,
            "totalItems": total_items
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)
