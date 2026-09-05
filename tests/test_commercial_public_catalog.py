from types import SimpleNamespace

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.commercial_policy import routes
from backend.commercial_policy.repository import CommercialRepository
from backend.commercial_policy.service import CommercialPolicy


def _client():
    return TestClient(
        Starlette(
            routes=[
                Route(
                    "/api/public/commercial/offers",
                    routes.public_commercial_offers_api,
                    methods=["GET"],
                )
            ]
        )
    )


def test_public_catalog_reports_off_without_opening_database(monkeypatch):
    monkeypatch.setattr(
        routes,
        "commercial_runtime_config",
        lambda: SimpleNamespace(enabled=False, mode="off"),
    )

    def fail_if_database_is_opened():
        raise AssertionError("Commercial-off catalog discovery must not open the database")

    monkeypatch.setattr(routes.database, "get_connection", fail_if_database_is_opened)

    response = _client().get("/api/public/commercial/offers")

    assert response.status_code == 200
    assert response.json() == {
        "availability": "off",
        "offers": [],
        "creditPacks": [],
        "quotaWarnings": [],
    }
    assert response.headers["cache-control"] == "public, max-age=60, must-revalidate"


def test_public_catalog_keeps_effective_release_contract_in_shadow_mode(monkeypatch):
    catalog = {
        "releaseId": "release-1",
        "releaseChecksum": "checksum-1",
        "effectiveFrom": 1_800_000_000,
        "nextEffectiveAt": None,
        "currency": "VND",
        "timezone": "Asia/Ho_Chi_Minh",
        "offers": [{"code": "personal-connected"}],
        "creditPacks": [],
        "quotaWarnings": [70, 90, 100],
    }
    connection = SimpleNamespace(cursor=lambda: object(), close=lambda: None)
    seen = {}

    class FakePolicy:
        def __init__(self, cursor, *, include_shadow=False):
            seen["cursor"] = cursor
            seen["include_shadow"] = include_shadow

        def resolve_offer(self):
            return catalog

    monkeypatch.setattr(
        routes,
        "commercial_runtime_config",
        lambda: SimpleNamespace(enabled=True, mode="shadow"),
    )
    monkeypatch.setattr(routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(routes, "CommercialPolicy", FakePolicy)

    response = _client().get("/api/public/commercial/offers")

    assert response.status_code == 200
    assert response.json() == catalog
    assert response.headers["etag"] == '"release-1:checksum-1"'
    assert seen["include_shadow"] is True


def test_policy_filters_nonpublic_offers_and_orders_by_release_display_metadata():
    offers = [
        {"code": "late", "salesState": "sellable", "display": {"visibility": "public", "order": 20}},
        {"code": "hidden", "salesState": "sellable", "display": {"visibility": "hidden", "order": 0}},
        {"code": "stopped", "salesState": "stopped", "display": {"visibility": "public", "order": 1}},
        {"code": "early", "salesState": "sellable", "display": {"visibility": "public", "order": 5}},
        {"code": "same-order", "salesState": "sellable", "display": {"visibility": "public", "order": 5}},
    ]
    release = {
        "id": "release-ordered",
        "checksum": "checksum-ordered",
        "effective_from": 1_800_000_000,
        "snapshot": {
            "currency": "VND",
            "timezone": "Asia/Ho_Chi_Minh",
            "offers": offers,
            "creditPacks": [],
            "policies": {"quotaWarningPercentages": []},
        },
    }
    policy = CommercialPolicy(object())
    policy.repository = SimpleNamespace(
        effective_release=lambda *args, **kwargs: release,
        next_effective_at=lambda at: None,
    )

    catalog = policy.resolve_offer()

    assert [offer["code"] for offer in catalog["offers"]] == [
        "early", "same-order", "late"
    ]


def test_release_projection_uses_validated_display_order_instead_of_loop_position():
    class RecordingCursor:
        def __init__(self):
            self.calls = []

        def execute(self, statement, parameters=()):
            self.calls.append((statement, parameters))

    cursor = RecordingCursor()
    repository = CommercialRepository(cursor)
    commercial_offer = {
        "code": "ordered-offer",
        "ownerKind": "account",
        "tier": "personal",
        "variant": "internal",
        "memberQuota": 1,
        "includedProcurementQuota": 0,
        "exportCapabilities": {
            "document.export.word": True,
            "document.export.excel": False,
            "document.export.award_result_excel": False,
        },
        "violationCheckEnabled": False,
        "salesState": "sellable",
        "display": {"name": "Cá nhân", "recommended": False, "order": 42},
        "price": {"period": "yearly", "subtotal": 1, "tax": 0, "total": 1},
    }

    repository._project_release(
        "release-projection",
        {"offers": [commercial_offer], "creditPacks": [], "policies": {}},
        1_800_000_000,
    )

    sku_inserts = [
        parameters for statement, parameters in cursor.calls
        if "INSERT INTO billing_skus" in statement
    ]
    assert sku_inserts[0][-1] == 42
