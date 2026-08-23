"""ASGI lifecycle, readiness and background maintenance orchestration."""

import asyncio
import contextlib
import os
import threading
import time
from contextlib import asynccontextmanager

from psycopg import Error as PostgresError
from psycopg import sql

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
from backend.documents.award_result_excel_service import (
    run_validation_artifact_janitor,
    validate_artifact_store_configuration,
)
from backend.observability.metrics import (
    monitor_multiprocess_metrics,
    monitor_operational_artifacts,
)
from backend.shared.async_io import run_blocking_io
from backend.shared.audit_monitor import (
    monitor_audit_chain,
    verify_audit_chain_before_ready,
)
from backend.shared.logging_utils import log_error
from backend.shared.media_helper import reconcile_asset_journal
from backend.startup import (
    validate_startup_configuration,
    verify_database_readiness,
    verify_database_runtime_role,
)


def database_auto_migration_enabled(environ=None):
    """Enable schema upgrades by default outside production."""

    environment = os.environ if environ is None else environ
    app_environment = str(environment.get("APP_ENV", "development")).strip().lower()
    default = "false" if app_environment in {"prod", "production"} else "true"
    return str(environment.get("DATABASE_AUTO_MIGRATE", default)).strip().lower() in {
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


def _procurement_source_initialization_enabled(environ=None):
    environment = os.environ if environ is None else environ
    return str(
        environment.get("PROCUREMENT_LOOKUP_ENABLED", "false")
    ).strip().casefold() == "true"


def _initialize_procurement_source():
    from backend.integrations.muasamcong_browser.registry import (
        get_muasamcong_source,
    )

    get_muasamcong_source()


def _retention_batch_size():
    return max(
        1,
        min(10_000, int(os.environ.get("RETENTION_CLEANUP_BATCH_SIZE", "1000"))),
    )


def _delete_retention_batches(
    conn,
    *,
    table,
    where_sql,
    parameters,
    order_by,
    batch_size,
):
    while True:
        deleted = conn.execute(
            sql.SQL(
                """WITH candidates AS (
                    SELECT ctid
                      FROM {table_name}
                     WHERE {where_clause}
                     ORDER BY {order_clause}
                     LIMIT %s
                     FOR UPDATE SKIP LOCKED
                ), deleted AS (
                    DELETE FROM {table_name} AS target
                     USING candidates
                     WHERE target.ctid = candidates.ctid
                     RETURNING 1
                )
                SELECT COUNT(*) FROM deleted"""
            ).format(
                table_name=sql.Identifier(table),
                where_clause=sql.SQL(where_sql),
                order_clause=sql.SQL(order_by),
            ),
            (*parameters, batch_size),
        ).fetchone()
        deleted_count = int(deleted[0] or 0) if deleted else 0
        if not deleted_count:
            conn.rollback()
            return
        conn.commit()


def _purge_tombstone_batches(conn, retention_days, batch_size):
    while True:
        deleted_groups = conn.execute(
            """WITH candidates AS (
                    SELECT ctid
                      FROM deleted_records
                     WHERE deleted_at
                           < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')
                     ORDER BY deleted_at, organization_id, delete_version
                     LIMIT ?
                     FOR UPDATE SKIP LOCKED
                ), deleted AS (
                    DELETE FROM deleted_records AS target
                     USING candidates
                     WHERE target.ctid = candidates.ctid
                     RETURNING target.organization_id, target.delete_version
                )
                SELECT organization_id, MAX(delete_version), COUNT(*)
                  FROM deleted
                 GROUP BY organization_id""",
            (retention_days, batch_size),
        ).fetchall()
        if not deleted_groups:
            conn.rollback()
            return
        for organization_id, max_version, _deleted_count in deleted_groups:
            conn.execute(
                """UPDATE sync_metadata
                      SET min_available_version = GREATEST(min_available_version, ?),
                          updated_at = CURRENT_TIMESTAMP
                    WHERE organization_id = ?""",
                (int(max_version or 0), organization_id),
            )
        conn.commit()


def _purge_retained_rows(database):
    conn = None
    retention_lock_acquired = False
    try:
        conn = database.get_connection()
        conn.execute("BEGIN")
        leader = conn.execute(
            "SELECT pg_try_advisory_lock(hashtext('biddingflow-retention-cleanup'))"
        ).fetchone()
        if not leader or not leader[0]:
            conn.rollback()
            return
        retention_lock_acquired = True
        batch_size = _retention_batch_size()
        retention_days = max(1, int(os.environ.get("SYNC_TOMBSTONE_RETENTION_DAYS", "90")))
        _purge_tombstone_batches(conn, retention_days, batch_size)
        mutation_days = max(1, int(os.environ.get("SYNC_MUTATION_RETENTION_DAYS", "30")))
        _delete_retention_batches(
            conn,
            table="sync_mutations",
            where_sql="created_at < CURRENT_TIMESTAMP - (%s * INTERVAL '1 day')",
            parameters=(mutation_days,),
            order_by="created_at",
            batch_size=batch_size,
        )
        idempotency_days = max(1, int(os.environ.get("API_IDEMPOTENCY_RETENTION_DAYS", "7")))
        now = int(time.time())
        _delete_retention_batches(
            conn,
            table="api_idempotency",
            where_sql="created_at < %s",
            parameters=(now - idempotency_days * 86400,),
            order_by="created_at",
            batch_size=batch_size,
        )
        _delete_retention_batches(
            conn,
            table="rate_limit_buckets",
            where_sql="expires_at <= %s",
            parameters=(now,),
            order_by="expires_at",
            batch_size=batch_size,
        )
        _delete_retention_batches(
            conn,
            table="partner_lookup_cache",
            where_sql="expires_at <= %s",
            parameters=(now,),
            order_by="expires_at",
            batch_size=batch_size,
        )
        partner_job_retention_days = max(
            1,
            int(os.environ.get("PARTNER_JOB_RETENTION_DAYS", "30")),
        )
        _delete_retention_batches(
            conn,
            table="partner_enrichment_jobs",
            where_sql="status IN ('completed', 'failed') AND updated_at <= %s",
            parameters=(now - partner_job_retention_days * 86400,),
            order_by="updated_at",
            batch_size=batch_size,
        )
        session_retention_days = max(
            1,
            int(os.environ.get("SESSION_RETENTION_DAYS", "30")),
        )
        session_cutoff = now - session_retention_days * 86400
        _delete_retention_batches(
            conn,
            table="auth_sessions",
            where_sql=(
                "(revoked_at IS NOT NULL AND revoked_at <= %s) "
                "OR absolute_expires_at <= %s OR idle_expires_at <= %s"
            ),
            parameters=(session_cutoff, session_cutoff, session_cutoff),
            order_by=(
                "LEAST(COALESCE(revoked_at, absolute_expires_at), "
                "absolute_expires_at, idle_expires_at)"
            ),
            batch_size=batch_size,
        )
        # Audit history is immutable. Retention requires a separately signed
        # checkpoint/partition archival workflow and must never be a blind row
        # delete from the application cleanup loop.
        conn.rollback()
        conn.execute(
            "SELECT pg_advisory_unlock(hashtext('biddingflow-retention-cleanup'))"
        ).fetchone()
        conn.rollback()
        retention_lock_acquired = False
        fail_stale_email_deliveries(database)
        purge_expired_durable_document_jobs(database)
        reconcile_asset_journal(database)
    except Exception as exc:
        log_error(exc, "retention_cleanup", level="WARN")
    finally:
        if conn is not None:
            if retention_lock_acquired:
                try:
                    conn.rollback()
                    conn.execute(
                        "SELECT pg_advisory_unlock(hashtext('biddingflow-retention-cleanup'))"
                    ).fetchone()
                    conn.rollback()
                except PostgresError as exc:
                    log_error(exc, "retention_cleanup_unlock", level="WARN")
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


def _run_retention_cleanup(database, image_dir):
    while True:
        time.sleep(1800)
        _purge_retained_rows(database)
        _purge_derived_images(image_dir)


@asynccontextmanager
async def application_lifespan(
    application,
    *,
    database,
    schema_version,
    minimum_schema_version=None,
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
    application.state.readiness_reason = "STARTUP_INCOMPLETE"
    application.state.event_loop_lag_ms = 0.0
    monitor_task = None
    audit_monitor_task = None
    artifact_monitor_task = None
    multiprocess_metrics_task = None
    broker_task = None
    email_delivery_task = None
    document_queue_task = None
    validation_artifact_janitor_task = None
    try:
        validate_startup(database)
        validate_artifact_store_configuration()
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
        verify_database_readiness(
            database,
            (
                schema_version
                if minimum_schema_version is None
                else minimum_schema_version
            ),
            schema_version,
        )
        reconcile_asset_journal(database)
        if is_production:
            verify_database_runtime_role(
                database,
                expected_role=str(
                    os.environ.get("DATABASE_RUNTIME_ROLE", "")
                ).strip(),
            )
        await verify_audit_chain_before_ready(database)
        if _procurement_source_initialization_enabled():
            from backend.procurement_import.source import ProcurementSourceError
            from backend.procurement_lookup.domain import ProcurementLookupError

            try:
                await run_blocking_io(
                    _initialize_procurement_source,
                    timeout_seconds=10.0,
                )
            except (
                OSError,
                ProcurementLookupError,
                ProcurementSourceError,
                RuntimeError,
                ValueError,
            ) as exc:
                # Procurement is an optional upstream integration. Keep the
                # application available and let the normal bounded request
                # policy retry if startup prewarm could not reach it.
                log_error(exc, "initialize_procurement_source", level="WARN")
    except Exception as exc:
        log_error(exc, "startup_database_init")
        raise

    application.state.startup_complete = True
    application.state.ready = True
    application.state.readiness_reason = None
    monitor_task = asyncio.create_task(_monitor_event_loop(application))
    audit_monitor_task = asyncio.create_task(
        monitor_audit_chain(database, application=application)
    )
    artifact_monitor_task = asyncio.create_task(monitor_operational_artifacts())
    multiprocess_metrics_task = asyncio.create_task(
        monitor_multiprocess_metrics(application)
    )
    validation_artifact_janitor_task = asyncio.create_task(
        run_validation_artifact_janitor()
    )
    email_delivery_task = asyncio.create_task(run_email_delivery_worker(database))
    if not external_document_worker_enabled():
        document_queue_task = asyncio.create_task(
            run_durable_document_queue_worker(database)
        )
    try:
        from backend.sync.websocket import _pending_broker_start_id, run_websocket_event_broker
        broker_cursor = await run_blocking_io(_pending_broker_start_id, timeout_seconds=5.0)
        broker_task = asyncio.create_task(run_websocket_event_broker(start_after_id=broker_cursor))
    except Exception:
        for task in (
            monitor_task,
            audit_monitor_task,
            artifact_monitor_task,
            multiprocess_metrics_task,
            email_delivery_task,
            document_queue_task,
            validation_artifact_janitor_task,
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
        target=_run_retention_cleanup,
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
            multiprocess_metrics_task,
            broker_task,
            email_delivery_task,
            document_queue_task,
            validation_artifact_janitor_task,
        ):
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        application.state.ready = False
        application.state.startup_complete = False
        if _procurement_source_initialization_enabled():
            from backend.integrations.muasamcong_browser.registry import (
                close_muasamcong_source,
            )

            close_muasamcong_source()
        database.close()
