from types import SimpleNamespace

from starlette.applications import Starlette
from starlette.testclient import TestClient

from backend import workspace_search


class _Cursor:
    def __init__(self):
        self.statement = ""
        self.parameters = ()

    def execute(self, statement, parameters=()):
        self.statement = statement
        self.parameters = tuple(parameters)
        return self

    def fetchall(self):
        return [
            {"id": "pkg-1", "code": "GT-01", "name": "Mua sắm thiết bị"},
            {"id": "pkg-2", "code": "GT-02", "name": "Mua sắm vật tư"},
        ]


class _Connection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor

    def close(self):
        return None


def test_workspace_search_is_bounded_and_escapes_like_wildcards(monkeypatch):
    cursor = _Cursor()
    monkeypatch.setattr(
        workspace_search.database,
        "get_connection",
        lambda: _Connection(cursor),
    )
    context = SimpleNamespace(
        organization_id="org-1",
        user_id="user-1",
        active_role="manager",
        scope_type="organization",
        permissions={"goithau": "view"},
    )

    result = workspace_search._search_records(context, "packages", "GT_%", 20, 0)

    assert result["hasMore"] is False
    assert result["items"][0]["id"] == "pkg-1"
    assert "LIMIT ? OFFSET ?" in cursor.statement
    assert cursor.parameters[-2:] == (21, 0)
    assert "%gt\\_\\%%" in cursor.parameters


def test_search_entities_do_not_include_sensitive_or_document_tables():
    assert set(workspace_search.SEARCH_ENTITIES) == {"plans", "packages", "contracts"}


def test_workspace_search_route_is_post_only_and_bounded():
    route = workspace_search.workspace_search_routes[0]
    assert route.path == "/api/workspace-search"
    assert route.methods == {"POST"}

    client = TestClient(Starlette(routes=workspace_search.workspace_search_routes))
    response = client.post("/api/workspace-search", json={"entity": "packages", "query": "x"})
    assert response.status_code == 422
    assert response.json()["code"] == "WORKSPACE_SEARCH_INVALID"
