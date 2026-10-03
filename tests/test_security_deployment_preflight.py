from pathlib import Path
import shlex
import subprocess
import sys

import pytest
from uvicorn.main import main as uvicorn_cli

from scripts import check_security_deployment as preflight


ROOT = Path(__file__).resolve().parents[1]


def test_preflight_cli_runs_from_artifact_without_editable_install():
    # Skip site initialization so an editable developer checkout cannot hide
    # the missing project path in a clean production virtualenv.
    code = (
        "import runpy,sys,sysconfig; "
        "sys.path.append(sysconfig.get_paths()['purelib']); "
        f"sys.argv=[{str(ROOT / 'scripts/check_security_deployment.py')!r},'--help']; "
        "runpy.run_path(sys.argv[0],run_name='__main__')"
    )
    result = subprocess.run(
        [sys.executable, "-I", "-S", "-c", code],
        capture_output=True, text=True, timeout=20, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "--environment-file" in result.stdout


PRODUCTION_ENVIRONMENT = {
    "APP_ENV": "production",
    "APP_PUBLIC_URL": "https://bid.example.vn",
    "ALLOWED_HOSTS": "bid.example.vn",
    "CORS_ORIGINS": "https://bid.example.vn",
    "ALLOWED_WS_ORIGINS": "https://bid.example.vn",
    "TRUSTED_PROXY_CIDRS": "127.0.0.1/32,::1/128",
    "TURNSTILE_ENABLED": "true",
    "TURNSTILE_SITE_KEY": "production-site-key-from-secret-manager",
    "TURNSTILE_SECRET_KEY": "production-secret-key-from-secret-manager",
    "TURNSTILE_ALLOWED_HOSTNAMES": "bid.example.vn",
    "TURNSTILE_VERIFY_TIMEOUT_SECONDS": "5",
    "APP_INSTANCE_COUNT": "1",
    "UVICORN_WORKERS": "4",
    "DATABASE_POOL_MAX_SIZE": "8",
    "DATABASE_DEDICATED_CONNECTIONS_PER_WORKER": "1",
    "DATABASE_RESERVED_CONNECTIONS": "20",
    "UVICORN_LIMIT_CONCURRENCY": "256",
    "UVICORN_BACKLOG": "512",
    "UVICORN_TIMEOUT_KEEP_ALIVE": "5",
    "UVICORN_MAX_REQUESTS": "10000",
    "UVICORN_MAX_REQUESTS_JITTER": "1000",
    "UVICORN_WS_MAX_SIZE": "65536",
    "UVICORN_WS_MAX_QUEUE": "16",
    "WEBSOCKET_MAX_FRAME_BYTES": "65536",
}


def _materialize_cloudflared_config(tmp_path):
    content = (ROOT / "deploy/cloudflared/config.yml.example").read_text(
        encoding="utf-8"
    )
    content = content.replace(
        "REPLACE_WITH_TUNNEL_UUID",
        "12345678-1234-1234-1234-123456789abc",
    ).replace("REPLACE_WITH_PRODUCTION_DOMAIN", "bid.example.vn")
    path = tmp_path / "cloudflared.yml"
    path.write_text(content, encoding="utf-8")
    return path


def _materialize_cli_arguments(tmp_path, environment, *, max_connections=100, database_overrides=None):
    environment_file = tmp_path / "web.env"
    environment_file.write_text(
        "\n".join(f"{name}={value}" for name, value in environment.items()),
        encoding="utf-8",
    )
    database_file = tmp_path / "database-web.env"
    database_file.write_text(
        "\n".join(f"{name}={value}" for name, value in (database_overrides or {}).items()),
        encoding="utf-8",
    )
    unit_file = tmp_path / "biddingflow.service"
    unit_file.write_text(
        (ROOT / "deploy/systemd/biddingflow.service.example").read_text(encoding="utf-8")
        .replace("/etc/biddingflow/web.env", environment_file.as_posix())
        .replace("/etc/biddingflow/database-web.env", database_file.as_posix()),
        encoding="utf-8",
    )
    cloudflared = _materialize_cloudflared_config(tmp_path)
    return [
        "--environment-file", str(environment_file),
        "--cloudflared-config", str(cloudflared),
        "--nginx-config", str(ROOT / "deploy/nginx/biddingflow-tunnel.conf.example"),
        "--systemd-unit", str(unit_file),
        "--postgres-max-connections", str(max_connections),
    ], unit_file


def _uvicorn_parameters(command, environment):
    argv = shlex.split(command)
    assert argv[1:3] == ["-m", "uvicorn"]
    argv = argv[3:]
    for name, value in environment.items():
        argv = [argument.replace("${" + name + "}", value) for argument in argv]
    # Parse the real CLI without invoking its callback or starting a server.
    with uvicorn_cli.make_context("uvicorn", argv) as context:
        return dict(context.params)


def test_production_environment_preflight_binds_domain_and_resource_budgets():
    result = preflight.validate_production_environment(
        PRODUCTION_ENVIRONMENT,
        postgres_max_connections=100,
    )

    assert result["hostname"] == "bid.example.vn"
    assert result["database_budget"]["application"] == 36
    assert result["database_budget"]["total"] == 56
    assert result["resource_limits"]["limit_concurrency"] == 256
    assert result["turnstile_enabled"] is True


def test_production_preflight_allows_auto_mode_without_turnstile_credentials():
    environment = {
        **PRODUCTION_ENVIRONMENT,
        "TURNSTILE_ENABLED": "auto",
        "TURNSTILE_SITE_KEY": "",
        "TURNSTILE_SECRET_KEY": "",
        "TURNSTILE_ALLOWED_HOSTNAMES": "",
    }

    result = preflight.validate_production_environment(
        environment,
        postgres_max_connections=100,
    )

    assert result["turnstile_enabled"] is False
    assert result["turnstile_diagnostic"] == "TURNSTILE_AUTO_INCOMPLETE"


@pytest.mark.parametrize(
    "overrides, message",
    [
        (
            {"APP_PUBLIC_URL": "https://REPLACE_WITH_PRODUCTION_DOMAIN"},
            "placeholder",
        ),
        (
            {"TURNSTILE_ALLOWED_HOSTNAMES": "other.example.vn"},
            "exact production",
        ),
        (
            {"TRUSTED_PROXY_CIDRS": "0.0.0.0/0"},
            "loopback",
        ),
        (
            {
                "TURNSTILE_SITE_KEY": "1x00000000000000000000AA",
                "TURNSTILE_SECRET_KEY": "1x0000000000000000000000000000000AA",
            },
            "test keys",
        ),
        (
            {"APP_PUBLIC_URL": "https://203.0.113.10"},
            "raw IP",
        ),
        (
            {"APP_PUBLIC_URL": "https://bid.example.vn:not-a-port"},
            "valid HTTPS origin",
        ),
    ],
)
def test_production_environment_preflight_rejects_unsafe_bindings(
    overrides,
    message,
):
    environment = {**PRODUCTION_ENVIRONMENT, **overrides}

    with pytest.raises(preflight.SecurityDeploymentError, match=message):
        preflight.validate_production_environment(
            environment,
            postgres_max_connections=100,
        )


def test_production_environment_preflight_rejects_unsafe_database_budget():
    with pytest.raises(preflight.SecurityDeploymentError, match="budget is unsafe"):
        preflight.validate_production_environment(
            PRODUCTION_ENVIRONMENT,
            postgres_max_connections=56,
        )


def test_cloudflared_preflight_requires_loopback_and_fail_closed_catchall(tmp_path):
    config = _materialize_cloudflared_config(tmp_path)

    preflight.validate_cloudflared_config(config, hostname="bid.example.vn")

    unsafe = config.read_text(encoding="utf-8").replace(
        "http://127.0.0.1:8080",
        "http://203.0.113.10:8080",
    )
    config.write_text(unsafe, encoding="utf-8")
    with pytest.raises(preflight.SecurityDeploymentError, match="loopback NGINX"):
        preflight.validate_cloudflared_config(config, hostname="bid.example.vn")


def test_nginx_preflight_rejects_a_public_listener(tmp_path):
    source = (ROOT / "deploy/nginx/biddingflow-tunnel.conf.example").read_text(
        encoding="utf-8"
    )
    config = tmp_path / "nginx.conf"
    config.write_text(
        source.replace(
            "listen 127.0.0.1:8080 default_server;",
            "listen 0.0.0.0:8080 default_server;",
        ),
        encoding="utf-8",
    )

    with pytest.raises(preflight.SecurityDeploymentError, match="missing"):
        preflight.validate_nginx_config(config)


def test_security_deployment_cli_passes_without_printing_credentials(
    tmp_path,
    capsys,
):
    arguments, _unit = _materialize_cli_arguments(tmp_path, PRODUCTION_ENVIRONMENT)
    exit_code = preflight.main(arguments)

    captured = capsys.readouterr()
    assert exit_code == 0
    assert "preflight passed for bid.example.vn" in captured.out
    assert "56/100" in captured.out
    assert PRODUCTION_ENVIRONMENT["TURNSTILE_SECRET_KEY"] not in captured.out
    assert captured.err == ""


def test_cli_uses_actual_unit_worker_default_instead_of_false_green_budget(tmp_path, capsys):
    environment = {key: value for key, value in PRODUCTION_ENVIRONMENT.items()
                   if not key.startswith("UVICORN_")}
    # The old environment-file-only check accepted 29/40; the deployed unit
    # uses four workers and must reject its actual 56/40 connection budget.
    assert preflight.validate_production_environment(
        environment, postgres_max_connections=40,
    )["database_budget"]["total"] == 29
    arguments, _unit = _materialize_cli_arguments(tmp_path, environment, max_connections=40)

    assert preflight.main(arguments) == 1
    captured = capsys.readouterr()
    assert "application=36" in captured.err
    assert "preflight passed" not in captured.out


def test_environment_file_overrides_unit_worker_default(tmp_path, capsys):
    environment = {**PRODUCTION_ENVIRONMENT, "UVICORN_WORKERS": "2"}
    arguments, _unit = _materialize_cli_arguments(tmp_path, environment, max_connections=40)

    assert preflight.main(arguments) == 0
    assert "38/40" in capsys.readouterr().out


def test_later_environment_file_overrides_earlier_file_and_unit(tmp_path, capsys):
    arguments, _unit = _materialize_cli_arguments(
        tmp_path, {**PRODUCTION_ENVIRONMENT, "UVICORN_WORKERS": "2"},
        max_connections=40,
        database_overrides={"UVICORN_WORKERS": "3", "DATABASE_URL": "secret-must-not-print"},
    )

    assert preflight.main(arguments) == 1
    captured = capsys.readouterr()
    assert "application=27" in captured.err
    assert "secret-must-not-print" not in captured.out + captured.err


def test_cli_checks_unit_process_defaults_and_environment_override(tmp_path, capsys):
    environment = {key: value for key, value in PRODUCTION_ENVIRONMENT.items()
                   if key != "UVICORN_WS_MAX_SIZE"}
    arguments, unit = _materialize_cli_arguments(tmp_path, environment)
    unit.write_text(unit.read_text(encoding="utf-8").replace(
        "Environment=UVICORN_WS_MAX_SIZE=65536", "Environment=UVICORN_WS_MAX_SIZE=131072",
    ), encoding="utf-8")

    assert preflight.main(arguments) == 1
    assert "UVICORN_WS_MAX_SIZE must equal" in capsys.readouterr().err
    arguments, unit = _materialize_cli_arguments(tmp_path, PRODUCTION_ENVIRONMENT)
    unit.write_text(unit.read_text(encoding="utf-8").replace(
        "Environment=UVICORN_WS_MAX_SIZE=65536", "Environment=UVICORN_WS_MAX_SIZE=131072",
    ), encoding="utf-8")
    assert preflight.main(arguments) == 0


def test_cli_rejects_unit_worker_command_that_bypasses_checked_environment(tmp_path, capsys):
    arguments, unit = _materialize_cli_arguments(tmp_path, PRODUCTION_ENVIRONMENT)
    unit.write_text(unit.read_text(encoding="utf-8").replace(
        "--workers ${UVICORN_WORKERS}", "--workers 8",
    ), encoding="utf-8")

    assert preflight.main(arguments) == 1
    assert "--workers ${UVICORN_WORKERS}" in capsys.readouterr().err


@pytest.mark.parametrize("override", ["--workers 8", "--workers=8"])
def test_cli_rejects_duplicate_workers_that_uvicorn_would_override(tmp_path, capsys, override):
    environment = {**PRODUCTION_ENVIRONMENT, "UVICORN_WORKERS": "2"}
    arguments, unit = _materialize_cli_arguments(tmp_path, environment, max_connections=40)
    content = unit.read_text(encoding="utf-8").replace(
        "--workers ${UVICORN_WORKERS}", f"--workers ${{UVICORN_WORKERS}} {override}",
    )
    unit.write_text(content, encoding="utf-8")
    command = next(line.split("=", 1)[1] for line in content.splitlines()
                   if line.startswith("ExecStart="))
    assert _uvicorn_parameters(command, environment)["workers"] == 8

    assert preflight.main(arguments) == 1
    assert "duplicate" in capsys.readouterr().err.lower()


@pytest.mark.parametrize("separator", [" ", "="])
@pytest.mark.parametrize(
    "option, checked_value, override",
    [
        ("--host", "127.0.0.1", "0.0.0.0"),
        ("--limit-concurrency", "${UVICORN_LIMIT_CONCURRENCY}", 2048),
        ("--backlog", "${UVICORN_BACKLOG}", 2048),
        ("--timeout-keep-alive", "${UVICORN_TIMEOUT_KEEP_ALIVE}", 30),
        ("--limit-max-requests", "${UVICORN_MAX_REQUESTS}", 20000),
        ("--limit-max-requests-jitter", "${UVICORN_MAX_REQUESTS_JITTER}", 2000),
        ("--ws-max-size", "${UVICORN_WS_MAX_SIZE}", 131072),
        ("--ws-max-queue", "${UVICORN_WS_MAX_QUEUE}", 128),
    ],
)
def test_cli_rejects_duplicate_resource_options_that_uvicorn_would_override(
    tmp_path, capsys, option, checked_value, override, separator,
):
    arguments, unit = _materialize_cli_arguments(tmp_path, PRODUCTION_ENVIRONMENT)
    content = unit.read_text(encoding="utf-8").replace(
        f"{option} {checked_value}",
        f"{option} {checked_value} {option}{separator}{override}",
    )
    unit.write_text(content, encoding="utf-8")
    command = next(line.split("=", 1)[1] for line in content.splitlines()
                   if line.startswith("ExecStart="))
    assert _uvicorn_parameters(command, PRODUCTION_ENVIRONMENT)[
        option.removeprefix("--").replace("-", "_")
    ] == override

    assert preflight.main(arguments) == 1
    assert "duplicate" in capsys.readouterr().err.lower()


@pytest.mark.parametrize("override, effective", [
    ("--proxy-headers", True),
    ("--no-proxy-headers", False),
])
def test_cli_rejects_duplicate_or_conflicting_proxy_options(
    tmp_path, capsys, override, effective,
):
    arguments, unit = _materialize_cli_arguments(tmp_path, PRODUCTION_ENVIRONMENT)
    content = unit.read_text(encoding="utf-8").replace(
        "--no-proxy-headers", f"--no-proxy-headers {override}",
    )
    unit.write_text(content, encoding="utf-8")
    command = next(line.split("=", 1)[1] for line in content.splitlines()
                   if line.startswith("ExecStart="))
    assert _uvicorn_parameters(command, PRODUCTION_ENVIRONMENT)["proxy_headers"] is effective

    assert preflight.main(arguments) == 1
    assert "duplicate" in capsys.readouterr().err.lower()


def test_cli_accepts_single_equals_options_bound_to_checked_environment(tmp_path, capsys):
    environment = {**PRODUCTION_ENVIRONMENT, "UVICORN_WORKERS": "2"}
    arguments, unit = _materialize_cli_arguments(tmp_path, environment, max_connections=40)
    content = unit.read_text(encoding="utf-8")
    for option in (
        "--host", "--workers", "--limit-concurrency", "--backlog",
        "--timeout-keep-alive", "--limit-max-requests", "--limit-max-requests-jitter",
        "--ws-max-size", "--ws-max-queue",
    ):
        content = content.replace(f"{option} ", f"{option}=")
    unit.write_text(content, encoding="utf-8")
    command = next(line.split("=", 1)[1] for line in content.splitlines()
                   if line.startswith("ExecStart="))
    parsed = _uvicorn_parameters(command, environment)
    expected = {
        "host": "127.0.0.1", "workers": 2, "limit_concurrency": 256,
        "backlog": 512, "timeout_keep_alive": 5, "limit_max_requests": 10000,
        "limit_max_requests_jitter": 1000, "ws_max_size": 65536, "ws_max_queue": 16,
    }
    assert {key: parsed[key] for key in expected} == expected

    assert preflight.main(arguments) == 0
    assert "38/40" in capsys.readouterr().out


def test_cli_checks_effective_execstart_after_reset_and_continuation(tmp_path, capsys):
    arguments, unit = _materialize_cli_arguments(tmp_path, PRODUCTION_ENVIRONMENT)
    content = unit.read_text(encoding="utf-8")
    command = next(line for line in content.splitlines() if line.startswith("ExecStart="))
    continued = command.replace(" --workers ", " \\\n    --workers ")
    unit.write_text(content.replace(
        command, f"ExecStart=/obsolete-command --workers 8\nExecStart=\n{continued}",
    ), encoding="utf-8")

    assert preflight.main(arguments) == 0
    assert "56/100" in capsys.readouterr().out


def test_cli_rejects_multiple_effective_execstart_commands(tmp_path, capsys):
    arguments, unit = _materialize_cli_arguments(tmp_path, PRODUCTION_ENVIRONMENT)
    content = unit.read_text(encoding="utf-8").replace(
        "Restart=on-failure", "ExecStart=/unchecked-command --workers 8\nRestart=on-failure",
    )
    unit.write_text(content, encoding="utf-8")

    assert preflight.main(arguments) == 1
    assert "one effective ExecStart" in capsys.readouterr().err


def test_cli_rejects_environment_file_not_loaded_by_unit(tmp_path, capsys):
    arguments, _unit = _materialize_cli_arguments(tmp_path, PRODUCTION_ENVIRONMENT)
    other = tmp_path / "unused-web.env"
    other.write_text("\n".join(f"{key}={value}" for key, value in PRODUCTION_ENVIRONMENT.items()),
                     encoding="utf-8")
    arguments[1] = str(other)

    assert preflight.main(arguments) == 1
    assert "not loaded by the supplied systemd unit" in capsys.readouterr().err


def test_environment_parser_rejects_duplicate_variables(tmp_path):
    environment_file = tmp_path / "duplicate.env"
    environment_file.write_text(
        "APP_ENV=production\nAPP_ENV=development\n",
        encoding="utf-8",
    )

    with pytest.raises(preflight.SecurityDeploymentError, match="duplicate"):
        preflight.parse_environment_file(environment_file)
