from backend.db.db_helper import DatabaseError, IntegrityError
import json
import re
import time
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
from backend.shared.access_policy import OWNERSHIP_SCOPED_TABLES, authorize_record_write
from backend.shared.client_ip import get_client_ip
from backend.shared.logging_utils import error_response, get_request_id
from backend.observability.metrics import record_database_phase
from backend.auth.auth_helper import (
    PRIVILEGED_REAUTH_REQUIRED,
    PRIVILEGED_REAUTH_TTL_SECONDS,
)
from backend.shared.date_utils import (
    is_datetime_column,
    normalize_date_value,
    normalize_datetime_value,
    vietnam_now_sql,
)
from backend.shared.domain_enums import enum_code
from backend.db.id_utils import generate_record_id
from backend.shared.media_helper import (
    delete_managed_image_files,
    find_unreferenced_image_paths,
    normalize_managed_image_path,
)
from backend.sync.mapper import (
    canonicalize_payload_item,
    db_column_for_json_key,
    get_payload_value,
    json_key_for_column,
    map_db_to_json,
    save_child_payloads,
)
from backend.shared.text_utils import normalize_person_name
from backend.db.schema import MONEY_COLUMNS
from backend.shared.numeric_utils import parse_vnd_amount
from backend.shared.workspace_scope import is_personal_scope_for_user
from backend.sync.queries import (
    ALLOWED_ORPHAN_TABLES,
    SYNCED_TABLES,
    TABLE_KEYS,
)
from backend.sync.ownership import get_owner_type, validate_owner_scoped_references
from backend.sync.delete_policy import (
    ARCHIVABLE_TABLES,
)
from backend.sync.deletion_service import apply_sync_deletions
from backend.sync.repository import (
    DELETED_RECORD_UPSERT_SQL,
    VERSIONED_TABLES,
    defer_version_latest_flag,
    next_sync_version,
)
from backend.sync.serializer import iter_sync_table_payloads, rollback_sync_response
from backend.sync.validator import DEFAULT_PAPER_STATUS_COLOR, validate_sync_item
from backend.sync.payload_validation import (
    validate_contract_status_transition,
    validate_package_status_transition,
    validate_package_locked_fields,
    validate_sync_payload_shape,
)


from backend.sync.request_contract import (
    parse_sync_read_window,
    sync_batch_limit as _sync_batch_limit,
    sync_batch_size as _sync_batch_size,
)
from backend.sync.response import commit_sync_response
from backend.sync.opening_uniqueness import validate_opening_participant_uniqueness
from backend.shared.async_io import BlockingIOBusyError
from backend.shared.database_io import run_database_write
from backend.shared.request_validation import read_json_object


async def process_sync_request(request, broadcast_callback=None):
    """Validate the HTTP payload, then run the PostgreSQL mutation off-loop."""
    data, json_error = await read_json_object(request)
    if json_error:
        return json_error

    shape_errors = validate_sync_payload_shape(data)
    if shape_errors:
        log_error(
            "Payload shape invalid: "
            + json.dumps(
                [
                    {"field": error.get("field"), "code": error.get("code")}
                    for error in shape_errors
                ],
                ensure_ascii=False,
            ),
            "SyncAPI",
            request_id=get_request_id(request),
        )
        return error_response(
            request,
            "SYNC_VALIDATION_FAILED",
            "Dữ liệu đồng bộ không hợp lệ.",
            status_code=400,
            fields={"errors": shape_errors},
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

    try:
        return await run_database_write(
            _process_sync_request_blocking,
            request,
            data,
            broadcast_callback,
        )
    except BlockingIOBusyError:
        response = error_response(
            request,
            "DATABASE_WRITE_QUEUE_FULL",
            "Hệ thống đang xử lý quá nhiều thay đổi. Vui lòng thử lại sau.",
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response


def _persist_incoming_images(data, newly_written_images):
    """Decode/re-encode image payloads before opening the write transaction."""

    image_columns = {
        "chuyen_gia": {
            "anh_chung_chi": "cert",
            "anh_chu_ky": "sig",
        },
        "nha_thau": {
            "anh_dau": "stamp",
        },
    }
    for _payload_key, table_name, items in iter_sync_table_payloads(data):
        if table_name not in image_columns:
            continue
        for original_item in items:
            if not isinstance(original_item, dict):
                continue
            item = canonicalize_payload_item(table_name, original_item)
            record_id = clean_id(item.get("id"))
            for column_name, suffix in image_columns[table_name].items():
                json_key = json_key_for_column(table_name, column_name)
                value = get_payload_value(table_name, item, column_name)
                if not (
                    isinstance(value, str)
                    and value.startswith("data:image")
                ):
                    continue
                subfolder = (
                    "chuyen_gia"
                    if table_name == "chuyen_gia"
                    else "nha_thau"
                )
                managed_path = save_base64_image(
                    value,
                    subfolder,
                    f"{record_id}_{suffix}",
                )
                original_item[json_key] = managed_path
                newly_written_images.add(managed_path)


def _process_sync_request_blocking(request, data, broadcast_callback=None):
    """
    [POST] /api/sync
    Đồng bộ dữ liệu thay đổi từ ứng dụng Frontend vào cơ sở dữ liệu PostgreSQL.
    """
    def log_sync_error(msg):
        log_error(msg, "SyncAPI", request_id=get_request_id(request))

    conn = None
    transaction_committed = False
    newly_written_images = set()
    image_cleanup_candidates = set()
    batch_limit = _sync_batch_limit()
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            log_sync_error(f"Xác thực thất bại khi đồng bộ: {role_or_err}")
            return JSONResponse({"error": role_or_err}, status_code=403)

        role_str = str(role_or_err)
        user_id = role_or_err.user_id
        client_mutation_id = (data.get("clientMutationId") or "").strip()
        if client_mutation_id:
            client_mutation_id = client_mutation_id[:128]

        authorization_conn = database.get_connection()
        try:
            authorization_cursor = authorization_conn.cursor()
            org_name = get_active_org(
                request,
                user_id,
                cursor=authorization_cursor,
            )
            owner_type = get_owner_type(authorization_cursor, org_name)
            if owner_type == "personal" and not is_personal_scope_for_user(
                org_name,
                user_id,
            ):
                raise OrgPermissionError(
                    "Không gian cá nhân không thuộc tài khoản hiện tại."
                )
            if owner_type not in {"personal", "organization"}:
                raise OrgPermissionError("Không thể xác định phạm vi dữ liệu.")
            if client_mutation_id:
                existing_mutation = authorization_cursor.execute(
                    """
                    SELECT response_json
                    FROM sync_mutations
                    WHERE organization_id = ?
                      AND actor_user_id = ?
                      AND client_mutation_id = ?
                    """,
                    (org_name, user_id, client_mutation_id),
                ).fetchone()
                if existing_mutation:
                    try:
                        return JSONResponse(
                            json.loads(existing_mutation[0] or "{}")
                        )
                    except (json.JSONDecodeError, TypeError):
                        return JSONResponse({"status": "success"})
        finally:
            authorization_conn.close()

        _persist_incoming_images(data, newly_written_images)

        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()

        transaction_org_name = get_active_org(
            request,
            user_id,
            cursor=cursor,
        )
        if transaction_org_name != org_name:
            raise OrgPermissionError(
                "Phạm vi dữ liệu đã thay đổi trong khi xử lý yêu cầu."
            )
        owner_type = get_owner_type(cursor, org_name)
        current_time = vietnam_now_sql()
        if client_mutation_id:
            cursor.execute(
                "SELECT response_json FROM sync_mutations WHERE organization_id = ? AND actor_user_id = ? AND client_mutation_id = ?",
                (org_name, user_id, client_mutation_id)
            )
            existing_mutation = cursor.fetchone()
            if existing_mutation:
                conn.commit()
                try:
                    return JSONResponse(json.loads(existing_mutation[0] or "{}"))
                except (json.JSONDecodeError, TypeError):
                    return JSONResponse({"status": "success"})


        if owner_type == "personal":
            if not is_personal_scope_for_user(org_name, user_id):
                log_sync_error(f"personal workspace không thuộc actor: {org_name}")
                return JSONResponse(
                    {"error": "Không thể xác định tài khoản sở hữu dữ liệu.", "code": "PERSONAL_WORKSPACE_OWNER_MISMATCH"},
                    status_code=403,
                )
        elif owner_type != "organization":
            log_sync_error(f"workspace ID không hợp lệ: {org_name}")
            return JSONResponse(
                {"error": "Không thể xác định phạm vi sở hữu dữ liệu.", "code": "WORKSPACE_NOT_FOUND"},
                status_code=400,
            )

        # Khi request tạo mới chưa chỉ định người phụ trách, backend giao cho
        # người tạo ngay trong cùng transaction. Một phân công được gửi rõ ràng
        # (ví dụ quản lý giao cho chuyên viên khác) luôn được giữ nguyên.
        if owner_type == "organization":
            assignments = data.setdefault("assignments", [])
            incoming_targets = {
                (
                    clean_id(item.get("targetId") or item.get("id_muc_tieu")),
                    str(item.get("type") or item.get("loai_doi_tuong") or "").strip(),
                )
                for item in assignments
                if isinstance(item, dict)
            }
            for payload_key, table_name, target_type in (
                ("kehoach", "ke_hoach_lcnt", "kehoach"),
                ("goithau", "goi_thau", "goithau"),
                ("hopdong", "hop_dong", "hopdong"),
            ):
                for item in data.get(payload_key, []):
                    if not isinstance(item, dict):
                        continue
                    record_id = clean_id(item.get("id"))
                    if not record_id or (record_id, target_type) in incoming_targets:
                        continue
                    exists = cursor.execute(
                        f"SELECT 1 FROM {table_name} WHERE organization_id = ? AND id = ? LIMIT 1",
                        (org_name, record_id),
                    ).fetchone()
                    if exists:
                        continue
                    assignments.append({
                        "id": generate_record_id("assignments"),
                        "empId": user_id,
                        "targetId": record_id,
                        "type": target_type,
                    })
                    incoming_targets.add((record_id, target_type))

            augmented_batch_size = _sync_batch_size(data)
            if augmented_batch_size > batch_limit:
                conn.rollback()
                conn.close()
                return error_response(
                    request,
                    "SYNC_BATCH_TOO_LARGE",
                    "Số lượng bản ghi đồng bộ vượt quá giới hạn cho phép.",
                    status_code=413,
                    fields={"maxItems": batch_limit, "receivedItems": augmented_batch_size},
                )



        batch_sync_version = next_sync_version(cursor, org_name)

        def get_clean_id(tbl, raw_id):
            if raw_id is None:
                return None
            if tbl in ["phan_cong_nhan_su", "trang_thai_ho_so_giay"]:
                return str(raw_id).strip()
            return clean_id(raw_id)

        affected_version_families = {}
        affected_plan_ids = set()
        updated_row_versions = []
        orphaned_ids = []
        delete_impacts = []

        def track_affected_record(table_name, record):
            if not isinstance(record, dict):
                return
            if table_name in VERSIONED_TABLES:
                root_id = get_clean_id(
                    table_name,
                    record.get("id_goc") or record.get("rootId") or record.get("id"),
                )
                if root_id:
                    family_key = root_id
                    if table_name == "goi_thau":
                        plan_id = get_clean_id(
                            "ke_hoach_lcnt",
                            record.get("ke_hoach_id") or record.get("keHoachId"),
                        )
                        family_key = (root_id, plan_id or "")
                    affected_version_families.setdefault(table_name, set()).add(
                        family_key
                    )
            if table_name == "ke_hoach_lcnt":
                plan_id = get_clean_id(table_name, record.get("id"))
                if plan_id:
                    affected_plan_ids.add(plan_id)
            elif table_name == "goi_thau":
                plan_id = get_clean_id(
                    "ke_hoach_lcnt",
                    record.get("ke_hoach_id") or record.get("keHoachId"),
                )
                if plan_id:
                    affected_plan_ids.add(plan_id)

        sync_item_errors = []


        validation_errors = []
        skipped_invalid_records = set()
        incoming_ids_by_table = {}
        incoming_records_by_table = {}
        stored_records_by_table = {}
        for _payload_key, _table_name, _items in iter_sync_table_payloads(data):
            table_records = incoming_records_by_table.setdefault(_table_name, {})
            table_ids = incoming_ids_by_table.setdefault(_table_name, set())
            for _item in _items:
                if not isinstance(_item, dict):
                    continue
                canonical_item = canonicalize_payload_item(_table_name, _item)
                record_id = get_clean_id(_table_name, canonical_item.get("id"))
                if record_id:
                    table_ids.add(str(record_id))
                    table_records[str(record_id)] = canonical_item
        incoming_paper_status_names = {
            str(item.get("name") or item.get("tenTrangThai") or "").strip()
            for item in data.get("custompaperstatuses", [])
            if isinstance(item, dict) and str(item.get("name") or item.get("tenTrangThai") or "").strip()
        }
        existing_paper_status_names = {
            str(row[0] or "").strip()
            for row in cursor.execute(
                "SELECT name FROM trang_thai_ho_so_giay WHERE organization_id = ?",
                (org_name,),
            ).fetchall()
            if str(row[0] or "").strip()
        }
        allowed_paper_status_names = existing_paper_status_names | incoming_paper_status_names

        validation_errors.extend(validate_opening_participant_uniqueness(
            cursor,
            org_name,
            data.get("thongtinmothau", []),
        ))


        for payload_key, table_name, items in iter_sync_table_payloads(data):
            for item in items:
                item = canonicalize_payload_item(table_name, item)
                item_errors = []
                current_record = None
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
                if c_id and "row_version" in SCHEMA_DINH_NGHIA[table_name]["columns"]:
                    current_row = cursor.execute(
                        f"SELECT * FROM {table_name} WHERE organization_id = ? AND id = ? LIMIT 1",
                        (org_name, c_id),
                    ).fetchone()
                    if current_row:
                        current_record = dict(current_row)
                        stored_records_by_table.setdefault(table_name, {})[str(c_id)] = current_record
                        expected_version = item.get("expectedVersion", item.get("rowVersion"))
                        current_row_version = int(current_record.get("row_version") or 1)
                        if expected_version != current_row_version:
                            item_errors.append({
                                "field": "expectedVersion",
                                "code": "ROW_VERSION_CONFLICT",
                                "message": "Bản ghi đã được thay đổi bởi một phiên làm việc khác.",
                                "expectedVersion": expected_version,
                                "currentVersion": current_row_version,
                                "serverRecord": map_db_to_json(table_name, current_record),
                            })
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
                    allowed_paper_status_names
                )
                item_errors.extend(pure_errors)
                if table_name == "goi_thau" and current_record:
                    item_errors.extend(validate_package_status_transition(
                        current_record.get("trang_thai"), item
                    ))
                    item_errors.extend(validate_package_locked_fields(current_record, item))
                if table_name == "hop_dong" and current_record:
                    item_errors.extend(validate_contract_status_transition(
                        current_record.get("trang_thai_hop_dong"), item
                    ))
                if owner_type == "organization" and table_name in {
                    "ke_hoach_lcnt", "goi_thau", "hop_dong"
                } and c_id:
                    target_type = {
                        "ke_hoach_lcnt": "kehoach",
                        "goi_thau": "goithau",
                        "hop_dong": "hopdong",
                    }[table_name]
                    has_incoming_assignment = any(
                        clean_id(assignment.get("targetId") or assignment.get("id_muc_tieu")) == c_id
                        and str(assignment.get("type") or assignment.get("loai_doi_tuong") or "").strip() == target_type
                        for assignment in data.get("assignments", [])
                        if isinstance(assignment, dict)
                    )
                    has_stored_assignment = cursor.execute(
                        """SELECT 1 FROM phan_cong_nhan_su
                           WHERE organization_id = ? AND id_muc_tieu = ? AND loai_doi_tuong = ?
                           LIMIT 1""",
                        (org_name, c_id, target_type),
                    ).fetchone() is not None
                    if not has_incoming_assignment and not has_stored_assignment:
                        item_errors.append("Bản ghi phải có một chuyên viên phụ trách chính.")
                reference_errors = validate_owner_scoped_references(
                    cursor,
                    org_name,
                    table_name,
                    item,
                    incoming_ids_by_table,
                    incoming_records_by_table,
                )
                if table_name == "phan_cong_nhan_su" and reference_errors:
                    skipped_invalid_records.add((table_name, str(c_id)))
                    orphaned_ids.append({"table": table_name, "id": c_id})
                    continue
                item_errors.extend(reference_errors)
                if table_name == "chu_dau_tu":
                    ma = item.get("maChuDauTu")
                    mst = item.get("maSoThue")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT id FROM chu_dau_tu WHERE organization_id = ? AND archived_at IS NULL AND lower(trim(ma_chu_dau_tu)) = lower(trim(?)) AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        conflict = cursor.fetchone()
                        if conflict:
                            item_errors.append({"message": f"Mã chủ đầu tư '{ma}' đã tồn tại.", "conflictingId": conflict[0]})
                    if mst and str(mst).strip():
                        cursor.execute("SELECT id FROM chu_dau_tu WHERE organization_id = ? AND archived_at IS NULL AND lower(trim(ma_so_thue)) = lower(trim(?)) AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(mst).strip(), c_id, c_root_id))
                        conflict = cursor.fetchone()
                        if conflict:
                            item_errors.append({"message": f"Mã số thuế '{mst}' đã tồn tại.", "conflictingId": conflict[0]})

                elif table_name == "ke_hoach_lcnt":
                    ma = item.get("maKeHoach")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM ke_hoach_lcnt WHERE organization_id = ? AND archived_at IS NULL AND lower(trim(ma_ke_hoach)) = lower(trim(?)) AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã kế hoạch '{ma}' đã tồn tại.")

                elif table_name == "goi_thau":
                    ma = item.get("maGoiThau")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT 1 FROM goi_thau WHERE organization_id = ? AND archived_at IS NULL AND lower(trim(ma_goi_thau)) = lower(trim(?)) AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Mã gói thầu '{ma}' đã tồn tại.")

                elif table_name == "nha_thau":
                    ma = item.get("maNhaThau")
                    mst = item.get("maSoThue")
                    if ma and str(ma).strip():
                        cursor.execute("SELECT id FROM nha_thau WHERE organization_id = ? AND archived_at IS NULL AND lower(trim(ma_nha_thau)) = lower(trim(?)) AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(ma).strip(), c_id, c_root_id))
                        conflict = cursor.fetchone()
                        if conflict:
                            item_errors.append({"message": f"Mã nhà thầu '{ma}' đã tồn tại.", "conflictingId": conflict[0]})
                    if mst and str(mst).strip():
                        cursor.execute("SELECT id FROM nha_thau WHERE organization_id = ? AND archived_at IS NULL AND lower(trim(ma_so_thue)) = lower(trim(?)) AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(mst).strip(), c_id, c_root_id))
                        conflict = cursor.fetchone()
                        if conflict:
                            item_errors.append({"message": f"Mã số thuế '{mst}' đã tồn tại.", "conflictingId": conflict[0]})

                elif table_name == "chuyen_gia":
                    cccd = item.get("soCCCD")
                    if cccd and str(cccd).strip():
                        cursor.execute("SELECT 1 FROM chuyen_gia WHERE organization_id = ? AND archived_at IS NULL AND trim(so_cccd) = trim(?) AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(cccd).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Số CCCD chuyên gia '{cccd}' đã tồn tại.")

                elif table_name == "hop_dong":
                    so_hd = item.get("soHopDong")
                    if so_hd and str(so_hd).strip():
                        cursor.execute("SELECT 1 FROM hop_dong WHERE organization_id = ? AND archived_at IS NULL AND lower(trim(so_hop_dong)) = lower(trim(?)) AND id != ? AND (id_goc IS NULL OR id_goc != ?)", (org_name, str(so_hd).strip(), c_id, c_root_id))
                        if cursor.fetchone():
                            item_errors.append(f"Số hợp đồng '{so_hd}' đã tồn tại.")

                elif table_name == "trang_thai_ho_so_giay":
                    status_name = item.get("name") or item.get("tenTrangThai")
                    if status_name and str(status_name).strip():
                        cursor.execute(
                            "SELECT 1 FROM trang_thai_ho_so_giay WHERE organization_id = ? AND lower(trim(name)) = lower(trim(?)) AND id != ?",
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
                        for detail_key in ("expectedVersion", "currentVersion", "serverRecord"):
                            if detail_key in error_detail:
                                validation_error[detail_key] = error_detail[detail_key]
                        validation_error["field"] = error_detail.get("field") or "$record"
                        validation_error["code"] = error_detail.get("code") or "SYNC_ITEM_INVALID"
                        validation_errors.append(validation_error)

        if validation_errors:
            log_error(f"Validation errors during sync: {validation_errors}", "SyncAPI")
            conn.rollback()
            conn.close()
            has_row_conflict = any(
                error.get("code") == "ROW_VERSION_CONFLICT" for error in validation_errors
            )
            response = error_response(
                request,
                "ROW_VERSION_CONFLICT" if has_row_conflict else "SYNC_VALIDATION_FAILED",
                "Có bản ghi đã thay đổi trên máy chủ." if has_row_conflict else "Không thể lưu dữ liệu do phát hiện lỗi.",
                status_code=409 if has_row_conflict else 400,
                fields={"errors": validation_errors},
            )
            payload = json.loads(response.body)
            payload.update({
                "status": "conflict" if has_row_conflict else "error",
                "errors": validation_errors,
            })
            return JSONResponse(
                payload,
                status_code=409 if has_row_conflict else 400,
                headers=dict(response.headers),
            )

        incoming_opening_ids = [
            get_clean_id("thong_tin_mo_thau", item.get("id"))
            for item in data.get("thongtinmothau", [])
            if isinstance(item, dict) and item.get("id")
        ]
        incoming_opening_ids = [value for value in incoming_opening_ids if value]
        if incoming_opening_ids:
            placeholders = ", ".join("?" for _ in incoming_opening_ids)
            cursor.execute(
                f"""DELETE FROM nha_thau_tham_du_mo_thau
                    WHERE organization_id = ? AND thong_tin_mo_thau_id IN ({placeholders})""",
                (org_name, *incoming_opening_ids),
            )

        for payload_key, table_name, items in iter_sync_table_payloads(data):
            table_spec = SCHEMA_DINH_NGHIA[table_name]
            columns = list(table_spec["columns"].keys())


            for item in items:
                item_id_for_skip = get_clean_id(table_name, item.get("id")) if isinstance(item, dict) else None
                if (table_name, str(item_id_for_skip)) in skipped_invalid_records:
                    continue
                item = canonicalize_payload_item(table_name, item)
                incoming_record_id = get_clean_id(table_name, item.get("id"))
                previous_record = stored_records_by_table.get(table_name, {}).get(
                    str(incoming_record_id)
                )
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
                        elif col == "id_goc":
                            db_row_data[col] = (
                                get_clean_id(table_name, item.get("rootId"))
                                or get_clean_id(
                                    table_name,
                                    previous_record.get("id_goc") if previous_record else None,
                                )
                                or get_clean_id(table_name, item.get("id"))
                            )
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

                                if col.startswith("ngay_"):
                                    val = normalize_date_value(val)
                                elif is_datetime_column(col):
                                    val = normalize_datetime_value(val)


                                col_type_upper = table_spec["columns"][col].upper()
                                if (table_name, col) in MONEY_COLUMNS:
                                    val = parse_vnd_amount(val)
                                elif "REAL" in col_type_upper:
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
                                allowed_existing_images = {
                                    previous_image
                                } if previous_image else set()
                                proposed_existing_image = normalize_managed_image_path(val)
                                if proposed_existing_image in newly_written_images:
                                    allowed_existing_images.add(
                                        proposed_existing_image
                                    )
                                if proposed_existing_image and proposed_existing_image not in allowed_existing_images:
                                    cursor.execute(
                                        f"SELECT 1 FROM {table_name} "
                                        f"WHERE organization_id = ? AND {col} = ? LIMIT 1",
                                        (org_name, proposed_existing_image),
                                    )
                                    if cursor.fetchone():
                                        allowed_existing_images.add(proposed_existing_image)
                                if (is_expert_image or is_contractor_image) and val:
                                    if is_new_image_data:
                                        raise ValueError(
                                            "Ảnh phải được xử lý trước transaction."
                                        )
                                    expected_prefix = (
                                        "images/chuyen_gia/"
                                        if is_expert_image
                                        else "images/nha_thau/"
                                    )
                                    if (
                                        not proposed_existing_image
                                        or not proposed_existing_image.startswith(
                                            expected_prefix
                                        )
                                        or proposed_existing_image
                                        not in allowed_existing_images
                                    ):
                                        raise ValueError(
                                            "Ảnh không thuộc bản ghi hoặc tổ chức này."
                                        )
                                    val = proposed_existing_image

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



                                db_row_data[col] = enum_code(table_name, col, val)



                    if not db_row_data.get("id"):
                        db_row_data["id"] = generate_record_id(table_name)
                    if not item.get("id"):
                        item["id"] = db_row_data["id"]

                    defer_version_latest_flag(table_name, db_row_data)

                    if table_name == "phan_cong_nhan_su":





                        cursor.execute("""
                            DELETE FROM phan_cong_nhan_su
                            WHERE organization_id = ?
                              AND id_muc_tieu = ?
                              AND loai_doi_tuong = ?
                              AND id != ?
                        """, (
                            db_row_data.get("organization_id"),
                            db_row_data.get("id_muc_tieu"),
                            db_row_data.get("loai_doi_tuong"),
                            db_row_data.get("id"),
                        ))
                    elif table_name == "ma_tran_phan_quyen":
                        cursor.execute("""
                            DELETE FROM ma_tran_phan_quyen
                            WHERE organization_id = ? AND emp_id = ? AND id != ?
                        """, (db_row_data.get("organization_id"), db_row_data.get("emp_id"), db_row_data.get("id")))


                    existing_version_row = cursor.execute(
                        f"SELECT row_version FROM {table_name} WHERE organization_id = ? AND id = ? LIMIT 1",
                        (org_name, db_row_data["id"]),
                    ).fetchone()
                    if existing_version_row:
                        expected_version = item.get("expectedVersion", item.get("rowVersion"))
                        db_row_data["row_version"] = int(expected_version) + 1
                        update_columns = [
                            key for key in db_row_data if key not in {"id", "organization_id", "created_at"}
                        ]
                        assignments = ", ".join(f"{key} = ?" for key in update_columns)
                        params = [db_row_data[key] for key in update_columns]
                        params.extend([db_row_data["id"], org_name, expected_version])
                        cursor.execute(
                            f"UPDATE {table_name} SET {assignments} "
                            "WHERE id = ? AND organization_id = ? AND row_version = ?",
                            tuple(params),
                        )
                        if cursor.rowcount != 1:
                            latest = cursor.execute(
                                f"SELECT * FROM {table_name} WHERE organization_id = ? AND id = ? LIMIT 1",
                                (org_name, db_row_data["id"]),
                            ).fetchone()
                            latest_record = dict(latest) if latest else None
                            sync_item_errors.append({
                                "table": table_name,
                                "id": db_row_data["id"],
                                "field": "expectedVersion",
                                "code": "ROW_VERSION_CONFLICT",
                                "message": "Bản ghi đã được thay đổi bởi một phiên làm việc khác.",
                                "expectedVersion": expected_version,
                                "currentVersion": latest_record.get("row_version") if latest_record else None,
                                "serverRecord": map_db_to_json(table_name, latest_record) if latest_record else None,
                            })
                            continue
                    else:
                        db_row_data["row_version"] = 1
                        cols_str = ", ".join(db_row_data.keys())
                        placeholders = ", ".join(["?"] * len(db_row_data))
                        cursor.execute(
                            f"INSERT INTO {table_name} ({cols_str}) VALUES ({placeholders})",
                            tuple(db_row_data.values()),
                        )
                    if table_name in OWNERSHIP_SCOPED_TABLES:
                        lineage_root = clean_id(item.get("rootId") or item.get("id_goc")) or db_row_data["id"]
                        cursor.execute(
                            """INSERT INTO record_edit_ownership (
                                   organization_id, table_name, record_id, user_id
                               ) VALUES (?, ?, ?, ?)
                               ON CONFLICT (organization_id, table_name, record_id) DO NOTHING""",
                            (org_name, table_name, lineage_root, user_id),
                        )
                    updated_row_versions.append({
                        "table": payload_key,
                        "id": db_row_data["id"],
                        "rowVersion": db_row_data["row_version"],
                    })
                    save_child_payloads(
                        cursor,
                        table_name,
                        item,
                        org_name,
                        owner_type,
                        batch_sync_version,
                        current_time,
                        user_id,
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
                                        "INSERT INTO hop_dong_goi_thau (organization_id, owner_type, hop_dong_id, goi_thau_id) VALUES (?, ?, ?, ?) ON CONFLICT (organization_id, hop_dong_id, goi_thau_id) DO UPDATE SET owner_type = EXCLUDED.owner_type, updated_at = CURRENT_TIMESTAMP",
                                        (org_name, owner_type, c_hd_id, gt_id)
                                    )
                    track_affected_record(table_name, previous_record)
                    track_affected_record(table_name, db_row_data)
                except Exception as item_err:
                    err_str = str(item_err)
                    item_id = get_clean_id(table_name, item.get('id'))

                    if (
                        isinstance(item_err, IntegrityError)
                        and getattr(item_err, "sqlstate", None) == "23503"
                        and item_id
                        and table_name in ALLOWED_ORPHAN_TABLES
                    ):
                        try:
                            cursor.execute(
                                DELETED_RECORD_UPSERT_SQL,
                                (table_name, item_id, org_name, current_time, batch_sync_version)
                            )
                            orphaned_ids.append({"table": table_name, "id": item_id})
                        except DatabaseError as orphan_cleanup_error:
                            log_sync_error(f"Không thể đánh dấu bản ghi mồ côi {item_id}: {orphan_cleanup_error}")
                    else:
                        log_sync_error(f"Lỗi đồng bộ bản ghi trong bảng {table_name} (ID: {item.get('id')}): {item_err}\n{traceback.format_exc()}")
                        sync_item_errors.append({
                            "table": table_name,
                            "id": item.get("id"),
                            "message": str(item_err)
                        })


        deletion_result = apply_sync_deletions(
            cursor,
            data.get("deletions", []),
            organization_id=org_name,
            actor_role=role_str,
            actor_user_id=user_id,
            session_id=getattr(role_or_err, "session_id", None),
            current_time=current_time,
            sync_version=batch_sync_version,
            clean_record_id=get_clean_id,
            privileged_reauth_ttl_seconds=PRIVILEGED_REAUTH_TTL_SECONDS,
            privileged_reauth_error_message=PRIVILEGED_REAUTH_REQUIRED,
            ip_address=get_client_ip(request),
        )
        if deletion_result["privilegedError"]:
            conn.rollback()
            return JSONResponse(deletion_result["privilegedError"], status_code=403)
        sync_item_errors.extend(deletion_result["errors"])
        delete_impacts.extend(deletion_result["impacts"])
        for table_name, families in deletion_result["affectedVersionFamilies"].items():
            affected_version_families.setdefault(table_name, set()).update(families)
        affected_plan_ids.update(deletion_result["affectedPlanIds"])
        image_cleanup_candidates.update(deletion_result["imageCleanupCandidates"])


        for tbl, families in affected_version_families.items():
            recalculate_is_latest(
                cursor,
                tbl,
                organization_id=org_name,
                affected_families=families,
            )


        if affected_plan_ids:
            recalculate_tong_muc_dau_tu(
                cursor,
                organization_id=org_name,
                plan_ids=affected_plan_ids,
            )

        if sync_item_errors:
            conflict = any(error.get("code") == "ROW_VERSION_CONFLICT" for error in sync_item_errors)
            return rollback_sync_response(
                conn,
                sync_item_errors,
                "Không thể đồng bộ vì có bản ghi không hợp lệ.",
                status_code=409 if conflict else 400,
            )

        response_data = commit_sync_response(
            conn,
            cursor,
            organization_id=org_name,
            actor_user_id=user_id,
            actor_role=role_str,
            current_time=current_time,
            client_mutation_id=client_mutation_id,
            include_dashboard_summary=data.get("includeDashboardSummary") is True,
            updated_row_versions=updated_row_versions,
            delete_impacts=delete_impacts,
            orphaned_ids=orphaned_ids,
        )
        transaction_committed = True

        try:
            unreferenced_images = find_unreferenced_image_paths(
                cursor,
                image_cleanup_candidates | newly_written_images,
            )
            conn.commit()
            delete_managed_image_files(unreferenced_images)
        except Exception as cleanup_error:
            log_sync_error(f"Không thể dọn ảnh không còn tham chiếu: {cleanup_error}")


        if broadcast_callback:
            broadcast_callback(org_name, {"event": "db_changed"})
        if isinstance(data.get("nhathau"), list) and data.get("nhathau"):
            try:
                from backend.partners.partner_lookup_service import request_partner_enrichment
                request_partner_enrichment(
                    org_name,
                    [
                        get_clean_id("nha_thau", item.get("id"))
                        for item in data.get("nhathau", [])
                        if isinstance(item, dict) and item.get("id")
                    ],
                )
            except Exception as enrichment_error:
                log_sync_error(f"Không thể kích hoạt bổ sung thông tin nhà thầu: {enrichment_error}")
        json_started_at = time.perf_counter()
        try:
            return JSONResponse(response_data)
        finally:
            record_database_phase(
                "sync",
                "json_serialize",
                time.perf_counter() - json_started_at,
            )
    except OrgPermissionError as e:
        if conn:
            try:
                conn.rollback()
            except DatabaseError:
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
            except DatabaseError:
                pass
        log_sync_error(f"Lỗi tổng quát sync_api: {e}\n{traceback.format_exc()}")
        return JSONResponse({"error": "Đồng bộ dữ liệu thất bại. Vui lòng thử lại."}, status_code=500)
    finally:
        if conn:
            try:
                conn.close()
            except DatabaseError:
                pass
        if not transaction_committed and newly_written_images:
            cleanup_conn = None
            unreferenced_images = []
            try:
                cleanup_conn = database.get_connection()
                unreferenced_images = find_unreferenced_image_paths(
                    cleanup_conn.cursor(),
                    newly_written_images,
                )
                cleanup_conn.commit()
            except Exception as cleanup_error:
                log_sync_error(f"Không thể dọn ảnh sau khi rollback: {cleanup_error}")
            finally:
                if cleanup_conn:
                    cleanup_conn.close()
            try:
                delete_managed_image_files(unreferenced_images)
            except Exception as cleanup_error:
                log_sync_error(
                    f"Không thể xóa file ảnh sau khi rollback: {cleanup_error}"
                )
