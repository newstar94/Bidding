import asyncio
from threading import Event, get_ident
from types import SimpleNamespace

from backend import lot_lifecycle_routes as routes
from backend.shared.async_io import BlockingIOBusyError


def test_lot_query_waits_for_database_off_event_loop(monkeypatch):
    started, release = Event(), Event()
    thread_ids = []

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def cursor(self):
            return self

    def connect():
        thread_ids.append(get_ident())
        started.set()
        release.wait(1)
        return Connection()

    monkeypatch.setattr(routes, "database", SimpleNamespace(get_connection=connect))
    monkeypatch.setattr(routes, "verify_session", lambda _: (True, SimpleNamespace(user_id="u")))
    monkeypatch.setattr(routes, "get_active_org", lambda *args: "org")
    monkeypatch.setattr(routes, "can_read_record", lambda *args: True)
    monkeypatch.setattr(routes, "query_lifecycle", lambda *args: {"packageId": "p"})

    async def scenario():
        loop_thread = get_ident()
        task = asyncio.create_task(routes.get_lot_lifecycle_api(SimpleNamespace(path_params={"package_id": "p"})))
        try:
            async with asyncio.timeout(2):
                while not started.is_set():
                    await asyncio.sleep(0)
                assert thread_ids[0] != loop_thread
                release.set()
                response = await task
                assert response.status_code == 200
                assert response.headers["Cache-Control"] == "private, no-store"
        finally:
            release.set()
            await task

    asyncio.run(scenario())


def test_lot_create_write_waits_off_event_loop(monkeypatch):
    started, release = Event(), Event()
    worker_ids = []

    async def read_json(_request):
        return {"lotIds": ["lot-1"], "approvalMode": "CONSOLIDATED_APPROVAL"}, None

    async def impl(_request, *, _session, _data):
        worker_ids.append(get_ident())
        started.set()
        await asyncio.to_thread(release.wait, 1)
        return SimpleNamespace(status_code=201)

    monkeypatch.setattr(routes, "verify_session", lambda _: (True, SimpleNamespace(user_id="u")))
    monkeypatch.setattr(routes, "read_json_object", read_json)
    monkeypatch.setattr(routes, "_create_lot_batch_impl", impl)

    async def scenario():
        loop_thread = get_ident()
        task = asyncio.create_task(routes.create_lot_batch_api(SimpleNamespace()))
        try:
            async with asyncio.timeout(2):
                while not started.is_set():
                    await asyncio.sleep(0)
                assert worker_ids[0] != loop_thread
                release.set()
                assert (await task).status_code == 201
        finally:
            release.set()
            await task

    asyncio.run(scenario())


def test_lot_finalize_write_waits_off_event_loop(monkeypatch):
    started, release = Event(), Event()
    worker_ids = []

    async def read_json(_request):
        return {"outcomes": {"lot-1": "AWARDED"}, "packageAward": {}}, None

    async def impl(_request, *, _session, _data):
        worker_ids.append(get_ident())
        started.set()
        await asyncio.to_thread(release.wait, 1)
        return SimpleNamespace(status_code=200)

    monkeypatch.setattr(routes, "verify_session", lambda _: (True, SimpleNamespace(user_id="u")))
    monkeypatch.setattr(routes, "read_json_object", read_json)
    monkeypatch.setattr(routes, "_finalize_lot_batch_impl", impl)

    async def scenario():
        loop_thread = get_ident()
        request = SimpleNamespace(headers={"Idempotency-Key": "lot-finalize:v7"})
        task = asyncio.create_task(routes.finalize_lot_batch_api(request))
        try:
            async with asyncio.timeout(2):
                while not started.is_set():
                    await asyncio.sleep(0)
                assert worker_ids[0] != loop_thread
                release.set()
                assert (await task).status_code == 200
        finally:
            release.set()
            await task

    asyncio.run(scenario())


def test_lot_write_lane_overload_keeps_503_contract(monkeypatch):
    async def read_json(_request):
        return {"lotIds": ["lot-1"], "approvalMode": "CONSOLIDATED_APPROVAL"}, None

    async def busy(*_args, **_kwargs):
        raise BlockingIOBusyError("write lane full")

    monkeypatch.setattr(routes, "verify_session", lambda _: (True, SimpleNamespace(user_id="u")))
    monkeypatch.setattr(routes, "read_json_object", read_json)
    monkeypatch.setattr(routes, "run_database_write", busy)
    response = asyncio.run(routes.create_lot_batch_api(SimpleNamespace()))
    assert response.status_code == 503
