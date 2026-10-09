"""HTTP regressions for affordable procurement revision batches.

SQLite supplies isolated transaction state here; production row locking and
concurrent workers remain PostgreSQL integration concerns.
"""

from copy import deepcopy
import json
import sqlite3
import time
from types import SimpleNamespace

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

import backend.procurement_lookup.routes as routes
import backend.procurement_import.routes as import_routes
from backend.procurement_import.service import PreviewStore
from backend.procurement_lookup.service import ProcurementLookupService
from backend.usage_credits import UsageCreditService, UsageOwner


@pytest.fixture
def affordable_lookup(monkeypatch):
    storage = sqlite3.connect(":memory:", isolation_level=None, check_same_thread=False)
    storage.row_factory = sqlite3.Row
    storage.executescript("""
        CREATE TABLE commercial_releases (
            id TEXT, version_label TEXT, schema_version INTEGER, checksum TEXT,
            snapshot_json TEXT, mode TEXT, scope_key TEXT, effective_from INTEGER,
            non_sellable INTEGER, base_release_id TEXT, published_by TEXT,
            reason TEXT, created_at TEXT
        );
        CREATE TABLE commercial_release_timeline (
            release_id TEXT, event_type TEXT, effective_at INTEGER
        );
        CREATE TABLE usage_credit_grants (
            id TEXT PRIMARY KEY, account_user_id TEXT, organization_id TEXT,
            owner_kind TEXT, feature TEXT, total INTEGER, remaining INTEGER,
            reserved INTEGER, issued_at INTEGER, expires_at INTEGER
        );
        CREATE TABLE usage_reservations (
            id TEXT PRIMARY KEY, account_user_id TEXT, organization_id TEXT,
            owner_kind TEXT, feature TEXT, provider TEXT, entity_kind TEXT,
            source_code TEXT, source_revision TEXT, job_key TEXT, grant_id TEXT,
            state TEXT, lease_expires_at INTEGER, updated_at TEXT
        );
        CREATE TABLE usage_ledger (
            id TEXT, grant_id TEXT, reservation_id TEXT, entry_type TEXT,
            quantity INTEGER, balance_after INTEGER, metadata_json TEXT
        );
        CREATE TABLE goi_thau (
            id TEXT, id_goc TEXT, row_version INTEGER, ma_goi_thau TEXT,
            ten_goi_thau TEXT, organization_id TEXT, is_latest INTEGER, archived_at TEXT
        );
        CREATE TABLE procurement_source_binding (
            organization_id TEXT, local_snapshot_id TEXT, local_root_id TEXT,
            notify_no TEXT, created_at TEXT
        );
        INSERT INTO goi_thau VALUES ('package-1', 'root-1', 1, 'IB2600000001', 'Gói được phép xem', 'org-1', 1, NULL);
        INSERT INTO procurement_source_binding VALUES ('org-1', 'package-1', 'root-1', 'IB2600000001', 'test');
    """)
    storage.execute(
        "INSERT INTO commercial_releases VALUES (?, ?, 1, ?, ?, 'production', 'global', 1, 0, NULL, 'admin', 'test', 'test')",
        ("release", "test", "test", json.dumps({"policies": {"partialBatch": {"kind": "process_affordable_in_stable_order"}}})),
    )

    class Connection:
        def cursor(self):
            return self

        def execute(self, statement, parameters=()):
            if statement == "BEGIN ISOLATION LEVEL SERIALIZABLE":
                statement = "BEGIN"
            return storage.execute(statement.replace(" FOR UPDATE", ""), parameters)

        def commit(self):
            storage.commit()

        def rollback(self):
            storage.rollback()

        def close(self):
            pass

    connection = Connection()
    database = SimpleNamespace(get_connection=lambda: connection)
    state = SimpleNamespace(fetches=[], saved=[], authoritative={}, fail_fetch=False, metadata_calls=0, fail_metadata=False, fail_projection=False, cache_reload_failure=None, fail_save=False)
    state.opening_fetches = []
    state.opening_cache = None
    state.opening_partial = False

    class Source:
        name = "MUASAMCONG"
        parser_version = "test"

        def list_revision_metadata(self, code, kind):
            state.metadata_calls += 1
            if state.fail_metadata:
                raise RuntimeError("fixture metadata unavailable")
            return [{"revisionId": f"revision-{number:02}", "revisionNumber": f"{number:02}"} for number in range(10)]

        def list_plan_revisions(self, code):
            return self.list_revision_metadata(code, "PLAN")

        def list_notice_revisions(self, code):
            return self.list_revision_metadata(code, "PACKAGE")

        def get_plan_revision(self, code, revision_id):
            number = revision_id.rsplit("-", 1)[-1]
            return self.lookup_with_options(code, "PLAN", revision_mode="SELECTED", revision_numbers=[number])["canonical"]["revisions"][0]

        def get_notice_revision(self, code, revision_id):
            number = revision_id.rsplit("-", 1)[-1]
            return self.lookup_with_options(code, "PACKAGE", revision_mode="SELECTED", revision_numbers=[number])["canonical"]["revisions"][0]

        def resolve_notice_package(self, code, revision_id):
            return {}

        def get_opening_bundle(self, code, revision_id, **options):
            state.opening_fetches.append((code, revision_id, options.get("opening_phase")))
            if state.fail_fetch:
                raise RuntimeError("fixture opening source failure")
            number = revision_id.rsplit("-", 1)[-1]
            raw = self.result(code, [number])["rawBundle"]
            raw["complete"] = not state.opening_partial
            raw["revisions"][number]["openingPartial"] = state.opening_partial
            raw["opening"] = True
            return {"bidders": [{"contractorName": "Authorized bidder", "bankAccount": "authorized-full-field"}],
                    "partial": state.opening_partial, "rawBundle": raw}

        @staticmethod
        def result(code, numbers):
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "kind": "PACKAGE", "canonicalCode": code, "found": True,
                "data": {"noticeNo": code, "bankAccount": "authorized-full-field"},
                "canonical": {"revisions": [{
                    "revisionId": f"revision-{number}", "revisionNumber": number,
                    "planNo": code if code.startswith("PL") else None,
                    "noticeNo": code if code.startswith("IB") else None,
                    "name": "Authorized complete source", "packages": [],
                    "bankAccount": "authorized-full-field",
                } for number in numbers]},
                "rawBundle": {
                    "entity": {"kind": "NOTICE", "noticeNo": code},
                    "complete": True,
                    "revisions": {number: {"revisionNumber": number, "sourceCode": code, "bankAccount": "authorized-full-field"} for number in numbers},
                },
            }

        def lookup_with_options(self, code, kind, *, revision_mode, revision_numbers, **options):
            numbers = [f"{number:02}" for number in range(10)] if revision_mode == "ALL" else list(revision_numbers)
            if revision_mode == "LATEST":
                numbers = ["09"]
            state.fetches.append(numbers)
            if state.fail_fetch:
                raise RuntimeError("fixture upstream failure")
            return self.result(code, numbers)

        def lookup_from_raw_bundle(self, code, bundle, **options):
            if state.fail_projection:
                raise routes.ProcurementLookupError("PROCUREMENT_SCHEMA_CHANGED")
            result = self.result(code, list(bundle["revisions"]))
            result["rawBundle"] = deepcopy(bundle)
            return result

    source = Source()
    service = ProcurementLookupService(source)

    class RawRepository:
        def __init__(self, *, database):
            pass

        def load_fresh_notice_bundle(self, organization_id, code, *, revision_mode, revision_numbers, **options):
            assert organization_id == "org-1"
            if revision_mode == "SELECTED" and state.cache_reload_failure and state.balance()["reserved"]:
                if state.cache_reload_failure == "missing":
                    return None
                raise routes.ProcurementLookupError("PROCUREMENT_SCHEMA_CHANGED")
            selected = [f"{number:02}" for number in range(10)] if revision_mode == "ALL" else list(revision_numbers or ["09"])
            available = [number for number in selected if number in state.authoritative]
            if not available or len(available) != len(selected):
                return None
            bundle = source.result(code, available)["rawBundle"]
            bundle["complete"] = len(available) == len(selected)
            bundle["status"] = "FOUND_COMPLETE" if bundle["complete"] else "FOUND_PARTIAL"
            return bundle

        def save_bundle(self, organization_id, bundle, **options):
            assert organization_id == "org-1"
            if state.fail_save:
                raise routes.ProcurementLookupError("PROCUREMENT_SCHEMA_CHANGED")
            numbers = list(bundle["revisions"])
            state.saved.append(numbers)
            inserted = sum(state.authoritative.get(number) != bundle["revisions"][number] for number in numbers)
            state.authoritative.update(deepcopy(bundle["revisions"]))
            if bundle.get("opening") and bundle.get("complete"):
                state.opening_cache = {"bidders": [{"contractorName": "Authorized bidder", "bankAccount": "authorized-full-field"}], "partial": False}
            return {"inserted": inserted, "duplicates": len(numbers) - inserted}

        load_fresh_plan_bundle = load_fresh_notice_bundle

    for key, value in {
        "TRIAL_FULL_ACCESS_ENABLED": "false", "COMMERCIAL_POLICY_ENABLED": "true",
        "COMMERCIAL_POLICY_MODE": "enforce", "PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED": "true",
        "PAYMENT_CHECKOUT_ENABLED": "false", "PAYMENT_ACTIVATION_ENABLED": "false",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(routes, "database", database)
    monkeypatch.setattr(routes, "ProcurementRawSnapshotRepository", RawRepository)
    monkeypatch.setattr(routes, "build_lookup_service", lambda: service)
    monkeypatch.setattr(routes, "verify_session", lambda request: (True, SimpleNamespace(user_id="user-1")))
    monkeypatch.setattr(routes, "get_active_org", lambda *args, **kwargs: "org-1")
    monkeypatch.setattr(routes, "_enforce_rate_limit", lambda *args: None)

    def set_balance(quantity):
        storage.execute(
            "INSERT INTO usage_credit_grants VALUES ('grant', NULL, 'org-1', 'organization', 'procurement.source_fetch', ?, ?, 0, 1, ?)",
            (quantity, quantity, int(time.time()) + 3600),
        )

    state.set_balance = set_balance
    state.balance = lambda: UsageCreditService(connection).get_balance(UsageOwner("organization", "org-1"))
    state.source = source
    state.database = database
    state.raw_repository_type = RawRepository
    app = Starlette(routes=routes.procurement_lookup_routes(Route))
    with TestClient(app) as client:
        state.client = client
        yield state
    storage.close()


@pytest.fixture
def affordable_import(affordable_lookup, monkeypatch):
    state = affordable_lookup
    state.unexpected_errors = []
    original_log_and_error = import_routes.log_and_error

    def capture_error(request, error, *args, **kwargs):
        state.unexpected_errors.append(repr(error))
        return original_log_and_error(request, error, *args, **kwargs)

    class Repository:
        def __init__(self, cursor):
            pass

        def load_family(self, *args):
            return {"latestPlan": None}

        def resolve_notice_target(self, *args, **kwargs):
            return None

    class SessionService:
        def __init__(self, repository, **kwargs):
            pass

        def create_from_bundle(self, bundle, **kwargs):
            return {"sessionId": "import-test", "canonicalBundle": deepcopy(bundle)}

    monkeypatch.setattr(import_routes, "database", state.database)
    monkeypatch.setattr(import_routes, "ProcurementRawSnapshotRepository", state.raw_repository_type)
    monkeypatch.setattr(import_routes, "build_procurement_source", lambda: state.source)
    monkeypatch.setattr(import_routes, "_request_context", lambda *args: (SimpleNamespace(user_id="user-1"), "org-1", "org-1"))
    monkeypatch.setattr(import_routes, "_enforce_rate_limit", lambda *args: None)
    monkeypatch.setattr(import_routes, "has_module_permission", lambda *args: True)
    monkeypatch.setattr(import_routes, "ProcurementImportRepository", Repository)
    monkeypatch.setattr(import_routes, "ProcurementImportSessionRepository", Repository)
    monkeypatch.setattr(import_routes, "ProcurementImportSessionService", SessionService)
    monkeypatch.setattr(import_routes, "PREVIEW_STORE", PreviewStore())
    monkeypatch.setattr(import_routes, "log_and_error", capture_error)
    monkeypatch.setattr(import_routes, "_load_opening_from_raw_snapshot", lambda *args, **kwargs: deepcopy(state.opening_cache))
    with TestClient(Starlette(routes=import_routes.procurement_import_routes(Route))) as client:
        state.import_client = client
        yield state


@pytest.mark.parametrize("kind,code,mode", [
    ("plan", "PL2600000001", "ALL"),
    ("plan", "PL2600000001", "LATEST"),
    ("notice", "IB2600000001", "ALL"),
    ("notice", "IB2600000001", "LATEST"),
])
def test_import_zero_credits_never_fetches_payload_or_saves_snapshot(affordable_import, kind, code, mode):
    state = affordable_import
    state.set_balance(0)
    response = state.import_client.post(f"/api/procurement/imports/{kind}/prepare", json={
        "code": code, "revisionMode": mode, "workspaceLease": "org-1",
        **({"includeLinkedNotices": False} if kind == "plan" else {}),
    })

    assert state.fetches == []
    assert response.status_code == 409, response.json()
    assert response.json()["code"] == "QUOTA_EXHAUSTED"
    assert state.saved == []
    assert state.balance()["reserved"] == 0


@pytest.mark.parametrize("kind,code", [("plan", "PL2600000001"), ("notice", "IB2600000001")])
def test_import_affordable_six_of_ten_reports_four_without_fetching_them(affordable_import, kind, code):
    state = affordable_import
    state.set_balance(6)
    response = state.import_client.post(f"/api/procurement/imports/{kind}/prepare", json={
        "code": code, "revisionMode": "ALL", "workspaceLease": "org-1",
        **({"includeLinkedNotices": False} if kind == "plan" else {}),
    })
    assert response.status_code == 200, (response.json(), state.unexpected_errors)
    assert state.fetches == [["00", "01", "02", "03", "04", "05"]]
    assert response.json()["usageCredits"]["status"] == "PARTIAL"
    assert response.json()[kind]["availableRevisions"] == [f"{number:02}" for number in range(10)]
    assert [row["sourceRevision"] for row in response.json()["usageCredits"]["skipped"]] == ["06", "07", "08", "09"]
    assert state.balance()["remaining"] == 0
    assert state.balance()["reserved"] == 0


@pytest.mark.parametrize("kind,code", [("plan", "PL2600000001"), ("notice", "IB2600000001")])
def test_import_latest_cache_and_retry_debit_only_once(affordable_import, kind, code):
    state = affordable_import
    state.set_balance(1)
    payload = {"code": code, "revisionMode": "LATEST", "workspaceLease": "org-1",
               **({"includeLinkedNotices": False} if kind == "plan" else {})}
    first = state.import_client.post(f"/api/procurement/imports/{kind}/prepare", json=payload)
    assert first.status_code == 200, (first.json(), state.unexpected_errors)
    second = state.import_client.post(f"/api/procurement/imports/{kind}/prepare", json=payload)
    assert second.status_code == 200, second.json()
    assert first.json()[kind]["availableRevisions"] == [f"{number:02}" for number in range(10)]
    assert state.fetches == [["09"]]
    assert state.saved == [["09"]]
    assert state.balance()["remaining"] == 0
    assert state.balance()["reserved"] == 0


@pytest.mark.parametrize("failure", ["fail_fetch", "fail_save"])
def test_import_failed_fetch_or_save_releases_credits_for_retry(affordable_import, failure):
    state = affordable_import
    state.set_balance(1)
    setattr(state, failure, True)
    payload = {"code": "IB2600000001", "revisionMode": "LATEST", "workspaceLease": "org-1"}
    first = state.import_client.post("/api/procurement/imports/notice/prepare", json=payload)
    assert first.status_code == 502
    assert state.balance()["remaining"] == 1
    assert state.balance()["reserved"] == 0
    setattr(state, failure, False)
    retry = state.import_client.post("/api/procurement/imports/notice/prepare", json=payload)
    assert retry.status_code == 200, retry.json()
    assert state.balance()["remaining"] == 0
    assert state.balance()["reserved"] == 0


def test_opening_import_zero_credits_never_fetches_payload(affordable_import):
    state = affordable_import
    state.set_balance(0)
    response = state.import_client.post("/api/procurement/imports/opening/prepare", json={
        "packageId": "package-1", "workspaceLease": "org-1",
    })
    assert state.opening_fetches == []
    assert response.status_code == 409, response.json()
    assert response.json()["code"] == "QUOTA_EXHAUSTED"
    assert state.saved == []


def test_opening_import_cache_and_same_notice_identity_do_not_debit_twice(affordable_import):
    state = affordable_import
    state.set_balance(1)
    first = state.import_client.post("/api/procurement/imports/notice/prepare", json={
        "code": "IB2600000001", "workspaceLease": "org-1", "revisionMode": "LATEST",
    })
    assert first.status_code == 200, first.json()
    payload = {"packageId": "package-1", "workspaceLease": "org-1"}
    opening = state.import_client.post("/api/procurement/imports/opening/prepare", json=payload)
    assert opening.status_code == 200, (opening.json(), state.unexpected_errors)
    assert opening.json()["opening"]["bidders"][0]["bankAccount"] == "authorized-full-field"
    retry = state.import_client.post("/api/procurement/imports/opening/prepare", json=payload)
    assert retry.status_code == 200
    assert state.opening_fetches == [("IB2600000001", "revision-09", None)]
    assert state.balance()["remaining"] == 0
    assert state.balance()["reserved"] == 0


@pytest.mark.parametrize("partial", [False, True])
def test_opening_import_failure_or_partial_releases_credit_until_complete_retry(affordable_import, partial):
    state = affordable_import
    state.set_balance(1)
    state.fail_fetch = not partial
    state.opening_partial = partial
    payload = {"packageId": "package-1", "workspaceLease": "org-1"}
    first = state.import_client.post("/api/procurement/imports/opening/prepare", json=payload)
    assert first.status_code == (200 if partial else 502), first.json()
    if partial:
        assert first.json()["opening"]["partial"] is True
        assert first.json()["warnings"] == [{"code": "PROCUREMENT_PARTIAL_DATA"}]
    assert state.saved == []
    assert state.balance()["remaining"] == 1
    assert state.balance()["reserved"] == 0
    state.fail_fetch = False
    state.opening_partial = False
    retry = state.import_client.post("/api/procurement/imports/opening/prepare", json=payload)
    assert retry.status_code == 200, (retry.json(), state.unexpected_errors)
    assert state.balance()["remaining"] == 0
    assert state.balance()["reserved"] == 0


def test_background_linked_package_enrichment_fetches_affordable_six_in_stable_order(affordable_import, monkeypatch):
    state = affordable_import
    state.set_balance(6)
    calls = []
    lookup = state.source.lookup_with_options

    def fetch(code, kind, **options):
        calls.append(code)
        return lookup(code, kind, **options)

    monkeypatch.setattr(state.source, "lookup_with_options", fetch)
    monkeypatch.setattr(state.source, "list_revision_metadata", lambda *args: [{"revisionId": "revision-00", "revisionNumber": "00"}])
    monkeypatch.setattr(state.raw_repository_type, "load_fresh_notice_bundle", lambda *args, **kwargs: None)
    preparer = import_routes._configure_import_fetch(
        import_routes._build_import_preparer(state.source),
        organization_id="org-1", user_id="user-1",
    )
    revisions = [{"revisionId": "plan-00", "revisionNumber": "00", "packages": [
        {"planDetailRevisionId": f"detail-{number}", "noticeLink": {
            "state": "LINKED", "noticeNo": f"IB26000000{number:02}", "noticeVersion": "00",
        }} for number in range(10)
    ]}]
    history, failures = preparer._enrich_linked_notices_bounded(
        revisions, organization_id="org-1", max_workers=8,
        source_factory=lambda: SimpleNamespace(name="MUASAMCONG"),
    )
    assert calls == [f"IB26000000{number:02}" for number in range(6)]
    assert len(history) == 6
    assert [item["noticeNo"] for item in failures] == [f"IB26000000{number:02}" for number in range(6, 10)]
    assert [item["errorCode"] for item in failures] == ["QUOTA_EXHAUSTED"] * 4
    assert all(item["usageCredits"]["skipped"] for item in failures)
    assert state.balance()["remaining"] == 0
    assert state.balance()["reserved"] == 0


def test_background_import_resolves_personal_usage_owner_from_durable_scope():
    owner = routes._usage_owner(
        SimpleNamespace(state=SimpleNamespace()), SimpleNamespace(user_id="user-1"), "personal:user-1",
    )
    assert owner == UsageOwner("account", "user-1")
    assert routes._usage_owner(SimpleNamespace(), SimpleNamespace(user_id="user-1"), "org-1") == UsageOwner("organization", "org-1")


def test_opening_adapter_without_raw_snapshot_releases_credit_and_fails(affordable_import, monkeypatch):
    state = affordable_import
    state.set_balance(1)
    monkeypatch.setattr(state.source, "get_opening_bundle", lambda *args, **kwargs: {"bidders": [], "partial": False})
    response = state.import_client.post("/api/procurement/imports/opening/prepare", json={"packageId": "package-1", "workspaceLease": "org-1"})
    assert response.status_code == 502
    assert response.json()["code"] == "PROCUREMENT_SCHEMA_CHANGED"
    assert state.balance()["remaining"] == 1
    assert state.balance()["reserved"] == 0
    assert state.saved == []


def test_opening_complete_payload_without_complete_snapshot_cannot_be_repeated_for_free(affordable_import, monkeypatch):
    state = affordable_import
    state.set_balance(1)
    monkeypatch.setattr(state.source, "get_opening_bundle", lambda *args, **kwargs: {
        "bidders": [{"contractorName": "Authorized bidder"}], "partial": False,
        "rawBundle": {"complete": False, "revisions": {"09": {"revisionNumber": "09"}}},
    })
    response = state.import_client.post("/api/procurement/imports/opening/prepare", json={"packageId": "package-1", "workspaceLease": "org-1"})
    assert response.status_code == 502
    assert response.json()["code"] == "PROCUREMENT_SCHEMA_CHANGED"
    assert state.balance()["remaining"] == 1
    assert state.balance()["reserved"] == 0
    assert state.saved == []


def test_affordable_six_of_ten_fetches_six_and_reports_four_unprocessed(affordable_lookup):
    state = affordable_lookup
    state.set_balance(6)
    response = state.client.post("/api/procurement/lookup", json={
        "code": "IB2600000001", "workspaceLease": "org-1",
        "detailLevel": "COMPLETE", "revisionMode": "ALL",
    })

    assert response.status_code == 200
    assert state.fetches == [["00", "01", "02", "03", "04", "05"]]
    payload = response.json()
    assert list(payload["rawBundle"]["revisions"]) == ["00", "01", "02", "03", "04", "05"]
    assert payload["data"]["bankAccount"] == "authorized-full-field"
    assert payload["usageCredits"]["status"] == "PARTIAL"
    assert [(item["sourceRevision"], item["reasonCode"]) for item in payload["usageCredits"]["skipped"]] == [
        ("06", "QUOTA_EXHAUSTED"), ("07", "QUOTA_EXHAUSTED"),
        ("08", "QUOTA_EXHAUSTED"), ("09", "QUOTA_EXHAUSTED"),
    ]
    assert state.saved == [["00", "01", "02", "03", "04", "05"]]
    assert state.balance()["remaining"] == 0
    assert state.balance()["reserved"] == 0


def test_partial_fetch_merges_existing_authoritative_revision_without_refetching_it(affordable_lookup):
    state = affordable_lookup
    state.set_balance(6)
    state.authoritative["09"] = {"revisionNumber": "09", "bankAccount": "authorized-full-field"}
    response = state.client.post("/api/procurement/lookup", json={
        "code": "IB2600000001", "workspaceLease": "org-1",
        "detailLevel": "COMPLETE", "revisionMode": "ALL",
    })

    assert response.status_code == 200
    assert state.fetches == [["00", "01", "02", "03", "04", "05"]]
    assert set(response.json()["rawBundle"]["revisions"]) == {
        "00", "01", "02", "03", "04", "05", "09",
    }
    assert response.json()["usageCredits"]["processed"][-1]["sourceRevision"] == "09"


def test_complete_authoritative_cache_does_not_consume_or_fetch_quota(affordable_lookup):
    state = affordable_lookup
    state.set_balance(0)
    state.authoritative.update({
        f"{number:02}": {"revisionNumber": f"{number:02}"}
        for number in range(10)
    })
    response = state.client.post("/api/procurement/lookup", json={
        "code": "IB2600000001", "workspaceLease": "org-1",
        "detailLevel": "COMPLETE", "revisionMode": "ALL",
    })

    assert response.status_code == 200
    assert state.fetches == []
    assert response.json()["usageCredits"]["status"] == "COMPLETE"
    assert response.json()["usageCredits"]["skipped"] == []
    assert state.balance()["remaining"] == 0


def test_failed_cached_revision_projection_does_not_save_or_consume_partial_fetch(affordable_lookup):
    state = affordable_lookup
    state.set_balance(6)
    state.authoritative["09"] = {"revisionNumber": "09", "bankAccount": "authorized-full-field"}
    state.fail_projection = True
    response = state.client.post("/api/procurement/lookup", json={
        "code": "IB2600000001", "workspaceLease": "org-1",
        "detailLevel": "COMPLETE", "revisionMode": "ALL",
    })

    assert response.status_code == 502
    assert response.json()["code"] == "PROCUREMENT_SCHEMA_CHANGED"
    assert state.saved == []
    assert list(state.authoritative) == ["09"]
    assert state.balance()["remaining"] == 6
    assert state.balance()["reserved"] == 0


@pytest.mark.parametrize(("failure", "status", "code"), [
    ("missing", 409, "COMMERCIAL_SNAPSHOT_CACHE_INCONSISTENT"),
    ("error", 502, "PROCUREMENT_SCHEMA_CHANGED"),
])
def test_failed_cached_revision_reload_releases_credits_and_preserves_existing_data(affordable_lookup, failure, status, code):
    state = affordable_lookup
    state.set_balance(6)
    state.authoritative["09"] = {"revisionNumber": "09", "bankAccount": "authorized-full-field"}
    state.cache_reload_failure = failure
    response = state.client.post("/api/procurement/lookup", json={
        "code": "IB2600000001", "workspaceLease": "org-1",
        "detailLevel": "COMPLETE", "revisionMode": "ALL",
    })

    assert response.status_code == status
    assert response.json()["code"] == code
    assert state.fetches == []
    assert state.saved == []
    assert list(state.authoritative) == ["09"]
    assert state.balance()["remaining"] == 6
    assert state.balance()["reserved"] == 0


def test_failed_snapshot_save_releases_reserved_credits(affordable_lookup):
    state = affordable_lookup
    state.set_balance(6)
    state.fail_save = True
    response = state.client.post("/api/procurement/lookup", json={
        "code": "IB2600000001", "workspaceLease": "org-1",
        "detailLevel": "COMPLETE", "revisionMode": "ALL",
    })

    assert response.status_code == 502
    assert state.saved == []
    assert state.balance()["remaining"] == 6
    assert state.balance()["reserved"] == 0


def test_no_credits_returns_explicit_skipped_items_without_source_fetch(affordable_lookup):
    state = affordable_lookup
    state.set_balance(0)
    response = state.client.post("/api/procurement/lookup", json={
        "code": "IB2600000001", "workspaceLease": "org-1",
        "detailLevel": "COMPLETE", "revisionMode": "SELECTED",
        "revisionNumbers": ["01", "03"],
    })

    assert response.status_code == 409
    assert response.json()["code"] == "QUOTA_EXHAUSTED"
    skipped = response.json()["fields"]["usageCredits"]["skipped"]
    assert [(item["sourceCode"], item["sourceRevision"]) for item in skipped] == [
        ("IB2600000001", "01"), ("IB2600000001", "03"),
    ]
    assert state.fetches == []
    assert state.saved == []
    assert state.balance()["reserved"] == 0


def test_upstream_failure_releases_reserved_credits_without_a_snapshot(affordable_lookup):
    state = affordable_lookup
    state.set_balance(6)
    state.fail_fetch = True
    response = state.client.post("/api/procurement/lookup", json={
        "code": "IB2600000001", "workspaceLease": "org-1",
        "detailLevel": "COMPLETE", "revisionMode": "ALL",
    })

    assert response.status_code == 502
    assert state.saved == []
    assert state.balance()["remaining"] == 6
    assert state.balance()["reserved"] == 0


def test_wrong_workspace_is_rejected_before_quota_or_upstream_work(affordable_lookup):
    state = affordable_lookup
    state.set_balance(6)
    response = state.client.post("/api/procurement/lookup", json={
        "code": "IB2600000001", "workspaceLease": "org-2",
        "detailLevel": "COMPLETE", "revisionMode": "ALL",
    })

    assert response.status_code == 403
    assert state.fetches == []
    assert state.saved == []
    assert state.balance()["remaining"] == 6
    assert state.balance()["reserved"] == 0


def test_latest_fetch_does_not_add_an_unrequested_older_cached_revision(affordable_lookup):
    state = affordable_lookup
    state.set_balance(1)
    state.authoritative["01"] = {"revisionNumber": "01"}
    response = state.client.post("/api/procurement/lookup", json={
        "code": "IB2600000001", "workspaceLease": "org-1",
        "detailLevel": "COMPLETE", "revisionMode": "LATEST",
    })

    assert response.status_code == 200
    assert state.fetches == [["09"]]
    assert list(response.json()["rawBundle"]["revisions"]) == ["09"]


def test_authoritative_cache_remains_readable_when_metadata_source_is_offline(affordable_lookup):
    state = affordable_lookup
    state.set_balance(0)
    state.authoritative.update({
        f"{number:02}": {"revisionNumber": f"{number:02}"}
        for number in range(10)
    })
    state.fail_metadata = True
    response = state.client.post("/api/procurement/lookup", json={
        "code": "IB2600000001", "workspaceLease": "org-1",
        "detailLevel": "COMPLETE", "revisionMode": "ALL",
    })

    assert response.status_code == 200
    assert state.metadata_calls == 0
    assert state.fetches == []
    assert len(response.json()["rawBundle"]["revisions"]) == 10
