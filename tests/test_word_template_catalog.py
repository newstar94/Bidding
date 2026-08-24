from __future__ import annotations

import hashlib
import json
import os
import uuid
from contextlib import nullcontext
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from zipfile import ZIP_DEFLATED, ZipFile

import psycopg
import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.documents.template_catalog.repository import (
    WordTemplateCatalogRepository,
)
from backend.documents.template_catalog.preflight import (
    MAX_PREFLIGHT_REPORT_BYTES,
    TemplatePreflight,
)
from backend.documents.template_catalog.compatibility import (
    CatalogPublicationResolver,
    LegacyAliasProjectionWorker,
)
from backend.documents.template_catalog.routes import (
    _prepare_catalog_preview,
    _prepare_standardization_source,
    _public_result,
    _required_idempotency_key,
    _standardization_idempotency_replay,
    list_catalog_templates_api,
    preview_standardized_version_api,
    run_catalog_preflight_api,
)
from backend.documents.template_catalog.service import (
    CatalogError,
    CatalogConflictError,
    CatalogNotFoundError,
    WordTemplateCatalog,
)
from backend.documents.template_catalog.storage import ImmutableTemplateStorage
from backend.documents.document_ipc import read_job_manifest, write_job_manifest
from backend.documents.document_worker import DocumentWorkerInputError


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip('"').strip("'")
    return ""


def _minimal_docx(template_xml: str) -> bytes:
    target = BytesIO()
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8"?><Types/>',
        )
        archive.writestr(
            "word/document.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            f"<document><body><p>{template_xml}</p></body></document>",
        )
    return target.getvalue()


def test_content_addressed_storage_is_tenant_bound_and_immutable(tmp_path):
    storage = ImmutableTemplateStorage(tmp_path)
    content = b"sanitized-docx-content"

    key, digest, size = storage.put("org-a", content)

    assert digest == hashlib.sha256(content).hexdigest()
    assert size == len(content)
    assert storage.read("org-a", key, digest) == content
    assert storage.put("org-a", content) == (key, digest, size)
    with pytest.raises(ValueError):
        storage.read("org-b", key, digest)
    with pytest.raises(ValueError):
        storage.read("org-a", "../../outside.docx", digest)


def test_catalog_http_kill_switch_and_public_projection_hide_storage_key(
    monkeypatch,
):
    monkeypatch.setenv("WORD_TEMPLATE_CATALOG_ENABLED", "false")
    client = TestClient(Starlette(routes=[
        Route("/api/word-template-catalog", list_catalog_templates_api),
    ]))

    response = client.get("/api/word-template-catalog")

    assert response.status_code == 404
    projected = _public_result({
        "template": {"id": "template-a"},
        "versions": [{
            "id": "version-a",
            "templateId": "template-a",
            "sha256": "a" * 64,
            "storageKey": "must-not-leak",
        }],
    })
    assert "storageKey" not in projected["versions"][0]


def test_standardizer_input_failure_does_not_block_compatibility_preflight(
    monkeypatch,
):
    import backend.documents.template_catalog.routes as catalog_routes

    monkeypatch.setenv("WORD_TEMPLATE_CATALOG_ENABLED", "true")
    role = SimpleNamespace(user_id="manager-a")

    async def fake_read(*_args, **_kwargs):
        return {
            "role": role,
            "organizationId": "org-a",
            "version": {"id": "version-a", "content": b"legacy-docx"},
        }

    async def fake_worker(*_args, **_kwargs):
        raise DocumentWorkerInputError("legacy construct is unsupported")

    class Preflight:
        def __init__(self, *_args, **_kwargs):
            pass

        @staticmethod
        def run(**values):
            unavailable = values["standardization_error"]
            assert values["standardization_report"] is None
            assert unavailable["status"] == "UNAVAILABLE"
            return {
                "id": "preflight-a",
                "result": "PASS",
                "report": {
                    "summary": {"blockers": 0, "warnings": 0},
                    "issues": [],
                    "standardizationUnavailable": unavailable,
                },
            }

    async def fake_write(_adapter, _request, operation, **_kwargs):
        return operation(None, object(), role, "org-a", "organization")

    monkeypatch.setattr(catalog_routes, "run_database_read", fake_read)
    monkeypatch.setattr(catalog_routes, "run_document_job_async", fake_worker)
    monkeypatch.setattr(catalog_routes, "run_database_write", fake_write)
    monkeypatch.setattr(catalog_routes, "TemplatePreflight", Preflight)
    client = TestClient(Starlette(routes=[Route(
        "/api/word-template-catalog/versions/{version_id}/preflight",
        run_catalog_preflight_api,
        methods=["POST"],
    )]))

    response = client.post(
        "/api/word-template-catalog/versions/version-a/preflight",
        json={"documentTypes": [], "standardizationProfile": "sector_template"},
    )

    assert response.status_code == 201
    assert response.json()["result"] == "PASS"
    assert response.json()["report"]["standardizationUnavailable"]["code"] == (
        "WORD_STANDARDIZATION_UNAVAILABLE"
    )


def test_standardization_size_fallback_preserves_near_limit_compatibility():
    base = {"result": "PASS", "padding": ""}
    empty_size = len(json.dumps(
        base, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8"))
    # Leave enough room for the bounded availability marker, but not a full
    # worker report. This models a compatibility payload that fit before the
    # optional standardizer was introduced.
    base["padding"] = "x" * (MAX_PREFLIGHT_REPORT_BYTES - empty_size - 180)
    standardization = {
        "profile": "sector_template",
        "issues": [{"message": "y" * 4096}],
    }

    encoded = TemplatePreflight._bounded_report_json(
        base,
        standardization=standardization,
    )
    stored = json.loads(encoded)

    assert len(encoded.encode("utf-8")) <= MAX_PREFLIGHT_REPORT_BYTES
    assert stored["result"] == "PASS"
    assert "standardization" not in stored
    assert stored["standardizationUnavailable"] == {
        "status": "UNAVAILABLE",
        "profile": "sector_template",
        "code": "WORD_STANDARDIZATION_REPORT_SIZE_LIMIT",
    }


def test_standardization_metadata_is_omitted_when_legacy_report_uses_full_cap():
    base = {"padding": ""}
    empty_size = len(json.dumps(
        base, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8"))
    base["padding"] = "x" * (MAX_PREFLIGHT_REPORT_BYTES - empty_size)

    encoded = TemplatePreflight._bounded_report_json(
        base,
        unavailable={
            "status": "UNAVAILABLE",
            "profile": "sector_template",
            "code": "WORD_STANDARDIZATION_UNAVAILABLE",
        },
    )

    assert len(encoded.encode("utf-8")) == MAX_PREFLIGHT_REPORT_BYTES
    assert json.loads(encoded) == base


def test_record_preview_reuses_record_authorization_and_preserves_full_context(
    monkeypatch,
):
    import backend.documents.template_catalog.routes as catalog_routes

    class Connection:
        @staticmethod
        def cursor():
            return object()

        @staticmethod
        def close():
            return None

    class Catalog:
        def __init__(self, *_args, **_kwargs):
            pass

        @staticmethod
        def get_version(_organization_id, version_id, *, include_content=False):
            assert include_content is True
            return {
                "id": version_id,
                "versionNo": 3,
                "sha256": "a" * 64,
                "content": b"template-content",
            }

    role = SimpleNamespace(user_id="user-a")
    allowed = {"value": False}
    monkeypatch.setattr(catalog_routes.database, "get_connection", Connection)
    monkeypatch.setattr(
        catalog_routes, "_context",
        lambda *_args, **_kwargs: (role, "org-a", "organization"),
    )
    monkeypatch.setattr(catalog_routes, "can_use_word_export", lambda *_args: True)
    monkeypatch.setattr(
        catalog_routes, "can_read_record", lambda *_args: allowed["value"],
    )
    monkeypatch.setattr(catalog_routes, "WordTemplateCatalog", Catalog)
    monkeypatch.setattr(
        "backend.documents.routes_docx._prepare_plan_render",
        lambda *_args: (
            {
                "ke_hoach": {
                    "id": "plan-a",
                    "row_version": 9,
                    "so_cccd": "012345678901",
                    "so_tai_khoan": "0123456789",
                }
            },
            {"version": 1},
            None,
            [],
        ),
    )

    with pytest.raises(CatalogNotFoundError):
        _prepare_catalog_preview(
            object(), "version-a",
            {"mode": "RECORD", "documentType": "plan", "recordId": "plan-a"},
        )

    allowed["value"] = True
    prepared = _prepare_catalog_preview(
        object(), "version-a",
        {"mode": "RECORD", "documentType": "plan", "recordId": "plan-a"},
    )

    assert prepared["recordType"] == "ke_hoach_lcnt"
    assert prepared["recordRowVersion"] == 9
    assert prepared["context"]["ke_hoach"]["so_cccd"] == "012345678901"
    assert prepared["context"]["ke_hoach"]["so_tai_khoan"] == "0123456789"


def test_standardized_candidate_preview_uses_read_plus_export_authority(
    monkeypatch,
):
    import backend.documents.template_catalog.routes as catalog_routes

    class Connection:
        @staticmethod
        def cursor():
            return object()

        @staticmethod
        def close():
            return None

    class Catalog:
        def __init__(self, *_args, **_kwargs):
            pass

        @staticmethod
        def get_standardization_candidate(**_kwargs):
            return {
                "version": {"id": "version-a", "content": b"docx"},
                "preflight": {"id": "preflight-a"},
                "standardization": {"profile": "sector_template"},
            }

    role = SimpleNamespace(user_id="user-a")
    writes = []
    entitlement = {"allowed": False}
    monkeypatch.setattr(catalog_routes.database, "get_connection", Connection)
    monkeypatch.setattr(catalog_routes, "WordTemplateCatalog", Catalog)
    monkeypatch.setattr(
        catalog_routes,
        "_context",
        lambda _request, _cursor, *, write=False, **_kwargs: (
            writes.append(write) or (role, "org-a", "organization")
        ),
    )
    monkeypatch.setattr(
        catalog_routes,
        "can_use_word_export",
        lambda *_args: entitlement["allowed"],
    )

    with pytest.raises(CatalogError) as denied:
        _prepare_standardization_source(
            object(), "version-a", "preflight-a", "sector_template", False, True,
        )
    assert denied.value.code == "WORD_EXPORT_ENTITLEMENT_REQUIRED"
    assert writes == [False]

    entitlement["allowed"] = True
    prepared = _prepare_standardization_source(
        object(), "version-a", "preflight-a", "sector_template", False, True,
    )
    assert prepared["version"]["content"] == b"docx"
    assert writes[-1] is False

    _prepare_standardization_source(
        object(), "version-a", "preflight-a", "sector_template", True, False,
    )
    assert writes[-1] is True


def test_standardized_preview_reauthorizes_after_document_worker(
    monkeypatch,
):
    import backend.documents.template_catalog.routes as catalog_routes

    monkeypatch.setenv("WORD_TEMPLATE_CATALOG_ENABLED", "true")
    role = SimpleNamespace(user_id="user-a")
    reads = {"count": 0}
    audits = []

    async def fake_read(*_args, **_kwargs):
        reads["count"] += 1
        if reads["count"] == 2:
            error = CatalogError(fields={"authorization": "DENIED"})
            error.status_code = 403
            error.code = "WORD_TEMPLATE_CATALOG_ACCESS_DENIED"
            raise error
        return {
            "role": role,
            "organizationId": "org-a",
            "version": {
                "id": "version-a",
                "versionNo": 1,
                "sha256": "a" * 64,
                "content": b"source",
            },
            "preflight": {"id": "preflight-a"},
            "standardization": {"analysisHash": "b" * 64},
        }

    async def fake_worker(*_args, **_kwargs):
        return b"standardized"

    monkeypatch.setattr(catalog_routes, "run_database_read", fake_read)
    monkeypatch.setattr(catalog_routes, "run_document_job_async", fake_worker)
    monkeypatch.setattr(
        catalog_routes,
        "log_audit",
        lambda *_args, **_kwargs: audits.append(True),
    )
    client = TestClient(Starlette(routes=[Route(
        "/api/word-template-catalog/versions/{version_id}/standardized-preview",
        preview_standardized_version_api,
        methods=["POST"],
    )]))

    response = client.post(
        "/api/word-template-catalog/versions/version-a/standardized-preview",
        json={
            "acceptedPreflightRunId": "preflight-a",
            "standardizationProfile": "sector_template",
        },
    )

    assert response.status_code == 403
    assert reads["count"] == 2
    assert audits == []


def test_standardized_draft_idempotency_key_is_required_and_payload_bound():
    with pytest.raises(CatalogError):
        _required_idempotency_key(SimpleNamespace(headers={}))
    assert _required_idempotency_key(SimpleNamespace(
        headers={"Idempotency-Key": "wordstd-12345678"},
    )) == "wordstd-12345678"

    class Cursor:
        def __init__(self):
            self.query = ""

        def execute(self, query, _params):
            self.query = query
            return self

        def fetchone(self):
            if "response_json" not in self.query:
                return None
            return (json.dumps({
                "created": True,
                "_requestHash": "a" * 64,
                "_statusCode": 201,
            }),)

    replay = _standardization_idempotency_replay(
        Cursor(),
        actor_user_id="manager-a",
        operation="word-template-standardize:org-a:template-a",
        idempotency_key="wordstd-12345678",
        request_hash="a" * 64,
    )
    assert replay == {"payload": {"created": True}, "statusCode": 201}
    with pytest.raises(CatalogConflictError):
        _standardization_idempotency_replay(
            Cursor(),
            actor_user_id="manager-a",
            operation="word-template-standardize:org-a:template-a",
            idempotency_key="wordstd-12345678",
            request_hash="b" * 64,
        )


def test_catalog_bytes_cross_document_worker_boundary_as_internal_file(tmp_path):
    manifest_path = tmp_path / "input.json"
    write_job_manifest(
        manifest_path,
        "render_docx",
        {
            "template_content": b"immutable-template-bytes",
            "context": {},
            "context_manifest": {"media_organization_id": "org-a"},
        },
        image_root=tmp_path,
    )

    operation, payload = read_job_manifest(manifest_path, tmp_path)

    assert operation == "render_docx"
    template_path = Path(payload["template_path"])
    assert template_path.parent == tmp_path
    assert template_path.read_bytes() == b"immutable-template-bytes"
    assert "template_content" not in payload


def test_cutover_resolver_preserves_order_and_projection_is_atomic(
    tmp_path, monkeypatch,
):
    storage = ImmutableTemplateStorage(tmp_path / "catalog")
    first = storage.put("org-a", b"first-template")
    second = storage.put("org-a", b"second-template")

    class Repository:
        @staticmethod
        def resolve_assignments(_organization_id, _document_type, **_kwargs):
            return [
                {
                    "templateId": "template-a", "resolvedVersionId": "version-a",
                    "sha256": first[1], "byteSize": first[2],
                    "legacyAlias": "first.docx", "storageKey": first[0],
                },
                {
                    "templateId": "template-b", "resolvedVersionId": "version-b",
                    "sha256": second[1], "byteSize": second[2],
                    "legacyAlias": "second.docx", "storageKey": second[0],
                },
            ]

    shadow = CatalogPublicationResolver(
        Repository(), storage,
        environ={
            "WORD_TEMPLATE_CATALOG_ENABLED": "true",
            "WORD_TEMPLATE_CATALOG_MODE": "shadow",
        },
    )
    assert shadow.resolve("org-a", "procurement_plan") is None
    resolver = CatalogPublicationResolver(
        Repository(), storage,
        environ={
            "WORD_TEMPLATE_CATALOG_ENABLED": "true",
            "WORD_TEMPLATE_CATALOG_MODE": "cutover",
        },
    )
    resolved = resolver.resolve("org-a", "procurement_plan")
    assert [item["templateVersionId"] for item in resolved] == [
        "version-a", "version-b",
    ]
    assert [item["content"] for item in resolved] == [
        b"first-template", b"second-template",
    ]

    legacy_root = tmp_path / "legacy"
    legacy_root.mkdir()
    monkeypatch.setattr(
        "backend.documents.template_catalog.compatibility.custom_exporter.get_scope_template_dir",
        lambda *_args, **_kwargs: str(legacy_root),
    )
    monkeypatch.setattr(
        "backend.documents.template_catalog.compatibility.custom_exporter.template_scope_file_lock",
        lambda *_args, **_kwargs: nullcontext(),
    )
    worker = LegacyAliasProjectionWorker(
        None,
        storage,
        environ={
            "WORD_TEMPLATE_CATALOG_ENABLED": "true",
            "WORD_TEMPLATE_CATALOG_MODE": "cutover",
        },
    )
    worker._project({
        "eventType": "PUBLICATION",
        "organizationId": "org-a",
        "ownerType": "organization",
        "storageKey": first[0],
        "sha256": first[1],
        "desiredChecksum": first[1],
        "desiredAlias": "first.docx",
    })
    assert (legacy_root / "first.docx").read_bytes() == b"first-template"
    assert not list(legacy_root.glob("*.projection"))


def test_catalog_create_publish_restore_and_database_immutability(tmp_path):
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    connection = psycopg.connect(
        database_url,
        connect_timeout=5,
        row_factory=compat_row_factory,
    )
    cursor = PostgresCursor(connection.cursor())
    user_id = f"user-word-catalog-{uuid.uuid4()}"
    scope_id = f"personal:{user_id}"
    audit_events = []

    def audit(action, **values):
        audit_events.append((action, values))
        assert values["cursor"] is cursor
        assert values["required"] is True
        return f"audit-{len(audit_events)}"

    try:
        cursor.execute(
            """INSERT INTO tai_khoan
                 (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                  email, email_norm, da_xac_minh)
               VALUES (?, ?, ?, 'test-hash', 'Word Catalog Test', ?, ?, 1)""",
            (
                user_id, f"word-{uuid.uuid4()}", f"word-{uuid.uuid4()}",
                f"word-{uuid.uuid4()}@example.test",
                f"word-{uuid.uuid4()}@example.test",
            ),
        )
        repository = WordTemplateCatalogRepository(cursor)
        catalog = WordTemplateCatalog(
            repository,
            ImmutableTemplateStorage(tmp_path),
            audit=audit,
        )

        created = catalog.create_template(
            organization_id=scope_id,
            owner_type="personal",
            stable_code="Procurement Plan",
            display_name="Procurement Plan",
            legacy_alias="procurement-plan.docx",
            original_filename="procurement-plan.docx",
            sanitized_content=b"version-one",
            actor_user_id=user_id,
        )
        assert created["rowVersion"] == 1
        assert created["publishedVersionId"] is None
        first_version_id = created["draftVersionId"]

        drafted = catalog.create_draft_version(
            organization_id=scope_id,
            template_id=created["id"],
            expected_row_version=1,
            original_filename="procurement-plan-v2.docx",
            sanitized_content=b"version-two",
            actor_user_id=user_id,
        )
        assert drafted["rowVersion"] == 2
        second_version_id = drafted["draftVersionId"]
        assert second_version_id != first_version_id

        with pytest.raises(CatalogConflictError) as stale:
            catalog.create_draft_version(
                organization_id=scope_id,
                template_id=created["id"],
                expected_row_version=1,
                original_filename="stale.docx",
                sanitized_content=b"stale-content",
                actor_user_id=user_id,
            )
        assert stale.value.current["rowVersion"] == 2

        version = repository.get_version(scope_id, second_version_id)
        report = {
            "schemaVersion": 1,
            "issues": [],
            "summary": {"blockers": 0, "warnings": 0},
        }
        report_json = json.dumps(report, sort_keys=True, separators=(",", ":"))
        preflight = repository.insert_preflight(
            organization_id=scope_id,
            values={
                "template_version_id": second_version_id,
                "template_sha256": version["sha256"],
                "parser_version": "test-parser-v1",
                "mapping_base_version": "test-mapping-v1",
                "mapping_snapshot_hash": "a" * 64,
                "required_registry_version": "approved-empty-v1",
                "context_policy_version": "test-context-v1",
                "report_json": report_json,
                "report_hash": hashlib.sha256(report_json.encode()).hexdigest(),
                "result": "PASS",
                "run_by_id": user_id,
            },
        )
        published = catalog.publish(
            organization_id=scope_id,
            template_id=created["id"],
            version_id=second_version_id,
            accepted_preflight_run_id=preflight["id"],
            expected_row_version=2,
            actor_user_id=user_id,
            reason="Approved test publication",
        )
        assert published["rowVersion"] == 3
        assert published["draftVersionId"] is None
        assert published["publishedVersionId"] == second_version_id
        assert cursor.execute(
            """SELECT COUNT(*) FROM word_template_projection_outbox
                WHERE organization_id = ? AND template_id = ?""",
            (scope_id, created["id"]),
        ).fetchone()[0] == 1

        assignment_config, assignment_error = repository.replace_assignments_cas(
            organization_id=scope_id,
            owner_type="personal",
            template_ids_by_document={"procurement_plan": [created["id"]]},
            aliases_by_document={
                "procurement_plan": [created["legacyAlias"]],
            },
            expected_revision=0,
            actor_user_id=user_id,
        )
        assert assignment_error is None
        assert assignment_config["revision"] == 1
        assert repository.resolve_assignments(
            scope_id, "procurement_plan"
        )[0]["resolvedVersionId"] == second_version_id
        stale_config, stale_error = repository.replace_assignments_cas(
            organization_id=scope_id,
            owner_type="personal",
            template_ids_by_document={},
            aliases_by_document={},
            expected_revision=0,
            actor_user_id=user_id,
        )
        assert stale_error == "STALE"
        assert stale_config["revision"] == 1
        assert cursor.execute(
            """SELECT COUNT(*) FROM word_template_projection_outbox
                WHERE organization_id = ? AND event_type = 'ASSIGNMENT'""",
            (scope_id,),
        ).fetchone()[0] == 1

        cursor.execute("SAVEPOINT immutable_version_check")
        with pytest.raises(psycopg.Error):
            cursor.execute(
                """UPDATE word_template_version SET original_filename = 'mutated.docx'
                    WHERE organization_id = ? AND id = ?""",
                (scope_id, second_version_id),
            )
        cursor.execute("ROLLBACK TO SAVEPOINT immutable_version_check")
        cursor.execute("RELEASE SAVEPOINT immutable_version_check")

        restored = catalog.restore_as_draft(
            organization_id=scope_id,
            template_id=created["id"],
            source_version_id=second_version_id,
            expected_row_version=3,
            actor_user_id=user_id,
            reason="Restore published bytes for editing",
        )
        assert restored["rowVersion"] == 4
        assert restored["publishedVersionId"] == second_version_id
        assert restored["draftVersionId"] != second_version_id
        restored_version = repository.get_version(
            scope_id, restored["draftVersionId"]
        )
        assert restored_version["sourceVersionId"] == second_version_id
        assert restored_version["sha256"] == version["sha256"]
        assert len(audit_events) == 4
    finally:
        connection.rollback()
        connection.close()


def test_preflight_appends_version_pinned_report_without_inventing_requirements(
    tmp_path,
):
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    connection = psycopg.connect(
        database_url,
        connect_timeout=5,
        row_factory=compat_row_factory,
    )
    cursor = PostgresCursor(connection.cursor())
    user_id = f"user-word-preflight-{uuid.uuid4()}"
    scope_id = f"personal:{user_id}"
    username = f"word-preflight-{uuid.uuid4()}"
    email = f"word-preflight-{uuid.uuid4()}@example.test"

    def audit(_action, **_values):
        return "audit-test"

    try:
        cursor.execute(
            """INSERT INTO tai_khoan
                 (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                  email, email_norm, da_xac_minh)
               VALUES (?, ?, ?, 'test-hash', 'Word Preflight Test', ?, ?, 1)""",
            (user_id, username, username, email, email),
        )
        repository = WordTemplateCatalogRepository(cursor)
        storage = ImmutableTemplateStorage(tmp_path)
        catalog = WordTemplateCatalog(repository, storage, audit=audit)
        created = catalog.create_template(
            organization_id=scope_id,
            owner_type="personal",
            stable_code="preflight-fixture",
            display_name="Preflight Fixture",
            legacy_alias="preflight.docx",
            original_filename="preflight.docx",
            sanitized_content=_minimal_docx(
                "{{ ke_hoach.ten_ke_hoach }} {{ definitely_unknown_root }}"
            ),
            actor_user_id=user_id,
        )

        blocked = TemplatePreflight(repository, storage).run(
            organization_id=scope_id,
            version_id=created["draftVersionId"],
            actor_user_id=user_id,
            document_types=["plan"],
        )
        assert blocked["result"] == "BLOCKED"
        assert blocked["templateSha256"] == repository.get_version(
            scope_id, created["draftVersionId"]
        )["sha256"]
        assert blocked["requiredRegistryVersion"] == "approved-empty-v1"
        assert blocked["report"]["requiredRegistryState"] == "APPROVED_EMPTY"
        assert {
            issue["code"] for issue in blocked["report"]["issues"]
        } == {"UNKNOWN_VARIABLE"}

        drafted = catalog.create_draft_version(
            organization_id=scope_id,
            template_id=created["id"],
            expected_row_version=1,
            original_filename="preflight-v2.docx",
            sanitized_content=_minimal_docx(
                "{% for item in ke_hoach_versions %}{{ item.ten_ke_hoach }}{% endfor %}"
            ),
            actor_user_id=user_id,
        )
        warning_only = TemplatePreflight(repository, storage).run(
            organization_id=scope_id,
            version_id=drafted["draftVersionId"],
            actor_user_id=user_id,
            document_types=["plan", "timeline"],
        )
        assert warning_only["result"] == "PASS"
        assert warning_only["report"]["summary"] == {
            "blockers": 0,
            "warnings": 1,
        }
        assert warning_only["report"]["issues"][0]["code"] == (
            "CROSS_CONTEXT_VARIABLE"
        )
        assert blocked["id"] != warning_only["id"]
    finally:
        connection.rollback()
        connection.close()
