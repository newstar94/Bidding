"""database.connection() / database.transaction() semantics on real PostgreSQL."""

import os

import pytest

from backend.db.db_helper import PostgresDatabase


@pytest.fixture
def database():
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL required")
    db = PostgresDatabase(url)
    with db.transaction() as connection:
        connection.execute("CREATE TABLE IF NOT EXISTS bf_ctx_probe (id TEXT PRIMARY KEY)")
        connection.execute("DELETE FROM bf_ctx_probe")
    try:
        yield db
    finally:
        with db.transaction() as connection:
            connection.execute("DROP TABLE IF EXISTS bf_ctx_probe")
        db.close()


def _count(db):
    with db.connection() as connection:
        return connection.execute("SELECT count(*) FROM bf_ctx_probe").fetchone()[0]


def test_transaction_commits_on_success(database):
    with database.transaction() as connection:
        connection.execute("INSERT INTO bf_ctx_probe VALUES ('a')")
    assert _count(database) == 1


def test_transaction_rolls_back_and_reraises_the_original_error(database):
    class Boom(RuntimeError):
        pass

    with pytest.raises(Boom):
        with database.transaction() as connection:
            connection.execute("INSERT INTO bf_ctx_probe VALUES ('b')")
            raise Boom("body failed")
    assert _count(database) == 0


def test_savepoints_still_work_inside_a_transaction(database):
    with database.transaction() as connection:
        connection.execute("INSERT INTO bf_ctx_probe VALUES ('c')")
        connection.execute("SAVEPOINT inner_step")
        connection.execute("INSERT INTO bf_ctx_probe VALUES ('d')")
        connection.execute("ROLLBACK TO SAVEPOINT inner_step")
    assert _count(database) == 1


def test_connection_never_commits_and_always_returns_to_pool(database):
    with database.connection() as connection:
        connection.execute("INSERT INTO bf_ctx_probe VALUES ('e')")
        leased = connection
    assert leased.closed is True
    assert _count(database) == 0
