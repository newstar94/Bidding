"""Strict HTTP adapter for the feature-flagged WordTemplateCatalog."""

from __future__ import annotations

import hashlib
from datetime import date, datetime
from io import BytesIO
from pathlib import Path

from starlette.responses import JSONResponse, StreamingResponse

from backend.db.db_helper import DatabaseError
from backend.documents.document_worker import (
    DocumentWorkerError,
    run_document_job_async,
)
from backend.documents.upload_spooling import spooled_upload
from backend.shared.access_policy import (
    can_manage_word_config,
    can_read_record,
    can_read_word_config,
    can_upload_workspace_assets,
)
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read, run_database_write
from backend.shared.helpers import (
    OrgPermissionError,
    database,
    get_active_org,
    verify_session,
)
from backend.shared.logging_utils import error_response, log_and_error, log_audit
from backend.shared.subscription_policy import can_use_word_export

from .compatibility import catalog_enabled
from .preflight import TemplatePreflight
from .repository import WordTemplateCatalogRepository
from .service import CatalogError, CatalogNotFoundError, WordTemplateCatalog
from .storage import ImmutableTemplateStorage, MAX_TEMPLATE_BYTES


def _disabled(request):
    return error_response(
        request,
        "WORD_TEMPLATE_CATALOG_DISABLED",
        "Vòng đời biểu mẫu Word chưa được bật.",
        status_code=404,
    )


def _json_safe(value):
    if isinstance(value, dict):
        return {key: _json_safe(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(child) for child in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _public_version(version):
    result = dict(version)
    result.pop("storageKey", None)
    result.pop("content", None)
    return result


def _public_result(value):
    if isinstance(value, dict) and "versions" in value:
        value = dict(value)
        value["versions"] = [_public_version(item) for item in value["versions"]]
    elif isinstance(value, dict) and "sha256" in value and "templateId" in value:
        value = _public_version(value)
    return _json_safe(value)


def _parse_json_object(payload, allowed):
    if not isinstance(payload, dict):
        raise CatalogError(fields={"body": "EXPECTED_OBJECT"})
    unknown = {key: "UNKNOWN_FIELD" for key in payload if key not in allowed}
    if unknown:
        raise CatalogError(fields=unknown)
    return payload


def _positive_int(value, field, *, allow_zero=False):
    minimum = 0 if allow_zero else 1
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise CatalogError(fields={field: "EXPECTED_INTEGER"})
    return value


def _context(request, cursor, *, write=False, upload=False):
    valid, role = verify_session(request)
    if not valid:
        error = CatalogError(fields={"session": "REQUIRED"})
        error.status_code = 403
        error.code = "SESSION_REQUIRED"
        raise error
    organization_id = get_active_org(request, role.user_id, cursor=cursor)
    allowed = (
        can_manage_word_config(
            cursor, role, role.user_id, organization_id
        )
        if write
        else can_read_word_config(
            cursor, role, role.user_id, organization_id
        )
    )
    if upload:
        allowed = allowed and can_upload_workspace_assets(
            cursor, role, role.user_id, organization_id
        )
    if not allowed:
        error = CatalogError(fields={"authorization": "DENIED"})
        error.status_code = 403
        error.code = "WORD_TEMPLATE_CATALOG_ACCESS_DENIED"
        raise error
    owner_type = "personal" if organization_id == f"personal:{role.user_id}" else "organization"
    return role, str(organization_id), owner_type


def _read_blocking(request, operation):
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        role, organization_id, owner_type = _context(request, cursor)
        repository = WordTemplateCatalogRepository(cursor)
        return operation(
            WordTemplateCatalog(repository, ImmutableTemplateStorage()),
            repository,
            role,
            organization_id,
            owner_type,
        )
    finally:
        connection.close()


def _write_blocking(request, operation, *, upload=False):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        role, organization_id, owner_type = _context(
            request, cursor, write=True, upload=upload
        )
        repository = WordTemplateCatalogRepository(cursor)
        result = operation(
            WordTemplateCatalog(repository, ImmutableTemplateStorage()),
            repository,
            role,
            organization_id,
            owner_type,
        )
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


async def _sanitized_upload(request):
    # Import lazily to reuse the exact legacy filename/type/size contract without
    # making routes_docx depend on the catalog adapter.
    from backend.documents.routes_docx import _validate_docx_upload

    form = await request.form()
    upload = form.get("file")
    if upload is None:
        raise CatalogError(fields={"file": "REQUIRED"})
    async with spooled_upload(
        upload, max_bytes=MAX_TEMPLATE_BYTES, suffix=".docx"
    ) as (upload_path, upload_size, head):
        filename = _validate_docx_upload(
            upload.filename,
            head,
            deep_validation=False,
            total_size=upload_size,
        )
        content = await run_document_job_async(
            "sanitize_docx_template",
            {"content_path": str(upload_path)},
            timeout_seconds=15,
        )
    return form, filename, content


async def list_catalog_templates_api(request):
    if not catalog_enabled():
        return _disabled(request)
    try:
        include_retired = request.query_params.get("includeRetired") == "true"
        result = await run_database_read(
            _read_blocking,
            request,
            lambda catalog, _repository, _role, organization_id, _owner_type: (
                catalog.list_templates(
                    organization_id, include_retired=include_retired
                )
            ),
            timeout_seconds=15,
        )
        return JSONResponse(_public_result(result), headers={"Cache-Control": "private, no-store"})
    except Exception as error:  # noqa: BLE001 - bounded HTTP error adapter.
        return _handle(request, error, "word_template_catalog_list")


async def list_catalog_versions_api(request):
    if not catalog_enabled():
        return _disabled(request)
    try:
        template_id = str(request.path_params.get("template_id") or "").strip()
        result = await run_database_read(
            _read_blocking,
            request,
            lambda catalog, _repository, _role, organization_id, _owner_type: (
                catalog.list_versions(organization_id, template_id)
            ),
            timeout_seconds=15,
        )
        return JSONResponse(_public_result(result), headers={"Cache-Control": "private, no-store"})
    except Exception as error:  # noqa: BLE001 - bounded HTTP error adapter.
        return _handle(request, error, "word_template_catalog_versions")


async def get_catalog_version_api(request):
    if not catalog_enabled():
        return _disabled(request)
    try:
        version_id = str(request.path_params.get("version_id") or "").strip()
        result = await run_database_read(
            _read_blocking,
            request,
            lambda catalog, _repository, _role, organization_id, _owner_type: (
                catalog.get_version(organization_id, version_id)
            ),
            timeout_seconds=15,
        )
        return JSONResponse(_public_result(result), headers={"Cache-Control": "private, no-store"})
    except Exception as error:  # noqa: BLE001 - bounded HTTP error adapter.
        return _handle(request, error, "word_template_catalog_version")


async def create_catalog_template_api(request):
    if not catalog_enabled():
        return _disabled(request)
    try:
        form, filename, content = await _sanitized_upload(request)
        fields = {
            "stableCode": str(form.get("stableCode") or Path(filename).stem),
            "displayName": str(form.get("displayName") or Path(filename).stem),
            "legacyAlias": str(form.get("legacyAlias") or filename),
        }
        result = await run_database_write(
            _write_blocking,
            request,
            lambda catalog, _repository, role, organization_id, owner_type: (
                catalog.create_template(
                    organization_id=organization_id,
                    owner_type=owner_type,
                    stable_code=fields["stableCode"],
                    display_name=fields["displayName"],
                    legacy_alias=fields["legacyAlias"],
                    original_filename=filename,
                    sanitized_content=content,
                    actor_user_id=role.user_id,
                    request=request,
                )
            ),
            upload=True,
        )
        return JSONResponse(_public_result(result), status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP error adapter.
        return _handle(request, error, "word_template_catalog_create")


async def create_catalog_draft_api(request):
    if not catalog_enabled():
        return _disabled(request)
    try:
        form, filename, content = await _sanitized_upload(request)
        try:
            expected = int(str(form.get("expectedRowVersion") or ""))
        except ValueError as error:
            raise CatalogError(fields={"expectedRowVersion": "EXPECTED_INTEGER"}) from error
        template_id = str(request.path_params.get("template_id") or "").strip()
        result = await run_database_write(
            _write_blocking,
            request,
            lambda catalog, _repository, role, organization_id, _owner_type: (
                catalog.create_draft_version(
                    organization_id=organization_id,
                    template_id=template_id,
                    expected_row_version=expected,
                    original_filename=filename,
                    sanitized_content=content,
                    actor_user_id=role.user_id,
                    request=request,
                )
            ),
            upload=True,
        )
        return JSONResponse(_public_result(result), status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP error adapter.
        return _handle(request, error, "word_template_catalog_draft")


async def run_catalog_preflight_api(request):
    if not catalog_enabled():
        return _disabled(request)
    try:
        payload = _parse_json_object(await request.json(), {"documentTypes"})
        document_types = payload.get("documentTypes")
        if document_types is not None and not isinstance(document_types, list):
            raise CatalogError(fields={"documentTypes": "EXPECTED_ARRAY"})
        version_id = str(request.path_params.get("version_id") or "").strip()

        def operation(_catalog, repository, role, organization_id, _owner_type):
            return TemplatePreflight(repository, ImmutableTemplateStorage()).run(
                organization_id=organization_id,
                version_id=version_id,
                actor_user_id=role.user_id,
                document_types=document_types,
            )

        result = await run_database_write(_write_blocking, request, operation)
        return JSONResponse(_public_result(result), status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP error adapter.
        return _handle(request, error, "word_template_catalog_preflight")


async def publish_catalog_template_api(request):
    if not catalog_enabled():
        return _disabled(request)
    try:
        payload = _parse_json_object(
            await request.json(),
            {"versionId", "acceptedPreflightRunId", "expectedRowVersion", "reason"},
        )
        expected = _positive_int(payload.get("expectedRowVersion"), "expectedRowVersion")
        template_id = str(request.path_params.get("template_id") or "").strip()
        result = await run_database_write(
            _write_blocking,
            request,
            lambda catalog, _repository, role, organization_id, _owner_type: (
                catalog.publish(
                    organization_id=organization_id,
                    template_id=template_id,
                    version_id=str(payload.get("versionId") or "").strip(),
                    accepted_preflight_run_id=str(
                        payload.get("acceptedPreflightRunId") or ""
                    ).strip(),
                    expected_row_version=expected,
                    actor_user_id=role.user_id,
                    reason=payload.get("reason"),
                    request=request,
                )
            ),
        )
        return JSONResponse(_public_result(result))
    except Exception as error:  # noqa: BLE001 - bounded HTTP error adapter.
        return _handle(request, error, "word_template_catalog_publish")


async def restore_catalog_template_api(request):
    if not catalog_enabled():
        return _disabled(request)
    try:
        payload = _parse_json_object(
            await request.json(),
            {"sourceVersionId", "expectedRowVersion", "reason"},
        )
        expected = _positive_int(payload.get("expectedRowVersion"), "expectedRowVersion")
        template_id = str(request.path_params.get("template_id") or "").strip()
        result = await run_database_write(
            _write_blocking,
            request,
            lambda catalog, _repository, role, organization_id, _owner_type: (
                catalog.restore_as_draft(
                    organization_id=organization_id,
                    template_id=template_id,
                    source_version_id=str(payload.get("sourceVersionId") or "").strip(),
                    expected_row_version=expected,
                    actor_user_id=role.user_id,
                    reason=payload.get("reason"),
                    request=request,
                )
            ),
        )
        return JSONResponse(_public_result(result), status_code=201)
    except Exception as error:  # noqa: BLE001 - bounded HTTP error adapter.
        return _handle(request, error, "word_template_catalog_restore")


def _authorized_usage(repository, role, organization_id, usage):
    allowed_artifacts = []
    type_map = {
        "kehoach": ("kehoach", "ke_hoach_lcnt"),
        "ke_hoach_lcnt": ("kehoach", "ke_hoach_lcnt"),
        "goithau": ("goithau", "goi_thau"),
        "goi_thau": ("goithau", "goi_thau"),
    }
    unknown = set(usage.get("unknownProviders") or ())
    for artifact in usage.get("generatedArtifacts") or ():
        mapping = type_map.get(str(artifact.get("recordType") or ""))
        if mapping is None or not artifact.get("recordId"):
            unknown.add("generatedArtifactRecord")
            continue
        if can_read_record(
            repository.cursor,
            role,
            role.user_id,
            organization_id,
            mapping[0],
            mapping[1],
            artifact["recordId"],
        ):
            allowed_artifacts.append(artifact)
    result = dict(usage)
    result["generatedArtifacts"] = allowed_artifacts
    result["unknownProviders"] = sorted(unknown)
    return result


async def get_catalog_usage_api(request):
    if not catalog_enabled():
        return _disabled(request)
    try:
        template_id = str(request.query_params.get("templateId") or "").strip() or None
        version_id = str(request.query_params.get("versionId") or "").strip() or None
        if bool(template_id) == bool(version_id):
            raise CatalogError(fields={"query": "PROVIDE_EXACTLY_ONE_ID"})

        def operation(catalog, repository, role, organization_id, _owner_type):
            usage = catalog.get_usage(
                organization_id, template_id=template_id, version_id=version_id
            )
            return _authorized_usage(repository, role, organization_id, usage)

        result = await run_database_read(
            _read_blocking, request, operation, timeout_seconds=20
        )
        return JSONResponse(_public_result(result), headers={"Cache-Control": "private, no-store"})
    except Exception as error:  # noqa: BLE001 - bounded HTTP error adapter.
        return _handle(request, error, "word_template_catalog_usage")


def _sample_preview_context(document_type):
    sample_plan = {
        "id": "sample-plan", "ma_ke_hoach": "KH-MAU-01",
        "ten_ke_hoach": "Kế hoạch lựa chọn nhà thầu mẫu",
        "phien_ban": 1, "row_version": 1,
    }
    sample_package = {
        "id": "sample-package", "ma_goi_thau": "GT-MAU-01",
        "ten_goi_thau": "Gói thầu mẫu", "phien_ban": 1,
        "row_version": 1,
    }
    return {
        "ke_hoach": sample_plan,
        "ke_hoach_versions": [sample_plan],
        "goi_thau": [sample_package] if document_type == "plan" else sample_package,
        "goi_thau_trong_ke_hoach": [sample_package],
        "goi_thau_versions": [sample_package],
        "user": {"ho_ten": "Người dùng mẫu"},
        "to_chuc": {"ten_to_chuc": "Đơn vị mẫu"},
        "chu_dau_tu": {"ten_chu_dau_tu": "Chủ đầu tư mẫu"},
        "investor_name": "Chủ đầu tư mẫu",
        "investor_address": "Địa chỉ mẫu",
        "current_time": "2026-08-24T09:00:00+07:00",
        "today": "2026-08-24",
    }


def _prepare_catalog_preview(request, version_id, payload):
    from backend.documents.docx_context_policy import (
        REPORT_DOCUMENT_TYPES,
        seal_docx_context,
    )
    from backend.documents.routes_docx import (
        _load_word_export_policy,
        _prepare_plan_render,
        _prepare_report_render,
    )

    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        role, organization_id, _owner_type = _context(request, cursor)
        if not can_use_word_export(
            cursor, role, role.user_id, organization_id
        ):
            error = CatalogError(fields={"entitlement": "WORD_EXPORT_REQUIRED"})
            error.status_code = 403
            error.code = "WORD_EXPORT_ENTITLEMENT_REQUIRED"
            raise error
        repository = WordTemplateCatalogRepository(cursor)
        version = WordTemplateCatalog(
            repository, ImmutableTemplateStorage()
        ).get_version(organization_id, version_id, include_content=True)
        mode = str(payload.get("mode") or "SAMPLE").strip().upper()
        document_type = str(payload.get("documentType") or "plan").strip()
        if mode not in {"SAMPLE", "RECORD"}:
            raise CatalogError(fields={"mode": "INVALID_VALUE"})
        if document_type != "plan" and document_type not in REPORT_DOCUMENT_TYPES:
            raise CatalogError(fields={"documentType": "INVALID_VALUE"})

        record_type = None
        record_id = None
        record_row_version = None
        if mode == "RECORD":
            record_id = str(payload.get("recordId") or "").strip()
            if not record_id:
                raise CatalogError(fields={"recordId": "REQUIRED"})
            record_type = "ke_hoach_lcnt" if document_type == "plan" else "goi_thau"
            payload_key = "kehoach" if document_type == "plan" else "goithau"
            if not can_read_record(
                cursor, role, role.user_id, organization_id,
                payload_key, record_type, record_id,
            ):
                raise CatalogNotFoundError()
            if document_type == "plan":
                context, manifest, _template, _groups = _prepare_plan_render(
                    record_id, role.user_id, organization_id, role,
                    None, None, True,
                )
                record_row_version = (context.get("ke_hoach") or {}).get(
                    "row_version"
                )
            else:
                context, manifest, _template, _groups = _prepare_report_render(
                    record_id, role.user_id, organization_id, role,
                    document_type, None, None, True,
                )
                record_row_version = (context.get("goi_thau") or {}).get(
                    "row_version"
                )
        else:
            capabilities, mappings = _load_word_export_policy(
                role, role.user_id, organization_id, document_type
            )
            context, manifest = seal_docx_context(
                document_type,
                _sample_preview_context(document_type),
                mappings,
                capabilities,
                organization_id=organization_id,
            )
        return {
            "role": role,
            "organizationId": organization_id,
            "version": version,
            "mode": mode,
            "documentType": document_type,
            "recordType": record_type,
            "recordId": record_id,
            "recordRowVersion": record_row_version,
            "context": context,
            "manifest": manifest,
        }
    finally:
        connection.close()


async def preview_catalog_version_api(request):
    if not catalog_enabled():
        return _disabled(request)
    try:
        payload = _parse_json_object(
            await request.json(), {"mode", "documentType", "recordId"}
        )
        version_id = str(request.path_params.get("version_id") or "").strip()
        prepared = await run_database_read(
            _prepare_catalog_preview,
            request,
            version_id,
            payload,
            timeout_seconds=30,
        )
        version = prepared["version"]
        content = await run_document_job_async(
            "render_docx",
            {
                "template_content": version["content"],
                "context": prepared["context"],
                "context_manifest": prepared["manifest"],
            },
            timeout_seconds=60,
        )
        log_audit(
            "document.word_template_previewed",
            actor_user_id=prepared["role"].user_id,
            organization_id=prepared["organizationId"],
            target_type=prepared["recordType"] or "word_template_version",
            target_id=prepared["recordId"] or version_id,
            request=request,
            metadata={
                "templateVersionId": version_id,
                "templateSha256": version["sha256"],
                "artifactSha256": hashlib.sha256(content).hexdigest(),
                "previewMode": prepared["mode"],
                "documentType": prepared["documentType"],
                "recordRowVersion": prepared["recordRowVersion"],
            },
            required=True,
        )
        filename = f"preview-{version['versionNo']}-{prepared['documentType']}.docx"
        return StreamingResponse(
            BytesIO(content),
            media_type=(
                "application/vnd.openxmlformats-officedocument."
                "wordprocessingml.document"
            ),
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except Exception as error:  # noqa: BLE001 - bounded HTTP error adapter.
        return _handle(request, error, "word_template_catalog_preview")


def _handle(request, error, context):
    if isinstance(error, CatalogError):
        payload_fields = dict(error.fields)
        current = getattr(error, "current", None)
        if current is not None:
            payload_fields["current"] = _json_safe(current)
        return error_response(
            request,
            error.code,
            "Yêu cầu vòng đời biểu mẫu Word không hợp lệ.",
            status_code=error.status_code,
            fields=payload_fields,
        )
    if isinstance(error, OrgPermissionError):
        return error_response(
            request, "ORG_ACCESS_DENIED", "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    if isinstance(error, (ValueError, DocumentWorkerError)):
        return error_response(
            request, "WORD_TEMPLATE_CATALOG_INVALID", str(error)[:500],
            status_code=400,
        )
    if isinstance(error, BlockingIOBusyError):
        return error_response(
            request, "DATABASE_QUEUE_FULL", "Hệ thống đang bận. Vui lòng thử lại.",
            status_code=503,
        )
    if isinstance(error, BlockingIOTimeoutError):
        return error_response(
            request, "DATABASE_READ_TIMEOUT", "Yêu cầu vượt quá thời gian chờ.",
            status_code=503,
        )
    if isinstance(error, (DatabaseError, OSError, RuntimeError, TypeError, KeyError)):
        return log_and_error(
            request, error, context, "WORD_TEMPLATE_CATALOG_FAILED",
            "Không thể xử lý vòng đời biểu mẫu Word.",
        )
    raise error


def word_template_catalog_routes(Route):
    return [
        Route("/api/word-template-catalog", list_catalog_templates_api, methods=["GET"]),
        Route("/api/word-template-catalog", create_catalog_template_api, methods=["POST"]),
        Route(
            "/api/word-template-catalog/{template_id}/versions",
            list_catalog_versions_api,
            methods=["GET"],
        ),
        Route(
            "/api/word-template-catalog/{template_id}/drafts",
            create_catalog_draft_api,
            methods=["POST"],
        ),
        Route(
            "/api/word-template-catalog/{template_id}/publish",
            publish_catalog_template_api,
            methods=["POST"],
        ),
        Route(
            "/api/word-template-catalog/{template_id}/restore",
            restore_catalog_template_api,
            methods=["POST"],
        ),
        Route(
            "/api/word-template-catalog/versions/{version_id}",
            get_catalog_version_api,
            methods=["GET"],
        ),
        Route(
            "/api/word-template-catalog/versions/{version_id}/preflight",
            run_catalog_preflight_api,
            methods=["POST"],
        ),
        Route(
            "/api/word-template-catalog/versions/{version_id}/preview",
            preview_catalog_version_api,
            methods=["POST"],
        ),
        Route(
            "/api/word-template-catalog/usage",
            get_catalog_usage_api,
            methods=["GET"],
        ),
    ]
