

from importlib import import_module

from backend.auth.auth_service import get_client_ip, get_rate_limit_decision, rate_limit_response
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError, run_blocking_io
from backend.shared.logging_utils import error_response
from backend.documents.export_policy_registry import governed_export


_HEAVY_DOCUMENT_OPERATIONS = {
    "export_plan_api", "export_report_api", "export_timeline_api", "export_excel_template_api",
    "export_mothau_template_api", "export_danhgiahsdt_template_api",
    "export_ketquaqd_template_api", "export_phanlo_excel_api",
    "export_tuychonmuathem_excel_api", "export_opening_fin_template_api",
}


async def _dispatch(module_name, handler_name, request):
    if handler_name in _HEAVY_DOCUMENT_OPERATIONS:
        try:
            decision = await run_blocking_io(
                get_rate_limit_decision,
                f"document_export:{get_client_ip(request)}",
                max_attempts=20,
                window_seconds=60,
                timeout_seconds=2,
            )
        except (BlockingIOBusyError, BlockingIOTimeoutError):
            return error_response(
                request, "DOCUMENT_EXPORT_BUSY",
                "Hệ thống xuất tài liệu đang bận. Vui lòng thử lại sau.",
                status_code=503,
            )
        if not decision.allowed:
            return rate_limit_response(
                "Bạn đang xuất tài liệu quá thường xuyên. Vui lòng thử lại sau.",
                decision,
            )
    module = import_module(f"{__package__}.{module_name}")
    return await getattr(module, handler_name)(request)


@governed_export("docx.plan")
async def export_plan_api(request):
    return await _dispatch("routes_docx", "export_plan_api", request)


@governed_export("docx.package_report")
async def export_report_api(request):
    return await _dispatch("routes_docx", "export_report_api", request)


@governed_export("excel.timeline")
async def export_timeline_api(request):
    return await _dispatch("routes_excel", "export_timeline_api", request)


async def list_templates_api(request):
    return await _dispatch("routes_docx", "list_templates_api", request)


async def get_word_publication_template_assignments_api(request):
    return await _dispatch(
        "routes_docx",
        "get_word_publication_template_assignments_api",
        request,
    )


async def save_word_publication_template_assignments_api(request):
    return await _dispatch(
        "routes_docx",
        "save_word_publication_template_assignments_api",
        request,
    )


async def view_template_api(request):
    return await _dispatch("routes_docx", "view_template_api", request)


async def set_active_template_api(request):
    return await _dispatch("routes_docx", "set_active_template_api", request)


async def upload_template_api(request):
    return await _dispatch("routes_docx", "upload_template_api", request)


async def replace_template_api(request):
    return await _dispatch("routes_docx", "replace_template_api", request)


async def delete_template_api(request):
    return await _dispatch("routes_docx", "delete_template_api", request)


async def list_word_mappings_api(request):
    return await _dispatch("routes_docx", "list_word_mappings_api", request)


async def save_word_mapping_api(request):
    return await _dispatch("routes_docx", "save_word_mapping_api", request)


async def delete_word_mapping_api(request):
    return await _dispatch("routes_docx", "delete_word_mapping_api", request)


async def reset_word_mapping_api(request):
    return await _dispatch("routes_docx", "reset_word_mapping_api", request)


async def import_excel_api(request):
    return await _dispatch("routes_excel", "import_excel_api", request)


@governed_export("excel.generic_import_template")
async def export_excel_template_api(request):
    return await _dispatch("routes_excel", "export_excel_template_api", request)


@governed_export("excel.opening_template")
async def export_mothau_template_api(request):
    return await _dispatch("routes_excel", "export_mothau_template_api", request)


@governed_export("excel.evaluation")
async def export_danhgiahsdt_template_api(request):
    return await _dispatch("routes_excel", "export_danhgiahsdt_template_api", request)


@governed_export("excel.award_result")
async def export_ketquaqd_template_api(request):
    return await _dispatch("routes_excel", "export_ketquaqd_template_api", request)


@governed_export("excel.package_lot_draft_template")
async def export_phanlo_excel_api(request):
    return await _dispatch("routes_excel", "export_phanlo_excel_api", request)


@governed_export("excel.optional_purchase_draft_template")
async def export_tuychonmuathem_excel_api(request):
    return await _dispatch("routes_excel", "export_tuychonmuathem_excel_api", request)


@governed_export("excel.financial_opening")
async def export_opening_fin_template_api(request):
    return await _dispatch("routes_excel", "export_opening_fin_template_api", request)
