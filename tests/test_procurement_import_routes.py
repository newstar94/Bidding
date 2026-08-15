from copy import deepcopy
from types import SimpleNamespace

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

import backend.procurement_import.routes as routes_module
from backend.procurement_import.routes import (
    ProcurementRouteError,
    _load_opening_from_raw_snapshot,
    _resolve_revision_decisions,
    build_procurement_source,
    procurement_import_routes,
)
from backend.procurement_import.service import PreviewStore


def test_opening_prepare_reuses_complete_exact_raw_snapshot():
    class RawRepository:
        def load_fresh_notice_bundle(self, organization_id, notice_no, **options):
            assert (organization_id, notice_no) == ("org-1", "IB2600000002")
            assert options["detail_level"] == "COMPLETE"
            assert options["revision_mode"] == "SELECTED"
            assert options["revision_numbers"] == ["01"]
            return {"complete": True, "entity": {"kind": "NOTICE"}}

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


def test_procurement_import_routes_are_registered():
    routes = procurement_import_routes(Route)
    assert [(route.path, route.methods) for route in routes] == [
        ("/api/procurement/imports/plan/prepare", {"POST"}),
        ("/api/procurement/imports/plan/sessions/{session_id}/revisions/{revision_number}", {"GET", "HEAD"}),
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
        expected_row_version, target_root_id, operation_id,
    ):
        applied.append(
            (
                organization_id, actor_user_id, provider, revision["revisionId"],
                idempotency_key, expected_row_version, target_root_id,
                operation_id,
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
    monkeypatch.setattr(routes_module, "_apply_notice_one", apply_notice)
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
