"""Lazy route proxies for optional Excel and Word features."""

from importlib import import_module


async def _dispatch(module_name, handler_name, request):
    module = import_module(f"{__package__}.{module_name}")
    return await getattr(module, handler_name)(request)


async def export_plan_api(request):
    return await _dispatch("routes_docx", "export_plan_api", request)


async def export_report_api(request):
    return await _dispatch("routes_docx", "export_report_api", request)


async def list_templates_api(request):
    return await _dispatch("routes_docx", "list_templates_api", request)


async def set_active_template_api(request):
    return await _dispatch("routes_docx", "set_active_template_api", request)


async def upload_template_api(request):
    return await _dispatch("routes_docx", "upload_template_api", request)


async def list_word_mappings_api(request):
    return await _dispatch("routes_docx", "list_word_mappings_api", request)


async def save_word_mapping_api(request):
    return await _dispatch("routes_docx", "save_word_mapping_api", request)


async def delete_word_mapping_api(request):
    return await _dispatch("routes_docx", "delete_word_mapping_api", request)


async def import_excel_api(request):
    return await _dispatch("routes_excel", "import_excel_api", request)


async def export_excel_template_api(request):
    return await _dispatch("routes_excel", "export_excel_template_api", request)


async def export_mothau_template_api(request):
    return await _dispatch("routes_excel", "export_mothau_template_api", request)


async def export_danhgiahsdt_template_api(request):
    return await _dispatch("routes_excel", "export_danhgiahsdt_template_api", request)


async def export_ketquaqd_template_api(request):
    return await _dispatch("routes_excel", "export_ketquaqd_template_api", request)


async def export_phanlo_excel_api(request):
    return await _dispatch("routes_excel", "export_phanlo_excel_api", request)


async def export_tuychonmuathem_excel_api(request):
    return await _dispatch("routes_excel", "export_tuychonmuathem_excel_api", request)


async def export_opening_fin_template_api(request):
    return await _dispatch("routes_excel", "export_opening_fin_template_api", request)
