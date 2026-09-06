import asyncio
import sqlite3
from types import SimpleNamespace

from backend.notifications import routes


def test_delete_notification_is_recipient_scoped(monkeypatch):
    connection = sqlite3.connect(":memory:")
    connection.execute("CREATE TABLE user_notifications (id TEXT PRIMARY KEY, user_id TEXT)")
    connection.executemany("INSERT INTO user_notifications VALUES (?, ?)", [("mine", "a"), ("other", "b")])
    connection.commit()
    adapter = SimpleNamespace(cursor=connection.cursor, commit=connection.commit,
                              rollback=connection.rollback, close=lambda: None)
    monkeypatch.setattr(routes, "database", SimpleNamespace(get_connection=lambda: adapter))
    monkeypatch.setattr(routes, "verify_session", lambda _: (True, SimpleNamespace(user_id="a")))
    try:
        def delete(record_id):
            return asyncio.run(routes.delete_notification_api(SimpleNamespace(path_params={"notification_id": record_id})))
        assert delete("other").status_code == 404
        assert delete("mine").status_code == 200
        assert delete("mine").status_code == 404
        assert connection.execute("SELECT * FROM user_notifications").fetchall() == [("other", "b")]
        monkeypatch.setattr(routes, "verify_session", lambda _: (False, "Invalid session"))
        assert delete("other").status_code == 403
    finally:
        connection.close()
