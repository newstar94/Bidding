"""ASGI lifecycle, readiness and background maintenance orchestration."""

import asyncio
import contextlib
import os
import threading
import time
from contextlib import asynccontextmanager

from backend.auth.auth_helper import _session_cache_cleanup
from backend.auth.email_delivery_service import (
    fail_stale_email_deliveries,
    run_email_delivery_worker,
)
from backend.documents.document_worker import (
    cleanup_orphaned_durable_document_jobs,
    cleanup_stale_document_jobs,
    external_document_worker_enabled,
    purge_expired_durable_document_jobs,
    run_durable_document_queue_worker,
    validate_document_worker_configuration,
)
from backend.observability.metrics import monitor_operational_artifacts
from backend.shared.async_io import run_blocking_io
from backend.shared.audit_monitor import (
    monitor_audit_chain,
    verify_audit_chain_before_ready,
)
from backend.shared.helpers import _org_cache_cleanup
from backend.shared.logging_utils import log_error
from backend.startup import (
    validate_startup_configuration,
    verify_database_readiness,
    verify_database_runtime_role,
)


def database_auto_migration_enabled(environ=None):
    """Return true only when schema mutation was explicitly opted into."""

    environment = os.environ if environ is None else environ
    return str(environment.get("DATABASE_AUTO_MIGRATE", "false")).strip().lower() in {
        "1",
        "true",
        "yes",
    }


async def _monitor_event_loop(application):
    try:
        interval = float(os.environ.get("EVENT_LOOP_LAG_INTERVAL_SECONDS", "1"))
        warn_threshold_ms = float(os.environ.get("EVENT_LOOP_LAG_WARN_MS", "500"))
    except ValueError:
        interval, warn_threshold_ms = 1.0, 500.0
    interval = max(0.1, interval)
    warn_threshold_ms = max(10.0, warn_threshold_ms)
    loop = asyncio.get_running_loop()
    last_warning = 0.0
    while True:
        expected = loop.time() + interval
        await asyncio.sleep(interval)
        now = loop.time()
        lag_ms = max(0.0, (now - expected) * 1000)
        application.state.event_loop_lag_ms = lag_ms
        if lag_ms >= warn_threshold_ms and now - last_warning >= 60:
            log_error(f"Event loop lag {lag_ms:.1f}ms", "event_loop_monitor", level="WARN")
            last_warning = now


def _start_optional_services(delay_seconds, enable_image_cache_prewarm):
    if delay_seconds:
        time.sleep(delay_seconds)
    if enable_image_cache_prewarm:
        try:
            from backend.documents.custom_exporter import prewarm_image_cache
            prewarm_image_cache()
        except Exception as exc:
            log_error(exc, "prewarm_image_cache")


def _purge_retained_rows(database):
    conn = None
    try:
        conn = database.get_connection()
        conn.execute("BEGIN")
        leader = conn.execute(
            "SELECT pg_try_advisory_xact_lock(hashtext('biddingflow-retention-cleanup'))"
        ).fetchone()
        if not leader or not leader[0]:
            conn.rollback()
            return
        retention_days = max(1, int(os.environ.get("SYNC_TOMBSTONE_RETENTION_DAYS", "90")))
        for organization_id, max_version in conn.execute(
            """SELECT organization_id, MAX(delete_version)
               FROM deleted_records
               WHERE deleted_at < CURRENT_TIMESTAMP - (%s * INTERVAL '1 day')
               GROUP BY organization_id""",
            (retention_days,),
        ).fetchall():
            conn.execute(
                """UPDATE sync_metadata
                   SET min_available_version = GREATEST(min_available_version, %s),
                       updated_at = CURRENT_TIMESTAMP
                   WHERE organization_id = %s""",
                (int(max_version or 0), organization_id),
            )
        conn.execute(
            "DELETE FROM deleted_records WHERE deleted_at < CURRENT_TIMESTAMP - (%s * INTERVAL '1 day')",
            (retention_days,),
        )
        mutation_days = max(1, int(os.environ.get("SYNC_MUTATION_RETENTION_DAYS", "30")))
        conn.execute(
            "DELETE FROM sync_mutations WHERE created_at < CURRENT_TIMESTAMP - (%s * INTERVAL '1 day')",
            (mutation_days,),
        )
        idempotency_days = max(1, int(os.environ.get("API_IDEMPOTENCY_RETENTION_DAYS", "7")))
        conn.execute("DELETE FROM api_idempotency WHERE created_at < ?", (int(time.time()) - idempotency_days * 86400,))
        conn.execute(
            "DELETE FROM rate_limit_buckets WHERE expires_at <= ?",
            (int(time.time()),),
        )
        conn.execute(
            "DELETE FROM partner_lookup_cache WHERE expires_at <= ?",
            (int(time.time()),),
        )
        partner_job_retention_days = max(
            1,
            int(os.environ.get("PARTNER_JOB_RETENTION_DAYS", "30")),
        )
        conn.execute(
            """
            DELETE FROM partner_enrichment_jobs
            WHERE status IN ('completed', 'failed') AND updated_at <= ?
            """,
            (int(time.time()) - partner_job_retention_days * 86400,),
        )
        session_retention_days = max(
            1,
            int(os.environ.get("SESSION_RETENTION_DAYS", "30")),
        )
        session_cutoff = int(time.time()) - session_retention_days * 86400
        conn.execute(
            """
            DELETE FROM auth_sessions
            WHERE (revoked_at IS NOT NULL AND revoked_at <= ?)
               OR absolute_expires_at <= ?
               OR idle_expires_at <= ?
            """,
            (session_cutoff, session_cutoff, session_cutoff),
        )
        # Audit history is immutable. Retention requires a separately signed
        # checkpoint/partition archival workflow and must never be a blind row
        # delete from the application cleanup loop.
        conn.commit()
        fail_stale_email_deliveries(database)
        purge_expired_durable_document_jobs(database)
    except Exception as exc:
        log_error(exc, "retention_cleanup", level="WARN")
    finally:
        if conn is not None:
            conn.close()


def _purge_derived_images(image_dir):
    try:
        expert_dir = os.path.join(image_dir, "chuyen_gia")
        if not os.path.exists(expert_dir):
            return
        cutoff = time.time() - 86400 * 30
        for filename in os.listdir(expert_dir):
            path = os.path.join(expert_dir, filename)
            if "_opt_" in filename and os.path.getmtime(path) < cutoff:
                os.remove(path)
    except Exception as exc:
        log_error(exc, "derived_image_cleanup", level="WARN")


def _run_cache_cleanup(database, image_dir):
    cleanup_cycle = 0
    while True:
        time.sleep(300)
        cleanup_cycle += 1
        try:
            _session_cache_cleanup()
            _org_cache_cleanup()
        except Exception as exc:
            log_error(exc, "memory_cache_cleanup", level="WARN")
        if cleanup_cycle % 6 == 0:
            _purge_retained_rows(database)
            _purge_derived_images(image_dir)


@asynccontextmanager
async def application_lifespan(
    application,
    *,
    database,
    schema_version,
    initialize_database,
    build_index_response,
    prewarm_frontend_assets,
    is_production,
    image_dir,
    background_startup_delay_seconds,
    enable_image_cache_prewarm,
    enable_partner_lookup_worker,
    validate_startup=validate_startup_configuration,
):
    application.state.ready = False
    application.state.startup_complete = False
    application.state.event_loop_lag_ms = 0.0
    monitor_task = None
    audit_monitor_task = None
    artifact_monitor_task = None
    broker_task = None
    email_delivery_task = None
    document_queue_task = None
    try:
        validate_startup(database)
        validate_document_worker_configuration()
        if external_document_worker_enabled():
            cleanup_orphaned_durable_document_jobs(database)
        else:
            cleanup_stale_document_jobs()
        if is_production:
            build_index_response()
        prewarm_frontend_assets()
        if database_auto_migration_enabled():
            initialize_database()
        verify_database_readiness(database, schema_version)
        if is_production:
            verify_database_runtime_role(
                database,
                expected_role=str(
                    os.environ.get("DATABASE_RUNTIME_ROLE", "")
                ).strip(),
            )
        await verify_audit_chain_before_ready(database)
    except Exception as exc:
        log_error(exc, "startup_database_init")
        raise

    application.state.startup_complete = True
    application.state.ready = True
    monitor_task = asyncio.create_task(_monitor_event_loop(application))
    audit_monitor_task = asyncio.create_task(
        monitor_audit_chain(database, application=application)
    )
    artifact_monitor_task = asyncio.create_task(monitor_operational_artifacts())
    email_delivery_task = asyncio.create_task(run_email_delivery_worker(database))
    if not external_document_worker_enabled():
        document_queue_task = asyncio.create_task(
            run_durable_document_queue_worker(database)
        )
    try:
        from backend.sync.websocket import _latest_broker_event_id, run_websocket_event_broker
        broker_cursor = await run_blocking_io(_latest_broker_event_id, timeout_seconds=5.0)
        broker_task = asyncio.create_task(run_websocket_event_broker(start_after_id=broker_cursor))
    except Exception:
        for task in (
            monitor_task,
            audit_monitor_task,
            artifact_monitor_task,
            email_delivery_task,
            document_queue_task,
        ):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        application.state.ready = False
        application.state.startup_complete = False
        raise

    threading.Thread(
        target=_start_optional_services,
        args=(background_startup_delay_seconds, enable_image_cache_prewarm),
        daemon=True,
        name="optional-background-startup",
    ).start()
    threading.Thread(
        target=_run_cache_cleanup,
        args=(database, image_dir),
        daemon=True,
        name="cache-retention-cleanup",
    ).start()
    if enable_partner_lookup_worker:
        from backend.partners.partner_lookup_service import (
            start_partner_background_service,
        )

        start_partner_background_service()
    try:
        yield
    finally:
        for task in (
            monitor_task,
            audit_monitor_task,
            artifact_monitor_task,
            broker_task,
            email_delivery_task,
            document_queue_task,
        ):
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        application.state.ready = False
        application.state.startup_complete = False
        database.close()
