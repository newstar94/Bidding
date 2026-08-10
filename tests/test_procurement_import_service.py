from datetime import datetime, timezone

import pytest

from backend.procurement_import.domain import (
    PackageAction,
    ProcurementCodeKind,
    RequiredFieldIssue,
    normalize_procurement_code,
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
                 "selectionStart":"2026-02"}]},
              {"revisionId":"rev-01","revisionNumber":"01","name":"Kế hoạch 01",
               "planType":"Dự toán mua sắm","projectName":"Dự toán A",
               "investorCode":"INV-1","approvalDecisionNo":"02/QD",
               "approvalDecisionDate":"2026-02-01",
               "packages":[
                 {"planDetailRevisionId":"detail-a-01","symbol":"A",
                  "name":"Gói A","priceVnd":1000,"executionPeriod":"30 ngày",
                  "capitalDetail":"Ngân sách","selectionDuration":"30 ngày",
                  "selectionStart":"2026-02"},
                 {"planDetailRevisionId":"detail-b-01","symbol":"B",
                  "name":"Gói B","priceVnd":2000,"executionPeriod":"60 ngày",
                  "capitalDetail":"Ngân sách","selectionDuration":"30 ngày",
                  "selectionStart":"2026-03","noticeLink":{"state":"LINKED",
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
    assert [row["symbol"] for row in preview["packages"]] == ["A", "B"]
    assert all(row["action"] == PackageAction.ADDED.value for row in preview["packages"])
    assert preview["bundleDigest"].startswith("sha256:")
    assert any(item["code"] == "OLDER_REVISIONS_PROVENANCE_ONLY_AFTER_APPLY" for item in preview["warnings"])
    stored = store.get(
        preview["previewId"], organization_id="org-1", user_id="user-1",
        workspace_lease="lease-1", now=datetime.now(timezone.utc),
    )
    assert stored.bundle_digest == preview["bundleDigest"]


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
