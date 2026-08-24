"""Feature-flagged HTTP adapters for SYSTEM legal catalog and bindings."""

from __future__ import annotations

import os
from datetime import date, datetime

from starlette.responses import JSONResponse

from backend.db.db_helper import DatabaseError
from backend.shared.access_policy import can_read_record
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import OrgPermissionError, database, get_active_org, verify_session
from backend.shared.logging_utils import error_response, log_and_error

from .repository import LegalVersioningRepository
from .service import (
    LegalConflictError,
    LegalVersioningError,
    LegalVersioningService,
)


def legal_versioning_enabled(environ=None):
    environment = os.environ if environ is None else environ
    return str(environment.get("LEGAL_VERSIONING_ENABLED", "false")).strip().casefold() == "true"


def _json_safe(value):
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _disabled(request):
    return error_response(
        request, "LEGAL_VERSIONING_DISABLED",
        "Quản lý phiên bản pháp lý chưa được bật.", status_code=404,
    )


def _payload(value, allowed):
    if not isinstance(value, dict):
        raise LegalVersioningError(fields={"body": "EXPECTED_OBJECT"})
    unknown = {key: "UNKNOWN_FIELD" for key in value if key not in allowed}
    if unknown:
        raise LegalVersioningError(fields=unknown)
    return value


def _integer(value, field, *, allow_zero=False):
    minimum = 0 if allow_zero else 1
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise LegalVersioningError(fields={field: "EXPECTED_INTEGER"})
    return value


def _catalog_blocking(request, operation, *, write=False):
    valid, role = verify_session(
        request, required_role="super_admin" if write else None
    )
    if not valid:
        error = LegalVersioningError(fields={"authorization": "DENIED"})
        error.code = "LEGAL_VERSIONING_ACCESS_DENIED"
        error.status_code = 403
        raise error
    connection = database.get_connection()
    try:
        if write:
            connection.execute("BEGIN")
        repository = LegalVersioningRepository(connection.cursor())
        result = operation(LegalVersioningService(repository), repository, role)
        if write:
            connection.commit()
        return result
    except Exception:
        if write:
            connection.rollback()
        raise
    finally:
        connection.close()


def _binding_blocking(request, target_type, target_id, operation, *, write=False):
    valid, role = verify_session(
        request, required_role="super_admin" if write else None
    )
    if not valid:
        error = LegalVersioningError(fields={"authorization": "DENIED"})
        error.code = "LEGAL_VERSIONING_ACCESS_DENIED"
        error.status_code = 403
        raise error
    connection = database.get_connection()
    try:
        if write:
            connection.execute("BEGIN")
        cursor = connection.cursor()
        organization_id = get_active_org(request, role.user_id, cursor=cursor)
        mapping = {
            "plan": ("kehoach", "ke_hoach_lcnt"),
            "package": ("goithau", "goi_thau"),
        }.get(target_type)
        if mapping is None:
            raise LegalVersioningError(fields={"targetType": "INVALID_VALUE"})
        if not can_read_record(
            cursor, role, role.user_id, organization_id,
            mapping[0], mapping[1], target_id,
        ):
            error = LegalVersioningError(fields={"authorization": "DENIED"})
            error.code = "LEGAL_BINDING_NOT_FOUND"
            error.status_code = 404
            raise error
        repository = LegalVersioningRepository(cursor)
        result = operation(
            LegalVersioningService(repository), repository, role, organization_id
        )
        if write:
            connection.commit()
        return result
    except Exception:
        if write:
            connection.rollback()
        raise
    finally:
        connection.close()


async def list_profiles_api(request):
    if not legal_versioning_enabled():
        return _disabled(request)
    try:
        result = await run_database_read(
            _catalog_blocking, request,
            lambda _service, repository, _role: repository.list_profile_versions(),
            timeout_seconds=15,
        )
        return JSONResponse(_json_safe(result), headers={"Cache-Control": "private, no-store"})
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "legal_profiles_list")


async def get_profile_sources_api(request):
    if not legal_versioning_enabled():
        return _disabled(request)
    try:
        profile_version_id = str(
            request.path_params.get("profile_version_id") or ""
        ).strip()
        result = await run_database_read(
            _catalog_blocking, request,
            lambda service, _repository, _role: service.get_exact_sources(
                profile_version_id
            ),
            timeout_seconds=20,
        )
        return JSONResponse(
            _json_safe(result), headers={"Cache-Control": "private, no-store"}
        )
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "legal_profile_sources")


async def create_instrument_api(request):
    if not legal_versioning_enabled():
        return _disabled(request)
    try:
        data = _payload(await request.json(), {
            "stableCode", "title", "documentType", "documentNumber",
            "sourceUri", "sourceContent", "issuedDate", "effectiveFrom",
            "effectiveTo", "relations",
        })
        result = await run_database_write(
            _catalog_blocking, request,
            lambda service, _repository, role: service.create_instrument_draft(
                stable_code=data.get("stableCode"), title=data.get("title"),
                document_type=data.get("documentType"),
                document_number=data.get("documentNumber"),
                source_uri=data.get("sourceUri"), source_content=data.get("sourceContent"),
                issued_date=data.get("issuedDate"), effective_from=data.get("effectiveFrom"),
                effective_to=data.get("effectiveTo"), relations=data.get("relations"),
                actor_user_id=role.user_id, request=request,
            ),
            write=True,
        )
        return JSONResponse(_json_safe(result), status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "legal_instrument_create")


async def publish_instrument_api(request):
    if not legal_versioning_enabled():
        return _disabled(request)
    try:
        data = _payload(await request.json(), {"expectedDraftRevision"})
        result = await run_database_write(
            _catalog_blocking, request,
            lambda service, _repository, role: service.publish_instrument(
                draft_id=str(request.path_params.get("draft_id") or ""),
                expected_draft_revision=_integer(
                    data.get("expectedDraftRevision"), "expectedDraftRevision"
                ),
                actor_user_id=role.user_id, request=request,
            ),
            write=True,
        )
        return JSONResponse(_json_safe(result), status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "legal_instrument_publish")


async def create_profile_api(request):
    if not legal_versioning_enabled():
        return _disabled(request)
    try:
        data = _payload(await request.json(), {
            "stableCode", "displayName", "effectiveFrom", "effectiveTo",
            "priority", "manualReviewRequired", "instrumentVersionIds",
        })
        result = await run_database_write(
            _catalog_blocking, request,
            lambda service, _repository, role: service.create_profile_draft(
                stable_code=data.get("stableCode"), display_name=data.get("displayName"),
                effective_from=data.get("effectiveFrom"), effective_to=data.get("effectiveTo"),
                priority=data.get("priority", 0),
                manual_review_required=data.get("manualReviewRequired", False),
                instrument_version_ids=data.get("instrumentVersionIds"),
                actor_user_id=role.user_id, request=request,
            ),
            write=True,
        )
        return JSONResponse(_json_safe(result), status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "legal_profile_create")


async def publish_profile_api(request):
    if not legal_versioning_enabled():
        return _disabled(request)
    try:
        data = _payload(await request.json(), {"expectedDraftRevision"})
        result = await run_database_write(
            _catalog_blocking, request,
            lambda service, _repository, role: service.publish_profile(
                draft_id=str(request.path_params.get("draft_id") or ""),
                expected_draft_revision=_integer(
                    data.get("expectedDraftRevision"), "expectedDraftRevision"
                ),
                actor_user_id=role.user_id, request=request,
            ),
            write=True,
        )
        return JSONResponse(_json_safe(result), status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "legal_profile_publish")


async def get_binding_api(request):
    if not legal_versioning_enabled():
        return _disabled(request)
    try:
        target_type = str(request.path_params.get("target_type") or "")
        target_id = str(request.path_params.get("target_id") or "")
        result = await run_database_read(
            _binding_blocking, request, target_type, target_id,
            lambda service, _repository, _role, organization_id: service.get_binding(
                organization_id, target_type, target_id
            ),
            timeout_seconds=15,
        )
        return JSONResponse(_json_safe(result), headers={"Cache-Control": "private, no-store"})
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "legal_binding_get")


async def resolve_binding_api(request):
    if not legal_versioning_enabled():
        return _disabled(request)
    try:
        target_type = str(request.path_params.get("target_type") or "")
        target_id = str(request.path_params.get("target_id") or "")
        data = _payload(
            await request.json(), {"expectedBindingRevision", "expectedTargetRowVersion"}
        )
        expected_binding = _integer(
            data.get("expectedBindingRevision"), "expectedBindingRevision", allow_zero=True
        )
        expected_target = _integer(
            data.get("expectedTargetRowVersion"), "expectedTargetRowVersion"
        )
        result = await run_database_write(
            _binding_blocking, request, target_type, target_id,
            lambda service, _repository, role, organization_id: service.resolve_and_bind(
                organization_id=organization_id, target_type=target_type,
                target_id=target_id, expected_binding_revision=expected_binding,
                expected_target_row_version=expected_target,
                actor_user_id=role.user_id, request=request,
            ),
            write=True,
        )
        return JSONResponse(_json_safe(result), status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "legal_binding_resolve")


def _handle(request, error, context):
    if isinstance(error, LegalVersioningError):
        fields = dict(error.fields)
        if isinstance(error, LegalConflictError) and error.current is not None:
            fields["current"] = _json_safe(error.current)
        return error_response(
            request, error.code, "Yêu cầu phiên bản pháp lý không hợp lệ.",
            status_code=error.status_code, fields=fields,
        )
    if isinstance(error, OrgPermissionError):
        return error_response(request, "ORG_ACCESS_DENIED", "Không có quyền truy cập.", status_code=403)
    if isinstance(error, (BlockingIOBusyError, BlockingIOTimeoutError)):
        return error_response(request, "DATABASE_BUSY", "Hệ thống đang bận.", status_code=503)
    if isinstance(error, (DatabaseError, RuntimeError, TypeError, KeyError, ValueError)):
        return log_and_error(
            request, error, context, "LEGAL_VERSIONING_FAILED",
            "Không thể xử lý phiên bản pháp lý.",
        )
    raise error


def legal_versioning_routes(Route):
    return [
        Route("/api/legal-versioning/profiles", list_profiles_api, methods=["GET"]),
        Route(
            "/api/legal-versioning/profiles/{profile_version_id}/sources",
            get_profile_sources_api, methods=["GET"],
        ),
        Route("/api/legal-versioning/instruments", create_instrument_api, methods=["POST"]),
        Route(
            "/api/legal-versioning/instrument-drafts/{draft_id}/publish",
            publish_instrument_api, methods=["POST"],
        ),
        Route("/api/legal-versioning/profiles", create_profile_api, methods=["POST"]),
        Route(
            "/api/legal-versioning/profile-drafts/{draft_id}/publish",
            publish_profile_api, methods=["POST"],
        ),
        Route(
            "/api/legal-versioning/{target_type}/{target_id}/binding",
            get_binding_api, methods=["GET"],
        ),
        Route(
            "/api/legal-versioning/{target_type}/{target_id}/binding/resolve",
            resolve_binding_api, methods=["POST"],
        ),
    ]
