"""Word job creation must leave synchronous PostgreSQL work off the event loop."""

import asyncio
import json
import threading
from types import SimpleNamespace

import pytest
from starlette.datastructures import QueryParams

from backend.documents import document_job_routes as routes


@pytest.mark.parametrize("record_type", ["goi_thau", "ke_hoach_lcnt"])
@pytest.mark.parametrize("boundary", ["session", "access", "snapshot", "revision"])
def test_word_job_creation_keeps_database_boundaries_off_event_loop(
    monkeypatch, record_type, boundary,
):
    event_loop_thread = threading.get_ident()
    visited = []
    role = SimpleNamespace(
        user_id="user-1", platform_role="user", active_role="employee",
        active_role_organization_id="org-1",
    )

    def check_thread(name):
        visited.append(name)
        if name == boundary:
            assert threading.get_ident() != event_loop_thread, (
                f"{name} PostgreSQL work ran on the request event loop"
            )

    def verify_session(_request):
        check_thread("session")
        return True, role

    def access(_request, current_role, table, record_id):
        check_thread("access")
        assert current_role is role
        assert (table, record_id) == (record_type, "record-1")
        return "org-1", None

    def snapshot(_request, organization_id):
        check_thread("snapshot")
        assert organization_id == "org-1"
        return 17, None

    class Connection:
        def execute(self, statement, params):
            check_thread("revision")
            assert f"FROM {record_type}" in statement
            assert params == ("org-1", "record-1")
            return SimpleNamespace(fetchone=lambda: (7,))

        def close(self):
            pass

    class Request:
        path_params = {
            "package_id" if record_type == "goi_thau" else "plan_id": "record-1",
        }
        query_params = QueryParams("type=evaluation&snapshotVersion=17")

        async def json(self):
            return {}

    def prepare(*_args):
        return (
            {"record": {"id": "record-1", "row_version": 7}},
            {"record_revision": 7},
            [{"content": b"template", "filename": "template.docx"}],
            [],
        )

    def enqueue(_operation, _payload, **kwargs):
        assert kwargs["record_type"] == record_type
        assert kwargs["record_id"] == "record-1"
        assert kwargs["policy"]["syncRevision"] == 17
        return "a" * 32

    monkeypatch.setattr(routes, "verify_session", verify_session)
    monkeypatch.setattr(routes, "_create_record_access", access)
    monkeypatch.setattr(routes, "_validate_export_snapshot", snapshot)
    monkeypatch.setattr(routes, "_ensure_export_snapshot_unchanged", lambda *_args: None)
    monkeypatch.setattr(routes, "_prepare_report_render", prepare)
    monkeypatch.setattr(routes, "_prepare_plan_render", prepare)
    monkeypatch.setattr(routes, "database", SimpleNamespace(get_connection=Connection))
    monkeypatch.setattr(routes, "enqueue_document_export", enqueue)
    monkeypatch.setattr(routes, "get_client_ip", lambda _request: "127.0.0.1")
    handler = (
        routes.create_package_export_job_api
        if record_type == "goi_thau" else routes.create_plan_export_job_api
    )

    response = asyncio.run(handler(Request()))

    assert response.status_code == 202
    assert json.loads(response.body)["jobId"] == "a" * 32
    assert boundary in visited
