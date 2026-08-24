"""Strict preview and user-initiated iCalendar download routes."""

import os

from starlette.responses import JSONResponse, RedirectResponse, Response

from backend.shared.access_policy import can_read_record
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_write
from backend.shared.helpers import database, get_active_org, verify_session
from backend.shared.logging_utils import error_response, log_and_error, log_audit
from backend.procurement_cases.repository import ProcurementCaseRepository

from .service import WorkCalendar, WorkCalendarError
from .connections import CalendarConnectionError, CalendarConnectionService
from .delivery import CalendarDeliveryError, CalendarDeliveryService


def work_calendar_enabled(environ=None):
    environment = os.environ if environ is None else environ
    return str(environment.get("WORK_CALENDAR_ICS_ENABLED", "false")).strip().casefold() == "true"


def calendar_connectors_enabled(provider=None, environ=None):
    environment = os.environ if environ is None else environ
    if str(environment.get(
        "WORK_CALENDAR_CONNECTORS_ENABLED", "false"
    )).strip().casefold() != "true":
        return False
    if provider is None:
        return True
    normalized = str(provider or "").strip().upper()
    if normalized not in {"GOOGLE", "MICROSOFT"}:
        return False
    return str(environment.get(
        f"WORK_CALENDAR_{normalized}_ENABLED", "false"
    )).strip().casefold() == "true"


def _blocking(request, operation):
    valid, role = verify_session(request)
    if not valid:
        raise WorkCalendarError("WORK_CALENDAR_ACCESS_DENIED", status_code=403)
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        organization_id = get_active_org(request, role.user_id, cursor=cursor)
        result = operation(cursor, role, organization_id)
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _callback_blocking(request, operation):
    valid, role = verify_session(request)
    if not valid:
        raise WorkCalendarError("WORK_CALENDAR_ACCESS_DENIED", status_code=403)
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        cursor = connection.cursor()
        result = operation(cursor, role)
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _authorize_sources(cursor, role, organization_id, source_items):
    if not isinstance(source_items, list) or not source_items:
        raise WorkCalendarError("WORK_CALENDAR_SELECTION_REQUIRED")
    for source in source_items:
        if not isinstance(source, dict):
            raise WorkCalendarError("WORK_CALENDAR_SOURCE_INVALID")
        source_type = source.get("sourceType")
        source_id = str(source.get("sourceId") or "").strip()
        if source_type == "PACKAGE_TIMELINE":
            package_id = source_id
        elif source_type == "CASE_DEADLINE":
            case = ProcurementCaseRepository(cursor).get_case(
                organization_id, source_id
            )
            package_id = case["currentPackageVersionId"] if case else ""
        else:
            raise WorkCalendarError("WORK_CALENDAR_SOURCE_UNSUPPORTED")
        if not package_id or not can_read_record(
            cursor, role, role.user_id, organization_id,
            "goithau", "goi_thau", package_id,
        ):
            # Fail all and return no source metadata.
            raise WorkCalendarError("WORK_CALENDAR_SELECTION_DENIED", status_code=403)


async def _calendar_request(request, *, download):
    if not work_calendar_enabled():
        return error_response(
            request, "WORK_CALENDAR_DISABLED",
            "Tính năng lịch công việc chưa được bật.", status_code=404,
        )
    try:
        body = await request.json()
        if not isinstance(body, dict) or set(body) != {"sourceItems"}:
            raise WorkCalendarError("WORK_CALENDAR_REQUEST_INVALID")
        source_items = body["sourceItems"]

        def write(cursor, role, organization_id):
            _authorize_sources(cursor, role, organization_id, source_items)
            calendar = WorkCalendar(cursor)
            events = calendar.project(organization_id, source_items)
            result = calendar.export_ics(events) if download else calendar.preview(events)
            log_audit(
                "work_calendar.downloaded" if download else "work_calendar.previewed",
                actor_user_id=role.user_id, organization_id=organization_id,
                target_type="work_calendar", target_id="snapshot", request=request,
                metadata={"sourceCount": len(source_items), "eventCount": len(events)},
                cursor=cursor, required=True,
            )
            return result

        result = await run_database_write(_blocking, request, write)
        if download:
            return Response(
                result, media_type="text/calendar; charset=UTF-8",
                headers={
                    "Content-Disposition": 'attachment; filename="biddingflow-work-calendar.ics"',
                    "Cache-Control": "private, no-store",
                    "X-Content-Type-Options": "nosniff",
                },
            )
        return JSONResponse({"events": result}, headers={"Cache-Control": "private, no-store"})
    except WorkCalendarError as error:
        return error_response(
            request, error.code, "Yêu cầu lịch công việc không hợp lệ.",
            status_code=error.status_code, fields=error.fields,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return error_response(request, "DATABASE_BUSY", "Hệ thống đang bận.", status_code=503)
    except Exception as error:  # noqa: BLE001
        return log_and_error(
            request, error, "work_calendar", "WORK_CALENDAR_FAILED",
            "Không thể tạo lịch công việc.",
        )


async def preview_calendar_api(request):
    return await _calendar_request(request, download=False)


async def download_calendar_api(request):
    return await _calendar_request(request, download=True)


async def start_connection_api(request):
    try:
        body = await request.json()
        if not isinstance(body, dict) or set(body) != {"provider", "calendarId"}:
            raise CalendarConnectionError("CALENDAR_CONNECTION_REQUEST_INVALID")
        provider = str(body["provider"] or "").strip().upper()
        if not calendar_connectors_enabled(provider):
            return error_response(
                request, "CALENDAR_CONNECTOR_DISABLED",
                "Kết nối lịch chưa được bật.", status_code=404,
            )

        def write(cursor, role, organization_id):
            result = CalendarConnectionService().start(
                cursor,
                organization_id=organization_id,
                user_id=role.user_id,
                active_role=getattr(role, "active_role", None) or str(role),
                provider=provider,
                calendar_id=body["calendarId"],
            )
            log_audit(
                "work_calendar.connection_started",
                actor_user_id=role.user_id,
                organization_id=organization_id,
                target_type="calendar_connection",
                target_id=provider,
                request=request,
                metadata={"provider": provider},
                cursor=cursor,
                required=True,
            )
            return result

        result = await run_database_write(_blocking, request, write)
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
    except CalendarConnectionError as error:
        return error_response(
            request, error.code, "Không thể bắt đầu kết nối lịch.",
            status_code=error.status_code,
        )
    except WorkCalendarError as error:
        return error_response(
            request, error.code, "Không có quyền kết nối lịch.",
            status_code=error.status_code,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return error_response(request, "DATABASE_BUSY", "Hệ thống đang bận.", status_code=503)
    except Exception as error:  # noqa: BLE001
        return log_and_error(
            request, error, "work_calendar_connection_start",
            "CALENDAR_CONNECTION_START_FAILED",
            "Không thể bắt đầu kết nối lịch.",
        )


async def list_connections_api(request):
    if not calendar_connectors_enabled():
        return error_response(
            request, "CALENDAR_CONNECTOR_DISABLED",
            "Kết nối lịch chưa được bật.", status_code=404,
        )
    try:
        result = await run_database_write(
            _blocking,
            request,
            lambda cursor, role, organization_id: CalendarConnectionService().list_connections(
                cursor,
                organization_id=organization_id,
                user_id=role.user_id,
            ),
        )
        return JSONResponse(
            {"connections": result},
            headers={"Cache-Control": "private, no-store"},
        )
    except WorkCalendarError as error:
        return error_response(
            request, error.code, "Không có quyền xem kết nối lịch.",
            status_code=error.status_code,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return error_response(request, "DATABASE_BUSY", "Hệ thống đang bận.", status_code=503)
    except Exception as error:  # noqa: BLE001
        return log_and_error(
            request, error, "work_calendar_connection_list",
            "CALENDAR_CONNECTION_LIST_FAILED",
            "Không thể tải kết nối lịch.",
        )


async def connection_callback_api(request):
    provider = str(request.path_params.get("provider") or "").strip().upper()
    if not calendar_connectors_enabled(provider):
        return error_response(
            request, "CALENDAR_CONNECTOR_DISABLED",
            "Kết nối lịch chưa được bật.", status_code=404,
        )
    code = str(request.query_params.get("code") or "").strip()
    state = str(request.query_params.get("state") or "").strip()
    if request.query_params.get("error") or not code or not state:
        return error_response(
            request, "CALENDAR_OAUTH_CALLBACK_INVALID",
            "Nhà cung cấp không hoàn tất cấp quyền lịch.", status_code=400,
        )
    try:
        def write(cursor, role):
            result = CalendarConnectionService().complete(
                cursor,
                provider=provider,
                state=state,
                code=code,
                current_user_id=role.user_id,
            )
            organization = cursor.execute(
                """SELECT organization_id FROM calendar_connection
                    WHERE id = ? AND user_id = ?""",
                (result["id"], role.user_id),
            ).fetchone()
            if organization is None:
                raise CalendarConnectionError("CALENDAR_CONNECTION_NOT_FOUND")
            log_audit(
                "work_calendar.connection_completed",
                actor_user_id=role.user_id,
                organization_id=organization[0],
                target_type="calendar_connection",
                target_id=result["id"],
                request=request,
                metadata={"provider": provider, "calendarId": result["calendarId"]},
                cursor=cursor,
                required=True,
            )
            return result

        await run_database_write(_callback_blocking, request, write)
        return RedirectResponse(
            "/trung-tam-ho-so?calendarConnection=connected",
            status_code=303,
            headers={"Cache-Control": "private, no-store"},
        )
    except (CalendarConnectionError, WorkCalendarError) as error:
        return error_response(
            request, error.code, "Không thể hoàn tất kết nối lịch.",
            status_code=error.status_code,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return error_response(request, "DATABASE_BUSY", "Hệ thống đang bận.", status_code=503)
    except Exception as error:  # noqa: BLE001
        return log_and_error(
            request, error, "work_calendar_connection_callback",
            "CALENDAR_CONNECTION_CALLBACK_FAILED",
            "Không thể hoàn tất kết nối lịch.",
        )


async def revoke_connection_api(request):
    try:
        connection_id = str(
            request.path_params.get("connection_id") or ""
        ).strip()
        if not connection_id:
            raise CalendarConnectionError("CALENDAR_CONNECTION_NOT_FOUND", status_code=404)

        def write(cursor, role, organization_id):
            result = CalendarConnectionService().revoke(
                cursor,
                organization_id=organization_id,
                user_id=role.user_id,
                connection_id=connection_id,
            )
            log_audit(
                "work_calendar.connection_revoked",
                actor_user_id=role.user_id,
                organization_id=organization_id,
                target_type="calendar_connection",
                target_id=connection_id,
                request=request,
                metadata={"provider": result["provider"]},
                cursor=cursor,
                required=True,
            )
            return result

        result = await run_database_write(_blocking, request, write)
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
    except (CalendarConnectionError, WorkCalendarError) as error:
        return error_response(
            request, error.code, "Không thể ngắt kết nối lịch.",
            status_code=error.status_code,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return error_response(request, "DATABASE_BUSY", "Hệ thống đang bận.", status_code=503)
    except Exception as error:  # noqa: BLE001
        return log_and_error(
            request, error, "work_calendar_connection_revoke",
            "CALENDAR_CONNECTION_REVOKE_FAILED",
            "Không thể ngắt kết nối lịch.",
        )


async def enqueue_delivery_api(request):
    if not calendar_connectors_enabled():
        return error_response(
            request, "CALENDAR_CONNECTOR_DISABLED",
            "Kết nối lịch chưa được bật.", status_code=404,
        )
    try:
        body = await request.json()
        if not isinstance(body, dict) or set(body) != {"connectionId", "sourceItems"}:
            raise CalendarDeliveryError("CALENDAR_DELIVERY_REQUEST_INVALID")

        def write(cursor, role, organization_id):
            result = CalendarDeliveryService().enqueue(
                cursor,
                organization_id=organization_id,
                user_id=role.user_id,
                role=role,
                connection_id=body["connectionId"],
                source_items=body["sourceItems"],
            )
            log_audit(
                "work_calendar.delivery_enqueued",
                actor_user_id=role.user_id,
                organization_id=organization_id,
                target_type="calendar_connection",
                target_id=body["connectionId"],
                request=request,
                metadata={
                    "sourceCount": len(body["sourceItems"]),
                    "queuedCount": result["queuedCount"],
                },
                cursor=cursor,
                required=True,
            )
            return result

        result = await run_database_write(_blocking, request, write)
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
    except (CalendarDeliveryError, WorkCalendarError) as error:
        return error_response(
            request, error.code, "Không thể gửi sự kiện vào hàng đợi lịch.",
            status_code=error.status_code,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return error_response(request, "DATABASE_BUSY", "Hệ thống đang bận.", status_code=503)
    except Exception as error:  # noqa: BLE001
        return log_and_error(
            request, error, "work_calendar_delivery_enqueue",
            "CALENDAR_DELIVERY_ENQUEUE_FAILED",
            "Không thể gửi sự kiện vào hàng đợi lịch.",
        )


async def list_deliveries_api(request):
    if not calendar_connectors_enabled():
        return error_response(
            request, "CALENDAR_CONNECTOR_DISABLED",
            "Kết nối lịch chưa được bật.", status_code=404,
        )
    try:
        connection_id = str(
            request.query_params.get("connectionId") or ""
        ).strip() or None
        result = await run_database_write(
            _blocking,
            request,
            lambda cursor, role, organization_id: CalendarDeliveryService().list_deliveries(
                cursor,
                organization_id=organization_id,
                user_id=role.user_id,
                connection_id=connection_id,
            ),
        )
        return JSONResponse(
            {"deliveries": result},
            headers={"Cache-Control": "private, no-store"},
        )
    except WorkCalendarError as error:
        return error_response(
            request, error.code, "Không có quyền xem trạng thái gửi lịch.",
            status_code=error.status_code,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return error_response(request, "DATABASE_BUSY", "Hệ thống đang bận.", status_code=503)
    except Exception as error:  # noqa: BLE001
        return log_and_error(
            request, error, "work_calendar_delivery_list",
            "CALENDAR_DELIVERY_LIST_FAILED",
            "Không thể tải trạng thái gửi lịch.",
        )


async def retry_delivery_api(request):
    if not calendar_connectors_enabled():
        return error_response(
            request, "CALENDAR_CONNECTOR_DISABLED",
            "Kết nối lịch chưa được bật.", status_code=404,
        )
    try:
        delivery_id = str(request.path_params.get("delivery_id") or "").strip()
        if not delivery_id:
            raise CalendarDeliveryError("CALENDAR_DELIVERY_NOT_FOUND", status_code=404)

        def write(cursor, role, organization_id):
            result = CalendarDeliveryService().retry(
                cursor,
                organization_id=organization_id,
                user_id=role.user_id,
                role=role,
                delivery_id=delivery_id,
            )
            log_audit(
                "work_calendar.delivery_retried",
                actor_user_id=role.user_id,
                organization_id=organization_id,
                target_type="calendar_delivery",
                target_id=delivery_id,
                request=request,
                metadata={"connectionId": result["connectionId"]},
                cursor=cursor,
                required=True,
            )
            return result

        result = await run_database_write(_blocking, request, write)
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
    except (CalendarDeliveryError, WorkCalendarError) as error:
        return error_response(
            request, error.code, "Không thể thử lại việc gửi lịch.",
            status_code=error.status_code,
        )
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        return error_response(request, "DATABASE_BUSY", "Hệ thống đang bận.", status_code=503)
    except Exception as error:  # noqa: BLE001
        return log_and_error(
            request, error, "work_calendar_delivery_retry",
            "CALENDAR_DELIVERY_RETRY_FAILED",
            "Không thể thử lại việc gửi lịch.",
        )


def work_calendar_routes(Route):
    return [
        Route("/api/work-calendar/preview", preview_calendar_api, methods=["POST"]),
        Route("/api/work-calendar/download", download_calendar_api, methods=["POST"]),
        Route(
            "/api/work-calendar/connections/start",
            start_connection_api,
            methods=["POST"],
        ),
        Route(
            "/api/work-calendar/connections",
            list_connections_api,
            methods=["GET"],
        ),
        Route(
            "/api/work-calendar/connections/{provider}/callback",
            connection_callback_api,
            methods=["GET"],
        ),
        Route(
            "/api/work-calendar/connections/{connection_id}/revoke",
            revoke_connection_api,
            methods=["POST"],
        ),
        Route(
            "/api/work-calendar/deliveries/enqueue",
            enqueue_delivery_api,
            methods=["POST"],
        ),
        Route(
            "/api/work-calendar/deliveries",
            list_deliveries_api,
            methods=["GET"],
        ),
        Route(
            "/api/work-calendar/deliveries/{delivery_id}/retry",
            retry_delivery_api,
            methods=["POST"],
        ),
    ]
