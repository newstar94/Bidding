from dataclasses import dataclass
from datetime import datetime
import json
import os
import re
import sqlite3
import traceback

from starlette.responses import JSONResponse

from backend.shared.helpers import (
    OrgPermissionError,
    SCHEMA_DINH_NGHIA,
    _assert_safe_table,
    clean_id,
    database,
    get_active_org,
    load_base64_image,
    log_error,
    recalculate_is_latest,
    recalculate_tong_muc_dau_tu,
    safe_float,
    safe_int,
    save_base64_image,
    verify_session,
)
from backend.shared.access_policy import authorize_record_write, is_organization_manager
from backend.shared.client_ip import get_client_ip
from backend.shared.logging_utils import error_response, get_request_id
from backend.auth.auth_helper import (
    PRIVILEGED_REAUTH_REQUIRED,
    PRIVILEGED_REAUTH_TTL_SECONDS,
)
from backend.shared.date_utils import is_datetime_column, normalize_datetime_value
from backend.db.id_utils import generate_record_id
from backend.shared.media_helper import (
    normalize_managed_image_path,
    remove_unreferenced_image_files,
)
from backend.sync.mapper import (
    canonicalize_payload_item,
    db_column_for_json_key,
    get_payload_value,
    json_key_for_column,
    save_child_payloads,
)
from backend.shared.text_utils import normalize_person_name
from backend.sync.queries import (
    ALLOWED_ORPHAN_TABLES,
    OWNER_TYPES,
    SYNCED_TABLES,
    TABLE_KEYS,
    build_dashboard_summary,
)
from backend.sync.ownership import get_owner_type, validate_owner_scoped_references
from backend.sync.delete_policy import (
    ALWAYS_ARCHIVE_TABLES,
    ARCHIVABLE_TABLES,
    HIGH_IMPACT_DELETE_TABLES,
    archive_versioned_record,
    build_delete_impact,
    delete_assignment_dependents,
    find_blocking_delete_references,
    has_recent_password_reauthentication,
    insert_delete_audit,
)
from backend.sync.repository import (
    DELETED_RECORD_UPSERT_SQL,
    VERSIONED_TABLES,
    defer_version_latest_flag,
    get_current_sync_version,
    next_sync_version,
)
from backend.sync.serializer import iter_sync_table_payloads, rollback_sync_response
from backend.sync.validator import DEFAULT_PAPER_STATUS_COLOR, validate_sync_item


def _sync_batch_limit():
    try:
        value = int(os.environ.get("SYNC_MAX_BATCH_ITEMS", "2000"))
    except (TypeError, ValueError):
        value = 2000
    return min(10_000, max(100, value))


def _sync_batch_size(payload):
    if not isinstance(payload, dict):
        return 0
    keys = set(TABLE_KEYS)
    keys.add("deletions")
    return sum(
        len(payload.get(key) or [])
        for key in keys
        if isinstance(payload.get(key), list)
    )


@dataclass(frozen=True)
class SyncReadWindow:
    since: str
    after_version: int | None
    is_full_initial_fetch: bool


def parse_sync_read_window(query_params) -> SyncReadWindow:
    since_val = query_params.get("since", "0")
    if since_val.isdigit() and int(since_val) < 10000000000:
        val = int(since_val)
        if val == 0:
            since = "1970-01-01 00:00:00"
        else:
            try:
                since = datetime.fromtimestamp(val).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                since = "1970-01-01 00:00:00"
    else:
        since = since_val

    after_version_raw = query_params.get("after_version")
    try:
        after_version = int(after_version_raw) if after_version_raw not in (None, "") else None
    except (TypeError, ValueError):
        after_version = None

    is_full_initial_fetch = after_version is None and (since == "1970-01-01 00:00:00" or since == "0")
    return SyncReadWindow(
        since=since,
        after_version=after_version,
        is_full_initial_fetch=is_full_initial_fetch,
    )

async def process_sync_request(request, broadcast_callback=None):
    """
    [POST] /api/sync
    Đồng bộ dữ liệu thay đổi từ ứng dụng Frontend vào cơ sở dữ liệu SQLite.
    """
    def log_sync_error(msg):
        log_error(msg, "SyncAPI", request_id=get_request_id(request))

    conn = None
    transaction_committed = False
    newly_written_images = set()
    image_cleanup_candidates = set()
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            log_sync_error(f"Xác thực thất bại khi đồng bộ: {role_or_err}")
            return JSONResponse({"error": role_or_err}, status_code=403)

        data = await request.json()
        if not isinstance(data, dict):
            return error_response(
                request,
                "SYNC_PAYLOAD_INVALID",
                "Dữ liệu đồng bộ phải là một JSON object.",
                status_code=400,
            )
        batch_size = _sync_batch_size(data)
        batch_limit = _sync_batch_limit()
        if batch_size > batch_limit:
            return error_response(
                request,
                "SYNC_BATCH_TOO_LARGE",
                "Số lượng bản ghi đồng bộ vượt quá giới hạn cho phép.",
                status_code=413,
                fields={"maxItems": batch_limit, "receivedItems": batch_size},
            )
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
                "SELECT response_json FROM sync_mutations WHERE organization_id = ? AND client_mutation_id = ?",
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
                log_sync_error(f"organization_id không hợp lệ: {org_name}")
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
        delete_impacts = []

        sync_item_errors = []


        validation_errors = []
        skipped_invalid_records = set()
        incoming_ids_by_table = {}
        for _payload_key, _table_name, _items in iter_sync_table_payloads(data):
            incoming_ids_by_table.setdefault(_table_name, set()).update(
                str(get_clean_id(_table_name, _item.get("id")))
                for _item in _items
                if isinstance(_item, dict) and get_clean_id(_table_name, _item.get("id"))
            )
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
                if c_id and table_name in ARCHIVABLE_TABLES:
                    archived_row = cursor.execute(
                        f"SELECT archived_at FROM {table_name} WHERE organization_id = ? AND id = ?",
                        (org_name, c_id),
                    ).fetchone()
                    if archived_row and archived_row[0]:
                        item_errors.append("Bản ghi đã được lưu trữ và không thể chỉnh sửa.")
                item, pure_errors, requested_paper_statuses = validate_sync_item(
                    table_name,
                    item,
                    incoming_paper_status_names
                )
                item_errors.extend(pure_errors)
                reference_errors = validate_owner_scoped_references(
                    cursor,
                    org_name,
                    table_name,
                    item,
                    incoming_ids_by_table,
                )
                if table_name == "phan_cong_nhan_su" and reference_errors:
                    skipped_invalid_records.add((table_name, str(c_id)))
                    orphaned_ids.append({"table": table_name, "id": c_id})
                    continue
                item_errors.extend(reference_errors)
                for status_name in requested_paper_statuses:
                    cursor.execute(
                        "SELECT 1 FROM trang_thai_ho_so_giay WHERE organization_id = ? AND name = ?",
                        (org_name, status_name)
                    )
                    if not cursor.fetchone():
                        paper_statuses_to_seed.add(status_name)


                if table_name == "chu_dau_tu":
                    ma = item.get("maChuDauTu")
                    mst = item.get("maSoThue")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT id FROM chu_dau_tu WHERE organization_id = ? AND archived_at IS NULL AND ma_chu_dau_tu = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        conflict = cursor.fetchone()
                        if conflict:
                            item_errors.append({"message": f"Mã chủ đầu tư '{ma}' đã tồn tại.", "conflictingId": conflict[0]})
                    if mst and str(mst).strip():
                        cursor.execute("SELECT id FROM chu_dau_tu WHERE organization_id = ? AND archived_at IS NULL AND ma_so_thue = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(mst).strip(), c_id, c_root_id))
                        conflict = cursor.fetchone()
                        if conflict:
                            item_errors.append({"message": f"Mã số thuế '{mst}' đã tồn tại.", "conflictingId": conflict[0]})

                elif table_name == "ke_hoach_lcnt":
                    ma = item.get("maKeHoach")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM ke_hoach_lcnt WHERE organization_id = ? AND archived_at IS NULL AND ma_ke_hoach = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã kế hoạch '{ma}' đã tồn tại.")

                elif table_name == "goi_thau":
                    ma = item.get("maGoiThau")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM goi_thau WHERE organization_id = ? AND archived_at IS NULL AND ma_goi_thau = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã gói thầu '{ma}' đã tồn tại.")

                elif table_name == "nha_thau":
                    ma = item.get("maNhaThau")
                    mst = item.get("maSoThue")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT id FROM nha_thau WHERE organization_id = ? AND archived_at IS NULL AND ma_nha_thau = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        conflict = cursor.fetchone()
                        if conflict:
                            item_errors.append({"message": f"Mã nhà thầu '{ma}' đã tồn tại.", "conflictingId": conflict[0]})
                    if mst and str(mst).strip():
                        cursor.execute("SELECT id FROM nha_thau WHERE organization_id = ? AND archived_at IS NULL AND ma_so_thue = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(mst).strip(), c_id, c_root_id))
                        conflict = cursor.fetchone()
                        if conflict:
                            item_errors.append({"message": f"Mã số thuế '{mst}' đã tồn tại.", "conflictingId": conflict[0]})

                elif table_name == "chuyen_gia":
                    cccd = item.get("soCCCD")
                    if cccd and str(cccd).strip():
                        cursor.execute("SELECT 1 FROM chuyen_gia WHERE organization_id = ? AND archived_at IS NULL AND so_cccd = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(cccd).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Số CCCD chuyên gia '{cccd}' đã tồn tại.")

                elif table_name == "hop_dong":
                    so_hd = item.get("soHopDong")
                    if so_hd and str(so_hd).strip():
                        cursor.execute("SELECT 1 FROM hop_dong WHERE organization_id = ? AND archived_at IS NULL AND so_hop_dong = ? AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(so_hd).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Số hợp đồng '{so_hd}' đã tồn tại.")

                elif table_name == "trang_thai_ho_so_giay":
                    status_name = item.get("name") or item.get("tenTrangThai")
                    if status_name and str(status_name).strip():
                        cursor.execute(
                            "SELECT 1 FROM trang_thai_ho_so_giay WHERE organization_id = ? AND name = ? AND id != ?",
                            (org_name, str(status_name).strip(), c_id)
                        )
                        if cursor.fetchone():
                            item_errors.append(f"Trạng thái hồ sơ giấy '{status_name}' đã tồn tại.")

                if item_errors:
                    display_name = item.get("tenChuDauTu") or item.get("tenKeHoach") or item.get("tenGoiThau") or item.get("tenNhaThau") or item.get("hoTen") or item.get("tenHopDong") or item.get("id")
                    for err in item_errors:
                        error_detail = err if isinstance(err, dict) else {"message": err}
                        validation_error = {
                            "table": table_name,
                            "id": item.get("id"),
                            "message": f"[{display_name}]: {error_detail.get('message', '')}"
                        }
                        if error_detail.get("conflictingId"):
                            validation_error["conflictingId"] = error_detail["conflictingId"]
                        validation_errors.append(validation_error)

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
                "SELECT 1 FROM trang_thai_ho_so_giay WHERE organization_id = ? AND name = ?",
                (org_name, status_name)
            )
            if not cursor.fetchone():
                cursor.execute("""
                    INSERT INTO trang_thai_ho_so_giay
                        (id, organization_id, owner_type, name, color, sync_version, updated_at)
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


            if table_name in VERSIONED_TABLES and items:
                updated_versioned_tables.add(table_name)


            for item in items:
                item_id_for_skip = get_clean_id(table_name, item.get("id")) if isinstance(item, dict) else None
                if (table_name, str(item_id_for_skip)) in skipped_invalid_records:
                    continue
                item = canonicalize_payload_item(table_name, item)
                try:
                    db_row_data = {}
                    for col in columns:
                        if col == "organization_id":
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


                                is_expert_image = table_name == "chuyen_gia" and col in {
                                    "anh_chung_chi", "anh_chu_ky"
                                }
                                is_contractor_image = table_name == "nha_thau" and col == "anh_dau"
                                previous_image = ""
                                if is_expert_image or is_contractor_image:
                                    record_id = get_clean_id(table_name, item.get("id"))
                                    if record_id:
                                        cursor.execute(
                                            f"SELECT {col} FROM {table_name} "
                                            "WHERE organization_id = ? AND id = ? LIMIT 1",
                                            (org_name, record_id),
                                        )
                                        previous_row = cursor.fetchone()
                                        if previous_row:
                                            previous_image = normalize_managed_image_path(previous_row[0])

                                is_new_image_data = isinstance(val, str) and val.startswith("data:image")
                                if is_expert_image and val:
                                    ext_suffix = "cert" if col == "anh_chung_chi" else "sig"
                                    expert_id = clean_id(item.get('id'))
                                    normalized_image = val[1:] if isinstance(val, str) and val.startswith("/images/") else val
                                    val = save_base64_image(normalized_image, "chuyen_gia", f"{expert_id}_{ext_suffix}")
                                elif is_contractor_image and val:
                                    contractor_id = clean_id(item.get('id'))
                                    normalized_image = val[1:] if isinstance(val, str) and val.startswith("/images/") else val
                                    val = save_base64_image(normalized_image, "nha_thau", f"{contractor_id}_stamp")

                                if is_expert_image or is_contractor_image:
                                    current_image = normalize_managed_image_path(val)
                                    if is_new_image_data and current_image:
                                        newly_written_images.add(current_image)
                                    if previous_image and previous_image != current_image:
                                        # An empty value intentionally removes the image. A failed
                                        # conversion keeps the old file until the write is corrected.
                                        if not val or current_image:
                                            image_cleanup_candidates.add(previous_image)


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

                    defer_version_latest_flag(table_name, db_row_data)

                    if table_name == "phan_cong_nhan_su":





                        cursor.execute("""
                            DELETE FROM phan_cong_nhan_su
                            WHERE id_muc_tieu = ? AND loai_doi_tuong = ? AND id != ?
                        """, (db_row_data.get("id_muc_tieu"), db_row_data.get("loai_doi_tuong"), db_row_data.get("id")))
                    elif table_name == "ma_tran_phan_quyen":
                        cursor.execute("""
                            DELETE FROM ma_tran_phan_quyen
                            WHERE organization_id = ? AND emp_id = ? AND id != ?
                        """, (db_row_data.get("organization_id"), db_row_data.get("emp_id"), db_row_data.get("id")))


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
                            WHERE organization_id = ? AND hop_dong_id = ?
                        """, (org_name, c_hd_id))
                        for gt_id_str in item.get('goiThauIds', []):
                            if gt_id_str:
                                gt_id = clean_id(gt_id_str)
                                if gt_id is not None:
                                    cursor.execute("SELECT 1 FROM goi_thau WHERE organization_id = ? AND id = ? LIMIT 1", (org_name, gt_id))
                                    if not cursor.fetchone():
                                        raise ValueError(f"Goi thau {gt_id} khong thuoc owner hien tai.")
                                    cursor.execute(
                                        "INSERT OR REPLACE INTO hop_dong_goi_thau (organization_id, owner_type, hop_dong_id, goi_thau_id) VALUES (?, ?, ?, ?)",
                                        (org_name, owner_type, c_hd_id, gt_id)
                                    )


                    if table_name == "goi_thau":
                        c_gt_id = get_clean_id("goi_thau", item.get('id'))


                        if 'toChuyenGia' in item:
                            cursor.execute("DELETE FROM goi_thau_chuyen_gia WHERE organization_id = ? AND goi_thau_id = ? AND loai = 'chuyen_gia'", (org_name, c_gt_id))
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
                                            cursor.execute("SELECT 1 FROM chuyen_gia WHERE organization_id = ? AND id = ? LIMIT 1", (org_name, clean_cg_id))
                                            if not cursor.fetchone():
                                                raise ValueError(f"Chuyen gia {clean_cg_id} khong thuoc owner hien tai.")
                                            chuc_vu = cg_item.get('chucVu') or 'Tổ viên'
                                            cong_viec = cg_item.get('congViec') or ''
                                            cursor.execute("""
                                                INSERT OR REPLACE INTO goi_thau_chuyen_gia (organization_id, owner_type, goi_thau_id, chuyen_gia_id, loai, chuc_vu, cong_viec)
                                                VALUES (?, ?, ?, ?, 'chuyen_gia', ?, ?)
                                            """, (org_name, owner_type, c_gt_id, clean_cg_id, chuc_vu, cong_viec))


                        if 'toThamDinh' in item:
                            cursor.execute("DELETE FROM goi_thau_chuyen_gia WHERE organization_id = ? AND goi_thau_id = ? AND loai = 'tham_dinh'", (org_name, c_gt_id))
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
                                            cursor.execute("SELECT 1 FROM chuyen_gia WHERE organization_id = ? AND id = ? LIMIT 1", (org_name, clean_td_id))
                                            if not cursor.fetchone():
                                                raise ValueError(f"Chuyen gia {clean_td_id} khong thuoc owner hien tai.")
                                            chuc_vu = td_item.get('chucVu') or 'Tổ viên'
                                            cong_viec = td_item.get('congViec') or ''
                                            cursor.execute("""
                                                INSERT OR REPLACE INTO goi_thau_chuyen_gia (organization_id, owner_type, goi_thau_id, chuyen_gia_id, loai, chuc_vu, cong_viec)
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
                            image_columns = {
                                "nha_thau": ("anh_dau",),
                                "chuyen_gia": ("anh_chung_chi", "anh_chu_ky"),
                            }.get(table_name, ())
                            cursor.execute(
                                f"SELECT * FROM {table_name} "
                                "WHERE organization_id = ? AND id = ? LIMIT 1",
                                (org_name, c_id),
                            )
                            existing_row = cursor.fetchone()
                            if not existing_row:
                                continue
                            existing_record = dict(existing_row)
                            if table_name in ARCHIVABLE_TABLES and existing_record.get("archived_at"):
                                continue
                            for image_column in image_columns:
                                image_value = existing_record.get(image_column)
                                managed_path = normalize_managed_image_path(image_value)
                                if managed_path:
                                    image_cleanup_candidates.add(managed_path)
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
                            impact = build_delete_impact(
                                cursor,
                                org_name,
                                table_name,
                                c_id,
                            )
                            if table_name in HIGH_IMPACT_DELETE_TABLES:
                                if not is_organization_manager(
                                    cursor,
                                    role_str,
                                    user_id,
                                    org_name,
                                ):
                                    sync_item_errors.append({
                                        "table": table_name,
                                        "id": c_id,
                                        "code": "DELETE_ELEVATED_PERMISSION_REQUIRED",
                                        "message": "Chỉ owner/manager của tổ chức được xóa aggregate nghiệp vụ.",
                                        "impact": impact,
                                    })
                                    continue
                                if not has_recent_password_reauthentication(
                                    cursor,
                                    user_id,
                                    PRIVILEGED_REAUTH_TTL_SECONDS,
                                ):
                                    conn.rollback()
                                    return JSONResponse(
                                        {
                                            "error": PRIVILEGED_REAUTH_REQUIRED,
                                            "code": "PRIVILEGED_REAUTH_REQUIRED",
                                            "deleteImpact": {
                                                "table": tbl_key,
                                                "id": c_id,
                                                **impact,
                                            },
                                        },
                                        status_code=403,
                                    )
                            blocking_references = find_blocking_delete_references(
                                cursor,
                                org_name,
                                table_name,
                                c_id,
                            )
                            delete_action = "deleted"
                            if (
                                blocking_references or table_name in ALWAYS_ARCHIVE_TABLES
                            ) and table_name in ARCHIVABLE_TABLES:
                                delete_assignment_dependents(
                                    cursor,
                                    org_name,
                                    table_name,
                                    c_id,
                                )
                                archive_versioned_record(
                                    cursor,
                                    org_name,
                                    table_name,
                                    c_id,
                                    current_time,
                                    batch_sync_version,
                                )
                                delete_action = "archived"
                            elif blocking_references:
                                relation_summary = ", ".join(
                                    f"{item['label']} ({item['count']})"
                                    for item in blocking_references
                                )
                                sync_item_errors.append({
                                    "table": table_name,
                                    "id": c_id,
                                    "code": "DELETE_REFERENCED",
                                    "message": f"Không thể xóa vì bản ghi đang được tham chiếu bởi: {relation_summary}.",
                                    "references": blocking_references,
                                })
                                continue
                            else:
                                delete_assignment_dependents(
                                    cursor,
                                    org_name,
                                    table_name,
                                    c_id,
                                )
                                try:
                                    cursor.execute(
                                        f"DELETE FROM {table_name} WHERE organization_id = ? AND id = ?",
                                        (org_name, c_id),
                                    )
                                except sqlite3.IntegrityError:
                                    sync_item_errors.append({
                                        "table": table_name,
                                        "id": c_id,
                                        "code": "DELETE_REFERENCED",
                                        "message": "Không thể xóa vì bản ghi đang được tham chiếu.",
                                    })
                                    continue

                            cursor.execute(
                                DELETED_RECORD_UPSERT_SQL,
                                (table_name, c_id, org_name, current_time, batch_sync_version)
                            )

                            impact_result = {
                                "table": tbl_key,
                                "id": c_id,
                                "action": delete_action,
                                **impact,
                            }
                            delete_impacts.append(impact_result)
                            insert_delete_audit(
                                cursor,
                                actor_user_id=user_id,
                                organization_id=org_name,
                                table_name=table_name,
                                record_id=c_id,
                                action=f"sync.record_{delete_action}",
                                impact=impact_result,
                                ip_address=get_client_ip(request),
                            )


                            if table_name in VERSIONED_TABLES:
                                updated_versioned_tables.add(table_name)


        for tbl in updated_versioned_tables:
            recalculate_is_latest(cursor, tbl, organization_id=org_name)


        if "ke_hoach_lcnt" in updated_versioned_tables or "goi_thau" in updated_versioned_tables:
            recalculate_tong_muc_dau_tu(cursor, organization_id=org_name)

        if sync_item_errors:
            return rollback_sync_response(
                conn,
                sync_item_errors,
                "Không thể đồng bộ vì có bản ghi không hợp lệ.",
            )

        current_sync_version = get_current_sync_version(cursor, org_name)
        response_data = {"status": "success", "timestamp": current_time, "syncVersion": current_sync_version}
        if delete_impacts:
            response_data["deleteImpacts"] = delete_impacts
        if data.get("includeDashboardSummary") is True:
            response_data["dashboardSummary"] = build_dashboard_summary(
                cursor, org_name, role_str, user_id
            )
        if orphaned_ids:
            response_data["orphanedIds"] = orphaned_ids
        if client_mutation_id:
            cursor.execute(
                "INSERT OR REPLACE INTO sync_mutations (organization_id, client_mutation_id, response_json) VALUES (?, ?, ?)",
                (org_name, client_mutation_id, json.dumps(response_data))
            )
        conn.commit()
        transaction_committed = True

        try:
            remove_unreferenced_image_files(
                cursor,
                image_cleanup_candidates | newly_written_images,
            )
        except Exception as cleanup_error:
            log_sync_error(f"KhÃ´ng thá»ƒ dá»n áº£nh khÃ´ng cÃ²n tham chiáº¿u: {cleanup_error}")


        if broadcast_callback:
            broadcast_callback(org_name, {"event": "db_changed"})
        if isinstance(data.get("nhathau"), list) and data.get("nhathau"):
            try:
                from backend.partners.partner_lookup_service import request_partner_enrichment
                request_partner_enrichment()
            except Exception as enrichment_error:
                log_sync_error(f"Không thể kích hoạt bổ sung thông tin nhà thầu: {enrichment_error}")
        return JSONResponse(response_data)
    except OrgPermissionError as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
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
        if not transaction_committed and newly_written_images:
            cleanup_conn = None
            try:
                cleanup_conn = database.get_connection()
                remove_unreferenced_image_files(
                    cleanup_conn.cursor(),
                    newly_written_images,
                )
            except Exception as cleanup_error:
                log_sync_error(f"KhÃ´ng thá»ƒ dá»n áº£nh sau khi rollback: {cleanup_error}")
            finally:
                if cleanup_conn:
                    cleanup_conn.close()
