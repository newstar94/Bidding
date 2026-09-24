import asyncio
from threading import Event, get_ident
from types import SimpleNamespace

import pytest

from backend.notifications import routes


@pytest.mark.parametrize("name", [
    "list_notifications_api", "mark_notification_read_api",
    "mark_all_notifications_read_api", "delete_notification_api",
])
def test_notification_database_wait_leaves_event_loop_responsive(monkeypatch, name):
    started = Event()
    release = Event()
    threads = []
    connection = SimpleNamespace(
        execute=lambda *args: connection, cursor=lambda: connection,
        fetchall=lambda: [], fetchone=lambda: (0,), rowcount=1,
        commit=lambda: None, rollback=lambda: None, close=lambda: None,
    )

    def connect():
        threads.append(get_ident())
        started.set()
        assert release.wait(1), "database wait blocked the event loop"
        return connection

    monkeypatch.setattr(routes, "verify_session", lambda request: (True, SimpleNamespace(user_id="u")))
    monkeypatch.setattr(routes, "database", SimpleNamespace(get_connection=connect))
    monkeypatch.setattr(routes, "log_and_error", lambda *args: SimpleNamespace(status_code=500))
    request = SimpleNamespace(query_params={}, path_params={"notification_id": "n"})

    async def scenario():
        loop_thread = get_ident()
        task = asyncio.create_task(getattr(routes, name)(request))
        try:
            async with asyncio.timeout(2):
                while not started.is_set():
                    await asyncio.sleep(0)
                assert threads == [threads[0]]
                assert threads[0] != loop_thread
                release.set()
                assert (await task).status_code == 200
        finally:
            release.set()
            await task

    asyncio.run(scenario())
