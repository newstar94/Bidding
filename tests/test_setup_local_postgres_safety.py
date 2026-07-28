import pytest

from scripts.setup_local_postgres import (
    assert_safe_reset_environment,
    effective_reset_environment,
    initialize_application_schemas,
)


def test_reset_accepts_only_repository_managed_local_development_databases():
    assert_safe_reset_environment(
        {
            "APP_ENV": "development",
            "DATABASE_URL": (
                "postgresql://user:secret@127.0.0.1:55432/"
                "biddingflow_dev?sslmode=disable"
            ),
            "TEST_DATABASE_URL": (
                "postgresql://user:secret@localhost:55432/"
                "biddingflow_test?sslmode=disable"
            ),
        }
    )


@pytest.mark.parametrize("environment", ["", "production", "prod", "staging"])
def test_reset_refuses_non_development_environments(environment):
    with pytest.raises(SystemExit, match="development or test environment"):
        assert_safe_reset_environment({"APP_ENV": environment})


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://user:secret@db.example.com:5432/biddingflow_dev",
        "postgresql://user:secret@127.0.0.1:55432/biddingflow_production",
    ],
)
def test_reset_refuses_remote_or_non_disposable_database_urls(database_url):
    with pytest.raises(SystemExit, match="repository-managed local"):
        assert_safe_reset_environment(
            {"APP_ENV": "development", "DATABASE_URL": database_url}
        )


@pytest.mark.parametrize(
    "process_environment",
    [
        {"APP_ENV": "production"},
        {
            "DATABASE_ADMIN_URL": (
                "postgresql://admin:secret@database.example.com:5432/"
                "biddingflow_dev"
            )
        },
    ],
)
def test_reset_safety_uses_process_environment_overrides(process_environment):
    effective_values = effective_reset_environment(
        {
            "APP_ENV": "development",
            "DATABASE_ADMIN_URL": (
                "postgresql://admin:secret@127.0.0.1:55432/biddingflow_dev"
            ),
        },
        process_environment=process_environment,
    )

    with pytest.raises(SystemExit, match="Database reset refused"):
        assert_safe_reset_environment(effective_values)


def test_reset_initializes_every_recreated_local_database(monkeypatch):
    calls = []
    database_urls = (
        "postgresql://migrator:secret@127.0.0.1:55432/biddingflow_dev",
        "postgresql://postgres:secret@127.0.0.1:55432/biddingflow_test",
        "postgresql://postgres:secret@127.0.0.1:55432/biddingflow_api_test",
    )

    def record_run(*args, env=None):
        calls.append((args, env))

    monkeypatch.setattr("scripts.setup_local_postgres._run", record_run)

    initialize_application_schemas(
        database_urls,
        base_environment={"APP_ENV": "development"},
    )

    assert [call[1]["MIGRATOR_DATABASE_URL"] for call in calls] == list(
        database_urls
    )
    assert [call[1]["DATABASE_URL"] for call in calls] == list(database_urls)
