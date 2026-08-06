"""Bounded adapter for violation requests used by the public VNEPS frontend."""

from __future__ import annotations

import json
import os
import random
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from backend.contractor_risk.violation_rules import (
    normalize_identity_code,
    normalize_tax_code,
)
from backend.integrations.vneps.errors import (
    VnepsConfigurationError,
    VnepsSchemaError,
    VnepsUpstreamError,
)
from backend.integrations.vneps.response_parser import parse_violation_response
from backend.shared.safe_http import open_allowlisted_https


OFFICIAL_SERVICE_BASE = (
    "https://muasamcong.mpi.gov.vn/"
    "o/egp-portal-org-ind-violating/services"
)
MAX_SEARCH_RESULTS = 10
MAX_DETAIL_REQUESTS = 10


class _CircuitBreaker:
    def __init__(self):
        self._lock = threading.Lock()
        self._failures = 0
        self._opened_until = 0.0

    def assert_available(self):
        with self._lock:
            if self._opened_until > time.monotonic():
                raise VnepsUpstreamError("VNEPS violation circuit is open")

    def success(self):
        with self._lock:
            self._failures = 0
            self._opened_until = 0.0

    def failure(self):
        with self._lock:
            self._failures += 1
            if self._failures >= 3:
                cooldown = _bounded_float(
                    "VNEPS_VIOLATION_CIRCUIT_SECONDS", 30.0, 5.0, 300.0
                )
                self._opened_until = time.monotonic() + cooldown


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


def _items(payload: object) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        raise VnepsSchemaError("VNEPS search response must be an object or list")
    for key in ("items", "content", "value", "results", "records"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    for key in ("data", "page"):
        value = payload.get(key)
        if isinstance(value, (dict, list)):
            return _items(value)
    if not payload:
        return []
    raise VnepsSchemaError("VNEPS search response has no record list")


def _identity_matches(item, contractor_identifier, tax_code):
    item_identifier = normalize_identity_code(
        item.get("orgCode")
        or item.get("contractorCode")
        or item.get("contractorIdentifier")
    )
    item_tax = normalize_tax_code(
        item.get("taxCode")
        or item.get("contractorTaxCode")
        or (item.get("idNo") if _is_tax_identity(item) else "")
    )
    requested_identifier = normalize_identity_code(contractor_identifier)
    requested_tax = normalize_tax_code(tax_code)
    return bool(
        requested_identifier
        and item_identifier == requested_identifier
        or requested_tax
        and item_tax == requested_tax
    )


def _is_tax_identity(item):
    identity_type = str(
        item.get("idType") or item.get("identityType") or ""
    ).strip().casefold()
    return identity_type in {"tax", "tax_code", "mst", "ma_so_thue"}


def _nested_dicts(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _nested_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _nested_dicts(child)


def _is_cancelled_detail(detail, contractor_identifier, tax_code):
    for item in _nested_dicts(detail):
        if not _identity_matches(item, contractor_identifier, tax_code):
            continue
        status = str(item.get("status") or "").strip().upper()
        if status in {"CANCEL", "CANCELLED", "REVOKED", "02"}:
            return True
        if any(
            item.get(field)
            for field in (
                "decNoCancel",
                "approveCancelDate",
                "cancelDecisionNo",
                "cancelDecisionDate",
                "cancelDate",
            )
        ):
            return True
    return False


def _detail_contains_identity(detail, contractor_identifier, tax_code):
    return any(
        _identity_matches(item, contractor_identifier, tax_code)
        for item in _nested_dicts(detail)
    )


_CIRCUIT = _CircuitBreaker()
_OUTBOUND_SLOTS = threading.BoundedSemaphore(
    _bounded_int("VNEPS_VIOLATION_MAX_CONCURRENCY", 4, 1, 16)
)


class VnepsViolationProvider:
    name = "MuaSamCong"
    schema_version = "vneps-public-ui-2026.1"

    def __init__(self, service_base: str | None = None):
        self.service_base = str(
            service_base
            or os.environ.get("VNEPS_VIOLATION_SERVICE_BASE", OFFICIAL_SERVICE_BASE)
        ).rstrip("/")
        parsed = urllib.parse.urlparse(self.service_base)
        if parsed.scheme != "https" or parsed.hostname != "muasamcong.mpi.gov.vn":
            raise VnepsConfigurationError(
                "The VNEPS violation adapter must use the official HTTPS host"
            )

    def lookup(self, *, contractor_identifier: str, tax_code: str = ""):
        if not contractor_identifier and not tax_code:
            raise VnepsSchemaError("A contractor identifier or tax code is required")
        _CIRCUIT.assert_available()
        slot_timeout = _bounded_float(
            "VNEPS_VIOLATION_SLOT_TIMEOUT_SECONDS", 0.25, 0.05, 3.0
        )
        if not _OUTBOUND_SLOTS.acquire(timeout=slot_timeout):
            raise VnepsUpstreamError("VNEPS violation lookup capacity is exhausted")
        try:
            normalized_items = []
            normalized_items.extend(
                self._lookup_legacy_violations(
                    contractor_identifier,
                    tax_code,
                    pen_type="CT",
                    category="BIDDING_BAN",
                )
            )
            normalized_items.extend(
                self._lookup_legacy_violations(
                    contractor_identifier,
                    tax_code,
                    pen_type="CD",
                    category="CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT",
                )
            )
            normalized_items.extend(
                self._lookup_reputation(contractor_identifier, tax_code)
            )
            result = parse_violation_response(
                {"items": normalized_items},
                provider=self.name,
            )
            _CIRCUIT.success()
            return result
        except (VnepsSchemaError, VnepsUpstreamError):
            _CIRCUIT.failure()
            raise
        finally:
            _OUTBOUND_SLOTS.release()

    def _lookup_legacy_violations(
        self,
        contractor_identifier,
        tax_code,
        *,
        pen_type,
        category,
    ):
        payload = {
            "orgNameVioOrOrgCode": {"contains": contractor_identifier or ""},
            "idNo": {"contains": tax_code or ""},
            "penType": {"contains": pen_type},
            "status": {"in": ["PUBLISH"]},
            "cqctqCreate": {"notEquals": 1, "specified": True},
            "pageSize": MAX_SEARCH_RESULTS,
            "pageNumber": 0,
        }
        search_items = _items(self._post("get-list-violate", payload))
        exact = [
            item
            for item in search_items
            if _identity_matches(item, contractor_identifier, tax_code)
        ]
        results = []
        detail_requests = 0
        for item in exact:
            detail = None
            decision_id = item.get("decisionId")
            if decision_id and detail_requests < MAX_DETAIL_REQUESTS:
                detail = self._post(
                    "get-detail-violation",
                    {"idViolateDec": decision_id},
                )
                detail_requests += 1
            cancelled = _is_cancelled_detail(
                detail,
                contractor_identifier,
                tax_code,
            ) if detail is not None else False
            detail_verified = detail is not None and _detail_contains_identity(
                detail,
                contractor_identifier,
                tax_code,
            )
            normalized = {
                "category": category,
                "contractorIdentifier": item.get("orgCode") or "",
                "taxCode": item.get("idNo") if _is_tax_identity(item) else "",
                "decisionNumber": item.get("decisionNo") or "",
                "issuedDate": item.get("issuedDate"),
                "effectiveFrom": item.get("effDate"),
                "effectiveTo": item.get("expDate"),
                "duration": item.get("bannedTime"),
                "durationUnit": item.get("bannedTimeUnit"),
                "sourceStatus": item.get("status") or "",
                "isRevoked": cancelled,
                "requiresReview": not detail_verified,
            }
            if category == "CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT":
                # Public schema documents termination records but not enough
                # semantics to prove contractor fault for every methodType.
                normalized["requiresReview"] = True
            results.append(normalized)
        if len(exact) >= MAX_SEARCH_RESULTS:
            results.append({
                "category": category,
                "contractorIdentifier": contractor_identifier,
                "taxCode": tax_code,
                "requiresReview": True,
            })
        requested_tax = normalize_tax_code(tax_code)
        if requested_tax and any(
            normalize_tax_code(item.get("idNo")) == requested_tax
            and not _is_tax_identity(item)
            for item in search_items
        ):
            results.append({
                "category": category,
                "contractorIdentifier": contractor_identifier,
                "taxCode": tax_code,
                "requiresReview": True,
            })
        return results

    def _lookup_reputation(self, contractor_identifier, tax_code):
        payload = {
            "orgCode": {"equals": contractor_identifier or ""},
            "taxCode": tax_code or "",
            "status": {"equals": None},
            "pageSize": MAX_SEARCH_RESULTS,
            "pageNumber": 0,
        }
        search_items = _items(
            self._post(
                "econsign/contractor-reputation-eval/searchContractorPo",
                payload,
            )
        )
        exact = [
            item
            for item in search_items
            if _identity_matches(item, contractor_identifier, tax_code)
        ]
        results = []
        for item in exact[:MAX_DETAIL_REQUESTS]:
            record_id = item.get("id")
            if not record_id:
                results.append({
                    "category": "UNRELIABLE_BID_PARTICIPATION",
                    "contractorIdentifier": item.get("orgCode") or contractor_identifier,
                    "taxCode": tax_code,
                    "requiresReview": True,
                })
                continue
            detail = self._post(
                "econsign/contractor-reputation-eval/getContractorDetailPo",
                {"id": record_id},
            )
            if not isinstance(detail, dict):
                raise VnepsSchemaError("VNEPS reputation detail is invalid")
            contractor_info = detail.get("contractorInfo") or {}
            evaluation_info = detail.get("evalInfo") or {}
            if not isinstance(contractor_info, dict) or not isinstance(evaluation_info, dict):
                raise VnepsSchemaError("VNEPS reputation detail schema changed")
            if not _identity_matches(
                {**evaluation_info, **contractor_info},
                contractor_identifier,
                tax_code,
            ):
                continue
            cancelled = (
                str(evaluation_info.get("status") or "").strip() == "02"
                or any(
                    evaluation_info.get(field)
                    for field in (
                        "cancelDecisionNo",
                        "cancelDecisionDate",
                        "cancelDate",
                    )
                )
            )
            results.append({
                "category": "UNRELIABLE_BID_PARTICIPATION",
                "contractorIdentifier": contractor_info.get("orgCode") or item.get("orgCode") or "",
                "taxCode": tax_code,
                "behaviorDate": contractor_info.get("behaviorDate"),
                "decisionNumber": evaluation_info.get("documentNo") or item.get("documentNo") or "",
                "sourceStatus": evaluation_info.get("status") or item.get("status") or "",
                "isRevoked": cancelled,
            })
        if len(exact) >= MAX_SEARCH_RESULTS:
            results.append({
                "category": "UNRELIABLE_BID_PARTICIPATION",
                "contractorIdentifier": contractor_identifier,
                "taxCode": tax_code,
                "requiresReview": True,
            })
        if (
            tax_code
            and search_items
            and not exact
            and (
                not contractor_identifier
                or normalize_identity_code(contractor_identifier)
                == normalize_tax_code(tax_code)
            )
        ):
            results.append({
                "category": "UNRELIABLE_BID_PARTICIPATION",
                "taxCode": tax_code,
                "requiresReview": True,
            })
        return results

    def _post(self, path, payload):
        request = urllib.request.Request(
            f"{self.service_base}/{path.lstrip('/')}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Origin": "https://muasamcong.mpi.gov.vn",
                "Referer": "https://muasamcong.mpi.gov.vn/vi/web/guest/organizations-violators",
                "User-Agent": "BiddingFlow/2.0",
            },
            method="POST",
        )
        timeout = _bounded_float(
            "VNEPS_VIOLATION_TIMEOUT_SECONDS", 6.0, 1.0, 15.0
        )
        retries = _bounded_int("VNEPS_VIOLATION_RETRIES", 1, 0, 2)
        context = ssl.create_default_context()
        last_error = None
        for attempt in range(retries + 1):
            try:
                with open_allowlisted_https(
                    request,
                    allowed_hosts={"muasamcong.mpi.gov.vn"},
                    timeout=timeout,
                    context=context,
                ) as response:
                    raw = response.read(1024 * 1024 + 1)
                    if len(raw) > 1024 * 1024:
                        raise VnepsSchemaError("VNEPS response is too large")
                    value = json.loads(raw.decode("utf-8-sig"))
                    if not isinstance(value, (dict, list)):
                        raise VnepsSchemaError("VNEPS response type is invalid")
                    return value
            except urllib.error.HTTPError as error:
                last_error = error
                if error.code < 500 and error.code != 429:
                    raise VnepsUpstreamError(
                        f"VNEPS request was rejected ({error.code})"
                    ) from error
            except VnepsSchemaError:
                raise
            except (
                urllib.error.URLError,
                TimeoutError,
                OSError,
                ValueError,
                json.JSONDecodeError,
            ) as error:
                last_error = error
            if attempt < retries:
                time.sleep(min(1.0, 0.15 * (2**attempt)) + random.random() * 0.05)
        raise VnepsUpstreamError("VNEPS request failed") from last_error
