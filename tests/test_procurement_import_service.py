from datetime import datetime, timezone

import pytest

from backend.procurement_import.domain import (
    PackageAction,
    ProcurementCodeKind,
    RequiredFieldIssue,
    derive_import_lifecycle_status,
    normalize_procurement_code,
    three_way_merge_field,
)
from backend.procurement_import.service import ProcurementImportPreparer, PreviewStore
from backend.integrations.vneps.fake_procurement_provider import FixtureProcurementSource


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
    ],
)
def test_import_lifecycle_mapping_is_conservative(package, expected):
    assert derive_import_lifecycle_status(package) == expected


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


def test_prepare_existing_family_carries_authoritative_plan_cas_version(tmp_path):
    preview = ProcurementImportPreparer(_source(tmp_path), PreviewStore()).prepare_plan(
        code="PL2600000001", revision_mode="LATEST",
        organization_id="org-1", user_id="user-1", workspace_lease="lease-1",
        local_state={"latestPlan": {"id": "plan-1", "rowVersion": 7}},
    )
    assert preview["plan"]["expectedRowVersion"] == 7
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
        == preview["revisionPreviews"][0]["revisionDigest"]
    )
    assert changed_notice["bundleDigest"] != preview["bundleDigest"]


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
