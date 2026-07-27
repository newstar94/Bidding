
import urllib.request
import json
import asyncio
import re
from starlette.responses import JSONResponse
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.logging_utils import get_request_id, log_structured_event
from backend.shared.async_io import (
    BlockingIOBusyError,
    BlockingIOTimeoutError,
    run_blocking_io,
)
from backend.shared.database_io import run_database_write
from backend.shared.safe_http import open_allowlisted_https
from backend.observability.recording import record_partner_lookup
from backend.auth.auth_service import (
    get_client_ip,
    get_rate_limit_decision,
    rate_limit_response,
)
from backend.auth.auth_helper import verify_session
from backend.auth.session_utils import OrgPermissionError, get_active_org
from backend.partners.partner_lookup_service import (
    PartnerLookupBusyError,
    PartnerUpstreamError,
    extract_clean_tax_code,
    lookup_partner_info,
    normalize_procurement_org_code,
)


_provinces_cache = None
_wards_cache = {}
_provinces_lock = asyncio.Lock()
_wards_locks = {}

PROVINCES_API_BASE = "https://provinces.open-api.vn/api/v2"


def _authenticate_partner_lookup(request):
    is_valid, role_or_error = verify_session(request)
    if not is_valid:
        return False, role_or_error, None
    active_org_id = get_active_org(request, role_or_error.user_id)
    return True, role_or_error, active_org_id


def _observe_partner_lookup(request, outcome, *, user_id=None, organization_id=None):
    record_partner_lookup(outcome)
    log_structured_event(
        "partner.lookup_request",
        request_id=get_request_id(request),
        actor_user_id=user_id,
        organization_id=organization_id,
        fields={"outcome": outcome},
        nonblocking=True,
    )


def _fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "BiddingApp/1.0"})
    with open_allowlisted_https(
        req,
        allowed_hosts={"provinces.open-api.vn"},
        timeout=10,
    ) as resp:
        return json.loads(resp.read().decode("utf-8"))


async def get_provinces_api(request):

    global _provinces_cache
    if _provinces_cache is not None:
        return JSONResponse(_provinces_cache)

    try:
        async with _provinces_lock:
            if _provinces_cache is None:
                data = await run_blocking_io(
                    _fetch_json,
                    f"{PROVINCES_API_BASE}/p/",
                    timeout_seconds=12,
                )
                if isinstance(data, list) and data:
                    _provinces_cache = data
            if _provinces_cache is not None:
                return JSONResponse(_provinces_cache)
        return error_response(
            request,
            "PROVINCES_UPSTREAM_EMPTY",
            "Dịch vụ tỉnh thành không trả về dữ liệu.",
            status_code=502,
        )
    except Exception as e:
        return log_and_error(
            request,
            e,
            "get_provinces_api",
            "PROVINCES_UPSTREAM_UNAVAILABLE",
            "Không thể tải danh sách tỉnh thành lúc này.",
            status_code=502,
        )


async def get_wards_api(request):

    province_code = request.path_params.get("province_code", "")
    if not province_code:
        return error_response(
            request,
            "PROVINCE_CODE_REQUIRED",
            "Thiếu mã tỉnh.",
            status_code=400,
        )
    if not re.fullmatch(r"\d{1,3}", province_code):
        return error_response(
            request,
            "PROVINCE_CODE_INVALID",
            "Mã tỉnh không hợp lệ.",
            status_code=400,
        )

    if province_code in _wards_cache:
        return JSONResponse(_wards_cache[province_code])

    try:
        lock = _wards_locks.setdefault(province_code, asyncio.Lock())
        async with lock:
            if province_code not in _wards_cache:
                data = await run_blocking_io(
                    _fetch_json,
                    f"{PROVINCES_API_BASE}/p/{province_code}?depth=2",
                    timeout_seconds=12,
                )
                _wards_cache[province_code] = (
                    data.get("wards", []) if isinstance(data, dict) else []
                )
            return JSONResponse(_wards_cache[province_code])
    except Exception as e:
        return log_and_error(
            request,
            e,
            "get_wards_api",
            "WARDS_UPSTREAM_UNAVAILABLE",
            "Không thể tải danh sách xã phường lúc này.",
            status_code=502,
        )


async def lookup_tax_code_api(request):
    client_ip = get_client_ip(request)
    try:
        ip_limit = await run_database_write(
            get_rate_limit_decision,
            f"partner_lookup_ip:{client_ip}",
            max_attempts=12,
            window_seconds=60,
        )
    except BlockingIOBusyError:
        _observe_partner_lookup(request, "busy")
        return error_response(
            request,
            "PARTNER_LOOKUP_BUSY",
            "Dịch vụ tra cứu đang bận. Vui lòng thử lại sau.",
            status_code=503,
        )
    if not ip_limit.allowed:
        _observe_partner_lookup(request, "rate_limited")
        return rate_limit_response(
            "Quá nhiều yêu cầu tra cứu. Vui lòng thử lại sau.",
            ip_limit,
        )

    if not (request.cookies.get("session_token") or "").strip():
        _observe_partner_lookup(request, "unauthorized")
        return error_response(
            request,
            "AUTHENTICATION_REQUIRED",
            "Vui lòng đăng nhập để sử dụng tính năng tra cứu.",
            status_code=401,
        )

    try:
        is_valid, role_or_error, active_org_id = await run_database_write(
            _authenticate_partner_lookup,
            request,
        )
    except BlockingIOBusyError:
        _observe_partner_lookup(request, "busy")
        return error_response(
            request,
            "PARTNER_LOOKUP_BUSY",
            "Dịch vụ tra cứu đang bận. Vui lòng thử lại sau.",
            status_code=503,
        )
    except OrgPermissionError:
        _observe_partner_lookup(request, "forbidden")
        return error_response(
            request,
            "ORGANIZATION_ACCESS_DENIED",
            "Bạn không có quyền tra cứu trong phạm vi dữ liệu này.",
            status_code=403,
        )
    if not is_valid:
        _observe_partner_lookup(request, "unauthorized")
        return error_response(
            request,
            "INVALID_SESSION",
            str(role_or_error),
            status_code=401,
        )

    user_id = role_or_error.user_id
    try:
        user_limit = await run_database_write(
            get_rate_limit_decision,
            f"partner_lookup_user:{user_id}",
            max_attempts=8,
            window_seconds=60,
        )
    except BlockingIOBusyError:
        _observe_partner_lookup(
            request, "busy", user_id=user_id, organization_id=active_org_id
        )
        return error_response(
            request,
            "PARTNER_LOOKUP_BUSY",
            "Dịch vụ tra cứu đang bận. Vui lòng thử lại sau.",
            status_code=503,
        )
    if not user_limit.allowed:
        _observe_partner_lookup(
            request,
            "rate_limited",
            user_id=user_id,
            organization_id=active_org_id,
        )
        return rate_limit_response(
            "Quá nhiều yêu cầu tra cứu. Vui lòng thử lại sau.",
            user_limit,
        )

    tax_code = request.query_params.get("code", "").strip()
    org_code = request.query_params.get("orgCode", "").strip()
    role_name = request.query_params.get("role", "NT").strip().upper()
    if not tax_code and not org_code:
        _observe_partner_lookup(
            request, "invalid", user_id=user_id, organization_id=active_org_id
        )
        return error_response(
            request,
            "PARTNER_IDENTIFIER_REQUIRED",
            "Thiếu mã định danh hoặc mã số thuế.",
            status_code=400,
        )
    if role_name not in {"NT", "CDT"}:
        _observe_partner_lookup(
            request, "invalid", user_id=user_id, organization_id=active_org_id
        )
        return error_response(
            request,
            "PARTNER_ROLE_INVALID",
            "Loại tổ chức tra cứu không hợp lệ.",
            status_code=400,
        )

    try:
        cleaned_code = extract_clean_tax_code(tax_code) if tax_code else ""
        normalized_org_code = normalize_procurement_org_code(org_code) if org_code else ""
        if tax_code and not cleaned_code:
            _observe_partner_lookup(
                request, "invalid", user_id=user_id, organization_id=active_org_id
            )
            return error_response(
                request,
                "TAX_CODE_INVALID",
                "Mã số thuế không hợp lệ về mặt định dạng.",
                status_code=400,
            )
        if org_code and not normalized_org_code:
            _observe_partner_lookup(
                request, "invalid", user_id=user_id, organization_id=active_org_id
            )
            return error_response(
                request,
                "ORGANIZATION_CODE_INVALID",
                "Mã định danh không hợp lệ.",
                status_code=400,
            )

        info = await run_blocking_io(
            lookup_partner_info,
            cleaned_code,
            org_code=normalized_org_code,
            role_name=role_name,
            timeout_seconds=35,
        )
        if info:
            _observe_partner_lookup(
                request, "found", user_id=user_id, organization_id=active_org_id
            )
            return JSONResponse({**info, "found": True})
        _observe_partner_lookup(
            request, "not_found", user_id=user_id, organization_id=active_org_id
        )
        return JSONResponse({
            "found": False,
            "code": "PARTNER_NOT_FOUND",
            "message": "Không tìm thấy thông tin doanh nghiệp.",
        })
    except PartnerLookupBusyError:
        _observe_partner_lookup(
            request, "busy", user_id=user_id, organization_id=active_org_id
        )
        return error_response(
            request,
            "PARTNER_LOOKUP_BUSY",
            "Dịch vụ tra cứu đang bận. Vui lòng thử lại sau.",
            status_code=503,
        )
    except PartnerUpstreamError:
        _observe_partner_lookup(
            request,
            "upstream_error",
            user_id=user_id,
            organization_id=active_org_id,
        )
        return error_response(
            request,
            "PARTNER_UPSTREAM_UNAVAILABLE",
            "Nguồn dữ liệu tra cứu đang tạm thời gián đoạn.",
            status_code=502,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        _observe_partner_lookup(
            request, "busy", user_id=user_id, organization_id=active_org_id
        )
        return error_response(
            request,
            "PARTNER_LOOKUP_BUSY",
            "Dịch vụ tra cứu đang bận. Vui lòng thử lại sau.",
            status_code=503,
        )
    except Exception as e:
        _observe_partner_lookup(
            request, "error", user_id=user_id, organization_id=active_org_id
        )
        return log_and_error(
            request,
            e,
            "lookup_tax_code_api",
            "PARTNER_LOOKUP_FAILED",
            "Không thể tra cứu thông tin doanh nghiệp lúc này.",
            status_code=502,
        )
