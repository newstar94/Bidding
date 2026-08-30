"""Strict validation and persistence for minimal commercial UI intent."""

from __future__ import annotations

import time
import uuid

from .privacy import analytics_identifier
from .taxonomy import (
    COMMERCIAL_EVENT_KEYS,
    COMMERCIAL_FEEDBACK_MOMENTS,
    COMMERCIAL_FEEDBACK_REASONS,
    EVENT_SOURCES,
    OWNER_KINDS,
    SIZE_BUCKETS,
)

ALLOWED_FIELDS = frozenset({
    "event", "eventId", "ownerKind", "sizeBucket", "skuCode",
    "commercialReleaseId", "source", "occurredAt",
})
MAX_CLOCK_SKEW_SECONDS = 5 * 60
MAX_EVENT_AGE_SECONDS = 24 * 60 * 60


class AnalyticsEventError(ValueError):
    pass


def _bounded_text(value, field, *, maximum=128, required=False):
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise AnalyticsEventError(f"{field} không hợp lệ.")
    normalized = value.strip()
    if (required and not normalized) or len(normalized) > maximum:
        raise AnalyticsEventError(f"{field} không hợp lệ.")
    return normalized or None


def normalize_commercial_event(payload, *, user_id, workspace_id, hmac_key, now=None):
    if not isinstance(payload, dict) or set(payload) - ALLOWED_FIELDS:
        raise AnalyticsEventError("Analytics event không nhận trường ngoài contract.")
    current = int(time.time() if now is None else now)
    event_name = _bounded_text(payload.get("event"), "event", required=True)
    if event_name not in COMMERCIAL_EVENT_KEYS:
        raise AnalyticsEventError("Analytics event không được hỗ trợ.")
    release_id = _bounded_text(
        payload.get("commercialReleaseId"), "commercialReleaseId", maximum=200,
        required=True,
    )
    owner_kind = _bounded_text(payload.get("ownerKind") or "account", "ownerKind")
    if owner_kind not in OWNER_KINDS:
        raise AnalyticsEventError("ownerKind không được hỗ trợ.")
    size_bucket = _bounded_text(payload.get("sizeBucket") or "unknown", "sizeBucket")
    if size_bucket not in SIZE_BUCKETS:
        raise AnalyticsEventError("sizeBucket không được hỗ trợ.")
    source = _bounded_text(payload.get("source") or "commercial_storefront", "source")
    if source not in EVENT_SOURCES:
        raise AnalyticsEventError("source không được hỗ trợ.")
    try:
        event_id = str(uuid.UUID(_bounded_text(payload.get("eventId") or str(uuid.uuid4()), "eventId", required=True)))
    except (ValueError, AttributeError) as exc:
        raise AnalyticsEventError("eventId không hợp lệ.") from exc
    occurred_at = payload.get("occurredAt", current)
    if isinstance(occurred_at, bool) or not isinstance(occurred_at, int):
        raise AnalyticsEventError("occurredAt không hợp lệ.")
    if occurred_at > current + MAX_CLOCK_SKEW_SECONDS or occurred_at < current - MAX_EVENT_AGE_SECONDS:
        raise AnalyticsEventError("occurredAt nằm ngoài cửa sổ cho phép.")
    return {
        "event_id": event_id,
        "event_name": event_name,
        "analytics_user_id": analytics_identifier("user", user_id, hmac_key),
        "analytics_workspace_id": analytics_identifier("workspace", workspace_id, hmac_key),
        "owner_kind": owner_kind,
        "size_bucket": size_bucket,
        "sku_code": _bounded_text(payload.get("skuCode"), "skuCode", maximum=200),
        "commercial_release_id": release_id,
        "source": source,
        "occurred_at": occurred_at,
        "received_at": current,
    }


def insert_commercial_event(cursor, event):
    result = cursor.execute(
        """INSERT INTO commercial_analytics_events (
               event_id, event_name, analytics_user_id, analytics_workspace_id,
               owner_kind, size_bucket, sku_code, commercial_release_id,
               source, occurred_at, received_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event_id) DO NOTHING""",
        tuple(event[key] for key in (
            "event_id", "event_name", "analytics_user_id", "analytics_workspace_id",
            "owner_kind", "size_bucket", "sku_code", "commercial_release_id",
            "source", "occurred_at", "received_at",
        )),
    )
    return result.rowcount == 1


def normalize_commercial_feedback(payload, *, workspace_id, hmac_key, now=None):
    allowed = {"feedbackId", "moment", "reason", "ownerKind", "commercialReleaseId", "occurredAt"}
    if not isinstance(payload, dict) or set(payload) - allowed:
        raise AnalyticsEventError("Commercial feedback không nhận trường ngoài contract.")
    current = int(time.time() if now is None else now)
    moment = _bounded_text(payload.get("moment"), "moment", required=True)
    reason = _bounded_text(payload.get("reason"), "reason", required=True)
    owner_kind = _bounded_text(payload.get("ownerKind") or "account", "ownerKind")
    release_id = _bounded_text(payload.get("commercialReleaseId"), "commercialReleaseId", maximum=200, required=True)
    if moment not in COMMERCIAL_FEEDBACK_MOMENTS or reason not in COMMERCIAL_FEEDBACK_REASONS:
        raise AnalyticsEventError("Commercial feedback không được hỗ trợ.")
    if owner_kind not in OWNER_KINDS:
        raise AnalyticsEventError("ownerKind không được hỗ trợ.")
    try:
        feedback_id = str(uuid.UUID(_bounded_text(payload.get("feedbackId") or str(uuid.uuid4()), "feedbackId", required=True)))
    except (ValueError, AttributeError) as exc:
        raise AnalyticsEventError("feedbackId không hợp lệ.") from exc
    occurred_at = payload.get("occurredAt", current)
    if isinstance(occurred_at, bool) or not isinstance(occurred_at, int):
        raise AnalyticsEventError("occurredAt không hợp lệ.")
    if occurred_at > current + MAX_CLOCK_SKEW_SECONDS or occurred_at < current - MAX_EVENT_AGE_SECONDS:
        raise AnalyticsEventError("occurredAt nằm ngoài cửa sổ cho phép.")
    return {
        "feedback_id": feedback_id,
        "analytics_workspace_id": analytics_identifier("workspace", workspace_id, hmac_key),
        "owner_kind": owner_kind,
        "moment": moment,
        "reason": reason,
        "commercial_release_id": release_id,
        "occurred_at": occurred_at,
        "received_at": current,
    }


def insert_commercial_feedback(cursor, feedback):
    result = cursor.execute(
        """INSERT INTO commercial_feedback
           (feedback_id,analytics_workspace_id,owner_kind,moment,reason,
            commercial_release_id,occurred_at,received_at)
           VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(feedback_id) DO NOTHING""",
        tuple(feedback[key] for key in (
            "feedback_id", "analytics_workspace_id", "owner_kind", "moment", "reason",
            "commercial_release_id", "occurred_at", "received_at",
        )),
    )
    return result.rowcount == 1
