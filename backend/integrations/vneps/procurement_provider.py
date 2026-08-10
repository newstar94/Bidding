"""Production VNEPS procurement adapter, closed until access is authorized."""

from __future__ import annotations

from copy import deepcopy
import json
import os
import random
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from backend.procurement_import.source import ProcurementSourceError
from backend.shared.muasamcong_tls import MUASAMCONG_SSL_CONTEXT
from backend.shared.safe_http import open_allowlisted_https


_OFFICIAL_ORIGIN = "https://muasamcong.mpi.gov.vn"
_OFFICIAL_HOST = "muasamcong.mpi.gov.vn"


def _bounded_float(name, default, minimum, maximum):
    try:
        value = float(os.environ.get(name, default))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _bounded_int(name, default, minimum, maximum):
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


class VnepsProcurementTransport:
    """Bounded JSON transport; it does not grant access to protected APIs."""

    def __init__(
        self,
        *,
        origin=_OFFICIAL_ORIGIN,
        open_request=open_allowlisted_https,
        max_response_bytes=None,
        cache_ttl_seconds=None,
        timeout_seconds=None,
        retries=None,
        max_concurrency=None,
        slot_timeout_seconds=None,
        circuit_seconds=None,
        clock=time.monotonic,
        sleep=time.sleep,
    ):
        parsed = urllib.parse.urlsplit(str(origin).rstrip("/"))
        if (
            parsed.scheme != "https" or parsed.hostname != _OFFICIAL_HOST
            or parsed.username or parsed.password or parsed.port not in (None, 443)
        ):
            raise ProcurementSourceError("PROCUREMENT_LOOKUP_DISABLED")
        self.origin = _OFFICIAL_ORIGIN
        self.open_request = open_request
        self.max_response_bytes = int(
            max_response_bytes
            if max_response_bytes is not None
            else _bounded_int(
                "VNEPS_PROCUREMENT_MAX_RESPONSE_BYTES", 1048576, 1024, 8388608
            )
        )
        self.cache_ttl_seconds = float(
            cache_ttl_seconds
            if cache_ttl_seconds is not None
            else _bounded_float(
                "VNEPS_PROCUREMENT_CACHE_TTL_SECONDS", 900, 1, 86400
            )
        )
        self.timeout_seconds = float(
            timeout_seconds
            if timeout_seconds is not None
            else _bounded_float(
                "VNEPS_PROCUREMENT_TIMEOUT_SECONDS", 8, 1, 30
            )
        )
        self.retries = int(
            retries
            if retries is not None
            else _bounded_int("VNEPS_PROCUREMENT_RETRIES", 1, 0, 2)
        )
        capacity = int(
            max_concurrency
            if max_concurrency is not None
            else _bounded_int("VNEPS_PROCUREMENT_MAX_CONCURRENCY", 8, 1, 32)
        )
        self.slot_timeout_seconds = float(
            slot_timeout_seconds
            if slot_timeout_seconds is not None
            else _bounded_float(
                "VNEPS_PROCUREMENT_SLOT_TIMEOUT_SECONDS", 0.25, 0.01, 3
            )
        )
        self.circuit_seconds = float(
            circuit_seconds
            if circuit_seconds is not None
            else _bounded_float(
                "VNEPS_PROCUREMENT_CIRCUIT_SECONDS", 30, 1, 300
            )
        )
        self._slots = threading.BoundedSemaphore(capacity)
        self._clock = clock
        self._sleep = sleep
        self._cache = {}
        self._lock = threading.Lock()
        self._failures = 0
        self._opened_until = 0.0

    def _url(self, path):
        text = str(path or "")
        parsed = urllib.parse.urlsplit(text)
        if parsed.scheme or parsed.netloc or not text.startswith("/") or "\\" in text:
            raise ProcurementSourceError("PROCUREMENT_LOOKUP_DISABLED")
        url = f"{self.origin}{text}"
        final = urllib.parse.urlsplit(url)
        if final.scheme != "https" or final.hostname != _OFFICIAL_HOST:
            raise ProcurementSourceError("PROCUREMENT_LOOKUP_DISABLED")
        return url

    def _cached(self, key):
        if key is None:
            return None, False
        with self._lock:
            item = self._cache.get(tuple(key))
            if item and item[0] > self._clock():
                return deepcopy(item[1]), True
            if item:
                self._cache.pop(tuple(key), None)
        return None, False

    def _record_success(self):
        with self._lock:
            self._failures = 0
            self._opened_until = 0.0

    def _record_failure(self):
        with self._lock:
            self._failures += 1
            if self._failures >= 3:
                self._opened_until = self._clock() + self.circuit_seconds

    def _assert_available(self):
        with self._lock:
            if self._opened_until > self._clock():
                raise ProcurementSourceError("PROCUREMENT_LOOKUP_BUSY")

    def post_json(self, path, payload, *, cache_key=None):
        cached, found = self._cached(cache_key)
        if found:
            return cached
        self._assert_available()
        if not self._slots.acquire(timeout=self.slot_timeout_seconds):
            raise ProcurementSourceError("PROCUREMENT_LOOKUP_BUSY")
        try:
            result = self._post_with_retry(self._url(path), payload)
            self._record_success()
            if cache_key is not None:
                with self._lock:
                    self._cache[tuple(cache_key)] = (
                        self._clock() + self.cache_ttl_seconds,
                        deepcopy(result),
                    )
            return result
        except ProcurementSourceError as error:
            if str(error) not in {
                "PROCUREMENT_LOOKUP_DISABLED", "PROCUREMENT_LOOKUP_BUSY"
            }:
                self._record_failure()
            raise
        finally:
            self._slots.release()

    def _post_with_retry(self, url, payload):
        request = urllib.request.Request(
            url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json; charset=utf-8",
                "Origin": self.origin,
                "Referer": f"{self.origin}/",
                "User-Agent": "BiddingFlow/2.0",
            },
            method="POST",
        )
        deadline = self._clock() + self.timeout_seconds
        last_error = None
        for attempt in range(self.retries + 1):
            remaining = deadline - self._clock()
            if remaining <= 0:
                raise ProcurementSourceError("PROCUREMENT_LOOKUP_TIMEOUT")
            try:
                with self.open_request(
                    request,
                    allowed_hosts={_OFFICIAL_HOST},
                    timeout=remaining,
                    context=MUASAMCONG_SSL_CONTEXT,
                ) as response:
                    raw = response.read(self.max_response_bytes + 1)
                if len(raw) > self.max_response_bytes:
                    raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
                value = json.loads(raw.decode("utf-8-sig"))
                if not isinstance(value, (dict, list)):
                    raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
                return value
            except urllib.error.HTTPError as error:
                last_error = error
                if error.code < 500 and error.code != 429:
                    raise ProcurementSourceError(
                        "PROCUREMENT_UPSTREAM_UNAVAILABLE"
                    ) from error
            except ProcurementSourceError:
                raise
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                last_error = error
            except (UnicodeError, ValueError, json.JSONDecodeError) as error:
                raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED") from error
            if attempt < self.retries:
                remaining = deadline - self._clock()
                if remaining <= 0:
                    raise ProcurementSourceError("PROCUREMENT_LOOKUP_TIMEOUT")
                self._sleep(min(remaining, 0.15 * (2**attempt) + random.random() * 0.05))
        if isinstance(last_error, (TimeoutError,)):
            raise ProcurementSourceError("PROCUREMENT_LOOKUP_TIMEOUT") from last_error
        raise ProcurementSourceError("PROCUREMENT_UPSTREAM_UNAVAILABLE") from last_error


class VnepsProcurementSource:
    """Fail-closed seam for the not-yet-authorized detail API.

    Public version-list observations do not authorize fetching CAPTCHA-protected
    plan/package details.  The adapter deliberately cannot be instantiated in
    production until an approved detail contract is configured and implemented.
    """

    name = "VNEPS"
    schema_version = "vneps-procurement-v1"

    def __init__(self):
        confirmed = os.environ.get(
            "VNEPS_PROCUREMENT_API_AUTHORIZATION_CONFIRMED", "false"
        ).strip().casefold() == "true"
        if not confirmed:
            raise ProcurementSourceError("BLOCKED BY EXTERNAL/API AUTHORIZATION")
        raise ProcurementSourceError("PROCUREMENT_LOOKUP_DISABLED")
