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
    """)
    storage.execute(
        "INSERT INTO commercial_releases VALUES (?, ?, 1, ?, ?, 'production', 'global', 1, 0, NULL, 'admin', 'test', 'test')",
        ("release", "test", "test", json.dumps({"policies": {"partialBatch": {"kind": "process_affordable_in_stable_order"}}})),
    )

    class Connection:
        def cursor(self):
            return self

        def execute(self, statement, parameters=()):
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

    class Source:
        name = "MUASAMCONG"
        parser_version = "test"

        def list_revision_metadata(self, code, kind):
            state.metadata_calls += 1
            if state.fail_metadata:
                raise RuntimeError("fixture metadata unavailable")
            return [{"revisionId": f"revision-{number:02}", "revisionNumber": f"{number:02}"} for number in range(10)]

        @staticmethod
        def result(code, numbers):
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "kind": "PACKAGE", "canonicalCode": code, "found": True,
                "data": {"noticeNo": code, "bankAccount": "authorized-full-field"},
                "rawBundle": {
                    "entity": {"kind": "NOTICE", "noticeNo": code},
                    "complete": True,
                    "revisions": {number: {"revisionNumber": number, "bankAccount": "authorized-full-field"} for number in numbers},
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
            inserted = sum(number not in state.authoritative for number in numbers)
            state.authoritative.update(deepcopy(bundle["revisions"]))
            return {"inserted": inserted, "duplicates": len(numbers) - inserted}

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
    app = Starlette(routes=routes.procurement_lookup_routes(Route))
    with TestClient(app) as client:
        state.client = client
        yield state
    storage.close()


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
