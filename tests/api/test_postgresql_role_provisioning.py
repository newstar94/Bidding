import pytest

from scripts.provision_postgresql_roles import (
    _validate_admin_url,
    _validate_roles,
)
from scripts.rehearse_postgresql_fresh_install import _database_url


def test_postgresql_role_provisioning_requires_verified_tls():
    with pytest.raises(ValueError, match="verify-full"):
        _validate_admin_url(
            "postgresql://admin@db.example.test/bidding?sslmode=require"
        )
    parsed, database_name = _validate_admin_url(
        "postgresql://admin@db.example.test/bidding?sslmode=verify-full"
    )
    assert parsed.hostname == "db.example.test"
    assert database_name == "bidding"


def test_postgresql_role_names_are_distinct_and_identifier_safe():
    assert _validate_roles(
        {
            "migration": "bidding_migrator",
            "application": "bidding_app",
            "monitor": "bidding_backup_monitor",
        }
    )["application"] == "bidding_app"
    with pytest.raises(ValueError, match="distinct"):
        _validate_roles(
            {
                "migration": "bidding_same",
                "application": "bidding_same",
                "monitor": "bidding_monitor",
            }
        )
    with pytest.raises(ValueError, match="Invalid"):
        _validate_roles(
            {
                "migration": "bidding-migrator",
                "application": "bidding_app",
                "monitor": "bidding_monitor",
            }
        )


def test_fresh_install_database_url_replaces_credentials_without_leaking_old_secret():
    result = _database_url(
        "postgresql://operator:old-secret@db.example.test:5432/postgres?sslmode=verify-full",
        "bidding",
        username="bidding_app",
        password="new secret",
    )
    assert result == (
        "postgresql://bidding_app:new%20secret@db.example.test:5432/"
        "bidding?sslmode=verify-full"
    )
    assert "old-secret" not in result
