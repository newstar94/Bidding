from copy import deepcopy

import pytest

from backend.procurement_import.command import ProcurementPlanReconciler
from backend.procurement_import.domain import ImportConflict


class MemoryRepository:
    def __init__(self):
        self.plans = []
        self.packages = []
        self.revisions = {}
        self.bindings = {}
        self.operations = {}

    def lock_family(self, organization_id, provider, family_no):
        return (organization_id, provider, family_no)

    def load_family(self, organization_id, provider, family_no):
        del organization_id, provider
        plans = [row for row in self.plans if row["familyNo"] == family_no]
        latest = max(plans, key=lambda row: row["localVersion"], default=None)
        packages = [] if latest is None else [
            row for row in self.packages if row["planSnapshotId"] == latest["id"]
        ]
        return {"latestPlan": deepcopy(latest), "packages": deepcopy(packages)}

    def find_revision(self, organization_id, provider, revision_id):
        return deepcopy(self.revisions.get((organization_id, provider, revision_id)))

    def persist_revision(self, result):
        revision = result["provenance"]
        key = (revision["organizationId"], revision["provider"], revision["revisionId"])
        self.revisions[key] = deepcopy(revision)
        self.plans.extend(deepcopy(result["createdPlans"]))
        self.packages.extend(deepcopy(result["createdPackages"]))
        for binding in result["bindings"]:
            self.bindings[binding["observationKey"]] = deepcopy(binding)


def _revision(number, revision_id, packages):
    return {
        "familyNo": "PL2600000001", "revisionNumber": number,
        "revisionId": revision_id, "revisionDigest": f"sha256:{revision_id}",
        "plan": {"name": f"Kế hoạch {number}", "projectName": "Dự toán",
                 "planType": "Dự toán mua sắm", "investorId": "investor-1",
                 "approvalDecisionNo": "01/QD", "approvalDecisionDate": "2026-01-01"},
        "packages": packages,
    }


def _package(symbol, price=1000, notice_no=None):
    return {
        "planDetailRevisionId": f"detail-{symbol}", "symbol": symbol,
        "name": f"Gói {symbol}", "priceVnd": price,
        "executionPeriod": "30 ngày", "capitalDetail": "Ngân sách",
        "selectionDuration": "30 ngày", "selectionStart": "2026-02",
        "noticeLink": {"state": "LINKED", "noticeNo": notice_no, "kind": "UNKNOWN"}
        if notice_no else {"state": "UNLINKED", "noticeNo": None, "kind": "UNKNOWN"},
    }


def test_plan_00_to_01_keeps_unchanged_package_version_and_adds_b_at_00():
    repository = MemoryRepository()
    command = ProcurementPlanReconciler(repository)
    first = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("00", "rev-00", [_package("A")]),
        idempotency_key="operation:rev-00", expected_plan_row_version=None,
    )
    second = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("01", "rev-01", [_package("A"), _package("B")]),
        idempotency_key="operation:rev-01", expected_plan_row_version=1,
    )

    assert first["createdPlans"][0]["localVersion"] == 0
    assert second["createdPlans"][0]["localVersion"] == 1
    packages = {row["symbol"]: row for row in second["createdPackages"]}
    old_a = first["createdPackages"][0]
    assert packages["A"]["rootId"] == old_a["rootId"]
    assert packages["A"]["localVersion"] == 0
    assert packages["A"]["id"] != old_a["id"]
    assert packages["B"]["localVersion"] == 0


def test_changed_later_linked_removed_and_initial_linked_semantics():
    repository = MemoryRepository()
    command = ProcurementPlanReconciler(repository)
    first = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("00", "rev-00", [_package("A"), _package("REMOVED")]),
        idempotency_key="rev-00", expected_plan_row_version=None,
    )
    second = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("01", "rev-01", [
            _package("A", price=1500, notice_no="IB2600000001"),
            _package("B", notice_no="IB2600000002"),
        ]),
        idempotency_key="rev-01", expected_plan_row_version=1,
    )
    packages = {row["symbol"]: row for row in second["createdPackages"]}
    original_a = next(row for row in first["createdPackages"] if row["symbol"] == "A")
    assert packages["A"]["rootId"] == original_a["rootId"]
    assert packages["A"]["localVersion"] == 1
    assert packages["A"]["noticeNo"] == "IB2600000001"
    assert packages["B"]["localVersion"] == 0
    assert "REMOVED" not in packages


def test_same_revision_digest_is_noop_and_digest_change_is_conflict():
    repository = MemoryRepository()
    command = ProcurementPlanReconciler(repository)
    revision = _revision("03", "rev-03", [_package("A")])
    applied = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=revision, idempotency_key="rev-03", expected_plan_row_version=None,
    )
    again = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=revision, idempotency_key="rev-03-retry", expected_plan_row_version=1,
    )
    assert applied["operation"] == "APPLIED"
    assert again["operation"] == "NOOP"
    changed_digest = deepcopy(revision)
    changed_digest["revisionDigest"] = "sha256:changed"
    with pytest.raises(ImportConflict, match="PROCUREMENT_REVISION_CONFLICT"):
        command.reconcile_revision(
            organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
            revision=changed_digest, idempotency_key="rev-03-changed",
            expected_plan_row_version=1,
        )


def test_first_external_03_is_local_00_and_older_history_is_provenance_only():
    repository = MemoryRepository()
    command = ProcurementPlanReconciler(repository)
    result = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("03", "rev-03", [_package("A")]),
        idempotency_key="rev-03", expected_plan_row_version=None,
    )
    backfill = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("02", "rev-02", [_package("A")]),
        idempotency_key="rev-02", expected_plan_row_version=1,
    )
    assert result["createdPlans"][0]["localVersion"] == 0
    assert result["provenance"]["revisionNumber"] == "03"
    assert backfill["operation"] == "PROVENANCE_ONLY"
    assert backfill["createdPlans"] == []


def test_ambiguous_symbol_match_blocks_apply():
    repository = MemoryRepository()
    repository.plans = [{"id":"plan-0","familyNo":"PL2600000001","localVersion":0,"rowVersion":1}]
    repository.packages = [
        {"id":"a1","rootId":"r1","planSnapshotId":"plan-0","symbol":"A","localVersion":0,"sourceFields":{}},
        {"id":"a2","rootId":"r2","planSnapshotId":"plan-0","symbol":"A","localVersion":0,"sourceFields":{}},
    ]
    with pytest.raises(ImportConflict, match="PROCUREMENT_MATCH_AMBIGUOUS"):
        ProcurementPlanReconciler(repository).reconcile_revision(
            organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
            revision=_revision("01", "rev-01", [_package("A")]),
            idempotency_key="rev-01", expected_plan_row_version=1,
        )
