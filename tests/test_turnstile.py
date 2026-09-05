import asyncio
import json
from types import SimpleNamespace

import pytest
from starlette.datastructures import Headers

from backend.security import turnstile


LOCAL_TEST_ENV = {
    "APP_ENV": "development",
    "TURNSTILE_ENABLED": "true",
    "TURNSTILE_SITE_KEY": "1x00000000000000000000AA",
    "TURNSTILE_SECRET_KEY": "1x0000000000000000000000000000000AA",
    "TURNSTILE_ALLOWED_HOSTNAMES": "localhost,127.0.0.1",
    "TURNSTILE_VERIFY_TIMEOUT_SECONDS": "5",
}


def test_turnstile_is_disabled_by_default():
    config = turnstile.get_turnstile_config({"APP_ENV": "development"})

    assert config.enabled is False
    assert turnstile.public_turnstile_config({}) == {
        "enabled": False,
        "siteKey": "",
    }


def test_local_configuration_accepts_official_test_keys():
    config = turnstile.get_turnstile_config(LOCAL_TEST_ENV)

    assert config.enabled is True
    assert config.site_key == "1x00000000000000000000AA"
    assert config.allowed_hostnames == frozenset({"localhost", "127.0.0.1"})
    assert config.testing is True
    assert "secret_key" not in repr(config)


def test_auto_mode_stays_disabled_until_every_required_value_is_present():
    incomplete = {
        "APP_ENV": "production",
        "APP_PUBLIC_URL": "https://app.example.com",
        "TURNSTILE_ENABLED": "auto",
        "TURNSTILE_SITE_KEY": "configured-site-key",
        "TURNSTILE_SECRET_KEY": "",
        "TURNSTILE_ALLOWED_HOSTNAMES": "app.example.com",
    }

    config = turnstile.get_turnstile_config(incomplete)

    assert config.enabled is False
    assert config.mode == "auto"
    assert config.diagnostic_code == "TURNSTILE_AUTO_INCOMPLETE"
    assert turnstile.public_turnstile_config(incomplete) == {
        "enabled": False,
        "siteKey": "",
    }


def test_auto_mode_activates_only_after_complete_valid_configuration():
    environment = {
        "APP_ENV": "production",
        "APP_PUBLIC_URL": "https://app.example.com",
        "TURNSTILE_ENABLED": "auto",
        "TURNSTILE_SITE_KEY": "configured-site-key",
        "TURNSTILE_SECRET_KEY": "configured-secret-key",
        "TURNSTILE_ALLOWED_HOSTNAMES": "app.example.com",
    }

    config = turnstile.get_turnstile_config(environment)

    assert config.enabled is True
    assert config.mode == "auto"
    assert config.diagnostic_code == ""


def test_auto_mode_disables_invalid_configuration_without_stopping_startup():
    environment = {
        **LOCAL_TEST_ENV,
        "APP_ENV": "production",
        "APP_PUBLIC_URL": "https://app.example.com",
        "TURNSTILE_ENABLED": "auto",
    }

    config = turnstile.get_turnstile_config(environment)

    assert config.enabled is False
    assert config.mode == "auto"
    assert config.diagnostic_code == "TURNSTILE_AUTO_INVALID"


def test_unknown_turnstile_mode_is_rejected_instead_of_silently_disabling():
    with pytest.raises(turnstile.TurnstileConfigurationError, match="false, auto, or true"):
        turnstile.get_turnstile_config({"TURNSTILE_ENABLED": "tru"})


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"TURNSTILE_SECRET_KEY": ""}, "TURNSTILE_SECRET_KEY"),
        ({"TURNSTILE_ALLOWED_HOSTNAMES": ""}, "TURNSTILE_ALLOWED_HOSTNAMES"),
        ({"TURNSTILE_ALLOWED_HOSTNAMES": "*.example.com"}, "exact hostnames"),
        (
            {"TURNSTILE_ALLOWED_HOSTNAMES": "staging.example.com"},
            "restricted to local hostnames",
        ),
        (
            {"TURNSTILE_SECRET_KEY": "real-secret-key"},
            "must be used together",
        ),
        ({"TURNSTILE_VERIFY_TIMEOUT_SECONDS": "30"}, "between 1 and 10"),
        (
            {"TURNSTILE_EDGE_CHALLENGE_HEADER": "X-BiddingFlow-Edge-Risk"},
            "configured together",
        ),
        (
            {
                "TURNSTILE_EDGE_CHALLENGE_HEADER": "Authorization",
                "TURNSTILE_EDGE_CHALLENGE_VALUE": "challenge",
            },
            "dedicated safe HTTP header",
        ),
    ],
)
def test_enabled_configuration_fails_closed_when_invalid(overrides, message):
    environment = {**LOCAL_TEST_ENV, **overrides}

    with pytest.raises(turnstile.TurnstileConfigurationError, match=message):
        turnstile.get_turnstile_config(environment)


def test_production_rejects_test_keys_and_local_hostnames():
    production = {
        **LOCAL_TEST_ENV,
        "APP_ENV": "production",
        "APP_PUBLIC_URL": "https://app.example.com",
    }

    with pytest.raises(turnstile.TurnstileConfigurationError):
        turnstile.get_turnstile_config(production)


def test_production_requires_public_url_hostname_and_accepts_real_key_placeholders():
    production = {
        "APP_ENV": "production",
        "APP_PUBLIC_URL": "https://app.example.com",
        "TURNSTILE_ENABLED": "true",
        "TURNSTILE_SITE_KEY": "real-site-key-from-secret-manager",
        "TURNSTILE_SECRET_KEY": "real-secret-key-from-secret-manager",
        "TURNSTILE_ALLOWED_HOSTNAMES": "app.example.com",
        "TURNSTILE_VERIFY_TIMEOUT_SECONDS": "4",
    }

    config = turnstile.get_turnstile_config(production)

    assert config.enabled is True
    assert config.allowed_hostnames == frozenset({"app.example.com"})


def test_edge_signal_can_only_escalate_an_exact_configured_marker():
    environment = {
        **LOCAL_TEST_ENV,
        "TURNSTILE_EDGE_CHALLENGE_HEADER": "X-BiddingFlow-Edge-Risk",
        "TURNSTILE_EDGE_CHALLENGE_VALUE": "challenge",
    }

    assert turnstile.edge_challenge_required(
        SimpleNamespace(
            headers=Headers({"X-BiddingFlow-Edge-Risk": "challenge"})
        ),
        environment,
    ) is True
    assert turnstile.edge_challenge_required(
        SimpleNamespace(headers=Headers({"X-BiddingFlow-Edge-Risk": "allow"})),
        environment,
    ) is False
    assert turnstile.edge_challenge_required(
        SimpleNamespace(headers=Headers({})),
        environment,
    ) is False


def test_verify_turnstile_binds_success_to_hostname_and_action(monkeypatch):
    async def fake_blocking_call(*_args, **_kwargs):
        return {
            "success": True,
            "hostname": "localhost",
            "action": "register",
        }

    monkeypatch.setattr(turnstile, "run_blocking_io", fake_blocking_call)
    decision = asyncio.run(
        turnstile.verify_turnstile_token(
            "token-value",
            expected_action="register",
            remote_ip="127.0.0.1",
            environ=LOCAL_TEST_ENV,
        )
    )

    assert decision.allowed is True
    assert decision.code == "BOT_CHALLENGE_PASSED"


def test_official_test_result_can_exercise_local_backend_without_domain(monkeypatch):
    async def fake_blocking_call(*_args, **_kwargs):
        return {
            "success": True,
            "hostname": "example.com",
            "metadata": {"result_with_testing_key": True},
        }

    monkeypatch.setattr(turnstile, "run_blocking_io", fake_blocking_call)
    decision = asyncio.run(
        turnstile.verify_turnstile_token(
            "XXXX.DUMMY.TOKEN.XXXX",
            expected_action="register",
            remote_ip="127.0.0.1",
            environ=LOCAL_TEST_ENV,
        )
    )

    assert decision.allowed is True
    assert decision.code == "BOT_CHALLENGE_PASSED"


@pytest.mark.parametrize(
    "payload",
    [
        {
            "success": False,
            "hostname": "localhost",
            "action": "register",
            "error-codes": ["timeout-or-duplicate"],
        },
        {"success": True, "hostname": "attacker.example", "action": "register"},
        {"success": True, "hostname": "localhost", "action": "login"},
    ],
)
def test_verify_turnstile_rejects_invalid_response_binding(monkeypatch, payload):
    async def fake_blocking_call(*_args, **_kwargs):
        return payload

    monkeypatch.setattr(turnstile, "run_blocking_io", fake_blocking_call)
    decision = asyncio.run(
        turnstile.verify_turnstile_token(
            "token-value",
            expected_action="register",
            remote_ip="127.0.0.1",
            environ=LOCAL_TEST_ENV,
        )
    )

    assert decision.allowed is False
    assert decision.code == "BOT_CHALLENGE_INVALID"


def test_verify_turnstile_rejects_missing_and_oversized_tokens_without_upstream(monkeypatch):
    async def should_not_run(*_args, **_kwargs):
        raise AssertionError("upstream must not be called")

    monkeypatch.setattr(turnstile, "run_blocking_io", should_not_run)
    missing = asyncio.run(
        turnstile.verify_turnstile_token(
            "",
            expected_action="register",
            remote_ip="127.0.0.1",
            environ=LOCAL_TEST_ENV,
        )
    )
    oversized = asyncio.run(
        turnstile.verify_turnstile_token(
            "x" * 2_049,
            expected_action="register",
            remote_ip="127.0.0.1",
            environ=LOCAL_TEST_ENV,
        )
    )

    assert missing.code == "BOT_CHALLENGE_REQUIRED"
    assert oversized.code == "BOT_CHALLENGE_INVALID"


def test_verify_turnstile_reports_upstream_failure_without_leaking_details(monkeypatch):
    async def unavailable(*_args, **_kwargs):
        raise TimeoutError("secret upstream details")

    monkeypatch.setattr(turnstile, "run_blocking_io", unavailable)
    decision = asyncio.run(
        turnstile.verify_turnstile_token(
            "token-value",
            expected_action="register",
            remote_ip="127.0.0.1",
            environ=LOCAL_TEST_ENV,
        )
    )
    response = turnstile.turnstile_error_response(decision)

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert b"secret upstream details" not in response.body
    assert json.loads(response.body)["code"] == "BOT_CHALLENGE_UNAVAILABLE"


def test_enforce_turnstile_returns_required_contract(monkeypatch):
    monkeypatch.setenv("TURNSTILE_ENABLED", "true")
    monkeypatch.setenv("TURNSTILE_SITE_KEY", LOCAL_TEST_ENV["TURNSTILE_SITE_KEY"])
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", LOCAL_TEST_ENV["TURNSTILE_SECRET_KEY"])
    monkeypatch.setenv("TURNSTILE_ALLOWED_HOSTNAMES", "localhost")
    monkeypatch.setenv("APP_ENV", "development")

    request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"), headers={})
    response = asyncio.run(
        turnstile.enforce_turnstile(
            request,
            {},
            expected_action="register",
        )
    )

    assert response.status_code == 403
    assert json.loads(response.body) == {
        "error": "Vui lòng hoàn tất bước xác minh bảo mật.",
        "code": "BOT_CHALLENGE_REQUIRED",
        "challengeRequired": True,
    }


def _enable_local_turnstile(monkeypatch):
    for key, value in LOCAL_TEST_ENV.items():
        monkeypatch.setenv(key, value)


@pytest.mark.parametrize(
    "handler_name, payload",
    [
        (
            "register_api",
            {
                "username": "newuser2026",
                "password": "Strong-Unique-2026!",
                "name": "Người dùng mới",
                "email": "new.user@example.com",
            },
        ),
        ("resend_code_api", {"username": "newuser2026"}),
        (
            "forgot_password_api",
            {"username": "newuser2026", "email": "new.user@example.com"},
        ),
    ],
)
def test_public_auth_endpoints_cannot_bypass_enabled_turnstile(
    monkeypatch,
    handler_name,
    payload,
):
    from backend.auth import otp_routes

    _enable_local_turnstile(monkeypatch)

    async def allow_rate_limit(*_args, **_kwargs):
        return SimpleNamespace(allowed=True, remaining=4)

    class Request:
        headers = {}
        client = SimpleNamespace(host="127.0.0.1")

        async def json(self):
            return payload

    monkeypatch.setattr(otp_routes, "_rate_limit_decision", allow_rate_limit)
    response = asyncio.run(getattr(otp_routes, handler_name)(Request()))

    assert response.status_code == 403
    assert json.loads(response.body)["code"] == "BOT_CHALLENGE_REQUIRED"


def test_login_requires_turnstile_after_configured_prior_attempts(monkeypatch):
    from backend.auth import auth_routes

    _enable_local_turnstile(monkeypatch)

    async def rate_limit_attempt(function, *_args, **_kwargs):
        decision = SimpleNamespace(allowed=True, remaining=1)
        if function is auth_routes._load_login_user_with_rate_limit:
            return decision, None
        return decision

    class Request:
        headers = {}
        client = SimpleNamespace(host="127.0.0.1")

        async def json(self):
            return {
                "username": "existing-user",
                "password": "not-checked-before-challenge",
                "remember": False,
            }

    monkeypatch.setattr(auth_routes, "run_database_write", rate_limit_attempt)
    response = asyncio.run(auth_routes.login_api(Request()))

    assert response.status_code == 403
    assert json.loads(response.body)["code"] == "BOT_CHALLENGE_REQUIRED"


def test_login_requires_turnstile_immediately_for_matching_edge_risk_signal(
    monkeypatch,
):
    from backend.auth import auth_routes

    _enable_local_turnstile(monkeypatch)
    monkeypatch.setenv(
        "TURNSTILE_EDGE_CHALLENGE_HEADER",
        "X-BiddingFlow-Edge-Risk",
    )
    monkeypatch.setenv("TURNSTILE_EDGE_CHALLENGE_VALUE", "challenge")

    async def first_rate_limit_attempt(function, *_args, **_kwargs):
        decision = SimpleNamespace(allowed=True, remaining=4)
        if function is auth_routes._load_login_user_with_rate_limit:
            return decision, None
        return decision

    class Request:
        headers = Headers({"X-BiddingFlow-Edge-Risk": "challenge"})
        client = SimpleNamespace(host="127.0.0.1")

        async def json(self):
            return {
                "username": "existing-user",
                "password": "not-checked-before-challenge",
                "remember": False,
            }

    monkeypatch.setattr(
        auth_routes,
        "run_database_write",
        first_rate_limit_attempt,
    )
    response = asyncio.run(auth_routes.login_api(Request()))

    assert response.status_code == 403
    assert json.loads(response.body)["code"] == "BOT_CHALLENGE_REQUIRED"


def test_email_verification_requires_turnstile_after_repeated_attempts(monkeypatch):
    from backend.auth import otp_routes

    _enable_local_turnstile(monkeypatch)

    async def rate_limit_attempt(*_args, **_kwargs):
        return SimpleNamespace(allowed=True, remaining=1)

    class Request:
        headers = {}
        client = SimpleNamespace(host="127.0.0.1")

        async def json(self):
            return {"username": "existing-user", "code": "000000"}

    monkeypatch.setattr(otp_routes, "_rate_limit_decision", rate_limit_attempt)
    response = asyncio.run(otp_routes.verify_email_api(Request()))

    assert response.status_code == 403
    assert json.loads(response.body)["code"] == "BOT_CHALLENGE_REQUIRED"


def test_adaptive_login_challenge_starts_after_prior_attempt_threshold():
    from backend.auth import auth_routes

    before_threshold = SimpleNamespace(remaining=2)
    after_threshold = SimpleNamespace(remaining=1)

    assert auth_routes._login_challenge_required(before_threshold) is False
    assert auth_routes._login_challenge_required(after_threshold) is True


def test_index_bootstrap_exposes_only_public_turnstile_configuration(monkeypatch):
    from backend import app as app_module

    _enable_local_turnstile(monkeypatch)
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    monkeypatch.setattr(app_module, "_compiled_html_cache_signature", None)
    monkeypatch.setattr(app_module, "_index_response_cache", None)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "APP_DEBUG", True)

    html_content, _etag = app_module._build_index_response_payload()

    assert 'name="bf-turnstile-enabled" content="true"' in html_content
    assert (
        f'name="bf-turnstile-site-key" content="{LOCAL_TEST_ENV["TURNSTILE_SITE_KEY"]}"'
        in html_content
    )
    assert LOCAL_TEST_ENV["TURNSTILE_SECRET_KEY"] not in html_content
    assert "__TURNSTILE_" not in html_content


def test_index_bootstrap_runs_normally_with_incomplete_auto_configuration(
    monkeypatch,
):
    from backend import app as app_module

    monkeypatch.setenv("TURNSTILE_ENABLED", "auto")
    monkeypatch.setenv("TURNSTILE_SITE_KEY", "")
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "")
    monkeypatch.setenv("TURNSTILE_ALLOWED_HOSTNAMES", "")
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    monkeypatch.setattr(app_module, "_compiled_html_cache_signature", None)
    monkeypatch.setattr(app_module, "_index_response_cache", None)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "APP_DEBUG", True)

    html_content, _etag = app_module._build_index_response_payload()

    assert 'name="bf-turnstile-enabled" content="false"' in html_content
    assert 'name="bf-turnstile-site-key" content=""' in html_content
    assert "__TURNSTILE_" not in html_content


def test_turnstile_outcomes_are_exported_as_low_cardinality_metrics(monkeypatch):
    from backend.observability import metrics

    metrics._reset_metrics_for_tests()

    def unavailable_filesystem_metrics():
        raise OSError("filesystem metrics are outside this unit-test boundary")

    monkeypatch.setattr(
        metrics,
        "_filesystem_metrics",
        unavailable_filesystem_metrics,
    )

    async def fake_blocking_call(*_args, **_kwargs):
        return {"success": True, "hostname": "localhost", "action": "register"}

    monkeypatch.setattr(turnstile, "run_blocking_io", fake_blocking_call)
    asyncio.run(
        turnstile.verify_turnstile_token(
            "token-value",
            expected_action="register",
            remote_ip="127.0.0.1",
            environ=LOCAL_TEST_ENV,
        )
    )
    asyncio.run(
        turnstile.verify_turnstile_token(
            "",
            expected_action="forgot_password",
            remote_ip="127.0.0.1",
            environ=LOCAL_TEST_ENV,
        )
    )

    rendered = metrics.render_prometheus()

    assert 'biddingflow_turnstile_validations_total{action="register",outcome="passed"} 1' in rendered
    assert 'biddingflow_turnstile_validations_total{action="forgot_password",outcome="required"} 1' in rendered
