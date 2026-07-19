"""Run the durable document queue outside the ASGI web process."""

from __future__ import annotations

import os
from pathlib import Path
import queue
import signal
import sys
import threading
import time
from urllib.parse import parse_qs, unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db.db_helper import PostgresDatabase
from backend.documents.document_sandbox import (
    validate_document_sandbox_configuration,
)
from backend.documents.document_worker import (
    document_worker_execution_mode,
    process_next_durable_document_job,
    validate_external_document_worker_shared_root,
)


def _positive_poll_seconds() -> float:
    try:
        value = float(os.environ.get("DOCUMENT_JOB_POLL_SECONDS", "1"))
    except (TypeError, ValueError):
        value = 1.0
    return min(30.0, max(0.1, value))


def _worker_concurrency() -> int:
    try:
        value = int(os.environ.get("DOCUMENT_WORKER_MAX_CONCURRENCY", "2"))
    except (TypeError, ValueError):
        value = 2
    return min(8, max(1, value))


def _validate_database_boundary(database: PostgresDatabase) -> str:
    expected_role = os.environ.get(
        "DATABASE_DOCUMENT_WORKER_ROLE", "biddingflow_document_worker"
    ).strip()
    if not expected_role:
        raise RuntimeError("DATABASE_DOCUMENT_WORKER_ROLE is required.")
    connection = database.get_connection()
    try:
        identity = connection.execute(
            """SELECT current_user, current_database(), current_schema(),
                      current_schemas(false),
                      role.rolsuper, role.rolcreatedb, role.rolcreaterole,
                      role.rolreplication, role.rolbypassrls,
                      has_database_privilege(current_user, current_database(), 'CREATE'),
                      has_database_privilege(current_user, current_database(), 'TEMP'),
                      has_schema_privilege(current_user, 'public', 'USAGE'),
                      has_schema_privilege(current_user, 'public', 'CREATE')
               FROM pg_roles AS role
               WHERE role.rolname = current_user"""
        ).fetchone()
        queue_privileges = connection.execute(
            """SELECT
                   has_table_privilege(current_user, 'public.document_jobs', 'SELECT'),
                   has_table_privilege(current_user, 'public.document_jobs', 'UPDATE'),
                   has_table_privilege(current_user, 'public.document_jobs', 'INSERT'),
                   has_table_privilege(current_user, 'public.document_jobs', 'DELETE'),
                   has_table_privilege(current_user, 'public.document_jobs', 'TRUNCATE'),
                   has_table_privilege(current_user, 'public.document_jobs', 'REFERENCES'),
                   has_table_privilege(current_user, 'public.document_jobs', 'TRIGGER')"""
        ).fetchone()
        memberships = connection.execute(
            """SELECT parent.rolname
               FROM pg_auth_members AS memberships
               JOIN pg_roles AS parent ON parent.oid = memberships.roleid
               JOIN pg_roles AS member ON member.oid = memberships.member
               WHERE member.rolname = current_user
               ORDER BY parent.rolname"""
        ).fetchall()
        owned_objects = connection.execute(
            """SELECT object_type, object_name
               FROM (
                   SELECT 'relation' AS object_type,
                          namespace.nspname || '.' || object.relname AS object_name
                   FROM pg_class AS object
                   JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
                   WHERE object.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                     AND namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                   UNION ALL
                   SELECT 'function', namespace.nspname || '.' || function.proname
                   FROM pg_proc AS function
                   JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
                   WHERE function.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                     AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                   UNION ALL
                   SELECT 'schema', namespace.nspname
                   FROM pg_namespace AS namespace
                   WHERE namespace.nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                     AND namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
               ) AS owned
               ORDER BY object_type, object_name"""
        ).fetchall()
        disallowed_relations = connection.execute(
            """SELECT table_schema, table_name
               FROM information_schema.tables
               WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                 AND NOT (table_schema = 'public' AND table_name = 'document_jobs')
                 AND (
                     has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'SELECT')
                     OR has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'INSERT')
                     OR has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'UPDATE')
                     OR has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'DELETE')
                     OR has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'TRUNCATE')
                     OR has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'REFERENCES')
                     OR has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'TRIGGER')
                 )
               ORDER BY table_schema, table_name"""
        ).fetchall()
        disallowed_sequences = connection.execute(
            """SELECT sequence_schema, sequence_name
               FROM information_schema.sequences
               WHERE sequence_schema NOT IN ('pg_catalog', 'information_schema')
                 AND (
                     has_sequence_privilege(current_user, format('%I.%I', sequence_schema, sequence_name), 'USAGE')
                     OR has_sequence_privilege(current_user, format('%I.%I', sequence_schema, sequence_name), 'SELECT')
                     OR has_sequence_privilege(current_user, format('%I.%I', sequence_schema, sequence_name), 'UPDATE')
                 )
               ORDER BY sequence_schema, sequence_name"""
        ).fetchall()
        disallowed_functions = connection.execute(
            """SELECT namespace.nspname, function.oid::regprocedure::text
               FROM pg_proc AS function
               JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
               WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                 AND has_function_privilege(current_user, function.oid, 'EXECUTE')
               ORDER BY namespace.nspname, function.oid::regprocedure::text"""
        ).fetchall()
    finally:
        connection.close()
    if identity is None or str(identity[0]) != expected_role:
        raise RuntimeError(
            "Document worker is not connected with DATABASE_DOCUMENT_WORKER_ROLE."
        )
    if str(identity[2] or "") != "public" or list(identity[3] or []) != ["public"]:
        raise RuntimeError("Document-worker DB role must use only search_path=public.")
    if any(bool(identity[index]) for index in range(4, 9)):
        raise RuntimeError("Document-worker DB role has an elevated PostgreSQL attribute.")
    if bool(identity[9]) or bool(identity[10]) or bool(identity[12]):
        raise RuntimeError("Document-worker DB role must not have CREATE or TEMP privileges.")
    if not bool(identity[11]):
        raise RuntimeError("Document-worker DB role requires USAGE on schema public.")
    if memberships:
        raise RuntimeError("Document-worker DB role must not inherit PostgreSQL roles.")
    if owned_objects:
        raise RuntimeError("Document-worker DB role must not own database objects.")
    if disallowed_relations or disallowed_sequences or disallowed_functions:
        raise RuntimeError(
            "Document-worker DB role has privileges outside document_jobs."
        )
    if (
        queue_privileges is None
        or not bool(queue_privileges[0])
        or not bool(queue_privileges[1])
        or any(bool(queue_privileges[index]) for index in range(2, 7))
    ):
        raise RuntimeError(
            "Document-worker DB role must have only SELECT/UPDATE on document_jobs."
        )
    return expected_role


def _validate_document_worker_database_url(
    database_url: str,
    environ=None,
) -> None:
    environment = os.environ if environ is None else environ
    expected_role = environment.get(
        "DATABASE_DOCUMENT_WORKER_ROLE", "biddingflow_document_worker"
    ).strip()
    try:
        parsed = urlsplit(database_url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        username = unquote(parsed.username or "")
    except ValueError as exc:
        raise RuntimeError("DOCUMENT_WORKER_DATABASE_URL is invalid.") from exc
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise RuntimeError("DOCUMENT_WORKER_DATABASE_URL must use PostgreSQL.")
    if username != expected_role:
        raise RuntimeError(
            "DOCUMENT_WORKER_DATABASE_URL must use DATABASE_DOCUMENT_WORKER_ROLE."
        )
    if not parsed.password or not parsed.hostname or not parsed.path.strip("/"):
        raise RuntimeError(
            "DOCUMENT_WORKER_DATABASE_URL must include a credential, host and database."
        )
    if query.get("sslmode") != ["verify-full"]:
        raise RuntimeError(
            "Production DOCUMENT_WORKER_DATABASE_URL requires sslmode=verify-full."
        )


def _validate_worker_secret_boundary(environ=None) -> None:
    environment = os.environ if environ is None else environ
    forbidden_secrets = [
        name
        for name in (
            "DATABASE_URL",
            "RUNTIME_DATABASE_URL",
            "MIGRATOR_DATABASE_URL",
            "DATABASE_ADMIN_URL",
            "BACKUP_DATABASE_URL",
            "DATABASE_RUNTIME_PASSWORD",
            "DATABASE_MIGRATOR_PASSWORD",
            "DATABASE_ADMIN_PASSWORD",
            "DATABASE_BACKUP_PASSWORD",
            "DATABASE_DOCUMENT_WORKER_PASSWORD",
            "SMTP_PASSWORD",
            "GOOGLE_CLIENT_SECRET",
            "AUDIT_CHECKPOINT_HMAC_KEY",
            "EMAIL_OUTBOX_ENCRYPTION_KEY",
            "BIDDING_RESTORE_DRILL_PRIVATE_KEY",
        )
        if str(environment.get(name, "")).strip()
    ]
    if forbidden_secrets:
        raise RuntimeError(
            "Document-worker service received forbidden application secrets: "
            + ", ".join(forbidden_secrets)
        )


def _validate_service_boundary() -> None:
    if document_worker_execution_mode() != "external":
        raise RuntimeError(
            "The standalone document worker requires "
            "DOCUMENT_WORKER_EXECUTION_MODE=external."
        )
    if os.environ.get("APP_ENV", "development").strip().casefold() not in {
        "prod",
        "production",
    }:
        raise RuntimeError("The standalone document worker requires APP_ENV=production.")
    if os.name != "posix" or not hasattr(os, "geteuid"):
        raise RuntimeError("The production document worker requires a POSIX host.")
    if os.geteuid() == 0:
        raise RuntimeError("The document-worker service must not run as root.")
    import grp
    import pwd

    expected_user = os.environ.get(
        "DOCUMENT_WORKER_SERVICE_USER", "biddingflow-document-worker"
    ).strip()
    expected_group = os.environ.get(
        "DOCUMENT_WORKER_SERVICE_GROUP", "biddingflow-documents"
    ).strip()
    actual_user = pwd.getpwuid(os.geteuid()).pw_name
    actual_group = grp.getgrgid(os.getegid()).gr_name
    if not expected_user or expected_user in {"root", "biddingflow"}:
        raise RuntimeError("DOCUMENT_WORKER_SERVICE_USER must be a dedicated account.")
    if actual_user != expected_user or actual_group != expected_group:
        raise RuntimeError(
            "Document worker is not running with its dedicated service identity."
        )
    shared_gid = int(os.environ.get("DOCUMENT_WORKER_SHARED_GID", "0") or 0)
    if shared_gid <= 0 or shared_gid != os.getegid():
        raise RuntimeError(
            "The worker primary GID must equal DOCUMENT_WORKER_SHARED_GID."
        )
    missing_attestations = [
        name
        for name in (
            "DOCUMENT_WORKER_SERVICE_ACCOUNT_CONFIRMED",
            "DOCUMENT_WORKER_SHARED_STORAGE_CONFIRMED",
        )
        if os.environ.get(name, "").strip().casefold() != "true"
    ]
    if missing_attestations:
        raise RuntimeError(
            "Missing document-worker service attestations: "
            + ", ".join(missing_attestations)
        )
    if (ROOT / ".env").exists():
        raise RuntimeError(
            "The document-worker release directory must not contain a .env file."
        )
    _validate_worker_secret_boundary()
    validate_external_document_worker_shared_root()
    validate_document_sandbox_configuration()


def _run_worker_loop(
    database: PostgresDatabase,
    stop_event: threading.Event,
    failures: queue.Queue[BaseException],
) -> None:
    poll_seconds = _positive_poll_seconds()
    try:
        while not stop_event.is_set():
            processed = process_next_durable_document_job(database)
            if not processed:
                stop_event.wait(poll_seconds)
            else:
                time.sleep(0)
    except BaseException as exc:
        failures.put(exc)
        stop_event.set()


def main() -> int:
    _validate_service_boundary()
    database_url = os.environ.get("DOCUMENT_WORKER_DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DOCUMENT_WORKER_DATABASE_URL is required.")
    _validate_document_worker_database_url(database_url)
    database = PostgresDatabase(database_url)
    database.open(wait=True)
    try:
        role = _validate_database_boundary(database)
        stop_event = threading.Event()

        def request_stop(_signum, _frame) -> None:
            stop_event.set()

        signal.signal(signal.SIGTERM, request_stop)
        signal.signal(signal.SIGINT, request_stop)
        failures: queue.Queue[BaseException] = queue.Queue()
        concurrency = _worker_concurrency()
        threads = [
            threading.Thread(
                target=_run_worker_loop,
                args=(database, stop_event, failures),
                name=f"document-queue-{index + 1}",
            )
            for index in range(concurrency)
        ]
        for thread in threads:
            thread.start()
        print(
            f"Document worker ready (database role: {role}, concurrency: {concurrency}).",
            flush=True,
        )
        while not stop_event.wait(0.5):
            pass
        for thread in threads:
            thread.join()
        if not failures.empty():
            failure = failures.get_nowait()
            raise RuntimeError("Document worker queue loop failed.") from failure
        return 0
    finally:
        database.close()


if __name__ == "__main__":
    raise SystemExit(main())
