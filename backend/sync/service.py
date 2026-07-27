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
    save_base64_image,
    verify_session,
)
from backend.shared.idempotency import acquire_idempotency_lock
from backend.shared.access_policy import OWNERSHIP_SCOPED_TABLES
from backend.shared.client_ip import get_client_ip
from backend.shared.logging_utils import error_response, get_request_id
from backend.observability.recording import record_database_phase
from backend.shared.date_utils import vietnam_now_sql
from backend.shared.media_helper import (
    delete_managed_image_files,
    find_unreferenced_image_paths,
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
from backend.shared.workspace_scope import is_personal_scope_for_user
from backend.sync.queries import ALLOWED_ORPHAN_TABLES
from backend.sync.ownership import get_owner_type
from backend.sync.deletion_service import apply_sync_deletions
from backend.sync.repository import (
    DELETED_RECORD_UPSERT_SQL,
    defer_version_latest_flag,
    next_sync_version,
)
from backend.sync.serializer import iter_sync_table_payloads, rollback_sync_response
from backend.sync.payload_validation import validate_sync_payload_shape


from backend.sync.request_contract import (
    sync_batch_limit as _sync_batch_limit,
    sync_batch_size as _sync_batch_size,
)
from backend.sync.response import commit_sync_response
from backend.shared.async_io import BlockingIOBusyError
from backend.shared.database_io import run_database_write
from backend.shared.request_validation import read_json_object
from backend.notifications.service import (
    find_unreplaced_assignment_removals,
    queue_assignment_state_changes,
    snapshot_assignment_state,
)


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


def _persist_incoming_images(data, newly_written_images, organization_id):
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
                    tenant_id=organization_id,
                )
                original_item[json_key] = managed_path
                newly_written_images.add(managed_path)


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
    ), None


def _prepare_sync_transaction(connection, cursor, actor, envelope, log_sync_error):
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

    if broadcast_callback:
        broadcast_callback(organization_id, {"event": "db_changed"})
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


def execute_sync_mutation(request, data, broadcast_callback=None):
    """
    [POST] /api/sync
    Đồng bộ dữ liệu thay đổi từ ứng dụng Frontend vào cơ sở dữ liệu PostgreSQL.
    """
    def log_sync_error(msg):
        log_error(msg, "SyncAPI", request_id=get_request_id(request))

    conn = None
    transaction_committed = False
    newly_written_images = set()
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

        _persist_incoming_images(data, newly_written_images, org_name)

        conn = database.get_connection()
        conn.execute("BEGIN")
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

        assignment_state_before = (
            snapshot_assignment_state(cursor, org_name)
            if owner_type == "organization"
            else {}
        )

        try:
            augment_default_assignments(
                cursor,
                transaction_context,
                data,
                batch_limit=batch_limit,
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
        mutation_tracker = SyncMutationTracker(get_clean_id)
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
                        error = {
                            "table": table_name,
                            "id": item.get("id"),
                            "message": str(item_err),
                        }
                        log_sync_error(
                            f"Không thể phục hồi transaction sau lỗi bản ghi {item_id}: "
                            f"{savepoint_error}"
                        )
                        return rollback_sync_response(
                            conn,
                            [error],
                            "Không thể đồng bộ vì có bản ghi không hợp lệ.",
                            status_code=400,
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
            current_time=current_time,
            sync_version=batch_sync_version,
            clean_record_id=get_clean_id,
            ip_address=get_client_ip(request),
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
            for missing_assignment in find_unreplaced_assignment_removals(
                cursor,
                organization_id=org_name,
                before=assignment_state_before,
                after=assignment_state_after,
            ):
                sync_item_errors.append({
                    "table": "phan_cong_nhan_su",
                    "id": missing_assignment["target_id"],
                    "field": "id_nhan_vien",
                    "code": "ASSIGNMENT_SUCCESSOR_REQUIRED",
                    "message": (
                        "Không thể hủy phân công khi công việc vẫn tồn tại. "
                        "Phải chọn một nhân sự khác tiếp quản trong cùng thao tác."
                    ),
                })

        if sync_item_errors:
            conflict = any(error.get("code") == "ROW_VERSION_CONFLICT" for error in sync_item_errors)
            return rollback_sync_response(
                conn,
                sync_item_errors,
                "Không thể đồng bộ vì có bản ghi không hợp lệ.",
                status_code=409 if conflict else 400,
            )

        if owner_type == "organization":
            queue_assignment_state_changes(
                cursor,
                organization_id=org_name,
                before=assignment_state_before,
                after=assignment_state_after,
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
        )
        transaction_committed = True
        return _run_post_commit_side_effects(
            SyncPostCommitContext(
                transaction=transaction_context,
                envelope=envelope,
                response_data=response_data,
                image_cleanup_candidates=mutation_outcome.image_cleanup_candidates,
                newly_written_images=frozenset(newly_written_images),
            ),
            broadcast_callback=broadcast_callback,
            clean_record_id=get_clean_id,
            log_sync_error=log_sync_error,
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
        if not transaction_committed:
            _cleanup_rolled_back_images(newly_written_images, log_sync_error)
