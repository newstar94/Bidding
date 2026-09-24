import asyncio
import json
from types import SimpleNamespace
from threading import Event, get_ident

from backend.activity import routes


def test_activity_database_wait_does_not_block_event_loop(monkeypatch):
    started, release = Event(), Event()
    worker_threads = []

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def cursor(self):
            return self

        def execute(self, *args):
            return self

        def fetchone(self):
            return ("record", "root")

        def fetchall(self):
            return []

    def connect():
        worker_threads.append(get_ident())
        started.set()
        release.wait(1)
        return Connection()

    monkeypatch.setattr(routes, "database", SimpleNamespace(get_connection=connect))
    monkeypatch.setattr(routes, "verify_session", lambda _: (True, SimpleNamespace(user_id="u")))
    monkeypatch.setattr(routes, "get_active_org", lambda *args: "org")
    monkeypatch.setattr(routes, "can_read_record", lambda *args: True)
    request = SimpleNamespace(path_params={"target_type": "goithau", "target_id": "record"}, query_params={})

    async def scenario():
        loop_thread = get_ident()
        task = asyncio.create_task(routes.list_activity_timeline_api(request))
        try:
            async with asyncio.timeout(2):
                while not started.is_set():
                    await asyncio.sleep(0)
                assert worker_threads[0] != loop_thread
                release.set()
                response = await task
                assert response.status_code == 200
                assert json.loads(response.body) == {"items": [], "nextCursor": None}
        finally:
            release.set()
            await task

    asyncio.run(scenario())


def test_retired_procurement_case_activity_target_is_rejected_before_database_access(
    monkeypatch,
):
    monkeypatch.setattr(
        routes,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-1")),
    )
    request = SimpleNamespace(
        path_params={"target_type": "procurement_case", "target_id": "case-1"},
        query_params={},
    )

    response = asyncio.run(routes.list_activity_timeline_api(request))

    assert response.status_code == 400
    assert json.loads(response.body)["code"] == "ACTIVITY_TARGET_INVALID"
