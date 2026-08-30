"""Bounded product telemetry and deterministic global aggregation.

The hourly rollup stores only code-owned metric/feature keys and opaque owner
identifiers. It intentionally has no free-form metadata, route, query string,
record identifier, IP address, or session token columns.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time as datetime_time, timedelta, timezone
import time
from typing import Any, Mapping
from zoneinfo import ZoneInfo

from backend.shared.logging_utils import log_error
from backend.shared.workspace_scope import personal_scope_owner_id


PRODUCT_TIMEZONE_NAME = "Asia/Ho_Chi_Minh"
PRODUCT_TIMEZONE = ZoneInfo(PRODUCT_TIMEZONE_NAME)
ONLINE_WINDOW_SECONDS = 120
MAX_SUMMARY_RANGE_DAYS = 366
MAX_HOURLY_RANGE_DAYS = 31
FEATURE_EVENT_HOURLY_CAP = 60

PRESENCE_METRIC = "presence.heartbeat"
FEATURE_METRIC = "feature.used"
WORD_EXPORT_METRIC = "word_export.completed"

FEATURE_LABELS = {
    "dashboard": "Tổng quan",
    "plans": "Kế hoạch lựa chọn nhà thầu",
    "packages": "Gói thầu",
    "timeline": "Timeline gói thầu",
    "bid-opening": "Mở thầu",
    "bid-evaluation": "Đánh giá hồ sơ dự thầu",
    "investors": "Chủ đầu tư",
    "contractors": "Nhà thầu",
    "experts": "Chuyên gia",
    "contracts": "Hợp đồng",
    "templates": "Biểu mẫu Word",
    "word-publication": "Xuất bản Word",
    "account-admin": "Quản lý tài khoản",
    "commercial": "Thương mại và thanh toán",
    "usage-analytics": "Phân tích sử dụng",
    "profile": "Trang cá nhân",
}
FEATURE_KEYS = frozenset(FEATURE_LABELS)
CLIENT_EVENT_TYPES = frozenset({"heartbeat", "feature_used"})


class UsageAnalyticsInputError(ValueError):
    """The caller supplied a value outside the code-owned analytics contract."""


@dataclass(frozen=True, slots=True)
class SummaryWindow:
    from_date: date
    to_date: date
    start_epoch: int
    end_epoch: int
    bucket: str
    bucket_seconds: int


def _parse_iso_date(value: Any, field: str) -> date:
    raw = str(value or "").strip()
    try:
        parsed = date.fromisoformat(raw)
    except (TypeError, ValueError) as exc:
        raise UsageAnalyticsInputError(f"{field} phải có định dạng YYYY-MM-DD.") from exc
    if parsed.isoformat() != raw:
        raise UsageAnalyticsInputError(f"{field} phải có định dạng YYYY-MM-DD.")
    return parsed


def parse_summary_window(
    parameters: Mapping[str, Any],
    *,
    now: datetime | None = None,
) -> SummaryWindow:
    """Parse a half-open local-date window without depending on server locale."""

    del now  # Reserved for a future explicit default-range contract.
    start_date = _parse_iso_date(parameters.get("from"), "from")
    end_date = _parse_iso_date(parameters.get("to"), "to")
    if end_date < start_date:
        raise UsageAnalyticsInputError("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.")
    bucket = str(parameters.get("bucket") or "hour").strip().lower()
    if bucket not in {"hour", "day"}:
        raise UsageAnalyticsInputError("bucket chỉ hỗ trợ hour hoặc day.")
    inclusive_days = (end_date - start_date).days + 1
    maximum_days = (
        MAX_HOURLY_RANGE_DAYS if bucket == "hour" else MAX_SUMMARY_RANGE_DAYS
    )
    if inclusive_days > maximum_days:
        raise UsageAnalyticsInputError(
            f"Khoảng thống kê theo {bucket} không được vượt quá {maximum_days} ngày."
        )
    start = datetime.combine(start_date, datetime_time.min, PRODUCT_TIMEZONE)
    end = datetime.combine(end_date + timedelta(days=1), datetime_time.min, PRODUCT_TIMEZONE)
    return SummaryWindow(
        from_date=start_date,
        to_date=end_date,
        start_epoch=int(start.timestamp()),
        end_epoch=int(end.timestamp()),
        bucket=bucket,
        bucket_seconds=3_600 if bucket == "hour" else 86_400,
    )


def _owner_type(organization_id: str, user_id: str) -> str:
    personal_owner = personal_scope_owner_id(organization_id)
    if personal_owner is None:
        return "organization"
    if personal_owner != str(user_id or "").strip():
        raise UsageAnalyticsInputError("Personal workspace không thuộc người dùng hiện tại.")
    return "personal"


def _hour_start(epoch: int) -> int:
    return int(epoch) - int(epoch) % 3_600


def _normalize_feature(feature: Any, *, required: bool) -> str:
    normalized = str(feature or "").strip().lower()
    if required and not normalized:
        raise UsageAnalyticsInputError("feature là bắt buộc cho feature_used.")
    if normalized and normalized not in FEATURE_KEYS:
        raise UsageAnalyticsInputError("feature không thuộc danh mục được hỗ trợ.")
    return normalized


def record_client_event(
    cursor,
    *,
    event_type: str,
    user_id: str,
    organization_id: str,
    feature: str | None = None,
    now: int | None = None,
) -> None:
    """Upsert one authenticated client signal into a bounded hourly row."""

    normalized_event = str(event_type or "").strip().lower()
    if normalized_event not in CLIENT_EVENT_TYPES:
        raise UsageAnalyticsInputError("eventType không được hỗ trợ.")
    normalized_feature = _normalize_feature(
        feature,
        required=normalized_event == "feature_used",
    )
    current = int(time.time() if now is None else now)
    if current <= 0:
        raise UsageAnalyticsInputError("Thời điểm telemetry không hợp lệ.")
    window_started_at = _hour_start(current)
    owner_type = _owner_type(organization_id, user_id)
    if normalized_event == "heartbeat":
        cursor.execute(
            """
            INSERT INTO product_usage_hourly (
                window_started_at, user_id, organization_id, owner_type,
                metric_key, feature_key, event_count, first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, '', 1, ?, ?)
            ON CONFLICT (
                window_started_at, user_id, organization_id, metric_key, feature_key
            ) DO UPDATE SET
                first_seen_at = LEAST(
                    product_usage_hourly.first_seen_at,
                    excluded.first_seen_at
                ),
                last_seen_at = GREATEST(
                    product_usage_hourly.last_seen_at,
                    excluded.last_seen_at
                )
            """,
            (
                window_started_at,
                user_id,
                organization_id,
                owner_type,
                PRESENCE_METRIC,
                current,
                current,
            ),
        )
        return

    cursor.execute(
        """
        INSERT INTO product_usage_hourly (
            window_started_at, user_id, organization_id, owner_type,
            metric_key, feature_key, event_count, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT (
            window_started_at, user_id, organization_id, metric_key, feature_key
        ) DO UPDATE SET
            event_count = LEAST(
                product_usage_hourly.event_count + 1,
                ?
            ),
            first_seen_at = LEAST(
                product_usage_hourly.first_seen_at,
                excluded.first_seen_at
            ),
            last_seen_at = GREATEST(
                product_usage_hourly.last_seen_at,
                excluded.last_seen_at
            )
        """,
        (
            window_started_at,
            user_id,
            organization_id,
            owner_type,
            FEATURE_METRIC,
            normalized_feature,
            current,
            current,
            FEATURE_EVENT_HOURLY_CAP,
        ),
    )


def record_word_export_success(
    cursor,
    *,
    user_id: str,
    organization_id: str,
    now: int | None = None,
) -> None:
    """Record one server-authoritative successful Word export operation."""

    current = int(time.time() if now is None else now)
    window_started_at = _hour_start(current)
    owner_type = _owner_type(organization_id, user_id)
    cursor.execute(
        """
        INSERT INTO product_usage_hourly (
            window_started_at, user_id, organization_id, owner_type,
            metric_key, feature_key, event_count, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, '', 1, ?, ?)
        ON CONFLICT (
            window_started_at, user_id, organization_id, metric_key, feature_key
        ) DO UPDATE SET
            event_count = LEAST(
                product_usage_hourly.event_count + 1,
                2147483647
            ),
            first_seen_at = LEAST(
                product_usage_hourly.first_seen_at,
                excluded.first_seen_at
            ),
            last_seen_at = GREATEST(
                product_usage_hourly.last_seen_at,
                excluded.last_seen_at
            )
        """,
        (
            window_started_at,
            user_id,
            organization_id,
            owner_type,
            WORD_EXPORT_METRIC,
            current,
            current,
        ),
    )


def record_word_export_success_best_effort(
    cursor,
    *,
    user_id: str,
    organization_id: str,
    now: int | None = None,
) -> bool:
    """Isolate telemetry failure from a caller-owned business transaction."""

    savepoint = "bf_product_usage_word_export"
    try:
        cursor.execute(f"SAVEPOINT {savepoint}")
        record_word_export_success(
            cursor,
            user_id=user_id,
            organization_id=organization_id,
            now=now,
        )
        cursor.execute(f"RELEASE SAVEPOINT {savepoint}")
        return True
    except Exception as exc:  # noqa: BLE001 - telemetry is deliberately fail-open.
        try:
            cursor.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
            cursor.execute(f"RELEASE SAVEPOINT {savepoint}")
        except Exception as rollback_error:  # noqa: BLE001
            log_error(
                rollback_error,
                "product_usage_word_export_savepoint",
                level="WARN",
            )
        log_error(exc, "product_usage_word_export", level="WARN")
        return False


def _row_value(row: Any, key: str, index: int, default: Any = 0) -> Any:
    if row is None:
        return default
    try:
        value = row[key]
    except (KeyError, TypeError):
        try:
            value = row[index]
        except (IndexError, KeyError, TypeError):
            return default
    return default if value is None else value


def _utc_iso(epoch: int) -> str:
    return (
        datetime.fromtimestamp(int(epoch), timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _local_iso(epoch: int) -> str:
    return datetime.fromtimestamp(int(epoch), PRODUCT_TIMEZONE).isoformat()


def _summary_payload(
    window: SummaryWindow,
    *,
    current: int,
    online_now: int,
    coverage: dict[str, Any],
    concurrency_series: list[dict[str, Any]] | None = None,
    top_features: list[dict[str, Any]] | None = None,
    active_users: int = 0,
    feature_uses: int = 0,
    work_activities: int = 0,
    word_exports: int = 0,
) -> dict[str, Any]:
    concurrency_series = concurrency_series or []
    top_features = top_features or []
    measured_series = [
        point for point in concurrency_series if point["count"] > 0
    ]
    if measured_series:
        peak = min(
            measured_series,
            key=lambda point: (-point["count"], point["timestamp"]),
        )
        peak_start_epoch = int(
            datetime.fromisoformat(peak["timestamp"].replace("Z", "+00:00")).timestamp()
        )
        peak_concurrency = {
            "count": peak["count"],
            "start": peak["timestamp"],
            "end": _utc_iso(
                min(peak_start_epoch + window.bucket_seconds, window.end_epoch)
            ),
        }
    else:
        peak_concurrency = {"count": 0, "start": None, "end": None}

    averages = {
        "jobsPerActiveUser": round(work_activities / active_users, 4)
        if active_users
        else 0,
        "wordExportsPerActiveUser": round(word_exports / active_users, 4)
        if active_users
        else 0,
    }
    return {
        "generatedAt": _utc_iso(current),
        "timezone": PRODUCT_TIMEZONE_NAME,
        "range": {
            "from": _local_iso(window.start_epoch),
            "to": _local_iso(window.end_epoch - 1),
            "endExclusive": _local_iso(window.end_epoch),
            "bucket": window.bucket,
        },
        "coverage": coverage,
        "onlineNow": online_now,
        "peakConcurrency": peak_concurrency,
        "topFeatures": top_features,
        "averages": averages,
        "activeUsers": active_users,
        "featureUseCount": feature_uses,
        "workActivityCount": work_activities,
        "wordExportCount": word_exports,
        "eventCount": feature_uses + work_activities + word_exports,
        "concurrencySeries": concurrency_series,
        "definitions": {
            "onlineWindowSeconds": ONLINE_WINDOW_SECONDS,
            "workActivitySource": "nhat_ky_thuc_hien",
            "eventCountExcludesPresence": True,
            "activeUsersExcludePresenceOnly": True,
            "presenceStorage": "one-row-per-user-workspace-hour",
            "retentionPolicy": "not-configured",
        },
    }


def build_usage_summary(
    cursor,
    window: SummaryWindow,
    *,
    now: int | None = None,
) -> dict[str, Any]:
    """Build a global, aggregate-only report for the Super Admin control plane."""

    current = int(time.time() if now is None else now)
    online_row = cursor.execute(
        """
        SELECT COUNT(DISTINCT user_id) AS online_now
        FROM product_usage_hourly
        WHERE metric_key = ? AND last_seen_at >= ? AND last_seen_at <= ?
        """,
        (PRESENCE_METRIC, current - ONLINE_WINDOW_SECONDS, current),
    ).fetchone()
    online_now = int(_row_value(online_row, "online_now", 0))

    coverage_row = cursor.execute(
        """
        SELECT MIN(first_seen_at) AS telemetry_started_at
        FROM product_usage_hourly
        WHERE window_started_at = (
            SELECT MIN(window_started_at) FROM product_usage_hourly
        )
        """
    ).fetchone()
    telemetry_started_at = int(
        _row_value(coverage_row, "telemetry_started_at", 0)
    )
    if telemetry_started_at <= 0 or telemetry_started_at >= window.end_epoch:
        return _summary_payload(
            window,
            current=current,
            online_now=online_now,
            coverage={"hasData": False, "startedAt": None, "partial": False},
        )

    effective_activity_start = max(window.start_epoch, telemetry_started_at)
    effective_rollup_start = max(
        window.start_epoch,
        _hour_start(telemetry_started_at),
    )
    first_series_bucket = window.start_epoch + (
        (effective_rollup_start - window.start_epoch) // window.bucket_seconds
    ) * window.bucket_seconds
    coverage = {
        "hasData": True,
        "startedAt": _utc_iso(telemetry_started_at),
        "partial": telemetry_started_at > window.start_epoch,
    }

    series_rows = cursor.execute(
        """
        SELECT
            window_started_at - MOD(window_started_at - ?, ?) AS bucket_start,
            COUNT(DISTINCT user_id) AS user_count
        FROM product_usage_hourly
        WHERE metric_key = ?
          AND window_started_at >= ? AND window_started_at < ?
        GROUP BY bucket_start
        ORDER BY bucket_start
        """,
        (
            window.start_epoch,
            window.bucket_seconds,
            PRESENCE_METRIC,
            effective_rollup_start,
            window.end_epoch,
        ),
    ).fetchall()
    observed_series = {}
    for row in series_rows:
        bucket_start = int(_row_value(row, "bucket_start", 0))
        observed_series[bucket_start] = int(_row_value(row, "user_count", 1))
    concurrency_series = [
        {
            "timestamp": _utc_iso(bucket_start),
            "count": observed_series.get(bucket_start, 0),
        }
        for bucket_start in range(
            first_series_bucket,
            window.end_epoch,
            window.bucket_seconds,
        )
    ]

    feature_rows = cursor.execute(
        """
        SELECT feature_key, SUM(event_count) AS event_count,
               COUNT(DISTINCT user_id) AS unique_users
        FROM product_usage_hourly
        WHERE metric_key = ?
          AND window_started_at >= ? AND window_started_at < ?
        GROUP BY feature_key
        ORDER BY event_count DESC, feature_key
        LIMIT 20
        """,
        (FEATURE_METRIC, effective_rollup_start, window.end_epoch),
    ).fetchall()
    top_features = []
    for row in feature_rows:
        feature = str(_row_value(row, "feature_key", 0, ""))
        if feature not in FEATURE_KEYS:
            continue
        top_features.append(
            {
                "feature": feature,
                "label": FEATURE_LABELS[feature],
                "count": int(_row_value(row, "event_count", 1)),
                "uniqueUsers": int(_row_value(row, "unique_users", 2)),
            }
        )

    totals_row = cursor.execute(
        """
        WITH active_users AS (
            SELECT user_id
            FROM product_usage_hourly
            WHERE metric_key IN (?, ?)
              AND window_started_at >= ? AND window_started_at < ?
            UNION
            SELECT actor_user_id AS user_id
            FROM nhat_ky_thuc_hien
            WHERE actor_user_id IS NOT NULL
              AND occurred_at >= to_timestamp(?)
              AND occurred_at < to_timestamp(?)
        )
        SELECT
            (SELECT COUNT(*) FROM active_users) AS active_users,
            (SELECT COALESCE(SUM(event_count), 0)
               FROM product_usage_hourly
              WHERE metric_key = ?
                AND window_started_at >= ? AND window_started_at < ?)
                AS feature_uses,
            (SELECT COUNT(*)
               FROM nhat_ky_thuc_hien
              WHERE actor_user_id IS NOT NULL
                AND occurred_at >= to_timestamp(?)
                AND occurred_at < to_timestamp(?)) AS work_activities,
            (SELECT COALESCE(SUM(event_count), 0)
               FROM product_usage_hourly
              WHERE metric_key = ?
                AND window_started_at >= ? AND window_started_at < ?)
                AS word_exports
        """,
        (
            FEATURE_METRIC,
            WORD_EXPORT_METRIC,
            effective_rollup_start,
            window.end_epoch,
            effective_activity_start,
            window.end_epoch,
            FEATURE_METRIC,
            effective_rollup_start,
            window.end_epoch,
            effective_activity_start,
            window.end_epoch,
            WORD_EXPORT_METRIC,
            effective_rollup_start,
            window.end_epoch,
        ),
    ).fetchone()
    active_users = int(_row_value(totals_row, "active_users", 0))
    feature_uses = int(_row_value(totals_row, "feature_uses", 1))
    work_activities = int(_row_value(totals_row, "work_activities", 2))
    word_exports = int(_row_value(totals_row, "word_exports", 3))

    return _summary_payload(
        window,
        current=current,
        online_now=online_now,
        coverage=coverage,
        concurrency_series=concurrency_series,
        top_features=top_features,
        active_users=active_users,
        feature_uses=feature_uses,
        work_activities=work_activities,
        word_exports=word_exports,
    )
