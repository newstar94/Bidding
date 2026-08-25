"""Provider-neutral failures and bounded HTTP transport."""

from __future__ import annotations

import json
import urllib.error
import urllib.request


class PaymentProviderError(RuntimeError):
    def __init__(self, code, message, *, outcome_unknown=False, retryable=False):
        super().__init__(message)
        self.code = str(code)
        self.outcome_unknown = bool(outcome_unknown)
        self.retryable = bool(retryable)


def bounded_json_transport(method, url, headers, body, timeout_seconds):
    encoded = None if body is None else json.dumps(
        body, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=encoded,
        method=method,
        headers={**headers, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=float(timeout_seconds)) as response:
            payload = response.read(262_145)
            if len(payload) > 262_144:
                raise PaymentProviderError("PROVIDER_RESPONSE_TOO_LARGE", "Provider response is too large.")
            return int(response.status), payload
    except urllib.error.HTTPError as error:
        payload = error.read(262_145)
        return int(error.code), payload[:262_144]
    except (TimeoutError, urllib.error.URLError, ConnectionError) as error:
        raise PaymentProviderError(
            "PROVIDER_TRANSPORT_FAILED",
            "Không thể kết nối payment provider.",
            outcome_unknown=method != "GET",
            retryable=True,
        ) from error
