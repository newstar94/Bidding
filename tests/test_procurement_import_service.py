from datetime import datetime, timedelta, timezone
from copy import deepcopy
from threading import Event, Lock
import time

import pytest

from backend.procurement_import.domain import (
    ImportConflict,
    PackageAction,
    ProcurementCodeKind,
    RequiredFieldIssue,
    derive_import_lifecycle_status,
    normalize_procurement_code,
    project_source_lifecycle_to_bidding,
    three_way_merge_field,
)
from backend.procurement_import.decisions import ProcurementDecisionError
from backend.procurement_import.service import ProcurementImportPreparer, PreviewStore
from backend.procurement_import.session import ProcurementImportSessionService
from backend.procurement_import.repository import ProcurementImportSessionRepository
from backend.procurement_import.draft_mapping import (
    map_package_canonical_to_draft,
    map_plan_canonical_to_draft,
)
from backend.integrations.vneps.fake_procurement_provider import FixtureProcurementSource
from backend.observability.recording import (
    reset_recorded_metrics_for_tests,
    snapshot_recorded_metrics,
)
from backend.observability import metrics as observability_metrics


def test_bounded_enrichment_serializes_a_shared_source_instead_of_reporting_busy():
    """The process-wide Mua Sam Cong source owns one JSON-lines worker."""

    first_lookup_started = Event()

    class SharedSource:
        name = "MUASAMCONG"

        def __init__(self):
            self.lock = Lock()
            self.calls = []

        def lookup_with_options(
            self, code, kind, *, detail_level, revision_mode, revision_numbers
        ):
            if not self.lock.acquire(blocking=False):
                raise RuntimeError("PROCUREMENT_LOOKUP_BUSY")
            try:
                self.calls.append(code)
                first_lookup_started.set()
                time.sleep(0.05)
                return {
                    "canonical": {"revisions": [{
                        "revisionId": f"{code}-00",
                        "revisionNumber": "00",
                        "noticeNo": code,
                        "status": "PUBLISHED",
                    }]},
                    "metrics": {"cache": {"hit": False}},
                }
            finally:
                self.lock.release()

    revisions = [{
        "revisionId": "plan-00",
        "revisionNumber": "00",
        "packages": [
            {
                "planDetailRevisionId": "detail-1",
                "noticeLink": {
                    "state": "LINKED",
                    "noticeNo": "IB2600000001",
                    "noticeVersion": "00",
                },
            },
            {
                "planDetailRevisionId": "detail-2",
                "noticeLink": {
                    "state": "LINKED",
                    "noticeNo": "IB2600000002",
                    "noticeVersion": "00",
                },
            },
        ],
    }]
    source = SharedSource()
    preparer = ProcurementImportPreparer(source, PreviewStore())

    history, failures = preparer._enrich_linked_notices_bounded(
        revisions,
        organization_id="org-1",
        max_workers=2,
        timeout_seconds=2,
        source_factory=lambda: source,
    )

    assert first_lookup_started.is_set()
    assert failures == []
    assert set(history) == {"IB2600000001", "IB2600000002"}
    assert sorted(source.calls) == ["IB2600000001", "IB2600000002"]


def test_plan_draft_carries_approval_decision_for_investor_short_name():
    draft = map_plan_canonical_to_draft(
        "MUASAMCONG",
        "PL2600164871",
        {
            "revisionId": "revision-00",
            "revisionNumber": "00",
            "investorCode": "vn3900786617",
            "approvalDecisionNo": "547-QĐ/BPTTH",
        },
    )

    assert draft["investorSource"]["approvalDecisionNo"] == "547-QĐ/BPTTH"


def _source(tmp_path):
    fixture = tmp_path / "plans.json"
    fixture.write_text(
        """{
          "schemaVersion": "vneps-procurement-fixture-v1",
          "plans": [{
            "familyNo": "PL2600000001",
            "revisions": [
              {"revisionId":"rev-00","revisionNumber":"00","name":"Kế hoạch 00",
               "planType":"Dự toán mua sắm","projectName":"Dự toán A",
               "investorCode":"INV-1","approvalDecisionNo":"01/QD",
               "approvalDecisionDate":"2026-01-01",
               "packages":[{"planDetailRevisionId":"detail-a-00","symbol":"A",
                 "name":"Gói A","priceVnd":1000,"executionPeriod":"30 ngày",
                 "capitalDetail":"Ngân sách","selectionDuration":"30 ngày",
                 "selectionStart":"2026-02","expectedNotice":true}]},
              {"revisionId":"rev-01","revisionNumber":"01","name":"Kế hoạch 01",
               "planType":"Dự toán mua sắm","projectName":"Dự toán A",
               "investorCode":"INV-1","approvalDecisionNo":"02/QD",
               "approvalDecisionDate":"2026-02-01",
               "packages":[
                 {"planDetailRevisionId":"detail-a-01","symbol":"A",
                  "name":"Gói A","priceVnd":1000,"executionPeriod":"30 ngày",
                  "capitalDetail":"Ngân sách","selectionDuration":"30 ngày",
                  "selectionStart":"2026-02","expectedNotice":true},
                 {"planDetailRevisionId":"detail-b-01","symbol":"B",
                  "name":"Gói B","priceVnd":2000,"executionPeriod":"60 ngày",
                  "capitalDetail":"Ngân sách","selectionDuration":"30 ngày",
                  "selectionStart":"2026-03","expectedNotice":true,
                  "noticeLink":{"state":"LINKED",
                  "noticeNo":"IB2600000002","kind":"UNKNOWN"}}
               ]}
            ]
          }]
        }""",
        encoding="utf-8",
    )
    return FixtureProcurementSource(str(fixture))


def test_procurement_code_normalization_separates_base_and_requested_revision():
    code = normalize_procurement_code(" pl2600000001-01 ")
    assert code.kind is ProcurementCodeKind.PLAN
    assert code.base_code == "PL2600000001"
    assert code.requested_revision == "01"
    assert code.original == "pl2600000001-01"

    notice = normalize_procurement_code("ib2600000002")
    assert notice.kind is ProcurementCodeKind.NOTICE
    assert notice.base_code == "IB2600000002"
    assert notice.requested_revision is None

    with pytest.raises(ValueError, match="PROCUREMENT_CODE_INVALID"):
        normalize_procurement_code("PL-unsafe")


@pytest.mark.parametrize(
    ("package", "expected"),
    [
        (
            {
                "noticeLink": {"state": "UNLINKED"},
                "expectedNotice": True,
                "name": "Gói A", "priceVnd": 1,
                "executionPeriod": "30 ngày", "capitalDetail": "Ngân sách",
                "selectionDuration": "30 ngày", "selectionStart": "2026-02",
            },
            "PREPARING",
        ),
        ({"noticeLink": {"state": "UNLINKED"}}, "UNKNOWN"),
        (
            {
                "noticeLink": {
                    "state": "LINKED", "noticeNo": "IB2600000001",
                    "kind": "PRE_NOTIFY", "noticeRevisionId": "pre-00",
                    "noticeVersion": "00",
                },
                "noticeFields": {"status": "PUBLISHED"},
            },
            "UNKNOWN",
        ),
        (
            {
                "kind": "TBMT",
                "noticeNo": "IB2600291864",
                "revisionId": "notice-00",
                "revisionNumber": "00",
                "status": "PUB_KQLCNT",
                "approvalDecisionNo": "206/QĐ-TTYT",
                "name": "Gói đã phê duyệt E-HSMT",
                "priceVnd": 1,
                "executionPeriod": "30 ngày",
                "capitalDetail": "Ngân sách",
                "selectionDuration": "30 ngày",
                "selectionStart": "2026-02",
            },
            "AWARDED",
        ),
        (
            {
                "kind": "TBMT",
                "noticeNo": "IB2600291864",
                "revisionId": "notice-00",
                "revisionNumber": "00",
                "sourceStatus": "AWARDED",
                "approvalDecisionNo": "206/QĐ-TTYT",
                "name": "Gói đã có kết quả",
                "priceVnd": 1,
                "executionPeriod": "30 ngày",
                "capitalDetail": "Ngân sách",
                "selectionDuration": "30 ngày",
                "selectionStart": "2026-02",
            },
            "AWARDED",
        ),
        (
            {
                "noticeLink": {
                    "state": "LINKED", "noticeNo": "IB2600000001",
                    "kind": "TBMT", "noticeRevisionId": "notice-00",
                    "noticeVersion": "00",
                },
                "noticeFields": {"status": "PUBLISHED"},
                "name": "Gói A", "priceVnd": 1,
                "executionPeriod": "30 ngày", "capitalDetail": "Ngân sách",
                "selectionDuration": "30 ngày", "selectionStart": "2026-02",
                "bidValidityDays": 90,
            },
            "INVITED",
        ),
        (
            {
                "noticeLink": {
                    "state": "LINKED", "noticeNo": "IB2600000001",
                    "kind": "TBMT", "noticeRevisionId": "notice-00",
                    "noticeVersion": "00",
                },
                "noticeFields": {"status": "PUBLISHED"},
                "name": "Gói A", "priceVnd": 1,
                "executionPeriod": "30 ngày", "capitalDetail": "Ngân sách",
                "selectionDuration": "30 ngày", "selectionStart": "2026-02",
            },
            "INVITED",
        ),
        (
            {
                "noticeLink": {
                    "state": "LINKED", "noticeNo": "IB2600374868",
                    "kind": "TBMT", "noticeRevisionId": "notice-00",
                    "noticeVersion": "00",
                },
                "noticeFields": {"statusForNotify": "DXT"},
            },
            "EVALUATING",
        ),
    ],
)
def test_import_lifecycle_mapping_is_conservative(package, expected):
    assert derive_import_lifecycle_status(package) == expected


@pytest.mark.parametrize(
    ("source_status", "has_published_notice", "expected"),
    [
        ("PREPARING", False, "PREPARING"),
        ("INVITED", True, "INVITED"),
        ("OPENED", True, "INVITED"),
        ("EVALUATING", True, "INVITED"),
        ("PARTIALLY_AWARDED", True, "INVITED"),
        ("AWARDED", True, "INVITED"),
        ("CANCELLED", True, "INVITED"),
        ("CANCELLED", False, "UNKNOWN"),
    ],
)
def test_source_lifecycle_projects_to_invitation_bounded_local_status(
    source_status, has_published_notice, expected,
):
    assert project_source_lifecycle_to_bidding(
        source_status,
        has_published_notice=has_published_notice,
    ) == expected


@pytest.mark.parametrize(
    ("existing_status", "source_status", "expected"),
    [
        ("PREPARING", "OPENED", "INVITED"),
        ("INVITED", "EVALUATING", "INVITED"),
        ("EVALUATING", "AWARDED", "EVALUATING"),
        ("AWARDED", "EVALUATING", "AWARDED"),
    ],
)
def test_source_resync_preserves_user_controlled_local_workflow(
    existing_status, source_status, expected,
):
    assert project_source_lifecycle_to_bidding(
        source_status,
        existing_status=existing_status,
        has_published_notice=True,
    ) == expected


@pytest.mark.parametrize(
    ("source_fields", "source_truth"),
    [
        ({"status": "OPEN_BID"}, "OPENED"),
        ({"status": "OPEN_DXKT"}, "OPENED"),
        ({"status": "OPEN_DXTC"}, "OPENED"),
        ({"status": "DANG XET THAU"}, "EVALUATING"),
        ({"status": "DANG CHAM THAU"}, "EVALUATING"),
        ({"status": "PUB_DSNTKT"}, "EVALUATING"),
        ({"status": "PARTIALLY_AWARDED"}, "PARTIALLY_AWARDED"),
        ({"status": "AWARDED"}, "AWARDED"),
        ({"status": "CANCELLED"}, "CANCELLED"),
    ],
)
def test_source_truth_is_retained_while_local_projection_stops_at_invitation(
    source_fields, source_truth,
):
    package = {
        "noticeLink": {
            "state": "LINKED", "noticeNo": "IB2600000001",
            "kind": "TBMT", "noticeRevisionId": "notice-00",
            "noticeVersion": "00",
        },
        "noticeFields": source_fields,
    }

    observed = derive_import_lifecycle_status(package)

    assert observed == source_truth
    assert project_source_lifecycle_to_bidding(
        observed,
        has_published_notice=True,
    ) == "INVITED"


@pytest.mark.parametrize(
    ("source_status", "bidding_status"),
    [
        ("UNKNOWN", "Chưa xác định"),
        ("PREPARING", "Chuẩn bị"),
        ("INVITED", "Đang mời thầu"),
        ("OPENED", "Đang mời thầu"),
        ("EVALUATING", "Đang mời thầu"),
        ("PARTIALLY_AWARDED", "Đang mời thầu"),
        ("AWARDED", "Đang mời thầu"),
        ("CANCELLED", "Chưa xác định"),
    ],
)
def test_package_draft_maps_source_lifecycle_to_bidding_status(
    source_status, bidding_status,
):
    notice_link = (
        {
            "state": "LINKED", "noticeNo": "IB2600000001",
            "kind": "TBMT", "noticeRevisionId": "notice-00",
            "noticeVersion": "00",
        }
        if source_status not in {"UNKNOWN", "PREPARING", "CANCELLED"}
        else {"state": "UNLINKED"}
    )
    draft = map_package_canonical_to_draft(
        "MUASAMCONG", "PL2600000001",
        {"revisionId": "rev-00", "revisionNumber": "00"},
        {
            "planDetailRevisionId": "detail-a-00",
            "name": "Gói A",
            "lifecycleStatus": source_status,
            "noticeLink": notice_link,
        },
    )

    assert draft["trangThai"] == bidding_status


def test_package_draft_maps_invitation_fields_without_opening_materialization():
    draft = map_package_canonical_to_draft(
        "MUASAMCONG", "PL2600184109",
        {"revisionId": "plan-00", "revisionNumber": "00"},
        {
            "planDetailRevisionId": "detail-00",
            "effectiveFields": {
                "name": "Gói đang xét thầu",
                "lifecycleStatus": "EVALUATING",
                "bidValidityDays": 90,
                "bidGuaranteeVnd": 52_183_040,
                "evaluationMethod": "Giá đánh giá",
                "approvalDecisionNo": "123/QĐ-E-HSMT",
                "approvalDecisionDate": "2026-07-15T00:00:00",
                "financialActualOpeningAt": "2026-08-03T16:20:00",
                "noticeLink": {
                    "state": "LINKED", "noticeNo": "IB2600184109",
                    "kind": "TBMT", "noticeRevisionId": "notice-00",
                    "noticeVersion": "00",
                },
                "noticeFields": {
                    "publishedAt": "2026-07-16T09:00:00",
                    "bidClosingAt": "2026-08-03T13:00:00",
                    "bidOpeningAt": "2026-08-03T13:00:00",
                    "actualOpeningAt": "2026-08-03T13:08:42",
                },
            },
        },
    )

    assert draft["trangThai"] == "Đang mời thầu"
    assert draft["hieuLucHsdt"] == 90
    assert draft["hieuLucDamBaoDuThau"] == 120
    assert draft["giaTriBaoDamDuThau"] == 52_183_040
    assert draft["phuongPhapDanhGia"] == "Giá đánh giá"
    assert draft["soQuyetDinh"] == "123/QĐ-E-HSMT"
    assert draft["ngayQuyetDinh"] == "2026-07-15T00:00:00"
    assert draft["thoiGianDangTai"] == "2026-07-16T09:00:00"
    assert draft["thoiGianDongThau"] == "2026-08-03T13:00:00"
    assert "thoiGianMoThau" not in draft
    assert "thoiGianMoEhsdxtc" not in draft
    assert draft["yeuCauThamDinhHsmt"] == "Không"
    assert draft["yeuCauThamDinhHsmtCode"] == "NOT_REQUIRED"


def test_direct_notice_draft_derives_evaluating_from_status_for_notify():
    draft = map_package_canonical_to_draft(
        "MUASAMCONG", "IB2600374868",
        {
            "kind": "TBMT",
            "noticeNo": "IB2600374868",
            "revisionId": "notice-00",
            "revisionNumber": "00",
            "status": "IS_PUBLISH",
            "statusForNotify": "DXT",
            "publishedAt": "2026-07-16T09:00:00",
            "bidClosingAt": "2026-08-03T13:00:00",
            "bidOpeningAt": "2026-08-03T13:00:00",
            "actualOpeningAt": "2026-08-03T13:08:42",
        },
        {
            "kind": "TBMT",
            "noticeNo": "IB2600374868",
            "revisionId": "notice-00",
            "revisionNumber": "00",
            "status": "IS_PUBLISH",
            "statusForNotify": "DXT",
            "publishedAt": "2026-07-16T09:00:00",
            "bidClosingAt": "2026-08-03T13:00:00",
            "bidOpeningAt": "2026-08-03T13:00:00",
            "actualOpeningAt": "2026-08-03T13:08:42",
        },
    )

    assert draft["trangThai"] == "Đang mời thầu"
    assert draft["thoiGianDangTai"] == "2026-07-16T09:00:00"
    assert draft["thoiGianDongThau"] == "2026-08-03T13:00:00"
    assert "thoiGianMoThau" not in draft


def test_prepare_latest_previews_full_snapshot_and_warns_about_older_history(tmp_path):
    store = PreviewStore(ttl_seconds=120)
    preparer = ProcurementImportPreparer(_source(tmp_path), store)
    preview = preparer.prepare_plan(
        code="PL2600000001",
        revision_mode="LATEST",
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
        local_state=None,
    )

    assert preview["schemaVersion"] == "biddingflow-procurement-import-preview-v2"
    assert preview["plan"]["selectedRevisions"] == ["01"]
    assert preview["plan"]["expectedRowVersion"] is None
    assert [row["symbol"] for row in preview["packages"]] == ["A", "B"]
    assert all(row["action"] == PackageAction.ADDED.value for row in preview["packages"])
    lifecycle_by_symbol = {
        row["symbol"]: row["lifecycleStatus"] for row in preview["packages"]
    }
    assert lifecycle_by_symbol == {"A": "PREPARING", "B": "UNKNOWN"}
    assert any(
        item["code"] == "PROCUREMENT_LIFECYCLE_UNKNOWN"
        and item["packageObservationId"] == "detail-b-01"
        for item in preview["warnings"]
    )
    assert preview["bundleDigest"].startswith("sha256:")
    assert any(item["code"] == "OLDER_REVISIONS_PROVENANCE_ONLY_AFTER_APPLY" for item in preview["warnings"])
    stored = store.get(
        preview["previewId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", now=datetime.now(timezone.utc),
    )
    assert stored.bundle_digest == preview["bundleDigest"]


def test_prepare_and_session_read_record_bounded_latency_phases(tmp_path):
    reset_recorded_metrics_for_tests()
    store = PreviewStore(ttl_seconds=120)
    preview = ProcurementImportPreparer(_source(tmp_path), store).prepare_plan(
        code="PL2600000001", revision_mode="ALL",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state=None,
    )
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        store.get(
            preview["previewId"], organization_id="org-1", user_id="user-1",
            workspace_lease="lease-1",
        ).canonical_bundle,
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    service.get_revision_draft(
        manifest["sessionId"], "00", organization_id="org-1",
        user_id="user-1", workspace_lease="lease-1",
    )
    service.get_revision_draft(
        manifest["sessionId"], "01", organization_id="org-1",
        user_id="user-1", workspace_lease="lease-1",
    )

    phases = snapshot_recorded_metrics().database_phase_count
    assert phases[("procurement_import", "source_fetch", "ok")] == 1
    assert phases[("procurement_import", "canonical_normalize", "ok")] >= 1
    assert phases[("procurement_import", "prepare", "ok")] >= 1
    assert phases[("procurement_import", "session_read", "ok")] == 2


def test_plan_session_starts_at_new_revision_after_earlier_revision_was_imported():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    bundle = {
        "provider": "MUASAMCONG",
        "plan": {"familyNo": "PL2600225773"},
        "revisionPreviews": [
            {
                "revisionId": "rev-00", "revisionNumber": "00",
                "disposition": "ALREADY_IMPORTED",
            },
            {
                "revisionId": "rev-01", "revisionNumber": "01",
                "disposition": "MATERIALIZE",
            },
            {
                "revisionId": "rev-02", "revisionNumber": "02",
                "disposition": "MATERIALIZE",
            },
        ],
        "revisions": [
            {
                "revisionId": "rev-00", "revisionNumber": "00",
                "name": "Kế hoạch 00", "packages": [],
            },
            {
                "revisionId": "rev-01", "revisionNumber": "01",
                "name": "Kế hoạch 01", "packages": [],
            },
            {
                "revisionId": "rev-02", "revisionNumber": "02",
                "name": "Kế hoạch 02", "packages": [],
            },
        ],
    }

    manifest = service.create_from_bundle(
        bundle,
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )

    assert [row["revisionNumber"] for row in manifest["revisions"]] == [
        "01", "02",
    ]
    draft = service.get_revision_draft(
        manifest["sessionId"], "01", organization_id="org-1",
        user_id="user-1", workspace_lease="lease-1",
    )
    assert draft["revisionNumber"] == "01"


def test_procurement_import_phases_are_exposed_as_bounded_prometheus_labels(
    monkeypatch,
):
    reset_recorded_metrics_for_tests()
    for phase in (
        "prepare", "source_fetch", "canonical_normalize", "session_read",
        "investor_resolve", "revision_commit",
    ):
        observability_metrics.record_database_phase(
            "procurement_import", phase, 0.001,
        )
    observability_metrics.record_database_phase(
        "procurement_import", "source_cache", 0, outcome="hit",
    )
    observability_metrics.record_database_phase(
        "procurement_import", "source_cache", 0, outcome="miss",
    )
    monkeypatch.setattr(
        observability_metrics, "_filesystem_metrics",
        lambda: {
            "postgres_database_bytes": 0, "postgres_pool": {},
            "websocket_outbox_rows": 0,
            "websocket_outbox_oldest_seconds": 0,
            "websocket_cluster_active_connections": 0,
            "background_jobs": {}, "partner_upstream_open": {},
            "postgres_stats": {}, "postgres_waiting_locks": 0,
            "postgres_wal_bytes": 0, "disk": {},
            "backup_timestamp": None, "backup_age": None,
            "restore_timestamp": None, "restore_age": None,
        },
    )

    rendered = observability_metrics.render_prometheus()

    for phase in (
        "prepare", "source_fetch", "canonical_normalize", "session_read",
        "investor_resolve", "revision_commit", "source_cache",
    ):
        assert f'phase="{phase}"' in rendered
    assert 'outcome="hit",phase="source_cache"' in rendered
    assert 'outcome="miss",phase="source_cache"' in rendered
    assert "revisionNumber" not in rendered


def test_prepare_existing_family_carries_authoritative_plan_cas_version(tmp_path):
    preview = ProcurementImportPreparer(_source(tmp_path), PreviewStore()).prepare_plan(
        code="PL2600000001", revision_mode="LATEST",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state={"latestPlan": {
            "id": "plan-1", "rootId": "plan-root", "localVersion": 3,
            "rowVersion": 7,
        }},
    )
    assert preview["plan"]["expectedRowVersion"] == 7
    assert preview["plan"]["expectedPredecessor"] == {
        "id": "plan-1", "rootId": "plan-root", "localVersion": 3,
        "rowVersion": 7,
    }
    assert not any(
        item["code"] == "OLDER_REVISIONS_PROVENANCE_ONLY_AFTER_APPLY"
        for item in preview["warnings"]
    )


def test_prepare_reconciles_changed_removed_and_three_way_field_conflicts(tmp_path):
    source = _source(tmp_path)
    source._plans["PL2600000001"]["revisions"][1]["packages"] = [
        {
            **source._plans["PL2600000001"]["revisions"][1]["packages"][0],
            "priceVnd": 1500,
        },
        source._plans["PL2600000001"]["revisions"][1]["packages"][1],
    ]
    local_state = {
        "latestPlan": {"id": "plan-0", "rowVersion": 4},
        "packages": [
            {
                "id": "package-a", "rootId": "root-a", "symbol": "A",
                "localVersion": 0, "rowVersion": 2,
                "sourceFields": {"symbol": "A", "name": "Gói A", "priceVnd": 1000},
                "localFields": {"symbol": "A", "name": "Gói A", "priceVnd": 1200},
            },
            {
                "id": "package-old", "rootId": "root-old", "symbol": "OLD",
                "localVersion": 0, "rowVersion": 1,
                "sourceFields": {"symbol": "OLD", "name": "Gói cũ", "priceVnd": 500},
                "localFields": {"symbol": "OLD", "name": "Gói cũ", "priceVnd": 500},
            },
        ],
    }
    preview = ProcurementImportPreparer(source, PreviewStore()).prepare_plan(
        code="PL2600000001-01", revision_mode="SELECTED",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state=local_state,
    )

    rows = {row["symbol"]: row for row in preview["packages"]}
    assert rows["A"]["action"] == PackageAction.CHANGED.value
    assert rows["A"]["localTarget"] == {
        "rootId": "root-a", "snapshotId": "package-a", "localVersion": 0,
        "rowVersion": 2,
    }
    assert rows["A"]["fieldConflicts"] == [{
        "field": "priceVnd", "baseValue": 1000,
        "localValue": 1200, "sourceValue": 1500,
    }]
    assert rows["B"]["action"] == PackageAction.ADDED.value
    assert rows["OLD"]["action"] == PackageAction.REMOVED.value


def test_prepare_surfaces_ambiguous_exact_symbol_candidates(tmp_path):
    local_state = {
        "latestPlan": {"id": "plan-0", "rowVersion": 1},
        "packages": [
            {"id": "a1", "rootId": "r1", "symbol": "A", "name": "Một"},
            {"id": "a2", "rootId": "r2", "symbol": "A", "name": "Hai"},
        ],
    }
    preview = ProcurementImportPreparer(_source(tmp_path), PreviewStore()).prepare_plan(
        code="PL2600000001-01", revision_mode="SELECTED",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state=local_state,
    )
    row = next(item for item in preview["packages"] if item["symbol"] == "A")
    assert row["action"] == PackageAction.AMBIGUOUS.value
    assert row["matchCandidates"] == [
        {"rootId": "r1", "snapshotId": "a1", "name": "Một", "symbol": "A"},
        {"rootId": "r2", "snapshotId": "a2", "name": "Hai", "symbol": "A"},
    ]
    surface = row["candidateMergeSurfaces"]["r1"]
    assert "effectiveFields" in surface
    assert "baseFields" not in surface
    assert "localFields" not in surface


def test_prepare_enriches_exact_linked_notice_without_creating_another_package(tmp_path):
    source = _source(tmp_path)
    source._notices["IB2600000002"] = {
        "noticeNo": "IB2600000002",
        "revisions": [{
            "revisionId": "notice-rev-01", "revisionNumber": "01",
            "kind": "TBMT", "status": "PUBLISHED",
            "bidClosingAt": "2026-03-15T09:00:00+07:00",
        }],
    }
    preview = ProcurementImportPreparer(source, PreviewStore()).prepare_plan(
        code="PL2600000001-01", revision_mode="SELECTED",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state=None, include_linked_notices=True,
    )
    packages = [row for row in preview["packages"] if row["symbol"] == "B"]
    assert len(packages) == 1
    assert packages[0]["noticeLink"] == {
        "state": "LINKED", "noticeNo": "IB2600000002", "kind": "TBMT",
        "noticeRevisionId": "notice-rev-01", "noticeVersion": "01",
    }
    assert packages[0]["noticeFields"] == {
        "status": "PUBLISHED",
        "bidClosingAt": "2026-03-15T09:00:00+07:00",
    }
    source._notices["IB2600000002"]["revisions"][0]["bidClosingAt"] = (
        "2026-03-16T09:00:00+07:00"
    )
    changed_notice = ProcurementImportPreparer(source, PreviewStore()).prepare_plan(
        code="PL2600000001-01", revision_mode="SELECTED",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state=None, include_linked_notices=True,
    )
    assert (
        changed_notice["revisionPreviews"][0]["revisionDigest"]
        != preview["revisionPreviews"][0]["revisionDigest"]
    )
    assert changed_notice["bundleDigest"] != preview["bundleDigest"]


def test_plan_session_keeps_all_linked_notice_revisions_on_one_package_lineage(tmp_path):
    source = _source(tmp_path)
    source._notices["IB2600000002"] = {
        "noticeNo": "IB2600000002",
        "revisions": [{
            "revisionId": "notice-rev-01", "revisionNumber": "01",
            "kind": "TBMT", "status": "OPENED",
            "bidClosingAt": "2026-03-16T09:00:00+07:00",
        }, {
            "revisionId": "notice-rev-00", "revisionNumber": "00",
            "kind": "TBMT", "status": "PUBLISHED",
            "bidClosingAt": "2026-03-15T09:00:00+07:00",
        }],
    }
    store = PreviewStore()
    preview = ProcurementImportPreparer(source, store).prepare_plan(
        code="PL2600000001-01", revision_mode="SELECTED",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state=None, include_linked_notices=True,
    )
    stored = store.get(
        preview["previewId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1",
    )
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        stored.canonical_bundle,
        organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1",
    )

    draft = service.get_revision_draft(
        manifest["sessionId"], "01",
        organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1",
    )

    history = next(
        row for row in draft["packageRevisionHistories"]
        if row["noticeNo"] == "IB2600000002"
    )
    assert [
        row["sourceRevision"]["packageRevisionNumber"]
        for row in history["revisions"]
    ] == ["00", "01"]
    assert history["revisions"][0]["thoiGianDongThau"] == (
        "2026-03-15T09:00:00+07:00"
    )
    assert history["revisions"][1]["thoiGianDongThau"] == (
        "2026-03-16T09:00:00+07:00"
    )


def test_prepare_standalone_notice_targets_existing_package_without_orphan(tmp_path):
    source = _source(tmp_path)
    source._notices["IB2600000002"] = {
        "noticeNo": "IB2600000002",
        "revisions": [{
            "revisionId": "notice-rev-01", "revisionNumber": "01",
            "kind": "TBMT", "status": "PUBLISHED",
            "bidClosingAt": "2026-03-15T09:00:00+07:00",
        }],
    }
    target = {
        "id": "package-b", "rootId": "root-b", "planSnapshotId": "plan-1",
        "localVersion": 0, "rowVersion": 3, "symbol": "B", "name": "Gói B",
        "sourceFields": {}, "noticeNo": None,
    }
    preview = ProcurementImportPreparer(source, PreviewStore()).prepare_notice(
        code="ib2600000002", revision_mode="LATEST",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        resolve_local_target=lambda notice_no, relationship, target_root_id: (
            target
            if notice_no == "IB2600000002"
            and relationship["planNo"] == "PL2600000001"
            and relationship["planDetailRevisionId"] == "detail-b-01"
            and target_root_id is None
            else None
        ),
    )

    assert preview["importKind"] == "NOTICE"
    assert preview["notice"]["noticeNo"] == "IB2600000002"
    assert preview["notice"]["selectedRevision"] == "01"
    assert preview["notice"]["expectedPackageRowVersion"] == 3
    assert preview["notice"]["targetPackage"] == {
        "rootId": "root-b", "snapshotId": "package-b",
        "planSnapshotId": "plan-1", "localVersion": 0, "rowVersion": 3,
    }
    assert preview["blockingIssues"] == []
    assert preview["previewId"]


def test_prepare_notice_all_keeps_every_revision_in_chronological_order(tmp_path):
    source = _source(tmp_path)
    source._notices["IB2600000002"] = {
        "noticeNo": "IB2600000002",
        "revisions": [{
            "revisionId": "notice-rev-01",
            "revisionNumber": "01",
            "kind": "TBMT",
            "status": "OPENED",
        },
        {
            "revisionId": "notice-rev-00",
            "revisionNumber": "00",
            "kind": "TBMT",
            "status": "PUBLISHED",
        }],
    }
    target = {
        "id": "package-b",
        "rootId": "root-b",
        "planSnapshotId": "plan-1",
        "localVersion": 0,
        "rowVersion": 3,
    }

    preview = ProcurementImportPreparer(source, PreviewStore()).prepare_notice(
        code="IB2600000002",
        revision_mode="ALL",
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
        resolve_local_target=lambda *_args, **_kwargs: target,
    )

    assert preview["notice"]["selectedRevisions"] == ["00", "01"]
    assert [row["revisionNumber"] for row in preview["revisionPreviews"]] == [
        "00",
        "01",
    ]


def test_prepare_notice_all_uses_one_complete_source_collection_and_cached_revisions():
    class CompleteNoticeSource:
        name = "MUASAMCONG"

        def __init__(self):
            self.complete_calls = 0

        def lookup_with_options(
            self, code, kind, *, detail_level, revision_mode, revision_numbers
        ):
            self.complete_calls += 1
            assert (code, kind, detail_level, revision_mode, revision_numbers) == (
                "IB2600000002", "PACKAGE", "COMPLETE", "ALL", [],
            )
            return {
                "canonical": {
                    "revisions": [
                        {
                            "noticeNo": code,
                            "revisionId": "notice-01",
                            "revisionNumber": "01",
                            "planNo": "PL2600000001",
                            "planDetailRevisionId": "detail-b-01",
                            "symbol": "B",
                            "name": "Gói B phiên bản 01",
                        },
                        {
                            "noticeNo": code,
                            "revisionId": "notice-00",
                            "revisionNumber": "00",
                            "planNo": "PL2600000001",
                            "planDetailRevisionId": "detail-b-00",
                            "symbol": "B",
                            "name": "Gói B phiên bản 00",
                        },
                    ],
                },
                "rawBundle": {"schemaVersion": "raw-v2"},
                "metrics": {"cache": {"hit": True}},
            }

        def list_notice_revisions(self, *_args, **_kwargs):
            raise AssertionError("ALL must not issue a separate revision-list request")

        def get_notice_revision(self, *_args, **_kwargs):
            raise AssertionError("prepared revisions must come from the complete bundle")

        def resolve_notice_package(self, *_args, **_kwargs):
            raise AssertionError("relationship must come from each canonical revision")

    reset_recorded_metrics_for_tests()
    source = CompleteNoticeSource()
    resolved_relationships = []
    preview = ProcurementImportPreparer(source, PreviewStore()).prepare_notice(
        code="IB2600000002",
        revision_mode="ALL",
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
        resolve_local_target=lambda _notice, relationship, _root: (
            resolved_relationships.append(relationship)
            or {
                "id": "package-b", "rootId": "package-b",
                "planSnapshotId": "plan-00", "rowVersion": 1,
            }
        ),
    )

    assert source.complete_calls == 1
    assert preview["notice"]["selectedRevisions"] == ["00", "01"]
    assert resolved_relationships == [{
        "planNo": "PL2600000001",
        "planDetailRevisionId": "detail-b-01",
        "stablePackageId": None,
        "symbol": "B",
    }]
    phases = snapshot_recorded_metrics().database_phase_count
    assert phases[("procurement_import", "source_cache", "hit")] == 1


def test_prepare_plan_all_cold_then_warm_uses_raw_cache_and_exact_linked_notice_version():
    class RawCache:
        def __init__(self):
            self.bundles = {}
            self.saved = []

        def load_fresh_plan_bundle(self, organization_id, code, **_options):
            return deepcopy(self.bundles.get((organization_id, "PLAN", code)))

        def load_fresh_notice_bundle(self, organization_id, code, **_options):
            return deepcopy(self.bundles.get((organization_id, "PACKAGE", code)))

        def save_bundle(self, organization_id, bundle):
            kind = (bundle.get("entity") or {}).get("kind")
            code = (bundle.get("entity") or {}).get("canonicalCode")
            self.bundles[(organization_id, kind, code)] = deepcopy(bundle)
            self.saved.append((kind, code))

    class CompleteSource:
        name = "MUASAMCONG"

        def __init__(self):
            self.upstream = []

        @staticmethod
        def _plan_revision():
            return {
                "revisionId": "plan-00", "revisionNumber": "00",
                "name": "Kế hoạch 00", "planType": "Dự toán mua sắm",
                "projectName": "Dự toán A", "investorCode": "INV-1",
                "approvalDecisionNo": "01/QĐ",
                "approvalDecisionDate": "2026-01-01",
                "packages": [{
                    "planDetailRevisionId": "detail-a-00",
                    "stablePackageId": "stable-a", "symbol": "A",
                    "name": "Gói A", "priceVnd": 100,
                    "executionPeriod": "30 ngày", "capitalDetail": "Ngân sách",
                    "selectionDuration": "30 ngày", "selectionStart": "Quý I/2026",
                    "noticeLink": {
                        "state": "LINKED", "noticeNo": "IB2600000002",
                        "kind": "TBMT", "noticeVersion": "00",
                    },
                }],
            }

        @staticmethod
        def _notice_revisions():
            return [{
                "revisionId": "notice-00", "revisionNumber": "00",
                "noticeNo": "IB2600000002", "kind": "TBMT",
                "status": "PUBLISHED", "bidClosingAt": "2026-03-01T09:00:00+07:00",
            }, {
                "revisionId": "notice-01", "revisionNumber": "01",
                "noticeNo": "IB2600000002", "kind": "TBMT",
                "status": "OPENED", "bidClosingAt": "2026-04-01T09:00:00+07:00",
            }]

        def lookup_with_options(
            self, code, kind, *, detail_level, revision_mode, revision_numbers
        ):
            expected_detail = (
                "COMPLETE" if kind == "PLAN" else "INVITATION"
            )
            assert (detail_level, revision_mode, revision_numbers) == (
                expected_detail, "ALL", [],
            )
            self.upstream.append((kind, code))
            revisions = (
                [self._plan_revision()] if kind == "PLAN"
                else self._notice_revisions()
            )
            return {
                "canonical": {"revisions": revisions},
                "rawBundle": {
                    "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
                    "entity": {"kind": kind, "canonicalCode": code},
                },
                "metrics": {"cache": {"hit": False, "layer": "NONE"}},
            }

        def lookup_from_raw_bundle(
            self, code, bundle, *, revision_mode, detail_level
        ):
            assert revision_mode == "ALL"
            kind = (bundle.get("entity") or {}).get("kind")
            assert detail_level == (
                "COMPLETE" if kind == "PLAN" else "INVITATION"
            )
            revisions = (
                [self._plan_revision()] if kind == "PLAN"
                else self._notice_revisions()
            )
            return {
                "canonical": {"revisions": revisions},
                "rawBundle": deepcopy(bundle),
                "metrics": {
                    "cache": {"hit": True, "layer": "RAW_SNAPSHOT"},
                    "upstream": {"requestCount": 0},
                },
            }

        def list_notice_revisions(self, *_args, **_kwargs):
            raise AssertionError("linked notice enrichment must use INVITATION bundle")

        def get_notice_revision(self, *_args, **_kwargs):
            raise AssertionError("linked notice enrichment must use INVITATION bundle")

    reset_recorded_metrics_for_tests()
    source = CompleteSource()
    raw_cache = RawCache()
    preparer = ProcurementImportPreparer(
        source, PreviewStore(), raw_snapshot_repository=raw_cache,
        raw_cache_ttl_seconds=900,
    )
    arguments = {
        "code": "PL2600000001", "revision_mode": "ALL",
        "organization_id": "org-1", "user_id": "user-1",
        "workspace_lease": "lease-1", "local_state": None,
        "include_linked_notices": True,
    }

    cold = preparer.prepare_plan(**arguments)
    warm = preparer.prepare_plan(**arguments)

    assert source.upstream == [
        ("PLAN", "PL2600000001"),
        ("PACKAGE", "IB2600000002"),
    ]
    assert raw_cache.saved == [
        ("PLAN", "PL2600000001"),
        ("PACKAGE", "IB2600000002"),
    ]
    for preview in (cold, warm):
        package = preview["packages"][0]
        assert package["noticeLink"]["noticeVersion"] == "00"
        assert package["effectiveFields"]["noticeFields"]["status"] == "PUBLISHED"
        assert package["effectiveFields"]["noticeFields"]["bidClosingAt"] == (
            "2026-03-01T09:00:00+07:00"
        )
    phases = snapshot_recorded_metrics().database_phase_count
    assert phases[("procurement_import", "source_cache", "miss")] == 2
    assert phases[("procurement_import", "source_cache", "hit")] == 2


def test_plan_linked_notice_uses_invitation_only_source_and_caps_local_projection():
    class InvitationSource:
        name = "MUASAMCONG"

        def __init__(self):
            self.calls = []

        def list_plan_revisions(self, code):
            assert code == "PL2600184109"
            return [{"revisionId": "plan-00", "revisionNumber": "00"}]

        def get_plan_revision(self, code, revision_id):
            assert (code, revision_id) == ("PL2600184109", "plan-00")
            return {
                "revisionId": "plan-00", "revisionNumber": "00",
                "name": "Ke hoach", "planType": "Du an",
                "approvalDecisionNo": "01/QD",
                "approvalDecisionDate": "2026-01-01",
                "packages": [{
                    "planDetailRevisionId": "detail-00", "symbol": "01",
                    "name": "Goi thau", "priceVnd": 1_000,
                    "executionPeriod": "30 ngay", "capitalDetail": "Ngan sach",
                    "selectionDuration": "30 ngay", "selectionStart": "2026-02",
                    "isMultiLot": True,
                    "lots": [{
                        "lotNo": "PP2600000001", "lotName": "Phần 1",
                        "lotPrice": 600,
                    }, {
                        "lotNo": "PP2600000002", "lotName": "Phần 2",
                        "lotPrice": 400,
                    }],
                    "noticeLink": {
                        "state": "LINKED", "noticeNo": "IB2600374868",
                        "kind": "TBMT", "noticeVersion": "00",
                    },
                }],
            }

        def lookup_with_options(
            self, code, kind, *, detail_level, revision_mode, revision_numbers
        ):
            self.calls.append((code, kind, detail_level, revision_mode, revision_numbers))
            return {
                "canonical": {"revisions": [{
                    "noticeNo": code, "kind": "TBMT",
                    "revisionId": "notice-00", "revisionNumber": "00",
                    "status": "OPEN_DXKT", "statusForNotify": "DXT",
                    "publishedAt": "2026-07-16T09:00:00",
                    "bidClosingAt": "2026-08-03T13:00:00",
                    "bidOpeningAt": "2026-08-03T13:00:00",
                    "bidGuaranteeVnd": 52_183_040,
                    "bidValidityDays": 90,
                    "field": "Hàng hóa",
                    "selectionForm": "Đấu thầu rộng rãi",
                    "selectionMode": "Một giai đoạn một túi hồ sơ",
                    "evaluationMethod": "Giá đánh giá",
                    "additionalPurchaseOption": True,
                    "additionalPurchaseItems": [{
                        "sourceItemId": "option-1",
                        "name": "Hàng hóa mua thêm A",
                        "unit": "Hộp",
                        "quantity": 2,
                        "percentage": 10,
                        "estimateValueVnd": 200_000,
                    }],
                    "approvalDecisionNo": "123/QD-E-HSMT",
                    "approvalDecisionDate": "2026-07-15T00:00:00",
                    "lots": [{
                        "lotNo": "PP2600000001", "lotName": "Phần 1",
                        "lotPrice": 600, "bidGuarantee": 12_000_000,
                    }, {
                        "lotNo": "PP2600000002", "lotName": "Phần 2",
                        "lotPrice": 400, "bidGuarantee": 8_000_000,
                    }],
                    "goodsItems": [{
                        "sourceItemId": "1.1", "sourceIndex": "1.1",
                        "lotNo": "PP2600000001", "lotName": "Phần 1",
                        "code": "1.1", "name": "Hàng hóa A",
                        "unit": "Hộp", "quantity": 12,
                        "technicalRequirement": "Yêu cầu A",
                    }],
                }]},
                "metrics": {"cache": {"hit": False}},
            }

    source = InvitationSource()
    preview = ProcurementImportPreparer(source, PreviewStore()).prepare_plan(
        code="PL2600184109", revision_mode="LATEST",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state=None, include_linked_notices=True,
    )

    assert source.calls == [(
        "IB2600374868", "PACKAGE", "INVITATION", "ALL", [],
    )]
    package = preview["packages"][0]
    effective = package["effectiveFields"]
    assert effective["lifecycleStatus"] == "EVALUATING"
    assert effective["bidValidityDays"] == 90
    assert effective["bidGuaranteeVnd"] == 52_183_040
    assert effective["field"] == "Hàng hóa"
    assert effective["selectionForm"] == "Đấu thầu rộng rãi"
    assert effective["selectionMode"] == "Một giai đoạn một túi hồ sơ"
    assert effective["evaluationMethod"] == "Giá đánh giá"
    assert effective["additionalPurchaseOption"] is True
    assert effective["additionalPurchaseItems"][0]["name"] == (
        "Hàng hóa mua thêm A"
    )
    assert effective["approvalDecisionNo"] == "123/QD-E-HSMT"
    assert effective["approvalDecisionDate"] == "2026-07-15T00:00:00"
    assert [lot["bidGuarantee"] for lot in effective["lots"]] == [
        12_000_000, 8_000_000,
    ]
    assert effective["goodsItems"][0]["name"] == "Hàng hóa A"
    assert effective["noticeFields"] == {
        "status": "OPEN_DXKT",
        "statusForNotify": "DXT",
        "publishedAt": "2026-07-16T09:00:00",
        "bidClosingAt": "2026-08-03T13:00:00",
        "bidOpeningAt": "2026-08-03T13:00:00",
        "selectionForm": "Đấu thầu rộng rãi",
        "selectionMode": "Một giai đoạn một túi hồ sơ",
    }
    assert effective["sourceStatus"] == "OPEN_DXKT"
    for field in ("actualOpeningAt", "financialActualOpeningAt", "opening", "result"):
        assert field not in effective
    draft = map_package_canonical_to_draft(
        "MUASAMCONG",
        "PL2600184109",
        {"revisionId": "plan-00", "revisionNumber": "00"},
        {"planDetailRevisionId": "detail-00", "effectiveFields": effective},
    )
    assert draft["trangThai"] == "Đang mời thầu"
    assert draft["linhVuc"] == "Hàng hóa"
    assert draft["hinhThucLuaChon"] == "Đấu thầu rộng rãi"
    assert draft["phuongThucLuaChon"] == "Một giai đoạn một túi hồ sơ"
    assert draft["phuongPhapDanhGia"] == "Giá đánh giá"
    assert draft["tuyChonMuaThem"] is True
    assert draft["tuyChonMuaThemList"][0]["hangMuc"] == (
        "Hàng hóa mua thêm A"
    )
    assert draft["danhSachPhanLo"][0]["bidGuarantee"] == 12_000_000
    assert draft["danhSachHangHoa"][0] == {
        "sourceItemId": "1.1",
        "sourceIndex": "1.1",
        "maPhanLo": "PP2600000001",
        "tenPhanLo": "Phần 1",
        "maHangHoa": "1.1",
        "tenHangHoa": "Hàng hóa A",
        "donViTinh": "Hộp",
        "soLuong": 12,
        "yeuCauKyThuat": "Yêu cầu A",
        "kyMaHieuThamChieu": "",
        "xuatXuYeuCau": "",
        "diaDiemGiaoHang": "",
        "thoiGianGiaoHang": "",
        "ghiChu": "",
    }


def test_non_lot_plan_ignores_synthetic_single_lot_from_linked_notice():
    class NonLotInvitationSource:
        name = "MUASAMCONG"

        def list_plan_revisions(self, code):
            assert code == "PL2600048068"
            return [{"revisionId": "plan-00", "revisionNumber": "00"}]

        def get_plan_revision(self, code, revision_id):
            assert (code, revision_id) == ("PL2600048068", "plan-00")
            return {
                "revisionId": "plan-00",
                "revisionNumber": "00",
                "name": "Mua may giat cong nghiep va may phan tich huyet hoc",
                "planType": "Du toan mua sam",
                "approvalDecisionNo": "88/QD-TTYT",
                "approvalDecisionDate": "2026-03-04",
                "packages": [{
                    "planDetailRevisionId": "detail-00",
                    "stablePackageId": "BP2600113130",
                    "symbol": "BP2600113130",
                    "name": "Mua may giat cong nghiep va may phan tich huyet hoc",
                    "priceVnd": 898_000_000,
                    "executionPeriod": "2 thang",
                    "capitalDetail": "Nguon thu",
                    "selectionDuration": "30 ngay",
                    "selectionStart": "2026-03",
                    "isMultiLot": False,
                    "lots": [],
                    "noticeLink": {
                        "state": "LINKED",
                        "noticeNo": "IB2600082707",
                        "kind": "TBMT",
                        "noticeVersion": "00",
                    },
                }],
            }

        def lookup_with_options(
            self, code, kind, *, detail_level, revision_mode, revision_numbers
        ):
            assert (code, kind, detail_level, revision_mode) == (
                "IB2600082707", "PACKAGE", "INVITATION", "ALL",
            )
            assert revision_numbers == []
            return {
                "canonical": {"revisions": [{
                    "noticeNo": code,
                    "kind": "TBMT",
                    "revisionId": "notice-00",
                    "revisionNumber": "00",
                    "status": "PUB_KQLCNT",
                    "isMultiLot": False,
                    "lots": [{
                        "lotNo": "BP2600113130",
                        "lotName": (
                            "Mua may giat cong nghiep va may phan tich huyet hoc"
                        ),
                        "lotPrice": 898_000_000,
                        "bidGuarantee": 10_000_000,
                    }],
                }]},
                "metrics": {"cache": {"hit": False}},
            }

    preview = ProcurementImportPreparer(
        NonLotInvitationSource(), PreviewStore()
    ).prepare_plan(
        code="PL2600048068",
        revision_mode="LATEST",
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
        local_state=None,
        include_linked_notices=True,
    )

    package = preview["packages"][0]
    effective = package["effectiveFields"]
    assert effective["isMultiLot"] is False
    assert effective["lots"] == []

    draft = map_package_canonical_to_draft(
        "MUASAMCONG",
        "PL2600048068",
        {"revisionId": "plan-00", "revisionNumber": "00"},
        {"planDetailRevisionId": "detail-00", "effectiveFields": effective},
    )
    assert draft["phanLo"] is False
    assert draft["danhSachPhanLo"] == []


def test_prepare_all_orders_revisions_numerically_even_when_provider_is_unsorted(tmp_path):
    preview = ProcurementImportPreparer(_source(tmp_path), PreviewStore()).prepare_plan(
        code="PL2600000001",
        revision_mode="ALL",
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
        local_state=None,
    )
    assert [row["revisionNumber"] for row in preview["revisionPreviews"]] == ["00", "01"]
    assert preview["plan"]["selectedRevisions"] == ["00", "01"]
    assert [row["symbol"] for row in preview["packages"]] == ["A", "B"]


def test_prepare_all_validates_required_fields_in_every_revision(tmp_path):
    source = _source(tmp_path)
    source._plans["PL2600000001"]["revisions"][0]["packages"][0]["capitalDetail"] = ""
    preview = ProcurementImportPreparer(source, PreviewStore()).prepare_plan(
        code="PL2600000001", revision_mode="ALL",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state=None,
    )
    issue = next(
        item for item in preview["blockingIssues"]
        if item["field"] == RequiredFieldIssue.CAPITAL.value
    )
    assert issue["sourceRevisionNumber"] == "00"
    assert issue["sourceRevisionId"] == "rev-00"


def test_prepare_all_does_not_block_provenance_only_older_revisions(tmp_path):
    source = _source(tmp_path)
    source._plans["PL2600000001"]["revisions"][0]["packages"][0]["capitalDetail"] = ""
    preview = ProcurementImportPreparer(source, PreviewStore()).prepare_plan(
        code="PL2600000001", revision_mode="ALL",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state={
            "latestPlan": {"id": "plan-3", "rowVersion": 1},
            "packages": [],
            "latestAppliedExternalRevision": "01",
            "observedRevisions": {
                "rev-01": {"revisionNumber": "01", "disposition": "APPLIED"},
            },
        },
    )
    assert preview["blockingIssues"] == []
    assert preview["revisionPreviews"] == [
        {
            "revisionId": "rev-00", "revisionNumber": "00",
            "revisionDigest": preview["revisionPreviews"][0]["revisionDigest"],
            "disposition": "PROVENANCE_ONLY",
        },
        {
            "revisionId": "rev-01", "revisionNumber": "01",
            "revisionDigest": preview["revisionPreviews"][1]["revisionDigest"],
            "disposition": "ALREADY_IMPORTED",
        },
    ]


def test_prepare_blocks_missing_required_package_fields(tmp_path):
    source = _source(tmp_path)
    source._plans["PL2600000001"]["revisions"][1]["packages"][0]["capitalDetail"] = ""
    preview = ProcurementImportPreparer(source, PreviewStore()).prepare_plan(
        code="PL2600000001-01", revision_mode="SELECTED",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state=None,
    )
    assert RequiredFieldIssue.CAPITAL.value in {
        issue["field"] for issue in preview["blockingIssues"]
    }


def test_preview_scope_and_expiry_are_enforced(tmp_path):
    store = PreviewStore(ttl_seconds=1)
    preview = ProcurementImportPreparer(_source(tmp_path), store).prepare_plan(
        code="PL2600000001", revision_mode="LATEST",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state=None,
    )
    with pytest.raises(PermissionError, match="PROCUREMENT_PREVIEW_SCOPE_INVALID"):
        store.get(preview["previewId"], organization_id="org-2", user_id="user-1", workspace_lease="lease-1")
    with pytest.raises(LookupError, match="PROCUREMENT_PREVIEW_EXPIRED"):
        store.get(
            preview["previewId"], organization_id="org-1", user_id="user-1",
            workspace_lease="lease-1", now=datetime(2100, 1, 1, tzinfo=timezone.utc),
        )


def test_three_way_merge_preserves_local_edits_and_surfaces_true_conflict():
    assert three_way_merge_field("old", "old", "new") == ("new", "APPLY_SOURCE")
    assert three_way_merge_field("old", "local", "old") == ("local", "KEEP_LOCAL")
    assert three_way_merge_field("old", "local", "source") == ("local", "CONFLICT")
    assert three_way_merge_field(
        "old", "local", "source", source_owned=False
    ) == ("local", "KEEP_LOCAL")


class _MemorySessionRepository:
    def __init__(self):
        self.rows = {}
        self.package_lineages = []

    def create(self, row):
        self.rows[row["id"]] = row
        return row

    def get_scoped(self, session_id, *, organization_id, user_id, workspace_lease):
        row = self.rows.get(session_id)
        if row is None:
            return None
        if (
            row["organizationId"] != organization_id
            or row["userId"] != user_id
            or row["workspaceLease"] != workspace_lease
        ):
            raise PermissionError("PROCUREMENT_SESSION_SCOPE_INVALID")
        return row

    def update_progress(self, session_id, *, current_index, status):
        self.rows[session_id]["currentIndex"] = current_index
        self.rows[session_id]["status"] = status

    def bind_decision_authority(
        self, session_id, *, organization_id, user_id, workspace_lease,
        bundle_digest, authority,
    ):
        row = self.get_scoped(
            session_id, organization_id=organization_id, user_id=user_id,
            workspace_lease=workspace_lease,
        )
        if row["bundleDigest"] != bundle_digest:
            raise ImportConflict("PROCUREMENT_PREVIEW_STALE")
        existing = row["canonicalBundle"].get("decisionAuthority") or {}
        if existing:
            if existing.get("decisionsDigest") != authority.get("decisionsDigest"):
                raise ImportConflict("PROCUREMENT_DECISIONS_LOCKED")
            return row
        if row["currentIndex"] != 0:
            raise ImportConflict("PROCUREMENT_DECISIONS_LOCKED")
        row["canonicalBundle"]["decisionAuthority"] = deepcopy(authority)
        return row

    def find_active_package_lineages(
        self, organization_id, provider, family_key,
    ):
        return deepcopy(self.package_lineages)


def test_import_session_orders_manifest_and_serves_revision_draft_without_source():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository, ttl_seconds=3600)
    bundle = {
        "provider": "MUASAMCONG",
        "plan": {"familyNo": "PL2600000001"},
        "revisions": [
            {
                "revisionId": "rev-02", "revisionNumber": "02",
                "name": "Kế hoạch 02", "planType": "Dự án",
                "packages": [],
            },
            {
                "revisionId": "rev-00", "revisionNumber": "00",
                "name": "Kế hoạch 00", "planType": "Dự án",
                "packages": [{
                    "planDetailRevisionId": "detail-a", "symbol": "A",
                    "name": "Gói A", "priceVnd": 100,
                    "selectionStart": "2026-01", "selectionDuration": "30 ngày",
                    "executionPeriod": "60 ngày", "capitalDetail": "Ngân sách",
                }],
            },
            {
                "revisionId": "rev-01", "revisionNumber": "01",
                "name": "Kế hoạch 01", "planType": "Dự án",
                "packages": [],
            },
        ],
    }

    manifest = service.create_from_bundle(
        bundle,
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
    )
    assert [row["revisionNumber"] for row in manifest["revisions"]] == [
        "00", "01", "02",
    ]

    draft = service.get_revision_draft(
        manifest["sessionId"], "00",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    assert draft["revisionNumber"] == "00"
    assert draft["planDraft"]["maKeHoach"] == "PL2600000001"
    assert draft["planDraft"]["phienBan"] == "00"
    assert draft["packageDrafts"][0]["tenGoiThau"] == "Gói A"
    assert draft["packageDrafts"][0]["sourceRevision"]["revisionId"] == "rev-00"
    assert draft["packageDrafts"][0]["sourceRevision"]["workspaceLease"] == "lease-1"
    assert "sourceCanonical" not in draft["packageDrafts"][0]


def test_session_revision_draft_uses_reconciliation_effective_fields():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository, ttl_seconds=3600)
    manifest = service.create_from_bundle(
        {
            "provider": "MUASAMCONG",
            "plan": {"familyNo": "PL2600000001"},
            "revisions": [{
                "revisionId": "rev-00",
                "revisionNumber": "00",
                "name": "Kế hoạch 00",
                "packages": [{
                    "planDetailRevisionId": "detail-a",
                    "symbol": "A",
                    "name": "Gói A",
                    "priceVnd": 100,
                    "executionPeriod": "30 ngày",
                    "capitalDetail": "Ngân sách",
                    "selectionDuration": "30 ngày",
                    "selectionStart": "2026-01",
                }],
            }],
            "reconciliationByRevision": {
                "rev-00": [{
                    "planDetailRevisionId": "detail-a",
                    "action": "UNCHANGED",
                    "effectiveFields": {
                        "symbol": "A",
                        "name": "Gói A",
                        "priceVnd": 120,
                        "executionPeriod": "30 ngày",
                        "capitalDetail": "Ngân sách",
                        "selectionDuration": "30 ngày",
                        "selectionStart": "2026-01",
                    },
                    "fieldConflicts": [],
                }],
            },
        },
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
    )

    draft = service.get_revision_draft(
        manifest["sessionId"],
        "00",
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
    )

    assert draft["packageDrafts"][0]["giaGoiThau"] == 120


def _sequential_decision_bundle(*, conflict=False, required_field=False):
    package = {
        "planDetailRevisionId": "detail-a", "symbol": "A", "name": "Gói A",
        "priceVnd": 130, "executionPeriod": "30 ngày",
        "capitalDetail": "" if required_field else "Ngân sách",
        "selectionDuration": "30 ngày", "selectionStart": "2026-01",
    }
    effective = {**package, "priceVnd": 120}
    return {
        "provider": "MUASAMCONG",
        "plan": {"familyNo": "PL2600000001"},
        "revisions": [{
            "revisionId": "rev-00", "revisionNumber": "00",
            "name": "Kế hoạch 00", "packages": [package],
        }],
        "reconciliationByRevision": {"rev-00": [{
            **package,
            "action": "CHANGED",
            "localTarget": {
                "rootId": "root-a", "snapshotId": "snapshot-a",
                "localVersion": 1, "rowVersion": 7,
            },
            "effectiveFields": effective,
            "fieldConflicts": ([{
                "field": "priceVnd", "baseValue": 100,
                "localValue": 120, "sourceValue": 130,
            }] if conflict else []),
        }]},
    }


@pytest.mark.parametrize(
    ("resolution", "expected"),
    [("KEEP_LOCAL", 120), ("APPLY_SOURCE", 130)],
    ids=[
        "sequential_plan_keep_local_conflict_preserves_local_value",
        "sequential_plan_apply_source_conflict_uses_source_value",
    ],
)
def test_sequential_plan_conflict_decision_reaches_revision_draft(
    resolution, expected,
):
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        _sequential_decision_bundle(conflict=True),
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    service.bind_plan_decisions(
        manifest["sessionId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
        decisions={
            "investorId": "investor-1", "packageMatches": [],
            "fieldValues": [], "fieldConflicts": [{
                "packageObservationId": "detail-a", "field": "priceVnd",
                "resolution": resolution,
            }],
        },
    )
    draft = service.get_revision_draft(
        manifest["sessionId"], "00", organization_id="org-1",
        user_id="user-1", workspace_lease="lease-1",
    )
    assert draft["packageDrafts"][0]["giaGoiThau"] == expected


def test_sequential_plan_unresolved_conflict_cannot_start():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        _sequential_decision_bundle(conflict=True),
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    with pytest.raises(ProcurementDecisionError, match="PROCUREMENT_FIELD_CONFLICT"):
        service.bind_plan_decisions(
            manifest["sessionId"], organization_id="org-1", user_id="user-1",
            workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
            decisions={"investorId": "investor-1"},
        )


def test_sequential_plan_required_field_override_reaches_revision_draft():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        _sequential_decision_bundle(required_field=True),
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    service.bind_plan_decisions(
        manifest["sessionId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
        decisions={
            "investorId": "investor-1", "packageMatches": [],
            "fieldConflicts": [], "fieldValues": [{
                "packageObservationId": "detail-a", "field": "capitalDetail",
                "value": "Vốn hợp lệ",
            }],
        },
    )
    draft = service.get_revision_draft(
        manifest["sessionId"], "00", organization_id="org-1",
        user_id="user-1", workspace_lease="lease-1",
    )
    assert draft["packageDrafts"][0]["nguonVon"] == "Vốn hợp lệ"


def test_sequential_plan_ambiguous_match_uses_selected_local_root():
    bundle = _sequential_decision_bundle()
    row = bundle["reconciliationByRevision"]["rev-00"][0]
    row.pop("localTarget", None)
    row["action"] = "AMBIGUOUS"
    row.pop("effectiveFields", None)
    row["matchCandidates"] = [
        {"rootId": "root-a", "snapshotId": "snapshot-a", "localVersion": 1, "rowVersion": 3},
        {"rootId": "root-b", "snapshotId": "snapshot-b", "localVersion": 2, "rowVersion": 5},
    ]
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        bundle, organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    service.bind_plan_decisions(
        manifest["sessionId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
        decisions={
            "investorId": "investor-1", "fieldValues": [], "fieldConflicts": [],
            "packageMatches": [{
                "packageObservationId": "detail-a", "localRootId": "root-b",
            }],
        },
    )
    draft = service.get_revision_draft(
        manifest["sessionId"], "00", organization_id="org-1",
        user_id="user-1", workspace_lease="lease-1",
    )
    assert draft["packageDrafts"][0]["sourceRevision"]["localRootId"] == "root-b"


def _ambiguous_candidate_bundle(*, base=None, local=None, source=None):
    bundle = _sequential_decision_bundle()
    source_fields = {
        **bundle["revisions"][0]["packages"][0],
        **(source or {}),
    }
    bundle["revisions"][0]["packages"][0] = source_fields
    row = bundle["reconciliationByRevision"]["rev-00"][0]
    row.clear()
    row.update({
        **source_fields,
        "action": "AMBIGUOUS",
        "matchCandidates": [{
            "rootId": "root-b",
            "snapshotId": "snapshot-b",
            "localVersion": 2,
            "rowVersion": 5,
            "baseFields": {**source_fields, **(base or {})},
            "localFields": {**source_fields, **(local or {})},
        }],
    })
    return bundle


def _bind_ambiguous_candidate(bundle, *, field_conflicts=None, field_values=None):
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        bundle, organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    service.bind_plan_decisions(
        manifest["sessionId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
        decisions={
            "investorId": "investor-1",
            "packageMatches": [{
                "revisionId": "rev-00",
                "packageObservationId": "detail-a",
                "localRootId": "root-b",
            }],
            "fieldConflicts": field_conflicts or [],
            "fieldValues": field_values or [],
        },
    )
    return service.get_revision_draft(
        manifest["sessionId"], "00", organization_id="org-1",
        user_id="user-1", workspace_lease="lease-1",
    )


def test_ambiguous_selected_candidate_local_only_change_survives():
    draft = _bind_ambiguous_candidate(_ambiguous_candidate_bundle(
        base={"capitalDetail": "A"},
        local={"capitalDetail": "B"},
        source={"capitalDetail": "A"},
    ))
    assert draft["packageDrafts"][0]["nguonVon"] == "B"


def test_ambiguous_selected_candidate_source_only_change_applies():
    draft = _bind_ambiguous_candidate(_ambiguous_candidate_bundle(
        base={"priceVnd": 100},
        local={"priceVnd": 100},
        source={"priceVnd": 130},
    ))
    assert draft["packageDrafts"][0]["giaGoiThau"] == 130


def test_ambiguous_selected_candidate_conflict_requires_resolution():
    bundle = _ambiguous_candidate_bundle(
        base={"priceVnd": 100},
        local={"priceVnd": 120},
        source={"priceVnd": 130},
    )
    with pytest.raises(ProcurementDecisionError, match="PROCUREMENT_FIELD_CONFLICT"):
        _bind_ambiguous_candidate(bundle)


@pytest.mark.parametrize(
    ("resolution", "expected"),
    [("KEEP_LOCAL", 120), ("APPLY_SOURCE", 130)],
    ids=[
        "ambiguous_selected_candidate_KEEP_LOCAL_preserves_local",
        "ambiguous_selected_candidate_APPLY_SOURCE_uses_source",
    ],
)
def test_ambiguous_selected_candidate_conflict_resolution(resolution, expected):
    bundle = _ambiguous_candidate_bundle(
        base={"priceVnd": 100},
        local={"priceVnd": 120},
        source={"priceVnd": 130},
    )
    draft = _bind_ambiguous_candidate(bundle, field_conflicts=[{
        "revisionId": "rev-00",
        "packageObservationId": "detail-a",
        "localRootId": "root-b",
        "field": "priceVnd",
        "resolution": resolution,
    }])
    assert draft["packageDrafts"][0]["giaGoiThau"] == expected


def test_ambiguous_selected_candidate_required_local_value_prevents_false_missing_issue():
    draft = _bind_ambiguous_candidate(_ambiguous_candidate_bundle(
        base={"capitalDetail": ""},
        local={"capitalDetail": "Ngân sách"},
        source={"capitalDetail": ""},
    ))
    assert draft["packageDrafts"][0]["nguonVon"] == "Ngân sách"


def test_source_missing_required_but_local_effective_value_does_not_block():
    draft = _bind_ambiguous_candidate(_ambiguous_candidate_bundle(
        base={"capitalDetail": ""},
        local={"capitalDetail": "Ngân sách"},
        source={"capitalDetail": ""},
    ))
    assert draft["packageDrafts"][0]["nguonVon"] == "Ngân sách"


def test_source_missing_required_and_local_missing_does_block():
    with pytest.raises(
        ProcurementDecisionError, match="PROCUREMENT_REQUIRED_FIELDS_MISSING",
    ):
        _bind_ambiguous_candidate(_ambiguous_candidate_bundle(
            base={"capitalDetail": ""},
            local={"capitalDetail": ""},
            source={"capitalDetail": ""},
        ))


def test_KEEP_LOCAL_value_satisfies_required_field():
    draft = _bind_ambiguous_candidate(
        _ambiguous_candidate_bundle(
            base={"capitalDetail": "Ban đầu"},
            local={"capitalDetail": "Ngân sách"},
            source={"capitalDetail": ""},
        ),
        field_conflicts=[{
            "revisionId": "rev-00",
            "packageObservationId": "detail-a",
            "localRootId": "root-b",
            "field": "capitalDetail",
            "resolution": "KEEP_LOCAL",
        }],
    )
    assert draft["packageDrafts"][0]["nguonVon"] == "Ngân sách"


def test_APPLY_SOURCE_empty_value_still_requires_resolution_if_required():
    with pytest.raises(
        ProcurementDecisionError, match="PROCUREMENT_REQUIRED_FIELDS_MISSING",
    ):
        _bind_ambiguous_candidate(
            _ambiguous_candidate_bundle(
                base={"capitalDetail": "Ban đầu"},
                local={"capitalDetail": "Ngân sách"},
                source={"capitalDetail": ""},
            ),
            field_conflicts=[{
                "revisionId": "rev-00",
                "packageObservationId": "detail-a",
                "localRootId": "root-b",
                "field": "capitalDetail",
                "resolution": "APPLY_SOURCE",
            }],
        )


def test_fieldValue_override_satisfies_required_field():
    draft = _bind_ambiguous_candidate(
        _ambiguous_candidate_bundle(
            base={"capitalDetail": ""},
            local={"capitalDetail": ""},
            source={"capitalDetail": ""},
        ),
        field_values=[{
            "revisionId": "rev-00",
            "packageObservationId": "detail-a",
            "localRootId": "root-b",
            "field": "capitalDetail",
            "value": "Ngân sách",
        }],
    )
    assert draft["packageDrafts"][0]["nguonVon"] == "Ngân sách"


def test_required_validation_runs_on_final_resolved_package_not_raw_source():
    draft = _bind_ambiguous_candidate(_ambiguous_candidate_bundle(
        base={"capitalDetail": ""},
        local={"capitalDetail": "Vốn hợp lệ cuối cùng"},
        source={"capitalDetail": ""},
    ))
    assert draft["packageDrafts"][0]["nguonVon"] == "Vốn hợp lệ cuối cùng"


def test_ambiguous_new_package_uses_source_without_local_merge():
    bundle = _ambiguous_candidate_bundle(source={"priceVnd": 130})
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        bundle, organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    service.bind_plan_decisions(
        manifest["sessionId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
        decisions={
            "investorId": "investor-1",
            "packageMatches": [{
                "revisionId": "rev-00", "packageObservationId": "detail-a",
                "new": True,
            }],
        },
    )
    draft = service.get_revision_draft(
        manifest["sessionId"], "00", organization_id="org-1",
        user_id="user-1", workspace_lease="lease-1",
    )
    assert draft["packageDrafts"][0]["giaGoiThau"] == 130
    assert "localRootId" not in draft["packageDrafts"][0]["sourceRevision"]


def test_ambiguous_candidate_change_invalidates_previous_conflict_decisions():
    bundle = _ambiguous_candidate_bundle(
        base={"priceVnd": 100}, local={"priceVnd": 100}, source={"priceVnd": 130},
    )
    bundle["reconciliationByRevision"]["rev-00"][0]["fieldConflicts"] = [{
        "localRootId": "root-a", "field": "priceVnd",
        "baseValue": 100, "localValue": 120, "sourceValue": 130,
    }]
    with pytest.raises(ProcurementDecisionError, match="PROCUREMENT_DECISION_INVALID"):
        _bind_ambiguous_candidate(bundle, field_conflicts=[{
            "revisionId": "rev-00",
            "packageObservationId": "detail-a",
            "localRootId": "root-a",
            "field": "priceVnd",
            "resolution": "KEEP_LOCAL",
        }])


def test_sequential_plan_invalid_ambiguous_target_is_rejected():
    bundle = _sequential_decision_bundle()
    row = bundle["reconciliationByRevision"]["rev-00"][0]
    row["action"] = "AMBIGUOUS"
    row.pop("effectiveFields", None)
    row.pop("localTarget", None)
    row["matchCandidates"] = [{"rootId": "root-a"}]
    service = ProcurementImportSessionService(_MemorySessionRepository())
    manifest = service.create_from_bundle(
        bundle, organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    with pytest.raises(ProcurementDecisionError, match="PROCUREMENT_MATCH_DECISION_INVALID"):
        service.bind_plan_decisions(
            manifest["sessionId"], organization_id="org-1", user_id="user-1",
            workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
            decisions={"packageMatches": [{
                "packageObservationId": "detail-a", "localRootId": "foreign-root",
            }]},
        )


def test_session_decisions_are_bound_to_exact_bundle_digest_and_are_immutable():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        _sequential_decision_bundle(),
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    with pytest.raises(ProcurementDecisionError, match="PROCUREMENT_PREVIEW_STALE"):
        service.bind_plan_decisions(
            manifest["sessionId"], organization_id="org-1", user_id="user-1",
            workspace_lease="lease-1", bundle_digest="sha256:" + "0" * 64,
            decisions={"investorId": "investor-1"},
        )
    first = service.bind_plan_decisions(
        manifest["sessionId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
        decisions={"investorId": "investor-1"},
    )
    retry = service.bind_plan_decisions(
        manifest["sessionId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
        decisions={"investorId": "investor-1"},
    )
    assert retry["decisionAuthority"] == first["decisionAuthority"]
    with pytest.raises(ImportConflict, match="PROCUREMENT_DECISIONS_LOCKED"):
        service.bind_plan_decisions(
            manifest["sessionId"], organization_id="org-1", user_id="user-1",
            workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
            decisions={"investorId": "investor-2"},
        )


def test_plan_session_cannot_materialize_before_decision_authority_is_bound():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    bundle = _sequential_decision_bundle()
    bundle["decisionBindingRequired"] = True
    manifest = service.create_from_bundle(
        bundle, organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    with pytest.raises(ProcurementDecisionError, match="PROCUREMENT_DECISIONS_REQUIRED"):
        service.get_revision_draft(
            manifest["sessionId"], "00", organization_id="org-1",
            user_id="user-1", workspace_lease="lease-1",
        )


def test_sequential_plan_selected_investor_is_exactly_used_and_resumed():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        _sequential_decision_bundle(),
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    service.bind_plan_decisions(
        manifest["sessionId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
        decisions={"investorId": "investor-b"},
    )
    first = service.get_revision_draft(
        manifest["sessionId"], "00", organization_id="org-1",
        user_id="user-1", workspace_lease="lease-1",
    )
    resumed = ProcurementImportSessionService(repository).get_revision_draft(
        manifest["sessionId"], "00", organization_id="org-1",
        user_id="user-1", workspace_lease="lease-1",
    )
    assert first["planDraft"]["chuDauTuId"] == "investor-b"
    assert resumed["decisionAuthority"] == first["decisionAuthority"]


def test_sequential_plan_invalid_selected_investor_is_rejected():
    service = ProcurementImportSessionService(_MemorySessionRepository())
    manifest = service.create_from_bundle(
        _sequential_decision_bundle(),
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    with pytest.raises(ProcurementDecisionError, match="INVESTOR_INVALID"):
        service.bind_plan_decisions(
            manifest["sessionId"], organization_id="org-1", user_id="user-1",
            workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
            decisions={"investorId": "investor-missing"},
            validate_investor=lambda _value: (_ for _ in ()).throw(
                ProcurementDecisionError(
                    "PROCUREMENT_INVESTOR_INVALID", "Investor không hợp lệ.", 422,
                )
            ),
        )


def test_sequential_plan_foreign_workspace_investor_is_rejected():
    service = ProcurementImportSessionService(_MemorySessionRepository())
    manifest = service.create_from_bundle(
        _sequential_decision_bundle(),
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    with pytest.raises(ProcurementDecisionError, match="INVESTOR_INVALID"):
        service.bind_plan_decisions(
            manifest["sessionId"], organization_id="org-1", user_id="user-1",
            workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
            decisions={"investorId": "investor-org-2"},
            validate_investor=lambda _value: (_ for _ in ()).throw(
                ProcurementDecisionError(
                    "PROCUREMENT_INVESTOR_INVALID", "Investor khác workspace.", 422,
                )
            ),
        )


def test_plan_predecessor_cas_is_checked_before_decision_binding():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    bundle = _sequential_decision_bundle()
    bundle["plan"]["expectedPredecessor"] = {
        "id": "plan-3", "rootId": "plan-root", "localVersion": 3,
        "rowVersion": 7,
    }
    manifest = service.create_from_bundle(
        bundle, organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    with pytest.raises(ProcurementDecisionError, match="PROCUREMENT_PREVIEW_STALE"):
        service.bind_plan_decisions(
            manifest["sessionId"], organization_id="org-1", user_id="user-1",
            workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
            decisions={"investorId": "investor-1"},
            validate_plan_authority=lambda _expected: (_ for _ in ()).throw(
                ProcurementDecisionError(
                    "PROCUREMENT_PREVIEW_STALE", "Kế hoạch đã thay đổi.", 409,
                )
            ),
        )


def test_plan_predecessor_cas_is_rechecked_before_revision_materialization():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    bundle = _sequential_decision_bundle()
    bundle["plan"]["expectedPredecessor"] = {
        "id": "plan-3", "rootId": "plan-root", "localVersion": 3,
        "rowVersion": 7,
    }
    manifest = service.create_from_bundle(
        bundle, organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    service.bind_plan_decisions(
        manifest["sessionId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
        decisions={"investorId": "investor-1"},
    )
    with pytest.raises(ProcurementDecisionError, match="PROCUREMENT_PREVIEW_STALE"):
        service.get_revision_draft(
            manifest["sessionId"], "00", organization_id="org-1",
            user_id="user-1", workspace_lease="lease-1",
            validate_plan_authority=lambda _expected: (_ for _ in ()).throw(
                ProcurementDecisionError(
                    "PROCUREMENT_PREVIEW_STALE", "Kế hoạch đã thay đổi.", 409,
                )
            ),
        )


def test_package_changes_after_decision_bind_before_revision_draft_is_rejected():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        _sequential_decision_bundle(),
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    service.bind_plan_decisions(
        manifest["sessionId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
        decisions={"investorId": "investor-1"},
    )
    checked = []

    def reject_changed_target(target):
        checked.append(target)
        raise ProcurementDecisionError(
            "PROCUREMENT_PREVIEW_STALE", "Gói thầu đã thay đổi.", 409,
        )

    with pytest.raises(ProcurementDecisionError, match="PROCUREMENT_PREVIEW_STALE"):
        service.get_revision_draft(
            manifest["sessionId"], "00", organization_id="org-1",
            user_id="user-1", workspace_lease="lease-1",
            validate_local_target=reject_changed_target,
        )
    assert checked == [{
        "localRootId": "root-a", "snapshotId": "snapshot-a",
        "localVersion": 1, "rowVersion": 7, "isLatest": True,
    }]


def test_session_public_decision_surface_excludes_skipped_revisions():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    bundle = _sequential_decision_bundle()
    bundle["revisions"].append({
        "revisionId": "rev-01", "revisionNumber": "01", "packages": [],
    })
    bundle["revisionPreviews"] = [
        {"revisionId": "rev-00", "revisionNumber": "00", "disposition": "ALREADY_IMPORTED"},
        {"revisionId": "rev-01", "revisionNumber": "01", "disposition": "MATERIALIZE"},
    ]
    bundle["decisionPackages"] = [
        {"sourceRevisionId": "rev-00", "planDetailRevisionId": "old-detail", "action": "AMBIGUOUS"},
        {"sourceRevisionId": "rev-01", "planDetailRevisionId": "active-detail", "action": "AMBIGUOUS"},
    ]
    bundle["blockingIssues"] = [
        {"sourceRevisionId": "rev-00", "packageObservationId": "old-detail", "field": "name"},
        {"sourceRevisionId": "rev-01", "packageObservationId": "active-detail", "field": "name"},
    ]
    manifest = service.create_from_bundle(
        bundle, organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    assert [row["sourceRevisionId"] for row in manifest["decisionPackages"]] == ["rev-01"]
    assert [row["sourceRevisionId"] for row in manifest["blockingIssues"]] == ["rev-01"]
    assert [row["revisionId"] for row in manifest["revisions"]] == ["rev-01"]


def test_resync_required_field_is_public_and_must_be_resolved():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    bundle = _sequential_decision_bundle(required_field=True)
    bundle["revisionPreviews"] = [{
        "revisionId": "rev-00", "revisionNumber": "00", "disposition": "RESYNC",
    }]
    bundle["blockingIssues"] = [{
        "sourceRevisionId": "rev-00", "packageObservationId": "detail-a",
        "field": "capitalDetail", "code": "PROCUREMENT_REQUIRED_FIELDS_MISSING",
    }]
    manifest = service.create_from_bundle(
        bundle, organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    assert manifest["blockingIssues"][0]["field"] == "capitalDetail"
    with pytest.raises(ProcurementDecisionError, match="PROCUREMENT_REQUIRED_FIELDS_MISSING"):
        service.bind_plan_decisions(
            manifest["sessionId"], organization_id="org-1", user_id="user-1",
            workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
            decisions={"investorId": "investor-1"},
        )


def test_same_observation_id_across_revisions_is_scoped_by_revision_id():
    bundle = _sequential_decision_bundle()
    first = bundle["revisions"][0]
    second = deepcopy(first)
    second["revisionId"] = "rev-01"
    second["revisionNumber"] = "01"
    bundle["revisions"].append(second)
    bundle["reconciliationByRevision"]["rev-01"] = [{
        **bundle["reconciliationByRevision"]["rev-00"][0],
        "action": "AMBIGUOUS", "matchCandidates": [{"rootId": "root-b"}],
    }]
    bundle["reconciliationByRevision"]["rev-00"][0]["action"] = "AMBIGUOUS"
    bundle["reconciliationByRevision"]["rev-00"][0]["matchCandidates"] = [{"rootId": "root-a"}]
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        bundle, organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    authority = service.bind_plan_decisions(
        manifest["sessionId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", bundle_digest=manifest["bundleDigest"],
        decisions={
            "investorId": "investor-1", "fieldValues": [], "fieldConflicts": [],
            "packageMatches": [{
                "revisionId": "rev-00", "packageObservationId": "detail-a",
                "localRootId": "root-a",
            }, {
                "revisionId": "rev-01", "packageObservationId": "detail-a",
                "localRootId": "root-b",
            }],
        },
    )
    assert authority["decisionAuthority"]["status"] == "BOUND"


def test_next_session_draft_carries_the_active_local_package_root():
    repository = _MemorySessionRepository()
    repository.package_lineages = [{
        "stablePackageId": "BP2600546627",
        "symbol": "BP2600546627",
        "localRootId": "pkg-01-root",
    }]
    service = ProcurementImportSessionService(repository, ttl_seconds=3600)
    manifest = service.create_from_bundle(
        {
            "provider": "MUASAMCONG",
            "plan": {"familyNo": "PL2600219933"},
            "revisions": [{
                "revisionId": "rev-01", "revisionNumber": "01",
                "name": "Kế hoạch 01", "planType": "Dự toán mua sắm",
                "packages": [{
                    "planDetailRevisionId": "detail-01",
                    "stablePackageId": "BP2600546627",
                    "symbol": "BP2600546627",
                    "name": "Gói thầu số 01",
                    "priceVnd": 100,
                    "executionPeriod": "30 ngày",
                    "capitalDetail": "Ngân sách",
                    "selectionDuration": "30 ngày",
                    "selectionStart": "2026-01",
                }],
            }],
        },
        organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1",
    )

    package = service.get_revision_draft(
        manifest["sessionId"], "01",
        organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1",
    )["packageDrafts"][0]

    assert package["sourceRevision"]["localRootId"] == "pkg-01-root"


def test_pending_plan_enrichment_cannot_serve_an_incomplete_revision_draft():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository, ttl_seconds=3600)
    manifest = service.create_from_bundle(
        {
            "provider": "MUASAMCONG",
            "plan": {"familyNo": "PL2600000001"},
            "enrichmentStatus": "PENDING",
            "revisions": [{
                "revisionId": "plan-00",
                "revisionNumber": "00",
                "name": "Kế hoạch 00",
                "packages": [{
                    "planDetailRevisionId": "detail-1",
                    "name": "Mua máy giặt công nghiệp và máy phân tích huyết học",
                    "noticeLink": {
                        "state": "LINKED",
                        "noticeNo": "IB2600082707",
                        "noticeVersion": "00",
                    },
                }],
            }],
        },
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
    )

    with pytest.raises(LookupError, match="PROCUREMENT_ENRICHMENT_PENDING"):
        service.get_revision_draft(
            manifest["sessionId"],
            "00",
            organization_id="org-1",
            user_id="user-1",
            workspace_lease="lease-1",
        )


def test_completed_plan_enrichment_serves_full_invitation_package_data():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository, ttl_seconds=3600)
    manifest = service.create_from_bundle(
        {
            "provider": "MUASAMCONG",
            "plan": {"familyNo": "PL2600000001"},
            "enrichmentStatus": "COMPLETED",
            "revisions": [{
                "revisionId": "plan-00",
                "revisionNumber": "00",
                "name": "Kế hoạch 00",
                "packages": [{
                    "planDetailRevisionId": "detail-1",
                    "effectiveFields": {
                        "name": "Mua máy giặt công nghiệp và máy phân tích huyết học",
                        "priceVnd": 28_000_000,
                        "executionPeriod": "60 ngày",
                        "capitalDetail": "Ngân sách",
                        "selectionDuration": "30 ngày",
                        "selectionStart": "2026-01",
                        "lifecycleStatus": "INVITED",
                        "bidGuaranteeVnd": 28_000_000,
                        "approvalDecisionNo": "123/QĐ-E-HSMT",
                        "approvalDecisionDate": "2026-07-15",
                        "noticeLink": {
                            "state": "LINKED",
                            "noticeNo": "IB2600082707",
                            "kind": "TBMT",
                            "noticeRevisionId": "notice-00",
                            "noticeVersion": "00",
                        },
                        "noticeFields": {
                            "publishedAt": "2026-07-16T09:00:00",
                        },
                        "goodsItems": [{
                            "sourceItemId": "item-1",
                            "sourceIndex": "1",
                            "code": "1",
                            "name": "Máy giặt công nghiệp",
                            "unit": "Cái",
                            "quantity": 1,
                        }],
                    },
                }],
            }],
        },
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
    )

    package = service.get_revision_draft(
        manifest["sessionId"],
        "00",
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
    )["packageDrafts"][0]

    assert package["trangThai"] == "Đang mời thầu"
    assert package["soQuyetDinh"] == "123/QĐ-E-HSMT"
    assert package["ngayQuyetDinh"] == "2026-07-15"
    assert package["thoiGianDangTai"] == "2026-07-16T09:00:00"
    assert package["giaTriBaoDamDuThau"] == 28_000_000
    assert package["danhSachHangHoa"][0]["tenHangHoa"] == "Máy giặt công nghiệp"


def test_unlinked_plan_package_never_uses_bp_bid_number_as_bidding_code():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        {
            "provider": "MUASAMCONG",
            "plan": {"familyNo": "PL2600000001"},
            "revisions": [{
                "revisionId": "rev-00", "revisionNumber": "00",
                "name": "Kế hoạch", "packages": [{
                    "planDetailRevisionId": "detail-bp",
                    "stablePackageId": "BP2600291019",
                    "symbol": "BP2600291019",
                    "name": "Gói chưa đăng thông báo",
                    "priceVnd": 100,
                    "selectionStart": "2026-01",
                    "selectionDuration": "30 ngày",
                    "executionPeriod": "60 ngày",
                    "capitalDetail": "Ngân sách",
                    "noticeLink": {
                        "state": "UNLINKED", "noticeNo": None,
                    },
                }],
            }],
        },
        organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1",
    )

    draft = service.get_revision_draft(
        manifest["sessionId"], "00", organization_id="org-1",
        user_id="user-1", workspace_lease="lease-1",
    )["packageDrafts"][0]

    assert draft["maGoiThau"] == ""
    assert draft["soHieuGoiThau"] == ""
    assert draft["sourceRevision"]["stablePackageId"] == "BP2600291019"


def test_linked_package_uses_only_its_ib_notice_number_as_bidding_code():
    draft = map_package_canonical_to_draft(
        "MUASAMCONG", "PL2600000001",
        {"revisionId": "rev-00", "revisionNumber": "00"},
        {
            "planDetailRevisionId": "detail-linked",
            "stablePackageId": "BP2600291019",
            "symbol": "BP2600291019",
            "name": "Gói đã đăng thông báo",
            "noticeLink": {
                "state": "LINKED", "noticeNo": "IB2600212155",
            },
        },
    )

    assert draft["maGoiThau"] == "IB2600212155"
    assert draft["soHieuGoiThau"] == ""
    assert draft["sourceRevision"]["stablePackageId"] == "BP2600291019"


def test_plan_package_draft_exposes_notice_version_as_independent_package_version():
    draft = map_package_canonical_to_draft(
        "MUASAMCONG", "PL2600000001",
        {"revisionId": "plan-rev-03", "revisionNumber": "03"},
        {
            "planDetailRevisionId": "detail-linked",
            "stablePackageId": "BP2600291019",
            "name": "Gói có thông báo phiên bản riêng",
            "noticeLink": {
                "state": "LINKED", "noticeNo": "IB2600212155",
                "noticeVersion": "01",
            },
        },
    )

    assert draft["sourceRevision"]["revisionNumber"] == "03"
    assert draft["sourceRevision"]["packageRevisionNumber"] == "01"


def test_creating_session_opportunistically_cleans_expired_sessions():
    repository = _MemorySessionRepository()
    repository.cleanup_calls = 0
    repository.cleanup_expired = lambda: setattr(
        repository, "cleanup_calls", repository.cleanup_calls + 1
    )
    ProcurementImportSessionService(repository).create_from_bundle(
        {
            "provider": "MUASAMCONG",
            "plan": {"familyNo": "PL2600000001"},
            "revisions": [{
                "revisionId": "rev-00", "revisionNumber": "00",
                "name": "Plan", "packages": [],
            }],
        },
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    assert repository.cleanup_calls == 1


def test_import_session_rejects_cross_workspace_revision_read():
    repository = _MemorySessionRepository()
    service = ProcurementImportSessionService(repository)
    manifest = service.create_from_bundle(
        {
            "provider": "MUASAMCONG",
            "plan": {"familyNo": "PL2600000001"},
            "revisions": [{
                "revisionId": "rev-00", "revisionNumber": "00",
                "name": "Plan", "packages": [],
            }],
        },
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
    )
    with pytest.raises(PermissionError, match="PROCUREMENT_SESSION_SCOPE_INVALID"):
        service.get_revision_draft(
            manifest["sessionId"], "00",
            organization_id="org-1", user_id="user-1", workspace_lease="lease-2",
        )


class _SessionCursor:
    def __init__(self):
        self.row = None
        self.query = ""

    def execute(self, query, params=()):
        self.query = " ".join(query.split())
        if self.query.startswith("INSERT INTO procurement_import_session"):
            self.row = tuple(params)
        return self

    def fetchone(self):
        if not self.query.startswith("SELECT id, organization_id") or self.row is None:
            return None
        row = self.row
        return (
            row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7],
            row[8], row[9], row[10], row[11], row[12], row[13], row[14],
        )


def test_persistent_session_repository_round_trips_canonical_bundle():
    cursor = _SessionCursor()
    repository = ProcurementImportSessionRepository(cursor)
    now = datetime.now(timezone.utc)
    created = repository.create({
        "id": "session-1", "organizationId": "org-1", "userId": "user-1",
        "workspaceLease": "lease-1", "provider": "MUASAMCONG", "kind": "PLAN",
        "familyNo": "PL2600000001", "bundleDigest": "sha256:" + "a" * 64,
        "revisions": [{"revisionNumber": "00"}],
        "canonicalBundle": {"revisions": [{"revisionNumber": "00"}]},
        "currentIndex": 0, "status": "READY",
        "expiresAt": now + timedelta(hours=1), "createdAt": now, "updatedAt": now,
    })
    loaded = repository.get_scoped(
        "session-1", organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1",
    )
    assert created["id"] == "session-1"
    assert loaded["canonicalBundle"]["revisions"][0]["revisionNumber"] == "00"
    assert loaded["revisions"] == [{"revisionNumber": "00"}]


class _ProgressCursor:
    def __init__(self, revisions, current_index=0):
        self.revisions = revisions
        self.current_index = current_index
        self.updated = None
        self.query = ""

    def execute(self, query, params=()):
        self.query = " ".join(query.split())
        if self.query.startswith("UPDATE procurement_import_session"):
            self.updated = params
        return self

    def fetchone(self):
        if self.query.startswith("SELECT revisions_json"):
            import json
            return (json.dumps(self.revisions), self.current_index)
        return None


def test_session_commit_requires_exact_next_revision_and_retry_is_idempotent():
    revisions = [
        {"revisionNumber": "00", "status": "READY"},
        {"revisionNumber": "01", "status": "READY"},
    ]
    cursor = _ProgressCursor(revisions)
    repository = ProcurementImportSessionRepository(cursor)

    with pytest.raises(ImportConflict, match="PROCUREMENT_SOURCE_VERSION_CONFLICT"):
        repository.mark_revision_committed(
            "session-1", organization_id="org-1", revision_number="01",
        )

    repository.mark_revision_committed(
        "session-1", organization_id="org-1", revision_number="00",
    )
    assert cursor.updated[1:3] == (1, "WAITING_NEXT_CONFIRMATION")

    cursor.current_index = 1
    cursor.revisions[0]["status"] = "COMMITTED"
    repository.mark_revision_committed(
        "session-1", organization_id="org-1", revision_number="00",
    )
    assert cursor.updated[1:3] == (1, "WAITING_NEXT_CONFIRMATION")


def test_session_commit_persists_the_authoritative_plan_for_the_next_revision():
    cursor = _ProgressCursor([
        {"revisionNumber": "01", "status": "READY"},
        {"revisionNumber": "02", "status": "READY"},
    ])
    repository = ProcurementImportSessionRepository(cursor)
    committed_plan = {
        "id": "plan-01", "rootId": "plan-root", "rowVersion": 1,
        "localVersion": 1, "sourceRevisionNumber": "01",
    }

    repository.mark_revision_committed(
        "session-1", organization_id="org-1", revision_number="01",
        committed_plan=committed_plan,
    )

    import json
    stored_revisions = json.loads(cursor.updated[0])
    assert stored_revisions[0]["committedPlan"] == committed_plan
    assert cursor.updated[1:3] == (1, "WAITING_NEXT_CONFIRMATION")


def test_session_predecessor_token_advances_across_three_commits_and_reloads():
    cursor = _ProgressCursor([
        {"revisionNumber": number, "status": "READY"}
        for number in ("01", "02", "03")
    ])
    repository = ProcurementImportSessionRepository(cursor)

    for index, revision_number in enumerate(("01", "02", "03"), start=1):
        committed_plan = {
            "id": f"plan-{revision_number}", "rootId": "plan-root",
            "rowVersion": 1, "localVersion": index,
            "sourceRevisionNumber": revision_number,
        }
        repository.mark_revision_committed(
            "session-1", organization_id="org-1",
            revision_number=revision_number, committed_plan=committed_plan,
        )
        import json
        cursor.revisions = json.loads(cursor.updated[0])
        cursor.current_index = cursor.updated[1]
        assert cursor.revisions[index - 1]["committedPlan"] == committed_plan

        retry = repository.mark_revision_committed(
            "session-1", organization_id="org-1",
            revision_number=revision_number, committed_plan=committed_plan,
        )
        assert retry["currentIndex"] == index

    assert cursor.current_index == 3
    assert cursor.updated[2] == "COMPLETED"

def test_session_cleanup_removes_only_expired_rows():
    class CleanupCursor:
        def __init__(self):
            self.query = ""

        def execute(self, query, params=()):
            self.query = " ".join(query.split())
            assert params == ()
            return self

    cursor = CleanupCursor()
    ProcurementImportSessionRepository(cursor).cleanup_expired()
    assert cursor.query == (
        "DELETE FROM procurement_import_session "
        "WHERE expires_at <= CURRENT_TIMESTAMP"
    )


def test_user_can_stop_a_waiting_session_without_discarding_committed_revisions():
    class StopCursor:
        def __init__(self):
            self.params = None

        def execute(self, query, params=()):
            self.query = " ".join(query.split())
            self.params = params
            self.rowcount = 1
            return self

    cursor = StopCursor()
    stopped = ProcurementImportSessionRepository(cursor).cancel_remaining(
        "session-1", organization_id="org-1", user_id="user-1",
    )
    assert stopped is True
    assert "status = 'CANCELLED'" in cursor.query
    assert cursor.params == ("org-1", "session-1", "user-1")
