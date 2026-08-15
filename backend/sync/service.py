from backend.db.db_helper import DatabaseError, IntegrityError
import json
import time
import traceback

from starlette.responses import JSONResponse

from backend.shared.helpers import (
    OrgPermissionError,
    SCHEMA_DINH_NGHIA,
    clean_id,
    database,
    get_active_org,
    log_error,
    recalculate_is_latest,
    recalculate_tong_muc_dau_tu,
    verify_session,
)
from backend.shared.idempotency import acquire_idempotency_lock
from backend.shared.access_policy import (
    OWNERSHIP_SCOPED_TABLES,
    authorize_record_write,
    can_upload_workspace_assets,
)
from backend.shared.client_ip import get_client_ip
from backend.shared.logging_utils import error_response, get_request_id
from backend.observability.recording import record_database_phase
from backend.shared.date_utils import vietnam_now_sql
from backend.shared.media_helper import (
    delete_managed_image_files,
    discard_staged_assets,
    find_unreferenced_image_paths,
    normalize_managed_image_path,
    promote_staged_assets,
    register_staged_assets,
    stage_base64_image,
)
from backend.sync.command import (
    SyncActorContext,
    SyncMutationEnvelope,
    SyncPostCommitContext,
    SyncTransactionContext,
)
from backend.sync.assignment_augmentation import (
    SyncBatchLimitExceeded,
    augment_default_assignments,
)
from backend.sync.idempotency import request_hash_matches
from backend.sync.mapper import (
    canonicalize_payload_item,
    get_payload_value,
    json_key_for_column,
    map_db_to_json,
    save_child_payloads,
)
from backend.sync.mutation_tracker import (
    SyncMutationTracker,
    clean_sync_record_id,
)
from backend.sync.payload_index import SyncPayloadIndex
from backend.sync.record_serializer import SyncRecordSerializer
from backend.sync.record_writer import SyncRecordWriter
from backend.sync.record_validator import SyncRecordValidator
from backend.db.schema import MONEY_COLUMNS
from backend.shared.workspace_scope import (
    is_personal_scope_for_user,
    lock_personal_workspace_mutations,
)
from backend.sync.queries import ALLOWED_ORPHAN_TABLES
from backend.sync.ownership import get_owner_type
from backend.sync.deletion_service import apply_sync_deletions
from backend.sync.repository import (
    DELETED_RECORD_UPSERT_SQL,
    defer_version_latest_flag,
    next_sync_version,
)
from backend.sync.serializer import iter_sync_table_payloads, rollback_sync_response
from backend.sync.public_errors import public_sync_item_error
from backend.sync.payload_validation import validate_sync_payload_shape
from backend.versioning.command import (
    AggregateVersionConflict,
    AggregateVersionPolicyError,
    build_aggregate_version_payload,
)
from backend.versioning.repository import AggregateVersionRepository
from backend.procurement_import.sync_binding import (
    persist_import_session_provenance,
    resolve_pending_imported_investor,
    validate_import_session_mutation,
)
from backend.procurement_import.domain import ImportConflict


from backend.sync.request_contract import (
    sync_batch_limit as _sync_batch_limit,
    generated_aggregate_batch_limit as _generated_aggregate_batch_limit,
    sync_batch_size as _sync_batch_size,
)
from backend.sync.response import commit_sync_response
from backend.shared.async_io import BlockingIOBusyError
from backend.shared.database_io import run_database_write
from backend.shared.request_validation import read_json_object
from backend.notifications.service import (
    queue_assignment_state_changes,
    snapshot_assignment_state,
)
from backend.activity.service import (
    build_assignment_activity_events,
    insert_activity_events,
    insert_assignment_removal_history,
)
from backend.sync.mutation_audit import insert_mutation_audit_events


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
            execute_sync_mutation,
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


_PROTECTED_MEDIA_COLUMNS = {
    "chuyen_gia": {
        "anh_chung_chi": "cert",
        "anh_chu_ky": "sig",
    },
    "nha_thau": {
        "anh_dau": "stamp",
    },
}

_PROTECTED_MEDIA_QUERY_CHUNK_SIZE = 400


def _protected_media_write_columns(table_name):
    return tuple(_PROTECTED_MEDIA_COLUMNS.get(table_name, {}))


def _normalized_protected_media_value(value):
    raw_value = "" if value is None else str(value).strip()
    return normalize_managed_image_path(raw_value) or raw_value


def _load_protected_media_state(cursor, table_name, items, organization_id):
    record_ids = {
        clean_id(canonicalize_payload_item(table_name, item).get("id"))
        for item in items
        if isinstance(item, dict)
    }
    root_ids = {
        clean_id(
            canonicalize_payload_item(table_name, item).get("rootId")
            or canonicalize_payload_item(table_name, item).get("id_goc")
        )
        for item in items
        if isinstance(item, dict)
    }
    reference_ids = sorted((record_ids | root_ids) - {None, ""})
    if not reference_ids:
        return {}, {}

    columns = _protected_media_write_columns(table_name)
    selected_columns = ", ".join(columns)
    rows = []
    for offset in range(0, len(reference_ids), _PROTECTED_MEDIA_QUERY_CHUNK_SIZE):
        chunk = reference_ids[offset:offset + _PROTECTED_MEDIA_QUERY_CHUNK_SIZE]
        placeholders = ", ".join("?" for _ in chunk)
        rows.extend(cursor.execute(
            f"""SELECT id, id_goc, is_latest, updated_at, {selected_columns}
                FROM {table_name}
                WHERE organization_id = ?
                  AND (id IN ({placeholders}) OR id_goc IN ({placeholders}))""",  # noqa: S608 - identifiers come from the fixed protected-media registry
            (organization_id, *chunk, *chunk),
        ).fetchall())

    by_id = {}
    latest_by_root = {}
    for row in rows:
        # CompatRow deliberately supports scalar positional indexing but not
        # slices. Converting here also keeps sqlite/PostgreSQL row handling
        # identical for this cross-database authorization check.
        values = dict(zip(columns, tuple(row)[4:]))
        record_id = clean_id(row[0])
        root_id = clean_id(row[1]) or record_id
        state = {
            "values": values,
            "rank": (int(row[2] or 0), str(row[3] or ""), record_id or ""),
        }
        if record_id:
            by_id[record_id] = state
        if root_id and (
            root_id not in latest_by_root
            or state["rank"] > latest_by_root[root_id]["rank"]
        ):
            latest_by_root[root_id] = state
    return by_id, latest_by_root


def validate_protected_media_upload_access(data, *, owner_type, can_upload):
    """Return manager-only violations for new signature-related image uploads."""

    if owner_type != "organization" or can_upload:
        return []
    errors = []
    for _payload_key, table_name, items in iter_sync_table_payloads(data):
        if table_name not in _PROTECTED_MEDIA_COLUMNS:
            continue
        for original_item in items:
            if not isinstance(original_item, dict):
                continue
            item = canonicalize_payload_item(table_name, original_item)
            record_id = clean_id(item.get("id"))
            for column_name in _PROTECTED_MEDIA_COLUMNS[table_name]:
                value = get_payload_value(table_name, item, column_name)
                if isinstance(value, str) and value.startswith("data:image"):
                    errors.append({
                        "table": table_name,
                        "id": record_id,
                        "field": column_name,
                        "code": "ORG_ASSET_UPLOAD_MANAGER_REQUIRED",
                        "message": (
                            "Chỉ Quản lý của tổ chức được tải lên ảnh dấu, "
                            "ảnh chữ ký và ảnh chứng chỉ."
                        ),
                    })
    return errors


def validate_protected_media_mutation_access(
    data,
    *,
    owner_type,
    can_upload,
    cursor,
    organization_id,
):
    """Reject any protected media change by an organization employee."""

    if owner_type != "organization" or can_upload:
        return []
    errors = []
    for _payload_key, table_name, items in iter_sync_table_payloads(data):
        columns = _protected_media_write_columns(table_name)
        if not columns:
            continue
        by_id, latest_by_root = _load_protected_media_state(
            cursor,
            table_name,
            items,
            organization_id,
        )
        for original_item in items:
            if not isinstance(original_item, dict):
                continue
            item = canonicalize_payload_item(table_name, original_item)
            record_id = clean_id(item.get("id"))
            root_id = clean_id(item.get("rootId") or item.get("id_goc"))
            stored = by_id.get(record_id) or latest_by_root.get(root_id)
            stored_values = stored["values"] if stored else {}
            for column_name in columns:
                json_key = json_key_for_column(table_name, column_name)
                if json_key not in original_item and column_name not in original_item:
                    continue
                incoming = _normalized_protected_media_value(
                    get_payload_value(table_name, item, column_name)
                )
                current = _normalized_protected_media_value(
                    stored_values.get(column_name)
                )
                if incoming == current:
                    continue
                errors.append({
                    "table": table_name,
                    "id": record_id,
                    "field": column_name,
                    "code": "ORG_ASSET_MUTATION_MANAGER_REQUIRED",
                    "message": (
                        "Chỉ Quản lý của tổ chức được thêm, thay đổi hoặc xóa "
                        "ảnh dấu, ảnh chữ ký và ảnh chứng chỉ."
                    ),
                })
    return errors


def _persist_incoming_images(
    data,
    newly_written_images,
    staged_assets,
    organization_id,
    client_mutation_id,
):
    """Decode/re-encode images into the private staging namespace."""

    for _payload_key, table_name, items in iter_sync_table_payloads(data):
        if table_name not in _PROTECTED_MEDIA_COLUMNS:
            continue
        for original_item in items:
            if not isinstance(original_item, dict):
                continue
            item = canonicalize_payload_item(table_name, original_item)
            record_id = clean_id(item.get("id"))
            for column_name, suffix in _PROTECTED_MEDIA_COLUMNS[table_name].items():
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
                staged = stage_base64_image(
                    value,
                    subfolder,
                    f"{record_id}_{suffix}",
                    tenant_id=organization_id,
                    client_mutation_id=client_mutation_id,
                )
                managed_path = staged["managed_path"]
                original_item[json_key] = managed_path
                newly_written_images.add(managed_path)
                staged_assets.append(staged)


def _resolve_sync_actor_context(request, envelope, log_sync_error):
    is_valid, role_or_err = verify_session(request)
    if not is_valid:
        log_sync_error(f"Xác thực thất bại khi đồng bộ: {role_or_err}")
        return None, JSONResponse({"error": role_or_err}, status_code=403)

    user_id = role_or_err.user_id
    authorization_conn = database.get_connection()
    try:
        authorization_cursor = authorization_conn.cursor()
        organization_id = get_active_org(
            request,
            user_id,
            cursor=authorization_cursor,
        )
        owner_type = get_owner_type(authorization_cursor, organization_id)
        if owner_type == "personal" and not is_personal_scope_for_user(
            organization_id,
            user_id,
        ):
            raise OrgPermissionError(
                "Không gian cá nhân không thuộc tài khoản hiện tại."
            )
        if owner_type not in {"personal", "organization"}:
            raise OrgPermissionError("Không thể xác định phạm vi dữ liệu.")
        asset_upload_allowed = owner_type == "personal" or can_upload_workspace_assets(
            authorization_cursor,
            role_or_err,
            user_id,
            organization_id,
        )
        if envelope.client_mutation_id:
            existing_mutation = authorization_cursor.execute(
                """
                SELECT response_json, request_hash
                FROM sync_mutations
                WHERE organization_id = ?
                  AND actor_user_id = ?
                  AND client_mutation_id = ?
                """,
                (
                    organization_id,
                    user_id,
                    envelope.client_mutation_id,
                ),
            ).fetchone()
            if existing_mutation:
                stored_hash = (
                    existing_mutation[1]
                    if len(existing_mutation) > 1
                    else None
                )
                if not request_hash_matches(stored_hash, envelope.request_hash):
                    return None, error_response(
                        request,
                        "IDEMPOTENCY_KEY_REUSED",
                        "Mã đồng bộ đã được dùng cho một nội dung khác.",
                        status_code=409,
                    )
                try:
                    return None, JSONResponse(
                        json.loads(existing_mutation[0] or "{}")
                    )
                except (json.JSONDecodeError, TypeError):
                    return None, JSONResponse({"status": "success"})
    finally:
        authorization_conn.close()

    return SyncActorContext(
        request=request,
        role=role_or_err,
        user_id=user_id,
        organization_id=organization_id,
        owner_type=owner_type,
        can_upload_workspace_assets=asset_upload_allowed,
    ), None


def _prepare_sync_transaction(connection, cursor, actor, envelope, log_sync_error):
    if is_personal_scope_for_user(actor.organization_id, actor.user_id):
        # Authorize again only after account deletion can no longer overtake
        # this personal-workspace transaction.
        lock_personal_workspace_mutations(cursor, actor.organization_id)
    transaction_organization_id = get_active_org(
        actor.request,
        actor.user_id,
        cursor=cursor,
    )
    if transaction_organization_id != actor.organization_id:
        raise OrgPermissionError(
            "Phạm vi dữ liệu đã thay đổi trong khi xử lý yêu cầu."
        )

    owner_type = get_owner_type(cursor, actor.organization_id)
    current_time = vietnam_now_sql()
    if envelope.client_mutation_id:
        acquire_idempotency_lock(
            cursor,
            "sync",
            actor.organization_id,
            actor.user_id,
            envelope.client_mutation_id,
        )
        cursor.execute(
            """
            SELECT response_json, request_hash
            FROM sync_mutations
            WHERE organization_id = ?
              AND actor_user_id = ?
              AND client_mutation_id = ?
            """,
            (
                actor.organization_id,
                actor.user_id,
                envelope.client_mutation_id,
            ),
        )
        existing_mutation = cursor.fetchone()
        if existing_mutation:
            stored_hash = (
                existing_mutation[1]
                if len(existing_mutation) > 1
                else None
            )
            if not request_hash_matches(stored_hash, envelope.request_hash):
                connection.rollback()
                return None, error_response(
                    actor.request,
                    "IDEMPOTENCY_KEY_REUSED",
                    "Mã đồng bộ đã được dùng cho một nội dung khác.",
                    status_code=409,
                )
            connection.commit()
            try:
                return None, JSONResponse(
                    json.loads(existing_mutation[0] or "{}")
                )
            except (json.JSONDecodeError, TypeError):
                return None, JSONResponse({"status": "success"})

    if owner_type == "personal":
        if not is_personal_scope_for_user(
            actor.organization_id,
            actor.user_id,
        ):
            log_sync_error(
                f"personal workspace không thuộc actor: {actor.organization_id}"
            )
            return None, JSONResponse(
                {
                    "error": "Không thể xác định tài khoản sở hữu dữ liệu.",
                    "code": "PERSONAL_WORKSPACE_OWNER_MISMATCH",
                },
                status_code=403,
            )
    elif owner_type != "organization":
        log_sync_error(f"workspace ID không hợp lệ: {actor.organization_id}")
        return None, JSONResponse(
            {
                "error": "Không thể xác định phạm vi sở hữu dữ liệu.",
                "code": "WORKSPACE_NOT_FOUND",
            },
            status_code=400,
        )

    return SyncTransactionContext(
        connection=connection,
        cursor=cursor,
        actor=actor,
        owner_type=owner_type,
        current_time=current_time,
    ), None


def _run_post_commit_side_effects(
    context,
    *,
    broadcast_callback,
    clean_record_id,
    log_sync_error,
):
    transaction = context.transaction
    organization_id = transaction.actor.organization_id
    payload = context.envelope.payload
    try:
        promote_staged_assets(transaction.connection, context.staged_assets)
        unreferenced_images = find_unreferenced_image_paths(
            transaction.cursor,
            context.image_cleanup_candidates | context.newly_written_images,
        )
        transaction.connection.commit()
        delete_managed_image_files(unreferenced_images)
    except Exception as cleanup_error:
        log_sync_error(
            f"Không thể dọn ảnh không còn tham chiếu: {cleanup_error}"
        )

    # The durable websocket event was inserted by commit_sync_response in the
    # same transaction as the mutation. NOTIFY is delivered after commit.
    del broadcast_callback
    if isinstance(payload.get("nhathau"), list) and payload.get("nhathau"):
        try:
            from backend.partners.partner_lookup_service import (
                request_partner_enrichment,
            )

            request_partner_enrichment(
                organization_id,
                [
                    clean_record_id("nha_thau", item.get("id"))
                    for item in payload.get("nhathau", [])
                    if isinstance(item, dict) and item.get("id")
                ],
            )
        except Exception as enrichment_error:
            log_sync_error(
                "Không thể kích hoạt bổ sung thông tin nhà thầu: "
                f"{enrichment_error}"
            )
    json_started_at = time.perf_counter()
    try:
        return JSONResponse(context.response_data)
    finally:
        record_database_phase(
            "sync",
            "json_serialize",
            time.perf_counter() - json_started_at,
        )


def _cleanup_rolled_back_images(newly_written_images, log_sync_error):
    if not newly_written_images:
        return
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


def execute_sync_mutation(
    request,
    data,
    broadcast_callback=None,
    *,
    aggregate_version_command=False,
):
    """
    [POST] /api/sync
    Đồng bộ dữ liệu thay đổi từ ứng dụng Frontend vào cơ sở dữ liệu PostgreSQL.
    """
    def log_sync_error(msg):
        log_error(msg, "SyncAPI", request_id=get_request_id(request))

    conn = None
    transaction_committed = False
    newly_written_images = set()
    staged_assets = []
    server_inherited_assignment_ids = set()
    batch_limit = _sync_batch_limit()
    try:
        envelope = SyncMutationEnvelope.from_payload(data)
        actor_context, early_response = _resolve_sync_actor_context(
            request,
            envelope,
            log_sync_error,
        )
        if early_response is not None:
            return early_response

        role_str = actor_context.role
        user_id = actor_context.user_id
        org_name = actor_context.organization_id
        owner_type = actor_context.owner_type
        client_mutation_id = envelope.client_mutation_id
        mutation_request_hash = envelope.request_hash

        conn = database.get_connection()
        conn.execute(
            "BEGIN ISOLATION LEVEL SERIALIZABLE"
            if aggregate_version_command
            else "BEGIN"
        )
        cursor = conn.cursor()
        transaction_context, early_response = _prepare_sync_transaction(
            conn,
            cursor,
            actor_context,
            envelope,
            log_sync_error,
        )
        if early_response is not None:
            return early_response
        owner_type = transaction_context.owner_type
        current_time = transaction_context.current_time

        import_authority = validate_import_session_mutation(
            cursor, data, organization_id=org_name, user_id=user_id,
        )
        trusted_import_package_ids = set(
            (import_authority or {}).get("packageIds") or ()
        )
        resolve_pending_imported_investor(cursor, data, org_name)

        if aggregate_version_command:
            command_kind = str(data.get("kind") or "").strip().lower()
            source_access = {
                "package": ("goithau", "goi_thau"),
                "plan": ("kehoach", "ke_hoach_lcnt"),
            }.get(command_kind)
            if source_access is None:
                conn.rollback()
                return error_response(
                    request,
                    "INVALID_VERSION_COMMAND",
                    "Loại đối tượng tạo phiên bản không hợp lệ.",
                    status_code=400,
                )
            payload_key, table_name = source_access
            access = authorize_record_write(
                cursor,
                role_str,
                user_id,
                org_name,
                payload_key,
                table_name,
                {"id": data.get("sourceId")},
            )
            if not access.allowed:
                conn.rollback()
                return error_response(
                    request,
                    "VERSION_SOURCE_WRITE_DENIED",
                    access.reason or "Không có quyền tạo phiên bản cho bản ghi này.",
                    status_code=403,
                )
            data = build_aggregate_version_payload(
                AggregateVersionRepository(cursor),
                org_name,
                data,
                timestamp=current_time,
                actor_authority_id=user_id,
            )
            server_inherited_assignment_ids = {
                str(item.get("id"))
                for item in data.get("assignments", ())
                if isinstance(item, dict) and item.get("id")
            }
            shape_errors = validate_sync_payload_shape(data)
            if shape_errors:
                conn.rollback()
                return error_response(
                    request,
                    "SYNC_VALIDATION_FAILED",
                    "Dữ liệu phiên bản sinh trên máy chủ không hợp lệ.",
                    status_code=400,
                    fields={"errors": shape_errors},
                )
            generated_batch_size = _sync_batch_size(data)
            generated_batch_limit = _generated_aggregate_batch_limit()
            if generated_batch_size > generated_batch_limit:
                conn.rollback()
                return error_response(
                    request,
                    "SYNC_BATCH_TOO_LARGE",
                    "Số lượng bản ghi của phiên bản vượt quá giới hạn cho phép.",
                    status_code=413,
                    fields={
                        "maxItems": generated_batch_limit,
                        "receivedItems": generated_batch_size,
                    },
                )

        # Re-evaluate this permission in the write transaction. A manager may
        # have been demoted after the initial session/organization lookup.
        transaction_can_upload_assets = can_upload_workspace_assets(
            cursor,
            actor_context.role,
            user_id,
            org_name,
        )
        protected_media_errors = validate_protected_media_upload_access(
            data,
            owner_type=owner_type,
            can_upload=transaction_can_upload_assets,
        )
        if protected_media_errors:
            conn.rollback()
            return error_response(
                request,
                "ORG_ASSET_UPLOAD_MANAGER_REQUIRED",
                "Chỉ Quản lý của tổ chức được tải lên ảnh dấu, ảnh chữ ký và ảnh chứng chỉ.",
                status_code=403,
                fields={"errors": protected_media_errors},
            )

        protected_media_mutation_errors = validate_protected_media_mutation_access(
            data,
            owner_type=owner_type,
            can_upload=transaction_can_upload_assets,
            cursor=cursor,
            organization_id=org_name,
        )
        if protected_media_mutation_errors:
            conn.rollback()
            return error_response(
                request,
                "ORG_ASSET_MUTATION_MANAGER_REQUIRED",
                "Chỉ Quản lý của tổ chức được thêm, thay đổi hoặc xóa ảnh dấu, ảnh chữ ký và ảnh chứng chỉ.",
                status_code=403,
                fields={"errors": protected_media_mutation_errors},
            )

        _persist_incoming_images(
            data,
            newly_written_images,
            staged_assets,
            org_name,
            client_mutation_id,
        )
        register_staged_assets(cursor, staged_assets)

        assignment_state_before = (
            snapshot_assignment_state(cursor, org_name)
            if owner_type == "organization"
            else {}
        )

        try:
            effective_batch_limit = (
                _generated_aggregate_batch_limit()
                if aggregate_version_command
                else batch_limit
            )
            augment_default_assignments(
                cursor,
                transaction_context,
                data,
                batch_limit=effective_batch_limit,
                measure_batch=_sync_batch_size,
            )
        except SyncBatchLimitExceeded as limit_error:
            conn.rollback()
            return error_response(
                request,
                "SYNC_BATCH_TOO_LARGE",
                "Số lượng bản ghi đồng bộ vượt quá giới hạn cho phép.",
                status_code=413,
                fields={
                    "maxItems": limit_error.max_items,
                    "receivedItems": limit_error.received_items,
                },
            )



        batch_sync_version = next_sync_version(cursor, org_name)
        get_clean_id = clean_sync_record_id
        mutation_tracker = SyncMutationTracker(
            get_clean_id,
            client_mutation_id=client_mutation_id,
            request_id=get_request_id(request),
        )
        record_serializer = SyncRecordSerializer(
            transaction_context,
            sync_version=batch_sync_version,
            newly_written_images=newly_written_images,
            mutation_tracker=mutation_tracker,
            clean_record_id=get_clean_id,
            schema_definition=SCHEMA_DINH_NGHIA,
            money_columns=MONEY_COLUMNS,
            field_name_for_column=json_key_for_column,
            payload_value_for_column=get_payload_value,
        )
        record_writer = SyncRecordWriter(
            transaction_context,
            sync_version=batch_sync_version,
            mutation_tracker=mutation_tracker,
            clean_record_id=get_clean_id,
            ownership_scoped_tables=OWNERSHIP_SCOPED_TABLES,
            defer_latest_flag=defer_version_latest_flag,
            map_database_record=map_db_to_json,
            save_children=save_child_payloads,
        )

        sync_item_errors = []
        public_correlation_id = get_request_id(request)


        payload_index = SyncPayloadIndex.build(data, get_clean_id)
        record_validator = SyncRecordValidator(
            transaction_context,
            data,
            payload_index,
            mutation_tracker,
            clean_record_id=get_clean_id,
            schema_definition=SCHEMA_DINH_NGHIA,
            iter_payloads=iter_sync_table_payloads,
            canonicalize_item=canonicalize_payload_item,
            server_inherited_assignment_ids=server_inherited_assignment_ids,
            trusted_import_package_ids=trusted_import_package_ids,
        )
        validation_errors = record_validator.validate_payload()

        if validation_errors:
            log_error(f"Validation errors during sync: {validation_errors}", "SyncAPI")
            conn.rollback()
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

        for payload_key, table_name, items in iter_sync_table_payloads(data):
            for item in items:
                item_id_for_skip = get_clean_id(table_name, item.get("id")) if isinstance(item, dict) else None
                if payload_index.should_skip(table_name, item_id_for_skip):
                    continue
                item = canonicalize_payload_item(table_name, item)
                incoming_record_id = get_clean_id(table_name, item.get("id"))
                previous_record = payload_index.stored_record(
                    table_name,
                    incoming_record_id,
                )
                if aggregate_version_command:
                    db_row_data = record_serializer.serialize(
                        table_name,
                        item,
                        previous_record,
                    )
                    write_result = record_writer.write(
                        payload_key=payload_key,
                        table_name=table_name,
                        item=item,
                        db_row_data=db_row_data,
                        previous_record=previous_record,
                    )
                    if write_result.conflict_error:
                        sync_item_errors.append(write_result.conflict_error)
                    continue
                cursor.execute("SAVEPOINT sync_item")
                try:
                    db_row_data = record_serializer.serialize(
                        table_name,
                        item,
                        previous_record,
                    )

                    write_result = record_writer.write(
                        payload_key=payload_key,
                        table_name=table_name,
                        item=item,
                        db_row_data=db_row_data,
                        previous_record=previous_record,
                    )
                    if write_result.conflict_error:
                        sync_item_errors.append(write_result.conflict_error)
                        cursor.execute("ROLLBACK TO SAVEPOINT sync_item")
                        cursor.execute("RELEASE SAVEPOINT sync_item")
                        continue
                    cursor.execute("RELEASE SAVEPOINT sync_item")
                except Exception as item_err:
                    item_id = get_clean_id(table_name, item.get('id'))

                    try:
                        cursor.execute("ROLLBACK TO SAVEPOINT sync_item")
                        cursor.execute("RELEASE SAVEPOINT sync_item")
                    except DatabaseError as savepoint_error:
                        error = public_sync_item_error(
                            item_err,
                            table_name=table_name,
                            record_id=item_id,
                            correlation_id=public_correlation_id,
                        )
                        log_sync_error(
                            f"Không thể phục hồi transaction sau lỗi bản ghi {item_id}: "
                            f"{savepoint_error}"
                        )
                        return rollback_sync_response(
                            conn,
                            [error],
                            "Không thể đồng bộ vì có bản ghi không hợp lệ.",
                            status_code=400,
                            correlation_id=public_correlation_id,
                        )

                    if (
                        isinstance(item_err, IntegrityError)
                        and getattr(item_err, "sqlstate", None) == "23503"
                        and item_id
                        and table_name in ALLOWED_ORPHAN_TABLES
                    ):
                        cursor.execute("SAVEPOINT sync_orphan_cleanup")
                        try:
                            cursor.execute(
                                DELETED_RECORD_UPSERT_SQL,
                                (table_name, item_id, org_name, current_time, batch_sync_version)
                            )
                            mutation_tracker.record_orphan(table_name, item_id)
                            cursor.execute("RELEASE SAVEPOINT sync_orphan_cleanup")
                        except DatabaseError as orphan_cleanup_error:
                            cursor.execute("ROLLBACK TO SAVEPOINT sync_orphan_cleanup")
                            cursor.execute("RELEASE SAVEPOINT sync_orphan_cleanup")
                            log_sync_error(f"Không thể đánh dấu bản ghi mồ côi {item_id}: {orphan_cleanup_error}")
                    else:
                        log_sync_error(f"Lỗi đồng bộ bản ghi trong bảng {table_name} (ID: {item.get('id')}): {item_err}\n{traceback.format_exc()}")
                        sync_item_errors.append(public_sync_item_error(
                            item_err,
                            table_name=table_name,
                            record_id=item_id,
                            correlation_id=public_correlation_id,
                        ))


        deletion_result = apply_sync_deletions(
            cursor,
            data.get("deletions", []),
            organization_id=org_name,
            actor_role=role_str,
            actor_user_id=user_id,
            current_time=current_time,
            sync_version=batch_sync_version,
            clean_record_id=get_clean_id,
            ip_address=get_client_ip(request),
            client_mutation_id=client_mutation_id,
        )
        sync_item_errors.extend(deletion_result["errors"])
        mutation_tracker.merge_deletion_result(deletion_result)
        mutation_tracker.apply_recalculations(
            cursor,
            org_name,
            recalculate_latest=recalculate_is_latest,
            recalculate_plan_total=recalculate_tong_muc_dau_tu,
        )

        assignment_state_after = {}
        if owner_type == "organization" and not sync_item_errors:
            assignment_state_after = snapshot_assignment_state(cursor, org_name)

        if sync_item_errors:
            conflict = any(error.get("code") == "ROW_VERSION_CONFLICT" for error in sync_item_errors)
            return rollback_sync_response(
                conn,
                sync_item_errors,
                "Không thể đồng bộ vì có bản ghi không hợp lệ.",
                status_code=409 if conflict else 400,
                correlation_id=public_correlation_id,
            )

        if owner_type == "organization":
            insert_assignment_removal_history(
                cursor,
                organization_id=org_name,
                actor_user_id=user_id,
                occurred_at=current_time,
                before=assignment_state_before,
                after=assignment_state_after,
            )
            mutation_tracker.extend_activity(build_assignment_activity_events(
                assignment_state_before,
                assignment_state_after,
                client_mutation_id=client_mutation_id,
            ))
            queue_assignment_state_changes(
                cursor,
                organization_id=org_name,
                before=assignment_state_before,
                after=assignment_state_after,
            )

        insert_mutation_audit_events(
            cursor,
            organization_id=org_name,
            actor_user_id=user_id,
            ip_address=get_client_ip(request),
            events=mutation_tracker.audit_events,
        )
        insert_activity_events(
            cursor,
            organization_id=org_name,
            owner_type=owner_type,
            actor_user_id=user_id,
            occurred_at=current_time,
            events=mutation_tracker.activity_events,
        )

        procurement_import_result = persist_import_session_provenance(
            cursor,
            data,
            organization_id=org_name,
            user_id=user_id,
        )

        mutation_outcome = mutation_tracker.outcome()
        response_data = commit_sync_response(
            conn,
            cursor,
            organization_id=org_name,
            actor_user_id=user_id,
            actor_role=role_str,
            current_time=current_time,
            client_mutation_id=client_mutation_id,
            request_hash=mutation_request_hash or None,
            include_dashboard_summary=data.get("includeDashboardSummary") is True,
            updated_row_versions=mutation_outcome.updated_row_versions,
            delete_impacts=mutation_outcome.delete_impacts,
            orphaned_ids=mutation_outcome.orphaned_ids,
            procurement_import=procurement_import_result,
        )
        transaction_committed = True
        return _run_post_commit_side_effects(
            SyncPostCommitContext(
                transaction=transaction_context,
                envelope=envelope,
                response_data=response_data,
                image_cleanup_candidates=mutation_outcome.image_cleanup_candidates,
                newly_written_images=frozenset(newly_written_images),
                staged_assets=tuple(staged_assets),
            ),
            broadcast_callback=broadcast_callback,
            clean_record_id=get_clean_id,
            log_sync_error=log_sync_error,
        )
    except AggregateVersionConflict as conflict:
        if conn:
            conn.rollback()
        return error_response(
            request,
            "ROW_VERSION_CONFLICT",
            "Bản ghi nguồn đã thay đổi trên máy chủ.",
            status_code=409,
            fields={"currentVersion": conflict.current_version},
        )
    except LookupError as lookup_error:
        if conn:
            conn.rollback()
        code = str(lookup_error.args[0]) if lookup_error.args else ""
        if code in {"PROCUREMENT_SESSION_EXPIRED", "PROCUREMENT_REVISION_INVALID"}:
            return error_response(
                request,
                code,
                (
                    "Phiên nhập đã hết hạn hoặc không còn tồn tại."
                    if code == "PROCUREMENT_SESSION_EXPIRED"
                    else "Phiên bản nguồn không hợp lệ."
                ),
                status_code=410 if code == "PROCUREMENT_SESSION_EXPIRED" else 400,
            )
        return error_response(
            request,
            "VERSION_SOURCE_NOT_FOUND",
            "Không tìm thấy bản ghi nguồn để tạo phiên bản.",
            status_code=404,
        )
    except (ValueError, ImportConflict) as validation_error:
        if conn:
            conn.rollback()
        if not aggregate_version_command:
            code = str(validation_error.args[0]) if validation_error.args else ""
            procurement_errors = {
                "PROCUREMENT_INVESTOR_RESOLUTION_FAILED": (400, "Không thể xác định Chủ đầu tư từ dữ liệu nguồn."),
                "PROCUREMENT_MATCH_AMBIGUOUS": (409, "Không thể ghép chính xác gói thầu với dữ liệu nguồn."),
                "PROCUREMENT_SOURCE_VERSION_CONFLICT": (409, "Phiên bản nguồn không khớp với thứ tự nhập hiện tại."),
                "PROCUREMENT_REVISION_INVALID": (400, "Phiên bản nguồn không hợp lệ."),
            }
            if code in procurement_errors:
                status_code, message = procurement_errors[code]
                return error_response(
                    request, code, message, status_code=status_code,
                )
            log_sync_error(
                "Lỗi tổng quát sync_api: "
                f"{validation_error}\n{traceback.format_exc()}"
            )
            return JSONResponse(
                {"error": "Đồng bộ dữ liệu thất bại. Vui lòng thử lại."},
                status_code=500,
            )
        if isinstance(validation_error, AggregateVersionPolicyError):
            return error_response(
                request,
                validation_error.code,
                str(validation_error),
                status_code=400,
            )
        return error_response(
            request,
            "INVALID_VERSION_COMMAND",
            str(validation_error),
            status_code=400,
        )
    except OrgPermissionError:
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
        if aggregate_version_command and getattr(e, "sqlstate", None) in {
            "40001",
            "40P01",
        }:
            return error_response(
                request,
                "VERSION_CREATION_CONFLICT",
                "Có thay đổi đồng thời khi tạo phiên bản. Vui lòng tải lại và thử lại.",
                status_code=409,
            )
        log_sync_error(f"Lỗi tổng quát sync_api: {e}\n{traceback.format_exc()}")
        return JSONResponse({"error": "Đồng bộ dữ liệu thất bại. Vui lòng thử lại."}, status_code=500)
    finally:
        if conn:
            try:
                conn.close()
            except DatabaseError:
                pass
        if not transaction_committed:
            discard_staged_assets(staged_assets)
            _cleanup_rolled_back_images(newly_written_images, log_sync_error)
