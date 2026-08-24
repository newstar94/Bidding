"""Authorized-source-independent projection for Work Calendar snapshots."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, datetime, timedelta, timezone

from backend.documents.timeline_context_service import _load_related
from backend.timeline.effective_timeline import (
    TIMELINE_TEMPLATE_VERSION,
    build_effective_timeline,
)

from .repository import CalendarRepository
from .rfc5545 import CalendarEvent, serialize_calendar


POLICY_VERSION = "work-calendar-outbound-v1"
UID_NAMESPACE = uuid.UUID("7ee3cd1c-84b3-5ee7-a58f-c7b3ab57dc8f")
MAX_EVENTS = 500
MAX_ICS_BYTES = 1024 * 1024


class WorkCalendarError(ValueError):
    def __init__(self, code, *, fields=None, status_code=400):
        super().__init__(code)
        self.code = code
        self.fields = fields or {}
        self.status_code = status_code


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), default=str)


def _sha(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _revision_time(value):
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


class WorkCalendar:
    def __init__(self, cursor):
        self.cursor = cursor
        self.repository = CalendarRepository(cursor)

    def project(self, organization_id, source_items):
        if not isinstance(source_items, list) or not source_items:
            raise WorkCalendarError("WORK_CALENDAR_SELECTION_REQUIRED")
        if len(source_items) > MAX_EVENTS:
            raise WorkCalendarError("WORK_CALENDAR_SELECTION_TOO_LARGE")
        projected = []
        for source in source_items:
            if not isinstance(source, dict) or set(source) != {"sourceType", "sourceId"}:
                raise WorkCalendarError("WORK_CALENDAR_SOURCE_INVALID")
            source_type = source["sourceType"]
            source_id = str(source["sourceId"] or "").strip()
            if source_type == "PACKAGE_TIMELINE":
                projected.extend(self._package_events(organization_id, source_id))
            elif source_type == "CASE_DEADLINE":
                projected.extend(self._case_events(organization_id, source_id))
            else:
                raise WorkCalendarError("WORK_CALENDAR_SOURCE_UNSUPPORTED")
            if len(projected) > MAX_EVENTS:
                raise WorkCalendarError("WORK_CALENDAR_EVENT_LIMIT_EXCEEDED")
        return [self._resolve(organization_id, item) for item in projected]

    def export_ics(self, events):
        content = serialize_calendar([item["event"] for item in events])
        if len(content) > MAX_ICS_BYTES:
            raise WorkCalendarError("WORK_CALENDAR_FILE_TOO_LARGE")
        return content

    def _package_events(self, organization_id, package_id):
        package_row = self.cursor.execute(
            "SELECT * FROM goi_thau WHERE organization_id = ? AND id = ? AND archived_at IS NULL",
            (organization_id, package_id),
        ).fetchone()
        if not package_row:
            raise WorkCalendarError("WORK_CALENDAR_SOURCE_NOT_FOUND", status_code=404)
        package = dict(package_row)
        plan_row = self.cursor.execute(
            "SELECT * FROM ke_hoach_lcnt WHERE organization_id = ? AND id = ?",
            (organization_id, package.get("ke_hoach_id")),
        ).fetchone()
        plan = dict(plan_row) if plan_row else {}
        related = _load_related(self.cursor, organization_id, package_id)
        related["plan"] = plan
        saved = [dict(row) for row in self.cursor.execute(
            """SELECT * FROM goi_thau_moc_tien_do
                WHERE organization_id = ? AND goi_thau_id = ?
                ORDER BY sort_order, ma_moc, id""",
            (organization_id, package_id),
        ).fetchall()]
        root_id = package.get("id_goc") or package_id
        code = package.get("ma_goi_thau") or package_id
        package_name = package.get("ten_goi_thau") or ""
        plan_name = plan.get("ten_ke_hoach") or ""
        result = []
        for row in build_effective_timeline(package, related, saved):
            if row["applicability"] != "APPLICABLE":
                continue
            raw_date = row.get("ngay_thuc_te") or row.get("ngay_du_kien")
            if not raw_date:
                continue
            start = date.fromisoformat(str(raw_date)[:10])
            key = ":".join(("timeline", str(root_id), row["milestone_key"],
                            row.get("instance_key") or "base"))
            result.append({
                "eventKey": key, "sourceType": "PACKAGE_TIMELINE",
                "sourceRef": package_id,
                "summary": f"{code} · {row['title']}",
                "description": " · ".join(value for value in (
                    plan_name, package_name, f"/goi-thau/{package_id}"
                ) if value),
                "start": start, "end": start + timedelta(days=1),
                "sourceFingerprint": _sha(_canonical({
                    "packageVersionId": package_id,
                    "milestone": row["milestone_key"],
                    "instance": row.get("instance_key") or "base",
                    "timelineVersion": TIMELINE_TEMPLATE_VERSION,
                })),
            })
        return result

    def _case_events(self, organization_id, case_id):
        row = self.cursor.execute(
            """SELECT case_row.case_no, case_row.subject, case_row.due_at,
                      case_row.row_version, case_row.state,
                      target.package_lineage_root_id,
                      COALESCE((
                          SELECT candidate.id FROM goi_thau AS candidate
                           WHERE candidate.organization_id = target.organization_id
                             AND COALESCE(candidate.id_goc, candidate.id) = target.package_lineage_root_id
                             AND candidate.is_latest = 1
                             AND candidate.archived_at IS NULL
                           ORDER BY CAST(candidate.phien_ban AS INTEGER) DESC, candidate.id
                           LIMIT 1
                      ), target.current_package_version_id)
                 FROM procurement_case AS case_row
                 JOIN procurement_case_package_target AS target
                   ON target.organization_id = case_row.organization_id
                  AND target.case_id = case_row.id
                WHERE case_row.organization_id = ? AND case_row.id = ?""",
            (organization_id, case_id),
        ).fetchone()
        if not row:
            raise WorkCalendarError("WORK_CALENDAR_SOURCE_NOT_FOUND", status_code=404)
        if not row[2]:
            return []
        raw = str(row[2]).strip()
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            parsed = None
        if parsed and ("T" in raw or " " in raw):
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone(timedelta(hours=7)))
            start = parsed.astimezone(timezone.utc)
            end = start + timedelta(hours=1)
        else:
            start = date.fromisoformat(raw[:10])
            end = start + timedelta(days=1)
        return [{
            "eventKey": f"case:{row[5]}:{case_id}:due",
            "sourceType": "CASE_DEADLINE", "sourceRef": case_id,
            "summary": f"{row[0]} · Hạn xử lý hồ sơ",
            "description": f"{row[1]} · /procurement-cases/{case_id}",
            "start": start, "end": end,
            "sourceFingerprint": _sha(_canonical({
                "caseId": case_id, "packageVersionId": row[6],
                "dueProvenance": "MANUAL", "deadlineStatus": "NOT_EVALUATED",
            })),
        }]

    def _resolve(self, organization_id, item):
        significant = {
            "summary": item["summary"], "description": item["description"],
            "location": "", "start": item["start"], "end": item["end"],
            "status": "CONFIRMED",
        }
        payload_hash = _sha(_canonical(significant))
        uid = f"{uuid.uuid5(UID_NAMESPACE, item['eventKey'])}@calendar.biddingflow.local"
        head = self.repository.resolve_head(
            organization_id, item["eventKey"], uid, payload_hash,
            item["sourceFingerprint"], POLICY_VERSION,
            item["sourceType"], item["sourceRef"],
        )
        event = CalendarEvent(
            uid=uid, sequence=head["sequence"],
            dtstamp=_revision_time(head["canonicalRevisionAt"]),
            start=item["start"], end=item["end"], summary=item["summary"],
            description=item["description"], location="",
        )
        return {
            **item, "eventHeadId": head["id"], "uid": uid,
            "sequence": head["sequence"],
            "canonicalRevisionAt": head["canonicalRevisionAt"],
            "significantPayloadHash": payload_hash, "event": event,
        }

    @staticmethod
    def preview(events):
        result = []
        for item in events:
            value = {key: field for key, field in item.items() if key != "event"}
            for key in ("start", "end", "canonicalRevisionAt"):
                if value.get(key) is not None:
                    value[key] = str(value[key])
            value["valueType"] = (
                "DATE_TIME" if isinstance(item["start"], datetime) else "DATE"
            )
            value["timezone"] = "UTC" if value["valueType"] == "DATE_TIME" else None
            result.append(value)
        return result
