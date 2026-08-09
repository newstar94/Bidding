import asyncio
from importlib.util import find_spec

from backend.documents import document_ipc, export_routes, routes_docx
from backend.shared import paths


def test_timeline_http_export_stays_routed_to_active_excel_handler(monkeypatch):
    calls = []

    async def dispatch(module_name, handler_name, request):
        calls.append((module_name, handler_name, request))
        return "excel-response"

    monkeypatch.setattr(export_routes, "_dispatch", dispatch)
    request = object()

    response = asyncio.run(export_routes.export_timeline_api(request))

    assert response == "excel-response"
    assert calls == [("routes_excel", "export_timeline_api", request)]


def test_legacy_timeline_docx_route_worker_and_template_surface_is_retired():
    assert not hasattr(routes_docx, "export_timeline_api")
    assert "render_timeline_docx" not in document_ipc.ALLOWED_OPERATIONS
    assert not hasattr(paths, "provision_system_word_templates")
    assert find_spec("backend.documents.timeline_document_service") is None
