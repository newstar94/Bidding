from copy import deepcopy
import os
from pathlib import Path
import uuid

import psycopg
import pytest

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.procurement_import.command import (
    ProcurementNoticeReconciler,
    ProcurementPlanReconciler,
)
from backend.procurement_import.domain import ImportConflict, canonical_digest
from backend.procurement_import.repository import ProcurementImportRepository


class MemoryRepository:
    def __init__(self):
        self.plans = []
        self.packages = []
        self.revisions = {}
        self.bindings = {}
        self.operations = {}

    def lock_family(self, organization_id, provider, family_no):
        return (organization_id, provider, family_no)

    def load_family(
        self, organization_id, provider, family_no, plan_snapshot_id=None
    ):
        del organization_id, provider
        plans = [row for row in self.plans if row["familyNo"] == family_no]
        latest = next(
            (row for row in plans if row["id"] == plan_snapshot_id), None
        ) if plan_snapshot_id else max(
            plans, key=lambda row: row["localVersion"], default=None
        )
        packages = [] if latest is None else [
            row for row in self.packages if row["planSnapshotId"] == latest["id"]
        ]
        return {"latestPlan": deepcopy(latest), "packages": deepcopy(packages)}

    def find_revision_by_number(
        self, organization_id, provider, kind, family_no, revision_number,
        *, local_root_id=None,
    ):
        rows = [
            row for (org, source, _revision_id), row in self.revisions.items()
            if org == organization_id and source == provider
            and row.get("kind") == kind and row.get("familyNo") == family_no
            and str(row.get("revisionNumber")) == str(revision_number)
            and (
                local_root_id is None
                or row.get("localRootId") == local_root_id
            )
        ]
        if not rows:
            return None
        row = rows[-1]
        return {
            "revisionId": row.get("revisionId"), "digest": row.get("digest"),
            "localRootId": row.get("localRootId"),
            "localSnapshotId": row.get("localSnapshotId"),
        }

    def find_revision(self, organization_id, provider, revision_id):
        return deepcopy(self.revisions.get((organization_id, provider, revision_id)))

    def find_notice_revision(self, organization_id, provider, revision_id):
        row = self.revisions.get((organization_id, provider, revision_id))
        return deepcopy(row) if row and row.get("kind") == "NOTICE" else None

    def load_package_snapshot(
        self, organization_id, provider, local_snapshot_id
    ):
        del organization_id, provider
        return deepcopy(next((
            row for row in self.packages if row["id"] == local_snapshot_id
        ), None))

    def find_local_plan_version(self, organization_id, family_no, version):
        del organization_id
        return deepcopy(next((
            row for row in self.plans
            if row["familyNo"] == family_no
            and row["localVersion"] == int(version)
            and not row.get("archived")
        ), None))

    def find_local_package_version(
        self, organization_id, local_root_id, plan_snapshot_id, version,
        *, provider,
    ):
        del organization_id, provider
        return deepcopy(next((
            row for row in self.packages
            if (row.get("rootId") or row["id"]) == local_root_id
            and row["planSnapshotId"] == plan_snapshot_id
            and row["localVersion"] == int(version)
            and not row.get("archived")
        ), None))

    def latest_notice_revision_for_package(
        self, organization_id, provider, local_root_id
    ):
        rows = [
            row for (org, source, _revision_id), row in self.revisions.items()
            if org == organization_id and source == provider
            and row.get("kind") == "NOTICE"
            and row.get("localRootId") == local_root_id
        ]
        return deepcopy(max(
            rows,
            key=lambda row: int(row.get("revisionNumber") or -1),
            default=None,
        ))

    def resolve_notice_target(
        self, organization_id, provider, notice_no, relationship, target_root_id=None
    ):
        del organization_id, provider
        plan_no = str((relationship or {}).get("planNo") or "").upper()
        id_detail = str((relationship or {}).get("planDetailRevisionId") or "")
        candidates = []
        for package in self.packages:
            if package.get("isLatest", True) is not True:
                continue
            plan = next(
                (row for row in self.plans if row["id"] == package["planSnapshotId"]),
                None,
            )
            if plan is None:
                continue
            root_id = str(package.get("rootId") or package["id"])
            direct_notice = str(package.get("noticeNo") or "").upper() == notice_no
            exact_relationship = any(
                plan_no
                and plan["familyNo"] == plan_no
                and id_detail
                and binding.get("familyNo") == plan_no
                and str(binding.get("idDetail") or "") == id_detail
                and binding.get("localSnapshotId") == package["id"]
                for binding in self.bindings.values()
            )
            selected = target_root_id and root_id == str(target_root_id)
            if direct_notice or exact_relationship or selected:
                candidate = deepcopy(package)
                binding = next((
                    row for row in self.bindings.values()
                    if row.get("localSnapshotId") == package["id"]
                ), None)
                if binding:
                    candidate["binding"] = deepcopy(binding)
                candidates.append(candidate)
        return deepcopy(candidates[0]) if len(candidates) == 1 else None

    def persist_revision(self, result):
        revision = result["provenance"]
        key = (revision["organizationId"], revision["provider"], revision["revisionId"])
        self.revisions[key] = deepcopy(revision)
        stored_plans = deepcopy(result["createdPlans"])
        for plan in stored_plans:
            if plan.get("replaceSourceVersion"):
                for existing in self.plans:
                    if (
                        existing.get("rootId", existing["id"])
                        == plan.get("rootId", plan["id"])
                        and existing["localVersion"] == plan["localVersion"]
                    ):
                        existing["archived"] = True
                        existing["isLatest"] = False
            if plan.get("isLatest", True):
                for existing in self.plans:
                    if existing["familyNo"] == plan["familyNo"]:
                        existing["isLatest"] = False
            plan["isLatest"] = bool(plan.get("isLatest", True))
        self.plans.extend(stored_plans)
        stored_packages = deepcopy(result["createdPackages"])
        for package in stored_packages:
            superseded_id = package.get("supersedeSnapshotId")
            for existing in self.packages:
                if superseded_id and existing["id"] == superseded_id:
                    existing["isLatest"] = False
                    if package.get("replaceSourceVersion"):
                        existing["archived"] = True
            package["isLatest"] = True
            package["sourceFields"] = deepcopy(
                package.get("canonicalSourceFields") or package.get("sourceFields") or {}
            )
        self.packages.extend(stored_packages)
        for binding in result["bindings"]:
            self.bindings[binding["observationKey"]] = deepcopy(binding)
            for package in self.packages:
                if package["id"] == binding["localSnapshotId"]:
                    package["binding"] = deepcopy(binding)


def _notice(number="00", *, status="PUBLISHED", public_url=None):
    return {
        "noticeNo": "IB2600000001",
        "revisionId": f"notice-rev-{number}",
        "revisionNumber": number,
        "kind": "TBMT",
        "status": status,
        "bidClosingAt": "2026-03-15T09:00:00+07:00",
        "bidOpeningAt": "2026-03-15T09:30:00+07:00",
        "publicUrl": public_url,
        "relationship": {
            "planNo": "PL2600000001",
            "planDetailRevisionId": "detail-A",
        },
    }


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
        "expectedNotice": True,
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
        operation_id="operation-all-1",
    )
    second = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("01", "rev-01", [_package("A"), _package("B")]),
        idempotency_key="operation:rev-01", expected_plan_row_version=1,
    )

    assert first["createdPlans"][0]["localVersion"] == 0
    assert first["provenance"]["operationId"] == "operation-all-1"
    assert second["createdPlans"][0]["localVersion"] == 1
    packages = {row["symbol"]: row for row in second["createdPackages"]}
    old_a = first["createdPackages"][0]
    assert packages["A"]["rootId"] == old_a["rootId"]
    assert packages["A"]["localVersion"] == 0
    assert packages["A"]["id"] != old_a["id"]
    assert packages["B"]["localVersion"] == 0


def test_plan_reconciler_persists_total_amount_from_lookup_alias():
    repository = MemoryRepository()
    result = ProcurementPlanReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="MUASAMCONG",
        revision={
            **_revision("01", "rev-total", [_package("A")]),
            "totalInvestment": 3_000_000_000,
        },
        idempotency_key="operation:rev-total", expected_plan_row_version=None,
    )

    assert result["createdPlans"][0]["totalAmountVnd"] == 3_000_000_000


@pytest.mark.parametrize(
    ("source_plan_type", "bidding_plan_type"),
    (
        ("DTPT", "Dự án"),
        ("DTMS", "Dự án"),
        ("TX", "Dự toán mua sắm"),
        ("KHAC", "Dự toán mua sắm"),
    ),
)
def test_plan_reconciler_persists_normalized_muasamcong_plan_type(
    source_plan_type,
    bidding_plan_type,
):
    repository = MemoryRepository()
    result = ProcurementPlanReconciler(repository).reconcile_revision(
        organization_id="org-1",
        actor_user_id="user-1",
        provider="MUASAMCONG",
        revision={
            **_revision("00", f"rev-{source_plan_type}", [_package("A")]),
            "plan": {},
            "name": "Kế hoạch phân loại",
            "projectName": "Dự án hoặc dự toán",
            "sourcePlanType": source_plan_type,
            "planType": bidding_plan_type,
        },
        idempotency_key=f"operation:{source_plan_type}",
        expected_plan_row_version=None,
    )

    stored = result["createdPlans"][0]
    assert stored["sourcePlanType"] == source_plan_type
    assert stored["planType"] == bidding_plan_type


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


def test_standalone_notice_versions_same_package_without_creating_plan_version():
    repository = MemoryRepository()
    plan_result = ProcurementPlanReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("00", "rev-00", [_package("A")]),
        idempotency_key="plan:00", expected_plan_row_version=None,
    )
    original = plan_result["createdPackages"][0]

    result = ProcurementNoticeReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        notice=_notice(), idempotency_key="notice:00",
        expected_package_row_version=1,
    )

    assert result["operation"] == "APPLIED"
    assert result["createdPlans"] == []
    assert len(repository.plans) == 1
    package = result["createdPackages"][0]
    assert package["rootId"] == original["rootId"]
    assert package["planSnapshotId"] == original["planSnapshotId"]
    assert package["localVersion"] == 1
    assert package["noticeNo"] == "IB2600000001"
    assert package["noticeRevisionId"] == "notice-rev-00"


def test_notice_authoritative_business_fields_replace_plan_values():
    repository = MemoryRepository()
    plan_result = ProcurementPlanReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="MUASAMCONG",
        revision=_revision("00", "plan-00", [_package("A")]),
        idempotency_key="plan:00:mapping", expected_plan_row_version=None,
    )
    notice = {
        **_notice("00"),
        "field": "Hàng hóa",
        "selectionForm": "Đấu thầu rộng rãi",
        "selectionMode": "Một giai đoạn một túi hồ sơ",
        "contractType": "Trọn gói",
        "onlineMode": "Qua mạng",
        "domesticOrInternational": "Trong nước",
    }

    result = ProcurementNoticeReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="MUASAMCONG",
        notice=notice, idempotency_key="notice:00:mapping",
        expected_package_row_version=1,
    )

    assert plan_result["createdPackages"][0]["localVersion"] == 0
    source_fields = result["createdPackages"][0]["sourceFields"]
    expected = {
        "field": "Hàng hóa",
        "selectionForm": "Đấu thầu rộng rãi",
        "selectionMode": "Một giai đoạn một túi hồ sơ",
        "contractType": "Trọn gói",
        "onlineMode": "Qua mạng",
        "domesticOrInternational": "Trong nước",
    }
    assert {field: source_fields[field] for field in expected} == expected


def test_notice_reconciler_preserves_evaluation_milestones_for_repository():
    repository = MemoryRepository()
    ProcurementPlanReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="MUASAMCONG",
        revision=_revision("00", "plan-evaluating-00", [_package("A")]),
        idempotency_key="plan:evaluating:00", expected_plan_row_version=None,
    )
    result = ProcurementNoticeReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="MUASAMCONG",
        notice={
            **_notice("00", status="IS_PUBLISH"),
            "statusForNotify": "DXT",
            "actualOpeningAt": "2026-03-15T09:38:42+07:00",
            "financialActualOpeningAt": "2026-03-16T10:05:00+07:00",
            "bidGuaranteeVnd": 52_183_040,
            "approvalDecisionNo": "123/QĐ-E-HSMT",
            "approvalDecisionDate": "2026-03-01",
            "publishedAt": "2026-03-02T08:00:00+07:00",
        },
        idempotency_key="notice:evaluating:00",
        expected_package_row_version=1,
    )

    package = result["createdPackages"][0]
    assert package["initialStatus"] == "INVITED"
    assert package["noticeFields"]["actualOpeningAt"] == (
        "2026-03-15T09:38:42+07:00"
    )
    assert package["sourceFields"]["bidGuaranteeVnd"] == 52_183_040
    assert package["sourceFields"]["approvalDecisionNo"] == "123/QĐ-E-HSMT"


def test_notice_milestone_change_is_material_even_when_schedule_is_unchanged():
    repository = MemoryRepository()
    ProcurementPlanReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="MUASAMCONG",
        revision=_revision("00", "plan-material-00", [_package("A")]),
        idempotency_key="plan:material:00", expected_plan_row_version=None,
    )
    command = ProcurementNoticeReconciler(repository)
    first = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="MUASAMCONG",
        notice={**_notice("00"), "bidGuaranteeVnd": 10_000_000},
        idempotency_key="notice:material:00", expected_package_row_version=1,
    )
    changed = {
        **_notice("01"),
        "bidGuaranteeVnd": 12_000_000,
        "approvalDecisionNo": "QĐ-02",
    }
    changed["bidClosingAt"] = _notice("00")["bidClosingAt"]
    changed["bidOpeningAt"] = _notice("00")["bidOpeningAt"]
    second = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="MUASAMCONG",
        notice=changed,
        idempotency_key="notice:material:01", expected_package_row_version=1,
    )

    assert first["operation"] == "APPLIED"
    assert second["operation"] == "APPLIED"
    assert second["createdPackages"][0]["sourceFields"]["bidGuaranteeVnd"] == (
        12_000_000
    )


def test_standalone_notice_reimport_is_noop_and_digest_drift_conflicts():
    repository = MemoryRepository()
    ProcurementPlanReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("00", "rev-00", [_package("A")]),
        idempotency_key="plan:00", expected_plan_row_version=None,
    )
    command = ProcurementNoticeReconciler(repository)
    notice = _notice()
    command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        notice=notice, idempotency_key="notice:00",
        expected_package_row_version=1,
    )

    retry = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        notice=notice, idempotency_key="notice:00:retry",
        expected_package_row_version=1,
    )
    assert retry["operation"] == "NOOP"
    changed = {**notice, "revisionDigest": "sha256:changed"}
    with pytest.raises(ImportConflict, match="PROCUREMENT_REVISION_CONFLICT"):
        command.reconcile_revision(
            organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
            notice=changed, idempotency_key="notice:00:changed",
            expected_package_row_version=1,
        )


def test_non_material_notice_revision_records_provenance_without_package_version():
    repository = MemoryRepository()
    ProcurementPlanReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("00", "rev-00", [_package("A")]),
        idempotency_key="plan:00", expected_plan_row_version=None,
    )
    command = ProcurementNoticeReconciler(repository)
    first = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        notice=_notice("00"), idempotency_key="notice:00",
        expected_package_row_version=1,
    )
    result = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        notice=_notice("01", public_url="https://example.test/notice/01"),
        idempotency_key="notice:01", expected_package_row_version=1,
    )

    assert result["operation"] == "PROVENANCE_ONLY"
    assert result["createdPackages"] == []
    assert len(repository.plans) == 1
    assert len(repository.packages) == 2
    assert first["createdPackages"][0]["localVersion"] == 1


def test_standalone_notice_never_creates_an_orphan_package():
    repository = MemoryRepository()
    with pytest.raises(ImportConflict, match="PROCUREMENT_NOTICE_PACKAGE_UNRESOLVED"):
        ProcurementNoticeReconciler(repository).reconcile_revision(
            organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
            notice={**_notice(), "relationship": {}},
            idempotency_key="notice:orphan", expected_package_row_version=1,
        )


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


def test_muasamcong_plan_revision_numbers_are_bidding_versions_one_to_one():
    repository = MemoryRepository()
    command = ProcurementPlanReconciler(repository)

    first = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1",
        provider="MUASAMCONG",
        revision=_revision("00", "msc-rev-00", [_package("A")]),
        idempotency_key="msc:00", expected_plan_row_version=None,
    )
    second = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1",
        provider="MUASAMCONG",
        revision=_revision("01", "msc-rev-01", [_package("A")]),
        idempotency_key="msc:01", expected_plan_row_version=1,
    )
    third = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1",
        provider="MUASAMCONG",
        revision=_revision("02", "msc-rev-02", [_package("A")]),
        idempotency_key="msc:02", expected_plan_row_version=1,
    )

    assert [
        first["createdPlans"][0]["localVersion"],
        second["createdPlans"][0]["localVersion"],
        third["createdPlans"][0]["localVersion"],
    ] == [0, 1, 2]
    assert third["createdPlans"][0]["sourceRevisionNumber"] == "02"


def test_muasamcong_first_revision_03_is_bidding_version_03():
    result = ProcurementPlanReconciler(MemoryRepository()).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1",
        provider="MUASAMCONG",
        revision=_revision("03", "msc-rev-03", [_package("A")]),
        idempotency_key="msc:03", expected_plan_row_version=None,
    )

    assert result["createdPlans"][0]["localVersion"] == 3


def test_muasamcong_same_plan_revision_changed_digest_is_authoritative_resync():
    repository = MemoryRepository()
    command = ProcurementPlanReconciler(repository)
    original = _revision("00", "msc-rev-00", [_package("A", price=1000)])
    first = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1",
        provider="MUASAMCONG", revision=original,
        idempotency_key="msc:00:first", expected_plan_row_version=None,
    )
    changed = _revision("00", "msc-rev-00", [_package("A", price=2000)])
    changed["revisionDigest"] = "sha256:changed"
    result = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1",
        provider="MUASAMCONG", revision=changed,
        idempotency_key="msc:00:resync", expected_plan_row_version=1,
    )

    assert result["operation"] == "APPLIED"
    assert result["createdPlans"][0]["localVersion"] == 0
    assert result["createdPlans"][0]["id"] != first["createdPlans"][0]["id"]
    assert result["provenance"]["previousDigest"] == original["revisionDigest"]
    assert result["createdPackages"][0]["sourceFields"]["priceVnd"] == 2000


def test_muasamcong_notice_revision_00_replaces_plan_placeholder_version_00():
    repository = MemoryRepository()
    plan = ProcurementPlanReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1",
        provider="MUASAMCONG",
        revision=_revision("00", "msc-plan-00", [_package("A")]),
        idempotency_key="msc:plan:00", expected_plan_row_version=None,
    )
    original = plan["createdPackages"][0]
    notice = ProcurementNoticeReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1",
        provider="MUASAMCONG", notice=_notice("00"),
        idempotency_key="msc:notice:00", expected_package_row_version=1,
    )

    package = notice["createdPackages"][0]
    assert package["localVersion"] == 0
    assert package["replaceSourceVersion"] is True
    assert package["rootId"] == original["rootId"]


def test_muasamcong_rejects_two_revision_ids_claiming_one_source_number():
    repository = MemoryRepository()
    command = ProcurementPlanReconciler(repository)
    command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1",
        provider="MUASAMCONG",
        revision=_revision("00", "msc-rev-a", [_package("A")]),
        idempotency_key="msc:a", expected_plan_row_version=None,
    )

    with pytest.raises(ImportConflict, match="PROCUREMENT_SOURCE_VERSION_CONFLICT"):
        command.reconcile_revision(
            organization_id="org-1", actor_user_id="user-1",
            provider="MUASAMCONG",
            revision=_revision("00", "msc-rev-b", [_package("A")]),
            idempotency_key="msc:b", expected_plan_row_version=1,
        )


def test_muasamcong_rejects_local_plan_version_without_source_provenance():
    repository = MemoryRepository()
    repository.plans.append({
        "id": "local-plan-00", "rootId": "local-plan-00",
        "familyNo": "PL2600000001", "localVersion": 0, "rowVersion": 1,
        "isLatest": True,
    })

    with pytest.raises(ImportConflict, match="PROCUREMENT_SOURCE_VERSION_CONFLICT"):
        ProcurementPlanReconciler(repository).reconcile_revision(
            organization_id="org-1", actor_user_id="user-1",
            provider="MUASAMCONG",
            revision=_revision("00", "msc-rev-00", [_package("A")]),
            idempotency_key="msc:00", expected_plan_row_version=1,
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


def test_stable_first_party_package_id_has_priority_over_ambiguous_symbol():
    repository = MemoryRepository()
    repository.plans = [{"id":"plan-0","familyNo":"PL2600000001","localVersion":0,"rowVersion":1}]
    repository.packages = [
        {"id":"a1","rootId":"r1","planSnapshotId":"plan-0","symbol":"A","stableExternalId":"stable-a","localVersion":0,"sourceFields":{}},
        {"id":"a2","rootId":"r2","planSnapshotId":"plan-0","symbol":"A","stableExternalId":"stable-other","localVersion":0,"sourceFields":{}},
    ]
    observation = _package("A")
    observation["stablePackageId"] = "stable-a"
    result = ProcurementPlanReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("01", "rev-01", [observation]),
        idempotency_key="rev-01", expected_plan_row_version=1,
    )
    assert result["createdPackages"][0]["rootId"] == "r1"
    assert result["bindings"][0]["matchMethod"] == "STABLE_EXTERNAL_ID"


def test_user_confirmed_ambiguous_binding_selects_exact_root_without_duplicate():
    repository = MemoryRepository()
    repository.plans = [{"id":"plan-0","familyNo":"PL2600000001","localVersion":0,"rowVersion":1}]
    repository.packages = [
        {"id":"a1","rootId":"r1","planSnapshotId":"plan-0","symbol":"A","localVersion":0,"sourceFields":{}},
        {"id":"a2","rootId":"r2","planSnapshotId":"plan-0","symbol":"A","localVersion":3,"sourceFields":{}},
    ]
    result = ProcurementPlanReconciler(repository).reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("01", "rev-01", [_package("A")]),
        idempotency_key="rev-01", expected_plan_row_version=1,
        package_decisions={"detail-A": {"localRootId": "r2"}},
    )
    package = result["createdPackages"][0]
    assert package["rootId"] == "r2"
    assert package["localVersion"] == 4
    assert result["bindings"][0]["matchMethod"] == "USER_CONFIRMED"
    assert result["bindings"][0]["confirmedBy"] == "user-1"


def test_source_unchanged_keeps_package_version_while_preserving_local_fields():
    repository = MemoryRepository()
    command = ProcurementPlanReconciler(repository)
    first = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("00", "rev-00", [_package("A", price=1000)]),
        idempotency_key="rev-00", expected_plan_row_version=None,
    )
    observation = _package("A", price=1200)
    observation["_sourceAction"] = "UNCHANGED"
    second = command.reconcile_revision(
        organization_id="org-1", actor_user_id="user-1", provider="VNEPS",
        revision=_revision("01", "rev-01", [observation]),
        idempotency_key="rev-01", expected_plan_row_version=1,
    )
    assert second["createdPackages"][0]["localVersion"] == 0
    assert second["createdPackages"][0]["sourceFields"]["priceVnd"] == 1200
    assert second["createdPackages"][0]["rootId"] == first["createdPackages"][0]["rootId"]


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip("'\"")
    return ""


def test_real_postgres_plan_00_to_01_is_atomic_and_preserves_version_axes():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        connection = psycopg.connect(
            database_url, connect_timeout=5, row_factory=compat_row_factory
        )
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    token = uuid.uuid4().hex
    organization_id = f"procurement-org-{token}"
    user_id = f"procurement-user-{token}"
    investor_id = f"procurement-investor-{token}"
    family_no = "PL2699999999"
    cursor = PostgresCursor(connection.cursor())
    try:
        cursor.execute("BEGIN")
        # Production connections are configured to use Vietnam business time.
        # Keep this direct psycopg fixture on the same contract so a CI server
        # whose PostgreSQL default is UTC cannot reinterpret naive wall-clock
        # values and shift every imported tender milestone by seven hours.
        cursor.execute("SET LOCAL TIME ZONE 'Asia/Ho_Chi_Minh'")
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, "Procurement test organization"),
        )
        cursor.execute(
            """INSERT INTO tai_khoan
                   (id, mat_khau, email, email_norm, ho_ten, vai_tro, da_xac_minh)
               VALUES (?, 'test-hash', ?, ?, 'Importer', 'user', 1)""",
            (user_id, f"{token}@example.test", f"{token}@example.test"),
        )
        cursor.execute(
            """INSERT INTO thanh_vien_to_chuc
                   (user_id, organization_id, vai_tro_trong_to_chuc)
               VALUES (?, ?, 'employee')""",
            (user_id, organization_id),
        )
        cursor.execute(
            """INSERT INTO chu_dau_tu
                   (id, organization_id, owner_type, ma_chu_dau_tu, ten_chu_dau_tu)
               VALUES (?, ?, 'organization', 'INV-1', 'Chủ đầu tư test')""",
            (investor_id, organization_id),
        )
        repository = ProcurementImportRepository(cursor)
        reconciler = ProcurementPlanReconciler(repository)
        revision_00 = _revision("00", f"rev-00-{token}", [_package("A")])
        revision_00["familyNo"] = family_no
        revision_00["plan"]["investorId"] = investor_id
        revision_00["revisionDigest"] = canonical_digest(revision_00)
        revision_01 = _revision(
            "01", f"rev-01-{token}", [_package("A"), _package("B")]
        )
        revision_01["packages"][1]["noticeLink"] = {
            "state": "LINKED", "noticeNo": "IB2699999999", "kind": "TBMT",
            "noticeRevisionId": f"notice-rev-00-{token}", "noticeVersion": "00",
        }
        revision_01["packages"][1]["noticeFields"] = {
            "status": "AWARDED",
            "publishedAt": "2026-03-01T08:00:00+07:00",
            "bidClosingAt": "2026-03-15T09:00:00+07:00",
            "bidOpeningAt": "2026-03-15T09:00:00+07:00",
            "actualOpeningAt": "2026-03-15T09:08:42+07:00",
        }
        revision_01["packages"][1].update({
            "bidGuaranteeVnd": 52_183_040,
            "approvalDecisionNo": "123/QĐ-E-HSMT",
            "approvalDecisionDate": "2026-03-01",
            "actualOpeningAt": "2026-03-15T09:08:42+07:00",
        })
        revision_01["familyNo"] = family_no
        revision_01["plan"]["investorId"] = investor_id
        revision_01["revisionDigest"] = canonical_digest(revision_01)

        first = reconciler.reconcile_revision(
            organization_id=organization_id, actor_user_id=user_id,
            provider="VNEPS", revision=revision_00,
            idempotency_key=f"{token}:00", expected_plan_row_version=None,
        )
        assert first["syncVersion"] > 0
        first_a = first["createdPackages"][0]
        plan_sync_version = cursor.execute(
            "SELECT sync_version FROM ke_hoach_lcnt WHERE id = ?",
            (first["createdPlans"][0]["id"],),
        ).fetchone()[0]
        package_sync_version = cursor.execute(
            "SELECT sync_version FROM goi_thau WHERE id = ?",
            (first_a["id"],),
        ).fetchone()[0]
        assert plan_sync_version == package_sync_version == first["syncVersion"]
        assert cursor.execute(
            """SELECT COUNT(*) FROM websocket_events
                WHERE organization_id = ? AND event_type = 'broadcast'
                  AND payload_json LIKE '%%db_changed%%'""",
            (organization_id,),
        ).fetchone()[0] >= 1
        assert cursor.execute(
            "SELECT trang_thai FROM goi_thau WHERE id = ?",
            (first_a["id"],),
        ).fetchone()[0] == "PREPARING"
        cursor.execute(
            """INSERT INTO goi_thau_phan_lo
                   (id, organization_id, owner_type, goi_thau_id,
                    ma_phan_lo, ma_phan_lo_normalized, ten_phan_lo, sort_order)
               VALUES (?, ?, 'organization', ?, 'L01', 'l01', 'Lô số 01', 0)""",
            (f"lot-source-{token}", organization_id, first_a["id"]),
        )
        cursor.execute(
            """INSERT INTO goi_thau_hang_hoa
                   (id, organization_id, owner_type, goi_thau_id, phan_lo_id,
                    ma_hang_hoa, ten_hang_hoa, don_vi_tinh, so_luong, sort_order)
               VALUES (?, ?, 'organization', ?, ?, 'HH-01', 'Hàng hóa 01',
                       'Bộ', 2, 0)""",
            (
                f"goods-source-{token}", organization_id, first_a["id"],
                f"lot-source-{token}",
            ),
        )
        cursor.execute(
            "UPDATE goi_thau SET trang_thai = 'INVITED' WHERE id = ?",
            (first_a["id"],),
        )
        cursor.execute(
            """INSERT INTO nha_thau
                   (id, organization_id, owner_type, ten_nha_thau)
               VALUES (?, ?, 'organization', 'Nhà thầu fixture')""",
            (f"contractor-{token}", organization_id),
        )
        cursor.execute(
            """INSERT INTO thong_tin_mo_thau
                   (id, organization_id, owner_type, goi_thau_id, nha_thau_id,
                    ma_phan_lo, ma_phan_lo_normalized, gia_du_thau,
                    ten_nha_thau, loai_nha_thau)
               VALUES (?, ?, 'organization', ?, ?, 'L01', 'l01', 900,
                       'Nhà thầu fixture', 'Độc lập')""",
            (
                f"opening-source-{token}", organization_id, first_a["id"],
                f"contractor-{token}",
            ),
        )
        second = reconciler.reconcile_revision(
            organization_id=organization_id, actor_user_id=user_id,
            provider="VNEPS", revision=revision_01,
            idempotency_key=f"{token}:01", expected_plan_row_version=1,
        )

        plans = cursor.execute(
            """SELECT phien_ban, is_latest FROM ke_hoach_lcnt
                WHERE organization_id = ? AND ma_ke_hoach = ? ORDER BY phien_ban""",
            (organization_id, family_no),
        ).fetchall()
        assert [tuple(row) for row in plans] == [(0, 0), (1, 1)]
        second_packages = {row["symbol"]: row for row in second["createdPackages"]}
        assert second_packages["A"]["rootId"] == first_a["rootId"]
        assert second_packages["A"]["localVersion"] == 0
        assert second_packages["B"]["localVersion"] == 0
        linked_b = cursor.execute(
            """SELECT trang_thai, thoi_gian_dong_thau, thoi_gian_mo_thau,
                      thoi_gian_dang_tai, so_quyet_dinh, ngay_quyet_dinh,
                          gia_tri_dam_bao_du_thau, yeu_cau_tham_dinh_hsmt,
                          yeu_cau_tham_dinh_hsmt_code
                 FROM goi_thau WHERE organization_id = ? AND id = ?""",
            (organization_id, second_packages["B"]["id"]),
        ).fetchone()
        assert tuple(linked_b) == (
            "INVITED", "2026-03-15 09:00:00", None,
            "2026-03-01 08:00:00", "123/QĐ-E-HSMT", "2026-03-01",
            52_183_040, "Không", "NOT_REQUIRED",
        )
        assert cursor.execute(
            """SELECT COUNT(*) FROM thong_tin_mo_thau
                WHERE organization_id = ? AND goi_thau_id = ?""",
            (organization_id, second_packages["B"]["id"]),
        ).fetchone()[0] == 0
        assert cursor.execute(
            """SELECT COUNT(*) FROM procurement_source_revision
                WHERE organization_id = ? AND entity_kind = 'NOTICE'
                  AND family_key = 'IB2699999999'
                  AND revision_no = '00'""",
            (organization_id,),
        ).fetchone()[0] == 1
        inherited_status = cursor.execute(
            "SELECT trang_thai FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, second_packages["A"]["id"]),
        ).fetchone()[0]
        assert inherited_status == "INVITED"
        inherited_lot = cursor.execute(
            """SELECT id, goi_thau_id, ma_phan_lo
                 FROM goi_thau_phan_lo
                WHERE organization_id = ? AND goi_thau_id = ?""",
            (organization_id, second_packages["A"]["id"]),
        ).fetchone()
        assert inherited_lot is not None
        assert inherited_lot[0] != f"lot-source-{token}"
        assert inherited_lot[1] == second_packages["A"]["id"]
        assert inherited_lot[2] == "L01"
        inherited_goods = cursor.execute(
            """SELECT id, goi_thau_id, phan_lo_id, ma_hang_hoa
                 FROM goi_thau_hang_hoa
                WHERE organization_id = ? AND goi_thau_id = ?""",
            (organization_id, second_packages["A"]["id"]),
        ).fetchone()
        assert inherited_goods is not None
        assert inherited_goods[0] != f"goods-source-{token}"
        assert inherited_goods[1] == second_packages["A"]["id"]
        assert inherited_goods[2] == inherited_lot[0]
        assert inherited_goods[3] == "HH-01"
        inherited_opening = cursor.execute(
            """SELECT id, goi_thau_id, nha_thau_id, ma_phan_lo
                 FROM thong_tin_mo_thau
                WHERE organization_id = ? AND goi_thau_id = ?""",
            (organization_id, second_packages["A"]["id"]),
        ).fetchone()
        assert inherited_opening is not None
        assert inherited_opening[0] != f"opening-source-{token}"
        assert inherited_opening[1] == second_packages["A"]["id"]
        assert inherited_opening[2] == f"contractor-{token}"
        assert inherited_opening[3] == "L01"
        assert cursor.execute(
            """SELECT COUNT(*) FROM procurement_source_revision
                WHERE organization_id = ? AND family_key = ?""",
            (organization_id, family_no),
        ).fetchone()[0] == 2
        notice_result = ProcurementNoticeReconciler(repository).reconcile_revision(
            organization_id=organization_id,
            actor_user_id=user_id,
            provider="VNEPS",
            notice={
                "noticeNo": "IB2699999999",
                "revisionId": f"notice-rev-01-{token}",
                "revisionNumber": "01",
                "kind": "TBMT",
                "status": "PUBLISHED",
                "bidClosingAt": "2026-03-16T09:00:00+07:00",
                "relationship": {
                    "planNo": family_no,
                    "planDetailRevisionId": "detail-B",
                },
            },
            idempotency_key=f"{token}:notice:01",
            expected_package_row_version=1,
        )
        notice_package = notice_result["createdPackages"][0]
        assert notice_result["createdPlans"] == []
        assert notice_package["rootId"] == second_packages["B"]["rootId"]
        assert notice_package["planSnapshotId"] == second_packages["B"]["planSnapshotId"]
        assert notice_package["localVersion"] == 1
        assert cursor.execute(
            """SELECT COUNT(*) FROM ke_hoach_lcnt
                WHERE organization_id = ? AND ma_ke_hoach = ?""",
            (organization_id, family_no),
        ).fetchone()[0] == 2
        package_versions = cursor.execute(
            """SELECT phien_ban, is_latest FROM goi_thau
                WHERE organization_id = ?
                  AND COALESCE(NULLIF(id_goc, ''), id) = ?
                  AND ke_hoach_id = ? ORDER BY phien_ban""",
            (
                organization_id, second_packages["B"]["rootId"],
                second_packages["B"]["planSnapshotId"],
            ),
        ).fetchall()
        assert [tuple(row) for row in package_versions] == [(0, 0), (1, 1)]
        binding_snapshots = cursor.execute(
            """SELECT local_snapshot_id FROM procurement_source_binding
                WHERE organization_id = ? AND provider = 'VNEPS'
                  AND plan_revision_uuid = ? AND id_detail = 'detail-B'
                ORDER BY local_snapshot_id""",
            (organization_id, revision_01["revisionId"]),
        ).fetchall()
        assert {row[0] for row in binding_snapshots} == {
            second_packages["B"]["id"], notice_package["id"],
        }
        operation = {
            "id": f"operation-{token}", "organizationId": organization_id,
            "provider": "VNEPS", "familyNo": family_no,
            "totalRevisions": 2, "bundleDigest": "sha256:" + "a" * 64,
            "revisionResults": [], "idempotencyKey": f"all:{token}",
            "requestHash": "a" * 64, "actorUserId": user_id,
        }
        created_operation = repository.create_operation(operation)
        assert created_operation["requestHash"] == "a" * 64
        assert repository.create_operation(operation)["idempotencyKey"] == f"all:{token}"
        with pytest.raises(ImportConflict, match="PROCUREMENT_IDEMPOTENCY_CONFLICT"):
            repository.create_operation({**operation, "requestHash": "b" * 64})
        with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
            cursor.execute(
                """UPDATE procurement_source_revision SET revision_no = '99'
                    WHERE organization_id = ? AND revision_uuid = ?""",
                (organization_id, revision_00["revisionId"]),
            )
    finally:
        connection.rollback()
        connection.close()
