from backend.db.db_helper import DatabaseError
import hashlib
import os
import re
import shutil
import unicodedata
from io import BytesIO
from pathlib import Path
from urllib.parse import quote
from zipfile import ZIP_STORED, ZipFile
from starlette.responses import FileResponse, StreamingResponse, JSONResponse

from backend.shared.helpers import (
    database,
    verify_session,
    clean_id,
    get_active_org,
    OrgPermissionError,
    log_audit,
)
from backend.shared.access_policy import (
    can_upload_workspace_assets,
    can_manage_word_config,
    can_read_word_config,
    can_read_record,
    resolve_document_export_capabilities,
)
from backend.shared.workspace_scope import is_personal_scope_for_user
from backend.shared.subscription_policy import can_use_word_export
from backend.shared.logging_utils import error_response, get_request_id, log_and_error
from backend.shared.request_validation import read_json_object, validate_or_response
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOTimeoutError,
    run_blocking_io,
)
from backend.shared.database_io import run_database_read
from backend.documents import custom_exporter
from backend.documents.document_worker import (
    DocumentWorkerError,
    DocumentWorkerInputError,
    run_document_job,
    run_document_job_async,
)
from backend.documents.upload_spooling import spooled_upload
import backend.documents.docx_service as docx_service
from backend.documents.docx_bid_context_service import (
    enrich_context_with_filtered_bidders,
    enrich_context_with_lot_summaries,
)
from backend.documents.docx_context_policy import (
    REPORT_DOCUMENT_TYPES,
    filter_mapping_rows,
    seal_docx_context,
    sensitive_capability_groups_present,
    validate_mapping_definition,
)
from backend.documents.docx_formula_service import apply_computed_mappings
from backend.documents.docx_mapping_service import apply_custom_mappings, lowercase_partner_identity_codes
from backend.documents.word_mapping_registry import (
    delete_word_mapping,
    reset_word_mapping,
    resolve_word_mappings,
    save_word_mapping,
)
from backend.documents.word_publication_policy import (
    WORD_PUBLICATION_DOCUMENT_BY_ID,
    WORD_PUBLICATION_DOCUMENT_IDS,
    is_word_publication_document_applicable,
    public_word_publication_definitions,
)
from backend.documents.export_policy_registry import governed_export
import uuid

LEGACY_MANAGED_TEMPLATES = {
    'mau_bao_cao_dau_thau.docx',
    'mau_hop_dong_lcnt.docx',
}
SHARED_TEMPLATES = LEGACY_MANAGED_TEMPLATES
MAX_TEMPLATE_UPLOAD_BYTES = 10 * 1024 * 1024
COMPUTED_SOURCE_TABLE = '__computed__'

_CONTRACT_CLASSIFICATION_BY_PUBLICATION_TYPE = {
    "consultant_evaluation_step_1": "tu van",
    "consultant_evaluation_step_2": "tu van",
    "consultant_appraisal_step_1": "tham dinh",
    "consultant_appraisal_step_2": "tham dinh",
}


def _normalized_contract_classification(value):
    normalized = unicodedata.normalize("NFKD", str(value or "")).casefold()
    normalized = "".join(
        character
        for character in normalized
        if not unicodedata.combining(character)
    )
    return " ".join(normalized.replace("đ", "d").split())


def _scope_contracts_for_word_publication(context, publication_type):
    expected_classification = _CONTRACT_CLASSIFICATION_BY_PUBLICATION_TYPE.get(
        publication_type
    )
    if expected_classification is None:
        return

    contracts = context.get("hop_dong_list")
    if not isinstance(contracts, list):
        context["hop_dong_list"] = []
        return

    context["hop_dong_list"] = [
        contract
        for contract in contracts
        if isinstance(contract, dict)
        and _normalized_contract_classification(
            contract.get("phan_loai") or contract.get("phanLoai")
        )
        == expected_classification
    ]


def _docx_error(request, exception, context):
    if isinstance(exception, custom_exporter.WordTemplateConfigConflictError):
        request_id = get_request_id(request)
        current_revision = exception.current_revision
        return JSONResponse(
            {
                "code": "WORD_TEMPLATE_CONFIG_CONFLICT",
                "message": "Cấu hình biểu mẫu Word đã thay đổi. Vui lòng tải lại.",
                "error": "Cấu hình biểu mẫu Word đã thay đổi. Vui lòng tải lại.",
                "currentRevision": current_revision,
                "fields": {"currentRevision": current_revision},
                "requestId": request_id,
            },
            status_code=409,
            headers={"X-Request-ID": request_id},
        )
    if isinstance(exception, OrgPermissionError):
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    if isinstance(exception, FileNotFoundError):
        return error_response(
            request,
            "DOCX_TEMPLATE_NOT_FOUND",
            "Không tìm thấy mẫu Word.",
            status_code=404,
        )
    if isinstance(exception, FileExistsError):
        return error_response(
            request,
            "DOCX_TEMPLATE_ALREADY_EXISTS",
            "Tên biểu mẫu đã tồn tại.",
            status_code=409,
        )
    if isinstance(exception, DocumentWorkerInputError):
        detail = str(exception or '').strip()
        return error_response(
            request,
            "DOCX_INPUT_INVALID",
            detail or "Tệp hoặc mẫu Word không hợp lệ.",
            status_code=422,
        )
    if isinstance(exception, ValueError):
        return error_response(
            request,
            "DOCX_INPUT_INVALID",
            "Tệp hoặc dữ liệu Word không hợp lệ.",
            status_code=400,
        )
    if isinstance(exception, DocumentWorkerError):
        return log_and_error(
            request,
            exception,
            context,
            "DOCUMENT_WORKER_UNAVAILABLE",
            "Dịch vụ xử lý tài liệu tạm thời không khả dụng.",
            status_code=503,
        )
    return log_and_error(
        request,
        exception,
        context,
        "DOCX_OPERATION_FAILED",
        "Không thể xử lý yêu cầu Word.",
    )


def _current_sync_version(organization_id):
    conn = database.get_connection()
    try:
        row = conn.execute(
            "SELECT current_version FROM sync_metadata WHERE organization_id = ?",
            (organization_id,),
        ).fetchone()
        if row is None:
            raise ValueError("Không tìm thấy phiên bản đồng bộ của tổ chức.")
        return int(row[0])
    finally:
        conn.close()


def _validate_export_snapshot(request, organization_id):
    raw_version = request.query_params.get('snapshotVersion')
    if raw_version is None or raw_version == '':
        return None, JSONResponse(
            {
                "error": "Thiếu phiên bản dữ liệu để xuất tệp.",
                "code": "EXPORT_SNAPSHOT_REQUIRED",
            },
            status_code=428,
        )
    try:
        expected_version = int(raw_version)
        if expected_version < 0 or str(expected_version) != str(raw_version).strip():
            raise ValueError
    except (TypeError, ValueError):
        return None, JSONResponse(
            {
                "error": "Phiên bản dữ liệu không hợp lệ.",
                "code": "EXPORT_SNAPSHOT_INVALID",
            },
            status_code=400,
        )

    current_version = _current_sync_version(organization_id)
    if current_version != expected_version:
        return None, JSONResponse(
            {
                "error": "Dữ liệu đã thay đổi. Vui lòng đồng bộ lại trước khi xuất tệp.",
                "code": "EXPORT_SNAPSHOT_STALE",
                "currentSyncVersion": current_version,
            },
            status_code=409,
        )
    return expected_version, None


def _ensure_export_snapshot_unchanged(organization_id, expected_version):
    current_version = _current_sync_version(organization_id)
    if current_version == expected_version:
        return None
    return JSONResponse(
        {
            "error": "Dữ liệu đã thay đổi trong khi tạo tệp. Vui lòng thử lại.",
            "code": "EXPORT_SNAPSHOT_CHANGED",
            "currentSyncVersion": current_version,
        },
        status_code=409,
    )


def _can_export_record(role_or_err, org_name, payload_key, table_name, record_id):
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        return (
            can_use_word_export(
                cursor, role_or_err, role_or_err.user_id, org_name
            )
            and can_read_record(
                cursor,
                role_or_err,
                role_or_err.user_id,
                org_name,
                payload_key,
                table_name,
                record_id,
            )
        )
    finally:
        conn.close()


def _word_export_subscription_response(role_or_err, organization_id):
    conn = database.get_connection()
    try:
        enabled = can_use_word_export(
            conn.cursor(), role_or_err, role_or_err.user_id, organization_id
        )
    finally:
        conn.close()
    if enabled:
        return None
    return JSONResponse(
        {
            "error": "Phạm vi đang làm việc chưa có gói trả phí hoạt động để xuất Word.",
            "code": "WORD_EXPORT_SUBSCRIPTION_REQUIRED",
        },
        status_code=403,
    )


def _word_config_access_response(request, role_or_err, *, write=False):
    organization_id = get_active_org(request, role_or_err.user_id)
    conn = database.get_connection()
    try:
        policy = can_manage_word_config if write else can_read_word_config
        allowed = policy(conn.cursor(), role_or_err, role_or_err.user_id, organization_id)
    finally:
        conn.close()
    if allowed:
        return None
    return JSONResponse(
        {
            "error": "Bạn chưa có quyền hoặc gói trả phí để quản lý biểu mẫu Word.",
            "code": "WORD_CONFIG_ACCESS_REQUIRED",
        },
        status_code=403,
    )


def _word_template_upload_access_response(request, role_or_err, organization_id):
    conn = database.get_connection()
    try:
        allowed = can_upload_workspace_assets(
            conn.cursor(),
            role_or_err,
            role_or_err.user_id,
            organization_id,
        )
    finally:
        conn.close()
    if allowed:
        return None
    return JSONResponse(
        {
            "error": "Chỉ Quản lý của tổ chức được tải lên biểu mẫu Word.",
            "code": "WORD_TEMPLATE_UPLOAD_MANAGER_REQUIRED",
        },
        status_code=403,
    )


def _word_template_scope(user_id, organization_id):
    if is_personal_scope_for_user(organization_id, user_id):
        return "personal", user_id
    return "organization", organization_id

def _safe_filename(value, fallback='download.docx'):
    name = os.path.basename(str(value or fallback)).strip()
    name = re.sub(r'[^A-Za-z0-9_.-]+', '_', name)
    name = name.strip('._')
    return name or fallback


def _content_disposition(filename):
    safe_name = _safe_filename(filename)
    encoded_name = quote(str(filename or safe_name), safe='')
    return f"attachment; filename={safe_name}; filename*=UTF-8''{encoded_name}"


def _normalize_custom_template_filename(value):
    name = unicodedata.normalize('NFC', str(value or '')).strip()
    if not name:
        raise ValueError('Tên biểu mẫu không được để trống')
    if not name.lower().endswith('.docx'):
        name = f'{name}.docx'
    if os.path.basename(name) != name or re.search(r'[<>:"/\\|?*\x00-\x1f]', name):
        raise ValueError('Tên biểu mẫu chứa ký tự không hợp lệ')
    name = name.strip(' .')
    if len(name) > 160:
        raise ValueError('Tên biểu mẫu không được vượt quá 160 ký tự')
    if not name or name.lower() == '.docx':
        raise ValueError('Tên biểu mẫu không được để trống')
    if os.path.splitext(name)[0].upper() in {
        'CON', 'PRN', 'AUX', 'NUL',
        *(f'COM{i}' for i in range(1, 10)),
        *(f'LPT{i}' for i in range(1, 10)),
    }:
        raise ValueError('Tên biểu mẫu không hợp lệ')
    return name


def _resolve_template_path(owner_type, owner_id, filename):
    if not str(filename or '').strip():
        raise FileNotFoundError('Chưa có biểu mẫu Word đang được sử dụng')
    safe_name = _normalize_custom_template_filename(filename)
    scope_dir = os.path.realpath(
        custom_exporter.get_scope_template_dir(
            owner_type,
            owner_id,
            create=False,
        )
    )
    scoped_path = os.path.realpath(os.path.join(scope_dir, safe_name))
    if not scoped_path.startswith(scope_dir + os.sep):
        raise ValueError('Tên mẫu không hợp lệ')
    if os.path.isfile(scoped_path):
        return scoped_path, safe_name
    if safe_name in SHARED_TEMPLATES:
        shared_dir = os.path.realpath(custom_exporter.TEMPLATE_DIR)
        shared_path = os.path.realpath(os.path.join(shared_dir, safe_name))
        if shared_path.startswith(shared_dir + os.sep) and os.path.isfile(shared_path):
            return shared_path, safe_name
    raise FileNotFoundError('Không tìm thấy mẫu Word')


def _resolve_custom_template_path(owner_type, owner_id, filename):
    safe_name = _normalize_custom_template_filename(filename)
    scope_dir = os.path.realpath(
        custom_exporter.get_scope_template_dir(owner_type, owner_id, create=False)
    )
    scoped_path = os.path.realpath(os.path.join(scope_dir, safe_name))
    if not scoped_path.startswith(scope_dir + os.sep):
        raise ValueError('Tên mẫu không hợp lệ')
    if os.path.isfile(scoped_path):
        return scoped_path, safe_name
    if safe_name.lower() in LEGACY_MANAGED_TEMPLATES:
        shared_dir = os.path.realpath(custom_exporter.TEMPLATE_DIR)
        shared_path = os.path.realpath(os.path.join(shared_dir, safe_name))
        if shared_path.startswith(shared_dir + os.sep) and os.path.isfile(shared_path):
            return shared_path, safe_name
    raise FileNotFoundError('Không tìm thấy mẫu Word tùy chỉnh')


def _persist_scoped_template_from_path(
    owner_type,
    owner_id,
    filename,
    source_path,
    *,
    audit_callback=None,
):
    filename = _normalize_custom_template_filename(filename)
    scope_dir = os.path.realpath(
        custom_exporter.get_scope_template_dir(owner_type, owner_id)
    )
    dest_path = os.path.realpath(os.path.join(scope_dir, filename))
    if not dest_path.startswith(scope_dir + os.sep):
        raise ValueError("Tên tệp không hợp lệ")
    with custom_exporter.template_scope_file_lock(
        owner_id,
        owner_type=owner_type,
    ):
        if any(
            existing_name.casefold() == filename.casefold()
            for existing_name in os.listdir(scope_dir)
        ):
            raise FileExistsError('Tên biểu mẫu đã tồn tại')
        try:
            with open(source_path, 'rb') as source, open(dest_path, 'xb') as destination:
                shutil.copyfileobj(source, destination)
            if audit_callback is not None:
                audit_callback(
                    filename,
                    custom_exporter.get_template_config_revision(
                        owner_id,
                        owner_type=owner_type,
                    ),
                )
        except FileExistsError:
            raise FileExistsError('Tên biểu mẫu đã tồn tại') from None
        except Exception:
            if os.path.exists(dest_path):
                os.remove(dest_path)
            raise
    return dest_path


def _replace_file_content(path, content):
    temporary_path = f"{path}.{uuid.uuid4().hex}.sanitize"
    try:
        with open(temporary_path, 'xb') as destination:
            destination.write(content)
        os.replace(temporary_path, path)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)


def _replace_scoped_template_from_path(owner_type, owner_id, filename, source_path):
    dest_path, _ = _update_scoped_template(
        owner_type,
        owner_id,
        filename,
        filename,
        source_path=source_path,
    )
    return dest_path


def _update_scoped_template(
    owner_type,
    owner_id,
    filename,
    new_filename,
    *,
    source_path=None,
    audit_callback=None,
):
    with custom_exporter.template_scope_file_lock(
        owner_id,
        owner_type=owner_type,
    ):
        current_path, current_name = _resolve_custom_template_path(
            owner_type, owner_id, filename
        )
        original_content = Path(current_path).read_bytes()
        next_name = _normalize_custom_template_filename(new_filename or current_name)
        scope_dir = os.path.realpath(
            custom_exporter.get_scope_template_dir(owner_type, owner_id)
        )
        next_path = os.path.abspath(os.path.join(scope_dir, next_name))
        common_dir = os.path.normcase(os.path.commonpath([scope_dir, next_path]))
        if common_dir != os.path.normcase(scope_dir):
            raise ValueError('Tên biểu mẫu không hợp lệ')
        same_path = os.path.normcase(next_path) == os.path.normcase(current_path)
        if not same_path and os.path.exists(next_path):
            raise FileExistsError('Tên biểu mẫu đã tồn tại')

        try:
            if source_path:
                temp_path = os.path.join(scope_dir, f'.{next_name}.{uuid.uuid4().hex}.tmp')
                try:
                    shutil.copyfile(source_path, temp_path)
                    os.replace(temp_path, next_path)
                finally:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
                if not same_path:
                    os.remove(current_path)
            elif not same_path:
                os.replace(current_path, next_path)
            elif current_name != next_name:
                case_temp_path = os.path.join(
                    scope_dir, f'.{current_name}.{uuid.uuid4().hex}.rename'
                )
                os.replace(current_path, case_temp_path)
                try:
                    os.replace(case_temp_path, next_path)
                except OSError:
                    os.replace(case_temp_path, current_path)
                    raise

            if current_name != next_name:
                custom_exporter.replace_template_reference(
                    current_name,
                    next_name,
                    owner_id,
                    owner_type=owner_type,
                    commit_callback=(
                        (lambda revision: audit_callback(next_name, revision))
                        if audit_callback is not None
                        else None
                    ),
                )
            elif audit_callback is not None:
                audit_callback(
                    next_name,
                    custom_exporter.get_template_config_revision(
                        owner_id,
                        owner_type=owner_type,
                    ),
                )
        except Exception:
            if not same_path and os.path.exists(next_path):
                os.remove(next_path)
            _replace_file_content(current_path, original_content)
            raise
        return next_path, next_name


def _delete_scoped_template(
    owner_type,
    owner_id,
    filename,
    *,
    audit_callback=None,
):
    with custom_exporter.template_scope_file_lock(
        owner_id,
        owner_type=owner_type,
    ):
        path, safe_name = _resolve_custom_template_path(owner_type, owner_id, filename)
        original_content = Path(path).read_bytes()
        os.remove(path)
        try:
            custom_exporter.replace_template_reference(
                safe_name,
                '',
                owner_id,
                owner_type=owner_type,
                commit_callback=(
                    (lambda revision: audit_callback(safe_name, revision))
                    if audit_callback is not None
                    else None
                ),
            )
        except Exception:
            _replace_file_content(path, original_content)
            raise


def _validate_docx_upload(filename, content, *, deep_validation=True, total_size=None):
    original_name = unicodedata.normalize('NFC', str(filename or '')).strip()
    _, ext = os.path.splitext(original_name)
    if ext.lower() != '.docx':
        raise ValueError('Chỉ cho phép tải lên tệp .docx')
    safe_name = _normalize_custom_template_filename(original_name)
    if not content:
        raise ValueError('Tệp tải lên đang trống')
    if (total_size if total_size is not None else len(content)) > MAX_TEMPLATE_UPLOAD_BYTES:
        raise ValueError('Tệp mẫu vượt quá giới hạn 10MB')
    if deep_validation:
        run_document_job("validate_docx", {"content": content}, timeout_seconds=15)
    return safe_name


def _database_read_unavailable_response(request, *, timed_out=False):
    response = error_response(
        request,
        "DATABASE_READ_TIMEOUT" if timed_out else "DATABASE_READ_QUEUE_FULL",
        "Dữ liệu xuất Word tạm thời chưa sẵn sàng. Vui lòng thử lại sau.",
        status_code=503,
    )
    response.headers["Retry-After"] = "1"
    return response


def _load_word_export_policy(
    role_str,
    user_id,
    organization_id,
    document_type,
):
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        capabilities = resolve_document_export_capabilities(
            cursor,
            role_str,
            user_id,
            organization_id,
        )
        effective = resolve_word_mappings(cursor, organization_id)
        rows = [
            (
                mapping["ten_bien"],
                mapping["source_table"],
                mapping["source_column"],
            )
            for mapping in effective
        ]
        return capabilities, filter_mapping_rows(
            rows, document_type, capabilities
        )
    finally:
        conn.close()


def _resolve_publication_template_paths(
    owner_type,
    owner_id,
    publication_type,
    requested_template_filenames=None,
):
    definition = WORD_PUBLICATION_DOCUMENT_BY_ID.get(publication_type)
    if definition is None:
        raise ValueError("Loại văn bản xuất bản không hợp lệ")
    from backend.documents.template_catalog.compatibility import (
        CatalogPublicationResolver,
        catalog_enabled,
        catalog_mode,
    )
    from backend.documents.template_catalog.repository import (
        WordTemplateCatalogRepository,
    )
    from backend.documents.template_catalog.storage import ImmutableTemplateStorage

    catalog_targets = None
    if catalog_enabled() and catalog_mode() == "cutover":
        organization_id = (
            f"personal:{owner_id}" if owner_type == "personal" else owner_id
        )
        connection = database.get_connection()
        try:
            catalog_targets = CatalogPublicationResolver(
                WordTemplateCatalogRepository(connection.cursor()),
                ImmutableTemplateStorage(),
            ).resolve(organization_id, publication_type)
        finally:
            connection.close()
    if catalog_targets is not None:
        if not catalog_targets:
            raise FileNotFoundError(
                "Chưa chọn biểu mẫu Word đã xuất bản cho loại văn bản này"
            )
        if requested_template_filenames is not None:
            if not isinstance(requested_template_filenames, (list, tuple)):
                raise ValueError("Danh sách file biểu mẫu cần xuất không hợp lệ")
            requested = {
                _normalize_custom_template_filename(value).casefold()
                for value in requested_template_filenames
            }
            assigned = {
                target["legacyAlias"].casefold() for target in catalog_targets
            }
            if not requested or not requested.issubset(assigned):
                raise ValueError(
                    "File biểu mẫu được chọn không được gán cho chức năng này"
                )
            catalog_targets = [
                target for target in catalog_targets
                if target["legacyAlias"].casefold() in requested
            ]
        return [
            {
                "content": target["content"],
                "filename": target["legacyAlias"],
                "source": "catalog-assignment",
                "templateVersionId": target["templateVersionId"],
                "templateSha256": target["sha256"],
            }
            for target in catalog_targets
        ]

    template_names, source = custom_exporter.resolve_publication_templates(
        publication_type,
        owner_id,
        owner_type=owner_type,
        allow_active_fallback=False,
    )
    if not template_names:
        raise FileNotFoundError(
            "Chưa chọn biểu mẫu Word cho loại văn bản này"
        )
    if requested_template_filenames is not None:
        if not isinstance(requested_template_filenames, (list, tuple)):
            raise ValueError("Danh sách file biểu mẫu cần xuất không hợp lệ")
        if not requested_template_filenames:
            raise ValueError("Phải chọn ít nhất một file biểu mẫu để xuất")
        assigned_by_identity = {
            template_name.casefold(): template_name
            for template_name in template_names
        }
        requested_identities = set()
        for filename in requested_template_filenames:
            if not isinstance(filename, str) or not filename.strip():
                raise ValueError("Tên file biểu mẫu cần xuất không hợp lệ")
            safe_name = _normalize_custom_template_filename(filename)
            identity = safe_name.casefold()
            if identity not in assigned_by_identity:
                raise ValueError(
                    "File biểu mẫu được chọn không được gán cho chức năng này"
                )
            requested_identities.add(identity)
        template_names = [
            template_name
            for template_name in template_names
            if template_name.casefold() in requested_identities
        ]
    targets = []
    for template_name in template_names:
        template_path, safe_name = _resolve_template_path(
            owner_type,
            owner_id,
            template_name,
        )
        targets.append({
            "path": template_path,
            "filename": safe_name,
            "source": source,
        })
    return targets


def _resolve_publication_template_path(owner_type, owner_id, publication_type):
    target = _resolve_publication_template_paths(
        owner_type,
        owner_id,
        publication_type,
    )[0]
    return target["path"], target["filename"], target["source"]


def _word_publication_assignment_payload(owner_type, owner_id):
    stored_assignment_sets = custom_exporter.get_template_assignments(
        owner_id,
        owner_type=owner_type,
    )
    enabled_identities = {
        filename.casefold()
        for filename in custom_exporter.get_enabled_templates(
            owner_id,
            owner_type=owner_type,
        )
    }
    assignment_sets = {
        document_type: [
            filename for filename in filenames
            if filename.casefold() in enabled_identities
        ]
        for document_type, filenames in stored_assignment_sets.items()
        if document_type in WORD_PUBLICATION_DOCUMENT_IDS
    }
    assignment_sets = {
        document_type: filenames
        for document_type, filenames in assignment_sets.items()
        if filenames
    }
    configured_active_template = custom_exporter.get_active_template(
        owner_id,
        owner_type=owner_type,
    )
    active_template = (
        configured_active_template
        if configured_active_template.casefold() in enabled_identities
        else ""
    )
    resolved_template_sets = {}
    for definition in WORD_PUBLICATION_DOCUMENT_BY_ID.values():
        template_names, source = custom_exporter.resolve_publication_templates(
            definition.id,
            owner_id,
            owner_type=owner_type,
            allow_active_fallback=False,
        )
        if not template_names:
            continue
        resolved_items = []
        for template_name in template_names:
            try:
                _, safe_name = _resolve_template_path(
                    owner_type,
                    owner_id,
                    template_name,
                )
            except (FileNotFoundError, ValueError):
                continue
            resolved_items.append({
                "filename": safe_name,
                "source": source,
            })
        if resolved_items:
            resolved_template_sets[definition.id] = resolved_items
    assignments = {
        document_type: filenames[0]
        for document_type, filenames in assignment_sets.items()
        if filenames
    }
    resolved = {
        document_type: templates[0]
        for document_type, templates in resolved_template_sets.items()
        if templates
    }
    return {
        "revision": custom_exporter.get_template_config_revision(
            owner_id,
            owner_type=owner_type,
        ),
        "documentTypes": public_word_publication_definitions(),
        "assignments": assignments,
        "assignmentSets": assignment_sets,
        "resolvedTemplates": resolved,
        "resolvedTemplateSets": resolved_template_sets,
        "activeTemplate": active_template,
    }


def _catalog_assignment_payload(organization_id, owner_type):
    from backend.documents.template_catalog.repository import (
        WordTemplateCatalogRepository,
    )

    connection = database.get_connection()
    try:
        repository = WordTemplateCatalogRepository(connection.cursor())
        row = connection.execute(
            """SELECT revision FROM word_template_assignment_config
                WHERE organization_id = ?""",
            (organization_id,),
        ).fetchone()
        revision = int(row[0]) if row else 0
        stored = repository.list_assignment_sets(organization_id)
        assignment_sets = {
            document_type: [item["legacyAlias"] for item in items]
            for document_type, items in stored.items()
            if items and all(item["publishedVersionId"] for item in items)
        }
        resolved_sets = {
            document_type: [
                {"filename": alias, "source": "catalog-assignment"}
                for alias in aliases
            ]
            for document_type, aliases in assignment_sets.items()
        }
        return {
            "revision": revision,
            "documentTypes": public_word_publication_definitions(),
            "assignments": {
                key: values[0] for key, values in assignment_sets.items()
            },
            "assignmentSets": assignment_sets,
            "resolvedTemplates": {
                key: values[0] for key, values in resolved_sets.items()
            },
            "resolvedTemplateSets": resolved_sets,
            "activeTemplate": "",
        }
    finally:
        connection.close()


def _save_catalog_assignments(
    request, organization_id, owner_type, actor_user_id,
    assignments, expected_revision,
):
    from backend.documents.template_catalog.repository import (
        WordTemplateCatalogRepository,
    )
    from backend.documents.template_catalog.service import CatalogConflictError

    unknown_ids = sorted(set(assignments) - WORD_PUBLICATION_DOCUMENT_IDS)
    if unknown_ids:
        raise ValueError("Loại văn bản xuất bản không hợp lệ")
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        repository = WordTemplateCatalogRepository(connection.cursor())
        template_ids_by_document = {}
        aliases_by_document = {}
        for document_type, filenames in assignments.items():
            if filenames in (None, "", []):
                continue
            candidates = [filenames] if isinstance(filenames, str) else filenames
            if not isinstance(candidates, list):
                raise ValueError("Danh sách biểu mẫu Word không hợp lệ")
            ids = []
            aliases = []
            seen = set()
            for filename in candidates:
                safe_alias = _normalize_custom_template_filename(filename)
                template = repository.get_by_alias(organization_id, safe_alias)
                if template is None or not template["publishedVersionId"]:
                    raise ValueError("Biểu mẫu chưa có phiên bản phát hành")
                if template["id"] in seen:
                    continue
                seen.add(template["id"])
                ids.append(template["id"])
                aliases.append(template["legacyAlias"])
            if ids:
                template_ids_by_document[document_type] = ids
                aliases_by_document[document_type] = aliases
        current, error = repository.replace_assignments_cas(
            organization_id=organization_id,
            owner_type=owner_type,
            template_ids_by_document=template_ids_by_document,
            aliases_by_document=aliases_by_document,
            expected_revision=expected_revision,
            actor_user_id=actor_user_id,
        )
        if error == "STALE":
            raise CatalogConflictError(current=current)
        log_audit(
            "document.word_template_assignments_updated",
            actor_user_id=actor_user_id,
            organization_id=organization_id,
            target_type="word_template_assignment_config",
            target_id=current["id"],
            request=request,
            metadata={
                "assigned_document_types": sorted(aliases_by_document),
                "assignment_revision": current["revision"],
            },
            cursor=repository.cursor,
            required=True,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return _catalog_assignment_payload(organization_id, owner_type)


def _save_word_publication_assignments(
    owner_type,
    owner_id,
    assignments,
    expected_revision,
    audit_intent_callback=None,
    audit_callback=None,
):
    unknown_ids = sorted(set(assignments) - WORD_PUBLICATION_DOCUMENT_IDS)
    if unknown_ids:
        raise ValueError("Loại văn bản xuất bản không hợp lệ")
    normalized = {}
    for document_type, filenames in assignments.items():
        if filenames in (None, "", []):
            continue
        candidates = [filenames] if isinstance(filenames, str) else filenames
        if not isinstance(candidates, list):
            raise ValueError("Danh sách biểu mẫu Word không hợp lệ")
        safe_names = []
        seen = set()
        for filename in candidates:
            if not isinstance(filename, str):
                raise ValueError("Tên biểu mẫu Word không hợp lệ")
            safe_name = _normalize_custom_template_filename(filename)
            _resolve_template_path(owner_type, owner_id, safe_name)
            if not custom_exporter.is_template_enabled(
                safe_name,
                owner_id,
                owner_type=owner_type,
            ):
                raise ValueError(
                    "Biểu mẫu Word chưa được cho phép sử dụng"
                )
            identity = safe_name.casefold()
            if identity not in seen:
                seen.add(identity)
                safe_names.append(safe_name)
        if safe_names:
            normalized[document_type] = safe_names
    if audit_intent_callback is not None:
        audit_intent_callback(normalized, expected_revision)
    custom_exporter.set_template_assignments(
        normalized,
        owner_id,
        owner_type=owner_type,
        expected_revision=expected_revision,
        commit_callback=(
            (lambda revision: audit_callback(normalized, revision))
            if audit_callback is not None
            else None
        ),
    )
    return _word_publication_assignment_payload(owner_type, owner_id)


def _prepare_plan_render(
    plan_id,
    user_id,
    organization_id,
    role_str,
    publication_type=None,
    requested_template_filenames=None,
    skip_template_resolution=False,
):
    capabilities, mappings = _load_word_export_policy(
        role_str, user_id, organization_id, "plan"
    )
    context, record_revision = docx_service.build_plan_context_snapshot(
        plan_id, user_id, organization_id, capabilities
    )
    enrich_context_with_lot_summaries(context)
    enrich_context_with_filtered_bidders(context)
    apply_custom_mappings(context, mappings)
    apply_computed_mappings(context, mappings)
    lowercase_partner_identity_codes(context, mappings)
    context, manifest = seal_docx_context(
        "plan",
        context,
        mappings,
        capabilities,
        organization_id=organization_id,
    )
    manifest["record_revision"] = record_revision
    sensitive_groups = sorted(sensitive_capability_groups_present(context))
    owner_type, owner_id = _word_template_scope(user_id, organization_id)
    if skip_template_resolution:
        template_path = None
    elif publication_type:
        definition = WORD_PUBLICATION_DOCUMENT_BY_ID.get(publication_type)
        if (
            definition is None
            or definition.scope != "plan"
            or definition.context_type != "plan"
            or not is_word_publication_document_applicable(publication_type)
        ):
            raise ValueError("Loại văn bản không áp dụng cho Kế hoạch này")
        template_path = _resolve_publication_template_paths(
            owner_type,
            owner_id,
            publication_type,
            requested_template_filenames,
        )
    else:
        active_template = custom_exporter.get_active_template(
            owner_id,
            owner_type=owner_type,
        )
        if not custom_exporter.is_template_enabled(
            active_template,
            owner_id,
            owner_type=owner_type,
        ):
            raise FileNotFoundError(
                "Biểu mẫu Word đang tạm ngừng sử dụng"
            )
        template_path, _ = _resolve_template_path(
            owner_type, owner_id, active_template
        )
    return context, manifest, template_path, sensitive_groups


def _prepare_report_render(
    package_id,
    user_id,
    organization_id,
    role_str,
    document_type,
    publication_type=None,
    requested_template_filenames=None,
    skip_template_resolution=False,
):
    capabilities, mappings = _load_word_export_policy(
        role_str, user_id, organization_id, document_type
    )
    context, record_revision = docx_service.build_report_context_snapshot(
        package_id,
        user_id,
        organization_id,
        document_type,
        capabilities,
    )
    _scope_contracts_for_word_publication(context, publication_type)
    enrich_context_with_lot_summaries(context)
    enrich_context_with_filtered_bidders(context)
    apply_custom_mappings(context, mappings)
    apply_computed_mappings(context, mappings)
    lowercase_partner_identity_codes(context, mappings)
    context, manifest = seal_docx_context(
        document_type,
        context,
        mappings,
        capabilities,
        organization_id=organization_id,
    )
    manifest["record_revision"] = record_revision
    sensitive_groups = sorted(sensitive_capability_groups_present(context))
    owner_type, owner_id = _word_template_scope(user_id, organization_id)
    if skip_template_resolution:
        template_path = None
    elif publication_type:
        definition = WORD_PUBLICATION_DOCUMENT_BY_ID.get(publication_type)
        package_record = context.get("goi_thau") or {}
        if (
            definition is None
            or definition.scope != "package"
            or definition.context_type != document_type
            or not is_word_publication_document_applicable(
                publication_type,
                package_record,
            )
        ):
            raise ValueError("Loại văn bản không áp dụng cho Gói thầu này")
        template_path = _resolve_publication_template_paths(
            owner_type,
            owner_id,
            publication_type,
            requested_template_filenames,
        )
    else:
        active_template = custom_exporter.get_active_template(
            owner_id,
            owner_type=owner_type,
        )
        if not custom_exporter.is_template_enabled(
            active_template,
            owner_id,
            owner_type=owner_type,
        ):
            raise FileNotFoundError(
                "Biểu mẫu Word đang tạm ngừng sử dụng"
            )
        template_path, _ = _resolve_template_path(
            owner_type, owner_id, active_template
        )
    return context, manifest, template_path, sensitive_groups


def _archive_rendered_word_documents(rendered_documents):
    output = BytesIO()
    used_names = set()
    with ZipFile(output, "w", ZIP_STORED) as archive:
        for filename, content in rendered_documents:
            stem, extension = os.path.splitext(filename)
            candidate = filename
            suffix = 2
            while candidate.casefold() in used_names:
                candidate = f"{stem} ({suffix}){extension}"
                suffix += 1
            used_names.add(candidate.casefold())
            archive.writestr(candidate, content)
    return output.getvalue()


async def _render_word_selection(
    template_selection,
    context,
    context_manifest,
    *,
    fallback_filename,
):
    if isinstance(template_selection, list):
        targets = template_selection
    else:
        targets = [{"path": template_selection, "filename": fallback_filename}]
    batch_targets = []
    for target in targets:
        template_payload = (
            {"template_content": target["content"]}
            if "content" in target
            else {"template_path": target["path"]}
        )
        batch_targets.append({
            **template_payload,
            "filename": target.get("filename") or fallback_filename,
        })
    content = await run_document_job_async(
        "render_docx_batch",
        {
            "templates": batch_targets,
            "context": context,
            "context_manifest": context_manifest,
        },
    )
    if len(targets) == 1:
        rendered_filename = batch_targets[0]["filename"]
        rendered_artifacts = [{
            "artifactId": f"word-{uuid.uuid4().hex}",
            "filename": rendered_filename,
            "artifactSha256": hashlib.sha256(content).hexdigest(),
            "templateVersionId": targets[0].get("templateVersionId"),
            "templateSha256": targets[0].get("templateSha256"),
        }]
        return (
            content,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            rendered_filename,
            1,
            rendered_artifacts,
        )
    rendered_artifacts = []
    with ZipFile(BytesIO(content)) as archive:
        entries = archive.infolist()
        if len(entries) != len(targets):
            raise DocumentWorkerError("Gói tài liệu Word trả về không đầy đủ.")
        for target, entry in zip(targets, entries, strict=True):
            rendered_content = archive.read(entry)
            rendered_artifacts.append({
                "artifactId": f"word-{uuid.uuid4().hex}",
                "filename": entry.filename,
                "artifactSha256": hashlib.sha256(rendered_content).hexdigest(),
                "templateVersionId": target.get("templateVersionId"),
                "templateSha256": target.get("templateSha256"),
            })
    archive_filename = f"{os.path.splitext(fallback_filename)[0]}.zip"
    return (
        content,
        "application/zip",
        archive_filename,
        len(targets),
        rendered_artifacts,
    )


def _commit_word_export_audit(
    *, request, actor_user_id, organization_id, target_type, target_id,
    record_row_version, document_type, publication_type, template_count,
    sensitive_groups, rendered_artifacts,
):
    """Bind exact catalog provenance and the required export audit atomically."""

    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        provenance = []
        catalog_artifacts = [
            artifact for artifact in rendered_artifacts
            if artifact.get("templateVersionId") and artifact.get("templateSha256")
        ]
        if catalog_artifacts:
            from backend.documents.template_catalog.repository import (
                WordTemplateCatalogRepository,
            )
            from backend.documents.template_catalog.service import WordTemplateCatalog
            from backend.documents.template_catalog.storage import ImmutableTemplateStorage

            catalog = WordTemplateCatalog(
                WordTemplateCatalogRepository(cursor),
                ImmutableTemplateStorage(),
            )
            for artifact in catalog_artifacts:
                provenance.append(catalog.record_generated_provenance(
                    organization_id=organization_id,
                    artifact_id=artifact["artifactId"],
                    template_version_id=artifact["templateVersionId"],
                    template_sha256=artifact["templateSha256"],
                    record_type=target_type,
                    record_id=target_id,
                    record_row_version=record_row_version,
                    artifact_sha256=artifact["artifactSha256"],
                    actor_user_id=actor_user_id,
                ))
        log_audit(
            "document.word_exported",
            actor_user_id=actor_user_id,
            organization_id=organization_id,
            target_type=target_type,
            target_id=target_id,
            request=request,
            metadata={
                "organization_id": organization_id,
                "document_type": document_type,
                "publication_type": publication_type or None,
                "template_count": template_count,
                "sensitive_capabilities_used": sensitive_groups,
                "catalog_artifact_ids": [item["artifactId"] for item in provenance],
                "catalog_template_version_ids": [
                    item["templateVersionId"] for item in provenance
                ],
            },
            cursor=cursor,
            required=True,
        )
        connection.commit()
        return provenance
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


@governed_export("docx.plan")
async def export_plan_api(request):
    plan_id = clean_id(request.path_params.get('plan_id'))
    publication_type = str(
        request.query_params.get('publicationType') or ''
    ).strip()
    requested_template_filenames = (
        request.query_params.getlist('templateFilename')
        if 'templateFilename' in request.query_params
        else None
    )
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        entitlement_error = _word_export_subscription_response(role_or_err, org_name)
        if entitlement_error is not None:
            return entitlement_error
        snapshot_version, snapshot_error = _validate_export_snapshot(request, org_name)
        if snapshot_error is not None:
            return snapshot_error
        if not _can_export_record(role_or_err, org_name, "kehoach", "ke_hoach_lcnt", plan_id):
            return JSONResponse({"error": "Ban khong co quyen xuat ke hoach nay."}, status_code=403)
        try:
            (
                unified_context,
                context_manifest,
                tpl_path,
                sensitive_groups,
            ) = await run_database_read(
                _prepare_plan_render,
                plan_id,
                user_id,
                org_name,
                role_or_err,
                publication_type or None,
                requested_template_filenames,
                timeout_seconds=30,
            )
        except BlockingIOBusyError:
            return _database_read_unavailable_response(request)
        except BlockingIOTimeoutError:
            return _database_read_unavailable_response(request, timed_out=True)
        fallback_filename = (
            f"Ke_hoach_LCNT_{unified_context['ke_hoach']['ma_ke_hoach']}.docx"
        )
        (
            document_bytes,
            media_type,
            filename,
            template_count,
            rendered_artifacts,
        ) = await _render_word_selection(
            tpl_path,
            unified_context,
            context_manifest,
            fallback_filename=fallback_filename,
        )
        document_stream = BytesIO(document_bytes)

        snapshot_error = _ensure_export_snapshot_unchanged(org_name, snapshot_version)
        if snapshot_error is not None:
            return snapshot_error

        _commit_word_export_audit(
            request=request,
            actor_user_id=user_id,
            organization_id=org_name,
            target_type="ke_hoach_lcnt",
            target_id=plan_id,
            record_row_version=int(context_manifest.get("record_revision") or 1),
            document_type="plan",
            publication_type=publication_type,
            template_count=template_count,
            sensitive_groups=sensitive_groups,
            rendered_artifacts=rendered_artifacts,
        )

        return StreamingResponse(
            document_stream,
            media_type=media_type,
            headers={"Content-Disposition": _content_disposition(filename)}
        )
    except OrgPermissionError as e:
        return _docx_error(request, e, "export_plan_api")
    except DocumentWorkerInputError as e:
        return _docx_error(request, e, "export_plan_api")
    except DocumentWorkerError as e:
        return _docx_error(request, e, "export_plan_api")
    except Exception as e:
        return _docx_error(request, e, "export_plan_api")

@governed_export("docx.package_report")
async def export_report_api(request):
    package_id = clean_id(request.path_params.get('package_id'))
    type_param = request.query_params.get('type', 'evaluation')
    publication_type = str(
        request.query_params.get('publicationType') or ''
    ).strip()
    requested_template_filenames = (
        request.query_params.getlist('templateFilename')
        if 'templateFilename' in request.query_params
        else None
    )
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        entitlement_error = _word_export_subscription_response(role_or_err, org_name)
        if entitlement_error is not None:
            return entitlement_error
        if type_param not in REPORT_DOCUMENT_TYPES:
            return JSONResponse(
                {
                    "error": "Loai bao cao Word khong duoc ho tro.",
                    "code": "DOCX_TYPE_INVALID",
                },
                status_code=400,
            )
        snapshot_version, snapshot_error = _validate_export_snapshot(request, org_name)
        if snapshot_error is not None:
            return snapshot_error
        if not _can_export_record(role_or_err, org_name, "goithau", "goi_thau", package_id):
            return JSONResponse({"error": "Ban khong co quyen xuat goi thau nay."}, status_code=403)
        try:
            (
                unified_context,
                context_manifest,
                tpl_path,
                sensitive_groups,
            ) = await run_database_read(
                _prepare_report_render,
                package_id,
                user_id,
                org_name,
                role_or_err,
                type_param,
                publication_type or None,
                requested_template_filenames,
                timeout_seconds=30,
            )
        except BlockingIOBusyError:
            return _database_read_unavailable_response(request)
        except BlockingIOTimeoutError:
            return _database_read_unavailable_response(request, timed_out=True)
        if type_param in ('contract', 'liquidation'):
            prefix = "Thanh_ly_hop_dong" if type_param == 'liquidation' else "Hop_dong"
            fallback_filename = f"{prefix}_{unified_context['hop_dong'].get('so_hop_dong', 'LCNT')}.docx"
        elif type_param in ['hsmt', 'opening']:
            fallback_filename = f"{type_param.upper()}_{unified_context['goi_thau']['ma_goi_thau']}.docx"
        else:
            fallback_filename = f"Bao_cao_danh_gia_goi_thau_{unified_context['goi_thau']['ma_goi_thau']}.docx"

        (
            document_bytes,
            media_type,
            filename,
            template_count,
            rendered_artifacts,
        ) = await _render_word_selection(
            tpl_path,
            unified_context,
            context_manifest,
            fallback_filename=fallback_filename,
        )
        document_stream = BytesIO(document_bytes)

        snapshot_error = _ensure_export_snapshot_unchanged(org_name, snapshot_version)
        if snapshot_error is not None:
            return snapshot_error

        _commit_word_export_audit(
            request=request,
            actor_user_id=user_id,
            organization_id=org_name,
            target_type="goi_thau",
            target_id=package_id,
            record_row_version=int(context_manifest.get("record_revision") or 1),
            document_type=type_param,
            publication_type=publication_type,
            template_count=template_count,
            sensitive_groups=sensitive_groups,
            rendered_artifacts=rendered_artifacts,
        )

        return StreamingResponse(
            document_stream,
            media_type=media_type,
            headers={"Content-Disposition": _content_disposition(filename)}
        )
    except OrgPermissionError as e:
        return _docx_error(request, e, "export_report_api")
    except DocumentWorkerInputError as e:
        return _docx_error(request, e, "export_report_api")
    except DocumentWorkerError as e:
        return _docx_error(request, e, "export_report_api")
    except Exception as e:
        return _docx_error(request, e, "export_report_api")


async def list_templates_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        access_error = _word_config_access_response(request, role_or_err)
        if access_error is not None:
            return access_error
        organization_id = get_active_org(request, user_id)
        owner_type, owner_id = _word_template_scope(user_id, organization_id)

        templates = await run_blocking_io(
            custom_exporter.list_templates,
            owner_id,
            owner_type=owner_type,
            timeout_seconds=5,
        )
        return JSONResponse(templates)
    except Exception as e:
        return _docx_error(request, e, "list_templates_api")


async def get_word_publication_template_assignments_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        access_error = _word_config_access_response(request, role_or_err)
        if access_error is not None:
            return access_error
        organization_id = get_active_org(request, user_id)
        owner_type, owner_id = _word_template_scope(user_id, organization_id)
        from backend.documents.template_catalog.compatibility import (
            catalog_enabled,
            catalog_mode,
        )
        if catalog_enabled() and catalog_mode() == "cutover":
            payload = await run_blocking_io(
                _catalog_assignment_payload,
                organization_id,
                owner_type,
                timeout_seconds=5,
            )
            return JSONResponse(payload)
        payload = await run_blocking_io(
            _word_publication_assignment_payload,
            owner_type,
            owner_id,
            timeout_seconds=5,
        )
        return JSONResponse(payload)
    except (
        BlockingIOBusyError,
        BlockingIOTimeoutError,
        DatabaseError,
        OrgPermissionError,
        OSError,
    ) as e:
        return _docx_error(
            request,
            e,
            "get_word_publication_template_assignments_api",
        )


async def save_word_publication_template_assignments_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        access_error = _word_config_access_response(
            request,
            role_or_err,
            write=True,
        )
        if access_error is not None:
            return access_error
        organization_id = get_active_org(request, user_id)
        owner_type, owner_id = _word_template_scope(user_id, organization_id)
        data, json_error = await read_json_object(request)
        if json_error is not None:
            return json_error
        assignment_field = (
            "assignmentSets" if "assignmentSets" in data else "assignments"
        )
        invalid = validate_or_response(request, data, {
            "expectedRevision": {
                "type": "integer",
                "required": True,
                "min": 0,
            },
            assignment_field: {
                "type": "object",
                "required": True,
                "max_length": len(WORD_PUBLICATION_DOCUMENT_IDS),
            },
        })
        if invalid:
            return invalid
        from backend.documents.template_catalog.compatibility import (
            catalog_enabled,
            catalog_mode,
        )
        if catalog_enabled() and catalog_mode() == "cutover":
            payload = await run_blocking_io(
                _save_catalog_assignments,
                request,
                organization_id,
                owner_type,
                user_id,
                data[assignment_field],
                data["expectedRevision"],
                timeout_seconds=10,
            )
            return JSONResponse(payload)
        def audit_assignment_commit(normalized, revision):
            log_audit(
                "document.word_template_assignments_updated",
                actor_user_id=user_id,
                organization_id=organization_id,
                target_type="word_template_config",
                target_id=owner_id,
                request=request,
                metadata={
                    "organization_id": organization_id,
                    "assigned_document_types": sorted(normalized),
                    "config_revision": revision,
                },
                required=True,
            )

        def audit_assignment_intent(normalized, expected_revision):
            log_audit(
                "document.word_template_assignments_update_requested",
                actor_user_id=user_id,
                organization_id=organization_id,
                target_type="word_template_config",
                target_id=owner_id,
                request=request,
                metadata={
                    "organization_id": organization_id,
                    "assigned_document_types": sorted(normalized),
                    "expected_config_revision": expected_revision,
                },
                required=True,
            )

        payload = await run_blocking_io(
            _save_word_publication_assignments,
            owner_type,
            owner_id,
            data[assignment_field],
            data["expectedRevision"],
            audit_assignment_intent,
            audit_assignment_commit,
            timeout_seconds=5,
        )
        return JSONResponse(payload)
    except (FileNotFoundError, ValueError) as e:
        from backend.documents.template_catalog.service import CatalogConflictError
        if isinstance(e, CatalogConflictError):
            return JSONResponse(
                {
                    "code": e.code,
                    "error": "Cài đặt biểu mẫu đã thay đổi. Vui lòng tải lại.",
                    "current": e.current,
                },
                status_code=409,
            )
        return _docx_error(
            request,
            e,
            "save_word_publication_template_assignments_api",
        )
    except (
        BlockingIOBusyError,
        BlockingIOTimeoutError,
        DatabaseError,
        OrgPermissionError,
        OSError,
    ) as e:
        return _docx_error(
            request,
            e,
            "save_word_publication_template_assignments_api",
        )


async def view_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        access_error = _word_config_access_response(request, role_or_err)
        if access_error is not None:
            return access_error
        organization_id = get_active_org(request, user_id)
        owner_type, owner_id = _word_template_scope(user_id, organization_id)
        template_path, safe_name = await run_blocking_io(
            _resolve_template_path,
            owner_type,
            owner_id,
            request.path_params.get('filename'),
            timeout_seconds=5,
        )
        safe_download_name = _safe_filename(safe_name)
        disposition = (
            f"inline; filename={safe_download_name}; "
            f"filename*=UTF-8''{quote(safe_name)}"
        )
        return FileResponse(
            template_path,
            media_type=(
                "application/vnd.openxmlformats-officedocument."
                "wordprocessingml.document"
            ),
            headers={
                "Content-Disposition": disposition,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except (FileNotFoundError, ValueError) as e:
        return _docx_error(request, e, "view_template_api")
    except (OrgPermissionError, BlockingIOBusyError, BlockingIOTimeoutError, OSError) as e:
        return _docx_error(request, e, "view_template_api")

async def set_active_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        access_error = _word_config_access_response(request, role_or_err, write=True)
        if access_error is not None:
            return access_error
        organization_id = get_active_org(request, user_id)
        owner_type, owner_id = _word_template_scope(user_id, organization_id)

        data, json_error = await read_json_object(request)
        if json_error is not None:
            return json_error
        invalid = validate_or_response(request, data, {
            "template_name": {"type": "string", "max_length": 255},
            "filename": {"type": "string", "max_length": 255},
            "enabled": {"type": "boolean"},
            "expectedRevision": {
                "type": "integer",
                "required": True,
                "min": 0,
            },
        })
        if invalid:
            return invalid
        template_name = data.get('template_name') or data.get('filename')
        if not template_name:
            return JSONResponse({"error": "Missing template_name parameter"}, status_code=400)

        _, safe_name = await run_blocking_io(
            _resolve_template_path,
            owner_type,
            owner_id,
            template_name,
            timeout_seconds=5,
        )
        enabled = data.get("enabled", True)

        def audit_availability_commit(revision):
            log_audit(
                "document.word_template_availability_updated",
                actor_user_id=user_id,
                organization_id=organization_id,
                target_type="word_template",
                target_id=safe_name,
                request=request,
                metadata={
                    "organization_id": organization_id,
                    "enabled": enabled,
                    "config_revision": revision,
                },
                required=True,
            )

        log_audit(
            "document.word_template_availability_update_requested",
            actor_user_id=user_id,
            organization_id=organization_id,
            target_type="word_template",
            target_id=safe_name,
            request=request,
            metadata={
                "organization_id": organization_id,
                "enabled": enabled,
                "expected_config_revision": data["expectedRevision"],
            },
            required=True,
        )

        _enabled_templates, revision = await run_blocking_io(
            custom_exporter.configure_template_availability,
            safe_name,
            enabled,
            owner_id,
            owner_type=owner_type,
            expected_revision=data["expectedRevision"],
            activate="enabled" not in data,
            commit_callback=audit_availability_commit,
            timeout_seconds=5,
        )
        return JSONResponse({
            "success": True,
            "filename": safe_name,
            "enabled": enabled,
            "revision": revision,
        })
    except FileNotFoundError as e:
        return _docx_error(request, e, "set_active_template_api")
    except ValueError as e:
        return _docx_error(request, e, "set_active_template_api")
    except Exception as e:
        return _docx_error(request, e, "set_active_template_api")

async def upload_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        access_error = _word_config_access_response(request, role_or_err, write=True)
        if access_error is not None:
            return access_error
        organization_id = get_active_org(request, user_id)
        upload_access_error = _word_template_upload_access_response(
            request,
            role_or_err,
            organization_id,
        )
        if upload_access_error is not None:
            return upload_access_error
        owner_type, owner_id = _word_template_scope(user_id, organization_id)
        mutation_revision = {"value": None}

        def audit_upload(filename, revision):
            log_audit(
                "document.word_template_uploaded",
                actor_user_id=user_id,
                organization_id=organization_id,
                target_type="word_template",
                target_id=filename,
                request=request,
                metadata={
                    "organization_id": organization_id,
                    "config_revision": revision,
                },
                required=True,
            )
            mutation_revision["value"] = revision

        form = await request.form()
        file_obj = form.get('file')
        if not file_obj:
            return JSONResponse({"success": False, "error": "Không tìm thấy tệp tin tải lên!"}, status_code=400)

        async with spooled_upload(file_obj, max_bytes=MAX_TEMPLATE_UPLOAD_BYTES, suffix=".docx") as (upload_path, upload_size, head):
            try:
                filename = _validate_docx_upload(
                    file_obj.filename, head, deep_validation=False, total_size=upload_size,
                )
                sanitized_content = await run_document_job_async(
                    "sanitize_docx_template",
                    {"content_path": str(upload_path)},
                    timeout_seconds=15,
                )
                await run_blocking_io(
                    _replace_file_content,
                    str(upload_path),
                    sanitized_content,
                    timeout_seconds=5,
                )
            except ValueError as e:
                return _docx_error(request, e, "upload_template_api")

            log_audit(
                "document.word_template_upload_requested",
                actor_user_id=user_id,
                organization_id=organization_id,
                target_type="word_template",
                target_id=filename,
                request=request,
                metadata={"organization_id": organization_id},
                required=True,
            )
            await run_blocking_io(
                _persist_scoped_template_from_path,
                owner_type,
                owner_id,
                filename,
                str(upload_path),
                audit_callback=audit_upload,
                timeout_seconds=10,
            )
        return JSONResponse({
            "success": True,
            "filename": filename,
            "revision": mutation_revision["value"],
        })
    except (FileExistsError, ValueError, DocumentWorkerError) as e:
        return _docx_error(request, e, "upload_template_api")
    except Exception as e:
        return _docx_error(request, e, "upload_template_api")


async def replace_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        access_error = _word_config_access_response(request, role_or_err, write=True)
        if access_error is not None:
            return access_error
        organization_id = get_active_org(request, user_id)
        upload_access_error = _word_template_upload_access_response(
            request,
            role_or_err,
            organization_id,
        )
        if upload_access_error is not None:
            return upload_access_error
        owner_type, owner_id = _word_template_scope(user_id, organization_id)
        template_name = request.path_params.get('filename')
        _, safe_name = await run_blocking_io(
            _resolve_custom_template_path,
            owner_type,
            owner_id,
            template_name,
            timeout_seconds=5,
        )

        form = await request.form()
        file_obj = form.get('file')
        new_name = _normalize_custom_template_filename(
            form.get('name') or safe_name
        )
        mutation_revision = {"value": None}

        def audit_replace(filename, revision):
            log_audit(
                "document.word_template_replaced",
                actor_user_id=user_id,
                organization_id=organization_id,
                target_type="word_template",
                target_id=filename,
                request=request,
                metadata={
                    "organization_id": organization_id,
                    "previous_filename": safe_name,
                    "config_revision": revision,
                },
                required=True,
            )
            mutation_revision["value"] = revision

        log_audit(
            "document.word_template_replace_requested",
            actor_user_id=user_id,
            organization_id=organization_id,
            target_type="word_template",
            target_id=safe_name,
            request=request,
            metadata={
                "organization_id": organization_id,
                "next_filename": new_name,
            },
            required=True,
        )

        if file_obj:
            async with spooled_upload(
                file_obj,
                max_bytes=MAX_TEMPLATE_UPLOAD_BYTES,
                suffix=".docx",
            ) as (upload_path, upload_size, head):
                _validate_docx_upload(
                    file_obj.filename,
                    head,
                    deep_validation=False,
                    total_size=upload_size,
                )
                sanitized_content = await run_document_job_async(
                    "sanitize_docx_template",
                    {"content_path": str(upload_path)},
                    timeout_seconds=15,
                )
                await run_blocking_io(
                    _replace_file_content,
                    str(upload_path),
                    sanitized_content,
                    timeout_seconds=5,
                )
                _, new_name = await run_blocking_io(
                    _update_scoped_template,
                    owner_type,
                    owner_id,
                    safe_name,
                    new_name,
                    source_path=str(upload_path),
                    audit_callback=audit_replace,
                    timeout_seconds=10,
                )
        else:
            _, new_name = await run_blocking_io(
                _update_scoped_template,
                owner_type,
                owner_id,
                safe_name,
                new_name,
                audit_callback=audit_replace,
                timeout_seconds=5,
            )
        return JSONResponse({
            "success": True,
            "filename": new_name,
            "revision": mutation_revision["value"],
        })
    except (FileNotFoundError, FileExistsError, ValueError, DocumentWorkerError) as e:
        return _docx_error(request, e, "replace_template_api")
    except (DatabaseError, OrgPermissionError, BlockingIOBusyError, BlockingIOTimeoutError, OSError) as e:
        return _docx_error(request, e, "replace_template_api")


async def delete_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        access_error = _word_config_access_response(request, role_or_err, write=True)
        if access_error is not None:
            return access_error
        organization_id = get_active_org(request, user_id)
        upload_access_error = _word_template_upload_access_response(
            request,
            role_or_err,
            organization_id,
        )
        if upload_access_error is not None:
            return upload_access_error
        owner_type, owner_id = _word_template_scope(user_id, organization_id)
        template_name = request.path_params.get('filename')
        _delete_path, delete_safe_name = await run_blocking_io(
            _resolve_custom_template_path,
            owner_type,
            owner_id,
            template_name,
            timeout_seconds=5,
        )
        mutation_revision = {"value": None}

        def audit_delete(filename, revision):
            log_audit(
                "document.word_template_deleted",
                actor_user_id=user_id,
                organization_id=organization_id,
                target_type="word_template",
                target_id=filename,
                request=request,
                metadata={
                    "organization_id": organization_id,
                    "config_revision": revision,
                },
                required=True,
            )
            mutation_revision["value"] = revision

        log_audit(
            "document.word_template_delete_requested",
            actor_user_id=user_id,
            organization_id=organization_id,
            target_type="word_template",
            target_id=delete_safe_name,
            request=request,
            metadata={"organization_id": organization_id},
            required=True,
        )

        await run_blocking_io(
            _delete_scoped_template,
            owner_type,
            owner_id,
            template_name,
            audit_callback=audit_delete,
            timeout_seconds=5,
        )
        return JSONResponse({
            "success": True,
            "deleted": True,
            "revision": mutation_revision["value"],
        })
    except FileNotFoundError:
        return JSONResponse({"success": True, "deleted": False})
    except ValueError as e:
        return _docx_error(request, e, "delete_template_api")
    except (DatabaseError, OrgPermissionError, BlockingIOBusyError, BlockingIOTimeoutError, OSError) as e:
        return _docx_error(request, e, "delete_template_api")


async def list_word_mappings_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        conn = database.get_connection()
        cursor = conn.cursor()
        if not can_read_word_config(cursor, role_or_err, user_id, org_name):
            return JSONResponse({"error": "Ban khong co quyen su dung cau hinh Word."}, status_code=403)

        include_disabled = str(
            request.query_params.get("includeDisabled") or ""
        ).lower() in {"1", "true", "yes"}
        rows = resolve_word_mappings(
            cursor,
            org_name,
            include_disabled=include_disabled,
        )
        mappings = []
        for row in rows:
            r = dict(row)
            r['tenBien'] = r.get('ten_bien')
            r['sourceTable'] = r.get('source_table')
            r['sourceColumn'] = r.get('source_column')
            r['mappingType'] = 'computed' if r.get('source_table') == COMPUTED_SOURCE_TABLE else 'mapping'
            r['formula'] = r.get('source_column') if r.get('source_table') == COMPUTED_SOURCE_TABLE else ''
            r['moTa'] = r.get('mo_ta')
            r['mappingKey'] = r.get('mapping_key')
            r['isModified'] = bool(r.get('is_modified'))
            mappings.append(r)
        return JSONResponse(mappings)
    except OrgPermissionError as e:
        return _docx_error(request, e, "list_word_mappings_api")
    except Exception as e:
        return _docx_error(request, e, "list_word_mappings_api")
    finally:
        if conn:
            try:
                if conn.in_transaction:
                    conn.rollback()
                conn.close()
            except DatabaseError:
                pass

async def save_word_mapping_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)

        data, json_error = await read_json_object(request)
        if json_error is not None:
            return json_error
        invalid = validate_or_response(request, data, {
            "id": {"type": "string", "max_length": 128},
            "ten_bien": {"type": "string", "max_length": 128},
            "tenBien": {"type": "string", "max_length": 128},
            "source_table": {"type": "string", "max_length": 128},
            "sourceTable": {"type": "string", "max_length": 128},
            "source_column": {"type": "string", "max_length": 512},
            "sourceColumn": {"type": "string", "max_length": 512},
            "mapping_type": {"type": "string", "max_length": 32},
            "mappingType": {"type": "string", "max_length": 32},
            "formula": {"type": "string", "max_length": 5_000},
            "mo_ta": {"type": "string", "max_length": 2_000},
            "moTa": {"type": "string", "max_length": 2_000},
        })
        if invalid:
            return invalid
        ten_bien = (data.get('ten_bien') or data.get('tenBien') or '').strip().lower()
        source_table = (data.get('source_table') or data.get('sourceTable') or '').strip()
        source_column = (data.get('source_column') or data.get('sourceColumn') or '').strip()
        mapping_type = (data.get('mapping_type') or data.get('mappingType') or '').strip()
        formula = (data.get('formula') or '').strip()
        description_provided = 'mo_ta' in data or 'moTa' in data
        mo_ta = (
            (data.get('mo_ta') or data.get('moTa') or '').strip()
            if description_provided
            else None
        )
        if mapping_type == 'computed':
            source_table = COMPUTED_SOURCE_TABLE
            source_column = formula

        if not source_column:
            source_column = ""

        if not ten_bien or not source_table:
            return JSONResponse({"error": "Vui lòng nhập đầy đủ thông tin!"}, status_code=400)

        if source_table == COMPUTED_SOURCE_TABLE and not source_column:
            return JSONResponse({"error": "Vui lòng nhập công thức cho biến kết quả!"}, status_code=400)

        try:
            validate_mapping_definition(ten_bien, source_table, source_column)
        except ValueError:
            return JSONResponse(
                {
                    "error": "Ánh xạ Word sử dụng nguồn dữ liệu không được phép.",
                    "code": "DOCX_MAPPING_FORBIDDEN",
                },
                status_code=400,
            )

        id_param = data.get('id')

        conn = database.get_connection()
        cursor = conn.cursor()
        if not can_manage_word_config(cursor, role_or_err, user_id, org_name):
            return JSONResponse({"error": "Ban khong co quyen quan ly cau hinh Word."}, status_code=403)



        owner_type, _owner_id = _word_template_scope(user_id, org_name)
        mapping = save_word_mapping(
            cursor,
            org_name,
            owner_type,
            mapping_id=id_param,
            ten_bien=ten_bien,
            source_table=source_table,
            source_column=source_column,
            mo_ta=mo_ta,
        )
        log_audit(
            "document.word_mapping_saved",
            actor_user_id=user_id,
            organization_id=org_name,
            target_type="word_mapping",
            target_id=mapping["id"],
            request=request,
            metadata={
                "mapping_key": mapping.get("mapping_key"),
                "owner_type": owner_type,
            },
            cursor=cursor,
            required=True,
        )
        conn.commit()
        return JSONResponse({"success": True, "id": mapping["id"]})
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except OrgPermissionError as e:
        return _docx_error(request, e, "save_word_mapping_api")
    except Exception as e:
        return _docx_error(request, e, "save_word_mapping_api")
    finally:
        if conn:
            try:
                if conn.in_transaction:
                    conn.rollback()
                conn.close()
            except DatabaseError:
                pass

async def delete_word_mapping_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)

        mapping_id = request.path_params.get('mapping_id')
        if not mapping_id:
            return JSONResponse({"error": "Missing mapping_id parameter"}, status_code=400)

        conn = database.get_connection()
        cursor = conn.cursor()
        if not can_manage_word_config(cursor, role_or_err, user_id, org_name):
            return JSONResponse({"error": "Ban khong co quyen quan ly cau hinh Word."}, status_code=403)
        owner_type, _owner_id = _word_template_scope(user_id, org_name)
        result = delete_word_mapping(
            cursor,
            org_name,
            owner_type,
            mapping_id,
        )
        log_audit(
            "document.word_mapping_deleted",
            actor_user_id=user_id,
            organization_id=org_name,
            target_type="word_mapping",
            target_id=mapping_id,
            request=request,
            metadata={"owner_type": owner_type},
            cursor=cursor,
            required=True,
        )
        conn.commit()
        return JSONResponse({"success": True, **result})
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except OrgPermissionError as e:
        return _docx_error(request, e, "delete_word_mapping_api")
    except Exception as e:
        return _docx_error(request, e, "delete_word_mapping_api")
    finally:
        if conn:
            try:
                if conn.in_transaction:
                    conn.rollback()
                conn.close()
            except DatabaseError:
                pass


async def reset_word_mapping_api(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        mapping_id = request.path_params.get('mapping_id')
        if not mapping_id:
            return JSONResponse({"error": "Missing mapping_id parameter"}, status_code=400)

        conn = database.get_connection()
        cursor = conn.cursor()
        if not can_manage_word_config(cursor, role_or_err, user_id, org_name):
            return JSONResponse({"error": "Ban khong co quyen quan ly cau hinh Word."}, status_code=403)
        result = reset_word_mapping(cursor, org_name, mapping_id)
        log_audit(
            "document.word_mapping_reset",
            actor_user_id=user_id,
            organization_id=org_name,
            target_type="word_mapping",
            target_id=mapping_id,
            request=request,
            metadata={"restored_default": True},
            cursor=cursor,
            required=True,
        )
        conn.commit()
        return JSONResponse({"success": True, **result})
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except OrgPermissionError as e:
        return _docx_error(request, e, "reset_word_mapping_api")
    finally:
        if conn:
            try:
                if conn.in_transaction:
                    conn.rollback()
                conn.close()
            except DatabaseError:
                pass
