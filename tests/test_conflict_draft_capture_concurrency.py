"""Concurrent captures preserve the existing draft cap and replay identity."""

from concurrent.futures import ThreadPoolExecutor
import os
from threading import Event
import time
from uuid import uuid4

from cryptography.fernet import Fernet
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict
import pytest

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.sync.conflict_resolution.storage import (
    ConflictDraftRepository,
    MAX_ACTIVE_DRAFTS,
)


def _isolated_test_database_url():
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL concurrency test")
    try:
        database_name = conninfo_to_dict(database_url).get("dbname", "")
    except psycopg.ProgrammingError:
        raise RuntimeError(
            "TEST_DATABASE_URL must name an isolated PostgreSQL test database"
        ) from None
    if "test" not in database_name.casefold():
        raise RuntimeError(
            "TEST_DATABASE_URL must name an isolated PostgreSQL test database"
        )
    return database_url


@pytest.mark.parametrize("database_url", [
    "postgresql://test_user:test_password@test-host/biddingflow",
    "host=127.0.0.1 user=test_user dbname=biddingflow application_name=test",
    "postgresql://127.0.0.1/biddingflow_test?dbname=biddingflow",
    "postgresql://127.0.0.1",
    "not-a-postgresql-connection-string",
])
def test_capture_rejects_non_test_database_before_connect(monkeypatch, database_url):
    monkeypatch.setenv("TEST_DATABASE_URL", database_url)

    def unexpected_connect(*args, **kwargs):
        pytest.fail("unsafe test database reached psycopg.connect")

    monkeypatch.setattr(psycopg, "connect", unexpected_connect)
    with pytest.raises(RuntimeError, match="must name an isolated PostgreSQL test database"):
        test_concurrent_capture_preserves_cap_and_idempotency(False)


@pytest.mark.parametrize("same_mutation", [False, True], ids=["draft-cap", "replay"])
def test_concurrent_capture_preserves_cap_and_idempotency(same_mutation):
    database_url = _isolated_test_database_url()
    schema = "bf_draft_capture_" + uuid4().hex
    environment = {"CONFLICT_DRAFT_ENCRYPTION_KEY": Fernet.generate_key().decode()}
    first_before_insert = Event()
    release_first = Event()
    second_connected = Event()
    worker_pids = {}

    def capture(repository, mutation_id):
        return repository.create(
            organization_id="org", actor_user_id="actor", workspace_fingerprint="workspace",
            batch_id="batch", mutation_id=mutation_id, entity_type="goithau",
            table_name="goi_thau", record_id="record", expected_row_version=1,
            server_row_version=2, payload={"base": "A", "local": "B", "server": "C"},
        )

    with psycopg.connect(
        database_url, connect_timeout=5, autocommit=True,
        row_factory=compat_row_factory,
    ) as observer:
        observer.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        try:
            observer.execute(sql.SQL(
                "CREATE TABLE {}.conflict_resolution_drafts "
                "(LIKE public.conflict_resolution_drafts INCLUDING ALL)"
            ).format(sql.Identifier(schema)))
            observer.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
            seed = ConflictDraftRepository(PostgresCursor(observer.cursor()), environ=environment, now=100)
            for index in range(MAX_ACTIVE_DRAFTS - 1):
                capture(seed, f"seed-{index}")

            def worker(name, mutation_id):
                with psycopg.connect(
                    database_url, connect_timeout=5, row_factory=compat_row_factory,
                ) as connection:
                    connection.execute(sql.SQL("SET LOCAL search_path TO {}").format(
                        sql.Identifier(schema),
                    ))
                    worker_pids[name] = connection.info.backend_pid
                    if name == "second":
                        second_connected.set()
                    cursor = PostgresCursor(connection.cursor())

                    class CaptureCursor:
                        def __getattr__(self, name):
                            return getattr(cursor, name)

                        def execute(self, statement, parameters=()):
                            if (
                                name == "first"
                                and isinstance(statement, str)
                                and "INSERT INTO conflict_resolution_drafts" in statement
                            ):
                                first_before_insert.set()
                                assert release_first.wait(15), "capture was never released"
                            return cursor.execute(statement, parameters)

                    result = capture(
                        ConflictDraftRepository(CaptureCursor(), environ=environment, now=100),
                        mutation_id,
                    )
                    connection.commit()
                    return result

            with ThreadPoolExecutor(max_workers=2) as executor:
                first = executor.submit(worker, "first", "concurrent-first")
                try:
                    assert first_before_insert.wait(10), "first capture did not reach insertion"
                    second = executor.submit(
                        worker, "second",
                        "concurrent-first" if same_mutation else "concurrent-second",
                    )
                    assert second_connected.wait(10), "second capture did not connect"
                    # Observe actual PostgreSQL lock state instead of relying on
                    # a delay: the old implementation completes the second
                    # capture; serialization makes it wait for the first.
                    deadline = time.monotonic() + 10
                    while not second.done():
                        blockers = observer.execute(
                            "SELECT pg_blocking_pids(%s)", (worker_pids["second"],),
                        ).fetchone()[0]
                        if worker_pids["first"] in blockers:
                            break
                        assert time.monotonic() < deadline, "capture neither completed nor serialized"
                        time.sleep(0.01)
                    release_first.set()
                    first_result = first.result(timeout=10)
                    second_result = second.result(timeout=10)
                finally:
                    release_first.set()

            count = observer.execute(
                "SELECT COUNT(*) FROM conflict_resolution_drafts WHERE status = 'ACTIVE'",
            ).fetchone()[0]
            assert count == MAX_ACTIVE_DRAFTS
            if same_mutation:
                assert first_result["id"] == second_result["id"]
            else:
                assert first_result["id"] != second_result["id"]
        finally:
            release_first.set()
            observer.execute("SET search_path TO public")
            observer.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
