import json
import re
import asyncio
import traceback
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
    log_error,
    get_active_org
)

# Global dictionary to store active WebSocket connections
active_connections = {}  # owner_id -> set of websocket instances

TABLE_KEYS = {
    "chudautu": "chu_dau_tu",
    "kehoach": "ke_hoach_lcnt",
    "goithau": "goi_thau",
    "chuyengia": "chuyen_gia",
    "nhathau": "nha_thau",
    "hopdong": "hop_dong",
    "assignments": "phan_cong_nhan_su",
    "custompaperstatuses": "trang_thai_ho_so_giay",
    "thongtinmothau": "thong_tin_mo_thau",
    "permissionmatrix": "ma_tran_phan_quyen"
}

# ==========================================
# CÁC HÀM TRỢ GIÚP CHO ĐỒNG BỘ DỮ LIỆU
# ==========================================

def safe_int_id(val, prefix=""):
    if not val:
        return None
    val_str = str(val).strip()
    if prefix:
        val_str = val_str.replace(prefix, "")
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

def _get_expert_relations_for_packages(cursor, gt_ids):
    if not gt_ids:
        return {}
    placeholders = ", ".join(["?"] * len(gt_ids))
    cursor.execute(f"""
        SELECT goi_thau_id, chuyen_gia_id, loai, chuc_vu, cong_viec
        FROM goi_thau_chuyen_gia
        WHERE goi_thau_id IN ({placeholders})
    """, tuple(gt_ids))
    relations_map = {}
    for rel_row in cursor.fetchall():
        gt_id = rel_row[0]
        entry = {
            "chuyenGiaId": rel_row[1],
            "id": rel_row[1],
            "chucVu": rel_row[3] or "Tổ viên",
            "congViec": rel_row[4] or ""
        }
        if gt_id not in relations_map:
            relations_map[gt_id] = {"to_cg": [], "to_td": [], "cg_ids": []}
        if rel_row[2] == "chuyen_gia":
            relations_map[gt_id]["to_cg"].append(entry)
            relations_map[gt_id]["cg_ids"].append(rel_row[1])
        else:
            relations_map[gt_id]["to_td"].append(entry)
    return relations_map

def _get_contract_package_ids(cursor, hd_ids):
    """Batch query: lấy toàn bộ gói thầu thuộc danh sách hợp đồng để tránh N+1."""
    if not hd_ids:
        return {}
    placeholders = ", ".join(["?"] * len(hd_ids))
    cursor.execute(
        f"SELECT hop_dong_id, goi_thau_id FROM hop_dong_goi_thau WHERE hop_dong_id IN ({placeholders})",
        tuple(hd_ids)
    )
    result = {}
    for row in cursor.fetchall():
        hd_id = row[0]
        gt_id = row[1]
        if gt_id:
            result.setdefault(hd_id, []).append(gt_id)
    return result

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
            try:
                # Chờ tối đa 60 giây — nếu timeout thì gửi ping để kiểm tra kết nối còn sống
                await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
            except asyncio.TimeoutError:
                # Gửi ping — nếu connection đã chết sẽ raise exception và thoát loop
                await websocket.send_text('{"type":"ping"}')
            
    except Exception:
        pass
    finally:
        if owner_id and owner_id in active_connections:
            active_connections[owner_id].discard(websocket)
            if not active_connections[owner_id]:
                del active_connections[owner_id]

def broadcast_websocket_event(owner_id, message):
    if owner_id not in active_connections:
        return
    websockets = list(active_connections[owner_id])
    msg_str = json.dumps(message)
    
    async def broadcast():
        dead = []
        for ws in websockets:
            try:
                await ws.send_text(msg_str)
            except Exception:
                dead.append(ws)
        # Remove dead sockets
        for ws in dead:
            active_connections[owner_id].discard(ws)
        if not active_connections.get(owner_id):
            active_connections.pop(owner_id, None)
    
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(broadcast())
    except RuntimeError:
        pass  # Không có event loop đang chạy – bỏ qua

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
        
        # Sử dụng hằng số TABLE_KEYS toàn cục
        
        def get_clean_id(tbl, raw_id):
            if raw_id is None:
                return None
            if tbl in ["phan_cong_nhan_su", "trang_thai_ho_so_giay"]:
                return str(raw_id).strip()
            return clean_id(raw_id)
            
        updated_versioned_tables = set()
        orphaned_ids = []  # Danh sách record bị từ chối do FK (parent đã bị xóa) — gửi về client để xóa khỏi IndexedDB
        
        for payload_key, table_name in TABLE_KEYS.items():
            if payload_key not in data:
                continue
            items = data[payload_key]
            if not isinstance(items, list):
                continue
                
            table_spec = SCHEMA_DINH_NGHIA[table_name]
            columns = list(table_spec["columns"].keys())
            
            # Lưu vết các bảng thay đổi dữ liệu có cơ chế phiên bản
            if table_name in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "goi_thau"] and items:
                updated_versioned_tables.add(table_name)
            
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
                                default_match = re.search(r"DEFAULT\s+'([^']+)'", col_type_upper)
                                if default_match:
                                    val = default_match.group(1)
                                    
                            # Tối ưu hóa lưu trữ ảnh chuyên gia ra file vật lý
                            if table_name == "chuyen_gia" and col in ["anh_chung_chi", "anh_chu_ky"] and val:
                                ext_suffix = "cert" if col == "anh_chung_chi" else "sig"
                                expert_id = clean_id(item.get('id'))
                                val = save_base64_image(val, "chuyen_gia", f"{expert_id}_{ext_suffix}")
                                    
                        row_data[col] = val
                        
                    # Thực thi UPSERT thay cho INSERT OR REPLACE để bảo toàn created_at
                    non_null_row_data = {k: v for k, v in row_data.items() if v is not None}
                    cols_str = ", ".join(non_null_row_data.keys())
                    placeholders = ", ".join(["?"] * len(non_null_row_data))
                    update_assignments = ", ".join([f"{k}=excluded.{k}" for k in non_null_row_data.keys() if k not in ["id", "created_at"]])
                    if update_assignments:
                        sql = f"""
                            INSERT INTO {table_name} ({cols_str}) VALUES ({placeholders})
                            ON CONFLICT(id) DO UPDATE SET {update_assignments}
                        """
                    else:
                        sql = f"INSERT INTO {table_name} ({cols_str}) VALUES ({placeholders}) ON CONFLICT(id) DO NOTHING"
                    cursor.execute(sql, tuple(non_null_row_data.values()))
                    
                    # Ràng buộc thêm: Gắn các gói thầu với hợp đồng (junction table)
                    if table_name == "hop_dong":
                        c_hd_id = get_clean_id("hop_dong", item.get('id'))
                        cursor.execute("""
                            DELETE FROM hop_dong_goi_thau 
                            WHERE hop_dong_id = ? 
                              AND hop_dong_id IN (SELECT id FROM hop_dong WHERE owner_id = ?)
                        """, (c_hd_id, org_name))
                        for gt_id_str in item.get('goiThauIds', []):
                            if gt_id_str:
                                gt_id = clean_id(gt_id_str)
                                if gt_id is not None:
                                    cursor.execute(
                                        "INSERT OR REPLACE INTO hop_dong_goi_thau (hop_dong_id, goi_thau_id) VALUES (?, ?)",
                                        (c_hd_id, gt_id)
                                    )

                    # Ràng buộc thêm: Đồng bộ tổ chuyên gia và tổ thẩm định của gói thầu sang bảng goi_thau_chuyen_gia
                    if table_name == "goi_thau":
                        c_gt_id = get_clean_id("goi_thau", item.get('id'))
                        
                        # Xử lý Tổ chuyên gia — chỉ đọc từ toChuyenGia (nguồn duy nhất từ client)
                        if 'toChuyenGia' in item:
                            cursor.execute("DELETE FROM goi_thau_chuyen_gia WHERE goi_thau_id = ? AND loai = 'chuyen_gia'", (c_gt_id,))
                            cg_raw = item.get('toChuyenGia') or []
                            if isinstance(cg_raw, str):
                                try:
                                    cg_raw = json.loads(cg_raw)
                                except Exception:
                                    cg_raw = []
                            if isinstance(cg_raw, list):
                                for cg_item in cg_raw:
                                    if isinstance(cg_item, dict):
                                        cg_id = cg_item.get('chuyenGiaId') or cg_item.get('id')
                                        if cg_id:
                                            clean_cg_id = clean_id(cg_id)
                                            chuc_vu = cg_item.get('chucVu') or cg_item.get('chuc_vu') or 'Tổ viên'
                                            cong_viec = cg_item.get('congViec') or cg_item.get('cong_viec') or ''
                                            cursor.execute("""
                                                INSERT OR REPLACE INTO goi_thau_chuyen_gia (goi_thau_id, chuyen_gia_id, loai, chuc_vu, cong_viec)
                                                VALUES (?, ?, 'chuyen_gia', ?, ?)
                                            """, (c_gt_id, clean_cg_id, chuc_vu, cong_viec))
                                            
                        # Xử lý Tổ thẩm định — chỉ đọc từ toThamDinh (nguồn duy nhất từ client)
                        if 'toThamDinh' in item:
                            cursor.execute("DELETE FROM goi_thau_chuyen_gia WHERE goi_thau_id = ? AND loai = 'tham_dinh'", (c_gt_id,))
                            td_raw = item.get('toThamDinh') or []
                            if isinstance(td_raw, str):
                                try:
                                    td_raw = json.loads(td_raw)
                                except Exception:
                                    td_raw = []
                            if isinstance(td_raw, list):
                                for td_item in td_raw:
                                    if isinstance(td_item, dict):
                                        td_id = td_item.get('chuyenGiaId') or td_item.get('id')
                                        if td_id:
                                            clean_td_id = clean_id(td_id)
                                            chuc_vu = td_item.get('chucVu') or td_item.get('chuc_vu') or 'Tổ viên'
                                            cong_viec = td_item.get('congViec') or td_item.get('cong_viec') or ''
                                            cursor.execute("""
                                                INSERT OR REPLACE INTO goi_thau_chuyen_gia (goi_thau_id, chuyen_gia_id, loai, chuc_vu, cong_viec)
                                                VALUES (?, ?, 'tham_dinh', ?, ?)
                                            """, (c_gt_id, clean_td_id, chuc_vu, cong_viec))
                except Exception as item_err:
                    err_str = str(item_err)
                    item_id = get_clean_id(table_name, item.get('id'))
                    # FK constraint: parent bị xóa — ghi orphan vào deleted_records và bỏ qua lặng lẽ
                    if "FOREIGN KEY constraint failed" in err_str and item_id:
                        try:
                            cursor.execute(
                                "INSERT OR IGNORE INTO deleted_records (table_name, record_id, owner_id, deleted_at) VALUES (?, ?, ?, ?)",
                                (table_name, item_id, org_name, current_time)
                            )
                            orphaned_ids.append({"table": table_name, "id": item_id})
                        except Exception:
                            pass
                    else:
                        log_sync_error(f"Lỗi đồng bộ bản ghi trong bảng {table_name} (ID: {item.get('id')}): {item_err}\n{traceback.format_exc()}")
                    
        # 3. Xử lý xóa bản ghi tường minh được gửi từ Client (Explicit Deletions)
        deletions = data.get("deletions", [])
        if isinstance(deletions, list):
            for del_item in deletions:
                if isinstance(del_item, dict):
                    tbl_key = del_item.get("table")
                    rec_id = del_item.get("id")
                    if tbl_key in TABLE_KEYS:
                        table_name = TABLE_KEYS[tbl_key]
                        c_id = get_clean_id(table_name, rec_id)
                        if c_id:
                            cursor.execute(f"DELETE FROM {table_name} WHERE owner_id = ? AND id = ?", (org_name, c_id))
                            cursor.execute(
                                "INSERT OR IGNORE INTO deleted_records (table_name, record_id, owner_id, deleted_at) VALUES (?, ?, ?, ?)",
                                (table_name, c_id, org_name, current_time)
                            )
                            # Cần cập nhật lại is_latest nếu bảng bị xóa là bảng versioning
                            if table_name in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "goi_thau"]:
                                updated_versioned_tables.add(table_name)

        # Cập nhật cờ is_latest cho các bảng versioning (chỉ khi có thay đổi)
        # [TỐI ƯU] Dùng CASE WHEN thay COALESCE để SQLite có thể tận dụng index (id_goc, phien_ban)
        for tbl in updated_versioned_tables:
            cursor.execute(f"UPDATE {tbl} SET is_latest = 0 WHERE owner_id = ?", (org_name,))
            cursor.execute(f"""
                UPDATE {tbl} SET is_latest = 1 WHERE owner_id = ? AND id IN (
                    SELECT t1.id FROM {tbl} t1
                    INNER JOIN (
                        SELECT
                            CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END as id_goc_group,
                            MAX(CAST(phien_ban AS INTEGER)) as max_ver
                        FROM {tbl}
                        WHERE owner_id = ?
                        GROUP BY CASE WHEN id_goc IS NOT NULL AND id_goc != '' THEN id_goc ELSE id END
                    ) t2 ON (
                        CASE WHEN t1.id_goc IS NOT NULL AND t1.id_goc != '' THEN t1.id_goc ELSE t1.id END
                    ) = t2.id_goc_group
                    AND CAST(t1.phien_ban AS INTEGER) = t2.max_ver
                    WHERE t1.owner_id = ?
                )
            """, (org_name, org_name, org_name))
                    
        conn.commit()
        
        # Broadcast WebSocket update
        broadcast_websocket_event(org_name, {"event": "db_changed", "sender_session": request.headers.get('X-Session-Token')})
        
        response_data = {"status": "success", "timestamp": current_time}
        if orphaned_ids:
            response_data["orphanedIds"] = orphaned_ids  # Client sẽ xóa các record này khỏi IndexedDB
        return JSONResponse(response_data)
    except Exception as e:
        log_sync_error(f"Lỗi tổng quát sync_api: {e}\n{traceback.format_exc()}")
        return JSONResponse({"error": "Đồng bộ dữ liệu thất bại. Vui lòng thử lại."}, status_code=500)
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
            # Trả về đường dẫn tương đối thay vì mã hóa base64 toàn bộ ảnh ở danh sách
            img_path = row_dict.get("anh_chung_chi", "")
            sig_path = row_dict.get("anh_chu_ky", "")
            item = map_db_to_json("chuyen_gia", row_dict)
            item["anhChungChi"] = "/" + img_path if img_path and img_path.startswith("uploads") else img_path
            item["anhChuKy"] = "/" + sig_path if sig_path and sig_path.startswith("uploads") else sig_path
            chuyengia.append(item)
            
        # 4. Nhathau
        nhathau = []
        for row in query_table("nha_thau"):
            nhathau.append(map_db_to_json("nha_thau", dict(row)))
            
        # 5. Goithau
        goithau = []
        goithau_rows = query_table("goi_thau")
        gt_ids = [row["id"] for row in goithau_rows]
        relations_map = _get_expert_relations_for_packages(cursor, gt_ids)
        
        for row in goithau_rows:
            row_dict = dict(row)
            item = map_db_to_json("goi_thau", row_dict)
            gt_id = row_dict["id"]
            
            # Lấy tổ chuyên gia từ relations_map đã batch query để tránh N+1
            pkg_rels = relations_map.get(gt_id, {"to_cg": [], "to_td": [], "cg_ids": []})
            item["toChuyenGia"] = pkg_rels.get("to_cg", [])
            item["toThamDinh"] = pkg_rels.get("to_td", [])
            item["chuyenGiaIds"] = pkg_rels.get("cg_ids", [])
            
            for list_key in ["phanLoList", "tuyChonMuaThemList", "awardedPhanLoList", "giaHanList", "yeuCauLamRoList", "traLoiLamRoList"]:
                if item.get(list_key) is None:
                    item[list_key] = []
            goithau.append(item)
            
        # 6. Hopdong — dùng batch query để tránh N+1
        hopdong = []
        hopdong_rows = query_table("hop_dong")
        hd_ids = [row["id"] for row in hopdong_rows]
        contract_packages_map = _get_contract_package_ids(cursor, hd_ids)
        for row in hopdong_rows:
            row_dict = dict(row)
            item = map_db_to_json("hop_dong", row_dict)
            item["goiThauIds"] = contract_packages_map.get(row_dict["id"], [])
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

        # 10. Permission Matrix - [MỚI] Đồng bộ phân quyền nhân viên từ server
        permissionmatrix = []
        try:
            if since > 0:
                cursor.execute("SELECT * FROM ma_tran_phan_quyen WHERE owner_id = ? AND updated_at > ?", (org_name, since))
            else:
                cursor.execute("SELECT * FROM ma_tran_phan_quyen WHERE owner_id = ?", (org_name,))
            for row in cursor.fetchall():
                permissionmatrix.append(map_db_to_json("ma_tran_phan_quyen", dict(row)))
        except Exception:
            pass  # Bảng chưa tồn tại, trả về mảng rỗng
            
        # 11. Deletions
        deletions = []
        if since > 0:
            cursor.execute("SELECT table_name, record_id FROM deleted_records WHERE owner_id = ? AND deleted_at > ?", (org_name, since))
            TABLE_KEYS_INV = {v: k for k, v in TABLE_KEYS.items()}
            for row in cursor.fetchall():
                tbl_key = TABLE_KEYS_INV.get(row[0])
                if tbl_key:
                    deletions.append({"table": tbl_key, "id": row[1]})
                    
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
            "permissionmatrix": permissionmatrix,  # [MỚI] Phân quyền nhân viên
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
        
        # Sử dụng TABLE_KEYS toàn cục
        
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
        
        # Gộp truy vấn danh sách chuyên gia/thẩm định để tránh N+1
        relations_map = {}
        if table_name == "goi_thau" and rows:
            gt_ids = [r["id"] for r in rows]
            relations_map = _get_expert_relations_for_packages(cursor, gt_ids)
            
        items = []
        for row in rows:
            row_dict = dict(row)
            # Trả về đường dẫn tương đối thay vì mã hóa base64 toàn bộ ảnh ở danh sách
            if table_name == "chuyen_gia":
                img_path = row_dict.get("anh_chung_chi", "")
                sig_path = row_dict.get("anh_chu_ky", "")
                row_dict["anh_chung_chi"] = "/" + img_path if img_path and img_path.startswith("uploads") else img_path
                row_dict["anh_chu_ky"] = "/" + sig_path if sig_path and sig_path.startswith("uploads") else sig_path
                
            item = map_db_to_json(table_name, row_dict)
            
            # Khôi phục quan hệ cho gói thầu và hợp đồng
            if table_name == "goi_thau":
                gt_id = row_dict["id"]
                pkg_rels = relations_map.get(gt_id, {"to_cg": [], "to_td": [], "cg_ids": []})
                item["toChuyenGia"] = pkg_rels.get("to_cg", [])
                item["toThamDinh"] = pkg_rels.get("to_td", [])
                item["chuyenGiaIds"] = pkg_rels.get("cg_ids", [])
                for list_key in ["phanLoList", "tuyChonMuaThemList", "awardedPhanLoList", "giaHanList", "yeuCauLamRoList", "traLoiLamRoList"]:
                    if item.get(list_key) is None:
                        item[list_key] = []
            elif table_name == "hop_dong":
                goithau_ids = []
                cursor.execute("SELECT goi_thau_id FROM hop_dong_goi_thau WHERE hop_dong_id = ?", (row_dict["id"],))
                for subrow in cursor.fetchall():
                    val = subrow[0]
                    if val:
                        goithau_ids.append(val)
                item["goiThauIds"] = goithau_ids
                
            # If versioned table, query all versions for the dropdown
            if table_name in versioned_tables:
                root_col = "id_goc" if "id_goc" in row_dict and row_dict["id_goc"] else "id"
                root_val = row_dict.get("id_goc") or row_dict.get("id")
                cursor.execute(f"SELECT id, phien_ban FROM {table_name} WHERE owner_id = ? AND (id_goc = ? OR id = ?) ORDER BY CAST(phien_ban AS INTEGER) DESC", (org_name, root_val, root_val))
                versions = []
                for v_row in cursor.fetchall():
                    versions.append({
                        "id": v_row[0],
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
