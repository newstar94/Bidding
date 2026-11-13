"""Pure rules for the bid-validity and overdue-milestone dashboard alerts (ADR 0103).

The browser keeps an equivalent copy of the bid-validity rule in
``frontend/app/dashboardAlertRules.js`` for the offline dashboard fallback.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from backend.shared.date_utils import parse_datetime_value


BID_VALIDITY_WARNING_DAYS = 7
# Effective package statuses whose bids are still being evaluated.
BID_VALIDITY_STATUSES = frozenset({"OPENED", "EVALUATING", "PARTIALLY_AWARDED"})


def _positive_days(value) -> int:
    try:
        days = int(str(value).strip())
    except (TypeError, ValueError):
        return 0
    return days if days > 0 else 0


def latest_closing_datetime(package_closing, extension_closings=()) -> datetime | None:
    """Latest closing time across the package and its saved extensions."""

    candidates = [parse_datetime_value(package_closing)]
    candidates.extend(parse_datetime_value(value) for value in extension_closings or ())
    values = [value for value in candidates if value is not None]
    return max(values) if values else None


def validity_last_day(closing_at, days) -> date | None:
    """Last valid day when the closing day itself counts as day one.

    A validity of ``N`` days "kể từ ngày có thời điểm đóng thầu" covers the
    closing day and the following ``N - 1`` days.
    """

    count = _positive_days(days)
    closing = parse_datetime_value(closing_at) if not isinstance(closing_at, datetime) else closing_at
    if closing is None or count == 0:
        return None
    return closing.date() + timedelta(days=count - 1)


def bid_validity_deadline(closing_at, hsdt_days, security_days) -> date | None:
    """Earliest last-valid day of the bid and the bid security."""

    deadlines = [
        value
        for value in (
            validity_last_day(closing_at, hsdt_days),
            validity_last_day(closing_at, security_days),
        )
        if value is not None
    ]
    return min(deadlines) if deadlines else None


def bid_validity_alert(status_code, closing_at, hsdt_days, security_days, today: date):
    """Return ``(deadline, days_left)`` when the alert applies, else ``None``."""

    if str(status_code or "").upper() not in BID_VALIDITY_STATUSES:
        return None
    deadline = bid_validity_deadline(closing_at, hsdt_days, security_days)
    if deadline is None or deadline > today + timedelta(days=BID_VALIDITY_WARNING_DAYS):
        return None
    return deadline, (deadline - today).days


def bid_validity_detail(days_left: int) -> str:
    if days_left < 0:
        return f"Đã hết hiệu lực {abs(days_left)} ngày"
    if days_left == 0:
        return "Hết hiệu lực trong hôm nay"
    return f"Còn {days_left} ngày hiệu lực"


def calendar_day(value) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    parsed = parse_datetime_value(value)
    return parsed.date().isoformat() if parsed is not None else ""


def timeline_row_is_overdue(row, today: date) -> bool:
    """Same overdue rule the timeline Word context uses for one effective row."""

    planned = calendar_day(row.get("ngay_du_kien"))
    return bool(
        row.get("applicability") == "APPLICABLE"
        and planned
        and not row.get("ngay_thuc_te")
        and row.get("trang_thai") not in {"DONE", "NOT_APPLICABLE"}
        and planned < today.isoformat()
    )


def overdue_milestones(rows, today: date):
    """Overdue effective rows ordered by planned date, then title."""

    overdue = [row for row in rows or () if timeline_row_is_overdue(row, today)]
    return sorted(overdue, key=lambda row: (calendar_day(row.get("ngay_du_kien")), str(row.get("title") or "")))


def milestone_overdue_detail(rows) -> str:
    if not rows:
        return ""
    first = str(rows[0].get("title") or rows[0].get("cong_viec") or "Mốc tiến độ").strip()
    return first if len(rows) == 1 else f"{first} và {len(rows) - 1} mốc khác"
