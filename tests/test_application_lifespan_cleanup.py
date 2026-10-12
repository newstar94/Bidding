import asyncio
import threading
from types import SimpleNamespace

import pytest

from backend import lifecycle
from backend.partners import partner_lookup_service
from backend.procurement_import import routes as procurement_routes
from backend.sync import websocket
from backend.auth import email_delivery_service
from backend.billing import worker as billing_worker
from backend.documents import award_result_excel_service, document_worker
from backend.documents.template_catalog import compatibility
from backend.observability import metrics
from backend.shared import audit_monitor


@pytest.fixture
def lifespan_harness(monkeypatch, tmp_path):
    threads = []
    calls = []
    real_thread = threading.Thread
    sleep_release = threading.Event()

    class TrackedThread(real_thread):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            if self.name in {"cache-retention-cleanup", "procurement-enrichment-recovery"} or (
                self._target is partner_lookup_service.run_partner_lookup_worker
            ):
                threads.append(self)

        def run(self):
            try:
                super().run()
            except SystemExit:
                # Only the old worker needs an injected exit during red-test cleanup.
                pass

    class Database:
        closed = False

        def close(self):
            calls.append("database-close")
            self.closed = True

    async def idle(*_args, **_kwargs):
        await asyncio.Event().wait()

    async def verified(*_args, **_kwargs):
        return None

    monkeypatch.setenv("DATABASE_AUTO_MIGRATE", "false")
    monkeypatch.setenv("PROCUREMENT_LOOKUP_ENABLED", "false")
    for name in (
        "validate_artifact_store_configuration", "validate_document_worker_configuration",
        "cleanup_stale_document_jobs", "verify_database_readiness", "reconcile_asset_journal",
        "validate_payment_provider_runtime",
    ):
        monkeypatch.setattr(lifecycle, name, lambda *_args, **_kwargs: None)
    monkeypatch.setattr(lifecycle, "configure_payment_runtime", lambda _environment: None)
    monkeypatch.setattr(lifecycle, "external_document_worker_enabled", lambda: True)
    monkeypatch.setattr(lifecycle, "billing_worker_enabled", lambda: False)
    monkeypatch.setattr(lifecycle, "verify_audit_chain_before_ready", verified)
    for name in (
        "_monitor_event_loop", "monitor_audit_chain", "monitor_operational_artifacts",
        "monitor_filesystem_metrics", "monitor_multiprocess_metrics",
        "run_validation_artifact_janitor", "run_legacy_alias_projection_worker",
        "run_word_template_retention_janitor", "run_email_delivery_worker",
    ):
        monkeypatch.setattr(lifecycle, name, idle)
    monkeypatch.setattr(websocket, "_pending_broker_start_id", lambda: 0)
    monkeypatch.setattr(websocket, "run_websocket_event_broker", idle)
    monkeypatch.setattr(procurement_routes, "run_plan_enrichment_recovery_worker", lambda stop: stop.wait())
    monkeypatch.setattr(lifecycle.threading, "Thread", TrackedThread)
    # The old uninterruptible sleep is released in fixture cleanup, so a red
    # regression does not leave an actual daemon alive for the rest of pytest.
    monkeypatch.setattr(lifecycle.time, "sleep", lambda _delay: sleep_release.wait())

    def purge(database):
        if database.closed:
            calls.append("work-after-close")
            raise SystemExit
        calls.append("purge")

    monkeypatch.setattr(lifecycle, "_purge_retained_rows", purge)
    database = Database()
    application = SimpleNamespace(state=SimpleNamespace())
    kwargs = {
        "database": database, "schema_version": 100,
        "initialize_database": lambda: None, "build_index_response": lambda: None,
        "prewarm_frontend_assets": lambda: None, "is_production": False,
        "image_dir": str(tmp_path), "background_startup_delay_seconds": 0,
        "enable_image_cache_prewarm": False, "enable_partner_lookup_worker": False,
        "validate_startup": lambda _database: None,
    }
    yield SimpleNamespace(application=application, database=database, kwargs=kwargs,
                          threads=threads, calls=calls, release=sleep_release)
    sleep_release.set()
    for thread in threads:
        if thread.name == "procurement-enrichment-recovery" and thread.is_alive():
            thread._args[0].set()
    partner_lookup_service._partner_work_event.set()
    for thread in threads:
        thread.join(timeout=2)
    # Direct route unit tests use the pre-lifespan default admission state.
    procurement_routes.begin_plan_enrichment_lifecycle()


def test_lifespan_stops_and_joins_retention_before_database_close(lifespan_harness):
    harness = lifespan_harness

    async def scenario():
        async with lifecycle.application_lifespan(harness.application, **harness.kwargs):
            assert harness.application.state.ready
            assert any(thread.name == "cache-retention-cleanup" for thread in harness.threads)
        assert not any(thread.is_alive() for thread in harness.threads)
        assert harness.database.closed
        assert not harness.application.state.ready
        assert "work-after-close" not in harness.calls

    asyncio.run(scenario())


def test_lifespan_closes_database_when_initial_validation_fails(lifespan_harness):
    harness = lifespan_harness

    def fail(_database):
        raise RuntimeError("validation failed")

    harness.kwargs["validate_startup"] = fail

    async def scenario():
        with pytest.raises(RuntimeError, match="validation failed"):
            async with lifecycle.application_lifespan(harness.application, **harness.kwargs):
                pytest.fail("startup must fail")
        assert harness.database.closed
        assert not harness.application.state.ready

    asyncio.run(scenario())


def test_lifespan_cleans_started_workers_when_partner_startup_fails(lifespan_harness, monkeypatch):
    harness = lifespan_harness
    harness.kwargs["enable_partner_lookup_worker"] = True

    def fail():
        raise RuntimeError("partner startup failed")

    monkeypatch.setattr(partner_lookup_service, "start_partner_background_service", fail)

    async def scenario():
        with pytest.raises(RuntimeError, match="partner startup failed"):
            async with lifecycle.application_lifespan(harness.application, **harness.kwargs):
                pytest.fail("startup must fail")
        assert harness.database.closed
        assert not any(thread.is_alive() for thread in harness.threads)
        assert not harness.application.state.ready

    asyncio.run(scenario())


def test_lifespan_joins_default_partner_worker_before_database_close(lifespan_harness, monkeypatch):
    harness = lifespan_harness
    harness.kwargs["enable_partner_lookup_worker"] = True
    observed = threading.Event()

    def claim():
        if harness.database.closed:
            harness.calls.append("partner-work-after-close")
            raise SystemExit
        harness.calls.append("partner-claim")
        observed.set()
        return None

    monkeypatch.setattr(partner_lookup_service, "_claim_partner_enrichment_job", claim)

    async def scenario():
        async with lifecycle.application_lifespan(harness.application, **harness.kwargs):
            partner_lookup_service._partner_work_event.set()
            assert await asyncio.to_thread(observed.wait, 2)
        assert not any(thread.is_alive() for thread in harness.threads)
        assert harness.database.closed
        assert "partner-work-after-close" not in harness.calls

    asyncio.run(scenario())


@pytest.mark.parametrize("cancel_shutdown", (False, True))
def test_lifespan_finishes_active_partner_job_before_close(
    lifespan_harness, monkeypatch, cancel_shutdown,
):
    harness = lifespan_harness
    harness.kwargs["enable_partner_lookup_worker"] = True
    processing = threading.Event()
    release_job = threading.Event()
    claims = []

    def claim():
        assert not harness.database.closed
        claims.append("claim")
        return {"id": "durable-job"}

    def process(_job):
        processing.set()
        assert release_job.wait(2)
        assert not harness.database.closed
        harness.calls.append("partner-finished")

    monkeypatch.setattr(partner_lookup_service, "_claim_partner_enrichment_job", claim)
    monkeypatch.setattr(partner_lookup_service, "_process_partner_enrichment_job", process)

    async def scenario():
        context = lifecycle.application_lifespan(harness.application, **harness.kwargs)
        await context.__aenter__()
        partner_lookup_service._partner_work_event.set()
        assert await asyncio.to_thread(processing.wait, 2)
        shutdown = asyncio.create_task(context.__aexit__(None, None, None))
        assert await asyncio.to_thread(partner_lookup_service._partner_stop_event.wait, 2)
        assert not harness.database.closed
        assert not shutdown.done()
        if cancel_shutdown:
            shutdown.cancel()
            await asyncio.sleep(0)
            shutdown.cancel()
        release_job.set()
        if cancel_shutdown:
            with pytest.raises(asyncio.CancelledError):
                await shutdown
        else:
            await shutdown
        assert claims == ["claim"]
        assert harness.calls.index("partner-finished") < harness.calls.index("database-close")
        assert not any(thread.is_alive() for thread in harness.threads)

    try:
        asyncio.run(scenario())
    finally:
        release_job.set()


def test_partner_stop_deadline_reports_running_job_and_worker_can_restart(monkeypatch):
    processing = threading.Event()
    release_job = threading.Event()

    def drain():
        processing.set()
        assert release_job.wait(2)
        return 0

    monkeypatch.setattr(partner_lookup_service, "_drain_partner_enrichment_jobs", drain)
    worker = partner_lookup_service.start_partner_background_service()
    assert partner_lookup_service.start_partner_background_service() is worker
    try:
        partner_lookup_service._partner_work_event.set()
        assert processing.wait(2)
        assert partner_lookup_service.stop_partner_background_service(timeout=0) is False
    finally:
        release_job.set()
        assert partner_lookup_service.stop_partner_background_service(timeout=2) is True
    assert not partner_lookup_service._partner_worker_started
    restarted = partner_lookup_service.start_partner_background_service()
    assert restarted is not worker
    assert partner_lookup_service.stop_partner_background_service(timeout=2) is True


def test_lifespan_cleans_tasks_and_database_when_broker_startup_fails(lifespan_harness, monkeypatch):
    harness = lifespan_harness

    def fail():
        raise RuntimeError("broker startup failed")

    monkeypatch.setattr(websocket, "_pending_broker_start_id", fail)

    async def scenario():
        before = set(asyncio.all_tasks())
        with pytest.raises(RuntimeError, match="broker startup failed"):
            async with lifecycle.application_lifespan(harness.application, **harness.kwargs):
                pytest.fail("startup must fail")
        assert harness.database.closed
        assert not harness.application.state.ready
        assert set(asyncio.all_tasks()) == before

    asyncio.run(scenario())


@pytest.mark.parametrize("worker_name", (
    "projection", "catalog-retention", "billing", "email", "document-queue",
    "validation-artifacts", "audit", "filesystem", "operational-artifacts",
))
@pytest.mark.parametrize("cancel_shutdown", (False, True))
def test_lifespan_finishes_actual_worker_submission_before_close(
    lifespan_harness, monkeypatch, worker_name, cancel_shutdown,
):
    """Run the real async worker; pause only its synchronous work boundary."""
    harness = lifespan_harness
    processing, release, finished = threading.Event(), threading.Event(), threading.Event()

    def work(*_args, **_kwargs):
        processing.set()
        try:
            assert release.wait(3)
            if harness.database.closed:
                harness.calls.append("work-after-close")
            harness.calls.append("worker-finished")
            return False
        finally:
            finished.set()

    if worker_name == "projection":
        monkeypatch.setattr(compatibility, "catalog_enabled", lambda *_args: True)
        monkeypatch.setattr(compatibility, "catalog_mode", lambda *_args: "cutover")
        monkeypatch.setattr(compatibility.LegacyAliasProjectionWorker, "recover_stale", lambda self: None)
        monkeypatch.setattr(compatibility.LegacyAliasProjectionWorker, "process_next", work)
        monkeypatch.setattr(lifecycle, "run_legacy_alias_projection_worker", compatibility.run_legacy_alias_projection_worker)
    elif worker_name == "catalog-retention":
        monkeypatch.setattr(compatibility, "catalog_enabled", lambda *_args: True)
        monkeypatch.setattr(compatibility, "_purge_catalog_retention", work)
        monkeypatch.setattr(lifecycle, "run_word_template_retention_janitor", compatibility.run_word_template_retention_janitor)
    elif worker_name == "billing":
        monkeypatch.setattr(lifecycle, "billing_worker_enabled", lambda: True)
        monkeypatch.setattr(billing_worker, "billing_worker_enabled", lambda *_args: True)
        monkeypatch.setattr(billing_worker.BillingWorkProcessor, "process_next", work)
        monkeypatch.setattr(lifecycle, "run_billing_worker", billing_worker.run_billing_worker)
    elif worker_name == "email":
        monkeypatch.setattr(email_delivery_service, "process_next_email_delivery", work)
        monkeypatch.setattr(lifecycle, "run_email_delivery_worker", email_delivery_service.run_email_delivery_worker)
    elif worker_name == "document-queue":
        monkeypatch.setenv("DOCUMENT_WORKER_MAX_CONCURRENCY", "1")
        monkeypatch.setattr(lifecycle, "external_document_worker_enabled", lambda: False)
        monkeypatch.setattr(document_worker, "process_next_durable_document_job", work)
        monkeypatch.setattr(lifecycle, "run_durable_document_queue_worker", document_worker.run_durable_document_queue_worker)
    elif worker_name == "validation-artifacts":
        monkeypatch.setattr(award_result_excel_service, "cleanup_expired_validation_artifacts", work)
        monkeypatch.setattr(lifecycle, "run_validation_artifact_janitor", award_result_excel_service.run_validation_artifact_janitor)
    elif worker_name == "audit":
        monkeypatch.setattr(audit_monitor, "_inspect_database", work)
        monkeypatch.setattr(audit_monitor, "_checkpoint_destination", lambda: "")
        monkeypatch.setattr(lifecycle, "monitor_audit_chain", audit_monitor.monitor_audit_chain)
    elif worker_name == "filesystem":
        monkeypatch.setattr(metrics, "refresh_filesystem_metrics", work)
        monkeypatch.setattr(lifecycle, "monitor_filesystem_metrics", metrics.monitor_filesystem_metrics)
    else:
        monkeypatch.setattr(metrics, "refresh_operational_artifact_verification", work)
        monkeypatch.setattr(lifecycle, "monitor_operational_artifacts", metrics.monitor_operational_artifacts)

    async def scenario():
        context = lifecycle.application_lifespan(harness.application, **harness.kwargs)
        await context.__aenter__()
        assert await asyncio.to_thread(processing.wait, 2)
        shutdown = asyncio.create_task(context.__aexit__(None, None, None))
        try:
            await asyncio.wait({shutdown}, timeout=0.1)
            assert not shutdown.done(), "shutdown returned while submitted work was still active"
            assert not harness.database.closed
            if cancel_shutdown:
                shutdown.cancel()
                await asyncio.sleep(0)
                shutdown.cancel()
        finally:
            release.set()
            if cancel_shutdown and shutdown.cancelling():
                with pytest.raises(asyncio.CancelledError):
                    await shutdown
            else:
                await shutdown
            assert await asyncio.to_thread(finished.wait, 2)
        assert "work-after-close" not in harness.calls
        assert harness.calls.index("worker-finished") < harness.calls.index("database-close")

    try:
        asyncio.run(scenario())
    finally:
        release.set()


@pytest.mark.parametrize("origin", ("prepare", "recovery"))
@pytest.mark.parametrize("cancel_shutdown", (False, True))
def test_lifespan_joins_procurement_enrichment_children(
    lifespan_harness, monkeypatch, origin, cancel_shutdown,
):
    harness = lifespan_harness
    processing, release, finished = threading.Event(), threading.Event(), threading.Event()
    children = []
    bundle = {"plan": {"familyNo": "PL2600000001"}}
    session = {
        "provider": "MUASAMCONG", "familyNo": "PL2600000001", "userId": "user",
        "workspaceLease": "lease", "canonicalBundle": bundle,
        "bundleDigest": procurement_routes.canonical_digest(bundle),
    }

    def child(_context, _operation):
        children.append(threading.current_thread())
        processing.set()
        try:
            assert release.wait(3)
            if harness.database.closed:
                harness.calls.append("child-after-close")
            harness.calls.append("child-finished")
        finally:
            finished.set()

    monkeypatch.setattr(procurement_routes, "_run_plan_enrichment", child)
    monkeypatch.setattr(procurement_routes, "_linked_notice_numbers", lambda _bundle: ["IB2600000001"])
    monkeypatch.setattr(procurement_routes.PREVIEW_STORE, "get", lambda *_args, **_kwargs: SimpleNamespace(canonical_bundle=bundle))
    created = []

    def operation(*_args):
        created.append("PENDING")
        return {"operationId": "operation", "status": "PENDING"}

    monkeypatch.setattr(procurement_routes, "_create_enrichment_operation", operation)
    if origin == "recovery":
        rows = [("org", "operation", "MUASAMCONG", "PL2600000001", "user", "enrichment:session")]
        connection = SimpleNamespace(
            cursor=lambda: SimpleNamespace(execute=lambda *_args: SimpleNamespace(fetchall=lambda: rows)),
            rollback=lambda: None, close=lambda: None,
        )
        monkeypatch.setattr(procurement_routes, "database", SimpleNamespace(get_connection=lambda: connection))
        monkeypatch.setattr(procurement_routes.ProcurementImportSessionRepository, "get_for_background_recovery", lambda *_args, **_kwargs: session)

    def start_child():
        if origin == "recovery":
            return procurement_routes.recover_stale_plan_enrichments()
        return procurement_routes._start_plan_enrichment({
            "previewId": "preview", "_enrichmentContext": {
                "organizationId": "org", "userId": "user", "workspaceLease": "lease",
            },
        })

    async def scenario():
        context = lifecycle.application_lifespan(harness.application, **harness.kwargs)
        await context.__aenter__()
        start_child()
        assert await asyncio.to_thread(processing.wait, 2)
        shutdown = asyncio.create_task(context.__aexit__(None, None, None))
        try:
            await asyncio.wait({shutdown}, timeout=0.1)
            assert not shutdown.done(), "shutdown did not own the enrichment child"
            assert not harness.database.closed
            if cancel_shutdown:
                shutdown.cancel()
                await asyncio.sleep(0)
                shutdown.cancel()
            # A durable pending operation may be created, but must not launch
            # another child after shutdown closes admission.
            start_child()
            assert len(children) == 1
        finally:
            release.set()
            if cancel_shutdown and shutdown.cancelling():
                with pytest.raises(asyncio.CancelledError):
                    await shutdown
            else:
                await shutdown
            for thread in children:
                await asyncio.to_thread(thread.join, 2)
        assert finished.is_set()
        assert "child-after-close" not in harness.calls
        assert harness.calls.index("child-finished") < harness.calls.index("database-close")
        assert all(not thread.is_alive() for thread in children)
        # A new lifespan restores admission, including procurement prewarm off.
        harness.database.closed = False
        async with lifecycle.application_lifespan(harness.application, **harness.kwargs):
            start_child()
        assert len(children) == 2
        if origin == "prepare":
            assert created == ["PENDING", "PENDING", "PENDING"]

    try:
        asyncio.run(scenario())
    finally:
        release.set()
        for thread in children:
            thread.join(2)
