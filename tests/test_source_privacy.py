"""Approved public/source boundary; business records are never text-redacted."""

from copy import deepcopy
import json
import asyncio
from pathlib import Path
import re

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.shared.source_privacy import (
    SourcePrivacyMiddleware,
    internal_source_payload,
    public_source_payload,
)


def test_source_metadata_is_public_only_and_round_trips():
    internal = {
        "sourceRevision": {"provider": "MUASAMCONG", "revisionNumber": "02"},
        "criteria": [{"source": "muasamcong", "code": "MSC_VALIDITY_2",
                      "id": "evaluation-criterion:round-1:MSC_VALIDITY_2"}],
        "sourceUrl": "https://muasamcong.mof.gov.vn/detail?id=42",
        "publicUrl": "https://muasamcong.mof.gov.vn/detail?id=42",
        "message": "MSC quá thời gian tại https://muasamcong.mpi.gov.vn/path?q=1",
    }
    before = deepcopy(internal)
    public = public_source_payload(internal)
    assert public["sourceRevision"]["provider"] == "AUTOMATIC_DATA"
    assert public["criteria"][0]["source"] == "automatic"
    assert public["criteria"][0]["code"] == "AUTO_VALIDITY_2"
    assert "sourceUrl" not in public
    assert not any(token in json.dumps(public).lower() for token in ("muasamcong", "msc_", "https://"))
    assert internal_source_payload(public)["criteria"] == internal["criteria"]
    assert internal_source_payload(public)["sourceRevision"] == internal["sourceRevision"]
    assert internal == before


def test_authorized_business_data_and_other_urls_are_unchanged():
    record = {"name": "Tư vấn Mua Sắm Công", "description": "Mua Sắm Công",
              "cccd": "012345678901", "bankAccount": "123456789012",
              "bank": "VCB", "signature": "images/sign.png", "stamp": "images/stamp.png",
              "url": "https://example.org/business", "source": "custom", "code": "IB1234567890",
              "message": "Mua Sắm Công", "note": "https://muasamcong.mof.gov.vn",
              "version": "automatic-release"}
    assert public_source_payload({"data": record}) == {"data": record}
    assert internal_source_payload({"data": record}) == {"data": record}


def test_catalog_and_raw_envelopes_keep_business_fields_not_transport_metadata():
    value = {"display": {"name": "100 lượt Mua Sắm Công", "benefits": ["Dữ liệu Mua Sắm Công"]},
             "rawBundle": {"provider": "MUASAMCONG", "sources": {"notice": {
                 "endpoint": "/o/egp-portal/services/detail", "request": {"id": "42"},
                 "response": {"name": "Tên gói thầu", "price": 120000,
                              "bankAccount": "123456789012"}}}}}
    public = public_source_payload(value)
    assert public["display"]["name"] == "100 lượt lấy dữ liệu tự động"
    envelope = public["rawBundle"]["sources"]["notice"]
    assert "endpoint" not in envelope
    assert envelope["response"] == value["rawBundle"]["sources"]["notice"]["response"]


def test_legacy_catalog_release_is_projected_without_mutation():
    release = {"display": {
        "name": "Nâng cao", "description": "Bổ sung lấy dữ liệu Mua Sắm Công",
        "benefits": ["100 lượt lấy hồ sơ Mua Sắm Công", "Xuất Word"],
    }}
    original = deepcopy(release)
    public = public_source_payload(release)
    assert public["display"]["description"] == "Bổ sung lấy dữ liệu tự động"
    assert public["display"]["benefits"] == ["100 lượt lấy dữ liệu tự động", "Xuất Word"]
    assert release == original


def test_http_boundary_covers_error():
    async def endpoint(_request):
        return JSONResponse({"source": "MuaSamCong", "message": "Mua Sắm Công lỗi"}, status_code=409)

    app = Starlette(routes=[Route("/api/test", endpoint)], middleware=[Middleware(SourcePrivacyMiddleware)])
    with TestClient(app) as client:
        response = client.get("/api/test")
    assert response.status_code == 409
    assert response.json()["source"] == "automatic"
    assert "Mua Sắm Công" not in response.text
    assert int(response.headers["content-length"]) == len(response.content)


def test_fragmented_json_is_projected_and_non_json_body_is_unchanged():
    async def run(content_type, body, method="GET", status=200):
        sent = []

        async def application(_scope, _receive, send):
            await send({"type": "http.response.start", "status": status,
                        "headers": [(b"content-type", content_type), (b"etag", b"original")]})
            await send({"type": "http.response.body", "body": body[:8], "more_body": True})
            await send({"type": "http.response.body", "body": body[8:], "more_body": False})

        async def send(message):
            sent.append(message)

        await SourcePrivacyMiddleware(application)(
            {"type": "http", "path": "/api/test", "method": method}, None, send,
        )
        return sent

    original = b'{"provider":"MUASAMCONG"}'
    result = asyncio.run(run(b"application/json", original))
    assert json.loads(result[1]["body"])["provider"] == "AUTOMATIC_DATA"
    assert b"etag" not in dict(result[0]["headers"])
    for content_type in (b"application/octet-stream", b"text/event-stream"):
        unchanged = asyncio.run(run(content_type, original))
        assert b"".join(part.get("body", b"") for part in unchanged) == original
        assert dict(unchanged[0]["headers"])[b"etag"] == b"original"
    for method, status in (("HEAD", 200), ("GET", 204), ("GET", 304)):
        unchanged = asyncio.run(run(b"application/json", b"", method, status))
        assert b"".join(part.get("body", b"") for part in unchanged) == b""


def test_real_lookup_route_projects_success_and_preserves_internal_result(monkeypatch):
    import backend.procurement_lookup.routes as routes

    result = {"found": True, "source": {"provider": "MUASAMCONG_BROWSER"},
              "canonical": {"mappingSchemaVersion": "biddingflow-muasamcong-mapping-v8"},
              "data": {"cccd": "012345678901", "name": "Tên gói thầu", "price": 120000}}
    before = deepcopy(result)

    async def fake_run(_function, _request, payload, **_kwargs):
        assert payload["code"] == "PL2600000001"
        return result

    monkeypatch.setattr(routes, "run_blocking_io", fake_run)
    app = Starlette(routes=routes.procurement_lookup_routes(Route),
                    middleware=[Middleware(SourcePrivacyMiddleware)])
    with TestClient(app) as client:
        response = client.post("/api/procurement/lookup", json={"code": "PL2600000001"})
    assert response.status_code == 200
    assert "muasamcong" not in response.text.lower()
    assert response.json()["data"] == result["data"]
    assert result == before


def test_aliases_decode_through_request_parser_before_existing_validation():
    from backend.shared.request_validation import read_json_object

    async def endpoint(request):
        payload, invalid = await read_json_object(request)
        assert invalid is None
        assert payload["sourceRevision"]["provider"] == "MUASAMCONG"
        assert payload["criterionId"] == "evaluation-criterion:r:MSC_VALIDITY_2"
        return JSONResponse(payload)

    app = Starlette(routes=[Route("/api/test", endpoint, methods=["POST"])],
                    middleware=[Middleware(SourcePrivacyMiddleware)])
    payload = {"sourceRevision": {"provider": "AUTOMATIC_DATA"},
               "criterionId": "evaluation-criterion:r:AUTO_VALIDITY_2"}
    with TestClient(app) as client:
        assert client.post("/api/test", json=payload).json() == payload


def test_schema_and_relationship_aliases_round_trip_and_similar_host_is_preserved():
    internal = {"mappingSchemaVersion": "biddingflow-muasamcong-mapping-v8",
                "templateVersion": "muasamcong-standard-v1",
                "schemaVersion": "vneps-procurement-v1",
                "values": {"evaluation-criterion:r:MSC_VALIDITY_2": {"score": 100}},
                "url": "https://muasamcong.mof.gov.vn.evil.example/business"}
    assert internal_source_payload(public_source_payload(internal)) == internal
    for url in ("https://evilmuasamcong.gov.vn", "https://muasamcong.mof.gov.vn.evil.example"):
        assert public_source_payload({"url": url}) == {"url": url}


def test_evaluation_row_foreign_keys_deletions_and_version_keys_keep_one_identity():
    criterion = "evaluation-criterion:r:MSC_VALIDITY_2"
    row = f"detailed-evaluation-row:report:{criterion}"
    internal = {"criteria": [{"id": criterion, "source": "muasamcong"}],
                "rows": [{"id": row, "tieuChiDanhGiaId": criterion}],
                "deletedIds": [row, criterion], "rowVersions": {row: 3, criterion: 2}}
    public = public_source_payload(internal)
    assert "MSC_" not in json.dumps(public)
    assert public["rows"][0]["tieuChiDanhGiaId"] == public["criteria"][0]["id"]
    assert public["rows"][0]["id"] in public["rowVersions"]
    assert internal_source_payload(public) == internal


def test_server_retains_label_and_error_normalization_previously_shipped_in_js():
    from backend.shared.source_privacy import source_neutral_label, source_neutral_message

    assert source_neutral_message("Không tìm thấy mã IB trên Mua Sắm Công.") == (
        "Không tìm thấy mã IB trên dịch vụ lấy dữ liệu tự động.")
    assert source_neutral_label("Quản lý công việc và kết nối dữ liệu Mua Sắm Công.") == (
        "Quản lý công việc và kết nối dữ liệu tự động.")
    assert source_neutral_label("100 lượt Mua Sắm Công") == "100 lượt lấy dữ liệu tự động"


def test_all_captured_lookup_fixtures_project_without_provider_identifiers():
    files = list((Path(__file__).parent / "fixtures" / "muasamcong").rglob("*.json"))
    assert files
    for file in files:
        original = json.loads(file.read_text(encoding="utf-8-sig"))
        before = deepcopy(original)
        public = public_source_payload(original)
        assert not re.search(r"muasamcong|vneps|MSC_", json.dumps(public), re.I), file
        assert original == before


def test_inbound_projection_leaves_depth_rejection_to_the_existing_validator():
    value = {"source": "automatic"}
    for _ in range(1200):
        value = {"child": value}
    projected = internal_source_payload(value)
    for _ in range(1200):
        projected = projected["child"]
    assert projected == {"source": "muasamcong"}

