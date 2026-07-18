from concurrent.futures import ThreadPoolExecutor

from backend.db.db_helper import SQLiteDatabase


def test_wal_serializes_concurrent_writers_without_lost_updates(tmp_path):
    database = SQLiteDatabase(tmp_path / "wal-contention.db")
    connection = database.get_connection()
    connection.execute("CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)")
    connection.execute("INSERT INTO counter VALUES (1, 0)")
    connection.commit()
    assert connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 15_000
    connection.close()

    writers = 12
    updates_per_writer = 40

    def update_counter():
        writer = database.get_connection()
        try:
            for _ in range(updates_per_writer):
                writer.execute("BEGIN IMMEDIATE")
                writer.execute("UPDATE counter SET value = value + 1 WHERE id = 1")
                writer.commit()
        finally:
            writer.close()

    with ThreadPoolExecutor(max_workers=writers) as executor:
        list(executor.map(lambda _index: update_counter(), range(writers)))

    check = database.get_connection()
    assert check.execute("SELECT value FROM counter WHERE id = 1").fetchone()[0] == writers * updates_per_writer
    assert check.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    check.close()
