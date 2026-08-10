import json
import ssl
import urllib.error

import pytest

from backend.integrations.vneps.fake_procurement_provider import FixtureProcurementSource
from backend.integrations.vneps.procurement_provider import (
    VnepsProcurementSource,
    VnepsProcurementTransport,
)
from backend.procurement_import.source import ProcurementSourceError


def test_production_provider_fails_closed_without_authorized_detail_contract(monkeypatch):
    monkeypatch.delenv("VNEPS_PROCUREMENT_API_AUTHORIZATION_CONFIRMED", raising=False)
    with pytest.raises(ProcurementSourceError, match="BLOCKED BY EXTERNAL/API AUTHORIZATION"):
        VnepsProcurementSource()


def test_fixture_provider_is_forbidden_in_production(tmp_path, monkeypatch):
    fixture = tmp_path / "fixture.json"
    fixture.write_text('{"schemaVersion":"vneps-procurement-fixture-v1","plans":[]}', encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError, match="forbidden in production"):
        FixtureProcurementSource(str(fixture))


def test_fixture_schema_drift_fails_closed(tmp_path, monkeypatch):
    fixture = tmp_path / "fixture.json"
    fixture.write_text('{"schemaVersion":"unexpected","plans":[]}', encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "test")
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_SCHEMA_CHANGED"):
        FixtureProcurementSource(str(fixture))


def test_fixture_notice_resolves_exact_plan_package_relationship(tmp_path, monkeypatch):
    fixture = tmp_path / "fixture.json"
    fixture.write_text(
        """{
          "schemaVersion":"vneps-procurement-fixture-v1",
          "plans":[{"familyNo":"PL2600000001","revisions":[{
            "revisionId":"plan-01","revisionNumber":"01","packages":[{
              "planDetailRevisionId":"detail-b","stablePackageId":"stable-b",
              "symbol":"B","noticeLink":{"state":"LINKED",
              "noticeNo":"IB2600000002","kind":"TBMT"}
            }]
          }]}],
          "notices":[{"noticeNo":"IB2600000002","revisions":[{
            "revisionId":"notice-00","revisionNumber":"00","kind":"TBMT"
          }]}]
        }""",
        encoding="utf-8",
    )
    monkeypatch.setenv("APP_ENV", "test")
    source = FixtureProcurementSource(str(fixture))

    assert source.resolve_notice_package("IB2600000002", "notice-00") == {
        "planNo": "PL2600000001",
        "planRevisionId": "plan-01",
        "planDetailRevisionId": "detail-b",
        "stablePackageId": "stable-b",
        "symbol": "B",
    }


def test_procurement_transport_enforces_tls_size_host_and_positive_cache():
    calls = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, limit):
            assert limit == 1025
            return json.dumps({"items": [{"id": "revision-1"}]}).encode()

    def open_request(request, *, allowed_hosts, timeout, context):
        calls.append((request.full_url, allowed_hosts, timeout, context))
        return Response()

    transport = VnepsProcurementTransport(
        open_request=open_request,
        max_response_bytes=1024,
        cache_ttl_seconds=60,
    )
    first = transport.post_json(
        "/o/egp/services/get-version-list",
        {"planNo": "PL2600000001"},
        cache_key=("PLAN_VERSIONS", "PL2600000001"),
    )
    second = transport.post_json(
        "/o/egp/services/get-version-list",
        {"planNo": "PL2600000001"},
        cache_key=("PLAN_VERSIONS", "PL2600000001"),
    )

    assert first == second == {"items": [{"id": "revision-1"}]}
    assert len(calls) == 1
    assert calls[0][0].startswith("https://muasamcong.mpi.gov.vn/")
    assert calls[0][1] == {"muasamcong.mpi.gov.vn"}
    assert calls[0][3].minimum_version == ssl.TLSVersion.TLSv1_2
    assert calls[0][3].check_hostname is True
    assert calls[0][3].verify_mode == ssl.CERT_REQUIRED


def test_procurement_transport_retries_transient_failure_and_negative_caches():
    attempts = []
    sleeps = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return b"[]"

    def open_request(*_args, **_kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise urllib.error.URLError("transient")
        return Response()

    transport = VnepsProcurementTransport(
        open_request=open_request, retries=1, timeout_seconds=5,
        sleep=sleeps.append,
    )
    assert transport.post_json(
        "/versions", {}, cache_key=("NOTICE_VERSIONS", "IB2600000001")
    ) == []
    assert transport.post_json(
        "/versions", {}, cache_key=("NOTICE_VERSIONS", "IB2600000001")
    ) == []
    assert len(attempts) == 2
    assert len(sleeps) == 1


def test_procurement_transport_size_guard_and_circuit_breaker():
    class OversizedResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, limit):
            return b"x" * limit

    oversized = VnepsProcurementTransport(
        open_request=lambda *_args, **_kwargs: OversizedResponse(),
        max_response_bytes=1024,
        retries=0,
    )
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_SCHEMA_CHANGED"):
        oversized.post_json("/versions", {})

    calls = []

    def unavailable(*_args, **_kwargs):
        calls.append(1)
        raise TimeoutError("timeout")

    circuit = VnepsProcurementTransport(
        open_request=unavailable, retries=0, timeout_seconds=5,
        circuit_seconds=30,
    )
    for _ in range(3):
        with pytest.raises(ProcurementSourceError, match="PROCUREMENT_LOOKUP_TIMEOUT"):
            circuit.post_json("/versions", {})
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_LOOKUP_BUSY"):
        circuit.post_json("/versions", {})
    assert len(calls) == 3


def test_procurement_transport_rejects_bad_origin_and_exhausted_capacity():
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_LOOKUP_DISABLED"):
        VnepsProcurementTransport(origin="http://muasamcong.mpi.gov.vn")
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_LOOKUP_DISABLED"):
        VnepsProcurementTransport(origin="https://example.test")

    transport = VnepsProcurementTransport()

    class NoCapacity:
        def acquire(self, **_kwargs):
            return False

        def release(self):
            raise AssertionError("unacquired capacity must not be released")

    transport._slots = NoCapacity()
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_LOOKUP_BUSY"):
        transport.post_json("/versions", {})
