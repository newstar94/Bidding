"""Feature-flagged HTTP adapters for shared ProcurementCase commands."""

from __future__ import annotations

import os

from starlette.responses import FileResponse, JSONResponse

from backend.db.db_helper import DatabaseError
from backend.shared.access_policy import authorize_record_write, can_read_record
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.async_io import run_blocking_io
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import database, get_active_org, log_error, verify_session
from backend.shared.logging_utils import error_response, log_and_error
from backend.documents.document_worker import (
    DocumentWorkerError, DocumentWorkerInputError, run_document_job_async,
)
from backend.documents.package_document_service import (
    MAX_PACKAGE_DOCUMENT_BYTES, PackageDocumentError, clean_original_filename, media_for_filename,
    validate_pdf_path,
)
from backend.documents.upload_spooling import spooled_upload
from backend.shared.logging_utils import log_audit
from backend.sync.visibility_scope import VisibilityScope

from .repository import ProcurementCaseRepository
from .storage import create_key, persist, remove, resolve_key
from .service import (
    ProcurementCaseConflict,
    ProcurementCaseError,
    ProcurementCaseNotFound,
    ProcurementCaseService,
)


def procurement_cases_enabled(environ=None):
    environment = os.environ if environ is None else environ
    return str(environment.get("PROCUREMENT_CASE_ENABLED", "false")).strip().casefold() == "true"


def _disabled(request):
    return error_response(
        request, "PROCUREMENT_CASE_DISABLED",
        "Trung tâm hồ sơ xử lý chưa được bật.", status_code=404,
    )


def _payload(value, allowed):
    if not isinstance(value, dict):
        raise ProcurementCaseError(fields={"body": "EXPECTED_OBJECT"})
    unknown = {key: "UNKNOWN_FIELD" for key in value if key not in allowed}
    if unknown:
        raise ProcurementCaseError(fields=unknown)
    return value


def _positive(value, field):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ProcurementCaseError(fields={field: "EXPECTED_POSITIVE_INTEGER"})
    return value


def _idempotency_key(request):
    value = str(request.headers.get("Idempotency-Key") or "").strip()
    if not value or len(value) > 160:
        raise ProcurementCaseError(fields={"idempotencyKey": "REQUIRED"})
    return value


def _session(request):
    valid, role = verify_session(request)
    if not valid:
        raise ProcurementCaseError("PROCUREMENT_CASE_ACCESS_DENIED")
    return role


def _read_blocking(request, operation):
    role = _session(request)
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        connection.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        organization_id = get_active_org(request, role.user_id, cursor=cursor)
        result = operation(cursor, role, organization_id)
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _write_blocking(request, operation):
    role = _session(request)
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


def _authorize_package_read(cursor, role, organization_id, package_id):
    if not can_read_record(
        cursor, role, role.user_id, organization_id,
        "goithau", "goi_thau", package_id,
    ):
        raise ProcurementCaseNotFound()


def _authorize_package_write(cursor, role, organization_id, package):
    decision = authorize_record_write(
        cursor, role, role.user_id, organization_id,
        "goithau", "goi_thau", package,
    )
    if not decision.allowed:
        raise ProcurementCaseNotFound()


def _authorized_case(cursor, role, organization_id, case_id, *, write=False):
    repository = ProcurementCaseRepository(cursor)
    case = repository.get_case(organization_id, case_id)
    if case is None:
        raise ProcurementCaseNotFound()
    package = repository.package(organization_id, case["currentPackageVersionId"])
    if package is None:
        raise ProcurementCaseNotFound()
    if write:
        _authorize_package_write(cursor, role, organization_id, package)
    else:
        _authorize_package_read(cursor, role, organization_id, package["id"])
    return ProcurementCaseService(repository), case, package


async def list_cases_api(request):
    if not procurement_cases_enabled():
        return _disabled(request)
    try:
        case_type = str(request.query_params.get("caseType") or "").strip() or None
        state = str(request.query_params.get("state") or "").strip() or None
        limit = int(request.query_params.get("limit") or 100)
        if case_type and case_type not in {"CLARIFICATION", "PETITION"}:
            raise ProcurementCaseError(fields={"caseType": "INVALID_VALUE"})
        if not 1 <= limit <= 100:
            raise ProcurementCaseError(fields={"limit": "OUT_OF_RANGE"})

        def read(cursor, role, organization_id):
            scope = VisibilityScope.resolve(cursor, role, role.user_id, organization_id)
            predicate = scope.live_predicate("goi_thau", "package_row")
            repository = ProcurementCaseRepository(cursor)
            items = repository.list_cases(
                organization_id, predicate.sql, predicate.parameters,
                case_type=case_type, state=state, limit=limit,
            )
            return {"items": items, "limit": limit}

        result = await run_database_read(_read_blocking, request, read, timeout_seconds=20)
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "procurement_case_list")


async def list_legacy_clarifications_api(request):
    if not procurement_cases_enabled():
        return _disabled(request)
    try:
        limit = int(request.query_params.get("limit") or 100)
        if not 1 <= limit <= 100:
            raise ProcurementCaseError(fields={"limit": "OUT_OF_RANGE"})

        def read(cursor, role, organization_id):
            scope = VisibilityScope.resolve(cursor, role, role.user_id, organization_id)
            predicate = scope.live_predicate("goi_thau", "package_row")
            return {"items": ProcurementCaseRepository(cursor).legacy_entries(
                organization_id, predicate.sql, predicate.parameters,
                limit=limit,
            ), "limit": limit}

        result = await run_database_read(_read_blocking, request, read, timeout_seconds=20)
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
    except Exception as error:  # noqa: BLE001
        return _handle(request, error, "procurement_case_legacy_list")


async def get_case_api(request):
    if not procurement_cases_enabled():
        return _disabled(request)
    try:
        case_id = str(request.path_params.get("case_id") or "").strip()

        def read(cursor, role, organization_id):
            service, case, _package = _authorized_case(
                cursor, role, organization_id, case_id
            )
            return service.present(organization_id, case)

        result = await run_database_read(_read_blocking, request, read, timeout_seconds=20)
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "procurement_case_get")


async def create_case_api(request):
    if not procurement_cases_enabled():
        return _disabled(request)
    try:
        data = _payload(await request.json(), {
            "packageVersionId", "caseNo", "caseType", "direction", "category",
            "otherDescription", "subject", "dueAt",
        })
        key = _idempotency_key(request)

        def write(cursor, role, organization_id):
            repository = ProcurementCaseRepository(cursor)
            package = repository.package(
                organization_id, str(data.get("packageVersionId") or "")
            )
            if package is None:
                raise ProcurementCaseNotFound()
            _authorize_package_write(cursor, role, organization_id, package)
            return ProcurementCaseService(repository).create_case(
                organization_id=organization_id, package=package,
                case_no=data.get("caseNo"), case_type=data.get("caseType"),
                direction=data.get("direction"), category=data.get("category"),
                other_description=data.get("otherDescription"),
                subject=data.get("subject"), due_at=data.get("dueAt"),
                actor_user_id=role.user_id, idempotency_key=key, request=request,
            )

        result = await run_database_write(_write_blocking, request, write)
        return JSONResponse(result, status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "procurement_case_create")


async def save_response_api(request):
    if not procurement_cases_enabled():
        return _disabled(request)
    try:
        data = _payload(await request.json(), {
            "expectedRowVersion", "packageVersionId", "content",
        })
        case_id = str(request.path_params.get("case_id") or "")
        key = _idempotency_key(request)

        def write(cursor, role, organization_id):
            service, _case, package = _authorized_case(
                cursor, role, organization_id, case_id, write=True
            )
            return service.save_response(
                organization_id=organization_id, case_id=case_id,
                expected_row_version=_positive(data.get("expectedRowVersion"), "expectedRowVersion"),
                package_version_id=str(data.get("packageVersionId") or package["id"]),
                content=data.get("content"), actor_user_id=role.user_id,
                idempotency_key=key, request=request,
            )

        result = await run_database_write(_write_blocking, request, write)
        return JSONResponse(result, status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "procurement_case_save_response")


def _action_endpoint(action):
    async def endpoint(request):
        if not procurement_cases_enabled():
            return _disabled(request)
        try:
            data = _payload(await request.json(), {
                "expectedRowVersion", "packageVersionId", "reason",
                "responsibleUserId", "responsibleUnit",
            })
            case_id = str(request.path_params.get("case_id") or "")
            key = _idempotency_key(request)

            def write(cursor, role, organization_id):
                service, _case, package = _authorized_case(
                    cursor, role, organization_id, case_id, write=True
                )
                return service.transition(
                    organization_id=organization_id, case_id=case_id,
                    expected_row_version=_positive(data.get("expectedRowVersion"), "expectedRowVersion"),
                    action=action,
                    package_version_id=str(data.get("packageVersionId") or package["id"]),
                    actor_user_id=role.user_id, idempotency_key=key,
                    reason=data.get("reason"),
                    responsible_user_id=data.get("responsibleUserId"),
                    responsible_unit=data.get("responsibleUnit"), request=request,
                )

            result = await run_database_write(_write_blocking, request, write)
            return JSONResponse(result, status_code=201)
        except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
            return _handle(request, error, f"procurement_case_{action.casefold()}")

    endpoint.__name__ = f"procurement_case_{action.casefold()}_api"
    return endpoint


async def set_due_date_api(request):
    if not procurement_cases_enabled():
        return _disabled(request)
    try:
        data = _payload(await request.json(), {
            "expectedRowVersion", "packageVersionId", "dueAt",
        })
        case_id = str(request.path_params.get("case_id") or "")
        key = _idempotency_key(request)

        def write(cursor, role, organization_id):
            service, _case, package = _authorized_case(
                cursor, role, organization_id, case_id, write=True
            )
            return service.set_due_date(
                organization_id=organization_id, case_id=case_id,
                expected_row_version=_positive(data.get("expectedRowVersion"), "expectedRowVersion"),
                due_at=data.get("dueAt"),
                package_version_id=str(data.get("packageVersionId") or package["id"]),
                actor_user_id=role.user_id, idempotency_key=key, request=request,
            )

        result = await run_database_write(_write_blocking, request, write)
        return JSONResponse(result, status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP adapter.
        return _handle(request, error, "procurement_case_set_due_date")


async def upload_attachment_api(request):
    if not procurement_cases_enabled():
        return _disabled(request)
    stored_key = None
    try:
        role = _session(request)
        form = await request.form()
        upload = form.get("file")
        if upload is None or not getattr(upload, "filename", None):
            raise ProcurementCaseError("CASE_ATTACHMENT_REQUIRED")
        case_id = str(request.path_params.get("case_id") or "").strip()
        expected = int(str(form.get("expectedRowVersion") or "0"))
        if expected < 1:
            raise ProcurementCaseError(fields={"expectedRowVersion": "INVALID_VALUE"})
        package_version_id = str(form.get("packageVersionId") or "").strip()
        response_revision_id = str(form.get("responseRevisionId") or "").strip() or None
        filename = clean_original_filename(upload.filename)
        extension, archive_kind, media_type = media_for_filename(filename)
        async with spooled_upload(
            upload, max_bytes=MAX_PACKAGE_DOCUMENT_BYTES, suffix=extension,
        ) as (upload_path, upload_size, head):
            if upload_size <= 0:
                raise ProcurementCaseError("CASE_ATTACHMENT_EMPTY")
            if archive_kind == "pdf":
                if not head.startswith(b"%PDF-"):
                    raise ProcurementCaseError("CASE_ATTACHMENT_INVALID")
                await run_blocking_io(validate_pdf_path, upload_path, timeout_seconds=10)
            else:
                if not head.startswith(b"PK"):
                    raise ProcurementCaseError("CASE_ATTACHMENT_INVALID")
                await run_document_job_async(
                    "validate_ooxml", {"content_path": str(upload_path),
                                       "kind": archive_kind}, timeout_seconds=20,
                )
            organization_id = get_active_org(request, role.user_id)
            stored_key = create_key(organization_id, case_id, extension)
            byte_size, checksum = await run_blocking_io(
                persist, upload_path, stored_key, timeout_seconds=15,
            )

        def write(cursor, current_role, current_org):
            service, _case, package = _authorized_case(
                cursor, current_role, current_org, case_id, write=True
            )
            return service.add_attachment(
                organization_id=current_org, case_id=case_id,
                expected_row_version=expected,
                package_version_id=package_version_id or package["id"],
                response_revision_id=response_revision_id, filename=filename,
                storage_key=stored_key, media_type=media_type,
                byte_size=byte_size, sha256=checksum,
                actor_user_id=current_role.user_id,
                idempotency_key=_idempotency_key(request), request=request,
            )

        result = await run_database_write(_write_blocking, request, write)
        stored_key = None
        return JSONResponse(result, status_code=201)
    except (DocumentWorkerError, DocumentWorkerInputError, PackageDocumentError) as error:
        return error_response(
            request, "CASE_ATTACHMENT_INVALID", str(error), status_code=400
        )
    except Exception as error:  # noqa: BLE001
        return _handle(request, error, "procurement_case_attachment_upload")
    finally:
        if stored_key:
            try:
                await run_blocking_io(remove, stored_key, timeout_seconds=5)
            except Exception as cleanup_error:  # noqa: BLE001 - best-effort staged-file rollback.
                log_error(cleanup_error, "procurement_case_attachment_cleanup")


async def download_attachment_api(request):
    if not procurement_cases_enabled():
        return _disabled(request)
    try:
        case_id = str(request.path_params.get("case_id") or "").strip()
        attachment_id = str(request.path_params.get("attachment_id") or "").strip()

        def write(cursor, role, organization_id):
            _service, _case, _package = _authorized_case(
                cursor, role, organization_id, case_id
            )
            attachment = ProcurementCaseRepository(cursor).attachment(
                organization_id, case_id, attachment_id
            )
            if not attachment:
                raise ProcurementCaseNotFound()
            path = resolve_key(attachment["storageKey"])
            if not path.is_file():
                raise ProcurementCaseNotFound()
            log_audit(
                "procurement_case.attachment_downloaded",
                actor_user_id=role.user_id, organization_id=organization_id,
                target_type="procurement_case_attachment",
                target_id=attachment_id, request=request,
                metadata={"caseId": case_id, "sha256": attachment["sha256"]},
                cursor=cursor, required=True,
            )
            return attachment, path

        attachment, path = await run_database_write(_write_blocking, request, write)
        return FileResponse(
            path, filename=attachment["filename"],
            media_type=attachment["mediaType"],
            headers={"Cache-Control": "private, no-store",
                     "X-Content-Type-Options": "nosniff"},
        )
    except Exception as error:  # noqa: BLE001
        return _handle(request, error, "procurement_case_attachment_download")


def _related_endpoint(command, allowed):
    async def endpoint(request):
        if not procurement_cases_enabled():
            return _disabled(request)
        try:
            data = _payload(await request.json(), allowed)
            case_id = str(request.path_params.get("case_id") or "").strip()
            key = _idempotency_key(request)

            def write(cursor, role, organization_id):
                service, _case, package = _authorized_case(
                    cursor, role, organization_id, case_id, write=True
                )
                common = {
                    "organization_id": organization_id, "case_id": case_id,
                    "expected_row_version": _positive(
                        data.get("expectedRowVersion"), "expectedRowVersion"
                    ),
                    "package_version_id": str(
                        data.get("packageVersionId") or package["id"]
                    ),
                    "actor_user_id": role.user_id, "idempotency_key": key,
                    "request": request,
                }
                if command == "party":
                    return service.add_party(
                        **common, role=data.get("role"),
                        display_name=data.get("displayName"),
                        contact=data.get("contact"),
                    )
                if command == "legal-basis":
                    return service.add_legal_basis(
                        **common,
                        response_revision_id=data.get("responseRevisionId"),
                        profile_version_id=data.get("profileVersionId"),
                        instrument_version_id=data.get("instrumentVersionId"),
                        note=data.get("note"),
                    )
                return service.observe_source(
                    **common, provider=data.get("provider"),
                    upstream_identity=data.get("upstreamIdentity"),
                    upstream_revision=data.get("upstreamRevision"),
                    canonical=data.get("canonical"),
                )

            result = await run_database_write(_write_blocking, request, write)
            return JSONResponse(result, status_code=201)
        except Exception as error:  # noqa: BLE001
            return _handle(request, error, f"procurement_case_{command}")

    endpoint.__name__ = f"procurement_case_{command.replace('-', '_')}_api"
    return endpoint


def _handle(request, error, context):
    if isinstance(error, ProcurementCaseError):
        fields = dict(error.fields)
        if isinstance(error, ProcurementCaseConflict) and error.current is not None:
            fields["current"] = error.current
        status = error.status_code
        if error.code == "PROCUREMENT_CASE_ACCESS_DENIED":
            status = 403
        return error_response(
            request, error.code, "Yêu cầu hồ sơ xử lý không hợp lệ.",
            status_code=status, fields=fields,
        )
    if isinstance(error, (BlockingIOBusyError, BlockingIOTimeoutError)):
        return error_response(
            request, "DATABASE_BUSY", "Hệ thống đang bận.", status_code=503
        )
    if isinstance(error, (DatabaseError, RuntimeError, TypeError, KeyError, ValueError)):
        return log_and_error(
            request, error, context, "PROCUREMENT_CASE_FAILED",
            "Không thể xử lý hồ sơ.",
        )
    raise error


_ACTIONS = {
    "assign": "ASSIGN", "start-review": "START_REVIEW",
    "draft-response": "DRAFT_RESPONSE", "submit-review": "SUBMIT_REVIEW",
    "return": "RETURN", "approve": "APPROVE", "issue": "ISSUE",
    "close": "CLOSE", "reject": "REJECT", "withdraw": "WITHDRAW",
    "reopen": "REOPEN",
}


def procurement_case_routes(Route):
    routes = [
        Route("/api/procurement-cases", list_cases_api, methods=["GET"]),
        Route("/api/procurement-cases", create_case_api, methods=["POST"]),
        Route("/api/procurement-cases/legacy-clarifications", list_legacy_clarifications_api, methods=["GET"]),
        Route("/api/procurement-cases/{case_id}", get_case_api, methods=["GET"]),
        Route("/api/procurement-cases/{case_id}/responses", save_response_api, methods=["POST"]),
        Route("/api/procurement-cases/{case_id}/due-date", set_due_date_api, methods=["POST"]),
        Route("/api/procurement-cases/{case_id}/attachments", upload_attachment_api, methods=["POST"]),
        Route("/api/procurement-cases/{case_id}/attachments/{attachment_id}/download", download_attachment_api, methods=["GET"]),
        Route("/api/procurement-cases/{case_id}/parties", _related_endpoint(
            "party", {"expectedRowVersion", "packageVersionId", "role",
                      "displayName", "contact"}), methods=["POST"]),
        Route("/api/procurement-cases/{case_id}/legal-bases", _related_endpoint(
            "legal-basis", {"expectedRowVersion", "packageVersionId",
                            "responseRevisionId", "profileVersionId",
                            "instrumentVersionId", "note"}), methods=["POST"]),
        Route("/api/procurement-cases/{case_id}/source-observations", _related_endpoint(
            "source-observation", {"expectedRowVersion", "packageVersionId",
                                   "provider", "upstreamIdentity",
                                   "upstreamRevision", "canonical"}), methods=["POST"]),
    ]
    routes.extend(
        Route(
            f"/api/procurement-cases/{{case_id}}/{path}",
            _action_endpoint(action), methods=["POST"],
        )
        for path, action in _ACTIONS.items()
    )
    return routes
