"""Word mapping routes keep session, policy, queries and audit on a DB lane."""

import asyncio
import threading
from types import SimpleNamespace

import pytest

from backend.documents import routes_docx as routes


@pytest.mark.parametrize("operation", ["list", "save", "delete", "reset"])
def test_word_mapping_database_work_leaves_request_event_loop(monkeypatch, operation):
    loop_thread = threading.get_ident()
    visited = []

    def check(name):
        assert threading.get_ident() != loop_thread, f"{name} ran on request event loop"
        visited.append(name)

    class Connection:
        in_transaction = False

        def cursor(self):
            check("cursor")
            return self

        def commit(self):
            check("commit")

        def close(self):
            check("close")

    def connect():
        check("connection")
        return Connection()

    def verify(_request):
        check("session")
        return True, SimpleNamespace(user_id="u")

    def scope(*_args):
        check("scope")
        return "org"

    def policy(*_args):
        check("policy")
        return True

    def query(*_args, **_kwargs):
        check("query")
        return [] if operation == "list" else {"id": "mapping"}

    def audit(*_args, **_kwargs):
        check("audit")

    async def data(_request):
        return {"tenBien": "ten_goi_thau", "sourceTable": "goi_thau", "sourceColumn": "ten_goi_thau"}, None

    monkeypatch.setattr(routes, "verify_session", verify)
    monkeypatch.setattr(routes, "get_active_org", scope)
    monkeypatch.setattr(routes, "database", SimpleNamespace(get_connection=connect))
    monkeypatch.setattr(routes, "can_read_word_config", policy)
    monkeypatch.setattr(routes, "can_manage_word_config", policy)
    monkeypatch.setattr(routes, "_word_template_scope", lambda *_args: ("organization", "org"))
    monkeypatch.setattr(routes, "validate_mapping_definition", lambda *_args: None)
    monkeypatch.setattr(routes, "resolve_word_mappings", query)
    monkeypatch.setattr(routes, "save_word_mapping", query)
    monkeypatch.setattr(routes, "delete_word_mapping", query)
    monkeypatch.setattr(routes, "reset_word_mapping", query)
    monkeypatch.setattr(routes, "log_audit", audit)
    monkeypatch.setattr(routes, "read_json_object", data)
    handler = getattr(routes, f"{operation}_word_mapping{'s' if operation == 'list' else ''}_api")
    request = SimpleNamespace(query_params={}, path_params={"mapping_id": "mapping"})
    response = asyncio.run(handler(request))
    assert response.status_code == 200, response.body
    assert {"session", "scope", "connection", "cursor", "policy", "query", "close"} <= set(visited)
    if operation != "list":
        assert {"commit", "audit"} <= set(visited)
