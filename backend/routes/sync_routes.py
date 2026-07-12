import json
import re
import asyncio
import traceback
from datetime import datetime

from starlette.responses import JSONResponse


from helpers import (
    database,
    verify_session,
    SCHEMA_DINH_NGHIA,
    clean_id,
    safe_float,
    safe_int,
    save_base64_image,
    load_base64_image,
    log_error,
    get_active_org,
    recalculate_is_latest,
    recalculate_tong_muc_dau_tu,
    OrgPermissionError,
    _assert_safe_table
)
from helpers_py.sync_mapper import (
    attach_child_rows_to_items,
    canonicalize_payload_item,
    db_column_for_json_key,
    get_payload_value,
    json_key_for_column,
    map_db_to_json,
    save_child_payloads,
)
from helpers_py.sync_validation import DEFAULT_PAPER_STATUS_COLOR, validate_sync_item
from helpers_py.date_utils import is_datetime_column, normalize_datetime_value
from helpers_py.id_utils import generate_record_id
from helpers_py.text_utils import normalize_person_name
from helpers_py.access_policy import (
    authorize_record_write,
    can_read_table,
    can_read_record,
    filter_items_for_read,
    is_manager_role,
)
from .sync_authorization import (
    get_owner_type,
    validate_owner_scoped_references,
)
from .sync_queries import (
    ALLOWED_ORPHAN_TABLES,
    DELETED_RECORD_UPSERT_SQL,
    FTS_SEARCH_TABLES,
    OWNER_TYPES,
    SYNCED_TABLES,
    TABLE_KEYS,
    build_dashboard_summary,
    build_fts_match_query,
    get_contract_package_ids as _get_contract_package_ids,
    get_current_sync_version,
    get_expert_relations_for_packages as _get_expert_relations_for_packages,
    next_sync_version,
)
from .sync_serializers import (
    iter_sync_table_payloads,
    rollback_sync_response,
)
from .sync_service import parse_sync_read_window


active_connections = {}





async def sync_websocket_endpoint(websocket):


    try:
        from app import ALLOWED_WS_ORIGINS, APP_DEBUG as _APP_DEBUG
        origin = (websocket.headers.get("origin") or "").rstrip("/")
        if not _APP_DEBUG and origin and origin not in ALLOWED_WS_ORIGINS:
            await websocket.close(code=4403)
            return
    except Exception:
        pass

    await websocket.accept()

    owner_id = None
    user_id = None
    try:
        data = await websocket.receive_text()
        msg = json.loads(data)
        if msg.get("action") == "auth":
            token = (websocket.cookies.get("session_token") or "").strip()

            conn = database.get_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, vai_tro, token_phien, han_su_dung_token FROM tai_khoan WHERE token_phien = ?",
                (token,)
            )
            row = cursor.fetchone()
            conn.close()

            if row:

                if row['han_su_dung_token']:
                    try:
                        import time as _time
                        if _time.time() > float(row['han_su_dung_token']):
                            await websocket.close(code=4001)
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
        _AUTH_CHECK_INTERVAL = 30 * 60

        _PING_INTERVAL = 55.0
        _PONG_TIMEOUT = 15.0
        _waiting_pong = False

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



                recv_timeout = _PONG_TIMEOUT if _waiting_pong else _PING_INTERVAL
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=recv_timeout)
                _waiting_pong = False
                try:
                    msg_in = json.loads(raw)


                except Exception:
                    pass
            except asyncio.TimeoutError:
                if _waiting_pong:

                    await websocket.close(code=1001)
                    return

                await websocket.send_text('{"type":"ping"}')
                _waiting_pong = True

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

        for ws in dead:
            active_connections[owner_id].discard(ws)
        if not active_connections.get(owner_id):
            active_connections.pop(owner_id, None)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(broadcast())
    except RuntimeError:
        pass

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
        role_str = str(role_or_err)
        user_id = role_or_err.user_id
        owner_type = get_owner_type(cursor, org_name)
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        client_mutation_id = (data.get("clientMutationId") or "").strip()
        if client_mutation_id:
            client_mutation_id = client_mutation_id[:128]
            cursor.execute(
                "SELECT response_json FROM sync_mutations WHERE owner_id = ? AND client_mutation_id = ?",
                (org_name, client_mutation_id)
            )
            existing_mutation = cursor.fetchone()
            if existing_mutation:
                conn.commit()
                try:
                    return JSONResponse(json.loads(existing_mutation[0] or "{}"))
                except Exception:
                    return JSONResponse({"status": "success"})


        if owner_type != "organization":
            cursor.execute("SELECT 1 FROM tai_khoan WHERE id = ?", (org_name,))
            if not cursor.fetchone():
                log_sync_error(f"owner_id không hợp lệ: {org_name}")
                return JSONResponse({"error": "Không thể xác định tổ chức hoặc tài khoản sở hữu dữ liệu."}, status_code=400)



        has_write_payload = any(
            isinstance(data.get(payload_key), list) and len(data.get(payload_key) or []) > 0
            for payload_key in TABLE_KEYS
        ) or (isinstance(data.get("deletions"), list) and len(data.get("deletions") or []) > 0)
        base_sync_version = None
        try:
            if data.get("baseSyncVersion") not in (None, ""):
                base_sync_version = int(data.get("baseSyncVersion"))
        except (TypeError, ValueError):
            base_sync_version = None

        current_sync_version_before_write = get_current_sync_version(cursor, org_name)
        if has_write_payload and base_sync_version is not None and base_sync_version < current_sync_version_before_write:
            conn.rollback()
            return JSONResponse({
                "status": "conflict",
                "message": "Dữ liệu trên máy chủ đã thay đổi. Vui lòng tải lại trước khi đồng bộ tiếp.",
                "baseSyncVersion": base_sync_version,
                "currentSyncVersion": current_sync_version_before_write,
            }, status_code=409)

        batch_sync_version = next_sync_version(cursor, org_name)

        def get_clean_id(tbl, raw_id):
            if raw_id is None:
                return None
            if tbl in ["phan_cong_nhan_su", "trang_thai_ho_so_giay"]:
                return str(raw_id).strip()
            return clean_id(raw_id)

        updated_versioned_tables = set()
        orphaned_ids = []

        sync_item_errors = []


        validation_errors = []
        incoming_paper_status_names = {
            str(item.get("name") or item.get("tenTrangThai") or "").strip()
            for item in data.get("custompaperstatuses", [])
            if isinstance(item, dict) and str(item.get("name") or item.get("tenTrangThai") or "").strip()
        }
        paper_statuses_to_seed = set()


        for payload_key, table_name, items in iter_sync_table_payloads(data):
            for item in items:
                item = canonicalize_payload_item(table_name, item)
                item_errors = []
                access_decision = authorize_record_write(
                    cursor,
                    role_str,
                    user_id,
                    org_name,
                    payload_key,
                    table_name,
                    item,
                )
                if not access_decision.allowed:
                    item_errors.append(access_decision.message)
                c_id = get_clean_id(table_name, item.get('id'))
                c_root_id = get_clean_id(table_name, item.get('rootId')) or c_id
                item, pure_errors, requested_paper_statuses = validate_sync_item(
                    table_name,
                    item,
                    incoming_paper_status_names
                )
                item_errors.extend(pure_errors)
                item_errors.extend(validate_owner_scoped_references(cursor, org_name, table_name, item))
                for status_name in requested_paper_statuses:
                    cursor.execute(
                        "SELECT 1 FROM trang_thai_ho_so_giay WHERE owner_id = ? AND name = ?",
                        (org_name, status_name)
                    )
                    if not cursor.fetchone():
                        paper_statuses_to_seed.add(status_name)


                if table_name == "chu_dau_tu":
                    ma = item.get("maChuDauTu")
                    mst = item.get("maSoThue")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM chu_dau_tu WHERE owner_id = ? AND ma_chu_dau_tu = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã chủ đầu tư '{ma}' đã tồn tại.")
                    if mst and str(mst).strip():
                        cursor.execute("SELECT 1 FROM chu_dau_tu WHERE owner_id = ? AND ma_so_thue = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(mst).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã số thuế '{mst}' đã tồn tại.")

                elif table_name == "ke_hoach_lcnt":
                    ma = item.get("maKeHoach")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM ke_hoach_lcnt WHERE owner_id = ? AND ma_ke_hoach = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã kế hoạch '{ma}' đã tồn tại.")

                elif table_name == "goi_thau":
                    ma = item.get("maGoiThau")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM goi_thau WHERE owner_id = ? AND ma_goi_thau = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã gói thầu '{ma}' đã tồn tại.")

                elif table_name == "nha_thau":
                    ma = item.get("maNhaThau")
                    mst = item.get("maSoThue")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM nha_thau WHERE owner_id = ? AND ma_nha_thau = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã nhà thầu '{ma}' đã tồn tại.")
                    if mst and str(mst).strip():
                        cursor.execute("SELECT 1 FROM nha_thau WHERE owner_id = ? AND ma_so_thue = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(mst).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã số thuế '{mst}' đã tồn tại.")

                elif table_name == "chuyen_gia":
                    cccd = item.get("soCCCD")
                    if cccd and str(cccd).strip():
                        cursor.execute("SELECT 1 FROM chuyen_gia WHERE owner_id = ? AND so_cccd = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(cccd).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Số CCCD chuyên gia '{cccd}' đã tồn tại.")

                elif table_name == "hop_dong":
                    so_hd = item.get("soHopDong")
                    if so_hd and str(so_hd).strip():
                        cursor.execute("SELECT 1 FROM hop_dong WHERE owner_id = ? AND so_hop_dong = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(so_hd).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Số hợp đồng '{so_hd}' đã tồn tại.")

                elif table_name == "trang_thai_ho_so_giay":
                    status_name = item.get("name") or item.get("tenTrangThai")
                    if status_name and str(status_name).strip():
                        cursor.execute(
                            "SELECT 1 FROM trang_thai_ho_so_giay WHERE owner_id = ? AND name = ? AND id != ?",
                            (org_name, str(status_name).strip(), c_id)
                        )
                        if cursor.fetchone():
                            item_errors.append(f"Trạng thái hồ sơ giấy '{status_name}' đã tồn tại.")

                if item_errors:
                    display_name = item.get("tenChuDauTu") or item.get("tenKeHoach") or item.get("tenGoiThau") or item.get("tenNhaThau") or item.get("hoTen") or item.get("tenHopDong") or item.get("id")
                    for err in item_errors:
                        validation_errors.append({
                            "table": table_name,
                            "id": item.get("id"),
                            "message": f"[{display_name}]: {err}"
                        })

        if validation_errors:
            log_error(f"Validation errors during sync: {validation_errors}", "SyncAPI")
            print("Sync Validation Errors:", validation_errors)
            conn.rollback()
            conn.close()
            return JSONResponse({
                "status": "error",
                "message": "Không thể lưu dữ liệu do phát hiện lỗi:",
                "errors": validation_errors
            }, status_code=400)

        for status_name in paper_statuses_to_seed:
            cursor.execute(
                "SELECT 1 FROM trang_thai_ho_so_giay WHERE owner_id = ? AND name = ?",
                (org_name, status_name)
            )
            if not cursor.fetchone():
                cursor.execute("""
                    INSERT INTO trang_thai_ho_so_giay
                        (id, owner_id, owner_type, name, color, sync_version, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    generate_record_id("trang_thai_ho_so_giay"),
                    org_name,
                    owner_type,
                    status_name,
                    DEFAULT_PAPER_STATUS_COLOR,
                    batch_sync_version,
                    current_time
                ))

        for payload_key, table_name, items in iter_sync_table_payloads(data):
            table_spec = SCHEMA_DINH_NGHIA[table_name]
            columns = list(table_spec["columns"].keys())


            if table_name in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "goi_thau", "chuyen_gia", "hop_dong"] and items:
                updated_versioned_tables.add(table_name)


            for item in items:
                item = canonicalize_payload_item(table_name, item)
                try:
                    db_row_data = {}
                    for col in columns:
                        if col == "owner_id":
                            db_row_data[col] = org_name
                            continue
                        elif col == "owner_type":
                            db_row_data[col] = owner_type
                            continue
                        elif col == "updated_at":
                            db_row_data[col] = current_time
                            continue
                        elif col == "sync_version":
                            db_row_data[col] = batch_sync_version
                            continue
                        else:

                            json_key = json_key_for_column(table_name, col)


                            if json_key in item:
                                val = get_payload_value(table_name, item, col)


                                if col == "id" or col.endswith("_id") or col == "id_goc":
                                    val = get_clean_id(table_name, val)


                                _explicit_json = set(SCHEMA_DINH_NGHIA.get(table_name, {}).get("json_fields", []))
                                if isinstance(val, (list, dict)):
                                    val = json.dumps(val)
                                elif col in _explicit_json or col.endswith("_list") or col.startswith("cv_"):
                                    if val is None:
                                        val = "[]"
                                    elif not isinstance(val, str):
                                        val = json.dumps(val)


                                if isinstance(val, str) and not (col in _explicit_json or col.endswith("_list") or col.startswith("cv_") or col == "goi_thau_ids" or val.startswith("[") or val.startswith("{")):
                                    val = val.strip()

                                if (
                                    (table_name == "chu_dau_tu" and col == "dai_dien_cdt")
                                    or (table_name == "nha_thau" and col == "nguoi_dai_dien")
                                ):
                                    val = normalize_person_name(val)

                                if is_datetime_column(col):
                                    val = normalize_datetime_value(val)


                                col_type_upper = table_spec["columns"][col].upper()
                                if "REAL" in col_type_upper:
                                    val = safe_float(val)
                                elif "INTEGER" in col_type_upper:
                                    if val is not None:
                                        val = safe_int(val)


                                if val is None and "DEFAULT" in col_type_upper:
                                    default_match = re.search(r"DEFAULT\s+'([^']+)'", col_type_upper)
                                    if default_match:
                                        val = default_match.group(1)


                                if table_name == "chuyen_gia" and col in ["anh_chung_chi", "anh_chu_ky"] and val:
                                    ext_suffix = "cert" if col == "anh_chung_chi" else "sig"
                                    expert_id = clean_id(item.get('id'))
                                    val = save_base64_image(val, "chuyen_gia", f"{expert_id}_{ext_suffix}")


                                if val is None and "NOT NULL" in col_type_upper:
                                    continue



                                if col == 'trang_thai' and val is not None:
                                    if str(val).strip() == 'Huỷ thầu':
                                        val = 'Hủy thầu'

                                db_row_data[col] = val



                    if not db_row_data.get("id"):
                        db_row_data["id"] = generate_record_id(table_name)
                    if not item.get("id"):
                        item["id"] = db_row_data["id"]

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
                    save_child_payloads(
                        cursor,
                        table_name,
                        item,
                        org_name,
                        owner_type,
                        batch_sync_version,
                        current_time,
                    )


                    item_id = get_clean_id(table_name, item.get('id'))


                    if table_name == "hop_dong":
                        c_hd_id = get_clean_id("hop_dong", item.get('id'))
                        cursor.execute("""
                            DELETE FROM hop_dong_goi_thau
                            WHERE owner_id = ? AND hop_dong_id = ?
                        """, (org_name, c_hd_id))
                        for gt_id_str in item.get('goiThauIds', []):
                            if gt_id_str:
                                gt_id = clean_id(gt_id_str)
                                if gt_id is not None:
                                    cursor.execute("SELECT 1 FROM goi_thau WHERE owner_id = ? AND id = ? LIMIT 1", (org_name, gt_id))
                                    if not cursor.fetchone():
                                        raise ValueError(f"Goi thau {gt_id} khong thuoc owner hien tai.")
                                    cursor.execute(
                                        "INSERT OR REPLACE INTO hop_dong_goi_thau (owner_id, owner_type, hop_dong_id, goi_thau_id) VALUES (?, ?, ?, ?)",
                                        (org_name, owner_type, c_hd_id, gt_id)
                                    )


                    if table_name == "goi_thau":
                        c_gt_id = get_clean_id("goi_thau", item.get('id'))


                        if 'toChuyenGia' in item:
                            cursor.execute("DELETE FROM goi_thau_chuyen_gia WHERE owner_id = ? AND goi_thau_id = ? AND loai = 'chuyen_gia'", (org_name, c_gt_id))
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
                                            cursor.execute("SELECT 1 FROM chuyen_gia WHERE owner_id = ? AND id = ? LIMIT 1", (org_name, clean_cg_id))
                                            if not cursor.fetchone():
                                                raise ValueError(f"Chuyen gia {clean_cg_id} khong thuoc owner hien tai.")
                                            chuc_vu = cg_item.get('chucVu') or 'Tổ viên'
                                            cong_viec = cg_item.get('congViec') or ''
                                            cursor.execute("""
                                                INSERT OR REPLACE INTO goi_thau_chuyen_gia (owner_id, owner_type, goi_thau_id, chuyen_gia_id, loai, chuc_vu, cong_viec)
                                                VALUES (?, ?, ?, ?, 'chuyen_gia', ?, ?)
                                            """, (org_name, owner_type, c_gt_id, clean_cg_id, chuc_vu, cong_viec))


                        if 'toThamDinh' in item:
                            cursor.execute("DELETE FROM goi_thau_chuyen_gia WHERE owner_id = ? AND goi_thau_id = ? AND loai = 'tham_dinh'", (org_name, c_gt_id))
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
                                            cursor.execute("SELECT 1 FROM chuyen_gia WHERE owner_id = ? AND id = ? LIMIT 1", (org_name, clean_td_id))
                                            if not cursor.fetchone():
                                                raise ValueError(f"Chuyen gia {clean_td_id} khong thuoc owner hien tai.")
                                            chuc_vu = td_item.get('chucVu') or 'Tổ viên'
                                            cong_viec = td_item.get('congViec') or ''
                                            cursor.execute("""
                                                INSERT OR REPLACE INTO goi_thau_chuyen_gia (owner_id, owner_type, goi_thau_id, chuyen_gia_id, loai, chuc_vu, cong_viec)
                                                VALUES (?, ?, ?, ?, 'tham_dinh', ?, ?)
                                            """, (org_name, owner_type, c_gt_id, clean_td_id, chuc_vu, cong_viec))
                except Exception as item_err:
                    err_str = str(item_err)
                    item_id = get_clean_id(table_name, item.get('id'))

                    if "FOREIGN KEY constraint failed" in err_str and item_id and table_name in ALLOWED_ORPHAN_TABLES:
                        try:
                            cursor.execute(
                                DELETED_RECORD_UPSERT_SQL,
                                (table_name, item_id, org_name, current_time, batch_sync_version)
                            )
                            orphaned_ids.append({"table": table_name, "id": item_id})
                        except Exception:
                            pass
                    else:
                        log_sync_error(f"Lỗi đồng bộ bản ghi trong bảng {table_name} (ID: {item.get('id')}): {item_err}\n{traceback.format_exc()}")
                        sync_item_errors.append({
                            "table": table_name,
                            "id": item.get("id"),
                            "message": str(item_err)
                        })


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
                            cursor.execute(f"SELECT 1 FROM {table_name} WHERE owner_id = ? AND id = ? LIMIT 1", (org_name, c_id))
                            if not cursor.fetchone():
                                continue
                            access_decision = authorize_record_write(
                                cursor,
                                role_str,
                                user_id,
                                org_name,
                                tbl_key,
                                table_name,
                                {"id": c_id},
                            )
                            if not access_decision.allowed:
                                sync_item_errors.append({
                                    "table": table_name,
                                    "id": c_id,
                                    "message": access_decision.message
                                })
                                continue
                            cursor.execute(f"DELETE FROM {table_name} WHERE owner_id = ? AND id = ?", (org_name, c_id))

                            cursor.execute(
                                DELETED_RECORD_UPSERT_SQL,
                                (table_name, c_id, org_name, current_time, batch_sync_version)
                            )


                            if table_name in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "goi_thau", "chuyen_gia", "hop_dong"]:
                                updated_versioned_tables.add(table_name)


        for tbl in updated_versioned_tables:
            recalculate_is_latest(cursor, tbl, owner_id=org_name)


        if "ke_hoach_lcnt" in updated_versioned_tables or "goi_thau" in updated_versioned_tables:
            recalculate_tong_muc_dau_tu(cursor, owner_id=org_name)

        if sync_item_errors:
            return rollback_sync_response(
                conn,
                sync_item_errors,
                "Không thể đồng bộ vì có bản ghi không hợp lệ.",
            )

        current_sync_version = get_current_sync_version(cursor, org_name)
        response_data = {"status": "success", "timestamp": current_time, "syncVersion": current_sync_version}
        if orphaned_ids:
            response_data["orphanedIds"] = orphaned_ids
        if client_mutation_id:
            cursor.execute(
                "INSERT OR REPLACE INTO sync_mutations (owner_id, client_mutation_id, response_json) VALUES (?, ?, ?)",
                (org_name, client_mutation_id, json.dumps(response_data))
            )
        conn.commit()


        broadcast_websocket_event(org_name, {"event": "db_changed"})
        return JSONResponse(response_data)
    except OrgPermissionError as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
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
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        read_window = parse_sync_read_window(request.query_params)
        since = read_window.since
        after_version = read_window.after_version
        is_full_initial_fetch = read_window.is_full_initial_fetch

        conn = database.get_connection()
        cursor = conn.cursor()
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')


        org_name = get_active_org(request, role_or_err.user_id)
        role_str = str(role_or_err)
        user_id = role_or_err.user_id



        heavy_tables = ["chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "chuyen_gia", "hop_dong"]
        paginated_payload_keys = [key for key, table in TABLE_KEYS.items() if table in heavy_tables]


        use_server_pagination = True


        def query_table(tbl):
            is_full_fetch = is_full_initial_fetch
            if use_server_pagination and tbl in heavy_tables and is_full_fetch:

                return []
            if after_version is not None:
                cursor.execute(f"SELECT * FROM {tbl} WHERE owner_id = ? AND sync_version > ?", (org_name, after_version))
            elif not is_full_fetch:
                cursor.execute(f"SELECT * FROM {tbl} WHERE owner_id = ? AND updated_at > ?", (org_name, since))
            else:
                cursor.execute(f"SELECT * FROM {tbl} WHERE owner_id = ?", (org_name,))
            return cursor.fetchall()


        chudautu = []
        for row in query_table("chu_dau_tu"):
            chudautu.append(map_db_to_json("chu_dau_tu", dict(row)))


        kehoach = []
        for row in query_table("ke_hoach_lcnt"):
            item = map_db_to_json("ke_hoach_lcnt", dict(row))
            for list_key in ["cvDaThucHienList", "cvKhongApDungList", "cvChuaDuDieuKienList"]:
                if item.get(list_key) is None:
                    item[list_key] = []
            kehoach.append(item)
        attach_child_rows_to_items(cursor, "ke_hoach_lcnt", kehoach, owner_id=org_name)


        chuyengia = []
        for row in query_table("chuyen_gia"):
            row_dict = dict(row)

            img_path = row_dict.get("anh_chung_chi", "")
            sig_path = row_dict.get("anh_chu_ky", "")
            item = map_db_to_json("chuyen_gia", row_dict)
            item["anhChungChi"] = "/" + img_path if img_path and img_path.startswith("uploads") else img_path
            item["anhChuKy"] = "/" + sig_path if sig_path and sig_path.startswith("uploads") else sig_path
            chuyengia.append(item)


        nhathau = []
        for row in query_table("nha_thau"):
            nhathau.append(map_db_to_json("nha_thau", dict(row)))
        attach_child_rows_to_items(cursor, "nha_thau", nhathau, owner_id=org_name)


        goithau = []
        goithau_rows = query_table("goi_thau")
        gt_ids = [row["id"] for row in goithau_rows]
        relations_map = _get_expert_relations_for_packages(cursor, gt_ids, org_name)

        for row in goithau_rows:
            row_dict = dict(row)
            item = map_db_to_json("goi_thau", row_dict)
            gt_id = row_dict["id"]


            pkg_rels = relations_map.get(gt_id, {"to_cg": [], "to_td": [], "cg_ids": []})
            item["toChuyenGia"] = pkg_rels.get("to_cg", [])
            item["toThamDinh"] = pkg_rels.get("to_td", [])
            item["chuyenGiaIds"] = pkg_rels.get("cg_ids", [])

            for list_key in ["phanLoList", "tuyChonMuaThemList", "awardedPhanLoList", "giaHanList", "yeuCauLamRoList", "traLoiLamRoList"]:
                if item.get(list_key) is None:
                    item[list_key] = []
            goithau.append(item)
        attach_child_rows_to_items(cursor, "goi_thau", goithau, owner_id=org_name)


        hopdong = []
        hopdong_rows = query_table("hop_dong")
        hd_ids = [row["id"] for row in hopdong_rows]
        contract_packages_map = _get_contract_package_ids(cursor, hd_ids, org_name)
        for row in hopdong_rows:
            row_dict = dict(row)
            item = map_db_to_json("hop_dong", row_dict)
            item["goiThauIds"] = contract_packages_map.get(row_dict["id"], [])
            hopdong.append(item)


        assignments = []
        if after_version is not None:
            cursor.execute("SELECT * FROM phan_cong_nhan_su WHERE owner_id = ? AND sync_version > ?", (org_name, after_version))
        elif since != '1970-01-01 00:00:00' and since != '0':
            cursor.execute("SELECT * FROM phan_cong_nhan_su WHERE owner_id = ? AND updated_at > ?", (org_name, since))
        else:
            cursor.execute("SELECT * FROM phan_cong_nhan_su WHERE owner_id = ?", (org_name,))
        for row in cursor.fetchall():
            assignments.append(map_db_to_json("phan_cong_nhan_su", dict(row)))


        custompaperstatuses = []
        if after_version is not None:
            cursor.execute("SELECT * FROM trang_thai_ho_so_giay WHERE owner_id = ? AND sync_version > ?", (org_name, after_version))
        elif since != '1970-01-01 00:00:00' and since != '0':
            cursor.execute("SELECT * FROM trang_thai_ho_so_giay WHERE owner_id = ? AND updated_at > ?", (org_name, since))
        else:
            cursor.execute("SELECT * FROM trang_thai_ho_so_giay WHERE owner_id = ?", (org_name,))
        for row in cursor.fetchall():
            custompaperstatuses.append(map_db_to_json("trang_thai_ho_so_giay", dict(row)))


        thongtinmothau = []
        for row in query_table("thong_tin_mo_thau"):
            thongtinmothau.append(map_db_to_json("thong_tin_mo_thau", dict(row)))
        attach_child_rows_to_items(cursor, "thong_tin_mo_thau", thongtinmothau, owner_id=org_name)


        permissionmatrix = []
        try:
            if after_version is not None:
                cursor.execute("SELECT * FROM ma_tran_phan_quyen WHERE owner_id = ? AND sync_version > ?", (org_name, after_version))
            elif since != '1970-01-01 00:00:00' and since != '0':
                cursor.execute("SELECT * FROM ma_tran_phan_quyen WHERE owner_id = ? AND updated_at > ?", (org_name, since))
            else:
                cursor.execute("SELECT * FROM ma_tran_phan_quyen WHERE owner_id = ?", (org_name,))
            for row in cursor.fetchall():
                permissionmatrix.append(map_db_to_json("ma_tran_phan_quyen", dict(row)))
        except Exception:
            pass


        deletions = []
        if after_version is not None:
            cursor.execute(
                "SELECT table_name, record_id FROM deleted_records "
                "WHERE owner_id = ? AND delete_version > ? "
                "ORDER BY delete_version ASC, deleted_at ASC",
                (org_name, after_version)
            )
            TABLE_KEYS_INV = {v: k for k, v in TABLE_KEYS.items()}
            for row in cursor.fetchall():
                tbl_key = TABLE_KEYS_INV.get(row[0])
                if tbl_key:
                    deletions.append({"table": tbl_key, "id": row[1]})
        elif since != '1970-01-01 00:00:00' and since != '0':

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

        chudautu = filter_items_for_read(cursor, role_str, user_id, org_name, "chudautu", "chu_dau_tu", chudautu)
        kehoach = filter_items_for_read(cursor, role_str, user_id, org_name, "kehoach", "ke_hoach_lcnt", kehoach)
        chuyengia = filter_items_for_read(cursor, role_str, user_id, org_name, "chuyengia", "chuyen_gia", chuyengia)
        nhathau = filter_items_for_read(cursor, role_str, user_id, org_name, "nhathau", "nha_thau", nhathau)
        goithau = filter_items_for_read(cursor, role_str, user_id, org_name, "goithau", "goi_thau", goithau)
        hopdong = filter_items_for_read(cursor, role_str, user_id, org_name, "hopdong", "hop_dong", hopdong)
        assignments = filter_items_for_read(cursor, role_str, user_id, org_name, "assignments", "phan_cong_nhan_su", assignments)
        custompaperstatuses = filter_items_for_read(cursor, role_str, user_id, org_name, "custompaperstatuses", "trang_thai_ho_so_giay", custompaperstatuses)
        thongtinmothau = filter_items_for_read(cursor, role_str, user_id, org_name, "thongtinmothau", "thong_tin_mo_thau", thongtinmothau)
        permissionmatrix = filter_items_for_read(cursor, role_str, user_id, org_name, "permissionmatrix", "ma_tran_phan_quyen", permissionmatrix)

        if not is_manager_role(role_str):
            deletions = [
                item for item in deletions
                if can_read_table(cursor, role_str, user_id, org_name, item.get("table"), TABLE_KEYS.get(item.get("table"), ""))
            ]

        current_sync_version = get_current_sync_version(cursor, org_name)


        dashboard_summary = build_dashboard_summary(cursor, org_name, role_str, user_id)
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
            "permissionmatrix": permissionmatrix,
            "deletions": deletions,
            "useServerSidePagination": use_server_pagination,
            "paginatedKeys": paginated_payload_keys if use_server_pagination else [],
            "dashboardSummary": dashboard_summary,
            "timestamp": current_time,
            "syncVersion": current_sync_version
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
        return JSONResponse({"error": "Đã xảy ra lỗi hệ thống khi lấy dữ liệu."}, status_code=500)
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

async def record_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        params = request.query_params
        table_key = params.get("table")
        lookup_value = (params.get("id") or params.get("lookup") or "").strip()
        if table_key not in TABLE_KEYS or not lookup_value:
            return JSONResponse({"error": "Invalid record lookup"}, status_code=400)

        table_name = TABLE_KEYS[table_key]
        if table_name not in {"goi_thau", "ke_hoach_lcnt", "hop_dong", "chu_dau_tu", "nha_thau"}:
            return JSONResponse({"error": "Record lookup is not supported for this table"}, status_code=400)
        _assert_safe_table(table_name)

        org_name = get_active_org(request, role_or_err.user_id)
        role_str = str(role_or_err)
        user_id = role_or_err.user_id
        conn = database.get_connection()
        cursor = conn.cursor()

        if not can_read_table(cursor, role_str, user_id, org_name, table_key, table_name):
            return JSONResponse({"error": "Không có quyền đọc dữ liệu này."}, status_code=403)

        lookup_column = {
            "goi_thau": "ma_goi_thau",
            "ke_hoach_lcnt": "ma_ke_hoach",
            "hop_dong": "so_hop_dong",
            "chu_dau_tu": "ma_chu_dau_tu",
            "nha_thau": "ma_nha_thau",
        }[table_name]
        lookup_candidates = [lookup_value]
        if "_" in lookup_value:
            lookup_candidates.append(lookup_value.rsplit("_", 1)[0])
        if table_name == "hop_dong":
            lookup_candidates.extend(value.replace("-", "/") for value in list(lookup_candidates))
        lookup_candidates = list(dict.fromkeys(value for value in lookup_candidates if value))
        placeholders = ", ".join(["?"] * len(lookup_candidates))
        cursor.execute(f"""
            SELECT *
            FROM {table_name}
            WHERE owner_id = ?
              AND (
                  id IN ({placeholders})
                  OR {lookup_column} IN ({placeholders})
              )
            ORDER BY is_latest DESC,
                     CAST(COALESCE(phien_ban, 0) AS INTEGER) DESC,
                     COALESCE(updated_at, created_at, '') DESC
            LIMIT 1
        """, tuple([org_name] + lookup_candidates + lookup_candidates))
        row = cursor.fetchone()
        if not row:
            return JSONResponse({"item": None}, status_code=404)

        row_dict = dict(row)
        if not can_read_record(cursor, role_str, user_id, org_name, table_key, table_name, row_dict):
            return JSONResponse({"error": "Không có quyền đọc bản ghi này."}, status_code=403)

        item = map_db_to_json(table_name, row_dict)
        items = [item]
        if table_name in {"ke_hoach_lcnt", "goi_thau", "nha_thau"}:
            attach_child_rows_to_items(cursor, table_name, items, owner_id=org_name)
        if table_name == "goi_thau":
            relations_map = _get_expert_relations_for_packages(cursor, [row_dict["id"]], org_name)
            pkg_rels = relations_map.get(row_dict["id"], {"to_cg": [], "to_td": [], "cg_ids": []})
            item["toChuyenGia"] = pkg_rels.get("to_cg", [])
            item["toThamDinh"] = pkg_rels.get("to_td", [])
            item["chuyenGiaIds"] = pkg_rels.get("cg_ids", [])
            for list_key in ["phanLoList", "tuyChonMuaThemList", "awardedPhanLoList", "giaHanList", "yeuCauLamRoList", "traLoiLamRoList"]:
                if item.get(list_key) is None:
                    item[list_key] = []
        elif table_name == "hop_dong":
            item["goiThauIds"] = _get_contract_package_ids(cursor, [row_dict["id"]], org_name).get(row_dict["id"], [])

        return JSONResponse({"item": item})
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception:
        traceback.print_exc()
        return JSONResponse({"error": "Da xay ra loi he thong khi lay ban ghi."}, status_code=500)
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

async def paginate_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        params = request.query_params
        table_key = params.get("table")

        if table_key not in TABLE_KEYS:
            return JSONResponse({"error": "Invalid table key"}, status_code=400)
        table_name = TABLE_KEYS[table_key]
        _assert_safe_table(table_name)

        page_size_raw = params.get("pageSize", "10")
        try:
            page = max(1, int(params.get("page", 1)))
            page_size = max(1, min(200, int(page_size_raw)))
        except (ValueError, TypeError):
            return JSONResponse({"error": "Tham số phân trang không hợp lệ"}, status_code=400)
        search = params.get("search", "").strip().lower()

        org_name = get_active_org(request, role_or_err.user_id)
        role_str = str(role_or_err)
        user_id = role_or_err.user_id
        conn = database.get_connection()
        cursor = conn.cursor()
        if not can_read_table(cursor, role_str, user_id, org_name, table_key, table_name):
            conn.close()
            return JSONResponse({"items": [], "totalItems": 0})


        query_parts = ["owner_id = ?"]
        query_params = [org_name]
        if not is_manager_role(role_str):
            if table_name == "phan_cong_nhan_su":
                query_parts.append("id_nhan_vien = ?")
                query_params.append(user_id)
            elif table_name == "ma_tran_phan_quyen":
                query_parts.append("emp_id = ?")
                query_params.append(user_id)
            elif table_name == "ke_hoach_lcnt":
                query_parts.append("""
                    (
                        id IN (
                            SELECT id_muc_tieu FROM phan_cong_nhan_su
                            WHERE owner_id = ? AND id_nhan_vien = ? AND loai_doi_tuong = 'kehoach'
                        )
                        OR id IN (
                            SELECT gt.ke_hoach_id FROM goi_thau gt
                            JOIN phan_cong_nhan_su pc
                              ON pc.owner_id = gt.owner_id
                             AND pc.id_muc_tieu = gt.id
                             AND pc.loai_doi_tuong = 'goithau'
                            WHERE gt.owner_id = ? AND pc.id_nhan_vien = ?
                        )
                    )
                """)
                query_params.extend([org_name, user_id, org_name, user_id])
            elif table_name in ["goi_thau", "hop_dong"]:
                assignment_type = {
                    "goi_thau": "goithau",
                    "hop_dong": "hopdong",
                }[table_name]
                query_parts.append("""
                    id IN (
                        SELECT id_muc_tieu FROM phan_cong_nhan_su
                        WHERE owner_id = ? AND id_nhan_vien = ? AND loai_doi_tuong = ?
                    )
                """)
                query_params.extend([org_name, user_id, assignment_type])
            elif table_name == "thong_tin_mo_thau":
                query_parts.append("""
                    goi_thau_id IN (
                        SELECT id_muc_tieu FROM phan_cong_nhan_su
                        WHERE owner_id = ? AND id_nhan_vien = ? AND loai_doi_tuong = 'goithau'
                    )
                """)
                query_params.extend([org_name, user_id])




        versioned_tables = ["chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "hop_dong", "chuyen_gia"]
        plan_snapshot_id = params.get("keHoachId", "").strip() if table_name == "goi_thau" else ""
        if table_name == "goi_thau" and plan_snapshot_id:
            query_parts.append("ke_hoach_id = ?")
            query_params.append(plan_snapshot_id)
        elif table_name in versioned_tables:
            query_parts.append("is_latest = 1")

        def add_like_search_filter():
            search_like = f"%{search}%"
            if table_name == "ke_hoach_lcnt":
                query_parts.append("(ma_ke_hoach LIKE ? OR ten_ke_hoach LIKE ? OR ten_du_an_du_toan LIKE ?)")
                query_params.extend([search_like, search_like, search_like])
            elif table_name == "goi_thau":
                query_parts.append("(ma_goi_thau LIKE ? OR ten_goi_thau LIKE ?)")
                query_params.extend([search_like, search_like])
            elif table_name == "chu_dau_tu":
                query_parts.append("(ma_chu_dau_tu LIKE ? OR ten_chu_dau_tu LIKE ? OR ten_viet_tat LIKE ? OR ma_so_thue LIKE ?)")
                query_params.extend([search_like, search_like, search_like, search_like])
            elif table_name == "nha_thau":
                query_parts.append("(ma_nha_thau LIKE ? OR ten_nha_thau LIKE ? OR ten_viet_tat LIKE ? OR ma_so_thue LIKE ?)")
                query_params.extend([search_like, search_like, search_like, search_like])
            elif table_name == "chuyen_gia":
                query_parts.append("(ho_ten LIKE ? OR so_cccd LIKE ? OR so_chung_chi LIKE ?)")
                query_params.extend([search_like, search_like, search_like])
            elif table_name == "hop_dong":
                query_parts.append("(so_hop_dong LIKE ? OR ten_hop_dong LIKE ?)")
                query_params.extend([search_like, search_like])


        if search:
            fts_query = build_fts_match_query(search)
            if table_name in FTS_SEARCH_TABLES and fts_query:
                fts_table = f"fts_{table_name}"
                cursor.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (fts_table,))
                if cursor.fetchone():
                    query_parts.append(f"id IN (SELECT id FROM {fts_table} WHERE {fts_table} MATCH ? AND owner_id = ?)")
                    query_params.extend([fts_query, org_name])
                else:
                    add_like_search_filter()
            else:
                add_like_search_filter()


        if table_name == "goi_thau":
            trang_thai = params.get("trangThai", "")
            hinh_thuc = params.get("hinhThuc", "")
            if trang_thai:
                query_parts.append("trang_thai = ?")
                query_params.append(trang_thai)
            if hinh_thuc:
                query_parts.append("hinh_thuc_lua_chon = ?")
                query_params.append(hinh_thuc)


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
            try:
                year_num = int(nam) if nam else None
                month_num = int(thang) if thang else None
            except ValueError:
                year_num = None
                month_num = None
            if year_num and month_num and 1 <= month_num <= 12:
                next_year = year_num + 1 if month_num == 12 else year_num
                next_month = 1 if month_num == 12 else month_num + 1
                query_parts.append(f"{date_column} >= ? AND {date_column} < ?")
                query_params.extend([
                    f"{year_num:04d}-{month_num:02d}-01 00:00:00",
                    f"{next_year:04d}-{next_month:02d}-01 00:00:00",
                ])
            elif year_num:
                query_parts.append(f"{date_column} >= ? AND {date_column} < ?")
                query_params.extend([
                    f"{year_num:04d}-01-01 00:00:00",
                    f"{year_num + 1:04d}-01-01 00:00:00",
                ])
            elif month_num and 1 <= month_num <= 12:
                query_parts.append(f"strftime('%m', {date_column}) = ?")
                query_params.append(f"{month_num:02d}")


        where_clause = " AND ".join(query_parts)
        count_sql = f"SELECT COUNT(*) FROM {table_name} WHERE {where_clause}"
        cursor.execute(count_sql, tuple(query_params))
        total_items = cursor.fetchone()[0]


        sort_by = params.get("sortBy", "").strip()
        sort_order = params.get("sortOrder", "asc").strip().upper()
        if sort_order not in ["ASC", "DESC"]:
            sort_order = "ASC"

        db_column = ""
        if sort_by:
            db_column = db_column_for_json_key(table_name, sort_by)

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


        offset = (page - 1) * page_size
        items_sql = f"SELECT * FROM {table_name} WHERE {where_clause}{sort_sql} LIMIT ? OFFSET ?"
        cursor.execute(items_sql, tuple(query_params + [page_size, offset]))
        rows = cursor.fetchall()


        relations_map = {}
        if table_name == "goi_thau" and rows:
            gt_ids = [r["id"] for r in rows]
            relations_map = _get_expert_relations_for_packages(cursor, gt_ids, org_name)


        contract_packages_map = {}
        if table_name == "hop_dong" and rows:
            hd_ids = [r["id"] for r in rows]
            contract_packages_map = _get_contract_package_ids(cursor, hd_ids, org_name)


        versions_by_root = {}
        if table_name in versioned_tables and rows:
            all_root_vals = list({(r["id_goc"] or r["id"]) for r in rows})
            v_placeholders = ", ".join(["?"] * len(all_root_vals))
            version_query_parts = [
                "owner_id = ?",
                f"""(
                    (id_goc IS NOT NULL AND id_goc != '' AND id_goc IN ({v_placeholders})) OR
                    ((id_goc IS NULL OR id_goc = '') AND id IN ({v_placeholders}))
                )"""
            ]
            version_query_params = [org_name] + all_root_vals + all_root_vals
            if table_name == "goi_thau" and plan_snapshot_id:
                version_query_parts.append("ke_hoach_id = ?")
                version_query_params.append(plan_snapshot_id)

            cursor.execute(f"""
                SELECT id, id_goc, phien_ban FROM {table_name}
                WHERE {" AND ".join(version_query_parts)}
                ORDER BY CAST(phien_ban AS INTEGER) DESC
            """, version_query_params)
            for v_row in cursor.fetchall():
                v_root = v_row[1] or v_row[0]
                if v_root not in versions_by_root:
                    versions_by_root[v_root] = []
                versions_by_root[v_root].append({"id": v_row[0], "phienBan": v_row[2]})

        items = []
        for row in rows:
            row_dict = dict(row)

            if table_name == "chuyen_gia":
                img_path = row_dict.get("anh_chung_chi", "")
                sig_path = row_dict.get("anh_chu_ky", "")
                row_dict["anh_chung_chi"] = "/" + img_path if img_path and img_path.startswith("uploads") else img_path
                row_dict["anh_chu_ky"] = "/" + sig_path if sig_path and sig_path.startswith("uploads") else sig_path

            item = map_db_to_json(table_name, row_dict)


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


            if table_name in versioned_tables:
                root_val = row_dict.get("id_goc") or row_dict.get("id")
                item["allVersions"] = versions_by_root.get(root_val, [])

            items.append(item)
        if table_name in ["ke_hoach_lcnt", "goi_thau", "nha_thau", "thong_tin_mo_thau"]:
            attach_child_rows_to_items(cursor, table_name, items, owner_id=org_name)

        conn.close()
        return JSONResponse({
            "items": items,
            "totalItems": total_items
        })
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"error": "Đã xảy ra lỗi hệ thống khi phân trang."}, status_code=500)
    finally:

        if conn:
            try:
                conn.close()
            except Exception:
                pass
