import asyncio
import json
import re
from pathlib import Path
from types import SimpleNamespace

from starlette.testclient import TestClient

from backend.app import app
from backend.documents import routes_excel
from backend.partners import address_routes
from backend.shared import logging_utils


def _request(**attributes):
    values = {
        "headers": {},
        "state": SimpleNamespace(),
        "path_params": {},
        "query_params": {},
    }
    values.update(attributes)
    return SimpleNamespace(**values)


def _payload(response):
    return json.loads(response.body.decode("utf-8"))


def test_error_envelope_preserves_valid_request_id():
    request = _request(headers={"X-Request-ID": "request-safe_123"})

    response = logging_utils.error_response(
        request,
        "SAFE_ERROR",
        "Yêu cầu không thể xử lý.",
        status_code=422,
        fields={"name": "invalid"},
    )

    assert response.status_code == 422
    assert response.headers["X-Request-ID"] == "request-safe_123"
    assert _payload(response) == {
        "code": "SAFE_ERROR",
        "message": "Yêu cầu không thể xử lý.",
        "fields": {"name": "invalid"},
        "requestId": "request-safe_123",
        "error": "Yêu cầu không thể xử lý.",
    }


def test_invalid_request_id_is_not_reflected():
    request = _request(headers={"X-Request-ID": "bad\r\nInjected: true"})

    response = logging_utils.error_response(request, "SAFE_ERROR", "An toàn.")
    request_id = _payload(response)["requestId"]

    assert request_id != "bad\r\nInjected: true"
    assert re.fullmatch(r"[0-9a-f]{32}", request_id)


def test_runtime_log_redacts_secrets_pii_and_embedded_file_content(monkeypatch, tmp_path):
    monkeypatch.setattr(logging_utils, "LOG_DIR", tmp_path)
    monkeypatch.delenv("BIDDING_LOG_DIR", raising=False)
    monkeypatch.setenv("LOG_MAX_BYTES", "65536")
    monkeypatch.setenv("LOG_BACKUP_COUNT", "2")

    logging_utils.append_runtime_log("safe.log", "x" * 70_000)
    logging_utils.append_runtime_log(
        "safe.log",
        'email=user@example.com password="secret" session_token=abc '
        "Authorization: Bearer token-value\n"
        "base64=" + ("A" * 80) + "\n",
    )

    current = (tmp_path / "safe.log").read_text(encoding="utf-8")
    assert (tmp_path / "safe.log.1").exists()
    assert "user@example.com" not in current
    assert "secret" not in current
    assert "token-value" not in current
    assert "A" * 80 not in current
    assert "[REDACTED_EMAIL]" in current
    assert "[REDACTED_SECRET]" in current
    assert "[REDACTED_FILE_CONTENT]" in current


def test_address_upstream_error_does_not_leak_exception(monkeypatch, tmp_path):
    monkeypatch.setattr(logging_utils, "LOG_DIR", tmp_path)
    monkeypatch.delenv("BIDDING_LOG_DIR", raising=False)
    monkeypatch.setattr(address_routes, "_provinces_cache", None)

    def fail_request(*_args, **_kwargs):
        raise RuntimeError("SQL SELECT secret FROM users at C:\\private user@example.com")

    monkeypatch.setattr(address_routes.urllib.request, "urlopen", fail_request)
    response = asyncio.run(address_routes.get_provinces_api(_request()))
    payload = _payload(response)

    assert response.status_code == 502
    assert payload["code"] == "PROVINCES_UPSTREAM_UNAVAILABLE"
    assert "SQL SELECT" not in json.dumps(payload)
    assert "C:\\private" not in json.dumps(payload)
    assert "user@example.com" not in json.dumps(payload)
    assert payload["requestId"]


def test_excel_route_hides_unexpected_exception(monkeypatch, tmp_path):
    monkeypatch.setattr(logging_utils, "LOG_DIR", tmp_path)
    monkeypatch.delenv("BIDDING_LOG_DIR", raising=False)
    monkeypatch.setattr(
        routes_excel,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-1")),
    )

    async def fail_export(*_args, **_kwargs):
        raise RuntimeError("sqlite error in C:\\private\\bidding.db password=secret")

    monkeypatch.setattr(routes_excel, "_export_excel", fail_export)
    response = asyncio.run(
        routes_excel.export_excel_template_api(
            _request(path_params={"import_type": "contractor"})
        )
    )
    payload = _payload(response)

    assert response.status_code == 500
    assert payload["code"] == "EXCEL_OPERATION_FAILED"
    assert "sqlite" not in json.dumps(payload)
    assert "private" not in json.dumps(payload)
    assert "secret" not in json.dumps(payload)


def test_request_id_middleware_sets_response_header():
    with TestClient(app) as client:
        response = client.get("/health/live", headers={"X-Request-ID": "health-check-1"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "health-check-1"


def test_target_routes_do_not_return_raw_exception_text():
    project_root = Path(__file__).resolve().parents[2]
    targets = (
        "backend/documents/routes_docx.py",
        "backend/documents/routes_excel.py",
        "backend/api/org_routes.py",
        "backend/partners/address_routes.py",
    )
    forbidden = re.compile(r"(?:str\((?:e|exc|error)\)|repr\((?:e|exc|error)\))")

    for relative_path in targets:
        source = (project_root / relative_path).read_text(encoding="utf-8")
        assert not forbidden.search(source), relative_path
