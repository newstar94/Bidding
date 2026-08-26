import json
from types import SimpleNamespace

from backend.auth import auth_routes
from backend.commercial_policy import config, service


class _Connection:
    def __init__(self, rows=()):
        self._cursor = _Cursor(rows)
        self.closed = False

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed = True


class _Cursor:
    def __init__(self, rows):
        self._rows = list(rows)

    def execute(self, _statement, _params=None):
        return self

    def fetchall(self):
        return self._rows


def _payload(response):
    return json.loads(response.body.decode("utf-8"))


def test_legacy_public_packages_expose_configured_export_capabilities(monkeypatch):
    connection = _Connection([
        {
            "id": "silver",
            "name": "Gói Bạc",
            "price": 15_000_000,
            "quota": 5,
            "description": "Gói thử nghiệm",
            "document_export_word": 1,
            "document_export_excel": 0,
            "document_export_award_result_excel": 1,
        }
    ])
    monkeypatch.setattr(
        config,
        "commercial_runtime_config",
        lambda: SimpleNamespace(enabled=False, mode="off"),
    )
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)

    response = auth_routes._list_public_packages_sync(None)

    assert response.status_code == 200
    assert _payload(response)["packages"] == [{
        "id": "silver",
        "name": "Gói Bạc",
        "price": "15000000",
        "quota": 5,
        "description": "Gói thử nghiệm",
        "capabilities": {
            "document.export.word": True,
            "document.export.excel": False,
            "document.export.award_result_excel": True,
        },
    }]
    assert connection.closed


def test_release_projection_preserves_offer_capabilities(monkeypatch):
    connection = _Connection()
    catalog = {
        "releaseId": "release-1",
        "offers": [{
            "code": "silver.connected.yearly",
            "tier": "silver",
            "variant": "connected",
            "memberQuota": 5,
            "price": {"total": 15_000_000},
            "display": {"name": "Bạc kết nối", "description": "Có tra cứu"},
            "exportCapabilities": {
                "document.export.word": True,
                "document.export.excel": True,
                "document.export.award_result_excel": False,
            },
        }],
    }

    class _Policy:
        def __init__(self, _cursor, *, include_shadow=False):
            assert include_shadow is True

        def resolve_offer(self):
            return catalog

    monkeypatch.setattr(
        config,
        "commercial_runtime_config",
        lambda: SimpleNamespace(enabled=True, mode="shadow"),
    )
    monkeypatch.setattr(service, "CommercialPolicy", _Policy)
    monkeypatch.setattr(auth_routes.database, "get_connection", lambda: connection)

    response = auth_routes._list_public_packages_sync(None)
    package = _payload(response)["packages"][0]

    assert package["releaseId"] == "release-1"
    assert package["capabilities"] == catalog["offers"][0]["exportCapabilities"]
    assert connection.closed
