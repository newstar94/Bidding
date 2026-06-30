import json
import re
import uuid
import asyncio
import traceback
from datetime import datetime

from starlette.responses import JSONResponse

# Import helpers from helpers.py
from helpers import (
    database,
    verify_session,
    SCHEMA_DINH_NGHIA,
    to_camel_case,
    clean_id,
    save_base64_image,
    load_base64_image,
    log_error,
    get_active_org,
    recalculate_is_latest,
    recalculate_tong_muc_dau_tu,
    OrgPermissionError,
    _assert_safe_table  # [SEC-1] Guard tường minh chống SQL Injection do thiếu whitelist
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

def safe_float(val):
    """
    Parse giá trị sang float.
    Trả về None cho giá trị trống (None/'') để bảo toàn NULL trong DB
    (phân biệt 'chưa nhập' vs 'nhập 0' cho các trường tài chính Optional).
    """
    if val is None or val == '':
        return None
    try:
        s = str(val).strip()
        if not s:
            return None
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
        return None

def safe_int(val):
    """
    Parse giá trị sang int.
    Trả về None cho giá trị trống (None/'') để bảo toàn NULL trong DB.
    """
    if val is None or val == '':
        return None
    try:
        return int(float(val))
    except Exception:
        return None

def map_db_to_json(table_name, row_dict):
    item = {}
    table_spec = SCHEMA_DINH_NGHIA[table_name]
    # Priority 6 (C7): Lấy json_fields tường minh từ schema (thiếu convention _list/cv_)
    explicit_json_fields = set(table_spec.get("json_fields", []))
    field_map = table_spec.get("field_map", {})
    for col in table_spec["columns"].keys():
        # Priority 6: field_map > id_goc > to_camel_case
        json_key = field_map.get(col)
        if not json_key:
            if col == "id_goc":
                json_key = "rootId"
            else:
                json_key = to_camel_case(col)
        val = row_dict.get(col)
        # Priority 4: JSON field detection: explicit (schema) + convention suffix/prefix
        is_json_field = (
            col in explicit_json_fields        # Khai báo tường minh trong schema json_fields
            or col.endswith("_list")           # Convention: danh sách
            or col.startswith("cv_")           # Convention: CV fields
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
            cursor.execute("SELECT id, vai_tro, token_phien, han_su_dung_token FROM tai_khoan WHERE ten_dang_nhap = ? OR (email != '' AND email = ?)", (username, username))
            row = cursor.fetchone()
            conn.close()
            
            if row and row['token_phien'] == token:
                # BE-5: Kiểm tra token expiry trước khi cho phép kết nối WebSocket
                if row['han_su_dung_token']:
                    try:
                        import time as _time
                        if _time.time() > float(row['han_su_dung_token']):
                            await websocket.close(code=4001)  # 4001 = Unauthorized (expired)
                            return
                    except Exception:
                        pass
                user_id = row['id']
                websocket.user_id = user_id
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
        import time as _time
        _last_auth_check = _time.time()
        _AUTH_CHECK_INTERVAL = 30 * 60  # Kiểm tra lại token mỗi 30 phút

        while True:
            _now = _time.time()
            if _now - _last_auth_check >= _AUTH_CHECK_INTERVAL:
                _last_auth_check = _now
                try:
                    _conn = database.get_connection()
                    _cur = _conn.cursor()
                    _cur.execute("SELECT token_phien, han_su_dung_token FROM tai_khoan WHERE id = ?", (user_id,))
                    _row = _cur.fetchone()
                    _conn.close()
                    if not _row or _row['token_phien'] != token:
                        await websocket.close(code=4001)
                        return
                    if _row['han_su_dung_token'] and _now > float(_row['han_su_dung_token']):
                        await websocket.close(code=4001)
                        return
                except Exception:
                    pass

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

def disconnect_user_websockets(user_id):
    """Tìm và ngắt toàn bộ kết nối WebSocket thuộc về user_id."""
    for owner_id, sockets in list(active_connections.items()):
        for ws in list(sockets):
            if getattr(ws, 'user_id', None) == user_id:
                try:
                    async def close_ws(w):
                        try:
                            await w.close(code=4001)
                        except Exception:
                            pass
                    loop = asyncio.get_running_loop()
                    loop.create_task(close_ws(ws))
                except Exception:
                    pass
                # Loại bỏ khỏi danh sách active_connections
                sockets.discard(ws)
        if not active_connections.get(owner_id):
            active_connections.pop(owner_id, None)


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
        conn.execute("BEGIN TRANSACTION")
        cursor = conn.cursor()
        
        org_name = get_active_org(request, role_or_err.user_id)
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # LG-5: Validate org_name (owner_id) to ensure it exists in to_chuc or tai_khoan
        cursor.execute("SELECT 1 FROM to_chuc WHERE id = ?", (org_name,))
        if not cursor.fetchone():
            cursor.execute("SELECT 1 FROM tai_khoan WHERE id = ?", (org_name,))
            if not cursor.fetchone():
                log_sync_error(f"owner_id không hợp lệ: {org_name}")
                return JSONResponse({"error": "Không thể xác định tổ chức hoặc tài khoản sở hữu dữ liệu."}, status_code=400)
        
        # Sử dụng hằng số TABLE_KEYS toàn cục
        
        def get_clean_id(tbl, raw_id):
            if raw_id is None:
                return None
            if tbl in ["phan_cong_nhan_su", "trang_thai_ho_so_giay"]:
                return str(raw_id).strip()
            return clean_id(raw_id)
            
        updated_versioned_tables = set()
        orphaned_ids = []  # Danh sách record bị từ chối do FK (parent đã bị xóa) — gửi về client để xóa khỏi IndexedDB
        
        # Pass 1: Validation
        validation_errors = []
        
        def is_valid_date_format(val):
            if not val:
                return True
            for fmt in (
                "%Y-%m-%d",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%dT%H:%M",
                "%Y-%m-%d %H:%M",
                "%d/%m/%Y",
                "%d/%m/%Y %H:%M:%S",
                "%d/%m/%Y %H:%M"
            ):
                try:
                    datetime.strptime(val, fmt)
                    return True
                except ValueError:
                    pass
            return False
            
        def parse_date(val):
            for fmt in (
                "%Y-%m-%d",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%dT%H:%M",
                "%Y-%m-%d %H:%M",
                "%d/%m/%Y",
                "%d/%m/%Y %H:%M:%S",
                "%d/%m/%Y %H:%M"
            ):
                try:
                    return datetime.strptime(val, fmt)
                except ValueError:
                    pass
            return None

        for payload_key, table_name in TABLE_KEYS.items():
            if payload_key not in data:
                continue
            items = data[payload_key]
            if not isinstance(items, list):
                continue
                
            for item in items:
                item_errors = []
                c_id = get_clean_id(table_name, item.get('id'))
                c_root_id = get_clean_id(table_name, item.get('rootId')) or c_id
                
                # 1. Required fields
                if table_name == "chu_dau_tu":
                    ten = item.get("tenChuDauTu") or item.get("ten_chu_dau_tu")
                    if not ten or not str(ten).strip():
                        item_errors.append("Tên chủ đầu tư không được để trống.")
                elif table_name == "ke_hoach_lcnt":
                    ten = item.get("tenKeHoach") or item.get("ten_ke_hoach")
                    if not ten or not str(ten).strip():
                        item_errors.append("Tên kế hoạch LCNT không được để trống.")
                elif table_name == "goi_thau":
                    ten = item.get("tenGoiThau") or item.get("ten_goi_thau")
                    if not ten or not str(ten).strip():
                        item_errors.append("Tên gói thầu không được để trống.")
                elif table_name == "nha_thau":
                    ten = item.get("tenNhaThau") or item.get("ten_nha_thau")
                    if not ten or not str(ten).strip():
                        item_errors.append("Tên nhà thầu không được để trống.")
                elif table_name == "chuyen_gia":
                    ten = item.get("hoTen") or item.get("ho_ten")
                    if not ten or not str(ten).strip():
                        item_errors.append("Họ và tên chuyên gia không được để trống.")
                elif table_name == "hop_dong":
                    ten = item.get("tenHopDong") or item.get("ten_hop_dong")
                    so_hd = item.get("soHopDong") or item.get("so_hop_dong")
                    if not ten or not str(ten).strip():
                        item_errors.append("Tên hợp đồng không được để trống.")
                    if not so_hd or not str(so_hd).strip():
                        item_errors.append("Số hợp đồng không được để trống.")

                # 2. Format validation
                email = item.get("email")
                if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", str(email).strip()):
                    item_errors.append("Email không đúng định dạng.")
                    
                phone = item.get("soDienThoai") or item.get("so_dien_thoai")
                if phone and not re.match(r"^[0-9\s+\-()]*$", str(phone).strip()):
                    item_errors.append("Số điện thoại không đúng định dạng.")
                
                for date_key in ["ngayQuyetDinh", "thoiGianDangTai", "thoiGianDongThau", "thoiGianMoThau", "ngayPheDuyet", "ngayKy"]:
                    val = item.get(date_key)
                    if val and not is_valid_date_format(str(val).strip()):
                        item_errors.append(f"Trường ngày/giờ '{date_key}' không đúng định dạng.")

                # 3. Logic validation
                if table_name == "goi_thau":
                    dang_tai_str = item.get("thoiGianDangTai") or item.get("thoi_gian_dang_tai")
                    dong_thau_str = item.get("thoiGianDongThau") or item.get("thoi_gian_dong_thau")
                    mo_thau_str = item.get("thoiGianMoThau") or item.get("thoi_gian_mo_thau")
                    
                    dang_tai = parse_date(dang_tai_str) if dang_tai_str else None
                    dong_thau = parse_date(dong_thau_str) if dong_thau_str else None
                    mo_thau = parse_date(mo_thau_str) if mo_thau_str else None
                    
                    if dang_tai and dong_thau and dong_thau <= dang_tai:
                        item_errors.append("Thời gian đóng thầu phải sau thời gian đăng tải.")
                    if dong_thau and mo_thau and mo_thau < dong_thau:
                        item_errors.append("Thời gian mở thầu phải bằng hoặc sau thời gian đóng thầu.")
                        
                    trong_so = item.get("trongSoKyThuat") or item.get("trong_so_ky_thuat")
                    if trong_so is not None:
                        ts_val = safe_int(trong_so)
                        if ts_val is not None and (ts_val < 0 or ts_val > 100):
                            item_errors.append("Trọng số kỹ thuật phải nằm trong khoảng từ 0% đến 100%.")
                            
                    gia = item.get("giaGoiThau") or item.get("gia_goi_thau")
                    if gia is not None:
                        gia_val = safe_float(gia)
                        if gia_val is not None and gia_val < 0:
                            item_errors.append("Giá gói thầu không được nhỏ hơn 0.")
                            
                elif table_name == "ke_hoach_lcnt":
                    tong_muc = item.get("tongMucDauTu") or item.get("tong_muc_dau_tu")
                    if tong_muc is not None:
                        tm_val = safe_float(tong_muc)
                        if tm_val is not None and tm_val < 0:
                            item_errors.append("Tổng mức đầu tư không được nhỏ hơn 0.")
                            
                elif table_name == "hop_dong":
                    gia_tri = item.get("giaTri") or item.get("gia_tri")
                    if gia_tri is not None:
                        gt_val = safe_float(gia_tri)
                        if gt_val is not None and gt_val < 0:
                            item_errors.append("Giá trị hợp đồng không được nhỏ hơn 0.")

                # 4. Duplicate checks
                if table_name == "chu_dau_tu":
                    ma = item.get("maChuDauTu") or item.get("ma_chu_dau_tu")
                    mst = item.get("maSoThue") or item.get("ma_so_thue")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM chu_dau_tu WHERE owner_id = ? AND ma_chu_dau_tu = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã chủ đầu tư '{ma}' đã tồn tại.")
                    if mst and str(mst).strip():
                        cursor.execute("SELECT 1 FROM chu_dau_tu WHERE owner_id = ? AND ma_so_thue = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(mst).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã số thuế '{mst}' đã tồn tại.")
                            
                elif table_name == "ke_hoach_lcnt":
                    ma = item.get("maKeHoach") or item.get("ma_ke_hoach")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM ke_hoach_lcnt WHERE owner_id = ? AND ma_ke_hoach = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã kế hoạch '{ma}' đã tồn tại.")
                            
                elif table_name == "goi_thau":
                    ma = item.get("maGoiThau") or item.get("ma_goi_thau")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM goi_thau WHERE owner_id = ? AND ma_goi_thau = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã gói thầu '{ma}' đã tồn tại.")
                            
                elif table_name == "nha_thau":
                    ma = item.get("maNhaThau") or item.get("ma_nha_thau")
                    mst = item.get("maSoThue") or item.get("ma_so_thue")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM nha_thau WHERE owner_id = ? AND ma_nha_thau = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã nhà thầu '{ma}' đã tồn tại.")
                    if mst and str(mst).strip():
                        cursor.execute("SELECT 1 FROM nha_thau WHERE owner_id = ? AND ma_so_thue = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(mst).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã số thuế '{mst}' đã tồn tại.")
                            
                elif table_name == "chuyen_gia":
                    cccd = item.get("soCCCD") or item.get("so_cccd")
                    if cccd and str(cccd).strip():
                        cursor.execute("SELECT 1 FROM chuyen_gia WHERE owner_id = ? AND so_cccd = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(cccd).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Số CCCD chuyên gia '{cccd}' đã tồn tại.")
                            
                elif table_name == "hop_dong":
                    so_hd = item.get("soHopDong") or item.get("so_hop_dong")
                    if so_hd and str(so_hd).strip():
                        cursor.execute("SELECT 1 FROM hop_dong WHERE owner_id = ? AND so_hop_dong = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(so_hd).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Số hợp đồng '{so_hd}' đã tồn tại.")

                if item_errors:
                    display_name = item.get("tenChuDauTu") or item.get("tenKeHoach") or item.get("tenGoiThau") or item.get("tenNhaThau") or item.get("hoTen") or item.get("tenHopDong") or item.get("id")
                    for err in item_errors:
                        validation_errors.append({
                            "table": table_name,
                            "id": item.get("id"),
                            "message": f"[{display_name}]: {err}"
                        })

        if validation_errors:
            conn.rollback()
            conn.close()
            return JSONResponse({
                "status": "error",
                "message": "Không thể lưu dữ liệu do phát hiện lỗi:",
                "errors": validation_errors
            }, status_code=400)

        for payload_key, table_name in TABLE_KEYS.items():
            if payload_key not in data:
                continue
            items = data[payload_key]
            if not isinstance(items, list):
                continue
                
            table_spec = SCHEMA_DINH_NGHIA[table_name]
            columns = list(table_spec["columns"].keys())
            
            # Lưu vết các bảng thay đổi dữ liệu có cơ chế phiên bản
            if table_name in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "goi_thau", "chuyen_gia", "hop_dong"] and items:
                updated_versioned_tables.add(table_name)
            
            # 2. Thêm hoặc cập nhật (INSERT OR REPLACE) các bản ghi
            for item in items:
                try:
                    db_row_data = {}
                    for col in columns:
                        if col == "owner_id":
                            db_row_data[col] = org_name
                            continue
                        elif col == "updated_at":
                            db_row_data[col] = current_time
                            continue
                        else:
                            # Rút trích key JSON tương ứng từ trường DB
                            field_map = SCHEMA_DINH_NGHIA.get(table_name, {}).get("field_map", {})
                            json_key = field_map.get(col)
                            if not json_key:
                                if col == "id_goc":
                                    json_key = "rootId"
                                else:
                                    json_key = to_camel_case(col)
                                    
                            # Chỉ xử lý/cập nhật nếu trường được truyền lên từ client
                            if (json_key in item) or (col in item):
                                val = item.get(json_key)
                                
                                # Fallback nếu client gửi key ở dạng raw/snake_case
                                if val is None:
                                    val = item.get(col)
                                    
                                # Làm sạch tiền tố ID
                                if col == "id" or col.endswith("_id") or col == "id_goc":
                                    val = get_clean_id(table_name, val)
                                        
                                # Xử lý các trường kiểu List/Dict sang JSON string (Priority 4: dùng schema json_fields)
                                _explicit_json = set(SCHEMA_DINH_NGHIA.get(table_name, {}).get("json_fields", []))
                                if isinstance(val, (list, dict)):
                                    val = json.dumps(val)
                                elif col in _explicit_json or col.endswith("_list") or col.startswith("cv_"):
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
                                    
                                # Bỏ qua cột nếu giá trị là None và cột là NOT NULL (để dùng mặc định / báo lỗi đúng)
                                if val is None and "NOT NULL" in col_type_upper:
                                    continue
                                    
                        # Chuẩn hóa dữ liệu trước khi ghi
                        # [BL-5] Normalize trang_thai: chấp nhận cả 'Huỷ thầu' (ý) và 'Hủy thầu' (ũ) — chuẩn hóa về một dạng
                        if col == 'trang_thai' and val is not None:
                            if str(val).strip() == 'Huỷ thầu':  # u+1ef7 → chuẩn hóa về u+1ee7
                                val = 'Hủy thầu'
                                
                        db_row_data[col] = val
                        
                    # Để tránh lỗi UNIQUE constraint failed khi chèn/cập nhật phan_cong_nhan_su hoặc ma_tran_phan_quyen
                    # và xóa phân công cũ của mục tiêu này để tránh trùng lặp khi đổi chuyên viên phụ trách
                    if not db_row_data.get("id"):
                        db_row_data["id"] = str(uuid.uuid4())

                    if table_name == "phan_cong_nhan_su":
                        cursor.execute("""
                            DELETE FROM phan_cong_nhan_su 
                            WHERE id_muc_tieu = ? AND loai_doi_tuong = ? AND id != ?
                        """, (db_row_data.get("id_muc_tieu"), db_row_data.get("loai_doi_tuong"), db_row_data.get("id")))
                    elif table_name == "ma_tran_phan_quyen":
                        cursor.execute("""
                            DELETE FROM ma_tran_phan_quyen 
                            WHERE owner_id = ? AND emp_id = ? AND id != ?
                        """, (db_row_data.get("owner_id"), db_row_data.get("emp_id"), db_row_data.get("id")))

                    # Thực thi UPSERT thay cho INSERT OR REPLACE để bảo toàn created_at
                    cols_str = ", ".join(db_row_data.keys())
                    placeholders = ", ".join(["?"] * len(db_row_data))
                    update_assignments = ", ".join([f"{k}=excluded.{k}" for k in db_row_data.keys() if k not in ["id", "created_at"]])
                    if update_assignments:
                        sql = f"""
                            INSERT INTO {table_name} ({cols_str}) VALUES ({placeholders})
                            ON CONFLICT(id) DO UPDATE SET {update_assignments}
                        """
                    else:
                        sql = f"INSERT INTO {table_name} ({cols_str}) VALUES ({placeholders}) ON CONFLICT(id) DO NOTHING"
                    cursor.execute(sql, tuple(db_row_data.values()))
                    
                    # Ghi Audit Log cho UPSERT
                    item_id = get_clean_id(table_name, item.get('id'))
                    
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
                            if table_name in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "goi_thau"]:
                                # Tìm id_goc của bản ghi trước khi xóa để xóa sạch toàn bộ lịch sử các phiên bản
                                cursor.execute(f"SELECT id_goc FROM {table_name} WHERE owner_id = ? AND id = ?", (org_name, c_id))
                                row = cursor.fetchone()
                                id_goc = row[0] if row else None
                                if id_goc:
                                    cursor.execute(f"DELETE FROM {table_name} WHERE owner_id = ? AND (id = ? OR id_goc = ?)", (org_name, id_goc, id_goc))
                                else:
                                    cursor.execute(f"DELETE FROM {table_name} WHERE owner_id = ? AND (id = ? OR id_goc = ?)", (org_name, c_id, c_id))
                            else:
                                cursor.execute(f"DELETE FROM {table_name} WHERE owner_id = ? AND id = ?", (org_name, c_id))

                            cursor.execute(
                                "INSERT OR IGNORE INTO deleted_records (table_name, record_id, owner_id, deleted_at) VALUES (?, ?, ?, ?)",
                                (table_name, c_id, org_name, current_time)
                            )
                            # Ghi Audit Log cho DELETE
                            # Cần cập nhật lại is_latest nếu bảng bị xóa là bảng versioning
                            if table_name in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "goi_thau"]:
                                updated_versioned_tables.add(table_name)
                                
        # Tính lại is_latest bằng hàm chung (tránh duplicate logic với migration)
        for tbl in updated_versioned_tables:
            recalculate_is_latest(cursor, tbl, owner_id=org_name)
            
        # LG-3: Tính lại tổng mức đầu tư tự động nếu kế hoạch hoặc gói thầu thay đổi
        if "ke_hoach_lcnt" in updated_versioned_tables or "goi_thau" in updated_versioned_tables:
            recalculate_tong_muc_dau_tu(cursor, owner_id=org_name)
                                 
        conn.commit()
        
        # Broadcast WebSocket update
        broadcast_websocket_event(org_name, {"event": "db_changed", "sender_session": request.headers.get('X-Session-Token')})
        
        response_data = {"status": "success", "timestamp": current_time}
        if orphaned_ids:
            response_data["orphanedIds"] = orphaned_ids  # Client sẽ xóa các record này khỏi IndexedDB
        return JSONResponse(response_data)
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
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
            
        since_val = request.query_params.get('since', '0')
        if since_val.isdigit() and int(since_val) < 10000000000:
            val = int(since_val)
            if val == 0:
                since = '1970-01-01 00:00:00'
            else:
                try:
                    # [BL-1] Dùng fromtimestamp (localtime) thay vì utcfromtimestamp (UTC)
                    # vì DB lưu updated_at bằng datetime('now', 'localtime') → UTC+7
                    since = datetime.fromtimestamp(val).strftime('%Y-%m-%d %H:%M:%S')
                except Exception:
                    since = '1970-01-01 00:00:00'
        else:
            since = since_val

        conn = database.get_connection()
        cursor = conn.cursor()
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')


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
            if since != '1970-01-01 00:00:00' and since != '0':
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
        if since != '1970-01-01 00:00:00' and since != '0':
            cursor.execute("SELECT * FROM phan_cong_nhan_su WHERE owner_id = ? AND updated_at > ?", (org_name, since))
        else:
            cursor.execute("SELECT * FROM phan_cong_nhan_su WHERE owner_id = ?", (org_name,))
        for row in cursor.fetchall():
            assignments.append(map_db_to_json("phan_cong_nhan_su", dict(row)))
            
        # 8. Custom Paper Statuses
        custompaperstatuses = []
        if since != '1970-01-01 00:00:00' and since != '0':
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
            if since != '1970-01-01 00:00:00' and since != '0':
                cursor.execute("SELECT * FROM ma_tran_phan_quyen WHERE owner_id = ? AND updated_at > ?", (org_name, since))
            else:
                cursor.execute("SELECT * FROM ma_tran_phan_quyen WHERE owner_id = ?", (org_name,))
            for row in cursor.fetchall():
                permissionmatrix.append(map_db_to_json("ma_tran_phan_quyen", dict(row)))
        except Exception:
            pass  # Bảng chưa tồn tại, trả về mảng rỗng
            
        # 11. Deletions
        deletions = []
        if since != '1970-01-01 00:00:00' and since != '0':
            # LIMIT 1000 phòng trường hợp có quá nhiều deletion log — tránh trả payload khổng
            cursor.execute(
                "SELECT table_name, record_id FROM deleted_records "
                "WHERE owner_id = ? AND deleted_at > ? "
                "ORDER BY deleted_at DESC LIMIT 1000",
                (org_name, since)
            )
            TABLE_KEYS_INV = {v: k for k, v in TABLE_KEYS.items()}
            for row in cursor.fetchall():
                tbl_key = TABLE_KEYS_INV.get(row[0])
                if tbl_key:
                    deletions.append({"table": tbl_key, "id": row[1]})
                    
        conn.commit()
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
    except OrgPermissionError as e:
        if conn:
            try:
                conn.rollback()
                conn.close()
            except Exception:
                pass
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        traceback.print_exc()
        if conn:
            try:
                conn.rollback()
                conn.close()
            except Exception:
                pass
        return JSONResponse({"error": "Da xay ra loi he thong khi lay du lieu."}, status_code=500)

async def paginate_api(request):
    conn = None  # [BL-4] Khởi tạo trước try để finally có thể đóng khi exception
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
            
        params = request.query_params
        table_key = params.get("table")
        # [SEC-1] Validate table_key trước khi tiếp tục xử lý
        if table_key not in TABLE_KEYS:
            return JSONResponse({"error": "Invalid table key"}, status_code=400)
        table_name = TABLE_KEYS[table_key]
        _assert_safe_table(table_name)  # [SEC-1] Guard tường minh: raise ValueError nếu không hợp lệ
        
        page_size_raw = params.get("pageSize", "10")
        try:
            page = max(1, int(params.get("page", 1)))
            page_size = max(1, min(200, int(page_size_raw)))  # Giới hạn pageSize 1-200
        except (ValueError, TypeError):
            return JSONResponse({"error": "Tham số phân trang không hợp lệ"}, status_code=400)
        search = params.get("search", "").strip().lower()
        
        org_name = get_active_org(request, role_or_err.user_id)
        
        # Build query
        query_parts = ["owner_id = ?"]
        query_params = [org_name]
        
        # Apply versioning filter for tables that support it
        versioned_tables = ["chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "hop_dong", "chuyen_gia"]
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

        # Apply Year and Month filters
        nam = params.get("nam", "")
        thang = params.get("thang", "")
        date_column = None
        if table_name == "ke_hoach_lcnt":
            date_column = "ngay_phe_duyet"
        elif table_name == "goi_thau":
            date_column = "ngay_quyet_dinh"
        elif table_name == "hop_dong":
            date_column = "ngay_ky"

        if date_column:
            if nam:
                query_parts.append(f"(substr({date_column}, 1, 4) = ? OR substr({date_column}, 7, 4) = ?)")
                query_params.extend([nam, nam])
            if thang:
                thang_formatted = str(thang).zfill(2)
                query_parts.append(f"(substr({date_column}, 6, 2) = ? OR substr({date_column}, 4, 2) = ?)")
                query_params.extend([thang_formatted, thang_formatted])

        # Get count
        where_clause = " AND ".join(query_parts)
        conn = database.get_connection()
        cursor = conn.cursor()
        
        count_sql = f"SELECT COUNT(*) FROM {table_name} WHERE {where_clause}"
        cursor.execute(count_sql, tuple(query_params))
        total_items = cursor.fetchone()[0]
        
        # Convert camelCase sortBy from client to snake_case database column name
        sort_by = params.get("sortBy", "").strip()
        sort_order = params.get("sortOrder", "asc").strip().upper()
        if sort_order not in ["ASC", "DESC"]:
            sort_order = "ASC"
            
        db_column = ""
        if sort_by:
            field_map = SCHEMA_DINH_NGHIA.get(table_name, {}).get("field_map", {})
            inverted_map = {v: k for k, v in field_map.items()}
            import re
            camel_to_snake = lambda s: re.sub(r'(?<!^)(?=[A-Z])', '_', s).lower()
            db_column = inverted_map.get(sort_by, camel_to_snake(sort_by))
            
        valid_columns = SCHEMA_DINH_NGHIA.get(table_name, {}).get("columns", {})
        if db_column and db_column in valid_columns:
            sort_sql = f" ORDER BY {db_column} {sort_order}"
        else:
            default_sorts = {
                "ke_hoach_lcnt": "ma_ke_hoach",
                "goi_thau": "ma_goi_thau",
                "chu_dau_tu": "ten_chu_dau_tu",
                "nha_thau": "ten_nha_thau",
                "chuyen_gia": "ho_ten",
                "hop_dong": "ten_hop_dong"
            }
            def_col = default_sorts.get(table_name)
            if def_col and def_col in valid_columns:
                sort_sql = f" ORDER BY {def_col} ASC"
            else:
                sort_sql = ""

        # Get paginated items
        offset = (page - 1) * page_size
        items_sql = f"SELECT * FROM {table_name} WHERE {where_clause}{sort_sql} LIMIT ? OFFSET ?"
        cursor.execute(items_sql, tuple(query_params + [page_size, offset]))
        rows = cursor.fetchall()
        
        # Gộp truy vấn danh sách chuyên gia/thẩm định để tránh N+1
        relations_map = {}
        if table_name == "goi_thau" and rows:
            gt_ids = [r["id"] for r in rows]
            relations_map = _get_expert_relations_for_packages(cursor, gt_ids)
            
        # Gộp truy vấn danh sách gói thầu của hợp đồng để tránh N+1
        contract_packages_map = {}
        if table_name == "hop_dong" and rows:
            hd_ids = [r["id"] for r in rows]
            contract_packages_map = _get_contract_package_ids(cursor, hd_ids)
            
        # [TỐI Ư U] Batch query allVersions trước vòng lặp — tránh N+1 (1 query/row → 1 query tổng)
        versions_by_root = {}
        if table_name in versioned_tables and rows:
            all_root_vals = list({(r["id_goc"] or r["id"]) for r in rows})
            v_placeholders = ", ".join(["?"] * len(all_root_vals))
            cursor.execute(f"""
                SELECT id, id_goc, phien_ban FROM {table_name}
                WHERE owner_id = ? AND (
                    (id_goc IS NOT NULL AND id_goc != '' AND id_goc IN ({v_placeholders})) OR
                    ((id_goc IS NULL OR id_goc = '') AND id IN ({v_placeholders}))
                )
                ORDER BY CAST(phien_ban AS INTEGER) DESC
            """, [org_name] + all_root_vals + all_root_vals)
            for v_row in cursor.fetchall():
                v_root = v_row[1] or v_row[0]  # id_goc nếu có, fallback về id
                if v_root not in versions_by_root:
                    versions_by_root[v_root] = []
                versions_by_root[v_root].append({"id": v_row[0], "phienBan": v_row[2]})

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
                item["goiThauIds"] = contract_packages_map.get(row_dict["id"], [])
                
            # Lấy allVersions từ batch query (không N+1)
            if table_name in versioned_tables:
                root_val = row_dict.get("id_goc") or row_dict.get("id")
                item["allVersions"] = versions_by_root.get(root_val, [])
                
            items.append(item)
            
        conn.close()
        return JSONResponse({
            "items": items,
            "totalItems": total_items
        })
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"error": "Da xay ra loi he thong khi phan trang."}, status_code=500)
    finally:
        # [BL-4] Đảm bảo conn luôn được đóng kể cả khi exception
        if conn:
            try:
                conn.close()
            except Exception:
                pass
