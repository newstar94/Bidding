import sqlite3
import uuid

import pytest
from starlette.testclient import TestClient

from backend.app import app
from backend.auth.auth_helper import hash_password, verify_password
from backend.auth.password_policy import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    validate_new_password,
)
from backend.db.db_utils import _build_create_table_sql
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.shared.helpers import database


def _account_values(user_id, username, email):
    return (
        user_id,
        username,
        username.casefold(),
        hash_password("schema invariant password"),
        email,
        email.casefold(),
    )


def test_database_owns_normalized_and_external_identity_uniqueness():
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute(_build_create_table_sql("goi_dich_vu", SCHEMA_DINH_NGHIA["goi_dich_vu"]))
    connection.execute(_build_create_table_sql("tai_khoan", SCHEMA_DINH_NGHIA["tai_khoan"]))
    connection.execute(_build_create_table_sql("dinh_danh_ngoai", SCHEMA_DINH_NGHIA["dinh_danh_ngoai"]))
    insert_account = """
        INSERT INTO tai_khoan (
            id, ten_dang_nhap, username_norm, mat_khau, email, email_norm
        ) VALUES (?, ?, ?, ?, ?, ?)
    """
    connection.execute(insert_account, _account_values("u1", "Alice", "Alice@example.com"))

    with pytest.raises(sqlite3.IntegrityError, match="username_norm"):
        connection.execute(insert_account, _account_values("u2", "ALICE", "other@example.com"))
    with pytest.raises(sqlite3.IntegrityError, match="email_norm"):
        connection.execute(insert_account, _account_values("u3", "other", "ALICE@example.com"))

    connection.execute(
        "INSERT INTO dinh_danh_ngoai (issuer, subject, user_id, email_norm) VALUES (?, ?, ?, ?)",
        ("https://accounts.google.com", "google-subject", "u1", "alice@example.com"),
    )
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO dinh_danh_ngoai (issuer, subject, user_id, email_norm) VALUES (?, ?, ?, ?)",
            ("https://accounts.google.com", "google-subject", "u1", "alice@example.com"),
        )
    connection.close()


def test_password_policy_preserves_spaces_and_bounds_hash_work():
    password = "  exact passphrase 2026  "
    valid, _ = validate_new_password(password)
    assert valid
    password_hash = hash_password(password)
    assert verify_password(password_hash, password)
    assert not verify_password(password_hash, password.strip())
    assert validate_new_password("x" * (MIN_PASSWORD_LENGTH - 1))[0] is False
    assert validate_new_password("x" * MIN_PASSWORD_LENGTH)[0] is True
    assert validate_new_password("x" * (MAX_PASSWORD_LENGTH + 1))[0] is False


def test_registration_conflicts_are_409_and_login_keeps_password_spaces():
    suffix = uuid.uuid4().hex[:10]
    username = f"identity_{suffix}"
    email = f"identity-{suffix}@example.com"
    password = "  exact passphrase 2026  "

    with TestClient(app, base_url="https://testserver") as client:
        registered = client.post(
            "/api/auth/register",
            json={"username": username, "password": password, "name": "Identity Test", "email": email},
        )
        assert registered.status_code == 200

        duplicate = client.post(
            "/api/auth/register",
            json={
                "username": f"other_{suffix}",
                "password": password,
                "name": "Duplicate Identity",
                "email": email.upper(),
            },
        )
        assert duplicate.status_code == 409
        assert duplicate.json()["code"] == "EMAIL_ALREADY_EXISTS"

        connection = database.get_connection()
        connection.execute("UPDATE tai_khoan SET da_xac_minh = 1 WHERE username_norm = ?", (username,))
        connection.commit()
        connection.close()

        wrong = client.post(
            "/api/auth/login",
            json={"username": username.upper(), "password": password.strip(), "remember": False},
        )
        assert wrong.status_code == 400

        correct = client.post(
            "/api/auth/login",
            json={"username": username.upper(), "password": password, "remember": False},
        )
        assert correct.status_code == 200
        session = client.post("/api/auth/check-session", json={"remember": False})
        assert session.status_code == 200
        user = session.json()["user"]
        assert user["platform_role"] == "user"
        assert user["membership_role"] is None
        assert user["effective_roles"] == ["employee"]
        assert user["organizations"] == []
        assert user["active_org_id"] is None
        assert user["package_id"] is None
        assert user["subscription"] is None
