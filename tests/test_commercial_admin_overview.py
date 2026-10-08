import json
import sqlite3
from copy import deepcopy
from types import SimpleNamespace

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.commercial_policy import routes


def _overview_client():
    return TestClient(Starlette(routes=[
        Route("/api/commercial/admin/overview", routes.commercial_admin_overview_api),
    ]))


def _mock_overview(monkeypatch, current):
    seen = []

    def verify(_request, *, required_role):
        seen.append(("authorization", required_role))
        return True, "super_admin"

    class Repository:
        def __init__(self, cursor):
            assert cursor is connection

        def effective_release(self, *, include_shadow=False):
            seen.append(("effective_release", include_shadow))
            return current

        def list_recent_releases(self, *, limit):
            assert limit == 20
            return [current] if current else []

        def list_drafts(self):
            return []

    class Connection:
        def cursor(self):
            return self

        def execute(self, statement, parameters=()):
            if "FROM commercial_releases" in statement:
                assert parameters
                return SimpleNamespace(fetchone=lambda: None)
            if "FROM payment_transactions" in statement:
                return SimpleNamespace(fetchone=lambda: (0, 0))
            if "FROM billing_orders" in statement:
                return SimpleNamespace(fetchall=lambda: [])
            raise AssertionError(f"Unexpected database operation: {statement}")

        def close(self):
            seen.append(("close",))

    connection = Connection()

    def get_connection():
        seen.append(("connection",))
        return connection

    monkeypatch.setattr(routes, "verify_session", verify)
    monkeypatch.setattr(routes, "CommercialRepository", Repository)
    monkeypatch.setattr(routes.database, "get_connection", get_connection)
    monkeypatch.setattr(routes, "commercial_health_snapshot", lambda _cursor: {})
    monkeypatch.setattr(routes, "commercial_runtime_config", lambda: SimpleNamespace(
        enabled=True, mode="enforce", payment_checkout_enabled=False,
        payment_activation_enabled=False, procurement_credit_enforcement_enabled=False,
    ))
    return seen


def test_admin_overview_denies_access_before_opening_database(monkeypatch):
    required_roles = []

    def deny(_request, *, required_role):
        required_roles.append(required_role)
        return False, "Session is not authorized"

    def forbidden_read():
        raise AssertionError("Denied overview must not read commercial data")

    monkeypatch.setattr(routes, "verify_session", deny)
    monkeypatch.setattr(routes.database, "get_connection", forbidden_read)

    response = _overview_client().get("/api/commercial/admin/overview")

    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"
    assert required_roles == ["super_admin"]


@pytest.mark.parametrize("inclusive, expected", [
    (False, {"subtotal": 101, "tax": 11, "total": 112, "currency": "VND", "period": "one_time"}),
    (True, {"subtotal": 91, "tax": 10, "total": 101, "currency": "VND", "period": "one_time"}),
])
def test_admin_catalog_uses_current_shadow_snapshot_without_filtering(monkeypatch, inclusive, expected):
    offers = [
        {"code": "stopped", "salesState": "stopped", "display": {"visibility": "public", "order": 20}},
        {"code": "hidden", "salesState": "sellable", "display": {"visibility": "hidden", "order": 0}},
        {"code": "public", "salesState": "sellable", "display": {"visibility": "public", "order": 1}},
        {"code": "not-sellable", "salesState": "non_sellable", "display": {"visibility": "public"}},
    ]
    current = {
        "id": "current-shadow", "version_label": "v2", "schema_version": 1,
        "checksum": "current-checksum", "mode": "shadow", "scope_key": "global",
        "effective_from": 1_800_000_000, "non_sellable": 0, "reason": "Published internally",
        "snapshot": {
            "currency": "VND", "timezone": "Asia/Ho_Chi_Minh", "offers": offers,
            "creditPacks": [{"code": "procurement.10", "quantity": 10, "price": 101}],
            "taxInvoice": {"taxInclusive": inclusive, "taxBasisPoints": 1000, "rounding": "ceil"},
            "policies": {"quotaWarningPercentages": [70, 90, 100]},
        },
    }
    original = deepcopy(current)
    seen = _mock_overview(monkeypatch, current)

    response = _overview_client().get("/api/commercial/admin/overview")

    assert response.status_code == 200
    payload = response.json()
    assert payload["currentRelease"]["id"] == "current-shadow"
    assert payload["currentRelease"]["mode"] == "shadow"
    assert payload["currentCatalog"] == {
        "releaseId": "current-shadow", "releaseChecksum": "current-checksum",
        "effectiveFrom": 1_800_000_000, "currency": "VND", "timezone": "Asia/Ho_Chi_Minh",
        "offers": offers,
        "creditPacks": [{"code": "procurement.10", "quantity": 10, "price": expected["total"], "priceDetails": expected}],
        "quotaWarnings": [70, 90, 100],
    }
    assert current == original, "Response formatting must not mutate the immutable snapshot"
    assert seen == [("authorization", "super_admin"), ("connection",), ("effective_release", True), ("close",)]


def test_admin_catalog_is_null_without_a_current_release(monkeypatch):
    seen = _mock_overview(monkeypatch, None)

    response = _overview_client().get("/api/commercial/admin/overview")

    assert response.status_code == 200
    assert response.json()["currentRelease"] is None
    assert response.json()["currentCatalog"] is None
    assert seen.count(("effective_release", True)) == 1


@pytest.mark.parametrize("sellable_mode", [None, "pilot", "production"])
def test_public_enforce_excludes_newer_shadow_release(monkeypatch, sellable_mode):
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript("""
        CREATE TABLE commercial_releases (
            id TEXT, version_label TEXT, schema_version INTEGER, checksum TEXT,
            snapshot_json TEXT, mode TEXT, scope_key TEXT, effective_from INTEGER,
            non_sellable INTEGER, base_release_id TEXT, published_by TEXT,
            reason TEXT, created_at INTEGER
        );
        CREATE TABLE commercial_release_timeline (
            release_id TEXT, event_type TEXT, effective_at INTEGER, scope_key TEXT
        );
    """)
    snapshot = {
        "currency": "VND", "timezone": "Asia/Ho_Chi_Minh",
        "offers": [{"code": "public", "salesState": "sellable"}],
        "creditPacks": [], "policies": {},
    }
    for release_id, mode, at in [("newer-shadow", "shadow", 200), ("older-public", sellable_mode, 100)]:
        if mode is None:
            continue
        connection.execute(
            "INSERT INTO commercial_releases VALUES (?, ?, 1, ?, ?, ?, 'global', ?, 0, NULL, 'admin', 'Published', ?)",
            (release_id, release_id, f"checksum-{release_id}", json.dumps(snapshot), mode, at, at),
        )
    monkeypatch.setattr(routes.database, "get_connection", lambda: connection)

    response = routes._public_commercial_offers_sync(
        SimpleNamespace(headers={}), SimpleNamespace(enabled=True, mode="enforce"),
    )

    if sellable_mode is None:
        assert response.status_code == 503
        assert json.loads(response.body)["code"] == "COMMERCIAL_POLICY_DECISION_REQUIRED"
    else:
        assert response.status_code == 200
        assert json.loads(response.body)["releaseId"] == "older-public"
