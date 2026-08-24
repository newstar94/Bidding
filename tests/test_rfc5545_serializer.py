from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from backend.work_calendar.rfc5545 import CalendarEvent, serialize_calendar


UTC = timezone.utc


def _parse_icalendar_independently(payload):
    """Minimal test parser independent from the production serializer."""

    assert payload.endswith(b"\r\n")
    assert b"\n" not in payload.replace(b"\r\n", b"")
    physical_lines = payload.decode("utf-8").split("\r\n")[:-1]
    logical_lines = []
    for line in physical_lines:
        if line.startswith((" ", "\t")):
            assert logical_lines
            logical_lines[-1] += line[1:]
        else:
            logical_lines.append(line)
    stack = []
    components = []
    for line in logical_lines:
        name_and_params, separator, value = line.partition(":")
        assert separator == ":"
        name = name_and_params.split(";", 1)[0]
        if name == "BEGIN":
            stack.append({"name": value, "properties": {}})
            continue
        if name == "END":
            component = stack.pop()
            assert component["name"] == value
            components.append(component)
            continue
        assert stack
        stack[-1]["properties"].setdefault(name_and_params, []).append(value)
    assert stack == []
    return components


def test_serializes_a_stable_utc_event_with_crlf_and_exact_revision_fields():
    event = CalendarEvent(
        uid="package-root:BID_CLOSING@biddingflow.local",
        sequence=3,
        dtstamp=datetime(2026, 8, 24, 1, 2, 3, tzinfo=UTC),
        start=datetime(2026, 9, 1, 2, 30, tzinfo=UTC),
        end=datetime(2026, 9, 1, 3, 30, tzinfo=UTC),
        summary="Đóng thầu",
    )

    payload = serialize_calendar([event], prod_id="-//BiddingFlow//Work Calendar 1.0//VI")

    assert payload == (
        "BEGIN:VCALENDAR\r\n"
        "PRODID:-//BiddingFlow//Work Calendar 1.0//VI\r\n"
        "VERSION:2.0\r\n"
        "CALSCALE:GREGORIAN\r\n"
        "BEGIN:VEVENT\r\n"
        "UID:package-root:BID_CLOSING@biddingflow.local\r\n"
        "DTSTAMP:20260824T010203Z\r\n"
        "SEQUENCE:3\r\n"
        "STATUS:CONFIRMED\r\n"
        "DTSTART:20260901T023000Z\r\n"
        "DTEND:20260901T033000Z\r\n"
        "SUMMARY:Đóng thầu\r\n"
        "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    ).encode("utf-8")
    assert b"\n" not in payload.replace(b"\r\n", b"")
    components = _parse_icalendar_independently(payload)
    event_component = next(item for item in components if item["name"] == "VEVENT")
    assert event_component["properties"]["UID"] == [
        "package-root:BID_CLOSING@biddingflow.local"
    ]
    calendar_component = next(item for item in components if item["name"] == "VCALENDAR")
    assert "METHOD" not in calendar_component["properties"]


def test_escapes_text_and_uses_exclusive_date_end_for_all_day_events():
    event = CalendarEvent(
        uid="event-1@example.test",
        sequence=0,
        dtstamp=datetime(2026, 8, 24, tzinfo=UTC),
        start=date(2026, 9, 1),
        end=date(2026, 9, 2),
        summary="Mốc, chính; thức\\A",
        description="Dòng 1\r\nDòng 2",
        location="Phòng A; tầng 2",
    )

    text = serialize_calendar([event]).decode("utf-8")

    assert "DTSTART;VALUE=DATE:20260901\r\n" in text
    assert "DTEND;VALUE=DATE:20260902\r\n" in text
    assert "SUMMARY:Mốc\\, chính\\; thức\\\\A\r\n" in text
    assert "DESCRIPTION:Dòng 1\\nDòng 2\r\n" in text
    assert "LOCATION:Phòng A\\; tầng 2\r\n" in text


def test_forward_slash_and_colon_are_not_text_escaped():
    event = CalendarEvent(
        uid="case:deadline@example.test",
        sequence=0,
        dtstamp=datetime(2026, 8, 24, tzinfo=UTC),
        start=date(2026, 9, 1),
        summary="Họp: phòng A/B",
        description="https://example.test/case:123",
    )

    text = serialize_calendar([event]).decode("utf-8")

    assert "UID:case:deadline@example.test\r\n" in text
    assert "SUMMARY:Họp: phòng A/B\r\n" in text
    assert "DESCRIPTION:https://example.test/case:123\r\n" in text
    assert "\\/" not in text
    assert "\\:" not in text


@pytest.mark.parametrize(
    "zone_name",
    ["Asia/Ho_Chi_Minh", "America/New_York"],
)
def test_rejects_local_and_dst_zones_until_timezone_policy_is_approved(zone_name):
    with pytest.raises(ValueError, match="UTC-aware"):
        serialize_calendar([CalendarEvent(
            uid="zoned@example.test",
            sequence=0,
            dtstamp=datetime(2026, 8, 24, tzinfo=UTC),
            start=datetime(2026, 9, 1, 9, tzinfo=ZoneInfo(zone_name)),
            summary="Mốc",
        )])


def test_folds_long_utf8_content_lines_at_75_octets_without_splitting_characters():
    summary = "Lịch công việc đấu thầu — " + ("Việt Nam " * 20)
    payload = serialize_calendar([CalendarEvent(
        uid="long-event@example.test",
        sequence=1,
        dtstamp=datetime(2026, 8, 24, tzinfo=UTC),
        start=date(2026, 9, 1),
        summary=summary,
    )])

    physical_lines = payload.split(b"\r\n")
    assert all(len(line) <= 75 for line in physical_lines)
    assert any(line.startswith(b" ") for line in physical_lines)
    payload.decode("utf-8")
    unfolded = payload.replace(b"\r\n ", b"")
    assert f"SUMMARY:{summary}\r\n".encode() in unfolded


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"uid": ""}, "UID"),
        ({"sequence": -1}, "SEQUENCE"),
        ({"dtstamp": datetime(2026, 8, 24)}, "UTC-aware"),
        ({"start": datetime(2026, 9, 1)}, "UTC-aware"),
        ({"start": date(2026, 9, 1), "end": datetime(2026, 9, 2, tzinfo=UTC)}, "same value type"),
        ({"start": date(2026, 9, 2), "end": date(2026, 9, 2)}, "later than"),
    ],
)
def test_rejects_ambiguous_or_invalid_event_contracts(overrides, message):
    values = {
        "uid": "event@example.test",
        "sequence": 0,
        "dtstamp": datetime(2026, 8, 24, tzinfo=UTC),
        "start": date(2026, 9, 1),
        "end": None,
        "summary": "Mốc",
        **overrides,
    }

    with pytest.raises(ValueError, match=message):
        serialize_calendar([CalendarEvent(**values)])
