from types import SimpleNamespace

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.commercial_policy import routes


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
