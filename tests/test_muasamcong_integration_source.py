from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.integrations.muasamcong_browser.canonical import (
    ImportParserRegistry,
    normalize_opening_bundle,
    normalize_plan_revision,
    normalize_result_bundle,
)
from backend.integrations.muasamcong_browser.classifier import (
    UpstreamClassification,
    classify_upstream_error,
)
from backend.integrations.muasamcong_browser.procurement_source import (
    MuaSamCongProcurementSource,
)
from backend.integrations.muasamcong_browser.diagnostics import (
    DiagnosticRecorder,
    sanitized_shape,
)
from backend.procurement_import.source import ProcurementSourceError


FIXTURES = Path(__file__).parent / "fixtures" / "muasamcong"


def fixture(*parts):
    return json.loads((FIXTURES.joinpath(*parts)).read_text(encoding="utf-8"))


def test_plan_fixture_maps_packages_without_conflating_plan_symbol_and_tbmt():
    raw = fixture("plan", "plan_revision_v1.json")
    assert classify_upstream_error() is UpstreamClassification.FOUND_SUPPORTED
    revision = ImportParserRegistry().parse(
        "plan:v1:fixture",
        raw,
        family_no="PL2600000001",
        revision_id="sanitized-plan-01",
        revision_number="01",
    )

    assert revision["revisionNumber"] == "01"
    assert [row["symbol"] for row in revision["packages"]] == ["A", "B"]
    assert revision["packages"][0]["noticeLink"]["state"] == "UNLINKED"
    assert revision["packages"][1]["noticeLink"] == {
        "state": "LINKED",
        "noticeNo": "IB2600000002",
        "kind": "TBMT",
        "noticeRevisionId": "notice-01",
        "noticeVersion": "01",
    }
    assert revision["packages"][1]["symbol"] != (
        revision["packages"][1]["noticeLink"]["noticeNo"]
    )


def test_notice_fixture_maps_revision_and_package_relationship():
    raw = fixture("notice", "ldt", "notice_revision_v1.json")
    assert classify_upstream_error() is UpstreamClassification.FOUND_SUPPORTED
    revision = ImportParserRegistry().parse(
        "package-notice:v1:fixture",
        raw,
        notice_no="IB2600000002",
        revision_id="notice-01",
        revision_number="01",
    )

    assert revision["planNo"] == "PL2600000001"
    assert revision["stablePackageId"] == "B"
    assert revision["selectionMode"] == "1_HTHS"
    assert revision["bidOpeningAt"] == "2026-03-01T09:15:00"


def test_package_lookup_maps_complete_notice_fields_into_preview():
    source = MuaSamCongProcurementSource(FakeRuntime())

    result = source.lookup("IB2600000002", "PACKAGE")

    assert result["data"] == {
        "notifyNo": "IB2600000002",
        "notifyId": "notice-01",
        "planNo": "PL2600000001",
        "bidName": "Gói B",
        "bidPrice": 1_400_000_000,
        "implementationPeriod": "30 ngày",
        "capitalDetail": "Ngân sách nhà nước",
        "bidField": "HH",
        "bidForm": "DTRR",
        "bidMode": "1_HTHS",
        "processApply": "LDT",
        "contractType": "TG",
        "bidCloseDate": "2026-03-01T09:00:00",
        "bidOpenDate": "2026-03-01T09:15:00",
        "bidOpenId": "opening-01",
        "inputResultId": None,
    }


def test_opening_fixtures_cover_normal_lots_and_two_envelope_phases():
    registry = ImportParserRegistry()
    assert classify_upstream_error() is UpstreamClassification.FOUND_SUPPORTED
    normal = registry.parse(
        "opening:v1:normal-fixture",
        fixture("opening", "normal", "opening_v1.json"),
        notice_no="IB2600000002",
        revision_id="notice-01",
    )
    lots = registry.parse(
        "opening:v1:lots-fixture",
        fixture("opening", "lots", "opening_lots_v1.json"),
        notice_no="IB2600000002",
        revision_id="notice-01",
    )
    two_envelope = registry.parse(
        "opening:v1:1g2t-fixture",
        fixture("opening", "1g2t", "opening_1g2t_v1.json"),
        notice_no="IB2600000002",
        revision_id="notice-01",
    )

    assert len(normal["bidders"]) == 2
    normal_by_code = {
        row["contractorCode"]: row for row in normal["bidders"]
    }
    assert normal_by_code["0100000001"]["bidPrice"] == 95_000_000
    assert normal_by_code["0100000001"]["priceAfterDiscount"] == 90_250_000
    assert normal_by_code["0100000005"]["bidPrice"] == 0
    assert [row["lotNo"] for row in lots["lots"]] == ["01", "02"]
    assert lots["bidders"][0]["lotNo"] == "01"
    assert {row["phase"] for row in two_envelope["bidders"]} == {
        "TECHNICAL",
        "FINANCIAL",
    }
    technical = next(
        row for row in two_envelope["bidders"] if row["phase"] == "TECHNICAL"
    )
    assert len(technical["jointVentureMembers"]) == 2


def test_opening_parser_preserves_zero_and_missing_optional_prices():
    opening = normalize_opening_bundle(
        {
            "opening_bid_1": {
                "bidOpenView": [
                    {"contractorCode": "0100000001", "contractorName": "A"},
                    {
                        "contractorCode": "0100000002",
                        "contractorName": "B",
                        "bidPrice": 0,
                    },
                ]
            }
        },
        notice_no="IB2600000002",
        revision_id="notice-01",
    )

    assert [row["bidPrice"] for row in opening["bidders"]] == [None, 0]


def test_result_fixture_flows_through_fingerprint_registry_to_canonical_dto():
    raw = fixture("results", "result_v1.json")
    registry = ImportParserRegistry()

    assert classify_upstream_error() is UpstreamClassification.FOUND_SUPPORTED
    assert registry.resolve("result:v1:fixture") is normalize_result_bundle
    result = registry.parse(
        "result:v1:fixture",
        raw,
        notice_no="IB2600000002",
        revision_id="notice-01",
    )

    assert result == {
        "noticeNo": "IB2600000002",
        "revisionId": "notice-01",
        "status": "APPROVED",
        "approvalDecisionNo": "123/QD-CDT",
        "approvalDecisionDate": "2026-04-15",
        "contractors": [
            {
                "contractorCode": "0100000002",
                "contractorName": "Cong ty Xep hang hai",
                "lotNo": "01",
                "phase": "SELECTION",
                "rank": 2,
                "isWinner": False,
                "technicalStatus": None,
                "bidPrice": 97_000_000,
                "evaluatedPrice": 96_000_000,
            },
            {
                "contractorCode": "0100000001",
                "contractorName": "Cong ty Trung thau",
                "lotNo": "01",
                "phase": "SELECTION",
                "rank": 1,
                "isWinner": True,
                "technicalStatus": None,
                "bidPrice": 95_000_000,
                "evaluatedPrice": 92_500_000,
            },
            {
                "contractorCode": "0100000002",
                "contractorName": "Cong ty Xep hang hai",
                "lotNo": "01",
                "phase": "TECHNICAL",
                "rank": None,
                "isWinner": None,
                "technicalStatus": "PASS",
                "bidPrice": None,
                "evaluatedPrice": None,
            },
            {
                "contractorCode": "0100000001",
                "contractorName": "Cong ty Trung thau",
                "lotNo": "01",
                "phase": "TECHNICAL",
                "rank": None,
                "isWinner": None,
                "technicalStatus": "PASS",
                "bidPrice": None,
                "evaluatedPrice": None,
            },
        ],
        "hasSelectionResult": True,
        "hasTechnicalResult": True,
    }


def test_parser_registry_fails_loudly_for_unknown_schema():
    registry = ImportParserRegistry()

    assert registry.resolve("plan:v1:abc") is normalize_plan_revision
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_SCHEMA_CHANGED"):
        registry.resolve("plan:v2:unknown")


def test_upstream_error_taxonomy_distinguishes_every_required_classification():
    assert classify_upstream_error() is UpstreamClassification.FOUND_SUPPORTED
    assert classify_upstream_error(
        "PROCUREMENT_SCHEMA_CHANGED"
    ) is UpstreamClassification.FOUND_SCHEMA_CHANGED
    assert classify_upstream_error(
        "PROCUREMENT_NOT_FOUND"
    ) is UpstreamClassification.NOT_FOUND
    assert classify_upstream_error(
        "PROCUREMENT_SESSION_FAILED"
    ) is UpstreamClassification.SESSION_FAILED
    assert classify_upstream_error(
        "PROCUREMENT_ENDPOINT_CHANGED"
    ) is UpstreamClassification.ENDPOINT_CHANGED
    assert classify_upstream_error(
        "PROCUREMENT_UPSTREAM_UNAVAILABLE"
    ) is UpstreamClassification.UPSTREAM_CHANGED
    assert classify_upstream_error(
        partial=True
    ) is UpstreamClassification.PARTIAL_DATA


def test_shadow_parser_reports_diff_without_replacing_active_result():
    registry = ImportParserRegistry(shadow_enabled=True)
    events = []

    def shadow(raw, **kwargs):
        canonical = normalize_plan_revision(raw, **kwargs)
        return {**canonical, "name": "Untrusted shadow value"}

    registry.register_shadow(
        "plan", "v1", shadow, parser_version="2026.09-candidate"
    )
    canonical = registry.parse(
        "plan:v1:fixture",
        fixture("plan", "plan_revision_v1.json"),
        family_no="PL2600000001",
        revision_id="sanitized-plan-01",
        revision_number="01",
        shadow_observer=events.append,
    )

    assert canonical["name"] != "Untrusted shadow value"
    assert events == [{
        "status": "DIFF",
        "fingerprint": "plan:v1:fixture",
        "activeParserVersion": "2026.08",
        "shadowParserVersion": "2026.09-candidate",
    }]


def test_diagnostic_shape_removes_token_cookie_and_values(tmp_path):
    raw = {
        "token": "top-secret-token",
        "Cookie": "top-secret-cookie",
        "authorization": "Bearer secret",
        "payload": {"notifyNo": "IB2600000002", "bidPrice": 100},
    }
    shape = sanitized_shape(raw)

    assert shape["token"] == "<redacted>"
    assert shape["Cookie"] == "<redacted>"
    assert shape["authorization"] == "<redacted>"
    assert shape["payload"] == {"notifyNo": "string", "bidPrice": "number"}

    recorder = DiagnosticRecorder(tmp_path, enabled=True)
    path = recorder.record(
        kind="PACKAGE",
        code="IB2600000002",
        operation="NOTICE_DETAIL",
        fingerprint="package-notice:v2:unknown",
        strategy="protected-api",
        error_code="PROCUREMENT_SCHEMA_CHANGED",
        raw=raw,
    )
    persisted = path.read_text(encoding="utf-8")
    assert "top-secret" not in persisted
    assert "PROCUREMENT_SCHEMA_CHANGED" in persisted


class FakeRuntime:
    def list_plan_revisions(self, plan_no):
        return {
            "revisions": [
                {"revisionId": "sanitized-plan-01", "revisionNumber": "01"},
                {"revisionId": "sanitized-plan-00", "revisionNumber": "00"},
            ]
        }

    def get_plan_revision(self, plan_no, revision_id):
        return {
            "raw": fixture("plan", "plan_revision_v1.json"),
            "fingerprint": "plan:v1:fixture",
            "retrievedAt": "2026-08-11T00:00:00Z",
            "metadata": {"profile": "2026.08", "operation": "PLAN_DETAIL"},
        }

    def list_notice_revisions(self, notice_no):
        return {
            "revisions": [
                {"revisionId": "notice-00", "revisionNumber": "00"},
                {"revisionId": "notice-01", "revisionNumber": "01"},
            ]
        }

    def get_notice_revision(self, notice_no, revision_id):
        return {
            "raw": fixture("notice", "ldt", "notice_revision_v1.json"),
            "fingerprint": "package-notice:v1:fixture",
            "retrievedAt": "2026-08-11T00:00:00Z",
            "metadata": {"profile": "2026.08", "operation": "NOTICE_LDT_DETAIL"},
        }

    def get_opening_bundle(self, notice_no, revision_id):
        return {
            "raw": fixture("opening", "normal", "opening_v1.json"),
            "fingerprint": "opening:v1:fixture",
            "retrievedAt": "2026-08-11T00:00:00Z",
            "processApply": "LDT",
            "bidMode": "1_MTHS",
            "failures": [],
            "metadata": {"profile": "2026.08", "operation": "OPENING_BID"},
        }

    def get_result_bundle(self, notice_no, revision_id):
        return {
            "raw": fixture("results", "result_v1.json"),
            "fingerprint": "result:v1:fixture",
            "retrievedAt": "2026-08-11T00:00:00Z",
            "failures": [],
            "metadata": {"profile": "2026.08", "operation": "SELECTION_RESULT"},
        }

    def collect_complete_bundle(self, record):
        return {
            "type": record["type"],
            "fetchedAt": "2026-08-11T00:00:00Z",
            "fingerprint": "complete-bundle:v1:fixture",
            "sources": {"searchRecord": record, "primaryDetail": {}},
        }

    def integration_health(self):
        return {"status": "UP"}

    def close(self):
        return None


def test_unified_source_exposes_all_revisions_opening_and_lookup_contracts():
    source = MuaSamCongProcurementSource(FakeRuntime())

    assert [
        row["revisionNumber"]
        for row in source.list_plan_revisions("PL2600000001")
    ] == ["01", "00"]
    plan = source.get_plan_revision("PL2600000001", "sanitized-plan-01")
    notice = source.get_notice_revision("IB2600000002", "notice-01")
    opening = source.get_opening_bundle("IB2600000002", "notice-01")
    result = source.get_result_bundle("IB2600000002", "notice-01")
    complete = source.collect_complete_bundle(
        {"type": "es-shopping-result", "id": "result-1"}
    )
    lookup = source.lookup("PL2600000001", "PLAN")

    assert plan["source"]["schemaFingerprint"] == "plan:v1:fixture"
    assert notice["source"]["semanticOperation"] == "NOTICE_LDT_DETAIL"
    assert opening["schemaVersion"] == "biddingflow-opening-bundle-v1"
    assert result["schemaVersion"] == "biddingflow-result-bundle-v1"
    assert result["hasSelectionResult"] is True
    assert result["hasTechnicalResult"] is True
    assert "raw" not in result
    assert complete["schemaFingerprint"] == "complete-bundle:v1:fixture"
    assert lookup["source"]["provider"] == "MUASAMCONG"
    assert lookup["metrics"]["listMs"] >= 0
    assert lookup["metrics"]["detailMs"] >= 0
    assert lookup["metrics"]["totalMs"] >= (
        lookup["metrics"]["listMs"] + lookup["metrics"]["detailMs"]
    )
    assert "raw" not in lookup


def test_complete_lookup_maps_from_raw_bundle_and_can_reprocess_without_refetch():
    raw_revision = fixture("plan", "plan_revision_v1.json")
    raw_revision["bidpPlanDetailToProjectList"][0][
        "unknownFutureField2027"
    ] = {"abc": 123}

    class CompleteRuntime(FakeRuntime):
        def __init__(self):
            self.calls = []

        def search(self, code, kind):
            self.calls.append(("search", code, kind))
            return {
                "record": {
                    "type": "es-plan-project-p",
                    "id": "sanitized-plan-01",
                    "planNo": code,
                    "planVersion": "01",
                },
                "raw": {"page": {"content": [{"planNo": code}]}},
                "request": [{"query": [{"keyWord": code}]}],
                "fingerprint": "search:v1:fixture",
                "metadata": {"operation": "SEARCH"},
            }

        def collect_complete_bundle(self, record, **options):
            self.calls.append(("complete", record["planNo"], options))
            return {
                "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
                "provider": "MUASAMCONG",
                "entity": {"kind": "PLAN", "planNo": record["planNo"]},
                "status": "FOUND_COMPLETE",
                "complete": True,
                "sources": {"search": {"success": True}},
                "revisions": {
                    "00": {
                        "revisionId": "sanitized-plan-00",
                        "sources": {"planDetail": {
                            "success": True,
                            "response": raw_revision,
                            "schemaFingerprint": "plan:v1:fixture",
                            "retrievedAt": "2026-08-11T00:00:00Z",
                        }},
                        "packages": {},
                    },
                    "01": {
                        "revisionId": "sanitized-plan-01",
                        "sources": {"planDetail": {
                            "success": True,
                            "response": raw_revision,
                            "schemaFingerprint": "plan:v1:fixture",
                            "retrievedAt": "2026-08-11T00:00:00Z",
                        }},
                        "packages": {},
                    },
                },
                "failures": [],
                "manifest": {
                    "sourceCount": 3,
                    "successCount": 3,
                    "failedCount": 0,
                    "revisions": ["00", "01"],
                    "packages": 2,
                    "operations": ["SEARCH", "PLAN_DETAIL"],
                },
                "metrics": {"upstream": {"requestCount": 3}},
            }

    runtime = CompleteRuntime()
    source = MuaSamCongProcurementSource(runtime)

    result = source.lookup_with_options(
        "PL2600000001",
        "PLAN",
        detail_level="COMPLETE",
        revision_mode="ALL",
    )
    canonical_again = source.map_plan_raw_bundle(result["rawBundle"])
    projected = source.lookup_from_raw_bundle(
        "PL2600000001", result["rawBundle"], revision_mode="ALL"
    )

    assert [
        row["revisionNumber"] for row in result["canonical"]["revisions"]
    ] == ["00", "01"]
    assert result["rawBundle"]["revisions"]["00"]["sources"][
        "planDetail"
    ]["response"]["bidpPlanDetailToProjectList"][0][
        "unknownFutureField2027"
    ] == {"abc": 123}
    assert canonical_again == result["canonical"]
    assert projected["canonical"] == result["canonical"]
    assert projected["metrics"]["upstream"] == {
        "requestCount": 0, "networkMs": 0,
    }
    assert projected["source"]["extractionStrategy"] == (
        "stored-raw-projection"
    )
    assert runtime.calls[0] == ("search", "PL2600000001", "PLAN")
    assert len(runtime.calls) == 2


def test_complete_notice_bundle_maps_opening_result_and_contract_sources():
    raw_notice = fixture("notice", "ldt", "notice_revision_v1.json")
    bundle = {
        "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
        "provider": "MUASAMCONG",
        "entity": {
            "kind": "NOTICE",
            "canonicalCode": "IB2600000002",
            "noticeNo": "IB2600000002",
        },
        "status": "FOUND_COMPLETE",
        "complete": True,
        "retrievedAt": "2026-08-12T00:00:00Z",
        "sources": {
            "contractList": {
                "operation": "NOTICE_CONTRACT_LIST",
                "success": True,
                "response": [{
                    "id": "contract-1",
                    "contractCode": "HD2600000001",
                    "contractDate": "2026-04-10",
                    "contractValue": 123456789,
                    "contractorCode": "vn0100000001",
                    "contractorName": "Nhà thầu A",
                }],
            }
        },
        "revisions": {
            "01": {
                "revisionId": "notice-01",
                "sources": {
                    "noticeDetail": {
                        "operation": "NOTICE_LDT_DETAIL",
                        "success": True,
                        "response": raw_notice,
                        "schemaFingerprint": "package-notice:v1:fixture",
                        "retrievedAt": "2026-08-12T00:00:00Z",
                    },
                    "tenderInfo": {
                        "operation": "NOTICE_TENDER_INFO",
                        "success": True,
                        "response": {
                            "notifyNo": "IB2600000002",
                            "bidPrice": 987654321,
                            "capitalDetail": "Nguồn vốn sidecar",
                        },
                    },
                    "opening_bid_0": {
                        "operation": "OPENING_BID",
                        "success": True,
                        "response": {
                            "bidSubmissionByContractorViewResponse": {
                                "bidSubmissionDTOList": [{
                                    "contractorCode": "vn0100000001",
                                    "contractorName": "Nhà thầu A",
                                    "bidPrice": 900000000,
                                    "bidValidity": 90,
                                }]
                            }
                        },
                    },
                    "opening_lot_detail_0": {
                        "operation": "OPENING_LOT_DETAIL",
                        "success": True,
                        "response": [{
                            "contractorCode": "vn0100000001",
                            "contractorName": "Nhà thầu A",
                            "lotNo": "PP01",
                            "lotName": "Lô 1",
                            "lotFinalPrice": 900000000,
                        }],
                    },
                    "technicalResult": {
                        "operation": "TECHNICAL_RESULT",
                        "success": True,
                        "response": {
                            "contractors": [{
                                "contractorCode": "vn0100000001",
                                "contractorName": "Nhà thầu A",
                                "technicalStatus": "Đạt",
                            }]
                        },
                    },
                    "selectionResult": {
                        "operation": "SELECTION_RESULT",
                        "success": True,
                        "response": {
                            "decisionNo": "QD-01",
                            "contractors": [{
                                "contractorCode": "vn0100000001",
                                "contractorName": "Nhà thầu A",
                                "isWinner": True,
                                "winningPrice": 880000000,
                            }]
                        },
                    },
                },
            }
        },
        "failures": [],
        "manifest": {"revisions": ["01"]},
        "metrics": {"upstream": {"requestCount": 10}},
    }
    source = MuaSamCongProcurementSource(FakeRuntime())

    canonical = source.map_notice_raw_bundle(bundle)
    projected = source.lookup_from_raw_bundle(
        "IB2600000002", bundle, revision_mode="ALL"
    )

    revision = canonical["revisions"][0]
    assert revision["priceVnd"] == 987654321
    assert revision["capitalDetail"] == "Nguồn vốn sidecar"
    assert revision["opening"]["bidders"][0]["contractorCode"] == (
        "vn0100000001"
    )
    assert revision["opening"]["bidders"][1]["lotNo"] == "PP01"
    assert revision["result"]["hasSelectionResult"] is True
    assert revision["result"]["hasTechnicalResult"] is True
    assert canonical["contracts"][0]["contractCode"] == "HD2600000001"
    assert canonical["contracts"][0]["contractValue"] == 123456789
    assert projected["kind"] == "PACKAGE"
    assert projected["data"]["bidPrice"] == 987654321
    assert projected["data"]["contracts"][0]["contractCode"] == (
        "HD2600000001"
    )
    assert projected["metrics"]["upstream"] == {
        "requestCount": 0,
        "networkMs": 0,
    }


def test_unified_lookup_falls_back_to_browser_extractors_when_api_is_unavailable():
    class FailedApiRuntime(FakeRuntime):
        def list_plan_revisions(self, _plan_no):
            raise RuntimeError("PROCUREMENT_SESSION_FAILED")

    class BrowserFallback:
        def lookup(self, code, kind):
            assert (code, kind) == ("PL2600000001", "PLAN")
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "found": True,
                "kind": "PLAN",
                "inputCode": code,
                "canonicalCode": code,
                "source": {
                    "provider": "MUASAMCONG_BROWSER",
                    "driver": "generic",
                    "extractionStrategy": "semantic-dom",
                },
                "data": {"planNo": code, "packages": []},
                "metrics": {"totalMs": 25},
            }

    source = MuaSamCongProcurementSource(
        FailedApiRuntime(), browser_fallback=BrowserFallback()
    )

    result = source.lookup("PL2600000001", "PLAN")

    assert result["source"]["provider"] == "MUASAMCONG"
    assert result["source"]["extractionStrategy"] == "semantic-dom"


def test_import_source_observer_emits_complete_secret_free_dimensions():
    events = []
    source = MuaSamCongProcurementSource(FakeRuntime(), observer=events.append)

    with source.lookup_request_context("lookup-request-1"):
        source.get_plan_revision("PL2600000001", "sanitized-plan-01")

    assert len(events) == 1
    event = events[0]
    assert set(event) == {
        "provider",
        "lookupRequestId",
        "kind",
        "semanticOperation",
        "totalMs",
        "browserStartupMs",
        "sessionAcquireMs",
        "sessionCacheHit",
        "navigationMs",
        "networkWaitMs",
        "extractMs",
        "normalizeMs",
        "parserVersion",
        "schemaFingerprint",
        "extractionStrategy",
        "retries",
        "sessionRefreshCount",
        "classification",
    }
    assert event["provider"] == "MUASAMCONG"
    assert event["lookupRequestId"] == "lookup-request-1"
    assert event["sessionCacheHit"] is False
    assert event["semanticOperation"] == "PLAN_DETAIL"
    assert event["schemaFingerprint"] == "plan:v1:fixture"
    assert event["classification"] == "FOUND_SUPPORTED"
    assert "token" not in json.dumps(event).casefold()
    assert "cookie" not in json.dumps(event).casefold()
