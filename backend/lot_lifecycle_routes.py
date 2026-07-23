"""HTTP boundary for lot-scoped procurement lifecycle commands."""

from starlette.responses import JSONResponse

from backend.lot_lifecycle_service import (
    LotLifecycleInputError,
    LotLifecycleNotFoundError,
    create_batch,
    finalize_batch,
    query_lifecycle,
)
from backend.lot_selection_lifecycle import LotLifecyclePolicyError
from backend.shared.access_policy import (
    authorize_record_write,
    can_read_record,
    is_organization_manager,
    is_personal_workspace_owner,
)
from backend.shared.helpers import OrgPermissionError, database, get_active_org, verify_session
from backend.shared.logging_utils import log_and_error
from backend.shared.request_validation import read_json_object, validate_or_response


async def get_lot_lifecycle_api(request):
    connection = None
    try:
        valid, session = verify_session(request)
        if not valid:
            return JSONResponse({"error": session}, status_code=403)
        package_id = str(request.path_params.get("package_id") or "").strip()
        organization_id = get_active_org(request, session.user_id)
        connection = database.get_connection()
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
            return JSONResponse({"error": "Không có quyền xem gói thầu."}, status_code=403)
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
    finally:
        if connection:
            connection.close()


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
        outcomes = data.get("outcomes")
        if not isinstance(outcomes, dict) or not outcomes:
            return JSONResponse(
                {"error": "Phải xác định kết quả của từng phần lô.", "code": "INVALID_LOT_OUTCOMES"},
                status_code=400,
            )
        package_id = str(request.path_params.get("package_id") or "").strip()
        batch_id = str(request.path_params.get("batch_id") or "").strip()
        organization_id = get_active_org(request, session.user_id)
        connection = database.get_connection()
        connection.execute("BEGIN")
        cursor = connection.cursor()
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
        lifecycle = finalize_batch(
            cursor,
            organization_id,
            package_id,
            batch_id,
            {str(key): str(value) for key, value in outcomes.items()},
            actor_user_id=session.user_id,
        )
        connection.commit()
        return JSONResponse({"success": True, **lifecycle})
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
