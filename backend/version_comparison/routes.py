"""Strict HTTP adapter for read-only version comparisons."""

from __future__ import annotations

import os

from starlette.responses import JSONResponse

from backend.db.db_helper import DatabaseError
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.shared.helpers import OrgPermissionError, database, get_active_org, verify_session
from backend.shared.logging_utils import error_response, log_and_error
from backend.legal_versioning.routes import legal_versioning_enabled
from backend.sync.visibility_scope import VisibilityScope
from backend.version_comparison.errors import VersionComparisonError
from backend.version_comparison.impact_registry import default_impact_providers
from backend.version_comparison.read_repository import VersionComparisonReadRepository
from backend.version_comparison.service import VersionComparisonService


VERSION_COMPARISON_ENABLED = os.environ.get(
    "VERSION_COMPARISON_ENABLED",
    "false" if os.environ.get("APP_ENV", "development").strip().casefold() in {"prod", "production"} else "true",
).strip().casefold() == "true"

_REQUEST_FIELDS = {
    "entityType", "leftVersionId", "rightVersionId", "includeUnchanged", "relationPage",
}
_PAGE_FIELDS = {"path", "cursor", "limit"}


def _invalid(request, fields):
    return error_response(
        request,
        "VERSION_COMPARISON_INVALID_REQUEST",
        "Yêu cầu so sánh phiên bản không hợp lệ.",
        status_code=400,
        fields=fields,
    )


def _parse_request(payload):
    if not isinstance(payload, dict):
        raise VersionComparisonError(
            "VERSION_COMPARISON_INVALID_REQUEST", "Request body must be an object."
        )
    errors = {key: "UNKNOWN_FIELD" for key in payload if key not in _REQUEST_FIELDS}
    entity_type = str(payload.get("entityType") or "").strip().lower()
    left_id = str(payload.get("leftVersionId") or "").strip()
    right_id = str(payload.get("rightVersionId") or "").strip()
    if entity_type not in {"kehoach", "goithau"}:
        errors["entityType"] = "UNSUPPORTED_ENTITY_TYPE"
    for field, value in (("leftVersionId", left_id), ("rightVersionId", right_id)):
        if not value or len(value) > 200:
            errors[field] = "INVALID_ID"
    include_unchanged = payload.get("includeUnchanged", False)
    if not isinstance(include_unchanged, bool):
        errors["includeUnchanged"] = "EXPECTED_BOOLEAN"
    page = payload.get("relationPage") or {}
    if not isinstance(page, dict):
        errors["relationPage"] = "EXPECTED_OBJECT"
        page = {}
    else:
        for key in page:
            if key not in _PAGE_FIELDS:
                errors[f"relationPage.{key}"] = "UNKNOWN_FIELD"
        if "limit" in page and (
            isinstance(page["limit"], bool)
            or not isinstance(page["limit"], int)
            or not 1 <= page["limit"] <= 500
        ):
            errors["relationPage.limit"] = "OUT_OF_RANGE"
        if "path" in page and (
            not isinstance(page["path"], str)
            or not page["path"].strip()
            or len(page["path"]) > 300
        ):
            errors["relationPage.path"] = "INVALID_PATH"
        if "cursor" in page and (
            not isinstance(page["cursor"], str)
            or not page["cursor"].strip()
            or len(page["cursor"]) > 2000
        ):
            errors["relationPage.cursor"] = "INVALID_CURSOR"
        if "cursor" in page and "path" not in page:
            errors["relationPage.path"] = "REQUIRED_WITH_CURSOR"
    if errors:
        raise VersionComparisonError(
            "VERSION_COMPARISON_INVALID_REQUEST",
            "Yêu cầu so sánh phiên bản không hợp lệ.",
            fields=errors,
        )
    return {
        "entity_type": entity_type,
        "left_version_id": left_id,
        "right_version_id": right_id,
        "include_unchanged": include_unchanged,
        "relation_page_request": page,
    }


def _compare_blocking(request, arguments):
    conn = None
    try:
        valid, role = verify_session(request)
        if not valid:
            return error_response(request, "SESSION_REQUIRED", str(role), status_code=403)
        organization_id = get_active_org(request, role.user_id)
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        visibility_scope = VisibilityScope.resolve(
            cursor, role, role.user_id, organization_id
        )
        legal_enabled = legal_versioning_enabled()
        service = VersionComparisonService(
            VersionComparisonReadRepository(
                cursor, visibility_scope, include_legal_binding=legal_enabled
            ),
            impact_providers=default_impact_providers(
                legal_versioning_enabled=legal_enabled
            ),
        )
        result = service.compare(**arguments)
        conn.commit()
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
    except VersionComparisonError as error:
        if conn:
            conn.rollback()
        return error_response(
            request,
            error.code,
            error.message,
            status_code=error.status_code,
            fields=error.fields,
        )
    except OrgPermissionError:
        if conn:
            conn.rollback()
        return error_response(
            request, "ORG_ACCESS_DENIED", "Không có quyền truy cập tổ chức này.", status_code=403
        )
    except ValueError as error:
        if conn:
            conn.rollback()
        if str(error) == "INVALID_RELATION_CURSOR":
            return _invalid(request, {"relationPage.cursor": "INVALID_CURSOR"})
        if str(error) == "INVALID_RELATION_PATH":
            return _invalid(request, {"relationPage.path": "UNKNOWN_PATH"})
        raise
    finally:
        if conn:
            conn.close()


async def query_version_comparison_api(request):
    if not VERSION_COMPARISON_ENABLED:
        return error_response(
            request,
            "VERSION_COMPARISON_DISABLED",
            "Tính năng so sánh phiên bản chưa được bật.",
            status_code=404,
        )
    try:
        try:
            payload = await request.json()
        except (TypeError, ValueError):
            return _invalid(request, {"body": "INVALID_JSON"})
        try:
            arguments = _parse_request(payload)
        except VersionComparisonError as error:
            return _invalid(request, error.fields or {"body": "INVALID_REQUEST"})
        return await run_database_read(
            _compare_blocking, request, arguments, timeout_seconds=20.0
        )
    except BlockingIOBusyError:
        return error_response(
            request, "DATABASE_READ_QUEUE_FULL", "Hệ thống đang bận. Vui lòng thử lại.", status_code=503
        )
    except BlockingIOTimeoutError:
        return error_response(
            request, "DATABASE_READ_TIMEOUT", "So sánh phiên bản vượt quá thời gian chờ.", status_code=503
        )
    except (DatabaseError, RuntimeError, OSError, TypeError, KeyError) as error:
        return log_and_error(
            request,
            error,
            "version_comparison_query",
            "VERSION_COMPARISON_FAILED",
            "Không thể so sánh phiên bản.",
        )


def version_comparison_routes(Route):
    return [Route(
        "/api/version-comparisons/query",
        query_version_comparison_api,
        methods=["POST"],
    )]
