"""HTTP adapters for EXPORT_RECORD_DATA prepare/confirm/download/cancel."""

import os

from starlette.responses import FileResponse, JSONResponse

from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_write
from backend.shared.helpers import database, get_active_org, verify_session
from backend.shared.logging_utils import error_response, log_and_error, log_audit
from backend.sync.visibility_scope import VisibilityScope

from .service import BulkOperationError, BulkOperationService
from .storage import resolve_path


def bulk_operations_enabled(environ=None):
    environment = os.environ if environ is None else environ
    return str(environment.get("BULK_EXPORT_ENABLED", "false")).strip().casefold() == "true"


def _blocking(request, operation):
    valid, role = verify_session(request)
    if not valid:
        raise BulkOperationError("BULK_ACCESS_DENIED", status_code=403)
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        organization_id = get_active_org(request, role.user_id, cursor=cursor)
        result = operation(cursor, role, organization_id)
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _strict(value, allowed):
    if not isinstance(value, dict):
        raise BulkOperationError("BULK_REQUEST_INVALID")
    unknown = {key: "UNKNOWN_FIELD" for key in value if key not in allowed}
    if unknown:
        raise BulkOperationError("BULK_REQUEST_INVALID", fields=unknown)
    return value


def _key(request):
    value = str(request.headers.get("Idempotency-Key") or "").strip()
    if len(value) < 8 or len(value) > 160:
        raise BulkOperationError("BULK_IDEMPOTENCY_KEY_REQUIRED")
    return value


async def prepare_api(request):
    return await _handle_command(request, "prepare")


async def confirm_api(request):
    return await _handle_command(request, "confirm")


async def cancel_api(request):
    return await _handle_command(request, "cancel")


async def _handle_command(request, command):
    if not bulk_operations_enabled():
        return error_response(
            request, "BULK_OPERATION_DISABLED",
            "Trung tâm thao tác hàng loạt chưa được bật.", status_code=404,
        )
    try:
        if command == "prepare":
            body = _strict(await request.json(), {
                "actionKey", "targetType", "selectionMode", "recordIds",
            })
        else:
            body = _strict(await request.json(), set())
        operation_id = str(request.path_params.get("operation_id") or "").strip()

        def write(cursor, role, organization_id):
            service = BulkOperationService(cursor)
            visibility = VisibilityScope.resolve(
                cursor, role, role.user_id, organization_id
            )
            if command == "prepare":
                result = service.prepare(
                    organization_id, role.user_id, body.get("actionKey"),
                    body.get("targetType"), body.get("selectionMode"),
                    body.get("recordIds"), visibility,
                )
                action = "bulk_operation.prepared"
            elif command == "confirm":
                result, stale = service.confirm(
                    organization_id, role.user_id, operation_id,
                    _key(request), visibility,
                )
                if stale:
                    return {"stale": stale}
                action = "bulk_operation.completed"
            else:
                result = service.cancel(
                    organization_id, role.user_id, operation_id
                )
                action = "bulk_operation.cancelled"
            log_audit(
                action, actor_user_id=role.user_id,
                organization_id=organization_id, target_type="bulk_operation",
                target_id=result["operationId"], request=request,
                metadata={
                    "actionKey": result.get("actionKey", "EXPORT_RECORD_DATA"),
                    "selectionHash": result.get("selectionHash"),
                    "recordCount": result.get("recordCount", len(result.get("items", []))),
                    "artifactSha256": result.get("sha256"),
                }, cursor=cursor, required=True,
            )
            return result

        result = await run_database_write(_blocking, request, write)
        if result.get("stale"):
            return error_response(
                request, result["stale"], "Bản xem trước đã hết hiệu lực.",
                status_code=409,
            )
        return JSONResponse(result, status_code=201 if command != "cancel" else 200,
                            headers={"Cache-Control": "private, no-store"})
    except BulkOperationError as error:
        return error_response(
            request, error.code, "Yêu cầu thao tác hàng loạt không hợp lệ.",
            status_code=error.status_code, fields=error.fields,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return error_response(request, "DATABASE_BUSY", "Hệ thống đang bận.", status_code=503)
    except Exception as error:  # noqa: BLE001
        return log_and_error(
            request, error, f"bulk_operation_{command}", "BULK_OPERATION_FAILED",
            "Không thể xử lý thao tác hàng loạt.",
        )


async def download_api(request):
    if not bulk_operations_enabled():
        return error_response(request, "BULK_OPERATION_DISABLED", "Tính năng chưa được bật.", status_code=404)
    try:
        operation_id = str(request.path_params.get("operation_id") or "").strip()

        def write(cursor, role, organization_id):
            visibility = VisibilityScope.resolve(cursor, role, role.user_id, organization_id)
            artifact = BulkOperationService(cursor).artifact(
                organization_id, role.user_id, operation_id, visibility
            )
            path = resolve_path(artifact["storageKey"])
            if not path.is_file():
                raise BulkOperationError("BULK_ARTIFACT_NOT_FOUND", status_code=404)
            log_audit(
                "bulk_operation.downloaded", actor_user_id=role.user_id,
                organization_id=organization_id, target_type="bulk_operation",
                target_id=operation_id, request=request,
                metadata={"artifactId": artifact["id"],
                          "artifactSha256": artifact["sha256"]},
                cursor=cursor, required=True,
            )
            return artifact, path

        artifact, path = await run_database_write(_blocking, request, write)
        return FileResponse(
            path, filename=artifact["filename"], media_type=artifact["mediaType"],
            headers={"Cache-Control": "private, no-store",
                     "X-Content-Type-Options": "nosniff"},
        )
    except BulkOperationError as error:
        return error_response(request, error.code, "Không thể tải kết quả.", status_code=error.status_code)
    except Exception as error:  # noqa: BLE001
        return log_and_error(request, error, "bulk_operation_download",
                             "BULK_ARTIFACT_DOWNLOAD_FAILED", "Không thể tải kết quả.")


def bulk_operation_routes(Route):
    return [
        Route("/api/bulk-operations/prepare", prepare_api, methods=["POST"]),
        Route("/api/bulk-operations/{operation_id}/confirm", confirm_api, methods=["POST"]),
        Route("/api/bulk-operations/{operation_id}/cancel", cancel_api, methods=["POST"]),
        Route("/api/bulk-operations/{operation_id}/download", download_api, methods=["GET"]),
    ]

