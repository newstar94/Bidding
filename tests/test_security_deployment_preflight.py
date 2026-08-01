from pathlib import Path

import pytest

from scripts import check_security_deployment as preflight


ROOT = Path(__file__).resolve().parents[1]
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


def test_production_environment_preflight_binds_domain_and_resource_budgets():
    result = preflight.validate_production_environment(
        PRODUCTION_ENVIRONMENT,
        postgres_max_connections=100,
    )

    assert result["hostname"] == "bid.example.vn"
    assert result["database_budget"]["application"] == 36
    assert result["database_budget"]["total"] == 56
    assert result["resource_limits"]["limit_concurrency"] == 256


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
    environment_file = tmp_path / "web.env"
    environment_file.write_text(
        "\n".join(f"{name}={value}" for name, value in PRODUCTION_ENVIRONMENT.items()),
        encoding="utf-8",
    )
    cloudflared = _materialize_cloudflared_config(tmp_path)

    exit_code = preflight.main(
        [
            "--environment-file",
            str(environment_file),
            "--cloudflared-config",
            str(cloudflared),
            "--nginx-config",
            str(ROOT / "deploy/nginx/biddingflow-tunnel.conf.example"),
            "--systemd-unit",
            str(ROOT / "deploy/systemd/biddingflow.service.example"),
            "--postgres-max-connections",
            "100",
        ]
    )

    captured = capsys.readouterr()
    assert exit_code == 0
    assert "preflight passed for bid.example.vn" in captured.out
    assert "56/100" in captured.out
    assert PRODUCTION_ENVIRONMENT["TURNSTILE_SECRET_KEY"] not in captured.out
    assert captured.err == ""


def test_environment_parser_rejects_duplicate_variables(tmp_path):
    environment_file = tmp_path / "duplicate.env"
    environment_file.write_text(
        "APP_ENV=production\nAPP_ENV=development\n",
        encoding="utf-8",
    )

    with pytest.raises(preflight.SecurityDeploymentError, match="duplicate"):
        preflight.parse_environment_file(environment_file)
