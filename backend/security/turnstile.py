"""Cloudflare Turnstile configuration and fail-closed server validation."""

from __future__ import annotations

import json
import os
import re
import secrets
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from urllib.parse import urlparse

from starlette.responses import JSONResponse

from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError, run_blocking_io
from backend.shared.safe_http import open_allowlisted_https


TURNSTILE_HOST = "challenges.cloudflare.com"
TURNSTILE_SITEVERIFY_URL = f"https://{TURNSTILE_HOST}/turnstile/v0/siteverify"
_TRUTHY = frozenset({"1", "true", "yes", "on"})
_FALSY = frozenset({"", "0", "false", "no", "off"})
_LOCAL_HOSTNAMES = frozenset({"localhost", "127.0.0.1", "::1"})
_TEST_SITE_KEYS = frozenset({
    "1x00000000000000000000AA",
    "2x00000000000000000000AB",
    "1x00000000000000000000BB",
    "2x00000000000000000000BB",
    "3x00000000000000000000FF",
})
_TEST_SECRET_KEYS = frozenset({
    "1x0000000000000000000000000000000AA",
    "2x0000000000000000000000000000000AA",
    "3x0000000000000000000000000000000AA",
})


class TurnstileConfigurationError(ValueError):
    """Raised when Turnstile is enabled with an unsafe or incomplete setup."""


@dataclass(frozen=True)
class TurnstileConfig:
    enabled: bool
    mode: str = "off"
    diagnostic_code: str = ""
    site_key: str = ""
    secret_key: str = field(default="", repr=False)
    allowed_hostnames: frozenset[str] = frozenset()
    timeout_seconds: float = 5.0
    testing: bool = False
    edge_challenge_header: str = ""
    edge_challenge_value: str = field(default="", repr=False)


@dataclass(frozen=True)
class TurnstileDecision:
    allowed: bool
    code: str
    unavailable: bool = False


def _record_validation(action: str, outcome: str) -> None:
    from backend.observability.metrics import record_turnstile_validation

    record_turnstile_validation(action, outcome)


def _is_production(environ) -> bool:
    return str(environ.get("APP_ENV", "development")).strip().casefold() in {
        "prod",
        "production",
    }


def _mode(environ) -> str:
    value = str(environ.get("TURNSTILE_ENABLED", "false")).strip().casefold()
    if value in _TRUTHY:
        return "required"
    if value in _FALSY:
        return "off"
    if value == "auto":
        return "auto"
    raise TurnstileConfigurationError(
        "TURNSTILE_ENABLED must be false, auto, or true."
    )


def _normalize_hostname(value: str) -> str:
    return str(value or "").strip().rstrip(".").casefold()


def _parse_hostnames(raw_value: str) -> frozenset[str]:
    values = frozenset(
        _normalize_hostname(value)
        for value in str(raw_value or "").split(",")
        if str(value).strip()
    )
    for hostname in values:
        if (
            not hostname
            or "*" in hostname
            or "://" in hostname
            or "/" in hostname
            or ":" in hostname and hostname != "::1"
            or len(hostname) > 253
        ):
            raise TurnstileConfigurationError(
                "TURNSTILE_ALLOWED_HOSTNAMES must contain exact hostnames only."
            )
    return values


def _get_enabled_turnstile_config(environ, *, mode: str) -> TurnstileConfig:
    site_key = str(environ.get("TURNSTILE_SITE_KEY", "")).strip()
    secret_key = str(environ.get("TURNSTILE_SECRET_KEY", "")).strip()
    hostnames = _parse_hostnames(environ.get("TURNSTILE_ALLOWED_HOSTNAMES", ""))
    edge_challenge_header = str(
        environ.get("TURNSTILE_EDGE_CHALLENGE_HEADER", "")
    ).strip()
    edge_challenge_value = str(
        environ.get("TURNSTILE_EDGE_CHALLENGE_VALUE", "")
    ).strip()
    try:
        timeout_seconds = float(
            str(environ.get("TURNSTILE_VERIFY_TIMEOUT_SECONDS", "5")).strip()
        )
    except (TypeError, ValueError) as exc:
        raise TurnstileConfigurationError(
            "TURNSTILE_VERIFY_TIMEOUT_SECONDS must be numeric."
        ) from exc
    if not 1.0 <= timeout_seconds <= 10.0:
        raise TurnstileConfigurationError(
            "TURNSTILE_VERIFY_TIMEOUT_SECONDS must be between 1 and 10 seconds."
        )
    if not site_key or len(site_key) > 128:
        raise TurnstileConfigurationError(
            "TURNSTILE_SITE_KEY is required when Turnstile is enabled."
        )
    if not secret_key or len(secret_key) > 256:
        raise TurnstileConfigurationError(
            "TURNSTILE_SECRET_KEY is required when Turnstile is enabled."
        )
    if not hostnames:
        raise TurnstileConfigurationError(
            "TURNSTILE_ALLOWED_HOSTNAMES is required when Turnstile is enabled."
        )
    if bool(edge_challenge_header) != bool(edge_challenge_value):
        raise TurnstileConfigurationError(
            "TURNSTILE_EDGE_CHALLENGE_HEADER and TURNSTILE_EDGE_CHALLENGE_VALUE "
            "must be configured together."
        )
    if edge_challenge_header and (
        not re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,62}", edge_challenge_header)
        or edge_challenge_header.casefold()
        in {
            "authorization",
            "cookie",
            "forwarded",
            "host",
            "x-forwarded-for",
            "x-forwarded-host",
            "x-forwarded-proto",
        }
    ):
        raise TurnstileConfigurationError(
            "TURNSTILE_EDGE_CHALLENGE_HEADER must be a dedicated safe HTTP header."
        )
    if len(edge_challenge_value) > 128 or any(
        character in edge_challenge_value for character in "\r\n\0"
    ):
        raise TurnstileConfigurationError(
            "TURNSTILE_EDGE_CHALLENGE_VALUE must be a safe value of at most 128 characters."
        )

    production = _is_production(environ)
    uses_test_site_key = site_key in _TEST_SITE_KEYS
    uses_test_secret_key = secret_key in _TEST_SECRET_KEYS
    if uses_test_site_key != uses_test_secret_key:
        raise TurnstileConfigurationError(
            "Turnstile test site and secret keys must be used together."
        )
    testing = uses_test_site_key and uses_test_secret_key
    if testing and not hostnames.issubset(_LOCAL_HOSTNAMES):
        raise TurnstileConfigurationError(
            "Cloudflare Turnstile test keys are restricted to local hostnames."
        )
    if production:
        if hostnames & _LOCAL_HOSTNAMES:
            raise TurnstileConfigurationError(
                "Production Turnstile hostnames cannot include local addresses."
            )
        if site_key in _TEST_SITE_KEYS or secret_key in _TEST_SECRET_KEYS:
            raise TurnstileConfigurationError(
                "Cloudflare Turnstile test keys cannot be used in production."
            )
        public_hostname = _normalize_hostname(
            urlparse(str(environ.get("APP_PUBLIC_URL", ""))).hostname or ""
        )
        if not public_hostname or public_hostname not in hostnames:
            raise TurnstileConfigurationError(
                "TURNSTILE_ALLOWED_HOSTNAMES must include APP_PUBLIC_URL's hostname."
            )

    return TurnstileConfig(
        enabled=True,
        mode=mode,
        site_key=site_key,
        secret_key=secret_key,
        allowed_hostnames=hostnames,
        timeout_seconds=timeout_seconds,
        testing=testing,
        edge_challenge_header=edge_challenge_header,
        edge_challenge_value=edge_challenge_value,
    )


def get_turnstile_config(environ=None) -> TurnstileConfig:
    """Return strict or auto-optional environment-owned configuration."""

    environ = os.environ if environ is None else environ
    mode = _mode(environ)
    if mode == "off":
        return TurnstileConfig(enabled=False, mode=mode)
    if mode == "auto" and not all(
        str(environ.get(name, "")).strip()
        for name in (
            "TURNSTILE_SITE_KEY",
            "TURNSTILE_SECRET_KEY",
            "TURNSTILE_ALLOWED_HOSTNAMES",
        )
    ):
        return TurnstileConfig(
            enabled=False,
            mode=mode,
            diagnostic_code="TURNSTILE_AUTO_INCOMPLETE",
        )
    try:
        return _get_enabled_turnstile_config(environ, mode=mode)
    except TurnstileConfigurationError:
        if mode != "auto":
            raise
        return TurnstileConfig(
            enabled=False,
            mode=mode,
            diagnostic_code="TURNSTILE_AUTO_INVALID",
        )


def public_turnstile_config(environ=None) -> dict[str, object]:
    """Return the non-secret browser configuration."""

    config = get_turnstile_config(environ)
    return {"enabled": config.enabled, "siteKey": config.site_key if config.enabled else ""}


def edge_challenge_required(request, environ=None) -> bool:
    """Return true only for an exact escalation-only edge risk marker."""

    config = get_turnstile_config(environ)
    if not config.enabled or not config.edge_challenge_header:
        return False
    supplied = str(request.headers.get(config.edge_challenge_header, "")).strip()
    return bool(supplied) and secrets.compare_digest(
        supplied,
        config.edge_challenge_value,
    )


def _verify_site_token(
    token: str,
    remote_ip: str,
    config: TurnstileConfig,
    idempotency_key: str,
) -> dict[str, object]:
    body = urllib.parse.urlencode({
        "secret": config.secret_key,
        "response": token,
        "remoteip": remote_ip,
        "idempotency_key": idempotency_key,
    }).encode("ascii")
    request = urllib.request.Request(
        TURNSTILE_SITEVERIFY_URL,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "BiddingFlow-Turnstile/1.0",
        },
    )
    with open_allowlisted_https(
        request,
        allowed_hosts={TURNSTILE_HOST},
        timeout=config.timeout_seconds,
    ) as response:
        payload = response.read(65_537)
    if len(payload) > 65_536:
        raise ValueError("Turnstile response exceeded the allowed size.")
    parsed = json.loads(payload.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Turnstile response was not a JSON object.")
    return parsed


async def verify_turnstile_token(
    token: str,
    *,
    expected_action: str,
    remote_ip: str,
    environ=None,
) -> TurnstileDecision:
    """Validate one single-use token and bind it to hostname and action."""

    config = get_turnstile_config(environ)
    if not config.enabled:
        return TurnstileDecision(True, "BOT_CHALLENGE_DISABLED")
    normalized_token = str(token or "").strip()
    if not normalized_token:
        _record_validation(expected_action, "required")
        return TurnstileDecision(False, "BOT_CHALLENGE_REQUIRED")
    if len(normalized_token) > 2_048:
        _record_validation(expected_action, "invalid")
        return TurnstileDecision(False, "BOT_CHALLENGE_INVALID")
    try:
        result = await run_blocking_io(
            _verify_site_token,
            normalized_token,
            str(remote_ip or ""),
            config,
            str(uuid.uuid4()),
            timeout_seconds=config.timeout_seconds + 1.0,
        )
    except (
        BlockingIOBusyError,
        BlockingIOTimeoutError,
        OSError,
        UnicodeError,
        ValueError,
    ):
        _record_validation(expected_action, "unavailable")
        return TurnstileDecision(
            False,
            "BOT_CHALLENGE_UNAVAILABLE",
            unavailable=True,
        )

    hostname = _normalize_hostname(result.get("hostname", ""))
    action = str(result.get("action", "")).strip()
    metadata = result.get("metadata")
    official_test_result = (
        config.testing
        and isinstance(metadata, dict)
        and metadata.get("result_with_testing_key") is True
    )
    if (
        result.get("success") is not True
        or not official_test_result
        and (
            hostname not in config.allowed_hostnames
            or action != expected_action
        )
    ):
        _record_validation(expected_action, "invalid")
        return TurnstileDecision(False, "BOT_CHALLENGE_INVALID")
    _record_validation(expected_action, "passed")
    return TurnstileDecision(True, "BOT_CHALLENGE_PASSED")


def turnstile_error_response(decision: TurnstileDecision) -> JSONResponse:
    messages = {
        "BOT_CHALLENGE_REQUIRED": "Vui lòng hoàn tất bước xác minh bảo mật.",
        "BOT_CHALLENGE_INVALID": "Phiên xác minh bảo mật không hợp lệ hoặc đã hết hạn.",
        "BOT_CHALLENGE_UNAVAILABLE": "Dịch vụ xác minh bảo mật đang tạm thời gián đoạn. Vui lòng thử lại.",
    }
    response = JSONResponse(
        {
            "error": messages.get(decision.code, "Không thể xác minh yêu cầu."),
            "code": decision.code,
            "challengeRequired": True,
        },
        status_code=503 if decision.unavailable else 403,
    )
    if decision.unavailable:
        response.headers["Retry-After"] = "1"
    return response


async def enforce_turnstile(
    request,
    data: dict[str, object],
    *,
    expected_action: str,
    required: bool = True,
):
    """Return an error response when an enabled challenge does not pass."""

    config = get_turnstile_config()
    if not config.enabled or not required:
        return None
    from backend.shared.client_ip import get_client_ip

    decision = await verify_turnstile_token(
        str(data.get("turnstileToken") or ""),
        expected_action=expected_action,
        remote_ip=get_client_ip(request),
    )
    from backend.shared.logging_utils import get_request_id, log_structured_event

    outcome = {
        "BOT_CHALLENGE_PASSED": "passed",
        "BOT_CHALLENGE_REQUIRED": "required",
        "BOT_CHALLENGE_INVALID": "invalid",
        "BOT_CHALLENGE_UNAVAILABLE": "unavailable",
    }.get(decision.code, "unknown")
    log_structured_event(
        "security.turnstile_validation",
        request_id=get_request_id(request),
        fields={"action": expected_action, "outcome": outcome},
        nonblocking=True,
    )
    return None if decision.allowed else turnstile_error_response(decision)
