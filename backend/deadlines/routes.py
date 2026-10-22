"""Authenticated deadline center API and calendar (.ics) export.

The milestones come from ``build_dashboard_summary``, the same authority the
dashboard alert cards use, so tenant, module, assignment and record scope are
applied exactly as they are there. Only the item limit differs.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import hashlib
import time

from starlette.responses import JSONResponse, Response

from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_http import database_unavailable_response
from backend.shared.database_io import run_database_read
from backend.shared.helpers import (
    OrgPermissionError,
    database,
    get_active_org,
    verify_session,
)
from backend.shared.logging_utils import error_response, log_and_error
from backend.sync.dashboard_summary import ALERT_PRIORITY, build_dashboard_summary


DEADLINE_ITEM_LIMIT = 200
ICS_MAX_EVENTS = 500

ALERT_LABELS = {
    "closingToday": "Đóng thầu hôm nay",
    "closingSoon": "Sắp đóng thầu",
    "overdueOpening": "Quá hạn mở thầu",
    "delayedEvaluation": "Chậm báo cáo đánh giá",
    "contractExpired": "Hợp đồng đã hết hạn",
    "contractExpiring": "Hợp đồng sắp hết hạn",
    "planPublishingWarning": "Cần đăng tải kế hoạch",
    "planPublishingOverdue": "Quá hạn đăng tải kế hoạch",
}

_ROUTES = {
    "package": "/goi-thau-chi-tiet/{id}",
    "plan": "/ke-hoach-chi-tiet/{id}",
    "contract": "/hop-dong-chi-tiet/{id}",
}


def parse_deadline_date(value):
    """Return the calendar date of a stored milestone value, or None."""

    text = str(value or "").strip()
    if not text:
        return None
    for pattern, length in (("%d/%m/%Y", 10), ("%Y-%m-%d", 10)):
        try:
            return datetime.strptime(text[:length], pattern).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def normalize_deadline_item(item):
    """Project one dashboard alert into a stable, display-only deadline row."""

    target_type = str(item.get("targetType") or "package")
    if target_type == "plan":
        code, name = item.get("maKeHoach"), item.get("tenKeHoach")
    elif target_type == "contract":
        code, name = item.get("soHopDong"), item.get("tenHopDong")
    else:
        code, name = item.get("maGoiThau"), item.get("tenGoiThau")
    alert_key = str(item.get("alertKey") or "")
    due = parse_deadline_date(item.get("deadline"))
    record_id = str(item.get("id") or "")
    return {
        "id": f"{target_type}:{record_id}:{alert_key}",
        "targetType": target_type,
        "targetId": record_id,
        "code": str(code or ""),
        "name": str(name or ""),
        "alertKey": alert_key,
        "label": ALERT_LABELS.get(alert_key, alert_key),
        "detail": str(item.get("alertDetail") or ""),
        "deadline": str(item.get("deadline") or ""),
        "dueDate": due.isoformat() if due else None,
        "route": _ROUTES.get(target_type, "/tong-quan").format(id=record_id),
    }


def _load_deadlines(request):
    valid, session = verify_session(request)
    if not valid:
        return None, JSONResponse({"error": session, "code": "AUTH_REQUIRED"}, status_code=403)
    organization_id = get_active_org(request, session.user_id)
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        cursor.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        summary = build_dashboard_summary(
            cursor,
            organization_id,
            session,
            session.user_id,
            alert_limit=DEADLINE_ITEM_LIMIT,
        )
        connection.rollback()
    finally:
        connection.close()
    items = [normalize_deadline_item(item) for item in summary.get("alertItems") or []]
    items.sort(key=lambda row: (
        row["dueDate"] or "9999-12-31",
        ALERT_PRIORITY.get(row["alertKey"], 99),
    ))
    return {
        "items": items,
        "counts": summary.get("alertCounts") or {},
        "evaluationDelayDays": summary.get("evaluationDelayDays"),
        "generatedAt": int(time.time()),
    }, None


def _deadlines_sync(request):
    try:
        payload, rejection = _load_deadlines(request)
        return rejection or JSONResponse(payload)
    except OrgPermissionError as error:
        return error_response(request, error.code, str(error), status_code=error.status_code)
    except Exception as error:  # noqa: BLE001 - bounded public error
        return log_and_error(
            request, error, "deadlines_api", "DEADLINES_LOAD_FAILED",
            "Không thể tải danh sách hạn chót.",
        )


async def list_deadlines_api(request):
    try:
        return await run_database_read(_deadlines_sync, request, timeout_seconds=20.0)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)


def _ics_escape(value):
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _ics_fold(line):
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line
    parts, current = [], b""
    for char in line:
        piece = char.encode("utf-8")
        if len(current) + len(piece) > 74:
            parts.append(current.decode("utf-8"))
            current = b""
        current += piece
    parts.append(current.decode("utf-8"))
    return "\r\n ".join(parts)


def build_deadline_calendar(items, *, public_url="", now=None):
    """Render all-day VEVENTs (RFC 5545). Only codes, labels and names are
    projected; identity, bank, signature or seal fields never enter it."""

    stamp = datetime.fromtimestamp(time.time() if now is None else now, timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//BiddingFlow//Deadline Center//VI",
        "CALSCALE:GREGORIAN",
        "X-WR-CALNAME:BiddingFlow - Hạn chót",
    ]
    for item in items[:ICS_MAX_EVENTS]:
        if not item.get("dueDate"):
            continue
        start = date.fromisoformat(item["dueDate"])
        uid_source = f"{item['id']}|{item['dueDate']}".encode("utf-8")
        uid = hashlib.sha256(uid_source).hexdigest()[:32]
        summary = f"[{item['code']}] {item['label']}" if item.get("code") else item["label"]
        description = item.get("name") or ""
        if item.get("detail"):
            description = f"{description} - {item['detail']}" if description else item["detail"]
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}@biddingflow",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{start.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{(start + timedelta(days=1)).strftime('%Y%m%d')}",
            _ics_fold(f"SUMMARY:{_ics_escape(summary)}"),
            _ics_fold(f"DESCRIPTION:{_ics_escape(description)}"),
            *( [_ics_fold(f"URL:{public_url}{item['route']}")] if public_url else [] ),
            "BEGIN:VALARM",
            "TRIGGER:-P1D",
            "ACTION:DISPLAY",
            _ics_fold(f"DESCRIPTION:{_ics_escape(summary)}"),
            "END:VALARM",
            "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def _deadline_calendar_sync(request):
    import os

    try:
        payload, rejection = _load_deadlines(request)
        if rejection:
            return rejection
        body = build_deadline_calendar(
            payload["items"],
            public_url=os.environ.get("APP_PUBLIC_URL", "").strip().rstrip("/"),
        )
        return Response(
            body,
            media_type="text/calendar; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="biddingflow-han-chot.ics"'},
        )
    except OrgPermissionError as error:
        return error_response(request, error.code, str(error), status_code=error.status_code)
    except Exception as error:  # noqa: BLE001 - bounded public error
        return log_and_error(
            request, error, "deadlines_calendar_api", "DEADLINES_CALENDAR_FAILED",
            "Không thể tạo lịch hạn chót.",
        )


async def deadline_calendar_api(request):
    try:
        return await run_database_read(_deadline_calendar_sync, request, timeout_seconds=20.0)
    except (BlockingIOBusyError, BlockingIOTimeoutError) as error:
        return database_unavailable_response(request, error)


def deadline_routes(Route):
    return [
        Route("/api/deadlines", list_deadlines_api, methods=["GET"]),
        Route("/api/deadlines/calendar.ics", deadline_calendar_api, methods=["GET"]),
    ]
