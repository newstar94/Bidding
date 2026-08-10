from copy import deepcopy
from types import SimpleNamespace

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

import backend.procurement_import.routes as routes_module
from backend.procurement_import.routes import (
    ProcurementRouteError,
    _resolve_revision_decisions,
    build_procurement_source,
    procurement_import_routes,
)


def test_procurement_import_routes_are_registered():
    routes = procurement_import_routes(Route)
    assert [(route.path, route.methods) for route in routes] == [
        ("/api/procurement/imports/plan/prepare", {"POST"}),
        ("/api/procurement/imports/plan/apply", {"POST"}),
        ("/api/procurement/imports/notice/prepare", {"POST"}),
        ("/api/procurement/imports/notice/apply", {"POST"}),
        ("/api/procurement/imports/operations/{operation_id}", {"GET", "HEAD"}),
        ("/api/procurement/imports/operations/{operation_id}/resume", {"POST"}),
    ]


def test_provider_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("VNEPS_PROCUREMENT_IMPORT_ENABLED", raising=False)
    try:
        build_procurement_source()
    except ProcurementRouteError as error:
        assert error.code == "PROCUREMENT_LOOKUP_DISABLED"
        assert error.status_code == 503
    else:
        raise AssertionError("provider must fail closed")


def test_fixture_provider_is_rejected_by_local_development_runtime(
    tmp_path, monkeypatch
):
    fixture = tmp_path / "fixture.json"
    fixture.write_text(
        '{"schemaVersion":"vneps-procurement-fixture-v1","plans":[]}',
        encoding="utf-8",
    )
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("VNEPS_PROCUREMENT_IMPORT_ENABLED", "true")
    monkeypatch.setenv("VNEPS_PROCUREMENT_PROVIDER", "fixture")
    monkeypatch.setenv("VNEPS_PROCUREMENT_FIXTURE_PATH", str(fixture))

    with pytest.raises(ProcurementRouteError) as captured:
        build_procurement_source()
    assert captured.value.code == "PROCUREMENT_LOOKUP_DISABLED"
    assert captured.value.status_code == 503


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
    app = Starlette(routes=procurement_import_routes(Route))
    with TestClient(app) as client:
        response = client.post(
            "/api/procurement/imports/operations/operation-1/resume"
        )
    assert response.status_code == 403
    assert response.json()["code"] == "ORGANIZATION_ACCESS_DENIED"


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
        routes_module, "_apply_one",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            routes_module.ImportConflict("PROCUREMENT_PREVIEW_STALE")
        ),
    )
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
