"""Strict HTTP adapter for durable conflict drafts and explicit resolution."""

from __future__ import annotations

import json
import os

from starlette.responses import JSONResponse

from backend.shared.access_policy import authorize_record_write
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import OrgPermissionError, database, get_active_org, verify_session
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.client_ip import get_client_ip
from backend.shared.audit_chain import insert_audit_row
from backend.sync.conflict_projection import project_conflict_record
from backend.sync.mapper import map_db_to_json
from backend.sync.service import execute_sync_mutation
from backend.sync.visibility_scope import VisibilityScope
from backend.sync.websocket import broadcast_websocket_event

from .authority import canonical_digest
from .policy_registry import POLICY_VERSION, get_conflict_policy
from .service import ConflictResolutionError, ConflictResolutionService
from .storage import ConflictDraftRepository, DraftStorageError


CONFLICT_CENTER_ENABLED = os.environ.get(
    "CONFLICT_CENTER_ENABLED",
    "false",
).strip().casefold() == "true"

_CAPTURE_FIELDS = {
    "entityType", "tableName", "recordId", "workspaceFingerprint", "batchId",
    "mutationId", "expectedRowVersion", "baseSnapshot", "localIntent",
}
_RESOLVE_FIELDS = {
    "workspaceFingerprint", "resolutionAuthority", "decisions", "clientMutationId",
}


def _invalid(request, fields):
    return error_response(
        request, "CONFLICT_REQUEST_INVALID", "Yêu cầu xử lý xung đột không hợp lệ.",
        status_code=400, fields=fields,
    )


def _bounded_text(value, *, maximum=200):
    text = str(value or "").strip()
    return text if text and len(text) <= maximum else ""


def _parse_capture(payload):
    if not isinstance(payload, dict):
        raise ConflictResolutionError("CONFLICT_REQUEST_INVALID", fields={"body": "EXPECTED_OBJECT"})
    errors = {key: "UNKNOWN_FIELD" for key in payload if key not in _CAPTURE_FIELDS}
    result = {}
    for key, maximum in (
        ("entityType", 30), ("tableName", 80), ("recordId", 200),
        ("workspaceFingerprint", 200), ("batchId", 200), ("mutationId", 200),
    ):
        result[key] = _bounded_text(payload.get(key), maximum=maximum)
        if not result[key]:
            errors[key] = "INVALID_VALUE"
    expected = payload.get("expectedRowVersion")
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 1:
        errors["expectedRowVersion"] = "EXPECTED_POSITIVE_INTEGER"
    result["expectedRowVersion"] = expected
    for key in ("baseSnapshot", "localIntent"):
        if not isinstance(payload.get(key), dict):
            errors[key] = "EXPECTED_OBJECT"
        result[key] = payload.get(key)
    if errors:
        raise ConflictResolutionError("CONFLICT_REQUEST_INVALID", fields=errors)
    return result


def _parse_resolve(payload):
    if not isinstance(payload, dict):
        raise ConflictResolutionError("CONFLICT_REQUEST_INVALID", fields={"body": "EXPECTED_OBJECT"})
    errors = {key: "UNKNOWN_FIELD" for key in payload if key not in _RESOLVE_FIELDS}
    result = {}
    for key, maximum in (
        ("workspaceFingerprint", 200), ("resolutionAuthority", 5000),
        ("clientMutationId", 128),
    ):
        result[key] = _bounded_text(payload.get(key), maximum=maximum)
        if not result[key]:
            errors[key] = "INVALID_VALUE"
    if not isinstance(payload.get("decisions"), dict):
        errors["decisions"] = "EXPECTED_OBJECT"
    result["decisions"] = payload.get("decisions")
    if errors:
        raise ConflictResolutionError("CONFLICT_REQUEST_INVALID", fields=errors)
    return result


def _request_context(request, cursor, workspace_fingerprint):
    valid, role = verify_session(request)
    if not valid:
        raise ConflictResolutionError("SESSION_REQUIRED", status_code=403)
    organization_id = get_active_org(request, role.user_id, cursor=cursor)
    return role, {
        "organizationId": str(organization_id),
        "actorUserId": str(role.user_id),
        "workspaceFingerprint": workspace_fingerprint,
    }


def _load_authorized_record(cursor, role, scope, entity_type, record_id):
    policy = get_conflict_policy(entity_type)
    if policy is None:
        raise ConflictResolutionError("UNSUPPORTED_CONFLICT_ENTITY")
    decision = authorize_record_write(
        cursor, role, role.user_id, scope["organizationId"],
        policy.payload_key, policy.table_name, {"id": record_id},
    )
    if not decision.allowed:
        raise ConflictResolutionError("CONFLICT_RECORD_ACCESS_DENIED", status_code=403)
    visibility = VisibilityScope.resolve(cursor, role, role.user_id, scope["organizationId"])
    predicate = visibility.live_predicate(policy.table_name, "record_row")
    row = cursor.execute(
        f"""SELECT record_row.* FROM {policy.table_name} AS record_row
             WHERE record_row.id = ? AND ({predicate.sql}) LIMIT 1""",  # noqa: S608 - table/predicate from fixed registries
        (record_id, *predicate.parameters),
    ).fetchone()
    if not row:
        raise ConflictResolutionError("CONFLICT_RECORD_NOT_FOUND", status_code=404)
    return project_conflict_record(map_db_to_json(policy.table_name, dict(row)))


def _capture_blocking(request, arguments):
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        cursor = conn.cursor()
        role, scope = _request_context(request, cursor, arguments["workspaceFingerprint"])
        server = _load_authorized_record(
            cursor, role, scope, arguments["entityType"], arguments["recordId"]
        )
        service = ConflictResolutionService(ConflictDraftRepository(cursor))
        result = service.capture(scope=scope, request=arguments, server_record=server)
        conn.commit()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _preview_blocking(request, draft_id, workspace_fingerprint):
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        role, scope = _request_context(request, cursor, workspace_fingerprint)
        repository = ConflictDraftRepository(cursor)
        metadata = repository.get_metadata(
            organization_id=scope["organizationId"], actor_user_id=scope["actorUserId"],
            workspace_fingerprint=workspace_fingerprint, draft_id=draft_id,
        )
        if metadata is None:
            raise ConflictResolutionError("CONFLICT_DRAFT_NOT_FOUND", status_code=404)
        server = _load_authorized_record(
            cursor, role, scope, metadata["entityType"], metadata["recordId"]
        )
        return ConflictResolutionService(repository).preview(
            scope=scope, draft_id=draft_id, current_server_record=server
        )
    finally:
        conn.close()


def _list_blocking(request, workspace_fingerprint):
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        cursor = conn.cursor()
        role, scope = _request_context(request, cursor, workspace_fingerprint)
        repository = ConflictDraftRepository(cursor)
        visible = []
        for metadata in repository.list_active(
            organization_id=scope["organizationId"], actor_user_id=scope["actorUserId"],
            workspace_fingerprint=workspace_fingerprint,
        ):
            try:
                _load_authorized_record(
                    cursor, role, scope, metadata["entityType"], metadata["recordId"]
                )
            except ConflictResolutionError:
                continue
            visible.append(metadata)
        conn.commit()
        return visible
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _prepare_resolution_blocking(request, draft_id, arguments):
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        role, scope = _request_context(request, cursor, arguments["workspaceFingerprint"])
        repository = ConflictDraftRepository(cursor)
        metadata = repository.get_metadata(
            organization_id=scope["organizationId"], actor_user_id=scope["actorUserId"],
            workspace_fingerprint=arguments["workspaceFingerprint"], draft_id=draft_id,
        )
        if metadata is None:
            raise ConflictResolutionError("CONFLICT_DRAFT_NOT_FOUND", status_code=404)
        server = _load_authorized_record(
            cursor, role, scope, metadata["entityType"], metadata["recordId"]
        )
        mutation = ConflictResolutionService(repository).build_resolution(
            scope=scope, draft_id=draft_id, current_server_record=server,
            authority=arguments["resolutionAuthority"], decisions=arguments["decisions"],
            client_mutation_id=arguments["clientMutationId"],
        )
        return scope, mutation
    finally:
        conn.close()


def _mark_resolved_blocking(request, scope, draft_id, mutation_id, decisions):
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        cursor = conn.cursor()
        role, current_scope = _request_context(request, cursor, scope["workspaceFingerprint"])
        if current_scope != scope:
            raise ConflictResolutionError("CONFLICT_RECORD_ACCESS_DENIED", status_code=403)
        repository = ConflictDraftRepository(cursor)
        metadata = repository.get_metadata(
            organization_id=scope["organizationId"], actor_user_id=scope["actorUserId"],
            workspace_fingerprint=scope["workspaceFingerprint"], draft_id=draft_id,
        )
        if metadata:
            _load_authorized_record(cursor, role, scope, metadata["entityType"], metadata["recordId"])
        marked = repository.mark_resolved(
            organization_id=scope["organizationId"], actor_user_id=scope["actorUserId"],
            workspace_fingerprint=scope["workspaceFingerprint"], draft_id=draft_id,
            mutation_id=mutation_id,
        )
        if marked and metadata:
            insert_audit_row(
                cursor,
                actor_user_id=scope["actorUserId"],
                organization_id=scope["organizationId"],
                action="sync.conflict_resolved",
                target_type=metadata["tableName"],
                target_id=metadata["recordId"],
                ip_address=get_client_ip(request),
                metadata_json=json.dumps(
                    {
                        "draftId": draft_id,
                        "policyVersion": POLICY_VERSION,
                        "expectedRowVersion": metadata["expectedRowVersion"],
                        "previewedServerRowVersion": metadata["serverRowVersion"],
                        "payloadDigest": metadata["payloadDigest"],
                        "decisionDigest": canonical_digest(decisions),
                        "decisionPaths": sorted(str(field) for field in decisions),
                        "decisionSelections": {
                            str(field): str(choice)
                            for field, choice in sorted(decisions.items())
                        },
                        "resolutionMutationId": mutation_id,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _discard_blocking(request, draft_id, workspace_fingerprint):
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        cursor = conn.cursor()
        _role, scope = _request_context(request, cursor, workspace_fingerprint)
        deleted = ConflictDraftRepository(cursor).discard(
            organization_id=scope["organizationId"], actor_user_id=scope["actorUserId"],
            workspace_fingerprint=workspace_fingerprint, draft_id=draft_id,
        )
        conn.commit()
        return deleted
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


async def _payload(request):
    try:
        value = await request.json()
    except (TypeError, ValueError):
        raise ConflictResolutionError("CONFLICT_REQUEST_INVALID", fields={"body": "INVALID_JSON"})
    return value


def _error(request, error):
    return error_response(
        request, error.code, "Không thể xử lý bản nháp xung đột.",
        status_code=error.status_code, fields=error.fields or None,
    )


async def create_conflict_draft_api(request):
    if not CONFLICT_CENTER_ENABLED:
        return error_response(request, "CONFLICT_CENTER_DISABLED", "Tính năng chưa được bật.", status_code=404)
    try:
        arguments = _parse_capture(await _payload(request))
        result = await run_database_write(_capture_blocking, request, arguments)
        return JSONResponse(result, status_code=201, headers={"Cache-Control": "private, no-store"})
    except (ConflictResolutionError, DraftStorageError) as error:
        wrapped = error if isinstance(error, ConflictResolutionError) else ConflictResolutionError(str(error), status_code=409)
        return _error(request, wrapped)
    except OrgPermissionError:
        return _error(request, ConflictResolutionError("ORG_ACCESS_DENIED", status_code=403))
    except Exception as error:  # noqa: BLE001 - sanitized HTTP boundary.
        return log_and_error(request, error, "conflict_draft_create", "CONFLICT_DRAFT_FAILED", "Không thể lưu bản nháp xung đột.")


async def list_conflict_drafts_api(request):
    if not CONFLICT_CENTER_ENABLED:
        return error_response(request, "CONFLICT_CENTER_DISABLED", "Tính năng chưa được bật.", status_code=404)
    workspace = _bounded_text(request.query_params.get("workspaceFingerprint"), maximum=200)
    if not workspace:
        return _invalid(request, {"workspaceFingerprint": "INVALID_VALUE"})
    try:
        items = await run_database_write(_list_blocking, request, workspace)
        return JSONResponse(
            {"items": items, "retentionDays": 30, "maxDrafts": 20, "autoReplay": False},
            headers={"Cache-Control": "private, no-store"},
        )
    except ConflictResolutionError as error:
        return _error(request, error)
    except OrgPermissionError:
        return _error(request, ConflictResolutionError("ORG_ACCESS_DENIED", status_code=403))
    except Exception as error:  # noqa: BLE001
        return log_and_error(request, error, "conflict_draft_list", "CONFLICT_LIST_FAILED", "Không thể tải danh sách xung đột.")


async def preview_conflict_draft_api(request):
    if not CONFLICT_CENTER_ENABLED:
        return error_response(request, "CONFLICT_CENTER_DISABLED", "Tính năng chưa được bật.", status_code=404)
    workspace = _bounded_text(request.query_params.get("workspaceFingerprint"), maximum=200)
    if not workspace:
        return _invalid(request, {"workspaceFingerprint": "INVALID_VALUE"})
    try:
        result = await run_database_read(
            _preview_blocking, request, str(request.path_params["draft_id"]), workspace,
            timeout_seconds=10,
        )
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
    except ConflictResolutionError as error:
        return _error(request, error)
    except OrgPermissionError:
        return _error(request, ConflictResolutionError("ORG_ACCESS_DENIED", status_code=403))
    except Exception as error:  # noqa: BLE001
        return log_and_error(request, error, "conflict_draft_preview", "CONFLICT_PREVIEW_FAILED", "Không thể mở bản nháp xung đột.")


async def resolve_conflict_draft_api(request):
    if not CONFLICT_CENTER_ENABLED:
        return error_response(request, "CONFLICT_CENTER_DISABLED", "Tính năng chưa được bật.", status_code=404)
    try:
        arguments = _parse_resolve(await _payload(request))
        draft_id = str(request.path_params["draft_id"])
        scope, mutation = await run_database_read(
            _prepare_resolution_blocking, request, draft_id, arguments, timeout_seconds=10,
        )
        response = await run_database_write(
            execute_sync_mutation, request, mutation, broadcast_websocket_event,
        )
        if 200 <= int(response.status_code) < 300:
            await run_database_write(
                _mark_resolved_blocking, request, scope, draft_id,
                arguments["clientMutationId"], arguments["decisions"],
            )
        return response
    except ConflictResolutionError as error:
        return _error(request, error)
    except OrgPermissionError:
        return _error(request, ConflictResolutionError("ORG_ACCESS_DENIED", status_code=403))
    except Exception as error:  # noqa: BLE001
        return log_and_error(request, error, "conflict_draft_resolve", "CONFLICT_RESOLUTION_FAILED", "Không thể áp dụng quyết định xung đột.")


async def delete_conflict_draft_api(request):
    if not CONFLICT_CENTER_ENABLED:
        return error_response(request, "CONFLICT_CENTER_DISABLED", "Tính năng chưa được bật.", status_code=404)
    workspace = _bounded_text(request.query_params.get("workspaceFingerprint"), maximum=200)
    if not workspace:
        return _invalid(request, {"workspaceFingerprint": "INVALID_VALUE"})
    try:
        deleted = await run_database_write(
            _discard_blocking, request, str(request.path_params["draft_id"]), workspace,
        )
        if not deleted:
            return _error(request, ConflictResolutionError("CONFLICT_DRAFT_NOT_FOUND", status_code=404))
        return JSONResponse({"status": "deleted"}, headers={"Cache-Control": "private, no-store"})
    except ConflictResolutionError as error:
        return _error(request, error)
    except OrgPermissionError:
        return _error(request, ConflictResolutionError("ORG_ACCESS_DENIED", status_code=403))
    except Exception as error:  # noqa: BLE001
        return log_and_error(request, error, "conflict_draft_delete", "CONFLICT_DELETE_FAILED", "Không thể xóa bản nháp xung đột.")


def conflict_resolution_routes(Route):
    return [
        Route("/api/conflict-drafts", create_conflict_draft_api, methods=["POST"]),
        Route("/api/conflict-drafts", list_conflict_drafts_api, methods=["GET"]),
        Route("/api/conflict-drafts/{draft_id}/preview", preview_conflict_draft_api, methods=["POST"]),
        Route("/api/conflict-drafts/{draft_id}/resolve", resolve_conflict_draft_api, methods=["POST"]),
        Route("/api/conflict-drafts/{draft_id}", delete_conflict_draft_api, methods=["DELETE"]),
    ]
