"""Provider-neutral failures and bounded HTTP transport."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from urllib.parse import urlsplit


class PaymentProviderError(RuntimeError):
    def __init__(self, code, message, *, outcome_unknown=False, retryable=False):
        super().__init__(message)
        self.code = str(code)
        self.outcome_unknown = bool(outcome_unknown)
        self.retryable = bool(retryable)


class _PaymentRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Never forward provider credentials outside their original HTTPS origin."""

    def __init__(self, original_method):
        super().__init__()
        self._outcome_unknown = original_method != "GET"

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            source = urlsplit(req.full_url)
            target = urlsplit(newurl)
            same_origin = (
                source.scheme == target.scheme == "https"
                and bool(source.hostname)
                and source.hostname == target.hostname
                and (443 if source.port is None else source.port) == (443 if target.port is None else target.port)
                and target.username is None
                and target.password is None
            )
        except ValueError:
            same_origin = False
        if not same_origin:
            if fp is not None:
                fp.close()
            raise PaymentProviderError(
                "PROVIDER_REDIRECT_REJECTED",
                "Payment provider redirect is outside the approved HTTPS origin.",
                outcome_unknown=self._outcome_unknown,
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


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
        opener = urllib.request.build_opener(_PaymentRedirectHandler(method))
        with opener.open(request, timeout=float(timeout_seconds)) as response:
            payload = response.read(262_145)
            if len(payload) > 262_144:
                raise PaymentProviderError("PROVIDER_RESPONSE_TOO_LARGE", "Provider response is too large.")
            return int(response.status), payload
    except urllib.error.HTTPError as error:
        with error:
            payload = error.read(262_145)
            return int(error.code), payload[:262_144]
    except (TimeoutError, urllib.error.URLError, ConnectionError) as error:
        raise PaymentProviderError(
            "PROVIDER_TRANSPORT_FAILED",
            "Không thể kết nối payment provider.",
            outcome_unknown=method != "GET",
            retryable=True,
        ) from error
