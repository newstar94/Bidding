"""HTTP boundary for lot-scoped procurement lifecycle commands."""

from hashlib import sha256
import json
import re
import secrets
import time

from starlette.responses import JSONResponse

from backend.lot_lifecycle_service import (
    LotLifecycleInputError,
    LotLifecycleNotFoundError,
    create_batch,
    finalize_batch_award,
    query_lifecycle,
)
from backend.lot_selection_lifecycle import LotLifecyclePolicyError
from backend.shared.access_policy import (
    authorize_record_write,
    can_read_record,
)
from backend.shared.helpers import (
    OrgPermissionError,
    database,
    get_active_org,
    log_audit,
    verify_session,
)
from backend.shared.idempotency import acquire_idempotency_lock
from backend.sync.websocket import enqueue_websocket_event
from backend.sync.aggregate_mutability import package_mutability_error
from backend.shared.logging_utils import log_and_error
from backend.shared.request_validation import read_json_object, validate_or_response


_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


class LotFinalizeIdempotencyConflict(RuntimeError):
    """One finalize key was reused for a different semantic command."""


def lot_finalize_request_digest(payload) -> str:
    """Hash the canonical finalize body independently of JSON key ordering."""

    canonical = json.dumps(
        payload if isinstance(payload, dict) else {},
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return sha256(canonical).hexdigest()


def _lot_finalize_operation(organization_id, package_id, batch_id) -> str:
    scope = json.dumps(
        [str(organization_id), str(package_id), str(batch_id)],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return "lot_batch_finalize:" + sha256(scope).hexdigest()


def _lot_finalize_idempotency_replay(
    cursor,
    *,
    actor_user_id,
    operation,
    idempotency_key,
    request_digest,
):
    acquire_idempotency_lock(
        cursor,
        "lot_batch_finalize",
        actor_user_id,
        operation,
        idempotency_key,
    )
    row = cursor.execute(
        """SELECT response_json FROM api_idempotency
           WHERE actor_user_id = ? AND operation = ? AND idempotency_key = ?""",
        (actor_user_id, operation, idempotency_key),
    ).fetchone()
    if not row:
        return None
    stored = json.loads(row[0] or "{}")
    if not isinstance(stored, dict):
        raise RuntimeError("Stored lot-finalize idempotency result is invalid.")
    stored_digest = str(stored.pop("_requestDigest", ""))
    if (
        not stored_digest
        or not secrets.compare_digest(stored_digest, str(request_digest))
    ):
        raise LotFinalizeIdempotencyConflict(
            "Idempotency-Key đã được dùng cho dữ liệu phê duyệt khác."
        )
    if stored.get("success") is not True:
        raise RuntimeError("Stored lot-finalize idempotency result is invalid.")
    return stored


def _store_lot_finalize_idempotency(
    cursor,
    *,
    actor_user_id,
    operation,
    idempotency_key,
    request_digest,
    payload,
):
    stored = {**payload, "_requestDigest": str(request_digest)}
    cursor.execute(
        """INSERT INTO api_idempotency (
               actor_user_id, operation, idempotency_key,
               response_json, created_at
           ) VALUES (?, ?, ?, ?, ?)""",
        (
            actor_user_id,
            operation,
            idempotency_key,
            json.dumps(
                stored,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ),
            int(time.time()),
        ),
    )


async def get_lot_lifecycle_api(request):
    try:
        valid, session = verify_session(request)
        if not valid:
            return JSONResponse({"error": session}, status_code=403)
        package_id = str(request.path_params.get("package_id") or "").strip()
        organization_id = get_active_org(request, session.user_id)
        with database.get_connection() as connection:
            cursor = connection.cursor()
            if not can_read_record(
                cursor,
                session,
                session.user_id,
                organization_id,
                "goithau",
                "goi_thau",
                package_id,
            ):
                return JSONResponse(
                    {"error": "Không có quyền xem gói thầu."},
                    status_code=403,
                )
            return JSONResponse(
                query_lifecycle(cursor, organization_id, package_id),
                headers={"Cache-Control": "private, no-store"},
            )
    except LotLifecycleNotFoundError as exc:
        return JSONResponse({"error": str(exc), "code": "PACKAGE_NOT_FOUND"}, status_code=404)
    except LotLifecycleInputError as exc:
        return JSONResponse({"error": str(exc), "code": "LOT_LIFECYCLE_NOT_APPLICABLE"}, status_code=409)
    except OrgPermissionError:
        return JSONResponse({"error": "Không có quyền truy cập tổ chức."}, status_code=403)
    except Exception as exc:
        return log_and_error(
            request,
            exc,
            "get_lot_lifecycle_api",
            "LOT_LIFECYCLE_QUERY_FAILED",
            "Không thể tải trạng thái xử lý phần lô.",
        )


async def create_lot_batch_api(request):
    connection = None
    try:
        valid, session = verify_session(request)
        if not valid:
            return JSONResponse({"error": session}, status_code=403)
        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        invalid = validate_or_response(
            request,
            data,
            {
                "lotIds": {"type": "array", "required": True, "min_length": 1},
                "approvalMode": {
                    "type": "string",
                    "required": True,
                    "enum": {"CONSOLIDATED_APPROVAL", "STAGED_APPROVAL"},
                },
                "stagedApprovalAuthorized": {"type": "boolean"},
                "authorizationBasis": {"type": "string", "max_length": 4000},
            },
        )
        if invalid:
            return invalid
        lot_ids = data["lotIds"]
        if any(not isinstance(value, str) or not value.strip() for value in lot_ids):
            return JSONResponse(
                {"error": "Danh sách phần lô không hợp lệ.", "code": "INVALID_LOT_SCOPE"},
                status_code=400,
            )
        package_id = str(request.path_params.get("package_id") or "").strip()
        organization_id = get_active_org(request, session.user_id)
        connection = database.get_connection()
        connection.execute("BEGIN")
        cursor = connection.cursor()
        immutability = package_mutability_error(
            cursor, organization_id, package_id, lock=True
        )
        if immutability:
            connection.rollback()
            return JSONResponse(
                {"error": immutability["message"], "code": immutability["code"]},
                status_code=409,
            )
        write_decision = authorize_record_write(
            cursor,
            session,
            session.user_id,
            organization_id,
            "goithau",
            "goi_thau",
            {"id": package_id},
        )
        if not write_decision.allowed:
            connection.rollback()
            return JSONResponse({"error": write_decision.reason}, status_code=403)
        staged_authorized = bool(data.get("stagedApprovalAuthorized", False))
        batch = create_batch(
            cursor,
            organization_id,
            package_id,
            [value.strip() for value in lot_ids],
            approval_mode=data["approvalMode"],
            staged_approval_authorized=staged_authorized,
            authorization_basis=data.get("authorizationBasis", ""),
            actor_user_id=session.user_id,
        )
        enqueue_websocket_event(
            cursor,
            "broadcast",
            organization_id=organization_id,
            payload={
                "event": "lot_lifecycle_changed",
                "packageId": package_id,
                "revision": batch["syncVersion"],
            },
        )
        connection.commit()
        return JSONResponse({"success": True, "batch": batch}, status_code=201)
    except LotLifecyclePolicyError as exc:
        if connection:
            connection.rollback()
        return JSONResponse(
            {
                "error": str(exc),
                "code": "LOT_SCOPE_BLOCKED",
                "blockers": [
                    {
                        "code": blocker.code.value,
                        "message": blocker.message,
                        "lotIds": sorted(blocker.lot_ids),
                        "dependencyGroupId": blocker.dependency_group_id,
                    }
                    for blocker in exc.blockers
                ],
            },
            status_code=409,
        )
    except LotLifecycleNotFoundError as exc:
        if connection:
            connection.rollback()
        return JSONResponse({"error": str(exc), "code": "PACKAGE_NOT_FOUND"}, status_code=404)
    except LotLifecycleInputError as exc:
        if connection:
            connection.rollback()
        return JSONResponse({"error": str(exc), "code": "LOT_BATCH_INVALID"}, status_code=400)
    except OrgPermissionError:
        if connection:
            connection.rollback()
        return JSONResponse({"error": "Không có quyền truy cập tổ chức."}, status_code=403)
    except Exception as exc:
        if connection:
            connection.rollback()
        return log_and_error(
            request,
            exc,
            "create_lot_batch_api",
            "LOT_BATCH_CREATE_FAILED",
            "Không thể tạo đợt xử lý phần lô.",
        )
    finally:
        if connection:
            connection.close()


async def finalize_lot_batch_api(request):
    connection = None
    try:
        valid, session = verify_session(request)
        if not valid:
            return JSONResponse({"error": session}, status_code=403)
        data, json_error = await read_json_object(request)
        if json_error:
            return json_error
        idempotency_key = str(
            request.headers.get("Idempotency-Key") or ""
        ).strip()
        if not _IDEMPOTENCY_KEY_RE.fullmatch(idempotency_key):
            return JSONResponse(
                {
                    "error": "Thiếu Idempotency-Key hợp lệ.",
                    "code": "INVALID_IDEMPOTENCY_KEY",
                },
                status_code=400,
            )
        outcomes = data.get("outcomes")
        if not isinstance(outcomes, dict) or not outcomes:
            return JSONResponse(
                {"error": "Phải xác định kết quả của từng phần lô.", "code": "INVALID_LOT_OUTCOMES"},
                status_code=400,
            )
        package_award = data.get("packageAward")
        if not isinstance(package_award, dict):
            return JSONResponse(
                {
                    "error": "Thiếu dữ liệu kết quả chính thức của gói thầu.",
                    "code": "INVALID_PACKAGE_AWARD",
                },
                status_code=400,
            )
        canonical_outcomes = {
            str(key): str(value) for key, value in outcomes.items()
        }
        try:
            request_digest = lot_finalize_request_digest({
                "outcomes": canonical_outcomes,
                "packageAward": package_award,
            })
        except (TypeError, ValueError):
            return JSONResponse(
                {
                    "error": "Dữ liệu phê duyệt không thể chuẩn hóa.",
                    "code": "LOT_BATCH_FINALIZE_INVALID",
                },
                status_code=400,
            )
        package_id = str(request.path_params.get("package_id") or "").strip()
        batch_id = str(request.path_params.get("batch_id") or "").strip()
        organization_id = get_active_org(request, session.user_id)
        connection = database.get_connection()
        connection.execute("BEGIN")
        cursor = connection.cursor()
        immutability = package_mutability_error(
            cursor, organization_id, package_id, lock=True
        )
        if immutability:
            connection.rollback()
            return JSONResponse(
                {"error": immutability["message"], "code": immutability["code"]},
                status_code=409,
            )
        write_decision = authorize_record_write(
            cursor,
            session,
            session.user_id,
            organization_id,
            "goithau",
            "goi_thau",
            {"id": package_id},
        )
        if not write_decision.allowed:
            connection.rollback()
            return JSONResponse({"error": write_decision.reason}, status_code=403)
        operation = _lot_finalize_operation(
            organization_id,
            package_id,
            batch_id,
        )
        replay = _lot_finalize_idempotency_replay(
            cursor,
            actor_user_id=session.user_id,
            operation=operation,
            idempotency_key=idempotency_key,
            request_digest=request_digest,
        )
        if replay is not None:
            connection.commit()
            return JSONResponse(replay)
        lifecycle = finalize_batch_award(
            cursor,
            organization_id,
            package_id,
            batch_id,
            canonical_outcomes,
            package_award,
            actor_user_id=session.user_id,
        )
        log_audit(
            "lot_batch.result_finalized",
            actor_user_id=session.user_id,
            organization_id=organization_id,
            target_type="lot_batch",
            target_id=batch_id,
            request=request,
            metadata={
                "packageId": package_id,
                "outcomes": canonical_outcomes,
                "packageResult": lifecycle.get("packageResult"),
            },
            cursor=cursor,
            required=True,
        )
        response_payload = {"success": True, **lifecycle}
        _store_lot_finalize_idempotency(
            cursor,
            actor_user_id=session.user_id,
            operation=operation,
            idempotency_key=idempotency_key,
            request_digest=request_digest,
            payload=response_payload,
        )
        enqueue_websocket_event(
            cursor,
            "broadcast",
            organization_id=organization_id,
            payload={
                "event": "lot_lifecycle_changed",
                "packageId": package_id,
                "revision": lifecycle["syncVersion"],
            },
        )
        connection.commit()
        return JSONResponse(response_payload)
    except LotFinalizeIdempotencyConflict as exc:
        if connection:
            connection.rollback()
        return JSONResponse(
            {"error": str(exc), "code": "IDEMPOTENCY_KEY_REUSED"},
            status_code=409,
        )
    except LotLifecyclePolicyError as exc:
        if connection:
            connection.rollback()
        return JSONResponse({"error": str(exc), "code": "LOT_SCOPE_BLOCKED"}, status_code=409)
    except LotLifecycleNotFoundError as exc:
        if connection:
            connection.rollback()
        return JSONResponse({"error": str(exc), "code": "LOT_BATCH_NOT_FOUND"}, status_code=404)
    except LotLifecycleInputError as exc:
        if connection:
            connection.rollback()
        return JSONResponse({"error": str(exc), "code": "LOT_BATCH_FINALIZE_INVALID"}, status_code=400)
    except OrgPermissionError:
        if connection:
            connection.rollback()
        return JSONResponse({"error": "Không có quyền truy cập tổ chức."}, status_code=403)
    except Exception as exc:
        if connection:
            connection.rollback()
        return log_and_error(
            request,
            exc,
            "finalize_lot_batch_api",
            "LOT_BATCH_FINALIZE_FAILED",
            "Không thể phê duyệt kết quả đợt phần lô.",
        )
    finally:
        if connection:
            connection.close()
