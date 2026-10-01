#!/usr/bin/env python3
"""Fail-closed, read-only post-cutover smoke checks.

This script is shipped with each production artifact.  It deliberately does
not create users, write business records, enqueue exports, or alter the
deployment.  A staging/production operator supplies a dedicated smoke
account (or a short-lived session cookie) and an already-existing record path
that the account is allowed to read.

The script is intentionally configuration driven.  It must never turn a
missing credential or missing record path into a passing "health-only" run.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import ipaddress
import json
import os
import re
import stat
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import (
    HTTPRedirectHandler,
    HTTPCookieProcessor,
    Request,
    build_opener,
)


SCRIPT_VERSION = "1.1.0"
DEFAULT_TIMEOUT_SECONDS = 10.0
MAX_TIMEOUT_SECONDS = 120.0
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_SECRET_FILE_BYTES = 16 * 1024
MAX_REQUEST_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 0.15
SAFE_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "testserver"}
SENSITIVE_QUERY_PARTS = (
    "token",
    "secret",
    "password",
    "passwd",
    "cookie",
    "authorization",
    "api_key",
    "apikey",
    "key",
)
PATH_RE = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:@%/\-?#[\]]*$")
IMMUTABLE_RELEASE_ID = re.compile(r"^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$")
RELEASE_IDENTITY_PATH = "/api/admin/system/version"


class SmokeConfigurationError(ValueError):
    """The smoke run is not safe to start with the supplied configuration."""


class SmokeCheckError(RuntimeError):
    """A required smoke assertion failed."""


@dataclass(frozen=True)
class ResponseSnapshot:
    status: int
    content_type: str
    body: bytes
    headers: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Probe:
    name: str
    path: str
    expected_status: frozenset[int]
    expected_content_type: str | None = None
    authenticated: bool = True
    headers: dict[str, str] | None = None


class _NoRedirect(HTTPRedirectHandler):
    """Do not follow redirects to an unexpected host or protocol."""

    def redirect_request(self, request, fp, code, msg, headers, newurl):  # noqa: D401
        del request, fp, code, msg, headers, newurl
        return None


def _env(name: str, *, required: bool = False, default: str = "") -> str:
    value = str(os.environ.get(name, default) or "").strip()
    if required and not value:
        raise SmokeConfigurationError(f"Thiếu biến môi trường bắt buộc: {name}")
    return value


def _read_secret_file(path_value: str, variable_name: str) -> str:
    path = Path(path_value).expanduser()
    try:
        info = path.stat()
    except OSError as error:
        raise SmokeConfigurationError(
            f"Không đọc được file bí mật {variable_name}"
        ) from error
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_SECRET_FILE_BYTES:
        raise SmokeConfigurationError(f"File {variable_name} không hợp lệ")
    try:
        value = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError) as error:
        raise SmokeConfigurationError(
            f"Không đọc được file bí mật {variable_name}"
        ) from error
    if not value or "\r" in value or "\n" in value:
        raise SmokeConfigurationError(f"File {variable_name} rỗng hoặc chứa ký tự không hợp lệ")
    return value


def _validate_base_url(raw_value: str) -> str:
    value = str(raw_value or "").strip()
    if not value:
        raise SmokeConfigurationError(
            "Cần truyền base URL hoặc đặt SMOKE_BASE_URL/DEPLOY_SMOKE_BASE_URL"
        )
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise SmokeConfigurationError("Base URL phải là HTTP(S) URL hợp lệ")
    if parsed.username or parsed.password:
        raise SmokeConfigurationError("Base URL không được chứa username/password")
    host = (parsed.hostname or "").casefold().rstrip(".")
    local_or_test = (
        host in SAFE_LOCAL_HOSTS
        or host.endswith(".test")
        or host.endswith(".localhost")
    )
    if parsed.scheme != "https" and not local_or_test:
        raise SmokeConfigurationError(
            "Smoke production/staging bắt buộc HTTPS; HTTP chỉ được phép trên loopback/test"
        )
    clean_path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc, clean_path, "", ""))


def _validate_path(raw_value: str, variable_name: str) -> str:
    value = str(raw_value or "").strip()
    if not value or not PATH_RE.fullmatch(value) or not value.startswith("/"):
        raise SmokeConfigurationError(
            f"{variable_name} phải là path tương đối bắt đầu bằng '/'; không dùng URL ngoài origin"
        )
    return value


def _validate_health_base_url(raw_value: str) -> str:
    """Permit host-local health checks without exposing them at public ingress."""
    value = str(raw_value or "").strip()
    try:
        parsed = urlsplit(value)
        address = ipaddress.ip_address(parsed.hostname or "")
        valid = (
            address.is_loopback and parsed.scheme in {"http", "https"}
            and not parsed.username and not parsed.password
            and parsed.path in {"", "/"} and not parsed.query and not parsed.fragment
            and (parsed.port is None or 0 < parsed.port <= 65535)
        )
    except ValueError:
        valid = False
    if not valid:
        raise SmokeConfigurationError(
            "SMOKE_HEALTH_BASE_URL phải là HTTP(S) origin IP loopback, không có path/query/credential"
        )
    return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


def _status_set(raw_value: str, variable_name: str, default: Iterable[int]) -> frozenset[int]:
    value = str(raw_value or "").strip()
    if not value:
        return frozenset(default)
    try:
        statuses = frozenset(int(item.strip()) for item in value.split(","))
    except ValueError as error:
        raise SmokeConfigurationError(f"{variable_name} chứa HTTP status không hợp lệ") from error
    if not statuses or any(status < 100 or status > 599 for status in statuses):
        raise SmokeConfigurationError(f"{variable_name} chứa HTTP status không hợp lệ")
    return statuses


def _validate_release_id(raw_value: str, variable_name: str) -> str:
    value = str(raw_value or "").strip()
    if not IMMUTABLE_RELEASE_ID.fullmatch(value):
        raise SmokeConfigurationError(
            f"{variable_name} phải là release ID bất biến gồm 40 hoặc 64 ký tự hex"
        )
    return value


def _validate_header_name(raw_value: str, variable_name: str) -> str | None:
    value = str(raw_value or "").strip()
    if not value:
        return None
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,63}", value):
        raise SmokeConfigurationError(f"{variable_name} chứa tên header không hợp lệ")
    return value


def _safe_log_path(raw_value: str) -> Path | None:
    value = str(raw_value or "").strip()
    if not value:
        return None
    path = Path(value).expanduser()
    if path.is_dir():
        raise SmokeConfigurationError("SMOKE_LOG_FILE phải là file, không phải thư mục")
    return path


def _redacted_path(path: str) -> str:
    """Return a path without query values that could contain credentials."""

    parsed = urlsplit(path)
    if not parsed.query:
        return parsed.path or "/"
    safe_pairs: list[str] = []
    for pair in parsed.query.split("&"):
        key = pair.split("=", 1)[0].casefold().replace("-", "_")
        if any(part in key for part in SENSITIVE_QUERY_PARTS):
            safe_pairs.append(f"{pair.split('=', 1)[0]}=<redacted>")
        else:
            safe_pairs.append(pair)
    query = "&".join(safe_pairs)
    return urlunsplit(("", "", parsed.path or "/", query, ""))


def _parse_timeout() -> float:
    value = _env("SMOKE_TIMEOUT_SECONDS", default=str(DEFAULT_TIMEOUT_SECONDS))
    try:
        timeout = float(value)
    except ValueError as error:
        raise SmokeConfigurationError("SMOKE_TIMEOUT_SECONDS không hợp lệ") from error
    if timeout <= 0 or timeout > MAX_TIMEOUT_SECONDS:
        raise SmokeConfigurationError(
            f"SMOKE_TIMEOUT_SECONDS phải trong khoảng (0, {MAX_TIMEOUT_SECONDS}]"
        )
    return timeout


def _content_type(headers) -> str:
    return str(headers.get_content_type() or "").casefold()


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _scrub_log_value(value: str) -> str:
    # Never copy arbitrary response data or headers to the operator log.
    return " ".join(str(value).split())[:240]


class SmokeRunner:
    def __init__(
        self,
        *,
        base_url: str,
        timeout: float,
        cookie_value: str | None,
        username: str | None,
        password: str | None,
        log_path: Path | None,
    ) -> None:
        self.base_url = base_url
        self.timeout = timeout
        self.cookie_value = cookie_value
        self.username = username
        self.password = password
        self.log_path = log_path
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = build_opener(_NoRedirect, HTTPCookieProcessor(self.cookie_jar))

    def log(self, event: str, *, path: str = "", status: int | None = None) -> None:
        record = {
            "event": event,
            "path": _redacted_path(path) if path else "",
            "status": status,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        line = json.dumps(record, ensure_ascii=True, sort_keys=True)
        if self.log_path is not None:
            try:
                self.log_path.parent.mkdir(parents=True, exist_ok=True)
                with self.log_path.open("a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
            except OSError as error:
                raise SmokeCheckError("Không ghi được smoke log") from error
        print(f"[smoke] {event} {_redacted_path(path)}" + (f" ({status})" if status else ""))

    def _url(self, path: str) -> str:
        return self.base_url + path

    def request(
        self,
        *,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
        authenticated: bool = True,
    ) -> ResponseSnapshot:
        request_headers = {
            "Accept": "application/json, application/octet-stream, */*",
            "User-Agent": f"BiddingFlow-production-smoke/{SCRIPT_VERSION}",
        }
        if headers:
            request_headers.update(headers)
        if authenticated and self.cookie_value:
            request_headers["Cookie"] = self.cookie_value
        elif not authenticated:
            # CookieJar would otherwise attach the login cookie to a
            # deliberately unauthenticated negative probe.
            request_headers["Cookie"] = ""
        request = Request(
            self._url(path),
            data=body,
            headers=request_headers,
            method=method.upper(),
        )
        last_transport_error: BaseException | None = None
        for attempt in range(MAX_REQUEST_ATTEMPTS):
            try:
                with self.opener.open(request, timeout=self.timeout) as response:
                    data = response.read(MAX_RESPONSE_BYTES + 1)
                    if len(data) > MAX_RESPONSE_BYTES:
                        raise SmokeCheckError(f"Phản hồi quá lớn cho {path}")
                    return ResponseSnapshot(
                        status=int(response.status),
                        content_type=_content_type(response.headers),
                        body=data,
                        headers={str(key).casefold(): str(value) for key, value in response.headers.items()},
                    )
            except HTTPError as error:
                # Do not read or print the body: it may contain personal data or
                # an echoed credential.  The status alone is enough to fail closed
                # (and lets an explicitly configured negative probe assert 401/403).
                try:
                    content_type = _content_type(error.headers)
                finally:
                    error.close()
                return ResponseSnapshot(
                    status=int(error.code),
                    content_type=content_type,
                    body=b"",
                    headers={str(key).casefold(): str(value) for key, value in error.headers.items()}
                    if error.headers is not None else {},
                )
            except (URLError, TimeoutError, OSError) as error:
                last_transport_error = error
                if attempt + 1 < MAX_REQUEST_ATTEMPTS:
                    time.sleep(RETRY_DELAY_SECONDS * (attempt + 1))
                    continue
                break
        error_name = type(last_transport_error).__name__ if last_transport_error else "unknown"
        raise SmokeCheckError(
            f"Không kết nối được tới {_redacted_path(path)} ({error_name})"
        ) from last_transport_error

    def assert_probe(self, probe: Probe) -> ResponseSnapshot:
        try:
            snapshot = self.request(
                method="GET",
                path=probe.path,
                authenticated=probe.authenticated,
                headers=probe.headers,
            )
        except SmokeCheckError as error:
            self.log("failed", path=probe.path)
            raise error
        if snapshot.status not in probe.expected_status:
            self.log("failed", path=probe.path, status=snapshot.status)
            expected = ",".join(str(item) for item in sorted(probe.expected_status))
            raise SmokeCheckError(
                f"{probe.name} trả HTTP {snapshot.status}, cần {expected}"
            )
        if probe.expected_content_type and not snapshot.content_type.startswith(
            probe.expected_content_type.casefold()
        ):
            self.log("failed", path=probe.path, status=snapshot.status)
            raise SmokeCheckError(
                f"{probe.name} trả Content-Type không phù hợp"
            )
        self.log("passed", path=probe.path, status=snapshot.status)
        return snapshot

    def login(self, path: str) -> None:
        if self.cookie_value:
            self.log("session-cookie-configured", path=path)
            return
        if not self.username or self.password is None:
            raise SmokeConfigurationError("Thiếu tài khoản smoke hoặc session cookie")
        payload = _json_bytes({
            "username": self.username,
            "password": self.password,
            "remember": False,
        })
        try:
            snapshot = self.request(
                method="POST",
                path=path,
                body=payload,
                headers={"Content-Type": "application/json"},
                authenticated=False,
            )
        except SmokeCheckError as error:
            self.log("login-failed", path=path)
            raise error
        try:
            result = json.loads(snapshot.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            self.log("login-failed", path=path, status=snapshot.status)
            raise SmokeCheckError("Login không trả JSON hợp lệ") from error
        if snapshot.status < 200 or snapshot.status >= 300 or not isinstance(result, dict) or result.get("success") is not True:
            self.log("login-failed", path=path, status=snapshot.status)
            raise SmokeCheckError(f"Login thất bại (HTTP {snapshot.status})")
        self.log("login-passed", path=path, status=snapshot.status)

    def assert_session(self, path: str) -> None:
        body = _json_bytes({"remember": False})
        try:
            snapshot = self.request(
                method="POST",
                path=path,
                body=body,
                headers={"Content-Type": "application/json"},
                authenticated=True,
            )
        except SmokeCheckError as error:
            self.log("session-failed", path=path)
            raise error
        try:
            result = json.loads(snapshot.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            self.log("session-failed", path=path, status=snapshot.status)
            raise SmokeCheckError("Session check không trả JSON hợp lệ") from error
        if snapshot.status < 200 or snapshot.status >= 300 or not isinstance(result, dict) or result.get("valid") is not True:
            self.log("session-failed", path=path, status=snapshot.status)
            raise SmokeCheckError(f"Session không hợp lệ (HTTP {snapshot.status})")
        self.log("session-passed", path=path, status=snapshot.status)

    def assert_release_identity(self, path: str, expected_release_id: str) -> None:
        """Verify the running server exposes the immutable artifact identity.

        The endpoint is intentionally the existing authorized admin version
        surface.  We never accept a client-provided header or a local filename
        as proof that the process serving traffic is the candidate release.
        """

        try:
            snapshot = self.request(method="GET", path=path, authenticated=True)
        except SmokeCheckError as error:
            self.log("release-identity-failed", path=path)
            raise error
        if snapshot.status != 200 or not snapshot.content_type.startswith("application/json"):
            self.log("release-identity-failed", path=path, status=snapshot.status)
            if snapshot.status != 200:
                raise SmokeCheckError(
                    f"Release identity endpoint trả HTTP {snapshot.status}, cần 200"
                )
            raise SmokeCheckError("Release identity endpoint không trả JSON")
        try:
            payload = json.loads(snapshot.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            self.log("release-identity-failed", path=path, status=snapshot.status)
            raise SmokeCheckError("Release identity endpoint không trả JSON hợp lệ") from error
        actual_release_id = payload.get("releaseId") if isinstance(payload, dict) else None
        if actual_release_id != expected_release_id:
            self.log("release-identity-failed", path=path, status=snapshot.status)
            raise SmokeCheckError("Release identity trên máy chủ không khớp artifact mong đợi")
        self.log("release-identity-passed", path=path, status=snapshot.status)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="BiddingFlow post-cutover staging/production read-only smoke checks"
    )
    parser.add_argument("base_url", nargs="?", help="Base URL; prefer SMOKE_BASE_URL")
    parser.add_argument("--mode", choices=("deploy", "rollback"), default="deploy")
    parser.add_argument("--version", action="version", version=SCRIPT_VERSION)
    return parser


def _load_configuration(args: argparse.Namespace) -> dict[str, object]:
    base_url = _validate_base_url(
        args.base_url
        or _env("SMOKE_BASE_URL")
        or _env("DEPLOY_SMOKE_BASE_URL")
        or _env("ROLLBACK_SMOKE_BASE_URL")
    )
    timeout = _parse_timeout()
    cookie_file = _env("SMOKE_COOKIE_FILE")
    username = _env("SMOKE_USERNAME")
    password = os.environ.get("SMOKE_PASSWORD")
    if cookie_file and (username or password is not None):
        raise SmokeConfigurationError(
            "Chỉ cấu hình một trong SMOKE_COOKIE_FILE hoặc SMOKE_USERNAME/SMOKE_PASSWORD"
        )
    cookie_value = _read_secret_file(cookie_file, "SMOKE_COOKIE_FILE") if cookie_file else None
    if cookie_value is None and (not username or password is None or not password):
        raise SmokeConfigurationError(
            "Cần SMOKE_COOKIE_FILE hoặc đồng thời SMOKE_USERNAME và SMOKE_PASSWORD"
        )
    read_path = _validate_path(
        _env("SMOKE_READ_PATH") or _env("SMOKE_RECORD_PATH"),
        "SMOKE_READ_PATH",
    )
    sync_path = _validate_path(
        _env("SMOKE_SYNC_PATH", default="/api/sync-version"),
        "SMOKE_SYNC_PATH",
    )
    session_path = _validate_path(
        _env("SMOKE_SESSION_PATH", default="/api/auth/check-session"),
        "SMOKE_SESSION_PATH",
    )
    login_path = _validate_path(
        _env("SMOKE_LOGIN_PATH", default="/api/auth/login"),
        "SMOKE_LOGIN_PATH",
    )
    optional = {}
    for env_name, label in (
        ("SMOKE_WORD_PATH", "word"),
        ("SMOKE_EXCEL_PATH", "excel"),
    ):
        raw_path = _env(env_name)
        if raw_path:
            optional[label] = _validate_path(raw_path, env_name)
    negative_path = _env("SMOKE_NEGATIVE_PATH")
    if negative_path:
        negative_path = _validate_path(negative_path, "SMOKE_NEGATIVE_PATH")
    return {
        "base_url": base_url,
        "health_base_url": _validate_health_base_url(_env("SMOKE_HEALTH_BASE_URL"))
        if _env("SMOKE_HEALTH_BASE_URL") else None,
        "timeout": timeout,
        "cookie_value": cookie_value,
        "username": username or None,
        "password": password,
        "read_path": read_path,
        "sync_path": sync_path,
        "session_path": session_path,
        "login_path": login_path,
        "release_path": RELEASE_IDENTITY_PATH,
        "expected_release_id": _validate_release_id(
            _env("SMOKE_EXPECTED_RELEASE_ID"), "SMOKE_EXPECTED_RELEASE_ID"
        ),
        "optional": optional,
        "negative_path": negative_path,
        "negative_status": _status_set(
            _env("SMOKE_NEGATIVE_STATUS"), "SMOKE_NEGATIVE_STATUS", (401, 403)
        ),
        "log_path": _safe_log_path(_env("SMOKE_LOG_FILE")),
    }


def _run(config: dict[str, object], mode: str) -> int:
    runner = SmokeRunner(
        base_url=str(config["base_url"]),
        timeout=float(config["timeout"]),
        cookie_value=config["cookie_value"],  # type: ignore[arg-type]
        username=config["username"],  # type: ignore[arg-type]
        password=config["password"],  # type: ignore[arg-type]
        log_path=config["log_path"],  # type: ignore[arg-type]
    )
    runner.log(f"start-{mode}")
    health_runner = runner
    if config["health_base_url"]:
        health_runner = SmokeRunner(
            base_url=str(config["health_base_url"]), timeout=float(config["timeout"]),
            cookie_value=None, username=None, password=None, log_path=config["log_path"],
        )
    health_headers = {"Host": urlsplit(str(config["base_url"])).netloc} if config["health_base_url"] else None
    health_runner.assert_probe(Probe("live", "/health/live", frozenset({200}),
                                    authenticated=False, headers=health_headers))
    health_runner.assert_probe(Probe("ready", "/health/ready", frozenset({200}),
                                    authenticated=False, headers=health_headers))
    runner.login(str(config["login_path"]))
    runner.assert_session(str(config["session_path"]))
    runner.assert_release_identity(
        str(config["release_path"]), str(config["expected_release_id"])
    )
    runner.assert_probe(
        Probe("authorized-read", str(config["read_path"]), frozenset({200}))
    )
    runner.assert_probe(
        Probe("sync-read", str(config["sync_path"]), frozenset({200}))
    )
    optional: dict[str, str] = config["optional"]  # type: ignore[assignment]
    for label, path in optional.items():
        expected_type = None
        if label == "word":
            expected_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif label == "excel":
            expected_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        runner.assert_probe(
            Probe(label, path, frozenset({200}), expected_content_type=expected_type)
        )
    negative_path = config["negative_path"]
    if negative_path:
        runner.assert_probe(
            Probe(
                "unauthorized-error",
                str(negative_path),
                config["negative_status"],  # type: ignore[arg-type]
                authenticated=False,
            )
        )
    runner.log(f"complete-{mode}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
        config = _load_configuration(args)
        return _run(config, args.mode)
    except SmokeConfigurationError as error:
        print(f"Smoke configuration error: {_scrub_log_value(error)}", file=sys.stderr)
        return 2
    except SmokeCheckError as error:
        print(f"Smoke check failed: {_scrub_log_value(error)}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover - exercised through the CLI
    raise SystemExit(main())
