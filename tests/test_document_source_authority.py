from types import SimpleNamespace

import pytest

from backend.documents.document_job_policy import (
    DocumentJobAuthorizationError,
    build_document_job_policy,
    document_source_digest,
    document_job_policy_hash,
    verify_document_job_policy,
)
from backend.documents.document_source_authority import (
    verify_document_job_source_authority,
)


def _job(policy, fingerprint):
    return {
        "organization_id": "org-1",
        "user_id": "user-1",
        "record_type": "goi_thau",
        "record_id": "package-1",
        "policy_json": policy,
        "policy_hash": fingerprint,
    }


def test_unrelated_workspace_mutation_does_not_change_exact_word_authority(
    monkeypatch,
):
    context = {"goi_thau": {"id": "package-1", "ten_goi_thau": "Gói 1"}}
    manifest = {"document_type": "evaluation", "record_revision": 4}
    digest = document_source_digest(context, manifest)
    role = SimpleNamespace(
        platform_role="user",
        active_role="employee",
        active_role_organization_id="org-1",
    )
    policy, fingerprint = build_document_job_policy(
        role,
        record_type="goi_thau",
        record_id="package-1",
        record_revision=4,
        sync_revision=10,
        source_digest=digest,
        source_document_type="evaluation",
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._prepare_report_render",
        lambda *_args, **_kwargs: (context, manifest, None, []),
    )

    assert verify_document_job_source_authority(_job(policy, fingerprint)) is True


def test_real_word_dependency_change_invalidates_the_job(monkeypatch):
    original = {"goi_thau": {"id": "package-1", "ten_goi_thau": "Gói 1"}}
    changed = {"goi_thau": {"id": "package-1", "ten_goi_thau": "Gói đã đổi"}}
    manifest = {"document_type": "evaluation", "record_revision": 4}
    role = SimpleNamespace(
        platform_role="user",
        active_role="employee",
        active_role_organization_id="org-1",
    )
    policy, fingerprint = build_document_job_policy(
        role,
        record_type="goi_thau",
        record_id="package-1",
        record_revision=4,
        source_digest=document_source_digest(original, manifest),
        source_document_type="evaluation",
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._prepare_report_render",
        lambda *_args, **_kwargs: (changed, manifest, None, []),
    )

    with pytest.raises(DocumentJobAuthorizationError) as error:
        verify_document_job_source_authority(_job(policy, fingerprint))

    assert error.value.code == "DOCUMENT_EXPORT_SOURCE_CHANGED"


def test_exact_source_policy_does_not_use_tenant_sync_revision(monkeypatch):
    class Cursor:
        def execute(self, statement, _parameters=()):
            normalized = " ".join(statement.split())
            if "FROM tai_khoan" in normalized:
                self.row = ("user-1", "active", "user")
            elif "FROM goi_thau" in normalized:
                self.row = (4,)
            elif "FROM sync_metadata" in normalized:
                raise AssertionError("tenant sync revision must not be authority")
            else:
                self.row = None
            return self

        def fetchone(self):
            return self.row

    role = SimpleNamespace(
        platform_role="user",
        active_role="employee",
        active_role_organization_id="org-1",
    )
    policy, fingerprint = build_document_job_policy(
        role,
        record_type="goi_thau",
        record_id="package-1",
        record_revision=4,
        sync_revision=10,
        source_digest="a" * 64,
        source_document_type="evaluation",
    )
    monkeypatch.setattr(
        "backend.documents.document_job_policy.can_use_document_export",
        lambda *_args, **_kwargs: True,
    )
    monkeypatch.setattr(
        "backend.documents.document_job_policy.can_read_record",
        lambda *_args, **_kwargs: True,
    )
    monkeypatch.setattr(
        "backend.documents.document_job_policy.resolve_document_export_capabilities",
        lambda *_args, **_kwargs: SimpleNamespace(),
    )

    assert verify_document_job_policy(Cursor(), _job(policy, fingerprint)) is True


def test_plan_policy_v3_rebuilds_the_same_exact_basis_selection(monkeypatch):
    context = {"ke_hoach": {"id": "plan-1"}, "ds_can_cu_lap_ke_hoach": []}
    manifest = {
        "document_type": "plan",
        "record_revision": 4,
        "plan_basis_selection_mode": "explicit",
        "plan_basis_ids": ["khcc-2"],
    }
    role = SimpleNamespace(
        platform_role="user", active_role="employee",
        active_role_organization_id="org-1",
    )
    policy, fingerprint = build_document_job_policy(
        role,
        record_type="ke_hoach_lcnt",
        record_id="plan-1",
        record_revision=4,
        source_digest=document_source_digest(context, manifest),
        source_document_type="plan",
        plan_basis_selection_mode="explicit",
        selected_plan_basis_ids=["khcc-2"],
    )
    captured = {}

    def prepare(*_args, **kwargs):
        captured.update(kwargs)
        return context, manifest, None, []

    monkeypatch.setattr("backend.documents.routes_docx._prepare_plan_render", prepare)
    job = {
        "organization_id": "org-1", "user_id": "user-1",
        "record_type": "ke_hoach_lcnt", "record_id": "plan-1",
        "policy_json": policy, "policy_hash": fingerprint,
    }
    assert verify_document_job_source_authority(job) is True
    assert captured["selected_plan_basis_ids"] == ["khcc-2"]
    assert captured["include_plan_basis_mapping"] is True
    assert captured["plan_basis_selection_mode_override"] == "explicit"


def test_legacy_plan_policy_v2_rebuild_does_not_add_the_new_basis_root(monkeypatch):
    context = {"ke_hoach": {"id": "plan-1"}}
    manifest = {"document_type": "plan", "record_revision": 4}
    role = SimpleNamespace(
        platform_role="user", active_role="employee",
        active_role_organization_id="org-1",
    )
    policy, _fingerprint = build_document_job_policy(
        role,
        record_type="ke_hoach_lcnt", record_id="plan-1", record_revision=4,
        source_digest=document_source_digest(context, manifest),
        source_document_type="plan",
    )
    policy["version"] = 2
    policy.pop("planBasisSelectionMode")
    policy.pop("selectedPlanBasisIds")
    fingerprint = document_job_policy_hash(policy)
    captured = {}

    def prepare(*_args, **kwargs):
        captured.update(kwargs)
        return context, manifest, None, []

    monkeypatch.setattr("backend.documents.routes_docx._prepare_plan_render", prepare)
    job = {
        "organization_id": "org-1", "user_id": "user-1",
        "record_type": "ke_hoach_lcnt", "record_id": "plan-1",
        "policy_json": policy, "policy_hash": fingerprint,
    }
    assert verify_document_job_source_authority(job) is True
    assert captured["include_plan_basis_mapping"] is False
    assert captured["selected_plan_basis_ids"] is None
