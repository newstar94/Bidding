from pathlib import Path
import json
import re

import yaml


ROOT = Path(__file__).resolve().parents[1]
TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA"
TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA"


def test_nginx_template_keeps_origin_on_loopback_and_bounds_abuse():
    nginx = (ROOT / "deploy/nginx/biddingflow-tunnel.conf.example").read_text(
        encoding="utf-8"
    )

    assert "listen 127.0.0.1:8080" in nginx
    assert "listen 0.0.0.0" not in nginx
    assert "real_ip_header CF-Connecting-IP" in nginx
    assert "set_real_ip_from 127.0.0.1" in nginx
    assert "limit_req zone=bf_auth" in nginx
    assert "limit_req zone=bf_api" in nginx
    assert "limit_conn bf_per_ip" in nginx
    assert "client_header_timeout" in nginx
    assert "client_body_timeout" in nginx
    assert "proxy_request_buffering on" in (
        ROOT / "deploy/nginx/biddingflow-proxy-params.conf.example"
    ).read_text(encoding="utf-8")
    for private_path in ("/health/live", "/health/ready", "/metrics"):
        block = re.search(
            rf"location = {re.escape(private_path)} \{{(?P<body>.*?)\n    \}}",
            nginx,
            re.DOTALL,
        )
        assert block is not None
        assert "allow 127.0.0.1" in block.group("body")
        assert "deny all" in block.group("body")


def test_cloudflared_template_has_one_hostname_and_fail_closed_catchall():
    config = yaml.safe_load(
        (ROOT / "deploy/cloudflared/config.yml.example").read_text(encoding="utf-8")
    )

    assert config["ingress"][0]["service"] == "http://127.0.0.1:8080"
    assert config["ingress"][-1] == {"service": "http_status:404"}


def _parse_environment_template(path):
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, value = stripped.split("=", 1)
        values[key] = value
    return values


def test_turnstile_environment_templates_are_isolated_by_environment():
    local = _parse_environment_template(
        ROOT / "deploy/turnstile/local.env.example"
    )
    staging = _parse_environment_template(
        ROOT / "deploy/turnstile/staging.env.example"
    )
    production = _parse_environment_template(
        ROOT / "deploy/turnstile/production.env.example"
    )

    assert local["APP_ENV"] == "development"
    assert local["TURNSTILE_SITE_KEY"] == TURNSTILE_TEST_SITE_KEY
    assert local["TURNSTILE_SECRET_KEY"] == TURNSTILE_TEST_SECRET_KEY
    assert set(local["TURNSTILE_ALLOWED_HOSTNAMES"].split(",")) == {
        "localhost",
        "127.0.0.1",
    }
    assert local["TURNSTILE_EDGE_CHALLENGE_HEADER"] == ""
    assert local["TURNSTILE_EDGE_CHALLENGE_VALUE"] == ""

    for name, environment, placeholder in (
        ("staging", staging, "REPLACE_WITH_STAGING_DOMAIN"),
        ("production", production, "REPLACE_WITH_PRODUCTION_DOMAIN"),
    ):
        assert environment["APP_ENV"] == name
        assert environment["APP_PUBLIC_URL"] == f"https://{placeholder}"
        assert environment["ALLOWED_HOSTS"] == placeholder
        assert environment["CORS_ORIGINS"] == f"https://{placeholder}"
        assert environment["ALLOWED_WS_ORIGINS"] == f"https://{placeholder}"
        assert environment["TURNSTILE_ALLOWED_HOSTNAMES"] == placeholder
        assert environment["TURNSTILE_ENABLED"] == "auto"
        assert environment["TURNSTILE_SITE_KEY"] == ""
        assert environment["TURNSTILE_SECRET_KEY"] == ""
        assert environment["TURNSTILE_SITE_KEY"] != TURNSTILE_TEST_SITE_KEY
        assert environment["TURNSTILE_SECRET_KEY"] != TURNSTILE_TEST_SECRET_KEY
        assert environment["TURNSTILE_EDGE_CHALLENGE_HEADER"] == ""
        assert environment["TURNSTILE_EDGE_CHALLENGE_VALUE"] == ""
        assert "localhost" not in "\n".join(environment.values())

    assert production["TRUSTED_PROXY_CIDRS"] == "127.0.0.1/32,::1/128"


def test_root_environment_example_is_an_optional_security_production_template():
    path = ROOT / ".env.example"
    content = path.read_text(encoding="utf-8")
    environment = _parse_environment_template(path)
    domain = "REPLACE_WITH_PRODUCTION_DOMAIN"

    assert environment["APP_ENV"] == "production"
    assert environment["APP_PUBLIC_URL"] == f"https://{domain}"
    assert environment["ALLOWED_HOSTS"] == domain
    assert environment["CORS_ORIGINS"] == f"https://{domain}"
    assert environment["ALLOWED_WS_ORIGINS"] == f"https://{domain}"
    assert environment["TURNSTILE_ALLOWED_HOSTNAMES"] == domain
    assert environment["TURNSTILE_ENABLED"] == "auto"
    assert environment["TURNSTILE_SITE_KEY"] == ""
    assert environment["TURNSTILE_SECRET_KEY"] == ""
    assert environment["TRUSTED_PROXY_CIDRS"] == "127.0.0.1/32,::1/128"
    assert environment["DATABASE_URL"] == ""
    assert environment["ADMIN_PASSWORD"] == ""
    assert environment["SUPER_ADMIN_IP_ALLOWLIST"] == ""
    assert environment["SECRET_ROTATION_CONFIRMED_AT"] == ""
    for attestation in (
        "DATABASE_PRIVATE_NETWORK_CONFIRMED",
        "DATA_AT_REST_ENCRYPTION_CONFIRMED",
        "AUDIT_CHECKPOINT_OFFHOST_CONFIRMED",
        "DOCUMENT_WORKER_SERVICE_ACCOUNT_CONFIRMED",
        "DOCUMENT_WORKER_SHARED_STORAGE_CONFIRMED",
    ):
        assert environment[attestation] == "false"
    assert "yourdomain.com" not in content


def test_production_information_form_covers_every_external_input_without_secrets():
    form = (ROOT / "docs/production-security-information.md").read_text(
        encoding="utf-8"
    )

    for section in (
        "Domain và môi trường",
        "Hạ tầng máy chủ",
        "PostgreSQL",
        "Cloudflare zone và Tunnel",
        "Cloudflare Turnstile",
        "Baseline, WAF và cảnh báo",
        "Ứng dụng, email và tài khoản khởi tạo",
        "Lưu trữ, audit, restore và document worker",
        "Secret và xác nhận vận hành",
    ):
        assert section in form
    for required_value in (
        "SHOW max_connections",
        "Tunnel UUID",
        "APP_INSTANCE_COUNT",
        "TURNSTILE_SITE_KEY",
        "TURNSTILE_SECRET_KEY",
        "Không điền giá trị",
    ):
        assert required_value in form


def test_systemd_template_passes_every_validated_uvicorn_limit():
    service = (ROOT / "deploy/systemd/biddingflow.service.example").read_text(
        encoding="utf-8"
    )
    environment = (ROOT / ".env.example").read_text(encoding="utf-8")
    variables = {
        "UVICORN_WORKERS": "--workers",
        "UVICORN_LIMIT_CONCURRENCY": "--limit-concurrency",
        "UVICORN_BACKLOG": "--backlog",
        "UVICORN_TIMEOUT_KEEP_ALIVE": "--timeout-keep-alive",
        "UVICORN_MAX_REQUESTS": "--limit-max-requests",
        "UVICORN_MAX_REQUESTS_JITTER": "--limit-max-requests-jitter",
        "UVICORN_WS_MAX_SIZE": "--ws-max-size",
        "UVICORN_WS_MAX_QUEUE": "--ws-max-queue",
    }

    assert "--host 127.0.0.1" in service
    assert "--no-proxy-headers" in service
    for variable, option in variables.items():
        assert re.search(rf"^{variable}=\d+$", environment, re.MULTILINE)
        assert f"{option} ${{{variable}}}" in service


def test_edge_rule_template_covers_public_expensive_and_websocket_surfaces():
    rules = (ROOT / "deploy/cloudflare/security-rules.md").read_text(
        encoding="utf-8"
    )

    for path in (
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/forgot-password",
        "/api/auth/resend-code",
        "/api/import-excel",
        "/api/lookup-tax-code",
        "/api/",
        "/ws/sync",
    ):
        assert path in rules
    assert "log → Managed Challenge → temporary block" in rules
    assert "Direct-IP requests fail" in rules
    assert "X-BiddingFlow-Edge-Risk: challenge" in rules
    assert "escalation-only" in rules


def test_monitoring_and_runbook_cover_security_failure_modes():
    alerts = (ROOT / "deploy/monitoring/security-alerts.yml.example").read_text(
        encoding="utf-8"
    )
    runbook = (ROOT / "deploy/runbooks/ddos-bot-abuse.md").read_text(
        encoding="utf-8"
    )

    assert "biddingflow_turnstile_validations_total" in alerts
    assert "biddingflow_http_rate_limited_total" in alerts
    assert 'status="503"' in alerts
    for scenario in ("Volumetric", "Credential stuffing", "Siteverify", "false positive"):
        assert scenario.casefold() in runbook.casefold()

    dashboard = json.loads(
        (ROOT / "deploy/monitoring/security-dashboard.json").read_text(
            encoding="utf-8"
        )
    )
    expressions = "\n".join(
        target["expr"]
        for panel in dashboard["panels"]
        for target in panel.get("targets", [])
    )
    assert "biddingflow_turnstile_validations_total" in expressions
    assert "biddingflow_http_rate_limited_total" in expressions
    assert 'status="503"' in expressions
