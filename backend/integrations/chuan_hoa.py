"""Fail-closed server-to-server client for Chuẩn Hóa administration.

The browser never receives these credentials.  The client deliberately does
not retry: an unknown result from an administrative mutation must be reconciled
by the target application before a user tries again.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
import hmac
import json
import os
import ssl
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


class ChuanHoaIntegrationError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = 503):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class ChuanHoaIntegrationSettings:
    base_url: str
    client_id: str
    shared_secret: str
    mapped_user_ids: frozenset[str]
    timeout_seconds: float = 3.0
    enabled: bool = True
    ca_bundle: str = ""

    @classmethod
    def from_env(cls) -> "ChuanHoaIntegrationSettings":
        base_url = str(os.environ.get("CHUAN_HOA_ADMIN_BASE_URL", "")).strip()
        client_id = str(os.environ.get("CHUAN_HOA_ADMIN_CLIENT_ID", "")).strip()
        shared_secret = str(os.environ.get("CHUAN_HOA_ADMIN_SHARED_SECRET", "")).strip()
        raw_ids = str(os.environ.get("CHUAN_HOA_ADMIN_MAPPED_USER_IDS", ""))
        mapped = frozenset(value.strip() for value in raw_ids.split(",") if value.strip())
        try:
            timeout = float(os.environ.get("CHUAN_HOA_ADMIN_TIMEOUT_SECONDS", "3"))
        except (TypeError, ValueError):
            timeout = 3.0
        enabled = str(os.environ.get("CHUAN_HOA_ADMIN_ENABLED", "false")).strip().lower() in {"1", "true", "yes", "on"}
        ca_bundle = str(os.environ.get("CHUAN_HOA_ADMIN_CA_BUNDLE", "")).strip()
        return cls(base_url, client_id, shared_secret, mapped, min(max(timeout, 0.5), 10.0), enabled, ca_bundle)

    @property
    def configured(self) -> bool:
        parsed = urlparse(self.base_url)
        return (
            self.enabled
            and parsed.scheme == "https"
            and bool(parsed.netloc)
            and bool(self.client_id)
            and len(self.shared_secret) >= 32
        )


def _signature(secret: str, method: str, path: str, timestamp: str, nonce: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    canonical = "\n".join((method.upper(), path, timestamp, nonce, body_hash))
    return hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()


class ChuanHoaAdminClient:
    def __init__(self, settings: ChuanHoaIntegrationSettings | None = None):
        self.settings = settings or ChuanHoaIntegrationSettings.from_env()

    async def capabilities(self) -> dict:
        return await asyncio.to_thread(self._get_capabilities)

    async def read_collection(self, resource: str, *, search: str = "", page: int = 1, page_size: int = 25) -> dict:
        if resource not in {"accounts", "offers", "orders", "subscriptions", "payments", "audit"}:
            raise ChuanHoaIntegrationError("CHUAN_HOA_RESOURCE_INVALID", "Tài nguyên quản trị không hợp lệ.", 400)
        if not self.settings.configured:
            raise ChuanHoaIntegrationError(
                "CHUAN_HOA_INTEGRATION_NOT_CONFIGURED",
                "Tích hợp Chuẩn Hóa chưa được cấu hình đầy đủ.",
                503,
            )
        return await asyncio.to_thread(self._get_json, resource, search, page, page_size)

    async def extend_entitlement(self, payload: dict, idempotency_key: str) -> dict:
        if not self.settings.configured:
            raise ChuanHoaIntegrationError("CHUAN_HOA_INTEGRATION_NOT_CONFIGURED", "Tích hợp Chuẩn Hóa chưa được cấu hình đầy đủ.", 503)
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        return await asyncio.to_thread(self._request_json, "POST", "/v1/admin/integration/entitlements/extend", body, idempotency_key)

    def _get_capabilities(self) -> dict:
        if not self.settings.configured:
            raise ChuanHoaIntegrationError(
                "CHUAN_HOA_INTEGRATION_NOT_CONFIGURED",
                "Tích hợp Chuẩn Hóa chưa được cấu hình đầy đủ.",
                503,
            )
        return self._get_json_path("/v1/admin/integration/capabilities")

    def _get_json(self, resource: str, search: str, page: int, page_size: int) -> dict:
        from urllib.parse import urlencode
        query = urlencode({"search": search, "page": max(1, int(page)), "pageSize": min(100, max(1, int(page_size)))})
        return self._get_json_path(f"/v1/admin/integration/{resource.lstrip('/')}?{query}")

    def _get_json_path(self, path: str) -> dict:
        return self._request_json("GET", path, b"")

    def _request_json(self, method: str, path: str, body: bytes, idempotency_key: str = "") -> dict:
        parsed_path = urlparse(path)
        signed_path = parsed_path.path + (f"?{parsed_path.query}" if parsed_path.query else "")
        timestamp = str(int(time.time()))
        nonce = hashlib.sha256(os.urandom(32)).hexdigest()[:32]
        request = Request(
            urljoin(self.settings.base_url.rstrip("/") + "/", path.lstrip("/")),
            data=body,
            method=method,
            headers={
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if body else {}),
                **({"Idempotency-Key": idempotency_key} if idempotency_key else {}),
                "X-Integration-Client": self.settings.client_id,
                "X-Integration-Timestamp": timestamp,
                "X-Integration-Nonce": nonce,
                "X-Integration-Signature": _signature(
                    self.settings.shared_secret, method, signed_path, timestamp, nonce, body
                ),
            },
        )
        try:
            open_options = {"timeout": self.settings.timeout_seconds}
            if self.settings.ca_bundle:
                open_options["context"] = ssl.create_default_context(cafile=self.settings.ca_bundle)
            with urlopen(request, **open_options) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code in {401, 403}:
                raise ChuanHoaIntegrationError(
                    "CHUAN_HOA_INTEGRATION_UNAUTHORIZED",
                    "Chuẩn Hóa từ chối định danh server-to-server.",
                    502,
                ) from exc
            raise ChuanHoaIntegrationError(
                "CHUAN_HOA_INTEGRATION_UPSTREAM_ERROR",
                "Chuẩn Hóa không thể phục vụ yêu cầu quản trị.",
                502,
            ) from exc
        except (TimeoutError, URLError, OSError) as exc:
            raise ChuanHoaIntegrationError(
                "CHUAN_HOA_INTEGRATION_TIMEOUT",
                "Không nhận được phản hồi xác định từ Chuẩn Hóa.",
                504,
            ) from exc
        except (ValueError, json.JSONDecodeError) as exc:
            raise ChuanHoaIntegrationError(
                "CHUAN_HOA_INTEGRATION_INVALID_RESPONSE",
                "Phản hồi Chuẩn Hóa không hợp lệ.",
                502,
            ) from exc
        if not isinstance(payload, dict):
            raise ChuanHoaIntegrationError(
                "CHUAN_HOA_INTEGRATION_INVALID_RESPONSE",
                "Phản hồi Chuẩn Hóa không hợp lệ.",
                502,
            )
        return payload


def integration_signature(secret: str, method: str, path: str, timestamp: str, nonce: str, body: bytes = b"") -> str:
    """Exposed for contract tests and the target application's verifier."""
    return _signature(secret, method, path, timestamp, nonce, body)
