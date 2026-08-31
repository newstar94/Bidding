import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.documents import document_job_routes
from backend.documents.export_policy_registry import export_policy
from backend.documents.document_job_policy import (
    MAX_POLICY_JSON_BYTES,
    build_document_job_policy,
    document_job_record_scope,
    document_job_policy_hash,
    validate_document_job_policy_snapshot,
    verify_document_job_policy,
)
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    _upgrade_to_v76_generic_document_jobs,
)


def _role(record_id="user"):
    return SimpleNamespace(
        user_id=record_id,
        platform_role="user",
        active_role="employee",
        active_role_organization_id="org",
    )


def _v2_policy(*, record_type="ke_hoach_lcnt", record_id="plan-1"):
    return build_document_job_policy(
        _role(),
        record_type=record_type,
        record_id=record_id,
        record_revision=7,
        required_sensitive_groups=["signature"],
        document_format="docx",
    )


def test_policy_v3_binds_generic_record_and_keeps_v1_package_adapter():
    policy, fingerprint = _v2_policy()

    assert policy == {
        "version": 3,
        "format": "docx",
        "platformRole": "user",
        "activeRole": "employee",
        "activeRoleOrganizationId": "org",
        "requiredSensitiveGroups": ["signature"],
        "recordType": "ke_hoach_lcnt",
        "recordId": "plan-1",
        "recordRevision": 7,
        "planBasisSelectionMode": "all",
        "selectedPlanBasisIds": [],
    }
    assert len(fingerprint) == 64
    legacy, _legacy_fingerprint = build_document_job_policy(
        _role(), package_revision=7, document_format="docx"
    )
    assert legacy["version"] == 1
    assert legacy["packageRevision"] == 7
    assert "recordType" not in legacy


def test_legacy_policy_keeps_original_provenance_revision_compatibility():
    legacy, _fingerprint = build_document_job_policy(
        _role(),
        package_revision=8,
        document_format="docx",
        artifact_provenance={
            "templateVersionId": "version-1",
            "templateSha256": "1" * 64,
            "recordType": "goi_thau",
            "recordId": "package-1",
            "recordRowVersion": 7,
        },
    )

    assert validate_document_job_policy_snapshot(
        legacy, document_job_policy_hash(legacy)
    ) == legacy


def test_policy_v2_accepts_batch_provenance_for_one_exact_record():
    provenances = [
        {
            "templateVersionId": f"version-{index}",
            "templateSha256": str(index) * 64,
            "recordType": "goi_thau",
            "recordId": "package-1",
            "recordRowVersion": 7,
        }
        for index in (1, 2)
    ]
    policy, _fingerprint = build_document_job_policy(
        _role(),
        record_type="goi_thau",
        record_id="package-1",
        record_revision=7,
        document_format="docx",
        artifact_provenance=provenances,
    )

    assert policy["artifactProvenance"] == provenances
    assert document_job_record_scope({
        "record_type": "goi_thau",
        "record_id": "package-1",
        "policy_json": policy,
    }) == {
        "record_type": "goi_thau",
        "record_id": "package-1",
        "record_revision": 7,
        "module": "goithau",
        "table": "goi_thau",
    }


def test_policy_v2_supports_fifty_templates_but_rejects_oversized_metadata():
    provenances = [
        {
            "templateVersionId": f"wtv-{index:02d}-" + "v" * 36,
            "templateSha256": f"{index:064x}",
            "recordType": "goi_thau",
            "recordId": "package-1",
            "recordRowVersion": 7,
        }
        for index in range(50)
    ]
    policy, _fingerprint = build_document_job_policy(
        _role(),
        record_type="goi_thau",
        record_id="package-1",
        record_revision=7,
        document_format="docx",
        artifact_provenance=provenances,
    )
    encoded = json.dumps(
        policy,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    assert len(policy["artifactProvenance"]) == 50
    assert len(encoded) <= MAX_POLICY_JSON_BYTES

    oversized = [dict(provenances[0])]
    oversized[0]["templateVersionId"] = "v" * MAX_POLICY_JSON_BYTES
    with pytest.raises(ValueError, match="DOCUMENT_EXPORT_POLICY_TOO_LARGE"):
        build_document_job_policy(
            _role(),
            record_type="goi_thau",
            record_id="package-1",
            record_revision=7,
            document_format="docx",
            artifact_provenance=oversized,
        )


class _PolicyCursor:
    def __init__(self, sync_version=12):
        self.statements = []
        self.row = None
        self.sync_version = sync_version

    def execute(self, statement, params=()):
        normalized = " ".join(statement.split())
        self.statements.append((normalized, tuple(params)))
        if "FROM tai_khoan" in normalized:
            self.row = ("user", "active", "user")
        elif "FROM ke_hoach_lcnt" in normalized:
            self.row = (7,)
        elif "FROM sync_metadata" in normalized:
            self.row = (self.sync_version,)
        else:
            self.row = None
        return self

    def fetchone(self):
        return self.row


def test_word_job_rejects_dependency_change_even_when_root_revision_is_unchanged(
    monkeypatch,
):
    policy, fingerprint = build_document_job_policy(
        _role(),
        record_type="ke_hoach_lcnt",
        record_id="plan-1",
        record_revision=7,
        sync_revision=11,
        required_sensitive_groups=["signature"],
        document_format="docx",
    )
    cursor = _PolicyCursor(sync_version=12)
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
        lambda *_args, **_kwargs: SimpleNamespace(signature=True),
    )

    with pytest.raises(PermissionError, match="DOCUMENT_EXPORT_SOURCE_CHANGED"):
        verify_document_job_policy(
            cursor,
            {
                "organization_id": "org",
                "user_id": "user",
                "record_type": "ke_hoach_lcnt",
                "record_id": "plan-1",
                "policy_json": policy,
                "policy_hash": fingerprint,
            },
        )


def test_plan_job_reauthorization_uses_existing_plan_module_and_record_scope(
    monkeypatch,
):
    policy, fingerprint = _v2_policy()
    cursor = _PolicyCursor()
    observed = {}
    monkeypatch.setattr(
        "backend.documents.document_job_policy.can_use_document_export",
        lambda *_args, **_kwargs: True,
    )

    def can_read(*args):
        observed["can_read"] = args
        return True

    monkeypatch.setattr(
        "backend.documents.document_job_policy.can_read_record", can_read
    )
    monkeypatch.setattr(
        "backend.documents.document_job_policy.resolve_document_export_capabilities",
        lambda *_args, **_kwargs: SimpleNamespace(signature=True),
    )

    assert verify_document_job_policy(
        cursor,
        {
            "organization_id": "org",
            "user_id": "user",
            "package_id": None,
            "record_type": "ke_hoach_lcnt",
            "record_id": "plan-1",
            "policy_json": policy,
            "policy_hash": fingerprint,
        },
    )
    assert any("FROM ke_hoach_lcnt" in sql for sql, _params in cursor.statements)
    assert observed["can_read"][-3:] == (
        "kehoach",
        "ke_hoach_lcnt",
        "plan-1",
    )


def test_multi_template_selection_creates_one_batch_job_payload():
    prepared = document_job_routes._prepare_render_job(
        [
            {
                "content": b"first",
                "filename": "first.docx",
                "templateVersionId": "version-1",
                "templateSha256": "1" * 64,
            },
            {
                "content": b"second",
                "filename": "second.docx",
                "templateVersionId": "version-2",
                "templateSha256": "2" * 64,
            },
        ],
        {"goi_thau": {"id": "package-1"}},
        {"documentType": "evaluation"},
        fallback_filename="Bao_cao.docx",
        record_type="goi_thau",
        record_id="package-1",
        record_revision=7,
    )

    assert prepared["operation"] == "render_docx_batch"
    assert prepared["filename"] == "Bao_cao.zip"
    assert prepared["content_type"] == "application/zip"
    assert [item["filename"] for item in prepared["payload"]["templates"]] == [
        "first.docx",
        "second.docx",
    ]
    assert prepared["template_count"] == 2
    assert len(prepared["artifact_provenance"]) == 2


def test_enqueue_batch_persists_generic_identity_and_initial_progress(monkeypatch):
    captured = {}

    class Connection:
        def execute(self, statement, params=()):
            assert "FROM goi_thau" in statement
            assert params == ("org", "package-1")
            return SimpleNamespace(fetchone=lambda: (7,))

        def close(self):
            return None

    class Database:
        def get_connection(self):
            return Connection()

    async def run_write(function, *args, **kwargs):
        captured.update({"function": function, "args": args, "kwargs": kwargs})
        return "a" * 32

    monkeypatch.setattr(document_job_routes, "database", Database())
    monkeypatch.setattr(document_job_routes, "run_database_write", run_write)
    monkeypatch.setattr(document_job_routes, "get_client_ip", lambda _request: "ip")
    response = asyncio.run(document_job_routes._enqueue_prepared_word_export(
        SimpleNamespace(),
        _role(),
        "org",
        record_type="goi_thau",
        record_id="package-1",
        document_type="evaluation",
        context={"goi_thau": {"id": "package-1", "row_version": 7}},
        manifest={"documentType": "evaluation", "record_revision": 7},
        template_selection=[
            {"content": b"one", "filename": "one.docx"},
            {"content": b"two", "filename": "two.docx"},
        ],
        sensitive_groups=["signature"],
        fallback_filename="Bao_cao.docx",
    ))

    assert response.status_code == 202
    assert captured["args"][0] == "render_docx_batch"
    assert captured["kwargs"]["package_id"] == "package-1"
    assert captured["kwargs"]["record_type"] == "goi_thau"
    assert captured["kwargs"]["record_id"] == "package-1"
    assert captured["kwargs"]["progress_phase"] == "queued"
    assert captured["kwargs"]["progress_completed_items"] == 0
    assert captured["kwargs"]["progress_total_items"] == 2
    assert captured["kwargs"]["policy"]["version"] == 3
    assert json.loads(response.body)["totalItems"] == 2


def test_enqueue_rejects_context_when_record_revision_changed(monkeypatch):
    class Connection:
        def execute(self, _statement, _params=()):
            return SimpleNamespace(fetchone=lambda: (8,))

        def close(self):
            return None

    class Database:
        def get_connection(self):
            return Connection()

    monkeypatch.setattr(document_job_routes, "database", Database())
    response = asyncio.run(document_job_routes._enqueue_prepared_word_export(
        SimpleNamespace(),
        _role(),
        "org",
        record_type="goi_thau",
        record_id="package-1",
        document_type="evaluation",
        context={"goi_thau": {"id": "package-1", "row_version": 7}},
        manifest={"documentType": "evaluation", "record_revision": 7},
        template_selection={"path": "unused.docx"},
        sensitive_groups=[],
        fallback_filename="Bao_cao.docx",
    ))

    assert response.status_code == 409
    assert json.loads(response.body)["code"] == "DOCUMENT_EXPORT_SOURCE_CHANGED"


def test_status_contract_exposes_phase_and_item_counts(monkeypatch):
    async def run_read(_function, _request):
        return (
            (SimpleNamespace(), "org"),
            {
                "id": "a" * 32,
                "status": "processing",
                "attempt_count": 1,
                "expires_at": 2_000_000_000,
                "cancelled_at": None,
                "progress_phase": "rendering",
                "progress_completed_items": 1,
                "progress_total_items": 3,
            },
            None,
        )

    monkeypatch.setattr(document_job_routes, "run_database_read", run_read)
    response = asyncio.run(
        document_job_routes.document_export_job_status_api(SimpleNamespace())
    )
    body = json.loads(response.body)
    assert body["phase"] == "rendering"
    assert body["completedItems"] == 1
    assert body["totalItems"] == 3


def test_routes_expose_plan_background_export():
    class Route:
        def __init__(self, path, endpoint, methods):
            self.path = path
            self.endpoint = endpoint
            self.methods = methods

    methods = {
        (route.path, tuple(route.methods))
        for route in document_job_routes.document_job_routes(Route)
    }
    assert ("/api/document-jobs/plan/{plan_id}", ("POST",)) in methods


def test_shared_download_and_retry_use_generic_job_record_policy():
    assert (
        document_job_routes.download_document_export_job_api.export_policy_operation
        == "docx.document_job"
    )
    assert (
        document_job_routes.retry_document_export_job_api.export_policy_operation
        == "docx.document_job"
    )
    assert export_policy("docx.document_job").resource_scope == "job_record"


@pytest.mark.parametrize(
    ("record_type", "record_id", "expected_scope"),
    (
        ("goi_thau", "package-1", ("goithau", "goi_thau", "package-1")),
        (
            "ke_hoach_lcnt",
            "plan-1",
            ("kehoach", "ke_hoach_lcnt", "plan-1"),
        ),
    ),
)
def test_job_access_dispatches_package_and_plan_to_their_existing_scope(
    monkeypatch, record_type, record_id, expected_scope
):
    policy, fingerprint = build_document_job_policy(
        _role(),
        record_type=record_type,
        record_id=record_id,
        record_revision=7,
        document_format="docx",
    )
    job = {
        "id": "a" * 32,
        "organization_id": "org",
        "user_id": "user",
        "package_id": record_id if record_type == "goi_thau" else None,
        "record_type": record_type,
        "record_id": record_id,
        "policy_json": policy,
        "policy_hash": fingerprint,
    }
    observed = {}

    class Connection:
        def cursor(self):
            return self

        def close(self):
            return None

    class Database:
        def get_connection(self):
            return Connection()

    def can_read(*args):
        observed["scope"] = args[-3:]
        return True

    monkeypatch.setattr(document_job_routes, "database", Database())
    monkeypatch.setattr(
        document_job_routes, "verify_session", lambda _request: (True, _role())
    )
    monkeypatch.setattr(
        document_job_routes,
        "get_active_org",
        lambda *_args, **_kwargs: "org",
    )
    monkeypatch.setattr(
        document_job_routes,
        "get_document_export_job",
        lambda *_args, **_kwargs: job,
    )
    monkeypatch.setattr(document_job_routes, "can_read_record", can_read)
    monkeypatch.setattr(
        document_job_routes,
        "verify_document_job_policy",
        lambda *_args, **_kwargs: True,
    )

    access, returned_job, error = document_job_routes._job_access(
        SimpleNamespace(path_params={"job_id": "a" * 32})
    )
    assert error is None
    assert access[1] == "org"
    assert returned_job is job
    assert observed["scope"] == expected_scope


def test_current_schema_keeps_v76_generic_job_fields():
    columns = SCHEMA_DINH_NGHIA["document_jobs"]["columns"]
    # Commercial schema migration v79 remains in the current schema contract; the
    # generic document-job fields introduced in v76 remain present.
    assert DB_SCHEMA_VERSION == 90
    assert {
        "record_type",
        "record_id",
        "progress_phase",
        "progress_completed_items",
        "progress_total_items",
    } <= set(columns)
    assert "length(policy_json) <= 65536" in columns["policy_json"]

    class Cursor:
        def __init__(self):
            self.statements = []

        def execute(self, statement, _params=()):
            self.statements.append(" ".join(statement.split()))
            return self

    cursor = Cursor()
    _upgrade_to_v76_generic_document_jobs(cursor, None)
    sql = "\n".join(cursor.statements)
    assert "ADD COLUMN IF NOT EXISTS record_type" in sql
    assert "record_type = 'goi_thau', record_id = package_id" in sql
    assert "DROP CONSTRAINT IF EXISTS document_jobs_policy_json_check" in sql
    assert "CHECK(length(policy_json) <= 65536)" in sql
    assert "idx_document_jobs_record_owner" in sql
