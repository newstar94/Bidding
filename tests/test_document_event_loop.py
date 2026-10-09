import asyncio
from contextlib import asynccontextmanager
from threading import Event
from types import SimpleNamespace

import pytest

from backend.documents import document_job_routes, document_worker, package_document_routes
from backend.documents.template_catalog import routes as catalog_routes
from backend.shared import database_io
from backend.shared.async_io import _BlockingIOPool


async def _assert_responsive(operation, started, release):
    task = asyncio.create_task(operation)
    try:
        for _ in range(100):
            if started.is_set():
                break
            await asyncio.sleep(0.002)
        assert started.is_set()
        await asyncio.sleep(0.005)
        assert not task.done(), "blocking work completed before the event loop could resume"
    finally:
        release.set()
        await task
    return task.result()


def test_package_document_list_keeps_slow_database_work_off_event_loop(monkeypatch):
    started, release = Event(), Event()
    session = SimpleNamespace(user_id="user-1")

    class Connection:
        def __enter__(self):
            started.set()
            release.wait(0.3)
            return self

        def __exit__(self, *_args):
            pass

        def cursor(self):
            return object()

    monkeypatch.setattr(package_document_routes, "verify_session", lambda _: (True, session))
    monkeypatch.setattr(package_document_routes, "get_active_org", lambda *_: "org-1")
    monkeypatch.setattr(package_document_routes.database, "get_connection", Connection)
    monkeypatch.setattr(package_document_routes, "load_package", lambda *_: {})
    monkeypatch.setattr(package_document_routes, "_package_read_allowed", lambda *_: True)
    monkeypatch.setattr(package_document_routes, "list_package_documents", lambda *_: [])
    monkeypatch.setattr(package_document_routes, "list_package_evaluation_batches", lambda *_: [])
    monkeypatch.setattr(package_document_routes, "_package_document_write_allowed", lambda *_: True)
    monkeypatch.setattr(package_document_routes, "compose_document_sections", lambda *_, **__: [])
    request = SimpleNamespace(path_params={"package_id": "package-1"})
    response = asyncio.run(_assert_responsive(
        package_document_routes.list_package_documents_api(request), started, release,
    ))
    assert response.status_code == 200


def test_document_enqueue_keeps_admission_until_cancelled_worker_finishes(monkeypatch):
    started, release, consumed = Event(), Event(), Event()
    runtime = document_worker._AsyncWorkerRuntime(1, 0)
    monkeypatch.setattr(document_worker, "_async_runtime", runtime)
    monkeypatch.setenv("DOCUMENT_WORKER_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("DOCUMENT_WORKER_QUEUE_SIZE", "0")

    def enqueue(*_args):
        started.set()
        release.wait(0.5)
        return "job-1"

    def consume(job_id, **_kwargs):
        consumed.set()
        return job_id

    monkeypatch.setattr(document_worker, "_enqueue_durable_document_job", enqueue)
    monkeypatch.setattr(document_worker, "_consume_durable_document_result", consume)

    async def scenario():
        task = asyncio.create_task(document_worker.run_document_job_async("render", {}))
        try:
            for _ in range(100):
                if started.is_set():
                    break
                await asyncio.sleep(0.002)
            assert started.is_set()
            assert not consumed.is_set(), "enqueue blocked the event loop"
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            with pytest.raises(document_worker.DocumentWorkerBusyError):
                await document_worker.run_document_job_async("render", {})
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)

    try:
        asyncio.run(scenario())
    finally:
        release.set()
        runtime.executor.shutdown(wait=True)
    assert consumed.is_set()
    assert runtime.admission.acquire(blocking=False)
    runtime.admission.release()


def test_document_job_download_waits_for_required_audit_without_blocking_loop(monkeypatch):
    started, release = Event(), Event()
    role = SimpleNamespace(user_id="user-1")
    job = {"id": "job-1", "expires_at": 9999999999, "filename": "export.docx",
           "content_type": "application/octet-stream"}
    monkeypatch.setattr(document_job_routes, "_job_access", lambda _: ((role, "org-1"), job, None))
    monkeypatch.setattr(document_job_routes, "read_document_export_result", lambda *_: (job, b"document"))
    monkeypatch.setattr(document_job_routes, "document_job_record_scope", lambda _: {
        "record_type": "goi_thau", "record_id": "package-1",
    })

    def audit(*_args, **kwargs):
        assert kwargs["required"] is True
        started.set()
        release.wait(0.3)

    monkeypatch.setattr(document_job_routes, "log_audit", audit)
    response = asyncio.run(_assert_responsive(
        document_job_routes.download_document_export_job_api(object()), started, release,
    ))
    assert response.body == b"document"


@pytest.mark.parametrize("name", ["upload", "download", "delete"])
def test_package_document_authority_io_runs_off_event_loop(monkeypatch, name):
    started, release = Event(), Event()

    def verify(_request):
        started.set()
        release.wait(0.3)
        return False, "session denied"

    monkeypatch.setattr(package_document_routes, "verify_session", verify)
    response = asyncio.run(_assert_responsive(
        getattr(package_document_routes, f"{name}_package_document_api")(object()), started, release,
    ))
    assert response.status_code == 403


@pytest.mark.parametrize("audit_fails,cancel_request", [(False, False), (True, False), (False, True)])
def test_package_upload_transaction_owns_required_audit_and_file_cleanup(monkeypatch, tmp_path, audit_fails, cancel_request):
    started, release = Event(), Event()
    events = []
    session = SimpleNamespace(user_id="user-1")

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, sql):
            events.append(sql)

        def cursor(self):
            return object()

        def commit(self):
            events.append("commit")

        def rollback(self):
            events.append("rollback")

        def close(self):
            events.append("close")

    upload_path = tmp_path / "source.pdf"
    upload_path.write_bytes(b"%PDF-fixture")

    @asynccontextmanager
    async def spool(*_args, **_kwargs):
        yield upload_path, 12, b"%PDF-fixture"

    async def form():
        return {"file": SimpleNamespace(filename="source.pdf")}

    request = SimpleNamespace(path_params={"package_id": "package-1", "document_type": "HSMT"},
                              query_params={}, form=form)
    monkeypatch.setattr(package_document_routes, "verify_session", lambda _: (True, session))
    monkeypatch.setattr(package_document_routes, "verify_session_in_transaction", lambda *_: (True, session))
    monkeypatch.setattr(package_document_routes, "get_active_org", lambda *_: "org-1")
    monkeypatch.setattr(package_document_routes.database, "get_connection", Connection)
    monkeypatch.setattr(package_document_routes, "_document_idempotency_key", lambda _: ("key-12345678", None))
    monkeypatch.setattr(package_document_routes, "load_package", lambda *_: {"owner_type": "organization"})
    monkeypatch.setattr(package_document_routes, "load_package_for_document_mutation", lambda *_: {"owner_type": "organization"})
    monkeypatch.setattr(package_document_routes, "_package_write_decision", lambda *_: SimpleNamespace(allowed=True))
    monkeypatch.setattr(package_document_routes, "allowed_upload_types", lambda _: ["HSMT"])
    monkeypatch.setattr(package_document_routes, "_validate_mutation_scope", lambda *_, **__: None)
    monkeypatch.setattr(package_document_routes, "_document_idempotency_replay", lambda *_, **__: None)
    monkeypatch.setattr(package_document_routes, "spooled_upload", spool)
    monkeypatch.setattr(package_document_routes, "validate_pdf_path", lambda _: None)
    monkeypatch.setattr(package_document_routes, "create_storage_key", lambda *_: "new-file")
    monkeypatch.setattr(package_document_routes, "persist_upload_path", lambda *_: (12, "hash"))
    monkeypatch.setattr(package_document_routes, "upsert_package_document", lambda *_, **__: ({"id": "doc-1", "originalFilename": "source.pdf"}, None))
    monkeypatch.setattr(package_document_routes, "_bump_package_projection_revision", lambda *_: (1, 1))
    monkeypatch.setattr(package_document_routes, "document_activity_event", lambda **_: {})
    monkeypatch.setattr(package_document_routes, "insert_activity_events", lambda *_, **__: events.append("activity"))
    monkeypatch.setattr(package_document_routes, "get_request_id", lambda _: "request-1")
    monkeypatch.setattr(package_document_routes, "_store_document_idempotency", lambda *_, **__: events.append("idempotency"))
    monkeypatch.setattr(package_document_routes, "enqueue_websocket_event", lambda *_, **__: events.append("websocket"))
    monkeypatch.setattr(package_document_routes, "remove_storage_key", lambda key: events.append(f"remove:{key}"))

    def audit(*_args, **kwargs):
        assert kwargs["required"] is True and kwargs["cursor"] is not None
        events.append("audit")
        started.set()
        release.wait(0.3)
        if audit_fails:
            raise RuntimeError("required audit failed")

    monkeypatch.setattr(package_document_routes, "log_audit", audit)
    async def cancellation():
        task = asyncio.create_task(package_document_routes.upload_package_document_api(request))
        try:
            for _ in range(100):
                if started.is_set():
                    break
                await asyncio.sleep(0.002)
            assert started.is_set()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert "commit" not in events and "remove:new-file" not in events
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
            for _ in range(100):
                if "close" in events:
                    break
                await asyncio.sleep(0.002)

    if cancel_request:
        asyncio.run(cancellation())
        assert "commit" in events and "remove:new-file" not in events
        return
    response = asyncio.run(_assert_responsive(
        package_document_routes.upload_package_document_api(request), started, release,
    ))
    if audit_fails:
        assert response.status_code >= 400
        assert "rollback" in events and "commit" not in events
        assert "remove:new-file" in events
    else:
        assert response.status_code == 201
        assert events.index("audit") < events.index("idempotency") < events.index("websocket") < events.index("commit")
        assert "remove:new-file" not in events


@pytest.mark.parametrize("interruption", ["cancel", "cancel_twice", "cancel_full_lane", "timeout"])
def test_package_upload_staging_finishes_before_interruption_cleanup(monkeypatch, tmp_path, interruption):
    started, release = Event(), Event()
    destination = tmp_path / "staged.pdf"
    events = []

    def persist(*_args):
        started.set()
        assert release.wait(1)
        destination.write_bytes(b"%PDF-staged")
        events.append("persisted")
        return 11, "digest"

    def remove(_key):
        events.append("removed")
        destination.unlink(missing_ok=True)

    monkeypatch.setattr(package_document_routes, "persist_upload_path", persist)
    monkeypatch.setattr(package_document_routes, "remove_storage_key", remove)
    rejections = []
    if interruption == "cancel_full_lane":
        original_io = package_document_routes.run_blocking_io

        async def saturated_io(function, *args, **kwargs):
            if function is remove and len(rejections) < 2:
                rejections.append("busy")
                raise package_document_routes.BlockingIOBusyError("fixture queue full")
            return await original_io(function, *args, **kwargs)

        monkeypatch.setattr(package_document_routes, "run_blocking_io", saturated_io)

    async def scenario():
        task = asyncio.create_task(package_document_routes._stage_package_document_upload(
            tmp_path / "source.pdf", "stage-key", timeout_seconds=0.01 if interruption == "timeout" else 15,
        ))
        try:
            for _ in range(100):
                if started.is_set():
                    break
                await asyncio.sleep(0.002)
            assert started.is_set()
            if interruption == "timeout":
                await asyncio.sleep(0.03)
            else:
                task.cancel()
                await asyncio.sleep(0)
                if interruption == "cancel_twice":
                    task.cancel()
                    await asyncio.sleep(0)
            assert not task.done(), "interruption released the copy before its staged file was owned"
            assert events == []
            release.set()
            expected_error = TimeoutError if interruption == "timeout" else asyncio.CancelledError
            with pytest.raises(expected_error):
                await task
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(scenario())
    assert events == ["persisted", "removed"]
    assert not destination.exists()
    if interruption == "cancel_full_lane":
        assert rejections == ["busy", "busy"]


def test_rejected_upload_staging_returns_without_waiting_for_unneeded_cleanup(monkeypatch, tmp_path):
    pool = _BlockingIOPool(1, 0)
    started, release = Event(), Event()
    destination = tmp_path / "stage.pdf"
    events = []

    def blocking():
        started.set()
        assert release.wait(1)

    def persist(*_args):
        events.append("persisted")
        destination.write_bytes(b"%PDF-stage")
        return 10, "digest"

    def remove(_key):
        events.append("removed")
        destination.unlink(missing_ok=True)

    async def saturated_io(function, *args, timeout_seconds=None, **_kwargs):
        return await pool.run(function, *args, timeout_seconds=timeout_seconds)

    monkeypatch.setattr(package_document_routes, "run_blocking_io", saturated_io)
    monkeypatch.setattr(package_document_routes, "persist_upload_path", persist)
    monkeypatch.setattr(package_document_routes, "remove_storage_key", remove)

    async def scenario():
        occupied = asyncio.create_task(pool.run(blocking, timeout_seconds=None))
        staging = None
        try:
            for _ in range(100):
                if started.is_set():
                    break
                await asyncio.sleep(0.002)
            assert started.is_set()
            staging = asyncio.create_task(package_document_routes._stage_package_document_upload(
                tmp_path / "source.pdf", "stage-key",
            ))
            await asyncio.sleep(0.02)
            assert staging.done(), "unsubmitted staging waited for cleanup on the saturated lane"
            with pytest.raises(package_document_routes.BlockingIOBusyError):
                await staging
            assert events == [] and not destination.exists()
        finally:
            release.set()
            await occupied
            if staging is not None:
                await asyncio.gather(staging, return_exceptions=True)

    try:
        asyncio.run(scenario())
    finally:
        release.set()
        pool._executor.shutdown(wait=True)


def test_cancelled_package_upload_keeps_spool_until_copy_cleanup_and_never_commits(monkeypatch, tmp_path):
    started, release = Event(), Event()
    source = tmp_path / "source.pdf"
    source.write_bytes(b"%PDF-source")
    destination = tmp_path / "staged.pdf"
    events = []

    @asynccontextmanager
    async def spool(*_args, **_kwargs):
        try:
            yield source, 11, b"%PDF-source"
        finally:
            events.append("spool_removed")
            source.unlink(missing_ok=True)

    def persist(upload_path, _storage_key):
        started.set()
        assert release.wait(1)
        destination.write_bytes(upload_path.read_bytes())
        events.append("persisted")
        return 11, "digest"

    def remove(_storage_key):
        events.append("stage_removed")
        destination.unlink(missing_ok=True)

    async def form():
        return {"file": SimpleNamespace(filename="source.pdf")}

    prepared = (SimpleNamespace(user_id="user-1"), "package-1", "HSMT", None,
                "key-12345678", "org-1", "upload")
    monkeypatch.setattr(package_document_routes, "_prepare_package_document_upload", lambda _: prepared)
    monkeypatch.setattr(package_document_routes, "_commit_package_document_upload", lambda *_: events.append("committed"))
    monkeypatch.setattr(package_document_routes, "spooled_upload", spool)
    monkeypatch.setattr(package_document_routes, "validate_pdf_path", lambda _: None)
    monkeypatch.setattr(package_document_routes, "create_storage_key", lambda *_: "stage-key")
    monkeypatch.setattr(package_document_routes, "persist_upload_path", persist)
    monkeypatch.setattr(package_document_routes, "remove_storage_key", remove)

    async def scenario():
        task = asyncio.create_task(package_document_routes.upload_package_document_api(SimpleNamespace(form=form)))
        try:
            for _ in range(100):
                if started.is_set():
                    break
                await asyncio.sleep(0.002)
            assert started.is_set()
            task.cancel()
            await asyncio.sleep(0)
            assert source.exists() and not task.done()
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(scenario())
    assert events == ["persisted", "stage_removed", "spool_removed"]
    assert not source.exists() and not destination.exists()


@pytest.mark.parametrize("interruption", ["spool_exit_cancel", "write_lane_busy"])
def test_completed_upload_stage_is_cleaned_before_commit_ownership(monkeypatch, tmp_path, interruption):
    source = tmp_path / "source.pdf"
    source.write_bytes(b"%PDF-source")
    destination = tmp_path / "stage.pdf"
    exited = Event()
    events = []

    @asynccontextmanager
    async def spool(*_args, **_kwargs):
        try:
            yield source, 11, b"%PDF-source"
        finally:
            source.unlink(missing_ok=True)
            if interruption == "spool_exit_cancel":
                exited.set()
                await asyncio.Event().wait()

    def persist(upload_path, _storage_key):
        destination.write_bytes(upload_path.read_bytes())
        events.append("persisted")
        return 11, "digest"

    def remove(_storage_key):
        events.append("removed")
        destination.unlink(missing_ok=True)

    async def form():
        return {"file": SimpleNamespace(filename="source.pdf")}

    async def reject_write(*_args, **_kwargs):
        raise package_document_routes.BlockingIOBusyError("fixture queue full")

    prepared = (SimpleNamespace(user_id="user-1"), "package-1", "HSMT", None,
                "key-12345678", "org-1", "upload")
    monkeypatch.setattr(package_document_routes, "_prepare_package_document_upload", lambda _: prepared)
    monkeypatch.setattr(package_document_routes, "_commit_package_document_upload", lambda *_: events.append("committed"))
    monkeypatch.setattr(package_document_routes, "spooled_upload", spool)
    monkeypatch.setattr(package_document_routes, "validate_pdf_path", lambda _: None)
    monkeypatch.setattr(package_document_routes, "create_storage_key", lambda *_: "stage-key")
    monkeypatch.setattr(package_document_routes, "persist_upload_path", persist)
    monkeypatch.setattr(package_document_routes, "remove_storage_key", remove)
    monkeypatch.setattr(package_document_routes, "log_and_error", lambda *_, **kwargs: package_document_routes.JSONResponse(
        {"success": False}, status_code=kwargs.get("status_code", 500),
    ))
    if interruption == "write_lane_busy":
        monkeypatch.setattr(package_document_routes, "run_database_write", reject_write)

    async def scenario():
        task = asyncio.create_task(package_document_routes.upload_package_document_api(SimpleNamespace(form=form)))
        try:
            if interruption == "spool_exit_cancel":
                for _ in range(100):
                    if exited.is_set():
                        break
                    await asyncio.sleep(0.002)
                assert exited.is_set() and destination.exists()
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
            else:
                response = await task
                assert response.status_code == 503
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(scenario())
    assert events == ["persisted", "removed"]
    assert not destination.exists()


def test_package_document_list_rejects_full_bounded_database_lane(monkeypatch):
    pool = _BlockingIOPool(1, 0)
    monkeypatch.setattr(database_io, "_read_pool", pool)
    started, release = Event(), Event()

    def blocking():
        started.set()
        release.wait(1)

    async def scenario():
        pending = asyncio.create_task(database_io.run_database_read(blocking))
        try:
            while not started.is_set():
                await asyncio.sleep(0.002)
            response = await package_document_routes.list_package_documents_api(object())
            assert response.status_code == 503
        finally:
            release.set()
            await pending

    try:
        asyncio.run(scenario())
    finally:
        pool._executor.shutdown(wait=True)


def test_catalog_word_preview_waits_for_required_audit_off_event_loop(monkeypatch):
    started, release = Event(), Event()
    prepared = {"role": SimpleNamespace(user_id="user-1"), "organizationId": "org-1",
                "recordType": "goi_thau", "recordId": "package-1", "mode": "record",
                "documentType": "report", "recordRowVersion": 1,
                "version": {"content": b"template", "sha256": "a" * 64, "versionNo": 1},
                "context": {}, "manifest": {}}

    async def payload():
        return {"mode": "record", "documentType": "report", "recordId": "package-1"}

    async def render(*_args, **_kwargs):
        return b"output"

    def audit(*_args, **kwargs):
        assert kwargs["required"] is True
        started.set()
        release.wait(0.3)

    monkeypatch.setattr(catalog_routes, "catalog_enabled", lambda: True)
    monkeypatch.setattr(catalog_routes, "_prepare_catalog_preview", lambda *_: prepared)
    monkeypatch.setattr(catalog_routes, "run_document_job_async", render)
    monkeypatch.setattr(catalog_routes, "log_audit", audit)
    request = SimpleNamespace(path_params={"version_id": "version-1"}, json=payload)
    response = asyncio.run(_assert_responsive(catalog_routes.preview_catalog_version_api(request), started, release))
    assert response.status_code == 200
