"""Platform-admin adapter for the independent Chuẩn Hóa application."""

from __future__ import annotations

import uuid
import json
from starlette.responses import JSONResponse

from backend.auth.auth_helper import verify_session
from backend.integrations.chuan_hoa import (
    ChuanHoaAdminClient,
    ChuanHoaIntegrationError,
    ChuanHoaIntegrationSettings,
)
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.shared.database_io import run_database_write
from backend.shared.logging_utils import log_audit
from backend.shared.logging_utils import get_request_id
from backend.db.db_helper import database


_UPSTREAM_SCHEMA = "chuanhoa.admin.integration.v1"


def _unwrap_upstream(payload: dict, *, capabilities: bool = False):
    if not isinstance(payload, dict):
        raise ChuanHoaIntegrationError("CHUAN_HOA_INTEGRATION_INVALID_RESPONSE", "Phản hồi Chuẩn Hóa không hợp lệ.", 502)
    if payload.get("schema") != _UPSTREAM_SCHEMA or payload.get("application") != "chuan-hoa":
        raise ChuanHoaIntegrationError("CHUAN_HOA_INTEGRATION_INVALID_RESPONSE", "Phản hồi Chuẩn Hóa không đúng contract.", 502)
    if capabilities:
        return payload
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ChuanHoaIntegrationError("CHUAN_HOA_INTEGRATION_INVALID_RESPONSE", "Phản hồi Chuẩn Hóa thiếu dữ liệu contract.", 502)
    return data


def _error(message: str, code: str, status: int) -> JSONResponse:
    return JSONResponse(
        {"error": message, "code": code, "application": "chuan-hoa"},
        status_code=status,
        headers={"Cache-Control": "private, no-store"},
    )


def _record_audit(request, actor, result: str, code: str = "", action: str = "admin.cross_application.capabilities_read"):
    def write():
        connection = database.get_connection()
        try:
            cursor = connection.cursor()
            log_audit(
                action,
                actor_user_id=actor.user_id,
                target_type="application",
                target_id="chuan-hoa",
                request=request,
                metadata={"result": result, "code": code},
                cursor=cursor,
                required=True,
            )
            connection.commit()
        finally:
            connection.close()
    return write


async def admin_chuan_hoa_capabilities_api(request):
    try:
        valid, actor = await run_database_read(
            verify_session, request, "super_admin", timeout_seconds=5
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error("Không thể xác thực quyền quản trị lúc này.", "ADMIN_AUTH_UNAVAILABLE", 503)
    if not valid:
        return _error(str(actor), "SUPER_ADMIN_REQUIRED", 403)

    settings = ChuanHoaIntegrationSettings.from_env()
    if str(actor.user_id) not in settings.mapped_user_ids:
        await run_database_write(_record_audit(request, actor, "denied", "CHUAN_HOA_ADMIN_NOT_MAPPED"))
        return _error(
            "Tài khoản chưa được ánh xạ quyền quản trị Chuẩn Hóa.",
            "CHUAN_HOA_ADMIN_NOT_MAPPED",
            403,
        )
    try:
        payload = _unwrap_upstream(await ChuanHoaAdminClient(settings).capabilities(), capabilities=True)
        await run_database_write(_record_audit(request, actor, "success"))
        return JSONResponse(
            {"application": "chuan-hoa", "status": "available", "data": payload},
            headers={"Cache-Control": "private, no-store"},
        )
    except ChuanHoaIntegrationError as exc:
        await run_database_write(_record_audit(request, actor, "failed", exc.code))
        return _error(str(exc), exc.code, exc.status)


async def _admin_chuan_hoa_collection(request, resource):
    try:
        valid, actor = await run_database_read(verify_session, request, "super_admin", timeout_seconds=5)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error("Không thể xác thực quyền quản trị lúc này.", "ADMIN_AUTH_UNAVAILABLE", 503)
    if not valid:
        return _error(str(actor), "SUPER_ADMIN_REQUIRED", 403)
    settings = ChuanHoaIntegrationSettings.from_env()
    if str(actor.user_id) not in settings.mapped_user_ids:
        return _error("Tài khoản chưa được ánh xạ quyền quản trị Chuẩn Hóa.", "CHUAN_HOA_ADMIN_NOT_MAPPED", 403)
    try:
        query = request.query_params
        payload = _unwrap_upstream(await ChuanHoaAdminClient(settings).read_collection(
            resource, search=query.get("search", ""), page=int(query.get("page", "1")), page_size=int(query.get("pageSize", "25"))
        ))
        await run_database_write(_record_audit(request, actor, "success", action=f"admin.cross_application.{resource}_read"))
        return JSONResponse({"application": "chuan-hoa", "status": "available", "data": payload}, headers={"Cache-Control": "private, no-store"})
    except (ValueError, ChuanHoaIntegrationError) as exc:
        code = exc.code if isinstance(exc, ChuanHoaIntegrationError) else "INVALID_PAGINATION"
        status = exc.status if isinstance(exc, ChuanHoaIntegrationError) else 400
        await run_database_write(_record_audit(request, actor, "failed", code, f"admin.cross_application.{resource}_read"))
        return _error(str(exc), code, status)


async def admin_chuan_hoa_extend_entitlement_api(request):
    try:
        valid, actor = await run_database_read(verify_session, request, "super_admin", timeout_seconds=5)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return _error("Không thể xác thực quyền quản trị lúc này.", "ADMIN_AUTH_UNAVAILABLE", 503)
    if not valid:
        return _error(str(actor), "SUPER_ADMIN_REQUIRED", 403)
    settings = ChuanHoaIntegrationSettings.from_env()
    if str(actor.user_id) not in settings.mapped_user_ids:
        return _error("Tài khoản chưa được ánh xạ quyền quản trị Chuẩn Hóa.", "CHUAN_HOA_ADMIN_NOT_MAPPED", 403)
    key = str(request.headers.get("Idempotency-Key") or "").strip()
    if len(key) < 16 or len(key) > 128:
        return _error("Idempotency-Key không hợp lệ.", "INVALID_IDEMPOTENCY_KEY", 400)
    try:
        if hasattr(request, "body"):
            raw_body = await request.body()
            if len(raw_body) > 1_048_576:
                return _error("Request quá lớn.", "INTEGRATION_BODY_TOO_LARGE", 413)
            payload = json.loads(raw_body.decode("utf-8"))
        else:
            payload = await request.json()
        if not isinstance(payload, dict): raise ValueError("ADMIN_ENTITLEMENT_REQUEST_INVALID")
        payload = dict(payload)
        payload["actorId"] = str(actor.user_id)
        request_id = get_request_id(request)
        try:
            payload["correlationId"] = str(uuid.UUID(str(request_id)))
        except (ValueError, AttributeError):
            payload["correlationId"] = str(uuid.uuid4())
        # Body parsing may be slow. Re-read session, revocation and role at the
        # authoritative mutation boundary; the initial check only gates work.
        fresh_valid, fresh_actor = await run_database_read(
            verify_session, request, "super_admin", fresh=True, timeout_seconds=5
        )
        if not fresh_valid:
            return _error(str(fresh_actor), "SUPER_ADMIN_REQUIRED", 403)
        if str(fresh_actor.user_id) not in settings.mapped_user_ids:
            return _error("Tài khoản chưa được ánh xạ quyền quản trị Chuẩn Hóa.", "CHUAN_HOA_ADMIN_NOT_MAPPED", 403)
        actor = fresh_actor
        payload["actorId"] = str(fresh_actor.user_id)
        result = _unwrap_upstream(await ChuanHoaAdminClient(settings).extend_entitlement(payload, key))
        await run_database_write(_record_audit(request, actor, "success", action="admin.cross_application.entitlement_extend"))
        return JSONResponse({"application": "chuan-hoa", "status": "available", "data": result}, headers={"Cache-Control": "private, no-store"})
    except (ValueError, TypeError) as exc:
        return _error(str(exc), "ADMIN_ENTITLEMENT_REQUEST_INVALID", 400)
    except ChuanHoaIntegrationError as exc:
        await run_database_write(_record_audit(request, actor, "failed", exc.code, "admin.cross_application.entitlement_extend"))
        return _error(str(exc), exc.code, exc.status)


async def admin_chuan_hoa_accounts_api(request):
    return await _admin_chuan_hoa_collection(request, "accounts")


async def admin_chuan_hoa_offers_api(request):
    return await _admin_chuan_hoa_collection(request, "offers")


async def admin_chuan_hoa_orders_api(request):
    return await _admin_chuan_hoa_collection(request, "orders")


async def admin_chuan_hoa_subscriptions_api(request):
    return await _admin_chuan_hoa_collection(request, "subscriptions")


async def admin_chuan_hoa_payments_api(request):
    return await _admin_chuan_hoa_collection(request, "payments")


async def admin_chuan_hoa_audit_api(request):
    return await _admin_chuan_hoa_collection(request, "audit")


def platform_chuan_hoa_routes(Route):
    return [
        Route(
            "/api/admin/integrations/chuan-hoa/capabilities",
            admin_chuan_hoa_capabilities_api,
            methods=["GET"],
        ),
        Route("/api/admin/integrations/chuan-hoa/accounts", admin_chuan_hoa_accounts_api, methods=["GET"]),
        Route("/api/admin/integrations/chuan-hoa/offers", admin_chuan_hoa_offers_api, methods=["GET"]),
        Route("/api/admin/integrations/chuan-hoa/orders", admin_chuan_hoa_orders_api, methods=["GET"]),
        Route("/api/admin/integrations/chuan-hoa/subscriptions", admin_chuan_hoa_subscriptions_api, methods=["GET"]),
        Route("/api/admin/integrations/chuan-hoa/payments", admin_chuan_hoa_payments_api, methods=["GET"]),
        Route("/api/admin/integrations/chuan-hoa/audit", admin_chuan_hoa_audit_api, methods=["GET"]),
        Route("/api/admin/integrations/chuan-hoa/entitlements/extend", admin_chuan_hoa_extend_entitlement_api, methods=["POST"]),
    ]
