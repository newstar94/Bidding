import subprocess

import pytest

import scripts.setup_local_postgres as local_postgres

from scripts.setup_local_postgres import (
    assert_safe_reset_environment,
    bootstrap_bundled_ai_knowledge,
    effective_reset_environment,
    ensure_local_postgres_running,
    initialize_application_schemas,
    main,
    should_auto_start_local_postgres,
)


def test_local_reset_bootstraps_every_bundled_approved_ai_document(monkeypatch):
    calls = []
    monkeypatch.setattr(
        local_postgres,
        "_run",
        lambda *args, **kwargs: calls.append(args),
    )

    bootstrap_bundled_ai_knowledge()

    assert len(calls) == len(local_postgres.BUNDLED_AI_KNOWLEDGE)
    for call, (document_path, metadata_path) in zip(
        calls,
        local_postgres.BUNDLED_AI_KNOWLEDGE,
        strict=True,
    ):
        assert call == (
            local_postgres.sys.executable,
            str(local_postgres.ROOT / "scripts" / "ingest_ai_knowledge.py"),
            "--file",
            str(document_path),
            "--metadata",
            str(metadata_path),
            "--approved-by-sole-super-admin",
        )


def test_database_existence_probe_uses_psql_value_binding_via_stdin():
    source = (
        __import__("inspect").getsource(main)
    )

    assert "database_name={database_name}" in source
    assert '"-tA",' in source
    assert '"-f",' in source
    assert '"-",' in source
    assert "input_text=\"SELECT 1 FROM pg_database WHERE datname = :'database_name'\"" in source


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


def test_local_postgres_auto_start_only_targets_managed_non_production_cluster(tmp_path):
    pg_root = tmp_path / "pgsql"
    data_dir = tmp_path / "data"
    (pg_root / "bin").mkdir(parents=True)
    (pg_root / "bin" / "pg_ctl.exe").touch()
    data_dir.mkdir()
    (data_dir / "PG_VERSION").write_text("17", encoding="ascii")
    local = {
        "APP_ENV": "development",
        "DATABASE_URL": "postgresql://app:secret@127.0.0.1:55432/biddingflow_dev",
    }

    assert should_auto_start_local_postgres(local, pg_root=pg_root, data_dir=data_dir)
    assert should_auto_start_local_postgres(
        {
            **local,
            "APP_ENV": "staging",
            "DATABASE_AUTO_START_LOCAL": "true",
        },
        pg_root=pg_root,
        data_dir=data_dir,
    )
    assert not should_auto_start_local_postgres(
        {**local, "APP_ENV": "staging"}, pg_root=pg_root, data_dir=data_dir
    )
    assert not should_auto_start_local_postgres(
        {**local, "APP_ENV": "production"}, pg_root=pg_root, data_dir=data_dir
    )
    assert not should_auto_start_local_postgres(
        {
            **local,
            "APP_ENV": "production",
            "DATABASE_AUTO_START_LOCAL": "true",
        },
        pg_root=pg_root,
        data_dir=data_dir,
    )
    assert not should_auto_start_local_postgres(
        {**local, "DATABASE_URL": "postgresql://app:secret@db.example.com:5432/biddingflow"},
        pg_root=pg_root,
        data_dir=data_dir,
    )
    assert not should_auto_start_local_postgres(
        {**local, "DATABASE_AUTO_START_LOCAL": "false"},
        pg_root=pg_root,
        data_dir=data_dir,
    )


def test_ensure_local_postgres_running_starts_stopped_cluster(monkeypatch, tmp_path):
    pg_root = tmp_path / "pgsql"
    data_dir = tmp_path / "data"
    (pg_root / "bin").mkdir(parents=True)
    pg_ctl = pg_root / "bin" / "pg_ctl.exe"
    pg_ctl.touch()
    data_dir.mkdir()
    (data_dir / "PG_VERSION").write_text("17", encoding="ascii")
    starts = []

    class Status:
        returncode = 3

    monkeypatch.setattr("scripts.setup_local_postgres.subprocess.run", lambda *args, **kwargs: Status())
    monkeypatch.setattr("scripts.setup_local_postgres._run_pg_ctl", lambda *args: starts.append(args))

    assert ensure_local_postgres_running(pg_root=pg_root, data_dir=data_dir, port=55432)
    assert starts == [(
        str(pg_ctl), "-D", str(data_dir), "-l", str(tmp_path / "logs" / "data.log"),
        "-o", "-p 55432 -h 127.0.0.1", "start",
    )]


def test_ensure_local_postgres_running_retries_after_reload_shutdown(monkeypatch, tmp_path):
    pg_root = tmp_path / "pgsql"
    data_dir = tmp_path / "data"
    (pg_root / "bin").mkdir(parents=True)
    pg_ctl = pg_root / "bin" / "pg_ctl.exe"
    pg_ctl.touch()
    data_dir.mkdir()
    (data_dir / "PG_VERSION").write_text("17", encoding="ascii")
    accepting = iter((False, False, False))
    running = iter((False, True, False))
    starts = []

    monkeypatch.setattr(
        local_postgres,
        "_is_local_postgres_accepting",
        lambda *args, **kwargs: next(accepting),
    )
    monkeypatch.setattr(
        local_postgres,
        "_is_local_postgres_running",
        lambda *args, **kwargs: next(running),
    )
    monkeypatch.setattr(local_postgres.time, "sleep", lambda _seconds: None)

    def start(*args):
        starts.append(args)
        if len(starts) == 1:
            raise subprocess.CalledProcessError(3, args)

    monkeypatch.setattr(local_postgres, "_run_pg_ctl", start)

    assert ensure_local_postgres_running(
        pg_root=pg_root,
        data_dir=data_dir,
        port=55432,
    )
    expected = (
        str(pg_ctl), "-D", str(data_dir), "-l", str(tmp_path / "logs" / "data.log"),
        "-o", "-p 55432 -h 127.0.0.1", "start",
    )
    assert starts == [expected, expected]


def test_pg_ctl_runs_without_a_windows_reload_console(monkeypatch):
    calls = []
    monkeypatch.setattr(local_postgres, "_pg_ctl_creation_flags", lambda: 0x08000200)
    monkeypatch.setattr(
        local_postgres.subprocess,
        "run",
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    local_postgres._run_pg_ctl("pg_ctl.exe", "start")

    assert calls[0][1]["creationflags"] == 0x08000200
    assert calls[0][1]["stdin"] is subprocess.DEVNULL


@pytest.mark.skipif(local_postgres.os.name != "nt", reason="Windows process flags only")
def test_pg_ctl_creation_flags_suppress_the_windows_console():
    flags = local_postgres._pg_ctl_creation_flags()

    assert flags & subprocess.CREATE_NO_WINDOW
    assert flags & subprocess.CREATE_NEW_PROCESS_GROUP
    assert not flags & subprocess.DETACHED_PROCESS
