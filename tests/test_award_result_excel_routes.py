from __future__ import annotations

import asyncio
from io import BytesIO
import json
from types import SimpleNamespace

from openpyxl import Workbook
import pytest

from backend.documents import award_result_excel_routes as routes
from backend.documents import award_result_excel_service as service


class _Request:
    def __init__(self, *, package_id="pkg", upload=None):
        self.path_params = {"package_id": package_id}
        self._upload = upload
        self.headers = {}
        self.state = SimpleNamespace()
        self.client = ("127.0.0.1", 1234)

    async def form(self):
        return {"file": self._upload} if self._upload is not None else {}


class _Upload:
    def __init__(
        self,
        content: bytes,
        *,
        filename="input.xlsx",
        content_type=service.XLSX_CONTENT_TYPE,
    ):
        self.filename = filename
        self.content_type = content_type
        self._stream = BytesIO(content)

    async def read(self, size=-1):
        return self._stream.read(size)


class _Connection:
    def __init__(self):
        self.closed = False
        self._cursor = object()

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed = True


class _Database:
    def __init__(self):
        self.connection = _Connection()

    def get_connection(self):
        return self.connection


def _xlsx_bytes(template_type="standard"):
    definition = (
        service.MEDICINE_TEMPLATE
        if template_type == "medicine"
        else service.STANDARD_TEMPLATE
    )
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Danh sách nhà thầu"
    if template_type == "medicine":
        sheet.append(["Hướng dẫn", *("" for _ in definition.headers[1:])])
    sheet.append(list(definition.headers))
    values = [None] * len(definition.headers)
    values[definition.lot_index] = "L01"
    values[definition.bidder_identifier_index] = "vn001"
    values[definition.tax_code_index] = "001"
    values[definition.bidder_name_index] = "Nhà thầu 01"
    sheet.append(values)
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def _json(response):
    return json.loads(response.body.decode("utf-8"))


def test_authorize_rejects_unauthenticated_request(monkeypatch):
    monkeypatch.setattr(routes, "verify_session", lambda _request: (False, "Đăng nhập"))

    with pytest.raises(service.AwardResultExcelError) as denied:
        routes._authorize(_Request(), "pkg")

    assert denied.value.code == "AUTH_REQUIRED"
    assert denied.value.status_code == 401


@pytest.mark.parametrize(
    ("record_access", "entitlement", "expected_code"),
    [
        (False, True, "PACKAGE_EXPORT_DENIED"),
        (True, False, "EXCEL_EXPORT_SUBSCRIPTION_REQUIRED"),
    ],
)
def test_authorize_enforces_record_scope_and_subscription(
    monkeypatch, record_access, entitlement, expected_code
):
    database = _Database()
    role = SimpleNamespace(user_id="user")
    monkeypatch.setattr(routes, "database", database)
    monkeypatch.setattr(routes, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(routes, "get_active_org", lambda *_args, **_kwargs: "org")
    monkeypatch.setattr(routes, "can_read_record", lambda *_args: record_access)
    monkeypatch.setattr(
        routes, "can_use_award_result_excel_export", lambda *_args: entitlement
    )

    with pytest.raises(service.AwardResultExcelError) as denied:
        routes._authorize(_Request(), "pkg")

    assert denied.value.code == expected_code
    assert denied.value.status_code == 403
    assert database.connection.closed is True


@pytest.mark.parametrize(
    ("filename", "content_type", "head", "size", "expected_code"),
    [
        ("input.xls", service.XLSX_CONTENT_TYPE, b"PK\x03\x04", 10, "XLSX_REQUIRED"),
        ("input.xlsx", service.XLSX_CONTENT_TYPE, b"PK\x03\x04", 0, "XLSX_EMPTY"),
        (
            "input.xlsx",
            "text/plain",
            b"PK\x03\x04",
            10,
            "XLSX_MIME_INVALID",
        ),
        (
            "input.xlsx",
            service.XLSX_CONTENT_TYPE,
            b"not-zip",
            10,
            "XLSX_SIGNATURE_INVALID",
        ),
        (
            "input.xlsx",
            service.XLSX_CONTENT_TYPE,
            b"PK\x03\x04",
            routes.MAX_AWARD_RESULT_EXCEL_BYTES + 1,
            "XLSX_TOO_LARGE",
        ),
    ],
)
def test_upload_metadata_rejects_invalid_files(
    filename, content_type, head, size, expected_code
):
    upload = _Upload(b"", filename=filename, content_type=content_type)

    with pytest.raises(service.AwardResultExcelError) as invalid:
        routes._validate_upload_metadata(upload, head, size)

    assert invalid.value.code == expected_code


@pytest.mark.parametrize(
    ("is_thuoc", "template_type", "mismatch"),
    [
        (0, "standard", False),
        (1, "medicine", False),
        (0, "medicine", True),
        (1, "standard", True),
    ],
)
def test_template_selection_depends_only_on_package_is_thuoc(
    monkeypatch, is_thuoc, template_type, mismatch
):
    inspection = service.inspect_award_result_workbook(_xlsx_bytes(template_type))
    dataset = {
        "package": {"is_thuoc": is_thuoc},
        "records": [],
        "lotCodes": ["L01"],
        "blockingErrors": [],
    }

    async def database_read(function, *_args, **_kwargs):
        if function is routes.load_award_result_dataset:
            return dataset
        if function is routes.find_foreign_lot_codes:
            return set()
        raise AssertionError("unexpected database function")

    monkeypatch.setattr(routes, "run_database_read", database_read)
    _loaded, result = asyncio.run(routes._load_match_context("pkg", "org", inspection))
    codes = {item["code"] for item in result["blockingErrors"]}

    assert ("TEMPLATE_PACKAGE_TYPE_MISMATCH" in codes) is mismatch


def test_validate_endpoint_returns_reconciliation_token_and_audits(monkeypatch):
    content = _xlsx_bytes("standard")
    inspection = service.inspect_award_result_workbook(content)
    match_result = service.match_award_result_rows(
        inspection,
        [
            service.AwardRecord(
                opening_id="opening",
                lot_code="L01",
                bidder_identifier="vn001",
                tax_code="001",
                bidder_name="Nhà thầu 01",
                status="Trúng thầu",
                award_price=900,
            )
        ],
    )
    audits = []

    monkeypatch.setattr(
        routes,
        "_authorize",
        lambda _request, _package_id: (SimpleNamespace(user_id="user"), "org"),
    )

    async def inspect_worker(operation, payload, **_kwargs):
        assert operation == "inspect_award_result_excel"
        assert payload["content"] == content
        return inspection

    async def match_context(_package_id, _organization_id, actual_inspection):
        assert actual_inspection == inspection
        return {"package": {"ma_goi_thau": "IB-01"}}, match_result

    monkeypatch.setattr(routes, "run_document_job_async", inspect_worker)
    monkeypatch.setattr(routes, "_load_match_context", match_context)
    monkeypatch.setattr(
        routes,
        "create_validation_artifact",
        lambda *_args, **_kwargs: (
            "validation-token",
            {
                "originalFilename": "input.xlsx",
                "sizeBytes": len(content),
                "expiresAt": 999,
                "sha256": "a" * 64,
            },
        ),
    )
    monkeypatch.setattr(routes, "log_audit", lambda action, **kwargs: audits.append((action, kwargs)))

    response = asyncio.run(
        routes.validate_award_result_excel_api(_Request(upload=_Upload(content)))
    )
    payload = _json(response)

    assert response.status_code == 200
    assert payload["validationToken"] == "validation-token"
    assert payload["totalRows"] == 1
    assert payload["unmatchedRows"] == 0
    assert payload["writableRows"] == 1
    assert audits[0][0] == "award_result.excel_validated"
    assert audits[0][1]["required"] is True


def test_validate_endpoint_maps_authentication_failure(monkeypatch):
    def deny(_request, _package_id):
        raise service.AwardResultExcelError(
            "AUTH_REQUIRED", "Vui lòng đăng nhập.", status_code=401
        )

    monkeypatch.setattr(routes, "_authorize", deny)
    response = asyncio.run(routes.validate_award_result_excel_api(_Request()))

    assert response.status_code == 401
    assert _json(response)["code"] == "AUTH_REQUIRED"


def test_validate_blocking_result_does_not_create_artifact(monkeypatch):
    content = _xlsx_bytes("standard")
    inspection = service.inspect_award_result_workbook(content)
    match_result = service.match_award_result_rows(inspection, [])
    match_result["blockingErrors"].append(
        {"code": "TEMPLATE_PACKAGE_TYPE_MISMATCH", "message": "blocked"}
    )
    created = []

    monkeypatch.setattr(
        routes,
        "_authorize",
        lambda _request, _package_id: (SimpleNamespace(user_id="user"), "org"),
    )

    async def inspect_worker(_operation, _payload, **_kwargs):
        return inspection

    async def match_context(_package_id, _organization_id, _inspection):
        return {"package": {"ma_goi_thau": "IB-01"}}, match_result

    monkeypatch.setattr(routes, "run_document_job_async", inspect_worker)
    monkeypatch.setattr(routes, "_load_match_context", match_context)
    monkeypatch.setattr(
        routes,
        "create_validation_artifact",
        lambda *_args, **_kwargs: created.append(True),
    )
    monkeypatch.setattr(routes, "log_audit", lambda *_args, **_kwargs: None)

    response = asyncio.run(
        routes.validate_award_result_excel_api(_Request(upload=_Upload(content)))
    )
    payload = _json(response)

    assert response.status_code == 200
    assert created == []
    assert "validationToken" not in payload
    assert payload["canExport"] is False


def test_validate_endpoint_returns_413_for_oversized_stream(monkeypatch):
    monkeypatch.setattr(
        routes,
        "_authorize",
        lambda _request, _package_id: (SimpleNamespace(user_id="user"), "org"),
    )
    content = b"x" * (routes.MAX_AWARD_RESULT_EXCEL_BYTES + 1)
    response = asyncio.run(
        routes.validate_award_result_excel_api(_Request(upload=_Upload(content)))
    )

    assert response.status_code == 413
    assert _json(response)["code"] == "XLSX_TOO_LARGE"


def test_export_endpoint_reloads_data_sends_only_worker_updates_and_audits(monkeypatch):
    content = _xlsx_bytes("standard")
    inspection = service.inspect_award_result_workbook(content)
    record = service.AwardRecord(
        opening_id="opening",
        lot_code="L01",
        bidder_identifier="vn001",
        tax_code="001",
        bidder_name="Nhà thầu 01",
        status="Trúng thầu",
        award_price=900,
    )
    match_result = service.match_award_result_rows(inspection, [record])
    audits = []
    consumed = []
    worker_payloads = []

    monkeypatch.setattr(
        routes,
        "_authorize",
        lambda _request, _package_id: (SimpleNamespace(user_id="user"), "org"),
    )

    async def read_payload(_request):
        return {"validationToken": "validation-token"}, None

    async def match_context(_package_id, _organization_id, actual_inspection):
        assert actual_inspection == inspection
        return {"package": {"ma_goi_thau": "IB-01"}}, match_result

    async def export_worker(operation, payload, **_kwargs):
        assert operation == "export_award_result_excel"
        worker_payloads.append(payload)
        return b"result-xlsx"

    monkeypatch.setattr(routes, "read_json_object", read_payload)
    monkeypatch.setattr(
        routes,
        "load_validation_artifact",
        lambda *_args, **_kwargs: (
            {
                "inspection": inspection,
                "originalFilename": "input.xlsx",
                "sha256": "a" * 64,
                "sizeBytes": len(content),
            },
            content,
        ),
    )
    monkeypatch.setattr(routes, "_load_match_context", match_context)
    monkeypatch.setattr(routes, "run_document_job_async", export_worker)
    monkeypatch.setattr(routes, "log_audit", lambda action, **kwargs: audits.append((action, kwargs)))
    monkeypatch.setattr(routes, "consume_validation_artifact", consumed.append)

    response = asyncio.run(routes.export_award_result_excel_api(_Request()))

    assert response.status_code == 200
    assert response.body == b"result-xlsx"
    assert response.media_type == service.XLSX_CONTENT_TYPE
    assert response.headers["cache-control"] == "private, no-store"
    assert "input_da_dien_ket_qua.xlsx" in response.headers["content-disposition"]
    assert set(worker_payloads[0]) == {"content", "updates"}
    assert worker_payloads[0]["content"] == content
    assert len(worker_payloads[0]["updates"]) == 1
    assert audits[0][0] == "award_result.excel_exported"
    assert audits[0][1]["required"] is True
    assert consumed == ["validation-token"]


def test_reconciliation_endpoint_recomputes_server_data_without_consuming_token(monkeypatch):
    inspection = service.inspect_award_result_workbook(_xlsx_bytes("standard"))
    match_result = service.match_award_result_rows(
        inspection,
        [
            service.AwardRecord(
                opening_id="opening",
                lot_code="L01",
                bidder_identifier="vn001",
                tax_code="001",
                bidder_name="Nhà thầu 01",
                status="Trúng thầu",
                award_price=900,
            )
        ],
    )
    worker_payloads = []
    audits = []
    monkeypatch.setattr(
        routes,
        "_authorize",
        lambda _request, _package_id: (SimpleNamespace(user_id="user"), "org"),
    )

    async def read_payload(_request):
        return {"validationToken": "validation-token"}, None

    async def match_context(_package_id, _organization_id, actual_inspection):
        assert actual_inspection == inspection
        return {"package": {"ma_goi_thau": "IB-01"}}, match_result

    async def report_worker(operation, payload, **_kwargs):
        assert operation == "build_award_result_reconciliation"
        worker_payloads.append(payload)
        return b"report-xlsx"

    monkeypatch.setattr(routes, "read_json_object", read_payload)
    monkeypatch.setattr(
        routes,
        "load_validation_artifact",
        lambda *_args, **_kwargs: (
            {
                "inspection": inspection,
                "originalFilename": "input.xlsx",
                "sha256": "a" * 64,
            },
            b"source",
        ),
    )
    monkeypatch.setattr(routes, "_load_match_context", match_context)
    monkeypatch.setattr(routes, "run_document_job_async", report_worker)
    monkeypatch.setattr(
        routes,
        "log_audit",
        lambda action, **kwargs: audits.append((action, kwargs)),
    )

    response = asyncio.run(routes.award_result_excel_reconciliation_api(_Request()))

    assert response.status_code == 200
    assert response.body == b"report-xlsx"
    assert "input_bao_cao_doi_chieu.xlsx" in response.headers["content-disposition"]
    report = json.loads(worker_payloads[0]["reportJson"].decode("utf-8"))
    assert report["metadata"]["sourceSha256"] == "a" * 64
    assert report["metadata"]["userId"] == "user"
    assert report["summary"]["updatedRows"] == 1
    assert len(report["rows"]) == 1
    assert "validationToken" not in str(report)
    assert audits[0][0] == "award_result.excel_reconciliation_exported"
