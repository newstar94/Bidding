"""Small RFC 5545 serializer for canonical DATE or UTC DATE-TIME events.

This module deliberately does not project BiddingFlow records into events. Field
selection, timezone/local-time policy, UID derivation and revision semantics stay
behind DG-19-01. There is no route, filesystem write, OAuth or provider adapter.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Iterable


CRLF = b"\r\n"
MAX_CONTENT_LINE_OCTETS = 75
DEFAULT_PROD_ID = "-//BiddingFlow//Work Calendar 1.0//VI"


@dataclass(frozen=True, slots=True)
class CalendarEvent:
    uid: str
    sequence: int
    dtstamp: datetime
    start: date | datetime
    summary: str
    end: date | datetime | None = None
    description: str = ""
    location: str = ""
    status: str = "CONFIRMED"


def _escape_text(value: object) -> str:
    text = str(value or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return (
        text.replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace(";", "\\;")
        .replace(",", "\\,")
    )


def _utf8_chunks(value: str) -> list[bytes]:
    chunks: list[bytes] = []
    current = bytearray()
    limit = MAX_CONTENT_LINE_OCTETS
    for character in value:
        encoded = character.encode("utf-8")
        if current and len(current) + len(encoded) > limit:
            chunks.append(bytes(current))
            current.clear()
            # Continuation whitespace is part of the 75-octet physical line.
            limit = MAX_CONTENT_LINE_OCTETS - 1
        if len(encoded) > limit:
            raise ValueError("A UTF-8 character exceeds the RFC content-line limit.")
        current.extend(encoded)
    chunks.append(bytes(current))
    return chunks


def _fold_content_line(value: str) -> list[bytes]:
    chunks = _utf8_chunks(value)
    if not chunks:
        return [b""]
    return [chunks[0], *(b" " + chunk for chunk in chunks[1:])]


def _utc_datetime(value: datetime, field: str) -> str:
    if value.tzinfo is None or value.utcoffset() is None or value.utcoffset().total_seconds() != 0:
        raise ValueError(f"{field} must be UTC-aware until timezone policy is approved.")
    return value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _is_datetime(value: object) -> bool:
    return isinstance(value, datetime)


def _is_plain_date(value: object) -> bool:
    return isinstance(value, date) and not isinstance(value, datetime)


def _event_lines(event: CalendarEvent) -> list[str]:
    uid = str(event.uid or "").strip()
    if not uid:
        raise ValueError("UID is required.")
    if isinstance(event.sequence, bool) or not isinstance(event.sequence, int) or event.sequence < 0:
        raise ValueError("SEQUENCE must be a non-negative integer.")
    status = str(event.status or "").strip().upper()
    if status not in {"CONFIRMED", "TENTATIVE", "CANCELLED"}:
        raise ValueError("STATUS must be CONFIRMED, TENTATIVE or CANCELLED.")

    dtstamp = _utc_datetime(event.dtstamp, "DTSTAMP")
    start_is_date = _is_plain_date(event.start)
    start_is_datetime = _is_datetime(event.start)
    if not start_is_date and not start_is_datetime:
        raise ValueError("DTSTART must be DATE or UTC-aware DATE-TIME.")

    if start_is_datetime:
        start_line = f"DTSTART:{_utc_datetime(event.start, 'DTSTART')}"
    else:
        start_line = f"DTSTART;VALUE=DATE:{event.start.strftime('%Y%m%d')}"

    end_line = None
    if event.end is not None:
        if start_is_date != _is_plain_date(event.end) or start_is_datetime != _is_datetime(event.end):
            raise ValueError("DTEND must use the same value type as DTSTART.")
        if event.end <= event.start:
            raise ValueError("DTEND must be later than DTSTART.")
        end_line = (
            f"DTEND:{_utc_datetime(event.end, 'DTEND')}"
            if start_is_datetime
            else f"DTEND;VALUE=DATE:{event.end.strftime('%Y%m%d')}"
        )

    lines = [
        "BEGIN:VEVENT",
        f"UID:{_escape_text(uid)}",
        f"DTSTAMP:{dtstamp}",
        f"SEQUENCE:{event.sequence}",
        f"STATUS:{status}",
        start_line,
    ]
    if end_line:
        lines.append(end_line)
    if event.summary:
        lines.append(f"SUMMARY:{_escape_text(event.summary)}")
    if event.description:
        lines.append(f"DESCRIPTION:{_escape_text(event.description)}")
    if event.location:
        lines.append(f"LOCATION:{_escape_text(event.location)}")
    lines.append("END:VEVENT")
    return lines


def serialize_calendar(
    events: Iterable[CalendarEvent],
    *,
    prod_id: str = DEFAULT_PROD_ID,
) -> bytes:
    """Serialize already-projected canonical events to UTF-8 iCalendar bytes."""

    product_identifier = str(prod_id or "").strip()
    if not product_identifier:
        raise ValueError("PRODID is required.")
    logical_lines = [
        "BEGIN:VCALENDAR",
        f"PRODID:{_escape_text(product_identifier)}",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
    ]
    for event in events:
        if not isinstance(event, CalendarEvent):
            raise ValueError("Every calendar event must be a CalendarEvent.")
        logical_lines.extend(_event_lines(event))
    logical_lines.append("END:VCALENDAR")
    physical_lines = [
        physical_line
        for logical_line in logical_lines
        for physical_line in _fold_content_line(logical_line)
    ]
    return CRLF.join(physical_lines) + CRLF
