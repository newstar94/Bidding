from copy import deepcopy
import os
from threading import Event, Thread
import time
from types import SimpleNamespace
import uuid

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.integrations.muasamcong_browser.procurement_source import (
    MuaSamCongProcurementSource,
)
import backend.procurement_import.routes as routes_module
from backend.db.db_helper import PostgresDatabase
from backend.procurement_import.routes import (
    ProcurementRouteError,
    _bundle_local_authority_signature,
    _load_opening_from_raw_snapshot,
    _resolve_revision_decisions,
    _validate_plan_local_target,
    build_procurement_source,
    procurement_import_routes,
)
from backend.procurement_import.domain import canonical_digest
from backend.shared.access_policy import AccessDecision


class _PackageAuthorityCursor:
    def __init__(self, current):
        self.current = current
        self.params = None

    def execute(self, _query, params):
        self.params = params
        return self

    def fetchone(self):
        return self.current


def _assert_package_authority_stale(current, target=None, organization_id="org-1"):
    cursor = _PackageAuthorityCursor(current)
    expected = target or {
        "localRootId": "root-a",
        "snapshotId": "snapshot-a",
        "localVersion": 1,
        "rowVersion": 7,
        "isLatest": True,
    }
    with pytest.raises(ProcurementRouteError) as caught:
        _validate_plan_local_target(cursor, organization_id, expected)
    assert caught.value.code == "PROCUREMENT_PREVIEW_STALE"
    assert cursor.params == (organization_id, expected["localRootId"])


def test_package_same_root_new_rowversion_after_bind_is_rejected():
    _assert_package_authority_stale(("snapshot-a", "root-a", 1, 8, 1))


def test_package_same_root_new_localversion_after_bind_is_rejected():
    _assert_package_authority_stale(("snapshot-a", "root-a", 2, 7, 1))


def test_package_snapshot_id_changed_after_bind_is_rejected():
    _assert_package_authority_stale(("snapshot-b", "root-a", 1, 7, 1))


def test_package_deleted_after_bind_is_rejected():
    _assert_package_authority_stale(None)


def test_package_no_longer_latest_after_bind_is_rejected():
    _assert_package_authority_stale(("snapshot-a", "root-a", 1, 7, 0))


def test_package_from_other_org_cannot_be_revalidated_as_target():
    # The organization-scoped query cannot see a row that exists only elsewhere.
    _assert_package_authority_stale(None, organization_id="org-current")


def test_background_enrichment_does_not_rebase_to_new_plan_predecessor():
    original = {"plan": {"expectedPredecessor": {
        "id": "plan-1", "rootId": "plan-root", "localVersion": 1, "rowVersion": 3,
    }}}
    refreshed = deepcopy(original)
    refreshed["plan"]["expectedPredecessor"]["rowVersion"] = 4
    assert _bundle_local_authority_signature(original) != _bundle_local_authority_signature(refreshed)


def test_background_enrichment_does_not_rebase_to_new_package_snapshot():
    original = {
        "revisions": [{"revisionId": "rev-00"}],
        "reconciliationByRevision": {"rev-00": [{
            "planDetailRevisionId": "detail-a",
            "localTarget": {
                "rootId": "root-a", "snapshotId": "snapshot-a",
                "localVersion": 1, "rowVersion": 3,
            },
        }]},
    }
    refreshed = deepcopy(original)
    refreshed["reconciliationByRevision"]["rev-00"][0]["localTarget"]["snapshotId"] = "snapshot-b"
    assert _bundle_local_authority_signature(original) != _bundle_local_authority_signature(refreshed)


def test_enrichment_digest_change_invalidates_candidate_specific_decisions():
    original = {
        "revisions": [{"revisionId": "rev-00"}],
        "decisionAuthority": {"status": "BOUND", "decisionsDigest": "old"},
        "reconciliationByRevision": {"rev-00": [{
            "planDetailRevisionId": "detail-a", "action": "AMBIGUOUS",
            "matchCandidates": [{
                "rootId": "root-a", "snapshotId": "snapshot-a",
                "localVersion": 1, "rowVersion": 3,
            }],
        }]},
    }
    enriched = deepcopy(original)
    enriched.pop("decisionAuthority", None)
    enriched["revisions"][0]["packages"] = [{
        "planDetailRevisionId": "detail-a", "name": "Gói mới",
    }]
    assert canonical_digest(original) != canonical_digest(enriched)
    assert "decisionAuthority" not in enriched
from backend.procurement_import.service import PreviewStore


def test_opening_prepare_reuses_complete_exact_raw_snapshot():
    class RawRepository:
        def load_fresh_notice_bundle(self, organization_id, notice_no, **options):
            assert (organization_id, notice_no) == ("org-1", "IB2600000002")
            assert options["detail_level"] == "COMPLETE"
            assert options["revision_mode"] == "SELECTED"
            assert options["revision_numbers"] == ["01"]
            return {
                "complete": True,
                "entity": {"kind": "NOTICE"},
                "revisions": {
                    "01": {
                        "revisionId": "notice-01",
                        "revisionNumber": "01",
                        "sources": {
                                "opening_round_0": {
                                    "operation": "OPENING_ROUND",
                                    "success": True,
                                    "response": {"bidStatus": "OPEN_BID"},
                            },
                            "opening_bid_0": {
                                "operation": "OPENING_BID",
                                "success": True,
                                "response": {
                                    "bidSubmissionByContractorViewResponse": {
                                        "bidSubmissionDTOList": [],
                                    },
                                },
                            },
                        },
                    },
                },
            }

    class Source:
        def lookup_from_raw_bundle(self, notice_no, bundle, **options):
            assert notice_no == "IB2600000002"
            assert bundle["complete"] is True
            assert options == {"revision_mode": "SELECTED", "detail_level": "COMPLETE"}
            return {"canonical": {"revisions": [{
                "revisionId": "notice-01",
                "revisionNumber": "01",
                "opening": {
                    "openingAt": "2026-08-03T13:08:42",
                    "bidders": [{"contractorName": "Nhà thầu A"}],
                    "lots": [],
                },
            }]}}

        def get_opening_bundle(self, *_args):
            raise AssertionError("cache hit must not call upstream opening")

    opening = _load_opening_from_raw_snapshot(
        Source(), RawRepository(), "org-1", "IB2600000002",
        {"revisionId": "notice-01", "revisionNumber": "01"},
    )

    assert opening["openingAt"] == "2026-08-03T13:08:42"
    assert opening["source"]["driver"] == "raw-snapshot"


def test_opening_prepare_rejects_partial_raw_snapshot_for_cache_reuse():
    class RawRepository:
        def load_fresh_notice_bundle(self, *_args, **_kwargs):
            return {"complete": False, "entity": {"kind": "NOTICE"}}

    class Source:
        def lookup_from_raw_bundle(self, *_args, **_kwargs):
            raise AssertionError("partial evidence must not fabricate opening")

    assert _load_opening_from_raw_snapshot(
        Source(), RawRepository(), "org-1", "IB2600000002",
        {"revisionId": "notice-01", "revisionNumber": "01"},
    ) is None


def test_opening_prepare_reuses_opening_sources_from_partial_notice_snapshot():
    class RawRepository:
        def load_fresh_notice_bundle(self, *_args, **_kwargs):
            return {
                "complete": False,
                "sources": {
                    "otherVersionList": {
                        "operation": "NOTICE_OTHER_VERSION_LIST",
                        "success": False,
                    },
                },
                "revisions": {
                    "01": {
                        "revisionId": "notice-01",
                        "revisionNumber": "01",
                        "identifiers": {"isMultiLot": True},
                        "sources": {
                            "opening_round_0": {
                                "operation": "OPENING_ROUND",
                                "success": True,
                                "response": {"bidStatus": "OPEN_BID"},
                            },
                            "opening_bid": {
                                "operation": "OPENING_BID",
                                "success": True,
                                "response": {
                                    "bidSubmissionByContractorViewResponse": {
                                        "bidSubmissionDTOList": [],
                                    },
                                },
                            },
                            "opening_lot_0": {
                                "operation": "OPENING_LOT",
                                "success": True,
                                "response": [],
                            },
                            "opening_lot_detail": {
                                "operation": "OPENING_LOT_DETAIL",
                                "success": True,
                                "response": [],
                            },
                        },
                    },
                },
            }

    class Source:
        name = "MUASAMCONG"

        def lookup_from_raw_bundle(self, *_args, **_kwargs):
            return {"canonical": {"revisions": [{
                "revisionId": "notice-01",
                "revisionNumber": "01",
                "opening": {
                    "openingAt": "2026-08-16T08:51:09Z",
                    "bidders": [{
                        "contractorCode": "C-01",
                        "bidGuarantee": 119_830_000,
                    }],
                    "lots": [],
                },
            }]}}

        def get_opening_bundle(self, *_args):
            raise AssertionError("opening source must be reused from raw snapshot")

    opening = _load_opening_from_raw_snapshot(
        Source(), RawRepository(), "org-1", "IB2600000002",
        {"revisionId": "notice-01", "revisionNumber": "01"},
    )

    assert opening["bidders"][0]["bidGuarantee"] == 119_830_000
    assert opening["source"]["driver"] == "raw-snapshot"


def test_opening_prepare_rejects_cached_lot_rows_without_bid_open():
    class RawRepository:
        def load_fresh_notice_bundle(self, *_args, **_kwargs):
            return {
                "complete": False,
                "revisions": {
                    "01": {
                        "revisionId": "notice-01",
                        "revisionNumber": "01",
                        "sources": {
                            "opening_lot_detail_0": {
                                "operation": "OPENING_LOT_DETAIL",
                                "success": True,
                            },
                        },
                    },
                },
            }

    class Source:
        def lookup_from_raw_bundle(self, *_args, **_kwargs):
            raise AssertionError(
                "lot rows without bid-open are not complete opening evidence"
            )

    assert _load_opening_from_raw_snapshot(
        Source(), RawRepository(), "org-1", "IB2600000002",
        {"revisionId": "notice-01", "revisionNumber": "01"},
    ) is None


def test_opening_prepare_rejects_cached_cross_source_bidder_mismatch():
    class RawRepository:
        def load_fresh_notice_bundle(self, *_args, **_kwargs):
            return {
                "complete": True,
                "entity": {"kind": "NOTICE", "canonicalCode": "IB2600000002"},
                "revisions": {
                    "01": {
                        "revisionId": "notice-01",
                        "revisionNumber": "01",
                        "sources": {
                            "opening_round_0": {
                                "operation": "OPENING_ROUND",
                                "success": True,
                                "response": {"bidStatus": "OPEN_BID"},
                            },
                            "opening_bid_0": {
                                "operation": "OPENING_BID",
                                "success": True,
                                "response": {
                                    "bidSubmissionByContractorViewResponse": {
                                        "bidSubmissionDTOList": [
                                            {"contractorCode": "NT-A"},
                                        ],
                                    },
                                },
                            },
                            "opening_lot_0": {
                                "operation": "OPENING_LOT",
                                "success": True,
                                "response": [{
                                    "lotNo": "L01",
                                    "bidOpenView": [{"contractorCode": "NT-B"}],
                                }],
                            },
                            "opening_lot_detail_0": {
                                "operation": "OPENING_LOT_DETAIL",
                                "success": True,
                                "response": [{"contractorCode": "NT-B", "lotNo": "L01"}],
                            },
                        },
                    },
                },
            }

    class Source:
        def lookup_from_raw_bundle(self, *_args, **_kwargs):
            raise AssertionError("cross-source inconsistent opening is not reusable")

    assert _load_opening_from_raw_snapshot(
        Source(), RawRepository(), "org-1", "IB2600000002",
        {"revisionId": "notice-01", "revisionNumber": "01"},
    ) is None


def test_opening_prepare_rejects_cached_two_envelope_missing_financial_bid():
    class RawRepository:
        def load_fresh_notice_bundle(self, *_args, **_kwargs):
            return {
                "complete": True,
                "revisions": {
                    "01": {
                        "revisionId": "notice-01",
                        "revisionNumber": "01",
                        "requiredOpeningSources": [
                            {"operation": "OPENING_ROUND", "packType": 1},
                            {"operation": "OPENING_BID", "packType": 1},
                            {"operation": "OPENING_ROUND", "packType": 2},
                            {"operation": "OPENING_BID", "packType": 2},
                        ],
                        "sources": {
                            "opening_round_1": {
                                "operation": "OPENING_ROUND",
                                "request": {"packType": 1},
                                "success": True,
                            },
                            "opening_bid_1": {
                                "operation": "OPENING_BID",
                                "request": {"packType": 1},
                                "success": True,
                                "response": {
                                    "bidSubmissionByContractorViewResponse": {
                                        "bidSubmissionDTOList": [],
                                    },
                                },
                            },
                            "opening_round_2": {
                                "operation": "OPENING_ROUND",
                                "request": {"packType": 2},
                                "success": True,
                            },
                        },
                    },
                },
            }

    class Source:
        def lookup_from_raw_bundle(self, *_args, **_kwargs):
            raise AssertionError("financial bid-open evidence is required")

    assert _load_opening_from_raw_snapshot(
        Source(), RawRepository(), "org-1", "IB2600000002",
        {"revisionId": "notice-01", "revisionNumber": "01"},
    ) is None


def test_opening_prepare_rejects_cached_invalid_bid_open_schema():
    class RawRepository:
        def load_fresh_notice_bundle(self, *_args, **_kwargs):
            return {
                "complete": True,
                "revisions": {
                    "01": {
                        "revisionId": "notice-01",
                        "revisionNumber": "01",
                        "requiredOpeningSources": [
                            {"operation": "OPENING_ROUND", "packType": 0},
                            {"operation": "OPENING_BID", "packType": 0},
                        ],
                        "sources": {
                            "opening_round_0": {
                                "operation": "OPENING_ROUND",
                                "request": {"packType": 0},
                                "success": True,
                            },
                            "opening_bid_0": {
                                "operation": "OPENING_BID",
                                "request": {"packType": 0},
                                "success": True,
                                "response": {},
                            },
                        },
                    },
                },
            }

    class Source:
        def lookup_from_raw_bundle(self, *_args, **_kwargs):
            raise AssertionError("invalid bid-open schema cannot be reused")

    assert _load_opening_from_raw_snapshot(
        Source(), RawRepository(), "org-1", "IB2600000002",
        {"revisionId": "notice-01", "revisionNumber": "01"},
    ) is None


def test_opening_prepare_rejects_cached_bid_open_without_response():
    class RawRepository:
        def load_fresh_notice_bundle(self, *_args, **_kwargs):
            return {
                "complete": True,
                "revisions": {
                    "01": {
                        "revisionId": "notice-01",
                        "revisionNumber": "01",
                        "sources": {
                            "opening_round_0": {
                                "operation": "OPENING_ROUND",
                                "success": True,
                            },
                            "opening_bid_0": {
                                "operation": "OPENING_BID",
                                "success": True,
                            },
                        },
                    },
                },
            }

    class Source:
        def lookup_from_raw_bundle(self, *_args, **_kwargs):
            raise AssertionError("missing bid-open response cannot be reused")

    assert _load_opening_from_raw_snapshot(
        Source(), RawRepository(), "org-1", "IB2600000002",
        {"revisionId": "notice-01", "revisionNumber": "01"},
    ) is None


def test_opening_raw_bundle_keeps_catalog_endpoint_for_snapshot_contract():
    raw_bundle = MuaSamCongProcurementSource._opening_raw_bundle(
        "IB2600000002",
        "notice-01",
        "01",
        {
            "raw": {
                "noticeDetail": {"notifyNo": "IB2600000002"},
                "opening_notify_0": {"bidStatus": "OPEN"},
                "opening_bid_0": {
                    "bidSubmissionByContractorViewResponse": {
                        "bidSubmissionDTOList": [],
                    },
                },
            },
            "retrievedAt": "2026-08-16T00:00:00Z",
            "fingerprint": "opening:v1:test",
            "noticeDetailOperation": "NOTICE_LDT_DETAIL",
            "sourceRequests": {
                "opening_bid_0": {
                    "notifyNo": "IB2600000002",
                    "notifyId": "actual-notify-id",
                    "type": "TBMT",
                    "packType": 0,
                    "authorization": "must-not-persist",
                },
            },
            "requiredOpeningSources": [
                {"operation": "OPENING_ROUND", "packType": 0},
                {"operation": "OPENING_BID", "packType": 0},
            ],
        },
    )

    sources = raw_bundle["revisions"]["01"]["sources"]
    assert sources["noticeDetail"]["endpoint"] == (
        "/expose/lcnt/bid-po-bido-notify-contractor-view/get-by-id"
    )
    assert sources["opening_notify_0"]["endpoint"] == (
        "/exposeldtkqmt/bid-notification-p/notify"
    )
    assert raw_bundle["revisions"]["01"]["requiredOpeningSources"] == [
        {"operation": "OPENING_ROUND", "packType": 0},
        {"operation": "OPENING_BID", "packType": 0},
    ]
    assert all(str(source["endpoint"]).strip() for source in sources.values())
    assert sources["opening_bid_0"]["request"] == {
        "notifyNo": "IB2600000002",
        "notifyId": "actual-notify-id",
        "type": "TBMT",
        "packType": 0,
    }
    assert not {
        "authorization", "token", "cookie", "captcha",
    } & set(sources["opening_bid_0"]["request"])


def test_opening_cached_projection_matches_fresh_bidder_level_fields():
    class Runtime:
        def list_notice_revisions(self, _notice_no):
            return {"revisions": [{
                "revisionId": "notice-01",
                "revisionNumber": "01",
            }]}

        def get_opening_bundle(self, notice_no, _revision_id):
            return {
                "raw": {
                    "noticeDetail": {
                        "notifyNo": notice_no,
                        "notifyId": "notice-01",
                        "notifyVersion": "01",
                        "processApply": "LDT",
                        "bidMode": "1_MTHS",
                        "isMultiLot": 1,
                    },
                    "opening_round_0": {
                        "bidoBidroundMngViewDTO": {
                            "isMultiLot": 1,
                            "bidStatus": "OPEN_BID",
                        },
                    },
                    "opening_bid_0": {
                        "bidSubmissionByContractorViewResponse": {
                            "bidSubmissionDTOList": [{
                                "contractorCode": "vn0100000001",
                                "bidValidityNum": 90,
                                "bidGuarantee": 100_000_000,
                                "bidGuaranteeValidity": 120,
                            }],
                        },
                    },
                    "opening_lot_0": [{
                        "contractorCode": "vn0100000001",
                        "lotNo": "L01",
                    }],
                    "opening_lot_detail_0": [{
                        "contractorCode": "vn0100000001",
                        "lotNo": "L01",
                        "lotFinalPrice": 500_000_000,
                    }],
                },
                "fingerprint": "opening:v1:cache-equivalence",
                "retrievedAt": "2026-08-16T00:00:00Z",
                "processApply": "LDT",
                "bidMode": "1_MTHS",
                "noticeDetailOperation": "NOTICE_LDT_DETAIL",
                "requiredOpeningSources": [
                    {"operation": "OPENING_ROUND", "packType": 0},
                    {"operation": "OPENING_BID", "packType": 0},
                    {"operation": "OPENING_LOT", "packType": 0},
                    {"operation": "OPENING_LOT_DETAIL", "packType": 0},
                ],
                "failures": [],
                "metadata": {
                    "profile": "2026.08",
                    "operation": "OPENING_BUNDLE",
                },
            }

    source = MuaSamCongProcurementSource(Runtime())
    fresh = source.get_opening_bundle("IB2600000002", "notice-01")
    raw_bundle = fresh["rawBundle"]

    class RawRepository:
        def load_fresh_notice_bundle(self, *_args, **_kwargs):
            return deepcopy(raw_bundle)

    cached = _load_opening_from_raw_snapshot(
        source,
        RawRepository(),
        "org-1",
        "IB2600000002",
        {"revisionId": "notice-01", "revisionNumber": "01"},
    )

    assert cached is not None
    fields = (
        "contractorCode",
        "lotNo",
        "bidGuarantee",
        "bidValidityDays",
        "bidGuaranteeValidityDays",
    )
    assert [
        tuple(row.get(field) for field in fields)
        for row in cached["bidders"]
    ] == [
        tuple(row.get(field) for field in fields)
        for row in fresh["bidders"]
    ]


def test_procurement_import_routes_are_registered():
    routes = procurement_import_routes(Route)
    assert [(route.path, route.methods) for route in routes] == [
        ("/api/procurement/imports/plan/prepare", {"POST"}),
            ("/api/procurement/imports/plan/sessions/{session_id}/revisions/{revision_number}", {"GET", "HEAD"}),
            ("/api/procurement/imports/plan/sessions/{session_id}/decisions", {"POST"}),
            ("/api/procurement/imports/plan/sessions/{session_id}", {"GET", "HEAD"}),
        ("/api/procurement/imports/plan/sessions/{session_id}/cancel", {"POST"}),
        ("/api/procurement/imports/plan/apply", {"POST"}),
        ("/api/procurement/imports/notice/prepare", {"POST"}),
        ("/api/procurement/imports/notice/sessions/{session_id}/revisions/{revision_number}", {"GET", "HEAD"}),
        ("/api/procurement/imports/notice/sessions/{session_id}", {"GET", "HEAD"}),
        ("/api/procurement/imports/notice/sessions/{session_id}/cancel", {"POST"}),
        ("/api/procurement/imports/notice/apply", {"POST"}),
        ("/api/procurement/imports/opening/prepare", {"POST"}),
        ("/api/procurement/imports/opening/apply", {"POST"}),
        ("/api/procurement/imports/operations/{operation_id}", {"GET", "HEAD"}),
        ("/api/procurement/imports/operations/{operation_id}/resume", {"POST"}),
    ]


def test_provider_defaults_to_enabled_muasamcong(monkeypatch):
    monkeypatch.delenv("PROCUREMENT_IMPORT_ENABLED", raising=False)
    monkeypatch.delenv("PROCUREMENT_LOOKUP_ENABLED", raising=False)
    monkeypatch.delenv("PROCUREMENT_PROVIDER", raising=False)
    monkeypatch.delenv("VNEPS_PROCUREMENT_IMPORT_ENABLED", raising=False)
    monkeypatch.delenv("VNEPS_PROCUREMENT_PROVIDER", raising=False)
    expected = SimpleNamespace(name="MUASAMCONG")
    monkeypatch.setattr(routes_module, "get_muasamcong_source", lambda: expected)

    assert build_procurement_source() is expected


def test_fixture_provider_is_rejected_by_local_development_runtime(
    tmp_path, monkeypatch
):
    fixture = tmp_path / "fixture.json"
    fixture.write_text(
        '{"schemaVersion":"vneps-procurement-fixture-v1","plans":[]}',
        encoding="utf-8",
    )
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("PROCUREMENT_IMPORT_ENABLED", raising=False)
    monkeypatch.delenv("PROCUREMENT_PROVIDER", raising=False)
    monkeypatch.delenv("PROCUREMENT_LOOKUP_ENABLED", raising=False)
    monkeypatch.setenv("VNEPS_PROCUREMENT_IMPORT_ENABLED", "true")
    monkeypatch.setenv("VNEPS_PROCUREMENT_PROVIDER", "fixture")
    monkeypatch.setenv("VNEPS_PROCUREMENT_FIXTURE_PATH", str(fixture))

    with pytest.raises(ProcurementRouteError) as captured:
        build_procurement_source()
    assert captured.value.code == "PROCUREMENT_LOOKUP_DISABLED"
    assert captured.value.status_code == 503


def test_import_reuses_active_muasamcong_lookup_when_new_provider_is_unset(
    monkeypatch,
):
    expected = SimpleNamespace(name="MUASAMCONG")
    monkeypatch.delenv("PROCUREMENT_PROVIDER", raising=False)
    monkeypatch.delenv("PROCUREMENT_IMPORT_ENABLED", raising=False)
    monkeypatch.setenv("VNEPS_PROCUREMENT_IMPORT_ENABLED", "true")
    monkeypatch.setenv("VNEPS_PROCUREMENT_PROVIDER", "vneps")
    monkeypatch.setenv("PROCUREMENT_LOOKUP_ENABLED", "true")
    monkeypatch.setattr(routes_module, "get_muasamcong_source", lambda: expected)

    assert build_procurement_source() is expected


def test_lookup_flag_alone_enables_muasamcong_import_source(monkeypatch):
    expected = SimpleNamespace(name="MUASAMCONG")
    monkeypatch.delenv("PROCUREMENT_PROVIDER", raising=False)
    monkeypatch.delenv("PROCUREMENT_IMPORT_ENABLED", raising=False)
    monkeypatch.delenv("VNEPS_PROCUREMENT_IMPORT_ENABLED", raising=False)
    monkeypatch.setenv("VNEPS_PROCUREMENT_PROVIDER", "disabled")
    monkeypatch.setenv("PROCUREMENT_LOOKUP_ENABLED", "true")
    monkeypatch.setattr(routes_module, "get_muasamcong_source", lambda: expected)

    assert build_procurement_source() is expected


def test_import_preparer_uses_configured_raw_snapshot_ttl(monkeypatch):
    monkeypatch.setenv("PROCUREMENT_RAW_CACHE_TTL_SECONDS", "450")
    source = SimpleNamespace(name="MUASAMCONG")

    preparer = routes_module._build_import_preparer(source)

    assert preparer.raw_cache_ttl_seconds == 450
    assert preparer.raw_snapshot_repository is not None


def test_apply_rejects_browser_supplied_canonical_payload(monkeypatch):
    called = False

    async def should_not_run(*_args, **_kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(routes_module, "run_blocking_io", should_not_run)
    app = Starlette(routes=procurement_import_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/imports/plan/apply",
            json={
                "previewId": "preview-1",
                "idempotencyKey": "import-1",
                "expectedPlanRowVersion": 1,
                "decisions": {"investorId": "investor-1"},
                "canonicalPlan": {"name": "untrusted"},
            },
        )
    assert response.status_code == 400
    assert response.json()["code"] == "PROCUREMENT_CODE_INVALID"
    assert called is False


class _AuthorizationCursor:
    def __init__(self, operation_actor=None, *, session_revoked=False):
        self.operation_actor = operation_actor
        self.session_revoked = session_revoked
        self.statement = ""
        self.parameters = ()
        self.statements = []

    def execute(self, statement, parameters=()):
        self.statement = " ".join(str(statement).split())
        self.parameters = parameters
        self.statements.append(self.statement)
        return self

    def fetchone(self):
        if "FROM auth_sessions AS sessions" in self.statement:
            return {
                "id": self.parameters[1],
                "vai_tro": "user",
                "account_status": "active",
                "session_id": self.parameters[0],
                "idle_expires_at": 4_000_000_000,
                "absolute_expires_at": 4_000_000_000,
                "revoked_at": 1 if self.session_revoked else None,
                "active_role": "employee",
                "active_role_organization_id": "org-1",
            }
        if "FROM thanh_vien_to_chuc AS membership" in self.statement:
            return {
                "vai_tro_trong_to_chuc": "employee",
                "trang_thai_thanh_vien": "active",
                "organization_status": "active",
            }
        if "FROM ma_tran_phan_quyen" in self.statement:
            return None
        if "FROM procurement_import_operation" in self.statement:
            return ((self.operation_actor,) if self.operation_actor else None)
        return None

    def fetchall(self):
        return []


class _AuthorizationConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor
        self.events = []

    def execute(self, statement):
        self.events.append(str(statement))
        return self

    def cursor(self):
        return self.cursor_value

    def commit(self):
        self.events.append("commit")

    def rollback(self):
        self.events.append("rollback")

    def close(self):
        self.events.append("close")


class _CurrentAuthorityCursor(_AuthorizationCursor):
    def execute(self, statement, parameters=()):
        self.statement = " ".join(str(statement).split())
        self.parameters = parameters
        self.statements.append(self.statement)
        return self

    def fetchone(self):
        if "FROM auth_sessions AS sessions" in self.statement:
            return {
                "id": "employee-1",
                "vai_tro": "user",
                "account_status": "active",
                "session_id": "session-1",
                "idle_expires_at": 4_000_000_000,
                "absolute_expires_at": 4_000_000_000,
                "revoked_at": None,
                "active_role": "manager",
                "active_role_organization_id": "org-1",
            }
        if "FROM thanh_vien_to_chuc AS membership" in self.statement:
            return {
                "vai_tro_trong_to_chuc": "manager",
                "trang_thai_thanh_vien": "active",
                "organization_status": "active",
            }
        if "FROM ma_tran_phan_quyen" in self.statement:
            return None
        return super().fetchone()


@pytest.mark.parametrize(
    ("payload_key", "table_name", "item"),
    [
        (
            "kehoach",
            "ke_hoach_lcnt",
            {"id": "plan-current", "rootId": "plan-root"},
        ),
        (
            "goithau",
            "goi_thau",
            {"id": "package-current", "rootId": "package-root"},
        ),
    ],
)
def test_procurement_record_authorization_locks_assignment_lineage_before_decision(
    monkeypatch,
    payload_key,
    table_name,
    item,
):
    statements = []

    class Cursor:
        def execute(self, statement, _parameters=()):
            statements.append(" ".join(str(statement).split()))
            return self

        def fetchall(self):
            return []

    monkeypatch.setattr(
        routes_module,
        "authorize_record_write",
        lambda *_args: AccessDecision(True),
    )

    routes_module._require_record_write(
        Cursor(),
        SimpleNamespace(user_id="employee-1", active_role="employee"),
        "org-1",
        payload_key,
        table_name,
        item,
    )

    assert any(
        "FOR UPDATE OF assignment" in statement
        for statement in statements
    )


def test_real_postgres_assignment_revocation_during_apply_aborts_before_reconcile(
    monkeypatch,
):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL TOCTOU test")
    test_database = PostgresDatabase(database_url)
    suffix = uuid.uuid4().hex
    organization_id = f"org-procurement-toctou-{suffix}"
    user_id = f"employee-procurement-toctou-{suffix}"
    investor_id = f"investor-procurement-toctou-{suffix}"
    plan_id = f"plan-procurement-toctou-{suffix}"
    assignment_id = f"assignment-procurement-toctou-{suffix}"
    session_id = f"session-procurement-toctou-{suffix}"
    family_no = f"PL{suffix[:10].upper()}"
    now = int(time.time())
    setup = test_database.get_connection()
    try:
        cursor = setup.cursor()
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, "Tổ chức kiểm thử procurement TOCTOU"),
        )
        cursor.execute(
            """INSERT INTO tai_khoan
                   (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                    vai_tro, email, email_norm, da_xac_minh, username_da_dat)
               VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 1, 1)""",
            (
                user_id,
                user_id,
                user_id,
                "test-password-hash",
                "Chuyên viên kiểm thử TOCTOU",
                f"{user_id}@example.test",
                f"{user_id}@example.test",
            ),
        )
        cursor.execute(
            """INSERT INTO auth_sessions
                   (id, user_id, token_hash, created_at, last_seen_at,
                    idle_expires_at, absolute_expires_at, remember_me,
                    active_role, active_role_organization_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'employee', ?)""",
            (
                session_id,
                user_id,
                f"token-hash-{suffix}",
                now,
                now,
                now + 3_600,
                now + 7_200,
                organization_id,
            ),
        )
        cursor.execute(
            """INSERT INTO thanh_vien_to_chuc
                   (user_id, organization_id, vai_tro_trong_to_chuc,
                    ten_nhan_su)
               VALUES (?, ?, 'employee', ?)""",
            (user_id, organization_id, "Chuyên viên kiểm thử TOCTOU"),
        )
        cursor.execute(
            """INSERT INTO ma_tran_phan_quyen
                   (id, organization_id, emp_id, kehoach)
               VALUES (?, ?, ?, 'edit')""",
            (f"permission-{suffix}", organization_id, user_id),
        )
        cursor.execute(
            """INSERT INTO chu_dau_tu
                   (id, organization_id, id_goc, ten_chu_dau_tu)
               VALUES (?, ?, ?, ?)""",
            (
                investor_id,
                organization_id,
                investor_id,
                "Chủ đầu tư kiểm thử TOCTOU",
            ),
        )
        cursor.execute(
            """INSERT INTO ke_hoach_lcnt
                   (id, organization_id, id_goc, ma_ke_hoach, ten_ke_hoach,
                    ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
                    ngay_phe_duyet, quyet_dinh_phe_duyet)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE, ?)""",
            (
                plan_id,
                organization_id,
                plan_id,
                family_no,
                "Kế hoạch kiểm thử TOCTOU",
                "Dự án kiểm thử TOCTOU",
                "Mua sắm thường xuyên",
                investor_id,
                "QĐ-TOCTOU",
            ),
        )
        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
                   (id, organization_id, id_nhan_vien, id_muc_tieu,
                    loai_doi_tuong)
               VALUES (?, ?, ?, ?, 'kehoach')""",
            (assignment_id, organization_id, user_id, plan_id),
        )
        setup.commit()
    finally:
        setup.close()

    lock_reached = Event()
    revocation_committed = Event()
    reconciled = Event()
    outcome = []
    original_lock = routes_module._lock_record_assignment_scope

    def pause_before_assignment_lock(*args, **kwargs):
        lock_reached.set()
        assert revocation_committed.wait(10)
        return original_lock(*args, **kwargs)

    class Reconciler:
        def __init__(self, _repository):
            pass

        def reconcile_revision(self, **_kwargs):
            reconciled.set()
            return {
                "operation": "APPLIED",
                "createdPlans": [],
                "createdPackages": [],
            }

    monkeypatch.setattr(routes_module, "database", test_database)
    monkeypatch.setattr(
        routes_module,
        "_lock_record_assignment_scope",
        pause_before_assignment_lock,
    )
    monkeypatch.setattr(routes_module, "ProcurementPlanReconciler", Reconciler)

    def apply_after_prepare():
        try:
            outcome.append(
                routes_module._apply_one(
                    organization_id,
                    SimpleNamespace(
                        user_id=user_id,
                        session_id=session_id,
                        active_role="employee",
                    ),
                    "MUASAMCONG",
                    {
                        "familyNo": family_no,
                        "revisionId": "revision-1",
                    },
                    "apply-toctou-1",
                    1,
                    investor_id,
                )
            )
        except Exception as error:  # noqa: BLE001 - asserted below.
            outcome.append(error)

    worker = Thread(target=apply_after_prepare, daemon=True)
    try:
        worker.start()
        assert lock_reached.wait(10)
        revocation = test_database.get_connection()
        try:
            revocation.execute(
                "DELETE FROM phan_cong_nhan_su WHERE organization_id = ? AND id = ?",
                (organization_id, assignment_id),
            )
            revocation.commit()
        finally:
            revocation.close()
        revocation_committed.set()
        worker.join(timeout=10)

        assert not worker.is_alive()
        assert len(outcome) == 1
        assert getattr(outcome[0], "sqlstate", None) == "40001"
        assert not reconciled.is_set()
    finally:
        revocation_committed.set()
        worker.join(timeout=10)
        cleanup = test_database.get_connection()
        try:
            cleanup.execute(
                "DELETE FROM phan_cong_nhan_su WHERE organization_id = ?",
                (organization_id,),
            )
            cleanup.execute(
                "DELETE FROM ke_hoach_lcnt WHERE organization_id = ?",
                (organization_id,),
            )
            cleanup.execute(
                "DELETE FROM chu_dau_tu WHERE organization_id = ?",
                (organization_id,),
            )
            cleanup.execute(
                "DELETE FROM ma_tran_phan_quyen WHERE organization_id = ?",
                (organization_id,),
            )
            cleanup.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE organization_id = ?",
                (organization_id,),
            )
            cleanup.execute("DELETE FROM auth_sessions WHERE id = ?", (session_id,))
            cleanup.execute("DELETE FROM to_chuc WHERE id = ?", (organization_id,))
            cleanup.execute("DELETE FROM tai_khoan WHERE id = ?", (user_id,))
            cleanup.commit()
        finally:
            cleanup.close()
            test_database.close()


def test_plan_apply_uses_persona_reloaded_inside_write_transaction(monkeypatch):
    cursor = _CurrentAuthorityCursor()
    connection = _AuthorizationConnection(cursor)
    stale_session = SimpleNamespace(
        user_id="employee-1",
        session_id="session-1",
        platform_role="user",
        active_role="employee",
        active_role_organization_id="org-1",
    )
    observed_roles = []

    class Repository:
        def __init__(self, _cursor):
            pass

        def lock_family(self, *_args):
            return None

        def load_family(self, *_args):
            return {"latestPlan": None, "packages": []}

    class Reconciler:
        def __init__(self, _repository):
            pass

        def reconcile_revision(self, **_kwargs):
            return {
                "operation": "APPLIED",
                "createdPlans": [],
                "createdPackages": [],
            }

    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "ProcurementPlanReconciler", Reconciler)
    monkeypatch.setattr(routes_module, "_validate_investor", lambda *_args: None)

    def current_permission(_cursor, role, *_args):
        observed_roles.append(role)
        return getattr(role, "active_role", None) == "manager"

    monkeypatch.setattr(routes_module, "has_module_permission", current_permission)

    result = routes_module._apply_one(
        "org-1",
        stale_session,
        "MUASAMCONG",
        {"familyNo": "PL2600000001", "revisionId": "revision-1"},
        "apply-1",
        None,
        "investor-1",
    )

    assert result["operation"] == "APPLIED"
    assert len(observed_roles) == 1
    assert observed_roles[0] is not stale_session
    assert observed_roles[0].active_role == "manager"
    assert "FROM auth_sessions AS sessions" in cursor.statements[0]
    assert "FOR UPDATE OF sessions, accounts" in cursor.statements[0]
    assert "FROM thanh_vien_to_chuc AS membership" in cursor.statements[1]
    assert "FOR UPDATE OF membership, organization" in cursor.statements[1]
    assert "FROM ma_tran_phan_quyen" in cursor.statements[2]
    assert "FOR UPDATE" in cursor.statements[2]
    assert connection.events[:2] == ["BEGIN ISOLATION LEVEL SERIALIZABLE", "commit"]


def test_plan_apply_rejects_session_revoked_inside_write_transaction(monkeypatch):
    cursor = _AuthorizationCursor(session_revoked=True)
    connection = _AuthorizationConnection(cursor)
    session = SimpleNamespace(
        user_id="employee-1",
        session_id="session-1",
        active_role="employee",
    )

    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        routes_module,
        "ProcurementPlanReconciler",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("revoked session must not reconcile")
        ),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._apply_one(
            "org-1",
            session,
            "MUASAMCONG",
            {"familyNo": "PL2600000001", "revisionId": "revision-1"},
            "apply-1",
            None,
            "investor-1",
        )

    assert caught.value.code == "AUTHENTICATION_REQUIRED"
    assert cursor.statements == [cursor.statement]
    assert "FOR UPDATE OF sessions, accounts" in cursor.statement
    assert "rollback" in connection.events
    assert "commit" not in connection.events


def test_plan_apply_rechecks_current_edit_permission_inside_write_transaction(
    monkeypatch,
):
    cursor = _AuthorizationCursor()
    connection = _AuthorizationConnection(cursor)
    observed = []
    session = SimpleNamespace(
        user_id="employee-1", session_id="session-1", active_role="employee"
    )

    monkeypatch.setattr(
        routes_module.database,
        "get_connection",
        lambda: connection,
    )

    def permission(*args):
        observed.append((connection.events.copy(), args[1], args[-1]))
        return False

    monkeypatch.setattr(routes_module, "has_module_permission", permission)
    monkeypatch.setattr(
        routes_module,
        "ProcurementPlanReconciler",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("denied apply must not reconcile")
        ),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._apply_one(
            "org-1",
            session,
            "MUASAMCONG",
            {"familyNo": "PL2600000001", "revisionId": "revision-1"},
            "apply-1",
            None,
            "investor-1",
        )

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert observed[0][0][0] == "BEGIN ISOLATION LEVEL SERIALIZABLE"
    assert observed[0][1].user_id == session.user_id
    assert observed[0][1].active_role == "employee"
    assert observed[0][2] == "edit"
    assert "rollback" in connection.events
    assert "commit" not in connection.events


def test_plan_apply_rechecks_every_existing_record_scope_before_reconcile(
    monkeypatch,
):
    cursor = _AuthorizationCursor()
    connection = _AuthorizationConnection(cursor)
    session = SimpleNamespace(
        user_id="employee-1", session_id="session-1", active_role="employee"
    )
    checked = []

    class Repository:
        def __init__(self, _cursor):
            pass

        def lock_family(self, *_args):
            return None

        def load_family(self, *_args):
            return {
                "latestPlan": {"id": "plan-1", "rootId": "plan-root"},
                "packages": [
                    {"id": "package-allowed", "rootId": "package-allowed"},
                    {"id": "package-denied", "rootId": "package-denied"},
                ],
            }

    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "has_module_permission", lambda *_args: True)

    def authorize(_cursor, role, user_id, organization_id, key, table, item):
        checked.append((role, user_id, organization_id, key, table, item["id"]))
        return AccessDecision(item["id"] != "package-denied", "outside assignment")

    monkeypatch.setattr(routes_module, "authorize_record_write", authorize)
    monkeypatch.setattr(
        routes_module,
        "ProcurementPlanReconciler",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("mixed-scope apply must not reconcile any record")
        ),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._apply_one(
            "org-1",
            session,
            "MUASAMCONG",
            {"familyNo": "PL2600000001", "revisionId": "revision-1"},
            "apply-1",
            1,
            "investor-1",
        )

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert [row[-1] for row in checked] == [
        "plan-1",
        "package-allowed",
        "package-denied",
    ]
    assert all(row[0].user_id == session.user_id for row in checked)
    assert all(row[0].active_role == "employee" for row in checked)
    assert "rollback" in connection.events
    assert "commit" not in connection.events


def test_notice_resume_locks_operation_and_rejects_stale_actor_in_write_transaction(
    monkeypatch,
):
    cursor = _AuthorizationCursor(operation_actor="original-user")
    connection = _AuthorizationConnection(cursor)
    session = SimpleNamespace(
        user_id="replacement-user",
        session_id="session-1",
        active_role="employee",
    )

    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "has_module_permission", lambda *_args: True)
    monkeypatch.setattr(
        routes_module,
        "ProcurementNoticeReconciler",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("foreign operation must not reconcile")
        ),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._apply_notice_one(
            "org-1",
            session,
            "MUASAMCONG",
            {"noticeNo": "IB2600000002", "revisionId": "notice-1"},
            "resume-1",
            3,
            "package-root",
            "operation-1",
        )

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert "FOR UPDATE" in cursor.statement
    assert "rollback" in connection.events
    assert "commit" not in connection.events


def test_notice_apply_rechecks_current_target_assignment_before_reconcile(
    monkeypatch,
):
    cursor = _AuthorizationCursor()
    connection = _AuthorizationConnection(cursor)
    session = SimpleNamespace(
        user_id="employee-1",
        session_id="session-1",
        active_role="employee",
    )

    class Repository:
        def __init__(self, _cursor):
            pass

        def lock_family(self, *_args):
            return None

        def resolve_notice_target(self, *_args, **_kwargs):
            return {"id": "package-current", "rootId": "package-root"}

    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "has_module_permission", lambda *_args: True)
    monkeypatch.setattr(
        routes_module,
        "authorize_record_write",
        lambda *_args: AccessDecision(False, "assignment changed"),
    )
    monkeypatch.setattr(
        routes_module,
        "ProcurementNoticeReconciler",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("out-of-scope notice must not reconcile")
        ),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._apply_notice_one(
            "org-1",
            session,
            "MUASAMCONG",
            {"noticeNo": "IB2600000002", "revisionId": "notice-1"},
            "apply-1",
            3,
            "package-root",
        )

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert "rollback" in connection.events
    assert "commit" not in connection.events


def test_notice_apply_rechecks_current_edit_permission_inside_write_transaction(
    monkeypatch,
):
    cursor = _AuthorizationCursor()
    connection = _AuthorizationConnection(cursor)
    session = SimpleNamespace(
        user_id="employee-1",
        session_id="session-1",
        active_role="employee",
    )
    permission_checks = []

    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)

    def deny_permission(_cursor, role, *_args):
        permission_checks.append((role, connection.events.copy()))
        return False

    monkeypatch.setattr(routes_module, "has_module_permission", deny_permission)
    monkeypatch.setattr(
        routes_module,
        "ProcurementNoticeReconciler",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("revoked notice edit permission must not reconcile")
        ),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._apply_notice_one(
            "org-1",
            session,
            "MUASAMCONG",
            {"noticeNo": "IB2600000002", "revisionId": "notice-1"},
            "apply-1",
            3,
            "package-root",
        )

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert permission_checks[0][0].active_role == "employee"
    assert permission_checks[0][1][0] == "BEGIN ISOLATION LEVEL SERIALIZABLE"
    assert "rollback" in connection.events
    assert "commit" not in connection.events


def test_notice_apply_uses_persona_reloaded_inside_write_transaction(monkeypatch):
    cursor = _CurrentAuthorityCursor()
    connection = _AuthorizationConnection(cursor)
    stale_session = SimpleNamespace(
        user_id="employee-1",
        session_id="session-1",
        platform_role="user",
        active_role="employee",
        active_role_organization_id="org-1",
    )
    observed_roles = []

    class Repository:
        def __init__(self, _cursor):
            pass

        def lock_family(self, *_args):
            return None

        def resolve_notice_target(self, *_args, **_kwargs):
            return None

    class Reconciler:
        def __init__(self, _repository):
            pass

        def reconcile_revision(self, **_kwargs):
            return {
                "operation": "APPLIED",
                "createdPlans": [],
                "createdPackages": [],
            }

    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "ProcurementNoticeReconciler", Reconciler)

    def current_permission(_cursor, role, *_args):
        observed_roles.append(role)
        return getattr(role, "active_role", None) == "manager"

    monkeypatch.setattr(routes_module, "has_module_permission", current_permission)

    result = routes_module._apply_notice_one(
        "org-1",
        stale_session,
        "MUASAMCONG",
        {"noticeNo": "IB2600000002", "revisionId": "notice-1"},
        "apply-1",
        3,
        "package-root",
    )

    assert result["operation"] == "APPLIED"
    assert len(observed_roles) == 1
    assert observed_roles[0] is not stale_session
    assert observed_roles[0].active_role == "manager"
    assert "FROM auth_sessions AS sessions" in cursor.statements[0]
    assert "FOR UPDATE OF sessions, accounts" in cursor.statements[0]
    assert connection.events[:2] == ["BEGIN ISOLATION LEVEL SERIALIZABLE", "commit"]


def test_notice_apply_rejects_operation_from_another_tenant_before_reconcile(
    monkeypatch,
):
    cursor = _AuthorizationCursor(operation_actor=None)
    connection = _AuthorizationConnection(cursor)
    session = SimpleNamespace(
        user_id="employee-1",
        session_id="session-1",
        active_role="employee",
    )

    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "has_module_permission", lambda *_args: True)
    monkeypatch.setattr(
        routes_module,
        "ProcurementNoticeReconciler",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("foreign-tenant notice operation must not reconcile")
        ),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._apply_notice_one(
            "org-1",
            session,
            "MUASAMCONG",
            {"noticeNo": "IB2600000002", "revisionId": "notice-1"},
            "apply-1",
            3,
            "package-root",
            operation_id="operation-in-another-tenant",
        )

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert any(
        "FROM procurement_import_operation" in statement
        and "FOR UPDATE" in statement
        for statement in cursor.statements
    )
    assert "rollback" in connection.events
    assert "commit" not in connection.events


def test_completed_plan_operation_direct_replay_rechecks_current_record_scope(
    monkeypatch,
):
    cursor = _AuthorizationCursor(operation_actor="owner-user")
    connection = _AuthorizationConnection(cursor)
    session = SimpleNamespace(
        user_id="owner-user",
        session_id="session-1",
        active_role="employee",
    )
    revision = {
        "familyNo": "PL2600000001",
        "revisionId": "revision-1",
        "revisionDigest": "sha256:" + "a" * 64,
    }
    completed_operation = {
        "operationId": "operation-1",
        "provider": "MUASAMCONG",
        "familyNo": revision["familyNo"],
        "status": "COMPLETED",
        "nextRevisionIndex": 1,
        "actorUserId": session.user_id,
        "revisionResults": [
            {
                "status": "COMPLETED",
                "canonicalRevision": deepcopy(revision),
                "investorId": "investor-1",
            }
        ],
    }

    class Repository:
        def __init__(self, _cursor):
            pass

        def create_operation(self, _operation):
            return deepcopy(completed_operation)

        def lock_family(self, *_args):
            return None

        def load_family(self, *_args):
            return {
                "latestPlan": {"id": "plan-current", "rootId": "plan-root"},
                "packages": [],
            }

    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "has_module_permission", lambda *_args: True)
    monkeypatch.setattr(
        routes_module,
        "authorize_record_write",
        lambda *_args: AccessDecision(False, "assignment revoked"),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._create_operation(
            "org-1",
            session,
            {
                "provider": "MUASAMCONG",
                "plan": {"familyNo": revision["familyNo"]},
            },
            SimpleNamespace(preview_id="preview-1", bundle_digest="digest-1"),
            "idempotency-1",
            {"investorId": "investor-1"},
            1,
            [revision],
            [{}],
        )

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert "rollback" in connection.events
    assert "commit" not in connection.events


def test_completed_notice_operation_direct_replay_rechecks_current_record_scope(
    monkeypatch,
):
    cursor = _AuthorizationCursor(operation_actor="owner-user")
    connection = _AuthorizationConnection(cursor)
    session = SimpleNamespace(
        user_id="owner-user",
        session_id="session-1",
        active_role="employee",
    )
    revision = {
        "noticeNo": "IB2600000002",
        "revisionId": "notice-1",
        "revisionDigest": "sha256:" + "b" * 64,
        "relationship": {},
    }
    completed_operation = {
        "operationId": "operation-1",
        "provider": "MUASAMCONG",
        "familyNo": revision["noticeNo"],
        "status": "COMPLETED",
        "nextRevisionIndex": 1,
        "actorUserId": session.user_id,
        "revisionResults": [
            {
                "importKind": "NOTICE",
                "status": "COMPLETED",
                "canonicalRevision": deepcopy(revision),
                "targetPackageRootId": "package-root",
            }
        ],
    }

    class Repository:
        def __init__(self, _cursor):
            pass

        def create_operation(self, _operation):
            return deepcopy(completed_operation)

        def lock_family(self, *_args):
            return None

        def resolve_notice_target(self, *_args, **_kwargs):
            return {"id": "package-current", "rootId": "package-root"}

    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "has_module_permission", lambda *_args: True)
    monkeypatch.setattr(
        routes_module,
        "authorize_record_write",
        lambda *_args: AccessDecision(False, "assignment revoked"),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._create_notice_operation(
            "org-1",
            session,
            {
                "provider": "MUASAMCONG",
                "notice": {"noticeNo": revision["noticeNo"]},
                "targetPackageRootId": "package-root",
                "revisions": [revision],
            },
            SimpleNamespace(preview_id="preview-1", bundle_digest="digest-1"),
            "idempotency-1",
            3,
        )

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert "rollback" in connection.events
    assert "commit" not in connection.events


def test_plan_apply_rejects_operation_from_another_tenant_before_reconcile(
    monkeypatch,
):
    cursor = _AuthorizationCursor(operation_actor=None)
    connection = _AuthorizationConnection(cursor)
    session = SimpleNamespace(
        user_id="employee-1",
        session_id="session-1",
        active_role="employee",
    )

    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "has_module_permission", lambda *_args: True)
    monkeypatch.setattr(
        routes_module,
        "ProcurementPlanReconciler",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("foreign-tenant operation must not reconcile")
        ),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._apply_one(
            "org-1",
            session,
            "MUASAMCONG",
            {"familyNo": "PL2600000001", "revisionId": "revision-1"},
            "apply-1",
            None,
            "investor-1",
            operation_id="operation-in-another-tenant",
        )

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert any(
        "FROM procurement_import_operation" in statement
        and "FOR UPDATE" in statement
        for statement in cursor.statements
    )
    assert "rollback" in connection.events
    assert "commit" not in connection.events


def test_prepare_returns_only_server_result(monkeypatch):
    async def fake_run(_function, _request, payload, **_kwargs):
        assert payload["code"] == "PL2600000001"
        return {
            "schemaVersion": "biddingflow-procurement-import-preview-v2",
            "previewId": "opaque-preview",
            "bundleDigest": "sha256:" + "a" * 64,
            "plan": {"familyNo": "PL2600000001"},
            "revisionPreviews": [],
            "packages": [],
            "blockingIssues": [],
            "warnings": [],
        }

    monkeypatch.setattr(routes_module, "run_blocking_io", fake_run)
    app = Starlette(routes=procurement_import_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/imports/plan/prepare",
            json={"code": "PL2600000001", "revisionMode": "LATEST"},
        )
    assert response.status_code == 200
    assert response.json()["previewId"] == "opaque-preview"
    assert "revisions" not in response.json()


def test_employee_with_plan_view_access_may_prepare_muasamcong_plan(monkeypatch):
    permission_actions = []

    class Connection:
        def cursor(self):
            return object()

        def execute(self, _sql):
            return self

        def commit(self):
            return None

        def rollback(self):
            return None

        def close(self):
            return None

    class Repository:
        def __init__(self, _cursor):
            pass

        def load_family(self, _organization_id, _provider, _family_no):
            return {"latestPlan": None}

    class Preparer:
        def prepare_plan(self, **_options):
            return {"previewId": "preview-employee"}

    class PreviewStore:
        def get(self, *_args, **_kwargs):
            return SimpleNamespace(canonical_bundle={"kind": "PLAN"})

    class SessionService:
        def __init__(self, _repository, **_options):
            pass

        def create_from_bundle(self, _bundle, **_context):
            return {"sessionId": "session-employee"}

    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(user_id="employee-1", active_role="employee"),
            "org-1",
            "workspace-1",
        ),
    )
    monkeypatch.setattr(routes_module, "_enforce_rate_limit", lambda *_args: None)
    monkeypatch.setattr(
        routes_module,
        "build_procurement_source",
        lambda: SimpleNamespace(name="MUASAMCONG"),
    )
    monkeypatch.setattr(
        routes_module,
        "has_module_permission",
        lambda *_args: permission_actions.append(_args[-1]) or _args[-1] == "view",
    )
    monkeypatch.setattr(routes_module.database, "get_connection", Connection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "_build_import_preparer", lambda _source: Preparer())
    monkeypatch.setattr(routes_module, "PREVIEW_STORE", PreviewStore())
    monkeypatch.setattr(routes_module, "ProcurementImportSessionRepository", Repository)
    monkeypatch.setattr(routes_module, "ProcurementImportSessionService", SessionService)

    result = routes_module._prepare_blocking(
        object(),
        {
            "code": "PL2600000001",
            "revisionMode": "LATEST",
            "workspaceLease": "workspace-1",
        },
    )

    assert result["previewId"] == "preview-employee"
    assert result["importSession"]["sessionId"] == "session-employee"
    assert permission_actions == ["view"]


def test_muasamcong_plan_prepare_returns_quick_preview_for_linked_notices(monkeypatch):
    calls = []
    session_bundles = []
    retry_context = []

    class Connection:
        def cursor(self):
            return object()

        def execute(self, _sql):
            return self

        def commit(self):
            return None

        def rollback(self):
            return None

        def close(self):
            return None

    class Repository:
        def __init__(self, _cursor):
            pass

        def load_family(self, *_args):
            return {"latestPlan": None}

    class Preparer:
        def prepare_plan(self, **options):
            calls.append(options["include_linked_notices"])
            assert options["include_linked_notices"] is False
            return {"previewId": "preview-quick"}

    class PreviewStore:
        def get(self, *_args, **_kwargs):
            return SimpleNamespace(canonical_bundle={
                "revisions": [{"packages": [{
                    "noticeLink": {"state": "LINKED", "noticeNo": "IB2600000002"},
                }]}],
            })

    class SessionService:
        def __init__(self, _repository, **_options):
            pass

        def create_from_bundle(self, _bundle, **_context):
            session_bundles.append(_bundle)
            return {"sessionId": "session-quick"}

    class Source:
        name = "MUASAMCONG"

        def interactive_retry_context(self):
            class Context:
                def __enter__(self):
                    retry_context.append("enter")

                def __exit__(self, *_args):
                    retry_context.append("exit")

            return Context()

    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda _request, _lease: (SimpleNamespace(user_id="user-1"), "org-1", "workspace-1"),
    )
    monkeypatch.setattr(routes_module, "_enforce_rate_limit", lambda *_args: None)
    monkeypatch.setattr(
        routes_module, "build_procurement_source",
        Source,
    )
    monkeypatch.setattr(routes_module, "has_module_permission", lambda *_args: True)
    monkeypatch.setattr(routes_module.database, "get_connection", Connection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "_build_import_preparer", lambda _source: Preparer())
    monkeypatch.setattr(routes_module, "PREVIEW_STORE", PreviewStore())
    monkeypatch.setattr(routes_module, "ProcurementImportSessionRepository", Repository)
    monkeypatch.setattr(routes_module, "ProcurementImportSessionService", SessionService)

    result = routes_module._prepare_blocking(
        object(),
        {"code": "PL2600000001", "revisionMode": "ALL", "includeLinkedNotices": True},
    )

    assert calls == [False]
    assert retry_context == ["enter", "exit"]
    assert result["previewMode"] == "QUICK"
    assert result["enrichmentStatus"] == "PENDING"
    assert result["_enrichmentContext"]["linkedNoticeCount"] == 1
    assert session_bundles[0]["enrichmentStatus"] == "PENDING"


def test_start_plan_enrichment_hides_internal_context_and_returns_operation_id(monkeypatch):
    bundle = {"revisions": [{"packages": [{
        "noticeLink": {"state": "LINKED", "noticeNo": "IB2600000002"},
    }]}]}

    class PreviewStore:
        def get(self, *_args, **_kwargs):
            return SimpleNamespace(canonical_bundle=bundle)

    class Thread:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def start(self):
            return None

    monkeypatch.setattr(routes_module, "PREVIEW_STORE", PreviewStore())
    monkeypatch.setattr(
        routes_module,
        "_create_enrichment_operation",
        lambda *_args: {"operationId": "enrich-op-1"},
    )
    monkeypatch.setattr(routes_module.threading, "Thread", Thread)

    result = routes_module._start_plan_enrichment({
        "previewId": "preview-1",
        "_enrichmentContext": {
            "sessionId": "session-1", "organizationId": "org-1",
            "userId": "user-1", "workspaceLease": "workspace-1",
            "provider": "MUASAMCONG", "familyNo": "PL2600000001",
            "revisionMode": "ALL", "selectedRevision": None,
        },
    })

    assert result["enrichmentOperationId"] == "enrich-op-1"
    assert "_enrichmentContext" not in result


def test_plan_prepare_still_denies_member_without_plan_view_access(monkeypatch):
    permission_actions = []

    class Connection:
        def cursor(self):
            return object()

        def rollback(self):
            return None

        def close(self):
            return None

    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(user_id="employee-1", active_role="employee"),
            "org-1",
            "workspace-1",
        ),
    )
    monkeypatch.setattr(routes_module, "_enforce_rate_limit", lambda *_args: None)
    monkeypatch.setattr(
        routes_module,
        "build_procurement_source",
        lambda: SimpleNamespace(name="MUASAMCONG"),
    )
    monkeypatch.setattr(
        routes_module,
        "has_module_permission",
        lambda *_args: permission_actions.append(_args[-1]) or False,
    )
    monkeypatch.setattr(routes_module.database, "get_connection", Connection)

    try:
        routes_module._prepare_blocking(
            object(),
            {
                "code": "PL2600000001",
                "revisionMode": "LATEST",
                "workspaceLease": "workspace-1",
            },
        )
    except ProcurementRouteError as error:
        assert error.code == "ORGANIZATION_ACCESS_DENIED"
        assert error.status_code == 403
    else:
        raise AssertionError("member without plan view access must be denied")

    assert permission_actions == ["view"]


def test_prepare_notice_returns_only_server_preview_authority(monkeypatch):
    async def fake_run(_function, _request, payload, **_kwargs):
        assert payload["code"] == "IB2600000002"
        return {
            "schemaVersion": "biddingflow-procurement-import-preview-v2",
            "importKind": "NOTICE",
            "previewId": "opaque-notice-preview",
            "bundleDigest": "sha256:" + "b" * 64,
            "notice": {
                "noticeNo": "IB2600000002",
                "expectedPackageRowVersion": 3,
            },
            "blockingIssues": [],
            "warnings": [],
        }

    monkeypatch.setattr(routes_module, "run_blocking_io", fake_run)
    app = Starlette(routes=procurement_import_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/imports/notice/prepare",
            json={"code": "IB2600000002", "revisionMode": "LATEST"},
        )
    assert response.status_code == 200
    assert response.json()["previewId"] == "opaque-notice-preview"
    assert "revision" not in response.json()


class _OpeningCursor:
    def __init__(self, state):
        self.state = state
        self.query = ""

    def execute(self, query, _parameters=()):
        self.query = query
        return self

    def fetchone(self):
        if "FROM goi_thau" in self.query and "SELECT id" in self.query:
            return (
                "package-1", "package-root-1", self.state["row_version"],
                "IB2600000002", "Gói thầu kiểm thử",
            )
        if "FROM procurement_source_binding" in self.query:
            return ("IB2600000002",)
        if "SELECT row_version FROM goi_thau" in self.query:
            return (self.state["row_version"],)
        return None


class _OpeningConnection:
    def __init__(self, state):
        self.state = state

    def cursor(self):
        return _OpeningCursor(self.state)

    def rollback(self):
        return None

    def close(self):
        return None


class _OpeningSource:
    name = "MUASAMCONG"

    def list_notice_revisions(self, notice_no):
        assert notice_no == "IB2600000002"
        return [
            {"revisionId": "notice-00", "revisionNumber": "00"},
            {"revisionId": "notice-01", "revisionNumber": "01"},
        ]

    def get_opening_bundle(self, notice_no, revision_id):
        assert (notice_no, revision_id) == ("IB2600000002", "notice-01")
        return {
            "schemaVersion": "biddingflow-opening-bundle-v1",
            "bidders": [{"contractorName": "Nhà thầu A", "bidPrice": 100}],
            "lots": [],
            "partial": False,
        }


def _install_opening_http_harness(monkeypatch, *, allowed=True):
    state = {"row_version": 3, "authorized_modules": []}

    async def inline(function, *args, **kwargs):
        kwargs.pop("timeout_seconds", None)
        return function(*args, **kwargs)

    monkeypatch.setattr(routes_module, "run_blocking_io", inline)
    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(user_id="user-1"), "org-1", "workspace-1"
        ),
    )
    monkeypatch.setattr(routes_module, "_enforce_rate_limit", lambda *_args: None)
    def authorize_module(*args):
        state["authorized_modules"].append(args[4])
        return allowed

    monkeypatch.setattr(routes_module, "has_module_permission", authorize_module)
    monkeypatch.setattr(
        routes_module.database,
        "get_connection",
        lambda: _OpeningConnection(state),
    )
    monkeypatch.setattr(routes_module, "build_procurement_source", _OpeningSource)
    monkeypatch.setattr(routes_module, "PREVIEW_STORE", PreviewStore())
    return state


def test_opening_prepare_requires_edit_authority(monkeypatch):
    _install_opening_http_harness(monkeypatch, allowed=False)
    app = Starlette(routes=procurement_import_routes(Route))

    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/imports/opening/prepare",
            json={"packageId": "package-1", "workspaceLease": "workspace-1"},
        )

    assert response.status_code == 403
    assert response.json()["code"] == "ORGANIZATION_ACCESS_DENIED"


def test_opening_import_authorizes_the_canonical_package_module(monkeypatch):
    state = _install_opening_http_harness(monkeypatch)
    app = Starlette(routes=procurement_import_routes(Route))

    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/imports/opening/prepare",
            json={"packageId": "package-1", "workspaceLease": "workspace-1"},
        )

    assert response.status_code == 200
    assert state["authorized_modules"] == ["goithau"]


def test_opening_prepare_and_apply_use_server_preview_and_reject_stale_package(
    monkeypatch,
):
    state = _install_opening_http_harness(monkeypatch)
    app = Starlette(routes=procurement_import_routes(Route))

    with TestClient(app) as client:
        prepared = client.post(
            "/api/procurement/imports/opening/prepare",
            json={"packageId": "package-1", "workspaceLease": "workspace-1"},
        )
        assert prepared.status_code == 200
        preview = prepared.json()
        assert preview["notice"]["selectedRevision"] == "01"
        assert preview["opening"]["bidders"][0]["contractorName"] == "Nhà thầu A"

        injected = client.post(
            "/api/procurement/imports/opening/apply",
            json={
                "previewId": preview["previewId"],
                "expectedPackageRowVersion": 3,
                "workspaceLease": "workspace-1",
                "opening": {"bidders": [{"contractorName": "Untrusted"}]},
            },
        )
        assert injected.status_code == 400

        first_apply = client.post(
            "/api/procurement/imports/opening/apply",
            json={
                "previewId": preview["previewId"],
                "expectedPackageRowVersion": 3,
                "workspaceLease": "workspace-1",
            },
        )
        second_apply = client.post(
            "/api/procurement/imports/opening/apply",
            json={
                "previewId": preview["previewId"],
                "expectedPackageRowVersion": 3,
                "workspaceLease": "workspace-1",
            },
        )
        assert first_apply.status_code == second_apply.status_code == 200
        assert first_apply.json() == second_apply.json()

        state["row_version"] = 4
        stale = client.post(
            "/api/procurement/imports/opening/apply",
            json={
                "previewId": preview["previewId"],
                "expectedPackageRowVersion": 3,
                "workspaceLease": "workspace-1",
            },
        )

    assert stale.status_code == 409
    assert stale.json()["code"] == "PROCUREMENT_PREVIEW_STALE"


def test_apply_notice_rejects_browser_supplied_canonical_payload(monkeypatch):
    called = False

    async def should_not_run(*_args, **_kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(routes_module, "run_blocking_io", should_not_run)
    app = Starlette(routes=procurement_import_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/imports/notice/apply",
            json={
                "previewId": "preview-1",
                "idempotencyKey": "notice-1",
                "expectedPackageRowVersion": 3,
                "canonicalNotice": {"status": "PUBLISHED"},
            },
        )
    assert response.status_code == 400
    assert response.json()["code"] == "PROCUREMENT_CODE_INVALID"
    assert called is False


def test_prepare_does_not_misreport_internal_key_error_as_expired_preview(monkeypatch):
    async def fail_with_key_error(*_args, **_kwargs):
        raise KeyError("schema-field")

    monkeypatch.setattr(routes_module, "run_blocking_io", fail_with_key_error)
    app = Starlette(routes=procurement_import_routes(Route))
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/procurement/imports/plan/prepare",
            json={"code": "PL2600000001", "revisionMode": "LATEST"},
        )
    assert response.status_code == 502
    assert response.json()["code"] == "PROCUREMENT_UPSTREAM_UNAVAILABLE"


def test_prepare_reports_missing_source_revision_with_stable_error_contract(monkeypatch):
    async def fail_with_missing_revision(*_args, **_kwargs):
        raise LookupError("PROCUREMENT_REVISION_INVALID")

    monkeypatch.setattr(routes_module, "run_blocking_io", fail_with_missing_revision)
    app = Starlette(routes=procurement_import_routes(Route))
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/procurement/imports/plan/prepare",
            json={"code": "PL2600252503", "revisionMode": "LATEST"},
        )
    assert response.status_code == 400
    assert response.json()["code"] == "PROCUREMENT_REVISION_INVALID"


def test_prepare_reports_source_not_found_as_not_found(monkeypatch):
    async def fail_with_not_found(*_args, **_kwargs):
        raise routes_module.ProcurementSourceError("PROCUREMENT_NOT_FOUND")

    monkeypatch.setattr(routes_module, "run_blocking_io", fail_with_not_found)
    app = Starlette(routes=procurement_import_routes(Route))
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/procurement/imports/plan/prepare",
            json={"code": "PL2600000001", "revisionMode": "ALL"},
        )

    assert response.status_code == 404
    assert response.json()["code"] == "PROCUREMENT_NOT_FOUND"


@pytest.mark.parametrize(
    "error_code",
    ["PROCUREMENT_CODE_INVALID", "PROCUREMENT_REVISION_INVALID"],
)
def test_prepare_reports_invalid_user_input_as_bad_request(monkeypatch, error_code):
    async def fail_with_invalid_input(*_args, **_kwargs):
        raise ValueError(error_code)

    monkeypatch.setattr(routes_module, "run_blocking_io", fail_with_invalid_input)
    app = Starlette(routes=procurement_import_routes(Route))
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/procurement/imports/plan/prepare",
            json={"code": "invalid", "revisionMode": "LATEST"},
        )
    assert response.status_code == 400
    assert response.json()["code"] == error_code


def test_apply_decisions_resolve_required_field_ambiguity_and_local_conflict():
    revision = {
        "revisionId": "rev-01",
        "packages": [{
            "planDetailRevisionId": "detail-a", "symbol": "A", "name": "Gói A",
            "priceVnd": 1500, "executionPeriod": "30 ngày", "capitalDetail": "",
            "selectionDuration": "30 ngày", "selectionStart": "2026-02",
        }],
    }
    preview_rows = [{
        **revision["packages"][0],
        "action": "AMBIGUOUS",
        "matchCandidates": [
            {"rootId": "root-a", "snapshotId": "a1", "symbol": "A", "name": "Một"},
            {"rootId": "root-b", "snapshotId": "a2", "symbol": "A", "name": "Hai"},
        ],
        "fieldConflicts": [{
            "field": "priceVnd", "baseValue": 1000,
            "localValue": 1200, "sourceValue": 1500,
        }],
    }]
    resolved, package_decisions = _resolve_revision_decisions(
        revision, preview_rows,
        {
            "packageMatches": [{
                "packageObservationId": "detail-a", "localRootId": "root-b",
            }],
            "fieldValues": [{
                "packageObservationId": "detail-a", "field": "capitalDetail",
                "value": "Ngân sách",
            }],
            "fieldConflicts": [{
                "packageObservationId": "detail-a", "field": "priceVnd",
                "resolution": "KEEP_LOCAL",
            }],
        },
    )
    assert package_decisions == {"detail-a": {"localRootId": "root-b"}}
    assert resolved["packages"][0]["priceVnd"] == 1200
    assert resolved["packages"][0]["capitalDetail"] == "Ngân sách"


def test_apply_decisions_reject_unresolved_ambiguous_match():
    revision = {"revisionId": "rev-01", "packages": [{
        "planDetailRevisionId": "detail-a", "name": "Gói A", "priceVnd": 1,
        "executionPeriod": "1 ngày", "capitalDetail": "Vốn",
        "selectionDuration": "1 ngày", "selectionStart": "2026-01",
    }]}
    preview_rows = [{
        **revision["packages"][0], "action": "AMBIGUOUS",
        "matchCandidates": [{"rootId": "r1"}, {"rootId": "r2"}],
    }]
    try:
        _resolve_revision_decisions(revision, preview_rows, {})
    except ProcurementRouteError as error:
        assert error.code == "PROCUREMENT_MATCH_AMBIGUOUS"
        assert error.status_code == 409
    else:
        raise AssertionError("ambiguous preview must require a user decision")


def test_apply_decisions_rejects_fake_observation_and_field():
    revision = {"revisionId": "rev-01", "packages": [{
        "planDetailRevisionId": "detail-a", "name": "Gói A", "priceVnd": 1,
        "executionPeriod": "1 ngày", "capitalDetail": "Vốn",
        "selectionDuration": "1 ngày", "selectionStart": "2026-01",
    }]}
    preview_rows = [{**revision["packages"][0], "action": "UNCHANGED"}]
    with pytest.raises(ProcurementRouteError) as error:
        _resolve_revision_decisions(
            revision, preview_rows,
            {"fieldValues": [{
                "packageObservationId": "foreign-observation",
                "field": "capitalDetail", "value": "Không được phép",
            }]},
        )
    assert error.value.code == "PROCUREMENT_DECISION_INVALID"


def test_completed_operation_resume_rejects_another_user_in_same_workspace(monkeypatch):
    operation = {
        "operationId": "operation-1", "provider": "VNEPS",
        "familyNo": "PL2600000001", "mode": "ALL", "status": "COMPLETED",
        "nextRevisionIndex": 1, "totalRevisions": 1,
        "bundleDigest": "sha256:" + "a" * 64,
        "revisionResults": [{"status": "COMPLETED"}],
        "idempotencyKey": "all-1", "actorUserId": "owner-user",
        "requestHash": "a" * 64,
    }

    class FakeConnection:
        def cursor(self):
            return object()

        def execute(self, _statement):
            return self

        def commit(self):
            return None

        def rollback(self):
            return None

        def close(self):
            return None

    class FakeRepository:
        def __init__(self, _cursor):
            pass

        def get_operation(self, _organization_id, _operation_id):
            return deepcopy(operation)

    async def inline(function, *args, **kwargs):
        kwargs.pop("timeout_seconds", None)
        return function(*args, **kwargs)

    monkeypatch.setattr(routes_module, "run_blocking_io", inline)
    monkeypatch.setattr(
        routes_module, "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(user_id="other-user"), "org-1", "org-1"
        ),
    )
    monkeypatch.setattr(routes_module.database, "get_connection", FakeConnection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", FakeRepository)
    monkeypatch.setattr(
        routes_module,
        "_reload_write_authority",
        lambda _cursor, session, _organization_id: session,
    )
    monkeypatch.setattr(
        routes_module,
        "_lock_and_authorize_operation",
        lambda *_args: routes_module._deny_procurement_write(
            "foreign operation"
        ),
    )
    app = Starlette(routes=procurement_import_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/imports/operations/operation-1/resume"
        )
    assert response.status_code == 403
    assert response.json()["code"] == "ORGANIZATION_ACCESS_DENIED"


def test_completed_operation_resume_locks_operation_before_authorizing_replay(
    monkeypatch,
):
    cursor = _AuthorizationCursor(operation_actor="owner-user")
    connection = _AuthorizationConnection(cursor)
    operation = {
        "operationId": "operation-1",
        "provider": "VNEPS",
        "familyNo": "PL2600000001",
        "mode": "ALL",
        "status": "COMPLETED",
        "nextRevisionIndex": 1,
        "totalRevisions": 1,
        "bundleDigest": "sha256:" + "a" * 64,
        "revisionResults": [{"status": "COMPLETED"}],
        "idempotencyKey": "all-1",
        "actorUserId": "owner-user",
        "requestHash": "a" * 64,
    }

    class Repository:
        def __init__(self, _cursor):
            pass

        def get_operation(self, _organization_id, _operation_id):
            return deepcopy(operation)

        def lock_family(self, *_args):
            return None

        def load_family(self, *_args):
            return {"latestPlan": None, "packages": []}

    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(
                user_id="owner-user",
                session_id="session-1",
                active_role="employee",
            ),
            "org-1",
            "org-1",
        ),
    )
    monkeypatch.setattr(
        routes_module.database, "get_connection", lambda: connection
    )
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "has_module_permission", lambda *_args: True)

    result = routes_module._resume_blocking(object(), "operation-1")

    assert result["status"] == "COMPLETED"
    assert any(
        "FROM procurement_import_operation" in statement
        and "FOR UPDATE" in statement
        for statement in cursor.statements
    )


def test_operation_get_strips_private_metadata_after_read_authorization(
    monkeypatch,
):
    observed = []
    operation = {
        "operationId": "operation-1",
        "organizationId": "org-1",
        "status": "FAILED",
        "actorUserId": "owner-user",
        "requestHash": "private-request-hash",
        "revisionResults": [
            {
                "revisionId": "revision-1",
                "status": "FAILED",
                "canonicalRevision": {"secret": "server-only"},
                "investorId": "investor-1",
                "expectedPlanRowVersion": 7,
                "packageDecisions": {"package-1": "UPDATE"},
                "targetPackageRootId": "package-root",
                "expectedPackageRowVersion": 3,
                "errorCode": "PROCUREMENT_PREVIEW_STALE",
            }
        ],
    }

    class Connection:
        def cursor(self):
            return object()

        def close(self):
            return None

    class Repository:
        def __init__(self, _cursor):
            pass

        def get_operation(self, organization_id, operation_id):
            observed.append((organization_id, operation_id))
            return deepcopy(operation)

    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(user_id="reader-user"),
            "org-1",
            "org-1",
        ),
    )
    monkeypatch.setattr(routes_module.database, "get_connection", Connection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "can_read_table", lambda *_args: True)

    result = routes_module._get_operation_blocking(object(), "operation-1")

    assert observed == [("org-1", "operation-1")]
    assert "actorUserId" not in result
    assert "requestHash" not in result
    assert result["revisionResults"] == [
        {
            "revisionId": "revision-1",
            "status": "FAILED",
            "errorCode": "PROCUREMENT_PREVIEW_STALE",
        }
    ]


def test_completed_operation_resume_rechecks_permission_after_revocation(monkeypatch):
    operation = {
        "operationId": "operation-1",
        "provider": "VNEPS",
        "familyNo": "PL2600000001",
        "mode": "ALL",
        "status": "COMPLETED",
        "nextRevisionIndex": 1,
        "totalRevisions": 1,
        "bundleDigest": "sha256:" + "a" * 64,
        "revisionResults": [{"status": "COMPLETED"}],
        "idempotencyKey": "all-1",
        "actorUserId": "owner-user",
        "requestHash": "a" * 64,
    }

    class FakeConnection:
        def cursor(self):
            return object()

        def execute(self, _statement):
            return self

        def rollback(self):
            return None

        def close(self):
            return None

    class FakeRepository:
        def __init__(self, _cursor):
            pass

        def get_operation(self, _organization_id, _operation_id):
            return deepcopy(operation)

    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(user_id="owner-user", active_role="employee"),
            "org-1",
            "org-1",
        ),
    )
    monkeypatch.setattr(routes_module.database, "get_connection", FakeConnection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", FakeRepository)
    monkeypatch.setattr(
        routes_module,
        "_reload_write_authority",
        lambda _cursor, session, _organization_id: session,
    )
    monkeypatch.setattr(
        routes_module, "_lock_and_authorize_operation", lambda *_args: None
    )
    permission_checks = []

    def deny_current_permission(*args):
        permission_checks.append(args[-1])
        routes_module._deny_procurement_write("permission revoked")

    monkeypatch.setattr(routes_module, "_require_module_edit", deny_current_permission)

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._resume_blocking(object(), "operation-1")

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert permission_checks == ["kehoach"]


def test_serializable_authorization_conflict_returns_existing_stale_response(
    monkeypatch,
):
    class SerializationConflict(Exception):
        sqlstate = "40001"

    async def conflict(*_args, **_kwargs):
        raise SerializationConflict("concurrent assignment revocation")

    monkeypatch.setattr(routes_module, "run_blocking_io", conflict)
    app = Starlette(routes=procurement_import_routes(Route))

    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/imports/operations/operation-1/resume"
        )

    assert response.status_code == 409
    assert response.json()["code"] == "PROCUREMENT_PREVIEW_STALE"


def test_completed_operation_resume_rechecks_record_scope_after_revocation(
    monkeypatch,
):
    revision = {
        "familyNo": "PL2600000001",
        "revisionId": "revision-1",
        "revisionDigest": "sha256:" + "a" * 64,
    }
    operation = {
        "operationId": "operation-1",
        "provider": "MUASAMCONG",
        "familyNo": revision["familyNo"],
        "mode": "ALL",
        "status": "COMPLETED",
        "nextRevisionIndex": 1,
        "totalRevisions": 1,
        "bundleDigest": "sha256:" + "b" * 64,
        "revisionResults": [
            {
                "status": "COMPLETED",
                "canonicalRevision": deepcopy(revision),
                "investorId": "investor-1",
            }
        ],
        "idempotencyKey": "all-1",
        "actorUserId": "owner-user",
        "requestHash": "c" * 64,
    }
    cursor = _AuthorizationCursor(operation_actor="owner-user")
    connection = _AuthorizationConnection(cursor)

    class Repository:
        def __init__(self, _cursor):
            pass

        def get_operation(self, _organization_id, _operation_id):
            return deepcopy(operation)

        def lock_family(self, *_args):
            return None

        def load_family(self, *_args):
            return {
                "latestPlan": {"id": "plan-current", "rootId": "plan-root"},
                "packages": [],
            }

    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(
                user_id="owner-user",
                session_id="session-1",
                active_role="employee",
            ),
            "org-1",
            "org-1",
        ),
    )
    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "has_module_permission", lambda *_args: True)
    monkeypatch.setattr(
        routes_module,
        "authorize_record_write",
        lambda *_args: AccessDecision(False, "assignment revoked"),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._resume_blocking(object(), "operation-1")

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert "rollback" in connection.events
    assert "commit" not in connection.events


def test_resume_rolls_back_all_remaining_revisions_when_one_fails(monkeypatch):
    operation = {
        "operationId": "operation-atomic",
        "provider": "VNEPS",
        "familyNo": "PL2600000001",
        "mode": "ALL",
        "status": "FAILED",
        "nextRevisionIndex": 0,
        "totalRevisions": 2,
        "bundleDigest": "sha256:" + "a" * 64,
        "revisionResults": [
            {
                "revisionId": "rev-00",
                "revisionDigest": "sha256:" + "b" * 64,
                "status": "FAILED",
                "canonicalRevision": {
                    "revisionId": "rev-00",
                    "revisionDigest": "sha256:" + "b" * 64,
                },
                "expectedPlanRowVersion": 1,
                "investorId": "investor-1",
                "packageDecisions": {},
            },
            {
                "revisionId": "rev-01",
                "revisionDigest": "sha256:" + "c" * 64,
                "status": "FAILED",
                "canonicalRevision": {
                    "revisionId": "rev-01",
                    "revisionDigest": "sha256:" + "c" * 64,
                },
                "expectedPlanRowVersion": 1,
                "investorId": "investor-1",
                "packageDecisions": {},
            },
        ],
        "idempotencyKey": "all-atomic",
        "actorUserId": "owner-user",
        "requestHash": "a" * 64,
    }
    persisted = []

    class FakeConnection:
        def __init__(self):
            self.pending = []

        def cursor(self):
            return object()

        def execute(self, _statement):
            return self

        def commit(self):
            persisted.extend(self.pending)
            self.pending.clear()

        def rollback(self):
            self.pending.clear()

        def close(self):
            return None

    transaction_connection = FakeConnection()

    class FakeRepository:
        def __init__(self, _cursor):
            pass

        def get_operation(self, _organization_id, _operation_id):
            return deepcopy(operation)

    def apply_revision(
        _organization_id,
        _session,
        _provider,
        revision,
        *_args,
    ):
        connection = _args[-1]
        connection.pending.append(revision["revisionId"])
        if revision["revisionId"] == "rev-01":
            raise routes_module.ImportConflict("PROCUREMENT_PREVIEW_STALE")
        return {
            "operation": "APPLIED",
            "createdPlans": [],
            "createdPackages": [],
        }

    updates = []
    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(user_id="owner-user", active_role="employee"),
            "org-1",
            "org-1",
        ),
    )
    monkeypatch.setattr(
        routes_module.database,
        "get_connection",
        lambda: transaction_connection,
    )
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", FakeRepository)
    monkeypatch.setattr(
        routes_module,
        "_reload_write_authority",
        lambda _cursor, session, _organization_id: session,
    )
    monkeypatch.setattr(
        routes_module, "_lock_and_authorize_operation", lambda *_args: None
    )
    monkeypatch.setattr(routes_module, "_require_module_edit", lambda *_args: None)
    monkeypatch.setattr(routes_module, "_apply_one", apply_revision)
    monkeypatch.setattr(
        routes_module,
        "_update_operation",
        lambda *args: updates.append(args),
    )

    with pytest.raises(routes_module.ImportConflict):
        routes_module._resume_blocking(object(), "operation-atomic")

    assert persisted == []
    assert transaction_connection.pending == []
    assert updates[-1][2] == operation["nextRevisionIndex"]
    assert updates[-1][3][0]["status"] != "COMPLETED"
    assert updates[-1][-1] == "FAILED"


def test_plan_apply_failure_resets_cursor_to_atomic_batch_start(monkeypatch):
    revisions = [
        {"revisionId": "rev-00", "revisionDigest": "sha256:" + "b" * 64},
        {"revisionId": "rev-01", "revisionDigest": "sha256:" + "c" * 64},
    ]
    bundle = {
        "provider": "VNEPS",
        "plan": {"familyNo": "PL2600000001"},
        "revisionMode": "ALL",
        "revisions": revisions,
        "revisionPreviews": [],
        "reconciliationByRevision": {},
    }
    manifest = [
        {**revision, "status": "PENDING", "canonicalRevision": deepcopy(revision)}
        for revision in revisions
    ]
    updates = []

    class BatchConnection:
        def __init__(self):
            self.events = []

        def execute(self, statement):
            self.events.append(statement)
            return self

        def rollback(self):
            self.events.append("rollback")

        def close(self):
            self.events.append("close")

    connection = BatchConnection()
    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda *_args: (SimpleNamespace(user_id="owner-user"), "org-1", "org-1"),
    )
    monkeypatch.setattr(routes_module, "_enforce_rate_limit", lambda *_args: None)
    monkeypatch.setattr(
        routes_module,
        "PREVIEW_STORE",
        SimpleNamespace(get=lambda *_args, **_kwargs: SimpleNamespace(
            canonical_bundle=bundle,
        )),
    )
    monkeypatch.setattr(
        routes_module,
        "resolve_plan_decision_authority",
        lambda active_bundle, _decisions: {
            "resolvedRevisions": active_bundle["revisions"],
            "packageDecisionsByRevision": {
                revision["revisionId"]: {} for revision in revisions
            },
        },
    )
    monkeypatch.setattr(
        routes_module,
        "_create_operation",
        lambda *_args: ("operation-atomic", deepcopy(manifest), "PENDING", 0),
    )
    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)

    calls = []

    def apply_one(_organization, _session, _provider, revision, *_args):
        calls.append(revision["revisionId"])
        if revision["revisionId"] == "rev-01":
            raise routes_module.ImportConflict("PROCUREMENT_PREVIEW_STALE")
        return {"operation": "APPLIED", "createdPlans": [], "createdPackages": []}

    monkeypatch.setattr(routes_module, "_apply_one", apply_one)
    monkeypatch.setattr(
        routes_module, "_update_operation", lambda *args: updates.append(args)
    )

    with pytest.raises(routes_module.ImportConflict):
        routes_module._apply_blocking(object(), {
            "previewId": "preview-1",
            "idempotencyKey": "all-atomic",
            "decisions": {"investorId": "investor-1"},
            "expectedPlanRowVersion": 1,
        })

    assert calls == ["rev-00", "rev-01"]
    assert "rollback" in connection.events
    assert updates[-1][2] == 0
    assert updates[-1][3][0]["status"] == "PENDING"
    assert updates[-1][3][1]["status"] == "FAILED"


def test_notice_apply_failure_resets_cursor_to_atomic_batch_start(monkeypatch):
    revisions = [
        {"revisionId": "notice-00", "revisionDigest": "sha256:" + "b" * 64},
        {"revisionId": "notice-01", "revisionDigest": "sha256:" + "c" * 64},
    ]
    bundle = {
        "provider": "MUASAMCONG",
        "importKind": "NOTICE",
        "notice": {"expectedPackageRowVersion": 3},
        "targetPackageRootId": "package-root",
        "revisionMode": "ALL",
        "revisions": revisions,
    }
    manifest = [
        {**revision, "status": "PENDING", "canonicalRevision": deepcopy(revision)}
        for revision in revisions
    ]
    updates = []

    class BatchConnection:
        def __init__(self):
            self.events = []

        def execute(self, statement):
            self.events.append(statement)
            return self

        def rollback(self):
            self.events.append("rollback")

        def close(self):
            self.events.append("close")

    connection = BatchConnection()
    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda *_args: (SimpleNamespace(user_id="owner-user"), "org-1", "org-1"),
    )
    monkeypatch.setattr(routes_module, "_enforce_rate_limit", lambda *_args: None)
    monkeypatch.setattr(
        routes_module,
        "PREVIEW_STORE",
        SimpleNamespace(get=lambda *_args, **_kwargs: SimpleNamespace(
            canonical_bundle=bundle,
        )),
    )
    monkeypatch.setattr(
        routes_module,
        "_create_notice_operation",
        lambda *_args: ("notice-operation-atomic", deepcopy(manifest), "PENDING", 0),
    )
    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)

    calls = []

    def apply_notice(_organization, _session, _provider, revision, *_args):
        calls.append(revision["revisionId"])
        if revision["revisionId"] == "notice-01":
            raise routes_module.ImportConflict("PROCUREMENT_PREVIEW_STALE")
        return {"operation": "APPLIED", "createdPlans": [], "createdPackages": []}

    monkeypatch.setattr(routes_module, "_apply_notice_one", apply_notice)
    monkeypatch.setattr(
        routes_module, "_update_operation", lambda *args: updates.append(args)
    )

    with pytest.raises(routes_module.ImportConflict):
        routes_module._apply_notice_blocking(object(), {
            "previewId": "preview-1",
            "idempotencyKey": "notice-all-atomic",
            "expectedPackageRowVersion": 3,
        })

    assert calls == ["notice-00", "notice-01"]
    assert "rollback" in connection.events
    assert updates[-1][2] == 0
    assert updates[-1][3][0]["status"] == "PENDING"
    assert updates[-1][3][1]["status"] == "FAILED"


def test_notice_resume_rolls_back_all_revisions_when_later_scope_is_revoked(
    monkeypatch,
):
    operation = {
        "operationId": "notice-operation-atomic",
        "provider": "MUASAMCONG",
        "familyNo": "IB2600000002",
        "mode": "ALL",
        "status": "FAILED",
        "nextRevisionIndex": 0,
        "totalRevisions": 2,
        "bundleDigest": "sha256:" + "a" * 64,
        "revisionResults": [
            {
                "importKind": "NOTICE",
                "revisionId": "notice-00",
                "revisionDigest": "sha256:" + "b" * 64,
                "status": "FAILED",
                "canonicalRevision": {
                    "noticeNo": "IB2600000002",
                    "revisionId": "notice-00",
                    "revisionDigest": "sha256:" + "b" * 64,
                    "relationship": {},
                },
                "expectedPackageRowVersion": 3,
                "targetPackageRootId": "package-root",
            },
            {
                "importKind": "NOTICE",
                "revisionId": "notice-01",
                "revisionDigest": "sha256:" + "c" * 64,
                "status": "FAILED",
                "canonicalRevision": {
                    "noticeNo": "IB2600000002",
                    "revisionId": "notice-01",
                    "revisionDigest": "sha256:" + "c" * 64,
                    "relationship": {},
                },
                "expectedPackageRowVersion": None,
                "targetPackageRootId": "package-root",
            },
        ],
        "idempotencyKey": "notice-all-atomic",
        "actorUserId": "owner-user",
        "requestHash": "d" * 64,
    }
    persisted = []
    resolved_targets = []
    updates = []

    class BatchConnection(_AuthorizationConnection):
        def __init__(self, cursor):
            super().__init__(cursor)
            self.pending = []

        def commit(self):
            persisted.extend(self.pending)
            self.pending.clear()
            super().commit()

        def rollback(self):
            self.pending.clear()
            super().rollback()

    cursor = _AuthorizationCursor(operation_actor="owner-user")
    connection = BatchConnection(cursor)

    class Repository:
        def __init__(self, _cursor):
            pass

        def get_operation(self, _organization_id, _operation_id):
            return deepcopy(operation)

        def lock_family(self, *_args):
            return None

        def resolve_notice_target(self, *_args, **_kwargs):
            target_id = (
                "package-allowed"
                if not resolved_targets
                else "package-revoked"
            )
            resolved_targets.append(target_id)
            return {"id": target_id, "rootId": "package-root"}

    class Reconciler:
        def __init__(self, _repository):
            pass

        def reconcile_revision(self, **kwargs):
            connection.pending.append(kwargs["notice"]["revisionId"])
            return {
                "operation": "UPDATED",
                "createdPlans": [],
                "createdPackages": [],
            }

    monkeypatch.setattr(
        routes_module,
        "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(
                user_id="owner-user",
                session_id="session-1",
                active_role="employee",
            ),
            "org-1",
            "org-1",
        ),
    )
    monkeypatch.setattr(routes_module.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(routes_module, "ProcurementNoticeReconciler", Reconciler)
    monkeypatch.setattr(routes_module, "has_module_permission", lambda *_args: True)
    monkeypatch.setattr(
        routes_module,
        "authorize_record_write",
        lambda _cursor, _role, _user, _organization, _key, _table, item: (
            AccessDecision(item["id"] != "package-revoked", "assignment revoked")
        ),
    )
    monkeypatch.setattr(
        routes_module,
        "_update_operation",
        lambda *args: updates.append(args),
    )

    with pytest.raises(ProcurementRouteError) as caught:
        routes_module._resume_blocking(object(), "notice-operation-atomic")

    assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    assert resolved_targets == ["package-allowed", "package-revoked"]
    assert persisted == []
    assert connection.pending == []
    assert "commit" not in connection.events
    assert updates[-1][2] == operation["nextRevisionIndex"]
    assert updates[-1][3][0]["status"] != "COMPLETED"
    assert updates[-1][-1] == "FAILED"


def test_resume_persists_failed_cursor_before_returning_conflict(monkeypatch):
    operation = {
        "operationId": "operation-1", "provider": "VNEPS",
        "familyNo": "PL2600000001", "mode": "ALL", "status": "FAILED",
        "nextRevisionIndex": 0, "totalRevisions": 1,
        "bundleDigest": "sha256:" + "a" * 64,
        "revisionResults": [{
            "revisionId": "rev-00", "revisionDigest": "sha256:" + "b" * 64,
            "status": "FAILED", "canonicalRevision": {
                "revisionId": "rev-00", "revisionDigest": "sha256:" + "b" * 64,
            },
            "expectedPlanRowVersion": 1, "investorId": "investor-1",
            "packageDecisions": {},
        }],
        "idempotencyKey": "all-1", "actorUserId": "owner-user",
        "requestHash": "a" * 64,
    }
    updates = []

    class FakeConnection:
        def cursor(self):
            return object()

        def execute(self, _statement):
            return self

        def commit(self):
            return None

        def rollback(self):
            return None

        def close(self):
            return None

    class FakeRepository:
        def __init__(self, _cursor):
            pass

        def get_operation(self, _organization_id, _operation_id):
            return deepcopy(operation)

    async def inline(function, *args, **kwargs):
        kwargs.pop("timeout_seconds", None)
        return function(*args, **kwargs)

    monkeypatch.setattr(routes_module, "run_blocking_io", inline)
    monkeypatch.setattr(
        routes_module, "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(user_id="owner-user"), "org-1", "org-1"
        ),
    )
    monkeypatch.setattr(routes_module.database, "get_connection", FakeConnection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", FakeRepository)
    monkeypatch.setattr(
        routes_module,
        "_reload_write_authority",
        lambda _cursor, session, _organization_id: session,
    )
    monkeypatch.setattr(
        routes_module, "_lock_and_authorize_operation", lambda *_args: None
    )
    monkeypatch.setattr(
        routes_module, "_apply_one",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            routes_module.ImportConflict("PROCUREMENT_PREVIEW_STALE")
        ),
    )
    monkeypatch.setattr(routes_module, "_require_module_edit", lambda *_args: None)
    monkeypatch.setattr(
        routes_module, "_update_operation",
        lambda organization_id, operation_id, cursor, results, status: updates.append(
            (organization_id, operation_id, cursor, deepcopy(results), status)
        ),
    )
    app = Starlette(routes=procurement_import_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/imports/operations/operation-1/resume"
        )
    assert response.status_code == 409
    assert updates[0][2] == 0
    assert updates[0][3][0]["status"] == "FAILED"
    assert updates[0][3][0]["errorCode"] == "PROCUREMENT_PREVIEW_STALE"
    assert updates[0][4] == "FAILED"


def test_notice_all_resume_continues_from_durable_cursor(monkeypatch):
    operation = {
        "operationId": "notice-operation-1", "provider": "MUASAMCONG",
        "familyNo": "IB2600000002", "mode": "ALL", "status": "FAILED",
        "nextRevisionIndex": 1, "totalRevisions": 2,
        "bundleDigest": "sha256:" + "a" * 64,
        "revisionResults": [
            {
                "importKind": "NOTICE", "revisionId": "notice-00",
                "revisionDigest": "sha256:" + "b" * 64,
                "status": "COMPLETED", "outcome": "UPDATED",
                "createdPackageIds": [], "nextExpectedPackageRowVersion": 4,
                "canonicalRevision": {
                    "revisionId": "notice-00", "revisionDigest": "sha256:" + "b" * 64,
                },
                "expectedPackageRowVersion": 3,
                "targetPackageRootId": "package-root-1",
            },
            {
                "importKind": "NOTICE", "revisionId": "notice-01",
                "revisionDigest": "sha256:" + "c" * 64,
                "status": "FAILED", "errorCode": "PROCUREMENT_APPLY_FAILED",
                "canonicalRevision": {
                    "revisionId": "notice-01", "revisionDigest": "sha256:" + "c" * 64,
                },
                "expectedPackageRowVersion": None,
                "targetPackageRootId": "package-root-1",
            },
        ],
        "idempotencyKey": "notice-all-1", "actorUserId": "owner-user",
        "requestHash": "d" * 64,
    }
    applied = []
    updates = []

    class FakeConnection:
        def cursor(self):
            return object()

        def execute(self, _statement):
            return self

        def commit(self):
            return None

        def rollback(self):
            return None

        def close(self):
            return None

    class FakeRepository:
        def __init__(self, _cursor):
            pass

        def get_operation(self, _organization_id, _operation_id):
            return deepcopy(operation)

    async def inline(function, *args, **kwargs):
        kwargs.pop("timeout_seconds", None)
        return function(*args, **kwargs)

    def apply_notice(
        organization_id, actor_user_id, provider, revision, idempotency_key,
        expected_row_version, target_root_id, operation_id, connection,
    ):
        applied.append(
            (
                organization_id, actor_user_id, provider, revision["revisionId"],
                idempotency_key, expected_row_version, target_root_id,
                operation_id,
                connection,
            )
        )
        return {
            "operation": "UPDATED", "createdPlans": [], "createdPackages": [],
        }

    monkeypatch.setattr(routes_module, "run_blocking_io", inline)
    monkeypatch.setattr(
        routes_module, "_request_context",
        lambda _request, _lease: (
            SimpleNamespace(user_id="owner-user"), "org-1", "org-1"
        ),
    )
    monkeypatch.setattr(routes_module.database, "get_connection", FakeConnection)
    monkeypatch.setattr(routes_module, "ProcurementImportRepository", FakeRepository)
    monkeypatch.setattr(
        routes_module,
        "_reload_write_authority",
        lambda _cursor, session, _organization_id: session,
    )
    monkeypatch.setattr(
        routes_module, "_lock_and_authorize_operation", lambda *_args: None
    )
    monkeypatch.setattr(routes_module, "_apply_notice_one", apply_notice)
    monkeypatch.setattr(routes_module, "_require_module_edit", lambda *_args: None)
    monkeypatch.setattr(
        routes_module, "_update_operation",
        lambda organization_id, operation_id, cursor, results, status: updates.append(
            (organization_id, operation_id, cursor, deepcopy(results), status)
        ),
    )
    app = Starlette(routes=procurement_import_routes(Route))

    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/imports/operations/notice-operation-1/resume"
        )

    assert response.status_code == 200
    assert response.json()["status"] == "COMPLETED"
    assert [row[3] for row in applied] == ["notice-01"]
    assert applied[0][5] == 4
    assert applied[0][4].startswith("notice-operation-1:notice-01:")
    assert applied[0][7] == "notice-operation-1"
    assert updates[-1][2] == 2
    assert updates[-1][3][1]["status"] == "COMPLETED"
    assert updates[-1][4] == "COMPLETED"
