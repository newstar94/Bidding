"""External HTTP boundary shared by calendar provider adapters."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from backend.shared.safe_http import open_allowlisted_https


MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024
CALENDAR_PROVIDER_HOSTS = frozenset({
    "oauth2.googleapis.com",
    "www.googleapis.com",
    "login.microsoftonline.com",
    "graph.microsoft.com",
})


@dataclass(frozen=True, slots=True)
class ProviderEventResult:
    remote_event_id: str
    etag: str | None = None
    cancelled: bool = False


class CalendarProviderError(RuntimeError):
    def __init__(self, code, *, retryable=False, reauth_required=False, status=None):
        super().__init__(code)
        self.code = code
        self.retryable = retryable
        self.reauth_required = reauth_required
        self.status = status


class CalendarHttpClient:
    """Bounded HTTPS client that never follows redirects or ambient proxies."""

    def request(self, method, url, *, headers=None, form=None, json_body=None):
        if form is not None and json_body is not None:
            raise ValueError("Only one request body encoding is allowed.")
        request_headers = {"Accept": "application/json", **(headers or {})}
        data = None
        if form is not None:
            data = urllib.parse.urlencode(form).encode("utf-8")
            request_headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif json_body is not None:
            data = json.dumps(
                json_body, ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8")
            request_headers["Content-Type"] = "application/json; charset=utf-8"
        request = urllib.request.Request(
            url, data=data, headers=request_headers, method=str(method).upper()
        )
        host = str(urllib.parse.urlsplit(url).hostname or "").casefold()
        if host not in CALENDAR_PROVIDER_HOSTS:
            raise CalendarProviderError("CALENDAR_PROVIDER_URL_DENIED")
        try:
            response = open_allowlisted_https(
                request, allowed_hosts=CALENDAR_PROVIDER_HOSTS, timeout=15.0
            )
            status = int(getattr(response, "status", 200))
            raw = response.read(MAX_PROVIDER_RESPONSE_BYTES + 1)
            response_headers = dict(response.headers.items())
        except urllib.error.HTTPError as exc:
            status = int(exc.code)
            raw = exc.read(MAX_PROVIDER_RESPONSE_BYTES + 1)
            response_headers = dict(exc.headers.items()) if exc.headers else {}
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            raise CalendarProviderError(
                "CALENDAR_PROVIDER_UNAVAILABLE", retryable=True
            ) from exc
        if len(raw) > MAX_PROVIDER_RESPONSE_BYTES:
            raise CalendarProviderError("CALENDAR_PROVIDER_RESPONSE_TOO_LARGE")
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise CalendarProviderError("CALENDAR_PROVIDER_RESPONSE_INVALID") from exc
        return {"status": status, "json": payload, "headers": response_headers}


def require_success(response, *, operation):
    status = int(response.get("status", 0))
    payload = response.get("json")
    if 200 <= status < 300 and isinstance(payload, dict):
        return payload
    raise CalendarProviderError(
        f"CALENDAR_PROVIDER_{operation}_FAILED",
        retryable=status in {408, 429} or status >= 500,
        reauth_required=(
            status in {401, 403}
            or (operation in {"TOKEN_EXCHANGE", "TOKEN_REFRESH"} and status == 400)
        ),
        status=status,
    )
