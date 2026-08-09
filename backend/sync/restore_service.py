"""Explicit, authorized and idempotent restore command for sync tombstones."""

from __future__ import annotations

import json
from typing import Any

from starlette.responses import JSONResponse

from backend.shared.access_policy import (
    is_organization_manager,
    is_personal_workspace_owner,
)
from backend.shared.audit_chain import insert_audit_row
from backend.shared.client_ip import get_client_ip
from backend.shared.helpers import SCHEMA_DINH_NGHIA, database, get_active_org, verify_session
from backend.shared.idempotency import acquire_idempotency_lock
from backend.shared.request_validation import read_json_object
from backend.shared.database_io import run_database_write
from backend.shared.workspace_scope import (
    is_personal_scope_for_user,
    lock_personal_workspace_mutations,
)
from backend.sync.idempotency import request_hash_matches, sync_request_hash
from backend.sync.mapper import map_db_to_json
from backend.sync.queries import TABLE_KEYS
from backend.sync.repository import next_sync_version
from backend.sync.conflict_projection import project_conflict_record
from backend.sync.websocket import enqueue_websocket_event


RESTORABLE_TABLES = frozenset(TABLE_KEYS.values()) - {"ma_tran_phan_quyen"}


def _result(code: str, message: str, *, status: str = "rejected", **fields):
    return {"status": status, "code": code, "message": message, **fields}


def _table_name(table: object) -> str | None:
    value = str(table or "").strip()
    if value in TABLE_KEYS:
        value = TABLE_KEYS[value]
    return value if value in RESTORABLE_TABLES else None


def restore_tombstoned_record(
    cursor,
    *,
    organization_id: str,
    actor_user_id: str,
    actor_role,
    table: str,
    record_id: str,
    reason: str,
    expected_delete_version: int,
    client_mutation_id: str,
    ip_address: str | None = None,
) -> dict[str, Any]:
    """Restore one record without committing; caller owns the transaction."""

    table_name = _table_name(table)
    record_id = str(record_id or "").strip()
    reason = str(reason or "").strip()
    mutation_id = str(client_mutation_id or "").strip()
    if not table_name or not record_id:
        return _result("RESTORE_TARGET_INVALID", "Đối tượng phục hồi không hợp lệ.")
    if not reason or len(reason) > 500:
        return _result(
            "RESTORE_REASON_REQUIRED",
            "Lý do phục hồi là bắt buộc và không được vượt quá 500 ký tự.",
        )
    if not mutation_id or len(mutation_id) > 128:
        return _result(
            "MUTATION_ID_REQUIRED",
            "clientMutationId hợp lệ là bắt buộc cho phục hồi.",
        )
    if isinstance(expected_delete_version, bool):
        return _result("RESTORE_VERSION_INVALID", "Phiên bản xóa không hợp lệ.")
    try:
        expected_version = int(expected_delete_version)
    except (TypeError, ValueError):
        return _result("RESTORE_VERSION_INVALID", "Phiên bản xóa không hợp lệ.")
    if expected_version <= 0:
        return _result("RESTORE_VERSION_INVALID", "Phiên bản xóa không hợp lệ.")

    if is_personal_scope_for_user(organization_id, actor_user_id):
        lock_personal_workspace_mutations(cursor, organization_id)
    privileged = bool(
        is_organization_manager(
            cursor,
            actor_role,
            actor_user_id,
            organization_id,
        )
        or is_personal_workspace_owner(cursor, actor_user_id, organization_id)
    )
    if not privileged:
        return _result(
            "RESTORE_PERMISSION_REQUIRED",
            "Chỉ người có quyền phục hồi hồ sơ mới được thực hiện thao tác này.",
        )
    command_payload = {
        "table": table_name,
        "id": record_id,
        "reason": reason,
        "expectedDeleteVersion": expected_version,
        "clientMutationId": mutation_id,
    }
    request_hash = sync_request_hash({"restore": command_payload})
    acquire_idempotency_lock(
        cursor,
        "restore",
        organization_id,
        actor_user_id,
        mutation_id,
    )
    existing_mutation = cursor.execute(
        """SELECT response_json, request_hash FROM sync_mutations
           WHERE organization_id = ? AND actor_user_id = ?
             AND client_mutation_id = ?""",
        (organization_id, actor_user_id, mutation_id),
    ).fetchone()
    if existing_mutation:
        if not request_hash_matches(existing_mutation[1], request_hash):
            return _result(
                "IDEMPOTENCY_KEY_REUSED",
                "Mã thay đổi đã được dùng cho một nội dung khác.",
            )
        return json.loads(existing_mutation[0])

    tombstone = cursor.execute(
        """SELECT delete_version, record_snapshot_json
           FROM deleted_records
           WHERE organization_id = ? AND table_name = ? AND record_id = ?
           FOR UPDATE""",
        (organization_id, table_name, record_id),
    ).fetchone()
    if not tombstone:
        return _result("RESTORE_NOT_FOUND", "Không tìm thấy bản ghi có thể phục hồi.")
    delete_version = int(tombstone[0] or 0)
    if delete_version != expected_version:
        return _result(
            "RESTORE_VERSION_CONFLICT",
            "Bản ghi xóa đã thay đổi; cần tải lại trước khi phục hồi.",
        )
    try:
        snapshot = json.loads(tombstone[1] or "")
    except (TypeError, json.JSONDecodeError):
        snapshot = None
    if not isinstance(snapshot, dict):
        return _result(
            "RESTORE_SNAPSHOT_UNAVAILABLE",
            "Bản ghi được xóa trước khi hệ thống lưu bằng chứng phục hồi.",
        )

    sync_version = next_sync_version(cursor, organization_id)
    existing = cursor.execute(
        f"SELECT * FROM {table_name} WHERE organization_id = ? AND id = ? FOR UPDATE",  # noqa: S608 - validated schema table
        (organization_id, record_id),
    ).fetchone()
    if existing:
        existing_dict = dict(existing)
        if not existing_dict.get("archived_at"):
            return _result(
                "RESTORE_TARGET_EXISTS",
                "Đã có bản ghi hoạt động với cùng định danh.",
            )
        assignments = [
            "archived_at = NULL",
            "sync_version = ?",
            "row_version = row_version + 1",
            "updated_at = CURRENT_TIMESTAMP",
        ]
        if "is_latest" in SCHEMA_DINH_NGHIA[table_name]["columns"]:
            assignments.append("is_latest = 1")
        cursor.execute(
            f"UPDATE {table_name} SET {', '.join(assignments)} WHERE organization_id = ? AND id = ?",  # noqa: S608 - validated schema identifiers
            (sync_version, organization_id, record_id),
        )
    else:
        columns = SCHEMA_DINH_NGHIA[table_name]["columns"]
        restored = {key: value for key, value in snapshot.items() if key in columns}
        restored["id"] = record_id
        restored["organization_id"] = organization_id
        if "archived_at" in columns:
            restored["archived_at"] = None
        if "sync_version" in columns:
            restored["sync_version"] = sync_version
        if "row_version" in columns:
            restored["row_version"] = int(snapshot.get("row_version") or 0) + 1
        if "is_latest" in columns:
            restored["is_latest"] = 1
        restored.pop("updated_at", None)
        column_sql = ", ".join(restored)
        placeholders = ", ".join("?" for _ in restored)
        cursor.execute(
            f"INSERT INTO {table_name} ({column_sql}) VALUES ({placeholders})",  # noqa: S608 - validated schema identifiers
            tuple(restored.values()),
        )

    cursor.execute(
        """DELETE FROM deleted_records
           WHERE organization_id = ? AND table_name = ? AND record_id = ?""",
        (organization_id, table_name, record_id),
    )
    insert_audit_row(
        cursor,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        action="sync.record_restored",
        target_type=table_name,
        target_id=record_id,
        ip_address=ip_address,
        metadata_json=json.dumps(
            {
                "reason": reason,
                "clientMutationId": mutation_id,
                "deleteVersion": delete_version,
            },
            ensure_ascii=False,
        ),
    )
    restored_row = dict(cursor.execute(
        f"SELECT * FROM {table_name} WHERE organization_id = ? AND id = ?",  # noqa: S608 - validated schema table
        (organization_id, record_id),
    ).fetchone())
    response = {
        "status": "restored",
        "code": "RECORD_RESTORED",
        "clientMutationId": mutation_id,
        "record": project_conflict_record(map_db_to_json(table_name, restored_row)),
    }
    cursor.execute(
        """INSERT INTO sync_mutations
           (organization_id, actor_user_id, client_mutation_id, request_hash, response_json)
           VALUES (?, ?, ?, ?, ?)""",
        (
            organization_id,
            actor_user_id,
            mutation_id,
            request_hash,
            json.dumps(response, ensure_ascii=False, default=str),
        ),
    )
    return response


def _execute_restore_request(request, payload):
    valid, role_or_error = verify_session(request)
    if not valid:
        return JSONResponse({"code": "AUTH_REQUIRED", "message": str(role_or_error)}, status_code=403)
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        organization_id = get_active_org(request, role_or_error.user_id, cursor=cursor)
        result = restore_tombstoned_record(
            cursor,
            organization_id=organization_id,
            actor_user_id=role_or_error.user_id,
            actor_role=role_or_error,
            table=payload.get("table"),
            record_id=payload.get("id"),
            reason=payload.get("reason"),
            expected_delete_version=payload.get("expectedDeleteVersion"),
            client_mutation_id=payload.get("clientMutationId"),
            ip_address=get_client_ip(request),
        )
        status_code = {
            "restored": 200,
            "RESTORE_PERMISSION_REQUIRED": 403,
            "RESTORE_NOT_FOUND": 404,
            "RESTORE_VERSION_CONFLICT": 409,
            "IDEMPOTENCY_KEY_REUSED": 409,
            "RESTORE_TARGET_EXISTS": 409,
        }.get(result.get("code"), 400)
        if result.get("status") == "restored":
            enqueue_websocket_event(
                cursor,
                "broadcast",
                organization_id=organization_id,
                payload={"event": "db_changed"},
            )
            connection.commit()
        else:
            connection.rollback()
        return JSONResponse(result, status_code=status_code)
    finally:
        connection.close()


async def process_restore_request(request, broadcast_callback=None):
    payload, error = await read_json_object(request)
    if error:
        return error
    del broadcast_callback
    return await run_database_write(_execute_restore_request, request, payload)
