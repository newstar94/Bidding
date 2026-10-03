"""Fail-closed preflight for the production edge and bot-defense topology."""

from __future__ import annotations

import argparse
import ipaddress
import re
import shlex
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.security.turnstile import (
    TurnstileConfigurationError,
    get_turnstile_config,
)
from backend.startup import (
    StartupValidationError,
    validate_database_connection_budget,
    validate_http_resource_limits,
)


PLACEHOLDER_PATTERN = re.compile(
    r"(?:REPLACE_WITH_|yourdomain\.com|replace-with-|example\.(?:com|internal))",
    re.IGNORECASE,
)
LOCAL_HOSTNAMES = frozenset({"localhost", "127.0.0.1", "::1"})


class SecurityDeploymentError(ValueError):
    """Raised when production security configuration is incomplete or unsafe."""


def parse_environment_file(path: Path) -> dict[str, str]:
    """Parse a systemd-style environment file without evaluating shell syntax."""

    environment: dict[str, str] = {}
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8-sig").splitlines(),
        start=1,
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise SecurityDeploymentError(
                f"{path}:{line_number}: expected KEY=VALUE."
            )
        name, raw_value = line.split("=", 1)
        name = name.strip()
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
            raise SecurityDeploymentError(
                f"{path}:{line_number}: invalid environment variable name."
            )
        if name in environment:
            raise SecurityDeploymentError(
                f"{path}:{line_number}: duplicate environment variable {name}."
            )
        value = raw_value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        environment[name] = value
    return environment


def _csv(value: str) -> list[str]:
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


def _require_no_placeholders(values: dict[str, str], names: tuple[str, ...]) -> None:
    for name in names:
        value = str(values.get(name, "")).strip()
        if not value:
            raise SecurityDeploymentError(f"{name} is required for production.")
        if PLACEHOLDER_PATTERN.search(value):
            raise SecurityDeploymentError(
                f"{name} still contains a deployment placeholder."
            )


def validate_production_environment(
    environment: dict[str, str],
    *,
    postgres_max_connections: int,
) -> dict[str, object]:
    """Validate cross-file production invariants without exposing credentials."""

    required = (
        "APP_PUBLIC_URL",
        "ALLOWED_HOSTS",
        "CORS_ORIGINS",
        "ALLOWED_WS_ORIGINS",
        "TRUSTED_PROXY_CIDRS",
    )
    if str(environment.get("APP_ENV", "")).strip().casefold() not in {
        "prod",
        "production",
    }:
        raise SecurityDeploymentError("APP_ENV must be production.")
    _require_no_placeholders(environment, required)

    public_url = str(environment["APP_PUBLIC_URL"]).strip().rstrip("/")
    try:
        parsed = urlsplit(public_url)
        public_port = parsed.port
    except ValueError as exc:
        raise SecurityDeploymentError(
            "APP_PUBLIC_URL is not a valid HTTPS origin."
        ) from exc
    hostname = str(parsed.hostname or "").rstrip(".").casefold()
    if (
        parsed.scheme != "https"
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or public_port not in {None, 443}
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or hostname in LOCAL_HOSTNAMES
    ):
        raise SecurityDeploymentError(
            "APP_PUBLIC_URL must be one public HTTPS origin without a path."
        )
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise SecurityDeploymentError(
            "APP_PUBLIC_URL must use the production domain, not a raw IP address."
        )

    exact_origin = f"https://{hostname}"
    if public_port == 443:
        exact_origin += ":443"
    expected = {
        "ALLOWED_HOSTS": [hostname],
        "CORS_ORIGINS": [exact_origin],
        "ALLOWED_WS_ORIGINS": [exact_origin],
    }
    for name, expected_values in expected.items():
        actual = [value.casefold() for value in _csv(environment[name])]
        if actual != expected_values:
            raise SecurityDeploymentError(
                f"{name} must contain only the exact production origin/hostname."
            )
    turnstile_hostnames = str(
        environment.get("TURNSTILE_ALLOWED_HOSTNAMES", "")
    ).strip()
    if turnstile_hostnames and [
        value.casefold() for value in _csv(turnstile_hostnames)
    ] != [hostname]:
        raise SecurityDeploymentError(
            "TURNSTILE_ALLOWED_HOSTNAMES must contain only the exact production hostname."
        )

    try:
        trusted_proxies = {
            ipaddress.ip_network(item, strict=False)
            for item in _csv(environment["TRUSTED_PROXY_CIDRS"])
        }
    except ValueError as exc:
        raise SecurityDeploymentError(
            "TRUSTED_PROXY_CIDRS contains an invalid network."
        ) from exc
    expected_proxies = {
        ipaddress.ip_network("127.0.0.1/32"),
        ipaddress.ip_network("::1/128"),
    }
    if trusted_proxies != expected_proxies:
        raise SecurityDeploymentError(
            "TRUSTED_PROXY_CIDRS must trust only same-host NGINX loopback peers."
        )

    try:
        turnstile = get_turnstile_config(environment)
        resource_limits = validate_http_resource_limits(environment)
        database_budget = validate_database_connection_budget(
            postgres_max_connections,
            environment,
        )
    except (TurnstileConfigurationError, StartupValidationError) as exc:
        raise SecurityDeploymentError(str(exc)) from exc
    return {
        "hostname": hostname,
        "turnstile_enabled": turnstile.enabled,
        "turnstile_diagnostic": turnstile.diagnostic_code,
        "resource_limits": resource_limits,
        "database_budget": database_budget,
    }


def _read_checked(path: Path) -> str:
    content = path.read_text(encoding="utf-8-sig")
    if PLACEHOLDER_PATTERN.search(content):
        raise SecurityDeploymentError(f"{path} still contains a deployment placeholder.")
    return content


def validate_cloudflared_config(path: Path, *, hostname: str) -> None:
    content = _read_checked(path)
    required_patterns = (
        (r"(?m)^tunnel:\s*[0-9a-fA-F-]{16,}\s*$", "a concrete tunnel ID"),
        (r"(?m)^credentials-file:\s*/\S+\.json\s*$", "an absolute credential file"),
        (
            rf"(?m)^\s*-\s+hostname:\s*{re.escape(hostname)}\s*$",
            "the exact production hostname",
        ),
        (
            r"(?m)^\s+service:\s*http://127\.0\.0\.1:8080\s*$",
            "the loopback NGINX service",
        ),
        (
            rf"(?m)^\s+httpHostHeader:\s*{re.escape(hostname)}\s*$",
            "the exact origin Host header",
        ),
    )
    for pattern, description in required_patterns:
        if not re.search(pattern, content):
            raise SecurityDeploymentError(
                f"{path} must configure {description}."
            )
    service_lines = re.findall(r"(?m)^\s*-?\s*service:\s*(\S+)\s*$", content)
    if not service_lines or service_lines[-1] != "http_status:404":
        raise SecurityDeploymentError(
            f"{path} must end ingress with a fail-closed http_status:404 service."
        )


def validate_nginx_config(path: Path) -> None:
    content = _read_checked(path)
    required = (
        "listen 127.0.0.1:8080 default_server;",
        "set_real_ip_from 127.0.0.1;",
        "real_ip_header CF-Connecting-IP;",
        "server 127.0.0.1:8000;",
        "limit_req zone=bf_auth",
        "limit_req zone=bf_api",
        "limit_conn bf_per_ip",
    )
    for fragment in required:
        if fragment not in content:
            raise SecurityDeploymentError(f"{path} is missing: {fragment}")
    if re.search(r"(?m)^\s*listen\s+(?:0\.0\.0\.0|\[?::\]?|80|443)(?::|\s)", content):
        raise SecurityDeploymentError(
            f"{path} exposes a public/wildcard listener instead of loopback."
        )


def validate_systemd_unit(path: Path) -> None:
    content = _read_checked(path)
    if "EnvironmentFile=" not in content:
        raise SecurityDeploymentError(f"{path} must load a protected environment file.")
    commands = []
    section = ""
    pending = ""
    for raw_line in content.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith(("#", ";")):
            continue
        line = pending + stripped
        if line.endswith("\\"):
            pending = line[:-1] + " "
            continue
        pending = ""
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
        elif section == "Service" and "=" in line:
            name, value = line.split("=", 1)
            if name.strip() == "ExecStart":
                if value.strip():
                    commands.append(value.strip())
                else:
                    commands.clear()
    if pending or len(commands) != 1:
        raise SecurityDeploymentError(f"{path} must define one effective ExecStart command.")
    if "\\" in commands[0] or "%" in commands[0]:
        raise SecurityDeploymentError("Unsupported dynamic/escaped systemd ExecStart syntax.")
    try:
        arguments = shlex.split(commands[0], posix=True)
    except ValueError as exc:
        raise SecurityDeploymentError("Invalid systemd ExecStart quoting.") from exc
    if "--" in arguments:
        arguments = arguments[:arguments.index("--")]
    required_values = {
        "--host": "127.0.0.1",
        "--workers": "${UVICORN_WORKERS}",
        "--limit-concurrency": "${UVICORN_LIMIT_CONCURRENCY}",
        "--backlog": "${UVICORN_BACKLOG}",
        "--timeout-keep-alive": "${UVICORN_TIMEOUT_KEEP_ALIVE}",
        "--limit-max-requests": "${UVICORN_MAX_REQUESTS}",
        "--limit-max-requests-jitter": "${UVICORN_MAX_REQUESTS_JITTER}",
        "--ws-max-size": "${UVICORN_WS_MAX_SIZE}",
        "--ws-max-queue": "${UVICORN_WS_MAX_QUEUE}",
    }
    for option, expected in required_values.items():
        matches = [(index, argument) for index, argument in enumerate(arguments)
                   if argument.partition("=")[0] == option]
        if len(matches) > 1:
            raise SecurityDeploymentError(f"{path} ExecStart has duplicate {option} options.")
        actual = ""
        if matches:
            index, argument = matches[0]
            if "=" in argument:
                actual = argument.split("=", 1)[1]
            elif index + 1 < len(arguments):
                actual = arguments[index + 1]
        if actual != expected:
            raise SecurityDeploymentError(f"{path} ExecStart is missing: {option} {expected}")
    proxy_options = [argument for argument in arguments
                     if argument.partition("=")[0] in {"--proxy-headers", "--no-proxy-headers"}]
    if len(proxy_options) > 1:
        raise SecurityDeploymentError(f"{path} ExecStart has duplicate proxy-header options.")
    if proxy_options != ["--no-proxy-headers"]:
        raise SecurityDeploymentError(f"{path} ExecStart is missing: --no-proxy-headers")
    supported_expansions = set(required_values.values()) | {
        f"{option}={value}" for option, value in required_values.items()
    }
    if any("$" in argument and argument not in supported_expansions for argument in arguments):
        raise SecurityDeploymentError("Unsupported dynamic systemd ExecStart arguments.")


def resolve_systemd_environment(unit_path: Path, environment_file: Path) -> dict[str, str]:
    """Resolve static Service defaults and ordered EnvironmentFile overrides.

    Parsing never evaluates shell code or borrows the preflight shell's values.
    Dynamic manager/specifier inputs require an explicit deployed configuration.
    """
    defaults: dict[str, str] = {}
    files: list[tuple[Path, bool]] = []
    unset: list[str] = []
    section = ""
    pending = ""
    for raw_line in _read_checked(unit_path).splitlines():
        line = pending + raw_line.strip()
        if not line or line.startswith(("#", ";")):
            continue
        if line.endswith("\\"):
            pending = line[:-1] + " "
            continue
        pending = ""
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
            continue
        if section != "Service" or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name, value = name.strip(), value.strip()
        if name not in {"Environment", "EnvironmentFile", "UnsetEnvironment", "PassEnvironment"}:
            continue
        if name == "PassEnvironment" and value:
            raise SecurityDeploymentError("PassEnvironment requires deployed manager environment evidence.")
        if "\\" in value or "%" in value:
            raise SecurityDeploymentError("Unsupported dynamic/escaped systemd environment syntax.")
        try:
            words = shlex.split(value, posix=True)
        except ValueError as exc:
            raise SecurityDeploymentError("Invalid systemd environment quoting.") from exc
        if name == "Environment":
            if not words:
                defaults.clear()
            for assignment in words:
                key, separator, configured = assignment.partition("=")
                if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
                    raise SecurityDeploymentError("Invalid systemd Environment assignment.")
                defaults[key] = configured
        elif name == "EnvironmentFile":
            if not words:
                files.clear()
            for configured in words:
                optional = configured.startswith("-")
                path = Path(configured[1:] if optional else configured)
                if not path.is_absolute() or any(char in str(path) for char in "*?[]"):
                    raise SecurityDeploymentError("EnvironmentFile must be an explicit absolute path.")
                files.append((path.resolve(), optional))
        elif name == "UnsetEnvironment":
            if not words:
                unset.clear()
            unset.extend(words)
    if pending:
        raise SecurityDeploymentError("Unterminated systemd environment continuation.")
    configured_file = environment_file.resolve()
    if configured_file not in {path for path, _optional in files}:
        raise SecurityDeploymentError("--environment-file is not loaded by the supplied systemd unit.")
    effective = dict(defaults)
    for path, optional in files:
        if optional and not path.exists():
            continue
        effective.update(parse_environment_file(path))
    for assignment in unset:
        key, separator, value = assignment.partition("=")
        if not separator or effective.get(key) == value:
            effective.pop(key, None)
    return effective


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate production DDoS/Turnstile deployment configuration.",
    )
    parser.add_argument("--environment-file", type=Path, required=True)
    parser.add_argument("--cloudflared-config", type=Path, required=True)
    parser.add_argument("--nginx-config", type=Path, required=True)
    parser.add_argument("--systemd-unit", type=Path, required=True)
    parser.add_argument("--postgres-max-connections", type=int, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_argument_parser().parse_args(argv)
    try:
        validate_systemd_unit(args.systemd_unit)
        environment = resolve_systemd_environment(args.systemd_unit, args.environment_file)
        result = validate_production_environment(
            environment,
            postgres_max_connections=args.postgres_max_connections,
        )
        hostname = str(result["hostname"])
        validate_cloudflared_config(args.cloudflared_config, hostname=hostname)
        validate_nginx_config(args.nginx_config)
    except (OSError, SecurityDeploymentError) as exc:
        print(f"Security deployment preflight failed: {exc}", file=sys.stderr)
        return 1

    database_budget = result["database_budget"]
    turnstile_status = (
        "active"
        if result["turnstile_enabled"]
        else result["turnstile_diagnostic"] or "disabled"
    )
    print(
        "Security deployment preflight passed "
        f"for {hostname}; PostgreSQL budget "
        f"{database_budget['total']}/{args.postgres_max_connections}; "
        f"Turnstile {turnstile_status}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
