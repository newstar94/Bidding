import asyncio
import json
import os
from types import SimpleNamespace

from backend.app import app
from backend.observability.metrics import route_label_from_scope
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
import backend.sync.version_api as version_api
from starlette.testclient import TestClient


class _Role:
    user_id = "user-1"


class _Cursor:
    def __init__(self, seen):
        self.seen = seen

    def execute(self, sql, params=()):
        self.seen.append(("execute", " ".join(sql.split()), tuple(params)))
        return self

    def fetchone(self):
        return (27,)


class _Connection:
    def __init__(self, seen):
        self.seen = seen

    def cursor(self):
        return _Cursor(self.seen)

    def close(self):
        self.seen.append(("close",))


def _request(active_org="org-b"):
    return SimpleNamespace(
        headers={"X-Active-Org": active_org},
        cookies={"session_token": "opaque-test-session"},
        state=SimpleNamespace(),
    )


def test_current_sync_version_is_authenticated_tenant_scoped_and_read_only(monkeypatch):
    seen = []
    request = _request()

    monkeypatch.setattr(version_api, "verify_session", lambda received: (True, _Role()))

    def active_org(received, user_id):
        seen.append(("active_org", received.headers["X-Active-Org"], user_id))
        return received.headers["X-Active-Org"]

    monkeypatch.setattr(version_api, "get_active_org", active_org)
    monkeypatch.setattr(
        version_api.database,
        "get_connection",
        lambda: _Connection(seen),
    )

    response = version_api._read_current_sync_version(request)
    payload = json.loads(response.body)

    assert response.status_code == 200
    assert payload == {"syncVersion": 27}
    assert response.headers["Cache-Control"] == "private, no-store"
    assert ("active_org", "org-b", "user-1") in seen
    statements = [entry for entry in seen if entry[0] == "execute"]
    assert statements == [
        (
            "execute",
            "SELECT current_version FROM sync_metadata WHERE organization_id = ?",
            ("org-b",),
        )
    ]
    assert all(not sql[1].startswith(("INSERT", "UPDATE", "DELETE")) for sql in statements)


def test_current_sync_version_uses_bounded_read_lane(monkeypatch):
    calls = []
    request = _request()

    async def fake_read(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return "read-result"

    monkeypatch.setattr(version_api, "run_database_read", fake_read)

    result = asyncio.run(version_api.current_sync_version_api(request))

    assert result == "read-result"
    assert calls == [
        (
            version_api._read_current_sync_version,
            (request,),
            {"timeout_seconds": 5.0},
        )
    ]


def test_current_sync_version_rejects_invalid_session_before_opening_data_connection(monkeypatch):
    monkeypatch.setattr(
        version_api,
        "verify_session",
        lambda _request: (False, "Phiên không hợp lệ"),
    )
    monkeypatch.setattr(
        version_api.database,
        "get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("database must not be opened")),
    )

    response = version_api._read_current_sync_version(_request())
    payload = json.loads(response.body)

    assert response.status_code == 403
    assert payload["code"] == "SESSION_INVALID"


def test_current_sync_version_returns_stable_503_when_read_lane_is_unavailable(monkeypatch):
    async def run_with(error):
        async def reject(*_args, **_kwargs):
            raise error

        monkeypatch.setattr(version_api, "run_database_read", reject)
        response = await version_api.current_sync_version_api(_request())
        payload = json.loads(response.body)
        assert response.status_code == 503
        assert response.headers["Retry-After"] == "1"
        assert response.headers["Cache-Control"] == "no-store"
        return payload["code"]

    assert asyncio.run(run_with(BlockingIOBusyError("full"))) == "DATABASE_READ_QUEUE_FULL"
    assert asyncio.run(run_with(BlockingIOTimeoutError("slow"))) == "DATABASE_READ_TIMEOUT"


def test_sync_version_route_has_code_owned_low_cardinality_metrics_label():
    route = next(item for item in app.routes if getattr(item, "path", None) == "/api/sync-version")

    assert route.methods == {"GET", "HEAD"}
    assert route_label_from_scope({"endpoint": route.endpoint}) == "current_sync_version_api"


def test_sync_version_route_requires_real_session_and_rejects_unowned_workspace():
    with TestClient(app, base_url="https://testserver") as client:
        anonymous = client.get("/api/sync-version")
        login = client.post(
            "/api/auth/login",
            json={
                "username": os.environ.get("ADMIN_USERNAME", "admin"),
                "password": os.environ["ADMIN_PASSWORD"],
                "remember": False,
            },
        )
        current = client.get("/api/sync-version")
        unowned = client.get(
            "/api/sync-version",
            headers={"X-Active-Org": "workspace-not-owned-by-session"},
        )

    assert anonymous.status_code == 403
    assert login.status_code == 200
    assert current.status_code == 200
    assert isinstance(current.json()["syncVersion"], int)
    assert "no-store" in current.headers["Cache-Control"]
    assert unowned.status_code == 403
    assert unowned.json()["code"] == "ORG_ACCESS_DENIED"
