import time

from backend.auth import otp_routes
from backend.db.db_helper import SQLiteDatabase


def _otp_database(path, *, code="123456", expires_at=None, verified=0):
    database = SQLiteDatabase(path)
    connection = database.get_connection()
    connection.execute(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            username_norm TEXT NOT NULL UNIQUE,
            ho_ten TEXT NOT NULL,
            email TEXT NOT NULL,
            da_xac_minh INTEGER NOT NULL DEFAULT 0,
            ma_xac_minh TEXT,
            han_xac_minh INTEGER
        )
        """
    )
    connection.execute(
        """
        INSERT INTO tai_khoan (
            id, username_norm, ho_ten, email, da_xac_minh,
            ma_xac_minh, han_xac_minh
        ) VALUES ('user-1', 'user-one', 'User One', 'user@example.com', ?, ?, ?)
        """,
        (verified, code, expires_at or int(time.time()) + 600),
    )
    connection.commit()
    connection.close()
    return database


def test_email_otp_is_consumed_atomically_and_cannot_be_reused(monkeypatch, tmp_path):
    database = _otp_database(tmp_path / "otp.db")
    monkeypatch.setattr(otp_routes, "database", database)

    assert otp_routes._verify_email_otp_sync("user-one", "123456") == "verified"
    assert otp_routes._verify_email_otp_sync("user-one", "123456") == "invalid"

    connection = database.get_connection()
    row = connection.execute(
        "SELECT da_xac_minh, ma_xac_minh, han_xac_minh FROM tai_khoan WHERE id = 'user-1'"
    ).fetchone()
    connection.close()
    assert tuple(row) == (1, None, None)


def test_expired_email_otp_is_rejected_without_mutation(monkeypatch, tmp_path):
    database = _otp_database(
        tmp_path / "expired.db",
        expires_at=int(time.time()) - 1,
    )
    monkeypatch.setattr(otp_routes, "database", database)

    assert otp_routes._verify_email_otp_sync("user-one", "123456") == "expired"

    connection = database.get_connection()
    row = connection.execute(
        "SELECT da_xac_minh, ma_xac_minh FROM tai_khoan WHERE id = 'user-1'"
    ).fetchone()
    connection.close()
    assert tuple(row) == (0, "123456")


def test_resend_rotates_otp_in_one_write_transaction(monkeypatch, tmp_path):
    database = _otp_database(tmp_path / "resend.db")
    monkeypatch.setattr(otp_routes, "database", database)
    monkeypatch.setattr(otp_routes, "generate_otp", lambda: "654321")

    result = otp_routes._resend_email_otp_sync("user-one")

    assert result["status"] == "sent"
    assert result["code"] == "654321"
    connection = database.get_connection()
    row = connection.execute(
        "SELECT ma_xac_minh, han_xac_minh FROM tai_khoan WHERE id = 'user-1'"
    ).fetchone()
    connection.close()
    assert row[0] == "654321"
    assert int(row[1]) > int(time.time())


def test_resend_does_not_change_verified_account(monkeypatch, tmp_path):
    database = _otp_database(tmp_path / "verified.db", verified=1)
    monkeypatch.setattr(otp_routes, "database", database)

    assert otp_routes._resend_email_otp_sync("user-one") == {"status": "verified"}
